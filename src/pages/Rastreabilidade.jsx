import React, { useState } from 'react'
import { Search, Package, Clock } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as produtosQueries from '../queries/produtos.js'

export function Rastreabilidade() {
  const { toastError } = useAppStore()
  const [eanRastreio, setEanRastreio] = useState('')
  const [historicoCaixa, setHistoricoCaixa] = useState(null)
  const [loadingRastreio, setLoadingRastreio] = useState(false)

  const handleBuscarHistorico = async (e) => {
    e.preventDefault()
    if (!eanRastreio.trim()) return
    setLoadingRastreio(true)
    try {
      const res = await produtosQueries.buscarHistoricoCaixa(eanRastreio.trim())
      setHistoricoCaixa(res)
    } catch (err) {
      toastError('Erro', 'Falha ao buscar histórico')
    }
    setLoadingRastreio(false)
  }

  return (
    <div>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Rastreabilidade de Caixa</h1>
          <p className="page-header__subtitle">Consulte todo o histórico de movimentações e operações de uma etiqueta</p>
        </div>
      </div>

      <div style={{ maxWidth: 800 }}>
        <div className="card p-24 mb-24">
          <h3 className="font-bold mb-16 flex items-center gap-8"><Search size={20}/> Consultar Histórico da Caixa</h3>
          <form onSubmit={handleBuscarHistorico} className="flex gap-12 items-end">
            <div className="flex-1">
              <label className="label">EAN da Caixa</label>
              <input 
                autoFocus
                type="text" 
                className="input" 
                value={eanRastreio} 
                onChange={e => setEanRastreio(e.target.value)} 
                placeholder="Bipe ou digite o EAN..." 
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={loadingRastreio}>Rastrear</button>
          </form>
        </div>

        {historicoCaixa && historicoCaixa.length === 0 && (
          <div className="card p-32 text-center text-muted">
            <Package size={48} className="mx-auto mb-16 opacity-50" />
            Nenhum histórico encontrado para esta etiqueta.<br/>
            Isso pode ocorrer se a caixa nunca foi recebida ou se foi recebida antes da implantação da rastreabilidade total.
          </div>
        )}

        {historicoCaixa && historicoCaixa.length > 0 && (
          <div className="card p-24">
            <h3 className="font-bold mb-24 text-lg">Timeline da Caixa</h3>
            <div className="relative border-l-2 border-border ml-12 pl-24 space-y-24">
              {historicoCaixa.map((ev, i) => (
                <div key={i} className="relative">
                  <div className="absolute w-12 h-12 bg-primary rounded-full" style={{ left: -31, top: 4, border: '3px solid var(--bg-0)' }}></div>
                  <div className="font-bold text-primary">{ev.operacao}</div>
                  <div className="text-sm text-white mt-4">{ev.detalhes}</div>
                  <div className="text-xs text-muted flex items-center gap-8 mt-8">
                    <span><Clock size={12} className="inline mr-4"/> {new Date(ev.data_hora).toLocaleString()}</span>
                    <span>• Operador: {ev.operador_nome || 'Sistema'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
