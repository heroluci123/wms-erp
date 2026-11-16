import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
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
  transportadoras,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { sugerirCfopOperacao } from '../wms/helpers.js'
import { uuidv7 } from '../../utils/uuid.js'

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
  registro_sanitario_tipo: z.enum(['DIPOA', 'SIF', 'SISBI', 'SIM', 'NENHUM']).default('SIF'),
  registro_sanitario_num: optStr(''),
  is_padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const ClienteSchema = z.object({
  codigo: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  razao_social: z.string().trim().min(1, 'Informe a Razão Social.'),
  nome_fantasia: optStr(''),
  cnpj_cpf: optStr(''),
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
  bloqueado_financeiro: z.union([z.boolean(), z.number()]).optional().default(0),
  permite_pagamento_entrega: z.union([z.boolean(), z.number()]).optional().default(1),
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
  uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  cidade: optStr(''),
  telefone: optStr(''),
  registro_sanitario_sif: optStr(''),
  prazo_entrega_dias: z.coerce.number().int().min(0).default(5),
})

const VendedorSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código do vendedor.'),
  sigla: optStr(''),
  nome: z.string().trim().min(1, 'Informe o nome do vendedor.'),
  operador_id: optNullableUuid.optional(),
  tipo_comissao: z.enum(['PCT_VENDA', 'PCT_MARGEM', 'VALOR_KG']).default('PCT_VENDA'),
  pct_comissao: z.coerce.number().min(0).default(0),
  regra_liberacao: z.enum(['FATURAMENTO', 'LIQUIDACAO']).default('FATURAMENTO'),
  meta_mensal_kg: z.coerce.number().min(0).default(0),
  meta_mensal_valor: z.coerce.number().min(0).default(0),
})

const TransportadoraSchema = z.object({
  codigo: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  razao_social: z.string().trim().min(1, 'Informe a Razão Social / Nome da transportadora.'),
  nome_fantasia: optStr(''),
  cnpj_cpf: optStr(''),
  inscricao_estadual: optStr(''),
  uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  cidade: optStr(''),
  telefone: optStr(''),
  placa_padrao: z.string().nullish().transform((v) => (v ?? '').trim().toUpperCase()),
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
    { preHandler: requirePermission(['clientes', 'pedidos', 'pedidos_consultar', 'financeiro_pedidos', 'saida', 'expedicao'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const res = await conn.db.execute(sql`
        SELECT
          c.id,
          c.codigo,
          c.razao_social,
          c.nome_fantasia,
          c.cnpj_cpf,
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
          c.bloqueado_financeiro,
          c.permite_pagamento_entrega,
          c.is_padrao,
          c.ativo,
          COALESCE((SELECT COUNT(*)::int FROM cliente_produto_espec e WHERE e.cliente_id = c.id), 0) AS qtd_especificacoes,
          COALESCE((SELECT COUNT(*)::int FROM cliente_produto_espec e WHERE e.cliente_id = c.id AND e.alerta_reclamacao = 1), 0) AS qtd_alertas
        FROM clientes c
        LEFT JOIN vendedores v ON v.id = c.vendedor_padrao_id
        LEFT JOIN formas_pagamento fp ON fp.id = c.forma_pagamento_padrao_id
        LEFT JOIN locais_cobranca lc ON lc.id = c.local_cobranca_padrao_id
        WHERE c.tenant_id = ${ctx.tenantId} AND c.ativo = 1
        ORDER BY c.is_padrao DESC, c.razao_social ASC
      `)

      return {
        success: true,
        data: (res.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          limite_credito: Number(r.limite_credito || 0),
          bloqueado_financeiro: Number(r.bloqueado_financeiro || 0),
          permite_pagamento_entrega: Number(r.permite_pagamento_entrega ?? 1),
          is_padrao: Number(r.is_padrao || 0),
          qtd_especificacoes: Number(r.qtd_especificacoes || 0),
          qtd_alertas: Number(r.qtd_alertas || 0),
        })),
      }
    }
  )

  app.post(
    '/api/cadastros/clientes',
    { preHandler: requirePermission(['clientes', 'pedidos', 'financeiro_pedidos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = ClienteSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const isPadrao = flag01(d.is_padrao, 0)
      const id = uuidv7()

      await conn.db.transaction(async (tx) => {
        if (isPadrao === 1) {
          await tx.update(clientes).set({ isPadrao: 0 }).where(eq(clientes.tenantId, ctx.tenantId))
        }
        await tx.insert(clientes).values({
          id,
          tenantId: ctx.tenantId,
          codigo: d.codigo,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
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
          bloqueadoFinanceiro: flag01(d.bloqueado_financeiro, 0),
          permitePagamentoEntrega: flag01(d.permite_pagamento_entrega, 1),
          isPadrao,
        })
      })

      return reply.status(201).send({ success: true, id })
    }
  )

  app.put('/api/cadastros/clientes/:id', { preHandler: requirePermission(['clientes', 'pedidos']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = ClienteSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const isPadrao = flag01(d.is_padrao, 0)

    await conn.db.transaction(async (tx) => {
      if (isPadrao === 1) {
        await tx.update(clientes).set({ isPadrao: 0 }).where(eq(clientes.tenantId, ctx.tenantId))
      }
      await tx
        .update(clientes)
        .set({
          codigo: d.codigo,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia || d.razao_social,
          cnpjCpf: d.cnpj_cpf,
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
          bloqueadoFinanceiro: flag01(d.bloqueado_financeiro, 0),
          permitePagamentoEntrega: flag01(d.permite_pagamento_entrega, 1),
          isPadrao,
        })
        .where(and(eq(clientes.id, id), eq(clientes.tenantId, ctx.tenantId)))
    })

    return { success: true }
  })

  app.delete('/api/cadastros/clientes/:id', { preHandler: requirePermission(['clientes', 'pedidos']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db
      .update(clientes)
      .set({ ativo: 0, isPadrao: 0 })
      .where(and(eq(clientes.id, id), eq(clientes.tenantId, ctx.tenantId)))
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

  // ── FORNECEDORES ────────────────────────────────────────────────────────────
  app.get(
    '/api/cadastros/fornecedores',
    { preHandler: requirePermission(['fornecedores', 'recebimento', 'recebimento_consultar', 'compras', 'produtos'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: fornecedores.id,
          codigo: fornecedores.codigo,
          razao_social: fornecedores.razaoSocial,
          nome_fantasia: fornecedores.nomeFantasia,
          cnpj_cpf: fornecedores.cnpjCpf,
          inscricao_estadual: fornecedores.inscricaoEstadual,
          uf: fornecedores.uf,
          cidade: fornecedores.cidade,
          telefone: fornecedores.telefone,
          registro_sanitario_sif: fornecedores.registroSanitarioSif,
          prazo_entrega_dias: fornecedores.prazoEntregaDias,
          ativo: fornecedores.ativo,
          created_at: fornecedores.createdAt,
        })
        .from(fornecedores)
        .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
        .orderBy(asc(fornecedores.razaoSocial))
      return { success: true, data: rows }
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
      await conn.db.insert(fornecedores).values({
        id,
        tenantId: ctx.tenantId,
        codigo: d.codigo,
        razaoSocial: d.razao_social,
        nomeFantasia: d.nome_fantasia || d.razao_social,
        cnpjCpf: d.cnpj_cpf,
        inscricaoEstadual: d.inscricao_estadual,
        uf: d.uf,
        cidade: d.cidade,
        telefone: d.telefone,
        registroSanitarioSif: d.registro_sanitario_sif,
        prazoEntregaDias: d.prazo_entrega_dias,
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  app.put('/api/cadastros/fornecedores/:id', { preHandler: requirePermission(['fornecedores', 'recebimento']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = FornecedorSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(fornecedores)
      .set({
        codigo: d.codigo,
        razaoSocial: d.razao_social,
        nomeFantasia: d.nome_fantasia || d.razao_social,
        cnpjCpf: d.cnpj_cpf,
        inscricaoEstadual: d.inscricao_estadual,
        uf: d.uf,
        cidade: d.cidade,
        telefone: d.telefone,
        registroSanitarioSif: d.registro_sanitario_sif,
        prazoEntregaDias: d.prazo_entrega_dias,
      })
      .where(and(eq(fornecedores.id, id), eq(fornecedores.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/fornecedores/:id', { preHandler: requirePermission(['fornecedores', 'recebimento']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db
      .update(fornecedores)
      .set({ ativo: 0 })
      .where(and(eq(fornecedores.id, id), eq(fornecedores.tenantId, ctx.tenantId)))
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
    await conn.db.insert(vendedores).values({
      id,
      tenantId: ctx.tenantId,
      codigo: d.codigo,
      sigla: d.sigla.toUpperCase(),
      nome: d.nome,
      operadorId: d.operador_id || null,
      tipoComissao: d.tipo_comissao,
      pctComissao: String(d.pct_comissao),
      regraLiberacao: d.regra_liberacao,
      metaMensalKg: String(d.meta_mensal_kg),
      metaMensalValor: String(d.meta_mensal_valor),
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/vendedores/:id', { preHandler: requirePermission(['vendedores', 'operadores']) }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = VendedorSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(vendedores)
      .set({
        codigo: d.codigo,
        sigla: d.sigla.toUpperCase(),
        nome: d.nome,
        operadorId: d.operador_id || null,
        tipoComissao: d.tipo_comissao,
        pctComissao: String(d.pct_comissao),
        regraLiberacao: d.regra_liberacao,
        metaMensalKg: String(d.meta_mensal_kg),
        metaMensalValor: String(d.meta_mensal_valor),
      })
      .where(and(eq(vendedores.id, id), eq(vendedores.tenantId, ctx.tenantId)))
    return { success: true }
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
    { preHandler: requirePermission(['transportadoras', 'pedidos', 'saida', 'expedicao'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: transportadoras.id,
          codigo: transportadoras.codigo,
          razao_social: transportadoras.razaoSocial,
          nome_fantasia: transportadoras.nomeFantasia,
          cnpj_cpf: transportadoras.cnpjCpf,
          inscricao_estadual: transportadoras.inscricaoEstadual,
          uf: transportadoras.uf,
          cidade: transportadoras.cidade,
          telefone: transportadoras.telefone,
          placa_padrao: transportadoras.placaPadrao,
          ativo: transportadoras.ativo,
        })
        .from(transportadoras)
        .where(and(eq(transportadoras.tenantId, ctx.tenantId), eq(transportadoras.ativo, 1)))
        .orderBy(asc(transportadoras.razaoSocial))
      return { success: true, data: rows }
    }
  )

  app.post('/api/cadastros/transportadoras', { preHandler: requirePermission('transportadoras') }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = TransportadoraSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const id = uuidv7()
    await conn.db.insert(transportadoras).values({
      id,
      tenantId: ctx.tenantId,
      codigo: d.codigo,
      razaoSocial: d.razao_social,
      nomeFantasia: d.nome_fantasia || d.razao_social,
      cnpjCpf: d.cnpj_cpf,
      inscricaoEstadual: d.inscricao_estadual,
      uf: d.uf,
      cidade: d.cidade,
      telefone: d.telefone,
      placaPadrao: d.placa_padrao,
    })
    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/cadastros/transportadoras/:id', { preHandler: requirePermission('transportadoras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = TransportadoraSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(transportadoras)
      .set({
        codigo: d.codigo,
        razaoSocial: d.razao_social,
        nomeFantasia: d.nome_fantasia || d.razao_social,
        cnpjCpf: d.cnpj_cpf,
        inscricaoEstadual: d.inscricao_estadual,
        uf: d.uf,
        cidade: d.cidade,
        telefone: d.telefone,
        placaPadrao: d.placa_padrao,
      })
      .where(and(eq(transportadoras.id, id), eq(transportadoras.tenantId, ctx.tenantId)))
    return { success: true }
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
