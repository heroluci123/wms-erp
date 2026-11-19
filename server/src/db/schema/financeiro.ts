import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { tenants, filiais } from './saas.js'
import { operadores, vendedores } from './auth.js'
import {
  centrosCusto,
  clientes,
  formasPagamento,
  fornecedores,
  locaisCobranca,
} from './cadastros.js'
import { pedidosCompra, recebimentos } from './estoque.js'
import { pedidos } from './operacao.js'

export const financeiroContasBancarias = pgTable(
  'financeiro_contas_bancarias',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').references(() => filiais.id, { onDelete: 'set null' }),
    codigo: text('codigo').notNull(),
    nome: text('nome').notNull(),
    tipo: text('tipo').notNull().default('CONTA_CORRENTE'), // CONTA_CORRENTE | CAIXA_FISICO | CARTEIRA_PIX | POUPANCA
    bancoCodigo: text('banco_codigo').notNull().default(''),
    agencia: text('agencia').notNull().default(''),
    conta: text('conta').notNull().default(''),
    chavePix: text('chave_pix').notNull().default(''),
    localCobrancaId: uuid('local_cobranca_id').references(() => locaisCobranca.id, { onDelete: 'set null' }),
    saldoInicial: numeric('saldo_inicial', { precision: 14, scale: 2 }).notNull().default('0'),
    saldoAtual: numeric('saldo_atual', { precision: 14, scale: 2 }).notNull().default('0'),
    padrao: integer('padrao').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fin_contas_tenant_cod').on(t.tenantId, t.codigo),
    index('idx_fin_contas_tenant').on(t.tenantId, t.ativo),
  ]
)

export const financeiroTitulos = pgTable(
  'financeiro_titulos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    tipo: text('tipo').notNull(), // PAGAR | RECEBER
    origem: text('origem').notNull().default('MANUAL'), // MANUAL | COMPRA_PC | COMPRA_NFE_XML | VENDA_PEDIDO | DEVOLUCAO | COMISSAO
    descricao: text('descricao').notNull(),
    numeroDocumento: text('numero_documento').notNull().default(''),
    parcelaNum: integer('parcela_num').notNull().default(1),
    parcelaTotal: integer('parcela_total').notNull().default(1),
    fornecedorId: uuid('fornecedor_id').references(() => fornecedores.id, { onDelete: 'set null' }),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    vendedorId: uuid('vendedor_id').references(() => vendedores.id, { onDelete: 'set null' }),
    pedidoCompraId: uuid('pedido_compra_id').references(() => pedidosCompra.id, { onDelete: 'set null' }),
    recebimentoId: uuid('recebimento_id').references(() => recebimentos.id, { onDelete: 'set null' }),
    pedidoVendaId: uuid('pedido_venda_id').references(() => pedidos.id, { onDelete: 'set null' }),
    centroCustoId: uuid('centro_custo_id').references(() => centrosCusto.id, { onDelete: 'set null' }),
    formaPagamentoId: uuid('forma_pagamento_id').references(() => formasPagamento.id, { onDelete: 'set null' }),
    contaBancariaId: uuid('conta_bancaria_id').references(() => financeiroContasBancarias.id, { onDelete: 'set null' }),
    dataEmissao: date('data_emissao').notNull(),
    dataVencimento: date('data_vencimento').notNull(),
    dataPagamento: date('data_pagamento'),
    valorOriginal: numeric('valor_original', { precision: 14, scale: 2 }).notNull(),
    valorDesconto: numeric('valor_desconto', { precision: 14, scale: 2 }).notNull().default('0'),
    valorJurosMulta: numeric('valor_juros_multa', { precision: 14, scale: 2 }).notNull().default('0'),
    valorPago: numeric('valor_pago', { precision: 14, scale: 2 }).notNull().default('0'),
    saldoAberto: numeric('saldo_aberto', { precision: 14, scale: 2 }).notNull(),
    status: text('status').notNull().default('ABERTO'), // ABERTO | PARCIAL | PAGO | CANCELADO
    formaPagamentoEfetiva: text('forma_pagamento_efetiva').notNull().default(''),
    observacoes: text('observacoes').notNull().default(''),
    criadoPorId: uuid('criado_por_id').references(() => operadores.id, { onDelete: 'set null' }),
    criadoPorNome: text('criado_por_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fin_titulos_tenant_cod').on(t.tenantId, t.codigo),
    index('idx_fin_titulos_tipo_status_venc').on(t.tenantId, t.tipo, t.status, t.dataVencimento),
    index('idx_fin_titulos_cliente').on(t.tenantId, t.clienteId, t.status),
    index('idx_fin_titulos_fornecedor').on(t.tenantId, t.fornecedorId, t.status),
    index('idx_fin_titulos_pedido_venda').on(t.tenantId, t.pedidoVendaId),
    index('idx_fin_titulos_pedido_compra').on(t.tenantId, t.pedidoCompraId),
    index('idx_fin_titulos_recebimento').on(t.tenantId, t.recebimentoId),
  ]
)

export const financeiroMovimentacoes = pgTable(
  'financeiro_movimentacoes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    contaBancariaId: uuid('conta_bancaria_id')
      .notNull()
      .references(() => financeiroContasBancarias.id, { onDelete: 'cascade' }),
    tituloId: uuid('titulo_id').references(() => financeiroTitulos.id, { onDelete: 'set null' }),
    tipo: text('tipo').notNull(), // ENTRADA | SAIDA
    categoria: text('categoria').notNull().default('LANCAMENTO_AVULSO'), // RECEBIMENTO_TITULO | PAGAMENTO_TITULO | ESTORNO | TRANSFERENCIA | LANCAMENTO_AVULSO | AJUSTE_SALDO
    dataMovimento: date('data_movimento').notNull(),
    valor: numeric('valor', { precision: 14, scale: 2 }).notNull(),
    formaPagamento: text('forma_pagamento').notNull().default(''),
    historico: text('historico').notNull(),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_fin_mov_conta_data').on(t.tenantId, t.contaBancariaId, t.dataMovimento),
    index('idx_fin_mov_titulo').on(t.tituloId),
  ]
)
