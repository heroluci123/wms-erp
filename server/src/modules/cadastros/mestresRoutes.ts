import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  clientes,
  clienteProdutoEspec,
  empresas,
  filiais,
  formasPagamento,
  fornecedores,
  locaisCobranca,
  marchantes,
  matrizTributaria,
  naturezasOperacao,
  operadores,
  produtos,
  rotas,
  tiposVeiculo,
  transportadoras,
  transportadoraVeiculos,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { sugerirCfopOperacao } from '../wms/helpers.js'
import { uuidv7 } from '../../utils/uuid.js'
import { resolverCodigoCadastroOnCreate, resolverCodigoCadastroOnUpdate } from './codigoHelper.js'
import {
  avaliarExclusaoEmLoteClientes,
  avaliarExclusaoEmLoteFornecedores,
  executarExclusaoDefinitivaCliente,
  executarExclusaoDefinitivaFornecedor,
} from './exclusaoHelper.js'
import { consultarCnpjReceita, type ProvedorCnpj } from './cnpjLookup.js'

const optStr = (fallback = '') =>
  z
    .string()
    .nullish()
    .transform((v) => (v == null ? fallback : v.trim()))

const optNullableUuid = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().uuid().nullable()
)

const EmpresaSchema = z.object({
  codigo: optStr('1'),
  razao_social: z.string().trim().min(1, 'Informe a Razão Social da empresa.'),
  nome_fantasia: optStr(''),
  cnpj: optStr(''),
  inscricao_estadual: optStr(''),
  regime_tributario: z.enum(['SIMPLES', 'PRESUMIDO', 'REAL']).default('SIMPLES'),
})

const FilialSchema = z.object({
  empresa_id: optNullableUuid.optional(),
  codigo: z.string().trim().min(1, 'Informe o código da filial (ex: 1/1, 1/2, 2/1).'),
  nome: z.string().trim().min(1, 'Informe o nome da unidade/filial.'),
  tipo_unidade: z.enum(['VAREJO', 'DISTRIBUICAO', 'INDUSTRIA']).default('DISTRIBUICAO'),
  cnpj: optStr(''),
  inscricao_estadual: optStr(''),
  uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  cidade: optStr(''),
  codigo_ibge: optStr(''),
  registro_sanitario_tipo: z.enum(['SISP', 'SISBI', 'SIF', 'DIPOA', 'SIM', 'NENHUM']).default('SISP'),
  registro_sanitario_num: optStr(''),
  is_padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const ClienteSchema = z.object({
  codigo: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  razao_social: z.string().trim().min(1, 'Informe a Razão Social.'),
  nome_fantasia: optStr(''),
  cnpj_cpf: optStr(''),
  rg: optStr(''),
  data_nascimento: z.string().nullish().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null)),
  tipo_cliente: z.string().nullish().transform((v) => {
    const s = String(v || 'AMBOS').trim().toUpperCase()
    return ['ATACADO', 'VAREJO', 'AMBOS'].includes(s) ? s : 'AMBOS'
  }),
  inscricao_estadual: optStr(''),
  endereco: optStr(''),
  numero: optStr(''),
  complemento: optStr(''),
  bairro: optStr(''),
  cep: optStr(''),
  cidade: optStr(''),
  uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  pais: optStr('BRASIL'),
  telefone: optStr(''),
  icms: optStr('CONTRIBUINTE'),
  vendedor_padrao_id: optNullableUuid.optional(),
  forma_pagamento_padrao_id: optNullableUuid.optional(),
  local_cobranca_padrao_id: optNullableUuid.optional(),
  marchante_padrao: optStr(''),
  rota_padrao_nome: optStr(''),
  limite_credito: z.coerce.number().min(0).default(0),
  crediario_ativo: z.union([z.boolean(), z.number()]).optional().default(0),
  prazo_crediario_dias: z.coerce.number().int().min(1).max(365).optional().default(30),
  desconto_ativo: z.union([z.boolean(), z.number()]).optional().default(0),
  desconto_max_pct: z.coerce.number().min(0).max(100).optional().default(0),
  tabela_preco_id: optNullableUuid.optional(),
  bloqueado_financeiro: z.union([z.boolean(), z.number()]).optional().default(0),
  permite_pagamento_entrega: z.union([z.boolean(), z.number()]).optional().default(1),
  nao_faturar: z.union([z.boolean(), z.number()]).optional().default(0),
  is_padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const ClienteEspecSchema = z.object({
  produto_id: z.string().uuid('Produto inválido.'),
  codigo_aux_cliente: optStr(''),
  especificacao_corte: optStr(''),
  preco_negociado: z.coerce.number().min(0).nullish(),
  ultima_venda_preco: z.coerce.number().min(0).nullish(),
  alerta_reclamacao: z.union([z.boolean(), z.number()]).optional().default(0),
  alerta_descricao: optStr(''),
})

const FornecedorSchema = z.object({
  codigo: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  razao_social: z.string().trim().min(1, 'Informe a Razão Social do fornecedor.'),
  nome_fantasia: optStr(''),
  cnpj_cpf: optStr(''),
  inscricao_estadual: optStr(''),
  endereco: optStr(''),
  numero: optStr(''),
  complemento: optStr(''),
  bairro: optStr(''),
  cep: optStr(''),
  uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  cidade: optStr(''),
  telefone: optStr(''),
  email: optStr(''),
  cnae_principal: optStr(''),
  regime_apuracao: optStr(''),
  situacao_cadastral: optStr(''),
  registro_sanitario_sif: optStr(''),
  prazo_entrega_dias: z.coerce.number().int().min(0).default(5),
})

const VendedorSchema = z.object({
  codigo: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  sigla: optStr(''),
  nome: z.string().trim().min(1, 'Informe o nome do vendedor.'),
  operador_id: optNullableUuid.optional(),
  tipo_comissao: z.enum(['PCT_VENDA', 'PCT_MARGEM', 'VALOR_KG']).default('PCT_VENDA'),
  pct_comissao: z.coerce.number().min(0).default(0),
  regra_liberacao: z.enum(['FATURAMENTO', 'LIQUIDACAO']).default('FATURAMENTO'),
  meta_mensal_kg: z.coerce.number().min(0).default(0),
  meta_mensal_valor: z.coerce.number().min(0).default(0),
  desconto_max_pct: z.coerce.number().min(0).max(100).default(5),
  margem_minima_pct: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.'))),
    z.number().min(0).max(95).nullable().optional(),
  ),
})

const TransportadoraSchema = z.object({
  codigo: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  razao_social: z.string().trim().min(1, 'Informe a Razão Social / Nome da transportadora.'),
  nome_fantasia: optStr(''),
  cnpj_cpf: optStr(''),
  inscricao_estadual: optStr(''),
  endereco: optStr(''),
  numero: optStr(''),
  bairro: optStr(''),
  cep: optStr(''),
  uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  cidade: optStr(''),
  telefone: optStr(''),
  rntrc_antt: optStr(''),
  placa_padrao: z.string().nullish().transform((v) => (v ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')),
})

const TransportadoraVeiculoSchema = z.object({
  placa: z
    .string()
    .trim()
    .min(6, 'Informe a placa do veículo (ex: ABC1D23).')
    .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')),
  uf_placa: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  modelo: optStr(''),
  rntrc_antt: optStr(''),
  capacidade_kg: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.'))),
    z.number().min(0).nullable(),
  ),
  motorista_padrao: optStr(''),
  padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const RotaSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da rota.'),
  regiao: optStr(''),
  transportadora_id: optNullableUuid.optional(),
  veiculo_padrao: optStr(''),
  dias_entrega: optStr(''),
})

const FormaPagamentoSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código da forma de pagamento.'),
  descricao: z.string().trim().min(1, 'Informe a descrição (ex: 14/21 DIAS).'),
  dias_parcelas: z.array(z.coerce.number().int().min(0)).min(1).default([0]),
  pagamento_na_entrega: z.union([z.boolean(), z.number()]).optional().default(0),
})

const LocalCobrancaSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código do banco/local de cobrança.'),
  nome: z.string().trim().min(1, 'Informe o nome do banco/local de cobrança.'),
})

const CentroCustoSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código do centro de custo.'),
  descricao: z.string().trim().min(1, 'Informe a descrição do centro de custo.'),
})

const NaturezaSchema = z.object({
  tipo_movimento: z.enum(['ENTRADA', 'SAIDA', 'INDUSTRIALIZACAO']).default('SAIDA'),
  finalidade: optStr('REVENDA'),
  descricao: z.string().trim().min(1, 'Informe a descrição da natureza.'),
  cfop_estadual: z.string().trim().min(4, 'CFOP estadual inválido.'),
  cfop_interestadual: z.string().trim().min(4, 'CFOP interestadual inválido.'),
  codigo_sub_operacao: optStr('01'),
})

const MatrizTribSchema = z.object({
  ncm: z.string().trim().min(2, 'Informe o NCM.'),
  uf_origem: z.string().trim().toUpperCase().min(2).max(2),
  uf_destino: z.string().trim().toUpperCase().min(2).max(2),
  regime_tributario: z.enum(['SIMPLES', 'PRESUMIDO', 'REAL']).default('SIMPLES'),
  cst_csosn: optStr(''),
  aliq_icms: z.coerce.number().min(0).max(100).default(0),
  reducao_base_icms_pct: z.coerce.number().min(0).max(100).default(0),
  aliq_icms_st: z.coerce.number().min(0).max(100).default(0),
  validado_por_contador: optStr(''),
})

const MarchanteSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código do marchante.'),
  nome: z.string().trim().min(1, 'Informe o nome do marchante.'),
  is_padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const TipoVeiculoSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome / tipo do veículo (ex: Carro Pequeno, Van, Caminhão).'),
  categoria: z.enum(['UTILITARIO', 'VAN', 'CAMINHAO', 'CARRETA', 'OUTRO']).default('UTILITARIO'),
  capacidade_kg: z.coerce.number().positive('A capacidade em kg deve ser maior que zero.'),
  tolerancia_pct: z.coerce.number().min(0).max(100).default(10),
  observacoes: optStr(''),
})

function flag01(v: unknown, def = 0): number {
  if (v === undefined || v === null) return def
  return v === true || Number(v) === 1 ? 1 : 0
}

export function registerCadastrosMestresRoutes(app: FastifyInstance, conn: DbConnection) {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── EMPRESAS & FILIAIS ──────────────────────────────────────────────────────
  app.get(
    '/api/cadastros/empresas',
    { preHandler: requirePermission(['empresas_filiais', 'operadores'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const [empRows, filRows] = await Promise.all([
        conn.db
          .select()
          .from(empresas)
          .where(and(eq(empresas.tenantId, ctx.tenantId), eq(empresas.ativo, 1)))
          .orderBy(asc(empresas.codigo)),
        conn.db
          .select()
          .from(filiais)
          .where(and(eq(filiais.tenantId, ctx.tenantId), eq(filiais.ativo, 1)))
          .orderBy(asc(filiais.codigo)),
      ])
      return {
        success: true,
        data: empRows.map((e) => ({
          id: e.id,
          codigo: e.codigo,
          razao_social: e.razaoSocial,
          nome_fantasia: e.nomeFantasia,
          cnpj: e.cnpj,
          inscricao_estadual: e.inscricaoEstadual,
          regime_tributario: e.regimeTributario,
          filiais: filRows
            .filter((f) => f.empresaId === e.id)
            .map((f) => ({
              id: f.id,
              empresa_id: f.empresaId,
              codigo: f.codigo,
              nome: f.nome,
              tipo_unidade: f.tipoUnidade,
              cnpj: f.cnpj,
              inscricao_estadual: f.inscricaoEstadual,
              uf: f.uf,
              cidade: f.cidade,
              codigo_ibge: f.codigoIbge,
              registro_sanitario_tipo: f.registroSanitarioTipo,
              registro_sanitario_num: f.registroSanitarioNum,
              is_padrao: f.isPadrao,
            })),
        })),
      }
    }
  )

  app.post('/api/cadastros/empresas', { preHandler: requirePermission('empresas_filiais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = EmpresaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(empresas).values({
      id,
      tenantId: ctx.tenantId,
      codigo: d.codigo || '1',
      razaoSocial: d.razao_social,
      nomeFantasia: d.nome_fantasia || d.razao_social,
      cnpj: d.cnpj,
      inscricaoEstadual: d.inscricao_estadual,
      regimeTributario: d.regime_tributario,
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/empresas/:id', { preHandler: requirePermission('empresas_filiais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = EmpresaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(empresas)
      .set({
        codigo: d.codigo || '1',
        razaoSocial: d.razao_social,
        nomeFantasia: d.nome_fantasia || d.razao_social,
        cnpj: d.cnpj,
        inscricaoEstadual: d.inscricao_estadual,
        regimeTributario: d.regime_tributario,
      })
      .where(and(eq(empresas.id, id), eq(empresas.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.get(
    '/api/cadastros/filiais',
    { preHandler: requirePermission(['empresas_filiais', 'pedidos', 'recebimento'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(filiais)
        .where(and(eq(filiais.tenantId, ctx.tenantId), eq(filiais.ativo, 1)))
        .orderBy(asc(filiais.codigo))
      return {
        success: true,
        data: rows.map((f) => ({
          id: f.id,
          empresa_id: f.empresaId,
          codigo: f.codigo,
          nome: f.nome,
          tipo_unidade: f.tipoUnidade,
          cnpj: f.cnpj,
          inscricao_estadual: f.inscricaoEstadual,
          uf: f.uf,
          cidade: f.cidade,
          codigo_ibge: f.codigoIbge,
          registro_sanitario_tipo: f.registroSanitarioTipo,
          registro_sanitario_num: f.registroSanitarioNum,
          is_padrao: f.isPadrao,
        })),
      }
    }
  )

  app.post('/api/cadastros/filiais', { preHandler: requirePermission('empresas_filiais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = FilialSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const empresaId = d.empresa_id || ctx.empresaId
    const isPadrao = flag01(d.is_padrao, 0)
    const id = uuidv7()
    await conn.db.transaction(async (tx) => {
      if (isPadrao === 1) {
        await tx.update(filiais).set({ isPadrao: 0 }).where(eq(filiais.tenantId, ctx.tenantId))
      }
      await tx.insert(filiais).values({
        id,
        tenantId: ctx.tenantId,
        empresaId,
        codigo: d.codigo,
        nome: d.nome,
        tipoUnidade: d.tipo_unidade,
        cnpj: d.cnpj,
        inscricaoEstadual: d.inscricao_estadual,
        uf: d.uf,
        cidade: d.cidade,
        codigoIbge: d.codigo_ibge,
        registroSanitarioTipo: d.registro_sanitario_tipo,
        registroSanitarioNum: d.registro_sanitario_num,
        isPadrao,
      })
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/filiais/:id', { preHandler: requirePermission('empresas_filiais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = FilialSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const isPadrao = flag01(d.is_padrao, 0)
    await conn.db.transaction(async (tx) => {
      if (isPadrao === 1) {
        await tx.update(filiais).set({ isPadrao: 0 }).where(eq(filiais.tenantId, ctx.tenantId))
      }
      await tx
        .update(filiais)
        .set({
          codigo: d.codigo,
          nome: d.nome,
          tipoUnidade: d.tipo_unidade,
          cnpj: d.cnpj,
          inscricaoEstadual: d.inscricao_estadual,
          uf: d.uf,
          cidade: d.cidade,
          codigoIbge: d.codigo_ibge,
          registroSanitarioTipo: d.registro_sanitario_tipo,
          registroSanitarioNum: d.registro_sanitario_num,
          isPadrao,
        })
        .where(and(eq(filiais.id, id), eq(filiais.tenantId, ctx.tenantId)))
    })
    return { success: true }
  })

  app.delete('/api/cadastros/filiais/:id', { preHandler: requirePermission('empresas_filiais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    if (id === ctx.filialId) {
      throw new HttpError(409, 'Nao e possivel desativar a filial em uso na sessao atual.')
    }
    await conn.db
      .update(filiais)
      .set({ ativo: 0, isPadrao: 0 })
      .where(and(eq(filiais.id, id), eq(filiais.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // ── CLIENTES + ESPECIFICACOES POR PRODUTO ───────────────────────────────────
  app.get(
    '/api/cadastros/clientes',
    { preHandler: requirePermission(['clientes', 'pedidos', 'pedidos_consultar', 'financeiro_pedidos', 'saida', 'expedicao', 'pdv_caixa', 'varejo_acougue'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const incluirInativos = ['1', 'true'].includes(
        String((req.query as { incluir_inativos?: string }).incluir_inativos || '').toLowerCase(),
      )
      const res = await conn.db.execute(sql`
        SELECT
          c.id,
          c.codigo,
          c.razao_social,
          c.nome_fantasia,
          c.cnpj_cpf,
          c.rg,
          c.data_nascimento,
          c.tipo_cliente,
          c.inscricao_estadual,
          c.endereco,
          c.numero,
          c.complemento,
          c.bairro,
          c.cep,
          c.cidade,
          c.uf,
          c.pais,
          c.telefone,
          c.icms,
          c.vendedor_padrao_id,
          v.nome AS vendedor_nome,
          v.sigla AS vendedor_sigla,
          c.forma_pagamento_padrao_id,
          fp.descricao AS forma_pagamento_descricao,
          c.local_cobranca_padrao_id,
          lc.nome AS local_cobranca_nome,
          c.marchante_padrao,
          c.rota_padrao_nome,
          c.limite_credito,
          c.crediario_ativo,
          c.prazo_crediario_dias,
          c.desconto_ativo,
          c.desconto_max_pct,
          c.tabela_preco_id,
          tp.nome AS tabela_preco_nome,
          c.bloqueado_financeiro,
          c.permite_pagamento_entrega,
          c.nao_faturar,
          c.is_padrao,
          c.ativo,
          c.inativado_em,
          c.created_at,
          c.updated_at,
          COALESCE((SELECT SUM(ft.saldo_aberto) FROM financeiro_titulos ft WHERE ft.tenant_id = c.tenant_id AND ft.cliente_id = c.id AND ft.tipo = 'RECEBER' AND ft.status IN ('ABERTO', 'PARCIAL')), 0) AS credito_utilizado,
          COALESCE((SELECT COUNT(*)::int FROM cliente_produto_espec e WHERE e.cliente_id = c.id), 0) AS qtd_especificacoes,
          COALESCE((SELECT COUNT(*)::int FROM cliente_produto_espec e WHERE e.cliente_id = c.id AND e.alerta_reclamacao = 1), 0) AS qtd_alertas
        FROM clientes c
        LEFT JOIN vendedores v ON v.id = c.vendedor_padrao_id
        LEFT JOIN formas_pagamento fp ON fp.id = c.forma_pagamento_padrao_id
        LEFT JOIN locais_cobranca lc ON lc.id = c.local_cobranca_padrao_id
        LEFT JOIN tabelas_preco tp ON tp.id = c.tabela_preco_id
        WHERE c.tenant_id = ${ctx.tenantId}
          ${incluirInativos ? sql`` : sql`AND c.ativo = 1`}
        ORDER BY c.ativo DESC, c.is_padrao DESC, c.razao_social ASC
      `)

      const rows = res.rows as Array<Record<string, unknown>>
      const elegMap = incluirInativos
        ? await avaliarExclusaoEmLoteClientes(
            conn.db,
            ctx.tenantId,
            rows.map((r) => ({ id: String(r.id), ativo: r.ativo, inativado_em: r.inativado_em })),
          )
        : null

      return {
        success: true,
        data: rows.map((r) => {
          const eleg = elegMap?.get(String(r.id))
          const limite = Number(r.limite_credito || 0)
          const utilizado = Number(r.credito_utilizado || 0)
          const disponivel = Number(Math.max(0, limite - utilizado).toFixed(2))
          return {
            ...r,
            rg: String(r.rg || ''),
            data_nascimento: r.data_nascimento ? String(r.data_nascimento).slice(0, 10) : '',
            tipo_cliente: String(r.tipo_cliente || 'AMBOS'),
            limite_credito: limite,
            credito_utilizado: utilizado,
            credito_disponivel: disponivel,
            crediario_ativo: Number(r.crediario_ativo || 0),
            prazo_crediario_dias: Number(r.prazo_crediario_dias || 30),
            desconto_ativo: Number(r.desconto_ativo || 0),
            desconto_max_pct: Number(r.desconto_max_pct || 0),
            bloqueado_financeiro: Number(r.bloqueado_financeiro || 0),
            permite_pagamento_entrega: Number(r.permite_pagamento_entrega ?? 1),
            nao_faturar: Number(r.nao_faturar || 0),
            is_padrao: Number(r.is_padrao || 0),
            qtd_especificacoes: Number(r.qtd_especificacoes || 0),
            qtd_alertas: Number(r.qtd_alertas || 0),
            ...(eleg
              ? {
                  dias_inativo: eleg.dias_inativo,
                  tem_contas_financeiras: eleg.tem_contas_financeiras,
                  teve_movimentacao: eleg.teve_movimentacao,
                  pode_excluir_definitivo: eleg.pode_excluir_definitivo,
                  motivo_bloqueio_exclusao: eleg.motivo_bloqueio_exclusao,
                }
              : {}),
          }
        }),
      }
    }
  )

  app.post(
    '/api/cadastros/clientes',
    { preHandler: requirePermission(['clientes', 'pedidos', 'financeiro_pedidos', 'varejo_acougue', 'pdv_caixa']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = ClienteSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const isPadrao = flag01(d.is_padrao, 0)
      const id = uuidv7()

      const codigoFinal = await conn.db.transaction(async (tx) => {
        const codResolvido = await resolverCodigoCadastroOnCreate(tx, ctx.tenantId, 'cliente', d.codigo)
        if (isPadrao === 1) {
          await tx.update(clientes).set({ isPadrao: 0 }).where(eq(clientes.tenantId, ctx.tenantId))
        }
        await tx.insert(clientes).values({
          id,
          tenantId: ctx.tenantId,
          codigo: codResolvido,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
          rg: d.rg || '',
          dataNascimento: d.data_nascimento || null,
          tipoCliente: d.tipo_cliente || 'AMBOS',
          inscricaoEstadual: d.inscricao_estadual,
          endereco: d.endereco,
          numero: d.numero,
          complemento: d.complemento,
          bairro: d.bairro,
          cep: d.cep,
          cidade: d.cidade,
          uf: d.uf,
          pais: d.pais || 'BRASIL',
          telefone: d.telefone,
          icms: d.icms || 'CONTRIBUINTE',
          vendedorPadraoId: d.vendedor_padrao_id || null,
          formaPagamentoPadraoId: d.forma_pagamento_padrao_id || null,
          localCobrancaPadraoId: d.local_cobranca_padrao_id || null,
          marchantePadrao: d.marchante_padrao,
          rotaPadraoNome: d.rota_padrao_nome,
          limiteCredito: String(d.limite_credito),
          crediarioAtivo: flag01(d.crediario_ativo, d.limite_credito > 0 ? 1 : 0),
          prazoCrediarioDias: Number(d.prazo_crediario_dias || 30),
          descontoAtivo: flag01(d.desconto_ativo, d.desconto_max_pct > 0 ? 1 : 0),
          descontoMaxPct: String(d.desconto_max_pct || 0),
          tabelaPrecoId: d.tabela_preco_id || null,
          bloqueadoFinanceiro: flag01(d.bloqueado_financeiro, 0),
          permitePagamentoEntrega: flag01(d.permite_pagamento_entrega, 1),
          naoFaturar: flag01(d.nao_faturar, 0),
          naoFaturarDefinidoManual: 1,
          isPadrao,
        })
        return codResolvido
      })

      return reply.status(201).send({ success: true, id, codigo: codigoFinal })
    }
  )

  app.put('/api/cadastros/clientes/:id', { preHandler: requirePermission(['clientes', 'pedidos', 'varejo_acougue', 'pdv_caixa']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = ClienteSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const isPadrao = flag01(d.is_padrao, 0)

    const codigoFinal = await conn.db.transaction(async (tx) => {
      const codResolvido = await resolverCodigoCadastroOnUpdate(tx, ctx.tenantId, 'cliente', id, d.codigo)
      if (isPadrao === 1) {
        await tx.update(clientes).set({ isPadrao: 0 }).where(eq(clientes.tenantId, ctx.tenantId))
      }
      await tx
        .update(clientes)
        .set({
          codigo: codResolvido,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
          rg: d.rg || '',
          dataNascimento: d.data_nascimento || null,
          tipoCliente: d.tipo_cliente || 'AMBOS',
          inscricaoEstadual: d.inscricao_estadual,
          endereco: d.endereco,
          numero: d.numero,
          complemento: d.complemento,
          bairro: d.bairro,
          cep: d.cep,
          cidade: d.cidade,
          uf: d.uf,
          pais: d.pais || 'BRASIL',
          telefone: d.telefone,
          icms: d.icms || 'CONTRIBUINTE',
          vendedorPadraoId: d.vendedor_padrao_id || null,
          formaPagamentoPadraoId: d.forma_pagamento_padrao_id || null,
          localCobrancaPadraoId: d.local_cobranca_padrao_id || null,
          marchantePadrao: d.marchante_padrao,
          rotaPadraoNome: d.rota_padrao_nome,
          limiteCredito: String(d.limite_credito),
          crediarioAtivo: flag01(d.crediario_ativo, 0),
          prazoCrediarioDias: Number(d.prazo_crediario_dias || 30),
          descontoAtivo: flag01(d.desconto_ativo, 0),
          descontoMaxPct: String(d.desconto_max_pct || 0),
          ...(d.tabela_preco_id !== undefined ? { tabelaPrecoId: d.tabela_preco_id || null } : {}),
          bloqueadoFinanceiro: flag01(d.bloqueado_financeiro, 0),
          permitePagamentoEntrega: flag01(d.permite_pagamento_entrega, 1),
          naoFaturar: flag01(d.nao_faturar, 0),
          naoFaturarDefinidoManual: 1,
          isPadrao,
          updatedAt: new Date(),
        })
        .where(and(eq(clientes.id, id), eq(clientes.tenantId, ctx.tenantId)))
      return codResolvido
    })

    return { success: true, codigo: codigoFinal }
  })

  app.patch('/api/cadastros/clientes/:id/ativo', { preHandler: requirePermission(['clientes', 'pedidos']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const body = (req.body || {}) as { ativo?: boolean | number }
    const ativoNum = body.ativo === false || Number(body.ativo) === 0 ? 0 : 1

    const [atual] = await conn.db
      .select({ id: clientes.id, inativadoEm: clientes.inativadoEm })
      .from(clientes)
      .where(and(eq(clientes.id, id), eq(clientes.tenantId, ctx.tenantId)))
      .limit(1)
    if (!atual) throw new HttpError(404, 'Cliente não encontrado.')

    const inativadoEm = ativoNum === 0 ? atual.inativadoEm || new Date() : null
    await conn.db
      .update(clientes)
      .set({
        ativo: ativoNum,
        inativadoEm,
        updatedAt: new Date(),
        ...(ativoNum === 0 ? { isPadrao: 0 } : {}),
      })
      .where(and(eq(clientes.id, id), eq(clientes.tenantId, ctx.tenantId)))

    return {
      success: true,
      ativo: ativoNum,
      inativado_em: inativadoEm ? inativadoEm.toISOString() : null,
    }
  })

  app.delete('/api/cadastros/clientes/:id', { preHandler: requirePermission(['clientes', 'pedidos']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.transaction(async (tx) => {
      await executarExclusaoDefinitivaCliente(tx, ctx.tenantId, id)
    })
    return { success: true }
  })

  app.get(
    '/api/cadastros/clientes/:id/especificacoes',
    { preHandler: requirePermission(['clientes', 'pedidos', 'pedidos_consultar'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const clienteId = String((req.params as { id: string }).id || '').trim()
      const rows = await conn.db
        .select({
          id: clienteProdutoEspec.id,
          cliente_id: clienteProdutoEspec.clienteId,
          produto_id: clienteProdutoEspec.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          codigo_aux_cliente: clienteProdutoEspec.codigoAuxCliente,
          especificacao_corte: clienteProdutoEspec.especificacaoCorte,
          preco_negociado: clienteProdutoEspec.precoNegociado,
          ultima_venda_preco: clienteProdutoEspec.ultimaVendaPreco,
          alerta_reclamacao: clienteProdutoEspec.alertaReclamacao,
          alerta_descricao: clienteProdutoEspec.alertaDescricao,
          updated_at: clienteProdutoEspec.updatedAt,
        })
        .from(clienteProdutoEspec)
        .innerJoin(produtos, eq(produtos.id, clienteProdutoEspec.produtoId))
        .where(and(eq(clienteProdutoEspec.tenantId, ctx.tenantId), eq(clienteProdutoEspec.clienteId, clienteId)))
        .orderBy(asc(produtos.descricao))

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          preco_negociado: r.preco_negociado != null ? Number(r.preco_negociado) : null,
          ultima_venda_preco: r.ultima_venda_preco != null ? Number(r.ultima_venda_preco) : null,
        })),
      }
    }
  )

  app.post(
    '/api/cadastros/clientes/:id/especificacoes',
    { preHandler: requirePermission(['clientes', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const clienteId = String((req.params as { id: string }).id || '').trim()
      const parsed = ClienteEspecSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data

      const [existing] = await conn.db
        .select({ id: clienteProdutoEspec.id })
        .from(clienteProdutoEspec)
        .where(
          and(
            eq(clienteProdutoEspec.tenantId, ctx.tenantId),
            eq(clienteProdutoEspec.clienteId, clienteId),
            eq(clienteProdutoEspec.produtoId, d.produto_id)
          )
        )
        .limit(1)

      const payload = {
        codigoAuxCliente: d.codigo_aux_cliente,
        especificacaoCorte: d.especificacao_corte,
        precoNegociado: d.preco_negociado != null ? String(d.preco_negociado) : null,
        ultimaVendaPreco: d.ultima_venda_preco != null ? String(d.ultima_venda_preco) : null,
        alertaReclamacao: flag01(d.alerta_reclamacao, 0),
        alertaDescricao: d.alerta_descricao,
        updatedAt: new Date(),
      }

      if (existing) {
        await conn.db.update(clienteProdutoEspec).set(payload).where(eq(clienteProdutoEspec.id, existing.id))
        return { success: true, id: existing.id }
      }

      const id = uuidv7()
      await conn.db.insert(clienteProdutoEspec).values({
        id,
        tenantId: ctx.tenantId,
        clienteId,
        produtoId: d.produto_id,
        ...payload,
      })
      return { success: true, id }
    }
  )

  app.delete(
    '/api/cadastros/clientes/:clienteId/especificacoes/:especId',
    { preHandler: requirePermission(['clientes', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const { clienteId, especId } = req.params as { clienteId: string; especId: string }
      await conn.db
        .delete(clienteProdutoEspec)
        .where(
          and(
            eq(clienteProdutoEspec.id, especId),
            eq(clienteProdutoEspec.clienteId, clienteId),
            eq(clienteProdutoEspec.tenantId, ctx.tenantId)
          )
        )
      return { success: true }
    }
  )

  // ── CONSULTA PÚBLICA DE CNPJ (RECEITA FEDERAL / MULTI-PROVEDOR) ─────────────
  app.get(
    '/api/cadastros/consultar-cnpj/:cnpj',
    {
      preHandler: requirePermission(
        ['fornecedores', 'clientes', 'transportadoras', 'compras', 'recebimento', 'empresas'],
        { write: false },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const { cnpj } = req.params as { cnpj: string }
      const q = (req.query || {}) as { provedor?: string; refresh?: string }
      const provedor = (String(q.provedor || 'AUTO').toUpperCase() as ProvedorCnpj) || 'AUTO'
      const ignorarCache = q.refresh === '1' || q.refresh === 'true'

      const data = await consultarCnpjReceita(cnpj, provedor, { ignorarCache })

      const [fornEx, cliEx, transpEx] = await Promise.all([
        conn.db
          .select({
            id: fornecedores.id,
            codigo: fornecedores.codigo,
            razao_social: fornecedores.razaoSocial,
          })
          .from(fornecedores)
          .where(
            and(
              eq(fornecedores.tenantId, ctx.tenantId),
              eq(fornecedores.ativo, 1),
              sql`REGEXP_REPLACE(${fornecedores.cnpjCpf}, '[^0-9]', '', 'g') = ${data.cnpj}`,
            ),
          )
          .limit(1),
        conn.db
          .select({
            id: clientes.id,
            codigo: clientes.codigo,
            razao_social: clientes.razaoSocial,
          })
          .from(clientes)
          .where(
            and(
              eq(clientes.tenantId, ctx.tenantId),
              eq(clientes.ativo, 1),
              sql`REGEXP_REPLACE(${clientes.cnpjCpf}, '[^0-9]', '', 'g') = ${data.cnpj}`,
            ),
          )
          .limit(1),
        conn.db
          .select({
            id: transportadoras.id,
            codigo: transportadoras.codigo,
            razao_social: transportadoras.razaoSocial,
          })
          .from(transportadoras)
          .where(
            and(
              eq(transportadoras.tenantId, ctx.tenantId),
              eq(transportadoras.ativo, 1),
              sql`REGEXP_REPLACE(${transportadoras.cnpjCpf}, '[^0-9]', '', 'g') = ${data.cnpj}`,
            ),
          )
          .limit(1),
      ])

      return {
        success: true,
        data,
        ja_cadastrado: {
          fornecedor: fornEx[0] || null,
          cliente: cliEx[0] || null,
          transportadora: transpEx[0] || null,
        },
      }
    },
  )

  // ── FORNECEDORES ────────────────────────────────────────────────────────────
  app.get(
    '/api/cadastros/fornecedores',
    { preHandler: requirePermission(['fornecedores', 'recebimento', 'recebimento_consultar', 'compras', 'produtos'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const incluirInativos = ['1', 'true'].includes(
        String((req.query as { incluir_inativos?: string }).incluir_inativos || '').toLowerCase(),
      )
      const rows = await conn.db
        .select({
          id: fornecedores.id,
          codigo: fornecedores.codigo,
          razao_social: fornecedores.razaoSocial,
          nome_fantasia: fornecedores.nomeFantasia,
          cnpj_cpf: fornecedores.cnpjCpf,
          inscricao_estadual: fornecedores.inscricaoEstadual,
          endereco: fornecedores.endereco,
          numero: fornecedores.numero,
          complemento: fornecedores.complemento,
          bairro: fornecedores.bairro,
          cep: fornecedores.cep,
          uf: fornecedores.uf,
          cidade: fornecedores.cidade,
          telefone: fornecedores.telefone,
          email: fornecedores.email,
          cnae_principal: fornecedores.cnaePrincipal,
          regime_apuracao: fornecedores.regimeApuracao,
          situacao_cadastral: fornecedores.situacaoCadastral,
          registro_sanitario_sif: fornecedores.registroSanitarioSif,
          prazo_entrega_dias: fornecedores.prazoEntregaDias,
          ativo: fornecedores.ativo,
          inativado_em: fornecedores.inativadoEm,
          created_at: fornecedores.createdAt,
          updated_at: fornecedores.updatedAt,
        })
        .from(fornecedores)
        .where(
          incluirInativos
            ? eq(fornecedores.tenantId, ctx.tenantId)
            : and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)),
        )
        .orderBy(desc(fornecedores.ativo), asc(fornecedores.razaoSocial))

      const elegMap = incluirInativos
        ? await avaliarExclusaoEmLoteFornecedores(
            conn.db,
            ctx.tenantId,
            rows.map((r) => ({ id: r.id, ativo: r.ativo, inativado_em: r.inativado_em })),
          )
        : null

      return {
        success: true,
        data: rows.map((r) => {
          const eleg = elegMap?.get(r.id)
          return {
            ...r,
            ...(eleg
              ? {
                  dias_inativo: eleg.dias_inativo,
                  tem_contas_financeiras: eleg.tem_contas_financeiras,
                  teve_movimentacao: eleg.teve_movimentacao,
                  pode_excluir_definitivo: eleg.pode_excluir_definitivo,
                  motivo_bloqueio_exclusao: eleg.motivo_bloqueio_exclusao,
                }
              : {}),
          }
        }),
      }
    }
  )

  app.post(
    '/api/cadastros/fornecedores',
    { preHandler: requirePermission(['fornecedores', 'recebimento', 'produtos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = FornecedorSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const id = uuidv7()
      const codigoFinal = await conn.db.transaction(async (tx) => {
        const codResolvido = await resolverCodigoCadastroOnCreate(tx, ctx.tenantId, 'fornecedor', d.codigo)
        await tx.insert(fornecedores).values({
          id,
          tenantId: ctx.tenantId,
          codigo: codResolvido,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
          inscricaoEstadual: d.inscricao_estadual,
          endereco: d.endereco,
          numero: d.numero,
          complemento: d.complemento,
          bairro: d.bairro,
          cep: d.cep,
          uf: d.uf,
          cidade: d.cidade,
          telefone: d.telefone,
          email: d.email,
          cnaePrincipal: d.cnae_principal,
          regimeApuracao: d.regime_apuracao,
          situacaoCadastral: d.situacao_cadastral,
          registroSanitarioSif: d.registro_sanitario_sif,
          prazoEntregaDias: d.prazo_entrega_dias,
        })
        return codResolvido
      })
      return reply.status(201).send({ success: true, id, codigo: codigoFinal })
    }
  )

  app.put('/api/cadastros/fornecedores/:id', { preHandler: requirePermission(['fornecedores', 'recebimento']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = FornecedorSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const codigoFinal = await conn.db.transaction(async (tx) => {
      const codResolvido = await resolverCodigoCadastroOnUpdate(tx, ctx.tenantId, 'fornecedor', id, d.codigo)
      await tx
        .update(fornecedores)
        .set({
          codigo: codResolvido,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
          inscricaoEstadual: d.inscricao_estadual,
          endereco: d.endereco,
          numero: d.numero,
          complemento: d.complemento,
          bairro: d.bairro,
          cep: d.cep,
          uf: d.uf,
          cidade: d.cidade,
          telefone: d.telefone,
          email: d.email,
          cnaePrincipal: d.cnae_principal,
          regimeApuracao: d.regime_apuracao,
          situacaoCadastral: d.situacao_cadastral,
          registroSanitarioSif: d.registro_sanitario_sif,
          prazoEntregaDias: d.prazo_entrega_dias,
          updatedAt: new Date(),
        })
        .where(and(eq(fornecedores.id, id), eq(fornecedores.tenantId, ctx.tenantId)))
      return codResolvido
    })
    return { success: true, codigo: codigoFinal }
  })

  app.patch('/api/cadastros/fornecedores/:id/ativo', { preHandler: requirePermission(['fornecedores', 'recebimento']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const body = (req.body || {}) as { ativo?: boolean | number }
    const ativoNum = body.ativo === false || Number(body.ativo) === 0 ? 0 : 1

    const [atual] = await conn.db
      .select({ id: fornecedores.id, inativadoEm: fornecedores.inativadoEm })
      .from(fornecedores)
      .where(and(eq(fornecedores.id, id), eq(fornecedores.tenantId, ctx.tenantId)))
      .limit(1)
    if (!atual) throw new HttpError(404, 'Fornecedor não encontrado.')

    const inativadoEm = ativoNum === 0 ? atual.inativadoEm || new Date() : null
    await conn.db
      .update(fornecedores)
      .set({
        ativo: ativoNum,
        inativadoEm,
        updatedAt: new Date(),
      })
      .where(and(eq(fornecedores.id, id), eq(fornecedores.tenantId, ctx.tenantId)))

    return {
      success: true,
      ativo: ativoNum,
      inativado_em: inativadoEm ? inativadoEm.toISOString() : null,
    }
  })

  app.delete('/api/cadastros/fornecedores/:id', { preHandler: requirePermission(['fornecedores', 'recebimento']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.transaction(async (tx) => {
      await executarExclusaoDefinitivaFornecedor(tx, ctx.tenantId, id)
    })
    return { success: true }
  })

  // ── VENDEDORES & COMISSOES ──────────────────────────────────────────────────
  app.get(
    '/api/cadastros/vendedores',
    { preHandler: requirePermission(['vendedores', 'clientes', 'pedidos', 'pedidos_consultar', 'financeiro_pedidos', 'operadores'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: vendedores.id,
          codigo: vendedores.codigo,
          sigla: vendedores.sigla,
          nome: vendedores.nome,
          operador_id: vendedores.operadorId,
          operador_nome: operadores.nome,
          operador_login: operadores.login,
          tipo_comissao: vendedores.tipoComissao,
          pct_comissao: vendedores.pctComissao,
          regra_liberacao: vendedores.regraLiberacao,
          meta_mensal_kg: vendedores.metaMensalKg,
          meta_mensal_valor: vendedores.metaMensalValor,
          desconto_max_pct: vendedores.descontoMaxPct,
          margem_minima_pct: vendedores.margemMinimaPct,
          ativo: vendedores.ativo,
          created_at: vendedores.createdAt,
        })
        .from(vendedores)
        .leftJoin(operadores, eq(operadores.id, vendedores.operadorId))
        .where(and(eq(vendedores.tenantId, ctx.tenantId), eq(vendedores.ativo, 1)))
        .orderBy(asc(vendedores.nome))
      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          pct_comissao: Number(r.pct_comissao || 0),
          meta_mensal_kg: Number(r.meta_mensal_kg || 0),
          meta_mensal_valor: Number(r.meta_mensal_valor || 0),
          desconto_max_pct: Number(r.desconto_max_pct ?? 5),
          margem_minima_pct: r.margem_minima_pct != null ? Number(r.margem_minima_pct) : null,
        })),
      }
    }
  )

  app.post('/api/cadastros/vendedores', { preHandler: requirePermission(['vendedores', 'operadores']) }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = VendedorSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    const codigoFinal = await conn.db.transaction(async (tx) => {
      const codResolvido = await resolverCodigoCadastroOnCreate(tx, ctx.tenantId, 'vendedor', d.codigo)
      await tx.insert(vendedores).values({
        id,
        tenantId: ctx.tenantId,
        codigo: codResolvido,
        sigla: d.sigla.toUpperCase(),
        nome: d.nome,
        operadorId: d.operador_id || null,
        tipoComissao: d.tipo_comissao,
        pctComissao: String(d.pct_comissao),
        regraLiberacao: d.regra_liberacao,
        metaMensalKg: String(d.meta_mensal_kg),
        metaMensalValor: String(d.meta_mensal_valor),
        descontoMaxPct: String(d.desconto_max_pct ?? 5),
        margemMinimaPct: d.margem_minima_pct != null ? String(d.margem_minima_pct) : null,
      })
      return codResolvido
    })
    return reply.status(201).send({ success: true, id, codigo: codigoFinal })
  })

  app.put('/api/cadastros/vendedores/:id', { preHandler: requirePermission(['vendedores', 'operadores']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = VendedorSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const codigoFinal = await conn.db.transaction(async (tx) => {
      const codResolvido = await resolverCodigoCadastroOnUpdate(tx, ctx.tenantId, 'vendedor', id, d.codigo)
      await tx
        .update(vendedores)
        .set({
          codigo: codResolvido,
          sigla: d.sigla.toUpperCase(),
          nome: d.nome,
          operadorId: d.operador_id || null,
          tipoComissao: d.tipo_comissao,
          pctComissao: String(d.pct_comissao),
          regraLiberacao: d.regra_liberacao,
          metaMensalKg: String(d.meta_mensal_kg),
          metaMensalValor: String(d.meta_mensal_valor),
          descontoMaxPct: String(d.desconto_max_pct ?? 5),
          margemMinimaPct: d.margem_minima_pct != null ? String(d.margem_minima_pct) : null,
        })
        .where(and(eq(vendedores.id, id), eq(vendedores.tenantId, ctx.tenantId)))
      return codResolvido
    })
    return { success: true, codigo: codigoFinal }
  })

  app.delete('/api/cadastros/vendedores/:id', { preHandler: requirePermission(['vendedores', 'operadores']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db
      .update(vendedores)
      .set({ ativo: 0 })
      .where(and(eq(vendedores.id, id), eq(vendedores.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // ── TRANSPORTADORAS & ROTAS ─────────────────────────────────────────────────
  app.get(
    '/api/cadastros/transportadoras',
    {
      preHandler: requirePermission(
        ['transportadoras', 'pedidos', 'saida', 'expedicao', 'fiscal', 'roteirizacao'],
        { write: false },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const [rows, veics] = await Promise.all([
        conn.db
          .select({
            id: transportadoras.id,
            codigo: transportadoras.codigo,
            razao_social: transportadoras.razaoSocial,
            nome_fantasia: transportadoras.nomeFantasia,
            cnpj_cpf: transportadoras.cnpjCpf,
            inscricao_estadual: transportadoras.inscricaoEstadual,
            endereco: transportadoras.endereco,
            numero: transportadoras.numero,
            bairro: transportadoras.bairro,
            cep: transportadoras.cep,
            uf: transportadoras.uf,
            cidade: transportadoras.cidade,
            telefone: transportadoras.telefone,
            rntrc_antt: transportadoras.rntrcAntt,
            placa_padrao: transportadoras.placaPadrao,
            ativo: transportadoras.ativo,
          })
          .from(transportadoras)
          .where(and(eq(transportadoras.tenantId, ctx.tenantId), eq(transportadoras.ativo, 1)))
          .orderBy(asc(transportadoras.razaoSocial)),
        conn.db
          .select({
            id: transportadoraVeiculos.id,
            transportadora_id: transportadoraVeiculos.transportadoraId,
            placa: transportadoraVeiculos.placa,
            uf_placa: transportadoraVeiculos.ufPlaca,
            modelo: transportadoraVeiculos.modelo,
            rntrc_antt: transportadoraVeiculos.rntrcAntt,
            capacidade_kg: transportadoraVeiculos.capacidadeKg,
            motorista_padrao: transportadoraVeiculos.motoristaPadrao,
            padrao: transportadoraVeiculos.padrao,
          })
          .from(transportadoraVeiculos)
          .where(and(eq(transportadoraVeiculos.tenantId, ctx.tenantId), eq(transportadoraVeiculos.ativo, 1)))
          .orderBy(desc(transportadoraVeiculos.padrao), asc(transportadoraVeiculos.placa)),
      ])

      const veicsPorTransp = new Map<string, Array<Record<string, unknown>>>()
      for (const v of veics) {
        const list = veicsPorTransp.get(v.transportadora_id) || []
        list.push({
          ...v,
          capacidade_kg: v.capacidade_kg != null ? Number(v.capacidade_kg) : null,
          padrao: Boolean(v.padrao),
        })
        veicsPorTransp.set(v.transportadora_id, list)
      }

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          veiculos: veicsPorTransp.get(r.id) || [],
        })),
      }
    }
  )

  app.post('/api/cadastros/transportadoras', { preHandler: requirePermission('transportadoras') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = TransportadoraSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    const codigoFinal = await conn.db.transaction(async (tx) => {
      const codResolvido = await resolverCodigoCadastroOnCreate(tx, ctx.tenantId, 'transportadora', d.codigo)
      await tx.insert(transportadoras).values({
        id,
        tenantId: ctx.tenantId,
        codigo: codResolvido,
        razaoSocial: d.razao_social,
        nomeFantasia: d.nome_fantasia || d.razao_social,
        cnpjCpf: d.cnpj_cpf,
        inscricaoEstadual: d.inscricao_estadual,
        endereco: d.endereco,
        numero: d.numero,
        bairro: d.bairro,
        cep: d.cep,
        uf: d.uf,
        cidade: d.cidade,
        telefone: d.telefone,
        rntrcAntt: d.rntrc_antt,
        placaPadrao: d.placa_padrao,
      })
      return codResolvido
    })
    return reply.status(201).send({ success: true, id, codigo: codigoFinal })
  })

  app.put('/api/cadastros/transportadoras/:id', { preHandler: requirePermission('transportadoras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = TransportadoraSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const codigoFinal = await conn.db.transaction(async (tx) => {
      const codResolvido = await resolverCodigoCadastroOnUpdate(tx, ctx.tenantId, 'transportadora', id, d.codigo)
      await tx
        .update(transportadoras)
        .set({
          codigo: codResolvido,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
          inscricaoEstadual: d.inscricao_estadual,
          endereco: d.endereco,
          numero: d.numero,
          bairro: d.bairro,
          cep: d.cep,
          uf: d.uf,
          cidade: d.cidade,
          telefone: d.telefone,
          rntrcAntt: d.rntrc_antt,
          placaPadrao: d.placa_padrao,
        })
        .where(and(eq(transportadoras.id, id), eq(transportadoras.tenantId, ctx.tenantId)))
      return codResolvido
    })
    return { success: true, codigo: codigoFinal }
  })

  app.delete('/api/cadastros/transportadoras/:id', { preHandler: requirePermission('transportadoras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db
      .update(transportadoras)
      .set({ ativo: 0 })
      .where(and(eq(transportadoras.id, id), eq(transportadoras.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // ── VEÍCULOS INDIVIDUAIS POR TRANSPORTADORA ────────────────────────────────
  app.get(
    '/api/cadastros/transportadoras/:id/veiculos',
    {
      preHandler: requirePermission(
        ['transportadoras', 'pedidos', 'saida', 'expedicao', 'fiscal', 'roteirizacao'],
        { write: false },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const transpId = String((req.params as { id: string }).id || '').trim()
      const rows = await conn.db
        .select({
          id: transportadoraVeiculos.id,
          transportadora_id: transportadoraVeiculos.transportadoraId,
          placa: transportadoraVeiculos.placa,
          uf_placa: transportadoraVeiculos.ufPlaca,
          modelo: transportadoraVeiculos.modelo,
          rntrc_antt: transportadoraVeiculos.rntrcAntt,
          capacidade_kg: transportadoraVeiculos.capacidadeKg,
          motorista_padrao: transportadoraVeiculos.motoristaPadrao,
          padrao: transportadoraVeiculos.padrao,
        })
        .from(transportadoraVeiculos)
        .where(
          and(
            eq(transportadoraVeiculos.tenantId, ctx.tenantId),
            eq(transportadoraVeiculos.transportadoraId, transpId),
            eq(transportadoraVeiculos.ativo, 1),
          ),
        )
        .orderBy(desc(transportadoraVeiculos.padrao), asc(transportadoraVeiculos.placa))
      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          capacidade_kg: r.capacidade_kg != null ? Number(r.capacidade_kg) : null,
          padrao: Boolean(r.padrao),
        })),
      }
    },
  )

  app.post(
    '/api/cadastros/transportadoras/:id/veiculos',
    { preHandler: requirePermission('transportadoras') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const transpId = String((req.params as { id: string }).id || '').trim()
      const parsed = TransportadoraVeiculoSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados do veículo inválidos.')
      const d = parsed.data

      const id = await conn.db.transaction(async (tx) => {
        const [transp] = await tx
          .select({ id: transportadoras.id, placaPadrao: transportadoras.placaPadrao })
          .from(transportadoras)
          .where(and(eq(transportadoras.id, transpId), eq(transportadoras.tenantId, ctx.tenantId)))
          .limit(1)
        if (!transp) throw new HttpError(404, 'Transportadora não encontrada.')

        const [dup] = await tx
          .select({ id: transportadoraVeiculos.id, ativo: transportadoraVeiculos.ativo })
          .from(transportadoraVeiculos)
          .where(
            and(
              eq(transportadoraVeiculos.tenantId, ctx.tenantId),
              eq(transportadoraVeiculos.transportadoraId, transpId),
              eq(transportadoraVeiculos.placa, d.placa),
            ),
          )
          .limit(1)

        const existentes = await tx
          .select({ id: transportadoraVeiculos.id })
          .from(transportadoraVeiculos)
          .where(
            and(
              eq(transportadoraVeiculos.tenantId, ctx.tenantId),
              eq(transportadoraVeiculos.transportadoraId, transpId),
              eq(transportadoraVeiculos.ativo, 1),
            ),
          )
        const isPadrao = Boolean(d.padrao) || existentes.length === 0 ? 1 : 0

        if (isPadrao === 1) {
          await tx
            .update(transportadoraVeiculos)
            .set({ padrao: 0 })
            .where(
              and(
                eq(transportadoraVeiculos.tenantId, ctx.tenantId),
                eq(transportadoraVeiculos.transportadoraId, transpId),
              ),
            )
        }

        let veicId = uuidv7()
        if (dup) {
          if (dup.ativo === 1) {
            throw new HttpError(409, `A placa ${d.placa} já está cadastrada nesta transportadora.`)
          }
          veicId = dup.id
          await tx
            .update(transportadoraVeiculos)
            .set({
              ufPlaca: d.uf_placa,
              modelo: d.modelo,
              rntrcAntt: d.rntrc_antt,
              capacidadeKg: d.capacidade_kg != null ? String(d.capacidade_kg) : null,
              motoristaPadrao: d.motorista_padrao,
              padrao: isPadrao,
              ativo: 1,
            })
            .where(eq(transportadoraVeiculos.id, veicId))
        } else {
          await tx.insert(transportadoraVeiculos).values({
            id: veicId,
            tenantId: ctx.tenantId,
            transportadoraId: transpId,
            placa: d.placa,
            ufPlaca: d.uf_placa,
            modelo: d.modelo,
            rntrcAntt: d.rntrc_antt,
            capacidadeKg: d.capacidade_kg != null ? String(d.capacidade_kg) : null,
            motoristaPadrao: d.motorista_padrao,
            padrao: isPadrao,
            ativo: 1,
          })
        }

        if (isPadrao === 1 || !transp.placaPadrao) {
          await tx
            .update(transportadoras)
            .set({ placaPadrao: d.placa })
            .where(eq(transportadoras.id, transpId))
        }

        return veicId
      })

      return reply.status(201).send({ success: true, id })
    },
  )

  app.put(
    '/api/cadastros/transportadoras/:id/veiculos/:veiculoId',
    { preHandler: requirePermission('transportadoras') },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; veiculoId: string }
      const transpId = String(p.id || '').trim()
      const veiculoId = String(p.veiculoId || '').trim()
      const parsed = TransportadoraVeiculoSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados do veículo inválidos.')
      const d = parsed.data

      await conn.db.transaction(async (tx) => {
        const [dup] = await tx
          .select({ id: transportadoraVeiculos.id })
          .from(transportadoraVeiculos)
          .where(
            and(
              eq(transportadoraVeiculos.tenantId, ctx.tenantId),
              eq(transportadoraVeiculos.transportadoraId, transpId),
              eq(transportadoraVeiculos.placa, d.placa),
              ne(transportadoraVeiculos.id, veiculoId),
            ),
          )
          .limit(1)
        if (dup) throw new HttpError(409, `Já existe outro veículo com a placa ${d.placa} nesta transportadora.`)

        const isPadrao = Boolean(d.padrao) ? 1 : 0
        if (isPadrao === 1) {
          await tx
            .update(transportadoraVeiculos)
            .set({ padrao: 0 })
            .where(
              and(
                eq(transportadoraVeiculos.tenantId, ctx.tenantId),
                eq(transportadoraVeiculos.transportadoraId, transpId),
              ),
            )
        }

        await tx
          .update(transportadoraVeiculos)
          .set({
            placa: d.placa,
            ufPlaca: d.uf_placa,
            modelo: d.modelo,
            rntrcAntt: d.rntrc_antt,
            capacidadeKg: d.capacidade_kg != null ? String(d.capacidade_kg) : null,
            motoristaPadrao: d.motorista_padrao,
            padrao: isPadrao,
          })
          .where(
            and(
              eq(transportadoraVeiculos.id, veiculoId),
              eq(transportadoraVeiculos.transportadoraId, transpId),
              eq(transportadoraVeiculos.tenantId, ctx.tenantId),
            ),
          )

        if (isPadrao === 1) {
          await tx
            .update(transportadoras)
            .set({ placaPadrao: d.placa })
            .where(eq(transportadoras.id, transpId))
        }
      })

      return { success: true }
    },
  )

  app.delete(
    '/api/cadastros/transportadoras/:id/veiculos/:veiculoId',
    { preHandler: requirePermission('transportadoras') },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; veiculoId: string }
      const transpId = String(p.id || '').trim()
      const veiculoId = String(p.veiculoId || '').trim()
      await conn.db
        .update(transportadoraVeiculos)
        .set({ ativo: 0, padrao: 0 })
        .where(
          and(
            eq(transportadoraVeiculos.id, veiculoId),
            eq(transportadoraVeiculos.transportadoraId, transpId),
            eq(transportadoraVeiculos.tenantId, ctx.tenantId),
          ),
        )
      return { success: true }
    },
  )

  app.get(
    '/api/cadastros/rotas',
    { preHandler: requirePermission(['transportadoras', 'clientes', 'pedidos', 'saida', 'expedicao'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: rotas.id,
          nome: rotas.nome,
          regiao: rotas.regiao,
          transportadora_id: rotas.transportadoraId,
          transportadora_nome: transportadoras.razaoSocial,
          veiculo_padrao: rotas.veiculoPadrao,
          dias_entrega: rotas.diasEntrega,
          ativo: rotas.ativo,
        })
        .from(rotas)
        .leftJoin(transportadoras, eq(transportadoras.id, rotas.transportadoraId))
        .where(and(eq(rotas.tenantId, ctx.tenantId), eq(rotas.ativo, 1)))
        .orderBy(asc(rotas.nome))
      return { success: true, data: rows }
    }
  )

  app.post('/api/cadastros/rotas', { preHandler: requirePermission('transportadoras') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = RotaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(rotas).values({
      id,
      tenantId: ctx.tenantId,
      nome: d.nome,
      regiao: d.regiao,
      transportadoraId: d.transportadora_id || null,
      veiculoPadrao: d.veiculo_padrao,
      diasEntrega: d.dias_entrega,
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/rotas/:id', { preHandler: requirePermission('transportadoras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = RotaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(rotas)
      .set({
        nome: d.nome,
        regiao: d.regiao,
        transportadoraId: d.transportadora_id || null,
        veiculoPadrao: d.veiculo_padrao,
        diasEntrega: d.dias_entrega,
      })
      .where(and(eq(rotas.id, id), eq(rotas.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/rotas/:id', { preHandler: requirePermission('transportadoras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.update(rotas).set({ ativo: 0 }).where(and(eq(rotas.id, id), eq(rotas.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // ── TIPOS DE VEÍCULO (CAPACIDADE / PESO MÁXIMO + TOLERÂNCIA) ────────────────
  app.get(
    '/api/cadastros/tipos-veiculo',
    {
      preHandler: requirePermission(
        ['transportadoras', 'roteirizacao', 'roteirizacao_carregamento', 'pedidos', 'saida', 'expedicao'],
        { write: false },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: tiposVeiculo.id,
          nome: tiposVeiculo.nome,
          categoria: tiposVeiculo.categoria,
          capacidade_kg: tiposVeiculo.capacidadeKg,
          tolerancia_pct: tiposVeiculo.toleranciaPct,
          observacoes: tiposVeiculo.observacoes,
          ativo: tiposVeiculo.ativo,
          created_at: tiposVeiculo.createdAt,
        })
        .from(tiposVeiculo)
        .where(and(eq(tiposVeiculo.tenantId, ctx.tenantId), eq(tiposVeiculo.ativo, 1)))
        .orderBy(asc(tiposVeiculo.capacidadeKg), asc(tiposVeiculo.nome))

      return {
        success: true,
        data: rows.map((r) => {
          const cap = Number(r.capacidade_kg || 0)
          const tol = Number(r.tolerancia_pct ?? 10)
          return {
            ...r,
            capacidade_kg: Number(cap.toFixed(2)),
            tolerancia_pct: Number(tol.toFixed(2)),
            capacidade_maxima_kg: Number((cap * (1 + tol / 100)).toFixed(2)),
          }
        }),
      }
    },
  )

  app.post(
    '/api/cadastros/tipos-veiculo',
    { preHandler: requirePermission(['transportadoras', 'roteirizacao']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = TipoVeiculoSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const id = uuidv7()
      await conn.db.insert(tiposVeiculo).values({
        id,
        tenantId: ctx.tenantId,
        nome: d.nome,
        categoria: d.categoria,
        capacidadeKg: String(d.capacidade_kg),
        toleranciaPct: String(d.tolerancia_pct),
        observacoes: d.observacoes,
        ativo: 1,
      })
      return reply.status(201).send({ success: true, id })
    },
  )

  app.put(
    '/api/cadastros/tipos-veiculo/:id',
    { preHandler: requirePermission(['transportadoras', 'roteirizacao']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = String((req.params as { id: string }).id || '').trim()
      const parsed = TipoVeiculoSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      await conn.db
        .update(tiposVeiculo)
        .set({
          nome: d.nome,
          categoria: d.categoria,
          capacidadeKg: String(d.capacidade_kg),
          toleranciaPct: String(d.tolerancia_pct),
          observacoes: d.observacoes,
        })
        .where(and(eq(tiposVeiculo.id, id), eq(tiposVeiculo.tenantId, ctx.tenantId)))
      return { success: true }
    },
  )

  app.delete(
    '/api/cadastros/tipos-veiculo/:id',
    { preHandler: requirePermission(['transportadoras', 'roteirizacao']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = String((req.params as { id: string }).id || '').trim()
      await conn.db
        .update(tiposVeiculo)
        .set({ ativo: 0 })
        .where(and(eq(tiposVeiculo.id, id), eq(tiposVeiculo.tenantId, ctx.tenantId)))
      return { success: true }
    },
  )

  // ── AUXILIARES COMERCIAIS / FISCAIS + CRUD ──────────────────────────────────
  app.get(
    '/api/cadastros/auxiliares',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const [formas, bancos, centros, naturezas, matriz, marchantesList] = await Promise.all([
        conn.db
          .select()
          .from(formasPagamento)
          .where(and(eq(formasPagamento.tenantId, ctx.tenantId), eq(formasPagamento.ativo, 1)))
          .orderBy(asc(formasPagamento.descricao)),
        conn.db
          .select()
          .from(locaisCobranca)
          .where(and(eq(locaisCobranca.tenantId, ctx.tenantId), eq(locaisCobranca.ativo, 1)))
          .orderBy(asc(locaisCobranca.nome)),
        conn.db
          .select()
          .from(centrosCusto)
          .where(and(eq(centrosCusto.tenantId, ctx.tenantId), eq(centrosCusto.ativo, 1)))
          .orderBy(asc(centrosCusto.codigo)),
        conn.db
          .select()
          .from(naturezasOperacao)
          .where(and(eq(naturezasOperacao.tenantId, ctx.tenantId), eq(naturezasOperacao.ativo, 1)))
          .orderBy(asc(naturezasOperacao.tipoMovimento), asc(naturezasOperacao.descricao)),
        conn.db
          .select()
          .from(matrizTributaria)
          .where(eq(matrizTributaria.tenantId, ctx.tenantId))
          .orderBy(asc(matrizTributaria.ncm)),
        conn.db
          .select()
          .from(marchantes)
          .where(and(eq(marchantes.tenantId, ctx.tenantId), eq(marchantes.ativo, 1)))
          .orderBy(desc(marchantes.isPadrao), asc(marchantes.codigo)),
      ])

      return {
        success: true,
        data: {
          formasPagamento: formas.map((f) => ({
            id: f.id,
            codigo: f.codigo,
            descricao: f.descricao,
            dias_parcelas: f.diasParcelasJson,
            pagamento_na_entrega: f.pagamentoNaEntrega,
            ativo: f.ativo,
          })),
          locaisCobranca: bancos,
          centrosCusto: centros,
          naturezasOperacao: naturezas.map((n) => ({
            id: n.id,
            tipo_movimento: n.tipoMovimento,
            finalidade: n.finalidade,
            descricao: n.descricao,
            cfop_estadual: n.cfopEstadual,
            cfop_interestadual: n.cfopInterestadual,
            codigo_sub_operacao: n.codigoSubOperacao,
            ativo: n.ativo,
          })),
          matrizTributaria: matriz.map((m) => ({
            id: m.id,
            ncm: m.ncm,
            uf_origem: m.ufOrigem,
            uf_destino: m.ufDestino,
            regime_tributario: m.regimeTributario,
            cst_csosn: m.cstCsosn,
            aliq_icms: Number(m.aliqIcms || 0),
            reducao_base_icms_pct: Number(m.reducaoBaseIcmsPct || 0),
            aliq_icms_st: Number(m.aliqIcmsSt || 0),
            validado_por_contador: m.validadoPorContador,
          })),
          marchantes: marchantesList.map((m) => ({
            id: m.id,
            codigo: m.codigo,
            nome: m.nome,
            is_padrao: m.isPadrao,
            ativo: m.ativo,
          })),
        },
      }
    }
  )

  app.post('/api/cadastros/marchantes', { preHandler: requirePermission('parametros_comerciais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = MarchanteSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const isPadrao = flag01(d.is_padrao, 0)
    const id = uuidv7()
    await conn.db.transaction(async (tx) => {
      if (isPadrao === 1) {
        await tx.update(marchantes).set({ isPadrao: 0 }).where(eq(marchantes.tenantId, ctx.tenantId))
      }
      await tx.insert(marchantes).values({
        id,
        tenantId: ctx.tenantId,
        codigo: d.codigo.toUpperCase(),
        nome: d.nome.toUpperCase(),
        isPadrao,
        ativo: 1,
      })
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/marchantes/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = MarchanteSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const isPadrao = flag01(d.is_padrao, 0)
    await conn.db.transaction(async (tx) => {
      if (isPadrao === 1) {
        await tx.update(marchantes).set({ isPadrao: 0 }).where(eq(marchantes.tenantId, ctx.tenantId))
      }
      await tx
        .update(marchantes)
        .set({
          codigo: d.codigo.toUpperCase(),
          nome: d.nome.toUpperCase(),
          isPadrao,
        })
        .where(and(eq(marchantes.id, id), eq(marchantes.tenantId, ctx.tenantId)))
    })
    return { success: true }
  })

  app.delete('/api/cadastros/marchantes/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.update(marchantes).set({ ativo: 0 }).where(and(eq(marchantes.id, id), eq(marchantes.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/cadastros/formas-pagamento', { preHandler: requirePermission('parametros_comerciais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = FormaPagamentoSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(formasPagamento).values({
      id,
      tenantId: ctx.tenantId,
      codigo: d.codigo.toUpperCase(),
      descricao: d.descricao.toUpperCase(),
      diasParcelasJson: d.dias_parcelas,
      pagamentoNaEntrega: flag01(d.pagamento_na_entrega, 0),
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/formas-pagamento/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = FormaPagamentoSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(formasPagamento)
      .set({
        codigo: d.codigo.toUpperCase(),
        descricao: d.descricao.toUpperCase(),
        diasParcelasJson: d.dias_parcelas,
        pagamentoNaEntrega: flag01(d.pagamento_na_entrega, 0),
      })
      .where(and(eq(formasPagamento.id, id), eq(formasPagamento.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/formas-pagamento/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.update(formasPagamento).set({ ativo: 0 }).where(and(eq(formasPagamento.id, id), eq(formasPagamento.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/cadastros/locais-cobranca', { preHandler: requirePermission('parametros_comerciais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = LocalCobrancaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(locaisCobranca).values({
      id,
      tenantId: ctx.tenantId,
      codigo: d.codigo.toUpperCase(),
      nome: d.nome.toUpperCase(),
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/locais-cobranca/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = LocalCobrancaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(locaisCobranca)
      .set({ codigo: d.codigo.toUpperCase(), nome: d.nome.toUpperCase() })
      .where(and(eq(locaisCobranca.id, id), eq(locaisCobranca.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/locais-cobranca/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.update(locaisCobranca).set({ ativo: 0 }).where(and(eq(locaisCobranca.id, id), eq(locaisCobranca.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/cadastros/centros-custo', { preHandler: requirePermission('parametros_comerciais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = CentroCustoSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(centrosCusto).values({
      id,
      tenantId: ctx.tenantId,
      codigo: d.codigo.toUpperCase(),
      descricao: d.descricao.toUpperCase(),
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/centros-custo/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = CentroCustoSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(centrosCusto)
      .set({ codigo: d.codigo.toUpperCase(), descricao: d.descricao.toUpperCase() })
      .where(and(eq(centrosCusto.id, id), eq(centrosCusto.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/centros-custo/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.update(centrosCusto).set({ ativo: 0 }).where(and(eq(centrosCusto.id, id), eq(centrosCusto.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/cadastros/naturezas-operacao', { preHandler: requirePermission('parametros_comerciais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = NaturezaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(naturezasOperacao).values({
      id,
      tenantId: ctx.tenantId,
      tipoMovimento: d.tipo_movimento,
      finalidade: d.finalidade.toUpperCase(),
      descricao: d.descricao.toUpperCase(),
      cfopEstadual: d.cfop_estadual,
      cfopInterestadual: d.cfop_interestadual,
      codigoSubOperacao: d.codigo_sub_operacao || '01',
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/naturezas-operacao/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = NaturezaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(naturezasOperacao)
      .set({
        tipoMovimento: d.tipo_movimento,
        finalidade: d.finalidade.toUpperCase(),
        descricao: d.descricao.toUpperCase(),
        cfopEstadual: d.cfop_estadual,
        cfopInterestadual: d.cfop_interestadual,
        codigoSubOperacao: d.codigo_sub_operacao || '01',
      })
      .where(and(eq(naturezasOperacao.id, id), eq(naturezasOperacao.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/naturezas-operacao/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.update(naturezasOperacao).set({ ativo: 0 }).where(and(eq(naturezasOperacao.id, id), eq(naturezasOperacao.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/cadastros/matriz-tributaria', { preHandler: requirePermission('parametros_comerciais') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = MatrizTribSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(matrizTributaria).values({
      id,
      tenantId: ctx.tenantId,
      ncm: d.ncm,
      ufOrigem: d.uf_origem,
      ufDestino: d.uf_destino,
      regimeTributario: d.regime_tributario,
      cstCsosn: d.cst_csosn,
      aliqIcms: String(d.aliq_icms),
      reducaoBaseIcmsPct: String(d.reducao_base_icms_pct),
      aliqIcmsSt: String(d.aliq_icms_st),
      validadoPorContador: d.validado_por_contador,
      updatedById: ctx.operador.id,
    })
    return reply.status(201).send({ success: true, id })
  })

  app.delete('/api/cadastros/matriz-tributaria/:id', { preHandler: requirePermission('parametros_comerciais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db
      .delete(matrizTributaria)
      .where(and(eq(matrizTributaria.id, id), eq(matrizTributaria.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // Sugestao automatica de CFOP comparando UF da Filial ativa x UF do parceiro
  app.get(
    '/api/cadastros/cfop-sugestao',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { tipo_movimento?: string; finalidade?: string; uf_parceiro?: string }
      const data = await sugerirCfopOperacao(conn.db, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        tipoMovimento: q.tipo_movimento,
        finalidade: q.finalidade,
        ufParceiro: q.uf_parceiro,
      })
      return { success: true, data }
    }
  )
}
