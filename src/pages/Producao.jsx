import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Factory, Plus, Check, Trash2, Unlock, BarChart2, ScanBarcode,
  AlertTriangle, Package, Printer, Edit3, ShieldAlert, ArrowDownToLine,
  ArrowUpFromLine, RefreshCw, Play, FileText, Search, X, Lock, CheckCircle2, XCircle,
  DollarSign, TrendingUp, Award
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient.js'
import { temPermissao } from '../utils/permissoes'
import * as producaoQueries from '../queries/producao.js'
import * as produtosQueries from '../queries/produtos.js'
import { tarasQueries } from '../queries/taras.js'
import PesagemTaraFields, { resolverTaraSelecionada } from '../components/shared/PesagemTaraFields.jsx'
import EtiquetaZebraModal from '../components/shared/EtiquetaZebraPrint.jsx'
import RelatorioDossieProducao from '../components/shared/RelatorioDossieProducao.jsx'
import { FolhaOrdemProducaoPrint } from '../components/shared/FolhaOrdemProducaoPrint.jsx'
import { feedbackSom } from '../utils/feedbackSom.js'
import {
  fmtDataBR,
  fmtDataHoraBR,
  fmtKg2,
  fmtKg3,
  hojeIsoLocal,
  validarPesagemTara,
} from '../utils/rastreabilidade.js'

const STATUS_BADGE = {
  RASCUNHO: { label: 'Rascunho', bg: 'rgba(148,163,184,0.16)', color: '#cbd5e1', border: 'rgba(148,163,184,0.35)' },
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

const normBuscaProd = (str) =>
  String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const temSaldoPositivoProd = (p) =>
  Number(p?.saldo_kg || 0) > 0 || Number(p?.qtd_caixas || 0) > 0

function SeletorProdutoInline({
  produtos,
  placeholder,
  onSelect,
  mostrarSaldo = false,
  priorizarComSaldo = false,
}) {
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(false)
  const [idxFocado, setIdxFocado] = useState(0)

  const filtrados = useMemo(() => {
    const q = normBuscaProd(busca.trim())
    const base = !q
      ? [...produtos]
      : produtos.filter(p =>
          normBuscaProd(p.codigo).includes(q) ||
          normBuscaProd(p.ean).includes(q) ||
          normBuscaProd(p.descricao).includes(q)
        )

    base.sort((a, b) => {
      if (priorizarComSaldo) {
        const aSaldo = temSaldoPositivoProd(a) ? 0 : 1
        const bSaldo = temSaldoPositivoProd(b) ? 0 : 1
        if (aSaldo !== bSaldo) return aSaldo - bSaldo
      }
      if (q) {
        const aCodExato = normBuscaProd(a.codigo) === q ? 0 : 1
        const bCodExato = normBuscaProd(b.codigo) === q ? 0 : 1
        if (aCodExato !== bCodExato) return aCodExato - bCodExato
      }
      return String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR')
    })

    return base.slice(0, q ? 24 : 14)
  }, [busca, produtos, priorizarComSaldo])

  const selecionarItem = (p) => {
    if (!p) return
    onSelect(p)
    setBusca('')
    setAberto(false)
    setIdxFocado(0)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="search-box" style={{ padding: '7px 12px' }}>
        <Search size={15} color="var(--text-muted)" />
        <input
          type="text"
          placeholder={placeholder || 'Digite código ou nome do produto...'}
          value={busca}
          onFocus={() => { setAberto(true); setIdxFocado(0) }}
          onBlur={() => setTimeout(() => setAberto(false), 180)}
          onChange={e => { setBusca(e.target.value); setAberto(true); setIdxFocado(0) }}
          onKeyDown={e => {
            if (!aberto || filtrados.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdxFocado(i => Math.min(i + 1, filtrados.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdxFocado(i => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              selecionarItem(filtrados[idxFocado] || filtrados[0])
            } else if (e.key === 'Escape') {
              setAberto(false)
            }
          }}
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
          background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
          maxHeight: 260, overflowY: 'auto', boxShadow: '0 16px 36px rgba(0,0,0,0.65)',
        }}>
          {filtrados.map((p, idx) => {
            const comSaldo = temSaldoPositivoProd(p)
            const ativo = idx === idxFocado
            return (
              <button
                key={p.id}
                type="button"
                onMouseEnter={() => setIdxFocado(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selecionarItem(p)
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 12px',
                  background: ativo ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{
                    background: 'rgba(59, 130, 246, 0.16)',
                    color: '#60a5fa',
                    padding: '2px 7px',
                    borderRadius: 5,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {p.codigo || '-'}
                  </span>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.descricao}
                  </span>
                </span>
                {mostrarSaldo ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 12, flexShrink: 0 }}>
                    <strong style={{ color: comSaldo ? '#4ade80' : '#94a3b8' }}>
                      {fmtKg2(p.saldo_kg || 0)}
                    </strong>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>
                      ({Number(p.qtd_caixas || 0)} cx)
                    </span>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{p.tipo_produto || ''}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const mapPrevistoParaForm = (i, produtos = []) => {
  const prod = produtos.find(p => p.id === i.produto_id)
  const peso = i.peso_kg_previsto != null && Number(i.peso_kg_previsto) > 0 ? Number(i.peso_kg_previsto) : ''
  const cxs = i.qtd_caixas_prevista != null && Number(i.qtd_caixas_prevista) > 0 ? Number(i.qtd_caixas_prevista) : ''
  const unidade = i.unidade_prevista === 'CX' || (!peso && cxs) ? 'CX' : 'KG'
  return {
    produto_id: i.produto_id,
    codigo: i.produto_codigo ?? prod?.codigo ?? '',
    descricao: i.produto_descricao ?? prod?.descricao ?? '',
    unidade,
    quantidade_input: unidade === 'CX' ? (cxs !== '' ? String(cxs) : '') : (peso !== '' ? String(peso) : ''),
    peso_kg_previsto: peso !== '' ? String(peso) : '',
    qtd_caixas_prevista: unidade === 'CX' && cxs !== '' ? String(cxs) : '',
    saldo_kg: Number(prod?.saldo_kg || 0),
    saldo_caixas: Number(prod?.qtd_caixas || 0),
    peso_medio_cx: Number(prod?.peso_medio_cx || 0),
  }
}

function OpItemPrevistoRow({
  item,
  tipo,
  mostrarSaldo = false,
  onToggleUnidade,
  onChangeQtd,
  onRemover,
}) {
  const isEntrada = tipo === 'ENTRADA'
  const accentColor = isEntrada ? '#f59e0b' : '#22c55e'
  const comSaldo = Number(item.saldo_kg || 0) > 0 || Number(item.saldo_caixas || 0) > 0
  const pesoPrevNum = Number(item.peso_kg_previsto || 0)
  const cxPrevNum = Number(item.qtd_caixas_prevista || 0)
  const mediaCx = Number(item.peso_medio_cx || 0)
  const cxEstimadasKg = item.unidade === 'KG' && pesoPrevNum > 0 && mediaCx > 0
    ? Math.max(1, Math.round(pesoPrevNum / mediaCx))
    : cxPrevNum
  const acimaDoSaldo = mostrarSaldo && (
    (item.unidade === 'KG' && pesoPrevNum > Number(item.saldo_kg || 0) && Number(item.saldo_kg || 0) >= 0 && pesoPrevNum > 0) ||
    (item.unidade === 'CX' && cxPrevNum > Number(item.saldo_caixas || 0) && cxPrevNum > 0)
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--bg-2)',
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{
              background: 'rgba(59, 130, 246, 0.16)',
              color: '#60a5fa',
              padding: '2px 7px',
              borderRadius: 5,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
            }}>
              {item.codigo || '-'}
            </span>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.descricao}</strong>
          </div>

          {mostrarSaldo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 11 }}>
              <span style={{ color: comSaldo ? '#4ade80' : '#94a3b8', fontWeight: 600 }}>
                Saldo: {fmtKg2(item.saldo_kg || 0)} ({Number(item.saldo_caixas || 0)} cx)
              </span>
              {Number(item.peso_medio_cx || 0) > 0 && (
                <span style={{ color: 'var(--text-muted)' }}>
                  • Média {fmtKg2(item.peso_medio_cx)}/cx
                </span>
              )}
              {acimaDoSaldo && (
                <span style={{ color: '#fbbf24', fontWeight: 700 }}>
                  • Acima do saldo
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div
            role="group"
            aria-label="Unidade prevista"
            style={{
              display: 'inline-flex',
              background: '#0b1220',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: 2,
              gap: 2,
            }}
          >
            {['KG', 'CX'].map(u => {
              const ativo = item.unidade === u
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => onToggleUnidade(u)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 5,
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.03em',
                    cursor: 'pointer',
                    background: ativo ? (isEntrada ? '#d97706' : '#16a34a') : 'transparent',
                    color: ativo ? '#ffffff' : 'var(--text-muted)',
                  }}
                >
                  {u}
                </button>
              )
            })}
          </div>

          <div style={{ position: 'relative', width: 106 }}>
            <input
              type="text"
              inputMode={item.unidade === 'CX' ? 'numeric' : 'decimal'}
              className="form-input"
              style={{
                width: '100%',
                padding: '6px 28px 6px 10px',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                textAlign: 'right',
              }}
              placeholder="0"
              value={item.quantidade_input}
              onChange={e => onChangeQtd(e.target.value)}
            />
            <span style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}>
              {item.unidade === 'CX' ? 'cx' : 'kg'}
            </span>
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--sm text-danger"
            onClick={onRemover}
            title="Remover item"
            style={{
              width: 32,
              height: 32,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 7,
              border: '1px solid rgba(239, 68, 68, 0.25)',
              background: 'rgba(239, 68, 68, 0.08)',
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {((item.unidade === 'KG' && pesoPrevNum > 0 && cxEstimadasKg > 0) ||
        (item.unidade === 'CX' && cxPrevNum > 0)) && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 2 }}>
          {item.unidade === 'KG'
            ? `Estimativa visual: ~${cxEstimadasKg} cx (sem bloqueio por quantidade de caixas • média ${fmtKg2(item.peso_medio_cx)}/cx)`
            : pesoPrevNum > 0
              ? `Limite fixo: máx. ${cxPrevNum} caixa(s) • Peso estimado ~${fmtKg2(pesoPrevNum)} (${cxPrevNum} cx × ${fmtKg2(item.peso_medio_cx)})`
              : `Limite fixo: máx. ${cxPrevNum} caixa(s) — peso apurado na balança durante a produção`
          }
        </div>
      )}
    </div>
  )
}

export function Producao() {
  const location = useLocation()
  const navigate = useNavigate()
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const isAdm = temPermissao(operador, 'producao_criar_op')

  const [abaPrincipal, setAbaPrincipal] = useState('ativas') // 'ativas' | 'config' | 'fechadas' | 'custos_analise' | 'relatorios'
  const apiAtiva = isApiEnabled()
  const [custosOp, setCustosOp] = useState(null)
  const [loadingCustosOp, setLoadingCustosOp] = useState(false)
  const [formCustosOp, setFormCustosOp] = useState({ custo_embalagens: '0', custo_mo_indireto: '0', precos_ref: {} })
  const [analiseCustos, setAnaliseCustos] = useState({ ops: [], ranking_fornecedores: [] })
  const [loadingAnaliseCustos, setLoadingAnaliseCustos] = useState(false)
  const [filtroCustosInicio, setFiltroCustosInicio] = useState('')
  const [filtroCustosFim, setFiltroCustosFim] = useState('')
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
  const [feedbackEntrada, setFeedbackEntrada] = useState(null) // { tipo: 'sucesso' | 'erro' | 'alerta', titulo, msg }
  const entradaRef = useRef(null)

  // Formulário Saída da Produção
  const [produtoSaidaId, setProdutoSaidaId] = useState('')
  const [mostrarTodosProdutosSaida, setMostrarTodosProdutosSaida] = useState(false)
  const [formSaida, setFormSaida] = useState({
    data_producao: hojeIsoLocal(),
    validade: '',
    tara_id: '',
    peso_bruto: '',
    qtd_pecas: '',
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
  // Folha da Ordem de Produção (Impressão Paisagem com Observações, Entradas e Saídas)
  const [folhaOpPrint, setFolhaOpPrint] = useState(null)

  const carregarTudo = async () => {
    setLoading(true)
    try {
      const [ativas, fechadas, prods, listaTaras] = await Promise.all([
        producaoQueries.listarOPs('ATIVAS'),
        producaoQueries.listarOPs('FECHADA'),
        producaoQueries.listarProdutosComSaldoOP(),
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

  useEffect(() => {
    const prefill = location.state?.abrirNovaOpPrefill
    if (!prefill || !isAdm || produtos.length === 0) return
    setEditOpId(null)
    setOpSelecionada(null)
    setOpForm({
      nome: prefill.nome || '',
      data_producao: prefill.data_producao || hojeIsoLocal(),
      observacoes: prefill.observacoes || '',
      liberarAgora: true,
      itensEntrada: (prefill.previstos_entrada || []).map((i) => mapPrevistoParaForm(i, produtos)),
      itensSaida: (prefill.previstos_saida || []).map((i) => mapPrevistoParaForm(i, produtos)),
    })
    setAbaPrincipal('config')
    if (!prefill.previstos_entrada || prefill.previstos_entrada.length === 0) {
      toastWarning(
        'Selecione a Matéria-Prima de entrada',
        'Nenhum vínculo automático na Árvore para esses cortes. Inclua a Matéria-Prima obrigatória para abrir a OP.',
      )
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, isAdm, produtos, location.pathname, navigate, toastWarning])

  const abrirDetalhesOP = async (opId, manterSubAba = false) => {
    try {
      const det = await producaoQueries.detalhesOP(opId)
      if (!det) return toastError('Erro', 'OP não encontrada.')
      setOpSelecionada(det)
      setOpsAtivas(prev => prev.map(o => o.id === det.id ? {
        ...o,
        status: det.status,
        qtd_insumos: (det.insumos || []).length,
        peso_insumos: Number(det.peso_insumos || 0),
        qtd_retornos: (det.retornos || []).length,
        peso_retornos: Number(det.peso_retornos || 0),
      } : o))
      if (!manterSubAba) {
        setSubAbaOp('entradas')
        setFeedbackEntrada(null)
      }
      if (apiAtiva) {
        setCustosOp(null)
        producaoQueries.obterCustosOp(det.id).then((c) => {
          if (c) {
            setCustosOp(c)
            const prMap = {}
            for (const ct of c.cortes || []) {
              prMap[ct.produto_id] = String(ct.preco_venda_ref_kg ?? '')
            }
            setFormCustosOp({
              custo_embalagens: String(c.custo_embalagens ?? 0),
              custo_mo_indireto: String(c.custo_mo_indireto ?? 0),
              precos_ref: prMap,
            })
          }
        }).catch(() => {})
      }

      const padrao = resolverTaraSelecionada(taras, formSaida.tara_id)
      setFormSaida(prev => ({
        data_producao: det.data_producao || hojeIsoLocal(),
        validade: prev.validade || '',
        tara_id: padrao ? String(padrao.id) : prev.tara_id,
        peso_bruto: '',
        qtd_pecas: '',
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
      itensEntrada: (det.previstos_entrada || []).map(i => mapPrevistoParaForm(i, produtos)),
      itensSaida: (det.previstos_saida || []).map(i => mapPrevistoParaForm(i, produtos)),
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
            unidade: 'KG',
            quantidade_input: '',
            peso_kg_previsto: '',
            qtd_caixas_prevista: '',
            saldo_kg: Number(prod.saldo_kg || 0),
            saldo_caixas: Number(prod.qtd_caixas || 0),
            peso_medio_cx: Number(prod.peso_medio_cx || 0),
          },
        ],
      }
    })
  }

  const alterarQtdItemPrevisto = (tipoLista, idx, rawVal) => {
    setOpForm(f => ({
      ...f,
      [tipoLista]: f[tipoLista].map((item, j) => {
        if (j !== idx) return item
        if (item.unidade === 'CX') {
          const clean = String(rawVal || '').replace(/[^\d]/g, '')
          const cxs = parseInt(clean, 10) || 0
          const pesoEst = cxs > 0 && Number(item.peso_medio_cx || 0) > 0
            ? String(Number((cxs * Number(item.peso_medio_cx)).toFixed(2)))
            : ''
          return {
            ...item,
            quantidade_input: clean,
            qtd_caixas_prevista: cxs > 0 ? String(cxs) : '',
            peso_kg_previsto: pesoEst,
          }
        }
        const clean = String(rawVal || '').replace(/[^0-9.,]/g, '')
        const num = parseFloat(clean.replace(',', '.')) || 0
        return {
          ...item,
          quantidade_input: clean,
          peso_kg_previsto: num > 0 ? String(Number(num.toFixed(2))) : '',
          // No modo KG não persistimos limite fixo de caixas (apenas estimativa visual)
          qtd_caixas_prevista: '',
        }
      }),
    }))
  }

  const alternarUnidadeItemPrevisto = (tipoLista, idx, nextUnidade) => {
    setOpForm(f => ({
      ...f,
      [tipoLista]: f[tipoLista].map((item, j) => {
        if (j !== idx || item.unidade === nextUnidade) return item
        const media = Number(item.peso_medio_cx || 0)
        const curNum = parseFloat(String(item.quantidade_input || '').replace(',', '.')) || 0
        if (curNum <= 0) {
          return { ...item, unidade: nextUnidade, quantidade_input: '', peso_kg_previsto: '', qtd_caixas_prevista: '' }
        }
        if (nextUnidade === 'CX') {
          const cxs = media > 0 ? Math.max(1, Math.round(curNum / media)) : Math.max(1, Math.round(curNum))
          const pesoEst = media > 0 ? String(Number((cxs * media).toFixed(2))) : ''
          return {
            ...item,
            unidade: 'CX',
            quantidade_input: String(cxs),
            qtd_caixas_prevista: String(cxs),
            peso_kg_previsto: pesoEst,
          }
        }
        const kg = media > 0 ? Number((curNum * media).toFixed(2)) : Number(curNum.toFixed(2))
        return {
          ...item,
          unidade: 'KG',
          quantidade_input: String(kg),
          peso_kg_previsto: String(kg),
          qtd_caixas_prevista: '',
        }
      }),
    }))
  }

  const salvarOpConfigurada = async (e) => {
    e.preventDefault()
    if (!isAdm) return toastError('Acesso restrito', 'Apenas Administradores podem criar ou alterar OPs.')
    if (!opForm.nome.trim()) return toastWarning('Campo obrigatório', 'Informe o título/descrição da Ordem de Produção.')
    if (opForm.itensEntrada.length === 0) {
      return toastWarning(
        'Matéria-Prima obrigatória',
        'Não é permitido abrir ou salvar OP sem ao menos 1 Matéria-Prima prevista de ENTRADA.',
      )
    }

    const itensPrevistos = [
      ...opForm.itensEntrada.map(i => ({
        tipo: 'ENTRADA',
        produto_id: i.produto_id,
        unidade_prevista: i.unidade || 'KG',
        peso_kg_previsto: i.peso_kg_previsto ? Number(i.peso_kg_previsto) : null,
        qtd_caixas_prevista: i.unidade === 'CX' && i.qtd_caixas_prevista ? Number(i.qtd_caixas_prevista) : null,
      })),
      ...opForm.itensSaida.map(i => ({
        tipo: 'SAIDA',
        produto_id: i.produto_id,
        unidade_prevista: i.unidade || 'KG',
        peso_kg_previsto: i.peso_kg_previsto ? Number(i.peso_kg_previsto) : null,
        qtd_caixas_prevista: i.unidade === 'CX' && i.qtd_caixas_prevista ? Number(i.qtd_caixas_prevista) : null,
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
  const aplicarEntradaAlocadaNaTela = (res) => {
    const novoInsumo = res.insumo
    const pesoAdicionado = Number(novoInsumo.peso_kg || 0)

    setOpSelecionada(prev => {
      if (!prev) return prev
      const insumosAtualizados = [novoInsumo, ...(prev.insumos || [])]
      return {
        ...prev,
        status: prev.status === 'LIBERADA' ? 'ABERTA' : prev.status,
        insumos: insumosAtualizados,
        peso_insumos: Number(prev.peso_insumos || 0) + pesoAdicionado,
      }
    })
    setOpsAtivas(prev => prev.map(o => o.id === opSelecionada.id ? {
      ...o,
      status: o.status === 'LIBERADA' ? 'ABERTA' : o.status,
      qtd_insumos: Number(o.qtd_insumos || 0) + 1,
      peso_insumos: Number(o.peso_insumos || 0) + pesoAdicionado,
    } : o))

    const prevItem = (opSelecionada.previstos_entrada || []).find(
      p => String(p.produto_id) === String(novoInsumo.produto_id)
    )
    const qtdAtualProd = (opSelecionada.insumos || []).filter(
      i => String(i.produto_id) === String(novoInsumo.produto_id)
    ).length + 1
    const isModoCx = prevItem && (prevItem.unidade_prevista === 'CX' || (!prevItem.peso_kg_previsto && Number(prevItem.qtd_caixas_prevista || 0) > 0))
    const resumoMeta = isModoCx && Number(prevItem?.qtd_caixas_prevista || 0) > 0
      ? ` • Progresso: ${qtdAtualProd}/${prevItem.qtd_caixas_prevista} cx`
      : ''

    feedbackSom.sucesso()
    setFeedbackEntrada({
      tipo: 'sucesso',
      titulo: 'Entrada Confirmada!',
      msg: `${novoInsumo.produto_descricao} • Líq ${fmtKg2(pesoAdicionado)}${novoInsumo.qtd_pecas ? ` • ${novoInsumo.qtd_pecas} pç` : ''}${resumoMeta}`,
    })
    toastSuccess('Entrada Registrada', `${novoInsumo.produto_descricao} (${fmtKg2(pesoAdicionado)}) alocada na ${opSelecionada.codigo}.`)
    setScanEntrada('')
    setTimeout(() => entradaRef.current?.focus(), 60)
  }

  const handleBiparEntrada = async (e) => {
    e?.preventDefault()
    if (!opSelecionada || buscandoEntrada) return
    const ean = scanEntrada.trim()
    if (!ean) return

    const norm = ean.replace(/^0+/, '')
    const jaLocal = (opSelecionada.insumos || []).some(
      i => String(i.ean_caixa || '').trim().replace(/^0+/, '') === norm
    )
    if (jaLocal) {
      feedbackSom.erro()
      const msgDup = `A caixa ${ean} já foi bipada nesta OP.`
      setFeedbackEntrada({ tipo: 'erro', titulo: 'Caixa já bipada', msg: msgDup })
      toastError('Caixa duplicada', msgDup)
      setScanEntrada('')
      setTimeout(() => entradaRef.current?.focus(), 60)
      return
    }

    setBuscandoEntrada(true)
    try {
      const res = await producaoQueries.escanearEAlocarEntradaOP({
        op_id: opSelecionada.id,
        ean,
        forcarConfirmacao: false,
        operador_id: operador?.id,
        operador_nome: operador?.nome || 'Operador',
      })

      if (res.requiresConfirmation) {
        feedbackSom.alerta()
        setConfirmacaoEntrada({
          caixa: res.caixa,
          avisoFefo: res.avisoFefo,
          foraPrevisto: res.foraPrevisto,
        })
        setFeedbackEntrada({
          tipo: 'alerta',
          titulo: 'Confirmação necessária',
          msg: `${res.caixa?.produto_descricao || ean}: verifique o alerta na janela de confirmação.`,
        })
        return
      }

      if (!res.success) {
        feedbackSom.erro()
        const titulo = res.code === 'LIMITE_ATINGIDO'
          ? 'Quantidade Prevista Já Concluída'
          : 'Entrada Bloqueada'
        setFeedbackEntrada({ tipo: 'erro', titulo, msg: res.error })
        toastError(titulo, res.error)
        setScanEntrada('')
        setTimeout(() => entradaRef.current?.focus(), 60)
        return
      }

      aplicarEntradaAlocadaNaTela(res)
    } catch (err) {
      feedbackSom.erro()
      setFeedbackEntrada({ tipo: 'erro', titulo: 'Erro na leitura', msg: err.message })
      toastError('Erro', err.message)
      setTimeout(() => entradaRef.current?.focus(), 60)
    } finally {
      setBuscandoEntrada(false)
    }
  }

  const confirmarAlocacaoEntrada = async (cx) => {
    setConfirmacaoEntrada(null)
    setBuscandoEntrada(true)
    try {
      const res = await producaoQueries.escanearEAlocarEntradaOP({
        op_id: opSelecionada.id,
        ean: cx.ean_caixa,
        forcarConfirmacao: true,
        operador_id: operador?.id,
        operador_nome: operador?.nome || 'Operador',
      })
      if (!res.success) {
        feedbackSom.erro()
        setFeedbackEntrada({ tipo: 'erro', titulo: 'Erro na Entrada', msg: res.error })
        toastError('Erro na Entrada', res.error)
        setScanEntrada('')
        setTimeout(() => entradaRef.current?.focus(), 60)
        return
      }
      aplicarEntradaAlocadaNaTela(res)
    } catch (err) {
      feedbackSom.erro()
      setFeedbackEntrada({ tipo: 'erro', titulo: 'Erro', msg: err.message })
      toastError('Erro', err.message)
    } finally {
      setBuscandoEntrada(false)
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
      qtdPecas: formSaida.qtd_pecas,
      exigirQtdPecas: true,
    })
    if (!valid.ok) return toastWarning('Dados da Caixa', valid.erro)

    const prodObj = produtos.find(p => String(p.id) === String(produtoSaidaId))
    setSalvandoSaida(true)
    try {
      const res = await producaoQueries.adicionarRetorno(
        opSelecionada.id,
        {
          produto_id: /^\d+$/.test(String(produtoSaidaId)) ? Number(produtoSaidaId) : produtoSaidaId,
          produto_codigo: prodObj?.codigo || '',
          peso_kg: valid.peso_liquido_kg,
          peso_bruto_kg: valid.peso_bruto_kg,
          tara_id: valid.tara_id,
          tara_kg: valid.tara_kg,
          qtd_pecas: valid.qtd_pecas,
          data_producao: valid.data_producao,
          validade: valid.validade,
          lote: valid.lote,
        },
        operador?.id,
        operador?.nome || 'Operador'
      )

      if (!res.success) {
        feedbackSom.erro()
        toastError('Erro ao gerar saída', res.error)
        return
      }

      feedbackSom.sucesso()
      toastSuccess(
        'Caixa de Saída Gerada!',
        `${res.caixa_gerada.produto_descricao} • ${res.caixa_gerada.qtd_pecas} pç • Líq ${fmtKg2(res.caixa_gerada.peso_liquido_kg)} • EAN ${res.caixa_gerada.ean_caixa}`
      )

      setFormSaida(prev => ({ ...prev, peso_bruto: '', qtd_pecas: '' }))
      await abrirDetalhesOP(opSelecionada.id, true)

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
    const ok = await useAppStore.getState().confirmar({
      title: 'Finalizar Ordem de Produção',
      message: `Deseja finalizar a ${opSelecionada.codigo}? Os insumos alocados serão marcados como consumidos e o rendimento será consolidado.`,
      type: 'success',
      confirmLabel: 'Finalizar OP',
    })
    if (!ok) return
    const res = await producaoQueries.finalizarOP(opSelecionada.id)
    if (!res.success) return toastError('Erro', res.error)
    toastSuccess('OP Finalizada!', `${opSelecionada.codigo} concluída com sucesso.`)
    setOpSelecionada(null)
    await carregarTudo()
    setAbaPrincipal('fechadas')
  }

  const handleReabrirOP = async (op) => {
    if (!isAdm) return
    const ok = await useAppStore.getState().confirmar({
      title: 'Reabrir Ordem de Produção',
      message: `Deseja reabrir a ${op.codigo} para edição?`,
      type: 'confirm',
      confirmLabel: 'Reabrir OP',
    })
    if (!ok) return
    const res = await producaoQueries.reabrirOP(op.id)
    if (!res.success) return toastError('Erro', res.error)
    toastSuccess('OP Reaberta', `${op.codigo} liberada novamente.`)
    await carregarTudo()
    setAbaPrincipal('ativas')
    abrirDetalhesOP(op.id)
  }

  const handleCancelarOP = async () => {
    if (!isAdm || !opSelecionada) return
    const ok = await useAppStore.getState().confirmar({
      title: 'Excluir Ordem de Produção',
      message: `Excluir permanentemente a ${opSelecionada.codigo}?`,
      type: 'error',
      confirmLabel: 'Excluir OP',
    })
    if (!ok) return
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

  const handleImprimirFolhaOP = async (opOuId) => {
    try {
      const det = typeof opOuId === 'object' && opOuId !== null && Array.isArray(opOuId.previstos_entrada)
        ? opOuId
        : await producaoQueries.detalhesOP(typeof opOuId === 'object' ? opOuId.id : opOuId)
      if (!det) return toastError('Erro', 'Ordem de Produção não encontrada.')
      setFolhaOpPrint(det)
    } catch (err) {
      toastError('Erro ao carregar folha da OP', err.message)
    }
  }

  const handleRemoverItem = async (tipo, item) => {
    const ok = await useAppStore.getState().confirmar({
      title: 'Estornar Item da OP',
      message: `Remover ${tipo === 'INSUMO' ? 'esta entrada' : 'esta saída'} da ${opSelecionada.codigo}?`,
      type: 'error',
      confirmLabel: 'Remover Item',
    })
    if (!ok) return
    const res = await producaoQueries.removerItemOP(opSelecionada.id, tipo, item.id, item.caixa_id)
    if (!res.success) return toastError('Erro', res.error)
    toastSuccess('Item removido', 'Registro estornado da OP.')
    setFeedbackEntrada(null)
    await abrirDetalhesOP(opSelecionada.id, true)
  }

  const abrirDossieCompleto = (opId) => {
    setOpSelecionada(null)
    setDossieOpIdFiltro(opId)
    setAbaPrincipal('relatorios')
  }

  const fmtMoedaPrd = (v) =>
    Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const carregarCustosOpSelecionada = async (opId) => {
    if (!apiAtiva || !opId) return
    setLoadingCustosOp(true)
    try {
      const c = await producaoQueries.obterCustosOp(opId)
      if (c) {
        setCustosOp(c)
        const prMap = {}
        for (const ct of c.cortes || []) {
          prMap[ct.produto_id] = String(ct.preco_venda_ref_kg ?? '')
        }
        setFormCustosOp({
          custo_embalagens: String(c.custo_embalagens ?? 0),
          custo_mo_indireto: String(c.custo_mo_indireto ?? 0),
          precos_ref: prMap,
        })
      }
    } catch (err) {
      toastError('Custos OP', err.message)
    } finally {
      setLoadingCustosOp(false)
    }
  }

  const handleSalvarCustosOp = async (e) => {
    e?.preventDefault()
    if (!opSelecionada) return
    const precosNum = {}
    for (const [k, v] of Object.entries(formCustosOp.precos_ref || {})) {
      const n = Number(String(v || '0').replace(',', '.'))
      if (Number.isFinite(n) && n >= 0) precosNum[k] = n
    }
    setLoadingCustosOp(true)
    try {
      const res = await producaoQueries.atualizarCustosOp(opSelecionada.id, {
        custo_embalagens: Number(String(formCustosOp.custo_embalagens || '0').replace(',', '.')) || 0,
        custo_mo_indireto: Number(String(formCustosOp.custo_mo_indireto || '0').replace(',', '.')) || 0,
        precos_ref: precosNum,
      })
      setCustosOp(res)
      toastSuccess('Rateio Atualizado ✅', 'Custos NRV dos cortes e das caixas recalculados!')
    } catch (err) {
      toastError('Erro ao salvar custos', err.message)
    } finally {
      setLoadingCustosOp(false)
    }
  }

  const carregarAnaliseCustosOps = async (di = filtroCustosInicio, df = filtroCustosFim) => {
    if (!apiAtiva) return
    setLoadingAnaliseCustos(true)
    try {
      const res = await producaoQueries.listarAnaliseCustosOps({
        dataInicio: di || undefined,
        dataFim: df || undefined,
      })
      setAnaliseCustos(res || { ops: [], ranking_fornecedores: [] })
    } catch (err) {
      toastError('Análise Custos', err.message)
    } finally {
      setLoadingAnaliseCustos(false)
    }
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
              ? 'Gestão de Ordens de Produção (criação, configuração de entradas/saídas e liberação) + Execução operacional com pesagem por Tara e impressão Zebra.'
              : 'Selecione uma OP liberada para registrar as Entradas de Matéria-Prima e gerar as Saídas de Produção com etiqueta automática.'}
          </p>
        </div>

        {isAdm && (
          <button type="button" className="btn btn--primary" onClick={iniciarNovaOpAdm}>
            <Plus size={16} /> Nova Ordem de Produção
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
            <Edit3 size={15} /> {editOpId ? 'Editando OP' : 'Criar / Configurar OP'}
          </button>
        )}

        <button
          type="button"
          className={`btn ${abaPrincipal === 'fechadas' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => { setAbaPrincipal('fechadas'); setOpSelecionada(null) }}
        >
          <Check size={15} /> OPs Finalizadas ({opsFechadas.length})
        </button>

        {apiAtiva && (
          <button
            type="button"
            className={`btn ${abaPrincipal === 'custos_analise' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => {
              setOpSelecionada(null)
              setAbaPrincipal('custos_analise')
              carregarAnaliseCustosOps()
            }}
          >
            <TrendingUp size={15} /> Custos & Rendimento (Fornecedores)
          </button>
        )}

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
                </div>
                {opSelecionada.observacoes?.trim() && (
                  <div style={{
                    marginTop: 8,
                    padding: '7px 11px',
                    borderRadius: 7,
                    background: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderLeft: '4px solid #f59e0b',
                    color: '#fde68a',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                  }}>
                    <strong>Observações:</strong> {opSelecionada.observacoes}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => handleImprimirFolhaOP(opSelecionada)}
                  title="Imprimir Folha da OP com Observações, Entradas e Saídas"
                >
                  <Printer size={14} /> Imprimir Folha OP
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirDossieCompleto(opSelecionada.id)}>
                  <FileText size={14} /> Dossiê (Rendimento)
                </button>
                {isAdm && opSelecionada.status !== 'FECHADA' && (
                  <>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => iniciarEdicaoOpAdm(opSelecionada)}>
                      <Edit3 size={14} /> Editar Configuração
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

          {/* Seletor das Sub-telas Operacionais */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${subAbaOp === 'entradas' ? 'btn--warning' : 'btn--secondary'}`}
              style={{ flex: 1, minWidth: 210, justifyContent: 'center' }}
              onClick={() => { setSubAbaOp('entradas'); setTimeout(() => entradaRef.current?.focus(), 80) }}
            >
              <ArrowDownToLine size={17} /> 1. Entradas na Produção ({resumoOp?.qtdIn || 0} cx)
            </button>
            <button
              type="button"
              className={`btn ${subAbaOp === 'saidas' ? 'btn--success' : 'btn--secondary'}`}
              style={{ flex: 1, minWidth: 210, justifyContent: 'center' }}
              onClick={() => { setSubAbaOp('saidas'); setTimeout(() => pesoBrutoSaidaRef.current?.focus(), 80) }}
            >
              <ArrowUpFromLine size={17} /> 2. Saída da Produção & Etiquetas ({resumoOp?.qtdOut || 0} cx)
            </button>
            {apiAtiva && (
              <button
                type="button"
                className={`btn ${subAbaOp === 'custos' ? 'btn--primary' : 'btn--secondary'}`}
                style={{ flex: 1, minWidth: 210, justifyContent: 'center' }}
                onClick={() => {
                  setSubAbaOp('custos')
                  carregarCustosOpSelecionada(opSelecionada.id)
                }}
              >
                <DollarSign size={17} /> 3. Custos & Rateio NRV
              </button>
            )}
          </div>

          {/* ── SUB-ABA 1: ENTRADAS NA PRODUÇÃO ───────────────────────────── */}
          {subAbaOp === 'entradas' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {opSelecionada.previstos_entrada?.length > 0 && (
                <div className="card" style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Conferência de Matérias-Primas Previstas na OP
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Itens em CX possuem trava automática de limite ao atingir a quantidade prevista
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                          <th style={{ padding: '7px 10px' }}>Produto</th>
                          <th style={{ padding: '7px 10px' }}>Qtd Prevista</th>
                          <th style={{ padding: '7px 10px' }}>Qtd Bipada</th>
                          <th style={{ padding: '7px 10px' }}>Restante</th>
                          <th style={{ padding: '7px 10px' }}>Peças</th>
                          <th style={{ padding: '7px 10px' }}>Peso Reg.</th>
                          <th style={{ padding: '7px 10px', textAlign: 'right' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {opSelecionada.previstos_entrada.map(pe => {
                          const itensProd = (opSelecionada.insumos || []).filter(i => String(i.produto_id) === String(pe.produto_id))
                          const bipadoCx = itensProd.length
                          const bipadoKg = itensProd.reduce((s, x) => s + Number(x.peso_kg || 0), 0)
                          const pecasTotal = itensProd.reduce((s, x) => s + Number(x.qtd_pecas || 0), 0)
                          const prevCx = Number(pe.qtd_caixas_prevista || 0)
                          const prevKg = Number(pe.peso_kg_previsto || 0)
                          const isModoCx = pe.unidade_prevista === 'CX' || (!prevKg && prevCx > 0)

                          let statusTxt = 'Pendente'
                          let statusStyle = { bg: 'rgba(148,163,184,0.14)', color: '#94a3b8', border: 'rgba(148,163,184,0.3)' }
                          if (isModoCx && prevCx > 0) {
                            if (bipadoCx >= prevCx) {
                              statusTxt = 'Concluído / Limite Atingido'
                              statusStyle = { bg: 'rgba(34,197,94,0.16)', color: '#4ade80', border: 'rgba(34,197,94,0.4)' }
                            } else if (bipadoCx > 0) {
                              statusTxt = 'Em andamento'
                              statusStyle = { bg: 'rgba(56,189,248,0.16)', color: '#38bdf8', border: 'rgba(56,189,248,0.4)' }
                            }
                          } else if (prevKg > 0) {
                            if (bipadoKg >= prevKg - 0.001 && bipadoCx > 0) {
                              statusTxt = 'Meta Atingida'
                              statusStyle = { bg: 'rgba(34,197,94,0.16)', color: '#4ade80', border: 'rgba(34,197,94,0.4)' }
                            } else if (bipadoCx > 0) {
                              statusTxt = 'Em andamento'
                              statusStyle = { bg: 'rgba(56,189,248,0.16)', color: '#38bdf8', border: 'rgba(56,189,248,0.4)' }
                            }
                          } else if (bipadoCx > 0) {
                            statusTxt = 'Bipado'
                            statusStyle = { bg: 'rgba(56,189,248,0.16)', color: '#38bdf8', border: 'rgba(56,189,248,0.4)' }
                          }

                          const restCx = isModoCx && prevCx > 0 ? Math.max(0, prevCx - bipadoCx) : null
                          const restKg = !isModoCx && prevKg > 0 ? Math.max(0, prevKg - bipadoKg) : null

                          return (
                            <tr key={pe.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '8px 10px' }}>
                                <strong>{pe.produto_descricao}</strong>
                                <span style={{ marginLeft: 6, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                  #{pe.produto_codigo || '-'}
                                </span>
                              </td>
                              <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                {isModoCx && prevCx > 0 ? (
                                  <>
                                    {prevCx} cx
                                    {prevKg > 0 && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 400 }}>~{fmtKg2(prevKg)}</div>}
                                  </>
                                ) : prevKg > 0 ? fmtKg2(prevKg) : 'Livre'}
                              </td>
                              <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fbbf24' }}>
                                {bipadoCx} cx
                              </td>
                              <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: restCx === 0 || restKg === 0 ? '#4ade80' : 'var(--text-primary)' }}>
                                {restCx != null ? `${restCx} cx` : restKg != null ? fmtKg2(restKg) : '-'}
                              </td>
                              <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>
                                {pecasTotal > 0 ? `${pecasTotal} pç` : '-'}
                              </td>
                              <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fbbf24' }}>
                                {fmtKg2(bipadoKg)}
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '3px 9px',
                                  borderRadius: 99,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: statusStyle.bg,
                                  color: statusStyle.color,
                                  border: `1px solid ${statusStyle.border}`,
                                }}>
                                  {statusTxt}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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

                  {feedbackEntrada && (
                    <div style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 13,
                      background: feedbackEntrada.tipo === 'sucesso'
                        ? 'rgba(34,197,94,0.14)'
                        : feedbackEntrada.tipo === 'alerta'
                          ? 'rgba(245,158,11,0.14)'
                          : 'rgba(239,68,68,0.16)',
                      border: `1px solid ${
                        feedbackEntrada.tipo === 'sucesso'
                          ? 'rgba(34,197,94,0.45)'
                          : feedbackEntrada.tipo === 'alerta'
                            ? 'rgba(245,158,11,0.45)'
                            : 'rgba(239,68,68,0.45)'
                      }`,
                      color: feedbackEntrada.tipo === 'sucesso'
                        ? '#bbf7d0'
                        : feedbackEntrada.tipo === 'alerta'
                          ? '#fde68a'
                          : '#fecaca',
                    }}>
                      {feedbackEntrada.tipo === 'sucesso'
                        ? <CheckCircle2 size={18} color="#4ade80" style={{ flexShrink: 0 }} />
                        : feedbackEntrada.tipo === 'alerta'
                          ? <AlertTriangle size={18} color="#fbbf24" style={{ flexShrink: 0 }} />
                          : <XCircle size={18} color="#f87171" style={{ flexShrink: 0 }} />
                      }
                      <div>
                        <strong>{feedbackEntrada.titulo}:</strong> {feedbackEntrada.msg}
                      </div>
                    </div>
                  )}
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
                          <th style={{ padding: '8px 10px' }}>Peças</th>
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
                            <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                              {item.qtd_pecas != null ? `${item.qtd_pecas} pç` : '-'}
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
                      Produto Produzido * {opSelecionada.previstos_saida?.length > 0 && !mostrarTodosProdutosSaida ? '(Configurados nesta OP)' : ''}
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
                          {(p.peso_kg_previsto || p.qtd_caixas_prevista)
                            ? ` (Prev:${p.peso_kg_previsto ? ` ${fmtKg2(p.peso_kg_previsto)}` : ''}${p.qtd_caixas_prevista ? ` ${p.peso_kg_previsto ? '• ' : ' '}${p.qtd_caixas_prevista} cx` : ''})`
                            : ''}
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
                          <th style={{ padding: '8px 10px' }}>Peças</th>
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
                            <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                              {ret.qtd_pecas != null ? `${ret.qtd_pecas} pç` : '-'}
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

          {/* ── SUB-ABA 3: MOTOR DE CUSTOS & RATEIO NRV ───────────────────── */}
          {subAbaOp === 'custos' && apiAtiva && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {loadingCustosOp && !custosOp ? (
                <div className="card">Calculando custos reais e rendimento industrial...</div>
              ) : custosOp ? (
                <>
                  <div className="kpi-grid">
                    <div className="kpi-card">
                      <span className="kpi-card__label">Custo Matéria-Prima (MP)</span>
                      <span className="kpi-card__value">{fmtMoedaPrd(custosOp.custo_mp_total)}</span>
                    </div>
                    <div className="kpi-card">
                      <span className="kpi-card__label">Custo Total OP (+Emb/MO)</span>
                      <span className="kpi-card__value text-warning">{fmtMoedaPrd(custosOp.custo_total_op)}</span>
                    </div>
                    <div className="kpi-card">
                      <span className="kpi-card__label text-cyan">Custo Real Aproveitado / kg</span>
                      <span className="kpi-card__value text-cyan">{fmtMoedaPrd(custosOp.custo_efetivo_aproveitado_kg)}/kg</span>
                    </div>
                    <div className="kpi-card">
                      <span className="kpi-card__label text-success">Margem Bruta Estimada</span>
                      <span className={`kpi-card__value ${custosOp.margem_bruta_rs >= 0 ? 'text-success' : 'text-danger'}`}>
                        {fmtMoedaPrd(custosOp.margem_bruta_rs)} ({custosOp.margem_bruta_pct}%)
                      </span>
                    </div>
                  </div>

                  {/* Origem MP */}
                  <div className="card">
                    <h4 className="font-bold text-sm mb-10 flex items-center gap-8">
                      <Package size={16} className="text-warning" /> Origem da Matéria-Prima Alocada na OP
                    </h4>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Fornecedor / Origem</th>
                            <th>SIF / Lote</th>
                            <th>Produto MP</th>
                            <th style={{ textAlign: 'right' }}>Peso Entrada</th>
                            <th style={{ textAlign: 'right' }}>Custo MP/kg</th>
                            <th style={{ textAlign: 'right' }}>Total MP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(custosOp.insumos_origem || []).map((orig, idx) => (
                            <tr key={idx}>
                              <td className="font-bold">{orig.fornecedor_nome}</td>
                              <td className="font-mono text-xs">{orig.sif_origem || '-'} • {orig.lote || '-'}</td>
                              <td className="text-sm">{orig.produto_descricao}</td>
                              <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg2(orig.peso_kg)}</td>
                              <td style={{ textAlign: 'right' }} className="font-mono">{fmtMoedaPrd(orig.custo_medio_kg)}</td>
                              <td style={{ textAlign: 'right' }} className="font-bold">{fmtMoedaPrd(orig.custo_total)}</td>
                            </tr>
                          ))}
                          {(custosOp.insumos_origem || []).length === 0 && (
                            <tr><td colSpan={6} className="text-center p-16 text-muted">Nenhuma caixa de entrada bipada ainda.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Despesas OP + Tabela NRV por Corte */}
                  <form onSubmit={handleSalvarCustosOp} className="card">
                    <div className="flex justify-between items-center flex-wrap gap-10 mb-14">
                      <div>
                        <h4 className="font-bold text-sm flex items-center gap-8">
                          <DollarSign size={16} className="text-success" /> Rateio de Custo Real por Corte ({custosOp.metodo_rateio === 'NRV' ? 'NRV — Proporcional ao Preço de Venda' : 'Proporcional ao Peso'})
                        </h4>
                        <p className="text-xs text-muted mt-4">
                          Aparas creditam seu valor residual antes de ratear o custo líquido entre os cortes nobres.
                        </p>
                      </div>
                      {isAdm && (
                        <button type="submit" className="btn btn--primary btn--sm" disabled={loadingCustosOp}>
                          <CheckCircle2 size={15} /> Salvar Custos & Recalcular NRV
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 16 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Embalagens / Etiquetas / Sacos (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-input"
                          value={formCustosOp.custo_embalagens}
                          onChange={(e) => setFormCustosOp((p) => ({ ...p, custo_embalagens: e.target.value }))}
                          disabled={!isAdm}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Mão de Obra / Energia / Desossa (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-input"
                          value={formCustosOp.custo_mo_indireto}
                          onChange={(e) => setFormCustosOp((p) => ({ ...p, custo_mo_indireto: e.target.value }))}
                          disabled={!isAdm}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Receita Ref. Total Estimada</label>
                        <div className="form-input font-bold text-success" style={{ background: 'var(--bg-1)' }}>
                          {fmtMoedaPrd(custosOp.receita_estimada_total)}
                        </div>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Corte / Produto Gerado</th>
                            <th style={{ textAlign: 'right' }}>Peso Saída</th>
                            <th style={{ textAlign: 'right' }}>% Rend. s/ MP</th>
                            <th style={{ textAlign: 'right' }}>Preço Venda Ref./kg</th>
                            <th style={{ textAlign: 'right' }}>Custo Real Alocado/kg</th>
                            <th style={{ textAlign: 'right' }}>Custo Total</th>
                            <th style={{ textAlign: 'right' }}>Margem Bruta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(custosOp.cortes || []).map((c) => (
                            <tr key={c.produto_id}>
                              <td>
                                <div className="font-bold text-sm">{c.produto_codigo} — {c.produto_descricao}</div>
                                <div className="text-xs text-muted">{c.qtd_caixas} cx {c.eh_apara ? '• APARA (Crédito)' : ''}</div>
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-mono font-bold">{fmtKg2(c.peso_kg)}</td>
                              <td style={{ textAlign: 'right' }} className="font-mono">{c.rendimento_sobre_mp_pct}%</td>
                              <td style={{ textAlign: 'right' }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="form-input"
                                  style={{ width: 95, textAlign: 'right', display: 'inline-block' }}
                                  value={formCustosOp.precos_ref?.[c.produto_id] ?? c.preco_venda_ref_kg}
                                  onChange={(e) =>
                                    setFormCustosOp((p) => ({
                                      ...p,
                                      precos_ref: { ...p.precos_ref, [c.produto_id]: e.target.value },
                                    }))
                                  }
                                  disabled={!isAdm}
                                />
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">
                                {fmtMoedaPrd(c.custo_alocado_kg)}
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-mono">
                                {fmtMoedaPrd(c.custo_total)}
                              </td>
                              <td style={{ textAlign: 'right' }} className={`font-bold ${c.margem_rs >= 0 ? 'text-success' : 'text-danger'}`}>
                                {fmtMoedaPrd(c.margem_rs)} ({c.margem_pct}%)
                              </td>
                            </tr>
                          ))}
                          {(custosOp.cortes || []).length === 0 && (
                            <tr><td colSpan={7} className="text-center p-16 text-muted">Nenhuma caixa de retorno lançada ainda.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </form>
                </>
              ) : (
                <div className="card text-muted text-sm">Nenhum cálculo disponível ainda.</div>
              )}
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
              {isAdm && ' Clique em "Nova Ordem de Produção" para abrir e liberar uma nova OP.'}
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
                {(Number(op.qtd_prev_entrada || 0) > 0 || Number(op.qtd_prev_saida || 0) > 0) && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Previsto: <strong style={{ color: '#fbbf24' }}>{op.qtd_prev_entrada || 0} entrada(s)</strong> •{' '}
                    <strong style={{ color: '#4ade80' }}>{op.qtd_prev_saida || 0} saída(s)</strong>
                  </div>
                )}
                {op.observacoes?.trim() && (
                  <div style={{
                    fontSize: 11.5,
                    color: '#fde68a',
                    background: 'rgba(245, 158, 11, 0.1)',
                    borderLeft: '3px solid #f59e0b',
                    padding: '5px 8px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }} title={op.observacoes}>
                    <strong>Obs:</strong> {op.observacoes}
                  </div>
                )}
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
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => handleImprimirFolhaOP(op.id)}
                    title="Imprimir Folha da OP (Observações, Entradas e Saídas)"
                  >
                    <Printer size={14} /> Imprimir
                  </button>
                  {isAdm && (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={async () => { const d = await producaoQueries.detalhesOP(op.id); if (d) iniciarEdicaoOpAdm(d) }} title="Editar configuração da OP">
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
                {editOpId ? 'Editar Configuração da Ordem de Produção' : 'Nova Ordem de Produção'}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
            {/* ENTRADAS PREVISTAS */}
            <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>
                  Itens Previstos de ENTRADA (Matéria-Prima)
                </h4>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Com saldo em estoque primeiro</span>
              </div>
              <SeletorProdutoInline
                produtos={produtos}
                mostrarSaldo
                priorizarComSaldo
                placeholder="Buscar produto de entrada por código ou nome..."
                onSelect={(p) => adicionarItemPrevisto('itensEntrada', p)}
              />
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {opForm.itensEntrada.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#fde68a',
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      borderRadius: 6,
                      padding: '10px 12px',
                    }}
                  >
                    <strong>Obrigatório:</strong> selecione ao menos 1 Matéria-Prima de entrada antes de salvar/abrir a OP.
                  </div>
                ) : (
                  opForm.itensEntrada.map((item, idx) => (
                    <OpItemPrevistoRow
                      key={item.produto_id}
                      item={item}
                      tipo="ENTRADA"
                      mostrarSaldo
                      onToggleUnidade={(u) => alternarUnidadeItemPrevisto('itensEntrada', idx, u)}
                      onChangeQtd={(val) => alterarQtdItemPrevisto('itensEntrada', idx, val)}
                      onRemover={() => setOpForm(f => ({ ...f, itensEntrada: f.itensEntrada.filter((_, j) => j !== idx) }))}
                    />
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
                mostrarSaldo={false}
                priorizarComSaldo={false}
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
                    <OpItemPrevistoRow
                      key={item.produto_id}
                      item={item}
                      tipo="SAIDA"
                      mostrarSaldo={false}
                      onToggleUnidade={(u) => alternarUnidadeItemPrevisto('itensSaida', idx, u)}
                      onChangeQtd={(val) => alterarQtdItemPrevisto('itensSaida', idx, val)}
                      onRemover={() => setOpForm(f => ({ ...f, itensSaida: f.itensSaida.filter((_, j) => j !== idx) }))}
                    />
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
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleImprimirFolhaOP(op.id)} title="Imprimir Folha da OP (Observações, Entradas e Saídas)">
                            <Printer size={13} /> Folha OP
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

      {/* ─── ABA CUSTOS & RENDIMENTO POR FORNECEDOR ───────────────────────── */}
      {!opSelecionada && abaPrincipal === 'custos_analise' && apiAtiva && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <div className="flex justify-between items-end flex-wrap gap-12">
              <div>
                <h2 className="text-base font-bold flex items-center gap-8">
                  <Award size={18} className="text-cyan" /> Ranking Real: Fornecedor × Rendimento × Custo Aproveitado/kg
                </h2>
                <p className="text-xs text-muted mt-4">
                  Compare frigoríficos pelo rendimento real após desossa/beneficiamento e descubra quem realmente sai mais barato por kg aproveitado.
                </p>
              </div>
              <div className="flex gap-8 items-end flex-wrap">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">De</label>
                  <input type="date" className="form-input" value={filtroCustosInicio} onChange={(e) => setFiltroCustosInicio(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Até</label>
                  <input type="date" className="form-input" value={filtroCustosFim} onChange={(e) => setFiltroCustosFim(e.target.value)} />
                </div>
                <button type="button" className="btn btn--primary" disabled={loadingAnaliseCustos} onClick={() => carregarAnaliseCustosOps()}>
                  <RefreshCw size={15} className={loadingAnaliseCustos ? 'animate-spin' : ''} /> Atualizar Análise
                </button>
              </div>
            </div>
          </div>

          {/* Tabela Ranking Fornecedores */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border font-bold text-sm">
              1. Ranking de Eficiência por Fornecedor ({(analiseCustos.ranking_fornecedores || []).length})
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fornecedor / Frigorífico</th>
                    <th style={{ textAlign: 'right' }}>OPs</th>
                    <th style={{ textAlign: 'right' }}>Entrada MP</th>
                    <th style={{ textAlign: 'right' }}>Aproveitado</th>
                    <th style={{ textAlign: 'right' }}>Rendimento %</th>
                    <th style={{ textAlign: 'right' }}>Quebra %</th>
                    <th style={{ textAlign: 'right' }}>Custo MP/kg</th>
                    <th style={{ textAlign: 'right' }}>Custo Real Aproveitado/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {(analiseCustos.ranking_fornecedores || []).map((f) => (
                    <tr key={f.fornecedor_id}>
                      <td className="font-bold">{f.fornecedor_nome}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{f.qtd_ops}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg2(f.peso_entrada_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-success font-bold">{fmtKg2(f.peso_aproveitado_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">{f.rendimento_medio_pct}%</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-danger">{f.perda_media_pct}%</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{fmtMoedaPrd(f.custo_medio_mp_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold text-warning">
                        {fmtMoedaPrd(f.custo_efetivo_aproveitado_kg)}
                      </td>
                    </tr>
                  ))}
                  {(analiseCustos.ranking_fornecedores || []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-20 text-muted">
                        Nenhuma OP finalizada com matéria-prima de fornecedor identificado neste período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela OPs Finalizadas com Rentabilidade */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border font-bold text-sm">
              2. Margem & Custo Industrial das OPs Finalizadas ({(analiseCustos.ops || []).length})
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>OP</th>
                    <th>Data Prod.</th>
                    <th style={{ textAlign: 'right' }}>Entrada</th>
                    <th style={{ textAlign: 'right' }}>Saída</th>
                    <th style={{ textAlign: 'right' }}>Rend. %</th>
                    <th>Rateio</th>
                    <th style={{ textAlign: 'right' }}>Custo Total</th>
                    <th style={{ textAlign: 'right' }}>Receita Est.</th>
                    <th style={{ textAlign: 'right' }}>Margem</th>
                    <th style={{ textAlign: 'right' }}>Abrir</th>
                  </tr>
                </thead>
                <tbody>
                  {(analiseCustos.ops || []).map((o) => (
                    <tr key={o.op_id}>
                      <td>
                        <div className="font-mono font-bold text-cyan">{o.op_codigo}</div>
                        <div className="text-xs text-muted">{o.op_nome}</div>
                      </td>
                      <td className="text-xs">{fmtDataBR(o.data_producao)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg2(o.peso_insumos_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold">{fmtKg2(o.peso_retornos_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">{o.rendimento_pct}%</td>
                      <td><span className="badge badge--neutral">{o.metodo_rateio}</span></td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{fmtMoedaPrd(o.custo_total_op)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{fmtMoedaPrd(o.receita_estimada_total)}</td>
                      <td style={{ textAlign: 'right' }} className={`font-bold ${o.margem_bruta_rs >= 0 ? 'text-success' : 'text-danger'}`}>
                        {fmtMoedaPrd(o.margem_bruta_rs)} ({o.margem_bruta_pct}%)
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={async () => {
                            await abrirDetalhesOP(o.op_id, true)
                            setSubAbaOp('custos')
                          }}
                        >
                          Custos NRV
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(analiseCustos.ops || []).length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center p-20 text-muted">
                        Finalize ao menos uma Ordem de Produção para acompanhar o rateio NRV e margem bruta.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
                  Este produto não estava na lista de entradas previstas configurada para esta OP.
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

      {/* MODAL DE IMPRESSÃO DA FOLHA DA ORDEM DE PRODUÇÃO (PAISAGEM A4) */}
      <FolhaOrdemProducaoPrint
        op={folhaOpPrint}
        onClose={() => setFolhaOpPrint(null)}
        autoPrint
      />
    </div>
  )
}
