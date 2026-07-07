import React, { useState, useEffect, useRef } from 'react'
import { Truck, Factory, RotateCcw, Check, X, Plus, Trash2, Loader, Package, ClipboardList, ScanBarcode, Scissors, AlertTriangle, ChevronRight, PackageOpen, MapPin, Hash } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'
import * as locaisQueries from '../queries/locais.js'
import * as produtosQueries from '../queries/produtos.js'
import * as estoqueQueries from '../queries/estoque.js'
import * as movimentacoesQueries from '../queries/movimentacoes.js'
import { db } from '../lib/db.js'
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// ABA 1: MONTAR ROMANEIO DE SAÍDA (igual ao Recebimento mas para saída)
// ─────────────────────────────────────────────────────────────────────────────
function MontarRomaneio({ onRomaneioFechado }) {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()

  // Romaneio em montagem (persistido em localStorage enquanto não fechado)
  const [romaneio, setRomaneio] = useState(null) // { cliente, dataEntrega, codigo }
  const [formRomaneio, setFormRomaneio] = useState({ cliente: '', dataEntrega: '' })
  const [caixasDoRomaneio, setCaixasDoRomaneio] = useState([])

  // Estado da bipagem
  const [eanBipado, setEanBipado] = useState('')
  const [caixaEncontrada, setCaixaEncontrada] = useState(null)
  const [pesoSaida, setPesoSaida] = useState('')
  const [eanResto, setEanResto] = useState('')
  const [stepBipagem, setStepBipagem] = useState('SCAN') // SCAN | CONFIRMAR | PARCIAL_EAN
  const [salvandoCaixa, setSalvandoCaixa] = useState(false)

  const resetBipagem = () => {
    setEanBipado('')
    setCaixaEncontrada(null)
    setPesoSaida('')
    setEanResto('')
    setStepBipagem('SCAN')
    setSalvandoCaixa(false)
    setTimeout(() => eanRef.current?.focus(), 100)
  }

  const { inputRef: eanRef, handleKeyDown: handleEanKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      if (stepBipagem === 'PARCIAL_EAN') {
        setEanResto(val)
        return
      }
      setEanBipado(val)
      setCaixaEncontrada(null)
      setPesoSaida('')
      setEanResto('')

      try {
        const res = await movimentacoesQueries.identificarCodigoMovimentacao(val.toUpperCase().trim())
        if (res.tipo === 'CAIXA') {
          const cx = res.dados
          // Verificar se já está no romaneio
          if (caixasDoRomaneio.find(c => c.eanOriginal === val)) {
            return toastWarning('Já adicionada', 'Esta caixa já está no romaneio atual.')
          }
          setCaixaEncontrada(cx)
          setPesoSaida(String(cx.peso_kg))
          setStepBipagem('CONFIRMAR')
          setTimeout(() => document.getElementById('rom-peso')?.select(), 120)
        } else {
          toastError('Caixa não encontrada', 'Este EAN não está em estoque. Receba a caixa primeiro.')
        }
      } catch (err) {
        toastError('Erro', err.message)
      }
    }
  })

  const pesoSaidaNum = parseFloat(pesoSaida) || 0
  const pesoCaixaNum = caixaEncontrada ? parseFloat(caixaEncontrada.peso_kg) : 0
  const isParcial = pesoSaidaNum > 0 && Math.abs(pesoSaidaNum - pesoCaixaNum) >= 0.05
  const pesoResto = isParcial ? parseFloat((pesoCaixaNum - pesoSaidaNum).toFixed(3)) : 0

  const handleConfirmarCaixa = () => {
    if (!caixaEncontrada) return
    if (pesoSaidaNum <= 0 || pesoSaidaNum > pesoCaixaNum + 0.001) {
      return toastError('Peso Inválido', `Peso deve ser entre 0.001 e ${pesoCaixaNum} kg.`)
    }
    if (isParcial && !eanResto.trim()) {
      setStepBipagem('PARCIAL_EAN')
      toastWarning('Bipe o EAN Restante', `Saída parcial: bipe a etiqueta da caixa que vai ficar (${pesoResto} kg).`)
      setTimeout(() => eanRef.current?.focus(), 100)
      return
    }
    // Adicionar ao romaneio local
    setCaixasDoRomaneio(prev => [...prev, {
      id: caixaEncontrada.id,
      eanOriginal: String(caixaEncontrada.ean_caixa),
      eanResto: isParcial ? eanResto.trim() : null,
      produto_descricao: caixaEncontrada.produto_descricao,
      produto_id: caixaEncontrada.produto_id,
      origem: caixaEncontrada.endereco || 'REC',
      validade: caixaEncontrada.validade,
      pesoCaixa: pesoCaixaNum,
      pesoSaida: pesoSaidaNum,
      isParcial
    }])
    toastSuccess('Caixa Adicionada', `${caixaEncontrada.produto_descricao} — ${pesoSaidaNum} kg`)
    resetBipagem()
  }

  const removerCaixa = (idx) => setCaixasDoRomaneio(prev => prev.filter((_, i) => i !== idx))

  const handleAbrirRomaneio = () => {
    if (!formRomaneio.cliente.trim()) return toastError('Atenção', 'Informe o cliente/destino.')
    const codigo = `ROM-${Date.now().toString(36).toUpperCase()}`
    setRomaneio({ ...formRomaneio, codigo })
    setTimeout(() => eanRef.current?.focus(), 200)
  }

  const handleFecharRomaneio = async () => {
    if (caixasDoRomaneio.length === 0) return toastError('Atenção', 'Adicione pelo menos uma caixa ao romaneio.')
    if (!window.confirm(`Fechar o romaneio ${romaneio.codigo} com ${caixasDoRomaneio.length} caixa(s)?`)) return

    setSalvandoCaixa(true)
    try {
      for (const cx of caixasDoRomaneio) {
        const res = await movimentacoesQueries.saidaPorCaixaSSCC({
          caixa_id: cx.id,
          peso_saida_kg: cx.pesoSaida,
          num_pedido: romaneio.codigo,
          cliente: romaneio.cliente,
          operador_id: operador?.id,
          operador_nome: operador?.nome,
          ean_caixa_resto: cx.isParcial ? cx.eanResto : null
        })
        if (!res.success) {
          toastError('Erro em caixa', `${cx.produto_descricao}: ${res.error}`)
          setSalvandoCaixa(false)
          return
        }
      }
      toastSuccess('Romaneio Fechado! ✅', `${romaneio.codigo} — ${caixasDoRomaneio.length} caixas expedidas para ${romaneio.cliente}`)
      setRomaneio(null)
      setCaixasDoRomaneio([])
      setFormRomaneio({ cliente: '', dataEntrega: '' })
      onRomaneioFechado?.()
    } catch (err) {
      toastError('Erro Fatal', err.message)
    } finally {
      setSalvandoCaixa(false)
    }
  }

  const totalKg = caixasDoRomaneio.reduce((s, c) => s + c.pesoSaida, 0).toFixed(3)

  // ── TELA: Criar Romaneio ──
  if (!romaneio) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div className="card">
          <h3 className="font-bold text-primary flex items-center gap-8 mb-20"><ClipboardList size={20}/> Novo Romaneio de Saída</h3>
          <div className="form-group mb-16">
            <label className="form-label">Cliente / Destino *</label>
            <input
              type="text"
              className="form-input"
              placeholder="Nome do cliente ou destino..."
              value={formRomaneio.cliente}
              onChange={e => setFormRomaneio(p => ({ ...p, cliente: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAbrirRomaneio()}
              autoFocus
            />
          </div>
          <div className="form-group mb-20">
            <label className="form-label">Data de Entrega</label>
            <input
              type="date"
              className="form-input"
              value={formRomaneio.dataEntrega}
              onChange={e => setFormRomaneio(p => ({ ...p, dataEntrega: e.target.value }))}
            />
          </div>
          <button className="btn btn--primary btn--lg w-full" onClick={handleAbrirRomaneio}>
            <Plus size={18}/> Abrir Romaneio
          </button>
        </div>
      </div>
    )
  }

  // ── TELA: Bipagem das caixas ──
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start', maxWidth: 1000 }}>

      {/* COLUNA ESQUERDA: Resumo do Romaneio */}
      <div className="card">
        <div className="flex justify-between items-center mb-16">
          <div>
            <div className="text-xs text-muted font-bold uppercase mb-2">Romaneio em Montagem</div>
            <div className="font-bold text-primary" style={{ fontSize: 16 }}>{romaneio.codigo}</div>
            <div className="text-sm text-muted">{romaneio.cliente}</div>
            {romaneio.dataEntrega && <div className="text-xs text-muted">Entrega: {new Date(romaneio.dataEntrega + 'T00:00:00').toLocaleDateString('pt-BR')}</div>}
          </div>
          <button className="btn btn--ghost btn--sm text-muted" onClick={() => { if (window.confirm('Descartar romaneio?')) { setRomaneio(null); setCaixasDoRomaneio([]) } }}>
            <X size={14}/> Descartar
          </button>
        </div>

        {/* Totalizador */}
        <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }} className="flex gap-20 text-sm">
          <div>Caixas: <strong className="text-primary">{caixasDoRomaneio.length}</strong></div>
          <div>Total KG: <strong className="text-cyan">{totalKg}</strong></div>
        </div>

        {/* Lista de caixas */}
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {caixasDoRomaneio.length === 0 ? (
            <div className="text-center text-muted p-20 text-sm">Bipe as caixas à direita →</div>
          ) : (
            caixasDoRomaneio.map((c, i) => (
              <div key={i} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="font-bold text-sm">{c.produto_descricao}</div>
                  <div className="text-xs text-muted font-mono">{c.eanOriginal.slice(-8)}</div>
                  {c.isParcial && <div className="text-xs text-warning">✂️ parcial — resto: {c.pesoResto} kg</div>}
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-right">
                    <div className="font-bold text-cyan text-sm">{c.pesoSaida} kg</div>
                    {c.validade && <div className="text-xs text-muted">{new Date(c.validade + 'T00:00:00').toLocaleDateString('pt-BR')}</div>}
                  </div>
                  <button className="btn btn--ghost text-danger p-4" onClick={() => removerCaixa(i)}><Trash2 size={14}/></button>
                </div>
              </div>
            ))
          )}
        </div>

        {caixasDoRomaneio.length > 0 && (
          <button
            className="btn btn--primary btn--lg w-full mt-16"
            onClick={handleFecharRomaneio}
            disabled={salvandoCaixa}
          >
            {salvandoCaixa ? <Loader size={18} className="animate-spin"/> : <Check size={18}/>}
            Fechar Romaneio ({caixasDoRomaneio.length} cx · {totalKg} kg)
          </button>
        )}
      </div>

      {/* COLUNA DIREITA: Bipagem */}
      <div className="card">
        <h3 className="font-bold text-warning flex items-center gap-8 mb-16"><ScanBarcode size={18}/> Bipar Caixa</h3>

        {/* Input de scan */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            ref={eanRef}
            type="text"
            className="form-input form-input--scanner"
            placeholder="Bipe o EAN da caixa..."
            value={eanBipado}
            onChange={e => setEanBipado(e.target.value)}
            onKeyDown={handleEanKeyDown}
          />
          {eanBipado && (
            <button type="button" className="btn btn--ghost text-muted" onClick={resetBipagem}><X size={16}/></button>
          )}
        </div>

        {/* Card da caixa encontrada */}
        {caixaEncontrada && stepBipagem !== 'SCAN' && (
          <div>
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--primary)', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div className="text-xs text-muted font-bold mb-2 uppercase">✅ Caixa em Estoque</div>
              <div className="font-bold" style={{ fontSize: 15 }}>{caixaEncontrada.produto_descricao}</div>
              <div className="flex gap-16 text-sm mt-6">
                <div>📦 <strong>{caixaEncontrada.peso_kg} kg</strong></div>
                {caixaEncontrada.validade && <div>📅 <strong>{new Date(caixaEncontrada.validade + 'T00:00:00').toLocaleDateString('pt-BR')}</strong></div>}
                <div className="text-muted font-mono" style={{ fontSize: 11 }}>{caixaEncontrada.endereco}</div>
              </div>
            </div>

            {/* PARCIAL_EAN: aguarda bipe do restante */}
            {stepBipagem === 'PARCIAL_EAN' && (
              <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid var(--warning)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div className="flex items-center gap-8 font-bold text-warning mb-8"><Scissors size={15}/> Bipe a etiqueta da caixa restante</div>
                <div className="text-sm text-muted mb-10">
                  Saindo: <strong>{pesoSaidaNum} kg</strong> → Fica: <strong>{pesoResto} kg</strong><br/>
                  A sobra precisará de uma etiqueta nova.
                </div>
                <input
                  ref={eanRef}
                  type="text"
                  className="form-input form-input--scanner"
                  placeholder="Bipe a etiqueta da caixa restante..."
                  value={eanResto}
                  onChange={e => setEanResto(e.target.value)}
                  onKeyDown={handleEanKeyDown}
                  autoFocus
                />
                {eanResto && (
                  <>
                    <div className="text-success text-sm mt-6">✅ EAN capturado: <strong className="font-mono">{eanResto}</strong></div>
                    <button className="btn btn--primary w-full mt-10" onClick={handleConfirmarCaixa}>
                      <Check size={16}/> Confirmar Saída Parcial
                    </button>
                  </>
                )}
              </div>
            )}

            {/* CONFIRMAR: editar peso e confirmar */}
            {stepBipagem === 'CONFIRMAR' && (
              <div>
                <div className="form-group mb-12">
                  <label className="form-label">Peso da Saída (kg) *</label>
                  <input
                    id="rom-peso"
                    type="number"
                    step="0.001"
                    min="0.001"
                    max={pesoCaixaNum}
                    className="form-input form-input--number"
                    value={pesoSaida}
                    onChange={e => setPesoSaida(e.target.value)}
                  />
                  {isParcial && (
                    <div className="text-warning text-xs mt-4 flex items-center gap-4">
                      <Scissors size={11}/> Saída parcial — fica: <strong>{pesoResto} kg</strong>
                    </div>
                  )}
                </div>
                {isParcial && (
                  <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }} className="text-sm text-warning">
                    <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }}/>
                    Saída parcial: você bipará a etiqueta da caixa restante ({pesoResto} kg) no próximo passo.
                  </div>
                )}
                <div className="flex gap-8">
                  <button className="btn btn--ghost" onClick={resetBipagem}><X size={16}/> Cancelar</button>
                  <button className="btn btn--primary flex-1" onClick={handleConfirmarCaixa}>
                    <Plus size={16}/> {isParcial ? `Adicionar (${pesoSaidaNum} kg)` : 'Adicionar ao Romaneio'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ABA 2: EXPEDIÇÃO — histórico de romaneios expedidos (via log)
// ─────────────────────────────────────────────────────────────────────────────
function Expedicao({ refresh }) {
  const [romaneios, setRomaneios] = useState([])
  const [loading, setLoading] = useState(false)

  const carregar = async () => {
    setLoading(true)
    try {
      const res = await db.execute(`
        SELECT num_pedido as codigo, cliente, count(*) as qtd_caixas, sum(qtd_kg) as total_kg, max(data_hora) as ultima_hora
        FROM movimentacoes_log
        WHERE tipo = 'DESPACHO' AND num_pedido LIKE 'ROM-%'
        GROUP BY num_pedido, cliente
        ORDER BY ultima_hora DESC
        LIMIT 50
      `)
      setRomaneios(res.rows)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregar() }, [refresh])

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }} className="text-sm text-muted">
        📋 Histórico de romaneios de saída já expedidos (fechados).
      </div>
      {loading ? (
        <div className="text-center p-24 text-muted"><Loader size={24}/></div>
      ) : romaneios.length === 0 ? (
        <div className="card text-center p-32 text-muted">
          <ClipboardList size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }}/>
          <div>Nenhum romaneio expedido ainda.</div>
        </div>
      ) : (
        <div className="flex-col gap-10">
          {romaneios.map((r, i) => (
            <div key={i} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="font-bold text-primary font-mono">{r.codigo}</div>
                <div className="text-sm">{r.cliente || '—'}</div>
                <div className="text-xs text-muted mt-2">{r.ultima_hora ? format(new Date(r.ultima_hora), 'dd/MM/yyyy HH:mm') : ''}</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-cyan">{parseFloat(r.total_kg || 0).toFixed(3)} kg</div>
                <div className="text-sm text-muted">{r.qtd_caixas} caixa(s)</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ABA 3: ENVIO P/ PRODUÇÃO — bipa SSCC, auto-preenche tudo
// ─────────────────────────────────────────────────────────────────────────────
function EnvioProducao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const [step, setStep] = useState('SCAN') // SCAN | CONFIRMAR
  const [eanBipado, setEanBipado] = useState('')
  const [caixaEncontrada, setCaixaEncontrada] = useState(null)
  const [pesoEnvio, setPesoEnvio] = useState('')
  const [salvando, setSalvando] = useState(false)

  const reset = () => {
    setStep('SCAN'); setEanBipado(''); setCaixaEncontrada(null); setPesoEnvio(''); setSalvando(false)
    setTimeout(() => eanRef.current?.focus(), 100)
  }

  const { inputRef: eanRef, handleKeyDown: handleEanKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      setEanBipado(val)
      setCaixaEncontrada(null)
      try {
        const res = await movimentacoesQueries.identificarCodigoMovimentacao(val.toUpperCase().trim())
        if (res.tipo === 'CAIXA') {
          setCaixaEncontrada(res.dados)
          setPesoEnvio(String(res.dados.peso_kg))
          setStep('CONFIRMAR')
          setTimeout(() => document.getElementById('prod-peso')?.select(), 120)
        } else {
          toastError('Caixa não encontrada', 'Este EAN não está em estoque disponível.')
        }
      } catch (err) { toastError('Erro', err.message) }
    }
  })

  const confirmarEnvio = async () => {
    if (!caixaEncontrada) return
    const kg = parseFloat(pesoEnvio)
    if (!kg || kg <= 0) return toastError('Peso Inválido', 'Informe um peso válido.')
    setSalvando(true)
    try {
      // Baixa a caixa do estoque e cria ordem de produção
      const origem = caixaEncontrada.endereco || 'REC'
      await movimentacoesQueries.abrirOrdemProducao({
        produto_id: caixaEncontrada.produto_id,
        lote: '',
        validade: caixaEncontrada.validade,
        qtd_caixas: 1,
        qtd_kg: kg,
        origem,
        operador_id: operador?.id,
        operador_nome: operador?.nome
      })
      // Marcar a caixa como consumida
      await db.execute({
        sql: `UPDATE estoque_caixas SET status = 'PRODUCAO', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [caixaEncontrada.id]
      })
      toastSuccess('Enviado à Produção! 🏭', `${caixaEncontrada.produto_descricao} — ${kg} kg. Ordem criada.`)
      reset()
    } catch (err) {
      toastError('Erro Fatal', err.message)
      setSalvando(false)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid #8b5cf6', borderRadius: 10, padding: '10px 16px', marginBottom: 16 }} className="text-sm">
        <span style={{ color: '#8b5cf6' }}>💡</span> Bipe o EAN da caixa. O sistema identifica o produto e a origem automaticamente.
      </div>

      <div className="card mb-16">
        <h3 className="font-bold flex items-center gap-8 mb-14" style={{ color: '#8b5cf6' }}><ScanBarcode size={18}/> Bipar Caixa para Produção</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={eanRef}
            type="text"
            className="form-input form-input--scanner"
            placeholder="Bipe o EAN da caixa..."
            value={eanBipado}
            onChange={e => setEanBipado(e.target.value)}
            onKeyDown={handleEanKeyDown}
          />
          {eanBipado && <button className="btn btn--ghost text-muted" onClick={reset}><X size={16}/></button>}
        </div>
      </div>

      {caixaEncontrada && step === 'CONFIRMAR' && (
        <div className="card">
          <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid #8b5cf6', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
            <div className="text-xs font-bold mb-2 uppercase" style={{ color: '#8b5cf6' }}>✅ Caixa Identificada</div>
            <div className="font-bold" style={{ fontSize: 15 }}>{caixaEncontrada.produto_descricao}</div>
            <div className="flex gap-16 text-sm mt-6">
              <div>📦 <strong>{caixaEncontrada.peso_kg} kg</strong></div>
              <div>📍 <strong>{caixaEncontrada.endereco || 'REC'}</strong></div>
              {caixaEncontrada.validade && <div>📅 <strong>{new Date(caixaEncontrada.validade + 'T00:00:00').toLocaleDateString('pt-BR')}</strong></div>}
            </div>
          </div>
          <div className="form-group mb-14">
            <label className="form-label">Peso a Enviar (kg) *</label>
            <input
              id="prod-peso"
              type="number"
              step="0.001"
              className="form-input form-input--number"
              value={pesoEnvio}
              onChange={e => setPesoEnvio(e.target.value)}
            />
          </div>
          <div className="flex gap-8">
            <button className="btn btn--ghost" onClick={reset}><X size={16}/> Cancelar</button>
            <button className="btn flex-1 btn--lg" style={{ background: '#8b5cf6', color: 'white' }} onClick={confirmarEnvio} disabled={salvando}>
              {salvando ? <Loader size={16} className="animate-spin"/> : <Factory size={16}/>} Enviar à Produção
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ABA 4: RETORNO DE PRODUÇÃO (mantida igual)
// ─────────────────────────────────────────────────────────────────────────────
function RetornoProducao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const [ordens, setOrdens] = useState([])
  const [ordemSelecionada, setOrdemSelecionada] = useState(null)
  const [subprodutos, setSubprodutos] = useState([])
  const [pesoTotalRetornado, setPesoTotalRetornado] = useState(0)
  const [loading, setLoading] = useState(false)
  const [scanEan, setScanEan] = useState('')
  const [produtoAtual, setProdutoAtual] = useState(null)
  const [subQtdCx, setSubQtdCx] = useState('')
  const [subQtdKg, setSubQtdKg] = useState('')
  const [subLote, setSubLote] = useState('')
  const [subValidade, setSubValidade] = useState('')
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')
  const scanRef = useRef(null)

  useEffect(() => { carregarOrdens() }, [])
  useEffect(() => { setPesoTotalRetornado(subprodutos.reduce((a, s) => a + parseFloat(s.qtd_kg || 0), 0)) }, [subprodutos])

  const carregarOrdens = async () => {
    setLoading(true)
    try { const data = await movimentacoesQueries.listarOrdensProducao('ABERTA'); setOrdens(data) }
    catch (e) { toastError('Erro', 'Falha ao carregar ordens.') }
    finally { setLoading(false) }
  }

  const handleScanEan = async (val) => {
    setScanEan('')
    const p = await produtosQueries.buscarPorCodigo(val)
    if (!p) { setEanDesconhecido(val); setModalEanOpen(true); return }
    setProdutoAtual(p)
    setTimeout(() => document.getElementById('ret-cx')?.focus(), 100)
  }

  const adicionarSubproduto = () => {
    if (!produtoAtual || !subQtdKg) return toastWarning('Atenção', 'Preencha o produto e o peso.')
    setSubprodutos(prev => [...prev, { produto: produtoAtual, qtd_caixas: parseFloat(subQtdCx || 0), qtd_kg: parseFloat(subQtdKg), lote: subLote || '', validade: subValidade || '' }])
    setProdutoAtual(null); setSubQtdCx(''); setSubQtdKg(''); setSubLote(''); setSubValidade('')
    setTimeout(() => scanRef.current?.focus(), 100)
  }

  const fecharOrdem = async () => {
    if (subprodutos.length === 0) return toastWarning('Atenção', 'Adicione pelo menos um subproduto.')
    try {
      for (const sub of subprodutos) {
        await movimentacoesQueries.receber({ produto_id: sub.produto.id, lote: sub.lote, validade: sub.validade, qtd_caixas: sub.qtd_caixas, qtd_kg: sub.qtd_kg, operador_id: operador.id, operador_nome: operador.nome })
      }
      const res = await movimentacoesQueries.fecharOrdemProducao({ ordem_id: ordemSelecionada.id, peso_retornado: pesoTotalRetornado })
      if (res.success) {
        const rendimento = ((pesoTotalRetornado / ordemSelecionada.peso_enviado) * 100).toFixed(1)
        toastSuccess('Ordem Concluída! ✅', `Rendimento: ${rendimento}% | Perda: ${(ordemSelecionada.peso_enviado - pesoTotalRetornado).toFixed(3)} kg`)
        setOrdemSelecionada(null); setSubprodutos([]); setPesoTotalRetornado(0); carregarOrdens()
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro Fatal', err.message) }
  }

  if (!ordemSelecionada) return (
    <div style={{ maxWidth: 700 }}>
      {loading ? <div className="text-center p-24"><Loader size={24}/></div> : ordens.length === 0 ? (
        <div className="card text-center p-32">
          <PackageOpen size={48} style={{ margin: '0 auto 16px', color: 'var(--text-muted)' }} />
          <div className="text-muted">Nenhuma Ordem de Produção aberta.</div>
        </div>
      ) : (
        <div className="flex-col gap-12">
          {ordens.map(o => (
            <div key={o.id} onClick={() => setOrdemSelecionada(o)}
              style={{ background: 'var(--bg-2)', border: '2px solid var(--border)', borderRadius: 12, padding: '16px 20px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#8b5cf6'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div className="flex justify-between items-start">
                <div>
                  <div style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 600 }}>ORDEM #{o.id}</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{o.produto_descricao}</div>
                  <div className="text-sm text-muted mt-4">Aberta: {format(new Date(o.data_inicio), 'dd/MM/yyyy HH:mm')}</div>
                </div>
                <div className="text-right">
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#8b5cf6' }}>{parseFloat(o.peso_enviado).toFixed(3)} kg</div>
                  <div className="text-sm text-muted">enviados</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const perda = parseFloat(ordemSelecionada.peso_enviado) - pesoTotalRetornado
  const rendimento = ordemSelecionada.peso_enviado > 0 ? ((pesoTotalRetornado / ordemSelecionada.peso_enviado) * 100).toFixed(1) : 0

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ background: 'rgba(139,92,246,0.1)', border: '2px solid #8b5cf6', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div className="flex justify-between items-start">
          <div>
            <div style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 700 }}>ORDEM #{ordemSelecionada.id}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{ordemSelecionada.produto_descricao}</div>
            <div className="text-muted text-sm mt-4">Enviado: <strong style={{ color: '#8b5cf6' }}>{parseFloat(ordemSelecionada.peso_enviado).toFixed(3)} kg</strong></div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => { setOrdemSelecionada(null); setSubprodutos([]) }}><X size={16}/> Voltar</button>
        </div>
      </div>

      <div className="card mb-20" style={{ background: 'var(--bg-2)' }}>
        <div className="flex justify-between mb-8">
          <div><span className="text-sm text-muted">Retornado:</span> <strong style={{ color: 'var(--success)' }}>{pesoTotalRetornado.toFixed(3)} kg</strong></div>
          <div><span className="text-sm text-muted">Perda:</span> <strong style={{ color: perda < 0 ? 'var(--danger)' : 'var(--warning)' }}>{perda.toFixed(3)} kg</strong></div>
          <div><span className="text-sm text-muted">Rendimento:</span> <strong style={{ color: rendimento >= 80 ? 'var(--success)' : 'var(--warning)' }}>{rendimento}%</strong></div>
        </div>
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, rendimento)}%`, background: rendimento >= 80 ? 'var(--success)' : 'var(--warning)', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
      </div>

      {subprodutos.length > 0 && (
        <div className="card mb-20">
          <h4 className="font-bold mb-12">Subprodutos ({subprodutos.length})</h4>
          {subprodutos.map((s, i) => (
            <div key={i} className="flex justify-between items-center py-8" style={{ borderBottom: '1px solid var(--border)' }}>
              <div><div className="font-bold text-sm">{s.produto.descricao}</div><div className="text-xs text-muted">Lote: {s.lote || '-'} | Val: {s.validade || '-'}</div></div>
              <div className="flex items-center gap-16">
                <div className="text-right"><div className="font-bold text-success">{s.qtd_kg} kg</div><div className="text-xs text-muted">{s.qtd_caixas} cx</div></div>
                <button className="btn btn--ghost btn--sm text-danger" onClick={() => setSubprodutos(prev => prev.filter((_, ii) => ii !== i))}><X size={14}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-20">
        <h4 className="font-bold mb-14">➕ Adicionar Subproduto</h4>
        <div className="form-group mb-10">
          <input ref={scanRef} type="text" className="form-input form-input--scanner" placeholder="Bipar EAN do subproduto..." value={scanEan}
            onChange={e => setScanEan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleScanEan(e.target.value) }} autoFocus />
          {produtoAtual && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 8, color: 'var(--success)', fontWeight: 600 }}>✅ {produtoAtual.descricao}</div>}
        </div>
        {produtoAtual && (
          <>
            <div className="form-grid form-grid--2 mb-10">
              <div className="form-group"><label className="form-label">Caixas</label><input id="ret-cx" type="number" step="0.01" className="form-input form-input--number" value={subQtdCx} onChange={e => setSubQtdCx(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">KG *</label><input type="number" step="0.001" className="form-input form-input--number" value={subQtdKg} onChange={e => setSubQtdKg(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">Lote</label><input type="text" className="form-input" value={subLote} onChange={e => setSubLote(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">Validade</label><input type="date" className="form-input" value={subValidade} onChange={e => setSubValidade(e.target.value)}/></div>
            </div>
            <button className="btn btn--primary w-full" onClick={adicionarSubproduto}><Check size={16}/> Adicionar Subproduto</button>
          </>
        )}
      </div>

      {subprodutos.length > 0 && (
        <div style={{ background: 'rgba(139,92,246,0.1)', border: '2px solid #8b5cf6', borderRadius: 12, padding: 20 }}>
          <button className="btn btn--lg w-full" style={{ background: '#8b5cf6', color: 'white' }} onClick={fecharOrdem}>
            <Check size={20}/> Fechar Ordem e Calcular Rendimento ({rendimento}%)
          </button>
        </div>
      )}

      <CadastroEanModal isOpen={modalEanOpen} onClose={() => { setModalEanOpen(false); setTimeout(() => scanRef.current?.focus(), 100) }}
        codigoDesconhecido={eanDesconhecido} onRegraSalva={(p) => { setProdutoAtual(p); setTimeout(() => document.getElementById('ret-cx')?.focus(), 100) }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export function Saida() {
  const [activeTab, setActiveTab] = useState('romaneio')
  const [refreshExpedicao, setRefreshExpedicao] = useState(0)

  const tabs = [
    { id: 'romaneio', label: 'Montar Romaneio', icon: <ClipboardList size={16}/>, color: 'var(--cyan)' },
    { id: 'expedicao', label: 'Expedição', icon: <Truck size={16}/>, color: 'var(--warning)' },
    { id: 'producao', label: 'Envio p/ Produção', icon: <Factory size={16}/>, color: '#8b5cf6' },
    { id: 'retorno', label: 'Retorno de Produção', icon: <RotateCcw size={16}/>, color: 'var(--success)' },
  ]

  return (
    <div style={{ maxWidth: 1040 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12"><Truck size={28}/> Saída de Materiais</h1>
          <p className="page-header__subtitle">Romaneios de expedição, produção e controle de rendimento</p>
        </div>
      </div>

      <div className="flex gap-8 mb-24" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0, flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`btn flex items-center gap-8 ${activeTab === tab.id ? 'btn--primary' : 'btn--ghost'}`}
            style={activeTab === tab.id ? { background: tab.color, borderColor: tab.color, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'romaneio' && <MontarRomaneio onRomaneioFechado={() => setRefreshExpedicao(r => r + 1)} />}
      {activeTab === 'expedicao' && <Expedicao refresh={refreshExpedicao} />}
      {activeTab === 'producao' && <EnvioProducao />}
      {activeTab === 'retorno' && <RetornoProducao />}
    </div>
  )
}
