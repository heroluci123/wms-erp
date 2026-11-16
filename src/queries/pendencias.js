import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

export const pendenciasQueries = {
  async listar({ setor = 'TODOS', status = 'ATIVAS' } = {}) {
    if (!isApiEnabled()) {
      return {
        contadores: {
          SUPPLY_CHAIN: 0,
          PCP: 0,
          CAMARA_FRIA: 0,
          LOGISTICA: 0,
          FATURAMENTO: 0,
          FINANCEIRO: 0,
          TOTAL_ATIVAS: 0,
        },
        data: [],
      }
    }
    return apiRequest(`/api/pendencias${buildQueryString({ setor, status })}`)
  },

  async criar(dados) {
    if (!isApiEnabled()) {
      throw new Error('Pendências por setor requer o Backend API PostgreSQL ativo.')
    }
    return apiRequest('/api/pendencias', { method: 'POST', body: dados })
  },

  async atualizarStatus(id, status) {
    if (!isApiEnabled()) {
      throw new Error('Pendências por setor requer o Backend API PostgreSQL ativo.')
    }
    return apiRequest(`/api/pendencias/${id}/status`, {
      method: 'PATCH',
      body: { status },
    })
  },
}
