import React, { useState, useEffect, useCallback } from 'react'
import {
  Package, RefreshCw, UploadCloud, FileDown, Search, DollarSign,
  Scale, TrendingUp, TrendingDown, BarChart2, AlertTriangle, Eye, Briefcase,
  ArrowDown, ArrowUp, Boxes, AlertCircle, Activity, Calendar
} from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart, Cell
} from 'recharts'
import { CurvaBadge, EnderecoBadge } from '../components/shared/Badge'
import { format, differenceInDays, parseISO, subDays, startOfMonth, endOfMonth, startOfYear } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useAppStore } from '../store/appStore'
import * as estoqueQueries from '../queries/estoque.js'
import * as movimentacoesQueries from '../queries/movimentacoes.js'

// ─── Cores para os gráficos ────────────────────────────────────────────────
const COLORS_ENTRADA = ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75']
const COLORS_SAIDA   = ['#10b981', '#059669', '#047857', '#065f46', '#064e3b']

// ─── Tooltip escuro para o gráfico de fluxo ─────────────────────────────────
const FluxoTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#1a1d2e', border: '1px solid #2d3250',
      borderRadius: 8, padding: '10px 16px', fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
    }}>
      <p style={{ color: '#94a3b8', marginBottom: 6, fontSize: 11 }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>{p.name}:</span>
          <span style={{ color: '#e2e8f0' }}>{Number(p.value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg</span>
        </div>
      ))}
    </div>
  )
}

// ─── Gráfico de barras horizontal ───────────────────────────────────────────
const TopProdutosBar = ({ data, colors, emptyMsg }) => {
  if (!data || data.length === 0) {
    return <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{emptyMsg}</div>
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(1)}t`} />
        <YAxis type="category" dataKey="descricao" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} width={120}
          tickFormatter={v => v.length > 16 ? v.slice(0, 16) + '…' : v} />
        <Tooltip
          formatter={(v) => [`${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`, 'Volume']}
          contentStyle={{ background: '#1a1d2e', border: '1px solid #2d3250', borderRadius: 8, fontSize: 12, color: '#e2e8f0' }}
          itemStyle={{ color: '#e2e8f0' }}
          labelStyle={{ color: '#94a3b8' }}
          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
        />
        <Bar dataKey="total_kg" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── KPI card helper ─────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, sub, color = 'var(--accent)', prefix = '' }) => (
  <div className="kpi-card" style={{ borderColor: color }}>
    <span className="kpi-card__label flex items-center gap-8" style={{ color }}><Icon size={14} />{label}</span>
    <span className="kpi-card__value" style={{ fontSize: 22 }}>{prefix}{value}</span>
    {sub && <span className="kpi-card__sub">{sub}</span>}
  </div>
)

// ─── Presets de período ───────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Hoje',    getRange: () => { const d = new Date().toISOString().slice(0,10); return [d, d] } },
  { label: '7 dias',  getRange: () => [subDays(new Date(), 6).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: '30 dias', getRange: () => [subDays(new Date(), 29).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: 'Este mês', getRange: () => [startOfMonth(new Date()).toISOString().slice(0,10), endOfMonth(new Date()).toISOString().slice(0,10)] },
  { label: 'Este ano', getRange: () => [startOfYear(new Date()).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
]

function downloadCSV(content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `estoque_${Date.now()}.csv` })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Componente principal ────────────────────────────────────────────────────
export function Dashboard() {
  const { operador } = useAppStore()
  const isExecutivo = !!(operador?.permissoes?.dashboard_executivo)

  const [incluirInsumos, setIncluirInsumos] = useState(false)
  const [kpis, setKpis]       = useState(null)
  const [estoque, setEstoque] = useState([])
  const [relatorio, setRelatorio] = useState(null)
  const [loading, setLoading] = useState(true)
  const [presetAtivo, setPresetAtivo] = useState(2) // "30 dias" por padrão

  // Período personalizado
  const [dataInicio, setDataInicio] = useState(() => subDays(new Date(), 29).toISOString().slice(0,10))
  const [dataFim,    setDataFim]    = useState(() => new Date().toISOString().slice(0,10))

  // Filtros de tabela
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const [filtroCodigo,    setFiltroCodigo]    = useState('')
  const [filtroEndereco,  setFiltroEndereco]  = useState('')
  const [filtroVencimento,setFiltroVencimento]= useState('todos') // 'todos', 'vencidos_proximos'

  const aplicarPreset = (idx) => {
    setPresetAtivo(idx)
    const [ini, fim] = PRESETS[idx].getRange()
    setDataInicio(ini)
    setDataFim(fim)
  }

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const filtros = { incluirInsumos, data_inicio: dataInicio, data_fim: dataFim }
      const [kpisData, estoqueData] = await Promise.all([
        estoqueQueries.calcularKPIs(filtros),
        estoqueQueries.listarGeral()
      ])
      setKpis(kpisData)
      setEstoque(incluirInsumos
        ? estoqueData.filter(i => i.tipo_produto === 'Insumos')
        : estoqueData.filter(i => i.tipo_produto !== 'Insumos')
      )

      if (isExecutivo) {
        const rel = await movimentacoesQueries.relatorioExecutivo(filtros)
        setRelatorio(rel)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [isExecutivo, incluirInsumos, dataInicio, dataFim])

  useEffect(() => { carregarDados() }, [carregarDados])

  // Filtros de tabela
  let estoqueFiltrado = estoque.filter(item => {
    if (filtroVencimento === 'vencidos_proximos') {
      if (!item.validade) return false
      const dataStr = item.validade.toString().substring(0, 10) + 'T12:00:00'
      const dias = differenceInDays(new Date(dataStr), new Date())
      if (dias > 30) return false
    }
    return (item.descricao || '').toLowerCase().includes(filtroDescricao.toLowerCase()) &&
           (item.codigo || '').toLowerCase().includes(filtroCodigo.toLowerCase()) &&
           (item.endereco || '').toLowerCase().includes(filtroEndereco.toLowerCase())
  })

  if (filtroVencimento === 'vencidos_proximos') {
    estoqueFiltrado = estoqueFiltrado.sort((a, b) => new Date(a.validade) - new Date(b.validade))
  }

  const exportarCSV = async () => {
    if (estoqueFiltrado.length === 0) return
    const header = "ENDERECO;PRODUTO_ID;CODIGO;DESCRICAO;GRUPO;LOTE;VALIDADE;CAIXAS;KG;CURVA;VALOR_UNIT\n"
    const rows = estoqueFiltrado.map(i =>
      `${i.endereco};${i.produto_id};${i.codigo};${i.descricao};${i.grupo || ''};${i.lote || ''};${i.validade || ''};${i.qtd_caixas};${i.qtd_kg};${i.status_curva};${i.valor_unitario || 0}`
    ).join("\n")
    await downloadCSV(header + rows)
  }

  const renderValidade = (data) => {
    if (!data) return <span className="td-muted">-</span>
    const dataStr = data.toString().substring(0, 10) + 'T12:00:00'
    const dataObj = new Date(dataStr)
    const dias = differenceInDays(dataObj, new Date())
    if (dias < 0) return <span className="validade--critico">{format(dataObj, 'dd/MM/yyyy')} (Vencido)</span>
    if (dias <= 30) return <span className="validade--alerta">{format(dataObj, 'dd/MM/yyyy')} ({dias} dias)</span>
    return <span className="validade--ok">{format(dataObj, 'dd/MM/yyyy')}</span>
  }

  // KPIs calculados do estoque atual
  const valorTotal   = estoque.reduce((acc, i) => acc + (i.qtd_kg * (i.valor_unitario || 0)), 0)
  const pesoTotalTon = estoque.reduce((acc, i) => acc + (i.qtd_kg || 0), 0) / 1000

  // Totais do período
  const tot = relatorio?.totais || {}
  const entKg    = Number(tot.total_entrada_kg   || 0)
  const entCx    = Number(tot.total_entrada_cx   || 0)
  const entValor = Number(tot.total_entrada_valor|| 0)
  const saiKg    = Number(tot.total_saida_kg     || 0)
  const saiCx    = Number(tot.total_saida_cx     || 0)
  const saiValor = Number(tot.total_saida_valor  || 0)

  // Giro de estoque = KG saído / KG em estoque
  const pesoAtualKg = estoque.reduce((acc, i) => acc + (i.qtd_kg || 0), 0)
  const giro = pesoAtualKg > 0 ? ((saiKg / pesoAtualKg) * 100).toFixed(1) : '0.0'

  // Dados do gráfico de fluxo
  const fluxoData = (relatorio?.fluxoDiario || []).map(d => ({
    ...d,
    label: (() => { try { return format(parseISO(d.data), 'dd/MM', { locale: ptBR }) } catch { return d.data } })()
  }))

  const periodoLabel = `${format(new Date(dataInicio + 'T12:00'), 'dd/MM/yyyy')} — ${format(new Date(dataFim + 'T12:00'), 'dd/MM/yyyy')}`

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            {isExecutivo
              ? <><Briefcase size={26} /> Painel Executivo</>
              : <><Package size={26} /> Visão Operacional</>
            }
          </h1>
          <p className="page-header__subtitle">
            {isExecutivo ? 'Indicadores gerenciais, financeiros e análise de movimentação' : 'Saldos de estoque em tempo real'}
          </p>
        </div>
        <div className="flex gap-12 items-center">
          {isExecutivo && (
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'var(--success-muted)', color: 'var(--success)', fontWeight: 700, letterSpacing: 1 }}>EXECUTIVO</span>
          )}
          <button className="btn btn--secondary" onClick={exportarCSV}><FileDown size={16} /> Exportar CSV</button>
          <button className="btn btn--primary" onClick={carregarDados}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>
        </div>
      </div>

      {/* ── Filtro de Período (só executivo) ─────────────────────────────────── */}
      {isExecutivo && (
        <div className="card card--elevated mb-24" style={{ padding: '14px 20px' }}>
          <div className="flex items-center gap-16 flex-wrap">
            <div className="flex items-center gap-8" style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
              <Calendar size={16} /> Período de análise:
            </div>
            <div className="flex gap-8 flex-wrap">
              {PRESETS.map((p, i) => (
                <button key={i} onClick={() => aplicarPreset(i)} style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1.5px solid',
                  borderColor: presetAtivo === i ? 'var(--accent)' : 'var(--border)',
                  background: presetAtivo === i ? 'var(--accent-muted)' : 'transparent',
                  color: presetAtivo === i ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s'
                }}>{p.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-8 ml-auto">
              <input type="date" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setPresetAtivo(null) }}
                style={{ background: 'var(--bg-3)', border: '1.5px solid var(--border)', borderRadius: 8, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 13 }} />
              <span style={{ color: 'var(--text-muted)' }}>até</span>
              <input type="date" value={dataFim} onChange={e => { setDataFim(e.target.value); setPresetAtivo(null) }}
                style={{ background: 'var(--bg-3)', border: '1.5px solid var(--border)', borderRadius: 8, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 13 }} />
              <button className="btn btn--primary btn--sm" onClick={carregarDados} style={{ padding: '5px 14px', fontSize: 12 }}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── KPIs do Estoque Atual ─────────────────────────────────────────────── */}
      {kpis && (
        <div className="kpi-grid mb-16">
          <KpiCard icon={Package}     label="SKUs Ativos"          value={kpis.totalSKUs}  sub="Com saldo > 0" color="var(--accent)" />
          <KpiCard icon={Scale}       label="Peso Total em Estoque" value={pesoTotalTon.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} sub="Toneladas" color="var(--info)" />
          <KpiCard icon={UploadCloud} label="Aguardando (REC)"      value={kpis.itensREC}   sub="Lotes na doca" color="var(--warning)" />
          {isExecutivo && <KpiCard icon={DollarSign} label="Valor Total do Estoque" prefix="R$ " value={valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} sub="Custo × KG em estoque" color="var(--success)" />}
        </div>
      )}

      {/* ── KPIs do Período (só executivo) ───────────────────────────────────── */}
      {isExecutivo && relatorio && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
            📅 Movimentações do período: <span style={{ color: 'var(--accent)' }}>{periodoLabel}</span>
          </div>

          {/* Linha: Entradas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 12 }}>
            <div className="kpi-card" style={{ borderColor: '#22d3ee' }}>
              <span className="kpi-card__label flex items-center gap-8" style={{ color: '#22d3ee' }}><ArrowDown size={14} /> KG Recebido</span>
              <span className="kpi-card__value">{entKg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
              <span className="kpi-card__sub">{entCx.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} caixas recebidas</span>
            </div>
            <div className="kpi-card" style={{ borderColor: '#22d3ee' }}>
              <span className="kpi-card__label flex items-center gap-8" style={{ color: '#22d3ee' }}><DollarSign size={14} /> Valor Recebido</span>
              <span className="kpi-card__value" style={{ fontSize: 18 }}>R$ {entValor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
              <span className="kpi-card__sub">{Number(tot.qtd_recebimentos || 0)} recebimentos no período</span>
            </div>
            <div className="kpi-card" style={{ borderColor: '#10b981' }}>
              <span className="kpi-card__label flex items-center gap-8" style={{ color: '#10b981' }}><ArrowUp size={14} /> KG Expedido</span>
              <span className="kpi-card__value">{saiKg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
              <span className="kpi-card__sub">{saiCx.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} caixas despachadas</span>
            </div>
            <div className="kpi-card" style={{ borderColor: '#10b981' }}>
              <span className="kpi-card__label flex items-center gap-8" style={{ color: '#10b981' }}><DollarSign size={14} /> Valor Expedido</span>
              <span className="kpi-card__value" style={{ fontSize: 18 }}>R$ {saiValor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
              <span className="kpi-card__sub">{Number(tot.qtd_despachos || 0)} despachos no período</span>
            </div>
          </div>

          {/* Linha: Indicadores gerenciais */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            <div className="kpi-card" style={{ borderColor: 'var(--success)' }}>
              <span className="kpi-card__label flex items-center gap-8 text-success"><Activity size={14} /> Giro de Estoque</span>
              <span className="kpi-card__value">{giro}%</span>
              <span className="kpi-card__sub">Saída / Estoque atual</span>
            </div>
            <div className="kpi-card" style={{ borderColor: entKg > saiKg ? '#22d3ee' : '#10b981' }}>
              <span className="kpi-card__label flex items-center gap-8" style={{ color: 'var(--text-muted)' }}><Boxes size={14} /> Saldo do Período</span>
              <span className="kpi-card__value" style={{ color: entKg >= saiKg ? '#22d3ee' : '#10b981' }}>
                {entKg >= saiKg ? '+' : ''}{(entKg - saiKg).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg
              </span>
              <span className="kpi-card__sub">{entKg >= saiKg ? 'Mais entrada que saída' : 'Mais saída que entrada'}</span>
            </div>
            <div className="kpi-card" style={{ borderColor: 'var(--warning)' }}>
              <span className="kpi-card__label flex items-center gap-8 text-warning"><AlertCircle size={14} /> Alertas de Validade</span>
              <span className="kpi-card__value">{relatorio.alertasValidade?.length || 0}</span>
              <span className="kpi-card__sub">Lotes vencidos ou vencendo em 30 dias</span>
            </div>
            <div className="kpi-card" style={{ borderColor: 'var(--warning)' }}>
              <span className="kpi-card__label flex items-center gap-8 text-warning"><Eye size={14} /> Produtos Estagnados</span>
              <span className="kpi-card__value">{relatorio.estagnados?.length || 0}</span>
              <span className="kpi-card__sub">Sem movimentação há + de 30 dias</span>
            </div>
          </div>

          {/* Alertas de Validade */}
          {relatorio.alertasValidade?.length > 0 && (
            <div className="card card--elevated mb-24" style={{ border: '1px solid var(--danger)' }}>
              <div className="flex items-center gap-12 mb-16">
                <AlertCircle size={20} style={{ color: 'var(--danger)' }} />
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--danger)' }}>⚠️ Alertas de Validade</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Produtos vencidos ou com vencimento nos próximos 30 dias</p>
                </div>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Endereço</th>
                      <th style={{ textAlign: 'right' }}>CX</th>
                      <th style={{ textAlign: 'right' }}>KG</th>
                      <th style={{ textAlign: 'right', color: 'var(--danger)' }}>Validade</th>
                      <th style={{ textAlign: 'right' }}>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.alertasValidade.slice(0, 10).map((item, i) => {
                      const vencido = item.dias_para_vencer < 0
                      return (
                        <tr key={i}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{item.descricao}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.codigo}</div>
                          </td>
                          <td><EnderecoBadge endereco={item.endereco} /></td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.qtd_caixas}</td>
                          <td style={{ textAlign: 'right' }}>{Number(item.qtd_kg).toLocaleString('pt-BR')} kg</td>
                          <td style={{ textAlign: 'right' }}>{item.validade ? format(new Date(item.validade + 'T12:00'), 'dd/MM/yyyy') : '-'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{
                              padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                              background: vencido ? 'var(--danger-muted)' : 'var(--warning-muted)',
                              color: vencido ? 'var(--danger)' : 'var(--warning)'
                            }}>
                              {vencido ? `Vencido há ${Math.abs(item.dias_para_vencer)} dias` : `Vence em ${item.dias_para_vencer} dias`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Gráfico: Fluxo de Entradas x Saídas */}
          <div className="card card--elevated mb-24">
            <div className="flex items-center gap-12 mb-20">
              <BarChart2 size={20} style={{ color: 'var(--accent)' }} />
              <div>
                <h3 style={{ fontWeight: 700, fontSize: 15 }}>Fluxo de Movimentação</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Volume em KG de entradas (Recebimento) e saídas (Expedição) — {periodoLabel}
                </p>
              </div>
            </div>
            {fluxoData.length === 0 ? (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Nenhuma movimentação no período selecionado.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={fluxoData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(1)}t`} />
                  <Tooltip content={<FluxoTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                  <Bar dataKey="entradas_kg" name="Entradas (KG)" fill="#22d3ee" radius={[3, 3, 0, 0]} opacity={0.9} />
                  <Bar dataKey="saidas_kg"   name="Saídas (KG)"   fill="#10b981" radius={[3, 3, 0, 0]} opacity={0.9} />
                  <Line dataKey="entradas_kg" name="" stroke="#22d3ee" dot={false} strokeWidth={2} strokeOpacity={0.5} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top Produtos: Entradas + Saídas */}
          <div className="form-grid form-grid--2 mb-24">
            <div className="card card--elevated">
              <div className="flex items-center gap-10 mb-16">
                <TrendingUp size={18} style={{ color: '#22d3ee' }} />
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 14 }}>Top 5 Produtos — Entradas</h3>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Por KG recebido no período</p>
                </div>
              </div>
              <TopProdutosBar data={relatorio.topEntradas} colors={COLORS_ENTRADA} emptyMsg="Nenhuma entrada registrada." />
            </div>

            <div className="card card--elevated">
              <div className="flex items-center gap-10 mb-16">
                <TrendingDown size={18} style={{ color: '#10b981' }} />
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 14 }}>Top 5 Produtos — Saídas</h3>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Por KG despachado no período</p>
                </div>
              </div>
              <TopProdutosBar data={relatorio.topSaidas} colors={COLORS_SAIDA} emptyMsg="Nenhuma saída registrada." />
            </div>
          </div>

          {/* Produtos Estagnados */}
          {relatorio.estagnados?.length > 0 && (
            <div className="card card--elevated mb-24" style={{ border: '1px solid var(--warning)' }}>
              <div className="flex items-center gap-12 mb-16">
                <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--warning)' }}>Produtos Estagnados</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Sem movimentação há mais de 30 dias com saldo positivo</p>
                </div>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Endereço</th>
                      <th>Lote</th>
                      <th style={{ textAlign: 'right' }}>KG em Estoque</th>
                      <th style={{ textAlign: 'right', color: 'var(--warning)' }}>Dias Parado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.estagnados.slice(0, 10).map((item, i) => (
                      <tr key={i}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.descricao}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.codigo}</div>
                        </td>
                        <td><EnderecoBadge endereco={item.endereco} /></td>
                        <td className="td-mono">{item.lote || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(item.qtd_kg).toLocaleString('pt-BR')} kg</td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{
                            padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                            background: item.dias_parado > 90 ? 'var(--danger-muted)' : 'var(--warning-muted)',
                            color: item.dias_parado > 90 ? 'var(--danger)' : 'var(--warning)'
                          }}>{Math.round(item.dias_parado)} dias</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tabela de Posições ────────────────────────────────────────────── */}
      <div className="card card--elevated p-0">
        <div className="p-16 border-b border-border bg-bg-2 flex items-center gap-16 flex-wrap">
          <div className="flex items-center gap-8 text-primary font-bold mr-auto">
            <Search size={18} /> Filtros de Posições
          </div>
          <select
            className="form-input bg-bg-card"
            style={{ width: 180, fontWeight: 600 }}
            value={incluirInsumos ? 'insumos' : 'operacao'}
            onChange={e => setIncluirInsumos(e.target.value === 'insumos')}
          >
            <option value="operacao">Visão: Operação (MP/PA)</option>
            <option value="insumos">Visão: Insumos</option>
          </select>
          <select
            className="form-input bg-bg-card"
            style={{ width: 220, fontWeight: 600 }}
            value={filtroVencimento}
            onChange={e => setFiltroVencimento(e.target.value)}
          >
            <option value="todos">Validade: Todas</option>
            <option value="vencidos_proximos">⚠️ Vencidos e Próximos (30d)</option>
          </select>
          <input type="text" className="form-input" style={{ width: 140 }}
            placeholder="Endereço..." value={filtroEndereco} onChange={e => setFiltroEndereco(e.target.value)} />
          <input type="text" className="form-input" style={{ width: 140 }}
            placeholder="Código..." value={filtroCodigo} onChange={e => setFiltroCodigo(e.target.value)} />
          <input type="text" className="form-input" style={{ width: 200 }}
            placeholder="Descrição..." value={filtroDescricao} onChange={e => setFiltroDescricao(e.target.value)} />
        </div>

        <div className="table-container" style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
          <table>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                <th>Endereço</th>
                <th>Código</th>
                <th>Descrição</th>
                <th>Grupo</th>
                <th>Tipo</th>
                <th>Curva</th>
                <th>Lote</th>
                <th>Validade</th>
                <th style={{ textAlign: 'right' }}>Caixas</th>
                <th style={{ textAlign: 'right' }}>KG</th>
                {isExecutivo && <th style={{ textAlign: 'right' }}>Valor Total</th>}
              </tr>
            </thead>
            <tbody>
              {estoqueFiltrado.length === 0 ? (
                <tr><td colSpan={isExecutivo ? 11 : 10} className="text-center text-muted py-24">Nenhum saldo encontrado com os filtros atuais.</td></tr>
              ) : (
                estoqueFiltrado.map((item) => (
                  <tr key={item.id}>
                    <td><EnderecoBadge endereco={item.endereco} /></td>
                    <td className="td-mono">{item.codigo}</td>
                    <td style={{ maxWidth: 250 }} className="truncate" title={item.descricao}>{item.descricao}</td>
                    <td>{item.grupo || '-'}</td>
                    <td><span className="badge" style={{ backgroundColor: 'var(--color-bg-2)', fontSize: 10 }}>{item.tipo_produto || 'N/A'}</span></td>
                    <td><CurvaBadge curva={item.status_curva} /></td>
                    <td className="td-mono">{item.lote || '-'}</td>
                    <td>{renderValidade(item.validade)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--cyan)' }}>{item.qtd_caixas}</td>
                    <td style={{ textAlign: 'right' }} className="td-muted">{item.qtd_kg}</td>
                    {isExecutivo && (
                      <td style={{ textAlign: 'right' }} className="text-success font-bold">
                        R$ {(item.qtd_kg * (item.valor_unitario || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
