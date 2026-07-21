import React, { useState } from 'react'
import { Search, Package, Clock } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as produtosQueries from '../queries/produtos.js'

// Força interpretação UTC e formata no fuso de Brasília
const fmtDataHora = (s) => {
  if (!s) return '-'
  const iso = /[Zz+\-]\d*$/.test(s.trim()) ? s.trim() : s.trim().replace(' ', 'T') + 'Z'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

export function Rastreabilidade() {
  const { toastError } = useAppStore()
  const [eanRastreio, setEanRastreio] = useState('')
  const [historicoCaixa, setHistoricoCaixa] = useState(null)
  const [caixaInfo, setCaixaInfo] = useState(null)
  const [loadingRastreio, setLoadingRastreio] = useState(false)

  const handleBuscarHistorico = async (e) => {
    e.preventDefault()
    if (!eanRastreio.trim()) return
    setLoadingRastreio(true)
    try {
      const hist = await produtosQueries.buscarHistoricoCaixa(eanRastreio.trim())
      const caixa = await produtosQueries.buscarCaixaPorEan(eanRastreio.trim())
      setHistoricoCaixa(hist)
      setCaixaInfo(caixa)
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
              <label className="form-label">EAN da Caixa</label>
              <input 
                autoFocus
                type="text" 
                className="form-input" 
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
          <>
            {caixaInfo && (
              <div className="card p-24 mb-24" style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div className="text-xs text-muted mb-4 font-bold uppercase">Produto</div>
                  <div className="font-bold text-lg text-primary">{caixaInfo.produto_descricao}</div>
                  <div className="text-sm text-muted">Cód: {caixaInfo.produto_codigo}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="text-xs text-muted mb-4 font-bold uppercase">Peso e Validade</div>
                  <div className="font-bold text-cyan">{caixaInfo.peso_kg.toFixed(2)} kg</div>
                  <div className="text-sm text-muted">Venc: {caixaInfo.validade ? new Date(caixaInfo.validade + 'T00:00:00').toLocaleDateString() : '-'}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="text-xs text-muted mb-4 font-bold uppercase">Status Atual</div>
                  <div className="font-bold" style={{ 
                    fontSize: 18,
                    color: caixaInfo.status === 'CONSUMIDA' ? 'var(--warning)' : caixaInfo.status === 'EXPEDIDA' ? 'var(--info)' : 'var(--success)'
                  }}>
                    {caixaInfo.status === 'CONSUMIDA' ? 'DESMEMBRADA' : caixaInfo.status === 'EXPEDIDA' ? 'EXPEDIDA' : caixaInfo.endereco}
                  </div>
                  {caixaInfo.status === 'DISPONIVEL' && <div className="text-sm text-muted">Em Estoque</div>}
                  {caixaInfo.palete_codigo && (
                    <div className="text-sm font-bold mt-4" style={{ color: 'var(--primary)' }}>
                      Palete: {caixaInfo.palete_codigo}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card p-24">
            <h3 className="font-bold mb-24 text-lg">Timeline da Caixa</h3>
            <div style={{ position: 'relative', borderLeft: '2px solid var(--border)', marginLeft: 12, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {historicoCaixa.map((ev, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <div style={{ 
                    position: 'absolute', 
                    width: 14, 
                    height: 14, 
                    background: 'var(--accent)', 
                    borderRadius: '50%', 
                    left: -32, 
                    top: 4, 
                    border: '3px solid var(--surface)' 
                  }}></div>
                  <div style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{ev.operacao}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 4 }}>
                    {ev.detalhes}
                    {ev.operacao === 'ROMANEIO' && ev.romaneio_codigo && (
                      <span style={{
                        marginLeft: 8,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.4)',
                        borderRadius: 6,
                        padding: '2px 8px',
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        color: 'var(--primary)'
                      }}>
                        📋 {ev.romaneio_codigo}{ev.romaneio_cliente ? ` · ${ev.romaneio_cliente}` : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span><Clock size={12} style={{ display: 'inline', marginRight: 4 }}/> {fmtDataHora(ev.data_hora)}</span>
                    <span>• Operador: {ev.operador_nome || 'Sistema'}</span>
                  </div>
                </div>
              ))}
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
