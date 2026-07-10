import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ArrowRightLeft, ClipboardList, LogOut, PackageOpen, MapPin, Search, Factory, Scissors } from 'lucide-react'
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
      permissao: 'recebimento',
    },
    {
      label: 'Movimentação',
      icon: <ArrowRightLeft size={44} />,
      rota: '/movimentacao',
      cor: '#06b6d4',
      permissao: 'movimentacao',
    },
    {
      label: 'Saída de\nMateriais',
      icon: <PackageOpen size={44} />,
      rota: '/saida',
      cor: '#f59e0b',
      permissao: 'saida',
    },
    {
      label: 'Inventário',
      icon: <ClipboardList size={44} />,
      rota: '/inventario/coletor',
      cor: '#22c55e',
      permissao: 'inventario_coletor',
    },
    {
      label: 'Consulta de\nEndereço',
      icon: <MapPin size={44} />,
      rota: '/consulta-endereco',
      cor: '#a855f7',
      permissao: 'consulta_endereco',
    },
    {
      label: 'Rastreabilidade\nde Caixa',
      icon: <Search size={44} />,
      rota: '/rastreabilidade',
      cor: '#ec4899',
      permissao: 'rastreabilidade',
    },
    {
      label: 'Retorno de\nProdução',
      icon: <Factory size={44} />,
      rota: '/producao',
      cor: '#f97316',
      permissao: 'retorno_producao',
    },
    {
      label: 'Desmembra-\nmento',
      icon: <Scissors size={44} />,
      rota: '/desmembramento',
      cor: '#14b8a6',
      permissao: 'desmembramento',
    },
  ]



  // Filtra cards conforme permissões do operador (ADM vê tudo)
  const isAdm = operador?.is_adm === 1
  const perm = operador?.permissoes || {}

  const operacoesFiltradas = operacoes.filter(op => {
    if (isAdm) return true
    return op.permissao ? perm[op.permissao] : true
  })

  return (
    <div className="coletor-home">
      {/* Header */}
      <header className="coletor-header">
        <div className="coletor-user">
          <div className="coletor-avatar">{operador?.nome?.charAt(0) || 'U'}</div>
          <div>
            <div className="coletor-nome">{operador?.nome}</div>
            <div className="coletor-perfil">WMSphere - Tricarnes</div>
          </div>
        </div>
        <button className="coletor-logout" onClick={handleLogout} title="Sair">
          <LogOut size={20} />
        </button>
      </header>

      {/* Botões */}
      <div className="coletor-grid">
        {operacoesFiltradas.map((op) => (
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
    </div>
  )
}
