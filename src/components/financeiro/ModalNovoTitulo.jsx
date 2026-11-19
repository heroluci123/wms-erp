import React, { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { hojeIsoLocal } from '../../utils/rastreabilidade'

export function ModalNovoTitulo({
  isOpen,
  tipoInicial = 'PAGAR',
  fornecedores = [],
  clientes = [],
  centrosCusto = [],
  contas = [],
  onClose,
  onSalvar,
}) {
  const [tipo, setTipo] = useState(tipoInicial)
  const [descricao, setDescricao] = useState('')
  const [numeroDoc, setNumeroDoc] = useState('')
  const [fornecedorId, setFornecedorId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [centroCustoId, setCentroCustoId] = useState('')
  const [contaId, setContaId] = useState('')
  const [valorOriginal, setValorOriginal] = useState('')
  const [dataEmissao, setDataEmissao] = useState(hojeIsoLocal())
  const [dataVencimento, setDataVencimento] = useState(hojeIsoLocal())
  const [qtdParcelas, setQtdParcelas] = useState(1)
  const [intervaloDias, setIntervaloDias] = useState(30)
  const [forma, setForma] = useState('BOLETO')
  const [observacoes, setObservacoes] = useState('')
  const [jaPago, setJaPago] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const padrao = contas.find((c) => Number(c.padrao) === 1) || contas[0]
    setTipo(tipoInicial)
    setDescricao('')
    setNumeroDoc('')
    setFornecedorId('')
    setClienteId('')
    setCentroCustoId(centrosCusto[0]?.id || '')
    setContaId(padrao?.id || '')
    setValorOriginal('')
    setDataEmissao(hojeIsoLocal())
    setDataVencimento(hojeIsoLocal())
    setQtdParcelas(1)
    setIntervaloDias(30)
    setForma('PIX')
    setObservacoes('')
    setJaPago(false)
  }, [isOpen, tipoInicial, contas, centrosCusto])

  if (!isOpen) return null

  const ehPagar = tipo === 'PAGAR'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSalvando(true)
    try {
      await onSalvar({
        tipo,
        descricao,
        numero_documento: numeroDoc,
        fornecedor_id: ehPagar ? fornecedorId || null : null,
        cliente_id: !ehPagar ? clienteId || null : null,
        centro_custo_id: centroCustoId || null,
        conta_bancaria_id: contaId || null,
        valor_original: Number(String(valorOriginal).replace(',', '.')),
        data_emissao: dataEmissao,
        data_vencimento: dataVencimento,
        qtd_parcelas: Number(qtdParcelas || 1),
        intervalo_dias: Number(intervaloDias || 30),
        forma_pagamento_efetiva: forma,
        observacoes,
        ja_pago: Number(qtdParcelas) === 1 && jaPago,
      })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ width: '96%', maxWidth: 740, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
        <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-base font-bold m-0">
            {ehPagar ? 'Nova Conta a Pagar (Despesa / Fornecedor)' : 'Nova Conta a Receber (Cliente / Receita)'}
          </h3>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: 20 }} className="flex flex-col gap-14">
          <div className="form-grid form-grid--3">
            <div style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Descrição do Lançamento *</label>
              <input
                type="text"
                required
                className="form-input"
                placeholder={ehPagar ? 'Ex: Energia Elétrica Câmara Fria / Compra Embalagens' : 'Ex: Venda Balcão / Acerto Cliente'}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Nº Documento / NF</label>
              <input
                type="text"
                className="form-input font-mono"
                placeholder="Ex: NF 9182"
                value={numeroDoc}
                onChange={(e) => setNumeroDoc(e.target.value)}
              />
            </div>
          </div>

          <div className="form-grid form-grid--2">
            {ehPagar ? (
              <div>
                <label className="form-label">Fornecedor (Opcional)</label>
                <select className="form-input" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                  <option value="">-- Sem fornecedor específico --</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome_fantasia || f.razao_social}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="form-label">Cliente (Opcional)</label>
                <select className="form-input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                  <option value="">-- Sem cliente específico --</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome_fantasia || c.razao_social}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="form-label">Centro de Custo</label>
              <select className="form-input" value={centroCustoId} onChange={(e) => setCentroCustoId(e.target.value)}>
                <option value="">-- Sem centro de custo --</option>
                {centrosCusto.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.codigo} — {cc.descricao}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid form-grid--4">
            <div>
              <label className="form-label">Valor Total (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="form-input font-mono font-bold text-right"
                placeholder="0,00"
                value={valorOriginal}
                onChange={(e) => setValorOriginal(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Emissão</label>
              <input type="date" className="form-input" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
            </div>
            <div>
              <label className="form-label">1º Vencimento *</label>
              <input type="date" required className="form-input" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Parcelas / Dias</label>
              <div className="flex gap-6">
                <input
                  type="number"
                  min="1"
                  max="60"
                  className="form-input font-mono"
                  style={{ width: 64 }}
                  value={qtdParcelas}
                  onChange={(e) => setQtdParcelas(e.target.value)}
                  title="Quantidade de parcelas"
                />
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="form-input font-mono"
                  style={{ flex: 1 }}
                  value={intervaloDias}
                  onChange={(e) => setIntervaloDias(e.target.value)}
                  title="Intervalo em dias entre parcelas"
                  disabled={Number(qtdParcelas) <= 1}
                />
              </div>
            </div>
          </div>

          <div className="form-grid form-grid--2">
            <div>
              <label className="form-label">Conta / Banco Prevista</label>
              <select className="form-input" value={contaId} onChange={(e) => setContaId(e.target.value)}>
                <option value="">-- Conta Padrão --</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} — {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Forma Prevista</label>
              <select className="form-input" value={forma} onChange={(e) => setForma(e.target.value)}>
                {['PIX', 'BOLETO', 'TED / DOC', 'DINHEIRO', 'CARTAO DEBITO', 'CARTAO CREDITO'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Observações</label>
            <input
              type="text"
              className="form-input"
              placeholder="Informações adicionais, chave PIX do boleto..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>

          {Number(qtdParcelas) === 1 && (
            <label className="flex items-center gap-8 text-sm cursor-pointer">
              <input type="checkbox" checked={jaPago} onChange={(e) => setJaPago(e.target.checked)} />
              Já marcar como <strong>{ehPagar ? 'Pago hoje' : 'Recebido hoje'}</strong> (movimenta o caixa imediatamente)
            </label>
          )}

          <div className="flex justify-end gap-8 pt-12 border-t border-border">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={salvando}>
              <Plus size={16} /> {salvando ? 'Salvando...' : Number(qtdParcelas) > 1 ? `Gerar ${qtdParcelas} Parcelas` : 'Salvar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
