import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ArrowRightLeft, ClipboardList, LogOut } from 'lucide-react'
import { useAppStore } from '../store/appStore'

export function ColetorHome() {
  const navigate = useNavigate()
  const { operador, setOperador } = useAppStore()

  const handleLogout = () => {
    setOperador(null)
    navigate('/login')
  }

  return (
    <div className="coletor-home">
      <header className="coletor-header">
        <div className="coletor-user">
          <span className="user-icon">{operador?.nome?.charAt(0) || 'U'}</span>
          <span>{operador?.nome}</span>
        </div>
        <button className="btn-icon" onClick={handleLogout} title="Sair">
          <LogOut size={24} />
        </button>
      </header>

      <div className="coletor-content">
        <h2>Selecione a Operação</h2>
        
        <div className="coletor-menu">
          <button className="coletor-btn" onClick={() => navigate('/recebimento')}>
            <Package size={40} />
            <span>Recebimento</span>
          </button>
          
          <button className="coletor-btn" onClick={() => navigate('/movimentacao')}>
            <ArrowRightLeft size={40} />
            <span>Movimentação</span>
          </button>

          <button className="coletor-btn" onClick={() => navigate('/inventario/coletor')}>
            <ClipboardList size={40} />
            <span>Inventário</span>
          </button>
        </div>
      </div>
    </div>
  )
}
