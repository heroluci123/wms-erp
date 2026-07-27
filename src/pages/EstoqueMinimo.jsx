import React, { useState, useEffect, useCallback } from 'react'
import { TrendingDown, AlertTriangle, CheckCircle, Package, ShoppingCart, RefreshCw, Filter, Search, ChevronDown, ChevronRight, Download, Layers, ShieldAlert, Clock, ArrowRight } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as estoqueMinimoQueries from '../queries/estoqueMinimo.js'

export function EstoqueMinimo() {
  const { toastSuccess, toastError } = useAppStore()

  const [loading, setLoading] = useState(true)
  const [dados, setDados] = useState(null)

  // Parâmetros de Filtro
  const [diasAnalise, setDiasAnalise] = useState(15)
  const [leadTime, setLeadTime] = useState(5)
  const [margemSeguranca, setMargemSeguranca] = useState(20)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos') // todos | CRITICO | ALERTA | OK

  // Estado de expansão de sanfona por produto
  const [expandidos, setExpandidos] = useState({})

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const res = await estoqueMinimoQueries.buscarEstoqueMinimoDinamico({
        diasAnalise: parseInt(diasAnalise),
        leadTimePadrao: parseInt(leadTime),
        margemSegurancaPct: parseFloat(margemSeguranca)
      })
      setDados(res)
    } catch (err) {
      toastError('Erro', 'Falha ao calcular estoque mínimo dinâmico')
    } finally {
      setLoading(false)
    }
  }, [diasAnalise, leadTime, margemSeguranca, toastError])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  const toggleExpandir = (id) => {
    setExpandidos(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const exportarCSV = () => {
    if (!dados || !dados.itens) return
    const cabecalho = 'ID;Codigo;Descricao;Grupo;Estoque_Atual_KG;Consumo_Diario_KG;Estoque_Minimo_KG;Dias_Cobertura;Sugestao_Compra_KG;Status\n'
    const linhas = dados.itens.map(i =>
      `${i.id};"${i.codigo || ''}";"${i.descricao}";"${i.grupo || ''}";${i.estoque_kg};${i.consumo_diario_kg};${i.estoque_minimo_kg};${i.dias_cobertura};${i.sugestao_compra_kg};${i.status}`
    ).join('\n')

    const blob = new Blob([cabecalho + linhas], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `estoque_minimo_${new Date().toISOString().substring(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess('Relatório Exportado', 'Arquivo CSV gerado com sucesso.')
  }

  if (loading && !dados) {
    return (
      <div className="flex justify-center items-center py-64 text-muted">
        <RefreshCw size={24} className="animate-spin" style={{ marginRight: 12 }} />
        Calculando Estoque Mínimo Dinâmico...
      </div>
    )
  }

  const kpis = dados?.kpis || { totalCriticos: 0, totalAlertas: 0, totalOk: 0, totalSugestaoCompraKg: 0, totalMatériasPrimas: 0 }
  const itens = dados?.itens || []

  // Filtrar itens na busca e no status
  const itensFiltrados = itens.filter(i => {
    const atendeBusca = !busca.trim() ||
      i.descricao.toLowerCase().includes(busca.toLowerCase()) ||
      (i.codigo && i.codigo.toLowerCase().includes(busca.toLowerCase())) ||
      (i.grupo && i.grupo.toLowerCase().includes(busca.toLowerCase()))

    const atendeStatus = filtroStatus === 'todos' || i.status === filtroStatus
    return atendeBusca && atendeStatus
  })

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <TrendingDown size={24} style={{ color: 'var(--primary)' }} />
            Estoque Mínimo Dinâmico
          </h1>
          <p className="page-header__subtitle">
            Cálculo em tempo real do ponto de reabastecimento baseado no ritmo de consumo (OP & Saídas)
          </p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--ghost" onClick={carregarDados} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button className="btn btn--primary" onClick={exportarCSV}>
            <Download size={16} /> Exportar Lista de Compras
          </button>
        </div>
      </div>

      {/* ── Cards de Indicadores (KPIs) ────────────────────────────────────── */}
      <div className="kpi-grid mb-16">
        {/* Crítico */}
        <div className="kpi-card" style={{ borderColor: 'var(--danger)', background: 'linear-gradient(135deg, rgba(239,68,68,0.1), transparent)' }}>
          <span className="kpi-card__label text-danger flex items-center gap-6">
            <ShieldAlert size={14} /> Repor Urgente (Abaixo do Mínimo)
          </span>
          <span className="kpi-card__value text-danger">{kpis.totalCriticos}</span>
          <span className="kpi-card__sub">matérias-primas em risco de parada</span>
        </div>

        {/* Alerta */}
        <div className="kpi-card" style={{ borderColor: 'var(--warning)', background: 'linear-gradient(135deg, rgba(251,191,36,0.1), transparent)' }}>
          <span className="kpi-card__label text-warning flex items-center gap-6">
            <AlertTriangle size={14} /> Ponto de Pedido (Alerta)
          </span>
          <span className="kpi-card__value text-warning">{kpis.totalAlertas}</span>
          <span className="kpi-card__sub">próximos do limite de segurança</span>
        </div>

        {/* OK */}
        <div className="kpi-card" style={{ borderColor: 'var(--success)', background: 'linear-gradient(135deg, rgba(34,197,94,0.1), transparent)' }}>
          <span className="kpi-card__label text-success flex items-center gap-6">
            <CheckCircle size={14} /> Estoque Confortável
          </span>
          <span className="kpi-card__value text-success">{kpis.totalOk}</span>
          <span className="kpi-card__sub">matérias-primas com saldo ideal</span>
        </div>

        {/* Sugestão de Compra */}
        <div className="kpi-card" style={{ borderColor: 'var(--primary)', background: 'linear-gradient(135deg, rgba(59,130,246,0.1), transparent)' }}>
          <span className="kpi-card__label text-primary flex items-center gap-6">
            <ShoppingCart size={14} /> Sugestão Total de Compra
          </span>
          <span className="kpi-card__value text-primary">
            {kpis.totalSugestaoCompraKg.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} <span style={{ fontSize: 16 }}>kg</span>
          </span>
          <span className="kpi-card__sub">necessidade estimada de reabastecimento</span>
        </div>
      </div>

      {/* ── Painel de Configurações de Cálculo ────────────────────────────── */}
      <div className="card mb-16" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs text-muted font-bold uppercase tracking-widest mb-12 flex items-center gap-8">
          <Filter size={14} /> Parâmetros do Algoritmo de Suprimento
        </div>
        <div className="flex gap-16 flex-wrap items-end">

          {/* Período de Consumo */}
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label text-xs">Janela de Histórico</label>
            <select
              className="form-input"
              value={diasAnalise}
              onChange={e => setDiasAnalise(e.target.value)}
            >
              <option value={7}>Últimos 7 dias (Semanal)</option>
              <option value={15}>Últimos 15 dias (Quinzenal)</option>
              <option value={30}>Últimos 30 dias (Mensal)</option>
              <option value={60}>Últimos 60 dias (Bimestral)</option>
            </select>
          </div>

          {/* Lead Time do Fornecedor */}
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label text-xs">Prazo Fornecedor (Lead Time)</label>
            <select
              className="form-input"
              value={leadTime}
              onChange={e => setLeadTime(e.target.value)}
            >
              <option value={3}>3 dias (Entrega Rápida)</option>
              <option value={5}>5 dias (Padrão Frigorífico)</option>
              <option value={7}>7 dias (1 semana)</option>
              <option value={10}>10 dias (Regiões Afastadas)</option>
              <option value={14}>14 dias (2 semanas)</option>
            </select>
          </div>

          {/* Margem de Segurança */}
          <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
            <label className="form-label text-xs">Margem de Segurança %</label>
            <select
              className="form-input"
              value={margemSeguranca}
              onChange={e => setMargemSeguranca(e.target.value)}
            >
              <option value={10}>+ 10% de Buffer</option>
              <option value={20}>+ 20% de Buffer (Recomendado)</option>
              <option value={30}>+ 30% de Buffer (Alta Segurança)</option>
            </select>
          </div>

          {/* Busca por Texto */}
          <div className="form-group" style={{ flex: 2, minWidth: 220 }}>
            <label className="form-label text-xs">Buscar Matéria-Prima</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: FILE MIGNON, COXAO MOLE, FRANGO..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
              <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--text-muted)' }} />
            </div>
          </div>

        </div>
      </div>

      {/* ── Filtros por Status & Tabela ────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-12 flex-wrap gap-12">
        <div className="flex gap-8">
          <button
            className={`btn btn--sm ${filtroStatus === 'todos' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('todos')}
          >
            Todas Matérias-Primas ({itens.length})
          </button>
          <button
            className={`btn btn--sm ${filtroStatus === 'CRITICO' ? 'btn--danger' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('CRITICO')}
          >
            🔴 Críticos ({kpis.totalCriticos})
          </button>
          <button
            className={`btn btn--sm ${filtroStatus === 'ALERTA' ? 'btn--warning' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('ALERTA')}
          >
            🟡 Alertas ({kpis.totalAlertas})
          </button>
          <button
            className={`btn btn--sm ${filtroStatus === 'OK' ? 'btn--success' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('OK')}
          >
            🟢 Confortável ({kpis.totalOk})
          </button>
        </div>
        <div className="text-xs text-muted font-mono">
          Exibindo {itensFiltrados.length} matérias-primas
        </div>
      </div>

      {/* ── Tabela de Matérias-Primas (Painel Principal) ────────────────────── */}
      <div className="flex-col gap-10 mb-32">
        {itensFiltrados.length === 0 ? (
          <div className="card text-center text-muted py-32">Nenhuma matéria-prima encontrada com os filtros atuais.</div>
        ) : (
          itensFiltrados.map(item => {
            const isExpanded = !!expandidos[item.id]

            let badgeStyle = { bg: 'rgba(34,197,94,0.15)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.3)', label: 'Estoque OK' }
            let borderLeftColor = 'var(--success)'

            if (item.status === 'CRITICO') {
              badgeStyle = { bg: 'rgba(239,68,68,0.15)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', label: 'Repor Urgente' }
              borderLeftColor = 'var(--danger)'
            } else if (item.status === 'ALERTA') {
              badgeStyle = { bg: 'rgba(251,191,36,0.15)', color: 'var(--warning)', border: '1px solid rgba(251,191,36,0.3)', label: 'Ponto de Pedido' }
              borderLeftColor = 'var(--warning)'
            }

            return (
              <div
                key={item.id}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderLeft: `5px solid ${borderLeftColor}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                }}
              >
                {/* Linha Resumo do Pai */}
                <div
                  onClick={() => toggleExpandir(item.id)}
                  style={{
                    padding: '16px 20px',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(220px, 2fr) 1fr 1fr 1fr 1fr 1fr auto',
                    alignItems: 'center',
                    gap: 16,
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: isExpanded ? 'var(--bg-2)' : 'transparent',
                    transition: 'background 0.15s'
                  }}
                >
                  {/* Nome & Grupo */}
                  <div className="flex items-center gap-12">
                    <div style={{ color: 'var(--text-muted)' }}>
                      {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </div>
                    <div>
                      <div className="font-bold text-base text-primary flex items-center gap-8">
                        {item.descricao}
                        {item.grupo && <span className="badge" style={{ fontSize: 10, background: 'var(--bg-1)' }}>{item.grupo}</span>}
                      </div>
                      <div className="text-xs text-muted font-mono mt-2">Cód: {item.codigo || '-'} | Matéria-Prima In Natura</div>
                    </div>
                  </div>

                  {/* Estoque Atual */}
                  <div>
                    <div className="text-xs text-muted mb-2">Estoque Atual</div>
                    <div className="font-bold text-base">{item.estoque_kg.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} <span className="text-xs text-muted">kg</span></div>
                    <div className="text-xs text-muted">{item.estoque_caixas} cx</div>
                  </div>

                  {/* Consumo Diário */}
                  <div>
                    <div className="text-xs text-muted mb-2">Consumo Diário</div>
                    <div className="font-bold text-base text-warning">{item.consumo_diario_kg.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} <span className="text-xs text-muted">kg/dia</span></div>
                    <div className="text-xs text-muted">Média {diasAnalise} dias</div>
                  </div>

                  {/* Estoque Mínimo */}
                  <div>
                    <div className="text-xs text-muted mb-2">Estoque Mínimo</div>
                    <div className="font-bold text-base text-cyan">{item.estoque_minimo_kg.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} <span className="text-xs text-muted">kg</span></div>
                    <div className="text-xs text-muted">Lead Time: {leadTime}d (+{margemSeguranca}%)</div>
                  </div>

                  {/* Cobertura (Runway) */}
                  <div>
                    <div className="text-xs text-muted mb-2">Cobertura (Runway)</div>
                    <div className="font-bold text-base flex items-center gap-4" style={{ color: item.dias_cobertura < leadTime ? 'var(--danger)' : 'var(--text)' }}>
                      <Clock size={14} />
                      {item.dias_cobertura > 365 ? '365+ dias' : `${item.dias_cobertura} dias`}
                    </div>
                  </div>

                  {/* Sugestão de Compra */}
                  <div>
                    <div className="text-xs text-muted mb-2">Sugestão de Compra</div>
                    {item.sugestao_compra_kg > 0 ? (
                      <div className="font-bold text-base text-danger flex items-center gap-4">
                        <ShoppingCart size={14} />
                        {item.sugestao_compra_kg.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} kg
                      </div>
                    ) : (
                      <div className="text-success text-xs font-bold">Sem necessidade</div>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div>
                    <span style={{
                      background: badgeStyle.bg,
                      color: badgeStyle.color,
                      border: badgeStyle.border,
                      borderRadius: 99,
                      padding: '4px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: 'nowrap'
                    }}>
                      {badgeStyle.label}
                    </span>
                  </div>
                </div>

                {/* Detalhamento de Fontes de Consumo (Expansão) */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-1)', padding: '16px 20px' }}>
                    <div className="text-xs text-muted font-bold uppercase tracking-widest mb-12 flex items-center gap-6">
                      <Layers size={14} style={{ color: 'var(--primary)' }} />
                      Origem da Demanda e Consumo nos últimos {diasAnalise} dias
                    </div>

                    {item.detalhamento.length === 0 ? (
                      <div className="text-xs text-muted italic">Nenhuma baixa ou saída registrada nesta janela de {diasAnalise} dias.</div>
                    ) : (
                      <table style={{ margin: 0, fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Origem do Consumo</th>
                            <th>Tipo de Produto Derivado</th>
                            <th style={{ textAlign: 'right' }}>Total Consumido (KG)</th>
                            <th style={{ textAlign: 'right' }}>Participação no Consumo Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.detalhamento.map((det, idx) => {
                            const pctConsumo = item.consumo_total_kg > 0 ? Math.round((det.kg / item.consumo_total_kg) * 100) : 0
                            return (
                              <tr key={idx}>
                                <td>
                                  <div className="font-bold">{det.descricao}</div>
                                  <div className="text-xs text-muted">{det.origem}</div>
                                </td>
                                <td>
                                  <span className="badge" style={{ fontSize: 10, background: 'var(--bg-2)' }}>{det.tipo_produto || 'Insumo'}</span>
                                </td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--warning)' }}>
                                  {det.kg.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className="flex items-center justify-end gap-8">
                                    <div style={{ width: 60, height: 6, background: 'var(--bg-2)', borderRadius: 99, overflow: 'hidden' }}>
                                      <div style={{ width: `${pctConsumo}%`, height: '100%', background: 'var(--primary)' }} />
                                    </div>
                                    <span className="font-bold text-xs">{pctConsumo}%</span>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
