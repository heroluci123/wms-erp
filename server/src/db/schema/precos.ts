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
import { produtos } from './cadastros.js'

// ── TABELAS DE PREÇO (VAREJO / PDV / AÇOUGUE / PROMOCIONAL / CLIENTE / ATACADO) ─
export const tabelasPreco = pgTable(
  'tabelas_preco',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').references(() => filiais.id, { onDelete: 'set null' }),
    codigo: text('codigo').notNull(),
    nome: text('nome').notNull(),
    finalidade: text('finalidade').notNull().default('VAREJO_PDV'), // VAREJO_PDV | ACOUGUE_BALANCA | PROMOCIONAL | CLIENTE | ATACADO
    padrao: integer('padrao').notNull().default(0),
    descontoPadraoPct: numeric('desconto_padrao_pct', { precision: 6, scale: 2 }).notNull().default('0'),
    dataInicio: date('data_inicio'),
    dataFim: date('data_fim'),
    observacoes: text('observacoes').notNull().default(''),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_tabelas_preco_codigo').on(t.tenantId, t.codigo),
    index('idx_tabelas_preco_finalidade').on(t.tenantId, t.finalidade, t.ativo),
  ]
)

export const tabelasPrecoItens = pgTable(
  'tabelas_preco_itens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tabelaPrecoId: uuid('tabela_preco_id')
      .notNull()
      .references(() => tabelasPreco.id, { onDelete: 'cascade' }),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produtos.id, { onDelete: 'cascade' }),
    precoVenda: numeric('preco_venda', { precision: 14, scale: 4 }).notNull().default('0'),
    precoPromocional: numeric('preco_promocional', { precision: 14, scale: 4 }),
    descontoPct: numeric('desconto_pct', { precision: 6, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_tabela_preco_item_prod').on(t.tabelaPrecoId, t.produtoId),
    index('idx_tabela_preco_itens_tab').on(t.tenantId, t.tabelaPrecoId),
  ]
)

export const acougueConfigFilial = pgTable(
  'acougue_config_filial',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    tabelaAtivaId: uuid('tabela_ativa_id').references(() => tabelasPreco.id, { onDelete: 'set null' }),
    tabelaPadraoId: uuid('tabela_padrao_id').references(() => tabelasPreco.id, { onDelete: 'set null' }),
    alteradaPorId: uuid('alterada_por_id').references(() => operadores.id, { onDelete: 'set null' }),
    alteradaPorNome: text('alterada_por_nome').notNull().default(''),
    alteradaEm: timestamp('alterada_em', { withTimezone: true }),
    motivo: text('motivo').notNull().default(''),
    historicoJson: jsonb('historico_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_acougue_cfg_filial').on(t.tenantId, t.filialId)]
)
