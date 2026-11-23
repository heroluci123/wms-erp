import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Copy,
  Edit2,
  Percent,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { precosQueries, acougueQueries } from '../queries/varejo'
import * as produtosQueries from '../queries/produtos'
import { useAppStore } from '../store/appStore'
import { ModalDialog } from '../components/shared/ModalDialog'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const FINALIDADES = [
  { id: 'TODAS', label: 'Todas' },
  { id: 'VAREJO_PDV', label: 'Varejo / PDV' },
  { id: 'ACOUGUE_BALANCA', label: 'Açougue / Balança' },
  { id: 'PROMOCIONAL', label: 'Promocional' },
  { id: 'CLIENTE', label: 'Cliente Específico' },
  { id: 'ATACADO', label: 'Atacado' },
]

const FINALIDADE_LABEL = Object.fromEntries(FINALIDADES.map((f) => [f.id, f.label]))

const FORM_TABELA_VAZIO = {
  id: null,
  nome: '',
  finalidade: 'VAREJO_PDV',
  padrao: false,
  ativa: true,
  data_inicio: '',
  data_fim: '',
  observacao: '',
  copiar_de_tabela_id: '',
  desconto_inicial_pct: '0',
}

export function TabelasPreco() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()

  const [loading, setLoading] = useState(true)
  const [tabelas, setTabelas] = useState([])
  const [tabelaAtivaAcougueId, setTabelaAtivaAcougueId] = useState(null)
  const [filtroFinalidade, setFiltroFinalidade] = useState('TODAS')

  const [tabelaSelId, setTabelaSelId] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [loadingItens, setLoadingItens] = useState(false)

  // Filtros dos itens da tabela selecionada
  const [buscaItem, setBuscaItem] = useState('')
  const [especieItem, setEspecieItem] = useState('TODOS')
  const [precosEdit, setPrecosEdit] = useState({})
  const [salvandoItemId, setSalvandoItemId] = useState(null)

  // Modal Criar / Editar Tabela
  const [modalTabela, setModalTabela] = useState(false)
  const [formTabela, setFormTabela] = useState(FORM_TABELA_VAZIO)
  const [salvandoTabela, setSalvandoTabela] = useState(false)

  // Modal Adicionar Produtos
  const [modalAddProd, setModalAddProd] = useState(false)
  const [catalogoGlobal, setCatalogoGlobal] = useState([])
  const [buscaAddProd, setBuscaAddProd] = useState('')
  const [especieAddProd, setEspecieAddProd] = useState('TODOS')
  const [novosPrecosMap, setNovosPrecosMap] = useState({})
  const [salvandoAddProd, setSalvandoAddProd] = useState(false)

  // Modal Reajuste / Desconto em Massa
  const [modalReajuste, setModalReajuste] = useState(false)
  const [reajTipo, setReajTipo] = useState('PCT') // PCT | VALOR
  const [reajValor, setReajValor] = useState('-10')
  const [reajEspecie, setReajEspecie] = useState('TODOS')
  const [aplicandoReaj, setAplicandoReaj] = useState(false)

  // Confirm Dialog
  const [confirmDlg, setConfirmDlg] = useState({ isOpen: false, title: '', message: '', onConfirm: null })

  const carregarTabelas = useCallback(async () => {
    setLoading(true)
    try {
      const resTabs = await precosQueries.listarTabelas({ incluir_inativas: '1' })
      const lista = resTabs.data || []
      setTabelas(lista)
      setTabelaAtivaAcougueId(resTabs.tabela_ativa_acougue_id || null)
      setTabelaSelId((prev) => {
        if (prev && lista.some((t) => t.id === prev)) return prev
        const pad = lista.find((t) => Boolean(t.padrao)) || lista[0]
        return pad?.id || null
      })
    } catch (err) {
      toastError('Erro ao carregar tabelas de preço', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  const carregarDetalheTabela = useCallback(
    async (id) => {
      if (!id) {
        setDetalhe(null)
        return
      }
      setLoadingItens(true)
      try {
        const res = await precosQueries.obterTabela(id, {
          busca: buscaItem.trim() || undefined,
          especie: especieItem !== 'TODOS' ? especieItem : undefined,
        })
        setDetalhe(res)
        const map = {}
        for (const it of res.itens || []) {
          map[it.produto_id] = Number(it.preco_venda || 0).toFixed(2)
        }
        setPrecosEdit(map)
      } catch (err) {
        toastError('Erro ao carregar itens da tabela', err.message)
      } finally {
        setLoadingItens(false)
      }
    },
    [buscaItem, especieItem, toastError],
  )

  useEffect(() => {
    carregarTabelas()
  }, [carregarTabelas])

  useEffect(() => {
    if (tabelaSelId) {
      carregarDetalheTabela(tabelaSelId)
    }
  }, [tabelaSelId, carregarDetalheTabela])

  const tabelasFiltradas = useMemo(() => {
    if (filtroFinalidade === 'TODAS') return tabelas
    return tabelas.filter((t) => t.finalidade === filtroFinalidade)
  }, [tabelas, filtroFinalidade])

  const abrirNovaTabela = () => {
    setFormTabela(FORM_TABELA_VAZIO)
    setModalTabela(true)
  }

  const abrirEditarTabela = (tab) => {
    setFormTabela({
      id: tab.id,
      nome: tab.nome || '',
      finalidade: tab.finalidade || 'VAREJO_PDV',
      padrao: Boolean(tab.padrao),
      ativa: tab.ativo !== false && Number(tab.ativo ?? 1) !== 0,
      data_inicio: tab.data_inicio ? String(tab.data_inicio).slice(0, 10) : '',
      data_fim: tab.data_fim ? String(tab.data_fim).slice(0, 10) : '',
      observacao: tab.observacoes || tab.observacao || '',
      copiar_de_tabela_id: '',
      desconto_inicial_pct: '0',
    })
    setModalTabela(true)
  }

  const handleSalvarTabela = async (e) => {
    e.preventDefault()
    if (!formTabela.nome.trim()) {
      toastWarning('Nome obrigatório', 'Informe o nome da tabela de preço.')
      return
    }
    setSalvandoTabela(true)
    try {
      const payload = {
        nome: formTabela.nome.trim(),
        finalidade: formTabela.finalidade,
        padrao: Boolean(formTabela.padrao),
        ativo: Boolean(formTabela.ativa),
        data_inicio: formTabela.data_inicio || null,
        data_fim: formTabela.data_fim || null,
        observacoes: formTabela.observacao.trim(),
      }
      if (formTabela.id) {
        await precosQueries.atualizarTabela(formTabela.id, payload)
        toastSuccess('Tabela atualizada!', payload.nome)
      } else {
        // O backend aplica fator = (1 - desconto_padrao_pct / 100); se usuário digitou -10 (desconto), envia +10
        const rawDelta = Number(String(formTabela.desconto_inicial_pct || '0').replace(',', '.'))
        const descPadraoPct = Number.isFinite(rawDelta) ? -rawDelta : 0
        const res = await precosQueries.criarTabela({
          ...payload,
          copiar_de_tabela_id: formTabela.copiar_de_tabela_id || undefined,
          desconto_padrao_pct: descPadraoPct,
        })
        toastSuccess('Tabela criada!', `${res.data.codigo} — ${res.data.nome}`)
        setTabelaSelId(res.data.id)
      }
      setModalTabela(false)
      await carregarTabelas()
      if (tabelaSelId) await carregarDetalheTabela(tabelaSelId)
    } catch (err) {
      toastError('Erro ao salvar tabela', err.message)
    } finally {
      setSalvandoTabela(false)
    }
  }

  const handleExcluirTabela = (tab) => {
    setConfirmDlg({
      isOpen: true,
      title: 'Excluir Tabela de Preço',
      message: `Deseja remover a tabela "${tab.nome}" (${tab.codigo}) e todos os seus preços vinculados?`,
      onConfirm: async () => {
        try {
          await precosQueries.excluirTabela(tab.id)
          toastSuccess('Tabela excluída', tab.nome)
          setTabelaSelId(null)
          await carregarTabelas()
        } catch (err) {
          toastError('Não foi possível excluir', err.message)
        }
      },
    })
  }

  const handleSalvarPrecoInline = async (item) => {
    if (!tabelaSelId) return
    const val = Number(String(precosEdit[item.produto_id] ?? '').replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) {
      toastWarning('Preço inválido', 'Informe um preço de venda maior que R$ 0,00.')
      return
    }
    setSalvandoItemId(item.produto_id)
    try {
      await precosQueries.salvarItens(tabelaSelId, [{ produto_id: item.produto_id, preco_venda: val }])
      toastSuccess('Preço atualizado!', `${item.produto_descricao || item.descricao}: ${fmtMoeda(val)}`)
      await carregarDetalheTabela(tabelaSelId)
    } catch (err) {
      toastError('Erro ao atualizar preço', err.message)
    } finally {
      setSalvandoItemId(null)
    }
  }

  const handleRemoverItem = async (item) => {
    if (!tabelaSelId) return
    try {
      await precosQueries.removerItem(tabelaSelId, item.produto_id)
      toastSuccess('Produto removido da tabela', item.produto_descricao || item.descricao)
      await carregarDetalheTabela(tabelaSelId)
      await carregarTabelas()
    } catch (err) {
      toastError('Erro ao remover item', err.message)
    }
  }

  const abrirModalAdicionarProdutos = async () => {
    setBuscaAddProd('')
    setEspecieAddProd('TODOS')
    setNovosPrecosMap({})
    setModalAddProd(true)
    if (catalogoGlobal.length === 0) {
      try {
        const prods = await produtosQueries.listar()
        setCatalogoGlobal(Array.isArray(prods) ? prods : [])
      } catch (err) {
        toastError('Erro ao carregar catálogo de produtos', err.message)
      }
    }
  }

  const produtosParaAdicionar = useMemo(() => {
    const jaNaTabela = new Set((detalhe?.itens || []).map((i) => i.produto_id))
    const q = buscaAddProd.trim().toLowerCase()
    return catalogoGlobal
      .filter((p) => !jaNaTabela.has(p.id))
      .filter((p) => {
        if (especieAddProd !== 'TODOS' && String(p.especie || 'OUTROS').toUpperCase() !== especieAddProd) {
          return false
        }
        if (!q) return true
        return (
          String(p.descricao || '').toLowerCase().includes(q) ||
          String(p.codigo || '').toLowerCase().includes(q) ||
          String(p.ean || '').toLowerCase().includes(q)
        )
      })
      .slice(0, 80)
  }, [catalogoGlobal, detalhe, buscaAddProd, especieAddProd])

  const handleConfirmarAddProdutos = async (e) => {
    e.preventDefault()
    if (!tabelaSelId) return
    const itensPayload = Object.entries(novosPrecosMap)
      .map(([produto_id, raw]) => ({
        produto_id,
        preco_venda: Number(String(raw || '0').replace(',', '.')),
      }))
      .filter((x) => Number.isFinite(x.preco_venda) && x.preco_venda > 0)

    if (itensPayload.length === 0) {
      toastWarning('Informe ao menos um preço', 'Digite o preço de venda (R$) nos produtos desejados antes de adicionar.')
      return
    }
    setSalvandoAddProd(true)
    try {
      await precosQueries.salvarItens(tabelaSelId, itensPayload)
      toastSuccess('Produtos precificados!', `${itensPayload.length} produto(s) incluído(s) na tabela.`)
      setModalAddProd(false)
      await carregarTabelas()
      await carregarDetalheTabela(tabelaSelId)
    } catch (err) {
      toastError('Erro ao adicionar produtos', err.message)
    } finally {
      setSalvandoAddProd(false)
    }
  }

  const handleAplicarReajuste = async (e) => {
    e.preventDefault()
    if (!tabelaSelId) return
    const val = Number(String(reajValor || '0').replace(',', '.'))
    if (!Number.isFinite(val) || val === 0) {
      toastWarning('Informe um valor diferente de zero', 'Use valor negativo para desconto (ex: -10) ou positivo para acréscimo.')
      return
    }
    setAplicandoReaj(true)
    try {
      const res = await precosQueries.aplicarReajuste(tabelaSelId, {
        operacao: val < 0 ? 'DESCONTO' : 'ACRESCIMO',
        tipo_valor: reajTipo,
        valor: Math.abs(val),
        especie: reajEspecie,
      })
      toastSuccess(
        'Reajuste aplicado!',
        `${res.atualizados || 0} item(ns) atualizado(s) (${val > 0 ? '+' : ''}${val}${reajTipo === 'PCT' ? '%' : ' R$'}).`,
      )
      setModalReajuste(false)
      await carregarDetalheTabela(tabelaSelId)
    } catch (err) {
      toastError('Erro ao aplicar reajuste', err.message)
    } finally {
      setAplicandoReaj(false)
    }
  }

  const tabelaAtual = detalhe?.tabela || tabelas.find((t) => t.id === tabelaSelId) || null
  const itensTabela = detalhe?.itens || []
  const qtdAbaixoCusto = itensTabela.filter((i) => i.abaixo_custo).length

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag size={20} className="text-primary" /> Tabelas de Preço
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Gestão centralizada de preços para PDV, Balança do Açougue, Promoções, Clientes Específicos e Atacado
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn--primary" onClick={abrirNovaTabela}>
            <Plus size={15} /> Nova Tabela de Preço
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={carregarTabelas} title="Atualizar">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* FILTRO DE FINALIDADE */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FINALIDADES.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn--sm ${filtroFinalidade === f.id ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setFiltroFinalidade(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* GRID PRINCIPAL: LISTA DE TABELAS À ESQUERDA + ITENS À DIREITA */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        {/* LISTA DE TABELAS */}
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="text-xs font-bold uppercase text-muted">Tabelas Cadastradas ({tabelasFiltradas.length})</div>
          {loading ? (
            <div className="text-xs text-muted p-16">Carregando tabelas...</div>
          ) : tabelasFiltradas.length === 0 ? (
            <div className="text-xs text-muted p-16">Nenhuma tabela nesta finalidade.</div>
          ) : (
            tabelasFiltradas.map((t) => {
              const sel = t.id === tabelaSelId
              const ativaNoAcougue = t.id === tabelaAtivaAcougueId
              const vencida = t.data_fim && String(t.data_fim).slice(0, 10) < new Date().toISOString().slice(0, 10)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTabelaSelId(t.id)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 10,
                    background: sel ? 'rgba(59,130,246,0.16)' : 'var(--bg-2)',
                    border: `1.5px solid ${sel ? '#3b82f6' : 'var(--border)'}`,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span className="font-mono text-xs font-bold text-info">{t.codigo}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {Number(t.padrao) === 1 && <span className="badge badge--success" style={{ fontSize: 9.5 }}>PADRÃO</span>}
                      {ativaNoAcougue && <span className="badge badge--warning" style={{ fontSize: 9.5 }}>AÇOUGUE</span>}
                      {vencida && <span className="badge badge--danger" style={{ fontSize: 9.5 }}>VENCIDA</span>}
                    </div>
                  </div>
                  <div className="font-bold text-sm">{t.nome}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }} className="text-muted">
                    <span>{FINALIDADE_LABEL[t.finalidade] || t.finalidade}</span>
                    <span className="font-mono font-bold">{t.total_itens ?? t.qtd_itens ?? 0} itens</span>
                  </div>
                  {(t.data_inicio || t.data_fim) && (
                    <div className="text-xs text-muted flex items-center gap-4" style={{ fontSize: 10.5 }}>
                      <Calendar size={11} />
                      {t.data_inicio ? String(t.data_inicio).slice(0, 10) : '...'} até {t.data_fim ? String(t.data_fim).slice(0, 10) : '...'}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* DETALHE & EDITOR DE PREÇOS DA TABELA SELECIONADA */}
        {tabelaAtual ? (
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="font-mono font-bold text-info">{tabelaAtual.codigo}</span>
                  <span className="badge badge--neutral">{FINALIDADE_LABEL[tabelaAtual.finalidade] || tabelaAtual.finalidade}</span>
                  {Number(tabelaAtual.padrao) === 1 && <span className="badge badge--success">Tabela Padrão</span>}
                  {tabelaAtual.id === tabelaAtivaAcougueId && (
                    <span className="badge badge--warning">Em Uso na Balança do Açougue</span>
                  )}
                </div>
                <h2 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 800 }}>{tabelaAtual.nome}</h2>
                {(tabelaAtual.observacoes || tabelaAtual.observacao) && (
                  <div className="text-xs text-muted mt-2">{tabelaAtual.observacoes || tabelaAtual.observacao}</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--primary btn--sm" onClick={abrirModalAdicionarProdutos}>
                  <Plus size={14} /> Adicionar Produtos
                </button>
                <button type="button" className="btn btn--warning btn--sm" onClick={() => setModalReajuste(true)}>
                  <Percent size={14} /> Desconto / Reajuste em Massa
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirEditarTabela(tabelaAtual)}>
                  <Edit2 size={14} /> Editar Tabela
                </button>
                {Number(tabelaAtual.padrao) !== 1 && (
                  <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleExcluirTabela(tabelaAtual)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {qtdAbaixoCusto > 0 && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertTriangle size={16} />
                <strong>Atenção:</strong> {qtdAbaixoCusto} produto(s) nesta tabela estão com preço de venda abaixo do Custo Médio!
              </div>
            )}

            {/* FILTROS DOS ITENS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 32, height: 34, fontSize: 12 }}
                  placeholder="Filtrar produto por código ou nome..."
                  value={buscaItem}
                  onChange={(e) => setBuscaItem(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['TODOS', 'BOVINO', 'SUINO', 'AVES', 'EMPORIO', 'OUTROS'].map((esp) => (
                  <button
                    key={esp}
                    type="button"
                    className={`btn btn--sm ${especieItem === esp ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setEspecieItem(esp)}
                  >
                    {esp === 'TODOS' ? 'Todas' : esp}
                  </button>
                ))}
              </div>
            </div>

            {/* TABELA DE PREÇOS */}
            <div style={{ overflowX: 'auto', maxHeight: '56vh', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Espécie</th>
                    <th style={{ textAlign: 'right' }}>Custo Médio</th>
                    <th style={{ width: 170, textAlign: 'right' }}>Preço Tabela (R$)</th>
                    <th style={{ textAlign: 'right' }}>Margem Real</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingItens ? (
                    <tr><td colSpan={7} className="text-center text-muted p-24">Carregando itens...</td></tr>
                  ) : itensTabela.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-muted p-24">
                        Nenhum produto precificado nesta tabela. Clique em <strong>+ Adicionar Produtos</strong> para começar.
                      </td>
                    </tr>
                  ) : (
                    itensTabela.map((it) => {
                      const valDigitado = Number(String(precosEdit[it.produto_id] ?? it.preco_venda).replace(',', '.'))
                      const alterou = Math.abs(valDigitado - Number(it.preco_venda || 0)) > 0.004
                      const custo = Number(it.custo_medio_kg || 0)
                      const margemLive = valDigitado > 0 && custo > 0 ? ((valDigitado - custo) / valDigitado) * 100 : null
                      const abaixoCusto = custo > 0 && valDigitado < custo

                      return (
                        <tr key={it.produto_id}>
                          <td className="font-mono text-xs font-bold text-info">{it.produto_codigo || it.codigo || '-'}</td>
                          <td>
                            <div className="font-bold text-sm">{it.produto_descricao || it.descricao}</div>
                            <div className="text-xs text-muted">
                              {it.unidade} • {it.conservacao} • Val {it.validade_dias ?? 5}d • Tara {(Number(it.tara_embalagem_kg || 0) * 1000).toFixed(0)}g
                            </div>
                          </td>
                          <td><span className="badge badge--neutral" style={{ fontSize: 10 }}>{it.especie}</span></td>
                          <td className="font-mono text-xs" style={{ textAlign: 'right' }}>
                            {custo > 0 ? fmtMoeda(custo) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                className="form-input font-mono text-right"
                                style={{
                                  height: 32,
                                  width: 105,
                                  fontWeight: 800,
                                  borderColor: alterou ? '#3b82f6' : abaixoCusto ? '#ef4444' : undefined,
                                }}
                                value={precosEdit[it.produto_id] ?? ''}
                                onChange={(e) => setPrecosEdit((p) => ({ ...p, [it.produto_id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleSalvarPrecoInline(it)
                                  }
                                }}
                              />
                              {alterou && (
                                <button
                                  type="button"
                                  className="btn btn--success btn--sm"
                                  style={{ height: 32, padding: '0 8px' }}
                                  disabled={salvandoItemId === it.produto_id}
                                  onClick={() => handleSalvarPrecoInline(it)}
                                  title="Salvar preço"
                                >
                                  <Save size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {margemLive == null ? (
                              <span className="text-xs text-muted">—</span>
                            ) : abaixoCusto ? (
                              <span className="badge badge--danger font-mono">{margemLive.toFixed(1)}%</span>
                            ) : (
                              <span className={`badge ${margemLive >= 20 ? 'badge--success' : 'badge--warning'} font-mono`}>
                                {margemLive.toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn-icon text-danger"
                              title="Remover produto desta tabela"
                              onClick={() => handleRemoverItem(it)}
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
            </div>
          </div>
        ) : (
          <div className="card p-32 text-center text-muted">Selecione ou crie uma tabela de preço à esquerda.</div>
        )}
      </div>

      {/* MODAL CRIAR / EDITAR TABELA */}
      {modalTabela && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalTabela(false)}>
          <div className="modal" style={{ maxWidth: 580, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                {formTabela.id ? 'Editar Tabela de Preço' : 'Nova Tabela de Preço'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalTabela(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleSalvarTabela} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Nome da Tabela *</label>
                  <input
                    className="form-input"
                    required
                    value={formTabela.nome}
                    onChange={(e) => setFormTabela((p) => ({ ...p, nome: e.target.value }))}
                    placeholder="Ex: Promoção Quinta da Carne"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Finalidade</label>
                  <select
                    className="form-input"
                    value={formTabela.finalidade}
                    onChange={(e) => setFormTabela((p) => ({ ...p, finalidade: e.target.value }))}
                  >
                    <option value="VAREJO_PDV">Varejo / PDV</option>
                    <option value="ACOUGUE_BALANCA">Açougue / Balança</option>
                    <option value="PROMOCIONAL">Promocional</option>
                    <option value="CLIENTE">Cliente Específico</option>
                    <option value="ATACADO">Atacado</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Vigência Início (Opcional)</label>
                  <input type="date" className="form-input font-mono" value={formTabela.data_inicio} onChange={(e) => setFormTabela((p) => ({ ...p, data_inicio: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Vigência Fim (Opcional)</label>
                  <input type="date" className="form-input font-mono" value={formTabela.data_fim} onChange={(e) => setFormTabela((p) => ({ ...p, data_fim: e.target.value }))} />
                </div>
              </div>

              {!formTabela.id && tabelas.length > 0 && (
                <div className="card" style={{ padding: 12, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)' }}>
                  <div className="text-xs font-bold text-primary mb-8 flex items-center gap-6">
                    <Copy size={13} /> Clonar preços de outra tabela (Opcional)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10 }}>
                    <select
                      className="form-input"
                      value={formTabela.copiar_de_tabela_id}
                      onChange={(e) => setFormTabela((p) => ({ ...p, copiar_de_tabela_id: e.target.value }))}
                    >
                      <option value="">Começar tabela vazia</option>
                      {tabelas.map((t) => (
                        <option key={t.id} value={t.id}>Copiar de: {t.codigo} — {t.nome} ({t.total_itens ?? t.qtd_itens ?? 0} itens)</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.5"
                      className="form-input font-mono text-right"
                      placeholder="% Desc. ex: -10"
                      title="Use negativo para desconto (ex: -10 = 10% menor) ou positivo para acréscimo"
                      disabled={!formTabela.copiar_de_tabela_id}
                      value={formTabela.desconto_inicial_pct}
                      onChange={(e) => setFormTabela((p) => ({ ...p, desconto_inicial_pct: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Observação</label>
                <input className="form-input" value={formTabela.observacao} onChange={(e) => setFormTabela((p) => ({ ...p, observacao: e.target.value }))} placeholder="Opcional" />
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <label className="flex items-center gap-6 text-sm cursor-pointer">
                  <input type="checkbox" checked={formTabela.padrao} onChange={(e) => setFormTabela((p) => ({ ...p, padrao: e.target.checked }))} />
                  Definir como Tabela Padrão do Varejo
                </label>
                <label className="flex items-center gap-6 text-sm cursor-pointer">
                  <input type="checkbox" checked={formTabela.ativa} onChange={(e) => setFormTabela((p) => ({ ...p, ativa: e.target.checked }))} />
                  Tabela Ativa
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalTabela(false)}>Cancelar</button>
                <button type="submit" className="btn btn--primary" disabled={salvandoTabela}>
                  <CheckCircle2 size={15} /> {salvandoTabela ? 'Salvando...' : 'Salvar Tabela'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ADICIONAR PRODUTOS */}
      {modalAddProd && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalAddProd(false)}>
          <div className="modal" style={{ maxWidth: 760, width: '96%', padding: 0, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                Adicionar Produtos à Tabela — {tabelaAtual?.nome}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalAddProd(false)}><X size={16} /></button>
            </div>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, minWidth: 220, height: 36 }}
                placeholder="Buscar produto por código, descrição ou EAN..."
                value={buscaAddProd}
                onChange={(e) => setBuscaAddProd(e.target.value)}
                autoFocus
              />
              <select className="form-input" style={{ width: 150, height: 36 }} value={especieAddProd} onChange={(e) => setEspecieAddProd(e.target.value)}>
                <option value="TODOS">Todas Espécies</option>
                <option value="BOVINO">Bovinos</option>
                <option value="SUINO">Suínos</option>
                <option value="AVES">Aves</option>
                <option value="EMPORIO">Empório</option>
                <option value="OUTROS">Outros</option>
              </select>
            </div>
            <form onSubmit={handleConfirmarAddProdutos} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto</th>
                      <th>Espécie</th>
                      <th style={{ textAlign: 'right' }}>Custo Médio</th>
                      <th style={{ width: 140, textAlign: 'right' }}>Preço Venda (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtosParaAdicionar.length === 0 ? (
                      <tr><td colSpan={5} className="text-center text-muted p-20">Nenhum produto disponível neste filtro.</td></tr>
                    ) : (
                      produtosParaAdicionar.map((p) => (
                        <tr key={p.id}>
                          <td className="font-mono text-xs">{p.codigo || '-'}</td>
                          <td className="font-semibold text-sm">{p.descricao}</td>
                          <td><span className="badge badge--neutral" style={{ fontSize: 10 }}>{p.especie || 'OUTROS'}</span></td>
                          <td className="font-mono text-xs text-muted" style={{ textAlign: 'right' }}>
                            {Number(p.custo_medio_kg || 0) > 0 ? fmtMoeda(p.custo_medio_kg) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="form-input font-mono text-right"
                              style={{ height: 32 }}
                              placeholder="0,00"
                              value={novosPrecosMap[p.id] ?? ''}
                              onChange={(e) => setNovosPrecosMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 18px', background: 'var(--bg-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-xs text-muted">
                  Apenas os produtos com preço preenchido serão incluídos na tabela (e aparecerão na balança do Açougue).
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn--ghost" onClick={() => setModalAddProd(false)}>Cancelar</button>
                  <button type="submit" className="btn btn--success" disabled={salvandoAddProd}>
                    <CheckCircle2 size={15} /> {salvandoAddProd ? 'Salvando...' : 'Adicionar Precificados'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL REAJUSTE / DESCONTO EM MASSA */}
      {modalReajuste && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalReajuste(false)}>
          <div className="modal" style={{ maxWidth: 460, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} className="text-warning" /> Reajuste / Desconto em Massa
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalReajuste(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleAplicarReajuste} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="text-xs text-muted">
                Aplique um desconto (valor negativo, ex: <strong>-10</strong>) ou acréscimo (positivo, ex: <strong>+5</strong>) nos preços da tabela <strong>{tabelaAtual?.nome}</strong>.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tipo</label>
                  <select className="form-input" value={reajTipo} onChange={(e) => setReajTipo(e.target.value)}>
                    <option value="PCT">Percentual (%)</option>
                    <option value="VALOR">Valor Fixo (R$)</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Valor ({reajTipo === 'PCT' ? '%' : 'R$'})</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input font-mono text-right"
                    style={{ fontSize: 18, fontWeight: 800 }}
                    value={reajValor}
                    onChange={(e) => setReajValor(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Aplicar em qual Espécie?</label>
                <select className="form-input" value={reajEspecie} onChange={(e) => setReajEspecie(e.target.value)}>
                  <option value="TODOS">Todos os itens da tabela</option>
                  <option value="BOVINO">Somente Bovinos</option>
                  <option value="SUINO">Somente Suínos</option>
                  <option value="AVES">Somente Aves</option>
                  <option value="EMPORIO">Somente Empório</option>
                  <option value="OUTROS">Somente Outros</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalReajuste(false)}>Cancelar</button>
                <button type="submit" className="btn btn--warning" disabled={aplicandoReaj}>
                  {aplicandoReaj ? 'Aplicando...' : 'Aplicar na Tabela'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalDialog
        isOpen={confirmDlg.isOpen}
        type="confirm"
        title={confirmDlg.title}
        message={confirmDlg.message}
        onConfirm={confirmDlg.onConfirm}
        onClose={() => setConfirmDlg((p) => ({ ...p, isOpen: false }))}
        confirmLabel="Sim, excluir"
        cancelLabel="Cancelar"
      />
    </div>
  )
}
