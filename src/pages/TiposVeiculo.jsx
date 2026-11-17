import React, { useState, useEffect, useCallback } from 'react'
import { Truck, Plus, Edit2, Trash2, X, Save, Gauge } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const CATEGORIAS = [
  { value: 'UTILITARIO', label: 'Utilitário / Fiorino' },
  { value: 'VAN', label: 'Van / Baú Médio' },
  { value: 'CAMINHAO', label: 'Caminhão (3/4, Toco, Truck)' },
  { value: 'CARRETA', label: 'Carreta Frigorífica' },
  { value: 'OUTRO', label: 'Outro Veículo' },
]

const FORM_INICIAL = {
  id: null,
  nome: '',
  categoria: 'UTILITARIO',
  capacidade_kg: '650',
  tolerancia_pct: '10',
  observacoes: '',
}

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`

export function TiposVeiculo() {
  const { toastSuccess, toastError, confirmar } = useAppStore()
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState(FORM_INICIAL)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await cadastrosQueries.listarTiposVeiculo()
      setLista(rows || [])
    } catch (err) {
      toastError('Erro ao carregar veículos', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const abrirNovo = () => {
    setForm(FORM_INICIAL)
    setModalOpen(true)
  }

  const abrirEditar = (item) => {
    setForm({
      id: item.id,
      nome: item.nome || '',
      categoria: item.categoria || 'UTILITARIO',
      capacidade_kg: String(item.capacidade_kg ?? 650),
      tolerancia_pct: String(item.tolerancia_pct ?? 10),
      observacoes: item.observacoes || '',
    })
    setModalOpen(true)
  }

  const handleSalvar = async (e) => {
    e.preventDefault()
    setSalvando(true)
    try {
      await cadastrosQueries.salvarTipoVeiculo({
        id: form.id,
        nome: form.nome.trim(),
        categoria: form.categoria,
        capacidade_kg: Number(String(form.capacidade_kg).replace(',', '.')),
        tolerancia_pct: Number(String(form.tolerancia_pct).replace(',', '.')),
        observacoes: form.observacoes.trim(),
      })
      toastSuccess('Salvo', form.id ? 'Tipo de veículo atualizado.' : 'Tipo de veículo cadastrado.')
      setModalOpen(false)
      carregar()
    } catch (err) {
      toastError('Erro ao salvar', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const handleExcluir = async (item) => {
    const ok = await confirmar({
      title: 'Excluir Tipo de Veículo',
      message: `Deseja inativar "${item.nome}" (${fmtKg(item.capacidade_kg)}) da seleção de novos embarques?`,
      type: 'error',
      confirmLabel: 'Excluir',
    })
    if (!ok) return
    try {
      await cadastrosQueries.excluirTipoVeiculo(item.id)
      toastSuccess('Removido', 'Tipo de veículo inativado com sucesso.')
      carregar()
    } catch (err) {
      toastError('Erro ao excluir', err.message)
    }
  }

  const capPreview = Number(String(form.capacidade_kg || 0).replace(',', '.')) || 0
  const tolPreview = Number(String(form.tolerancia_pct || 0).replace(',', '.')) || 0
  const maxPreview = capPreview * (1 + tolPreview / 100)

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Gauge className="text-primary" size={26} /> Tipos de Veículo &amp; Capacidade de Carga
          </h1>
          <p className="page-header__subtitle">
            Cadastre os perfis de veículos da transportadora (Fiorino, Van, Caminhão, etc.) e defina o peso limite e margem de tolerância para roteirização
          </p>
        </div>
        <button className="btn btn--primary" disabled={!isApiEnabled()} onClick={abrirNovo}>
          <Plus size={18} /> Novo Tipo de Veículo
        </button>
      </div>

      <ApiModeRequiredBanner modulo="Tipos de Veículo" />

      <div className="table-container">
        {loading ? (
          <div className="p-24 text-center text-muted">Carregando tipos de veículo...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nome / Modelo do Veículo</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Limite Nominal</th>
                <th style={{ textAlign: 'center' }}>Tolerância (%)</th>
                <th style={{ textAlign: 'right' }}>Teto Máximo c/ Tolerância</th>
                <th>Observações</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                    Nenhum tipo de veículo cadastrado.
                  </td>
                </tr>
              ) : (
                lista.map((item) => {
                  const catLabel = CATEGORIAS.find((c) => c.value === item.categoria)?.label || item.categoria
                  return (
                    <tr key={item.id}>
                      <td className="font-bold flex items-center gap-8">
                        <Truck size={15} className="text-primary" />
                        {item.nome}
                      </td>
                      <td>
                        <span className="badge badge--info">{catLabel}</span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-bold">
                        {fmtKg(item.capacidade_kg)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="badge badge--warning">+{Number(item.tolerancia_pct || 0)}%</span>
                      </td>
                      <td style={{ textAlign: 'right', color: '#22c55e' }} className="font-bold">
                        {fmtKg(item.capacidade_maxima_kg)}
                      </td>
                      <td className="text-muted text-sm">{item.observacoes || '-'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          style={{ marginRight: 6 }}
                          onClick={() => abrirEditar(item)}
                          title="Editar"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => handleExcluir(item)}
                          title="Excluir"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 95,
            backgroundColor: 'rgba(5,9,18,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '95vw', maxWidth: 520, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>{form.id ? 'Editar Tipo de Veículo' : 'Novo Tipo de Veículo'}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSalvar} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label">Nome / Descrição do Carro *</label>
                <input
                  className="form-input"
                  required
                  placeholder="Ex: Carro Pequeno (Fiorino) ou Caminhão 3/4"
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">Categoria *</label>
                  <select
                    className="form-input"
                    value={form.categoria}
                    onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Limite Nominal (kg) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    className="form-input"
                    required
                    value={form.capacidade_kg}
                    onChange={(e) => setForm((f) => ({ ...f, capacidade_kg: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Tolerância Extra (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    className="form-input"
                    value={form.tolerancia_pct}
                    onChange={(e) => setForm((f) => ({ ...f, tolerancia_pct: e.target.value }))}
                  />
                </div>
              </div>

              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.35)',
                  fontSize: 12.5,
                  color: '#86efac',
                }}
              >
                Capacidade nominal: <strong>{fmtKg(capPreview)}</strong> • Teto máximo permitido c/ tolerância de{' '}
                <strong>+{tolPreview}%</strong>: <strong>{fmtKg(maxPreview)}</strong>
              </div>

              <div>
                <label className="form-label">Observações</label>
                <input
                  className="form-input"
                  placeholder="Ex: Restrição urbana VUC / Baú refrigerado..."
                  value={form.observacoes}
                  onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button type="button" className="btn btn--secondary" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvando}>
                  <Save size={15} /> {salvando ? 'Salvando...' : 'Salvar Tipo de Veículo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
