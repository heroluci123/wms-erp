import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Award,
  BarChart3,
  Box,
  Briefcase,
  ClipboardList,
  Download,
  Factory,
  Printer,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { financeiroQueries } from '../queries/financeiro'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

const fmtPct = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const fmtMesLabel = (ym) => {
  if (!ym || !ym.includes('-')) return ym || '-'
  const [y, m] = ym.split('-')
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${nomes[Number(m) - 1] || m}/${y.slice(2)}`
}

function hojeIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function obterAtalhoPeriodo(tipo) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const iso = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

  if (tipo === 'MES_ATUAL') {
    return { ini: iso(new Date(y, m, 1)), fim: iso(now) }
  }
  if (tipo === 'MES_ANTERIOR') {
    return { ini: iso(new Date(y, m - 1, 1)), fim: iso(new Date(y, m, 0)) }
  }
  if (tipo === 'ULTIMOS_30') {
    const ini = new Date(now)
    ini.setDate(ini.getDate() - 29)
    return { ini: iso(ini), fim: iso(now) }
  }
  if (tipo === 'TRIMESTRE') {
    return { ini: iso(new Date(y, m - 2, 1)), fim: iso(now) }
  }
  return { ini: `${y}-01-01`, fim: iso(now) }
}

export function DreGerencial() {
  const { toastError } = useAppStore()
  const apiAtiva = isApiEnabled()

  const hoje = hojeIso()
  const [dataInicio, setDataInicio] = useState(() => `${hoje.slice(0, 7)}-01`)
  const [dataFim, setDataFim] = useState(hoje)
  const [regime, setRegime] = useState('COMPETENCIA') // 'COMPETENCIA' | 'CAIXA'
  const [aba, setAba] = useState('DRE') // 'DRE' | 'RENTABILIDADE' | 'PEDIDOS' | 'DESOSSA'
  const [visaoRent, setVisaoRent] = useState('PRODUTO') // 'PRODUTO' | 'CLIENTE' | 'VENDEDOR'
  const [busca, setBusca] = useState('')
  const [soAlertas, setSoAlertas] = useState(false)

  const [loading, setLoading] = useState(false)
  const [dre, setDre] = useState(null)
  const [rent, setRent] = useState(null)
  const [desossa, setDesossa] = useState({ ops: [], ranking_fornecedores: [] })

  const carregar = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [dreRes, rentRes, desRes] = await Promise.all([
        financeiroQueries.obterDre({ data_inicio: dataInicio, data_fim: dataFim, regime }),
        financeiroQueries.obterRentabilidade({ data_inicio: dataInicio, data_fim: dataFim }),
        financeiroQueries
          .obterAnaliseCustosDesossa({ dataInicio, dataFim })
          .catch(() => ({ ops: [], ranking_fornecedores: [] })),
      ])
      setDre(dreRes)
      setRent(rentRes)
      setDesossa(desRes || { ops: [], ranking_fornecedores: [] })
    } catch (err) {
      toastError('Erro ao carregar DRE Gerencial', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, dataInicio, dataFim, regime, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const aplicarAtalho = (tipo) => {
    const r = obterAtalhoPeriodo(tipo)
    setDataInicio(r.ini)
    setDataFim(r.fim)
  }

  const kpis = dre?.kpis || {
    receita_bruta: 0,
    devolucoes: 0,
    receita_liquida: 0,
    cmv_real: 0,
    lucro_bruto: 0,
    margem_bruta_pct: 0,
    despesas_operacionais: 0,
    comissoes: 0,
    comissao_origem: 'LANCADA',
    perdas_quarentena: 0,
    lucro_liquido: 0,
    margem_liquida_pct: 0,
    qtd_pedidos: 0,
    volume_vendido_kg: 0,
  }

  const evolucaoMax = useMemo(() => {
    const arr = dre?.evolucao_mensal || []
    return Math.max(1, ...arr.map((m) => Math.max(m.receita || 0, (m.cmv || 0) + (m.despesas || 0), Math.abs(m.lucro_liquido || 0))))
  }, [dre])

  const exportarCsvDre = () => {
    if (!dre) return
    const linhas = [
      `DRE GERENCIAL (${regime});PERIODO;${fmtData(dataInicio)} a ${fmtData(dataFim)}`,
      '',
      'CODIGO;CONTA;VALOR_R$;PCT_RECEITA',
      ...(dre.linhas_dre || []).map(
        (l) => `${l.codigo};"${l.nome}";${Number(l.valor || 0).toFixed(2).replace('.', ',')};${Number(l.pct_receita || 0).toFixed(2).replace('.', ',')}%`,
      ),
      '',
      'DESPESAS POR CENTRO DE CUSTO',
      'CODIGO;CENTRO_CUSTO;QTD_LANCAMENTOS;VALOR_R$',
      ...(dre.despesas_por_centro_custo || []).map(
        (c) => `${c.codigo};"${c.nome}";${c.qtd};${Number(c.valor || 0).toFixed(2).replace('.', ',')}`,
      ),
      '',
      'MARGEM POR PRODUTO',
      'CODIGO;PRODUTO;KG;RECEITA_R$;CMV_REAL_R$;PRECO_MEDIO_KG;CUSTO_REAL_KG;MARGEM_R$;MARGEM_PCT',
      ...(rent?.por_produto || []).map(
        (p) =>
          `${p.codigo};"${p.descricao}";${p.qtd_kg.toFixed(2).replace('.', ',')};${p.receita.toFixed(2).replace('.', ',')};${p.custo_total.toFixed(2).replace('.', ',')};${p.preco_medio_kg.toFixed(2).replace('.', ',')};${p.custo_medio_real_kg.toFixed(2).replace('.', ',')};${p.margem_rs.toFixed(2).replace('.', ',')};${p.margem_pct.toFixed(2).replace('.', ',')}%`,
      ),
    ]
    const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `DRE_Gerencial_${dataInicio}_a_${dataFim}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const imprimirDre = () => {
    if (!dre) return
    const rowsHtml = (dre.linhas_dre || [])
      .map((l) => {
        const bold = l.tipo === 'SUBTOTAL' || l.tipo === 'RESULTADO' ? 'font-weight:700;background:#f1f5f9;' : ''
        const cor = l.valor < 0 ? 'color:#b91c1c;' : l.tipo === 'RESULTADO' ? 'color:#15803d;' : ''
        return `<tr style="${bold}">
          <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;">${l.codigo}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;">${l.nome}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;${cor}">${fmtMoeda(l.valor)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;">${fmtPct(l.pct_receita)}</td>
        </tr>`
      })
      .join('')
    const ccHtml = (dre.despesas_por_centro_custo || [])
      .map(
        (c) => `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${c.codigo} — ${c.nome}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${c.qtd}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;">${fmtMoeda(c.valor)}</td>
        </tr>`,
      )
      .join('')

    const w = window.open('', '_blank', 'width=900,height=720')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DRE Gerencial</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;} table{width:100%;border-collapse:collapse;margin-top:12px;} th{background:#0f172a;color:#fff;padding:8px 10px;text-align:left;font-size:12px;} td{font-size:12.5px;}</style>
      </head><body>
      <h2 style="margin:0;">DRE Gerencial &amp; Resultado Operacional</h2>
      <p style="margin:4px 0 16px;color:#475569;font-size:13px;">Período: <strong>${fmtData(dataInicio)} a ${fmtData(dataFim)}</strong> • Regime: <strong>${regime}</strong> • Volume: <strong>${fmtKg(kpis.volume_vendido_kg)}</strong> (${kpis.qtd_pedidos} pedidos)</p>
      <table><thead><tr><th style="width:60px;">Cód.</th><th>Demonstrativo de Resultado</th><th style="text-align:right;">Valor (R$)</th><th style="text-align:right;">% Vertical</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      ${ccHtml ? `<h3 style="margin:24px 0 6px;">Detalhamento de Despesas por Centro de Custo</h3><table><thead><tr><th>Centro de Custo</th><th style="text-align:center;">Lançamentos</th><th style="text-align:right;">Total (R$)</th></tr></thead><tbody>${ccHtml}</tbody></table>` : ''}
      </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 250)
  }

  const buscaNorm = busca.trim().toLowerCase()

  const produtosFiltrados = useMemo(() => {
    return (rent?.por_produto || []).filter((p) => {
      if (soAlertas && p.alerta_margem === 'SAUDAVEL') return false
      if (!buscaNorm) return true
      return (
        String(p.codigo || '').toLowerCase().includes(buscaNorm) ||
        String(p.descricao || '').toLowerCase().includes(buscaNorm)
      )
    })
  }, [rent, buscaNorm, soAlertas])

  const clientesFiltrados = useMemo(() => {
    return (rent?.por_cliente || []).filter((c) => {
      if (soAlertas && c.alerta_margem === 'SAUDAVEL') return false
      if (!buscaNorm) return true
      return String(c.cliente_nome || '').toLowerCase().includes(buscaNorm)
    })
  }, [rent, buscaNorm, soAlertas])

  const pedidosFiltrados = useMemo(() => {
    return (rent?.por_pedido || []).filter((p) => {
      if (soAlertas && p.alerta_margem === 'SAUDAVEL') return false
      if (!buscaNorm) return true
      return (
        String(p.codigo || '').toLowerCase().includes(buscaNorm) ||
        String(p.cliente_nome || '').toLowerCase().includes(buscaNorm) ||
        String(p.vendedor_nome || '').toLowerCase().includes(buscaNorm)
      )
    })
  }, [rent, buscaNorm, soAlertas])

  const renderBadgeMargem = (alerta, margemPct) => {
    if (alerta === 'PREJUIZO') {
      return <span className="badge badge--danger">Prejuízo ({fmtPct(margemPct)})</span>
    }
    if (alerta === 'BAIXA') {
      return <span className="badge badge--warning">Baixa ({fmtPct(margemPct)})</span>
    }
    return <span className="badge badge--success">{fmtPct(margemPct)}</span>
  }

  return (
    <div className="fade-in">
      {/* CABEÇALHO */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <BarChart3 className="text-primary" size={26} /> DRE Gerencial &amp; Inteligência de Margens
          </h1>
          <p className="page-header__subtitle">
            Demonstrativo de Resultados, Lucro Real por Pedido/Produto/Cliente e Ranking NRV de Desossa &amp; Frigoríficos
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          <button type="button" className="btn btn--ghost" onClick={exportarCsvDre} disabled={!dre}>
            <Download size={15} /> Exportar Excel (CSV)
          </button>
          <button type="button" className="btn btn--secondary" onClick={imprimirDre} disabled={!dre}>
            <Printer size={15} /> Imprimir DRE
          </button>
          <button type="button" className="btn btn--primary" onClick={carregar} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="DRE Gerencial & Margem Real" />

      {/* BARRA DE PERÍODO & REGIME */}
      <div className="card mb-16" style={{ padding: '12px 14px' }}>
        <div className="flex flex-wrap items-center justify-between gap-12">
          <div className="flex flex-wrap items-center gap-6">
            {[
              { id: 'MES_ATUAL', label: 'Mês Atual' },
              { id: 'MES_ANTERIOR', label: 'Mês Anterior' },
              { id: 'ULTIMOS_30', label: 'Últimos 30d' },
              { id: 'TRIMESTRE', label: 'Trimestre' },
              { id: 'ANO', label: 'Ano' },
            ].map((at) => (
              <button
                key={at.id}
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => aplicarAtalho(at.id)}
              >
                {at.label}
              </button>
            ))}
            <div className="flex items-center gap-6 ml-4">
              <input
                type="date"
                className="form-input"
                style={{ width: 142, height: 34, fontSize: 12, padding: '4px 8px' }}
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
              <span className="text-xs text-muted">até</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 142, height: 34, fontSize: 12, padding: '4px 8px' }}
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <span className="text-xs text-muted font-bold uppercase">Regime:</span>
            <button
              type="button"
              className={`btn btn--sm ${regime === 'COMPETENCIA' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setRegime('COMPETENCIA')}
            >
              Competência (Vendas)
            </button>
            <button
              type="button"
              className={`btn btn--sm ${regime === 'CAIXA' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setRegime('CAIXA')}
            >
              Caixa (Liquidado)
            </button>
          </div>
        </div>
      </div>

      {/* 5 CARDS EXECUTIVOS KPI */}
      <div className="grid gap-12 mb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Receita Líquida</div>
          <div className="text-xl font-bold font-mono text-cyan mt-6">{fmtMoeda(kpis.receita_liquida)}</div>
          <div className="text-xs text-muted mt-4">
            {kpis.qtd_pedidos} pedido(s) • {fmtKg(kpis.volume_vendido_kg)}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">CMV Real (Mercadoria)</div>
          <div className="text-xl font-bold font-mono text-warning mt-6">{fmtMoeda(kpis.cmv_real)}</div>
          <div className="text-xs text-muted mt-4">
            {kpis.receita_liquida > 0
              ? `${fmtPct((kpis.cmv_real / kpis.receita_liquida) * 100)} da receita líquida`
              : 'Sem vendas no período'}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Lucro Bruto</div>
          <div className={`text-xl font-bold font-mono mt-6 ${kpis.lucro_bruto < 0 ? 'text-danger' : 'text-success'}`}>
            {fmtMoeda(kpis.lucro_bruto)}
          </div>
          <div className="text-xs text-muted mt-4">
            Margem Bruta: <strong className="font-mono">{fmtPct(kpis.margem_bruta_pct)}</strong>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Despesas + Comissões</div>
          <div className="text-xl font-bold font-mono text-danger mt-6">
            {fmtMoeda(kpis.despesas_operacionais + kpis.comissoes + kpis.perdas_quarentena)}
          </div>
          <div className="text-xs text-muted mt-4">
            Op.: {fmtMoeda(kpis.despesas_operacionais)} • Com.: {fmtMoeda(kpis.comissoes)}
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: '14px 16px',
            borderColor: kpis.lucro_liquido >= 0 ? 'var(--success)' : 'var(--danger)',
            background:
              kpis.lucro_liquido >= 0
                ? 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(14,165,233,0.06))'
                : 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(245,158,11,0.06))',
          }}
        >
          <div className="flex items-center justify-between text-xs uppercase font-bold">
            <span>Lucro Líquido Real</span>
            {kpis.lucro_liquido >= 0 ? (
              <TrendingUp size={16} className="text-success" />
            ) : (
              <TrendingDown size={16} className="text-danger" />
            )}
          </div>
          <div className={`text-xl font-bold font-mono mt-6 ${kpis.lucro_liquido >= 0 ? 'text-success' : 'text-danger'}`}>
            {fmtMoeda(kpis.lucro_liquido)}
          </div>
          <div className="text-xs mt-4 font-bold">
            Margem Líquida: <span className="font-mono">{fmtPct(kpis.margem_liquida_pct)}</span>
          </div>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex gap-8 flex-wrap mb-16 pb-8 border-b border-border">
        {[
          { id: 'DRE', label: 'DRE Gerencial & Evolução', icon: BarChart3 },
          { id: 'RENTABILIDADE', label: 'Margem por Produto / Cliente / Vendedor', icon: TrendingUp },
          {
            id: 'PEDIDOS',
            label: `Raio-X por Pedido${
              (rent?.resumo?.pedidos_prejuizo || 0) > 0 ? ` (${rent.resumo.pedidos_prejuizo} alerta)` : ''
            }`,
            icon: ClipboardList,
          },
          { id: 'DESOSSA', label: 'Desossa NRV & Ranking Fornecedores', icon: Factory },
        ].map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              className={`btn ${aba === tab.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAba(tab.id)}
            >
              <Icon size={15} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* ABA 1: DRE GERENCIAL */}
      {aba === 'DRE' && (
        <div className="flex flex-col gap-16">
          <div className="grid gap-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
            {/* DEMONSTRATIVO ESTRUTURADO */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="p-14 border-b border-border flex justify-between items-center" style={{ background: 'var(--bg-2)' }}>
                <h3 className="text-sm font-bold m-0">Demonstrativo de Resultado ({regime})</h3>
                <span className="text-xs text-muted font-mono">
                  {fmtData(dataInicio)} → {fmtData(dataFim)}
                </span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 42 }}>#</th>
                      <th>Linha Gerencial</th>
                      <th style={{ textAlign: 'right' }}>Valor (R$)</th>
                      <th style={{ textAlign: 'right', width: 90 }}>% Vert.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dre?.linhas_dre || []).map((l) => {
                      const destaque = l.tipo === 'SUBTOTAL' || l.tipo === 'RESULTADO'
                      const corVal =
                        l.tipo === 'RESULTADO'
                          ? l.valor >= 0
                            ? 'text-success'
                            : 'text-danger'
                          : l.valor < 0
                            ? 'text-danger'
                            : l.tipo === 'RECEITA'
                              ? 'text-cyan'
                              : 'text-primary'
                      return (
                        <tr
                          key={l.codigo}
                          style={
                            l.tipo === 'RESULTADO'
                              ? { background: 'rgba(14,165,233,0.10)', fontWeight: 800 }
                              : l.tipo === 'SUBTOTAL'
                                ? { background: 'rgba(255,255,255,0.03)', fontWeight: 700 }
                                : undefined
                          }
                        >
                          <td className="font-mono text-xs text-muted">{l.codigo}</td>
                          <td className={destaque ? 'font-bold text-sm' : 'text-sm'}>{l.nome}</td>
                          <td style={{ textAlign: 'right' }} className={`font-mono ${destaque ? 'font-bold text-sm' : 'text-xs'} ${corVal}`}>
                            {fmtMoeda(l.valor)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                            {fmtPct(l.pct_receita)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* DESPESAS POR CENTRO DE CUSTO + QUEBRA DESOSSA */}
            <div className="flex flex-col gap-16">
              <div className="card" style={{ padding: 16 }}>
                <h3 className="text-sm font-bold m-0 mb-12">Despesas Operacionais por Centro de Custo</h3>
                {(dre?.despesas_por_centro_custo || []).length === 0 ? (
                  <div className="text-xs text-muted p-16 text-center">
                    Nenhuma despesa operacional (fora compras de mercadoria) lançada neste período.
                  </div>
                ) : (
                  <div className="flex flex-col gap-10">
                    {(dre?.despesas_por_centro_custo || []).map((cc, idx) => {
                      const pctCc =
                        kpis.despesas_operacionais > 0 ? (cc.valor / kpis.despesas_operacionais) * 100 : 0
                      return (
                        <div key={`${cc.codigo}-${idx}`}>
                          <div className="flex justify-between text-xs mb-4">
                            <span className="font-bold">
                              {cc.codigo !== '-' ? `${cc.codigo} — ` : ''}
                              {cc.nome} <span className="text-muted">({cc.qtd}x)</span>
                            </span>
                            <span className="font-mono font-bold text-danger">
                              {fmtMoeda(cc.valor)} <span className="text-muted">({fmtPct(pctCc)})</span>
                            </span>
                          </div>
                          <div style={{ height: 7, borderRadius: 4, background: 'var(--bg-2)', overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.min(100, Math.max(3, pctCc))}%`,
                                background: 'linear-gradient(90deg, #f97316, #ef4444)',
                                borderRadius: 4,
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* INFORMATIVO DESOSSA / QUEBRA */}
              <div className="card" style={{ padding: 16 }}>
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-sm font-bold m-0 flex items-center gap-6">
                    <Factory size={15} className="text-warning" /> Quebra &amp; Rendimento na Desossa (Informativo)
                  </h3>
                  <span className="badge badge--info text-xs">
                    {dre?.informativo_desossa?.qtd_ops_fechadas || 0} OP(s) fechada(s)
                  </span>
                </div>
                <div className="grid gap-10" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div className="p-10 rounded" style={{ background: 'var(--bg-2)' }}>
                    <div className="text-xs text-muted">Entrada MP</div>
                    <div className="font-mono font-bold text-sm mt-2">
                      {fmtKg(dre?.informativo_desossa?.peso_entrada_kg)}
                    </div>
                  </div>
                  <div className="p-10 rounded" style={{ background: 'var(--bg-2)' }}>
                    <div className="text-xs text-muted">Rendimento Real</div>
                    <div className="font-mono font-bold text-sm text-success mt-2">
                      {fmtPct(dre?.informativo_desossa?.rendimento_medio_pct)}
                    </div>
                  </div>
                  <div className="p-10 rounded" style={{ background: 'var(--bg-2)' }}>
                    <div className="text-xs text-muted">Quebra / Ossos</div>
                    <div className="font-mono font-bold text-sm text-warning mt-2">
                      {fmtKg(dre?.informativo_desossa?.quebra_kg)}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted mt-8">
                  Valor estimado da quebra de desossa:{' '}
                  <strong className="font-mono text-warning">
                    {fmtMoeda(dre?.informativo_desossa?.valor_quebra_estimado)}
                  </strong>{' '}
                  (já absorvido no CMV dos cortes via rateio NRV — não duplica no Lucro Líquido).
                </div>
              </div>
            </div>
          </div>

          {/* EVOLUÇÃO DOS ÚLTIMOS 6 MESES */}
          <div className="card" style={{ padding: 16 }}>
            <div className="flex justify-between items-center mb-14 flex-wrap gap-8">
              <h3 className="text-sm font-bold m-0">Evolução Gerencial — Últimos 6 Meses</h3>
              <div className="flex gap-14 text-xs">
                <span className="flex items-center gap-6">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#38bdf8', display: 'inline-block' }} />
                  Receita
                </span>
                <span className="flex items-center gap-6">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
                  CMV + Despesas
                </span>
                <span className="flex items-center gap-6">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#10b981', display: 'inline-block' }} />
                  Lucro Líquido
                </span>
              </div>
            </div>

            <div className="grid gap-12" style={{ gridTemplateColumns: 'repeat(6, minmax(110px, 1fr))', overflowX: 'auto' }}>
              {(dre?.evolucao_mensal || []).map((m) => {
                const custosTot = (m.cmv || 0) + (m.despesas || 0)
                const hRec = Math.max(4, Math.round(((m.receita || 0) / evolucaoMax) * 110))
                const hCus = Math.max(4, Math.round((custosTot / evolucaoMax) * 110))
                const hLuc = Math.max(4, Math.round((Math.abs(m.lucro_liquido || 0) / evolucaoMax) * 110))
                return (
                  <div
                    key={m.mes}
                    className="p-10 rounded flex flex-col items-center"
                    style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-end gap-6" style={{ height: 118 }}>
                      <div
                        title={`Receita: ${fmtMoeda(m.receita)}`}
                        style={{ width: 16, height: hRec, background: '#38bdf8', borderRadius: '3px 3px 0 0' }}
                      />
                      <div
                        title={`CMV + Despesas: ${fmtMoeda(custosTot)}`}
                        style={{ width: 16, height: hCus, background: '#f59e0b', borderRadius: '3px 3px 0 0' }}
                      />
                      <div
                        title={`Lucro Líquido: ${fmtMoeda(m.lucro_liquido)}`}
                        style={{
                          width: 16,
                          height: hLuc,
                          background: m.lucro_liquido >= 0 ? '#10b981' : '#ef4444',
                          borderRadius: '3px 3px 0 0',
                        }}
                      />
                    </div>
                    <div className="text-xs font-bold mt-8">{fmtMesLabel(m.mes)}</div>
                    <div className={`text-xs font-mono font-bold mt-2 ${m.lucro_liquido >= 0 ? 'text-success' : 'text-danger'}`}>
                      {fmtMoeda(m.lucro_liquido)}
                    </div>
                    <div className="text-[11px] text-muted font-mono">{fmtPct(m.margem_liquida_pct)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: RENTABILIDADE POR PRODUTO / CLIENTE / VENDEDOR */}
      {aba === 'RENTABILIDADE' && (
        <div className="flex flex-col gap-12">
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-center justify-between gap-10">
              <div className="flex gap-6 flex-wrap">
                {[
                  { id: 'PRODUTO', label: `Por Produto / Corte (${rent?.por_produto?.length || 0})`, icon: Box },
                  { id: 'CLIENTE', label: `Por Cliente (${rent?.por_cliente?.length || 0})`, icon: Users },
                  { id: 'VENDEDOR', label: `Por Vendedor (${rent?.por_vendedor?.length || 0})`, icon: Briefcase },
                ].map((v) => {
                  const Icon = v.icon
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={`btn btn--sm ${visaoRent === v.id ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setVisaoRent(v.id)}
                    >
                      <Icon size={14} /> {v.label}
                    </button>
                  )
                })}
              </div>

              <div className="flex gap-10 items-center flex-wrap">
                {visaoRent !== 'VENDEDOR' && (
                  <label className="flex items-center gap-6 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={soAlertas}
                      onChange={(e) => setSoAlertas(e.target.checked)}
                    />
                    <span className="text-warning font-bold">Só Alertas (&lt;10% ou Prejuízo)</span>
                  </label>
                )}
                <div style={{ position: 'relative', minWidth: 220 }}>
                  <Search
                    size={14}
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: 32, height: 34, fontSize: 12.5 }}
                    placeholder="Filtrar..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {visaoRent === 'PRODUTO' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto / Corte</th>
                      <th style={{ textAlign: 'right' }}>Volume (kg)</th>
                      <th style={{ textAlign: 'right' }}>Preço Médio/kg</th>
                      <th style={{ textAlign: 'right' }}>Custo Real/kg</th>
                      <th style={{ textAlign: 'right' }}>Receita</th>
                      <th style={{ textAlign: 'right' }}>CMV Real</th>
                      <th style={{ textAlign: 'right' }}>Lucro Bruto</th>
                      <th style={{ textAlign: 'right' }}>Margem %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtosFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center p-24 text-muted">
                          Nenhum produto vendido neste período/filtro.
                        </td>
                      </tr>
                    ) : (
                      produtosFiltrados.map((p) => (
                        <tr key={p.produto_id}>
                          <td>
                            <div className="font-bold text-sm">
                              <span className="font-mono text-cyan">{p.codigo}</span> — {p.descricao}
                            </div>
                            <div className="text-xs text-muted">{p.classificacao || '-'}</div>
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {fmtKg(p.qtd_kg)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {fmtMoeda(p.preco_medio_kg)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs text-warning">
                            {fmtMoeda(p.custo_medio_real_kg)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                            {fmtMoeda(p.receita)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                            {fmtMoeda(p.custo_total)}
                          </td>
                          <td
                            style={{ textAlign: 'right' }}
                            className={`font-mono font-bold text-sm ${p.margem_rs < 0 ? 'text-danger' : 'text-success'}`}
                          >
                            {fmtMoeda(p.margem_rs)}
                          </td>
                          <td style={{ textAlign: 'right' }}>{renderBadgeMargem(p.alerta_margem, p.margem_pct)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {visaoRent === 'CLIENTE' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th style={{ textAlign: 'center' }}>Pedidos</th>
                      <th style={{ textAlign: 'right' }}>Volume (kg)</th>
                      <th style={{ textAlign: 'right' }}>Ticket Médio</th>
                      <th style={{ textAlign: 'right' }}>Receita</th>
                      <th style={{ textAlign: 'right' }}>CMV Real</th>
                      <th style={{ textAlign: 'right' }}>Lucro Bruto</th>
                      <th style={{ textAlign: 'right' }}>Margem %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientesFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center p-24 text-muted">
                          Nenhum cliente com vendas neste período/filtro.
                        </td>
                      </tr>
                    ) : (
                      clientesFiltrados.map((c, idx) => (
                        <tr key={c.cliente_id || idx}>
                          <td className="font-bold text-sm">{c.cliente_nome}</td>
                          <td style={{ textAlign: 'center' }} className="font-mono text-xs">
                            {c.qtd_pedidos}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {fmtKg(c.qtd_kg)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {fmtMoeda(c.ticket_medio)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                            {fmtMoeda(c.receita)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                            {fmtMoeda(c.custo_total)}
                          </td>
                          <td
                            style={{ textAlign: 'right' }}
                            className={`font-mono font-bold text-sm ${c.margem_rs < 0 ? 'text-danger' : 'text-success'}`}
                          >
                            {fmtMoeda(c.margem_rs)}
                          </td>
                          <td style={{ textAlign: 'right' }}>{renderBadgeMargem(c.alerta_margem, c.margem_pct)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {visaoRent === 'VENDEDOR' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th style={{ textAlign: 'center' }}>Pedidos</th>
                      <th style={{ textAlign: 'right' }}>Volume (kg)</th>
                      <th style={{ textAlign: 'right' }}>Receita Vendida</th>
                      <th style={{ textAlign: 'right' }}>CMV Real</th>
                      <th style={{ textAlign: 'right' }}>Lucro Gerado</th>
                      <th style={{ textAlign: 'right' }}>Margem %</th>
                      <th style={{ textAlign: 'right' }}>Comissão Est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rent?.por_vendedor || []).length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center p-24 text-muted">
                          Nenhuma venda registrada neste período.
                        </td>
                      </tr>
                    ) : (
                      (rent?.por_vendedor || []).map((v, idx) => (
                        <tr key={v.vendedor_id || idx}>
                          <td className="font-bold text-sm">{v.vendedor_nome}</td>
                          <td style={{ textAlign: 'center' }} className="font-mono text-xs">
                            {v.qtd_pedidos}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {fmtKg(v.qtd_kg)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                            {fmtMoeda(v.receita)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                            {fmtMoeda(v.custo_total)}
                          </td>
                          <td
                            style={{ textAlign: 'right' }}
                            className={`font-mono font-bold text-sm ${v.margem_rs < 0 ? 'text-danger' : 'text-success'}`}
                          >
                            {fmtMoeda(v.margem_rs)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs">
                            {fmtPct(v.margem_pct)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs text-warning font-bold">
                            {fmtMoeda(v.comissao_estimada)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 3: RAIO-X POR PEDIDO */}
      {aba === 'PEDIDOS' && (
        <div className="flex flex-col gap-12">
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-center justify-between gap-10">
              <div className="flex items-center gap-14 flex-wrap text-xs">
                <span>
                  Pedidos analisados: <strong>{rent?.resumo?.qtd_pedidos || 0}</strong>
                </span>
                <span>
                  Margem Média: <strong className="font-mono text-success">{fmtPct(rent?.resumo?.margem_media_pct)}</strong>
                </span>
                {(rent?.resumo?.pedidos_prejuizo || 0) > 0 && (
                  <span className="badge badge--danger">
                    <AlertTriangle size={12} /> {rent.resumo.pedidos_prejuizo} com Prejuízo
                  </span>
                )}
                {(rent?.resumo?.pedidos_margem_baixa || 0) > 0 && (
                  <span className="badge badge--warning">{rent.resumo.pedidos_margem_baixa} com Margem &lt; 10%</span>
                )}
              </div>

              <div className="flex gap-10 items-center flex-wrap">
                <label className="flex items-center gap-6 text-xs cursor-pointer">
                  <input type="checkbox" checked={soAlertas} onChange={(e) => setSoAlertas(e.target.checked)} />
                  <span className="text-warning font-bold">Só Alertas</span>
                </label>
                <div style={{ position: 'relative', minWidth: 220 }}>
                  <Search
                    size={14}
                    style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: 32, height: 34, fontSize: 12.5 }}
                    placeholder="Pedido, cliente ou vendedor..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pedido / Data</th>
                    <th>Cliente / Vendedor</th>
                    <th>Base do Custo</th>
                    <th style={{ textAlign: 'right' }}>Volume</th>
                    <th style={{ textAlign: 'right' }}>Receita</th>
                    <th style={{ textAlign: 'right' }}>CMV Real</th>
                    <th style={{ textAlign: 'right' }}>Lucro Bruto</th>
                    <th style={{ textAlign: 'right' }}>Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhum pedido encontrado neste período/filtro.
                      </td>
                    </tr>
                  ) : (
                    pedidosFiltrados.map((p) => (
                      <tr key={p.pedido_id}>
                        <td>
                          <div className="font-mono font-bold text-xs text-cyan">{p.codigo}</div>
                          <div className="text-xs text-muted">
                            {fmtData(p.data)} • {p.status}
                          </div>
                        </td>
                        <td>
                          <div className="font-bold text-sm">{p.cliente_nome}</div>
                          <div className="text-xs text-muted">{p.vendedor_nome}</div>
                        </td>
                        <td>
                          {p.custo_origem === 'CAIXAS_REAIS' ? (
                            <span className="badge badge--success" style={{ fontSize: 10 }}>
                              Caixas Reais (Lote/NRV)
                            </span>
                          ) : (
                            <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                              Custo Médio Produto
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtKg(p.qtd_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                          {fmtMoeda(p.receita)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                          {fmtMoeda(p.custo_real)}
                        </td>
                        <td
                          style={{ textAlign: 'right' }}
                          className={`font-mono font-bold text-sm ${p.margem_rs < 0 ? 'text-danger' : 'text-success'}`}
                        >
                          {fmtMoeda(p.margem_rs)}
                        </td>
                        <td style={{ textAlign: 'right' }}>{renderBadgeMargem(p.alerta_margem, p.margem_pct)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 4: DESOSSA NRV & RANKING DE FRIGORÍFICOS / FORNECEDORES */}
      {aba === 'DESOSSA' && (
        <div className="flex flex-col gap-16">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border flex items-center justify-between" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-sm font-bold m-0 flex items-center gap-8">
                <Award size={16} className="text-warning" /> Ranking de Frigoríficos / Fornecedores por Rendimento &amp; Custo Aproveitado
              </h3>
              <span className="text-xs text-muted">Ordenado pelo maior rendimento real pós-desossa</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>Pos.</th>
                    <th>Frigorífico / Fornecedor</th>
                    <th style={{ textAlign: 'center' }}>OPs</th>
                    <th style={{ textAlign: 'right' }}>MP Entrada</th>
                    <th style={{ textAlign: 'right' }}>Aproveitado</th>
                    <th style={{ textAlign: 'right' }}>Rendimento %</th>
                    <th style={{ textAlign: 'right' }}>Perda %</th>
                    <th style={{ textAlign: 'right' }}>Custo MP/kg</th>
                    <th style={{ textAlign: 'right' }}>Custo Real Aproveitado/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {(desossa.ranking_fornecedores || []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center p-24 text-muted">
                        Nenhuma Ordem de Produção fechada com insumos vinculados a fornecedor neste período.
                      </td>
                    </tr>
                  ) : (
                    desossa.ranking_fornecedores.map((f, idx) => (
                      <tr key={f.fornecedor_id}>
                        <td className="font-mono font-bold text-center">
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                        </td>
                        <td className="font-bold text-sm">{f.fornecedor_nome}</td>
                        <td style={{ textAlign: 'center' }} className="font-mono text-xs">
                          {f.qtd_ops}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtKg(f.peso_entrada_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtKg(f.peso_aproveitado_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`badge ${f.rendimento_medio_pct >= 75 ? 'badge--success' : 'badge--warning'}`}>
                            {fmtPct(f.rendimento_medio_pct)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs text-danger">
                          {fmtPct(f.perda_media_pct)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(f.custo_medio_mp_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm text-cyan">
                          {fmtMoeda(f.custo_efetivo_aproveitado_kg)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-sm font-bold m-0">Ordens de Produção Fechadas — Custo NRV &amp; Margem Industrial</h3>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>OP / Data</th>
                    <th>Método</th>
                    <th style={{ textAlign: 'right' }}>Entrada MP</th>
                    <th style={{ textAlign: 'right' }}>Retorno Cortes</th>
                    <th style={{ textAlign: 'right' }}>Rendimento</th>
                    <th style={{ textAlign: 'right' }}>Custo Total OP</th>
                    <th style={{ textAlign: 'right' }}>Receita Est.</th>
                    <th style={{ textAlign: 'right' }}>Margem NRV</th>
                  </tr>
                </thead>
                <tbody>
                  {(desossa.ops || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhuma OP fechada neste período.
                      </td>
                    </tr>
                  ) : (
                    desossa.ops.map((o) => (
                      <tr key={o.op_id}>
                        <td>
                          <div className="font-mono font-bold text-xs text-cyan">{o.op_codigo}</div>
                          <div className="text-xs text-muted">
                            {o.op_nome} • {fmtData(o.data_producao)}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge--info" style={{ fontSize: 10 }}>
                            {o.metodo_rateio}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtKg(o.peso_insumos_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtKg(o.peso_retornos_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs text-success">
                          {fmtPct(o.rendimento_pct)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(o.custo_total_op)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                          {fmtMoeda(o.receita_estimada_total)}
                        </td>
                        <td
                          style={{ textAlign: 'right' }}
                          className={`font-mono font-bold text-sm ${o.margem_bruta_rs < 0 ? 'text-danger' : 'text-success'}`}
                        >
                          {fmtMoeda(o.margem_bruta_rs)}{' '}
                          <span className="text-xs">({fmtPct(o.margem_bruta_pct)})</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
