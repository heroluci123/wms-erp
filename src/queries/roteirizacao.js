import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

function requireApi() {
  if (!isApiEnabled()) {
    throw new Error('A Central de Roteirização e Rastreio requer conexão com o servidor API (PostgreSQL).')
  }
}

export const roteirizacaoQueries = {
  async listarEmbarques(statusGrupo = 'ABERTO') {
    if (!isApiEnabled()) return { data: [], config: { rastreio_motorista_ativo: true, impressao_romaneio_padrao: 'OPCAO_B' } }
    return await apiRequest(`/api/roteirizacao/embarques${buildQueryString({ status_grupo: statusGrupo })}`)
  },

  async listarPedidosDisponiveis(opts = null) {
    requireApi()
    const params =
      opts && typeof opts === 'object'
        ? { embarque_id: opts.embarque_id || undefined, data_embarque: opts.data_embarque || undefined }
        : { embarque_id: opts || undefined }
    return (await apiRequest(`/api/roteirizacao/pedidos-disponiveis${buildQueryString(params)}`)).data
  },

  async criarEmbarque(payload) {
    requireApi()
    return await apiRequest('/api/roteirizacao/embarques', { method: 'POST', body: payload })
  },

  async detalhesEmbarque(id) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${id}`)
  },

  async atualizarEmbarque(id, payload) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${id}`, { method: 'PUT', body: payload })
  },

  async excluirEmbarque(id) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${id}`, { method: 'DELETE' })
  },

  async adicionarParadas(embarqueId, pedidoIds) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/paradas`, {
      method: 'POST',
      body: { pedido_ids: pedidoIds },
    })
  },

  async removerParada(embarqueId, pedidoId) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/paradas/${pedidoId}`, {
      method: 'DELETE',
    })
  },

  async reordenarParadas(embarqueId, pedidoIdsOrdenados) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/reordenar`, {
      method: 'PUT',
      body: { pedido_ids_ordenados: pedidoIdsOrdenados },
    })
  },

  async carregarCaixa(embarqueId, eanCaixa, temperaturaBau = null) {
    requireApi()
    const body = { ean_caixa: eanCaixa }
    if (temperaturaBau !== null && temperaturaBau !== undefined && String(temperaturaBau).trim() !== '') {
      body.temperatura_bau = temperaturaBau
    }
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/carregar-caixa`, {
      method: 'POST',
      body,
    })
  },

  async atualizarTemperaturaBau(embarqueId, temperaturaBau) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/temperatura`, {
      method: 'PATCH',
      body: { temperatura_bau: temperaturaBau },
    })
  },

  async estornarCarregamento(embarqueId, itemId) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/estornar-carregamento/${itemId}`, {
      method: 'POST',
      body: {},
    })
  },

  async despacharEmbarque(embarqueId, payload = {}) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/despachar`, {
      method: 'POST',
      body: payload,
    })
  },

  async atualizarStatusParada(embarqueId, pedidoId, payload) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/paradas/${pedidoId}/status`, {
      method: 'POST',
      body: payload,
    })
  },

  async finalizarRota(embarqueId) {
    requireApi()
    return await apiRequest(`/api/roteirizacao/embarques/${embarqueId}/finalizar`, {
      method: 'POST',
      body: {},
    })
  },

  async salvarConfigModulos(payload) {
    requireApi()
    return await apiRequest('/api/configuracoes/modulos', { method: 'PATCH', body: payload })
  },

  // Rotas públicas (QR Code motorista e rastreio do cliente)
  async obterRotaPublica(qrToken) {
    requireApi()
    return await apiRequest(`/api/public/rastreio/${encodeURIComponent(qrToken)}`, { skipAuth: true })
  },

  async iniciarRotaPublica(qrToken, payload) {
    requireApi()
    return await apiRequest(`/api/public/rastreio/${encodeURIComponent(qrToken)}/iniciar`, {
      method: 'POST',
      body: payload,
      skipAuth: true,
    })
  },

  async atualizarParadaPublica(qrToken, pedidoId, payload) {
    requireApi()
    return await apiRequest(`/api/public/rastreio/${encodeURIComponent(qrToken)}/paradas/${pedidoId}`, {
      method: 'POST',
      body: payload,
      skipAuth: true,
    })
  },

  async obterPedidoPublico(rastreioToken) {
    requireApi()
    return await apiRequest(`/api/public/pedido/${encodeURIComponent(rastreioToken)}`, { skipAuth: true })
  },
}
