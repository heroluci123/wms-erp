import React, { useEffect, useState } from 'react'
import { Package, ArrowRightLeft, Upload, CheckSquare, Search, Box, LogOut, Minus, Square, X, MapPin, Users, Map, Layers, Barcode } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'
import { ToastContainer } from '../shared/ToastContainer'

function TopBar() {
  const { operador, logout } = useAppStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="titlebar">
      <div className="titlebar__logo">
        <span className="titlebar__title">WMSphere - Tricarnes</span>
      </div>
      
      <div className="titlebar__spacer" />
      
      {operador && (
        <div className="titlebar__operator">
          <span>Operador:</span>
          <span className="titlebar__operator-badge">{operador.nome}</span>
          <button 
            className="btn btn--ghost btn--icon" 
            style={{ marginLeft: 8, padding: 4 }} 
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
  )
}

function Sidebar() {
  const { operador } = useAppStore()

  return (
    <aside className="sidebar">
      <div className="sidebar__section-label">Visão Geral</div>
      <NavLink to="/" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
        <Package size={18} /> Dashboard
      </NavLink>
      {operador?.permissoes?.estoque_enderecos && (
        <NavLink to="/estoque" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Layers size={18} /> Estoque por Endereço
        </NavLink>
      )}
      <NavLink to="/mapa" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
        <Map size={18} /> Mapa de Capacidade
      </NavLink>
      
      { (operador?.permissoes?.recebimento || operador?.permissoes?.movimentacao || operador?.permissoes?.saida || operador?.permissoes?.expedicao) && (
        <div className="sidebar__section-label">Operação</div>
      )}
      
      {operador?.permissoes?.recebimento && (
        <NavLink to="/recebimento" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Upload size={18} /> Recebimento (REC)
        </NavLink>
      )}
      {operador?.permissoes?.movimentacao && (
        <NavLink to="/movimentacao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <ArrowRightLeft size={18} /> Movimentação Interna
        </NavLink>
      )}
      {operador?.permissoes?.saida && (
        <NavLink to="/saida" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <LogOut size={18} /> Saída de Materiais
        </NavLink>
      )}
      {operador?.permissoes?.expedicao && (
        <NavLink to="/expedicao" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Box size={18} /> Área de Expedição
        </NavLink>
      )}

      { (operador?.permissoes?.inventario_coletor || operador?.permissoes?.inventario_gestao || operador?.permissoes?.produtos) && (
        <div className="sidebar__section-label">Controle</div>
      )}
      
      { (operador?.permissoes?.inventario_coletor || operador?.permissoes?.inventario_gestao) && (
        <NavLink to="/inventario" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <CheckSquare size={18} /> Inventário
        </NavLink>
      )}
      {operador?.permissoes?.produtos && (
        <NavLink to="/produtos" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Search size={18} /> Consulta & Produtos
        </NavLink>
      )}
      {operador?.permissoes?.produtos && (
        <NavLink to="/ean-editor" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
          <Barcode size={18} /> Editor de EAN
        </NavLink>
      )}
      
      { (operador?.permissoes?.locais || operador?.permissoes?.operadores) && (
        <>
          <div className="sidebar__section-label">Cadastros</div>
          {operador?.permissoes?.locais && (
            <NavLink to="/locais" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <MapPin size={18} /> Cadastro de Locais
            </NavLink>
          )}
          {operador?.permissoes?.operadores && (
            <NavLink to="/operadores" className={({isActive}) => `sidebar__nav-item ${isActive ? 'active' : ''}`}>
              <Users size={18} /> Operadores e Permissões
            </NavLink>
          )}
        </>
      )}

      <div className="sidebar__bottom">
        {/* Espaço para versão, status de sync, etc */}
        <div style={{ padding: '0 16px', fontSize: 11, color: 'var(--text-disabled)', textAlign: 'center' }}>
          Offline-First V1.0
        </div>
      </div>
    </aside>
  )
}

export function Layout() {
  const { operador } = useAppStore()
  const navigate = useNavigate()
  const [isMobile, setIsMobile] = React.useState(window.innerWidth <= 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    if (!operador) {
      navigate('/login')
    }
  }, [operador, navigate])

  if (!operador) return null

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
