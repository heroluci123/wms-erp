import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

function exigirApi() {
  if (!isApiEnabled()) {
    throw new Error('O módulo Financeiro exige o Backend API PostgreSQL ativo (VITE_API_URL).')
  }
}

export const financeiroQueries = {
  async obterDashboard(diasProjecao = 30) {
    if (!isApiEnabled()) return null
    const qs = buildQueryString({ dias_projecao: diasProjecao })
    return (await apiRequest(`/api/financeiro/dashboard${qs}`)).data
  },

  async listarContas() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/financeiro/contas')).data || []
  },

  async salvarConta(dados) {
    exigirApi()
    if (dados.id) {
      return apiRequest(`/api/financeiro/contas/${dados.id}`, { method: 'PUT', body: dados })
    }
    return apiRequest('/api/financeiro/contas', { method: 'POST', body: dados })
  },

  async desativarConta(id) {
    exigirApi()
    return apiRequest(`/api/financeiro/contas/${id}`, { method: 'DELETE' })
  },

  async listarTitulos(filtros = {}) {
    if (!isApiEnabled()) return { resumo: {}, data: [] }
    const qs = buildQueryString(filtros)
    return apiRequest(`/api/financeiro/titulos${qs}`)
  },

  async criarTitulo(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/titulos', { method: 'POST', body: dados })
  },

  async atualizarTitulo(id, dados) {
    exigirApi()
    return apiRequest(`/api/financeiro/titulos/${id}`, { method: 'PUT', body: dados })
  },

  async baixarTitulo(id, dados) {
    exigirApi()
    return apiRequest(`/api/financeiro/titulos/${id}/baixar`, { method: 'POST', body: dados })
  },

  async baixarLote(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/titulos/baixar-lote', { method: 'POST', body: dados })
  },

  async previewOfx(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/ofx/preview', { method: 'POST', body: dados })
  },

  async conciliarOfx(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/ofx/conciliar', { method: 'POST', body: dados })
  },

  async estornarTitulo(id, motivo = '') {
    exigirApi()
    return apiRequest(`/api/financeiro/titulos/${id}/estornar`, { method: 'POST', body: { motivo } })
  },

  async cancelarTitulo(id, motivo = '') {
    exigirApi()
    return apiRequest(`/api/financeiro/titulos/${id}/cancelar`, { method: 'POST', body: { motivo } })
  },

  async listarMovimentacoes(filtros = {}) {
    if (!isApiEnabled()) return { resumo: {}, data: [] }
    const qs = buildQueryString(filtros)
    return apiRequest(`/api/financeiro/movimentacoes${qs}`)
  },

  async criarMovimentacao(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/movimentacoes', { method: 'POST', body: dados })
  },

  async transferirEntreContas(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/transferencias', { method: 'POST', body: dados })
  },

  async sincronizarOperacional() {
    exigirApi()
    return apiRequest('/api/financeiro/sincronizar-operacional', { method: 'POST', body: {} })
  },

  async listarInadimplencia() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/financeiro/inadimplencia')).data || []
  },

  async alternarBloqueioCliente(clienteId, bloqueado) {
    exigirApi()
    return apiRequest(`/api/financeiro/clientes/${clienteId}/bloqueio`, {
      method: 'POST',
      body: { bloqueado: Boolean(bloqueado) },
    })
  },

  async apurarComissoes(filtros = {}) {
    if (!isApiEnabled()) return { periodo: {}, data: [] }
    const qs = buildQueryString(filtros)
    return apiRequest(`/api/financeiro/comissoes${qs}`)
  },

  async gerarPagarComissao(dados) {
    exigirApi()
    return apiRequest('/api/financeiro/comissoes/gerar-pagar', { method: 'POST', body: dados })
  },

  async obterDre(filtros = {}) {
    if (!isApiEnabled()) return null
    const qs = buildQueryString(filtros)
    return apiRequest(`/api/financeiro/dre${qs}`)
  },

  async obterRentabilidade(filtros = {}) {
    if (!isApiEnabled()) return null
    const qs = buildQueryString(filtros)
    return apiRequest(`/api/financeiro/rentabilidade${qs}`)
  },

  async obterAnaliseCustosDesossa(filtros = {}) {
    if (!isApiEnabled()) return { ops: [], ranking_fornecedores: [] }
    const qs = buildQueryString(filtros)
    return (await apiRequest(`/api/ops/analise-custos${qs}`)).data || { ops: [], ranking_fornecedores: [] }
  },
}
