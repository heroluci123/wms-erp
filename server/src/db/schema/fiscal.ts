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
import { clientes } from './cadastros.js'
import { devolucoes, pedidos } from './operacao.js'

export const fiscalConfigFilial = pgTable(
  'fiscal_config_filial',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    ambiente: text('ambiente').notNull().default('HOMOLOGACAO'), // HOMOLOGACAO | PRODUCAO
    provedor: text('provedor').notNull().default('SIMULACAO_LOCAL'), // SIMULACAO_LOCAL | SEFAZ_DIRETO_A1 | FOCUS_NFE | NUVEM_FISCAL | TECNOSPEED
    serieNfe: integer('serie_nfe').notNull().default(1),
    proximoNumeroNfe: integer('proximo_numero_nfe').notNull().default(1),
    serieNfce: integer('serie_nfce').notNull().default(1),
    proximoNumeroNfce: integer('proximo_numero_nfce').notNull().default(1),
    cscId: text('csc_id').notNull().default(''),
    cscToken: text('csc_token').notNull().default(''),
    certificadoNome: text('certificado_nome').notNull().default(''),
    certificadoPfxBase64: text('certificado_pfx_base64').notNull().default(''),
    certificadoSenhaEnc: text('certificado_senha_enc').notNull().default(''),
    certificadoValidade: date('certificado_validade'),
    certificadoTitular: text('certificado_titular').notNull().default(''),
    certificadoCnpj: text('certificado_cnpj').notNull().default(''),
    gatewayApiTokenEnc: text('gateway_api_token_enc').notNull().default(''),
    infComplementarPadrao: text('inf_complementar_padrao')
      .notNull()
      .default(
        'ICMS com redução de base de cálculo (Cesta Básica Carnes). PIS/COFINS alíquota zero conforme Lei 10.925/2004.',
      ),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_fiscal_cfg_tenant_filial').on(t.tenantId, t.filialId)]
)

export const fiscalNotas = pgTable(
  'fiscal_notas',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    modelo: text('modelo').notNull().default('55'), // '55' (NF-e) | '65' (NFC-e)
    tipoOperacao: text('tipo_operacao').notNull().default('SAIDA'), // SAIDA | DEVOLUCAO | ENTRADA
    finalidade: text('finalidade').notNull().default('1'), // '1' Normal | '4' Devolucao
    ambiente: text('ambiente').notNull().default('HOMOLOGACAO'),
    provedorUsado: text('provedor_usado').notNull().default('SIMULACAO_LOCAL'),
    serie: integer('serie').notNull().default(1),
    numero: integer('numero').notNull(),
    chaveAcesso: text('chave_acesso').notNull(),
    protocoloAutorizacao: text('protocolo_autorizacao').notNull().default(''),
    dataAutorizacao: timestamp('data_autorizacao', { withTimezone: true }),
    status: text('status').notNull().default('AUTORIZADA'), // RASCUNHO | AUTORIZADA | REJEITADA | CANCELADA | DENEGADA
    naturezaOperacao: text('natureza_operacao').notNull().default('VENDA DE MERCADORIA'),
    pedidoId: uuid('pedido_id').references(() => pedidos.id, { onDelete: 'set null' }),
    devolucaoId: uuid('devolucao_id').references(() => devolucoes.id, { onDelete: 'set null' }),
    clienteId: uuid('cliente_id').references(() => clientes.id, { onDelete: 'set null' }),
    destinatarioNome: text('destinatario_nome').notNull().default('CONSUMIDOR FINAL'),
    destinatarioDoc: text('destinatario_doc').notNull().default(''),
    destinatarioIe: text('destinatario_ie').notNull().default(''),
    destinatarioUf: text('destinatario_uf').notNull().default('SP'),
    destinatarioCidade: text('destinatario_cidade').notNull().default(''),
    destinatarioEndereco: text('destinatario_endereco').notNull().default(''),
    formaPagamentoLabel: text('forma_pagamento_label').notNull().default('99 - Outros'),
    valorProdutos: numeric('valor_produtos', { precision: 14, scale: 2 }).notNull().default('0'),
    valorDesconto: numeric('valor_desconto', { precision: 14, scale: 2 }).notNull().default('0'),
    valorFrete: numeric('valor_frete', { precision: 14, scale: 2 }).notNull().default('0'),
    valorIcmsBase: numeric('valor_icms_base', { precision: 14, scale: 2 }).notNull().default('0'),
    valorIcms: numeric('valor_icms', { precision: 14, scale: 2 }).notNull().default('0'),
    valorIcmsSt: numeric('valor_icms_st', { precision: 14, scale: 2 }).notNull().default('0'),
    valorPis: numeric('valor_pis', { precision: 14, scale: 2 }).notNull().default('0'),
    valorCofins: numeric('valor_cofins', { precision: 14, scale: 2 }).notNull().default('0'),
    valorTotalNf: numeric('valor_total_nf', { precision: 14, scale: 2 }).notNull().default('0'),
    pesoBrutoKg: numeric('peso_bruto_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    pesoLiquidoKg: numeric('peso_liquido_kg', { precision: 14, scale: 3 }).notNull().default('0'),
    qtdVolumes: integer('qtd_volumes').notNull().default(0),
    itensJson: jsonb('itens_json').$type<Array<Record<string, unknown>>>().notNull().default([]),
    xmlConteudo: text('xml_conteudo').notNull().default(''),
    xmlCancelamento: text('xml_cancelamento').notNull().default(''),
    motivoCancelamento: text('motivo_cancelamento').notNull().default(''),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    infComplementar: text('inf_complementar').notNull().default(''),
    emitidaPorId: uuid('emitida_por_id').references(() => operadores.id, { onDelete: 'set null' }),
    emitidaPorNome: text('emitida_por_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fiscal_nota_num').on(t.tenantId, t.filialId, t.modelo, t.serie, t.numero),
    uniqueIndex('uq_fiscal_nota_chave').on(t.tenantId, t.chaveAcesso),
    index('idx_fiscal_nota_status').on(t.tenantId, t.filialId, t.modelo, t.status),
    index('idx_fiscal_nota_pedido').on(t.tenantId, t.pedidoId),
  ]
)

export const fiscalEventos = pgTable(
  'fiscal_eventos',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filialId: uuid('filial_id')
      .notNull()
      .references(() => filiais.id, { onDelete: 'cascade' }),
    notaId: uuid('nota_id').references(() => fiscalNotas.id, { onDelete: 'cascade' }),
    tipoEvento: text('tipo_evento').notNull(), // CARTA_CORRECAO | CANCELAMENTO | INUTILIZACAO
    sequencia: integer('sequencia').notNull().default(1),
    modelo: text('modelo').notNull().default('55'),
    serie: integer('serie').notNull().default(1),
    numeroInicial: integer('numero_inicial').notNull().default(0),
    numeroFinal: integer('numero_final').notNull().default(0),
    descricao: text('descricao').notNull(),
    protocolo: text('protocolo').notNull().default(''),
    xmlEvento: text('xml_evento').notNull().default(''),
    operadorId: uuid('operador_id').references(() => operadores.id, { onDelete: 'set null' }),
    operadorNome: text('operador_nome').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_fiscal_ev_nota').on(t.notaId),
    index('idx_fiscal_ev_tenant').on(t.tenantId, t.filialId, t.tipoEvento),
  ]
)
