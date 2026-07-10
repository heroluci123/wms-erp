import React from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout/Layout'

// Pages
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { EstoqueEnderecos } from './pages/EstoqueEnderecos'
import { Recebimento } from './pages/Recebimento'
import { Movimentacao } from './pages/Movimentacao'

import { Inventario } from './pages/Inventario'
import { InventarioOperador } from './pages/InventarioOperador'
import { InventarioConciliacao } from './pages/InventarioConciliacao'
import { Produtos } from './pages/Produtos'
import { Rastreabilidade } from './pages/Rastreabilidade'
import { Producao } from './pages/Producao'
import { Saida } from './pages/Saida'
import { Desmembramento } from './pages/Desmembramento'
import { Locais } from './pages/Locais'
import { Operadores } from './pages/Operadores'
import { MapaCapacidade } from './pages/MapaCapacidade'
import { ColetorHome } from './pages/ColetorHome'
import { EanEditor } from './pages/EanEditor'
import { ConsultaEndereco } from './pages/ConsultaEndereco'

function HomeWrapper() {
  const isMobile = window.innerWidth <= 768
  return isMobile ? <ColetorHome /> : <Dashboard />
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Rotas protegidas (dentro do Layout principal) */}
        <Route path="/" element={<Layout />}>
          <Route index element={<HomeWrapper />} />
          <Route path="estoque" element={<EstoqueEnderecos />} />
          <Route path="recebimento" element={<Recebimento />} />
          <Route path="movimentacao" element={<Movimentacao />} />
          <Route path="producao" element={<Producao />} />
          <Route path="desmembramento" element={<Desmembramento />} />
          <Route path="saida" element={<Saida />} />

          <Route path="inventario" element={<Inventario />} />
          <Route path="inventario/coletor" element={<InventarioOperador />} />
          <Route path="inventario/conciliacao/:id" element={<InventarioConciliacao />} />
          <Route path="rastreabilidade" element={<Rastreabilidade />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="locais" element={<Locais />} />
          <Route path="operadores" element={<Operadores />} />
          <Route path="mapa" element={<MapaCapacidade />} />
          <Route path="ean-editor" element={<EanEditor />} />
          <Route path="consulta-endereco" element={<ConsultaEndereco />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

export default App
