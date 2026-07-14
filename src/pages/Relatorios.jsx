import React, { useState, useEffect } from 'react'
import { PieChart, TrendingUp, ChevronRight, ChevronDown, PackageOpen, Layers } from 'lucide-react'
import * as relatoriosQueries from '../queries/relatorios'

// Componente Recursivo para Árvore
const ArvoreNode = ({ node, level = 0 }) => {
  const [expanded, setExpanded] = useState(level === 0)
  const hasChildren = node.children && node.children.length > 0
  
  return (
    <div style={{ marginLeft: level * 24 }} className="mb-4">
      <div 
        className={`flex items-center gap-8 p-8 rounded cursor-pointer hover:bg-bg-2 transition-colors ${level === 0 ? 'bg-bg-1 border border-border mb-8 font-bold' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-16 flex justify-center">
          {hasChildren ? (
            expanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-border"></div>
          )}
        </div>
        
        {level === 0 ? <PackageOpen size={18} className="text-primary" /> : <Layers size={16} className="text-muted" />}
        
        <div className="flex-1">
          <span>{node.descricao}</span>
        </div>
        
        <div className="text-xs">
          {node.classificacao === 'MATERIA_PRIMA' && <span className="badge badge--success">Matéria Prima</span>}
          {node.classificacao === 'SUBPRODUTO' && <span className="badge badge--warning">Subproduto</span>}
        </div>
      </div>
      
      {expanded && hasChildren && (
        <div className="mt-4 border-l-2 border-border ml-8 pl-8">
          {node.children.map(child => (
            <ArvoreNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Relatorios() {
  const [activeTab, setActiveTab] = useState('balanco')
  const [mesAno, setMesAno] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  
  const [balanco, setBalanco] = useState([])
  const [arvore, setArvore] = useState([])
  const [agruparMateriaPrima, setAgruparMateriaPrima] = useState(false)
  const [loading, setLoading] = useState(false)

  const carregarRelatorios = async () => {
    setLoading(true)
    try {
      const bal = await relatoriosQueries.getBalancoMensal(mesAno)
      const arv = await relatoriosQueries.getArvoreProducao()
      setBalanco(bal)
      setArvore(arv)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarRelatorios()
  }, [mesAno])

  // Construir Árvore Hierárquica
  const buildTree = (produtos) => {
    const map = new Map()
    produtos.forEach(p => map.set(p.id, { ...p, children: [] }))
    
    const roots = []
    produtos.forEach(p => {
      const node = map.get(p.id)
      if (p.produto_pai_id && map.has(p.produto_pai_id)) {
        map.get(p.produto_pai_id).children.push(node)
      } else {
        if (p.classificacao === 'MATERIA_PRIMA' || (!p.produto_pai_id && p.classificacao === 'SUBPRODUTO')) {
          roots.push(node)
        }
      }
    })
    return roots
  }

  const arvorePronta = buildTree(arvore)

  // Calcular Balanço (Agrupado ou Não)
  const getBalancoView = () => {
    if (!agruparMateriaPrima) return balanco
    
    const map = new Map()
    
    // Helper para achar o ID da Matéria Prima raiz de um produto
    const findRootId = (prodId) => {
      const prod = arvore.find(p => p.id === prodId)
      if (!prod) return prodId
      if (prod.produto_pai_id) return findRootId(prod.produto_pai_id)
      return prodId
    }

    balanco.forEach(b => {
      const rootId = findRootId(b.produto_id)
      const rootProd = arvore.find(p => p.id === rootId) || b
      
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
  }

  const balancoView = getBalancoView()

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
                <div className="flex justify-between items-center mb-24 bg-bg-1 p-16 rounded border border-border">
                  <div className="flex gap-16 items-center">
                    <div>
                      <label className="text-xs text-muted block mb-4 uppercase font-bold">Mês Referência</label>
                      <input 
                        type="month" 
                        className="form-input" 
                        value={mesAno} 
                        onChange={e => setMesAno(e.target.value)}
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-8 bg-bg-2 p-12 rounded">
                    <input 
                      type="checkbox" 
                      id="chk-agrupar"
                      className="w-16 h-16"
                      checked={agruparMateriaPrima}
                      onChange={e => setAgruparMateriaPrima(e.target.checked)}
                    />
                    <label htmlFor="chk-agrupar" className="cursor-pointer font-bold select-none text-warning">
                      Ocultar Subprodutos e Agrupar por Peça Inteira
                    </label>
                  </div>
                </div>

                {balancoView.length === 0 ? (
                  <div className="text-center p-32 text-muted bg-bg-1 rounded">Nenhuma movimentação encontrada neste mês.</div>
                ) : (
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
                            <td className="font-bold">{b.descricao}</td>
                            <td>
                              {b.classificacao === 'MATERIA_PRIMA' && <span className="badge badge--success text-xs">M. Prima</span>}
                              {b.classificacao === 'SUBPRODUTO' && <span className="badge badge--warning text-xs">Subproduto</span>}
                            </td>
                            <td style={{ textAlign: 'right' }} className="text-success">
                              {b.total_entrada > 0 ? `+${b.total_entrada.toFixed(2)}` : '0.00'}
                            </td>
                            <td style={{ textAlign: 'right' }} className="text-danger">
                              {b.total_saida > 0 ? `-${b.total_saida.toFixed(2)}` : '0.00'}
                            </td>
                            <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                              {balancoCalc.toFixed(2)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {activeTab === 'arvore' && (
              <div>
                <div className="mb-24">
                  <h2 className="text-xl font-bold">Mapa do Frigorífico</h2>
                  <p className="text-muted">A hierarquia de produção aprendida automaticamente pelo sistema.</p>
                </div>
                
                <div className="bg-bg relative p-16 rounded overflow-auto" style={{ maxHeight: 600 }}>
                  {arvorePronta.length === 0 ? (
                    <div className="text-muted p-16">Nenhuma árvore gerada ainda. Finalize ordens de produção para o sistema aprender!</div>
                  ) : (
                    arvorePronta.map(root => (
                      <ArvoreNode key={root.id} node={root} />
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
