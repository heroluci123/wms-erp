import React, { useState, useRef } from 'react'
import { Package, Plus, Trash2, ArrowRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as desmembramentoQueries from '../queries/desmembramento'

export function Desmembramento() {
  const { operador, toastError, toastSuccess } = useAppStore()
  const [eanOriginal, setEanOriginal] = useState('')
  const [caixaOriginal, setCaixaOriginal] = useState(null)
  
  const [novasCaixas, setNovasCaixas] = useState([])
  const [novoEan, setNovoEan] = useState('')
  const [novoPeso, setNovoPeso] = useState('')
  const [novaValidade, setNovaValidade] = useState('')
  
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  const handleBuscarOriginal = async (e) => {
    e.preventDefault()
    if (!eanOriginal.trim()) return
    setLoading(true)
    const res = await desmembramentoQueries.validarCaixa(eanOriginal.trim())
    setLoading(false)
    if (res.success) {
      setCaixaOriginal(res.caixa)
      if (res.caixa.validade) setNovaValidade(res.caixa.validade)
      setEanOriginal('')
    } else {
      toastError('Erro', res.error)
    }
  }

  const handleAddNovaCaixa = (e) => {
    e.preventDefault()
    if (!novoEan.trim() || !novoPeso) return
    const peso = parseFloat(novoPeso)
    if (isNaN(peso) || peso <= 0) {
      toastError('Erro', 'Peso inválido.')
      return
    }
    if (novoEan.trim() === caixaOriginal.ean_caixa) {
      toastError('Erro', 'O novo EAN não pode ser igual ao da caixa original.')
      return
    }
    if (novasCaixas.some(c => c.ean_caixa === novoEan.trim())) {
      toastError('Erro', 'Esta etiqueta já foi adicionada na lista.')
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
    if (novasCaixas.length === 0) {
      toastError('Erro', 'Adicione pelo menos uma nova caixa.')
      return
    }
    
    // Alerta se o peso divergir muito, mas permite.
    const pesoTotal = novasCaixas.reduce((acc, c) => acc + c.peso_kg, 0)
    const diff = Math.abs(caixaOriginal.peso_kg - pesoTotal)
    if (diff > 5) {
      if (!window.confirm(`Atenção: A diferença de peso é grande (${diff.toFixed(2)} kg). Tem certeza que deseja continuar?`)) {
        return
      }
    }

    setLoading(true)
    const res = await desmembramentoQueries.desmembrarCaixa(caixaOriginal, novasCaixas, operador.id, operador.nome)
    setLoading(false)
    
    if (res.success) {
      toastSuccess('Sucesso!', 'Caixa desmembrada com sucesso. Novas etiquetas ativas no estoque.')
      setCaixaOriginal(null)
      setNovasCaixas([])
    } else {
      toastError('Erro ao Desmembrar', res.error)
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Desmembramento</h1>
          <p className="page-header__subtitle">Quebre uma caixa em duas ou mais, registrando novas etiquetas.</p>
        </div>
      </div>

      {!caixaOriginal && (
        <div className="card p-24 mb-24">
          <h3 className="font-bold mb-16 flex items-center gap-8"><Package size={20}/> 1. Bipar Caixa Original</h3>
          <form onSubmit={handleBuscarOriginal} className="flex gap-12 items-end">
            <div className="flex-1">
              <label className="form-label">EAN da Caixa Original</label>
              <input 
                autoFocus
                type="text" 
                className="form-input" 
                value={eanOriginal} 
                onChange={e => setEanOriginal(e.target.value)} 
                placeholder="Bipe ou digite o EAN..." 
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={loading}>BUSCAR</button>
          </form>
        </div>
      )}

      {caixaOriginal && (
        <div className="flex gap-24 flex-col lg:flex-row">
          <div className="flex-1">
            <div className="card p-24 mb-24 border-warning">
              <h3 className="font-bold mb-16 text-warning">Caixa Original (Será Baixada)</h3>
              <div className="text-sm space-y-8">
                <div><strong>EAN:</strong> {caixaOriginal.ean_caixa}</div>
                <div><strong>Produto:</strong> {caixaOriginal.produto_codigo} - {caixaOriginal.produto_descricao}</div>
                <div><strong>Peso:</strong> <span className="font-bold text-lg">{caixaOriginal.peso_kg.toFixed(2)} kg</span></div>
                <div><strong>Endereço:</strong> {caixaOriginal.endereco || 'N/A'}</div>
                <div><strong>Validade:</strong> {caixaOriginal.validade || 'N/A'}</div>
              </div>
              <button 
                className="btn btn--ghost w-full mt-16" 
                onClick={() => { setCaixaOriginal(null); setNovasCaixas([]); }}
              >
                CANCELAR
              </button>
            </div>
            
            <div className="card p-24">
              <div className="flex justify-between items-center mb-16">
                <h3 className="font-bold">Resumo</h3>
              </div>
              <div className="flex justify-between items-center py-8 border-b border-border">
                <span className="text-muted">Peso Original:</span>
                <span className="font-bold text-warning">{caixaOriginal.peso_kg.toFixed(2)} kg</span>
              </div>
              <div className="flex justify-between items-center py-8 border-b border-border">
                <span className="text-muted">Peso Novas Caixas:</span>
                <span className="font-bold text-cyan">{novasCaixas.reduce((a,c)=>a+c.peso_kg, 0).toFixed(2)} kg</span>
              </div>
              <div className="flex justify-between items-center py-8">
                <span className="text-muted">Diferença (Quebra):</span>
                <span className={`font-bold ${(caixaOriginal.peso_kg - novasCaixas.reduce((a,c)=>a+c.peso_kg, 0)) >= 0 ? 'text-danger' : 'text-success'}`}>
                  {Math.abs(caixaOriginal.peso_kg - novasCaixas.reduce((a,c)=>a+c.peso_kg, 0)).toFixed(2)} kg
                </span>
              </div>
              
              <button 
                className="btn btn--primary w-full mt-16" 
                onClick={handleConfirmar}
                disabled={novasCaixas.length === 0 || loading}
              >
                CONFIRMAR DESMEMBRAMENTO
              </button>
            </div>
          </div>

          <div className="flex-[2]">
            <div className="card p-24 h-full">
              <h3 className="font-bold mb-16 text-cyan flex items-center gap-8"><ArrowRight size={20}/> 2. Novas Caixas Geradas</h3>
              
              <form onSubmit={handleAddNovaCaixa} className="flex gap-12 items-end mb-24 bg-bg-1 p-16 rounded-md border border-border">
                <div className="flex-[2]">
                  <label className="form-label">Novo EAN</label>
                  <input 
                    ref={inputRef}
                    autoFocus
                    type="text" 
                    className="form-input" 
                    value={novoEan} 
                    onChange={e => setNovoEan(e.target.value)} 
                    placeholder="Bipe a nova etiqueta" 
                  />
                </div>
                <div className="flex-1">
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
                <div className="flex-1">
                  <label className="form-label">Validade</label>
                  <input 
                    type="date"
                    className="form-input" 
                    value={novaValidade} 
                    onChange={e => setNovaValidade(e.target.value)} 
                  />
                </div>
                <button type="submit" className="btn btn--ghost" style={{ padding: '0 16px', height: 40 }}><Plus size={20}/></button>
              </form>

              {novasCaixas.length === 0 ? (
                <div className="text-center p-32 text-muted border border-dashed border-border rounded-md">
                  Nenhuma caixa adicionada ainda.<br/>
                  Bipe os EANs das novas etiquetas e informe o peso.
                </div>
              ) : (
                <div className="table-container">
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
