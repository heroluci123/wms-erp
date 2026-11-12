import React, { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Search, Package, Clock, Printer, GitBranch, ArrowUpRight, Layers, Tag } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as produtosQueries from '../queries/produtos.js'
import { tarasQueries } from '../queries/taras.js'
import { EtiquetaZebraModal } from '../components/shared/EtiquetaZebraPrint.jsx'
import { fmtDataBR, fmtKg2, fmtKg3 } from '../utils/rastreabilidade.js'

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
  const { operador, toastSuccess, toastError } = useAppStore()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [eanRastreio, setEanRastreio] = useState('')
  const [historicoCaixa, setHistoricoCaixa] = useState(null)
  const [caixaInfo, setCaixaInfo] = useState(null)
  const [loadingRastreio, setLoadingRastreio] = useState(false)
  const [modalEtiquetaOpen, setModalEtiquetaOpen] = useState(false)

  const executarBusca = async (eanAlvo) => {
    const clean = String(eanAlvo || '').trim()
    if (!clean) return
    setEanRastreio(clean)
    setLoadingRastreio(true)
    try {
      const [hist, caixa] = await Promise.all([
        produtosQueries.buscarHistoricoCaixa(clean),
        produtosQueries.buscarCaixaPorEan(clean),
      ])
      setHistoricoCaixa(hist)
      setCaixaInfo(caixa)
    } catch {
      toastError('Erro', 'Falha ao buscar histórico de rastreabilidade')
    }
    setLoadingRastreio(false)
  }

  useEffect(() => {
    const eanInicial = location.state?.eanInicial || searchParams.get('ean')
    if (eanInicial) {
      executarBusca(eanInicial)
    }
  }, [location.state?.eanInicial, searchParams])

  const handleBuscarHistorico = async (e) => {
    e.preventDefault()
    await executarBusca(eanRastreio)
  }

  const handleReimprimir = async () => {
    if (!caixaInfo) return
    try {
      await tarasQueries.registrarReimpressaoHistorico({
        caixa_id: caixaInfo.id,
        ean_caixa: caixaInfo.ean_caixa,
        origem_tipo: caixaInfo.origem_tipo,
        operador_nome: operador?.nome || 'Operador',
      })
      setModalEtiquetaOpen(true)
      toastSuccess('Reimpressão 100×70mm', `EAN ${caixaInfo.ean_caixa} preservado para impressão.`)
      const hist = await produtosQueries.buscarHistoricoCaixa(caixaInfo.ean_caixa)
      setHistoricoCaixa(hist)
    } catch (err) {
      toastError('Erro', err.message || 'Falha ao registrar reimpressão')
    }
  }

  const paiEan = caixaInfo?.ean_origem || caixaInfo?.vinculo_origem?.ean_origem || null
  const filhos = caixaInfo?.filhos_desmembramento || []
  const brutoExibido = caixaInfo?.peso_bruto_kg != null
    ? caixaInfo.peso_bruto_kg
    : (caixaInfo ? Number(caixaInfo.peso_kg || 0) + Number(caixaInfo.tara_kg || 0) : 0)

  return (
    <div style={{ paddingBottom: 40 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Rastreabilidade de Caixa</h1>
          <p className="page-header__subtitle">
            Consulte todo o histórico, pesagem (bruto, tara, líquido), lote, origem OP e desmembramentos de uma etiqueta
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 960 }}>
        <div className="card p-24 mb-24">
          <h3 className="font-bold mb-16 flex items-center gap-8"><Search size={20}/> Consultar Histórico da Caixa</h3>
          <form onSubmit={handleBuscarHistorico} className="flex gap-12 items-end">
            <div className="flex-1">
              <label className="form-label">EAN da Caixa</label>
              <input
                autoFocus
                type="text"
                className="form-input form-input--scanner"
                value={eanRastreio}
                onChange={e => setEanRastreio(e.target.value)}
                placeholder="Bipe ou digite o EAN..."
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={loadingRastreio}>
              {loadingRastreio ? 'Rastreando...' : 'Rastrear'}
            </button>
          </form>
        </div>

        {historicoCaixa && historicoCaixa.length === 0 && !caixaInfo && (
          <div className="card p-32 text-center text-muted">
            <Package size={48} className="mx-auto mb-16 opacity-50" />
            Nenhum histórico encontrado para esta etiqueta.<br/>
            Isso pode ocorrer se a caixa nunca foi recebida ou se foi recebida antes da implantação da rastreabilidade total.
          </div>
        )}

        {(caixaInfo || (historicoCaixa && historicoCaixa.length > 0)) && (
          <>
            {caixaInfo && (
              <div className="card p-24 mb-24">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div className="text-xs text-muted mb-4 font-bold uppercase" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Layers size={13} color="var(--cyan)" />
                      Origem: {caixaInfo.origem_tipo || 'RECEBIMENTO'}
                      {caixaInfo.op_codigo ? ` • OP ${caixaInfo.op_codigo} (${caixaInfo.op_nome || ''})` : ''}
                    </div>
                    <div className="font-bold text-lg text-primary">{caixaInfo.produto_descricao}</div>
                    <div className="text-sm text-muted">
                      Cód: <strong>{caixaInfo.produto_codigo}</strong> • EAN:{' '}
                      <strong className="font-mono" style={{ color: 'var(--cyan)' }}>{caixaInfo.ean_caixa}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="text-xs text-muted font-bold uppercase">Status Atual</div>
                      <div className="font-bold" style={{
                        fontSize: 16,
                        color: caixaInfo.status === 'CONSUMIDA' ? 'var(--warning)' : caixaInfo.status === 'EXPEDIDA' ? 'var(--info)' : 'var(--success)'
                      }}>
                        {caixaInfo.status === 'CONSUMIDA'
                          ? (filhos.length > 0 ? 'DESMEMBRADA' : 'CONSUMIDA EM PRODUÇÃO / OP')
                          : caixaInfo.status === 'EXPEDIDA'
                            ? 'EXPEDIDA'
                            : caixaInfo.endereco}
                      </div>
                      {caixaInfo.palete_codigo && (
                        <div className="text-xs font-bold" style={{ color: 'var(--primary)' }}>
                          Palete: {caixaInfo.palete_codigo}
                        </div>
                      )}
                    </div>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={handleReimprimir}>
                      <Printer size={15} /> Reimprimir 100×70mm
                    </button>
                  </div>
                </div>

                {/* Bloco de Pesagem, Lote e Datas */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                  gap: 12,
                  padding: 14,
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid var(--border)',
                }}>
                  <div>
                    <div className="text-xs text-muted font-bold uppercase">Lote (DDMMYY)</div>
                    <div className="font-mono font-bold" style={{ color: '#facc15', fontSize: 15 }}>
                      {caixaInfo.lote || '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-bold uppercase">Data Produção</div>
                    <div className="font-bold">{fmtDataBR(caixaInfo.data_producao)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-bold uppercase">Validade</div>
                    <div className="font-bold">{fmtDataBR(caixaInfo.validade)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-bold uppercase">Peso Bruto</div>
                    <div className="font-bold">{fmtKg2(brutoExibido)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-bold uppercase">Tara</div>
                    <div className="font-bold text-muted">
                      {caixaInfo.tara_kg != null ? fmtKg3(caixaInfo.tara_kg) : '0,000 kg'}
                      {caixaInfo.tara_nome ? ` (${caixaInfo.tara_nome})` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted font-bold uppercase">Peso Líquido</div>
                    <div className="font-bold text-cyan" style={{ fontSize: 16 }}>{fmtKg2(caixaInfo.peso_kg)}</div>
                  </div>
                </div>

                {/* Árvore de Vínculos de Desmembramento */}
                {(paiEan || filhos.length > 0) && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div className="text-xs font-bold uppercase mb-8" style={{ color: '#2dd4bf', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <GitBranch size={14} /> Árvore de Rastreabilidade (Desmembramento)
                    </div>

                    {paiEan && (
                      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="text-sm text-muted">Gerada a partir da caixa original:</span>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm font-mono"
                          style={{ border: '1px solid rgba(45, 212, 191, 0.4)', color: '#2dd4bf' }}
                          onClick={() => executarBusca(paiEan)}
                        >
                          <Tag size={13} /> {paiEan} <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}

                    {filhos.length > 0 && (
                      <div>
                        <div className="text-sm text-muted mb-8">
                          Esta caixa foi desmembrada em <strong>{filhos.length}</strong> nova(s) etiqueta(s):
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                          {filhos.map((f, idx) => (
                            <button
                              key={f.id || f.ean_destino}
                              type="button"
                              onClick={() => executarBusca(f.ean_destino)}
                              style={{
                                textAlign: 'left', padding: '10px 12px', borderRadius: 8,
                                background: 'rgba(20, 184, 166, 0.08)', border: '1px solid rgba(20, 184, 166, 0.3)',
                                color: 'var(--text-primary)', cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="font-mono font-bold" style={{ color: '#2dd4bf', fontSize: 12 }}>
                                  #{idx + 1} • {f.ean_destino}
                                </span>
                                <ArrowUpRight size={14} color="#2dd4bf" />
                              </div>
                              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                                Bruto: {fmtKg2(f.peso_bruto_kg)} • Tara: {fmtKg3(f.tara_kg)} • Líq: <strong>{fmtKg2(f.peso_liquido_kg)}</strong>
                              </div>
                              <div className="text-xs text-muted">
                                Lote: {f.lote || '-'} • Val: {fmtDataBR(f.validade)} • {f.destino_status || 'DISPONIVEL'}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {historicoCaixa && historicoCaixa.length > 0 && (
              <div className="card p-24">
                <h3 className="font-bold mb-24 text-lg">Timeline da Caixa ({historicoCaixa.length})</h3>
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
            )}
          </>
        )}
      </div>

      <EtiquetaZebraModal
        isOpen={modalEtiquetaOpen}
        etiquetas={caixaInfo ? [caixaInfo] : []}
        autoPrint={true}
        titulo="Reimpressão de Etiqueta (EAN Original Preservado)"
        subtitulo={`EAN ${caixaInfo?.ean_caixa || ''} • Lote ${caixaInfo?.lote || '-'}`}
        onClose={() => setModalEtiquetaOpen(false)}
      />
    </div>
  )
}

export default Rastreabilidade
