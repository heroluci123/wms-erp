import React, { useEffect, useState, useCallback } from 'react'
import { Package, ArrowRightLeft, Upload, CheckSquare, Search, Box, LogOut, Minus, Square, X, MapPin, Users, Map, Layers, Barcode, Factory, Scissors, ScanLine, PieChart, TrendingDown, ClipboardList, Scale, Printer, KeyRound, ShieldCheck, Eye, EyeOff, Lock } from 'lucide-react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { ToastContainer } from '../shared/ToastContainer'
import { validarSessaoServidor } from '../../lib/authGuard'
import { operadoresQueries } from '../../queries/operadores'
import { isCliente, isMaster, temPermissao, temAlgumaPermissao } from '../../utils/permissoes'

function TopBar() {
  const { operador, sessionToken, setOperador, logout, toastSuccess, toastError } = useAppStore()
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

  return (
    <>
      <div className="titlebar">
        <div className="titlebar__logo">
          <span className="titlebar__title">WMSphere - Tricarnes</span>
        </div>
        
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

function Sidebar() {
  const { operador } = useAppStore()
  const cliente = isCliente(operador)

  if (cliente) {
    return (
      <aside className="sidebar">
        <div className="sidebar__section-label">Portal do Cliente</div>
        <NavLink to="/portal-cliente" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <ShieldCheck size={18} /> Visão Consolidada
        </NavLink>
        {temAlgumaPermissao(operador, ['relatorios_producao', 'relatorios_estoque']) && (
          <NavLink to="/relatorios" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
            <PieChart size={18} /> Relatórios Consolidados
          </NavLink>
        )}

        <div className="sidebar__bottom">
          <div style={{ padding: '0 16px', fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
            Modo Consulta Isolado
          </div>
        </div>
      </aside>
    )
  }

  const temVisaoGeral = temAlgumaPermissao(operador, ['dashboard_executivo', 'estoque_enderecos', 'consulta_estoque', 'relatorios_estoque'])
  const temOperacao = temAlgumaPermissao(operador, [
    'recebimento',
    'recebimento_consultar',
    'movimentacao',
    'movimentacao_consultar',
    'retorno_producao',
    'producao_entrada',
    'producao_saida',
    'producao_criar_op',
    'desmembramento',
    'reimpressao',
    'pedidos',
    'pedidos_consultar',
    'saida',
    'expedicao',
  ])
  const temControle = temAlgumaPermissao(operador, [
    'relatorios_producao',
    'relatorios_estoque',
    'inventario_coletor',
    'inventario_divergencias',
    'inventario_gestao',
    'inventario_carga_inicial',
    'consulta_estoque',
    'rastreabilidade',
    'produtos',
    'ean_etiquetas',
    'consulta_endereco',
  ])
  const temCadastros = temAlgumaPermissao(operador, ['taras', 'locais', 'operadores', 'perfis_gerenciar'])

  return (
    <aside className="sidebar">
      {(temVisaoGeral || !temOperacao) && (
        <div className="sidebar__section-label">Visão Geral</div>
      )}
      <NavLink to="/" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
        <Package size={18} /> {temPermissao(operador, 'dashboard_executivo') ? 'Dashboard' : 'Início / Operações'}
      </NavLink>
      {temPermissao(operador, 'estoque_enderecos') && (
        <NavLink to="/estoque" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Layers size={18} /> Estoque por Endereço
        </NavLink>
      )}
      {temAlgumaPermissao(operador, ['consulta_estoque', 'relatorios_estoque']) && (
        <NavLink to="/estoque-minimo" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <TrendingDown size={18} /> Estoque Mínimo Dinâmico
        </NavLink>
      )}
      {temPermissao(operador, 'estoque_enderecos') && (
        <NavLink to="/mapa" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Map size={18} /> Mapa de Capacidade
        </NavLink>
      )}
      
      {temOperacao && (
        <div className="sidebar__section-label">Operação</div>
      )}
      
      {temAlgumaPermissao(operador, ['recebimento', 'recebimento_consultar']) && (
        <NavLink to="/recebimento" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Upload size={18} /> Recebimento (REC)
        </NavLink>
      )}
      {temAlgumaPermissao(operador, ['movimentacao', 'movimentacao_consultar']) && (
        <NavLink to="/movimentacao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <ArrowRightLeft size={18} /> Movimentação Interna
        </NavLink>
      )}
      {temAlgumaPermissao(operador, ['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op']) && (
        <NavLink to="/producao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Factory size={18} /> Retorno de Produção
        </NavLink>
      )}
      {temPermissao(operador, 'desmembramento') && (
        <NavLink to="/desmembramento" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Scissors size={18} /> Desmembramento
        </NavLink>
      )}
      {temPermissao(operador, 'reimpressao') && (
        <NavLink to="/reimpressao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Printer size={18} /> Reimpressão Etiquetas
        </NavLink>
      )}
      {temAlgumaPermissao(operador, ['pedidos', 'pedidos_consultar']) && (
        <NavLink to="/pedidos" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <ClipboardList size={18} /> Pedidos
        </NavLink>
      )}
      {temAlgumaPermissao(operador, ['saida', 'expedicao']) && (
        <NavLink to="/saida" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <LogOut size={18} /> Saída de Materiais
        </NavLink>
      )}

      {temControle && (
        <div className="sidebar__section-label">Controle</div>
      )}
      {temAlgumaPermissao(operador, ['relatorios_producao', 'relatorios_estoque']) && (
        <NavLink to="/relatorios" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <PieChart size={18} /> Relatórios
        </NavLink>
      )}
      
      {temAlgumaPermissao(operador, ['inventario_coletor', 'inventario_divergencias', 'inventario_gestao', 'inventario_carga_inicial']) && (
        <NavLink to="/inventario" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <CheckSquare size={18} /> Inventário
        </NavLink>
      )}
      {temPermissao(operador, 'consulta_estoque') && (
        <NavLink to="/consulta-estoque" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Search size={18} /> Consulta de Estoque
        </NavLink>
      )}
      {temPermissao(operador, 'rastreabilidade') && (
        <NavLink to="/rastreabilidade" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Package size={18} /> Rastreabilidade de Caixa
        </NavLink>
      )}
      {temPermissao(operador, 'produtos') && (
        <NavLink to="/produtos" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Box size={18} /> Consulta e Produtos
        </NavLink>
      )}
      {temPermissao(operador, 'ean_etiquetas') && (
        <NavLink to="/ean-editor" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Barcode size={18} /> Editor de EAN
        </NavLink>
      )}
      {temPermissao(operador, 'consulta_endereco') && (
        <NavLink to="/consulta-endereco" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <ScanLine size={18} /> Consulta de Endereço
        </NavLink>
      )}
      
      {temCadastros && (
        <>
          <div className="sidebar__section-label">Cadastros</div>
          {temPermissao(operador, 'taras') && (
            <NavLink to="/taras" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Scale size={18} /> Cadastro de Taras
            </NavLink>
          )}
          {temPermissao(operador, 'locais') && (
            <NavLink to="/locais" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <MapPin size={18} /> Cadastro de Locais
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['operadores', 'perfis_gerenciar']) && (
            <NavLink to="/operadores" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Users size={18} /> Usuários e Permissões
            </NavLink>
          )}
        </>
      )}

      <div className="sidebar__bottom">
        <div style={{ padding: '0 16px', fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
          WMSphere Auth v2
        </div>
      </div>
    </aside>
  )
}

export function Layout() {
  const { operador, sessionToken, setOperador, logout, toastError } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

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
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        {!isMobile && <TopBar />}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {!isMobile && <Sidebar />}
          <main className={isMobile ? 'main-content-mobile' : 'main-content'}>
            <Outlet />
          </main>
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}
