import React, { useState, useEffect, useCallback } from 'react'
import { ArrowRight, MapPin, Box, Hash, AlertTriangle, Lightbulb, Check, Layers, Package, ScanLine, X, Search, Download } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'

// O banco salva horários em UTC. O Brasil é UTC-3.
// Adicionamos 'Z' para que o JS interprete como UTC e o toLocaleString
// converta automaticamente para o fuso do navegador.
const fmtDataHora = (str) => {
  if (!str) return '-'
  const s = str.trim()
  // Se já tem offset ou 'Z', usa direto. Se não, assume UTC adicionando 'Z'.
  const iso = /[Zz+\-]\d*$/.test(s) ? s : s.replace(' ', 'T') + 'Z'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
import * as locaisQueries from '../queries/locais.js';
import * as produtosQueries from '../queries/produtos.js';
import * as estoqueQueries from '../queries/estoque.js';
import * as movimentacoesQueries from '../queries/movimentacoes.js';
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx'

export function Movimentacao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  
  const [step, setStep] = useState('SCANNER_ORIGEM')
  
  // Estado Universal
  const [entidadeTipo, setEntidadeTipo] = useState(null) // 'PALETE' | 'CAIXAS' | 'ENDERECO_TODO'
  const [paleteSelecionado, setPaleteSelecionado] = useState(null)
  const [caixasSelecionadas, setCaixasSelecionadas] = useState([])
  const [enderecoOrigem, setEnderecoOrigem] = useState(null)
  
  const [modalConfirmarOrigem, setModalConfirmarOrigem] = useState(false)
  const [modalConfirmarDestino, setModalConfirmarDestino] = useState(false)
  
  const [destino, setDestino] = useState('')

  // Abas
  const [abaAtiva, setAbaAtiva] = useState('MOVIMENTAR') // 'MOVIMENTAR' | 'HISTORICO'

  // Histórico de Transferências
  const [historico, setHistorico] = useState([])
  const [loadingHistorico, setLoadingHistorico] = useState(false)
  const [filtroEndereco, setFiltroEndereco] = useState('')
  const [filtroProduto, setFiltroProduto] = useState('')
  const [filtroDataInicio, setFiltroDataInicio] = useState('')
  const [filtroDataFim, setFiltroDataFim] = useState('')

  const resetAll = () => {
    setStep('SCANNER_ORIGEM')
    setEntidadeTipo(null)
    setPaleteSelecionado(null)
    setCaixasSelecionadas([])
    setEnderecoOrigem(null)
    setDestino('')
    setModalConfirmarOrigem(false)
    setModalConfirmarDestino(false)
    setTimeout(() => document.getElementById('input-universal')?.focus(), 100)
  }

  // --- SCANNER UNIVERSAL ---
  const { inputRef: universalRef, handleKeyDown: handleUniversalKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      const codigo = val.toUpperCase().trim()
      if (universalRef.current) universalRef.current.value = ''
      
      // Se já estiver na etapa de destino e bipar algo
      if (step === 'DESTINO') {
        return processarScanDestino(codigo)
      }

      // ESTAMOS NO PASSO INICIAL (Origem)
      try {
        const iden = await movimentacoesQueries.identificarCodigoMovimentacao(codigo)
        
        if (iden.tipo === 'PALETE') {
          if (entidadeTipo === 'CAIXAS') return toastWarning('Atenção', 'Você já estava bipando caixas avulsas. Conclua ou reinicie.')
          setEntidadeTipo('PALETE')
          setPaleteSelecionado(iden.dados)
          setStep('DESTINO')
          toastSuccess('Palete LPN Detectado', 'Mova o palete inteiro para o destino.')
        } 
        else if (iden.tipo === 'CAIXA') {
          if (entidadeTipo === 'PALETE') return toastWarning('Atenção', 'Você já selecionou um palete inteiro.')
          
          if (caixasSelecionadas.find(c => c.id === iden.dados.id)) {
            return toastWarning('Aviso', 'Esta caixa já foi bipada.')
          }

          setEntidadeTipo('CAIXAS')
          setCaixasSelecionadas(prev => [iden.dados, ...prev])
          toastSuccess('Caixa SSCC Adicionada', iden.dados.produto_descricao)
        }
        else if (iden.tipo === 'ENDERECO') {
          if (iden.dados.endereco === 'REC' || iden.dados.endereco === 'EXPEDICAO') {
            return toastWarning('Não permitido', `Para ${iden.dados.endereco}, bipe os paletes ou caixas individualmente.`)
          }
          
          
          if (entidadeTipo === 'CAIXAS') {
            if (iden.tipo === 'CAIXA') {
              if (caixasSelecionadas.find(c => c.id === iden.dados.id)) {
                return toastWarning('Aviso', 'Esta caixa já foi bipada.')
              }
              setCaixasSelecionadas(prev => [iden.dados, ...prev])
              return toastSuccess('Caixa SSCC Adicionada', iden.dados.produto_descricao)
            } else if (iden.tipo === 'ENDERECO' || iden.tipo === 'PALETE') {
              setStep('DESTINO')
              return processarScanDestino(codigo)
            } else {
              return toastWarning('Atenção', 'Bipe outra caixa para a fila ou um endereço/palete de destino.')
            }
          }

          if (entidadeTipo === 'PALETE') return toastWarning('Atenção', 'Você já selecionou um palete.')

          setEnderecoOrigem(iden.dados.endereco)
          setModalConfirmarOrigem(true)
        }
        else {
          toastError('Código não reconhecido', 'Não é um Palete, Caixa ou Endereço válido.')
        }

      } catch (e) {
        toastError('Erro', e.message)
      }
    }
  })

  const processarScanDestino = async (val) => {
    const dst = val.toUpperCase().trim()
    if (dst === 'REC' || dst === 'EXPEDICAO') {
      return toastError('Destino Proibido', `Não é permitido transferir para "${dst}" pela Movimentação. Use a tela de Recebimento ou Saída.`)
    }

    // SEGURANÇA: rejeitar EANs e qualquer string puramente numérica como destino
    if (/^\d+$/.test(dst)) {
      return toastError('Destino Inválido', 'Este código parece ser um EAN de produto, não um endereço. Bipe um endereço de galpão (ex: 1R-01-1) ou um palete (PLT-XXXX).')
    }

    // Destino é um palete LPN
    if (dst.startsWith('PLT-')) {
      setDestino(dst)
      return
    }

    // Para qualquer outro código: validar se existe como endereço cadastrado
    const localDst = await locaisQueries.buscarPorEndereco(dst)
    if (!localDst) {
      return toastError('Endereço Inválido', `O destino "${dst}" não é um endereço válido cadastrado no sistema.`)
    }

    setDestino(dst)

    if (entidadeTipo === 'ENDERECO_TODO') {
      try {
        const stockNoDestino = await estoqueQueries.buscarPorEndereco(dst)
        if (stockNoDestino && stockNoDestino.length > 0) {
          setModalConfirmarDestino(true)
        }
      } catch (e) {}
    }
  }

  const confirmarMovimentacao = async () => {
    if (!destino) return toastWarning('Aviso', 'Informe o destino.')

    try {
      let res;
      if (entidadeTipo === 'PALETE') {
        res = await movimentacoesQueries.transferirPalete({
          palete_id: paleteSelecionado.id,
          destino,
          operador_id: operador.id,
          operador_nome: operador.nome
        });
      } 
      else if (entidadeTipo === 'CAIXAS') {
        res = await movimentacoesQueries.transferirCaixasSSCC({
          caixas_ids: caixasSelecionadas.map(c => c.id),
          destino,
          operador_id: operador.id,
          operador_nome: operador.nome
        });
      }
      else if (entidadeTipo === 'ENDERECO_TODO') {
        res = await movimentacoesQueries.transferirEnderecoInteiro({
          origem: enderecoOrigem,
          destino: destino,
          operador_id: operador.id,
          operador_nome: operador.nome
        });
        setModalConfirmarDestino(false);
      }

      if (res && res.success) {
        toastSuccess('Movimentação Concluída', `Transferência para ${destino} realizada.`)
        resetAll()
      } else {
        toastError('Erro', res ? res.error : 'Falha desconhecida')
      }
    } catch (err) {
      toastError('Erro Fatal', err.message)
    }
  }

  // --- HISTÓRICO ---
  const carregarHistorico = useCallback(async () => {
    setLoadingHistorico(true)
    try {
      const rows = await movimentacoesQueries.listarHistoricoTransferencias({
        filtroEndereco, filtroProduto, dataInicio: filtroDataInicio, dataFim: filtroDataFim
      })
      setHistorico(rows)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar histórico.')
    } finally {
      setLoadingHistorico(false)
    }
  }, [filtroEndereco, filtroProduto, filtroDataInicio, filtroDataFim])

  useEffect(() => { if (abaAtiva === 'HISTORICO') carregarHistorico() }, [abaAtiva, carregarHistorico])

  const exportarHistoricoCSV = () => {
    if (historico.length === 0) return
    const header = ['Data/Hora','Produto','Codigo','Origem','Destino','Caixas','Kg','Operador']
    const rows = historico.map(h => [
      new Date(h.data_hora + 'Z').toLocaleString('pt-BR'),
      h.produto_descricao || '-',
      h.produto_codigo || '-',
      h.endereco_origem,
      h.endereco_destino,
      h.qtd_caixas,
      parseFloat(h.qtd_kg||0).toFixed(3),
      h.operador_nome || 'Sistema'
    ])
    const csv = [header, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `historico_movimentacao_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Movimentação Interna</h1>
          <p className="page-header__subtitle">Transfira Paletes LPN, Caixas SSCC ou Endereços Genéricos</p>
        </div>
        {abaAtiva === 'MOVIMENTAR' && <button className="btn btn--ghost" onClick={resetAll}>Reiniciar Fluxo</button>}
        {abaAtiva === 'HISTORICO' && <button className="btn btn--ghost flex items-center gap-6" onClick={exportarHistoricoCSV}><Download size={15}/> Exportar CSV</button>}
      </div>

      {/* Abas */}
      <div style={{ display:'flex', gap:4, marginBottom:24, borderBottom:'2px solid var(--border)', paddingBottom:0 }}>
        {[['MOVIMENTAR','📦 Movimentar'],['HISTORICO','🕓 Histórico']].map(([id,label]) => (
          <button key={id} onClick={() => setAbaAtiva(id)} style={{
            padding:'8px 20px', border:'none', background:'transparent', cursor:'pointer', fontWeight:700, fontSize:13,
            borderBottom: abaAtiva===id ? '2px solid var(--primary)' : '2px solid transparent',
            color: abaAtiva===id ? 'var(--primary)' : 'var(--text-muted)',
            marginBottom:-2
          }}>{label}</button>
        ))}
      </div>

      {/* ABA MOVIMENTAR */}
      {abaAtiva === 'MOVIMENTAR' && (
        <div className="mov-flow">
          
          {/* STEP 1: SCANNER UNIVERSAL (Origem) */}
          <div className={`mov-step ${step === 'SCANNER_ORIGEM' || entidadeTipo === 'CAIXAS' ? 'active' : 'completed'}`}>
            <div className="mov-step__header">
              <div className="mov-step__number">1</div>
              <div className="mov-step__label">Bipar Origem (Palete, Caixa ou Endereço)</div>
            </div>
            
            {step === 'SCANNER_ORIGEM' || (entidadeTipo === 'CAIXAS' && !destino) ? (
              <div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input 
                      id="input-universal" 
                      ref={universalRef}
                      className="form-input form-input--scanner" 
                      placeholder="Bipar LPN, SSCC ou Endereço..." 
                      onKeyDown={handleUniversalKeyDown} 
                      autoFocus 
                    />
                    <ScanLine size={20} className="text-muted" style={{ position: 'absolute', right: 16, top: 12 }} />
                  </div>
                  {entidadeTipo === 'CAIXAS' && caixasSelecionadas.length > 0 && (
                    <button className="btn btn--primary" onClick={() => setStep('DESTINO')}>
                      Ir para Destino <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {/* DISPLAY DA ENTIDADE SELECIONADA */}
            {entidadeTipo === 'PALETE' && (
              <div className="mt-16 p-16" style={{ background: 'var(--primary-muted)', border: '1px solid var(--primary)', borderRadius: 8 }}>
                <div className="flex items-center gap-12 font-bold text-primary mb-8" style={{ fontSize: 18 }}>
                  <Layers size={24} /> {paleteSelecionado.codigo}
                </div>
                <div className="text-sm text-muted">
                  Local atual: <strong className="text-white">{paleteSelecionado.endereco_atual}</strong> | 
                  Contém <strong>{paleteSelecionado.caixas?.length} caixas</strong> ({paleteSelecionado.peso_total?.toFixed(2)} kg)
                </div>
              </div>
            )}

            {entidadeTipo === 'CAIXAS' && caixasSelecionadas.length > 0 && (
              <div className="mt-16">
                <div className="text-sm font-bold text-primary mb-8 flex items-center gap-8">
                  <Package size={16} /> {caixasSelecionadas.length} Caixa(s) Selecionada(s)
                  <span className="text-muted font-normal text-xs ml-auto">Total: {caixasSelecionadas.reduce((s, c) => s + c.peso_kg, 0).toFixed(2)} kg</span>
                </div>
                <div style={{ display: 'grid', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {caixasSelecionadas.map(c => (
                    <div key={c.id} style={{ padding: '8px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div className="font-bold text-sm">{c.produto_descricao}</div>
                        <div className="text-xs text-muted font-mono">{c.ean_caixa}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-cyan">{c.peso_kg} kg</div>
                        <div className="text-xs text-muted">Origem: {c.endereco || c.palete_codigo || 'REC'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {entidadeTipo === 'ENDERECO_TODO' && (
              <div className="mt-16 p-16" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div className="flex items-center gap-12 font-bold text-cyan" style={{ fontSize: 18 }}>
                  <MapPin size={24} /> Origem: Endereço {enderecoOrigem}
                </div>
                <div className="text-sm text-muted mt-8">
                  Todas as caixas e paletes do endereço acima serão movidos simultaneamente.
                </div>
              </div>
            )}
          </div>

          {/* STEP DESTINO E CONFIRMAÇÃO */}
          {entidadeTipo && (step === 'DESTINO' || destino) && (
            <div className={`mov-step active`}>
              <div className="mov-step__header">
                <div className="mov-step__number">2</div>
                <div className="mov-step__label">Endereço Destino</div>
              </div>
              
              {!destino ? (
                <input 
                  id="input-destino"
                  className="form-input form-input--scanner" 
                  placeholder="Bipar endereço de destino..." 
                  onKeyDown={(e) => e.key === 'Enter' && processarScanDestino(e.target.value)} 
                  autoFocus 
                />
              ) : (
                <div style={{ background: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 8, padding: 24, textAlign: 'center' }}>
                  <div className="text-muted text-sm uppercase font-bold mb-8">Movimentar para</div>
                  <div className="font-mono text-success flex items-center justify-center gap-12" style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
                    <MapPin size={28} /> {destino}
                  </div>
                  
                  <div className="flex gap-16 justify-center">
                    <button className="btn btn--ghost btn--lg" onClick={() => setDestino('')}>Alterar Destino</button>
                    <button className="btn btn--primary btn--lg" onClick={confirmarMovimentacao} style={{ paddingLeft: 40, paddingRight: 40 }}>
                      <Check size={20} /> CONFIRMAR MOVIMENTAÇÃO
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ABA HISTÓRICO */}
      {abaAtiva === 'HISTORICO' && (
        <div>
          {/* Filtros */}
          <div className="card mb-16">
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
              <div style={{ flex:'1 1 160px' }}>
                <label className="form-label">Endereço (origem ou destino)</label>
                <input className="form-input" placeholder="ex: 1R-01-1" value={filtroEndereco} onChange={e => setFiltroEndereco(e.target.value)} />
              </div>
              <div style={{ flex:'1 1 200px' }}>
                <label className="form-label">Produto / Descrição</label>
                <input className="form-input" placeholder="ex: alcatra" value={filtroProduto} onChange={e => setFiltroProduto(e.target.value)} />
              </div>
              <div style={{ flex:'1 1 130px' }}>
                <label className="form-label">Data início</label>
                <input type="date" className="form-input" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)} />
              </div>
              <div style={{ flex:'1 1 130px' }}>
                <label className="form-label">Data fim</label>
                <input type="date" className="form-input" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn--primary" onClick={carregarHistorico}>🔍 Filtrar</button>
                <button className="btn btn--ghost" onClick={() => { setFiltroEndereco(''); setFiltroProduto(''); setFiltroDataInicio(''); setFiltroDataFim('') }}>Limpar</button>
              </div>
            </div>
          </div>

          {/* Totalizador */}
          {historico.length > 0 && (
            <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
              {[
                ['Transferências', historico.length, 'var(--primary)'],
                ['Total Caixas', historico.reduce((s,h)=>s+(Number(h.qtd_caixas)||0),0), 'var(--success)'],
                ['Total Kg', historico.reduce((s,h)=>s+(parseFloat(h.qtd_kg)||0),0).toFixed(2)+' kg', 'var(--warning)'],
              ].map(([label,val,color]) => (
                <div key={label} style={{ background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 20px', textAlign:'center', minWidth:130 }}>
                  <div className="text-xs text-muted mb-4">{label}</div>
                  <div style={{ fontWeight:800, fontSize:18, color }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Lista */}
          {loadingHistorico ? (
            <div className="text-center text-muted p-32">Carregando...</div>
          ) : historico.length === 0 ? (
            <div className="card p-32 text-center text-muted">Nenhuma transferência encontrada com esses filtros.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {historico.map((h, i) => (
                <div key={h.id || i} style={{ background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                    <div style={{ flex:1, minWidth:180 }}>
                      <div className="font-bold" style={{ fontSize:14 }}>{h.produto_descricao || 'Produto não vinculado'}</div>
                      <div className="text-xs text-muted">{h.produto_codigo || ''}</div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13 }}>
                      <span style={{ background:'var(--bg-3)', padding:'3px 8px', borderRadius:4, fontWeight:700, fontSize:11 }}>{h.endereco_origem}</span>
                      <ArrowRight size={12} className="text-muted"/>
                      <span style={{ background:'rgba(59,130,246,0.15)', color:'var(--primary)', padding:'3px 8px', borderRadius:4, fontWeight:700, fontSize:11 }}>{h.endereco_destino}</span>
                    </div>
                    <div style={{ display:'flex', gap:16, fontSize:12, color:'var(--text-muted)', alignItems:'center', flexWrap:'wrap' }}>
                      <span>📦 <strong>{h.qtd_caixas}</strong> cx</span>
                      <span>⚖️ <strong>{parseFloat(h.qtd_kg||0).toFixed(3)}</strong> kg</span>
                      <span>👤 {h.operador_nome || 'Sistema'}</span>
                      <span>📅 {fmtDataHora(h.data_hora)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modalConfirmarOrigem && (
        <div className="modal-overlay animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100 }}>
          <div className="card p-24" style={{ width: 400, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-warning flex items-center gap-8">
              <AlertTriangle size={24} /> Mover Endereço Completo
            </h3>
            <p className="mb-24">Você realmente deseja movimentar <strong>todas</strong> as caixas e paletes do endereço <strong>{enderecoOrigem}</strong> simultaneamente para outro lugar?</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => { setModalConfirmarOrigem(false); resetAll(); }}>Cancelar</button>
              <button className="btn btn--warning flex-1" onClick={() => {
                setModalConfirmarOrigem(false);
                setEntidadeTipo('ENDERECO_TODO');
                setStep('DESTINO');
              }}>Sim, Mover Tudo</button>
            </div>
          </div>
        </div>
      )}

      {modalConfirmarDestino && (
        <div className="modal-overlay animate-fade-in" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100 }}>
          <div className="card p-24" style={{ width: 450, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-warning flex items-center gap-8">
              <AlertTriangle size={24} /> Destino Ocupado
            </h3>
            <p className="mb-24">O endereço de destino <strong>{destino}</strong> não está vazio e já contém outras cargas armazenadas.</p>
            <p className="mb-24">Tem certeza que deseja misturar as caixas do endereço <strong>{enderecoOrigem}</strong> com as do <strong>{destino}</strong>?</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => { setModalConfirmarDestino(false); setDestino(''); }}>Cancelar / Trocar Destino</button>
              <button className="btn btn--warning flex-1" onClick={() => {
                confirmarMovimentacao();
              }}>Sim, Confirmar e Misturar</button>
            </div>
          </div>
        </div>
      )}


    </div>
  )
}
