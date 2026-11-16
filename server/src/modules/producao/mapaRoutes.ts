import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DbConnection } from '../../db/client.js'
import {
  clientes,
  mapaEspecificacoesPadrao,
  mapaProgramacaoSemanal,
  mapasProducao,
  mapasProducaoItens,
  opItensPrevistos,
  ordensProducao,
  pedidos,
  pedidosItens,
  pendenciasSetor,
  produtoArvore,
  produtos,
  romaneios,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { calcularDemandaEMateriasPrimas } from '../wms/demandaHelper.js'
import {
  carregarMapasEspecificacoes,
  resolverEspecificacaoParaItem,
  upsertEspecificacaoMapa,
} from './mapaHelpers.js'
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

function fmtDataBrIso(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

interface MapaItemInput {
  produto_id: string
  materia_prima_id?: string | null
  cliente_id?: string | null
  pedido_id?: string | null
  pedido_item_id?: string | null
  pedido_codigo?: string
  previsao_entrega?: string | null
  grupo_mapa?: string
  especificacao?: string
  conservacao?: string
  observacao?: string
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

  // Itens de pedidos abertos disponíveis para seleção manual ("Selecionar Itens dos Pedidos")
  app.get(
    '/api/mapas-producao/itens-pedidos-disponiveis',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { previsao_entrega?: string; q?: string; mapa_id?: string }
      const filtroData = normalizarDataIso(q.previsao_entrega)
      const busca = String(q.q || '').trim().toUpperCase()
      const mapaIdAtual = q.mapa_id ? parseUuidOrBadRequest(q.mapa_id, 'mapa_id') : null

      const statusAtivos = ['RASCUNHO', 'BLOQUEADO_ESTOQUE', 'LIBERADO', 'EM_SEPARACAO', 'AGUARDANDO_PRODUCAO']
      const rows = await conn.db
        .select({
          pedido_item_id: pedidosItens.id,
          pedido_id: pedidos.id,
          pedido_codigo: pedidos.codigo,
          pedido_status: pedidos.status,
          previsao_entrega: pedidos.previsaoEntrega,
          cliente_id: pedidos.clienteId,
          cliente_nome: pedidos.cliente,
          produto_id: produtos.id,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          produto_grupo: produtos.grupo,
          qtd_kg_solicitada: pedidosItens.qtdKgSolicitada,
          observacao_item: pedidosItens.observacao,
        })
        .from(pedidosItens)
        .innerJoin(pedidos, eq(pedidos.id, pedidosItens.pedidoId))
        .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
        .where(
          and(
            eq(pedidos.tenantId, ctx.tenantId),
            eq(pedidos.filialId, ctx.filialId),
            inArray(pedidos.status, statusAtivos),
          ),
        )
        .orderBy(asc(produtos.descricao), asc(pedidos.previsaoEntrega), asc(pedidos.codigo))

      const datasDisponiveis = Array.from(
        new Set(rows.map((r) => r.previsao_entrega).filter((d): d is string => Boolean(d))),
      ).sort()

      const prodIds = Array.from(new Set(rows.map((r) => r.produto_id)))
      const pedidoIds = Array.from(new Set(rows.map((r) => r.pedido_id)))

      const [especCache, emMapasRows, romsRows] = await Promise.all([
        carregarMapasEspecificacoes(conn.db, { tenantId: ctx.tenantId, produtoIds: prodIds }),
        conn.db
          .select({
            pedido_item_id: mapasProducaoItens.pedidoItemId,
            mapa_id: mapasProducao.id,
            mapa_codigo: mapasProducao.codigo,
          })
          .from(mapasProducaoItens)
          .innerJoin(mapasProducao, eq(mapasProducao.id, mapasProducaoItens.mapaId))
          .where(
            and(
              eq(mapasProducao.tenantId, ctx.tenantId),
              inArray(mapasProducao.status, ['ABERTO', 'EM_PRODUCAO']),
            ),
          ),
        pedidoIds.length > 0
          ? conn.db
              .select({ pedido_id: romaneios.pedidoId, status: romaneios.status })
              .from(romaneios)
              .where(and(eq(romaneios.tenantId, ctx.tenantId), inArray(romaneios.pedidoId, pedidoIds)))
          : Promise.resolve([]),
      ])

      const mapaPorItem = new Map<string, { mapa_id: string; mapa_codigo: string }[]>()
      for (const m of emMapasRows) {
        if (!m.pedido_item_id) continue
        const arr = mapaPorItem.get(m.pedido_item_id) || []
        arr.push({ mapa_id: m.mapa_id, mapa_codigo: m.mapa_codigo })
        mapaPorItem.set(m.pedido_item_id, arr)
      }
      const emEmbarqueSet = new Set(
        romsRows.filter((r) => r.pedido_id && r.status !== 'CANCELADO').map((r) => r.pedido_id!),
      )

      const filtrados = rows.filter((r) => {
        if (filtroData && r.previsao_entrega !== filtroData) return false
        if (busca) {
          const alvo = `${r.produto_codigo || ''} ${r.produto_descricao} ${r.cliente_nome} ${r.pedido_codigo}`.toUpperCase()
          if (!alvo.includes(busca)) return false
        }
        return true
      })

      const porProduto = new Map<
        string,
        {
          produto_id: string
          produto_codigo: string
          produto_descricao: string
          produto_grupo: string
          total_kg: number
          itens: Array<Record<string, unknown>>
        }
      >()

      for (const r of filtrados) {
        const resEsp = resolverEspecificacaoParaItem(especCache, {
          produtoId: r.produto_id,
          clienteId: r.cliente_id,
          grupoProduto: r.produto_grupo,
          observacaoItem: r.observacao_item,
        })
        const refs = mapaPorItem.get(r.pedido_item_id) || []
        const noMapaAtual = Boolean(mapaIdAtual && refs.some((x) => x.mapa_id === mapaIdAtual))
        const outro = refs.find((x) => !mapaIdAtual || x.mapa_id !== mapaIdAtual)
        const kg = toNum(r.qtd_kg_solicitada, 0)

        const grp = porProduto.get(r.produto_id) || {
          produto_id: r.produto_id,
          produto_codigo: r.produto_codigo || '',
          produto_descricao: r.produto_descricao,
          produto_grupo: resEsp.grupoMapa || r.produto_grupo || 'GERAL',
          total_kg: 0,
          itens: [],
        }
        grp.total_kg = Number((grp.total_kg + kg).toFixed(3))
        grp.itens.push({
          pedido_item_id: r.pedido_item_id,
          pedido_id: r.pedido_id,
          pedido_codigo: r.pedido_codigo,
          pedido_status: r.pedido_status,
          previsao_entrega: r.previsao_entrega,
          cliente_id: r.cliente_id,
          cliente_nome: r.cliente_nome,
          produto_id: r.produto_id,
          produto_codigo: r.produto_codigo || '',
          produto_descricao: r.produto_descricao,
          qtd_kg_solicitada: kg,
          observacao_item: r.observacao_item || '',
          especificacao_auto: resEsp.especificacao,
          conservacao_auto: resEsp.conservacao,
          grupo_auto: resEsp.grupoMapa,
          materia_prima_auto_id: resEsp.materiaPrimaId,
          rendimento_pct: resEsp.rendimentoPct,
          falta_especificacao: !resEsp.especificacao,
          no_mapa_atual: noMapaAtual,
          em_outro_mapa: outro?.mapa_codigo || null,
          em_embarque: emEmbarqueSet.has(r.pedido_id),
        })
        porProduto.set(r.produto_id, grp)
      }

      return {
        success: true,
        datasDisponiveis,
        gruposProduto: Array.from(porProduto.values()),
      }
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
          titulo: mapasProducao.titulo,
          tipo: mapasProducao.tipo,
          data_mapa: mapasProducao.dataMapa,
          status: mapasProducao.status,
          observacoes: mapasProducao.observacoes,
          created_at: mapasProducao.createdAt,
          qtd_itens: sql<number>`(SELECT COUNT(*)::int FROM mapas_producao_itens mpi WHERE mpi.mapa_id = "mapas_producao"."id")`,
          total_previsto_kg: sql<string>`COALESCE((SELECT ROUND(SUM(mpi.qtd_prevista_kg), 3) FROM mapas_producao_itens mpi WHERE mpi.mapa_id = "mapas_producao"."id"), 0)`,
          total_mp_kg: sql<string>`COALESCE((SELECT ROUND(SUM(mpi.qtd_mp_kg), 3) FROM mapas_producao_itens mpi WHERE mpi.mapa_id = "mapas_producao"."id"), 0)`,
          qtd_ops: sql<number>`(SELECT COUNT(*)::int FROM ordens_producao op WHERE op.mapa_id = "mapas_producao"."id")`,
        })
        .from(mapasProducao)
        .where(and(eq(mapasProducao.tenantId, ctx.tenantId), eq(mapasProducao.filialId, ctx.filialId)))
        .orderBy(desc(mapasProducao.dataMapa), desc(mapasProducao.createdAt))

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          titulo: r.titulo || `MAPA DE PRODUÇÃO ${r.tipo === 'COMPLEMENTAR' ? 'COMPLEMENTAR ' : 'DIÁRIO '}${fmtDataBrIso(r.data_mapa)}`,
          total_previsto_kg: toNum(r.total_previsto_kg, 0),
          total_mp_kg: toNum(r.total_mp_kg, 0),
        })),
      }
    },
  )

  // Especificações padrão automatizadas por Produto / Cliente
  app.get(
    '/api/mapas-producao/especificacoes',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const prodCorte = alias(produtos, 'pe')
      const prodMp = alias(produtos, 'pm')
      const rows = await conn.db
        .select({
          id: mapaEspecificacoesPadrao.id,
          cliente_id: mapaEspecificacoesPadrao.clienteId,
          cliente_nome: clientes.razaoSocial,
          produto_id: mapaEspecificacoesPadrao.produtoId,
          produto_codigo: prodCorte.codigo,
          produto_descricao: prodCorte.descricao,
          materia_prima_id: mapaEspecificacoesPadrao.materiaPrimaId,
          materia_prima_codigo: prodMp.codigo,
          materia_prima_descricao: prodMp.descricao,
          especificacao: mapaEspecificacoesPadrao.especificacao,
          conservacao: mapaEspecificacoesPadrao.conservacao,
          grupo_mapa: mapaEspecificacoesPadrao.grupoMapa,
          updated_at: mapaEspecificacoesPadrao.updatedAt,
        })
        .from(mapaEspecificacoesPadrao)
        .innerJoin(prodCorte, eq(prodCorte.id, mapaEspecificacoesPadrao.produtoId))
        .leftJoin(prodMp, eq(prodMp.id, mapaEspecificacoesPadrao.materiaPrimaId))
        .leftJoin(clientes, eq(clientes.id, mapaEspecificacoesPadrao.clienteId))
        .where(eq(mapaEspecificacoesPadrao.tenantId, ctx.tenantId))
        .orderBy(asc(prodCorte.descricao), asc(clientes.razaoSocial))

      return { success: true, data: rows }
    },
  )

  app.post('/api/mapas-producao/especificacoes', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const body = (req.body || {}) as {
      produto_id: string
      cliente_id?: string | null
      materia_prima_id?: string | null
      especificacao?: string
      conservacao?: string
      grupo_mapa?: string
    }
    const produtoId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
    const clienteId = body.cliente_id ? parseUuidOrBadRequest(body.cliente_id, 'cliente_id') : null
    const mpId = body.materia_prima_id ? parseUuidOrBadRequest(body.materia_prima_id, 'materia_prima_id') : null

    await upsertEspecificacaoMapa(conn.db, {
      tenantId: ctx.tenantId,
      produtoId,
      clienteId,
      especificacao: body.especificacao,
      conservacao: body.conservacao,
      grupoMapa: body.grupo_mapa,
      materiaPrimaId: mpId,
    })

    return { success: true }
  })

  app.delete('/api/mapas-producao/especificacoes/:id', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'especificacao_id')
    await conn.db
      .delete(mapaEspecificacoesPadrao)
      .where(and(eq(mapaEspecificacoesPadrao.id, id), eq(mapaEspecificacoesPadrao.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // Programação Semanal Recorrente
  app.get(
    '/api/mapas-producao/programacao-semanal',
    { preHandler: requirePermission(PERM_MAPA_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { dia_semana?: string }
      const conds = [
        eq(mapaProgramacaoSemanal.tenantId, ctx.tenantId),
        eq(mapaProgramacaoSemanal.filialId, ctx.filialId),
        eq(mapaProgramacaoSemanal.ativo, 1),
      ]
      if (q.dia_semana && Number.isFinite(Number(q.dia_semana))) {
        conds.push(eq(mapaProgramacaoSemanal.diaSemana, Number(q.dia_semana)))
      }

      const prodCorte = alias(produtos, 'pc_sem')
      const prodMp = alias(produtos, 'pm_sem')
      const rows = await conn.db
        .select({
          id: mapaProgramacaoSemanal.id,
          dia_semana: mapaProgramacaoSemanal.diaSemana,
          produto_id: mapaProgramacaoSemanal.produtoId,
          produto_codigo: prodCorte.codigo,
          produto_descricao: prodCorte.descricao,
          cliente_id: mapaProgramacaoSemanal.clienteId,
          cliente_nome: clientes.razaoSocial,
          materia_prima_id: mapaProgramacaoSemanal.materiaPrimaId,
          materia_prima_codigo: prodMp.codigo,
          materia_prima_descricao: prodMp.descricao,
          especificacao: mapaProgramacaoSemanal.especificacao,
          conservacao: mapaProgramacaoSemanal.conservacao,
          grupo_mapa: mapaProgramacaoSemanal.grupoMapa,
          qtd_meta_kg: mapaProgramacaoSemanal.qtdMetaKg,
          observacao: mapaProgramacaoSemanal.observacao,
        })
        .from(mapaProgramacaoSemanal)
        .innerJoin(prodCorte, eq(prodCorte.id, mapaProgramacaoSemanal.produtoId))
        .leftJoin(prodMp, eq(prodMp.id, mapaProgramacaoSemanal.materiaPrimaId))
        .leftJoin(clientes, eq(clientes.id, mapaProgramacaoSemanal.clienteId))
        .where(and(...conds))
        .orderBy(asc(mapaProgramacaoSemanal.diaSemana), asc(prodCorte.descricao))

      return {
        success: true,
        data: rows.map((r) => ({ ...r, qtd_meta_kg: toNum(r.qtd_meta_kg, 0) })),
      }
    },
  )

  app.post('/api/mapas-producao/programacao-semanal', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = (req.body || {}) as {
      dia_semana: number
      produto_id: string
      cliente_id?: string | null
      materia_prima_id?: string | null
      especificacao?: string
      conservacao?: string
      grupo_mapa?: string
      qtd_meta_kg: number
      observacao?: string
    }
    const dia = Math.min(6, Math.max(0, Number(body.dia_semana || 1)))
    const produtoId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
    const clienteId = body.cliente_id ? parseUuidOrBadRequest(body.cliente_id, 'cliente_id') : null
    const mpId = body.materia_prima_id ? parseUuidOrBadRequest(body.materia_prima_id, 'materia_prima_id') : null
    const qtdMeta = Math.max(0.001, toNum(body.qtd_meta_kg, 0))
    const id = uuidv7()

    await conn.db.insert(mapaProgramacaoSemanal).values({
      id,
      tenantId: ctx.tenantId,
      filialId: ctx.filialId,
      diaSemana: dia,
      produtoId,
      clienteId,
      materiaPrimaId: mpId,
      especificacao: String(body.especificacao || '').trim(),
      conservacao: String(body.conservacao || 'RESFRIADO').trim().toUpperCase(),
      grupoMapa: String(body.grupo_mapa || '').trim().toUpperCase(),
      qtdMetaKg: toDec(qtdMeta, 3),
      observacao: String(body.observacao || '').trim(),
      ativo: 1,
    })

    return reply.status(201).send({ success: true, id })
  })

  app.delete('/api/mapas-producao/programacao-semanal/:id', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'prog_id')
    await conn.db
      .delete(mapaProgramacaoSemanal)
      .where(and(eq(mapaProgramacaoSemanal.id, id), eq(mapaProgramacaoSemanal.tenantId, ctx.tenantId)))
    return { success: true }
  })

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
            grupo_mapa: mapasProducaoItens.grupoMapa,
            materia_prima_id: mapasProducaoItens.materiaPrimaId,
            materia_prima_codigo: prodMp.codigo,
            materia_prima_descricao: prodMp.descricao,
            cliente_id: mapasProducaoItens.clienteId,
            cliente_nome: sql<string | null>`COALESCE(NULLIF(${clientes.nomeFantasia}, ''), ${clientes.razaoSocial})`,
            pedido_id: mapasProducaoItens.pedidoId,
            pedido_item_id: mapasProducaoItens.pedidoItemId,
            pedido_codigo: mapasProducaoItens.pedidoCodigo,
            previsao_entrega: mapasProducaoItens.previsaoEntrega,
            especificacao: mapasProducaoItens.especificacao,
            conservacao: mapasProducaoItens.conservacao,
            observacao: mapasProducaoItens.observacao,
            qtd_prevista_kg: mapasProducaoItens.qtdPrevistaKg,
            qtd_mp_kg: mapasProducaoItens.qtdMpKg,
            qtd_realizada_kg: mapasProducaoItens.qtdRealizadaKg,
            concluido: mapasProducaoItens.concluido,
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
          titulo: mapa.titulo || `MAPA DE PRODUÇÃO ${mapa.tipo === 'COMPLEMENTAR' ? 'COMPLEMENTAR ' : 'DIÁRIO '}${fmtDataBrIso(mapa.dataMapa)}`,
          data_mapa: mapa.dataMapa,
          itens: itens.map((it) => ({
            ...it,
            grupo_exibicao: it.grupo_mapa || it.grupo || 'GERAL',
            qtd_prevista_kg: toNum(it.qtd_prevista_kg, 0),
            qtd_mp_kg: toNum(it.qtd_mp_kg, 0),
            qtd_realizada_kg: toNum(it.qtd_realizada_kg, 0),
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
      titulo?: string
      tipo?: 'PRINCIPAL' | 'COMPLEMENTAR'
      observacoes?: string
      puxar_pedidos?: boolean
      data_inicio?: string
      data_fim?: string
      grupo?: string
      itens?: MapaItemInput[]
    }

    const dataMapa = normalizarDataIso(body.data_mapa) || hojeIsoLocal()
    const tipoMapa = body.tipo === 'COMPLEMENTAR' ? 'COMPLEMENTAR' : 'PRINCIPAL'
    const brDate = fmtDataBrIso(dataMapa)
    const tituloFinal =
      String(body.titulo || '').trim() ||
      (tipoMapa === 'COMPLEMENTAR' ? `MAPA DE PRODUÇÃO COMPLEMENTAR ${brDate}` : `MAPA DE PRODUÇÃO DIÁRIO ${brDate}`)

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
        if (itensFinais.length === 0) {
          throw new HttpError(400, 'Nenhum corte para incluir no Mapa de Produção.')
        }
      }

      // Modo modal ("+ Criar Novo Mapa"): Principal existente aberto na mesma data é reaberto
      if (!body.puxar_pedidos && itensFinais.length === 0 && tipoMapa === 'PRINCIPAL') {
        const [existente] = await tx
          .select()
          .from(mapasProducao)
          .where(
            and(
              eq(mapasProducao.tenantId, ctx.tenantId),
              eq(mapasProducao.filialId, ctx.filialId),
              eq(mapasProducao.dataMapa, dataMapa),
              eq(mapasProducao.tipo, 'PRINCIPAL'),
              inArray(mapasProducao.status, ['ABERTO', 'EM_PRODUCAO']),
            ),
          )
          .limit(1)
        if (existente) {
          return {
            reopened: true,
            id: existente.id,
            codigo: existente.codigo,
            titulo: existente.titulo || tituloFinal,
            data_mapa: existente.dataMapa,
            qtd_itens: 0,
          }
        }
      }

      const prodIds = itensFinais.map((x) => parseUuidOrBadRequest(x.produto_id, 'produto_id'))
      const especCache = await carregarMapasEspecificacoes(tx, { tenantId: ctx.tenantId, produtoIds: prodIds })

      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'MAPA_PRODUCAO', 'MAP', 4)
      const mapaId = uuidv7()

      await tx.insert(mapasProducao).values({
        id: mapaId,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        titulo: tituloFinal,
        tipo: tipoMapa,
        dataMapa,
        status: 'ABERTO',
        observacoes: String(body.observacoes || '').trim(),
      })

      if (itensFinais.length > 0) {
        await tx.insert(mapasProducaoItens).values(
          itensFinais.map((it, idx) => {
            const pid = parseUuidOrBadRequest(it.produto_id, 'produto_id')
            const cid = it.cliente_id ? parseUuidOrBadRequest(it.cliente_id, 'cliente_id') : null
            const resEsp = resolverEspecificacaoParaItem(especCache, {
              produtoId: pid,
              clienteId: cid,
              observacaoItem: it.observacao,
            })
            const qtdPrev = Math.max(0.001, toNum(it.qtd_prevista_kg, 0))
            const mpId = it.materia_prima_id
              ? parseUuidOrBadRequest(it.materia_prima_id, 'materia_prima_id')
              : resEsp.materiaPrimaId
            const qtdMp =
              it.qtd_mp_kg != null && toNum(it.qtd_mp_kg, 0) > 0
                ? toNum(it.qtd_mp_kg, 0)
                : mpId
                  ? Number((qtdPrev / ((resEsp.rendimentoPct || 100) / 100)).toFixed(3))
                  : qtdPrev

            return {
              id: uuidv7(),
              tenantId: ctx.tenantId,
              mapaId,
              produtoId: pid,
              materiaPrimaId: mpId,
              clienteId: cid,
              pedidoId: it.pedido_id ? parseUuidOrBadRequest(it.pedido_id, 'pedido_id') : null,
              pedidoItemId: it.pedido_item_id ? parseUuidOrBadRequest(it.pedido_item_id, 'pedido_item_id') : null,
              pedidoCodigo: String(it.pedido_codigo || '').trim(),
              previsaoEntrega: normalizarDataIso(it.previsao_entrega),
              grupoMapa: String(it.grupo_mapa || resEsp.grupoMapa || '').trim().toUpperCase(),
              especificacao: String(it.especificacao || resEsp.especificacao || '').trim(),
              conservacao: String(it.conservacao || resEsp.conservacao || 'RESFRIADO').trim().toUpperCase(),
              observacao: String(it.observacao || '').trim(),
              qtdPrevistaKg: toDec(qtdPrev, 3),
              qtdMpKg: toDec(qtdMp, 3),
              ordem: it.ordem ?? idx + 1,
            }
          }),
        )
      }

      return { id: mapaId, codigo, titulo: tituloFinal, data_mapa: dataMapa, qtd_itens: itensFinais.length }
    })

    return reply.status(201).send({ success: true, ...created })
  })

  app.put('/api/mapas-producao/:id', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    const body = (req.body || {}) as {
      titulo?: string
      observacoes?: string
      status?: 'ABERTO' | 'EM_PRODUCAO' | 'FINALIZADO' | 'CONCLUIDO'
      data_mapa?: string
    }

    const [atual] = await conn.db
      .select()
      .from(mapasProducao)
      .where(and(eq(mapasProducao.id, mapaId), eq(mapasProducao.tenantId, ctx.tenantId)))
      .limit(1)
    if (!atual) throw new HttpError(404, 'Mapa não encontrado.')

    await conn.db
      .update(mapasProducao)
      .set({
        titulo: body.titulo !== undefined ? String(body.titulo || '').trim() || atual.titulo : atual.titulo,
        observacoes: body.observacoes !== undefined ? String(body.observacoes || '').trim() : atual.observacoes,
        status: body.status || atual.status,
        dataMapa: body.data_mapa ? normalizarDataIso(body.data_mapa) || atual.dataMapa : atual.dataMapa,
      })
      .where(eq(mapasProducao.id, mapaId))

    return { success: true }
  })

  app.delete('/api/mapas-producao/:id', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    await conn.db
      .delete(mapasProducao)
      .where(and(eq(mapasProducao.id, mapaId), eq(mapasProducao.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // Adiciona linhas (vindas dos pedidos selecionados ou linha manual) ao Mapa com especificação automática
  app.post('/api/mapas-producao/:id/itens', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req, reply) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    const body = (req.body || {}) as { itens: MapaItemInput[] }
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      throw new HttpError(400, 'Selecione ao menos um item para adicionar ao Mapa.')
    }

    const resAdd = await conn.db.transaction(async (tx) => {
      const [mapa] = await tx
        .select()
        .from(mapasProducao)
        .where(and(eq(mapasProducao.id, mapaId), eq(mapasProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!mapa) throw new HttpError(404, 'Mapa não encontrado.')

      const [{ maxOrdem }] = await tx
        .select({ maxOrdem: sql<number>`COALESCE(MAX(${mapasProducaoItens.ordem}), 0)::int` })
        .from(mapasProducaoItens)
        .where(eq(mapasProducaoItens.mapaId, mapaId))

      const prodIds = Array.from(new Set(body.itens.map((i) => parseUuidOrBadRequest(i.produto_id, 'produto_id'))))
      const [especCache, prodRows] = await Promise.all([
        carregarMapasEspecificacoes(tx, { tenantId: ctx.tenantId, produtoIds: prodIds }),
        tx.select({ id: produtos.id, grupo: produtos.grupo }).from(produtos).where(inArray(produtos.id, prodIds)),
      ])
      const prodGrupoMap = new Map(prodRows.map((p) => [p.id, p.grupo || '']))

      const toInsert: Array<typeof mapasProducaoItens.$inferInsert> = []
      let semEspec = 0

      for (let i = 0; i < body.itens.length; i++) {
        const it = body.itens[i]
        const pid = parseUuidOrBadRequest(it.produto_id, 'produto_id')
        const cid = it.cliente_id ? parseUuidOrBadRequest(it.cliente_id, 'cliente_id') : null
        const resEsp = resolverEspecificacaoParaItem(especCache, {
          produtoId: pid,
          clienteId: cid,
          grupoProduto: prodGrupoMap.get(pid),
          observacaoItem: it.observacao,
        })

        const especificacao = String(it.especificacao ?? resEsp.especificacao ?? '').trim()
        const conservacao = String(it.conservacao || resEsp.conservacao || 'RESFRIADO').trim().toUpperCase()
        const grupoMapa = String(it.grupo_mapa || resEsp.grupoMapa || '').trim().toUpperCase()
        const mpId = it.materia_prima_id
          ? parseUuidOrBadRequest(it.materia_prima_id, 'materia_prima_id')
          : resEsp.materiaPrimaId
        const qtdPrev = Math.max(0.001, toNum(it.qtd_prevista_kg, 0))
        const qtdMp =
          it.qtd_mp_kg != null && toNum(it.qtd_mp_kg, 0) > 0
            ? toNum(it.qtd_mp_kg, 0)
            : mpId
              ? Number((qtdPrev / ((resEsp.rendimentoPct || 100) / 100)).toFixed(3))
              : qtdPrev

        if (!especificacao) semEspec += 1
        if (it.especificacao || it.materia_prima_id) {
          await upsertEspecificacaoMapa(tx, {
            tenantId: ctx.tenantId,
            produtoId: pid,
            clienteId: cid,
            especificacao,
            conservacao,
            grupoMapa,
            materiaPrimaId: mpId,
          })
        }

        const obsAuto =
          String(it.observacao || '').trim() ||
          (it.previsao_entrega ? `ENTREGA DIA ${fmtDataBrIso(it.previsao_entrega).slice(0, 5)}` : '')

        toInsert.push({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          mapaId,
          produtoId: pid,
          materiaPrimaId: mpId,
          clienteId: cid,
          pedidoId: it.pedido_id ? parseUuidOrBadRequest(it.pedido_id, 'pedido_id') : null,
          pedidoItemId: it.pedido_item_id ? parseUuidOrBadRequest(it.pedido_item_id, 'pedido_item_id') : null,
          pedidoCodigo: String(it.pedido_codigo || '').trim(),
          previsaoEntrega: normalizarDataIso(it.previsao_entrega),
          grupoMapa,
          especificacao,
          conservacao,
          observacao: obsAuto,
          qtdPrevistaKg: toDec(qtdPrev, 3),
          qtdMpKg: toDec(qtdMp, 3),
          ordem: (maxOrdem || 0) + i + 1,
        })
      }

      await tx.insert(mapasProducaoItens).values(toInsert)
      return { adicionados: toInsert.length, itens_sem_especificacao: semEspec }
    })

    return reply.status(201).send({ success: true, ...resAdd })
  })

  // Atualiza linha do Mapa inline e memoriza automaticamente a especificação para esse Cliente + Produto
  app.put('/api/mapas-producao/:id/itens/:itemId', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    const itemId = parseUuidOrBadRequest((req.params as { itemId: string }).itemId, 'item_id')
    const body = (req.body || {}) as {
      especificacao?: string
      conservacao?: string
      grupo_mapa?: string
      materia_prima_id?: string | null
      qtd_prevista_kg?: number
      qtd_mp_kg?: number
      qtd_realizada_kg?: number
      concluido?: number | boolean
      observacao?: string
    }

    await conn.db.transaction(async (tx) => {
      const [atual] = await tx
        .select()
        .from(mapasProducaoItens)
        .where(
          and(
            eq(mapasProducaoItens.id, itemId),
            eq(mapasProducaoItens.mapaId, mapaId),
            eq(mapasProducaoItens.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
      if (!atual) throw new HttpError(404, 'Item do Mapa não encontrado.')

      const nextEspec = body.especificacao !== undefined ? String(body.especificacao || '').trim() : atual.especificacao
      const nextCons =
        body.conservacao !== undefined ? String(body.conservacao || 'RESFRIADO').trim().toUpperCase() : atual.conservacao
      const nextGrupo =
        body.grupo_mapa !== undefined ? String(body.grupo_mapa || '').trim().toUpperCase() : atual.grupoMapa
      const nextMp =
        body.materia_prima_id !== undefined
          ? body.materia_prima_id
            ? parseUuidOrBadRequest(body.materia_prima_id, 'materia_prima_id')
            : null
          : atual.materiaPrimaId
      const nextPrev =
        body.qtd_prevista_kg !== undefined ? toDec(Math.max(0.001, toNum(body.qtd_prevista_kg, 0)), 3) : atual.qtdPrevistaKg
      const nextQtdMp =
        body.qtd_mp_kg !== undefined ? toDec(Math.max(0, toNum(body.qtd_mp_kg, 0)), 3) : atual.qtdMpKg
      const nextReal =
        body.qtd_realizada_kg !== undefined ? toDec(Math.max(0, toNum(body.qtd_realizada_kg, 0)), 3) : atual.qtdRealizadaKg
      const nextConc = body.concluido !== undefined ? (body.concluido ? 1 : 0) : atual.concluido
      const nextObs = body.observacao !== undefined ? String(body.observacao || '').trim() : atual.observacao

      await tx
        .update(mapasProducaoItens)
        .set({
          especificacao: nextEspec,
          conservacao: nextCons,
          grupoMapa: nextGrupo,
          materiaPrimaId: nextMp,
          qtdPrevistaKg: nextPrev,
          qtdMpKg: nextQtdMp,
          qtdRealizadaKg: nextReal,
          concluido: nextConc,
          observacao: nextObs,
        })
        .where(eq(mapasProducaoItens.id, itemId))

      // Memória operacional: salva automaticamente a especificação vinculada a este (cliente_id, produto_id)
      if (nextEspec || nextMp || nextGrupo) {
        await upsertEspecificacaoMapa(tx, {
          tenantId: ctx.tenantId,
          produtoId: atual.produtoId,
          clienteId: atual.clienteId,
          especificacao: nextEspec,
          conservacao: nextCons,
          grupoMapa: nextGrupo,
          materiaPrimaId: nextMp,
        })
      }
    })

    return { success: true }
  })

  app.delete('/api/mapas-producao/:id/itens/:itemId', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    const itemId = parseUuidOrBadRequest((req.params as { itemId: string }).itemId, 'item_id')
    await conn.db
      .delete(mapasProducaoItens)
      .where(
        and(
          eq(mapasProducaoItens.id, itemId),
          eq(mapasProducaoItens.mapaId, mapaId),
          eq(mapasProducaoItens.tenantId, ctx.tenantId),
        ),
      )
    return { success: true }
  })

  // Puxar / Reaplicar Especificações Automatizadas para linhas vazias do Mapa
  app.post('/api/mapas-producao/:id/aplicar-especificacoes', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')

    const atualizados = await conn.db.transaction(async (tx) => {
      const itens = await tx
        .select()
        .from(mapasProducaoItens)
        .where(and(eq(mapasProducaoItens.mapaId, mapaId), eq(mapasProducaoItens.tenantId, ctx.tenantId)))
      if (itens.length === 0) return 0

      const prodIds = Array.from(new Set(itens.map((i) => i.produtoId)))
      const cache = await carregarMapasEspecificacoes(tx, { tenantId: ctx.tenantId, produtoIds: prodIds })
      let count = 0

      for (const it of itens) {
        const resEsp = resolverEspecificacaoParaItem(cache, {
          produtoId: it.produtoId,
          clienteId: it.clienteId,
        })
        const updEspec = it.especificacao || resEsp.especificacao
        const updMp = it.materiaPrimaId || resEsp.materiaPrimaId
        const updGrupo = it.grupoMapa || resEsp.grupoMapa
        if (updEspec !== it.especificacao || updMp !== it.materiaPrimaId || updGrupo !== it.grupoMapa) {
          await tx
            .update(mapasProducaoItens)
            .set({
              especificacao: updEspec,
              conservacao: it.especificacao ? it.conservacao : resEsp.conservacao,
              materiaPrimaId: updMp,
              grupoMapa: updGrupo,
            })
            .where(eq(mapasProducaoItens.id, it.id))
          count++
        }
      }
      return count
    })

    return { success: true, atualizados }
  })

  // Importar Programação Semanal do dia escolhido para o Mapa atual
  app.post('/api/mapas-producao/:id/importar-semanal', { preHandler: requirePermission(PERM_MAPA_WRITE) }, async (req) => {
    const ctx = req.authCtx!
    const mapaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'mapa_id')
    const body = (req.body || {}) as { dia_semana: number }
    const dia = Math.min(6, Math.max(0, Number(body.dia_semana || 1)))

    const importados = await conn.db.transaction(async (tx) => {
      const [mapa] = await tx
        .select()
        .from(mapasProducao)
        .where(and(eq(mapasProducao.id, mapaId), eq(mapasProducao.tenantId, ctx.tenantId)))
        .limit(1)
      if (!mapa) throw new HttpError(404, 'Mapa não encontrado.')

      const modelos = await tx
        .select()
        .from(mapaProgramacaoSemanal)
        .where(
          and(
            eq(mapaProgramacaoSemanal.tenantId, ctx.tenantId),
            eq(mapaProgramacaoSemanal.filialId, ctx.filialId),
            eq(mapaProgramacaoSemanal.diaSemana, dia),
            eq(mapaProgramacaoSemanal.ativo, 1),
          ),
        )
      if (modelos.length === 0) {
        throw new HttpError(400, 'Nenhum item cadastrado na Programação Semanal para este dia.')
      }

      const [{ maxOrdem }] = await tx
        .select({ maxOrdem: sql<number>`COALESCE(MAX(${mapasProducaoItens.ordem}), 0)::int` })
        .from(mapasProducaoItens)
        .where(eq(mapasProducaoItens.mapaId, mapaId))

      const cache = await carregarMapasEspecificacoes(tx, {
        tenantId: ctx.tenantId,
        produtoIds: modelos.map((m) => m.produtoId),
      })

      await tx.insert(mapasProducaoItens).values(
        modelos.map((m, idx) => {
          const resEsp = resolverEspecificacaoParaItem(cache, {
            produtoId: m.produtoId,
            clienteId: m.clienteId,
          })
          const mpId = m.materiaPrimaId || resEsp.materiaPrimaId
          const qtdPrev = toNum(m.qtdMetaKg, 0)
          const qtdMp = mpId ? Number((qtdPrev / ((resEsp.rendimentoPct || 100) / 100)).toFixed(3)) : qtdPrev

          return {
            id: uuidv7(),
            tenantId: ctx.tenantId,
            mapaId,
            produtoId: m.produtoId,
            materiaPrimaId: mpId,
            clienteId: m.clienteId,
            grupoMapa: m.grupoMapa || resEsp.grupoMapa || '',
            especificacao: m.especificacao || resEsp.especificacao || '',
            conservacao: m.conservacao || resEsp.conservacao || 'RESFRIADO',
            observacao: m.observacao || '',
            qtdPrevistaKg: toDec(qtdPrev, 3),
            qtdMpKg: toDec(qtdMp, 3),
            ordem: (maxOrdem || 0) + idx + 1,
          }
        }),
      )

      return modelos.length
    })

    return { success: true, importados }
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

        if (entradaRows.length === 0) {
          throw new HttpError(
            400,
            `Selecione a Matéria-Prima nas linhas de "${grp.label}" antes de gerar OPs (OP exige ao menos 1 Matéria-Prima de entrada).`,
          )
        }

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
