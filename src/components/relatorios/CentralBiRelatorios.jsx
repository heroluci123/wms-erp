import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Award,
  BarChart3,
  Boxes,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  DollarSign,
  Download,
  FileText,
  Flame,
  Layers,
  Package,
  Printer,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { subDays, startOfMonth, endOfMonth, startOfYear } from 'date-fns'
import { relatoriosBiQueries } from '../../queries/relatorios'
import * as produtosQueries from '../../queries/produtos'
import { isApiEnabled } from '../../lib/apiClient'
import { useAppStore } from '../../store/appStore'
import { ApiModeRequiredBanner } from '../shared/ApiModeRequiredBanner'
import { PrintDocumentModal } from '../shared/PrintDocumentModal'
import { ProdutoSearchSelect } from '../shared/SmartSearchSelect'

const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

const fmtNum = (v, dec = 2) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const fmtDataHora = (iso) => {
  if (!iso) return '-'
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime())
    ? String(iso)
    : dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const PRESETS_BI = [
  { label: 'Hoje', getRange: () => { const d = new Date().toISOString().slice(0, 10); return [d, d] } },
  { label: '7 dias', getRange: () => [subDays(new Date(), 6).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: '30 dias', getRange: () => [subDays(new Date(), 29).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: 'Este mês', getRange: () => [startOfMonth(new Date()).toISOString().slice(0, 10), endOfMonth(new Date()).toISOString().slice(0, 10)] },
  { label: 'Este ano', getRange: () => [startOfYear(new Date()).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
]

export const CATALOGO_BI_RELATORIOS = [
  // ── ESTOQUE & WMS (6) ──
  {
    id: 'curva-abc-estoque',
    categoria: 'ESTOQUE',
    titulo: 'Curva ABC de Estoque',
    subtitulo: 'Classificação A (80%), B (15%) e C (5%) por capital investido e peso em câmara',
    icon: BarChart3,
    cor: '#38bdf8',
    usaPeriodo: false,
    keywords: ['abc', 'curva', 'estoque', 'pareto', 'capital', 'valor', 'classe a'],
  },
  {
    id: 'valuation-estoque',
    categoria: 'ESTOQUE',
    titulo: 'Valuation & Capital Imobilizado',
    subtitulo: 'Posição financeira (R$) por câmara, espécie, conservação, Empório e Insumos',
    icon: DollarSign,
    cor: '#10b981',
    usaPeriodo: false,
    keywords: ['valuation', 'capital', 'imobilizado', 'dinheiro parado', 'camara', 'especie', 'emporio', 'insumos'],
  },
  {
    id: 'kardex',
    categoria: 'ESTOQUE',
    titulo: 'Kardex (Extrato por Produto)',
    subtitulo: 'Histórico completo de entradas, saídas, produções, perdas e transferências por SKU',
    icon: FileText,
    cor: '#a78bfa',
    usaPeriodo: true,
    usaProduto: true,
    keywords: ['kardex', 'extrato', 'movimentacao', 'historico', 'sku', 'rastreio', 'produto'],
  },
  {
    id: 'giro-deadstock',
    categoria: 'ESTOQUE',
    titulo: 'Giro, Cobertura & Dead Stock',
    subtitulo: 'Dias de cobertura por corte, risco de ruptura e itens sem giro (encalhados)',
    icon: TrendingDown,
    cor: '#f59e0b',
    usaPeriodo: false,
    usaDias: true,
    keywords: ['giro', 'cobertura', 'dead stock', 'encalhado', 'sem giro', 'ruptura', 'parado'],
  },
  {
    id: 'mapa-fefo',
    categoria: 'ESTOQUE',
    titulo: 'Mapa FEFO & Risco de Validade',
    subtitulo: 'Distribuição do estoque por faixa de vencimento (vencido, 3d, 7d, 15d, 30d+)',
    icon: Flame,
    cor: '#ef4444',
    usaPeriodo: false,
    keywords: ['fefo', 'validade', 'vencimento', 'vencido', 'shelf life', 'risco', 'perecivel'],
  },
  {
    id: 'acuracidade-inventario',
    categoria: 'ESTOQUE',
    titulo: 'Acuracidade (IRA) & Inventários',
    subtitulo: 'Índice de acuracidade WMS + Loja, ajustes aprovados, sobras e faltas em R$',
    icon: ClipboardCheck,
    cor: '#22d3ee',
    usaPeriodo: true,
    keywords: ['inventario', 'ira', 'acuracidade', 'divergencia', 'ajuste', 'sobra', 'falta', 'auditoria'],
  },

  // ── COMERCIAL, MARGEM & VAREJO (5) ──
  {
    id: 'curva-abc-vendas',
    categoria: 'COMERCIAL',
    titulo: 'Curva ABC de Vendas (Atacado + PDV)',
    subtitulo: 'Ranking dos produtos campeões de receita, volume (kg) e margem combinando canais',
    icon: TrendingUp,
    cor: '#34d399',
    usaPeriodo: true,
    keywords: ['vendas', 'abc', 'faturamento', 'campeoes', 'produtos vendidos', 'atacado', 'pdv', 'receita'],
  },
  {
    id: 'rentabilidade',
    categoria: 'COMERCIAL',
    titulo: 'Rentabilidade & Margem (Clientes/Canal)',
    subtitulo: 'Lucro bruto, margem %, ticket médio por cliente, vendedor e canal Atacado × PDV',
    icon: Users,
    cor: '#60a5fa',
    usaPeriodo: true,
    keywords: ['margem', 'lucro', 'rentabilidade', 'cliente', 'vendedor', 'ticket medio', 'canal'],
  },
  {
    id: 'fechamento-pdv',
    categoria: 'COMERCIAL',
    titulo: 'Fechamento PDV & Meios de Pagamento',
    subtitulo: 'Turnos de caixa, mix PIX/Dinheiro/Débito/Crédito/Crediário, sangrias e quebras',
    icon: CreditCard,
    cor: '#fbbf24',
    usaPeriodo: true,
    keywords: ['pdv', 'caixa', 'pix', 'cartao', 'dinheiro', 'crediario', 'fechamento', 'sangria', 'quebra caixa'],
  },
  {
    id: 'comissoes-vendedores',
    categoria: 'COMERCIAL',
    titulo: 'Comissões & Metas de Vendedores',
    subtitulo: 'Atingimento de meta mensal, faturamento, margem e comissão estimada por vendedor',
    icon: Award,
    cor: '#c084fc',
    usaPeriodo: true,
    keywords: ['comissao', 'comissoes', 'meta', 'metas', 'vendedor', 'vendedores', 'equipe comercial'],
  },
  {
    id: 'rendimento-acougue',
    categoria: 'COMERCIAL',
    titulo: 'Quebra & Rendimento do Açougue',
    subtitulo: 'Aproveitamento de MPs abertas no balcão vs. etiquetas QR pesadas e vendidas',
    icon: Store,
    cor: '#fb7185',
    usaPeriodo: true,
    keywords: ['acougue', 'quebra', 'rendimento', 'etiqueta', 'balanca', 'varejo', 'mp aberta', 'apara'],
  },

  // ── COMPRAS, LOGÍSTICA & GOVERNANÇA (3) ──
  {
    id: 'compras-inflacao',
    categoria: 'COMPRAS_LOG',
    titulo: 'Compras & Inflação de Preço por Corte',
    subtitulo: 'Histórico de custo pago, variação % (inflação/deflação) e ranking de frigoríficos',
    icon: ShoppingBag,
    cor: '#f97316',
    usaPeriodo: true,
    keywords: ['compras', 'inflacao', 'preco compra', 'custo', 'fornecedor', 'frigorifico', 'variacao'],
  },
  {
    id: 'logistica-otif',
    categoria: 'COMPRAS_LOG',
    titulo: 'Performance Logística (OTIF) & Devoluções',
    subtitulo: 'Taxa de entregas concluídas no prazo, embarques, recusas e motivos de devolução',
    icon: Truck,
    cor: '#38bdf8',
    usaPeriodo: true,
    keywords: ['logistica', 'otif', 'entrega', 'embarque', 'motorista', 'devolucao', 'recusa', 'rota'],
  },
  {
    id: 'interunidades-perdas',
    categoria: 'COMPRAS_LOG',
    titulo: 'Inter-Unidades, Perdas & Cadeia de Frio',
    subtitulo: 'Transferências entre filiais, dossiê de perdas/descartes (R$) e conformidade SIF °C',
    icon: ShieldCheck,
    cor: '#e879f9',
    usaPeriodo: true,
    keywords: ['interunidades', 'transferencia', 'filial', 'perdas', 'descarte', 'temperatura', 'sif', 'governanca'],
  },
]

function baixarCsv(nomeArquivo, colunas, linhas) {
  if (!linhas || linhas.length === 0) return
  const sep = ';'
  const header = colunas.map((c) => `"${String(c.label).replace(/"/g, '""')}"`).join(sep)
  const body = linhas
    .map((row) =>
      colunas
        .map((c) => {
          const val = c.raw ? c.raw(row) : row[c.key]
          if (val == null) return '""'
          if (typeof val === 'number') return `"${String(val).replace('.', ',')}"`
          return `"${String(val).replace(/"/g, '""')}"`
        })
        .join(sep),
    )
    .join('\n')
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nomeArquivo}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function buildConfigRelatorio(slug, dados) {
  if (!dados) return { kpis: [], chart: null, tabela: { colunas: [], linhas: [] }, extraTabela: null }
  const r = dados.resumo || {}

  switch (slug) {
    case 'curva-abc-estoque':
      return {
        kpis: [
          { label: 'SKUs em Estoque', valor: r.total_skus || 0, sub: `${r.total_caixas || 0} caixas • ${fmtKg(r.total_kg)}` },
          { label: 'Capital a Custo', valor: fmtMoeda(r.valor_custo_total), cor: '#38bdf8', sub: `Venda potencial: ${fmtMoeda(r.valor_venda_potencial)}` },
          { label: 'Classe A (80% Valor)', valor: `${r.classe_a?.skus || 0} SKUs`, cor: '#10b981', sub: `${fmtMoeda(r.classe_a?.valor_custo)} (${fmtKg(r.classe_a?.kg)})` },
          { label: 'Classe B / C', valor: `${r.classe_b?.skus || 0} B • ${r.classe_c?.skus || 0} C`, cor: '#f59e0b', sub: `B: ${fmtMoeda(r.classe_b?.valor_custo)} • C: ${fmtMoeda(r.classe_c?.valor_custo)}` },
        ],
        chart: {
          titulo: 'Top 12 SKUs por Capital em Estoque (R$ Custo)',
          data: (dados.data || []).slice(0, 12).map((x) => ({
            name: String(x.descricao || '').slice(0, 20),
            valor: x.valor_custo,
            fill: x.classe_abc === 'A' ? '#10b981' : x.classe_abc === 'B' ? '#f59e0b' : '#64748b',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Ranking Curva ABC de Estoque',
          colunas: [
            { key: 'classe_abc', label: 'Classe', badge: (v) => (v === 'A' ? 'badge--success' : v === 'B' ? 'badge--warning' : 'badge--secondary') },
            { key: 'codigo', label: 'Código', mono: true },
            { key: 'descricao', label: 'Produto', bold: true },
            { key: 'especie', label: 'Espécie' },
            { key: 'caixas', label: 'Caixas', align: 'right', mono: true },
            { key: 'peso_kg', label: 'Peso (kg)', align: 'right', mono: true, fmt: fmtKg },
            { key: 'custo_medio_kg', label: 'Custo/kg', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'valor_custo', label: 'Valor Custo', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'participacao_pct', label: '% Part.', align: 'right', mono: true, fmt: (v) => `${v}%` },
            { key: 'acumulado_pct', label: '% Acum.', align: 'right', mono: true, fmt: (v) => `${v}%` },
          ],
          linhas: dados.data || [],
        },
      }

    case 'valuation-estoque':
      return {
        kpis: [
          { label: 'Capital Total Imobilizado', valor: fmtMoeda(r.capital_total_custo), cor: '#10b981', sub: 'Câmaras WMS + Empório + Insumos' },
          { label: 'Câmaras WMS (Custo)', valor: fmtMoeda(r.wms_camaras_custo), cor: '#38bdf8', sub: `${fmtKg(r.wms_camaras_kg)} • Potencial ${fmtMoeda(r.wms_camaras_venda)}` },
          { label: 'Empório / Varejo', valor: fmtMoeda(r.emporio_loja_custo), cor: '#f59e0b', sub: `Venda: ${fmtMoeda(r.emporio_loja_venda)}` },
          { label: 'Insumos & Embalagens', valor: fmtMoeda(r.insumos_almox_custo), cor: '#a78bfa', sub: `Margem potencial WMS: ${r.margem_potencial_wms_pct || 0}%` },
        ],
        chart: {
          titulo: 'Capital Imobilizado por Câmara / Endereço (Top 12)',
          data: (dados.por_endereco || []).slice(0, 12).map((x) => ({
            name: x.endereco,
            valor: x.valor_custo,
            fill: '#38bdf8',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Valuation por Endereço / Câmara',
          colunas: [
            { key: 'endereco', label: 'Endereço / Câmara', bold: true, mono: true },
            { key: 'caixas', label: 'Caixas', align: 'right', mono: true },
            { key: 'kg', label: 'Peso Total', align: 'right', mono: true, fmt: fmtKg },
            { key: 'valor_custo', label: 'Valor Custo', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'valor_venda', label: 'Valor Venda Est.', align: 'right', mono: true, fmt: fmtMoeda },
          ],
          linhas: dados.por_endereco || [],
        },
        extraTabela: {
          titulo: 'Valuation por Espécie',
          colunas: [
            { key: 'especie', label: 'Espécie', bold: true },
            { key: 'caixas', label: 'Caixas', align: 'right', mono: true },
            { key: 'kg', label: 'Peso Total', align: 'right', mono: true, fmt: fmtKg },
            { key: 'valor_custo', label: 'Valor Custo', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'valor_venda', label: 'Valor Venda Est.', align: 'right', mono: true, fmt: fmtMoeda },
          ],
          linhas: dados.por_especie || [],
        },
      }

    case 'kardex':
      return {
        kpis: [
          { label: 'Movimentações no Período', valor: r.total_movimentos || 0, sub: 'Extrato cronológico (máx. 500)' },
          { label: 'Total Entradas', valor: fmtKg(r.entradas_kg), cor: '#10b981', sub: 'Recebimento, retorno OP e devolução' },
          { label: 'Total Saídas', valor: fmtKg(r.saidas_kg), cor: '#ef4444', sub: 'Expedição, produção e perdas' },
          { label: 'Variação / Saldo Atual', valor: fmtKg(r.variacao_liquida_kg), cor: '#38bdf8', sub: r.saldo_atual_kg > 0 ? `Saldo em câmara: ${fmtKg(r.saldo_atual_kg)}` : 'Selecione um SKU p/ saldo exato' },
        ],
        chart: null,
        tabela: {
          titulo: 'Extrato Kardex de Movimentações',
          colunas: [
            { key: 'data_hora', label: 'Data / Hora', mono: true, fmt: fmtDataHora },
            { key: 'tipo', label: 'Operação', badge: (v, row) => (row.direcao === 'ENTRADA' ? 'badge--success' : row.direcao === 'SAIDA' ? 'badge--danger' : 'badge--info') },
            { key: 'produto_codigo', label: 'Cód.', mono: true },
            { key: 'produto_descricao', label: 'Produto', bold: true },
            { key: 'endereco_origem', label: 'Origem', mono: true },
            { key: 'endereco_destino', label: 'Destino', mono: true },
            { key: 'lote', label: 'Lote', mono: true },
            { key: 'qtd_kg', label: 'Peso (kg)', align: 'right', mono: true, fmt: fmtKg, bold: true },
            { key: 'num_pedido', label: 'Documento', mono: true },
            { key: 'operador_nome', label: 'Operador' },
          ],
          linhas: dados.data || [],
        },
      }

    case 'giro-deadstock':
      return {
        kpis: [
          { label: 'SKUs Avaliados', valor: r.total_skus_estoque || 0, sub: `Base de consumo: ${dados.periodo_dias || 30} dias` },
          { label: 'Dead Stock (Sem Giro)', valor: `${r.dead_stock_qtd || 0} SKUs`, cor: '#ef4444', sub: `${fmtKg(r.dead_stock_kg)} • ${fmtMoeda(r.dead_stock_valor)} parados` },
          { label: 'Ruptura Iminente (≤5d)', valor: `${r.ruptura_iminente_qtd || 0} SKUs`, cor: '#f59e0b', sub: 'Priorizar compra ou desossa' },
          { label: 'Giro Saudável', valor: `${r.saudaveis_qtd || 0} SKUs`, cor: '#10b981', sub: 'Cobertura entre 6 e 45 dias' },
        ],
        chart: {
          titulo: 'Top 12 Itens com Maior Capital Parado (R$)',
          data: (dados.data || []).slice(0, 12).map((x) => ({
            name: String(x.descricao || '').slice(0, 20),
            valor: x.valor_parado,
            fill: x.status_giro === 'SEM_GIRO' ? '#ef4444' : x.status_giro === 'RUPTURA_IMINENTE' ? '#f59e0b' : '#10b981',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Giro, Cobertura e Estoque Encalhado (Dead Stock)',
          colunas: [
            {
              key: 'status_giro',
              label: 'Situação',
              badge: (v) => (v === 'SEM_GIRO' ? 'badge--danger' : v === 'RUPTURA_IMINENTE' ? 'badge--warning' : v === 'EXCESSO' ? 'badge--info' : 'badge--success'),
            },
            { key: 'codigo', label: 'Código', mono: true },
            { key: 'descricao', label: 'Produto', bold: true },
            { key: 'saldo_kg', label: 'Saldo Atual', align: 'right', mono: true, fmt: fmtKg },
            { key: 'saida_periodo_kg', label: 'Saída Período', align: 'right', mono: true, fmt: fmtKg },
            { key: 'consumo_dia_kg', label: 'Consumo/Dia', align: 'right', mono: true, fmt: fmtKg },
            { key: 'cobertura_dias', label: 'Cobertura', align: 'right', mono: true, fmt: (v) => (v == null ? 'Sem saída' : `${v} dias`) },
            { key: 'valor_parado', label: 'Capital Parado', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
          ],
          linhas: dados.data || [],
        },
      }

    case 'mapa-fefo':
      return {
        kpis: [
          { label: 'Caixas Monitoradas', valor: r.total_caixas || 0, sub: fmtKg(r.total_kg) },
          { label: 'Caixas Vencidas', valor: r.caixas_vencidas || 0, cor: (r.caixas_vencidas || 0) > 0 ? '#ef4444' : '#10b981', sub: 'Bloqueadas pelo Hard-Stop FEFO' },
          { label: 'Capital em Risco (≤15d)', valor: fmtMoeda(r.capital_risco_15d), cor: '#f59e0b', sub: 'Vencidas + vencendo em até 15 dias' },
        ],
        chart: {
          titulo: 'Capital em Estoque por Faixa de Validade (R$)',
          data: (dados.faixas || []).map((f) => ({
            name: f.label,
            valor: f.valor,
            fill: f.id === 'VENCIDO' ? '#ef4444' : f.id === 'CRITICO_3D' ? '#f97316' : f.id === 'ATENCAO_7D' ? '#f59e0b' : '#10b981',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Detalhamento FEFO por Caixa (Ordem de Vencimento)',
          colunas: [
            {
              key: 'faixa',
              label: 'Urgência',
              badge: (v) => (v === 'VENCIDO' ? 'badge--danger' : v === 'CRITICO_3D' || v === 'ATENCAO_7D' ? 'badge--warning' : 'badge--success'),
            },
            { key: 'ean_caixa', label: 'EAN Caixa', mono: true },
            { key: 'produto_descricao', label: 'Produto', bold: true },
            { key: 'endereco', label: 'Endereço', mono: true },
            { key: 'lote', label: 'Lote', mono: true },
            { key: 'validade', label: 'Validade', mono: true, fmt: fmtData },
            { key: 'dias_restantes', label: 'Dias', align: 'right', mono: true, fmt: (v) => (v < 0 ? `${v}d (venc.)` : `+${v}d`) },
            { key: 'peso_kg', label: 'Peso', align: 'right', mono: true, fmt: fmtKg },
            { key: 'valor_custo', label: 'Valor Custo', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
          ],
          linhas: dados.data || [],
        },
      }

    case 'acuracidade-inventario':
      return {
        kpis: [
          { label: 'Índice de Acuracidade (IRA)', valor: `${r.ira_pct ?? 100}%`, cor: (r.ira_pct ?? 100) >= 98 ? '#10b981' : '#f59e0b', sub: 'Meta excelência WMS: ≥ 98%' },
          { label: 'Inventários Realizados', valor: (r.inventarios_wms_qtd || 0) + (r.inventarios_loja_qtd || 0), sub: `${r.inventarios_wms_qtd || 0} WMS • ${r.inventarios_loja_qtd || 0} Loja` },
          { label: 'Impacto Faltas / Perdas', valor: fmtMoeda(r.impacto_faltas_valor), cor: '#ef4444', sub: `${r.total_ajustes || 0} ajuste(s) no período` },
          { label: 'Impacto Sobras', valor: fmtMoeda(r.impacto_sobras_valor), cor: '#38bdf8', sub: 'Ganhos de inventário' },
        ],
        chart: null,
        tabela: {
          titulo: 'Log de Ajustes & Divergências de Inventário',
          colunas: [
            { key: 'data_ajuste', label: 'Data', mono: true, fmt: fmtDataHora },
            { key: 'endereco', label: 'Endereço', mono: true },
            { key: 'produto_descricao', label: 'Produto', bold: true },
            { key: 'tipo_ajuste', label: 'Tipo Ajuste', badge: () => 'badge--warning' },
            { key: 'qtd_kg', label: 'Delta (kg)', align: 'right', mono: true, fmt: fmtKg },
            { key: 'valor_impacto', label: 'Impacto (R$)', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'aprovou', label: 'Aprovado Por' },
          ],
          linhas: dados.ajustes || [],
        },
        extraTabela: {
          titulo: 'Inventários Cegos da Loja (Empório & Açougue)',
          colunas: [
            { key: 'codigo', label: 'Código', mono: true },
            { key: 'titulo', label: 'Título', bold: true },
            { key: 'tipo', label: 'Tipo' },
            { key: 'status', label: 'Status', badge: (v) => (v === 'CONCLUIDO' ? 'badge--success' : 'badge--warning') },
            { key: 'total_itens', label: 'Itens', align: 'right', mono: true },
            { key: 'total_divergencias', label: 'Divergências', align: 'right', mono: true },
            { key: 'operador_nome', label: 'Operador' },
          ],
          linhas: dados.inventarios_loja || [],
        },
      }

    case 'curva-abc-vendas':
      return {
        kpis: [
          { label: 'Receita Total (Atacado + PDV)', valor: fmtMoeda(r.receita_total), cor: '#10b981', sub: `${r.skus_vendidos || 0} SKUs com saída` },
          { label: 'Receita Atacado', valor: fmtMoeda(r.receita_atacado), cor: '#38bdf8', sub: 'Pedidos faturados/em andamento' },
          { label: 'Receita PDV Varejo', valor: fmtMoeda(r.receita_pdv), cor: '#f59e0b', sub: 'Cupons concluídos no caixa' },
          { label: 'Margem Bruta Média', valor: `${r.margem_media_pct || 0}%`, cor: '#a78bfa', sub: 'Receita líquida menos CMV' },
        ],
        chart: {
          titulo: 'Top 12 Produtos Campeões de Faturamento (R$)',
          data: (dados.data || []).slice(0, 12).map((x) => ({
            name: String(x.descricao || '').slice(0, 20),
            valor: x.receita_total,
            fill: x.classe_abc === 'A' ? '#10b981' : x.classe_abc === 'B' ? '#38bdf8' : '#64748b',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Curva ABC de Produtos Vendidos',
          colunas: [
            { key: 'classe_abc', label: 'Classe', badge: (v) => (v === 'A' ? 'badge--success' : v === 'B' ? 'badge--info' : 'badge--secondary') },
            { key: 'codigo', label: 'Cód.', mono: true },
            { key: 'descricao', label: 'Produto', bold: true },
            { key: 'qtd_total', label: 'Volume', align: 'right', mono: true, fmt: fmtKg },
            { key: 'receita_atacado', label: 'Atacado', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'receita_pdv', label: 'PDV', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'receita_total', label: 'Receita Total', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'margem_pct', label: 'Margem %', align: 'right', mono: true, fmt: (v) => `${v}%` },
            { key: 'participacao_pct', label: '% Part.', align: 'right', mono: true, fmt: (v) => `${v}%` },
          ],
          linhas: dados.data || [],
        },
      }

    case 'rentabilidade':
      return {
        kpis: [
          { label: 'Receita Consolidada', valor: fmtMoeda(r.receita_total), cor: '#10b981', sub: `${r.qtd_pedidos_atacado || 0} pedidos • ${r.qtd_cupons_pdv || 0} cupons PDV` },
          { label: 'Canal Atacado', valor: fmtMoeda(r.receita_atacado), cor: '#38bdf8', sub: `Margem: ${fmtMoeda(r.margem_atacado_valor)} (${r.margem_atacado_pct || 0}%)` },
          { label: 'Canal PDV Varejo', valor: fmtMoeda(r.receita_pdv), cor: '#f59e0b', sub: `Descontos PDV: ${fmtMoeda(r.descontos_pdv)}` },
        ],
        chart: {
          titulo: 'Top 10 Clientes por Faturamento (R$)',
          data: (dados.por_cliente || []).slice(0, 10).map((x) => ({
            name: String(x.cliente || '').slice(0, 18),
            valor: x.receita,
            fill: '#38bdf8',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Rentabilidade & Margem por Cliente (Atacado)',
          colunas: [
            { key: 'cliente', label: 'Cliente', bold: true },
            { key: 'pedidos', label: 'Pedidos', align: 'right', mono: true },
            { key: 'receita', label: 'Faturado', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'custo', label: 'Custo Est.', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'margem_valor', label: 'Lucro Bruto', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'margem_pct', label: 'Margem %', align: 'right', mono: true, fmt: (v) => `${v}%` },
            { key: 'ticket_medio', label: 'Ticket Médio', align: 'right', mono: true, fmt: fmtMoeda },
          ],
          linhas: dados.por_cliente || [],
        },
        extraTabela: {
          titulo: 'Performance por Vendedor',
          colunas: [
            { key: 'vendedor', label: 'Vendedor', bold: true },
            { key: 'pedidos', label: 'Pedidos', align: 'right', mono: true },
            { key: 'receita', label: 'Faturado', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'margem_valor', label: 'Margem (R$)', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'margem_pct', label: 'Margem %', align: 'right', mono: true, fmt: (v) => `${v}%` },
            { key: 'ticket_medio', label: 'Ticket Médio', align: 'right', mono: true, fmt: fmtMoeda },
          ],
          linhas: dados.por_vendedor || [],
        },
      }

    case 'fechamento-pdv':
      return {
        kpis: [
          { label: 'Faturamento PDV', valor: fmtMoeda(r.faturamento_pdv), cor: '#10b981', sub: `${r.total_cupons_concluidos || 0} cupons • Ticket ${fmtMoeda(r.ticket_medio)}` },
          { label: 'Turnos de Caixa', valor: r.total_caixas || 0, sub: `Sangrias: ${fmtMoeda(r.total_sangrias)}` },
          { label: 'Descontos / Cancelamentos', valor: fmtMoeda(r.descontos_concedidos), cor: '#f59e0b', sub: `${r.total_cupons_cancelados || 0} cupom(ns) cancelado(s)` },
          { label: 'Quebras / Sobras Caixa', valor: fmtMoeda(r.saldo_quebras_sobras), cor: (r.saldo_quebras_sobras || 0) < 0 ? '#ef4444' : '#38bdf8', sub: 'Diferença acumulada no fechamento' },
        ],
        chart: {
          titulo: 'Recebimentos PDV por Forma de Pagamento (R$)',
          data: (dados.por_forma || []).map((f, i) => ({
            name: f.forma,
            valor: f.valor,
            fill: ['#10b981', '#38bdf8', '#f59e0b', '#a78bfa', '#fb7185'][i % 5],
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Turnos de Caixa PDV no Período',
          colunas: [
            { key: 'codigo', label: 'Caixa', mono: true, bold: true },
            { key: 'operador_nome', label: 'Operador' },
            { key: 'status', label: 'Status', badge: (v) => (v === 'FECHADO' ? 'badge--success' : 'badge--warning') },
            { key: 'aberto_em', label: 'Abertura', mono: true, fmt: fmtDataHora },
            { key: 'total_pix', label: 'PIX', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'total_dinheiro', label: 'Dinheiro', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'total_debito', label: 'Débito', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'total_credito', label: 'Crédito', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'total_vendas', label: 'Total Vendas', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'diferenca_quebra', label: 'Quebra/Sobra', align: 'right', mono: true, fmt: fmtMoeda },
          ],
          linhas: dados.caixas || [],
        },
      }

    case 'comissoes-vendedores':
      return {
        kpis: [
          { label: 'Faturamento da Equipe', valor: fmtMoeda(r.faturamento_equipe), cor: '#10b981', sub: `${r.vendedores_ativos || 0} vendedor(es) ativo(s)` },
          { label: 'Comissão Total Estimada', valor: fmtMoeda(r.comissao_total), cor: '#c084fc', sub: 'Conforme regra % Venda ou % Margem' },
          { label: 'Meta Global Equipe', valor: fmtMoeda(r.meta_total), cor: '#38bdf8', sub: r.meta_total > 0 ? `Atingimento: ${((r.faturamento_equipe / r.meta_total) * 100).toFixed(1)}%` : 'Sem meta configurada' },
        ],
        chart: {
          titulo: 'Faturamento por Vendedor (R$)',
          data: (dados.data || []).slice(0, 10).map((x) => ({
            name: x.sigla || String(x.nome || '').slice(0, 14),
            valor: x.faturado,
            fill: '#c084fc',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Extrato de Metas & Comissões por Vendedor',
          colunas: [
            { key: 'codigo', label: 'Cód.', mono: true },
            { key: 'nome', label: 'Vendedor', bold: true },
            { key: 'pedidos_qtd', label: 'Pedidos', align: 'right', mono: true },
            { key: 'faturado', label: 'Faturado', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'margem_pct', label: 'Margem %', align: 'right', mono: true, fmt: (v) => `${v}%` },
            { key: 'meta_valor', label: 'Meta (R$)', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'atingimento_meta_pct', label: '% Meta', align: 'right', mono: true, fmt: (v) => (v == null ? '—' : `${v}%`) },
            { key: 'pct_comissao', label: '% Com.', align: 'right', mono: true, fmt: (v) => `${v}%` },
            { key: 'comissao_valor', label: 'Comissão (R$)', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
          ],
          linhas: dados.data || [],
        },
      }

    case 'rendimento-acougue':
      return {
        kpis: [
          { label: 'Rendimento Médio MP', valor: `${r.rendimento_medio_pct || 0}%`, cor: '#10b981', sub: `${r.mps_encerradas || 0} MP(s) encerradas • Quebra ${fmtKg(r.quebra_total_kg)}` },
          { label: 'Etiquetas Pesadas', valor: r.etiquetas_pesadas || 0, sub: `${fmtKg(r.kg_pesado)} • Preço médio ${fmtMoeda(r.preco_medio_kg)}/kg` },
          { label: 'Valor Etiquetado', valor: fmtMoeda(r.valor_etiquetado), cor: '#38bdf8', sub: `Descarte: ${r.etiquetas_descarte || 0} etq.` },
          { label: 'Valor Vendido (PDV)', valor: fmtMoeda(r.valor_vendido), cor: '#f59e0b', sub: `${r.etiquetas_vendidas || 0} etiqueta(s) baixadas no caixa` },
        ],
        chart: {
          titulo: 'Produção Etiquetada no Açougue por Espécie (R$)',
          data: (dados.por_especie || []).map((x) => ({
            name: x.especie,
            valor: x.valor_pesado,
            fill: '#fb7185',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Matérias-Primas Abertas / Encerradas no Açougue',
          colunas: [
            { key: 'ean_caixa', label: 'EAN MP', mono: true },
            { key: 'produto_descricao', label: 'Matéria-Prima', bold: true },
            { key: 'especie', label: 'Espécie' },
            { key: 'status', label: 'Status', badge: (v) => (v === 'CONSUMIDA_ACOUGUE' ? 'badge--success' : 'badge--warning') },
            { key: 'peso_inicial_kg', label: 'Peso Inicial', align: 'right', mono: true, fmt: fmtKg },
            { key: 'quebra_kg', label: 'Quebra / Apara', align: 'right', mono: true, fmt: fmtKg },
            { key: 'rendimento_pct', label: 'Rendimento %', align: 'right', mono: true, fmt: (v) => (v == null ? 'Em aberto' : `${v}%`), bold: true },
          ],
          linhas: dados.mps || [],
        },
      }

    case 'compras-inflacao':
      return {
        kpis: [
          { label: 'Volume Comprado (R$)', valor: fmtMoeda(r.valor_comprado_total), cor: '#f97316', sub: `${fmtKg(r.kg_comprado_total)} comprados` },
          { label: 'Custo Médio Geral', valor: `${fmtMoeda(r.custo_medio_geral_kg)}/kg`, cor: '#38bdf8', sub: `${r.skus_comprados || 0} SKUs` },
          { label: 'Fornecedores Ativos', valor: r.fornecedores_ativos || 0, sub: 'Com pedidos de compra no período' },
        ],
        chart: {
          titulo: 'Top 10 Fornecedores por Volume Comprado (R$)',
          data: (dados.por_fornecedor || []).slice(0, 10).map((x) => ({
            name: String(x.fornecedor || '').slice(0, 18),
            valor: x.valor_total,
            fill: '#f97316',
          })),
          formatter: fmtMoeda,
        },
        tabela: {
          titulo: 'Inflação / Variação de Preço de Compra por Produto',
          colunas: [
            { key: 'codigo', label: 'Cód.', mono: true },
            { key: 'descricao', label: 'Produto', bold: true },
            { key: 'compras_qtd', label: 'Compras', align: 'right', mono: true },
            { key: 'kg_total', label: 'Qtd Total', align: 'right', mono: true, fmt: fmtKg },
            { key: 'preco_min', label: 'Mín/kg', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'preco_medio', label: 'Médio/kg', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'preco_max', label: 'Máx/kg', align: 'right', mono: true, fmt: fmtMoeda },
            {
              key: 'variacao_pct',
              label: 'Variação %',
              align: 'right',
              badge: (v) => (v > 3 ? 'badge--danger' : v < -2 ? 'badge--success' : 'badge--secondary'),
              fmt: (v) => `${v > 0 ? '+' : ''}${v}%`,
            },
            { key: 'valor_total', label: 'Total Gasto', align: 'right', mono: true, fmt: fmtMoeda },
          ],
          linhas: dados.data || [],
        },
      }

    case 'logistica-otif':
      return {
        kpis: [
          { label: 'Taxa OTIF (Entregas OK)', valor: `${r.otif_pct ?? 100}%`, cor: (r.otif_pct ?? 100) >= 95 ? '#10b981' : '#f59e0b', sub: `${r.paradas_entregues || 0} entregues • ${r.paradas_devolvidas || 0} recusas` },
          { label: 'Embarques / Rotas', valor: r.embarques_total || 0, cor: '#38bdf8', sub: `${r.embarques_concluidos || 0} concluído(s) • ${r.paradas_total || 0} paradas` },
          { label: 'Devoluções no Período', valor: r.devolucoes_qtd || 0, cor: '#ef4444', sub: `${fmtKg(r.devolucoes_kg)} • ${fmtMoeda(r.devolucoes_valor)}` },
        ],
        chart:
          (dados.motivos_devolucao || []).length > 0
            ? {
                titulo: 'Devoluções por Motivo (R$)',
                data: dados.motivos_devolucao.map((m) => ({
                  name: m.motivo,
                  valor: m.valor,
                  fill: '#ef4444',
                })),
                formatter: fmtMoeda,
              }
            : null,
        tabela: {
          titulo: 'Embarques & Romaneios de Rota',
          colunas: [
            { key: 'codigo', label: 'Embarque', mono: true, bold: true },
            { key: 'data_embarque', label: 'Data', mono: true, fmt: fmtData },
            { key: 'titulo', label: 'Rota / Título' },
            { key: 'motorista_nome', label: 'Motorista' },
            { key: 'veiculo_placa', label: 'Placa', mono: true },
            { key: 'status', label: 'Status', badge: (v) => (v === 'CONCLUIDO' ? 'badge--success' : 'badge--info') },
            { key: 'paradas', label: 'Paradas', align: 'right', mono: true },
            { key: 'entregues', label: 'Entregues', align: 'right', mono: true },
          ],
          linhas: dados.embarques || [],
        },
        extraTabela: {
          titulo: 'Devoluções Registradas',
          colunas: [
            { key: 'codigo', label: 'Código', mono: true },
            { key: 'cliente_nome', label: 'Cliente', bold: true },
            { key: 'pedido_codigo', label: 'Pedido', mono: true },
            { key: 'motivo', label: 'Motivo', badge: () => 'badge--danger' },
            { key: 'peso_kg', label: 'Peso', align: 'right', mono: true, fmt: fmtKg },
            { key: 'valor_estimado', label: 'Valor Est.', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'status_fiscal', label: 'Fiscal' },
          ],
          linhas: dados.devolucoes || [],
        },
      }

    case 'interunidades-perdas':
      return {
        kpis: [
          { label: 'Transferências Inter-Unidades', valor: r.inter_total_movs || 0, cor: '#38bdf8', sub: `${fmtKg(r.inter_kg_total)} • ${fmtMoeda(r.inter_valor_total)}` },
          { label: 'Perdas / Descartes Auditados', valor: r.perdas_qtd || 0, cor: '#ef4444', sub: `${fmtKg(r.perdas_kg)} • ${fmtMoeda(r.perdas_valor)}` },
          { label: 'Conformidade Cadeia Frio SIF', valor: `${r.temp_conformidade_pct ?? 100}%`, cor: (r.temp_conformidade_pct ?? 100) >= 95 ? '#10b981' : '#ef4444', sub: `${r.temp_leituras || 0} ronda(s) de temperatura` },
        ],
        chart:
          (dados.perdas_por_motivo || []).length > 0
            ? {
                titulo: 'Custo de Perdas & Descartes por Motivo (R$)',
                data: dados.perdas_por_motivo.map((m) => ({
                  name: m.motivo,
                  valor: m.valor,
                  fill: '#ef4444',
                })),
                formatter: fmtMoeda,
              }
            : null,
        tabela: {
          titulo: 'Movimentações Inter-Unidades',
          colunas: [
            { key: 'codigo', label: 'Código', mono: true, bold: true },
            { key: 'data_movimento', label: 'Data', mono: true, fmt: fmtData },
            { key: 'tipo_operacao', label: 'Operação', badge: () => 'badge--info' },
            { key: 'origem', label: 'Origem' },
            { key: 'destino', label: 'Destino' },
            { key: 'produto_descricao', label: 'Produto', bold: true },
            { key: 'peso_kg', label: 'Peso', align: 'right', mono: true, fmt: fmtKg },
            { key: 'valor_total', label: 'Valor', align: 'right', mono: true, fmt: fmtMoeda },
            { key: 'status_fiscal', label: 'Fiscal' },
          ],
          linhas: dados.interunidades || [],
        },
        extraTabela: {
          titulo: 'Dossiê de Perdas & Descartes Controlados',
          colunas: [
            { key: 'codigo', label: 'Código', mono: true },
            { key: 'created_at', label: 'Data', mono: true, fmt: fmtDataHora },
            { key: 'motivo', label: 'Motivo', badge: () => 'badge--danger' },
            { key: 'produto_descricao', label: 'Produto', bold: true },
            { key: 'qtd_kg', label: 'Peso', align: 'right', mono: true, fmt: fmtKg },
            { key: 'custo_total_perda', label: 'Custo Perda', align: 'right', mono: true, fmt: fmtMoeda, bold: true },
            { key: 'operador_nome', label: 'Operador' },
          ],
          linhas: dados.perdas || [],
        },
      }

    default:
      return { kpis: [], chart: null, tabela: { colunas: [], linhas: [] }, extraTabela: null }
  }
}

export function VisualizadorRelatorioBi({ relatorio }) {
  const { toastError } = useAppStore()
  const [preset, setPreset] = useState(2)
  const [dataInicio, setDataInicio] = useState(() => subDays(new Date(), 29).toISOString().slice(0, 10))
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10))
  const [diasGiro, setDiasGiro] = useState(30)
  const [produtoId, setProdutoId] = useState('')
  const [produtosLista, setProdutosLista] = useState([])
  const [buscaLocal, setBuscaLocal] = useState('')

  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  useEffect(() => {
    if (relatorio?.usaProduto && produtosLista.length === 0) {
      produtosQueries.listar().then((rows) => setProdutosLista(rows || [])).catch(() => {})
    }
  }, [relatorio?.usaProduto, produtosLista.length])

  const carregar = useCallback(async () => {
    if (!relatorio || !isApiEnabled()) return
    setLoading(true)
    try {
      const params = {}
      if (relatorio.usaPeriodo) {
        params.dataInicio = dataInicio
        params.dataFim = dataFim
      }
      if (relatorio.usaDias) {
        params.dias = diasGiro
      }
      if (relatorio.usaProduto && produtoId) {
        params.produto_id = produtoId
      }
      const res = await relatoriosBiQueries.buscar(relatorio.id, params)
      setDados(res)
    } catch (err) {
      toastError(`Erro ao gerar ${relatorio.titulo}`, err.message)
    } finally {
      setLoading(false)
    }
  }, [relatorio, dataInicio, dataFim, diasGiro, produtoId, toastError])

  useEffect(() => {
    setBuscaLocal('')
    carregar()
  }, [carregar])

  const cfg = useMemo(() => buildConfigRelatorio(relatorio?.id, dados), [relatorio?.id, dados])

  const linhasFiltradas = useMemo(() => {
    const base = cfg.tabela?.linhas || []
    const q = buscaLocal.trim().toLowerCase()
    if (!q) return base
    return base.filter((row) => JSON.stringify(row).toLowerCase().includes(q))
  }, [cfg.tabela, buscaLocal])

  if (!isApiEnabled()) {
    return <ApiModeRequiredBanner modulo={`BI Gerencial — ${relatorio?.titulo || ''}`} />
  }

  const IconComp = relatorio?.icon || BarChart3

  const renderTabela = (tab, linhas, compactPrint = false) => (
    <div className="table-wrap" style={compactPrint ? undefined : { border: '1px solid var(--border)', borderRadius: 10 }}>
      <table className={compactPrint ? 'wms-print-table' : 'table'}>
        <thead>
          <tr>
            {tab.colunas.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr>
              <td colSpan={tab.colunas.length} style={{ textAlign: 'center', padding: 28 }} className="text-muted">
                Nenhum registro encontrado para os filtros selecionados.
              </td>
            </tr>
          ) : (
            linhas.map((row, idx) => (
              <tr key={row.id || row.produto_id || row.codigo || idx}>
                {tab.colunas.map((c) => {
                  const rawVal = row[c.key]
                  const display = c.fmt ? c.fmt(rawVal, row) : (rawVal ?? '-')
                  const badgeCls = !compactPrint && c.badge ? c.badge(rawVal, row) : null
                  return (
                    <td
                      key={c.key}
                      className={`${c.mono ? 'font-mono' : ''} ${c.bold ? 'font-bold' : ''}`}
                      style={{ textAlign: c.align || 'left', fontSize: compactPrint ? 10 : 12.5 }}
                    >
                      {badgeCls ? <span className={`badge ${badgeCls}`}>{display}</span> : display}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="flex flex-col gap-16">
      {/* Cabeçalho do Relatório BI */}
      <div className="flex justify-between items-start flex-wrap gap-12 pb-12" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-start gap-10">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: `${relatorio.cor}18`,
              border: `1px solid ${relatorio.cor}44`,
              color: relatorio.cor,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconComp size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>{relatorio.titulo}</h2>
            <p className="text-xs text-muted" style={{ margin: '3px 0 0 0' }}>
              {relatorio.subtitulo}
            </p>
          </div>
        </div>

        <div className="flex gap-8 flex-wrap">
          <button type="button" className="btn btn--secondary btn--sm" onClick={carregar} disabled={loading}>
            <RefreshCw size={14} /> Atualizar
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={linhasFiltradas.length === 0}
            onClick={() => baixarCsv(`${relatorio.id}_${dataInicio}_${dataFim}`, cfg.tabela.colunas, linhasFiltradas)}
          >
            <Download size={14} /> Exportar Excel/CSV
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!dados}
            onClick={() => setPrintOpen(true)}
          >
            <Printer size={14} /> Imprimir / PDF A4
          </button>
        </div>
      </div>

      {/* Barra de Filtros Específicos */}
      <div className="p-12 rounded flex gap-12 items-end flex-wrap" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
        {relatorio.usaPeriodo && (
          <>
            <div className="flex gap-6 flex-wrap items-center">
              {PRESETS_BI.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const [ini, fim] = p.getRange()
                    setPreset(i)
                    setDataInicio(ini)
                    setDataFim(fim)
                  }}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    border: preset === i ? '1px solid #38bdf8' : '1px solid var(--border)',
                    background: preset === i ? 'rgba(56,189,248,0.18)' : 'var(--bg-1)',
                    color: preset === i ? '#f8fafc' : '#94a3b8',
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-6">
              <input
                type="date"
                className="form-input"
                style={{ width: 145, height: 36 }}
                value={dataInicio}
                onChange={(e) => {
                  setDataInicio(e.target.value)
                  setPreset(null)
                }}
              />
              <span className="text-xs text-muted">até</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 145, height: 36 }}
                value={dataFim}
                onChange={(e) => {
                  setDataFim(e.target.value)
                  setPreset(null)
                }}
              />
            </div>
          </>
        )}

        {relatorio.usaDias && (
          <div>
            <label className="form-label">Janela de Giro</label>
            <select
              className="form-input"
              style={{ width: 170, height: 36 }}
              value={diasGiro}
              onChange={(e) => setDiasGiro(Number(e.target.value))}
            >
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={60}>Últimos 60 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          </div>
        )}

        {relatorio.usaProduto && (
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <label className="form-label">Filtrar Produto (opcional)</label>
            <ProdutoSearchSelect
              produtos={produtosLista}
              value={produtoId}
              onChange={(val) => setProdutoId(val)}
              compact
              emptyLabel="Todos os Produtos"
              placeholder="Pesquisar SKU para extrato Kardex..."
              modalTitle="Selecionar Produto para Kardex"
            />
          </div>
        )}

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <label className="form-label">Filtro Rápido na Tabela</label>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              className="form-input"
              style={{ paddingLeft: 32, height: 36 }}
              placeholder="Filtrar linhas..."
              value={buscaLocal}
              onChange={(e) => setBuscaLocal(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-32 text-center text-muted">Processando indicadores gerenciais...</div>
      ) : (
        <>
          {/* KPIs */}
          {cfg.kpis.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))', gap: 12 }}>
              {cfg.kpis.map((k, idx) => (
                <div key={idx} className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
                  <div className="text-xs text-muted uppercase font-bold">{k.label}</div>
                  <div className="text-2xl font-mono font-bold mt-4" style={{ color: k.cor || '#f8fafc' }}>
                    {k.valor}
                  </div>
                  {k.sub && <div className="text-xs text-muted mt-3">{k.sub}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Gráfico Recharts */}
          {cfg.chart && cfg.chart.data.length > 0 && (
            <div className="card" style={{ padding: 16, background: 'var(--bg-2)' }}>
              <div className="text-xs font-bold uppercase text-muted mb-12">{cfg.chart.titulo}</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cfg.chart.data} margin={{ top: 8, right: 18, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#24324d" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: '#cbd5e1' }} axisLine={false} tickLine={false} interval={0} angle={-14} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => Number(v).toLocaleString('pt-BR')} />
                  <Tooltip
                    cursor={{ fill: 'rgba(56,189,248,0.08)' }}
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: 8, fontSize: 12, color: '#f8fafc' }}
                    formatter={(v) => cfg.chart.formatter(v)}
                  />
                  <Bar dataKey="valor" radius={[5, 5, 0, 0]} maxBarSize={48}>
                    {cfg.chart.data.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill || '#38bdf8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabela Principal */}
          <div>
            <div className="flex justify-between items-center mb-8">
              <strong className="text-sm">{cfg.tabela.titulo}</strong>
              <span className="text-xs text-muted">{linhasFiltradas.length} linha(s)</span>
            </div>
            {renderTabela(cfg.tabela, linhasFiltradas)}
          </div>

          {/* Tabela Secundária (quando houver) */}
          {cfg.extraTabela && (cfg.extraTabela.linhas || []).length > 0 && (
            <div className="mt-8">
              <div className="flex justify-between items-center mb-8">
                <strong className="text-sm">{cfg.extraTabela.titulo}</strong>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => baixarCsv(`${relatorio.id}_detalhe_${dataInicio}_${dataFim}`, cfg.extraTabela.colunas, cfg.extraTabela.linhas)}
                >
                  <Download size={13} /> CSV
                </button>
              </div>
              {renderTabela(cfg.extraTabela, cfg.extraTabela.linhas)}
            </div>
          )}
        </>
      )}

      {/* Modal de Impressão Executiva A4 Paisagem */}
      {printOpen && (
        <PrintDocumentModal
          title={relatorio.titulo}
          orientation="landscape"
          autoPrint={false}
          onClose={() => setPrintOpen(false)}
        >
          <div className="wms-print-header">
            <div>
              <div className="wms-print-brand">WMSphere ERP — Central de BI Gerencial</div>
              <div className="wms-print-brand-sub">{relatorio.subtitulo}</div>
            </div>
            <div className="wms-print-doc-title">
              <div>{relatorio.titulo}</div>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#475569' }}>
                {relatorio.usaPeriodo ? `Período: ${fmtData(dataInicio)} a ${fmtData(dataFim)}` : `Posição em ${fmtDataHora(new Date().toISOString())}`}
              </div>
            </div>
          </div>

          <div className="wms-print-meta-grid">
            {cfg.kpis.slice(0, 3).map((k, idx) => (
              <div key={idx}>
                <div className="wms-print-meta-label">{k.label}</div>
                <div className="wms-print-meta-value">{k.valor}</div>
              </div>
            ))}
          </div>

          <div className="wms-print-section-title">{cfg.tabela.titulo}</div>
          {renderTabela(cfg.tabela, linhasFiltradas.slice(0, 250), true)}

          {cfg.extraTabela && (cfg.extraTabela.linhas || []).length > 0 && (
            <>
              <div className="wms-print-section-title">{cfg.extraTabela.titulo}</div>
              {renderTabela(cfg.extraTabela, cfg.extraTabela.linhas.slice(0, 150), true)}
            </>
          )}

          <div className="wms-print-footer">
            <span>WMSphere ERP — Relatório Gerencial</span>
            <span>Emitido em {fmtDataHora(new Date().toISOString())}</span>
          </div>
        </PrintDocumentModal>
      )}
    </div>
  )
}
