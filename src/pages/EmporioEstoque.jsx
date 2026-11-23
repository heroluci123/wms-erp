import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  History,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  ScanBarcode,
  Search,
  ShieldCheck,
  ShoppingBag,
  X,
} from 'lucide-react'
import { varejoQueries } from '../queries/varejo'
import { comprasQueries } from '../queries/compras'
import * as produtosQueries from '../queries/produtos'
import { useAppStore } from '../store/appStore'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDataHora = (s) => {
  if (!s) return '-'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('pt-BR')
}

export function EmporioEstoque() {
  const navigate = useNavigate()
  const { toastSuccess, toastError, toastWarning } = useAppStore()

  const [aba, setAba] = useState('ESTOQUE') // 'ESTOQUE' | 'AUDITORIA'
  const [loading, setLoading] = useState(true)
  const [itensEmporio, setItensEmporio] = useState([])
  const [movimentacoes, setMovimentacoes] = useState([])
  const [catalogo, setCatalogo] = useState([])
  const [permitirCargaInicial, setPermitirCargaInicial] = useState(true)

  const [buscaLista, setBuscaLista] = useState('')
  const [apenasAbaixoMin, setApenasAbaixoMin] = useState(false)

  // Modal Restrito — Carga Inicial / Ajuste Manual (PIN Gerencial)
  const [modalCarga, setModalCarga] = useState(false)
  const [tipoOperacao, setTipoOperacao] = useState('CARGA_INICIAL') // CARGA_INICIAL | AJUSTE_ENTRADA | AJUSTE_SAIDA
  const [codigoOuEan, setCodigoOuEan] = useState('')
  const [produtoSel, setProdutoSel] = useState(null)
  const [qtdVolumes, setQtdVolumes] = useState('1')
  const [fatorConversao, setFatorConversao] = useState('1')
  const [precoCompra, setPrecoCompra] = useState('')
  const [precoVenda, setPrecoVenda] = useState('')
  const [motivo, setMotivo] = useState('')
  const [pinGerencial, setPinGerencial] = useState('')
  const [salvando, setSalvando] = useState(false)

  const inputEanRef = useRef(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [resEmp, resMov, prods, cfgMod] = await Promise.all([
        varejoQueries.listarEstoque({ setor: 'EMPORIO' }),
        varejoQueries.listarMovimentacoes().catch(() => ({ data: [] })),
        produtosQueries.listar().catch(() => []),
        comprasQueries.obterConfigModulos().catch(() => null),
      ])
      setItensEmporio(resEmp.data || [])
      setMovimentacoes(resMov.data || [])
      setCatalogo(Array.isArray(prods) ? prods : [])
      if (cfgMod) {
        setPermitirCargaInicial(cfgMod.permitir_carga_inicial_emporio !== false)
      }
    } catch (err) {
      toastError('Erro ao carregar Empório', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const catalogoPorId = useMemo(() => {
    const m = new Map()
    for (const p of catalogo) m.set(String(p.id), p)
    return m
  }, [catalogo])

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
    const prodFull = catalogoPorId.get(String(p.id)) || p
    setProdutoSel(prodFull)
    setCodigoOuEan(prodFull.ean || prodFull.codigo || prodFull.descricao)
    setFatorConversao(String(Math.max(1, Number(prodFull.fator_conversao_compra || 1))))
    if (Number(prodFull.ultimo_preco_compra || prodFull.custo_medio_kg || 0) > 0) {
      setPrecoCompra(Number(prodFull.ultimo_preco_compra || prodFull.custo_medio_kg).toFixed(2))
    } else {
      setPrecoCompra('')
    }
    const jaNoEmp = itensEmporio.find((x) => x.produto_id === prodFull.id)
    if (jaNoEmp && Number(jaNoEmp.preco_venda_varejo || jaNoEmp.preco_venda || 0) > 0) {
      setPrecoVenda(Number(jaNoEmp.preco_venda_varejo || jaNoEmp.preco_venda).toFixed(2))
    } else {
      setPrecoVenda('')
    }
  }

  const abrirModalCarga = (itemPreSelecionado = null, tipoInit = 'CARGA_INICIAL') => {
    setTipoOperacao(tipoInit)
    setQtdVolumes('1')
    setFatorConversao('1')
    setPrecoCompra('')
    setPrecoVenda('')
    setMotivo(tipoInit === 'CARGA_INICIAL' ? 'Carga inicial de implantação do Empório' : '')
    setPinGerencial('')
    if (itemPreSelecionado) {
      selecionarProduto({
        id: itemPreSelecionado.produto_id,
        codigo: itemPreSelecionado.produto_codigo || itemPreSelecionado.codigo,
        ean: itemPreSelecionado.produto_ean || itemPreSelecionado.ean,
        descricao: itemPreSelecionado.produto_descricao || itemPreSelecionado.descricao,
      })
    } else {
      setProdutoSel(null)
      setCodigoOuEan('')
    }
    setModalCarga(true)
    setTimeout(() => inputEanRef.current?.focus(), 70)
  }

  const totalUnidadesMov = useMemo(() => {
    const v = Number(String(qtdVolumes || '0').replace(',', '.'))
    const f = Number(String(fatorConversao || '1').replace(',', '.'))
    if (!Number.isFinite(v) || !Number.isFinite(f)) return 0
    return Number((Math.max(0, v) * Math.max(0.001, f)).toFixed(3))
  }, [qtdVolumes, fatorConversao])

  const handleConfirmarCargaOuAjuste = async (e) => {
    e.preventDefault()
    if (!produtoSel && !codigoOuEan.trim()) {
      toastWarning('Informe o produto', 'Bipe o EAN-13 ou pesquise o produto do Empório.')
      return
    }
    if (totalUnidadesMov <= 0) {
      toastWarning('Quantidade inválida', 'Informe volumes e unidades por volume maiores que zero.')
      return
    }
    if (motivo.trim().length < 3) {
      toastWarning('Motivo obrigatório', 'Informe o motivo da carga inicial ou ajuste manual para auditoria.')
      return
    }
    if (pinGerencial.trim().length < 4) {
      toastWarning('PIN Gerencial obrigatório', 'Informe o PIN Gerencial/Master (4 a 6 dígitos) para autorizar.')
      return
    }

    setSalvando(true)
    try {
      const res = await varejoQueries.entradaEmporio({
        produto_id: produtoSel?.id || undefined,
        ean_ou_codigo: !produtoSel ? codigoOuEan.trim() : undefined,
        tipo_operacao: tipoOperacao,
        qtd_volumes: Number(String(qtdVolumes || '1').replace(',', '.')),
        fator_conversao: Number(String(fatorConversao || '1').replace(',', '.')),
        custo_unitario: precoCompra ? Number(String(precoCompra).replace(',', '.')) : undefined,
        preco_venda: precoVenda ? Number(String(precoVenda).replace(',', '.')) : undefined,
        motivo: motivo.trim(),
        pin: pinGerencial.trim(),
      })
      const sinal = tipoOperacao === 'AJUSTE_SAIDA' ? '-' : '+'
      toastSuccess(
        'Movimentação registrada no endereço EMPORIO!',
        `${res.data.produto_descricao}: ${sinal}${res.data.qtd_entrada} ${res.data.unidade_venda} (Saldo: ${res.data.saldo_novo}) • Aut.: ${res.data.autorizado_por}`,
      )
      setModalCarga(false)
      await carregar()
    } catch (err) {
      toastError('Acesso negado ou erro no lançamento', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const listaFiltrada = useMemo(() => {
    const q = buscaLista.trim().toLowerCase()
    return itensEmporio.filter((i) => {
      if (apenasAbaixoMin && !i.abaixo_minimo) return false
      if (!q) return true
      return (
        String(i.produto_descricao || i.descricao || '').toLowerCase().includes(q) ||
        String(i.produto_codigo || i.codigo || '').toLowerCase().includes(q) ||
        String(i.produto_ean || i.ean || '').toLowerCase().includes(q)
      )
    })
  }, [itensEmporio, buscaLista, apenasAbaixoMin])

  const kpis = useMemo(() => {
    const totalItens = itensEmporio.length
    const totalUnidades = itensEmporio.reduce((s, i) => s + Number(i.saldo_qtd || 0), 0)
    const valorEstoque = itensEmporio.reduce(
      (s, i) => s + Number(i.saldo_qtd || 0) * Number(i.preco_venda_varejo || i.preco_venda || 0),
      0,
    )
    const abaixoMin = itensEmporio.filter((i) => i.abaixo_minimo).length
    return { totalItens, totalUnidades, valorEstoque, abaixoMin }
  }, [itensEmporio])

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingBag size={20} className="text-primary" /> Empório — Estoque &amp; Auditoria
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Posição real do endereço <strong>EMPORIO</strong> alimentada via Entrada Fiscal (XML NF-e) e Inventário Cego • Ajustes manuais restritos por PIN Gerencial
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => navigate('/produtos?novo=emporio')}
            title="Cadastrar novo item de revenda / empório (ex.: bebidas, carvão, mercearia)"
          >
            <Plus size={14} /> Novo Item Empório
          </button>

          {permitirCargaInicial ? (
            <button
              type="button"
              className="btn btn--warning btn--sm"
              onClick={() => abrirModalCarga(null, 'CARGA_INICIAL')}
              title="Requer PIN Gerencial e motivo obrigatório em auditoria"
            >
              <KeyRound size={14} /> Carga Inicial / Ajuste Manual (PIN)
            </button>
          ) : (
            <span
              className="badge badge--neutral"
              style={{ padding: '6px 10px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Reative em Parâmetros Comerciais se precisar realizar carga inicial novamente"
            >
              <Lock size={12} /> Ajustes Manuais Bloqueados (Somente NF-e / Inventário)
            </span>
          )}

          <button type="button" className="btn btn--ghost btn--sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
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

      {/* BANNER INFORMATIVO DE ENTRADA AUTOMÁTICA VIA NF-E */}
      <div
        className="card"
        style={{
          padding: '10px 14px',
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1' }}>
          <FileCode2 size={15} color="#60a5fa" />
          <span>
            <strong>Rotina oficial de reposição:</strong> ao importar o <strong>XML da NF-e de compra</strong> nesta unidade, o sistema identifica fardos/caixas (<code>FD</code>/<code>CX</code>) e converte automaticamente em unidades no endereço <strong>EMPORIO</strong>.
          </span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/compras')}>
          Ir para Pedidos / Entrada XML
        </button>
      </div>

      {/* ABAS: ESTOQUE ATUAL vs AUDITORIA DE MOVIMENTAÇÕES */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn--sm ${aba === 'ESTOQUE' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setAba('ESTOQUE')}
        >
          <ShoppingBag size={14} /> Estoque Atual — EMPORIO ({itensEmporio.length})
        </button>
        <button
          type="button"
          className={`btn btn--sm ${aba === 'AUDITORIA' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setAba('AUDITORIA')}
        >
          <History size={14} /> Histórico &amp; Auditoria ({movimentacoes.length})
        </button>
      </div>

      {/* ABA 1: TABELA DE ESTOQUE ATUAL DO EMPÓRIO */}
      {aba === 'ESTOQUE' && (
        <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: 300 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 32, height: 34, fontSize: 12 }}
                  placeholder="Filtrar produto, código ou EAN-13..."
                  value={buscaLista}
                  onChange={(e) => setBuscaLista(e.target.value)}
                />
              </div>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: apenasAbaixoMin ? '#fbbf24' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: apenasAbaixoMin ? 'rgba(245,158,11,0.14)' : 'var(--bg-3)',
                  border: `1px solid ${apenasAbaixoMin ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={apenasAbaixoMin}
                  onChange={(e) => setApenasAbaixoMin(e.target.checked)}
                />
                <AlertTriangle size={12} /> Apenas abaixo do mínimo
              </label>
            </div>
            <div className="text-xs text-muted">
              Exibindo <strong>{listaFiltrada.length}</strong> de {itensEmporio.length} item(ns)
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>EAN-13</th>
                  <th>Produto</th>
                  <th>Fardo/Compra</th>
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
                      Nenhum item no endereço EMPORIO ainda. Cadastre o produto em <strong>Novo Item Empório</strong> e dê entrada via <strong>XML NF-e</strong> ou <strong>Carga Inicial (PIN)</strong>.
                    </td>
                  </tr>
                ) : (
                  listaFiltrada.map((it) => {
                    const prodCat = catalogoPorId.get(String(it.produto_id))
                    const fator = Number(prodCat?.fator_conversao_compra || 1)
                    return (
                      <tr key={it.id}>
                        <td className="font-mono text-xs font-bold text-info">{it.produto_codigo || it.codigo || '-'}</td>
                        <td className="font-mono text-xs">{it.produto_ean || it.ean || '-'}</td>
                        <td>
                          <div className="font-bold text-sm">{it.produto_descricao || it.descricao}</div>
                          {it.abaixo_minimo && (
                            <span className="badge badge--warning" style={{ fontSize: 10, marginTop: 2 }}>
                              Abaixo do Mínimo ({Number(it.estoque_minimo || 0)})
                            </span>
                          )}
                        </td>
                        <td className="font-mono text-xs text-muted">
                          {fator > 1 ? `×${fator} ${it.unidade_venda || 'UN'}/vol` : `1 ${it.unidade_venda || 'UN'}`}
                        </td>
                        <td className="font-mono font-bold text-success" style={{ textAlign: 'right' }}>
                          {fmtMoeda(it.preco_venda_varejo || it.preco_venda || 0)}
                        </td>
                        <td
                          className="font-mono font-bold"
                          style={{ textAlign: 'right', color: Number(it.saldo_qtd || 0) > 0 ? '#22c55e' : '#ef4444' }}
                        >
                          {Number(it.saldo_qtd || 0).toLocaleString('pt-BR')} {it.unidade_venda || 'UN'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {permitirCargaInicial ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => abrirModalCarga(it, 'AJUSTE_ENTRADA')}
                            >
                              <KeyRound size={12} /> Ajustar (PIN)
                            </button>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 2: HISTÓRICO DE MOVIMENTAÇÕES E AUDITORIA */}
      {aba === 'AUDITORIA' && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Data / Hora</th>
                  <th>Tipo</th>
                  <th>Produto</th>
                  <th style={{ textAlign: 'right' }}>Movimento</th>
                  <th style={{ textAlign: 'right' }}>Saldo Ant. → Novo</th>
                  <th>Motivo / Auditoria</th>
                  <th>Usuário</th>
                </tr>
              </thead>
              <tbody>
                {movimentacoes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted p-24">
                      Nenhuma movimentação registrada ainda.
                    </td>
                  </tr>
                ) : (
                  movimentacoes.map((m) => {
                    const positivo = Number(m.qtd || 0) >= 0
                    return (
                      <tr key={m.id}>
                        <td className="font-mono text-xs text-muted">{fmtDataHora(m.created_at)}</td>
                        <td>
                          <span className={`badge ${positivo ? 'badge--success' : 'badge--warning'}`} style={{ fontSize: 10 }}>
                            {m.tipo}
                          </span>
                        </td>
                        <td className="text-xs">
                          <span className="font-mono text-info">{m.produto_codigo}</span>{' '}
                          <strong>{m.produto_descricao}</strong>
                        </td>
                        <td
                          className="font-mono font-bold text-xs"
                          style={{ textAlign: 'right', color: positivo ? '#4ade80' : '#f87171' }}
                        >
                          {positivo ? '+' : ''}
                          {Number(m.qtd || 0).toLocaleString('pt-BR')}
                        </td>
                        <td className="font-mono text-xs text-muted" style={{ textAlign: 'right' }}>
                          {Number(m.saldo_anterior || 0).toLocaleString('pt-BR')} →{' '}
                          <strong style={{ color: 'var(--text-primary)' }}>
                            {Number(m.saldo_novo || 0).toLocaleString('pt-BR')}
                          </strong>
                        </td>
                        <td className="text-xs text-muted" style={{ maxWidth: 320 }}>
                          {m.observacao || '-'}
                        </td>
                        <td className="text-xs">{m.operador_nome || '-'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL RESTRITO: CARGA INICIAL / AJUSTE MANUAL (EXIGE PIN GERENCIAL + MOTIVO) */}
      {modalCarga && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1070 }}
          onClick={(e) => e.target === e.currentTarget && !salvando && setModalCarga(false)}
        >
          <div className="modal" style={{ maxWidth: 640, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div
              style={{
                padding: '14px 18px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={18} color="#fbbf24" />
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                  Carga Inicial / Ajuste Manual — Endereço EMPORIO
                </h3>
              </div>
              <button type="button" className="btn-icon" onClick={() => !salvando && setModalCarga(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleConfirmarCargaOuAjuste} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                className="text-xs"
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.35)',
                  color: '#fde68a',
                }}
              >
                Operação restrita e auditada: exige <strong>Motivo obrigatório</strong> e <strong>PIN Gerencial / Master</strong>. Após finalizar a carga inicial de implantação, você pode desativar ajustes manuais em <strong>Parâmetros Comerciais</strong>.
              </div>

              {/* TIPO DE OPERAÇÃO */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { id: 'CARGA_INICIAL', label: 'Carga Inicial', cor: '#3b82f6' },
                  { id: 'AJUSTE_ENTRADA', label: 'Ajuste Entrada (+)', cor: '#22c55e' },
                  { id: 'AJUSTE_SAIDA', label: 'Ajuste Saída / Quebra (-)', cor: '#ef4444' },
                ].map((t) => {
                  const ativo = tipoOperacao === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTipoOperacao(t.id)
                        if (t.id === 'CARGA_INICIAL' && !motivo) setMotivo('Carga inicial de implantação do Empório')
                        if (t.id !== 'CARGA_INICIAL' && motivo === 'Carga inicial de implantação do Empório') setMotivo('')
                      }}
                      style={{
                        padding: '9px 8px',
                        borderRadius: 8,
                        border: `1.5px solid ${ativo ? t.cor : 'var(--border)'}`,
                        background: ativo ? `${t.cor}22` : 'var(--bg-2)',
                        color: ativo ? '#ffffff' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>

              {/* PRODUTO / EAN */}
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
                    ✓ {produtoSel.codigo} — {produtoSel.descricao}
                    {Number(produtoSel.fator_conversao_compra || 1) > 1 &&
                      ` (Fardo padrão: ${Number(produtoSel.fator_conversao_compra)} un)`}
                  </div>
                )}
                {sugestoesCatalogo.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 64,
                      left: 0,
                      right: 0,
                      zIndex: 50,
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      maxHeight: 200,
                      overflowY: 'auto',
                      boxShadow: '0 14px 30px rgba(0,0,0,0.65)',
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

              {/* QUANTIDADE, FATOR E PREÇOS */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Volumes / Fardos</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="form-input font-mono text-right"
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
                    value={fatorConversao}
                    onChange={(e) => setFatorConversao(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Compra (R$/un)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input font-mono text-right"
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
                    placeholder="Opcional"
                    value={precoVenda}
                    onChange={(e) => setPrecoVenda(e.target.value)}
                  />
                </div>
              </div>

              {/* MOTIVO + PIN GERENCIAL */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Motivo Obrigatório (Auditoria) *</label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="Ex: Contagem inicial da prateleira / Lata avariada"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ color: '#fbbf24', fontWeight: 700 }}>
                    PIN Gerencial / Master *
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    className="form-input font-mono text-center"
                    style={{ fontSize: 18, letterSpacing: '0.25em', fontWeight: 800 }}
                    placeholder="••••"
                    value={pinGerencial}
                    onChange={(e) => setPinGerencial(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid var(--border)',
                  paddingTop: 12,
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  className={`badge ${tipoOperacao === 'AJUSTE_SAIDA' ? 'badge--danger' : 'badge--info'} font-mono`}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                >
                  Saldo EMPORIO: {tipoOperacao === 'AJUSTE_SAIDA' ? '-' : '+'}
                  {totalUnidadesMov} UN
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn--ghost" onClick={() => setModalCarga(false)} disabled={salvando}>
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className={`btn ${tipoOperacao === 'AJUSTE_SAIDA' ? 'btn--danger' : 'btn--success'}`}
                    disabled={salvando}
                  >
                    <CheckCircle2 size={15} /> {salvando ? 'Validando PIN...' : 'Autorizar & Registrar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
