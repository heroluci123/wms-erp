import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Package, ArrowRightLeft, Upload, CheckSquare, Search, Box, LogOut, Minus, Square, X, MapPin, Users, Map, Layers, Barcode, Factory, Scissors, ScanLine, PieChart, TrendingDown, ClipboardList, Scale, Printer, KeyRound, ShieldCheck, Eye, EyeOff, Lock, Building2, Truck, Briefcase, Route, Settings2, BellRing, MessageSquare, ShoppingBag, GitBranch, RotateCcw, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, DollarSign, BarChart3, FileCheck2, ShoppingCart, Store, Boxes, Tag, CornerDownLeft } from 'lucide-react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { ToastContainer } from '../shared/ToastContainer'
import { validarSessaoServidor } from '../../lib/authGuard'
import { isApiEnabled } from '../../lib/apiClient'
import { cadastrosQueries } from '../../queries/cadastros'
import { operadoresQueries } from '../../queries/operadores'
import { isCliente, isMaster, temPermissao } from '../../utils/permissoes'
import { obterModulosVisiveis, filtrarModulosDinamico } from '../../utils/modulosCatalogo'

const ICON_MAP = {
  Package,
  ArrowRightLeft,
  Upload,
  CheckSquare,
  Search,
  Box,
  LogOut,
  MapPin,
  Users,
  Map,
  Layers,
  Barcode,
  Factory,
  Scissors,
  ScanLine,
  PieChart,
  TrendingDown,
  ClipboardList,
  Scale,
  Printer,
  ShieldCheck,
  Building2,
  Truck,
  Briefcase,
  Route,
  Settings2,
  BellRing,
  MessageSquare,
  ShoppingBag,
  GitBranch,
  RotateCcw,
  DollarSign,
  BarChart3,
  FileCheck2,
  ShoppingCart,
  Store,
  Boxes,
  Tag,
}

function ModuloIcon({ name, size = 18 }) {
  const Comp = ICON_MAP[name] || Package
  return <Comp size={size} />
}

function TopBar({ sidebarRecolhida = false, onToggleSidebar, onAbrirBuscaRapida }) {
  const {
    operador,
    sessionToken,
    filialAtivaId,
    filiaisDisponiveis,
    setOperador,
    setFilialAtiva,
    setFiliaisDisponiveis,
    logout,
    toastSuccess,
    toastError,
  } = useAppStore()
  const navigate = useNavigate()
  const [modalSenha, setModalSenha] = useState(false)
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [mostrarSenhas, setMostrarSenhas] = useState(false)
  const [salvandoSenha, setSalvandoSenha] = useState(false)
  const [erroSenha, setErroSenha] = useState('')

  const handleLogout = async () => {
    try {
      await operadoresQueries.encerrarSessao(sessionToken)
    } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  const abrirModalSenha = () => {
    setSenhaAtual('')
    setNovaSenha('')
    setConfirmarSenha('')
    setMostrarSenhas(false)
    setErroSenha('')
    setModalSenha(true)
  }

  const handleAlterarSenha = async (e) => {
    e.preventDefault()
    setErroSenha('')
    if (!senhaAtual) {
      setErroSenha('Informe sua senha atual.')
      return
    }
    if (!novaSenha || novaSenha.trim().length < 4) {
      setErroSenha('A nova senha deve ter pelo menos 4 caracteres.')
      return
    }
    if (novaSenha !== confirmarSenha) {
      setErroSenha('A confirmação não confere com a nova senha.')
      return
    }
    setSalvandoSenha(true)
    try {
      const atualizado = await operadoresQueries.trocarPropriaSenha({ senhaAtual, novaSenha })
      setOperador(atualizado)
      setModalSenha(false)
      toastSuccess('Senha atualizada', 'Sua senha de acesso foi alterada com sucesso.')
    } catch (err) {
      const msg = err.message || 'Não foi possível alterar a senha.'
      setErroSenha(msg)
      toastError('Erro ao alterar senha', msg)
    } finally {
      setSalvandoSenha(false)
    }
  }

  const podeTrocarPropriaSenha = isMaster(operador) || temPermissao(operador, 'alterar_propria_senha')
  const masterUser = isMaster(operador)
  const clienteUser = isCliente(operador)
  const nivelLabel = masterUser ? 'MASTER' : clienteUser ? 'CLIENTE' : (operador?.nivel || operador?.perfil || 'OPERADOR')

  useEffect(() => {
    if (!isApiEnabled() || !operador || clienteUser) return
    cadastrosQueries
      .listarContextoFiliais()
      .then((res) => {
        if (Array.isArray(res?.data) && res.data.length > 0) {
          setFiliaisDisponiveis(res.data)
          const atualOk = res.data.some((f) => String(f.id) === String(filialAtivaId))
          if (!atualOk || res.data.length === 1) {
            setFilialAtiva(res.data[0].id)
          }
        }
      })
      .catch(() => {})
  }, [operador?.id, clienteUser, filialAtivaId, setFiliaisDisponiveis, setFilialAtiva])

  const filialAtivaObj =
    filiaisDisponiveis.find((f) => String(f.id) === String(filialAtivaId)) || filiaisDisponiveis[0] || null

  return (
    <>
      <div className="titlebar">
        <div className="titlebar__logo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              title={sidebarRecolhida ? 'Expandir menu lateral' : 'Recolher menu lateral (Tela Cheia)'}
              style={{
                WebkitAppRegion: 'no-drag',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 22,
                borderRadius: 5,
                background: 'rgba(148,163,184,0.12)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {sidebarRecolhida ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
          )}
          <span className="titlebar__title">WMSphere - Tricarnes</span>
        </div>

        {isApiEnabled() && operador && !clienteUser && filiaisDisponiveis.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16, WebkitAppRegion: 'no-drag' }}>
            <span className="text-xs text-muted">Filial:</span>
            {filiaisDisponiveis.length === 1 && filialAtivaObj ? (
              <span
                className="text-xs font-bold px-8 py-2 rounded"
                style={{
                  background: 'rgba(59,130,246,0.14)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59,130,246,0.35)',
                }}
                title="Usuário vinculado exclusivamente a esta filial"
              >
                {filialAtivaObj.codigo} — {filialAtivaObj.nome}
              </span>
            ) : (
              <select
                className="form-input"
                style={{ padding: '3px 8px', fontSize: 11, height: 26, width: 'auto', minWidth: 185, background: 'var(--bg-2)' }}
                value={filialAtivaId}
                onChange={(e) => {
                  const novoId = e.target.value
                  const f = filiaisDisponiveis.find((x) => String(x.id) === String(novoId))
                  setFilialAtiva(novoId)
                  if (f) toastSuccess('Filial alterada', `Operando em ${f.codigo} - ${f.nome}`)
                }}
                title="Alternar entre as filiais liberadas para o seu usuário"
              >
                {filiaisDisponiveis.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.codigo} — {f.nome}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        
        {operador && onAbrirBuscaRapida && (
          <button
            type="button"
            onClick={onAbrirBuscaRapida}
            title="Busca rápida de módulos (Ctrl+K)"
            style={{
              WebkitAppRegion: 'no-drag',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              marginLeft: 12,
              height: 26,
              padding: '0 10px',
              borderRadius: 7,
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 11.5,
              cursor: 'pointer',
            }}
          >
            <Search size={13} color="#60a5fa" />
            <span>Buscar módulo...</span>
            <kbd
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                padding: '1px 5px',
                borderRadius: 4,
                background: 'var(--bg-3)',
                border: '1px solid var(--border-light)',
                color: 'var(--text-muted)',
              }}
            >
              Ctrl+K
            </kbd>
          </button>
        )}

        <div className="titlebar__spacer" />
        
        {operador && (
          <div className="titlebar__operator" style={{ gap: 8 }}>
            <span className="text-xs text-muted">Usuário:</span>
            <span className="titlebar__operator-badge">{operador.nome}</span>
            {operador.setor && (
              <span
                className="text-xs font-bold px-8 py-2 rounded"
                style={{
                  background: 'rgba(148,163,184,0.12)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(148,163,184,0.2)',
                }}
              >
                {operador.setor}
              </span>
            )}
            <span
              className="text-xs font-bold px-8 py-2 rounded"
              style={{
                background: masterUser
                  ? 'rgba(245,158,11,0.18)'
                  : clienteUser
                    ? 'rgba(6,182,212,0.18)'
                    : 'rgba(59,130,246,0.18)',
                color: masterUser ? '#fbbf24' : clienteUser ? '#22d3ee' : '#60a5fa',
                border: `1px solid ${masterUser ? 'rgba(245,158,11,0.4)' : clienteUser ? 'rgba(6,182,212,0.4)' : 'rgba(59,130,246,0.35)'}`,
              }}
            >
              {nivelLabel}
            </span>
            {podeTrocarPropriaSenha && (
              <button
                className="btn btn--ghost btn--icon"
                style={{ padding: 4 }}
                onClick={abrirModalSenha}
                title="Alterar minha senha"
              >
                <KeyRound size={14} />
              </button>
            )}
            <button 
              className="btn btn--ghost btn--icon" 
              style={{ padding: 4 }} 
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}

        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={() => (() => {})()}>
            <Minus size={16} />
          </button>
          <button className="titlebar__btn" onClick={() => (() => {})()}>
            <Square size={14} />
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={() => (() => {})()}>
            <X size={16} />
          </button>
        </div>
      </div>

      {modalSenha && (
        <div
          className="flex items-center justify-center p-24 fade-in"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(5, 9, 18, 0.84)',
            backdropFilter: 'blur(6px)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !salvandoSenha) setModalSenha(false) }}
        >
          <div
            className="card border border-border rounded-lg shadow-2xl w-full max-w-[420px]"
            style={{
              padding: 0,
              background: 'var(--bg-1)',
              border: '1px solid var(--border-light)',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
            }}
          >
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <div className="flex items-center gap-8">
                <Lock size={18} className="text-primary" />
                <h3 className="text-base font-bold">Alterar Minha Senha</h3>
              </div>
              <button className="btn-icon" type="button" onClick={() => !salvandoSenha && setModalSenha(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAlterarSenha} className="p-20 flex flex-col gap-12">
              {erroSenha && (
                <div className="p-10 rounded text-xs font-bold" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>
                  {erroSenha}
                </div>
              )}
              <div>
                <label className="form-label">Senha atual</label>
                <div className="relative">
                  <input
                    type={mostrarSenhas ? 'text' : 'password'}
                    className="form-input"
                    value={senhaAtual}
                    onChange={(e) => setSenhaAtual(e.target.value)}
                    placeholder="Digite sua senha atual"
                    autoFocus
                    disabled={salvandoSenha}
                  />
                  <button
                    type="button"
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: 4,
                    }}
                    onClick={() => setMostrarSenhas((v) => !v)}
                    tabIndex={-1}
                  >
                    {mostrarSenhas ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="form-label">Nova senha</label>
                <input
                  type={mostrarSenhas ? 'text' : 'password'}
                  className="form-input"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  disabled={salvandoSenha}
                />
              </div>
              <div>
                <label className="form-label">Confirmar nova senha</label>
                <input
                  type={mostrarSenhas ? 'text' : 'password'}
                  className="form-input"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  placeholder="Repita a nova senha"
                  disabled={salvandoSenha}
                />
              </div>
              <div className="flex justify-end gap-8 mt-8">
                <button type="button" className="btn btn--ghost" onClick={() => setModalSenha(false)} disabled={salvandoSenha}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvandoSenha}>
                  {salvandoSenha ? 'Salvando...' : 'Salvar Nova Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function Sidebar({ collapsed = false, onCollapse }) {
  const { operador, filialAtivaId, filiaisDisponiveis } = useAppStore()
  const navigate = useNavigate()
  const cliente = isCliente(operador)
  const [buscaModulo, setBuscaModulo] = useState('')
  const [indiceAtivo, setIndiceAtivo] = useState(0)

  const filialAtivaObj =
    (filiaisDisponiveis || []).find((f) => String(f.id) === String(filialAtivaId)) ||
    (filiaisDisponiveis || [])[0] ||
    null
  const isFilialVarejo = String(filialAtivaObj?.tipo_unidade || '').toUpperCase() === 'VAREJO'

  const modulosVisiveis = useMemo(
    () => obterModulosVisiveis(operador, isFilialVarejo),
    [operador, isFilialVarejo],
  )

  const emBusca = buscaModulo.trim().length > 0

  const resultadosBusca = useMemo(
    () => (emBusca ? filtrarModulosDinamico(modulosVisiveis, buscaModulo) : modulosVisiveis),
    [modulosVisiveis, buscaModulo, emBusca],
  )

  useEffect(() => {
    setIndiceAtivo(0)
  }, [buscaModulo])

  const secoesAgrupadas = useMemo(() => {
    const grupos = []
    const mapa = new Map()
    for (const m of modulosVisiveis) {
      if (!mapa.has(m.section)) {
        const g = { section: m.section, items: [] }
        mapa.set(m.section, g)
        grupos.push(g)
      }
      mapa.get(m.section).items.push(m)
    }
    return grupos
  }, [modulosVisiveis])

  const handleSearchKeyDown = (e) => {
    if (!emBusca) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceAtivo((i) => (resultadosBusca.length > 0 ? (i + 1) % resultadosBusca.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceAtivo((i) =>
        resultadosBusca.length > 0 ? (i - 1 + resultadosBusca.length) % resultadosBusca.length : 0,
      )
    } else if (e.key === 'Enter' && resultadosBusca.length > 0) {
      e.preventDefault()
      const alvo = resultadosBusca[indiceAtivo] || resultadosBusca[0]
      if (alvo) {
        navigate(alvo.to)
        setBuscaModulo('')
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setBuscaModulo('')
    }
  }

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} style={{ position: 'relative' }}>
      {/* TOPO DA SIDEBAR: LUPA DE FILTRO DINÂMICO DE MÓDULOS */}
      <div className="sidebar__search-wrap">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, padding: '0 2px' }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)' }}>
            {cliente ? 'Portal do Cliente' : 'Navegação'}
          </span>
          {onCollapse && (
            <button
              type="button"
              className="sidebar__collapse-pill"
              onClick={onCollapse}
              title="Recolher menu lateral para tela cheia"
            >
              <ChevronLeft size={13} /> Recolher
            </button>
          )}
        </div>

        <div className="sidebar__search-box">
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 9,
              color: emBusca ? '#60a5fa' : 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            className="sidebar__search-input"
            placeholder="Filtrar módulos..."
            value={buscaModulo}
            onChange={(e) => setBuscaModulo(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            aria-label="Filtrar módulos do sistema"
          />
          {emBusca && (
            <button
              type="button"
              onClick={() => setBuscaModulo('')}
              title="Limpar busca"
              style={{
                position: 'absolute',
                right: 6,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 2,
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* LISTA DINÂMICA FILTRADA OU MENU COMPLETO AGRUPADO */}
      {emBusca ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="sidebar__section-label" style={{ marginTop: 2 }}>
            {resultadosBusca.length === 1
              ? '1 módulo encontrado'
              : `${resultadosBusca.length} módulos encontrados`}
          </div>
          {resultadosBusca.length === 0 ? (
            <div style={{ padding: '18px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'normal' }}>
              Nenhum módulo para <strong style={{ color: 'var(--text-secondary)' }}>"{buscaModulo}"</strong>.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBuscaModulo('')}>
                  Limpar filtro
                </button>
              </div>
            </div>
          ) : (
            resultadosBusca.map((mod, idx) => (
              <NavLink
                key={mod.id}
                to={mod.to}
                title={`${mod.label} — ${mod.section}`}
                onClick={() => setBuscaModulo('')}
                className={({ isActive }) =>
                  `sidebar__nav-item ${isActive ? 'active' : ''} ${idx === indiceAtivo ? 'sidebar__nav-item--highlight' : ''}`
                }
                style={{ paddingTop: 7, paddingBottom: 7 }}
              >
                <ModuloIcon name={mod.icon} size={17} />
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                  <span className="sidebar__nav-label">{mod.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {mod.section}
                  </span>
                </div>
              </NavLink>
            ))
          )}
        </div>
      ) : (
        secoesAgrupadas.map((grupo) => (
          <React.Fragment key={grupo.section}>
            <div className="sidebar__section-label">{grupo.section}</div>
            {grupo.items.map((mod) => (
              <NavLink
                key={mod.id}
                to={mod.to}
                end={mod.to === '/'}
                title={mod.label}
                className={({ isActive }) => `sidebar__nav-item ${isActive ? 'active' : ''}`}
              >
                <ModuloIcon name={mod.icon} size={17} />
                <span className="sidebar__nav-label">{mod.label}</span>
              </NavLink>
            ))}
          </React.Fragment>
        ))
      )}

      <div className="sidebar__bottom">
        <div style={{ padding: '0 16px', fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
          {cliente ? 'Modo Consulta Isolado' : 'WMSphere Auth v2'}
        </div>
      </div>
    </aside>
  )
}

function ModalBuscaModulos({ isOpen, onClose }) {
  const { operador, filialAtivaId, filiaisDisponiveis } = useAppStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [idxSel, setIdxSel] = useState(0)
  const inputRef = useRef(null)

  const filialAtivaObj =
    (filiaisDisponiveis || []).find((f) => String(f.id) === String(filialAtivaId)) ||
    (filiaisDisponiveis || [])[0] ||
    null
  const isFilialVarejo = String(filialAtivaObj?.tipo_unidade || '').toUpperCase() === 'VAREJO'

  const modulosVisiveis = useMemo(
    () => obterModulosVisiveis(operador, isFilialVarejo),
    [operador, isFilialVarejo],
  )

  const resultados = useMemo(
    () => filtrarModulosDinamico(modulosVisiveis, query),
    [modulosVisiveis, query],
  )

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setIdxSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [isOpen])

  useEffect(() => {
    setIdxSel(0)
  }, [query])

  if (!isOpen) return null

  const irPara = (mod) => {
    if (!mod) return
    navigate(mod.to)
    onClose()
  }

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 9998, alignItems: 'flex-start', paddingTop: '10vh' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 580,
          background: 'var(--bg-1)',
          border: '1px solid var(--border-light)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Search size={18} color="#60a5fa" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Digite o módulo ou termo relacionado (ex.: compras, pedido de compra, pix, etiqueta, balança)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdxSel((i) => (resultados.length > 0 ? (i + 1) % resultados.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdxSel((i) => (resultados.length > 0 ? (i - 1 + resultados.length) % resultados.length : 0))
              } else if (e.key === 'Enter' && resultados.length > 0) {
                e.preventDefault()
                irPara(resultados[idxSel] || resultados[0])
              }
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 14.5,
              fontFamily: 'var(--font-sans)',
            }}
          />
          {query && (
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
          <kbd
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              padding: '2px 6px',
              borderRadius: 5,
              background: 'var(--bg-3)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            ESC
          </kbd>
        </div>

        {!query && (
          <div style={{ padding: '8px 16px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-xs text-muted">Sugestões:</span>
            {['compras', 'pedido de compra', 'estoque', 'etiqueta', 'fiscal', 'financeiro', ...(isFilialVarejo ? ['pdv', 'açougue'] : [])].map((tag) => (
              <button
                key={tag}
                type="button"
                className="btn btn--ghost btn--sm"
                style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={() => setQuery(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div style={{ maxHeight: 390, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {resultados.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhum módulo encontrado para <strong style={{ color: 'var(--text-primary)' }}>"{query}"</strong>.
            </div>
          ) : (
            resultados.map((mod, idx) => {
              const ativo = idx === idxSel
              return (
                <button
                  key={mod.id}
                  type="button"
                  onMouseEnter={() => setIdxSel(idx)}
                  onClick={() => irPara(mod)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 9,
                    border: `1px solid ${ativo ? 'rgba(59,130,246,0.55)' : 'transparent'}`,
                    background: ativo ? 'rgba(59,130,246,0.16)' : 'transparent',
                    color: ativo ? '#ffffff' : 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <span style={{ color: ativo ? '#60a5fa' : 'var(--text-secondary)', display: 'flex' }}>
                      <ModuloIcon name={mod.icon} size={18} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="font-bold text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {mod.label}
                      </div>
                      <div className="text-xs text-muted">{mod.section}</div>
                    </div>
                  </div>
                  {ativo && (
                    <span className="text-xs text-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      Abrir <CornerDownLeft size={12} />
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div
          style={{
            padding: '8px 16px',
            background: 'var(--bg-2)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          <span>Use ↑ ↓ para navegar • Enter para abrir</span>
          <span>{resultados.length} módulo(s)</span>
        </div>
      </div>
    </div>
  )
}

export function Layout() {
  const { operador, sessionToken, filialAtivaId, setOperador, logout, toastError } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [buscaRapidaAberta, setBuscaRapidaAberta] = useState(false)
  const [sidebarRecolhida, setSidebarRecolhida] = useState(() =>
    window.location.pathname.startsWith('/recebimento'),
  )

  useEffect(() => {
    const onGlobalKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscaRapidaAberta((v) => !v)
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [])

  useEffect(() => {
    if (location.pathname.startsWith('/recebimento')) {
      setSidebarRecolhida(true)
    }
  }, [location.pathname])

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    if (!operador || !sessionToken || Number(operador.deve_trocar_senha) === 1) {
      navigate('/login')
    }
  }, [operador, sessionToken, navigate])

  const checarSessao = useCallback(async () => {
    if (!operador || !sessionToken) return
    try {
      const atualizado = await validarSessaoServidor({ forceFresh: true })
      if (atualizado) {
        if (Number(atualizado.deve_trocar_senha) === 1) {
          setOperador(atualizado)
          navigate('/login')
          return
        }
        const current = useAppStore.getState().operador
        if (JSON.stringify(current) !== JSON.stringify(atualizado)) {
          setOperador(atualizado)
        }
      }
    } catch (err) {
      toastError('Sessão encerrada', err.message || 'Sua sessão expirou ou sua conta foi desativada.')
      logout()
      navigate('/login')
    }
  }, [operador?.id, sessionToken, setOperador, logout, navigate, toastError])

  useEffect(() => {
    if (!operador || !sessionToken) return
    checarSessao()
  }, [location.pathname, checarSessao])

  useEffect(() => {
    if (!operador || !sessionToken) return
    const timer = setInterval(checarSessao, 15000)
    const onFocus = () => checarSessao()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [checarSessao, operador, sessionToken])

  if (!operador || !sessionToken || Number(operador.deve_trocar_senha) === 1) return null

  return (
    <div className="app-shell">
      <div className="app-shell-col" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        {!isMobile && (
          <TopBar
            sidebarRecolhida={sidebarRecolhida}
            onToggleSidebar={() => setSidebarRecolhida((v) => !v)}
            onAbrirBuscaRapida={() => setBuscaRapidaAberta(true)}
          />
        )}
        <div className="app-shell-body" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {!isMobile && (
            <Sidebar
              collapsed={sidebarRecolhida}
              onCollapse={() => setSidebarRecolhida(true)}
            />
          )}
          {!isMobile && (
            <button
              type="button"
              className={`sidebar-edge-toggle ${sidebarRecolhida ? 'sidebar-edge-toggle--collapsed' : ''}`}
              onClick={() => setSidebarRecolhida((v) => !v)}
              title={sidebarRecolhida ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            >
              {sidebarRecolhida ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          )}
          <main
            className={isMobile ? 'main-content-mobile' : 'main-content'}
            style={!isMobile && sidebarRecolhida ? { padding: '12px 18px' } : undefined}
          >
            <Outlet key={filialAtivaId || 'default'} />
          </main>
        </div>
      </div>
      <ModalBuscaModulos isOpen={buscaRapidaAberta} onClose={() => setBuscaRapidaAberta(false)} />
      <ToastContainer />
    </div>
  )
}
