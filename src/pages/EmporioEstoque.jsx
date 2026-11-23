import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  PackagePlus,
  RefreshCw,
  ScanBarcode,
  Search,
  ShoppingBag,
  Sparkles,
} from 'lucide-react'
import { varejoQueries } from '../queries/varejo'
import * as produtosQueries from '../queries/produtos'
import { useAppStore } from '../store/appStore'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function EmporioEstoque() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [itensEmporio, setItensEmporio] = useState([])
  const [catalogo, setCatalogo] = useState([])
  const [buscaLista, setBuscaLista] = useState('')

  // Formulário de Entrada Rápida
  const [codigoOuEan, setCodigoOuEan] = useState('')
  const [produtoSel, setProdutoSel] = useState(null)
  const [qtdVolumes, setQtdVolumes] = useState('1')
  const [fatorConversao, setFatorConversao] = useState('1')
  const [precoCompra, setPrecoCompra] = useState('')
  const [precoVenda, setPrecoVenda] = useState('')
  const [lote, setLote] = useState('')
  const [motivo, setMotivo] = useState('Entrada Empório')
  const [salvando, setSalvando] = useState(false)

  const inputEanRef = useRef(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [resEmp, prods] = await Promise.all([
        varejoQueries.listarEstoque({ setor: 'EMPORIO' }),
        produtosQueries.listar().catch(() => []),
      ])
      setItensEmporio(resEmp.data || [])
      setCatalogo(Array.isArray(prods) ? prods : [])
    } catch (err) {
      toastError('Erro ao carregar Empório', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const sugestoesCatalogo = useMemo(() => {
    const q = codigoOuEan.trim().toLowerCase()
    if (!q || produtoSel) return []
    return catalogo
      .filter(
        (p) =>
          String(p.ean || '').toLowerCase().includes(q) ||
          String(p.codigo || '').toLowerCase().includes(q) ||
          String(p.descricao || '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [catalogo, codigoOuEan, produtoSel])

  const selecionarProduto = (p) => {
    setProdutoSel(p)
    setCodigoOuEan(p.ean || p.codigo || p.descricao)
    if (Number(p.ultimo_preco_compra || p.custo_medio_kg || 0) > 0) {
      setPrecoCompra(Number(p.ultimo_preco_compra || p.custo_medio_kg).toFixed(2))
    }
    const jaNoEmp = itensEmporio.find((x) => x.produto_id === p.id)
    if (jaNoEmp && Number(jaNoEmp.preco_venda_varejo || jaNoEmp.preco_venda || 0) > 0) {
      setPrecoVenda(Number(jaNoEmp.preco_venda_varejo || jaNoEmp.preco_venda).toFixed(2))
    }
  }

  const totalUnidadesEntrada = useMemo(() => {
    const v = Number(String(qtdVolumes || '0').replace(',', '.'))
    const f = Number(String(fatorConversao || '1').replace(',', '.'))
    if (!Number.isFinite(v) || !Number.isFinite(f)) return 0
    return Number((Math.max(0, v) * Math.max(0.001, f)).toFixed(3))
  }, [qtdVolumes, fatorConversao])

  const handleDarEntrada = async (e) => {
    e.preventDefault()
    if (!produtoSel && !codigoOuEan.trim()) {
      toastWarning('Informe o produto', 'Bipe o código de barras EAN-13 ou pesquise o produto.')
      return
    }
    if (totalUnidadesEntrada <= 0) {
      toastWarning('Quantidade inválida', 'Informe a quantidade de volumes/unidades maior que zero.')
      return
    }
    setSalvando(true)
    try {
      const res = await varejoQueries.entradaEmporio({
        produto_id: produtoSel?.id || undefined,
        ean_ou_codigo: !produtoSel ? codigoOuEan.trim() : undefined,
        qtd_volumes: Number(String(qtdVolumes || '1').replace(',', '.')),
        fator_conversao: Number(String(fatorConversao || '1').replace(',', '.')),
        custo_unitario: precoCompra ? Number(String(precoCompra).replace(',', '.')) : undefined,
        preco_venda: precoVenda ? Number(String(precoVenda).replace(',', '.')) : undefined,
        observacao: [motivo.trim(), lote.trim() ? `Lote: ${lote.trim()}` : ''].filter(Boolean).join(' • ') || 'Entrada Empório',
      })
      toastSuccess(
        'Saldo creditado no endereço EMPORIO!',
        `${res.data.produto_descricao}: +${res.data.qtd_entrada} ${res.data.unidade_venda} (Novo saldo: ${res.data.saldo_novo})`,
      )
      setProdutoSel(null)
      setCodigoOuEan('')
      setQtdVolumes('1')
      setFatorConversao('1')
      setPrecoCompra('')
      setPrecoVenda('')
      setLote('')
      await carregar()
      setTimeout(() => inputEanRef.current?.focus(), 60)
    } catch (err) {
      toastError('Erro na entrada do Empório', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const listaFiltrada = useMemo(() => {
    const q = buscaLista.trim().toLowerCase()
    if (!q) return itensEmporio
    return itensEmporio.filter(
      (i) =>
        String(i.produto_descricao || i.descricao || '').toLowerCase().includes(q) ||
        String(i.produto_codigo || i.codigo || '').toLowerCase().includes(q) ||
        String(i.produto_ean || i.ean || '').toLowerCase().includes(q),
    )
  }, [itensEmporio, buscaLista])

  const kpis = useMemo(() => {
    const totalItens = itensEmporio.length
    const totalUnidades = itensEmporio.reduce((s, i) => s + Number(i.saldo_qtd || 0), 0)
    const valorEstoque = itensEmporio.reduce(
      (s, i) => s + Number(i.saldo_qtd || 0) * Number(i.preco_venda_varejo || i.preco_venda || 0),
      0,
    )
    const abaixoMin = itensEmporio.filter(
      (i) => Number(i.estoque_minimo || 0) > 0 && Number(i.saldo_qtd || 0) < Number(i.estoque_minimo || 0),
    ).length
    return { totalItens, totalUnidades, valorEstoque, abaixoMin }
  }, [itensEmporio])

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingBag size={20} className="text-primary" /> Empório — Entrada &amp; Estoque
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Entrada rápida por código EAN-13 (bebidas, carvão, temperos, mercearia) com conversão fardo × unidade no endereço <strong>EMPORIO</strong>
          </div>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={carregar}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Produtos no Empório</div>
          <div className="font-mono font-bold" style={{ fontSize: 20, marginTop: 2 }}>{kpis.totalItens}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Saldo Total (Unidades)</div>
          <div className="font-mono font-bold text-info" style={{ fontSize: 20, marginTop: 2 }}>
            {kpis.totalUnidades.toLocaleString('pt-BR')}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Valor de Venda em Prateleira</div>
          <div className="font-mono font-bold text-success" style={{ fontSize: 20, marginTop: 2 }}>
            {fmtMoeda(kpis.valorEstoque)}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Abaixo do Mínimo</div>
          <div className="font-mono font-bold text-warning" style={{ fontSize: 20, marginTop: 2 }}>{kpis.abaixoMin}</div>
        </div>
      </div>

      {/* ENTRADA RÁPIDA DE SALDO (EAN-13 + FATOR DE CONVERSÃO) */}
      <form onSubmit={handleDarEntrada} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="font-bold text-sm flex items-center gap-8">
            <PackagePlus size={17} className="text-primary" /> Entrada de Saldo no Empório (Endereço EMPORIO)
          </div>
          <div className="text-xs text-muted flex items-center gap-6">
            <Sparkles size={13} className="text-info" />
            Compras via XML de NF-e nesta unidade também dão entrada automática aqui!
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.75fr 0.85fr 0.85fr 0.85fr', gap: 10, alignItems: 'start' }}>
          <div className="form-group" style={{ marginBottom: 0, position: 'relative' }}>
            <label className="form-label">Bipar EAN-13 ou Buscar Produto *</label>
            <div style={{ position: 'relative' }}>
              <ScanBarcode size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                ref={inputEanRef}
                type="text"
                className="form-input font-mono"
                style={{ paddingLeft: 32, height: 40 }}
                placeholder="Bipe o EAN (ex: Coca-Cola, Carvão) ou digite o nome..."
                value={codigoOuEan}
                onChange={(e) => {
                  setCodigoOuEan(e.target.value)
                  if (produtoSel) setProdutoSel(null)
                }}
              />
            </div>
            {produtoSel && (
              <div className="text-xs text-success font-bold mt-4">
                ✓ Selecionado: {produtoSel.codigo} — {produtoSel.descricao}
              </div>
            )}
            {sugestoesCatalogo.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 64,
                  left: 0,
                  right: 0,
                  zIndex: 40,
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                  boxShadow: '0 14px 30px rgba(0,0,0,0.6)',
                }}
              >
                {sugestoesCatalogo.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selecionarProduto(p)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 12.5,
                    }}
                  >
                    <strong className="font-mono text-info">{p.codigo}</strong> — {p.descricao}
                    {p.ean && <span className="text-xs text-muted font-mono"> • EAN {p.ean}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Volumes / Fardos</label>
            <input
              type="number"
              step="1"
              min="1"
              className="form-input font-mono text-right"
              style={{ height: 40, fontWeight: 700 }}
              value={qtdVolumes}
              onChange={(e) => setQtdVolumes(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Unid. p/ Volume</label>
            <input
              type="number"
              step="1"
              min="1"
              className="form-input font-mono text-right"
              style={{ height: 40, fontWeight: 700 }}
              value={fatorConversao}
              onChange={(e) => setFatorConversao(e.target.value)}
              title="Ex: 12 para fardo com 12 latas, ou 1 para unidade avulsa"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Compra (R$/un)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="form-input font-mono text-right"
              style={{ height: 40 }}
              placeholder="Opcional"
              value={precoCompra}
              onChange={(e) => setPrecoCompra(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Venda PDV (R$/un)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="form-input font-mono text-right"
              style={{ height: 40, fontWeight: 700 }}
              placeholder="Opcional"
              value={precoVenda}
              onChange={(e) => setPrecoVenda(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              style={{ height: 34, width: 160, fontSize: 12 }}
              placeholder="Lote (Opcional)"
              value={lote}
              onChange={(e) => setLote(e.target.value)}
            />
            <input
              type="text"
              className="form-input"
              style={{ height: 34, width: 220, fontSize: 12 }}
              placeholder="Observação / Nº Nota"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <span className="badge badge--info font-mono" style={{ fontSize: 12, padding: '6px 10px' }}>
              Crédito no endereço EMPORIO: +{totalUnidadesEntrada} UN
            </span>
          </div>

          <button type="submit" className="btn btn--success" disabled={salvando}>
            <CheckCircle2 size={15} /> {salvando ? 'Registrando...' : 'Dar Entrada no Empório'}
          </button>
        </div>
      </form>

      {/* TABELA DO ESTOQUE ATUAL DO EMPÓRIO */}
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="font-bold text-sm">Saldo Atual no Endereço EMPORIO ({listaFiltrada.length})</div>
          <div style={{ position: 'relative', width: 280 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 32, height: 34, fontSize: 12 }}
              placeholder="Filtrar produto ou EAN..."
              value={buscaLista}
              onChange={(e) => setBuscaLista(e.target.value)}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>EAN-13</th>
                <th>Produto</th>
                <th>Un</th>
                <th style={{ textAlign: 'right' }}>Preço PDV</th>
                <th style={{ textAlign: 'right' }}>Saldo EMPORIO</th>
                <th style={{ textAlign: 'right' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-muted p-24">Carregando estoque do Empório...</td></tr>
              ) : listaFiltrada.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-muted p-24">
                    Nenhum item com movimentação no Empório ainda. Use o formulário acima para bipar o EAN-13 e dar entrada!
                  </td>
                </tr>
              ) : (
                listaFiltrada.map((it) => (
                  <tr key={it.id}>
                    <td className="font-mono text-xs font-bold text-info">{it.produto_codigo || it.codigo || '-'}</td>
                    <td className="font-mono text-xs">{it.produto_ean || it.ean || '-'}</td>
                    <td className="font-bold text-sm">{it.produto_descricao || it.descricao}</td>
                    <td className="text-xs">{it.unidade_venda || 'UN'}</td>
                    <td className="font-mono font-bold text-success" style={{ textAlign: 'right' }}>
                      {fmtMoeda(it.preco_venda_varejo || it.preco_venda || 0)}
                    </td>
                    <td className="font-mono font-bold" style={{ textAlign: 'right', color: Number(it.saldo_qtd || 0) > 0 ? '#22c55e' : '#ef4444' }}>
                      {Number(it.saldo_qtd || 0).toLocaleString('pt-BR')} {it.unidade_venda || 'UN'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => {
                          selecionarProduto({
                            id: it.produto_id,
                            codigo: it.produto_codigo || it.codigo,
                            ean: it.produto_ean || it.ean,
                            descricao: it.produto_descricao || it.descricao,
                          })
                          setPrecoVenda(Number(it.preco_venda_varejo || it.preco_venda || 0).toFixed(2))
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        + Repor
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
