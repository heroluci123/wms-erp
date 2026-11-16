import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient.js'

const msgModoApi = 'Mapa de Produção e Árvore Auto-Aprendiz completos disponíveis no modo ERP Central (API PostgreSQL).'

export const mapaProducaoQueries = {
  async buscarDemandaPedidos({ data_inicio = '', data_fim = '', grupo = '', incluir_rascunho = false } = {}) {
    if (!isApiEnabled()) {
      return { cortes: [], totalDeficitCortesKg: 0, totalMpNecessariaKg: 0 }
    }
    return apiRequest(
      `/api/mapas-producao/demanda-pedidos${buildQueryString({
        data_inicio,
        data_fim,
        grupo,
        incluir_rascunho: incluir_rascunho ? 'true' : undefined,
      })}`,
    )
  },

  async listarMapas() {
    if (!isApiEnabled()) return []
    const res = await apiRequest('/api/mapas-producao')
    return res.data || []
  },

  async obterMapa(id) {
    if (!isApiEnabled()) return null
    const res = await apiRequest(`/api/mapas-producao/${id}`)
    return res.data || null
  },

  async criarMapa(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/mapas-producao', {
      method: 'POST',
      body: payload,
    })
  },

  async gerarOpsDoMapa(mapaId, payload = { agrupar_por: 'MP' }) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/gerar-ops`, {
      method: 'POST',
      body: payload,
    })
  },

  async listarArvore() {
    if (!isApiEnabled()) return []
    const res = await apiRequest('/api/arvore-produtos')
    return res.data || []
  },

  async salvarVinculoArvore(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/arvore-produtos', {
      method: 'POST',
      body: payload,
    })
  },

  async confirmarVinculoArvore(id, payload = {}) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/arvore-produtos/${id}/confirmar`, {
      method: 'POST',
      body: payload,
    })
  },

  async removerVinculoArvore(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/arvore-produtos/${id}`, { method: 'DELETE' })
  },
}
