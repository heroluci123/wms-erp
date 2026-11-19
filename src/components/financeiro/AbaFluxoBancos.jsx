import React, { useEffect, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
  Edit2,
  Landmark,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { financeiroQueries } from '../../queries/financeiro'
import { hojeIsoLocal } from '../../utils/rastreabilidade'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const TIPO_CONTA_LABEL = {
  CONTA_CORRENTE: 'Conta Corrente',
  CAIXA_FISICO: 'Caixa Físico',
  CARTEIRA_PIX: 'Carteira PIX',
  POUPANCA: 'Poupança',
}

export function AbaFluxoCaixa({ contas = [], fluxoProjetado = [], onAtualizar, toastSuccess, toastError }) {
  const [movs, setMovs] = useState([])
  const [resumoMov, setResumoMov] = useState({ total_entradas: 0, total_saidas: 0, saldo_periodo: 0 })
  const [filtroContaId, setFiltroContaId] = useState('')
  const [loading, setLoading] = useState(false)

  const [modalMovOpen, setModalMovOpen] = useState(false)
  const [movForm, setMovForm] = useState({
    conta_bancaria_id: '',
    tipo: 'ENTRADA',
    valor: '',
    data_movimento: hojeIsoLocal(),
    forma_pagamento: 'PIX',
    historico: '',
  })

  const [modalTransfOpen, setModalTransfOpen] = useState(false)
  const [transfForm, setTransfForm] = useState({
    conta_origem_id: '',
    conta_destino_id: '',
    valor: '',
    data_movimento: hojeIsoLocal(),
    historico: '',
  })

  const carregarMovs = async () => {
    setLoading(true)
    try {
      const res = await financeiroQueries.listarMovimentacoes({
        conta_bancaria_id: filtroContaId || undefined,
      })
      setMovs(res?.data || [])
      setResumoMov(res?.resumo || { total_entradas: 0, total_saidas: 0, saldo_periodo: 0 })
    } catch (err) {
      toastError('Erro ao carregar extrato', err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarMovs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroContaId])

  const diasComMovimento = fluxoProjetado.filter(
    (d, idx) => idx === 0 || d.entradas_previstas > 0 || d.saidas_previstas > 0 || d.saldo_acumulado < 0,
  )

  return (
    <div className="flex flex-col gap-16">
      {/* 1. PREVISÃO DE FLUXO DE CAIXA (30 DIAS) */}
      <div className="card">
        <div className="flex justify-between items-center flex-wrap gap-8 mb-12">
          <div>
            <h3 className="text-base font-bold m-0">Previsão de Fluxo de Caixa (Próximos 30 dias)</h3>
            <p className="text-xs text-muted mt-4">
              Projeção dia a dia somando o saldo atual dos bancos + títulos a receber − títulos a pagar.
            </p>
          </div>
          <div className="flex gap-8 flex-wrap">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setTransfForm({
                  conta_origem_id: contas[0]?.id || '',
                  conta_destino_id: contas[1]?.id || '',
                  valor: '',
                  data_movimento: hojeIsoLocal(),
                  historico: '',
                })
                setModalTransfOpen(true)
              }}
              disabled={contas.length < 2}
            >
              <ArrowLeftRight size={14} /> Transferir entre Contas
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                setMovForm({
                  conta_bancaria_id: contas[0]?.id || '',
                  tipo: 'SAIDA',
                  valor: '',
                  data_movimento: hojeIsoLocal(),
                  forma_pagamento: 'PIX',
                  historico: '',
                })
                setModalMovOpen(true)
              }}
            >
              <Plus size={14} /> Lançamento Avulso no Caixa
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th style={{ textAlign: 'right' }}>Entradas Previstas</th>
                <th style={{ textAlign: 'right' }}>Saídas Previstas</th>
                <th style={{ textAlign: 'right' }}>Resultado Dia</th>
                <th style={{ textAlign: 'right' }}>Saldo Projetado Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {diasComMovimento.map((d) => (
                <tr key={d.data}>
                  <td className="font-mono font-bold">{fmtData(d.data)}</td>
                  <td style={{ textAlign: 'right' }} className="font-mono text-success">
                    {d.entradas_previstas > 0 ? `+ ${fmtMoeda(d.entradas_previstas)}` : '-'}
                  </td>
                  <td style={{ textAlign: 'right' }} className="font-mono text-danger">
                    {d.saidas_previstas > 0 ? `- ${fmtMoeda(d.saidas_previstas)}` : '-'}
                  </td>
                  <td
                    style={{ textAlign: 'right' }}
                    className={`font-mono ${d.saldo_dia > 0 ? 'text-success' : d.saldo_dia < 0 ? 'text-danger' : 'text-muted'}`}
                  >
                    {fmtMoeda(d.saldo_dia)}
                  </td>
                  <td
                    style={{ textAlign: 'right' }}
                    className={`font-mono font-bold ${d.saldo_acumulado < 0 ? 'text-danger' : 'text-cyan'}`}
                  >
                    {fmtMoeda(d.saldo_acumulado)} {d.saldo_acumulado < 0 ? '⚠️' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. EXTRATO REALIZADO */}
      <div className="card">
        <div className="flex justify-between items-center flex-wrap gap-10 mb-12">
          <div>
            <h3 className="text-base font-bold m-0">Extrato Bancário &amp; Movimentações Realizadas</h3>
            <div className="text-xs text-muted mt-4">
              Entradas: <strong className="text-success">{fmtMoeda(resumoMov.total_entradas)}</strong> • Saídas:{' '}
              <strong className="text-danger">{fmtMoeda(resumoMov.total_saidas)}</strong> • Líquido:{' '}
              <strong className="text-cyan">{fmtMoeda(resumoMov.saldo_periodo)}</strong>
            </div>
          </div>
          <div className="flex gap-8 items-center">
            <select
              className="form-input"
              style={{ width: 230, height: 34, padding: '4px 10px' }}
              value={filtroContaId}
              onChange={(e) => setFiltroContaId(e.target.value)}
            >
              <option value="">Todas as Contas / Caixas</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.nome}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn--ghost btn--sm" onClick={carregarMovs}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Conta / Banco</th>
                <th>Tipo</th>
                <th>Histórico / Título</th>
                <th>Forma</th>
                <th>Operador</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center p-24 text-muted">
                    Carregando extrato...
                  </td>
                </tr>
              ) : movs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center p-24 text-muted">
                    Nenhuma movimentação financeira realizada ainda.
                  </td>
                </tr>
              ) : (
                movs.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs">{fmtData(m.data_movimento)}</td>
                    <td className="text-xs font-bold">
                      {m.conta_codigo} — {m.conta_nome}
                    </td>
                    <td>
                      {m.tipo === 'ENTRADA' ? (
                        <span className="badge badge--success">
                          <ArrowDownLeft size={12} /> Entrada
                        </span>
                      ) : (
                        <span className="badge badge--danger">
                          <ArrowUpRight size={12} /> Saída
                        </span>
                      )}
                    </td>
                    <td className="text-xs">
                      <div className="font-bold">{m.historico}</div>
                      <div className="text-muted">
                        {m.categoria} {m.titulo_codigo ? `• ${m.titulo_codigo}` : ''}
                      </div>
                    </td>
                    <td className="text-xs">{m.forma_pagamento || '-'}</td>
                    <td className="text-xs text-muted">{m.operador_nome || '-'}</td>
                    <td
                      style={{ textAlign: 'right' }}
                      className={`font-mono font-bold ${m.tipo === 'ENTRADA' ? 'text-success' : 'text-danger'}`}
                    >
                      {m.tipo === 'ENTRADA' ? '+' : '-'} {fmtMoeda(m.valor)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Lançamento Avulso */}
      {modalMovOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalMovOpen(false)}>
          <div className="card" style={{ width: '96%', maxWidth: 520, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0">Lançamento Avulso no Caixa / Banco</h3>
              <button type="button" className="btn-icon" onClick={() => setModalMovOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form
              className="p-20 flex flex-col gap-12"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await financeiroQueries.criarMovimentacao({
                    ...movForm,
                    valor: Number(String(movForm.valor).replace(',', '.')),
                  })
                  toastSuccess('Movimentação registrada ✅', 'Saldo da conta atualizado.')
                  setModalMovOpen(false)
                  await Promise.all([carregarMovs(), onAtualizar?.()])
                } catch (err) {
                  toastError('Erro', err.message)
                }
              }}
            >
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Tipo *</label>
                  <select className="form-input" value={movForm.tipo} onChange={(e) => setMovForm({ ...movForm, tipo: e.target.value })}>
                    <option value="ENTRADA">Entrada (+)</option>
                    <option value="SAIDA">Saída (-)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Conta / Caixa *</label>
                  <select className="form-input" required value={movForm.conta_bancaria_id} onChange={(e) => setMovForm({ ...movForm, conta_bancaria_id: e.target.value })}>
                    <option value="">Selecione...</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} — {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Valor (R$) *</label>
                  <input type="number" step="0.01" min="0.01" required className="form-input font-mono text-right" value={movForm.valor} onChange={(e) => setMovForm({ ...movForm, valor: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Data</label>
                  <input type="date" className="form-input" value={movForm.data_movimento} onChange={(e) => setMovForm({ ...movForm, data_movimento: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Forma</label>
                  <input type="text" className="form-input" value={movForm.forma_pagamento} onChange={(e) => setMovForm({ ...movForm, forma_pagamento: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="form-label">Histórico *</label>
                <input type="text" required className="form-input" placeholder="Ex: Tarifa bancária / Aporte de caixa..." value={movForm.historico} onChange={(e) => setMovForm({ ...movForm, historico: e.target.value })} />
              </div>
              <div className="flex justify-end gap-8 pt-8 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalMovOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  Gravar Movimentação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transferência entre Contas */}
      {modalTransfOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalTransfOpen(false)}>
          <div className="card" style={{ width: '96%', maxWidth: 520, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0">Transferência entre Contas / Bancos</h3>
              <button type="button" className="btn-icon" onClick={() => setModalTransfOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form
              className="p-20 flex flex-col gap-12"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await financeiroQueries.transferirEntreContas({
                    ...transfForm,
                    valor: Number(String(transfForm.valor).replace(',', '.')),
                  })
                  toastSuccess('Transferência realizada ✅', 'Saldos de origem e destino atualizados.')
                  setModalTransfOpen(false)
                  await Promise.all([carregarMovs(), onAtualizar?.()])
                } catch (err) {
                  toastError('Erro', err.message)
                }
              }}
            >
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Conta de Origem (Sai) *</label>
                  <select className="form-input" required value={transfForm.conta_origem_id} onChange={(e) => setTransfForm({ ...transfForm, conta_origem_id: e.target.value })}>
                    <option value="">Selecione...</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} — {c.nome} ({fmtMoeda(c.saldo_atual)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Conta de Destino (Entra) *</label>
                  <select className="form-input" required value={transfForm.conta_destino_id} onChange={(e) => setTransfForm({ ...transfForm, conta_destino_id: e.target.value })}>
                    <option value="">Selecione...</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} — {c.nome} ({fmtMoeda(c.saldo_atual)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Valor (R$) *</label>
                  <input type="number" step="0.01" min="0.01" required className="form-input font-mono text-right" value={transfForm.valor} onChange={(e) => setTransfForm({ ...transfForm, valor: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Data</label>
                  <input type="date" className="form-input" value={transfForm.data_movimento} onChange={(e) => setTransfForm({ ...transfForm, data_movimento: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="form-label">Histórico (Opcional)</label>
                <input type="text" className="form-input" placeholder="Ex: Depósito de sangria do caixa..." value={transfForm.historico} onChange={(e) => setTransfForm({ ...transfForm, historico: e.target.value })} />
              </div>
              <div className="flex justify-end gap-8 pt-8 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalTransfOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <ArrowLeftRight size={15} /> Confirmar Transferência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const CONTA_INICIAL = {
  id: null,
  codigo: '',
  nome: '',
  tipo: 'CONTA_CORRENTE',
  banco_codigo: '',
  agencia: '',
  conta: '',
  chave_pix: '',
  local_cobranca_id: '',
  saldo_inicial: 0,
  padrao: false,
}

export function AbaContasBancos({ contas = [], locaisCobranca = [], onAtualizar, toastSuccess, toastError, confirmar }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(CONTA_INICIAL)

  const handleSalvar = async (e) => {
    e.preventDefault()
    try {
      await financeiroQueries.salvarConta({
        ...form,
        saldo_inicial: Number(String(form.saldo_inicial || '0').replace(',', '.')) || 0,
        local_cobranca_id: form.local_cobranca_id || null,
        padrao: form.padrao ? 1 : 0,
      })
      toastSuccess('Conta salva ✅', `${form.nome} atualizada com sucesso.`)
      setModalOpen(false)
      await onAtualizar?.()
    } catch (err) {
      toastError('Erro ao salvar conta', err.message)
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <div className="flex justify-between items-center flex-wrap gap-10">
        <div>
          <h3 className="text-base font-bold m-0">Contas Bancárias &amp; Caixas (Cadastro Enxuto)</h3>
          <p className="text-xs text-muted mt-4">
            Apenas o essencial para controlar saldos, baixas, PIX e extrato — sem a burocracia de CNAB antigo.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setForm(CONTA_INICIAL)
            setModalOpen(true)
          }}
        >
          <Plus size={16} /> Nova Conta / Banco
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {contas.map((c) => (
          <div key={c.id} className="card flex flex-col justify-between gap-12">
            <div>
              <div className="flex justify-between items-start gap-8">
                <div className="flex items-center gap-8">
                  {c.tipo === 'CAIXA_FISICO' ? (
                    <Wallet size={20} className="text-warning" />
                  ) : (
                    <Landmark size={20} className="text-cyan" />
                  )}
                  <div>
                    <div className="font-bold text-sm">
                      {c.codigo} — {c.nome}
                    </div>
                    <div className="text-xs text-muted">{TIPO_CONTA_LABEL[c.tipo] || c.tipo}</div>
                  </div>
                </div>
                {Number(c.padrao) === 1 && <span className="badge badge--info">Padrão</span>}
              </div>

              <div className="mt-12 p-10 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="text-xs text-muted">Saldo Atual</div>
                <div className={`text-xl font-bold font-mono ${c.saldo_atual < 0 ? 'text-danger' : 'text-success'}`}>
                  {fmtMoeda(c.saldo_atual)}
                </div>
              </div>

              <div className="text-xs text-muted mt-10 flex flex-col gap-4">
                {(c.banco_codigo || c.agencia || c.conta) && (
                  <div>
                    Banco: <strong>{c.banco_codigo || '-'}</strong> • Ag: <strong>{c.agencia || '-'}</strong> • Cc:{' '}
                    <strong>{c.conta || '-'}</strong>
                  </div>
                )}
                {c.chave_pix && (
                  <div>
                    Chave PIX: <span className="font-mono text-primary">{c.chave_pix}</span>
                  </div>
                )}
                <div>Saldo Inicial: {fmtMoeda(c.saldo_inicial)}</div>
              </div>
            </div>

            <div className="flex justify-end gap-6 pt-8 border-t border-border">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setForm({
                    id: c.id,
                    codigo: c.codigo || '',
                    nome: c.nome || '',
                    tipo: c.tipo || 'CONTA_CORRENTE',
                    banco_codigo: c.banco_codigo || '',
                    agencia: c.agencia || '',
                    conta: c.conta || '',
                    chave_pix: c.chave_pix || '',
                    local_cobranca_id: c.local_cobranca_id || '',
                    saldo_inicial: Number(c.saldo_inicial || 0),
                    padrao: Number(c.padrao) === 1,
                  })
                  setModalOpen(true)
                }}
              >
                <Edit2 size={14} /> Editar
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm text-danger"
                onClick={async () => {
                  const ok = await confirmar({
                    title: 'Desativar Conta',
                    message: `Deseja desativar a conta "${c.nome}"? O histórico de movimentações será preservado.`,
                    type: 'error',
                    confirmLabel: 'Desativar',
                  })
                  if (!ok) return
                  try {
                    await financeiroQueries.desativarConta(c.id)
                    toastSuccess('Desativada', 'Conta bancária removida da lista ativa.')
                    await onAtualizar?.()
                  } catch (err) {
                    toastError('Erro', err.message)
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <div className="card" style={{ width: '96%', maxWidth: 620, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0 flex items-center gap-8">
                <Building2 size={17} className="text-primary" /> {form.id ? 'Editar Conta / Banco' : 'Nova Conta / Banco'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvar} className="p-20 flex flex-col gap-12">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código *</label>
                  <input className="form-input font-mono" required placeholder="Ex: ITAU1" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Nome da Conta / Banco *</label>
                  <input className="form-input" required placeholder="Ex: BANCO DO BRASIL EMPRESA" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Tipo</label>
                  <select className="form-input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                    <option value="CONTA_CORRENTE">Conta Corrente</option>
                    <option value="CAIXA_FISICO">Caixa Físico</option>
                    <option value="CARTEIRA_PIX">Carteira PIX / Digital</option>
                    <option value="POUPANCA">Poupança</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Saldo Inicial (R$)</label>
                  <input type="number" step="0.01" className="form-input font-mono text-right" value={form.saldo_inicial} onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Local Cobrança (Opc.)</label>
                  <select className="form-input" value={form.local_cobranca_id} onChange={(e) => setForm({ ...form, local_cobranca_id: e.target.value })}>
                    <option value="">-- Nenhum --</option>
                    {locaisCobranca.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.codigo} — {l.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Cód. Banco (FEBRABAN)</label>
                  <input className="form-input font-mono" placeholder="Ex: 001, 341" value={form.banco_codigo} onChange={(e) => setForm({ ...form, banco_codigo: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Agência</label>
                  <input className="form-input font-mono" placeholder="Ex: 02089" value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Número da Conta</label>
                  <input className="form-input font-mono" placeholder="Ex: 816884-1" value={form.conta} onChange={(e) => setForm({ ...form, conta: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="form-label">Chave PIX (Opcional)</label>
                <input className="form-input" placeholder="CNPJ, e-mail ou chave aleatória..." value={form.chave_pix} onChange={(e) => setForm({ ...form, chave_pix: e.target.value })} />
              </div>
              <label className="flex items-center gap-8 text-sm cursor-pointer">
                <input type="checkbox" checked={Boolean(form.padrao)} onChange={(e) => setForm({ ...form, padrao: e.target.checked })} />
                Definir como <strong>Conta Padrão</strong> para baixas automáticas
              </label>
              <div className="flex justify-end gap-8 pt-10 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  Salvar Conta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
