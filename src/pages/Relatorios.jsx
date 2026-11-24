import React, { useState, useEffect, useMemo } from 'react'
import { PieChart, TrendingUp, ChevronRight, ChevronDown, PackageOpen, Layers, Calendar, Search, Download, Factory, CheckCircle2, Clock, XCircle, Box } from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth, startOfYear } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import * as relatoriosQueries from '../queries/relatorios'
import RelatorioDossieProducao from '../components/shared/RelatorioDossieProducao'
import RelatorioGeralWms from '../components/shared/RelatorioGeralWms'
import { CATALOGO_BI_RELATORIOS, VisualizadorRelatorioBi } from '../components/relatorios/CentralBiRelatorios'
import { FileSpreadsheet, ShieldAlert, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isCliente, temPermissao } from '../utils/permissoes'

const fmtKg = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg'
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => d ? d.toString().slice(0, 16).replace('T', ' ') : '-'

const PRESETS = [
  { label: 'Hoje',     getRange: () => { const d = new Date().toISOString().slice(0,10); return [d, d] } },
  { label: '7 dias',   getRange: () => [subDays(new Date(), 6).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: '30 dias',  getRange: () => [subDays(new Date(), 29).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: 'Este mês', getRange: () => [startOfMonth(new Date()).toISOString().slice(0,10), endOfMonth(new Date()).toISOString().slice(0,10)] },
  { label: 'Este ano', getRange: () => [startOfYear(new Date()).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
]

// ─── Status Badge OP ─────────────────────────────────────────────────────────
const StatusBadgeOP = ({ status }) => {
  const cfg = {
    CONCLUIDA: { bg: 'rgba(16,185,129,0.15)',  color: '#10b981', icon: <CheckCircle2 size={12} />, label: 'Concluída' },
    ABERTA:    { bg: 'rgba(251,191,36,0.15)',   color: '#fbbf24', icon: <Clock size={12} />,        label: 'Aberta' },
    CANCELADA: { bg: 'rgba(239,68,68,0.15)',    color: '#ef4444', icon: <XCircle size={12} />,      label: 'Cancelada' },
  }[status] || { bg: 'var(--bg-2)', color: 'var(--text-muted)', icon: null, label: status }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}40`,
      borderRadius: 99, padding: '2px 10px', fontSize: 11, fontWeight: 700
    }}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

// ─── Árvore Node ─────────────────────────────────────────────────────────────
const ArvoreNode = ({ node, level = 0, searchTerm = '' }) => {
  const matchesSearch = searchTerm && node.descricao.toLowerCase().includes(searchTerm.toLowerCase())
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (searchTerm) setExpanded(true) }, [searchTerm])
  const hasChildren = node.children && node.children.length > 0

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-12 py-10 px-16 cursor-pointer hover:bg-bg-2 transition-colors ${matchesSearch ? 'bg-primary/10' : ''} ${level === 0 ? 'bg-bg-1 font-bold rounded mt-4 border border-border/50' : 'border-b border-border/30'}`}
        onClick={() => setExpanded(!expanded)}
      >
        {Array.from({ length: level }).map((_, i) => <div key={i} className="w-16 h-full border-l-2 border-border/30 ml-8" />)}
        <div className="w-16 flex justify-center">
          {hasChildren
            ? (expanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />)
            : <div className="w-4 h-4 rounded-full bg-border/50" />}
        </div>
        {level === 0 ? <PackageOpen size={18} className="text-primary" /> : <Layers size={16} className="text-muted" />}
        <div className="flex-1 text-sm font-medium">{node.descricao}</div>
        <div className="text-xs">
          {node.classificacao === 'MATERIA_PRIMA' && <span className="text-success text-xs px-8 py-2 rounded bg-success/10 font-bold">Matéria Prima</span>}
          {node.classificacao === 'SUBPRODUTO' && <span className="text-warning text-xs px-8 py-2 rounded bg-warning/10 font-bold">Subproduto</span>}
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="ml-16">
          {node.children.map((child, i) => <ArvoreNode key={`${child.id}-${i}`} node={child} level={level + 1} searchTerm={searchTerm} />)}
        </div>
      )}
    </div>
  )
}

// ─── Linha expandível da OP ──────────────────────────────────────────────────
const OPRow = ({ op }) => {
  const [expanded, setExpanded] = useState(false)
  const rendimento = op.peso_enviado > 0 ? ((op.peso_retornado / op.peso_enviado) * 100).toFixed(1) : '0.0'
  const rendColor = Number(rendimento) >= 80 ? '#10b981' : Number(rendimento) >= 60 ? '#fbbf24' : '#ef4444'

  return (
    <>
      <tr className="cursor-pointer hover:bg-bg-2 transition-colors" onClick={() => setExpanded(!expanded)}>
        <td className="td-mono text-muted">
          {expanded ? <ChevronDown size={14} style={{ display: 'inline', marginRight: 4 }} /> : <ChevronRight size={14} style={{ display: 'inline', marginRight: 4 }} />}
          #{op.id}
        </td>
        <td className="font-bold text-sm">{op.materia_prima}</td>
        <td><span className="text-xs text-muted font-mono">{op.lote || '-'}</span></td>
        <td><StatusBadgeOP status={op.status} /></td>
        <td style={{ textAlign: 'right' }} className="font-mono text-sm">{fmtNum(op.peso_enviado)}</td>
        <td style={{ textAlign: 'right' }} className="font-mono text-sm text-success">{fmtNum(op.peso_retornado)}</td>
        <td style={{ textAlign: 'right' }} className="font-mono text-sm text-danger">{fmtNum(op.perda)}</td>
        <td style={{ textAlign: 'right' }}><span style={{ color: rendColor, fontWeight: 700, fontSize: 13 }}>{rendimento}%</span></td>
        <td style={{ textAlign: 'right' }} className="font-mono text-sm">
          {op.qtd_caixas_geradas > 0
            ? <span className="text-primary font-bold">{op.qtd_caixas_geradas} cx</span>
            : <span className="text-muted">0 cx</span>}
        </td>
        <td style={{ textAlign: 'right' }} className="font-mono text-sm text-primary">{fmtNum(op.kg_gerados)}</td>
        <td className="text-muted text-xs">{fmtDate(op.data_inicio)}</td>
        <td className="text-muted text-xs">{fmtDate(op.data_fim)}</td>
        <td className="text-muted text-xs">{op.operador_nome || '-'}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={13} style={{ padding: 0, background: 'var(--bg-1)' }}>
            <div style={{ padding: '12px 24px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Box size={14} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Detalhe OP #{op.id} — Lote: {op.lote || 'N/A'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  { label: 'Peso Enviado',   val: fmtNum(op.peso_enviado) + ' kg',   color: 'var(--text)',    bg: 'var(--bg-2)',                    border: 'var(--border)' },
                  { label: 'Retornado',       val: fmtNum(op.peso_retornado) + ' kg', color: '#10b981',        bg: 'rgba(16,185,129,0.08)',           border: 'rgba(16,185,129,0.2)' },
                  { label: 'Perda',           val: fmtNum(op.perda) + ' kg',          color: '#ef4444',        bg: 'rgba(239,68,68,0.08)',            border: 'rgba(239,68,68,0.2)' },
                  { label: 'Rendimento',      val: rendimento + '%',                   color: rendColor,        bg: 'rgba(99,102,241,0.08)',           border: 'rgba(99,102,241,0.2)' },
                ].map((k, i) => (
                  <div key={i} style={{ background: k.bg, borderRadius: 8, padding: '10px 14px', border: `1px solid ${k.border}` }}>
                    <div style={{ fontSize: 10, color: k.color, fontWeight: 700, textTransform: 'uppercase', opacity: 0.7 }}>{k.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: k.color, marginTop: 2 }}>{k.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Componente Principal ────────────────────────────────────────────────────
export function Relatorios() {
  const { operador } = useAppStore()
  const cliente = isCliente(operador)
  const podeRelEstoque = temPermissao(operador, 'relatorios_estoque') || (!cliente && temPermissao(operador, 'produtos'))
  const podeRelProducao = temPermissao(operador, 'relatorios_producao') || (!cliente && temPermissao(operador, 'produtos'))

  const [activeTab, setActiveTab] = useState(() => (podeRelEstoque ? 'executivo' : podeRelProducao ? 'ops' : 'executivo'))
  const [presetAtivo, setPresetAtivo] = useState(2)
  const [categoriaCatalogo, setCategoriaCatalogo] = useState('TODOS')
  const [buscaCatalogo, setBuscaCatalogo] = useState('')
  const [catalogoAberto, setCatalogoAberto] = useState(true)

  // Datas de edição (o que o usuário digita)
  const [dataInicio, setDataInicio] = useState(() => subDays(new Date(), 29).toISOString().slice(0,10))
  const [dataFim,    setDataFim   ] = useState(() => new Date().toISOString().slice(0,10))

  // Datas "aplicadas" — apenas estas disparam a query
  const [periodoAtivo, setPeriodoAtivo] = useState(() => ({
    inicio: subDays(new Date(), 29).toISOString().slice(0,10),
    fim:    new Date().toISOString().slice(0,10),
  }))

  const [balanco,       setBalanco      ] = useState([])
  const [arvoreData,    setArvoreData   ] = useState({ produtos: [], arvore: [] })
  const [ordensProducao, setOrdensProducao] = useState([])

  const [filtroProduto,    setFiltroProduto   ] = useState('')
  const [filtroArvore,     setFiltroArvore    ] = useState('')
  const [filtroOP,         setFiltroOP        ] = useState('')
  const [filtroStatusOP,   setFiltroStatusOP  ] = useState('TODOS')
  const [agruparMateriaPrima, setAgruparMateriaPrima] = useState(false)
  const [loading, setLoading] = useState(false)

  // ── recebe datas como parâmetro → sem stale closure ──────────────────────
  const carregarRelatorios = async (inicio, fim) => {
    if (cliente || (!podeRelEstoque && !podeRelProducao)) return
    setLoading(true)
    try {
      const [bal, arv, ops] = await Promise.all([
        podeRelEstoque ? relatoriosQueries.getBalanco(inicio, fim) : Promise.resolve([]),
        podeRelProducao ? relatoriosQueries.getArvoreProducao() : Promise.resolve({ produtos: [], arvore: [] }),
        podeRelProducao ? relatoriosQueries.getOrdensProducao(inicio, fim) : Promise.resolve([]),
      ])
      setBalanco(bal)
      setArvoreData(arv)
      setOrdensProducao(ops)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (cliente && (activeTab === 'balanco' || activeTab === 'arvore')) {
      setActiveTab(podeRelEstoque ? 'executivo' : podeRelProducao ? 'ops' : 'executivo')
    } else if (activeTab === 'executivo' && !podeRelEstoque && podeRelProducao) {
      setActiveTab('ops')
    }
  }, [cliente, activeTab, podeRelEstoque, podeRelProducao])

  // Dispara sempre que periodoAtivo mudar (inclusive no mount)
  useEffect(() => {
    carregarRelatorios(periodoAtivo.inicio, periodoAtivo.fim)
  }, [periodoAtivo, cliente, podeRelEstoque, podeRelProducao])

  // Presets: atualiza input + aplica a query imediatamente
  const aplicarPreset = (index) => {
    const [ini, fim] = PRESETS[index].getRange()
    setPresetAtivo(index)
    setDataInicio(ini)
    setDataFim(fim)
    setPeriodoAtivo({ inicio: ini, fim: fim })
  }

  // Botão Buscar: aplica o que está nos inputs
  const buscar = () => {
    setPresetAtivo(null)
    setPeriodoAtivo({ inicio: dataInicio, fim: dataFim })
  }



  // ─── Árvore ───────────────────────────────────────────────────────────────
  const arvorePronta = useMemo(() => {
    const { produtos, arvore } = arvoreData
    const map = new Map()
    produtos.forEach(p => map.set(p.id, { ...p, children: [] }))
    arvore.forEach(link => {
      const pai = map.get(link.pai_id)
      const filho = map.get(link.filho_id)
      if (pai && filho) pai.children.push({ ...filho, children: [] })
    })
    let roots = produtos.filter(p => p.classificacao === 'MATERIA_PRIMA').map(p => map.get(p.id))
    if (filtroArvore) {
      const termo = filtroArvore.toLowerCase()
      const hasTerm = (node) => node.descricao.toLowerCase().includes(termo) || (node.children && node.children.some(c => hasTerm(c)))
      roots = roots.filter(r => hasTerm(r))
    }
    return roots.sort((a,b) => a.descricao.localeCompare(b.descricao))
  }, [arvoreData, filtroArvore])

  // ─── Balanço ──────────────────────────────────────────────────────────────
  const balancoView = useMemo(() => {
    let base = balanco
    if (filtroProduto) {
      const term = filtroProduto.toLowerCase()
      base = base.filter(b => b.descricao.toLowerCase().includes(term))
    }
    if (!agruparMateriaPrima) {
      return base.sort((a, b) => ((b.total_entrada||0) + Math.abs(b.total_saida||0)) - ((a.total_entrada||0) + Math.abs(a.total_saida||0)))
    }
    const map = new Map()
    const { arvore } = arvoreData
    const findRootId = (prodId) => {
      const parents = arvore.filter(a => a.filho_id === prodId)
      return parents.length === 0 ? prodId : findRootId(parents[0].pai_id)
    }
    base.forEach(b => {
      const rootId = findRootId(b.produto_id)
      const rootProd = arvoreData.produtos.find(p => p.id === rootId) || b
      if (!map.has(rootId)) map.set(rootId, { produto_id: rootId, descricao: rootProd.descricao, classificacao: rootProd.classificacao, total_entrada: 0, total_saida: 0 })
      const e = map.get(rootId)
      e.total_entrada += (b.total_entrada || 0)
      e.total_saida += (b.total_saida || 0)
    })
    return Array.from(map.values()).sort((a, b) => (b.total_entrada + Math.abs(b.total_saida)) - (a.total_entrada + Math.abs(a.total_saida)))
  }, [balanco, agruparMateriaPrima, filtroProduto, arvoreData])

  // ─── OPs filtradas ────────────────────────────────────────────────────────
  const opsView = useMemo(() => {
    let base = ordensProducao
    if (filtroStatusOP !== 'TODOS') base = base.filter(op => op.status === filtroStatusOP)
    if (filtroOP) {
      const t = filtroOP.toLowerCase()
      base = base.filter(op => (op.materia_prima || '').toLowerCase().includes(t) || (op.lote || '').toLowerCase().includes(t) || String(op.id).includes(t))
    }
    return base
  }, [ordensProducao, filtroOP, filtroStatusOP])

  // ─── KPIs OPs ─────────────────────────────────────────────────────────────
  const opKpis = useMemo(() => {
    const totalEnviado = ordensProducao.reduce((s, o) => s + Number(o.peso_enviado||0), 0)
    const totalRetornado = ordensProducao.reduce((s, o) => s + Number(o.peso_retornado||0), 0)
    return {
      total: ordensProducao.length,
      concluidas: ordensProducao.filter(o => o.status === 'CONCLUIDA').length,
      abertas: ordensProducao.filter(o => o.status === 'ABERTA').length,
      totalEnviado, totalRetornado,
      totalPerda: ordensProducao.reduce((s, o) => s + Number(o.perda||0), 0),
      rendimento: totalEnviado > 0 ? ((totalRetornado / totalEnviado) * 100).toFixed(1) : '0.0'
    }
  }, [ordensProducao])

  // ─── CSV Balanço ──────────────────────────────────────────────────────────
  const exportarCSVBalanco = () => {
    if (!balancoView.length) return
    const header = "CODIGO;PRODUTO;CLASSIFICACAO;ENTRADAS_KG;SAIDAS_KG;BALANCO_KG\n"
    const rows = balancoView.map(b => `${b.produto_id};${b.descricao};${b.classificacao};${(b.total_entrada||0).toFixed(2)};${(b.total_saida||0).toFixed(2)};${((b.total_entrada||0)-(b.total_saida||0)).toFixed(2)}`).join("\n")
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Balanco_${dataInicio}_${dataFim}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // ─── CSV OPs ──────────────────────────────────────────────────────────────
  const exportarCSVOPs = () => {
    if (!opsView.length) return
    const header = "ID;MATERIA_PRIMA;LOTE;STATUS;PESO_ENVIADO_KG;PESO_RETORNADO_KG;PERDA_KG;RENDIMENTO_PCT;CX_GERADAS;KG_GERADOS;DATA_INICIO;DATA_FIM;OPERADOR\n"
    const rows = opsView.map(op => {
      const rend = op.peso_enviado > 0 ? ((op.peso_retornado / op.peso_enviado) * 100).toFixed(1) : '0.0'
      return `${op.id};${op.materia_prima};${op.lote||''};${op.status};${fmtNum(op.peso_enviado)};${fmtNum(op.peso_retornado)};${fmtNum(op.perda)};${rend}%;${op.qtd_caixas_geradas};${fmtNum(op.kg_gerados)};${fmtDate(op.data_inicio)};${fmtDate(op.data_fim)};${op.operador_nome||''}`
    }).join("\n")
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `OPs_${dataInicio}_${dataFim}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // ─── Charts Balanço ───────────────────────────────────────────────────────
  const top10Entradas = useMemo(() => [...balancoView].filter(b => b.total_entrada > 0).sort((a,b) => b.total_entrada - a.total_entrada).slice(0,10), [balancoView])
  const top10Saidas   = useMemo(() => [...balancoView].filter(b => b.total_saida > 0).sort((a,b) => b.total_saida - a.total_saida).slice(0,10), [balancoView])
  const totalGeral    = useMemo(() => {
    let i = 0, s = 0; balancoView.forEach(b => { i += b.total_entrada; s += b.total_saida })
    return [{ name: 'Entradas', valor: i, fill: '#10b981' }, { name: 'Saídas', valor: s, fill: '#ef4444' }]
  }, [balancoView])


  // Bloco de filtro de período — JSX inline (não sub-componente) para não desmontar inputs a cada render
  const filtroPeriodoJSX = (
    <div className="card card--elevated mb-24 p-16">
      <div className="flex items-center gap-16 flex-wrap">
        <div className="flex items-center gap-8 text-sm font-bold text-muted"><Calendar size={16} /> Período:</div>
        <div className="flex gap-8 flex-wrap items-center">
          {PRESETS.map((p, i) => (
            <button key={i} onClick={() => aplicarPreset(i)} style={{
              padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1.5px solid',
              borderColor: presetAtivo === i ? 'var(--primary)' : 'transparent',
              backgroundColor: presetAtivo === i ? 'var(--primary-light)' : 'var(--bg-2)',
              color: presetAtivo === i ? 'var(--primary)' : 'var(--text-muted)'
            }}>{p.label}</button>
          ))}
          <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />
          <input
            type="date"
            className="form-input text-xs"
            value={dataInicio}
            onChange={e => { setDataInicio(e.target.value); setPresetAtivo(null) }}
            onKeyDown={e => e.key === 'Enter' && buscar()}
          />
          <span className="text-muted">até</span>
          <input
            type="date"
            className="form-input text-xs"
            value={dataFim}
            onChange={e => { setDataFim(e.target.value); setPresetAtivo(null) }}
            onKeyDown={e => e.key === 'Enter' && buscar()}
          />
          <button onClick={buscar} style={{
            padding: '6px 18px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Search size={13} /> Buscar
          </button>
        </div>
      </div>
    </div>
  )



  const catalogoCompleto = useMemo(() => {
    const classicos = []
    if (podeRelEstoque) {
      classicos.push({
        id: 'executivo',
        categoria: 'CLASSICOS',
        titulo: 'Relatório Geral WMS (PDF & Excel)',
        subtitulo: 'Estoque caixa a caixa, entradas, romaneios e saídas consolidadas',
        icon: FileSpreadsheet,
        cor: '#38bdf8',
        keywords: ['geral', 'executivo', 'pdf', 'excel', 'estoque', 'entradas', 'saidas', 'romaneio'],
      })
    }
    if (!cliente && podeRelEstoque) {
      classicos.push({
        id: 'balanco',
        categoria: 'CLASSICOS',
        titulo: 'Balanço de Entradas e Saídas',
        subtitulo: 'Comparativo de fluxo em kg por produto e gráficos Top 10',
        icon: TrendingUp,
        cor: '#10b981',
        keywords: ['balanco', 'entradas', 'saidas', 'fluxo', 'top 10', 'grafico'],
      })
    }
    if (podeRelProducao) {
      classicos.push({
        id: 'ops',
        categoria: 'CLASSICOS',
        titulo: cliente ? 'Produção Finalizada & Rendimento' : 'Transformação & Rendimento (OPs)',
        subtitulo: 'Dossiê completo de desossa, insumos, retornos e rendimento por OP',
        icon: Factory,
        cor: '#a78bfa',
        keywords: ['op', 'ops', 'producao', 'desossa', 'dossie', 'rendimento', 'transformacao'],
      })
    }
    if (!cliente && podeRelProducao) {
      classicos.push({
        id: 'arvore',
        categoria: 'CLASSICOS',
        titulo: 'Árvore de Produção (BOM)',
        subtitulo: 'Mapa hierárquico de matérias-primas e cortes subprodutos',
        icon: Layers,
        cor: '#f59e0b',
        keywords: ['arvore', 'bom', 'estrutura', 'materia prima', 'subproduto', 'cortes'],
      })
    }

    if (cliente) return classicos
    return [...classicos, ...CATALOGO_BI_RELATORIOS]
  }, [cliente, podeRelEstoque, podeRelProducao])

  const catalogoFiltrado = useMemo(() => {
    const q = buscaCatalogo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
    const tokens = q ? q.split(/\s+/).filter(Boolean) : []
    return catalogoCompleto.filter((item) => {
      if (categoriaCatalogo !== 'TODOS' && item.categoria !== categoriaCatalogo) return false
      if (tokens.length === 0) return true
      const hay = `${item.titulo} ${item.subtitulo} ${(item.keywords || []).join(' ')}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [catalogoCompleto, categoriaCatalogo, buscaCatalogo])

  const relatorioBiAtivo = useMemo(
    () => CATALOGO_BI_RELATORIOS.find((r) => r.id === activeTab) || null,
    [activeTab],
  )

  return (
    <div className="p-24 max-w-[1460px] mx-auto fade-in">
      <div className="flex items-center justify-between flex-wrap gap-12 mb-20 no-print">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-12">
            <PieChart className="text-primary" size={28} /> Central de Relatórios &amp; BI Gerencial
          </h1>
          <p className="text-muted mt-4">
            {cliente
              ? 'Relatórios consolidados de estoque e produção finalizada'
              : `${catalogoCompleto.length} relatórios gerenciais: 4 Clássicos WMS + 14 Indicadores de Estoque, Margem, PDV, Açougue, Compras e Logística`}
          </p>
        </div>
        {!cliente && (podeRelEstoque || podeRelProducao) && (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setCatalogoAberto((v) => !v)}
          >
            {catalogoAberto ? 'Recolher Catálogo (Foco no Relatório)' : `Mostrar Catálogo (${catalogoCompleto.length} Relatórios)`}
          </button>
        )}
      </div>

      {/* ─── Catálogo de Relatórios ──────────────────────────────────────────── */}
      {!podeRelEstoque && !podeRelProducao ? (
        <div className="card p-32 text-center border border-danger/30 bg-danger/5">
          <ShieldAlert size={36} className="text-danger mx-auto mb-12" />
          <div className="font-bold text-lg mb-4">Acesso restrito</div>
          <p className="text-sm text-muted">Seu usuário não possui permissão para visualizar relatórios gerenciais.</p>
        </div>
      ) : (
        <>
          {cliente ? (
            <div className="flex gap-8 mb-24 flex-wrap no-print">
              {catalogoCompleto.map((item) => {
                const IconItem = item.icon
                return (
                  <button
                    key={item.id}
                    className={`btn ${activeTab === item.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setActiveTab(item.id)}
                  >
                    <IconItem size={18} /> {item.titulo}
                  </button>
                )
              })}
            </div>
          ) : (
            catalogoAberto && (
              <div className="card p-16 mb-20 no-print" style={{ background: 'var(--bg-2)' }}>
                {/* Barra de busca + filtros de categoria */}
                <div className="flex gap-10 items-center flex-wrap mb-14">
                  <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
                    <Search
                      size={15}
                      style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#38bdf8' }}
                    />
                    <input
                      type="text"
                      className="form-input"
                      style={{ paddingLeft: 34, paddingRight: buscaCatalogo ? 32 : 12, height: 38 }}
                      placeholder="Buscar relatório... (ex.: curva abc, kardex, pdv, margem, açougue, inflação, otif, perdas)"
                      value={buscaCatalogo}
                      onChange={(e) => setBuscaCatalogo(e.target.value)}
                    />
                    {buscaCatalogo && (
                      <button
                        type="button"
                        onClick={() => setBuscaCatalogo('')}
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-6 flex-wrap">
                    {[
                      { id: 'TODOS', label: `Todos (${catalogoCompleto.length})` },
                      { id: 'CLASSICOS', label: 'Clássicos WMS (4)' },
                      { id: 'ESTOQUE', label: 'Estoque & WMS (6)' },
                      { id: 'COMERCIAL', label: 'Comercial & Varejo (5)' },
                      { id: 'COMPRAS_LOG', label: 'Compras & Logística (3)' },
                    ].map((cat) => {
                      const ativo = categoriaCatalogo === cat.id
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategoriaCatalogo(cat.id)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            border: ativo ? '1px solid #38bdf8' : '1px solid var(--border)',
                            background: ativo ? 'rgba(56,189,248,0.2)' : 'var(--bg-1)',
                            color: ativo ? '#f8fafc' : '#94a3b8',
                            cursor: 'pointer',
                          }}
                        >
                          {cat.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Grade de Cards clicáveis */}
                {catalogoFiltrado.length === 0 ? (
                  <div className="text-center p-16 text-muted text-sm">
                    Nenhum relatório encontrado para &ldquo;{buscaCatalogo}&rdquo;.
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))',
                      gap: 10,
                    }}
                  >
                    {catalogoFiltrado.map((item) => {
                      const IconItem = item.icon
                      const selecionado = activeTab === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveTab(item.id)}
                          style={{
                            textAlign: 'left',
                            padding: '11px 12px',
                            borderRadius: 10,
                            border: selecionado ? `1.5px solid ${item.cor || '#38bdf8'}` : '1px solid var(--border)',
                            background: selecionado ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-1)',
                            boxShadow: selecionado ? '0 0 0 2px rgba(56,189,248,0.16)' : 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              background: `${item.cor || '#38bdf8'}1f`,
                              color: item.cor || '#38bdf8',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              marginTop: 1,
                            }}
                          >
                            <IconItem size={16} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12.5,
                                fontWeight: 800,
                                color: '#f8fafc',
                                lineHeight: 1.25,
                              }}
                            >
                              {item.titulo}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: '#94a3b8',
                                marginTop: 3,
                                lineHeight: 1.3,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {item.subtitulo}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          )}

          <div className="card p-24">
            {relatorioBiAtivo && !cliente ? (
              <VisualizadorRelatorioBi relatorio={relatorioBiAtivo} />
            ) : activeTab === 'executivo' && podeRelEstoque ? (
              <RelatorioGeralWms somenteCliente={cliente} />
            ) : loading ? (
              <div className="text-center p-32 text-muted">Carregando...</div>
            ) : (
              <>
                {/* ── ABA BALANÇO ──────────────────────────────────────────────── */}
                {!cliente && podeRelEstoque && activeTab === 'balanco' && (
              <div>
                {filtroPeriodoJSX}
                <div className="flex justify-between items-center mb-24 flex-wrap gap-16">
                  <div className="flex gap-16 items-center flex-1">
                    <div className="relative flex-1 max-w-[400px]">
                      <Search size={16} className="absolute left-12 top-12 text-muted" />
                      <input type="text" placeholder="Buscar produto..." className="form-input pl-36" value={filtroProduto} onChange={e => setFiltroProduto(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-8 bg-bg-2 p-8 rounded px-12 border border-border">
                      <input type="checkbox" id="chk-agrupar" className="w-16 h-16" checked={agruparMateriaPrima} onChange={e => setAgruparMateriaPrima(e.target.checked)} />
                      <label htmlFor="chk-agrupar" className="cursor-pointer text-sm font-bold select-none text-warning">Ocultar Subprodutos</label>
                    </div>
                  </div>
                  <button className="btn btn--secondary" onClick={exportarCSVBalanco}>
                    <Download size={18} /> Exportar CSV
                  </button>
                </div>

                {balancoView.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 24 }}>
                    <div className="card border border-border p-16">
                      <h3 className="text-sm font-bold mb-12 text-center uppercase" style={{ color: 'var(--text-muted)' }}>Resumo Total (Kg)</h3>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={totalGeral} margin={{ top: 20, right: 20, left: 10, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 13, fontWeight: 'bold', fill: '#e2e2eb' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: '#8b8b9e' }} axisLine={false} tickLine={false} tickFormatter={v => Number(v).toLocaleString('pt-BR')} />
                          <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: '#1e1e2f', borderColor: '#2a2a3c', borderRadius: 8, fontSize: 12, color: '#fff' }} formatter={fmtKg} />
                          <Bar dataKey="valor" radius={[6,6,0,0]} barSize={70}>
                            {totalGeral.map((e, i) => <Cell key={i} fill={e.fill} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="card border border-border p-16">
                      <h3 className="text-sm font-bold mb-12 text-center uppercase" style={{ color: 'var(--text-muted)' }}>Top 10 Entradas</h3>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={top10Entradas} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#8b8b9e' }} axisLine={{ stroke: '#2a2a3c' }} tickLine={false} tickFormatter={v => Number(v).toLocaleString('pt-BR')} />
                          <YAxis dataKey="descricao" type="category" width={130} tick={{ fontSize: 9, fill: '#e2e2eb' }} axisLine={false} tickLine={false} tickFormatter={v => v.length > 18 ? v.slice(0,18)+'…' : v} />
                          <Tooltip cursor={{ fill: 'rgba(42,42,60,0.6)' }} contentStyle={{ backgroundColor: '#1e1e2f', borderColor: '#2a2a3c', borderRadius: 8, fontSize: 12, color: '#fff' }} itemStyle={{ color: '#10b981' }} formatter={fmtKg} />
                          <Bar dataKey="total_entrada" name="Entradas" fill="#10b981" radius={[0,4,4,0]} barSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="card border border-border p-16">
                      <h3 className="text-sm font-bold mb-12 text-center uppercase" style={{ color: 'var(--text-muted)' }}>Top 10 Saídas</h3>
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={top10Saidas} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11, fill: '#8b8b9e' }} axisLine={{ stroke: '#2a2a3c' }} tickLine={false} tickFormatter={v => Number(v).toLocaleString('pt-BR')} />
                          <YAxis dataKey="descricao" type="category" width={130} tick={{ fontSize: 9, fill: '#e2e2eb' }} axisLine={false} tickLine={false} tickFormatter={v => v.length > 18 ? v.slice(0,18)+'…' : v} />
                          <Tooltip cursor={{ fill: 'rgba(42,42,60,0.6)' }} contentStyle={{ backgroundColor: '#1e1e2f', borderColor: '#2a2a3c', borderRadius: 8, fontSize: 12, color: '#fff' }} itemStyle={{ color: '#ef4444' }} formatter={fmtKg} />
                          <Bar dataKey="total_saida" name="Saídas" fill="#ef4444" radius={[0,4,4,0]} barSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {balancoView.length === 0 ? (
                  <div className="text-center p-32 text-muted bg-bg-1 rounded">Nenhuma movimentação encontrada com os filtros atuais.</div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead><tr>
                        <th>Produto</th><th>Classificação</th>
                        <th style={{ textAlign: 'right' }}>Entradas (kg)</th>
                        <th style={{ textAlign: 'right' }}>Saídas (kg)</th>
                        <th style={{ textAlign: 'right' }}>Balanço (kg)</th>
                      </tr></thead>
                      <tbody>
                        {balancoView.map(b => {
                          const bc = b.total_entrada - b.total_saida
                          return (
                            <tr key={b.produto_id}>
                              <td className="font-bold text-sm">{b.descricao}</td>
                              <td>
                                {b.classificacao === 'MATERIA_PRIMA' && <span className="text-success text-xs border border-success/30 px-6 py-2 rounded-full">M. Prima</span>}
                                {b.classificacao === 'SUBPRODUTO' && <span className="text-warning text-xs border border-warning/30 px-6 py-2 rounded-full">Subproduto</span>}
                              </td>
                              <td style={{ textAlign: 'right' }} className="text-success text-sm">{b.total_entrada > 0 ? `+${b.total_entrada.toFixed(2)}` : '0.00'}</td>
                              <td style={{ textAlign: 'right' }} className="text-danger text-sm">{b.total_saida > 0 ? `-${b.total_saida.toFixed(2)}` : '0.00'}</td>
                              <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm">{bc.toFixed(2)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── ABA TRANSFORMAÇÃO & RENDIMENTO (OPs) ────────────────────── */}
            {podeRelProducao && activeTab === 'ops' && (
              <RelatorioDossieProducao
                titulo={cliente ? "Relatórios de Produção (Finalizada)" : "Dossiê de Transformação & Rendimento (OPs)"}
                somenteClienteFinalizado={cliente}
              />
            )}

            {/* ── ABA ÁRVORE ───────────────────────────────────────────────── */}
            {!cliente && podeRelProducao && activeTab === 'arvore' && (
              <div>
                <div className="flex justify-between items-center mb-24">
                  <div>
                    <h2 className="text-xl font-bold">Mapa Dinâmico do Frigorífico</h2>
                    <p className="text-muted text-sm mt-4">Grafo de produção aprendido pelo sistema através das OPs.</p>
                  </div>
                  <div className="relative w-[300px]">
                    <Search size={16} className="absolute left-12 top-10 text-muted" />
                    <input type="text" placeholder="Buscar Origem ou Subproduto..." className="form-input pl-36" value={filtroArvore} onChange={e => setFiltroArvore(e.target.value)} />
                  </div>
                </div>
                <div className="bg-bg-1 border border-border p-16 rounded overflow-auto" style={{ maxHeight: 600 }}>
                  {arvorePronta.length === 0
                    ? <div className="text-muted p-16 text-center">Nenhum mapeamento encontrado para esta busca.</div>
                    : arvorePronta.map(root => <ArvoreNode key={root.id} node={root} searchTerm={filtroArvore} />)
                  }
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
