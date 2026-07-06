import React, { useState, useEffect, useRef } from 'react'
import { Truck, Factory, RotateCcw, MapPin, Box, Hash, Check, ArrowRight, PackageOpen, ChevronDown, Loader, X } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { format } from 'date-fns'
import * as locaisQueries from '../queries/locais.js'
import * as produtosQueries from '../queries/produtos.js'
import * as estoqueQueries from '../queries/estoque.js'
import * as movimentacoesQueries from '../queries/movimentacoes.js'
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx'

// ────────────────────────────────────────────────────────────────────────────
// ABA 1: SAÍDA P/ EXPEDIÇÃO (fluxo original)
// ────────────────────────────────────────────────────────────────────────────
function SaidaExpedicao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()

  const [step, setStep] = useState(1)
  const [origem, setOrigem] = useState('')
  const [produto, setProduto] = useState(null)
  const [saldoAtual, setSaldoAtual] = useState(null)
  const [saldoOpcoes, setSaldoOpcoes] = useState([])
  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [fefoAlert, setFefoAlert] = useState(null)
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  const resetAll = () => {
    setStep(1); setOrigem(''); setProduto(null)
    setSaldoAtual(null); setSaldoOpcoes([]); setQtdCaixas(''); setQtdKg('')
    setTimeout(() => document.getElementById('exp-origem')?.focus(), 100)
  }

  const scanOrigem = async (val) => {
    const end = val.toUpperCase()
    if (end === 'REC' || end === 'EXPEDICAO') return toastError('Endereço Inválido', `Não é possível fazer saída a partir de "${end}".`)
    const local = await locaisQueries.buscarPorEndereco(end)
    if (!local) return toastError('Endereço Inválido', `O endereço "${end}" não está cadastrado.`)
    setOrigem(end); setStep(2)
    setTimeout(() => document.getElementById('exp-produto')?.focus(), 100)
  }

  const scanProduto = async (val) => {
    try {
      const p = await produtosQueries.buscarPorCodigo(val)
      if (!p) {
        setEanDesconhecido(val)
        setModalEanOpen(true)
        return
      }
      const saldos = await estoqueQueries.buscarPorEnderecoProduto(origem, p.id)
      if (saldos.length === 0) return toastError('Sem Saldo', `O produto não possui saldo em ${origem}`)
      setProduto(p)
      if (saldos.length === 1) { setSaldoAtual(saldos[0]); await verificarFEFO(p, saldos[0]) }
      else { setSaldoOpcoes(saldos); setStep(2.5) }
    } catch (err) { toastError('Erro', err.message) }
  }

  const verificarFEFO = async (p, saldo) => {
    if (saldo.validade) {
      const maisAntigos = await estoqueQueries.verificarFEFO(p.id, saldo.validade)
      if (maisAntigos.length > 0) { setFefoAlert(maisAntigos); return }
    }
    setStep(3); setTimeout(() => document.getElementById('exp-caixas')?.focus(), 100)
  }

  const confirmarSaida = async () => {
    try {
      const res = await movimentacoesQueries.enviarParaExpedicao({
        produto_id: produto.id, lote: saldoAtual.lote, validade: saldoAtual.validade,
        qtd_caixas: parseFloat(qtdCaixas), qtd_kg: parseFloat(qtdKg),
        origem, operador_id: operador.id, operador_nome: operador.nome
      })
      if (res.success) { toastSuccess('Saída Confirmada', `${produto.descricao} enviado para Expedição.`); resetAll() }
      else toastError('Erro na Saída', res.error)
    } catch (err) { toastError('Erro Fatal', err.message) }
  }

  return (
    <div>
      <div className="mov-flow">
        {/* STEP 1 */}
        <div className={`mov-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
          <div className="mov-step__header">
            <div className="mov-step__number">1</div>
            <div className="mov-step__label">Endereço de Origem</div>
          </div>
          {step === 1 ? (
            <input id="exp-origem" className="form-input form-input--scanner" placeholder="Bipar ou digitar endereço..." onKeyDown={e => e.key === 'Enter' && scanOrigem(e.target.value)} autoFocus />
          ) : (
            <div className="flex items-center gap-12 font-mono text-cyan" style={{ fontSize: 18, fontWeight: 700 }}>
              <MapPin size={20} /> {origem}
            </div>
          )}
        </div>

        {/* STEP 2.5 */}
        {step === 2.5 && (
          <div className="mov-step active">
            <div className="mov-step__header"><div className="mov-step__number">2</div><div className="mov-step__label">Selecione o Lote</div></div>
            <div className="flex-col gap-8">
              {saldoOpcoes.map((s, i) => (
                <div key={i} onClick={() => { setSaldoAtual(s); setSaldoOpcoes([]); verificarFEFO(produto, s) }}
                  style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="font-bold text-warning font-mono">Lote: {s.lote || '(sem lote)'}</div>
                    <div className="text-sm text-muted">Val: {s.validade ? format(new Date(s.validade), 'dd/MM/yyyy') : '—'}</div>
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

        {/* STEP 2 */}
        <div className={`mov-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`} style={{ opacity: step >= 2 ? 1 : 0.5 }}>
          <div className="mov-step__header"><div className="mov-step__number">2</div><div className="mov-step__label">Material</div></div>
          {step === 2 ? (
            <input id="exp-produto" className="form-input form-input--scanner" placeholder="Bipar código do material..." onKeyDown={e => e.key === 'Enter' && scanProduto(e.target.value)} />
          ) : step > 2 ? (
            <div className="saldo-display">
              <div className="saldo-item" style={{ flex: 1 }}>
                <div className="saldo-item__label">Material</div>
                <div style={{ color: 'white', fontWeight: 600 }}>{produto?.descricao}</div>
                <div className="text-muted text-sm mt-4">Lote: {saldoAtual?.lote} | Val: {saldoAtual?.validade ? format(new Date(saldoAtual.validade), 'dd/MM/yyyy') : '-'}</div>
              </div>
              <div className="saldo-item text-right">
                <div className="saldo-item__label">Disponível</div>
                <div className="saldo-item__value">{saldoAtual?.qtd_caixas} CX</div>
                <div className="text-muted">{saldoAtual?.qtd_kg} KG</div>
              </div>
            </div>
          ) : null}
        </div>

        {/* STEP 3 */}
        <div className={`mov-step ${step === 3 ? 'active' : step > 3 ? 'completed' : ''}`} style={{ opacity: step >= 3 ? 1 : 0.5 }}>
          <div className="mov-step__header"><div className="mov-step__number">3</div><div className="mov-step__label">Quantidade</div></div>
          {step === 3 ? (
            <form onSubmit={e => { e.preventDefault(); if (!qtdCaixas || !qtdKg) return toastWarning('Aviso', 'Preencha caixas e kg.'); if (parseFloat(qtdCaixas) > saldoAtual.qtd_caixas) return toastError('Aviso', `Saldo: ${saldoAtual.qtd_caixas} cx`); if (parseFloat(qtdKg) > saldoAtual.qtd_kg) return toastError('Aviso', `Saldo: ${saldoAtual.qtd_kg} kg`); setStep(4) }} className="flex gap-16 items-end">
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Caixas</label><input id="exp-caixas" type="number" step="0.01" className="form-input form-input--number" value={qtdCaixas} onChange={e => setQtdCaixas(e.target.value)} /></div>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">KG</label><input type="number" step="0.01" className="form-input form-input--number" value={qtdKg} onChange={e => setQtdKg(e.target.value)} /></div>
              <button type="submit" className="btn btn--primary btn--lg">Avançar</button>
            </form>
          ) : step > 3 ? (
            <div className="flex items-center gap-12 font-mono text-cyan" style={{ fontSize: 18, fontWeight: 700 }}>
              <Hash size={20} /> {qtdCaixas} Caixas / {qtdKg} KG
            </div>
          ) : null}
        </div>

        {/* STEP 4 */}
        <div className={`mov-step ${step === 4 ? 'active' : ''}`} style={{ opacity: step >= 4 ? 1 : 0.5 }}>
          <div className="mov-step__header"><div className="mov-step__number">4</div><div className="mov-step__label">Confirmar Envio para Expedição</div></div>
          {step === 4 && (
            <div>
              <div className="saldo-display" style={{ background: 'var(--warning-muted)', borderColor: 'var(--warning)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 16 }}>{produto?.descricao}</div>
                  <div className="text-muted mt-4">De: <strong>{origem}</strong> <ArrowRight size={14} style={{ display: 'inline' }} /> Para: <strong>EXPEDIÇÃO</strong></div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', margin: '16px 0', padding: 16, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>POSIÇÃO ATUAL</div><div style={{ fontWeight: 700, fontSize: 15 }}>{saldoAtual?.qtd_caixas} CX</div><div className="text-muted text-sm">{saldoAtual?.qtd_kg} KG</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 2 }}>RETIRADA</div><div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 15 }}>- {qtdCaixas} CX</div><div style={{ color: 'var(--danger)', fontSize: 13 }}>- {qtdKg} KG</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>SALDO RESTANTE</div><div style={{ fontWeight: 700, color: 'var(--success)', fontSize: 15 }}>{(parseFloat(saldoAtual?.qtd_caixas || 0) - parseFloat(qtdCaixas || 0)).toFixed(2)} CX</div><div style={{ color: 'var(--success)', fontSize: 13 }}>{(parseFloat(saldoAtual?.qtd_kg || 0) - parseFloat(qtdKg || 0)).toFixed(2)} KG</div></div>
              </div>
              <div className="flex gap-12 mt-16">
                <button className="btn btn--ghost w-full" onClick={resetAll}>Cancelar</button>
                <button className="btn btn--success w-full btn--lg" onClick={confirmarSaida}><Check size={18} /> Confirmar Saída</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* FEFO ALERT */}
      {fefoAlert && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', border: '2px solid var(--warning)' }}>
            <h3 className="text-warning font-bold flex items-center gap-8 mb-16"><Box size={20} /> Alerta FEFO</h3>
            <p className="mb-16">Existem lotes mais antigos disponíveis. Pelo padrão FEFO, priorize estes:</p>
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              {fefoAlert.map((a, i) => (
                <div key={i} className="flex justify-between items-center py-4 border-b border-border last:border-0 text-sm">
                  <strong className="text-cyan font-mono">{a.endereco}</strong>
                  <span className="text-muted">Lote: {a.lote}</span>
                  <span className="text-danger font-bold">{format(new Date(a.validade), 'dd/MM/yyyy')}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-16">
              <button className="btn btn--secondary" style={{ flex: 1 }} onClick={() => { setFefoAlert(null); resetAll() }}>Cancelar Saída</button>
              <button className="btn btn--warning" style={{ flex: 1 }} onClick={() => { setFefoAlert(null); setStep(3); setTimeout(() => document.getElementById('exp-caixas')?.focus(), 100) }}>Ignorar e Continuar</button>
            </div>
          </div>
        </div>
      )}

      <CadastroEanModal isOpen={modalEanOpen} onClose={() => { setModalEanOpen(false); setTimeout(() => document.getElementById('exp-produto')?.focus(), 100) }} codigoDesconhecido={eanDesconhecido}
        onRegraSalva={async (p) => { const saldos = await estoqueQueries.buscarPorEnderecoProduto(origem, p.id); if (saldos.length === 0) { toastError('Sem Saldo', `O produto não possui saldo em ${origem}`); return } setProduto(p); if (saldos.length === 1) { setSaldoAtual(saldos[0]); verificarFEFO(p, saldos[0]) } else { setSaldoOpcoes(saldos); setStep(2.5) } }} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// ABA 2: ENVIO P/ PRODUÇÃO (cria Ordem de Produção)
// ────────────────────────────────────────────────────────────────────────────
function EnvioProducao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const [step, setStep] = useState(1)
  const [origem, setOrigem] = useState('')
  const [produto, setProduto] = useState(null)
  const [saldoAtual, setSaldoAtual] = useState(null)
  const [saldoOpcoes, setSaldoOpcoes] = useState([])
  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  const resetAll = () => {
    setStep(1); setOrigem(''); setProduto(null)
    setSaldoAtual(null); setSaldoOpcoes([]); setQtdCaixas(''); setQtdKg('')
    setTimeout(() => document.getElementById('prod-origem')?.focus(), 100)
  }

  const scanOrigem = async (val) => {
    const end = val.toUpperCase()
    if (end === 'REC' || end === 'EXPEDICAO' || end === 'PRODUCAO') return toastError('Endereço Inválido', `Não é possível fazer saída a partir de "${end}".`)
    const local = await locaisQueries.buscarPorEndereco(end)
    if (!local) return toastError('Endereço Inválido', `O endereço "${end}" não está cadastrado.`)
    setOrigem(end); setStep(2)
    setTimeout(() => document.getElementById('prod-produto')?.focus(), 100)
  }

  const scanProduto = async (val) => {
    try {
      const p = await produtosQueries.buscarPorCodigo(val)
      if (!p) { setEanDesconhecido(val); setModalEanOpen(true); return }
      const saldos = await estoqueQueries.buscarPorEnderecoProduto(origem, p.id)
      if (saldos.length === 0) return toastError('Sem Saldo', `Produto sem saldo em ${origem}`)
      setProduto(p)
      if (saldos.length === 1) { setSaldoAtual(saldos[0]); setStep(3); setTimeout(() => document.getElementById('prod-caixas')?.focus(), 100) }
      else { setSaldoOpcoes(saldos); setStep(2.5) }
    } catch (err) { toastError('Erro', err.message) }
  }

  const confirmarEnvio = async () => {
    try {
      const res = await movimentacoesQueries.abrirOrdemProducao({
        produto_id: produto.id, lote: saldoAtual.lote, validade: saldoAtual.validade,
        qtd_caixas: parseFloat(qtdCaixas), qtd_kg: parseFloat(qtdKg),
        origem, operador_id: operador.id, operador_nome: operador.nome
      })
      if (res.success) {
        toastSuccess('Ordem Aberta! 🏭', `${produto.descricao} (${qtdKg}kg) enviado para produção. Ordem gerada com sucesso!`)
        resetAll()
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro Fatal', err.message) }
  }

  return (
    <div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--primary)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
        <div className="text-sm" style={{ color: 'var(--primary)' }}>
          💡 <strong>Como funciona:</strong> Ao enviar para a Produção, o sistema retira o item do estoque e cria uma <strong>Ordem de Produção</strong>. Quando os subprodutos voltarem, use a aba <em>Retorno de Produção</em> para registrar e calcular o rendimento.
        </div>
      </div>

      <div className="mov-flow">
        <div className={`mov-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
          <div className="mov-step__header"><div className="mov-step__number">1</div><div className="mov-step__label">Endereço de Origem</div></div>
          {step === 1 ? <input id="prod-origem" className="form-input form-input--scanner" placeholder="Bipar endereço..." onKeyDown={e => e.key === 'Enter' && scanOrigem(e.target.value)} autoFocus />
            : <div className="flex items-center gap-12 font-mono text-cyan" style={{ fontSize: 18, fontWeight: 700 }}><MapPin size={20} /> {origem}</div>}
        </div>

        {step === 2.5 && (
          <div className="mov-step active">
            <div className="mov-step__header"><div className="mov-step__number">2</div><div className="mov-step__label">Selecione o Lote</div></div>
            <div className="flex-col gap-8">
              {saldoOpcoes.map((s, i) => (
                <div key={i} onClick={() => { setSaldoAtual(s); setSaldoOpcoes([]); setStep(3); setTimeout(() => document.getElementById('prod-caixas')?.focus(), 100) }}
                  style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                  <div><div className="font-bold text-warning font-mono">Lote: {s.lote || '(sem lote)'}</div><div className="text-sm text-muted">Val: {s.validade ? format(new Date(s.validade), 'dd/MM/yyyy') : '—'}</div></div>
                  <div className="text-right"><div className="text-success font-bold">{s.qtd_caixas} CX</div><div className="text-muted text-sm">{s.qtd_kg} KG</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={`mov-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`} style={{ opacity: step >= 2 ? 1 : 0.5 }}>
          <div className="mov-step__header"><div className="mov-step__number">2</div><div className="mov-step__label">Matéria Prima</div></div>
          {step === 2 ? <input id="prod-produto" className="form-input form-input--scanner" placeholder="Bipar código da matéria prima..." onKeyDown={e => e.key === 'Enter' && scanProduto(e.target.value)} />
            : step > 2 ? <div className="saldo-display"><div style={{ flex: 1 }}><div style={{ color: 'white', fontWeight: 600 }}>{produto?.descricao}</div><div className="text-muted text-sm mt-4">Lote: {saldoAtual?.lote} | Val: {saldoAtual?.validade ? format(new Date(saldoAtual.validade), 'dd/MM/yyyy') : '-'}</div></div><div className="text-right"><div className="saldo-item__value">{saldoAtual?.qtd_caixas} CX</div><div className="text-muted">{saldoAtual?.qtd_kg} KG</div></div></div> : null}
        </div>

        <div className={`mov-step ${step === 3 ? 'active' : step > 3 ? 'completed' : ''}`} style={{ opacity: step >= 3 ? 1 : 0.5 }}>
          <div className="mov-step__header"><div className="mov-step__number">3</div><div className="mov-step__label">Quantidade Enviada</div></div>
          {step === 3 ? (
            <form onSubmit={e => { e.preventDefault(); if (!qtdCaixas || !qtdKg) return toastWarning('Aviso', 'Preencha os campos.'); if (parseFloat(qtdKg) > saldoAtual.qtd_kg) return toastError('Saldo insuficiente', `Disponível: ${saldoAtual.qtd_kg} kg`); setStep(4) }} className="flex gap-16 items-end">
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Caixas</label><input id="prod-caixas" type="number" step="0.01" className="form-input form-input--number" value={qtdCaixas} onChange={e => setQtdCaixas(e.target.value)} /></div>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">KG Total</label><input type="number" step="0.001" className="form-input form-input--number" value={qtdKg} onChange={e => setQtdKg(e.target.value)} /></div>
              <button type="submit" className="btn btn--primary btn--lg">Avançar</button>
            </form>
          ) : step > 3 ? <div className="flex items-center gap-12 font-mono text-cyan" style={{ fontSize: 18, fontWeight: 700 }}><Hash size={20} /> {qtdCaixas} Cx / {qtdKg} KG</div> : null}
        </div>

        <div className={`mov-step ${step === 4 ? 'active' : ''}`} style={{ opacity: step >= 4 ? 1 : 0.5 }}>
          <div className="mov-step__header"><div className="mov-step__number">4</div><div className="mov-step__label">Confirmar Envio à Produção</div></div>
          {step === 4 && (
            <div>
              <div style={{ background: 'rgba(139,92,246,0.1)', border: '2px solid #8b5cf6', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <Factory size={24} style={{ color: '#8b5cf6' }} />
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#8b5cf6' }}>Envio p/ Produção</div>
                </div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 16 }}>{produto?.descricao}</div>
                <div className="text-muted mt-4 text-sm">{origem} → PRODUÇÃO | {qtdCaixas} cx | <strong style={{ color: '#8b5cf6' }}>{qtdKg} kg</strong></div>
                <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-1)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                  Uma <strong style={{ color: '#8b5cf6' }}>Ordem de Produção</strong> será criada. Use a aba <em>Retorno de Produção</em> para registrar os subprodutos quando voltarem.
                </div>
              </div>
              <div className="flex gap-12">
                <button className="btn btn--ghost w-full" onClick={resetAll}>Cancelar</button>
                <button className="btn w-full btn--lg" style={{ background: '#8b5cf6', color: 'white' }} onClick={confirmarEnvio}><Check size={18} /> Confirmar e Abrir Ordem</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CadastroEanModal isOpen={modalEanOpen} onClose={() => { setModalEanOpen(false); setTimeout(() => document.getElementById('prod-produto')?.focus(), 100) }} codigoDesconhecido={eanDesconhecido}
        onRegraSalva={async (p) => { const saldos = await estoqueQueries.buscarPorEnderecoProduto(origem, p.id); if (saldos.length === 0) { toastError('Sem Saldo', `Produto sem saldo em ${origem}`); return } setProduto(p); if (saldos.length === 1) { setSaldoAtual(saldos[0]); setStep(3) } else { setSaldoOpcoes(saldos); setStep(2.5) } }} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// ABA 3: RETORNO DE PRODUÇÃO (registra subprodutos, calcula rendimento)
// ────────────────────────────────────────────────────────────────────────────
function RetornoProducao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const [ordens, setOrdens] = useState([])
  const [ordemSelecionada, setOrdemSelecionada] = useState(null)
  const [subprodutos, setSubprodutos] = useState([]) // [{ produto, qtd_caixas, qtd_kg, lote, validade }]
  const [pesoTotalRetornado, setPesoTotalRetornado] = useState(0)
  const [loading, setLoading] = useState(false)

  // Form para adicionar subproduto
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

  useEffect(() => {
    const total = subprodutos.reduce((acc, s) => acc + parseFloat(s.qtd_kg || 0), 0)
    setPesoTotalRetornado(total)
  }, [subprodutos])

  const carregarOrdens = async () => {
    setLoading(true)
    try {
      const data = await movimentacoesQueries.listarOrdensProducao('ABERTA')
      setOrdens(data)
    } catch (e) { toastError('Erro', 'Falha ao carregar ordens.') }
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
    setSubprodutos(prev => [...prev, {
      produto: produtoAtual, qtd_caixas: parseFloat(subQtdCx || 0),
      qtd_kg: parseFloat(subQtdKg), lote: subLote || '', validade: subValidade || ''
    }])
    setProdutoAtual(null); setSubQtdCx(''); setSubQtdKg(''); setSubLote(''); setSubValidade('')
    setTimeout(() => scanRef.current?.focus(), 100)
  }

  const removerSubproduto = (idx) => setSubprodutos(prev => prev.filter((_, i) => i !== idx))

  const fecharOrdem = async () => {
    if (subprodutos.length === 0) return toastWarning('Atenção', 'Adicione pelo menos um subproduto.')
    try {
      // Dar entrada de cada subproduto no estoque (endereço REC)
      for (const sub of subprodutos) {
        await movimentacoesQueries.receber({
          produto_id: sub.produto.id, lote: sub.lote, validade: sub.validade,
          qtd_caixas: sub.qtd_caixas, qtd_kg: sub.qtd_kg,
          operador_id: operador.id, operador_nome: operador.nome
        })
      }
      // Fechar a Ordem de Produção
      const res = await movimentacoesQueries.fecharOrdemProducao({ ordem_id: ordemSelecionada.id, peso_retornado: pesoTotalRetornado })
      if (res.success) {
        const perda = parseFloat(ordemSelecionada.peso_enviado) - pesoTotalRetornado
        const rendimento = ((pesoTotalRetornado / ordemSelecionada.peso_enviado) * 100).toFixed(1)
        toastSuccess('Ordem Concluída! ✅', `Rendimento: ${rendimento}% | Perda: ${perda.toFixed(3)} kg`)
        setOrdemSelecionada(null); setSubprodutos([]); setPesoTotalRetornado(0); carregarOrdens()
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro Fatal', err.message) }
  }

  if (!ordemSelecionada) return (
    <div>
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
        <div className="text-sm text-muted">🔄 Selecione uma Ordem de Produção aberta para registrar o retorno dos subprodutos (desossa, fracionamento, etc).</div>
      </div>
      {loading ? <div className="text-center p-24 text-muted"><Loader size={24} /></div> : ordens.length === 0 ? (
        <div className="card text-center p-32">
          <PackageOpen size={48} style={{ margin: '0 auto 16px', color: 'var(--text-muted)' }} />
          <div className="text-muted">Nenhuma Ordem de Produção aberta no momento.</div>
          <div className="text-sm text-muted mt-8">Use a aba "Envio p/ Produção" para criar uma.</div>
        </div>
      ) : (
        <div className="flex-col gap-12">
          {ordens.map(o => (
            <div key={o.id} onClick={() => setOrdemSelecionada(o)}
              style={{ background: 'var(--bg-2)', border: '2px solid var(--border)', borderRadius: 12, padding: '16px 20px', cursor: 'pointer', transition: 'border-color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#8b5cf6'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div className="flex justify-between items-start">
                <div>
                  <div style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 600, marginBottom: 4 }}>ORDEM #{o.id}</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{o.produto_descricao}</div>
                  <div className="text-sm text-muted mt-4">Lote: {o.lote || '-'} | Aberta: {format(new Date(o.data_inicio), 'dd/MM/yyyy HH:mm')}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
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
    <div>
      {/* Header da Ordem */}
      <div style={{ background: 'rgba(139,92,246,0.1)', border: '2px solid #8b5cf6', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div className="flex justify-between items-start">
          <div>
            <div style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 700 }}>ORDEM #{ordemSelecionada.id} — EM ANDAMENTO</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{ordemSelecionada.produto_descricao}</div>
            <div className="text-muted text-sm mt-4">Enviado: <strong style={{ color: '#8b5cf6' }}>{parseFloat(ordemSelecionada.peso_enviado).toFixed(3)} kg</strong> | Lote: {ordemSelecionada.lote || '-'}</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => { setOrdemSelecionada(null); setSubprodutos([]) }}><X size={16} /> Voltar</button>
        </div>
      </div>

      {/* Barra de Rendimento */}
      <div className="card mb-20" style={{ background: 'var(--bg-2)' }}>
        <div className="flex justify-between mb-8">
          <div><span className="text-sm text-muted">Retornado:</span> <strong style={{ color: 'var(--success)' }}>{pesoTotalRetornado.toFixed(3)} kg</strong></div>
          <div><span className="text-sm text-muted">Perda/Apara:</span> <strong style={{ color: perda < 0 ? 'var(--danger)' : 'var(--warning)' }}>{perda.toFixed(3)} kg</strong></div>
          <div><span className="text-sm text-muted">Rendimento:</span> <strong style={{ color: rendimento >= 80 ? 'var(--success)' : 'var(--warning)' }}>{rendimento}%</strong></div>
        </div>
        <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, rendimento)}%`, background: rendimento >= 80 ? 'var(--success)' : 'var(--warning)', borderRadius: 4, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Lista de subprodutos já adicionados */}
      {subprodutos.length > 0 && (
        <div className="card mb-20">
          <h4 className="font-bold mb-12">Subprodutos Registrados ({subprodutos.length})</h4>
          {subprodutos.map((s, i) => (
            <div key={i} className="flex justify-between items-center py-8" style={{ borderBottom: '1px solid var(--border)' }}>
              <div><div className="font-bold text-sm">{s.produto.descricao}</div><div className="text-xs text-muted">Lote: {s.lote || '-'} | Val: {s.validade || '-'}</div></div>
              <div className="flex items-center gap-16">
                <div className="text-right"><div className="font-bold text-success">{s.qtd_kg} kg</div><div className="text-xs text-muted">{s.qtd_caixas} cx</div></div>
                <button className="btn btn--ghost btn--sm text-danger" onClick={() => removerSubproduto(i)}><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form: adicionar subproduto */}
      <div className="card mb-20">
        <h4 className="font-bold mb-16">➕ Adicionar Subproduto</h4>
        <div className="form-group mb-12">
          <label className="form-label">Bipar código do subproduto</label>
          <input ref={scanRef} type="text" className="form-input form-input--scanner" placeholder="Bipar EAN do subproduto..." value={scanEan}
            onChange={e => setScanEan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleScanEan(e.target.value) }} autoFocus />
          {produtoAtual && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 8, color: 'var(--success)', fontWeight: 600 }}>✅ {produtoAtual.descricao}</div>}
        </div>
        {produtoAtual && (
          <>
            <div className="form-grid form-grid--2 mb-12">
              <div className="form-group"><label className="form-label">Caixas</label><input id="ret-cx" type="number" step="0.01" className="form-input form-input--number" value={subQtdCx} onChange={e => setSubQtdCx(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">KG *</label><input type="number" step="0.001" className="form-input form-input--number" value={subQtdKg} onChange={e => setSubQtdKg(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Lote</label><input type="text" className="form-input" value={subLote} onChange={e => setSubLote(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Validade</label><input type="date" className="form-input" value={subValidade} onChange={e => setSubValidade(e.target.value)} /></div>
            </div>
            <button className="btn btn--primary w-full" onClick={adicionarSubproduto}><Check size={16} /> Adicionar Subproduto</button>
          </>
        )}
      </div>

      {/* Botão Fechar Ordem */}
      {subprodutos.length > 0 && (
        <div style={{ background: 'rgba(139,92,246,0.1)', border: '2px solid #8b5cf6', borderRadius: 12, padding: 20 }}>
          <div className="text-sm text-muted mb-16">
            Ao fechar a Ordem, os <strong>{subprodutos.length} subproduto(s)</strong> serão dados como entrada no estoque (endereço REC) e o rendimento será calculado.
          </div>
          <button className="btn btn--lg w-full" style={{ background: '#8b5cf6', color: 'white' }} onClick={fecharOrdem}>
            <Check size={20} /> Fechar Ordem e Calcular Rendimento ({rendimento}%)
          </button>
        </div>
      )}

      <CadastroEanModal isOpen={modalEanOpen} onClose={() => { setModalEanOpen(false); setTimeout(() => scanRef.current?.focus(), 100) }}
        codigoDesconhecido={eanDesconhecido} onRegraSalva={(p) => { setProdutoAtual(p); setTimeout(() => document.getElementById('ret-cx')?.focus(), 100) }} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL: Saida com abas
// ────────────────────────────────────────────────────────────────────────────
export function Saida() {
  const [activeTab, setActiveTab] = useState('expedicao')

  const tabs = [
    { id: 'expedicao', label: 'Expedição', icon: <Truck size={16} />, color: 'var(--warning)' },
    { id: 'producao', label: 'Envio p/ Produção', icon: <Factory size={16} />, color: '#8b5cf6' },
    { id: 'retorno', label: 'Retorno de Produção', icon: <RotateCcw size={16} />, color: 'var(--success)' },
  ]

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12"><Truck size={28} /> Saída de Materiais</h1>
          <p className="page-header__subtitle">Expedição, envio para produção e controle de rendimento</p>
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-8 mb-24" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`btn flex items-center gap-8 ${activeTab === tab.id ? 'btn--primary' : 'btn--ghost'}`}
            style={activeTab === tab.id ? { background: tab.color, borderColor: tab.color, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'expedicao' && <SaidaExpedicao />}
      {activeTab === 'producao' && <EnvioProducao />}
      {activeTab === 'retorno' && <RetornoProducao />}
    </div>
  )
}
