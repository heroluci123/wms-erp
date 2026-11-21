import { apiRequest, buildQueryString } from '../lib/apiClient'

export const varejoQueries = {
  // ── ESTOQUE DA LOJA (1/1 — AÇOUGUE & EMPÓRIO) ───────────────────────────────
  listarEstoque: (params = {}) =>
    apiRequest(`/api/varejo/estoque${buildQueryString(params)}`),

  ajustarEstoque: (payload) =>
    apiRequest('/api/varejo/estoque/ajustar', { method: 'POST', body: payload }),

  listarMovimentacoes: () =>
    apiRequest('/api/varejo/movimentacoes'),

  // ── INVENTÁRIO RÁPIDO DO VAREJO ─────────────────────────────────────────────
  listarInventarios: () =>
    apiRequest('/api/varejo/inventarios'),

  criarInventario: (payload) =>
    apiRequest('/api/varejo/inventarios', { method: 'POST', body: payload }),

  salvarContagemInventario: (id, itens) =>
    apiRequest(`/api/varejo/inventarios/${id}/contagem`, { method: 'PUT', body: { itens } }),

  finalizarInventario: (id) =>
    apiRequest(`/api/varejo/inventarios/${id}/finalizar`, { method: 'POST', body: {} }),

  // ── PDV FRENTE DE CAIXA ─────────────────────────────────────────────────────
  obterCaixaAtual: () =>
    apiRequest('/api/pdv/caixa-atual'),

  listarCaixas: () =>
    apiRequest('/api/pdv/caixas'),

  abrirCaixa: (payload) =>
    apiRequest('/api/pdv/caixa/abrir', { method: 'POST', body: payload }),

  registrarMovimentoCaixa: (caixaId, payload) =>
    apiRequest(`/api/pdv/caixa/${caixaId}/movimento`, { method: 'POST', body: payload }),

  fecharCaixa: (caixaId, payload) =>
    apiRequest(`/api/pdv/caixa/${caixaId}/fechar`, { method: 'POST', body: payload }),

  buscarCodigoPdv: (q) =>
    apiRequest(`/api/pdv/buscar-codigo${buildQueryString({ q })}`),

  finalizarVendaPdv: (payload) =>
    apiRequest('/api/pdv/vendas', { method: 'POST', body: payload }),

  cancelarVendaPdv: (vendaId, motivo = '') =>
    apiRequest(`/api/pdv/vendas/${vendaId}/cancelar`, { method: 'POST', body: { motivo } }),
}

export const interunidadesQueries = {
  obterMapaFiliais: () =>
    apiRequest('/api/interunidades/filiais-mapa'),

  listarMovimentacoes: (params = {}) =>
    apiRequest(`/api/interunidades/movimentacoes${buildQueryString(params)}`),

  biparTransferenciaLoja: (payload) =>
    apiRequest('/api/interunidades/bipar-transferencia-loja', { method: 'POST', body: payload }),

  biparRemessaIndustrializacao: (payload) =>
    apiRequest('/api/interunidades/bipar-remessa-industrializacao', { method: 'POST', body: payload }),

  biparRetornoProducao: (payload) =>
    apiRequest('/api/interunidades/bipar-retorno-producao', { method: 'POST', body: payload }),

  editarMovimentacao: (id, payload) =>
    apiRequest(`/api/interunidades/movimentacoes/${id}`, { method: 'PATCH', body: payload }),

  obterFaturamentoDiario: (params = {}) =>
    apiRequest(`/api/interunidades/faturamento-diario${buildQueryString(params)}`),

  emitirFaturamentoDiario: (lotes) =>
    apiRequest('/api/interunidades/faturamento-diario/emitir', { method: 'POST', body: { lotes } }),
}

export const insumosQueries = {
  listarEstoque: (params = {}) =>
    apiRequest(`/api/insumos/estoque${buildQueryString(params)}`),

  salvarEnderecoInsumo: (payload) =>
    apiRequest('/api/insumos/estoque', { method: 'POST', body: payload }),

  buscarPorEndereco: (endereco) =>
    apiRequest(`/api/insumos/buscar-endereco${buildQueryString({ endereco })}`),

  registrarColeta: (payload) =>
    apiRequest('/api/insumos/coletar', { method: 'POST', body: payload }),

  registrarEntradaManual: (payload) =>
    apiRequest('/api/insumos/entrada-manual', { method: 'POST', body: payload }),

  listarColetas: () =>
    apiRequest('/api/insumos/coletas'),
}
