import React, { useState, useEffect } from 'react'
import { UploadCloud, Check, History, Download, Trash2, Package, Layers, Plus, X, AlertTriangle, Tag } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'
import * as movimentacoesQueries from '../queries/movimentacoes.js';
import * as produtosQueries from '../queries/produtos.js';
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx';

export function Recebimento() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  
  // Tabs
  const [activeTab, setActiveTab] = useState('palete') // 'palete' | 'avulso' | 'historico'
  
  // Estado do Palete LPN
  const [paletesAbertos, setPaletesAbertos] = useState([])
  const [paleteAtivo, setPaleteAtivo] = useState(null)
  const [caixasDoPalete, setCaixasDoPalete] = useState([])
  
  // Formulário de Caixa SSCC
  const [eanBipado, setEanBipado] = useState('')
  const [eanCaixaReal, setEanCaixaReal] = useState('') // EAN que vai ser salvo (pode ser gerado internamente)
  const [eanEhUnico, setEanEhUnico] = useState(true) // false = EAN genérico, gerou código interno
  const [produtoDetectado, setProdutoDetectado] = useState(null)
  const [boxData, setBoxData] = useState({ peso_kg: '', validade: '' })
  
  // Modal de EAN
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  // Histórico
  const [historico, setHistorico] = useState([])
  const [filtroProduto, setFiltroProduto] = useState('')
  const [filtroData, setFiltroData] = useState('')
  const [incluirInsumos, setIncluirInsumos] = useState(false)

  // Carregar dados iniciais
  useEffect(() => {
    carregarPaletesAbertos()
  }, [])

  const carregarPaletesAbertos = async () => {
    try {
      const lista = await movimentacoesQueries.listarPaletesAbertos()
      setPaletesAbertos(lista)
      if (lista.length > 0 && !paleteAtivo) {
        selecionarPalete(lista[0])
      }
    } catch (e) {
      toastError('Erro', 'Falha ao carregar paletes abertos.')
    }
  }

  const selecionarPalete = async (p) => {
    setPaleteAtivo(p)
    try {
      const caixas = await movimentacoesQueries.listarCaixasDoPalete(p.id)
      setCaixasDoPalete(caixas)
    } catch (e) {
      console.error(e)
    }
  }

  const handleCriarPalete = async () => {
    try {
      const novo = await movimentacoesQueries.criarPalete()
      toastSuccess('Palete Aberto', `Código gerado: ${novo.codigo}`)
      await carregarPaletesAbertos()
      selecionarPalete(novo)
    } catch (e) {
      toastError('Erro', e.message)
    }
  }

  const handleRemoverCaixa = async (c) => {
    if (!window.confirm(`Tem certeza que deseja apagar a caixa de ${c.peso_kg}kg do palete?`)) return;
    try {
      const res = await movimentacoesQueries.removerCaixaSerializada(c.id, operador.id, operador.nome);
      if (res.success) {
        toastSuccess('Sucesso', 'Caixa apagada.');
        selecionarPalete(paleteAtivo);
        carregarPaletesAbertos();
      } else {
        toastError('Erro', res.error);
      }
    } catch (e) {
      toastError('Erro fatal', e.message);
    }
  };

  const handleConcluirPalete = async () => {
    if (!paleteAtivo) return;
    if (!window.confirm(`Tem certeza que deseja fechar o ${paleteAtivo.codigo} na doca?`)) return;
    try {
      const res = await movimentacoesQueries.concluirPalete(paleteAtivo.id);
      if (res.success) {
        toastSuccess('Palete Concluído', `${paleteAtivo.codigo} fechado com sucesso.`);
        setPaleteAtivo(null);
        setCaixasDoPalete([]);
        carregarPaletesAbertos();
      } else {
        toastError('Erro', res.error);
      }
    } catch (e) {
      toastError('Erro fatal', e.message);
    }
  };

  // --- Fluxo de Bipagem da Caixa (SSCC) ---
  const { inputRef: codigoRef, handleKeyDown: handleCodigoKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      if (!paleteAtivo) return toastWarning('Atenção', 'Abra ou selecione um palete primeiro.')
      setEanBipado(val)
      setProdutoDetectado(null)
      
      try {
        const resultado = await produtosQueries.buscarPorCodigoComInfo(val)
        if (resultado) {
          const { produto, eanUnico } = resultado
          setProdutoDetectado(produto)
          setEanEhUnico(eanUnico)
          if (eanUnico) {
            // EAN real único: usa o próprio EAN bipado como chave da caixa
            setEanCaixaReal(val)
            toastSuccess('Caixa SSCC Identificada', produto.descricao)
          } else {
            // EAN genérico: gera um código interno único para essa caixa
            const codigoInterno = `INT-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`
            setEanCaixaReal(codigoInterno)
            toastWarning('EAN Genérico', `${produto.descricao} — informe peso e validade únicos desta caixa.`)
          }
          setTimeout(() => document.getElementById('box-peso')?.focus(), 100)
        } else {
          setEanDesconhecido(val)
          setModalEanOpen(true)
        }
      } catch (e) {
        toastError('Erro', 'Falha ao processar código.')
      }
    }
  })

  const handleAdicionarCaixa = async (e) => {
    e.preventDefault()
    if (!paleteAtivo) return toastError('Atenção', 'Selecione um palete.')
    if (!produtoDetectado) return toastError('Atenção', 'Produto não detectado.')
    if (!boxData.peso_kg || !boxData.validade) return toastWarning('Atenção', 'Informe peso e validade.')

    try {
      const res = await movimentacoesQueries.receberCaixaSerializada({
        ean_caixa: eanCaixaReal, // usa o código correto (real ou gerado internamente)
        produto_id: produtoDetectado.id,
        palete_id: paleteAtivo.id,
        peso_kg: parseFloat(boxData.peso_kg),
        validade: boxData.validade,
        operador_id: operador.id,
        operador_nome: operador.nome
      })

      if (res.success) {
        toastSuccess('Caixa Adicionada', `${produtoDetectado.descricao} adicionado ao ${paleteAtivo.codigo}.`)
        setEanBipado('')
        setEanCaixaReal('')
        setEanEhUnico(true)
        setProdutoDetectado(null)
        setBoxData({ peso_kg: '', validade: boxData.validade })
        selecionarPalete(paleteAtivo)
        carregarPaletesAbertos()
        codigoRef.current?.focus()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro fatal', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title">Recebimento (Inbound)</h1>
          <p className="page-header__subtitle">Montagem de Paletes LPN e Rastreabilidade SSCC</p>
        </div>
      </div>

      <div className="tabs mb-24" style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        <button 
          className={`btn ${activeTab === 'palete' ? 'btn--primary' : 'btn--ghost'}`} 
          onClick={() => { setActiveTab('palete'); setTimeout(() => codigoRef.current?.focus(), 100) }}
        >
          <Layers size={16} /> Recebimento c/ Palete
        </button>
        <button 
          className={`btn ${activeTab === 'avulso' ? 'btn--primary' : 'btn--ghost'}`} 
          onClick={() => setActiveTab('avulso')}
        >
          <UploadCloud size={16} /> Recebimento Antigo (Agrupado)
        </button>
      </div>

      {activeTab === 'palete' && (
        <div className="grid-responsive">
          
          {/* MASTER: Seleção de Palete (Esconde se tiver um palete ativo no mobile) */}
          {!paleteAtivo && (
            <div className="card">
              <div className="flex justify-between items-center mb-16">
                <h3 className="font-bold text-primary flex items-center gap-8"><Layers size={18} /> Paletes de Entrada</h3>
                <button className="btn btn--sm btn--primary" onClick={handleCriarPalete}><Plus size={14}/> Novo Palete</button>
              </div>

              {paletesAbertos.length > 0 ? (
                <div className="mb-16">
                  <label className="text-xs text-muted font-bold mb-8 block">PALETES EM MONTAGEM NA DOCA</label>
                  <div className="flex flex-col gap-8">
                  {paletesAbertos.map(p => (
                    <div 
                      key={p.id} 
                      onClick={() => selecionarPalete(p)}
                      style={{ 
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid',
                        borderColor: paleteAtivo?.id === p.id ? 'var(--primary)' : 'var(--border)',
                        background: paleteAtivo?.id === p.id ? 'var(--primary-muted)' : 'var(--bg-2)'
                      }}
                    >
                      <div className="font-bold" style={{ color: paleteAtivo?.id === p.id ? 'var(--primary)' : 'var(--text)' }}>{p.codigo}</div>
                      <div className="text-xs text-muted">{p.qtd_caixas || 0} cx • {p.peso_total || 0} kg</div>
                    </div>
                  ))}
                  </div>
                </div>
              ) : (
                <div className="p-32 text-center text-muted border border-dashed border-border rounded-lg">
                  <div className="mb-8">Nenhum palete em montagem.</div>
                  <button className="btn btn--primary" onClick={handleCriarPalete}>Abrir um novo palete</button>
                </div>
              )}
            </div>
          )}

          {/* DETAIL: Conteúdo do Palete e Bipagem (Esconde se NÃO tiver palete ativo) */}
          {paleteAtivo && (
            <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
              <div style={{ background: 'var(--bg-2)', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="flex justify-between items-center mb-10">
                  <button className="btn btn--ghost btn--sm text-muted p-0" onClick={() => setPaleteAtivo(null)}>
                    <ArrowLeft size={16}/> Voltar
                  </button>
                  <div className="text-sm font-bold text-primary">{paleteAtivo.codigo}</div>
                  <button className="btn btn--sm btn--secondary" onClick={() => { handleConcluirPalete(); setPaleteAtivo(null); }} title="Fechar o palete na doca para liberar para movimentação"><Check size={14}/> Concluir</button>
                </div>
                <div className="flex justify-between text-sm px-4">
                  <div>Caixas: <strong>{caixasDoPalete.length}</strong></div>
                  <div>Peso Total: <strong>{caixasDoPalete.reduce((sum, c) => sum + c.peso_kg, 0).toFixed(2)} kg</strong></div>
                </div>
              </div>
              
              <div style={{ padding: '16px' }}>
                <h3 className="font-bold text-warning flex items-center gap-8 mb-16"><ScanBarcode size={18} /> Bipar Caixa SSCC</h3>
                <form onSubmit={handleAdicionarCaixa}>
                  <div className="form-group mb-16">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        ref={codigoRef}
                        type="text"
                        className="form-input form-input--scanner"
                        placeholder="Bipe o código de barras..."
                        value={eanBipado}
                        onChange={(e) => setEanBipado(e.target.value)}
                        onKeyDown={handleCodigoKeyDown}
                      />
                      {eanBipado && (
                        <button type="button" className="btn btn--ghost text-muted" onClick={() => { setEanBipado(''); setProdutoDetectado(null); codigoRef.current?.focus() }}>
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  {produtoDetectado && (
                    <div style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 10, border: `1px solid ${eanEhUnico ? 'var(--primary)' : 'var(--warning)'}`, marginBottom: 16 }}>
                      <div className="text-xs font-bold mb-4 uppercase" style={{ color: eanEhUnico ? 'var(--primary)' : 'var(--warning)' }}>
                        {eanEhUnico ? '✅ Caixa SSCC Única' : '⚠️ EAN Genérico — Código único gerado internamente'}
                      </div>
                      <div className="font-bold" style={{ fontSize: 16 }}>{produtoDetectado.descricao}</div>
                      <div className="text-sm text-muted mb-4">Código: {produtoDetectado.codigo || '-'}</div>
                      {!eanEhUnico && (
                        <div style={{ fontSize: 11, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, padding: '6px 10px', color: 'var(--warning)', marginBottom: 8 }}>
                          🏷️ EAN bipado ({eanBipado}) é genérico — esta caixa receberá o código interno: <strong style={{ fontFamily: 'monospace' }}>{eanCaixaReal}</strong>
                        </div>
                      )}

                      <div className="form-grid form-grid--2">
                        <div className="form-group">
                          <label className="form-label">Peso Real (KG) *</label>
                          <input
                            id="box-peso"
                            type="number"
                            step="0.001"
                            className="form-input form-input--number"
                            value={boxData.peso_kg}
                            onChange={e => setBoxData({ ...boxData, peso_kg: e.target.value })}
                            required
                            autoComplete="off"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Data de Validade *</label>
                          <input
                            type="date"
                            className="form-input"
                            value={boxData.validade}
                            onChange={e => setBoxData({ ...boxData, validade: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="mt-16 text-right">
                        <button type="submit" className="btn btn--primary btn--lg w-full">
                          <Check size={18} /> Salvar Caixa
                        </button>
                      </div>
                    </div>
                  )}
                </form>

                <div className="mt-24">
                  <h4 className="text-xs text-muted font-bold mb-8 uppercase tracking-wider">Histórico de Bipagem</h4>
                  <div style={{ maxHeight: 250, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    {caixasDoPalete.length === 0 ? (
                      <div className="text-center text-muted p-24 text-sm">Nenhuma caixa bipada ainda.</div>
                    ) : (
                      caixasDoPalete.map((c, i) => (
                        <div key={c.id} style={{ padding: '10px 12px', borderBottom: i < caixasDoPalete.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div className="font-bold text-sm" style={{ lineHeight: 1.2 }}>{c.produto_descricao}</div>
                            <div className="text-xs text-muted font-mono mt-4">{c.ean_caixa}</div>
                          </div>
                          <div className="text-right flex items-center gap-12">
                            <div>
                              <div className="font-bold text-cyan text-sm">{c.peso_kg} kg</div>
                              <div className="text-xs text-muted">Venc: {format(new Date(c.validade + 'T00:00:00'), 'dd/MM/yy')}</div>
                            </div>
                            <button className="btn btn--ghost text-danger p-4" onClick={() => handleRemoverCaixa(c)} title="Excluir caixa do palete"><Trash2 size={16}/></button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODO ANTIGO E HISTÓRICO... mantidos simplificados para foco no palete agora */}
      {activeTab === 'avulso' && (
        <div className="card text-center p-32 text-muted">
          <UploadCloud size={32} className="mb-16 mx-auto opacity-50" />
          <p>A interface de recebimento antigo está preservada no código, mas focamos a UI principal na Paletização SSCC.</p>
        </div>
      )}

      <CadastroEanModal 
        isOpen={modalEanOpen} 
        onClose={() => { setModalEanOpen(false); setTimeout(() => codigoRef.current?.focus(), 100); }} 
        codigoDesconhecido={eanDesconhecido} 
        onRegraSalva={(p) => {
          // EAN desconhecido foi vinculado: verifica se era genérico
          // Como veio do modal, a regra foi salva como CONTEM/EXATO
          // Usamos o EAN original como chave da caixa pois é o primeiro do lote
          setProdutoDetectado(p)
          setEanCaixaReal(eanDesconhecido)
          setEanEhUnico(true) // Primeira vez que esse EAN é cadastrado = trata como único
          setTimeout(() => document.getElementById('box-peso')?.focus(), 100)
        }} 
      />
    </div>
  )
}
