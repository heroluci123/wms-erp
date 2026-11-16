import React, { useState, useEffect, useCallback } from 'react'
import { Briefcase, Plus, Edit2, Trash2, X, Save, UserCheck } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { operadoresQueries } from '../queries/operadores'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalDialog } from '../components/shared/ModalDialog'

const FORM_INICIAL = {
  id: null,
  codigo: '',
  sigla: '',
  nome: '',
  operador_id: '',
  tipo_comissao: 'PCT_VENDA',
  pct_comissao: 1.5,
  regra_liberacao: 'FATURAMENTO',
  meta_mensal_kg: 0,
  meta_mensal_valor: 0,
}

const LABELS_COMISSAO = {
  PCT_VENDA: '% sobre Venda Faturada',
  PCT_MARGEM: '% sobre Margem Bruta',
  VALOR_KG: 'R$ fixo por Kg expedido',
}

export function Vendedores() {
  const { toastSuccess, toastError } = useAppStore()
  const [lista, setLista] = useState([])
  const [operadores, setOperadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState(FORM_INICIAL)
  const [confirmDlg, setConfirmDlg] = useState({ isOpen: false, target: null })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [vendRes, opRes] = await Promise.all([
        cadastrosQueries.listarVendedores(),
        operadoresQueries.listar({ incluirInativos: false }).catch(() => []),
      ])
      setLista(vendRes || [])
      setOperadores(opRes || [])
    } catch (err) {
      toastError('Erro ao carregar vendedores', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const handleSalvar = async (e) => {
    e.preventDefault()
    if (!form.codigo.trim() || !form.nome.trim()) {
      return toastError('Campos obrigatórios', 'Informe Código e Nome do vendedor.')
    }
    setSalvando(true)
    try {
      await cadastrosQueries.salvarVendedor({
        ...form,
        operador_id: form.operador_id || null,
        pct_comissao: Number(form.pct_comissao || 0),
        meta_mensal_kg: Number(form.meta_mensal_kg || 0),
        meta_mensal_valor: Number(form.meta_mensal_valor || 0),
      })
      toastSuccess('Vendedor salvo', `${form.nome} atualizado com sucesso.`)
      setModalOpen(false)
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Briefcase className="text-primary" size={26} /> Vendedores, Metas & Regras de Comissão
          </h1>
          <p className="page-header__subtitle">
            Equipe comercial com sigla (ex: CH), vínculo opcional a conta do sistema e cálculo por faturamento ou liquidação
          </p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => {
            setForm(FORM_INICIAL)
            setModalOpen(true)
          }}
          disabled={!isApiEnabled()}
        >
          <Plus size={18} /> Novo Vendedor
        </button>
      </div>

      <ApiModeRequiredBanner modulo="Vendedores e Comissões" />

      <div className="table-container">
        {loading ? (
          <div className="p-24 text-center text-muted">Carregando...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Sigla</th>
                <th>Nome</th>
                <th>Usuário Vinculado</th>
                <th>Tipo Comissão</th>
                <th>Liberação</th>
                <th style={{ textAlign: 'right' }}>Comissão</th>
                <th style={{ textAlign: 'right' }}>Metas Mensais</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                    Nenhum vendedor cadastrado.
                  </td>
                </tr>
              ) : (
                lista.map((v) => (
                  <tr key={v.id}>
                    <td className="td-mono">{v.codigo}</td>
                    <td>
                      <span className="badge badge--info">{v.sigla || '-'}</span>
                    </td>
                    <td className="font-bold">{v.nome}</td>
                    <td>
                      {v.operador_nome ? (
                        <span className="badge badge--success">
                          <UserCheck size={12} /> {v.operador_nome} ({v.operador_login})
                        </span>
                      ) : (
                        <span className="td-muted">Sem login vinculado</span>
                      )}
                    </td>
                    <td>{LABELS_COMISSAO[v.tipo_comissao] || v.tipo_comissao}</td>
                    <td>
                      <span className={`badge ${v.regra_liberacao === 'LIQUIDACAO' ? 'badge--warning' : 'badge--ghost'}`}>
                        {v.regra_liberacao === 'LIQUIDACAO' ? 'Na Liquidação (Pago)' : 'Ao Faturar'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="td-mono font-bold text-success">
                      {v.tipo_comissao === 'VALOR_KG'
                        ? `R$ ${Number(v.pct_comissao || 0).toFixed(2)}/kg`
                        : `${Number(v.pct_comissao || 0).toFixed(2)}%`}
                    </td>
                    <td style={{ textAlign: 'right' }} className="td-mono">
                      <div>{Number(v.meta_mensal_kg || 0).toLocaleString('pt-BR')} kg</div>
                      <div className="td-muted">
                        R$ {Number(v.meta_mensal_valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-6">
                        <button
                          className="btn btn--ghost btn--icon"
                          disabled={!isApiEnabled()}
                          onClick={() => {
                            setForm({
                              id: v.id,
                              codigo: v.codigo || '',
                              sigla: v.sigla || '',
                              nome: v.nome || '',
                              operador_id: v.operador_id || '',
                              tipo_comissao: v.tipo_comissao || 'PCT_VENDA',
                              pct_comissao: Number(v.pct_comissao || 0),
                              regra_liberacao: v.regra_liberacao || 'FATURAMENTO',
                              meta_mensal_kg: Number(v.meta_mensal_kg || 0),
                              meta_mensal_valor: Number(v.meta_mensal_valor || 0),
                            })
                            setModalOpen(true)
                          }}
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          className="btn btn--ghost btn--icon text-danger"
                          disabled={!isApiEnabled()}
                          onClick={() => setConfirmDlg({ isOpen: true, target: v })}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div
          className="flex items-center justify-center p-24 fade-in"
          style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)', backdropFilter: 'blur(4px)' }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 680, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{form.id ? 'Editar Vendedor' : 'Novo Vendedor'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvar} className="p-20 flex flex-col gap-14">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código *</label>
                  <input className="form-input" required value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="Ex: 4" />
                </div>
                <div>
                  <label className="form-label">Sigla</label>
                  <input className="form-input" value={form.sigla} onChange={(e) => setForm({ ...form, sigla: e.target.value.toUpperCase() })} placeholder="Ex: CH" />
                </div>
                <div>
                  <label className="form-label">Conta de Acesso (opcional)</label>
                  <select className="form-input" value={form.operador_id} onChange={(e) => setForm({ ...form, operador_id: e.target.value })}>
                    <option value="">-- Sem vínculo --</option>
                    {operadores.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.nome} ({op.login})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">Nome Completo *</label>
                <input className="form-input" required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value.toUpperCase() })} placeholder="Ex: CARLOS HENRIQUE" />
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Modelo de Comissão</label>
                  <select className="form-input" value={form.tipo_comissao} onChange={(e) => setForm({ ...form, tipo_comissao: e.target.value })}>
                    <option value="PCT_VENDA">% sobre Venda Faturada</option>
                    <option value="PCT_MARGEM">% sobre Margem</option>
                    <option value="VALOR_KG">R$ fixo por Kg</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">
                    {form.tipo_comissao === 'VALOR_KG' ? 'Valor (R$/kg)' : 'Percentual (%)'}
                  </label>
                  <input type="number" step="0.01" className="form-input" value={form.pct_comissao} onChange={(e) => setForm({ ...form, pct_comissao: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Quando Libera Comissão</label>
                  <select className="form-input" value={form.regra_liberacao} onChange={(e) => setForm({ ...form, regra_liberacao: e.target.value })}>
                    <option value="FATURAMENTO">Ao Faturar / Expedir</option>
                    <option value="LIQUIDACAO">Só após Liquidação do Boleto</option>
                  </select>
                </div>
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Meta Mensal (kg)</label>
                  <input type="number" step="0.01" className="form-input" value={form.meta_mensal_kg} onChange={(e) => setForm({ ...form, meta_mensal_kg: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Meta Mensal (R$)</label>
                  <input type="number" step="0.01" className="form-input" value={form.meta_mensal_valor} onChange={(e) => setForm({ ...form, meta_mensal_valor: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvando}>
                  <Save size={16} /> {salvando ? 'Salvando...' : 'Salvar Vendedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalDialog
        isOpen={confirmDlg.isOpen}
        type="confirm"
        title="Desativar Vendedor"
        message={`Deseja desativar "${confirmDlg.target?.nome || ''}"?`}
        onClose={() => setConfirmDlg({ isOpen: false, target: null })}
        confirmLabel="Sim, desativar"
        onConfirm={async () => {
          try {
            await cadastrosQueries.excluirVendedor(confirmDlg.target.id)
            toastSuccess('Vendedor desativado', 'Registro atualizado.')
            setConfirmDlg({ isOpen: false, target: null })
            carregar()
          } catch (err) {
            toastError('Erro', err.message)
          }
        }}
      />
    </div>
  )
}
