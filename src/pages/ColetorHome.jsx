import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ArrowRightLeft, ClipboardList, LogOut, PackageOpen } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ColetorHome() {
  const navigate = useNavigate()
  const { operador, logout } = useAppStore()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const operacoes = [
    {
      label: 'Recebimento',
      icon: <Package size={44} />,
      rota: '/recebimento',
      cor: '#3b82f6',
    },
    {
      label: 'Movimentação',
      icon: <ArrowRightLeft size={44} />,
      rota: '/movimentacao',
      cor: '#06b6d4',
    },
    {
      label: 'Saída de\nMateriais',
      icon: <PackageOpen size={44} />,
      rota: '/saida',
      cor: '#f59e0b',
    },
    {
      label: 'Inventário',
      icon: <ClipboardList size={44} />,
      rota: '/inventario/coletor',
      cor: '#22c55e',
    },
  ]

  return (
    <div className="coletor-home">
      {/* Header */}
      <header className="coletor-header">
        <div className="coletor-user">
          <div className="coletor-avatar">{operador?.nome?.charAt(0) || 'U'}</div>
          <div>
            <div className="coletor-nome">{operador?.nome}</div>
            <div className="coletor-perfil">{operador?.perfil}</div>
          </div>
        </div>
        <button className="coletor-logout" onClick={handleLogout} title="Sair">
          <LogOut size={22} />
        </button>
      </header>

      {/* Título */}
      <div className="coletor-title">
        <div className="coletor-title-badge">W</div>
        <div>
          <div className="coletor-title-main">WMS Logística</div>
          <div className="coletor-title-sub">Selecione a operação</div>
        </div>
      </div>

      {/* Botões */}
      <div className="coletor-grid">
        {operacoes.map((op) => (
          <button
            key={op.rota}
            className="coletor-card"
            style={{ '--card-cor': op.cor }}
            onClick={() => navigate(op.rota)}
          >
            <div className="coletor-card-icon">{op.icon}</div>
            <div className="coletor-card-label">{op.label}</div>
          </button>
        ))}
      </div>

      <div className="coletor-footer">WMS Logística v1.0</div>
    </div>
  )
}
