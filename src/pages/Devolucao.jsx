import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RotateCcw,
  Barcode,
  Plus,
  Trash2,
  CheckCircle2,
  ShieldAlert,
  AlertTriangle,
  Package,
  Printer,
  Lock,
  Unlock,
  FileText,
  Search,
  RefreshCw,
  MapPin,
  X,
  Layers,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { temAlgumaPermissao } from '../utils/permissoes'
import { devolucoesQueries, MOTIVOS_DEVOLUCAO } from '../queries/devolucoes'
import * as locaisQueries from '../queries/locais'
import { RomaneioDevolucaoPrint } from '../components/shared/RomaneioDevolucaoPrint'

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`

const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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

const STATUS_FISCAL_BADGE = {
  PENDENTE_FATURAMENTO: { label: 'Pendente NF / Faturamento', cls: 'badge--warning' },
  NF_DEVOLUCAO_EMITIDA: { label: 'NF Devolução Emitida', cls: 'badge--success' },
  DISPENSA_FISCAL: { label: 'Dispensa Fiscal / Ajuste Interno', cls: 'badge--neutral' },
}

export function Devolucao() {
  const { operador, toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const podeRegistrar = temAlgumaPermissao(operador, ['devolucao', 'saida', 'expedicao', 'recebimento'])
  const podeHistoricoFiscal = temAlgumaPermissao(operador, ['devolucao_fiscal', 'pedidos', 'financeiro_pedidos'])
  const podeConsultar = podeRegistrar || podeHistoricoFiscal
  const podeTratarFiscal = podeHistoricoFiscal

  const [aba, setAba] = useState(() => (podeRegistrar ? 'REGISTRAR' : 'HISTORICO')) // 'REGISTRAR' | 'HISTORICO'
  const [loading, setLoading] = useState(false)

  // Aba Bipar / Registrar
  const [eanInput, setEanInput] = useState('')
  const [buscandoCaixa, setBuscandoCaixa] = useState(false)
  const [erroBipagem, setErroBipagem] = useState('')
  const [caixasBipadas, setCaixasBipadas] = useState([])
  const [motivo, setMotivo] = useState('')
  const [acaoEstoque, setAcaoEstoque] = useState('DISPONIVEL')
  const [enderecoModo, setEnderecoModo] = useState('LISTA') // 'LISTA' | 'CUSTOM'
  const [enderecoSelecionado, setEnderecoSelecionado] = useState('REC')
  const [enderecoCustom, setEnderecoCustom] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [locais, setLocais] = useState([])
  const [finalizando, setFinalizando] = useState(false)
  const [ultimaDevolucaoConcluida, setUltimaDevolucaoConcluida] = useState(null)
  const [devolucoesAbertasMesmoPedido, setDevolucoesAbertasMesmoPedido] = useState([])
  const [devolucaoDestinoId, setDevolucaoDestinoId] = useState('')
  const scannerRef = useRef(null)

  // Aba Histórico
  const [historico, setHistorico] = useState([])
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroMotivo, setFiltroMotivo] = useState('TODOS')
  const [filtroStatusFiscal, setFiltroStatusFiscal] = useState('TODOS')
  const [devolucaoExpandidaId, setDevolucaoExpandidaId] = useState(null)

  // Modal Fiscal + Impressão A4
  const [modalFiscalDev, setModalFiscalDev] = useState(null)
  const [fiscalForm, setFiscalForm] = useState({
    status_fiscal: 'NF_DEVOLUCAO_EMITIDA',
    numero_nf_devolucao: '',
    observacoes: '',
  })
  const [devPrint, setDevPrint] = useState(null)

  const carregarLocais = useCallback(async () => {
    try {
      const lista = await locaisQueries.listar()
      const atv = (lista || []).filter((l) => l?.endereco)
      setLocais(atv)
      if (atv.length > 0 && enderecoSelecionado === 'REC') {
        setEnderecoSelecionado(atv[0].endereco)
      }
    } catch {
      setLocais([])
    }
  }, [])

  const carregarHistorico = useCallback(async () => {
    setLoading(true)
    try {
      const lista = await devolucoesQueries.listarDevolucoes({
        busca: filtroBusca,
        motivo: filtroMotivo,
        statusFiscal: filtroStatusFiscal,
      })
      setHistorico(lista || [])
    } catch (err) {
      toastError('Erro ao carregar histórico de devoluções', err.message)
    } finally {
      setLoading(false)
    }
  }, [filtroBusca, filtroMotivo, filtroStatusFiscal, toastError])

  useEffect(() => {
    if (podeRegistrar) {
      carregarLocais()
    }
    if (podeHistoricoFiscal) {
      carregarHistorico()
    }
  }, [podeRegistrar, podeHistoricoFiscal, carregarLocais, carregarHistorico])

  useEffect(() => {
    if (aba === 'REGISTRAR') {
      setTimeout(() => scannerRef.current?.focus(), 60)
    }
  }, [aba])

  const selecionarMotivo = (mKey) => {
    setMotivo(mKey)
    const obj = MOTIVOS_DEVOLUCAO.find((m) => m.key === mKey)
    if (obj) setAcaoEstoque(obj.padraoAcao)
  }

  const handleBiparCaixa = async (e) => {
    e?.preventDefault?.()
    const codigo = String(eanInput || '').trim()
    if (!codigo) return
    setErroBipagem('')

    if (caixasBipadas.some((c) => c.ean_caixa === codigo || String(c.id) === codigo)) {
      setErroBipagem(`A caixa ${codigo} já foi bipada nesta devolução.`)
      setEanInput('')
      scannerRef.current?.focus()
      return
    }

    setBuscandoCaixa(true)
    try {
      const cx = await devolucoesQueries.buscarCaixaParaDevolucao(codigo)
      if (caixasBipadas.some((c) => String(c.id) === String(cx.id))) {
        setErroBipagem(`A caixa ${cx.ean_caixa} já está na lista desta devolução.`)
      } else {
        setCaixasBipadas((prev) => [cx, ...prev])
        toastSuccess(
          `Caixa bipada: ${cx.produto_descricao}`,
          `${fmtKg(cx.peso_kg)}${cx.pedido_codigo ? ` • Pedido ${cx.pedido_codigo}` : ''}`,
        )
      }
      setEanInput('')
    } catch (err) {
      setErroBipagem(err.message || 'Não foi possível localizar esta caixa.')
      toastWarning('Atenção na bipagem', err.message)
    } finally {
      setBuscandoCaixa(false)
      setTimeout(() => scannerRef.current?.focus(), 40)
    }
  }

  const removerCaixaLista = (id) => {
    setCaixasBipadas((prev) => prev.filter((c) => String(c.id) !== String(id)))
  }

  const resumoLote = useMemo(() => {
    const pedidos = Array.from(new Set(caixasBipadas.map((c) => c.pedido_codigo).filter(Boolean)))
    const romaneios = Array.from(new Set(caixasBipadas.map((c) => c.romaneio_codigo).filter(Boolean)))
    const clientes = Array.from(new Set(caixasBipadas.map((c) => c.cliente_nome).filter(Boolean)))
    const pesoTotal = caixasBipadas.reduce((s, c) => s + Number(c.peso_kg || 0), 0)
    const valorTotal = caixasBipadas.reduce((s, c) => s + Number(c.valor_estimado || 0), 0)
    return { pedidos, romaneios, clientes, pesoTotal, valorTotal }
  }, [caixasBipadas])

  useEffect(() => {
    let ativo = true
    if (resumoLote.pedidos.length === 0) {
      setDevolucoesAbertasMesmoPedido([])
      setDevolucaoDestinoId('')
      return
    }
    devolucoesQueries
      .buscarDevolucoesAbertasPorPedidos(resumoLote.pedidos)
      .then((lista) => {
        if (!ativo) return
        const arr = lista || []
        setDevolucoesAbertasMesmoPedido(arr)
        setDevolucaoDestinoId((prev) => {
          if (prev && arr.some((d) => String(d.id) === String(prev))) return prev
          return arr[0]?.id ? String(arr[0].id) : ''
        })
      })
      .catch(() => {
        if (ativo) setDevolucoesAbertasMesmoPedido([])
      })
    return () => {
      ativo = false
    }
  }, [resumoLote.pedidos.join(',')])

  const enderecoFinal =
    enderecoModo === 'CUSTOM'
      ? String(enderecoCustom || '').trim().toUpperCase()
      : String(enderecoSelecionado || 'REC').trim().toUpperCase()

  const handleFinalizarDevolucao = async () => {
    if (caixasBipadas.length === 0) {
      return toastWarning('Nenhuma caixa bipada', 'Bipe pelo menos 1 caixa antes de finalizar.')
    }
    if (!motivo) {
      return toastWarning('Informe o Motivo', 'Selecione o motivo da devolução antes de finalizar.')
    }
    if (!enderecoFinal) {
      return toastWarning('Informe o Endereço', 'Defina o endereço de destino onde as caixas ficarão armazenadas.')
    }

    const acaoTxt =
      acaoEstoque === 'BLOQUEADO'
        ? 'entrar em QUARENTENA / BLOQUEADO (não disponível para venda)'
        : 'voltar imediatamente para DISPONÍVEL no estoque'
    const ok = await confirmar({
      title: 'Confirmar Retorno Físico das Caixas',
      message: `Confirmar devolução de ${caixasBipadas.length} caixa(s) (${fmtKg(resumoLote.pesoTotal)}) no endereço ${enderecoFinal} para ${acaoTxt}? O pedido/NF original permanecerá preservado e o Faturamento receberá o alerta.`,
      confirmLabel: 'Finalizar Devolução',
    })
    if (!ok) return

    setFinalizando(true)
    try {
      const res = await devolucoesQueries.finalizarDevolucao({
        eans: caixasBipadas.map((c) => c.ean_caixa),
        motivo,
        acao_estoque: acaoEstoque,
        endereco_destino: enderecoFinal,
        observacoes,
        devolucao_destino_id: devolucaoDestinoId || null,
      })

      setUltimaDevolucaoConcluida({
        ...res,
        observacoes: res.observacoes ?? observacoes,
        created_at: new Date().toISOString(),
        operador_nome: operador?.nome || '-',
        itens: Array.isArray(res.itens) && res.itens.length > 0 ? res.itens : caixasBipadas,
      })
      setCaixasBipadas([])
      setDevolucaoDestinoId('')
      setMotivo('')
      setAcaoEstoque('DISPONIVEL')
      setObservacoes('')
      setErroBipagem('')
      toastSuccess(
        res.anexado_em_existente
          ? `Caixa(s) anexadas ao romaneio ${res.codigo}!`
          : `Devolução ${res.codigo} registrada!`,
        `Total consolidado: ${res.qtd_caixas} caixa(s) retornada(s) para ${res.endereco_destino}.`,
      )
      if (podeHistoricoFiscal) {
        await carregarHistorico()
      }
    } catch (err) {
      toastError('Erro ao finalizar devolução', err.message)
    } finally {
      setFinalizando(false)
    }
  }

  const handleLiberarQuarentena = async (caixaItem) => {
    const ok = await confirmar({
      title: 'Liberar Caixa da Quarentena',
      message: `Deseja liberar a caixa ${caixaItem.ean_caixa} (${caixaItem.produto_descricao}, ${fmtKg(caixaItem.peso_kg)}) da quarentena para o status DISPONÍVEL em ${caixaItem.caixa_endereco_atual || 'REC'}?`,
      confirmLabel: 'Liberar para Venda',
    })
    if (!ok) return
    try {
      await devolucoesQueries.liberarCaixaQuarentena(caixaItem.caixa_id, {
        endereco_destino: caixaItem.caixa_endereco_atual || 'REC',
      })
      toastSuccess('Caixa liberada!', `${caixaItem.ean_caixa} voltou a ficar DISPONÍVEL no estoque.`)
      await carregarHistorico()
    } catch (err) {
      toastError('Erro ao liberar caixa', err.message)
    }
  }

  const abrirModalFiscal = (dev) => {
    setModalFiscalDev(dev)
    setFiscalForm({
      status_fiscal: dev.status_fiscal === 'DISPENSA_FISCAL' ? 'DISPENSA_FISCAL' : 'NF_DEVOLUCAO_EMITIDA',
      numero_nf_devolucao: dev.numero_nf_devolucao || '',
      observacoes: dev.observacoes || '',
    })
  }

  const handleSalvarFiscal = async (e) => {
    e.preventDefault()
    if (!modalFiscalDev) return
    try {
      await devolucoesQueries.tratarFiscal(modalFiscalDev.id, fiscalForm)
      toastSuccess('Tratativa Fiscal Registrada', `Devolução ${modalFiscalDev.codigo} atualizada com sucesso.`)
      setModalFiscalDev(null)
      await carregarHistorico()
    } catch (err) {
      toastError('Erro na tratativa fiscal', err.message)
    }
  }

  const handleMesclarDevolucao = async (devOrigem, devDestino) => {
    const ok = await confirmar({
      title: 'Unificar Romaneios de Devolução',
      message: `Deseja mover as caixas de ${devOrigem.codigo} (${devOrigem.qtd_caixas} cx • ${fmtKg(devOrigem.peso_total_kg)}) para dentro de ${devDestino.codigo} (${devDestino.pedido_codigo || '-'}), mantendo tudo em um único Romaneio de Devolução?`,
      confirmLabel: `Unificar em ${devDestino.codigo}`,
    })
    if (!ok) return
    try {
      const res = await devolucoesQueries.mesclarDevolucoes(devDestino.id, devOrigem.id)
      toastSuccess(
        'Romaneios Unificados ✅',
        `${devOrigem.codigo} foi incorporada em ${res.codigo} (${res.qtd_caixas} cx • ${fmtKg(res.peso_total_kg)}).`,
      )
      await carregarHistorico()
    } catch (err) {
      toastError('Erro ao unificar devoluções', err.message)
    }
  }

  const kpis = useMemo(() => {
    const pendentesFiscal = historico.filter((d) => d.status_fiscal === 'PENDENTE_FATURAMENTO').length
    const totalCaixas = historico.reduce((s, d) => s + Number(d.qtd_caixas || 0), 0)
    const emQuarentena = historico.reduce(
      (s, d) => s + (d.itens || []).filter((i) => i.caixa_status_atual === 'BLOQUEADO').length,
      0,
    )
    return {
      total: historico.length,
      pendentesFiscal,
      totalCaixas,
      emQuarentena,
    }
  }, [historico])

  if (!podeConsultar) {
    return (
      <div className="page-container">
        <div className="card" style={{ maxWidth: 520, margin: '40px auto', padding: 32, textAlign: 'center' }}>
          <ShieldAlert size={44} className="text-warning" style={{ margin: '0 auto 12px' }} />
          <h2>Acesso Restrito</h2>
          <p className="text-muted">Seu usuário não possui permissão para acessar o módulo de Devoluções.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Cabeçalho */}
      <div
        className="page-header no-print"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
      >
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RotateCcw size={26} /> Devolução de Caixas Expedidas
          </h1>
          <p className="page-subtitle">
            Bipe as caixas que retornaram, identifique automaticamente o pedido de origem e escolha o motivo e destino no estoque (desacoplado da NF-e).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {podeRegistrar && (
            <button
              type="button"
              className={`btn ${aba === 'REGISTRAR' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setAba('REGISTRAR')}
            >
              <Barcode size={16} /> Registrar Devolução
            </button>
          )}
          {podeHistoricoFiscal && (
            <button
              type="button"
              className={`btn ${aba === 'HISTORICO' ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setAba('HISTORICO')}
            >
              <FileText size={16} /> Histórico &amp; Fiscal ({historico.length})
            </button>
          )}
        </div>
      </div>

      {/* ABA REGISTRAR DEVOLUÇÃO */}
      {aba === 'REGISTRAR' && podeRegistrar && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Guia rápido Físico vs Fiscal */}
          <div
            className="card"
            style={{
              padding: '12px 16px',
              background: 'rgba(56, 189, 248, 0.08)',
              borderColor: 'rgba(56, 189, 248, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <AlertTriangle size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>
              <strong>Separação Físico × Fiscal:</strong> Bipar a caixa aqui reintegra o estoque físico imediatamente na câmara (Disponível ou Quarentena)
              <strong> sem alterar ou apagar o pedido/NF original já faturado</strong>, criando um alerta automático para o Faturamento tratar a NF-e de Devolução.
            </div>
          </div>

          {ultimaDevolucaoConcluida && caixasBipadas.length === 0 && (
            <div
              className="card"
              style={{
                padding: '14px 16px',
                background: 'rgba(34, 197, 94, 0.1)',
                borderColor: 'rgba(34, 197, 94, 0.45)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={22} style={{ color: '#4ade80' }} />
                <div>
                  <div style={{ fontWeight: 700, color: '#86efac' }}>
                    Devolução {ultimaDevolucaoConcluida.codigo} finalizada com sucesso!
                  </div>
                  <div className="text-xs text-muted">
                    {ultimaDevolucaoConcluida.qtd_caixas} caixa(s) • {fmtKg(ultimaDevolucaoConcluida.peso_total_kg)} • Destino:{' '}
                    <strong>{ultimaDevolucaoConcluida.endereco_destino}</strong> ({ultimaDevolucaoConcluida.acao_estoque})
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setDevPrint(ultimaDevolucaoConcluida)}
                >
                  <Printer size={14} /> Imprimir Romaneio de Devolução
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setUltimaDevolucaoConcluida(null)}
                >
                  Fechar
                </button>
              </div>
            </div>
          )}

          {/* Campo do Leitor */}
          <div className="card" style={{ padding: 18 }}>
            <form
              onSubmit={handleBiparCaixa}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <div style={{ flex: '1 1 320px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Barcode size={15} /> Bipar Código EAN / Etiqueta da Caixa Devolvida
                </label>
                <input
                  ref={scannerRef}
                  className="form-input"
                  style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.03em' }}
                  placeholder="Leia o código de barras da caixa e pressione Enter..."
                  value={eanInput}
                  onChange={(e) => setEanInput(e.target.value)}
                  disabled={buscandoCaixa || finalizando}
                />
              </div>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={buscandoCaixa || finalizando || !eanInput.trim()}
              >
                <Plus size={16} /> {buscandoCaixa ? 'Consultando...' : 'Bipar Caixa'}
              </button>
            </form>

            {erroBipagem && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#fca5a5',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertTriangle size={16} /> {erroBipagem}
              </div>
            )}
          </div>

          {/* Resumo automático do Pedido / Caixas Bipadas */}
          {caixasBipadas.length > 0 && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="card" style={{ padding: 14 }}>
                  <div className="text-muted text-xs">Pedido(s) Atribuído(s)</div>
                  <div style={{ fontWeight: 800, fontSize: 16, color: '#38bdf8' }}>
                    {resumoLote.pedidos.length > 0 ? resumoLote.pedidos.join(', ') : 'Avulso / Sem Pedido'}
                  </div>
                  <div className="text-muted text-xs">
                    {resumoLote.romaneios.length > 0 ? `Romaneio: ${resumoLote.romaneios.join(', ')}` : '-'}
                  </div>
                </div>
                <div className="card" style={{ padding: 14 }}>
                  <div className="text-muted text-xs">Cliente(s) Identificado(s)</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {resumoLote.clientes.length > 0 ? resumoLote.clientes.join(', ') : '-'}
                  </div>
                </div>
                <div className="card" style={{ padding: 14 }}>
                  <div className="text-muted text-xs">Total Bipado para Devolução</div>
                  <div style={{ fontWeight: 800, fontSize: 20, color: '#4ade80' }}>
                    {caixasBipadas.length} cx • {fmtKg(resumoLote.pesoTotal)}
                  </div>
                  <div className="text-muted text-xs">Valor estimado: {fmtMoeda(resumoLote.valorTotal)}</div>
                </div>
              </div>

              {/* Tabela de caixas bipadas */}
              <div className="card">
                <h3 style={{ marginBottom: 12, fontSize: 15, fontWeight: 700 }}>
                  Caixas Bipada(s) ({caixasBipadas.length})
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>EAN Caixa</th>
                        <th>Produto</th>
                        <th>Pedido / Romaneio</th>
                        <th>Cliente</th>
                        <th>Lote / Validade</th>
                        <th style={{ textAlign: 'right' }}>Peso</th>
                        <th style={{ textAlign: 'right' }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caixasBipadas.map((cx) => (
                        <tr key={cx.id}>
                          <td className="font-mono font-bold">{cx.ean_caixa}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              [{cx.produto_codigo}] {cx.produto_descricao}
                            </div>
                          </td>
                          <td>
                            <div className="font-mono" style={{ fontWeight: 700, color: '#38bdf8' }}>
                              {cx.pedido_codigo || '-'}
                            </div>
                            <div className="text-muted text-xs">{cx.romaneio_codigo || '-'}</div>
                          </td>
                          <td>{cx.cliente_nome || '-'}</td>
                          <td>
                            <div className="font-mono text-xs">{cx.lote || '-'}</div>
                            <div className="text-muted text-xs">Val: {fmtData(cx.validade)}</div>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(cx.peso_kg)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => removerCaixaLista(cx.id)}
                              title="Remover da lista"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Motivo e Finalização */}
              <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                    1. Selecione o Motivo da Devolução *
                  </label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 10,
                    }}
                  >
                    {MOTIVOS_DEVOLUCAO.map((m) => {
                      const selecionado = motivo === m.key
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => selecionarMotivo(m.key)}
                          className="card"
                          style={{
                            padding: '12px 14px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            borderColor: selecionado ? m.cor : undefined,
                            background: selecionado ? 'rgba(59, 130, 246, 0.14)' : undefined,
                            boxShadow: selecionado ? `0 0 0 2px ${m.cor}55` : undefined,
                          }}
                        >
                          <div style={{ fontWeight: 800, color: selecionado ? m.cor : '#f8fafc', fontSize: 14 }}>
                            {m.label}
                          </div>
                          <div className="text-muted text-xs" style={{ marginTop: 4 }}>
                            {m.desc}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                    gap: 14,
                  }}
                >
                  <div>
                    <label className="form-label">2. Destino Físico no Estoque *</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className={`btn btn--sm ${acaoEstoque === 'DISPONIVEL' ? 'btn--success' : 'btn--secondary'}`}
                        style={{ flex: 1 }}
                        onClick={() => setAcaoEstoque('DISPONIVEL')}
                      >
                        <Unlock size={14} /> Voltar Disponível
                      </button>
                      <button
                        type="button"
                        className={`btn btn--sm ${acaoEstoque === 'BLOQUEADO' ? 'btn--danger' : 'btn--secondary'}`}
                        style={{ flex: 1 }}
                        onClick={() => setAcaoEstoque('BLOQUEADO')}
                      >
                        <Lock size={14} /> Quarentena (Bloqueado)
                      </button>
                    </div>
                    <div className="text-muted text-xs" style={{ marginTop: 6 }}>
                      {acaoEstoque === 'BLOQUEADO'
                        ? 'Caixa fica rastreada no endereço, mas bloqueada para venda até liberação da Qualidade.'
                        : 'Caixa volta imediatamente para o saldo vendável/separável da câmara.'}
                    </div>
                  </div>

                  <div>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={14} /> 3. Endereço de Armazenagem no Retorno *
                    </label>
                    {enderecoModo === 'LISTA' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          className="form-input"
                          value={enderecoSelecionado}
                          onChange={(e) => setEnderecoSelecionado(e.target.value)}
                        >
                          <option value="REC">REC (Doca Recebimento / Devolução)</option>
                          <option value="DOCA-DEV">DOCA-DEV (Área de Devoluções)</option>
                          {locais.map((l) => (
                            <option key={l.id || l.endereco} value={l.endereco}>
                              {l.endereco} {l.tipo_armazenamento ? `(${l.tipo_armazenamento})` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setEnderecoModo('CUSTOM')}
                          title="Digitar endereço manualmente"
                        >
                          Digitar
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          className="form-input"
                          placeholder="Ex: C1-R1-A ou DOCA-DEV"
                          value={enderecoCustom}
                          onChange={(e) => setEnderecoCustom(e.target.value.toUpperCase())}
                        />
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setEnderecoModo('LISTA')}
                        >
                          Lista
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="form-label">4. Observações da Devolução (opcional)</label>
                    <input
                      className="form-input"
                      placeholder="Ex: Motorista João devolveu 2 caixas trocadas..."
                      value={observacoes}
                      onChange={(e) => setObservacoes(e.target.value)}
                    />
                  </div>
                </div>

                {devolucoesAbertasMesmoPedido.length > 0 && (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div className="text-xs font-bold uppercase text-cyan flex items-center gap-6">
                      <Layers size={14} /> Mesmo Pedido com Romaneio de Devolução em Aberto!
                    </div>
                    <div className="text-xs" style={{ color: '#cbd5e1' }}>
                      Para manter todas as caixas do mesmo pedido no mesmo romaneio, selecione abaixo se deseja anexar em uma devolução já aberta ou criar uma nova:
                    </div>
                    <select
                      className="form-input"
                      value={devolucaoDestinoId}
                      onChange={(e) => setDevolucaoDestinoId(e.target.value)}
                    >
                      {devolucoesAbertasMesmoPedido.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          Anexar ao mesmo Romaneio: {d.codigo} ({d.pedido_codigo || '-'} • {d.qtd_caixas} cx • {fmtKg(d.peso_total_kg)})
                        </option>
                      ))}
                      <option value="">Criar um novo Romaneio de Devolução separado</option>
                    </select>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      setCaixasBipadas([])
                      setErroBipagem('')
                    }}
                    disabled={finalizando}
                  >
                    Limpar Lista
                  </button>
                  <button
                    type="button"
                    className="btn btn--success"
                    disabled={finalizando || !motivo}
                    onClick={handleFinalizarDevolucao}
                  >
                    <CheckCircle2 size={16} />{' '}
                    {finalizando
                      ? 'Finalizando...'
                      : devolucaoDestinoId
                        ? `Anexar ao Romaneio (${caixasBipadas.length} cx • ${fmtKg(resumoLote.pesoTotal)})`
                        : `Finalizar Devolução (${caixasBipadas.length} cx • ${fmtKg(resumoLote.pesoTotal)})`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ABA HISTÓRICO & FISCAL */}
      {aba === 'HISTORICO' && podeHistoricoFiscal && (
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-muted text-xs">Devoluções Registradas</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8' }}>{kpis.total}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-muted text-xs">Pendentes de Tratativa Fiscal (NF)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b' }}>{kpis.pendentesFiscal}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-muted text-xs">Caixas Devolvidas</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#4ade80' }}>{kpis.totalCaixas}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-muted text-xs">Em Quarentena (Bloqueadas)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#ef4444' }}>{kpis.emQuarentena}</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 220px' }}>
                <label className="form-label">Buscar Protocolo, Pedido ou Cliente</label>
                <input
                  className="form-input"
                  placeholder="DEV-0001, PED-0004, Cliente..."
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                />
              </div>
              <div style={{ flex: '0 1 200px' }}>
                <label className="form-label">Motivo</label>
                <select className="form-input" value={filtroMotivo} onChange={(e) => setFiltroMotivo(e.target.value)}>
                  <option value="TODOS">Todos os Motivos</option>
                  {MOTIVOS_DEVOLUCAO.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '0 1 220px' }}>
                <label className="form-label">Status Fiscal</label>
                <select
                  className="form-input"
                  value={filtroStatusFiscal}
                  onChange={(e) => setFiltroStatusFiscal(e.target.value)}
                >
                  <option value="TODOS">Todos</option>
                  <option value="PENDENTE_FATURAMENTO">Pendente NF / Faturamento</option>
                  <option value="NF_DEVOLUCAO_EMITIDA">NF Devolução Emitida</option>
                  <option value="DISPENSA_FISCAL">Dispensa Fiscal</option>
                </select>
              </div>
              <button type="button" className="btn btn--secondary" onClick={carregarHistorico} disabled={loading}>
                <RefreshCw size={15} /> Atualizar
              </button>
            </div>
          </div>

          {/* Lista */}
          <div className="card">
            {historico.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 36 }} className="text-muted">
                <Package size={38} style={{ opacity: 0.4, margin: '0 auto 10px' }} />
                <div>Nenhuma devolução registrada até o momento.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {historico.map((dev) => {
                  const stFis = STATUS_FISCAL_BADGE[dev.status_fiscal] || {
                    label: dev.status_fiscal,
                    cls: 'badge--neutral',
                  }
                  const expandido = devolucaoExpandidaId === dev.id
                  const alvosMescla =
                    dev.status_fiscal === 'PENDENTE_FATURAMENTO'
                      ? historico.filter(
                          (out) =>
                            out.id !== dev.id &&
                            out.status_fiscal === 'PENDENTE_FATURAMENTO' &&
                            dev.pedido_codigo &&
                            out.pedido_codigo &&
                            String(dev.pedido_codigo)
                              .split(',')
                              .some((p) => String(out.pedido_codigo).split(',').map((s) => s.trim()).includes(p.trim())),
                        )
                      : []
                  const alvoMescla = alvosMescla.find((o) => String(o.codigo) < String(dev.codigo)) || alvosMescla[0] || null
                  return (
                    <div
                      key={dev.id}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 10,
                        padding: 14,
                        background: 'rgba(15, 23, 42, 0.45)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span className="font-mono font-bold" style={{ fontSize: 15 }}>
                              {dev.codigo}
                            </span>
                            <span className="badge badge--info">{dev.motivo_label || dev.motivo}</span>
                            <span className={`badge ${dev.acao_estoque === 'BLOQUEADO' ? 'badge--danger' : 'badge--success'}`}>
                              {dev.acao_estoque === 'BLOQUEADO' ? 'Quarentena' : 'Disponível'} → {dev.endereco_destino}
                            </span>
                            <span className={`badge ${stFis.cls}`}>{stFis.label}</span>
                            {dev.numero_nf_devolucao && (
                              <span className="badge badge--neutral">NF Dev.: {dev.numero_nf_devolucao}</span>
                            )}
                          </div>
                          <div className="text-muted text-xs" style={{ marginTop: 4 }}>
                            Pedido(s): <strong>{dev.pedido_codigo || '-'}</strong> • Cliente:{' '}
                            <strong>{dev.cliente_nome || '-'}</strong> • {dev.qtd_caixas} cx ({fmtKg(dev.peso_total_kg)}) •{' '}
                            {fmtMoeda(dev.valor_estimado)} • Por {dev.operador_nome || '-'} em {fmtDataHora(dev.created_at)}
                          </div>
                          {dev.observacoes && (
                            <div className="text-xs" style={{ color: '#cbd5e1', marginTop: 4 }}>
                              Obs.: {dev.observacoes}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setDevolucaoExpandidaId(expandido ? null : dev.id)}
                          >
                            <Search size={13} /> {expandido ? 'Ocultar Caixas' : `Ver Caixas (${dev.itens?.length || 0})`}
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setDevPrint(dev)}
                          >
                            <Printer size={13} /> Romaneio de Devolução
                          </button>
                          {podeTratarFiscal && alvoMescla && (
                            <button
                              type="button"
                              className="btn btn--info btn--sm"
                              onClick={() => handleMesclarDevolucao(dev, alvoMescla)}
                              title={`Unificar ${dev.codigo} em ${alvoMescla.codigo} (mesmo pedido)`}
                            >
                              <Layers size={13} /> Unificar em {alvoMescla.codigo}
                            </button>
                          )}
                          {podeTratarFiscal && (
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() => abrirModalFiscal(dev)}
                            >
                              <FileText size={13} /> Tratar Fiscal / NF
                            </button>
                          )}
                        </div>
                      </div>

                      {expandido && (
                        <div style={{ marginTop: 12, overflowX: 'auto' }}>
                          <table className="table">
                            <thead>
                              <tr>
                                <th>EAN</th>
                                <th>Produto</th>
                                <th>Pedido Origem</th>
                                <th>Lote / Validade</th>
                                <th style={{ textAlign: 'right' }}>Peso</th>
                                <th>Status Atual Caixa</th>
                                <th style={{ textAlign: 'right' }}>Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(dev.itens || []).map((it) => (
                                <tr key={it.id}>
                                  <td className="font-mono font-bold">{it.ean_caixa}</td>
                                  <td>
                                    [{it.produto_codigo}] {it.produto_descricao}
                                  </td>
                                  <td className="font-mono">{it.pedido_codigo || '-'}</td>
                                  <td className="text-xs">
                                    {it.lote || '-'} • Val {fmtData(it.validade)}
                                  </td>
                                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(it.peso_kg)}</td>
                                  <td>
                                    <span
                                      className={`badge ${
                                        it.caixa_status_atual === 'BLOQUEADO'
                                          ? 'badge--danger'
                                          : it.caixa_status_atual === 'DISPONIVEL'
                                            ? 'badge--success'
                                            : 'badge--neutral'
                                      }`}
                                    >
                                      {it.caixa_status_atual || '-'} ({it.caixa_endereco_atual || '-'})
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {it.caixa_status_atual === 'BLOQUEADO' && podeRegistrar && (
                                      <button
                                        type="button"
                                        className="btn btn--success btn--sm"
                                        onClick={() => handleLiberarQuarentena(it)}
                                      >
                                        <Unlock size={13} /> Liberar Quarentena
                                      </button>
                                    )}
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
        </div>
      )}

      {/* MODAL TRATATIVA FISCAL */}
      {modalFiscalDev && (
        <div
          className="modal-overlay no-print"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 95,
            backgroundColor: 'rgba(5, 9, 18, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Tratativa Fiscal — {modalFiscalDev.codigo}</h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalFiscalDev(null)}>
                <X size={16} />
              </button>
            </div>
            <p className="text-muted text-xs" style={{ marginBottom: 14 }}>
              Pedido origem: <strong>{modalFiscalDev.pedido_codigo || '-'}</strong> • Valor estimado:{' '}
              <strong>{fmtMoeda(modalFiscalDev.valor_estimado)}</strong>
            </p>
            <form onSubmit={handleSalvarFiscal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label">Status Fiscal</label>
                <select
                  className="form-input"
                  value={fiscalForm.status_fiscal}
                  onChange={(e) => setFiscalForm((f) => ({ ...f, status_fiscal: e.target.value }))}
                >
                  <option value="NF_DEVOLUCAO_EMITIDA">NF-e de Devolução / Estorno Emitida</option>
                  <option value="DISPENSA_FISCAL">Dispensa Fiscal / Ajuste Comercial Interno</option>
                </select>
              </div>
              {fiscalForm.status_fiscal === 'NF_DEVOLUCAO_EMITIDA' && (
                <div>
                  <label className="form-label">Número da NF-e de Devolução *</label>
                  <input
                    className="form-input"
                    placeholder="Ex: 0004589"
                    value={fiscalForm.numero_nf_devolucao}
                    onChange={(e) => setFiscalForm((f) => ({ ...f, numero_nf_devolucao: e.target.value }))}
                    required
                  />
                </div>
              )}
              <div>
                <label className="form-label">Observações Fiscais / Financeiras</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={fiscalForm.observacoes}
                  onChange={(e) => setFiscalForm((f) => ({ ...f, observacoes: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button type="button" className="btn btn--secondary" onClick={() => setModalFiscalDev(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <CheckCircle2 size={15} /> Confirmar Baixa Fiscal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ROMANEIO DE DEVOLUÇÃO A4 (IGUAL AO DE EMBARQUE, SEM ASSINATURA EXTERNA) */}
      {devPrint && (
        <RomaneioDevolucaoPrint
          devolucao={devPrint}
          onClose={() => setDevPrint(null)}
          autoPrint={true}
        />
      )}
    </div>
  )
}
