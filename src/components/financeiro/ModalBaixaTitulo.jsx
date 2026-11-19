import React, { useEffect, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { hojeIsoLocal } from '../../utils/rastreabilidade'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const FORMAS = ['PIX', 'BOLETO', 'TED / DOC', 'DINHEIRO', 'CARTAO DEBITO', 'CARTAO CREDITO', 'CHEQUE']

export function ModalBaixaTitulo({ titulo, contas = [], onClose, onConfirmar }) {
  const [contaId, setContaId] = useState('')
  const [valorPago, setValorPago] = useState('')
  const [desconto, setDesconto] = useState('0')
  const [jurosMulta, setJurosMulta] = useState('0')
  const [dataPagamento, setDataPagamento] = useState(hojeIsoLocal())
  const [forma, setForma] = useState('PIX')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!titulo) return
    const padrao = contas.find((c) => Number(c.padrao) === 1) || contas[0]
    setContaId(titulo.conta_bancaria_id || padrao?.id || '')
    setValorPago(Number(titulo.saldo_aberto || 0).toFixed(2))
    setDesconto('0')
    setJurosMulta('0')
    setDataPagamento(hojeIsoLocal())
    setForma(titulo.forma_pagamento_efetiva || 'PIX')
    setObs('')
  }, [titulo, contas])

  if (!titulo) return null

  const saldoAberto = Number(titulo.saldo_aberto || 0)
  const descNum = Math.max(0, Number(String(desconto || '0').replace(',', '.')) || 0)
  const jurosNum = Math.max(0, Number(String(jurosMulta || '0').replace(',', '.')) || 0)
  const exigivel = Math.max(0, Number((saldoAberto - descNum + jurosNum).toFixed(2)))
  const pagoNum = Math.max(0, Number(String(valorPago || '0').replace(',', '.')) || 0)
  const restante = Math.max(0, Number((exigivel - pagoNum).toFixed(2)))
  const ehReceber = titulo.tipo === 'RECEBER'

  const recalcularLiquido = (novoDesc, novoJuros) => {
    const d = Math.max(0, Number(String(novoDesc || '0').replace(',', '.')) || 0)
    const j = Math.max(0, Number(String(novoJuros || '0').replace(',', '.')) || 0)
    setValorPago(Math.max(0, Number((saldoAberto - d + j).toFixed(2))).toFixed(2))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSalvando(true)
    try {
      await onConfirmar({
        conta_bancaria_id: contaId,
        valor_pago: pagoNum,
        valor_desconto: descNum,
        valor_juros_multa: jurosNum,
        data_pagamento: dataPagamento,
        forma_pagamento: forma,
        observacoes: obs,
      })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ width: '96%', maxWidth: 580, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
        <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="text-base font-bold m-0">
              {ehReceber ? 'Confirmar Recebimento' : 'Confirmar Pagamento'} — {titulo.codigo}
            </h3>
            <div className="text-xs text-muted mt-4">{titulo.descricao}</div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-20 flex flex-col gap-14">
          <div className="p-12 rounded flex justify-between items-center flex-wrap gap-8" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
            <div>
              <div className="text-xs text-muted">{ehReceber ? 'Cliente' : 'Fornecedor'}</div>
              <div className="text-sm font-bold">{titulo.parceiro_nome || '-'}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">Saldo em Aberto</div>
              <div className={`text-lg font-bold font-mono ${ehReceber ? 'text-success' : 'text-warning'}`}>
                {fmtMoeda(saldoAberto)}
              </div>
            </div>
          </div>

          <div className="form-grid form-grid--2">
            <div>
              <label className="form-label">Conta Bancária / Caixa *</label>
              <select className="form-input" required value={contaId} onChange={(e) => setContaId(e.target.value)}>
                <option value="">Selecione a conta...</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} — {c.nome} ({fmtMoeda(c.saldo_atual)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Forma de {ehReceber ? 'Recebimento' : 'Pagamento'}</label>
              <select className="form-input" value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid form-grid--3">
            <div>
              <label className="form-label">Desconto (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input font-mono text-right"
                value={desconto}
                onChange={(e) => {
                  setDesconto(e.target.value)
                  recalcularLiquido(e.target.value, jurosMulta)
                }}
              />
            </div>
            <div>
              <label className="form-label">Juros / Multa (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input font-mono text-right"
                value={jurosMulta}
                onChange={(e) => {
                  setJurosMulta(e.target.value)
                  recalcularLiquido(desconto, e.target.value)
                }}
              />
            </div>
            <div>
              <label className="form-label">Data da Baixa *</label>
              <input
                type="date"
                required
                className="form-input"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
              />
            </div>
          </div>

          <div className="form-grid form-grid--2">
            <div>
              <label className="form-label">Valor {ehReceber ? 'Recebido' : 'Pago'} Agora (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="form-input font-mono font-bold text-right"
                style={{ fontSize: 16, borderColor: 'var(--primary)' }}
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
              />
              <div className="text-xs text-muted mt-4">
                {restante > 0.01
                  ? `Baixa parcial — restará ${fmtMoeda(restante)} em aberto.`
                  : 'Baixa total — o título será quitado.'}
              </div>
            </div>
            <div>
              <label className="form-label">Observações / Comprovante</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: PIX comprovante 8421..."
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-8 pt-12 border-t border-border">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--success" disabled={salvando || !contaId || pagoNum <= 0}>
              <CheckCircle2 size={16} />{' '}
              {salvando ? 'Processando...' : ehReceber ? 'Confirmar Recebimento' : 'Confirmar Pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
