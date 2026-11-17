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

  // ── LAYOUTS TXT, DE-PARA, XML NF-E, PRÉ-CAIXAS DOCA ───────────────────────
  async listarLayoutsTxt() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/compras/layouts-txt')).data || []
  },

  async salvarLayoutTxt(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/compras/layouts-txt', { method: 'POST', body: payload })
  },

  async excluirLayoutTxt(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/compras/layouts-txt/${id}`, { method: 'DELETE' })
  },

  async listarDepara(fornecedorId = null) {
    if (!isApiEnabled()) return []
    return (await apiRequest(`/api/compras/depara${buildQueryString({ fornecedor_id: fornecedorId || undefined })}`)).data || []
  },

  async salvarDepara(fornecedorId, vinculos) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/compras/depara', {
      method: 'POST',
      body: { fornecedor_id: fornecedorId, vinculos },
    })
  },

  async excluirDepara(id) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest(`/api/compras/depara/${id}`, { method: 'DELETE' })
  },

  async previewXmlNfe(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/compras/xml/parse-preview', { method: 'POST', body: payload })
  },

  async previewTxtLote(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/compras/txt/parse-preview', { method: 'POST', body: payload })
  },

  async importarLoteEntrada(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/compras/importar-lote', { method: 'POST', body: payload })
  },

  async listarPreCaixasRecebimento(params = {}) {
    if (!isApiEnabled()) return { resumo: { total: 0, pendentes: 0, bipadas: 0 }, data: [] }
    return apiRequest(`/api/recebimento/pre-caixas${buildQueryString(params)}`)
  },

  async biparPreCaixa(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/recebimento/bipar-pre-caixa', { method: 'POST', body: payload })
  },

  async confirmarPreCaixasLote(payload) {
    if (!isApiEnabled()) throw new Error(msgModoApi)
    return apiRequest('/api/recebimento/confirmar-pre-caixas-lote', { method: 'POST', body: payload })
  },
}
