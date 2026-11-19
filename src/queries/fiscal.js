import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'

function exigirApi() {
  if (!isApiEnabled()) {
    throw new Error('O Módulo Fiscal exige o Backend API PostgreSQL ativo (VITE_API_URL).')
  }
}

export const fiscalQueries = {
  async obterConfig() {
    if (!isApiEnabled()) return null
    return (await apiRequest('/api/fiscal/config')).data
  },

  async salvarConfig(dados) {
    exigirApi()
    return apiRequest('/api/fiscal/config', { method: 'PUT', body: dados })
  },

  async enviarCertificadoA1(dados) {
    exigirApi()
    return apiRequest('/api/fiscal/config/certificado', { method: 'POST', body: dados })
  },

  async listarFilaEmissao() {
    if (!isApiEnabled()) return { pedidos: [], devolucoes: [] }
    return apiRequest('/api/fiscal/fila-pedidos')
  },

  async previewPedido(pedidoId, modelo = '55') {
    exigirApi()
    return apiRequest(`/api/fiscal/notas/preview-pedido/${pedidoId}`, {
      method: 'POST',
      body: { modelo },
    })
  },

  async emitirPedido(pedidoId, dados = {}) {
    exigirApi()
    return apiRequest(`/api/fiscal/notas/emitir-pedido/${pedidoId}`, {
      method: 'POST',
      body: dados,
    })
  },

  async emitirDevolucao(devolucaoId) {
    exigirApi()
    return apiRequest(`/api/fiscal/notas/emitir-devolucao/${devolucaoId}`, {
      method: 'POST',
      body: {},
    })
  },

  async emitirAvulsa(dados) {
    exigirApi()
    return apiRequest('/api/fiscal/notas/emitir-avulsa', {
      method: 'POST',
      body: dados,
    })
  },

  async listarNotas(filtros = {}) {
    if (!isApiEnabled()) return { resumo: {}, data: [] }
    const qs = buildQueryString(filtros)
    return apiRequest(`/api/fiscal/notas${qs}`)
  },

  async obterNota(id) {
    exigirApi()
    return (await apiRequest(`/api/fiscal/notas/${id}`)).data
  },

  async obterXmlNota(id) {
    exigirApi()
    return apiRequest(`/api/fiscal/notas/${id}/xml`)
  },

  async cancelarNota(id, motivo) {
    exigirApi()
    return apiRequest(`/api/fiscal/notas/${id}/cancelar`, {
      method: 'POST',
      body: { motivo },
    })
  },

  async emitirCartaCorrecao(id, texto_correcao) {
    exigirApi()
    return apiRequest(`/api/fiscal/notas/${id}/carta-correcao`, {
      method: 'POST',
      body: { texto_correcao },
    })
  },

  async listarEventos() {
    if (!isApiEnabled()) return []
    return (await apiRequest('/api/fiscal/eventos')).data || []
  },

  async inutilizarNumeracao(dados) {
    exigirApi()
    return apiRequest('/api/fiscal/inutilizacao', {
      method: 'POST',
      body: dados,
    })
  },

  async obterCofreXml(mes) {
    if (!isApiEnabled()) return { resumo: {}, arquivos: [] }
    const qs = buildQueryString({ mes })
    return apiRequest(`/api/fiscal/cofre-xml${qs}`)
  },
}
