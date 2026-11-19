import React from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Layout } from './components/Layout/Layout'
import { useAppStore } from './store/appStore'
import { isCliente, temPermissao, temAlgumaPermissao } from './utils/permissoes'
import { GlobalConfirmDialog } from './components/shared/ModalDialog'

// Pages
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { PortalCliente } from './pages/PortalCliente'
import { Relatorios } from './pages/Relatorios'
import { EstoqueEnderecos } from './pages/EstoqueEnderecos'
import { Recebimento } from './pages/Recebimento'
import { Movimentacao } from './pages/Movimentacao'

import { Inventario } from './pages/Inventario'
import { InventarioOperador } from './pages/InventarioOperador'
import { InventarioConciliacao } from './pages/InventarioConciliacao'
import { ConsultaEndereco } from './pages/ConsultaEndereco'
import { ConsultaEstoque } from './pages/ConsultaEstoque'
import { Produtos } from './pages/Produtos'
import { Rastreabilidade } from './pages/Rastreabilidade'
import { Producao } from './pages/Producao'
import { Saida } from './pages/Saida'
import { Pedidos } from './pages/Pedidos'
import { Desmembramento } from './pages/Desmembramento'
import { Locais } from './pages/Locais'
import { Operadores } from './pages/Operadores'
import { MapaCapacidade } from './pages/MapaCapacidade'
import { ColetorHome } from './pages/ColetorHome'
import { EanEditor } from './pages/EanEditor'
import { EstoqueMinimo } from './pages/EstoqueMinimo'
import { Taras } from './pages/Taras'
import { ReimpressaoEtiquetas } from './pages/ReimpressaoEtiquetas'
import { Clientes } from './pages/Clientes'
import { Fornecedores } from './pages/Fornecedores'
import { Vendedores } from './pages/Vendedores'
import { TransportadorasRotas } from './pages/TransportadorasRotas'
import { EmpresasFiliais } from './pages/EmpresasFiliais'
import { ParametrosComerciais } from './pages/ParametrosComerciais'
import { CentralPendencias } from './pages/CentralPendencias'
import { WhatsappInbox } from './pages/WhatsappInbox'
import { Compras } from './pages/Compras'
import { MapaProducao } from './pages/MapaProducao'
import { Devolucao } from './pages/Devolucao'
import { Roteirizacao } from './pages/Roteirizacao'
import { TiposVeiculo } from './pages/TiposVeiculo'
import { MotoristaRastreio } from './pages/MotoristaRastreio'
import { PedidoRastreio } from './pages/PedidoRastreio'
import { Financeiro } from './pages/Financeiro'

function AcessoNegado({ mensagem }) {
  return (
    <div className="p-24">
      <div className="card p-32 text-center border border-danger/30 bg-danger/5 max-w-[520px] mx-auto mt-32">
        <ShieldAlert size={40} className="text-danger mx-auto mb-12" />
        <h2 className="text-lg font-bold mb-8">Acesso não autorizado</h2>
        <p className="text-sm text-muted">
          {mensagem || 'Seu usuário não possui permissão para acessar esta funcionalidade.'}
        </p>
      </div>
    </div>
  )
}

function RequirePermissao({ permissoes = null, allowCliente = false, element }) {
  const { operador } = useAppStore()
  if (!operador) return <Navigate to="/login" replace />

  if (isCliente(operador) && !allowCliente) {
    return <Navigate to="/portal-cliente" replace />
  }

  if (Array.isArray(permissoes) && permissoes.length > 0 && !temAlgumaPermissao(operador, permissoes)) {
    return <AcessoNegado />
  }

  return element
}

function HomeWrapper() {
  const { operador } = useAppStore()
  if (isCliente(operador)) {
    return <Navigate to="/portal-cliente" replace />
  }
  const isMobile = window.innerWidth <= 768
  if (isMobile || !temPermissao(operador, 'dashboard_executivo')) {
    return <ColetorHome />
  }
  return <Dashboard />
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/motorista/:qrToken" element={<MotoristaRastreio />} />
        <Route path="/rastreio-pedido/:rastreioToken" element={<PedidoRastreio />} />
        
        {/* Rotas protegidas (dentro do Layout principal) */}
        <Route path="/" element={<Layout />}>
          <Route index element={<HomeWrapper />} />
          <Route path="portal-cliente" element={<RequirePermissao allowCliente={true} element={<PortalCliente />} />} />
          <Route path="estoque" element={<RequirePermissao permissoes={['estoque_enderecos']} element={<EstoqueEnderecos />} />} />
          <Route path="recebimento" element={<RequirePermissao permissoes={['recebimento', 'recebimento_consultar']} element={<Recebimento />} />} />
          <Route path="compras" element={<RequirePermissao permissoes={['compras', 'recebimento']} element={<Compras />} />} />
          <Route path="movimentacao" element={<RequirePermissao permissoes={['movimentacao', 'movimentacao_consultar']} element={<Movimentacao />} />} />
          <Route path="mapa-producao" element={<RequirePermissao permissoes={['mapa_producao', 'producao_criar_op']} element={<MapaProducao />} />} />
          <Route path="producao" element={<RequirePermissao permissoes={['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op']} element={<Producao />} />} />
          <Route path="desmembramento" element={<RequirePermissao permissoes={['desmembramento']} element={<Desmembramento />} />} />
          <Route path="reimpressao" element={<RequirePermissao permissoes={['reimpressao']} element={<ReimpressaoEtiquetas />} />} />
          <Route path="taras" element={<RequirePermissao permissoes={['taras']} element={<Taras />} />} />
          <Route path="pendencias" element={<RequirePermissao allowCliente={false} element={<CentralPendencias />} />} />
          <Route path="whatsapp-inbox" element={<RequirePermissao permissoes={['whatsapp_inbox', 'pedidos']} element={<WhatsappInbox />} />} />
          <Route path="pedidos" element={<RequirePermissao permissoes={['pedidos', 'financeiro_pedidos']} element={<Pedidos />} />} />
          <Route path="financeiro" element={<RequirePermissao permissoes={['financeiro', 'financeiro_pedidos']} element={<Financeiro />} />} />
          <Route path="roteirizacao" element={<RequirePermissao permissoes={['roteirizacao', 'roteirizacao_carregamento', 'pedidos', 'saida', 'expedicao', 'transportadoras']} element={<Roteirizacao />} />} />
          <Route path="saida" element={<RequirePermissao permissoes={['saida', 'expedicao']} element={<Saida />} />} />
          <Route path="devolucao" element={<RequirePermissao permissoes={['devolucao', 'devolucao_fiscal', 'saida', 'expedicao', 'recebimento', 'pedidos', 'financeiro_pedidos']} element={<Devolucao />} />} />

          <Route path="inventario" element={<RequirePermissao permissoes={['inventario_coletor', 'inventario_divergencias', 'inventario_gestao', 'inventario_carga_inicial']} element={<Inventario />} />} />
          <Route path="inventario/coletor" element={<RequirePermissao permissoes={['inventario_coletor']} element={<InventarioOperador />} />} />
          <Route path="inventario/conciliacao/:id" element={<RequirePermissao permissoes={['inventario_gestao', 'inventario_divergencias']} element={<InventarioConciliacao />} />} />
          <Route path="rastreabilidade" element={<RequirePermissao permissoes={['rastreabilidade']} element={<Rastreabilidade />} />} />
          <Route path="produtos" element={<RequirePermissao permissoes={['produtos']} element={<Produtos />} />} />
          <Route path="locais" element={<RequirePermissao permissoes={['locais']} element={<Locais />} />} />
          <Route path="operadores" element={<RequirePermissao permissoes={['operadores', 'perfis_gerenciar']} element={<Operadores />} />} />
          <Route path="mapa" element={<RequirePermissao permissoes={['estoque_enderecos']} element={<MapaCapacidade />} />} />
          <Route path="ean-editor" element={<RequirePermissao permissoes={['ean_etiquetas']} element={<EanEditor />} />} />
          <Route path="/estoque-enderecos" element={<RequirePermissao permissoes={['estoque_enderecos']} element={<EstoqueEnderecos />} />} />
          <Route path="/consulta-estoque" element={<RequirePermissao permissoes={['consulta_estoque']} element={<ConsultaEstoque />} />} />
          <Route path="/consulta-endereco" element={<RequirePermissao permissoes={['consulta_endereco']} element={<ConsultaEndereco />} />} />
          <Route path="/relatorios" element={<RequirePermissao permissoes={['relatorios_producao', 'relatorios_estoque']} allowCliente={true} element={<Relatorios />} />} />
          <Route path="estoque-minimo" element={<RequirePermissao permissoes={['consulta_estoque', 'relatorios_estoque']} element={<EstoqueMinimo />} />} />
          <Route path="clientes" element={<RequirePermissao permissoes={['clientes', 'pedidos', 'financeiro_pedidos']} element={<Clientes />} />} />
          <Route path="fornecedores" element={<RequirePermissao permissoes={['fornecedores', 'recebimento']} element={<Fornecedores />} />} />
          <Route path="vendedores" element={<RequirePermissao permissoes={['vendedores', 'operadores']} element={<Vendedores />} />} />
          <Route path="transportadoras" element={<RequirePermissao permissoes={['transportadoras']} element={<TransportadorasRotas />} />} />
          <Route path="tipos-veiculo" element={<RequirePermissao permissoes={['transportadoras', 'roteirizacao']} element={<TiposVeiculo />} />} />
          <Route path="filiais" element={<RequirePermissao permissoes={['empresas_filiais']} element={<EmpresasFiliais />} />} />
          <Route path="parametros-comerciais" element={<RequirePermissao permissoes={['parametros_comerciais']} element={<ParametrosComerciais />} />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalConfirmDialog />
    </Router>
  )
}

export default App
