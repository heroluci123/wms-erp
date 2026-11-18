import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Barcode,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Layers,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Scale,
  ScanBarcode,
  Settings2,
  Thermometer,
  AlertTriangle,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { comprasQueries } from '../../queries/compras'
import * as movimentacoesQueries from '../../queries/movimentacoes.js'
import { tarasQueries } from '../../queries/taras.js'
import PesagemTaraFields, { resolverTaraSelecionada } from '../shared/PesagemTaraFields.jsx'
import EtiquetaZebraModal, { despacharImpressaoEtiqueta } from '../shared/EtiquetaZebraPrint.jsx'
import { RelatorioRecebimentoPrint } from '../shared/RelatorioRecebimentoPrint.jsx'
import { ConfigEstacaoModal } from '../shared/ConfigEstacaoModal.jsx'
import { conectarBalancaSerial, isWebSerialSupported } from '../../utils/balancaSerial.js'
import { lerConfigEstacao } from '../../utils/estacaoConfig.js'
import { fmtDataBR, fmtKg2, hojeIsoLocal, validarPesagemTara } from '../../utils/rastreabilidade.js'

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`

export function RecebimentoPedidoDoca({ onPedidoAbertoChange } = {}) {
  const { operador, toastSuccess, toastError, toastWarning, confirmar } = useAppStore()

  // Lista de PCs liberados + Configs
  const [pcs, setPcs] = useState([])
  const [loadingLista, setLoadingLista] = useState(true)
  const [tolPct, setTolPct] = useState(3)
  const [exigirTemp, setExigirTemp] = useState(false)

  // PC selecionado aberto na doca
  const [pcDetalhe, setPcDetalhe] = useState(null)
  const [txtDisponiveisFornecedor, setTxtDisponiveisFornecedor] = useState(0)
  const [itemAtivoId, setItemAtivoId] = useState('')
  const [modoDoca, setModoDoca] = useState('MANUAL') // 'MANUAL' | 'BALANCA' | 'BIPAGEM'

  useEffect(() => {
    onPedidoAbertoChange?.(Boolean(pcDetalhe))
  }, [pcDetalhe, onPedidoAbertoChange])

  useEffect(() => {
    return () => onPedidoAbertoChange?.(false)
  }, [onPedidoAbertoChange])

  // Palete opcional + Endereço Doca + NF
  const [paletesAbertos, setPaletesAbertos] = useState([])
  const [paleteId, setPaleteId] = useState('')
  const [enderecoDoca, setEnderecoDoca] = useState('REC')
  const [numeroNf, setNumeroNf] = useState('')

  // Taras & Formulário Pesagem Manual / Automática
  const [taras, setTaras] = useState([])
  const [boxData, setBoxData] = useState({
    data_producao: hojeIsoLocal(),
    validade: '',
    lote: '',
    tara_modo: 'CADASTRADA',
    tara_id: '',
    tara_manual_kg: '',
    peso_bruto: '',
    qtd_pecas: '',
  })
  const [metaPesagem, setMetaPesagem] = useState(null)
  const [salvandoCaixa, setSalvandoCaixa] = useState(false)
  const pesoBrutoRef = useRef(null)

  // Balança Serial (Pesagem Automática)
  const [balancaStatus, setBalancaStatus] = useState('DESCONECTADA') // 'DESCONECTADA' | 'CONECTADA'
  const [balancaPeso, setBalancaPeso] = useState(0)
  const [balancaEstavel, setBalancaEstavel] = useState(false)
  const [autoGravarEstavel, setAutoGravarEstavel] = useState(false)
  const balancaConnRef = useRef(null)
  const ultimoPesoAutoRef = useRef(0)

  // Bipagem TXT
  const [scanTxt, setScanTxt] = useState('')
  const [bipandoTxt, setBipandoTxt] = useState(false)
  const [preCaixasFornecedor, setPreCaixasFornecedor] = useState([])
  const scanTxtRef = useRef(null)

  // Temperaturas por item { [itemId]: string }
  const [tempEdits, setTempEdits] = useState({})
  const [salvandoTempId, setSalvandoTempId] = useState('')

  // Impressão & Configuração de Estação
  const [etiquetaPreview, setEtiquetaPreview] = useState(null)
  const [relatorioPrint, setRelatorioPrint] = useState(null)
  const [configEstacaoOpen, setConfigEstacaoOpen] = useState(false)
  const [cfgEstacao, setCfgEstacao] = useState(lerConfigEstacao)
  const [finalizandoDoca, setFinalizandoDoca] = useState(false)

  const carregarLista = useCallback(async () => {
    setLoadingLista(true)
    try {
      const [resPcs, resPals, resTaras] = await Promise.all([
        comprasQueries.listarPedidosLiberadosParaDoca(),
        movimentacoesQueries.listarPaletesAbertos().catch(() => []),
        tarasQueries.listar(true).catch(() => []),
      ])
      setPcs(resPcs?.data || [])
      setTolPct(resPcs?.tolerancia_recebimento_pct ?? 3)
      setExigirTemp(Boolean(resPcs?.exigir_temperatura_recebimento))
      setPaletesAbertos(resPals || [])
      setTaras(resTaras || [])
      const padrao = resolverTaraSelecionada(resTaras || [], '')
      if (padrao) {
        setBoxData((prev) => (prev.tara_id ? prev : { ...prev, tara_id: String(padrao.id) }))
      }
    } catch (err) {
      toastError('Erro ao carregar pedidos liberados', err.message)
    } finally {
      setLoadingLista(false)
    }
  }, [toastError])

  useEffect(() => {
    carregarLista()
    return () => {
      balancaConnRef.current?.disconnect?.()
    }
  }, [carregarLista])

  const recarregarPcAberto = useCallback(
    async (pcId) => {
      try {
        const [det, resPcs, resPre] = await Promise.all([
          comprasQueries.obterCompra(pcId),
          comprasQueries.listarPedidosLiberadosParaDoca(),
          comprasQueries.listarPreCaixasRecebimento({ pedido_compra_id: pcId, status: 'PENDENTE' }).catch(() => ({
            resumo: { pendentes: 0 },
            data: [],
          })),
        ])
        if (det) {
          setPcDetalhe(det)
          setNumeroNf((prev) => prev || det.recebimento?.numeroNf || '')
          const tempInit = {}
          for (const it of det.itens || []) {
            tempInit[it.id] = it.temperatura_c != null ? String(it.temperatura_c) : ''
          }
          setTempEdits(tempInit)
        }
        const pcRow = (resPcs?.data || []).find((x) => x.id === pcId)
        setTxtDisponiveisFornecedor(pcRow?.txt_disponiveis_fornecedor ?? (resPre?.data || []).length ?? 0)
        setPreCaixasFornecedor(resPre?.data || [])
        setPcs(resPcs?.data || [])
        setTolPct(resPcs?.tolerancia_recebimento_pct ?? 3)
        setExigirTemp(Boolean(resPcs?.exigir_temperatura_recebimento))
      } catch (err) {
        toastError('Erro ao atualizar pedido na doca', err.message)
      }
    },
    [toastError],
  )

  const abrirPedido = async (pc) => {
    await recarregarPcAberto(pc.id)
    const primeiroPendente = (pc.itens || []).find((it) => {
      const sol = Number(it.qtd_kg_solicitada || 0)
      const rec = Number(it.qtd_kg_recebida || 0)
      return rec <= 0 || rec < sol * (1 - tolPct / 100)
    })
    setItemAtivoId(primeiroPendente?.id || pc.itens?.[0]?.id || '')
    setModoDoca((pc.txt_disponiveis_fornecedor || 0) > 0 ? 'BIPAGEM' : 'MANUAL')
  }

  // Ordenação automática: Pendentes no topo -> Concluídos (dentro de >= 100% - tolPct) descem para baixo!
  const itensOrdenados = useMemo(() => {
    if (!pcDetalhe?.itens) return []
    const cxList = pcDetalhe.caixas_bipadas || []
    return [...pcDetalhe.itens]
      .map((it) => {
        const sol = Number(it.qtd_kg_solicitada || 0)
        const rec = Number(it.qtd_kg_recebida || 0)
        const faltaKg = Number(Math.max(0, sol - rec).toFixed(3))
        const pct = sol > 0 ? Math.min(100, Number(((rec / sol) * 100).toFixed(1))) : 100
        const concluido = rec > 0 && sol > 0 && rec >= sol * (1 - tolPct / 100)
        const dentroTolerancia = rec > 0 && (sol <= 0 || Math.abs(rec - sol) / sol <= tolPct / 100)
        const qtdCaixas = cxList.filter((c) => c.produto_id === it.produto_id).length
        return {
          ...it,
          sol,
          rec,
          faltaKg,
          pct,
          concluido,
          dentroTolerancia,
          qtdCaixas,
        }
      })
      .sort((a, b) => {
        if (a.concluido !== b.concluido) return a.concluido ? 1 : -1
        return String(a.produto_descricao || '').localeCompare(String(b.produto_descricao || ''), 'pt-BR')
      })
  }, [pcDetalhe, tolPct])

  const itemAtivo = useMemo(
    () => itensOrdenados.find((i) => i.id === itemAtivoId) || itensOrdenados.find((i) => !i.concluido) || itensOrdenados[0] || null,
    [itensOrdenados, itemAtivoId],
  )

  // Selecionar automaticamente próximo item pendente quando o ativo conclui
  useEffect(() => {
    if (!pcDetalhe) return
    const atual = itensOrdenados.find((i) => i.id === itemAtivoId)
    if (!atual || atual.concluido) {
      const proxPendente = itensOrdenados.find((i) => !i.concluido)
      if (proxPendente && proxPendente.id !== itemAtivoId) {
        setItemAtivoId(proxPendente.id)
      }
    }
  }, [itensOrdenados, itemAtivoId, pcDetalhe])

  const diagnosticoFechamento = useMemo(() => {
    if (itensOrdenados.length === 0) return { tudoOk: false, pendenciasPeso: [], pendenciasTemp: [] }
    const pendenciasPeso = itensOrdenados.filter((it) => !it.dentroTolerancia)
    const pendenciasTemp = exigirTemp ? itensOrdenados.filter((it) => it.rec > 0 && it.temperatura_c == null) : []
    return {
      tudoOk: pendenciasPeso.length === 0 && pendenciasTemp.length === 0,
      pendenciasPeso,
      pendenciasTemp,
    }
  }, [itensOrdenados, exigirTemp])

  const handleSalvarTemperaturaItem = async (it) => {
    const raw = tempEdits[it.id]
    setSalvandoTempId(it.id)
    try {
      await comprasQueries.registrarTemperaturaItemPc(pcDetalhe.id, it.id, raw === '' ? null : raw)
      toastSuccess('Temperatura Registrada', `${it.produto_descricao}: ${raw === '' ? 'removida' : `${raw} °C`}`)
      await recarregarPcAberto(pcDetalhe.id)
    } catch (err) {
      toastError('Temperatura inválida', err.message)
    } finally {
      setSalvandoTempId('')
    }
  }

  const handleGravarCaixaPesada = useCallback(
    async (pesoBrutoOverride = null) => {
      if (!pcDetalhe || !itemAtivo) {
        return toastWarning('Selecione um item', 'Clique em um produto pendente do Pedido acima.')
      }
      const brutoUsar = pesoBrutoOverride != null ? pesoBrutoOverride : boxData.peso_bruto
      const taraModo = boxData.tara_modo === 'MANUAL' ? 'MANUAL' : 'CADASTRADA'
      const taraAtual = taraModo === 'CADASTRADA' ? resolverTaraSelecionada(taras, boxData.tara_id) : null
      const taraKgUsar =
        metaPesagem?.tara_kg ??
        (taraModo === 'MANUAL' ? Number(String(boxData.tara_manual_kg || '0').replace(',', '.')) : Number(taraAtual?.peso_kg || 0))

      const valid = validarPesagemTara({
        dataProducao: boxData.data_producao,
        validade: boxData.validade,
        taraId: taraAtual?.id || null,
        taraKg: taraKgUsar,
        pesoBruto: brutoUsar,
        qtdPecas: boxData.qtd_pecas,
      })
      if (!valid.ok) return toastWarning('Dados da Caixa', valid.erro)

      const loteFinal = String(boxData.lote || '').trim() || valid.lote
      setSalvandoCaixa(true)
      try {
        const res = await movimentacoesQueries.receberCaixaSerializada({
          ean_caixa: 'AUTO',
          produto_id: itemAtivo.produto_id,
          palete_id: paleteId || null,
          pedido_compra_id: pcDetalhe.id,
          numero_nf: numeroNf || '',
          exigir_pedido_compra: true,
          peso_kg: valid.peso_liquido_kg,
          peso_bruto_kg: valid.peso_bruto_kg,
          tara_id: taraAtual?.id || null,
          tara_kg: valid.tara_kg,
          qtd_pecas: valid.qtd_pecas,
          data_producao: valid.data_producao,
          validade: valid.validade,
          lote: loteFinal,
          endereco: enderecoDoca || 'REC',
          operador_id: operador?.id,
          operador_nome: operador?.nome || 'Sistema',
        })
        if (!res.success) return toastError('Erro ao gravar caixa', res.error)

        toastSuccess(
          'Caixa Registrada ✅',
          `${itemAtivo.produto_descricao} • Líq ${fmtKg2(valid.peso_liquido_kg)} • EAN ${res.caixa.ean_caixa}`,
        )
        setBoxData((prev) => ({ ...prev, peso_bruto: '' }))

        if (cfgEstacao.imprimirAutoAoSalvar) {
          const impRes = await despacharImpressaoEtiqueta([res.caixa], {
            onAbrirModal: (ets) => setEtiquetaPreview(ets),
          })
          if (impRes.erroUsb) {
            toastWarning('Impressora Zebra WebUSB', `Impresso via fallback do navegador (${impRes.erroUsb}).`)
          }
        }

        await recarregarPcAberto(pcDetalhe.id)
        if (modoDoca === 'MANUAL') {
          setTimeout(() => pesoBrutoRef.current?.focus(), 70)
        }
      } catch (err) {
        toastError('Erro na pesagem', err.message)
      } finally {
        setSalvandoCaixa(false)
      }
    },
    [pcDetalhe, itemAtivo, boxData, taras, metaPesagem, paleteId, numeroNf, enderecoDoca, operador, cfgEstacao, modoDoca, recarregarPcAberto, toastSuccess, toastError, toastWarning],
  )

  const handleToggleBalanca = async () => {
    if (balancaStatus === 'CONECTADA') {
      await balancaConnRef.current?.disconnect?.()
      balancaConnRef.current = null
      setBalancaStatus('DESCONECTADA')
      setBalancaPeso(0)
      setBalancaEstavel(false)
      return
    }
    try {
      const conn = await conectarBalancaSerial({
        baudRate: cfgEstacao.balancaBaudRate || 9600,
        leiturasEstaveis: cfgEstacao.balancaLeiturasEstaveis || 3,
        onStatus: (st) => setBalancaStatus(st),
        onPeso: (kg, { estavel }) => {
          setBalancaPeso(kg)
          setBalancaEstavel(estavel)
          setBoxData((prev) => ({ ...prev, peso_bruto: String(kg) }))
        },
        onError: (err) => toastError('Leitura da Balança', err?.message || 'Porta serial desconectada.'),
      })
      balancaConnRef.current = conn
      toastSuccess('Balança Conectada ✅', 'Aguardando peso na plataforma...')
    } catch (err) {
      toastError('Erro ao conectar balança', err.message)
    }
  }

  // Captura automática quando peso estabiliza (se checkbox marcada e novo peso > 0)
  useEffect(() => {
    if (
      modoDoca === 'BALANCA' &&
      autoGravarEstavel &&
      balancaStatus === 'CONECTADA' &&
      balancaEstavel &&
      balancaPeso > 0 &&
      !salvandoCaixa &&
      Math.abs(balancaPeso - ultimoPesoAutoRef.current) > 0.01
    ) {
      ultimoPesoAutoRef.current = balancaPeso
      handleGravarCaixaPesada(balancaPeso)
    }
  }, [modoDoca, autoGravarEstavel, balancaStatus, balancaEstavel, balancaPeso, salvandoCaixa, handleGravarCaixaPesada])

  const handleBiparModoTxt = async (e) => {
    e?.preventDefault()
    const cod = String(scanTxt || '').trim()
    if (!cod) return
    if (txtDisponiveisFornecedor <= 0) {
      setScanTxt('')
      return toastError(
        'Sem TXT pré-importado',
        `Este fornecedor (${pcDetalhe.fornecedor_nome}) não possui etiquetas TXT pendentes no banco. Use Pesagem Manual ou Balança, ou importe os arquivos TXT em Compras.`,
      )
    }
    setBipandoTxt(true)
    try {
      const res = await comprasQueries.biparPreCaixa({
        ean_caixa: cod,
        pedido_compra_id: pcDetalhe.id,
        palete_id: paleteId || null,
        endereco: enderecoDoca || 'REC',
      })
      const cx = res.caixa
      toastSuccess(
        'Caixa TXT Bipado ✅',
        `${cx.produto_descricao} • ${fmtKg2(cx.peso_kg)}${cx.qtd_pecas ? ` (${cx.qtd_pecas} pç)` : ''}`,
      )
      setScanTxt('')
      await recarregarPcAberto(pcDetalhe.id)
    } catch (err) {
      toastError('Erro na bipagem TXT', err.message)
    } finally {
      setBipandoTxt(false)
      setTimeout(() => scanTxtRef.current?.focus(), 60)
    }
  }

  const handleCriarPaleteRapido = async () => {
    try {
      const novo = await movimentacoesQueries.criarPalete()
      toastSuccess('Palete Aberto', `Palete ${novo.codigo} selecionado para este recebimento.`)
      const lista = await movimentacoesQueries.listarPaletesAbertos()
      setPaletesAbertos(lista || [])
      setPaleteId(String(novo.id))
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleFinalizarPedidoDoca = async (enviarParaAnalista = false) => {
    const msg = enviarParaAnalista
      ? `Existem itens fora da tolerância de ±${tolPct}% em relação ao Pedido ${pcDetalhe.codigo}. Deseja enviar a divergência para aprovação do Analista em Compras?`
      : `Confirmar fechamento final do Recebimento do Pedido ${pcDetalhe.codigo}? Todas as mercadorias já estão conferidas.`
    const ok = await confirmar({
      title: enviarParaAnalista ? 'Enviar Divergência para Analista' : 'Finalizar Recebimento na Doca',
      message: msg,
      type: enviarParaAnalista ? 'confirm' : 'success',
      confirmLabel: enviarParaAnalista ? 'Enviar p/ Analista' : 'Finalizar Recebimento',
    })
    if (!ok) return

    setFinalizandoDoca(true)
    try {
      const res = await comprasQueries.finalizarDocaPedido(pcDetalhe.id, {
        numero_nf: numeroNf,
        enviar_para_analista: enviarParaAnalista,
      })
      if (res.enviado_analista) {
        toastWarning('Enviado para Análise ⚠️', `Recebimento ${res.recebimento_codigo} encaminhado para aprovação do Analista.`)
      } else {
        toastSuccess('Pedido Recebido ✅', `${pcDetalhe.codigo} concluído e validado com sucesso!`)
      }
      setPcDetalhe(null)
      await carregarLista()
    } catch (err) {
      toastError('Não foi possível finalizar', err.message)
    } finally {
      setFinalizandoDoca(false)
    }
  }

  // ── RENDER: LISTA DE PEDIDOS LIBERADOS ─────────────────────────────────────
  if (!pcDetalhe) {
    return (
      <div className="flex flex-col gap-16">
        <div className="card">
          <div className="flex justify-between items-center flex-wrap gap-10 mb-12">
            <div>
              <h2 className="text-base font-bold flex items-center gap-8 text-primary">
                <ClipboardCheck size={18} /> Pedidos de Compra Liberados para Recebimento na Doca
              </h2>
              <p className="text-xs text-muted mt-4">
                Entrada física permitida exclusivamente vinculada a um Pedido de Compra liberado (Tolerância: <strong>±{tolPct}%</strong> • Temperatura:{' '}
                <strong>{exigirTemp ? 'Obrigatória' : 'Recomendada'}</strong>).
              </p>
            </div>
            <div className="flex gap-8 flex-wrap">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfigEstacaoOpen(true)}>
                <Settings2 size={15} /> Configurar Zebra & Balança
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={carregarLista} disabled={loadingLista}>
                <RefreshCw size={15} className={loadingLista ? 'animate-spin' : ''} /> Atualizar
              </button>
            </div>
          </div>

          {loadingLista ? (
            <div className="p-24 text-center text-muted">Carregando pedidos liberados...</div>
          ) : pcs.length === 0 ? (
            <div className="p-32 text-center text-muted" style={{ border: '2px dashed var(--border)', borderRadius: 10 }}>
              <Package size={34} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
              <div className="font-bold mb-4">Nenhum Pedido de Compra liberado para a operação.</div>
              <div className="text-xs">Peça ao comprador/analista para criar e aprovar um Pedido de Compra no módulo de Compras.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
              {pcs.map((pc) => {
                const sol = (pc.itens || []).reduce((s, i) => s + Number(i.qtd_kg_solicitada || 0), 0)
                const rec = (pc.itens || []).reduce((s, i) => s + Number(i.qtd_kg_recebida || 0), 0)
                const pct = sol > 0 ? Math.min(100, Number(((rec / sol) * 100).toFixed(1))) : 0
                return (
                  <div
                    key={pc.id}
                    className="card"
                    style={{ borderTop: '3px solid var(--primary)', display: 'flex', flexDirection: 'column', gap: 10 }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-primary text-base">{pc.codigo}</span>
                      <div className="flex gap-6">
                        {pc.txt_disponiveis_fornecedor > 0 && (
                          <span className="badge badge--info">{pc.txt_disponiveis_fornecedor} TXT(s) disponíveis</span>
                        )}
                        <span className={`badge ${pc.status === 'PARCIAL' ? 'badge--warning' : 'badge--success'}`}>{pc.status}</span>
                      </div>
                    </div>

                    <div>
                      <div className="font-bold text-sm">{pc.fornecedor_nome}</div>
                      <div className="text-xs text-muted">
                        {pc.fornecedor_sif ? `SIF ${pc.fornecedor_sif} • ` : ''}
                        {(pc.itens || []).length} item(ns) • Prev: {fmtDataBR(pc.previsao_entrega)}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-4">
                        <span className="text-muted">Recebido: <strong className="text-cyan">{fmtKg(rec)}</strong></span>
                        <span className="text-muted">Pedido: <strong>{fmtKg(sol)}</strong> ({pct}%)</span>
                      </div>
                      <div style={{ height: 8, background: 'var(--bg-1)', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 - tolPct ? 'var(--success)' : 'var(--primary)', transition: 'width 0.2s' }} />
                      </div>
                    </div>

                    <button type="button" className="btn btn--primary w-full" onClick={() => abrirPedido(pc)}>
                      Abrir Pedido na Doca →
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <ConfigEstacaoModal
          isOpen={configEstacaoOpen}
          onClose={() => setConfigEstacaoOpen(false)}
          onSaved={(newCfg) => setCfgEstacao(newCfg)}
        />
      </div>
    )
  }

  // ── RENDER: PEDIDO ABERTO NA DOCA (COCKPIT WIDESCREEN EM 2 COLUNAS) ─────────
  const solTotal = itensOrdenados.reduce((s, i) => s + i.sol, 0)
  const recTotal = itensOrdenados.reduce((s, i) => s + i.rec, 0)
  const pctTotal = solTotal > 0 ? Math.min(100, Number(((recTotal / solTotal) * 100).toFixed(1))) : 0

  return (
    <div className="flex flex-col gap-12">
      {/* Barra Superior Compacta do Pedido na Doca */}
      <div
        className="card"
        style={{
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 260 }}>
          <div className="flex items-center gap-8 flex-wrap">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                balancaConnRef.current?.disconnect?.()
                setPcDetalhe(null)
                carregarLista()
              }}
            >
              <ArrowLeft size={14} /> Voltar
            </button>
            <h2 className="text-base font-bold text-primary font-mono m-0">{pcDetalhe.codigo}</h2>
            <span className="font-bold text-sm">{pcDetalhe.fornecedor_nome}</span>
            {pcDetalhe.fornecedor_sif && <span className="badge badge--neutral">SIF {pcDetalhe.fornecedor_sif}</span>}
            {pcDetalhe.recebimento?.codigo && <span className="badge badge--info">{pcDetalhe.recebimento.codigo}</span>}
          </div>
          <div className="text-xs text-muted mt-4">
            Total: <strong>{fmtKg(solTotal)}</strong> • Recebido: <strong className="text-cyan">{fmtKg(recTotal)}</strong> ({pctTotal}%) •{' '}
            Tol.: <strong>±{tolPct}%</strong> • Temp.: <strong>{exigirTemp ? 'Obrigatória' : 'Recomendada'}</strong>
          </div>
        </div>

        <div className="flex items-end gap-8 flex-wrap">
          <div style={{ width: 82 }}>
            <label className="form-label" style={{ fontSize: 10, marginBottom: 2 }}>End. Doca</label>
            <input
              type="text"
              className="form-input font-mono"
              style={{ height: 32, padding: '4px 8px', fontSize: 12 }}
              value={enderecoDoca}
              onChange={(e) => setEnderecoDoca(e.target.value.toUpperCase())}
              placeholder="REC"
            />
          </div>

          <div style={{ width: 195 }}>
            <label className="form-label flex justify-between" style={{ fontSize: 10, marginBottom: 2 }}>
              <span>Palete LPN</span>
              <button
                type="button"
                className="text-cyan cursor-pointer"
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 10 }}
                onClick={handleCriarPaleteRapido}
              >
                + Novo
              </button>
            </label>
            <select
              className="form-input"
              style={{ height: 32, padding: '4px 8px', fontSize: 12 }}
              value={paleteId}
              onChange={(e) => setPaleteId(e.target.value)}
            >
              <option value="">Sem palete (direto)</option>
              {paletesAbertos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} ({p.qtd_caixas || 0} cx)
                </option>
              ))}
            </select>
          </div>

          <div style={{ width: 105 }}>
            <label className="form-label" style={{ fontSize: 10, marginBottom: 2 }}>Nº NF (Opc.)</label>
            <input
              type="text"
              className="form-input font-mono"
              style={{ height: 32, padding: '4px 8px', fontSize: 12 }}
              value={numeroNf}
              onChange={(e) => setNumeroNf(e.target.value)}
              placeholder="Ex: 10293"
            />
          </div>

          <button type="button" className="btn btn--ghost btn--sm" style={{ height: 32 }} onClick={() => setConfigEstacaoOpen(true)}>
            <Settings2 size={14} /> Zebra & Balança
          </button>
          <button type="button" className="btn btn--secondary btn--sm" style={{ height: 32 }} onClick={() => setRelatorioPrint(pcDetalhe)}>
            <Printer size={14} /> Relatório (c/ Temp.)
          </button>
        </div>
      </div>

      {/* GRID COCKPIT EM 2 COLUNAS LADO A LADO */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {/* COLUNA ESQUERDA: ITENS DO PEDIDO + TEMPERATURA + FECHAMENTO */}
        <div className="flex flex-col gap-12" style={{ minWidth: 0 }}>
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex justify-between items-center flex-wrap gap-6 mb-8">
              <h3 className="text-xs font-bold uppercase text-muted m-0">
                Itens do Pedido ({itensOrdenados.length}) — Clique p/ pesar &amp; informe °C
              </h3>
              <span className="text-xs text-muted">Concluídos descem p/ baixo</span>
            </div>

            <div className="flex flex-col gap-8" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', paddingRight: 2 }}>
              {itensOrdenados.map((it) => {
                const ativo = itemAtivo?.id === it.id
                const faltaTemp = exigirTemp && it.rec > 0 && it.temperatura_c == null
                return (
                  <div
                    key={it.id}
                    onClick={() => setItemAtivoId(it.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      border: `1.5px solid ${
                        ativo
                          ? 'var(--primary)'
                          : it.concluido
                            ? 'rgba(34,197,94,0.45)'
                            : 'var(--border)'
                      }`,
                      background: it.concluido
                        ? 'rgba(34,197,94,0.10)'
                        : ativo
                          ? 'rgba(56,189,248,0.08)'
                          : 'var(--bg-1)',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div className="flex justify-between items-center flex-wrap gap-8">
                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                        <div className="flex items-center gap-6 flex-wrap">
                          <span className="font-mono text-xs text-muted">{it.produto_codigo}</span>
                          <strong className="text-sm">{it.produto_descricao}</strong>
                          {it.concluido ? (
                            <span className="badge badge--success">
                              <Check size={11} /> Concluído ({it.pct}%)
                            </span>
                          ) : (
                            <span className="badge badge--warning">Falta {fmtKg(it.faltaKg)}</span>
                          )}
                          {ativo && <span className="badge badge--info">Selecionado</span>}
                        </div>
                        <div className="text-xs text-muted mt-4">
                          Pedido: <strong>{fmtKg(it.sol)}</strong> • Recebido: <strong className="text-cyan">{fmtKg(it.rec)}</strong> ({it.qtdCaixas} cx)
                        </div>
                        <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 99, overflow: 'hidden', marginTop: 6 }}>
                          <div
                            style={{
                              width: `${it.pct}%`,
                              height: '100%',
                              background: it.concluido ? '#22c55e' : 'var(--primary)',
                              transition: 'width 0.25s',
                            }}
                          />
                        </div>
                      </div>

                      {/* Amostragem Temperatura 1x por item */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-6"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: 'var(--bg-2)',
                          border: `1px solid ${faltaTemp ? 'var(--warning)' : 'var(--border)'}`,
                        }}
                      >
                        <Thermometer size={14} className={it.temperatura_c != null ? 'text-cyan' : 'text-muted'} />
                        <input
                          type="number"
                          step="0.1"
                          className="form-input"
                          style={{ width: 68, padding: '3px 6px', fontSize: 12, height: 28 }}
                          placeholder="Temp °C"
                          value={tempEdits[it.id] ?? ''}
                          onChange={(e) => setTempEdits((p) => ({ ...p, [it.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleSalvarTemperaturaItem(it)
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          style={{ padding: '4px 8px', fontSize: 11, height: 28 }}
                          disabled={salvandoTempId === it.id}
                          onClick={() => handleSalvarTemperaturaItem(it)}
                        >
                          {it.temperatura_c != null ? 'Atualizar °C' : 'Salvar °C'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* FECHAMENTO NA DOCA SEMPRE VISÍVEL LOGO ABAIXO DOS ITENS */}
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-col gap-10">
              <div className="text-xs">
                {diagnosticoFechamento.tudoOk ? (
                  <span className="text-success font-bold flex items-center gap-6">
                    <CheckCircle2 size={16} /> Todos os itens dentro da tolerância (±{tolPct}%)! Pronto para finalizar.
                  </span>
                ) : (
                  <div className="text-warning flex items-start gap-6">
                    <AlertTriangle size={16} className="shrink-0 mt-2" />
                    <div>
                      <strong>Bloqueio operador (±{tolPct}%):</strong>{' '}
                      {diagnosticoFechamento.pendenciasPeso.length > 0 &&
                        `${diagnosticoFechamento.pendenciasPeso.length} item(ns) fora da margem. `}
                      {diagnosticoFechamento.pendenciasTemp.length > 0 &&
                        `Falta °C obrigatório em ${diagnosticoFechamento.pendenciasTemp.length} item(ns). `}
                      <span>Complete a pesagem/bipagem ou envie para o Analista.</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-8 flex-wrap justify-end">
                {!diagnosticoFechamento.tudoOk && (
                  <button
                    type="button"
                    className="btn btn--warning btn--sm"
                    disabled={finalizandoDoca || recTotal <= 0}
                    onClick={() => handleFinalizarPedidoDoca(true)}
                  >
                    <AlertTriangle size={14} /> Enviar Divergência p/ Analista
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--success"
                  disabled={finalizandoDoca || !diagnosticoFechamento.tudoOk}
                  onClick={() => handleFinalizarPedidoDoca(false)}
                >
                  <CheckCircle2 size={16} /> Finalizar Recebimento na Doca
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA: MESA DE OPERAÇÃO (3 MODOS) + CAIXAS RECEBIDAS */}
        <div className="flex flex-col gap-12" style={{ minWidth: 0 }}>
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex gap-6 flex-wrap mb-12 pb-10 border-b border-border">
              <button
                type="button"
                className={`btn btn--sm ${modoDoca === 'MANUAL' ? 'btn--primary' : 'btn--ghost'}`}
                style={{ flex: 1, minWidth: 165, justifyContent: 'center' }}
                onClick={() => {
                  setModoDoca('MANUAL')
                  setTimeout(() => pesoBrutoRef.current?.focus(), 60)
                }}
              >
                <Plus size={15} /> 1. Pesagem Manual
              </button>
              <button
                type="button"
                className={`btn btn--sm ${modoDoca === 'BALANCA' ? 'btn--primary' : 'btn--ghost'}`}
                style={{ flex: 1, minWidth: 165, justifyContent: 'center' }}
                onClick={() => setModoDoca('BALANCA')}
              >
                <Scale size={15} /> 2. Balança Serial
              </button>
              <button
                type="button"
                className={`btn btn--sm ${modoDoca === 'BIPAGEM' ? 'btn--primary' : 'btn--ghost'}`}
                style={{ flex: 1, minWidth: 165, justifyContent: 'center' }}
                onClick={() => {
                  setModoDoca('BIPAGEM')
                  setTimeout(() => scanTxtRef.current?.focus(), 60)
                }}
              >
                <ScanBarcode size={15} /> 3. Bipagem (.TXT: {txtDisponiveisFornecedor})
              </button>
            </div>

            {/* MODO 1 e 2: PESAGEM MANUAL ou PESAGEM AUTOMÁTICA BALANÇA */}
            {(modoDoca === 'MANUAL' || modoDoca === 'BALANCA') && itemAtivo && (
              <div className="flex flex-col gap-10">
                <div className="p-8 rounded flex justify-between items-center flex-wrap gap-8" style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.35)' }}>
                  <div>
                    <span className="text-xs text-cyan uppercase font-bold">Item Ativo:</span>{' '}
                    <strong className="text-sm">{itemAtivo.produto_codigo} — {itemAtivo.produto_descricao}</strong>
                  </div>
                  <span className="text-xs font-mono font-bold text-warning">
                    Falta: {fmtKg(itemAtivo.faltaKg)} (de {fmtKg(itemAtivo.sol)})
                  </span>
                </div>

                {modoDoca === 'BALANCA' && (
                  <div
                    className="p-12 rounded flex justify-between items-center flex-wrap gap-10"
                    style={{
                      background: balancaStatus === 'CONECTADA' ? 'rgba(16,185,129,0.1)' : 'var(--bg-1)',
                      border: `1px solid ${balancaStatus === 'CONECTADA' ? 'rgba(16,185,129,0.45)' : 'var(--border)'}`,
                    }}
                  >
                    <div className="flex items-center gap-10">
                      {balancaStatus === 'CONECTADA' ? <Wifi size={20} className="text-success" /> : <WifiOff size={20} className="text-muted" />}
                      <div>
                        <div className="text-xs font-bold uppercase text-muted">
                          Balança Serial ({cfgEstacao.balancaBaudRate || 9600} bps)
                        </div>
                        <div className="flex items-center gap-8">
                          <strong className="text-lg font-mono text-cyan">{balancaPeso.toFixed(3).replace('.', ',')} kg</strong>
                          {balancaStatus === 'CONECTADA' && (
                            <span className={`badge ${balancaEstavel ? 'badge--success' : 'badge--warning'}`}>
                              {balancaEstavel ? 'PESO ESTÁVEL' : 'OSCILANDO'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-8 flex-wrap">
                      <label className="flex items-center gap-6 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoGravarEstavel}
                          onChange={(e) => setAutoGravarEstavel(e.target.checked)}
                        />
                        Gravar ao estabilizar
                      </label>
                      <button
                        type="button"
                        className={`btn btn--sm ${balancaStatus === 'CONECTADA' ? 'btn--danger' : 'btn--info'}`}
                        disabled={!isWebSerialSupported() && balancaStatus !== 'CONECTADA'}
                        onClick={handleToggleBalanca}
                      >
                        <Scale size={14} /> {balancaStatus === 'CONECTADA' ? 'Desconectar' : 'Conectar Balança'}
                      </button>
                    </div>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleGravarCaixaPesada()
                  }}
                  className="flex flex-col gap-10"
                >
                  <PesagemTaraFields
                    taras={taras}
                    value={boxData}
                    onChange={(next, meta) => {
                      setBoxData(next)
                      setMetaPesagem(meta)
                    }}
                    permitirTaraManual
                    permitirLoteManual
                    pesoBrutoRef={pesoBrutoRef}
                    onEnterPesoBruto={() => handleGravarCaixaPesada()}
                  />

                  <div className="flex justify-between items-center flex-wrap gap-8 pt-4">
                    <div className="text-xs text-muted">
                      Impressão: <strong>{cfgEstacao.modoImpressao}</strong> • Auto:{' '}
                      <strong>{cfgEstacao.imprimirAutoAoSalvar ? 'Sim' : 'Não'}</strong>
                    </div>
                    <button type="submit" className="btn btn--primary" disabled={salvandoCaixa}>
                      <Printer size={16} />{' '}
                      {salvandoCaixa ? 'Salvando...' : 'Gravar Caixa & Imprimir Etiqueta'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* MODO 3: BIPAGEM VIA BANCO UNIVERSAL DE TXT DO FORNECEDOR */}
            {modoDoca === 'BIPAGEM' && (
              <div className="flex flex-col gap-12">
                {txtDisponiveisFornecedor === 0 ? (
                  <div className="p-12 rounded flex items-center gap-10 text-xs font-bold" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}>
                    <AlertTriangle size={18} />
                    <div>
                      Este fornecedor ({pcDetalhe.fornecedor_nome}) não possui arquivos TXT pré-importados pendentes.
                      Importe os arquivos `.txt` na tela <strong>Compras</strong> ou utilize <strong>Pesagem Manual / Balança</strong>.
                    </div>
                  </div>
                ) : (
                  <div className="p-10 rounded text-xs" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.35)' }}>
                    <strong className="text-cyan">Banco Universal TXT Ativo ({pcDetalhe.fornecedor_nome}):</strong>{' '}
                    <strong>{txtDisponiveisFornecedor}</strong> caixa(s) disponíveis no pool do fornecedor.
                  </div>
                )}

                <form onSubmit={handleBiparModoTxt} className="flex gap-8 items-center">
                  <input
                    ref={scanTxtRef}
                    type="text"
                    className="form-input form-input--scanner"
                    style={{ flex: 1 }}
                    placeholder="Bipe o código de barras da caixa (TXT) e pressione Enter..."
                    value={scanTxt}
                    onChange={(e) => setScanTxt(e.target.value)}
                    disabled={bipandoTxt}
                  />
                  <button type="submit" className="btn btn--primary" disabled={bipandoTxt}>
                    <Barcode size={16} /> {bipandoTxt ? 'Validando...' : 'Bipar Caixa'}
                  </button>
                </form>

                {preCaixasFornecedor.length > 0 && (
                  <div className="table-wrap" style={{ maxHeight: 210, overflowY: 'auto' }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>EAN TXT</th>
                          <th>Produto</th>
                          <th style={{ textAlign: 'right' }}>Peso Líq.</th>
                          <th style={{ textAlign: 'right' }}>Peças</th>
                          <th>Lote / Validade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preCaixasFornecedor.slice(0, 60).map((cx) => (
                          <tr key={cx.id}>
                            <td className="font-mono text-cyan font-bold">{cx.ean_caixa}</td>
                            <td className="text-sm">{cx.produto_codigo} — {cx.produto_descricao}</td>
                            <td style={{ textAlign: 'right' }} className="font-mono font-bold">{fmtKg(cx.peso_liquido_kg)}</td>
                            <td style={{ textAlign: 'right' }}>{cx.qtd_pecas ?? '-'}</td>
                            <td className="text-xs font-mono">{cx.lote || '-'} • {fmtDataBR(cx.validade)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CAIXAS RECEBIDAS NESTE PEDIDO SEMPRE VISÍVEL ABAIXO DA MESA */}
          <div className="card" style={{ padding: '12px 14px' }}>
            <h4 className="text-xs font-bold uppercase text-muted mb-8 flex items-center gap-8 m-0">
              <Layers size={15} className="text-success" /> Caixas Recebidas Neste Pedido ({(pcDetalhe.caixas_bipadas || []).length})
            </h4>
            {(pcDetalhe.caixas_bipadas || []).length === 0 ? (
              <div className="text-xs text-muted py-8">
                Nenhuma caixa lançada neste pedido ainda. Pese ou bipe uma caixa acima para vê-la aqui instantaneamente.
              </div>
            ) : (
              <div className="table-wrap mt-8" style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>EAN / Etiqueta</th>
                      <th>Produto</th>
                      <th>Lote / Val.</th>
                      <th style={{ textAlign: 'right' }}>Pç</th>
                      <th style={{ textAlign: 'right' }}>Peso Líq.</th>
                      <th>End.</th>
                      <th style={{ textAlign: 'right' }}>Etiqueta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pcDetalhe.caixas_bipadas.map((c) => (
                      <tr key={c.id}>
                        <td className="font-mono font-bold text-cyan text-xs">{c.ean_caixa}</td>
                        <td className="text-xs">{c.produto_codigo} — {c.produto_descricao}</td>
                        <td className="text-xs font-mono">{c.lote || '-'} • {fmtDataBR(c.validade)}</td>
                        <td style={{ textAlign: 'right' }} className="text-xs">{c.qtd_pecas ?? '-'}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs">{fmtKg(c.peso_kg)}</td>
                        <td className="font-mono text-xs">{c.endereco || 'REC'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => despacharImpressaoEtiqueta([c], { onAbrirModal: (ets) => setEtiquetaPreview(ets) })}
                          >
                            <Printer size={13} /> Imprimir
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
      </div>

      <EtiquetaZebraModal
        isOpen={Boolean(etiquetaPreview)}
        etiquetas={etiquetaPreview || []}
        autoPrint={false}
        onClose={() => setEtiquetaPreview(null)}
        titulo="Etiqueta da Caixa Recebida"
      />

      {relatorioPrint && (
        <RelatorioRecebimentoPrint
          pedido={relatorioPrint}
          onClose={() => setRelatorioPrint(null)}
          autoPrint
        />
      )}

      <ConfigEstacaoModal
        isOpen={configEstacaoOpen}
        onClose={() => setConfigEstacaoOpen(false)}
        onSaved={(newCfg) => setCfgEstacao(newCfg)}
      />
    </div>
  )
}

export default RecebimentoPedidoDoca
