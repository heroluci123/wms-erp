import React, { useState, useEffect, useCallback } from 'react'
import { Settings2, CreditCard, Landmark, FileSpreadsheet, Layers, Shield, Plus, Trash2, Calculator, Tag } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

export function ParametrosComerciais() {
  const { toastSuccess, toastError } = useAppStore()
  const [aba, setAba] = useState('pagamentos')
  const [aux, setAux] = useState({
    formasPagamento: [],
    locaisCobranca: [],
    centrosCusto: [],
    naturezasOperacao: [],
    matrizTributaria: [],
    marchantes: [],
  })
  const [loading, setLoading] = useState(true)

  // Forms
  const [fpForm, setFpForm] = useState({ codigo: '', descricao: '', diasTexto: '14, 21', pagamento_na_entrega: false })
  const [bancoForm, setBancoForm] = useState({ codigo: '', nome: '' })
  const [ccForm, setCcForm] = useState({ codigo: '', descricao: '' })
  const [marcForm, setMarcForm] = useState({ codigo: '', nome: '', is_padrao: false })
  const [natForm, setNatForm] = useState({
    tipo_movimento: 'SAIDA',
    finalidade: 'REVENDA',
    descricao: '',
    cfop_estadual: '5102',
    cfop_interestadual: '6102',
    codigo_sub_operacao: '01',
  })
  const [tribForm, setTribForm] = useState({
    ncm: '',
    uf_origem: 'SP',
    uf_destino: 'SP',
    regime_tributario: 'SIMPLES',
    cst_csosn: '',
    aliq_icms: 0,
    reducao_base_icms_pct: 0,
    aliq_icms_st: 0,
    validado_por_contador: '',
  })

  // Simulador CFOP
  const [simUf, setSimUf] = useState('SP')
  const [simTipo, setSimTipo] = useState('SAIDA')
  const [simResultado, setSimResultado] = useState(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const data = await cadastrosQueries.listarAuxiliares()
      setAux(data || { formasPagamento: [], locaisCobranca: [], centrosCusto: [], naturezasOperacao: [], matrizTributaria: [] })
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const simularCfop = async (uf, tipo) => {
    try {
      const res = await cadastrosQueries.sugerirCfop({ uf_parceiro: uf, tipo_movimento: tipo })
      setSimResultado(res)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (aba === 'naturezas' && isApiEnabled()) simularCfop(simUf, simTipo)
  }, [aba, simUf, simTipo])

  const executar = async (fn, tituloSucesso, descSucesso, onReset) => {
    try {
      await fn()
      if (tituloSucesso) toastSuccess(tituloSucesso, descSucesso)
      if (onReset) onReset()
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // Simulador instantaneo de parcelas (0ms)
  const previewParcelas = (() => {
    const dias = fpForm.diasTexto
      .split(/[,/;\s]+/)
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0)
    const lista = dias.length > 0 ? dias : [0]
    const hoje = new Date()
    return lista.map((d, i) => {
      const dt = new Date(hoje.getTime() + d * 86400000)
      return `Parcela ${i + 1} (${d}d): ${dt.toLocaleDateString('pt-BR')}`
    })
  })()

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Settings2 className="text-primary" size={26} /> Parâmetros Comerciais, Cobrança & CFOP
          </h1>
          <p className="page-header__subtitle">
            Condições de pagamento com simulação instantânea, bancos de cobrança, centros de custo, CFOP automático por UF e matriz tributária
          </p>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Parâmetros Comerciais e Fiscais" />

      <div className="flex gap-8 flex-wrap mb-16">
        {[
          { id: 'pagamentos', label: 'Formas de Pagamento', icon: CreditCard },
          { id: 'bancos', label: 'Locais Cobrança / Bancos', icon: Landmark },
          { id: 'naturezas', label: 'Naturezas & CFOP', icon: FileSpreadsheet },
          { id: 'centros', label: 'Centros de Custo', icon: Layers },
          { id: 'marchantes', label: 'Marchantes', icon: Tag },
          { id: 'matriz', label: 'Matriz Tributária (Contador)', icon: Shield },
        ].map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} className={`btn ${aba === t.id ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAba(t.id)}>
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="card p-24 text-center text-muted">Carregando parâmetros...</div>
      ) : (
        <>
          {aba === 'pagamentos' && (
            <div className="grid-responsive">
              <div className="card">
                <h3 className="text-base font-bold mb-12">Nova Condição de Pagamento</h3>
                <form
                  className="flex flex-col gap-12"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const dias_parcelas = fpForm.diasTexto
                      .split(/[,/;\s]+/)
                      .map((x) => parseInt(x.trim(), 10))
                      .filter((n) => Number.isFinite(n) && n >= 0)
                    executar(
                      () =>
                        cadastrosQueries.salvarFormaPagamento({
                          codigo: fpForm.codigo,
                          descricao: fpForm.descricao,
                          dias_parcelas: dias_parcelas.length > 0 ? dias_parcelas : [0],
                          pagamento_na_entrega: fpForm.pagamento_na_entrega ? 1 : 0,
                        }),
                      'Salvo',
                      'Condição de pagamento cadastrada.',
                      () => setFpForm({ codigo: '', descricao: '', diasTexto: '14, 21', pagamento_na_entrega: false })
                    )
                  }}
                >
                  <div className="form-grid form-grid--2">
                    <div>
                      <label className="form-label">Código *</label>
                      <input className="form-input" required value={fpForm.codigo} onChange={(e) => setFpForm({ ...fpForm, codigo: e.target.value })} placeholder="Ex: 155" />
                    </div>
                    <div>
                      <label className="form-label">Descrição *</label>
                      <input className="form-input" required value={fpForm.descricao} onChange={(e) => setFpForm({ ...fpForm, descricao: e.target.value.toUpperCase() })} placeholder="Ex: 14/21 DIAS" />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Dias das Parcelas (separados por vírgula ou barra)</label>
                    <input className="form-input" value={fpForm.diasTexto} onChange={(e) => setFpForm({ ...fpForm, diasTexto: e.target.value })} placeholder="Ex: 14, 21 ou 7, 14, 21" />
                    <div className="text-xs text-muted mt-4">Simulação 0ms: {previewParcelas.join(' | ')}</div>
                  </div>
                  <label className="flex items-center gap-8 cursor-pointer text-sm">
                    <input type="checkbox" checked={fpForm.pagamento_na_entrega} onChange={(e) => setFpForm({ ...fpForm, pagamento_na_entrega: e.target.checked })} />
                    Exige confirmação de pagamento na entrega (motorista / PIX)
                  </label>
                  <button type="submit" className="btn btn--primary" disabled={!isApiEnabled()}>
                    <Plus size={16} /> Adicionar Condição
                  </button>
                </form>
              </div>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th>Prazos (dias)</th>
                      <th>Entrega</th>
                      <th style={{ textAlign: 'right' }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aux.formasPagamento.map((fp) => (
                      <tr key={fp.id}>
                        <td className="td-mono">{fp.codigo}</td>
                        <td className="font-bold">{fp.descricao}</td>
                        <td className="td-mono">{Array.isArray(fp.dias_parcelas) ? fp.dias_parcelas.join(' / ') : '-'}</td>
                        <td>{Number(fp.pagamento_na_entrega) === 1 ? <span className="badge badge--warning">Na Entrega</span> : 'Faturado'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={() => executar(() => cadastrosQueries.excluirFormaPagamento(fp.id), 'Excluído', 'Forma de pagamento removida.')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'bancos' && (
            <div className="grid-responsive">
              <div className="card">
                <h3 className="text-base font-bold mb-12">Novo Local de Cobrança / Banco</h3>
                <form
                  className="flex flex-col gap-12"
                  onSubmit={(e) => {
                    e.preventDefault()
                    executar(
                      () => cadastrosQueries.salvarLocalCobranca(bancoForm),
                      'Salvo',
                      'Local de cobrança adicionado.',
                      () => setBancoForm({ codigo: '', nome: '' })
                    )
                  }}
                >
                  <div>
                    <label className="form-label">Código *</label>
                    <input className="form-input" required value={bancoForm.codigo} onChange={(e) => setBancoForm({ ...bancoForm, codigo: e.target.value })} placeholder="Ex: 2" />
                  </div>
                  <div>
                    <label className="form-label">Nome do Banco / Local *</label>
                    <input className="form-input" required value={bancoForm.nome} onChange={(e) => setBancoForm({ ...bancoForm, nome: e.target.value.toUpperCase() })} placeholder="Ex: BANCO DO BRASIL" />
                  </div>
                  <button type="submit" className="btn btn--primary" disabled={!isApiEnabled()}>
                    <Plus size={16} /> Adicionar Banco
                  </button>
                </form>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nome</th>
                      <th style={{ textAlign: 'right' }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aux.locaisCobranca.map((b) => (
                      <tr key={b.id}>
                        <td className="td-mono">{b.codigo}</td>
                        <td className="font-bold">{b.nome}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={() => executar(() => cadastrosQueries.excluirLocalCobranca(b.id), 'Excluído', 'Local de cobrança removido.')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'naturezas' && (
            <div className="flex flex-col gap-16">
              <div className="card flex items-center justify-between flex-wrap gap-12" style={{ background: 'var(--bg-2)' }}>
                <div className="flex items-center gap-8">
                  <Calculator size={18} className="text-primary" />
                  <span className="font-bold text-sm">Teste Automático de CFOP pela UF da Filial Ativa:</span>
                </div>
                <div className="flex items-center gap-8 flex-wrap">
                  <select className="form-input" style={{ width: 150 }} value={simTipo} onChange={(e) => setSimTipo(e.target.value)}>
                    <option value="SAIDA">Venda / Saída</option>
                    <option value="ENTRADA">Compra / Entrada</option>
                    <option value="INDUSTRIALIZACAO">Remessa Ind.</option>
                  </select>
                  <input className="form-input" style={{ width: 80 }} maxLength={2} value={simUf} onChange={(e) => setSimUf(e.target.value.toUpperCase())} placeholder="UF" />
                  {simResultado && (
                    <span className="badge badge--success">
                      Filial {simResultado.uf_filial} → {simResultado.uf_parceiro} ({simResultado.dentro_estado ? 'Dentro UF' : 'Fora UF'}): CFOP{' '}
                      <strong>{simResultado.cfop} {simResultado.codigo_sub_operacao}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="grid-responsive">
                <div className="card">
                  <h3 className="text-base font-bold mb-12">Nova Natureza de Operação</h3>
                  <form
                    className="flex flex-col gap-12"
                    onSubmit={(e) => {
                      e.preventDefault()
                      executar(
                        () => cadastrosQueries.salvarNaturezaOperacao(natForm),
                        'Salvo',
                        'Natureza de operação cadastrada.',
                        () => setNatForm({ tipo_movimento: 'SAIDA', finalidade: 'REVENDA', descricao: '', cfop_estadual: '5102', cfop_interestadual: '6102', codigo_sub_operacao: '01' })
                      )
                    }}
                  >
                    <div className="form-grid form-grid--2">
                      <div>
                        <label className="form-label">Movimento</label>
                        <select className="form-input" value={natForm.tipo_movimento} onChange={(e) => setNatForm({ ...natForm, tipo_movimento: e.target.value })}>
                          <option value="SAIDA">Saída / Venda</option>
                          <option value="ENTRADA">Entrada / Compra</option>
                          <option value="INDUSTRIALIZACAO">Industrialização</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Finalidade</label>
                        <input className="form-input" value={natForm.finalidade} onChange={(e) => setNatForm({ ...natForm, finalidade: e.target.value.toUpperCase() })} />
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Descrição *</label>
                      <input className="form-input" required value={natForm.descricao} onChange={(e) => setNatForm({ ...natForm, descricao: e.target.value.toUpperCase() })} placeholder="Ex: VENDA DE MERCADORIA ADQUIRIDA" />
                    </div>
                    <div className="form-grid form-grid--3">
                      <div>
                        <label className="form-label">CFOP Dentro UF</label>
                        <input className="form-input" required value={natForm.cfop_estadual} onChange={(e) => setNatForm({ ...natForm, cfop_estadual: e.target.value })} />
                      </div>
                      <div>
                        <label className="form-label">CFOP Fora UF</label>
                        <input className="form-input" required value={natForm.cfop_interestadual} onChange={(e) => setNatForm({ ...natForm, cfop_interestadual: e.target.value })} />
                      </div>
                      <div>
                        <label className="form-label">Sub-Op.</label>
                        <input className="form-input" value={natForm.codigo_sub_operacao} onChange={(e) => setNatForm({ ...natForm, codigo_sub_operacao: e.target.value })} />
                      </div>
                    </div>
                    <button type="submit" className="btn btn--primary" disabled={!isApiEnabled()}>
                      <Plus size={16} /> Adicionar Natureza
                    </button>
                  </form>
                </div>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Tipo / Finalidade</th>
                        <th>Descrição</th>
                        <th>Dentro UF</th>
                        <th>Fora UF</th>
                        <th style={{ textAlign: 'right' }}>Excluir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aux.naturezasOperacao.map((n) => (
                        <tr key={n.id}>
                          <td>
                            <span className="badge badge--ghost">{n.tipo_movimento}</span>
                            <div className="td-muted">{n.finalidade}</div>
                          </td>
                          <td className="font-bold">{n.descricao}</td>
                          <td className="td-mono">{n.cfop_estadual} {n.codigo_sub_operacao}</td>
                          <td className="td-mono">{n.cfop_interestadual} {n.codigo_sub_operacao}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn--ghost btn--icon text-danger"
                              disabled={!isApiEnabled()}
                              onClick={() => executar(() => cadastrosQueries.excluirNaturezaOperacao(n.id), 'Excluído', 'Natureza removida.')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {aba === 'centros' && (
            <div className="grid-responsive">
              <div className="card">
                <h3 className="text-base font-bold mb-12">Novo Centro de Custo</h3>
                <form
                  className="flex flex-col gap-12"
                  onSubmit={(e) => {
                    e.preventDefault()
                    executar(
                      () => cadastrosQueries.salvarCentroCusto(ccForm),
                      'Salvo',
                      'Centro de custo criado.',
                      () => setCcForm({ codigo: '', descricao: '' })
                    )
                  }}
                >
                  <div>
                    <label className="form-label">Código *</label>
                    <input className="form-input" required value={ccForm.codigo} onChange={(e) => setCcForm({ ...ccForm, codigo: e.target.value })} placeholder="Ex: 557" />
                  </div>
                  <div>
                    <label className="form-label">Descrição *</label>
                    <input className="form-input" required value={ccForm.descricao} onChange={(e) => setCcForm({ ...ccForm, descricao: e.target.value.toUpperCase() })} placeholder="Ex: COMPRA DE MERCADORIA" />
                  </div>
                  <button type="submit" className="btn btn--primary" disabled={!isApiEnabled()}>
                    <Plus size={16} /> Adicionar Centro de Custo
                  </button>
                </form>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th style={{ textAlign: 'right' }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aux.centrosCusto.map((cc) => (
                      <tr key={cc.id}>
                        <td className="td-mono">{cc.codigo}</td>
                        <td className="font-bold">{cc.descricao}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={() => executar(() => cadastrosQueries.excluirCentroCusto(cc.id), 'Excluído', 'Centro de custo removido.')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {aba === 'marchantes' && (
            <div className="grid-responsive">
              <div className="card">
                <h3 className="text-base font-bold mb-12">Novo Marchante</h3>
                <form
                  className="flex flex-col gap-12"
                  onSubmit={(e) => {
                    e.preventDefault()
                    executar(
                      () => cadastrosQueries.salvarMarchante(marcForm),
                      'Marchante salvo',
                      `${marcForm.codigo} — ${marcForm.nome}`,
                      () => setMarcForm({ codigo: '', nome: '', is_padrao: false })
                    )
                  }}
                >
                  <div className="form-grid form-grid--2">
                    <div>
                      <label className="form-label">Código *</label>
                      <input className="form-input" required value={marcForm.codigo} onChange={(e) => setMarcForm({ ...marcForm, codigo: e.target.value.toUpperCase() })} placeholder="Ex: 002" />
                    </div>
                    <div>
                      <label className="form-label">Nome / Razão *</label>
                      <input className="form-input" required value={marcForm.nome} onChange={(e) => setMarcForm({ ...marcForm, nome: e.target.value.toUpperCase() })} placeholder="Ex: FRIGORÍFICO X" />
                    </div>
                  </div>
                  <label className="flex items-center gap-8 text-sm cursor-pointer">
                    <input type="checkbox" checked={marcForm.is_padrao} onChange={(e) => setMarcForm({ ...marcForm, is_padrao: e.target.checked })} />
                    Definir como Marchante Padrão nos Pedidos
                  </label>
                  <button type="submit" className="btn btn--primary" disabled={!isApiEnabled()}>
                    <Plus size={16} /> Salvar Marchante
                  </button>
                </form>
              </div>
              <div className="card">
                <h3 className="text-base font-bold mb-12">Marchantes Cadastrados</h3>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Nome</th>
                        <th>Padrão</th>
                        <th style={{ textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(aux.marchantes || []).map((m) => (
                        <tr key={m.id}>
                          <td className="td-mono font-bold">{m.codigo}</td>
                          <td>{m.nome}</td>
                          <td>
                            {Number(m.is_padrao) === 1 ? (
                              <span className="badge badge--success">PADRÃO</span>
                            ) : (
                              <button
                                className="btn btn--ghost btn--sm"
                                disabled={!isApiEnabled()}
                                onClick={() =>
                                  executar(
                                    () => cadastrosQueries.salvarMarchante({ id: m.id, codigo: m.codigo, nome: m.nome, is_padrao: 1 }),
                                    'Padrão atualizado',
                                    `${m.nome} agora é o marchante padrão.`
                                  )
                                }
                              >
                                Tornar Padrão
                              </button>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn--ghost btn--icon text-danger"
                              disabled={!isApiEnabled()}
                              onClick={() => executar(() => cadastrosQueries.excluirMarchante(m.id), 'Excluído', 'Marchante desativado.')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {aba === 'matriz' && (
            <div className="grid-responsive">
              <div className="card">
                <h3 className="text-base font-bold mb-12">Nova Regra Tributária por NCM</h3>
                <p className="text-xs text-muted mb-12">
                  Toda alíquota é definida pelo cliente/contador com registro de auditoria do responsável que validou.
                </p>
                <form
                  className="flex flex-col gap-12"
                  onSubmit={(e) => {
                    e.preventDefault()
                    executar(
                      () => cadastrosQueries.criarMatrizTributaria(tribForm),
                      'Regra salva',
                      'Matriz tributária atualizada.',
                      () => setTribForm({ ncm: '', uf_origem: 'SP', uf_destino: 'SP', regime_tributario: 'SIMPLES', cst_csosn: '', aliq_icms: 0, reducao_base_icms_pct: 0, aliq_icms_st: 0, validado_por_contador: '' })
                    )
                  }}
                >
                  <div className="form-grid form-grid--3">
                    <div>
                      <label className="form-label">NCM *</label>
                      <input className="form-input" required value={tribForm.ncm} onChange={(e) => setTribForm({ ...tribForm, ncm: e.target.value })} placeholder="Ex: 02013000" />
                    </div>
                    <div>
                      <label className="form-label">UF Origem</label>
                      <input className="form-input" maxLength={2} value={tribForm.uf_origem} onChange={(e) => setTribForm({ ...tribForm, uf_origem: e.target.value.toUpperCase() })} />
                    </div>
                    <div>
                      <label className="form-label">UF Destino</label>
                      <input className="form-input" maxLength={2} value={tribForm.uf_destino} onChange={(e) => setTribForm({ ...tribForm, uf_destino: e.target.value.toUpperCase() })} />
                    </div>
                  </div>
                  <div className="form-grid form-grid--3">
                    <div>
                      <label className="form-label">CST / CSOSN</label>
                      <input className="form-input" value={tribForm.cst_csosn} onChange={(e) => setTribForm({ ...tribForm, cst_csosn: e.target.value })} placeholder="Ex: 102 / 020" />
                    </div>
                    <div>
                      <label className="form-label">Alíq. ICMS (%)</label>
                      <input type="number" step="0.01" className="form-input" value={tribForm.aliq_icms} onChange={(e) => setTribForm({ ...tribForm, aliq_icms: e.target.value })} />
                    </div>
                    <div>
                      <label className="form-label">Redução Base (%)</label>
                      <input type="number" step="0.01" className="form-input" value={tribForm.reducao_base_icms_pct} onChange={(e) => setTribForm({ ...tribForm, reducao_base_icms_pct: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Validado pelo Contador</label>
                    <input className="form-input" value={tribForm.validado_por_contador} onChange={(e) => setTribForm({ ...tribForm, validado_por_contador: e.target.value })} placeholder="Nome / Escritório Contábil" />
                  </div>
                  <button type="submit" className="btn btn--primary" disabled={!isApiEnabled()}>
                    <Plus size={16} /> Salvar Regra NCM
                  </button>
                </form>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>NCM</th>
                      <th>Rota UF</th>
                      <th>CST/CSOSN</th>
                      <th>ICMS / Redução</th>
                      <th>Validado por</th>
                      <th style={{ textAlign: 'right' }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(aux.matrizTributaria || []).map((m) => (
                      <tr key={m.id}>
                        <td className="td-mono font-bold">{m.ncm}</td>
                        <td>{m.uf_origem} → {m.uf_destino}</td>
                        <td className="td-mono">{m.cst_csosn || '-'}</td>
                        <td className="td-mono">{m.aliq_icms}% / red. {m.reducao_base_icms_pct}%</td>
                        <td>{m.validado_por_contador || '-'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={() => executar(() => cadastrosQueries.excluirMatrizTributaria(m.id), 'Excluído', 'Regra tributária removida.')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
