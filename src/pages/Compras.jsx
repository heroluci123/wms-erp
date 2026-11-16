import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ShoppingBag,
  Plus,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  RefreshCw,
  Eye,
  Trash2,
  AlertTriangle,
  Truck,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { temPermissao } from '../utils/permissoes'
import { isApiEnabled } from '../lib/apiClient'
import { comprasQueries } from '../queries/compras'
import { cadastrosQueries } from '../queries/cadastros'
import * as produtosQueries from '../queries/produtos.js'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`
const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const STATUS_PC_BADGE = {
  ABERTO: { label: 'Em Aberto', cls: 'badge--neutral' },
  APROVADO: { label: 'Aprovado p/ Doca', cls: 'badge--info' },
  PARCIAL: { label: 'Recebimento Parcial', cls: 'badge--warning' },
  RECEBIDO: { label: 'Recebido / Fechado', cls: 'badge--success' },
  CANCELADO: { label: 'Cancelado', cls: 'badge--danger' },
}

const STATUS_VAL_BADGE = {
  AGUARDANDO_BIPAGEM: { label: 'Aguardando Doca', cls: 'badge--neutral' },
  AGUARDANDO_VALIDACAO_SISTEMICA: { label: 'Validar 3-Way', cls: 'badge--warning' },
  DIVERGENTE: { label: 'Divergência ⚠️', cls: 'badge--danger' },
  VALIDADO: { label: 'Validado ✅', cls: 'badge--success' },
}

export function Compras() {
  const location = useLocation()
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeEscrever = temPermissao(operador, 'compras')
  const apiAtiva = isApiEnabled()

  const [loading, setLoading] = useState(false)
  const [compras, setCompras] = useState([])
  const [travaAtiva, setTravaAtiva] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [busca, setBusca] = useState('')

  const [fornecedores, setFornecedores] = useState([])
  const [produtos, setProdutos] = useState([])
  const [auxiliares, setAuxiliares] = useState({ centrosCusto: [], naturezasOperacao: [], marchantes: [] })

  // Modal Criar PC
  const [modalNovo, setModalNovo] = useState(false)
  const [fornecedorId, setFornecedorId] = useState('')
  const [finalidade, setFinalidade] = useState('MATERIA_PRIMA')
  const [centroCustoId, setCentroCustoId] = useState('')
  const [cfopPreview, setCfopPreview] = useState(null)
  const [marchante, setMarchante] = useState('FRIGODIL')
  const [freteValor, setFreteValor] = useState('')
  const [despesasValor, setDespesasValor] = useState('')
  const [previsaoEntrega, setPrevisaoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [aprovarAoCriar, setAprovarAoCriar] = useState(true)
  const [itensForm, setItensForm] = useState([])
  const [prodAddId, setProdAddId] = useState('')
  const [qtdAdd, setQtdAdd] = useState('')
  const [precoAdd, setPrecoAdd] = useState('')

  // Modal Detalhe / Validação 3-Way
  const [detalhe, setDetalhe] = useState(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [resCompras, listForn, listProd, aux] = await Promise.all([
        comprasQueries.listarCompras({ status: filtroStatus, busca }),
        apiAtiva ? cadastrosQueries.listarFornecedores().catch(() => []) : Promise.resolve([]),
        produtosQueries.listar().catch(() => []),
        apiAtiva ? cadastrosQueries.listarAuxiliares().catch(() => ({ centrosCusto: [], naturezasOperacao: [], marchantes: [] })) : Promise.resolve({ centrosCusto: [], naturezasOperacao: [], marchantes: [] }),
      ])
      setCompras(resCompras.data || [])
      setTravaAtiva(Boolean(resCompras.trava_recebimento_sem_pc))
      setFornecedores(listForn || [])
      setProdutos(listProd || [])
      setAuxiliares(aux || { centrosCusto: [], naturezasOperacao: [], marchantes: [] })
      if (!centroCustoId && aux?.centrosCusto?.length > 0) {
        setCentroCustoId(aux.centrosCusto[0].id)
      }
      const marcPadrao = (aux?.marchantes || []).find((m) => Number(m.is_padrao) === 1)?.nome || aux?.marchantes?.[0]?.nome
      if (marcPadrao) setMarchante((prev) => prev || marcPadrao)
    } catch (err) {
      toastError('Erro', err.message || 'Falha ao carregar compras.')
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, filtroStatus, busca, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Prefill vindo da Sugestão de Compras (/estoque-minimo)
  useEffect(() => {
    const pre = location.state?.prefillItens
    if (Array.isArray(pre) && pre.length > 0) {
      setItensForm(
        pre.map((p) => ({
          produto_id: p.produto_id,
          produto_codigo: p.produto_codigo,
          produto_descricao: p.produto_descricao,
          qtd_kg_solicitada: Number(p.qtd_kg_solicitada || 0),
          preco_unitario_kg: Number(p.preco_unitario_kg || 0),
        })),
      )
      setModalNovo(true)
    }
  }, [location.state])

  // Sugestão automática de CFOP Entrada ao selecionar fornecedor ou finalidade
  useEffect(() => {
    if (!apiAtiva || !fornecedorId) {
      setCfopPreview(null)
      return
    }
    const f = fornecedores.find((x) => x.id === fornecedorId)
    if (!f) return
    cadastrosQueries
      .sugerirCfop({ tipo_movimento: 'ENTRADA', finalidade, uf_parceiro: f.uf || 'SP' })
      .then((res) => setCfopPreview(res?.data || res || null))
      .catch(() => setCfopPreview(null))
  }, [apiAtiva, fornecedorId, finalidade, fornecedores])

  const kpis = useMemo(() => {
    return {
      abertos: compras.filter((c) => c.status === 'ABERTO').length,
      aprovados: compras.filter((c) => ['APROVADO', 'PARCIAL'].includes(c.status)).length,
      validacao: compras.filter((c) => ['AGUARDANDO_VALIDACAO_SISTEMICA', 'DIVERGENTE'].includes(c.status_validacao)).length,
      recebidos: compras.filter((c) => c.status === 'RECEBIDO').length,
    }
  }, [compras])

  const produtosOrdenados = useMemo(() => {
    return [...produtos].sort((a, b) => {
      const mpA = a.classificacao === 'MATERIA_PRIMA' || a.tipo_produto === 'Materia Prima' ? 0 : 1
      const mpB = b.classificacao === 'MATERIA_PRIMA' || b.tipo_produto === 'Materia Prima' ? 0 : 1
      if (mpA !== mpB) return mpA - mpB
      return String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR')
    })
  }, [produtos])

  const handleToggleTrava = async () => {
    if (!podeEscrever) return toastWarning('Sem permissão', 'Requer permissão de Compras.')
    try {
      const novo = !travaAtiva
      await comprasQueries.salvarConfigModulos({ trava_recebimento_sem_pc: novo })
      setTravaAtiva(novo)
      toastSuccess(
        novo ? 'Trava Ativada 🔒' : 'Trava Desativada',
        novo
          ? 'A Doca agora exige Pedido de Compra aprovado para receber mercadorias.'
          : 'A Doca pode receber caixas com ou sem Pedido de Compra vinculado.',
      )
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleAddItemForm = () => {
    if (!prodAddId) return toastWarning('Item', 'Selecione um produto.')
    const qtd = Number(String(qtdAdd).replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd <= 0) return toastWarning('Item', 'Informe a quantidade (kg) maior que zero.')
    const preco = Math.max(0, Number(String(precoAdd || '0').replace(',', '.')) || 0)
    const prod = produtos.find((p) => p.id === prodAddId)
    if (!prod) return

    setItensForm((prev) => {
      const idx = prev.findIndex((i) => i.produto_id === prod.id)
      if (idx >= 0) {
        const clone = [...prev]
        clone[idx] = {
          ...clone[idx],
          qtd_kg_solicitada: Number((clone[idx].qtd_kg_solicitada + qtd).toFixed(3)),
          preco_unitario_kg: preco > 0 ? preco : clone[idx].preco_unitario_kg,
        }
        return clone
      }
      return [
        ...prev,
        {
          produto_id: prod.id,
          produto_codigo: prod.codigo,
          produto_descricao: prod.descricao,
          qtd_kg_solicitada: qtd,
          preco_unitario_kg: preco || Number(prod.custo_medio_kg || 0),
        },
      ]
    })
    setProdAddId('')
    setQtdAdd('')
    setPrecoAdd('')
  }

  const handleSalvarCompra = async (e) => {
    e.preventDefault()
    if (!fornecedorId) return toastWarning('Fornecedor', 'Selecione o fornecedor.')
    if (itensForm.length === 0) return toastWarning('Itens', 'Adicione ao menos um item ao Pedido de Compra.')
    try {
      const res = await comprasQueries.criarCompra({
        fornecedor_id: fornecedorId,
        finalidade,
        centro_custo_id: centroCustoId || null,
        natureza_id: cfopPreview?.natureza_id || null,
        marchante,
        frete_valor: Number(String(freteValor || '0').replace(',', '.')) || 0,
        despesas_valor: Number(String(despesasValor || '0').replace(',', '.')) || 0,
        previsao_entrega: previsaoEntrega || null,
        observacoes,
        aprovar: aprovarAoCriar,
        itens: itensForm,
      })
      toastSuccess('Pedido de Compra Criado', `${res.codigo} (${res.status}) criado com sucesso!`)
      setModalNovo(false)
      setItensForm([])
      const marcPadrao = (auxiliares.marchantes || []).find((m) => Number(m.is_padrao) === 1)?.nome || auxiliares.marchantes?.[0]?.nome || 'FRIGODIL'
      setMarchante(marcPadrao)
      setFreteValor('')
      setDespesasValor('')
      setObservacoes('')
      carregar()
    } catch (err) {
      toastError('Erro ao salvar PC', err.message)
    }
  }

  const abrirDetalhe = async (id) => {
    try {
      const det = await comprasQueries.obterCompra(id)
      setDetalhe(det)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleAprovar = async (id) => {
    try {
      await comprasQueries.aprovarCompra(id)
      toastSuccess('Aprovado', 'Pedido de Compra liberado para recebimento na doca!')
      carregar()
      if (detalhe?.id === id) abrirDetalhe(id)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleValidarSistemica = async (id) => {
    try {
      const res = await comprasQueries.validarSistemica(id, { encerrar_pc: true })
      toastSuccess('Validação 3-Way Concluída ✅', `Entrada validada (${fmtKg(res.total_recebida_kg)}) e custos atualizados!`)
      setDetalhe(null)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleCancelar = async (id) => {
    try {
      await comprasQueries.cancelarCompra(id)
      toastSuccess('Cancelado', 'Pedido de Compra cancelado.')
      setDetalhe(null)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const totalForm =
    itensForm.reduce((s, i) => s + Number(i.qtd_kg_solicitada || 0) * Number(i.preco_unitario_kg || 0), 0) +
    (Number(String(freteValor || '0').replace(',', '.')) || 0) +
    (Number(String(despesasValor || '0').replace(',', '.')) || 0)

  if (!apiAtiva) {
    return (
      <div className="card p-24">
        <h2 className="text-lg font-bold mb-8">Pedidos de Compra (Modo ERP API)</h2>
        <p className="text-sm text-muted">
          Você está conectado no modo legado Turso. Ative o Backend API PostgreSQL (`VITE_API_URL`) para gerenciar Pedidos de Compra, trava obrigatória na doca e conferência 3-Way.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <ShoppingBag size={24} className="text-primary" /> Pedidos de Compra & Trava de Recebimento
          </h1>
          <p className="page-header__subtitle">
            Controle de compras de matéria-prima, CFOP automático por UF, vínculo obrigatório na doca e validação 3-Way
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          {podeEscrever && (
            <button
              type="button"
              className={`btn ${travaAtiva ? 'btn--warning' : 'btn--ghost'}`}
              onClick={handleToggleTrava}
              title="Quando ativada, impede bipagem no Recebimento sem Pedido de Compra aprovado"
            >
              {travaAtiva ? <Lock size={15} /> : <Unlock size={15} />}
              {travaAtiva ? 'Trava na Doca: ATIVA 🔒' : 'Trava na Doca: Desativada'}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={carregar} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          {podeEscrever && (
            <button type="button" className="btn btn--primary" onClick={() => setModalNovo(true)}>
              <Plus size={16} /> Novo Pedido de Compra
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid mb-16">
        <div className="kpi-card">
          <span className="kpi-card__label">Em Aberto (Aguardando Aprovação)</span>
          <span className="kpi-card__value">{kpis.abertos}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label text-info">Liberados para Doca</span>
          <span className="kpi-card__value text-info">{kpis.aprovados}</span>
        </div>
        <div className="kpi-card" style={{ borderColor: kpis.validacao > 0 ? 'var(--warning)' : undefined }}>
          <span className="kpi-card__label text-warning">Aguardando Validação 3-Way</span>
          <span className="kpi-card__value text-warning">{kpis.validacao}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label text-success">Recebidos / Validados</span>
          <span className="kpi-card__value text-success">{kpis.recebidos}</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="card mb-16">
        <div className="flex gap-12 flex-wrap items-end">
          <div className="form-group" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
            <label className="form-label">Buscar Pedido / Fornecedor / Marchante</label>
            <input
              type="text"
              className="form-input"
              placeholder="PC-0001, JBS, Minerva..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
            <label className="form-label">Status</label>
            <select className="form-input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
              <option value="TODOS">Todos os Status</option>
              <option value="ABERTO">Em Aberto</option>
              <option value="APROVADO">Aprovado p/ Doca</option>
              <option value="PARCIAL">Recebimento Parcial</option>
              <option value="RECEBIDO">Recebido / Fechado</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </div>
          <button type="button" className="btn btn--primary" onClick={carregar}>
            Filtrar
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Fornecedor / SIF</th>
                <th>Marchante / Centro Custo</th>
                <th>Previsão</th>
                <th style={{ textAlign: 'right' }}>Solicitado</th>
                <th style={{ textAlign: 'right' }}>Bipado Doca</th>
                <th style={{ textAlign: 'right' }}>Valor Total</th>
                <th>Status / 3-Way</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {compras.map((c) => {
                const st = STATUS_PC_BADGE[c.status] || { label: c.status, cls: 'badge--neutral' }
                const sv = c.status_validacao ? STATUS_VAL_BADGE[c.status_validacao] : null
                return (
                  <tr key={c.id}>
                    <td className="font-mono font-bold text-primary">{c.codigo}</td>
                    <td>
                      <div className="font-bold">{c.fornecedor_nome}</div>
                      <div className="text-xs text-muted">
                        UF {c.fornecedor_uf} {c.fornecedor_sif ? `• SIF ${c.fornecedor_sif}` : ''}
                      </div>
                    </td>
                    <td>
                      <div className="text-sm">{c.marchante || '-'}</div>
                      <div className="text-xs text-muted">{c.centro_custo_descricao || '-'}</div>
                    </td>
                    <td className="text-sm">{fmtData(c.previsao_entrega)}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(c.total_kg_solicitada)}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">{fmtKg(c.total_kg_recebida)}</td>
                    <td style={{ textAlign: 'right' }} className="font-bold text-success">{fmtMoeda(c.valor_total)}</td>
                    <td>
                      <div className="flex flex-col gap-4">
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {sv && <span className={`badge ${sv.cls}`}>{sv.label}</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-6">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => abrirDetalhe(c.id)}>
                          <Eye size={14} /> Abrir
                        </button>
                        {podeEscrever && c.status === 'ABERTO' && (
                          <button type="button" className="btn btn--info btn--sm" onClick={() => handleAprovar(c.id)}>
                            <CheckCircle2 size={14} /> Aprovar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {compras.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center p-24 text-muted">
                    Nenhum Pedido de Compra encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Novo Pedido de Compra */}
      {modalNovo && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setModalNovo(false)}>
          <div className="card modal-card" style={{ maxWidth: 820, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center pb-12 mb-16 border-b border-border">
              <h2 className="text-lg font-bold flex items-center gap-8">
                <ShoppingBag size={18} className="text-primary" /> Novo Pedido de Compra
              </h2>
              <button type="button" className="btn-icon" onClick={() => setModalNovo(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvarCompra} className="flex flex-col gap-16">
              <div className="form-grid form-grid--3" style={{ gap: 12 }}>
                <div className="form-group" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                  <label className="form-label">Fornecedor / Frigorífico *</label>
                  <select
                    className="form-input"
                    value={fornecedorId}
                    onChange={(e) => setFornecedorId(e.target.value)}
                    required
                  >
                    <option value="">Selecione o fornecedor...</option>
                    {fornecedores.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome_fantasia} ({f.uf}) {f.registro_sanitario_sif ? `• SIF ${f.registro_sanitario_sif}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Finalidade (CFOP Auto)</label>
                  <select className="form-input" value={finalidade} onChange={(e) => setFinalidade(e.target.value)}>
                    <option value="MATERIA_PRIMA">Matéria-Prima p/ Desossa</option>
                    <option value="REVENDA">Compra p/ Revenda</option>
                    <option value="CONSUMO">Uso e Consumo / Embalagem</option>
                  </select>
                </div>
              </div>

              {cfopPreview && (
                <div className="p-10 rounded text-xs" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)' }}>
                  CFOP Sugerido automaticamente: <strong>{cfopPreview.cfop}</strong> ({cfopPreview.descricao} • Filial {cfopPreview.uf_filial} × Fornecedor {cfopPreview.uf_parceiro})
                </div>
              )}

              <div className="form-grid form-grid--4" style={{ gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Centro de Custo</label>
                  <select className="form-input" value={centroCustoId} onChange={(e) => setCentroCustoId(e.target.value)}>
                    <option value="">Padrão</option>
                    {(auxiliares.centrosCusto || []).map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.codigo} — {cc.descricao}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Marchante / Corretor</label>
                  <select className="form-input" value={marchante} onChange={(e) => setMarchante(e.target.value)}>
                    {(auxiliares.marchantes || []).length === 0 ? (
                      <option value="FRIGODIL">001 — FRIGODIL</option>
                    ) : (
                      (auxiliares.marchantes || []).map((m) => (
                        <option key={m.id} value={m.nome}>
                          {m.codigo} — {m.nome}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Frete (R$)</label>
                  <input type="number" step="0.01" className="form-input" value={freteValor} onChange={(e) => setFreteValor(e.target.value)} placeholder="0,00" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Despesas Acess. (R$)</label>
                  <input type="number" step="0.01" className="form-input" value={despesasValor} onChange={(e) => setDespesasValor(e.target.value)} placeholder="0,00" />
                </div>
              </div>

              <div className="form-grid form-grid--2" style={{ gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Previsão Entrega</label>
                  <input type="date" className="form-input" value={previsaoEntrega} onChange={(e) => setPrevisaoEntrega(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Observações</label>
                  <input type="text" className="form-input" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Placa, condição de pagamento combinada..." />
                </div>
              </div>

              {/* Adicionar Itens */}
              <div className="p-12 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-bold uppercase text-muted mb-8">Itens do Pedido de Compra</div>
                <div className="flex gap-8 flex-wrap items-end mb-12">
                  <div className="form-group" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
                    <label className="form-label">Matéria-Prima / Produto</label>
                    <select className="form-input" value={prodAddId} onChange={(e) => {
                      const pid = e.target.value
                      setProdAddId(pid)
                      const p = produtos.find((x) => x.id === pid)
                      if (p && !precoAdd) setPrecoAdd(String(p.custo_medio_kg || p.valor_unitario || ''))
                    }}>
                      <option value="">Selecione...</option>
                      {produtosOrdenados.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo} — {p.descricao}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ width: 120, marginBottom: 0 }}>
                    <label className="form-label">Qtd (kg)</label>
                    <input type="number" step="0.001" className="form-input" value={qtdAdd} onChange={(e) => setQtdAdd(e.target.value)} placeholder="500" />
                  </div>
                  <div className="form-group" style={{ width: 130, marginBottom: 0 }}>
                    <label className="form-label">Preço/kg (R$)</label>
                    <input type="number" step="0.01" className="form-input" value={precoAdd} onChange={(e) => setPrecoAdd(e.target.value)} placeholder="25,00" />
                  </div>
                  <button type="button" className="btn btn--info" onClick={handleAddItemForm}>
                    <Plus size={15} /> Incluir
                  </button>
                </div>

                {itensForm.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th style={{ textAlign: 'right' }}>Qtd (kg)</th>
                          <th style={{ textAlign: 'right' }}>R$/kg</th>
                          <th style={{ textAlign: 'right' }}>Subtotal</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {itensForm.map((it, idx) => (
                          <tr key={it.produto_id}>
                            <td><strong>{it.produto_codigo}</strong> — {it.produto_descricao}</td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.001"
                                className="form-input"
                                style={{ width: 100, textAlign: 'right', display: 'inline-block' }}
                                value={it.qtd_kg_solicitada}
                                onChange={(e) => {
                                  const v = Number(e.target.value || 0)
                                  setItensForm((prev) => prev.map((x, i) => (i === idx ? { ...x, qtd_kg_solicitada: v } : x)))
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                className="form-input"
                                style={{ width: 100, textAlign: 'right', display: 'inline-block' }}
                                value={it.preco_unitario_kg}
                                onChange={(e) => {
                                  const v = Number(e.target.value || 0)
                                  setItensForm((prev) => prev.map((x, i) => (i === idx ? { ...x, preco_unitario_kg: v } : x)))
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'right' }} className="font-bold text-success">
                              {fmtMoeda(Number(it.qtd_kg_solicitada || 0) * Number(it.preco_unitario_kg || 0))}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => setItensForm((prev) => prev.filter((_, i) => i !== idx))}>
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center flex-wrap gap-12">
                <label className="flex items-center gap-8 text-sm cursor-pointer">
                  <input type="checkbox" checked={aprovarAoCriar} onChange={(e) => setAprovarAoCriar(e.target.checked)} />
                  Já salvar <strong>Aprovado</strong> (liberar direto para a doca receber)
                </label>
                <div className="text-right">
                  <div className="text-xs text-muted">Total Geral c/ Frete e Despesas</div>
                  <div className="text-xl font-bold text-success">{fmtMoeda(totalForm)}</div>
                </div>
              </div>

              <div className="flex justify-end gap-8">
                <button type="button" className="btn btn--ghost" onClick={() => setModalNovo(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <CheckCircle2 size={16} /> Salvar Pedido de Compra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Detalhe & Validação 3-Way */}
      {detalhe && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setDetalhe(null)}>
          <div className="card modal-card" style={{ maxWidth: 820, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center pb-12 mb-16 border-b border-border">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-8">
                  <Truck size={18} className="text-primary" /> {detalhe.codigo} — {detalhe.fornecedor_nome}
                </h2>
                <div className="text-xs text-muted">
                  UF {detalhe.fornecedor_uf} {detalhe.fornecedor_sif ? `• SIF ${detalhe.fornecedor_sif}` : ''} •{' '}
                  {detalhe.recebimento ? `Recebimento ${detalhe.recebimento.codigo} (${detalhe.recebimento.statusValidacao})` : 'Sem recebimento iniciado na doca'}
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setDetalhe(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="table-wrap mb-16">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>CFOP</th>
                    <th style={{ textAlign: 'right' }}>Solicitado (kg)</th>
                    <th style={{ textAlign: 'right' }}>Bipado Doca (kg)</th>
                    <th style={{ textAlign: 'right' }}>Diferença</th>
                    <th style={{ textAlign: 'right' }}>Preço/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {(detalhe.itens || []).map((it) => {
                    const dif = Number(it.qtd_kg_recebida || 0) - Number(it.qtd_kg_solicitada || 0)
                    return (
                      <tr key={it.id}>
                        <td><strong>{it.produto_codigo}</strong> — {it.produto_descricao}</td>
                        <td className="font-mono text-xs">{it.cfop_aplicado || '-'}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(it.qtd_kg_solicitada)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">{fmtKg(it.qtd_kg_recebida)}</td>
                        <td style={{ textAlign: 'right' }} className={`font-mono font-bold ${dif < -1 ? 'text-danger' : 'text-success'}`}>
                          {dif >= 0 ? `+${fmtKg(dif)}` : fmtKg(dif)}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmtMoeda(it.preco_unitario_kg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {detalhe.recebimento?.statusValidacao === 'DIVERGENTE' && (
              <div className="p-12 rounded mb-16 flex items-center gap-8 text-xs font-bold" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
                <AlertTriangle size={16} /> Atenção: o peso bipado na doca diverge além da tolerância de 3% em relação ao Pedido de Compra. Confirme antes de validar!
              </div>
            )}

            <div className="flex justify-between items-center flex-wrap gap-8">
              <div className="text-sm text-muted">
                Frete: <strong>{fmtMoeda(detalhe.frete_valor)}</strong> • Despesas: <strong>{fmtMoeda(detalhe.despesas_valor)}</strong> • Total: <strong className="text-success">{fmtMoeda(detalhe.valor_total)}</strong>
              </div>
              <div className="flex gap-8">
                {podeEscrever && detalhe.status === 'ABERTO' && (
                  <button type="button" className="btn btn--info" onClick={() => handleAprovar(detalhe.id)}>
                    <CheckCircle2 size={15} /> Aprovar p/ Doca
                  </button>
                )}
                {podeEscrever && ['APROVADO', 'PARCIAL'].includes(detalhe.status) && (
                  <button type="button" className="btn btn--success" onClick={() => handleValidarSistemica(detalhe.id)}>
                    <CheckCircle2 size={15} /> Validar 3-Way & Atualizar Custo
                  </button>
                )}
                {podeEscrever && !['RECEBIDO', 'CANCELADO'].includes(detalhe.status) && (
                  <button type="button" className="btn btn--ghost text-danger" onClick={() => handleCancelar(detalhe.id)}>
                    <XCircle size={15} /> Cancelar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
