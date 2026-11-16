import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient.js'

const msgModoApi = 'Módulo de Pedidos de Compra completo disponível no modo ERP Central (API PostgreSQL).'

export const comprasQueries = {
  async obterConfigModulos() {
    if (!isApiEnabled()) {
      return {
        trava_recebimento_sem_pc: false,
        rastreio_motorista_ativo: false,
        impressao_romaneio_padrao: 'OPCAO_B',
      }
    }
    const res = await apiRequest('/api/configuracoes/modulos')
    return res.data || {}
  },

  async salvarConfigModulos(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/configuracoes/modulos', {
      method: 'PATCH',
      body: payload,
    })
  },

  async listarCompras({ status = 'TODOS', busca = '' } = {}) {
    if (!isApiEnabled()) {
      return { data: [], trava_recebimento_sem_pc: false }
    }
    return apiRequest(`/api/compras${buildQueryString({ status, busca })}`)
  },

  async obterCompra(id) {
    if (!isApiEnabled()) return null
    const res = await apiRequest(`/api/compras/${id}`)
    return res.data || null
  },

  async listarPedidosLiberadosParaDoca() {
    if (!isApiEnabled()) {
      return { data: [], trava_recebimento_sem_pc: false }
    }
    return apiRequest('/api/recebimento/pedidos-liberados')
  },

  async criarCompra(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/compras', {
      method: 'POST',
      body: payload,
    })
  },

  async aprovarCompra(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/compras/${id}/aprovar`, { method: 'POST' })
  },

  async cancelarCompra(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/compras/${id}/cancelar`, { method: 'POST' })
  },

  async enviarParaValidacao(id, payload = {}) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/compras/${id}/enviar-validacao`, {
      method: 'POST',
      body: payload,
    })
  },

  async validarSistemica(id, payload = {}) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/compras/${id}/validar-sistemica`, {
      method: 'POST',
      body: payload,
    })
  },
}
