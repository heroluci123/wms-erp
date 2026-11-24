import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Factory,
  Flame,
  RefreshCw,
  Scale,
  ShieldAlert,
  Store,
  Tag,
  Trash2,
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { governancaQueries } from '../../queries/governanca'

const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

export function AbaAuditoriaRendimentoEtiquetas({ onBaixarPerdaEtiqueta }) {
  const { toastError } = useAppStore()
  const [subAba, setSubAba] = useState('RENDIMENTO') // RENDIMENTO | ETIQUETAS
  const [dias, setDias] = useState(30)
  const [toleranciaPct, setToleranciaPct] = useState(5)
  const [diasFantasma, setDiasFantasma] = useState(3)
  const [loading, setLoading] = useState(false)

  const [rendData, setRendData] = useState({ ops: [], acougue: [], resumo: {} })
  const [etqData, setEtqData] = useState({ fantasmas: [], subfaturadas: [], ranking_operadores: [], resumo: {} })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [rRend, rEtq] = await Promise.all([
        governancaQueries.obterAuditoriaRendimento({ dias, tolerancia_pct: toleranciaPct }),
        governancaQueries.obterEtiquetasFantasma({ dias, dias_fantasma: diasFantasma }),
      ])
      setRendData(rRend || { ops: [], acougue: [], resumo: {} })
      setEtqData(rEtq || { fantasmas: [], subfaturadas: [], ranking_operadores: [], resumo: {} })
    } catch (err) {
      toastError('Erro ao carregar auditoria Loss Prevention', err.message)
    } finally {
      setLoading(false)
    }
  }, [dias, toleranciaPct, diasFantasma, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const rr = rendData.resumo || {}
  const re = etqData.resumo || {}

  return (
    <div className="flex flex-col gap-16">
      {/* Barra de controles + sub-abas */}
      <div className="card" style={{ padding: 14 }}>
        <div className="flex justify-between items-center flex-wrap gap-10">
          <div className="flex gap-8 flex-wrap">
            <button
              type="button"
              className={`btn ${subAba === 'RENDIMENTO' ? 'btn--primary' : 'btn--secondary'} btn--sm`}
              onClick={() => setSubAba('RENDIMENTO')}
            >
              <Scale size={14} /> Furo de Rendimento (Desossa &amp; Açougue)
              {(rr.total_anomalias || 0) > 0 && (
                <span className="badge badge--danger" style={{ marginLeft: 4 }}>
                  {rr.total_anomalias}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`btn ${subAba === 'ETIQUETAS' ? 'btn--primary' : 'btn--secondary'} btn--sm`}
              onClick={() => setSubAba('ETIQUETAS')}
            >
              <Tag size={14} /> Etiquetas Fantasma &amp; Subfaturamento (Açougue/PDV)
              {((re.fantasma_qtd || 0) + (re.subfaturada_qtd || 0)) > 0 && (
                <span className="badge badge--danger" style={{ marginLeft: 4 }}>
                  {(re.fantasma_qtd || 0) + (re.subfaturada_qtd || 0)}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-8 flex-wrap">
            <select
              className="form-input"
              style={{ width: 135, height: 36 }}
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
            {subAba === 'RENDIMENTO' ? (
              <select
                className="form-input"
                style={{ width: 175, height: 36 }}
                value={toleranciaPct}
                onChange={(e) => setToleranciaPct(Number(e.target.value))}
              >
                <option value={3}>Tolerância: -3% (Rigoroso)</option>
                <option value={5}>Tolerância: -5% (Padrão)</option>
                <option value={8}>Tolerância: -8% (Flexível)</option>
              </select>
            ) : (
              <select
                className="form-input"
                style={{ width: 195, height: 36 }}
                value={diasFantasma}
                onChange={(e) => setDiasFantasma(Number(e.target.value))}
              >
                <option value={2}>Fantasma após 2 dias</option>
                <option value={3}>Fantasma após 3 dias</option>
                <option value={5}>Fantasma após 5 dias</option>
              </select>
            )}
            <button type="button" className="btn btn--secondary btn--sm" onClick={carregar} disabled={loading}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-ABA A: ALARME DE FURO DE RENDIMENTO                             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subAba === 'RENDIMENTO' && (
        <div className="flex flex-col gap-16">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 14, borderColor: (rr.total_anomalias || 0) > 0 ? 'rgba(239,68,68,0.6)' : undefined }}>
              <div className="text-xs text-muted uppercase font-bold">Anomalias de Rendimento</div>
              <div className={`text-2xl font-mono font-bold mt-4 ${(rr.total_anomalias || 0) > 0 ? 'text-danger' : 'text-success'}`}>
                {rr.total_anomalias || 0}
              </div>
              <div className="text-xs text-muted mt-2">
                {rr.total_ops_anomalia || 0} OP(s) • {rr.total_mps_acougue_anomalia || 0} MP(s) Açougue
              </div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs text-muted uppercase font-bold">Kg Perdidos Além da Meta</div>
              <div className="text-2xl font-mono font-bold text-warning mt-4">{fmtKg(rr.kg_furo_total)}</div>
              <div className="text-xs text-muted mt-2">Abaixo da árvore - {toleranciaPct}%</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs text-muted uppercase font-bold">Prejuízo Estimado (Furo)</div>
              <div className="text-2xl font-mono font-bold text-danger mt-4">{fmtMoeda(rr.prejuizo_estimado_total)}</div>
              <div className="text-xs text-muted mt-2">Custo médio da MP perdida</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs text-muted uppercase font-bold">Médias Reais do Período</div>
              <div className="text-sm font-mono font-bold mt-6">
                Desossa: <span className="text-info">{rr.rendimento_medio_desossa_pct != null ? `${rr.rendimento_medio_desossa_pct}%` : '—'}</span>
              </div>
              <div className="text-sm font-mono font-bold mt-2">
                Açougue: <span className="text-success">{rr.rendimento_medio_acougue_pct != null ? `${rr.rendimento_medio_acougue_pct}%` : '—'}</span>
              </div>
            </div>
          </div>

          {/* Tabela 1: Desossa / OPs */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 flex items-center gap-8" style={{ borderBottom: '1px solid var(--border)' }}>
              <Factory size={16} className="text-info" />
              <strong className="text-sm">Auditoria de Desossa / Indústria — Ordens de Produção ({(rendData.ops || []).length})</strong>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>OP</th>
                    <th>Descrição / Cliente</th>
                    <th style={{ textAlign: 'right' }}>MP Entrada</th>
                    <th style={{ textAlign: 'right' }}>Cortes Saída</th>
                    <th style={{ textAlign: 'right' }}>Esperado</th>
                    <th style={{ textAlign: 'right' }}>Real</th>
                    <th style={{ textAlign: 'right' }}>Desvio</th>
                    <th style={{ textAlign: 'right' }}>Prejuízo Est.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(rendData.ops || []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center p-24 text-muted">
                        Nenhuma Ordem de Produção com insumos e saídas encerrada nos últimos {dias} dias.
                      </td>
                    </tr>
                  ) : (
                    rendData.ops.map((op) => (
                      <tr key={op.id} style={op.anomalia ? { background: 'rgba(239,68,68,0.07)' } : undefined}>
                        <td className="font-mono font-bold text-info">{op.codigo}</td>
                        <td>
                          <div className="font-bold text-sm">{op.descricao}</div>
                          <div className="text-xs text-muted">{op.cliente} • {op.operador_nome} • {fmtData(op.data_ref)}</div>
                        </td>
                        <td className="font-mono text-right">{fmtKg(op.peso_entrada_kg)}</td>
                        <td className="font-mono text-right">{fmtKg(op.peso_saida_kg)}</td>
                        <td className="font-mono text-right text-muted">{op.rendimento_esperado_pct}%</td>
                        <td className={`font-mono font-bold text-right ${op.anomalia ? 'text-danger' : 'text-success'}`}>
                          {op.rendimento_real_pct}%
                        </td>
                        <td className={`font-mono font-bold text-right ${op.desvio_pct < 0 ? 'text-danger' : 'text-success'}`}>
                          {op.desvio_pct > 0 ? '+' : ''}{op.desvio_pct}%
                        </td>
                        <td className="font-mono font-bold text-right text-danger">
                          {op.prejuizo_estimado > 0 ? fmtMoeda(op.prejuizo_estimado) : '-'}
                        </td>
                        <td>
                          {op.anomalia ? (
                            <span className="badge badge--danger">
                              <AlertTriangle size={11} /> Furo (-{fmtKg(op.kg_furo_extra)})
                            </span>
                          ) : (
                            <span className="badge badge--success">
                              <CheckCircle2 size={11} /> Normal
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela 2: Açougue / MPs encerradas */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 flex items-center gap-8" style={{ borderBottom: '1px solid var(--border)' }}>
              <Store size={16} className="text-warning" />
              <strong className="text-sm">Auditoria do Açougue — Matérias-Primas Encerradas ({(rendData.acougue || []).length})</strong>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>EAN MP</th>
                    <th>Produto / Lote</th>
                    <th style={{ textAlign: 'right' }}>Peso Inicial</th>
                    <th style={{ textAlign: 'right' }}>Quebra / Apara</th>
                    <th style={{ textAlign: 'right' }}>Esperado</th>
                    <th style={{ textAlign: 'right' }}>Real</th>
                    <th style={{ textAlign: 'right' }}>Desvio</th>
                    <th style={{ textAlign: 'right' }}>Prejuízo Est.</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(rendData.acougue || []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center p-24 text-muted">
                        Nenhuma Matéria-Prima encerrada no Açougue nos últimos {dias} dias.
                      </td>
                    </tr>
                  ) : (
                    rendData.acougue.map((mp) => (
                      <tr key={mp.id} style={mp.anomalia ? { background: 'rgba(239,68,68,0.07)' } : undefined}>
                        <td className="font-mono text-xs font-bold text-info">{mp.codigo}</td>
                        <td>
                          <div className="font-bold text-sm">{mp.descricao}</div>
                          <div className="text-xs text-muted">Lote {mp.lote} • {fmtData(mp.data_ref)}</div>
                        </td>
                        <td className="font-mono text-right">{fmtKg(mp.peso_entrada_kg)}</td>
                        <td className="font-mono text-right text-warning">{fmtKg(mp.quebra_kg)}</td>
                        <td className="font-mono text-right text-muted">{mp.rendimento_esperado_pct}%</td>
                        <td className={`font-mono font-bold text-right ${mp.anomalia ? 'text-danger' : 'text-success'}`}>
                          {mp.rendimento_real_pct}%
                        </td>
                        <td className={`font-mono font-bold text-right ${mp.desvio_pct < 0 ? 'text-danger' : 'text-success'}`}>
                          {mp.desvio_pct > 0 ? '+' : ''}{mp.desvio_pct}%
                        </td>
                        <td className="font-mono font-bold text-right text-danger">
                          {mp.prejuizo_estimado > 0 ? fmtMoeda(mp.prejuizo_estimado) : '-'}
                        </td>
                        <td>
                          {mp.anomalia ? (
                            <span className="badge badge--danger">
                              <Flame size={11} /> Furo (-{fmtKg(mp.kg_furo_extra)})
                            </span>
                          ) : (
                            <span className="badge badge--success">
                              <CheckCircle2 size={11} /> Normal
                            </span>
                          )}
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

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SUB-ABA B: ETIQUETAS FANTASMA & SUBFATURAMENTO                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {subAba === 'ETIQUETAS' && (
        <div className="flex flex-col gap-16">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 14, borderColor: (re.fantasma_qtd || 0) > 0 ? 'rgba(239,68,68,0.55)' : undefined }}>
              <div className="text-xs text-muted uppercase font-bold">Etiquetas Fantasma</div>
              <div className={`text-2xl font-mono font-bold mt-4 ${(re.fantasma_qtd || 0) > 0 ? 'text-danger' : 'text-success'}`}>
                {re.fantasma_qtd || 0}
              </div>
              <div className="text-xs text-muted mt-2">{fmtKg(re.fantasma_kg)} • {fmtMoeda(re.fantasma_valor)}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs text-muted uppercase font-bold">Etiquetas Subfaturadas</div>
              <div className={`text-2xl font-mono font-bold mt-4 ${(re.subfaturada_qtd || 0) > 0 ? 'text-warning' : 'text-success'}`}>
                {re.subfaturada_qtd || 0}
              </div>
              <div className="text-xs text-muted mt-2">Diferença: {fmtMoeda(re.subfaturada_diferenca_valor)}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs text-muted uppercase font-bold">Etiquetas Canceladas (Açougue)</div>
              <div className="text-2xl font-mono font-bold text-info mt-4">{re.canceladas_acougue_qtd || 0}</div>
              <div className="text-xs text-muted mt-2">{fmtKg(re.canceladas_acougue_kg)} estornados</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="text-xs text-muted uppercase font-bold">Exposição / Risco Total</div>
              <div className="text-2xl font-mono font-bold text-danger mt-4">{fmtMoeda(re.risco_total_valor)}</div>
              <div className="text-xs text-muted mt-2">Fantasmas + subfaturamento</div>
            </div>
          </div>

          {/* Tabela Etiquetas Fantasma */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 flex items-center gap-8" style={{ borderBottom: '1px solid var(--border)' }}>
              <ShieldAlert size={16} className="text-danger" />
              <strong className="text-sm">Etiquetas Fantasma (Pesadas no Açougue sem venda no PDV nem baixa)</strong>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Etiqueta QR</th>
                    <th>Produto</th>
                    <th style={{ textAlign: 'right' }}>Peso</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Pesada / Validade</th>
                    <th>Alerta</th>
                    <th>Operador</th>
                    <th style={{ textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(etqData.fantasmas || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-success">
                        <CheckCircle2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        Nenhuma etiqueta fantasma detectada! Todas as etiquetas pesadas foram vendidas ou estão dentro do prazo.
                      </td>
                    </tr>
                  ) : (
                    etqData.fantasmas.map((f) => (
                      <tr key={f.id}>
                        <td className="font-mono font-bold text-info">{f.codigo_etiqueta}</td>
                        <td>
                          <div className="font-bold text-sm">{f.produto_descricao}</div>
                          <div className="text-xs text-muted">Cód. {f.produto_codigo || '-'}</div>
                        </td>
                        <td className="font-mono text-right">{fmtKg(f.peso_kg)}</td>
                        <td className="font-mono font-bold text-right text-danger">{fmtMoeda(f.valor_total)}</td>
                        <td className="text-xs font-mono">
                          <div>Pes.: {fmtData(f.data_pesagem)} ({f.idade_dias}d)</div>
                          <div className={f.vencida ? 'text-danger font-bold' : 'text-muted'}>
                            Val.: {fmtData(f.validade)}
                          </div>
                        </td>
                        <td className="text-xs">{f.motivo_alerta}</td>
                        <td className="text-xs text-muted">{f.operador_nome}</td>
                        <td style={{ textAlign: 'right' }}>
                          {onBaixarPerdaEtiqueta && (
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() =>
                                onBaixarPerdaEtiqueta({
                                  id: f.id,
                                  origem: 'ETIQUETA_ACOUGUE',
                                  codigo_rastreio: f.codigo_etiqueta,
                                  produto_descricao: f.produto_descricao,
                                  peso_kg: f.peso_kg,
                                })
                              }
                            >
                              <Trash2 size={12} /> Baixar Perda
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabela Subfaturadas */}
          {(etqData.subfaturadas || []).length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="p-14 flex items-center gap-8" style={{ borderBottom: '1px solid var(--border)' }}>
                <AlertTriangle size={16} className="text-warning" />
                <strong className="text-sm">Etiquetas Subfaturadas / Abaixo do Custo ({etqData.subfaturadas.length})</strong>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Etiqueta QR</th>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Preço Etiqueta</th>
                      <th style={{ textAlign: 'right' }}>Tabela / Custo</th>
                      <th style={{ textAlign: 'right' }}>Desvio</th>
                      <th style={{ textAlign: 'right' }}>Diferença (R$)</th>
                      <th>Operador / Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {etqData.subfaturadas.map((s) => (
                      <tr key={s.id} style={s.abaixo_custo ? { background: 'rgba(239,68,68,0.08)' } : undefined}>
                        <td className="font-mono font-bold text-info">{s.codigo_etiqueta}</td>
                        <td className="font-bold text-sm">{s.produto_descricao}</td>
                        <td className="font-mono font-bold text-right text-danger">{fmtMoeda(s.preco_etiqueta_kg)}/kg</td>
                        <td className="font-mono text-xs text-right text-muted">
                          Ref: {fmtMoeda(s.preco_ref_kg)} • Custo: {fmtMoeda(s.custo_kg)}
                        </td>
                        <td className="text-right">
                          <span className={`badge ${s.abaixo_custo ? 'badge--danger' : 'badge--warning'}`}>
                            {s.abaixo_custo ? 'ABAIXO DO CUSTO' : `-${s.desconto_implicito_pct}%`}
                          </span>
                        </td>
                        <td className="font-mono font-bold text-right text-danger">{fmtMoeda(s.diferenca_valor)}</td>
                        <td className="text-xs text-muted">{s.operador_nome} • {s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ranking de Operadores */}
          {(etqData.ranking_operadores || []).length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="p-14" style={{ borderBottom: '1px solid var(--border)' }}>
                <strong className="text-sm">Ranking de Operadores — Anomalias &amp; Taxa de Cancelamento (Açougue + PDV)</strong>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Operador</th>
                      <th style={{ textAlign: 'right' }}>Etiquetas Fantasma</th>
                      <th style={{ textAlign: 'right' }}>Subfaturadas</th>
                      <th style={{ textAlign: 'right' }}>Cancel. Açougue</th>
                      <th style={{ textAlign: 'right' }}>Cancel. PDV</th>
                      <th style={{ textAlign: 'right' }}>Desc. Altos PDV</th>
                      <th style={{ textAlign: 'right' }}>Taxa Cancelamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {etqData.ranking_operadores.map((op) => (
                      <tr key={op.operador}>
                        <td className="font-bold">{op.operador}</td>
                        <td className="font-mono text-right text-danger">{op.etiquetas_fantasma}</td>
                        <td className="font-mono text-right text-warning">{op.etiquetas_subfaturadas}</td>
                        <td className="font-mono text-right">{op.etiquetas_canceladas}</td>
                        <td className="font-mono text-right text-danger">{op.cancelamentos_pdv}</td>
                        <td className="font-mono text-right text-warning">{op.descontos_altos_pdv}</td>
                        <td className="font-mono font-bold text-right">
                          <span className={`badge ${op.taxa_cancelamento_pct >= 10 ? 'badge--danger' : 'badge--warning'}`}>
                            {op.taxa_cancelamento_pct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
