import type { FastifyInstance } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DbConnection } from '../../db/client.js'
import {
  clientes,
  mapasProducao,
  mapasProducaoItens,
  opItensPrevistos,
  ordensProducao,
  pendenciasSetor,
  produtoArvore,
  produtos,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { calcularDemandaEMateriasPrimas } from '../wms/demandaHelper.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  normalizarDataIso,
  parseUuidOrBadRequest,
  toDec,
  toNum,
} from '../wms/helpers.js'

const PERM_MAPA_READ = ['mapa_producao', 'producao_criar_op', 'retorno_producao', 'pedidos', 'produtos']
const PERM_MAPA_WRITE = ['mapa_producao', 'producao_criar_op']

interface MapaItemInput {
  produto_id: string
  materia_prima_id?: string | null
  cliente_id?: string | null
  especificacao?: string
  conservacao?: string
  qtd_prevista_kg: number
  qtd_mp_kg?: number
  ordem?: number
}

export function registerMapaProducaoRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // Demanda consolidada dos pedidos em aberto -> Cortes a produzir x MP via Árvore
  app.get(
    '/api/mapas-producao/demanda-pedidos',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as {
        data_inicio?: string
        data_fim?: string
        grupo?: string
        incluir_rascunho?: string
      }
      const res = await calcularDemandaEMateriasPrimas(conn.db, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        dataInicio: q.data_inicio,
        dataFim: q.data_fim,
        grupo: q.grupo,
        incluirRascunho: q.incluir_rascunho === 'true',
      })
      return { success: true, ...res }
    },
  )

  app.get(
    '/api/mapas-producao',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: mapasProducao.id,
          codigo: mapasProducao.codigo,
          data_mapa: mapasProducao.dataMapa,
          status: mapasProducao.status,
          observacoes: mapasProducao.observacoes,
          created_at: mapasProducao.createdAt,
          qtd_itens: sql<number>`(SELECT COUNT(*)::int FROM mapas_producao_itens mpi WHERE mpi.mapa_id = ${mapasProducao.id})`,
          total_previsto_kg: sql<string>`COALESCE((SELECT ROUND(SUM(mpi.qtd_prevista_kg), 3) FROM mapas_producao_itens mpi WHERE mpi.mapa_id = ${mapasProducao.id}), 0)`,
          total_mp_kg: sql<string>`COALESCE((SELECT ROUND(SUM(mpi.qtd_mp_kg), 3) FROM mapas_producao_itens mpi WHERE mpi.mapa_id = ${mapasProducao.id}), 0)`,
          qtd_ops: sql<number>`(SELECT COUNT(*)::int FROM ordens_producao op WHERE op.mapa_id = ${mapasProducao.id})`,
        })
        .from(mapasProducao)
        .where(and(eq(mapasProducao.tenantId, ctx.tenantId), eq(mapasProducao.filialId, ctx.filialId)))
        .orderBy(desc(mapasProducao.dataMapa), desc(mapasProducao.createdAt))

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          total_previsto_kg: toNum(r.total_previsto_kg, 0),
          total_mp_kg: toNum(r.total_mp_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/mapas-producao/:id',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
      const [mapa] = await conn.db
        .select()
        .from(mapasProducao)
        .where(and(eq(mapasProducao.id, id), eq(mapasProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!mapa) throw new HttpError(404, 'Mapa de Produção não encontrado.')

      const prodCorte = alias(produtos, 'prod_corte')
      const prodMp = alias(produtos, 'prod_mp')

      const [itens, ops] = await Promise.all([
        conn.db
          .select({
            id: mapasProducaoItens.id,
            produto_id: mapasProducaoItens.produtoId,
            produto_codigo: prodCorte.codigo,
            produto_descricao: prodCorte.descricao,
            grupo: prodCorte.grupo,
            materia_prima_id: mapasProducaoItens.materiaPrimaId,
            materia_prima_codigo: prodMp.codigo,
            materia_prima_descricao: prodMp.descricao,
            cliente_id: mapasProducaoItens.clienteId,
            cliente_nome: clientes.nomeFantasia,
            especificacao: mapasProducaoItens.especificacao,
            conservacao: mapasProducaoItens.conservacao,
            qtd_prevista_kg: mapasProducaoItens.qtdPrevistaKg,
            qtd_mp_kg: mapasProducaoItens.qtdMpKg,
            ordem: mapasProducaoItens.ordem,
          })
          .from(mapasProducaoItens)
          .innerJoin(prodCorte, eq(prodCorte.id, mapasProducaoItens.produtoId))
          .leftJoin(prodMp, eq(prodMp.id, mapasProducaoItens.materiaPrimaId))
          .leftJoin(clientes, eq(clientes.id, mapasProducaoItens.clienteId))
          .where(eq(mapasProducaoItens.mapaId, id))
          .orderBy(mapasProducaoItens.ordem),
        conn.db
          .select({
            id: ordensProducao.id,
            codigo: ordensProducao.codigo,
            nome: ordensProducao.nome,
            status: ordensProducao.status,
            data_producao: ordensProducao.dataProducao,
          })
          .from(ordensProducao)
          .where(and(eq(ordensProducao.mapaId, id), eq(ordensProducao.tenantId, ctx.tenantId))),
      ])

      return {
        success: true,
        data: {
          ...mapa,
          data_mapa: mapa.dataMapa,
          itens: itens.map((it) => ({
            ...it,
            qtd_prevista_kg: toNum(it.qtd_prevista_kg, 0),
            qtd_mp_kg: toNum(it.qtd_mp_kg, 0),
          })),
          ops,
        },
      }
    },
  )

  app.post('/api/mapas-producao', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = (req.body || {}) as {
      data_mapa?: string
      observacoes?: string
      puxar_pedidos?: boolean
      data_inicio?: string
      data_fim?: string
      grupo?: string
      itens?: MapaItemInput[]
    }

    const dataMapa = normalizarDataIso(body.data_mapa) || hojeIsoLocal()

    const created = await conn.db.transaction(async (tx) => {
      let itensFinais: MapaItemInput[] = Array.isArray(body.itens) ? body.itens : []
      if (body.puxar_pedidos && itensFinais.length === 0) {
        const dem = await calcularDemandaEMateriasPrimas(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          dataInicio: body.data_inicio,
          dataFim: body.data_fim,
          grupo: body.grupo,
        })
        itensFinais = dem.cortes
          .filter((c) => c.deficit_produzir_kg > 0)
          .map((c, idx) => ({
            produto_id: c.produto_id,
            materia_prima_id: c.materia_prima_id,
            cliente_id: c.clientes.length === 1 ? c.clientes[0].cliente_id : null,
            especificacao: c.especificacao,
            conservacao: c.conservacao,
            qtd_prevista_kg: c.deficit_produzir_kg,
            qtd_mp_kg: c.qtd_mp_necessaria_kg,
            ordem: idx + 1,
          }))
      }

      if (itensFinais.length === 0) {
        throw new HttpError(400, 'Nenhum corte para incluir no Mapa de Produção.')
      }

      const arvRows = await tx
        .select()
        .from(produtoArvore)
        .where(eq(produtoArvore.tenantId, ctx.tenantId))
      const arvMap = new Map<string, { paiId: string; rend: number }>()
      for (const a of arvRows) {
        const r = toNum(a.rendimentoAprendidoPct ?? a.rendimentoEsperadoPct, 100)
        const rend = r > 5 && r <= 100 ? r : 100
        if (!arvMap.has(a.filhoId) || a.confirmado === 1) {
          arvMap.set(a.filhoId, { paiId: a.paiId, rend })
        }
      }

      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'MAPA_PRODUCAO', 'MAP', 4)
      const mapaId = uuidv7()

      await tx.insert(mapasProducao).values({
        id: mapaId,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        dataMapa,
        status: 'ABERTO',
        observacoes: String(body.observacoes || '').trim(),
      })

      await tx.insert(mapasProducaoItens).values(
        itensFinais.map((it, idx) => {
          const pid = parseUuidOrBadRequest(it.produto_id, 'produto_id')
          const qtdPrev = Math.max(0.001, toNum(it.qtd_prevista_kg, 0))
          const vinc = arvMap.get(pid)
          const mpId = it.materia_prima_id
            ? parseUuidOrBadRequest(it.materia_prima_id, 'materia_prima_id')
            : vinc?.paiId || null
          const qtdMp =
            it.qtd_mp_kg != null && toNum(it.qtd_mp_kg, 0) > 0
              ? toNum(it.qtd_mp_kg, 0)
              : mpId
                ? Number((qtdPrev / ((vinc?.rend || 100) / 100)).toFixed(3))
                : qtdPrev

          return {
            id: uuidv7(),
            tenantId: ctx.tenantId,
            mapaId,
            produtoId: pid,
            materiaPrimaId: mpId,
            clienteId: it.cliente_id ? parseUuidOrBadRequest(it.cliente_id, 'cliente_id') : null,
            especificacao: String(it.especificacao || '').trim(),
            conservacao: String(it.conservacao || 'RESFRIADO').trim().toUpperCase(),
            qtdPrevistaKg: toDec(qtdPrev, 3),
            qtdMpKg: toDec(qtdMp, 3),
            ordem: it.ordem ?? idx + 1,
          }
        }),
      )

      return { id: mapaId, codigo, data_mapa: dataMapa, qtd_itens: itensFinais.length }
    })

    return reply.status(201).send({ success: true, ...created })
  })

  // Gera OPs reais no WMS agrupando os cortes do Mapa por Matéria-Prima (ou Grupo/Único)
  app.post('/api/mapas-producao/:id/gerar-ops', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req, reply) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    const body = (req.body || {}) as { agrupar_por?: 'MP' | 'GRUPO' | 'UNICO' }
    const modo = body.agrupar_por || 'MP'

    const resOps = await conn.db.transaction(async (tx) => {
      const [mapa] = await tx
        .select()
        .from(mapasProducao)
        .where(and(eq(mapasProducao.id, mapaId), eq(mapasProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!mapa) throw new HttpError(404, 'Mapa de Produção não encontrado.')

      const prodCorte = alias(produtos, 'pc')
      const prodMp = alias(produtos, 'pm')
      const itens = await tx
        .select({
          id: mapasProducaoItens.id,
          produtoId: mapasProducaoItens.produtoId,
          materiaPrimaId: mapasProducaoItens.materiaPrimaId,
          especificacao: mapasProducaoItens.especificacao,
          conservacao: mapasProducaoItens.conservacao,
          qtdPrevistaKg: mapasProducaoItens.qtdPrevistaKg,
          qtdMpKg: mapasProducaoItens.qtdMpKg,
          corteDesc: prodCorte.descricao,
          corteGrupo: prodCorte.grupo,
          mpDesc: prodMp.descricao,
        })
        .from(mapasProducaoItens)
        .innerJoin(prodCorte, eq(prodCorte.id, mapasProducaoItens.produtoId))
        .leftJoin(prodMp, eq(prodMp.id, mapasProducaoItens.materiaPrimaId))
        .where(eq(mapasProducaoItens.mapaId, mapaId))

      if (itens.length === 0) throw new HttpError(400, 'Mapa sem itens para gerar OPs.')

      const grupos = new Map<string, { label: string; rows: typeof itens }>()
      for (const it of itens) {
        const key =
          modo === 'UNICO'
            ? 'UNICO'
            : modo === 'GRUPO'
              ? String(it.corteGrupo || 'GERAL').toUpperCase()
              : it.materiaPrimaId || `CORTE_${it.produtoId}`
        const label =
          modo === 'UNICO'
            ? 'Mapa Completo'
            : modo === 'GRUPO'
              ? String(it.corteGrupo || 'GERAL').toUpperCase()
              : it.mpDesc || it.corteDesc
        const g = grupos.get(key) || { label, rows: [] }
        g.rows.push(it)
        grupos.set(key, g)
      }

      const opsCriadas: Array<{ id: string; codigo: string; nome: string }> = []
      for (const grp of grupos.values()) {
        const opCodigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'OP', 'OP', 3)
        const opId = uuidv7()
        const opNome = `${mapa.codigo} — ${grp.label}`

        await tx.insert(ordensProducao).values({
          id: opId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          mapaId,
          codigo: opCodigo,
          nome: opNome,
          status: 'LIBERADA',
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          cliente: 'MAPA DIÁRIO',
          endereco: 'PRODUCAO',
          dataProducao: mapa.dataMapa,
          observacoes: `Gerada automaticamente do ${mapa.codigo}.`,
          criadoPorId: ctx.operador.id,
          criadoPorNome: ctx.operador.nome,
          liberadaEm: new Date(),
        })

        // Consolidar entradas (MPs) e saídas (cortes)
        const mpSum = new Map<string, number>()
        const saidaRows: Array<typeof opItensPrevistos.$inferInsert> = []
        for (const r of grp.rows) {
          if (r.materiaPrimaId) {
            mpSum.set(
              r.materiaPrimaId,
              Number(((mpSum.get(r.materiaPrimaId) || 0) + toNum(r.qtdMpKg, 0)).toFixed(3)),
            )
          }
          saidaRows.push({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            opId,
            tipo: 'SAIDA',
            produtoId: r.produtoId,
            pesoKgPrevisto: toDec(toNum(r.qtdPrevistaKg, 0), 3),
            unidadePrevista: 'KG',
            observacao: [r.conservacao, r.especificacao].filter(Boolean).join(' • '),
          })
        }

        const entradaRows: Array<typeof opItensPrevistos.$inferInsert> = Array.from(mpSum.entries()).map(
          ([mpId, kgMp]) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            opId,
            tipo: 'ENTRADA',
            produtoId: mpId,
            pesoKgPrevisto: toDec(kgMp, 3),
            unidadePrevista: 'KG',
            observacao: `MP programada via ${mapa.codigo}`,
          }),
        )

        await tx.insert(opItensPrevistos).values([...entradaRows, ...saidaRows])
        await tx.insert(pendenciasSetor).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          setorDestino: 'PCP',
          tipoPendencia: 'OP_DE_MAPA',
          referenciaTabela: 'ordens_producao',
          referenciaId: opId,
          titulo: `Produção ${opCodigo} (${opNome})`,
          prioridade: 2,
          status: 'PENDENTE',
        })

        opsCriadas.push({ id: opId, codigo: opCodigo, nome: opNome })
      }

      await tx.update(mapasProducao).set({ status: 'EM_PRODUCAO' }).where(eq(mapasProducao.id, mapaId))
      return opsCriadas
    })

    return reply.status(201).send({ success: true, ops: resOps })
  })

  // ── ÁRVORE AUTO-APRENDIZ (BOM) ──────────────────────────────────────────────
  app.get(
    '/api/arvore-produtos',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const pPai = alias(produtos, 'pai')
      const pFilho = alias(produtos, 'filho')

      const rows = await conn.db
        .select({
          id: produtoArvore.id,
          pai_id: produtoArvore.paiId,
          pai_codigo: pPai.codigo,
          pai_descricao: pPai.descricao,
          filho_id: produtoArvore.filhoId,
          filho_codigo: pFilho.codigo,
          filho_descricao: pFilho.descricao,
          filho_grupo: pFilho.grupo,
          rendimento_esperado_pct: produtoArvore.rendimentoEsperadoPct,
          rendimento_aprendido_pct: produtoArvore.rendimentoAprendidoPct,
          amostras_aprendizado: produtoArvore.amostrasAprendizado,
          origem_vinculo: produtoArvore.origemVinculo,
          confirmado: produtoArvore.confirmado,
          created_at: produtoArvore.createdAt,
        })
        .from(produtoArvore)
        .innerJoin(pPai, eq(pPai.id, produtoArvore.paiId))
        .innerJoin(pFilho, eq(pFilho.id, produtoArvore.filhoId))
        .where(eq(produtoArvore.tenantId, ctx.tenantId))
        .orderBy(produtoArvore.confirmado, desc(produtoArvore.amostrasAprendizado))

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          rendimento_esperado_pct:
            r.rendimento_esperado_pct != null ? toNum(r.rendimento_esperado_pct, 0) : null,
          rendimento_aprendido_pct:
            r.rendimento_aprendido_pct != null ? toNum(r.rendimento_aprendido_pct, 0) : null,
        })),
      }
    },
  )

  app.post('/api/arvore-produtos', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = (req.body || {}) as {
      pai_id: string
      filho_id: string
      rendimento_esperado_pct?: number | null
    }
    const paiId = parseUuidOrBadRequest(body.pai_id, 'pai_id')
    const filhoId = parseUuidOrBadRequest(body.filho_id, 'filho_id')
    if (paiId === filhoId) throw new HttpError(400, 'Produto pai e filho devem ser diferentes.')

    const rend =
      body.rendimento_esperado_pct != null && toNum(body.rendimento_esperado_pct, 0) > 0
        ? toDec(Math.min(100, toNum(body.rendimento_esperado_pct, 0)), 2)
        : null

    const [exist] = await conn.db
      .select()
      .from(produtoArvore)
      .where(
        and(
          eq(produtoArvore.tenantId, ctx.tenantId),
          eq(produtoArvore.paiId, paiId),
          eq(produtoArvore.filhoId, filhoId),
        ),
      )
      .limit(1)

    if (exist) {
      await conn.db
        .update(produtoArvore)
        .set({ rendimentoEsperadoPct: rend, origemVinculo: 'MANUAL', confirmado: 1 })
        .where(eq(produtoArvore.id, exist.id))
      return { success: true, id: exist.id }
    }

    const id = uuidv7()
    await conn.db.insert(produtoArvore).values({
      id,
      tenantId: ctx.tenantId,
      paiId,
      filhoId,
      rendimentoEsperadoPct: rend,
      origemVinculo: 'MANUAL',
      confirmado: 1,
    })
    return reply.status(201).send({ success: true, id })
  })

  app.post(
    '/api/arvore-produtos/:id/confirmar',
    { preHandler: requirePermission(PERM_MAPA_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'vinculo_id')
      const body = (req.body || {}) as { rendimento_esperado_pct?: number | null }

      const [arv] = await conn.db
        .select()
        .from(produtoArvore)
        .where(and(eq(produtoArvore.id, id), eq(produtoArvore.tenantId, ctx.tenantId)))
        .limit(1)
      if (!arv) throw new HttpError(404, 'Vínculo da árvore não encontrado.')

      const rendDefinido =
        body.rendimento_esperado_pct != null && toNum(body.rendimento_esperado_pct, 0) > 0
          ? toDec(Math.min(100, toNum(body.rendimento_esperado_pct, 0)), 2)
          : arv.rendimentoAprendidoPct || arv.rendimentoEsperadoPct

      await conn.db
        .update(produtoArvore)
        .set({
          confirmado: 1,
          rendimentoEsperadoPct: rendDefinido,
        })
        .where(eq(produtoArvore.id, id))

      return { success: true, rendimento_esperado_pct: rendDefinido ? Number(rendDefinido) : null }
    },
  )

  app.delete('/api/arvore-produtos/:id', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'vinculo_id')
    await conn.db
      .delete(produtoArvore)
      .where(and(eq(produtoArvore.id, id), eq(produtoArvore.tenantId, ctx.tenantId)))
    return { success: true }
  })
}
