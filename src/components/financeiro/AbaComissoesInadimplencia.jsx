import React, { useEffect, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Coins, RefreshCw, ShieldCheck } from 'lucide-react'
import { financeiroQueries } from '../../queries/financeiro'
import { hojeIsoLocal } from '../../utils/rastreabilidade'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const TIPO_COM_LABEL = {
  PCT_VENDA: '% sobre Venda',
  PCT_MARGEM: '% sobre Margem',
  VALOR_KG: 'R$ por kg',
}

export function AbaComissoesInadimplencia({ onAtualizar, toastSuccess, toastError, confirmar }) {
  const hoje = hojeIsoLocal()
  const [dataInicio, setDataInicio] = useState(`${hoje.slice(0, 7)}-01`)
  const [dataFim, setDataFim] = useState(hoje)
  const [comissoes, setComissoes] = useState([])
  const [inadimplentes, setInadimplentes] = useState([])
  const [loading, setLoading] = useState(false)

  const carregar = async () => {
    setLoading(true)
    try {
      const [resCom, listInad] = await Promise.all([
        financeiroQueries.apurarComissoes({ data_inicio: dataInicio, data_fim: dataFim }),
        financeiroQueries.listarInadimplencia(),
      ])
      setComissoes(resCom?.data || [])
      setInadimplentes(listInad || [])
    } catch (err) {
      toastError('Erro ao carregar comissões/inadimplência', err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataInicio, dataFim])

  const handleGerarPagarComissao = async (v) => {
    const ok = await confirmar({
      title: 'Lançar Comissão no Contas a Pagar',
      message: `Gerar título no Contas a Pagar de ${fmtMoeda(v.comissao_total)} para o vendedor ${v.nome} (${dataInicio} a ${dataFim})?`,
      type: 'confirm',
      confirmLabel: 'Gerar Conta a Pagar',
    })
    if (!ok) return
    try {
      const res = await financeiroQueries.gerarPagarComissao({
        vendedor_id: v.vendedor_id,
        valor: v.comissao_total,
        periodo_label: `${dataInicio} a ${dataFim}`,
      })
      toastSuccess('Comissão lançada ✅', `Título ${res.codigo} criado no Contas a Pagar!`)
      await onAtualizar?.()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleToggleBloqueio = async (cli) => {
    const novoBloq = Number(cli.bloqueado_financeiro) === 1 ? false : true
    try {
      await financeiroQueries.alternarBloqueioCliente(cli.cliente_id, novoBloq)
      toastSuccess(
        novoBloq ? 'Cliente Bloqueado 🔒' : 'Cliente Liberado ✅',
        `${cli.nome_fantasia || cli.razao_social} ${novoBloq ? 'bloqueado financeiramente para novos pedidos.' : 'liberado para vendas.'}`,
      )
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  return (
    <div className="flex flex-col gap-16">
      {/* 1. APURAÇÃO DE COMISSÕES DE VENDEDORES */}
      <div className="card">
        <div className="flex justify-between items-center flex-wrap gap-10 mb-12">
          <div>
            <h3 className="text-base font-bold m-0 flex items-center gap-8">
              <Coins size={18} className="text-warning" /> Apuração de Comissões por Vendedor
            </h3>
            <p className="text-xs text-muted mt-4">
              Respeita automaticamente a regra cadastrada em cada vendedor (<strong>Faturamento</strong> vs{' '}
              <strong>Liquidação/Recebimento</strong>).
            </p>
          </div>
          <div className="flex gap-8 items-center flex-wrap">
            <input type="date" className="form-input" style={{ width: 145, height: 34 }} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            <span className="text-xs text-muted">até</span>
            <input type="date" className="form-input" style={{ width: 145, height: 34 }} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            <button type="button" className="btn btn--ghost btn--sm" onClick={carregar}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th>Regra Liberação</th>
                <th>Tipo / Taxa</th>
                <th style={{ textAlign: 'right' }}>Títulos</th>
                <th style={{ textAlign: 'right' }}>Base (R$ / kg)</th>
                <th style={{ textAlign: 'right' }}>Comissão Apurada</th>
                <th style={{ textAlign: 'right' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center p-24 text-muted">
                    Apurando comissões...
                  </td>
                </tr>
              ) : comissoes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center p-24 text-muted">
                    Nenhum vendedor cadastrado.
                  </td>
                </tr>
              ) : (
                comissoes.map((v) => (
                  <tr key={v.vendedor_id}>
                    <td>
                      <div className="font-bold">{v.nome}</div>
                      <div className="text-xs text-muted font-mono">
                        {v.codigo} {v.sigla ? `• (${v.sigla})` : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${v.regra_liberacao === 'LIQUIDACAO' ? 'badge--success' : 'badge--info'}`}>
                        {v.regra_liberacao === 'LIQUIDACAO' ? 'Na Liquidação (Pago)' : 'No Faturamento'}
                      </span>
                    </td>
                    <td className="text-xs">
                      <div>{TIPO_COM_LABEL[v.tipo_comissao] || v.tipo_comissao}</div>
                      <div className="font-mono font-bold">
                        {v.tipo_comissao === 'VALOR_KG' ? `${fmtMoeda(v.pct_comissao)}/kg` : `${v.pct_comissao}%`}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono">
                      {v.qtd_titulos}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                      <div>{fmtMoeda(v.base_valor)}</div>
                      <div className="text-muted">{Number(v.base_kg || 0).toFixed(2)} kg</div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">
                      {fmtMoeda(v.comissao_total)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={v.comissao_total <= 0}
                        onClick={() => handleGerarPagarComissao(v)}
                      >
                        Lançar no Pagar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. INADIMPLÊNCIA & LIMITE DE CRÉDITO DE CLIENTES */}
      <div className="card">
        <div className="mb-12">
          <h3 className="text-base font-bold m-0 flex items-center gap-8">
            <AlertTriangle size={18} className="text-danger" /> Exposição de Crédito &amp; Inadimplência de Clientes
          </h3>
          <p className="text-xs text-muted mt-4">
            Acompanhe clientes com saldo em aberto, parcelas vencidas ou limite de crédito estourado e acione o bloqueio financeiro direto aqui.
          </p>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th style={{ textAlign: 'right' }}>Limite Crédito</th>
                <th style={{ textAlign: 'right' }}>Saldo em Aberto</th>
                <th style={{ textAlign: 'right' }}>Vencido (Atraso)</th>
                <th>Situação</th>
                <th style={{ textAlign: 'right' }}>Bloqueio Vendas</th>
              </tr>
            </thead>
            <tbody>
              {inadimplentes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center p-24 text-muted">
                    Nenhum cliente com saldo em aberto ou bloqueio financeiro no momento.
                  </td>
                </tr>
              ) : (
                inadimplentes.map((c) => (
                  <tr key={c.cliente_id}>
                    <td>
                      <div className="font-bold">{c.nome_fantasia || c.razao_social}</div>
                      <div className="text-xs text-muted font-mono">{c.codigo || '-'}</div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                      {c.limite_credito > 0 ? fmtMoeda(c.limite_credito) : 'Sem limite'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                      {fmtMoeda(c.saldo_aberto)}
                      <div className="text-xs text-muted">{c.qtd_titulos_abertos} título(s)</div>
                    </td>
                    <td style={{ textAlign: 'right' }} className={`font-mono font-bold ${c.saldo_vencido > 0 ? 'text-danger' : 'text-muted'}`}>
                      {c.saldo_vencido > 0 ? (
                        <>
                          <div>{fmtMoeda(c.saldo_vencido)}</div>
                          <div className="text-xs">
                            {c.qtd_titulos_vencidos} venc. • até {c.maior_atraso_dias}d
                          </div>
                        </>
                      ) : (
                        'Em dia'
                      )}
                    </td>
                    <td>
                      <div className="flex gap-6 flex-wrap">
                        {Number(c.bloqueado_financeiro) === 1 && (
                          <span className="badge badge--danger">
                            <Ban size={11} /> Bloqueado
                          </span>
                        )}
                        {c.excedeu_limite && <span className="badge badge--warning">Acima do Limite</span>}
                        {Number(c.bloqueado_financeiro) === 0 && !c.excedeu_limite && c.saldo_vencido === 0 && (
                          <span className="badge badge--success">
                            <CheckCircle2 size={11} /> Regular
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className={`btn btn--sm ${Number(c.bloqueado_financeiro) === 1 ? 'btn--success' : 'btn--danger'}`}
                        onClick={() => handleToggleBloqueio(c)}
                      >
                        {Number(c.bloqueado_financeiro) === 1 ? (
                          <>
                            <ShieldCheck size={14} /> Liberar Cliente
                          </>
                        ) : (
                          <>
                            <Ban size={14} /> Bloquear Vendas
                          </>
                        )}
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
