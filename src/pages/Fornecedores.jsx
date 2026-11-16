import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Truck, Plus, Search, Edit2, Trash2, X, Save, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalDialog } from '../components/shared/ModalDialog'

const FORM_INICIAL = {
  id: null,
  codigo: '',
  razao_social: '',
  nome_fantasia: '',
  cnpj_cpf: '',
  inscricao_estadual: '',
  uf: 'SP',
  cidade: '',
  telefone: '',
  registro_sanitario_sif: '',
  prazo_entrega_dias: 5,
}

export function Fornecedores() {
  const { toastSuccess, toastError } = useAppStore()
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState(FORM_INICIAL)
  const [confirmDlg, setConfirmDlg] = useState({ isOpen: false, target: null })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await cadastrosQueries.listarFornecedores()
      setLista(rows || [])
    } catch (err) {
      toastError('Erro ao carregar fornecedores', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return lista
    return lista.filter(
      (f) =>
        String(f.razao_social || '').toLowerCase().includes(q) ||
        String(f.nome_fantasia || '').toLowerCase().includes(q) ||
        String(f.cnpj_cpf || '').toLowerCase().includes(q) ||
        String(f.registro_sanitario_sif || '').toLowerCase().includes(q)
    )
  }, [lista, busca])

  const handleSalvar = async (e) => {
    e.preventDefault()
    if (!form.razao_social.trim()) return toastError('Obrigatório', 'Informe a Razão Social do fornecedor.')
    setSalvando(true)
    try {
      await cadastrosQueries.salvarFornecedor({
        ...form,
        prazo_entrega_dias: Number(form.prazo_entrega_dias || 0),
      })
      toastSuccess('Fornecedor salvo', `${form.razao_social} cadastrado/atualizado.`)
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
            <Truck className="text-primary" size={26} /> Cadastro de Fornecedores & SIF
          </h1>
          <p className="page-header__subtitle">
            Frigoríficos, fornecedores de matéria-prima, embalagens, prazo de lead-time e registro sanitário SIF/DIPOA
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
          <Plus size={18} /> Novo Fornecedor
        </button>
      </div>

      <ApiModeRequiredBanner modulo="Fornecedores" />

      <div className="table-container">
        <div className="table-toolbar">
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: 36 }}
              placeholder="Buscar por razão social, CNPJ ou SIF..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted">{filtrados.length} fornecedor(es)</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="p-24 text-center text-muted">Carregando...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Fornecedor / Razão Social</th>
                  <th>CNPJ / CPF • IE</th>
                  <th>UF / Cidade</th>
                  <th>SIF / Registro Sanitário</th>
                  <th style={{ textAlign: 'right' }}>Prazo Entrega</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                      Nenhum fornecedor cadastrado.
                    </td>
                  </tr>
                ) : (
                  filtrados.map((f) => (
                    <tr key={f.id}>
                      <td className="td-mono">{f.codigo || '-'}</td>
                      <td>
                        <div className="font-bold">{f.razao_social}</div>
                        <div className="td-muted">{f.nome_fantasia !== f.razao_social ? f.nome_fantasia : f.telefone || '-'}</div>
                      </td>
                      <td>
                        <div className="td-mono">{f.cnpj_cpf || '-'}</div>
                        <div className="td-muted">IE: {f.inscricao_estadual || '-'}</div>
                      </td>
                      <td>
                        {f.uf} {f.cidade ? `• ${f.cidade}` : ''}
                      </td>
                      <td>
                        {f.registro_sanitario_sif ? (
                          <span className="badge badge--success">
                            <ShieldCheck size={12} /> {f.registro_sanitario_sif}
                          </span>
                        ) : (
                          <span className="td-muted">-</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} className="td-mono">
                        {f.prazo_entrega_dias ?? 5} dias
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-end gap-6">
                          <button
                            className="btn btn--ghost btn--icon"
                            disabled={!isApiEnabled()}
                            onClick={() => {
                              setForm({
                                id: f.id,
                                codigo: f.codigo || '',
                                razao_social: f.razao_social || '',
                                nome_fantasia: f.nome_fantasia || '',
                                cnpj_cpf: f.cnpj_cpf || '',
                                inscricao_estadual: f.inscricao_estadual || '',
                                uf: f.uf || 'SP',
                                cidade: f.cidade || '',
                                telefone: f.telefone || '',
                                registro_sanitario_sif: f.registro_sanitario_sif || '',
                                prazo_entrega_dias: Number(f.prazo_entrega_dias ?? 5),
                              })
                              setModalOpen(true)
                            }}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={() => setConfirmDlg({ isOpen: true, target: f })}
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
      </div>

      {modalOpen && (
        <div
          className="flex items-center justify-center p-24 fade-in"
          style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)', backdropFilter: 'blur(4px)' }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 740, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{form.id ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvar} className="p-20 flex flex-col gap-14">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código</label>
                  <input className="form-input" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Razão Social *</label>
                  <input className="form-input" required value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Nome Fantasia</label>
                  <input className="form-input" value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">CNPJ / CPF</label>
                  <input className="form-input" value={form.cnpj_cpf} onChange={(e) => setForm({ ...form, cnpj_cpf: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Inscrição Estadual</label>
                  <input className="form-input" value={form.inscricao_estadual} onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">UF</label>
                  <input className="form-input" maxLength={2} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Cidade</label>
                  <input className="form-input" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Telefone</label>
                  <input className="form-input" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Registro Sanitário (SIF / DIPOA / SISBI)</label>
                  <input className="form-input" value={form.registro_sanitario_sif} onChange={(e) => setForm({ ...form, registro_sanitario_sif: e.target.value.toUpperCase() })} placeholder="Ex: SIF 1929 / DIPOA 007" />
                </div>
                <div>
                  <label className="form-label">Prazo Médio de Entrega (dias)</label>
                  <input type="number" min="0" className="form-input" value={form.prazo_entrega_dias} onChange={(e) => setForm({ ...form, prazo_entrega_dias: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvando}>
                  <Save size={16} /> {salvando ? 'Salvando...' : 'Salvar Fornecedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalDialog
        isOpen={confirmDlg.isOpen}
        type="confirm"
        title="Desativar Fornecedor"
        message={`Deseja desativar "${confirmDlg.target?.razao_social || ''}"?`}
        onClose={() => setConfirmDlg({ isOpen: false, target: null })}
        confirmLabel="Sim, desativar"
        onConfirm={async () => {
          try {
            await cadastrosQueries.excluirFornecedor(confirmDlg.target.id)
            toastSuccess('Fornecedor removido', 'Registro desativado.')
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
