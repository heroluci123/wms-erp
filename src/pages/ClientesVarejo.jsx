import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  DollarSign,
  Edit2,
  Percent,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { cadastrosQueries } from '../queries/cadastros'
import { varejoQueries } from '../queries/varejo'
import { useAppStore } from '../store/appStore'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-')
    return `${day}/${m}/${y}`
  }
  return s
}

const FORM_VAZIO = {
  id: null,
  razao_social: '',
  nome_fantasia: '',
  cnpj_cpf: '',
  rg: '',
  data_nascimento: '',
  tipo_cliente: 'VAREJO',
  telefone: '',
  cep: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: 'SP',
  desconto_ativo: false,
  desconto_max_pct: '0',
  crediario_ativo: false,
  limite_credito: '0',
  prazo_crediario_dias: '30',
  bloqueado_financeiro: false,
}

export function ClientesVarejo() {
  const { toastSuccess, toastError } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [clientes, setClientes] = useState([])
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('TODOS') // TODOS | DESCONTO | CREDIARIO | DEVEDORES

  // Modal Cadastro / Edição
  const [modalForm, setModalForm] = useState(false)
  const [form, setForm] = useState(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)

  // Modal Receber Crediário
  const [modalReceber, setModalReceber] = useState(null) // { cliente, titulos }
  const [valorReceber, setValorReceber] = useState('')
  const [formaReceber, setFormaReceber] = useState('DINHEIRO')
  const [recebendo, setRecebendo] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const lista = await cadastrosQueries.listarClientes()
      setClientes(Array.isArray(lista) ? lista : [])
    } catch (err) {
      toastError('Erro ao carregar clientes', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clientes.filter((c) => {
      if (filtroTipo === 'DESCONTO' && Number(c.desconto_ativo) !== 1) return false
      if (filtroTipo === 'CREDIARIO' && Number(c.crediario_ativo) !== 1) return false
      if (filtroTipo === 'DEVEDORES' && Number(c.credito_utilizado || 0) <= 0.009) return false
      if (!q) return true
      const nome = `${c.nome_fantasia || ''} ${c.razao_social || ''}`.toLowerCase()
      const doc = String(c.cnpj_cpf || '').replace(/\D/g, '')
      const rg = String(c.rg || '').replace(/\D/g, '')
      return nome.includes(q) || (digits && (doc.includes(digits) || rg.includes(digits)))
    })
  }, [clientes, busca, filtroTipo])

  const abrirNovo = () => {
    setForm(FORM_VAZIO)
    setModalForm(true)
  }

  const abrirEditar = (c) => {
    setForm({
      id: c.id,
      razao_social: c.razao_social || '',
      nome_fantasia: c.nome_fantasia || c.razao_social || '',
      cnpj_cpf: c.cnpj_cpf || '',
      rg: c.rg || '',
      data_nascimento: c.data_nascimento ? String(c.data_nascimento).slice(0, 10) : '',
      tipo_cliente: c.tipo_cliente || 'VAREJO',
      telefone: c.telefone || '',
      cep: c.cep || '',
      endereco: c.endereco || '',
      numero: c.numero || '',
      complemento: c.complemento || '',
      bairro: c.bairro || '',
      cidade: c.cidade || '',
      uf: c.uf || 'SP',
      desconto_ativo: Number(c.desconto_ativo) === 1,
      desconto_max_pct: String(Number(c.desconto_max_pct || 0)),
      crediario_ativo: Number(c.crediario_ativo) === 1,
      limite_credito: String(Number(c.limite_credito || 0)),
      prazo_crediario_dias: String(Number(c.prazo_crediario_dias || 30)),
      bloqueado_financeiro: Number(c.bloqueado_financeiro) === 1,
    })
    setModalForm(true)
  }

  const handleSalvar = async (e) => {
    e.preventDefault()
    if (!form.razao_social.trim()) {
      toastError('Nome obrigatório', 'Informe o nome completo ou razão social do cliente.')
      return
    }
    setSalvando(true)
    try {
      await cadastrosQueries.salvarCliente({
        ...form,
        razao_social: form.razao_social.trim(),
        nome_fantasia: (form.nome_fantasia || form.razao_social).trim(),
        desconto_ativo: form.desconto_ativo ? 1 : 0,
        desconto_max_pct: form.desconto_ativo ? Number(form.desconto_max_pct || 0) : 0,
        crediario_ativo: form.crediario_ativo ? 1 : 0,
        limite_credito: form.crediario_ativo ? Number(form.limite_credito || 0) : 0,
        prazo_crediario_dias: Number(form.prazo_crediario_dias || 30),
        bloqueado_financeiro: form.bloqueado_financeiro ? 1 : 0,
      })
      toastSuccess(form.id ? 'Cliente atualizado!' : 'Cliente cadastrado!', form.razao_social.trim())
      setModalForm(false)
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar cliente', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const abrirReceberCrediario = async (c) => {
    try {
      const res = await varejoQueries.obterCrediarioCliente(c.id)
      setModalReceber(res)
      setValorReceber(Number(res.cliente?.credito_utilizado || 0).toFixed(2))
      setFormaReceber('DINHEIRO')
    } catch (err) {
      toastError('Erro ao carregar crediário', err.message)
    }
  }

  const handleConfirmarRecebimento = async (e) => {
    e.preventDefault()
    if (!modalReceber?.cliente) return
    setRecebendo(true)
    try {
      const res = await varejoQueries.receberCrediario({
        cliente_id: modalReceber.cliente.id,
        valor: Number(String(valorReceber || '0').replace(',', '.')),
        forma_pagamento: formaReceber,
      })
      toastSuccess(
        'Crediário recebido!',
        `${fmtMoeda(res.data.valor_recebido)} baixado • Novo limite disponível: ${fmtMoeda(res.data.credito_disponivel)}`,
      )
      setModalReceber(null)
      await carregar()
    } catch (err) {
      toastError('Erro ao receber crediário', err.message)
    } finally {
      setRecebendo(false)
    }
  }

  const kpis = useMemo(() => {
    const comDesconto = clientes.filter((c) => Number(c.desconto_ativo) === 1).length
    const comCrediario = clientes.filter((c) => Number(c.crediario_ativo) === 1).length
    const totalUtilizado = clientes.reduce((s, c) => s + Number(c.credito_utilizado || 0), 0)
    return { total: clientes.length, comDesconto, comCrediario, totalUtilizado }
  }, [clientes])

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20} className="text-primary" /> Clientes (Varejo, Desconto &amp; Crediário)
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Base unificada de clientes com trava de limite máximo de desconto e controle de crediário em tempo real
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn--primary" onClick={abrirNovo}>
            <UserPlus size={15} /> Novo Cliente
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={carregar}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Clientes Cadastrados</div>
          <div className="font-mono font-bold" style={{ fontSize: 20, marginTop: 2 }}>{kpis.total}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Com Desconto Liberado</div>
          <div className="font-mono font-bold text-success" style={{ fontSize: 20, marginTop: 2 }}>{kpis.comDesconto}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Com Crediário Ativo</div>
          <div className="font-mono font-bold text-info" style={{ fontSize: 20, marginTop: 2 }}>{kpis.comCrediario}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Crediário a Receber</div>
          <div className="font-mono font-bold text-warning" style={{ fontSize: 20, marginTop: 2 }}>{fmtMoeda(kpis.totalUtilizado)}</div>
        </div>
      </div>

      {/* FILTROS + TABELA */}
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'TODOS', label: 'Todos' },
              { id: 'DESCONTO', label: 'Com Desconto' },
              { id: 'CREDIARIO', label: 'Com Crediário' },
              { id: 'DEVEDORES', label: 'Crediário em Aberto' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`btn btn--sm ${filtroTipo === f.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setFiltroTipo(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', minWidth: 260 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 32, height: 36 }}
              placeholder="Buscar nome, CPF, CNPJ ou RG..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>CPF / CNPJ • RG</th>
                <th>Cidade / Endereço</th>
                <th>Desconto</th>
                <th>Crediário (Limite / Utilizado / Disp.)</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-muted p-24">Carregando clientes...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-muted p-24">Nenhum cliente encontrado.</td></tr>
              ) : (
                filtrados.map((c) => {
                  const temDesc = Number(c.desconto_ativo) === 1
                  const temCred = Number(c.crediario_ativo) === 1
                  const lim = Number(c.limite_credito || 0)
                  const util = Number(c.credito_utilizado || 0)
                  const disp = Number(c.credito_disponivel || 0)
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="font-bold text-sm">{c.nome_fantasia || c.razao_social}</div>
                        <div className="text-xs text-muted">
                          {c.data_nascimento ? `Nasc: ${fmtData(c.data_nascimento)}` : ''}{c.telefone ? ` • ${c.telefone}` : ''}
                        </div>
                      </td>
                      <td className="font-mono text-xs">
                        <div>{c.cnpj_cpf || '-'}</div>
                        {c.rg && <div className="text-muted">RG {c.rg}</div>}
                      </td>
                      <td className="text-xs">
                        <div>{[c.endereco, c.numero].filter(Boolean).join(', ') || '-'}</div>
                        <div className="text-muted">{[c.cidade, c.uf, c.cep].filter(Boolean).join(' • ')}</div>
                      </td>
                      <td>
                        {temDesc ? (
                          <span className="badge badge--success">
                            <Percent size={11} /> Até {Number(c.desconto_max_pct || 0).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="badge badge--neutral">Inativo</span>
                        )}
                      </td>
                      <td>
                        {temCred ? (
                          <div className="font-mono text-xs">
                            <div>
                              Disp: <strong style={{ color: disp > 0 ? '#22c55e' : '#ef4444' }}>{fmtMoeda(disp)}</strong>
                              <span className="text-muted"> / {fmtMoeda(lim)}</span>
                            </div>
                            <div className="text-muted">Utilizado: {fmtMoeda(util)}</div>
                          </div>
                        ) : (
                          <span className="badge badge--neutral">Sem Crediário</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        {temCred && util > 0.009 && (
                          <button
                            type="button"
                            className="btn btn--success btn--sm"
                            onClick={() => abrirReceberCrediario(c)}
                          >
                            <DollarSign size={13} /> Receber
                          </button>
                        )}
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => abrirEditar(c)}>
                          <Edit2 size={13} /> Editar
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL CADASTRO / EDIÇÃO DE CLIENTE */}
      {modalForm && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalForm(false)}>
          <div className="modal" style={{ maxWidth: 740, width: '96%', padding: 0, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 20px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                {form.id ? 'Editar Cliente' : 'Cadastrar Novo Cliente (Varejo)'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalForm(false)}>
                <X size={18} />
              </button>
            </div>

            <form id="form-cli-varejo" onSubmit={handleSalvar} style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* DADOS PESSOAIS */}
              <div className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
                <div className="text-xs font-bold uppercase text-primary mb-10">1. Dados Pessoais / Documentos</div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Nome Completo / Razão Social *</label>
                    <input
                      className="form-input"
                      required
                      value={form.razao_social}
                      onChange={(e) => setForm((p) => ({ ...p, razao_social: e.target.value, nome_fantasia: e.target.value }))}
                      placeholder="Ex: Luciano Antonio de Oliveira Junior"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">CPF / CNPJ</label>
                    <input
                      className="form-input font-mono"
                      value={form.cnpj_cpf}
                      onChange={(e) => setForm((p) => ({ ...p, cnpj_cpf: e.target.value }))}
                      placeholder="Somente números ou formatado"
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">RG</label>
                    <input
                      className="form-input font-mono"
                      value={form.rg}
                      onChange={(e) => setForm((p) => ({ ...p, rg: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Data de Nascimento</label>
                    <input
                      type="date"
                      className="form-input font-mono"
                      value={form.data_nascimento}
                      onChange={(e) => setForm((p) => ({ ...p, data_nascimento: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telefone / WhatsApp</label>
                    <input
                      className="form-input"
                      value={form.telefone}
                      onChange={(e) => setForm((p) => ({ ...p, telefone: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Perfil</label>
                    <select
                      className="form-input"
                      value={form.tipo_cliente}
                      onChange={(e) => setForm((p) => ({ ...p, tipo_cliente: e.target.value }))}
                    >
                      <option value="VAREJO">Varejo</option>
                      <option value="AMBOS">Varejo + Atacado</option>
                      <option value="ATACADO">Atacado</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ENDEREÇO */}
              <div className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
                <div className="text-xs font-bold uppercase text-primary mb-10">2. Endereço</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 2fr 90px', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">CEP</label>
                    <input className="form-input font-mono" value={form.cep} onChange={(e) => setForm((p) => ({ ...p, cep: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rua / Logradouro</label>
                    <input className="form-input" value={form.endereco} onChange={(e) => setForm((p) => ({ ...p, endereco: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nº</label>
                    <input className="form-input font-mono" value={form.numero} onChange={(e) => setForm((p) => ({ ...p, numero: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 80px', gap: 10 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Bairro</label>
                    <input className="form-input" value={form.bairro} onChange={(e) => setForm((p) => ({ ...p, bairro: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Cidade</label>
                    <input className="form-input" value={form.cidade} onChange={(e) => setForm((p) => ({ ...p, cidade: e.target.value }))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">UF</label>
                    <input className="form-input font-mono" maxLength={2} value={form.uf} onChange={(e) => setForm((p) => ({ ...p, uf: e.target.value.toUpperCase() }))} />
                  </div>
                </div>
              </div>

              {/* DESCONTO & CREDIÁRIO */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="card" style={{ padding: 14, background: 'var(--bg-2)', border: form.desconto_ativo ? '1px solid rgba(34,197,94,0.45)' : '1px solid var(--border)' }}>
                  <label className="flex items-center gap-8 font-bold text-sm cursor-pointer mb-10">
                    <input
                      type="checkbox"
                      checked={form.desconto_ativo}
                      onChange={(e) => setForm((p) => ({ ...p, desconto_ativo: e.target.checked }))}
                    />
                    <Percent size={15} className="text-success" /> Liberar Desconto no PDV
                  </label>
                  {form.desconto_ativo ? (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Limite Máximo de Desconto (%) *</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        className="form-input font-mono text-right"
                        style={{ fontSize: 18, fontWeight: 700 }}
                        value={form.desconto_max_pct}
                        onChange={(e) => setForm((p) => ({ ...p, desconto_max_pct: e.target.value }))}
                      />
                      <div className="text-xs text-muted mt-4">O PDV bloqueia qualquer desconto acima deste %.</div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">Ative para autorizar descontos no caixa para este cliente.</div>
                  )}
                </div>

                <div className="card" style={{ padding: 14, background: 'var(--bg-2)', border: form.crediario_ativo ? '1px solid rgba(245,158,11,0.45)' : '1px solid var(--border)' }}>
                  <label className="flex items-center gap-8 font-bold text-sm cursor-pointer mb-10">
                    <input
                      type="checkbox"
                      checked={form.crediario_ativo}
                      onChange={(e) => setForm((p) => ({ ...p, crediario_ativo: e.target.checked }))}
                    />
                    <BookOpen size={15} className="text-warning" /> Liberar Crediário
                  </label>
                  {form.crediario_ativo ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Limite de Crédito (R$) *</label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          className="form-input font-mono text-right"
                          style={{ fontSize: 18, fontWeight: 700 }}
                          value={form.limite_credito}
                          onChange={(e) => setForm((p) => ({ ...p, limite_credito: e.target.value }))}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Prazo (dias)</label>
                        <input
                          type="number"
                          min="1"
                          max="365"
                          className="form-input font-mono text-right"
                          value={form.prazo_crediario_dias}
                          onChange={(e) => setForm((p) => ({ ...p, prazo_crediario_dias: e.target.value }))}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">Ative para permitir compras no Crediário com comprovante assinado.</div>
                  )}
                </div>
              </div>
            </form>

            <div style={{ padding: '14px 20px', background: 'var(--bg-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalForm(false)}>Cancelar</button>
              <button type="submit" form="form-cli-varejo" className="btn btn--primary" disabled={salvando}>
                <CheckCircle2 size={16} /> {salvando ? 'Salvando...' : 'Salvar Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL RECEBER CREDIÁRIO */}
      {modalReceber && (
        <div className="modal-overlay" style={{ zIndex: 1070 }} onClick={(e) => e.target === e.currentTarget && setModalReceber(null)}>
          <div className="modal" style={{ maxWidth: 540, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                Receber Crediário — {modalReceber.cliente?.nome}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalReceber(null)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmarRecebimento} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2)' }}>
                  <div className="text-xs text-muted">Limite Total</div>
                  <div className="font-mono font-bold">{fmtMoeda(modalReceber.cliente?.limite_credito)}</div>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2)' }}>
                  <div className="text-xs text-muted">Utilizado (Em Aberto)</div>
                  <div className="font-mono font-bold text-warning">{fmtMoeda(modalReceber.cliente?.credito_utilizado)}</div>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2)' }}>
                  <div className="text-xs text-muted">Disponível</div>
                  <div className="font-mono font-bold text-success">{fmtMoeda(modalReceber.cliente?.credito_disponivel)}</div>
                </div>
              </div>

              {(modalReceber.titulos || []).length > 0 && (
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Título</th>
                        <th>Venc.</th>
                        <th style={{ textAlign: 'right' }}>Em Aberto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalReceber.titulos.map((t) => (
                        <tr key={t.id}>
                          <td className="font-mono text-xs">{t.codigo} • {t.numero_documento}</td>
                          <td className="font-mono text-xs">{fmtData(t.data_vencimento)}</td>
                          <td className="font-mono font-bold text-warning" style={{ textAlign: 'right' }}>{fmtMoeda(t.saldo_aberto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Valor Recebido Agora (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={Number(modalReceber.cliente?.credito_utilizado || 0)}
                    className="form-input font-mono text-right"
                    style={{ fontSize: 18, fontWeight: 700 }}
                    value={valorReceber}
                    onChange={(e) => setValorReceber(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Forma de Recebimento</label>
                  <select className="form-input" value={formaReceber} onChange={(e) => setFormaReceber(e.target.value)}>
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="PIX">PIX</option>
                    <option value="DEBITO">Débito</option>
                    <option value="CREDITO">Crédito</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalReceber(null)}>Cancelar</button>
                <button type="submit" className="btn btn--success" disabled={recebendo}>
                  <CheckCircle2 size={15} /> {recebendo ? 'Baixando...' : 'Confirmar Recebimento & Liberar Limite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
