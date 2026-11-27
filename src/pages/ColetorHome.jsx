import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRightLeft,
  BarChart3,
  BellRing,
  Box,
  CheckSquare,
  ClipboardList,
  DollarSign,
  Factory,
  FileCheck2,
  Layers,
  LogOut,
  MapPin,
  MessageSquare,
  Package,
  PackageOpen,
  PieChart,
  Printer,
  RotateCcw,
  Scale,
  Scissors,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Store,
  TrendingUp,
  Truck,
  Users,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { operadoresQueries } from '../queries/operadores'
import { isCliente, isMaster, temPermissao, temAlgumaPermissao } from '../utils/permissoes'
import { normalizarTexto } from '../utils/modulosCatalogo'

const SECOES_META = [
  { id: 'OPERACAO', label: 'Operação WMS' },
  { id: 'COMERCIAL', label: 'Comercial & Entregas' },
  { id: 'ESTOQUE', label: 'Estoque & Qualidade' },
  { id: 'VAREJO', label: 'Loja & PDV' },
  { id: 'GESTAO', label: 'Gestão & Financeiro' },
]

export function ColetorHome() {
  const navigate = useNavigate()
  const {
    operador,
    sessionToken,
    filialAtivaId,
    filiaisDisponiveis,
    setFilialAtiva,
    logout,
    toastSuccess,
  } = useAppStore()

  const [busca, setBusca] = useState('')
  const [categoriaAtiva, setCategoriaAtiva] = useState('TODOS')

  useEffect(() => {
    if (isCliente(operador)) {
      navigate('/portal-cliente', { replace: true })
    }
  }, [operador, navigate])

  const filialAtivaObj =
    (filiaisDisponiveis || []).find((f) => String(f.id) === String(filialAtivaId)) ||
    (filiaisDisponiveis || [])[0] ||
    null
  const isFilialVarejo = String(filialAtivaObj?.tipo_unidade || '').toUpperCase() === 'VAREJO'
  const masterUser = isMaster(operador)
  const nivelLabel = masterUser ? 'MASTER' : (operador?.nivel || operador?.perfil || 'OPERADOR')

  const operacoes = useMemo(() => {
    if (!operador || isCliente(operador)) return []
    const todos = [
      // ── OPERAÇÃO WMS ────────────────────────────────────────────────────────
      {
        id: 'recebimento',
        secao: 'OPERACAO',
        label: 'Recebimento',
        sub: 'Entrada & Conferência',
        icon: <Package size={24} />,
        rota: '/recebimento',
        cor: '#3b82f6',
        visivel: temAlgumaPermissao(operador, ['recebimento', 'recebimento_consultar']),
      },
      {
        id: 'movimentacao',
        secao: 'OPERACAO',
        label: 'Movimentação',
        sub: 'Endereçamento Câmara',
        icon: <ArrowRightLeft size={24} />,
        rota: '/movimentacao',
        cor: '#06b6d4',
        visivel: temAlgumaPermissao(operador, ['movimentacao', 'movimentacao_consultar']),
      },
      {
        id: 'saida',
        secao: 'OPERACAO',
        label: 'Saída de Materiais',
        sub: 'Separação & Romaneio',
        icon: <PackageOpen size={24} />,
        rota: '/saida',
        cor: '#f59e0b',
        visivel: temAlgumaPermissao(operador, ['saida', 'expedicao']),
      },
      {
        id: 'carregamento',
        secao: 'OPERACAO',
        label: 'Carregamento & Roteiros',
        sub: 'Expedição & Frotas',
        icon: <Truck size={24} />,
        rota: '/roteirizacao',
        cor: '#38bdf8',
        visivel: temAlgumaPermissao(operador, ['roteirizacao_carregamento', 'roteirizacao', 'pedidos', 'saida', 'expedicao']),
      },
      {
        id: 'producao',
        secao: 'OPERACAO',
        label: 'Retorno de Produção',
        sub: 'Ordens & Desossa',
        icon: <Factory size={24} />,
        rota: '/producao',
        cor: '#f97316',
        visivel: temAlgumaPermissao(operador, ['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op']),
      },
      {
        id: 'desmembramento',
        secao: 'OPERACAO',
        label: 'Desmembramento',
        sub: 'Fracionar Caixas',
        icon: <Scissors size={24} />,
        rota: '/desmembramento',
        cor: '#14b8a6',
        visivel: temPermissao(operador, 'desmembramento'),
      },
      {
        id: 'devolucao',
        secao: 'OPERACAO',
        label: 'Devolução de Caixas',
        sub: 'Retorno & Estorno',
        icon: <RotateCcw size={24} />,
        rota: '/devolucao',
        cor: '#ef4444',
        visivel: temAlgumaPermissao(operador, ['devolucao', 'devolucao_fiscal', 'saida', 'expedicao', 'recebimento']),
      },
      {
        id: 'reimpressao',
        secao: 'OPERACAO',
        label: 'Reimpressão Etiquetas',
        sub: 'Zebra / QR / EAN',
        icon: <Printer size={24} />,
        rota: '/reimpressao',
        cor: '#22d3ee',
        visivel: temPermissao(operador, 'reimpressao'),
      },

      // ── COMERCIAL & ENTREGAS ────────────────────────────────────────────────
      {
        id: 'pedidos',
        secao: 'COMERCIAL',
        label: 'Pedidos de Venda',
        sub: 'Programação & Embarque',
        icon: <ClipboardList size={24} />,
        rota: '/pedidos',
        cor: '#8b5cf6',
        visivel: temAlgumaPermissao(operador, ['pedidos', 'financeiro_pedidos']),
      },
      {
        id: 'forca-vendas',
        secao: 'COMERCIAL',
        label: 'Força de Vendas',
        sub: 'Metas, Margem & Visitas',
        icon: <TrendingUp size={24} />,
        rota: '/forca-vendas',
        cor: '#10b981',
        visivel: temAlgumaPermissao(operador, ['pedidos', 'financeiro_pedidos', 'clientes', 'vendedores']),
      },
      {
        id: 'app-motorista',
        secao: 'COMERCIAL',
        label: 'App Motorista',
        sub: 'Rotas, GPS & Canhoto',
        icon: <Smartphone size={24} />,
        rota: '/motorista',
        cor: '#0ea5e9',
        visivel: temAlgumaPermissao(operador, ['roteirizacao', 'roteirizacao_carregamento', 'saida', 'expedicao', 'pedidos']),
      },
      {
        id: 'whatsapp-inbox',
        secao: 'COMERCIAL',
        label: 'Entrada WhatsApp',
        sub: 'Atendimento & Pedidos',
        icon: <MessageSquare size={24} />,
        rota: '/whatsapp-inbox',
        cor: '#22c55e',
        visivel: temAlgumaPermissao(operador, ['whatsapp_inbox', 'pedidos']),
      },

      // ── ESTOQUE & QUALIDADE ─────────────────────────────────────────────────
      {
        id: 'consulta-estoque',
        secao: 'ESTOQUE',
        label: 'Consulta de Estoque',
        sub: 'Saldo em Tempo Real',
        icon: <Search size={24} />,
        rota: '/consulta-estoque',
        cor: '#60a5fa',
        visivel: temPermissao(operador, 'consulta_estoque'),
      },
      {
        id: 'estoque-enderecos',
        secao: 'ESTOQUE',
        label: 'Estoque por Endereço',
        sub: 'Câmaras & Posições',
        icon: <Layers size={24} />,
        rota: '/estoque',
        cor: '#38bdf8',
        visivel: temPermissao(operador, 'estoque_enderecos'),
      },
      {
        id: 'consulta-endereco',
        secao: 'ESTOQUE',
        label: 'Consulta de Endereço',
        sub: 'Bipar Posição',
        icon: <MapPin size={24} />,
        rota: '/consulta-endereco',
        cor: '#a855f7',
        visivel: temPermissao(operador, 'consulta_endereco'),
      },
      {
        id: 'inventario',
        secao: 'ESTOQUE',
        label: 'Inventário',
        sub: 'Contagem & Auditoria',
        icon: <CheckSquare size={24} />,
        rota: temPermissao(operador, 'inventario_coletor') ? '/inventario/coletor' : '/inventario',
        cor: '#22c55e',
        visivel: temAlgumaPermissao(operador, ['inventario_coletor', 'inventario_divergencias', 'inventario_gestao', 'inventario_carga_inicial']),
      },
      {
        id: 'rastreabilidade',
        secao: 'ESTOQUE',
        label: 'Rastreabilidade',
        sub: 'Histórico da Caixa',
        icon: <Package size={24} />,
        rota: '/rastreabilidade',
        cor: '#ec4899',
        visivel: temPermissao(operador, 'rastreabilidade'),
      },
      {
        id: 'governanca-perdas',
        secao: 'ESTOQUE',
        label: 'Governança & Perdas',
        sub: 'FEFO, Rondas & Cotações',
        icon: <ShieldCheck size={24} />,
        rota: '/governanca-perdas',
        cor: '#f59e0b',
        visivel: temAlgumaPermissao(operador, [
          'compras', 'fornecedores', 'recebimento', 'estoque_enderecos',
          'consulta_estoque', 'relatorios_estoque', 'dashboard_executivo',
          'varejo_acougue', 'financeiro',
        ]),
      },
      {
        id: 'compras',
        secao: 'ESTOQUE',
        label: 'Pedidos de Compra',
        sub: 'NF Entrada & Suprimentos',
        icon: <ShoppingBag size={24} />,
        rota: '/compras',
        cor: '#818cf8',
        visivel: temAlgumaPermissao(operador, ['compras', 'recebimento']),
      },

      // ── LOJA & PDV (VAREJO) ─────────────────────────────────────────────────
      {
        id: 'pdv',
        secao: 'VAREJO',
        label: 'PDV Frente de Caixa',
        sub: 'Vendas & Cupom',
        icon: <ShoppingCart size={24} />,
        rota: '/pdv',
        cor: '#22c55e',
        visivel: isFilialVarejo && temAlgumaPermissao(operador, ['pdv_caixa', 'varejo_acougue']),
      },
      {
        id: 'acougue',
        secao: 'VAREJO',
        label: 'Açougue',
        sub: 'Pesagem & Balcão',
        icon: <Scale size={24} />,
        rota: '/acougue',
        cor: '#ef4444',
        visivel: isFilialVarejo && temPermissao(operador, 'varejo_acougue'),
      },
      {
        id: 'gerenciador-acougue',
        secao: 'VAREJO',
        label: 'Gerenciador Açougue',
        sub: 'MP Aberta & Quebras',
        icon: <Store size={24} />,
        rota: '/gerenciador-acougue',
        cor: '#f97316',
        visivel: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue', 'pdv_caixa']),
      },
      {
        id: 'emporio',
        secao: 'VAREJO',
        label: 'Empório',
        sub: 'Estoque Mercearia',
        icon: <ShoppingBag size={24} />,
        rota: '/emporio',
        cor: '#eab308',
        visivel: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue', 'pdv_caixa', 'compras']),
      },

      // ── GESTÃO & FINANCEIRO ─────────────────────────────────────────────────
      {
        id: 'dashboard-executivo',
        secao: 'GESTAO',
        label: 'Painel Executivo',
        sub: 'KPIs & Indicadores',
        icon: <BarChart3 size={24} />,
        rota: '/dashboard',
        cor: '#3b82f6',
        visivel: temPermissao(operador, 'dashboard_executivo'),
      },
      {
        id: 'relatorios',
        secao: 'GESTAO',
        label: 'Relatórios & BI',
        sub: 'Gerenciais & PDFs',
        icon: <PieChart size={24} />,
        rota: '/relatorios',
        cor: '#10b981',
        visivel: temAlgumaPermissao(operador, ['relatorios_producao', 'relatorios_estoque']),
      },
      {
        id: 'financeiro',
        secao: 'GESTAO',
        label: 'Financeiro',
        sub: 'Pagar & Receber',
        icon: <DollarSign size={24} />,
        rota: '/financeiro',
        cor: '#22c55e',
        visivel: temAlgumaPermissao(operador, ['financeiro', 'financeiro_pedidos']),
      },
      {
        id: 'dre',
        secao: 'GESTAO',
        label: 'DRE & Margem Real',
        sub: 'Resultado Gerencial',
        icon: <TrendingUp size={24} />,
        rota: '/dre',
        cor: '#06b6d4',
        visivel: temAlgumaPermissao(operador, ['financeiro', 'financeiro_pedidos', 'dashboard_executivo']),
      },
      {
        id: 'fiscal',
        secao: 'GESTAO',
        label: 'Fiscal (NF-e / NFC-e)',
        sub: 'Notas & Cofre XML',
        icon: <FileCheck2 size={24} />,
        rota: '/fiscal',
        cor: '#a78bfa',
        visivel: temAlgumaPermissao(operador, ['fiscal', 'devolucao_fiscal', 'parametros_comerciais']),
      },
      {
        id: 'produtos',
        secao: 'GESTAO',
        label: 'Produtos & Catálogo',
        sub: 'Cortes, Empório & BOM',
        icon: <Box size={24} />,
        rota: '/produtos',
        cor: '#38bdf8',
        visivel: temPermissao(operador, 'produtos'),
      },
      {
        id: 'pendencias',
        secao: 'GESTAO',
        label: 'Central de Pendências',
        sub: 'Alertas & Validades',
        icon: <BellRing size={24} />,
        rota: '/pendencias',
        cor: '#f59e0b',
        visivel: true,
      },
      {
        id: 'operadores',
        secao: 'GESTAO',
        label: 'Usuários & Permissões',
        sub: 'Acessos & Perfis',
        icon: <Users size={24} />,
        rota: '/operadores',
        cor: '#eab308',
        visivel: temAlgumaPermissao(operador, ['operadores', 'perfis_gerenciar']),
      },
    ]

    return todos.filter((op) => op.visivel)
  }, [operador, isFilialVarejo])

  const secoesDisponiveis = useMemo(
    () => SECOES_META.filter((sec) => operacoes.some((op) => op.secao === sec.id)),
    [operacoes],
  )

  const operacoesFiltradas = useMemo(() => {
    const q = normalizarTexto(busca)
    return operacoes.filter((op) => {
      if (categoriaAtiva !== 'TODOS' && op.secao !== categoriaAtiva) return false
      if (!q) return true
      const alvo = normalizarTexto(`${op.label} ${op.sub}`)
      return alvo.includes(q)
    })
  }, [operacoes, categoriaAtiva, busca])

  const gruposExibidos = useMemo(() => {
    return secoesDisponiveis
      .map((sec) => ({
        ...sec,
        itens: operacoesFiltradas.filter((op) => op.secao === sec.id),
      }))
      .filter((sec) => sec.itens.length > 0)
  }, [secoesDisponiveis, operacoesFiltradas])

  if (isCliente(operador)) return null

  const handleLogout = async () => {
    try {
      await operadoresQueries.encerrarSessao(sessionToken)
    } catch { /* ignore */ }
    logout()
    navigate('/login')
  }

  return (
    <div className="coletor-home">
      {/* Hero Card: Usuário + Seletor de Filial + Busca Rápida */}
      <section className="coletor-hero">
        <div className="coletor-header">
          <div className="coletor-user">
            <div className="coletor-avatar">{operador?.nome?.charAt(0) || 'U'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="coletor-nome">{operador?.nome}</div>
              <div className="coletor-perfil">
                {nivelLabel}
                {filialAtivaObj ? ` • ${filialAtivaObj.codigo}` : ' • Tricarnes'}
              </div>
            </div>
          </div>
          <button className="coletor-logout" onClick={handleLogout} title="Sair da conta">
            <LogOut size={16} />
            <span>Sair</span>
          </button>
        </div>

        {isApiEnabled() && (filiaisDisponiveis || []).length > 1 && (
          <select
            className="form-input"
            style={{ height: 38, fontSize: 14, background: 'var(--bg-1)' }}
            value={filialAtivaId}
            onChange={(e) => {
              const novoId = e.target.value
              const f = filiaisDisponiveis.find((x) => String(x.id) === String(novoId))
              setFilialAtiva(novoId)
              if (f) toastSuccess('Filial alterada', `Operando em ${f.codigo} - ${f.nome}`)
            }}
            aria-label="Selecionar filial ativa"
          >
            {filiaisDisponiveis.map((f) => (
              <option key={f.id} value={f.id}>
                Filial: {f.codigo} — {f.nome}
              </option>
            ))}
          </select>
        )}

        <div className="search-box" style={{ padding: '9px 12px', background: 'var(--bg-1)' }}>
          <Search size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Buscar tela ou operação..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar operação"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', cursor: 'pointer' }}
              aria-label="Limpar busca"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </section>

      {/* Pílulas de Categoria */}
      {secoesDisponiveis.length > 1 && (
        <div className="coletor-pills" role="tablist" aria-label="Categorias de módulos">
          <button
            type="button"
            className={`coletor-pill ${categoriaAtiva === 'TODOS' ? 'coletor-pill--active' : ''}`}
            onClick={() => setCategoriaAtiva('TODOS')}
          >
            Todos ({operacoes.length})
          </button>
          {secoesDisponiveis.map((sec) => (
            <button
              key={sec.id}
              type="button"
              className={`coletor-pill ${categoriaAtiva === sec.id ? 'coletor-pill--active' : ''}`}
              onClick={() => setCategoriaAtiva(sec.id)}
            >
              {sec.label}
            </button>
          ))}
        </div>
      )}

      {/* Seções e Cards Roláveis */}
      {gruposExibidos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
          Nenhuma operação encontrada para <strong style={{ color: 'var(--text-primary)' }}>"{busca}"</strong>.
        </div>
      ) : (
        gruposExibidos.map((grupo) => (
          <section key={grupo.id} className="coletor-section">
            <div className="coletor-section-title">{grupo.label}</div>
            <div className="coletor-grid">
              {grupo.itens.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  className="coletor-card"
                  style={{ '--card-cor': op.cor }}
                  onClick={() => navigate(op.rota)}
                >
                  <div className="coletor-card-icon">{op.icon}</div>
                  <div className="coletor-card-label">{op.label}</div>
                  {op.sub && <div className="coletor-card-sub">{op.sub}</div>}
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      <footer className="coletor-footer">
        WMSphere ERP • Role para ver todos os módulos ou toque no menu superior
      </footer>
    </div>
  )
}
