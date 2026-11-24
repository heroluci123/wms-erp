import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Award,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  KeyRound,
  Lock,
  MapPin,
  MessageCircle,
  Package,
  Percent,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  TrendingUp,
  Unlock,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { comercialQueries } from '../queries/comercial'
import { pedidosQueries } from '../queries/pedidos'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { PwaInstallBanner } from '../components/shared/PwaInstallBanner'
import { gerarLinkGoogleMapsCoords, gerarLinkWhatsApp, obterGpsAtual } from '../utils/motoristaPwa'

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
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ORIGEM_PRECO_BADGE = {
  CONTRATO_CLIENTE: { label: 'Contrato', cls: 'badge--success' },
  TABELA_CLIENTE: { label: 'Tabela Cli.', cls: 'badge--info' },
  TABELA_ATACADO: { label: 'Tab. Atacado', cls: 'badge--purple' },
  ULTIMA_VENDA: { label: 'Últ. Venda', cls: 'badge--warning' },
  CADASTRO_BASE: { label: 'Base', cls: 'badge--neutral' },
}

const SEMAFORO_CFG = {
  VERDE: { label: 'Crédito OK', color: '#22c55e', bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.4)' },
  AMARELO: { label: 'Limite ≥80%', color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.45)' },
  VERMELHO: { label: 'Restrição / Atraso', color: '#ef4444', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.45)' },
}

const RESULTADO_VISITA_OPTS = [
  { id: 'PEDIDO_GERADO', label: 'Pedido Gerado' },
  { id: 'ORCAMENTO', label: 'Orçamento Enviado' },
  { id: 'CONTATO_REALIZADO', label: 'Contato / Relacionamento' },
  { id: 'RETORNO_AGENDADO', label: 'Retorno Agendado' },
  { id: 'SEM_COMPRA', label: 'Sem Compra Hoje' },
  { id: 'CLIENTE_FECHADO', label: 'Estabelecimento Fechado' },
]

const DRAFT_STORAGE_KEY = 'wms_forca_vendas_rascunhos_v1'

function lerRascunhosLocais() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function salvarRascunhosLocais(arr) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

export function ForcaVendasMobile() {
  const navigate = useNavigate()
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const apiAtiva = isApiEnabled()

  const [aba, setAba] = useState('CARTEIRA') // CARTEIRA | NOVO_PEDIDO | APROVACOES | VISITAS
  const [mesRef, setMesRef] = useState(() => hojeIso().slice(0, 7))
  const [vendedorFiltro, setVendedorFiltro] = useState('')
  const [loading, setLoading] = useState(false)
  const [resumo, setResumo] = useState(null)
  const [auxiliares, setAuxiliares] = useState({ formasPagamento: [], locaisCobranca: [] })

  // Filtros carteira
  const [buscaCliente, setBuscaCliente] = useState('')
  const [filtroCarteira, setFiltroCarteira] = useState('TODOS') // TODOS | INATIVOS | RESTRICAO

  // Novo Pedido Rápido
  const [clienteSelId, setClienteSelId] = useState('')
  const [catalogoData, setCatalogoData] = useState(null)
  const [loadingCatalogo, setLoadingCatalogo] = useState(false)
  const [tabelaPrecoSelId, setTabelaPrecoSelId] = useState('')
  const [formaPgtoSelId, setFormaPgtoSelId] = useState('')
  const [previsaoEntrega, setPrevisaoEntrega] = useState(() => hojeIso())
  const [pgtoEntrega, setPgtoEntrega] = useState(false)
  const [obsPedido, setObsPedido] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [soComSaldo, setSoComSaldo] = useState(false)
  const [carrinho, setCarrinho] = useState([]) // [{ produto_id, codigo, descricao, qtd_kg, preco_unitario, preco_tabela_ref, custo_unitario, desconto_pct, saldo_kg, peso_medio_cx }]
  const [simulacao, setSimulacao] = useState(null)
  const [enviandoPedido, setEnviandoPedido] = useState(false)
  const [rascunhosOffline, setRascunhosOffline] = useState(() => lerRascunhosLocais())

  // Aprovações Comerciais
  const [modoAprov, setModoAprov] = useState('PENDENTES')
  const [aprovacoes, setAprovacoes] = useState([])
  const [loadingAprov, setLoadingAprov] = useState(false)
  const [modalAprov, setModalAprov] = useState(null) // { pedido, acao: 'APROVAR' | 'REJEITAR' }
  const [pinAprov, setPinAprov] = useState('')
  const [obsAprov, setObsAprov] = useState('')
  const [processandoAprov, setProcessandoAprov] = useState(false)

  // Visitas CRM
  const [visitas, setVisitas] = useState([])
  const [loadingVisitas, setLoadingVisitas] = useState(false)
  const [visitaForm, setVisitaForm] = useState({
    cliente_id: '',
    cliente_nome: '',
    tipo: 'PRESENCIAL',
    resultado: 'CONTATO_REALIZADO',
    observacoes: '',
    proximo_contato_em: '',
    lat: null,
    lng: null,
  })
  const [capturandoGps, setCapturandoGps] = useState(false)
  const [salvandoVisita, setSalvandoVisita] = useState(false)

  const carregarResumo = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [res, aux] = await Promise.all([
        comercialQueries.obterResumoVendedor({
          mes: mesRef,
          vendedor_id: vendedorFiltro || undefined,
        }),
        cadastrosQueries.listarAuxiliares().catch(() => ({ formasPagamento: [], locaisCobranca: [] })),
      ])
      setResumo(res)
      setAuxiliares(aux || { formasPagamento: [], locaisCobranca: [] })
    } catch (err) {
      toastError('Erro ao carregar painel comercial', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, mesRef, vendedorFiltro, toastError])

  const carregarAprovacoes = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingAprov(true)
    try {
      const res = await comercialQueries.listarAprovacoes(modoAprov)
      setAprovacoes(res?.data || [])
    } catch (err) {
      toastError('Erro ao carregar fila de aprovações', err.message)
    } finally {
      setLoadingAprov(false)
    }
  }, [apiAtiva, modoAprov, toastError])

  const carregarVisitas = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingVisitas(true)
    try {
      const lista = await comercialQueries.listarVisitas({
        vendedor_id: vendedorFiltro || undefined,
      })
      setVisitas(lista || [])
    } catch (err) {
      toastError('Erro ao carregar visitas', err.message)
    } finally {
      setLoadingVisitas(false)
    }
  }, [apiAtiva, vendedorFiltro, toastError])

  useEffect(() => {
    carregarResumo()
  }, [carregarResumo])

  useEffect(() => {
    if (aba === 'APROVACOES') carregarAprovacoes()
    if (aba === 'VISITAS') carregarVisitas()
  }, [aba, carregarAprovacoes, carregarVisitas])

  const carregarCatalogoCliente = useCallback(
    async (cliId, tabIdOverride = '') => {
      if (!apiAtiva || !cliId) {
        setCatalogoData(null)
        return
      }
      setLoadingCatalogo(true)
      try {
        const res = await comercialQueries.obterCatalogoCliente(cliId, {
          tabela_preco_id: tabIdOverride || undefined,
        })
        setCatalogoData(res)
        if (!tabIdOverride) {
          setTabelaPrecoSelId(res?.tabela_usada_id || '')
          setFormaPgtoSelId(res?.cliente?.forma_pagamento_padrao_id || '')
        }
      } catch (err) {
        toastError('Erro ao carregar catálogo do cliente', err.message)
      } finally {
        setLoadingCatalogo(false)
      }
    },
    [apiAtiva, toastError],
  )

  useEffect(() => {
    if (clienteSelId) {
      carregarCatalogoCliente(clienteSelId, '')
    } else {
      setCatalogoData(null)
    }
  }, [clienteSelId, carregarCatalogoCliente])

  // Simulação em tempo real da margem e travas comerciais sempre que o carrinho muda
  useEffect(() => {
    if (!apiAtiva || !clienteSelId || carrinho.length === 0) {
      setSimulacao(null)
      return undefined
    }
    const timer = setTimeout(async () => {
      try {
        const sim = await comercialQueries.simularMargem({
          cliente_id: clienteSelId,
          vendedor_id: resumo?.vendedor_atual?.id || catalogoData?.regras_efetivas?.vendedor_logado_id || null,
          tabela_preco_id: tabelaPrecoSelId || null,
          pagamento_na_entrega: pgtoEntrega,
          forcar_regras: true,
          itens: carrinho.map((c) => ({
            produto_id: c.produto_id,
            qtd_kg_solicitada: Number(c.qtd_kg || 0),
            preco_unitario: Number(c.preco_unitario || 0),
            desconto_pct: Number(c.desconto_pct || 0),
            desconto_valor: 0,
          })),
        })
        setSimulacao(sim)
      } catch {
        /* fallback local segue ativo */
      }
    }, 240)
    return () => clearTimeout(timer)
  }, [
    apiAtiva,
    clienteSelId,
    carrinho,
    tabelaPrecoSelId,
    pgtoEntrega,
    resumo?.vendedor_atual?.id,
    catalogoData?.regras_efetivas?.vendedor_logado_id,
  ])

  const carteiraFiltrada = useMemo(() => {
    const lista = resumo?.carteira_clientes || []
    const q = buscaCliente.trim().toLowerCase()
    return lista.filter((c) => {
      if (filtroCarteira === 'INATIVOS' && (c.dias_sem_comprar === null || c.dias_sem_comprar < 15)) {
        if (c.dias_sem_comprar !== null) return false
      }
      if (filtroCarteira === 'RESTRICAO' && c.semaforo !== 'VERMELHO') return false
      if (!q) return true
      return (
        c.nome_fantasia.toLowerCase().includes(q) ||
        c.razao_social.toLowerCase().includes(q) ||
        c.codigo.toLowerCase().includes(q) ||
        c.cidade.toLowerCase().includes(q)
      )
    })
  }, [resumo?.carteira_clientes, buscaCliente, filtroCarteira])

  const catalogoFiltrado = useMemo(() => {
    const lista = catalogoData?.catalogo || []
    const q = buscaProd.trim().toLowerCase()
    return lista.filter((p) => {
      if (soComSaldo && Number(p.saldo_kg || 0) <= 0) return false
      if (!q) return true
      return (
        p.descricao.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
        (p.codigo_aux_cliente || '').toLowerCase().includes(q)
      )
    })
  }, [catalogoData?.catalogo, buscaProd, soComSaldo])

  const totaisLocaisCarrinho = useMemo(() => {
    let receita = 0
    let custo = 0
    let receitaComCusto = 0
    let kgTotal = 0
    for (const it of carrinho) {
      const kg = Math.max(0, Number(it.qtd_kg || 0))
      const preco = Math.max(0, Number(it.preco_unitario || 0))
      const desc = Math.max(0, Math.min(100, Number(it.desconto_pct || 0)))
      const liq = kg * preco * (1 - desc / 100)
      const cUnit = Math.max(0, Number(it.custo_unitario || 0))
      kgTotal += kg
      receita += liq
      if (cUnit > 0) {
        custo += kg * cUnit
        receitaComCusto += liq
      }
    }
    const margemPct =
      receitaComCusto > 0 && custo > 0 ? Number((((receitaComCusto - custo) / receitaComCusto) * 100).toFixed(2)) : null
    return {
      kg: Number(kgTotal.toFixed(2)),
      receita: Number(receita.toFixed(2)),
      custo: Number(custo.toFixed(2)),
      margemPct,
    }
  }, [carrinho])

  const iniciarPedidoParaCliente = (cli) => {
    setClienteSelId(cli.id)
    setCarrinho([])
    setSimulacao(null)
    setObsPedido('')
    setPgtoEntrega(false)
    setAba('NOVO_PEDIDO')
  }

  const iniciarCheckinParaCliente = (cli) => {
    setVisitaForm((prev) => ({
      ...prev,
      cliente_id: cli.id,
      cliente_nome: cli.nome_fantasia || cli.razao_social,
    }))
    setAba('VISITAS')
  }

  const adicionarProdutoCarrinho = (prod) => {
    setCarrinho((prev) => {
      const idx = prev.findIndex((i) => i.produto_id === prod.id)
      const kgBase = prod.peso_medio_cx > 0 ? Number(prod.peso_medio_cx.toFixed(2)) : 10
      if (idx >= 0) {
        return prev.map((it, i) =>
          i === idx ? { ...it, qtd_kg: Number((Number(it.qtd_kg || 0) + kgBase).toFixed(2)) } : it,
        )
      }
      return [
        ...prev,
        {
          produto_id: prod.id,
          codigo: prod.codigo,
          descricao: prod.descricao,
          qtd_kg: kgBase,
          preco_unitario: Number(prod.preco_sugerido || 0),
          preco_tabela_ref: Number(prod.preco_sugerido || 0),
          origem_preco: prod.origem_preco,
          custo_unitario: Number(prod.custo_unitario || 0),
          desconto_pct: 0,
          saldo_kg: Number(prod.saldo_kg || 0),
          peso_medio_cx: Number(prod.peso_medio_cx || 0),
          alerta_reclamacao: prod.alerta_reclamacao,
          alerta_descricao: prod.alerta_descricao,
        },
      ]
    })
  }

  const repetirUltimoPedido = (ultPed) => {
    if (!ultPed?.itens?.length) return
    const catMap = new Map((catalogoData?.catalogo || []).map((p) => [p.id, p]))
    const novos = ultPed.itens.map((it) => {
      const cat = catMap.get(it.produto_id)
      return {
        produto_id: it.produto_id,
        codigo: it.produto_codigo || cat?.codigo || '',
        descricao: it.produto_descricao || cat?.descricao || 'Produto',
        qtd_kg: Number(it.qtd_kg_solicitada || 10),
        preco_unitario: cat?.preco_sugerido > 0 ? Number(cat.preco_sugerido) : Number(it.preco_unitario || 0),
        preco_tabela_ref: cat?.preco_sugerido > 0 ? Number(cat.preco_sugerido) : Number(it.preco_unitario || 0),
        origem_preco: cat?.origem_preco || 'ULTIMA_VENDA',
        custo_unitario: Number(cat?.custo_unitario || 0),
        desconto_pct: 0,
        saldo_kg: Number(cat?.saldo_kg || 0),
        peso_medio_cx: Number(cat?.peso_medio_cx || 0),
        alerta_reclamacao: Boolean(cat?.alerta_reclamacao),
        alerta_descricao: cat?.alerta_descricao || '',
      }
    })
    setCarrinho(novos)
    toastSuccess('Itens copiados!', `${novos.length} item(ns) do pedido ${ultPed.codigo} carregados com preços atuais.`)
  }

  const enviarPedidoMobile = async (comoRascunho = false) => {
    if (!clienteSelId) return toastWarning('Selecione um cliente.')
    if (carrinho.length === 0) return toastWarning('Adicione ao menos 1 produto ao carrinho.')

    const payload = {
      titulo: '',
      cliente_id: clienteSelId,
      cliente: catalogoData?.cliente?.razao_social || '',
      vendedor_id: resumo?.vendedor_atual?.id || catalogoData?.regras_efetivas?.vendedor_logado_id || catalogoData?.cliente?.vendedor_padrao_id || null,
      forma_pagamento_id: formaPgtoSelId || null,
      tabela_preco_id: tabelaPrecoSelId || null,
      pagamento_na_entrega: pgtoEntrega ? 1 : 0,
      previsao_entrega: previsaoEntrega || null,
      observacoes: obsPedido,
      origem_pedido: 'VENDEDOR',
      setor_solicitante: 'COMERCIAL',
      liberar: !comoRascunho,
      aplicar_trava_comercial: !comoRascunho,
      itens: carrinho.map((it) => ({
        produto_id: it.produto_id,
        qtd_kg_solicitada: Number(it.qtd_kg || 0),
        preco_unitario: Number(it.preco_unitario || 0),
        desconto_pct: Number(it.desconto_pct || 0),
        desconto_valor: 0,
      })),
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const novoDraft = {
        id: `off-${Date.now()}`,
        criado_em: new Date().toISOString(),
        cliente_nome: catalogoData?.cliente?.nome_fantasia || 'Cliente',
        valor_est: totaisLocaisCarrinho.receita,
        payload,
      }
      const next = [novoDraft, ...rascunhosOffline]
      setRascunhosOffline(next)
      salvarRascunhosLocais(next)
      setCarrinho([])
      toastWarning('Sem internet — Salvo Offline!', 'O pedido ficou salvo no celular para reenvio assim que o sinal voltar.')
      return
    }

    setEnviandoPedido(true)
    try {
      const res = await pedidosQueries.criarPedido(payload)
      if (res.trava_comercial) {
        toastWarning(
          `${res.codigo} enviado para Aprovação Gerencial 🔒`,
          res.motivo_trava_comercial || 'Margem, desconto ou crédito exigiu liberação da Mesa Comercial.',
        )
      } else if (res.trava_estoque) {
        toastWarning(`${res.codigo} criado com Trava de Estoque`, res.motivo_trava)
      } else {
        toastSuccess(
          comoRascunho ? `${res.codigo} salvo em Rascunho` : `${res.codigo} liberado para Separação!`,
          `Total ${fmtMoeda(totaisLocaisCarrinho.receita)}${res.margem_bruta_pct != null ? ` • Margem ${res.margem_bruta_pct}%` : ''}`,
        )
      }
      setCarrinho([])
      setSimulacao(null)
      setObsPedido('')
      await carregarResumo()
      if (res.trava_comercial) {
        setAba('APROVACOES')
      } else {
        setAba('CARTEIRA')
      }
    } catch (err) {
      toastError('Erro ao enviar pedido', err.message)
    } finally {
      setEnviandoPedido(false)
    }
  }

  const reenviarRascunhoOffline = async (draft) => {
    setEnviandoPedido(true)
    try {
      const res = await pedidosQueries.criarPedido(draft.payload)
      const next = rascunhosOffline.filter((r) => r.id !== draft.id)
      setRascunhosOffline(next)
      salvarRascunhosLocais(next)
      toastSuccess(`Rascunho sincronizado: ${res.codigo}`)
      carregarResumo()
    } catch (err) {
      toastError('Falha ao sincronizar', err.message)
    } finally {
      setEnviandoPedido(false)
    }
  }

  const handleConfirmarAprovacaoModal = async (e) => {
    e.preventDefault()
    if (!modalAprov) return
    setProcessandoAprov(true)
    try {
      if (modalAprov.acao === 'APROVAR') {
        const res = await comercialQueries.aprovarPedidoComercial(modalAprov.pedido.id, {
          pin_gerencial: pinAprov.trim() || undefined,
          observacao: obsAprov.trim(),
        })
        toastSuccess(
          `Pedido ${res.codigo} aprovado!`,
          res.trava_estoque
            ? `Aprovado comercialmente, porém entrou em Trava de Estoque: ${res.motivo_trava_estoque}`
            : `Liberado para Separação por ${res.aprovado_por}.`,
        )
      } else {
        await comercialQueries.rejeitarPedidoComercial(modalAprov.pedido.id, {
          pin_gerencial: pinAprov.trim() || undefined,
          motivo: obsAprov.trim() || 'Ajustar preço/desconto e reenviar.',
        })
        toastWarning('Pedido devolvido para Rascunho', 'O vendedor poderá ajustar os valores e reenviar.')
      }
      setModalAprov(null)
      setPinAprov('')
      setObsAprov('')
      await Promise.all([carregarAprovacoes(), carregarResumo()])
    } catch (err) {
      toastError('Ação não autorizada / erro', err.message)
    } finally {
      setProcessandoAprov(false)
    }
  }

  const handleCapturarGpsVisita = async () => {
    setCapturandoGps(true)
    try {
      const pos = await obterGpsAtual()
      if (!pos) {
        toastWarning('GPS indisponível', 'Autorize a localização no navegador ou registre sem coordenadas.')
      } else {
        setVisitaForm((f) => ({ ...f, lat: pos.lat, lng: pos.lng }))
        toastSuccess('GPS capturado!', `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`)
      }
    } finally {
      setCapturandoGps(false)
    }
  }

  const handleSalvarVisita = async (e) => {
    e.preventDefault()
    if (!visitaForm.cliente_id && !visitaForm.cliente_nome.trim()) {
      return toastWarning('Selecione um cliente ou informe o nome do contato.')
    }
    setSalvandoVisita(true)
    try {
      await comercialQueries.registrarVisita({
        ...visitaForm,
        cliente_id: visitaForm.cliente_id || null,
        vendedor_id: resumo?.vendedor_atual?.id || null,
        proximo_contato_em: visitaForm.proximo_contato_em || null,
      })
      toastSuccess('Check-in registrado!', 'Visita comercial salva no histórico CRM.')
      setVisitaForm({
        cliente_id: '',
        cliente_nome: '',
        tipo: 'PRESENCIAL',
        resultado: 'CONTATO_REALIZADO',
        observacoes: '',
        proximo_contato_em: '',
        lat: null,
        lng: null,
      })
      await carregarVisitas()
    } catch (err) {
      toastError('Erro ao salvar visita', err.message)
    } finally {
      setSalvandoVisita(false)
    }
  }

  const kpis = resumo?.kpis || {}
  const margemMinRef =
    catalogoData?.regras_efetivas?.margem_minima_efetiva_pct ??
    resumo?.config_comercial?.margem_minima_padrao_pct ??
    12
  const descMaxRef =
    catalogoData?.regras_efetivas?.desconto_max_efetivo_pct ??
    resumo?.config_comercial?.desconto_max_vendedor_pct ??
    5

  const margemAtualPedido = simulacao?.margem_bruta_pct ?? totaisLocaisCarrinho.margemPct
  const alertaSim = simulacao?.alerta || null

  return (
    <div className="fade-in" style={{ paddingBottom: 40 }}>
      {/* HEADER */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <TrendingUp className="text-primary" size={26} /> Força de Vendas &amp; Trava de Margem
          </h1>
          <p className="page-header__subtitle">
            Cockpit Comercial Atacado (Mobile PWA &amp; Desktop): metas, carteira com semáforo de crédito, preço em cascata, margem em tempo real e mesa de aprovação
          </p>
        </div>

        <div className="flex items-center gap-8 flex-wrap">
          <input
            type="month"
            className="form-input"
            style={{ width: 155 }}
            value={mesRef}
            onChange={(e) => setMesRef(e.target.value)}
          />
          {resumo?.is_gestor && (resumo?.vendedores || []).length > 0 && (
            <select
              className="form-input"
              style={{ width: 195 }}
              value={vendedorFiltro}
              onChange={(e) => setVendedorFiltro(e.target.value)}
            >
              <option value="">Todos os Vendedores</option>
              {resumo.vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.sigla ? `[${v.sigla}] ` : ''}
                  {v.nome}
                </option>
              ))}
            </select>
          )}
          <button className="btn btn--secondary" onClick={carregarResumo} disabled={loading}>
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Força de Vendas & Trava Comercial" />
      <div style={{ marginBottom: 14 }}>
        <PwaInstallBanner />
      </div>

      {/* FILA OFFLINE DO CELULAR (SE HOUVER) */}
      {rascunhosOffline.length > 0 && (
        <div
          className="card mb-16"
          style={{
            padding: 12,
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div className="text-sm">
            <strong>{rascunhosOffline.length} pedido(s) salvo(s) offline</strong> aguardando envio ao servidor:
          </div>
          <div className="flex gap-8 flex-wrap">
            {rascunhosOffline.map((d) => (
              <button
                key={d.id}
                type="button"
                className="btn btn--warning btn--sm"
                disabled={enviandoPedido}
                onClick={() => reenviarRascunhoOffline(d)}
              >
                <Send size={13} /> Enviar {d.cliente_nome} ({fmtMoeda(d.valor_est)})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* NAVEGAÇÃO PRINCIPAL (4 ABAS TOUCH-FRIENDLY) */}
      <div className="flex gap-8 flex-wrap mb-16">
        <button
          type="button"
          className={`btn ${aba === 'CARTEIRA' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('CARTEIRA')}
        >
          <Users size={15} /> Metas &amp; Carteira ({(resumo?.carteira_clientes || []).length})
        </button>
        <button
          type="button"
          className={`btn ${aba === 'NOVO_PEDIDO' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('NOVO_PEDIDO')}
        >
          <ShoppingCart size={15} /> Novo Pedido Rápido {carrinho.length > 0 ? `(${carrinho.length})` : ''}
        </button>
        <button
          type="button"
          className={`btn ${aba === 'APROVACOES' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('APROVACOES')}
          style={{ position: 'relative' }}
        >
          <Lock size={15} /> Mesa de Aprovação &amp; Ranking
          {Number(kpis.fila_aprovacao_total || 0) > 0 && (
            <span className="badge badge--danger" style={{ marginLeft: 4 }}>
              {kpis.fila_aprovacao_total}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`btn ${aba === 'VISITAS' ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setAba('VISITAS')}
        >
          <MapPin size={15} /> Check-in &amp; Visitas CRM
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 1: METAS & CARTEIRA DE CLIENTES                                    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'CARTEIRA' && (
        <div className="flex flex-col gap-16">
          {/* KPIs */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-card__label flex items-center gap-6">
                <DollarSign size={13} /> Vendido no Mês ({mesRef})
              </div>
              <div className="kpi-card__value">{fmtMoeda(kpis.valor_vendido)}</div>
              <div className="kpi-card__sub">
                {kpis.qtd_pedidos || 0} pedido(s) • Ticket {fmtMoeda(kpis.ticket_medio)}
              </div>
              {kpis.meta_mensal_valor > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="flex justify-between text-xs text-muted mb-4">
                    <span>Meta: {fmtMoeda(kpis.meta_mensal_valor)}</span>
                    <strong style={{ color: '#38bdf8' }}>{kpis.atingimento_valor_pct}%</strong>
                  </div>
                  <div style={{ height: 6, background: '#1e293b', borderRadius: 99, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, kpis.atingimento_valor_pct || 0)}%`,
                        height: '100%',
                        background: (kpis.atingimento_valor_pct || 0) >= 100 ? '#22c55e' : '#38bdf8',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="kpi-card">
              <div className="kpi-card__label flex items-center gap-6">
                <Package size={13} /> Volume Vendido (kg)
              </div>
              <div className="kpi-card__value">{fmtKg(kpis.kg_vendido)}</div>
              <div className="kpi-card__sub">
                {kpis.meta_mensal_kg > 0
                  ? `Meta ${fmtKg(kpis.meta_mensal_kg)} (${kpis.atingimento_kg_pct}%)`
                  : 'Sem meta em kg definida'}
              </div>
              {kpis.meta_mensal_kg > 0 && (
                <div style={{ height: 6, background: '#1e293b', borderRadius: 99, overflow: 'hidden', marginTop: 8 }}>
                  <div
                    style={{
                      width: `${Math.min(100, kpis.atingimento_kg_pct || 0)}%`,
                      height: '100%',
                      background: (kpis.atingimento_kg_pct || 0) >= 100 ? '#22c55e' : '#a78bfa',
                    }}
                  />
                </div>
              )}
            </div>

            <div
              className={`kpi-card ${
                kpis.margem_media_pct != null && kpis.margem_media_pct < margemMinRef ? 'kpi-card--warning' : 'kpi-card--success'
              }`}
            >
              <div className="kpi-card__label flex items-center gap-6">
                <Percent size={13} /> Margem Bruta Média
              </div>
              <div className="kpi-card__value">
                {kpis.margem_media_pct != null ? `${kpis.margem_media_pct.toFixed(1)}%` : '—'}
              </div>
              <div className="kpi-card__sub">
                Piso comercial: <strong>{margemMinRef}%</strong> • Desc. máx: <strong>{descMaxRef}%</strong>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-card__label flex items-center gap-6">
                <Award size={13} /> Comissão Estimada
              </div>
              <div className="kpi-card__value" style={{ color: '#4ade80' }}>
                {fmtMoeda(kpis.comissao_estimada)}
              </div>
              <div className="kpi-card__sub">
                {resumo?.vendedor_atual
                  ? `${resumo.vendedor_atual.nome} (${resumo.vendedor_atual.pct_comissao}%)`
                  : 'Selecione um vendedor para apurar'}
              </div>
            </div>
          </div>

          {/* Barra de filtros da carteira */}
          <div className="card" style={{ padding: 14 }}>
            <div className="flex justify-between items-center flex-wrap gap-10 mb-12">
              <div style={{ position: 'relative', flex: '1 1 260px' }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: 13, color: '#64748b' }} />
                <input
                  className="form-input"
                  style={{ paddingLeft: 36 }}
                  placeholder="Buscar cliente por nome, fantasia, código ou cidade..."
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                />
              </div>
              <div className="flex gap-6 flex-wrap">
                {[
                  { id: 'TODOS', label: 'Toda Carteira' },
                  { id: 'INATIVOS', label: 'Sem Comprar (15d+)' },
                  { id: 'RESTRICAO', label: 'Restrição / Atraso' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`btn btn--sm ${filtroCarteira === f.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setFiltroCarteira(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="p-24 text-center text-muted">Carregando carteira de clientes...</div>
            ) : carteiraFiltrada.length === 0 ? (
              <div className="p-24 text-center text-muted">Nenhum cliente encontrado neste filtro.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 12 }}>
                {carteiraFiltrada.map((cli) => {
                  const sem = SEMAFORO_CFG[cli.semaforo] || SEMAFORO_CFG.VERDE
                  const wpp = gerarLinkWhatsApp(cli.telefone, `Olá ${cli.nome_fantasia}, tudo bem? Passando para conferir seu pedido da semana!`)
                  return (
                    <div
                      key={cli.id}
                      style={{
                        background: 'var(--bg-2)',
                        border: `1px solid ${cli.semaforo === 'VERMELHO' ? 'rgba(239,68,68,0.45)' : 'var(--border)'}`,
                        borderRadius: 12,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 9,
                      }}
                    >
                      <div className="flex justify-between items-start gap-8">
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 14.5 }}>
                            {cli.nome_fantasia}
                          </div>
                          <div className="text-xs text-muted">
                            Cód. {cli.codigo || '-'} • {cli.cidade || '-'}/{cli.uf || '-'}
                            {cli.rota_padrao_nome ? ` • Rota ${cli.rota_padrao_nome}` : ''}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 99,
                            background: sem.bg,
                            color: sem.color,
                            border: `1px solid ${sem.border}`,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {sem.label}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11.5 }}>
                        <div style={{ background: 'rgba(15,23,42,0.55)', padding: '6px 8px', borderRadius: 7 }}>
                          <div className="text-muted">Crédito Disp.</div>
                          <div className="font-mono font-bold" style={{ color: cli.limite_credito > 0 ? '#e2e8f0' : '#94a3b8' }}>
                            {cli.limite_credito > 0 ? fmtMoeda(cli.credito_disponivel) : 'Sem limite fixo'}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(15,23,42,0.55)', padding: '6px 8px', borderRadius: 7 }}>
                          <div className="text-muted">Última Compra</div>
                          <div
                            className="font-bold"
                            style={{
                              color:
                                cli.dias_sem_comprar === null || cli.dias_sem_comprar >= 15 ? '#fbbf24' : '#86efac',
                            }}
                          >
                            {cli.dias_sem_comprar === null
                              ? 'Nunca comprou'
                              : cli.dias_sem_comprar === 0
                                ? 'Hoje'
                                : `Há ${cli.dias_sem_comprar} dia(s)`}
                          </div>
                        </div>
                      </div>

                      {(cli.valor_vencido > 0 || cli.bloqueado_financeiro || cli.qtd_alertas_qualidade > 0 || cli.tabela_preco_nome) && (
                        <div className="flex gap-6 flex-wrap">
                          {cli.bloqueado_financeiro && <span className="badge badge--danger">Bloqueado Financeiro</span>}
                          {cli.valor_vencido > 0 && (
                            <span className="badge badge--danger">Vencido: {fmtMoeda(cli.valor_vencido)}</span>
                          )}
                          {cli.tabela_preco_nome && (
                            <span className="badge badge--info">Tab: {cli.tabela_preco_nome}</span>
                          )}
                          {cli.qtd_alertas_qualidade > 0 && (
                            <span className="badge badge--warning">
                              <AlertTriangle size={11} /> {cli.qtd_alertas_qualidade} alerta(s) corte
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex gap-6 mt-auto pt-4">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          style={{ flex: 1, justifyContent: 'center' }}
                          onClick={() => iniciarPedidoParaCliente(cli)}
                        >
                          <Plus size={14} /> Novo Pedido
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => iniciarCheckinParaCliente(cli)}
                          title="Registrar visita comercial"
                        >
                          <MapPin size={13} /> Visita
                        </button>
                        {wpp && (
                          <a
                            href={wpp}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn--success btn--sm"
                            title="Abrir WhatsApp do cliente"
                          >
                            <MessageCircle size={13} />
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 2: NOVO PEDIDO RÁPIDO ATACADO (PREÇO CASCATA + MARGEM AO VIVO)     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'NOVO_PEDIDO' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
          {/* COLUNA ESQUERDA: CLIENTE + CATÁLOGO */}
          <div className="flex flex-col gap-14">
            <div className="card" style={{ padding: 16 }}>
              <div className="form-grid form-grid--2" style={{ gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Cliente Atacado *</label>
                  <select
                    className="form-input"
                    value={clienteSelId}
                    onChange={(e) => {
                      setClienteSelId(e.target.value)
                      setCarrinho([])
                      setSimulacao(null)
                    }}
                  >
                    <option value="">-- Selecione o Cliente --</option>
                    {(resumo?.carteira_clientes || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome_fantasia} {c.cidade ? `(${c.cidade}/${c.uf})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Tabela de Preço</label>
                  <select
                    className="form-input"
                    value={tabelaPrecoSelId}
                    disabled={!clienteSelId}
                    onChange={(e) => {
                      const val = e.target.value
                      setTabelaPrecoSelId(val)
                      if (clienteSelId) carregarCatalogoCliente(clienteSelId, val)
                    }}
                  >
                    <option value="">Padrão (Contrato / Atacado)</option>
                    {(catalogoData?.tabelas_preco || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.codigo} — {t.nome} ({t.finalidade})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Condição Pagamento</label>
                  <select
                    className="form-input"
                    value={formaPgtoSelId}
                    onChange={(e) => setFormaPgtoSelId(e.target.value)}
                  >
                    <option value="">Padrão do Cliente</option>
                    {(auxiliares.formasPagamento || []).map((fp) => (
                      <option key={fp.id} value={fp.id}>
                        {fp.descricao}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Previsão de Entrega</label>
                  <input
                    type="date"
                    className="form-input"
                    value={previsaoEntrega}
                    onChange={(e) => setPrevisaoEntrega(e.target.value)}
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-8 text-sm cursor-pointer" style={{ height: 42 }}>
                    <input
                      type="checkbox"
                      checked={pgtoEntrega}
                      onChange={(e) => setPgtoEntrega(e.target.checked)}
                    />
                    Cobrar na Entrega (PIX/Dinheiro)
                  </label>
                </div>
              </div>

              {/* SAÚDE FINANCEIRA DO CLIENTE SELECIONADO */}
              {catalogoData?.saude_financeira && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: SEMAFORO_CFG[catalogoData.saude_financeira.semaforo]?.bg || 'var(--bg-2)',
                    border: `1px solid ${SEMAFORO_CFG[catalogoData.saude_financeira.semaforo]?.border || 'var(--border)'}`,
                    fontSize: 12,
                  }}
                >
                  <div className="flex justify-between items-center flex-wrap gap-6">
                    <strong>
                      Saúde Financeira: {SEMAFORO_CFG[catalogoData.saude_financeira.semaforo]?.label}
                    </strong>
                    <span className="font-mono">
                      Limite: {catalogoData.saude_financeira.limite_credito > 0 ? fmtMoeda(catalogoData.saude_financeira.limite_credito) : 'Livre'} •
                      Aberto: {fmtMoeda(catalogoData.saude_financeira.credito_utilizado)}
                      {catalogoData.saude_financeira.valor_vencido > 0
                        ? ` • Vencido: ${fmtMoeda(catalogoData.saude_financeira.valor_vencido)}`
                        : ''}
                    </span>
                  </div>
                </div>
              )}

              {/* REPETIR ÚLTIMO PEDIDO EM 1 TOQUE */}
              {(catalogoData?.ultimos_pedidos || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="text-xs text-muted font-bold mb-6">REPETIR ÚLTIMO PEDIDO EM 1 TOQUE:</div>
                  <div className="flex gap-6 flex-wrap">
                    {catalogoData.ultimos_pedidos.slice(0, 3).map((up) => (
                      <button
                        key={up.id}
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => repetirUltimoPedido(up)}
                      >
                        <RotateCcw size={12} /> {up.codigo} ({fmtData(up.created_at)} • {fmtMoeda(up.valor_total)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* CATÁLOGO DE PRODUTOS DO CLIENTE */}
            {clienteSelId && (
              <div className="card" style={{ padding: 16 }}>
                <div className="flex justify-between items-center gap-8 flex-wrap mb-12">
                  <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <Search size={14} style={{ position: 'absolute', left: 11, top: 13, color: '#64748b' }} />
                    <input
                      className="form-input"
                      style={{ paddingLeft: 34 }}
                      placeholder="Buscar corte, código ou código auxiliar do cliente..."
                      value={buscaProd}
                      onChange={(e) => setBuscaProd(e.target.value)}
                    />
                  </div>
                  <label className="text-xs flex items-center gap-6 cursor-pointer">
                    <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} />
                    Só com saldo
                  </label>
                </div>

                {loadingCatalogo ? (
                  <div className="p-20 text-center text-muted">Calculando preços e saldos do cliente...</div>
                ) : (
                  <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {catalogoFiltrado.slice(0, 80).map((p) => {
                      const orig = ORIGEM_PRECO_BADGE[p.origem_preco] || ORIGEM_PRECO_BADGE.CADASTRO_BASE
                      const semSaldo = Number(p.saldo_kg || 0) <= 0
                      return (
                        <div
                          key={p.id}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'var(--bg-2)',
                            border: `1px solid ${p.alerta_reclamacao ? 'rgba(245,158,11,0.55)' : 'var(--border)'}`,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div className="flex items-center gap-6 flex-wrap">
                              <span className="font-mono text-xs text-primary font-bold">{p.codigo}</span>
                              <strong style={{ fontSize: 13.5 }}>{p.descricao}</strong>
                              <span className={`badge ${orig.cls}`} style={{ fontSize: 10 }}>
                                {orig.label}
                              </span>
                            </div>
                            <div className="text-xs text-muted mt-4 flex items-center gap-10 flex-wrap">
                              <span style={{ color: semSaldo ? '#f87171' : '#86efac', fontWeight: 700 }}>
                                Estoque: {fmtKg(p.saldo_kg)} ({p.qtd_caixas} cx)
                              </span>
                              <span>
                                Preço: <strong style={{ color: '#f8fafc' }}>{fmtMoeda(p.preco_sugerido)}/kg</strong>
                              </span>
                              {p.custo_unitario > 0 && (
                                <span>
                                  Custo: {fmtMoeda(p.custo_unitario)}
                                  {p.margem_sugerida_pct != null ? ` (Mg ${p.margem_sugerida_pct}%)` : ''}
                                </span>
                              )}
                            </div>
                            {p.alerta_reclamacao && (
                              <div className="text-xs" style={{ color: '#fbbf24', marginTop: 4 }}>
                                ⚠️ Alerta cliente: {p.alerta_descricao || 'Atenção especial ao padrão de corte'}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            style={{ flexShrink: 0 }}
                            onClick={() => adicionarProdutoCarrinho(p)}
                          >
                            <Plus size={14} /> Add
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* COLUNA DIREITA: CARRINHO + SIMULADOR DE MARGEM EM TEMPO REAL */}
          <div className="card" style={{ padding: 16, position: 'sticky', top: 14 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0, fontSize: 16 }} className="flex items-center gap-8">
                <ShoppingCart size={18} className="text-primary" /> Carrinho &amp; Simulador de Margem
              </h3>
              {carrinho.length > 0 && (
                <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => setCarrinho([])}>
                  Limpar
                </button>
              )}
            </div>

            {carrinho.length === 0 ? (
              <div className="p-24 text-center text-muted text-sm">
                {clienteSelId
                  ? 'Adicione produtos do catálogo ao lado ou clique em "Repetir Último Pedido".'
                  : 'Selecione um cliente para carregar os preços negociados e estoque em tempo real.'}
              </div>
            ) : (
              <div className="flex flex-col gap-12">
                <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {carrinho.map((it) => {
                    const kg = Math.max(0, Number(it.qtd_kg || 0))
                    const preco = Math.max(0, Number(it.preco_unitario || 0))
                    const desc = Math.max(0, Math.min(100, Number(it.desconto_pct || 0)))
                    const precoLiq = preco * (1 - desc / 100)
                    const subtotal = kg * precoLiq
                    const margemIt =
                      precoLiq > 0 && it.custo_unitario > 0
                        ? Number((((precoLiq - it.custo_unitario) / precoLiq) * 100).toFixed(1))
                        : null
                    const abaixoCusto = it.custo_unitario > 0 && precoLiq < it.custo_unitario
                    const margemBaixa = margemIt !== null && margemIt < margemMinRef

                    return (
                      <div
                        key={it.produto_id}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          background: 'var(--bg-2)',
                          border: `1px solid ${abaixoCusto ? '#ef4444' : margemBaixa ? '#f59e0b' : 'var(--border)'}`,
                        }}
                      >
                        <div className="flex justify-between items-center gap-6 mb-8">
                          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                            <span className="font-mono text-primary">{it.codigo}</span> {it.descricao}
                          </div>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm text-danger"
                            style={{ padding: '2px 5px' }}
                            onClick={() => setCarrinho((prev) => prev.filter((x) => x.produto_id !== it.produto_id))}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.85fr', gap: 6 }}>
                          <div>
                            <label className="text-xs text-muted">Qtd (kg)</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.1"
                              className="form-input font-mono"
                              style={{ height: 34, fontSize: 12.5 }}
                              value={it.qtd_kg}
                              onChange={(e) =>
                                setCarrinho((prev) =>
                                  prev.map((x) => (x.produto_id === it.produto_id ? { ...x, qtd_kg: e.target.value } : x)),
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted">Preço (R$/kg)</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="form-input font-mono"
                              style={{ height: 34, fontSize: 12.5 }}
                              value={it.preco_unitario}
                              onChange={(e) =>
                                setCarrinho((prev) =>
                                  prev.map((x) =>
                                    x.produto_id === it.produto_id ? { ...x, preco_unitario: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted">Desc %</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              className="form-input font-mono"
                              style={{ height: 34, fontSize: 12.5 }}
                              value={it.desconto_pct}
                              onChange={(e) =>
                                setCarrinho((prev) =>
                                  prev.map((x) =>
                                    x.produto_id === it.produto_id ? { ...x, desconto_pct: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>

                        <div className="flex justify-between items-center text-xs mt-8">
                          <span className="font-mono font-bold">{fmtMoeda(subtotal)}</span>
                          <div className="flex gap-6 items-center">
                            {it.custo_unitario > 0 && (
                              <span className="text-muted">Custo {fmtMoeda(it.custo_unitario)}</span>
                            )}
                            {margemIt !== null && (
                              <span
                                className={`badge ${
                                  abaixoCusto ? 'badge--danger' : margemBaixa ? 'badge--warning' : 'badge--success'
                                }`}
                                style={{ fontSize: 10 }}
                              >
                                {abaixoCusto ? `PREJUÍZO (${margemIt}%)` : `Mg ${margemIt}%`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* RESUMO FINANCEIRO & MARGEM DO PEDIDO */}
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.72)',
                    border: '1px solid var(--border)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 8,
                    textAlign: 'center',
                  }}
                >
                  <div>
                    <div className="text-xs text-muted">TOTAL ({totaisLocaisCarrinho.kg} kg)</div>
                    <div className="font-mono font-bold" style={{ fontSize: 15 }}>
                      {fmtMoeda(totaisLocaisCarrinho.receita)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">CUSTO EST.</div>
                    <div className="font-mono font-bold" style={{ fontSize: 14, color: '#cbd5e1' }}>
                      {totaisLocaisCarrinho.custo > 0 ? fmtMoeda(totaisLocaisCarrinho.custo) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">MARGEM REAL</div>
                    <div
                      className="font-mono font-bold"
                      style={{
                        fontSize: 15,
                        color:
                          margemAtualPedido == null
                            ? '#94a3b8'
                            : margemAtualPedido < 0
                              ? '#ef4444'
                              : margemAtualPedido < margemMinRef
                                ? '#f59e0b'
                                : '#22c55e',
                      }}
                    >
                      {margemAtualPedido != null ? `${margemAtualPedido.toFixed(1)}%` : '—'}
                    </div>
                  </div>
                </div>

                {/* ALERTA DE TRAVA COMERCIAL (QUANDO DISPARADA NA SIMULAÇÃO) */}
                {alertaSim?.exige_aprovacao && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'rgba(245, 158, 11, 0.14)',
                      border: '1px solid rgba(245, 158, 11, 0.55)',
                      fontSize: 12,
                      color: '#fde68a',
                    }}
                  >
                    <div className="font-bold flex items-center gap-6 mb-4">
                      <Lock size={14} /> Trava Comercial Ativada — Irá para Aprovação Gerencial
                    </div>
                    {(alertaSim.motivos || []).map((m, idx) => (
                      <div key={idx}>• {m}</div>
                    ))}
                  </div>
                )}

                <input
                  className="form-input"
                  placeholder="Observações do pedido (corte, horário entrega, doca...)"
                  value={obsPedido}
                  onChange={(e) => setObsPedido(e.target.value)}
                />

                <div className="flex gap-8">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={enviandoPedido}
                    onClick={() => enviarPedidoMobile(true)}
                  >
                    Salvar Rascunho
                  </button>
                  <button
                    type="button"
                    className={`btn ${alertaSim?.exige_aprovacao ? 'btn--warning' : 'btn--success'}`}
                    style={{ flex: 1.5, justifyContent: 'center', fontWeight: 800 }}
                    disabled={enviandoPedido}
                    onClick={() => enviarPedidoMobile(false)}
                  >
                    <Send size={15} />{' '}
                    {enviandoPedido
                      ? 'Enviando...'
                      : alertaSim?.exige_aprovacao
                        ? 'Enviar p/ Aprovação 🔒'
                        : 'Enviar Pedido'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 3: MESA DE APROVAÇÃO COMERCIAL & RANKING DA EQUIPE                 */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'APROVACOES' && (
        <div className="flex flex-col gap-16">
          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-center flex-wrap gap-10 mb-14">
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }} className="flex items-center gap-8">
                  <ShieldAlert size={18} className="text-warning" /> Mesa de Aprovação Comercial (Margem, Desconto &amp; Crédito)
                </h3>
                <div className="text-xs text-muted mt-2">
                  Pedidos retidos automaticamente pela Trava Comercial exigem aprovação de Master/Gerente ou PIN Gerencial para seguir à Separação.
                </div>
              </div>
              <div className="flex gap-8">
                <button
                  type="button"
                  className={`btn btn--sm ${modoAprov === 'PENDENTES' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setModoAprov('PENDENTES')}
                >
                  Pendentes
                </button>
                <button
                  type="button"
                  className={`btn btn--sm ${modoAprov === 'HISTORICO' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setModoAprov('HISTORICO')}
                >
                  Histórico Auditado
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={carregarAprovacoes}>
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            {loadingAprov ? (
              <div className="p-24 text-center text-muted">Carregando fila de aprovações...</div>
            ) : aprovacoes.length === 0 ? (
              <div className="p-28 text-center text-muted">
                <ShieldCheck size={34} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <div>Nenhum pedido aguardando aprovação comercial neste filtro.</div>
              </div>
            ) : (
              <div className="flex flex-col gap-12">
                {aprovacoes.map((ped) => {
                  const al = ped.alerta_comercial || {}
                  return (
                    <div
                      key={ped.id}
                      style={{
                        border: `1px solid ${ped.status === 'BLOQUEADO_COMERCIAL' ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                        borderRadius: 12,
                        padding: 14,
                        background: 'var(--bg-2)',
                      }}
                    >
                      <div className="flex justify-between items-start flex-wrap gap-10 mb-10">
                        <div>
                          <div className="flex items-center gap-8 flex-wrap">
                            <strong className="font-mono" style={{ fontSize: 15, color: '#38bdf8' }}>
                              {ped.codigo}
                            </strong>
                            <strong>{ped.cliente}</strong>
                            {ped.vendedor_nome && <span className="badge badge--purple">{ped.vendedor_nome}</span>}
                            <span
                              className={`badge ${
                                ped.status === 'BLOQUEADO_COMERCIAL' ? 'badge--warning' : 'badge--success'
                              }`}
                            >
                              {ped.status === 'BLOQUEADO_COMERCIAL' ? '🔒 Aguardando Aprovação' : ped.status}
                            </span>
                          </div>
                          <div className="text-xs text-muted mt-4">
                            Total: <strong>{fmtMoeda(ped.valor_total)}</strong> • Custo Est.:{' '}
                            <strong>{fmtMoeda(ped.custo_total_estimado)}</strong> • Margem Real:{' '}
                            <strong
                              style={{
                                color:
                                  ped.margem_bruta_pct == null
                                    ? '#94a3b8'
                                    : ped.margem_bruta_pct < margemMinRef
                                      ? '#f87171'
                                      : '#4ade80',
                              }}
                            >
                              {ped.margem_bruta_pct != null ? `${ped.margem_bruta_pct.toFixed(1)}%` : '—'}
                            </strong>{' '}
                            • Criado em {fmtDataHora(ped.created_at)}
                          </div>
                        </div>

                        {ped.status === 'BLOQUEADO_COMERCIAL' ? (
                          <div className="flex gap-8">
                            <button
                              type="button"
                              className="btn btn--success btn--sm"
                              onClick={() => {
                                setModalAprov({ pedido: ped, acao: 'APROVAR' })
                                setPinAprov('')
                                setObsAprov('')
                              }}
                            >
                              <Unlock size={14} /> Aprovar &amp; Liberar
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => {
                                setModalAprov({ pedido: ped, acao: 'REJEITAR' })
                                setPinAprov('')
                                setObsAprov('')
                              }}
                            >
                              <XCircle size={14} /> Devolver
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs text-muted">
                            Tratado por <strong>{ped.aprovado_comercial_por_nome || '-'}</strong> em{' '}
                            {fmtDataHora(ped.aprovado_comercial_em)}
                            {ped.aprovado_comercial_obs ? ` — "${ped.aprovado_comercial_obs}"` : ''}
                          </div>
                        )}
                      </div>

                      {Array.isArray(al.motivos) && al.motivos.length > 0 && (
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'rgba(239,68,68,0.1)',
                            border: '1px solid rgba(239,68,68,0.32)',
                            color: '#fca5a5',
                            fontSize: 12,
                            marginBottom: 10,
                          }}
                        >
                          {al.motivos.map((m, i) => (
                            <div key={i}>• {m}</div>
                          ))}
                        </div>
                      )}

                      {(ped.itens || []).length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="table" style={{ fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th>Produto</th>
                                <th style={{ textAlign: 'right' }}>Qtd</th>
                                <th style={{ textAlign: 'right' }}>Custo</th>
                                <th style={{ textAlign: 'right' }}>Preço</th>
                                <th style={{ textAlign: 'right' }}>Desc %</th>
                                <th style={{ textAlign: 'right' }}>Margem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ped.itens.map((it) => (
                                <tr key={it.produto_id}>
                                  <td>
                                    <span className="font-mono text-muted">{it.produto_codigo}</span>{' '}
                                    {it.produto_descricao}
                                  </td>
                                  <td style={{ textAlign: 'right' }} className="font-mono">
                                    {fmtKg(it.qtd_kg_solicitada)}
                                  </td>
                                  <td style={{ textAlign: 'right' }} className="font-mono">
                                    {it.custo_unitario_ref > 0 ? fmtMoeda(it.custo_unitario_ref) : '—'}
                                  </td>
                                  <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                                    {fmtMoeda(it.preco_unitario)}
                                  </td>
                                  <td style={{ textAlign: 'right' }} className="font-mono">
                                    {it.desconto_pct > 0 ? `${it.desconto_pct}%` : '—'}
                                  </td>
                                  <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                                    <span
                                      style={{
                                        color:
                                          it.margem_item_pct == null
                                            ? '#94a3b8'
                                            : it.margem_item_pct < 0
                                              ? '#ef4444'
                                              : it.margem_item_pct < margemMinRef
                                                ? '#f59e0b'
                                                : '#22c55e',
                                      }}
                                    >
                                      {it.margem_item_pct != null ? `${it.margem_item_pct.toFixed(1)}%` : '—'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* RANKING DA EQUIPE COMERCIAL */}
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }} className="flex items-center gap-8">
              <Award size={18} className="text-primary" /> Ranking &amp; Metas da Equipe Comercial ({mesRef})
            </h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th style={{ textAlign: 'center' }}>Pedidos</th>
                    <th style={{ textAlign: 'right' }}>Volume (kg)</th>
                    <th style={{ textAlign: 'right' }}>Vendido (R$)</th>
                    <th style={{ textAlign: 'right' }}>Meta (R$)</th>
                    <th style={{ textAlign: 'right' }}>Margem Média</th>
                    <th style={{ textAlign: 'right' }}>Comissão Est.</th>
                    <th style={{ textAlign: 'center' }}>Limites (Desc / Mg)</th>
                  </tr>
                </thead>
                <tbody>
                  {(resumo?.ranking_vendedores || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 24 }} className="text-muted">
                        Nenhum vendedor cadastrado.
                      </td>
                    </tr>
                  ) : (
                    resumo.ranking_vendedores.map((rv) => (
                      <tr key={rv.vendedor_id}>
                        <td className="font-bold">
                          {rv.sigla && <span className="badge badge--info mr-6">{rv.sigla}</span>} {rv.nome}
                        </td>
                        <td style={{ textAlign: 'center' }} className="td-mono">
                          {rv.qtd_pedidos}
                          {rv.pedidos_bloqueados_comercial > 0 && (
                            <span className="badge badge--warning ml-6" style={{ fontSize: 10 }}>
                              {rv.pedidos_bloqueados_comercial} bloq.
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono">
                          {fmtKg(rv.kg_vendido)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono font-bold">
                          {fmtMoeda(rv.valor_vendido)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono">
                          {rv.meta_mensal_valor > 0 ? (
                            <>
                              {fmtMoeda(rv.meta_mensal_valor)}{' '}
                              <span className="text-xs text-primary">({rv.atingimento_valor_pct}%)</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono font-bold">
                          {rv.margem_media_pct != null ? `${rv.margem_media_pct.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }} className="td-mono text-success font-bold">
                          {fmtMoeda(rv.comissao_estimada)}
                        </td>
                        <td style={{ textAlign: 'center' }} className="td-mono text-xs">
                          ≤ {rv.desconto_max_pct}% / ≥ {rv.margem_minima_pct ?? resumo?.config_comercial?.margem_minima_padrao_pct ?? 12}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 4: CHECK-IN & VISITAS CRM COM GPS                                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'VISITAS' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16 }}>
          <form className="card flex flex-col gap-12" style={{ padding: 16 }} onSubmit={handleSalvarVisita}>
            <h3 style={{ margin: 0, fontSize: 16 }} className="flex items-center gap-8">
              <MapPin size={18} className="text-primary" /> Registrar Visita / Contato Comercial
            </h3>
            <div>
              <label className="form-label">Cliente da Carteira</label>
              <select
                className="form-input"
                value={visitaForm.cliente_id}
                onChange={(e) => {
                  const id = e.target.value
                  const cli = (resumo?.carteira_clientes || []).find((c) => c.id === id)
                  setVisitaForm((f) => ({
                    ...f,
                    cliente_id: id,
                    cliente_nome: cli ? cli.nome_fantasia || cli.razao_social : f.cliente_nome,
                  }))
                }}
              >
                <option value="">-- Prospecto / Avulso --</option>
                {(resumo?.carteira_clientes || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome_fantasia} ({c.cidade || '-'})
                  </option>
                ))}
              </select>
            </div>
            {!visitaForm.cliente_id && (
              <div>
                <label className="form-label">Nome do Prospecto / Estabelecimento *</label>
                <input
                  className="form-input"
                  placeholder="Ex: Açougue Bom Boi"
                  value={visitaForm.cliente_nome}
                  onChange={(e) => setVisitaForm((f) => ({ ...f, cliente_nome: e.target.value }))}
                />
              </div>
            )}
            <div className="form-grid form-grid--2">
              <div>
                <label className="form-label">Canal</label>
                <select
                  className="form-input"
                  value={visitaForm.tipo}
                  onChange={(e) => setVisitaForm((f) => ({ ...f, tipo: e.target.value }))}
                >
                  <option value="PRESENCIAL">Visita Presencial</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="TELEFONE">Telefone</option>
                </select>
              </div>
              <div>
                <label className="form-label">Resultado</label>
                <select
                  className="form-input"
                  value={visitaForm.resultado}
                  onChange={(e) => setVisitaForm((f) => ({ ...f, resultado: e.target.value }))}
                >
                  {RESULTADO_VISITA_OPTS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-grid form-grid--2">
              <div>
                <label className="form-label">Próximo Contato</label>
                <input
                  type="date"
                  className="form-input"
                  value={visitaForm.proximo_contato_em}
                  onChange={(e) => setVisitaForm((f) => ({ ...f, proximo_contato_em: e.target.value }))}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleCapturarGpsVisita}
                  disabled={capturandoGps}
                >
                  <MapPin size={14} />{' '}
                  {capturandoGps
                    ? 'Capturando...'
                    : visitaForm.lat != null
                      ? 'GPS OK ✓'
                      : 'Capturar GPS'}
                </button>
              </div>
            </div>
            <div>
              <label className="form-label">Resumo da Negociação / Observações</label>
              <textarea
                className="form-input"
                rows={3}
                style={{ height: 'auto', padding: 10 }}
                placeholder="Ex: Cotou contra-filé e picanha para sexta-feira, pediu retorno amanhã..."
                value={visitaForm.observacoes}
                onChange={(e) => setVisitaForm((f) => ({ ...f, observacoes: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={salvandoVisita}>
              <CheckCircle2 size={15} /> {salvandoVisita ? 'Salvando...' : 'Salvar Check-in CRM'}
            </button>
          </form>

          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0, fontSize: 16 }}>Histórico Recente de Visitas ({visitas.length})</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={carregarVisitas}>
                <RefreshCw size={13} />
              </button>
            </div>
            {loadingVisitas ? (
              <div className="p-20 text-center text-muted">Carregando histórico...</div>
            ) : visitas.length === 0 ? (
              <div className="p-24 text-center text-muted text-sm">Nenhuma visita registrada ainda.</div>
            ) : (
              <div className="flex flex-col gap-10" style={{ maxHeight: 460, overflowY: 'auto' }}>
                {visitas.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="flex justify-between items-center gap-8 flex-wrap">
                      <strong>{v.cliente_nome}</strong>
                      <div className="flex gap-6">
                        <span className="badge badge--info">{v.tipo}</span>
                        <span className="badge badge--success">
                          {RESULTADO_VISITA_OPTS.find((r) => r.id === v.resultado)?.label || v.resultado}
                        </span>
                      </div>
                    </div>
                    {v.observacoes && <div className="text-xs mt-6">{v.observacoes}</div>}
                    <div className="text-xs text-muted mt-6 flex justify-between flex-wrap gap-6">
                      <span>
                        {v.vendedor_nome || v.operador_nome} • {fmtDataHora(v.created_at)}
                        {v.proximo_contato_em ? ` • Retorno: ${fmtData(v.proximo_contato_em)}` : ''}
                      </span>
                      {v.lat != null && v.lng != null && (
                        <a
                          href={gerarLinkGoogleMapsCoords(v.lat, v.lng)}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#38bdf8' }}
                        >
                          Ver GPS ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL APROVAÇÃO / DEVOLUÇÃO COMERCIAL */}
      {modalAprov && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 98,
            backgroundColor: 'rgba(5,9,18,0.84)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => e.target === e.currentTarget && !processandoAprov && setModalAprov(null)}
        >
          <div className="card" style={{ width: '95vw', maxWidth: 460, padding: 22 }}>
            <div className="flex justify-between items-center mb-12">
              <h3 style={{ margin: 0 }} className="flex items-center gap-8">
                {modalAprov.acao === 'APROVAR' ? (
                  <>
                    <Unlock size={18} className="text-success" /> Aprovar {modalAprov.pedido.codigo}
                  </>
                ) : (
                  <>
                    <XCircle size={18} className="text-danger" /> Devolver {modalAprov.pedido.codigo}
                  </>
                )}
              </h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalAprov(null)}>
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted mb-12">
              Cliente: <strong>{modalAprov.pedido.cliente}</strong> • Total:{' '}
              <strong>{fmtMoeda(modalAprov.pedido.valor_total)}</strong> • Margem:{' '}
              <strong>
                {modalAprov.pedido.margem_bruta_pct != null ? `${modalAprov.pedido.margem_bruta_pct.toFixed(1)}%` : '—'}
              </strong>
            </p>
            <form onSubmit={handleConfirmarAprovacaoModal} className="flex flex-col gap-12">
              {!resumo?.is_gestor && (
                <div>
                  <label className="form-label flex items-center gap-6">
                    <KeyRound size={13} /> PIN Gerencial (Master / Gerente) *
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    className="form-input font-mono"
                    placeholder="Informe o PIN de 4 a 6 dígitos"
                    value={pinAprov}
                    onChange={(e) => setPinAprov(e.target.value)}
                    required
                  />
                </div>
              )}
              <div>
                <label className="form-label">
                  {modalAprov.acao === 'APROVAR' ? 'Justificativa / Observação Gerencial' : 'Motivo da Devolução *'}
                </label>
                <input
                  className="form-input"
                  placeholder={
                    modalAprov.acao === 'APROVAR'
                      ? 'Ex: Aprovado negociação especial de volume'
                      : 'Ex: Reajustar preço da picanha para margem mínima'
                  }
                  value={obsAprov}
                  onChange={(e) => setObsAprov(e.target.value)}
                  required={modalAprov.acao === 'REJEITAR'}
                />
              </div>
              <div className="flex justify-end gap-8 mt-4">
                <button type="button" className="btn btn--secondary" onClick={() => setModalAprov(null)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={`btn ${modalAprov.acao === 'APROVAR' ? 'btn--success' : 'btn--danger'}`}
                  disabled={processandoAprov}
                >
                  {processandoAprov
                    ? 'Processando...'
                    : modalAprov.acao === 'APROVAR'
                      ? 'Confirmar Aprovação'
                      : 'Devolver p/ Rascunho'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
