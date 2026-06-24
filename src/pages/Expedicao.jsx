import React, { useState, useEffect } from 'react'
import { Box, CheckCircle2, Truck, RefreshCw, XCircle, History, Download, Trash2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { format } from 'date-fns'

export function Expedicao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('pendentes') // 'pendentes' | 'historico'
  const [historico, setHistorico] = useState([])
  const [filtroProduto, setFiltroProduto] = useState('')
  const [filtroData, setFiltroData] = useState('')
  const [incluirInsumos, setIncluirInsumos] = useState(false)

  const historicoFiltrado = historico.filter(h => {
    const pStr = (h.codigo + ' ' + h.descricao).toLowerCase()
    const pMatch = pStr.includes(filtroProduto.toLowerCase())
    const dMatch = filtroData ? format(new Date(h.data_hora), 'yyyy-MM-dd') === filtroData : true
    return pMatch && dMatch
  })

  const carregarHistorico = async () => {
    try {
      const logs = await window.wmsAPI.movimentacoes.listarLog({ tipo: 'DESPACHO', incluirInsumos })
      setHistorico(logs)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar histórico')
    }
  }

  useEffect(() => {
    if (activeTab === 'historico') carregarHistorico()
  }, [activeTab, incluirInsumos])

  const exportarCSV = () => {
    if (historicoFiltrado.length === 0) return toastWarning('Aviso', 'Nenhum dado para exportar.')
    const cabecalho = ['ID', 'Data/Hora', 'Produto', 'Descricao', 'Lote', 'Caixas', 'KG', 'Valor Total (R$)', 'Operador']
    const linhas = historicoFiltrado.map(h => [
      h.id,
      format(new Date(h.data_hora), 'dd/MM/yyyy HH:mm:ss'),
      h.codigo,
      h.descricao,
      h.lote,
      h.qtd_caixas,
      h.qtd_kg,
      (h.qtd_kg * (h.valor_unitario || 0)).toFixed(2).replace('.', ','),
      h.operador_nome || ''
    ])
    
    let csvContent = "data:text/csv;charset=utf-8," + cabecalho.join(";") + "\\n"
    linhas.forEach(row => {
      csvContent += row.join(";") + "\\n"
    })
    
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `historico_expedicao_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const carregarExpedicao = async () => {
    setLoading(true)
    try {
      const data = await window.wmsAPI.movimentacoes.listarExpedicao()
      setItens(data)
    } catch (err) {
      toastError('Erro', 'Falha ao carregar área de expedição.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarExpedicao()
  }, [])

  const handleDespacho = async (produto_id, lote) => {
    try {
      const res = await window.wmsAPI.movimentacoes.confirmarDespacho(produto_id, lote, operador.id)
      if (res.success) {
        toastSuccess('Despacho Confirmado', `Item baixado do estoque. (${res.qtd_caixas} cx)`)
        carregarExpedicao()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleEstorno = async (produto_id, lote) => {
    const destino = window.prompt('Digite o endereço de destino para retornar o material:')
    if (!destino || !destino.trim()) {
      return toastWarning('Cancelado', 'É necessário informar um endereço de destino para o estorno.')
    }

    try {
      const payload = {
        produto_id,
        lote,
        destino: destino.trim().toUpperCase(),
        operador_id: operador.id,
        operador_nome: operador.nome
      }
      const res = await window.wmsAPI.movimentacoes.estornarExpedicao(payload)
      if (res.success) {
        toastSuccess('Estorno Realizado', `Lote retornado para ${payload.destino}.`)
        carregarExpedicao()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-header__title text-info flex items-center gap-12">
            <Truck size={28} /> Área de Expedição
          </h1>
          <p className="page-header__subtitle">Conferência e despacho definitivo (Checkout)</p>
        </div>
        <button className="btn btn--secondary" onClick={carregarExpedicao}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="tabs mb-24" style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        <button 
          className={`btn ${activeTab === 'pendentes' ? 'btn--primary' : 'btn--ghost'}`} 
          onClick={() => setActiveTab('pendentes')}
        >
          <Truck size={16} /> Pendentes para Despacho
        </button>
        <button 
          className={`btn ${activeTab === 'historico' ? 'btn--primary' : 'btn--ghost'}`} 
          onClick={() => setActiveTab('historico')}
        >
          <History size={16} /> Histórico de Saídas
        </button>
      </div>

      {activeTab === 'pendentes' && (
      <div className="card card--elevated">
        <div className="flex justify-between items-center mb-16">
          <h2 className="table-title">Itens Aguardando Despacho (Endereço: EXPEDICAO)</h2>
          <span className="badge badge--info">{itens.length} lotes pendentes</span>
        </div>

        {itens.length === 0 ? (
          <div className="text-center py-24 text-muted">
            <Box size={48} className="mx-auto mb-16 opacity-50" />
            <p>A área de expedição está vazia.</p>
          </div>
        ) : (
          <div className="flex-col gap-12">
            {itens.map((item) => (
              <div key={item.id} className="expedicao-item">
                <div className="expedicao-item__info">
                  <div className="expedicao-item__nome">{item.codigo} — {item.descricao}</div>
                  <div className="expedicao-item__meta">
                    Lote: <strong className="text-primary">{item.lote}</strong> | Validade: {item.validade || '-'}
                  </div>
                </div>
                
                <div className="expedicao-item__qtd mr-24">
                  <div className="expedicao-item__caixas">{item.qtd_caixas} CX</div>
                  <div className="expedicao-item__kg">{item.qtd_kg} KG</div>
                </div>

                <div className="flex gap-8">
                  <button className="btn btn--danger btn--sm" onClick={() => handleEstorno(item.produto_id, item.lote)}>
                    <XCircle size={14} /> Estornar
                  </button>
                  <button className="btn btn--success" onClick={() => handleDespacho(item.produto_id, item.lote)}>
                    <CheckCircle2 size={16} /> Confirmar Despacho
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {activeTab === 'historico' && (
        <div className="card card--elevated">
          <div className="flex justify-between items-center mb-16">
            <div className="flex items-center gap-12">
              <h3 className="text-primary font-bold">Últimos Despachos</h3>
              <div className="flex p-4 rounded-lg ml-12 border border-border overflow-hidden">
                <button 
                  className={`btn ${!incluirInsumos ? 'btn--primary' : 'btn--ghost'} btn--sm`}
                  onClick={() => setIncluirInsumos(false)}
                >
                  MP / PA
                </button>
                <button 
                  className={`btn ${incluirInsumos ? 'btn--primary' : 'btn--ghost'} btn--sm`}
                  onClick={() => setIncluirInsumos(true)}
                >
                  Insumos
                </button>
              </div>
            </div>
            <div className="flex gap-12">
              <input 
                type="date" 
                className="form-input form-input--sm" 
                style={{ width: 150 }}
                value={filtroData}
                onChange={e => setFiltroData(e.target.value)}
              />
              <input 
                type="text" 
                className="form-input form-input--sm" 
                placeholder="Filtrar produto..." 
                style={{ width: 200 }}
                value={filtroProduto}
                onChange={e => setFiltroProduto(e.target.value)}
              />
              <button className="btn btn--secondary btn--sm" onClick={exportarCSV}>
                <Download size={14} /> Exportar CSV
              </button>
            </div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Produto</th>
                  <th>Tipo</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Qtd (Cx/Kg)</th>
                  <th style={{ textAlign: 'right' }}>Valor Total</th>
                  <th>Operador</th>
                  {operador?.permissoes?.deletar_historico && <th style={{ textAlign: 'center' }}>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {historicoFiltrado.length === 0 ? (
                  <tr>
                    <td colSpan={operador?.permissoes?.deletar_historico ? 8 : 7} className="text-center text-muted py-24">Nenhum despacho registrado.</td>
                  </tr>
                ) : (
                  historicoFiltrado.map(h => {
                    const valorTotal = h.qtd_kg * (h.valor_unitario || 0)
                    return (
                    <tr key={h.id}>
                      <td className="text-muted text-sm">{format(new Date(h.data_hora), 'dd/MM/yyyy HH:mm')}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{h.descricao}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.codigo}</div>
                      </td>
                      <td><span className="badge" style={{ backgroundColor: 'var(--color-bg-2)', fontSize: 10 }}>{h.tipo_produto || 'N/A'}</span></td>
                      <td className="td-mono">{h.lote}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="text-cyan font-bold">{h.qtd_caixas} cx</div>
                        <div className="text-xs text-muted">{h.qtd_kg} kg</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>
                        R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="text-sm">{h.operador_nome || '-'}</td>
                      {operador?.permissoes?.deletar_historico && (
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="btn btn--ghost btn--sm text-danger" 
                            title="Deletar Log de Histórico"
                            onClick={async () => {
                              if (window.confirm('Tem certeza que deseja apagar este registro do histórico? (Isso NÃO estorna o saldo, apenas limpa o registro de log)')) {
                                const res = await window.wmsAPI.movimentacoes.deletarLog(h.id);
                                if (res.success) {
                                  toastSuccess('Sucesso', 'Registro apagado do histórico.');
                                  carregarHistorico();
                                } else {
                                  toastError('Erro', res.error);
                                }
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
