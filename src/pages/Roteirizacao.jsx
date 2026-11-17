import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Package,
  Copy,
  RefreshCw,
  DollarSign,
  RotateCcw,
  X,
  ShieldAlert,
  Navigation,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { temAlgumaPermissao, temPermissao } from '../utils/permissoes'
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

export function Roteirizacao() {
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
  const [loading, setLoading] = useState(false)

  // Embarque aberto
  const [embarqueAtivo, setEmbarqueAtivo] = useState(null)
  const [abaDetalhe, setAbaDetalhe] = useState(() => (podeCarregar && !podeGerir ? 'CARREGAMENTO' : 'MONTAGEM'))

  // Edição do embarque aberto
  const [formDados, setFormDados] = useState({
    titulo: '',
    data_embarque: hojeIso(),
    rota_id: '',
    transportadora_id: '',
    motorista_nome: '',
    veiculo_placa: '',
    modalidade_impressao: 'OPCAO_B',
    numero_nf_lote: '',
    observacoes: '',
  })

  // Carregamento bipado
  const [eanBipe, setEanBipe] = useState('')
  const [erroBipe, setErroBipe] = useState('')
  const [ultimoBipeInfo, setUltimoBipeInfo] = useState(null)
  const [bipando, setBipando] = useState(false)
  const scannerRef = useRef(null)

  // Modais: Novo Embarque, Puxar Pedidos, Config, QR Code, Impressão
  const [modalNovoOpen, setModalNovoOpen] = useState(false)
  const [novoForm, setNovoForm] = useState({
    data_embarque: hojeIso(),
    titulo: '',
    rota_id: '',
    transportadora_id: '',
    motorista_nome: '',
    veiculo_placa: '',
    modalidade_impressao: 'OPCAO_B',
    observacoes: '',
    pedido_ids: [],
  })
  const [pedidosElegiveis, setPedidosElegiveis] = useState([])
  const [modalPedidosOpen, setModalPedidosOpen] = useState(false)
  const [pedidosModalSel, setPedidosModalSel] = useState([])
  const [somenteProntos, setSomenteProntos] = useState(false)

  const [modalConfigOpen, setModalConfigOpen] = useState(false)
  const [modalQrData, setModalQrData] = useState({ open: false, dataUrl: '', url: '' })
  const [printCfg, setPrintCfg] = useState(null) // { embarque, modo }
  const [autoRefresh, setAutoRefresh] = useState(false)

  const carregarLista = useCallback(async () => {
    if (!apiAtiva || !podeAcessar) return
    setLoading(true)
    try {
      const [resEmb, resRotas, resTransp] = await Promise.all([
        roteirizacaoQueries.listarEmbarques(grupoLista),
        podeGerir ? cadastrosQueries.listarRotas().catch(() => []) : Promise.resolve([]),
        podeGerir ? cadastrosQueries.listarTransportadoras().catch(() => []) : Promise.resolve([]),
      ])
      setEmbarques(resEmb?.data || [])
      if (resEmb?.config) setConfigModulos(resEmb.config)
      setRotas(resRotas || [])
      setTransportadoras(resTransp || [])
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
          rota_id: d.rota_id || '',
          transportadora_id: d.transportadora_id || '',
          motorista_nome: d.motorista_nome || '',
          veiculo_placa: d.veiculo_placa || '',
          modalidade_impressao: d.modalidade_impressao || 'OPCAO_B',
          numero_nf_lote: d.numero_nf_lote || '',
          observacoes: d.observacoes || '',
        })
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

  const abrirModalNovoEmbarque = async () => {
    try {
      const disp = await roteirizacaoQueries.listarPedidosDisponiveis(null)
      setPedidosElegiveis(disp || [])
      setNovoForm({
        data_embarque: hojeIso(),
        titulo: '',
        rota_id: '',
        transportadora_id: '',
        motorista_nome: '',
        veiculo_placa: '',
        modalidade_impressao: configModulos.impressao_romaneio_padrao || 'OPCAO_B',
        observacoes: '',
        pedido_ids: [],
      })
      setModalNovoOpen(true)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleCriarEmbarque = async (e) => {
    e.preventDefault()
    try {
      const res = await roteirizacaoQueries.criarEmbarque({
        ...novoForm,
        rota_id: novoForm.rota_id || null,
        transportadora_id: novoForm.transportadora_id || null,
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
      })
      toastSuccess('Dados do roteiro atualizados!')
      await abrirEmbarque(embarqueAtivo.id)
      carregarLista()
    } catch (err) {
      toastError('Erro ao salvar', err.message)
    }
  }

  const abrirModalAdicionarPedidos = async () => {
    try {
      const disp = await roteirizacaoQueries.listarPedidosDisponiveis(embarqueAtivo.id)
      setPedidosElegiveis(disp || [])
      setPedidosModalSel([])
      setModalPedidosOpen(true)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleConfirmarAddPedidos = async () => {
    if (pedidosModalSel.length === 0) return toastWarning('Selecione ao menos 1 pedido.')
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

  const handleBiparCaixaCarregamento = async (e) => {
    e.preventDefault()
    const cod = String(eanBipe || '').trim()
    if (!cod) return
    setErroBipe('')
    setBipando(true)
    try {
      const res = await roteirizacaoQueries.carregarCaixa(embarqueAtivo.id, cod)
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

  const handleDespachar = async () => {
    const res = embarqueAtivo?.resumo || {}
    const faltantes = Number(res.total_caixas || 0) - Number(res.caixas_carregadas || 0)
    let ignorarPendentes = false
    if (faltantes > 0 || Number(res.total_caixas || 0) === 0) {
      const ok = await confirmar({
        title: 'Atenção: Caixas Pendentes no Carregamento',
        message:
          Number(res.total_caixas || 0) === 0
            ? 'Este embarque ainda não possui caixas separadas. Deseja apenas colocar o roteiro em EM ROTA sem expedir estoque?'
            : `Ainda faltam ${faltantes} caixa(s) para bipar no carregamento deste veículo. Deseja liberar mesmo assim os pedidos já 100% carregados?`,
        type: 'warning',
        confirmLabel: 'Confirmar Liberação',
      })
      if (!ok) return
      ignorarPendentes = true
    } else {
      const ok = await confirmar({
        title: `Concluir Carregamento & Despachar ${embarqueAtivo.codigo}`,
        message: `Todas as ${res.total_caixas} caixas foram bipadas (${fmtKg(res.peso_real_kg)}). Confirmar expedição e colocar o veículo EM ROTA?`,
        confirmLabel: 'Expedir e Iniciar Rota',
      })
      if (!ok) return
    }

    try {
      const r = await roteirizacaoQueries.despacharEmbarque(embarqueAtivo.id, {
        veiculo_placa: formDados.veiculo_placa,
        motorista_nome: formDados.motorista_nome,
        numero_nf_lote: formDados.numero_nf_lote,
        ignorar_caixas_pendentes: ignorarPendentes,
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

  // Trava inteligente de impressão (Opção B padrão ou Opção A Prévia / Oficial)
  const handleImprimirRomaneioRota = async (modoForcado = null) => {
    const emb = embarqueAtivo
    if (!emb || (emb.paradas || []).length === 0) {
      return toastWarning('Adicione ao menos 1 pedido ao roteiro antes de imprimir.')
    }
    const modalidade = emb.modalidade_impressao || configModulos.impressao_romaneio_padrao || 'OPCAO_B'
    const resumo = emb.resumo || {}
    const semPesoReal = Number(resumo.pedidos_sem_peso_real || 0)
    const tudoCarregado = Number(resumo.total_caixas || 0) > 0 && resumo.caixas_carregadas >= resumo.total_caixas

    if (modoForcado === 'OPCAO_A_PREVIA') {
      setPrintCfg({ embarque: emb, modo: 'OPCAO_A_PREVIA' })
      return
    }

    if (semPesoReal > 0) {
      const ok = await confirmar({
        title: 'Aviso: Roteiro sem Pesos Reais / Pronto para Faturamento',
        message: `Existem ${semPesoReal} pedido(s) neste roteiro que ainda estão em separação ou sem pesos reais pesados. Deseja imprimir mesmo assim uma via prévia (sem pesos definitivos para faturamento)?`,
        type: 'warning',
        confirmLabel: 'Imprimir Via Prévia',
      })
      if (!ok) return
      setPrintCfg({
        embarque: emb,
        modo: modalidade === 'OPCAO_A' ? 'OPCAO_A_PREVIA' : 'OPCAO_B',
      })
      return
    }

    if (modalidade === 'OPCAO_A') {
      setPrintCfg({
        embarque: emb,
        modo: tudoCarregado || modoForcado === 'OPCAO_A_OFICIAL' ? 'OPCAO_A_OFICIAL' : 'OPCAO_A_PREVIA',
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
        message: `Este pedido possui Pagamento na Entrega de ${fmtMoeda(parada.valor_total)}. Confirma que o recebimento (PIX/Cartão/Dinheiro) foi efetuado?`,
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
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 14,
              }}
            >
              {embarques.map((emb) => {
                const st = STATUS_EMB_BADGE[emb.status] || { label: emb.status, cls: 'badge--neutral', cor: '#38bdf8' }
                const totalPed = Number(emb.total_pedidos || 0)
                const totalCx = Number(emb.total_caixas || 0)
                const cxCarr = Number(emb.caixas_carregadas || 0)
                const pctCarga = totalCx > 0 ? Math.min(100, Math.round((cxCarr / totalCx) * 100)) : totalPed > 0 ? 0 : 0
                const pctEntr = totalPed > 0 ? Math.min(100, Math.round((Number(emb.pedidos_entregues || 0) / totalPed) * 100)) : 0
                const pctBarra = emb.status === 'EM_ROTA' || emb.status === 'CONCLUIDO' ? pctEntr : pctCarga

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
                        <div className="text-muted text-xs">📦 TOTAL PEDIDOS</div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>
                          {totalPed} {emb.pedidos_prontos > 0 ? `(${emb.pedidos_prontos} prontos)` : ''}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted text-xs">⚖️ PESO TOTAL</div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{fmtKg(emb.peso_total_kg)}</div>
                      </div>
                      <div>
                        <div className="text-muted text-xs">🚚 VEÍCULO / ROTA</div>
                        <div style={{ fontWeight: 700 }}>
                          {emb.veiculo_placa || emb.rota_nome || 'A definir'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted text-xs">
                          {emb.status === 'EM_ROTA' || emb.status === 'CONCLUIDO' ? '🎯 ENTREGUES' : '📋 CARREGADAS'}
                        </div>
                        <div style={{ fontWeight: 800 }}>
                          {emb.status === 'EM_ROTA' || emb.status === 'CONCLUIDO'
                            ? `${emb.pedidos_entregues || 0} / ${totalPed} (${pctEntr}%)`
                            : `${cxCarr} / ${totalCx} cx (${pctCarga}%)`}
                        </div>
                      </div>
                    </div>

                    <div style={{ height: 5, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${pctBarra}%`, height: '100%', background: pctBarra >= 100 ? '#22c55e' : '#38bdf8' }} />
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
              <p className="page-subtitle">
                Embarque: {fmtData(embarqueAtivo.data_embarque)} • {embarqueAtivo.resumo?.total_pedidos || 0} parada(s) •{' '}
                {embarqueAtivo.resumo?.caixas_carregadas || 0}/{embarqueAtivo.resumo?.total_caixas || 0} caixas bipadas •{' '}
                {fmtKg(embarqueAtivo.resumo?.peso_real_kg > 0 ? embarqueAtivo.resumo?.peso_real_kg : embarqueAtivo.resumo?.peso_pedido_kg)}
              </p>
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
                      <Printer size={15} /> Prévia Carregamento
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
                <Barcode size={15} /> Carregamento Bipadado ({embarqueAtivo.resumo?.caixas_carregadas || 0}/{embarqueAtivo.resumo?.total_caixas || 0} cx)
              </button>
            )}
            <button
              type="button"
              className={`btn ${abaDetalhe === 'ENTREGAS' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setAbaDetalhe('ENTREGAS')}
            >
              <Navigation size={15} /> Entregas &amp; Rastreio ({embarqueAtivo.paradas?.filter((p) => p.status_entrega === 'ENTREGUE').length || 0}/{embarqueAtivo.paradas?.length || 0})
            </button>
          </div>

          {/* ABA MONTAGEM & ORDEM */}
          {abaDetalhe === 'MONTAGEM' && podeGerir && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <form className="card" style={{ padding: 16 }} onSubmit={handleSalvarDadosEmbarque}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
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
                    <label className="form-label">Placa Veículo (ou preencher na saída)</label>
                    <input
                      className="form-input"
                      placeholder="Ex: ABC-1D23"
                      value={formDados.veiculo_placa}
                      onChange={(e) => setFormDados((f) => ({ ...f, veiculo_placa: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">Motorista (ou preencher via QR)</label>
                    <input
                      className="form-input"
                      placeholder="Opcional..."
                      value={formDados.motorista_nome}
                      onChange={(e) => setFormDados((f) => ({ ...f, motorista_nome: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">NFs Vinculadas</label>
                    <input
                      className="form-input"
                      placeholder="Ex: 1020, 1021..."
                      value={formDados.numero_nf_lote}
                      onChange={(e) => setFormDados((f) => ({ ...f, numero_nf_lote: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label">Modalidade Romaneio</label>
                    <select
                      className="form-input"
                      value={formDados.modalidade_impressao}
                      onChange={(e) => setFormDados((f) => ({ ...f, modalidade_impressao: e.target.value }))}
                    >
                      <option value="OPCAO_B">Opção B (Padrão: assina após carga)</option>
                      <option value="OPCAO_A">Opção A (Prévia + Oficial pós-bipe)</option>
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
                    <Plus size={14} /> + Puxar Pedidos Prontos
                  </button>
                </div>

                {(embarqueAtivo.paradas || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                    Nenhum pedido adicionado ainda. Clique em <strong>+ Puxar Pedidos Prontos</strong> acima.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Ordem</th>
                          <th>Pedido / Romaneio</th>
                          <th>Cliente &amp; Destino</th>
                          <th>Status Pedido</th>
                          <th style={{ textAlign: 'right' }}>Peso</th>
                          <th style={{ textAlign: 'center' }}>Caixas (Bipadas)</th>
                          <th style={{ textAlign: 'right' }}>Valor</th>
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
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>{p.cliente}</div>
                              <div className="text-muted text-xs">{p.endereco_entrega}</div>
                            </td>
                            <td>
                              <span className={`badge ${p.pronto_para_faturamento ? 'badge--success' : 'badge--warning'}`}>
                                {p.pronto_para_faturamento ? p.pedido_status : 'Sem Peso Real'}
                              </span>
                              {p.pagamento_na_entrega && (
                                <div className="badge badge--danger" style={{ fontSize: 9.5, marginTop: 4 }}>
                                  PAGAR NA ENTREGA
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                              {p.kg_real > 0 ? fmtKg(p.kg_real) : <span className="text-muted">Ped: {fmtKg(p.kg_pedido)}</span>}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>
                              {p.caixas_carregadas}/{p.caixas_total} cx
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoeda(p.valor_total)}</td>
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

          {/* ABA CARREGAMENTO BIPADADO (OPERADOR NA DOCA) */}
          {abaDetalhe === 'CARREGAMENTO' && podeCarregar && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card" style={{ padding: 18 }}>
                <form
                  onSubmit={handleBiparCaixaCarregamento}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
                >
                  <div style={{ flex: '1 1 300px' }}>
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
                      disabled={bipando}
                    />
                  </div>
                  <button type="submit" className="btn btn--primary" disabled={bipando || !eanBipe.trim()}>
                    <CheckCircle2 size={15} /> {bipando ? 'Validando...' : 'Confirmar Caixa'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--success"
                    onClick={handleDespachar}
                  >
                    <Truck size={15} /> Concluir Carga &amp; Despachar
                  </button>
                </form>

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

          {/* ABA ENTREGAS & RASTREIO AO VIVO */}
          {abaDetalhe === 'ENTREGAS' && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Acompanhamento das Entregas em Tempo Real</h3>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <label className="text-xs flex items-center gap-6 cursor-pointer">
                    <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                    Atualizar a cada 10s
                  </label>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirEmbarque(embarqueAtivo.id)}>
                    <RefreshCw size={13} /> Atualizar
                  </button>
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
                          <MapPin size={12} style={{ verticalAlign: 'middle' }} /> {p.endereco_entrega} • {p.caixas_total} cx ({fmtKg(p.kg_real || p.kg_pedido)})
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
                        {p.status_entrega !== 'ENTREGUE' && p.status_entrega !== 'DEVOLVIDA' && (
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
            </div>
          )}
        </>
      )}

      {/* MODAL + CRIAR EMBARQUE */}
      {modalNovoOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 95, backgroundColor: 'rgba(5,9,18,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>+ Criar Novo Embarque / Roteiro</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalNovoOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCriarEmbarque} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                <div>
                  <label className="form-label">Data do Embarque *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={novoForm.data_embarque}
                    onChange={(e) => setNovoForm((f) => ({ ...f, data_embarque: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Título (opcional)</label>
                  <input
                    className="form-input"
                    placeholder="Auto-gerado com a data caso vazio..."
                    value={novoForm.titulo}
                    onChange={(e) => setNovoForm((f) => ({ ...f, titulo: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
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
                  <label className="form-label">Placa (opcional)</label>
                  <input
                    className="form-input"
                    placeholder="Ou preencher na saída"
                    value={novoForm.veiculo_placa}
                    onChange={(e) => setNovoForm((f) => ({ ...f, veiculo_placa: e.target.value.toUpperCase() }))}
                  />
                </div>
                <div>
                  <label className="form-label">Modalidade Impressão</label>
                  <select
                    className="form-input"
                    value={novoForm.modalidade_impressao}
                    onChange={(e) => setNovoForm((f) => ({ ...f, modalidade_impressao: e.target.value }))}
                  >
                    <option value="OPCAO_B">Opção B (Padrão)</option>
                    <option value="OPCAO_A">Opção A</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">Selecionar Pedidos Iniciais ({novoForm.pedido_ids.length} marcados)</label>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pedidosElegiveis.length === 0 ? (
                    <div className="text-muted text-xs" style={{ padding: 12, textAlign: 'center' }}>
                      Nenhum pedido disponível para roteirização no momento (você pode criar o embarque vazio e puxar depois).
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
                            {ped.pronto_para_embarque ? `${ped.total_caixas_separadas} cx • ${fmtKg(ped.total_kg_separado)}` : 'Em Separação'}
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
                <button type="submit" className="btn btn--primary">
                  Criar Embarque
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL + PUXAR PEDIDOS PARA EMBARQUE ABERTO */}
      {modalPedidosOpen && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 95, backgroundColor: 'rgba(5,9,18,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="card" style={{ width: '95vw', maxWidth: 680, maxHeight: '88vh', overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Puxar Pedidos para {embarqueAtivo?.codigo}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalPedidosOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <label className="text-xs flex items-center gap-6 mb-12 cursor-pointer" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={somenteProntos} onChange={(e) => setSomenteProntos(e.target.checked)} />
              Mostrar somente pedidos já separados com pesos reais (Prontos p/ Embarque)
            </label>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pedidosElegiveis
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
                        {ped.pronto_para_embarque ? `${ped.total_caixas_separadas} cx • ${fmtKg(ped.total_kg_separado)}` : ped.status}
                      </span>
                    </label>
                  )
                })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn--secondary" onClick={() => setModalPedidosOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn--primary" onClick={handleConfirmarAddPedidos}>
                Adicionar ({pedidosModalSel.length}) ao Roteiro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIGURAÇÕES DO MÓDULO (RASTREIO QR ON/OFF + OPÇÃO B / OPÇÃO A) */}
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
                  <option value="OPCAO_B">Opção B (Padrão) — Imprime roteiro e motorista assina placa/NFs ao concluir carga</option>
                  <option value="OPCAO_A">Opção A — Prévia s/ assinatura antes + Via Oficial pós-bipagem</option>
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
