import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Archive,
  Ban,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  CreditCard,
  Download,
  FileCheck2,
  FileCode2,
  FileText,
  FileUp,
  KeyRound,
  Layers,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { fiscalQueries } from '../queries/fiscal'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import {
  DanfePrintModal,
  PacoteLotePrintModal,
  imprimirBoletoNota,
  imprimirDanfeDocumento,
  imprimirPacoteCompletoNota,
  imprimirRomaneioProdutosNota,
  imprimirSomenteDanfe,
} from '../components/fiscal/DanfePrintModal'
import { AbaConfigCertificado } from '../components/fiscal/AbaConfigCertificado'
import { AbaEntradaNfeCompra } from '../components/fiscal/AbaEntradaNfeCompra'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtData = (d) => {
  if (!d) return '-'
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    const [y, m, day] = String(d).split('-')
    return `${day}/${m}/${y}`
  }
  try {
    return new Date(d).toLocaleDateString('pt-BR')
  } catch {
    return String(d)
  }
}

const fmtDataHora = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleString('pt-BR')
  } catch {
    return String(d)
  }
}

// Cores e rótulos distintos por Status Operacional na Fila de Emissão Fiscal
function obterBadgeStatusFila(status) {
  switch (String(status || '').toUpperCase()) {
    case 'AGUARDANDO_CONFERENCIA':
      return {
        label: '✓ Pronto p/ Faturar',
        style: {
          background: 'rgba(37, 99, 235, 0.22)',
          color: '#60a5fa',
          border: '1px solid rgba(59, 130, 246, 0.55)',
          fontWeight: 800,
        },
        pronto: true,
      }
    case 'EM_CONFERENCIA':
      return {
        label: '✓ Conferido / Pronto p/ Faturar',
        style: {
          background: 'rgba(6, 182, 212, 0.18)',
          color: '#22d3ee',
          border: '1px solid rgba(6, 182, 212, 0.45)',
          fontWeight: 800,
        },
        pronto: true,
      }
    case 'EXPEDIDO':
      return {
        label: '✓ Expedido (Peso Real)',
        style: {
          background: 'rgba(16, 185, 129, 0.18)',
          color: '#34d399',
          border: '1px solid rgba(16, 185, 129, 0.45)',
          fontWeight: 800,
        },
        pronto: true,
      }
    case 'EM_SEPARACAO':
      return {
        label: 'Em Separação na Câmara',
        style: {
          background: 'rgba(245, 158, 11, 0.18)',
          color: '#fbbf24',
          border: '1px solid rgba(245, 158, 11, 0.45)',
          fontWeight: 700,
        },
        pronto: false,
      }
    case 'LIBERADO':
      return {
        label: 'Liberado p/ Separação',
        style: {
          background: 'rgba(168, 85, 247, 0.18)',
          color: '#c084fc',
          border: '1px solid rgba(168, 85, 247, 0.42)',
          fontWeight: 700,
        },
        pronto: false,
      }
    case 'BLOQUEADO_ESTOQUE':
      return {
        label: '🔒 Trava Estoque',
        style: {
          background: 'rgba(239, 68, 68, 0.18)',
          color: '#f87171',
          border: '1px solid rgba(239, 68, 68, 0.45)',
          fontWeight: 700,
        },
        pronto: false,
      }
    default:
      return {
        label: status || 'Pendente',
        style: {
          background: 'rgba(148, 163, 184, 0.15)',
          color: '#cbd5e1',
          border: '1px solid rgba(148, 163, 184, 0.3)',
        },
        pronto: false,
      }
  }
}

function downloadTextFile(filename, content, mime = 'application/xml;charset=utf-8;') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const ABAS_FISCAL_VALIDAS = ['FILA', 'NOTAS', 'ENTRADA_COMPRA', 'COFRE', 'EVENTOS', 'CONFIG']

export function Fiscal() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()

  const abaInicialUrl = String(searchParams.get('aba') || location.state?.aba || '').toUpperCase()
  const pcInicialUrl = String(searchParams.get('pc') || location.state?.pcId || '')

  const [aba, setAba] = useState(
    ABAS_FISCAL_VALIDAS.includes(abaInicialUrl) ? abaInicialUrl : 'FILA',
  ) // 'FILA' | 'NOTAS' | 'ENTRADA_COMPRA' | 'COFRE' | 'EVENTOS' | 'CONFIG'

  useEffect(() => {
    const alvo = String(searchParams.get('aba') || location.state?.aba || '').toUpperCase()
    if (ABAS_FISCAL_VALIDAS.includes(alvo)) {
      setAba(alvo)
    }
  }, [searchParams, location.state])
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState(null)
  const [fila, setFila] = useState({ pedidos: [], devolucoes: [] })
  const [notas, setNotas] = useState([])
  const [resumoNotas, setResumoNotas] = useState({
    total_notas: 0,
    autorizadas: 0,
    canceladas: 0,
    nfe_55: 0,
    nfce_65: 0,
    valor_total_autorizado: 0,
    total_icms: 0,
  })
  const [eventos, setEventos] = useState([])

  // ── FILTROS DINÂMICOS DA FILA DE EMISSÃO ──────────────────────────────────
  const [buscaFila, setBuscaFila] = useState('')
  const [statusFilaFiltro, setStatusFilaFiltro] = useState('TODOS') // 'TODOS' | 'PRONTOS' | 'AGUARDANDO_CONFERENCIA' | 'LIBERADO' | 'EXPEDIDO'
  const [dataIniFila, setDataIniFila] = useState('')
  const [dataFimFila, setDataFimFila] = useState('')
  const [selecionadosFila, setSelecionadosFila] = useState([]) // array de pedido.id

  // ── FILTROS DINÂMICOS DE NOTAS EMITIDAS ───────────────────────────────────
  const [modeloFiltro, setModeloFiltro] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('TODOS')
  const [buscaNota, setBuscaNota] = useState('')
  const [dataIniNota, setDataIniNota] = useState('')
  const [dataFimNota, setDataFimNota] = useState('')
  const [selecionadasNotas, setSelecionadasNotas] = useState([]) // array de nota.id

  // Cofre XML mensal
  const [mesCofre, setMesCofre] = useState(() => new Date().toISOString().slice(0, 7))
  const [cofre, setCofre] = useState({ resumo: {}, arquivos: [] })

  // Modais de Emissão & Impressão
  const [previewPedido, setPreviewPedido] = useState(null) // modal individual (1 pedido)
  const [modalLote, setModalLote] = useState(null) // modal de faturamento em lote (2+ pedidos)
  const [emitindo, setEmitindo] = useState(false)
  const [notaDanfe, setNotaDanfe] = useState(null) // modal de impressão individual (1 nota)
  const [pacoteLoteNotas, setPacoteLoteNotas] = useState(null) // modal de impressão de lote (2+ notas)
  const [carregandoImpressaoId, setCarregandoImpressaoId] = useState(null)

  const [modalEvento, setModalEvento] = useState(null) // { tipo: 'CANCELAR' | 'CCE', nota, texto }
  const [modalAvulsa, setModalAvulsa] = useState(false)
  const [produtosCat, setProdutosCat] = useState([])
  const [transportadorasCat, setTransportadorasCat] = useState([])
  const [avulsaForm, setAvulsaForm] = useState({
    modelo: '65',
    destinatario_nome: 'CONSUMIDOR FINAL',
    destinatario_doc: '',
    destinatario_uf: 'SP',
    forma_pagamento_label: '17 - PIX',
    t_pag: '17',
    mod_frete: '0',
    transportadora_id: '',
    veiculo_id: '',
    veiculo_placa: '',
    veiculo_uf: 'SP',
    produto_id: '',
    codigo: '001',
    descricao: '',
    ncm: '02013000',
    qtd: '1',
    valor_unitario: '',
  })

  // Form Inutilização
  const [inutForm, setInutForm] = useState({
    modelo: '55',
    serie: 1,
    numero_inicial: '',
    numero_final: '',
    justificativa: '',
  })

  const carregarTudo = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [cfgRes, filaRes, notasRes, evRes, prodsRes, transpsRes] = await Promise.all([
        fiscalQueries.obterConfig(),
        fiscalQueries.listarFilaEmissao(),
        fiscalQueries.listarNotas({
          modelo: modeloFiltro || undefined,
          status: statusFiltro,
          busca: buscaNota || undefined,
          data_inicio: dataIniNota || undefined,
          data_fim: dataFimNota || undefined,
        }),
        fiscalQueries.listarEventos(),
        cadastrosQueries.listarProdutos?.().catch(() => []) || Promise.resolve([]),
        cadastrosQueries.listarTransportadoras?.().catch(() => []) || Promise.resolve([]),
      ])
      setConfig(cfgRes)
      setFila({ pedidos: filaRes?.pedidos || [], devolucoes: filaRes?.devolucoes || [] })
      setNotas(notasRes?.data || [])
      setResumoNotas(
        notasRes?.resumo || {
          total_notas: 0,
          autorizadas: 0,
          canceladas: 0,
          nfe_55: 0,
          nfce_65: 0,
          valor_total_autorizado: 0,
          total_icms: 0,
        },
      )
      setEventos(evRes || [])
      if (Array.isArray(prodsRes)) setProdutosCat(prodsRes)
      if (Array.isArray(transpsRes)) setTransportadorasCat(transpsRes)
    } catch (err) {
      toastError('Erro ao carregar Módulo Fiscal', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, modeloFiltro, statusFiltro, buscaNota, dataIniNota, dataFimNota, toastError])

  const carregarCofre = useCallback(async () => {
    if (!apiAtiva || aba !== 'COFRE') return
    try {
      const res = await fiscalQueries.obterCofreXml(mesCofre)
      setCofre(res || { resumo: {}, arquivos: [] })
    } catch (err) {
      toastError('Erro ao carregar Cofre XML', err.message)
    }
  }, [apiAtiva, aba, mesCofre, toastError])

  useEffect(() => {
    carregarTudo()
  }, [carregarTudo])

  useEffect(() => {
    carregarCofre()
  }, [carregarCofre])

  // ── FILTRAGEM INSTANTÂNEA DA FILA DE EMISSÃO ──────────────────────────────
  const pedidosFilaFiltrados = useMemo(() => {
    const q = buscaFila.trim().toLowerCase()
    return (fila.pedidos || []).filter((p) => {
      const st = String(p.status || '').toUpperCase()
      if (statusFilaFiltro === 'PRONTOS') {
        if (!['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(st)) return false
      } else if (statusFilaFiltro !== 'TODOS' && st !== statusFilaFiltro) {
        return false
      }

      const diaRef = String(p.previsao_entrega || (p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : '')).slice(0, 10)
      if (dataIniFila && diaRef && diaRef < dataIniFila) return false
      if (dataFimFila && diaRef && diaRef > dataFimFila) return false

      if (!q) return true
      return (
        String(p.codigo || '').toLowerCase().includes(q) ||
        String(p.titulo || '').toLowerCase().includes(q) ||
        String(p.cliente_nome || '').toLowerCase().includes(q) ||
        String(p.cliente_doc || '').toLowerCase().includes(q) ||
        String(p.forma_pagamento || '').toLowerCase().includes(q)
      )
    })
  }, [fila.pedidos, buscaFila, statusFilaFiltro, dataIniFila, dataFimFila])

  const aplicarPresetDataFila = (dias) => {
    if (dias === null) {
      setDataIniFila('')
      setDataFimFila('')
      return
    }
    const fim = new Date()
    const ini = new Date()
    ini.setDate(fim.getDate() - dias)
    setDataIniFila(ini.toISOString().slice(0, 10))
    setDataFimFila(fim.toISOString().slice(0, 10))
  }

  const aplicarPresetDataNotas = (dias) => {
    if (dias === null) {
      setDataIniNota('')
      setDataFimNota('')
      return
    }
    const fim = new Date()
    const ini = new Date()
    ini.setDate(fim.getDate() - dias)
    setDataIniNota(ini.toISOString().slice(0, 10))
    setDataFimNota(fim.toISOString().slice(0, 10))
  }

  // ── SELEÇÃO EM LOTE NA FILA ───────────────────────────────────────────────
  const toggleSelecaoFila = (pedId) => {
    setSelecionadosFila((prev) =>
      prev.includes(pedId) ? prev.filter((id) => id !== pedId) : [...prev, pedId],
    )
  }

  const toggleSelecionarTodosFila = () => {
    const idsVisiveis = pedidosFilaFiltrados.map((p) => p.id)
    const todosMarcados = idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionadosFila.includes(id))
    if (todosMarcados) {
      setSelecionadosFila((prev) => prev.filter((id) => !idsVisiveis.includes(id)))
    } else {
      setSelecionadosFila((prev) => Array.from(new Set([...prev, ...idsVisiveis])))
    }
  }

  const selecionarProntosParaFaturar = () => {
    const prontosIds = pedidosFilaFiltrados
      .filter((p) => ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(String(p.status).toUpperCase()))
      .map((p) => p.id)
    setSelecionadosFila(prontosIds)
  }

  // ── EMISSÃO INDIVIDUAL (1 PEDIDO) ─────────────────────────────────────────
  const abrirPreviewPedido = async (ped, modelo = '55') => {
    try {
      const prev = await fiscalQueries.previewPedido(ped.id, modelo)
      const sugId = prev?.sugestao_transporte?.transportadora_id || ''
      const sugTransp = transportadorasCat.find((t) => t.id === sugId) || transportadorasCat[0] || null
      const veicPadrao =
        sugTransp?.veiculos?.find((v) => v.padrao) || sugTransp?.veiculos?.[0] || null
      setPreviewPedido({
        pedido: ped,
        preview: prev,
        modelo,
        mod_frete: modelo === '65' ? '9' : '0',
        transportadora_id: sugTransp?.id || '',
        veiculo_id: veicPadrao?.id || '',
        veiculo_placa:
          prev?.sugestao_transporte?.veiculo_placa || veicPadrao?.placa || sugTransp?.placa_padrao || '',
        veiculo_uf: veicPadrao?.uf_placa || sugTransp?.uf || prev?.emitente?.uf || 'SP',
        transportadora_antt: veicPadrao?.rntrc_antt || sugTransp?.rntrc_antt || '',
        especie_volumes: 'CAIXA',
        valor_frete: '0',
        inf_complementar: '',
      })
    } catch (err) {
      toastError('Erro ao calcular tributos do pedido', err.message)
    }
  }

  const confirmarEmissaoPedido = async () => {
    if (!previewPedido) return
    const exigeTransp =
      previewPedido.modelo === '55' && ['0', '1'].includes(String(previewPedido.mod_frete))
    if (exigeTransp && !previewPedido.transportadora_id) {
      return toastError(
        'Transportadora obrigatória',
        'Para NF-e Modelo 55 com frete 0 (Emitente/CIF) ou 1 (Destinatário/FOB), selecione a Transportadora antes de emitir.',
      )
    }
    setEmitindo(true)
    try {
      const res = await fiscalQueries.emitirPedido(previewPedido.pedido.id, {
        modelo: previewPedido.modelo,
        mod_frete: previewPedido.mod_frete,
        transportadora_id: previewPedido.transportadora_id || null,
        veiculo_id: previewPedido.veiculo_id || null,
        veiculo_placa: previewPedido.veiculo_placa || '',
        veiculo_uf: previewPedido.veiculo_uf || '',
        transportadora_antt: previewPedido.transportadora_antt || '',
        especie_volumes: previewPedido.especie_volumes || 'CAIXA',
        valor_frete: Number(String(previewPedido.valor_frete || 0).replace(',', '.')),
        inf_complementar: previewPedido.inf_complementar,
      })
      toastSuccess(
        `${previewPedido.modelo === '65' ? 'NFC-e' : 'NF-e'} Autorizada ✅`,
        `Nº ${res.numero} / Série ${res.serie} • Abrindo DANFE + Boleto para impressão.`,
      )
      setPreviewPedido(null)
      setSelecionadosFila((prev) => prev.filter((id) => id !== previewPedido.pedido.id))
      await carregarTudo()
      const detalhe = await fiscalQueries.obterNota(res.id)
      setNotaDanfe(detalhe)
    } catch (err) {
      toastError('Erro ao emitir nota fiscal', err.message)
    } finally {
      setEmitindo(false)
    }
  }

  // ── EMISSÃO EM LOTE (2 OU MAIS PEDIDOS) ───────────────────────────────────
  const abrirModalFaturamentoLote = () => {
    const peds = (fila.pedidos || []).filter((p) => selecionadosFila.includes(p.id))
    if (peds.length === 0) return
    if (peds.length === 1) {
      abrirPreviewPedido(peds[0], '55')
      return
    }
    const transpDefault = transportadorasCat[0] || null
    const veicDefault = transpDefault?.veiculos?.find((v) => v.padrao) || transpDefault?.veiculos?.[0] || null
    setModalLote({
      modelo: '55',
      mod_frete: '0',
      transportadora_id: transpDefault?.id || '',
      veiculo_id: veicDefault?.id || '',
      veiculo_placa: veicDefault?.placa || transpDefault?.placa_padrao || '',
      veiculo_uf: veicDefault?.uf_placa || transpDefault?.uf || 'SP',
      transportadora_antt: veicDefault?.rntrc_antt || transpDefault?.rntrc_antt || '',
      especie_volumes: 'CAIXA',
      inf_complementar: '',
      pedidos: peds,
    })
  }

  const confirmarEmissaoLote = async () => {
    if (!modalLote) return
    const exigeTransp = modalLote.modelo === '55' && ['0', '1'].includes(String(modalLote.mod_frete))
    if (exigeTransp && !modalLote.transportadora_id) {
      return toastError(
        'Transportadora obrigatória no Lote',
        'Selecione a Transportadora padrão do lote para frete 0 (CIF) ou 1 (FOB).',
      )
    }
    setEmitindo(true)
    try {
      const res = await fiscalQueries.emitirLote({
        modelo: modalLote.modelo,
        mod_frete: modalLote.mod_frete,
        transportadora_id: modalLote.transportadora_id || null,
        veiculo_id: modalLote.veiculo_id || null,
        veiculo_placa: modalLote.veiculo_placa || '',
        veiculo_uf: modalLote.veiculo_uf || '',
        transportadora_antt: modalLote.transportadora_antt || '',
        especie_volumes: modalLote.especie_volumes || 'CAIXA',
        inf_complementar: modalLote.inf_complementar || '',
        pedidos: modalLote.pedidos.map((p) => ({
          pedido_id: p.id,
        })),
      })
      toastSuccess(
        `Lote Faturado com Sucesso ✅`,
        `${res.total_emitidas} NF-e(s) autorizadas! Lote de impressão (NF + Boleto + Romaneio) pronto.`,
      )
      setModalLote(null)
      setSelecionadosFila([])
      await carregarTudo()
      if (Array.isArray(res.notas) && res.notas.length > 0) {
        if (res.notas.length === 1) {
          setNotaDanfe(res.notas[0])
        } else {
          setPacoteLoteNotas(res.notas)
        }
      }
    } catch (err) {
      toastError('Erro no faturamento em lote', err.message)
    } finally {
      setEmitindo(false)
    }
  }

  const handleEmitirDevolucao = async (dev) => {
    const ok = await confirmar({
      title: `Emitir NF-e de Devolução (${dev.codigo})`,
      message: `Emitir NF-e de Entrada/Devolução (CFOP 1202/2202) para ${dev.cliente_nome || 'Cliente'} no valor estimado de ${fmtMoeda(
        dev.valor_estimado,
      )}?`,
      type: 'info',
      confirmLabel: 'Sim, Emitir NF-e Devolução',
    })
    if (!ok) return
    try {
      const res = await fiscalQueries.emitirDevolucao(dev.id)
      toastSuccess('NF-e de Devolução Autorizada ✅', `Nº ${res.numero} • Status fiscal da devolução atualizado.`)
      await carregarTudo()
      const detalhe = await fiscalQueries.obterNota(res.id)
      setNotaDanfe(detalhe)
    } catch (err) {
      toastError('Erro na emissão da devolução', err.message)
    }
  }

  const handleEmitirAvulsa = async (e) => {
    e.preventDefault()
    if (
      avulsaForm.modelo === '55' &&
      ['0', '1'].includes(String(avulsaForm.mod_frete)) &&
      !avulsaForm.transportadora_id
    ) {
      return toastError(
        'Transportadora obrigatória',
        'Para NF-e 55 com frete 0 (CIF) ou 1 (FOB), selecione a Transportadora.',
      )
    }
    setEmitindo(true)
    try {
      const res = await fiscalQueries.emitirAvulsa({
        modelo: avulsaForm.modelo,
        destinatario_nome: avulsaForm.destinatario_nome,
        destinatario_doc: avulsaForm.destinatario_doc,
        destinatario_uf: avulsaForm.destinatario_uf,
        forma_pagamento_label: avulsaForm.forma_pagamento_label,
        t_pag: avulsaForm.t_pag,
        mod_frete: avulsaForm.modelo === '65' ? '9' : avulsaForm.mod_frete,
        transportadora_id: avulsaForm.modelo === '55' ? avulsaForm.transportadora_id || null : null,
        veiculo_id: avulsaForm.modelo === '55' ? avulsaForm.veiculo_id || null : null,
        veiculo_placa: avulsaForm.modelo === '55' ? avulsaForm.veiculo_placa || '' : '',
        veiculo_uf: avulsaForm.modelo === '55' ? avulsaForm.veiculo_uf || '' : '',
        itens: [
          {
            produto_id: avulsaForm.produto_id || null,
            codigo: avulsaForm.codigo || '001',
            descricao: avulsaForm.descricao,
            ncm: avulsaForm.ncm || '02013000',
            unidade: 'KG',
            qtd: Number(String(avulsaForm.qtd).replace(',', '.')),
            valor_unitario: Number(String(avulsaForm.valor_unitario).replace(',', '.')),
          },
        ],
      })
      toastSuccess(
        `${avulsaForm.modelo === '65' ? 'NFC-e (Cupom)' : 'NF-e'} Emitida ✅`,
        `Nº ${res.numero} • Chave ${res.chave_acesso}`,
      )
      setModalAvulsa(false)
      await carregarTudo()
      const detalhe = await fiscalQueries.obterNota(res.id)
      setNotaDanfe(detalhe)
    } catch (err) {
      toastError('Erro na emissão avulsa', err.message)
    } finally {
      setEmitindo(false)
    }
  }

  // ── IMPRESSÃO E REIMPRESSÃO EM NOTAS EMITIDAS ─────────────────────────────
  const abrirModalNotaCompleta = async (notaId) => {
    setCarregandoImpressaoId(notaId)
    try {
      const det = await fiscalQueries.obterNota(notaId)
      setNotaDanfe(det)
    } catch (err) {
      toastError('Erro ao carregar documentos da nota', err.message)
    } finally {
      setCarregandoImpressaoId(null)
    }
  }

  const reimprimirDireto = async (notaId, tipo) => {
    setCarregandoImpressaoId(notaId)
    try {
      const det = await fiscalQueries.obterNota(notaId)
      if (tipo === 'DANFE') imprimirSomenteDanfe(det)
      else if (tipo === 'BOLETO') imprimirBoletoNota(det)
      else if (tipo === 'ROMANEIO') imprimirRomaneioProdutosNota(det)
      else if (tipo === 'PACOTE') imprimirPacoteCompletoNota(det)
      else imprimirDanfeDocumento(det)
    } catch (err) {
      toastError('Erro ao preparar impressão', err.message)
    } finally {
      setCarregandoImpressaoId(null)
    }
  }

  const abrirImpressaoLoteSelecionadas = async () => {
    if (selecionadasNotas.length === 0) return
    if (selecionadasNotas.length === 1) {
      await abrirModalNotaCompleta(selecionadasNotas[0])
      return
    }
    try {
      const res = await fiscalQueries.obterPacoteImpressao(selecionadasNotas)
      if (Array.isArray(res?.notas) && res.notas.length > 0) {
        setPacoteLoteNotas(res.notas)
      }
    } catch (err) {
      toastError('Erro ao montar pacote de impressão em lote', err.message)
    }
  }

  const toggleSelecaoNota = (notaId) => {
    setSelecionadasNotas((prev) =>
      prev.includes(notaId) ? prev.filter((id) => id !== notaId) : [...prev, notaId],
    )
  }

  const toggleSelecionarTodasNotas = () => {
    const ids = notas.map((n) => n.id)
    const todas = ids.length > 0 && ids.every((id) => selecionadasNotas.includes(id))
    setSelecionadasNotas(todas ? [] : ids)
  }

  const baixarXmlNota = async (notaId) => {
    try {
      const res = await fiscalQueries.obterXmlNota(notaId)
      downloadTextFile(res.nome_arquivo, res.xml)
      toastSuccess('XML baixado ✅', res.nome_arquivo)
    } catch (err) {
      toastError('Erro ao baixar XML', err.message)
    }
  }

  const confirmarEventoModal = async (e) => {
    e.preventDefault()
    if (!modalEvento) return
    try {
      if (modalEvento.tipo === 'CANCELAR') {
        await fiscalQueries.cancelarNota(modalEvento.nota.id, modalEvento.texto)
        toastSuccess('Nota Cancelada ✅', `NF nº ${modalEvento.nota.numero} cancelada e evento registrado.`)
      } else {
        const res = await fiscalQueries.emitirCartaCorrecao(modalEvento.nota.id, modalEvento.texto)
        toastSuccess('Carta de Correção (CC-e) Registrada ✅', `Sequência #${res.sequencia} • Protocolo ${res.protocolo}`)
      }
      setModalEvento(null)
      await carregarTudo()
    } catch (err) {
      toastError('Erro no evento fiscal', err.message)
    }
  }

  const handleInutilizar = async (e) => {
    e.preventDefault()
    try {
      const res = await fiscalQueries.inutilizarNumeracao(inutForm)
      toastSuccess('Numeração Inutilizada ✅', `Protocolo SEFAZ: ${res.protocolo}`)
      setInutForm({ modelo: '55', serie: 1, numero_inicial: '', numero_final: '', justificativa: '' })
      await carregarTudo()
    } catch (err) {
      toastError('Erro ao inutilizar numeração', err.message)
    }
  }

  const exportarPacoteContador = () => {
    if (!cofre?.arquivos?.length) return
    const csvHeader = 'ARQUIVO;TIPO;SERIE;NUMERO;STATUS;CHAVE_OU_PROTOCOLO;DESTINATARIO;VALOR_R$\n'
    const csvBody = cofre.arquivos
      .map(
        (a) =>
          `"${a.nome}";"${a.tipo}";${a.serie};${a.numero};"${a.status}";"${a.chave}";"${String(a.destinatario || '').replace(/"/g, '')}";${Number(
            a.valor || 0,
          )
            .toFixed(2)
            .replace('.', ',')}`,
      )
      .join('\n')
    downloadTextFile(`Resumo_Fiscal_${mesCofre}.csv`, '\uFEFF' + csvHeader + csvBody, 'text/csv;charset=utf-8;')

    const xmlBundle = `<?xml version="1.0" encoding="UTF-8"?>\n<loteContador mes="${mesCofre}" totalArquivos="${cofre.arquivos.length}">\n${cofre.arquivos
      .map((a) => `<!-- ARQUIVO: ${a.nome} -->\n${String(a.xml || '').replace(/<\?xml[^?]*\?>/i, '').trim()}`)
      .join('\n')}\n</loteContador>`
    downloadTextFile(`Cofre_XML_Contador_${mesCofre}.xml`, xmlBundle)
    toastSuccess('Pacote do Contador exportado ✅', 'Planilha CSV + Lote XML consolidado baixados.')
  }

  const qtdProntosFila = useMemo(
    () =>
      (fila.pedidos || []).filter((p) =>
        ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(String(p.status).toUpperCase()),
      ).length,
    [fila.pedidos],
  )

  return (
    <div className="fade-in">
      {/* CABEÇALHO */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <FileCheck2 className="text-primary" size={26} /> Módulo Fiscal — NF-e 55, NFC-e 65, Boletos &amp; Romaneio
          </h1>
          <p className="page-header__subtitle">
            Faturamento individual ou em lote com peso real das caixas, DANFE 2026, Boleto Bancário e Romaneio de Produtos em 1 clique
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          <button type="button" className="btn btn--secondary" onClick={() => setModalAvulsa(true)}>
            <Plus size={15} /> Emitir NF-e / NFC-e Avulsa
          </button>
          <button type="button" className="btn btn--primary" onClick={carregarTudo} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Módulo Fiscal (NF-e / NFC-e)" />

      {/* 5 CARDS KPI */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Fila de Emissão</div>
          <div className="text-xl font-bold font-mono text-warning" style={{ marginTop: 6 }}>
            {fila.pedidos.length + fila.devolucoes.length} pendente(s)
          </div>
          <div className="text-xs" style={{ marginTop: 4, color: '#60a5fa', fontWeight: 700 }}>
            {qtdProntosFila} Pronto(s) p/ Faturar (Separados)
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Notas Autorizadas</div>
          <div className="text-xl font-bold font-mono text-success" style={{ marginTop: 6 }}>
            {resumoNotas.autorizadas}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            NF-e 55: <strong>{resumoNotas.nfe_55}</strong> • NFC-e 65: <strong>{resumoNotas.nfce_65}</strong>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Total Faturado Fiscal</div>
          <div className="text-xl font-bold font-mono text-cyan" style={{ marginTop: 6 }}>
            {fmtMoeda(resumoNotas.valor_total_autorizado)}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            ICMS destacado: {fmtMoeda(resumoNotas.total_icms)}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Ambiente &amp; Motor</div>
          <div style={{ marginTop: 6 }} className="flex items-center gap-6">
            <span className={`badge ${config?.ambiente === 'PRODUCAO' ? 'badge--success' : 'badge--warning'}`}>
              {config?.ambiente || 'HOMOLOGACAO'}
            </span>
          </div>
          <div className="text-xs text-muted font-mono" style={{ marginTop: 4 }}>
            {config?.provedor || 'SIMULACAO_LOCAL'}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Certificado Digital A1</div>
          <div style={{ marginTop: 6 }}>
            {config?.certificado_configurado ? (
              <span className="badge badge--success">
                <CheckCircle2 size={12} /> A1 Instalado
              </span>
            ) : (
              <span className="badge badge--neutral">Modo Simulação (Sem A1)</span>
            )}
          </div>
          <div className="text-xs text-muted font-mono" style={{ marginTop: 4 }}>
            Próx. NF-e #{config?.proximo_numero_nfe || 1} • NFC-e #{config?.proximo_numero_nfce || 1}
          </div>
        </div>
      </div>

      {/* ABAS */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 16,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {[
          { id: 'FILA', label: `Fila de Emissão (${fila.pedidos.length + fila.devolucoes.length})`, icon: Send },
          { id: 'NOTAS', label: `Notas Emitidas (${notas.length})`, icon: FileText },
          { id: 'ENTRADA_COMPRA', label: 'Entrada NF-e (Compras)', icon: FileUp },
          { id: 'COFRE', label: 'Cofre XML (Contador)', icon: Archive },
          { id: 'EVENTOS', label: `Eventos & Inutilização (${eventos.length})`, icon: FileCode2 },
          { id: 'CONFIG', label: 'Certificado A1 & Config.', icon: KeyRound },
        ].map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              className={`btn ${aba === tab.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAba(tab.id)}
            >
              <Icon size={15} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* ABA 1: FILA DE EMISSÃO */}
      {aba === 'FILA' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* BARRA DE FILTROS DINÂMICOS DA FILA */}
          <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 440 }}>
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: 11,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 34, height: 36 }}
                  placeholder="Buscar por Nº do Pedido (PED-0009), nome do cliente, CNPJ, título..."
                  value={buscaFila}
                  onChange={(e) => setBuscaFila(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { id: 'TODOS', label: `Todos (${fila.pedidos.length})` },
                  { id: 'PRONTOS', label: `✓ Prontos p/ Faturar (${qtdProntosFila})` },
                  { id: 'LIBERADO', label: 'Liberados / Em Separação' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`btn btn--sm ${statusFilaFiltro === f.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setStatusFilaFiltro(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="text-xs text-muted flex items-center gap-4">
                  <Calendar size={13} /> Data:
                </span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', height: 32, padding: '2px 8px', fontSize: 12 }}
                  value={dataIniFila}
                  onChange={(e) => setDataIniFila(e.target.value)}
                />
                <span className="text-xs text-muted">até</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', height: 32, padding: '2px 8px', fontSize: 12 }}
                  value={dataFimFila}
                  onChange={(e) => setDataFimFila(e.target.value)}
                />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataFila(0)}>
                  Hoje
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataFila(7)}>
                  7 Dias
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataFila(null)}>
                  Todas Datas
                </button>
                {(buscaFila || statusFilaFiltro !== 'TODOS' || dataIniFila || dataFimFila) && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => {
                      setBuscaFila('')
                      setStatusFilaFiltro('TODOS')
                      setDataIniFila('')
                      setDataFimFila('')
                    }}
                  >
                    Limpar Filtros
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {qtdProntosFila > 0 && (
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={selecionarProntosParaFaturar}
                  >
                    <CheckSquare size={14} /> Marcar Prontos p/ Faturar ({qtdProntosFila})
                  </button>
                )}
                {selecionadosFila.length > 0 && (
                  <button
                    type="button"
                    className="btn btn--success btn--sm"
                    onClick={abrirModalFaturamentoLote}
                  >
                    <Layers size={14} />{' '}
                    {selecionadosFila.length === 1
                      ? 'Faturar 1 Pedido Selecionado'
                      : `Faturar em Lote (${selecionadosFila.length} Pedidos)`}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* CARD PEDIDOS DE VENDA AGUARDANDO NF-e */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '14px 18px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div>
                <h3 className="text-sm font-bold m-0">
                  Pedidos de Venda Aguardando NF-e / NFC-e ({pedidosFilaFiltrados.length})
                </h3>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  Selecione 1 pedido para conferência detalhada ou vários pedidos para faturar em lote e imprimir NF + Boleto + Romaneio de uma vez
                </div>
              </div>
              {selecionadosFila.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge badge--info">{selecionadosFila.length} selecionado(s)</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setSelecionadosFila([])}
                  >
                    Desmarcar
                  </button>
                </div>
              )}
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 38, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={
                          pedidosFilaFiltrados.length > 0 &&
                          pedidosFilaFiltrados.every((p) => selecionadosFila.includes(p.id))
                        }
                        onChange={toggleSelecionarTodosFila}
                        title="Selecionar todos os pedidos visíveis"
                      />
                    </th>
                    <th>Pedido / Data</th>
                    <th>Status Operacional</th>
                    <th>Cliente / UF / Condição</th>
                    <th style={{ textAlign: 'right' }}>Peso / Caixas</th>
                    <th style={{ textAlign: 'right' }}>Valor Pedido</th>
                    <th style={{ textAlign: 'right' }}>Emissão</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidosFilaFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center" style={{ padding: 28, color: 'var(--text-muted)' }}>
                        Nenhum pedido encontrado na fila de faturamento com os filtros atuais.
                      </td>
                    </tr>
                  ) : (
                    pedidosFilaFiltrados.map((p) => {
                      const badge = obterBadgeStatusFila(p.status)
                      const marcado = selecionadosFila.includes(p.id)
                      const temSep = Number(p.peso_separado_kg || 0) > 0
                      return (
                        <tr
                          key={p.id}
                          style={{
                            background: marcado ? 'rgba(59, 130, 246, 0.09)' : undefined,
                          }}
                        >
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={() => toggleSelecaoFila(p.id)}
                            />
                          </td>
                          <td>
                            <div className="font-mono font-bold text-xs text-cyan">{p.codigo}</div>
                            <div className="text-xs font-bold">{p.titulo}</div>
                            <div className="text-xs text-muted font-mono">
                              {fmtData(p.previsao_entrega || p.created_at)}
                            </div>
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                ...badge.style,
                                padding: '4px 10px',
                                borderRadius: 999,
                                fontSize: 11.5,
                                display: 'inline-block',
                              }}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td>
                            <div className="font-bold text-sm">{p.cliente_nome}</div>
                            <div className="text-xs text-muted font-mono">
                              {p.cliente_doc || 'Sem CNPJ/CPF'} • UF {p.cliente_uf} • {p.forma_pagamento || 'À VISTA'}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {temSep ? (
                              <>
                                <div className="font-bold text-success">
                                  {Number(p.peso_separado_kg).toFixed(2)} kg ({p.qtd_caixas_separadas} cx)
                                </div>
                                <div className="text-muted">Solic.: {Number(p.peso_solicitado_kg || 0).toFixed(2)} kg</div>
                              </>
                            ) : (
                              <>
                                <div className="font-bold">{Number(p.peso_solicitado_kg || 0).toFixed(2)} kg</div>
                                <div className="text-muted">{p.qtd_itens || 1} produto(s)</div>
                              </>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm">
                            {fmtMoeda(p.valor_total)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                onClick={() => abrirPreviewPedido(p, '55')}
                              >
                                <FileCheck2 size={13} /> Emitir NF-e (55)
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => abrirPreviewPedido(p, '65')}
                              >
                                NFC-e (65)
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CARD DEVOLUÇÕES PENDENTES */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '14px 18px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <h3 className="text-sm font-bold m-0">
                Devoluções Pendentes de NF-e de Entrada — CFOP 1202 / 2202 ({fila.devolucoes.length})
              </h3>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Devolução</th>
                    <th>Cliente / Pedido</th>
                    <th>Motivo</th>
                    <th style={{ textAlign: 'right' }}>Peso / Caixas</th>
                    <th style={{ textAlign: 'right' }}>Valor Est.</th>
                    <th style={{ textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {fila.devolucoes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center" style={{ padding: 24, color: 'var(--text-muted)' }}>
                        Nenhuma devolução pendente de NF-e fiscal.
                      </td>
                    </tr>
                  ) : (
                    fila.devolucoes.map((d) => (
                      <tr key={d.id}>
                        <td className="font-mono font-bold text-xs text-warning">{d.codigo}</td>
                        <td>
                          <div className="font-bold text-sm">{d.cliente_nome || '-'}</div>
                          <div className="text-xs text-muted font-mono">{d.pedido_codigo || '-'}</div>
                        </td>
                        <td className="text-xs">{d.motivo}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {Number(d.peso_total_kg || 0).toFixed(2)} kg ({d.qtd_caixas} cx)
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm">
                          {fmtMoeda(d.valor_estimado)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => handleEmitirDevolucao(d)}
                          >
                            <RotateCcw size={13} /> Emitir NF-e Devolução
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

      {/* ABA 2: NOTAS EMITIDAS */}
      {aba === 'NOTAS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { id: '', label: 'Todos Modelos' },
                  { id: '55', label: 'NF-e (55)' },
                  { id: '65', label: 'NFC-e (65)' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`btn btn--sm ${modeloFiltro === m.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setModeloFiltro(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
                <select
                  className="form-input"
                  style={{ width: 150, height: 34, fontSize: 12, padding: '2px 8px' }}
                  value={statusFiltro}
                  onChange={(e) => setStatusFiltro(e.target.value)}
                >
                  <option value="TODOS">Todos Status</option>
                  <option value="AUTORIZADA">Autorizadas</option>
                  <option value="CANCELADA">Canceladas</option>
                </select>
              </div>

              <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
                <Search
                  size={15}
                  style={{
                    position: 'absolute',
                    left: 11,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 34, height: 36 }}
                  placeholder="Nº NF, Nº Pedido (PED-0009), cliente, CNPJ, chave..."
                  value={buscaNota}
                  onChange={(e) => setBuscaNota(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="text-xs text-muted flex items-center gap-4">
                  <Calendar size={13} /> Emissão:
                </span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', height: 32, padding: '2px 8px', fontSize: 12 }}
                  value={dataIniNota}
                  onChange={(e) => setDataIniNota(e.target.value)}
                />
                <span className="text-xs text-muted">até</span>
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 'auto', height: 32, padding: '2px 8px', fontSize: 12 }}
                  value={dataFimNota}
                  onChange={(e) => setDataFimNota(e.target.value)}
                />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataNotas(0)}>
                  Hoje
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataNotas(7)}>
                  7 Dias
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataNotas(30)}>
                  30 Dias
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => aplicarPresetDataNotas(null)}>
                  Todas
                </button>
              </div>

              {selecionadasNotas.length > 0 && (
                <button
                  type="button"
                  className="btn btn--success btn--sm"
                  onClick={abrirImpressaoLoteSelecionadas}
                >
                  <Printer size={14} /> Imprimir Lote Selecionado ({selecionadasNotas.length} Nota(s): NF + Boleto + Romaneio)
                </button>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 38, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={notas.length > 0 && notas.every((n) => selecionadasNotas.includes(n.id))}
                        onChange={toggleSelecionarTodasNotas}
                        title="Selecionar todas as notas listadas"
                      />
                    </th>
                    <th>Modelo / Nº / Pedido</th>
                    <th>Emissão</th>
                    <th>Destinatário / Transporte</th>
                    <th style={{ textAlign: 'right' }}>Total NF</th>
                    <th>Situação</th>
                    <th style={{ textAlign: 'right' }}>Reimpressão (DANFE / Boleto / Romaneio) &amp; Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center" style={{ padding: 28, color: 'var(--text-muted)' }}>
                        Nenhuma nota fiscal emitida neste filtro.
                      </td>
                    </tr>
                  ) : (
                    notas.map((n) => {
                      const marcada = selecionadasNotas.includes(n.id)
                      const busy = carregandoImpressaoId === n.id
                      return (
                        <tr
                          key={n.id}
                          style={{
                            background: marcada ? 'rgba(59, 130, 246, 0.09)' : undefined,
                          }}
                        >
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => toggleSelecaoNota(n.id)}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`badge ${n.modelo === '65' ? 'badge--warning' : 'badge--info'}`}>
                                {n.modelo === '65' ? 'NFC-e 65' : 'NF-e 55'}
                              </span>
                              {n.pedido_codigo && (
                                <span className="font-mono font-bold text-xs text-cyan">{n.pedido_codigo}</span>
                              )}
                            </div>
                            <div className="font-mono font-bold text-xs" style={{ marginTop: 4 }}>
                              Nº {String(n.numero).padStart(6, '0')} • Série {n.serie}
                            </div>
                          </td>
                          <td className="text-xs font-mono">
                            <div>{fmtDataHora(n.data_autorizacao || n.created_at)}</div>
                            <div className="text-muted">{n.ambiente}</div>
                          </td>
                          <td>
                            <div className="font-bold text-sm">{n.destinatario_nome}</div>
                            <div className="text-xs font-mono text-muted">{n.chave_acesso}</div>
                            {n.transportadora_nome && (
                              <div className="text-xs text-cyan" style={{ marginTop: 2 }}>
                                Transp.: {n.transportadora_nome} {n.veiculo_placa ? `• Placa ${n.veiculo_placa}` : ''}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm text-cyan">
                            {fmtMoeda(n.valor_total_nf)}
                            <div className="text-xs text-muted font-normal">
                              {Number(n.peso_liquido_kg || 0).toFixed(2)} kg • ICMS: {fmtMoeda(n.valor_icms)}
                            </div>
                          </td>
                          <td>
                            {n.status === 'AUTORIZADA' ? (
                              <span className="badge badge--success">Autorizada</span>
                            ) : (
                              <span className="badge badge--danger">{n.status}</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                disabled={busy}
                                title="Abrir tela com DANFE, Boleto e Romaneio de Produtos"
                                onClick={() => abrirModalNotaCompleta(n.id)}
                              >
                                <Printer size={13} /> DANFE
                              </button>
                              {n.modelo === '55' && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn--secondary btn--sm"
                                    disabled={busy}
                                    title="Reimprimir Boleto Bancário desta NF-e"
                                    onClick={() => reimprimirDireto(n.id, 'BOLETO')}
                                  >
                                    <CreditCard size={13} /> Boleto
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--secondary btn--sm"
                                    disabled={busy}
                                    title="Reimprimir Romaneio de Produtos do Pedido"
                                    onClick={() => reimprimirDireto(n.id, 'ROMANEIO')}
                                  >
                                    <ClipboardList size={13} /> Romaneio
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--success btn--sm"
                                    disabled={busy}
                                    title="Imprimir Pacote Completo: DANFE + Boleto + Romaneio de Produtos"
                                    onClick={() => reimprimirDireto(n.id, 'PACOTE')}
                                  >
                                    <Layers size={13} /> Tudo
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                title="Baixar XML 4.00"
                                onClick={() => baixarXmlNota(n.id)}
                              >
                                <Download size={13} /> XML
                              </button>
                              {n.status === 'AUTORIZADA' && n.modelo === '55' && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  title="Emitir Carta de Correção (CC-e)"
                                  onClick={() => setModalEvento({ tipo: 'CCE', nota: n, texto: '' })}
                                >
                                  CC-e
                                </button>
                              )}
                              {n.status === 'AUTORIZADA' && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm text-danger"
                                  title="Cancelar Nota Fiscal"
                                  onClick={() => setModalEvento({ tipo: 'CANCELAR', nota: n, texto: '' })}
                                >
                                  <Ban size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: ENTRADA FISCAL DE NF-E DE COMPRA (XML → CONTAS A PAGAR) */}
      {aba === 'ENTRADA_COMPRA' && (
        <AbaEntradaNfeCompra
          toastSuccess={toastSuccess}
          toastError={toastError}
          toastWarning={toastWarning}
          onEscriturado={carregarTudo}
          pcInicialId={pcInicialUrl}
        />
      )}

      {/* ABA 4: COFRE XML DO CONTADOR */}
      {aba === 'COFRE' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h3 className="text-sm font-bold m-0">Cofre XML Mensal — Fechamento Contábil</h3>
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                Guarda legal de 5 anos de todos os XMLs autorizados, cancelados e eventos (CC-e / Inutilização).
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="month"
                className="form-input font-mono"
                value={mesCofre}
                onChange={(e) => setMesCofre(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={!cofre?.arquivos?.length}
                onClick={exportarPacoteContador}
              >
                <Download size={15} /> Exportar Pacote Contador (CSV + Lote XML)
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Arquivo XML</th>
                    <th>Tipo</th>
                    <th>Série / Nº</th>
                    <th>Destinatário / Evento</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {(cofre.arquivos || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center" style={{ padding: 28, color: 'var(--text-muted)' }}>
                        Nenhum arquivo XML gerado na competência {mesCofre}.
                      </td>
                    </tr>
                  ) : (
                    cofre.arquivos.map((a, idx) => (
                      <tr key={idx}>
                        <td className="font-mono text-xs">{a.nome}</td>
                        <td><span className="badge badge--info">{a.tipo}</span></td>
                        <td className="font-mono text-xs">S{a.serie} • Nº {a.numero}</td>
                        <td className="text-xs">{a.destinatario}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">{fmtMoeda(a.valor)}</td>
                        <td>
                          <span className={`badge ${a.status === 'CANCELADA' ? 'badge--danger' : 'badge--success'}`}>
                            {a.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => downloadTextFile(a.nome, a.xml)}
                          >
                            <Download size={13} /> Baixar
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

      {/* ABA 4: EVENTOS & INUTILIZAÇÃO */}
      {aba === 'EVENTOS' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 16,
          }}
        >
          <form className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={handleInutilizar}>
            <h3 className="text-sm font-bold m-0">Inutilizar Faixa de Numeração SEFAZ</h3>
            <p className="text-xs text-muted m-0">
              Utilize quando houver quebra/pulo de sequência de numeração de NF-e (55) ou NFC-e (65).
            </p>
            <div className="form-grid form-grid--2">
              <div>
                <label className="form-label">Modelo *</label>
                <select
                  className="form-input"
                  value={inutForm.modelo}
                  onChange={(e) => setInutForm({ ...inutForm, modelo: e.target.value })}
                >
                  <option value="55">55 — NF-e</option>
                  <option value="65">65 — NFC-e</option>
                </select>
              </div>
              <div>
                <label className="form-label">Série *</label>
                <input
                  type="number"
                  min={1}
                  required
                  className="form-input font-mono"
                  value={inutForm.serie}
                  onChange={(e) => setInutForm({ ...inutForm, serie: e.target.value })}
                />
              </div>
            </div>
            <div className="form-grid form-grid--2">
              <div>
                <label className="form-label">Número Inicial *</label>
                <input
                  type="number"
                  min={1}
                  required
                  className="form-input font-mono"
                  value={inutForm.numero_inicial}
                  onChange={(e) => setInutForm({ ...inutForm, numero_inicial: e.target.value })}
                />
              </div>
              <div>
                <label className="form-label">Número Final *</label>
                <input
                  type="number"
                  min={1}
                  required
                  className="form-input font-mono"
                  value={inutForm.numero_final}
                  onChange={(e) => setInutForm({ ...inutForm, numero_final: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="form-label">Justificativa Técnica (mín. 15 caracteres) *</label>
              <textarea
                rows={3}
                minLength={15}
                required
                className="form-input"
                placeholder="Ex: Numeração pulada devido a falha de sincronismo..."
                value={inutForm.justificativa}
                onChange={(e) => setInutForm({ ...inutForm, justificativa: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn--warning">
              Registrar Inutilização
            </button>
          </form>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold m-0">Histórico de Eventos Fiscais (CC-e, Cancelamentos &amp; Inutilizações)</h3>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Mod / Série / Faixa</th>
                    <th>Descrição / Justificativa</th>
                    <th>Protocolo</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center" style={{ padding: 24, color: 'var(--text-muted)' }}>
                        Nenhum evento fiscal registrado ainda.
                      </td>
                    </tr>
                  ) : (
                    eventos.map((ev) => (
                      <tr key={ev.id}>
                        <td className="text-xs font-mono">{fmtDataHora(ev.created_at)}</td>
                        <td>
                          <span
                            className={`badge ${
                              ev.tipo_evento === 'CANCELAMENTO'
                                ? 'badge--danger'
                                : ev.tipo_evento === 'CARTA_CORRECAO'
                                  ? 'badge--info'
                                  : 'badge--warning'
                            }`}
                          >
                            {ev.tipo_evento} #{ev.sequencia}
                          </span>
                        </td>
                        <td className="font-mono text-xs">
                          Mod {ev.modelo} • S{ev.serie} • {ev.numero_inicial}
                          {ev.numero_final !== ev.numero_inicial ? `–${ev.numero_final}` : ''}
                        </td>
                        <td className="text-xs">{ev.descricao}</td>
                        <td className="font-mono text-xs text-muted">{ev.protocolo}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 5: CERTIFICADO A1 & CONFIGURAÇÃO */}
      {aba === 'CONFIG' && (
        <AbaConfigCertificado
          config={config}
          onAtualizar={carregarTudo}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}

      {/* ── MODAL 1: CONFERÊNCIA TRIBUTÁRIA & EMISSÃO INDIVIDUAL (1 PEDIDO — CAMPOS UM ABAIXO DO OUTRO) ── */}
      {previewPedido && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setPreviewPedido(null)}>
          <div
            className="card"
            style={{
              width: '96%',
              maxWidth: 880,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              background: 'var(--bg-1)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 22px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <h3 className="text-base font-bold m-0 flex items-center gap-8">
                  <ShieldCheck size={19} className="text-success" /> Emissão Fiscal — {previewPedido.preview.pedido_codigo} ({previewPedido.modelo === '65' ? 'NFC-e 65' : 'NF-e 55'})
                </h3>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Destinatário: <strong>{previewPedido.preview.destinatario.nome}</strong> (UF {previewPedido.preview.destinatario.uf}) • Regime Emitente: <strong>{previewPedido.preview.emitente.regime}</strong>
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setPreviewPedido(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 22, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* TABELA DE ITENS */}
              <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>NCM</th>
                      <th>CFOP</th>
                      <th>CST/CSOSN</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>ICMS / Red.BC</th>
                      <th style={{ textAlign: 'right' }}>PIS/COFINS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewPedido.preview.itens || []).map((it) => (
                      <tr key={it.n_item}>
                        <td>
                          <div className="font-bold text-xs">{it.codigo} — {it.descricao}</div>
                          <div className="text-xs text-muted">{it.regra_origem}</div>
                        </td>
                        <td className="font-mono text-xs">{it.ncm}</td>
                        <td className="font-mono font-bold text-xs text-cyan">{it.cfop}</td>
                        <td className="font-mono text-xs">{it.cst_csosn}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">{it.qtd.toFixed(3)} {it.unidade}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs">{fmtMoeda(it.valor_total)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(it.v_icms)}
                          {it.p_red_bc > 0 && <div className="text-xs text-success">Red. {it.p_red_bc}%</div>}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(it.v_pis + it.v_cofins)}
                          <div className="text-xs text-muted">CST {it.cst_pis}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* SEÇÃO DE TRANSPORTE — UM CAMPO ABAIXO DO OUTRO, LIMPO E ESPAÇADO */}
              {previewPedido.modelo === '55' && (() => {
                const transpSel = transportadorasCat.find((t) => t.id === previewPedido.transportadora_id) || null
                const veicsSel = Array.isArray(transpSel?.veiculos) ? transpSel.veiculos : []
                const exigeTransp = ['0', '1'].includes(String(previewPedido.mod_frete))
                return (
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 10,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div className="text-xs font-bold uppercase text-cyan flex items-center gap-6">
                        <Truck size={15} /> Dados de Transporte, Transportadora &amp; Veículo
                      </div>
                      {exigeTransp && !previewPedido.transportadora_id && (
                        <span className="badge badge--warning">Selecione a Transportadora para liberar a NF-e</span>
                      )}
                    </div>

                    {/* 1. Modalidade do Frete */}
                    <div>
                      <label className="form-label">1. Modalidade do Frete *</label>
                      <select
                        className="form-input"
                        value={previewPedido.mod_frete}
                        onChange={(e) => setPreviewPedido({ ...previewPedido, mod_frete: e.target.value })}
                      >
                        <option value="0">0 — Por conta do Emitente (CIF)</option>
                        <option value="1">1 — Por conta do Destinatário (FOB)</option>
                        <option value="2">2 — Por conta de Terceiros</option>
                        <option value="3">3 — Transporte Próprio por conta do Remetente</option>
                        <option value="4">4 — Transporte Próprio por conta do Destinatário</option>
                        <option value="9">9 — Sem Ocorrência de Transporte</option>
                      </select>
                    </div>

                    {/* 2. Transportadora */}
                    <div>
                      <label className="form-label">
                        2. Transportadora {exigeTransp ? '* (Obrigatória para Frete 0 / 1)' : '(Opcional)'}
                      </label>
                      <select
                        className="form-input"
                        value={previewPedido.transportadora_id}
                        onChange={(e) => {
                          const tid = e.target.value
                          const tr = transportadorasCat.find((x) => x.id === tid) || null
                          const vPad = tr?.veiculos?.find((v) => v.padrao) || tr?.veiculos?.[0] || null
                          setPreviewPedido({
                            ...previewPedido,
                            transportadora_id: tid,
                            veiculo_id: vPad?.id || '',
                            veiculo_placa: vPad?.placa || tr?.placa_padrao || '',
                            veiculo_uf: vPad?.uf_placa || tr?.uf || previewPedido.veiculo_uf || 'SP',
                            transportadora_antt: vPad?.rntrc_antt || tr?.rntrc_antt || '',
                          })
                        }}
                      >
                        <option value="">-- Selecione a transportadora --</option>
                        {transportadorasCat.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.razao_social} {t.cnpj_cpf ? `(${t.cnpj_cpf})` : ''} {t.cidade ? `• ${t.cidade}/${t.uf}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 3. Veículo Cadastrado */}
                    <div>
                      <label className="form-label">3. Veículo Cadastrado na Transportadora</label>
                      <select
                        className="form-input"
                        value={previewPedido.veiculo_id}
                        disabled={!transpSel || veicsSel.length === 0}
                        onChange={(e) => {
                          const vid = e.target.value
                          const v = veicsSel.find((x) => x.id === vid) || null
                          setPreviewPedido({
                            ...previewPedido,
                            veiculo_id: vid,
                            veiculo_placa: v?.placa || previewPedido.veiculo_placa,
                            veiculo_uf: v?.uf_placa || previewPedido.veiculo_uf,
                            transportadora_antt: v?.rntrc_antt || transpSel?.rntrc_antt || previewPedido.transportadora_antt,
                          })
                        }}
                      >
                        <option value="">
                          {veicsSel.length === 0
                            ? 'Nenhum veículo cadastrado na frota (digite a placa abaixo)'
                            : '-- Escolha o veículo da frota --'}
                        </option>
                        {veicsSel.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.placa} ({v.uf_placa}) {v.modelo ? `— ${v.modelo}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* 4. Placa, UF, ANTT e Espécie Volumes */}
                    <div className="form-grid form-grid--3">
                      <div>
                        <label className="form-label">Placa do Veículo</label>
                        <input
                          className="form-input font-mono"
                          placeholder="Ex: JZA0982"
                          value={previewPedido.veiculo_placa}
                          onChange={(e) =>
                            setPreviewPedido({ ...previewPedido, veiculo_placa: e.target.value.toUpperCase() })
                          }
                        />
                      </div>
                      <div>
                        <label className="form-label">UF da Placa</label>
                        <input
                          maxLength={2}
                          className="form-input font-mono"
                          value={previewPedido.veiculo_uf}
                          onChange={(e) =>
                            setPreviewPedido({ ...previewPedido, veiculo_uf: e.target.value.toUpperCase() })
                          }
                        />
                      </div>
                      <div>
                        <label className="form-label">Código ANTT / Espécie</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="form-input font-mono"
                            placeholder="ANTT (opcional)"
                            value={previewPedido.transportadora_antt}
                            onChange={(e) =>
                              setPreviewPedido({ ...previewPedido, transportadora_antt: e.target.value.toUpperCase() })
                            }
                          />
                          <input
                            className="form-input"
                            style={{ width: 95 }}
                            placeholder="CAIXA"
                            value={previewPedido.especie_volumes}
                            onChange={(e) =>
                              setPreviewPedido({ ...previewPedido, especie_volumes: e.target.value.toUpperCase() })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* FATURA / DUPLICATAS */}
              {Array.isArray(previewPedido.preview.duplicatas) && previewPedido.preview.duplicatas.length > 0 && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span className="text-xs font-bold uppercase text-muted">Fatura / Duplicatas (Boleto):</span>
                  {previewPedido.preview.duplicatas.map((d) => (
                    <span key={d.numero} className="badge badge--neutral font-mono">
                      Parcela #{d.numero} • Venc. {fmtData(d.vencimento)} • {fmtMoeda(d.valor)}
                    </span>
                  ))}
                </div>
              )}

              {/* FRETE DESTACADO & OBSERVAÇÃO */}
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Frete Destacado na Nota (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input font-mono"
                    value={previewPedido.valor_frete}
                    onChange={(e) => setPreviewPedido({ ...previewPedido, valor_frete: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Informação Complementar Extra (Opcional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: Entregar na porta fundos / horário comercial..."
                    value={previewPedido.inf_complementar}
                    onChange={(e) => setPreviewPedido({ ...previewPedido, inf_complementar: e.target.value })}
                  />
                  {previewPedido.preview?.observacao_nf && (
                    <div
                      className="text-xs"
                      style={{
                        marginTop: 6,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'rgba(59,130,246,0.12)',
                        border: '1px solid rgba(59,130,246,0.35)',
                        color: '#bfdbfe',
                      }}
                    >
                      <strong>Obs. da NF já cadastrada no Pedido:</strong> {previewPedido.preview.observacao_nf}
                    </div>
                  )}
                </div>
              </div>

              {/* BARRA DE TOTAIS */}
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: 8,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div className="text-xs" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {Number(previewPedido.preview.totais.valor_desconto || 0) > 0 && (
                    <span style={{ color: '#fbbf24' }}>
                      Desconto: <strong className="font-mono">-{fmtMoeda(previewPedido.preview.totais.valor_desconto)}</strong>
                    </span>
                  )}
                  <span>BC ICMS: <strong className="font-mono">{fmtMoeda(previewPedido.preview.totais.valor_icms_base)}</strong></span>
                  <span>ICMS: <strong className="font-mono">{fmtMoeda(previewPedido.preview.totais.valor_icms)}</strong></span>
                  <span>PIS/COFINS: <strong className="font-mono">{fmtMoeda(previewPedido.preview.totais.valor_pis + previewPedido.preview.totais.valor_cofins)}</strong></span>
                  <span>IBS/CBS (2026): <strong className="font-mono">{fmtMoeda(Number(previewPedido.preview.totais.valor_ibs || 0) + Number(previewPedido.preview.totais.valor_cbs || 0))}</strong></span>
                </div>
                <div className="text-base font-bold font-mono text-cyan">
                  Total NF: {fmtMoeda(previewPedido.preview.totais.valor_total_nf + Number(previewPedido.valor_frete || 0))}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '16px 22px',
                background: 'var(--bg-2)',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <button type="button" className="btn btn--ghost" onClick={() => setPreviewPedido(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn--success" disabled={emitindo} onClick={confirmarEmissaoPedido}>
                <Send size={15} /> {emitindo ? 'Transmitindo...' : `Autorizar e Emitir ${previewPedido.modelo === '65' ? 'NFC-e' : 'NF-e (+ Boleto)'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: TELA DIFERENTE PARA FATURAMENTO EM LOTE (2+ PEDIDOS SELECIONADOS) ── */}
      {modalLote && (() => {
        const transpSel = transportadorasCat.find((t) => t.id === modalLote.transportadora_id) || null
        const veicsSel = Array.isArray(transpSel?.veiculos) ? transpSel.veiculos : []
        const totalLote = modalLote.pedidos.reduce((s, p) => s + Number(p.valor_total || 0), 0)
        const totalKgLote = modalLote.pedidos.reduce(
          (s, p) => s + Number(p.peso_separado_kg > 0 ? p.peso_separado_kg : p.peso_solicitado_kg || 0),
          0,
        )
        return (
          <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalLote(null)}>
            <div
              className="card"
              style={{
                width: '96%',
                maxWidth: 920,
                maxHeight: '92vh',
                display: 'flex',
                flexDirection: 'column',
                padding: 0,
                background: 'var(--bg-1)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 22px',
                  background: 'var(--bg-2)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div>
                  <h3 className="text-base font-bold m-0 flex items-center gap-8">
                    <Layers size={19} className="text-cyan" /> Faturamento em Lote — {modalLote.pedidos.length} Pedidos Selecionados
                  </h3>
                  <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                    Escolha a Modalidade de Frete, Transportadora e Veículo uma única vez: o sistema replica para todas as notas e abre a Impressão em Lote (NF + Boleto + Romaneio).
                  </div>
                </div>
                <button type="button" className="btn-icon" onClick={() => setModalLote(null)}>
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: 22, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* CONFIGURAÇÃO DE TRANSPORTE REPLICADA PARA TODAS AS NOTAS DO LOTE */}
                <div
                  style={{
                    padding: 18,
                    borderRadius: 10,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div className="text-xs font-bold uppercase text-cyan">
                    Transporte Padrão Copiado para Todos os {modalLote.pedidos.length} Pedidos do Lote
                  </div>

                  <div>
                    <label className="form-label">1. Modalidade do Frete *</label>
                    <select
                      className="form-input"
                      value={modalLote.mod_frete}
                      onChange={(e) => setModalLote({ ...modalLote, mod_frete: e.target.value })}
                    >
                      <option value="0">0 — Por conta do Emitente (CIF)</option>
                      <option value="1">1 — Por conta do Destinatário (FOB)</option>
                      <option value="3">3 — Transporte Próprio (Remetente)</option>
                      <option value="9">9 — Sem Ocorrência de Transporte</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label">2. Transportadora Padrão do Lote *</label>
                    <select
                      className="form-input"
                      value={modalLote.transportadora_id}
                      onChange={(e) => {
                        const tid = e.target.value
                        const tr = transportadorasCat.find((x) => x.id === tid) || null
                        const vPad = tr?.veiculos?.find((v) => v.padrao) || tr?.veiculos?.[0] || null
                        setModalLote({
                          ...modalLote,
                          transportadora_id: tid,
                          veiculo_id: vPad?.id || '',
                          veiculo_placa: vPad?.placa || tr?.placa_padrao || '',
                          veiculo_uf: vPad?.uf_placa || tr?.uf || 'SP',
                          transportadora_antt: vPad?.rntrc_antt || tr?.rntrc_antt || '',
                        })
                      }}
                    >
                      <option value="">-- Selecione a transportadora para copiar para todas as NFs --</option>
                      {transportadorasCat.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.razao_social} {t.cnpj_cpf ? `(${t.cnpj_cpf})` : ''} {t.cidade ? `• ${t.cidade}/${t.uf}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-grid form-grid--3">
                    <div>
                      <label className="form-label">3. Veículo da Frota</label>
                      <select
                        className="form-input"
                        value={modalLote.veiculo_id}
                        disabled={!transpSel || veicsSel.length === 0}
                        onChange={(e) => {
                          const v = veicsSel.find((x) => x.id === e.target.value) || null
                          setModalLote({
                            ...modalLote,
                            veiculo_id: e.target.value,
                            veiculo_placa: v?.placa || modalLote.veiculo_placa,
                            veiculo_uf: v?.uf_placa || modalLote.veiculo_uf,
                            transportadora_antt: v?.rntrc_antt || transpSel?.rntrc_antt || modalLote.transportadora_antt,
                          })
                        }}
                      >
                        <option value="">{veicsSel.length === 0 ? 'Sem veículos cadastrados' : '-- Escolha o caminhão --'}</option>
                        {veicsSel.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.placa} ({v.uf_placa}) {v.modelo ? `— ${v.modelo}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Placa do Veículo</label>
                      <input
                        className="form-input font-mono"
                        placeholder="Ex: JZA0982"
                        value={modalLote.veiculo_placa}
                        onChange={(e) => setModalLote({ ...modalLote, veiculo_placa: e.target.value.toUpperCase() })}
                      />
                    </div>
                    <div>
                      <label className="form-label">UF Placa</label>
                      <input
                        maxLength={2}
                        className="form-input font-mono"
                        value={modalLote.veiculo_uf}
                        onChange={(e) => setModalLote({ ...modalLote, veiculo_uf: e.target.value.toUpperCase() })}
                      />
                    </div>
                  </div>
                </div>

                {/* RELAÇÃO DOS PEDIDOS QUE SERÃO FATURADOS */}
                <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Status</th>
                        <th>Cliente / UF</th>
                        <th>Condição Pagto</th>
                        <th style={{ textAlign: 'right' }}>Peso / Caixas</th>
                        <th style={{ textAlign: 'right' }}>Valor NF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalLote.pedidos.map((p) => {
                        const badge = obterBadgeStatusFila(p.status)
                        const peso = p.peso_separado_kg > 0 ? p.peso_separado_kg : p.peso_solicitado_kg
                        return (
                          <tr key={p.id}>
                            <td className="font-mono font-bold text-xs text-cyan">{p.codigo}</td>
                            <td>
                              <span
                                className="badge"
                                style={{ ...badge.style, padding: '2px 8px', borderRadius: 999, fontSize: 10.5 }}
                              >
                                {badge.label}
                              </span>
                            </td>
                            <td className="font-bold text-xs">
                              {p.cliente_nome} ({p.cliente_uf})
                            </td>
                            <td className="text-xs">{p.forma_pagamento || 'À VISTA'}</td>
                            <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                              {Number(peso || 0).toFixed(2)} kg {p.qtd_caixas_separadas > 0 ? `(${p.qtd_caixas_separadas} cx)` : ''}
                            </td>
                            <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs text-success">
                              {fmtMoeda(p.valor_total)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: 8,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div className="text-xs">
                    Total de Notas a Emitir: <strong>{modalLote.pedidos.length} NF-e(s)</strong> • Peso Total:{' '}
                    <strong className="font-mono">{totalKgLote.toFixed(2)} kg</strong>
                  </div>
                  <div className="text-base font-bold font-mono text-cyan">
                    Total do Lote: {fmtMoeda(totalLote)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: '16px 22px',
                  background: 'var(--bg-2)',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                }}
              >
                <button type="button" className="btn btn--ghost" onClick={() => setModalLote(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn--success" disabled={emitindo} onClick={confirmarEmissaoLote}>
                  <Send size={15} />{' '}
                  {emitindo
                    ? 'Faturando Lote...'
                    : `Autorizar ${modalLote.pedidos.length} NF-es e Abrir Impressão em Lote (NF + Boleto + Romaneio)`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* MODAL CANCELAMENTO / CC-e */}
      {modalEvento && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalEvento(null)}>
          <div className="card" style={{ width: '96%', maxWidth: 520, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0">
                {modalEvento.tipo === 'CANCELAR' ? 'Cancelar Nota Fiscal' : 'Emitir Carta de Correção (CC-e)'} — Nº {modalEvento.nota.numero}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalEvento(null)}>
                <X size={18} />
              </button>
            </div>
            <form style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={confirmarEventoModal}>
              <div>
                <label className="form-label">
                  {modalEvento.tipo === 'CANCELAR'
                    ? 'Justificativa do Cancelamento (mín. 15 caracteres) *'
                    : 'Texto da Correção CC-e (mín. 15 caracteres) *'}
                </label>
                <textarea
                  required
                  minLength={15}
                  rows={4}
                  className="form-input"
                  value={modalEvento.texto}
                  onChange={(e) => setModalEvento({ ...modalEvento, texto: e.target.value })}
                  placeholder={
                    modalEvento.tipo === 'CANCELAR'
                      ? 'Ex: Erro no peso faturado do corte de picanha, será emitida nova NF-e.'
                      : 'Ex: Corrige-se a placa do veículo transportador nos dados adicionais para ABC1D23.'
                  }
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalEvento(null)}>
                  Voltar
                </button>
                <button
                  type="submit"
                  className={`btn ${modalEvento.tipo === 'CANCELAR' ? 'btn--danger' : 'btn--primary'}`}
                >
                  {modalEvento.tipo === 'CANCELAR' ? 'Confirmar Cancelamento' : 'Transmitir CC-e'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EMISSÃO AVULSA */}
      {modalAvulsa && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalAvulsa(false)}>
          <div className="card" style={{ width: '96%', maxWidth: 640, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0">Emissão Avulsa — NF-e (55) ou Cupom NFC-e (65)</h3>
              <button type="button" className="btn-icon" onClick={() => setModalAvulsa(false)}>
                <X size={18} />
              </button>
            </div>
            <form style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={handleEmitirAvulsa}>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Modelo *</label>
                  <select className="form-input" value={avulsaForm.modelo} onChange={(e) => setAvulsaForm({ ...avulsaForm, modelo: e.target.value })}>
                    <option value="65">65 — NFC-e (Cupom Consumidor 80mm)</option>
                    <option value="55">55 — NF-e (Danfe A4)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Forma de Pagamento</label>
                  <select
                    className="form-input"
                    value={avulsaForm.t_pag}
                    onChange={(e) => {
                      const map = { '17': '17 - PIX', '01': '01 - Dinheiro', '03': '03 - Crédito', '04': '04 - Débito', '15': '15 - Boleto' }
                      setAvulsaForm({ ...avulsaForm, t_pag: e.target.value, forma_pagamento_label: map[e.target.value] || '99 - Outros' })
                    }}
                  >
                    <option value="17">PIX</option>
                    <option value="01">Dinheiro</option>
                    <option value="03">Cartão de Crédito</option>
                    <option value="04">Cartão de Débito</option>
                    <option value="15">Boleto</option>
                  </select>
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Destinatário / Consumidor</label>
                  <input className="form-input" value={avulsaForm.destinatario_nome} onChange={(e) => setAvulsaForm({ ...avulsaForm, destinatario_nome: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">CPF / CNPJ</label>
                  <input className="form-input font-mono" placeholder="Opcional NFC-e" value={avulsaForm.destinatario_doc} onChange={(e) => setAvulsaForm({ ...avulsaForm, destinatario_doc: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="form-label">Selecionar Produto Cadastrado (Opcional)</label>
                <select
                  className="form-input"
                  value={avulsaForm.produto_id}
                  onChange={(e) => {
                    const p = produtosCat.find((x) => x.id === e.target.value)
                    if (p) {
                      setAvulsaForm({
                        ...avulsaForm,
                        produto_id: p.id,
                        codigo: p.codigo || '001',
                        descricao: p.descricao,
                        ncm: p.ncm || '02013000',
                        valor_unitario: String(p.valor_unitario || ''),
                      })
                    }
                  }}
                >
                  <option value="">-- Ou digite manualmente abaixo --</option>
                  {produtosCat.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} — {p.descricao} ({fmtMoeda(p.valor_unitario)}/kg)
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid form-grid--3">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Descrição do Item *</label>
                  <input required className="form-input" value={avulsaForm.descricao} onChange={(e) => setAvulsaForm({ ...avulsaForm, descricao: e.target.value })} placeholder="Ex: PICANHA BOVINA RESFRIADA" />
                </div>
                <div>
                  <label className="form-label">NCM *</label>
                  <input required className="form-input font-mono" value={avulsaForm.ncm} onChange={(e) => setAvulsaForm({ ...avulsaForm, ncm: e.target.value })} />
                </div>
              </div>
              {avulsaForm.modelo === '55' && (() => {
                const trAv = transportadorasCat.find((t) => t.id === avulsaForm.transportadora_id) || null
                const veicsAv = Array.isArray(trAv?.veiculos) ? trAv.veiculos : []
                const exige = ['0', '1'].includes(String(avulsaForm.mod_frete))
                return (
                  <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label className="form-label">1. Modalidade Frete *</label>
                      <select
                        className="form-input"
                        value={avulsaForm.mod_frete}
                        onChange={(e) => setAvulsaForm({ ...avulsaForm, mod_frete: e.target.value })}
                      >
                        <option value="0">0 — Emitente (CIF)</option>
                        <option value="1">1 — Destinatário (FOB)</option>
                        <option value="3">3 — Próprio Remetente</option>
                        <option value="9">9 — Sem Frete</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">2. Transportadora {exige ? '*' : '(Opcional)'}</label>
                      <select
                        className="form-input"
                        required={exige}
                        value={avulsaForm.transportadora_id}
                        onChange={(e) => {
                          const tid = e.target.value
                          const tr = transportadorasCat.find((x) => x.id === tid) || null
                          const vPad = tr?.veiculos?.find((v) => v.padrao) || tr?.veiculos?.[0] || null
                          setAvulsaForm({
                            ...avulsaForm,
                            transportadora_id: tid,
                            veiculo_id: vPad?.id || '',
                            veiculo_placa: vPad?.placa || tr?.placa_padrao || '',
                            veiculo_uf: vPad?.uf_placa || tr?.uf || 'SP',
                          })
                        }}
                      >
                        <option value="">-- Selecione --</option>
                        {transportadorasCat.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.razao_social}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-grid form-grid--3">
                      <div>
                        <label className="form-label">Veículo da Frota</label>
                        <select
                          className="form-input"
                          value={avulsaForm.veiculo_id}
                          disabled={veicsAv.length === 0}
                          onChange={(e) => {
                            const v = veicsAv.find((x) => x.id === e.target.value)
                            setAvulsaForm({
                              ...avulsaForm,
                              veiculo_id: e.target.value,
                              veiculo_placa: v?.placa || avulsaForm.veiculo_placa,
                              veiculo_uf: v?.uf_placa || avulsaForm.veiculo_uf,
                            })
                          }}
                        >
                          <option value="">{veicsAv.length === 0 ? 'Livre' : '-- Escolha --'}</option>
                          {veicsAv.map((v) => (
                            <option key={v.id} value={v.id}>{v.placa} ({v.uf_placa})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Placa</label>
                        <input
                          className="form-input font-mono"
                          value={avulsaForm.veiculo_placa}
                          onChange={(e) => setAvulsaForm({ ...avulsaForm, veiculo_placa: e.target.value.toUpperCase() })}
                        />
                      </div>
                      <div>
                        <label className="form-label">UF</label>
                        <input
                          maxLength={2}
                          className="form-input font-mono"
                          value={avulsaForm.veiculo_uf}
                          onChange={(e) => setAvulsaForm({ ...avulsaForm, veiculo_uf: e.target.value.toUpperCase() })}
                        />
                      </div>
                    </div>
                  </div>
                )
              })()}
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Quantidade (kg/un) *</label>
                  <input required type="number" step="0.001" min="0.001" className="form-input font-mono" value={avulsaForm.qtd} onChange={(e) => setAvulsaForm({ ...avulsaForm, qtd: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Valor Unitário (R$) *</label>
                  <input required type="number" step="0.01" min="0.01" className="form-input font-mono" value={avulsaForm.valor_unitario} onChange={(e) => setAvulsaForm({ ...avulsaForm, valor_unitario: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalAvulsa(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--success" disabled={emitindo}>
                  <Send size={14} /> {emitindo ? 'Emitindo...' : 'Emitir Documento Fiscal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE IMPRESSÃO INDIVIDUAL (1 NOTA: DANFE + BOLETO + ROMANEIO) */}
      <DanfePrintModal
        nota={notaDanfe}
        onClose={() => setNotaDanfe(null)}
        onBaixarXml={baixarXmlNota}
      />

      {/* MODAL DE IMPRESSÃO EM LOTE (2+ NOTAS: AGRUPADO CLIENTE POR CLIENTE) */}
      <PacoteLotePrintModal
        notas={pacoteLoteNotas}
        onClose={() => setPacoteLoteNotas(null)}
        onAbrirNotaIndividual={(n) => {
          setPacoteLoteNotas(null)
          setNotaDanfe(n)
        }}
      />
    </div>
  )
}
