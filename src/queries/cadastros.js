import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'
import { db } from '../lib/db'

function exigirApi(recurso) {
  if (!isApiEnabled()) {
    throw new Error(`O cadastro de ${recurso} exige o Backend API PostgreSQL ativo (VITE_API_URL).`)
  }
}

export const cadastrosQueries = {
  // ── CONTEXTO / EMPRESAS & FILIAIS ─────────────────────────────────────────
  async listarContextoFiliais() {
    if (!isApiEnabled()) return { filial_ativa_id: '', data: [] }
    return apiRequest('/api/contexto/filiais')
  },

  async listarEmpresas() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/cadastros/empresas')).data || []
  },

  async salvarEmpresa(dados) {
    exigirApi('Empresas e Filiais')
    if (dados.id) {
      return apiRequest(`/api/cadastros/empresas/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/empresas', { method: 'POST', body: dados })
  },

  async listarFiliais() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/cadastros/filiais')).data || []
  },

  async salvarFilial(dados) {
    exigirApi('Filiais e SIF')
    if (dados.id) {
      return apiRequest(`/api/cadastros/filiais/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/filiais', { method: 'POST', body: dados })
  },

  async desativarFilial(id) {
    exigirApi('Filiais e SIF')
    return apiRequest(`/api/cadastros/filiais/${id}`, { method: 'DELETE' })
  },

  // ── SUGESTAO AUTOMATICA DE CODIGO ─────────────────────────────────────────
  async obterProximoCodigo(tipo) {
    exigirApi('Próximo Código')
    const res = await apiRequest(`/api/cadastros/proximo-codigo/${encodeURIComponent(tipo)}`)
    return res?.data?.codigo || ''
  },

  // ── CLIENTES & ESPECIFICACOES ─────────────────────────────────────────────
  async listarClientes({ incluirInativos = false } = {}) {
    if (isApiEnabled()) {
      const qs = buildQueryString({ incluir_inativos: incluirInativos ? '1' : undefined })
      return (await apiRequest(`/api/cadastros/clientes${qs}`)).data || []
    }
    const where = incluirInativos ? '' : 'WHERE ativo = 1 '
    const res = await db.execute(`SELECT * FROM clientes ${where}ORDER BY is_padrao DESC, razao_social ASC`)
    return res.rows || []
  },

  async salvarCliente(dados) {
    exigirApi('Clientes completo')
    if (dados.id) {
      return apiRequest(`/api/cadastros/clientes/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/clientes', { method: 'POST', body: dados })
  },

  async alterarAtivoCliente(id, ativo) {
    exigirApi('Clientes')
    return apiRequest(`/api/cadastros/clientes/${id}/ativo`, { method: 'PATCH', body: { ativo: ativo ? 1 : 0 } })
  },

  async excluirCliente(id) {
    exigirApi('Clientes')
    return apiRequest(`/api/cadastros/clientes/${id}`, { method: 'DELETE' })
  },

  async listarEspecificacoesCliente(clienteId) {
    if (!isApiEnabled()) return []
    return (await apiRequest(`/api/cadastros/clientes/${clienteId}/especificacoes`)).data || []
  },

  async salvarEspecificacaoCliente(clienteId, dados) {
    exigirApi('Especificações de Cliente')
    return apiRequest(`/api/cadastros/clientes/${clienteId}/especificacoes`, {
      method: 'POST',
      body: dados,
    })
  },

  async removerEspecificacaoCliente(clienteId, especId) {
    exigirApi('Especificações de Cliente')
    return apiRequest(`/api/cadastros/clientes/${clienteId}/especificacoes/${especId}`, {
      method: 'DELETE',
    })
  },

  // ── CONSULTA PÚBLICA DE CNPJ ──────────────────────────────────────────────
  async consultarCnpj(cnpj, { provedor = 'AUTO', refresh = false } = {}) {
    exigirApi('Consulta de CNPJ')
    const digits = String(cnpj || '').replace(/\D+/g, '')
    const qs = buildQueryString({ provedor, refresh: refresh ? '1' : undefined })
    return apiRequest(`/api/cadastros/consultar-cnpj/${digits}${qs}`)
  },

  // ── FORNECEDORES ──────────────────────────────────────────────────────────
  async listarFornecedores({ incluirInativos = false } = {}) {
    if (!isApiEnabled()) return []
    const qs = buildQueryString({ incluir_inativos: incluirInativos ? '1' : undefined })
    return (await apiRequest(`/api/cadastros/fornecedores${qs}`)).data || []
  },

  async salvarFornecedor(dados) {
    exigirApi('Fornecedores')
    if (dados.id) {
      return apiRequest(`/api/cadastros/fornecedores/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/fornecedores', { method: 'POST', body: dados })
  },

  async alterarAtivoFornecedor(id, ativo) {
    exigirApi('Fornecedores')
    return apiRequest(`/api/cadastros/fornecedores/${id}/ativo`, { method: 'PATCH', body: { ativo: ativo ? 1 : 0 } })
  },

  async excluirFornecedor(id) {
    exigirApi('Fornecedores')
    return apiRequest(`/api/cadastros/fornecedores/${id}`, { method: 'DELETE' })
  },

  // ── VENDEDORES & COMISSOES ────────────────────────────────────────────────
  async listarVendedores() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/cadastros/vendedores')).data || []
  },

  async salvarVendedor(dados) {
    exigirApi('Vendedores')
    if (dados.id) {
      return apiRequest(`/api/cadastros/vendedores/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/vendedores', { method: 'POST', body: dados })
  },

  async excluirVendedor(id) {
    exigirApi('Vendedores')
    return apiRequest(`/api/cadastros/vendedores/${id}`, { method: 'DELETE' })
  },

  // ── TRANSPORTADORAS & ROTAS ───────────────────────────────────────────────
  async listarTransportadoras() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/cadastros/transportadoras')).data || []
  },

  async salvarTransportadora(dados) {
    exigirApi('Transportadoras')
    if (dados.id) {
      return apiRequest(`/api/cadastros/transportadoras/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/transportadoras', { method: 'POST', body: dados })
  },

  async excluirTransportadora(id) {
    exigirApi('Transportadoras')
    return apiRequest(`/api/cadastros/transportadoras/${id}`, { method: 'DELETE' })
  },

  async listarVeiculosTransportadora(transportadoraId) {
    if (!isApiEnabled() || !transportadoraId) return []
    return (await apiRequest(`/api/cadastros/transportadoras/${transportadoraId}/veiculos`)).data || []
  },

  async salvarVeiculoTransportadora(transportadoraId, dados) {
    exigirApi('Veículos da Transportadora')
    if (dados.id) {
      return apiRequest(`/api/cadastros/transportadoras/${transportadoraId}/veiculos/${dados.id}`, {
        method: 'PUT',
        body: dados,
      })
    }
    return apiRequest(`/api/cadastros/transportadoras/${transportadoraId}/veiculos`, {
      method: 'POST',
      body: dados,
    })
  },

  async excluirVeiculoTransportadora(transportadoraId, veiculoId) {
    exigirApi('Veículos da Transportadora')
    return apiRequest(`/api/cadastros/transportadoras/${transportadoraId}/veiculos/${veiculoId}`, {
      method: 'DELETE',
    })
  },

  async listarRotas() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/cadastros/rotas')).data || []
  },

  async salvarRota(dados) {
    exigirApi('Rotas')
    if (dados.id) {
      return apiRequest(`/api/cadastros/rotas/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/rotas', { method: 'POST', body: dados })
  },

  async excluirRota(id) {
    exigirApi('Rotas')
    return apiRequest(`/api/cadastros/rotas/${id}`, { method: 'DELETE' })
  },

  // ── PARAMETROS COMERCIAIS & FISCAIS ───────────────────────────────────────
  async listarAuxiliares() {
    if (!isApiEnabled()) {
      return {
        formasPagamento: [],
        locaisCobranca: [],
        centrosCusto: [],
        naturezasOperacao: [],
        matrizTributaria: [],
        marchantes: [],
      }
    }
    return (await apiRequest('/api/cadastros/auxiliares')).data
  },

  async salvarFormaPagamento(dados) {
    exigirApi('Formas de Pagamento')
    if (dados.id) {
      return apiRequest(`/api/cadastros/formas-pagamento/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/formas-pagamento', { method: 'POST', body: dados })
  },

  async excluirFormaPagamento(id) {
    exigirApi('Formas de Pagamento')
    return apiRequest(`/api/cadastros/formas-pagamento/${id}`, { method: 'DELETE' })
  },

  async salvarLocalCobranca(dados) {
    exigirApi('Locais de Cobrança')
    if (dados.id) {
      return apiRequest(`/api/cadastros/locais-cobranca/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/locais-cobranca', { method: 'POST', body: dados })
  },

  async excluirLocalCobranca(id) {
    exigirApi('Locais de Cobrança')
    return apiRequest(`/api/cadastros/locais-cobranca/${id}`, { method: 'DELETE' })
  },

  async salvarCentroCusto(dados) {
    exigirApi('Centros de Custo')
    if (dados.id) {
      return apiRequest(`/api/cadastros/centros-custo/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/centros-custo', { method: 'POST', body: dados })
  },

  async excluirCentroCusto(id) {
    exigirApi('Centros de Custo')
    return apiRequest(`/api/cadastros/centros-custo/${id}`, { method: 'DELETE' })
  },

  async salvarNaturezaOperacao(dados) {
    exigirApi('Naturezas de Operação')
    if (dados.id) {
      return apiRequest(`/api/cadastros/naturezas-operacao/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/naturezas-operacao', { method: 'POST', body: dados })
  },

  async excluirNaturezaOperacao(id) {
    exigirApi('Naturezas de Operação')
    return apiRequest(`/api/cadastros/naturezas-operacao/${id}`, { method: 'DELETE' })
  },

  async criarMatrizTributaria(dados) {
    exigirApi('Matriz Tributária')
    return apiRequest('/api/cadastros/matriz-tributaria', { method: 'POST', body: dados })
  },

  async excluirMatrizTributaria(id) {
    exigirApi('Matriz Tributária')
    return apiRequest(`/api/cadastros/matriz-tributaria/${id}`, { method: 'DELETE' })
  },

  async salvarMarchante(dados) {
    exigirApi('Marchantes')
    if (dados.id) {
      return apiRequest(`/api/cadastros/marchantes/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/marchantes', { method: 'POST', body: dados })
  },

  async excluirMarchante(id) {
    exigirApi('Marchantes')
    return apiRequest(`/api/cadastros/marchantes/${id}`, { method: 'DELETE' })
  },

  async sugerirCfop({ tipo_movimento = 'SAIDA', finalidade = 'REVENDA', uf_parceiro } = {}) {
    if (!isApiEnabled()) return null
    const qs = buildQueryString({ tipo_movimento, finalidade, uf_parceiro })
    return (await apiRequest(`/api/cadastros/cfop-sugestao${qs}`)).data
  },

  // ── TIPOS DE VEÍCULO ──────────────────────────────────────────────────────
  async listarTiposVeiculo() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/cadastros/tipos-veiculo')).data || []
  },

  async salvarTipoVeiculo(dados) {
    exigirApi('Tipos de Veículo')
    if (dados.id) {
      return apiRequest(`/api/cadastros/tipos-veiculo/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/cadastros/tipos-veiculo', { method: 'POST', body: dados })
  },

  async excluirTipoVeiculo(id) {
    exigirApi('Tipos de Veículo')
    return apiRequest(`/api/cadastros/tipos-veiculo/${id}`, { method: 'DELETE' })
  },
}
