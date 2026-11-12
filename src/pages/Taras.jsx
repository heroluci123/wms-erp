import React, { useState, useEffect, useCallback } from 'react'
import { Scale, Plus, Edit3, Check, X, Star, Power } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { tarasQueries } from '../queries/taras'
import { fmtKg3, parseNumero } from '../utils/rastreabilidade'

export function Taras() {
  const { toastSuccess, toastError } = useAppStore()
  const [taras, setTaras] = useState([])
  const [loading, setLoading] = useState(true)
  const [nome, setNome] = useState('')
  const [pesoKg, setPesoKg] = useState('')
  const [padrao, setPadrao] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({ nome: '', peso_kg: '', padrao: false })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const lista = await tarasQueries.listar(false)
      setTaras(lista)
    } catch (err) {
      toastError('Erro', `Falha ao carregar taras: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => { carregar() }, [carregar])

  async function handleCriar(e) {
    e.preventDefault()
    const peso = parseNumero(pesoKg)
    if (!nome.trim()) return toastError('Campo obrigatório', 'Informe o nome da tara (ex: Caixa de 1,000 kg).')
    if (!Number.isFinite(peso) || peso < 0) return toastError('Valor inválido', 'Informe um peso válido em kg.')

    setSalvando(true)
    try {
      await tarasQueries.criar({ nome: nome.trim(), peso_kg: peso, padrao })
      toastSuccess('Tara cadastrada', `${nome.trim()} (${fmtKg3(peso)}) salva com sucesso.`)
      setNome('')
      setPesoKg('')
      setPadrao(false)
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar', err.message)
    } finally {
      setSalvando(false)
    }
  }

  function iniciarEdicao(t) {
    setEditId(t.id)
    setEditForm({
      nome: t.nome || '',
      peso_kg: String(t.peso_kg ?? ''),
      padrao: Number(t.padrao) === 1,
    })
  }

  async function salvarEdicao(t) {
    const peso = parseNumero(editForm.peso_kg)
    if (!editForm.nome.trim()) return toastError('Campo obrigatório', 'Informe o nome da tara.')
    if (!Number.isFinite(peso) || peso < 0) return toastError('Valor inválido', 'Informe um peso válido em kg.')

    try {
      await tarasQueries.atualizar(t.id, {
        nome: editForm.nome.trim(),
        peso_kg: peso,
        padrao: editForm.padrao,
      })
      toastSuccess('Tara atualizada', `${editForm.nome.trim()} atualizada.`)
      setEditId(null)
      await carregar()
    } catch (err) {
      toastError('Erro ao atualizar', err.message)
    }
  }

  async function handleToggleAtivo(t) {
    try {
      const novo = await tarasQueries.alternarAtivo(t.id, t.ativo)
      toastSuccess(
        novo === 1 ? 'Tara ativada' : 'Tara inativada',
        `${t.nome} agora está ${novo === 1 ? 'disponível' : 'oculta'} nos formulários.`
      )
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  async function handleDefinirPadrao(t) {
    try {
      await tarasQueries.definirPadrao(t.id)
      toastSuccess('Tara padrão definida', `${t.nome} será selecionada automaticamente por padrão.`)
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-header__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scale size={24} color="var(--cyan)" />
            Cadastro de Taras de Embalagem
          </h1>
          <p className="page-header__subtitle">
            Gerencie as taras padronizadas usadas no cálculo automático de Peso Líquido = Peso Bruto − Tara em todo o WMS.
          </p>
        </div>
      </div>

      {/* Formulário Nova Tara */}
      <form className="card" onSubmit={handleCriar} style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          Adicionar Nova Tara
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Nome / Descrição da Tara *</label>
            <input
              type="text"
              className="form-input"
              placeholder="Ex: Caixa Papelão Grande 1,200 kg"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Peso da Tara (kg) *</label>
            <input
              type="number"
              step="0.001"
              min="0"
              className="form-input"
              placeholder="Ex: 1.000 ou 0.700"
              value={pesoKg}
              onChange={e => setPesoKg(e.target.value)}
            />
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '11px 12px',
            background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={padrao}
              onChange={e => setPadrao(e.target.checked)}
            />
            Padrão
          </label>
          <button type="submit" className="btn btn--primary" disabled={salvando}>
            <Plus size={16} /> {salvando ? 'Salvando...' : 'Cadastrar Tara'}
          </button>
        </div>
      </form>

      {/* Tabela de Taras */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Taras Cadastradas ({taras.length})
          </h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Operadores selecionam diretamente da lista — sem digitação manual de tara ou peso líquido.
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando taras...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Descrição</th>
                  <th style={{ padding: '10px 12px' }}>Peso (kg)</th>
                  <th style={{ padding: '10px 12px' }}>Padrão</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {taras.map((t) => {
                  const isEditing = editId === t.id
                  const isAtivo = Number(t.ativo) === 1
                  const isPadrao = Number(t.padrao) === 1
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            className="form-input"
                            value={editForm.nome}
                            onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))}
                          />
                        ) : (
                          <strong style={{ color: 'var(--text-primary)' }}>{t.nome}</strong>
                        )}
                      </td>
                      <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--cyan)' }}>
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            className="form-input"
                            style={{ maxWidth: 130 }}
                            value={editForm.peso_kg}
                            onChange={e => setEditForm(f => ({ ...f, peso_kg: e.target.value }))}
                          />
                        ) : (
                          fmtKg3(t.peso_kg)
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {isEditing ? (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={editForm.padrao}
                              onChange={e => setEditForm(f => ({ ...f, padrao: e.target.checked }))}
                            />
                            Padrão
                          </label>
                        ) : isPadrao ? (
                          <span className="badge" style={{ background: 'rgba(245,158,11,0.18)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.4)' }}>
                            <Star size={11} /> Padrão
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => handleDefinirPadrao(t)}
                            title="Definir como padrão"
                          >
                            Definir padrão
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span className={`badge ${isAtivo ? 'badge--success' : 'badge--danger'}`}>
                          {isAtivo ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {isEditing ? (
                            <>
                              <button type="button" className="btn btn--success btn--sm" onClick={() => salvarEdicao(t)}>
                                <Check size={14} /> Salvar
                              </button>
                              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditId(null)}>
                                <X size={14} /> Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="btn btn--secondary btn--sm" onClick={() => iniciarEdicao(t)}>
                                <Edit3 size={14} /> Editar
                              </button>
                              <button
                                type="button"
                                className={`btn btn--sm ${isAtivo ? 'btn--warning' : 'btn--success'}`}
                                onClick={() => handleToggleAtivo(t)}
                              >
                                <Power size={14} /> {isAtivo ? 'Inativar' : 'Ativar'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
