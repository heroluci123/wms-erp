import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  caixasHistorico,
  estoqueCaixas,
  opInsumos,
  opItensPrevistos,
  opRetornos,
  ordensProducao,
  paletes,
  produtoArvore,
  produtos,
  taras,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  gerarLotePorData,
  gerarProximosEansInternos,
  hojeIsoLocal,
  normalizeCaixaRow,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  resolverTaraPeso,
  toDec,
  toNum,
  validarPesagemTaraPayload,
} from '../wms/helpers.js'

const PERM_OP_READ = [
  'retorno_producao',
  'producao_entrada',
  'producao_saida',
  'producao_criar_op',
  'relatorios_producao',
]

export function registerProducaoRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  app.get(
    '/api/ops',
    { preHandler: requirePermission(PERM_OP_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const status = String((req.query as { status?: string }).status || 'TODAS').trim()

      const rows = await conn.db
        .select({
          id: ordensProducao.id,
          codigo: ordensProducao.codigo,
          nome: ordensProducao.nome,
          status: ordensProducao.status,
          operador_nome: ordensProducao.operadorNome,
          criado_por_nome: ordensProducao.criadoPorNome,
          cliente: ordensProducao.cliente,
          endereco: ordensProducao.endereco,
          data_producao: ordensProducao.dataProducao,
          observacoes: ordensProducao.observacoes,
          rendimento_pct: ordensProducao.rendimentoPct,
          perda_pct: ordensProducao.perdaPct,
          reaberta: ordensProducao.reaberta,
          liberada_em: ordensProducao.liberadaEm,
          created_at: ordensProducao.createdAt,
          updated_at: ordensProducao.updatedAt,
          qtd_insumos: sql<number>`(SELECT COUNT(*)::int FROM op_insumos oi WHERE oi.op_id = "ordens_producao"."id")`,
          peso_insumos: sql<string>`COALESCE((SELECT SUM(oi.peso_kg) FROM op_insumos oi WHERE oi.op_id = "ordens_producao"."id"), 0)`,
          qtd_retornos: sql<number>`(SELECT COUNT(*)::int FROM op_retornos oret WHERE oret.op_id = "ordens_producao"."id")`,
          peso_retornos: sql<string>`COALESCE((SELECT SUM(oret.peso_kg) FROM op_retornos oret WHERE oret.op_id = "ordens_producao"."id"), 0)`,
          qtd_prev_entrada: sql<number>`(SELECT COUNT(*)::int FROM op_itens_previstos oip WHERE oip.op_id = "ordens_producao"."id" AND oip.tipo = 'ENTRADA')`,
          qtd_prev_saida: sql<number>`(SELECT COUNT(*)::int FROM op_itens_previstos oip WHERE oip.op_id = "ordens_producao"."id" AND oip.tipo = 'SAIDA')`,
        })
        .from(ordensProducao)
        .where(
          and(
            eq(ordensProducao.tenantId, ctx.tenantId),
            eq(ordensProducao.filialId, ctx.filialId),
            status === 'ATIVAS'
              ? sql`${ordensProducao.status} IN ('RASCUNHO', 'LIBERADA', 'ABERTA')`
              : status === 'EXECUTAVEIS' || status === 'ABERTA'
                ? sql`${ordensProducao.status} IN ('LIBERADA', 'ABERTA')`
                : status && status !== 'TODAS'
                  ? eq(ordensProducao.status, status)
                  : sql`TRUE`,
          ),
        )
        .orderBy(desc(ordensProducao.createdAt))
        .limit(200)

      return {
        data: rows.map((r) => ({
          ...r,
          peso_insumos: toNum(r.peso_insumos, 0),
          peso_retornos: toNum(r.peso_retornos, 0),
          rendimento_pct: r.rendimento_pct != null ? toNum(r.rendimento_pct, 0) : null,
          perda_pct: r.perda_pct != null ? toNum(r.perda_pct, 0) : null,
        })),
      }
    },
  )

  app.get(
    '/api/ops/produtos-saldo',
    { preHandler: requirePermission([...PERM_OP_READ, 'produtos'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: produtos.id,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          unidade: produtos.unidade,
          grupo: produtos.grupo,
          tipo_produto: produtos.tipoProduto,
          classificacao: produtos.classificacao,
          saldo_caixas: sql<number>`COUNT(${estoqueCaixas.id})::int`,
          saldo_kg: sql<string>`COALESCE(SUM(${estoqueCaixas.pesoKg}), 0)`,
        })
        .from(produtos)
        .leftJoin(
          estoqueCaixas,
          and(
            eq(estoqueCaixas.produtoId, produtos.id),
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            eq(estoqueCaixas.status, 'DISPONIVEL'),
          ),
        )
        .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.ativo, 1)))
        .groupBy(produtos.id)
        .orderBy(produtos.descricao)

      return {
        data: rows.map((r) => ({ ...r, saldo_kg: toNum(r.saldo_kg, 0) })),
      }
    },
  )

  app.get(
    '/api/ops/dossies',
    {
      preHandler: requirePermission(['relatorios_producao', 'retorno_producao', 'producao_criar_op'], {
        write: false,
        bloquearCliente: false,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const modoCliente = ctx.operador.nivel === 'CLIENTE'
      const q = req.query as {
        dataInicio?: string
        dataFim?: string
        cliente?: string
        endereco?: string
        opId?: string
      }

      const conds = [
        eq(ordensProducao.tenantId, ctx.tenantId),
        eq(ordensProducao.filialId, ctx.filialId),
      ]
      if (modoCliente) conds.push(eq(ordensProducao.status, 'FECHADA'))
      if (q.opId) {
        conds.push(eq(ordensProducao.id, parseUuidOrBadRequest(q.opId, 'opId')))
      } else if (q.dataInicio && q.dataFim) {
        conds.push(
          sql`DATE(COALESCE(${ordensProducao.dataProducao}, ${ordensProducao.createdAt}::date)) BETWEEN ${q.dataInicio} AND ${q.dataFim}`,
        )
      }
      if (q.cliente && q.cliente !== 'TODOS') conds.push(eq(ordensProducao.cliente, q.cliente))
      if (q.endereco && q.endereco !== 'TODOS') conds.push(eq(ordensProducao.endereco, q.endereco))

      const ops = await conn.db
        .select()
        .from(ordensProducao)
        .where(and(...conds))
        .orderBy(desc(ordensProducao.createdAt))
        .limit(100)

      if (ops.length === 0) return { data: [] }

      const opIds = ops.map((o) => o.id)
      const [insumos, retornos, previstos] = await Promise.all([
        conn.db
          .select({
            op_id: opInsumos.opId,
            item_id: opInsumos.id,
            caixa_id: opInsumos.caixaId,
            peso_kg: opInsumos.pesoKg,
            peso_bruto_kg: opInsumos.pesoBrutoKg,
            tara_kg: opInsumos.taraKg,
            qtd_pecas: opInsumos.qtdPecas,
            data_producao: opInsumos.dataProducao,
            lote: opInsumos.lote,
            ean_caixa: estoqueCaixas.eanCaixa,
            validade: estoqueCaixas.validade,
            produto_id: produtos.id,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            produto_grupo: produtos.grupo,
          })
          .from(opInsumos)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, opInsumos.caixaId))
          .innerJoin(produtos, eq(produtos.id, opInsumos.produtoId))
          .where(inArray(opInsumos.opId, opIds)),
        conn.db
          .select({
            op_id: opRetornos.opId,
            item_id: opRetornos.id,
            caixa_id: opRetornos.caixaId,
            peso_kg: opRetornos.pesoKg,
            peso_bruto_kg: opRetornos.pesoBrutoKg,
            tara_kg: opRetornos.taraKg,
            qtd_pecas: opRetornos.qtdPecas,
            data_producao: opRetornos.dataProducao,
            validade: opRetornos.validade,
            lote: opRetornos.lote,
            ean_caixa: estoqueCaixas.eanCaixa,
            produto_id: produtos.id,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            produto_grupo: produtos.grupo,
          })
          .from(opRetornos)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, opRetornos.caixaId))
          .innerJoin(produtos, eq(produtos.id, opRetornos.produtoId))
          .where(inArray(opRetornos.opId, opIds)),
        conn.db
          .select({
            op_id: opItensPrevistos.opId,
            tipo: opItensPrevistos.tipo,
            produto_id: opItensPrevistos.produtoId,
            qtd_caixas_prevista: opItensPrevistos.qtdCaixasPrevista,
            peso_kg_previsto: opItensPrevistos.pesoKgPrevisto,
            unidade_prevista: opItensPrevistos.unidadePrevista,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
          })
          .from(opItensPrevistos)
          .innerJoin(produtos, eq(produtos.id, opItensPrevistos.produtoId))
          .where(inArray(opItensPrevistos.opId, opIds)),
      ])

      const data = ops.map((op) => {
        const ins = insumos
          .filter((i) => i.op_id === op.id)
          .map((i) => ({
            ...i,
            peso_kg: toNum(i.peso_kg, 0),
            peso_bruto_kg: toNum(i.peso_bruto_kg, 0),
            tara_kg: toNum(i.tara_kg, 0),
          }))
        const rets = retornos
          .filter((r) => r.op_id === op.id)
          .map((r) => ({
            ...r,
            peso_kg: toNum(r.peso_kg, 0),
            peso_bruto_kg: toNum(r.peso_bruto_kg, 0),
            tara_kg: toNum(r.tara_kg, 0),
          }))
        const prev = previstos.filter((p) => p.op_id === op.id)
        return {
          id: op.id,
          codigo: op.codigo,
          nome: op.nome,
          status: op.status,
          cliente: op.cliente,
          endereco: op.endereco,
          data_producao: op.dataProducao || op.createdAt.toISOString().slice(0, 10),
          operador_nome: modoCliente ? null : op.operadorNome,
          criado_por_nome: modoCliente ? null : op.criadoPorNome || op.operadorNome,
          observacoes: op.observacoes,
          rendimento_pct: op.rendimentoPct != null ? toNum(op.rendimentoPct, 0) : null,
          perda_pct: op.perdaPct != null ? toNum(op.perdaPct, 0) : null,
          insumos: ins,
          retornos: rets,
          previstos_entrada: prev.filter((p) => p.tipo === 'ENTRADA'),
          previstos_saida: prev.filter((p) => p.tipo === 'SAIDA'),
          peso_insumos: ins.reduce((acc, i) => acc + i.peso_kg, 0),
          peso_retornos: rets.reduce((acc, r) => acc + r.peso_kg, 0),
        }
      })

      return { data }
    },
  )

  app.post('/api/ops', { preHandler: requirePermission('producao_criar_op') }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = req.body as {
      nome?: string
      cliente?: string
      endereco?: string
      data_producao?: string
      observacoes?: string
      status?: 'RASCUNHO' | 'LIBERADA' | 'ABERTA'
      itensPrevistos?: Array<{
        tipo: 'ENTRADA' | 'SAIDA'
        produto_id: string
        qtd_caixas_prevista?: number | null
        peso_kg_previsto?: number | null
        unidade_prevista?: 'KG' | 'CX'
        observacao?: string
      }>
    }

    const itens = Array.isArray(body.itensPrevistos) ? body.itensPrevistos : []
    if (!itens.some((i) => i.tipo === 'ENTRADA')) {
      throw new HttpError(400, 'É obrigatório informar ao menos 1 Matéria-Prima de ENTRADA para criar uma OP.')
    }

    const op = await conn.db.transaction(async (tx) => {
      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'OP', 'OP', 3)
      const id = uuidv7()
      const statusInicial = body.status || 'LIBERADA'
      const dataProd = body.data_producao || hojeIsoLocal()

      await tx.insert(ordensProducao).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        nome: (body.nome || '').trim() || `OP ${codigo}`,
        status: statusInicial,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
        cliente: (body.cliente || 'INTERNO').trim() || 'INTERNO',
        endereco: (body.endereco || 'PRODUCAO').trim().toUpperCase() || 'PRODUCAO',
        dataProducao: dataProd,
        observacoes: (body.observacoes || '').trim(),
        criadoPorId: ctx.operador.id,
        criadoPorNome: ctx.operador.nome,
        liberadaEm: statusInicial === 'LIBERADA' ? new Date() : null,
      })

      if (itens.length > 0) {
        await tx.insert(opItensPrevistos).values(
          itens.map((it) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            opId: id,
            tipo: it.tipo === 'SAIDA' ? 'SAIDA' : 'ENTRADA',
            produtoId: parseUuidOrBadRequest(it.produto_id, 'produto_id'),
            qtdCaixasPrevista:
              it.qtd_caixas_prevista != null ? String(toNum(it.qtd_caixas_prevista, 0)) : null,
            pesoKgPrevisto:
              it.peso_kg_previsto != null ? toDec(toNum(it.peso_kg_previsto, 0), 3) : null,
            unidadePrevista: it.unidade_prevista === 'CX' ? 'CX' : 'KG',
            observacao: (it.observacao || '').trim(),
          })),
        )
      }

      return { id, codigo, status: statusInicial }
    })

    return reply.code(201).send({ success: true, ...op })
  })

  app.put('/api/ops/:id', { preHandler: requirePermission('producao_criar_op') }, async (req) => {
    const ctx = req.authCtx!
    const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')
    const body = req.body as {
      nome?: string
      data_producao?: string
      observacoes?: string
      status?: string
      itensPrevistos?: Array<{
        tipo: 'ENTRADA' | 'SAIDA'
        produto_id: string
        qtd_caixas_prevista?: number | null
        peso_kg_previsto?: number | null
        unidade_prevista?: 'KG' | 'CX'
        observacao?: string
      }>
    }

    await conn.db.transaction(async (tx) => {
      const [op] = await tx
        .select()
        .from(ordensProducao)
        .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!op) throw new HttpError(404, 'Ordem de produção não encontrada.')

      const novoStatus = body.status || op.status
      await tx
        .update(ordensProducao)
        .set({
          nome: body.nome != null ? body.nome.trim() : op.nome,
          dataProducao: body.data_producao ?? op.dataProducao,
          observacoes: body.observacoes != null ? body.observacoes.trim() : op.observacoes,
          status: novoStatus,
          liberadaEm:
            novoStatus === 'LIBERADA' && !op.liberadaEm ? new Date() : op.liberadaEm,
          updatedAt: new Date(),
        })
        .where(eq(ordensProducao.id, opId))

      if (Array.isArray(body.itensPrevistos)) {
        if (!body.itensPrevistos.some((i) => i.tipo === 'ENTRADA')) {
          throw new HttpError(400, 'A Ordem de Produção deve possuir ao menos 1 Matéria-Prima de ENTRADA.')
        }
        await tx.delete(opItensPrevistos).where(eq(opItensPrevistos.opId, opId))
        if (body.itensPrevistos.length > 0) {
          await tx.insert(opItensPrevistos).values(
            body.itensPrevistos.map((it) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              opId,
              tipo: it.tipo === 'SAIDA' ? 'SAIDA' : 'ENTRADA',
              produtoId: parseUuidOrBadRequest(it.produto_id, 'produto_id'),
              qtdCaixasPrevista:
                it.qtd_caixas_prevista != null ? String(toNum(it.qtd_caixas_prevista, 0)) : null,
              pesoKgPrevisto:
                it.peso_kg_previsto != null ? toDec(toNum(it.peso_kg_previsto, 0), 3) : null,
              unidadePrevista: it.unidade_prevista === 'CX' ? 'CX' : 'KG',
              observacao: (it.observacao || '').trim(),
            })),
          )
        }
      }
    })

    return { success: true }
  })

  app.post('/api/ops/:id/liberar', { preHandler: requirePermission('producao_criar_op') }, async (req) => {
    const ctx = req.authCtx!
    const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')
    await conn.db
      .update(ordensProducao)
      .set({ status: 'LIBERADA', liberadaEm: new Date(), updatedAt: new Date() })
      .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.get(
    '/api/ops/:id',
    { preHandler: requirePermission(PERM_OP_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')

      const [op] = await conn.db
        .select()
        .from(ordensProducao)
        .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!op) throw new HttpError(404, 'Ordem de Produção não encontrada.')

      const [previstos, insumos, retornos] = await Promise.all([
        conn.db
          .select({
            id: opItensPrevistos.id,
            op_id: opItensPrevistos.opId,
            tipo: opItensPrevistos.tipo,
            produto_id: opItensPrevistos.produtoId,
            qtd_caixas_prevista: opItensPrevistos.qtdCaixasPrevista,
            peso_kg_previsto: opItensPrevistos.pesoKgPrevisto,
            unidade_prevista: opItensPrevistos.unidadePrevista,
            observacao: opItensPrevistos.observacao,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            unidade: produtos.unidade,
          })
          .from(opItensPrevistos)
          .innerJoin(produtos, eq(produtos.id, opItensPrevistos.produtoId))
          .where(eq(opItensPrevistos.opId, opId)),
        conn.db
          .select({
            id: opInsumos.id,
            op_id: opInsumos.opId,
            caixa_id: opInsumos.caixaId,
            produto_id: opInsumos.produtoId,
            peso_kg: opInsumos.pesoKg,
            peso_bruto_kg: opInsumos.pesoBrutoKg,
            tara_kg: opInsumos.taraKg,
            data_producao: opInsumos.dataProducao,
            lote: opInsumos.lote,
            qtd_pecas: opInsumos.qtdPecas,
            operador_nome: opInsumos.operadorNome,
            ean_caixa: estoqueCaixas.eanCaixa,
            validade: estoqueCaixas.validade,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            created_at: opInsumos.createdAt,
          })
          .from(opInsumos)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, opInsumos.caixaId))
          .innerJoin(produtos, eq(produtos.id, opInsumos.produtoId))
          .where(eq(opInsumos.opId, opId))
          .orderBy(desc(opInsumos.createdAt)),
        conn.db
          .select({
            id: opRetornos.id,
            op_id: opRetornos.opId,
            caixa_id: opRetornos.caixaId,
            produto_id: opRetornos.produtoId,
            peso_kg: opRetornos.pesoKg,
            peso_bruto_kg: opRetornos.pesoBrutoKg,
            tara_id: opRetornos.taraId,
            tara_kg: opRetornos.taraKg,
            tara_nome: taras.nome,
            data_producao: opRetornos.dataProducao,
            validade: opRetornos.validade,
            lote: opRetornos.lote,
            qtd_pecas: opRetornos.qtdPecas,
            operador_nome: opRetornos.operadorNome,
            ean_caixa: estoqueCaixas.eanCaixa,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            created_at: opRetornos.createdAt,
          })
          .from(opRetornos)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, opRetornos.caixaId))
          .innerJoin(produtos, eq(produtos.id, opRetornos.produtoId))
          .leftJoin(taras, eq(taras.id, opRetornos.taraId))
          .where(eq(opRetornos.opId, opId))
          .orderBy(desc(opRetornos.createdAt)),
      ])

      const insNorm = insumos.map((i) => ({
        ...i,
        peso_kg: toNum(i.peso_kg, 0),
        peso_bruto_kg: toNum(i.peso_bruto_kg, toNum(i.peso_kg, 0)),
        tara_kg: toNum(i.tara_kg, 0),
      }))
      const retNorm = retornos.map((r) => ({
        ...r,
        peso_kg: toNum(r.peso_kg, 0),
        peso_bruto_kg: toNum(r.peso_bruto_kg, toNum(r.peso_kg, 0)),
        tara_kg: toNum(r.tara_kg, 0),
      }))

      return {
        data: {
          id: op.id,
          codigo: op.codigo,
          nome: op.nome,
          status: op.status,
          cliente: op.cliente,
          endereco: op.endereco,
          data_producao: op.dataProducao || op.createdAt.toISOString().slice(0, 10),
          observacoes: op.observacoes,
          rendimento_pct: op.rendimentoPct != null ? toNum(op.rendimentoPct, 0) : null,
          perda_pct: op.perdaPct != null ? toNum(op.perdaPct, 0) : null,
          previstos_entrada: previstos.filter((p) => p.tipo === 'ENTRADA'),
          previstos_saida: previstos.filter((p) => p.tipo === 'SAIDA'),
          insumos: insNorm,
          retornos: retNorm,
          peso_insumos: insNorm.reduce((s, i) => s + i.peso_kg, 0),
          peso_retornos: retNorm.reduce((s, r) => s + r.peso_kg, 0),
          peso_retornos_bruto: retNorm.reduce((s, r) => s + r.peso_bruto_kg, 0),
        },
      }
    },
  )

  app.post(
    '/api/ops/:id/entrar-caixa',
    { preHandler: requirePermission(['producao_entrada', 'retorno_producao']) },
    async (req) => {
      const ctx = req.authCtx!
      const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')
      const body = req.body as { ean?: string; forcarConfirmacao?: boolean }
      const cleanEan = String(body.ean || '').trim()
      if (!cleanEan) {
        return { success: false, code: 'VAZIO', error: 'Informe ou bipe o EAN da caixa de entrada.' }
      }

      const outcome = await conn.db.transaction(async (tx) => {
        const [op] = await tx
          .select()
          .from(ordensProducao)
          .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
          .limit(1)
        if (!op) {
          return { success: false, code: 'OP_NAO_ENCONTRADA', error: 'Ordem de Produção não encontrada.' }
        }
        if (!['LIBERADA', 'ABERTA'].includes(op.status)) {
          return {
            success: false,
            code: 'OP_FECHADA',
            error: `OP ${op.codigo} está com status "${op.status}" e não aceita novas entradas.`,
          }
        }

        const caixaRes = await tx.execute(sql`
          SELECT ec.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, pal.endereco_atual AS palete_endereco
          FROM estoque_caixas ec
          JOIN produtos p ON p.id = ec.produto_id
          LEFT JOIN paletes pal ON pal.id = ec.palete_id
          WHERE ec.tenant_id = ${ctx.tenantId} AND ec.filial_id = ${ctx.filialId}
            AND LTRIM(ec.ean_caixa, '0') = LTRIM(${cleanEan}, '0')
          LIMIT 1
          FOR UPDATE OF ec
        `)
        const cRaw = caixaRes.rows[0] as
          | {
              id: string
              ean_caixa: string
              produto_id: string
              produto_codigo: string
              produto_descricao: string
              palete_id: string | null
              palete_endereco: string | null
              endereco: string | null
              lote: string
              data_producao: string | null
              validade: string | null
              peso_kg: string
              peso_bruto_kg: string | null
              tara_kg: string
              qtd_pecas: number | null
              status: string
              cliente_reservado_nome: string | null
              pedido_reservado_codigo: string | null
            }
          | undefined

        if (!cRaw) {
          return {
            success: false,
            code: 'NAO_ENCONTRADA',
            error: `Caixa com EAN "${cleanEan}" não encontrada no estoque.`,
          }
        }

        const insAtuais = await tx
          .select({ caixaId: opInsumos.caixaId, produtoId: opInsumos.produtoId })
          .from(opInsumos)
          .where(eq(opInsumos.opId, opId))

        if (insAtuais.some((r) => r.caixaId === cRaw.id)) {
          return {
            success: false,
            code: 'DUPLICADA',
            error: `A caixa ${cRaw.ean_caixa} (${cRaw.produto_descricao}) já foi bipada nesta OP.`,
          }
        }

        if (cRaw.status !== 'DISPONIVEL') {
          const extra = cRaw.cliente_reservado_nome
            ? ` — reservada para ${cRaw.cliente_reservado_nome} (${cRaw.pedido_reservado_codigo || ''})`
            : ''
          return {
            success: false,
            code: 'INDISPONIVEL',
            error: `Caixa não está DISPONÍVEL para entrada na OP (Status atual: ${cRaw.status}${extra}).`,
          }
        }

        const previstos = await tx
          .select()
          .from(opItensPrevistos)
          .where(and(eq(opItensPrevistos.opId, opId), eq(opItensPrevistos.tipo, 'ENTRADA')))

        const prevMatch = previstos.find((p) => p.produtoId === cRaw.produto_id) || null
        const foraPrevisto = previstos.length > 0 && !prevMatch

        const temCapCaixas = Boolean(
          prevMatch &&
            prevMatch.qtdCaixasPrevista != null &&
            toNum(prevMatch.qtdCaixasPrevista) > 0 &&
            (prevMatch.unidadePrevista === 'CX' || !prevMatch.pesoKgPrevisto),
        )
        if (temCapCaixas && prevMatch) {
          const limiteCx = Math.trunc(toNum(prevMatch.qtdCaixasPrevista))
          const bipadas = insAtuais.filter((r) => r.produtoId === cRaw.produto_id).length
          if (bipadas >= limiteCx) {
            return {
              success: false,
              code: 'LIMITE_ATINGIDO',
              error: `Limite previsto atingido para ${cRaw.produto_descricao}: ${bipadas}/${limiteCx} caixa(s) já bipada(s).`,
            }
          }
        }

        if (!body.forcarConfirmacao) {
          let avisoFefo = null
          if (cRaw.validade) {
            const [older] = await tx
              .select({
                id: estoqueCaixas.id,
                ean_caixa: estoqueCaixas.eanCaixa,
                endereco: estoqueCaixas.endereco,
                validade: estoqueCaixas.validade,
                lote: estoqueCaixas.lote,
                produto_descricao: produtos.descricao,
              })
              .from(estoqueCaixas)
              .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
              .where(
                and(
                  eq(estoqueCaixas.tenantId, ctx.tenantId),
                  eq(estoqueCaixas.filialId, ctx.filialId),
                  eq(estoqueCaixas.produtoId, cRaw.produto_id),
                  eq(estoqueCaixas.status, 'DISPONIVEL'),
                  sql`${estoqueCaixas.validade} IS NOT NULL AND ${estoqueCaixas.validade} < ${cRaw.validade}`,
                ),
              )
              .orderBy(estoqueCaixas.validade)
              .limit(1)
            avisoFefo = older || null
          }

          if (avisoFefo || foraPrevisto) {
            return {
              success: false,
              requiresConfirmation: true,
              caixa: normalizeCaixaRow(cRaw),
              avisoFefo,
              foraPrevisto,
            }
          }
        }

        const endOrig = cRaw.endereco || cRaw.palete_endereco || 'REC'
        const loteCaixa = cRaw.lote || (cRaw.data_producao ? gerarLotePorData(cRaw.data_producao) : '')
        const taraCaixa = toNum(cRaw.tara_kg, 0)
        const pesoCaixa = toNum(cRaw.peso_kg, 0)
        const brutoCaixa =
          cRaw.peso_bruto_kg != null ? toNum(cRaw.peso_bruto_kg, 0) : Number((pesoCaixa + taraCaixa).toFixed(3))

        await tx
          .update(estoqueCaixas)
          .set({
            status: 'RESERVADA',
            endereco: op.codigo,
            paleteId: null,
            updatedAt: new Date(),
          })
          .where(and(eq(estoqueCaixas.id, cRaw.id), eq(estoqueCaixas.status, 'DISPONIVEL')))

        const insumoId = uuidv7()
        await tx.insert(opInsumos).values({
          id: insumoId,
          tenantId: ctx.tenantId,
          opId,
          caixaId: cRaw.id,
          produtoId: cRaw.produto_id,
          pesoKg: toDec(pesoCaixa, 3),
          pesoBrutoKg: toDec(brutoCaixa, 3),
          taraKg: toDec(taraCaixa, 3),
          dataProducao: cRaw.data_producao,
          lote: loteCaixa,
          qtdPecas: cRaw.qtd_pecas,
          operadorNome: ctx.operador.nome,
        })

        if (cRaw.palete_id) {
          await tx
            .update(paletes)
            .set({ status: 'FECHADO' })
            .where(and(eq(paletes.id, cRaw.palete_id), eq(paletes.status, 'FINALIZADO')))
        }

        await registrarMovimentacaoLog(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: cRaw.produto_id,
          enderecoOrigem: endOrig,
          enderecoDestino: op.codigo,
          lote: loteCaixa,
          qtdCaixas: 1,
          qtdKg: pesoCaixa,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          tipo: 'TRANSFERENCIA',
        })

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: cRaw.id,
          eanCaixa: cRaw.ean_caixa,
          operacao: 'ALOCADA_PRODUCAO',
          detalhes: `Entrada na OP ${op.codigo} • Lote ${loteCaixa || '-'} • Líq ${pesoCaixa.toFixed(2)}kg`,
          operadorNome: ctx.operador.nome,
        })

        if (op.status === 'LIBERADA') {
          await tx
            .update(ordensProducao)
            .set({ status: 'ABERTA', updatedAt: new Date() })
            .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.status, 'LIBERADA')))
        }

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [endOrig, op.codigo])

        return {
          success: true,
          insumo_id: insumoId,
          caixa: normalizeCaixaRow({ ...cRaw, endereco: op.codigo, lote: loteCaixa }),
        }
      })

      return outcome
    },
  )

  app.post(
    '/api/ops/:id/retorno',
    { preHandler: requirePermission(['producao_saida', 'retorno_producao']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')
      const body = req.body as {
        produto_id: string
        peso_bruto_kg: number
        tara_id?: string | null
        tara_kg?: number
        data_producao?: string
        validade?: string
        qtd_pecas: number
        ean_caixa?: string
      }

      const produtoId = parseUuidOrBadRequest(body.produto_id, 'produto_id')

      const retornoCriado = await conn.db.transaction(async (tx) => {
        const [op] = await tx
          .select()
          .from(ordensProducao)
          .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
          .limit(1)
        if (!op) throw new HttpError(404, 'Ordem de Produção não encontrada.')
        if (!['LIBERADA', 'ABERTA'].includes(op.status)) {
          throw new HttpError(409, `OP ${op.codigo} com status ${op.status} não aceita retorno.`)
        }

        const [prod] = await tx
          .select({ id: produtos.id, codigo: produtos.codigo, descricao: produtos.descricao })
          .from(produtos)
          .where(and(eq(produtos.id, produtoId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto de retorno não encontrado.')

        const { taraId, taraKg } = await resolverTaraPeso(tx, ctx.tenantId, body.tara_id, body.tara_kg)
        const pesagem = validarPesagemTaraPayload({
          data_producao: body.data_producao || op.dataProducao || hojeIsoLocal(),
          validade: body.validade,
          peso_bruto_kg: body.peso_bruto_kg,
          tara_id: taraId,
          tara_kg: taraKg,
          qtd_pecas: body.qtd_pecas,
          exigirValidade: false,
          exigirTara: false,
          exigirQtdPecas: true,
        })

        const eanFinal =
          body.ean_caixa && String(body.ean_caixa).trim()
            ? String(body.ean_caixa).trim()
            : (await gerarProximosEansInternos(tx, ctx.tenantId, 1, prod.codigo || ''))[0]

        const caixaId = uuidv7()
        const enderecoRetorno = op.endereco || 'PRODUCAO'

        await tx.insert(estoqueCaixas).values({
          id: caixaId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          eanCaixa: eanFinal,
          produtoId: prod.id,
          endereco: enderecoRetorno,
          lote: pesagem.lote,
          dataProducao: pesagem.dataProducao,
          validade: pesagem.validade,
          pesoBrutoKg: toDec(pesagem.pesoBrutoKg, 3),
          taraId: pesagem.taraId,
          taraKg: toDec(pesagem.taraKg, 3),
          pesoKg: toDec(pesagem.pesoLiquidoKg, 3),
          qtdPecas: pesagem.qtdPecas,
          origemTipo: 'OP',
          opId,
          operadorCadastroNome: ctx.operador.nome,
          status: 'DISPONIVEL',
        })

        const retornoId = uuidv7()
        await tx.insert(opRetornos).values({
          id: retornoId,
          tenantId: ctx.tenantId,
          opId,
          caixaId,
          produtoId: prod.id,
          pesoKg: toDec(pesagem.pesoLiquidoKg, 3),
          pesoBrutoKg: toDec(pesagem.pesoBrutoKg, 3),
          taraId: pesagem.taraId,
          taraKg: toDec(pesagem.taraKg, 3),
          dataProducao: pesagem.dataProducao,
          validade: pesagem.validade,
          lote: pesagem.lote,
          qtdPecas: pesagem.qtdPecas,
          operadorNome: ctx.operador.nome,
        })

        if (op.status === 'LIBERADA') {
          await tx
            .update(ordensProducao)
            .set({ status: 'ABERTA', updatedAt: new Date() })
            .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.status, 'LIBERADA')))
        }

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId,
          eanCaixa: eanFinal,
          operacao: 'RETORNO_PRODUCAO',
          detalhes: `Retorno da OP ${op.codigo} • Lote ${pesagem.lote || '-'} • ${pesagem.qtdPecas} pç • Bruto ${pesagem.pesoBrutoKg.toFixed(2)}kg | Tara ${pesagem.taraKg.toFixed(3)}kg | Líq ${pesagem.pesoLiquidoKg.toFixed(2)}kg`,
          operadorNome: ctx.operador.nome,
        })

        await registrarMovimentacaoLog(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: prod.id,
          enderecoOrigem: op.codigo,
          enderecoDestino: enderecoRetorno,
          lote: pesagem.lote,
          qtdCaixas: 1,
          qtdKg: pesagem.pesoLiquidoKg,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          tipo: 'PRODUCAO',
        })

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [enderecoRetorno])

        return {
          retorno_id: retornoId,
          caixa_id: caixaId,
          ean_caixa: eanFinal,
          produto_id: prod.id,
          produto_codigo: prod.codigo,
          produto_descricao: prod.descricao,
          endereco: enderecoRetorno,
          lote: pesagem.lote,
          data_producao: pesagem.dataProducao,
          validade: pesagem.validade,
          peso_bruto_kg: pesagem.pesoBrutoKg,
          tara_kg: pesagem.taraKg,
          peso_kg: pesagem.pesoLiquidoKg,
          qtd_pecas: pesagem.qtdPecas,
        }
      })

      return reply.code(201).send({ success: true, retorno: retornoCriado })
    },
  )

  app.delete(
    '/api/ops/:id/item/:tipo/:itemId',
    { preHandler: requirePermission(['producao_entrada', 'producao_saida', 'producao_criar_op', 'retorno_producao']) },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; tipo: string; itemId: string }
      const opId = parseUuidOrBadRequest(p.id, 'op_id')
      const itemId = parseUuidOrBadRequest(p.itemId, 'item_id')
      const tipo = p.tipo.trim().toUpperCase()

      await conn.db.transaction(async (tx) => {
        const [op] = await tx
          .select({ codigo: ordensProducao.codigo, endereco: ordensProducao.endereco })
          .from(ordensProducao)
          .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
          .limit(1)
        if (!op) throw new HttpError(404, 'OP não encontrada.')

        if (tipo === 'INSUMO') {
          const [ins] = await tx
            .select()
            .from(opInsumos)
            .where(and(eq(opInsumos.id, itemId), eq(opInsumos.opId, opId)))
            .limit(1)
          if (!ins || !ins.caixaId) throw new HttpError(404, 'Insumo não encontrado nesta OP.')

          const [cx] = await tx
            .select()
            .from(estoqueCaixas)
            .where(eq(estoqueCaixas.id, ins.caixaId))
            .limit(1)

          await tx.delete(opInsumos).where(eq(opInsumos.id, itemId))
          await tx
            .update(estoqueCaixas)
            .set({ status: 'DISPONIVEL', updatedAt: new Date() })
            .where(eq(estoqueCaixas.id, ins.caixaId))

          if (cx) {
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId: cx.id,
              eanCaixa: cx.eanCaixa,
              operacao: 'ESTORNO_INSUMO',
              detalhes: `Removida da OP ${op.codigo} e devolvida como disponível`,
              operadorNome: ctx.operador.nome,
            })
            await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [cx.endereco || op.codigo])
          }
        } else if (tipo === 'RETORNO') {
          const [ret] = await tx
            .select()
            .from(opRetornos)
            .where(and(eq(opRetornos.id, itemId), eq(opRetornos.opId, opId)))
            .limit(1)
          if (!ret || !ret.caixaId) throw new HttpError(404, 'Retorno não encontrado nesta OP.')

          const [cx] = await tx
            .select()
            .from(estoqueCaixas)
            .where(eq(estoqueCaixas.id, ret.caixaId))
            .limit(1)
          if (cx && cx.status !== 'DISPONIVEL') {
            throw new HttpError(409, `Não é possível remover retorno pois a caixa está ${cx.status}.`)
          }

          await tx.delete(opRetornos).where(eq(opRetornos.id, itemId))
          if (cx) {
            await tx.update(caixasHistorico).set({ caixaId: null }).where(eq(caixasHistorico.caixaId, cx.id))
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId: null,
              eanCaixa: cx.eanCaixa,
              operacao: 'ESTORNO_RETORNO',
              detalhes: `Caixa excluída (Estorno saída da OP ${op.codigo})`,
              operadorNome: ctx.operador.nome,
            })
            await tx.delete(estoqueCaixas).where(eq(estoqueCaixas.id, cx.id))
            await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [cx.endereco || op.endereco])
          }
        } else {
          throw new HttpError(400, 'Tipo deve ser INSUMO ou RETORNO.')
        }
      })

      return { success: true }
    },
  )

  app.post('/api/ops/:id/finalizar', { preHandler: requirePermission('producao_criar_op') }, async (req) => {
    const ctx = req.authCtx!
    const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')

    const resumo = await conn.db.transaction(async (tx) => {
      const [op] = await tx
        .select()
        .from(ordensProducao)
        .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!op) throw new HttpError(404, 'Ordem de Produção não encontrada.')

      const insumos = await tx
        .select({
          caixaId: opInsumos.caixaId,
          produtoId: estoqueCaixas.produtoId,
          endereco: estoqueCaixas.endereco,
          pesoKg: estoqueCaixas.pesoKg,
          classificacao: produtos.classificacao,
        })
        .from(opInsumos)
        .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, opInsumos.caixaId))
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .where(eq(opInsumos.opId, opId))

      const retornos = await tx
        .select({
          produtoId: estoqueCaixas.produtoId,
          pesoKg: estoqueCaixas.pesoKg,
          classificacao: produtos.classificacao,
        })
        .from(opRetornos)
        .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, opRetornos.caixaId))
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .where(eq(opRetornos.opId, opId))

      const totalInsumos = insumos.reduce((sum, i) => sum + toNum(i.pesoKg, 0), 0)
      const totalRetornos = retornos.reduce((sum, r) => sum + toNum(r.pesoKg, 0), 0)

      const rendimentoPct =
        totalInsumos > 0 ? Number(((totalRetornos / totalInsumos) * 100).toFixed(2)) : null
      const perdaPct = rendimentoPct != null ? Number((100 - rendimentoPct).toFixed(2)) : null

      await tx
        .update(ordensProducao)
        .set({
          status: 'FECHADA',
          rendimentoPct: rendimentoPct != null ? toDec(rendimentoPct, 2) : null,
          perdaPct: perdaPct != null ? toDec(perdaPct, 2) : null,
          updatedAt: new Date(),
        })
        .where(eq(ordensProducao.id, opId))

      const caixaIdsInsumos = insumos.map((i) => i.caixaId).filter(Boolean) as string[]
      if (caixaIdsInsumos.length > 0) {
        await tx
          .update(estoqueCaixas)
          .set({ status: 'CONSUMIDA', updatedAt: new Date() })
          .where(inArray(estoqueCaixas.id, caixaIdsInsumos))
      }

      // Aprender árvore de produtos automaticamente (matéria-prima dominante -> cortes produzidos)
      const insumosPorProd = new Map<string, { peso: number; classificacao: string | null }>()
      for (const i of insumos) {
        const cur = insumosPorProd.get(i.produtoId) || { peso: 0, classificacao: i.classificacao }
        cur.peso += toNum(i.pesoKg, 0)
        if (!cur.classificacao) {
          await tx
            .update(produtos)
            .set({ classificacao: 'MATERIA_PRIMA' })
            .where(eq(produtos.id, i.produtoId))
          cur.classificacao = 'MATERIA_PRIMA'
        }
        insumosPorProd.set(i.produtoId, cur)
      }

      let maiorMpId: string | null = null
      let maiorMpPeso = 0
      let maiorAnyId: string | null = null
      let maiorAnyPeso = 0
      for (const [pid, info] of insumosPorProd.entries()) {
        if (info.classificacao === 'MATERIA_PRIMA' && info.peso > maiorMpPeso) {
          maiorMpPeso = info.peso
          maiorMpId = pid
        }
        if (info.peso > maiorAnyPeso) {
          maiorAnyPeso = info.peso
          maiorAnyId = pid
        }
      }

      const paiId = maiorMpId || maiorAnyId
      if (paiId && totalInsumos > 0) {
        const retsPorProd = new Map<string, { peso: number; classificacao: string | null }>()
        for (const r of retornos) {
          const cur = retsPorProd.get(r.produtoId) || { peso: 0, classificacao: r.classificacao }
          cur.peso += toNum(r.pesoKg, 0)
          retsPorProd.set(r.produtoId, cur)
        }

        for (const [filhoId, rInfo] of retsPorProd.entries()) {
          if (!rInfo.classificacao) {
            await tx
              .update(produtos)
              .set({ classificacao: 'SUBPRODUTO' })
              .where(eq(produtos.id, filhoId))
          }
          if (filhoId === paiId) continue

          const pctAmostra = Number(((rInfo.peso / totalInsumos) * 100).toFixed(2))
          const [arv] = await tx
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

          if (!arv) {
            await tx.insert(produtoArvore).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              paiId,
              filhoId,
              rendimentoAprendidoPct: toDec(pctAmostra, 2),
              amostrasAprendizado: 1,
              origemVinculo: 'OP_AUTO',
              confirmado: 0,
            })
          } else {
            const n = Math.max(0, Number(arv.amostrasAprendizado || 0))
            const mediaAnt = toNum(arv.rendimentoAprendidoPct, pctAmostra)
            const novaMedia = Number(((mediaAnt * n + pctAmostra) / (n + 1)).toFixed(2))
            await tx
              .update(produtoArvore)
              .set({
                rendimentoAprendidoPct: toDec(novaMedia, 2),
                amostrasAprendizado: n + 1,
              })
              .where(eq(produtoArvore.id, arv.id))
          }
        }
      }

      const ends = [op.codigo, op.endereco, ...insumos.map((i) => i.endereco)]
      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, ends)

      return {
        rendimento_pct: rendimentoPct,
        perda_pct: perdaPct,
        total_insumos_kg: Number(totalInsumos.toFixed(3)),
        total_retornos_kg: Number(totalRetornos.toFixed(3)),
      }
    })

    return { success: true, ...resumo }
  })

  app.post('/api/ops/:id/cancelar', { preHandler: requirePermission('producao_criar_op') }, async (req) => {
    const ctx = req.authCtx!
    const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')

    await conn.db.transaction(async (tx) => {
      const [op] = await tx
        .select({ id: ordensProducao.id })
        .from(ordensProducao)
        .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!op) throw new HttpError(404, 'OP não encontrada.')

      const ins = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(opInsumos)
        .where(eq(opInsumos.opId, opId))
      const ret = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(opRetornos)
        .where(eq(opRetornos.opId, opId))
      if (Number(ins[0]?.count || 0) > 0 || Number(ret[0]?.count || 0) > 0) {
        throw new HttpError(409, 'OP possui apontamentos. Estorne os itens antes de cancelar.')
      }

      await tx
        .update(ordensProducao)
        .set({ status: 'CANCELADA', updatedAt: new Date() })
        .where(eq(ordensProducao.id, opId))
    })

    return { success: true }
  })

  app.post('/api/ops/:id/reabrir', { preHandler: requirePermission('producao_criar_op') }, async (req) => {
    const ctx = req.authCtx!
    const opId = parseUuidOrBadRequest((req.params as { id: string }).id, 'op_id')

    await conn.db.transaction(async (tx) => {
      const [op] = await tx
        .select()
        .from(ordensProducao)
        .where(and(eq(ordensProducao.id, opId), eq(ordensProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!op) throw new HttpError(404, 'OP não encontrada.')

      await tx
        .update(ordensProducao)
        .set({
          status: 'ABERTA',
          reaberta: 1,
          rendimentoPct: null,
          perdaPct: null,
          updatedAt: new Date(),
        })
        .where(eq(ordensProducao.id, opId))

      const ins = await tx
        .select({ caixaId: opInsumos.caixaId })
        .from(opInsumos)
        .where(eq(opInsumos.opId, opId))
      const caixaIds = ins.map((i) => i.caixaId).filter(Boolean) as string[]
      if (caixaIds.length > 0) {
        await tx
          .update(estoqueCaixas)
          .set({ status: 'RESERVADA', updatedAt: new Date() })
          .where(inArray(estoqueCaixas.id, caixaIds))
      }
    })

    return { success: true }
  })
}
