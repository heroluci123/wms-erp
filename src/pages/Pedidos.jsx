import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  Plus,
  Search,
  Printer,
  Truck,
  CheckCircle2,
  Edit3,
  Trash2,
  Send,
  Eye,
  X,
  AlertTriangle,
  ShieldAlert,
  Package,
  RefreshCw,
  Scale,
  Box,
  Tag,
  Copy,
  Zap,
  MessageSquare,
  DollarSign,
  Lock,
  Unlock,
  Calendar,
  ArrowUpDown,
  RotateCcw,
  Save,
  FileText,
  Percent
} from 'lucide-react'
import { pedidosQueries } from '../queries/pedidos'
import { cadastrosQueries } from '../queries/cadastros'
import { whatsappQueries } from '../queries/whatsapp'
import { isApiEnabled } from '../lib/apiClient'
import * as saidaQueries from '../queries/saida'
import { useAppStore } from '../store/appStore'
import { temPermissao } from '../utils/permissoes'
import { FolhaPedidoPrint } from '../components/shared/FolhaPedidoPrint'
import { RomaneioEmbarquePrint } from '../components/shared/RomaneioEmbarquePrint'
import { EtiquetaReservaZebraModal } from '../components/shared/EtiquetaZebraPrint'
import { ClienteSearchSelect, SmartSearchSelect } from '../components/shared/SmartSearchSelect'

const STATUS_BADGE = {
  RASCUNHO: { label: 'Rascunho', cls: 'badge--neutral' },
  BLOQUEADO_COMERCIAL: { label: '🔒 Trava Comercial', cls: 'badge--warning' },
  BLOQUEADO_ESTOQUE: { label: '🔒 Trava Estoque', cls: 'badge--danger' },
  LIBERADO: { label: 'Liberado p/ Separação', cls: 'badge--info' },
  EM_SEPARACAO: { label: 'Em Separação', cls: 'badge--warning' },
  AGUARDANDO_CONFERENCIA: { label: 'Separação Finalizada', cls: 'badge--purple' },
  EM_CONFERENCIA: { label: 'Em Conferência', cls: 'badge--warning' },
  EXPEDIDO: { label: 'Expedido', cls: 'badge--success' },
  CANCELADO: { label: 'Cancelado', cls: 'badge--danger' }
}

const ORIGEM_BADGE = {
  SUPPLY_CHAIN: { label: 'Supply Chain', cls: 'badge--info' },
  FATURAMENTO: { label: 'Faturamento', cls: 'badge--info' },
  FINANCEIRO: { label: 'Financeiro', cls: 'badge--warning' },
  WHATSAPP: { label: 'WhatsApp', cls: 'badge--success' },
  VENDEDOR: { label: 'Vendedor', cls: 'badge--purple' },
  PORTAL: { label: 'Portal', cls: 'badge--neutral' },
  SISTEMA: { label: 'Sistema', cls: 'badge--neutral' },
}

const normTxt = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

function gerarTituloAutomaticoLocal(clienteNome, previsaoEntrega) {
  const clean = String(clienteNome || 'PEDIDO')
    .trim()
    .toUpperCase()
    .replace(/\b(LIMITADA|LTDA\.?|EIRELI|S\/A|S\.A\.?|ME|EPP|COMERCIO|COMÉRCIO|ALIMENTOS|DISTRIBUIDORA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const palavras = (clean || String(clienteNome || 'PEDIDO').trim().toUpperCase()).split(' ').filter(Boolean)
  let abrev = palavras[0] || 'PEDIDO'
  if (palavras.length >= 2) {
    const p2 = palavras[1]
    abrev = `${palavras[0]} ${p2.length > 4 ? `${p2.slice(0, 4)}.` : p2}`
  }
  if (abrev.length > 18) abrev = `${abrev.slice(0, 17).trim()}.`
  const iso = previsaoEntrega && /^\d{4}-\d{2}-\d{2}/.test(String(previsaoEntrega))
    ? String(previsaoEntrega).slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const parts = iso.split('-')
  const ddmm = parts.length === 3 ? `${parts[2]}/${parts[1]}` : ''
  return ddmm ? `${abrev} ${ddmm}` : abrev
}

function calcularValoresItem(item) {
  const kg = Number(String(item.qtd_kg_solicitada ?? 0).replace(',', '.') || 0)
  const preco = Number(String(item.preco_unitario ?? 0).replace(',', '.') || 0)
  const descPct = Math.max(0, Math.min(100, Number(String(item.desconto_pct ?? 0).replace(',', '.') || 0)))
  const descFixo = Math.max(0, Number(String(item.desconto_valor ?? 0).replace(',', '.') || 0))
  const bruto = Number((kg * preco).toFixed(2))
  const descPctVal = descPct > 0 ? Number(((bruto * descPct) / 100).toFixed(2)) : 0
  const descontoTotal = Math.min(bruto, Number((descPctVal + descFixo).toFixed(2)))
  const liquido = Math.max(0, Number((bruto - descontoTotal).toFixed(2)))
  return { kg, preco, descPct, descFixo, bruto, descontoTotal, liquido }
}

const temSaldoProduto = (p) => Number(p?.saldo_kg || 0) > 0 || Number(p?.qtd_caixas ?? p?.saldo_caixas ?? 0) > 0

/** Ordena produtos priorizando itens com saldo em estoque antes dos zerados */
const ordenarProdutosSaldoPrimeiro = (lista) =>
  [...lista].sort((a, b) => {
    const prioA = temSaldoProduto(a) ? 0 : 1
    const prioB = temSaldoProduto(b) ? 0 : 1
    if (prioA !== prioB) return prioA - prioB
    return String(a?.descricao || '').localeCompare(String(b?.descricao || ''), 'pt-BR')
  })

const fmtCx = (v) => {
  const n = Number(v || 0)
  const rounded = Math.abs(n - Math.round(n)) < 0.01 ? Math.round(n) : Number(n.toFixed(2))
  return `${rounded.toLocaleString('pt-BR')} cx`
}

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0].split(' ')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const isoHojeLocal = (offsetDias = 0) => {
  const dt = new Date()
  dt.setDate(dt.getDate() + offsetDias)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const fmtDataHora = (d) => {
  if (!d) return '-'
  const raw = String(d)
  const utc = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const dt = new Date(utc)
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleString('pt-BR')
}

export function Pedidos() {
  const navigate = useNavigate()
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeGerenciarPedidos = temPermissao(operador, 'pedidos')
  const podeFinanceiroPedidos = temPermissao(operador, 'financeiro_pedidos')
  const podeAcessarTela = podeGerenciarPedidos || podeFinanceiroPedidos
  const somenteFinanceiro = podeFinanceiroPedidos && !podeGerenciarPedidos
  const apiAtiva = isApiEnabled()

  const [aba, setAba] = useState('GERENCIADOR') // 'GERENCIADOR' | 'FORM'
  const [loading, setLoading] = useState(false)
  const [pedidos, setPedidos] = useState([])
  const [produtos, setProdutos] = useState([])
  const [clientes, setClientes] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [auxiliares, setAuxiliares] = useState({ formasPagamento: [], locaisCobranca: [], naturezasOperacao: [], marchantes: [] })
  const [especificacoesCliente, setEspecificacoesCliente] = useState([])
  const [cfopSugerido, setCfopSugerido] = useState(null)

  // Filtros do Gerenciador (padrão: Previsão de Entrega = Hoje + Amanhã)
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [presetData, setPresetData] = useState('HOJE_AMANHA') // 'HOJE_AMANHA' | 'HOJE' | 'AMANHA' | 'PROX_7' | 'TODAS' | 'SEM_PREVISAO' | 'CUSTOM'
  const [campoData, setCampoData] = useState('PREVISAO') // 'PREVISAO' | 'CRIACAO'
  const [dataInicio, setDataInicio] = useState(() => isoHojeLocal(0))
  const [dataFim, setDataFim] = useState(() => isoHojeLocal(1))
  const [semPrevisao, setSemPrevisao] = useState(false)
  const [filtroVendedorId, setFiltroVendedorId] = useState('')
  const [filtroFormaPagtoId, setFiltroFormaPagtoId] = useState('')
  const [filtroSetor, setFiltroSetor] = useState('TODOS')
  const [filtroPagtoEntrega, setFiltroPagtoEntrega] = useState(false)
  const [ordenarPor, setOrdenarPor] = useState('CODIGO_DESC')
  const [kpisGeraisApi, setKpisGeraisApi] = useState(null)
  const [totalGeralApi, setTotalGeralApi] = useState(0)

  // Formulário Novo / Editar Pedido
  const [editId, setEditId] = useState(null)
  const [editCodigo, setEditCodigo] = useState('')
  const [editStatus, setEditStatus] = useState(null)
  const [abaForm, setAbaForm] = useState('ITENS') // 'ITENS' | 'NF_DESCONTOS'
  const [titulo, setTitulo] = useState('')
  const [observacaoNf, setObservacaoNf] = useState('')
  const [descGlobalTipo, setDescGlobalTipo] = useState('PCT') // 'PCT' | 'VALOR'
  const [descGlobalInput, setDescGlobalInput] = useState('')
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState(null)
  const [origemWppForcada, setOrigemWppForcada] = useState(false)
  const [vendedorId, setVendedorId] = useState('')
  const [formaPagamentoId, setFormaPagamentoId] = useState('')
  const [localCobrancaId, setLocalCobrancaId] = useState('')
  const [naturezaId, setNaturezaId] = useState('')
  const [marchante, setMarchante] = useState('FRIGODIL')
  const [pagamentoNaEntrega, setPagamentoNaEntrega] = useState(0)
  const [mostrarTrocaCliente, setMostrarTrocaCliente] = useState(false)
  const [modalNovoClienteAberto, setModalNovoClienteAberto] = useState(false)
  const [novoCliForm, setNovoCliForm] = useState({
    codigo: '', razao_social: '', nome_fantasia: '', cnpj_cpf: '', inscricao_estadual: '',
    endereco: '', numero: '', bairro: '', cep: '', cidade: '', uf: 'SP', pais: 'BRASIL',
    telefone: '', icms: 'CONTRIBUINTE'
  })
  const [previsaoEntrega, setPrevisaoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [itensForm, setItensForm] = useState([])

  // Novo seletor integrado de produto (Código + Autocomplete Descrição + Lupa)
  const [codigoInput, setCodigoInput] = useState('')
  const [descricaoInput, setDescricaoInput] = useState('')
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false)
  const [indiceSugestao, setIndiceSugestao] = useState(-1)

  // Modal da lupa e WhatsApp
  const [modalBuscaAberto, setModalBuscaAberto] = useState(false)
  const [modalBuscaTexto, setModalBuscaTexto] = useState('')
  const [modalSomenteComSaldo, setModalSomenteComSaldo] = useState(false)
  const [modalWhatsappAberto, setModalWhatsappAberto] = useState(false)
  const [whatsappTextoInput, setWhatsappTextoInput] = useState('')
  const [parseandoWpp, setParseandoWpp] = useState(false)

  // Quantidade, Preço, Unidade (KG padrão / CX) e Peso Manual fallback
  const [unidadeInput, setUnidadeInput] = useState('KG') // 'KG' | 'CX'
  const [qtdInput, setQtdInput] = useState('')
  const [precoUnitInput, setPrecoUnitInput] = useState('')
  const [pesoManualCxInput, setPesoManualCxInput] = useState('')
  const [obsItemInput, setObsItemInput] = useState('')

  const codigoRef = useRef(null)
  const descricaoRef = useRef(null)
  const qtdRef = useRef(null)
  const modalBuscaRef = useRef(null)

  // Modais de detalhes & impressão
  const [pedidoDetalhe, setPedidoDetalhe] = useState(null)
  const [printPedido, setPrintPedido] = useState(null)
  const [printRomaneio, setPrintRomaneio] = useState(null)
  const [etiquetasReservaModal, setEtiquetasReservaModal] = useState({
    open: false,
    etiquetas: [],
    autoPrint: false,
    titulo: '',
    subtitulo: ''
  })

  const aplicarPresetData = (preset) => {
    setPresetData(preset)
    setSemPrevisao(false)
    setCampoData('PREVISAO')
    if (preset === 'HOJE') {
      const h = isoHojeLocal(0)
      setDataInicio(h)
      setDataFim(h)
    } else if (preset === 'AMANHA') {
      const a = isoHojeLocal(1)
      setDataInicio(a)
      setDataFim(a)
    } else if (preset === 'HOJE_AMANHA') {
      setDataInicio(isoHojeLocal(0))
      setDataFim(isoHojeLocal(1))
    } else if (preset === 'PROX_7') {
      setDataInicio(isoHojeLocal(0))
      setDataFim(isoHojeLocal(7))
    } else if (preset === 'SEM_PREVISAO') {
      setSemPrevisao(true)
      setDataInicio('')
      setDataFim('')
    } else {
      setPresetData('TODAS')
      setDataInicio('')
      setDataFim('')
    }
  }

  const limparTodosFiltros = () => {
    setFiltroStatus('TODOS')
    setFiltroBusca('')
    setBuscaAplicada('')
    setFiltroVendedorId('')
    setFiltroFormaPagtoId('')
    setFiltroSetor('TODOS')
    setFiltroPagtoEntrega(false)
    setOrdenarPor('CODIGO_DESC')
    setCampoData('PREVISAO')
    setSemPrevisao(false)
    setPresetData('TODAS')
    setDataInicio('')
    setDataFim('')
  }

  const carregarDados = async (buscaOverride) => {
    setLoading(true)
    const termoBusca = buscaOverride !== undefined ? buscaOverride : buscaAplicada
    try {
      const [painelRes, listaProd, listaCli, listaVend, auxData] = await Promise.all([
        pedidosQueries.listarPedidosPainel({
          status: filtroStatus,
          busca: termoBusca,
          campoData,
          dataInicio: semPrevisao ? null : dataInicio || null,
          dataFim: semPrevisao ? null : dataFim || null,
          semPrevisao,
          vendedorId: filtroVendedorId || null,
          formaPagamentoId: filtroFormaPagtoId || null,
          setor: filtroSetor,
          pagamentoNaEntrega: filtroPagtoEntrega,
          ordenarPor,
        }),
        pedidosQueries.listarSaldosProdutosParaPedido(),
        pedidosQueries.listarClientes(),
        apiAtiva ? cadastrosQueries.listarVendedores().catch(() => []) : Promise.resolve([]),
        apiAtiva ? cadastrosQueries.listarAuxiliares().catch(() => ({ formasPagamento: [], locaisCobranca: [], naturezasOperacao: [], marchantes: [] })) : Promise.resolve({ formasPagamento: [], locaisCobranca: [], naturezasOperacao: [], marchantes: [] }),
      ])
      setPedidos(painelRes.data || [])
      setKpisGeraisApi(painelRes.kpis_gerais || null)
      setTotalGeralApi(Number(painelRes.total_geral ?? (painelRes.data || []).length))
      setProdutos(listaProd)
      setClientes(listaCli)
      setVendedores(listaVend || [])
      setAuxiliares(auxData || { formasPagamento: [], locaisCobranca: [], naturezasOperacao: [], marchantes: [] })
      if (!clienteIdSelecionado && listaCli.length > 0) {
        const pad = listaCli.find((c) => Number(c.is_padrao) === 1) || listaCli[0]
        setClienteIdSelecionado(pad.id)
      }
    } catch (err) {
      toastError('Erro ao carregar pedidos: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setBuscaAplicada(filtroBusca)
    }, 260)
    return () => clearTimeout(timer)
  }, [filtroBusca])

  useEffect(() => {
    if (podeAcessarTela) {
      carregarDados()
    }
  }, [
    podeAcessarTela,
    filtroStatus,
    buscaAplicada,
    campoData,
    dataInicio,
    dataFim,
    semPrevisao,
    filtroVendedorId,
    filtroFormaPagtoId,
    filtroSetor,
    filtroPagtoEntrega,
    ordenarPor,
  ])

  useEffect(() => {
    if (modalBuscaAberto) {
      setTimeout(() => modalBuscaRef.current?.focus(), 60)
    }
  }, [modalBuscaAberto])

  const sugestoesProdutos = useMemo(() => {
    const q = normTxt(descricaoInput)
    if (!q) return ordenarProdutosSaldoPrimeiro(produtos).slice(0, 12)
    return ordenarProdutosSaldoPrimeiro(
      produtos.filter(
        (p) =>
          normTxt(p.descricao).includes(q) ||
          normTxt(p.codigo).includes(q) ||
          normTxt(p.ean).includes(q)
      )
    ).slice(0, 15)
  }, [produtos, descricaoInput])

  const produtosModalFiltrados = useMemo(() => {
    const q = normTxt(modalBuscaTexto)
    return ordenarProdutosSaldoPrimeiro(
      produtos.filter((p) => {
        if (modalSomenteComSaldo && !temSaldoProduto(p)) return false
        if (!q) return true
        return (
          normTxt(p.descricao).includes(q) ||
          normTxt(p.codigo).includes(q) ||
          normTxt(p.ean).includes(q) ||
          normTxt(p.grupo).includes(q)
        )
      })
    )
  }, [produtos, modalBuscaTexto, modalSomenteComSaldo])

  const kpis = useMemo(() => {
    if (kpisGeraisApi) return kpisGeraisApi
    return {
      total: pedidos.length,
      bloqueadosEstoque: pedidos.filter((p) => p.status === 'BLOQUEADO_ESTOQUE').length,
      liberados: pedidos.filter((p) => p.status === 'LIBERADO').length,
      emSeparacao: pedidos.filter((p) => p.status === 'EM_SEPARACAO').length,
      emConferencia: pedidos.filter((p) => ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA'].includes(p.status)).length,
      expedidos: pedidos.filter((p) => p.status === 'EXPEDIDO').length
    }
  }, [kpisGeraisApi, pedidos])

  const resumoFiltrado = useMemo(() => {
    let totalKg = 0
    let totalValor = 0
    for (const p of pedidos) {
      totalKg += Number(p.total_kg_solicitado || 0)
      totalValor += Number(p.valor_total || 0)
    }
    return {
      qtd: pedidos.length,
      totalKg,
      totalValor,
    }
  }, [pedidos])

  const toggleKpiStatus = (statusAlvo) => {
    if (filtroStatus === statusAlvo) {
      setFiltroStatus('TODOS')
    } else {
      setFiltroStatus(statusAlvo)
      aplicarPresetData('TODAS')
    }
  }

  const limparCamposItem = (focarCodigo = false) => {
    setCodigoInput('')
    setDescricaoInput('')
    setProdutoSelecionado(null)
    setMostrarSugestoes(false)
    setIndiceSugestao(-1)
    setUnidadeInput('KG')
    setQtdInput('')
    setPrecoUnitInput('')
    setPesoManualCxInput('')
    setObsItemInput('')
    if (focarCodigo) {
      setTimeout(() => codigoRef.current?.focus(), 40)
    }
  }

  const clientePadrao = useMemo(
    () => clientes.find((c) => Number(c.is_padrao) === 1) || clientes[0] || null,
    [clientes]
  )

  const marchantePadraoDefault = useMemo(() => {
    const lista = auxiliares.marchantes || []
    return lista.find((m) => Number(m.is_padrao) === 1)?.nome || lista[0]?.nome || 'FRIGODIL'
  }, [auxiliares.marchantes])

  const clienteAtivo = useMemo(
    () => clientes.find((c) => String(c.id) === String(clienteIdSelecionado)) || clientePadrao,
    [clientes, clienteIdSelecionado, clientePadrao]
  )

  const aplicarRegrasDoCliente = async (cli, preservarCamposEdit = false) => {
    if (!apiAtiva || !cli) return
    try {
      const [especs, cfopRes] = await Promise.all([
        cadastrosQueries.listarEspecificacoesCliente(cli.id).catch(() => []),
        cadastrosQueries.sugerirCfop({ tipo_movimento: 'SAIDA', finalidade: 'REVENDA', uf_parceiro: cli.uf || 'SP' }).catch(() => null),
      ])
      setEspecificacoesCliente(especs || [])
      setCfopSugerido(cfopRes || null)
      if (!preservarCamposEdit) {
        setVendedorId(cli.vendedor_padrao_id || '')
        setFormaPagamentoId(cli.forma_pagamento_padrao_id || '')
        setLocalCobrancaId(cli.local_cobranca_padrao_id || '')
        setMarchante(cli.marchante_padrao || marchantePadraoDefault)
        setPagamentoNaEntrega(Number(cli.permite_pagamento_entrega ?? 0))
        if (cfopRes?.natureza_id) setNaturezaId(cfopRes.natureza_id)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (apiAtiva && clienteAtivo?.id && !editId && aba === 'FORM') {
      aplicarRegrasDoCliente(clienteAtivo, false)
    }
  }, [clienteAtivo?.id, aba, editId, apiAtiva])

  const resetarFormulario = () => {
    setEditId(null)
    setEditCodigo('')
    setEditStatus(null)
    setAbaForm('ITENS')
    setTitulo('')
    setObservacaoNf('')
    setDescGlobalInput('')
    setClienteIdSelecionado(clientePadrao?.id || null)
    setOrigemWppForcada(false)
    setVendedorId(clientePadrao?.vendedor_padrao_id || '')
    setFormaPagamentoId(clientePadrao?.forma_pagamento_padrao_id || '')
    setLocalCobrancaId(clientePadrao?.local_cobranca_padrao_id || '')
    setNaturezaId('')
    setMarchante(clientePadrao?.marchante_padrao || marchantePadraoDefault)
    setPagamentoNaEntrega(Number(clientePadrao?.permite_pagamento_entrega ?? 0))
    setMostrarTrocaCliente(false)
    setPrevisaoEntrega('')
    setObservacoes('')
    setItensForm([])
    limparCamposItem(false)
  }

  const aplicarProdutoSelecionado = (prod, focarQtd = true) => {
    setProdutoSelecionado(prod)
    setCodigoInput(prod.codigo || '')
    setDescricaoInput(prod.descricao || '')
    setMostrarSugestoes(false)
    setIndiceSugestao(-1)
    setPesoManualCxInput('')
    const espec = especificacoesCliente.find((e) => String(e.produto_id) === String(prod.id))
    const precoSug = espec?.preco_negociado ?? espec?.ultima_venda_preco ?? prod.valor_unitario ?? 0
    setPrecoUnitInput(precoSug > 0 ? String(precoSug) : '')
    if (espec?.especificacao_corte && !obsItemInput) {
      setObsItemInput(espec.especificacao_corte)
    }
    if (focarQtd) {
      setTimeout(() => {
        qtdRef.current?.focus()
        qtdRef.current?.select?.()
      }, 40)
    }
  }

  // Digitação no campo Código: identificação automática por código exato ou EAN
  const handleCodigoChange = (val) => {
    setCodigoInput(val)
    const clean = val.trim().toLowerCase()
    if (!clean) {
      setProdutoSelecionado(null)
      setDescricaoInput('')
      return
    }
    const match = produtos.find(
      (p) =>
        String(p.codigo || '').trim().toLowerCase() === clean ||
        String(p.ean || '').trim().toLowerCase() === clean
    )
    if (match) {
      aplicarProdutoSelecionado(match, false)
    } else if (produtoSelecionado) {
      setProdutoSelecionado(null)
      setDescricaoInput('')
    }
  }

  const handleCodigoKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (produtoSelecionado) {
      qtdRef.current?.focus()
      qtdRef.current?.select?.()
      return
    }
    const clean = codigoInput.trim().toLowerCase()
    if (!clean) {
      descricaoRef.current?.focus()
      return
    }
    const prefixMatches = produtos.filter((p) =>
      String(p.codigo || '').trim().toLowerCase().startsWith(clean)
    )
    if (prefixMatches.length === 1) {
      aplicarProdutoSelecionado(prefixMatches[0], true)
    } else if (prefixMatches.length > 1) {
      setModalBuscaTexto(codigoInput.trim())
      setModalBuscaAberto(true)
    } else {
      toastWarning(`Nenhum produto encontrado com o código "${codigoInput.trim()}".`)
    }
  }

  // Digitação no campo Descrição: abre sugestões abaixo
  const handleDescricaoChange = (val) => {
    setDescricaoInput(val)
    setMostrarSugestoes(true)
    setIndiceSugestao(0)
    if (produtoSelecionado && normTxt(val) !== normTxt(produtoSelecionado.descricao)) {
      setProdutoSelecionado(null)
      setCodigoInput('')
    }
  }

  const handleDescricaoKeyDown = (e) => {
    if (!mostrarSugestoes || sugestoesProdutos.length === 0) {
      if (e.key === 'ArrowDown') {
        setMostrarSugestoes(true)
        setIndiceSugestao(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceSugestao((prev) => Math.min(sugestoesProdutos.length - 1, prev + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceSugestao((prev) => Math.max(0, prev - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = sugestoesProdutos[indiceSugestao >= 0 ? indiceSugestao : 0]
      if (chosen) aplicarProdutoSelecionado(chosen, true)
    } else if (e.key === 'Escape') {
      setMostrarSugestoes(false)
    }
  }

  // Conversão dinâmica KG <-> CX + cálculo de saldo projetado
  const conversaoItem = useMemo(() => {
    if (!produtoSelecionado) return null
    const pesoMedioCadastro = Number(produtoSelecionado.peso_medio_cx || 0)
    const pesoManual = Number(String(pesoManualCxInput).replace(',', '.') || 0)
    const pesoPorCx = pesoMedioCadastro > 0 ? pesoMedioCadastro : pesoManual

    const itemExistente = itensForm.find((i) => String(i.produto_id) === String(produtoSelecionado.id))
    const kgJaNoPedido = Number(String(itemExistente?.qtd_kg_solicitada || 0).replace(',', '.') || 0)
    const kgJaBipadoNoPedido = Number(itemExistente?.kg_separado || 0)
    const cxJaNoPedido = Number(
      String(itemExistente?.qtd_caixas_solicitada || 0).replace(',', '.') ||
        (pesoPorCx > 0 ? kgJaNoPedido / pesoPorCx : 0)
    )
    const cxJaBipadoNoPedido = Number(itemExistente?.caixas_separadas || 0)

    const qtdDigitada = Number(String(qtdInput).replace(',', '.'))
    const qtdValida = Number.isFinite(qtdDigitada) && qtdDigitada > 0 ? qtdDigitada : 0

    const saldoAtualKg = Number(produtoSelecionado.saldo_kg || 0)
    const saldoAtualCx = Number(produtoSelecionado.qtd_caixas ?? produtoSelecionado.saldo_caixas ?? 0)

    const lancamentoKg =
      unidadeInput === 'KG'
        ? qtdValida
        : pesoPorCx > 0
          ? Number((qtdValida * pesoPorCx).toFixed(3))
          : 0

    const lancamentoCx =
      unidadeInput === 'CX'
        ? qtdValida
        : pesoPorCx > 0
          ? Number((qtdValida / pesoPorCx).toFixed(2))
          : 0

    const faltaKgNoPedido = Math.max(0, kgJaNoPedido + lancamentoKg - kgJaBipadoNoPedido)
    const faltaCxNoPedido = Math.max(0, cxJaNoPedido + lancamentoCx - cxJaBipadoNoPedido)
    const projetadoKg = Number((saldoAtualKg - faltaKgNoPedido).toFixed(3))
    const projetadoCx = Number((saldoAtualCx - faltaCxNoPedido).toFixed(2))

    return {
      pesoMedioCadastro,
      pesoPorCx,
      precisaPesoManualCx: unidadeInput === 'CX' && pesoMedioCadastro <= 0,
      saldoAtualKg,
      saldoAtualCx,
      kgJaNoPedido,
      cxJaNoPedido,
      lancamentoKg,
      lancamentoCx,
      projetadoKg,
      projetadoCx
    }
  }, [produtoSelecionado, unidadeInput, qtdInput, pesoManualCxInput, itensForm])

  const handleTrocarUnidade = (novaUnidade) => {
    if (novaUnidade === unidadeInput) return
    const qtdAtual = Number(String(qtdInput).replace(',', '.'))
    const pesoPorCx = conversaoItem?.pesoPorCx || 0

    if (Number.isFinite(qtdAtual) && qtdAtual > 0) {
      if (novaUnidade === 'CX') {
        const emCx = pesoPorCx > 0 ? Math.max(1, Math.round(qtdAtual / pesoPorCx)) : Math.max(1, Math.round(qtdAtual))
        setQtdInput(String(emCx))
      } else if (pesoPorCx > 0) {
        const emKg = Number((qtdAtual * pesoPorCx).toFixed(2))
        setQtdInput(String(emKg))
      }
    }
    setUnidadeInput(novaUnidade)
    setTimeout(() => qtdRef.current?.focus(), 20)
  }

  const abrirNovoPedido = () => {
    resetarFormulario()
    setAba('FORM')
  }

  const abrirEditarPedido = async (pedId) => {
    try {
      const ped = await pedidosQueries.obterPedido(pedId)
      if (!ped) return toastError('Pedido não encontrado.')
      if (['EXPEDIDO', 'CANCELADO'].includes(ped.status)) {
        return toastWarning(`Pedidos no status ${STATUS_BADGE[ped.status]?.label || ped.status} não podem ser editados.`)
      }
      if (ped.tem_nf_autorizada) {
        return toastWarning(
          `Este pedido já possui NF-e/NFC-e autorizada${ped.nf_autorizada_numero ? ` (Nº ${ped.nf_autorizada_numero})` : ''} e não pode mais ser editado.`
        )
      }
      setEditId(ped.id)
      setEditCodigo(ped.codigo)
      setEditStatus(ped.status)
      setTitulo(ped.titulo || '')
      setClienteIdSelecionado(ped.cliente_id || clientePadrao?.id || null)
      setOrigemWppForcada(ped.origem_pedido === 'WHATSAPP')
      setVendedorId(ped.vendedor_id || '')
      setFormaPagamentoId(ped.forma_pagamento_id || '')
      setLocalCobrancaId(ped.local_cobranca_id || '')
      setNaturezaId(ped.natureza_id || '')
      setMarchante(ped.marchante || marchantePadraoDefault)
      setPagamentoNaEntrega(Number(ped.pagamento_na_entrega || 0))
      if (apiAtiva && ped.cliente_id) {
        const cliObj = clientes.find((c) => String(c.id) === String(ped.cliente_id))
        if (cliObj) aplicarRegrasDoCliente(cliObj, true)
      }
      setMostrarTrocaCliente(false)
      setPrevisaoEntrega(ped.previsao_entrega ? String(ped.previsao_entrega).slice(0, 10) : '')
      setObservacoes(ped.observacoes || '')
      setObservacaoNf(ped.observacao_nf || '')
      setAbaForm('ITENS')
      setDescGlobalInput('')
      setItensForm(
        (ped.itens || []).map((it) => {
          const prodCatalogo = produtos.find((p) => String(p.id) === String(it.produto_id))
          const pm = Number(it.peso_medio_cx || prodCatalogo?.peso_medio_cx || prodCatalogo?.peso_padrao_cx || 0)
          return {
            produto_id: it.produto_id,
            produto_codigo: it.produto_codigo,
            produto_descricao: it.produto_descricao,
            codigo_aux: it.codigo_aux || '',
            saldo_kg: Number(it.estoque_disponivel_kg || 0),
            qtd_caixas_estoque: Number(it.estoque_disponivel_caixas || 0),
            peso_medio_cx: pm,
            qtd_kg_solicitada: String(it.qtd_kg_solicitada),
            qtd_caixas_solicitada: it.qtd_caixas_solicitada != null ? String(it.qtd_caixas_solicitada) : '',
            unidade_solicitada: it.unidade_solicitada === 'CX' ? 'CX' : 'KG',
            qtd_solicitada_exibicao: it.qtd_solicitada_exibicao != null ? Number(it.qtd_solicitada_exibicao) : Number(it.qtd_kg_solicitada),
            preco_unitario: it.preco_unitario != null ? String(it.preco_unitario) : '0',
            desconto_pct: it.desconto_pct != null && Number(it.desconto_pct) > 0 ? String(it.desconto_pct) : '',
            desconto_valor: it.desconto_valor != null && Number(it.desconto_valor) > 0 ? String(it.desconto_valor) : '',
            cfop_aplicado: it.cfop_aplicado || '',
            observacao: it.observacao || '',
            alerta_reclamacao: it.alerta_reclamacao || '',
            kg_separado: Number(it.kg_separado || 0),
            caixas_separadas: Number(it.caixas_separadas || 0),
          }
        })
      )
      limparCamposItem(false)
      setAba('FORM')
    } catch (err) {
      toastError('Erro ao carregar pedido para edição: ' + err.message)
    }
  }

  const handleAdicionarItem = () => {
    if (!produtoSelecionado) {
      return toastWarning('Localize e selecione um produto pelo código, descrição ou pela lupa.')
    }
    const qtdNum = Number(String(qtdInput).replace(',', '.'))
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
      return toastWarning('Informe a quantidade do pedido maior que zero.')
    }
    if (unidadeInput === 'CX' && (!Number.isInteger(qtdNum) || qtdNum < 1 || /[.,]/.test(String(qtdInput)))) {
      return toastWarning('Em Caixas (CX), informe sempre um número inteiro (1 ou mais caixas, sem vírgula).')
    }

    const pesoPorCx = conversaoItem?.pesoPorCx || 0
    if (unidadeInput === 'CX' && pesoPorCx <= 0) {
      return toastWarning(
        'Este produto ainda não possui peso médio por caixa no estoque. Informe o kg médio por caixa ou alterne para KG.'
      )
    }

    const kgFinal =
      unidadeInput === 'KG'
        ? Number(qtdNum.toFixed(3))
        : Number((Math.round(qtdNum) * pesoPorCx).toFixed(3))

    const cxFinal =
      unidadeInput === 'CX'
        ? Math.max(1, Math.round(qtdNum))
        : pesoPorCx > 0
          ? Math.max(1, Math.round(kgFinal / pesoPorCx))
          : null

    if (
      (unidadeInput === 'KG' && (conversaoItem?.projetadoKg ?? 0) < 0) ||
      (unidadeInput === 'CX' && (conversaoItem?.projetadoCx ?? 0) < 0)
    ) {
      toastWarning(
        `Item incluído acima do estoque atual: "${produtoSelecionado.descricao}" ficará com saldo projetado negativo após o pedido.`
      )
    }

    const espec = especificacoesCliente.find((e) => String(e.produto_id) === String(produtoSelecionado.id))
    const precoNum = Number(String(precoUnitInput).replace(',', '.') || 0)
    const precoFinal = Number.isFinite(precoNum) && precoNum >= 0 ? precoNum : Number(produtoSelecionado.valor_unitario || 0)

    setItensForm((prev) => {
      const idx = prev.findIndex((i) => String(i.produto_id) === String(produtoSelecionado.id))
      if (idx >= 0) {
        const next = [...prev]
        const novoKg = Number(next[idx].qtd_kg_solicitada || 0) + kgFinal
        const prevCx = next[idx].qtd_caixas_solicitada !== '' ? Math.round(Number(next[idx].qtd_caixas_solicitada)) : 0
        const novoCx =
          cxFinal !== null || next[idx].qtd_caixas_solicitada !== ''
            ? String(Math.max(1, Math.round(prevCx + (cxFinal || 0))))
            : ''
        next[idx] = {
          ...next[idx],
          qtd_kg_solicitada: String(Number(novoKg.toFixed(3))),
          qtd_caixas_solicitada: novoCx,
          unidade_solicitada:
            next[idx].unidade_solicitada === unidadeInput ? unidadeInput : 'KG',
          qtd_solicitada_exibicao:
            next[idx].unidade_solicitada === unidadeInput && unidadeInput === 'CX'
              ? Number(novoCx || 0)
              : Number(novoKg.toFixed(3)),
          preco_unitario: precoFinal > 0 ? String(precoFinal) : next[idx].preco_unitario,
          observacao: obsItemInput.trim() || next[idx].observacao,
        }
        return next
      }
      return [
        ...prev,
        {
          produto_id: produtoSelecionado.id,
          produto_codigo: produtoSelecionado.codigo,
          produto_descricao: produtoSelecionado.descricao,
          codigo_aux: espec?.codigo_aux_cliente || produtoSelecionado.codigo_auxiliar || '',
          saldo_kg: Number(produtoSelecionado.saldo_kg || 0),
          qtd_caixas_estoque: Number(produtoSelecionado.qtd_caixas ?? produtoSelecionado.saldo_caixas ?? 0),
          peso_medio_cx: pesoPorCx,
          qtd_kg_solicitada: String(kgFinal),
          qtd_caixas_solicitada: cxFinal !== null ? String(cxFinal) : '',
          unidade_solicitada: unidadeInput,
          qtd_solicitada_exibicao: qtdNum,
          preco_unitario: String(precoFinal),
          desconto_pct: '',
          desconto_valor: '',
          cfop_aplicado: cfopSugerido?.cfop_completo || '',
          observacao: obsItemInput.trim(),
          alerta_reclamacao: espec?.alerta_reclamacao ? (espec.alerta_descricao || 'Reclamação anterior registrada') : '',
          kg_separado: 0,
          caixas_separadas: 0,
        }
      ]
    })

    limparCamposItem(true)
  }

  const handleSalvarNovoCliente = async (e) => {
    e.preventDefault()
    if (!novoCliForm.razao_social.trim()) {
      return toastWarning('Informe a Razão Social do cliente.')
    }
    try {
      const criado = await pedidosQueries.criarCliente(novoCliForm)
      const listaCli = await pedidosQueries.listarClientes()
      setClientes(listaCli)
      setClienteIdSelecionado(criado.id)
      setModalNovoClienteAberto(false)
      setMostrarTrocaCliente(false)
      setNovoCliForm({
        codigo: '', razao_social: '', nome_fantasia: '', cnpj_cpf: '', inscricao_estadual: '',
        endereco: '', numero: '', bairro: '', cep: '', cidade: '', uf: 'SP', pais: 'BRASIL',
        telefone: '', icms: 'CONTRIBUINTE'
      })
      toastSuccess(`Cliente "${criado.razao_social}" cadastrado e selecionado neste pedido.`)
    } catch (err) {
      toastError('Erro ao cadastrar cliente: ' + err.message)
    }
  }

  const aplicarDescontoGlobal = () => {
    if (itensForm.length === 0) {
      return toastWarning('Adicione ao menos 1 item ao pedido antes de aplicar desconto.')
    }
    const val = Number(String(descGlobalInput).replace(',', '.'))
    if (!Number.isFinite(val) || val < 0) {
      return toastWarning('Informe um valor de desconto válido (0 ou maior).')
    }
    if (descGlobalTipo === 'PCT') {
      if (val > 100) return toastWarning('Desconto percentual não pode ultrapassar 100%.')
      setItensForm((prev) =>
        prev.map((it) => ({
          ...it,
          desconto_pct: val > 0 ? String(Number(val.toFixed(2))) : '',
          desconto_valor: '',
        }))
      )
      toastSuccess(val > 0 ? `Desconto de ${val.toFixed(2)}% aplicado a todos os ${itensForm.length} item(ns).` : 'Descontos zerados.')
      return
    }
    const brutoTotal = itensForm.reduce((s, it) => s + calcularValoresItem(it).bruto, 0)
    if (brutoTotal <= 0) {
      return toastWarning('Informe o preço (R$/kg) dos itens antes de aplicar desconto em R$.')
    }
    const descAlvo = Math.min(brutoTotal, Number(val.toFixed(2)))
    let restante = descAlvo
    const lastValidIdx = itensForm.reduce((acc, it, idx) => (calcularValoresItem(it).bruto > 0 ? idx : acc), -1)
    setItensForm((prev) =>
      prev.map((it, idx) => {
        const { bruto } = calcularValoresItem(it)
        if (bruto <= 0 || descAlvo <= 0) {
          return { ...it, desconto_pct: '', desconto_valor: '' }
        }
        const fatia =
          idx === lastValidIdx
            ? Number(Math.min(bruto, Math.max(0, restante)).toFixed(2))
            : Number(Math.min(bruto, (bruto / brutoTotal) * descAlvo).toFixed(2))
        restante = Number((restante - fatia).toFixed(2))
        return {
          ...it,
          desconto_pct: '',
          desconto_valor: fatia > 0 ? String(fatia) : '',
        }
      })
    )
    toastSuccess(
      descAlvo > 0
        ? `Desconto de R$ ${descAlvo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} rateado proporcionalmente entre os itens.`
        : 'Descontos zerados.'
    )
  }

  const zerarDescontos = () => {
    setDescGlobalInput('')
    setItensForm((prev) => prev.map((it) => ({ ...it, desconto_pct: '', desconto_valor: '' })))
    toastSuccess('Todos os descontos do pedido foram zerados.')
  }

  const handleSalvarPedido = async (liberar, { imprimirApos = false } = {}) => {
    if (itensForm.length === 0) return toastWarning('Adicione pelo menos 1 item ao pedido.')

    for (const i of itensForm) {
      const kgSol = Number(String(i.qtd_kg_solicitada).replace(',', '.'))
      const kgSep = Number(i.kg_separado || 0)
      const cxSep = Number(i.caixas_separadas || 0)
      const cxSol = i.qtd_caixas_solicitada !== '' && i.qtd_caixas_solicitada != null
        ? Number(String(i.qtd_caixas_solicitada).replace(',', '.'))
        : null
      if (!Number.isFinite(kgSol) || kgSol <= 0) {
        return toastWarning(`Informe um peso válido maior que zero para "${i.produto_descricao}".`)
      }
      if (kgSep > 0 && kgSol + 0.001 < kgSep) {
        return toastError(
          `Trava de Separação: "${i.produto_descricao}" já teve ${fmtKg(kgSep)} bipados (${cxSep} cx). Não é possível diminuir o pedido para ${fmtKg(kgSol)} (mínimo: ${fmtKg(kgSep)}).`
        )
      }
      if (cxSep > 0 && cxSol !== null && cxSol < cxSep) {
        return toastError(
          `Trava de Separação: "${i.produto_descricao}" já possui ${cxSep} caixa(s) bipada(s). Não é possível diminuir Caixas Previstas para ${cxSol} cx.`
        )
      }
    }

    const payloadItens = itensForm.map((i) => ({
      produto_id: i.produto_id,
      qtd_kg_solicitada: Number(String(i.qtd_kg_solicitada).replace(',', '.')),
      qtd_caixas_solicitada: i.qtd_caixas_solicitada
        ? Number(String(i.qtd_caixas_solicitada).replace(',', '.'))
        : null,
      unidade_solicitada: i.unidade_solicitada || 'KG',
      qtd_solicitada_exibicao: i.qtd_solicitada_exibicao != null ? Number(i.qtd_solicitada_exibicao) : null,
      preco_unitario: Number(String(i.preco_unitario || 0).replace(',', '.') || 0),
      desconto_pct: Math.max(0, Math.min(100, Number(String(i.desconto_pct || 0).replace(',', '.') || 0))),
      desconto_valor: Math.max(0, Number(String(i.desconto_valor || 0).replace(',', '.') || 0)),
      codigo_aux: i.codigo_aux || '',
      cfop_aplicado: i.cfop_aplicado || cfopSugerido?.cfop_completo || '',
      observacao: i.observacao || '',
      alerta_reclamacao: i.alerta_reclamacao || '',
    }))

    const cliId = clienteAtivo?.id || null
    const cliNome = clienteAtivo?.razao_social || 'BEEF CONTAINER LIMITADA'
    const tituloFinal = titulo.trim() || gerarTituloAutomaticoLocal(cliNome, previsaoEntrega)
    const editEmOperacao = Boolean(
      editId && ['EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA'].includes(editStatus)
    )

    setLoading(true)
    let savedId = editId
    let travaDisparada = false
    try {
      if (editId) {
        const resEdit = await pedidosQueries.atualizarPedido({
          id: editId,
          titulo: tituloFinal,
          cliente_id: cliId,
          cliente: cliNome,
          vendedor_id: vendedorId || null,
          forma_pagamento_id: formaPagamentoId || null,
          local_cobranca_id: localCobrancaId || null,
          natureza_id: naturezaId || null,
          marchante,
          pagamento_na_entrega: pagamentoNaEntrega,
          previsao_entrega: previsaoEntrega || null,
          observacoes,
          observacao_nf: observacaoNf.trim(),
          itens: payloadItens,
          liberar: editEmOperacao ? undefined : liberar
        })
        travaDisparada = Boolean(resEdit?.trava_estoque)
        if (travaDisparada) {
          toastWarning(
            `🔒 Trava (${editCodigo}): ${resEdit?.motivo_trava || 'Saldo insuficiente/comprometido'}. Pedido bloqueado com cadeado!`
          )
        } else if (resEdit?.reaberto_para_separacao) {
          toastSuccess(
            `Pedido ${editCodigo} atualizado e reaberto para separação dos itens incluídos/alterados!`
          )
        } else if (editEmOperacao) {
          toastSuccess(`Pedido ${editCodigo} atualizado com sucesso!`)
        } else {
          toastSuccess(
            liberar
              ? `Pedido ${editCodigo} atualizado e liberado para Separação!`
              : `Rascunho do pedido ${editCodigo} atualizado.`
          )
        }
      } else {
        const res = await pedidosQueries.criarPedido({
          titulo: tituloFinal,
          cliente_id: cliId,
          cliente: cliNome,
          vendedor_id: vendedorId || null,
          forma_pagamento_id: formaPagamentoId || null,
          local_cobranca_id: localCobrancaId || null,
          natureza_id: naturezaId || null,
          marchante: marchante || marchantePadraoDefault,
          pagamento_na_entrega: pagamentoNaEntrega,
          previsao_entrega: previsaoEntrega || null,
          observacoes,
          observacao_nf: observacaoNf.trim(),
          origem_pedido: origemWppForcada ? 'WHATSAPP' : somenteFinanceiro ? 'FINANCEIRO' : undefined,
          setor_solicitante: operador?.setor || undefined,
          itens: payloadItens,
          operador,
          liberar: somenteFinanceiro ? false : liberar,
        })
        savedId = res.id
        travaDisparada = Boolean(res?.trava_estoque)
        if (travaDisparada) {
          toastWarning(
            `🔒 Trava (${res.codigo}): ${res?.motivo_trava || 'Saldo insuficiente ou reservado em outro pedido'}. Cadeado enviado para Central de Pendências!`
          )
        } else {
          toastSuccess(
            somenteFinanceiro
              ? `Pedido ${res.codigo} enviado pelo Financeiro para a fila do Supply Chain!`
              : liberar
                ? `Pedido ${res.codigo} criado e enviado para Saída de Materiais!`
                : `Pedido ${res.codigo} salvo como rascunho.`
          )
        }
      }
      const prevSalva = previsaoEntrega || ''
      const foraDoFiltroData =
        semPrevisao ||
        (campoData === 'PREVISAO' &&
          ((dataInicio && (!prevSalva || prevSalva < dataInicio)) ||
            (dataFim && (!prevSalva || prevSalva > dataFim))))
      resetarFormulario()
      setAba('GERENCIADOR')
      if (foraDoFiltroData) {
        aplicarPresetData('TODAS')
      } else {
        await carregarDados()
      }
      if (imprimirApos && savedId && !travaDisparada) {
        await handleImprimirFolhaPedido(savedId)
      }
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClonarPedido = async (ped) => {
    try {
      const res = await pedidosQueries.clonarPedido(ped.id, { liberar: false })
      toastSuccess(`Pedido ${res.codigo} clonado!`, `Cópia criada em rascunho pronta para editar/liberar.`)
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleGerarOpPedido = async (ped) => {
    try {
      const preview = await pedidosQueries.gerarOpAutomatica(ped.id, { preview_only: true })
      navigate('/producao', { state: { abrirNovaOpPrefill: preview } })
    } catch (err) {
      toastWarning(err.message)
    }
  }

  const handleAplicarTextoWhatsapp = async () => {
    if (!whatsappTextoInput.trim()) return toastWarning('Cole a mensagem do WhatsApp para analisar.')
    setParseandoWpp(true)
    try {
      const parsed = await whatsappQueries.parsePreview({ mensagem_bruta: whatsappTextoInput })
      if (parsed.cliente_sugerido_id) {
        setClienteIdSelecionado(parsed.cliente_sugerido_id)
      }
      if (parsed.forma_pagamento_sugerida_id) {
        setFormaPagamentoId(parsed.forma_pagamento_sugerida_id)
      }
      if (!titulo.trim()) {
        setTitulo(`Pedido WhatsApp — ${parsed.cliente_texto || 'Cliente'}`)
      }
      setOrigemWppForcada(true)
      if (parsed.observacoes) {
        setObservacoes((prev) => [prev, parsed.observacoes].filter(Boolean).join(' | '))
      }

      const vinculados = (parsed.itens || []).filter((i) => i.produto_id)
      if (vinculados.length === 0) {
        toastWarning('Nenhum produto casou automaticamente; você pode adicionar manualmente.')
      } else {
        setItensForm((prev) => {
          const next = [...prev]
          for (const itemWpp of vinculados) {
            const prod = produtos.find((p) => String(p.id) === String(itemWpp.produto_id))
            const idx = next.findIndex((x) => String(x.produto_id) === String(itemWpp.produto_id))
            if (idx >= 0) {
              const novoKg = Number(next[idx].qtd_kg_solicitada || 0) + Number(itemWpp.qtd_kg_solicitada || 0)
              next[idx] = { ...next[idx], qtd_kg_solicitada: String(Number(novoKg.toFixed(3))) }
            } else {
              next.push({
                produto_id: itemWpp.produto_id,
                produto_codigo: itemWpp.produto_codigo || prod?.codigo || '',
                produto_descricao: itemWpp.produto_descricao || prod?.descricao || '',
                codigo_aux: itemWpp.codigo_aux || '',
                saldo_kg: Number(prod?.saldo_kg || 0),
                qtd_caixas_estoque: Number(prod?.qtd_caixas || 0),
                peso_medio_cx: Number(prod?.peso_medio_cx || 0),
                qtd_kg_solicitada: String(itemWpp.qtd_kg_solicitada || 1),
                qtd_caixas_solicitada: '',
                unidade_solicitada: itemWpp.unidade_solicitada || 'KG',
                qtd_solicitada_exibicao: Number(itemWpp.qtd_kg_solicitada || 1),
                preco_unitario: String(itemWpp.preco_unitario || prod?.valor_unitario || 0),
                cfop_aplicado: cfopSugerido?.cfop_completo || '',
                observacao: itemWpp.observacao || '',
                alerta_reclamacao: itemWpp.alerta_reclamacao || '',
              })
            }
          }
          return next
        })
        toastSuccess(
          `${vinculados.length} item(ns) importado(s) do WhatsApp!`,
          parsed.itens.length > vinculados.length
            ? `${parsed.itens.length - vinculados.length} linha(s) não reconhecida(s) podem ser adicionadas manualmente.`
            : `Confiança do parser: ${parsed.confianca_pct}%`
        )
      }
      setModalWhatsappAberto(false)
      setWhatsappTextoInput('')
      setAba('FORM')
    } catch (err) {
      toastError('Erro ao analisar mensagem: ' + err.message)
    } finally {
      setParseandoWpp(false)
    }
  }

  const handleLiberar = async (ped, { ignorarTrava = false } = {}) => {
    if (ignorarTrava) {
      const ok = await useAppStore.getState().confirmar({
        title: 'Desbloquear Trava de Estoque',
        message: `Desbloquear a trava de estoque do pedido ${ped.codigo} e liberar mesmo assim para a operação (Câmara Fria)?`,
        type: 'error',
        confirmLabel: 'Liberar para Operação',
      })
      if (!ok) return
    }
    try {
      const res = await pedidosQueries.liberarPedido(ped.id, { ignorar_trava_estoque: ignorarTrava })
      if (res?.trava_estoque) {
        toastWarning(`🔒 Trava de Estoque no ${ped.codigo}: saldo insuficiente! Cadeado enviado para Central de Pendências.`)
      } else {
        toastSuccess(`Pedido ${ped.codigo} liberado para separação!`)
      }
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleCancelar = async (ped) => {
    const msg =
      ped.total_caixas_separadas > 0
        ? `O pedido ${ped.codigo} possui ${ped.total_caixas_separadas} caixa(s) já reservadas na separação. Ao cancelar, todas voltarão para DISPONIVEL no estoque. Confirma o cancelamento?`
        : `Deseja cancelar o pedido ${ped.codigo} ("${ped.titulo}")?`
    const ok = await useAppStore.getState().confirmar({
      title: 'Cancelar Pedido',
      message: msg,
      type: 'error',
      confirmLabel: 'Confirmar Cancelamento',
    })
    if (!ok) return

    try {
      await pedidosQueries.cancelarPedido(ped.id, operador)
      toastSuccess(`Pedido ${ped.codigo} cancelado.`)
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleVerDetalhes = async (pedId) => {
    try {
      const det = await pedidosQueries.obterPedido(pedId)
      setPedidoDetalhe(det)
    } catch (err) {
      toastError('Erro ao carregar detalhes: ' + err.message)
    }
  }

  const handleImprimirFolhaPedido = async (pedId) => {
    try {
      const det = await pedidosQueries.obterPedido(pedId)
      setPrintPedido(det)
    } catch (err) {
      toastError('Erro ao preparar impressão: ' + err.message)
    }
  }

  const handleImprimirRomaneioEmbarque = async (ped) => {
    if (!ped.romaneio_id) {
      return toastWarning('Este pedido ainda não possui separação iniciada.')
    }
    if (['RASCUNHO', 'LIBERADO', 'EM_SEPARACAO'].includes(ped.status)) {
      return toastWarning('Finalize a separação na aba Saída de Materiais para emitir o Romaneio de Embarque.')
    }
    try {
      const det = await saidaQueries.detalhesRomaneio(ped.romaneio_id)
      if (!det) return toastError('Romaneio vinculado não encontrado.')
      setPrintRomaneio(det)
    } catch (err) {
      toastError('Erro ao carregar romaneio: ' + err.message)
    }
  }

  const handleImprimirEtiquetasReserva = async (ped, autoPrint = false) => {
    try {
      const res = await saidaQueries.listarEtiquetasReservaRomaneio(ped.romaneio_id || null, { pedido_id: ped.id })
      if (!res.success || !res.etiquetas?.length) {
        return toastWarning(res.error || 'Nenhuma caixa separada encontrada para este pedido.')
      }
      setEtiquetasReservaModal({
        open: true,
        etiquetas: res.etiquetas,
        autoPrint,
        titulo: `Etiquetas RESERVADO (100×70mm) — ${ped.codigo}`,
        subtitulo: `Cliente: ${res.cliente_nome || ped.cliente || '-'} • ${res.etiquetas.length} caixa(s)`
      })
    } catch (err) {
      toastError('Erro ao carregar etiquetas RESERVADO: ' + err.message)
    }
  }

  if (!podeAcessarTela) {
    return (
      <div className="page-container">
        <div className="card" style={{ maxWidth: '580px', margin: '40px auto', textAlign: 'center', padding: '32px' }}>
          <ShieldAlert size={48} className="text-warning" style={{ margin: '0 auto 12px' }} />
          <h2 style={{ marginBottom: '8px' }}>Acesso Restrito</h2>
          <p className="text-muted">
            O lançamento de Pedidos requer permissão de Supply Chain/Pedidos ou Lançamento pelo Financeiro.
            Para separar pedidos liberados, acesse <strong>Saída de Materiais</strong>.
          </p>
        </div>
      </div>
    )
  }

  const totalFormKg = itensForm.reduce((s, i) => s + Number(String(i.qtd_kg_solicitada).replace(',', '.') || 0), 0)
  const totalFormCx = itensForm.reduce((s, i) => s + Number(String(i.qtd_caixas_solicitada).replace(',', '.') || 0), 0)
  const totalFormBruto = Number(itensForm.reduce((s, i) => s + calcularValoresItem(i).bruto, 0).toFixed(2))
  const totalFormDesconto = Number(itensForm.reduce((s, i) => s + calcularValoresItem(i).descontoTotal, 0).toFixed(2))
  const totalFormValor = Math.max(0, Number((totalFormBruto - totalFormDesconto).toFixed(2)))
  const tituloAutomaticoPreview = gerarTituloAutomaticoLocal(
    clienteAtivo?.razao_social || 'BEEF CONTAINER LIMITADA',
    previsaoEntrega
  )

  const itensSemEstoqueForm = useMemo(() => {
    return itensForm.filter((item) => {
      const prodLive = produtos.find((p) => String(p.id) === String(item.produto_id))
      const saldoKg = Number(prodLive?.saldo_kg ?? item.saldo_kg ?? 0)
      const solKg = Number(String(item.qtd_kg_solicitada).replace(',', '.') || 0)
      const jaSepKg = Number(item.kg_separado || 0)
      const restanteKg = Math.max(0, solKg - jaSepKg)
      return restanteKg > saldoKg + 0.001
    })
  }, [itensForm, produtos])

  const parcelasSimuladas = (() => {
    if (!apiAtiva || totalFormValor <= 0) return []
    const fp = (auxiliares.formasPagamento || []).find((f) => String(f.id) === String(formaPagamentoId))
    const dias = Array.isArray(fp?.dias_parcelas) && fp.dias_parcelas.length > 0 ? fp.dias_parcelas : [0]
    const baseStr = previsaoEntrega || new Date().toISOString().slice(0, 10)
    const baseMs = new Date(`${baseStr}T12:00:00Z`).getTime()
    let soma = 0
    return dias.map((d, i) => {
      const isLast = i === dias.length - 1
      const val = isLast ? Number((totalFormValor - soma).toFixed(2)) : Number((totalFormValor / dias.length).toFixed(2))
      soma += val
      const venc = new Date(baseMs + Number(d || 0) * 86400000).toLocaleDateString('pt-BR')
      return { numero: i + 1, dias: Number(d || 0), vencimento: venc, valor: val }
    })
  })()

  return (
    <div className="page-container">
      {/* Cabeçalho */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ClipboardList size={26} /> Pedidos &amp; Programação de Embarque
          </h1>
          <p className="page-subtitle">
            Crie pedidos com os cortes solicitados para liberar automaticamente na Separação (Saída de Materiais) e emitir Folha do Pedido / Romaneio.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {apiAtiva && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setModalWhatsappAberto(true)}
            >
              <MessageSquare size={16} /> Colar WhatsApp
            </button>
          )}
          <button
            type="button"
            className={`btn ${aba === 'GERENCIADOR' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setAba('GERENCIADOR')}
          >
            <ClipboardList size={16} /> Gerenciador de Pedidos
          </button>
          <button
            type="button"
            className={`btn ${aba === 'FORM' ? 'btn--primary' : 'btn--success'}`}
            onClick={abrirNovoPedido}
          >
            <Plus size={16} /> {somenteFinanceiro ? 'Solicitar Pedido (Financeiro)' : 'Novo Pedido'}
          </button>
        </div>
      </div>

      {aba === 'GERENCIADOR' && (
        <>
          {/* KPIs clicáveis (sempre globais) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <button
              type="button"
              className="card"
              onClick={() => toggleKpiStatus('BLOQUEADO_ESTOQUE')}
              style={{
                padding: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: filtroStatus === 'BLOQUEADO_ESTOQUE' ? '#ef4444' : kpis.bloqueadosEstoque > 0 ? 'var(--danger)' : undefined,
                boxShadow: filtroStatus === 'BLOQUEADO_ESTOQUE' ? '0 0 0 2px rgba(239,68,68,0.35)' : undefined,
              }}
            >
              <div className="text-muted text-xs flex items-center gap-6">
                <Lock size={12} className="text-danger" /> Trava Estoque (Cadeado)
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#ef4444' }}>{kpis.bloqueadosEstoque}</div>
            </button>
            <button
              type="button"
              className="card"
              onClick={() => toggleKpiStatus('LIBERADO')}
              style={{
                padding: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: filtroStatus === 'LIBERADO' ? '#38bdf8' : undefined,
                boxShadow: filtroStatus === 'LIBERADO' ? '0 0 0 2px rgba(56,189,248,0.35)' : undefined,
              }}
            >
              <div className="text-muted text-xs">Liberados p/ Separação</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#38bdf8' }}>{kpis.liberados}</div>
            </button>
            <button
              type="button"
              className="card"
              onClick={() => toggleKpiStatus('EM_SEPARACAO')}
              style={{
                padding: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: filtroStatus === 'EM_SEPARACAO' ? '#f59e0b' : undefined,
                boxShadow: filtroStatus === 'EM_SEPARACAO' ? '0 0 0 2px rgba(245,158,11,0.35)' : undefined,
              }}
            >
              <div className="text-muted text-xs">Em Separação na Câmara</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#f59e0b' }}>{kpis.emSeparacao}</div>
            </button>
            <button
              type="button"
              className="card"
              onClick={() => toggleKpiStatus('PRONTOS_CONFERENCIA')}
              style={{
                padding: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: filtroStatus === 'PRONTOS_CONFERENCIA' ? '#a78bfa' : undefined,
                boxShadow: filtroStatus === 'PRONTOS_CONFERENCIA' ? '0 0 0 2px rgba(167,139,250,0.35)' : undefined,
              }}
            >
              <div className="text-muted text-xs">Prontos / Em Conferência</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#a78bfa' }}>{kpis.emConferencia}</div>
            </button>
            <button
              type="button"
              className="card"
              onClick={() => toggleKpiStatus('EXPEDIDO')}
              style={{
                padding: '14px',
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: filtroStatus === 'EXPEDIDO' ? '#22c55e' : undefined,
                boxShadow: filtroStatus === 'EXPEDIDO' ? '0 0 0 2px rgba(34,197,94,0.35)' : undefined,
              }}
            >
              <div className="text-muted text-xs">Pedidos Expedidos</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#22c55e' }}>{kpis.expedidos}</div>
            </button>
          </div>

          {/* Filtros Avançados & Ordenação */}
          <div className="card" style={{ marginBottom: '16px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Linha 1: Busca + Status + Vendedor + Setor + Pagamento + Ações */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setBuscaAplicada(filtroBusca)
                carregarDados(filtroBusca)
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}
            >
              <div style={{ flex: '1 1 240px' }}>
                <label className="form-label">Buscar por Cliente, Nº Pedido, Título ou Vendedor</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-input"
                    placeholder="PED-0001, BEEF CONTAINER, Título..."
                    value={filtroBusca}
                    onChange={(e) => setFiltroBusca(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ flex: '0 1 185px' }}>
                <label className="form-label">Status</label>
                <select className="form-input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                  <option value="TODOS">Todos os Status</option>
                  <option value="RASCUNHO">Rascunho</option>
                  <option value="BLOQUEADO_COMERCIAL">🔒 Trava Comercial / Margem</option>
                  <option value="BLOQUEADO_ESTOQUE">🔒 Trava Estoque</option>
                  <option value="LIBERADO">Liberado p/ Separação</option>
                  <option value="EM_SEPARACAO">Em Separação</option>
                  <option value="AGUARDANDO_CONFERENCIA">Separação Finalizada</option>
                  <option value="EM_CONFERENCIA">Em Conferência</option>
                  <option value="PRONTOS_CONFERENCIA">Prontos + Em Conferência</option>
                  <option value="EXPEDIDO">Expedido</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>
              {apiAtiva && (
                <>
                  <div style={{ flex: '0 1 220px', minWidth: 185 }}>
                    <label className="form-label">Vendedor</label>
                    <SmartSearchSelect
                      items={vendedores}
                      value={filtroVendedorId}
                      onChange={(val) => setFiltroVendedorId(val)}
                      icon="user"
                      getCode={(v) => String(v?.sigla || v?.codigo || '')}
                      getLabel={(v) => String(v?.nome || '')}
                      emptyLabel="Todos os Vendedores"
                      placeholder="Filtrar vendedor..."
                      modalTitle="Selecionar Vendedor"
                    />
                  </div>
                  <div style={{ flex: '0 1 150px' }}>
                    <label className="form-label">Setor / Origem</label>
                    <select className="form-input" value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)}>
                      <option value="TODOS">Todos</option>
                      <option value="FATURAMENTO">Faturamento</option>
                      <option value="SUPPLY_CHAIN">Supply Chain</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="FINANCEIRO">Financeiro</option>
                      <option value="VENDEDOR">Vendedor</option>
                    </select>
                  </div>
                  <div style={{ flex: '0 1 170px' }}>
                    <label className="form-label">Forma Pagamento</label>
                    <select className="form-input" value={filtroFormaPagtoId} onChange={(e) => setFiltroFormaPagtoId(e.target.value)}>
                      <option value="">Todas</option>
                      {(auxiliares.formasPagamento || []).map((fp) => (
                        <option key={fp.id} value={fp.id}>
                          {fp.descricao}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <button type="submit" className="btn btn--primary" disabled={loading}>
                <Search size={15} /> Filtrar
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => carregarDados()} disabled={loading}>
                <RefreshCw size={15} /> Atualizar
              </button>
            </form>

            {/* Linha 2: Previsão de Entrega (Chips + Intervalo) */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'center',
                padding: '10px 12px',
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
              }}
            >
              <span className="text-xs font-bold flex items-center gap-6" style={{ color: '#93c5fd', letterSpacing: '0.03em' }}>
                <Calendar size={14} /> PREVISÃO DE ENTREGA:
              </span>
              {[
                { key: 'HOJE_AMANHA', label: 'Hoje + Amanhã' },
                { key: 'HOJE', label: 'Hoje' },
                { key: 'AMANHA', label: 'Amanhã' },
                { key: 'PROX_7', label: 'Próx. 7 Dias' },
                { key: 'TODAS', label: 'Todas' },
                { key: 'SEM_PREVISAO', label: 'Sem Previsão' },
              ].map((chip) => {
                const ativo = presetData === chip.key
                return (
                  <button
                    key={chip.key}
                    type="button"
                    className={`btn btn--sm ${ativo ? 'btn--primary' : 'btn--secondary'}`}
                    onClick={() => aplicarPresetData(chip.key)}
                  >
                    {chip.label}
                  </button>
                )
              })}

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                <select
                  className="form-input"
                  style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
                  value={campoData}
                  onChange={(e) => {
                    setSemPrevisao(false)
                    setPresetData('CUSTOM')
                    setCampoData(e.target.value)
                  }}
                  title="Definir qual data será usada no intervalo De / Até"
                >
                  <option value="PREVISAO">Data: Previsão Entrega</option>
                  <option value="CRIACAO">Data: Emissão / Pedido</option>
                </select>
                <span className="text-muted text-xs">De:</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
                  value={dataInicio}
                  onChange={(e) => {
                    setSemPrevisao(false)
                    setPresetData('CUSTOM')
                    setDataInicio(e.target.value)
                  }}
                />
                <span className="text-muted text-xs">Até:</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', padding: '5px 8px', fontSize: '12px' }}
                  value={dataFim}
                  onChange={(e) => {
                    setSemPrevisao(false)
                    setPresetData('CUSTOM')
                    setDataFim(e.target.value)
                  }}
                />
                <label className="text-xs flex items-center gap-4 cursor-pointer" style={{ marginLeft: '4px', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={filtroPagtoEntrega}
                    onChange={(e) => setFiltroPagtoEntrega(e.target.checked)}
                  />
                  Pagto na Entrega
                </label>
                <button type="button" className="btn btn--secondary btn--sm" onClick={limparTodosFiltros}>
                  <RotateCcw size={13} /> Limpar Filtros
                </button>
              </div>
            </div>

            {/* Linha 3: Ordenar Por (estilo referência) */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'center',
                padding: '10px 12px',
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
              }}
            >
              <span className="text-xs font-bold flex items-center gap-6" style={{ color: '#cbd5e1', letterSpacing: '0.03em' }}>
                <ArrowUpDown size={14} /> ORDENAR POR:
              </span>
              {[
                { key: 'CODIGO_DESC', label: 'Nº Pedido (Maior → Menor)' },
                { key: 'CODIGO_ASC', label: 'Nº Pedido (Menor → Maior)' },
                { key: 'PESO_DESC', label: '⚖️ Maior Peso (kg)' },
                { key: 'PESO_ASC', label: '⚖️ Menor Peso (kg)' },
                { key: 'VALOR_DESC', label: '💰 Maior Valor (R$)' },
                { key: 'VALOR_ASC', label: '💰 Menor Valor (R$)' },
                { key: 'PREVISAO_ASC', label: '📅 Entrega Mais Próxima' },
                { key: 'STATUS_PADRAO', label: '⚡ Padrão (Status)' },
              ].map((ord) => {
                const ativo = ordenarPor === ord.key
                return (
                  <button
                    key={ord.key}
                    type="button"
                    className={`btn btn--sm ${ativo ? 'btn--primary' : 'btn--secondary'}`}
                    onClick={() => setOrdenarPor(ord.key)}
                  >
                    {ord.label}
                  </button>
                )
              })}
            </div>

            {/* Resumo dos resultados filtrados */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '12px' }}>
              <div className="text-muted">
                Exibindo <strong style={{ color: '#f8fafc' }}>{resumoFiltrado.qtd}</strong> pedido(s)
                {totalGeralApi > resumoFiltrado.qtd && (
                  <span> de <strong style={{ color: '#f8fafc' }}>{totalGeralApi}</strong> no total</span>
                )}
                {' • '}
                Peso Total: <strong style={{ color: '#38bdf8' }}>{fmtKg(resumoFiltrado.totalKg)}</strong>
                {' • '}
                Valor Total: <strong style={{ color: '#4ade80' }}>
                  R$ {resumoFiltrado.totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </div>
              {(presetData !== 'TODAS' || filtroStatus !== 'TODOS' || filtroBusca || filtroVendedorId || filtroFormaPagtoId || filtroSetor !== 'TODOS' || filtroPagtoEntrega) &&
                totalGeralApi > resumoFiltrado.qtd && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={limparTodosFiltros}
                  >
                    Mostrar todos os {totalGeralApi} pedidos
                  </button>
                )}
            </div>
          </div>

          {/* Lista */}
          <div className="card">
            {pedidos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }} className="text-muted">
                <Package size={40} style={{ opacity: 0.4, margin: '0 auto 10px' }} />
                <div>Nenhum pedido encontrado para os filtros atuais.</div>
                {totalGeralApi > 0 && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    style={{ marginTop: '12px' }}
                    onClick={limparTodosFiltros}
                  >
                    Limpar filtros e exibir todos os {totalGeralApi} pedidos
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Título (Romaneio) / Cliente</th>
                      <th>Status</th>
                      <th>Romaneio</th>
                      <th style={{ textAlign: 'right' }}>Pedido</th>
                      <th style={{ textAlign: 'right' }}>Separado</th>
                      <th>Conferência</th>
                      <th>Previsão</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((ped) => {
                      const st = STATUS_BADGE[ped.status] || { label: ped.status, cls: 'badge--neutral' }
                      const pct =
                        Number(ped.total_kg_solicitado) > 0
                          ? Math.min(100, Math.round((Number(ped.total_kg_separado) / Number(ped.total_kg_solicitado)) * 100))
                          : 0
                      const podeImprimirRomaneio =
                        Boolean(ped.romaneio_id) &&
                        ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(ped.status)

                      return (
                        <tr key={ped.id}>
                          <td className="font-mono font-bold">
                            <div>{ped.codigo}</div>
                            {ped.origem_pedido && (
                              <span
                                className={`badge ${(ORIGEM_BADGE[ped.origem_pedido] || { cls: 'badge--ghost' }).cls}`}
                                style={{ fontSize: 10, marginTop: 4 }}
                              >
                                {(ORIGEM_BADGE[ped.origem_pedido] || { label: ped.origem_pedido }).label}
                              </span>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{ped.titulo}</div>
                            <div className="text-muted text-xs">
                              {ped.cliente || 'BEEF CONTAINER LIMITADA'} • Criado em {fmtDataHora(ped.created_at)} por <strong>{ped.criado_por_nome || '-'}</strong>{ped.setor_solicitante ? ` (${ped.setor_solicitante})` : ''}
                              {Number(ped.valor_total || 0) > 0 && (
                                <strong style={{ color: '#4ade80', marginLeft: 8 }}>
                                  R$ {Number(ped.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </strong>
                              )}
                              {ped.margem_bruta_pct != null && (
                                <span
                                  className={`badge ${
                                    Number(ped.margem_bruta_pct) < 0
                                      ? 'badge--danger'
                                      : Number(ped.margem_bruta_pct) < 12
                                        ? 'badge--warning'
                                        : 'badge--success'
                                  }`}
                                  style={{ fontSize: 10, marginLeft: 6 }}
                                >
                                  Mg {Number(ped.margem_bruta_pct).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                            {(ped.status === 'BLOQUEADO_ESTOQUE' || ped.status === 'BLOQUEADO_COMERCIAL') && (
                              <div
                                style={{
                                  marginTop: 5,
                                  fontSize: 11,
                                  lineHeight: 1.3,
                                  color: ped.status === 'BLOQUEADO_COMERCIAL' ? '#fde68a' : '#fca5a5',
                                  background:
                                    ped.status === 'BLOQUEADO_COMERCIAL'
                                      ? 'rgba(245, 158, 11, 0.14)'
                                      : 'rgba(239, 68, 68, 0.12)',
                                  border:
                                    ped.status === 'BLOQUEADO_COMERCIAL'
                                      ? '1px solid rgba(245, 158, 11, 0.4)'
                                      : '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: 6,
                                  padding: '4px 7px',
                                  maxWidth: 260,
                                }}
                                title={ped.motivo_trava || 'Pedido retido por trava automática'}
                              >
                                <strong>Motivo:</strong>{' '}
                                {ped.motivo_trava ||
                                  (ped.status === 'BLOQUEADO_COMERCIAL'
                                    ? 'Aguardando aprovação gerencial (Margem/Desconto/Crédito)'
                                    : 'Estoque insuficiente ou comprometido por outro pedido em aberto')}
                              </div>
                            )}
                          </td>
                          <td className="font-mono">
                            {ped.romaneio_codigo ? (
                              <span style={{ fontWeight: 700 }}>{ped.romaneio_codigo}</span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {fmtKg(ped.total_kg_solicitado)}
                            <div className="text-muted text-xs">{ped.qtd_itens} produto(s)</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700 }}>
                              {fmtKg(ped.total_kg_separado)} ({ped.total_caixas_separadas} cx)
                            </div>
                            <div style={{ width: '100px', height: '5px', background: '#1e293b', borderRadius: '999px', marginLeft: 'auto', marginTop: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#38bdf8' }} />
                            </div>
                          </td>
                          <td>
                            {ped.total_caixas_separadas > 0 ? (
                              <span className="text-xs font-mono">
                                {Number(ped.qtd_conferidas || 0)}/{ped.total_caixas_separadas} cx
                              </span>
                            ) : (
                              <span className="text-muted text-xs">-</span>
                            )}
                          </td>
                          <td>{fmtData(ped.previsao_entrega)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                title="Ver detalhes do pedido"
                                onClick={() => handleVerDetalhes(ped.id)}
                              >
                                <Eye size={14} /> Detalhes
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                title="Imprimir Folha do Pedido"
                                onClick={() => handleImprimirFolhaPedido(ped.id)}
                              >
                                <Printer size={14} /> Folha Pedido
                              </button>
                              {(podeImprimirRomaneio || Number(ped.total_caixas_separadas || 0) > 0) && ped.status !== 'CANCELADO' && (
                                <button
                                  type="button"
                                  className="btn btn--warning btn--sm"
                                  title="Imprimir Etiquetas RESERVADO (100x70mm)"
                                  onClick={() => handleImprimirEtiquetasReserva(ped, false)}
                                >
                                  <Tag size={14} /> Etiquetas
                                </button>
                              )}
                              {podeImprimirRomaneio && (
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  title="Imprimir Romaneio de Embarque"
                                  onClick={() => handleImprimirRomaneioEmbarque(ped)}
                                >
                                  <Truck size={14} /> Romaneio
                                </button>
                              )}
                              {ped.status === 'RASCUNHO' && podeGerenciarPedidos && (
                                <button
                                  type="button"
                                  className="btn btn--success btn--sm"
                                  title="Liberar para Separação"
                                  onClick={() => handleLiberar(ped, { ignorarTrava: false })}
                                >
                                  <Send size={14} /> Liberar
                                </button>
                              )}
                              {ped.status === 'BLOQUEADO_COMERCIAL' && (
                                <button
                                  type="button"
                                  className="btn btn--warning btn--sm"
                                  title="Abrir Mesa de Aprovação Comercial"
                                  onClick={() => navigate('/forca-vendas')}
                                >
                                  <Unlock size={14} /> Aprovar Margem
                                </button>
                              )}
                              {ped.status === 'BLOQUEADO_ESTOQUE' && podeGerenciarPedidos && (
                                <button
                                  type="button"
                                  className="btn btn--danger btn--sm"
                                  title="Desbloquear trava de estoque e liberar pedido para os operadores"
                                  onClick={() => handleLiberar(ped, { ignorarTrava: true })}
                                >
                                  <Unlock size={14} /> Liberar Cadeado
                                </button>
                              )}
                              {apiAtiva && podeGerenciarPedidos && !['EXPEDIDO', 'CANCELADO'].includes(ped.status) && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  title="Abrir Ordem de Produção automática para cortes sem estoque"
                                  onClick={() => handleGerarOpPedido(ped)}
                                >
                                  <Zap size={14} /> Abrir OP
                                </button>
                              )}
                              {apiAtiva && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  title="Clonar Pedido"
                                  onClick={() => handleClonarPedido(ped)}
                                >
                                  <Copy size={14} /> Clonar
                                </button>
                              )}
                              {!['EXPEDIDO', 'CANCELADO'].includes(ped.status) && !ped.tem_nf_autorizada && podeGerenciarPedidos && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  title="Editar Pedido (incluir itens ou ajustar pesos respeitando trava de bipagem)"
                                  onClick={() => abrirEditarPedido(ped.id)}
                                >
                                  <Edit3 size={14} /> Editar
                                </button>
                              )}
                              {!['EXPEDIDO', 'CANCELADO'].includes(ped.status) && ped.tem_nf_autorizada && (
                                <span
                                  className="badge badge--success"
                                  style={{ fontSize: 11, padding: '4px 8px' }}
                                  title="Pedido já faturado com NF-e autorizada — edição bloqueada"
                                >
                                  <Lock size={11} /> NF-e Emitida
                                </span>
                              )}
                              {!['EXPEDIDO', 'CANCELADO'].includes(ped.status) && podeGerenciarPedidos && (
                                <button
                                  type="button"
                                  className="btn btn--danger btn--sm"
                                  title="Cancelar Pedido"
                                  onClick={() => handleCancelar(ped)}
                                >
                                  <Trash2 size={14} />
                                </button>
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
        </>
      )}

      {aba === 'FORM' && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>{editId ? `Editando Pedido ${editCodigo}` : 'Novo Pedido de Saída'}</span>
                {editId && editStatus && STATUS_BADGE[editStatus] && (
                  <span className={`badge ${STATUS_BADGE[editStatus].cls}`} style={{ fontSize: 12 }}>
                    {STATUS_BADGE[editStatus].label}
                  </span>
                )}
              </h2>
              <p className="text-muted text-xs" style={{ marginTop: '4px' }}>
                Localize os produtos pelo código, pela descrição com autocomplete ou pela lupa, escolha KG ou CX e acompanhe o saldo projetado na hora.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                resetarFormulario()
                setAba('GERENCIADOR')
              }}
            >
              Voltar ao Gerenciador
            </button>
          </div>

          {editId && ['EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA'].includes(editStatus) && (
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#bfdbfe',
                fontSize: 12.5,
              }}
            >
              <Lock size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
              <div>
                <strong>Edição em andamento ({STATUS_BADGE[editStatus]?.label || editStatus}):</strong> você pode incluir novos itens, aumentar pesos ou alterar itens ainda não bipados.
                Itens que já tiveram caixas bipadas possuem <strong>trava mínima pelo peso/caixas já separados</strong> e não podem ser removidos sem estornar as caixas na Separação.
              </div>
            </div>
          )}

          {/* Abas internas do formulário do Pedido */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <button
              type="button"
              className={`btn btn--sm ${abaForm === 'ITENS' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setAbaForm('ITENS')}
            >
              <Package size={15} /> 1. Dados &amp; Itens do Pedido ({itensForm.length})
            </button>
            <button
              type="button"
              className={`btn btn--sm ${abaForm === 'NF_DESCONTOS' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setAbaForm('NF_DESCONTOS')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FileText size={15} /> 2. Especificações da NF &amp; Descontos
              {totalFormDesconto > 0 && (
                <span className="badge badge--success font-mono" style={{ fontSize: 10.5, padding: '1px 6px' }}>
                  -R$ {totalFormDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              )}
              {observacaoNf.trim() && (
                <span className="badge badge--info" style={{ fontSize: 10.5, padding: '1px 6px' }}>
                  Obs. NF
                </span>
              )}
            </button>
          </div>

          {abaForm === 'ITENS' && (
            <>
          {/* Cartão automático do Cliente Padrão (BEEF CONTAINER LIMITADA) + opção futura de troca/cadastro */}
          <div
            style={{
              background: 'rgba(13, 20, 36, 0.72)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                  Cliente Destinatário (Pré-selecionado automaticamente)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge badge--info font-mono">Cód. {clienteAtivo?.codigo || '737'}</span>
                  <strong style={{ fontSize: '15px', color: '#f8fafc' }}>
                    {clienteAtivo?.razao_social || 'BEEF CONTAINER LIMITADA'}
                  </strong>
                  {Number(clienteAtivo?.is_padrao) === 1 && (
                    <span className="badge badge--success">Cliente Padrão</span>
                  )}
                  {Number(clienteAtivo?.bloqueado_financeiro) === 1 && (
                    <span className="badge badge--danger">⚠️ Bloqueio Financeiro</span>
                  )}
                  {Number(clienteAtivo?.qtd_alertas || 0) > 0 && (
                    <span className="badge badge--warning">⚠️ {clienteAtivo.qtd_alertas} Alerta(s) de Reclamação</span>
                  )}
                </div>
                <div className="text-xs text-muted" style={{ marginTop: '4px', lineHeight: 1.5 }}>
                  CNPJ: <span className="font-mono">{clienteAtivo?.cnpj_cpf || '54.142.043/0001-30'}</span>
                  {' • '}IE: <span className="font-mono">{clienteAtivo?.inscricao_estadual || '513236396113'}</span>
                  {' • '}ICMS: {clienteAtivo?.icms || 'CONTRIBUINTE'}
                  <br />
                  Endereço: {clienteAtivo?.endereco || 'DOUTOR HEITOR NASCIMENTO DE 3/4 A 598/599'}
                  {clienteAtivo?.numero ? `, Nº ${clienteAtivo.numero}` : ', Nº 581'}
                  {clienteAtivo?.bairro ? ` • ${clienteAtivo.bairro}` : ' • MORUMBI'}
                  {' • '}
                  {clienteAtivo?.cidade || 'PAULINIA'}/{clienteAtivo?.uf || 'SP'}
                  {' • '}CEP: <span className="font-mono">{clienteAtivo?.cep || '13140-729'}</span>
                  {clienteAtivo?.telefone ? ` • Fone: ${clienteAtivo.telefone}` : ' • Fone: (19)99199-231'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setMostrarTrocaCliente((v) => !v)}
                >
                  {mostrarTrocaCliente ? 'Fechar Seleção' : 'Alterar / Cadastrar Cliente'}
                </button>
              </div>
            </div>

            {mostrarTrocaCliente && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 320px' }}>
                  <label className="form-label">Selecionar Cliente Cadastrado</label>
                  <ClienteSearchSelect
                    clientes={clientes}
                    value={clienteIdSelecionado ? String(clienteIdSelecionado) : ''}
                    onChange={(val) => {
                      if (!val) return
                      setClienteIdSelecionado(/^\d+$/.test(val) ? Number(val) : val)
                    }}
                    allowClear={false}
                    placeholder="Pesquisar cliente (razão social, fantasia, código, CNPJ, cidade)..."
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setModalNovoClienteAberto(true)}
                >
                  <Plus size={14} /> Novo Cliente
                </button>
              </div>
            )}
          </div>

          {/* Dados principais */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Título do Pedido (opcional — gera automático se vazio)</label>
              <input
                className="form-input"
                placeholder={`Automático: ${tituloAutomaticoPreview}`}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
              {!titulo.trim() && (
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Se deixar em branco, será gerado automaticamente: <strong className="font-mono" style={{ color: '#93c5fd' }}>{tituloAutomaticoPreview}</strong>
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Previsão de Coleta / Entrega</label>
              <input
                type="date"
                className="form-input"
                value={previsaoEntrega}
                onChange={(e) => setPrevisaoEntrega(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="form-label">Observações do Pedido</label>
            <input
              className="form-input"
              placeholder="Instruções especiais de separação, horário de coleta, etc."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>

          {/* Condições Comerciais & Cobrança (Auto do Cliente no Modo API/PostgreSQL) */}
          {apiAtiva && (
            <div
              style={{
                background: 'rgba(13, 20, 36, 0.72)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '16px',
              }}
            >
              <div className="text-xs font-bold uppercase text-primary mb-10" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <span>Dados Comerciais, Cobrança &amp; Natureza / CFOP (Puxados do Cliente)</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge badge--neutral" style={{ textTransform: 'none' }}>
                    Emitente: {operador?.nome || 'Sistema'}{operador?.setor ? ` (${operador.setor})` : ''}
                  </span>
                  {cfopSugerido && (
                    <span className="badge badge--info font-mono">
                      CFOP Automático: {cfopSugerido.cfop} {cfopSugerido.codigo_sub_operacao} ({cfopSugerido.dentro_estado ? 'Dentro UF' : 'Fora UF'})
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '10px' }}>
                <div>
                  <label className="form-label">Vendedor (Comissão)</label>
                  <SmartSearchSelect
                    items={vendedores}
                    value={vendedorId}
                    onChange={(val) => setVendedorId(val)}
                    icon="user"
                    getCode={(v) => String(v?.sigla || v?.codigo || '')}
                    getLabel={(v) => String(v?.nome || '')}
                    emptyLabel="-- Nenhum --"
                    placeholder="Pesquisar vendedor..."
                    modalTitle="Selecionar Vendedor"
                  />
                </div>
                <div>
                  <label className="form-label">Forma de Pagamento</label>
                  <select className="form-input" value={formaPagamentoId} onChange={(e) => setFormaPagamentoId(e.target.value)}>
                    <option value="">-- À definir --</option>
                    {(auxiliares.formasPagamento || []).map((fp) => (
                      <option key={fp.id} value={fp.id}>{fp.descricao}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Local Cobrança / Banco</label>
                  <select className="form-input" value={localCobrancaId} onChange={(e) => setLocalCobrancaId(e.target.value)}>
                    <option value="">-- Padrão --</option>
                    {(auxiliares.locaisCobranca || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Natureza Operação</label>
                  <select className="form-input" value={naturezaId} onChange={(e) => setNaturezaId(e.target.value)}>
                    <option value="">-- Automática --</option>
                    {(auxiliares.naturezasOperacao || []).map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.cfop_estadual}/{n.cfop_interestadual} - {n.descricao}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Marchante</label>
                  <select className="form-input" value={marchante || marchantePadraoDefault} onChange={(e) => setMarchante(e.target.value)}>
                    {(auxiliares.marchantes || []).length === 0 ? (
                      <option value="FRIGODIL">001 — FRIGODIL</option>
                    ) : (
                      <>
                        {(auxiliares.marchantes || []).map((m) => (
                          <option key={m.id} value={m.nome}>
                            {m.codigo} — {m.nome}
                          </option>
                        ))}
                        {marchante &&
                          !(auxiliares.marchantes || []).some((m) => m.nome === marchante) && (
                            <option value={marchante}>{marchante}</option>
                          )}
                      </>
                    )}
                  </select>
                </div>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12.5px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Number(pagamentoNaEntrega) === 1}
                  onChange={(e) => setPagamentoNaEntrega(e.target.checked ? 1 : 0)}
                />
                Pagamento na Entrega (motorista só conclui após confirmar PIX/cartão/dinheiro)
              </label>
            </div>
          )}

          {/* ── Novo Seletor Dinâmico de Produtos (Código + Autocomplete + Lupa + KG/CX) ── */}
          <div
            style={{
              background: 'rgba(13, 20, 36, 0.9)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={17} className="text-info" />
                Lançar Item do Cadastro de Produtos
              </div>
              <span className="text-xs text-muted">
                Digite o <strong>Código</strong>, pesquise na <strong>Descrição</strong> ou clique na <strong>Lupa</strong>
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: apiAtiva
                  ? '130px minmax(220px, 1.8fr) 195px 115px minmax(120px, 1fr) auto'
                  : '145px minmax(260px, 1.8fr) 205px minmax(140px, 1fr) auto',
                gap: '10px',
                alignItems: 'end'
              }}
            >
              {/* 1. Campo Código */}
              <div>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Código</span>
                  {produtoSelecionado && (
                    <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '11px' }}>✓ OK</span>
                  )}
                </label>
                <input
                  ref={codigoRef}
                  className="form-input font-mono"
                  placeholder="Ex: 5897"
                  value={codigoInput}
                  onChange={(e) => handleCodigoChange(e.target.value)}
                  onKeyDown={handleCodigoKeyDown}
                />
              </div>

              {/* 2. Campo Descrição com Autocomplete + 3. Botão Lupa */}
              <div style={{ position: 'relative' }}>
                <label className="form-label">Descrição do Produto *</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      ref={descricaoRef}
                      className="form-input"
                      placeholder="Comece a digitar o nome do produto..."
                      value={descricaoInput}
                      onFocus={() => setMostrarSugestoes(true)}
                      onBlur={() => setTimeout(() => setMostrarSugestoes(false), 160)}
                      onChange={(e) => handleDescricaoChange(e.target.value)}
                      onKeyDown={handleDescricaoKeyDown}
                      style={{
                        paddingRight: descricaoInput ? '30px' : undefined,
                        borderColor: produtoSelecionado ? 'var(--success)' : undefined
                      }}
                    />
                    {descricaoInput && (
                      <button
                        type="button"
                        title="Limpar seleção"
                        onClick={() => limparCamposItem(false)}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '2px'
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn--secondary btn--icon"
                    title="Pesquisar produto na tabela completa (Lupa)"
                    onClick={() => {
                      setModalBuscaTexto(descricaoInput || codigoInput || '')
                      setModalBuscaAberto(true)
                    }}
                    style={{ height: '40px', width: '42px', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Search size={17} />
                  </button>
                </div>

                {/* Lista de Sugestões de Autocomplete */}
                {mostrarSugestoes && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: '48px',
                      zIndex: 80,
                      background: '#0f172a',
                      border: '1px solid var(--accent)',
                      borderRadius: '10px',
                      boxShadow: '0 16px 36px rgba(0,0,0,0.75)',
                      maxHeight: '290px',
                      overflowY: 'auto'
                    }}
                  >
                    {sugestoesProdutos.length === 0 ? (
                      <div style={{ padding: '12px 14px', fontSize: '12.5px', color: '#94a3b8' }}>
                        Nenhum produto encontrado para "{descricaoInput}". Use a lupa para explorar o cadastro.
                      </div>
                    ) : (
                      sugestoesProdutos.map((p, idx) => {
                        const ativo = idx === indiceSugestao
                        const temSaldo = Number(p.saldo_kg || 0) > 0
                        return (
                          <div
                            key={p.id}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              aplicarProdutoSelecionado(p, true)
                            }}
                            onMouseEnter={() => setIndiceSugestao(idx)}
                            style={{
                              padding: '9px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '10px',
                              borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
                              background: ativo ? 'rgba(59, 130, 246, 0.22)' : 'transparent'
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: '#38bdf8',
                                    background: 'rgba(56, 189, 248, 0.14)',
                                    padding: '1px 6px',
                                    borderRadius: '4px'
                                  }}
                                >
                                  {p.codigo || 'S/C'}
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {p.descricao}
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, fontSize: '11.5px', fontFamily: 'var(--font-mono)' }}>
                              <span style={{ color: temSaldo ? '#4ade80' : '#94a3b8', fontWeight: 700 }}>
                                {fmtKg(p.saldo_kg)}
                              </span>
                              <span style={{ color: '#94a3b8', marginLeft: '6px' }}>({p.qtd_caixas} cx)</span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              {/* 4. Quantidade + Seletor KG / CX */}
              <div>
                <label className="form-label">Quantidade ({unidadeInput}) *</label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                  <input
                    ref={qtdRef}
                    type="number"
                    step={unidadeInput === 'KG' ? '0.01' : '1'}
                    min={unidadeInput === 'KG' ? '0.01' : '1'}
                    className="form-input font-mono"
                    placeholder={unidadeInput === 'KG' ? 'Ex: 40' : 'Ex: 2'}
                    value={qtdInput}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (unidadeInput === 'CX') {
                        const digits = raw.replace(/\D/g, '')
                        setQtdInput(digits ? String(Math.max(1, parseInt(digits, 10))) : '')
                      } else {
                        setQtdInput(raw)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (unidadeInput === 'CX' && ['.', ',', 'e', 'E', '-', '+'].includes(e.key)) {
                        e.preventDefault()
                        return
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAdicionarItem()
                      }
                    }}
                    style={{ flex: 1, minWidth: '80px', fontWeight: 700 }}
                  />
                  <div
                    style={{
                      display: 'inline-flex',
                      background: 'var(--bg-1)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '2px',
                      gap: '2px'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleTrocarUnidade('KG')}
                      style={{
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0 10px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: unidadeInput === 'KG' ? 'var(--accent)' : 'transparent',
                        color: unidadeInput === 'KG' ? '#ffffff' : 'var(--text-secondary)'
                      }}
                    >
                      KG
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTrocarUnidade('CX')}
                      style={{
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0 10px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: unidadeInput === 'CX' ? 'var(--accent)' : 'transparent',
                        color: unidadeInput === 'CX' ? '#ffffff' : 'var(--text-secondary)'
                      }}
                    >
                      CX
                    </button>
                  </div>
                </div>
              </div>

              {/* 4B. Preço Unitário (Modo API/Comercial) */}
              {apiAtiva && (
                <div>
                  <label className="form-label">Preço R$/kg</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input font-mono text-right"
                    placeholder="0,00"
                    value={precoUnitInput}
                    onChange={(e) => setPrecoUnitInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAdicionarItem()
                      }
                    }}
                  />
                </div>
              )}

              {/* 5. Observação do item */}
              <div>
                <label className="form-label">Obs. do Item</label>
                <input
                  className="form-input"
                  placeholder="Opcional"
                  value={obsItemInput}
                  onChange={(e) => setObsItemInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAdicionarItem()
                    }
                  }}
                />
              </div>

              <button type="button" className="btn btn--primary" style={{ height: '40px' }} onClick={handleAdicionarItem}>
                <Plus size={16} /> Adicionar
              </button>
            </div>

            {/* Painel Dinâmico de Estoque Atual, Conversão KG<->CX e Saldo Projetado */}
            {produtoSelecionado && conversaoItem && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: '#0d1526',
                  border:
                    (unidadeInput === 'KG' ? conversaoItem.projetadoKg : conversaoItem.projetadoCx) < 0
                      ? '1px solid #f59e0b'
                      : '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
                  <div>
                    <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Produto Selecionado
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: '#f8fafc' }}>
                      {produtoSelecionado.codigo ? `[${produtoSelecionado.codigo}] ` : ''}
                      {produtoSelecionado.descricao}
                    </div>
                    <div className="text-xs" style={{ color: '#94a3b8', marginTop: '2px' }}>
                      Cadastro: <strong>{produtoSelecionado.unidade || 'CX'}</strong>
                      {conversaoItem.pesoMedioCadastro > 0 ? (
                        <>
                          {' '}• Peso médio/cx: <strong>{conversaoItem.pesoMedioCadastro.toFixed(2)} kg/cx</strong>
                        </>
                      ) : (
                        <> • Sem peso médio histórico de caixa</>
                      )}
                    </div>
                  </div>

                  {/* Estoque Atual na Unidade Selecionada */}
                  <div style={{ paddingLeft: '14px', borderLeft: '1px solid var(--border)' }}>
                    <div className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {unidadeInput === 'KG' ? <Scale size={12} /> : <Box size={12} />}
                      ESTOQUE ATUAL ({unidadeInput})
                    </div>
                    <div className="font-mono" style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>
                      {unidadeInput === 'KG' ? fmtKg(conversaoItem.saldoAtualKg) : fmtCx(conversaoItem.saldoAtualCx)}
                    </div>
                    <div className="text-xs text-muted font-mono">
                      {unidadeInput === 'KG'
                        ? `Equiv.: ${fmtCx(conversaoItem.saldoAtualCx)}`
                        : `Equiv.: ${fmtKg(conversaoItem.saldoAtualKg)}`}
                    </div>
                  </div>

                  {/* Este Lançamento + Equivalente */}
                  <div style={{ paddingLeft: '14px', borderLeft: '1px solid var(--border)' }}>
                    <div className="text-xs text-muted">SOLICITADO NESTE ITEM</div>
                    <div className="font-mono" style={{ fontSize: '18px', fontWeight: 800, color: '#e2e8f0' }}>
                      {unidadeInput === 'KG' ? fmtKg(conversaoItem.lancamentoKg) : fmtCx(conversaoItem.lancamentoCx)}
                    </div>
                    <div className="text-xs text-muted font-mono">
                      {conversaoItem.pesoPorCx > 0
                        ? unidadeInput === 'KG'
                          ? `≈ ${fmtCx(conversaoItem.lancamentoCx)}`
                          : `≈ ${fmtKg(conversaoItem.lancamentoKg)}`
                        : 'Conversão p/ cx indisponível'}
                    </div>
                  </div>

                  {/* Saldo Projetado Após Pedido na Unidade Selecionada */}
                  <div style={{ paddingLeft: '14px', borderLeft: '1px solid var(--border)' }}>
                    <div className="text-xs text-muted">PROJETADO APÓS PEDIDO ({unidadeInput})</div>
                    {(() => {
                      const valProj = unidadeInput === 'KG' ? conversaoItem.projetadoKg : conversaoItem.projetadoCx
                      const negativo = valProj < 0
                      return (
                        <>
                          <div
                            className="font-mono"
                            style={{
                              fontSize: '18px',
                              fontWeight: 800,
                              color: negativo ? '#fbbf24' : '#4ade80'
                            }}
                          >
                            {unidadeInput === 'KG' ? fmtKg(conversaoItem.projetadoKg) : fmtCx(conversaoItem.projetadoCx)}
                          </div>
                          <div className="text-xs font-mono" style={{ color: negativo ? '#fcd34d' : '#94a3b8' }}>
                            {unidadeInput === 'KG'
                              ? conversaoItem.pesoPorCx > 0
                                ? `≈ ${fmtCx(conversaoItem.projetadoCx)}`
                                : ''
                              : `≈ ${fmtKg(conversaoItem.projetadoKg)}`}
                            {conversaoItem.kgJaNoPedido > 0 && ` (inclui ${fmtKg(conversaoItem.kgJaNoPedido)} já no pedido)`}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* Fallback manual caso o usuário selecione CX para produto que nunca teve caixa pesada */}
                {conversaoItem.precisaPesoManualCx && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: '#2c1f09',
                      border: '1px solid #f59e0b',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      color: '#fde68a'
                    }}
                  >
                    <AlertTriangle size={16} />
                    <span className="text-xs">Sem histórico de peso/cx. Informe kg por caixa:</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="form-input font-mono"
                      placeholder="Ex: 20"
                      value={pesoManualCxInput}
                      onChange={(e) => setPesoManualCxInput(e.target.value)}
                      style={{ width: '90px', height: '32px', padding: '4px 8px' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Lista de itens */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <strong>Itens do Pedido ({itensForm.length})</strong>
              <span className="font-mono font-bold">
                Total Solicitado: {fmtKg(totalFormKg)} {totalFormCx > 0 ? `• ~${fmtCx(totalFormCx)}` : ''}
                {apiAtiva && totalFormDesconto > 0 && (
                  <span style={{ color: '#fbbf24', marginLeft: 10 }}>
                    • Desc.: -R$ {totalFormDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
                {apiAtiva && (totalFormValor > 0 || totalFormBruto > 0) && (
                  <span style={{ color: '#4ade80', marginLeft: 10 }}>
                    • Líq.: R$ {totalFormValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </span>
            </div>

            {itensForm.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '20px', textAlign: 'center', border: '1px dashed rgba(148, 163, 184, 0.3)', borderRadius: '6px' }}>
                Nenhum item adicionado ainda. Use os campos acima (Código, Descrição ou Lupa) para incluir os produtos solicitados.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Estoque Atual</th>
                      <th style={{ width: '130px' }}>Kg Solicitado *</th>
                      <th style={{ width: '100px' }}>Cx Previstas</th>
                      {apiAtiva && <th style={{ width: '115px', textAlign: 'right' }}>R$/kg</th>}
                      {apiAtiva && <th style={{ textAlign: 'right' }}>Subtotal</th>}
                      <th style={{ textAlign: 'right' }}>Saldo Projetado</th>
                      <th>Obs. / Alertas</th>
                      <th style={{ textAlign: 'right' }}>Remover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensForm.map((item, idx) => {
                      const kgNum = Number(String(item.qtd_kg_solicitada).replace(',', '.') || 0)
                      const cxNum = Number(String(item.qtd_caixas_solicitada).replace(',', '.') || 0)
                      const kgBipado = Number(item.kg_separado || 0)
                      const cxBipadas = Number(item.caixas_separadas || 0)
                      const itemTemBipagem = kgBipado > 0 || cxBipadas > 0
                      const kgAbaixoBipado = kgBipado > 0 && kgNum + 0.001 < kgBipado
                      const cxAbaixoBipado = cxBipadas > 0 && item.qtd_caixas_solicitada !== '' && cxNum < cxBipadas
                      const calcItem = calcularValoresItem(item)
                      const subtotalItem = calcItem.liquido
                      const descTotalItem = calcItem.descontoTotal
                      const restanteKg = Math.max(0, kgNum - kgBipado)
                      const restanteCx = Math.max(0, cxNum - cxBipadas)
                      const projKg = Number((Number(item.saldo_kg || 0) - restanteKg).toFixed(2))
                      const projCx = Number((Number(item.qtd_caixas_estoque || 0) - restanteCx).toFixed(2))
                      const abaixoEstoque = projKg < 0
                      return (
                        <tr key={item.produto_id}>
                          <td className="font-mono">
                            <div>{item.produto_codigo || '-'}</div>
                            {item.codigo_aux && <div className="text-xs text-muted">Aux: {item.codigo_aux}</div>}
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{item.produto_descricao}</div>
                            {itemTemBipagem && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  marginTop: '4px',
                                  marginRight: '6px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: kgAbaixoBipado || cxAbaixoBipado ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.16)',
                                  border: kgAbaixoBipado || cxAbaixoBipado ? '1px solid #ef4444' : '1px solid rgba(96, 165, 250, 0.45)',
                                  color: kgAbaixoBipado || cxAbaixoBipado ? '#fca5a5' : '#93c5fd',
                                  fontSize: '11px',
                                  fontWeight: 700
                                }}
                              >
                                <Lock size={11} /> Bipado: {fmtKg(kgBipado)} ({cxBipadas} cx) — mín. {fmtKg(kgBipado)}
                              </div>
                            )}
                            {item.alerta_reclamacao && (
                              <div className="badge badge--warning" style={{ fontSize: 10.5, marginTop: 4 }}>
                                ⚠️ {item.alerta_reclamacao}
                              </div>
                            )}
                            {abaixoEstoque && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  marginTop: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: '#2c1f09',
                                  border: '1px solid #f59e0b',
                                  color: '#fde68a',
                                  fontSize: '11px',
                                  fontWeight: 600
                                }}
                              >
                                <AlertTriangle size={12} /> Sem estoque p/ atender ({fmtKg(Math.abs(projKg))} p/ OP)
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            <div>{fmtKg(item.saldo_kg)}</div>
                            <div className="text-xs text-muted">{fmtCx(item.qtd_caixas_estoque)}</div>
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min={kgBipado > 0 ? kgBipado : 0.01}
                              className="form-input font-mono"
                              style={kgAbaixoBipado ? { borderColor: '#ef4444', boxShadow: '0 0 0 1px #ef4444' } : undefined}
                              title={kgBipado > 0 ? `Mínimo permitido: ${fmtKg(kgBipado)} já bipados` : undefined}
                              value={item.qtd_kg_solicitada}
                              onChange={(e) => {
                                const v = e.target.value
                                const kg = Number(String(v).replace(',', '.') || 0)
                                setItensForm((prev) =>
                                  prev.map((r, i) => {
                                    if (i !== idx) return r
                                    const pm = Number(r.peso_medio_cx || 0)
                                    const minCx = Math.max(1, Number(r.caixas_separadas || 0))
                                    return {
                                      ...r,
                                      qtd_kg_solicitada: v,
                                      unidade_solicitada: 'KG',
                                      qtd_solicitada_exibicao: kg > 0 ? kg : r.qtd_solicitada_exibicao,
                                      qtd_caixas_solicitada: pm > 0 && kg > 0 ? String(Math.max(minCx, Math.round(kg / pm))) : r.qtd_caixas_solicitada
                                    }
                                  })
                                )
                              }}
                            />
                            {kgAbaixoBipado && (
                              <div style={{ color: '#f87171', fontSize: 10.5, fontWeight: 700, marginTop: 3 }}>
                                Mín. {fmtKg(kgBipado)} bipados
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              step="1"
                              min={Math.max(1, cxBipadas)}
                              className="form-input font-mono"
                              style={cxAbaixoBipado ? { borderColor: '#ef4444', boxShadow: '0 0 0 1px #ef4444' } : undefined}
                              placeholder="1"
                              title={
                                cxBipadas > 0
                                  ? `Mínimo permitido: ${cxBipadas} caixa(s) já bipada(s)`
                                  : 'Somente números inteiros (1 ou mais caixas, sem vírgula)'
                              }
                              value={item.qtd_caixas_solicitada}
                              onKeyDown={(e) => {
                                if (['.', ',', 'e', 'E', '-', '+'].includes(e.key)) {
                                  e.preventDefault()
                                }
                              }}
                              onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '')
                                const cx = digits ? Math.max(1, parseInt(digits, 10)) : 0
                                const v = cx > 0 ? String(cx) : ''
                                setItensForm((prev) =>
                                  prev.map((r, i) => {
                                    if (i !== idx) return r
                                    const pm = Number(r.peso_medio_cx || 0)
                                    return {
                                      ...r,
                                      qtd_caixas_solicitada: v,
                                      unidade_solicitada: cx > 0 ? 'CX' : r.unidade_solicitada,
                                      qtd_solicitada_exibicao: cx > 0 ? cx : r.qtd_solicitada_exibicao,
                                      qtd_kg_solicitada:
                                        pm > 0 && cx > 0 ? String(Number((cx * pm).toFixed(3))) : r.qtd_kg_solicitada,
                                    }
                                  })
                                )
                              }}
                            />
                            {cxAbaixoBipado && (
                              <div style={{ color: '#f87171', fontSize: 10.5, fontWeight: 700, marginTop: 3 }}>
                                Mín. {cxBipadas} cx bipadas
                              </div>
                            )}
                          </td>
                          {apiAtiva && (
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="form-input font-mono text-right"
                                value={item.preco_unitario || ''}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, preco_unitario: v } : r)))
                                }}
                              />
                            </td>
                          )}
                          {apiAtiva && (
                            <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">
                              <div>R$ {subtotalItem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              {descTotalItem > 0 && (
                                <div className="text-xs" style={{ color: '#fbbf24', fontWeight: 600 }}>
                                  (-R$ {descTotalItem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                                </div>
                              )}
                            </td>
                          )}
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            <div style={{ fontWeight: 700, color: projKg < 0 ? '#fbbf24' : '#4ade80' }}>
                              {fmtKg(projKg)}
                            </div>
                            <div className="text-xs" style={{ color: projCx < 0 ? '#fcd34d' : '#94a3b8' }}>
                              {item.qtd_caixas_solicitada ? fmtCx(projCx) : '-'}
                            </div>
                          </td>
                          <td>
                            <input
                              className="form-input"
                              value={item.observacao}
                              onChange={(e) => {
                                const v = e.target.value
                                setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, observacao: v } : r)))
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {itemTemBipagem ? (
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                style={{ opacity: 0.7, cursor: 'not-allowed' }}
                                title={`Item já possui ${fmtKg(kgBipado)} (${cxBipadas} cx) bipados e não pode ser removido`}
                                onClick={() =>
                                  toastError(
                                    `Trava de Separação: "${item.produto_descricao}" já possui ${fmtKg(kgBipado)} (${cxBipadas} cx) bipados e não pode ser removido. Estorne as caixas na Separação primeiro.`
                                  )
                                }
                              >
                                <Lock size={14} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                title="Remover item do pedido"
                                onClick={() => setItensForm((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
            </>
          )}

          {/* ═══ ABA 2: ESPECIFICAÇÕES DA NF & DESCONTOS ═══ */}
          {abaForm === 'NF_DESCONTOS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
              {/* Bloco 1: Desconto Global e por Item */}
              <div
                style={{
                  background: 'rgba(13, 20, 36, 0.72)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                  <div>
                    <div className="text-xs font-bold uppercase text-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Percent size={14} /> Descontos Comerciais do Pedido (Reflete na NF-e, Boleto e Parcelas)
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: 3 }}>
                      Aplique um desconto global (% ou R$) distribuído automaticamente nos itens ou ajuste individualmente na tabela abaixo.
                    </div>
                  </div>
                  {totalFormDesconto > 0 && (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={zerarDescontos}>
                      <RotateCcw size={13} /> Zerar Descontos
                    </button>
                  )}
                </div>

                {/* Desconto Global */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    alignItems: 'flex-end',
                    padding: '12px',
                    borderRadius: 8,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <label className="form-label">Tipo de Desconto Global</label>
                    <div style={{ display: 'inline-flex', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: 2, gap: 2 }}>
                      <button
                        type="button"
                        onClick={() => setDescGlobalTipo('PCT')}
                        style={{
                          border: 'none',
                          borderRadius: 6,
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                          background: descGlobalTipo === 'PCT' ? 'var(--accent)' : 'transparent',
                          color: descGlobalTipo === 'PCT' ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        % Percentual
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescGlobalTipo('VALOR')}
                        style={{
                          border: 'none',
                          borderRadius: 6,
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                          background: descGlobalTipo === 'VALOR' ? 'var(--accent)' : 'transparent',
                          color: descGlobalTipo === 'VALOR' ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        R$ Valor Fixo
                      </button>
                    </div>
                  </div>
                  <div style={{ width: 160 }}>
                    <label className="form-label">
                      {descGlobalTipo === 'PCT' ? 'Desconto (%)' : 'Desconto Total (R$)'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={descGlobalTipo === 'PCT' ? '100' : undefined}
                      className="form-input font-mono text-right"
                      placeholder={descGlobalTipo === 'PCT' ? 'Ex: 5,00' : 'Ex: 150,00'}
                      value={descGlobalInput}
                      onChange={(e) => setDescGlobalInput(e.target.value)}
                    />
                  </div>
                  <button type="button" className="btn btn--primary" style={{ height: 38 }} onClick={aplicarDescontoGlobal}>
                    <Percent size={14} /> Aplicar nos Itens
                  </button>

                  {/* Resumo Bruto / Desconto / Líquido */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="text-xs text-muted">Total Bruto</div>
                      <div className="font-mono font-bold" style={{ fontSize: 14 }}>
                        R$ {totalFormBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="text-xs text-muted">(-) Descontos</div>
                      <div className="font-mono font-bold" style={{ fontSize: 14, color: '#fbbf24' }}>
                        -R$ {totalFormDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
                      <div className="text-xs text-muted">(=) Total Líquido NF</div>
                      <div className="font-mono font-bold" style={{ fontSize: 17, color: '#4ade80' }}>
                        R$ {totalFormValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tabela de Desconto por Item */}
                {itensForm.length === 0 ? (
                  <div className="text-muted text-sm" style={{ padding: 18, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8 }}>
                    Adicione produtos na aba <strong>1. Dados &amp; Itens do Pedido</strong> para configurar descontos por item.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>Produto</th>
                          <th style={{ textAlign: 'right' }}>Peso</th>
                          <th style={{ textAlign: 'right' }}>R$/kg</th>
                          <th style={{ textAlign: 'right' }}>Bruto</th>
                          <th style={{ width: 110, textAlign: 'right' }}>Desc. (%)</th>
                          <th style={{ width: 125, textAlign: 'right' }}>Desc. (R$)</th>
                          <th style={{ textAlign: 'right' }}>Total Desc.</th>
                          <th style={{ textAlign: 'right' }}>Líquido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itensForm.map((item, idx) => {
                          const c = calcularValoresItem(item)
                          return (
                            <tr key={item.produto_id}>
                              <td className="font-mono">{item.produto_codigo || '-'}</td>
                              <td style={{ fontWeight: 700 }}>{item.produto_descricao}</td>
                              <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(c.kg)}</td>
                              <td style={{ textAlign: 'right' }} className="font-mono">
                                R$ {c.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-mono">
                                R$ {c.bruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  className="form-input font-mono text-right"
                                  placeholder="0,00"
                                  value={item.desconto_pct ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, desconto_pct: v } : r)))
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="form-input font-mono text-right"
                                  placeholder="0,00"
                                  value={item.desconto_valor ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, desconto_valor: v } : r)))
                                  }}
                                />
                              </td>
                              <td style={{ textAlign: 'right', color: c.descontoTotal > 0 ? '#fbbf24' : 'var(--text-muted)' }} className="font-mono font-bold">
                                {c.descontoTotal > 0
                                  ? `-R$ ${c.descontoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : 'R$ 0,00'}
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">
                                R$ {c.liquido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Bloco 2: Observação / Informações Complementares da NF-e */}
              <div
                style={{
                  background: 'rgba(13, 20, 36, 0.72)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '16px',
                }}
              >
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#93c5fd', fontWeight: 700 }}>
                  <FileText size={14} /> Observações da Nota Fiscal (Informações Complementares da DANFE / XML)
                </label>
                <p className="text-xs text-muted" style={{ marginTop: 2, marginBottom: 8 }}>
                  Este texto será impresso automaticamente no quadro <strong>Dados Adicionais / Informações Complementares</strong> da NF-e (DANFE) e gravado na tag <code>&lt;infCpl&gt;</code> do XML. Use para número de pedido de compra do cliente, janela de entrega, isenções ou avisos fiscais.
                </p>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="Ex: Pedido de compra do cliente nº 12345 • Entregar na porta fundos das 06h às 11h • Mercadoria refrigerada 0ºC a 4ºC."
                  value={observacaoNf}
                  onChange={(e) => setObservacaoNf(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 92 }}
                />
              </div>
            </div>
          )}

          {/* Simulação de Parcelas */}
          {apiAtiva && parcelasSimuladas.length > 0 && (
            <div
              style={{
                background: 'rgba(13, 20, 36, 0.72)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '12px 14px',
                marginBottom: '18px',
              }}
            >
              <div className="text-xs font-bold uppercase text-primary mb-8" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Simulação de Parcelas</span>
                <span className="font-mono" style={{ color: '#4ade80' }}>
                  Total do Pedido: R$ {totalFormValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {parcelasSimuladas.map((p) => (
                  <div
                    key={p.numero}
                    style={{
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '12px',
                    }}
                    className="font-mono"
                  >
                    <strong>Parcela {p.numero}</strong> ({p.dias}d • {p.vencimento}):{' '}
                    <span style={{ color: '#4ade80', fontWeight: 700 }}>
                      R$ {p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {apiAtiva && itensSemEstoqueForm.length > 0 && !somenteFinanceiro && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#fca5a5',
                fontSize: 12.5,
              }}
            >
              <Lock size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
              <div>
                <strong>Trava de Estoque ativa ao liberar:</strong> {itensSemEstoqueForm.length} item(ns) acima do saldo disponível em câmara.
                Ao clicar em <strong>Liberar Pedido para Separação</strong>, o pedido ficará bloqueado com cadeado na <strong>Central de Pendências</strong> antes de aparecer para os operadores.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
            {somenteFinanceiro ? (
              <button type="button" className="btn btn--warning" disabled={loading} onClick={() => handleSalvarPedido(false)}>
                <DollarSign size={16} /> Enviar Solicitação p/ Fila Supply Chain
              </button>
            ) : editId && ['EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA'].includes(editStatus) ? (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={loading}
                  onClick={() => {
                    resetarFormulario()
                    setAba('GERENCIADOR')
                  }}
                >
                  Cancelar
                </button>
                <button type="button" className="btn btn--success" disabled={loading} onClick={() => handleSalvarPedido(undefined)}>
                  <Save size={16} /> Salvar Alterações do Pedido
                </button>
                <button type="button" className="btn btn--primary" disabled={loading} onClick={() => handleSalvarPedido(undefined, { imprimirApos: true })}>
                  <Printer size={16} /> Salvar &amp; Imprimir Folha Atualizada
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => handleSalvarPedido(false)}>
                  Salvar como Rascunho
                </button>
                <button type="button" className="btn btn--success" disabled={loading} onClick={() => handleSalvarPedido(true)}>
                  <Send size={16} /> Liberar Pedido para Separação
                </button>
                <button type="button" className="btn btn--primary" disabled={loading} onClick={() => handleSalvarPedido(true, { imprimirApos: true })}>
                  <Printer size={16} /> Liberar &amp; Imprimir Folha
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════ MODAL LUPA: TABELA DE PRODUTOS ══════════════════ */}
      {modalBuscaAberto && (
        <div
          className="modal-overlay"
          style={{ padding: '16px' }}
          onClick={() => setModalBuscaAberto(false)}
        >
          <div
            className="card"
            style={{ width: '960px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={19} className="text-info" /> Pesquisar Produto no Cadastro
                </h2>
                <div className="text-muted text-xs" style={{ marginTop: '2px' }}>
                  Clique em qualquer linha para selecionar o produto automaticamente.
                </div>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalBuscaAberto(false)}>
                <X size={15} /> Fechar
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px' }}>
                <input
                  ref={modalBuscaRef}
                  className="form-input"
                  placeholder="Filtrar por código, EAN, descrição ou grupo..."
                  value={modalBuscaTexto}
                  onChange={(e) => setModalBuscaTexto(e.target.value)}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={modalSomenteComSaldo}
                  onChange={(e) => setModalSomenteComSaldo(e.target.checked)}
                />
                Somente com saldo disponível (&gt; 0)
              </label>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: '8px' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '110px' }}>Código</th>
                    <th>Descrição</th>
                    <th style={{ width: '75px' }}>Unid.</th>
                    <th style={{ textAlign: 'right', width: '120px' }}>Estoque (KG)</th>
                    <th style={{ textAlign: 'right', width: '95px' }}>Estoque (CX)</th>
                    <th style={{ textAlign: 'right', width: '110px' }}>Média kg/cx</th>
                    <th style={{ textAlign: 'right', width: '110px' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosModalFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '28px' }} className="text-muted">
                        Nenhum produto encontrado para o filtro informado.
                      </td>
                    </tr>
                  ) : (
                    produtosModalFiltrados.map((p) => (
                      <tr
                        key={p.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          aplicarProdutoSelecionado(p, true)
                          setModalBuscaAberto(false)
                        }}
                      >
                        <td className="font-mono font-bold" style={{ color: '#38bdf8' }}>{p.codigo || '-'}</td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{p.descricao}</div>
                          {p.grupo && <div className="text-xs text-muted">{p.grupo}</div>}
                        </td>
                        <td className="font-mono">{p.unidade || 'CX'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: Number(p.saldo_kg) > 0 ? '#4ade80' : '#94a3b8' }} className="font-mono">
                          {fmtKg(p.saldo_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{fmtCx(p.qtd_caixas ?? p.saldo_caixas)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-muted">
                          {Number(p.peso_medio_cx) > 0 ? `${Number(p.peso_medio_cx).toFixed(2)} kg` : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn--primary btn--sm">
                            Selecionar
                          </button>
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

      {/* Modal de Detalhes do Pedido */}
      {pedidoDetalhe && (
        <div
          className="modal-overlay"
          style={{ padding: '16px' }}
        >
          <div className="card" style={{ width: '920px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {pedidoDetalhe.codigo} — {pedidoDetalhe.titulo}
                </h2>
                <div className="text-muted text-xs" style={{ marginTop: '4px' }}>
                  Cliente: {pedidoDetalhe.cliente} • Status:{' '}
                  <strong>{STATUS_BADGE[pedidoDetalhe.status]?.label || pedidoDetalhe.status}</strong>
                  {pedidoDetalhe.romaneio_codigo ? ` • Romaneio: ${pedidoDetalhe.romaneio_codigo}` : ''}
                  {pedidoDetalhe.marchante ? ` • Marchante: ${pedidoDetalhe.marchante}` : ''}
                  {pedidoDetalhe.criado_por_nome ? ` • Emitido por ${pedidoDetalhe.criado_por_nome}${pedidoDetalhe.setor_solicitante ? ` (${pedidoDetalhe.setor_solicitante})` : ''}` : ''}
                </div>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPedidoDetalhe(null)}>
                <X size={16} /> Fechar
              </button>
            </div>

            <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Itens Solicitados × Separados</h3>
            <table className="table" style={{ marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Produto</th>
                  <th style={{ textAlign: 'right' }}>Pedido</th>
                  <th style={{ textAlign: 'right' }}>Separado</th>
                  <th style={{ textAlign: 'center' }}>Caixas</th>
                  <th style={{ textAlign: 'center' }}>Conferidas</th>
                </tr>
              </thead>
              <tbody>
                {(pedidoDetalhe.itens || []).map((it) => (
                  <tr key={it.id}>
                    <td className="font-mono">{it.produto_codigo || '-'}</td>
                    <td style={{ fontWeight: 700 }}>{it.produto_descricao}</td>
                    <td style={{ textAlign: 'right' }}>{fmtKg(it.qtd_kg_solicitada)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(it.kg_separado)}</td>
                    <td style={{ textAlign: 'center' }}>{it.caixas_separadas} cx</td>
                    <td style={{ textAlign: 'center' }}>{it.caixas_conferidas}/{it.caixas_separadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pedidoDetalhe.caixas?.length > 0 && (
              <>
                <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>
                  Caixas Separadas ({pedidoDetalhe.caixas.length})
                </h3>
                <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>EAN Caixa</th>
                        <th>Lote</th>
                        <th>Validade</th>
                        <th style={{ textAlign: 'right' }}>Peso</th>
                        <th style={{ textAlign: 'center' }}>Conferência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidoDetalhe.caixas.map((cx) => (
                        <tr key={cx.id}>
                          <td>
                            {cx.produto_descricao}
                            {Number(cx.extra_fora_pedido) === 1 && (
                              <span className="badge badge--warning" style={{ marginLeft: '6px' }}>Extra</span>
                            )}
                          </td>
                          <td className="font-mono">{cx.ean_caixa}</td>
                          <td className="font-mono">{cx.lote || '-'}</td>
                          <td>{fmtData(cx.validade)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtKg(cx.peso_kg)}</td>
                          <td style={{ textAlign: 'center' }}>
                            {Number(cx.conferido) === 1 ? (
                              <span className="badge badge--success">Conferida</span>
                            ) : (
                              <span className="badge badge--neutral">Pendente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
              {!['EXPEDIDO', 'CANCELADO'].includes(pedidoDetalhe.status) &&
                !pedidoDetalhe.tem_nf_autorizada &&
                podeGerenciarPedidos && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      const idAlvo = pedidoDetalhe.id
                      setPedidoDetalhe(null)
                      abrirEditarPedido(idAlvo)
                    }}
                  >
                    <Edit3 size={15} /> Editar Pedido
                  </button>
                )}
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setPrintPedido(pedidoDetalhe)
                }}
              >
                <Printer size={15} /> Imprimir Folha do Pedido
              </button>
              {pedidoDetalhe.romaneio_id &&
                ['EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(pedidoDetalhe.status) && (
                  <button
                    type="button"
                    className="btn btn--warning"
                    onClick={() => handleImprimirEtiquetasReserva(pedidoDetalhe, false)}
                  >
                    <Tag size={15} /> Etiquetas Reservado
                  </button>
                )}
              {pedidoDetalhe.romaneio_id &&
                ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(pedidoDetalhe.status) && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={async () => {
                      const rom = await saidaQueries.detalhesRomaneio(pedidoDetalhe.romaneio_id)
                      setPrintRomaneio(rom)
                    }}
                  >
                    <Truck size={15} /> Imprimir Romaneio de Embarque
                  </button>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Modal para Cadastro Futuro de Outros Clientes */}
      {modalNovoClienteAberto && (
        <div className="modal-overlay" style={{ padding: '16px' }} onClick={() => setModalNovoClienteAberto(false)}>
          <form
            className="card"
            style={{ width: '740px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSalvarNovoCliente}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Cadastrar Novo Cliente</h2>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalNovoClienteAberto(false)}>
                <X size={15} /> Fechar
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">Código</label>
                <input className="form-input font-mono" value={novoCliForm.codigo} onChange={(e) => setNovoCliForm({ ...novoCliForm, codigo: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Razão Social *</label>
                <input className="form-input" required value={novoCliForm.razao_social} onChange={(e) => setNovoCliForm({ ...novoCliForm, razao_social: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Nome Fantasia</label>
                <input className="form-input" value={novoCliForm.nome_fantasia} onChange={(e) => setNovoCliForm({ ...novoCliForm, nome_fantasia: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">CPF / CNPJ</label>
                <input className="form-input font-mono" value={novoCliForm.cnpj_cpf} onChange={(e) => setNovoCliForm({ ...novoCliForm, cnpj_cpf: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Inscrição Estadual</label>
                <input className="form-input font-mono" value={novoCliForm.inscricao_estadual} onChange={(e) => setNovoCliForm({ ...novoCliForm, inscricao_estadual: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Telefone</label>
                <input className="form-input font-mono" value={novoCliForm.telefone} onChange={(e) => setNovoCliForm({ ...novoCliForm, telefone: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">Endereço</label>
                <input className="form-input" value={novoCliForm.endereco} onChange={(e) => setNovoCliForm({ ...novoCliForm, endereco: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Número</label>
                <input className="form-input" value={novoCliForm.numero} onChange={(e) => setNovoCliForm({ ...novoCliForm, numero: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Bairro</label>
                <input className="form-input" value={novoCliForm.bairro} onChange={(e) => setNovoCliForm({ ...novoCliForm, bairro: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 140px 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label className="form-label">Cidade</label>
                <input className="form-input" value={novoCliForm.cidade} onChange={(e) => setNovoCliForm({ ...novoCliForm, cidade: e.target.value })} />
              </div>
              <div>
                <label className="form-label">UF</label>
                <input className="form-input" maxLength={2} value={novoCliForm.uf} onChange={(e) => setNovoCliForm({ ...novoCliForm, uf: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="form-label">CEP</label>
                <input className="form-input font-mono" value={novoCliForm.cep} onChange={(e) => setNovoCliForm({ ...novoCliForm, cep: e.target.value })} />
              </div>
              <div>
                <label className="form-label">ICMS</label>
                <input className="form-input" value={novoCliForm.icms} onChange={(e) => setNovoCliForm({ ...novoCliForm, icms: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn--secondary" onClick={() => setModalNovoClienteAberto(false)}>Cancelar</button>
              <button type="submit" className="btn btn--success">Salvar Cliente</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Parser Direto WhatsApp -> Preenche Formulario em 1 Clique */}
      {modalWhatsappAberto && (
        <div className="modal-overlay" style={{ padding: '16px' }} onClick={() => setModalWhatsappAberto(false)}>
          <div className="card" style={{ width: '680px', maxWidth: '100%', padding: '20px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageSquare size={19} className="text-success" /> Importar Pedido do WhatsApp (Sem Alt+Tab)
              </h2>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalWhatsappAberto(false)}>
                <X size={15} /> Fechar
              </button>
            </div>
            <p className="text-xs text-muted" style={{ marginBottom: '10px' }}>
              Cole abaixo a mensagem recebida do cliente ou vendedor. O sistema identifica automaticamente o cliente, forma de pagamento, preços, cortes e observações.
            </p>
            <textarea
              className="form-input font-mono"
              rows={10}
              style={{ fontSize: 12, marginBottom: '12px' }}
              placeholder="Cole a mensagem aqui..."
              value={whatsappTextoInput}
              onChange={(e) => setWhatsappTextoInput(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn--secondary" onClick={() => setModalWhatsappAberto(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn--success" disabled={parseandoWpp} onClick={handleAplicarTextoWhatsapp}>
                <MessageSquare size={15} /> {parseandoWpp ? 'Analisando...' : 'Preencher Pedido Agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {printPedido && (
        <FolhaPedidoPrint pedido={printPedido} onClose={() => setPrintPedido(null)} />
      )}
      {printRomaneio && (
        <RomaneioEmbarquePrint romaneio={printRomaneio} onClose={() => setPrintRomaneio(null)} />
      )}
      <EtiquetaReservaZebraModal
        isOpen={etiquetasReservaModal.open}
        etiquetas={etiquetasReservaModal.etiquetas}
        autoPrint={etiquetasReservaModal.autoPrint}
        titulo={etiquetasReservaModal.titulo}
        subtitulo={etiquetasReservaModal.subtitulo}
        onClose={() =>
          setEtiquetasReservaModal({
            open: false,
            etiquetas: [],
            autoPrint: false,
            titulo: '',
            subtitulo: ''
          })
        }
      />
    </div>
  )
}
