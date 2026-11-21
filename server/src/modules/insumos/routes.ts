import type { FastifyInstance } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  insumosColetas,
  insumosEstoque,
  produtos,
  tenants,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { parseUuidOrBadRequest, toDec, toNum } from '../wms/helpers.js'

const PERM_INSUMOS = ['insumos_coleta', 'compras', 'varejo_acougue', 'producao_entrada', 'movimentacao']

async function lerFlagInsumos(db: any, tenantId: string): Promise<boolean> {
  const [t] = await db
    .select({ featuresJson: tenants.featuresJson })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return Boolean(((t?.featuresJson || {}) as Record<string, unknown>).controlar_estoque_insumos)
}

export function registerInsumosRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── LISTAR ENDEREÇOS E SALDOS DO ALMOXARIFADO DE INSUMOS ────────────────────
  app.get(
    '/api/insumos/estoque',
    { preHandler: requirePermission(PERM_INSUMOS, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { busca?: string; apenas_abaixo_min?: string }

      const [rows, controlarAtivo] = await Promise.all([
        conn.db
          .select({
            id: insumosEstoque.id,
            produto_id: insumosEstoque.produtoId,
            endereco_codigo: insumosEstoque.enderecoCodigo,
            unidade: insumosEstoque.unidade,
            saldo_atual: insumosEstoque.saldoAtual,
            estoque_minimo: insumosEstoque.estoqueMinimo,
            custo_unitario: insumosEstoque.custoUnitario,
            updated_at: insumosEstoque.updatedAt,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            produto_grupo: produtos.grupo,
          })
          .from(insumosEstoque)
          .innerJoin(produtos, eq(produtos.id, insumosEstoque.produtoId))
          .where(and(eq(insumosEstoque.tenantId, ctx.tenantId), eq(insumosEstoque.filialId, ctx.filialId)))
          .orderBy(insumosEstoque.enderecoCodigo),
        lerFlagInsumos(conn.db, ctx.tenantId),
      ])

      const busca = String(q.busca || '').trim().toLowerCase()
      const soAbaixo = q.apenas_abaixo_min === '1' || q.apenas_abaixo_min === 'true'

      const data = rows
        .map((r) => {
          const saldo = toNum(r.saldo_atual, 0)
          const min = toNum(r.estoque_minimo, 0)
          const custo = toNum(r.custo_unitario, 0)
          return {
            id: r.id,
            produto_id: r.produto_id,
            produto_codigo: r.produto_codigo || '',
            produto_descricao: r.produto_descricao,
            produto_grupo: r.produto_grupo || '',
            endereco_codigo: r.endereco_codigo,
            unidade: r.unidade,
            saldo_atual: saldo,
            estoque_minimo: min,
            custo_unitario: custo,
            valor_estoque: Number((saldo * custo).toFixed(2)),
            abaixo_minimo: min > 0 && saldo <= min,
            updated_at: r.updated_at,
          }
        })
        .filter((r) => {
          if (soAbaixo && !r.abaixo_minimo) return false
          if (busca) {
            return (
              r.endereco_codigo.toLowerCase().includes(busca) ||
              r.produto_descricao.toLowerCase().includes(busca) ||
              r.produto_codigo.toLowerCase().includes(busca)
            )
          }
          return true
        })

      return {
        success: true,
        controlar_estoque_insumos: controlarAtivo,
        resumo: {
          total_enderecos: data.length,
          abaixo_minimo: data.filter((d) => d.abaixo_minimo).length,
          valor_total_almoxarifado: Number(data.reduce((s, d) => s + d.valor_estoque, 0).toFixed(2)),
        },
        data,
      }
    },
  )

  // ── CADASTRAR / ATUALIZAR ENDEREÇO DE INSUMO ────────────────────────────────
  app.post(
    '/api/insumos/estoque',
    { preHandler: requirePermission(['insumos_coleta', 'compras']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        produto_id?: string
        endereco_codigo?: string
        unidade?: string
        saldo_inicial?: number
        estoque_minimo?: number
        custo_unitario?: number
      }

      const prodId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
      const endereco = String(body.endereco_codigo || '').trim().toUpperCase()
      if (!endereco) {
        throw new HttpError(400, 'Informe o código do endereço do insumo (ex.: ALM-VACUO-01).')
      }

      const [prod] = await conn.db
        .select()
        .from(produtos)
        .where(and(eq(produtos.id, prodId), eq(produtos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!prod) throw new HttpError(404, 'Produto/Insumo não encontrado no cadastro.')

      const unidade = String(body.unidade || prod.unidade || 'UN').trim().toUpperCase().slice(0, 6)
      const estMin = Math.max(0, Number(body.estoque_minimo || 0))
      const custo =
        body.custo_unitario !== undefined && Number.isFinite(Number(body.custo_unitario))
          ? Math.max(0, Number(body.custo_unitario))
          : toNum(prod.custoMedioKg, 0) || toNum(prod.valorUnitario, 0)

      const out = await conn.db.transaction(async (tx) => {
        const [exist] = await tx
          .select()
          .from(insumosEstoque)
          .where(
            and(
              eq(insumosEstoque.tenantId, ctx.tenantId),
              eq(insumosEstoque.filialId, ctx.filialId),
              eq(insumosEstoque.produtoId, prodId),
            ),
          )
          .limit(1)

        if (exist) {
          const novoSaldo =
            body.saldo_inicial !== undefined && Number.isFinite(Number(body.saldo_inicial))
              ? Math.max(0, Number(body.saldo_inicial))
              : toNum(exist.saldoAtual, 0)
          await tx
            .update(insumosEstoque)
            .set({
              enderecoCodigo: endereco,
              unidade,
              saldoAtual: toDec(novoSaldo, 3),
              estoqueMinimo: toDec(estMin, 3),
              custoUnitario: toDec(custo, 4),
              updatedAt: new Date(),
            })
            .where(eq(insumosEstoque.id, exist.id))
          return { id: exist.id, endereco_codigo: endereco, saldo_atual: novoSaldo }
        }

        const id = uuidv7()
        const saldoIni = Math.max(0, Number(body.saldo_inicial || 0))
        await tx.insert(insumosEstoque).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: prodId,
          enderecoCodigo: endereco,
          unidade,
          saldoAtual: toDec(saldoIni, 3),
          estoqueMinimo: toDec(estMin, 3),
          custoUnitario: toDec(custo, 4),
        })

        if (saldoIni > 0) {
          await tx.insert(insumosColetas).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            insumoEstoqueId: id,
            produtoId: prodId,
            enderecoCodigo: endereco,
            tipo: 'AJUSTE',
            quantidade: toDec(saldoIni, 3),
            saldoAnterior: '0.000',
            saldoNovo: toDec(saldoIni, 3),
            setorDestino: 'ALMOXARIFADO',
            custoTotal: toDec(saldoIni * custo, 2),
            observacao: 'Saldo inicial cadastrado no endereço',
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }

        return { id, endereco_codigo: endereco, saldo_atual: saldoIni }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── BUSCAR ENDEREÇO BIPADO PARA COLETA DE INSUMO ────────────────────────────
  app.get(
    '/api/insumos/buscar-endereco',
    { preHandler: requirePermission(PERM_INSUMOS, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      let codigo = String((req.query as { endereco?: string }).endereco || '').trim().toUpperCase()
      // Aceita também QR Code de etiqueta Zebra 80x45 de Insumo: INS|END=ALM-VACUO-01
      if (codigo.startsWith('INS|')) {
        const part = codigo
          .split('|')
          .find((p) => p.startsWith('END='))
        if (part) codigo = part.slice(4).trim().toUpperCase()
      }
      if (!codigo) throw new HttpError(400, 'Bipe ou digite o endereço do insumo.')

      const [row] = await conn.db
        .select({
          id: insumosEstoque.id,
          produto_id: insumosEstoque.produtoId,
          endereco_codigo: insumosEstoque.enderecoCodigo,
          unidade: insumosEstoque.unidade,
          saldo_atual: insumosEstoque.saldoAtual,
          estoque_minimo: insumosEstoque.estoqueMinimo,
          custo_unitario: insumosEstoque.custoUnitario,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
        })
        .from(insumosEstoque)
        .innerJoin(produtos, eq(produtos.id, insumosEstoque.produtoId))
        .where(
          and(
            eq(insumosEstoque.tenantId, ctx.tenantId),
            eq(insumosEstoque.filialId, ctx.filialId),
            eq(insumosEstoque.enderecoCodigo, codigo),
          ),
        )
        .limit(1)

      if (!row) {
        throw new HttpError(404, `Endereço de insumo "${codigo}" não encontrado nesta filial.`)
      }

      return {
        success: true,
        data: {
          ...row,
          saldo_atual: toNum(row.saldo_atual, 0),
          estoque_minimo: toNum(row.estoque_minimo, 0),
          custo_unitario: toNum(row.custo_unitario, 0),
        },
      }
    },
  )

  // ── REGISTRAR COLETA / RETIRADA MANUAL BIPANDO O ENDEREÇO DO INSUMO ─────────
  app.post(
    '/api/insumos/coletar',
    { preHandler: requirePermission(['insumos_coleta', 'producao_entrada', 'varejo_acougue', 'compras']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        endereco_codigo?: string
        quantidade?: number
        setor_destino?: string
        centro_custo_id?: string | null
        observacao?: string
      }

      let endereco = String(body.endereco_codigo || '').trim().toUpperCase()
      if (endereco.startsWith('INS|')) {
        const part = endereco.split('|').find((p) => p.startsWith('END='))
        if (part) endereco = part.slice(4).trim().toUpperCase()
      }
      if (!endereco) throw new HttpError(400, 'Bipe ou informe o endereço do insumo.')

      const qtd = Number(body.quantidade || 0)
      if (!Number.isFinite(qtd) || qtd <= 0) {
        throw new HttpError(400, 'Informe uma quantidade retirada maior que zero.')
      }

      const out = await conn.db.transaction(async (tx) => {
        const [est] = await tx
          .select({
            id: insumosEstoque.id,
            produtoId: insumosEstoque.produtoId,
            enderecoCodigo: insumosEstoque.enderecoCodigo,
            unidade: insumosEstoque.unidade,
            saldoAtual: insumosEstoque.saldoAtual,
            estoqueMinimo: insumosEstoque.estoqueMinimo,
            custoUnitario: insumosEstoque.custoUnitario,
            produtoDescricao: produtos.descricao,
          })
          .from(insumosEstoque)
          .innerJoin(produtos, eq(produtos.id, insumosEstoque.produtoId))
          .where(
            and(
              eq(insumosEstoque.tenantId, ctx.tenantId),
              eq(insumosEstoque.filialId, ctx.filialId),
              eq(insumosEstoque.enderecoCodigo, endereco),
            ),
          )
          .limit(1)

        if (!est) {
          throw new HttpError(404, `Endereço de insumo "${endereco}" não encontrado nesta filial.`)
        }

        const saldoAnt = toNum(est.saldoAtual, 0)
        if (qtd > saldoAnt + 0.0005) {
          throw new HttpError(
            409,
            `Saldo insuficiente em ${est.enderecoCodigo} (${est.produtoDescricao}). Disponível: ${saldoAnt} ${est.unidade}.`,
          )
        }

        const saldoNovo = Number((saldoAnt - qtd).toFixed(3))
        const custoUnit = toNum(est.custoUnitario, 0)
        const custoTotal = Number((qtd * custoUnit).toFixed(2))
        const estMin = toNum(est.estoqueMinimo, 0)
        const atingiuMinimo = estMin > 0 && saldoNovo <= estMin

        await tx
          .update(insumosEstoque)
          .set({ saldoAtual: toDec(saldoNovo, 3), updatedAt: new Date() })
          .where(eq(insumosEstoque.id, est.id))

        const coletaId = uuidv7()
        const setor = String(body.setor_destino || 'PRODUCAO').trim().toUpperCase()
        const ccId = body.centro_custo_id ? parseUuidOrBadRequest(body.centro_custo_id, 'centro_custo_id') : null

        await tx.insert(insumosColetas).values({
          id: coletaId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          insumoEstoqueId: est.id,
          produtoId: est.produtoId,
          enderecoCodigo: est.enderecoCodigo,
          tipo: 'COLETA_MANUAL',
          quantidade: toDec(qtd, 3),
          saldoAnterior: toDec(saldoAnt, 3),
          saldoNovo: toDec(saldoNovo, 3),
          centroCustoId: ccId,
          setorDestino: setor,
          custoTotal: toDec(custoTotal, 2),
          observacao: String(body.observacao || '').trim(),
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        return {
          id: coletaId,
          endereco_codigo: est.enderecoCodigo,
          produto_descricao: est.produtoDescricao,
          unidade: est.unidade,
          quantidade: qtd,
          saldo_anterior: saldoAnt,
          saldo_novo: saldoNovo,
          custo_total: custoTotal,
          setor_destino: setor,
          alerta_estoque_minimo: atingiuMinimo,
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── ENTRADA / REPOSIÇÃO MANUAL NO ALMOXARIFADO DE INSUMOS ───────────────────
  app.post(
    '/api/insumos/entrada-manual',
    { preHandler: requirePermission(['insumos_coleta', 'compras']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        insumo_estoque_id?: string
        quantidade?: number
        custo_unitario?: number
        observacao?: string
      }
      const id = parseUuidOrBadRequest(body.insumo_estoque_id, 'insumo_estoque_id')
      const qtd = Number(body.quantidade || 0)
      if (!Number.isFinite(qtd) || qtd <= 0) throw new HttpError(400, 'Informe uma quantidade positiva.')

      const out = await conn.db.transaction(async (tx) => {
        const [est] = await tx
          .select()
          .from(insumosEstoque)
          .where(and(eq(insumosEstoque.id, id), eq(insumosEstoque.tenantId, ctx.tenantId)))
          .limit(1)
        if (!est) throw new HttpError(404, 'Registro de insumo não encontrado.')

        const ant = toNum(est.saldoAtual, 0)
        const novo = Number((ant + qtd).toFixed(3))
        const custo =
          body.custo_unitario !== undefined && Number(body.custo_unitario) >= 0
            ? Number(body.custo_unitario)
            : toNum(est.custoUnitario, 0)

        await tx
          .update(insumosEstoque)
          .set({ saldoAtual: toDec(novo, 3), custoUnitario: toDec(custo, 4), updatedAt: new Date() })
          .where(eq(insumosEstoque.id, est.id))

        await tx.insert(insumosColetas).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: est.filialId,
          insumoEstoqueId: est.id,
          produtoId: est.produtoId,
          enderecoCodigo: est.enderecoCodigo,
          tipo: 'ENTRADA_COMPRA',
          quantidade: toDec(qtd, 3),
          saldoAnterior: toDec(ant, 3),
          saldoNovo: toDec(novo, 3),
          setorDestino: 'ALMOXARIFADO',
          custoTotal: toDec(qtd * custo, 2),
          observacao: String(body.observacao || '').trim() || 'Reposição de estoque de insumo',
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        return { id: est.id, saldo_anterior: ant, saldo_novo: novo, custo_unitario: custo }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── HISTÓRICO DE COLETAS & CUSTO POR SETOR ──────────────────────────────────
  app.get(
    '/api/insumos/coletas',
    { preHandler: requirePermission(PERM_INSUMOS, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: insumosColetas.id,
          endereco_codigo: insumosColetas.enderecoCodigo,
          tipo: insumosColetas.tipo,
          quantidade: insumosColetas.quantidade,
          saldo_anterior: insumosColetas.saldoAnterior,
          saldo_novo: insumosColetas.saldoNovo,
          setor_destino: insumosColetas.setorDestino,
          custo_total: insumosColetas.custoTotal,
          observacao: insumosColetas.observacao,
          operador_nome: insumosColetas.operadorNome,
          created_at: insumosColetas.createdAt,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          centro_custo_descricao: centrosCusto.descricao,
        })
        .from(insumosColetas)
        .innerJoin(produtos, eq(produtos.id, insumosColetas.produtoId))
        .leftJoin(centrosCusto, eq(centrosCusto.id, insumosColetas.centroCustoId))
        .where(and(eq(insumosColetas.tenantId, ctx.tenantId), eq(insumosColetas.filialId, ctx.filialId)))
        .orderBy(desc(insumosColetas.createdAt))
        .limit(200)

      const porSetor = new Map<string, { setor: string; qtd_retiradas: number; custo_total: number }>()
      const data = rows.map((r) => {
        const custo = toNum(r.custo_total, 0)
        if (r.tipo === 'COLETA_MANUAL') {
          const cur = porSetor.get(r.setor_destino) || { setor: r.setor_destino, qtd_retiradas: 0, custo_total: 0 }
          cur.qtd_retiradas += 1
          cur.custo_total = Number((cur.custo_total + custo).toFixed(2))
          porSetor.set(r.setor_destino, cur)
        }
        return {
          ...r,
          quantidade: toNum(r.quantidade, 0),
          saldo_anterior: toNum(r.saldo_anterior, 0),
          saldo_novo: toNum(r.saldo_novo, 0),
          custo_total: custo,
        }
      })

      return {
        success: true,
        resumo_setores: Array.from(porSetor.values()).sort((a, b) => b.custo_total - a.custo_total),
        data,
      }
    },
  )
}
