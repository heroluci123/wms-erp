import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  DollarSign,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  PenTool,
  Phone,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Trash2,
  Truck,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react'
import { roteirizacaoQueries } from '../queries/roteirizacao'
import { AssinaturaCanvas } from '../components/shared/AssinaturaCanvas'
import { PwaInstallBanner } from '../components/shared/PwaInstallBanner'
import {
  comprimirFotoImagem,
  enfileirarAcaoOffline,
  gerarLinkGoogleMapsCoords,
  gerarLinkMaps,
  gerarLinkWaze,
  gerarLinkWhatsApp,
  lerCacheRota,
  listarFilaOffline,
  obterGpsAtual,
  registrarRotaRecente,
  removerAcaoOffline,
  salvarCacheRota,
} from '../utils/motoristaPwa'

const STATUS_CFG = {
  PENDENTE: { label: 'Aguardando Saída', bg: 'rgba(148,163,184,0.18)', color: '#cbd5e1', border: '#475569' },
  A_CAMINHO: { label: 'A Caminho', bg: 'rgba(245,158,11,0.18)', color: '#fcd34d', border: '#f59e0b' },
  NO_CLIENTE: { label: 'No Local', bg: 'rgba(56,189,248,0.18)', color: '#7dd3fc', border: '#38bdf8' },
  ENTREGUE: { label: 'Entregue', bg: 'rgba(34,197,94,0.18)', color: '#86efac', border: '#22c55e' },
  DEVOLVIDA: { label: 'Recusa / Voltou', bg: 'rgba(239,68,68,0.18)', color: '#fca5a5', border: '#ef4444' },
}

const MOTIVOS_RECUSA = [
  { id: 'LOCAL_FECHADO', label: 'Local Fechado / Sem Recebedor' },
  { id: 'AVARIA', label: 'Avaria / Embalagem Danificada' },
  { id: 'DIVERGENCIA_PEDIDO', label: 'Divergência de Pedido / Peso' },
  { id: 'VALIDADE', label: 'Validade / Temperatura Fora' },
  { id: 'SEM_PAGAMENTO', label: 'Cliente Sem Pagamento' },
  { id: 'OUTROS', label: 'Outro Motivo' },
]

const FORMAS_PAGAMENTO = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO', 'CHEQUE']

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtHora = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function MotoristaRastreio() {
  const { qrToken } = useParams()
  const navigate = useNavigate()

  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [msgSucesso, setMsgSucesso] = useState('')
  const [dados, setDados] = useState(() => lerCacheRota(qrToken))

  // Checklist pré-viagem & saída
  const [checklistAberto, setChecklistAberto] = useState(false)
  const [motoristaNome, setMotoristaNome] = useState('')
  const [veiculoPlaca, setVeiculoPlaca] = useState('')
  const [odometroSaida, setOdometroSaida] = useState('')
  const [tempSaida, setTempSaida] = useState('')
  const [ckBauLimpo, setCkBauLimpo] = useState(true)
  const [ckTempOk, setCkTempOk] = useState(true)
  const [ckDocsOk, setCkDocsOk] = useState(true)
  const [ckCargaLacrada, setCkCargaLacrada] = useState(true)
  const [obsChecklist, setObsChecklist] = useState('')
  const [iniciando, setIniciando] = useState(false)

  // Filtro de paradas e cards expandidos
  const [filtroParadas, setFiltroParadas] = useState('PENDENTES') // PENDENTES | CONCLUIDAS | TODAS
  const [paradaExpandidaId, setParadaExpandidaId] = useState(null)
  const [salvandoId, setSalvandoId] = useState(null)
  const [enviandoGps, setEnviandoGps] = useState(false)

  // Fila offline pendente
  const [filaOffline, setFilaOffline] = useState(() => listarFilaOffline(qrToken))
  const [sincronizandoFila, setSincronizandoFila] = useState(false)

  // Modal Comprovante Digital de Entrega (POD)
  const [modalPod, setModalPod] = useState(null) // parada obj
  const [podRecebedor, setPodRecebedor] = useState('')
  const [podDocumento, setPodDocumento] = useState('')
  const [podTemp, setPodTemp] = useState('')
  const [podPagoOk, setPodPagoOk] = useState(false)
  const [podFormaPg, setPodFormaPg] = useState('PIX')
  const [podValorPago, setPodValorPago] = useState('')
  const [podAssinatura, setPodAssinatura] = useState('')
  const [podFoto, setPodFoto] = useState('')
  const [podObs, setPodObs] = useState('')
  const [podTemDevolucaoParcial, setPodTemDevolucaoParcial] = useState(false)
  const [podItensRecusados, setPodItensRecusados] = useState([])
  const [comprimindoFoto, setComprimindoFoto] = useState(false)
  const [enviandoPod, setEnviandoPod] = useState(false)

  // Modal Recusa / Ocorrência
  const [modalRecusa, setModalRecusa] = useState(null) // parada obj
  const [recusaMotivo, setRecusaMotivo] = useState('LOCAL_FECHADO')
  const [recusaObs, setRecusaObs] = useState('')
  const [recusaFoto, setRecusaFoto] = useState('')
  const [enviandoRecusa, setEnviandoRecusa] = useState(false)

  // Modal Visualizar Comprovante já enviado
  const [podVisualizar, setPodVisualizar] = useState(null)

  const inputFotoPodRef = useRef(null)
  const inputFotoRecusaRef = useRef(null)

  const atualizarFilaLocal = useCallback(() => {
    setFilaOffline(listarFilaOffline(qrToken))
  }, [qrToken])

  const carregar = useCallback(async () => {
    if (!qrToken) return
    setLoading(true)
    setErro('')
    try {
      const res = await roteirizacaoQueries.obterRotaPublica(qrToken)
      setDados(res)
      salvarCacheRota(qrToken, res)

      const r = res?.rota
      if (r) {
        setMotoristaNome((prev) => prev || r.motorista_nome || '')
        setVeiculoPlaca((prev) => prev || r.veiculo_placa || '')
        const ck = r.checklist_saida || {}
        if (ck.concluido_em) {
          setCkBauLimpo(Boolean(ck.bau_limpo))
          setCkTempOk(Boolean(ck.temperatura_ok))
          setCkDocsOk(Boolean(ck.documentos_nf_ok))
          setCkCargaLacrada(Boolean(ck.carga_lacrada))
          if (ck.odometro_saida != null) setOdometroSaida(String(ck.odometro_saida))
          if (ck.temperatura_saida_c != null) setTempSaida(String(ck.temperatura_saida_c))
          setChecklistAberto(false)
        } else {
          if (r.temperatura_bau != null) setTempSaida((prev) => prev || String(r.temperatura_bau))
          setChecklistAberto(r.status !== 'CONCLUIDO' && (!r.motorista_nome || !r.veiculo_placa))
        }

        const paradasArr = res?.paradas || []
        registrarRotaRecente({
          qr_token: qrToken,
          codigo: r.codigo,
          titulo: r.titulo || r.rota_nome,
          status: r.status,
          data_embarque: r.data_embarque,
          veiculo_placa: r.veiculo_placa,
          motorista_nome: r.motorista_nome,
          total_paradas: paradasArr.length,
          entregues: paradasArr.filter((x) => x.status_entrega === 'ENTREGUE').length,
        })
      }
    } catch (err) {
      const cached = lerCacheRota(qrToken)
      if (cached) {
        setDados(cached)
        setErro('Sem conexão com o servidor — exibindo último estado salvo no celular.')
      } else {
        setErro(err.message || 'Não foi possível carregar este roteiro.')
      }
    } finally {
      setLoading(false)
    }
  }, [qrToken])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Sincronização automática da fila offline quando o sinal volta
  const sincronizarFilaOffline = useCallback(async () => {
    const pendentes = listarFilaOffline(qrToken)
    if (pendentes.length === 0) return
    setSincronizandoFila(true)
    let okCount = 0
    for (const item of pendentes) {
      try {
        if (item.tipo === 'INICIAR') {
          await roteirizacaoQueries.iniciarRotaPublica(item.qrToken, item.payload)
        } else if (item.tipo === 'PARADA') {
          await roteirizacaoQueries.atualizarParadaPublica(item.qrToken, item.pedidoId, item.payload)
        }
        removerAcaoOffline(item.id)
        okCount += 1
      } catch {
        break
      }
    }
    atualizarFilaLocal()
    setSincronizandoFila(false)
    if (okCount > 0) {
      setMsgSucesso(`${okCount} registro(s) offline sincronizado(s) com a central!`)
      await carregar()
    }
  }, [qrToken, atualizarFilaLocal, carregar])

  useEffect(() => {
    const onOnline = () => {
      setOnline(true)
      sincronizarFilaOffline()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [sincronizarFilaOffline])

  const handleIniciarRota = async (e) => {
    e.preventDefault()
    setErro('')
    setMsgSucesso('')
    if (!motoristaNome.trim() || !veiculoPlaca.trim()) {
      setErro('Informe seu nome e a placa do veículo.')
      return
    }
    setIniciando(true)
    const gps = await obterGpsAtual(4500)
    const payload = {
      motorista_nome: motoristaNome.trim(),
      veiculo_placa: veiculoPlaca.trim().toUpperCase(),
      checklist_saida: {
        bau_limpo: ckBauLimpo,
        temperatura_ok: ckTempOk,
        temperatura_saida_c: tempSaida !== '' ? Number(String(tempSaida).replace(',', '.')) : null,
        documentos_nf_ok: ckDocsOk,
        carga_lacrada: ckCargaLacrada,
        odometro_saida: odometroSaida !== '' ? Number(String(odometroSaida).replace(',', '.')) : null,
        observacao_checklist: obsChecklist.trim(),
      },
      ...(gps ? { lat: gps.lat, lng: gps.lng } : {}),
    }
    try {
      await roteirizacaoQueries.iniciarRotaPublica(qrToken, payload)
      setChecklistAberto(false)
      setMsgSucesso('Checklist confirmado e rota iniciada na central!')
      await carregar()
    } catch (err) {
      if (!navigator.onLine) {
        enfileirarAcaoOffline({ tipo: 'INICIAR', qrToken, payload })
        atualizarFilaLocal()
        setChecklistAberto(false)
        setMsgSucesso('Sem internet: checklist salvo offline e será enviado assim que o sinal voltar.')
      } else {
        setErro(err.message)
      }
    } finally {
      setIniciando(false)
    }
  }

  const handleEnviarGpsAgora = async () => {
    setEnviandoGps(true)
    setErro('')
    try {
      const gps = await obterGpsAtual(7000)
      if (!gps) {
        setErro('Não foi possível obter a localização GPS. Verifique se a permissão de localização está ativa no Safari/celular.')
        return
      }
      await roteirizacaoQueries.atualizarLocalizacaoPublica(qrToken, gps)
      setMsgSucesso(`GPS enviado para a central (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})!`)
      await carregar()
    } catch (err) {
      setErro(err.message || 'Erro ao enviar localização.')
    } finally {
      setEnviandoGps(false)
    }
  }

  const handleChegueiNoCliente = async (parada) => {
    setErro('')
    setMsgSucesso('')
    setSalvandoId(parada.pedido_id)
    const gps = await obterGpsAtual(4000)
    const payload = {
      status_entrega: 'NO_CLIENTE',
      ...(gps ? { lat: gps.lat, lng: gps.lng } : {}),
    }
    try {
      await roteirizacaoQueries.atualizarParadaPublica(qrToken, parada.pedido_id, payload)
      setMsgSucesso(`Chegada registrada em ${parada.cliente}!`)
      await carregar()
    } catch (err) {
      if (!navigator.onLine) {
        enfileirarAcaoOffline({ tipo: 'PARADA', qrToken, pedidoId: parada.pedido_id, payload })
        atualizarFilaLocal()
        setMsgSucesso(`Chegada em ${parada.cliente} salva offline!`)
      } else {
        setErro(err.message)
      }
    } finally {
      setSalvandoId(null)
    }
  }

  // Abrir Modal POD (Comprovante Digital)
  const abrirModalPod = (parada) => {
    setErro('')
    setModalPod(parada)
    setPodRecebedor(parada.recebedor_nome || '')
    setPodDocumento(parada.recebedor_documento || '')
    setPodTemp(parada.temperatura_entrega != null ? String(parada.temperatura_entrega) : '')
    setPodPagoOk(Boolean(parada.pagamento_confirmado))
    setPodFormaPg(parada.forma_pagamento_recebida || 'PIX')
    setPodValorPago(parada.valor_total ? Number(parada.valor_total).toFixed(2) : '')
    setPodAssinatura(parada.assinatura_url || '')
    setPodFoto(parada.canhoto_foto_url || '')
    setPodObs(parada.observacao_motorista || '')
    setPodTemDevolucaoParcial(false)
    setPodItensRecusados([])
  }

  const handleFotoPodChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setComprimindoFoto(true)
    try {
      const dataUrl = await comprimirFotoImagem(file, 1080, 0.72)
      setPodFoto(dataUrl)
    } catch (err) {
      setErro(err.message || 'Erro ao processar foto.')
    } finally {
      setComprimindoFoto(false)
      e.target.value = ''
    }
  }

  const toggleItemDevolucaoParcial = (it) => {
    setPodItensRecusados((prev) => {
      const existe = prev.find((x) => x.produto_id === it.produto_id)
      if (existe) return prev.filter((x) => x.produto_id !== it.produto_id)
      return [
        ...prev,
        {
          produto_id: it.produto_id,
          produto_descricao: it.produto_descricao,
          qtd_caixas: 1,
          peso_kg: Number(it.qtd_kg || 0),
          motivo: 'AVARIA',
        },
      ]
    })
  }

  const handleConfirmarEntregaPod = async (e) => {
    e.preventDefault()
    if (!modalPod) return
    setErro('')
    if (!podRecebedor.trim()) {
      setErro('Informe o nome de quem recebeu a mercadoria.')
      return
    }
    if (modalPod.pagamento_na_entrega && !podPagoOk) {
      setErro('Este pedido exige confirmar o Pagamento na Entrega antes de concluir.')
      return
    }

    setEnviandoPod(true)
    const gps = await obterGpsAtual(4500)
    const payload = {
      status_entrega: 'ENTREGUE',
      recebedor_nome: podRecebedor.trim(),
      recebedor_documento: podDocumento.trim(),
      temperatura_entrega: podTemp !== '' ? Number(String(podTemp).replace(',', '.')) : null,
      pagamento_confirmado: Boolean(podPagoOk),
      forma_pagamento_recebida: podPagoOk ? podFormaPg : '',
      valor_pago: podPagoOk && podValorPago ? Number(String(podValorPago).replace(',', '.')) : null,
      assinatura_url: podAssinatura || null,
      canhoto_foto_url: podFoto || null,
      observacao_motorista: podObs.trim(),
      itens_recusados: podTemDevolucaoParcial ? podItensRecusados : [],
      ...(gps ? { lat: gps.lat, lng: gps.lng } : {}),
    }

    try {
      await roteirizacaoQueries.atualizarParadaPublica(qrToken, modalPod.pedido_id, payload)
      setMsgSucesso(`Entrega #${modalPod.ordem_parada} (${modalPod.cliente}) confirmada com comprovante digital!`)
      setModalPod(null)
      await carregar()
    } catch (err) {
      if (!navigator.onLine) {
        enfileirarAcaoOffline({ tipo: 'PARADA', qrToken, pedidoId: modalPod.pedido_id, payload })
        atualizarFilaLocal()
        // Atualiza localmente no cache visual para o motorista continuar a rota
        setDados((prev) =>
          prev
            ? {
                ...prev,
                paradas: (prev.paradas || []).map((p) =>
                  p.pedido_id === modalPod.pedido_id
                    ? { ...p, status_entrega: 'ENTREGUE', recebedor_nome: payload.recebedor_nome, tem_assinatura: Boolean(payload.assinatura_url), tem_canhoto_foto: Boolean(payload.canhoto_foto_url) }
                    : p,
                ),
              }
            : prev,
        )
        setModalPod(null)
        setMsgSucesso(`Sem internet: comprovante de ${modalPod.cliente} salvo no celular e será enviado ao reconectar!`)
      } else {
        setErro(err.message)
      }
    } finally {
      setEnviandoPod(false)
    }
  }

  // Modal Recusa / Ocorrência
  const abrirModalRecusa = (parada) => {
    setErro('')
    setModalRecusa(parada)
    setRecusaMotivo('LOCAL_FECHADO')
    setRecusaObs('')
    setRecusaFoto('')
  }

  const handleFotoRecusaChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setComprimindoFoto(true)
    try {
      const dataUrl = await comprimirFotoImagem(file, 1080, 0.72)
      setRecusaFoto(dataUrl)
    } catch (err) {
      setErro(err.message || 'Erro ao processar foto.')
    } finally {
      setComprimindoFoto(false)
      e.target.value = ''
    }
  }

  const handleConfirmarRecusa = async (e) => {
    e.preventDefault()
    if (!modalRecusa) return
    setErro('')
    setEnviandoRecusa(true)
    const gps = await obterGpsAtual(4500)
    const motivoLabel = MOTIVOS_RECUSA.find((m) => m.id === recusaMotivo)?.label || recusaMotivo
    const payload = {
      status_entrega: 'DEVOLVIDA',
      motivo_recusa: motivoLabel,
      observacao_motorista: recusaObs.trim(),
      canhoto_foto_url: recusaFoto || null,
      ...(gps ? { lat: gps.lat, lng: gps.lng } : {}),
    }
    try {
      await roteirizacaoQueries.atualizarParadaPublica(qrToken, modalRecusa.pedido_id, payload)
      setMsgSucesso(`Recusa registrada para ${modalRecusa.cliente} — central de logística notificada automaticamente!`)
      setModalRecusa(null)
      await carregar()
    } catch (err) {
      if (!navigator.onLine) {
        enfileirarAcaoOffline({ tipo: 'PARADA', qrToken, pedidoId: modalRecusa.pedido_id, payload })
        atualizarFilaLocal()
        setModalRecusa(null)
        setMsgSucesso('Sem internet: recusa salva offline e será enviada automaticamente ao reconectar.')
      } else {
        setErro(err.message)
      }
    } finally {
      setEnviandoRecusa(false)
    }
  }

  const rota = dados?.rota
  const paradas = dados?.paradas || []

  const resumoProgresso = useMemo(() => {
    const total = paradas.length
    const entregues = paradas.filter((p) => p.status_entrega === 'ENTREGUE').length
    const recusadas = paradas.filter((p) => p.status_entrega === 'DEVOLVIDA').length
    const concluidas = entregues + recusadas
    const pendentes = total - concluidas
    const pct = total > 0 ? Math.round((concluidas / total) * 100) : 0
    return { total, entregues, recusadas, concluidas, pendentes, pct }
  }, [paradas])

  const paradasFiltradas = useMemo(() => {
    if (filtroParadas === 'PENDENTES') {
      return paradas.filter((p) => !['ENTREGUE', 'DEVOLVIDA'].includes(p.status_entrega))
    }
    if (filtroParadas === 'CONCLUIDAS') {
      return paradas.filter((p) => ['ENTREGUE', 'DEVOLVIDA'].includes(p.status_entrega))
    }
    return paradas
  }, [paradas, filtroParadas])

  if (loading && !dados) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', padding: 32, textAlign: 'center' }}>
        <RefreshCw size={24} className="spin" style={{ color: '#38bdf8', marginBottom: 10 }} />
        <div>Carregando roteiro de entrega...</div>
      </div>
    )
  }

  const checklistConcluido = Boolean(rota?.checklist_saida?.concluido_em)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b1120',
        color: '#f8fafc',
        paddingTop: 'max(10px, env(safe-area-inset-top))',
        paddingBottom: 'max(48px, env(safe-area-inset-bottom))',
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <div style={{ maxWidth: 580, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* HEADER STICKY MOBILE-FIRST */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 25,
            background: 'rgba(17, 28, 51, 0.96)',
            backdropFilter: 'blur(10px)',
            border: '1px solid #1e293b',
            borderRadius: 14,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => navigate('/motorista')}
                aria-label="Voltar às rotas"
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 9,
                  width: 34,
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <ArrowLeft size={16} />
              </button>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: '#38bdf8', fontWeight: 800, letterSpacing: '0.05em' }}>
                  APP MOTORISTA • {rota?.codigo || 'ROTA'}
                </div>
                <h1
                  style={{
                    fontSize: 15.5,
                    fontWeight: 800,
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {rota?.titulo || rota?.rota_nome || 'Roteiro de Entrega'}
                </h1>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '4px 8px',
                  borderRadius: 99,
                  background: online ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.18)',
                  color: online ? '#4ade80' : '#fca5a5',
                  border: `1px solid ${online ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.45)'}`,
                }}
              >
                {online ? <Wifi size={11} /> : <WifiOff size={11} />}
                {online ? 'Online' : 'Offline'}
              </span>
              <button
                type="button"
                onClick={handleEnviarGpsAgora}
                disabled={enviandoGps || !online}
                title="Enviar minha localização GPS para a central"
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 9,
                  height: 32,
                  padding: '0 9px',
                  color: '#38bdf8',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <MapPin size={13} /> {enviandoGps ? '...' : 'GPS'}
              </button>
              <button
                type="button"
                onClick={carregar}
                disabled={loading}
                aria-label="Atualizar rota"
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 9,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* BARRA DE PROGRESSO DA ROTA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#cbd5e1' }}>
              <span>
                <strong>{resumoProgresso.entregues}</strong> entregue(s)
                {resumoProgresso.recusadas > 0 ? ` • ${resumoProgresso.recusadas} recusa(s)` : ''} •{' '}
                <strong>{resumoProgresso.pendentes}</strong> restante(s)
              </span>
              <span style={{ fontWeight: 800, color: resumoProgresso.pct === 100 ? '#4ade80' : '#38bdf8' }}>
                {resumoProgresso.pct}%
              </span>
            </div>
            <div style={{ height: 7, background: '#0f172a', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${resumoProgresso.pct}%`,
                  height: '100%',
                  background: resumoProgresso.pct === 100 ? '#22c55e' : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        </div>

        {/* BANNER INSTALAÇÃO PWA NO IPHONE / ANDROID */}
        <PwaInstallBanner />

        {/* FILA OFFLINE PENDENTE DE SINCRONIZAÇÃO */}
        {filaOffline.length > 0 && (
          <div
            style={{
              background: 'rgba(245,158,11,0.16)',
              border: '1px solid #f59e0b',
              borderRadius: 12,
              padding: '10px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12.5, color: '#fde68a' }}>
              <strong>{filaOffline.length}</strong> registro(s) salvo(s) offline aguardando sinal.
            </div>
            <button
              type="button"
              className="btn btn--warning btn--sm"
              disabled={!online || sincronizandoFila}
              onClick={sincronizarFilaOffline}
            >
              {sincronizandoFila ? 'Enviando...' : 'Sincronizar'}
            </button>
          </div>
        )}

        {erro && (
          <div
            style={{
              background: 'rgba(239,68,68,0.16)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              padding: '10px 14px',
              borderRadius: 12,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{erro}</span>
            <button type="button" onClick={() => setErro('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>
        )}

        {msgSucesso && (
          <div
            style={{
              background: 'rgba(34,197,94,0.16)',
              border: '1px solid #22c55e',
              color: '#86efac',
              padding: '10px 14px',
              borderRadius: 12,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{msgSucesso}</span>
            <button type="button" onClick={() => setMsgSucesso('')} style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* BLOCO 1: CHECKLIST PRÉ-VIAGEM & DADOS DO VEÍCULO (COLAPSÁVEL) */}
        {rota && (
          <div
            style={{
              background: '#111c33',
              border: `1px solid ${checklistConcluido ? 'rgba(34,197,94,0.45)' : '#1e293b'}`,
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setChecklistAberto((v) => !v)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '13px 15px',
                color: '#f8fafc',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <ClipboardCheck size={18} color={checklistConcluido ? '#4ade80' : '#38bdf8'} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800 }}>
                    {checklistConcluido ? 'Checklist de Saída Confirmado' : 'Checklist de Saída & Veículo'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                    {rota.motorista_nome || 'Informe motorista'} • Placa {rota.veiculo_placa || '—'}
                    {rota.temperatura_bau != null ? ` • Baú ${rota.temperatura_bau}°C` : ''}
                  </div>
                </div>
              </div>
              {checklistAberto ? <ChevronUp size={18} color="#94a3b8" /> : <ChevronDown size={18} color="#94a3b8" />}
            </button>

            {checklistAberto && (
              <form
                onSubmit={handleIniciarRota}
                style={{
                  padding: '0 15px 15px',
                  borderTop: '1px solid #1e293b',
                  paddingTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 11,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="form-label">Nome do Motorista *</label>
                    <input
                      className="form-input"
                      style={{ height: 42 }}
                      placeholder="Ex: Carlos Silva"
                      value={motoristaNome}
                      onChange={(e) => setMotoristaNome(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Placa do Veículo *</label>
                    <input
                      className="form-input font-mono"
                      style={{ height: 42, fontWeight: 700 }}
                      placeholder="Ex: ABC-1D23"
                      value={veiculoPlaca}
                      onChange={(e) => setVeiculoPlaca(e.target.value.toUpperCase())}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="form-label">Temp. Baú na Saída (°C)</label>
                    <input
                      type="number"
                      step="0.1"
                      className="form-input font-mono"
                      style={{ height: 42 }}
                      placeholder="Ex: 2.0 ou -18.0"
                      value={tempSaida}
                      onChange={(e) => setTempSaida(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Odômetro Saída (km)</label>
                    <input
                      type="number"
                      className="form-input font-mono"
                      style={{ height: 42 }}
                      placeholder="Ex: 145820"
                      value={odometroSaida}
                      onChange={(e) => setOdometroSaida(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[
                    { checked: ckBauLimpo, set: setCkBauLimpo, label: 'Baú refrigerado higienizado e sem odores' },
                    { checked: ckTempOk, set: setCkTempOk, label: 'Temperatura do baú dentro da faixa exigida' },
                    { checked: ckDocsOk, set: setCkDocsOk, label: 'Notas Fiscais / Romaneio conferidos em mãos' },
                    { checked: ckCargaLacrada, set: setCkCargaLacrada, label: 'Carga acondicionada e portas travadas' },
                  ].map((item) => (
                    <label
                      key={item.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 11px',
                        borderRadius: 9,
                        background: item.checked ? 'rgba(34,197,94,0.1)' : '#0f172a',
                        border: `1px solid ${item.checked ? 'rgba(34,197,94,0.4)' : '#1e293b'}`,
                        fontSize: 12.5,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) => item.set(e.target.checked)}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>

                <input
                  className="form-input"
                  style={{ height: 40, fontSize: 12.5 }}
                  placeholder="Observação do veículo/saída (opcional)..."
                  value={obsChecklist}
                  onChange={(e) => setObsChecklist(e.target.value)}
                />

                <button
                  type="submit"
                  className="btn btn--primary"
                  style={{ height: 46, fontSize: 14, fontWeight: 800, justifyContent: 'center' }}
                  disabled={iniciando}
                >
                  <Navigation size={16} />{' '}
                  {iniciando ? 'Confirmando...' : checklistConcluido ? 'Atualizar Checklist & Veículo' : 'Confirmar Checklist & Iniciar Rota'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* FILTROS RÁPIDOS DE PARADAS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[
            { id: 'PENDENTES', label: `Pendentes (${resumoProgresso.pendentes})` },
            { id: 'CONCLUIDAS', label: `Concluídas (${resumoProgresso.concluidas})` },
            { id: 'TODAS', label: `Todas (${resumoProgresso.total})` },
          ].map((f) => {
            const ativo = filtroParadas === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltroParadas(f.id)}
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: `1.5px solid ${ativo ? '#38bdf8' : '#1e293b'}`,
                  background: ativo ? 'rgba(56,189,248,0.16)' : '#111c33',
                  color: ativo ? '#ffffff' : '#94a3b8',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        {/* LISTA DE PARADAS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {paradasFiltradas.length === 0 ? (
            <div
              style={{
                background: '#111c33',
                border: '1px solid #1e293b',
                borderRadius: 14,
                padding: 28,
                textAlign: 'center',
                color: '#94a3b8',
              }}
            >
              {filtroParadas === 'PENDENTES' && resumoProgresso.total > 0 ? (
                <>
                  <CheckCircle2 size={36} color="#22c55e" style={{ marginBottom: 8 }} />
                  <div style={{ fontWeight: 800, color: '#4ade80', fontSize: 15 }}>Todas as entregas concluídas!</div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>Bom retorno à base. Você pode revisar os comprovantes na aba Concluídas.</div>
                </>
              ) : (
                'Nenhuma parada neste filtro.'
              )}
            </div>
          ) : (
            paradasFiltradas.map((p) => {
              const st = STATUS_CFG[p.status_entrega] || STATUS_CFG.PENDENTE
              const finalizada = p.status_entrega === 'ENTREGUE' || p.status_entrega === 'DEVOLVIDA'
              const expandida = paradaExpandidaId === p.pedido_id
              const linkWpp = gerarLinkWhatsApp(
                p.telefone,
                `Olá! Sou o motorista da entrega do pedido ${p.pedido_codigo}. Estou a caminho do seu endereço!`,
              )

              return (
                <div
                  key={p.pedido_id}
                  style={{
                    background: '#111c33',
                    border: `1.5px solid ${
                      p.status_entrega === 'ENTREGUE'
                        ? 'rgba(34,197,94,0.45)'
                        : p.status_entrega === 'DEVOLVIDA'
                          ? 'rgba(239,68,68,0.5)'
                          : p.status_entrega === 'NO_CLIENTE'
                            ? '#38bdf8'
                            : '#1e293b'
                    }`,
                    borderRadius: 14,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* TOPO DO CARD */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: finalizada ? 'rgba(34,197,94,0.16)' : 'rgba(56,189,248,0.18)',
                          color: finalizada ? '#4ade80' : '#38bdf8',
                          fontWeight: 900,
                          fontSize: 13,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        #{p.ordem_parada}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13.5, color: '#e2e8f0' }}>
                        {p.pedido_codigo}
                        {p.numero_nf ? ` • NF ${p.numero_nf}` : ''}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '3px 9px',
                        borderRadius: 99,
                        background: st.bg,
                        color: st.color,
                        border: `1px solid ${st.border}`,
                      }}
                    >
                      {st.label}
                    </span>
                  </div>

                  {/* CLIENTE & ENDEREÇO */}
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: '#ffffff' }}>{p.cliente}</div>
                    <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                      <MapPin size={14} style={{ flexShrink: 0, marginTop: 2, color: '#38bdf8' }} />
                      <span>{p.endereco_completo || 'Endereço no cadastro do cliente'}</span>
                    </div>
                  </div>

                  {/* RESUMO CARGA + BOTÃO EXPANDIR ITENS */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#0b1224',
                      border: '1px solid #1e293b',
                      borderRadius: 10,
                      padding: '8px 11px',
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontWeight: 700 }}>
                      <Package size={15} color="#38bdf8" />
                      {p.total_caixas} cx • {Number(p.total_kg || 0).toFixed(2).replace('.', ',')} kg
                    </span>
                    <button
                      type="button"
                      onClick={() => setParadaExpandidaId(expandida ? null : p.pedido_id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#60a5fa',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {expandida ? 'Ocultar itens' : `Ver ${(p.itens_pedido || []).length} item(ns)`}
                      {expandida ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {expandida && (p.itens_pedido || []).length > 0 && (
                    <div
                      style={{
                        background: '#0b1224',
                        border: '1px solid #1e293b',
                        borderRadius: 10,
                        padding: '8px 11px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      {p.itens_pedido.map((it, i) => (
                        <div
                          key={`${it.produto_id}-${i}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 12,
                            borderBottom: i < p.itens_pedido.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                            paddingBottom: i < p.itens_pedido.length - 1 ? 5 : 0,
                          }}
                        >
                          <span style={{ color: '#e2e8f0' }}>
                            <strong className="font-mono text-info">{it.produto_codigo}</strong> {it.produto_descricao}
                          </span>
                          <span className="font-mono font-bold" style={{ color: '#cbd5e1', flexShrink: 0, marginLeft: 8 }}>
                            {Number(it.qtd_kg || 0).toFixed(2).replace('.', ',')} kg
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ALERTA COBRANÇA NA ENTREGA */}
                  {p.pagamento_na_entrega && !finalizada && (
                    <div
                      style={{
                        background: 'rgba(245,158,11,0.14)',
                        border: '1px solid rgba(245,158,11,0.55)',
                        borderRadius: 10,
                        padding: '9px 12px',
                        fontSize: 12.5,
                        color: '#fde68a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <DollarSign size={17} color="#fbbf24" style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Cobrar na Entrega: {fmtMoeda(p.valor_total)}</strong>
                        <div style={{ fontSize: 11, opacity: 0.9 }}>
                          Confirme o recebimento (PIX, Cartão ou Dinheiro) ao finalizar esta parada.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ATALHOS NATIVOS DO IPHONE / ANDROID (WAZE, MAPS, LIGAR, WHATSAPP) */}
                  {!finalizada && (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p.telefone ? 4 : 2}, 1fr)`, gap: 6 }}>
                      <a
                        href={gerarLinkWaze(p.endereco_completo || p.cliente)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: 'rgba(56,189,248,0.14)',
                          border: '1px solid rgba(56,189,248,0.35)',
                          borderRadius: 9,
                          padding: '9px 6px',
                          color: '#7dd3fc',
                          fontSize: 12,
                          fontWeight: 700,
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                        }}
                      >
                        <Navigation size={13} /> Waze
                      </a>
                      <a
                        href={gerarLinkMaps(p.endereco_completo || p.cliente)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: 'rgba(59,130,246,0.14)',
                          border: '1px solid rgba(59,130,246,0.35)',
                          borderRadius: 9,
                          padding: '9px 6px',
                          color: '#93c5fd',
                          fontSize: 12,
                          fontWeight: 700,
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                        }}
                      >
                        <MapPin size={13} /> Maps
                      </a>
                      {p.telefone && (
                        <>
                          <a
                            href={`tel:${String(p.telefone).replace(/\D/g, '')}`}
                            style={{
                              background: 'rgba(148,163,184,0.14)',
                              border: '1px solid #334155',
                              borderRadius: 9,
                              padding: '9px 6px',
                              color: '#e2e8f0',
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: 'none',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 5,
                            }}
                          >
                            <Phone size={13} /> Ligar
                          </a>
                          <a
                            href={linkWpp}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              background: 'rgba(34,197,94,0.14)',
                              border: '1px solid rgba(34,197,94,0.35)',
                              borderRadius: 9,
                              padding: '9px 6px',
                              color: '#86efac',
                              fontSize: 12,
                              fontWeight: 700,
                              textDecoration: 'none',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 5,
                            }}
                          >
                            <MessageCircle size={13} /> Zap
                          </a>
                        </>
                      )}
                    </div>
                  )}

                  {/* BOTÕES PRINCIPAIS DA PARADA PENDENTE */}
                  {!finalizada ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                      {p.status_entrega !== 'NO_CLIENTE' && (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          style={{ height: 44, justifyContent: 'center', fontWeight: 700 }}
                          disabled={salvandoId === p.pedido_id}
                          onClick={() => handleChegueiNoCliente(p)}
                        >
                          <MapPin size={16} />{' '}
                          {salvandoId === p.pedido_id ? 'Registrando chegada...' : 'Cheguei no Cliente'}
                        </button>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn--success"
                          style={{ height: 48, justifyContent: 'center', fontWeight: 800, fontSize: 13.5 }}
                          onClick={() => abrirModalPod(p)}
                        >
                          <CheckCircle2 size={17} /> Entregar (Comprovante)
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger"
                          style={{ height: 48, justifyContent: 'center', fontWeight: 700, fontSize: 13 }}
                          onClick={() => abrirModalRecusa(p)}
                        >
                          <XCircle size={16} /> Recusa
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* RESUMO DA PARADA CONCLUÍDA / RECUSADA */
                    <div
                      style={{
                        background: '#0b1224',
                        borderRadius: 10,
                        padding: '10px 12px',
                        fontSize: 12,
                        color: '#cbd5e1',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                        <span>
                          {p.status_entrega === 'ENTREGUE' ? (
                            <>
                              Recebido por: <strong style={{ color: '#ffffff' }}>{p.recebedor_nome || 'Não informado'}</strong>
                            </>
                          ) : (
                            <>
                              Motivo: <strong style={{ color: '#fca5a5' }}>{p.motivo_recusa || 'Recusa registrada'}</strong>
                            </>
                          )}
                        </span>
                        {p.concluido_at && (
                          <span style={{ color: '#94a3b8' }}>
                            <Clock size={11} style={{ verticalAlign: 'middle' }} /> {fmtHora(p.concluido_at)}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {p.tem_assinatura && <span className="badge badge--success" style={{ fontSize: 10 }}>✓ Assinado</span>}
                        {p.tem_canhoto_foto && <span className="badge badge--info" style={{ fontSize: 10 }}>✓ Foto Canhoto</span>}
                        {p.pagamento_confirmado && (
                          <span className="badge badge--success" style={{ fontSize: 10 }}>
                            ✓ Pago {p.forma_pagamento_recebida || ''}
                          </span>
                        )}
                        {p.temperatura_entrega != null && (
                          <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                            {p.temperatura_entrega}°C
                          </span>
                        )}
                        {(p.itens_recusados || []).length > 0 && (
                          <span className="badge badge--warning" style={{ fontSize: 10 }}>
                            Devolução parcial ({p.itens_recusados.length})
                          </span>
                        )}
                      </div>

                      {(p.canhoto_foto_url || p.assinatura_url) && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          style={{ alignSelf: 'flex-start', marginTop: 2 }}
                          onClick={() => setPodVisualizar(p)}
                        >
                          <ShieldCheck size={13} /> Ver Comprovante Digital
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: COMPROVANTE DIGITAL DE ENTREGA (POD — FOTO + ASSINATURA + PG) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalPod && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(5, 9, 18, 0.88)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={(e) => e.target === e.currentTarget && !enviandoPod && setModalPod(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 580,
              maxHeight: '94vh',
              background: '#0f172a',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              border: '1px solid #334155',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                background: '#111c33',
                borderBottom: '1px solid #1e293b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#4ade80' }}>
                  COMPROVANTE DIGITAL • PARADA #{modalPod.ordem_parada}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 800 }}>{modalPod.cliente}</div>
              </div>
              <button
                type="button"
                onClick={() => !enviandoPod && setModalPod(null)}
                style={{ background: '#1e293b', border: 'none', color: '#cbd5e1', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleConfirmarEntregaPod}
              style={{
                padding: 16,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {/* RECEBEDOR */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">Quem recebeu? (Nome) *</label>
                  <input
                    className="form-input"
                    style={{ height: 44 }}
                    placeholder="Ex: João (Açougue)"
                    value={podRecebedor}
                    onChange={(e) => setPodRecebedor(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">RG / CPF (Opcional)</label>
                  <input
                    className="form-input font-mono"
                    style={{ height: 44 }}
                    placeholder="Documento"
                    value={podDocumento}
                    onChange={(e) => setPodDocumento(e.target.value)}
                  />
                </div>
              </div>

              {/* TEMPERATURA NA ENTREGA */}
              <div>
                <label className="form-label">
                  <Thermometer size={12} style={{ verticalAlign: 'middle' }} /> Temperatura na Entrega (°C) — Opcional
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input font-mono"
                    style={{ width: 110, height: 40 }}
                    placeholder="Ex: 2.5"
                    value={podTemp}
                    onChange={(e) => setPodTemp(e.target.value)}
                  />
                  {['0', '2', '4', '-18'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`btn btn--sm ${podTemp === t ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setPodTemp(t)}
                    >
                      {t}°C
                    </button>
                  ))}
                </div>
              </div>

              {/* PAGAMENTO NA ENTREGA */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 11,
                  background: modalPod.pagamento_na_entrega ? 'rgba(245,158,11,0.12)' : '#111c33',
                  border: `1px solid ${modalPod.pagamento_na_entrega ? 'rgba(245,158,11,0.5)' : '#1e293b'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={podPagoOk}
                    onChange={(e) => setPodPagoOk(e.target.checked)}
                    style={{ width: 20, height: 20 }}
                  />
                  <span>
                    {modalPod.pagamento_na_entrega
                      ? `Confirmo recebimento obrigatório (${fmtMoeda(modalPod.valor_total)})`
                      : `Recebi pagamento na entrega (${fmtMoeda(modalPod.valor_total)})`}
                  </span>
                </label>

                {podPagoOk && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                      {FORMAS_PAGAMENTO.map((fp) => (
                        <button
                          key={fp}
                          type="button"
                          onClick={() => setPodFormaPg(fp)}
                          style={{
                            height: 36,
                            borderRadius: 8,
                            border: `1.5px solid ${podFormaPg === fp ? '#22c55e' : '#334155'}`,
                            background: podFormaPg === fp ? 'rgba(34,197,94,0.18)' : '#0b1224',
                            color: podFormaPg === fp ? '#86efac' : '#cbd5e1',
                            fontSize: 11.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {fp}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="form-label">Valor Recebido (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input font-mono"
                        style={{ height: 40, fontWeight: 700 }}
                        value={podValorPago}
                        onChange={(e) => setPodValorPago(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ASSINATURA DIGITAL NA TELA */}
              <AssinaturaCanvas value={podAssinatura} onChange={setPodAssinatura} height={155} />

              {/* FOTO DO CANHOTO / NOTA (CÂMERA DO IPHONE) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Camera size={13} color="#38bdf8" /> FOTO DO CANHOTO ASSINADO / CARGA
                </div>
                <input
                  ref={inputFotoPodRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleFotoPodChange}
                />
                {podFoto ? (
                  <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '2px solid #22c55e' }}>
                    <img src={podFoto} alt="Foto do canhoto" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
                    <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => inputFotoPodRef.current?.click()}
                      >
                        <Camera size={13} /> Refazer
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => setPodFoto('')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => inputFotoPodRef.current?.click()}
                    disabled={comprimindoFoto}
                    style={{
                      height: 52,
                      borderRadius: 11,
                      border: '1.5px dashed #38bdf8',
                      background: 'rgba(56,189,248,0.08)',
                      color: '#7dd3fc',
                      fontWeight: 700,
                      fontSize: 13.5,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <Camera size={18} /> {comprimindoFoto ? 'Processando foto...' : 'Tirar Foto do Canhoto com a Câmera'}
                  </button>
                )}
              </div>

              {/* DEVOLUÇÃO PARCIAL (OPCIONAL) */}
              {(modalPod.itens_pedido || []).length > 0 && (
                <div style={{ padding: 12, borderRadius: 11, background: '#111c33', border: '1px solid #1e293b' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#fbbf24' }}>
                    <input
                      type="checkbox"
                      checked={podTemDevolucaoParcial}
                      onChange={(e) => setPodTemDevolucaoParcial(e.target.checked)}
                      style={{ width: 17, height: 17 }}
                    />
                    Houve devolução parcial de algum item nesta entrega?
                  </label>

                  {podTemDevolucaoParcial && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {modalPod.itens_pedido.map((it) => {
                        const sel = podItensRecusados.find((x) => x.produto_id === it.produto_id)
                        return (
                          <div
                            key={it.produto_id}
                            style={{
                              padding: 9,
                              borderRadius: 8,
                              background: sel ? 'rgba(245,158,11,0.14)' : '#0b1224',
                              border: `1px solid ${sel ? '#f59e0b' : '#1e293b'}`,
                            }}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                              <input type="checkbox" checked={Boolean(sel)} onChange={() => toggleItemDevolucaoParcial(it)} />
                              <strong>{it.produto_descricao}</strong> ({Number(it.qtd_kg || 0).toFixed(2)} kg)
                            </label>
                            {sel && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: 6, marginTop: 8 }}>
                                <input
                                  type="number"
                                  min="1"
                                  className="form-input font-mono"
                                  style={{ height: 34, fontSize: 12 }}
                                  placeholder="Cx"
                                  value={sel.qtd_caixas}
                                  onChange={(e) =>
                                    setPodItensRecusados((prev) =>
                                      prev.map((x) => (x.produto_id === it.produto_id ? { ...x, qtd_caixas: Number(e.target.value || 0) } : x)),
                                    )
                                  }
                                />
                                <input
                                  type="number"
                                  step="0.1"
                                  className="form-input font-mono"
                                  style={{ height: 34, fontSize: 12 }}
                                  placeholder="Kg"
                                  value={sel.peso_kg}
                                  onChange={(e) =>
                                    setPodItensRecusados((prev) =>
                                      prev.map((x) => (x.produto_id === it.produto_id ? { ...x, peso_kg: Number(e.target.value || 0) } : x)),
                                    )
                                  }
                                />
                                <select
                                  className="form-input"
                                  style={{ height: 34, fontSize: 11.5 }}
                                  value={sel.motivo}
                                  onChange={(e) =>
                                    setPodItensRecusados((prev) =>
                                      prev.map((x) => (x.produto_id === it.produto_id ? { ...x, motivo: e.target.value } : x)),
                                    )
                                  }
                                >
                                  {MOTIVOS_RECUSA.map((m) => (
                                    <option key={m.id} value={m.label}>{m.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="form-label">Observações da Entrega (Opcional)</label>
                <input
                  className="form-input"
                  style={{ height: 42 }}
                  placeholder="Ex: Descarregado na doca 2..."
                  value={podObs}
                  onChange={(e) => setPodObs(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn--success"
                style={{ height: 52, fontSize: 15, fontWeight: 800, justifyContent: 'center', marginTop: 4 }}
                disabled={enviandoPod || comprimindoFoto}
              >
                <CheckCircle2 size={19} />{' '}
                {enviandoPod ? 'Enviando comprovante...' : 'Confirmar Entrega & Enviar Comprovante'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: RECUSA / OCORRÊNCIA NA ENTREGA                                */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalRecusa && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(5, 9, 18, 0.88)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={(e) => e.target === e.currentTarget && !enviandoRecusa && setModalRecusa(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: '92vh',
              background: '#0f172a',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              border: '1px solid #ef444466',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                background: 'rgba(239,68,68,0.14)',
                borderBottom: '1px solid rgba(239,68,68,0.35)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#fca5a5' }}>
                  REGISTRAR RECUSA / OCORRÊNCIA
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 800 }}>{modalRecusa.cliente}</div>
              </div>
              <button
                type="button"
                onClick={() => !enviandoRecusa && setModalRecusa(null)}
                style={{ background: '#1e293b', border: 'none', color: '#cbd5e1', borderRadius: 8, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmarRecusa} style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label className="form-label">Selecione o Motivo *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {MOTIVOS_RECUSA.map((m) => {
                    const ativo = recusaMotivo === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setRecusaMotivo(m.id)}
                        style={{
                          padding: '10px 8px',
                          borderRadius: 9,
                          border: `1.5px solid ${ativo ? '#ef4444' : '#334155'}`,
                          background: ativo ? 'rgba(239,68,68,0.2)' : '#111c33',
                          color: ativo ? '#ffffff' : '#cbd5e1',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="form-label">Foto da Ocorrência / Fachada (Recomendado)</label>
                <input
                  ref={inputFotoRecusaRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleFotoRecusaChange}
                />
                {recusaFoto ? (
                  <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '2px solid #ef4444' }}>
                    <img src={recusaFoto} alt="Foto recusa" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      style={{ position: 'absolute', top: 8, right: 8 }}
                      onClick={() => setRecusaFoto('')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => inputFotoRecusaRef.current?.click()}
                    style={{
                      width: '100%',
                      height: 48,
                      borderRadius: 10,
                      border: '1.5px dashed #ef4444',
                      background: 'rgba(239,68,68,0.08)',
                      color: '#fca5a5',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <Camera size={17} /> Tirar Foto da Ocorrência
                  </button>
                )}
              </div>

              <div>
                <label className="form-label">Detalhes / Quem falou no local</label>
                <input
                  className="form-input"
                  style={{ height: 42 }}
                  placeholder="Ex: Portão fechado às 14h20, ninguém atendeu o telefone..."
                  value={recusaObs}
                  onChange={(e) => setRecusaObs(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn btn--danger"
                style={{ height: 50, fontSize: 14.5, fontWeight: 800, justifyContent: 'center' }}
                disabled={enviandoRecusa}
              >
                <AlertTriangle size={18} /> {enviandoRecusa ? 'Registrando...' : 'Registrar Recusa & Alertar Central'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: VISUALIZAR COMPROVANTE JÁ ENVIADO */}
      {podVisualizar && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1250,
            background: 'rgba(5, 9, 18, 0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => e.target === e.currentTarget && setPodVisualizar(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 500,
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#111c33',
              border: '1px solid #334155',
              borderRadius: 14,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Comprovante — {podVisualizar.pedido_codigo}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPodVisualizar(null)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1' }}>
              <div><strong>Cliente:</strong> {podVisualizar.cliente}</div>
              {podVisualizar.recebedor_nome && <div><strong>Recebedor:</strong> {podVisualizar.recebedor_nome}</div>}
              {podVisualizar.entrega_lat != null && podVisualizar.entrega_lng != null && (
                <a
                  href={gerarLinkGoogleMapsCoords(podVisualizar.entrega_lat, podVisualizar.entrega_lng)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#38bdf8', fontSize: 12 }}
                >
                  Ver localização GPS da entrega no mapa ↗
                </a>
              )}
            </div>
            {podVisualizar.assinatura_url && (
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>ASSINATURA DIGITAL</div>
                <img src={podVisualizar.assinatura_url} alt="Assinatura" style={{ width: '100%', borderRadius: 8, background: '#fff' }} />
              </div>
            )}
            {podVisualizar.canhoto_foto_url && (
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>FOTO DO CANHOTO / OCORRÊNCIA</div>
                <img src={podVisualizar.canhoto_foto_url} alt="Canhoto" style={{ width: '100%', borderRadius: 8 }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
