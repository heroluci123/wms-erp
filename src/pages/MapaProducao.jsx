import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Factory,
  GitBranch,
  RefreshCw,
  Plus,
  CheckCircle2,
  Trash2,
  Download,
  Sparkles,
  Play,
  Layers,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { temPermissao } from '../utils/permissoes'
import { isApiEnabled } from '../lib/apiClient'
import { mapaProducaoQueries } from '../queries/mapaProducao'
import * as produtosQueries from '../queries/produtos.js'
import { hojeIsoLocal } from '../utils/rastreabilidade.js'

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`

export function MapaProducao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeEscrever = temPermissao(operador, 'mapa_producao') || temPermissao(operador, 'producao_criar_op')
  const apiAtiva = isApiEnabled()

  const [aba, setAba] = useState('DEMANDA') // 'DEMANDA' | 'MAPAS' | 'ARVORE'
  const [loading, setLoading] = useState(false)

  // Catálogos
  const [produtos, setProdutos] = useState([])

  // Demanda / Mapa Diário
  const [dataMapa, setDataMapa] = useState(() => hojeIsoLocal())
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [grupoFiltro, setGrupoFiltro] = useState('')
  const [incluirRascunho, setIncluirRascunho] = useState(false)
  const [agruparModo, setAgruparModo] = useState('MP')
  const [observacoesMapa, setObservacoesMapa] = useState('')
  const [linhasMapa, setLinhasMapa] = useState([])

  // Mapas salvos
  const [mapas, setMapas] = useState([])
  const [mapaDetalhe, setMapaDetalhe] = useState(null)

  // Árvore Auto-Aprendiz
  const [arvore, setArvore] = useState([])
  const [apenasPendentes, setApenasPendentes] = useState(false)
  const [novoPaiId, setNovoPaiId] = useState('')
  const [novoFilhoId, setNovoFilhoId] = useState('')
  const [novoRendPct, setNovoRendPct] = useState('70')
  const [rendEditMap, setRendEditMap] = useState({})

  // Item manual extra no mapa
  const [extraProdId, setExtraProdId] = useState('')
  const [extraQtdKg, setExtraQtdKg] = useState('')

  const carregarTudo = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [prods, dem, listMapas, listArv] = await Promise.all([
        produtosQueries.listar().catch(() => []),
        mapaProducaoQueries.buscarDemandaPedidos({
          data_inicio: dataInicio,
          data_fim: dataFim,
          grupo: grupoFiltro,
          incluir_rascunho: incluirRascunho,
        }),
        mapaProducaoQueries.listarMapas().catch(() => []),
        mapaProducaoQueries.listarArvore().catch(() => []),
      ])
      setProdutos(prods || [])
      setMapas(listMapas || [])
      setArvore(listArv || [])
      setLinhasMapa(
        (dem?.cortes || []).map((c) => ({
          ...c,
          incluir: c.deficit_produzir_kg > 0,
          qtd_produzir_kg: c.deficit_produzir_kg > 0 ? c.deficit_produzir_kg : c.qtd_pedida_kg,
        })),
      )
    } catch (err) {
      toastError('Erro', err.message || 'Falha ao carregar Mapa de Produção.')
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, dataInicio, dataFim, grupoFiltro, incluirRascunho, toastError])

  useEffect(() => {
    carregarTudo()
  }, [carregarTudo])

  const mpsLista = useMemo(
    () =>
      produtos.filter(
        (p) => p.classificacao === 'MATERIA_PRIMA' || p.tipo_produto === 'Materia Prima',
      ),
    [produtos],
  )

  const subprodutosLista = useMemo(
    () =>
      produtos.filter(
        (p) => p.classificacao !== 'MATERIA_PRIMA' && p.tipo_produto !== 'Materia Prima',
      ),
    [produtos],
  )

  const gruposDisponiveis = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.grupo).filter(Boolean))).sort(),
    [produtos],
  )

  const pendentesArvore = useMemo(
    () => arvore.filter((a) => Number(a.confirmado) === 0),
    [arvore],
  )

  const arvoreFiltrada = useMemo(
    () => (apenasPendentes ? pendentesArvore : arvore),
    [arvore, pendentesArvore, apenasPendentes],
  )

  const handleAddLinhaExtra = () => {
    if (!extraProdId) return toastWarning('Corte', 'Selecione o corte para adicionar.')
    const qtd = Number(String(extraQtdKg).replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd <= 0) return toastWarning('Quantidade', 'Informe peso maior que zero.')
    const prod = produtos.find((p) => p.id === extraProdId)
    if (!prod) return

    const vinc = arvore.find((a) => a.filho_id === prod.id)
    const rend = vinc ? Number(vinc.rendimento_aprendido_pct || vinc.rendimento_esperado_pct || 100) : 100
    const mpKg = Number((qtd / ((rend > 5 ? rend : 100) / 100)).toFixed(3))

    setLinhasMapa((prev) => [
      ...prev,
      {
        produto_id: prod.id,
        produto_codigo: prod.codigo,
        produto_descricao: prod.descricao,
        grupo: prod.grupo || '',
        materia_prima_id: vinc?.pai_id || null,
        materia_prima_descricao: vinc?.pai_descricao || null,
        rendimento_usado_pct: rend,
        qtd_pedida_kg: 0,
        saldo_disponivel_kg: 0,
        saldo_em_op_kg: 0,
        deficit_produzir_kg: qtd,
        qtd_produzir_kg: qtd,
        qtd_mp_necessaria_kg: mpKg,
        especificacao: 'Programação manual',
        conservacao: 'RESFRIADO',
        clientes: [],
        incluir: true,
      },
    ])
    setExtraProdId('')
    setExtraQtdKg('')
  }

  const handleSalvarEGerarOps = async (gerarOps = true) => {
    const selecionadas = linhasMapa.filter((l) => l.incluir && Number(l.qtd_produzir_kg) > 0)
    if (selecionadas.length === 0) {
      return toastWarning('Seleção', 'Marque ao menos um corte com peso maior que zero.')
    }
    try {
      const resMapa = await mapaProducaoQueries.criarMapa({
        data_mapa: dataMapa,
        observacoes: observacoesMapa,
        itens: selecionadas.map((l, idx) => ({
          produto_id: l.produto_id,
          materia_prima_id: l.materia_prima_id || null,
          cliente_id: l.clientes?.length === 1 ? l.clientes[0].cliente_id : null,
          especificacao: l.especificacao || '',
          conservacao: l.conservacao || 'RESFRIADO',
          qtd_prevista_kg: Number(l.qtd_produzir_kg),
          qtd_mp_kg: Number(l.qtd_mp_necessaria_kg || l.qtd_produzir_kg),
          ordem: idx + 1,
        })),
      })

      if (gerarOps) {
        const resOps = await mapaProducaoQueries.gerarOpsDoMapa(resMapa.id, { agrupar_por: agruparModo })
        toastSuccess(
          'Mapa + OPs Geradas ✅',
          `${resMapa.codigo} criado e ${resOps.ops?.length || 0} OP(s) liberada(s) para a produção!`,
        )
      } else {
        toastSuccess('Mapa Salvo', `${resMapa.codigo} salvo com ${resMapa.qtd_itens} itens.`)
      }
      carregarTudo()
      setAba('MAPAS')
    } catch (err) {
      toastError('Erro ao gerar Mapa/OPs', err.message)
    }
  }

  const handleGerarOpsExistente = async (mapaId) => {
    try {
      const res = await mapaProducaoQueries.gerarOpsDoMapa(mapaId, { agrupar_por: agruparModo })
      toastSuccess('OPs Liberadas', `${res.ops?.length || 0} Ordem(ns) de Produção criada(s) no WMS!`)
      carregarTudo()
      if (mapaDetalhe?.id === mapaId) {
        setMapaDetalhe(await mapaProducaoQueries.obterMapa(mapaId))
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleSalvarVinculoManual = async (e) => {
    e.preventDefault()
    if (!novoPaiId || !novoFilhoId) return toastWarning('Vínculo', 'Escolha a Matéria-Prima e o Corte filho.')
    try {
      await mapaProducaoQueries.salvarVinculoArvore({
        pai_id: novoPaiId,
        filho_id: novoFilhoId,
        rendimento_esperado_pct: Number(novoRendPct || 0),
      })
      toastSuccess('Vínculo Salvo', 'Árvore de produtos atualizada com sucesso!')
      setNovoFilhoId('')
      carregarTudo()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleConfirmarArvore = async (item) => {
    try {
      const customRend = rendEditMap[item.id] ?? item.rendimento_aprendido_pct ?? item.rendimento_esperado_pct
      await mapaProducaoQueries.confirmarVinculoArvore(item.id, {
        rendimento_esperado_pct: customRend != null ? Number(customRend) : null,
      })
      toastSuccess('Rendimento Confirmado ✅', `${item.pai_descricao} → ${item.filho_descricao} oficializado na árvore.`)
      carregarTudo()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleDescartarArvore = async (id) => {
    try {
      await mapaProducaoQueries.removerVinculoArvore(id)
      toastSuccess('Vínculo Removido', 'Relação descartada da árvore.')
      carregarTudo()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const totaisSelecionados = useMemo(() => {
    const sel = linhasMapa.filter((l) => l.incluir)
    return {
      cortes: sel.length,
      kgProduzir: sel.reduce((s, l) => s + Number(l.qtd_produzir_kg || 0), 0),
      kgMp: sel.reduce((s, l) => s + Number(l.qtd_mp_necessaria_kg || 0), 0),
    }
  }, [linhasMapa])

  if (!apiAtiva) {
    return (
      <div className="card p-24">
        <h2 className="text-lg font-bold mb-8">Mapa de Produção & Árvore Auto-Aprendiz (Modo ERP API)</h2>
        <p className="text-sm text-muted">
          Ative o Backend API PostgreSQL (`VITE_API_URL`) para puxar demanda de pedidos em aberto, gerar OPs agrupadas em 1 clique e gerenciar os rendimentos auto-aprendidos da árvore.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <Factory size={24} className="text-primary" /> Mapa de Produção Diário & Árvore Auto-Aprendiz
          </h1>
          <p className="page-header__subtitle">
            Consolida cortes em falta dos pedidos, calcula a Matéria-Prima via Árvore e gera OPs no WMS em 1 clique
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={carregarTudo} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-8 mb-16 flex-wrap" style={{ borderBottom: '2px solid var(--border)', paddingBottom: 8 }}>
        <button type="button" className={`btn ${aba === 'DEMANDA' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAba('DEMANDA')}>
          <Download size={15} /> Programação / Puxar Pedidos ({linhasMapa.filter((l) => l.incluir).length})
        </button>
        <button type="button" className={`btn ${aba === 'MAPAS' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAba('MAPAS')}>
          <Layers size={15} /> Mapas Salvos & OPs ({mapas.length})
        </button>
        <button type="button" className={`btn ${aba === 'ARVORE' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAba('ARVORE')}>
          <GitBranch size={15} /> Árvore Auto-Aprendiz
          {pendentesArvore.length > 0 && (
            <span className="badge badge--warning" style={{ marginLeft: 6 }}>{pendentesArvore.length} p/ revisar</span>
          )}
        </button>
      </div>

      {/* ABA 1: DEMANDA & GERAÇÃO DO MAPA */}
      {aba === 'DEMANDA' && (
        <div>
          <div className="card mb-16">
            <div className="flex gap-12 flex-wrap items-end">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Data do Mapa</label>
                <input type="date" className="form-input" value={dataMapa} onChange={(e) => setDataMapa(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Pedidos Previsão De</label>
                <input type="date" className="form-input" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Até</label>
                <input type="date" className="form-input" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
              <div className="form-group" style={{ minWidth: 160, marginBottom: 0 }}>
                <label className="form-label">Grupo</label>
                <select className="form-input" value={grupoFiltro} onChange={(e) => setGrupoFiltro(e.target.value)}>
                  <option value="">Todos os Grupos</option>
                  {gruposDisponiveis.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-6 text-xs cursor-pointer mb-8">
                <input type="checkbox" checked={incluirRascunho} onChange={(e) => setIncluirRascunho(e.target.checked)} />
                Incluir Rascunhos
              </label>
              <button type="button" className="btn btn--info" onClick={carregarTudo}>
                <RefreshCw size={14} /> Puxar Demanda
              </button>
            </div>
          </div>

          {/* Adicionar corte extra manual */}
          {podeEscrever && (
            <div className="card mb-16">
              <div className="flex gap-8 flex-wrap items-end">
                <div className="form-group" style={{ flex: 2, minWidth: 240, marginBottom: 0 }}>
                  <label className="form-label">Adicionar Corte Extra / Estoque ao Mapa</label>
                  <select className="form-input" value={extraProdId} onChange={(e) => setExtraProdId(e.target.value)}>
                    <option value="">Selecione um corte...</option>
                    {subprodutosLista.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.codigo} — {p.descricao}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ width: 140, marginBottom: 0 }}>
                  <label className="form-label">Produzir (kg)</label>
                  <input type="number" step="0.001" className="form-input" value={extraQtdKg} onChange={(e) => setExtraQtdKg(e.target.value)} placeholder="50" />
                </div>
                <button type="button" className="btn btn--ghost" onClick={handleAddLinhaExtra}>
                  <Plus size={15} /> Incluir no Mapa
                </button>
              </div>
            </div>
          )}

          {/* Tabela Consolidada */}
          <div className="card mb-16" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Usar</th>
                    <th>Corte / Produto</th>
                    <th>Especificação & Clientes</th>
                    <th style={{ textAlign: 'right' }}>Pedidos</th>
                    <th style={{ textAlign: 'right' }}>Estoque + OP</th>
                    <th style={{ textAlign: 'right' }}>Produzir (kg)</th>
                    <th>Matéria-Prima (Árvore)</th>
                    <th style={{ textAlign: 'right' }}>MP Necess. (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasMapa.map((l, idx) => (
                    <tr key={`${l.produto_id}-${idx}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(l.incluir)}
                          onChange={(e) =>
                            setLinhasMapa((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, incluir: e.target.checked } : x)),
                            )
                          }
                        />
                      </td>
                      <td>
                        <div className="font-bold">
                          <span className="font-mono text-xs text-muted">{l.produto_codigo}</span> {l.produto_descricao}
                        </div>
                        <div className="text-xs text-muted">{l.grupo || 'SEM GRUPO'} • {l.conservacao}</div>
                      </td>
                      <td className="text-xs" style={{ maxWidth: 260 }}>
                        <div>{l.especificacao || '-'}</div>
                        {l.clientes?.length > 0 && (
                          <div className="text-muted mt-2">
                            {l.clientes.map((c) => `${c.cliente_nome} (${c.qtd_kg}kg)`).join(', ')}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(l.qtd_pedida_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                        {fmtKg(l.saldo_disponivel_kg)}
                        {l.saldo_em_op_kg > 0 && <div className="text-info">+{fmtKg(l.saldo_em_op_kg)} em OP</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.001"
                          className="form-input"
                          style={{ width: 95, textAlign: 'right', display: 'inline-block' }}
                          value={l.qtd_produzir_kg}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value || 0))
                            const rend = Number(l.rendimento_usado_pct || 100)
                            const mpKg = l.materia_prima_id ? Number((val / ((rend > 5 ? rend : 100) / 100)).toFixed(3)) : 0
                            setLinhasMapa((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? { ...x, qtd_produzir_kg: val, qtd_mp_necessaria_kg: mpKg }
                                  : x,
                              ),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className="form-input text-xs"
                          value={l.materia_prima_id || ''}
                          onChange={(e) => {
                            const mpId = e.target.value || null
                            const vinc = arvore.find((a) => a.pai_id === mpId && a.filho_id === l.produto_id)
                            const rend = vinc ? Number(vinc.rendimento_aprendido_pct || vinc.rendimento_esperado_pct || 100) : 100
                            const mpKg = mpId ? Number((Number(l.qtd_produzir_kg || 0) / ((rend > 5 ? rend : 100) / 100)).toFixed(3)) : 0
                            setLinhasMapa((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? { ...x, materia_prima_id: mpId, rendimento_usado_pct: rend, qtd_mp_necessaria_kg: mpKg }
                                  : x,
                              ),
                            )
                          }}
                        >
                          <option value="">Sem MP / Corte direto</option>
                          {mpsLista.map((mp) => (
                            <option key={mp.id} value={mp.id}>
                              {mp.codigo} — {mp.descricao}
                            </option>
                          ))}
                        </select>
                        {l.materia_prima_id && (
                          <div className="text-xs text-muted mt-2">Rend. Árvore: {l.rendimento_usado_pct}%</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold text-warning">
                        {l.materia_prima_id ? fmtKg(l.qtd_mp_necessaria_kg) : '-'}
                      </td>
                    </tr>
                  ))}
                  {linhasMapa.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhum corte pendente nos pedidos abertos para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {podeEscrever && (
            <div className="card flex justify-between items-center flex-wrap gap-12">
              <div className="flex gap-16 flex-wrap items-center">
                <div>
                  <div className="text-xs text-muted">Cortes Selecionados</div>
                  <div className="font-bold text-lg">{totaisSelecionados.cortes} ({fmtKg(totaisSelecionados.kgProduzir)})</div>
                </div>
                <div>
                  <div className="text-xs text-muted">Matéria-Prima Estimada</div>
                  <div className="font-bold text-lg text-warning">{fmtKg(totaisSelecionados.kgMp)}</div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label text-xs">Agrupamento das OPs</label>
                  <select className="form-input" value={agruparModo} onChange={(e) => setAgruparModo(e.target.value)}>
                    <option value="MP">1 OP por Matéria-Prima (Recomendado)</option>
                    <option value="GRUPO">1 OP por Grupo (Bovino/Aves)</option>
                    <option value="UNICO">OP Única</option>
                  </select>
                </div>
                <div className="form-group" style={{ minWidth: 200, marginBottom: 0 }}>
                  <label className="form-label text-xs">Observações do Mapa</label>
                  <input type="text" className="form-input" value={observacoesMapa} onChange={(e) => setObservacoesMapa(e.target.value)} placeholder="Turno manhã..." />
                </div>
              </div>
              <div className="flex gap-8">
                <button type="button" className="btn btn--ghost" onClick={() => handleSalvarEGerarOps(false)}>
                  Salvar Só Rascunho
                </button>
                <button type="button" className="btn btn--primary" onClick={() => handleSalvarEGerarOps(true)}>
                  <Play size={15} /> Salvar Mapa & Gerar OPs (1 Clique)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 2: MAPAS SALVOS */}
      {aba === 'MAPAS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Itens</th>
                  <th style={{ textAlign: 'right' }}>Cortes (kg)</th>
                  <th style={{ textAlign: 'right' }}>MP (kg)</th>
                  <th style={{ textAlign: 'right' }}>OPs Geradas</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {mapas.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono font-bold text-primary">{m.codigo}</td>
                    <td>{m.data_mapa}</td>
                    <td><span className={`badge ${m.status === 'ABERTO' ? 'badge--warning' : 'badge--success'}`}>{m.status}</span></td>
                    <td style={{ textAlign: 'right' }}>{m.qtd_itens}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(m.total_previsto_kg)}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-warning">{fmtKg(m.total_mp_kg)}</td>
                    <td style={{ textAlign: 'right' }}>{m.qtd_ops}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-6">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={async () => setMapaDetalhe(await mapaProducaoQueries.obterMapa(m.id))}
                        >
                          Ver OPs
                        </button>
                        {podeEscrever && m.status === 'ABERTO' && (
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => handleGerarOpsExistente(m.id)}>
                            <Play size={14} /> Gerar OPs
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {mapas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center p-24 text-muted">Nenhum mapa salvo ainda.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {mapaDetalhe && (
            <div className="p-16 border-t border-border" style={{ background: 'var(--bg-2)' }}>
              <div className="flex justify-between items-center mb-8">
                <strong>{mapaDetalhe.codigo} — OPs Vinculadas ({mapaDetalhe.ops?.length || 0})</strong>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMapaDetalhe(null)}>Fechar</button>
              </div>
              <div className="flex gap-8 flex-wrap">
                {(mapaDetalhe.ops || []).map((op) => (
                  <span key={op.id} className="badge badge--info">{op.codigo} ({op.status}) — {op.nome}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 3: ÁRVORE AUTO-APRENDIZ */}
      {aba === 'ARVORE' && (
        <div>
          <div className="card mb-16" style={{ background: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.3)' }}>
            <div className="flex justify-between items-center flex-wrap gap-12">
              <div className="flex items-center gap-8 text-sm">
                <Sparkles size={18} className="text-primary" />
                <span>
                  Toda vez que uma <strong>OP é finalizada</strong>, o sistema aprende automaticamente qual Matéria-Prima originou cada corte e atualiza a média real de rendimento.
                </span>
              </div>
              <label className="flex items-center gap-6 text-xs font-bold cursor-pointer">
                <input type="checkbox" checked={apenasPendentes} onChange={(e) => setApenasPendentes(e.target.checked)} />
                Mostrar só pendentes de revisão ({pendentesArvore.length})
              </label>
            </div>
          </div>

          {podeEscrever && (
            <form onSubmit={handleSalvarVinculoManual} className="card mb-16">
              <div className="text-xs font-bold uppercase text-muted mb-8">Novo Vínculo Manual na Árvore</div>
              <div className="flex gap-8 flex-wrap items-end">
                <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
                  <label className="form-label">Matéria-Prima (Pai)</label>
                  <select className="form-input" value={novoPaiId} onChange={(e) => setNovoPaiId(e.target.value)} required>
                    <option value="">Selecione MP...</option>
                    {mpsLista.map((p) => (
                      <option key={p.id} value={p.id}>{p.codigo} — {p.descricao}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
                  <label className="form-label">Corte / Subproduto (Filho)</label>
                  <select className="form-input" value={novoFilhoId} onChange={(e) => setNovoFilhoId(e.target.value)} required>
                    <option value="">Selecione corte...</option>
                    {subprodutosLista.map((p) => (
                      <option key={p.id} value={p.id}>{p.codigo} — {p.descricao}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ width: 130, marginBottom: 0 }}>
                  <label className="form-label">% Rendimento</label>
                  <input type="number" step="0.01" className="form-input" value={novoRendPct} onChange={(e) => setNovoRendPct(e.target.value)} />
                </div>
                <button type="submit" className="btn btn--primary">
                  <Plus size={15} /> Vincular
                </button>
              </div>
            </form>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Matéria-Prima (Pai)</th>
                    <th>Corte Produzido (Filho)</th>
                    <th>Origem</th>
                    <th style={{ textAlign: 'right' }}>Amostras OP</th>
                    <th style={{ textAlign: 'right' }}>% Aprendido Real</th>
                    <th style={{ textAlign: 'right' }}>% Oficial Esperado</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {arvoreFiltrada.map((a) => {
                    const conf = Number(a.confirmado) === 1
                    const valorRend = rendEditMap[a.id] ?? (a.rendimento_esperado_pct ?? a.rendimento_aprendido_pct ?? '')
                    return (
                      <tr key={a.id}>
                        <td><strong>{a.pai_codigo}</strong> — {a.pai_descricao}</td>
                        <td><strong>{a.filho_codigo}</strong> — {a.filho_descricao}</td>
                        <td>
                          <span className={`badge ${a.origem_vinculo === 'OP_AUTO' ? 'badge--warning' : 'badge--info'}`}>
                            {a.origem_vinculo === 'OP_AUTO' ? 'Aprendido OP' : 'Manual'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{a.amostras_aprendizado || 0}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-cyan">
                          {a.rendimento_aprendido_pct != null ? `${a.rendimento_aprendido_pct}%` : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            step="0.01"
                            className="form-input"
                            style={{ width: 85, textAlign: 'right', display: 'inline-block' }}
                            value={valorRend}
                            onChange={(e) => setRendEditMap((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          />
                        </td>
                        <td>
                          <span className={`badge ${conf ? 'badge--success' : 'badge--warning'}`}>
                            {conf ? 'Confirmado' : 'Revisar'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {podeEscrever && (
                            <div className="flex justify-end gap-6">
                              <button type="button" className="btn btn--success btn--sm" onClick={() => handleConfirmarArvore(a)}>
                                <CheckCircle2 size={14} /> {conf ? 'Atualizar' : 'Confirmar'}
                              </button>
                              <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleDescartarArvore(a.id)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {arvoreFiltrada.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhum vínculo encontrado na árvore.
                      </td>
                    </tr>
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
