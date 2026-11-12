import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  LogOut,
  Plus,
  Truck,
  CheckCircle2,
  Trash2,
  Barcode,
  AlertTriangle,
  ArrowRight,
  Clock,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Printer,
  ClipboardList,
  ShieldAlert,
  CheckSquare,
  Search
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import * as movimentacoesQueries from '../queries/movimentacoes.js'
import * as producaoQueries from '../queries/producao.js'
import * as saidaQueries from '../queries/saida.js'
import { RomaneioEmbarquePrint } from '../components/shared/RomaneioEmbarquePrint'

const fmtKg = (v) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0].split(' ')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}
const fmtDataHora = (d) => {
  if (!d) return '-'
  const raw = String(d)
  const utc = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const dt = new Date(utc)
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleString('pt-BR')
}

export function Saida() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeExpedir = Boolean(
    operador && (operador.permissoes?.expedicao || Number(operador.is_adm) === 1 || operador.perfil === 'gestor')
  )

  const [aba, setAba] = useState('SEPARACAO') // 'SEPARACAO' | 'EXPEDICAO' | 'HISTORICO'
  const [loading, setLoading] = useState(false)

  // Fila de separação (pedidos liberados/em separação + eventuais romaneios avulsos abertos)
  const [pedidosFila, setPedidosFila] = useState([])
  const [romaneiosAvulsosAbertos, setRomaneiosAvulsosAbertos] = useState([])
  const [romaneioAtual, setRomaneioAtual] = useState(null)

  // Emergência: romaneio avulso escondido
  const [mostrarEmergencia, setMostrarEmergencia] = useState(false)
  const [avulsoCliente, setAvulsoCliente] = useState('PAVAN')
  const [avulsoPrevisao, setAvulsoPrevisao] = useState('')

  // Bipe na separação
  const [codigoInput, setCodigoInput] = useState('')
  const [fefoAlerta, setFefoAlerta] = useState(null) // { caixa, alertas }
  const [regraAlerta, setRegraAlerta] = useState(null) // { caixa, tipoConfirmacao, mensagem }
  const [modalFinalizarParcial, setModalFinalizarParcial] = useState(null) // array de itens faltantes
  const [ultimoFinalizado, setUltimoFinalizado] = useState(null) // romaneio recém finalizado p/ impressão rápida
  const sepInputRef = useRef(null)

  // Expedição (Conferência caixa a caixa)
  const [romaneiosExpedicao, setRomaneiosExpedicao] = useState([])
  const [romaneioConfAtual, setRomaneioConfAtual] = useState(null)
  const [confCodigoInput, setConfCodigoInput] = useState('')
  const [confErroBanner, setConfErroBanner] = useState('')
  const confInputRef = useRef(null)

  // Histórico
  const [romaneiosHistorico, setRomaneiosHistorico] = useState([])
  const [histExpandedId, setHistExpandedId] = useState(null)
  const [histDetalhesMap, setHistDetalhesMap] = useState({})
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [previsaoFiltro, setPrevisaoFiltro] = useState('')

  // Modal de impressão do Romaneio de Embarque
  const [printRomaneio, setPrintRomaneio] = useState(null)

  const carregarFilaSeparacao = async () => {
    setLoading(true)
    try {
      const [peds, montando] = await Promise.all([
        saidaQueries.listarPedidosParaSeparacao(),
        saidaQueries.listarRomaneios('MONTANDO')
      ])
      setPedidosFila(peds)
      setRomaneiosAvulsosAbertos(montando.filter((r) => !r.pedido_id))
    } catch (err) {
      toastError('Erro ao carregar fila de separação: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const carregarExpedicao = async (manterSelecionadoId = null) => {
    setLoading(true)
    try {
      const lista = await saidaQueries.listarRomaneios('AGUARDANDO_EXPEDICAO')
      setRomaneiosExpedicao(lista)
      const alvoId = manterSelecionadoId ?? romaneioConfAtual?.id
      if (alvoId) {
        if (lista.some((r) => r.id === alvoId)) {
          const det = await saidaQueries.detalhesRomaneio(alvoId)
          setRomaneioConfAtual(det)
        } else {
          setRomaneioConfAtual(null)
        }
      }
    } catch (err) {
      toastError('Erro ao carregar expedição: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const carregarHistorico = async () => {
    setLoading(true)
    try {
      const lista = await saidaQueries.listarRomaneios('EXPEDIDO', dataInicio || null, dataFim || null, previsaoFiltro || null)
      setRomaneiosHistorico(lista)
    } catch (err) {
      toastError('Erro ao carregar histórico: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (aba === 'SEPARACAO') {
      if (romaneioAtual) {
        saidaQueries.detalhesRomaneio(romaneioAtual.id).then((d) => d && setRomaneioAtual(d))
      } else {
        carregarFilaSeparacao()
      }
    } else if (aba === 'EXPEDICAO') {
      carregarExpedicao()
    } else if (aba === 'HISTORICO') {
      carregarHistorico()
    }
  }, [aba])

  const recarregarRomaneioSeparacao = async (id = romaneioAtual?.id) => {
    if (!id) return
    const det = await saidaQueries.detalhesRomaneio(id)
    setRomaneioAtual(det)
  }

  // ── Abertura de separação a partir do Pedido ──
  const handleSelecionarPedido = async (ped) => {
    setUltimoFinalizado(null)
    setLoading(true)
    try {
      const res = await saidaQueries.iniciarOuAbrirSeparacaoPedido(ped.id, operador.id, operador.nome)
      if (!res.success) return toastError(res.error)
      const det = await saidaQueries.detalhesRomaneio(res.romaneio.id)
      setRomaneioAtual(det)
      toastSuccess(`Separação aberta: ${det.codigo} (${ped.codigo} — ${ped.titulo})`)
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Emergência: Romaneio Avulso ──
  const handleCriarAvulso = async (e) => {
    e.preventDefault()
    if (!avulsoCliente.trim()) return toastWarning('Informe o cliente/identificação.')
    setLoading(true)
    try {
      const res = await saidaQueries.criarRomaneio({
        cliente: avulsoCliente.trim(),
        previsao_entrega: avulsoPrevisao || null,
        operador_id: operador.id,
        operador_nome: operador.nome,
        pedido_id: null
      })
      if (!res.success) return toastError(res.error)
      const det = await saidaQueries.detalhesRomaneio(res.romaneio.id)
      setRomaneioAtual(det)
      setMostrarEmergencia(false)
      toastWarning(`Romaneio avulso de emergência ${det.codigo} aberto.`)
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Bipe de caixa na Separação ──
  const executarAdicaoCaixa = async (cx, confirmado = false) => {
    const addRes = await saidaQueries.adicionarCaixa(
      romaneioAtual.id,
      cx,
      operador.id,
      operador.nome,
      { confirmado }
    )

    if (addRes.requiresConfirmation) {
      setRegraAlerta({
        caixa: cx,
        tipoConfirmacao: addRes.tipoConfirmacao,
        mensagem: addRes.mensagem
      })
      return
    }

    if (!addRes.success) {
      return toastError(addRes.error)
    }

    toastSuccess(`Caixa separada: ${cx.produto_descricao} (${Number(cx.peso_kg).toFixed(2)} kg)`)
    await recarregarRomaneioSeparacao(romaneioAtual.id)
  }

  const processarBipeSeparacao = async (codigo) => {
    const clean = String(codigo || '').trim()
    if (!clean || !romaneioAtual) return
    setCodigoInput('')

    try {
      const res = await movimentacoesQueries.identificarCodigoMovimentacao(clean)
      if (!res.encontrado || res.tipo !== 'CAIXA') {
        return toastError(
          res.encontrado
            ? `Código lido é um ${res.tipo}. Na separação, bipe a etiqueta individual da CAIXA.`
            : 'Caixa não encontrada ou código inválido.'
        )
      }

      const cx = res.dados
      if (cx.status !== 'DISPONIVEL') {
        return toastError(`Esta caixa (${clean}) já está com status ${cx.status}.`)
      }

      const fefo = await producaoQueries.verificarFEFO(cx.produto_id, cx.validade)
      if (fefo && fefo.temAlerta) {
        setFefoAlerta({ caixa: cx, alertas: fefo.alertas })
        return
      }

      await executarAdicaoCaixa(cx, false)
    } catch (err) {
      toastError('Erro ao processar leitura: ' + err.message)
    } finally {
      sepInputRef.current?.focus()
    }
  }

  const confirmarFefo = async () => {
    if (!fefoAlerta) return
    const { caixa } = fefoAlerta
    setFefoAlerta(null)
    await executarAdicaoCaixa(caixa, false)
  }

  const confirmarRegraPedido = async () => {
    if (!regraAlerta) return
    const { caixa } = regraAlerta
    setRegraAlerta(null)
    await executarAdicaoCaixa(caixa, true)
  }

  const handleRemoverCaixa = async (item) => {
    try {
      const res = await saidaQueries.removerCaixa(
        romaneioAtual.id,
        item.id,
        item.caixa_id,
        item.produto_id,
        item.peso_kg,
        item.validade,
        item.endereco,
        operador.id,
        operador.nome
      )
      if (!res.success) return toastError(res.error)
      toastSuccess(`Caixa ${item.ean_caixa} devolvida ao estoque DISPONÍVEL.`)
      await recarregarRomaneioSeparacao(romaneioAtual.id)
    } catch (err) {
      toastError(err.message)
    }
  }

  const executarFinalizacaoSeparacao = async () => {
    if (!romaneioAtual) return
    setModalFinalizarParcial(null)
    setLoading(true)
    try {
      const res = await saidaQueries.finalizarMontagem(romaneioAtual.id)
      if (!res.success) return toastError(res.error)
      const detFinalizado = await saidaQueries.detalhesRomaneio(romaneioAtual.id)
      setUltimoFinalizado(detFinalizado)
      setRomaneioAtual(null)
      toastSuccess(`Separação ${detFinalizado.codigo} finalizada! Enviada para Conferência & Expedição e liberada para impressão do Romaneio.`)
      await carregarFilaSeparacao()
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSolicitarFinalizarSeparacao = () => {
    if (!romaneioAtual) return
    if (!romaneioAtual.itens || romaneioAtual.itens.length === 0) {
      return toastWarning('Bipe pelo menos 1 caixa antes de finalizar a separação.')
    }
    const faltantes = (romaneioAtual.pedidoItens || []).filter(
      (pi) => Number(pi.kg_separado) + 0.001 < Number(pi.qtd_kg_solicitada)
    )
    if (faltantes.length > 0) {
      setModalFinalizarParcial(faltantes)
      return
    }
    executarFinalizacaoSeparacao()
  }

  const handleExcluirRomaneioAberto = async () => {
    if (!romaneioAtual) return
    if (!window.confirm(`Deseja cancelar/excluir a separação ${romaneioAtual.codigo}? As caixas bipadas voltarão para DISPONÍVEL.`)) {
      return
    }
    const res = await saidaQueries.excluirRomaneio(romaneioAtual.id)
    if (!res.success) return toastError(res.error)
    toastSuccess('Separação excluída e caixas devolvidas ao estoque.')
    setRomaneioAtual(null)
    await carregarFilaSeparacao()
  }

  // ── Bipe na Expedição (Conferência caixa a caixa) ──
  const processarBipeConferencia = async (codigo) => {
    const clean = String(codigo || '').trim()
    if (!clean || !romaneioConfAtual) return
    setConfCodigoInput('')
    setConfErroBanner('')

    try {
      const res = await saidaQueries.conferirCaixaRomaneio(
        romaneioConfAtual.id,
        clean,
        operador.id,
        operador.nome
      )

      if (!res.success) {
        if (res.alreadyChecked) {
          toastWarning(res.error)
        } else {
          setConfErroBanner(res.error)
          toastError(res.error)
        }
        return
      }

      toastSuccess(
        res.todasConferidas
          ? `Todas as ${res.totalCaixas} caixas foram conferidas! Carga liberada para EXPEDIR.`
          : `Conferida: ${res.item.produto_descricao} (${res.qtdConferidas}/${res.totalCaixas})`
      )
      await carregarExpedicao(romaneioConfAtual.id)
    } catch (err) {
      toastError('Erro na conferência: ' + err.message)
    } finally {
      confInputRef.current?.focus()
    }
  }

  const handleExpedirCarga = async (romId) => {
    if (!window.confirm('Confirma a expedição definitiva desta carga? O estoque será baixado como EXPEDIDA.')) {
      return
    }
    setLoading(true)
    try {
      const res = await saidaQueries.expedirRomaneio(romId, operador.id, operador.nome)
      if (!res.success) return toastError(res.error)
      const detExpedido = await saidaQueries.detalhesRomaneio(romId)
      toastSuccess(`Carga ${detExpedido?.codigo || ''} expedida com sucesso!`)
      setRomaneioConfAtual(null)
      setConfErroBanner('')
      await carregarExpedicao()
      if (detExpedido) {
        setPrintRomaneio(detExpedido)
      }
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReabrirSeparacao = async (rom) => {
    if (!window.confirm(`Deseja reabrir o romaneio ${rom.codigo} para separação? As conferências feitas serão zeradas.`)) {
      return
    }
    const res = await saidaQueries.reabrirRomaneio(rom.id)
    if (!res.success) return toastError(res.error)
    const det = await saidaQueries.detalhesRomaneio(rom.id)
    setRomaneioConfAtual(null)
    setRomaneioAtual(det)
    setAba('SEPARACAO')
    toastSuccess(`Romaneio ${rom.codigo} reaberto para separação.`)
  }

  // Hook global do scanner ativo somente na tela certa
  useBarcodeScanner(
    (code) => {
      if (aba === 'SEPARACAO' && romaneioAtual && !fefoAlerta && !regraAlerta && !modalFinalizarParcial) {
        processarBipeSeparacao(code)
      } else if (aba === 'EXPEDICAO' && romaneioConfAtual) {
        processarBipeConferencia(code)
      }
    },
    (aba === 'SEPARACAO' && Boolean(romaneioAtual)) || (aba === 'EXPEDICAO' && Boolean(romaneioConfAtual))
  )

  const handleAbrirRomaneioImpressao = async (romaneioId) => {
    try {
      const det = await saidaQueries.detalhesRomaneio(romaneioId)
      if (!det) return toastError('Romaneio não encontrado.')
      setPrintRomaneio(det)
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleToggleHistDetalhes = async (romId) => {
    if (histExpandedId === romId) {
      setHistExpandedId(null)
      return
    }
    setHistExpandedId(romId)
    if (!histDetalhesMap[romId]) {
      const det = await saidaQueries.detalhesRomaneio(romId)
      if (det) setHistDetalhesMap((prev) => ({ ...prev, [romId]: det }))
    }
  }

  const resumoHist = useMemo(() => {
    return {
      totalRomaneios: romaneiosHistorico.length,
      totalCaixas: romaneiosHistorico.reduce((s, r) => s + Number(r.total_caixas || 0), 0),
      totalPeso: romaneiosHistorico.reduce((s, r) => s + Number(r.total_peso || 0), 0)
    }
  }, [romaneiosHistorico])

  const totalPesoSep = (romaneioAtual?.itens || []).reduce((s, i) => s + Number(i.peso_kg || 0), 0)

  return (
    <div className="page-container">
      {/* Cabeçalho */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <LogOut size={26} /> Saída de Materiais — Separação &amp; Expedição
          </h1>
          <p className="page-subtitle">
            Selecione o pedido liberado para bipar as caixas na câmara e finalize para conferência caixa a caixa na expedição.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${aba === 'SEPARACAO' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAba('SEPARACAO')}
          >
            📦 Separação de Pedidos
          </button>
          {podeExpedir && (
            <button
              type="button"
              className={`btn ${aba === 'EXPEDICAO' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAba('EXPEDICAO')}
            >
              🚚 Conferência &amp; Expedição
              {romaneiosExpedicao.length > 0 && (
                <span className="badge badge-warning" style={{ marginLeft: '6px' }}>{romaneiosExpedicao.length}</span>
              )}
            </button>
          )}
          <button
            type="button"
            className={`btn ${aba === 'HISTORICO' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAba('HISTORICO')}
          >
            🕓 Histórico
          </button>
        </div>
      </div>

      {/* ══════════════════════ ABA 1: SEPARAÇÃO DE PEDIDOS ══════════════════════ */}
      {aba === 'SEPARACAO' && !romaneioAtual && (
        <div>
          {ultimoFinalizado && (
            <div
              className="card"
              style={{
                marginBottom: '16px',
                padding: '14px 18px',
                borderColor: '#22c55e',
                background: 'rgba(34, 197, 94, 0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: '#4ade80' }}>
                  ✅ Separação {ultimoFinalizado.codigo} finalizada com sucesso!
                </div>
                <div className="text-sm">
                  {ultimoFinalizado.pedido_codigo ? `${ultimoFinalizado.pedido_codigo} — ` : ''}
                  <strong>{ultimoFinalizado.pedido_titulo || ultimoFinalizado.cliente}</strong> (
                  {ultimoFinalizado.itens?.length || 0} cx | {fmtKg((ultimoFinalizado.itens || []).reduce((s, i) => s + Number(i.peso_kg || 0), 0))})
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setPrintRomaneio(ultimoFinalizado)}
                >
                  <Printer size={16} /> Imprimir Romaneio de Embarque
                </button>
                {podeExpedir && (
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => {
                      setAba('EXPEDICAO')
                      carregarExpedicao(ultimoFinalizado.id)
                    }}
                  >
                    <Truck size={16} /> Ir para Conferência
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Fila de Pedidos Liberados / Em Separação */}
          <div className="card" style={{ padding: '18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '17px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ClipboardList size={20} /> Pedidos Disponíveis para Separação
                </h2>
                <p className="text-muted text-xs" style={{ marginTop: '4px' }}>
                  Clique em um pedido abaixo para iniciar ou continuar a bipagem das caixas.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={carregarFilaSeparacao} disabled={loading}>
                Atualizar Fila
              </button>
            </div>

            {pedidosFila.length === 0 ? (
              <div className="text-muted" style={{ textAlign: 'center', padding: '36px 16px' }}>
                Nenhum pedido liberado aguardando separação no momento. Peça à gerência/administração para liberar um pedido na aba <strong>Pedidos</strong>.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '12px' }}>
                {pedidosFila.map((ped) => {
                  const pct =
                    Number(ped.total_kg_solicitado) > 0
                      ? Math.min(100, Math.round((Number(ped.total_kg_separado) / Number(ped.total_kg_solicitado)) * 100))
                      : 0
                  const emAndamento = ped.status === 'EM_SEPARACAO'
                  return (
                    <div
                      key={ped.id}
                      className="card"
                      style={{
                        padding: '16px',
                        borderColor: emAndamento ? '#f59e0b' : 'rgba(56, 189, 248, 0.35)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span className="font-mono font-bold" style={{ fontSize: '13px', color: '#38bdf8' }}>
                            {ped.codigo}{ped.romaneio_codigo ? ` • ${ped.romaneio_codigo}` : ''}
                          </span>
                          <span className={`badge ${emAndamento ? 'badge-warning' : 'badge-info'}`}>
                            {emAndamento ? 'Em Separação' : 'Liberado'}
                          </span>
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '4px' }}>{ped.titulo}</div>
                        <div className="text-muted text-xs">
                          Cliente: <strong>{ped.cliente}</strong> • Previsão: <strong>{fmtData(ped.previsao_entrega)}</strong>
                        </div>
                        {ped.observacoes && (
                          <div className="text-xs" style={{ marginTop: '6px', color: '#fbbf24' }}>
                            Obs: {ped.observacoes}
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span>{ped.qtd_itens} produto(s) • Solicitado: <strong>{fmtKg(ped.total_kg_solicitado)}</strong></span>
                          <span>Separado: <strong>{fmtKg(ped.total_kg_separado)}</strong> ({ped.total_caixas_separadas} cx)</span>
                        </div>
                        <div style={{ height: '7px', background: '#1e293b', borderRadius: '999px', overflow: 'hidden', marginBottom: '12px' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#38bdf8' }} />
                        </div>
                        <button
                          type="button"
                          className={`btn ${emAndamento ? 'btn-warning' : 'btn-primary'}`}
                          style={{ width: '100%', justifyContent: 'center' }}
                          onClick={() => handleSelecionarPedido(ped)}
                        >
                          <Barcode size={16} />
                          {emAndamento ? 'Continuar Separação' : 'Iniciar Separação'}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Romaneios avulsos abertos (emergência) se existirem */}
          {romaneiosAvulsosAbertos.length > 0 && (
            <div className="card" style={{ padding: '16px', marginBottom: '16px', borderColor: '#f59e0b' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#fbbf24' }}>
                ⚠️ Romaneios Avulsos em Aberto (Emergência)
              </h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {romaneiosAvulsosAbertos.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => setRomaneioAtual(await saidaQueries.detalhesRomaneio(r.id))}
                  >
                    {r.codigo} — {r.cliente} ({r.total_caixas} cx / {fmtKg(r.total_peso)})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Botão escondido/discreto de emergência (Q4) */}
          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ opacity: 0.65, fontSize: '12px' }}
              onClick={() => setMostrarEmergencia((v) => !v)}
            >
              {mostrarEmergencia ? 'Ocultar modo emergência' : 'Modo Emergência: Romaneio Avulso (sem pedido)'}
            </button>

            {mostrarEmergencia && (
              <form
                onSubmit={handleCriarAvulso}
                className="card"
                style={{ maxWidth: '560px', margin: '12px auto 0', padding: '16px', textAlign: 'left', borderColor: '#f59e0b' }}
              >
                <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: '10px', fontSize: '13px' }}>
                  ⚠️ Romaneio Avulso de Emergência (sem vínculo com Pedido)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px auto', gap: '10px', alignItems: 'end' }}>
                  <div>
                    <label className="form-label">Identificação / Cliente *</label>
                    <input
                      className="form-input"
                      value={avulsoCliente}
                      onChange={(e) => setAvulsoCliente(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Previsão</label>
                    <input
                      type="date"
                      className="form-input"
                      value={avulsoPrevisao}
                      onChange={(e) => setAvulsoPrevisao(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-warning" disabled={loading}>
                    <Plus size={15} /> Abrir
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ TELA DE BIPAGEM DA SEPARAÇÃO ══════════════════════ */}
      {aba === 'SEPARACAO' && romaneioAtual && (
        <div>
          {/* Barra superior da separação ativa */}
          <div className="card" style={{ padding: '16px', marginBottom: '16px', borderColor: '#38bdf8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge badge-info font-mono">{romaneioAtual.codigo}</span>
                  {romaneioAtual.pedido_codigo && (
                    <span className="badge badge-purple font-mono">{romaneioAtual.pedido_codigo}</span>
                  )}
                  <span className="text-muted text-xs">Separador: {romaneioAtual.operador_nome}</span>
                </div>
                <h2 style={{ margin: '6px 0 2px 0' }}>
                  {romaneioAtual.pedido_titulo || romaneioAtual.cliente}
                </h2>
                <div className="text-muted text-xs">
                  Cliente: <strong>{romaneioAtual.pedido_cliente || romaneioAtual.cliente}</strong>
                  {' • '}Previsão: <strong>{fmtData(romaneioAtual.previsao_entrega)}</strong>
                  {' • '}Total Separado: <strong>{romaneioAtual.itens?.length || 0} cx | {fmtKg(totalPesoSep)}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setRomaneioAtual(null)
                    carregarFilaSeparacao()
                  }}
                >
                  ← Voltar à Fila
                </button>
                <button type="button" className="btn btn-danger" onClick={handleExcluirRomaneioAberto}>
                  <Trash2 size={15} /> Excluir
                </button>
                <button type="button" className="btn btn-success" onClick={handleSolicitarFinalizarSeparacao}>
                  <CheckCircle2 size={16} /> Finalizar Separação
                </button>
              </div>
            </div>
          </div>

          {/* Checklist do Pedido (quando houver pedido vinculado) */}
          {romaneioAtual.pedido_id && (
            <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '15px' }}>Checklist do Pedido (Tolerância automática até +50%)</h3>
                <span className="text-xs text-muted">Acima de +50% ou produto fora do pedido exige confirmação</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Pedido</th>
                      <th style={{ textAlign: 'right' }}>Separado</th>
                      <th style={{ textAlign: 'right' }}>Falta</th>
                      <th style={{ width: '180px' }}>Progresso</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(romaneioAtual.pedidoItens || []).map((pi) => {
                      const pct = Number(pi.pct_separado || 0)
                      const excedeu50 = Number(pi.kg_separado) > Number(pi.limite_max_kg) + 0.001
                      const completo = Number(pi.kg_separado) + 0.001 >= Number(pi.qtd_kg_solicitada)
                      return (
                        <tr key={pi.id}>
                          <td>
                            <div style={{ fontWeight: 700 }}>{pi.produto_descricao}</div>
                            {pi.observacao && <div className="text-xs text-muted">Obs: {pi.observacao}</div>}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {fmtKg(pi.qtd_kg_solicitada)}
                            {pi.qtd_caixas_solicitada ? <div className="text-xs text-muted">{pi.qtd_caixas_solicitada} cx prev.</div> : null}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>
                            {fmtKg(pi.kg_separado)}
                            <div className="text-xs text-muted">{pi.caixas_separadas} cx</div>
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            {pi.kg_faltante > 0 ? fmtKg(pi.kg_faltante) : '0,00 kg'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ flex: 1, height: '8px', background: '#1e293b', borderRadius: '999px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${Math.min(100, pct)}%`,
                                    height: '100%',
                                    background: excedeu50 ? '#f59e0b' : completo ? '#22c55e' : '#38bdf8'
                                  }}
                                />
                              </div>
                              <span className="font-mono text-xs" style={{ minWidth: '38px', textAlign: 'right' }}>{pct}%</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {excedeu50 ? (
                              <span className="badge badge-warning">Acima +50%</span>
                            ) : completo ? (
                              <span className="badge badge-success">Atendido</span>
                            ) : (
                              <span className="badge badge-neutral">Pendente</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Campo de Bipe */}
          <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                processarBipeSeparacao(codigoInput)
              }}
              style={{ display: 'flex', gap: '10px', alignItems: 'center' }}
            >
              <Barcode size={24} className="text-info" />
              <input
                ref={sepInputRef}
                className="form-input"
                autoFocus
                placeholder="Bipe ou digite o EAN da caixa para separar neste pedido..."
                value={codigoInput}
                onChange={(e) => setCodigoInput(e.target.value)}
                style={{ fontSize: '15px', fontFamily: 'monospace' }}
              />
              <button type="submit" className="btn btn-primary">Adicionar Caixa</button>
            </form>
          </div>

          {/* Lista de Caixas Bipadas */}
          <div className="card" style={{ padding: '16px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '15px' }}>
              Caixas Bipadas nesta Separação ({romaneioAtual.itens?.length || 0} cx — {fmtKg(totalPesoSep)})
            </h3>

            {!romaneioAtual.itens?.length ? (
              <div className="text-muted" style={{ textAlign: 'center', padding: '24px' }}>
                Nenhuma caixa bipada ainda. Use o leitor de código de barras acima.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>EAN Caixa</th>
                      <th>Lote</th>
                      <th>Validade</th>
                      <th>Endereço</th>
                      <th style={{ textAlign: 'right' }}>Peso</th>
                      <th style={{ textAlign: 'right' }}>Estornar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {romaneioAtual.itens.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span style={{ fontWeight: 700 }}>{item.produto_descricao}</span>
                          {Number(item.extra_fora_pedido) === 1 && (
                            <span className="badge badge-warning" style={{ marginLeft: '8px' }}>Fora do Pedido (Confirmado)</span>
                          )}
                        </td>
                        <td className="font-mono">{item.ean_caixa}</td>
                        <td className="font-mono">{item.lote || '-'}</td>
                        <td>{fmtData(item.validade)}</td>
                        <td className="font-mono">{item.endereco || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(item.peso_kg)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            title="Remover caixa da separação e devolver ao estoque"
                            onClick={() => handleRemoverCaixa(item)}
                          >
                            <Trash2 size={14} />
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

      {/* ══════════════════════ ABA 2: CONFERÊNCIA & EXPEDIÇÃO ══════════════════════ */}
      {aba === 'EXPEDICAO' && podeExpedir && (
        <div style={{ display: 'grid', gridTemplateColumns: romaneioConfAtual ? '340px 1fr' : '1fr', gap: '16px', alignItems: 'start' }}>
          {/* Lista de romaneios aguardando conferência/embarque */}
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '16px' }}>Aguardando Conferência ({romaneiosExpedicao.length})</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => carregarExpedicao()}>
                Atualizar
              </button>
            </div>

            {romaneiosExpedicao.length === 0 ? (
              <div className="text-muted" style={{ textAlign: 'center', padding: '28px 10px' }}>
                Nenhuma separação finalizada aguardando conferência na expedição.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {romaneiosExpedicao.map((rom) => {
                  const selecionado = romaneioConfAtual?.id === rom.id
                  const conf = Number(rom.qtd_conferidas || 0)
                  const tot = Number(rom.total_caixas || 0)
                  const completo = tot > 0 && conf === tot
                  return (
                    <div
                      key={rom.id}
                      onClick={() => {
                        setConfErroBanner('')
                        carregarExpedicao(rom.id)
                      }}
                      className="card"
                      style={{
                        padding: '12px',
                        cursor: 'pointer',
                        borderColor: selecionado ? '#38bdf8' : completo ? '#22c55e' : 'rgba(148, 163, 184, 0.25)',
                        background: selecionado ? 'rgba(56, 189, 248, 0.08)' : undefined
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span className="font-mono font-bold" style={{ fontSize: '13px' }}>
                          {rom.codigo}{rom.pedido_codigo ? ` • ${rom.pedido_codigo}` : ''}
                        </span>
                        <span className={`badge ${completo ? 'badge-success' : 'badge-warning'}`}>
                          {conf}/{tot} cx conf.
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '14px' }}>{rom.pedido_titulo || rom.cliente}</div>
                      <div className="text-muted text-xs" style={{ marginTop: '4px' }}>
                        {tot} cx • {fmtKg(rom.total_peso)} • Separador: {rom.operador_nome}
                      </div>
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ flex: 1, justifyContent: 'center' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAbrirRomaneioImpressao(rom.id)
                          }}
                        >
                          <Printer size={13} /> Imprimir Romaneio
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Painel de Conferência Caixa a Caixa */}
          {romaneioConfAtual && (
            <div className="card" style={{ padding: '18px', borderColor: '#38bdf8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="badge badge-info font-mono">{romaneioConfAtual.codigo}</span>
                    {romaneioConfAtual.pedido_codigo && (
                      <span className="badge badge-purple font-mono">{romaneioConfAtual.pedido_codigo}</span>
                    )}
                    <span className={`badge ${romaneioConfAtual.conferenciasSummary?.todasConferidas ? 'badge-success' : 'badge-warning'}`}>
                      {romaneioConfAtual.conferenciasSummary?.todasConferidas
                        ? '100% Conferido — Pronto p/ Expedir'
                        : `Conferência: ${romaneioConfAtual.conferenciasSummary?.qtdConferidas || 0} / ${romaneioConfAtual.conferenciasSummary?.totalCaixas || 0} caixas`}
                    </span>
                  </div>
                  <h2 style={{ margin: '6px 0 2px 0' }}>
                    {romaneioConfAtual.pedido_titulo || romaneioConfAtual.cliente}
                  </h2>
                  <div className="text-muted text-xs">
                    Cliente: <strong>{romaneioConfAtual.pedido_cliente || romaneioConfAtual.cliente}</strong>
                    {' • '}Separado por: <strong>{romaneioConfAtual.operador_nome}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleAbrirRomaneioImpressao(romaneioConfAtual.id)}
                  >
                    <Printer size={16} /> Imprimir Romaneio de Embarque
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleReabrirSeparacao(romaneioConfAtual)}
                  >
                    <RotateCcw size={15} /> Reabrir Separação
                  </button>
                  <button
                    type="button"
                    className="btn btn-success"
                    disabled={loading || !romaneioConfAtual.conferenciasSummary?.todasConferidas}
                    title={
                      romaneioConfAtual.conferenciasSummary?.todasConferidas
                        ? 'Expedir carga definitivamente'
                        : 'Bipe 100% das caixas abaixo para liberar a expedição'
                    }
                    onClick={() => handleExpedirCarga(romaneioConfAtual.id)}
                  >
                    <Truck size={16} /> EXPEDIR CARGA
                  </button>
                </div>
              </div>

              {/* Barra de progresso da conferência */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span>
                    Progresso da Conferência Caixa a Caixa:{' '}
                    <strong>
                      {romaneioConfAtual.conferenciasSummary?.qtdConferidas || 0} de{' '}
                      {romaneioConfAtual.conferenciasSummary?.totalCaixas || 0} caixas
                    </strong>
                  </span>
                  <span className="font-mono">
                    {fmtKg(romaneioConfAtual.conferenciasSummary?.pesoConferido || 0)} conferidos
                  </span>
                </div>
                <div style={{ height: '10px', background: '#1e293b', borderRadius: '999px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${
                        romaneioConfAtual.conferenciasSummary?.totalCaixas
                          ? Math.round(
                              (romaneioConfAtual.conferenciasSummary.qtdConferidas /
                                romaneioConfAtual.conferenciasSummary.totalCaixas) *
                                100
                            )
                          : 0
                      }%`,
                      height: '100%',
                      background: romaneioConfAtual.conferenciasSummary?.todasConferidas ? '#22c55e' : '#38bdf8'
                    }}
                  />
                </div>
              </div>

              {/* Leitor de Conferência */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  processarBipeConferencia(confCodigoInput)
                }}
                style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' }}
              >
                <CheckSquare size={22} className="text-info" />
                <input
                  ref={confInputRef}
                  className="form-input"
                  autoFocus
                  placeholder="Bipe caixa a caixa para conferir o embarque..."
                  value={confCodigoInput}
                  onChange={(e) => setConfCodigoInput(e.target.value)}
                  style={{ fontSize: '15px', fontFamily: 'monospace' }}
                />
                <button type="submit" className="btn btn-primary">Conferir Caixa</button>
              </form>

              {confErroBanner && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.16)',
                    border: '1px solid #ef4444',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    color: '#fca5a5',
                    marginBottom: '12px',
                    fontWeight: 700
                  }}
                >
                  ❌ {confErroBanner}
                </div>
              )}

              {/* Lista das caixas para conferência */}
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: '130px' }}>Conferência</th>
                      <th>Produto</th>
                      <th>EAN Caixa</th>
                      <th>Lote</th>
                      <th>Validade</th>
                      <th style={{ textAlign: 'right' }}>Peso</th>
                      <th>Conferente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(romaneioConfAtual.itens || []).map((cx) => {
                      const ok = Number(cx.conferido) === 1
                      return (
                        <tr
                          key={cx.id}
                          style={{ background: ok ? 'rgba(34, 197, 94, 0.08)' : undefined }}
                        >
                          <td>
                            {ok ? (
                              <span className="badge badge-success">✅ Conferida</span>
                            ) : (
                              <span className="badge badge-warning">⏳ Pendente</span>
                            )}
                          </td>
                          <td style={{ fontWeight: 700 }}>{cx.produto_descricao}</td>
                          <td className="font-mono">{cx.ean_caixa}</td>
                          <td className="font-mono">{cx.lote || '-'}</td>
                          <td>{fmtData(cx.validade)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(cx.peso_kg)}</td>
                          <td className="text-xs text-muted">
                            {ok ? `${cx.conferido_por || '-'} (${fmtDataHora(cx.conferido_at)})` : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ ABA 3: HISTÓRICO ══════════════════════ */}
      {aba === 'HISTORICO' && (
        <div>
          <div className="card" style={{ padding: '14px', marginBottom: '16px' }}>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                carregarHistorico()
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}
            >
              <div>
                <label className="form-label">Expedido de</label>
                <input type="date" className="form-input" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Até</label>
                <input type="date" className="form-input" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Previsão Entrega</label>
                <input type="date" className="form-input" value={previsaoFiltro} onChange={(e) => setPrevisaoFiltro(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <Search size={15} /> Filtrar
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setDataInicio('')
                  setDataFim('')
                  setPrevisaoFiltro('')
                  setTimeout(carregarHistorico, 0)
                }}
              >
                Limpar
              </button>
            </form>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Romaneios Expedidos</div>
              <div style={{ fontSize: '22px', fontWeight: 800 }}>{resumoHist.totalRomaneios}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Caixas Despachadas</div>
              <div style={{ fontSize: '22px', fontWeight: 800 }}>{resumoHist.totalCaixas} cx</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Peso Total Expedido</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#22c55e' }}>{fmtKg(resumoHist.totalPeso)}</div>
            </div>
          </div>

          <div className="card" style={{ padding: '16px' }}>
            {romaneiosHistorico.length === 0 ? (
              <div className="text-muted" style={{ textAlign: 'center', padding: '32px' }}>
                Nenhum romaneio expedido encontrado no período.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Romaneio / Pedido</th>
                      <th>Título / Cliente</th>
                      <th>Expedição</th>
                      <th>Separador / Conferente / Expedidor</th>
                      <th style={{ textAlign: 'center' }}>Caixas</th>
                      <th style={{ textAlign: 'right' }}>Peso Total</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {romaneiosHistorico.map((rom) => {
                      const aberto = histExpandedId === rom.id
                      const det = histDetalhesMap[rom.id]
                      return (
                        <React.Fragment key={rom.id}>
                          <tr>
                            <td className="font-mono font-bold">
                              {rom.codigo}
                              {rom.pedido_codigo && (
                                <div className="text-xs text-info">{rom.pedido_codigo}</div>
                              )}
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>{rom.pedido_titulo || rom.cliente}</div>
                              <div className="text-muted text-xs">{rom.pedido_cliente || rom.cliente}</div>
                            </td>
                            <td className="text-xs">{fmtDataHora(rom.expedido_at)}</td>
                            <td className="text-xs">
                              Sep: {rom.operador_nome || '-'}<br />
                              Conf: {rom.operador_conferencia_nome || '-'} • Exp: {rom.operador_expedicao_nome || '-'}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{rom.total_caixas} cx</td>
                            <td style={{ textAlign: 'right', fontWeight: 800, color: '#4ade80' }}>{fmtKg(rom.total_peso)}</td>
                            <td>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleAbrirRomaneioImpressao(rom.id)}
                                >
                                  <Printer size={14} /> Romaneio
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleToggleHistDetalhes(rom.id)}
                                >
                                  {aberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {aberto && det && (
                            <tr>
                              <td colSpan={7} style={{ background: 'rgba(15, 23, 42, 0.55)', padding: '12px' }}>
                                <table className="table">
                                  <thead>
                                    <tr>
                                      <th>Produto</th>
                                      <th>EAN Caixa</th>
                                      <th>Lote</th>
                                      <th>Validade</th>
                                      <th style={{ textAlign: 'right' }}>Peso</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {det.itens.map((it) => (
                                      <tr key={it.id}>
                                        <td>{it.produto_descricao}</td>
                                        <td className="font-mono">{it.ean_caixa}</td>
                                        <td className="font-mono">{it.lote || '-'}</td>
                                        <td>{fmtData(it.validade)}</td>
                                        <td style={{ textAlign: 'right' }}>{fmtKg(it.peso_kg)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL ALERTA FEFO ══════════════════════ */}
      {fefoAlerta && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.8)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div className="card" style={{ maxWidth: '520px', width: '100%', padding: '20px', borderColor: '#f59e0b' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', marginTop: 0 }}>
              <AlertTriangle size={22} /> Alerta FEFO — Validade mais antiga disponível!
            </h3>
            <p className="text-sm">
              A caixa lida (<strong>{fefoAlerta.caixa.produto_descricao}</strong>, validade{' '}
              <strong>{fmtData(fefoAlerta.caixa.validade)}</strong>) possui lote(s) com vencimento mais próximo no estoque:
            </p>
            <ul style={{ fontSize: '13px', marginBottom: '16px' }}>
              {(fefoAlerta.alertas || []).map((a, idx) => (
                <li key={idx}>
                  Local <strong>{a.endereco}</strong> • Lote {a.lote || '-'} • Validade <strong>{fmtData(a.validade)}</strong> ({a.qtd_caixas} cx)
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setFefoAlerta(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-warning" onClick={confirmarFefo}>
                Separar esta caixa mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL CONFIRMAÇÃO REGRA DO PEDIDO ══════════════════════ */}
      {regraAlerta && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.82)',
            zIndex: 1150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div className="card" style={{ maxWidth: '540px', width: '100%', padding: '22px', borderColor: '#f59e0b' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', marginTop: 0 }}>
              <ShieldAlert size={22} />
              {regraAlerta.tipoConfirmacao === 'PRODUTO_FORA_PEDIDO'
                ? 'Produto Fora do Pedido — Confirmação Necessária'
                : 'Tolerância de +50% Excedida — Confirmação Necessária'}
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.5 }}>{regraAlerta.mensagem}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRegraAlerta(null)}>
                Não incluir
              </button>
              <button type="button" className="btn btn-warning" onClick={confirmarRegraPedido}>
                Confirmar e Incluir Caixa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODAL FINALIZAÇÃO PARCIAL ══════════════════════ */}
      {modalFinalizarParcial && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.82)',
            zIndex: 1150,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div className="card" style={{ maxWidth: '560px', width: '100%', padding: '22px', borderColor: '#f59e0b' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', marginTop: 0 }}>
              <AlertTriangle size={22} /> Pedido Parcialmente Separado
            </h3>
            <p className="text-sm">
              Os itens abaixo estão com peso separado menor que o solicitado no pedido. Deseja finalizar a separação assim mesmo e enviar para Conferência &amp; Expedição?
            </p>
            <ul style={{ fontSize: '13px', marginBottom: '16px' }}>
              {modalFinalizarParcial.map((it) => (
                <li key={it.id} style={{ marginBottom: '4px' }}>
                  <strong>{it.produto_descricao}</strong>: separado {fmtKg(it.kg_separado)} de {fmtKg(it.qtd_kg_solicitada)} (falta {fmtKg(it.kg_faltante)})
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalFinalizarParcial(null)}>
                Continuar Separando
              </button>
              <button type="button" className="btn btn-success" onClick={executarFinalizacaoSeparacao}>
                Finalizar Mesmo Assim
              </button>
            </div>
          </div>
        </div>
      )}

      {printRomaneio && (
        <RomaneioEmbarquePrint romaneio={printRomaneio} onClose={() => setPrintRomaneio(null)} />
      )}
    </div>
  )
}
