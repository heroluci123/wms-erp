import React, { useState, useEffect, useRef } from 'react'
import { Search, Package, Box, MapPin, Activity, History, ChevronDown, ChevronRight, Clock, Download } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as produtosQueries from '../queries/produtos.js'
import * as consultaQueries from '../queries/consulta.js'

export function ConsultaEstoque() {
  const { toastError, toastSuccess } = useAppStore()
  
  // Search state
  const [searchTerm, setSearchTerm] = useState('')
  const [produtosDisponiveis, setProdutosDisponiveis] = useState([])
  const [sugestoes, setSugestoes] = useState([])
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false)
  
  // View states
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState(null) // 'caixa' ou 'produto'
  
  // Caixa View State (Rastreabilidade)
  const [caixaInfo, setCaixaInfo] = useState(null)
  const [historicoCaixa, setHistoricoCaixa] = useState(null)
  
  // Produto View State
  const [produtoSel, setProdutoSel] = useState(null)
  const [resumoProd, setResumoProd] = useState(null)
  const [enderecosProd, setEnderecosProd] = useState([])
  const [historicoProd, setHistoricoProd] = useState([])
  const [caixasNoEndereco, setCaixasNoEndereco] = useState({}) // { endereco: [caixas] }
  const [enderecoExpandido, setEnderecoExpandido] = useState(null)
  const [abaAtiva, setAbaAtiva] = useState('enderecos') // 'enderecos' | 'historico'

  const inputRef = useRef(null)

  // Carrega produtos para autocomplete
  useEffect(() => {
    produtosQueries.listar().then(setProdutosDisponiveis).catch(console.error)
  }, [])

  // Filtra sugestões conforme digitação
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSugestoes([])
      return
    }
    const termo = searchTerm.toLowerCase()
    const match = produtosDisponiveis.filter(p => 
      (p.codigo || '').toLowerCase().includes(termo) || 
      (p.descricao || '').toLowerCase().includes(termo)
    )
    setSugestoes(match.slice(0, 10)) // Max 10 sugestões
  }, [searchTerm, produtosDisponiveis])

  const handleBuscarEan = async (e) => {
    e?.preventDefault()
    if (!searchTerm.trim()) return
    
    setMostrarSugestoes(false)
    setLoading(true)
    
    try {
      // 1. Tenta achar como EAN único de caixa
      const caixa = await produtosQueries.buscarCaixaPorEan(searchTerm.trim())
      if (caixa) {
        // É uma caixa específica! Exibe visão Rastreabilidade
        const hist = await produtosQueries.buscarHistoricoCaixa(searchTerm.trim())
        setCaixaInfo(caixa)
        setHistoricoCaixa(hist)
        setViewMode('caixa')
        setLoading(false)
        return
      }

      // 2. Se não achou caixa, tenta achar se é um produto cadastrado (via código ou regra)
      const buscaProd = await produtosQueries.buscarPorCodigoComInfo(searchTerm.trim())
      if (buscaProd && buscaProd.produto) {
        selecionarProduto(buscaProd.produto)
        return
      }

      toastError('Não encontrado', 'Etiqueta ou produto não encontrado.')
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoading(false)
    }
  }

  const selecionarProduto = async (produto) => {
    setMostrarSugestoes(false)
    setSearchTerm(produto.descricao)
    setLoading(true)
    setViewMode('produto')
    setProdutoSel(produto)
    setAbaAtiva('enderecos')
    setEnderecoExpandido(null)
    setCaixasNoEndereco({})

    try {
      const [resumo, enderecos, historico] = await Promise.all([
        consultaQueries.buscarResumoProduto(produto.id),
        consultaQueries.buscarEnderecosPorProduto(produto.id),
        consultaQueries.buscarHistoricoPorProduto(produto.id, 500)
      ])
      
      setResumoProd(resumo)
      setEnderecosProd(enderecos)
      setHistoricoProd(historico)
    } catch (err) {
      toastError('Erro', 'Falha ao buscar dados do produto.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const toggleEndereco = async (endereco) => {
    if (enderecoExpandido === endereco) {
      setEnderecoExpandido(null)
      return
    }
    
    setEnderecoExpandido(endereco)
    if (!caixasNoEndereco[endereco]) {
      try {
        const caixas = await consultaQueries.buscarCaixasPorEnderecoEProduto(produtoSel.id, endereco)
        setCaixasNoEndereco(prev => ({ ...prev, [endereco]: caixas }))
      } catch (err) {
        toastError('Erro', 'Falha ao carregar caixas do endereço.')
      }
    }
  }

  const handleFocus = () => {
    if (searchTerm.trim() && sugestoes.length > 0) {
      setMostrarSugestoes(true)
    }
  }

  const handleExportarCSVSKU = async () => {
    try {
      setLoading(true)
      const isProdutoFiltrado = viewMode === 'produto' && produtoSel;
      const dados = await consultaQueries.buscarEstoqueConsolidado(isProdutoFiltrado ? produtoSel.id : null);
      
      if (!dados || dados.length === 0) {
        toastError('Estoque Vazio', 'Não há estoque disponível para exportar.')
        return
      }

      let csvContent = 'CODIGO;DESCRICAO;QUANTIDADE_KG\n'
      dados.forEach(row => {
        csvContent += `${row.codigo};"${row.descricao}";${row.total_kg.toFixed(2).replace('.', ',')}\n`
      })

      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `Estoque_Consolidado_${isProdutoFiltrado ? produtoSel.codigo : 'Geral'}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

    } catch (e) {
      toastError('Erro', 'Falha ao gerar CSV.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 40 }}>
      <div className="page-header mb-24 flex justify-between items-start flex-wrap gap-12">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Search size={28} /> Consulta de Estoque
          </h1>
          <p className="page-header__subtitle">Pesquise por EAN (Caixa) ou por Produto (SKU/Descrição) para ver o inventário completo.</p>
        </div>
        <button onClick={handleExportarCSVSKU} className="btn btn--outline btn--sm flex items-center gap-8" disabled={loading}>
          <Download size={16} /> Baixar CSV Consolidado
        </button>
      </div>

      {/* --- BARRA DE BUSCA HÍBRIDA --- */}
      <div className="card p-24 mb-24" style={{ overflow: 'visible', position: 'relative' }}>
        <form onSubmit={handleBuscarEan} className="flex gap-12 items-end">
          <div className="flex-1" style={{ position: 'relative' }}>
            <label className="form-label">O que você deseja consultar?</label>
            <input 
              ref={inputRef}
              autoFocus
              type="text" 
              className="form-input" 
              value={searchTerm} 
              onChange={e => {
                setSearchTerm(e.target.value)
                setMostrarSugestoes(true)
              }} 
              onFocus={handleFocus}
              onBlur={() => setTimeout(() => setMostrarSugestoes(false), 200)}
              placeholder="Digite o código de barras ou nome do produto..." 
            />
            {/* Dropdown Auto-Complete */}
            {mostrarSugestoes && sugestoes.length > 0 && (
              <div style={{ 
                position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-1)', 
                border: '1px solid var(--border)', borderRadius: '0 0 8px 8px', zIndex: 50, 
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)', maxHeight: 300, overflowY: 'auto' 
              }}>
                {sugestoes.map(prod => (
                  <div 
                    key={prod.id} 
                    className="p-12 border-b border-border hover:bg-bg-card cursor-pointer flex justify-between items-center"
                    onMouseDown={(e) => { e.preventDefault(); selecionarProduto(prod); }}
                  >
                    <div>
                      <div className="font-bold">{prod.descricao}</div>
                      <div className="text-xs text-muted">Cód: {prod.codigo}</div>
                    </div>
                    <Box size={16} className="text-muted" />
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Buscando...' : 'PESQUISAR'}
          </button>
        </form>
      </div>

      {/* --- VISÃO 1: RASTREABILIDADE DE CAIXA ESPECÍFICA --- */}
      {viewMode === 'caixa' && caixaInfo && (
        <div className="animate-fade-in">
          <div className="card p-24 mb-24" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <div className="text-xs text-muted mb-4 font-bold uppercase">Produto (Caixa Específica)</div>
              <div className="font-bold text-lg text-primary">{caixaInfo.produto_descricao}</div>
              <div className="text-sm text-muted">Cód: {caixaInfo.produto_codigo} | EAN: {caixaInfo.ean_caixa}</div>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <div className="text-xs text-muted mb-4 font-bold uppercase">Peso e Validade</div>
              <div className="font-bold text-cyan text-xl">{caixaInfo.peso_kg.toFixed(2)} kg</div>
              <div className="text-sm text-muted">Venc: {caixaInfo.validade ? new Date(caixaInfo.validade + 'T00:00:00').toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : '-'}</div>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <div className="text-xs text-muted mb-4 font-bold uppercase">Status Atual</div>
              <div className="font-bold" style={{ 
                fontSize: 18,
                color: caixaInfo.status === 'CONSUMIDA' ? 'var(--warning)' : caixaInfo.status === 'EXPEDIDA' ? 'var(--info)' : 'var(--success)'
              }}>
                {caixaInfo.status === 'CONSUMIDA' ? 'DESMEMBRADA' : caixaInfo.status === 'EXPEDIDA' ? 'EXPEDIDA' : caixaInfo.endereco}
              </div>
              {caixaInfo.status === 'DISPONIVEL' && <div className="text-sm text-muted">Em Estoque</div>}
            </div>
          </div>

          <div className="card p-24">
            <h3 className="font-bold mb-24 text-lg">Timeline da Caixa</h3>
            <div style={{ position: 'relative', borderLeft: '2px solid var(--border)', marginLeft: 12, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {historicoCaixa?.map((ev, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <div style={{ 
                    position: 'absolute', width: 14, height: 14, background: 'var(--accent)', 
                    borderRadius: '50%', left: -32, top: 4, border: '3px solid var(--bg-card)' 
                  }} />
                  <div className="flex flex-col md:flex-row justify-between md:items-center mb-4">
                    <div className="font-bold text-cyan" style={{ fontSize: 16 }}>{ev.tipo_operacao}</div>
                    <div className="text-sm text-muted flex items-center gap-4">
                      <Clock size={14}/> {new Date(ev.data_hora).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-sm">
                    {ev.endereco_origem && ev.endereco_destino ? (
                      <span>Movido de <strong className="text-warning">{ev.endereco_origem}</strong> para <strong className="text-success">{ev.endereco_destino}</strong></span>
                    ) : ev.endereco_destino ? (
                      <span>Endereçado em <strong className="text-success">{ev.endereco_destino}</strong></span>
                    ) : (
                      <span>Operação registrada no sistema.</span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-4">
                    Operador: {ev.operador_nome} | Peso Ref: {ev.peso_kg?.toFixed(2)} kg
                    {ev.detalhes && ` | Obs: ${ev.detalhes}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- VISÃO 2: DASHBOARD DO PRODUTO GERAL --- */}
      {viewMode === 'produto' && produtoSel && resumoProd && (
        <div className="animate-fade-in">
          {/* Header Produto */}
          <div className="flex items-center gap-16 mb-24 pb-16 border-b border-border">
            <div className="p-16 border border-border rounded-md" style={{ background: 'var(--bg-2)' }}>
              <Box size={32} className="text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">{produtoSel.descricao}</h2>
              <p className="text-muted">Cód: {produtoSel.codigo} | Grupo: {produtoSel.grupo || 'Geral'}</p>
            </div>
          </div>

          {/* Cards Métricas */}
          <div className="form-grid form-grid--3 mb-24">
            <div className="card p-24" style={{ borderTop: '4px solid var(--success)' }}>
              <div className="text-xs text-muted font-bold uppercase mb-8">Saldo Atual em Estoque</div>
              <div className="flex items-end gap-12">
                <div className="text-3xl font-bold text-success">{resumoProd.saldoCaixas} cx</div>
                <div className="text-lg text-muted mb-4">{resumoProd.saldoKg?.toFixed(2)} kg</div>
              </div>
            </div>
            <div className="card p-24" style={{ borderTop: '4px solid var(--primary)' }}>
              <div className="text-xs text-muted font-bold uppercase mb-8">Total Recebido (Histórico)</div>
              <div className="text-3xl font-bold text-primary">{resumoProd.entradasCaixas} cx</div>
            </div>
            <div className="card p-24" style={{ borderTop: '4px solid var(--info)' }}>
              <div className="text-xs text-muted font-bold uppercase mb-8">Total Expedido (Histórico)</div>
              <div className="text-3xl font-bold text-info">{resumoProd.saidasCaixas} cx</div>
            </div>
          </div>

          {/* Abas */}
          <div className="card p-0 mb-24 overflow-hidden">
            <div className="flex border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <button 
                className={`p-16 font-bold flex items-center gap-8 ${abaAtiva === 'enderecos' ? 'border-b-2 border-primary' : 'text-muted'}`}
                style={{ background: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', color: abaAtiva === 'enderecos' ? '#ffffff' : undefined }}
                onClick={() => setAbaAtiva('enderecos')}
              >
                <MapPin size={18} /> Onde está no Estoque?
              </button>
              <button 
                className={`p-16 font-bold flex items-center gap-8 ${abaAtiva === 'historico' ? 'border-b-2 border-primary' : 'text-muted'}`}
                style={{ background: 'transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', color: abaAtiva === 'historico' ? '#ffffff' : undefined }}
                onClick={() => setAbaAtiva('historico')}
              >
                <Activity size={18} /> Histórico Geral do Produto
              </button>
            </div>

            <div className="p-24">
              {/* ABA: ENDEREÇOS */}
              {abaAtiva === 'enderecos' && (
                <div>
                  {enderecosProd.length === 0 ? (
                    <div className="text-center p-32 text-muted border border-dashed border-border rounded-md">
                      <Box size={48} className="mx-auto mb-16 opacity-50" />
                      Não há saldo ativo em endereços para este produto no momento.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-12">
                      {enderecosProd.map(end => (
                        <div key={end.endereco} className="border border-border rounded-md overflow-hidden">
                          <button 
                            className="w-full flex items-center justify-between p-16 transition-colors"
                            style={{ background: 'var(--bg-2)', border: 'none', color: 'var(--text-primary)' }}
                            onClick={() => toggleEndereco(end.endereco)}
                          >
                            <div className="flex items-center gap-12">
                              {enderecoExpandido === end.endereco ? <ChevronDown size={20} className="text-primary"/> : <ChevronRight size={20} className="text-muted"/>}
                              <span className="font-bold text-lg">{end.endereco}</span>
                            </div>
                            <div className="flex items-center gap-24 text-sm">
                              <span className="text-muted"><strong className="text-success">{end.qtd_caixas}</strong> caixas</span>
                              <span className="text-muted"><strong className="text-cyan">{end.qtd_kg?.toFixed(2)}</strong> kg</span>
                            </div>
                          </button>
                          
                          {enderecoExpandido === end.endereco && (
                            <div className="p-16 border-t border-border" style={{ background: 'var(--bg-1)' }}>
                              {!caixasNoEndereco[end.endereco] ? (
                                <div className="text-center text-muted p-12">Carregando caixas...</div>
                              ) : (
                                <div className="table-container">
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>EAN da Caixa</th>
                                        <th>Peso</th>
                                        <th>Validade</th>
                                        <th>Data Entrada</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {caixasNoEndereco[end.endereco].map(cx => (
                                        <tr key={cx.id}>
                                          <td className="td-mono text-cyan">{cx.ean_caixa}</td>
                                          <td className="font-bold">{cx.peso_kg?.toFixed(2)} kg</td>
                                          <td>{cx.validade ? new Date(cx.validade + 'T00:00:00').toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : '-'}</td>
                                          <td className="text-muted text-sm">{new Date(cx.created_at).toLocaleString()}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ABA: HISTÓRICO GERAL */}
              {abaAtiva === 'historico' && (
                <div>
                  <p className="text-sm text-muted mb-16">Mostrando as últimas {historicoProd.length} movimentações deste produto.</p>
                  {historicoProd.length === 0 ? (
                    <div className="text-center p-32 text-muted border border-dashed border-border rounded-md">
                      Nenhum histórico registrado para este produto.
                    </div>
                  ) : (
                    <div className="table-container" style={{ maxHeight: 600, overflowY: 'auto' }}>
                      <table style={{ fontSize: 12 }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                          <tr>
                            <th>Data/Hora</th>
                            <th>Operação</th>
                            <th>Quantidade / Peso</th>
                            <th>Origem &rarr; Destino</th>
                            <th>Operador</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historicoProd.map(log => (
                            <tr key={log.id}>
                              <td className="text-muted whitespace-nowrap">{new Date(log.data_hora).toLocaleString()}</td>
                              <td><span className={`badge ${log.tipo === 'RECEBIMENTO' ? 'badge--primary' : log.tipo === 'SAIDA' || log.tipo === 'EXPEDICAO' ? 'badge--info' : 'badge--warning'}`}>{log.tipo}</span></td>
                              <td className="font-bold">{log.qtd_caixas} cx <span className="text-muted font-normal ml-4 text-xs">({log.qtd_kg?.toFixed(2)} kg)</span></td>
                              <td>
                                {log.endereco_origem || '-'} <span className="text-muted mx-4">&rarr;</span> <span className="font-bold">{log.endereco_destino || '-'}</span>
                              </td>
                              <td className="text-muted">{log.operador_nome || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
