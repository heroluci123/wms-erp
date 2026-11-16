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

  async listarItensPedidosDisponiveis({ previsao_entrega = '', q = '', mapa_id = '' } = {}) {
    if (!isApiEnabled()) {
      return { datasDisponiveis: [], gruposProduto: [] }
    }
    return apiRequest(
      `/api/mapas-producao/itens-pedidos-disponiveis${buildQueryString({
        previsao_entrega,
        q,
        mapa_id,
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

  async atualizarMapa(id, payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${id}`, {
      method: 'PUT',
      body: payload,
    })
  },

  async excluirMapa(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${id}`, { method: 'DELETE' })
  },

  async adicionarItensMapa(mapaId, itens) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/itens`, {
      method: 'POST',
      body: { itens },
    })
  },

  async atualizarItemMapa(mapaId, itemId, payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/itens/${itemId}`, {
      method: 'PUT',
      body: payload,
    })
  },

  async removerItemMapa(mapaId, itemId) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/itens/${itemId}`, { method: 'DELETE' })
  },

  async aplicarEspecificacoesMapa(mapaId) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/aplicar-especificacoes`, {
      method: 'POST',
      body: {},
    })
  },

  async gerarOpsDoMapa(mapaId, payload = { agrupar_por: 'MP' }) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/gerar-ops`, {
      method: 'POST',
      body: payload,
    })
  },

  async listarEspecificacoesMapa() {
    if (!isApiEnabled()) return []
    const res = await apiRequest('/api/mapas-producao/especificacoes')
    return res.data || []
  },

  async salvarEspecificacaoMapa(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/mapas-producao/especificacoes', {
      method: 'POST',
      body: payload,
    })
  },

  async excluirEspecificacaoMapa(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/especificacoes/${id}`, { method: 'DELETE' })
  },

  async listarProgramacaoSemanal({ dia_semana = '' } = {}) {
    if (!isApiEnabled()) return []
    const res = await apiRequest(
      `/api/mapas-producao/programacao-semanal${buildQueryString({ dia_semana })}`,
    )
    return res.data || []
  },

  async salvarProgramacaoSemanal(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/mapas-producao/programacao-semanal', {
      method: 'POST',
      body: payload,
    })
  },

  async excluirProgramacaoSemanal(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/programacao-semanal/${id}`, { method: 'DELETE' })
  },

  async importarSemanalMapa(mapaId, dia_semana) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/mapas-producao/${mapaId}/importar-semanal`, {
      method: 'POST',
      body: { dia_semana },
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
