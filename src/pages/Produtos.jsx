import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, Search, Edit2, Trash2, X, Download, Save, Box, Layers, ChevronLeft, ChevronRight } from 'lucide-react'
import * as produtosQueries from '../queries/produtos'
import { ModalDialog } from '../components/shared/ModalDialog'
import {
  encontrarCodigoDuplicadoLocal,
  obterProximoCodigoDisponivel,
  sugerirProximoCodigoLocal,
} from '../utils/codigoCadastro'

const CurvaBadge = ({ curva }) => {
  const cores = {
    'A': 'badge--success',
    'B': 'badge--warning',
    'C': 'badge--ghost'
  }
  return <span className={`badge ${cores[curva] || 'badge--ghost'}`}>Curva {curva}</span>
}

export function Produtos() {
  const [produtos, setProdutos] = useState([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  
  // Modal State
  const [modal, setModal] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null })

  const showAlert = (title, message, type = 'error') => {
    setModal({ isOpen: true, type, title, message, onConfirm: null })
  }

  const showConfirm = (title, message, onConfirm) => {
    setModal({ isOpen: true, type: 'confirm', title, message, onConfirm })
  }

  const closeModal = () => setModal(m => ({ ...m, isOpen: false }))
  
  // Form State
  const [isEditing, setIsEditing] = useState(false)
  const [savedRowId, setSavedRowId] = useState(null)
  const tableRef = useRef(null)
  const scrollYRef = useRef(0)
  const codigoEditadoRef = useRef(false)
  const [formData, setFormData] = useState({
    id: null,
    codigo: '',
    codigo_auxiliar: '',
    ean: '',
    descricao: '',
    status_curva: 'C',
    unidade: 'CX',
    valor_unitario: 0,
    custo_medio_kg: 0,
    tipo_produto: 'Materia Prima',
    grupo: '',
    classificacao: '',
    peso_padrao_cx: '',
    tara_primaria_peca_kg: 0,
    ncm: '',
    cest: '',
    origem_mercadoria: '0',
    registro_dipoa: '',
    pais_ids: [],
    rendimentos_map: {},
  })

  const carregar = async () => {
    try {
      const p = await produtosQueries.listar()
      setProdutos(p)
    } catch (err) {
      console.error(err)
      showAlert('Erro', 'Erro ao carregar produtos. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const editedId = formData.id
    const codDigitado = String(formData.codigo || '').trim()
    if (editedId && !codDigitado) {
      showAlert('Código obrigatório', 'Informe o código interno do produto.')
      return
    }
    if (codDigitado) {
      const dup = encontrarCodigoDuplicadoLocal(produtos, codDigitado, editedId)
      if (dup) {
        showAlert('Código já cadastrado', `Já existe outro produto (${dup.descricao}) com o código "${codDigitado}".`)
        return
      }
    }
    const payload = {
      ...formData,
      arvore_vinculos:
        formData.classificacao === 'SUBPRODUTO'
          ? (formData.pais_ids || []).map((pid) => ({
              pai_id: String(pid),
              rendimento_esperado_pct:
                formData.rendimentos_map?.[pid] !== undefined && formData.rendimentos_map?.[pid] !== ''
                  ? Number(formData.rendimentos_map[pid])
                  : null,
            }))
          : [],
    }
    try {
      if (formData.id) {
        const result = await produtosQueries.atualizar(payload)
        if (!result.success) throw new Error(result.error)
      } else {
        const result = await produtosQueries.criar(payload)
        if (!result.success) throw new Error(result.error)
      }
      resetForm()
      await carregar()
      // Restaurar scroll e destacar a linha editada
      if (editedId) {
        setSavedRowId(editedId)
        window.scrollTo({ top: scrollYRef.current, behavior: 'smooth' })
        setTimeout(() => {
          const row = document.getElementById(`row-produto-${editedId}`)
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
        setTimeout(() => setSavedRowId(null), 2500)
      }
    } catch (err) {
      showAlert('Erro ao Salvar', err.message || 'Não foi possível salvar o produto.')
    }
  }

  const handleEdit = (p) => {
    scrollYRef.current = window.scrollY
    const rendMap = {}
    if (Array.isArray(p.arvore_vinculos)) {
      p.arvore_vinculos.forEach((v) => {
        if (v.pai_id && v.rendimento_esperado_pct != null) {
          rendMap[v.pai_id] = v.rendimento_esperado_pct
        }
      })
    }
    setFormData({
      id: p.id,
      codigo: p.codigo || '',
      codigo_auxiliar: p.codigo_auxiliar || '',
      ean: p.ean || '',
      descricao: p.descricao,
      status_curva: p.status_curva || 'C',
      unidade: p.unidade || 'CX',
      valor_unitario: p.valor_unitario || 0,
      custo_medio_kg: p.custo_medio_kg || 0,
      tipo_produto: p.tipo_produto || 'Materia Prima',
      grupo: p.grupo || '',
      classificacao: p.classificacao || '',
      peso_padrao_cx: p.peso_padrao_cx != null ? p.peso_padrao_cx : '',
      tara_primaria_peca_kg: p.tara_primaria_peca_kg || 0,
      ncm: p.ncm || '',
      cest: p.cest || '',
      origem_mercadoria: p.origem_mercadoria || '0',
      registro_dipoa: p.registro_dipoa || '',
      pais_ids: p.pais_ids ? p.pais_ids.toString().split(',').map(s => s.trim()).filter(Boolean).map(v => /^\d+$/.test(v) ? Number(v) : v) : [],
      rendimentos_map: rendMap,
    })
    codigoEditadoRef.current = false
    setIsEditing(true)
  }

  const abrirNovoProduto = async () => {
    resetForm()
    codigoEditadoRef.current = false
    const codLocal = sugerirProximoCodigoLocal(produtos)
    setFormData((prev) => ({ ...prev, codigo: codLocal }))
    setIsEditing(true)
    const codServidor = await obterProximoCodigoDisponivel('produto', produtos)
    if (!codigoEditadoRef.current) {
      setFormData((prev) => (prev.id ? prev : { ...prev, codigo: codServidor }))
    }
  }

  const handleDelete = async (id, nome) => {
    showConfirm(
      'Excluir Produto',
      `Deseja realmente excluir "${nome}"? Esta ação não pode ser desfeita.`,
      async () => {
        try {
          const result = await produtosQueries.deletar(id)
          if (!result.success) throw new Error(result.error)
          carregar()
        } catch (err) {
          showAlert('Erro ao Excluir', err.message || 'Não foi possível excluir este produto.')
        }
      }
    )
  }

  const resetForm = () => {
    setIsEditing(false)
    setFormData({
      id: null,
      codigo: '',
      codigo_auxiliar: '',
      ean: '',
      descricao: '',
      status_curva: 'C',
      unidade: 'CX',
      valor_unitario: 0,
      custo_medio_kg: 0,
      tipo_produto: 'Materia Prima',
      grupo: '',
      classificacao: '',
      peso_padrao_cx: '',
      tara_primaria_peca_kg: 0,
      ncm: '',
      cest: '',
      origem_mercadoria: '0',
      registro_dipoa: '',
      pais_ids: [],
      rendimentos_map: {},
    })
  }

  const exportarCSV = async () => {
    if (produtos.length === 0) return
    const header = "ID;CODIGO;DESCRICAO;GRUPO;TIPO;CURVA;UNIDADE;VALOR_UNIT;CLASSIFICACAO;PAIS\n"
    const rows = produtos.map(p =>
      `${p.id};${p.codigo || ''};${p.descricao};${p.grupo || ''};${p.tipo_produto};${p.status_curva};${p.unidade};${p.valor_unitario || 0};${p.classificacao || ''};${p.pai_descricao || ''}`
    ).join("\n")
    
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `Produtos_${new Date().getTime()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const [filtroClassificacao, setFiltroClassificacao] = useState('TODOS')
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [itensPorPagina, setItensPorPagina] = useState(50)

  const contagens = useMemo(() => {
    let mp = 0
    let sub = 0
    let sem = 0
    for (const p of produtos) {
      if (p.classificacao === 'MATERIA_PRIMA') mp += 1
      else if (p.classificacao === 'SUBPRODUTO') sub += 1
      else if (!p.classificacao) sem += 1
    }
    return {
      TODOS: produtos.length,
      MATERIA_PRIMA: mp,
      SUBPRODUTO: sub,
      SEM_CLASSIFICACAO: sem,
    }
  }, [produtos])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return produtos.filter((p) => {
      const buscaOk =
        !q ||
        (p.descricao && p.descricao.toLowerCase().includes(q)) ||
        (p.codigo && String(p.codigo).toLowerCase().includes(q)) ||
        (p.codigo_auxiliar && String(p.codigo_auxiliar).toLowerCase().includes(q)) ||
        (p.ean && String(p.ean).toLowerCase().includes(q))

      const classOk =
        filtroClassificacao === 'TODOS'
          ? true
          : filtroClassificacao === 'SEM_CLASSIFICACAO'
            ? !p.classificacao
            : p.classificacao === filtroClassificacao

      return buscaOk && classOk
    })
  }, [produtos, busca, filtroClassificacao])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / itensPorPagina))
  const paginaSegura = Math.min(paginaAtual, totalPaginas)
  const indiceInicio = (paginaSegura - 1) * itensPorPagina
  const paginados = useMemo(
    () => filtrados.slice(indiceInicio, indiceInicio + itensPorPagina),
    [filtrados, indiceInicio, itensPorPagina]
  )

  useEffect(() => {
    setPaginaAtual(1)
  }, [busca, filtroClassificacao, itensPorPagina])

  const materiasPrimas = useMemo(
    () => produtos.filter((p) => p.classificacao === 'MATERIA_PRIMA' && p.id !== formData.id),
    [produtos, formData.id]
  )

  return (
    <div className="fade-in" style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 24 }}>
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Box className="text-primary" size={26} /> Cadastro de Produtos
          </h1>
          <p className="page-header__subtitle">
            Gerenciamento de SKUs, Registro DIPOA, NCM/Fiscal e Árvore BOM de Produção
          </p>
        </div>
        <div className="flex gap-12 flex-wrap">
          <button type="button" className="btn btn--secondary" onClick={exportarCSV}>
            <Download size={17} /> Exportar CSV
          </button>
          <button type="button" className="btn btn--primary" onClick={abrirNovoProduto}>
            <Plus size={17} /> Novo Produto
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
          <div className="flex gap-16 flex-wrap items-center justify-between">
            <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 380 }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="text"
                placeholder="Buscar por código ou descrição..."
                className="form-input w-full"
                style={{ paddingLeft: 38 }}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>

            {/* Filtros de Classificação */}
            <div className="flex gap-8 flex-wrap">
              {[
                { label: 'Todos', value: 'TODOS' },
                { label: 'Matéria Prima', value: 'MATERIA_PRIMA' },
                { label: 'Subproduto', value: 'SUBPRODUTO' },
                { label: 'Não Classificados', value: 'SEM_CLASSIFICACAO' },
              ].map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFiltroClassificacao(f.value)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    border: '1.5px solid',
                    borderColor:
                      filtroClassificacao === f.value
                        ? f.value === 'SEM_CLASSIFICACAO'
                          ? 'var(--warning)'
                          : f.value === 'MATERIA_PRIMA'
                            ? 'var(--success)'
                            : f.value === 'SUBPRODUTO'
                              ? '#f59e0b'
                              : 'var(--accent)'
                        : 'transparent',
                    backgroundColor:
                      filtroClassificacao === f.value
                        ? f.value === 'SEM_CLASSIFICACAO'
                          ? 'rgba(245,158,11,0.15)'
                          : f.value === 'MATERIA_PRIMA'
                            ? 'rgba(34,197,94,0.15)'
                            : f.value === 'SUBPRODUTO'
                              ? 'rgba(245,158,11,0.15)'
                              : 'rgba(59,130,246,0.18)'
                        : 'var(--bg-3)',
                    color:
                      filtroClassificacao === f.value
                        ? f.value === 'SEM_CLASSIFICACAO'
                          ? 'var(--warning)'
                          : f.value === 'MATERIA_PRIMA'
                            ? 'var(--success)'
                            : f.value === 'SUBPRODUTO'
                              ? '#f59e0b'
                              : '#93c5fd'
                        : 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {f.value === 'SEM_CLASSIFICACAO' && filtroClassificacao !== 'SEM_CLASSIFICACAO'
                    ? `⚠️ ${f.label}`
                    : f.label}{' '}
                  ({contagens[f.value] ?? 0})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="p-32 text-center text-muted">Carregando produtos...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Grupo</th>
                  <th>Classificação</th>
                  <th style={{ width: 120 }}>Curva</th>
                  <th style={{ textAlign: 'right' }}>Saldo Estoque</th>
                  <th style={{ textAlign: 'right' }}>Valor Unit.</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginados.map((p) => (
                  <tr
                    key={p.id}
                    id={`row-produto-${p.id}`}
                    style={{
                      transition: 'background 0.5s',
                      background: savedRowId === p.id ? 'rgba(99,102,241,0.18)' : '',
                    }}
                  >
                    <td className="td-mono">{p.codigo || '-'}</td>
                    <td style={{ maxWidth: 260 }} title={p.descricao}>
                      <div className="font-semibold truncate">{p.descricao}</div>
                      {p.pai_descricao && <div className="text-xs text-muted mt-4">↳ Origem: {p.pai_descricao}</div>}
                    </td>
                    <td>{p.grupo || '-'}</td>
                    <td>
                      {p.classificacao === 'MATERIA_PRIMA' && <span className="badge badge--success">M. Prima</span>}
                      {p.classificacao === 'SUBPRODUTO' && <span className="badge badge--warning">Subproduto</span>}
                      {!p.classificacao && <span className="badge badge--neutral">Não Def.</span>}
                    </td>
                    <td>
                      <CurvaBadge curva={p.status_curva} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div
                        className="inline-flex flex-col items-end px-10 py-4 rounded text-xs font-bold"
                        style={{
                          background: parseFloat(p.saldo_kg) > 0 ? 'var(--success-muted)' : 'var(--bg-3)',
                          color: parseFloat(p.saldo_kg) > 0 ? 'var(--success)' : 'var(--text-muted)',
                        }}
                      >
                        <span>{parseFloat(p.saldo_kg || 0).toFixed(1)} kg</span>
                        <span style={{ fontSize: 10, opacity: 0.8 }}>{parseFloat(p.qtd_caixas || 0)} cx</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="text-success font-bold text-sm font-mono">
                      R$ {parseFloat(p.valor_unitario || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex items-center justify-end gap-6">
                        <button
                          type="button"
                          title="Editar"
                          onClick={() => handleEdit(p)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            border: '1px solid transparent',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--accent-hover)',
                          }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          title="Excluir"
                          onClick={() => handleDelete(p.id, p.descricao)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            border: '1px solid transparent',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--danger)',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center p-32 text-muted">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* BARRA DE PAGINAÇÃO */}
        {!loading && filtrados.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              background: 'var(--bg-2)',
              borderTop: '1px solid var(--border)',
              fontSize: 12.5,
            }}
          >
            <div className="text-muted">
              Mostrando <strong style={{ color: 'var(--text-primary)' }}>{indiceInicio + 1}</strong>–
              <strong style={{ color: 'var(--text-primary)' }}>
                {Math.min(indiceInicio + itensPorPagina, filtrados.length)}
              </strong>{' '}
              de <strong style={{ color: 'var(--text-primary)' }}>{filtrados.length.toLocaleString('pt-BR')}</strong>{' '}
              produtos
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label className="text-muted flex items-center gap-6">
                Por página:
                <select
                  className="form-input"
                  style={{ width: 76, padding: '4px 8px', fontSize: 12 }}
                  value={itensPorPagina}
                  onChange={(e) => setItensPorPagina(Number(e.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={paginaSegura <= 1}
                  onClick={() => setPaginaAtual(1)}
                  title="Primeira página"
                >
                  «
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={paginaSegura <= 1}
                  onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} /> Anterior
                </button>
                <span className="font-mono text-xs" style={{ padding: '0 6px', color: 'var(--text-secondary)' }}>
                  Pág. {paginaSegura} / {totalPaginas}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={paginaSegura >= totalPaginas}
                  onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                >
                  Próxima <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={paginaSegura >= totalPaginas}
                  onClick={() => setPaginaAtual(totalPaginas)}
                  title="Última página"
                >
                  »
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL DE NOVO / EDITAR PRODUTO — COM SCROLL LIMPO, CABEÇALHO/RODAPÉ FIXOS E Z-INDEX ACIMA DA SIDEBAR */}
      {isEditing && (
        <div
          className="modal-overlay"
          style={{ padding: 20, zIndex: 1050 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm()
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 920,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-1)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
            }}
          >
            {/* CABEÇALHO FIXO */}
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 22px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <h2 className="text-lg font-bold flex items-center gap-8 m-0">
                  {formData.id ? <Edit2 size={18} className="text-primary" /> : <Plus size={18} className="text-primary" />}
                  {formData.id ? 'Editar Produto' : 'Novo Produto'}
                </h2>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  Preencha os dados gerais, custos/DIPOA/NCM e classificação BOM abaixo (role para baixo se necessário).
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={resetForm} title="Fechar">
                <X size={18} />
              </button>
            </div>

            {/* CORPO COM SCROLL SUAVE PARA ROLAR LIVREMENTE */}
            <div
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                padding: 22,
              }}
            >
              <form id="produto-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* SESSÃO 1: DADOS GERAIS */}
                <div className="card" style={{ padding: 18, background: 'var(--bg-2)' }}>
                  <h3
                    className="text-xs font-bold uppercase text-primary pb-8 mb-16"
                    style={{ borderBottom: '1px solid var(--border)', letterSpacing: '0.06em' }}
                  >
                    1. Dados Gerais do Produto
                  </h3>
                  <div className="form-grid form-grid--3 mb-16">
                    <div className="form-group">
                      <label className="form-label">Código Interno (SKU)</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.codigo}
                        onChange={(e) => {
                          codigoEditadoRef.current = true
                          setFormData({ ...formData, codigo: e.target.value })
                        }}
                        required={Boolean(formData.id)}
                        placeholder="Automático"
                        title="Gerado automaticamente. Apague para informar outro código manualmente."
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Código Auxiliar</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.codigo_auxiliar}
                        onChange={(e) => setFormData({ ...formData, codigo_auxiliar: e.target.value })}
                        placeholder="Ex: 5951"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">EAN / GTIN Principal</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.ean}
                        onChange={(e) => setFormData({ ...formData, ean: e.target.value })}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                  <div className="form-grid form-grid--3">
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label className="form-label">Descrição do Produto *</label>
                      <input
                        type="text"
                        className="form-input"
                        value={formData.descricao}
                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                        placeholder="Ex: PICANHA BOVINA RESFRIADA VACUO"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Grupo Comercial</label>
                      <select
                        className="form-input"
                        value={formData.grupo}
                        onChange={(e) => setFormData({ ...formData, grupo: e.target.value })}
                      >
                        <option value="">Selecione um Grupo...</option>
                        <option value="BOVINO">BOVINO</option>
                        <option value="SUINO">SUINO</option>
                        <option value="AVES">AVES</option>
                        <option value="EMBUTIDOS">EMBUTIDOS</option>
                        <option value="MATERIAL USO E CONS">MATERIAL DE USO E CONSUMO</option>
                        <option value="BEBIDAS ALCOOLICA">BEBIDAS ALCOÓLICA</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* SESSÃO 2: LOGÍSTICA E COMERCIAL */}
                <div className="card" style={{ padding: 18, background: 'var(--bg-2)' }}>
                  <h3
                    className="text-xs font-bold uppercase text-primary pb-8 mb-16"
                    style={{ borderBottom: '1px solid var(--border)', letterSpacing: '0.06em' }}
                  >
                    2. Logística e Comercial
                  </h3>
                  <div className="form-grid form-grid--4">
                    <div className="form-group">
                      <label className="form-label">Tipo de Produto</label>
                      <select
                        className="form-input"
                        value={formData.tipo_produto}
                        onChange={(e) => setFormData({ ...formData, tipo_produto: e.target.value })}
                      >
                        <option value="Materia Prima">Matéria Prima</option>
                        <option value="Produto Acabado">Produto Acabado</option>
                        <option value="Insumos">Insumos</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Curva ABC</label>
                      <select
                        className="form-input"
                        value={formData.status_curva}
                        onChange={(e) => setFormData({ ...formData, status_curva: e.target.value })}
                      >
                        <option value="A">Curva A (Alta)</option>
                        <option value="B">Curva B (Média)</option>
                        <option value="C">Curva C (Baixa)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Unidade Base</label>
                      <select
                        className="form-input"
                        value={formData.unidade}
                        onChange={(e) => setFormData({ ...formData, unidade: e.target.value })}
                      >
                        <option value="CX">CX (Caixa)</option>
                        <option value="KG">KG (Quilograma)</option>
                        <option value="UN">UN (Unidade)</option>
                        <option value="PC">PC (Peça)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Valor Unitário (R$) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input text-right font-mono"
                        value={formData.valor_unitario}
                        onChange={(e) => setFormData({ ...formData, valor_unitario: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* SESSÃO 3: CUSTOS, EMBALAGEM PRIMÁRIA, DIPOA & FISCAL */}
                <div className="card" style={{ padding: 18, background: 'var(--bg-2)' }}>
                  <h3
                    className="text-xs font-bold uppercase text-primary pb-8 mb-16"
                    style={{ borderBottom: '1px solid var(--border)', letterSpacing: '0.06em' }}
                  >
                    3. Custos, Embalagem Primária, DIPOA &amp; Fiscal
                  </h3>
                  <div className="form-grid form-grid--3 mb-16">
                    <div className="form-group">
                      <label className="form-label">Custo Médio (R$/kg)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input text-right font-mono"
                        value={formData.custo_medio_kg}
                        onChange={(e) => setFormData({ ...formData, custo_medio_kg: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Peso Padrão Caixa (kg)</label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        className="form-input text-right font-mono"
                        value={formData.peso_padrao_cx}
                        onChange={(e) => setFormData({ ...formData, peso_padrao_cx: e.target.value })}
                        placeholder="Ex: 20.000"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tara Saco / Vácuo por Peça (kg)</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="form-input text-right font-mono"
                        value={formData.tara_primaria_peca_kg}
                        onChange={(e) => setFormData({ ...formData, tara_primaria_peca_kg: e.target.value })}
                        placeholder="Ex: 0.0150 (15g)"
                      />
                    </div>
                  </div>
                  <div className="form-grid form-grid--4">
                    <div className="form-group">
                      <label className="form-label">
                        Registro DIPOA{!/embalag|insumo/i.test(formData.tipo_produto || '') ? ' *' : ''}
                      </label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.registro_dipoa}
                        onChange={(e) => setFormData({ ...formData, registro_dipoa: e.target.value.toUpperCase() })}
                        placeholder="Ex: 005 ou 007"
                        required={!formData.id && !/embalag|insumo/i.test(formData.tipo_produto || '')}
                      />
                      <span className="form-hint">Sai na etiqueta: REG. DIPOA/SISP 007/1929</span>
                    </div>
                    <div className="form-group">
                      <label className="form-label">NCM</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.ncm}
                        onChange={(e) => setFormData({ ...formData, ncm: e.target.value })}
                        placeholder="Ex: 02013000"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">CEST</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.cest}
                        onChange={(e) => setFormData({ ...formData, cest: e.target.value })}
                        placeholder="Opcional"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Origem Mercadoria</label>
                      <select
                        className="form-input"
                        value={formData.origem_mercadoria}
                        onChange={(e) => setFormData({ ...formData, origem_mercadoria: e.target.value })}
                      >
                        <option value="0">0 - Nacional</option>
                        <option value="1">1 - Estrangeira (Imp. Direta)</option>
                        <option value="2">2 - Estrangeira (Merc. Interno)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* SESSÃO 4: INTELIGÊNCIA BOM */}
                <div className="card" style={{ padding: 18, background: 'var(--bg-2)' }}>
                  <h3
                    className="text-xs font-bold uppercase text-primary pb-8 mb-12 flex items-center gap-8"
                    style={{ borderBottom: '1px solid var(--border)', letterSpacing: '0.06em' }}
                  >
                    <Layers size={15} /> 4. Inteligência de Produção (BOM / Rendimento)
                  </h3>
                  <p className="text-xs text-muted mb-12">
                    Define o papel deste corte na fábrica. Subprodutos podem ser vinculados a várias matérias-primas de origem.
                  </p>

                  <div className="form-group">
                    <label className="form-label">Papel deste produto na produção</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {[
                        { val: 'MATERIA_PRIMA', label: 'Matéria Prima (Raiz)', cor: '#22c55e', bg: 'rgba(34,197,94,0.16)' },
                        { val: 'SUBPRODUTO', label: 'Subproduto (Derivado)', cor: '#f59e0b', bg: 'rgba(245,158,11,0.16)' },
                        { val: '', label: 'Não se aplica', cor: '#60a5fa', bg: 'rgba(59,130,246,0.16)' },
                      ].map((op) => {
                        const ativo = formData.classificacao === op.val
                        return (
                          <button
                            key={op.label}
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                classificacao: op.val,
                                pais_ids: op.val === 'SUBPRODUTO' ? formData.pais_ids : [],
                              })
                            }
                            style={{
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: `1.5px solid ${ativo ? op.cor : 'var(--border)'}`,
                              background: ativo ? op.bg : 'var(--bg-3)',
                              color: ativo ? op.cor : 'var(--text-secondary)',
                              fontWeight: 700,
                              fontSize: 12.5,
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            {op.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {formData.classificacao === 'SUBPRODUTO' && (
                    <div
                      className="mt-16 p-16 rounded"
                      style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
                    >
                      <label className="form-label text-warning font-bold">Múltiplos Pais (Matéria-Prima de Origem)</label>
                      <p className="text-xs text-muted mb-12">
                        Marque as matérias-primas que geram este corte e, opcionalmente, o % de rendimento esperado:
                      </p>

                      <div
                        style={{
                          maxHeight: 200,
                          overflowY: 'auto',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          background: 'var(--bg-2)',
                          padding: 8,
                        }}
                      >
                        {materiasPrimas.length === 0 ? (
                          <div className="p-16 text-center text-muted text-sm">
                            Nenhuma Matéria Prima cadastrada ainda.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 6 }}>
                            {materiasPrimas.map((mp) => {
                              const marcado = formData.pais_ids.includes(mp.id)
                              return (
                                <div
                                  key={mp.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '6px 10px',
                                    borderRadius: 6,
                                    border: `1px solid ${marcado ? 'var(--accent)' : 'transparent'}`,
                                    background: marcado ? 'var(--accent-muted)' : 'transparent',
                                  }}
                                >
                                  <label className="flex items-center gap-8 flex-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={marcado}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setFormData({ ...formData, pais_ids: [...formData.pais_ids, mp.id] })
                                        } else {
                                          setFormData({
                                            ...formData,
                                            pais_ids: formData.pais_ids.filter((id) => id !== mp.id),
                                          })
                                        }
                                      }}
                                    />
                                    <span className="text-xs font-semibold">{mp.descricao}</span>
                                  </label>
                                  {marcado && (
                                    <input
                                      type="number"
                                      step="0.1"
                                      min="0"
                                      max="100"
                                      className="form-input font-mono text-right"
                                      style={{ width: 82, padding: '4px 6px', fontSize: 12 }}
                                      placeholder="% Rend."
                                      title="Rendimento esperado (%) deste corte sobre a matéria-prima"
                                      value={formData.rendimentos_map?.[mp.id] ?? ''}
                                      onChange={(e) =>
                                        setFormData({
                                          ...formData,
                                          rendimentos_map: {
                                            ...(formData.rendimentos_map || {}),
                                            [mp.id]: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>

            {/* RODAPÉ FIXO SEMPRE VISÍVEL */}
            <div
              style={{
                flexShrink: 0,
                padding: '14px 22px',
                background: 'var(--bg-2)',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <button type="button" className="btn btn--ghost" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" form="produto-form" className="btn btn--primary">
                <Save size={16} /> Salvar Produto
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL DE CONFIRMAÇÃO / ALERTA */}
      <ModalDialog
        isOpen={modal.isOpen}
        type={modal.type}
        title={modal.title}
        message={modal.message}
        onConfirm={modal.onConfirm}
        onClose={closeModal}
        confirmLabel="Sim, excluir"
        cancelLabel="Cancelar"
      />
    </div>
  )
}
