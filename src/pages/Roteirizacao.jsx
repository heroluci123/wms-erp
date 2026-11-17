import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  Truck,
  Plus,
  Route as RouteIcon,
  Calendar,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Printer,
  Barcode,
  QrCode,
  Settings,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  MapPin,
  Copy,
  RefreshCw,
  DollarSign,
  RotateCcw,
  X,
  ShieldAlert,
  Navigation,
  Thermometer,
  Clock,
  Lock,
  Gauge,
  Flag,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { temAlgumaPermissao } from '../utils/permissoes'
import { roteirizacaoQueries } from '../queries/roteirizacao'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { RomaneioConsolidadoRotaPrint } from '../components/shared/RomaneioConsolidadoRotaPrint'

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg`
const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0].split(' ')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const hojeIso = () => {
  const dt = new Date()
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

const STATUS_EMB_BADGE = {
  PLANEJADO: { label: 'ABERTO', cls: 'badge--info', cor: '#38bdf8' },
  EM_CARREGAMENTO: { label: 'CARREGANDO', cls: 'badge--warning', cor: '#f59e0b' },
  EM_ROTA: { label: 'EM ROTA', cls: 'badge--purple', cor: '#a78bfa' },
  CONCLUIDO: { label: 'FINALIZADO', cls: 'badge--success', cor: '#22c55e' },
  CANCELADO: { label: 'CANCELADO', cls: 'badge--danger', cor: '#ef4444' },
}

const STATUS_STOP_BADGE = {
  PENDENTE: { label: 'Aguardando', cls: 'badge--neutral' },
  A_CAMINHO: { label: 'A Caminho', cls: 'badge--warning' },
  NO_CLIENTE: { label: 'No Cliente', cls: 'badge--info' },
  ENTREGUE: { label: 'Entregue ✅', cls: 'badge--success' },
  DEVOLVIDA: { label: 'Recusa / Voltou', cls: 'badge--danger' },
}

function calcOcupacaoInfo(pesoKg, capKg, tolPct = 10) {
  const peso = Number(pesoKg || 0)
  const cap = Number(capKg || 0)
  const tol = Number(tolPct ?? 10)
  const max = cap > 0 ? Number((cap * (1 + tol / 100)).toFixed(2)) : 0
  const pct = cap > 0 ? Math.round((peso / cap) * 100) : 0
  const restante = cap > 0 ? Number((cap - peso).toFixed(2)) : 0
  const excedeuMax = cap > 0 && peso > max + 0.001
  const dentroTolerancia = cap > 0 && peso > cap + 0.001 && !excedeuMax
  const barPct = cap > 0 ? Math.min(100, Math.round((peso / cap) * 100)) : 0
  const cor = excedeuMax ? '#ef4444' : dentroTolerancia || pct >= 85 ? '#f59e0b' : '#22c55e'
  return { peso, cap, tol, max, pct, restante, excedeuMax, dentroTolerancia, barPct, cor }
}

export function Roteirizacao() {
  const navigate = useNavigate()
  const { operador, toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()

  const podeGerir = temAlgumaPermissao(operador, ['roteirizacao', 'pedidos', 'transportadoras'])
  const podeCarregar = temAlgumaPermissao(operador, ['roteirizacao_carregamento', 'saida', 'expedicao', 'roteirizacao'])
  const podeAcessar = podeGerir || podeCarregar

  const [grupoLista, setGrupoLista] = useState('ABERTO') // 'ABERTO' | 'HISTORICO'
  const [embarques, setEmbarques] = useState([])
  const [configModulos, setConfigModulos] = useState({
    rastreio_motorista_ativo: true,
    impressao_romaneio_padrao: 'OPCAO_B',
  })
  const [rotas, setRotas] = useState([])
  const [transportadoras, setTransportadoras] = useState([])
  const [tiposVeiculo, setTiposVeiculo] = useState([])
  const [loading, setLoading] = useState(false)

  // Embarque aberto
  const [embarqueAtivo, setEmbarqueAtivo] = useState(null)
  const [abaDetalhe, setAbaDetalhe] = useState(() => (podeCarregar && !podeGerir ? 'CARREGAMENTO' : 'MONTAGEM'))

  // Edição do embarque aberto (sem campo manual de NFs)
  const [formDados, setFormDados] = useState({
    titulo: '',
    data_embarque: hojeIso(),
    tipo_veiculo_id: '',
    horario_saida: '',
    rota_id: '',
    transportadora_id: '',
    motorista_nome: '',
    veiculo_placa: '',
    modalidade_impressao: 'OPCAO_B',
    observacoes: '',
  })

  // Carregamento bipado + Temperatura do Baú
  const [eanBipe, setEanBipe] = useState('')
  const [erroBipe, setErroBipe] = useState('')
  const [ultimoBipeInfo, setUltimoBipeInfo] = useState(null)
  const [bipando, setBipando] = useState(false)
  const [tempManual, setTempManual] = useState('')
  const [modalTempBipe, setModalTempBipe] = useState({ open: false, eanPendente: '', valor: '' })
  const scannerRef = useRef(null)
  const tempInputRef = useRef(null)

  // Modais: Novo Embarque, Puxar Pedidos, Config, QR Code, Impressão
  const [modalNovoOpen, setModalNovoOpen] = useState(false)
  const [novoForm, setNovoForm] = useState({
    data_embarque: hojeIso(),
    titulo: '',
    tipo_veiculo_id: '',
    horario_saida: '05:30',
    rota_id: '',
    transportadora_id: '',
    motorista_nome: '',
    veiculo_placa: '',
    modalidade_impressao: 'OPCAO_B',
    observacoes: '',
    pedido_ids: [],
  })
  const [pedidosElegiveis, setPedidosElegiveis] = useState([])
  const [loadingElegiveis, setLoadingElegiveis] = useState(false)
  const [modalPedidosOpen, setModalPedidosOpen] = useState(false)
  const [pedidosModalSel, setPedidosModalSel] = useState([])
  const [somenteProntos, setSomenteProntos] = useState(false)

  const [modalConfigOpen, setModalConfigOpen] = useState(false)
  const [modalQrData, setModalQrData] = useState({ open: false, dataUrl: '', url: '' })
  const [printCfg, setPrintCfg] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const carregarLista = useCallback(async () => {
    if (!apiAtiva || !podeAcessar) return
    setLoading(true)
    try {
      const [resEmb, resRotas, resTransp, resVeic] = await Promise.all([
        roteirizacaoQueries.listarEmbarques(grupoLista),
        podeGerir ? cadastrosQueries.listarRotas().catch(() => []) : Promise.resolve([]),
        podeGerir ? cadastrosQueries.listarTransportadoras().catch(() => []) : Promise.resolve([]),
        cadastrosQueries.listarTiposVeiculo().catch(() => []),
      ])
      setEmbarques(resEmb?.data || [])
      if (resEmb?.config) setConfigModulos(resEmb.config)
      setRotas(resRotas || [])
      setTransportadoras(resTransp || [])
      setTiposVeiculo(resVeic || [])
    } catch (err) {
      toastError('Erro ao carregar embarques', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, podeAcessar, podeGerir, grupoLista, toastError])

  const abrirEmbarque = useCallback(
    async (id) => {
      try {
        const res = await roteirizacaoQueries.detalhesEmbarque(id)
        const d = res?.data
        if (res?.config) setConfigModulos(res.config)
        setEmbarqueAtivo(d)
        setFormDados({
          titulo: d.titulo || '',
          data_embarque: d.data_embarque ? String(d.data_embarque).slice(0, 10) : hojeIso(),
          tipo_veiculo_id: d.tipo_veiculo_id || '',
          horario_saida: d.horario_saida || '',
          rota_id: d.rota_id || '',
          transportadora_id: d.transportadora_id || '',
          motorista_nome: d.motorista_nome || '',
          veiculo_placa: d.veiculo_placa || '',
          modalidade_impressao: d.modalidade_impressao || 'OPCAO_B',
          observacoes: d.observacoes || '',
        })
        setTempManual(d.temperatura_bau !== null && d.temperatura_bau !== undefined ? String(d.temperatura_bau) : '')
        setErroBipe('')
        if (!podeGerir && podeCarregar) {
          setAbaDetalhe('CARREGAMENTO')
        }
      } catch (err) {
        toastError('Erro ao abrir embarque', err.message)
      }
    },
    [podeGerir, podeCarregar, toastError],
  )

  useEffect(() => {
    carregarLista()
  }, [carregarLista])

  useEffect(() => {
    if (embarqueAtivo && abaDetalhe === 'CARREGAMENTO') {
      setTimeout(() => scannerRef.current?.focus(), 70)
    }
  }, [embarqueAtivo?.id, abaDetalhe])

  useEffect(() => {
    if (!autoRefresh || !embarqueAtivo?.id) return undefined
    const id = setInterval(() => {
      abrirEmbarque(embarqueAtivo.id)
    }, 10000)
    return () => clearInterval(id)
  }, [autoRefresh, embarqueAtivo?.id, abrirEmbarque])

  const carregarPedidosPorData = useCallback(
    async (dataIso, embarqueId = null) => {
      setLoadingElegiveis(true)
      try {
        const disp = await roteirizacaoQueries.listarPedidosDisponiveis({
          data_embarque: dataIso,
          embarque_id: embarqueId || undefined,
        })
        setPedidosElegiveis(disp || [])
      } catch (err) {
        toastError('Erro ao filtrar pedidos por data', err.message)
        setPedidosElegiveis([])
      } finally {
        setLoadingElegiveis(false)
      }
    },
    [toastError],
  )

  const abrirModalNovoEmbarque = async () => {
    const dataInicial = hojeIso()
    const veiculoPadraoId = tiposVeiculo[0]?.id || ''
    setNovoForm({
      data_embarque: dataInicial,
      titulo: '',
      tipo_veiculo_id: veiculoPadraoId,
      horario_saida: '05:30',
      rota_id: '',
      transportadora_id: '',
      motorista_nome: '',
      veiculo_placa: '',
      modalidade_impressao: configModulos.impressao_romaneio_padrao || 'OPCAO_B',
      observacoes: '',
      pedido_ids: [],
    })
    setModalNovoOpen(true)
    await carregarPedidosPorData(dataInicial, null)
  }

  const veiculoSelecionadoNovo = useMemo(
    () => tiposVeiculo.find((v) => v.id === novoForm.tipo_veiculo_id) || null,
    [tiposVeiculo, novoForm.tipo_veiculo_id],
  )

  const pesoSelecionadoNovo = useMemo(() => {
    const setIds = new Set(novoForm.pedido_ids)
    return pedidosElegiveis
      .filter((p) => setIds.has(p.id))
      .reduce((acc, p) => acc + Number(p.peso_carga_kg || p.total_kg_solicitado || 0), 0)
  }, [pedidosElegiveis, novoForm.pedido_ids])

  const ocupacaoNovoModal = useMemo(
    () =>
      calcOcupacaoInfo(
        pesoSelecionadoNovo,
        veiculoSelecionadoNovo?.capacidade_kg || 0,
        veiculoSelecionadoNovo?.tolerancia_pct ?? 10,
      ),
    [pesoSelecionadoNovo, veiculoSelecionadoNovo],
  )

  const handleCriarEmbarque = async (e) => {
    e.preventDefault()
    if (!novoForm.tipo_veiculo_id) {
      return toastWarning('Selecione um Tipo de Veículo cadastrado em Comercial & Estrutura.')
    }
    if (ocupacaoNovoModal.excedeuMax) {
      return toastError(
        'Limite de Peso Excedido',
        `A carga (${fmtKg(pesoSelecionadoNovo)}) ultrapassa o teto com tolerância de +${ocupacaoNovoModal.tol}% (${fmtKg(ocupacaoNovoModal.max)}).`,
      )
    }
    try {
      const res = await roteirizacaoQueries.criarEmbarque({
        ...novoForm,
        rota_id: novoForm.rota_id || null,
        transportadora_id: novoForm.transportadora_id || null,
        tipo_veiculo_id: novoForm.tipo_veiculo_id || null,
      })
      toastSuccess(`Embarque ${res.codigo} criado!`)
      setModalNovoOpen(false)
      await carregarLista()
      await abrirEmbarque(res.id)
    } catch (err) {
      toastError('Erro ao criar embarque', err.message)
    }
  }

  const handleExcluirEmbarque = async (e, emb) => {
    e.stopPropagation()
    const ok = await confirmar({
      title: `Excluir Embarque ${emb.codigo}`,
      message: `Deseja remover o roteiro "${emb.titulo || emb.codigo}"? Os pedidos vinculados ficarão disponíveis novamente para roteirização.`,
      type: 'error',
      confirmLabel: 'Excluir Roteiro',
    })
    if (!ok) return
    try {
      await roteirizacaoQueries.excluirEmbarque(emb.id)
      toastSuccess(`Embarque ${emb.codigo} removido.`)
      carregarLista()
    } catch (err) {
      toastError('Erro ao excluir', err.message)
    }
  }

  const handleSalvarDadosEmbarque = async (e) => {
    e.preventDefault()
    try {
      await roteirizacaoQueries.atualizarEmbarque(embarqueAtivo.id, {
        ...formDados,
        rota_id: formDados.rota_id || null,
        transportadora_id: formDados.transportadora_id || null,
        tipo_veiculo_id: formDados.tipo_veiculo_id || null,
      })
      toastSuccess('Dados do roteiro atualizados!')
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro ao salvar', err.message)
    }
  }

  const abrirModalAdicionarPedidos = async () => {
    const dataEmb = embarqueAtivo?.data_embarque ? String(embarqueAtivo.data_embarque).slice(0, 10) : hojeIso()
    setPedidosModalSel([])
    setModalPedidosOpen(true)
    await carregarPedidosPorData(dataEmb, embarqueAtivo.id)
  }

  const pesoSelecionadoAddModal = useMemo(() => {
    const setIds = new Set(pedidosModalSel)
    const addKg = pedidosElegiveis
      .filter((p) => setIds.has(p.id))
      .reduce((acc, p) => acc + Number(p.peso_carga_kg || p.total_kg_solicitado || 0), 0)
    const atualKg = Number(embarqueAtivo?.resumo?.peso_carga_kg || 0)
    return atualKg + addKg
  }, [pedidosElegiveis, pedidosModalSel, embarqueAtivo?.resumo?.peso_carga_kg])

  const ocupacaoAddModal = useMemo(
    () =>
      calcOcupacaoInfo(
        pesoSelecionadoAddModal,
        embarqueAtivo?.capacidade_kg || 0,
        embarqueAtivo?.tolerancia_pct ?? 10,
      ),
    [pesoSelecionadoAddModal, embarqueAtivo?.capacidade_kg, embarqueAtivo?.tolerancia_pct],
  )

  const handleConfirmarAddPedidos = async () => {
    if (pedidosModalSel.length === 0) return toastWarning('Selecione ao menos 1 pedido.')
    if (ocupacaoAddModal.excedeuMax) {
      return toastError(
        'Capacidade Excedida',
        `A soma com os pedidos selecionados (${fmtKg(pesoSelecionadoAddModal)}) ultrapassa o limite máximo com tolerância (${fmtKg(ocupacaoAddModal.max)}).`,
      )
    }
    try {
      await roteirizacaoQueries.adicionarParadas(embarqueAtivo.id, pedidosModalSel)
      toastSuccess(`${pedidosModalSel.length} pedido(s) adicionados ao roteiro!`)
      setModalPedidosOpen(false)
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleMoverParada = async (idx, dir) => {
    const paradas = [...(embarqueAtivo.paradas || [])]
    const alvo = idx + dir
    if (alvo < 0 || alvo >= paradas.length) return
    const temp = paradas[idx]
    paradas[idx] = paradas[alvo]
    paradas[alvo] = temp
    try {
      await roteirizacaoQueries.reordenarParadas(
        embarqueAtivo.id,
        paradas.map((p) => p.pedido_id),
      )
      await abrirEmbarque(embarqueAtivo.id)
    } catch (err) {
      toastError('Erro ao reordenar', err.message)
    }
  }

  const handleRemoverParada = async (parada) => {
    const ok = await confirmar({
      title: `Remover ${parada.pedido_codigo} do Roteiro`,
      message: `Remover o pedido de ${parada.cliente} deste embarque?`,
      type: 'warning',
      confirmLabel: 'Remover do Roteiro',
    })
    if (!ok) return
    try {
      await roteirizacaoQueries.removerParada(embarqueAtivo.id, parada.pedido_id)
      toastSuccess('Pedido removido do roteiro.')
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const executarBipeComTemperatura = async (cod, tempVal = null) => {
    setErroBipe('')
    setBipando(true)
    try {
      const res = await roteirizacaoQueries.carregarCaixa(embarqueAtivo.id, cod, tempVal)
      setUltimoBipeInfo(res.caixa)
      toastSuccess(
        `Carregada: ${res.caixa.produto_descricao}`,
        `Parada #${res.caixa.ordem_parada} (${res.caixa.pedido_codigo}) • ${fmtKg(res.caixa.peso_kg)}`,
      )
      setEanBipe('')
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      setErroBipe(err.message)
      toastWarning('Erro ao bipar caixa', err.message)
    } finally {
      setBipando(false)
      setTimeout(() => scannerRef.current?.focus(), 40)
    }
  }

  const handleBiparCaixaCarregamento = async (e) => {
    e.preventDefault()
    const cod = String(eanBipe || '').trim()
    if (!cod) return

    const exigeTempNaPrimeira =
      embarqueAtivo?.modalidade_impressao === 'OPCAO_A' &&
      Number(embarqueAtivo?.resumo?.caixas_carregadas || 0) === 0 &&
      (embarqueAtivo?.temperatura_bau === null || embarqueAtivo?.temperatura_bau === undefined)

    if (exigeTempNaPrimeira) {
      setModalTempBipe({ open: true, eanPendente: cod, valor: tempManual || '-18' })
      setTimeout(() => tempInputRef.current?.focus(), 60)
      return
    }
    await executarBipeComTemperatura(cod, null)
  }

  const handleConfirmarModalTemperatura = async (e) => {
    e.preventDefault()
    const val = String(modalTempBipe.valor || '').trim().replace(',', '.')
    const num = Number(val)
    if (!val || Number.isNaN(num) || num < -50 || num > 50) {
      return toastWarning('Informe uma temperatura válida em °C (ex: -18, 2.5).')
    }
    const ean = modalTempBipe.eanPendente
    setModalTempBipe({ open: false, eanPendente: '', valor: '' })
    await executarBipeComTemperatura(ean, num)
  }

  const handleSalvarTempManual = async () => {
    try {
      const val = String(tempManual || '').trim()
      await roteirizacaoQueries.atualizarTemperaturaBau(embarqueAtivo.id, val === '' ? null : val)
      toastSuccess('Temperatura do baú atualizada!')
      await abrirEmbarque(embarqueAtivo.id)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleDespachar = async () => {
    const res = embarqueAtivo?.resumo || {}
    const paradas = embarqueAtivo?.paradas || []
    const semSeparacao = paradas.filter((p) => Number(p.caixas_total || 0) === 0)
    const faltantes = Number(res.total_caixas || 0) - Number(res.caixas_carregadas || 0)

    if (paradas.length === 0) {
      return toastWarning('Adicione ao menos 1 pedido ao roteiro antes de despachar.')
    }
    if (semSeparacao.length > 0) {
      return toastWarning(
        'Separação Pendente',
        `Não é possível despachar: o(s) pedido(s) ${semSeparacao.map((p) => p.pedido_codigo).join(', ')} ainda não têm caixas pesadas/separadas na câmara.`,
      )
    }
    if (faltantes > 0 || Number(res.total_caixas || 0) === 0) {
      return toastWarning(
        'Carregamento Incompleto',
        `Para despachar o veículo, todas as caixas devem estar bipadas. Ainda falta(m) ${faltantes} caixa(s) para bipar.`,
      )
    }

    const ok = await confirmar({
      title: `Concluir Carregamento & Despachar ${embarqueAtivo.codigo}`,
      message: `Todas as ${res.total_caixas} caixas foram bipadas (${fmtKg(res.peso_real_kg)}). Confirmar expedição e colocar o veículo EM ROTA?`,
      confirmLabel: 'Expedir e Iniciar Rota',
    })
    if (!ok) return

    try {
      const r = await roteirizacaoQueries.despacharEmbarque(embarqueAtivo.id, {
        veiculo_placa: formDados.veiculo_placa,
        motorista_nome: formDados.motorista_nome,
      })
      toastSuccess(
        'Veículo Liberado / Em Rota! 🚚',
        r.expedidosAgora > 0 ? `${r.expedidosAgora} pedido(s) expedido(s) automaticamente.` : 'Status atualizado para EM ROTA.',
      )
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro ao despachar', err.message)
    }
  }

  const handleFinalizarRota = async () => {
    const ok = await confirmar({
      title: `Finalizar Rota ${embarqueAtivo.codigo}`,
      message: `Deseja concluir e encerrar a rota "${embarqueAtivo.titulo || embarqueAtivo.codigo}"? Ela será movida para o Histórico (Finalizados).`,
      type: 'info',
      confirmLabel: 'Finalizar Rota',
    })
    if (!ok) return
    try {
      await roteirizacaoQueries.finalizarRota(embarqueAtivo.id)
      toastSuccess('Rota Finalizada!', `${embarqueAtivo.codigo} encerrada com sucesso e movida para o Histórico.`)
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro ao finalizar rota', err.message)
    }
  }

  const handleImprimirRomaneioRota = async (modoForcado = null) => {
    const emb = embarqueAtivo
    if (!emb || (emb.paradas || []).length === 0) {
      return toastWarning('Adicione ao menos 1 pedido ao roteiro antes de imprimir.')
    }
    const modalidade = emb.modalidade_impressao || configModulos.impressao_romaneio_padrao || 'OPCAO_B'
    const resumo = emb.resumo || {}
    const semPesoReal = Number(resumo.pedidos_sem_peso_real || 0)

    if (modoForcado === 'OPCAO_A_PREVIA' || modoForcado === 'ANTES_BIPAGEM') {
      setPrintCfg({ embarque: emb, modo: modoForcado })
      return
    }
    if (modoForcado === 'OPCAO_A_OFICIAL' || modoForcado === 'POS_BIPAGEM') {
      if (semPesoReal > 0) {
        const ok = await confirmar({
          title: 'Aviso: Pedido ainda em Separação',
          message: `Existem ${semPesoReal} pedido(s) ainda sem separação finalizada (aparecerão como "A definir"). Deseja imprimir assim mesmo?`,
          type: 'warning',
          confirmLabel: 'Imprimir',
        })
        if (!ok) return
      }
      setPrintCfg({ embarque: emb, modo: modoForcado })
      return
    }

    if (semPesoReal > 0) {
      const ok = await confirmar({
        title: 'Aviso: Pedido ainda sem Pesagem Exata',
        message: `Existem ${semPesoReal} pedido(s) neste roteiro ainda em separação (peso/caixas exatas ainda não separados). Deseja imprimir mesmo assim (mostrará "A definir" nesses itens)?`,
        type: 'warning',
        confirmLabel: 'Imprimir Romaneio',
      })
      if (!ok) return
      setPrintCfg({
        embarque: emb,
        modo: modalidade === 'OPCAO_A' ? 'OPCAO_A_PREVIA' : 'OPCAO_B',
      })
      return
    }

    if (modalidade === 'OPCAO_A') {
      const tudoCarregado = Number(resumo.total_caixas || 0) > 0 && resumo.caixas_carregadas >= resumo.total_caixas
      setPrintCfg({
        embarque: emb,
        modo: tudoCarregado ? 'OPCAO_A_OFICIAL' : 'OPCAO_A_PREVIA',
      })
    } else {
      setPrintCfg({ embarque: emb, modo: 'OPCAO_B' })
    }
  }

  const abrirModalQrMotorista = async () => {
    if (!embarqueAtivo?.qr_token) return
    const base = `${window.location.origin}${window.location.pathname}`
    const url = `${base}#/motorista/${embarqueAtivo.qr_token}`
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 2 })
      setModalQrData({ open: true, dataUrl, url })
    } catch (err) {
      toastError('Erro ao gerar QR Code', err.message)
    }
  }

  const handleToggleConfig = async (patch) => {
    try {
      const res = await roteirizacaoQueries.salvarConfigModulos(patch)
      setConfigModulos((prev) => ({ ...prev, ...(res.data || patch) }))
      toastSuccess('Configuração salva!')
      if (embarqueAtivo) await abrirEmbarque(embarqueAtivo.id)
    } catch (err) {
      toastError('Erro ao salvar configuração', err.message)
    }
  }

  const handleStatusParadaManual = async (parada, nextStatus) => {
    let pagConf = parada.pagamento_confirmado
    if (parada.pagamento_na_entrega && nextStatus === 'ENTREGUE' && !pagConf) {
      const okPg = await confirmar({
        title: `Pagamento na Entrega — ${parada.pedido_codigo}`,
        message: `Este pedido possui Pagamento na Entrega (${fmtMoeda(parada.valor_total)}). Confirma que o recebimento (PIX/Cartão/Dinheiro) foi efetuado?`,
        type: 'warning',
        confirmLabel: 'Sim, Pagamento Recebido',
      })
      if (!okPg) return
      pagConf = true
    }
    try {
      await roteirizacaoQueries.atualizarStatusParada(embarqueAtivo.id, parada.pedido_id, {
        status_entrega: nextStatus,
        pagamento_confirmado: pagConf,
      })
      toastSuccess(`Parada #${parada.ordem_parada} atualizada!`)
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  if (!podeAcessar) {
    return (
      <div className="page-container">
        <div className="card" style={{ maxWidth: 520, margin: '40px auto', padding: 32, textAlign: 'center' }}>
          <ShieldAlert size={44} className="text-warning" style={{ margin: '0 auto 12px' }} />
          <h2>Acesso Restrito</h2>
          <p className="text-muted">Seu usuário não possui permissão para acessar Roteirização / Carregamento.</p>
        </div>
      </div>
    )
  }

  if (!apiAtiva) {
    return (
      <div className="page-container">
        <ApiModeRequiredBanner modulo="Roteirização / Central de Embarques" />
      </div>
    )
  }

  const resumoAtivo = embarqueAtivo?.resumo || {}
  const pesoCargaAtivo = Number(resumoAtivo.peso_carga_kg || resumoAtivo.peso_bruto_kg || resumoAtivo.peso_real_kg || resumoAtivo.peso_pedido_kg || 0)
  const ocupacaoAtivo = calcOcupacaoInfo(pesoCargaAtivo, embarqueAtivo?.capacidade_kg || 0, embarqueAtivo?.tolerancia_pct ?? 10)
  const podeRastrearEntregas = Boolean(embarqueAtivo && ['EM_ROTA', 'CONCLUIDO'].includes(embarqueAtivo.status))
  const todosSeparados = Boolean(
    embarqueAtivo &&
      (embarqueAtivo.paradas || []).length > 0 &&
      !(embarqueAtivo.paradas || []).some((p) => Number(p.caixas_total || 0) === 0),
  )
  const tudoBipado = Boolean(
    todosSeparados &&
      Number(resumoAtivo.total_caixas || 0) > 0 &&
      Number(resumoAtivo.caixas_carregadas || 0) >= Number(resumoAtivo.total_caixas || 0),
  )

  return (
    <div className="page-container">
      {/* VISÃO 1: CENTRAL DE EMBARQUES (GRID DE CARDS) */}
      {!embarqueAtivo && (
        <>
          <div
            className="page-header no-print"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
          >
            <div>
              <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Truck size={26} /> Central de Embarques &amp; Roteirização
              </h1>
              <p className="page-subtitle">
                Selecione um embarque em aberto para carregar/bipar ou crie um novo roteiro de entregas
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn ${grupoLista === 'ABERTO' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setGrupoLista('ABERTO')}
              >
                📂 Em Aberto
              </button>
              <button
                type="button"
                className={`btn ${grupoLista === 'HISTORICO' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setGrupoLista('HISTORICO')}
              >
                📜 Histórico (Finalizados)
              </button>
              {podeGerir && (
                <>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => navigate('/tipos-veiculo')}
                    title="Cadastrar tipos de carro e limites de peso em Estrutura"
                  >
                    <Gauge size={15} /> Veículos ({tiposVeiculo.length})
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={() => setModalConfigOpen(true)}>
                    <Settings size={15} /> Config. ({configModulos.rastreio_motorista_ativo ? 'QR Ativo' : 'Manual'})
                  </button>
                  <button type="button" className="btn btn--primary" onClick={abrirModalNovoEmbarque}>
                    <Plus size={16} /> + Criar Embarque
                  </button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div className="card" style={{ padding: 40, textAlign: 'center' }}>
              Carregando central de embarques...
            </div>
          ) : embarques.length === 0 ? (
            <div className="card text-muted" style={{ padding: 44, textAlign: 'center' }}>
              <Truck size={42} style={{ opacity: 0.4, margin: '0 auto 10px' }} />
              <div>Nenhum embarque encontrado nesta aba.</div>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
                gap: 14,
              }}
            >
              {embarques.map((emb) => {
                const st = STATUS_EMB_BADGE[emb.status] || { label: emb.status, cls: 'badge--neutral', cor: '#38bdf8' }
                const totalPed = Number(emb.total_pedidos || 0)
                const totalCx = Number(emb.total_caixas || 0)
                const cxCarr = Number(emb.caixas_carregadas || 0)
                const pctCarga = totalCx > 0 ? Math.min(100, Math.round((cxCarr / totalCx) * 100)) : 0
                const oc = calcOcupacaoInfo(emb.peso_total_kg, emb.capacidade_kg, emb.tolerancia_pct)

                return (
                  <div
                    key={emb.id}
                    className="card"
                    onClick={() => abrirEmbarque(emb.id)}
                    style={{
                      padding: 16,
                      cursor: 'pointer',
                      borderTop: `3px solid ${st.cor}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar size={16} style={{ color: '#93c5fd' }} />
                        <strong style={{ fontSize: 16 }}>{fmtData(emb.data_embarque)}</strong>
                        <span className="font-mono text-xs text-muted">{emb.codigo}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        {podeGerir && emb.status !== 'CONCLUIDO' && (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            style={{ padding: '4px 7px' }}
                            onClick={(e) => handleExcluirEmbarque(e, emb)}
                            title="Excluir embarque"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#cbd5e1' }}>
                      {emb.titulo}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                      <div>
                        <div className="text-muted text-xs">📦 PEDIDOS / CIDADES</div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>
                          {totalPed} ped. • {emb.cidades_count || 0} cid.
                        </div>
                      </div>
                      <div>
                        <div className="text-muted text-xs">⚖️ OCUPAÇÃO CARGA</div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>
                          {fmtKg(emb.peso_total_kg)}
                          {oc.cap > 0 ? ` / ${oc.cap} kg (${oc.pct}%)` : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted text-xs">🚚 VEÍCULO / ROTA</div>
                        <div style={{ fontWeight: 700 }}>
                          {emb.tipo_veiculo_nome || emb.veiculo_placa || emb.rota_nome || 'A definir'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted text-xs">📋 CARREGAMENTO</div>
                        <div style={{ fontWeight: 800 }}>
                          {cxCarr} / {totalCx} cx ({pctCarga}%)
                        </div>
                      </div>
                    </div>

                    <div style={{ height: 5, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${oc.cap > 0 ? oc.barPct : pctCarga}%`,
                          height: '100%',
                          background: oc.cap > 0 ? oc.cor : pctCarga >= 100 ? '#22c55e' : '#38bdf8',
                        }}
                      />
                    </div>

                    <div style={{ fontSize: 12, color: '#93c5fd', fontWeight: 600 }}>
                      Clique para entrar no embarque →
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* VISÃO 2: WORKSPACE DINÂMICO DO EMBARQUE ABERTO */}
      {embarqueAtivo && (
        <>
          <div
            className="page-header no-print"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
          >
            <div>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                style={{ marginBottom: 8 }}
                onClick={() => setEmbarqueAtivo(null)}
              >
                <ArrowLeft size={14} /> Voltar à Central de Embarques
              </button>
              <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Truck size={24} /> {embarqueAtivo.codigo} — {embarqueAtivo.titulo}
                <span className={`badge ${(STATUS_EMB_BADGE[embarqueAtivo.status] || { cls: 'badge--neutral' }).cls}`}>
                  {(STATUS_EMB_BADGE[embarqueAtivo.status] || { label: embarqueAtivo.status }).label}
                </span>
              </h1>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {configModulos.rastreio_motorista_ativo && (
                <button type="button" className="btn btn--secondary" onClick={abrirModalQrMotorista}>
                  <QrCode size={16} /> QR Code Motorista
                </button>
              )}
              {podeGerir && (
                <>
                  {embarqueAtivo.modalidade_impressao === 'OPCAO_A' && (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => handleImprimirRomaneioRota('OPCAO_A_PREVIA')}
                    >
                      <Printer size={15} /> Prévia (Antes Bipar)
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => handleImprimirRomaneioRota(null)}
                  >
                    <Printer size={15} /> Imprimir Romaneio Consolidado
                  </button>
                </>
              )}
            </div>
          </div>

          {/* PAINEL RESUMO & OCUPAÇÃO DA CARGA (ESTILO SSLIP) */}
          <div className="card no-print" style={{ padding: 14, marginBottom: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
                gap: 12,
                paddingBottom: ocupacaoAtivo.cap > 0 ? 12 : 0,
                borderBottom: ocupacaoAtivo.cap > 0 ? '1px solid var(--border-color)' : 'none',
              }}
            >
              <div>
                <div className="text-muted text-xs">📦 PEDIDOS</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{resumoAtivo.total_pedidos || 0}</div>
              </div>
              <div>
                <div className="text-muted text-xs">📥 TOTAL CAIXAS</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24' }}>{resumoAtivo.total_caixas || 0} cx</div>
              </div>
              <div>
                <div className="text-muted text-xs">🏙️ CIDADES</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{resumoAtivo.cidades_count || 0}</div>
              </div>
              <div>
                <div className="text-muted text-xs">⚖️ KG ROTEIRO</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtKg(pesoCargaAtivo)}</div>
              </div>
              <div>
                <div className="text-muted text-xs">🕒 SAÍDA</div>
                <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Clock size={14} className="text-muted" />
                  {embarqueAtivo.horario_saida || '--:--'}
                </div>
              </div>
              <div>
                <div className="text-muted text-xs">📅 DATA EMBARQUE</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtData(embarqueAtivo.data_embarque)}</div>
              </div>
              <div>
                <div className="text-muted text-xs">❄️ TEMP. BAÚ</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>
                  {embarqueAtivo.temperatura_bau !== null && embarqueAtivo.temperatura_bau !== undefined
                    ? `${embarqueAtivo.temperatura_bau} °C`
                    : 'A preencher'}
                </div>
              </div>
            </div>

            {ocupacaoAtivo.cap > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Gauge size={15} /> Ocupação da Carga — {embarqueAtivo.tipo_veiculo_nome || 'Veículo'}
                    {ocupacaoAtivo.dentroTolerancia && (
                      <span className="badge badge--warning" style={{ fontSize: 10 }}>
                        Margem +10% (máx {ocupacaoAtivo.max} kg)
                      </span>
                    )}
                    {ocupacaoAtivo.excedeuMax && (
                      <span className="badge badge--danger" style={{ fontSize: 10 }}>
                        Excedeu teto máx ({ocupacaoAtivo.max} kg)!
                      </span>
                    )}
                  </span>
                  <span style={{ fontWeight: 800 }}>
                    {Number(pesoCargaAtivo).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / {ocupacaoAtivo.cap} kg —{' '}
                    <span style={{ color: ocupacaoAtivo.cor }}>{ocupacaoAtivo.pct}%</span> — Restante:{' '}
                    {ocupacaoAtivo.restante >= 0
                      ? `${ocupacaoAtivo.restante} kg`
                      : `${Math.abs(ocupacaoAtivo.restante).toFixed(1)} kg excedido`}
                  </span>
                </div>
                <div style={{ height: 9, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${ocupacaoAtivo.barPct}%`,
                      height: '100%',
                      background: ocupacaoAtivo.cor,
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Abas internas dinâmicas por permissão */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }} className="no-print">
            {podeGerir && (
              <button
                type="button"
                className={`btn ${abaDetalhe === 'MONTAGEM' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setAbaDetalhe('MONTAGEM')}
              >
                <RouteIcon size={15} /> Montagem, Ordem &amp; Dados da Rota
              </button>
            )}
            {podeCarregar && (
              <button
                type="button"
                className={`btn ${abaDetalhe === 'CARREGAMENTO' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setAbaDetalhe('CARREGAMENTO')}
              >
                <Barcode size={15} /> Carregamento Bipado ({resumoAtivo.caixas_carregadas || 0}/{resumoAtivo.total_caixas || 0} cx)
              </button>
            )}
            <button
              type="button"
              className={`btn ${abaDetalhe === 'ENTREGAS' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setAbaDetalhe('ENTREGAS')}
            >
              <Navigation size={15} /> Entregas &amp; Rastreio
              {podeRastrearEntregas
                ? ` (${embarqueAtivo.paradas?.filter((p) => p.status_entrega === 'ENTREGUE').length || 0}/${embarqueAtivo.paradas?.length || 0})`
                : ' (Aguardando Despacho)'}
            </button>
          </div>

          {/* ABA MONTAGEM & ORDEM */}
          {abaDetalhe === 'MONTAGEM' && podeGerir && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <form className="card" style={{ padding: 16 }} onSubmit={handleSalvarDadosEmbarque}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
                  <div>
                    <label className="form-label">Data Embarque</label>
                    <input
                      type="date"
                      className="form-input"
                      value={formDados.data_embarque}
                      onChange={(e) => setFormDados((f) => ({ ...f, data_embarque: e.target.value }))}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Título do Roteiro</label>
                    <input
                      className="form-input"
                      value={formDados.titulo}
                      onChange={(e) => setFormDados((f) => ({ ...f, titulo: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">Tipo de Veículo (Cadastro)</label>
                    <select
                      className="form-input"
                      value={formDados.tipo_veiculo_id}
                      onChange={(e) => setFormDados((f) => ({ ...f, tipo_veiculo_id: e.target.value }))}
                    >
                      <option value="">-- Selecione o Veículo --</option>
                      {tiposVeiculo.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nome} ({v.capacidade_kg} kg • +{v.tolerancia_pct}%)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Horário de Saída</label>
                    <input
                      type="time"
                      className="form-input"
                      value={formDados.horario_saida}
                      onChange={(e) => setFormDados((f) => ({ ...f, horario_saida: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">Rota Cadastrada</label>
                    <select
                      className="form-input"
                      value={formDados.rota_id}
                      onChange={(e) => setFormDados((f) => ({ ...f, rota_id: e.target.value }))}
                    >
                      <option value="">-- Avulsa --</option>
                      {rotas.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Transportadora</label>
                    <select
                      className="form-input"
                      value={formDados.transportadora_id}
                      onChange={(e) => setFormDados((f) => ({ ...f, transportadora_id: e.target.value }))}
                    >
                      <option value="">-- Frota Própria / À Definir --</option>
                      {transportadoras.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nome_fantasia || t.razao_social}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Placa Veículo</label>
                    <input
                      className="form-input"
                      placeholder="Ex: ABC-1D23"
                      value={formDados.veiculo_placa}
                      onChange={(e) => setFormDados((f) => ({ ...f, veiculo_placa: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">Motorista</label>
                    <input
                      className="form-input"
                      placeholder="Opcional..."
                      value={formDados.motorista_nome}
                      onChange={(e) => setFormDados((f) => ({ ...f, motorista_nome: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">Impressão do Romaneio</label>
                    <select
                      className="form-input"
                      value={formDados.modalidade_impressao}
                      onChange={(e) => setFormDados((f) => ({ ...f, modalidade_impressao: e.target.value }))}
                    >
                      <option value="OPCAO_B">Antes da Bipagem (Padrão)</option>
                      <option value="OPCAO_A">Pós-Bipagem (c/ Temp. Baú + Bipadas)</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    placeholder="Observações do embarque / carregamento..."
                    value={formDados.observacoes}
                    onChange={(e) => setFormDados((f) => ({ ...f, observacoes: e.target.value }))}
                  />
                  <button type="submit" className="btn btn--primary btn--sm">
                    Salvar Dados do Roteiro
                  </button>
                </div>
              </form>

              {/* Paradas Ordenadas */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>
                    Sequência das Entregas no Roteiro ({embarqueAtivo.paradas?.length || 0})
                  </h3>
                  <button type="button" className="btn btn--success btn--sm" onClick={abrirModalAdicionarPedidos}>
                    <Plus size={14} /> + Puxar Pedidos ({fmtData(embarqueAtivo.data_embarque)})
                  </button>
                </div>

                {(embarqueAtivo.paradas || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                    Nenhum pedido adicionado ainda. Clique em <strong>+ Puxar Pedidos</strong> acima.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Ordem</th>
                          <th>Pedido / Romaneio</th>
                          <th>Cliente &amp; Destino</th>
                          <th style={{ textAlign: 'center' }}>Caixas</th>
                          <th style={{ textAlign: 'right' }}>Peso Pedido</th>
                          <th style={{ textAlign: 'right' }}>Peso Bruto</th>
                          <th style={{ textAlign: 'right' }}>Peso Real</th>
                          <th>Observações</th>
                          <th style={{ textAlign: 'right' }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(embarqueAtivo.paradas || []).map((p, idx) => (
                          <tr key={p.pedido_id}>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <strong style={{ fontSize: 15, color: '#38bdf8', minWidth: 26 }}>#{p.ordem_parada}</strong>
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  style={{ padding: '2px 5px' }}
                                  disabled={idx === 0}
                                  onClick={() => handleMoverParada(idx, -1)}
                                  title="Subir na rota"
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  style={{ padding: '2px 5px' }}
                                  disabled={idx === embarqueAtivo.paradas.length - 1}
                                  onClick={() => handleMoverParada(idx, 1)}
                                  title="Descer na rota"
                                >
                                  <ArrowDown size={12} />
                                </button>
                              </div>
                            </td>
                            <td>
                              <div className="font-mono font-bold">{p.pedido_codigo}</div>
                              <div className="text-muted text-xs">{p.romaneio_codigo || 'Sem romaneio'}</div>
                              {p.numero_nf && <div className="badge badge--info" style={{ fontSize: 9.5, marginTop: 2 }}>NF {p.numero_nf}</div>}
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>{p.cliente}</div>
                              <div className="text-muted text-xs">{p.endereco_entrega}</div>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>
                              {p.caixas_total > 0 ? `${p.caixas_total} cx` : <span className="badge badge--warning">A definir</span>}
                            </td>
                            <td style={{ textAlign: 'right' }}>{fmtKg(p.kg_pedido)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                              {p.peso_bruto_kg > 0 ? fmtKg(p.peso_bruto_kg) : <span className="text-muted">A definir</span>}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 800 }}>
                              {p.kg_real > 0 ? fmtKg(p.kg_real) : <span className="text-muted">A definir</span>}
                            </td>
                            <td>
                              {p.pagamento_na_entrega && (
                                <span className="badge badge--danger" style={{ fontSize: 9.5 }}>
                                  COBRAR NA ENTREGA
                                </span>
                              )}
                              {p.pedido_observacoes?.trim() && (
                                <div className="text-muted text-xs" style={{ marginTop: 3 }}>{p.pedido_observacoes}</div>
                              )}
                              {!p.pagamento_na_entrega && !p.pedido_observacoes?.trim() && <span className="text-muted">-</span>}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => handleRemoverParada(p)}
                                title="Remover do roteiro"
                              >
                                <Trash2 size={13} />
                              </button>
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

          {/* ABA CARREGAMENTO BIPADO (OPERADOR NA DOCA) */}
          {abaDetalhe === 'CARREGAMENTO' && podeCarregar && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card" style={{ padding: 18 }}>
                <form
                  onSubmit={handleBiparCaixaCarregamento}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
                >
                  <div style={{ flex: '1 1 280px' }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Barcode size={15} /> Bipar Caixa do Roteiro para Carregar o Veículo (1 Bipada Única)
                    </label>
                    <input
                      ref={scannerRef}
                      className="form-input"
                      style={{ fontSize: 16, fontWeight: 700 }}
                      placeholder="Leia o código de barras EAN da caixa e pressione Enter..."
                      value={eanBipe}
                      onChange={(e) => setEanBipe(e.target.value)}
                      disabled={bipando || embarqueAtivo.status === 'CONCLUIDO'}
                    />
                  </div>
                  <div style={{ width: 150 }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Thermometer size={14} /> Temp. Baú (°C)
                    </label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="number"
                        step="0.1"
                        className="form-input"
                        placeholder="Ex: -18"
                        value={tempManual}
                        onChange={(e) => setTempManual(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={handleSalvarTempManual}
                        title="Salvar temperatura do baú"
                      >
                        OK
                      </button>
                    </div>
                  </div>
                  <button type="submit" className="btn btn--primary" disabled={bipando || !eanBipe.trim() || embarqueAtivo.status === 'CONCLUIDO'}>
                    <CheckCircle2 size={15} /> {bipando ? 'Validando...' : 'Confirmar Caixa'}
                  </button>
                  {embarqueAtivo.status !== 'EM_ROTA' && embarqueAtivo.status !== 'CONCLUIDO' && (
                    <button
                      type="button"
                      className={`btn ${tudoBipado ? 'btn--success' : 'btn--secondary'}`}
                      onClick={handleDespachar}
                    >
                      <Truck size={15} /> Concluir Carga &amp; Despachar
                    </button>
                  )}
                </form>

                {!tudoBipado && embarqueAtivo.status !== 'EM_ROTA' && embarqueAtivo.status !== 'CONCLUIDO' && (
                  <div className="text-muted text-xs" style={{ marginTop: 8 }}>
                    ℹ️ O despacho do veículo é liberado somente após todos os pedidos estarem separados e 100% das caixas bipadas no carregamento.
                  </div>
                )}

                {erroBipe && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.14)',
                      border: '1px solid rgba(239, 68, 68, 0.45)',
                      color: '#fca5a5',
                      fontSize: 13,
                    }}
                  >
                    <AlertTriangle size={15} style={{ verticalAlign: 'middle' }} /> {erroBipe}
                  </div>
                )}

                {ultimoBipeInfo && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'rgba(34, 197, 94, 0.12)',
                      border: '1px solid rgba(34, 197, 94, 0.45)',
                      color: '#86efac',
                      fontSize: 13,
                    }}
                  >
                    Última caixa carregada: <strong>{ultimoBipeInfo.ean_caixa}</strong> • {ultimoBipeInfo.produto_descricao} ({fmtKg(ultimoBipeInfo.peso_kg)}) → <strong>Parada #{ultimoBipeInfo.ordem_parada} ({ultimoBipeInfo.pedido_codigo} — {ultimoBipeInfo.cliente})</strong>
                  </div>
                )}
              </div>

              {/* Checklist por Parada */}
              {(embarqueAtivo.paradas || []).map((p) => (
                <div key={p.pedido_id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong style={{ fontSize: 15, color: '#38bdf8' }}>
                        Parada #{p.ordem_parada} • {p.pedido_codigo} — {p.cliente}
                      </strong>
                      <div className="text-muted text-xs">{p.endereco_entrega}</div>
                    </div>
                    <span className={`badge ${p.caixas_total > 0 && p.caixas_carregadas >= p.caixas_total ? 'badge--success' : 'badge--warning'}`}>
                      {p.caixas_carregadas}/{p.caixas_total} caixas carregadas ({fmtKg(p.kg_real)})
                    </span>
                  </div>

                  {p.caixas.length === 0 ? (
                    <div className="text-muted text-xs">Pedido ainda sem caixas separadas na câmara.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
                      {p.caixas.map((cx) => (
                        <div
                          key={cx.item_id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            border: `1px solid ${cx.carregado ? '#22c55e88' : '#334155'}`,
                            background: cx.carregado ? 'rgba(34, 197, 94, 0.1)' : 'rgba(15, 23, 42, 0.5)',
                            fontSize: 12,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <div>
                            <div className="font-mono font-bold">{cx.ean_caixa}</div>
                            <div className="text-xs">{cx.produto_descricao}</div>
                            <div className="text-muted text-xs">
                              {fmtKg(cx.peso_kg)} {cx.carregado_por ? `• Por ${cx.carregado_por}` : ''}
                            </div>
                          </div>
                          {cx.carregado ? (
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              style={{ padding: '3px 6px' }}
                              onClick={() =>
                                roteirizacaoQueries
                                  .estornarCarregamento(embarqueAtivo.id, cx.item_id)
                                  .then(() => abrirEmbarque(embarqueAtivo.id))
                              }
                              title="Desmarcar bipagem"
                            >
                              <RotateCcw size={12} />
                            </button>
                          ) : (
                            <span className="badge badge--neutral">Pendente</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ABA ENTREGAS & RASTREIO (LIBERADA APÓS BIPAR TUDO E DESPACHAR) */}
          {abaDetalhe === 'ENTREGAS' && (
            <div className="card" style={{ padding: 16 }}>
              {!podeRastrearEntregas ? (
                <div style={{ padding: '38px 20px', textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
                  <Lock size={44} style={{ color: '#f59e0b', margin: '0 auto 12px' }} />
                  <h3 style={{ margin: '0 0 8px' }}>Aguardando Bipagem e Despacho do Veículo</h3>
                  <p className="text-muted text-sm" style={{ margin: 0 }}>
                    O acompanhamento em tempo real e a finalização da rota ficam disponíveis somente após bipar{' '}
                    <strong>100% das caixas</strong> e clicar em <strong>Concluir Carga &amp; Despachar</strong> na aba{' '}
                    <em>Carregamento Bipado</em>.
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16 }}>Acompanhamento das Entregas em Tempo Real</h3>
                      <div className="text-muted text-xs" style={{ marginTop: 3 }}>
                        Monitoramento opcional durante a rota. No fim do dia, clique em Finalizar Rota para encerrar o embarque.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="text-xs flex items-center gap-6 cursor-pointer">
                        <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                        Atualizar a cada 10s
                      </label>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirEmbarque(embarqueAtivo.id)}>
                        <RefreshCw size={13} /> Atualizar
                      </button>
                      {embarqueAtivo.status === 'EM_ROTA' && (
                        <button type="button" className="btn btn--success btn--sm" onClick={handleFinalizarRota}>
                          <Flag size={13} /> Finalizar Rota
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(embarqueAtivo.paradas || []).map((p) => {
                      const st = STATUS_STOP_BADGE[p.status_entrega] || { label: p.status_entrega, cls: 'badge--neutral' }
                      const linkCliente = p.rastreio_token
                        ? `${window.location.origin}${window.location.pathname}#/rastreio-pedido/${p.rastreio_token}`
                        : ''
                      return (
                        <div
                          key={p.pedido_id}
                          style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: 10,
                            padding: 12,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <strong style={{ color: '#38bdf8' }}>#{p.ordem_parada}</strong>
                              <span className="font-mono font-bold">{p.pedido_codigo}</span>
                              <strong>{p.cliente}</strong>
                              <span className={`badge ${st.cls}`}>{st.label}</span>
                              {p.pagamento_na_entrega && (
                                <span className={`badge ${p.pagamento_confirmado ? 'badge--success' : 'badge--danger'}`}>
                                  <DollarSign size={11} /> {p.pagamento_confirmado ? 'Pago na Entrega' : 'Cobrar na Entrega'}
                                </span>
                              )}
                            </div>
                            <div className="text-muted text-xs" style={{ marginTop: 4 }}>
                              <MapPin size={12} style={{ verticalAlign: 'middle' }} /> {p.endereco_entrega} • {p.caixas_total} cx (Bruto: {fmtKg(p.peso_bruto_kg || p.kg_real || p.kg_pedido)})
                              {p.observacao_motorista ? ` • Motorista: "${p.observacao_motorista}"` : ''}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {configModulos.rastreio_motorista_ativo && linkCliente && (
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                onClick={() => {
                                  navigator.clipboard?.writeText(linkCliente)
                                  toastSuccess('Link de rastreio do cliente copiado!')
                                }}
                              >
                                <Copy size={12} /> Link Cliente
                              </button>
                            )}
                            {embarqueAtivo.status === 'EM_ROTA' &&
                              p.status_entrega !== 'ENTREGUE' &&
                              p.status_entrega !== 'DEVOLVIDA' && (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn--secondary btn--sm"
                                    onClick={() => handleStatusParadaManual(p, 'NO_CLIENTE')}
                                  >
                                    No Cliente
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--success btn--sm"
                                    onClick={() => handleStatusParadaManual(p, 'ENTREGUE')}
                                  >
                                    <CheckCircle2 size={13} /> Confirmar Entrega
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--danger btn--sm"
                                    onClick={() => handleStatusParadaManual(p, 'DEVOLVIDA')}
                                  >
                                    Recusa / Voltou
                                  </button>
                                </>
                              )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL + CRIAR EMBARQUE */}
      {modalNovoOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 95, backgroundColor: 'rgba(5,9,18,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>+ Criar Novo Embarque / Roteiro</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalNovoOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCriarEmbarque} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.6fr', gap: 10 }}>
                <div>
                  <label className="form-label">Data do Embarque *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={novoForm.data_embarque}
                    onChange={(e) => {
                      const dt = e.target.value
                      setNovoForm((f) => ({ ...f, data_embarque: dt, pedido_ids: [] }))
                      if (dt) carregarPedidosPorData(dt, null)
                    }}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Horário de Saída</label>
                  <input
                    type="time"
                    className="form-input"
                    value={novoForm.horario_saida}
                    onChange={(e) => setNovoForm((f) => ({ ...f, horario_saida: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Título (opcional)</label>
                  <input
                    className="form-input"
                    placeholder="Auto-gerado caso vazio..."
                    value={novoForm.titulo}
                    onChange={(e) => setNovoForm((f) => ({ ...f, titulo: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">Tipo de Veículo (Cadastro) *</label>
                  <select
                    className="form-input"
                    required
                    value={novoForm.tipo_veiculo_id}
                    onChange={(e) => setNovoForm((f) => ({ ...f, tipo_veiculo_id: e.target.value }))}
                  >
                    <option value="">-- Selecione o Veículo --</option>
                    {tiposVeiculo.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nome} ({v.capacidade_kg} kg • +{v.tolerancia_pct}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Rota</label>
                  <select
                    className="form-input"
                    value={novoForm.rota_id}
                    onChange={(e) => setNovoForm((f) => ({ ...f, rota_id: e.target.value }))}
                  >
                    <option value="">-- Avulsa --</option>
                    {rotas.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Impressão</label>
                  <select
                    className="form-input"
                    value={novoForm.modalidade_impressao}
                    onChange={(e) => setNovoForm((f) => ({ ...f, modalidade_impressao: e.target.value }))}
                  >
                    <option value="OPCAO_B">Antes da Bipagem</option>
                    <option value="OPCAO_A">Pós-Bipagem (c/ Temp.)</option>
                  </select>
                </div>
              </div>

              {veiculoSelecionadoNovo && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(15,23,42,0.7)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700 }}>
                      Ocupação: {veiculoSelecionadoNovo.nome}
                    </span>
                    <span style={{ fontWeight: 800 }}>
                      {pesoSelecionadoNovo.toFixed(1)} / {ocupacaoNovoModal.cap} kg ({ocupacaoNovoModal.pct}%) • Máx c/ +{ocupacaoNovoModal.tol}%: {ocupacaoNovoModal.max} kg
                    </span>
                  </div>
                  <div style={{ height: 7, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${ocupacaoNovoModal.barPct}%`, height: '100%', background: ocupacaoNovoModal.cor }} />
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">
                  Pedidos c/ entrega em {fmtData(novoForm.data_embarque)} ({novoForm.pedido_ids.length} marcados)
                </label>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {loadingElegiveis ? (
                    <div className="text-muted text-xs" style={{ padding: 14, textAlign: 'center' }}>
                      Buscando pedidos para {fmtData(novoForm.data_embarque)}...
                    </div>
                  ) : pedidosElegiveis.length === 0 ? (
                    <div className="text-muted text-xs" style={{ padding: 14, textAlign: 'center' }}>
                      Nenhum pedido com previsão de entrega em {fmtData(novoForm.data_embarque)} disponível (você pode criar vazio e puxar depois).
                    </div>
                  ) : (
                    pedidosElegiveis.map((ped) => {
                      const marcado = novoForm.pedido_ids.includes(ped.id)
                      return (
                        <label
                          key={ped.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 8px',
                            borderRadius: 6,
                            background: marcado ? 'rgba(56,189,248,0.14)' : 'rgba(15,23,42,0.45)',
                            cursor: 'pointer',
                            fontSize: 12.5,
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={(e) =>
                                setNovoForm((f) => ({
                                  ...f,
                                  pedido_ids: e.target.checked
                                    ? [...f.pedido_ids, ped.id]
                                    : f.pedido_ids.filter((x) => x !== ped.id),
                                }))
                              }
                            />
                            <strong>{ped.codigo}</strong> — {ped.cliente} ({ped.cliente_cidade || '-'})
                          </span>
                          <span className={`badge ${ped.pronto_para_embarque ? 'badge--success' : 'badge--warning'}`}>
                            {ped.pronto_para_embarque
                              ? `${ped.total_caixas_separadas} cx • ${fmtKg(ped.peso_carga_kg || ped.total_kg_separado)}`
                              : `Em Separação • Est. ${fmtKg(ped.total_kg_solicitado)}`}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn--secondary" onClick={() => setModalNovoOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={ocupacaoNovoModal.excedeuMax}>
                  Criar Embarque
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL + PUXAR PEDIDOS PARA EMBARQUE ABERTO (FILTRADO PELA DATA DO EMBARQUE) */}
      {modalPedidosOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 95, backgroundColor: 'rgba(5,9,18,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 680, maxHeight: '88vh', overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>
                Puxar Pedidos ({fmtData(embarqueAtivo?.data_embarque)}) — {embarqueAtivo?.codigo}
              </h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalPedidosOpen(false)}>
                <X size={16} />
              </button>
            </div>

            {ocupacaoAddModal.cap > 0 && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(15,23,42,0.7)', border: '1px solid var(--border-color)', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>Capacidade após inclusão ({embarqueAtivo?.tipo_veiculo_nome || 'Veículo'})</span>
                  <strong style={{ color: ocupacaoAddModal.cor }}>
                    {pesoSelecionadoAddModal.toFixed(1)} / {ocupacaoAddModal.cap} kg ({ocupacaoAddModal.pct}%) — Máx c/ +{ocupacaoAddModal.tol}%: {ocupacaoAddModal.max} kg
                  </strong>
                </div>
                <div style={{ height: 6, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${ocupacaoAddModal.barPct}%`, height: '100%', background: ocupacaoAddModal.cor }} />
                </div>
              </div>
            )}

            <label className="text-xs flex items-center gap-6 mb-12 cursor-pointer" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={somenteProntos} onChange={(e) => setSomenteProntos(e.target.checked)} />
              Mostrar somente pedidos já separados com pesos reais (Prontos p/ Embarque)
            </label>
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loadingElegiveis ? (
                <div className="text-muted text-xs" style={{ padding: 14, textAlign: 'center' }}>
                  Buscando pedidos...
                </div>
              ) : pedidosElegiveis.filter((p) => !somenteProntos || p.pronto_para_embarque).length === 0 ? (
                <div className="text-muted text-xs" style={{ padding: 16, textAlign: 'center' }}>
                  Nenhum pedido elegível com entrega prevista para {fmtData(embarqueAtivo?.data_embarque)}.
                </div>
              ) : (
                pedidosElegiveis
                  .filter((p) => !somenteProntos || p.pronto_para_embarque)
                  .map((ped) => {
                    const marcado = pedidosModalSel.includes(ped.id)
                    return (
                      <label
                        key={ped.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: `1px solid ${marcado ? '#38bdf8' : '#334155'}`,
                          background: marcado ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.4)',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) =>
                              setPedidosModalSel((prev) =>
                                e.target.checked ? [...prev, ped.id] : prev.filter((x) => x !== ped.id),
                              )
                            }
                          />
                          <span>
                            <strong>{ped.codigo}</strong> — {ped.cliente}
                            <div className="text-muted text-xs">
                              Previsão: {fmtData(ped.previsao_entrega)} • {ped.cliente_cidade || '-'}
                            </div>
                          </span>
                        </span>
                        <span className={`badge ${ped.pronto_para_embarque ? 'badge--success' : 'badge--warning'}`}>
                          {ped.pronto_para_embarque
                            ? `${ped.total_caixas_separadas} cx • ${fmtKg(ped.peso_carga_kg || ped.total_kg_separado)}`
                            : `Em Separação • Est. ${fmtKg(ped.total_kg_solicitado)}`}
                        </span>
                      </label>
                    )
                  })
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn--secondary" onClick={() => setModalPedidosOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleConfirmarAddPedidos}
                disabled={ocupacaoAddModal.excedeuMax || pedidosModalSel.length === 0}
              >
                Adicionar ({pedidosModalSel.length}) ao Roteiro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TEMPERATURA DO BAÚ NA 1ª BIPAGEM (MODO PÓS-BIPAGEM) */}
      {modalTempBipe.open && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 98, backgroundColor: 'rgba(5,9,18,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 420, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Thermometer size={20} className="text-primary" /> Temperatura do Baú (1ª Bipagem)
              </h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalTempBipe({ open: false, eanPendente: '', valor: '' })}>
                <X size={16} />
              </button>
            </div>
            <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
              Informe a temperatura do baú do veículo (°C) antes de confirmar a primeira caixa para que já saia impressa no romaneio pós-bipagem.
            </p>
            <form onSubmit={handleConfirmarModalTemperatura} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label">Temperatura (°C) *</label>
                <input
                  ref={tempInputRef}
                  type="number"
                  step="0.1"
                  className="form-input"
                  style={{ fontSize: 18, fontWeight: 800, textAlign: 'center' }}
                  value={modalTempBipe.valor}
                  onChange={(e) => setModalTempBipe((m) => ({ ...m, valor: e.target.value }))}
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setModalTempBipe({ open: false, eanPendente: '', valor: '' })}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <CheckCircle2 size={15} /> Salvar Temp. e Bipar Caixa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIGURAÇÕES DO MÓDULO (RASTREIO QR ON/OFF + MODO PADRÃO IMPRESSÃO) */}
      {modalConfigOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 95, backgroundColor: 'rgba(5,9,18,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 480, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Configurações de Roteirização</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalConfigOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 8, border: '1px solid var(--border-color)', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Rastreio Mobile do Motorista (QR Code)</div>
                  <div className="text-muted text-xs">
                    Habilita leitura do QR Code pelo celular do motorista para informar placa e dar baixa nas paradas em tempo real.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={configModulos.rastreio_motorista_ativo}
                  onChange={(e) => handleToggleConfig({ rastreio_motorista_ativo: e.target.checked })}
                />
              </label>

              <div>
                <label className="form-label">Modalidade Padrão de Romaneio Consolidado</label>
                <select
                  className="form-input"
                  value={configModulos.impressao_romaneio_padrao}
                  onChange={(e) => handleToggleConfig({ impressao_romaneio_padrao: e.target.value })}
                >
                  <option value="OPCAO_B">Antes da Bipagem (Padrão: sem bipadas + temp. p/ caneta)</option>
                  <option value="OPCAO_A">Pós-Bipagem (Prévia + Oficial c/ Temp. na 1ª bipagem)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL QR CODE MOTORISTA */}
      {modalQrData.open && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 96, backgroundColor: 'rgba(5,9,18,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 420, padding: 24, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>QR Code do Motorista — {embarqueAtivo?.codigo}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalQrData({ open: false, dataUrl: '', url: '' })}>
                <X size={16} />
              </button>
            </div>
            <p className="text-muted text-xs">
              O motorista aponta a câmera do celular para iniciar a rota, informar placa e acompanhar as entregas.
            </p>
            {modalQrData.dataUrl && (
              <div style={{ background: '#fff', padding: 12, borderRadius: 10, display: 'inline-block', margin: '10px auto' }}>
                <img src={modalQrData.dataUrl} alt="QR Code da Rota" style={{ width: 220, height: 220, display: 'block' }} />
              </div>
            )}
            <div className="font-mono text-xs text-muted" style={{ wordBreak: 'break-all', marginBottom: 14 }}>
              {modalQrData.url}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  navigator.clipboard?.writeText(modalQrData.url)
                  toastSuccess('Link copiado!')
                }}
              >
                <Copy size={14} /> Copiar Link da Rota
              </button>
              <a
                href={modalQrData.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn--secondary btn--sm"
              >
                Abrir no Navegador
              </a>
            </div>
          </div>
        </div>
      )}

      {/* IMPRESSÃO A4 ROMANEIO CONSOLIDADO DO ROTEIRO */}
      {printCfg && (
        <RomaneioConsolidadoRotaPrint
          embarque={printCfg.embarque}
          modo={printCfg.modo}
          rastreioAtivo={configModulos.rastreio_motorista_ativo}
          onClose={() => setPrintCfg(null)}
          autoPrint={true}
        />
      )}
    </div>
  )
}
