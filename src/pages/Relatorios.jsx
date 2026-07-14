import React, { useState, useEffect, useMemo } from 'react'
import { PieChart, TrendingUp, ChevronRight, ChevronDown, PackageOpen, Layers, Calendar, Search, Download } from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth, startOfYear } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import * as relatoriosQueries from '../queries/relatorios'

const PRESETS = [
  { label: 'Hoje',    getRange: () => { const d = new Date().toISOString().slice(0,10); return [d, d] } },
  { label: '7 dias',  getRange: () => [subDays(new Date(), 6).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: '30 dias', getRange: () => [subDays(new Date(), 29).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: 'Este mês', getRange: () => [startOfMonth(new Date()).toISOString().slice(0,10), endOfMonth(new Date()).toISOString().slice(0,10)] },
  { label: 'Este ano', getRange: () => [startOfYear(new Date()).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
]

// Componente Recursivo para Árvore
const ArvoreNode = ({ node, level = 0, searchTerm = '' }) => {
  // Expand automatically if it contains a search term, else start collapsed
  const matchesSearch = searchTerm && node.descricao.toLowerCase().includes(searchTerm.toLowerCase())
  const [expanded, setExpanded] = useState(false)
  
  useEffect(() => {
    if (searchTerm) setExpanded(true)
  }, [searchTerm])

  const hasChildren = node.children && node.children.length > 0
  
  return (
    <div className="relative">
      <div 
        className={`flex items-center gap-12 py-8 px-12 rounded cursor-pointer hover:bg-bg-2 transition-colors ${matchesSearch ? 'bg-bg-3' : ''} ${level === 0 ? 'bg-bg-1 border-b border-border font-bold mt-4' : ''}`}
        onClick={() => setExpanded(!expanded)}
        style={{ paddingLeft: level === 0 ? 12 : 24 }}
      >
        <div className="w-16 flex justify-center">
          {hasChildren ? (
            expanded ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-border"></div>
          )}
        </div>
        
        {level === 0 ? <PackageOpen size={16} className="text-primary" /> : <Layers size={14} className="text-muted" />}
        
        <div className="flex-1 text-sm">
          <span>{node.descricao}</span>
        </div>
        
        <div className="text-xs">
          {node.classificacao === 'MATERIA_PRIMA' && <span className="text-success text-xs border border-success/30 px-6 py-2 rounded-full">Matéria Prima</span>}
          {node.classificacao === 'SUBPRODUTO' && <span className="text-warning text-xs border border-warning/30 px-6 py-2 rounded-full">Subproduto</span>}
        </div>
      </div>
      
      {expanded && hasChildren && (
        <div className="border-l border-border ml-16 pl-8">
          {node.children.map((child, i) => (
            <ArvoreNode key={`${child.id}-${i}`} node={child} level={level + 1} searchTerm={searchTerm} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Relatorios() {
  const [activeTab, setActiveTab] = useState('balanco')
  const [presetAtivo, setPresetAtivo] = useState(2) // 30 dias
  const [dataInicio, setDataInicio] = useState(() => subDays(new Date(), 29).toISOString().slice(0,10))
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0,10))
  
  const [balanco, setBalanco] = useState([])
  const [arvoreData, setArvoreData] = useState({ produtos: [], arvore: [] })
  
  const [filtroProduto, setFiltroProduto] = useState('')
  const [filtroArvore, setFiltroArvore] = useState('')
  const [agruparMateriaPrima, setAgruparMateriaPrima] = useState(false)
  const [loading, setLoading] = useState(false)

  const aplicarPreset = (index) => {
    setPresetAtivo(index)
    const [ini, fim] = PRESETS[index].getRange()
    setDataInicio(ini)
    setDataFim(fim)
  }

  const carregarRelatorios = async () => {
    setLoading(true)
    try {
      const bal = await relatoriosQueries.getBalanco(dataInicio, dataFim)
      const arv = await relatoriosQueries.getArvoreProducao()
      setBalanco(bal)
      setArvoreData(arv)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarRelatorios()
  }, [dataInicio, dataFim])

  // Construir Árvore Hierárquica a partir do Grafo
  const arvorePronta = useMemo(() => {
    const { produtos, arvore } = arvoreData
    const map = new Map()
    produtos.forEach(p => map.set(p.id, { ...p, children: [] }))
    
    // Associar filhos
    arvore.forEach(link => {
      const pai = map.get(link.pai_id)
      const filho = map.get(link.filho_id)
      if (pai && filho) {
        // Clonamos o filho para que uma mesma referência não crie loops ao ter múltiplos pais
        pai.children.push({ ...filho, children: [] })
      }
    })

    // No Grafo, uma Materia Prima pode ter filhos que tb tem filhos. 
    // Para renderizar, pegamos todas as raízes (Matéria Prima)
    let roots = produtos.filter(p => p.classificacao === 'MATERIA_PRIMA').map(p => map.get(p.id))
    
    // Filtrar pela barra de pesquisa
    if (filtroArvore) {
      const termo = filtroArvore.toLowerCase()
      // Filtra raízes que combinam ou que têm algum filho/neto que combina
      const hasTerm = (node) => {
        if (node.descricao.toLowerCase().includes(termo)) return true
        if (node.children && node.children.some(c => hasTerm(c))) return true
        return false
      }
      roots = roots.filter(r => hasTerm(r))
    }

    return roots.sort((a,b) => a.descricao.localeCompare(b.descricao))
  }, [arvoreData, filtroArvore])

  // Calcular Balanço (Agrupado ou Não)
  const balancoView = useMemo(() => {
    let base = balanco
    
    if (filtroProduto) {
      const term = filtroProduto.toLowerCase()
      base = base.filter(b => b.descricao.toLowerCase().includes(term))
    }

    if (!agruparMateriaPrima) return base
    
    const map = new Map()
    const { arvore } = arvoreData
    
    // Busca recursiva pra achar as Raizes de um ID (Pode ter mais de 1, pegaremos a primeira encontrada por simplicidade no balanço)
    const findRootId = (prodId) => {
      const parents = arvore.filter(a => a.filho_id === prodId)
      if (parents.length === 0) return prodId
      return findRootId(parents[0].pai_id)
    }

    base.forEach(b => {
      const rootId = findRootId(b.produto_id)
      const rootProd = arvoreData.produtos.find(p => p.id === rootId) || b
      
      if (!map.has(rootId)) {
        map.set(rootId, {
          produto_id: rootId,
          descricao: rootProd.descricao,
          classificacao: rootProd.classificacao,
          total_entrada: 0,
          total_saida: 0
        })
      }
      
      const entry = map.get(rootId)
      entry.total_entrada += (b.total_entrada || 0)
      entry.total_saida += (b.total_saida || 0)
    })
    
    return Array.from(map.values()).sort((a, b) => a.descricao.localeCompare(b.descricao))
  }, [balanco, agruparMateriaPrima, filtroProduto, arvoreData])

  const exportarCSV = () => {
    if (balancoView.length === 0) return
    const header = "CODIGO;PRODUTO;CLASSIFICACAO;ENTRADAS_KG;SAIDAS_KG;BALANCO_KG\n"
    const rows = balancoView.map(b => 
      `${b.produto_id};${b.descricao};${b.classificacao};${(b.total_entrada||0).toFixed(2)};${(b.total_saida||0).toFixed(2)};${((b.total_entrada||0) - (b.total_saida||0)).toFixed(2)}`
    ).join("\n")
    
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `Relatorio_Balanco_${dataInicio}_${dataFim}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Gráficos Data
  const top10 = useMemo(() => {
    return [...balancoView]
      .sort((a,b) => (b.total_entrada + b.total_saida) - (a.total_entrada + a.total_saida))
      .slice(0, 10)
  }, [balancoView])

  const totalGeral = useMemo(() => {
    let inTotal = 0, outTotal = 0
    balancoView.forEach(b => { inTotal += b.total_entrada; outTotal += b.total_saida })
    return [
      { name: 'Entradas', valor: inTotal, fill: '#10b981' },
      { name: 'Saídas', valor: outTotal, fill: '#ef4444' }
    ]
  }, [balancoView])

  return (
    <div className="p-24 max-w-[1200px] mx-auto fade-in">
      <div className="flex items-center justify-between mb-24">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-12">
            <PieChart className="text-primary" size={28} /> Relatórios
          </h1>
          <p className="text-muted mt-4">Análise gerencial e inteligência de produção</p>
        </div>
      </div>

      <div className="flex gap-16 mb-24">
        <button 
          className={`btn ${activeTab === 'balanco' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setActiveTab('balanco')}
        >
          <TrendingUp size={18} /> Balanço de Entradas e Saídas
        </button>
        <button 
          className={`btn ${activeTab === 'arvore' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setActiveTab('arvore')}
        >
          <Layers size={18} /> Árvore de Produção (BOM)
        </button>
      </div>

      <div className="card p-24">
        {loading ? (
          <div className="text-center p-32 text-muted">Carregando...</div>
        ) : (
          <>
            {activeTab === 'balanco' && (
              <div>
                {/* Filtros */}
                <div className="card card--elevated mb-24 p-16">
                  <div className="flex items-center gap-16 flex-wrap">
                    <div className="flex items-center gap-8 text-sm font-bold text-muted">
                      <Calendar size={16} /> Período:
                    </div>
                    <div className="flex gap-8 flex-wrap">
                      {PRESETS.map((p, i) => (
                        <button key={i} onClick={() => aplicarPreset(i)} style={{
                          padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1.5px solid',
                          borderColor: presetAtivo === i ? 'var(--primary)' : 'transparent',
                          backgroundColor: presetAtivo === i ? 'var(--primary-light)' : 'var(--bg-2)',
                          color: presetAtivo === i ? 'var(--primary)' : 'var(--text-muted)'
                        }}>
                          {p.label}
                        </button>
                      ))}
                      <input type="date" className="form-input text-xs" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setPresetAtivo(null) }} />
                      <span className="text-muted">até</span>
                      <input type="date" className="form-input text-xs" value={dataFim} onChange={e => { setDataFim(e.target.value); setPresetAtivo(null) }} />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center mb-24 flex-wrap gap-16">
                  <div className="flex gap-16 items-center flex-1">
                    <div className="relative flex-1 max-w-[400px]">
                      <Search size={16} className="absolute left-12 top-12 text-muted" />
                      <input 
                        type="text" 
                        placeholder="Buscar produto..." 
                        className="form-input pl-36"
                        value={filtroProduto}
                        onChange={e => setFiltroProduto(e.target.value)}
                      />
                    </div>
                    
                    <div className="flex items-center gap-8 bg-bg-2 p-8 rounded px-12 border border-border">
                      <input 
                        type="checkbox" 
                        id="chk-agrupar"
                        className="w-16 h-16"
                        checked={agruparMateriaPrima}
                        onChange={e => setAgruparMateriaPrima(e.target.checked)}
                      />
                      <label htmlFor="chk-agrupar" className="cursor-pointer text-sm font-bold select-none text-warning">
                        Ocultar Subprodutos
                      </label>
                    </div>
                  </div>
                  
                  <button className="btn btn--secondary" onClick={exportarCSV}>
                    <Download size={18} /> Exportar CSV
                  </button>
                </div>

                {/* Gráficos */}
                {balancoView.length > 0 && (
                  <div className="flex gap-24 mb-24">
                    <div className="flex-1 card border border-border p-16">
                      <h3 className="text-sm font-bold mb-16 text-center">Top 10 Movimentações (Kg)</h3>
                      <div style={{ height: 250 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={top10} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" />
                            <XAxis dataKey="descricao" tick={{fontSize: 10}} interval={0} angle={-25} textAnchor="end" />
                            <YAxis tick={{fontSize: 12}} />
                            <Tooltip contentStyle={{backgroundColor: '#1e1e2f', borderColor: '#2a2a3c'}} />
                            <Legend wrapperStyle={{fontSize: 12}} />
                            <Bar dataKey="total_entrada" name="Entradas" fill="#10b981" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="total_saida" name="Saídas" fill="#ef4444" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="w-[300px] card border border-border p-16">
                      <h3 className="text-sm font-bold mb-16 text-center">Resumo Total</h3>
                      <div style={{ height: 250 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={totalGeral} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" />
                            <XAxis dataKey="name" tick={{fontSize: 12}} />
                            <YAxis tick={{fontSize: 12}} />
                            <Tooltip contentStyle={{backgroundColor: '#1e1e2f', borderColor: '#2a2a3c'}} cursor={{fill: 'transparent'}} />
                            <Bar dataKey="valor" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {balancoView.length === 0 ? (
                  <div className="text-center p-32 text-muted bg-bg-1 rounded">Nenhuma movimentação encontrada com os filtros atuais.</div>
                ) : (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Classificação</th>
                          <th style={{ textAlign: 'right' }}>Entradas (kg)</th>
                          <th style={{ textAlign: 'right' }}>Saídas (kg)</th>
                          <th style={{ textAlign: 'right' }}>Balanço (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balancoView.map(b => {
                          const balancoCalc = b.total_entrada - b.total_saida
                          return (
                            <tr key={b.produto_id}>
                              <td className="font-bold text-sm">{b.descricao}</td>
                              <td>
                                {b.classificacao === 'MATERIA_PRIMA' && <span className="text-success text-xs border border-success/30 px-6 py-2 rounded-full">M. Prima</span>}
                                {b.classificacao === 'SUBPRODUTO' && <span className="text-warning text-xs border border-warning/30 px-6 py-2 rounded-full">Subproduto</span>}
                              </td>
                              <td style={{ textAlign: 'right' }} className="text-success text-sm">
                                {b.total_entrada > 0 ? `+${b.total_entrada.toFixed(2)}` : '0.00'}
                              </td>
                              <td style={{ textAlign: 'right' }} className="text-danger text-sm">
                                {b.total_saida > 0 ? `-${b.total_saida.toFixed(2)}` : '0.00'}
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm">
                                {balancoCalc.toFixed(2)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'arvore' && (
              <div>
                <div className="flex justify-between items-center mb-24">
                  <div>
                    <h2 className="text-xl font-bold">Mapa Dinâmico do Frigorífico</h2>
                    <p className="text-muted text-sm mt-4">Grafo de produção aprendido pelo sistema através das OPs.</p>
                  </div>
                  <div className="relative w-[300px]">
                    <Search size={16} className="absolute left-12 top-10 text-muted" />
                    <input 
                      type="text" 
                      placeholder="Buscar Origem ou Subproduto..." 
                      className="form-input pl-36"
                      value={filtroArvore}
                      onChange={e => setFiltroArvore(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="bg-bg-1 border border-border p-16 rounded overflow-auto" style={{ maxHeight: 600 }}>
                  {arvorePronta.length === 0 ? (
                    <div className="text-muted p-16 text-center">Nenhum mapeamento encontrado para esta busca.</div>
                  ) : (
                    arvorePronta.map(root => (
                      <ArvoreNode key={root.id} node={root} searchTerm={filtroArvore} />
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
