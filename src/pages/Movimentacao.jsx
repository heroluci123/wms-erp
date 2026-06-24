import React, { useState, useEffect } from 'react'
import { ArrowRight, MapPin, Box, Hash, AlertTriangle, Lightbulb } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { AlertModal } from '../components/shared/AlertModal'
import { format } from 'date-fns'

export function Movimentacao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  
  const [step, setStep] = useState(1) // 1: Origem, 2: Produto, 3: Qtd, 4: Destino
  const [origem, setOrigem] = useState('')
  const [produto, setProduto] = useState(null)
  const [saldoAtual, setSaldoAtual] = useState(null)
  const [saldoOpcoes, setSaldoOpcoes] = useState([]) // múltiplos lotes
  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [destino, setDestino] = useState('')

  // Sugestões Putaway
  const [sugestoes, setSugestoes] = useState([])

  const resetAll = () => {
    setStep(1)
    setOrigem('')
    setProduto(null)
    setSaldoAtual(null)
    setSaldoOpcoes([])
    setQtdCaixas('')
    setQtdKg('')
    setDestino('')
    setSugestoes([])
    setTimeout(() => document.getElementById('input-origem')?.focus(), 100)
  }

  // ── Scanners para cada etapa ──
  const scanOrigem = async (val) => {
    const end = val.toUpperCase()
    // Validar se endereço existe na tabela de locais (exceto REC e EXPEDICAO que são virtuais)
    if (end !== 'REC' && end !== 'EXPEDICAO') {
      const local = await window.wmsAPI.locais.buscar(end)
      if (!local) {
        return toastError('Endereço Inválido', `O endereço "${end}" não está cadastrado. Cadastre-o na tela de Locais.`)
      }
    }
    setOrigem(end)
    setStep(2)
    setTimeout(() => document.getElementById('input-produto')?.focus(), 100)
  }

  const scanProduto = async (val) => {
    try {
      const p = await window.wmsAPI.produtos.buscarPorCodigo(val)
      if (!p) return toastWarning('Aviso', 'Produto não cadastrado.')
      
      const saldos = await window.wmsAPI.estoque.buscarPorEnderecoProduto(origem, p.id)
      if (saldos.length === 0) {
        return toastError('Sem Saldo', `O produto não possui saldo em ${origem}`)
      }

      setProduto(p)

      if (saldos.length === 1) {
        // Apenas um lote: seleciona automaticamente
        const saldo = saldos[0]
        setSaldoAtual(saldo)
        if (origem === 'REC') {
          const puts = await window.wmsAPI.estoque.sugestaoPutaway(p.id, saldo.lote)
          setSugestoes(puts)
        }
        setStep(3)
        setTimeout(() => document.getElementById('input-caixas')?.focus(), 100)
      } else {
        // Múltiplos lotes: exibe lista para selecionar
        setSaldoOpcoes(saldos)
        setStep(2.5)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const selecionarLote = async (saldo) => {
    setSaldoAtual(saldo)
    setSaldoOpcoes([])
    if (origem === 'REC') {
      const puts = await window.wmsAPI.estoque.sugestaoPutaway(produto.id, saldo.lote)
      setSugestoes(puts)
    }
    setStep(3)
    setTimeout(() => document.getElementById('input-caixas')?.focus(), 100)
  }

  const handleQtdSubmit = (e) => {
    e.preventDefault()
    if (!qtdCaixas || !qtdKg) return toastWarning('Aviso', 'Preencha caixas e kg.')
    if (parseFloat(qtdCaixas) > saldoAtual.qtd_caixas || parseFloat(qtdKg) > saldoAtual.qtd_kg) {
      return toastError('Aviso', 'Quantidade excede o saldo disponível na origem.')
    }
    setStep(4)
    setTimeout(() => document.getElementById('input-destino')?.focus(), 100)
  }

  const scanDestino = async (val) => {
    const dst = val.toUpperCase()

    // ── TRAVA: Proibido mover para REC ou EXPEDICAO via Movimentação ──
    if (dst === 'REC' || dst === 'EXPEDICAO') {
      return toastError('Destino Proibido', `Não é permitido transferir para "${dst}" pela Movimentação. Use a tela de Recebimento ou Saída.`)
    }

    // ── TRAVA: Validar se o endereço de destino está cadastrado ──
    const localDst = await window.wmsAPI.locais.buscar(dst)
    if (!localDst) {
      return toastError('Endereço Inválido', `O endereço "${dst}" não está cadastrado. Cadastre-o na tela de Locais.`)
    }

    finalizarTransferencia(dst)
  }

  const finalizarTransferencia = async (dstFinal) => {
    try {
      const payload = {
        produto_id: produto.id,
        lote: saldoAtual.lote,
        validade: saldoAtual.validade,
        qtd_caixas: parseFloat(qtdCaixas),
        qtd_kg: parseFloat(qtdKg),
        origem: origem,
        destino: dstFinal,
        operador_id: operador.id,
        operador_nome: operador.nome
      }

      const res = await window.wmsAPI.movimentacoes.transferir(payload)
      if (res.success) {
        toastSuccess('Movimentação Concluída', `${produto.descricao} movido para ${dstFinal}`)
        resetAll()
      } else {
        toastError('Erro na Movimentação', res.error)
      }
    } catch (err) {
      toastError('Erro Fatal', err.message)
    }
  }

  // Bind keydown events
  const onKeyOrigem = (e) => { if(e.key === 'Enter') scanOrigem(e.target.value) }
  const onKeyProduto = (e) => { if(e.key === 'Enter') scanProduto(e.target.value) }
  const onKeyDestino = (e) => { if(e.key === 'Enter') scanDestino(e.target.value) }

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Movimentação Interna</h1>
          <p className="page-header__subtitle">Transferência entre posições físicas (endereços cadastrados). Proibido mover para REC ou EXPEDICAO.</p>
        </div>
        <button className="btn btn--ghost" onClick={resetAll}>Reiniciar Fluxo</button>
      </div>

      <div className="mov-flow">
        
        {/* STEP 1: ORIGEM */}
        <div className={`mov-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
          <div className="mov-step__header">
            <div className="mov-step__number">1</div>
            <div className="mov-step__label">Endereço Origem</div>
          </div>
          {step === 1 ? (
            <input id="input-origem" className="form-input form-input--scanner" placeholder="Bipar origem..." onKeyDown={onKeyOrigem} autoFocus />
          ) : (
            <div className="flex items-center gap-12 font-mono text-cyan" style={{ fontSize: 18, fontWeight: 700 }}>
              <MapPin size={20} /> {origem}
            </div>
          )}
        </div>

        {/* STEP 2.5: SELEÇÃO DE LOTE (múltiplos lotes) */}
        {step === 2.5 && (
          <div className="mov-step active">
            <div className="mov-step__header">
              <div className="mov-step__number">2</div>
              <div className="mov-step__label">Selecione o Lote / Validade</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Encontramos <strong>{saldoOpcoes.length} lotes</strong> de <strong>{produto?.descricao}</strong> em <strong>{origem}</strong>. Clique no lote desejado:
            </div>
            <div className="flex-col gap-8">
              {saldoOpcoes.map((s, i) => (
                <div key={i}
                  onClick={() => selecionarLote(s)}
                  style={{
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'border-color 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div>
                    <div className="font-bold text-primary" style={{ fontFamily: 'monospace' }}>
                      Lote: {s.lote || '(sem lote)'}
                    </div>
                    <div className="text-sm text-muted mt-2">
                      Val: {s.validade ? format(new Date(s.validade), 'dd/MM/yyyy') : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-success font-bold">{s.qtd_caixas} CX</div>
                    <div className="text-muted text-sm">{s.qtd_kg} KG</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 2: PRODUTO */}
        <div className={`mov-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`} style={{ opacity: step >= 2 ? 1 : 0.5 }}>
          <div className="mov-step__header">
            <div className="mov-step__number">2</div>
            <div className="mov-step__label">Material</div>
          </div>
          {step === 2 ? (
            <input id="input-produto" className="form-input form-input--scanner" placeholder="Bipar código do material..." onKeyDown={onKeyProduto} />
          ) : step > 2 ? (
            <div>
              <div className="flex items-center gap-12 font-mono text-cyan mb-8" style={{ fontSize: 18, fontWeight: 700 }}>
                <Box size={20} /> {produto?.codigo}
              </div>
              <div className="saldo-display">
                <div className="saldo-item" style={{ flex: 1 }}>
                  <div className="saldo-item__label">Material / Lote</div>
                  <div style={{ color: 'white', fontWeight: 600 }}>{produto?.descricao}</div>
                  <div className="text-muted text-sm mt-4">Lote: {saldoAtual?.lote} | Validade: {saldoAtual?.validade ? format(new Date(saldoAtual.validade), 'dd/MM/yyyy') : '-'}</div>
                </div>
                <div className="saldo-item text-right">
                  <div className="saldo-item__label">Disponível Caixas</div>
                  <div className="saldo-item__value">{saldoAtual?.qtd_caixas}</div>
                </div>
                <div className="saldo-item text-right">
                  <div className="saldo-item__label">Disponível KG</div>
                  <div className="saldo-item__value" style={{ color: 'var(--text-primary)' }}>{saldoAtual?.qtd_kg}</div>
                </div>
              </div>

              {/* PUTAWAY SUGGESTION */}
              {sugestoes.length > 0 && origem === 'REC' && (
                <div className="putaway-sugestao">
                  <div className="putaway-sugestao__title flex items-center gap-8"><Lightbulb size={14}/> Sugestão de Armazenagem</div>
                  <div className="text-sm text-muted mb-8">Este produto já possui saldo ativo nos seguintes locais:</div>
                  {sugestoes.slice(0,3).map((s, idx) => (
                    <div key={idx} className="putaway-sugestao__item">
                      <strong>{s.endereco}</strong> — {s.qtd_caixas} cx (Lote: {s.lote})
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* STEP 3: QUANTIDADE */}
        <div className={`mov-step ${step === 3 ? 'active' : step > 3 ? 'completed' : ''}`} style={{ opacity: step >= 3 ? 1 : 0.5 }}>
          <div className="mov-step__header">
            <div className="mov-step__number">3</div>
            <div className="mov-step__label">Quantidade a Mover</div>
          </div>
          {step === 3 ? (
            <form onSubmit={handleQtdSubmit} className="flex gap-16 items-end">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Caixas</label>
                <input id="input-caixas" type="number" step="0.01" className="form-input form-input--number" value={qtdCaixas} onChange={e => setQtdCaixas(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">KG</label>
                <input type="number" step="0.01" className="form-input form-input--number" value={qtdKg} onChange={e => setQtdKg(e.target.value)} />
              </div>
              <button type="submit" className="btn btn--primary btn--lg">Confirmar</button>
            </form>
          ) : step > 3 ? (
            <div className="flex items-center gap-12 font-mono text-cyan" style={{ fontSize: 18, fontWeight: 700 }}>
              <Hash size={20} /> {qtdCaixas} Caixas / {qtdKg} KG
            </div>
          ) : null}
        </div>

        {/* STEP 4: DESTINO */}
        <div className={`mov-step ${step === 4 ? 'active' : step > 4 ? 'completed' : ''}`} style={{ opacity: step >= 4 ? 1 : 0.5 }}>
          <div className="mov-step__header">
            <div className="mov-step__number">4</div>
            <div className="mov-step__label">Endereço Destino</div>
          </div>
          {step === 4 ? (
            <input id="input-destino" className="form-input form-input--scanner" placeholder="Bipar destino (somente endereços cadastrados)..." onKeyDown={onKeyDestino} />
          ) : step > 4 ? (
            <div className="flex items-center gap-12 font-mono text-success" style={{ fontSize: 18, fontWeight: 700 }}>
              <MapPin size={20} /> {destino}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
