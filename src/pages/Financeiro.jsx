import React, { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Ban,
  CheckCircle2,
  Coins,
  DollarSign,
  Landmark,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { financeiroQueries } from '../queries/financeiro'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalBaixaTitulo } from '../components/financeiro/ModalBaixaTitulo'
import { ModalNovoTitulo } from '../components/financeiro/ModalNovoTitulo'
import { AbaContasBancos, AbaFluxoCaixa } from '../components/financeiro/AbaFluxoBancos'
import { AbaComissoesInadimplencia } from '../components/financeiro/AbaComissoesInadimplencia'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const ORIGEM_LABEL = {
  MANUAL: 'Manual',
  COMPRA_PC: 'Pedido Compra',
  COMPRA_NFE_XML: 'NF-e XML',
  VENDA_PEDIDO: 'Pedido Venda',
  DEVOLUCAO: 'Devolução',
  COMISSAO: 'Comissão',
}

export function Financeiro() {
  const { toastSuccess, toastError, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()

  const [aba, setAba] = useState('PAGAR') // 'PAGAR' | 'RECEBER' | 'FLUXO' | 'BANCOS' | 'COMISSOES'
  const [dashboard, setDashboard] = useState(null)
  const [contas, setContas] = useState([])
  const [fornecedores, setFornecedores] = useState([])
  const [clientes, setClientes] = useState([])
  const [auxiliares, setAuxiliares] = useState({ centrosCusto: [], locaisCobranca: [] })

  // Filtros e lista de títulos (Pagar / Receber)
  const [statusFiltro, setStatusFiltro] = useState('EM_ABERTO')
  const [busca, setBusca] = useState('')
  const [centroCustoFiltro, setCentroCustoFiltro] = useState('')
  const [titulos, setTitulos] = useState([])
  const [resumoTitulos, setResumoTitulos] = useState({
    total_registros: 0,
    total_original: 0,
    total_pago: 0,
    total_aberto: 0,
    total_vencido: 0,
  })
  const [loading, setLoading] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)

  // Modais
  const [modalNovoTipo, setModalNovoTipo] = useState(null) // 'PAGAR' | 'RECEBER' | null
  const [tituloBaixa, setTituloBaixa] = useState(null)

  const carregarBase = useCallback(async () => {
    if (!apiAtiva) return
    try {
      const [dash, listContas, listForn, listCli, aux] = await Promise.all([
        financeiroQueries.obterDashboard(30),
        financeiroQueries.listarContas(),
        cadastrosQueries.listarFornecedores().catch(() => []),
        cadastrosQueries.listarClientes().catch(() => []),
        cadastrosQueries.listarAuxiliares().catch(() => ({ centrosCusto: [], locaisCobranca: [] })),
      ])
      setDashboard(dash)
      setContas(listContas || [])
      setFornecedores(listForn || [])
      setClientes(listCli || [])
      setAuxiliares(aux || { centrosCusto: [], locaisCobranca: [] })
    } catch (err) {
      toastError('Erro ao carregar financeiro', err.message)
    }
  }, [apiAtiva, toastError])

  const carregarTitulos = useCallback(async () => {
    if (!apiAtiva || (aba !== 'PAGAR' && aba !== 'RECEBER')) return
    setLoading(true)
    try {
      const res = await financeiroQueries.listarTitulos({
        tipo: aba,
        status: statusFiltro,
        busca: busca || undefined,
        centro_custo_id: centroCustoFiltro || undefined,
      })
      setTitulos(res?.data || [])
      setResumoTitulos(
        res?.resumo || {
          total_registros: 0,
          total_original: 0,
          total_pago: 0,
          total_aberto: 0,
          total_vencido: 0,
        },
      )
    } catch (err) {
      toastError('Erro ao carregar títulos', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, aba, statusFiltro, busca, centroCustoFiltro, toastError])

  useEffect(() => {
    carregarBase()
  }, [carregarBase])

  useEffect(() => {
    carregarTitulos()
  }, [carregarTitulos])

  const atualizarTudo = async () => {
    await Promise.all([carregarBase(), carregarTitulos()])
  }

  const handleSincronizarOperacional = async () => {
    setSincronizando(true)
    try {
      const res = await financeiroQueries.sincronizarOperacional()
      toastSuccess(
        'Sincronização Concluída ✅',
        `Gerados ${res.receber_gerados || 0} título(s) a Receber e ${res.pagar_gerados || 0} título(s) a Pagar a partir de Vendas, Compras e XMLs.`,
      )
      await atualizarTudo()
    } catch (err) {
      toastError('Erro na sincronização', err.message)
    } finally {
      setSincronizando(false)
    }
  }

  const handleEstornar = async (t) => {
    const ok = await confirmar({
      title: `Estornar Baixa (${t.codigo})`,
      message: `Deseja estornar a liquidação de ${fmtMoeda(t.valor_pago)} do título "${t.descricao}"? O saldo da conta bancária será revertido automaticamente.`,
      type: 'error',
      confirmLabel: 'Sim, Estornar',
    })
    if (!ok) return
    try {
      await financeiroQueries.estornarTitulo(t.id, 'Estorno manual pelo financeiro')
      toastSuccess('Estornado', `${t.codigo} reaberto e saldo bancário recalculado.`)
      await atualizarTudo()
    } catch (err) {
      toastError('Erro ao estornar', err.message)
    }
  }

  const handleCancelar = async (t) => {
    const ok = await confirmar({
      title: `Cancelar Título (${t.codigo})`,
      message: `Confirma o cancelamento de "${t.descricao}" (${fmtMoeda(t.valor_original)})?`,
      type: 'error',
      confirmLabel: 'Cancelar Título',
    })
    if (!ok) return
    try {
      await financeiroQueries.cancelarTitulo(t.id, 'Cancelado pelo operador')
      toastSuccess('Cancelado', `Título ${t.codigo} cancelado.`)
      await atualizarTudo()
    } catch (err) {
      toastError('Erro ao cancelar', err.message)
    }
  }

  const kpis = dashboard?.kpis || {
    saldo_bancos: 0,
    receber_aberto: 0,
    receber_vencido: 0,
    receber_hoje: 0,
    pagar_aberto: 0,
    pagar_vencido: 0,
    pagar_hoje: 0,
    saldo_projetado: 0,
  }

  const renderStatusBadge = (t) => {
    if (t.status === 'PAGO') return <span className="badge badge--success">Liquidado ✅</span>
    if (t.status === 'CANCELADO') return <span className="badge badge--neutral">Cancelado</span>
    if (t.vencido) return <span className="badge badge--danger">Vencido ({t.dias_atraso}d)</span>
    if (t.vence_hoje) return <span className="badge badge--warning">Vence Hoje</span>
    if (t.status === 'PARCIAL') return <span className="badge badge--info">Parcial</span>
    return <span className="badge badge--info">Em Aberto</span>
  }

  return (
    <div className="fade-in" style={{ width: '100%' }}>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <DollarSign className="text-success" size={26} /> Financeiro — Pagar, Receber &amp; Caixa
          </h1>
          <p className="page-header__subtitle">
            Integrado automaticamente aos Pedidos de Compra, XML NF-e, Pedidos de Venda, Pagamento na Entrega e Comissões
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!apiAtiva || sincronizando}
            onClick={handleSincronizarOperacional}
            title="Importa pedidos de venda, compras e XMLs anteriores que ainda não geraram títulos"
          >
            <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />{' '}
            {sincronizando ? 'Sincronizando...' : 'Sincronizar Compras & Vendas'}
          </button>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            disabled={!apiAtiva}
            onClick={() => setModalNovoTipo('PAGAR')}
          >
            <Plus size={15} /> Nova Conta a Pagar
          </button>
          <button
            type="button"
            className="btn btn--success btn--sm"
            disabled={!apiAtiva}
            onClick={() => setModalNovoTipo('RECEBER')}
          >
            <Plus size={15} /> Nova Conta a Receber
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Financeiro" />

      {/* KPIs PRINCIPAIS */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="flex justify-between items-center text-xs text-muted uppercase font-bold">
            <span>Saldo em Bancos &amp; Caixa</span>
            <Wallet size={16} className="text-cyan" />
          </div>
          <div className={`text-xl font-bold font-mono mt-6 ${kpis.saldo_bancos < 0 ? 'text-danger' : 'text-cyan'}`}>
            {fmtMoeda(kpis.saldo_bancos)}
          </div>
          <div className="text-xs text-muted mt-4">{contas.length} conta(s) ativa(s)</div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="flex justify-between items-center text-xs text-muted uppercase font-bold">
            <span>Contas a Receber</span>
            <ArrowDownCircle size={16} className="text-success" />
          </div>
          <div className="text-xl font-bold font-mono text-success mt-6">{fmtMoeda(kpis.receber_aberto)}</div>
          <div className="text-xs mt-4 flex gap-8 flex-wrap">
            <span className={kpis.receber_vencido > 0 ? 'text-danger font-bold' : 'text-muted'}>
              Vencido: {fmtMoeda(kpis.receber_vencido)}
            </span>
            <span className="text-muted">Hoje: {fmtMoeda(kpis.receber_hoje)}</span>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="flex justify-between items-center text-xs text-muted uppercase font-bold">
            <span>Contas a Pagar</span>
            <ArrowUpCircle size={16} className="text-danger" />
          </div>
          <div className="text-xl font-bold font-mono text-warning mt-6">{fmtMoeda(kpis.pagar_aberto)}</div>
          <div className="text-xs mt-4 flex gap-8 flex-wrap">
            <span className={kpis.pagar_vencido > 0 ? 'text-danger font-bold' : 'text-muted'}>
              Vencido: {fmtMoeda(kpis.pagar_vencido)}
            </span>
            <span className="text-muted">Hoje: {fmtMoeda(kpis.pagar_hoje)}</span>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="flex justify-between items-center text-xs text-muted uppercase font-bold">
            <span>Saldo Projetado Total</span>
            <TrendingUp size={16} className="text-primary" />
          </div>
          <div className={`text-xl font-bold font-mono mt-6 ${kpis.saldo_projetado < 0 ? 'text-danger' : 'text-primary'}`}>
            {fmtMoeda(kpis.saldo_projetado)}
          </div>
          <div className="text-xs text-muted mt-4">Caixa + Receber − Pagar</div>
        </div>
      </div>

      {/* NAVEGAÇÃO POR ABAS */}
      <div className="flex gap-8 flex-wrap mb-16 pb-8 border-b border-border">
        {[
          { id: 'PAGAR', label: 'Contas a Pagar', icon: ArrowUpCircle },
          { id: 'RECEBER', label: 'Contas a Receber', icon: ArrowDownCircle },
          { id: 'FLUXO', label: 'Fluxo de Caixa & Extrato', icon: TrendingUp },
          { id: 'BANCOS', label: 'Contas & Bancos', icon: Landmark },
          { id: 'COMISSOES', label: 'Comissões & Inadimplência', icon: Coins },
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

      {/* ABAS 1 E 2: CONTAS A PAGAR / CONTAS A RECEBER */}
      {(aba === 'PAGAR' || aba === 'RECEBER') && (
        <div className="flex flex-col gap-12">
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-center justify-between gap-10">
              <div className="flex gap-6 flex-wrap">
                {[
                  { id: 'EM_ABERTO', label: 'Em Aberto' },
                  { id: 'VENCIDO', label: 'Vencidos' },
                  { id: 'HOJE', label: 'Vence Hoje' },
                  { id: 'PAGO', label: aba === 'PAGAR' ? 'Pagos' : 'Recebidos' },
                  { id: 'TODOS', label: 'Todos' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`btn btn--sm ${statusFiltro === f.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setStatusFiltro(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-8 flex-wrap items-center">
                <div style={{ position: 'relative', minWidth: 230 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: 32, height: 34, fontSize: 12.5 }}
                    placeholder={aba === 'PAGAR' ? 'Fornecedor, NF, PC ou descrição...' : 'Cliente, pedido ou descrição...'}
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </div>
                {aba === 'PAGAR' && (
                  <select
                    className="form-input"
                    style={{ width: 200, height: 34, fontSize: 12.5, padding: '4px 8px' }}
                    value={centroCustoFiltro}
                    onChange={(e) => setCentroCustoFiltro(e.target.value)}
                  >
                    <option value="">Todos Centros de Custo</option>
                    {(auxiliares.centrosCusto || []).map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.codigo} — {cc.descricao}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex gap-16 flex-wrap text-xs text-muted mt-10 pt-8 border-t border-border">
              <span>
                Registros: <strong>{resumoTitulos.total_registros}</strong>
              </span>
              <span>
                Total Original: <strong className="font-mono">{fmtMoeda(resumoTitulos.total_original)}</strong>
              </span>
              <span>
                {aba === 'PAGAR' ? 'Pago' : 'Recebido'}:{' '}
                <strong className="font-mono text-success">{fmtMoeda(resumoTitulos.total_pago)}</strong>
              </span>
              <span>
                Saldo Aberto: <strong className="font-mono text-cyan">{fmtMoeda(resumoTitulos.total_aberto)}</strong>
              </span>
              {resumoTitulos.total_vencido > 0 && (
                <span className="text-danger">
                  Vencido: <strong className="font-mono">{fmtMoeda(resumoTitulos.total_vencido)}</strong>
                </span>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cód. / Origem</th>
                    <th>Vencimento</th>
                    <th>{aba === 'PAGAR' ? 'Fornecedor / Centro Custo' : 'Cliente / Vendedor'}</th>
                    <th>Descrição / Doc.</th>
                    <th style={{ textAlign: 'right' }}>Original</th>
                    <th style={{ textAlign: 'right' }}>Saldo Aberto</th>
                    <th>Situação</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Carregando títulos...
                      </td>
                    </tr>
                  ) : titulos.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhum título encontrado neste filtro. Use <strong>Sincronizar Compras &amp; Vendas</strong> ou crie um lançamento manual.
                      </td>
                    </tr>
                  ) : (
                    titulos.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <div className="font-mono font-bold text-xs text-cyan">{t.codigo}</div>
                          <div className="text-xs text-muted">{ORIGEM_LABEL[t.origem] || t.origem}</div>
                        </td>
                        <td>
                          <div className={`font-mono font-bold text-xs ${t.vencido ? 'text-danger' : ''}`}>
                            {fmtData(t.data_vencimento)}
                          </div>
                          {t.data_pagamento && (
                            <div className="text-xs text-success">Baixa: {fmtData(t.data_pagamento)}</div>
                          )}
                        </td>
                        <td>
                          <div className="font-bold text-sm">
                            {t.parceiro_nome || '-'}
                            {Number(t.cliente_bloqueado) === 1 && (
                              <span className="badge badge--danger ml-6" style={{ marginLeft: 6 }}>
                                Bloq.
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted">
                            {aba === 'PAGAR' ? t.centro_custo_nome || '-' : t.vendedor_nome || '-'}
                          </div>
                        </td>
                        <td>
                          <div className="text-sm">{t.descricao}</div>
                          <div className="text-xs text-muted font-mono">
                            {t.numero_documento || t.pedido_venda_codigo || t.pedido_compra_codigo || '-'}
                            {t.conta_bancaria_nome ? ` • ${t.conta_bancaria_nome}` : ''}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(t.valor_original)}
                        </td>
                        <td
                          style={{ textAlign: 'right' }}
                          className={`font-mono font-bold text-sm ${
                            t.saldo_aberto > 0 ? (t.vencido ? 'text-danger' : 'text-primary') : 'text-success'
                          }`}
                        >
                          {fmtMoeda(t.saldo_aberto)}
                        </td>
                        <td>{renderStatusBadge(t)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex justify-end gap-6">
                            {(t.status === 'ABERTO' || t.status === 'PARCIAL') && (
                              <button
                                type="button"
                                className="btn btn--success btn--sm"
                                onClick={() => setTituloBaixa(t)}
                              >
                                <CheckCircle2 size={13} /> {aba === 'PAGAR' ? 'Pagar' : 'Receber'}
                              </button>
                            )}
                            {(t.status === 'PAGO' || t.status === 'PARCIAL') && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                title="Estornar baixa"
                                onClick={() => handleEstornar(t)}
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                            {t.status === 'ABERTO' && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm text-danger"
                                title="Cancelar título"
                                onClick={() => handleCancelar(t)}
                              >
                                <Ban size={13} />
                              </button>
                            )}
                          </div>
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

      {/* ABA 3: FLUXO DE CAIXA & EXTRATO */}
      {aba === 'FLUXO' && (
        <AbaFluxoCaixa
          contas={contas}
          fluxoProjetado={dashboard?.fluxo_projetado || []}
          onAtualizar={atualizarTudo}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}

      {/* ABA 4: CONTAS & BANCOS (ENXUTO) */}
      {aba === 'BANCOS' && (
        <AbaContasBancos
          contas={contas}
          locaisCobranca={auxiliares.locaisCobranca || []}
          onAtualizar={atualizarTudo}
          toastSuccess={toastSuccess}
          toastError={toastError}
          confirmar={confirmar}
        />
      )}

      {/* ABA 5: COMISSÕES & INADIMPLÊNCIA */}
      {aba === 'COMISSOES' && (
        <AbaComissoesInadimplencia
          onAtualizar={atualizarTudo}
          toastSuccess={toastSuccess}
          toastError={toastError}
          confirmar={confirmar}
        />
      )}

      {/* MODAIS */}
      <ModalNovoTitulo
        isOpen={Boolean(modalNovoTipo)}
        tipoInicial={modalNovoTipo || 'PAGAR'}
        fornecedores={fornecedores}
        clientes={clientes}
        centrosCusto={auxiliares.centrosCusto || []}
        contas={contas}
        onClose={() => setModalNovoTipo(null)}
        onSalvar={async (payload) => {
          try {
            const res = await financeiroQueries.criarTitulo(payload)
            toastSuccess(
              'Lançamento salvo ✅',
              `${res.titulos?.length || 1} título(s) registrado(s) com sucesso.`,
            )
            setModalNovoTipo(null)
            await atualizarTudo()
          } catch (err) {
            toastError('Erro ao lançar título', err.message)
          }
        }}
      />

      <ModalBaixaTitulo
        titulo={tituloBaixa}
        contas={contas}
        onClose={() => setTituloBaixa(null)}
        onConfirmar={async (payload) => {
          try {
            const res = await financeiroQueries.baixarTitulo(tituloBaixa.id, payload)
            toastSuccess(
              res.status === 'PAGO' ? 'Título Liquidado ✅' : 'Baixa Parcial Registrada ✅',
              `${res.codigo} • Novo saldo da conta: ${fmtMoeda(res.saldo_conta_atual)}`,
            )
            setTituloBaixa(null)
            await atualizarTudo()
          } catch (err) {
            toastError('Erro na baixa', err.message)
          }
        }}
      />
    </div>
  )
}
