import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  auditoriaAcessos,
  clientes,
  comercialVisitas,
  estoqueCaixas,
  financeiroTitulos,
  pedidos,
  pedidosItens,
  pendenciasSetor,
  produtos,
  tabelasPreco,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { validarPinGerencial } from '../precos/routes.js'
import {
  formatarResumoTravaEstoque,
  registrarPendenciaTravaEstoque,
  verificarEstoquePedido,
} from '../pedidos/travaEstoqueHelper.js'
import { sincronizarTitulosPedidoVenda } from '../financeiro/integracaoHelper.js'
import { hojeIsoLocal, normalizarDataIso, parseUuidOrBadRequest, toDec, toNum } from '../wms/helpers.js'
import {
  avaliarGovernancaComercialPedido,
  lerConfigComercial,
  obterSaudeFinanceiraCliente,
  resolverPrecosClienteProdutos,
} from './governancaHelper.js'

const PERM_COMERCIAL_READ = ['pedidos', 'pedidos_consultar', 'financeiro_pedidos', 'clientes', 'vendedores']
const PERM_COMERCIAL_WRITE = ['pedidos', 'financeiro_pedidos']

function parseCoord(val: unknown, min: number, max: number): string | null {
  if (val === null || val === undefined || String(val).trim() === '') return null
  const n = Number(String(val).replace(',', '.'))
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n.toFixed(7)
}

function isGestorComercial(operador: { nivel?: string; perfil?: string; permissoes?: Record<string, boolean> }): boolean {
  const niv = String(operador.nivel || '').toUpperCase()
  const perf = String(operador.perfil || '').toUpperCase()
  return (
    niv === 'MASTER' ||
    niv === 'ADMINISTRADOR' ||
    perf === 'GERENTE_LOJA' ||
    perf === 'DIRETORIA' ||
    operador.permissoes?.aprovar_margem_comercial === true
  )
}

export function registerComercialRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── 1) CONFIGURAÇÃO COMERCIAL ATIVA ─────────────────────────────────────────
  app.get(
    '/api/comercial/config',
    { preHandler: requirePermission(PERM_COMERCIAL_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const config = await lerConfigComercial(conn.db, ctx.tenantId)
      return { success: true, data: config }
    },
  )

  // ── 2) RESUMO DO VENDEDOR / COCKPIT COMERCIAL, METAS & CARTEIRA ─────────────
  app.get(
    '/api/comercial/resumo-vendedor',
    { preHandler: requirePermission(PERM_COMERCIAL_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { mes?: string; vendedor_id?: string }
      const hoje = hojeIsoLocal()
      const mesRef = q.mes && /^\d{4}-\d{2}$/.test(q.mes) ? q.mes : hoje.slice(0, 7)
      const dataIni = `${mesRef}-01`
      const [anoNum, mesNum] = mesRef.split('-').map(Number)
      const ultimoDia = new Date(Date.UTC(anoNum, mesNum, 0)).getUTCDate()
      const dataFim = `${mesRef}-${String(ultimoDia).padStart(2, '0')}`

      const gestor = isGestorComercial(ctx.operador)

      const [vendedoresRows, config] = await Promise.all([
        conn.db
          .select()
          .from(vendedores)
          .where(and(eq(vendedores.tenantId, ctx.tenantId), eq(vendedores.ativo, 1)))
          .orderBy(asc(vendedores.nome)),
        lerConfigComercial(conn.db, ctx.tenantId),
      ])

      const meuVendedor = vendedoresRows.find((v) => v.operadorId === ctx.operador.id) || null
      let vendedorFiltroId: string | null = null
      if (q.vendedor_id && q.vendedor_id !== 'TODOS') {
        vendedorFiltroId = parseUuidOrBadRequest(q.vendedor_id, 'vendedor_id')
      } else if (!gestor && meuVendedor) {
        vendedorFiltroId = meuVendedor.id
      } else if (!q.vendedor_id && meuVendedor) {
        vendedorFiltroId = meuVendedor.id
      }

      const vendSelecionado = vendedorFiltroId
        ? vendedoresRows.find((v) => v.id === vendedorFiltroId) || null
        : null

      // Pedidos do mês (excluindo CANCELADO e RASCUNHO)
      const pedidosMesRes = await conn.db.execute(sql`
        SELECT
          p.id,
          p.codigo,
          p.vendedor_id,
          p.cliente_id,
          p.cliente,
          p.status,
          p.valor_total,
          p.custo_total_estimado,
          p.margem_bruta_pct,
          p.created_at,
          COALESCE((SELECT SUM(pi.qtd_kg_solicitada) FROM pedidos_itens pi WHERE pi.pedido_id = p.id), 0) AS total_kg
        FROM pedidos p
        WHERE p.tenant_id = ${ctx.tenantId}
          AND p.filial_id = ${ctx.filialId}
          AND p.status NOT IN ('CANCELADO', 'RASCUNHO')
          AND DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo') >= ${dataIni}::date
          AND DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo') <= ${dataFim}::date
      `)

      const todosPedidosMes = (pedidosMesRes.rows || []) as Array<{
        id: string
        codigo: string
        vendedor_id: string | null
        cliente_id: string | null
        cliente: string
        status: string
        valor_total: string
        custo_total_estimado: string
        margem_bruta_pct: string | null
        created_at: string
        total_kg: string
      }>

      const pedidosEscopo = vendedorFiltroId
        ? todosPedidosMes.filter((p) => p.vendedor_id === vendedorFiltroId)
        : todosPedidosMes

      const calcularResumoPedidos = (
        lista: typeof todosPedidosMes,
        vendMeta?: (typeof vendedoresRows)[number] | null,
      ) => {
        const valorTotal = lista.reduce((s, p) => s + toNum(p.valor_total, 0), 0)
        const kgTotal = lista.reduce((s, p) => s + toNum(p.total_kg, 0), 0)
        const custoTotal = lista.reduce((s, p) => s + toNum(p.custo_total_estimado, 0), 0)
        const receitaComCusto = lista
          .filter((p) => toNum(p.custo_total_estimado, 0) > 0)
          .reduce((s, p) => s + toNum(p.valor_total, 0), 0)
        const margemMediaPct =
          receitaComCusto > 0 && custoTotal > 0
            ? Number((((receitaComCusto - custoTotal) / receitaComCusto) * 100).toFixed(2))
            : null

        const bloqueadosComercial = lista.filter((p) => p.status === 'BLOQUEADO_COMERCIAL').length
        const qtd = lista.length
        const ticketMedio = qtd > 0 ? Number((valorTotal / qtd).toFixed(2)) : 0

        let comissaoEst = 0
        if (vendMeta) {
          const pct = toNum(vendMeta.pctComissao, 0)
          if (vendMeta.tipoComissao === 'VALOR_KG') {
            comissaoEst = kgTotal * pct
          } else if (vendMeta.tipoComissao === 'PCT_MARGEM') {
            const lucro = Math.max(0, receitaComCusto - custoTotal)
            comissaoEst = lucro * (pct / 100)
          } else {
            comissaoEst = valorTotal * (pct / 100)
          }
        }

        const metaKg = vendMeta
          ? toNum(vendMeta.metaMensalKg, 0)
          : vendedoresRows.reduce((s, v) => s + toNum(v.metaMensalKg, 0), 0)
        const metaValor = vendMeta
          ? toNum(vendMeta.metaMensalValor, 0)
          : vendedoresRows.reduce((s, v) => s + toNum(v.metaMensalValor, 0), 0)

        return {
          qtd_pedidos: qtd,
          valor_vendido: Number(valorTotal.toFixed(2)),
          kg_vendido: Number(kgTotal.toFixed(2)),
          custo_estimado: Number(custoTotal.toFixed(2)),
          margem_media_pct: margemMediaPct,
          ticket_medio: ticketMedio,
          pedidos_bloqueados_comercial: bloqueadosComercial,
          comissao_estimada: Number(comissaoEst.toFixed(2)),
          meta_mensal_kg: Number(metaKg.toFixed(2)),
          meta_mensal_valor: Number(metaValor.toFixed(2)),
          atingimento_kg_pct: metaKg > 0 ? Number(((kgTotal / metaKg) * 100).toFixed(1)) : null,
          atingimento_valor_pct: metaValor > 0 ? Number(((valorTotal / metaValor) * 100).toFixed(1)) : null,
        }
      }

      const kpis = calcularResumoPedidos(pedidosEscopo, vendSelecionado)

      // Ranking da equipe comercial
      const rankingVendedores = vendedoresRows
        .map((v) => {
          const peds = todosPedidosMes.filter((p) => p.vendedor_id === v.id)
          const r = calcularResumoPedidos(peds, v)
          return {
            vendedor_id: v.id,
            codigo: v.codigo,
            sigla: v.sigla,
            nome: v.nome,
            tipo_comissao: v.tipoComissao,
            pct_comissao: toNum(v.pctComissao, 0),
            desconto_max_pct: toNum(v.descontoMaxPct, config.desconto_max_vendedor_pct),
            margem_minima_pct: v.margemMinimaPct != null ? toNum(v.margemMinimaPct, 0) : null,
            ...r,
          }
        })
        .sort((a, b) => b.valor_vendido - a.valor_vendido)

      // Carteira de clientes (com saúde financeira + dias sem comprar)
      const carteiraRes = await conn.db.execute(sql`
        SELECT
          c.id,
          c.codigo,
          c.razao_social,
          c.nome_fantasia,
          c.cidade,
          c.uf,
          c.telefone,
          c.rota_padrao_nome,
          c.vendedor_padrao_id,
          v.nome AS vendedor_nome,
          c.tabela_preco_id,
          tp.nome AS tabela_preco_nome,
          c.limite_credito,
          c.bloqueado_financeiro,
          c.desconto_ativo,
          c.desconto_max_pct,
          c.permite_pagamento_entrega,
          COALESCE((
            SELECT SUM(ft.saldo_aberto)
            FROM financeiro_titulos ft
            WHERE ft.tenant_id = c.tenant_id
              AND ft.cliente_id = c.id
              AND ft.tipo = 'RECEBER'
              AND ft.status IN ('ABERTO', 'PARCIAL')
          ), 0) AS credito_utilizado,
          COALESCE((
            SELECT SUM(ft.saldo_aberto)
            FROM financeiro_titulos ft
            WHERE ft.tenant_id = c.tenant_id
              AND ft.cliente_id = c.id
              AND ft.tipo = 'RECEBER'
              AND ft.status IN ('ABERTO', 'PARCIAL')
              AND ft.data_vencimento < CURRENT_DATE - (${config.dias_tolerancia_inadimplencia}::int)
          ), 0) AS valor_vencido,
          COALESCE((
            SELECT COUNT(*)::int
            FROM financeiro_titulos ft
            WHERE ft.tenant_id = c.tenant_id
              AND ft.cliente_id = c.id
              AND ft.tipo = 'RECEBER'
              AND ft.status IN ('ABERTO', 'PARCIAL')
              AND ft.data_vencimento < CURRENT_DATE - (${config.dias_tolerancia_inadimplencia}::int)
          ), 0) AS qtd_vencidos,
          (
            SELECT MAX(p.created_at)
            FROM pedidos p
            WHERE p.tenant_id = c.tenant_id
              AND p.cliente_id = c.id
              AND p.status NOT IN ('CANCELADO', 'RASCUNHO')
          ) AS ultima_compra_em,
          COALESCE((
            SELECT COUNT(*)::int
            FROM cliente_produto_espec e
            WHERE e.cliente_id = c.id AND e.alerta_reclamacao = 1
          ), 0) AS qtd_alertas_qualidade
        FROM clientes c
        LEFT JOIN vendedores v ON v.id = c.vendedor_padrao_id
        LEFT JOIN tabelas_preco tp ON tp.id = c.tabela_preco_id
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.ativo = 1
          AND c.tipo_cliente IN ('ATACADO', 'AMBOS')
          ${vendedorFiltroId ? sql`AND (c.vendedor_padrao_id = ${vendedorFiltroId} OR c.vendedor_padrao_id IS NULL)` : sql``}
        ORDER BY c.is_padrao DESC, c.razao_social ASC
        LIMIT 200
      `)

      const agoraMs = Date.now()
      const carteiraClientes = ((carteiraRes.rows || []) as Array<Record<string, unknown>>).map((c) => {
        const limite = toNum(c.limite_credito, 0)
        const usado = toNum(c.credito_utilizado, 0)
        const vencido = toNum(c.valor_vencido, 0)
        const qtdVenc = Number(c.qtd_vencidos || 0)
        const bloqueado = Number(c.bloqueado_financeiro || 0) === 1
        const ultMs = c.ultima_compra_em ? new Date(String(c.ultima_compra_em)).getTime() : null
        const diasSemComprar =
          ultMs && !Number.isNaN(ultMs) ? Math.max(0, Math.floor((agoraMs - ultMs) / 86_400_000)) : null

        let semaforo: 'VERDE' | 'AMARELO' | 'VERMELHO' = 'VERDE'
        if (bloqueado || qtdVenc > 0 || (limite > 0 && usado > limite)) semaforo = 'VERMELHO'
        else if (limite > 0 && usado >= limite * 0.8) semaforo = 'AMARELO'

        return {
          id: String(c.id),
          codigo: String(c.codigo || ''),
          razao_social: String(c.razao_social || ''),
          nome_fantasia: String(c.nome_fantasia || c.razao_social || ''),
          cidade: String(c.cidade || ''),
          uf: String(c.uf || ''),
          telefone: String(c.telefone || ''),
          rota_padrao_nome: String(c.rota_padrao_nome || ''),
          vendedor_padrao_id: c.vendedor_padrao_id ? String(c.vendedor_padrao_id) : null,
          vendedor_nome: c.vendedor_nome ? String(c.vendedor_nome) : '',
          tabela_preco_id: c.tabela_preco_id ? String(c.tabela_preco_id) : null,
          tabela_preco_nome: c.tabela_preco_nome ? String(c.tabela_preco_nome) : '',
          limite_credito: Number(limite.toFixed(2)),
          credito_utilizado: Number(usado.toFixed(2)),
          credito_disponivel: limite > 0 ? Math.max(0, Number((limite - usado).toFixed(2))) : 0,
          valor_vencido: Number(vencido.toFixed(2)),
          qtd_vencidos: qtdVenc,
          bloqueado_financeiro: bloqueado,
          desconto_ativo: Number(c.desconto_ativo || 0) === 1,
          desconto_max_pct: toNum(c.desconto_max_pct, 0),
          permite_pagamento_entrega: Number(c.permite_pagamento_entrega ?? 1) === 1,
          ultima_compra_em: c.ultima_compra_em || null,
          dias_sem_comprar: diasSemComprar,
          qtd_alertas_qualidade: Number(c.qtd_alertas_qualidade || 0),
          semaforo,
        }
      })

      // Total geral de pedidos bloqueados comercialmente aguardando aprovação
      const [{ totalBloqAprov }] = await conn.db
        .select({ totalBloqAprov: sql<number>`COUNT(*)::int` })
        .from(pedidos)
        .where(
          and(
            eq(pedidos.tenantId, ctx.tenantId),
            eq(pedidos.filialId, ctx.filialId),
            eq(pedidos.status, 'BLOQUEADO_COMERCIAL'),
          ),
        )

      return {
        success: true,
        mes: mesRef,
        is_gestor: gestor,
        config_comercial: config,
        vendedor_atual: vendSelecionado
          ? {
              id: vendSelecionado.id,
              codigo: vendSelecionado.codigo,
              sigla: vendSelecionado.sigla,
              nome: vendSelecionado.nome,
              desconto_max_pct: toNum(vendSelecionado.descontoMaxPct, config.desconto_max_vendedor_pct),
              margem_minima_pct:
                vendSelecionado.margemMinimaPct != null
                  ? toNum(vendSelecionado.margemMinimaPct, config.margem_minima_padrao_pct)
                  : config.margem_minima_padrao_pct,
              tipo_comissao: vendSelecionado.tipoComissao,
              pct_comissao: toNum(vendSelecionado.pctComissao, 0),
            }
          : null,
        vendedores: vendedoresRows.map((v) => ({
          id: v.id,
          codigo: v.codigo,
          sigla: v.sigla,
          nome: v.nome,
          desconto_max_pct: toNum(v.descontoMaxPct, config.desconto_max_vendedor_pct),
          margem_minima_pct: v.margemMinimaPct != null ? toNum(v.margemMinimaPct, 0) : null,
        })),
        kpis: {
          ...kpis,
          fila_aprovacao_total: Number(totalBloqAprov || 0),
        },
        ranking_vendedores: rankingVendedores,
        carteira_clientes: carteiraClientes,
      }
    },
  )

  // ── 3) CATÁLOGO B2B PERSONALIZADO DO CLIENTE (PREÇO EM CASCATA + SALDO + ÚLTIMOS PEDIDOS) ─
  app.get(
    '/api/comercial/catalogo-cliente/:clienteId',
    { preHandler: requirePermission(PERM_COMERCIAL_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const clienteId = parseUuidOrBadRequest((req.params as { clienteId: string }).clienteId, 'cliente_id')
      const q = (req.query || {}) as { tabela_preco_id?: string; q?: string }

      const [cli] = await conn.db
        .select()
        .from(clientes)
        .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!cli) throw new HttpError(404, 'Cliente não encontrado.')

      const config = await lerConfigComercial(conn.db, ctx.tenantId)
      const tabelaOverrideId = q.tabela_preco_id
        ? parseUuidOrBadRequest(q.tabela_preco_id, 'tabela_preco_id')
        : cli.tabelaPrecoId || null

      const [saude, tabelasAtivas, saldosRes, ultimosPeds, vendVinculadoRows] = await Promise.all([
        obterSaudeFinanceiraCliente(conn.db, {
          tenantId: ctx.tenantId,
          clienteId,
          diasTolerancia: config.dias_tolerancia_inadimplencia,
        }),
        conn.db
          .select({
            id: tabelasPreco.id,
            codigo: tabelasPreco.codigo,
            nome: tabelasPreco.nome,
            finalidade: tabelasPreco.finalidade,
            padrao: tabelasPreco.padrao,
          })
          .from(tabelasPreco)
          .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.ativo, 1)))
          .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.nome)),
        conn.db.execute(sql`
          SELECT
            p.id,
            p.codigo,
            p.descricao,
            p.unidade,
            p.especie,
            p.conservacao,
            p.grupo,
            p.peso_padrao_cx,
            COALESCE(est.saldo_kg, 0) AS saldo_kg,
            COALESCE(est.qtd_caixas, 0) AS qtd_caixas,
            COALESCE(est.peso_medio_cx, p.peso_padrao_cx, 0) AS peso_medio_cx
          FROM produtos p
          LEFT JOIN (
            SELECT
              produto_id,
              ROUND(SUM(peso_kg), 3) AS saldo_kg,
              COUNT(*)::int AS qtd_caixas,
              ROUND(AVG(peso_kg), 3) AS peso_medio_cx
            FROM estoque_caixas
            WHERE tenant_id = ${ctx.tenantId}
              AND filial_id = ${ctx.filialId}
              AND status = 'DISPONIVEL'
            GROUP BY produto_id
          ) est ON est.produto_id = p.id
          WHERE p.tenant_id = ${ctx.tenantId}
            AND p.ativo = 1
            AND COALESCE(p.especie, '') != 'INSUMO'
          ORDER BY (CASE WHEN COALESCE(est.saldo_kg, 0) > 0 THEN 0 ELSE 1 END), p.descricao ASC
        `),
        conn.db
          .select({
            id: pedidos.id,
            codigo: pedidos.codigo,
            titulo: pedidos.titulo,
            status: pedidos.status,
            valor_total: pedidos.valorTotal,
            margem_bruta_pct: pedidos.margemBrutaPct,
            created_at: pedidos.createdAt,
          })
          .from(pedidos)
          .where(
            and(
              eq(pedidos.tenantId, ctx.tenantId),
              eq(pedidos.clienteId, clienteId),
              sql`${pedidos.status} != 'CANCELADO'`,
            ),
          )
          .orderBy(desc(pedidos.createdAt))
          .limit(5),
        conn.db
          .select()
          .from(vendedores)
          .where(
            and(
              eq(vendedores.tenantId, ctx.tenantId),
              eq(vendedores.operadorId, ctx.operador.id),
              eq(vendedores.ativo, 1),
            ),
          )
          .limit(1),
      ])

      const prodRows = (saldosRes.rows || []) as Array<Record<string, unknown>>
      const prodIds = prodRows.map((r) => String(r.id))
      const precosRes = await resolverPrecosClienteProdutos(conn.db, {
        tenantId: ctx.tenantId,
        clienteId,
        tabelaPrecoId: tabelaOverrideId,
        produtoIds: prodIds,
      })

      // Busca itens dos últimos 5 pedidos para suportar "Repetir Último Pedido" em 1 toque
      const ultPedIds = ultimosPeds.map((p) => p.id)
      const ultItensRows =
        ultPedIds.length > 0
          ? await conn.db
              .select({
                pedido_id: pedidosItens.pedidoId,
                produto_id: pedidosItens.produtoId,
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                qtd_kg_solicitada: pedidosItens.qtdKgSolicitada,
                qtd_caixas_solicitada: pedidosItens.qtdCaixasSolicitada,
                unidade_solicitada: pedidosItens.unidadeSolicitada,
                preco_unitario: pedidosItens.precoUnitario,
              })
              .from(pedidosItens)
              .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
              .where(inArray(pedidosItens.pedidoId, ultPedIds))
          : []

      const itensPorUltPed = new Map<string, Array<Record<string, unknown>>>()
      for (const it of ultItensRows) {
        const arr = itensPorUltPed.get(it.pedido_id) || []
        arr.push({
          produto_id: it.produto_id,
          produto_codigo: it.produto_codigo || '',
          produto_descricao: it.produto_descricao,
          qtd_kg_solicitada: toNum(it.qtd_kg_solicitada, 0),
          qtd_caixas_solicitada: it.qtd_caixas_solicitada != null ? toNum(it.qtd_caixas_solicitada, 0) : null,
          unidade_solicitada: it.unidade_solicitada,
          preco_unitario: toNum(it.preco_unitario, 0),
        })
        itensPorUltPed.set(it.pedido_id, arr)
      }

      const busca = String(q.q || '').trim().toLowerCase()
      const catalogo = prodRows
        .map((r) => {
          const id = String(r.id)
          const pInfo = precosRes.precos.get(id)
          return {
            id,
            codigo: String(r.codigo || ''),
            descricao: String(r.descricao || ''),
            unidade: String(r.unidade || 'KG'),
            especie: String(r.especie || ''),
            conservacao: String(r.conservacao || 'RESFRIADO'),
            grupo: String(r.grupo || ''),
            saldo_kg: toNum(r.saldo_kg, 0),
            qtd_caixas: Number(r.qtd_caixas || 0),
            peso_medio_cx: toNum(r.peso_medio_cx, 0),
            preco_sugerido: pInfo?.preco_sugerido ?? 0,
            origem_preco: pInfo?.origem_preco ?? 'CADASTRO_BASE',
            tabela_preco_nome: pInfo?.tabela_preco_nome ?? '',
            custo_unitario: pInfo?.custo_unitario ?? 0,
            margem_sugerida_pct: pInfo?.margem_sugerida_pct ?? null,
            ultima_venda_preco: pInfo?.ultima_venda_preco ?? null,
            preco_negociado: pInfo?.preco_negociado ?? null,
            codigo_aux_cliente: pInfo?.codigo_aux_cliente ?? '',
            especificacao_corte: pInfo?.especificacao_corte ?? '',
            alerta_reclamacao: pInfo?.alerta_reclamacao ?? false,
            alerta_descricao: pInfo?.alerta_descricao ?? '',
          }
        })
        .filter((item) => {
          if (!busca) return true
          return (
            item.descricao.toLowerCase().includes(busca) ||
            item.codigo.toLowerCase().includes(busca) ||
            item.codigo_aux_cliente.toLowerCase().includes(busca)
          )
        })

      const vendAtual = vendVinculadoRows[0] || null
      const descontoMaxEfetivo = Math.max(
        vendAtual ? toNum(vendAtual.descontoMaxPct, config.desconto_max_vendedor_pct) : config.desconto_max_vendedor_pct,
        saude?.desconto_ativo ? saude.desconto_max_pct : 0,
      )
      const margemMinimaEfetiva =
        vendAtual?.margemMinimaPct != null
          ? toNum(vendAtual.margemMinimaPct, config.margem_minima_padrao_pct)
          : config.margem_minima_padrao_pct

      return {
        success: true,
        cliente: {
          id: cli.id,
          codigo: cli.codigo,
          razao_social: cli.razaoSocial,
          nome_fantasia: cli.nomeFantasia || cli.razaoSocial,
          cidade: cli.cidade,
          uf: cli.uf,
          telefone: cli.telefone,
          vendedor_padrao_id: cli.vendedorPadraoId,
          forma_pagamento_padrao_id: cli.formaPagamentoPadraoId,
          local_cobranca_padrao_id: cli.localCobrancaPadraoId,
          marchante_padrao: cli.marchantePadrao,
          tabela_preco_id: cli.tabelaPrecoId,
          permite_pagamento_entrega: Number(cli.permitePagamentoEntrega ?? 1) === 1,
        },
        saude_financeira: saude,
        tabela_usada_id: precosRes.tabelaUsadaId,
        tabela_usada_nome: precosRes.tabelaUsadaNome,
        tabelas_preco: tabelasAtivas.map((t) => ({
          id: t.id,
          codigo: t.codigo,
          nome: t.nome,
          finalidade: t.finalidade,
          padrao: Number(t.padrao) === 1,
        })),
        regras_efetivas: {
          ...config,
          desconto_max_efetivo_pct: Number(descontoMaxEfetivo.toFixed(2)),
          margem_minima_efetiva_pct: Number(margemMinimaEfetiva.toFixed(2)),
          vendedor_logado_id: vendAtual?.id || null,
        },
        ultimos_pedidos: ultimosPeds.map((p) => ({
          ...p,
          valor_total: toNum(p.valor_total, 0),
          margem_bruta_pct: p.margem_bruta_pct != null ? toNum(p.margem_bruta_pct, 0) : null,
          itens: itensPorUltPed.get(p.id) || [],
        })),
        catalogo,
      }
    },
  )

  // ── 4) SIMULADOR DE MARGEM & TRAVA COMERCIAL (SEM GRAVAR NO BANCO) ──────────
  app.post(
    '/api/comercial/simular-margem',
    { preHandler: requirePermission(PERM_COMERCIAL_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        cliente_id?: string | null
        vendedor_id?: string | null
        tabela_preco_id?: string | null
        pagamento_na_entrega?: boolean | number
        forcar_regras?: boolean
        itens?: Array<{
          produto_id: string
          qtd_kg_solicitada: number
          preco_unitario: number
          desconto_pct?: number
          desconto_valor?: number
        }>
      }

      const itensValidos = Array.isArray(body.itens)
        ? body.itens
            .filter((i) => i && i.produto_id && toNum(i.qtd_kg_solicitada, 0) > 0)
            .map((i) => ({
              produto_id: parseUuidOrBadRequest(i.produto_id, 'produto_id'),
              qtd_kg_solicitada: toNum(i.qtd_kg_solicitada, 0),
              preco_unitario: toNum(i.preco_unitario, 0),
              desconto_pct: toNum(i.desconto_pct, 0),
              desconto_valor: toNum(i.desconto_valor, 0),
            }))
        : []

      const res = await avaliarGovernancaComercialPedido(conn.db, {
        tenantId: ctx.tenantId,
        clienteId: body.cliente_id ? parseUuidOrBadRequest(body.cliente_id, 'cliente_id') : null,
        vendedorId: body.vendedor_id ? parseUuidOrBadRequest(body.vendedor_id, 'vendedor_id') : null,
        tabelaPrecoId: body.tabela_preco_id ? parseUuidOrBadRequest(body.tabela_preco_id, 'tabela_preco_id') : null,
        pagamentoNaEntrega: Boolean(body.pagamento_na_entrega),
        itens: itensValidos,
        forcarAvaliacaoEstrita: body.forcar_regras === true,
      })

      return {
        success: true,
        data: {
          receita_total: res.receita_total,
          custo_total_estimado: res.custo_total_estimado,
          margem_bruta_pct: res.margem_bruta_pct,
          margem_minima_aplicada_pct: res.margem_minima_aplicada_pct,
          desconto_max_aplicado_pct: res.desconto_max_aplicado_pct,
          saude_cliente: res.saude_cliente,
          alerta: res.alerta,
          itens: Object.fromEntries(res.itens_calculados.entries()),
        },
      }
    },
  )

  // ── 5) MESA DE APROVAÇÃO COMERCIAL (FILA DE PEDIDOS BLOQUEADOS) ─────────────
  app.get(
    '/api/comercial/aprovacoes',
    { preHandler: requirePermission(PERM_COMERCIAL_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { status?: string }
      const modo = String(q.status || 'PENDENTES').toUpperCase()

      const conds = [eq(pedidos.tenantId, ctx.tenantId), eq(pedidos.filialId, ctx.filialId)]
      if (modo === 'HISTORICO') {
        conds.push(sql`${pedidos.aprovadoComercialEm} IS NOT NULL`)
      } else if (modo !== 'TODOS') {
        conds.push(eq(pedidos.status, 'BLOQUEADO_COMERCIAL'))
      }

      const rows = await conn.db
        .select({
          id: pedidos.id,
          codigo: pedidos.codigo,
          titulo: pedidos.titulo,
          cliente_id: pedidos.clienteId,
          cliente: pedidos.cliente,
          vendedor_id: pedidos.vendedorId,
          vendedor_nome: vendedores.nome,
          vendedor_sigla: vendedores.sigla,
          origem_pedido: pedidos.origemPedido,
          status: pedidos.status,
          previsao_entrega: pedidos.previsaoEntrega,
          valor_total: pedidos.valorTotal,
          custo_total_estimado: pedidos.custoTotalEstimado,
          margem_bruta_pct: pedidos.margemBrutaPct,
          alerta_comercial: pedidos.alertaComercialJson,
          aprovado_comercial_por_nome: pedidos.aprovadoComercialPorNome,
          aprovado_comercial_em: pedidos.aprovadoComercialEm,
          aprovado_comercial_obs: pedidos.aprovadoComercialObs,
          criado_por_nome: pedidos.criadoPorNome,
          created_at: pedidos.createdAt,
        })
        .from(pedidos)
        .leftJoin(vendedores, eq(vendedores.id, pedidos.vendedorId))
        .where(and(...conds))
        .orderBy(desc(pedidos.createdAt))
        .limit(100)

      const pedIds = rows.map((r) => r.id)
      const itensRows =
        pedIds.length > 0
          ? await conn.db
              .select({
                pedido_id: pedidosItens.pedidoId,
                produto_id: pedidosItens.produtoId,
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                qtd_kg_solicitada: pedidosItens.qtdKgSolicitada,
                preco_unitario: pedidosItens.precoUnitario,
                preco_tabela_ref: pedidosItens.precoTabelaRef,
                custo_unitario_ref: pedidosItens.custoUnitarioRef,
                margem_item_pct: pedidosItens.margemItemPct,
                desconto_pct: pedidosItens.descontoPct,
                desconto_valor: pedidosItens.descontoValor,
              })
              .from(pedidosItens)
              .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
              .where(inArray(pedidosItens.pedidoId, pedIds))
          : []

      const itensMap = new Map<string, Array<Record<string, unknown>>>()
      for (const it of itensRows) {
        const arr = itensMap.get(it.pedido_id) || []
        arr.push({
          produto_id: it.produto_id,
          produto_codigo: it.produto_codigo || '',
          produto_descricao: it.produto_descricao,
          qtd_kg_solicitada: toNum(it.qtd_kg_solicitada, 0),
          preco_unitario: toNum(it.preco_unitario, 0),
          preco_tabela_ref: it.preco_tabela_ref != null ? toNum(it.preco_tabela_ref, 0) : null,
          custo_unitario_ref: toNum(it.custo_unitario_ref, 0),
          margem_item_pct: it.margem_item_pct != null ? toNum(it.margem_item_pct, 0) : null,
          desconto_pct: toNum(it.desconto_pct, 0),
          desconto_valor: toNum(it.desconto_valor, 0),
        })
        itensMap.set(it.pedido_id, arr)
      }

      return {
        success: true,
        is_gestor: isGestorComercial(ctx.operador),
        data: rows.map((r) => ({
          ...r,
          valor_total: toNum(r.valor_total, 0),
          custo_total_estimado: toNum(r.custo_total_estimado, 0),
          margem_bruta_pct: r.margem_bruta_pct != null ? toNum(r.margem_bruta_pct, 0) : null,
          alerta_comercial:
            r.alerta_comercial && typeof r.alerta_comercial === 'object' ? r.alerta_comercial : {},
          itens: itensMap.get(r.id) || [],
        })),
      }
    },
  )

  // ── 6) APROVAR TRAVA COMERCIAL (GESTOR DIRETO OU PIN GERENCIAL) ─────────────
  app.post(
    '/api/comercial/pedidos/:id/aprovar',
    { preHandler: requirePermission(PERM_COMERCIAL_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const pedidoId = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_id')
      const body = (req.body || {}) as {
        pin_gerencial?: string
        observacao?: string
        ignorar_trava_estoque?: boolean
      }

      let aprovadorId = ctx.operador.id
      let aprovadorNome = ctx.operador.nome
      const gestorDireto = isGestorComercial(ctx.operador)

      if (body.pin_gerencial && String(body.pin_gerencial).trim()) {
        const gestorPin = await validarPinGerencial(conn.db, ctx.tenantId, body.pin_gerencial)
        aprovadorId = gestorPin.id
        aprovadorNome = gestorPin.nome
      } else if (!gestorDireto) {
        throw new HttpError(
          403,
          'Aprovação de Trava Comercial/Margem exige perfil Gerencial/Master ou validação por PIN Gerencial.',
        )
      }

      const resultado = await conn.db.transaction(async (tx) => {
        const [ped] = await tx
          .select()
          .from(pedidos)
          .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!ped) throw new HttpError(404, 'Pedido não encontrado.')
        if (ped.status !== 'BLOQUEADO_COMERCIAL') {
          throw new HttpError(409, `Pedido ${ped.codigo} não está em Trava Comercial (status atual: ${ped.status}).`)
        }

        const itensPed = await tx
          .select({ produto_id: pedidosItens.produtoId, qtd_kg_solicitada: pedidosItens.qtdKgSolicitada })
          .from(pedidosItens)
          .where(eq(pedidosItens.pedidoId, pedidoId))

        const itensCheck = itensPed.map((i) => ({
          produto_id: i.produto_id,
          qtd_kg_solicitada: toNum(i.qtd_kg_solicitada, 0),
        }))

        const estoqueCheck =
          body.ignorar_trava_estoque === true
            ? { suficiente: true, insuficientes: [] }
            : await verificarEstoquePedido(tx, {
                tenantId: ctx.tenantId,
                filialId: ctx.filialId,
                ignorePedidoId: pedidoId,
                itens: itensCheck,
              })

        const nextStatus = estoqueCheck.suficiente ? 'LIBERADO' : 'BLOQUEADO_ESTOQUE'
        const now = new Date()
        const obsTrim = String(body.observacao || '').trim()

        await tx
          .update(pedidos)
          .set({
            status: nextStatus,
            liberadoAt: nextStatus === 'LIBERADO' ? now : ped.liberadoAt,
            aprovadoComercialPorId: aprovadorId,
            aprovadoComercialPorNome: aprovadorNome,
            aprovadoComercialEm: now,
            aprovadoComercialObs: obsTrim || 'Aprovado pela Mesa Comercial',
            updatedAt: now,
          })
          .where(eq(pedidos.id, pedidoId))

        await tx
          .update(pendenciasSetor)
          .set({ status: 'CONCLUIDA', concluidaPorId: aprovadorId, concluidaAt: now })
          .where(
            and(
              eq(pendenciasSetor.tenantId, ctx.tenantId),
              eq(pendenciasSetor.referenciaId, pedidoId),
              eq(pendenciasSetor.tipoPendencia, 'TRAVA_COMERCIAL_PEDIDO'),
            ),
          )

        if (nextStatus === 'BLOQUEADO_ESTOQUE' && estoqueCheck.insuficientes.length > 0) {
          await registrarPendenciaTravaEstoque(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            pedidoId,
            codigoPedido: ped.codigo,
            clienteNome: ped.cliente,
            insuficientes: estoqueCheck.insuficientes,
          })
        }

        await sincronizarTitulosPedidoVenda(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          pedidoId,
          operadorId: aprovadorId,
          operadorNome: aprovadorNome,
        })

        await tx.insert(auditoriaAcessos).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          targetUserId: ped.criadoPorId || null,
          targetUserNome: ped.codigo,
          acao: 'APROVACAO_TRAVA_COMERCIAL',
          detalhesAntes: { status: 'BLOQUEADO_COMERCIAL', alerta: ped.alertaComercialJson },
          detalhesDepois: {
            status: nextStatus,
            aprovado_por: aprovadorNome,
            observacao: obsTrim,
            margem_bruta_pct: ped.margemBrutaPct,
          },
          executorId: aprovadorId,
          executorNome: aprovadorNome,
        })

        return {
          id: pedidoId,
          codigo: ped.codigo,
          status: nextStatus,
          aprovado_por: aprovadorNome,
          trava_estoque: nextStatus === 'BLOQUEADO_ESTOQUE',
          motivo_trava_estoque:
            nextStatus === 'BLOQUEADO_ESTOQUE' ? formatarResumoTravaEstoque(estoqueCheck.insuficientes) : '',
        }
      })

      return { success: true, ...resultado }
    },
  )

  // ── 7) REJEITAR / DEVOLVER PEDIDO EM TRAVA COMERCIAL PARA RASCUNHO ──────────
  app.post(
    '/api/comercial/pedidos/:id/rejeitar',
    { preHandler: requirePermission(PERM_COMERCIAL_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const pedidoId = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_id')
      const body = (req.body || {}) as { pin_gerencial?: string; motivo?: string }

      let executorId = ctx.operador.id
      let executorNome = ctx.operador.nome
      if (body.pin_gerencial && String(body.pin_gerencial).trim()) {
        const g = await validarPinGerencial(conn.db, ctx.tenantId, body.pin_gerencial)
        executorId = g.id
        executorNome = g.nome
      } else if (!isGestorComercial(ctx.operador)) {
        throw new HttpError(403, 'Devolução de Trava Comercial exige perfil Gerencial/Master ou PIN Gerencial.')
      }

      const motivo = String(body.motivo || '').trim() || 'Devolvido pela gestão para ajuste de preço/desconto.'

      await conn.db.transaction(async (tx) => {
        const [ped] = await tx
          .select()
          .from(pedidos)
          .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!ped) throw new HttpError(404, 'Pedido não encontrado.')
        if (ped.status !== 'BLOQUEADO_COMERCIAL') {
          throw new HttpError(409, `Pedido ${ped.codigo} não está em Trava Comercial.`)
        }

        const now = new Date()
        await tx
          .update(pedidos)
          .set({
            status: 'RASCUNHO',
            aprovadoComercialPorId: executorId,
            aprovadoComercialPorNome: executorNome,
            aprovadoComercialEm: now,
            aprovadoComercialObs: `REJEITADO: ${motivo}`,
            updatedAt: now,
          })
          .where(eq(pedidos.id, pedidoId))

        await tx
          .update(pendenciasSetor)
          .set({ status: 'CONCLUIDA', concluidaPorId: executorId, concluidaAt: now })
          .where(
            and(
              eq(pendenciasSetor.tenantId, ctx.tenantId),
              eq(pendenciasSetor.referenciaId, pedidoId),
              eq(pendenciasSetor.tipoPendencia, 'TRAVA_COMERCIAL_PEDIDO'),
            ),
          )
      })

      return { success: true, status: 'RASCUNHO', motivo }
    },
  )

  // ── 8) CRM VISITAS COMERCIAIS (CHECK-IN DE CAMPO COM GPS) ───────────────────
  app.get(
    '/api/comercial/visitas',
    { preHandler: requirePermission(PERM_COMERCIAL_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { vendedor_id?: string; cliente_id?: string }
      const conds = [eq(comercialVisitas.tenantId, ctx.tenantId), eq(comercialVisitas.filialId, ctx.filialId)]
      if (q.vendedor_id && q.vendedor_id !== 'TODOS') {
        conds.push(eq(comercialVisitas.vendedorId, parseUuidOrBadRequest(q.vendedor_id, 'vendedor_id')))
      }
      if (q.cliente_id) {
        conds.push(eq(comercialVisitas.clienteId, parseUuidOrBadRequest(q.cliente_id, 'cliente_id')))
      }

      const rows = await conn.db
        .select({
          id: comercialVisitas.id,
          vendedor_id: comercialVisitas.vendedorId,
          vendedor_nome: vendedores.nome,
          operador_nome: comercialVisitas.operadorNome,
          cliente_id: comercialVisitas.clienteId,
          cliente_nome: comercialVisitas.clienteNome,
          tipo: comercialVisitas.tipo,
          resultado: comercialVisitas.resultado,
          pedido_id: comercialVisitas.pedidoId,
          observacoes: comercialVisitas.observacoes,
          lat: comercialVisitas.lat,
          lng: comercialVisitas.lng,
          proximo_contato_em: comercialVisitas.proximoContatoEm,
          created_at: comercialVisitas.createdAt,
        })
        .from(comercialVisitas)
        .leftJoin(vendedores, eq(vendedores.id, comercialVisitas.vendedorId))
        .where(and(...conds))
        .orderBy(desc(comercialVisitas.createdAt))
        .limit(100)

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          lat: r.lat != null ? toNum(r.lat, 0) : null,
          lng: r.lng != null ? toNum(r.lng, 0) : null,
        })),
      }
    },
  )

  app.post(
    '/api/comercial/visitas',
    { preHandler: requirePermission(PERM_COMERCIAL_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        cliente_id?: string | null
        cliente_nome?: string
        vendedor_id?: string | null
        tipo?: string
        resultado?: string
        pedido_id?: string | null
        observacoes?: string
        lat?: number | string | null
        lng?: number | string | null
        proximo_contato_em?: string | null
      }

      const clienteId = body.cliente_id ? parseUuidOrBadRequest(body.cliente_id, 'cliente_id') : null
      let clienteNome = String(body.cliente_nome || '').trim()
      if (clienteId && !clienteNome) {
        const [cli] = await conn.db
          .select({ nomeFantasia: clientes.nomeFantasia, razaoSocial: clientes.razaoSocial })
          .from(clientes)
          .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, ctx.tenantId)))
          .limit(1)
        if (cli) clienteNome = cli.nomeFantasia || cli.razaoSocial
      }
      if (!clienteNome) throw new HttpError(400, 'Selecione um cliente ou informe o nome do contato visitado.')

      let vendedorId = body.vendedor_id ? parseUuidOrBadRequest(body.vendedor_id, 'vendedor_id') : null
      if (!vendedorId) {
        const [v] = await conn.db
          .select({ id: vendedores.id })
          .from(vendedores)
          .where(and(eq(vendedores.tenantId, ctx.tenantId), eq(vendedores.operadorId, ctx.operador.id)))
          .limit(1)
        if (v) vendedorId = v.id
      }

      const tiposValidos = ['PRESENCIAL', 'WHATSAPP', 'TELEFONE']
      const resValidos = [
        'PEDIDO_GERADO',
        'ORCAMENTO',
        'SEM_COMPRA',
        'CLIENTE_FECHADO',
        'RETORNO_AGENDADO',
        'CONTATO_REALIZADO',
      ]
      const tipo = tiposValidos.includes(String(body.tipo || '').toUpperCase())
        ? String(body.tipo).toUpperCase()
        : 'PRESENCIAL'
      const resultado = resValidos.includes(String(body.resultado || '').toUpperCase())
        ? String(body.resultado).toUpperCase()
        : 'CONTATO_REALIZADO'

      const id = uuidv7()
      await conn.db.insert(comercialVisitas).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        vendedorId,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
        clienteId,
        clienteNome,
        tipo,
        resultado,
        pedidoId: body.pedido_id ? parseUuidOrBadRequest(body.pedido_id, 'pedido_id') : null,
        observacoes: String(body.observacoes || '').trim(),
        lat: parseCoord(body.lat, -90, 90),
        lng: parseCoord(body.lng, -180, 180),
        proximoContatoEm: normalizarDataIso(body.proximo_contato_em),
      })

      return reply.status(201).send({ success: true, id })
    },
  )
}
