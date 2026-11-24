import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  DollarSign,
  Flame,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  Thermometer,
  Trash2,
  TrendingDown,
  Truck,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { governancaQueries } from '../queries/governanca'
import { cadastrosQueries } from '../queries/cadastros'
import * as produtosQueries from '../queries/produtos'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { MesSelector } from '../components/shared/MesSelector'
import { FornecedorSearchSelect, ProdutoSearchSelect } from '../components/shared/SmartSearchSelect'

const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const fmtDataHora = (iso) => {
  if (!iso) return '-'
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime())
    ? String(iso)
    : dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const mesAtualIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_COT_BADGE = {
  ABERTA: { label: 'Aberta', cls: 'badge--info' },
  EM_ANALISE: { label: 'Em Análise', cls: 'badge--warning' },
  FECHADA: { label: 'Fechada (PC Gerado)', cls: 'badge--success' },
  CANCELADA: { label: 'Cancelada', cls: 'badge--danger' },
}

const FAIXA_FEFO_BADGE = {
  VENCIDO: { label: 'VENCIDO', cls: 'badge--danger', cor: '#ef4444' },
  CRITICO: { label: 'CRÍTICO (0–3d)', cls: 'badge--danger', cor: '#f97316' },
  ATENCAO: { label: 'ATENÇÃO (4–7d)', cls: 'badge--warning', cor: '#eab308' },
  MONITORAR: { label: 'MONITORAR', cls: 'badge--info', cor: '#38bdf8' },
}

const CLASSE_FORN_BADGE = {
  A: { label: 'Classe A • Ouro', cls: 'badge--success', cor: '#22c55e' },
  B: { label: 'Classe B • Regular', cls: 'badge--warning', cor: '#f59e0b' },
  C: { label: 'Classe C • Risco', cls: 'badge--danger', cor: '#ef4444' },
  SEM_DADOS: { label: 'Sem Histórico', cls: 'badge--neutral', cor: '#64748b' },
}

const MOTIVOS_PERDA = [
  { id: 'VENCIMENTO', label: 'Vencimento / Validade Expirada' },
  { id: 'AVARIA', label: 'Avaria / Embalagem Rasgada' },
  { id: 'TEMPERATURA', label: 'Quebra Cadeia de Frio (°C)' },
  { id: 'QUEBRA_DESOSSA', label: 'Quebra de Desossa / Apara' },
  { id: 'FURTO_DIVERGENCIA', label: 'Furto / Divergência Não Explicada' },
  { id: 'OUTROS', label: 'Outros Motivos' },
]

const CAT_ANTIFRAUDE_LABEL = {
  CANCELAMENTO_PDV: { label: 'Cancelamento PDV', cls: 'badge--danger' },
  DESCONTO_ALTO: { label: 'Desconto Alto', cls: 'badge--warning' },
  QUEBRA_CAIXA: { label: 'Quebra de Caixa', cls: 'badge--danger' },
  TRAVA_COMERCIAL: { label: 'Trava Comercial', cls: 'badge--purple' },
  PERDA_ESTOQUE: { label: 'Perda / Descarte', cls: 'badge--warning' },
  AJUSTE_INVENTARIO: { label: 'Ajuste Inventário', cls: 'badge--info' },
  AUDITORIA_GOVERNANCA: { label: 'Auditoria Sistema', cls: 'badge--neutral' },
}

export function GovernancaPerdas() {
  const navigate = useNavigate()
  const { toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()

  const [aba, setAba] = useState('COTACOES') // COTACOES | SCORE | FEFO | ANTIFRAUDE

  // Cadastros auxiliares
  const [fornecedores, setFornecedores] = useState([])
  const [produtos, setProdutos] = useState([])

  // Aba 1: Cotações
  const [cotacoes, setCotacoes] = useState([])
  const [cotacaoAtiva, setCotacaoAtiva] = useState(null)
  const [loadingCot, setLoadingCot] = useState(false)
  const [modalNovaCot, setModalNovaCot] = useState(false)
  const [novaCotForm, setNovaCotForm] = useState({
    titulo: '',
    tipo_compra: 'MATERIA_PRIMA',
    data_validade: '',
    observacoes: '',
    itens: [],
  })
  const [itemCotProdId, setItemCotProdId] = useState('')
  const [itemCotKg, setItemCotKg] = useState('100')
  const [modalProposta, setModalProposta] = useState(null) // { item }
  const [propForm, setPropForm] = useState({
    fornecedor_id: '',
    preco_unitario_kg: '',
    frete_kg: '0',
    prazo_entrega_dias: '2',
    condicao_pagamento: '14/21 DIAS',
    observacao: '',
  })

  // Aba 2: Score de Fornecedores
  const [diasScore, setDiasScore] = useState(90)
  const [scoreForn, setScoreForn] = useState([])
  const [loadingScore, setLoadingScore] = useState(false)

  // Aba 3: Monitor FEFO & Perdas
  const [diasFefo, setDiasFefo] = useState(15)
  const [fefoData, setFefoData] = useState({ resumo: {}, data: [] })
  const [loadingFefo, setLoadingFefo] = useState(false)
  const [filtroFaixaFefo, setFiltroFaixaFefo] = useState('TODOS')
  const [prodsPromoSel, setProdsPromoSel] = useState([])
  const [modalPromoOpen, setModalPromoOpen] = useState(false)
  const [promoForm, setPromoForm] = useState({ titulo: '', desconto_pct: 20, dias_validade: 3 })
  const [modalPerda, setModalPerda] = useState(null) // item do monitor FEFO ou 'MANUAL'
  const [perdaForm, setPerdaForm] = useState({ produto_id: '', qtd_kg: '', motivo: 'VENCIMENTO', observacoes: '' })
  const [mesPerdas, setMesPerdas] = useState(() => mesAtualIso())
  const [perdasHist, setPerdasHist] = useState({ resumo: {}, data: [] })

  // Aba 4: Radar Antifraude
  const [diasAnti, setDiasAnti] = useState(30)
  const [antiData, setAntiData] = useState({ resumo: {}, ranking_operadores: [], eventos: [] })
  const [filtroCatAnti, setFiltroCatAnti] = useState('TODAS')
  const [loadingAnti, setLoadingAnti] = useState(false)

  const carregarBase = useCallback(async () => {
    if (!apiAtiva) return
    try {
      const [forns, prods] = await Promise.all([
        cadastrosQueries.listarFornecedores().catch(() => []),
        produtosQueries.listar().catch(() => []),
      ])
      setFornecedores(forns || [])
      setProdutos(prods || [])
    } catch { /* ignore */ }
  }, [apiAtiva])

  const carregarCotacoes = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingCot(true)
    try {
      const lista = await governancaQueries.listarCotacoes('TODAS')
      setCotacoes(lista)
    } catch (err) {
      toastError('Erro ao carregar cotações', err.message)
    } finally {
      setLoadingCot(false)
    }
  }, [apiAtiva, toastError])

  const abrirCotacao = useCallback(
    async (id) => {
      try {
        const det = await governancaQueries.obterCotacao(id)
        setCotacaoAtiva(det)
      } catch (err) {
        toastError('Erro ao abrir cotação', err.message)
      }
    },
    [toastError],
  )

  const carregarScore = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingScore(true)
    try {
      const res = await governancaQueries.obterScoreFornecedores(diasScore)
      setScoreForn(res?.data || [])
    } catch (err) {
      toastError('Erro ao calcular score de fornecedores', err.message)
    } finally {
      setLoadingScore(false)
    }
  }, [apiAtiva, diasScore, toastError])

  const carregarFefoEPerdas = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingFefo(true)
    try {
      const [fefo, perdas] = await Promise.all([
        governancaQueries.obterMonitorFefo(diasFefo),
        governancaQueries.listarPerdas(mesPerdas),
      ])
      setFefoData(fefo || { resumo: {}, data: [] })
      setPerdasHist(perdas || { resumo: {}, data: [] })
    } catch (err) {
      toastError('Erro ao carregar Monitor FEFO', err.message)
    } finally {
      setLoadingFefo(false)
    }
  }, [apiAtiva, diasFefo, mesPerdas, toastError])

  const carregarAntifraude = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingAnti(true)
    try {
      const res = await governancaQueries.obterRadarAntifraude(diasAnti)
      setAntiData(res || { resumo: {}, ranking_operadores: [], eventos: [] })
    } catch (err) {
      toastError('Erro ao carregar radar antifraude', err.message)
    } finally {
      setLoadingAnti(false)
    }
  }, [apiAtiva, diasAnti, toastError])

  useEffect(() => {
    carregarBase()
  }, [carregarBase])

  useEffect(() => {
    if (aba === 'COTACOES') carregarCotacoes()
    if (aba === 'SCORE') carregarScore()
    if (aba === 'FEFO') carregarFefoEPerdas()
    if (aba === 'ANTIFRAUDE') carregarAntifraude()
  }, [aba, carregarCotacoes, carregarScore, carregarFefoEPerdas, carregarAntifraude])

  // Handlers Cotações
  const handleCriarCotacao = async (e) => {
    e.preventDefault()
    if (novaCotForm.itens.length === 0) return toastWarning('Adicione ao menos 1 produto na cotação.')
    try {
      const res = await governancaQueries.criarCotacao(novaCotForm)
      toastSuccess(`Cotação ${res.codigo} criada!`, 'Agora lance as propostas dos fornecedores para comparar.')
      setModalNovaCot(false)
      setNovaCotForm({ titulo: '', tipo_compra: 'MATERIA_PRIMA', data_validade: '', observacoes: '', itens: [] })
      await carregarCotacoes()
      await abrirCotacao(res.id)
    } catch (err) {
      toastError('Erro ao criar cotação', err.message)
    }
  }

  const handleSalvarProposta = async (e) => {
    e.preventDefault()
    if (!modalProposta || !cotacaoAtiva) return
    if (!propForm.fornecedor_id || Number(propForm.preco_unitario_kg) <= 0) {
      return toastWarning('Selecione o fornecedor e informe o preço unitário.')
    }
    try {
      await governancaQueries.salvarPropostas(cotacaoAtiva.id, {
        cotacao_item_id: modalProposta.item.id,
        fornecedor_id: propForm.fornecedor_id,
        preco_unitario_kg: Number(propForm.preco_unitario_kg),
        frete_kg: Number(propForm.frete_kg || 0),
        prazo_entrega_dias: Number(propForm.prazo_entrega_dias || 2),
        condicao_pagamento: propForm.condicao_pagamento,
        observacao: propForm.observacao,
      })
      toastSuccess('Proposta registrada!', 'Mapa comparativo atualizado.')
      setModalProposta(null)
      await abrirCotacao(cotacaoAtiva.id)
      carregarCotacoes()
    } catch (err) {
      toastError('Erro ao salvar proposta', err.message)
    }
  }

  const handleAutoMenorCusto = async () => {
    if (!cotacaoAtiva) return
    try {
      await governancaQueries.selecionarVencedor(cotacaoAtiva.id, { auto_menor_custo: true })
      toastSuccess('Melhores preços marcados!', 'O menor custo efetivo (preço + frete) foi escolhido para cada item.')
      await abrirCotacao(cotacaoAtiva.id)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleMarcarVencedor = async (propostaId) => {
    if (!cotacaoAtiva) return
    try {
      await governancaQueries.selecionarVencedor(cotacaoAtiva.id, { proposta_id: propostaId })
      await abrirCotacao(cotacaoAtiva.id)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleGerarPedidosCotacao = async () => {
    if (!cotacaoAtiva) return
    const ok = await confirmar({
      title: `Fechar ${cotacaoAtiva.codigo} e Gerar Pedidos de Compra`,
      message: `Os itens vencedores serão agrupados por fornecedor e convertidos automaticamente em Pedidos de Compra aprovados para a doca. Confirmar?`,
      confirmLabel: 'Gerar Pedidos de Compra',
    })
    if (!ok) return
    try {
      const res = await governancaQueries.gerarPedidosCotacao(cotacaoAtiva.id, { aprovar_automaticamente: true })
      toastSuccess(
        `${res.pedidos_gerados.length} Pedido(s) de Compra gerado(s)!`,
        `PCs: ${res.pedidos_gerados.map((p) => p.codigo).join(', ')} • Economia estimada: ${fmtMoeda(res.economia_estimada)}`,
      )
      await abrirCotacao(cotacaoAtiva.id)
      carregarCotacoes()
    } catch (err) {
      toastError('Erro ao gerar PCs', err.message)
    }
  }

  // Handlers FEFO & Perdas
  const handleCriarPromocaoFefo = async (e) => {
    e.preventDefault()
    if (prodsPromoSel.length === 0) return toastWarning('Selecione ao menos 1 item crítico.')
    try {
      const res = await governancaQueries.aplicarPromocaoFefo({
        titulo: promoForm.titulo,
        desconto_pct: Number(promoForm.desconto_pct || 20),
        dias_validade: Number(promoForm.dias_validade || 3),
        produto_ids: prodsPromoSel,
      })
      toastSuccess(
        `Tabela Promocional ${res.data.codigo} criada!`,
        `${res.data.itens.length} produto(s) com -${res.data.desconto_pct}% até ${fmtData(res.data.data_fim)}.`,
      )
      setModalPromoOpen(false)
      setProdsPromoSel([])
    } catch (err) {
      toastError('Erro ao criar promoção FEFO', err.message)
    }
  }

  const handleConfirmarBaixaPerda = async (e) => {
    e.preventDefault()
    if (modalPerda === 'MANUAL' && !perdaForm.produto_id) {
      return toastWarning('Selecione o produto para registrar a perda manual.')
    }
    try {
      const payload =
        modalPerda === 'MANUAL'
          ? {
              origem: 'MANUAL',
              produto_id: perdaForm.produto_id,
              qtd_kg: Number(perdaForm.qtd_kg || 0),
              motivo: perdaForm.motivo,
              observacoes: perdaForm.observacoes,
            }
          : modalPerda.origem === 'ETIQUETA_ACOUGUE'
            ? {
                origem: 'ETIQUETA_ACOUGUE',
                etiqueta_id: modalPerda.id,
                motivo: perdaForm.motivo,
                observacoes: perdaForm.observacoes,
              }
            : {
                origem: 'ESTOQUE_CAIXA',
                caixa_id: modalPerda.id,
                motivo: perdaForm.motivo,
                observacoes: perdaForm.observacoes,
              }

      const res = await governancaQueries.baixarPerda(payload)
      toastSuccess(
        `Perda ${res.codigo} registrada!`,
        `${fmtKg(res.qtd_kg)} baixados • Custo auditado: ${fmtMoeda(res.custo_total_perda)}`,
      )
      setModalPerda(null)
      setPerdaForm({ produto_id: '', qtd_kg: '', motivo: 'VENCIMENTO', observacoes: '' })
      await carregarFefoEPerdas()
    } catch (err) {
      toastError('Erro ao baixar perda', err.message)
    }
  }

  const fefoFiltrado = useMemo(() => {
    const lista = fefoData.data || []
    if (filtroFaixaFefo === 'TODOS') return lista
    return lista.filter((i) => i.faixa === filtroFaixaFefo)
  }, [fefoData.data, filtroFaixaFefo])

  const eventosAntiFiltrados = useMemo(() => {
    const evs = antiData.eventos || []
    if (filtroCatAnti === 'TODAS') return evs
    return evs.filter((e) => e.categoria === filtroCatAnti)
  }, [antiData.eventos, filtroCatAnti])

  const resumoFefo = fefoData.resumo || {}
  const resumoAnti = antiData.resumo || {}

  return (
    <div className="fade-in" style={{ paddingBottom: 36 }}>
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <ShieldCheck className="text-primary" size={26} /> Governança de Compras &amp; Prevenção de Perdas
          </h1>
          <p className="page-header__subtitle">
            Cotações comparativas de frigoríficos (RFQ → PC), Score SIF de fornecedores, Monitor FEFO com liquidação rápida e Radar Antifraude
          </p>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Governança de Compras & Prevenção de Perdas" />

      {/* ABAS PRINCIPAIS */}
      <div className="flex gap-8 flex-wrap mb-16">
        <button
          type="button"
          className={`btn ${aba === 'COTACOES' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('COTACOES')}
        >
          <ShoppingBag size={15} /> Cotações &amp; Comparativo (RFQ)
        </button>
        <button
          type="button"
          className={`btn ${aba === 'SCORE' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('SCORE')}
        >
          <Award size={15} /> Score de Fornecedores (SIF)
        </button>
        <button
          type="button"
          className={`btn ${aba === 'FEFO' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('FEFO')}
        >
          <Flame size={15} /> Monitor FEFO &amp; Perdas
        </button>
        <button
          type="button"
          className={`btn ${aba === 'ANTIFRAUDE' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('ANTIFRAUDE')}
        >
          <ShieldAlert size={15} /> Radar Antifraude &amp; Auditoria
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 1: COTAÇÕES & COMPARATIVO DE FORNECEDORES (RFQ -> PC)              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'COTACOES' && (
        <div className="flex flex-col gap-16">
          {!cotacaoAtiva ? (
            <>
              <div className="flex justify-between items-center flex-wrap gap-10">
                <div className="text-sm text-muted">
                  Compare propostas de múltiplos fornecedores (preço + frete/kg) e gere Pedidos de Compra vencedores em 1 clique.
                </div>
                <div className="flex gap-8">
                  <button type="button" className="btn btn--secondary" onClick={carregarCotacoes} disabled={loadingCot}>
                    <RefreshCw size={15} /> Atualizar
                  </button>
                  <button type="button" className="btn btn--primary" onClick={() => setModalNovaCot(true)} disabled={!apiAtiva}>
                    <Plus size={15} /> + Nova Cotação (RFQ)
                  </button>
                </div>
              </div>

              {loadingCot ? (
                <div className="card p-28 text-center text-muted">Carregando cotações...</div>
              ) : cotacoes.length === 0 ? (
                <div className="card p-32 text-center text-muted">
                  <ShoppingBag size={36} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
                  <div>Nenhuma cotação aberta ainda. Clique em <strong>+ Nova Cotação (RFQ)</strong> para comparar fornecedores.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 14 }}>
                  {cotacoes.map((c) => {
                    const st = STATUS_COT_BADGE[c.status] || { label: c.status, cls: 'badge--neutral' }
                    return (
                      <div
                        key={c.id}
                        className="card"
                        style={{ padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
                        onClick={() => abrirCotacao(c.id)}
                      >
                        <div className="flex justify-between items-center gap-8">
                          <span className="font-mono font-bold text-primary">{c.codigo}</span>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{c.titulo}</div>
                        <div className="grid-2 text-xs text-muted" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <div>Itens cotados: <strong>{c.total_itens}</strong></div>
                          <div>Fornecedores: <strong>{c.total_fornecedores}</strong></div>
                          <div>Propostas: <strong>{c.total_propostas}</strong></div>
                          <div>
                            Economia: <strong style={{ color: '#4ade80' }}>{fmtMoeda(c.economia_estimada)}</strong>
                          </div>
                        </div>
                        {(c.pedidos_gerados || []).length > 0 && (
                          <div className="flex gap-6 flex-wrap">
                            {c.pedidos_gerados.map((pg) => (
                              <span key={pg.id} className="badge badge--success" style={{ fontSize: 10.5 }}>
                                {pg.codigo} ({pg.fornecedor_nome})
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="text-xs text-primary font-bold">Abrir mapa comparativo →</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-14">
              <div className="card" style={{ padding: 16 }}>
                <div className="flex justify-between items-center flex-wrap gap-10">
                  <div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm mb-6"
                      onClick={() => setCotacaoAtiva(null)}
                    >
                      ← Voltar à Lista de Cotações
                    </button>
                    <h2 style={{ margin: 0, fontSize: 19 }} className="flex items-center gap-8 flex-wrap">
                      <span className="font-mono text-primary">{cotacaoAtiva.codigo}</span> — {cotacaoAtiva.titulo}
                      <span className={`badge ${(STATUS_COT_BADGE[cotacaoAtiva.status] || { cls: 'badge--neutral' }).cls}`}>
                        {(STATUS_COT_BADGE[cotacaoAtiva.status] || { label: cotacaoAtiva.status }).label}
                      </span>
                    </h2>
                    <div className="text-xs text-muted mt-4">
                      Total estimado vencedores: <strong>{fmtMoeda(cotacaoAtiva.total_vencedor_estimado)}</strong> •
                      Economia vs. maior proposta: <strong style={{ color: '#4ade80' }}>{fmtMoeda(cotacaoAtiva.economia_estimada)}</strong>
                    </div>
                  </div>
                  {cotacaoAtiva.status !== 'FECHADA' && (
                    <div className="flex gap-8 flex-wrap">
                      <button type="button" className="btn btn--secondary btn--sm" onClick={handleAutoMenorCusto}>
                        <Sparkles size={14} /> Marcar Melhores Preços
                      </button>
                      <button type="button" className="btn btn--success btn--sm" onClick={handleGerarPedidosCotacao}>
                        <CheckCircle2 size={14} /> Fechar &amp; Gerar Pedido(s) de Compra
                      </button>
                    </div>
                  )}
                </div>

                {(cotacaoAtiva.pedidos_gerados || []).length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'rgba(34,197,94,0.12)',
                      border: '1px solid rgba(34,197,94,0.35)',
                      fontSize: 12.5,
                    }}
                  >
                    <strong>Pedidos de Compra gerados automaticamente:</strong>{' '}
                    {cotacaoAtiva.pedidos_gerados.map((p) => `${p.codigo} (${p.fornecedor_nome} — ${fmtMoeda(p.valor_total)})`).join(' • ')}{' '}
                    <button type="button" className="btn btn--ghost btn--sm ml-8" onClick={() => navigate('/compras')}>
                      Abrir em Compras ↗
                    </button>
                  </div>
                )}
              </div>

              {(cotacaoAtiva.itens || []).map((it) => (
                <div key={it.id} className="card" style={{ padding: 16 }}>
                  <div className="flex justify-between items-center flex-wrap gap-8 mb-12">
                    <div>
                      <strong style={{ fontSize: 15 }}>
                        <span className="font-mono text-primary">{it.produto_codigo}</span> — {it.produto_descricao}
                      </strong>
                      <div className="text-xs text-muted mt-2">
                        Qtd Cotada: <strong>{fmtKg(it.qtd_kg_solicitada)}</strong> • Últ. Compra Ref.:{' '}
                        <strong>{it.ultimo_preco_ref > 0 ? `${fmtMoeda(it.ultimo_preco_ref)}/kg` : '—'}</strong>
                      </div>
                    </div>
                    {cotacaoAtiva.status !== 'FECHADA' && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => {
                          setModalProposta({ item: it })
                          setPropForm({
                            fornecedor_id: fornecedores[0]?.id || '',
                            preco_unitario_kg: it.ultimo_preco_ref > 0 ? String(it.ultimo_preco_ref) : '',
                            frete_kg: '0',
                            prazo_entrega_dias: '2',
                            condicao_pagamento: '14/21 DIAS',
                            observacao: '',
                          })
                        }}
                      >
                        <Plus size={14} /> + Lançar Proposta
                      </button>
                    )}
                  </div>

                  {(it.propostas || []).length === 0 ? (
                    <div className="text-xs text-muted p-12" style={{ background: 'var(--bg-2)', borderRadius: 8 }}>
                      Nenhuma proposta lançada ainda para este corte. Clique em <strong>+ Lançar Proposta</strong>.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
                      {it.propostas.map((pr) => (
                        <div
                          key={pr.id}
                          style={{
                            padding: 12,
                            borderRadius: 10,
                            background: pr.vencedor ? 'rgba(34,197,94,0.12)' : 'var(--bg-2)',
                            border: `1.5px solid ${pr.vencedor ? '#22c55e' : pr.melhor_preco ? '#38bdf8' : 'var(--border)'}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                          }}
                        >
                          <div className="flex justify-between items-center gap-6">
                            <strong style={{ fontSize: 13 }}>{pr.fornecedor_nome}</strong>
                            {pr.vencedor ? (
                              <span className="badge badge--success" style={{ fontSize: 10 }}>
                                ✓ Vencedor
                              </span>
                            ) : pr.melhor_preco ? (
                              <span className="badge badge--info" style={{ fontSize: 10 }}>
                                ★ Menor Custo
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted">
                            {pr.fornecedor_sif ? `SIF ${pr.fornecedor_sif} • ` : ''}
                            {pr.fornecedor_uf || ''} • Prazo: {pr.prazo_entrega_dias}d
                            {pr.condicao_pagamento ? ` • ${pr.condicao_pagamento}` : ''}
                          </div>
                          <div className="font-mono" style={{ fontSize: 14.5, fontWeight: 800, color: '#f8fafc' }}>
                            {fmtMoeda(pr.custo_efetivo_kg)}/kg{' '}
                            <span className="text-xs text-muted font-normal">
                              ({fmtMoeda(pr.preco_unitario_kg)} + {fmtMoeda(pr.frete_kg)} frete)
                            </span>
                          </div>
                          <div className="text-xs text-muted">
                            Subtotal item: <strong>{fmtMoeda(pr.custo_efetivo_kg * it.qtd_kg_solicitada)}</strong>
                          </div>
                          {cotacaoAtiva.status !== 'FECHADA' && !pr.vencedor && (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm mt-4"
                              onClick={() => handleMarcarVencedor(pr.id)}
                            >
                              Escolher este fornecedor
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 2: SCORE & RANKING DE FORNECEDORES (SIF / QUEBRA / TEMPERATURA)    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'SCORE' && (
        <div className="flex flex-col gap-16">
          <div className="flex justify-between items-center flex-wrap gap-10">
            <div className="text-sm text-muted">
              Índice objetivo (0 a 100) combinando <strong>Pontualidade (30%)</strong>, <strong>Acuracidade de Peso &amp; Doca 3-Way (40%)</strong> e <strong>Conformidade de Temperatura °C (30%)</strong>.
            </div>
            <div className="flex gap-8 items-center">
              <select
                className="form-input"
                style={{ width: 170 }}
                value={diasScore}
                onChange={(e) => setDiasScore(Number(e.target.value))}
              >
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
                <option value={180}>Últimos 180 dias</option>
                <option value={365}>Último ano</option>
              </select>
              <button type="button" className="btn btn--secondary" onClick={carregarScore}>
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          <div className="table-container">
            {loadingScore ? (
              <div className="p-24 text-center text-muted">Calculando indicadores dos fornecedores...</div>
            ) : scoreForn.length === 0 ? (
              <div className="p-28 text-center text-muted">Nenhum fornecedor ativo encontrado.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Fornecedor / Frigorífico</th>
                    <th>SIF</th>
                    <th style={{ textAlign: 'center' }}>Score / Classe</th>
                    <th style={{ textAlign: 'center' }}>Pontualidade</th>
                    <th style={{ textAlign: 'center' }}>Peso / Doca</th>
                    <th style={{ textAlign: 'center' }}>Temp. (°C)</th>
                    <th style={{ textAlign: 'right' }}>Volume (kg)</th>
                    <th style={{ textAlign: 'right' }}>Total Comprado</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreForn.map((f) => {
                    const cls = CLASSE_FORN_BADGE[f.classe] || CLASSE_FORN_BADGE.SEM_DADOS
                    return (
                      <tr key={f.fornecedor_id}>
                        <td>
                          <div className="font-bold">{f.nome}</div>
                          <div className="text-xs text-muted">
                            {f.cidade || '-'}/{f.uf || '-'} • {f.total_pedidos} PC(s) • {f.total_recebimentos} rec.
                            {f.divergencias_qtd > 0 && (
                              <span className="text-danger font-bold"> • {f.divergencias_qtd} divergência(s)</span>
                            )}
                          </div>
                        </td>
                        <td className="td-mono">{f.sif || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="font-mono font-bold" style={{ fontSize: 16, color: cls.cor }}>
                            {f.nota_score !== null ? f.nota_score : '—'}
                          </div>
                          <span className={`badge ${cls.cls}`} style={{ fontSize: 10 }}>
                            {cls.label}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }} className="td-mono font-bold">
                          {f.pontualidade_pct}%
                        </td>
                        <td style={{ textAlign: 'center' }} className="td-mono font-bold">
                          {f.acuracidade_peso_pct}%
                        </td>
                        <td style={{ textAlign: 'center' }} className="td-mono font-bold">
                          {f.conformidade_temp_pct}%
                          <div className="text-xs text-muted">{f.amostras_temp} med.</div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono">
                          {fmtKg(f.kg_recebido > 0 ? f.kg_recebido : f.kg_solicitado)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono font-bold">
                          <div>{fmtMoeda(f.valor_comprado)}</div>
                          {f.custo_medio_kg > 0 && (
                            <div className="text-xs text-muted">Méd: {fmtMoeda(f.custo_medio_kg)}/kg</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 3: MONITOR FEFO, VALIDADE CRÍTICA & QUEIMA CONTROLADA / PERDAS     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'FEFO' && (
        <div className="flex flex-col gap-16">
          <div className="kpi-grid">
            <div className="kpi-card kpi-card--danger">
              <div className="kpi-card__label">Lotes Vencidos</div>
              <div className="kpi-card__value">{resumoFefo.vencido?.qtd || 0}</div>
              <div className="kpi-card__sub">
                {fmtKg(resumoFefo.vencido?.kg)} • {fmtMoeda(resumoFefo.vencido?.valor)}
              </div>
            </div>
            <div className="kpi-card kpi-card--warning">
              <div className="kpi-card__label">Crítico (0 a 3 dias)</div>
              <div className="kpi-card__value">{resumoFefo.critico?.qtd || 0}</div>
              <div className="kpi-card__sub">
                {fmtKg(resumoFefo.critico?.kg)} • {fmtMoeda(resumoFefo.critico?.valor)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Atenção (4 a 7 dias)</div>
              <div className="kpi-card__value">{resumoFefo.atencao?.qtd || 0}</div>
              <div className="kpi-card__sub">
                {fmtKg(resumoFefo.atencao?.kg)} • {fmtMoeda(resumoFefo.atencao?.valor)}
              </div>
            </div>
            <div className="kpi-card kpi-card--danger">
              <div className="kpi-card__label">Capital Total em Risco ({diasFefo}d)</div>
              <div className="kpi-card__value">{fmtMoeda(resumoFefo.capital_em_risco)}</div>
              <div className="kpi-card__sub">
                {resumoFefo.total_itens || 0} item(ns) • {fmtKg(resumoFefo.total_kg)}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-center flex-wrap gap-10 mb-14">
              <div className="flex gap-6 flex-wrap items-center">
                <select
                  className="form-input"
                  style={{ width: 165 }}
                  value={diasFefo}
                  onChange={(e) => setDiasFefo(Number(e.target.value))}
                >
                  <option value={7}>Horizonte: 7 dias</option>
                  <option value={15}>Horizonte: 15 dias</option>
                  <option value={30}>Horizonte: 30 dias</option>
                  <option value={60}>Horizonte: 60 dias</option>
                </select>
                {['TODOS', 'VENCIDO', 'CRITICO', 'ATENCAO', 'MONITORAR'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`btn btn--sm ${filtroFaixaFefo === f ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setFiltroFaixaFefo(f)}
                  >
                    {f === 'TODOS' ? 'Todos' : FAIXA_FEFO_BADGE[f]?.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-8 flex-wrap">
                <button
                  type="button"
                  className="btn btn--warning btn--sm"
                  disabled={prodsPromoSel.length === 0}
                  onClick={() => setModalPromoOpen(true)}
                >
                  <Tag size={14} /> Criar Promoção Liquidação ({prodsPromoSel.length})
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => {
                    setModalPerda('MANUAL')
                    setPerdaForm({ produto_id: produtos[0]?.id || '', qtd_kg: '', motivo: 'QUEBRA_DESOSSA', observacoes: '' })
                  }}
                >
                  <TrendingDown size={14} /> + Registrar Perda Manual
                </button>
              </div>
            </div>

            {loadingFefo ? (
              <div className="p-24 text-center text-muted">Escaneando validades de câmara e açougue...</div>
            ) : fefoFiltrado.length === 0 ? (
              <div className="p-28 text-center text-muted">
                <CheckCircle2 size={32} style={{ margin: '0 auto 8px', color: '#22c55e' }} />
                <div>Nenhum lote vencido ou crítico no horizonte de {diasFefo} dias!</div>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>Promo</th>
                      <th>Origem / Código</th>
                      <th>Produto &amp; Lote</th>
                      <th>Local</th>
                      <th>Validade</th>
                      <th style={{ textAlign: 'right' }}>Peso</th>
                      <th style={{ textAlign: 'right' }}>Risco (R$)</th>
                      <th style={{ textAlign: 'right' }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fefoFiltrado.map((item) => {
                      const fx = FAIXA_FEFO_BADGE[item.faixa] || FAIXA_FEFO_BADGE.MONITORAR
                      const marcado = prodsPromoSel.includes(item.produto_id)
                      return (
                        <tr key={`${item.origem}-${item.id}`}>
                          <td>
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={(e) =>
                                setProdsPromoSel((prev) =>
                                  e.target.checked
                                    ? Array.from(new Set([...prev, item.produto_id]))
                                    : prev.filter((x) => x !== item.produto_id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                              {item.origem === 'ETIQUETA_ACOUGUE' ? 'Açougue QR' : 'Câmara Caixa'}
                            </span>
                            <div className="font-mono text-xs mt-2">{item.codigo_rastreio}</div>
                          </td>
                          <td>
                            <div className="font-bold">
                              <span className="font-mono text-primary">{item.produto_codigo}</span> {item.produto_descricao}
                            </div>
                            <div className="text-xs text-muted">Lote: {item.lote} • {item.conservacao}</div>
                          </td>
                          <td className="td-mono">{item.endereco}</td>
                          <td>
                            <div className="font-mono font-bold">{fmtData(item.validade)}</div>
                            <span className={`badge ${fx.cls}`} style={{ fontSize: 10 }}>
                              {item.dias_restantes < 0
                                ? `Vencido há ${Math.abs(item.dias_restantes)}d`
                                : item.dias_restantes === 0
                                  ? 'Vence HOJE'
                                  : `Em ${item.dias_restantes}d`}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }} className="td-mono font-bold">
                            {fmtKg(item.peso_kg)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="td-mono font-bold text-danger">
                            {fmtMoeda(item.valor_em_risco)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => {
                                setModalPerda(item)
                                setPerdaForm({
                                  produto_id: item.produto_id,
                                  qtd_kg: String(item.peso_kg),
                                  motivo: item.dias_restantes < 0 ? 'VENCIMENTO' : 'AVARIA',
                                  observacoes: '',
                                })
                              }}
                            >
                              <Trash2 size={13} /> Baixar Perda
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* HISTÓRICO MENSAL DE PERDAS & DESCARTES */}
          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-center flex-wrap gap-10 mb-14">
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>Histórico Auditado de Perdas &amp; Descartes</h3>
                <div className="text-xs text-muted mt-2">
                  Total no mês: <strong>{perdasHist.resumo?.total_registros || 0} registro(s)</strong> •{' '}
                  <strong>{fmtKg(perdasHist.resumo?.total_kg)}</strong> • Custo:{' '}
                  <strong className="text-danger">{fmtMoeda(perdasHist.resumo?.total_custo)}</strong>
                </div>
              </div>
              <MesSelector value={mesPerdas} onChange={setMesPerdas} align="right" />
            </div>

            {(perdasHist.data || []).length === 0 ? (
              <div className="p-20 text-center text-muted text-sm">Nenhuma perda registrada neste mês.</div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto / Origem</th>
                      <th>Motivo</th>
                      <th style={{ textAlign: 'right' }}>Peso</th>
                      <th style={{ textAlign: 'right' }}>Custo Perda</th>
                      <th>Responsável / Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perdasHist.data.map((pr) => (
                      <tr key={pr.id}>
                        <td className="td-mono font-bold">{pr.codigo}</td>
                        <td>
                          <div className="font-bold">{pr.produto_descricao}</div>
                          <div className="text-xs text-muted">
                            {pr.origem} {pr.ean_caixa ? `• ${pr.ean_caixa}` : ''} {pr.observacoes ? `• ${pr.observacoes}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge--danger">{pr.motivo}</span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono">
                          {fmtKg(pr.qtd_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono font-bold text-danger">
                          {fmtMoeda(pr.custo_total_perda)}
                        </td>
                        <td className="text-xs text-muted">
                          <strong>{pr.operador_nome}</strong>
                          <div>{fmtDataHora(pr.created_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 4: RADAR ANTIFRAUDE & AUDITORIA DE EVENTOS SENSÍVEIS               */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'ANTIFRAUDE' && (
        <div className="flex flex-col gap-16">
          <div className="flex justify-between items-center flex-wrap gap-10">
            <div className="flex items-center gap-10">
              <span
                className={`badge ${
                  resumoAnti.nivel_risco === 'ALTO'
                    ? 'badge--danger'
                    : resumoAnti.nivel_risco === 'MODERADO'
                      ? 'badge--warning'
                      : 'badge--success'
                }`}
                style={{ fontSize: 12.5, padding: '6px 12px' }}
              >
                Risco Operacional: {resumoAnti.nivel_risco || 'BAIXO'}
              </span>
              <span className="text-xs text-muted">
                {resumoAnti.total_eventos || 0} evento(s) monitorado(s) nos últimos {diasAnti} dias ({resumoAnti.alertas_alta_severidade || 0} severidade alta)
              </span>
            </div>
            <div className="flex gap-8">
              <select
                className="form-input"
                style={{ width: 165 }}
                value={diasAnti}
                onChange={(e) => setDiasAnti(Number(e.target.value))}
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
              <button type="button" className="btn btn--secondary" onClick={carregarAntifraude}>
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card kpi-card--danger">
              <div className="kpi-card__label">Cancelamentos PDV</div>
              <div className="kpi-card__value">{resumoAnti.cancelamentos_pdv_qtd || 0}</div>
              <div className="kpi-card__sub">{fmtMoeda(resumoAnti.cancelamentos_pdv_valor)} estornados</div>
            </div>
            <div className="kpi-card kpi-card--warning">
              <div className="kpi-card__label">Descontos Altos PDV (≥10%)</div>
              <div className="kpi-card__value">{resumoAnti.descontos_altos_qtd || 0}</div>
              <div className="kpi-card__sub">{fmtMoeda(resumoAnti.descontos_altos_valor)} concedidos</div>
            </div>
            <div className="kpi-card kpi-card--danger">
              <div className="kpi-card__label">Quebras / Sobras de Caixa</div>
              <div className="kpi-card__value">{resumoAnti.quebras_caixa_qtd || 0}</div>
              <div className="kpi-card__sub">{fmtMoeda(resumoAnti.quebras_caixa_valor)} acumulados</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Perdas &amp; Travas Comerciais</div>
              <div className="kpi-card__value">
                {(resumoAnti.perdas_estoque_qtd || 0) + (resumoAnti.travas_comerciais_qtd || 0)}
              </div>
              <div className="kpi-card__sub">Perdas: {fmtMoeda(resumoAnti.perdas_estoque_valor)}</div>
            </div>
          </div>

          {(antiData.ranking_operadores || []).length > 0 && (
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs font-bold text-muted uppercase mb-8">
                Resumo de Ocorrências por Operador (Últimos {diasAnti} dias)
              </div>
              <div className="flex gap-8 flex-wrap">
                {antiData.ranking_operadores.map((op) => (
                  <div
                    key={op.operador}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 9,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      fontSize: 12,
                    }}
                  >
                    <strong>{op.operador}</strong> • {op.qtd_alertas} ocorrência(s) •{' '}
                    <span className="font-mono text-warning font-bold">{fmtMoeda(op.valor_impacto)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div className="flex gap-6 flex-wrap mb-14">
              <button
                type="button"
                className={`btn btn--sm ${filtroCatAnti === 'TODAS' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setFiltroCatAnti('TODAS')}
              >
                Todos ({(antiData.eventos || []).length})
              </button>
              {Object.entries(CAT_ANTIFRAUDE_LABEL).map(([k, cfg]) => (
                <button
                  key={k}
                  type="button"
                  className={`btn btn--sm ${filtroCatAnti === k ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setFiltroCatAnti(k)}
                >
                  {cfg.label}
                </button>
              ))}
            </div>

            {loadingAnti ? (
              <div className="p-24 text-center text-muted">Auditando eventos sensíveis...</div>
            ) : eventosAntiFiltrados.length === 0 ? (
              <div className="p-24 text-center text-muted">Nenhum evento de risco encontrado no período.</div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Severidade</th>
                      <th>Evento &amp; Detalhes</th>
                      <th>Operador</th>
                      <th style={{ textAlign: 'right' }}>Impacto</th>
                      <th>Data/Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventosAntiFiltrados.map((ev) => {
                      const cat = CAT_ANTIFRAUDE_LABEL[ev.categoria] || { label: ev.categoria, cls: 'badge--neutral' }
                      return (
                        <tr key={ev.id}>
                          <td>
                            <span className={`badge ${cat.cls}`}>{cat.label}</span>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                ev.severidade === 'ALTA'
                                  ? 'badge--danger'
                                  : ev.severidade === 'MEDIA'
                                    ? 'badge--warning'
                                    : 'badge--neutral'
                              }`}
                            >
                              {ev.severidade}
                            </span>
                          </td>
                          <td>
                            <div className="font-bold">{ev.titulo}</div>
                            <div className="text-xs text-muted">{ev.detalhe}</div>
                          </td>
                          <td>{ev.operador}</td>
                          <td style={{ textAlign: 'right' }} className="td-mono font-bold">
                            {ev.valor_impacto > 0 ? fmtMoeda(ev.valor_impacto) : '—'}
                          </td>
                          <td className="text-xs text-muted">{fmtDataHora(ev.data_hora)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL NOVA COTAÇÃO (RFQ) */}
      {modalNovaCot && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 96, backgroundColor: 'rgba(5,9,18,0.84)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="card" style={{ width: '95vw', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', padding: 22 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0 }}>+ Abrir Nova Cotação de Compra (RFQ)</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalNovaCot(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCriarCotacao} className="flex flex-col gap-12">
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Título da Cotação</label>
                  <input
                    className="form-input"
                    placeholder="Ex: Reposição Bovinos Semana 48"
                    value={novaCotForm.titulo}
                    onChange={(e) => setNovaCotForm((f) => ({ ...f, titulo: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Finalidade</label>
                  <select
                    className="form-input"
                    value={novaCotForm.tipo_compra}
                    onChange={(e) => setNovaCotForm((f) => ({ ...f, tipo_compra: e.target.value }))}
                  >
                    <option value="MATERIA_PRIMA">Matéria-Prima (Desossa/Indústria)</option>
                    <option value="REVENDA">Revenda Atacado</option>
                    <option value="EMPORIO">Empório / Loja</option>
                    <option value="INSUMO">Insumos / Embalagens</option>
                  </select>
                </div>
              </div>

              <div className="p-12 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-bold text-muted mb-8">ADICIONAR PRODUTOS PARA COTAR</div>
                <div className="flex gap-8 flex-wrap items-center">
                  <div style={{ flex: '2 1 260px', minWidth: 0 }}>
                    <ProdutoSearchSelect
                      produtos={produtos}
                      value={itemCotProdId}
                      onChange={(val) => setItemCotProdId(val)}
                      placeholder="Digite código, descrição ou clique na lupa (Carnes, Empório, Insumos)..."
                      modalTitle="Pesquisar Produto para Cotação (RFQ)"
                    />
                  </div>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="form-input font-mono"
                    style={{ width: 100 }}
                    placeholder="Qtd"
                    value={itemCotKg}
                    onChange={(e) => setItemCotKg(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      const prod = produtos.find((p) => p.id === itemCotProdId)
                      if (!prod || Number(itemCotKg) <= 0) return
                      setNovaCotForm((f) => ({
                        ...f,
                        itens: [
                          ...f.itens.filter((i) => i.produto_id !== prod.id),
                          {
                            produto_id: prod.id,
                            produto_descricao: `${prod.codigo} — ${prod.descricao}`,
                            qtd_kg_solicitada: Number(itemCotKg),
                          },
                        ],
                      }))
                      setItemCotProdId('')
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>

                {novaCotForm.itens.length > 0 && (
                  <div className="flex flex-col gap-6 mt-10">
                    {novaCotForm.itens.map((it) => (
                      <div key={it.produto_id} className="flex justify-between items-center text-xs p-8 rounded" style={{ background: '#0f172a' }}>
                        <strong>{it.produto_descricao}</strong>
                        <div className="flex items-center gap-8">
                          <span className="font-mono">{fmtKg(it.qtd_kg_solicitada)}</span>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm text-danger"
                            onClick={() =>
                              setNovaCotForm((f) => ({
                                ...f,
                                itens: f.itens.filter((x) => x.produto_id !== it.produto_id),
                              }))
                            }
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-8">
                <button type="button" className="btn btn--secondary" onClick={() => setModalNovaCot(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={novaCotForm.itens.length === 0}>
                  Criar Cotação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL LANÇAR PROPOSTA DE FORNECEDOR */}
      {modalProposta && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 98, backgroundColor: 'rgba(5,9,18,0.84)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="card" style={{ width: '95vw', maxWidth: 480, padding: 22 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0 }}>Lançar Proposta — {modalProposta.item.produto_descricao}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalProposta(null)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSalvarProposta} className="flex flex-col gap-12">
              <div>
                <label className="form-label">Fornecedor / Frigorífico *</label>
                <FornecedorSearchSelect
                  fornecedores={fornecedores}
                  value={propForm.fornecedor_id}
                  onChange={(val) => setPropForm((f) => ({ ...f, fornecedor_id: val }))}
                  placeholder="Digite nome, CNPJ ou SIF do fornecedor..."
                  modalTitle="Pesquisar Fornecedor / Frigorífico"
                />
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Preço (R$/kg) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="form-input font-mono"
                    value={propForm.preco_unitario_kg}
                    onChange={(e) => setPropForm((f) => ({ ...f, preco_unitario_kg: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Frete (R$/kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input font-mono"
                    value={propForm.frete_kg}
                    onChange={(e) => setPropForm((f) => ({ ...f, frete_kg: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Prazo (dias)</label>
                  <input
                    type="number"
                    min="0"
                    className="form-input font-mono"
                    value={propForm.prazo_entrega_dias}
                    onChange={(e) => setPropForm((f) => ({ ...f, prazo_entrega_dias: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="form-label">Condição de Pagamento</label>
                <input
                  className="form-input"
                  placeholder="Ex: 14/21 DIAS"
                  value={propForm.condicao_pagamento}
                  onChange={(e) => setPropForm((f) => ({ ...f, condicao_pagamento: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-8">
                <button type="button" className="btn btn--secondary" onClick={() => setModalProposta(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  Salvar Proposta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PROMOÇÃO FEFO */}
      {modalPromoOpen && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 98, backgroundColor: 'rgba(5,9,18,0.84)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="card" style={{ width: '95vw', maxWidth: 460, padding: 22 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0 }}>Criar Tabela Promocional FEFO</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalPromoOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted mb-12">
              Cria uma tabela <strong>PROMOCIONAL</strong> imediata para <strong>{prodsPromoSel.length} produto(s)</strong> selecionados, pronta para uso no PDV, Açougue e Força de Vendas.
            </p>
            <form onSubmit={handleCriarPromocaoFefo} className="flex flex-col gap-12">
              <div>
                <label className="form-label">Nome da Campanha</label>
                <input
                  className="form-input"
                  placeholder="Ex: Queima de Estoque Cortes Resfriados"
                  value={promoForm.titulo}
                  onChange={(e) => setPromoForm((f) => ({ ...f, titulo: e.target.value }))}
                />
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Desconto (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="80"
                    className="form-input font-mono"
                    value={promoForm.desconto_pct}
                    onChange={(e) => setPromoForm((f) => ({ ...f, desconto_pct: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Duração (dias)</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    className="form-input font-mono"
                    value={promoForm.dias_validade}
                    onChange={(e) => setPromoForm((f) => ({ ...f, dias_validade: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-8">
                <button type="button" className="btn btn--secondary" onClick={() => setModalPromoOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--warning">
                  <Tag size={14} /> Criar Promoção Agora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL BAIXAR PERDA / DESCARTE */}
      {modalPerda && (
        <div
          className="modal-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 98, backgroundColor: 'rgba(5,9,18,0.84)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div className="card" style={{ width: '95vw', maxWidth: 480, padding: 22 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0 }} className="text-danger">
                Registrar Perda / Descarte Controlado
              </h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalPerda(null)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleConfirmarBaixaPerda} className="flex flex-col gap-12">
              {modalPerda === 'MANUAL' ? (
                <>
                  <div>
                    <label className="form-label">Produto *</label>
                    <ProdutoSearchSelect
                      produtos={produtos}
                      value={perdaForm.produto_id}
                      onChange={(val) => setPerdaForm((f) => ({ ...f, produto_id: val }))}
                      placeholder="Pesquisar produto por código, nome ou categoria..."
                      modalTitle="Pesquisar Produto para Registro de Perda"
                    />
                  </div>
                  <div>
                    <label className="form-label">Peso Perdido (kg) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      className="form-input font-mono"
                      value={perdaForm.qtd_kg}
                      onChange={(e) => setPerdaForm((f) => ({ ...f, qtd_kg: e.target.value }))}
                    />
                  </div>
                </>
              ) : (
                <div className="p-10 rounded text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)' }}>
                  <strong>{modalPerda.produto_descricao}</strong>
                  <div className="mt-4">
                    Código: <span className="font-mono">{modalPerda.codigo_rastreio}</span> • Peso:{' '}
                    <strong>{fmtKg(modalPerda.peso_kg)}</strong> • Validade: <strong>{fmtData(modalPerda.validade)}</strong>
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">Motivo da Perda *</label>
                <select
                  className="form-input"
                  value={perdaForm.motivo}
                  onChange={(e) => setPerdaForm((f) => ({ ...f, motivo: e.target.value }))}
                >
                  {MOTIVOS_PERDA.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Observações / Laudo</label>
                <input
                  className="form-input"
                  placeholder="Ex: Embalagem perdeu vácuo na câmara 2..."
                  value={perdaForm.observacoes}
                  onChange={(e) => setPerdaForm((f) => ({ ...f, observacoes: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-8">
                <button type="button" className="btn btn--secondary" onClick={() => setModalPerda(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--danger">
                  <Trash2 size={14} /> Confirmar Baixa de Perda
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
