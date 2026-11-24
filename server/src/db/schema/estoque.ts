import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants, filiais } from './saas.js'
import { operadores } from './auth.js'
import {
  produtos,
  fornecedores,
  centrosCusto,
  formasPagamento,
  naturezasOperacao,
  taras,
} from './cadastros.js'

export const pedidosCompra = pgTable(
  'pedidos_compra',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedores.id, { onDelete: 'set null' }),
    tipoCompra: text('tipo_compra').notNull().default('MATERIA_PRIMA'), // MATERIA_PRIMA | REVENDA | EMPORIO | INSUMO | HIGIENE_CONSUMO
    naturezaId: uuid('natureza_id').references(() => naturezasOperacao.id),
    centroCustoId: uuid('centro_custo_id').references(() => centrosCusto.id),
    formaPagamentoId: uuid('forma_pagamento_id').references(() => formasPagamento.id),
    compradorId: uuid('comprador_id').references(() => operadores.id),
    marchante: text('marchante').notNull().default(''),
    freteValor: numeric('frete_valor', { precision: 14, scale: 2 }).notNull().default('0'),
    despesasValor: numeric('despesas_valor', { precision: 14, scale: 2 }).notNull().default('0'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    previsaoEntrega: date('previsao_entrega'),
    observacoes: text('observacoes').notNull().default(''),
    status: text('status').notNull().default('ABERTO'), // ABERTO | APROVADO | PARCIAL | RECEBIDO | CANCELADO
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_pedidos_compra_codigo').on(t.tenantId, t.codigo),
    index('idx_pedidos_compra_status').on(t.tenantId, t.status),
  ]
)

export const pedidosCompraItens = pgTable(
  'pedidos_compra_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pedidoCompraId: uuid('pedido_compra_id')
      .notNull()
      .references(() => pedidosCompra.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    qtdKgSolicitada: numeric('qtd_kg_solicitada', { precision: 14, scale: 3 }).notNull(),
    precoUnitarioKg: numeric('preco_unitario_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    qtdKgRecebida: numeric('qtd_kg_recebida', { precision: 14, scale: 3 }).notNull().default('0'),
    cfopAplicado: text('cfop_aplicado').notNull().default(''),
    temperaturaC: numeric('temperatura_c', { precision: 6, scale: 2 }),
    temperaturaRegistradaEm: timestamp('temperatura_registrada_em', { withTimezone: true }),
    temperaturaRegistradaPor: text('temperatura_registrada_por').notNull().default(''),
  },
  (t) => [index('idx_pci_pedido').on(t.pedidoCompraId)]
)

export const recebimentos = pgTable(
  'recebimentos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    pedidoCompraId: uuid('pedido_compra_id').references(() => pedidosCompra.id),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedores.id),
    tipoEntrada: text('tipo_entrada').notNull().default('COMPRA_ESTOQUE'), // COMPRA_ESTOQUE | HIGIENE_CONSUMO_DIRETO | INSUMO_DIRETO
    centroCustoId: uuid('centro_custo_id').references(() => centrosCusto.id, { onDelete: 'set null' }),
    categoriaDre: text('categoria_dre').notNull().default(''),
    chaveNfe: text('chave_nfe').notNull().default(''),
    numeroNf: text('numero_nf').notNull().default(''),
    serieNf: text('serie_nf').notNull().default(''),
    dataEmissaoNf: date('data_emissao_nf'),
    valorProdutosNf: numeric('valor_produtos_nf', { precision: 14, scale: 2 }).notNull().default('0'),
    valorFreteNf: numeric('valor_frete_nf', { precision: 14, scale: 2 }).notNull().default('0'),
    valorOutrasDespNf: numeric('valor_outras_desp_nf', { precision: 14, scale: 2 }).notNull().default('0'),
    valorDescontoNf: numeric('valor_desconto_nf', { precision: 14, scale: 2 }).notNull().default('0'),
    valorTotalNf: numeric('valor_total_nf', { precision: 14, scale: 2 }).notNull().default('0'),
    xmlItensJson: jsonb('xml_itens_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    xmlDuplicatasJson: jsonb('xml_duplicatas_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    xmlConteudo: text('xml_conteudo').notNull().default(''),
    xmlStorageKey: text('xml_storage_key').notNull().default(''),
    statusValidacao: text('status_validacao').notNull().default('AGUARDANDO_BIPAGEM'), // AGUARDANDO_BIPAGEM | AGUARDANDO_VALIDACAO_SISTEMICA | DIVERGENTE | VALIDADO
    validadoPorId: uuid('validado_por_id'),
    validadoAt: timestamp('validado_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_recebimentos_codigo').on(t.tenantId, t.codigo)]
)

export const recebimentoPreCaixas = pgTable(
  'recebimento_pre_caixas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    recebimentoId: uuid('recebimento_id').references(() => recebimentos.id, { onDelete: 'cascade' }),
    pedidoCompraId: uuid('pedido_compra_id').references(() => pedidosCompra.id, { onDelete: 'set null' }),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedores.id, { onDelete: 'set null' }),
    eanCaixa: text('ean_caixa').notNull(),
    codigoProdutoFornecedor: text('codigo_produto_fornecedor').notNull().default(''),
    descricaoProdutoFornecedor: text('descricao_produto_fornecedor').notNull().default(''),
    produtoId: uuid('produto_id').references(() => produtos.id, { onDelete: 'set null' }),
    pesoLiquidoKg: numeric('peso_liquido_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    pesoBrutoKg: numeric('peso_bruto_kg', { precision: 14, scale: 3 }),
    taraKg: numeric('tara_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    qtdPecas: integer('qtd_pecas'),
    dataProducao: date('data_producao'),
    validade: date('validade'),
    lote: text('lote').notNull().default(''),
    documentoOrigem: text('documento_origem').notNull().default(''),
    arquivoOrigem: text('arquivo_origem').notNull().default(''),
    custoUnitarioKg: numeric('custo_unitario_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    status: text('status').notNull().default('PENDENTE'), // PENDENTE | BIPADA | DIVERGENTE
    caixaEstoqueId: uuid('caixa_estoque_id'),
    bipadaEm: timestamp('bipada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_pre_caixas_tenant_ean').on(t.tenantId, t.eanCaixa),
    index('idx_pre_caixas_rec_status').on(t.tenantId, t.recebimentoId, t.status),
  ]
)

export const paletes = pgTable(
  'paletes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    codigo: text('codigo').notNull(),
    enderecoAtual: text('endereco_atual').notNull().default('REC'),
    status: text('status').notNull().default('EM_MONTAGEM'), // EM_MONTAGEM | FECHADO | FINALIZADO | ATIVO | DESMONTADO
    ultimoOperador: text('ultimo_operador'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_paletes_tenant_codigo').on(t.tenantId, t.codigo)]
)

export const estoqueCaixas = pgTable(
  'estoque_caixas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    eanCaixa: text('ean_caixa').notNull(),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    paleteId: uuid('palete_id').references(() => paletes.id),
    paleteOrigemId: uuid('palete_origem_id').references(() => paletes.id),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedores.id),
    recebimentoId: uuid('recebimento_id').references(() => recebimentos.id),
    sifOrigem: text('sif_origem').notNull().default(''),
    endereco: text('endereco'),
    lote: text('lote').notNull().default(''),
    dataProducao: date('data_producao'),
    validade: date('validade'),
    pesoBrutoKg: numeric('peso_bruto_kg', { precision: 14, scale: 3 }),
    taraId: uuid('tara_id').references(() => taras.id),
    taraKg: numeric('tara_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    taraPrimariaTotalKg: numeric('tara_primaria_total_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }).notNull(),
    pesoRestanteKg: numeric('peso_restante_kg', { precision: 14, scale: 3 }),
    entradaAcougueEm: timestamp('entrada_acougue_em', { withTimezone: true }),
    entradaAcouguePor: text('entrada_acougue_por').notNull().default(''),
    quebraAcougueKg: numeric('quebra_acougue_kg', { precision: 14, scale: 3 }),
    qtdPecas: integer('qtd_pecas'),
    custoUnitarioKg: numeric('custo_unitario_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    origemTipo: text('origem_tipo').notNull().default('RECEBIMENTO'),
    caixaOrigemId: uuid('caixa_origem_id'),
    eanOrigem: text('ean_origem'),
    opId: uuid('op_id'),
    operadorCadastroNome: text('operador_cadastro_nome'),
    status: text('status').notNull().default('DISPONIVEL'), // DISPONIVEL | CONSUMIDA | RESERVADA | BLOQUEADO | EXPEDIDA
    pedidoReservadoId: uuid('pedido_reservado_id'),
    pedidoReservadoCodigo: text('pedido_reservado_codigo'),
    romaneioReservadoId: uuid('romaneio_reservado_id'),
    romaneioReservadoCodigo: text('romaneio_reservado_codigo'),
    clienteReservadoNome: text('cliente_reservado_nome'),
    reservadoEm: timestamp('reservado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_caixas_tenant_ean').on(t.tenantId, t.eanCaixa),
    index('idx_caixas_tenant_status').on(t.tenantId, t.status),
    index('idx_caixas_endereco').on(t.tenantId, t.endereco),
    index('idx_caixas_op').on(t.tenantId, t.opId),
  ]
)

export const estoquePosicao = pgTable(
  'estoque_posicao',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    endereco: text('endereco').notNull(),
    lote: text('lote').notNull().default(''),
    validade: date('validade'),
    qtdCaixas: numeric('qtd_caixas', { precision: 14, scale: 2 }).notNull().default('0'),
    qtdKg: numeric('qtd_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pos_tenant_produto').on(t.tenantId, t.produtoId)]
)

export const caixasHistorico = pgTable(
  'caixas_historico',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    caixaId: uuid('caixa_id'),
    eanCaixa: text('ean_caixa').notNull(),
    operacao: text('operacao').notNull(),
    detalhes: text('detalhes').notNull().default(''),
    operadorNome: text('operador_nome').notNull().default('Sistema'),
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_ch_tenant_ean').on(t.tenantId, t.eanCaixa)]
)

export const movimentacoesLog = pgTable(
  'movimentacoes_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    produtoId: uuid('produto_id').references(() => produtos.id),
    enderecoOrigem: text('endereco_origem'),
    enderecoDestino: text('endereco_destino'),
    lote: text('lote'),
    qtdCaixas: numeric('qtd_caixas', { precision: 14, scale: 2 }),
    qtdKg: numeric('qtd_kg', { precision: 14, scale: 3 }),
    dataHora: timestamp('data_hora', { withTimezone: true }).notNull().defaultNow(),
    operadorId: uuid('operador_id').references(() => operadores.id),
    operadorNome: text('operador_nome'),
    tipo: text('tipo').notNull(),
    numPedido: text('num_pedido'),
    cliente: text('cliente'),
  },
  (t) => [index('idx_mov_log_tenant_data').on(t.tenantId, t.dataHora)]
)

export const desmembramentosVinculos = pgTable(
  'desmembramentos_vinculos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    codigoOperacao: text('codigo_operacao').notNull(),
    caixaOrigemId: uuid('caixa_origem_id').notNull(),
    eanOrigem: text('ean_origem').notNull(),
    caixaDestinoId: uuid('caixa_destino_id').notNull(),
    eanDestino: text('ean_destino').notNull(),
    produtoId: uuid('produto_id').notNull(),
    pesoLiquidoKg: numeric('peso_liquido_kg', { precision: 14, scale: 3 }).notNull(),
    pesoBrutoKg: numeric('peso_bruto_kg', { precision: 14, scale: 3 }),
    taraKg: numeric('tara_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    lote: text('lote').notNull().default(''),
    dataProducao: date('data_producao'),
    validade: date('validade'),
    qtdPecas: integer('qtd_pecas'),
    perdaPecas: integer('perda_pecas').notNull().default(0),
    motivoDiferencaPecas: text('motivo_diferenca_pecas').notNull().default(''),
    operadorId: uuid('operador_id'),
    operadorNome: text('operador_nome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_desm_tenant_origem').on(t.tenantId, t.eanOrigem)]
)

export const eanSequencias = pgTable(
  'ean_sequencias',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    chave: text('chave').notNull(),
    ultimoNumero: integer('ultimo_numero').notNull().default(900000),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_ean_seq_tenant_chave').on(t.tenantId, t.chave)]
)

// ── ETAPA 6: COTAÇÕES DE COMPRAS (RFQ) & CONTROLE DE PERDAS ───────────────────
export const comprasCotacoes = pgTable(
  'compras_cotacoes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    titulo: text('titulo').notNull(),
    tipoCompra: text('tipo_compra').notNull().default('MATERIA_PRIMA'),
    dataValidade: date('data_validade'),
    status: text('status').notNull().default('ABERTA'), // ABERTA | EM_ANALISE | FECHADA | CANCELADA
    observacoes: text('observacoes').notNull().default(''),
    pedidosGeradosJson: jsonb('pedidos_gerados_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    economiaEstimada: numeric('economia_estimada', { precision: 14, scale: 2 }).notNull().default('0'),
    criadoPorId: uuid('criado_por_id').references(() => operadores.id, { onDelete: 'set null' }),
    criadoPorNome: text('criado_por_nome').notNull().default(''),
    fechadaPorNome: text('fechada_por_nome').notNull().default(''),
    fechadaEm: timestamp('fechada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_cotacoes_tenant_codigo').on(t.tenantId, t.codigo),
    index('idx_cotacoes_tenant_status').on(t.tenantId, t.status),
  ]
)

export const comprasCotacoesItens = pgTable(
  'compras_cotacoes_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cotacaoId: uuid('cotacao_id')
      .notNull()
      .references(() => comprasCotacoes.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    qtdKgSolicitada: numeric('qtd_kg_solicitada', { precision: 14, scale: 3 }).notNull(),
    ultimoPrecoRef: numeric('ultimo_preco_ref', { precision: 14, scale: 4 }).notNull().default('0'),
    observacao: text('observacao').notNull().default(''),
  },
  (t) => [index('idx_cot_itens_cotacao').on(t.cotacaoId)]
)

export const comprasCotacoesPropostas = pgTable(
  'compras_cotacoes_propostas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cotacaoId: uuid('cotacao_id')
      .notNull()
      .references(() => comprasCotacoes.id, { onDelete: 'cascade' }),
    cotacaoItemId: uuid('cotacao_item_id')
      .notNull()
      .references(() => comprasCotacoesItens.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedores.id, { onDelete: 'cascade' }),
    precoUnitarioKg: numeric('preco_unitario_kg', { precision: 14, scale: 4 }).notNull(),
    freteKg: numeric('frete_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    prazoEntregaDias: integer('prazo_entrega_dias').notNull().default(2),
    condicaoPagamento: text('condicao_pagamento').notNull().default(''),
    observacao: text('observacao').notNull().default(''),
    vencedor: integer('vencedor').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_cot_prop_item_forn').on(t.cotacaoItemId, t.fornecedorId),
    index('idx_cot_prop_cotacao').on(t.cotacaoId),
  ]
)

export const perdasRegistro = pgTable(
  'perdas_registro',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    origem: text('origem').notNull().default('ESTOQUE_CAIXA'), // ESTOQUE_CAIXA | ETIQUETA_ACOUGUE | EMPORIO | MANUAL
    caixaId: uuid('caixa_id'),
    eanCaixa: text('ean_caixa').notNull().default(''),
    produtoId: uuid('produto_id').references(() => produtos.id, { onDelete: 'set null' }),
    produtoCodigo: text('produto_codigo').notNull().default(''),
    produtoDescricao: text('produto_descricao').notNull(),
    lote: text('lote').notNull().default(''),
    validade: date('validade'),
    endereco: text('endereco').notNull().default(''),
    motivo: text('motivo').notNull().default('VENCIMENTO'), // VENCIMENTO | AVARIA | QUEBRA_DESOSSA | TEMPERATURA | FURTO_DIVERGENCIA | OUTROS
    qtdKg: numeric('qtd_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    custoUnitario: numeric('custo_unitario', { precision: 14, scale: 4 }).notNull().default('0'),
    custoTotalPerda: numeric('custo_total_perda', { precision: 14, scale: 2 }).notNull().default('0'),
    observacoes: text('observacoes').notNull().default(''),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_perdas_tenant_codigo').on(t.tenantId, t.codigo),
    index('idx_perdas_tenant_filial_data').on(t.tenantId, t.filialId, t.createdAt),
  ]
)

export const camarasTemperaturaLog = pgTable(
  'camaras_temperatura_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    localNome: text('local_nome').notNull(),
    tipoAmbiente: text('tipo_ambiente').notNull().default('RESFRIADO'), // RESFRIADO | CONGELADO | CLIMATIZADO | BALCAO_ACOUGUE | VEICULO
    temperaturaC: numeric('temperatura_c', { precision: 6, scale: 2 }).notNull(),
    tempMinC: numeric('temp_min_c', { precision: 6, scale: 2 }).notNull(),
    tempMaxC: numeric('temp_max_c', { precision: 6, scale: 2 }).notNull(),
    conforme: integer('conforme').notNull().default(1), // 1 = conforme, 0 = fora da faixa
    desvioC: numeric('desvio_c', { precision: 6, scale: 2 }).notNull().default('0'),
    acaoCorretiva: text('acao_corretiva').notNull().default(''),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_camaras_temp_tenant_filial_data').on(t.tenantId, t.filialId, t.createdAt),
  ]
)
