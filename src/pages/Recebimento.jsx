import React, { useState, useEffect } from 'react'
import { UploadCloud, Check, History, Download, Trash2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'
import * as movimentacoesQueries from '../queries/movimentacoes.js';
import * as produtosQueries from '../queries/produtos.js';

export function Recebimento() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const [produto, setProduto] = useState(null)
  
  const [formData, setFormData] = useState({
    codigo: '',
    lote: '',
    validade: '',
    qtd_caixas: '',
    qtd_kg: ''
  })

  const [activeTab, setActiveTab] = useState('registrar') // 'registrar' | 'historico'
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
      const logs = await movimentacoesQueries.listarLog({ tipo: 'RECEBIMENTO', incluirInsumos })
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
    link.setAttribute("download", `historico_recebimento_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Scanner foca automaticamente no input de código ao carregar
  const { inputRef: codigoRef, handleKeyDown: handleCodigoKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      buscarProduto(val)
    }
  })

  const buscarProduto = async (cod) => {
    try {
      const p = await produtosQueries.buscarPorCodigo(cod)
      if (p) {
        setProduto(p)
        setFormData(f => ({ ...f, codigo: cod }))
        toastSuccess('Produto Localizado', p.descricao)
        // Move o foco para o lote
        document.getElementById('input-lote')?.focus()
      } else {
        toastWarning('Não Encontrado', 'Produto não cadastrado.')
        setProduto(null)
      }
    } catch (e) {
      toastError('Erro', 'Falha ao buscar produto')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!produto) return toastError('Atenção', 'Bipe um produto válido primeiro.')
    if (!formData.lote || !formData.qtd_caixas || !formData.qtd_kg) {
      return toastWarning('Campos Incompletos', 'Preencha Lote, Caixas e KG.')
    }
    if (!formData.validade) {
      return toastWarning('Validade Obrigatória', 'Informe a data de validade do produto.')
    }

    {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const valDate = new Date(formData.validade + 'T00:00:00')
      if (valDate < today) {
        return toastError('Produto Vencido', 'Não é permitido receber itens com validade expirada.')
      }
    }

    try {
      const payload = {
        produto_id: produto.id,
        lote: formData.lote.trim(),
        validade: formData.validade || null,
        qtd_caixas: parseFloat(formData.qtd_caixas),
        qtd_kg: parseFloat(formData.qtd_kg),
        operador_id: operador.id,
        operador_nome: operador.nome
      }

      const res = await movimentacoesQueries.receber(payload)
      if (res.success) {
        toastSuccess('Recebimento Concluído', `Lote direcionado para posição REC.`)
        // Reset form
        setProduto(null)
        setFormData({ codigo: '', lote: '', validade: '', qtd_caixas: '', qtd_kg: '' })
        codigoRef.current?.focus()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro fatal', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title">Recebimento (Inbound)</h1>
          <p className="page-header__subtitle">Entrada de material na doca com destinação automática para 'REC'</p>
        </div>
      </div>

      <div className="tabs mb-24" style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        <button 
          className={`btn ${activeTab === 'registrar' ? 'btn--primary' : 'btn--ghost'}`} 
          onClick={() => { setActiveTab('registrar'); setTimeout(() => codigoRef.current?.focus(), 100) }}
        >
          <UploadCloud size={16} /> Registrar Entrada
        </button>
        <button 
          className={`btn ${activeTab === 'historico' ? 'btn--primary' : 'btn--ghost'}`} 
          onClick={() => setActiveTab('historico')}
        >
          <History size={16} /> Histórico
        </button>
      </div>

      {activeTab === 'registrar' && (

      <div className="card">
        <form onSubmit={handleSubmit} className="form-grid">
          {/* Passo 1: Produto */}
          <div className="form-group mb-16">
            <label className="form-label text-warning flex items-center gap-8">
              <UploadCloud size={16} /> 1. Bipar Produto (SKU/EAN)
            </label>
            <input
              ref={codigoRef}
              type="text"
              className="form-input form-input--scanner"
              placeholder="Aguardando scanner..."
              value={formData.codigo}
              onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
              onKeyDown={handleCodigoKeyDown}
              autoFocus
            />
            {produto && (
              <div className="saldo-display mt-16" style={{ background: 'var(--success-muted)', borderColor: 'var(--success)' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--success)' }}>{produto.descricao}</div>
                  <div className="text-muted mt-4">Unidade Base: {produto.unidade} | Curva: {produto.status_curva}</div>
                </div>
              </div>
            )}
          </div>

          {/* Passo 2: Dados do Lote */}
          <div className="form-grid form-grid--2">
            <div className="form-group">
              <label className="form-label">Lote de Fabricação *</label>
              <input
                id="input-lote"
                type="text"
                className="form-input"
                placeholder="Ex: L2024A"
                value={formData.lote}
                onChange={(e) => setFormData({ ...formData, lote: e.target.value })}
                disabled={!produto}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Data de Validade *</label>
              <input
                type="date"
                className="form-input"
                value={formData.validade}
                onChange={(e) => setFormData({ ...formData, validade: e.target.value })}
                disabled={!produto}
                required
              />
            </div>
          </div>

          {/* Passo 3: Quantidades */}
          <div className="form-grid form-grid--2 mt-16">
            <div className="form-group">
              <label className="form-label">Quantidade (Caixas/Un) *</label>
              <input
                type="number"
                step="0.01"
                className="form-input form-input--number"
                value={formData.qtd_caixas}
                onChange={(e) => setFormData({ ...formData, qtd_caixas: e.target.value })}
                disabled={!produto}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Peso Total (KG) *</label>
              <input
                type="number"
                step="0.01"
                className="form-input form-input--number"
                value={formData.qtd_kg}
                onChange={(e) => setFormData({ ...formData, qtd_kg: e.target.value })}
                disabled={!produto}
                required
              />
            </div>
          </div>

          <div className="divider mt-24 mb-24" />

          <div className="flex justify-between items-center">
            <div className="text-muted text-sm">
              * O saldo será gerado no endereço virtual <strong className="text-warning">REC</strong>.
            </div>
            <button type="submit" className="btn btn--primary btn--lg" disabled={!produto}>
              <Check size={18} /> Confirmar Recebimento
            </button>
          </div>
        </form>
      </div>
      )}

      {activeTab === 'historico' && (
        <div className="card">
          <div className="flex justify-between items-center mb-16">
            <div className="flex items-center gap-12">
              <h3 className="text-primary font-bold">Últimos Recebimentos</h3>
              <div className="flex bg-bg-2 p-4 rounded-lg ml-12 gap-4 border border-border">
                <button 
                  className={`btn btn--sm ${!incluirInsumos ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setIncluirInsumos(false)}
                >
                  MP / PA
                </button>
                <button 
                  className={`btn btn--sm ${incluirInsumos ? 'btn--primary' : 'btn--ghost'}`}
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
                    <td colSpan="6" className="text-center text-muted py-24">Nenhum recebimento registrado.</td>
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
                      <td className="text-sm">{h.operador_nome}</td>
                      {operador?.permissoes?.deletar_historico && (
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="btn btn--ghost btn--sm text-danger" 
                            title="Deletar Log de Histórico"
                            onClick={async () => {
                              if (window.confirm('Tem certeza que deseja apagar este registro do histórico? (Isso NÃO estorna o saldo, apenas limpa o registro de log)')) {
                                const res = await movimentacoesQueries.deletarLog(h.id);
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
