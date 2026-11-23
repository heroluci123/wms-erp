import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  Package,
  Printer,
  QrCode,
  RefreshCw,
  Scale,
  ScanBarcode,
  Search,
  Snowflake,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { acougueQueries, precosQueries } from '../queries/varejo'
import { useAppStore } from '../store/appStore'
import {
  ModalEtiquetaZebra80x45,
  imprimirEtiqueta80x45Html,
} from '../components/shared/EtiquetaZebra80x45'
import { lerConfigEstacao } from '../utils/estacaoConfig'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v) => `${Number(v || 0).toFixed(3).replace('.', ',')} kg`

const fmtDataBR = (iso) => {
  if (!iso) return '-'
  const s = String(iso).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-')
    return `${d}/${m}/${y}`
  }
  return s
}

const ESPECIES_TABS = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'BOVINO', label: 'Bovinos' },
  { id: 'SUINO', label: 'Suínos' },
  { id: 'AVES', label: 'Aves' },
  { id: 'EMPORIO', label: 'Empório' },
  { id: 'OUTROS', label: 'Outros' },
]

export function AcougueOperacao() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [aba, setAba] = useState('PESAGEM') // 'PESAGEM' | 'ENTRADA_MP'
  const [loadingProdutos, setLoadingProdutos] = useState(true)

  // Tabela ativa no Açougue + Modal de Troca via PIN
  const [tabelaAtiva, setTabelaAtiva] = useState(null)
  const [emTabelaAlternativa, setEmTabelaAlternativa] = useState(false)
  const [alteradaPorNome, setAlteradaPorNome] = useState('')
  const [tabelasDisponiveis, setTabelasDisponiveis] = useState([])
  const [modalPinAberto, setModalPinAberto] = useState(false)
  const [tabelaDestinoId, setTabelaDestinoId] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [motivoTroca, setMotivoTroca] = useState('')
  const [trocandoTabela, setTrocandoTabela] = useState(false)

  // Produtos paginados no backend (SOMENTE itens precificados na tabela ativa)
  const [produtos, setProdutos] = useState([])
  const [contagensEspecie, setContagensEspecie] = useState({})
  const [paginacao, setPaginacao] = useState({ page: 1, limit: 48, total: 0, total_pages: 1 })
  const [especieFiltro, setEspecieFiltro] = useState('TODOS')
  const [buscaInput, setBuscaInput] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [pagina, setPagina] = useState(1)
  const [codigoDireto, setCodigoDireto] = useState('')

  // Modo de Pesagem focado (Tara, Preço e Validade TRAVADOS)
  const [produtoAtivo, setProdutoAtivo] = useState(null)
  const [pesoBrutoInput, setPesoBrutoInput] = useState('')
  const [pesando, setPesando] = useState(false)

  // Etiquetas Geradas no Dia (persistido no banco)
  const [etiquetasDia, setEtiquetasDia] = useState([])

  // Modal preview etiqueta 80x45
  const [etiquetaPreview, setEtiquetaPreview] = useState(null)

  // Entrada de MP
  const [codigoMpInput, setCodigoMpInput] = useState('')
  const [confirmandoMp, setConfirmandoMp] = useState(false)
  const [mpsTransito, setMpsTransito] = useState([])
  const [mpsAbertas, setMpsAbertas] = useState([])

  const inputPesoRef = useRef(null)
  const inputCodigoDiretoRef = useRef(null)
  const inputMpRef = useRef(null)
  const inputPinRef = useRef(null)

  // Debounce de busca (180ms) para resposta ultra fluida
  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounced(buscaInput.trim())
      setPagina(1)
    }, 180)
    return () => clearTimeout(t)
  }, [buscaInput])

  const carregarProdutosPaginados = useCallback(async () => {
    setLoadingProdutos(true)
    try {
      const res = await acougueQueries.listarProdutosPesagem({
        especie: especieFiltro !== 'TODOS' ? especieFiltro : undefined,
        busca: buscaDebounced || undefined,
        page: pagina,
        limit: 48,
      })
      setProdutos(res.data || [])
      setContagensEspecie(res.contagens_especie || {})
      setPaginacao({
        page: Number(res.page || 1),
        limit: Number(res.limit || 48),
        total: Number(res.total ?? (res.data || []).length),
        total_pages: Number(res.total_pages || 1),
      })
      if (res.tabela_ativa) setTabelaAtiva(res.tabela_ativa)
      if (res.em_tabela_alternativa !== undefined) setEmTabelaAlternativa(Boolean(res.em_tabela_alternativa))
      if (res.alterada_por_nome !== undefined) setAlteradaPorNome(res.alterada_por_nome || '')
    } catch (err) {
      toastError('Erro ao carregar cortes da tabela ativa', err.message)
    } finally {
      setLoadingProdutos(false)
    }
  }, [especieFiltro, buscaDebounced, pagina, toastError])

  const carregarOperacaoLateral = useCallback(async () => {
    try {
      const [resEtqsDia, resGer, resTabAtiva] = await Promise.all([
        acougueQueries.listarEtiquetasDia({}),
        acougueQueries.obterGerenciador({ status_etiqueta: 'EM_ESTOQUE' }),
        acougueQueries.obterTabelaAtiva().catch(() => ({})),
      ])
      setEtiquetasDia(resEtqsDia.data || [])
      setMpsTransito(resGer.mps_transito || [])
      setMpsAbertas(resGer.mps_abertas || [])
      if (resTabAtiva?.tabela_ativa) setTabelaAtiva(resTabAtiva.tabela_ativa)
      if (resTabAtiva?.em_tabela_alternativa !== undefined) setEmTabelaAlternativa(Boolean(resTabAtiva.em_tabela_alternativa))
      if (resTabAtiva?.alterada_por_nome !== undefined) setAlteradaPorNome(resTabAtiva.alterada_por_nome || '')
    } catch (err) {
      console.error('Erro auxiliar Açougue:', err)
    }
  }, [])

  useEffect(() => {
    carregarProdutosPaginados()
  }, [carregarProdutosPaginados])

  useEffect(() => {
    carregarOperacaoLateral()
  }, [carregarOperacaoLateral])

  // Abrir Modal de Troca de Tabela via PIN Gerencial
  const abrirModalTrocaTabela = async () => {
    setPinInput('')
    setMotivoTroca('')
    setModalPinAberto(true)
    try {
      const res = await precosQueries.listarTabelas({ apenas_ativas: '1' })
      const lista = res.data || []
      setTabelasDisponiveis(lista)
      const outra = lista.find((t) => t.id !== tabelaAtiva?.id) || lista[0]
      setTabelaDestinoId(outra?.id || '')
    } catch (err) {
      toastError('Erro ao listar tabelas', err.message)
    }
    setTimeout(() => inputPinRef.current?.focus(), 80)
  }

  const handleConfirmarTrocaTabela = async (e) => {
    e.preventDefault()
    if (!tabelaDestinoId) {
      toastWarning('Selecione uma tabela', 'Escolha a tabela de preço que ficará ativa na balança.')
      return
    }
    if (!pinInput.trim()) {
      toastWarning('Informe o PIN Gerencial', 'Digite o PIN numérico de Gerente ou Master para liberar a troca.')
      return
    }
    setTrocandoTabela(true)
    try {
      const res = await acougueQueries.trocarTabelaAtiva({
        tabela_preco_id: tabelaDestinoId,
        pin: pinInput.trim(),
        motivo: motivoTroca.trim(),
      })
      toastSuccess(
        'Tabela ativa alterada!',
        `${res.data?.tabela_ativa?.nome || 'Nova tabela'} (autorizado por ${res.data?.autorizado_por || 'Gerente'})`,
      )
      setModalPinAberto(false)
      setProdutoAtivo(null)
      await Promise.all([carregarProdutosPaginados(), carregarOperacaoLateral()])
    } catch (err) {
      toastError('PIN inválido ou erro na troca', err.message)
    } finally {
      setTrocandoTabela(false)
    }
  }

  const entrarNoModoPesagem = (prod) => {
    setProdutoAtivo(prod)
    setPesoBrutoInput('')
    setTimeout(() => inputPesoRef.current?.focus(), 60)
  }

  const handleEntrarPorCodigoDireto = async (e) => {
    e.preventDefault()
    const cod = codigoDireto.trim()
    if (!cod) return
    const codLower = cod.toLowerCase()
    const semZero = codLower.replace(/^0+/, '') || codLower

    let hit = produtos.find(
      (p) =>
        String(p.codigo || '').toLowerCase() === codLower ||
        String(p.codigo || '').replace(/^0+/, '').toLowerCase() === semZero ||
        String(p.codigo_balanca || '').toLowerCase() === codLower,
    )
    if (!hit) {
      try {
        const res = await acougueQueries.listarProdutosPesagem({ codigo: cod, limit: 12 })
        const lista = res.data || []
        hit = lista[0]
        if (!hit) {
          const res2 = await acougueQueries.listarProdutosPesagem({ busca: cod, limit: 12 })
          const lista2 = res2.data || []
          hit =
            lista2.find(
              (p) =>
                String(p.codigo || '').toLowerCase() === codLower ||
                String(p.codigo || '').replace(/^0+/, '').toLowerCase() === semZero,
            ) || lista2[0]
        }
      } catch {
        /* ignore */
      }
    }
    if (!hit) {
      toastWarning(
        'Código não encontrado na tabela ativa',
        `Nenhum corte com preço na tabela "${tabelaAtiva?.nome || 'ativa'}" corresponde a "${cod}".`,
      )
      return
    }
    setCodigoDireto('')
    entrarNoModoPesagem(hit)
  }

  // Valores TRAVADOS provenientes do cadastro do produto e da tabela ativa
  const taraTravadaKg = Number(produtoAtivo?.tara_embalagem_kg || 0)
  const precoTravadoKg = Number(produtoAtivo?.preco_kg ?? produtoAtivo?.preco_venda_kg ?? 0)
  const validadeDiasTravada = Math.max(0, Number(produtoAtivo?.validade_dias ?? 5))
  const validadeCalculadaIso = useMemo(() => {
    if (!produtoAtivo) return ''
    const dt = new Date(Date.now() + validadeDiasTravada * 86_400_000)
    return dt.toISOString().slice(0, 10)
  }, [produtoAtivo, validadeDiasTravada])

  const pesoBrutoNum = Number(String(pesoBrutoInput || '0').replace(',', '.'))
  const pesoLiquidoNum = Number(
    Math.max(0, (Number.isFinite(pesoBrutoNum) ? pesoBrutoNum : 0) - taraTravadaKg).toFixed(3),
  )
  const valorTotalCalc = Number((pesoLiquidoNum * precoTravadoKg).toFixed(2))

  const handlePesarGerarEtiqueta = async (e) => {
    e.preventDefault()
    if (!produtoAtivo) return
    if (pesoLiquidoNum <= 0) {
      toastWarning('Informe o peso', 'Digite o peso da balança maior que a tara da embalagem.')
      return
    }
    setPesando(true)
    try {
      // Tara, Preço e Validade são garantidos no servidor a partir do cadastro + tabela ativa
      const res = await acougueQueries.pesarEtiqueta({
        produto_id: produtoAtivo.id,
        peso_bruto_kg: pesoBrutoNum,
      })
      const etq = res.data
      setEtiquetasDia((prev) => [etq, ...prev])
      setPesoBrutoInput('')

      // Atualiza saldo de MP local do produto ativo sem recarregar todo o catálogo
      if (etq.mp_baixada_ean) {
        setProdutoAtivo((prev) =>
          prev
            ? {
                ...prev,
                saldo_mp_disponivel_kg: Math.max(0, Number(prev.saldo_mp_disponivel_kg || 0) - Number(etq.peso_kg || 0)),
              }
            : prev,
        )
      }

      toastSuccess(
        `Etiqueta ${etq.codigo_etiqueta} gerada!`,
        `${etq.descricao} • ${fmtKg(etq.peso_kg)} • ${fmtMoeda(etq.valor_total)}${
          etq.mp_baixada_ean ? ` (MP ${etq.mp_baixada_ean} baixada)` : ''
        }`,
      )

      const cfg = lerConfigEstacao()
      if (cfg.imprimirAutoAoSalvar) {
        imprimirEtiqueta80x45Html(etq, 'PDV', 1)
      } else {
        setEtiquetaPreview(etq)
      }

      // Atualiza apenas a fila de MPs em segundo plano (leve)
      acougueQueries
        .obterGerenciador({ status_etiqueta: 'EM_ESTOQUE' })
        .then((resGer) => {
          setMpsTransito(resGer.mps_transito || [])
          setMpsAbertas(resGer.mps_abertas || [])
        })
        .catch(() => {})

      setTimeout(() => inputPesoRef.current?.focus(), 70)
    } catch (err) {
      toastError('Erro ao gerar etiqueta', err.message)
    } finally {
      setPesando(false)
    }
  }

  const handleCancelarEtiqueta = async (etq) => {
    try {
      await acougueQueries.cancelarEtiqueta(etq.id)
      setEtiquetasDia((prev) => prev.filter((x) => x.id !== etq.id))
      toastSuccess(`Etiqueta ${etq.codigo_etiqueta} cancelada`, 'Peso devolvido à Matéria-Prima de origem.')
      carregarOperacaoLateral()
    } catch (err) {
      toastError('Erro ao cancelar etiqueta', err.message)
    }
  }

  const handleEntradaMp = async (codigoOverride = null) => {
    const cod = String(codigoOverride ?? codigoMpInput).trim()
    if (!cod) return
    setConfirmandoMp(true)
    try {
      const res = await acougueQueries.darEntradaMp(cod)
      toastSuccess(
        'Matéria-Prima aberta no Açougue!',
        `${res.data.produto_descricao} — ${fmtKg(res.data.peso_kg)} pronta para baixa automática na pesagem.`,
      )
      setCodigoMpInput('')
      await carregarOperacaoLateral()
      setTimeout(() => inputMpRef.current?.focus(), 60)
    } catch (err) {
      toastError('Falha na entrada de MP', err.message)
    } finally {
      setConfirmandoMp(false)
    }
  }

  const ehTabelaAlternativa = Boolean(emTabelaAlternativa || (tabelaAtiva && !tabelaAtiva.padrao))

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Scale size={20} className="text-primary" /> Açougue — Pesagem &amp; Entrada de MP
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Pesagem controlada com tara, validade e preço travados pela Tabela Ativa e geração de etiqueta QR 80×45
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${aba === 'PESAGEM' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setAba('PESAGEM')}
          >
            <Scale size={15} /> Pesagem de Produtos
          </button>
          <button
            type="button"
            className={`btn ${aba === 'ENTRADA_MP' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => {
              setAba('ENTRADA_MP')
              setTimeout(() => inputMpRef.current?.focus(), 60)
            }}
          >
            <ScanBarcode size={15} /> Entrada de MP
            {mpsTransito.length > 0 && (
              <span className="badge badge--warning" style={{ marginLeft: 4 }}>
                {mpsTransito.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => {
              carregarProdutosPaginados()
              carregarOperacaoLateral()
            }}
            title="Atualizar"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* BARRA DE TABELA DE PREÇO ATIVA (COM TROCA PROTEGIDA POR PIN GERENCIAL) */}
      <div
        className="card"
        style={{
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          background: ehTabelaAlternativa ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-2)',
          border: `1px solid ${ehTabelaAlternativa ? 'rgba(245, 158, 11, 0.5)' : 'var(--border)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {ehTabelaAlternativa ? (
            <AlertTriangle size={17} color="#f59e0b" />
          ) : (
            <Tag size={16} className="text-primary" />
          )}
          <div style={{ fontSize: 13 }}>
            <span className="text-muted">Tabela Ativa na Balança: </span>
            <strong style={{ color: ehTabelaAlternativa ? '#fbbf24' : '#f8fafc' }}>
              {tabelaAtiva ? `${tabelaAtiva.codigo} — ${tabelaAtiva.nome}` : 'Carregando...'}
            </strong>
            {ehTabelaAlternativa && (
              <span className="badge badge--warning" style={{ marginLeft: 8, fontSize: 10 }}>
                TABELA ALTERNATIVA EM USO
              </span>
            )}
          </div>
          {alteradaPorNome && (
            <span className="text-xs text-muted">
              (Última troca autorizada por {alteradaPorNome})
            </span>
          )}
        </div>

        <button
          type="button"
          className={`btn btn--sm ${ehTabelaAlternativa ? 'btn--warning' : 'btn--secondary'}`}
          onClick={abrirModalTrocaTabela}
        >
          <KeyRound size={13} /> {ehTabelaAlternativa ? 'Voltar / Trocar Tabela (PIN)' : 'Alterar Tabela Ativa (PIN)'}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 1: PESAGEM DE PRODUTOS (PAGINADO + SOMENTE ITENS PRECIFICADOS)      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'PESAGEM' && !produtoAtivo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ESPECIES_TABS.map((tab) => {
                  const ativo = especieFiltro === tab.id
                  const qtd = contagensEspecie[tab.id] ?? 0
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`btn btn--sm ${ativo ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => {
                        setEspecieFiltro(tab.id)
                        setPagina(1)
                      }}
                    >
                      {tab.label} <span style={{ opacity: 0.75, fontSize: 11 }}>({qtd})</span>
                    </button>
                  )
                })}
              </div>

              <div style={{ position: 'relative', minWidth: 260, flex: '0 1 340px' }}>
                <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 34, height: 38 }}
                  placeholder="Pesquisar corte ou código..."
                  value={buscaInput}
                  onChange={(e) => setBuscaInput(e.target.value)}
                />
              </div>
            </div>

            {loadingProdutos ? (
              <div className="text-center text-muted p-24">Carregando cortes da tabela ativa...</div>
            ) : produtos.length === 0 ? (
              <div className="text-center text-muted p-32">
                Nenhum produto com preço cadastrado na tabela <strong>{tabelaAtiva?.nome || 'ativa'}</strong> para este filtro.
                <div className="text-xs mt-6">
                  Cadastre os preços dos cortes no módulo <strong>Tabelas de Preço</strong>.
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))',
                    gap: 10,
                    maxHeight: '50vh',
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {produtos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => entrarNoModoPesagem(p)}
                      style={{
                        textAlign: 'left',
                        padding: 13,
                        borderRadius: 10,
                        background: 'var(--bg-2)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span className="font-mono text-xs font-bold" style={{ color: '#60a5fa' }}>
                            CÓD {p.codigo || p.codigo_balanca || '-'}
                          </span>
                          <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                            {p.especie || 'OUTROS'}
                          </span>
                        </div>
                        <div className="font-bold text-sm" style={{ marginTop: 6, lineHeight: 1.25 }}>
                          {p.descricao}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <div className="text-xs text-muted">
                          <div>{p.conservacao || 'RESFRIADO'} • Val {p.validade_dias ?? 5}d</div>
                          <div style={{ color: Number(p.saldo_mp_disponivel_kg || 0) > 0 ? '#22c55e' : '#94a3b8' }}>
                            MP Disp: {fmtKg(p.saldo_mp_disponivel_kg || 0)}
                          </div>
                        </div>
                        <div className="font-mono font-bold text-success" style={{ fontSize: 15 }}>
                          {fmtMoeda(p.preco_kg ?? p.preco_venda_kg ?? 0)}
                          <span style={{ fontSize: 10, opacity: 0.8 }}>/kg</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* PAGINAÇÃO */}
                {paginacao.total_pages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12 }}>
                    <span className="text-muted">
                      Mostrando {produtos.length} de <strong>{paginacao.total}</strong> produto(s) com preço na tabela ativa
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={pagina <= 1}
                        onClick={() => setPagina((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft size={14} /> Anterior
                      </button>
                      <span className="font-mono text-xs">
                        Pág. {paginacao.page} / {paginacao.total_pages}
                      </span>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={pagina >= paginacao.total_pages}
                        onClick={() => setPagina((p) => Math.min(paginacao.total_pages, p + 1))}
                      >
                        Próxima <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ACESSO RÁPIDO POR CÓDIGO */}
          <form
            onSubmit={handleEntrarPorCodigoDireto}
            className="card"
            style={{
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              background: 'var(--bg-1)',
              border: '1px solid rgba(59,130,246,0.35)',
            }}
          >
            <div className="text-xs font-bold uppercase text-primary" style={{ whiteSpace: 'nowrap' }}>
              Acesso Rápido por Código:
            </div>
            <input
              ref={inputCodigoDiretoRef}
              type="text"
              className="form-input font-mono"
              style={{ maxWidth: 260, height: 40, fontSize: 15, fontWeight: 700 }}
              placeholder="Digite o código + Enter..."
              value={codigoDireto}
              onChange={(e) => setCodigoDireto(e.target.value)}
            />
            <button type="submit" className="btn btn--primary">
              Entrar no Produto
            </button>
            <div className="text-xs text-muted" style={{ marginLeft: 'auto' }}>
              Exibindo somente cortes precificados na tabela <strong>{tabelaAtiva?.nome || 'ativa'}</strong>.
            </div>
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODO DE PESAGEM FOCADO (SOMENTE PESO EDITÁVEL; TARA/PREÇO/VAL TRAVADOS) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'PESAGEM' && produtoAtivo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span className="badge badge--info font-mono">CÓD {produtoAtivo.codigo || '-'}</span>
                  <span className="badge badge--neutral">{produtoAtivo.especie}</span>
                  <span className="badge badge--neutral">
                    <Snowflake size={11} /> {produtoAtivo.conservacao}
                  </span>
                </div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{produtoAtivo.descricao}</h2>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Saldo de Matéria-Prima aberta disponível para baixa automática (FEFO):{' '}
                  <strong style={{ color: Number(produtoAtivo.saldo_mp_disponivel_kg || 0) > 0 ? '#22c55e' : '#f59e0b' }}>
                    {fmtKg(produtoAtivo.saldo_mp_disponivel_kg || 0)}
                  </strong>
                </div>
              </div>

              <button
                type="button"
                className="btn btn--secondary"
                style={{ height: 42, fontWeight: 700, whiteSpace: 'nowrap' }}
                onClick={() => {
                  setProdutoAtivo(null)
                  setTimeout(() => inputCodigoDiretoRef.current?.focus(), 60)
                }}
              >
                <ArrowLeftRight size={16} /> Trocar Produto
              </button>
            </div>

            <form onSubmit={handlePesarGerarEtiqueta} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* CAMPO PRINCIPAL ÚNICO EDITÁVEL: PESO DA BALANÇA */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                  Peso da Balança (kg) *
                </label>
                <input
                  ref={inputPesoRef}
                  type="number"
                  step="0.001"
                  min="0.001"
                  className="form-input font-mono"
                  style={{ height: 64, fontSize: 34, fontWeight: 900, textAlign: 'right', color: '#38bdf8' }}
                  placeholder="0,000"
                  value={pesoBrutoInput}
                  onChange={(e) => setPesoBrutoInput(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* CAMPOS TRAVADOS (READ-ONLY: TARA DO CADASTRO, PREÇO DA TABELA ATIVA, VALIDADE DO CADASTRO) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted flex items-center gap-4">
                    <Lock size={11} /> Tara da Embalagem
                  </div>
                  <div className="font-mono font-bold" style={{ fontSize: 17, marginTop: 3 }}>
                    {taraTravadaKg.toFixed(4).replace('.', ',')} kg
                  </div>
                  <div className="text-xs text-muted" style={{ fontSize: 10.5 }}>
                    ({(taraTravadaKg * 1000).toFixed(0)}g • Cadastro do Produto)
                  </div>
                </div>

                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted flex items-center gap-4">
                    <Lock size={11} /> Preço de Venda
                  </div>
                  <div className="font-mono font-bold text-success" style={{ fontSize: 17, marginTop: 3 }}>
                    {fmtMoeda(precoTravadoKg)}/kg
                  </div>
                  <div className="text-xs text-muted truncate" style={{ fontSize: 10.5 }}>
                    {tabelaAtiva?.nome || 'Tabela Ativa'}
                  </div>
                </div>

                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted flex items-center gap-4">
                    <Lock size={11} /> Validade Automática
                  </div>
                  <div className="font-mono font-bold" style={{ fontSize: 17, marginTop: 3 }}>
                    {fmtDataBR(validadeCalculadaIso)}
                  </div>
                  <div className="text-xs text-muted" style={{ fontSize: 10.5 }}>
                    ({validadeDiasTravada} dia(s) • Cadastro do Produto)
                  </div>
                </div>
              </div>

              {/* RESUMO EM DESTAQUE */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  padding: 16,
                  borderRadius: 12,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <div className="text-xs text-muted uppercase">Peso Líquido Final</div>
                  <div className="font-mono font-bold" style={{ fontSize: 26, color: '#f8fafc' }}>
                    {fmtKg(pesoLiquidoNum)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="text-xs text-muted uppercase">Valor na Etiqueta QR</div>
                  <div className="font-mono font-bold" style={{ fontSize: 28, color: '#22c55e' }}>
                    {fmtMoeda(valorTotalCalc)}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn--success"
                style={{ height: 56, fontSize: 17, fontWeight: 800 }}
                disabled={pesando || pesoLiquidoNum <= 0}
              >
                <QrCode size={20} /> {pesando ? 'Gerando Etiqueta...' : 'Pesar, Baixar MP & Gerar Etiqueta 80×45 QR (Enter)'}
              </button>
            </form>
          </div>

          {/* ETIQUETAS GERADAS NO DIA */}
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="font-bold text-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Etiquetas Geradas no Dia ({etiquetasDia.length})</span>
            </div>
            <div style={{ maxHeight: 450, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {etiquetasDia.length === 0 ? (
                <div className="text-xs text-muted text-center p-24">
                  As etiquetas geradas hoje aparecem aqui para reimpressão ou cancelamento imediato.
                </div>
              ) : (
                etiquetasDia.map((etq) => (
                  <div
                    key={etq.id}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: 'var(--bg-2)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="font-mono font-bold text-xs text-info">{etq.codigo_etiqueta}</span>
                        <span className="font-mono font-bold text-xs">{fmtKg(etq.peso_kg ?? etq.peso_liquido_kg)}</span>
                        <span className="font-mono font-bold text-xs text-success">{fmtMoeda(etq.valor_total)}</span>
                      </div>
                      <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {etq.descricao || etq.produto_descricao}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        title="Ver / Imprimir Etiqueta 80×45"
                        onClick={() => setEtiquetaPreview(etq)}
                      >
                        <Printer size={13} />
                      </button>
                      {(!etq.status || etq.status === 'EM_ESTOQUE') && (
                        <button
                          type="button"
                          className="btn-icon text-danger"
                          title="Cancelar etiqueta e estornar MP"
                          onClick={() => handleCancelarEtiqueta(etq)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 2: ENTRADA DE MATÉRIA-PRIMA NO AÇOUGUE                              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'ENTRADA_MP' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="font-bold text-sm mb-8" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ScanBarcode size={18} className="text-primary" /> Entrada de Matéria-Prima no Açougue
            </div>
            <div className="text-xs text-muted mb-12">
              Bipe a etiqueta da caixa transferida do estoque. Ela entra como <strong>MP Aberta no Açougue</strong> pronta para baixa automática durante a pesagem.
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleEntradaMp()
              }}
              style={{ display: 'flex', gap: 8, maxWidth: 620 }}
            >
              <input
                ref={inputMpRef}
                type="text"
                className="form-input font-mono"
                style={{ height: 46, fontSize: 16, fontWeight: 700 }}
                placeholder="Bipe o código de barras (EAN) da caixa transferida..."
                value={codigoMpInput}
                onChange={(e) => setCodigoMpInput(e.target.value)}
                autoFocus
              />
              <button type="submit" className="btn btn--success" style={{ height: 46 }} disabled={confirmandoMp}>
                <CheckCircle2 size={17} /> {confirmandoMp ? 'Confirmando...' : 'Confirmar Entrada'}
              </button>
            </form>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="font-bold text-sm mb-10" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={16} className="text-warning" /> Matérias-Primas Aguardando Entrada ({mpsTransito.length})
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Etiqueta (EAN)</th>
                  <th>Produto</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Peso</th>
                  <th style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {mpsTransito.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted p-20">
                      Nenhuma caixa aguardando entrada no Açougue.
                    </td>
                  </tr>
                ) : (
                  mpsTransito.map((mp) => (
                    <tr key={mp.id}>
                      <td className="font-mono font-bold text-warning">{mp.ean_caixa}</td>
                      <td className="font-bold">{mp.produto_descricao}</td>
                      <td className="font-mono text-xs">{mp.lote || '-'}</td>
                      <td className="font-mono font-bold" style={{ textAlign: 'right' }}>{fmtKg(mp.peso_kg)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn--success btn--sm"
                          onClick={() => handleEntradaMp(mp.ean_caixa)}
                        >
                          Confirmar Entrada
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div className="font-bold text-sm mb-10" style={{ color: '#22c55e' }}>
              Matérias-Primas Abertas em Uso no Açougue ({mpsAbertas.length})
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Etiqueta (EAN)</th>
                  <th>Produto</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Peso Original</th>
                  <th style={{ textAlign: 'right' }}>Saldo Restante</th>
                </tr>
              </thead>
              <tbody>
                {mpsAbertas.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted p-20">
                      Nenhuma matéria-prima aberta no momento.
                    </td>
                  </tr>
                ) : (
                  mpsAbertas.map((mp) => (
                    <tr key={mp.id}>
                      <td className="font-mono font-bold text-info">{mp.ean_caixa}</td>
                      <td className="font-bold">{mp.produto_descricao}</td>
                      <td className="font-mono text-xs">{mp.lote || '-'}</td>
                      <td className="font-mono" style={{ textAlign: 'right' }}>{fmtKg(mp.peso_kg)}</td>
                      <td className="font-mono font-bold text-success" style={{ textAlign: 'right' }}>
                        {fmtKg(mp.peso_restante_kg)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL TROCAR TABELA ATIVA VIA PIN GERENCIAL */}
      {modalPinAberto && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalPinAberto(false)}>
          <div className="modal" style={{ maxWidth: 460, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={16} className="text-warning" /> Alterar Tabela de Preço Ativa
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalPinAberto(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleConfirmarTrocaTabela} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="text-xs text-muted">
                A tabela selecionada permanecerá ativa para todas as próximas pesagens até ser revertida mediante nova autorização por PIN Gerencial.
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tabela de Preço de Destino *</label>
                <select
                  className="form-input"
                  value={tabelaDestinoId}
                  onChange={(e) => setTabelaDestinoId(e.target.value)}
                  required
                >
                  {tabelasDisponiveis.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.codigo} — {t.nome} ({t.total_itens ?? t.qtd_itens ?? 0} itens){t.padrao ? ' ★ Padrão' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">PIN Gerencial / Master (4 a 6 dígitos) *</label>
                <input
                  ref={inputPinRef}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  className="form-input font-mono text-center"
                  style={{ height: 48, fontSize: 24, letterSpacing: 10, fontWeight: 900 }}
                  placeholder="••••"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Motivo (Opcional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: Promoção de fim de semana"
                  value={motivoTroca}
                  onChange={(e) => setMotivoTroca(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalPinAberto(false)}>Cancelar</button>
                <button type="submit" className="btn btn--warning" disabled={trocandoTabela}>
                  <KeyRound size={15} /> {trocandoTabela ? 'Validando PIN...' : 'Autorizar & Ativar Tabela'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalEtiquetaZebra80x45
        aberto={Boolean(etiquetaPreview)}
        onClose={() => setEtiquetaPreview(null)}
        dados={etiquetaPreview}
        modo="PDV"
        toastSuccess={toastSuccess}
      />
    </div>
  )
}
