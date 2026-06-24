import React, { useState, useEffect, useCallback } from 'react'
import { CheckSquare, Plus, BarChart2, RefreshCw, AlertTriangle, Target, TrendingDown, TrendingUp, Clock, Layers, DatabaseZap, ChevronRight, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { InventarioStatusBadge } from '../components/shared/Badge'
import { format } from 'date-fns'

// ─── Sub-componente: Painel do Ciclo Ativo ───────────────────────────────────
function PainelCicloAtivo({ ciclo, onRefresh }) {
  const [dash, setDash] = useState(null)
  const [loadingDash, setLoadingDash] = useState(false)
  const [showEncerrar, setShowEncerrar] = useState(false)
  const { toastSuccess, toastError } = useAppStore()

  const [msgEncerrar, setMsgEncerrar] = useState('')

  const carregarDash = useCallback(async () => {
    if (!ciclo) return
    setLoadingDash(true)
    try {
      const d = await window.wmsAPI.inventarios.ciclosDashboard(ciclo.id)
      setDash(d)
    } catch (e) { /* silencioso */ }
    finally { setLoadingDash(false) }
  }, [ciclo])

  useEffect(() => { carregarDash() }, [carregarDash])

  const handleEncerrar = async (forcar = false) => {
    try {
      const res = await window.wmsAPI.inventarios.ciclosEncerrar({ ciclo_id: ciclo.id, forcar })
      if (res.success) {
        toastSuccess('Ciclo Encerrado', 'O ciclo foi encerrado com sucesso.')
        setShowEncerrar(false)
        onRefresh()
      } else {
        toastError('Atenção', res.error)
        setMsgEncerrar(res.error)
        if (res.inventarios_ativos || res.enderecos_faltantes) setShowEncerrar(true)
      }
    } catch (e) { toastError('Erro', e.message) }
  }

  if (!ciclo) return null
  const target = ciclo.target_pct || 99.9
  const ira = dash?.ira || 0
  const ila = dash?.ila || 0
  const iraColor = ira >= target ? 'var(--success)' : ira >= 95 ? 'var(--warning)' : 'var(--danger)'
  const ilaColor = ila >= target ? 'var(--success)' : ila >= 95 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div className="card mb-24" style={{ borderColor: 'var(--primary)', borderWidth: 2, borderStyle: 'solid' }}>
      <div className="flex items-center justify-between mb-16">
        <div className="flex items-center gap-12">
          <div style={{ background: 'var(--primary)', borderRadius: 8, padding: '6px 10px' }}>
            <Target size={18} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Ciclo Ativo: {ciclo.nome}</div>
            <div className="text-muted text-sm">Iniciado em {format(new Date(ciclo.data_criacao), 'dd/MM/yyyy')} · Target: {target}%</div>
          </div>
          <span style={{ padding: '3px 10px', borderRadius: 99, background: 'var(--success-muted)', color: 'var(--success)', fontSize: 11, fontWeight: 700 }}>ATIVO</span>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--ghost btn--sm" onClick={carregarDash}><RefreshCw size={14} /></button>
          <button className="btn btn--danger btn--sm" onClick={() => handleEncerrar(false)}>Encerrar Ciclo</button>
        </div>
      </div>

      {loadingDash ? (
        <div className="text-muted text-center py-16">Carregando métricas...</div>
      ) : dash && (
        <>
          {/* KPIs principais */}
          <div className="kpi-grid mb-16">
            <div className="kpi-card" style={{ borderColor: iraColor }}>
              <span className="kpi-card__label" style={{ color: iraColor }}>IRA — Acuracidade de Registro</span>
              <span className="kpi-card__value" style={{ color: iraColor }}>{ira.toFixed(1)}%</span>
              <div style={{ position: 'relative', height: 6, background: 'var(--bg-2)', borderRadius: 99, marginTop: 8 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(ira, 100)}%`, background: iraColor, borderRadius: 99, transition: 'width 0.5s ease' }} />
                <div style={{ position: 'absolute', left: `${target}%`, top: -4, width: 2, height: 14, background: 'var(--text-muted)' }} title={`Target: ${target}%`} />
              </div>
              <span className="kpi-card__sub">{dash.itens_acurados} de {dash.itens_total} itens acurados</span>
            </div>
            <div className="kpi-card" style={{ borderColor: ilaColor }}>
              <span className="kpi-card__label" style={{ color: ilaColor }}>ILA — Acuracidade de Localização</span>
              <span className="kpi-card__value" style={{ color: ilaColor }}>{ila.toFixed(1)}%</span>
              <div style={{ position: 'relative', height: 6, background: 'var(--bg-2)', borderRadius: 99, marginTop: 8 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(ila, 100)}%`, background: ilaColor, borderRadius: 99, transition: 'width 0.5s ease' }} />
                <div style={{ position: 'absolute', left: `${target}%`, top: -4, width: 2, height: 14, background: 'var(--text-muted)' }} title={`Target: ${target}%`} />
              </div>
              <span className="kpi-card__sub">{dash.enderecos_contados} endereços 100% acurados</span>
            </div>
            <div className="kpi-card" style={{ borderColor: 'var(--danger)' }}>
              <span className="kpi-card__label flex items-center gap-6 text-danger"><TrendingDown size={13}/> Perdas</span>
              <span className="kpi-card__value text-danger">R$ {(dash.perdas || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              <span className="kpi-card__sub">Ajustes negativos no ciclo</span>
            </div>
            <div className="kpi-card" style={{ borderColor: 'var(--success)' }}>
              <span className="kpi-card__label flex items-center gap-6 text-success"><TrendingUp size={13}/> Ganhos</span>
              <span className="kpi-card__value text-success">R$ {(dash.ganhos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              <span className="kpi-card__sub">Sobras encontradas no ciclo</span>
            </div>
          </div>

          {/* Saldo e progresso */}
          <div className="flex gap-16 items-center" style={{ padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 8 }}>
            <Clock size={16} className="text-muted" />
            <span className="text-sm"><strong>{dash.enderecos_contados}</strong> endereços contados de <strong>{dash.enderecos_total}</strong> totais</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: dash.saldo >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              Saldo Líquido: R$ {(dash.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </>
      )}

      {showEncerrar && (
        <div style={{ marginTop: 16, padding: 16, background: 'var(--danger-muted)', borderRadius: 8, border: '1px solid var(--danger)' }}>
          <div className="flex items-center gap-8 mb-8">
            <AlertTriangle size={18} color="var(--danger)" />
            <strong style={{ color: 'var(--danger)' }}>Atenção: Ação Irreversível</strong>
          </div>
          <p className="text-sm text-muted mb-12">{msgEncerrar || 'Existem inventários ativos vinculados a este ciclo.'}</p>
          <div className="flex gap-8">
            <button className="btn btn--danger btn--sm" onClick={() => handleEncerrar(true)}>Forçar Encerramento</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowEncerrar(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-componente: Accordion de Ciclo Histórico ────────────────────────────
function CicloAccordion({ ciclo }) {
  const [expandido, setExpandido] = useState(false)
  const [dash, setDash] = useState(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const isAbrindo = !expandido
    setExpandido(isAbrindo)
    if (isAbrindo && !dash) {
      setLoading(true)
      try {
        const d = await window.wmsAPI.inventarios.ciclosDashboard(ciclo.id)
        setDash(d)
      } catch (e) {}
      finally { setLoading(false) }
    }
  }

  const target = ciclo.target_pct || 99.9
  const ira = dash?.ira || 0
  const ila = dash?.ila || 0
  const iraColor = ira >= target ? 'var(--success)' : ira >= 95 ? 'var(--warning)' : 'var(--danger)'
  const ilaColor = ila >= target ? 'var(--success)' : ila >= 95 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div 
        onClick={toggle}
        style={{ 
          padding: 16, background: expandido ? 'var(--bg-2)' : 'var(--bg-card)', 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
          borderBottom: expandido ? '1px solid var(--border)' : 'none'
        }}
      >
        <div className="flex items-center gap-12">
          <Target size={18} className="text-primary" />
          <div>
            <div style={{ fontWeight: 700 }}>{ciclo.nome}</div>
            <div className="text-muted text-xs">Target: {target}%</div>
          </div>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: ciclo.status === 'Ativo' ? 'var(--success-muted)' : 'var(--bg-2)', color: ciclo.status === 'Ativo' ? 'var(--success)' : 'var(--text-muted)' }}>{ciclo.status}</span>
        </div>
        <div className="flex items-center gap-16 text-sm text-muted">
          <span>Criado: {format(new Date(ciclo.data_criacao), 'dd/MM/yy')}</span>
          {ciclo.data_encerramento && <span>Encerrado: {format(new Date(ciclo.data_encerramento), 'dd/MM/yy')}</span>}
          <ChevronRight size={18} style={{ transform: expandido ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
        </div>
      </div>
      
      {expandido && (
        <div style={{ padding: 16, background: 'var(--bg-card)' }}>
          {loading ? (
            <div className="text-center text-muted py-16">Carregando métricas do ciclo...</div>
          ) : dash ? (
            <>
              <div className="kpi-grid mb-16">
                <div className="kpi-card" style={{ borderColor: iraColor }}>
                  <span className="kpi-card__label" style={{ color: iraColor }}>IRA Final</span>
                  <span className="kpi-card__value" style={{ color: iraColor }}>{ira.toFixed(1)}%</span>
                  <span className="kpi-card__sub">{dash.itens_acurados} / {dash.itens_total} itens</span>
                </div>
                <div className="kpi-card" style={{ borderColor: ilaColor }}>
                  <span className="kpi-card__label" style={{ color: ilaColor }}>ILA Final</span>
                  <span className="kpi-card__value" style={{ color: ilaColor }}>{ila.toFixed(1)}%</span>
                  <span className="kpi-card__sub">{dash.enderecos_contados} / {dash.enderecos_total} endereços</span>
                </div>
                <div className="kpi-card" style={{ borderColor: 'var(--danger)' }}>
                  <span className="kpi-card__label flex items-center gap-6 text-danger"><TrendingDown size={13}/> Perdas</span>
                  <span className="kpi-card__value text-danger">R$ {(dash.perdas || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="kpi-card" style={{ borderColor: 'var(--success)' }}>
                  <span className="kpi-card__label flex items-center gap-6 text-success"><TrendingUp size={13}/> Ganhos</span>
                  <span className="kpi-card__value text-success">R$ {(dash.ganhos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="flex gap-16 items-center" style={{ padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 8 }}>
                <span style={{ fontWeight: 700, color: dash.saldo >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  Impacto Financeiro Líquido: R$ {(dash.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </>
          ) : (
             <div className="text-center text-muted py-16">Nenhuma métrica encontrada.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export function Inventario() {
  const { toastSuccess, toastError, operador } = useAppStore()
  const navigate = useNavigate()

  const isGestor = operador?.perfil === 'gestor'
  const isAdm = operador?.is_adm === 1

  const [aba, setAba] = useState('ciclico') // ciclico | geral | carga | ciclos | log
  const [inventarios, setInventarios] = useState([])
  const [cicloAtivo, setCicloAtivo] = useState(null)
  const [ciclos, setCiclos] = useState([])
  const [ajustesLog, setAjustesLog] = useState([])
  const [loading, setLoading] = useState(true)

  // Form: Novo Cíclico
  const [tipoFiltro, setTipoFiltro] = useState('Curva')
  const [identificador, setIdentificador] = useState('A')

  // Form: Novo Geral
  const [nomeGeral, setNomeGeral] = useState('')
  const [zonasGeral, setZonasGeral] = useState('')

  // Form: Novo Ciclo
  const [nomeCiclo, setNomeCiclo] = useState('')
  const [targetCiclo, setTargetCiclo] = useState('99.9')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [invData, cicloData, ciclosData] = await Promise.all([
        window.wmsAPI.inventarios.listar(),
        window.wmsAPI.inventarios.ciclosBuscarAtivo(),
        window.wmsAPI.inventarios.ciclosListar(),
      ])
      setInventarios(invData)
      setCicloAtivo(cicloData)
      setCiclos(ciclosData)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar inventários')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    if (operador?.permissoes?.inventario_coletor && !operador?.permissoes?.inventario_gestao) {
      navigate('/inventario/coletor', { replace: true })
      return
    }
    if (operador?.permissoes?.inventario_gestao) {
      carregar()
    } else {
      toastError('Acesso Negado', 'Você não possui permissão para acessar o inventário.')
      navigate('/')
    }
  }, [operador, navigate, carregar, toastError])

  const carregarLog = useCallback(async () => {
    try {
      const log = await window.wmsAPI.inventarios.ajustesLog({})
      setAjustesLog(log)
    } catch(e) {}
  }, [])

  useEffect(() => {
    if (aba === 'log') carregarLog()
  }, [aba, carregarLog])

  const handleCriarCiclico = async (e) => {
    e.preventDefault()
    try {
      const res = await window.wmsAPI.inventarios.criar({ tipo_filtro: tipoFiltro, identificador_filtro: identificador.toUpperCase() })
      if (res.success) {
        toastSuccess('Inventário Criado', `${res.total_itens} posições separadas para contagem.`)
        carregar()
      } else toastError('Erro ao criar', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const handleCriarGeral = async (e) => {
    e.preventDefault()
    const zonas = zonasGeral.split(',').map(z => z.trim().toUpperCase()).filter(Boolean)
    if (zonas.length === 0) return toastError('Erro', 'Informe ao menos uma zona/rua.')
    try {
      const res = await window.wmsAPI.inventarios.criarGeral({ nome: nomeGeral, zonas })
      if (res.success) {
        toastSuccess('Inventário Geral Criado', 'Inventário Wall-to-Wall iniciado.')
        setNomeGeral(''); setZonasGeral('')
        carregar()
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const handleCriarCargaInicial = async () => {
    if (!window.confirm('Isso iniciará a carga inicial do sistema. Todos os endereços serão abertos para inserção de saldo. Confirmar?')) return
    try {
      const res = await window.wmsAPI.inventarios.criarCargaInicial()
      if (res.success) {
        toastSuccess('Carga Inicial Criada', `${res.total_locais} locais disponíveis para inserção.`)
        navigate(`/inventario/conciliacao/${res.inventario_id}`)
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const handleCriarCiclo = async (e) => {
    e.preventDefault()
    try {
      const res = await window.wmsAPI.inventarios.ciclosCriar({ nome: nomeCiclo, target_pct: parseFloat(targetCiclo) || 99.9 })
      if (res.success) {
        toastSuccess('Ciclo Criado', `Ciclo "${nomeCiclo}" ativado.`)
        setNomeCiclo('')
        carregar()
      } else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const handleCancelar = async (id) => {
    if (!window.confirm('Tem certeza que deseja cancelar este inventário?')) return
    try {
      const res = await window.wmsAPI.inventarios.cancelar(id)
      if (res.success) { toastSuccess('Cancelado', 'Inventário cancelado.'); carregar() }
      else toastError('Erro', res.error)
    } catch (err) { toastError('Erro', err.message) }
  }

  const invsByTipo = (tipo) => inventarios.filter(i => (tipo === 'Ciclico' ? (!i.tipo || i.tipo === 'Ciclico') : i.tipo === tipo))

  const ABAS = [
    { id: 'ciclico', label: 'Cíclico (Rotativo)', icon: <RefreshCw size={15}/> },
    { id: 'geral', label: 'Geral (Wall-to-Wall)', icon: <Layers size={15}/> },
    { id: 'ciclos', label: 'Ciclos', icon: <Target size={15}/> },
    { id: 'log', label: 'Log de Ajustes', icon: <BarChart2 size={15}/> },
    ...(isAdm ? [{ id: 'carga', label: 'Carga Inicial', icon: <DatabaseZap size={15}/> }] : []),
  ]

  return (
    <div>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <CheckSquare size={28} /> Gestão de Inventário
          </h1>
          <p className="page-header__subtitle">Inventário cíclico, geral Wall-to-Wall, ciclos e auditoria</p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/inventario/coletor')}>
            <BarChart2 size={16}/> Modo Coletor
          </button>
          <button className="btn btn--secondary btn--sm" onClick={carregar}><RefreshCw size={15}/></button>
        </div>
      </div>

      {/* Painel ciclo ativo */}
      {cicloAtivo && <PainelCicloAtivo ciclo={cicloAtivo} onRefresh={carregar} />}

      {/* Abas */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 24, gap: 4 }}>
        {ABAS.map(a => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
              fontWeight: 600, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: aba === a.id ? '2px solid var(--primary)' : '2px solid transparent',
              color: aba === a.id ? 'var(--primary)' : 'var(--text-muted)',
              marginBottom: -2, transition: 'color 0.2s'
            }}
          >
            {a.icon} {a.label}
          </button>
        ))}
      </div>

      {/* ── ABA: CÍCLICO ──────────────────────────────────────────────────── */}
      {aba === 'ciclico' && (
        <>
          <div className="form-grid form-grid--2 mb-24 items-start">
            <div className="card">
              <h2 className="table-title mb-16 flex items-center gap-8"><Plus size={18}/> Novo Inventário Cíclico</h2>
              {!cicloAtivo && <div className="text-sm text-warning mb-12 flex items-center gap-8"><AlertTriangle size={14}/> Nenhum ciclo ativo. Crie um ciclo primeiro para vincular este inventário.</div>}
              <form onSubmit={handleCriarCiclico} className="flex items-end gap-12">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Tipo de Filtro</label>
                  <select className="form-input" value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}>
                    <option value="Curva">Por Curva ABC</option>
                    <option value="Rua">Por Zona/Rua</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">{tipoFiltro === 'Curva' ? 'Curva' : 'Prefixo da Rua'}</label>
                  {tipoFiltro === 'Curva' ? (
                    <select className="form-input" value={identificador} onChange={e => setIdentificador(e.target.value)}>
                      <option value="A">Curva A</option>
                      <option value="B">Curva B</option>
                      <option value="C">Curva C</option>
                    </select>
                  ) : (
                    <input type="text" className="form-input" placeholder="Ex: R1" value={identificador} onChange={e => setIdentificador(e.target.value)} required />
                  )}
                </div>
                <button type="submit" className="btn btn--primary">Criar</button>
              </form>
            </div>
            <div className="card" style={{ background: 'var(--bg-2)', border: '1px dashed var(--border)' }}>
              <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Como funciona o inventário cíclico?</h3>
              <p className="text-muted text-sm">Cada inventário cíclico é criado com um snapshot do estoque atual para aquele filtro (curva ou rua). Os operadores fazem a contagem cega, sem ver os valores do sistema. Ao final, o gestor concilia os ajustes.</p>
              <p className="text-muted text-sm mt-8">Se houver um <strong>Ciclo Ativo</strong>, este inventário será vinculado automaticamente ao ciclo, contribuindo para as métricas de IRA e ILA.</p>
            </div>
          </div>
          <TabelaInventarios inventarios={invsByTipo('Ciclico')} onCancelar={handleCancelar} navigate={navigate} />
        </>
      )}

      {/* ── ABA: GERAL ──────────────────────────────────────────────────────── */}
      {aba === 'geral' && (
        <>
          <div className="form-grid form-grid--2 mb-24 items-start">
            <div className="card">
              <h2 className="table-title mb-16 flex items-center gap-8"><Layers size={18}/> Novo Inventário Geral (Wall-to-Wall)</h2>
              <form onSubmit={handleCriarGeral} className="flex-col gap-12">
                <div className="form-group">
                  <label className="form-label">Nome do Inventário *</label>
                  <input type="text" className="form-input" placeholder="Ex: Inventário Anual Julho 2026" value={nomeGeral} onChange={e => setNomeGeral(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Zonas/Ruas (separadas por vírgula) *</label>
                  <input type="text" className="form-input" placeholder="Ex: R1, R2, R3, MEZANINO" value={zonasGeral} onChange={e => setZonasGeral(e.target.value)} required />
                  <span className="text-muted text-sm mt-4 inline-block">Cada zona vira uma seção independente com progresso separado.</span>
                </div>
                <button type="submit" className="btn btn--primary">Criar Inventário Geral</button>
              </form>
            </div>
            <div className="card" style={{ background: 'var(--bg-2)', border: '1px dashed var(--border)' }}>
              <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Como funciona o Wall-to-Wall?</h3>
              <p className="text-muted text-sm">O inventário geral divide o armazém em zonas. Cada zona tem seu progresso independente — a equipe pode contar a Rua 1 enquanto outra conta a Rua 2 sem interferência.</p>
              <p className="text-muted text-sm mt-8">O botão "Finalizar Zona" só fica ativo quando a contagem dessa zona estiver 100% completa. O ajuste só pode ser aplicado quando todas as zonas estiverem finalizadas.</p>
            </div>
          </div>
          <TabelaInventarios inventarios={invsByTipo('Geral')} onCancelar={handleCancelar} navigate={navigate} />
        </>
      )}

      {/* ── ABA: CICLOS ─────────────────────────────────────────────────────── */}
      {aba === 'ciclos' && (
        <>
          {!cicloAtivo && (
            <div className="card mb-24">
              <h2 className="table-title mb-16 flex items-center gap-8"><Target size={18}/> Criar Novo Ciclo</h2>
              <form onSubmit={handleCriarCiclo} className="flex items-end gap-12">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nome do Ciclo *</label>
                  <input type="text" className="form-input" placeholder="Ex: Ciclo Q3 - 2026" value={nomeCiclo} onChange={e => setNomeCiclo(e.target.value)} required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Target de Acuracidade (%)</label>
                  <input type="number" step="0.1" min="90" max="100" className="form-input" value={targetCiclo} onChange={e => setTargetCiclo(e.target.value)} />
                </div>
                <button type="submit" className="btn btn--primary">Criar e Ativar Ciclo</button>
              </form>
            </div>
          )}
          <div className="table-container">
            <div className="table-toolbar"><h2 className="table-title">Histórico de Ciclos</h2></div>
            <div>
              {ciclos.length === 0 ? (
                <div className="text-center text-muted py-24">Nenhum ciclo registrado.</div>
              ) : (
                ciclos.map(c => <CicloAccordion key={c.id} ciclo={c} />)
              )}
            </div>
          </div>
        </>
      )}

      {/* ── ABA: LOG DE AJUSTES ─────────────────────────────────────────────── */}
      {aba === 'log' && (
        <div className="table-container">
          <div className="table-toolbar">
            <h2 className="table-title">Log de Auditoria de Ajustes</h2>
            <button className="btn btn--secondary btn--sm" onClick={carregarLog}><RefreshCw size={14}/></button>
          </div>
          <table>
            <thead><tr>
              <th>Data</th><th>Produto</th><th>Endereço</th><th>Tipo</th>
              <th style={{ textAlign: 'right' }}>Qtd Cx</th>
              <th style={{ textAlign: 'right' }}>Custo Unit.</th>
              <th style={{ textAlign: 'right' }}>Impacto R$</th>
              <th>Aprovado por</th>
            </tr></thead>
            <tbody>
              {ajustesLog.length === 0 ? (
                <tr><td colSpan="8" className="text-center text-muted py-24">Nenhum ajuste registrado.</td></tr>
              ) : (
                ajustesLog.map(log => {
                  const impacto = (log.qtd_ajustada_caixas || 0) * (log.custo_unitario_data || 0)
                  return (
                    <tr key={log.id}>
                      <td className="text-muted text-sm">{format(new Date(log.data_ajuste), 'dd/MM/yyyy HH:mm')}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{log.descricao}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{log.codigo}</div>
                      </td>
                      <td className="td-mono">{log.endereco}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: log.tipo_ajuste === 'Perda' ? 'var(--danger-muted)' : 'var(--success-muted)', color: log.tipo_ajuste === 'Perda' ? 'var(--danger)' : 'var(--success)' }}>
                          {log.tipo_ajuste}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: log.qtd_ajustada_caixas < 0 ? 'var(--danger)' : 'var(--success)' }}>{log.qtd_ajustada_caixas > 0 ? '+' : ''}{log.qtd_ajustada_caixas?.toFixed(2)} cx</td>
                      <td style={{ textAlign: 'right' }} className="td-muted">R$ {(log.custo_unitario_data || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: impacto < 0 ? 'var(--danger)' : 'var(--success)' }}>R$ {Math.abs(impacto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="text-sm text-muted">{log.usuario_aprovou_nome || '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ABA: CARGA INICIAL (ADM only) ───────────────────────────────────── */}
      {aba === 'carga' && isAdm && (
        <div className="form-grid form-grid--2 items-start">
          <div className="card" style={{ borderColor: 'var(--warning)', borderWidth: 2, borderStyle: 'solid' }}>
            <div className="flex items-center gap-12 mb-16">
              <DatabaseZap size={24} style={{ color: 'var(--warning)' }} />
              <div>
                <h2 style={{ fontWeight: 800, fontSize: 16, color: 'var(--warning)' }}>Módulo de Carga Inicial</h2>
                <p className="text-muted text-sm">Uso único — insere todos os saldos do armazém do zero</p>
              </div>
            </div>
            <div style={{ padding: 16, background: 'var(--warning-muted)', borderRadius: 8, marginBottom: 16 }}>
              <p className="text-sm"><strong>⚠️ Atenção:</strong> Este módulo é destinado apenas ao cadastro inicial do estoque. Todos os endereços serão abertos para contagem simultânea. Ao conciliar, os saldos serão inseridos/sobrescritos no sistema.</p>
              <p className="text-sm mt-8">Este processo deve ser usado apenas UMA VEZ, quando o armazém ainda não possui dados no sistema.</p>
            </div>
            <div className="flex-col gap-12">
              {(() => {
                const cargasPendentes = invsByTipo('CargaInicial').filter(i => !['Finalizado OK','Cancelado'].includes(i.status));
                if (cargasPendentes.length > 0) {
                  return (
                    <div>
                      <div className="text-sm text-warning mb-8">Já existe uma carga inicial em andamento.</div>
                      {cargasPendentes.map(inv => (
                        <button key={inv.id} className="btn btn--primary w-full mb-8" onClick={() => navigate(`/inventario/conciliacao/${inv.id}`)}>
                          Continuar Carga Inicial #{inv.id} <ChevronRight size={16}/>
                        </button>
                      ))}
                    </div>
                  );
                } else {
                  return (
                    <button className="btn btn--warning w-full" onClick={handleCriarCargaInicial}>
                      <DatabaseZap size={16}/> Iniciar Carga Inicial do Sistema
                    </button>
                  );
                }
              })()}
            </div>
          </div>
          <div className="card" style={{ background: 'var(--bg-2)', border: '1px dashed var(--border)' }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Instrução de Uso</h3>
            <ol style={{ paddingLeft: 16, lineHeight: 2 }} className="text-muted text-sm">
              <li>Clique em "Iniciar Carga Inicial do Sistema"</li>
              <li>Você será redirecionado para a tela de conciliação</li>
              <li>Use o Modo Coletor nos operadores autorizados para lançar todos os produtos endereço a endereço</li>
              <li>Ao finalizar todas as contagens, clique em "Aplicar Ajustes"</li>
              <li>Os saldos serão inseridos no estoque real</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Componente auxiliar: Tabela de Inventários ───────────────────────────────
function TabelaInventarios({ inventarios, onCancelar, navigate }) {
  return (
    <div className="table-container">
      <div className="table-toolbar"><h2 className="table-title">Histórico e Conciliação</h2></div>
      <table>
        <thead><tr>
          <th>ID</th><th>Nome/Filtro</th><th>Tipo</th><th>Ciclo</th><th>Status</th>
          <th style={{ textAlign: 'center' }}>Pend / OK / Div</th>
          <th>Criado em</th>
          <th style={{ textAlign: 'right' }}>Ações</th>
        </tr></thead>
        <tbody>
          {inventarios.length === 0 ? (
            <tr><td colSpan="8" className="text-center text-muted py-24">Nenhum inventário registrado.</td></tr>
          ) : (
            inventarios.map(inv => (
              <tr key={inv.id}>
                <td className="td-mono">#{inv.id}</td>
                <td style={{ fontWeight: 600 }}>
                  {inv.nome || `${inv.tipo_filtro}: ${inv.identificador_filtro}`}
                </td>
                <td><span className="badge">{inv.tipo || 'Cíclico'}</span></td>
                <td className="text-muted text-sm">{inv.ciclo_nome || '—'}</td>
                <td><InventarioStatusBadge status={inv.status} /></td>
                <td style={{ textAlign: 'center' }}>
                  <div className="flex items-center justify-center gap-6 font-mono text-sm">
                    <span className="text-muted">{inv.pendentes || 0}</span>/
                    <span className="text-success">{inv.ok || 0}</span>/
                    <span className="text-danger">{inv.divergentes || 0}</span>
                  </div>
                </td>
                <td className="text-muted text-sm">{format(new Date(inv.data_criacao), 'dd/MM/yy HH:mm')}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="flex justify-end gap-6">
                    {!['Finalizado OK','Cancelado'].includes(inv.status) && (
                      <button className="btn btn--danger btn--sm btn--icon" onClick={() => onCancelar(inv.id)} title="Cancelar"><X size={13}/></button>
                    )}
                    <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/inventario/conciliacao/${inv.id}`)}>
                      Detalhes <ChevronRight size={13}/>
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
