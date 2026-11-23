import { apiRequest, buildQueryString } from '../lib/apiClient'

export const varejoQueries = {
  // ── ESTOQUE DO VAREJO (AÇOUGUE & EMPÓRIO) ───────────────────────────────────
  listarEstoque: (params = {}) =>
    apiRequest(`/api/varejo/estoque${buildQueryString(params)}`),

  ajustarEstoque: (payload) =>
    apiRequest('/api/varejo/estoque/ajustar', { method: 'POST', body: payload }),

  entradaEmporio: (payload) =>
    apiRequest('/api/varejo/emporio/entrada', { method: 'POST', body: payload }),

  listarMovimentacoes: () =>
    apiRequest('/api/varejo/movimentacoes'),

  // ── INVENTÁRIO VAREJO & AÇOUGUE (EMPÓRIO CEGO + AÇOUGUE BIPADO) ─────────────
  listarInventarios: (params = {}) =>
    apiRequest(`/api/varejo/inventarios${buildQueryString(params)}`),

  criarInventario: (payload) =>
    apiRequest('/api/varejo/inventarios', { method: 'POST', body: payload }),

  liberarInventario: (id, liberado_operador) =>
    apiRequest(`/api/varejo/inventarios/${id}/liberar`, { method: 'PUT', body: { liberado_operador } }),

  salvarContagemInventario: (id, itens) =>
    apiRequest(`/api/varejo/inventarios/${id}/contagem`, { method: 'PUT', body: { itens } }),

  biparEtiquetaInventario: (id, codigo) =>
    apiRequest(`/api/varejo/inventarios/${id}/bipar-etiqueta`, { method: 'POST', body: { codigo } }),

  pesarMpInventario: (id, payload) =>
    apiRequest(`/api/varejo/inventarios/${id}/pesar-mp`, { method: 'POST', body: payload }),

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

  buscarCodigoPdv: (q, clienteId = null) =>
    apiRequest(`/api/pdv/buscar-codigo${buildQueryString({ q, ...(clienteId ? { cliente_id: clienteId } : {}) })}`),

  gerarPixPdv: (payload) =>
    apiRequest('/api/pdv/gerar-pix', { method: 'POST', body: payload }),

  obterCrediarioCliente: (clienteId) =>
    apiRequest(`/api/pdv/crediario/cliente/${clienteId}`),

  receberCrediario: (payload) =>
    apiRequest('/api/pdv/crediario/receber', { method: 'POST', body: payload }),

  finalizarVendaPdv: (payload) =>
    apiRequest('/api/pdv/vendas', { method: 'POST', body: payload }),

  cancelarVendaPdv: (vendaId, motivo = '') =>
    apiRequest(`/api/pdv/vendas/${vendaId}/cancelar`, { method: 'POST', body: { motivo } }),
}

export const acougueQueries = {
  obterGerenciador: (params = {}) =>
    apiRequest(`/api/acougue/gerenciador${buildQueryString(params)}`),

  darEntradaMp: (codigo) =>
    apiRequest('/api/acougue/entrada-mp', { method: 'POST', body: { ean_caixa: codigo, codigo } }),

  encerrarMp: (caixaId, motivo = '') =>
    apiRequest(`/api/acougue/mp/${caixaId}/encerrar`, { method: 'POST', body: { motivo } }),

  listarProdutosPesagem: (params = {}) =>
    apiRequest(`/api/acougue/produtos-pesagem${buildQueryString(params)}`),

  listarEtiquetasDia: (params = {}) =>
    apiRequest(`/api/acougue/etiquetas-dia${buildQueryString(params)}`),

  obterTabelaAtiva: () =>
    apiRequest('/api/acougue/tabela-ativa'),

  trocarTabelaAtiva: (payload) =>
    apiRequest('/api/acougue/trocar-tabela', { method: 'POST', body: payload }),

  pesarEtiqueta: (payload) =>
    apiRequest('/api/acougue/pesar-etiqueta', { method: 'POST', body: payload }),

  cancelarEtiqueta: (id) =>
    apiRequest(`/api/acougue/etiquetas/${id}/cancelar`, { method: 'POST', body: {} }),
}

export const precosQueries = {
  listarTabelas: (params = {}) =>
    apiRequest(`/api/tabelas-preco${buildQueryString(params)}`),

  obterTabela: (id, params = {}) =>
    apiRequest(`/api/tabelas-preco/${id}${buildQueryString(params)}`),

  criarTabela: (payload) =>
    apiRequest('/api/tabelas-preco', { method: 'POST', body: payload }),

  atualizarTabela: (id, payload) =>
    apiRequest(`/api/tabelas-preco/${id}`, { method: 'PUT', body: payload }),

  excluirTabela: (id) =>
    apiRequest(`/api/tabelas-preco/${id}`, { method: 'DELETE' }),

  salvarItens: (id, itens) =>
    apiRequest(`/api/tabelas-preco/${id}/itens`, { method: 'POST', body: { itens } }),

  removerItem: (id, produtoId) =>
    apiRequest(`/api/tabelas-preco/${id}/itens/${produtoId}`, { method: 'DELETE' }),

  aplicarReajuste: (id, payload) =>
    apiRequest(`/api/tabelas-preco/${id}/aplicar-reajuste`, { method: 'POST', body: payload }),
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
