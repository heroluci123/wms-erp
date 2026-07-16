import React, { useState, useEffect } from 'react'
import { format, subDays, startOfMonth, endOfMonth, startOfYear } from 'date-fns'
import { Truck, Check, X, Plus, Package, ScanBarcode, MapPin, Hash, ClipboardList, Clock, Trash2, Calendar, Scale, DollarSign } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import * as saidaQueries from '../queries/saida.js'
import * as movimentacoesQueries from '../queries/movimentacoes.js'
import * as producaoQueries from '../queries/producao.js'

const fmtDataHora = (str) => {
  if (!str) return '-'
  const s = str.trim()
  const iso = /[Zz+\-]\d*$/.test(s) ? s : s.replace(' ', 'T') + 'Z'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export function Saida() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  
const PRESETS = [
  { label: 'Hoje', getRange: () => [new Date().toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: '7 dias', getRange: () => [subDays(new Date(), 6).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: '30 dias', getRange: () => [subDays(new Date(), 29).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
  { label: 'Este mês', getRange: () => [startOfMonth(new Date()).toISOString().slice(0,10), endOfMonth(new Date()).toISOString().slice(0,10)] },
  { label: 'Este ano', getRange: () => [startOfYear(new Date()).toISOString().slice(0,10), new Date().toISOString().slice(0,10)] },
]

  // Abas: MONTAR | EXPEDICAO | HISTORICO
  const [abaAtiva, setAbaAtiva] = useState('MONTAR')

  // --- ABA MONTAR ---
  const [formRomaneio, setFormRomaneio] = useState({ cliente: '', previsao_entrega: '' })
  const [romaneioAtual, setRomaneioAtual] = useState(null)
  
  // Modals
  const [modalRemoverCaixa, setModalRemoverCaixa] = useState(null)
  const [modalFinalizarMontagem, setModalFinalizarMontagem] = useState(false)
  const [modalExpedir, setModalExpedir] = useState(null)
  const [modalExcluirRomaneio, setModalExcluirRomaneio] = useState(false)
  const [modalReabrirRomaneio, setModalReabrirRomaneio] = useState(null)
  const [modalFefo, setModalFefo] = useState(null)
  
  // Bipagem
  const [eanBipado, setEanBipado] = useState('')

  const { inputRef: eanRef, handleKeyDown: handleEanKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      setEanBipado(val)
      if (!romaneioAtual) {
        return toastWarning('Aviso', 'Abra um romaneio primeiro para bipar caixas.')
      }

      try {
        const codigo = val.toUpperCase().trim()
        const res = await movimentacoesQueries.identificarCodigoMovimentacao(codigo)
        
        if (res.tipo !== 'CAIXA') {
          setEanBipado('')
          return toastError('Inválido', 'Bipe apenas códigos de barras de caixas válidas no sistema.')
        }

        const cx = res.dados
        if (romaneioAtual.itens && romaneioAtual.itens.find(i => i.caixa_id === cx.id)) {
          setEanBipado('')
          return toastWarning('Atenção', 'Esta caixa já foi bipada neste romaneio.')
        }

        const alertaFefo = await producaoQueries.verificarFEFO(cx.produto_id, cx.validade)
        if (alertaFefo && alertaFefo.id !== cx.id) {
          setModalFefo({ caixaBipada: cx, caixaAntiga: alertaFefo })
          setEanBipado('')
          return
        }

        const addRes = await saidaQueries.adicionarCaixa(romaneioAtual.id, cx, operador.id, operador.nome)
        if (addRes.success) {
          toastSuccess('Caixa Adicionada', cx.produto_descricao)
          carregarDetalhesRomaneioAtual()
        } else {
          toastError('Erro', addRes.error)
        }
      } catch (err) {
        toastError('Erro', err.message)
      } finally {
        setEanBipado('')
      }
    }
  })
  
  const confirmarBiparFefo = async () => {
    if (!modalFefo) return
    const cx = modalFefo.caixaBipada
    try {
      const addRes = await saidaQueries.adicionarCaixa(romaneioAtual.id, cx, operador.id, operador.nome)
      if (addRes.success) {
        toastSuccess('Caixa Adicionada', cx.produto_descricao)
        carregarDetalhesRomaneioAtual()
      } else {
        toastError('Erro', addRes.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setModalFefo(null)
      setTimeout(() => eanRef.current?.focus(), 100)
    }
  }

  const carregarDetalhesRomaneioAtual = async () => {
    if (!romaneioAtual) return
    const det = await saidaQueries.detalhesRomaneio(romaneioAtual.id)
    setRomaneioAtual(det)
  }

  const handleAbrirRomaneio = async () => {
    if (!formRomaneio.cliente.trim()) return toastWarning('Atenção', 'Informe o cliente.')
    try {
      const res = await saidaQueries.criarRomaneio({ 
        cliente: formRomaneio.cliente, 
        previsao_entrega: formRomaneio.previsao_entrega,
        operador_id: operador.id,
        operador_nome: operador.nome
      })
      if (res.success) {
        toastSuccess('Sucesso', 'Romaneio criado.')
        setFormRomaneio({ cliente: '', previsao_entrega: '' })
        const det = await saidaQueries.detalhesRomaneio(res.romaneio.id)
        setRomaneioAtual(det)
        setTimeout(() => eanRef.current?.focus(), 100)
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    }
  }

  const handleRemoverCaixa = (item) => {
    setModalRemoverCaixa(item)
  }

  const confirmarRemoverCaixa = async (item) => {
    try {
      const res = await saidaQueries.removerCaixa(
        romaneioAtual.id, item.caixa_id, item.produto_id, item.peso_kg, 'REC', operador.id, operador.nome
      )
      if (res.success) {
        toastSuccess('Sucesso', 'Caixa removida do romaneio e retornada ao estoque.')
        carregarDetalhesRomaneioAtual()
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    }
    setModalRemoverCaixa(null)
  }

  const handleFinalizarMontagem = () => {
    if (!romaneioAtual.itens || romaneioAtual.itens.length === 0) {
      return toastWarning('Aviso', 'Adicione pelo menos uma caixa para finalizar a montagem.')
    }
    setModalFinalizarMontagem(true)
  }

  const confirmarFinalizarMontagem = async () => {
    try {
      const res = await saidaQueries.finalizarMontagem(romaneioAtual.id)
      if (res.success) {
        toastSuccess('Sucesso', 'Montagem finalizada. Vá para a aba Expedição para despachar.')
        setRomaneioAtual(null)
        carregarRomaneiosList('MONTANDO')
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    }
    setModalFinalizarMontagem(false)
  }


  // --- ABA EXPEDIÇÃO & HISTORICO ---
  const [romaneiosLista, setRomaneiosLista] = useState([])
  const [romaneioExpandido, setRomaneioExpandido] = useState(null)
  
  // Período personalizado
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0,10))
  const [dataFim,    setDataFim]    = useState(() => new Date().toISOString().slice(0,10))
  const [previsaoBusca, setPrevisaoBusca] = useState('')
  const [presetAtivo, setPresetAtivo] = useState(0) // "Hoje" por padrão

  const aplicarPreset = (idx) => {
    setPresetAtivo(idx)
    const [ini, fim] = PRESETS[idx].getRange()
    setDataInicio(ini)
    setDataFim(fim)
  }

// ─── COMPONENTE: Desktop Split View para Itens do Romaneio ───────────────────
function RomaneioItensSplitView({ itens, onRemoveCaixa }) {
  const [skuSelecionado, setSkuSelecionado] = useState(null)

  // Agrupar itens por SKU
  const agrupados = React.useMemo(() => {
    if (!itens) return []
    const mapa = itens.reduce((acc, it) => {
      const chave = it.produto_codigo + ' - ' + it.produto_descricao
      if (!acc[chave]) {
        acc[chave] = { chave, produto_codigo: it.produto_codigo, produto_descricao: it.produto_descricao, caixas: [], pesoTotal: 0, qtd: 0 }
      }
      acc[chave].caixas.push(it)
      acc[chave].pesoTotal += it.peso_kg
      acc[chave].qtd += 1
      return acc
    }, {})
    return Object.values(mapa).sort((a, b) => a.produto_descricao.localeCompare(b.produto_descricao))
  }, [itens])

  // Seleciona o primeiro SKU por padrão quando os itens carregam
  useEffect(() => {
    if (agrupados.length > 0 && !skuSelecionado) {
      setSkuSelecionado(agrupados[0].chave)
    } else if (agrupados.length === 0) {
      setSkuSelecionado(null)
    }
  }, [agrupados, skuSelecionado])

  if (!itens || itens.length === 0) return null;

  const skuAtivo = agrupados.find(g => g.chave === skuSelecionado) || agrupados[0]

  return (
    <div className="flex" style={{ gap: 16, height: 280 }}>
      {/* Coluna Esquerda: SKUs Consolidados */}
      <div style={{ flex: '1 1 50%', border: '1px solid var(--border)', borderRadius: 8, overflowY: 'auto', background: 'var(--bg-2)' }}>
        {agrupados.map(g => (
          <div 
            key={g.chave}
            onClick={() => setSkuSelecionado(g.chave)}
            style={{ 
              padding: '12px 16px', 
              borderBottom: '1px solid var(--border)', 
              cursor: 'pointer',
              background: skuSelecionado === g.chave ? 'rgba(34,211,238,0.1)' : 'transparent',
              borderLeft: skuSelecionado === g.chave ? '3px solid var(--primary)' : '3px solid transparent'
            }}
            className="flex justify-between items-center hover:bg-bg-3 transition-colors"
          >
            <div>
              <div className="font-bold text-sm" style={{ color: skuSelecionado === g.chave ? 'var(--primary)' : 'inherit' }}>
                {g.chave}
              </div>
              <div className="text-xs text-muted mt-4">
                <Package size={12} className="inline mr-4"/> {g.qtd} {g.qtd === 1 ? 'caixa' : 'caixas'}
              </div>
            </div>
            <div className="font-bold text-cyan text-right">
              {g.pesoTotal.toFixed(2)} kg
            </div>
          </div>
        ))}
      </div>

      {/* Coluna Direita: Caixas do SKU Selecionado */}
      <div style={{ flex: '1 1 50%', border: '1px solid var(--border)', borderRadius: 8, overflowY: 'auto', background: 'var(--bg-2)' }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--bg-1)', padding: '8px 16px', borderBottom: '1px solid var(--border)', zIndex: 10 }}>
          <h5 className="font-bold text-xs uppercase text-muted">EANs: {skuAtivo?.chave}</h5>
        </div>
        {skuAtivo?.caixas.map(c => (
          <div key={c.id} className="flex justify-between items-center" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="font-mono text-sm text-muted">{c.ean_caixa}</div>
            <div className="flex items-center gap-16">
              <div className="font-bold text-sm">{c.peso_kg.toFixed(2)} kg</div>
              {onRemoveCaixa && (
                <button className="btn btn--ghost btn--icon text-danger p-4" onClick={(e) => { e.stopPropagation(); onRemoveCaixa(c) }} title="Remover caixa">
                  <X size={16}/>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

  const carregarRomaneiosList = async (statusBusca, inicio = null, fim = null, previsao = null) => {
    try {
      const lista = await saidaQueries.listarRomaneios(statusBusca, inicio, fim, previsao)
      setRomaneiosLista(lista)
    } catch (e) {
      toastError('Erro', 'Falha ao buscar romaneios')
    }
  }

  useEffect(() => {
    if (abaAtiva === 'MONTAR') {
      carregarRomaneiosList('MONTANDO')
    } else if (abaAtiva === 'EXPEDICAO') {
      carregarRomaneiosList('AGUARDANDO_EXPEDICAO')
    } else if (abaAtiva === 'HISTORICO') {
      carregarRomaneiosList('EXPEDIDO', dataInicio, dataFim, previsaoBusca)
    }
    setRomaneioExpandido(null)
  }, [abaAtiva, dataInicio, dataFim, previsaoBusca])

  const carregarDetalhesExpansao = async (id) => {
    try {
      const det = await saidaQueries.detalhesRomaneio(id)
      setRomaneioExpandido(det)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar detalhes do romaneio')
    }
  }

  const handleExpedir = (id) => {
    setModalExpedir(id)
  }

  const confirmarExpedir = async (id) => {
    try {
      const res = await saidaQueries.expedirRomaneio(id, operador.id, operador.nome)
      if (res.success) {
        toastSuccess('Expedido com sucesso!', 'Romaneio finalizado e estoque baixado.')
        setRomaneioExpandido(null)
        carregarRomaneiosList('AGUARDANDO_EXPEDICAO')
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    }
    setModalExpedir(null)
  }

  const handleExcluirRomaneio = () => {
    setModalExcluirRomaneio(true)
  }

  const confirmarExcluirRomaneio = async () => {
    try {
      const res = await saidaQueries.excluirRomaneio(romaneioAtual.id)
      if (res.success) {
        toastSuccess('Sucesso', 'Romaneio excluído.')
        setRomaneioAtual(null)
        carregarRomaneiosList('MONTANDO')
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    }
    setModalExcluirRomaneio(false)
  }

  const handleReabrirRomaneio = (id) => {
    setModalReabrirRomaneio(id)
  }

  const confirmarReabrirRomaneio = async (id) => {
    try {
      const res = await saidaQueries.reabrirRomaneio(id)
      if (res.success) {
        toastSuccess('Sucesso', 'Romaneio reaberto para montagem.')
        setRomaneioExpandido(null)
        carregarRomaneiosList('AGUARDANDO_EXPEDICAO')
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    }
    setModalReabrirRomaneio(null)
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Saída de Materiais</h1>
          <p className="page-header__subtitle">Montagem e despacho de romaneios para clientes</p>
        </div>
      </div>

      <div style={{ display:'flex', gap:4, marginBottom:24, borderBottom:'2px solid var(--border)', paddingBottom:0 }}>
        {[
          ['MONTAR', '📦 Montar Romaneio'],
          ['EXPEDICAO', '🚚 Expedição'],
          ['HISTORICO', '🕓 Histórico']
        ].map(([id,label]) => (
          <button key={id} onClick={() => setAbaAtiva(id)} style={{
            padding:'8px 20px', border:'none', background:'transparent', cursor:'pointer', fontWeight:700, fontSize:13,
            borderBottom: abaAtiva===id ? '2px solid var(--primary)' : '2px solid transparent',
            color: abaAtiva===id ? 'var(--primary)' : 'var(--text-muted)',
            marginBottom:-2
          }}>{label}</button>
        ))}
      </div>

      {abaAtiva === 'MONTAR' && (
        <div className="grid-responsive">
          {!romaneioAtual ? (
            <div className="flex-col gap-16">
              <div className="card">
                <h3 className="font-bold text-primary flex items-center gap-8 mb-20"><ClipboardList size={20}/> Novo Romaneio</h3>
                <div className="form-group mb-16">
                  <label className="form-label">Cliente / Destino *</label>
                  <input type="text" className="form-input" placeholder="ex: Maria Martineli" value={formRomaneio.cliente} onChange={e => setFormRomaneio(p => ({ ...p, cliente: e.target.value }))} autoFocus />
                </div>
                <div className="form-group mb-20">
                  <label className="form-label">Previsão de Entrega</label>
                  <input type="date" className="form-input" value={formRomaneio.previsao_entrega} onChange={e => setFormRomaneio(p => ({ ...p, previsao_entrega: e.target.value }))} />
                </div>
                <button className="btn btn--primary btn--lg w-full" onClick={handleAbrirRomaneio}><Plus size={18}/> Iniciar Montagem</button>
              </div>

              {romaneiosLista.length > 0 && (
                <div className="card">
                  <h3 className="font-bold text-warning flex items-center gap-8 mb-16"><Clock size={20}/> Romaneios em Montagem</h3>
                  <div className="flex-col gap-12">
                    {romaneiosLista.map(rom => (
                      <div key={rom.id} className="card card--elevated cursor-pointer" onClick={async () => {
                        const det = await saidaQueries.detalhesRomaneio(rom.id)
                        setRomaneioAtual(det)
                        setTimeout(() => eanRef.current?.focus(), 100)
                      }} style={{ borderLeft: '4px solid var(--warning)' }}>
                        <div className="flex justify-between items-center mb-8">
                          <strong className="text-primary">{rom.codigo}</strong>
                          <span className="text-xs text-muted">{rom.qtd_caixas} caixas</span>
                        </div>
                        <div className="text-sm text-white font-bold">{rom.cliente}</div>
                        <div className="text-xs text-muted">Previsão: {rom.previsao_entrega ? new Date(rom.previsao_entrega + 'T00:00:00').toLocaleDateString() : '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="flex justify-between items-center mb-16 pb-16" style={{ borderBottom: '1px solid var(--border)' }}>
                <div>
                  <h3 className="font-bold text-primary text-xl">{romaneioAtual.codigo}</h3>
                  <div className="text-muted text-sm">Cliente: <strong className="text-white">{romaneioAtual.cliente}</strong></div>
                  <div className="text-muted text-sm">Previsão: {romaneioAtual.previsao_entrega ? new Date(romaneioAtual.previsao_entrega + 'T00:00:00').toLocaleDateString() : 'N/A'}</div>
                </div>
                <div className="flex gap-8">
                  <button className="btn btn--ghost text-danger" onClick={handleExcluirRomaneio} title="Excluir Romaneio"><Trash2 size={18}/></button>
                  <button className="btn btn--ghost text-muted" onClick={() => { setRomaneioAtual(null); carregarRomaneiosList('MONTANDO') }}>Voltar</button>
                </div>
              </div>

              <div className="mb-24">
                <h4 className="font-bold mb-8 text-warning flex items-center gap-8"><ScanBarcode size={18}/> Bipar Caixas para este Pedido</h4>
                <input
                  ref={eanRef}
                  className="form-input form-input--scanner"
                  placeholder="Bipe o EAN da caixa..."
                  value={eanBipado}
                  onChange={e => setEanBipado(e.target.value)}
                  onKeyDown={handleEanKeyDown}
                />
              </div>

              <div className="flex justify-between items-center bg-bg-2 p-12 rounded mb-16 border border-border">
                <div className="font-bold flex items-center gap-8"><Package size={18}/> {romaneioAtual.qtd_caixas || 0} Caixas</div>
                <div className="font-bold text-cyan text-xl">{(romaneioAtual.peso_total || 0).toFixed(2)} kg</div>
              </div>

              {romaneioAtual.itens && romaneioAtual.itens.length > 0 && (
                <>
                  <div className="desktop-only mb-24">
                    <RomaneioItensSplitView itens={romaneioAtual.itens} onRemoveCaixa={handleRemoverCaixa} />
                  </div>
                  <div className="mobile-only table-container mb-24" style={{ maxHeight: 300, overflowY: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>EAN Caixa</th>
                          <th style={{ textAlign: 'right' }}>Peso (kg)</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {romaneioAtual.itens.map(it => (
                          <tr key={it.id}>
                            <td>{it.produto_codigo} - {it.produto_descricao}</td>
                            <td className="td-mono text-muted">{it.ean_caixa}</td>
                            <td className="font-bold text-success" style={{ textAlign: 'right' }}>{it.peso_kg.toFixed(2)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn--ghost btn--icon text-danger" onClick={() => handleRemoverCaixa(it)}><X size={16}/></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <button className="btn btn--primary btn--lg w-full" onClick={handleFinalizarMontagem}>
                <Check size={18}/> Finalizar Montagem do Romaneio
              </button>
            </div>
          )}
        </div>
      )}

      {(abaAtiva === 'EXPEDICAO' || abaAtiva === 'HISTORICO') && (
        <div className="flex-col gap-16">
          {abaAtiva === 'HISTORICO' && (
            <div className="flex-col gap-16 mb-8">
              <div className="card card--elevated">
                <div className="flex items-center gap-16 flex-wrap">
                  <div className="flex items-center gap-8" style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
                    <Calendar size={16} /> Período de análise:
                  </div>
                  <div className="flex gap-8 flex-wrap">
                    {PRESETS.map((p, i) => (
                      <button key={i} onClick={() => aplicarPreset(i)} style={{
                        padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: '1.5px solid',
                        borderColor: presetAtivo === i ? 'var(--accent)' : 'var(--border)',
                        background: presetAtivo === i ? 'var(--accent-muted)' : 'transparent',
                        color: presetAtivo === i ? 'var(--accent)' : 'var(--text-muted)',
                        cursor: 'pointer', transition: 'all 0.15s'
                      }}>{p.label}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-8 ml-auto">
                    <input type="date" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setPresetAtivo(null) }}
                      style={{ background: 'var(--bg-3)', border: '1.5px solid var(--border)', borderRadius: 8, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 13 }} />
                    <span style={{ color: 'var(--text-muted)' }}>até</span>
                    <input type="date" value={dataFim} onChange={e => { setDataFim(e.target.value); setPresetAtivo(null) }}
                      style={{ background: 'var(--bg-3)', border: '1.5px solid var(--border)', borderRadius: 8, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 13, marginRight: 8 }} />
                    
                    <div style={{ height: 24, width: 1, background: 'var(--border)' }}></div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>Previsão:</span>
                    <input type="date" value={previsaoBusca} onChange={e => setPrevisaoBusca(e.target.value)}
                      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '2px 4px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
                  </div>
                </div>
              </div>
              
              <div className="kpi-grid">
                <div className="kpi-card" style={{ borderColor: 'var(--primary)' }}>
                  <span className="kpi-card__label flex items-center gap-8" style={{ color: 'var(--primary)' }}><Package size={14} /> Caixas Expedidas</span>
                  <span className="kpi-card__value">{romaneiosLista.reduce((sum, r) => sum + (r.qtd_caixas || 0), 0)}</span>
                </div>
                <div className="kpi-card" style={{ borderColor: 'var(--info)' }}>
                  <span className="kpi-card__label flex items-center gap-8" style={{ color: 'var(--info)' }}><Scale size={14} /> KG Expedido</span>
                  <span className="kpi-card__value">{romaneiosLista.reduce((sum, r) => sum + parseFloat(r.peso_total || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="kpi-card" style={{ borderColor: 'var(--success)' }}>
                  <span className="kpi-card__label flex items-center gap-8" style={{ color: 'var(--success)' }}><DollarSign size={14} /> Valor Expedido</span>
                  <span className="kpi-card__value">R$ {romaneiosLista.reduce((sum, r) => sum + parseFloat(r.valor_total || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          )}
          {romaneiosLista.length === 0 && (
            <div className="text-muted text-center p-24">Nenhum romaneio nesta etapa.</div>
          )}
          {romaneiosLista.map(rom => (
            <div key={rom.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div 
                className="p-16 flex justify-between items-center cursor-pointer hover:bg-bg-2 transition-colors"
                onClick={() => setRomaneioExpandido(romaneioExpandido?.id === rom.id ? null : rom)}
              >
                <div className="ml-8">
                  <div className="font-bold text-lg text-primary mb-4 flex items-center gap-8">
                    {abaAtiva === 'EXPEDICAO' ? <Truck size={20}/> : <Check size={20}/>} <span>{rom.codigo}</span>
                  </div>
                  <div className="text-sm">Cliente: <strong className="text-white">{rom.cliente}</strong></div>
                  <div className="text-xs text-muted flex items-center gap-12 mt-4 flex-wrap">
                    <span><Clock size={12} className="inline mr-4"/> Montado em: {fmtDataHora(rom.created_at)} por {rom.operador_nome || 'Sistema'}</span>
                    {rom.expedido_at && (
                      <span><Check size={12} className="inline mr-4"/> Finalizado em: {fmtDataHora(rom.expedido_at)} por {rom.operador_expedicao_nome || 'Sistema'}</span>
                    )}
                    <span><Package size={12} className="inline mr-4"/> {rom.qtd_caixas} cx ({(rom.peso_total || 0).toFixed(2)} kg)</span>
                  </div>
                  {rom.previsao_entrega && (
                    <div className="text-xs text-info mt-4 font-bold flex items-center gap-4">
                       <Clock size={12}/> Previsão de Entrega: {new Date(rom.previsao_entrega + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </div>
                  )}
                </div>
                {abaAtiva === 'EXPEDICAO' && romaneioExpandido?.id === rom.id && (
                  <div className="flex gap-8">
                    <button className="btn btn--ghost" onClick={(e) => { e.stopPropagation(); handleReabrirRomaneio(rom.id) }}>
                      REABRIR
                    </button>
                    <button className="btn btn--primary" onClick={(e) => { e.stopPropagation(); handleExpedir(rom.id) }}>
                      REALIZAR EXPEDIÇÃO
                    </button>
                  </div>
                )}
              </div>
              
              {romaneioExpandido?.id === rom.id && (
                <div className="p-16 border-t border-border bg-bg-1">
                  <h4 className="font-bold mb-12 text-sm text-muted uppercase">Itens do Romaneio</h4>
                  {romaneioExpandido.itens && romaneioExpandido.itens.length > 0 ? (
                    <>
                      {/* Desktop View */}
                      <div className="desktop-only">
                        <RomaneioItensSplitView itens={romaneioExpandido.itens} />
                      </div>
                      
                      {/* Mobile View */}
                      <div className="mobile-only table-container" style={{ maxHeight: 250, overflowY: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th>EAN</th>
                              <th style={{ textAlign: 'right' }}>Peso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {romaneioExpandido.itens.map(it => (
                              <tr key={it.id}>
                                <td>{it.produto_codigo} - {it.produto_descricao}</td>
                                <td className="td-mono text-muted">{it.ean_caixa}</td>
                                <td className="font-bold text-cyan" style={{ textAlign: 'right' }}>{it.peso_kg.toFixed(2)} kg</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center p-24 text-muted"><Clock className="animate-spin inline mr-8" size={16}/> Carregando itens...</div>
                  )}
                  {(() => {
                    if(!romaneioExpandido.itens && rom.id) carregarDetalhesExpansao(rom.id);
                    return null;
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MODALS */}
      {modalFefo && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card p-24 animate-scale-in" style={{ width: 500, maxWidth: '90%', borderTop: '4px solid var(--warning)' }}>
            <h3 className="font-bold text-xl mb-16 text-warning flex items-center gap-8"><Clock size={24} /> Alerta de FEFO!</h3>
            <p className="mb-16">
              Você bipou uma caixa com vencimento em <strong className="text-white">{new Date(modalFefo.caixaBipada.validade + 'T00:00:00').toLocaleDateString('pt-BR', {timeZone:'UTC'})}</strong>,
              mas existe uma caixa <strong>mais antiga</strong> deste produto no estoque:
            </p>
            <div className="bg-bg-1 p-16 rounded-md mb-24 border border-border">
              <div className="font-bold text-cyan mb-8">{modalFefo.caixaAntiga.produto_descricao}</div>
              <div className="grid grid-cols-2 gap-8 text-sm">
                <div><strong>Vencimento:</strong> <span className="text-warning font-bold">{new Date(modalFefo.caixaAntiga.validade + 'T00:00:00').toLocaleDateString('pt-BR', {timeZone:'UTC'})}</span></div>
                <div><strong>Endereço:</strong> <span className="text-white font-bold">{modalFefo.caixaAntiga.endereco || 'REC'}</span></div>
                <div><strong>EAN:</strong> {modalFefo.caixaAntiga.ean_caixa}</div>
                <div><strong>Peso:</strong> {modalFefo.caixaAntiga.peso_kg?.toFixed(2)} kg</div>
              </div>
            </div>
            <p className="mb-24 text-sm text-muted">Deseja ignorar o alerta e utilizar a caixa mais nova mesmo assim?</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost flex-1" onClick={() => {
                setModalFefo(null)
                setTimeout(() => eanRef.current?.focus(), 100)
              }}>
                Cancelar
              </button>
              <button className="btn btn--warning flex-1" onClick={confirmarBiparFefo}>
                Ignorar e Bipar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalRemoverCaixa && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card p-24" style={{ width: 400, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-danger">Remover Caixa</h3>
            <p className="mb-24">Remover a caixa de <strong>{modalRemoverCaixa.produto_descricao}</strong> do romaneio?</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => setModalRemoverCaixa(null)}>Cancelar</button>
              <button className="btn btn--danger flex-1" onClick={() => confirmarRemoverCaixa(modalRemoverCaixa)}>Remover</button>
            </div>
          </div>
        </div>
      )}

      {modalFinalizarMontagem && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card p-24" style={{ width: 400, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-primary">Finalizar Montagem</h3>
            <p className="mb-24">Finalizar montagem do <strong>{romaneioAtual?.codigo}</strong>? Ele será enviado para a aba de Expedição e não poderá mais receber caixas.</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => setModalFinalizarMontagem(false)}>Cancelar</button>
              <button className="btn btn--primary flex-1" onClick={confirmarFinalizarMontagem}>Finalizar</button>
            </div>
          </div>
        </div>
      )}

      {modalExpedir && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card p-24" style={{ width: 450, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-primary">Confirmar Expedição</h3>
            <p className="mb-24">Atenção: Ao confirmar, todas as caixas serão baixadas do estoque definitivamente. Deseja realizar a expedição?</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => setModalExpedir(null)}>Cancelar</button>
              <button className="btn btn--primary flex-1" onClick={() => confirmarExpedir(modalExpedir)}>Expedir Romaneio</button>
            </div>
          </div>
        </div>
      )}

      {modalExcluirRomaneio && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card p-24" style={{ width: 400, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-danger">Excluir Romaneio</h3>
            <p className="mb-24">Tem certeza que deseja excluir este romaneio? Se houver caixas nele, elas voltarão para o estoque e ficarão disponíveis.</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => setModalExcluirRomaneio(false)}>Cancelar</button>
              <button className="btn btn--danger flex-1" onClick={confirmarExcluirRomaneio}>Excluir Romaneio</button>
            </div>
          </div>
        </div>
      )}

      {modalReabrirRomaneio && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card p-24" style={{ width: 400, maxWidth: '90%' }}>
            <h3 className="font-bold text-xl mb-16 text-warning">Reabrir Romaneio</h3>
            <p className="mb-24">Deseja reabrir este romaneio? Ele voltará para a aba de "Montar Romaneio", permitindo adicionar ou remover caixas.</p>
            <div className="flex gap-16">
              <button className="btn btn--ghost" onClick={() => setModalReabrirRomaneio(null)}>Cancelar</button>
              <button className="btn btn--primary flex-1" onClick={() => confirmarReabrirRomaneio(modalReabrirRomaneio)}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
