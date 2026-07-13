import React, { useState, useRef } from 'react'
import { Package, Plus, Trash2, ArrowRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as desmembramentoQueries from '../queries/desmembramento'
import * as produtosQueries from '../queries/produtos'

export function Desmembramento() {
  const { operador, toastError, toastSuccess } = useAppStore()
  const [eanOriginal, setEanOriginal] = useState('')
  const [caixasOriginais, setCaixasOriginais] = useState([])
  
  const [novasCaixas, setNovasCaixas] = useState([])
  const [novoEan, setNovoEan] = useState('')
  const [novoPeso, setNovoPeso] = useState('')
  const [novaValidade, setNovaValidade] = useState('')
  
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const origRef = useRef(null)

  const handleBuscarOriginal = async (e) => {
    e.preventDefault()
    if (!eanOriginal.trim()) return
    const ean = eanOriginal.trim()
    
    if (caixasOriginais.some(c => c.ean_caixa === ean)) {
      toastError('Erro', 'Esta caixa original já foi adicionada na lista.')
      return
    }

    setLoading(true)
    const res = await desmembramentoQueries.validarCaixa(ean)
    setLoading(false)
    if (res.success) {
      if (caixasOriginais.length > 0 && res.caixa.produto_id !== caixasOriginais[0].produto_id) {
        toastError('Produto Divergente', `Você bipou uma caixa de ${res.caixa.produto_descricao}. O produto precisa ser exatamente o mesmo das outras caixas originais!`)
        return
      }
      setCaixasOriginais([...caixasOriginais, res.caixa])
      if (res.caixa.validade) setNovaValidade(res.caixa.validade)
      setEanOriginal('')
      origRef.current?.focus()
    } else {
      toastError('Erro', res.error)
    }
  }

  const removerCaixaOriginal = (index) => {
    const list = [...caixasOriginais]
    list.splice(index, 1)
    setCaixasOriginais(list)
  }

  const handleAddNovaCaixa = async (e) => {
    e.preventDefault()
    if (!novoEan.trim() || !novoPeso) return
    const peso = parseFloat(novoPeso)
    if (isNaN(peso) || peso <= 0) {
      toastError('Erro', 'Peso inválido.')
      return
    }
    if (caixasOriginais.some(c => c.ean_caixa === novoEan.trim())) {
      toastError('Erro', 'O novo EAN não pode ser igual ao EAN de uma caixa original.')
      return
    }
    if (novasCaixas.some(c => c.ean_caixa === novoEan.trim())) {
      toastError('Erro', 'Esta etiqueta já foi adicionada na lista de novas caixas.')
      return
    }

    setLoading(true)
    const resultado = await produtosQueries.buscarPorCodigoComInfo(novoEan.trim())
    setLoading(false)

    if (!resultado) {
      toastError('Erro', 'Etiqueta não reconhecida. Certifique-se de que o padrão deste produto já foi cadastrado.')
      return
    }

    if (caixasOriginais.length > 0 && resultado.produto.id !== caixasOriginais[0].produto_id) {
      toastError('Erro de Segurança', `Etiqueta inválida! Você bipou uma etiqueta de ${resultado.produto.descricao}, mas as originais são de ${caixasOriginais[0].produto_descricao}.`)
      return
    }
    
    setNovasCaixas([...novasCaixas, { ean_caixa: novoEan.trim(), peso_kg: peso, validade: novaValidade || null }])
    setNovoEan('')
    setNovoPeso('')
    inputRef.current?.focus()
  }

  const removerNovaCaixa = (index) => {
    const list = [...novasCaixas]
    list.splice(index, 1)
    setNovasCaixas(list)
  }

  const handleConfirmar = async () => {
    if (caixasOriginais.length === 0) {
      toastError('Erro', 'Adicione pelo menos uma caixa original.')
      return
    }
    if (novasCaixas.length === 0) {
      toastError('Erro', 'Adicione pelo menos uma nova caixa.')
      return
    }
    
    // Alerta se o peso divergir muito
    const pesoTotalOriginais = caixasOriginais.reduce((acc, c) => acc + c.peso_kg, 0)
    const pesoTotalNovas = novasCaixas.reduce((acc, c) => acc + c.peso_kg, 0)
    const diff = Math.abs(pesoTotalOriginais - pesoTotalNovas)
    
    if (diff > 1) {
      toastError('Erro de Peso', `A soma das novas caixas difere muito do peso original. A diferença máxima permitida é de 1 kg (Diferença atual: ${diff.toFixed(2)} kg).`)
      return
    }

    setLoading(true)
    const res = await desmembramentoQueries.desmembrarCaixas(caixasOriginais, novasCaixas, operador.id, operador.nome)
    setLoading(false)
    
    if (res.success) {
      toastSuccess('Sucesso!', 'Caixas desmembradas com sucesso. Novas etiquetas ativas no estoque.')
      setCaixasOriginais([])
      setNovasCaixas([])
    } else {
      toastError('Erro ao Desmembrar', res.error)
    }
  }

  const pesoTotalOriginais = caixasOriginais.reduce((acc, c) => acc + c.peso_kg, 0)
  const pesoTotalNovas = novasCaixas.reduce((acc, c) => acc + c.peso_kg, 0)

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Desmembramento / Fusão</h1>
          <p className="page-header__subtitle">Junte múltiplas caixas originais de um mesmo produto e desmembre em novas etiquetas.</p>
        </div>
      </div>

      <div className="flex gap-24 flex-col lg:flex-row">
        {/* BLOCO 1: CAIXAS ORIGINAIS */}
        <div className="flex-[4]">
          <div className="card p-24 mb-24 border-warning">
            <h3 className="font-bold mb-16 text-warning flex items-center gap-8"><Package size={20}/> 1. Caixas Originais (Baixa)</h3>
            
            <form onSubmit={handleBuscarOriginal} className="flex gap-12 items-end mb-24">
              <div className="flex-1">
                <label className="form-label">EAN da Caixa Original</label>
                <input 
                  ref={origRef}
                  autoFocus
                  type="text" 
                  className="form-input" 
                  value={eanOriginal} 
                  onChange={e => setEanOriginal(e.target.value)} 
                  placeholder="Bipe ou digite o EAN..." 
                />
              </div>
              <button type="submit" className="btn btn--primary" disabled={loading}><Plus size={20}/> ADICIONAR</button>
            </form>

            {caixasOriginais.length > 0 ? (
              <div className="table-container mb-16">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>EAN</th>
                      <th style={{ textAlign: 'right' }}>Peso</th>
                      <th style={{ width: 50 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {caixasOriginais.map((c, i) => (
                      <tr key={i}>
                        <td className="text-sm font-bold text-warning">{c.produto_descricao}</td>
                        <td className="td-mono">{c.ean_caixa}</td>
                        <td className="font-bold" style={{ textAlign: 'right' }}>{c.peso_kg.toFixed(2)} kg</td>
                        <td>
                          <button className="btn btn--ghost btn--icon text-danger" onClick={() => removerCaixaOriginal(i)}>
                            <Trash2 size={16}/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center p-32 text-muted border border-dashed border-warning rounded-md bg-warning-muted opacity-80" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
                Nenhuma caixa original bipada.<br/>
                Comece bipando os EANs das caixas originais que serão misturadas e baixadas.
              </div>
            )}
            
            {caixasOriginais.length > 0 && (
              <div className="flex justify-between items-center pt-16 border-t border-border mt-16">
                <span className="text-muted text-sm">Peso Total Acumulado:</span>
                <span className="font-bold text-warning text-lg">{pesoTotalOriginais.toFixed(2)} kg</span>
              </div>
            )}
          </div>
        </div>
        
        {/* BLOCO 2: NOVAS CAIXAS */}
        <div className="flex-[5]">
          <div className="card p-24 h-full" style={{ opacity: caixasOriginais.length > 0 ? 1 : 0.5, pointerEvents: caixasOriginais.length > 0 ? 'auto' : 'none' }}>
            <h3 className="font-bold mb-16 text-cyan flex items-center gap-8"><ArrowRight size={20}/> 2. Novas Caixas Geradas</h3>
            
            <form onSubmit={handleAddNovaCaixa} className="flex gap-12 items-end mb-24 bg-bg-1 p-16 rounded-md border border-border" style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: '100%' }}>
                <label className="form-label">Novo EAN ({caixasOriginais[0]?.produto_descricao || ''})</label>
                <input 
                  ref={inputRef}
                  type="text" 
                  className="form-input" 
                  value={novoEan} 
                  onChange={e => setNovoEan(e.target.value)} 
                  placeholder="Bipe a nova etiqueta" 
                />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label className="form-label">Peso (kg)</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="form-input" 
                  value={novoPeso} 
                  onChange={e => setNovoPeso(e.target.value)} 
                  placeholder="Ex: 25.00" 
                />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <label className="form-label">Validade</label>
                <input 
                  type="date"
                  className="form-input" 
                  value={novaValidade} 
                  onChange={e => setNovaValidade(e.target.value)} 
                />
              </div>
              <button type="submit" className="btn btn--primary" style={{ height: 40, flex: '1 1 100%', display: 'flex', justifyContent: 'center', gap: 8 }}><Plus size={20}/> Adicionar Caixa</button>
            </form>

            {novasCaixas.length === 0 ? (
              <div className="text-center p-32 text-muted border border-dashed border-border rounded-md">
                Nenhuma caixa adicionada ainda.<br/>
                Bipe os EANs das novas etiquetas e informe o peso.
              </div>
            ) : (
              <div className="table-container mb-16">
                <table>
                  <thead>
                    <tr>
                      <th>EAN Novo</th>
                      <th>Validade</th>
                      <th style={{ textAlign: 'right' }}>Peso</th>
                      <th style={{ width: 50 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {novasCaixas.map((c, i) => (
                      <tr key={i}>
                        <td className="td-mono">{c.ean_caixa}</td>
                        <td>{c.validade || '-'}</td>
                        <td className="font-bold text-cyan" style={{ textAlign: 'right' }}>{c.peso_kg.toFixed(2)} kg</td>
                        <td>
                          <button className="btn btn--ghost btn--icon text-danger" onClick={() => removerNovaCaixa(i)}>
                            <Trash2 size={16}/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {novasCaixas.length > 0 && (
              <div className="mt-24 p-16 bg-bg-2 border border-border rounded-md">
                <div className="flex justify-between items-center mb-16">
                  <h3 className="font-bold">Resumo</h3>
                </div>
                <div className="flex justify-between items-center py-8 border-b border-border">
                  <span className="text-muted">Total Originais:</span>
                  <span className="font-bold text-warning">{pesoTotalOriginais.toFixed(2)} kg</span>
                </div>
                <div className="flex justify-between items-center py-8 border-b border-border">
                  <span className="text-muted">Total Novas Caixas:</span>
                  <span className="font-bold text-cyan">{pesoTotalNovas.toFixed(2)} kg</span>
                </div>
                <div className="flex justify-between items-center py-8">
                  <span className="text-muted">Diferença (Quebra):</span>
                  <span className={`font-bold ${(pesoTotalOriginais - pesoTotalNovas) >= 0 ? 'text-danger' : 'text-success'}`}>
                    {Math.abs(pesoTotalOriginais - pesoTotalNovas).toFixed(2)} kg
                  </span>
                </div>
                
                <button 
                  className="btn btn--primary w-full mt-16" 
                  onClick={handleConfirmar}
                  disabled={loading}
                >
                  CONFIRMAR DESMEMBRAMENTO
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
