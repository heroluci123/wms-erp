import React, { useState, useEffect, useRef } from 'react'
import { Plus, Search, Edit2, Trash2, X, Download, Save, Box, Layers } from 'lucide-react'
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

  const filtrados = produtos.filter(p => {
    const buscaOk = p.descricao.toLowerCase().includes(busca.toLowerCase()) ||
      (p.codigo && String(p.codigo).toLowerCase().includes(busca.toLowerCase()))
    
    const classOk =
      filtroClassificacao === 'TODOS' ? true :
      filtroClassificacao === 'SEM_CLASSIFICACAO' ? !p.classificacao :
      p.classificacao === filtroClassificacao
    
    return buscaOk && classOk
  })

  const materiasPrimas = produtos.filter(p => p.classificacao === 'MATERIA_PRIMA' && p.id !== formData.id)

  return (
    <div className="p-24 max-w-[1400px] mx-auto fade-in h-full flex flex-col">
      <div className="flex items-center justify-between mb-24">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-12">
            <Box className="text-primary" size={28} /> Cadastro de Produtos
          </h1>
          <p className="text-muted mt-4">Gerenciamento de SKUs, descrições e BOM de Produção</p>
        </div>
        <div className="flex gap-12">
          <button className="btn btn--secondary" onClick={exportarCSV}>
            <Download size={18} /> Exportar CSV
          </button>
          <button className="btn btn--primary" onClick={abrirNovoProduto}>
            <Plus size={18} /> Novo Produto
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="card h-full flex flex-col">
          <div className="p-16 border-b border-border">
            <div className="flex gap-16 flex-wrap items-center">
              <div className="relative flex-1 max-w-[360px]">
                <Search className="absolute left-12 top-10 text-muted" size={18} />
                <input
                  type="text"
                  placeholder="Buscar por código ou descrição..."
                  className="form-input pl-40 w-full"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
              </div>

              {/* Filtros de Classificação */}
              <div className="flex gap-8 flex-wrap">
                {[
                  { label: 'Todos', value: 'TODOS' },
                  { label: 'Matéria Prima', value: 'MATERIA_PRIMA' },
                  { label: 'Subproduto', value: 'SUBPRODUTO' },
                  { label: 'Não Classificados', value: 'SEM_CLASSIFICACAO' },
                ].map(f => (
                  <button
                    key={f.value}
                    onClick={() => setFiltroClassificacao(f.value)}
                    style={{
                      padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                      border: '1.5px solid',
                      borderColor: filtroClassificacao === f.value
                        ? f.value === 'SEM_CLASSIFICACAO' ? 'var(--warning)'
                          : f.value === 'MATERIA_PRIMA' ? 'var(--success)'
                          : f.value === 'SUBPRODUTO' ? '#f59e0b'
                          : 'var(--primary)'
                        : 'transparent',
                      backgroundColor: filtroClassificacao === f.value
                        ? f.value === 'SEM_CLASSIFICACAO' ? 'rgba(245,158,11,0.15)'
                          : f.value === 'MATERIA_PRIMA' ? 'rgba(16,185,129,0.15)'
                          : f.value === 'SUBPRODUTO' ? 'rgba(245,158,11,0.15)'
                          : 'rgba(99,102,241,0.15)'
                        : 'var(--bg-2)',
                      color: filtroClassificacao === f.value
                        ? f.value === 'SEM_CLASSIFICACAO' ? 'var(--warning)'
                          : f.value === 'MATERIA_PRIMA' ? 'var(--success)'
                          : f.value === 'SUBPRODUTO' ? '#f59e0b'
                          : 'var(--primary)'
                        : 'var(--text-muted)',
                      cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    {f.value === 'SEM_CLASSIFICACAO' && filtroClassificacao !== 'SEM_CLASSIFICACAO'
                      ? `⚠️ ${f.label}` : f.label}
                    {' '}({f.value === 'TODOS' ? produtos.length
                      : f.value === 'SEM_CLASSIFICACAO' ? produtos.filter(p => !p.classificacao).length
                      : produtos.filter(p => p.classificacao === f.value).length})
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto table-container">
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
                  {filtrados.map(p => (
                    <tr
                      key={p.id}
                      id={`row-produto-${p.id}`}
                      style={{
                        transition: 'background 0.5s',
                        background: savedRowId === p.id ? 'rgba(99,102,241,0.18)' : ''
                      }}
                    >
                      <td className="td-mono">{p.codigo || '-'}</td>
                      <td className="truncate" style={{ maxWidth: 200 }} title={p.descricao}>
                        {p.descricao}
                        {p.pai_descricao && <div className="text-xs text-muted mt-4">↳ Origem: {p.pai_descricao}</div>}
                      </td>
                      <td>{p.grupo || '-'}</td>
                      <td>
                        {p.classificacao === 'MATERIA_PRIMA' && <span className="badge badge--success text-xs">M. Prima</span>}
                        {p.classificacao === 'SUBPRODUTO' && <span className="badge badge--warning text-xs">Subproduto</span>}
                        {!p.classificacao && <span className="badge badge--ghost text-xs">Não Def.</span>}
                      </td>
                      <td><CurvaBadge curva={p.status_curva} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <div className={`inline-flex flex-col items-end px-10 py-4 rounded text-xs font-bold ${
                          parseFloat(p.saldo_kg) > 0 ? 'bg-success/10 text-success' : 'bg-bg-2 text-muted'
                        }`}>
                          <span>{parseFloat(p.saldo_kg || 0).toFixed(1)} kg</span>
                          <span style={{ fontSize: 10, opacity: 0.8 }}>{parseFloat(p.qtd_caixas || 0)} cx</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }} className="text-success font-bold text-sm">R$ {parseFloat(p.valor_unitario || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-6">
                          <button
                            title="Editar"
                            onClick={() => handleEdit(p)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 32, height: 32, borderRadius: 8, border: '1px solid transparent',
                              backgroundColor: 'transparent', cursor: 'pointer', transition: 'all 0.15s', color: 'var(--primary)'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(99,102,241,0.15)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)' }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            title="Excluir"
                            onClick={() => handleDelete(p.id, p.descricao)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 32, height: 32, borderRadius: 8, border: '1px solid transparent',
                              backgroundColor: 'transparent', cursor: 'pointer', transition: 'all 0.15s', color: 'var(--danger)'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)' }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtrados.length === 0 && (
                    <tr>
                      <td colSpan="7" className="text-center p-32 text-muted">Nenhum produto encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE EDIÇÃO */}
      {isEditing && (
        <div 
          className="flex items-center justify-center p-24 fade-in"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 50,
            backgroundColor: 'rgba(0,0,0,0.6)'
          }}
        >
          <div className="bg-bg border border-border rounded-lg w-full max-w-4xl max-h-full flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-16 border-b border-border bg-bg-1 rounded-t-lg">
              <h2 className="text-lg font-bold flex items-center gap-8">
                {formData.id ? <Edit2 size={18} className="text-primary"/> : <Plus size={18} className="text-primary"/>} 
                {formData.id ? 'Editar Produto' : 'Novo Produto'}
              </h2>
              <button className="btn-icon" onClick={resetForm}><X size={20} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-24">
              <form id="produto-form" onSubmit={handleSubmit} className="flex flex-col gap-24">
                
                {/* SESSÃO: DADOS GERAIS */}
                <div className="card p-16 border border-border bg-bg-1">
                  <h3 className="text-sm font-bold text-primary mb-16 border-b border-border pb-8 uppercase">Dados Gerais</h3>
                  <div className="flex gap-16 mb-16 flex-wrap">
                    <div className="form-group w-[180px] shrink-0">
                      <label className="form-label">Código Interno (SKU)</label>
                      <input
                        type="text"
                        className="form-input"
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
                    <div className="form-group w-[150px] shrink-0">
                      <label className="form-label">Código Auxiliar</label>
                      <input type="text" className="form-input" value={formData.codigo_auxiliar} onChange={e => setFormData({...formData, codigo_auxiliar: e.target.value})} placeholder="Ex: 5951" />
                    </div>
                    <div className="form-group flex-1 min-w-[240px]">
                      <label className="form-label">Descrição *</label>
                      <input type="text" className="form-input" value={formData.descricao} onChange={e => setFormData({...formData, descricao: e.target.value.toUpperCase()})} required />
                    </div>
                  </div>
                  <div className="flex gap-16 flex-wrap">
                    <div className="form-group flex-1 min-w-[200px]">
                      <label className="form-label">Grupo Comercial</label>
                      <select className="form-input" value={formData.grupo} onChange={e => setFormData({...formData, grupo: e.target.value})}>
                        <option value="">Selecione um Grupo...</option>
                        <option value="BOVINO">BOVINO</option>
                        <option value="SUINO">SUINO</option>
                        <option value="AVES">AVES</option>
                        <option value="EMBUTIDOS">EMBUTIDOS</option>
                        <option value="MATERIAL USO E CONS">MATERIAL DE USO E CONSUMO</option>
                        <option value="BEBIDAS ALCOOLICA">BEBIDAS ALCOÓLICA</option>
                      </select>
                    </div>
                    <div className="form-group w-[220px]">
                      <label className="form-label">EAN / GTIN Principal</label>
                      <input type="text" className="form-input font-mono" value={formData.ean} onChange={e => setFormData({...formData, ean: e.target.value})} placeholder="Opcional" />
                    </div>
                  </div>
                </div>

                {/* SESSÃO: COMERCIAL E LOGÍSTICA */}
                <div className="card p-16 border border-border bg-bg-1">
                  <h3 className="text-sm font-bold text-primary mb-16 border-b border-border pb-8 uppercase">Logística e Comercial</h3>
                  <div className="flex gap-16 flex-wrap">
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Tipo de Produto</label>
                      <select className="form-input" value={formData.tipo_produto} onChange={e => setFormData({...formData, tipo_produto: e.target.value})}>
                        <option value="Materia Prima">Matéria Prima</option>
                        <option value="Produto Acabado">Produto Acabado</option>
                        <option value="Insumos">Insumos</option>
                      </select>
                    </div>
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Curva ABC</label>
                      <select className="form-input" value={formData.status_curva} onChange={e => setFormData({...formData, status_curva: e.target.value})}>
                        <option value="A">Curva A (Alta)</option>
                        <option value="B">Curva B (Média)</option>
                        <option value="C">Curva C (Baixa)</option>
                      </select>
                    </div>
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Unidade Base</label>
                      <select className="form-input" value={formData.unidade} onChange={e => setFormData({...formData, unidade: e.target.value})}>
                        <option value="CX">CX (Caixa)</option>
                        <option value="KG">KG (Quilograma)</option>
                        <option value="UN">UN (Unidade)</option>
                        <option value="PC">PC (Peça)</option>
                      </select>
                    </div>
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Valor Unitário (R$) *</label>
                      <input type="number" step="0.01" className="form-input text-right font-mono" value={formData.valor_unitario} onChange={e => setFormData({...formData, valor_unitario: e.target.value})} required />
                    </div>
                  </div>
                </div>

                {/* SESSÃO: EMBALAGEM PRIMÁRIA, CUSTOS & FISCAL (FASE 1) */}
                <div className="card p-16 border border-border bg-bg-1">
                  <h3 className="text-sm font-bold text-primary mb-16 border-b border-border pb-8 uppercase">Custos, Embalagem Primária & Fiscal</h3>
                  <div className="flex gap-16 flex-wrap mb-12">
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Custo Médio (R$/kg)</label>
                      <input type="number" step="0.01" className="form-input text-right font-mono" value={formData.custo_medio_kg} onChange={e => setFormData({...formData, custo_medio_kg: e.target.value})} />
                    </div>
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Peso Padrão Caixa (kg)</label>
                      <input type="number" step="0.001" className="form-input text-right font-mono" value={formData.peso_padrao_cx} onChange={e => setFormData({...formData, peso_padrao_cx: e.target.value})} placeholder="Ex: 20.000" />
                    </div>
                    <div className="form-group flex-1 min-w-[200px]">
                      <label className="form-label">Tara Saco / Vácuo por Peça (kg)</label>
                      <input type="number" step="0.0001" className="form-input text-right font-mono" value={formData.tara_primaria_peca_kg} onChange={e => setFormData({...formData, tara_primaria_peca_kg: e.target.value})} placeholder="Ex: 0.0150 (15g)" />
                    </div>
                  </div>
                  <div className="flex gap-16 flex-wrap">
                    <div className="form-group flex-1 min-w-[140px]">
                      <label className="form-label">
                        Registro DIPOA (Produto){!/embalag|insumo/i.test(formData.tipo_produto || '') ? ' *' : ''}
                      </label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        value={formData.registro_dipoa}
                        onChange={e => setFormData({...formData, registro_dipoa: e.target.value.toUpperCase()})}
                        placeholder="Ex: 005 (Picanha) / 007"
                        required={!formData.id && !/embalag|insumo/i.test(formData.tipo_produto || '')}
                      />
                      <span className="text-[11px] text-muted mt-4 block">
                        Sai na etiqueta testeira junto ao SISP/SISBI da filial (ex: REG. DIPOA/SISP 007/1929).
                      </span>
                    </div>
                    <div className="form-group flex-1 min-w-[140px]">
                      <label className="form-label">NCM</label>
                      <input type="text" className="form-input font-mono" value={formData.ncm} onChange={e => setFormData({...formData, ncm: e.target.value})} placeholder="Ex: 02013000" />
                    </div>
                    <div className="form-group flex-1 min-w-[120px]">
                      <label className="form-label">CEST</label>
                      <input type="text" className="form-input font-mono" value={formData.cest} onChange={e => setFormData({...formData, cest: e.target.value})} placeholder="Opcional" />
                    </div>
                    <div className="form-group flex-1 min-w-[150px]">
                      <label className="form-label">Origem Mercadoria</label>
                      <select className="form-input" value={formData.origem_mercadoria} onChange={e => setFormData({...formData, origem_mercadoria: e.target.value})}>
                        <option value="0">0 - Nacional</option>
                        <option value="1">1 - Estrangeira (Imp. Direta)</option>
                        <option value="2">2 - Estrangeira (Merc. Interno)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* SESSÃO: INTELIGÊNCIA BOM */}
                <div className="card p-16 border border-border bg-bg-1">
                  <h3 className="text-sm font-bold text-primary mb-16 border-b border-border pb-8 flex items-center gap-8 uppercase">
                    <Layers size={16} /> Inteligência de Produção (BOM)
                  </h3>
                  <p className="text-xs text-muted mb-16">
                    A classificação do produto define seu papel na fábrica. Subprodutos podem ser atrelados a múltiplas matérias primas de origem.
                  </p>
                  
                  <div className="form-group mb-16">
                    <label className="form-label">Qual o papel deste produto na produção?</label>
                    <div className="flex gap-16">
                      <label className={`flex items-center justify-center flex-1 py-12 px-16 rounded border cursor-pointer transition-colors ${formData.classificacao === 'MATERIA_PRIMA' ? 'bg-success/20 border-success text-success' : 'border-border hover:bg-bg-2 text-muted'}`}>
                        <input type="radio" className="hidden" name="classificacao" value="MATERIA_PRIMA" checked={formData.classificacao === 'MATERIA_PRIMA'} onChange={() => setFormData({...formData, classificacao: 'MATERIA_PRIMA', pais_ids: []})} />
                        <span className="font-bold">Matéria Prima (Raiz)</span>
                      </label>
                      <label className={`flex items-center justify-center flex-1 py-12 px-16 rounded border cursor-pointer transition-colors ${formData.classificacao === 'SUBPRODUTO' ? 'bg-warning/20 border-warning text-warning' : 'border-border hover:bg-bg-2 text-muted'}`}>
                        <input type="radio" className="hidden" name="classificacao" value="SUBPRODUTO" checked={formData.classificacao === 'SUBPRODUTO'} onChange={() => setFormData({...formData, classificacao: 'SUBPRODUTO'})} />
                        <span className="font-bold">Subproduto (Derivado)</span>
                      </label>
                      <label className={`flex items-center justify-center flex-1 py-12 px-16 rounded border cursor-pointer transition-colors ${!formData.classificacao ? 'bg-bg-3 border-muted text-white' : 'border-border hover:bg-bg-2 text-muted'}`}>
                        <input type="radio" className="hidden" name="classificacao" value="" checked={!formData.classificacao} onChange={() => setFormData({...formData, classificacao: '', pais_ids: []})} />
                        <span className="font-bold">Não se aplica</span>
                      </label>
                    </div>
                  </div>

                  {formData.classificacao === 'SUBPRODUTO' && (
                    <div className="form-group mt-16 fade-in p-16 bg-bg border border-border rounded">
                      <label className="form-label text-warning font-bold">Múltiplos Pais (Origem)</label>
                      <p className="text-xs text-muted mb-12">Selecione de quais matérias primas este subproduto é gerado:</p>
                      
                      <div className="max-h-[200px] overflow-y-auto border border-border rounded bg-bg-2 shadow-inner">
                        {materiasPrimas.length === 0 ? (
                          <div className="p-16 text-center text-muted text-sm">Nenhuma Matéria Prima cadastrada ainda.</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-4 p-8">
                            {materiasPrimas.map(mp => {
                              const marcado = formData.pais_ids.includes(mp.id)
                              return (
                                <div key={mp.id} className={`flex items-center gap-8 p-8 rounded border transition-colors ${marcado ? 'bg-primary/20 border-primary' : 'border-transparent hover:bg-bg-3'}`}>
                                  <label className="flex items-center gap-10 flex-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="w-16 h-16 rounded bg-bg border-border text-primary focus:ring-primary focus:ring-offset-bg"
                                      checked={marcado}
                                      onChange={(e) => {
                                        if (e.target.checked) setFormData({...formData, pais_ids: [...formData.pais_ids, mp.id]})
                                        else setFormData({...formData, pais_ids: formData.pais_ids.filter(id => id !== mp.id)})
                                      }}
                                    />
                                    <span className="text-sm font-semibold flex-1">{mp.descricao}</span>
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
            
            <div className="p-16 border-t border-border bg-bg-1 flex justify-end gap-12 rounded-b-lg">
              <button type="button" className="btn btn--ghost" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" form="produto-form" className="btn btn--primary">
                <Save size={18} /> Salvar Alterações
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
