import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  estoqueCaixas,
  etiquetasAcougue,
  produtoArvore,
  produtos,
  tabelasPrecoItens,
  varejoEstoque,
  varejoInventarios,
  varejoMovimentacoes,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  parseUuidOrBadRequest,
  registrarHistoricoCaixa,
  toDec,
  toNum,
} from '../wms/helpers.js'
import { detectarEspecieProduto } from '../interunidades/helpers.js'
import { obterTabelaAtivaAcougue } from '../precos/routes.js'

const PERM_ACOUGUE = ['varejo_acougue', 'pdv_caixa', 'interunidades']

function somarDiasData(baseIso: string, dias: number): string {
  const ms = new Date(`${baseIso}T12:00:00Z`).getTime()
  return new Date(ms + Math.max(0, Number(dias || 0)) * 86_400_000).toISOString().slice(0, 10)
}

function montarQrPayloadEtiqueta(params: {
  codigoEtiqueta: string
  codigoProduto: string
  pesoKg: number
  valorTotal: number
  lote?: string
  validade?: string
}): string {
  const parts = [
    'TRIC',
    `ID=${params.codigoEtiqueta}`,
    `COD=${params.codigoProduto}`,
    `KG=${params.pesoKg.toFixed(3)}`,
    `VL=${params.valorTotal.toFixed(2)}`,
  ]
  if (params.lote) parts.push(`LT=${params.lote.slice(0, 16)}`)
  if (params.validade) parts.push(`VAL=${params.validade.slice(0, 10)}`)
  return parts.join('|')
}

export function registerAcougueRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── 1) GERENCIADOR DO AÇOUGUE (ESTOQUE EM TEMPO REAL: MPs VIVAS + ETIQUETAS PESADAS) ──
  app.get(
    '/api/acougue/gerenciador',
    { preHandler: requirePermission(PERM_ACOUGUE, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { busca?: string; especie?: string; status_etiqueta?: string; conservacao?: string }

      const [caixasMp, etqs, contagensPorMp] = await Promise.all([
        conn.db
          .select({
            id: estoqueCaixas.id,
            ean_caixa: estoqueCaixas.eanCaixa,
            produto_id: estoqueCaixas.produtoId,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            produto_grupo: produtos.grupo,
            produto_ncm: produtos.ncm,
            produto_especie: produtos.especie,
            produto_conservacao: produtos.conservacao,
            lote: estoqueCaixas.lote,
            data_producao: estoqueCaixas.dataProducao,
            validade: estoqueCaixas.validade,
            peso_kg: estoqueCaixas.pesoKg,
            peso_restante_kg: estoqueCaixas.pesoRestanteKg,
            quebra_acougue_kg: estoqueCaixas.quebraAcougueKg,
            status: estoqueCaixas.status,
            endereco: estoqueCaixas.endereco,
            entrada_acougue_em: estoqueCaixas.entradaAcougueEm,
            entrada_acougue_por: estoqueCaixas.entradaAcouguePor,
            updated_at: estoqueCaixas.updatedAt,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              inArray(estoqueCaixas.status, ['EM_TRANSITO_LOJA', 'ABERTA_ACOUGUE', 'CONSUMIDA_ACOUGUE']),
            ),
          )
          .orderBy(desc(estoqueCaixas.updatedAt))
          .limit(300),
        conn.db
          .select()
          .from(etiquetasAcougue)
          .where(and(eq(etiquetasAcougue.tenantId, ctx.tenantId), eq(etiquetasAcougue.filialId, ctx.filialId)))
          .orderBy(desc(etiquetasAcougue.createdAt))
          .limit(500),
        conn.db.execute(sql`
          SELECT caixa_mp_id, COUNT(*)::int AS qtd_etqs, COALESCE(SUM(peso_liquido_kg), 0) AS peso_pesado_kg
          FROM etiquetas_acougue
          WHERE tenant_id = ${ctx.tenantId} AND filial_id = ${ctx.filialId} AND status <> 'CANCELADA' AND caixa_mp_id IS NOT NULL
          GROUP BY caixa_mp_id
        `),
      ])

      const mapMpStats = new Map<string, { qtd_etqs: number; peso_pesado_kg: number }>()
      for (const r of contagensPorMp.rows as Array<{ caixa_mp_id: string; qtd_etqs: number; peso_pesado_kg: string }>) {
        mapMpStats.set(r.caixa_mp_id, {
          qtd_etqs: Number(r.qtd_etqs || 0),
          peso_pesado_kg: toNum(r.peso_pesado_kg, 0),
        })
      }

      const busca = String(q.busca || '').trim().toLowerCase()
      const espFiltro = String(q.especie || 'TODOS').toUpperCase()
      const consFiltro = String(q.conservacao || 'TODOS').toUpperCase()
      const stEtqFiltro = String(q.status_etiqueta || 'TODOS').toUpperCase()

      const mpsNorm = caixasMp
        .map((c) => {
          const pesoIni = toNum(c.peso_kg, 0)
          const pesoRest = c.peso_restante_kg != null ? toNum(c.peso_restante_kg, 0) : c.status === 'CONSUMIDA_ACOUGUE' ? 0 : pesoIni
          const stat = mapMpStats.get(c.id) || { qtd_etqs: 0, peso_pesado_kg: 0 }
          const quebra = c.quebra_acougue_kg != null ? toNum(c.quebra_acougue_kg, 0) : 0
          const rendimentoPct =
            pesoIni > 0 && stat.peso_pesado_kg > 0 ? Number(((stat.peso_pesado_kg / pesoIni) * 100).toFixed(1)) : null
          const especie =
            c.produto_especie ||
            detectarEspecieProduto({ grupo: c.produto_grupo, ncm: c.produto_ncm, descricao: c.produto_descricao })
          return {
            id: c.id,
            ean_caixa: c.ean_caixa,
            produto_id: c.produto_id,
            produto_codigo: c.produto_codigo || '',
            produto_descricao: c.produto_descricao,
            especie,
            conservacao: c.produto_conservacao || 'RESFRIADO',
            lote: c.lote,
            validade: c.validade,
            peso_kg: pesoIni,
            peso_inicial_kg: pesoIni,
            peso_restante_kg: pesoRest,
            peso_pesado_kg: stat.peso_pesado_kg,
            qtd_etqs: stat.qtd_etqs,
            qtd_etiquetas_geradas: stat.qtd_etqs,
            quebra_acougue_kg: quebra,
            rendimento_pct: rendimentoPct,
            status: c.status,
            endereco: c.endereco,
            entrada_acougue_em: c.entrada_acougue_em,
            entrada_acougue_por: c.entrada_acougue_por,
          }
        })
        .filter((m) => {
          if (espFiltro !== 'TODOS' && m.especie !== espFiltro) return false
          if (consFiltro !== 'TODOS' && m.conservacao !== consFiltro) return false
          if (busca) {
            return (
              m.ean_caixa.toLowerCase().includes(busca) ||
              m.produto_descricao.toLowerCase().includes(busca) ||
              m.produto_codigo.toLowerCase().includes(busca) ||
              m.lote.toLowerCase().includes(busca)
            )
          }
          return true
        })

      const etqsNorm = etqs
        .map((e) => ({
          id: e.id,
          codigo_etiqueta: e.codigoEtiqueta,
          produto_id: e.produtoId,
          produto_codigo: e.produtoCodigo,
          produto_descricao: e.produtoDescricao,
          especie: e.especie,
          conservacao: e.conservacao,
          caixa_mp_id: e.caixaMpId,
          ean_mp_origem: e.eanMpOrigem,
          peso_bruto_kg: toNum(e.pesoBrutoKg, 0),
          tara_kg: toNum(e.taraKg, 0),
          peso_liquido_kg: toNum(e.pesoLiquidoKg, 0),
          preco_kg: toNum(e.precoKg, 0),
          valor_total: toNum(e.valorTotal, 0),
          lote: e.lote,
          data_pesagem: e.dataPesagem,
          validade: e.validade,
          payload_qr: e.payloadQr,
          status: e.status,
          operador_nome: e.operadorNome,
          vendida_em: e.vendidaEm,
          created_at: e.createdAt,
        }))
        .filter((e) => {
          if (espFiltro !== 'TODOS' && e.especie !== espFiltro) return false
          if (consFiltro !== 'TODOS' && e.conservacao !== consFiltro) return false
          if (stEtqFiltro !== 'TODOS' && e.status !== stEtqFiltro) return false
          if (busca) {
            return (
              e.codigo_etiqueta.toLowerCase().includes(busca) ||
              e.produto_descricao.toLowerCase().includes(busca) ||
              e.produto_codigo.toLowerCase().includes(busca) ||
              e.ean_mp_origem.toLowerCase().includes(busca)
            )
          }
          return true
        })

      const mpsTransito = mpsNorm.filter((m) => m.status === 'EM_TRANSITO_LOJA')
      const mpsAbertas = mpsNorm.filter((m) => m.status === 'ABERTA_ACOUGUE')
      const mpsEncerradas = mpsNorm.filter((m) => m.status === 'CONSUMIDA_ACOUGUE')
      const etqsEmEstoque = etqsNorm.filter((e) => e.status === 'EM_ESTOQUE')
      const hoje = hojeIsoLocal()
      const etqsVendidasHoje = etqsNorm.filter((e) => e.status === 'VENDIDA' && String(e.vendida_em || '').slice(0, 10) === hoje)

      // Alertas de Validade (etiquetas EM_ESTOQUE + MPs ABERTA_ACOUGUE)
      const hojeMs = new Date(`${hoje}T12:00:00Z`).getTime()
      const calcularDiasRest = (valStr: unknown) => {
        if (!valStr) return null
        const iso = String(valStr).slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
        return Math.round((new Date(`${iso}T12:00:00Z`).getTime() - hojeMs) / 86_400_000)
      }
      const alertasValidade: Array<Record<string, unknown>> = []
      for (const e of etqsEmEstoque) {
        const dias = calcularDiasRest(e.validade)
        if (dias !== null && dias <= 3) {
          alertasValidade.push({
            origem: 'ETIQUETA',
            codigo: e.codigo_etiqueta,
            produto_descricao: e.produto_descricao,
            especie: e.especie,
            peso_kg: e.peso_liquido_kg,
            validade: e.validade,
            dias_restantes: dias,
            severidade: dias < 0 ? 'VENCIDO' : dias <= 1 ? 'CRITICO' : 'ATENCAO',
          })
        }
      }
      for (const m of mpsAbertas) {
        const dias = calcularDiasRest(m.validade)
        if (dias !== null && dias <= 3) {
          alertasValidade.push({
            origem: 'MATERIA_PRIMA',
            codigo: m.ean_caixa,
            produto_descricao: m.produto_descricao,
            especie: m.especie,
            peso_kg: m.peso_restante_kg,
            validade: m.validade,
            dias_restantes: dias,
            severidade: dias < 0 ? 'VENCIDO' : dias <= 1 ? 'CRITICO' : 'ATENCAO',
          })
        }
      }
      alertasValidade.sort((a, b) => Number(a.dias_restantes) - Number(b.dias_restantes))

      const ativaTab = await obterTabelaAtivaAcougue(conn.db, ctx.tenantId, ctx.filialId)

      return {
        success: true,
        tabela_ativa: ativaTab.tabela
          ? { id: ativaTab.tabela.id, codigo: ativaTab.tabela.codigo, nome: ativaTab.tabela.nome, finalidade: ativaTab.tabela.finalidade }
          : null,
        kpis: {
          qtd_mp_transito: mpsTransito.length,
          kg_mp_transito: Number(mpsTransito.reduce((s, m) => s + m.peso_inicial_kg, 0).toFixed(3)),
          qtd_mp_aberta: mpsAbertas.length,
          kg_mp_aberta: Number(mpsAbertas.reduce((s, m) => s + m.peso_restante_kg, 0).toFixed(3)),
          qtd_etiquetas_estoque: etqsEmEstoque.length,
          kg_etiquetas_estoque: Number(etqsEmEstoque.reduce((s, e) => s + e.peso_liquido_kg, 0).toFixed(3)),
          valor_etiquetas_estoque: Number(etqsEmEstoque.reduce((s, e) => s + e.valor_total, 0).toFixed(2)),
          qtd_vendidas_hoje: etqsVendidasHoje.length,
          qtd_alertas_validade: alertasValidade.length,
        },
        alertas_validade: alertasValidade,
        mps_transito: mpsTransito,
        mps_abertas: mpsAbertas,
        mps_encerradas: mpsEncerradas,
        etiquetas: etqsNorm,
      }
    },
  )

  // ── 2) 2º BIP: AÇOUGUEIRO DÁ ENTRADA NA MATÉRIA-PRIMA (MESMA ETIQUETA DA 1/2!) ──
  app.post(
    '/api/acougue/entrada-mp',
    { preHandler: requirePermission(['varejo_acougue', 'interunidades']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as { ean_caixa?: string; codigo?: string; ean?: string }
      const ean = String(body.ean_caixa || body.codigo || body.ean || '').trim()
      if (!ean) throw new HttpError(400, 'Bipe ou informe o código de barras (EAN) da etiqueta de Matéria-Prima.')

      const out = await conn.db.transaction(async (tx) => {
        const [cx] = await tx
          .select()
          .from(estoqueCaixas)
          .where(and(eq(estoqueCaixas.tenantId, ctx.tenantId), eq(estoqueCaixas.eanCaixa, ean)))
          .limit(1)

        if (!cx) {
          throw new HttpError(404, `Etiqueta "${ean}" não encontrada no sistema.`)
        }
        if (cx.filialId !== ctx.filialId) {
          throw new HttpError(
            409,
            `A etiqueta ${cx.eanCaixa} ainda está em outra filial. Realize primeiro a Transferência (1º bip: Matriz → Varejo/Açougue)!`,
          )
        }
        if (cx.status === 'ABERTA_ACOUGUE') {
          throw new HttpError(409, `A etiqueta ${cx.eanCaixa} já deu entrada no Açougue (saldo restante: ${toNum(cx.pesoRestanteKg, 0).toFixed(3)} kg).`)
        }
        if (cx.status !== 'EM_TRANSITO_LOJA' && cx.status !== 'DISPONIVEL') {
          throw new HttpError(409, `A etiqueta ${cx.eanCaixa} não está aguardando entrada no Açougue (status atual: ${cx.status}).`)
        }

        const [prod] = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.id, cx.produtoId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto da etiqueta não encontrado.')

        const pesoKg = toNum(cx.pesoKg, 0)
        const especie =
          prod.especie || detectarEspecieProduto({ grupo: prod.grupo, ncm: prod.ncm, descricao: prod.descricao })

        await tx
          .update(estoqueCaixas)
          .set({
            status: 'ABERTA_ACOUGUE',
            endereco: 'ACOUGUE-MP',
            pesoRestanteKg: toDec(pesoKg, 3),
            entradaAcougueEm: new Date(),
            entradaAcouguePor: ctx.operador.nome,
            updatedAt: new Date(),
          })
          .where(eq(estoqueCaixas.id, cx.id))

        // Soma também no saldo consolidado da filial (varejo_estoque)
        const [estLoja] = await tx
          .select()
          .from(varejoEstoque)
          .where(
            and(
              eq(varejoEstoque.tenantId, ctx.tenantId),
              eq(varejoEstoque.filialId, ctx.filialId),
              eq(varejoEstoque.produtoId, prod.id),
            ),
          )
          .limit(1)

        const saldoAnt = estLoja ? toNum(estLoja.saldoQtd, 0) : 0
        const saldoNovo = Number((saldoAnt + pesoKg).toFixed(3))

        if (estLoja) {
          await tx
            .update(varejoEstoque)
            .set({ saldoQtd: toDec(saldoNovo, 3), updatedAt: new Date() })
            .where(eq(varejoEstoque.id, estLoja.id))
        } else {
          await tx.insert(varejoEstoque).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: prod.id,
            unidadeVenda: 'KG',
            saldoQtd: toDec(saldoNovo, 3),
            precoVendaVarejo: toDec(toNum(prod.valorUnitario, 0), 4),
            estoqueMinimo: '0.000',
            codigoBalanca: (prod.codigo || '').replace(/\D/g, '').slice(-5),
            setorLoja: 'ACOUGUE',
          })
        }

        await tx.insert(varejoMovimentacoes).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: prod.id,
          tipo: 'ENTRADA_TRANSFERENCIA',
          qtd: toDec(pesoKg, 3),
          saldoAnterior: toDec(saldoAnt, 3),
          saldoNovo: toDec(saldoNovo, 3),
          referenciaTipo: 'ENTRADA_MP_ACOUGUE',
          referenciaId: cx.id,
          observacao: `2º Bip Açougue • MP ${cx.eanCaixa} recebida (${pesoKg.toFixed(3)} kg)`,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          operacao: 'ENTRADA_MP_ACOUGUE',
          detalhes: `2º Bip confirmado no Açougue por ${ctx.operador.nome} • ${pesoKg.toFixed(3)} kg disponíveis para pesagem`,
          operadorNome: ctx.operador.nome,
        })

        return {
          caixa_id: cx.id,
          ean_caixa: cx.eanCaixa,
          produto_id: prod.id,
          produto_codigo: prod.codigo || '',
          produto_descricao: prod.descricao,
          especie,
          conservacao: prod.conservacao || 'RESFRIADO',
          peso_kg: pesoKg,
          lote: cx.lote,
          validade: cx.validade,
          status: 'ABERTA_ACOUGUE',
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── 3) ENCERRAR MP NO AÇOUGUE (APURAR QUEBRA / RENDIMENTO REAL DA PEÇA/CAIXA) ──
  app.post(
    '/api/acougue/mp/:caixaId/encerrar',
    { preHandler: requirePermission(['varejo_acougue']) },
    async (req) => {
      const ctx = req.authCtx!
      const caixaId = parseUuidOrBadRequest((req.params as { caixaId: string }).caixaId, 'caixa_id')

      const out = await conn.db.transaction(async (tx) => {
        const [cx] = await tx
          .select()
          .from(estoqueCaixas)
          .where(
            and(
              eq(estoqueCaixas.id, caixaId),
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
            ),
          )
          .limit(1)
        if (!cx) throw new HttpError(404, 'Etiqueta de MP não encontrada nesta filial.')
        if (cx.status !== 'ABERTA_ACOUGUE') {
          throw new HttpError(409, `Esta etiqueta não está aberta no Açougue (status: ${cx.status}).`)
        }

        const pesoIni = toNum(cx.pesoKg, 0)
        const quebraKg = Math.max(0, toNum(cx.pesoRestanteKg, 0))
        const rendimentoPct = pesoIni > 0 ? Number((((pesoIni - quebraKg) / pesoIni) * 100).toFixed(1)) : 0

        await tx
          .update(estoqueCaixas)
          .set({
            status: 'CONSUMIDA_ACOUGUE',
            pesoRestanteKg: '0.000',
            quebraAcougueKg: toDec(quebraKg, 3),
            updatedAt: new Date(),
          })
          .where(eq(estoqueCaixas.id, cx.id))

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          operacao: 'ENCERRAMENTO_MP_ACOUGUE',
          detalhes: `MP encerrada no Açougue • Quebra/apara: ${quebraKg.toFixed(3)} kg • Rendimento: ${rendimentoPct}%`,
          operadorNome: ctx.operador.nome,
        })

        return { caixa_id: cx.id, ean_caixa: cx.eanCaixa, quebra_kg: quebraKg, rendimento_pct: rendimentoPct }
      })

      return { success: true, data: out }
    },
  )

  // ── 4) CATÁLOGO OTIMIZADO & PAGINADO PARA PESAGEM (SOMENTE ITENS COM PREÇO NA TABELA ATIVA) ──
  app.get(
    '/api/acougue/produtos-pesagem',
    { preHandler: requirePermission(PERM_ACOUGUE, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as {
        especie?: string
        busca?: string
        codigo?: string
        page?: string
        limit?: string
      }

      const { cfg, tabela: tabelaAtiva } = await obterTabelaAtivaAcougue(conn.db, ctx.tenantId, ctx.filialId)
      if (!tabelaAtiva) {
        return {
          success: true,
          tabela_ativa: null,
          em_tabela_alternativa: false,
          total: 0,
          page: 1,
          limit: 48,
          total_pages: 1,
          contagens_especie: { TODOS: 0, BOVINO: 0, SUINO: 0, AVES: 0, EMPORIO: 0, OUTROS: 0 },
          data: [],
        }
      }

      const [itensTabela, estLoja, arvore, mpsAbertas] = await Promise.all([
        conn.db
          .select({
            precoVenda: tabelasPrecoItens.precoVenda,
            descontoPct: tabelasPrecoItens.descontoPct,
            produto: produtos,
          })
          .from(tabelasPrecoItens)
          .innerJoin(produtos, eq(produtos.id, tabelasPrecoItens.produtoId))
          .where(
            and(
              eq(tabelasPrecoItens.tenantId, ctx.tenantId),
              eq(tabelasPrecoItens.tabelaPrecoId, tabelaAtiva.id),
              eq(produtos.ativo, 1),
              sql`${tabelasPrecoItens.precoVenda} > 0`,
            ),
          )
          .orderBy(asc(produtos.descricao)),
        conn.db
          .select()
          .from(varejoEstoque)
          .where(and(eq(varejoEstoque.tenantId, ctx.tenantId), eq(varejoEstoque.filialId, ctx.filialId))),
        conn.db.select().from(produtoArvore).where(eq(produtoArvore.tenantId, ctx.tenantId)),
        conn.db
          .select({
            produtoId: estoqueCaixas.produtoId,
            pesoRestanteKg: estoqueCaixas.pesoRestanteKg,
          })
          .from(estoqueCaixas)
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              eq(estoqueCaixas.status, 'ABERTA_ACOUGUE'),
            ),
          ),
      ])

      const estMap = new Map(estLoja.map((e) => [e.produtoId, e]))
      const paisPorFilho = new Map<string, string[]>()
      for (const v of arvore) {
        const list = paisPorFilho.get(v.filhoId) || []
        list.push(v.paiId)
        paisPorFilho.set(v.filhoId, list)
      }
      const saldoMpPorProd = new Map<string, number>()
      for (const mp of mpsAbertas) {
        const cur = saldoMpPorProd.get(mp.produtoId) || 0
        saldoMpPorProd.set(mp.produtoId, Number((cur + toNum(mp.pesoRestanteKg, 0)).toFixed(3)))
      }

      const espFiltro = String(q.especie || 'TODOS').toUpperCase()
      const busca = String(q.busca || (q as { q?: string }).q || '').trim().toLowerCase()
      const codExato = String(q.codigo || '').trim().toLowerCase()
      const page = Math.max(1, Number(q.page || 1) || 1)
      const limit = Math.min(120, Math.max(12, Number(q.limit || 48) || 48))

      const normalizados = itensTabela.map((row) => {
        const p = row.produto
        const est = estMap.get(p.id)
        const especie =
          p.especie || detectarEspecieProduto({ grupo: p.grupo, ncm: p.ncm, descricao: p.descricao })
        const pais = paisPorFilho.get(p.id) || []
        const mpIdsCandidatos = Array.from(new Set([...pais, p.id]))
        const saldoMpDisponivel = Number(
          mpIdsCandidatos.reduce((s, id) => s + (saldoMpPorProd.get(id) || 0), 0).toFixed(3),
        )
        return {
          id: p.id,
          codigo: p.codigo || '',
          codigo_auxiliar: p.codigoAuxiliar || '',
          ean: p.ean || '',
          descricao: p.descricao,
          especie,
          grupo: p.grupo || '',
          conservacao: p.conservacao || 'RESFRIADO',
          validade_dias: Number(p.validadeDias ?? 5),
          tara_embalagem_kg: toNum(p.taraEmbalagemKg, 0) || toNum(p.taraPrimariaPecaKg, 0),
          unidade: est?.unidadeVenda || (p.unidade === 'UN' ? 'UN' : 'KG'),
          preco_kg: toNum(row.precoVenda, 0),
          desconto_tabela_pct: toNum(row.descontoPct, 0),
          codigo_balanca: est?.codigoBalanca || (p.codigo || '').replace(/\D/g, '').slice(-5),
          mp_pais_ids: pais,
          saldo_mp_disponivel_kg: saldoMpDisponivel,
        }
      })

      const contagensEspecie: Record<string, number> = {
        TODOS: normalizados.length,
        BOVINO: 0,
        SUINO: 0,
        AVES: 0,
        EMPORIO: 0,
        OUTROS: 0,
      }
      for (const p of normalizados) {
        const k = contagensEspecie[p.especie] !== undefined ? p.especie : 'OUTROS'
        contagensEspecie[k] += 1
      }

      const filtrados = normalizados.filter((p) => {
        if (codExato) {
          return (
            p.codigo.toLowerCase() === codExato ||
            p.codigo.replace(/^0+/, '').toLowerCase() === codExato.replace(/^0+/, '') ||
            p.codigo_balanca.toLowerCase() === codExato ||
            p.ean.toLowerCase() === codExato
          )
        }
        if (espFiltro !== 'TODOS' && p.especie !== espFiltro) return false
        if (busca) {
          return (
            p.descricao.toLowerCase().includes(busca) ||
            p.codigo.toLowerCase().includes(busca) ||
            p.codigo_balanca.toLowerCase().includes(busca) ||
            p.grupo.toLowerCase().includes(busca)
          )
        }
        return true
      })

      const total = filtrados.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const safePage = Math.min(page, totalPages)
      const slice = filtrados.slice((safePage - 1) * limit, safePage * limit)

      return {
        success: true,
        tabela_ativa: {
          id: tabelaAtiva.id,
          codigo: tabelaAtiva.codigo,
          nome: tabelaAtiva.nome,
          finalidade: tabelaAtiva.finalidade,
          padrao: Number(tabelaAtiva.padrao) === 1,
        },
        em_tabela_alternativa: Boolean(cfg?.tabelaPadraoId && cfg.tabelaPadraoId !== tabelaAtiva.id),
        alterada_por_nome: cfg?.alteradaPorNome || '',
        total,
        page: safePage,
        limit,
        total_pages: totalPages,
        contagens_especie: contagensEspecie,
        data: slice,
      }
    },
  )

  // ── 4b) ETIQUETAS GERADAS NO DIA (PARA O PAINEL LATERAL DA PESAGEM) ─────────
  app.get(
    '/api/acougue/etiquetas-dia',
    { preHandler: requirePermission(PERM_ACOUGUE, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const hoje = hojeIsoLocal()
      const rows = await conn.db
        .select()
        .from(etiquetasAcougue)
        .where(
          and(
            eq(etiquetasAcougue.tenantId, ctx.tenantId),
            eq(etiquetasAcougue.filialId, ctx.filialId),
            eq(etiquetasAcougue.dataPesagem, hoje),
          ),
        )
        .orderBy(desc(etiquetasAcougue.createdAt))
        .limit(200)

      return {
        success: true,
        data_ref: hoje,
        data: rows.map((e) => ({
          id: e.id,
          codigo_etiqueta: e.codigoEtiqueta,
          produto_id: e.produtoId,
          codigo: e.produtoCodigo,
          descricao: e.produtoDescricao,
          especie: e.especie,
          conservacao: e.conservacao,
          unidade: 'KG',
          peso_bruto_kg: toNum(e.pesoBrutoKg, 0),
          tara_kg: toNum(e.taraKg, 0),
          peso_kg: toNum(e.pesoLiquidoKg, 0),
          preco_unitario: toNum(e.precoKg, 0),
          valor_total: toNum(e.valorTotal, 0),
          lote: e.lote,
          validade: e.validade,
          payload_qr: e.payloadQr,
          status: e.status,
          mp_baixada_ean: e.eanMpOrigem || null,
          created_at: e.createdAt,
        })),
      }
    },
  )

  // ── 5) PESAR PRODUTO NO AÇOUGUE: TARA, VALIDADE E PREÇO 100% TRAVADOS NO SERVIDOR! ──
  app.post(
    '/api/acougue/pesar-etiqueta',
    { preHandler: requirePermission(['varejo_acougue']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        produto_id?: string
        peso_bruto_kg?: number
        lote?: string
      }

      const prodId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
      const pesoBruto = Number(body.peso_bruto_kg || 0)
      if (!Number.isFinite(pesoBruto) || pesoBruto <= 0) {
        throw new HttpError(400, 'Informe o peso da balança maior que zero.')
      }

      const out = await conn.db.transaction(async (tx) => {
        const [prod] = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.id, prodId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto não encontrado.')

        const [est] = await tx
          .select()
          .from(varejoEstoque)
          .where(
            and(
              eq(varejoEstoque.tenantId, ctx.tenantId),
              eq(varejoEstoque.filialId, ctx.filialId),
              eq(varejoEstoque.produtoId, prodId),
            ),
          )
          .limit(1)

        // TRAVA 1: Tara puxada exclusivamente do cadastro do produto
        const tara = toNum(prod.taraEmbalagemKg, 0) || toNum(prod.taraPrimariaPecaKg, 0)
        const pesoLiquido = Number((pesoBruto - tara).toFixed(3))
        if (pesoLiquido <= 0) {
          throw new HttpError(
            400,
            `Peso líquido inválido após descontar a tara cadastrada (${tara.toFixed(4)} kg). Informe um peso maior.`,
          )
        }

        // TRAVA 2: Preço puxado exclusivamente da Tabela de Preços Ativa do Açougue
        const { tabela: tabelaAtiva } = await obterTabelaAtivaAcougue(tx, ctx.tenantId, ctx.filialId)
        if (!tabelaAtiva) {
          throw new HttpError(400, 'Nenhuma Tabela de Preços ativa configurada para o Açougue.')
        }
        const [itemTab] = await tx
          .select({ precoVenda: tabelasPrecoItens.precoVenda })
          .from(tabelasPrecoItens)
          .where(
            and(
              eq(tabelasPrecoItens.tabelaPrecoId, tabelaAtiva.id),
              eq(tabelasPrecoItens.produtoId, prodId),
            ),
          )
          .limit(1)

        const precoKg = itemTab ? toNum(itemTab.precoVenda, 0) : 0
        if (precoKg <= 0) {
          throw new HttpError(
            400,
            `O produto "${prod.descricao}" não possui preço cadastrado na tabela ativa (${tabelaAtiva.codigo} — ${tabelaAtiva.nome}).`,
          )
        }
        const valorTotal = Number((pesoLiquido * precoKg).toFixed(2))

        // TRAVA 3: Validade calculada exclusivamente pelos dias definidos no cadastro do produto
        const hoje = hojeIsoLocal()
        const validadeFinal = somarDiasData(hoje, Number(prod.validadeDias ?? 5))
        const especie =
          prod.especie || detectarEspecieProduto({ grupo: prod.grupo, ncm: prod.ncm, descricao: prod.descricao })
        const conservacao = String(prod.conservacao || 'RESFRIADO').toUpperCase()

        // BAIXA AUTOMÁTICA FEFO NA ETIQUETA DE MP VIVA (mesma etiqueta vinda da 1/2!)
        const arvorePais = await tx
          .select({ paiId: produtoArvore.paiId })
          .from(produtoArvore)
          .where(and(eq(produtoArvore.tenantId, ctx.tenantId), eq(produtoArvore.filhoId, prodId)))
        const mpProdIds = Array.from(new Set([...arvorePais.map((a) => a.paiId), prodId]))

        const mpsCandidatas = await tx
          .select()
          .from(estoqueCaixas)
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              eq(estoqueCaixas.status, 'ABERTA_ACOUGUE'),
              inArray(estoqueCaixas.produtoId, mpProdIds),
            ),
          )
          .orderBy(asc(estoqueCaixas.validade), asc(estoqueCaixas.entradaAcougueEm))

        let faltaAbater = pesoLiquido
        let mpPrincipalId: string | null = null
        let mpPrincipalEan = ''
        let loteHerdado = String(body.lote || '').trim()

        for (const mp of mpsCandidatas) {
          if (faltaAbater <= 0.0005) break
          const saldoMp = toNum(mp.pesoRestanteKg, 0)
          if (saldoMp <= 0.0005) continue
          if (!mpPrincipalId) {
            mpPrincipalId = mp.id
            mpPrincipalEan = mp.eanCaixa
            if (!loteHerdado && mp.lote) loteHerdado = mp.lote
          }
          const consumir = Math.min(saldoMp, faltaAbater)
          const novoRestante = Number((saldoMp - consumir).toFixed(3))
          faltaAbater = Number((faltaAbater - consumir).toFixed(3))

          await tx
            .update(estoqueCaixas)
            .set({
              pesoRestanteKg: toDec(novoRestante, 3),
              status: novoRestante <= 0.0005 ? 'CONSUMIDA_ACOUGUE' : 'ABERTA_ACOUGUE',
              updatedAt: new Date(),
            })
            .where(eq(estoqueCaixas.id, mp.id))
        }

        if (!loteHerdado) loteHerdado = `L${hoje.slice(5, 10).replace('-', '')}`

        const codigoEtiqueta = await gerarCodigoDocumento(tx, ctx.tenantId, 'ETQ_ACOUGUE', 'ETQ', 5)
        const payloadQr = montarQrPayloadEtiqueta({
          codigoEtiqueta,
          codigoProduto: est?.codigoBalanca || prod.codigo || '001',
          pesoKg: pesoLiquido,
          valorTotal,
          lote: loteHerdado,
          validade: validadeFinal,
        })

        const etqId = uuidv7()
        await tx.insert(etiquetasAcougue).values({
          id: etqId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigoEtiqueta,
          produtoId: prod.id,
          produtoCodigo: prod.codigo || '',
          produtoDescricao: prod.descricao,
          especie,
          conservacao,
          caixaMpId: mpPrincipalId,
          eanMpOrigem: mpPrincipalEan,
          pesoBrutoKg: toDec(pesoBruto, 3),
          taraKg: toDec(tara, 4),
          pesoLiquidoKg: toDec(pesoLiquido, 3),
          precoKg: toDec(precoKg, 4),
          valorTotal: toDec(valorTotal, 2),
          lote: loteHerdado,
          dataPesagem: hoje,
          validade: validadeFinal,
          payloadQr,
          status: 'EM_ESTOQUE',
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        return {
          id: etqId,
          codigo_etiqueta: codigoEtiqueta,
          produto_id: prod.id,
          codigo: est?.codigoBalanca || prod.codigo || '001',
          descricao: prod.descricao,
          especie,
          conservacao,
          unidade: 'KG',
          peso_bruto_kg: pesoBruto,
          tara_kg: tara,
          peso_kg: pesoLiquido,
          preco_unitario: precoKg,
          valor_total: valorTotal,
          lote: loteHerdado,
          validade: validadeFinal,
          payload_qr: payloadQr,
          mp_baixada_ean: mpPrincipalEan || null,
          aviso_sem_mp_aberta: !mpPrincipalId,
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── 6) CANCELAR ETIQUETA ERRADA DO AÇOUGUE (DEVOLVE PESO À MP DE ORIGEM) ────
  app.post(
    '/api/acougue/etiquetas/:id/cancelar',
    { preHandler: requirePermission(['varejo_acougue']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'etiqueta_id')

      const out = await conn.db.transaction(async (tx) => {
        const [etq] = await tx
          .select()
          .from(etiquetasAcougue)
          .where(and(eq(etiquetasAcougue.id, id), eq(etiquetasAcougue.tenantId, ctx.tenantId)))
          .limit(1)
        if (!etq) throw new HttpError(404, 'Etiqueta não encontrada.')
        if (etq.status !== 'EM_ESTOQUE') {
          throw new HttpError(409, `Apenas etiquetas EM_ESTOQUE podem ser canceladas (status atual: ${etq.status}).`)
        }

        await tx
          .update(etiquetasAcougue)
          .set({ status: 'CANCELADA' })
          .where(eq(etiquetasAcougue.id, etq.id))

        if (etq.caixaMpId) {
          const [mp] = await tx
            .select()
            .from(estoqueCaixas)
            .where(eq(estoqueCaixas.id, etq.caixaMpId))
            .limit(1)
          if (mp) {
            const novoRest = Number((toNum(mp.pesoRestanteKg, 0) + toNum(etq.pesoLiquidoKg, 0)).toFixed(3))
            await tx
              .update(estoqueCaixas)
              .set({
                pesoRestanteKg: toDec(novoRest, 3),
                status: 'ABERTA_ACOUGUE',
                updatedAt: new Date(),
              })
              .where(eq(estoqueCaixas.id, mp.id))
          }
        }
        return { id: etq.id, codigo_etiqueta: etq.codigoEtiqueta, status: 'CANCELADA' }
      })

      return { success: true, data: out }
    },
  )

  // ── 7) INVENTÁRIO DO AÇOUGUE: OPERADOR BIPA ETIQUETAS E PESA MPs PENDENTES ──
  app.post(
    '/api/varejo/inventarios/:id/bipar-etiqueta',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_coletor', 'inventario_gestao']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const body = (req.body || {}) as { codigo?: string }
      const raw = String(body.codigo || '').trim()
      if (!raw) throw new HttpError(400, 'Bipe o QR Code ou código da etiqueta.')

      let codigoAlvo = raw.toUpperCase()
      if (codigoAlvo.startsWith('TRIC|')) {
        const partId = codigoAlvo.split('|').find((p) => p.startsWith('ID='))
        if (partId) codigoAlvo = partId.slice(3).trim()
      }

      const [inv] = await conn.db
        .select()
        .from(varejoInventarios)
        .where(and(eq(varejoInventarios.id, id), eq(varejoInventarios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!inv) throw new HttpError(404, 'Inventário não encontrado.')
      if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi encerrado.')

      const [etq] = await conn.db
        .select()
        .from(etiquetasAcougue)
        .where(
          and(
            eq(etiquetasAcougue.tenantId, ctx.tenantId),
            eq(etiquetasAcougue.filialId, inv.filialId),
            eq(etiquetasAcougue.codigoEtiqueta, codigoAlvo),
          ),
        )
        .limit(1)
      if (!etq) {
        throw new HttpError(404, `Etiqueta "${codigoAlvo}" não encontrada no Açougue desta filial.`)
      }

      const jaBipadas = Array.isArray(inv.etiquetasBipadasJson) ? [...(inv.etiquetasBipadasJson as any[])] : []
      if (jaBipadas.some((e) => e.codigo_etiqueta === etq.codigoEtiqueta)) {
        throw new HttpError(409, `Etiqueta ${etq.codigoEtiqueta} já foi bipada neste inventário!`)
      }

      const registro = {
        etiqueta_id: etq.id,
        codigo_etiqueta: etq.codigoEtiqueta,
        produto_descricao: etq.produtoDescricao,
        peso_liquido_kg: toNum(etq.pesoLiquidoKg, 0),
        status_sistema: etq.status,
        bipada_por: ctx.operador.nome,
        bipada_em: new Date().toISOString(),
      }
      jaBipadas.unshift(registro)

      await conn.db
        .update(varejoInventarios)
        .set({ etiquetasBipadasJson: jaBipadas })
        .where(eq(varejoInventarios.id, id))

      return { success: true, data: registro, total_bipadas: jaBipadas.length }
    },
  )

  app.post(
    '/api/varejo/inventarios/:id/pesar-mp',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_coletor', 'inventario_gestao']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const body = (req.body || {}) as { caixa_id?: string; peso_medido_kg?: number }
      const caixaId = parseUuidOrBadRequest(body.caixa_id, 'caixa_id')
      const pesoMedido = Number(body.peso_medido_kg)
      if (!Number.isFinite(pesoMedido) || pesoMedido < 0) {
        throw new HttpError(400, 'Informe um peso válido (>= 0).')
      }

      const [inv] = await conn.db
        .select()
        .from(varejoInventarios)
        .where(and(eq(varejoInventarios.id, id), eq(varejoInventarios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!inv) throw new HttpError(404, 'Inventário não encontrado.')
      if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi encerrado.')

      const mpsList = Array.isArray(inv.mpsPesadasJson) ? [...(inv.mpsPesadasJson as any[])] : []
      const idx = mpsList.findIndex((m) => String(m.caixa_id) === String(caixaId))
      if (idx < 0) {
        throw new HttpError(404, 'Matéria-Prima não listada neste inventário.')
      }

      const sis = Number(mpsList[idx].peso_sistema_kg || 0)
      const diff = Number((pesoMedido - sis).toFixed(3))
      mpsList[idx] = {
        ...mpsList[idx],
        peso_medido_kg: Number(pesoMedido.toFixed(3)),
        divergencia_kg: diff,
        pesada: true,
        pesada_por: ctx.operador.nome,
        pesada_em: new Date().toISOString(),
      }

      await conn.db
        .update(varejoInventarios)
        .set({ mpsPesadasJson: mpsList })
        .where(eq(varejoInventarios.id, id))

      return { success: true, data: mpsList[idx], mps_pesadas_json: mpsList }
    },
  )
}
