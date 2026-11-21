import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  CheckCircle2,
  Package,
  Printer,
  QrCode,
  RefreshCw,
  Scale,
  ScanBarcode,
  Search,
  Snowflake,
  Trash2,
} from 'lucide-react'
import { acougueQueries } from '../queries/varejo'
import { useAppStore } from '../store/appStore'
import {
  ModalEtiquetaZebra80x45,
  imprimirEtiqueta80x45Html,
} from '../components/shared/EtiquetaZebra80x45'
import { lerConfigEstacao } from '../utils/estacaoConfig'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v) => `${Number(v || 0).toFixed(3).replace('.', ',')} kg`

const ESPECIES_TABS = [
  { id: 'TODOS', label: 'Consolidado' },
  { id: 'BOVINO', label: 'Bovinos' },
  { id: 'SUINO', label: 'Suínos' },
  { id: 'AVES', label: 'Aves' },
  { id: 'EMPORIO', label: 'Empório' },
  { id: 'OUTROS', label: 'Outros' },
]

export function AcougueOperacao() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [aba, setAba] = useState('PESAGEM') // 'PESAGEM' | 'ENTRADA_MP'
  const [loading, setLoading] = useState(true)

  // Produtos para pesagem
  const [produtos, setProdutos] = useState([])
  const [especieFiltro, setEspecieFiltro] = useState('TODOS')
  const [busca, setBusca] = useState('')
  const [codigoDireto, setCodigoDireto] = useState('')

  // Modo de Pesagem focado
  const [produtoAtivo, setProdutoAtivo] = useState(null)
  const [pesoBrutoInput, setPesoBrutoInput] = useState('')
  const [taraInput, setTaraInput] = useState('0')
  const [precoKgInput, setPrecoKgInput] = useState('')
  const [validadeInput, setValidadeInput] = useState('')
  const [pesando, setPesando] = useState(false)
  const [etiquetasSessao, setEtiquetasSessao] = useState([])

  // Modal preview etiqueta 80x45
  const [etiquetaPreview, setEtiquetaPreview] = useState(null)

  // Entrada de MP (2º Bip)
  const [codigoMpInput, setCodigoMpInput] = useState('')
  const [confirmandoMp, setConfirmandoMp] = useState(false)
  const [mpsTransito, setMpsTransito] = useState([])
  const [mpsAbertas, setMpsAbertas] = useState([])

  const inputPesoRef = useRef(null)
  const inputCodigoDiretoRef = useRef(null)
  const inputMpRef = useRef(null)

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const [resProds, resGer] = await Promise.all([
        acougueQueries.listarProdutosPesagem({}),
        acougueQueries.obterGerenciador({}),
      ])
      setProdutos(resProds.data || [])
      setMpsTransito(resGer.mps_transito || [])
      setMpsAbertas(resGer.mps_abertas || [])
    } catch (err) {
      toastError('Erro ao carregar Açougue', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  const entrarNoModoPesagem = (prod) => {
    const hoje = new Date()
    const valDt = new Date(hoje.getTime() + Math.max(0, Number(prod.validade_dias ?? 5)) * 86_400_000)
    const valIso = valDt.toISOString().slice(0, 10)
    setProdutoAtivo(prod)
    setPesoBrutoInput('')
    setTaraInput(String(Number(prod.tara_embalagem_kg || 0).toFixed(4)))
    setPrecoKgInput(Number(prod.preco_kg ?? prod.preco_venda_kg ?? 0).toFixed(2))
    setValidadeInput(valIso)
    setTimeout(() => inputPesoRef.current?.focus(), 60)
  }

  const produtosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return produtos.filter((p) => {
      if (especieFiltro !== 'TODOS' && String(p.especie || 'OUTROS').toUpperCase() !== especieFiltro) {
        return false
      }
      if (!q) return true
      return (
        String(p.descricao || '').toLowerCase().includes(q) ||
        String(p.codigo || '').toLowerCase().includes(q) ||
        String(p.codigo_balanca || '').toLowerCase().includes(q)
      )
    })
  }, [produtos, especieFiltro, busca])

  const handleEntrarPorCodigoDireto = (e) => {
    e.preventDefault()
    const cod = codigoDireto.trim().toLowerCase()
    if (!cod) return
    const semZero = cod.replace(/^0+/, '') || cod
    const hit = produtos.find(
      (p) =>
        String(p.codigo || '').toLowerCase() === cod ||
        String(p.codigo || '').replace(/^0+/, '').toLowerCase() === semZero ||
        String(p.codigo_balanca || '').toLowerCase() === cod ||
        String(p.codigo_balanca || '').replace(/^0+/, '').toLowerCase() === semZero,
    )
    if (!hit) {
      toastWarning('Código não encontrado', `Nenhum produto cadastrado com código "${codigoDireto}".`)
      return
    }
    setCodigoDireto('')
    entrarNoModoPesagem(hit)
  }

  const pesoBrutoNum = Number(String(pesoBrutoInput || '0').replace(',', '.'))
  const taraNum = Number(String(taraInput || '0').replace(',', '.'))
  const pesoLiquidoNum = Number(Math.max(0, (Number.isFinite(pesoBrutoNum) ? pesoBrutoNum : 0) - (Number.isFinite(taraNum) ? taraNum : 0)).toFixed(3))
  const precoKgNum = Number(String(precoKgInput || '0').replace(',', '.'))
  const valorTotalCalc = Number((pesoLiquidoNum * (Number.isFinite(precoKgNum) ? precoKgNum : 0)).toFixed(2))

  const handlePesarGerarEtiqueta = async (e) => {
    e.preventDefault()
    if (!produtoAtivo) return
    if (pesoLiquidoNum <= 0) {
      toastWarning('Informe o peso', 'Digite o peso da balança maior que a tara da embalagem.')
      return
    }
    setPesando(true)
    try {
      const res = await acougueQueries.pesarEtiqueta({
        produto_id: produtoAtivo.id,
        peso_bruto_kg: pesoBrutoNum,
        tara_kg: taraNum,
        preco_kg: precoKgNum,
        validade: validadeInput || undefined,
      })
      const etq = res.data
      setEtiquetasSessao((prev) => [etq, ...prev.slice(0, 29)])
      setPesoBrutoInput('')

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

      // Atualiza saldo de MP em background sem tirar o foco do campo de peso
      carregarDados()
      setTimeout(() => inputPesoRef.current?.focus(), 80)
    } catch (err) {
      toastError('Erro ao gerar etiqueta', err.message)
    } finally {
      setPesando(false)
    }
  }

  const handleCancelarEtiqueta = async (etq) => {
    try {
      await acougueQueries.cancelarEtiqueta(etq.id)
      setEtiquetasSessao((prev) => prev.filter((x) => x.id !== etq.id))
      toastSuccess(`Etiqueta ${etq.codigo_etiqueta} cancelada`, 'Peso devolvido à Matéria-Prima de origem.')
      await carregarDados()
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
      await carregarDados()
      setTimeout(() => inputMpRef.current?.focus(), 60)
    } catch (err) {
      toastError('Falha na entrada de MP', err.message)
    } finally {
      setConfirmandoMp(false)
    }
  }

  // Atualiza referência do produtoAtivo quando recarrega saldos de MP
  const produtoAtivoAtual = useMemo(() => {
    if (!produtoAtivo) return null
    return produtos.find((p) => p.id === produtoAtivo.id) || produtoAtivo
  }, [produtos, produtoAtivo])

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Scale size={20} className="text-primary" /> Açougue — Operação &amp; Pesagem
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Entrada de Matéria-Prima (2º Bip) e pesagem rápida com geração de etiqueta QR 80×45 e baixa automática de MP
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
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
            <ScanBarcode size={15} /> Entrada de MP (2º Bip)
            {mpsTransito.length > 0 && (
              <span className="badge badge--warning" style={{ marginLeft: 4 }}>
                {mpsTransito.length}
              </span>
            )}
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={carregarDados} title="Atualizar">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 1: PESAGEM DE PRODUTOS (CATÁLOGO DINÂMICO OU MODO DE PESAGEM)      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'PESAGEM' && !produtoAtivoAtual && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* FILTROS POR ESPÉCIE + BUSCA DINÂMICA */}
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ESPECIES_TABS.map((tab) => {
                  const ativo = especieFiltro === tab.id
                  const qtd =
                    tab.id === 'TODOS'
                      ? produtos.length
                      : produtos.filter((p) => String(p.especie || 'OUTROS').toUpperCase() === tab.id).length
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`btn btn--sm ${ativo ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setEspecieFiltro(tab.id)}
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
                  placeholder="Pesquisar corte ou produto..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>

            {/* GRADE ELEGANTE DE PRODUTOS */}
            {loading ? (
              <div className="text-center text-muted p-24">Carregando produtos...</div>
            ) : produtosFiltrados.length === 0 ? (
              <div className="text-center text-muted p-32">
                Nenhum produto encontrado neste filtro. Cadastre ou classifique em <strong>Consulta e Produtos</strong>.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                  gap: 10,
                  maxHeight: '54vh',
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {produtosFiltrados.map((p) => (
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
                        {fmtMoeda(p.preco_kg ?? p.preco_venda_kg ?? 0)}<span style={{ fontSize: 10, opacity: 0.8 }}>/kg</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CAMPO INFERIOR DE ENTRADA DIRETA POR CÓDIGO */}
          <form
            onSubmit={handleEntrarPorCodigoDireto}
            className="card"
            style={{
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
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
              Todos os produtos vêm do cadastro global único de <strong>Produtos</strong>.
            </div>
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODO DE PESAGEM FOCADO (QUANDO O AÇOUGUEIRO ENTRA NO PRODUTO)          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'PESAGEM' && produtoAtivoAtual && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(300px, 1fr)', gap: 16, alignItems: 'start' }}>
          {/* PAINEL DE PESAGEM */}
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span className="badge badge--info font-mono">CÓD {produtoAtivoAtual.codigo || '-'}</span>
                  <span className="badge badge--neutral">{produtoAtivoAtual.especie}</span>
                  <span className="badge badge--neutral">
                    <Snowflake size={11} /> {produtoAtivoAtual.conservacao}
                  </span>
                </div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{produtoAtivoAtual.descricao}</h2>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Saldo de Matéria-Prima aberta disponível para baixa automática (FEFO):{' '}
                  <strong style={{ color: Number(produtoAtivoAtual.saldo_mp_disponivel_kg || 0) > 0 ? '#22c55e' : '#f59e0b' }}>
                    {fmtKg(produtoAtivoAtual.saldo_mp_disponivel_kg || 0)}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8' }}>
                    Peso da Balança (kg) — Manual *
                  </label>
                  <input
                    ref={inputPesoRef}
                    type="number"
                    step="0.001"
                    min="0.001"
                    className="form-input font-mono"
                    style={{ height: 60, fontSize: 30, fontWeight: 900, textAlign: 'right', color: '#38bdf8' }}
                    placeholder="0,000"
                    value={pesoBrutoInput}
                    onChange={(e) => setPesoBrutoInput(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tara da Embalagem (kg)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    className="form-input font-mono text-right"
                    style={{ height: 60, fontSize: 20, fontWeight: 700 }}
                    value={taraInput}
                    onChange={(e) => setTaraInput(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Preço de Venda (R$/kg)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input font-mono text-right"
                    style={{ height: 42, fontSize: 16, fontWeight: 700 }}
                    value={precoKgInput}
                    onChange={(e) => setPrecoKgInput(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Validade ({produtoAtivoAtual.validade_dias ?? 5} dias padrão)</label>
                  <input
                    type="date"
                    className="form-input font-mono"
                    style={{ height: 42 }}
                    value={validadeInput}
                    onChange={(e) => setValidadeInput(e.target.value)}
                  />
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

          {/* HISTÓRICO DA SESSÃO DE PESAGEM */}
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="font-bold text-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Etiquetas Geradas Agora ({etiquetasSessao.length})</span>
            </div>
            <div style={{ maxHeight: 430, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {etiquetasSessao.length === 0 ? (
                <div className="text-xs text-muted text-center p-24">
                  As etiquetas pesadas aparecem aqui para reimpressão ou cancelamento imediato.
                </div>
              ) : (
                etiquetasSessao.map((etq) => (
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="font-mono font-bold text-xs text-info">{etq.codigo_etiqueta}</span>
                        <span className="font-mono font-bold text-xs">{fmtKg(etq.peso_kg)}</span>
                        <span className="font-mono font-bold text-xs text-success">{fmtMoeda(etq.valor_total)}</span>
                      </div>
                      <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {etq.descricao}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        title="Ver / Imprimir Etiqueta 80x45"
                        onClick={() => setEtiquetaPreview(etq)}
                      >
                        <Printer size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon text-danger"
                        title="Cancelar etiqueta e estornar MP"
                        onClick={() => handleCancelarEtiqueta(etq)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 2: ENTRADA DE MATÉRIA-PRIMA NO AÇOUGUE (2º BIP DA ETIQUETA VIVA)   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'ENTRADA_MP' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="font-bold text-sm mb-8" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ScanBarcode size={18} className="text-primary" /> Bipar Etiqueta Transferida (2º Bip — Entrada no Açougue)
            </div>
            <div className="text-xs text-muted mb-12">
              Bipe a mesma etiqueta da caixa que saiu do Estoque na Transferência. Ela entra como <strong>MP Aberta no Açougue</strong> pronta para baixa automática durante a pesagem.
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

          {/* AGUARDANDO 2º BIP */}
          <div className="card" style={{ padding: 16 }}>
            <div className="font-bold text-sm mb-10" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={16} className="text-warning" /> Matérias-Primas Aguardando 2º Bip ({mpsTransito.length})
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
                      Nenhuma caixa em trânsito aguardando entrada no Açougue.
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
                          Confirmar 2º Bip
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* MPs ABERTAS NO AÇOUGUE */}
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
