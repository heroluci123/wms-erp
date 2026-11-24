import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

export const governancaQueries = {
  // Cotações (RFQ)
  async listarCotacoes(status = 'TODAS') {
    if (!isApiEnabled()) return []
    return (await apiRequest(`/api/governanca/cotacoes${buildQueryString({ status })}`)).data || []
  },
  async obterCotacao(id) {
    return (await apiRequest(`/api/governanca/cotacoes/${id}`)).data
  },
  async criarCotacao(payload) {
    return await apiRequest('/api/governanca/cotacoes', { method: 'POST', body: payload })
  },
  async salvarPropostas(cotacaoId, payload) {
    return await apiRequest(`/api/governanca/cotacoes/${cotacaoId}/propostas`, {
      method: 'POST',
      body: payload,
    })
  },
  async selecionarVencedor(cotacaoId, payload) {
    return await apiRequest(`/api/governanca/cotacoes/${cotacaoId}/selecionar-vencedor`, {
      method: 'POST',
      body: payload,
    })
  },
  async gerarPedidosCotacao(cotacaoId, payload = { aprovar_automaticamente: true }) {
    return await apiRequest(`/api/governanca/cotacoes/${cotacaoId}/gerar-pedidos`, {
      method: 'POST',
      body: payload,
    })
  },
  async excluirCotacao(cotacaoId) {
    return await apiRequest(`/api/governanca/cotacoes/${cotacaoId}`, { method: 'DELETE' })
  },

  // Score de Fornecedores
  async obterScoreFornecedores(dias = 90) {
    if (!isApiEnabled()) return { data: [], periodo_dias: dias }
    return await apiRequest(`/api/governanca/score-fornecedores${buildQueryString({ dias })}`)
  },

  // Monitor FEFO & Perdas
  async obterMonitorFefo(dias_alerta = 15) {
    if (!isApiEnabled()) return { data: [], resumo: {} }
    return await apiRequest(`/api/governanca/fefo-perdas${buildQueryString({ dias_alerta })}`)
  },
  async aplicarPromocaoFefo(payload) {
    return await apiRequest('/api/governanca/fefo/aplicar-promocao', { method: 'POST', body: payload })
  },
  async baixarPerda(payload) {
    return await apiRequest('/api/governanca/fefo/baixar-perda', { method: 'POST', body: payload })
  },
  async listarPerdas(mes) {
    if (!isApiEnabled()) return { data: [], resumo: {} }
    return await apiRequest(`/api/governanca/perdas${buildQueryString({ mes })}`)
  },

  // Radar Antifraude & Auditoria
  async obterRadarAntifraude(dias = 30) {
    if (!isApiEnabled()) return { eventos: [], resumo: {}, ranking_operadores: [] }
    return await apiRequest(`/api/governanca/antifraude${buildQueryString({ dias })}`)
  },

  // Reforço 6B — Loss Prevention: Furo de Rendimento, Etiquetas Fantasma & Cadeia de Frio
  async obterAuditoriaRendimento(params = {}) {
    if (!isApiEnabled()) return { ops: [], acougue: [], resumo: {} }
    return await apiRequest(`/api/governanca/loss-prevention/rendimento${buildQueryString(params)}`)
  },
  async obterEtiquetasFantasma(params = {}) {
    if (!isApiEnabled()) return { fantasmas: [], subfaturadas: [], ranking_operadores: [], resumo: {} }
    return await apiRequest(`/api/governanca/loss-prevention/etiquetas-fantasma${buildQueryString(params)}`)
  },
  async listarTemperatura(dias = 7) {
    if (!isApiEnabled()) return { semaforo_locais: [], historico: [], resumo: {}, faixas_padrao: {} }
    return await apiRequest(`/api/governanca/temperatura${buildQueryString({ dias })}`)
  },
  async registrarTemperatura(payload) {
    return await apiRequest('/api/governanca/temperatura', { method: 'POST', body: payload })
  },
}
