import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

export const comercialQueries = {
  async obterConfig() {
    if (!isApiEnabled()) return null
    return (await apiRequest('/api/comercial/config')).data
  },

  async obterResumoVendedor(params = {}) {
    if (!isApiEnabled()) return null
    const qs = buildQueryString(params)
    return await apiRequest(`/api/comercial/resumo-vendedor${qs}`)
  },

  async obterCatalogoCliente(clienteId, params = {}) {
    if (!isApiEnabled()) return null
    const qs = buildQueryString(params)
    return await apiRequest(`/api/comercial/catalogo-cliente/${clienteId}${qs}`)
  },

  async simularMargem(payload) {
    if (!isApiEnabled()) return null
    return (
      await apiRequest('/api/comercial/simular-margem', {
        method: 'POST',
        body: payload,
      })
    ).data
  },

  async listarAprovacoes(status = 'PENDENTES') {
    if (!isApiEnabled()) return { data: [], is_gestor: false }
    const qs = buildQueryString({ status })
    return await apiRequest(`/api/comercial/aprovacoes${qs}`)
  },

  async aprovarPedidoComercial(pedidoId, payload = {}) {
    return await apiRequest(`/api/comercial/pedidos/${pedidoId}/aprovar`, {
      method: 'POST',
      body: payload,
    })
  },

  async rejeitarPedidoComercial(pedidoId, payload = {}) {
    return await apiRequest(`/api/comercial/pedidos/${pedidoId}/rejeitar`, {
      method: 'POST',
      body: payload,
    })
  },

  async listarVisitas(params = {}) {
    if (!isApiEnabled()) return []
    const qs = buildQueryString(params)
    return (await apiRequest(`/api/comercial/visitas${qs}`)).data || []
  },

  async registrarVisita(payload) {
    return await apiRequest('/api/comercial/visitas', {
      method: 'POST',
      body: payload,
    })
  },
}
