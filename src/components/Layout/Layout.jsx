import React, { useEffect, useState, useCallback } from 'react'
import { Package, ArrowRightLeft, Upload, CheckSquare, Search, Box, LogOut, Minus, Square, X, MapPin, Users, Map, Layers, Barcode, Factory, Scissors, ScanLine, PieChart, TrendingDown, ClipboardList, Scale, Printer, KeyRound, ShieldCheck, Eye, EyeOff, Lock, Building2, Truck, Briefcase, Route, Settings2, BellRing, MessageSquare, ShoppingBag, GitBranch, RotateCcw, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, DollarSign, BarChart3, FileCheck2, ShoppingCart, Store, Boxes } from 'lucide-react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { ToastContainer } from '../shared/ToastContainer'
import { validarSessaoServidor } from '../../lib/authGuard'
import { isApiEnabled } from '../../lib/apiClient'
import { cadastrosQueries } from '../../queries/cadastros'
import { operadoresQueries } from '../../queries/operadores'
import { isCliente, isMaster, temPermissao, temAlgumaPermissao } from '../../utils/permissoes'

function TopBar({ sidebarRecolhida = false, onToggleSidebar }) {
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
        }
      })
      .catch(() => {})
  }, [operador?.id, clienteUser, setFiliaisDisponiveis])

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
              title="Troca rápida de Empresa / Filial (ex: 1/1 Açougue, 1/2 Estoque, 2/1 FG)"
            >
              {filiaisDisponiveis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.codigo} — {f.nome}
                </option>
              ))}
            </select>
          </div>
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
  const { operador } = useAppStore()
  const cliente = isCliente(operador)

  if (cliente) {
    return (
      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} style={{ position: 'relative' }}>
        <div
          className="sidebar__section-label"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px 6px 16px',
          }}
        >
          <span>Portal do Cliente</span>
          {onCollapse && (
            <button
              type="button"
              className="sidebar__collapse-pill"
              onClick={onCollapse}
              title="Recolher menu lateral"
            >
              <ChevronLeft size={13} /> Recolher
            </button>
          )}
        </div>
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
  const temVarejoLoja = temAlgumaPermissao(operador, ['pdv_caixa', 'varejo_acougue'])
  const temCompras = temAlgumaPermissao(operador, ['compras', 'recebimento', 'insumos_coleta'])
  const temFaturamento = temAlgumaPermissao(operador, ['whatsapp_inbox', 'pedidos', 'financeiro_pedidos', 'roteirizacao', 'fiscal', 'devolucao_fiscal', 'interunidades'])
  const temFinanceiro = temAlgumaPermissao(operador, ['financeiro', 'financeiro_pedidos'])
  const temGestaoOperacional = temAlgumaPermissao(operador, ['mapa_producao', 'producao_criar_op'])
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
    'saida',
    'expedicao',
    'roteirizacao_carregamento',
    'devolucao',
    'devolucao_fiscal',
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
  const temEstruturaComercial = temAlgumaPermissao(operador, [
    'clientes',
    'fornecedores',
    'vendedores',
    'transportadoras',
    'roteirizacao',
    'empresas_filiais',
    'parametros_comerciais',
  ])
  const temCadastros = temAlgumaPermissao(operador, ['taras', 'locais', 'operadores', 'perfis_gerenciar'])

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`} style={{ position: 'relative' }}>
      <div
        className="sidebar__section-label"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px 6px 16px',
          marginTop: 2,
        }}
      >
        <span>{temVisaoGeral || !temOperacao ? 'Visão Geral' : 'Menu'}</span>
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
      <NavLink to="/" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
        <Package size={18} /> {temPermissao(operador, 'dashboard_executivo') ? 'Dashboard' : 'Início / Operações'}
      </NavLink>
      <NavLink to="/pendencias" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
        <BellRing size={18} /> Central de Pendências
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
      
      {temVarejoLoja && (
        <>
          <div className="sidebar__section-label">Loja 1/1 (Varejo &amp; Açougue)</div>
          {temAlgumaPermissao(operador, ['pdv_caixa', 'varejo_acougue']) && (
            <NavLink to="/pdv" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <ShoppingCart size={18} /> PDV Frente de Caixa
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['varejo_acougue']) && (
            <NavLink to="/loja" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Store size={18} /> Açougue, Empório &amp; QR
            </NavLink>
          )}
        </>
      )}

      {temCompras && (
        <>
          <div className="sidebar__section-label">Compras &amp; Insumos</div>
          {temAlgumaPermissao(operador, ['compras', 'recebimento']) && (
            <NavLink to="/compras" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <ShoppingBag size={18} /> Pedidos de Compra
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['insumos_coleta', 'compras', 'varejo_acougue', 'producao_entrada']) && (
            <NavLink to="/insumos-coleta" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Boxes size={18} /> Coleta de Insumos
            </NavLink>
          )}
        </>
      )}

      {temFaturamento && (
        <>
          <div className="sidebar__section-label">Faturamento</div>
          {temAlgumaPermissao(operador, ['interunidades', 'movimentacao', 'fiscal', 'varejo_acougue']) && (
            <NavLink to="/interunidades" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <ArrowRightLeft size={18} /> Inter-Unidades (1/2↔2/1↔1/1)
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['whatsapp_inbox', 'pedidos']) && (
            <NavLink to="/whatsapp-inbox" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={18} /> Entrada WhatsApp
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['pedidos', 'financeiro_pedidos']) && (
            <NavLink to="/pedidos" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <ClipboardList size={18} /> Pedidos de Venda
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['fiscal', 'devolucao_fiscal', 'parametros_comerciais']) && (
            <NavLink to="/fiscal" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <FileCheck2 size={18} /> Fiscal (NF-e / NFC-e)
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['roteirizacao', 'pedidos', 'transportadoras']) && (
            <NavLink to="/roteirizacao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Truck size={18} /> Roteirização / Embarques
            </NavLink>
          )}
        </>
      )}

      {temFinanceiro && (
        <>
          <div className="sidebar__section-label">Financeiro</div>
          <NavLink to="/financeiro" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
            <DollarSign size={18} /> Financeiro (Pagar/Receber)
          </NavLink>
          <NavLink to="/dre" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
            <BarChart3 size={18} /> DRE &amp; Margem Real
          </NavLink>
        </>
      )}

      {temGestaoOperacional && (
        <>
          <div className="sidebar__section-label">Gestão Operacional</div>
          <NavLink to="/mapa-producao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
            <GitBranch size={18} /> Mapa de Produção
          </NavLink>
        </>
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
      {temAlgumaPermissao(operador, ['saida', 'expedicao']) && (
        <NavLink to="/saida" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <LogOut size={18} /> Saída de Materiais
        </NavLink>
      )}
      {temPermissao(operador, 'roteirizacao_carregamento') && !temAlgumaPermissao(operador, ['roteirizacao', 'pedidos', 'transportadoras']) && (
        <NavLink to="/roteirizacao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Truck size={18} /> Carregamento / Roteiros
        </NavLink>
      )}
      {temAlgumaPermissao(operador, ['devolucao', 'devolucao_fiscal', 'saida', 'expedicao', 'recebimento']) && (
        <NavLink to="/devolucao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <RotateCcw size={18} /> Devolução de Caixas
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
      
      {temEstruturaComercial && (
        <>
          <div className="sidebar__section-label">Comercial &amp; Estrutura</div>
          {temAlgumaPermissao(operador, ['clientes', 'pedidos', 'financeiro_pedidos']) && (
            <NavLink to="/clientes" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Building2 size={18} /> Clientes &amp; Especif.
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['fornecedores', 'recebimento']) && (
            <NavLink to="/fornecedores" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Truck size={18} /> Fornecedores &amp; SIF
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['vendedores', 'operadores']) && (
            <NavLink to="/vendedores" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Briefcase size={18} /> Vendedores
            </NavLink>
          )}
          {temPermissao(operador, 'transportadoras') && (
            <NavLink to="/transportadoras" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Route size={18} /> Rotas &amp; Transp.
            </NavLink>
          )}
          {temAlgumaPermissao(operador, ['transportadoras', 'roteirizacao']) && (
            <NavLink to="/tipos-veiculo" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Truck size={18} /> Tipos de Veículo
            </NavLink>
          )}
          {temPermissao(operador, 'empresas_filiais') && (
            <NavLink to="/filiais" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Factory size={18} /> Empresas &amp; Filiais
            </NavLink>
          )}
          {temPermissao(operador, 'parametros_comerciais') && (
            <NavLink to="/parametros-comerciais" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Settings2 size={18} /> Parâmetros Comerciais &amp; Fiscais
            </NavLink>
          )}
        </>
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
  const { operador, sessionToken, filialAtivaId, setOperador, logout, toastError } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [sidebarRecolhida, setSidebarRecolhida] = useState(() =>
    window.location.pathname.startsWith('/recebimento'),
  )

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
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        {!isMobile && (
          <TopBar
            sidebarRecolhida={sidebarRecolhida}
            onToggleSidebar={() => setSidebarRecolhida((v) => !v)}
          />
        )}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
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
      <ToastContainer />
    </div>
  )
}
