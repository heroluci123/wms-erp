import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Factory, Plus, Check, Trash2, Unlock, BarChart2, ScanBarcode,
  AlertTriangle, Package, Printer, Edit3, ShieldAlert, ArrowDownToLine,
  ArrowUpFromLine, RefreshCw, Play, FileText, Search, X, Lock
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as producaoQueries from '../queries/producao.js'
import * as produtosQueries from '../queries/produtos.js'
import { tarasQueries } from '../queries/taras.js'
import PesagemTaraFields, { resolverTaraSelecionada } from '../components/shared/PesagemTaraFields.jsx'
import EtiquetaZebraModal from '../components/shared/EtiquetaZebraPrint.jsx'
import RelatorioDossieProducao from '../components/shared/RelatorioDossieProducao.jsx'
import {
  fmtDataBR,
  fmtDataHoraBR,
  fmtKg2,
  fmtKg3,
  hojeIsoLocal,
  validarPesagemTara,
} from '../utils/rastreabilidade.js'

const STATUS_BADGE = {
  RASCUNHO: { label: 'Rascunho (ADM)', bg: 'rgba(148,163,184,0.16)', color: '#cbd5e1', border: 'rgba(148,163,184,0.35)' },
  LIBERADA: { label: 'Liberada', bg: 'rgba(34,197,94,0.16)', color: '#4ade80', border: 'rgba(34,197,94,0.38)' },
  ABERTA: { label: 'Em Produção', bg: 'rgba(56,189,248,0.16)', color: '#38bdf8', border: 'rgba(56,189,248,0.38)' },
  FECHADA: { label: 'Finalizada', bg: 'rgba(167,139,250,0.16)', color: '#c4b5fd', border: 'rgba(167,139,250,0.38)' },
}

function OpStatusBadge({ status }) {
  const s = STATUS_BADGE[status] || { label: status || '-', bg: 'var(--bg-3)', color: 'var(--text-secondary)', border: 'var(--border)' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function SeletorProdutoInline({ produtos, placeholder, onSelect }) {
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return produtos.slice(0, 12)
    return produtos
      .filter(p =>
        String(p.codigo || '').toLowerCase().includes(q) ||
        String(p.descricao || '').toLowerCase().includes(q)
      )
      .slice(0, 20)
  }, [busca, produtos])

  return (
    <div style={{ position: 'relative' }}>
      <div className="search-box" style={{ padding: '7px 12px' }}>
        <Search size={15} color="var(--text-muted)" />
        <input
          type="text"
          placeholder={placeholder || 'Digite código ou nome do produto...'}
          value={busca}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 180)}
          onChange={e => { setBusca(e.target.value); setAberto(true) }}
        />
        {busca && (
          <button type="button" onClick={() => setBusca('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        )}
      </div>

      {aberto && filtrados.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 50,
          background: 'var(--bg-2)', border: '1px solid var(--border-light)', borderRadius: 8,
          maxHeight: 230, overflowY: 'auto', boxShadow: '0 14px 32px rgba(0,0,0,0.55)',
        }}>
          {filtrados.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(p)
                setBusca('')
                setAberto(false)
              }}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 12px',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
                color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13,
              }}
            >
              <span><strong>{p.codigo || '-'}</strong> — {p.descricao}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.tipo_produto || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Producao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const isAdm = Number(operador?.is_adm) === 1

  const [abaPrincipal, setAbaPrincipal] = useState('ativas') // 'ativas' | 'config' | 'fechadas' | 'relatorios'
  const [opsAtivas, setOpsAtivas] = useState([])
  const [opsFechadas, setOpsFechadas] = useState([])
  const [produtos, setProdutos] = useState([])
  const [taras, setTaras] = useState([])
  const [loading, setLoading] = useState(true)

  // Execução de OP
  const [opSelecionada, setOpSelecionada] = useState(null)
  const [subAbaOp, setSubAbaOp] = useState('entradas') // 'entradas' | 'saidas'

  // Scanner / Entrada
  const [scanEntrada, setScanEntrada] = useState('')
  const [buscandoEntrada, setBuscandoEntrada] = useState(false)
  const [confirmacaoEntrada, setConfirmacaoEntrada] = useState(null) // { caixa, avisoFefo, foraPrevisto }
  const entradaRef = useRef(null)

  // Formulário Saída da Produção
  const [produtoSaidaId, setProdutoSaidaId] = useState('')
  const [mostrarTodosProdutosSaida, setMostrarTodosProdutosSaida] = useState(false)
  const [formSaida, setFormSaida] = useState({
    data_producao: hojeIsoLocal(),
    validade: '',
    tara_id: '',
    peso_bruto: '',
  })
  const [salvandoSaida, setSalvandoSaida] = useState(false)
  const pesoBrutoSaidaRef = useRef(null)

  // Etiquetas Zebra 100x70mm
  const [etiquetasModal, setEtiquetasModal] = useState({ open: false, itens: [], autoPrint: false, titulo: '' })

  // Formulário ADM: Criar / Editar OP
  const [editOpId, setEditOpId] = useState(null)
  const [opForm, setOpForm] = useState({
    nome: '',
    data_producao: hojeIsoLocal(),
    observacoes: '',
    liberarAgora: true,
    itensEntrada: [], // [{ produto_id, codigo, descricao, peso_kg_previsto, qtd_caixas_prevista }]
    itensSaida: [],
  })
  const [salvandoOp, setSalvandoOp] = useState(false)

  // Dossiê direto de 1 OP selecionada
  const [dossieOpIdFiltro, setDossieOpIdFiltro] = useState(null)

  const carregarTudo = async () => {
    setLoading(true)
    try {
      const [ativas, fechadas, prods, listaTaras] = await Promise.all([
        producaoQueries.listarOPs('ATIVAS'),
        producaoQueries.listarOPs('FECHADA'),
        produtosQueries.listar(),
        tarasQueries.listar(true),
      ])
      setOpsAtivas(isAdm ? ativas : ativas.filter(o => ['LIBERADA', 'ABERTA'].includes(o.status)))
      setOpsFechadas(fechadas)
      setProdutos(prods)
      setTaras(listaTaras)

      const padrao = resolverTaraSelecionada(listaTaras, '')
      if (padrao) {
        setFormSaida(prev => prev.tara_id ? prev : { ...prev, tara_id: String(padrao.id) })
      }
    } catch (err) {
      toastError('Erro', `Falha ao carregar Produção: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { carregarTudo() }, [isAdm])

  const abrirDetalhesOP = async (opId, manterSubAba = false) => {
    try {
      const det = await producaoQueries.detalhesOP(opId)
      if (!det) return toastError('Erro', 'OP não encontrada.')
      setOpSelecionada(det)
      if (!manterSubAba) {
        setSubAbaOp('entradas')
      }

      const padrao = resolverTaraSelecionada(taras, formSaida.tara_id)
      setFormSaida(prev => ({
        data_producao: det.data_producao || hojeIsoLocal(),
        validade: prev.validade || '',
        tara_id: padrao ? String(padrao.id) : prev.tara_id,
        peso_bruto: '',
      }))

      if (det.previstos_saida?.length > 0) {
        const existeAtual = det.previstos_saida.some(p => String(p.produto_id) === String(produtoSaidaId))
        if (!existeAtual) {
          setProdutoSaidaId(String(det.previstos_saida[0].produto_id))
        }
        setMostrarTodosProdutosSaida(false)
      } else {
        setMostrarTodosProdutosSaida(true)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── ADM: Criar / Editar OP ─────────────────────────────────────────────────
  const iniciarNovaOpAdm = () => {
    if (!isAdm) return
    setEditOpId(null)
    setOpForm({
      nome: '',
      data_producao: hojeIsoLocal(),
      observacoes: '',
      liberarAgora: true,
      itensEntrada: [],
      itensSaida: [],
    })
    setAbaPrincipal('config')
  }

  const iniciarEdicaoOpAdm = (det) => {
    if (!isAdm) return
    setEditOpId(det.id)
    setOpForm({
      nome: det.nome || '',
      data_producao: det.data_producao || hojeIsoLocal(),
      observacoes: det.observacoes || '',
      liberarAgora: det.status !== 'RASCUNHO',
      itensEntrada: (det.previstos_entrada || []).map(i => ({
        produto_id: i.produto_id,
        codigo: i.produto_codigo,
        descricao: i.produto_descricao,
        peso_kg_previsto: i.peso_kg_previsto ?? '',
        qtd_caixas_prevista: i.qtd_caixas_prevista ?? '',
      })),
      itensSaida: (det.previstos_saida || []).map(i => ({
        produto_id: i.produto_id,
        codigo: i.produto_codigo,
        descricao: i.produto_descricao,
        peso_kg_previsto: i.peso_kg_previsto ?? '',
        qtd_caixas_prevista: i.qtd_caixas_prevista ?? '',
      })),
    })
    setOpSelecionada(null)
    setAbaPrincipal('config')
  }

  const adicionarItemPrevisto = (tipoLista, prod) => {
    setOpForm(prev => {
      const listaAtual = prev[tipoLista]
      if (listaAtual.some(x => x.produto_id === prod.id)) {
        toastWarning('Produto já incluído', `${prod.descricao} já está na lista.`)
        return prev
      }
      return {
        ...prev,
        [tipoLista]: [
          ...listaAtual,
          {
            produto_id: prod.id,
            codigo: prod.codigo || '',
            descricao: prod.descricao,
            peso_kg_previsto: '',
            qtd_caixas_prevista: '',
          },
        ],
      }
    })
  }

  const salvarOpConfigurada = async (e) => {
    e.preventDefault()
    if (!isAdm) return toastError('Acesso restrito', 'Apenas Administradores podem criar ou alterar OPs.')
    if (!opForm.nome.trim()) return toastWarning('Campo obrigatório', 'Informe o título/descrição da Ordem de Produção.')

    const itensPrevistos = [
      ...opForm.itensEntrada.map(i => ({
        tipo: 'ENTRADA',
        produto_id: i.produto_id,
        peso_kg_previsto: i.peso_kg_previsto ? Number(i.peso_kg_previsto) : null,
        qtd_caixas_prevista: i.qtd_caixas_prevista ? Number(i.qtd_caixas_prevista) : null,
      })),
      ...opForm.itensSaida.map(i => ({
        tipo: 'SAIDA',
        produto_id: i.produto_id,
        peso_kg_previsto: i.peso_kg_previsto ? Number(i.peso_kg_previsto) : null,
        qtd_caixas_prevista: i.qtd_caixas_prevista ? Number(i.qtd_caixas_prevista) : null,
      })),
    ]

    setSalvandoOp(true)
    try {
      if (editOpId) {
        const res = await producaoQueries.atualizarOPConfig(editOpId, {
          nome: opForm.nome.trim(),
          data_producao: opForm.data_producao,
          observacoes: opForm.observacoes,
          status: opForm.liberarAgora ? 'LIBERADA' : 'RASCUNHO',
          itensPrevistos,
        })
        if (!res.success) return toastError('Erro', res.error)
        toastSuccess('OP Atualizada', 'Configuração da Ordem de Produção salva com sucesso.')
        await carregarTudo()
        setAbaPrincipal('ativas')
        abrirDetalhesOP(editOpId)
      } else {
        const res = await producaoQueries.criarOP({
          nome: opForm.nome.trim(),
          data_producao: opForm.data_producao,
          observacoes: opForm.observacoes,
          liberarAgora: opForm.liberarAgora,
          itensPrevistos,
          operador_id: operador?.id,
          operador_nome: operador?.nome || 'Administrador',
        })
        if (!res.success) return toastError('Erro', res.error)
        toastSuccess(
          opForm.liberarAgora ? 'OP Criada e Liberada!' : 'OP Salva como Rascunho',
          `${res.op.codigo} — ${res.op.nome}`
        )
        await carregarTudo()
        setAbaPrincipal('ativas')
        if (opForm.liberarAgora) abrirDetalhesOP(res.op.id)
      }
    } catch (err) {
      toastError('Erro fatal', err.message)
    } finally {
      setSalvandoOp(false)
    }
  }

  // ── OPERADOR: Entrada na Produção (Bipar Caixa Matéria-Prima) ─────────────
  const handleBiparEntrada = async (e) => {
    e?.preventDefault()
    if (!opSelecionada) return
    const ean = scanEntrada.trim()
    if (!ean) return

    setBuscandoEntrada(true)
    try {
      const res = await producaoQueries.buscarCaixaPorEanParaOP(ean)
      if (!res.valid) {
        toastError('Caixa indisponível', res.error)
        setScanEntrada('')
        setTimeout(() => entradaRef.current?.focus(), 80)
        return
      }

      const cx = res.caixa
      const prevEntradaIds = (opSelecionada.previstos_entrada || []).map(p => Number(p.produto_id))
      const foraPrevisto = prevEntradaIds.length > 0 && !prevEntradaIds.includes(Number(cx.produto_id))
      const avisoFefo = await producaoQueries.verificarFEFO(cx.produto_id, cx.validade)

      if (avisoFefo || foraPrevisto) {
        setConfirmacaoEntrada({ caixa: cx, avisoFefo, foraPrevisto })
        return
      }

      await confirmarAlocacaoEntrada(cx)
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setBuscandoEntrada(false)
    }
  }

  const confirmarAlocacaoEntrada = async (cx) => {
    setConfirmacaoEntrada(null)
    try {
      const res = await producaoQueries.alocarInsumos(
        opSelecionada.id,
        [cx],
        operador?.id,
        operador?.nome || 'Operador'
      )
      if (!res.success) return toastError('Erro na Entrada', res.error)
      toastSuccess('Entrada Registrada', `${cx.produto_descricao} (${fmtKg2(cx.peso_kg)}) alocada na ${opSelecionada.codigo}.`)
      setScanEntrada('')
      await abrirDetalhesOP(opSelecionada.id, true)
      await carregarTudo()
      setTimeout(() => entradaRef.current?.focus(), 100)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── OPERADOR: Saída da Produção (Tara + Peso Bruto -> Líquido + Lote + Zebra) ─
  const produtosSaidaDisponiveis = useMemo(() => {
    if (!opSelecionada) return produtos
    if (!mostrarTodosProdutosSaida && opSelecionada.previstos_saida?.length > 0) {
      return opSelecionada.previstos_saida.map(ps => ({
        id: ps.produto_id,
        codigo: ps.produto_codigo,
        descricao: ps.produto_descricao,
        peso_kg_previsto: ps.peso_kg_previsto,
      }))
    }
    return produtos
  }, [opSelecionada, produtos, mostrarTodosProdutosSaida])

  const handleRegistrarSaidaProducao = async (e) => {
    e?.preventDefault()
    if (!opSelecionada) return
    if (!produtoSaidaId) return toastWarning('Produto obrigatório', 'Selecione o produto gerado na produção.')

    const taraAtual = resolverTaraSelecionada(taras, formSaida.tara_id)
    const valid = validarPesagemTara({
      dataProducao: formSaida.data_producao,
      validade: formSaida.validade,
      taraId: taraAtual?.id,
      taraKg: taraAtual?.peso_kg ?? 0,
      pesoBruto: formSaida.peso_bruto,
    })
    if (!valid.ok) return toastWarning('Dados da Caixa', valid.erro)

    const prodObj = produtos.find(p => String(p.id) === String(produtoSaidaId))
    setSalvandoSaida(true)
    try {
      const res = await producaoQueries.adicionarRetorno(
        opSelecionada.id,
        {
          produto_id: Number(produtoSaidaId),
          produto_codigo: prodObj?.codigo || '',
          peso_kg: valid.peso_liquido_kg,
          peso_bruto_kg: valid.peso_bruto_kg,
          tara_id: valid.tara_id,
          tara_kg: valid.tara_kg,
          data_producao: valid.data_producao,
          validade: valid.validade,
          lote: valid.lote,
        },
        operador?.id,
        operador?.nome || 'Operador'
      )

      if (!res.success) {
        toastError('Erro ao gerar saída', res.error)
        return
      }

      toastSuccess(
        'Caixa de Saída Gerada!',
        `${res.caixa_gerada.produto_descricao} • Líq ${fmtKg2(res.caixa_gerada.peso_liquido_kg)} • EAN ${res.caixa_gerada.ean_caixa}`
      )

      setFormSaida(prev => ({ ...prev, peso_bruto: '' }))
      await abrirDetalhesOP(opSelecionada.id, true)
      await carregarTudo()

      setEtiquetasModal({
        open: true,
        itens: [res.caixa_gerada],
        autoPrint: true,
        titulo: `Etiqueta OP ${opSelecionada.codigo} — Saída da Produção`,
      })
    } catch (err) {
      toastError('Erro fatal', err.message)
    } finally {
      setSalvandoSaida(false)
    }
  }

  const reimprimirEtiquetaRetorno = async (ret) => {
    try {
      const caixa = await tarasQueries.buscarCaixaParaReimpressao(ret.ean_caixa)
      await tarasQueries.registrarReimpressaoHistorico({
        caixa_id: caixa.id,
        ean_caixa: caixa.ean_caixa,
        origem_tipo: caixa.origem_tipo || 'PRODUCAO',
        operador_nome: operador?.nome || 'Operador',
      })
      setEtiquetasModal({
        open: true,
        itens: [caixa],
        autoPrint: true,
        titulo: `Reimpressão — EAN ${caixa.ean_caixa}`,
      })
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleFinalizarOP = async () => {
    if (!isAdm || !opSelecionada) return
    if (!window.confirm(`Deseja finalizar a ${opSelecionada.codigo}? Os insumos alocados serão marcados como consumidos e o rendimento será consolidado.`)) return
    const res = await producaoQueries.finalizarOP(opSelecionada.id)
    if (!res.success) return toastError('Erro', res.error)
    toastSuccess('OP Finalizada!', `${opSelecionada.codigo} concluída com sucesso.`)
    setOpSelecionada(null)
    await carregarTudo()
    setAbaPrincipal('fechadas')
  }

  const handleReabrirOP = async (op) => {
    if (!isAdm) return
    if (!window.confirm(`Deseja reabrir a ${op.codigo} para edição?`)) return
    const res = await producaoQueries.reabrirOP(op.id)
    if (!res.success) return toastError('Erro', res.error)
    toastSuccess('OP Reaberta', `${op.codigo} liberada novamente.`)
    await carregarTudo()
    setAbaPrincipal('ativas')
    abrirDetalhesOP(op.id)
  }

  const handleCancelarOP = async () => {
    if (!isAdm || !opSelecionada) return
    if (!window.confirm(`Excluir permanentemente a ${opSelecionada.codigo}?`)) return
    const res = await producaoQueries.cancelarOP(opSelecionada.id)
    if (!res.success) return toastError('Não permitido', res.error)
    toastSuccess('OP Excluída', `${opSelecionada.codigo} removida.`)
    setOpSelecionada(null)
    await carregarTudo()
  }

  const handleLiberarOP = async (op) => {
    if (!isAdm) return
    await producaoQueries.liberarOP(op.id)
    toastSuccess('OP Liberada!', `${op.codigo} agora está visível para os operadores executarem.`)
    await carregarTudo()
    if (opSelecionada?.id === op.id) await abrirDetalhesOP(op.id, true)
  }

  const handleRemoverItem = async (tipo, item) => {
    if (!window.confirm(`Remover ${tipo === 'INSUMO' ? 'esta entrada' : 'esta saída'} da ${opSelecionada.codigo}?`)) return
    const res = await producaoQueries.removerItemOP(opSelecionada.id, tipo, item.id, item.caixa_id)
    if (!res.success) return toastError('Erro', res.error)
    toastSuccess('Item removido', 'Registro estornado da OP.')
    await abrirDetalhesOP(opSelecionada.id, true)
    await carregarTudo()
  }

  const abrirDossieCompleto = (opId) => {
    setOpSelecionada(null)
    setDossieOpIdFiltro(opId)
    setAbaPrincipal('relatorios')
  }

  // Cálculos do resumo da OP aberta
  const resumoOp = useMemo(() => {
    if (!opSelecionada) return null
    const inKg = Number(opSelecionada.peso_insumos || 0)
    const outLiq = Number(opSelecionada.peso_retornos || 0)
    const outBruto = Number(opSelecionada.peso_retornos_bruto || 0)
    const diff = Number((outLiq - inKg).toFixed(2))
    const rend = inKg > 0 ? Number(((outLiq / inKg) * 100).toFixed(1)) : 0
    return {
      qtdIn: opSelecionada.insumos?.length || 0,
      qtdOut: opSelecionada.retornos?.length || 0,
      inKg,
      outLiq,
      outBruto,
      diff,
      rend,
    }
  }, [opSelecionada])

  return (
    <div style={{ maxWidth: 1220, margin: '0 auto' }}>
      {/* HEADER PRINCIPAL */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-header__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Factory size={24} color="var(--cyan)" /> Produção & Ordens de Produção (OP)
          </h1>
          <p className="page-header__subtitle">
            {isAdm
              ? 'Gestão ADM (criação, configuração de entradas/saídas e liberação) + Execução operacional com pesagem por Tara e impressão Zebra.'
              : 'Selecione uma OP liberada para registrar as Entradas de Matéria-Prima e gerar as Saídas de Produção com etiqueta automática.'}
          </p>
        </div>

        {isAdm && (
          <button type="button" className="btn btn--primary" onClick={iniciarNovaOpAdm}>
            <Plus size={16} /> Nova Ordem de Produção (ADM)
          </button>
        )}
      </div>

      {/* AVISO PERFIL OPERADOR */}
      {!isAdm && !opSelecionada && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)',
          color: '#bae6fd', fontSize: 12, marginBottom: 16,
        }}>
          <Lock size={15} color="#38bdf8" />
          Modo Operador: A criação, configuração e finalização de OPs são exclusivas de Administradores. Selecione uma OP liberada abaixo para trabalhar.
        </div>
      )}

      {/* TABS PRINCIPAIS */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 20 }}>
        <button
          type="button"
          className={`btn ${abaPrincipal === 'ativas' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => { setAbaPrincipal('ativas'); setOpSelecionada(null) }}
        >
          <Play size={15} /> OPs Liberadas / Em Execução ({opsAtivas.length})
        </button>

        {isAdm && (
          <button
            type="button"
            className={`btn ${abaPrincipal === 'config' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => { if (abaPrincipal !== 'config') iniciarNovaOpAdm() }}
          >
            <Edit3 size={15} /> {editOpId ? 'Editando OP (ADM)' : 'Criar / Configurar OP (ADM)'}
          </button>
        )}

        <button
          type="button"
          className={`btn ${abaPrincipal === 'fechadas' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => { setAbaPrincipal('fechadas'); setOpSelecionada(null) }}
        >
          <Check size={15} /> OPs Finalizadas ({opsFechadas.length})
        </button>

        <button
          type="button"
          className={`btn ${abaPrincipal === 'relatorios' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => { setDossieOpIdFiltro(null); setOpSelecionada(null); setAbaPrincipal('relatorios') }}
        >
          <BarChart2 size={15} /> Relatórios de Produção (Excel / PDF)
        </button>
      </div>

      {/* ─── EXECUÇÃO DE OP SELECIONADA ───────────────────────────────────── */}
      {opSelecionada && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Cabeçalho da OP ativa */}
          <div className="card">
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpSelecionada(null)}>
                    ← Voltar à Lista
                  </button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 900, color: 'var(--cyan)' }}>
                    {opSelecionada.codigo}
                  </span>
                  <OpStatusBadge status={opSelecionada.status} />
                </div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {opSelecionada.nome}
                </h2>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Data de Produção (OP): <strong>{fmtDataBR(opSelecionada.data_producao)}</strong> •
                  Criada por: <strong>{opSelecionada.criado_por_nome || opSelecionada.operador_nome || 'Administrador'}</strong>
                  {opSelecionada.observacoes ? ` • Obs: ${opSelecionada.observacoes}` : ''}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirDossieCompleto(opSelecionada.id)}>
                  <FileText size={14} /> Dossiê / Imprimir
                </button>
                {isAdm && opSelecionada.status !== 'FECHADA' && (
                  <>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => iniciarEdicaoOpAdm(opSelecionada)}>
                      <Edit3 size={14} /> Editar Config. (ADM)
                    </button>
                    {opSelecionada.status === 'RASCUNHO' && (
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => handleLiberarOP(opSelecionada)}>
                        <Play size={14} /> Liberar para Produção
                      </button>
                    )}
                    <button type="button" className="btn btn--success btn--sm" onClick={handleFinalizarOP}>
                      <Check size={14} /> Finalizar OP
                    </button>
                    <button type="button" className="btn btn--danger btn--sm" onClick={handleCancelarOP}>
                      <Trash2 size={14} /> Excluir
                    </button>
                  </>
                )}
                {isAdm && opSelecionada.status === 'FECHADA' && (
                  <button type="button" className="btn btn--warning btn--sm" onClick={() => handleReabrirOP(opSelecionada)}>
                    <Unlock size={14} /> Reabrir OP
                  </button>
                )}
              </div>
            </div>

            {/* Painel Consolidado da OP */}
            {resumoOp && (
              <div style={{
                marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12,
              }}>
                <div style={{ background: 'var(--bg-1)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ENTRADAS ({resumoOp.qtdIn} cx)</div>
                  <strong style={{ fontSize: 17, fontFamily: 'var(--font-mono)', color: '#fbbf24' }}>{fmtKg2(resumoOp.inKg)}</strong>
                </div>
                <div style={{ background: 'var(--bg-1)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>SAÍDAS ({resumoOp.qtdOut} cx)</div>
                  <strong style={{ fontSize: 17, fontFamily: 'var(--font-mono)', color: '#4ade80' }}>{fmtKg2(resumoOp.outLiq)}</strong>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bruto: {fmtKg2(resumoOp.outBruto)}</div>
                </div>
                <div style={{ background: 'var(--bg-1)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>DIFERENÇA / QUEBRA</div>
                  <strong style={{ fontSize: 17, fontFamily: 'var(--font-mono)', color: resumoOp.diff < 0 ? '#f87171' : '#38bdf8' }}>
                    {resumoOp.diff >= 0 ? '+' : ''}{fmtKg2(resumoOp.diff)}
                  </strong>
                </div>
                <div style={{ background: 'var(--bg-1)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>RENDIMENTO</div>
                  <strong style={{ fontSize: 17, fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{resumoOp.rend}%</strong>
                </div>
              </div>
            )}
          </div>

          {/* Seletor das 2 Sub-telas Operacionais */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className={`btn ${subAbaOp === 'entradas' ? 'btn--warning' : 'btn--secondary'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => { setSubAbaOp('entradas'); setTimeout(() => entradaRef.current?.focus(), 80) }}
            >
              <ArrowDownToLine size={17} /> 1. Entradas na Produção ({resumoOp?.qtdIn || 0} cx)
            </button>
            <button
              type="button"
              className={`btn ${subAbaOp === 'saidas' ? 'btn--success' : 'btn--secondary'}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => { setSubAbaOp('saidas'); setTimeout(() => pesoBrutoSaidaRef.current?.focus(), 80) }}
            >
              <ArrowUpFromLine size={17} /> 2. Saída da Produção & Etiquetas ({resumoOp?.qtdOut || 0} cx)
            </button>
          </div>

          {/* ── SUB-ABA 1: ENTRADAS NA PRODUÇÃO ───────────────────────────── */}
          {subAbaOp === 'entradas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {opSelecionada.previstos_entrada?.length > 0 && (
                <div className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Matérias-Primas Previstas pelo ADM
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {opSelecionada.previstos_entrada.map(pe => {
                      const alocado = (opSelecionada.insumos || []).filter(i => i.produto_id === pe.produto_id).reduce((s, x) => s + Number(x.peso_kg || 0), 0)
                      return (
                        <div key={pe.id} style={{
                          padding: '6px 12px', borderRadius: 8, background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: 12,
                        }}>
                          <strong>{pe.produto_codigo} — {pe.produto_descricao}</strong>
                          <span style={{ color: '#fbbf24', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>
                            Alocado: {fmtKg2(alocado)} {pe.peso_kg_previsto ? `/ Prev: ${fmtKg2(pe.peso_kg_previsto)}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {['LIBERADA', 'ABERTA'].includes(opSelecionada.status) && (
                <div className="card">
                  <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>
                    Bipar Caixa de Matéria-Prima para Entrada na {opSelecionada.codigo}
                  </h3>
                  <form onSubmit={handleBiparEntrada} style={{ display: 'flex', gap: 10 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <ScanBarcode size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)' }} />
                      <input
                        ref={entradaRef}
                        type="text"
                        className="form-input form-input--scanner"
                        style={{ paddingLeft: 40 }}
                        placeholder="Bipe ou digite o EAN da caixa de entrada..."
                        value={scanEntrada}
                        onChange={e => setScanEntrada(e.target.value)}
                        disabled={buscandoEntrada}
                        autoFocus
                      />
                    </div>
                    <button type="submit" className="btn btn--warning" disabled={buscandoEntrada}>
                      {buscandoEntrada ? 'Verificando...' : 'Dar Entrada na OP'}
                    </button>
                  </form>
                </div>
              )}

              {/* Lista de Entradas Alocadas */}
              <div className="card">
                <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>
                  Caixas Alocadas na Entrada ({opSelecionada.insumos?.length || 0})
                </h4>
                {(!opSelecionada.insumos || opSelecionada.insumos.length === 0) ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma entrada registrada ainda.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                          <th style={{ padding: '8px 10px' }}>EAN Caixa</th>
                          <th style={{ padding: '8px 10px' }}>Produto</th>
                          <th style={{ padding: '8px 10px' }}>Lote / Prod / Val</th>
                          <th style={{ padding: '8px 10px' }}>Bruto</th>
                          <th style={{ padding: '8px 10px' }}>Tara</th>
                          <th style={{ padding: '8px 10px' }}>Peso Líquido</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opSelecionada.insumos.map(item => (
                          <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#38bdf8' }}>{item.ean_caixa}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <strong>{item.produto_descricao}</strong>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cód. {item.produto_codigo || '-'}</div>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ fontFamily: 'monospace' }}>{item.lote || '-'}</span> • Prod {fmtDataBR(item.data_producao)} • Val {fmtDataBR(item.validade)}
                            </td>
                            <td style={{ padding: '8px 10px' }}>{fmtKg2(item.peso_bruto_kg)}</td>
                            <td style={{ padding: '8px 10px' }}>{fmtKg3(item.tara_kg)}</td>
                            <td style={{ padding: '8px 10px', fontWeight: 700, color: '#fbbf24' }}>{fmtKg2(item.peso_kg)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                              {opSelecionada.status !== 'FECHADA' && (
                                <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleRemoverItem('INSUMO', item)}>
                                  <Trash2 size={14} />
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
            </div>
          )}

          {/* ── SUB-ABA 2: SAÍDA DA PRODUÇÃO ───────────────────────────────── */}
          {subAbaOp === 'saidas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {['LIBERADA', 'ABERTA'].includes(opSelecionada.status) ? (
                <form className="card" onSubmit={handleRegistrarSaidaProducao}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#4ade80' }}>
                        Registrar Nova Caixa de Saída (Endereço: PRODUCAO)
                      </h3>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                        Data de produção pré-preenchida pela abertura da OP (editável). Lote DDMMYY, Peso Líquido e EAN único gerados automaticamente.
                      </p>
                    </div>
                    {opSelecionada.previstos_saida?.length > 0 && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setMostrarTodosProdutosSaida(v => !v)}
                      >
                        {mostrarTodosProdutosSaida ? 'Ver apenas produtos da OP' : 'Mostrar todos os produtos'}
                      </button>
                    )}
                  </div>

                  {/* Seleção do produto de saída */}
                  <div style={{ marginBottom: 14 }}>
                    <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>
                      Produto Produzido * {opSelecionada.previstos_saida?.length > 0 && !mostrarTodosProdutosSaida ? '(Configurados nesta OP pelo ADM)' : ''}
                    </label>
                    <select
                      className="form-input"
                      value={produtoSaidaId}
                      onChange={e => setProdutoSaidaId(e.target.value)}
                      required
                    >
                      <option value="">-- Selecione o produto produzido --</option>
                      {produtosSaidaDisponiveis.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.codigo ? `[${p.codigo}] ` : ''}{p.descricao}
                          {p.peso_kg_previsto ? ` (Prev: ${fmtKg2(p.peso_kg_previsto)})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Data Produção (pre-fill da OP), Lote Auto, Validade, Tara, Peso Bruto -> Peso Líquido */}
                  <PesagemTaraFields
                    taras={taras}
                    value={formSaida}
                    onChange={(next) => setFormSaida(next)}
                    pesoBrutoRef={pesoBrutoSaidaRef}
                    onEnterPesoBruto={handleRegistrarSaidaProducao}
                  />

                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn btn--success btn--lg" disabled={salvandoSaida}>
                      <Printer size={18} />
                      {salvandoSaida ? 'Gerando Caixa e Etiqueta...' : 'Gerar Caixa de Saída e Imprimir Etiqueta (100×70mm)'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 18 }}>
                  OP finalizada — não aceita novas saídas.
                </div>
              )}

              {/* Lista das Caixas de Saída Geradas */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                    Caixas Geradas na Produção ({opSelecionada.retornos?.length || 0})
                  </h4>
                  {opSelecionada.retornos?.length > 0 && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => setEtiquetasModal({
                        open: true,
                        itens: opSelecionada.retornos,
                        autoPrint: false,
                        titulo: `Todas as Etiquetas — ${opSelecionada.codigo}`,
                      })}
                    >
                      <Printer size={14} /> Imprimir Todas ({opSelecionada.retornos.length})
                    </button>
                  )}
                </div>

                {(!opSelecionada.retornos || opSelecionada.retornos.length === 0) ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma caixa de saída registrada ainda.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                          <th style={{ padding: '8px 10px' }}>EAN Gerado</th>
                          <th style={{ padding: '8px 10px' }}>Produto</th>
                          <th style={{ padding: '8px 10px' }}>Lote</th>
                          <th style={{ padding: '8px 10px' }}>Prod. / Validade</th>
                          <th style={{ padding: '8px 10px' }}>Bruto / Tara</th>
                          <th style={{ padding: '8px 10px' }}>Peso Líquido</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right' }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opSelecionada.retornos.map(ret => (
                          <tr key={ret.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#38bdf8' }}>{ret.ean_caixa}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <strong>{ret.produto_descricao}</strong>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cód. {ret.produto_codigo || '-'}</div>
                            </td>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700 }}>{ret.lote || '-'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              Prod: {fmtDataBR(ret.data_producao)}<br />
                              Val: <strong>{fmtDataBR(ret.validade)}</strong>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              Bruto: {fmtKg2(ret.peso_bruto_kg)}<br />
                              <span style={{ color: 'var(--text-muted)' }}>Tara: {fmtKg3(ret.tara_kg)}</span>
                            </td>
                            <td style={{ padding: '8px 10px', fontWeight: 800, color: '#4ade80' }}>{fmtKg2(ret.peso_kg)}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  onClick={() => reimprimirEtiquetaRetorno(ret)}
                                  title="Imprimir etiqueta Zebra 100x70mm preservando o EAN"
                                >
                                  <Printer size={13} /> Etiqueta
                                </button>
                                {opSelecionada.status !== 'FECHADA' && (
                                  <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleRemoverItem('RETORNO', ret)}>
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
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
        </div>
      )}

      {/* ─── LISTA DE OPS ATIVAS / LIBERADAS ─────────────────────────────── */}
      {!opSelecionada && abaPrincipal === 'ativas' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
          {loading ? (
            <div className="card">Carregando ordens de produção...</div>
          ) : opsAtivas.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
              Nenhuma OP ativa/liberada no momento.
              {isAdm && ' Clique em "Nova Ordem de Produção (ADM)" para abrir e liberar uma nova OP.'}
            </div>
          ) : (
            opsAtivas.map(op => (
              <div key={op.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '3px solid var(--cyan)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 16, color: 'var(--cyan)' }}>{op.codigo}</span>
                  <OpStatusBadge status={op.status} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{op.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Data Prod: <strong>{fmtDataBR(op.data_producao)}</strong> • Criada por {op.criado_por_nome || op.operador_nome || '-'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: 'var(--bg-1)', padding: 10, borderRadius: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10 }}>ENTRADAS ({op.qtd_insumos || 0} cx)</span>
                    <strong style={{ color: '#fbbf24' }}>{fmtKg2(op.peso_insumos)}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 10 }}>SAÍDAS ({op.qtd_retornos || 0} cx)</span>
                    <strong style={{ color: '#4ade80' }}>{fmtKg2(op.peso_retornos)}</strong>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  {op.status === 'RASCUNHO' && isAdm ? (
                    <button type="button" className="btn btn--primary btn--sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleLiberarOP(op)}>
                      <Play size={14} /> Liberar OP
                    </button>
                  ) : (
                    <button type="button" className="btn btn--primary btn--sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => abrirDetalhesOP(op.id)}>
                      Abrir OP para Operação →
                    </button>
                  )}
                  {isAdm && (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={async () => { const d = await producaoQueries.detalhesOP(op.id); if (d) iniciarEdicaoOpAdm(d) }} title="Editar configuração ADM">
                      <Edit3 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── ADM: CRIAR / CONFIGURAR OP ───────────────────────────────────── */}
      {!opSelecionada && abaPrincipal === 'config' && isAdm && (
        <form className="card" onSubmit={salvarOpConfigurada} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--cyan)' }}>
                {editOpId ? 'Editar Configuração da Ordem de Produção (ADM)' : 'Nova Ordem de Produção — Configuração ADM'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                Defina os itens de entrada, os itens previstos de saída e a data de produção da OP antes de liberar ao operador.
              </p>
            </div>
            {editOpId && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditOpId(null); setAbaPrincipal('ativas') }}>
                Cancelar Edição
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Título / Descrição da OP *</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Desossa Traseiro Especial Lote Dia"
                value={opForm.nome}
                onChange={e => setOpForm(f => ({ ...f, nome: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Data de Produção (OP) *</label>
              <input
                type="date"
                className="form-input"
                value={opForm.data_producao}
                onChange={e => setOpForm(f => ({ ...f, data_producao: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Observações</label>
              <input
                type="text"
                className="form-input"
                placeholder="Instruções para os operadores..."
                value={opForm.observacoes}
                onChange={e => setOpForm(f => ({ ...f, observacoes: e.target.value }))}
              />
            </div>
          </div>

          {/* Grid Lado a Lado: Itens Entrada e Itens Saída */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
            {/* ENTRADAS PREVISTAS */}
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>
                Itens Previstos de ENTRADA (Matéria-Prima)
              </h4>
              <SeletorProdutoInline
                produtos={produtos}
                placeholder="Buscar produto de entrada por código ou nome..."
                onSelect={(p) => adicionarItemPrevisto('itensEntrada', p)}
              />
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {opForm.itensEntrada.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 4px' }}>
                    Opcional: adicione os produtos que entrarão na produção.
                  </div>
                ) : (
                  opForm.itensEntrada.map((item, idx) => (
                    <div key={item.produto_id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 8, alignItems: 'center',
                      background: 'var(--bg-2)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12,
                    }}>
                      <div>
                        <strong>{item.codigo} — {item.descricao}</strong>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        style={{ padding: '6px 8px', fontSize: 12 }}
                        placeholder="Kg prev."
                        value={item.peso_kg_previsto}
                        onChange={e => setOpForm(f => ({
                          ...f,
                          itensEntrada: f.itensEntrada.map((x, j) => j === idx ? { ...x, peso_kg_previsto: e.target.value } : x),
                        }))}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm text-danger"
                        onClick={() => setOpForm(f => ({ ...f, itensEntrada: f.itensEntrada.filter((_, j) => j !== idx) }))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* SAÍDAS PREVISTAS */}
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#4ade80' }}>
                Itens Previstos de SAÍDA (Produtos Produzidos)
              </h4>
              <SeletorProdutoInline
                produtos={produtos}
                placeholder="Buscar produto de saída por código ou nome..."
                onSelect={(p) => adicionarItemPrevisto('itensSaida', p)}
              />
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {opForm.itensSaida.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 4px' }}>
                    Opcional: defina os cortes/produtos disponíveis na tela de saída do operador.
                  </div>
                ) : (
                  opForm.itensSaida.map((item, idx) => (
                    <div key={item.produto_id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 8, alignItems: 'center',
                      background: 'var(--bg-2)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12,
                    }}>
                      <div>
                        <strong>{item.codigo} — {item.descricao}</strong>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        style={{ padding: '6px 8px', fontSize: 12 }}
                        placeholder="Kg prev."
                        value={item.peso_kg_previsto}
                        onChange={e => setOpForm(f => ({
                          ...f,
                          itensSaida: f.itensSaida.map((x, j) => j === idx ? { ...x, peso_kg_previsto: e.target.value } : x),
                        }))}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm text-danger"
                        onClick={() => setOpForm(f => ({ ...f, itensSaida: f.itensSaida.filter((_, j) => j !== idx) }))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={opForm.liberarAgora}
                onChange={e => setOpForm(f => ({ ...f, liberarAgora: e.target.checked }))}
              />
              Liberar OP imediatamente para execução dos operadores
            </label>
            <button type="submit" className="btn btn--success btn--lg" disabled={salvandoOp}>
              <Check size={17} />
              {salvandoOp ? 'Salvando...' : (editOpId ? 'Salvar Alterações da OP' : (opForm.liberarAgora ? 'Criar e Liberar OP' : 'Salvar como Rascunho'))}
            </button>
          </div>
        </form>
      )}

      {/* ─── OPS FINALIZADAS ──────────────────────────────────────────────── */}
      {!opSelecionada && abaPrincipal === 'fechadas' && (
        <div className="card">
          {opsFechadas.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma OP finalizada registrada ainda.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: '8px 10px' }}>OP</th>
                    <th style={{ padding: '8px 10px' }}>Descrição</th>
                    <th style={{ padding: '8px 10px' }}>Data Prod.</th>
                    <th style={{ padding: '8px 10px' }}>Entrada</th>
                    <th style={{ padding: '8px 10px' }}>Saída (Líq.)</th>
                    <th style={{ padding: '8px 10px' }}>Rendimento</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {opsFechadas.map(op => (
                    <tr key={op.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontWeight: 800, color: 'var(--cyan)' }}>{op.codigo}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <strong>{op.nome}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Criada por {op.criado_por_nome || op.operador_nome || '-'}</div>
                      </td>
                      <td style={{ padding: '9px 10px' }}>{fmtDataBR(op.data_producao)}</td>
                      <td style={{ padding: '9px 10px' }}>{op.qtd_insumos} cx • {fmtKg2(op.peso_insumos)}</td>
                      <td style={{ padding: '9px 10px', color: '#4ade80', fontWeight: 700 }}>{op.qtd_retornos} cx • {fmtKg2(op.peso_retornos)}</td>
                      <td style={{ padding: '9px 10px', fontWeight: 700 }}>{op.rendimento_pct != null ? `${op.rendimento_pct}%` : '-'}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => abrirDetalhesOP(op.id)}>
                            Detalhes
                          </button>
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirDossieCompleto(op.id)}>
                            <FileText size={13} /> Dossiê
                          </button>
                          {isAdm && (
                            <button type="button" className="btn btn--warning btn--sm" onClick={() => handleReabrirOP(op)}>
                              <Unlock size={13} /> Reabrir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── ABA RELATÓRIOS DE PRODUÇÃO ──────────────────────────────────── */}
      {!opSelecionada && abaPrincipal === 'relatorios' && (
        <RelatorioDossieProducao opIdInicial={dossieOpIdFiltro} />
      )}

      {/* MODAL CONFIRMAÇÃO ENTRADA (FEFO ou FORA DO PREVISTO) */}
      {confirmacaoEntrada && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 480, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <ShieldAlert size={26} color="#f59e0b" />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Confirmação Necessária na Entrada</h3>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
              <div>Caixa: <strong>{confirmacaoEntrada.caixa.produto_descricao}</strong> (EAN <span style={{ fontFamily: 'monospace' }}>{confirmacaoEntrada.caixa.ean_caixa}</span>)</div>
              {confirmacaoEntrada.foraPrevisto && (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: 'rgba(245,158,11,0.14)', color: '#fde68a' }}>
                  Este produto não estava na lista de entradas previstas configurada pelo ADM para esta OP.
                </div>
              )}
              {confirmacaoEntrada.avisoFefo && (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: 'rgba(239,68,68,0.14)', color: '#fecaca' }}>
                  <strong>Alerta FEFO:</strong> Existe uma caixa com validade mais próxima ({fmtDataBR(confirmacaoEntrada.avisoFefo.validade)}, Endereço: {confirmacaoEntrada.avisoFefo.endereco || '-'}).
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn--secondary" onClick={() => { setConfirmacaoEntrada(null); setScanEntrada('') }}>
                Cancelar
              </button>
              <button type="button" className="btn btn--warning" onClick={() => confirmarAlocacaoEntrada(confirmacaoEntrada.caixa)}>
                Confirmar Entrada Assim Mesmo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE IMPRESSÃO ZEBRA 100x70MM */}
      <EtiquetaZebraModal
        isOpen={etiquetasModal.open}
        etiquetas={etiquetasModal.itens}
        autoPrint={etiquetasModal.autoPrint}
        titulo={etiquetasModal.titulo}
        onClose={() => {
          setEtiquetasModal({ open: false, itens: [], autoPrint: false, titulo: '' })
          setTimeout(() => pesoBrutoSaidaRef.current?.focus(), 80)
        }}
      />
    </div>
  )
}
