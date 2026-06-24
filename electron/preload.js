const { contextBridge, ipcRenderer } = require('electron')

// Bridge segura entre o processo renderer (React) e o main (Node/Electron)
// Expõe apenas as funções necessárias, sem acesso direto ao Node
contextBridge.exposeInMainWorld('wmsAPI', {
  // ── Controles da Janela ──────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
  },

  // ── Banco de Dados ───────────────────────────────────────────────────────
  db: {
    getPath: () => ipcRenderer.invoke('db:get-path'),
  },

  // ── Exportação ───────────────────────────────────────────────────────────
  export: {
    csv: (filename, content) => ipcRenderer.invoke('export:csv', { filename, content }),
  },

  // ── Produtos ─────────────────────────────────────────────────────────────
  produtos: {
    listar: () => ipcRenderer.invoke('produtos:listar'),
    buscarPorCodigo: (codigo) => ipcRenderer.invoke('produtos:buscar-por-codigo', codigo),
    criar: (dados) => ipcRenderer.invoke('produtos:criar', dados),
    atualizar: (dados) => ipcRenderer.invoke('produtos:atualizar', dados),
    deletar: (id) => ipcRenderer.invoke('produtos:deletar', id),
  },

  // ── Estoque ──────────────────────────────────────────────────────────────
  estoque: {
    listarGeral: () => ipcRenderer.invoke('estoque:listar-geral'),
    buscarPorEnderecoProduto: (endereco, produto_id) =>
      ipcRenderer.invoke('estoque:buscar-por-endereco-produto', { endereco, produto_id }),
    buscarPorEndereco: (endereco) => ipcRenderer.invoke('estoque:buscar-por-endereco', endereco),
    sugestaoPutaway: (produto_id, lote) =>
      ipcRenderer.invoke('estoque:sugestao-putaway', { produto_id, lote }),
    verificarFEFO: (produto_id, validade) =>
      ipcRenderer.invoke('estoque:verificar-fefo', { produto_id, validade }),
    kpis: (filtros) => ipcRenderer.invoke('estoque:kpis', filtros),
  },

  // ── Movimentações ────────────────────────────────────────────────────────
  movimentacoes: {
    transferir: (dados) => ipcRenderer.invoke('movimentacoes:transferir', dados),
    receber: (dados) => ipcRenderer.invoke('movimentacoes:receber', dados),
    confirmarDespacho: (produto_id, lote, operador_id) =>
      ipcRenderer.invoke('movimentacoes:confirmar-despacho', { produto_id, lote, operador_id }),
    listarLog: (filtros) => ipcRenderer.invoke('movimentacoes:listar-log', filtros),
    listarExpedicao: () => ipcRenderer.invoke('expedicao:listar'),
    estornarExpedicao: (dados) => ipcRenderer.invoke('expedicao:estornar', dados),
    enviarParaExpedicao: (dados) => ipcRenderer.invoke('expedicao:enviar', dados),
    relatorioExecutivo: (filtros) => ipcRenderer.invoke('movimentacoes:relatorio-executivo', filtros),
    deletarLog: (id) => ipcRenderer.invoke('movimentacoes:deletar-log', id),
  },

  // ── Inventários ──────────────────────────────────────────────────────────
  inventarios: {
    // Ciclos
    ciclosListar: () => ipcRenderer.invoke('inventarios:ciclos-listar'),
    ciclosBuscarAtivo: () => ipcRenderer.invoke('inventarios:ciclos-buscar-ativo'),
    ciclosCriar: (dados) => ipcRenderer.invoke('inventarios:ciclos-criar', dados),
    ciclosEncerrar: (dados) => ipcRenderer.invoke('inventarios:ciclos-encerrar', dados),
    ciclosDashboard: (ciclo_id) => ipcRenderer.invoke('inventarios:ciclos-dashboard', ciclo_id),
    // Inventários
    criar: (dados) => ipcRenderer.invoke('inventarios:criar', dados),
    criarGeral: (dados) => ipcRenderer.invoke('inventarios:criar-geral', dados),
    criarCargaInicial: () => ipcRenderer.invoke('inventarios:criar-carga-inicial'),
    listar: () => ipcRenderer.invoke('inventarios:listar'),
    buscar: (id) => ipcRenderer.invoke('inventarios:buscar', id),
    itens: (inventario_id) => ipcRenderer.invoke('inventarios:itens', inventario_id),
    zonas: (inventario_id) => ipcRenderer.invoke('inventarios:zonas', inventario_id),
    adicionarItem: (dados) => ipcRenderer.invoke('inventarios:adicionar-item', dados),
    // Contagem
    registrarContagem: (dados) => ipcRenderer.invoke('inventarios:registrar-contagem', dados),
    // Conciliação
    conciliar: (dados) => ipcRenderer.invoke('inventarios:conciliar', dados),
    conciliarCargaInicial: (dados) => ipcRenderer.invoke('inventarios:conciliar-carga-inicial', dados),
    validarSemAjuste: (dados) => ipcRenderer.invoke('inventarios:validar-sem-ajuste', dados),
    // Cancelamento
    cancelar: (id) => ipcRenderer.invoke('inventarios:cancelar', id),
    cancelarItem: (item_id) => ipcRenderer.invoke('inventarios:cancelar-item', item_id),
    recontarItem: (item_id) => ipcRenderer.invoke('inventarios:recontar-item', item_id),
    // IRA
    calcularIRA: (inventario_id) => ipcRenderer.invoke('inventarios:calcular-ira', inventario_id),
    // Log
    ajustesLog: (filtros) => ipcRenderer.invoke('inventarios:ajustes-log', filtros),
    // Bloqueios
    enderecosBloqueados: () => ipcRenderer.invoke('inventarios:enderecos-bloqueados'),
    verificarBloqueio: (endereco) => ipcRenderer.invoke('inventarios:verificar-bloqueio', endereco),
  },

  // ── Operadores ───────────────────────────────────────────────────────────
  operadores: {
    autenticar: (pin) => ipcRenderer.invoke('operadores:autenticar', { pin }),
    listar: () => ipcRenderer.invoke('operadores:listar'),
    criar: (dados) => ipcRenderer.invoke('operadores:criar', dados),
    atualizar: (dados) => ipcRenderer.invoke('operadores:atualizar', dados),
    desativar: (id) => ipcRenderer.invoke('operadores:desativar', id),
  },

  // ── Locais ───────────────────────────────────────────────────────────────
  locais: {
    listar: () => ipcRenderer.invoke('locais:listar'),
    buscar: (endereco) => ipcRenderer.invoke('locais:buscar', endereco),
    criar: (dados) => ipcRenderer.invoke('locais:criar', dados),
    atualizar: (dados) => ipcRenderer.invoke('locais:atualizar', dados),
    deletar: (id) => ipcRenderer.invoke('locais:deletar', id),
  },
})
