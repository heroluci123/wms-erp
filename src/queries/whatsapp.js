import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

export const whatsappQueries = {
  async parsePreview({ remetente_phone = '', remetente_nome = '', mensagem_bruta }) {
    if (!isApiEnabled()) {
      throw new Error('O Parser de WhatsApp requer o Backend PostgreSQL (VITE_API_URL).')
    }
    return (
      await apiRequest('/api/whatsapp/parse', {
        method: 'POST',
        body: { remetente_phone, remetente_nome, mensagem_bruta },
      })
    ).data
  },

  async listarInbox({ status = 'PENDENTE' } = {}) {
    if (!isApiEnabled()) return []
    return (await apiRequest(`/api/whatsapp/inbox${buildQueryString({ status })}`)).data || []
  },

  async criarInbox({ remetente_phone = '', remetente_nome = '', mensagem_bruta }) {
    if (!isApiEnabled()) {
      throw new Error('Entrada WhatsApp requer o Backend PostgreSQL (VITE_API_URL).')
    }
    return apiRequest('/api/whatsapp/inbox', {
      method: 'POST',
      body: { remetente_phone, remetente_nome, mensagem_bruta },
    })
  },

  async converterEmPedido(id, dados = {}) {
    if (!isApiEnabled()) {
      throw new Error('Conversão WhatsApp → Pedido requer o Backend PostgreSQL (VITE_API_URL).')
    }
    return apiRequest(`/api/whatsapp/inbox/${id}/converter-pedido`, {
      method: 'POST',
      body: dados,
    })
  },

  async ignorar(id) {
    if (!isApiEnabled()) {
      throw new Error('Requer Backend PostgreSQL (VITE_API_URL).')
    }
    return apiRequest(`/api/whatsapp/inbox/${id}/ignorar`, { method: 'PATCH' })
  },
}
