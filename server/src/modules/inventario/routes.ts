import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  estoqueCaixas,
  estoquePosicao,
  inventarioAjustesLog,
  inventarioCiclos,
  inventarioItens,
  inventarios,
  inventarioZonas,
  locais,
  produtos,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  buscarProdutoVazio,
  gerarLotePorData,
  normalizarDataIso,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  resolverTaraPeso,
  toDec,
  toNum,
  verificarEnderecoBloqueado,
} from '../wms/helpers.js'

const PERM_INV_READ = [
  'inventario_coletor',
  'inventario_divergencias',
  'inventario_gestao',
  'inventario_carga_inicial',
  'relatorios_estoque',
]

export function registerInventarioRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── BLOQUEIOS DE ENDEREÇO ──────────────────────────────────────────────────
  app.get(
    '/api/inventario/bloqueados',
    {
      preHandler: requirePermission(
        [
          ...PERM_INV_READ,
          'movimentacao',
          'desmembramento',
          'recebimento',
          'retorno_producao',
          'saida',
          'expedicao',
        ],
        { write: false, bloquearCliente: true },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .selectDistinct({ endereco: inventarioItens.endereco })
        .from(inventarioItens)
        .innerJoin(inventarios, eq(inventarios.id, inventarioItens.inventarioId))
        .where(
          and(
            eq(inventarios.tenantId, ctx.tenantId),
            eq(inventarios.filialId, ctx.filialId),
            sql`${inventarios.status} NOT IN ('Finalizado OK', 'Cancelado')`,
          ),
        )
      return { data: rows.map((r) => r.endereco) }
    },
  )

  app.get(
    '/api/inventario/verificar-bloqueio/:endereco',
    {
      preHandler: requirePermission(
        [
          ...PERM_INV_READ,
          'movimentacao',
          'desmembramento',
          'recebimento',
          'retorno_producao',
          'saida',
          'expedicao',
        ],
        { write: false, bloquearCliente: true },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const endereco = String((req.params as { endereco: string }).endereco || '')
        .trim()
        .toUpperCase()
      const blq = await verificarEnderecoBloqueado(conn.db, ctx.tenantId, ctx.filialId, endereco)
      return { bloqueado: Boolean(blq), inventario: blq }
    },
  )

  // ── CICLOS ─────────────────────────────────────────────────────────────────
  app.get(
    '/api/inventario/ciclos',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(inventarioCiclos)
        .where(eq(inventarioCiclos.tenantId, ctx.tenantId))
        .orderBy(desc(inventarioCiclos.dataCriacao))
      return { data: rows }
    },
  )

  app.get(
    '/api/inventario/ciclos/ativo',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const [row] = await conn.db
        .select()
        .from(inventarioCiclos)
        .where(and(eq(inventarioCiclos.tenantId, ctx.tenantId), eq(inventarioCiclos.status, 'Ativo')))
        .limit(1)
      return { data: row || null }
    },
  )

  app.post('/api/inventario/ciclos', { preHandler: requirePermission('inventario_gestao') }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = req.body as { nome: string; target_pct?: number }
    const nome = String(body.nome || '').trim()
    if (!nome) throw new HttpError(400, 'Nome do ciclo é obrigatório.')

    const [ativo] = await conn.db
      .select({ id: inventarioCiclos.id })
      .from(inventarioCiclos)
      .where(and(eq(inventarioCiclos.tenantId, ctx.tenantId), eq(inventarioCiclos.status, 'Ativo')))
      .limit(1)
    if (ativo) {
      throw new HttpError(409, 'Já existe um ciclo ativo. Encerre-o antes de criar um novo.')
    }

    const id = uuidv7()
    await conn.db.insert(inventarioCiclos).values({
      id,
      tenantId: ctx.tenantId,
      nome,
      status: 'Ativo',
      targetPct: toDec(toNum(body.target_pct, 99.9), 2),
    })
    return reply.code(201).send({ success: true, id })
  })

  app.post(
    '/api/inventario/ciclos/:id/encerrar',
    { preHandler: requirePermission('inventario_gestao') },
    async (req) => {
      const ctx = req.authCtx!
      const cicloId = parseUuidOrBadRequest((req.params as { id: string }).id, 'ciclo_id')
      const forcar = Boolean((req.body as { forcar?: boolean })?.forcar)

      if (!forcar) {
        const abertos = await conn.db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(inventarios)
          .where(
            and(
              eq(inventarios.tenantId, ctx.tenantId),
              eq(inventarios.cicloId, cicloId),
              sql`${inventarios.status} NOT IN ('Finalizado OK', 'Cancelado')`,
            ),
          )
        if (Number(abertos[0]?.count || 0) > 0) {
          throw new HttpError(409, 'Existem inventários ainda abertos neste ciclo.')
        }
      }

      await conn.db
        .update(inventarioCiclos)
        .set({ status: 'Encerrado', dataEncerramento: new Date() })
        .where(and(eq(inventarioCiclos.id, cicloId), eq(inventarioCiclos.tenantId, ctx.tenantId)))

      return { success: true }
    },
  )

  app.get(
    '/api/inventario/ciclos/:id/dashboard',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const cicloId = parseUuidOrBadRequest((req.params as { id: string }).id, 'ciclo_id')

      const invFin = await conn.db
        .select({ id: inventarios.id })
        .from(inventarios)
        .where(
          and(
            eq(inventarios.tenantId, ctx.tenantId),
            eq(inventarios.cicloId, cicloId),
            eq(inventarios.status, 'Finalizado OK'),
          ),
        )
      const invIds = invFin.map((i) => i.id)

      const locRes = await conn.db
        .select({ v: sql<number>`COUNT(*)::int` })
        .from(locais)
        .where(
          and(
            eq(locais.tenantId, ctx.tenantId),
            eq(locais.filialId, ctx.filialId),
            eq(locais.ativo, 1),
            sql`${locais.endereco} NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')`,
          ),
        )
      const enderecosTotal = Number(locRes[0]?.v || 0)

      if (invIds.length === 0) {
        return {
          ira: 0,
          ila: 0,
          perdas: 0,
          ganhos: 0,
          saldo: 0,
          enderecos_contados: 0,
          enderecos_total: enderecosTotal,
          itens_acurados: 0,
          itens_total: 0,
          ajustes: [],
        }
      }

      const [iraRow] = await conn.db
        .select({
          total: sql<number>`COUNT(*)::int`,
          acurados: sql<number>`SUM(CASE WHEN ABS(COALESCE(${inventarioItens.qtdContadaCaixas}, 0) - COALESCE(${inventarioItens.qtdSistemaCaixas}, 0)) < 0.001 THEN 1 ELSE 0 END)::int`,
        })
        .from(inventarioItens)
        .where(and(inArray(inventarioItens.inventarioId, invIds), sql`${inventarioItens.qtdContadaCaixas} IS NOT NULL`))

      const endStats = await conn.db
        .select({
          endereco: inventarioItens.endereco,
          total: sql<number>`COUNT(*)::int`,
          acurados: sql<number>`SUM(CASE WHEN ABS(COALESCE(${inventarioItens.qtdContadaCaixas}, 0) - COALESCE(${inventarioItens.qtdSistemaCaixas}, 0)) < 0.001 THEN 1 ELSE 0 END)::int`,
        })
        .from(inventarioItens)
        .where(and(inArray(inventarioItens.inventarioId, invIds), sql`${inventarioItens.qtdContadaCaixas} IS NOT NULL`))
        .groupBy(inventarioItens.endereco)

      const totalEnd = endStats.length
      const end100 = endStats.filter((e) => e.total === e.acurados).length
      const ira = Number(iraRow?.total || 0) > 0 ? (Number(iraRow.acurados) / Number(iraRow.total)) * 100 : 0
      const ila = totalEnd > 0 ? (end100 / totalEnd) * 100 : 0

      const [finRow] = await conn.db
        .select({
          perdas: sql<string>`COALESCE(SUM(CASE WHEN ${inventarioAjustesLog.qtdAjustadaCaixas} < 0 THEN ABS(${inventarioAjustesLog.qtdAjustadaCaixas}) * ${inventarioAjustesLog.custoUnitarioData} ELSE 0 END), 0)`,
          ganhos: sql<string>`COALESCE(SUM(CASE WHEN ${inventarioAjustesLog.qtdAjustadaCaixas} > 0 THEN ${inventarioAjustesLog.qtdAjustadaCaixas} * ${inventarioAjustesLog.custoUnitarioData} ELSE 0 END), 0)`,
        })
        .from(inventarioAjustesLog)
        .where(and(eq(inventarioAjustesLog.tenantId, ctx.tenantId), eq(inventarioAjustesLog.cicloId, cicloId)))

      const ajustes = await conn.db
        .select({
          id: inventarioAjustesLog.id,
          inventario_id: inventarioAjustesLog.inventarioId,
          endereco: inventarioAjustesLog.endereco,
          lote: inventarioAjustesLog.lote,
          qtd_ajustada_caixas: inventarioAjustesLog.qtdAjustadaCaixas,
          qtd_ajustada_kg: inventarioAjustesLog.qtdAjustadaKg,
          tipo_ajuste: inventarioAjustesLog.tipoAjuste,
          usuario_aprovou_nome: inventarioAjustesLog.usuarioAprovouNome,
          data_ajuste: inventarioAjustesLog.dataAjuste,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
        })
        .from(inventarioAjustesLog)
        .innerJoin(produtos, eq(produtos.id, inventarioAjustesLog.produtoId))
        .where(and(eq(inventarioAjustesLog.tenantId, ctx.tenantId), eq(inventarioAjustesLog.cicloId, cicloId)))
        .orderBy(desc(inventarioAjustesLog.dataAjuste))
        .limit(100)

      const perdas = toNum(finRow?.perdas, 0)
      const ganhos = toNum(finRow?.ganhos, 0)

      return {
        ira: Math.round(ira * 100) / 100,
        ila: Math.round(ila * 100) / 100,
        perdas,
        ganhos,
        saldo: ganhos - perdas,
        enderecos_contados: totalEnd,
        enderecos_total: enderecosTotal,
        itens_acurados: Number(iraRow?.acurados || 0),
        itens_total: Number(iraRow?.total || 0),
        ajustes: ajustes.map((a) => ({
          ...a,
          qtd_ajustada_caixas: toNum(a.qtd_ajustada_caixas, 0),
          qtd_ajustada_kg: toNum(a.qtd_ajustada_kg, 0),
        })),
      }
    },
  )

  // ── INVENTÁRIOS (LISTAR, CRIAR CÍCLICO / GERAL / CARGA INICIAL) ────────────
  app.get(
    '/api/inventario',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: inventarios.id,
          tipo_filtro: inventarios.tipoFiltro,
          identificador_filtro: inventarios.identificadorFiltro,
          nome: inventarios.nome,
          tipo: inventarios.tipo,
          ciclo_id: inventarios.cicloId,
          status: inventarios.status,
          data_criacao: inventarios.dataCriacao,
          data_finalizacao: inventarios.dataFinalizacao,
          total_itens: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id})`,
          contados: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item NOT IN ('Pendente', '2ª Contagem', '3ª Contagem'))`,
          ok: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item = 'OK')`,
          itens_ok: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item = 'OK')`,
          divergentes: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item = 'Aguardando Ajuste')`,
          itens_divergentes: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item = 'Aguardando Ajuste')`,
          pendentes: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item IN ('Pendente', '2ª Contagem', '3ª Contagem'))`,
          itens_pendentes: sql<number>`(SELECT COUNT(*)::int FROM inventario_itens ii WHERE ii.inventario_id = ${inventarios.id} AND ii.status_item IN ('Pendente', '2ª Contagem', '3ª Contagem'))`,
        })
        .from(inventarios)
        .where(and(eq(inventarios.tenantId, ctx.tenantId), eq(inventarios.filialId, ctx.filialId)))
        .orderBy(desc(inventarios.dataCriacao))
        .limit(100)
      return { data: rows }
    },
  )

  app.post(
    '/api/inventario',
    { preHandler: requirePermission(['inventario_gestao', 'inventario_carga_inicial']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = req.body as {
        tipo?: 'Ciclico' | 'Geral' | 'CargaInicial'
        tipo_filtro?: 'Curva' | 'Rua'
        identificador_filtro?: string
        nome?: string
        zonas?: string[]
      }

      const tipo = body.tipo || 'Ciclico'

      if (tipo === 'CargaInicial') {
        const [existe] = await conn.db
          .select({ id: inventarios.id })
          .from(inventarios)
          .where(
            and(
              eq(inventarios.tenantId, ctx.tenantId),
              eq(inventarios.filialId, ctx.filialId),
              eq(inventarios.tipo, 'CargaInicial'),
              sql`${inventarios.status} NOT IN ('Finalizado OK', 'Cancelado')`,
            ),
          )
          .limit(1)
        if (existe) throw new HttpError(409, 'Já existe uma carga inicial em andamento.')

        const locRows = await conn.db
          .select({ endereco: locais.endereco })
          .from(locais)
          .where(
            and(
              eq(locais.tenantId, ctx.tenantId),
              eq(locais.filialId, ctx.filialId),
              eq(locais.ativo, 1),
              sql`${locais.endereco} NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')`,
            ),
          )
        if (locRows.length === 0) throw new HttpError(400, 'Cadastre endereços antes de iniciar a carga inicial.')

        const invId = uuidv7()
        await conn.db.insert(inventarios).values({
          id: invId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          nome: body.nome?.trim() || 'Carga Inicial do Sistema',
          tipo: 'CargaInicial',
          status: 'Em Contagem',
        })
        return reply.code(201).send({ success: true, inventario_id: invId, total_locais: locRows.length })
      }

      if (tipo === 'Geral') {
        const nome = String(body.nome || '').trim() || 'Inventário Geral'
        const zonas = Array.isArray(body.zonas) ? body.zonas : []
        if (zonas.length === 0) throw new HttpError(400, 'Informe ao menos uma zona para inventário geral.')

        const invId = await conn.db.transaction(async (tx) => {
          const id = uuidv7()
          await tx.insert(inventarios).values({
            id,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            nome,
            tipo: 'Geral',
            status: 'Em Contagem',
          })

          const pVazio = await buscarProdutoVazio(tx, ctx.tenantId)
          for (const zona of zonas) {
            await tx.insert(inventarioZonas).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              inventarioId: id,
              nomeZona: zona,
              status: 'Aberta',
            })
            const prefixPattern = `${zona}%`
            const saldos = await tx.execute(sql`
              SELECT l.endereco,
                     COALESCE(ep.produto_id, ${pVazio}) AS produto_id,
                     COALESCE(ep.lote, '') AS lote,
                     ep.validade,
                     COALESCE(ep.qtd_caixas, 0) AS qtd_caixas,
                     COALESCE(ep.qtd_kg, 0) AS qtd_kg
              FROM locais l
              LEFT JOIN estoque_posicao ep
                ON ep.tenant_id = ${ctx.tenantId}
               AND ep.filial_id = ${ctx.filialId}
               AND ep.endereco = l.endereco
               AND ep.qtd_caixas > 0
              WHERE l.tenant_id = ${ctx.tenantId}
                AND l.filial_id = ${ctx.filialId}
                AND l.endereco LIKE ${prefixPattern}
                AND l.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
              ORDER BY l.endereco
            `)

            const rows = saldos.rows as Array<{
              endereco: string
              produto_id: string
              lote: string
              validade: string | null
              qtd_caixas: string
              qtd_kg: string
            }>
            if (rows.length > 0) {
              await tx.insert(inventarioItens).values(
                rows.map((s) => ({
                  id: uuidv7(),
                  tenantId: ctx.tenantId,
                  inventarioId: id,
                  endereco: s.endereco,
                  produtoId: s.produto_id,
                  lote: s.lote || '',
                  validade: s.validade || null,
                  qtdSistemaCaixas: String(toNum(s.qtd_caixas, 0)),
                  qtdSistemaKg: toDec(toNum(s.qtd_kg, 0), 3),
                  statusItem: 'Pendente',
                })),
              )
            }
          }
          return id
        })

        return reply.code(201).send({ success: true, inventario_id: invId })
      }

      // Cíclico (Curva ou Rua)
      const tipoFiltro = body.tipo_filtro || 'Rua'
      const identFiltro = String(body.identificador_filtro || '').trim()
      if (!identFiltro) throw new HttpError(400, 'Informe o identificador do filtro para inventário cíclico.')

      const resInv = await conn.db.transaction(async (tx) => {
        const [ativo] = await tx
          .select({ id: inventarios.id })
          .from(inventarios)
          .where(
            and(
              eq(inventarios.tenantId, ctx.tenantId),
              eq(inventarios.filialId, ctx.filialId),
              eq(inventarios.tipo, 'Ciclico'),
              eq(inventarios.tipoFiltro, tipoFiltro),
              eq(inventarios.identificadorFiltro, identFiltro),
              sql`${inventarios.status} NOT IN ('Finalizado OK', 'Cancelado')`,
            ),
          )
          .limit(1)
        if (ativo) throw new HttpError(409, 'Já existe um inventário em andamento para este filtro.')

        const [cicloAtivo] = await tx
          .select({ id: inventarioCiclos.id })
          .from(inventarioCiclos)
          .where(and(eq(inventarioCiclos.tenantId, ctx.tenantId), eq(inventarioCiclos.status, 'Ativo')))
          .limit(1)

        const invId = uuidv7()
        await tx.insert(inventarios).values({
          id: invId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          tipoFiltro,
          identificadorFiltro: identFiltro,
          nome: body.nome?.trim() || `${tipoFiltro} ${identFiltro}`,
          tipo: 'Ciclico',
          cicloId: cicloAtivo?.id || null,
          status: 'Aberto',
        })

        let saldos: Array<{
          endereco: string
          produto_id: string
          lote: string
          validade: string | null
          qtd_caixas: number
          qtd_kg: number
        }> = []

        if (tipoFiltro === 'Curva') {
          const rows = await tx
            .select({
              endereco: estoquePosicao.endereco,
              produto_id: estoquePosicao.produtoId,
              lote: estoquePosicao.lote,
              validade: estoquePosicao.validade,
              qtd_caixas: estoquePosicao.qtdCaixas,
              qtd_kg: estoquePosicao.qtdKg,
            })
            .from(estoquePosicao)
            .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
            .where(
              and(
                eq(estoquePosicao.tenantId, ctx.tenantId),
                eq(estoquePosicao.filialId, ctx.filialId),
                eq(produtos.statusCurva, identFiltro),
                sql`${estoquePosicao.qtdCaixas} > 0 AND ${estoquePosicao.endereco} NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')`,
              ),
            )
            .orderBy(estoquePosicao.endereco, produtos.descricao)
          saldos = rows.map((r) => ({
            ...r,
            qtd_caixas: toNum(r.qtd_caixas, 0),
            qtd_kg: toNum(r.qtd_kg, 0),
          }))
        } else {
          const pVazio = await buscarProdutoVazio(tx, ctx.tenantId)
          const pattern = `${identFiltro}%`
          const res = await tx.execute(sql`
            SELECT l.endereco,
                   COALESCE(ep.produto_id, ${pVazio}) AS produto_id,
                   COALESCE(ep.lote, '') AS lote,
                   ep.validade,
                   COALESCE(ep.qtd_caixas, 0) AS qtd_caixas,
                   COALESCE(ep.qtd_kg, 0) AS qtd_kg
            FROM locais l
            LEFT JOIN estoque_posicao ep
              ON ep.tenant_id = ${ctx.tenantId}
             AND ep.filial_id = ${ctx.filialId}
             AND ep.endereco = l.endereco
             AND ep.qtd_caixas > 0
            WHERE l.tenant_id = ${ctx.tenantId}
              AND l.filial_id = ${ctx.filialId}
              AND l.endereco LIKE ${pattern}
              AND l.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
            ORDER BY l.endereco
          `)
          saldos = (res.rows as Array<Record<string, unknown>>).map((r) => ({
            endereco: String(r.endereco),
            produto_id: String(r.produto_id),
            lote: String(r.lote || ''),
            validade: (r.validade as string) || null,
            qtd_caixas: toNum(r.qtd_caixas, 0),
            qtd_kg: toNum(r.qtd_kg, 0),
          }))
        }

        if (saldos.length === 0) {
          throw new HttpError(400, 'Nenhum item ou endereço encontrado para os critérios selecionados.')
        }

        await tx.insert(inventarioItens).values(
          saldos.map((s) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            inventarioId: invId,
            endereco: s.endereco,
            produtoId: s.produto_id,
            lote: s.lote,
            validade: s.validade,
            qtdSistemaCaixas: String(s.qtd_caixas),
            qtdSistemaKg: toDec(s.qtd_kg, 3),
            statusItem: 'Pendente',
          })),
        )

        await tx
          .update(inventarios)
          .set({ status: 'Em Contagem' })
          .where(eq(inventarios.id, invId))

        return { inventario_id: invId, total_itens: saldos.length }
      })

      return reply.code(201).send({ success: true, ...resInv })
    },
  )

  app.get(
    '/api/inventario/:id',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const [inv] = await conn.db
        .select()
        .from(inventarios)
        .where(and(eq(inventarios.id, id), eq(inventarios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!inv) throw new HttpError(404, 'Inventário não encontrado.')
      return { data: inv }
    },
  )

  app.get(
    '/api/inventario/:id/itens',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const rows = await conn.db
        .select({
          id: inventarioItens.id,
          inventario_id: inventarioItens.inventarioId,
          endereco: inventarioItens.endereco,
          produto_id: inventarioItens.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          tipo_produto: produtos.tipoProduto,
          status_curva: produtos.statusCurva,
          valor_unitario: produtos.valorUnitario,
          grupo: produtos.grupo,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          lote: inventarioItens.lote,
          validade: inventarioItens.validade,
          ean_caixa: inventarioItens.eanCaixa,
          qtd_sistema_caixas: inventarioItens.qtdSistemaCaixas,
          qtd_sistema_kg: inventarioItens.qtdSistemaKg,
          qtd_contada_caixas: inventarioItens.qtdContadaCaixas,
          qtd_contada_kg: inventarioItens.qtdContadaKg,
          contagem_atual: inventarioItens.contagemAtual,
          validade_contada: inventarioItens.validadeContada,
          peso_bruto_contado_kg: inventarioItens.pesoBrutoContadoKg,
          tara_id: inventarioItens.taraId,
          tara_kg: inventarioItens.taraKg,
          data_producao_contada: inventarioItens.dataProducaoContada,
          qtd_pecas_contada: inventarioItens.qtdPecasContada,
          status_item: inventarioItens.statusItem,
          data_contagem: inventarioItens.dataContagem,
        })
        .from(inventarioItens)
        .innerJoin(produtos, eq(produtos.id, inventarioItens.produtoId))
        .where(and(eq(inventarioItens.inventarioId, id), eq(inventarioItens.tenantId, ctx.tenantId)))
        .orderBy(inventarioItens.endereco, produtos.descricao)

      return {
        data: rows.map((r) => ({
          ...r,
          valor_unitario: toNum(r.valor_unitario, 0),
          qtd_sistema_caixas: toNum(r.qtd_sistema_caixas, 0),
          qtd_sistema_kg: toNum(r.qtd_sistema_kg, 0),
          qtd_contada_caixas: r.qtd_contada_caixas != null ? toNum(r.qtd_contada_caixas, 0) : null,
          qtd_contada_kg: r.qtd_contada_kg != null ? toNum(r.qtd_contada_kg, 0) : null,
          tara_kg: toNum(r.tara_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/inventario/:id/zonas',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const zonas = await conn.db
        .select()
        .from(inventarioZonas)
        .where(and(eq(inventarioZonas.inventarioId, id), eq(inventarioZonas.tenantId, ctx.tenantId)))

      const result = []
      for (const z of zonas) {
        const pattern = `${z.nomeZona}%`
        const [st] = await conn.db
          .select({
            total: sql<number>`COUNT(*)::int`,
            contados: sql<number>`SUM(CASE WHEN ${inventarioItens.statusItem} NOT IN ('Pendente', '2ª Contagem', '3ª Contagem') THEN 1 ELSE 0 END)::int`,
            ok: sql<number>`SUM(CASE WHEN ${inventarioItens.statusItem} = 'OK' THEN 1 ELSE 0 END)::int`,
            divergentes: sql<number>`SUM(CASE WHEN ${inventarioItens.statusItem} = 'Aguardando Ajuste' THEN 1 ELSE 0 END)::int`,
          })
          .from(inventarioItens)
          .where(and(eq(inventarioItens.inventarioId, id), sql`${inventarioItens.endereco} LIKE ${pattern}`))
        const total = Number(st?.total || 0)
        const contados = Number(st?.contados || 0)
        result.push({
          ...z,
          total,
          contados,
          ok: Number(st?.ok || 0),
          divergentes: Number(st?.divergentes || 0),
          pct: total > 0 ? Math.round((contados / total) * 100) : 0,
        })
      }
      return { data: result }
    },
  )

  app.get(
    '/api/inventario/:id/ira',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const rows = await conn.db
        .select({
          endereco: inventarioItens.endereco,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          status_curva: produtos.statusCurva,
          lote: inventarioItens.lote,
          validade: inventarioItens.validade,
          qtd_sistema_caixas: inventarioItens.qtdSistemaCaixas,
          qtd_contada_caixas: inventarioItens.qtdContadaCaixas,
          qtd_sistema_kg: inventarioItens.qtdSistemaKg,
          qtd_contada_kg: inventarioItens.qtdContadaKg,
          status_item: inventarioItens.statusItem,
        })
        .from(inventarioItens)
        .innerJoin(produtos, eq(produtos.id, inventarioItens.produtoId))
        .where(
          and(
            eq(inventarioItens.inventarioId, id),
            eq(inventarioItens.tenantId, ctx.tenantId),
            sql`${inventarioItens.qtdContadaCaixas} IS NOT NULL`,
          ),
        )

      const itens = rows.map((r) => {
        const sist = toNum(r.qtd_sistema_caixas, 0)
        const cont = toNum(r.qtd_contada_caixas, 0)
        const iraPct =
          sist === 0 && cont === 0
            ? 100
            : sist === 0
              ? 0
              : Math.max(0, Number(((1 - Math.abs(cont - sist) / sist) * 100).toFixed(2)))
        return {
          ...r,
          qtd_sistema_caixas: sist,
          qtd_contada_caixas: cont,
          qtd_sistema_kg: toNum(r.qtd_sistema_kg, 0),
          qtd_contada_kg: toNum(r.qtd_contada_kg, 0),
          ira_pct: iraPct,
        }
      })
      const iraGeral =
        itens.length > 0
          ? Number((itens.reduce((acc, i) => acc + i.ira_pct, 0) / itens.length).toFixed(2))
          : 100
      return { itens, ira_geral: iraGeral }
    },
  )

  // ── CONTAGENS & CONCILIAÇÃO ─────────────────────────────────────────────────
  app.post(
    '/api/inventario/contagem',
    { preHandler: requirePermission(['inventario_coletor', 'inventario_gestao', 'inventario_carga_inicial']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = req.body as {
        item_id: string
        qtd_contada_caixas: number
        qtd_contada_kg: number
        validade_informada?: string | null
        peso_bruto_contado_kg?: number | null
        tara_id?: string | null
        tara_kg?: number | null
        data_producao_contada?: string | null
        lote_contado?: string | null
        qtd_pecas_contada?: number | null
      }

      const itemId = parseUuidOrBadRequest(body.item_id, 'item_id')

      await conn.db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(inventarioItens)
          .where(and(eq(inventarioItens.id, itemId), eq(inventarioItens.tenantId, ctx.tenantId)))
          .limit(1)
        if (!item) throw new HttpError(404, 'Item de inventário não encontrado.')

        const contCx = toNum(body.qtd_contada_caixas, 0)
        const sistCx = toNum(item.qtdSistemaCaixas, 0)
        const isOk = Math.abs(contCx - sistCx) < 0.001
        const statusItem = isOk ? 'OK' : 'Aguardando Ajuste'

        const valNorm = normalizarDataIso(body.validade_informada) || item.validadeContada || item.validade
        const dataProdNorm = normalizarDataIso(body.data_producao_contada) || item.dataProducaoContada
        const loteFinal =
          String(body.lote_contado || (dataProdNorm ? gerarLotePorData(dataProdNorm) : item.lote) || '').trim()
        const pecasContadas =
          body.qtd_pecas_contada != null && toNum(body.qtd_pecas_contada) > 0
            ? Math.trunc(toNum(body.qtd_pecas_contada))
            : item.qtdPecasContada
        const { taraId, taraKg } = await resolverTaraPeso(tx, ctx.tenantId, body.tara_id, body.tara_kg)

        await tx
          .update(inventarioItens)
          .set({
            qtdContadaCaixas: String(contCx),
            qtdContadaKg: toDec(toNum(body.qtd_contada_kg, 0), 3),
            validadeContada: valNorm,
            pesoBrutoContadoKg:
              body.peso_bruto_contado_kg != null
                ? toDec(toNum(body.peso_bruto_contado_kg, 0), 3)
                : item.pesoBrutoContadoKg,
            taraId: taraId ?? item.taraId,
            taraKg: body.tara_kg != null ? toDec(taraKg, 3) : item.taraKg,
            dataProducaoContada: dataProdNorm,
            lote: loteFinal || item.lote,
            qtdPecasContada: pecasContadas,
            statusItem,
            dataContagem: new Date(),
          })
          .where(eq(inventarioItens.id, itemId))

        const [pend] = await tx
          .select({ cnt: sql<number>`COUNT(*)::int` })
          .from(inventarioItens)
          .where(
            and(
              eq(inventarioItens.inventarioId, item.inventarioId),
              sql`${inventarioItens.statusItem} IN ('Pendente', '2ª Contagem', '3ª Contagem')`,
            ),
          )
        if (Number(pend?.cnt || 0) === 0) {
          const [div] = await tx
            .select({ cnt: sql<number>`COUNT(*)::int` })
            .from(inventarioItens)
            .where(and(eq(inventarioItens.inventarioId, item.inventarioId), eq(inventarioItens.statusItem, 'Aguardando Ajuste')))
          const novoStatus = Number(div?.cnt || 0) > 0 ? 'Aguardando Ajuste' : 'Finalizado OK'
          await tx
            .update(inventarios)
            .set({
              status: novoStatus,
              dataFinalizacao: novoStatus === 'Finalizado OK' ? new Date() : undefined,
            })
            .where(eq(inventarios.id, item.inventarioId))
        }
      })

      return { success: true }
    },
  )

  app.post(
    '/api/inventario/surpresa',
    { preHandler: requirePermission(['inventario_coletor', 'inventario_gestao', 'inventario_carga_inicial']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = req.body as {
        inventario_id: string
        endereco: string
        produto_id: string
        validade?: string | null
        ean_caixa: string
        lote?: string
        data_producao_contada?: string | null
        tara_id?: string | null
        tara_kg?: number
        peso_bruto_contado_kg?: number | null
        qtd_pecas_contada?: number | null
      }

      const invId = parseUuidOrBadRequest(body.inventario_id, 'inventario_id')
      const prodId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
      const endereco = String(body.endereco || '').trim().toUpperCase()
      const eanCaixa = String(body.ean_caixa || '').trim()
      if (!endereco || !eanCaixa) throw new HttpError(400, 'Endereço e EAN da caixa são obrigatórios.')

      const res = await conn.db.transaction(async (tx) => {
        const dummyId = await buscarProdutoVazio(tx, ctx.tenantId)
        await tx
          .delete(inventarioItens)
          .where(
            and(
              eq(inventarioItens.inventarioId, invId),
              eq(inventarioItens.endereco, endereco),
              eq(inventarioItens.produtoId, dummyId),
            ),
          )

        const [existente] = await tx
          .select()
          .from(inventarioItens)
          .where(
            and(
              eq(inventarioItens.inventarioId, invId),
              eq(inventarioItens.endereco, endereco),
              sql`LTRIM(COALESCE(${inventarioItens.eanCaixa}, ''), '0') = LTRIM(${eanCaixa}, '0')`,
            ),
          )
          .limit(1)
        if (existente) {
          return {
            item_id: existente.id,
            status_item: existente.statusItem,
            contagem_atual: existente.contagemAtual,
          }
        }

        const valNorm = normalizarDataIso(body.validade)
        const dpNorm = normalizarDataIso(body.data_producao_contada)
        const loteFinal = String(body.lote || (dpNorm ? gerarLotePorData(dpNorm) : '')).trim()
        const { taraId, taraKg } = await resolverTaraPeso(tx, ctx.tenantId, body.tara_id, body.tara_kg)
        const pecas =
          body.qtd_pecas_contada != null && toNum(body.qtd_pecas_contada) > 0
            ? Math.trunc(toNum(body.qtd_pecas_contada))
            : null

        const itemId = uuidv7()
        await tx.insert(inventarioItens).values({
          id: itemId,
          tenantId: ctx.tenantId,
          inventarioId: invId,
          eanCaixa,
          endereco,
          produtoId: prodId,
          lote: loteFinal,
          validade: null,
          validadeContada: valNorm,
          dataProducaoContada: dpNorm,
          taraId,
          taraKg: toDec(taraKg, 3),
          pesoBrutoContadoKg:
            body.peso_bruto_contado_kg != null ? toDec(toNum(body.peso_bruto_contado_kg, 0), 3) : null,
          qtdPecasContada: pecas,
          qtdSistemaCaixas: '0',
          qtdSistemaKg: '0.000',
          statusItem: 'Pendente',
        })
        return { item_id: itemId, status_item: 'Pendente', contagem_atual: 1 }
      })

      return reply.code(201).send({ success: true, ...res })
    },
  )

  app.post('/api/inventario/item/:itemId/recontar', { preHandler: requirePermission('inventario_gestao') }, async (req) => {
    const ctx = req.authCtx!
    const itemId = parseUuidOrBadRequest((req.params as { itemId: string }).itemId, 'item_id')
    await conn.db
      .update(inventarioItens)
      .set({
        qtdContadaCaixas: null,
        qtdContadaKg: null,
        statusItem: 'Pendente',
        contagemAtual: sql`${inventarioItens.contagemAtual} + 1`,
      })
      .where(and(eq(inventarioItens.id, itemId), eq(inventarioItens.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/inventario/:id/recontar-endereco', { preHandler: requirePermission('inventario_gestao') }, async (req) => {
    const ctx = req.authCtx!
    const invId = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
    const endereco = String((req.body as { endereco: string })?.endereco || '').trim().toUpperCase()
    if (!endereco) throw new HttpError(400, 'Endereço obrigatório.')

    await conn.db
      .update(inventarioItens)
      .set({
        qtdContadaCaixas: null,
        qtdContadaKg: null,
        statusItem: 'Pendente',
        contagemAtual: sql`${inventarioItens.contagemAtual} + 1`,
      })
      .where(
        and(
          eq(inventarioItens.inventarioId, invId),
          eq(inventarioItens.tenantId, ctx.tenantId),
          eq(inventarioItens.endereco, endereco),
          sql`${inventarioItens.statusItem} IN ('Aguardando Ajuste', '2ª Contagem', '3ª Contagem')`,
        ),
      )

    await conn.db
      .update(inventarios)
      .set({ status: 'Em Contagem' })
      .where(and(eq(inventarios.id, invId), eq(inventarios.status, 'Aguardando Ajuste')))

    return { success: true }
  })

  app.post(
    '/api/inventario/item/:itemId/validar-sem-ajuste',
    { preHandler: requirePermission('inventario_gestao') },
    async (req) => {
      const ctx = req.authCtx!
      const itemId = parseUuidOrBadRequest((req.params as { itemId: string }).itemId, 'item_id')

      await conn.db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(inventarioItens)
          .where(and(eq(inventarioItens.id, itemId), eq(inventarioItens.tenantId, ctx.tenantId)))
          .limit(1)
        if (!item) throw new HttpError(404, 'Item não encontrado.')
        if (item.statusItem !== 'Aguardando Ajuste') {
          throw new HttpError(400, 'Apenas itens divergentes podem ser validados sem ajuste.')
        }

        const [inv] = await tx
          .select({ cicloId: inventarios.cicloId })
          .from(inventarios)
          .where(eq(inventarios.id, item.inventarioId))
          .limit(1)

        await tx
          .update(inventarioItens)
          .set({
            qtdContadaCaixas: item.qtdSistemaCaixas,
            qtdContadaKg: item.qtdSistemaKg,
            statusItem: 'OK',
          })
          .where(eq(inventarioItens.id, itemId))

        await tx.insert(inventarioAjustesLog).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          inventarioId: item.inventarioId,
          cicloId: inv?.cicloId || null,
          itemId: item.id,
          produtoId: item.produtoId,
          endereco: item.endereco,
          lote: item.lote,
          qtdAjustadaCaixas: '0',
          qtdAjustadaKg: '0.000',
          tipoAjuste: 'Validado Físico (Sem Ajuste)',
          usuarioAprovouId: ctx.operador.id,
          usuarioAprovouNome: ctx.operador.nome,
        })

        const [rest] = await tx
          .select({ cnt: sql<number>`COUNT(*)::int` })
          .from(inventarioItens)
          .where(
            and(
              eq(inventarioItens.inventarioId, item.inventarioId),
              sql`${inventarioItens.statusItem} IN ('Pendente', '2ª Contagem', '3ª Contagem', 'Aguardando Ajuste')`,
            ),
          )
        if (Number(rest?.cnt || 0) === 0) {
          await tx
            .update(inventarios)
            .set({ status: 'Finalizado OK', dataFinalizacao: new Date() })
            .where(eq(inventarios.id, item.inventarioId))
        }
      })

      return { success: true }
    },
  )

  app.post('/api/inventario/:id/conciliar', { preHandler: requirePermission('inventario_gestao') }, async (req) => {
    const ctx = req.authCtx!
    const invId = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')

    const atualizados = await conn.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(inventarios)
        .where(and(eq(inventarios.id, invId), eq(inventarios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!inv) throw new HttpError(404, 'Inventário não encontrado.')

      const endRows = await tx
        .selectDistinct({ endereco: inventarioItens.endereco })
        .from(inventarioItens)
        .where(eq(inventarioItens.inventarioId, invId))
      const enderecos = endRows.map((e) => e.endereco).filter(Boolean)

      const dummyId = await buscarProdutoVazio(tx, ctx.tenantId)
      let ajustesCount = 0

      for (const endereco of enderecos) {
        const itensEnd = await tx
          .select({
            item: inventarioItens,
            valorUnitario: produtos.valorUnitario,
          })
          .from(inventarioItens)
          .innerJoin(produtos, eq(produtos.id, inventarioItens.produtoId))
          .where(and(eq(inventarioItens.inventarioId, invId), eq(inventarioItens.endereco, endereco)))

        const eansContados = new Set<string>()
        const caixasContadas: Array<{
          eanCaixa: string
          produtoId: string
          lote: string
          dataProducao: string | null
          validade: string | null
          pesoKg: number
          pesoBrutoKg: number
          taraId: string | null
          taraKg: number
          qtdPecas: number | null
        }> = []

        for (const { item } of itensEnd) {
          const qtd = toNum(item.qtdContadaCaixas, 0)
          const kg = toNum(item.qtdContadaKg, 0)
          const val = item.validadeContada || item.validade
          if (item.eanCaixa && qtd > 0) {
            const cleanEan = item.eanCaixa.trim()
            const loteItem = item.lote || (item.dataProducaoContada ? gerarLotePorData(item.dataProducaoContada) : '')
            const taraItem = toNum(item.taraKg, 0)
            const brutoItem =
              item.pesoBrutoContadoKg != null
                ? toNum(item.pesoBrutoContadoKg, 0)
                : Number((kg + taraItem).toFixed(3))
            eansContados.add(cleanEan)
            caixasContadas.push({
              eanCaixa: cleanEan,
              produtoId: item.produtoId,
              lote: loteItem,
              dataProducao: item.dataProducaoContada || null,
              validade: val || null,
              pesoKg: kg,
              pesoBrutoKg: brutoItem,
              taraId: item.taraId || null,
              taraKg: taraItem,
              qtdPecas: item.qtdPecasContada,
            })
          }
        }

        if (eansContados.size > 0) {
          const caixasSistema = await tx
            .select({ id: estoqueCaixas.id, eanCaixa: estoqueCaixas.eanCaixa })
            .from(estoqueCaixas)
            .where(
              and(
                eq(estoqueCaixas.tenantId, ctx.tenantId),
                eq(estoqueCaixas.filialId, ctx.filialId),
                eq(estoqueCaixas.endereco, endereco),
                eq(estoqueCaixas.status, 'DISPONIVEL'),
              ),
            )
          for (const cx of caixasSistema) {
            if (!eansContados.has(cx.eanCaixa.trim())) {
              await tx
                .update(estoqueCaixas)
                .set({ endereco: 'PERDIDO', status: 'BLOQUEADO', updatedAt: new Date() })
                .where(eq(estoqueCaixas.id, cx.id))
              await registrarHistoricoCaixa(tx, {
                tenantId: ctx.tenantId,
                caixaId: cx.id,
                eanCaixa: cx.eanCaixa,
                operacao: 'INVENTARIO_PERDA',
                detalhes: `Caixa não encontrada na conciliação do inventário (${inv.nome || inv.id})`,
                operadorNome: ctx.operador.nome,
              })
            }
          }
        }

        for (const cx of caixasContadas) {
          const [existe] = await tx
            .select({ id: estoqueCaixas.id })
            .from(estoqueCaixas)
            .where(
              and(
                eq(estoqueCaixas.tenantId, ctx.tenantId),
                sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${cx.eanCaixa}, '0')`,
              ),
            )
            .limit(1)
          if (existe) {
            await tx
              .update(estoqueCaixas)
              .set({
                endereco,
                lote: cx.lote || undefined,
                dataProducao: cx.dataProducao,
                validade: cx.validade,
                pesoKg: toDec(cx.pesoKg, 3),
                pesoBrutoKg: toDec(cx.pesoBrutoKg, 3),
                taraId: cx.taraId,
                taraKg: toDec(cx.taraKg, 3),
                qtdPecas: cx.qtdPecas,
                status: 'DISPONIVEL',
                updatedAt: new Date(),
              })
              .where(eq(estoqueCaixas.id, existe.id))
          } else {
            await tx.insert(estoqueCaixas).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              eanCaixa: cx.eanCaixa,
              produtoId: cx.produtoId,
              endereco,
              lote: cx.lote,
              dataProducao: cx.dataProducao,
              validade: cx.validade,
              pesoKg: toDec(cx.pesoKg, 3),
              pesoBrutoKg: toDec(cx.pesoBrutoKg, 3),
              taraId: cx.taraId,
              taraKg: toDec(cx.taraKg, 3),
              qtdPecas: cx.qtdPecas,
              origemTipo: 'INVENTARIO',
              operadorCadastroNome: ctx.operador.nome,
              status: 'DISPONIVEL',
            })
          }
        }

        await tx
          .delete(estoquePosicao)
          .where(
            and(
              eq(estoquePosicao.tenantId, ctx.tenantId),
              eq(estoquePosicao.filialId, ctx.filialId),
              eq(estoquePosicao.endereco, endereco),
            ),
          )

        const mapaPos = new Map<
          string,
          { produtoId: string; lote: string; validade: string | null; cxs: number; kg: number }
        >()
        for (const { item } of itensEnd) {
          if (item.produtoId === dummyId) continue
          const qtd = toNum(item.qtdContadaCaixas, 0)
          const kg = toNum(item.qtdContadaKg, 0)
          if (qtd <= 0 && kg <= 0) continue
          const val = item.validadeContada || item.validade || null
          const k = `${item.produtoId}__${item.lote || ''}__${val || ''}`
          const prev = mapaPos.get(k) || {
            produtoId: item.produtoId,
            lote: item.lote || '',
            validade: val,
            cxs: 0,
            kg: 0,
          }
          prev.cxs += qtd
          prev.kg += kg
          mapaPos.set(k, prev)
        }

        if (mapaPos.size > 0) {
          await tx.insert(estoquePosicao).values(
            Array.from(mapaPos.values()).map((p) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              produtoId: p.produtoId,
              endereco,
              lote: p.lote,
              validade: p.validade,
              qtdCaixas: String(p.cxs),
              qtdKg: toDec(p.kg, 3),
              updatedAt: new Date(),
            })),
          )
        }

        for (const { item, valorUnitario } of itensEnd) {
          if (item.statusItem === 'Aguardando Ajuste') {
            const diffCx = toNum(item.qtdContadaCaixas, 0) - toNum(item.qtdSistemaCaixas, 0)
            const diffKg = toNum(item.qtdContadaKg, 0) - toNum(item.qtdSistemaKg, 0)
            const tipoAjuste = diffCx < 0 ? 'Perda' : diffCx > 0 ? 'Sobra' : 'Divergência'

            await tx.insert(inventarioAjustesLog).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              inventarioId: invId,
              cicloId: inv.cicloId,
              itemId: item.id,
              produtoId: item.produtoId,
              endereco,
              lote: item.lote,
              custoUnitarioData: toDec(toNum(valorUnitario, 0), 4),
              qtdAjustadaCaixas: String(diffCx),
              qtdAjustadaKg: toDec(diffKg, 3),
              tipoAjuste,
              usuarioAprovouId: ctx.operador.id,
              usuarioAprovouNome: ctx.operador.nome,
            })
            ajustesCount++
          }
          await tx
            .update(inventarioItens)
            .set({ statusItem: 'OK' })
            .where(eq(inventarioItens.id, item.id))
        }
      }

      await tx
        .update(inventarios)
        .set({ status: 'Finalizado OK', dataFinalizacao: new Date() })
        .where(eq(inventarios.id, invId))

      return ajustesCount
    })

    return { success: true, atualizados }
  })

  app.post(
    '/api/inventario/:id/conciliar-carga-inicial',
    { preHandler: requirePermission('inventario_carga_inicial') },
    async (req) => {
      const ctx = req.authCtx!
      const invId = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')

      const inseridos = await conn.db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(inventarios)
          .where(and(eq(inventarios.id, invId), eq(inventarios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!inv) throw new HttpError(404, 'Inventário não encontrado.')

        const itens = await tx
          .select()
          .from(inventarioItens)
          .where(and(eq(inventarioItens.inventarioId, invId), sql`${inventarioItens.qtdContadaCaixas} > 0`))

        let count = 0
        const ends = new Set<string>()
        for (const item of itens) {
          if (!item.eanCaixa) continue
          ends.add(item.endereco)
          const loteFinal = item.lote || (item.dataProducaoContada ? gerarLotePorData(item.dataProducaoContada) : '')
          const liq = toNum(item.qtdContadaKg, 0)
          const tara = toNum(item.taraKg, 0)
          const bruto =
            item.pesoBrutoContadoKg != null ? toNum(item.pesoBrutoContadoKg, 0) : Number((liq + tara).toFixed(3))

          const [existe] = await tx
            .select({ id: estoqueCaixas.id })
            .from(estoqueCaixas)
            .where(
              and(
                eq(estoqueCaixas.tenantId, ctx.tenantId),
                sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${item.eanCaixa}, '0')`,
              ),
            )
            .limit(1)

          if (!existe) {
            const caixaId = uuidv7()
            await tx.insert(estoqueCaixas).values({
              id: caixaId,
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              eanCaixa: item.eanCaixa,
              produtoId: item.produtoId,
              endereco: item.endereco,
              lote: loteFinal,
              dataProducao: item.dataProducaoContada,
              validade: item.validadeContada || item.validade,
              pesoKg: toDec(liq, 3),
              pesoBrutoKg: toDec(bruto, 3),
              taraId: item.taraId,
              taraKg: toDec(tara, 3),
              qtdPecas: item.qtdPecasContada,
              origemTipo: 'INVENTARIO',
              operadorCadastroNome: ctx.operador.nome,
              status: 'DISPONIVEL',
            })
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId,
              eanCaixa: item.eanCaixa,
              operacao: 'RECEBIMENTO_INVENTARIO',
              detalhes: `Carga Inicial ${item.endereco} • Lote ${loteFinal || '-'} • Líq ${liq.toFixed(2)}kg`,
              operadorNome: ctx.operador.nome,
            })
            count++
          } else {
            await tx
              .update(estoqueCaixas)
              .set({
                endereco: item.endereco,
                status: 'DISPONIVEL',
                lote: loteFinal || undefined,
                dataProducao: item.dataProducaoContada,
                pesoKg: toDec(liq, 3),
                pesoBrutoKg: toDec(bruto, 3),
                taraId: item.taraId,
                taraKg: toDec(tara, 3),
                qtdPecas: item.qtdPecasContada,
                validade: item.validadeContada || item.validade,
                updatedAt: new Date(),
              })
              .where(eq(estoqueCaixas.id, existe.id))
          }
          await tx.update(inventarioItens).set({ statusItem: 'OK' }).where(eq(inventarioItens.id, item.id))
        }

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...ends])
        await tx
          .update(inventarios)
          .set({ status: 'Finalizado OK', dataFinalizacao: new Date() })
          .where(eq(inventarios.id, invId))

        return count
      })

      return { success: true, inseridos }
    },
  )

  app.post('/api/inventario/:id/cancelar', { preHandler: requirePermission('inventario_gestao') }, async (req) => {
    const ctx = req.authCtx!
    const invId = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
    await conn.db
      .update(inventarios)
      .set({ status: 'Cancelado' })
      .where(and(eq(inventarios.id, invId), eq(inventarios.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/inventario/item/:itemId/cancelar', { preHandler: requirePermission('inventario_gestao') }, async (req) => {
    const ctx = req.authCtx!
    const itemId = parseUuidOrBadRequest((req.params as { itemId: string }).itemId, 'item_id')
    await conn.db
      .delete(inventarioItens)
      .where(and(eq(inventarioItens.id, itemId), eq(inventarioItens.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.get(
    '/api/inventario/ajustes-log',
    { preHandler: requirePermission(PERM_INV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { ciclo_id?: string; inventario_id?: string }
      const conds = [eq(inventarioAjustesLog.tenantId, ctx.tenantId)]
      if (q.ciclo_id) conds.push(eq(inventarioAjustesLog.cicloId, parseUuidOrBadRequest(q.ciclo_id, 'ciclo_id')))
      if (q.inventario_id) {
        conds.push(eq(inventarioAjustesLog.inventarioId, parseUuidOrBadRequest(q.inventario_id, 'inventario_id')))
      }

      const rows = await conn.db
        .select({
          id: inventarioAjustesLog.id,
          inventario_id: inventarioAjustesLog.inventarioId,
          ciclo_id: inventarioAjustesLog.cicloId,
          produto_id: inventarioAjustesLog.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          tipo_produto: produtos.tipoProduto,
          endereco: inventarioAjustesLog.endereco,
          lote: inventarioAjustesLog.lote,
          qtd_ajustada_caixas: inventarioAjustesLog.qtdAjustadaCaixas,
          qtd_ajustada_kg: inventarioAjustesLog.qtdAjustadaKg,
          tipo_ajuste: inventarioAjustesLog.tipoAjuste,
          usuario_aprovou_nome: inventarioAjustesLog.usuarioAprovouNome,
          data_ajuste: inventarioAjustesLog.dataAjuste,
        })
        .from(inventarioAjustesLog)
        .innerJoin(produtos, eq(produtos.id, inventarioAjustesLog.produtoId))
        .where(and(...conds))
        .orderBy(desc(inventarioAjustesLog.dataAjuste))
        .limit(500)

      return {
        data: rows.map((r) => ({
          ...r,
          qtd_ajustada_caixas: toNum(r.qtd_ajustada_caixas, 0),
          qtd_ajustada_kg: toNum(r.qtd_ajustada_kg, 0),
        })),
      }
    },
  )
}
