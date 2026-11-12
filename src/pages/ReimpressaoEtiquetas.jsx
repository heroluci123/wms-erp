import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Printer, Search, Tag, RefreshCw, Download, ScanBarcode,
  CheckCircle2, Package, History, ShieldCheck, ExternalLink, Layers,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { tarasQueries } from '../queries/taras'
import {
  EtiquetaZebraCard,
  EtiquetaZebraModal,
  baixarZplEtiquetas,
} from '../components/shared/EtiquetaZebraPrint'
import { fmtDataBR, fmtDataHoraBR, fmtKg2, fmtKg3 } from '../utils/rastreabilidade'

const ORIGEM_BADGE = {
  RECEBIMENTO: { label: 'Recebimento', bg: 'rgba(56, 189, 248, 0.16)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' },
  INVENTARIO: { label: 'Inventário', bg: 'rgba(168, 85, 247, 0.16)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.35)' },
  CARGA_INICIAL: { label: 'Carga Inicial', bg: 'rgba(168, 85, 247, 0.16)', color: '#c084fc', border: 'rgba(168, 85, 247, 0.35)' },
  DESMEMBRAMENTO: { label: 'Desmembramento', bg: 'rgba(20, 184, 166, 0.16)', color: '#2dd4bf', border: 'rgba(20, 184, 166, 0.35)' },
  PRODUCAO: { label: 'Produção / OP', bg: 'rgba(249, 115, 22, 0.16)', color: '#fb923c', border: 'rgba(249, 115, 22, 0.35)' },
  OP: { label: 'Produção / OP', bg: 'rgba(249, 115, 22, 0.16)', color: '#fb923c', border: 'rgba(249, 115, 22, 0.35)' },
}

const STATUS_COR = {
  DISPONIVEL: '#4ade80',
  SEPARACAO: '#facc15',
  CONSUMIDA: '#fb923c',
  EXPEDIDA: '#38bdf8',
}

export function ReimpressaoEtiquetas() {
  const { operador, toastSuccess, toastError } = useAppStore()
  const [searchParams] = useSearchParams()
  const inputRef = useRef(null)

  const [eanInput, setEanInput] = useState('')
  const [caixaSelecionada, setCaixaSelecionada] = useState(null)
  const [buscando, setBuscando] = useState(false)

  const [filtroLista, setFiltroLista] = useState('')
  const [filtroOrigem, setFiltroOrigem] = useState('TODAS')
  const [recentes, setRecentes] = useState([])
  const [carregandoLista, setCarregandoLista] = useState(true)

  const [modalEtiquetaOpen, setModalEtiquetaOpen] = useState(false)
  const [imprimindo, setImprimindo] = useState(false)

  useEffect(() => {
    carregarRecentes('')
    const eanParam = searchParams.get('ean')
    if (eanParam) {
      setEanInput(eanParam)
      buscarPorEan(eanParam)
    } else {
      inputRef.current?.focus()
    }
  }, [])

  async function carregarRecentes(termo = filtroLista) {
    setCarregandoLista(true)
    try {
      const lista = await tarasQueries.listarCaixasRecentesParaEtiqueta(termo, 60)
      setRecentes(lista || [])
    } catch (err) {
      toastError('Erro', err.message || 'Erro ao carregar caixas para reimpressão.')
    } finally {
      setCarregandoLista(false)
    }
  }

  async function buscarPorEan(eanAlvo) {
    const clean = String(eanAlvo ?? eanInput).trim()
    if (!clean) {
      toastError('Atenção', 'Informe ou bipe o EAN da caixa para localizar a etiqueta.')
      return
    }
    setBuscando(true)
    try {
      const caixa = await tarasQueries.buscarCaixaParaReimpressao(clean)
      setCaixaSelecionada(caixa)
      toastSuccess('Etiqueta localizada', `Caixa ${caixa.ean_caixa} carregada com EAN original preservado.`)
    } catch (err) {
      toastError('Não encontrada', err.message || 'Caixa não encontrada.')
    } finally {
      setBuscando(false)
    }
  }

  async function handleSelecionarDaLista(item) {
    setEanInput(item.ean_caixa)
    await buscarPorEan(item.ean_caixa)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleReimprimir() {
    if (!caixaSelecionada) return
    setImprimindo(true)
    try {
      await tarasQueries.registrarReimpressaoHistorico({
        caixa_id: caixaSelecionada.id,
        ean_caixa: caixaSelecionada.ean_caixa,
        origem_tipo: caixaSelecionada.origem_tipo,
        operador_nome: operador?.nome || 'Operador',
      })
      setModalEtiquetaOpen(true)
      toastSuccess('Reimpressão 100×70mm', `Reimpressão registrada para o EAN ${caixaSelecionada.ean_caixa}.`)
    } catch (err) {
      toastError('Erro', err.message || 'Erro ao registrar reimpressão.')
    } finally {
      setImprimindo(false)
    }
  }

  const recentesFiltradas = recentes.filter((r) => {
    if (filtroOrigem === 'TODAS') return true
    const orig = String(r.origem_tipo || 'RECEBIMENTO').toUpperCase()
    if (filtroOrigem === 'PRODUCAO') return orig === 'PRODUCAO' || orig === 'OP'
    if (filtroOrigem === 'INVENTARIO') return orig === 'INVENTARIO' || orig === 'CARGA_INICIAL'
    return orig === filtroOrigem
  })

  const origStyle = ORIGEM_BADGE[String(caixaSelecionada?.origem_tipo || 'RECEBIMENTO').toUpperCase()] || ORIGEM_BADGE.RECEBIMENTO

  return (
    <div style={{ paddingBottom: 40 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Printer size={26} color="var(--cyan)" />
            Reimpressão de Etiquetas Térmicas (100 × 70 mm)
          </h1>
          <p className="page-subtitle">
            Bipe ou selecione qualquer caixa de Recebimento, Inventário, Desmembramento ou Produção para reimprimir a etiqueta preservando o EAN original.
          </p>
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 10,
          background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.3)',
          color: '#4ade80', fontSize: 12, fontWeight: 700,
        }}>
          <ShieldCheck size={16} />
          EAN Original Preservado (Sem gerar novo código)
        </div>
      </div>

      {/* Scanner / Busca Direta por EAN */}
      <div className="card p-20 mb-20">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            buscarPorEan(eanInput)
          }}
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <div style={{ flex: '1 1 320px', position: 'relative' }}>
            <ScanBarcode
              size={20}
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)' }}
            />
            <input
              ref={inputRef}
              type="text"
              className="form-input form-input--scanner"
              style={{ paddingLeft: 44, width: '100%' }}
              placeholder="Bipe o EAN da caixa ou digite e pressione Enter..."
              value={eanInput}
              onChange={(e) => setEanInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={buscando}>
            <Search size={18} />
            {buscando ? 'Localizando...' : 'Buscar Etiqueta'}
          </button>
        </form>
      </div>

      {/* Área da Caixa Selecionada + Prévia Visual da Etiqueta Zebra */}
      {caixaSelecionada && (
        <div
          className="card p-24 mb-24"
          style={{
            borderColor: 'rgba(56, 189, 248, 0.35)',
            background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.88))',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' }}>
            {/* Coluna Dados Completos da Caixa */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                  background: origStyle.bg, color: origStyle.color, border: `1px solid ${origStyle.border}`,
                  textTransform: 'uppercase',
                }}>
                  <Layers size={12} /> {origStyle.label}
                  {caixaSelecionada.op_codigo ? ` • ${caixaSelecionada.op_codigo}` : ''}
                </span>

                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: STATUS_COR[caixaSelecionada.status] || 'var(--text-primary)',
                }}>
                  Status: {caixaSelecionada.status || 'DISPONIVEL'} • Endereço: {caixaSelecionada.endereco || '-'}
                </span>
              </div>

              <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                {caixaSelecionada.produto_descricao}
              </h2>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Código do Produto: <strong style={{ color: 'var(--text-primary)' }}>{caixaSelecionada.produto_codigo}</strong>
                {'  •  '}
                EAN da Caixa: <strong className="font-mono" style={{ color: 'var(--cyan)', fontSize: 14 }}>{caixaSelecionada.ean_caixa}</strong>
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
                padding: 14, borderRadius: 10, background: 'rgba(2, 6, 23, 0.5)',
                border: '1px solid var(--border)', marginBottom: 14,
              }}>
                <div>
                  <div className="text-xs text-muted uppercase font-bold">Lote Automático</div>
                  <div className="font-mono font-bold" style={{ fontSize: 15, color: '#facc15' }}>
                    {caixaSelecionada.lote || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase font-bold">Data Produção</div>
                  <div className="font-bold" style={{ fontSize: 14 }}>
                    {fmtDataBR(caixaSelecionada.data_producao)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase font-bold">Validade</div>
                  <div className="font-bold" style={{ fontSize: 14 }}>
                    {fmtDataBR(caixaSelecionada.validade)}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted uppercase font-bold">Peso Bruto</div>
                  <div className="font-bold" style={{ fontSize: 15 }}>
                    {caixaSelecionada.peso_bruto_kg != null
                      ? fmtKg2(caixaSelecionada.peso_bruto_kg)
                      : fmtKg2(Number(caixaSelecionada.peso_kg || 0) + Number(caixaSelecionada.tara_kg || 0))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase font-bold">Tara Aplicada</div>
                  <div className="font-bold" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                    {caixaSelecionada.tara_kg != null ? fmtKg3(caixaSelecionada.tara_kg) : '0,000 kg'}
                    {caixaSelecionada.tara_nome ? ` (${caixaSelecionada.tara_nome})` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase font-bold">Peso Líquido</div>
                  <div className="font-bold" style={{ fontSize: 16, color: '#4ade80' }}>
                    {fmtKg2(caixaSelecionada.peso_kg)}
                  </div>
                </div>
              </div>

              {(caixaSelecionada.ean_origem || caixaSelecionada.operador_cadastro_nome) && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                  {caixaSelecionada.ean_origem && (
                    <span>
                      Caixa Origem (Desmembramento): <strong className="font-mono" style={{ color: '#2dd4bf' }}>{caixaSelecionada.ean_origem}</strong>
                    </span>
                  )}
                  {caixaSelecionada.operador_cadastro_nome && (
                    <span>Cadastrado por: <strong>{caixaSelecionada.operador_cadastro_nome}</strong></span>
                  )}
                  <span>Registro: <strong>{fmtDataHoraBR(caixaSelecionada.created_at)}</strong></span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn--success"
                  disabled={imprimindo}
                  onClick={handleReimprimir}
                >
                  <Printer size={18} />
                  {imprimindo ? 'Registrando...' : 'Reimprimir Etiqueta (100 × 70 mm)'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => baixarZplEtiquetas(caixaSelecionada, `etiqueta_${caixaSelecionada.ean_caixa}.zpl`)}
                >
                  <Download size={16} />
                  Baixar ZPL
                </button>
                <Link
                  to={`/rastreabilidade`}
                  state={{ eanInicial: caixaSelecionada.ean_caixa }}
                  className="btn btn--ghost"
                  style={{ textDecoration: 'none' }}
                >
                  <History size={16} />
                  Histórico Completo
                  <ExternalLink size={14} />
                </Link>
              </div>
            </div>

            {/* Coluna Prévia Visual da Etiqueta */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size={14} />
                Prévia da Etiqueta Zebra (100 × 70 mm)
              </div>
              <EtiquetaZebraCard etiqueta={caixaSelecionada} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center' }}>
                O código de barras CODE128 impresso acima preserva exatamente o EAN <strong>{caixaSelecionada.ean_caixa}</strong>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pesquisa / Seleção Rápida de Caixas Cadastradas */}
      <div className="card p-20">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={18} color="var(--cyan)" />
              Caixas Disponíveis / Recentes para Reimpressão ({recentesFiltradas.length})
            </h3>
            <p className="text-xs text-muted" style={{ margin: '4px 0 0' }}>
              Pesquise por EAN, código do produto, nome ou lote, ou clique em uma linha para visualizar e reimprimir.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              style={{ width: 250 }}
              placeholder="Filtrar EAN, produto, código ou lote..."
              value={filtroLista}
              onChange={(e) => setFiltroLista(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') carregarRecentes(e.target.value)
              }}
            />
            <select
              className="form-input"
              style={{ width: 175 }}
              value={filtroOrigem}
              onChange={(e) => setFiltroOrigem(e.target.value)}
            >
              <option value="TODAS">Todas as Origens</option>
              <option value="RECEBIMENTO">Recebimento</option>
              <option value="INVENTARIO">Inventário</option>
              <option value="DESMEMBRAMENTO">Desmembramento</option>
              <option value="PRODUCAO">Produção / OP</option>
            </select>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => carregarRecentes(filtroLista)}
              disabled={carregandoLista}
            >
              <RefreshCw size={15} />
              Atualizar
            </button>
          </div>
        </div>

        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>EAN Original</th>
                <th>Origem</th>
                <th>Produto</th>
                <th>Lote</th>
                <th>Data Prod.</th>
                <th>Validade</th>
                <th>Bruto</th>
                <th>Tara</th>
                <th>Líquido</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {carregandoLista ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 28 }} className="text-muted">
                    Carregando caixas registradas...
                  </td>
                </tr>
              ) : recentesFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 28 }} className="text-muted">
                    Nenhuma caixa encontrada com os filtros informados.
                  </td>
                </tr>
              ) : recentesFiltradas.map((item) => {
                const origKey = String(item.origem_tipo || 'RECEBIMENTO').toUpperCase()
                const badge = ORIGEM_BADGE[origKey] || ORIGEM_BADGE.RECEBIMENTO
                const selected = caixaSelecionada?.ean_caixa === item.ean_caixa

                return (
                  <tr
                    key={item.id}
                    onClick={() => handleSelecionarDaLista(item)}
                    style={{
                      cursor: 'pointer',
                      background: selected ? 'rgba(56, 189, 248, 0.12)' : undefined,
                    }}
                  >
                    <td className="font-mono font-bold" style={{ color: 'var(--cyan)' }}>
                      {item.ean_caixa}
                    </td>
                    <td>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                        background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {badge.label}{item.op_codigo ? ` (${item.op_codigo})` : ''}
                      </span>
                    </td>
                    <td>
                      <div className="font-bold" style={{ fontSize: 13 }}>{item.produto_descricao}</div>
                      <div className="text-xs text-muted">Cód: {item.produto_codigo}</div>
                    </td>
                    <td className="font-mono font-bold">{item.lote || '-'}</td>
                    <td>{fmtDataBR(item.data_producao)}</td>
                    <td>{fmtDataBR(item.validade)}</td>
                    <td>{item.peso_bruto_kg != null ? fmtKg2(item.peso_bruto_kg) : '-'}</td>
                    <td>{item.tara_kg != null ? fmtKg3(item.tara_kg) : '-'}</td>
                    <td className="font-bold" style={{ color: '#4ade80' }}>{fmtKg2(item.peso_kg)}</td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COR[item.status] || 'var(--text-secondary)' }}>
                        {item.status || 'DISPONIVEL'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCaixaSelecionada(item)
                          tarasQueries.registrarReimpressaoHistorico({
                            caixa_id: item.id,
                            ean_caixa: item.ean_caixa,
                            origem_tipo: item.origem_tipo,
                            operador_nome: operador?.nome || 'Operador',
                          }).then(() => {
                            setModalEtiquetaOpen(true)
                          }).catch((err) => {
                            toastError(err.message || 'Erro ao registrar reimpressão.')
                          })
                        }}
                      >
                        <Printer size={14} /> Reimprimir
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <EtiquetaZebraModal
        isOpen={modalEtiquetaOpen}
        etiquetas={caixaSelecionada ? [caixaSelecionada] : []}
        autoPrint={true}
        titulo="Reimpressão de Etiqueta (EAN Original Preservado)"
        subtitulo={`EAN ${caixaSelecionada?.ean_caixa || ''} • Lote ${caixaSelecionada?.lote || '-'} • Impressão Zebra 100 × 70 mm`}
        onClose={() => setModalEtiquetaOpen(false)}
      />
    </div>
  )
}

export default ReimpressaoEtiquetas
