import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ArrowRightLeft, ClipboardList, LogOut, PackageOpen, MapPin, Search, Factory, Scissors, Printer, Users, PieChart } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { operadoresQueries } from '../queries/operadores'
import { isCliente, temPermissao, temAlgumaPermissao } from '../utils/permissoes'

export function ColetorHome() {
  const navigate = useNavigate()
  const { operador, sessionToken, logout } = useAppStore()

  useEffect(() => {
    if (isCliente(operador)) {
      navigate('/portal-cliente', { replace: true })
    }
  }, [operador, navigate])

  if (isCliente(operador)) return null

  const handleLogout = async () => {
    try {
      await operadoresQueries.encerrarSessao(sessionToken)
    } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  const operacoes = [
    {
      label: 'Recebimento',
      icon: <Package size={44} />,
      rota: '/recebimento',
      cor: '#3b82f6',
      permissoes: ['recebimento', 'recebimento_consultar'],
    },
    {
      label: 'Movimentação',
      icon: <ArrowRightLeft size={44} />,
      rota: '/movimentacao',
      cor: '#06b6d4',
      permissoes: ['movimentacao', 'movimentacao_consultar'],
    },
    {
      label: 'Saída de\nMateriais',
      icon: <PackageOpen size={44} />,
      rota: '/saida',
      cor: '#f59e0b',
      permissoes: ['saida', 'expedicao'],
    },
    {
      label: 'Pedidos',
      icon: <ClipboardList size={44} />,
      rota: '/pedidos',
      cor: '#8b5cf6',
      permissoes: ['pedidos'],
    },
    {
      label: 'Inventário',
      icon: <ClipboardList size={44} />,
      rota: temPermissao(operador, 'inventario_coletor') ? '/inventario/coletor' : '/inventario',
      cor: '#22c55e',
      permissoes: ['inventario_coletor', 'inventario_divergencias', 'inventario_gestao', 'inventario_carga_inicial'],
    },
    {
      label: 'Consulta de\nEndereço',
      icon: <MapPin size={44} />,
      rota: '/consulta-endereco',
      cor: '#a855f7',
      permissoes: ['consulta_endereco'],
    },
    {
      label: 'Rastreabilidade\nde Caixa',
      icon: <Search size={44} />,
      rota: '/rastreabilidade',
      cor: '#ec4899',
      permissoes: ['rastreabilidade'],
    },
    {
      label: 'Retorno de\nProdução',
      icon: <Factory size={44} />,
      rota: '/producao',
      cor: '#f97316',
      permissoes: ['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op'],
    },
    {
      label: 'Desmembra-\nmento',
      icon: <Scissors size={44} />,
      rota: '/desmembramento',
      cor: '#14b8a6',
      permissoes: ['desmembramento'],
    },
    {
      label: 'Reimpressão\nEtiquetas',
      icon: <Printer size={44} />,
      rota: '/reimpressao',
      cor: '#06b6d4',
      permissoes: ['reimpressao'],
    },
    {
      label: 'Relatórios',
      icon: <PieChart size={44} />,
      rota: '/relatorios',
      cor: '#10b981',
      permissoes: ['relatorios_producao', 'relatorios_estoque'],
    },
    {
      label: 'Usuários &\nPermissões',
      icon: <Users size={44} />,
      rota: '/operadores',
      cor: '#eab308',
      permissoes: ['operadores', 'perfis_gerenciar'],
    },
  ]

  const operacoesFiltradas = operacoes.filter((op) => temAlgumaPermissao(operador, op.permissoes))

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
