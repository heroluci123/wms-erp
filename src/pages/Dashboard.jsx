import React, { useState, useEffect, useCallback } from 'react'
import {
  Package, RefreshCw, UploadCloud, FileDown, Search, DollarSign,
  Scale, TrendingUp, TrendingDown, BarChart2, AlertTriangle, Eye, Briefcase
} from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart, Cell, PieChart, Pie
} from 'recharts'
import { CurvaBadge, EnderecoBadge } from '../components/shared/Badge'
import { format, differenceInDays, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useAppStore } from '../store/appStore'
import * as estoqueQueries from '../queries/estoque.js';
import * as movimentacoesQueries from '../queries/movimentacoes.js';

// ─── Cores para os gráficos ────────────────────────────────────────────────
const COLORS_ENTRADA = ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75']
const COLORS_SAIDA   = ['#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12']

// ─── Tooltip customizado para o gráfico de fluxo ────────────────────────────
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

// ─── Gráfico de pizza simples para top produtos ─────────────────────────────
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
          formatter={(v, n, p) => [`${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`, 'Volume']}
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

// ─── Componente principal ────────────────────────────────────────────────────
export function Dashboard() {
  const { operador } = useAppStore()
  const isExecutivo = !!(operador?.permissoes?.dashboard_executivo)

  const [incluirInsumos, setIncluirInsumos] = useState(false)
  const [kpis, setKpis]       = useState(null)
  const [estoque, setEstoque] = useState([])
  const [relatorio, setRelatorio] = useState(null)
  const [loading, setLoading] = useState(true)

  // Filtros
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const [filtroCodigo,    setFiltroCodigo]    = useState('')
  const [filtroEndereco,  setFiltroEndereco]  = useState('')

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const filtros = { incluirInsumos }
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
  }, [isExecutivo, incluirInsumos])

  useEffect(() => { carregarDados() }, [carregarDados])

  // Filtros de tabela
  const estoqueFiltrado = estoque.filter(item =>
    (item.descricao || '').toLowerCase().includes(filtroDescricao.toLowerCase()) &&
    (item.codigo || '').toLowerCase().includes(filtroCodigo.toLowerCase()) &&
    (item.endereco || '').toLowerCase().includes(filtroEndereco.toLowerCase())
  )

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
    // Garante que a data seja interpretada sem problema de fuso horário
    const dataStr = data.toString().substring(0, 10) + 'T12:00:00'
    const dataObj = new Date(dataStr)
    const dias = differenceInDays(dataObj, new Date())
    if (dias < 0) return <span className="validade--critico">{format(dataObj, 'dd/MM/yyyy')} (Vencido)</span>
    if (dias <= 30) return <span className="validade--alerta">{format(dataObj, 'dd/MM/yyyy')} ({dias} dias)</span>
    return <span className="validade--ok">{format(dataObj, 'dd/MM/yyyy')}</span>
  }

  // KPIs calculados
  const valorTotal    = estoque.reduce((acc, i) => acc + (i.qtd_kg * (i.valor_unitario || 0)), 0)
  const pesoTotalTon  = estoque.reduce((acc, i) => acc + (i.qtd_kg || 0), 0) / 1000

  // Formatar dados do fluxo para o gráfico
  const fluxoData = (relatorio?.fluxoDiario || []).map(d => ({
    ...d,
    label: (() => { try { return format(parseISO(d.data), 'dd/MM', { locale: ptBR }) } catch { return d.data } })()
  }))

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
            {isExecutivo
              ? 'Indicadores gerenciais, financeiros e análise de movimentação'
              : 'Saldos de estoque em tempo real'}
          </p>
        </div>
        <div className="flex gap-12 items-center">
          {isExecutivo && (
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 99,
              background: 'var(--success-muted)', color: 'var(--success)', fontWeight: 700, letterSpacing: 1
            }}>EXECUTIVO</span>
          )}
          <button className="btn btn--secondary" onClick={exportarCSV}>
            <FileDown size={16} /> Exportar CSV
          </button>
          <button className="btn btn--primary" onClick={carregarDados}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      {kpis && (
        <div className="kpi-grid mb-24">
          <div className="kpi-card">
            <span className="kpi-card__label flex items-center gap-8"><Package size={14} /> Total SKUs Ativos</span>
            <span className="kpi-card__value">{kpis.totalSKUs}</span>
            <span className="kpi-card__sub">Com saldo &gt; 0</span>
          </div>

          <div className="kpi-card" style={{ borderColor: 'var(--info)' }}>
            <span className="kpi-card__label flex items-center gap-8 text-info"><Scale size={14} /> Peso Total em Estoque</span>
            <span className="kpi-card__value">{pesoTotalTon.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            <span className="kpi-card__sub">Toneladas (Ton)</span>
          </div>

          <div className="kpi-card kpi-card--warning">
            <span className="kpi-card__label text-warning flex items-center gap-8">
              <UploadCloud size={14} /> Aguardando Armazenagem (REC)
            </span>
            <span className="kpi-card__value">{kpis.itensREC}</span>
            <span className="kpi-card__sub">Lotes parados na doca</span>
          </div>

          {/* Card de valor só para quem tem acesso executivo */}
          {isExecutivo && (
            <div className="kpi-card text-success" style={{ borderColor: 'var(--success)' }}>
              <span className="kpi-card__label flex items-center gap-8 text-success"><DollarSign size={14} /> Valor Total do Estoque</span>
              <span className="kpi-card__value" style={{ fontSize: 22 }}>
                R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
              <span className="kpi-card__sub">Custo × KG em estoque</span>
            </div>
          )}
        </div>
      )}

      {/* ── Seção Executiva: Gráficos ──────────────────────────────────────── */}
      {isExecutivo && relatorio && (
        <>
          {/* Gráfico: Fluxo de Entradas x Saídas */}
          <div className="card card--elevated mb-24">
            <div className="flex items-center gap-12 mb-20">
              <BarChart2 size={20} style={{ color: 'var(--accent)' }} />
              <div>
                <h3 style={{ fontWeight: 700, fontSize: 15 }}>Fluxo de Movimentação — Últimos 30 Dias</h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Volume em KG de entradas (Recebimento) e saídas (Expedição)</p>
              </div>
            </div>
            {fluxoData.length === 0 ? (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Nenhuma movimentação nos últimos 30 dias.
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
                  <Bar dataKey="saidas_kg"   name="Saídas (KG)"   fill="#f97316" radius={[3, 3, 0, 0]} opacity={0.9} />
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
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Por KG recebido nos últimos 30 dias</p>
                </div>
              </div>
              <TopProdutosBar data={relatorio.topEntradas} colors={COLORS_ENTRADA} emptyMsg="Nenhuma entrada registrada." />
            </div>

            <div className="card card--elevated">
              <div className="flex items-center gap-10 mb-16">
                <TrendingDown size={18} style={{ color: '#f97316' }} />
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: 14 }}>Top 5 Produtos — Saídas</h3>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Por KG despachado nos últimos 30 dias</p>
                </div>
              </div>
              <TopProdutosBar data={relatorio.topSaidas} colors={COLORS_SAIDA} emptyMsg="Nenhuma saída registrada." />
            </div>
          </div>

          {/* Produtos Estagnados */}
          {relatorio.estagnados?.length > 0 && (
            <div className="card card--elevated mb-24" style={{ borderColor: 'var(--warning)', borderWidth: 1, borderStyle: 'solid' }}>
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
                    {relatorio.estagnados.map((item, i) => (
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
                          }}>
                            {Math.round(item.dias_parado)} dias
                          </span>
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
          <input type="text" className="form-input" style={{ width: 160 }}
            placeholder="Filtrar Endereço..." value={filtroEndereco} onChange={e => setFiltroEndereco(e.target.value)} />
          <input type="text" className="form-input" style={{ width: 160 }}
            placeholder="Filtrar Código..." value={filtroCodigo} onChange={e => setFiltroCodigo(e.target.value)} />
          <input type="text" className="form-input" style={{ width: 220 }}
            placeholder="Filtrar Descrição..." value={filtroDescricao} onChange={e => setFiltroDescricao(e.target.value)} />
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
