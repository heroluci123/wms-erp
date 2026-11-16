import type { FastifyInstance } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  clientes,
  filiais,
  formasPagamento,
  fornecedores,
  locais,
  locaisCobranca,
  naturezasOperacao,
  produtos,
  taras,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'

const ProdutoSchema = z.object({
  codigo: z.string().trim().min(1, 'Codigo interno obrigatorio.'),
  codigo_auxiliar: z.string().trim().optional().nullable(),
  ean: z.string().trim().optional().nullable(),
  descricao: z.string().trim().min(1, 'Descricao obrigatoria.'),
  valor_unitario: z.coerce.number().min(0).default(0),
  custo_medio_kg: z.coerce.number().min(0).default(0),
  tipo_produto: z.string().trim().default('Materia Prima'),
  status_curva: z.enum(['A', 'B', 'C']).default('C'),
  unidade: z.string().trim().default('CX'),
  grupo: z.string().trim().default(''),
  classificacao: z.string().trim().optional().nullable(),
  tara_primaria_peca_kg: z.coerce.number().min(0).default(0),
  ncm: z.string().trim().default(''),
})

const TaraSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da tara.'),
  peso_kg: z.coerce.number().min(0, 'Peso da tara invalido.'),
  padrao: z.union([z.boolean(), z.number()]).optional().default(0),
  ativo: z.union([z.boolean(), z.number()]).optional().default(1),
})

const LocalSchema = z.object({
  endereco: z.string().trim().min(1, 'Informe o endereco.'),
  capacidade_max_caixas: z.coerce.number().min(0).default(0),
  is_insumo: z.union([z.boolean(), z.number()]).optional().default(0),
  tipo_armazenamento: z.string().trim().default('FRIO'),
  filial_id: z.string().uuid().optional(),
})

const ClienteSchema = z.object({
  codigo: z.string().trim().optional().nullable(),
  razao_social: z.string().trim().min(1, 'Informe a Razao Social.'),
  nome_fantasia: z.string().trim().optional(),
  cnpj_cpf: z.string().trim().default(''),
  inscricao_estadual: z.string().trim().default(''),
  endereco: z.string().trim().default(''),
  numero: z.string().trim().default(''),
  complemento: z.string().trim().default(''),
  bairro: z.string().trim().default(''),
  cep: z.string().trim().default(''),
  cidade: z.string().trim().default(''),
  uf: z.string().trim().max(2).default('SP'),
  telefone: z.string().trim().default(''),
  icms: z.string().trim().default('CONTRIBUINTE'),
  vendedor_padrao_id: z.string().uuid().optional().nullable(),
  forma_pagamento_padrao_id: z.string().uuid().optional().nullable(),
  local_cobranca_padrao_id: z.string().uuid().optional().nullable(),
  marchante_padrao: z.string().trim().default(''),
  rota_padrao_nome: z.string().trim().default(''),
  limite_credito: z.coerce.number().min(0).default(0),
  permite_pagamento_entrega: z.union([z.boolean(), z.number()]).optional().default(1),
  is_padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const FornecedorSchema = z.object({
  codigo: z.string().trim().optional().nullable(),
  razao_social: z.string().trim().min(1, 'Informe a Razao Social do fornecedor.'),
  nome_fantasia: z.string().trim().optional(),
  cnpj_cpf: z.string().trim().default(''),
  inscricao_estadual: z.string().trim().default(''),
  uf: z.string().trim().max(2).default('SP'),
  cidade: z.string().trim().default(''),
  telefone: z.string().trim().default(''),
  registro_sanitario_sif: z.string().trim().default(''),
  prazo_entrega_dias: z.coerce.number().int().min(0).default(5),
})

const VendedorSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o codigo do vendedor.'),
  sigla: z.string().trim().default(''),
  nome: z.string().trim().min(1, 'Informe o nome do vendedor.'),
  tipo_comissao: z.enum(['PCT_VENDA', 'PCT_MARGEM', 'VALOR_KG']).default('PCT_VENDA'),
  pct_comissao: z.coerce.number().min(0).default(0),
  regra_liberacao: z.enum(['FATURAMENTO', 'LIQUIDACAO']).default('FATURAMENTO'),
  meta_mensal_kg: z.coerce.number().min(0).default(0),
  meta_mensal_valor: z.coerce.number().min(0).default(0),
})

const PERM_PROD_READ = [
  'produtos',
  'consulta_estoque',
  'recebimento',
  'inventario_coletor',
  'inventario_gestao',
  'retorno_producao',
  'desmembramento',
  'pedidos',
  'pedidos_consultar',
  'saida',
  'ean_etiquetas',
  'reimpressao',
  'rastreabilidade',
]

export function registerCadastrosRoutes(app: FastifyInstance, conn: DbConnection) {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // Contexto operacional: filiais da empresa atual
  app.get(
    '/api/contexto/filiais',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(filiais)
        .where(and(eq(filiais.tenantId, ctx.tenantId), eq(filiais.ativo, 1)))
        .orderBy(asc(filiais.codigo))
      return { success: true, data: rows }
    }
  )

  // Produtos
  app.get(
    '/api/cadastros/produtos',
    { preHandler: requirePermission(PERM_PROD_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(produtos)
        .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.ativo, 1)))
        .orderBy(asc(produtos.descricao))
      return { success: true, data: rows }
    }
  )

  app.post(
    '/api/cadastros/produtos',
    { preHandler: requirePermission('produtos') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = ProdutoSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data

      const dup = await conn.db
        .select({ id: produtos.id })
        .from(produtos)
        .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.codigo, d.codigo)))
        .limit(1)
      if (dup.length > 0) throw new HttpError(409, `Ja existe produto com o codigo "${d.codigo}".`)

      const id = uuidv7()
      await conn.db.insert(produtos).values({
        id,
        tenantId: ctx.tenantId,
        codigo: d.codigo,
        codigoAuxiliar: d.codigo_auxiliar || null,
        ean: d.ean || null,
        descricao: d.descricao,
        valorUnitario: String(d.valor_unitario),
        custoMedioKg: String(d.custo_medio_kg),
        tipoProduto: d.tipo_produto,
        statusCurva: d.status_curva,
        unidade: d.unidade,
        grupo: d.grupo,
        classificacao: d.classificacao || null,
        taraPrimariaPecaKg: String(d.tara_primaria_peca_kg),
        ncm: d.ncm,
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  // Taras
  app.get(
    '/api/cadastros/taras',
    {
      preHandler: requirePermission(
        ['taras', 'recebimento', 'retorno_producao', 'producao_saida', 'desmembramento', 'inventario_coletor'],
        { write: false }
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(taras)
        .where(eq(taras.tenantId, ctx.tenantId))
        .orderBy(asc(taras.nome))
      return { success: true, data: rows }
    }
  )

  app.post(
    '/api/cadastros/taras',
    { preHandler: requirePermission('taras') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = TaraSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const padrao = d.padrao === true || Number(d.padrao) === 1 ? 1 : 0
      const ativo = d.ativo === false || Number(d.ativo) === 0 ? 0 : 1

      const id = uuidv7()
      await conn.db.transaction(async (tx) => {
        if (padrao === 1) {
          await tx.update(taras).set({ padrao: 0 }).where(eq(taras.tenantId, ctx.tenantId))
        }
        await tx.insert(taras).values({
          id,
          tenantId: ctx.tenantId,
          nome: d.nome,
          pesoKg: String(d.peso_kg),
          padrao,
          ativo,
        })
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  // Locais
  app.get(
    '/api/cadastros/locais',
    {
      preHandler: requirePermission(
        ['locais', 'movimentacao', 'recebimento', 'consulta_endereco', 'estoque_enderecos', 'inventario_coletor'],
        { write: false }
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(locais)
        .where(and(eq(locais.tenantId, ctx.tenantId), eq(locais.ativo, 1)))
        .orderBy(asc(locais.endereco))
      return { success: true, data: rows }
    }
  )

  app.post(
    '/api/cadastros/locais',
    { preHandler: requirePermission('locais') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = LocalSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const id = uuidv7()
      await conn.db.insert(locais).values({
        id,
        tenantId: ctx.tenantId,
        filialId: d.filial_id || ctx.filialId,
        endereco: d.endereco.toUpperCase(),
        capacidadeMaxCaixas: String(d.capacidade_max_caixas),
        isInsumo: d.is_insumo === true || Number(d.is_insumo) === 1 ? 1 : 0,
        tipoArmazenamento: d.tipo_armazenamento,
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  // Clientes (com condicao de pagamento, vendedor, local de cobranca, marchante)
  app.get(
    '/api/cadastros/clientes',
    { preHandler: requirePermission(['pedidos', 'pedidos_consultar', 'saida', 'expedicao'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(clientes)
        .where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.ativo, 1)))
        .orderBy(asc(clientes.razaoSocial))
      return { success: true, data: rows }
    }
  )

  app.post(
    '/api/cadastros/clientes',
    { preHandler: requirePermission('pedidos') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = ClienteSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const isPadrao = d.is_padrao === true || Number(d.is_padrao) === 1 ? 1 : 0
      const id = uuidv7()

      await conn.db.transaction(async (tx) => {
        if (isPadrao === 1) {
          await tx.update(clientes).set({ isPadrao: 0 }).where(eq(clientes.tenantId, ctx.tenantId))
        }
        await tx.insert(clientes).values({
          id,
          tenantId: ctx.tenantId,
          codigo: d.codigo || null,
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
          uf: d.uf.toUpperCase(),
          telefone: d.telefone,
          icms: d.icms,
          vendedorPadraoId: d.vendedor_padrao_id || null,
          formaPagamentoPadraoId: d.forma_pagamento_padrao_id || null,
          localCobrancaPadraoId: d.local_cobranca_padrao_id || null,
          marchantePadrao: d.marchante_padrao,
          rotaPadraoNome: d.rota_padrao_nome,
          limiteCredito: String(d.limite_credito),
          permitePagamentoEntrega:
            d.permite_pagamento_entrega === false || Number(d.permite_pagamento_entrega) === 0 ? 0 : 1,
          isPadrao,
        })
      })

      return reply.status(201).send({ success: true, id })
    }
  )

  // Fornecedores
  app.get(
    '/api/cadastros/fornecedores',
    { preHandler: requirePermission(['recebimento', 'recebimento_consultar', 'produtos'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(fornecedores)
        .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
        .orderBy(asc(fornecedores.razaoSocial))
      return { success: true, data: rows }
    }
  )

  app.post(
    '/api/cadastros/fornecedores',
    { preHandler: requirePermission(['recebimento', 'produtos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = FornecedorSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const id = uuidv7()
      await conn.db.insert(fornecedores).values({
        id,
        tenantId: ctx.tenantId,
        codigo: d.codigo || null,
        razaoSocial: d.razao_social,
        nomeFantasia: d.nome_fantasia || d.razao_social,
        cnpjCpf: d.cnpj_cpf,
        inscricaoEstadual: d.inscricao_estadual,
        uf: d.uf.toUpperCase(),
        cidade: d.cidade,
        telefone: d.telefone,
        registroSanitarioSif: d.registro_sanitario_sif,
        prazoEntregaDias: d.prazo_entrega_dias,
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  // Vendedores
  app.get(
    '/api/cadastros/vendedores',
    { preHandler: requirePermission(['pedidos', 'pedidos_consultar', 'operadores'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(vendedores)
        .where(and(eq(vendedores.tenantId, ctx.tenantId), eq(vendedores.ativo, 1)))
        .orderBy(asc(vendedores.nome))
      return { success: true, data: rows }
    }
  )

  app.post(
    '/api/cadastros/vendedores',
    { preHandler: requirePermission('operadores') },
    async (req, reply) => {
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
        tipoComissao: d.tipo_comissao,
        pctComissao: String(d.pct_comissao),
        regraLiberacao: d.regra_liberacao,
        metaMensalKg: String(d.meta_mensal_kg),
        metaMensalValor: String(d.meta_mensal_valor),
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  // Auxiliares comerciais/fiscais (formas pgto, bancos cobranca, centros de custo, naturezas CFOP)
  app.get(
    '/api/cadastros/auxiliares',
    { preHandler: requirePermission(null, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const [formas, bancos, centros, naturezas] = await Promise.all([
        conn.db.select().from(formasPagamento).where(eq(formasPagamento.tenantId, ctx.tenantId)),
        conn.db.select().from(locaisCobranca).where(eq(locaisCobranca.tenantId, ctx.tenantId)),
        conn.db.select().from(centrosCusto).where(eq(centrosCusto.tenantId, ctx.tenantId)),
        conn.db.select().from(naturezasOperacao).where(eq(naturezasOperacao.tenantId, ctx.tenantId)),
      ])
      return {
        success: true,
        data: {
          formasPagamento: formas,
          locaisCobranca: bancos,
          centrosCusto: centros,
          naturezasOperacao: naturezas,
        },
      }
    }
  )

  // Consulta rapida do proprio schema/contagens para health/diagnostico admin
  app.get(
    '/api/cadastros/resumo',
    { preHandler: requirePermission('operadores', { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const res = await conn.queryRaw<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM produtos WHERE tenant_id = $1 AND ativo = 1`,
        [ctx.tenantId]
      )
      return { success: true, totalProdutos: Number(res[0]?.n || 0) }
    }
  )
}
