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
import { centrosCusto, clientes, produtos } from './cadastros.js'
import { estoqueCaixas } from './estoque.js'
import { ordensProducao } from './operacao.js'
import { financeiroContasBancarias } from './financeiro.js'
import { fiscalNotas } from './fiscal.js'

// ── ESTOQUE DO VAREJO / FILIAL LOJA (1/1 — AÇOUGUE & EMPÓRIO) ───────────────
export const varejoEstoque = pgTable(
  'varejo_estoque',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    unidadeVenda: text('unidade_venda').notNull().default('KG'), // KG | UN
    saldoQtd: numeric('saldo_qtd', { precision: 14, scale: 3 }).notNull().default('0'),
    precoVendaVarejo: numeric('preco_venda_varejo', { precision: 14, scale: 4 }).notNull().default('0'),
    estoqueMinimo: numeric('estoque_minimo', { precision: 14, scale: 3 }).notNull().default('0'),
    codigoBalanca: text('codigo_balanca').notNull().default(''),
    setorLoja: text('setor_loja').notNull().default('ACOUGUE'), // ACOUGUE | EMPORIO
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_varejo_est_filial_prod').on(t.tenantId, t.filialId, t.produtoId),
    index('idx_varejo_est_balanca').on(t.tenantId, t.filialId, t.codigoBalanca),
  ]
)

export const varejoMovimentacoes = pgTable(
  'varejo_movimentacoes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(), // ENTRADA_TRANSFERENCIA | VENDA_PDV | ESTORNO_PDV | INVENTARIO_AJUSTE | QUEBRA_BALCAO | ENTRADA_COMPRA | AJUSTE_MANUAL
    qtd: numeric('qtd', { precision: 14, scale: 3 }).notNull(),
    saldoAnterior: numeric('saldo_anterior', { precision: 14, scale: 3 }).notNull().default('0'),
    saldoNovo: numeric('saldo_novo', { precision: 14, scale: 3 }).notNull().default('0'),
    referenciaTipo: text('referencia_tipo').notNull().default(''),
    referenciaId: uuid('referencia_id'),
    observacao: text('observacao').notNull().default(''),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default('Sistema'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_varejo_mov_filial_data').on(t.tenantId, t.filialId, t.createdAt)]
)

// ── PDV FRENTE DE CAIXA (LOJA 1/1) ──────────────────────────────────────────
export const pdvCaixas = pgTable(
  'pdv_caixas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    contaBancariaId: uuid('conta_bancaria_id').references(() => financeiroContasBancarias.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('ABERTO'), // ABERTO | FECHADO
    saldoAbertura: numeric('saldo_abertura', { precision: 14, scale: 2 }).notNull().default('0'),
    totalVendas: numeric('total_vendas', { precision: 14, scale: 2 }).notNull().default('0'),
    totalDinheiro: numeric('total_dinheiro', { precision: 14, scale: 2 }).notNull().default('0'),
    totalPix: numeric('total_pix', { precision: 14, scale: 2 }).notNull().default('0'),
    totalDebito: numeric('total_debito', { precision: 14, scale: 2 }).notNull().default('0'),
    totalCredito: numeric('total_credito', { precision: 14, scale: 2 }).notNull().default('0'),
    totalSuprimentos: numeric('total_suprimentos', { precision: 14, scale: 2 }).notNull().default('0'),
    totalSangrias: numeric('total_sangrias', { precision: 14, scale: 2 }).notNull().default('0'),
    saldoEsperadoDinheiro: numeric('saldo_esperado_dinheiro', { precision: 14, scale: 2 }).notNull().default('0'),
    saldoInformadoFechamento: numeric('saldo_informado_fechamento', { precision: 14, scale: 2 }),
    diferencaQuebra: numeric('diferenca_quebra', { precision: 14, scale: 2 }),
    observacoes: text('observacoes').notNull().default(''),
    abertoEm: timestamp('aberto_em', { withTimezone: true }).notNull().defaultNow(),
    fechadoEm: timestamp('fechado_em', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_pdv_caixas_codigo').on(t.tenantId, t.codigo),
    index('idx_pdv_caixas_filial_status').on(t.tenantId, t.filialId, t.status),
  ]
)

export const pdvCaixaMovimentos = pgTable(
  'pdv_caixa_movimentos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id')
      .notNull()
      .references(() => pdvCaixas.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(), // SANGRIA | SUPRIMENTO
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    motivo: text('motivo').notNull().default(''),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pdv_cx_mov_caixa').on(t.caixaId)]
)

export const pdvVendas = pgTable(
  'pdv_vendas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id')
      .notNull()
      .references(() => pdvCaixas.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    clienteNome: text('cliente_nome').notNull().default('CONSUMIDOR FINAL'),
    clienteDoc: text('cliente_doc').notNull().default(''),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    descontoValor: numeric('desconto_valor', { precision: 14, scale: 2 }).notNull().default('0'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    trocoValor: numeric('troco_valor', { precision: 14, scale: 2 }).notNull().default('0'),
    pagamentosJson: jsonb('pagamentos_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    itensJson: jsonb('itens_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    status: text('status').notNull().default('CONCLUIDA'), // CONCLUIDA | CANCELADA
    notaFiscalId: uuid('nota_fiscal_id').references(() => fiscalNotas.id, { onDelete: 'set null' }),
    numeroNfce: integer('numero_nfce'),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    motivoCancelamento: text('motivo_cancelamento').notNull().default(''),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_pdv_vendas_codigo').on(t.tenantId, t.codigo),
    index('idx_pdv_vendas_caixa').on(t.caixaId),
  ]
)

export const varejoInventarios = pgTable(
  'varejo_inventarios',
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
    status: text('status').notNull().default('ABERTO'), // ABERTO | CONCLUIDO
    totalItens: integer('total_itens').notNull().default(0),
    totalDivergencias: integer('total_divergencias').notNull().default(0),
    itensJson: jsonb('itens_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_varejo_inv_codigo').on(t.tenantId, t.codigo)]
)

// ── MOVIMENTAÇÃO INTER-UNIDADES (1/2 -> 1/1 | 1/2 -> 2/1 | 2/1 -> 1/2) ──────
export const interunidadesMovimentacoes = pgTable(
  'interunidades_movimentacoes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    tipoOperacao: text('tipo_operacao').notNull(), // TRANSFERENCIA_LOJA | REMESSA_IND | RETORNO_PROD
    filialOrigemId: uuid('filial_origem_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    filialDestinoId: uuid('filial_destino_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    caixaId: uuid('caixa_id').references(() => estoqueCaixas.id, { onDelete: 'set null' }),
    eanCaixa: text('ean_caixa').notNull().default(''),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    produtoCodigo: text('produto_codigo').notNull().default(''),
    produtoDescricao: text('produto_descricao').notNull().default(''),
    especie: text('especie').notNull().default('OUTROS'), // BOVINO | SUINO | AVES | OUTROS
    pesoKg: numeric('peso_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    valorUnitarioKg: numeric('valor_unitario_kg', { precision: 14, scale: 4 }).notNull().default('0'),
    valorTotal: numeric('valor_total', { precision: 14, scale: 2 }).notNull().default('0'),
    opId: uuid('op_id').references(() => ordensProducao.id, { onDelete: 'set null' }),
    requerFaturamento: integer('requer_faturamento').notNull().default(1),
    statusFiscal: text('status_fiscal').notNull().default('PENDENTE'), // PENDENTE | FATURADO | NAO_FATURAVEL | CANCELADO
    notaFiscalId: uuid('nota_fiscal_id').references(() => fiscalNotas.id, { onDelete: 'set null' }),
    numeroNf: integer('numero_nf'),
    dataMovimento: date('data_movimento').notNull(),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    observacao: text('observacao').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_interunid_codigo').on(t.tenantId, t.codigo),
    index('idx_interunid_tipo_status').on(t.tenantId, t.tipoOperacao, t.statusFiscal, t.dataMovimento),
  ]
)

// ── ALMOXARIFADO & COLETA MANUAL DE INSUMOS (PARÂMETRO ATIVÁVEL) ────────────
export const insumosEstoque = pgTable(
  'insumos_estoque',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    enderecoCodigo: text('endereco_codigo').notNull(),
    unidade: text('unidade').notNull().default('UN'), // UN | CX | RL | PCT | MIL | KG
    saldoAtual: numeric('saldo_atual', { precision: 14, scale: 3 }).notNull().default('0'),
    estoqueMinimo: numeric('estoque_minimo', { precision: 14, scale: 3 }).notNull().default('0'),
    custoUnitario: numeric('custo_unitario', { precision: 14, scale: 4 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_insumos_est_endereco').on(t.tenantId, t.filialId, t.enderecoCodigo),
    uniqueIndex('uq_insumos_est_produto').on(t.tenantId, t.filialId, t.produtoId),
  ]
)

export const insumosColetas = pgTable(
  'insumos_coletas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    insumoEstoqueId: uuid('insumo_estoque_id')
      .notNull()
      .references(() => insumosEstoque.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id),
    enderecoCodigo: text('endereco_codigo').notNull().default(''),
    tipo: text('tipo').notNull().default('COLETA_MANUAL'), // COLETA_MANUAL | ENTRADA_COMPRA | AJUSTE
    quantidade: numeric('quantidade', { precision: 14, scale: 3 }).notNull(),
    saldoAnterior: numeric('saldo_anterior', { precision: 14, scale: 3 }).notNull().default('0'),
    saldoNovo: numeric('saldo_novo', { precision: 14, scale: 3 }).notNull().default('0'),
    centroCustoId: uuid('centro_custo_id').references(() => centrosCusto.id, { onDelete: 'set null' }),
    setorDestino: text('setor_destino').notNull().default('PRODUCAO'),
    custoTotal: numeric('custo_total', { precision: 14, scale: 2 }).notNull().default('0'),
    observacao: text('observacao').notNull().default(''),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_insumos_coletas_filial_data').on(t.tenantId, t.filialId, t.createdAt)]
)
