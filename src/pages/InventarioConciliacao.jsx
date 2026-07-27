import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCcw, CheckCircle, AlertTriangle, X, Layers, ChevronDown, ChevronRight, MapPin, Filter } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { StatusItemBadge, InventarioStatusBadge } from '../components/shared/Badge'
import { format } from 'date-fns'
import * as inventariosQueries from '../queries/inventarios.js';

export function InventarioConciliacao() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toastSuccess, toastError, operador } = useAppStore()

  const [inventario, setInventario] = useState(null)
  const [itens, setItens] = useState([])
  const [zonas, setZonas] = useState([])
  const [ira, setIra] = useState(0)
  const [loadingConciliar, setLoadingConciliar] = useState(false)
  const [confirmarAjuste, setConfirmarAjuste] = useState(false)
  const [itemParaValidar, setItemParaValidar] = useState(null)
  const [loadingValidar, setLoadingValidar] = useState(false)

  // Controle de sanfona por endereço
  const [expandidos, setExpandidos] = useState({}) // { [endereco]: boolean }
  const [filtroStatus, setFiltroStatus] = useState('todos') // todos | pendentes | divergentes | ok

  const carregar = useCallback(async () => {
    try {
      const [inv, iraData, lista, zonasData] = await Promise.all([
        inventariosQueries.buscar(parseInt(id)),
        inventariosQueries.calcularIRA(parseInt(id)),
        inventariosQueries.listarItens(parseInt(id)),
        inventariosQueries.listarZonas(parseInt(id)).catch(() => []),
      ])
      setInventario(inv)
      setIra(iraData.ira_geral)
      setItens(lista)
      setZonas(zonasData)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar detalhes')
    }
  }, [id, toastError])

  useEffect(() => { carregar() }, [carregar])

  const handleConciliar = async () => {
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Apenas gestores podem conciliar.')
    setLoadingConciliar(true)
    try {
      const isCargaInicial = inventario?.tipo === 'CargaInicial'
      let res
      if (isCargaInicial) {
        res = await inventariosQueries.conciliarCargaInicial({
          inventario_id: parseInt(id), operador_id: operador.id, operador_nome: operador.nome
        })
      } else {
        res = await inventariosQueries.conciliar({
          inventario_id: parseInt(id), operador_id: operador.id, operador_nome: operador.nome
        })
      }
      if (res.success) {
        toastSuccess('Ajustes Aplicados', `${res.atualizados || res.inseridos || 0} itens atualizados no estoque.`)
        setConfirmarAjuste(false)
        carregar()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoadingConciliar(false)
    }
  }

  const handleRecontarEndereco = async (endereco, e) => {
    e.stopPropagation()
    if (!window.confirm(`Deseja resetar o endereço "${endereco}" para recontagem completa? Todos os itens deste endereço voltarão para Pendente.`)) return
    try {
      const res = await inventariosQueries.recontarEndereco(parseInt(id), endereco)
      if (res.success) {
        toastSuccess('Endereço Resetado', `${endereco} voltou para Pendente.`)
        carregar()
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const handleCancelarItem = async (item_id, descricao, e) => {
    e.stopPropagation()
    if (!window.confirm(`Cancelar o item "${descricao}"? Ele será removido deste inventário.`)) return
    try {
      const res = await inventariosQueries.cancelarItem(item_id)
      if (res.success) { toastSuccess('Item Cancelado', 'Item removido do inventário.'); carregar() }
      else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const confirmarValidarSemAjuste = async () => {
    if (!itemParaValidar) return
    setLoadingValidar(true)
    try {
      const res = await inventariosQueries.validarEstoqueSemAjuste({
        item_id: itemParaValidar.id,
        operador_id: operador.id,
        operador_nome: operador.nome
      })
      if (res.success) {
        toastSuccess('Validado', 'Estoque validado sem ajuste.')
        setItemParaValidar(null)
        carregar()
      }
      else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
    finally { setLoadingValidar(false) }
  }

  const toggleExpandir = (endereco) => {
    setExpandidos(prev => ({ ...prev, [endereco]: !prev[endereco] }))
  }

  const toggleExpandirTodos = (expandir) => {
    const novo = {}
    const listaEnderecos = [...new Set(itens.map(i => i.endereco))]
    listaEnderecos.forEach(end => novo[end] = expandir)
    setExpandidos(novo)
  }

  if (!inventario) return null

  const pct = ira
  let iraClass = 'ok'
  if (pct < 95) iraClass = 'warning'
  if (pct < 90) iraClass = 'danger'

  const totalDivergentes = itens.filter(i => i.status_item === 'Aguardando Ajuste').length
  const totalPendentes = itens.filter(i => ['Pendente', '2ª Contagem', '3ª Contagem'].includes(i.status_item)).length
  const totalOk = itens.filter(i => i.status_item === 'OK').length

  const enderecosTotal = new Set(itens.map(i => i.endereco)).size
  const enderecosContados = new Set(itens.filter(i => i.qtd_contada_caixas !== null).map(i => i.endereco)).size

  const isClosed = ['Finalizado OK', 'Cancelado'].includes(inventario.status)
  const isCargaInicial = inventario.tipo === 'CargaInicial'

  const titulo = isCargaInicial
    ? 'Carga Inicial do Sistema'
    : inventario.nome || `${inventario.tipo_filtro}: ${inventario.identificador_filtro}`

  // Agrupar itens por endereço para renderizar cards sanfona
  const todosEnderecos = [...new Set(itens.map(i => i.endereco))].sort()

  const dadosEnderecos = todosEnderecos.map(endereco => {
    const itensDoEnd = itens.filter(i => i.endereco === endereco)
    const pendentes = itensDoEnd.filter(i => ['Pendente', '2ª Contagem', '3ª Contagem'].includes(i.status_item)).length
    const divergentes = itensDoEnd.filter(i => i.status_item === 'Aguardando Ajuste').length
    const ok = itensDoEnd.filter(i => i.status_item === 'OK').length

    // Determinar status dominante do endereço
    let statusEnd = 'OK'
    let statusColor = 'var(--success)'
    if (pendentes > 0) {
      const p3 = itensDoEnd.some(i => i.status_item === '3ª Contagem')
      const p2 = itensDoEnd.some(i => i.status_item === '2ª Contagem')
      if (p3) { statusEnd = '3ª Contagem'; statusColor = 'var(--danger)' }
      else if (p2) { statusEnd = '2ª Contagem'; statusColor = '#f97316' }
      else { statusEnd = 'Pendente'; statusColor = 'var(--warning)' }
    } else if (divergentes > 0) {
      statusEnd = 'Aguardando Ajuste'
      statusColor = 'var(--danger)'
    }

    return {
      endereco,
      itens: itensDoEnd,
      total: itensDoEnd.length,
      pendentes,
      divergentes,
      ok,
      statusEnd,
      statusColor
    }
  })

  // Filtrar endereços
  const enderecosFiltrados = dadosEnderecos.filter(d => {
    if (filtroStatus === 'pendentes') return d.pendentes > 0
    if (filtroStatus === 'divergentes') return d.divergentes > 0
    if (filtroStatus === 'ok') return d.pendentes === 0 && d.divergentes === 0
    return true
  })

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header mb-16">
        <div className="flex items-center gap-16">
          <button className="btn btn--ghost btn--icon" onClick={() => navigate('/inventario')}><ArrowLeft size={20}/></button>
          <div>
            <h1 className="page-header__title">{titulo}</h1>
            <p className="page-header__subtitle">
              Inventário #{inventario.id}
              {inventario.ciclo_nome && <span className="text-muted"> · Ciclo: {inventario.ciclo_nome}</span>}
              {isCargaInicial && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--warning)', padding: '2px 8px', background: 'var(--warning-muted)', borderRadius: 99 }}>CARGA INICIAL</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-12">
          <InventarioStatusBadge status={inventario.status} />
          {!isClosed && (
            <button
              className="btn btn--primary"
              onClick={() => setConfirmarAjuste(true)}
              disabled={totalPendentes > 0 || totalDivergentes === 0}
              title={totalPendentes > 0 ? 'Ainda há itens pendentes de contagem' : ''}
            >
              <CheckCircle size={16}/> Aplicar Ajustes
            </button>
          )}
        </div>
      </div>

      {/* ── Painel de Confirmação de Ajuste ────────────────────────────────── */}
      {confirmarAjuste && !itemParaValidar && (
        <div className="card mb-16" style={{ borderColor: 'var(--warning)', borderWidth: 2, borderStyle: 'solid', background: 'var(--warning-muted)' }}>
          <div className="flex items-center gap-12 mb-12">
            <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
            <strong style={{ color: 'var(--warning)', fontSize: 15 }}>Confirmar Aplicação de Ajustes</strong>
          </div>
          <p className="text-sm mb-12">
            Você está prestes a aplicar <strong>{totalDivergentes} ajuste(s)</strong> no estoque real.
            Esta ação não pode ser desfeita. O log de auditoria será gerado automaticamente.
          </p>
          <div className="flex gap-8">
            <button className="btn btn--primary" onClick={handleConciliar} disabled={loadingConciliar}>
              {loadingConciliar ? 'Aplicando...' : 'Confirmar e Aplicar Ajustes'}
            </button>
            <button className="btn btn--ghost" onClick={() => setConfirmarAjuste(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Painel de Validação Individual ─────────────────────────────────── */}
      {itemParaValidar && !confirmarAjuste && (
        <div className="card mb-16" style={{ borderColor: 'var(--success)', borderWidth: 2, borderStyle: 'solid', background: 'var(--success-muted)' }}>
          <div className="flex items-center gap-12 mb-12">
            <CheckCircle size={20} style={{ color: 'var(--success)' }} />
            <strong style={{ color: 'var(--success)', fontSize: 15 }}>Validar Físico (Sem Ajuste)</strong>
          </div>
          <p className="text-sm mb-12">
            Você confirmou fisicamente que a quantidade do sistema para o item <strong>{itemParaValidar.descricao}</strong> está correta e a contagem foi ignorada? Nenhuma alteração financeira será gerada.
          </p>
          <div className="flex gap-8">
            <button className="btn btn--primary" onClick={confirmarValidarSemAjuste} disabled={loadingValidar}>
              {loadingValidar ? 'Validando...' : 'Confirmar Validação'}
            </button>
            <button className="btn btn--ghost" onClick={() => setItemParaValidar(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── KPI & Progresso ────────────────────────────────────────────────── */}
      <div className="card mb-16">
        <div className="flex justify-between items-end mb-8">
          <div className="text-sm text-muted font-bold tracking-widest uppercase">IRA — Inventory Record Accuracy</div>
          <div className={`text-2xl font-black text-${iraClass}`}>{pct}%</div>
        </div>
        <div className="ira-bar">
          <div className={`ira-bar__fill ira-bar__fill--${iraClass}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="flex items-center justify-between mt-12 pt-12" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex gap-24 text-xs text-muted">
            <span style={{ color: totalPendentes > 0 ? 'var(--warning)' : undefined }}><strong>{totalPendentes}</strong> pendentes</span>
            <span style={{ color: 'var(--success)' }}><strong>{totalOk}</strong> ok</span>
            <span style={{ color: totalDivergentes > 0 ? 'var(--danger)' : undefined }}><strong>{totalDivergentes}</strong> divergentes</span>
            <span style={{ marginLeft: 'auto' }}>{itens.length} itens no total</span>
          </div>
          <div className="text-sm font-bold" style={{ color: enderecosContados === enderecosTotal ? 'var(--success)' : 'var(--text)' }}>
            {enderecosContados} de {enderecosTotal} endereços contados ({enderecosTotal > 0 ? Math.round((enderecosContados/enderecosTotal)*100) : 0}%)
          </div>
        </div>
      </div>

      {/* ── Zonas (Wall-to-Wall) ────────────────────────────────────────────── */}
      {zonas.length > 0 && (
        <div className="card mb-16">
          <div className="flex items-center gap-8 mb-12">
            <Layers size={16} style={{ color: 'var(--primary)' }} />
            <h3 style={{ fontWeight: 700, fontSize: 14 }}>Progresso por Zona</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {zonas.map(z => (
              <div key={z.id} style={{ padding: 12, background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{z.nome_zona}</div>
                <div style={{ position: 'relative', height: 6, background: 'var(--bg-card)', borderRadius: 99, marginBottom: 6 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${z.pct}%`, background: z.pct === 100 ? 'var(--success)' : 'var(--primary)', borderRadius: 99, transition: 'width 0.4s ease' }} />
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>{z.contados}/{z.total} contados</span>
                  <span style={{ fontWeight: 700, color: z.pct === 100 ? 'var(--success)' : 'var(--text-muted)' }}>{z.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Toolbar de Filtro e Endereços ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-12 flex-wrap gap-12">
        <div className="flex items-center gap-8">
          <Filter size={15} style={{ color: 'var(--text-muted)' }} />
          <button
            className={`btn btn--sm ${filtroStatus === 'todos' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('todos')}
          >
            Todos ({dadosEnderecos.length})
          </button>
          <button
            className={`btn btn--sm ${filtroStatus === 'pendentes' ? 'btn--warning' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('pendentes')}
          >
            Pendentes ({dadosEnderecos.filter(d => d.pendentes > 0).length})
          </button>
          <button
            className={`btn btn--sm ${filtroStatus === 'divergentes' ? 'btn--danger' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('divergentes')}
          >
            Divergentes ({dadosEnderecos.filter(d => d.divergentes > 0).length})
          </button>
          <button
            className={`btn btn--sm ${filtroStatus === 'ok' ? 'btn--success' : 'btn--ghost'}`}
            onClick={() => setFiltroStatus('ok')}
          >
            OK ({dadosEnderecos.filter(d => d.pendentes === 0 && d.divergentes === 0).length})
          </button>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--ghost btn--sm" onClick={() => toggleExpandirTodos(true)}>
            Expandir Todos
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => toggleExpandirTodos(false)}>
            Recolher Todos
          </button>
        </div>
      </div>

      {/* ── Lista Resumida de Endereços (Sanfona) ─────────────────────────── */}
      <div className="flex-col gap-12 mb-24">
        {enderecosFiltrados.length === 0 ? (
          <div className="card text-center text-muted py-24">Nenhum endereço encontrado para o filtro selecionado.</div>
        ) : (
          enderecosFiltrados.map(d => {
            const isExpanded = !!expandidos[d.endereco]
            return (
              <div
                key={d.endereco}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderLeft: `5px solid ${d.statusColor}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                }}
              >
                {/* Header do Endereço (Clicável para expandir) */}
                <div
                  onClick={() => toggleExpandir(d.endereco)}
                  style={{
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: isExpanded ? 'var(--bg-2)' : 'transparent',
                    transition: 'background 0.15s'
                  }}
                >
                  <div className="flex items-center gap-12">
                    <div style={{ color: 'var(--text-muted)' }}>
                      {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </div>
                    <MapPin size={18} style={{ color: d.statusColor }} />
                    <span className="font-mono font-bold text-lg">{d.endereco}</span>
                  </div>

                  <div className="flex items-center gap-16">
                    {/* Badge do Status da Contagem do Endereço */}
                    <span style={{
                      background: `${d.statusColor}18`,
                      color: d.statusColor,
                      border: `1px solid ${d.statusColor}40`,
                      borderRadius: 99,
                      padding: '3px 10px',
                      fontSize: 11,
                      fontWeight: 700
                    }}>
                      {d.statusEnd}
                    </span>

                    {/* Resumo de Contadores */}
                    <div className="flex gap-12 text-xs font-mono">
                      {d.pendentes > 0 && <span className="text-warning"><strong>{d.pendentes}</strong> pendente{d.pendentes > 1 ? 's' : ''}</span>}
                      {d.divergentes > 0 && <span className="text-danger"><strong>{d.divergentes}</strong> div</span>}
                      {d.ok > 0 && <span className="text-success"><strong>{d.ok}</strong> ok</span>}
                      <span className="text-muted">({d.total} {d.total === 1 ? 'item' : 'itens'})</span>
                    </div>

                    {/* Botão Recontar Endereço */}
                    {!isClosed && (d.pendentes > 0 || d.divergentes > 0) && (
                      <button
                        className="btn btn--ghost btn--sm"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        title="Resetar este endereço para recontagem"
                        onClick={(e) => handleRecontarEndereco(d.endereco, e)}
                      >
                        <RefreshCcw size={12} /> Resetar
                      </button>
                    )}
                  </div>
                </div>

                {/* Tabela de Itens (Expande / Recolhe) */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-1)', padding: 12 }}>
                    <table style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th style={{ textAlign: 'right' }}>Validade Sist.</th>
                          <th style={{ textAlign: 'right' }}>Validade Cont.</th>
                          <th style={{ textAlign: 'right' }}>Sistema (Cx/Kg)</th>
                          <th style={{ textAlign: 'right' }}>Contado (Cx/Kg)</th>
                          <th style={{ textAlign: 'right' }}>Divergência</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.itens.map(item => {
                          const diffCx = item.qtd_contada_caixas !== null
                            ? (item.qtd_contada_caixas || 0) - (item.qtd_sistema_caixas || 0)
                            : null
                          const diffKg = item.qtd_contada_kg !== null
                            ? (item.qtd_contada_kg || 0) - (item.qtd_sistema_kg || 0)
                            : null
                          const hasDivergencia = item.status_item === 'Aguardando Ajuste'

                          let tipoDivergencia = ''
                          if (diffCx !== null) {
                            if (item.qtd_sistema_caixas === 1 && (item.qtd_contada_caixas || 0) === 0) {
                              tipoDivergencia = 'Falta'
                            } else if (item.qtd_sistema_caixas === 0 && (item.qtd_contada_caixas || 0) === 1) {
                              tipoDivergencia = 'Sobra'
                            } else if (diffKg !== 0 || item.validade !== item.validade_contada) {
                              tipoDivergencia = 'Peso/Validade'
                            } else if (diffCx !== 0) {
                              tipoDivergencia = `${diffCx > 0 ? '+' : ''}${diffCx} cx`
                            }
                          }

                          return (
                            <tr key={item.id} style={{ background: hasDivergencia ? 'rgba(var(--danger-rgb, 239,68,68), 0.05)' : undefined }}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{item.descricao}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>EAN/SSCC: {item.ean_caixa || '-'} | Lote: {item.lote || '-'} | {item.codigo}</div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div className="text-muted font-bold text-xs">
                                  {item.validade ? item.validade.toString().substring(0,10) : <span style={{ opacity: 0.4 }}>—</span>}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div className="text-warning font-bold text-xs">
                                  {item.validade_contada ? item.validade_contada.toString().substring(0,10) : <span style={{ opacity: 0.4 }}>—</span>}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div className="text-cyan font-bold">{item.qtd_sistema_caixas ?? '-'} cx</div>
                                <div className="text-muted text-xs">{item.qtd_sistema_kg ?? '-'} kg</div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {item.qtd_contada_caixas !== null ? (
                                  <>
                                    <div style={{ fontWeight: 700, color: hasDivergencia ? 'var(--danger)' : 'var(--success)' }}>
                                      {item.qtd_contada_caixas} cx
                                    </div>
                                    <div className="text-muted text-xs">{item.qtd_contada_kg} kg</div>
                                  </>
                                ) : <span className="text-muted">Aguardando...</span>}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {tipoDivergencia ? (
                                  <span style={{
                                    fontWeight: 700,
                                    color: tipoDivergencia === 'Falta' ? 'var(--danger)' :
                                           tipoDivergencia === 'Sobra' ? 'var(--warning)' : 'var(--warning)'
                                  }}>
                                    {tipoDivergencia}
                                  </span>
                                ) : <span className="text-muted">—</span>}
                              </td>
                              <td><StatusItemBadge status={item.status_item} /></td>
                              <td style={{ textAlign: 'right' }}>
                                {!isClosed && (
                                  <div className="flex justify-end gap-4">
                                    <button
                                      className="btn btn--ghost btn--sm btn--icon text-danger"
                                      title="Cancelar este item"
                                      onClick={(e) => handleCancelarItem(item.id, item.descricao, e)}
                                    >
                                      <X size={13}/>
                                    </button>
                                    {hasDivergencia && (
                                      <button
                                        className="btn btn--ghost btn--sm btn--icon text-success"
                                        title="Validar Físico (Sem Ajuste)"
                                        onClick={(e) => { e.stopPropagation(); setItemParaValidar(item) }}
                                      >
                                        <CheckCircle size={13}/>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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
