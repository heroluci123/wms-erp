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
import { vendedores } from './auth.js'

export const produtoEspecificacoes = pgTable(
  'produto_especificacoes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    nome: text('nome').notNull(),
    especie: text('especie').notNull().default('BOVINO'), // BOVINO | SUINO | AVES | OUTROS
    conservacao: text('conservacao').notNull().default('RESFRIADO'), // RESFRIADO | CONGELADO | SECO
    temperaturaRotulo: text('temperatura_rotulo').notNull().default(''),
    validadeDiasPadrao: integer('validade_dias_padrao'),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_prod_espec_tenant_cod').on(t.tenantId, t.codigo),
    index('idx_prod_espec_tenant').on(t.tenantId, t.ativo),
  ]
)

export const produtos = pgTable(
  'produtos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    codigo: text('codigo'),
    codigoAuxiliar: text('codigo_auxiliar'),
    ean: text('ean'),
    descricao: text('descricao').notNull(),
    valorUnitario: numeric('valor_unitario', { precision: 14, scale: 4 }).notNull().default('0'),
    ultimoPrecoCompra: numeric('ultimo_preco_compra', { precision: 14, scale: 4 }).notNull().default('0'),
    custoMedioKg: numeric('custo_medio_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    tipoProduto: text('tipo_produto').notNull().default('Materia Prima'),
    statusCurva: text('status_curva').notNull().default('C'),
    unidade: text('unidade').notNull().default('CX'),
    grupo: text('grupo').notNull().default(''),
    especie: text('especie').notNull().default(''), // BOVINO | SUINO | AVES | EMPORIO | INSUMO | OUTROS
    especificacaoId: uuid('especificacao_id').references(() => produtoEspecificacoes.id, { onDelete: 'set null' }),
    conservacao: text('conservacao').notNull().default('RESFRIADO'), // RESFRIADO | CONGELADO | SECO
    validadeDias: integer('validade_dias').notNull().default(5),
    taraEmbalagemKg: numeric('tara_embalagem_kg', { precision: 10, scale: 4 }).notNull().default('0'),
    classificacao: text('classificacao'), // MATERIA_PRIMA | SUBPRODUTO | APARA | ACABADO
    produtoPaiId: uuid('produto_pai_id'),
    pesoPadraoCx: numeric('peso_padrao_cx', { precision: 14, scale: 3 }),
    fatorConversaoCompra: numeric('fator_conversao_compra', { precision: 10, scale: 3 }).notNull().default('1'),
    taraPrimariaPecaKg: numeric('tara_primaria_peca_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    ncm: text('ncm').notNull().default(''),
    cest: text('cest').notNull().default(''),
    origemMercadoria: text('origem_mercadoria').notNull().default('0'),
    registroDipoa: text('registro_dipoa').notNull().default(''),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_produtos_tenant').on(t.tenantId),
    uniqueIndex('uq_produtos_tenant_codigo').on(t.tenantId, t.codigo),
    uniqueIndex('uq_produtos_tenant_ean').on(t.tenantId, t.ean),
  ]
)

export const produtosEans = pgTable(
  'produtos_eans',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    codigoBarras: text('codigo_barras').notNull(),
    tipoRegra: text('tipo_regra').notNull().default('EXATO'), // EXATO | CONTEM
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_produtos_eans_tenant_cod').on(t.tenantId, t.codigoBarras)]
)

export const produtoArvore = pgTable(
  'produto_arvore',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paiId: uuid('pai_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    filhoId: uuid('filho_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    rendimentoEsperadoPct: numeric('rendimento_esperado_pct', { precision: 7, scale: 2 }),
    rendimentoAprendidoPct: numeric('rendimento_aprendido_pct', { precision: 7, scale: 2 }),
    amostrasAprendizado: integer('amostras_aprendizado').notNull().default(0),
    origemVinculo: text('origem_vinculo').notNull().default('MANUAL'), // MANUAL | AUTO_APRENDIDO
    confirmado: integer('confirmado').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_produto_arvore_par').on(t.tenantId, t.paiId, t.filhoId)]
)

export const taras = pgTable(
  'taras',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    nome: text('nome').notNull(),
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }).notNull(),
    ativo: integer('ativo').notNull().default(1),
    padrao: integer('padrao').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_taras_tenant').on(t.tenantId)]
)

export const locais = pgTable(
  'locais',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    endereco: text('endereco').notNull(),
    capacidadeMaxCaixas: numeric('capacidade_max_caixas', { precision: 14, scale: 2 }).notNull().default('0'),
    ativo: integer('ativo').notNull().default(1),
    isInsumo: integer('is_insumo').notNull().default(0),
    tipoArmazenamento: text('tipo_armazenamento').notNull().default('SECO'),
  },
  (t) => [uniqueIndex('uq_locais_filial_endereco').on(t.tenantId, t.filialId, t.endereco)]
)

export const formasPagamento = pgTable(
  'formas_pagamento',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    descricao: text('descricao').notNull(), // ex: '14/21 DIAS', 'PAGAMENTO NA ENTREGA', 'PIX A VISTA'
    diasParcelasJson: jsonb('dias_parcelas_json').$type<number[]>().notNull().default([0]),
    pagamentoNaEntrega: integer('pagamento_na_entrega').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
  },
  (t) => [uniqueIndex('uq_formas_pgto_tenant_cod').on(t.tenantId, t.codigo)]
)

export const locaisCobranca = pgTable(
  'locais_cobranca',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    nome: text('nome').notNull(), // ex: 'BANCO DO BRASIL'
    ativo: integer('ativo').notNull().default(1),
  },
  (t) => [uniqueIndex('uq_locais_cobr_tenant_cod').on(t.tenantId, t.codigo)]
)

export const centrosCusto = pgTable(
  'centros_custo',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    descricao: text('descricao').notNull(), // ex: 'COMPRA DE MERCADORIA', 'DESOSSA'
    ativo: integer('ativo').notNull().default(1),
  },
  (t) => [uniqueIndex('uq_centros_custo_tenant_cod').on(t.tenantId, t.codigo)]
)

export const naturezasOperacao = pgTable(
  'naturezas_operacao',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tipoMovimento: text('tipo_movimento').notNull(), // ENTRADA | SAIDA | INDUSTRIALIZACAO
    finalidade: text('finalidade').notNull(), // REVENDA | MATERIA_PRIMA | REMESSA_IND | RETORNO_IND | CONSUMO
    descricao: text('descricao').notNull(),
    cfopEstadual: text('cfop_estadual').notNull(),
    cfopInterestadual: text('cfop_interestadual').notNull(),
    codigoSubOperacao: text('codigo_sub_operacao').notNull().default('01'),
    ativo: integer('ativo').notNull().default(1),
  },
  (t) => [index('idx_naturezas_tenant').on(t.tenantId)]
)

export const matrizTributaria = pgTable(
  'matriz_tributaria',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ncm: text('ncm').notNull(),
    ufOrigem: text('uf_origem').notNull(),
    ufDestino: text('uf_destino').notNull(),
    regimeTributario: text('regime_tributario').notNull().default('SIMPLES'),
    cstCsosn: text('cst_csosn').notNull().default(''),
    aliqIcms: numeric('aliq_icms', { precision: 6, scale: 2 }).notNull().default('0'),
    reducaoBaseIcmsPct: numeric('reducao_base_icms_pct', { precision: 6, scale: 2 }).notNull().default('0'),
    aliqIcmsSt: numeric('aliq_icms_st', { precision: 6, scale: 2 }).notNull().default('0'),
    validadoPorContador: text('validado_por_contador').notNull().default(''),
    updatedById: uuid('updated_by_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_matriz_trib_tenant_ncm').on(t.tenantId, t.ncm)]
)

export const fornecedores = pgTable(
  'fornecedores',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo'),
    razaoSocial: text('razao_social').notNull(),
    nomeFantasia: text('nome_fantasia').notNull(),
    cnpjCpf: text('cnpj_cpf').notNull().default(''),
    inscricaoEstadual: text('inscricao_estadual').notNull().default(''),
    endereco: text('endereco').notNull().default(''),
    numero: text('numero').notNull().default(''),
    complemento: text('complemento').notNull().default(''),
    bairro: text('bairro').notNull().default(''),
    cep: text('cep').notNull().default(''),
    uf: text('uf').notNull().default('SP'),
    cidade: text('cidade').notNull().default(''),
    telefone: text('telefone').notNull().default(''),
    email: text('email').notNull().default(''),
    cnaePrincipal: text('cnae_principal').notNull().default(''),
    regimeApuracao: text('regime_apuracao').notNull().default(''),
    situacaoCadastral: text('situacao_cadastral').notNull().default(''),
    registroSanitarioSif: text('registro_sanitario_sif').notNull().default(''),
    prazoEntregaDias: integer('prazo_entrega_dias').notNull().default(5),
    ativo: integer('ativo').notNull().default(1),
    inativadoEm: timestamp('inativado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_fornecedores_tenant').on(t.tenantId),
    uniqueIndex('uq_fornecedores_tenant_codigo').on(t.tenantId, t.codigo),
  ]
)

export const clientes = pgTable(
  'clientes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    codigo: text('codigo'),
    razaoSocial: text('razao_social').notNull(),
    nomeFantasia: text('nome_fantasia').notNull(),
    cnpjCpf: text('cnpj_cpf').notNull().default(''),
    rg: text('rg').notNull().default(''),
    dataNascimento: date('data_nascimento'),
    tipoCliente: text('tipo_cliente').notNull().default('AMBOS'), // ATACADO | VAREJO | AMBOS
    inscricaoEstadual: text('inscricao_estadual').notNull().default(''),
    endereco: text('endereco').notNull().default(''),
    numero: text('numero').notNull().default(''),
    complemento: text('complemento').notNull().default(''),
    bairro: text('bairro').notNull().default(''),
    cep: text('cep').notNull().default(''),
    cidade: text('cidade').notNull().default(''),
    uf: text('uf').notNull().default('SP'),
    pais: text('pais').notNull().default('BRASIL'),
    telefone: text('telefone').notNull().default(''),
    icms: text('icms').notNull().default('CONTRIBUINTE'),
    vendedorPadraoId: uuid('vendedor_padrao_id').references(() => vendedores.id, { onDelete: 'set null' }),
    formaPagamentoPadraoId: uuid('forma_pagamento_padrao_id').references(() => formasPagamento.id, {
      onDelete: 'set null',
    }),
    localCobrancaPadraoId: uuid('local_cobranca_padrao_id').references(() => locaisCobranca.id, {
      onDelete: 'set null',
    }),
    marchantePadrao: text('marchante_padrao').notNull().default(''),
    rotaPadraoNome: text('rota_padrao_nome').notNull().default(''),
    limiteCredito: numeric('limite_credito', { precision: 14, scale: 2 }).notNull().default('0'),
    crediarioAtivo: integer('crediario_ativo').notNull().default(0),
    prazoCrediarioDias: integer('prazo_crediario_dias').notNull().default(30),
    descontoAtivo: integer('desconto_ativo').notNull().default(0),
    descontoMaxPct: numeric('desconto_max_pct', { precision: 6, scale: 2 }).notNull().default('0'),
    tabelaPrecoId: uuid('tabela_preco_id'),
    bloqueadoFinanceiro: integer('bloqueado_financeiro').notNull().default(0),
    permitePagamentoEntrega: integer('permite_pagamento_entrega').notNull().default(1),
    naoFaturar: integer('nao_faturar').notNull().default(0),
    naoFaturarDefinidoManual: integer('nao_faturar_definido_manual').notNull().default(0),
    isPadrao: integer('is_padrao').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
    inativadoEm: timestamp('inativado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_clientes_tenant').on(t.tenantId),
    uniqueIndex('uq_clientes_tenant_codigo').on(t.tenantId, t.codigo),
  ]
)

export const transportadoras = pgTable(
  'transportadoras',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo'),
    razaoSocial: text('razao_social').notNull(),
    nomeFantasia: text('nome_fantasia').notNull(),
    cnpjCpf: text('cnpj_cpf').notNull().default(''),
    inscricaoEstadual: text('inscricao_estadual').notNull().default(''),
    endereco: text('endereco').notNull().default(''),
    numero: text('numero').notNull().default(''),
    bairro: text('bairro').notNull().default(''),
    cep: text('cep').notNull().default(''),
    uf: text('uf').notNull().default('SP'),
    cidade: text('cidade').notNull().default(''),
    telefone: text('telefone').notNull().default(''),
    rntrcAntt: text('rntrc_antt').notNull().default(''),
    placaPadrao: text('placa_padrao').notNull().default(''),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_transportadoras_tenant').on(t.tenantId)]
)

export const transportadoraVeiculos = pgTable(
  'transportadora_veiculos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    transportadoraId: uuid('transportadora_id')
      .notNull()
      .references(() => transportadoras.id, { onDelete: 'cascade' }),
    placa: text('placa').notNull(),
    ufPlaca: text('uf_placa').notNull().default('SP'),
    modelo: text('modelo').notNull().default(''),
    rntrcAntt: text('rntrc_antt').notNull().default(''),
    capacidadeKg: numeric('capacidade_kg', { precision: 14, scale: 2 }),
    motoristaPadrao: text('motorista_padrao').notNull().default(''),
    padrao: integer('padrao').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_transp_veic_tenant_transp').on(t.tenantId, t.transportadoraId),
    uniqueIndex('uq_transp_veic_placa').on(t.tenantId, t.transportadoraId, t.placa),
  ]
)

export const clienteProdutoEspec = pgTable(
  'cliente_produto_espec',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => clientes.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    codigoAuxCliente: text('codigo_aux_cliente').notNull().default(''),
    especificacaoCorte: text('especificacao_corte').notNull().default(''),
    precoNegociado: numeric('preco_negociado', { precision: 14, scale: 4 }),
    ultimaVendaPreco: numeric('ultima_venda_preco', { precision: 14, scale: 4 }),
    alertaReclamacao: integer('alerta_reclamacao').notNull().default(0),
    alertaDescricao: text('alerta_descricao').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_cli_prod_espec').on(t.tenantId, t.clienteId, t.produtoId)]
)

export const marchantes = pgTable(
  'marchantes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    nome: text('nome').notNull(),
    isPadrao: integer('is_padrao').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_marchantes_tenant_cod').on(t.tenantId, t.codigo)]
)

export const tiposVeiculo = pgTable(
  'tipos_veiculo',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    categoria: text('categoria').notNull().default('UTILITARIO'), // UTILITARIO | VAN | CAMINHAO | CARRETA | OUTRO
    capacidadeKg: numeric('capacidade_kg', { precision: 14, scale: 2 }).notNull().default('650'),
    toleranciaPct: numeric('tolerancia_pct', { precision: 6, scale: 2 }).notNull().default('10'),
    observacoes: text('observacoes').notNull().default(''),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_tipos_veiculo_tenant').on(t.tenantId, t.ativo)]
)

export const fornecedorProdutoDepara = pgTable(
  'fornecedor_produto_depara',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id')
      .notNull()
      .references(() => fornecedores.id, { onDelete: 'cascade' }),
    codigoFornecedor: text('codigo_fornecedor').notNull(),
    descricaoFornecedor: text('descricao_fornecedor').notNull().default(''),
    ncm: text('ncm').notNull().default(''),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    fatorConversao: numeric('fator_conversao', { precision: 14, scale: 4 }).notNull().default('1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_depara_forn_cod').on(t.tenantId, t.fornecedorId, t.codigoFornecedor),
    index('idx_depara_prod').on(t.tenantId, t.produtoId),
  ]
)

export const layoutsImportacaoTxt = pgTable(
  'layouts_importacao_txt',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedores.id, { onDelete: 'set null' }),
    nome: text('nome').notNull(),
    tipoArquivo: text('tipo_arquivo').notNull().default('DELIMITADO'), // DELIMITADO | POSICIONAL
    delimitador: text('delimitador').notNull().default(';'),
    saltarLinhas: integer('saltar_linhas').notNull().default(0),
    formatoData: text('formato_data').notNull().default('DDMMYYYY'), // DDMMYYYY | DD/MM/YYYY | YYYY-MM-DD
    decimalPonto: integer('decimal_ponto').notNull().default(0),
    mapeamentoJson: jsonb('mapeamento_json').$type<Record<string, number>>().notNull().default({}),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_layouts_txt_tenant').on(t.tenantId, t.ativo)]
)
