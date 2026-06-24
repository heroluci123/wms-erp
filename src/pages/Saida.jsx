import React, { useState } from 'react'
import { Truck, MapPin, Box, Hash, Check, ArrowRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { format } from 'date-fns'

export function Saida() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  
  const [step, setStep] = useState(1) // 1: Origem, 2: Produto, 3: Qtd, 4: Confirmar
  const [origem, setOrigem] = useState('')
  const [produto, setProduto] = useState(null)
  const [saldoAtual, setSaldoAtual] = useState(null)
  const [saldoOpcoes, setSaldoOpcoes] = useState([])
  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [fefoAlert, setFefoAlert] = useState(null)

  const resetAll = () => {
    setStep(1)
    setOrigem('')
    setProduto(null)
    setSaldoAtual(null)
    setSaldoOpcoes([])
    setQtdCaixas('')
    setQtdKg('')
    setTimeout(() => document.getElementById('input-saida-origem')?.focus(), 100)
  }

  const scanOrigem = async (val) => {
    const end = val.toUpperCase()
    // Não pode sair de REC ou EXPEDICAO
    if (end === 'REC' || end === 'EXPEDICAO') {
      return toastError('Endereço Inválido', `Não é possível fazer saída a partir de "${end}".`)
    }
    // Validar se endereço está cadastrado
    const local = await window.wmsAPI.locais.buscar(end)
    if (!local) {
      return toastError('Endereço Inválido', `O endereço "${end}" não está cadastrado.`)
    }
    setOrigem(end)
    setStep(2)
    setTimeout(() => document.getElementById('input-saida-produto')?.focus(), 100)
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
        const saldo = saldos[0]
        setSaldoAtual(saldo)
        await verificarFEFO(p, saldo)
      } else {
        // Múltiplos lotes: exibe seleção
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
    await verificarFEFO(produto, saldo)
  }

  const verificarFEFO = async (p, saldo) => {
    if (saldo.validade) {
      const maisAntigos = await window.wmsAPI.estoque.verificarFEFO(p.id, saldo.validade)
      if (maisAntigos.length > 0) {
        setFefoAlert(maisAntigos)
        return
      }
    }
    avancarParaQtd()
  }

  const avancarParaQtd = () => {
    setStep(3)
    setTimeout(() => document.getElementById('input-saida-caixas')?.focus(), 100)
  }

  const handleQtdSubmit = (e) => {
    e.preventDefault()
    if (!qtdCaixas || !qtdKg) return toastWarning('Aviso', 'Preencha caixas e kg.')
    if (parseFloat(qtdCaixas) > saldoAtual.qtd_caixas) {
      return toastError('Aviso', `Saldo insuficiente. Disponível: ${saldoAtual.qtd_caixas} cx.`)
    }
    if (parseFloat(qtdKg) > saldoAtual.qtd_kg) {
      return toastError('Aviso', `Saldo insuficiente. Disponível: ${saldoAtual.qtd_kg} kg.`)
    }
    setStep(4)
  }

  const confirmarSaida = async () => {
    try {
      const payload = {
        produto_id: produto.id,
        lote: saldoAtual.lote,
        validade: saldoAtual.validade,
        qtd_caixas: parseFloat(qtdCaixas),
        qtd_kg: parseFloat(qtdKg),
        origem: origem,
        destino: 'EXPEDICAO',
        operador_id: operador.id,
        operador_nome: operador.nome
      }

      // Usa a transferir direta (sem bloqueio backend pois no backend já liberamos EXPEDICAO somente via saída)
      // Na verdade, o backend bloqueia REC e EXPEDICAO no transferir.
      // Precisamos de uma rota de saída dedicada. Vamos usar receber com lógica invertida:
      // Solução: chamar transferência forçada via uma nova API ou usar a mesma lógica:
      // Como o backend bloqueia, vamos fazer a lógica aqui diretamente com 2 chamadas separadas:
      
      // Na verdade vou usar a mesma query transferir mas o backend precisa de uma exceção.
      // A forma mais limpa: criar no movimentacoes uma query 'enviarParaExpedicao' 
      // Mas como não temos ela ainda, vamos usar a API de transferir que JÁ foi atualizada
      // para bloquear EXPEDICAO. Precisamos de outra abordagem.
      
      // Solução pragmática: enviar via IPC direto uma chamada especial
      // Vamos usar a API de movimentacoes.transferir e no backend adicionar uma exceção
      // quando o tipo é SAIDA.
      
      // ALTERNATIVA MAIS SIMPLES: como já temos receber() que faz UPSERT no endereço,
      // podemos fazer manualmente: decrementar origem + incrementar EXPEDICAO.
      // Mas isso exige 2 chamadas e não é atômico.
      
      // MELHOR SOLUÇÃO: Criar uma IPC 'movimentacoes:enviar-expedicao' no main.js
      // Por ora, vamos fazer pela API existente passando um flag especial.
      // Mas o backend vai barrar...

      // Solução final pragmática: enviar com destino EXPEDICAO usando listarLog como workaround
      // NÃO! Vamos usar a lógica correta. O backend precisa de uma nova rota.
      // Como temos window.wmsAPI.movimentacoes.transferir que chama 'movimentacoes:transferir',
      // e o backend bloqueia REC/EXPEDICAO, precisamos criar uma API separada.
      
      // Na verdade, a forma mais correta é: o backend deve ter uma function enviarParaExpedicao
      // que é uma transferência permitida especificamente para EXPEDICAO.
      // Vamos chamar via a mesma IPC mas com um campo extra 'forcar_expedicao: true'
      
      // POR ORA: chamar confirmarDespacho? Não, isso DELETA do estoque.
      // O fluxo correto é: Saída move de ENDERECO -> EXPEDICAO (transferência real)
      //                     Expedição confirma despacho e DELETA de EXPEDICAO
      
      // O PROBLEMA é que a trava no backend (movimentacoes.js transferir) bloqueia destino EXPEDICAO.
      // SOLUÇÃO: Eu preciso criar uma função separada no backend. Mas o subagente já está rodando.
      // Vou chamar via IPC handle direto por enquanto com uma flag.
      
      // DECISÃO FINAL: Mais simples — remover a trava de EXPEDICAO no backend e colocar somente
      // a trava no FRONTEND da tela de Movimentação. Assim a tela de Saída pode transferir para EXPEDICAO
      // livremente. O backend continua atômico.
      
      // Porém isso já foi implementado. A trava está no backend.
      // Vou ter que criar uma nova IPC. Vou fazer isso direto aqui.
      
      const res = await window.wmsAPI.movimentacoes.enviarParaExpedicao(payload)
      if (res.success) {
        toastSuccess('Saída Confirmada', `${produto.descricao} enviado para a Expedição. (${qtdCaixas} cx)`)
        resetAll()
      } else {
        toastError('Erro na Saída', res.error)
      }
    } catch (err) {
      toastError('Erro Fatal', err.message)
    }
  }

  const onKeyOrigem = (e) => { if(e.key === 'Enter') scanOrigem(e.target.value) }
  const onKeyProduto = (e) => { if(e.key === 'Enter') scanProduto(e.target.value) }

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Truck size={28} /> Saída de Materiais
          </h1>
          <p className="page-header__subtitle">Puxar material de uma posição e enviar para a área de EXPEDIÇÃO</p>
        </div>
        <button className="btn btn--ghost" onClick={resetAll}>Reiniciar</button>
      </div>

      <div className="mov-flow">
        {/* STEP 1: ORIGEM */}
        <div className={`mov-step ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}>
          <div className="mov-step__header">
            <div className="mov-step__number">1</div>
            <div className="mov-step__label">Endereço de Origem (Posição Física)</div>
          </div>
          {step === 1 ? (
            <input id="input-saida-origem" className="form-input form-input--scanner" placeholder="Bipar endereço de origem..." onKeyDown={onKeyOrigem} autoFocus />
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
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--warning)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div>
                    <div className="font-bold" style={{ color: 'var(--warning)', fontFamily: 'monospace' }}>
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
            <input id="input-saida-produto" className="form-input form-input--scanner" placeholder="Bipar código do material..." onKeyDown={onKeyProduto} />
          ) : step > 2 ? (
            <div>
              <div className="flex items-center gap-12 font-mono text-cyan mb-8" style={{ fontSize: 18, fontWeight: 700 }}>
                <Box size={20} /> {produto?.codigo}
              </div>
              <div className="saldo-display">
                <div className="saldo-item" style={{ flex: 1 }}>
                  <div className="saldo-item__label">Material</div>
                  <div style={{ color: 'white', fontWeight: 600 }}>{produto?.descricao}</div>
                  <div className="text-muted text-sm mt-4">
                    Lote: {saldoAtual?.lote} | Validade: {saldoAtual?.validade ? format(new Date(saldoAtual.validade), 'dd/MM/yyyy') : '-'}
                  </div>
                </div>
                <div className="saldo-item text-right">
                  <div className="saldo-item__label">Disponível</div>
                  <div className="saldo-item__value">{saldoAtual?.qtd_caixas} CX</div>
                  <div className="text-muted">{saldoAtual?.qtd_kg} KG</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* STEP 3: QUANTIDADE */}
        <div className={`mov-step ${step === 3 ? 'active' : step > 3 ? 'completed' : ''}`} style={{ opacity: step >= 3 ? 1 : 0.5 }}>
          <div className="mov-step__header">
            <div className="mov-step__number">3</div>
            <div className="mov-step__label">Quantidade para Saída</div>
          </div>
          {step === 3 ? (
            <form onSubmit={handleQtdSubmit} className="flex gap-16 items-end">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Caixas</label>
                <input id="input-saida-caixas" type="number" step="0.01" className="form-input form-input--number" value={qtdCaixas} onChange={e => setQtdCaixas(e.target.value)} />
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

        {/* STEP 4: CONFIRMAÇÃO */}
        <div className={`mov-step ${step === 4 ? 'active' : ''}`} style={{ opacity: step >= 4 ? 1 : 0.5 }}>
          <div className="mov-step__header">
            <div className="mov-step__number">4</div>
            <div className="mov-step__label">Confirmar Envio para Expedição</div>
          </div>
          {step === 4 && (
            <div>
              <div className="saldo-display" style={{ background: 'var(--warning-muted)', borderColor: 'var(--warning)' }}>
                <div className="saldo-item" style={{ flex: 1 }}>
                  <div style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 16 }}>
                    {produto?.descricao}
                  </div>
                  <div className="text-muted mt-4">
                    {qtdCaixas} CX / {qtdKg} KG — De: <strong>{origem}</strong> <ArrowRight size={14} style={{ display: 'inline' }} /> Para: <strong>EXPEDIÇÃO</strong>
                  </div>
                </div>
              </div>
              <div className="flex gap-12 mt-16">
                <button className="btn btn--ghost w-full" onClick={resetAll}>Cancelar</button>
                <button className="btn btn--success w-full btn--lg" onClick={confirmarSaida}>
                  <Check size={18} /> Confirmar Saída
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* MODAL FEFO/PVPS */}
      {fefoAlert && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', border: '2px solid var(--warning)' }}>
            <h3 className="text-warning font-bold flex items-center gap-8 mb-16"><Box size={20}/> Alerta FEFO (Validade)</h3>
            <p className="mb-16">Atenção! Existem lotes mais antigos disponíveis no estoque. Pelo padrão FEFO (First Expired, First Out), você deve priorizar a saída dos seguintes locais:</p>
            
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
              <button className="btn btn--secondary" style={{flex: 1}} onClick={() => { setFefoAlert(null); resetAll() }}>Cancelar Saída</button>
              <button className="btn btn--warning" style={{flex: 1}} onClick={() => { setFefoAlert(null); avancarParaQtd() }}>Ignorar e Continuar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
