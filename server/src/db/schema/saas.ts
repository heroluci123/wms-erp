import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  nomeConta: text('nome_conta').notNull(),
  slug: text('slug').notNull().unique(),
  plano: text('plano').notNull().default('PRO'),
  statusAssinatura: text('status_assinatura').notNull().default('ATIVO'),
  limiteUsuarios: integer('limite_usuarios').notNull().default(50),
  featuresJson: jsonb('features_json').$type<Record<string, boolean>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const empresas = pgTable(
  'empresas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull().default('1'),
    razaoSocial: text('razao_social').notNull(),
    nomeFantasia: text('nome_fantasia').notNull(),
    cnpj: text('cnpj').notNull().default(''),
    inscricaoEstadual: text('inscricao_estadual').notNull().default(''),
    regimeTributario: text('regime_tributario').notNull().default('SIMPLES'),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_empresas_tenant').on(t.tenantId),
    uniqueIndex('uq_empresas_tenant_codigo').on(t.tenantId, t.codigo),
  ]
)

export const filiais = pgTable(
  'filiais',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull().default('1'),
    nome: text('nome').notNull(),
    tipoUnidade: text('tipo_unidade').notNull().default('DISTRIBUICAO'), // VAREJO | DISTRIBUICAO | INDUSTRIA
    cnpj: text('cnpj').notNull().default(''),
    inscricaoEstadual: text('inscricao_estadual').notNull().default(''),
    uf: text('uf').notNull().default('SP'),
    cidade: text('cidade').notNull().default(''),
    codigoIbge: text('codigo_ibge').notNull().default(''),
    registroSanitarioTipo: text('registro_sanitario_tipo').notNull().default('SIF'), // DIPOA | SIF | SISBI | SIM | NENHUM
    registroSanitarioNum: text('registro_sanitario_num').notNull().default(''),
    isPadrao: integer('is_padrao').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_filiais_tenant').on(t.tenantId),
    uniqueIndex('uq_filiais_empresa_codigo').on(t.tenantId, t.empresaId, t.codigo),
  ]
)
