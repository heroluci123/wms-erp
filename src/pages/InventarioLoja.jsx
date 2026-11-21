import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Lock,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Scale,
  Unlock,
} from 'lucide-react'
import { varejoQueries } from '../queries/varejo'
import { useAppStore } from '../store/appStore'
import { imprimirFichaInventarioEmporio } from '../utils/impressaoTermica'

const fmtKg = (v) => `${Number(v || 0).toFixed(3).replace('.', ',')} kg`

export function InventarioLoja() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [modo, setModo] = useState('ANALISTA') // 'ANALISTA' | 'OPERADOR'
  const [loading, setLoading] = useState(true)
  const [inventarios, setInventarios] = useState([])
  const [invSelId, setInvSelId] = useState(null)

  // Novo inventário
  const [novoTipo, setNovoTipo] = useState('ACOUGUE_BIPADO') // 'ACOUGUE_BIPADO' | 'EMPORIO_CEGO'
  const [novoSetor, setNovoSetor] = useState('EMPORIO')
  const [novoTitulo, setNovoTitulo] = useState('')
  const [criando, setCriando] = useState(false)

  // Contagem Empório (blind edits)
  const [contagensEdit, setContagensEdit] = useState({})
  const [salvandoContagem, setSalvandoContagem] = useState(false)

  // Operador Açougue (bipagem QR + pesagem MP)
  const [codigoBip, setCodigoBip] = useState('')
  const [bipando, setBipando] = useState(false)
  const [pesosMpEdit, setPesosMpEdit] = useState({})
  const inputBipRef = useRef(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await varejoQueries.listarInventarios()
      const lista = res.data || []
      setInventarios(lista)
      setInvSelId((prev) => {
        if (prev && lista.some((x) => x.id === prev)) return prev
        const aberto = lista.find((x) => x.status === 'ABERTO')
        return aberto?.id || lista[0]?.id || null
      })
    } catch (err) {
      toastError('Erro ao carregar inventários', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const invAtual = useMemo(
    () => inventarios.find((i) => i.id === invSelId) || null,
    [inventarios, invSelId],
  )

  const invsLiberadosOperador = useMemo(
    () => inventarios.filter((i) => i.status === 'ABERTO' && i.liberado_operador && i.tipo_inventario === 'ACOUGUE_BIPADO'),
    [inventarios],
  )

  // Inicializa inputs locais quando muda o inventário selecionado
  useEffect(() => {
    if (!invAtual) return
    if (invAtual.tipo_inventario === 'EMPORIO_CEGO') {
      const map = {}
      for (const it of invAtual.itens_json || []) {
        map[it.produto_id] = it.qtd_contada === null || it.qtd_contada === undefined ? '' : String(it.qtd_contada)
      }
      setContagensEdit(map)
    } else {
      const mapMp = {}
      for (const mp of invAtual.mps_pesadas_json || []) {
        mapMp[mp.caixa_id] = mp.peso_medido_kg === null || mp.peso_medido_kg === undefined ? '' : String(mp.peso_medido_kg)
      }
      setPesosMpEdit(mapMp)
    }
  }, [invAtual?.id, invAtual?.itens_json, invAtual?.mps_pesadas_json])

  const handleCriarInventario = async (e) => {
    e.preventDefault()
    setCriando(true)
    try {
      const res = await varejoQueries.criarInventario({
        titulo: novoTitulo.trim() || undefined,
        tipo_inventario: novoTipo,
        setor: novoTipo === 'EMPORIO_CEGO' ? novoSetor : undefined,
        liberado_operador: true,
      })
      toastSuccess('Inventário aberto!', `${res.data.codigo} — ${res.data.titulo}`)
      setNovoTitulo('')
      await carregar()
      setInvSelId(res.data.id)
    } catch (err) {
      toastError('Erro ao criar inventário', err.message)
    } finally {
      setCriando(false)
    }
  }

  const handleAlternarLiberacao = async (inv) => {
    try {
      await varejoQueries.liberarInventario(inv.id, !inv.liberado_operador)
      toastSuccess(
        !inv.liberado_operador ? 'Liberado para Operadores' : 'Bloqueado para Operadores',
        inv.codigo,
      )
      await carregar()
    } catch (err) {
      toastError('Erro ao alterar liberação', err.message)
    }
  }

  const handleSalvarContagemEmporio = async () => {
    if (!invAtual) return
    setSalvandoContagem(true)
    try {
      const itensPayload = (invAtual.itens_json || []).map((it) => {
        const raw = contagensEdit[it.produto_id]
        return {
          produto_id: it.produto_id,
          qtd_contada: raw === '' || raw === undefined ? null : Number(String(raw).replace(',', '.')),
        }
      })
      await varejoQueries.salvarContagemInventario(invAtual.id, itensPayload)
      toastSuccess('Contagem salva!', 'Divergências recalculadas.')
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar contagem', err.message)
    } finally {
      setSalvandoContagem(false)
    }
  }

  const handleFinalizarInventario = async (inv) => {
    try {
      const res = await varejoQueries.finalizarInventario(inv.id)
      toastSuccess(
        `Inventário ${res.codigo} conciliado!`,
        res.tipo_inventario === 'ACOUGUE_BIPADO'
          ? `Etiquetas ausentes (perda): ${res.etiquetas_perdidas || 0} • MPs ajustadas: ${res.mps_ajustadas || 0}`
          : `${res.ajustados || 0} item(ns) ajustado(s) no estoque.`,
      )
      await carregar()
    } catch (err) {
      toastError('Erro ao finalizar inventário', err.message)
    }
  }

  const handleBiparEtiqueta = async (e) => {
    e.preventDefault()
    if (!invAtual || !codigoBip.trim()) return
    setBipando(true)
    try {
      const res = await varejoQueries.biparEtiquetaInventario(invAtual.id, codigoBip.trim())
      toastSuccess(
        `Etiqueta ${res.data.codigo_etiqueta} bipada!`,
        `${res.data.produto_descricao} (${fmtKg(res.data.peso_liquido_kg)})`,
      )
      setCodigoBip('')
      await carregar()
      setTimeout(() => inputBipRef.current?.focus(), 40)
    } catch (err) {
      toastError('Erro ao bipar etiqueta', err.message)
    } finally {
      setBipando(false)
    }
  }

  const handlePesarMp = async (caixaId) => {
    if (!invAtual) return
    const val = Number(String(pesosMpEdit[caixaId] ?? '').replace(',', '.'))
    if (!Number.isFinite(val) || val < 0) {
      toastWarning('Peso inválido', 'Informe o peso atual da MP na balança (>= 0).')
      return
    }
    try {
      await varejoQueries.pesarMpInventario(invAtual.id, { caixa_id: caixaId, peso_medido_kg: val })
      toastSuccess('Peso da MP registrado!', fmtKg(val))
      await carregar()
    } catch (err) {
      toastError('Erro ao registrar peso da MP', err.message)
    }
  }

  const setBipadas = useMemo(() => {
    if (!invAtual) return new Set()
    return new Set((invAtual.etiquetas_bipadas_json || []).map((e) => String(e.codigo_etiqueta || '').toUpperCase()))
  }, [invAtual])

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckSquare size={20} className="text-primary" /> Inventário — Varejo &amp; Açougue
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Gerenciador do Analista (Empório contagem às cegas + Açougue bipado) e Coletor do Operador (bipar etiquetas + pesar MPs)
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`btn ${modo === 'ANALISTA' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setModo('ANALISTA')}
          >
            <ClipboardList size={15} /> Gerenciador (Analista)
          </button>
          <button
            type="button"
            className={`btn ${modo === 'OPERADOR' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => {
              setModo('OPERADOR')
              if (invsLiberadosOperador.length > 0 && (!invAtual || invAtual.tipo_inventario !== 'ACOUGUE_BIPADO')) {
                setInvSelId(invsLiberadosOperador[0].id)
              }
            }}
          >
            <QrCode size={15} /> Inventário Açougue (Operador)
            {invsLiberadosOperador.length > 0 && (
              <span className="badge badge--success" style={{ marginLeft: 4 }}>{invsLiberadosOperador.length}</span>
            )}
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={carregar}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODO 1: GERENCIADOR DO ANALISTA                                        */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modo === 'ANALISTA' && (
        <>
          {/* ABRIR NOVO INVENTÁRIO */}
          <form onSubmit={handleCriarInventario} className="card" style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
              <label className="form-label">Tipo de Inventário</label>
              <select className="form-input" value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)}>
                <option value="ACOUGUE_BIPADO">Açougue (Bipar Etiquetas QR + Pesar MPs)</option>
                <option value="EMPORIO_CEGO">Empório (Contagem às Cegas — Ficha A4)</option>
              </select>
            </div>
            {novoTipo === 'EMPORIO_CEGO' && (
              <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                <label className="form-label">Setor</label>
                <select className="form-input" value={novoSetor} onChange={(e) => setNovoSetor(e.target.value)}>
                  <option value="EMPORIO">Apenas Empório</option>
                  <option value="TODOS">Todos os Itens Varejo</option>
                </select>
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
              <label className="form-label">Título (Opcional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Inventário Semanal Açougue / Empório..."
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={criando}>
              <Plus size={15} /> {criando ? 'Abrindo...' : 'Abrir Inventário'}
            </button>
          </form>

          {/* LAYOUT: LISTA DE INVENTÁRIOS + DETALHE/CONCILIAÇÃO */}
          <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
            <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="text-xs font-bold uppercase text-muted">Inventários ({inventarios.length})</div>
              {loading ? (
                <div className="text-xs text-muted p-12">Carregando...</div>
              ) : inventarios.length === 0 ? (
                <div className="text-xs text-muted p-12">Nenhum inventário aberto ainda.</div>
              ) : (
                inventarios.map((inv) => {
                  const sel = inv.id === invSelId
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setInvSelId(inv.id)}
                      style={{
                        textAlign: 'left',
                        padding: 10,
                        borderRadius: 8,
                        background: sel ? 'rgba(59,130,246,0.16)' : 'var(--bg-2)',
                        border: `1px solid ${sel ? '#3b82f6' : 'var(--border)'}`,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="font-mono font-bold text-xs">{inv.codigo}</span>
                        <span className={`badge ${inv.status === 'ABERTO' ? 'badge--warning' : 'badge--success'}`} style={{ fontSize: 10 }}>
                          {inv.status}
                        </span>
                      </div>
                      <div className="font-bold text-xs" style={{ marginTop: 4 }}>{inv.titulo}</div>
                      <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                        {inv.tipo_inventario === 'ACOUGUE_BIPADO' ? 'Açougue Bipado' : 'Empório (Cego)'} • {inv.total_itens} itens
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {invAtual ? (
              <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="font-mono font-bold text-info">{invAtual.codigo}</span>
                      <span className={`badge ${invAtual.tipo_inventario === 'ACOUGUE_BIPADO' ? 'badge--info' : 'badge--neutral'}`}>
                        {invAtual.tipo_inventario === 'ACOUGUE_BIPADO' ? 'Açougue (Bipado + MPs)' : 'Empório (Contagem às Cegas)'}
                      </span>
                      <span className={`badge ${invAtual.status === 'ABERTO' ? 'badge--warning' : 'badge--success'}`}>
                        {invAtual.status}
                      </span>
                    </div>
                    <h2 style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 800 }}>{invAtual.titulo}</h2>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {invAtual.tipo_inventario === 'EMPORIO_CEGO' && (
                      <>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => imprimirFichaInventarioEmporio(invAtual, { modoCego: true })}
                        >
                          <Printer size={13} /> Ficha Contagem às Cegas (A4)
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => imprimirFichaInventarioEmporio(invAtual, { modoCego: false })}
                        >
                          <Printer size={13} /> Relação Itens Ativos
                        </button>
                      </>
                    )}
                    {invAtual.status === 'ABERTO' && invAtual.tipo_inventario === 'ACOUGUE_BIPADO' && (
                      <button
                        type="button"
                        className={`btn btn--sm ${invAtual.liberado_operador ? 'btn--warning' : 'btn--ghost'}`}
                        onClick={() => handleAlternarLiberacao(invAtual)}
                      >
                        {invAtual.liberado_operador ? <Unlock size={13} /> : <Lock size={13} />}
                        {invAtual.liberado_operador ? 'Liberado p/ Operador' : 'Bloqueado p/ Operador'}
                      </button>
                    )}
                    {invAtual.status === 'ABERTO' && (
                      <button
                        type="button"
                        className="btn btn--success btn--sm"
                        onClick={() => handleFinalizarInventario(invAtual)}
                      >
                        <CheckCircle2 size={14} /> Finalizar &amp; Conciliar
                      </button>
                    )}
                  </div>
                </div>

                {/* CONTEÚDO EMPÓRIO CEGO */}
                {invAtual.tipo_inventario === 'EMPORIO_CEGO' ? (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Produto</th>
                            <th>Un</th>
                            <th style={{ textAlign: 'right' }}>Saldo Sistema</th>
                            <th style={{ width: 130, textAlign: 'right' }}>Contagem Física</th>
                            <th style={{ textAlign: 'right' }}>Divergência</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invAtual.itens_json || []).length === 0 ? (
                            <tr>
                              <td colSpan={6} className="text-center text-muted p-20">
                                Nenhum item cadastrado no estoque deste setor.
                              </td>
                            </tr>
                          ) : (
                            (invAtual.itens_json || []).map((it) => (
                              <tr key={it.produto_id}>
                                <td className="font-mono text-xs">{it.produto_codigo || '-'}</td>
                                <td className="font-bold text-sm">{it.produto_descricao}</td>
                                <td className="text-xs">{it.unidade_venda}</td>
                                <td className="font-mono" style={{ textAlign: 'right' }}>
                                  {Number(it.saldo_sistema || 0).toFixed(it.unidade_venda === 'KG' ? 3 : 0)}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  {invAtual.status === 'ABERTO' ? (
                                    <input
                                      type="number"
                                      step={it.unidade_venda === 'KG' ? '0.001' : '1'}
                                      min="0"
                                      className="form-input font-mono text-right"
                                      style={{ height: 32, width: 110 }}
                                      placeholder="Cega..."
                                      value={contagensEdit[it.produto_id] ?? ''}
                                      onChange={(e) =>
                                        setContagensEdit((prev) => ({ ...prev, [it.produto_id]: e.target.value }))
                                      }
                                    />
                                  ) : (
                                    <span className="font-mono font-bold">
                                      {it.qtd_contada == null ? '-' : Number(it.qtd_contada).toFixed(it.unidade_venda === 'KG' ? 3 : 0)}
                                    </span>
                                  )}
                                </td>
                                <td
                                  className="font-mono font-bold"
                                  style={{
                                    textAlign: 'right',
                                    color:
                                      Math.abs(Number(it.divergencia || 0)) < 0.001
                                        ? '#94a3b8'
                                        : Number(it.divergencia) > 0
                                          ? '#22c55e'
                                          : '#ef4444',
                                  }}
                                >
                                  {it.qtd_contada == null
                                    ? 'Pendente'
                                    : `${Number(it.divergencia) > 0 ? '+' : ''}${Number(it.divergencia || 0).toFixed(3)}`}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {invAtual.status === 'ABERTO' && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn--primary"
                          disabled={salvandoContagem}
                          onClick={handleSalvarContagemEmporio}
                        >
                          {salvandoContagem ? 'Salvando...' : 'Salvar Contagem Digitada'}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  /* CONTEÚDO AÇOUGUE BIPADO (VISÃO ANALISTA) */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                        <div className="text-xs text-muted uppercase">Etiquetas QR Bipadas</div>
                        <div className="font-mono font-bold text-info" style={{ fontSize: 20 }}>
                          {(invAtual.etiquetas_bipadas_json || []).length} / {(invAtual.itens_json || []).length}
                        </div>
                      </div>
                      <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                        <div className="text-xs text-muted uppercase">Matérias-Primas Pesadas</div>
                        <div className="font-mono font-bold text-warning" style={{ fontSize: 20 }}>
                          {(invAtual.mps_pesadas_json || []).filter((m) => m.pesada).length} / {(invAtual.mps_pesadas_json || []).length}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="font-bold text-xs uppercase text-muted mb-8">Etiquetas Esperadas no Estoque ({(invAtual.itens_json || []).length})</div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Serial</th>
                            <th>Produto</th>
                            <th style={{ textAlign: 'right' }}>Peso</th>
                            <th>Conferência</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invAtual.itens_json || []).length === 0 ? (
                            <tr><td colSpan={4} className="text-center text-muted p-16">Nenhuma etiqueta ativa no momento da abertura.</td></tr>
                          ) : (
                            (invAtual.itens_json || []).map((e) => {
                              const ok = setBipadas.has(String(e.codigo_etiqueta || '').toUpperCase())
                              return (
                                <tr key={e.etiqueta_id || e.codigo_etiqueta}>
                                  <td className="font-mono font-bold">{e.codigo_etiqueta}</td>
                                  <td className="text-sm">{e.produto_descricao}</td>
                                  <td className="font-mono" style={{ textAlign: 'right' }}>{fmtKg(e.peso_liquido_kg)}</td>
                                  <td>
                                    <span className={`badge ${ok ? 'badge--success' : 'badge--danger'}`}>
                                      {ok ? 'Bipada ✅' : 'Ausente'}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div>
                      <div className="font-bold text-xs uppercase text-muted mb-8">Matérias-Primas Pendentes ({(invAtual.mps_pesadas_json || []).length})</div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>EAN MP</th>
                            <th>Produto</th>
                            <th style={{ textAlign: 'right' }}>Sistema</th>
                            <th style={{ textAlign: 'right' }}>Pesado</th>
                            <th style={{ textAlign: 'right' }}>Divergência</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invAtual.mps_pesadas_json || []).length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted p-16">Nenhuma MP aberta/trânsito neste inventário.</td></tr>
                          ) : (
                            (invAtual.mps_pesadas_json || []).map((mp) => (
                              <tr key={mp.caixa_id}>
                                <td className="font-mono text-xs">{mp.ean_caixa}</td>
                                <td className="font-bold text-sm">{mp.produto_descricao}</td>
                                <td className="font-mono" style={{ textAlign: 'right' }}>{fmtKg(mp.peso_sistema_kg)}</td>
                                <td className="font-mono font-bold" style={{ textAlign: 'right' }}>
                                  {mp.pesada ? fmtKg(mp.peso_medido_kg) : 'Pendente'}
                                </td>
                                <td
                                  className="font-mono font-bold"
                                  style={{
                                    textAlign: 'right',
                                    color: !mp.pesada ? '#94a3b8' : Number(mp.divergencia_kg) >= 0 ? '#22c55e' : '#ef4444',
                                  }}
                                >
                                  {mp.pesada ? `${Number(mp.divergencia_kg) > 0 ? '+' : ''}${fmtKg(mp.divergencia_kg)}` : '-'}
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
            ) : (
              <div className="card p-24 text-center text-muted">Selecione ou abra um inventário.</div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODO 2: OPERADOR AÇOUGUE (BIPAR ETIQUETAS QR + PESAR MPs PENDENTES)    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modo === 'OPERADOR' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {invsLiberadosOperador.length === 0 ? (
            <div className="card p-32 text-center text-muted">
              Nenhum inventário do Açougue liberado pelo analista no momento.
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="text-xs font-bold uppercase text-muted">Inventário Liberado:</span>
                {invsLiberadosOperador.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    className={`btn btn--sm ${invSelId === inv.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setInvSelId(inv.id)}
                  >
                    {inv.codigo} — {inv.titulo}
                  </button>
                ))}
              </div>

              {invAtual && invAtual.tipo_inventario === 'ACOUGUE_BIPADO' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
                  {/* BLOCO A: BIPAR ETIQUETAS GERADAS */}
                  <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="font-bold text-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <QrCode size={17} className="text-primary" /> 1. Bipar Etiquetas QR 80×45
                      </span>
                      <span className="badge badge--info font-mono">
                        {(invAtual.etiquetas_bipadas_json || []).length} / {(invAtual.itens_json || []).length} bipadas
                      </span>
                    </div>

                    <form onSubmit={handleBiparEtiqueta} style={{ display: 'flex', gap: 8 }}>
                      <input
                        ref={inputBipRef}
                        type="text"
                        className="form-input font-mono"
                        style={{ height: 44, fontSize: 15, fontWeight: 700 }}
                        placeholder="Bipe o QR Code ou digite ETQ-00001..."
                        value={codigoBip}
                        onChange={(e) => setCodigoBip(e.target.value)}
                        autoFocus
                      />
                      <button type="submit" className="btn btn--success" disabled={bipando}>
                        {bipando ? '...' : 'Bipar'}
                      </button>
                    </form>

                    <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Etiqueta</th>
                            <th>Produto</th>
                            <th style={{ textAlign: 'right' }}>Peso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invAtual.etiquetas_bipadas_json || []).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="text-center text-muted p-20">
                                Nenhuma etiqueta bipada ainda.
                              </td>
                            </tr>
                          ) : (
                            (invAtual.etiquetas_bipadas_json || []).map((b) => (
                              <tr key={b.codigo_etiqueta}>
                                <td className="font-mono font-bold text-success">{b.codigo_etiqueta}</td>
                                <td className="text-sm">{b.produto_descricao}</td>
                                <td className="font-mono" style={{ textAlign: 'right' }}>{fmtKg(b.peso_liquido_kg)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* BLOCO B: SELECIONAR E PESAR MPs PENDENTES */}
                  <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="font-bold text-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Scale size={17} className="text-warning" /> 2. Pesar Matérias-Primas Pendentes
                      </span>
                      <span className="badge badge--warning font-mono">
                        {(invAtual.mps_pesadas_json || []).filter((m) => m.pesada).length} / {(invAtual.mps_pesadas_json || []).length} pesadas
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                      {(invAtual.mps_pesadas_json || []).length === 0 ? (
                        <div className="text-center text-muted p-20 text-sm">
                          Nenhuma Matéria-Prima pendente para pesagem neste inventário.
                        </div>
                      ) : (
                        (invAtual.mps_pesadas_json || []).map((mp) => (
                          <div
                            key={mp.caixa_id}
                            style={{
                              padding: 12,
                              borderRadius: 10,
                              background: mp.pesada ? 'rgba(34,197,94,0.08)' : 'var(--bg-2)',
                              border: `1px solid ${mp.pesada ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div className="font-bold text-sm">{mp.produto_descricao}</div>
                                <div className="text-xs text-muted font-mono">
                                  EAN {mp.ean_caixa} {mp.lote ? `• Lote ${mp.lote}` : ''}
                                </div>
                              </div>
                              <span className={`badge ${mp.pesada ? 'badge--success' : 'badge--warning'}`}>
                                {mp.pesada ? `Pesada: ${fmtKg(mp.peso_medido_kg)}` : 'Aguardando Pesagem'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                className="form-input font-mono"
                                style={{ height: 36, flex: 1 }}
                                placeholder="Peso atual na balança (kg)..."
                                value={pesosMpEdit[mp.caixa_id] ?? ''}
                                onChange={(e) =>
                                  setPesosMpEdit((prev) => ({ ...prev, [mp.caixa_id]: e.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                style={{ height: 36 }}
                                onClick={() => handlePesarMp(mp.caixa_id)}
                              >
                                Salvar Peso
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
