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
import { sql } from 'drizzle-orm'
import { tenants, empresas, filiais } from './saas.js'

export const colaboradores = pgTable(
  'colaboradores',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id').references(() => filiais.id, { onDelete: 'set null' }),
    nome: text('nome').notNull(),
    cpf: text('cpf').notNull().default(''),
    cargo: text('cargo').notNull().default('Operador'),
    setor: text('setor').notNull().default('Produção'),
    salarioBase: numeric('salario_base', { precision: 14, scale: 2 }).notNull().default('0'),
    custoHora: numeric('custo_hora', { precision: 14, scale: 4 }).notNull().default('0'),
    asoValidade: date('aso_validade'),
    epiObs: text('epi_obs').notNull().default(''),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_colaboradores_tenant').on(t.tenantId)]
)

export const operadores = pgTable(
  'operadores',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade' }),
    filialPadraoId: uuid('filial_padrao_id').references(() => filiais.id, { onDelete: 'set null' }),
    colaboradorId: uuid('colaborador_id').references(() => colaboradores.id, { onDelete: 'set null' }),
    legacyId: integer('legacy_id'),
    nome: text('nome').notNull(),
    login: text('login').notNull(),
    pin: text('pin').notNull().default('****'),
    senhaHash: text('senha_hash').notNull(),
    perfil: text('perfil').notNull().default('OPERADOR'),
    nivel: text('nivel').notNull().default('OPERACIONAL'),
    setor: text('setor').notNull().default('Produção'),
    isAdm: integer('is_adm').notNull().default(0),
    ativo: integer('ativo').notNull().default(1),
    deveTrocarSenha: integer('deve_trocar_senha').notNull().default(0),
    permissoesJson: jsonb('permissoes_json').$type<Record<string, boolean>>().notNull().default({}),
    ultimoAcesso: timestamp('ultimo_acesso', { withTimezone: true }),
    criadoPorNome: text('criado_por_nome'),
    atualizadoPorNome: text('atualizado_por_nome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_operadores_tenant').on(t.tenantId),
    uniqueIndex('uq_operadores_tenant_login_lower').on(t.tenantId, sql`LOWER(${t.login})`),
  ]
)

export const perfisAcesso = pgTable(
  'perfis_acesso',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id'),
    codigo: text('codigo').notNull(),
    nome: text('nome').notNull(),
    nivel: text('nivel').notNull().default('OPERACIONAL'),
    setorPadrao: text('setor_padrao').notNull().default('Produção'),
    descricao: text('descricao').notNull().default(''),
    permissoesJson: jsonb('permissoes_json').$type<Record<string, boolean>>().notNull().default({}),
    sistemaFixo: integer('sistema_fixo').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_perfis_tenant_codigo').on(t.tenantId, t.codigo)]
)

export const sessoesUsuarios = pgTable(
  'sessoes_usuarios',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    operadorId: uuid('operador_id')
      .notNull()
      .references(() => operadores.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    deviceInfo: text('device_info').notNull().default('web'),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ultimoPing: timestamp('ultimo_ping', { withTimezone: true }).notNull().defaultNow(),
    encerradaEm: timestamp('encerrada_em', { withTimezone: true }),
  },
  (t) => [
    index('idx_sessoes_token').on(t.token),
    index('idx_sessoes_operador_ativo').on(t.operadorId, t.ativo),
  ]
)

export const auditoriaAcessos = pgTable(
  'auditoria_acessos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id'),
    targetUserNome: text('target_user_nome').notNull().default(''),
    acao: text('acao').notNull(),
    detalhesAntes: jsonb('detalhes_antes'),
    detalhesDepois: jsonb('detalhes_depois'),
    executorId: uuid('executor_id'),
    executorNome: text('executor_nome').notNull().default('Sistema'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_auditoria_tenant_data').on(t.tenantId, t.createdAt)]
)

export const vendedores = pgTable(
  'vendedores',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    colaboradorId: uuid('colaborador_id').references(() => colaboradores.id, { onDelete: 'set null' }),
    codigo: text('codigo').notNull(),
    sigla: text('sigla').notNull().default(''),
    nome: text('nome').notNull(),
    tipoComissao: text('tipo_comissao').notNull().default('PCT_VENDA'), // PCT_VENDA | PCT_MARGEM | VALOR_KG
    pctComissao: numeric('pct_comissao', { precision: 7, scale: 3 }).notNull().default('0'),
    regraLiberacao: text('regra_liberacao').notNull().default('FATURAMENTO'), // FATURAMENTO | LIQUIDACAO
    metaMensalKg: numeric('meta_mensal_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    metaMensalValor: numeric('meta_mensal_valor', { precision: 14, scale: 2 }).notNull().default('0'),
    ativo: integer('ativo').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_vendedores_tenant').on(t.tenantId),
    uniqueIndex('uq_vendedores_tenant_codigo').on(t.tenantId, t.codigo),
  ]
)
