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
import { operadores, vendedores } from './auth.js'
import {
  produtos,
  clientes,
  formasPagamento,
  locaisCobranca,
  naturezasOperacao,
  taras,
} from './cadastros.js'
import { estoqueCaixas } from './estoque.js'

export const mapasProducao = pgTable(
  'mapas_producao',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    titulo: text('titulo').notNull().default(''),
    tipo: text('tipo').notNull().default('PRINCIPAL'), // PRINCIPAL | COMPLEMENTAR
    dataMapa: date('data_mapa').notNull(),
    status: text('status').notNull().default('ABERTO'), // ABERTO | EM_PRODUCAO | FINALIZADO | CONCLUIDO
    observacoes: text('observacoes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_mapas_codigo').on(t.tenantId, t.codigo)]
)

export const mapasProducaoItens = pgTable(
  'mapas_producao_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    mapaId: uuid('mapa_id')
      .notNull()
      .references(() => mapasProducao.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    materiaPrimaId: uuid('materia_prima_id').references(() => produtos.id),
    clienteId: uuid('cliente_id').references(() => clientes.id),
    pedidoId: uuid('pedido_id'),
    pedidoItemId: uuid('pedido_item_id'),
    pedidoCodigo: text('pedido_codigo').notNull().default(''),
    previsaoEntrega: date('previsao_entrega'),
    grupoMapa: text('grupo_mapa').notNull().default(''),
    especificacao: text('especificacao').notNull().default(''),
    conservacao: text('conservacao').notNull().default('RESFRIADO'),
    observacao: text('observacao').notNull().default(''),
    qtdPrevistaKg: numeric('qtd_prevista_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    qtdMpKg: numeric('qtd_mp_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    qtdRealizadaKg: numeric('qtd_realizada_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    concluido: integer('concluido').notNull().default(0),
    ordem: integer('ordem').notNull().default(0),
  },
  (t) => [index('idx_mpi_mapa').on(t.mapaId)]
)

export const mapaEspecificacoesPadrao = pgTable(
  'mapa_especificacoes_padrao',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    materiaPrimaId: uuid('materia_prima_id').references(() => produtos.id, { onDelete: 'set null' }),
    especificacao: text('especificacao').notNull().default(''),
    conservacao: text('conservacao').notNull().default('RESFRIADO'),
    grupoMapa: text('grupo_mapa').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_mapa_espec_tenant_prod').on(t.tenantId, t.produtoId)]
)

export const mapaProgramacaoSemanal = pgTable(
  'mapa_programacao_semanal',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    diaSemana: integer('dia_semana').notNull(), // 1=Seg .. 6=Sab
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    materiaPrimaId: uuid('materia_prima_id').references(() => produtos.id, { onDelete: 'set null' }),
    especificacao: text('especificacao').notNull().default(''),
    conservacao: text('conservacao').notNull().default('RESFRIADO'),
    grupoMapa: text('grupo_mapa').notNull().default(''),
    qtdMetaKg: numeric('qtd_meta_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    observacao: text('observacao').notNull().default(''),
    ativo: integer('ativo').notNull().default(1),
  },
  (t) => [index('idx_mapa_prog_sem').on(t.tenantId, t.filialId, t.diaSemana)]
)

export const ordensProducao = pgTable(
  'ordens_producao',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    mapaId: uuid('mapa_id').references(() => mapasProducao.id, { onDelete: 'set null' }),
    codigo: text('codigo').notNull(),
    nome: text('nome'),
    status: text('status').notNull().default('ABERTA'),
    operadorId: uuid('operador_id').references(() => operadores.id),
    operadorNome: text('operador_nome'),
    reaberta: integer('reaberta').notNull().default(0),
    rendimentoPct: numeric('rendimento_pct', { precision: 7, scale: 2 }),
    perdaPct: numeric('perda_pct', { precision: 7, scale: 2 }),
    custoMpTotal: numeric('custo_mp_total', { precision: 14, scale: 2 }).notNull().default('0'),
    custoEmbalagens: numeric('custo_embalagens', { precision: 14, scale: 2 }).notNull().default('0'),
    custoMoIndireto: numeric('custo_mo_indireto', { precision: 14, scale: 2 }).notNull().default('0'),
    cliente: text('cliente').notNull().default('INTERNO'),
    endereco: text('endereco').notNull().default('PRODUCAO'),
    dataProducao: date('data_producao'),
    observacoes: text('observacoes').notNull().default(''),
    criadoPorId: uuid('criado_por_id'),
    criadoPorNome: text('criado_por_nome'),
    liberadaEm: timestamp('liberada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_ops_tenant_codigo').on(t.tenantId, t.codigo)]
)

export const opItensPrevistos = pgTable(
  'op_itens_previstos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    opId: uuid('op_id')
      .notNull()
      .references(() => ordensProducao.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(), // ENTRADA | SAIDA
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    qtdCaixasPrevista: numeric('qtd_caixas_prevista', { precision: 14, scale: 2 }),
    pesoKgPrevisto: numeric('peso_kg_previsto', { precision: 14, scale: 3 }),
    unidadePrevista: text('unidade_prevista').notNull().default('KG'),
    observacao: text('observacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_op_prev_op').on(t.opId)]
)

export const opInsumos = pgTable(
  'op_insumos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    opId: uuid('op_id')
      .notNull()
      .references(() => ordensProducao.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id').references(() => estoqueCaixas.id),
    produtoId: uuid('produto_id').references(() => produtos.id),
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    pesoBrutoKg: numeric('peso_bruto_kg', { precision: 14, scale: 3 }),
    taraKg: numeric('tara_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    dataProducao: date('data_producao'),
    lote: text('lote').notNull().default(''),
    qtdPecas: integer('qtd_pecas'),
    custoUnitarioKg: numeric('custo_unitario_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    operadorNome: text('operador_nome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_op_insumos_op').on(t.opId)]
)

export const opRetornos = pgTable(
  'op_retornos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    opId: uuid('op_id')
      .notNull()
      .references(() => ordensProducao.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id').references(() => estoqueCaixas.id),
    produtoId: uuid('produto_id').references(() => produtos.id),
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    pesoBrutoKg: numeric('peso_bruto_kg', { precision: 14, scale: 3 }),
    taraId: uuid('tara_id').references(() => taras.id),
    taraKg: numeric('tara_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    dataProducao: date('data_producao'),
    validade: date('validade'),
    lote: text('lote').notNull().default(''),
    qtdPecas: integer('qtd_pecas'),
    custoAlocadoKg: numeric('custo_alocado_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    precoVendaRefKg: numeric('preco_venda_ref_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    operadorNome: text('operador_nome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_op_retornos_op').on(t.opId)]
)

export const inventarioCiclos = pgTable(
  'inventario_ciclos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    nome: text('nome').notNull(),
    status: text('status').notNull().default('Ativo'),
    targetPct: numeric('target_pct', { precision: 6, scale: 2 }).notNull().default('99.90'),
    dataCriacao: timestamp('data_criacao', { withTimezone: true }).notNull().defaultNow(),
    dataEncerramento: timestamp('data_encerramento', { withTimezone: true }),
  },
  (t) => [index('idx_inv_ciclos_tenant').on(t.tenantId)]
)

export const inventarios = pgTable(
  'inventarios',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    tipoFiltro: text('tipo_filtro'),
    identificadorFiltro: text('identificador_filtro'),
    nome: text('nome'),
    tipo: text('tipo').notNull().default('Ciclico'),
    cicloId: uuid('ciclo_id').references(() => inventarioCiclos.id),
    status: text('status').notNull().default('Aberto'),
    dataCriacao: timestamp('data_criacao', { withTimezone: true }).notNull().defaultNow(),
    dataFinalizacao: timestamp('data_finalizacao', { withTimezone: true }),
  },
  (t) => [index('idx_inv_tenant').on(t.tenantId)]
)

export const inventarioZonas = pgTable('inventario_zonas', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  legacyId: integer('legacy_id'),
  inventarioId: uuid('inventario_id')
    .notNull()
    .references(() => inventarios.id, { onDelete: 'cascade' }),
  nomeZona: text('nome_zona').notNull(),
  status: text('status').notNull().default('Aberto'),
})

export const inventarioItens = pgTable(
  'inventario_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => inventarios.id, { onDelete: 'cascade' }),
    endereco: text('endereco').notNull(),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    lote: text('lote').notNull().default(''),
    validade: date('validade'),
    eanCaixa: text('ean_caixa'),
    qtdSistemaCaixas: numeric('qtd_sistema_caixas', { precision: 14, scale: 2 }),
    qtdSistemaKg: numeric('qtd_sistema_kg', { precision: 14, scale: 3 }),
    qtdContadaCaixas: numeric('qtd_contada_caixas', { precision: 14, scale: 2 }),
    qtdContadaKg: numeric('qtd_contada_kg', { precision: 14, scale: 3 }),
    contagemAtual: integer('contagem_atual').notNull().default(1),
    qtd1Caixas: numeric('qtd_1_caixas', { precision: 14, scale: 2 }),
    qtd1Kg: numeric('qtd_1_kg', { precision: 14, scale: 3 }),
    qtd2Caixas: numeric('qtd_2_caixas', { precision: 14, scale: 2 }),
    qtd2Kg: numeric('qtd_2_kg', { precision: 14, scale: 3 }),
    qtd3Caixas: numeric('qtd_3_caixas', { precision: 14, scale: 2 }),
    qtd3Kg: numeric('qtd_3_kg', { precision: 14, scale: 3 }),
    validadeContada: date('validade_contada'),
    pesoBrutoContadoKg: numeric('peso_bruto_contado_kg', { precision: 14, scale: 3 }),
    taraId: uuid('tara_id'),
    taraKg: numeric('tara_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    dataProducaoContada: date('data_producao_contada'),
    qtdPecasContada: integer('qtd_pecas_contada'),
    statusItem: text('status_item').notNull().default('Pendente'),
    dataContagem: timestamp('data_contagem', { withTimezone: true }),
  },
  (t) => [index('idx_inv_itens_inv').on(t.inventarioId)]
)

export const inventarioAjustesLog = pgTable('inventario_ajustes_log', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  legacyId: integer('legacy_id'),
  inventarioId: uuid('inventario_id').references(() => inventarios.id),
  cicloId: uuid('ciclo_id').references(() => inventarioCiclos.id),
  itemId: uuid('item_id').references(() => inventarioItens.id),
  produtoId: uuid('produto_id').references(() => produtos.id),
  endereco: text('endereco'),
  lote: text('lote'),
  custoUnitarioData: numeric('custo_unitario_data', { precision: 14, scale: 4 }).notNull().default('0'),
  qtdAjustadaCaixas: numeric('qtd_ajustada_caixas', { precision: 14, scale: 2 }).notNull().default('0'),
  qtdAjustadaKg: numeric('qtd_ajustada_kg', { precision: 14, scale: 3 }).notNull().default('0'),
  tipoAjuste: text('tipo_ajuste'),
  usuarioContouId: uuid('usuario_contou_id'),
  usuarioAprovouId: uuid('usuario_aprovou_id'),
  usuarioAprovouNome: text('usuario_aprovou_nome'),
  dataAjuste: timestamp('data_ajuste', { withTimezone: true }).notNull().defaultNow(),
})

export const whatsappInbox = pgTable(
  'whatsapp_inbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    remetentePhone: text('remetente_phone').notNull(),
    remetenteNome: text('remetente_nome').notNull().default(''),
    clienteSugeridoId: uuid('cliente_sugerido_id').references(() => clientes.id),
    mensagemBruta: text('mensagem_bruta').notNull(),
    parsedJson: jsonb('parsed_json').notNull().default({}),
    confiancaPct: numeric('confianca_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    status: text('status').notNull().default('PENDENTE'), // PENDENTE | CONVERTIDO | IGNORADO
    pedidoGeradoId: uuid('pedido_gerado_id'),
    recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_wpp_tenant_status').on(t.tenantId, t.status)]
)

export const pedidos = pgTable(
  'pedidos',
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
    titulo: text('titulo').notNull(),
    clienteId: uuid('cliente_id').references(() => clientes.id),
    cliente: text('cliente').notNull().default('PAVAN'),
    vendedorId: uuid('vendedor_id').references(() => vendedores.id),
    formaPagamentoId: uuid('forma_pagamento_id').references(() => formasPagamento.id),
    localCobrancaId: uuid('local_cobranca_id').references(() => locaisCobranca.id),
    naturezaId: uuid('natureza_id').references(() => naturezasOperacao.id),
    marchante: text('marchante').notNull().default(''),
    pagamentoNaEntrega: integer('pagamento_na_entrega').notNull().default(0),
    previsaoEntrega: date('previsao_entrega'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    observacoes: text('observacoes').notNull().default(''),
    origemPedido: text('origem_pedido').notNull().default('SUPPLY_CHAIN'), // SUPPLY_CHAIN | FINANCEIRO | WHATSAPP | VENDEDOR | PORTAL | SISTEMA
    setorSolicitante: text('setor_solicitante').notNull().default('SUPPLY_CHAIN'),
    status: text('status').notNull().default('LIBERADO'),
    rastreioToken: text('rastreio_token'),
    criadoPorId: uuid('criado_por_id'),
    criadoPorNome: text('criado_por_nome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    liberadoAt: timestamp('liberado_at', { withTimezone: true }),
    separadoAt: timestamp('separado_at', { withTimezone: true }),
    expedidoAt: timestamp('expedido_at', { withTimezone: true }),
    canceladoAt: timestamp('cancelado_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_pedidos_tenant_codigo').on(t.tenantId, t.codigo),
    index('idx_pedidos_tenant_status').on(t.tenantId, t.status),
  ]
)

export const pedidosItens = pgTable(
  'pedidos_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    codigoAux: text('codigo_aux').notNull().default(''),
    qtdKgSolicitada: numeric('qtd_kg_solicitada', { precision: 14, scale: 3 }).notNull().default('0'),
    qtdCaixasSolicitada: numeric('qtd_caixas_solicitada', { precision: 14, scale: 2 }),
    unidadeSolicitada: text('unidade_solicitada').notNull().default('KG'),
    qtdSolicitadaExibicao: numeric('qtd_solicitada_exibicao', { precision: 14, scale: 3 }),
    precoUnitario: numeric('preco_unitario', { precision: 14, scale: 4 }).notNull().default('0'),
    descontoPct: numeric('desconto_pct', { precision: 6, scale: 2 }).notNull().default('0'),
    descontoValor: numeric('desconto_valor', { precision: 14, scale: 2 }).notNull().default('0'),
    cfopAplicado: text('cfop_aplicado').notNull().default(''),
    observacao: text('observacao').notNull().default(''),
    alertaReclamacao: text('alerta_reclamacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_pedido_item_prod').on(t.pedidoId, t.produtoId)]
)

export const pedidosParcelas = pgTable(
  'pedidos_parcelas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade' }),
    numeroParcela: integer('numero_parcela').notNull(),
    diasPrazo: integer('dias_prazo').notNull().default(0),
    vencimento: date('vencimento').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index('idx_parcelas_pedido').on(t.pedidoId)]
)

export const rotas = pgTable('rotas', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  regiao: text('regiao').notNull().default(''),
  transportadoraId: uuid('transportadora_id'),
  veiculoPadrao: text('veiculo_padrao').notNull().default(''),
  diasEntrega: text('dias_entrega').notNull().default(''),
  ativo: integer('ativo').notNull().default(1),
})

export const embarques = pgTable(
  'embarques',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    titulo: text('titulo').notNull().default(''),
    rotaId: uuid('rota_id').references(() => rotas.id),
    transportadoraId: uuid('transportadora_id'),
    motoristaId: uuid('motorista_id').references(() => operadores.id),
    motoristaNome: text('motorista_nome').notNull().default(''),
    veiculoPlaca: text('veiculo_placa').notNull().default(''),
    modalidadeImpressao: text('modalidade_impressao').notNull().default('OPCAO_B'), // OPCAO_B | OPCAO_A
    qrToken: text('qr_token'),
    numeroNfLote: text('numero_nf_lote').notNull().default(''),
    observacoes: text('observacoes').notNull().default(''),
    operadorCarregamentoNome: text('operador_carregamento_nome').notNull().default(''),
    dataEmbarque: date('data_embarque').notNull(),
    status: text('status').notNull().default('PLANEJADO'), // PLANEJADO | EM_CARREGAMENTO | EM_ROTA | CONCLUIDO | CANCELADO
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_embarques_codigo').on(t.tenantId, t.codigo)]
)

export const romaneios = pgTable(
  'romaneios',
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
    pedidoId: uuid('pedido_id').references(() => pedidos.id),
    embarqueId: uuid('embarque_id').references(() => embarques.id),
    cliente: text('cliente').notNull().default(''),
    previsaoEntrega: text('previsao_entrega'),
    status: text('status').notNull().default('MONTANDO'),
    operadorId: uuid('operador_id'),
    operadorNome: text('operador_nome'),
    operadorConferenciaNome: text('operador_conferencia_nome'),
    operadorExpedicaoNome: text('operador_expedicao_nome'),
    conferidoAt: timestamp('conferido_at', { withTimezone: true }),
    expedidoAt: timestamp('expedido_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_romaneios_tenant_codigo').on(t.tenantId, t.codigo)]
)

export const romaneiosItens = pgTable(
  'romaneios_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    romaneioId: uuid('romaneio_id')
      .notNull()
      .references(() => romaneios.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id').references(() => estoqueCaixas.id),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }),
    conferido: integer('conferido').notNull().default(0),
    conferidoAt: timestamp('conferido_at', { withTimezone: true }),
    conferidoPor: text('conferido_por'),
    carregadoVeiculo: integer('carregado_veiculo').notNull().default(0),
    carregadoAt: timestamp('carregado_at', { withTimezone: true }),
    carregadoPor: text('carregado_por'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_rom_itens_romaneio').on(t.romaneioId)]
)

export const entregasTracking = pgTable(
  'entregas_tracking',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    embarqueId: uuid('embarque_id')
      .notNull()
      .references(() => embarques.id, { onDelete: 'cascade' }),
    pedidoId: uuid('pedido_id')
      .notNull()
      .references(() => pedidos.id),
    romaneioId: uuid('romaneio_id'),
    ordemParada: integer('ordem_parada').notNull().default(1),
    statusEntrega: text('status_entrega').notNull().default('PENDENTE'), // PENDENTE | A_CAMINHO | NO_CLIENTE | ENTREGUE | DEVOLVIDA
    pagamentoConfirmado: integer('pagamento_confirmado').notNull().default(0),
    formaPagamentoRecebida: text('forma_pagamento_recebida').notNull().default(''),
    valorPago: numeric('valor_pago', { precision: 14, scale: 2 }),
    canhotoFotoUrl: text('canhoto_foto_url'),
    assinaturaUrl: text('assinatura_url'),
    observacaoMotorista: text('observacao_motorista').notNull().default(''),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
    chegouEm: timestamp('chegou_em', { withTimezone: true }),
    concluidoAt: timestamp('concluido_at', { withTimezone: true }),
  },
  (t) => [index('idx_tracking_embarque').on(t.embarqueId)]
)

export const pendenciasSetor = pgTable(
  'pendencias_setor',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    setorDestino: text('setor_destino').notNull(), // SUPPLY_CHAIN | PCP | CAMARA_FRIA | LOGISTICA | FATURAMENTO | FINANCEIRO
    tipoPendencia: text('tipo_pendencia').notNull(),
    referenciaTabela: text('referencia_tabela').notNull(),
    referenciaId: uuid('referencia_id').notNull(),
    titulo: text('titulo').notNull(),
    prioridade: integer('prioridade').notNull().default(1),
    status: text('status').notNull().default('PENDENTE'), // PENDENTE | EM_ATENDIMENTO | CONCLUIDA
    concluidaPorId: uuid('concluida_por_id'),
    concluidaAt: timestamp('concluida_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pendencias_setor').on(t.tenantId, t.setorDestino, t.status)]
)

export const syncOperationsLog = pgTable(
  'sync_operations_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    operationId: text('operation_id').notNull(),
    entidade: text('entidade').notNull(),
    payloadHash: text('payload_hash').notNull(),
    processadoEm: timestamp('processado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_sync_op_idempotency').on(t.tenantId, t.operationId)]
)

export const devolucoes = pgTable(
  'devolucoes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    motivo: text('motivo').notNull(), // VALIDADE | DIVERGENCIA_PEDIDO | LOCAL_FECHADO | AVARIA | OUTROS
    acaoEstoque: text('acao_estoque').notNull().default('DISPONIVEL'), // DISPONIVEL | BLOQUEADO
    enderecoDestino: text('endereco_destino').notNull().default('REC'),
    pedidoId: uuid('pedido_id').references(() => pedidos.id, { onDelete: 'set null' }),
    pedidoCodigo: text('pedido_codigo').notNull().default(''),
    romaneioId: uuid('romaneio_id').references(() => romaneios.id, { onDelete: 'set null' }),
    romaneioCodigo: text('romaneio_codigo').notNull().default(''),
    clienteNome: text('cliente_nome').notNull().default(''),
    observacoes: text('observacoes').notNull().default(''),
    status: text('status').notNull().default('CONCLUIDA_FISICA'),
    statusFiscal: text('status_fiscal').notNull().default('PENDENTE_FATURAMENTO'), // PENDENTE_FATURAMENTO | NF_DEVOLUCAO_EMITIDA | DISPENSA_FISCAL
    numeroNfDevolucao: text('numero_nf_devolucao').notNull().default(''),
    qtdCaixas: integer('qtd_caixas').notNull().default(0),
    pesoTotalKg: numeric('peso_total_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    valorEstimado: numeric('valor_estimado', { precision: 14, scale: 2 }).notNull().default('0'),
    operadorId: uuid('operador_id'),
    operadorNome: text('operador_nome').notNull().default(''),
    fiscalTratadoPorNome: text('fiscal_tratado_por_nome').notNull().default(''),
    fiscalTratadoEm: timestamp('fiscal_tratado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_devolucoes_tenant_codigo').on(t.tenantId, t.codigo),
    index('idx_devolucoes_tenant_filial').on(t.tenantId, t.filialId, t.statusFiscal),
  ]
)

export const devolucaoItens = pgTable(
  'devolucao_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    devolucaoId: uuid('devolucao_id')
      .notNull()
      .references(() => devolucoes.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id')
      .notNull()
      .references(() => estoqueCaixas.id),
    eanCaixa: text('ean_caixa').notNull(),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    produtoCodigo: text('produto_codigo').notNull().default(''),
    produtoDescricao: text('produto_descricao').notNull().default(''),
    lote: text('lote').notNull().default(''),
    validade: date('validade'),
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    precoUnitario: numeric('preco_unitario', { precision: 14, scale: 2 }).notNull().default('0'),
    pedidoId: uuid('pedido_id'),
    pedidoCodigo: text('pedido_codigo').notNull().default(''),
    romaneioId: uuid('romaneio_id'),
    romaneioCodigo: text('romaneio_codigo').notNull().default(''),
    clienteNome: text('cliente_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_dev_itens_dev').on(t.devolucaoId)]
)
