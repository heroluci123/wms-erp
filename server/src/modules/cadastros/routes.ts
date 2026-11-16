import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  estoquePosicao,
  filiais,
  locais,
  produtoArvore,
  produtos,
  taras,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { registerCadastrosMestresRoutes } from './mestresRoutes.js'

const ArvoreVinculoSchema = z.object({
  pai_id: z.string().uuid(),
  rendimento_esperado_pct: z.coerce.number().min(0).max(100).nullish(),
})

const ProdutoSchema = z.object({
  codigo: z.string().trim().min(1, 'Codigo interno obrigatorio.'),
  codigo_auxiliar: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  ean: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  descricao: z.string().trim().min(1, 'Descricao obrigatoria.'),
  valor_unitario: z.coerce.number().min(0).default(0),
  custo_medio_kg: z.coerce.number().min(0).default(0),
  tipo_produto: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : 'Materia Prima')),
  status_curva: z.enum(['A', 'B', 'C']).default('C'),
  unidade: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : 'CX')),
  grupo: z.string().nullish().transform((v) => (v ?? '').trim()),
  classificacao: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null)),
  peso_padrao_cx: z.coerce.number().min(0).nullish(),
  tara_primaria_peca_kg: z.coerce.number().min(0).default(0),
  ncm: z.string().nullish().transform((v) => (v ?? '').trim()),
  cest: z.string().nullish().transform((v) => (v ?? '').trim()),
  origem_mercadoria: z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : '0')),
  pais_ids: z.array(z.string().uuid()).optional().default([]),
  arvore_vinculos: z.array(ArvoreVinculoSchema).optional(),
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
      return {
        success: true,
        filial_ativa_id: ctx.filialId,
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

  // Produtos
  app.get(
    '/api/cadastros/produtos',
    { preHandler: requirePermission(PERM_PROD_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const [res, arvRes] = await Promise.all([
        conn.db.execute(sql`
          SELECT
            p.id,
            p.codigo,
            p.codigo_auxiliar,
            p.ean,
            p.descricao,
            p.valor_unitario,
            p.custo_medio_kg,
            p.tipo_produto,
            p.status_curva,
            p.unidade,
            p.grupo,
            p.classificacao,
            p.peso_padrao_cx,
            p.tara_primaria_peca_kg,
            p.ncm,
            p.cest,
            p.origem_mercadoria,
            p.created_at,
            STRING_AGG(DISTINCT pai.id::text, ',') AS pais_ids,
            STRING_AGG(DISTINCT pai.descricao, ', ') AS pai_descricao,
            COALESCE(pos.saldo_kg, 0) AS saldo_kg,
            COALESCE(pos.qtd_caixas, 0) AS qtd_caixas
          FROM produtos p
          LEFT JOIN produto_arvore pa ON pa.filho_id = p.id AND pa.tenant_id = ${ctx.tenantId}
          LEFT JOIN produtos pai ON pai.id = pa.pai_id
          LEFT JOIN (
            SELECT ep.produto_id,
                   SUM(ep.qtd_kg) AS saldo_kg,
                   SUM(ep.qtd_caixas) AS qtd_caixas
            FROM estoque_posicao ep
            WHERE ep.tenant_id = ${ctx.tenantId} AND ep.filial_id = ${ctx.filialId}
            GROUP BY ep.produto_id
          ) pos ON pos.produto_id = p.id
          WHERE p.tenant_id = ${ctx.tenantId} AND p.ativo = 1
          GROUP BY p.id, pos.saldo_kg, pos.qtd_caixas
          ORDER BY p.descricao ASC
        `),
        conn.db
          .select({
            pai_id: produtoArvore.paiId,
            filho_id: produtoArvore.filhoId,
            rendimento_esperado_pct: produtoArvore.rendimentoEsperadoPct,
            rendimento_aprendido_pct: produtoArvore.rendimentoAprendidoPct,
            amostras_aprendizado: produtoArvore.amostrasAprendizado,
            origem_vinculo: produtoArvore.origemVinculo,
          })
          .from(produtoArvore)
          .where(eq(produtoArvore.tenantId, ctx.tenantId)),
      ])

      const arvMap = new Map<string, Array<Record<string, unknown>>>()
      for (const v of arvRes) {
        const list = arvMap.get(v.filho_id) || []
        list.push({
          pai_id: v.pai_id,
          rendimento_esperado_pct: v.rendimento_esperado_pct != null ? Number(v.rendimento_esperado_pct) : null,
          rendimento_aprendido_pct: v.rendimento_aprendido_pct != null ? Number(v.rendimento_aprendido_pct) : null,
          amostras_aprendizado: Number(v.amostras_aprendizado || 0),
          origem_vinculo: v.origem_vinculo,
        })
        arvMap.set(v.filho_id, list)
      }

      const rows = (res.rows as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        valor_unitario: Number(r.valor_unitario || 0),
        custo_medio_kg: Number(r.custo_medio_kg || 0),
        peso_padrao_cx: r.peso_padrao_cx != null ? Number(r.peso_padrao_cx) : null,
        tara_primaria_peca_kg: Number(r.tara_primaria_peca_kg || 0),
        saldo_kg: Number(r.saldo_kg || 0),
        qtd_caixas: Number(r.qtd_caixas || 0),
        arvore_vinculos: arvMap.get(String(r.id)) || [],
      }))
      return { success: true, data: rows }
    }
  )

  app.get(
    '/api/cadastros/produtos/sugestao-ean/:codigo',
    { preHandler: requirePermission(PERM_PROD_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const codigoStr = String((req.params as { codigo: string }).codigo || '').trim()
      if (codigoStr.length < 4) return { data: null }

      const res = await conn.db.execute(sql`
        SELECT p.*, pe.codigo_barras AS regra_usada
        FROM produtos_eans pe
        JOIN produtos p ON pe.produto_id = p.id
        WHERE pe.tenant_id = ${ctx.tenantId}
          AND pe.tipo_regra = 'CONTEM'
          AND ${codigoStr} LIKE '%' || pe.codigo_barras
        ORDER BY LENGTH(pe.codigo_barras) DESC
        LIMIT 1
      `)
      const row = res.rows[0] as Record<string, unknown> | undefined
      return { data: row ? { produto: row, regraUsada: row.regra_usada } : null }
    }
  )

  app.get(
    '/api/cadastros/produtos/buscar/:codigo',
    { preHandler: requirePermission(PERM_PROD_READ, { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const codigoStr = String((req.params as { codigo: string }).codigo || '').trim()
      if (!codigoStr) return { data: null }

      const codigoNorm = codigoStr.replace(/^0+/, '') || codigoStr
      const direct = await conn.db
        .select({
          id: produtos.id,
          codigo: produtos.codigo,
          ean: produtos.ean,
          descricao: produtos.descricao,
          valor_unitario: produtos.valorUnitario,
          tipo_produto: produtos.tipoProduto,
          status_curva: produtos.statusCurva,
          unidade: produtos.unidade,
          grupo: produtos.grupo,
        })
        .from(produtos)
        .where(
          and(
            eq(produtos.tenantId, ctx.tenantId),
            eq(produtos.ativo, 1),
            sql`(${produtos.codigo} IN (${codigoNorm}, ${codigoStr}) OR ${produtos.ean} IN (${codigoStr}, ${codigoNorm}))`,
          ),
        )
        .limit(1)

      if (direct[0]) {
        return {
          data: {
            produto: { ...direct[0], valor_unitario: Number(direct[0].valor_unitario || 0) },
            eanUnico: true,
          },
        }
      }

      const regraRes = await conn.db.execute(sql`
        SELECT p.id, p.codigo, p.ean, p.descricao, p.valor_unitario, p.tipo_produto, p.status_curva, p.unidade, p.grupo
        FROM produtos_eans pe
        JOIN produtos p ON pe.produto_id = p.id
        WHERE pe.tenant_id = ${ctx.tenantId}
          AND (pe.codigo_barras = ${codigoStr} OR (pe.tipo_regra = 'CONTEM' AND ${codigoStr} LIKE '%' || pe.codigo_barras))
        ORDER BY pe.tipo_regra DESC
        LIMIT 1
      `)
      if (regraRes.rows[0]) {
        const r = regraRes.rows[0] as Record<string, unknown>
        return {
          data: {
            produto: { ...r, valor_unitario: Number(r.valor_unitario || 0) },
            eanUnico: false,
          },
        }
      }

      const semZeros = codigoStr.replace(/^0+/, '')
      if (semZeros.length >= 8 && semZeros.length < 14) {
        const ult6 = semZeros.slice(-6)
        const ult6Norm = ult6.replace(/^0+/, '') || ult6
        const leg = await conn.db
          .select({
            id: produtos.id,
            codigo: produtos.codigo,
            ean: produtos.ean,
            descricao: produtos.descricao,
            valor_unitario: produtos.valorUnitario,
            tipo_produto: produtos.tipoProduto,
            status_curva: produtos.statusCurva,
            unidade: produtos.unidade,
            grupo: produtos.grupo,
          })
          .from(produtos)
          .where(
            and(
              eq(produtos.tenantId, ctx.tenantId),
              eq(produtos.ativo, 1),
              sql`(${produtos.codigo} IN (${ult6}, ${ult6Norm}) OR ${produtos.ean} IN (${ult6}, ${ult6Norm}))`,
            ),
          )
          .limit(1)
        if (leg[0]) {
          return {
            data: {
              produto: { ...leg[0], valor_unitario: Number(leg[0].valor_unitario || 0) },
              eanUnico: false,
            },
          }
        }
      }

      return { data: null }
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

      const vinculos =
        Array.isArray(d.arvore_vinculos) && d.arvore_vinculos.length > 0
          ? d.arvore_vinculos
          : d.pais_ids.map((paiId) => ({ pai_id: paiId, rendimento_esperado_pct: null }))

      const id = uuidv7()
      await conn.db.transaction(async (tx) => {
        await tx.insert(produtos).values({
          id,
          tenantId: ctx.tenantId,
          codigo: d.codigo,
          codigoAuxiliar: d.codigo_auxiliar,
          ean: d.ean,
          descricao: d.descricao,
          valorUnitario: String(d.valor_unitario),
          custoMedioKg: String(d.custo_medio_kg),
          tipoProduto: d.tipo_produto,
          statusCurva: d.status_curva,
          unidade: d.unidade,
          grupo: d.grupo,
          classificacao: d.classificacao,
          pesoPadraoCx: d.peso_padrao_cx != null ? String(d.peso_padrao_cx) : null,
          taraPrimariaPecaKg: String(d.tara_primaria_peca_kg),
          ncm: d.ncm,
          cest: d.cest,
          origemMercadoria: d.origem_mercadoria,
        })

        if (d.classificacao === 'SUBPRODUTO' && vinculos.length > 0) {
          for (const v of vinculos) {
            await tx
              .insert(produtoArvore)
              .values({
                id: uuidv7(),
                tenantId: ctx.tenantId,
                paiId: v.pai_id,
                filhoId: id,
                rendimentoEsperadoPct:
                  v.rendimento_esperado_pct != null ? String(v.rendimento_esperado_pct) : null,
                origemVinculo: 'MANUAL',
                confirmado: 1,
              })
              .onConflictDoNothing()
          }
        }
      })
      return reply.status(201).send({ success: true, id })
    }
  )

  app.put(
    '/api/cadastros/produtos/:id',
    { preHandler: requirePermission('produtos') },
    async (req) => {
      const ctx = req.authCtx!
      const id = String((req.params as { id: string }).id || '').trim()
      const parsed = ProdutoSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
      const d = parsed.data
      const vinculos =
        Array.isArray(d.arvore_vinculos) && d.arvore_vinculos.length > 0
          ? d.arvore_vinculos
          : d.pais_ids.map((paiId) => ({ pai_id: paiId, rendimento_esperado_pct: null }))

      const dup = await conn.db
        .select({ id: produtos.id })
        .from(produtos)
        .where(
          and(
            eq(produtos.tenantId, ctx.tenantId),
            eq(produtos.codigo, d.codigo),
            sql`${produtos.id} != ${id}`,
          ),
        )
        .limit(1)
      if (dup.length > 0) throw new HttpError(409, `Ja existe outro produto com o codigo "${d.codigo}".`)

      await conn.db.transaction(async (tx) => {
        await tx
          .update(produtos)
          .set({
            codigo: d.codigo,
            codigoAuxiliar: d.codigo_auxiliar,
            ean: d.ean,
            descricao: d.descricao,
            valorUnitario: String(d.valor_unitario),
            custoMedioKg: String(d.custo_medio_kg),
            tipoProduto: d.tipo_produto,
            statusCurva: d.status_curva,
            unidade: d.unidade,
            grupo: d.grupo,
            classificacao: d.classificacao,
            pesoPadraoCx: d.peso_padrao_cx != null ? String(d.peso_padrao_cx) : null,
            taraPrimariaPecaKg: String(d.tara_primaria_peca_kg),
            ncm: d.ncm,
            cest: d.cest,
            origemMercadoria: d.origem_mercadoria,
            updatedAt: new Date(),
          })
          .where(and(eq(produtos.id, id), eq(produtos.tenantId, ctx.tenantId)))

        await tx
          .delete(produtoArvore)
          .where(and(eq(produtoArvore.tenantId, ctx.tenantId), eq(produtoArvore.filhoId, id)))

        if (d.classificacao === 'SUBPRODUTO' && vinculos.length > 0) {
          for (const v of vinculos) {
            await tx
              .insert(produtoArvore)
              .values({
                id: uuidv7(),
                tenantId: ctx.tenantId,
                paiId: v.pai_id,
                filhoId: id,
                rendimentoEsperadoPct:
                  v.rendimento_esperado_pct != null ? String(v.rendimento_esperado_pct) : null,
                origemVinculo: 'MANUAL',
                confirmado: 1,
              })
              .onConflictDoNothing()
          }
        }
      })

      return { success: true }
    }
  )

  app.delete(
    '/api/cadastros/produtos/:id',
    { preHandler: requirePermission('produtos') },
    async (req) => {
      const ctx = req.authCtx!
      const id = String((req.params as { id: string }).id || '').trim()
      const [saldo] = await conn.db
        .select({ total: sql<string>`COALESCE(SUM(${estoquePosicao.qtdCaixas}), 0)` })
        .from(estoquePosicao)
        .where(and(eq(estoquePosicao.tenantId, ctx.tenantId), eq(estoquePosicao.produtoId, id)))

      if (Number(saldo?.total || 0) > 0) {
        throw new HttpError(409, 'Produto possui saldo em estoque. Zere o saldo antes de excluir.')
      }

      await conn.db
        .update(produtos)
        .set({ ativo: 0, updatedAt: new Date() })
        .where(and(eq(produtos.id, id), eq(produtos.tenantId, ctx.tenantId)))

      return { success: true }
    }
  )

  // Taras
  app.get(
    '/api/cadastros/taras',
    {
      preHandler: requirePermission(
        ['taras', 'recebimento', 'retorno_producao', 'producao_saida', 'desmembramento', 'inventario_coletor', 'inventario_gestao'],
        { write: false }
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const apenasAtivas = (req.query as { ativo?: string }).ativo === 'true'
      const rows = await conn.db
        .select({
          id: taras.id,
          nome: taras.nome,
          peso_kg: taras.pesoKg,
          ativo: taras.ativo,
          padrao: taras.padrao,
          created_at: taras.createdAt,
          updated_at: taras.updatedAt,
        })
        .from(taras)
        .where(
          and(
            eq(taras.tenantId, ctx.tenantId),
            apenasAtivas ? eq(taras.ativo, 1) : sql`TRUE`,
          ),
        )
        .orderBy(desc(taras.padrao), desc(taras.pesoKg), asc(taras.nome))
      return {
        success: true,
        data: rows.map((r) => ({ ...r, peso_kg: Number(r.peso_kg || 0) })),
      }
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

  app.put('/api/cadastros/taras/:id', { preHandler: requirePermission('taras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = TaraSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    const padrao = d.padrao === true || Number(d.padrao) === 1 ? 1 : 0
    const ativo = d.ativo === undefined ? undefined : d.ativo === false || Number(d.ativo) === 0 ? 0 : 1

    await conn.db.transaction(async (tx) => {
      if (padrao === 1) {
        await tx.update(taras).set({ padrao: 0 }).where(eq(taras.tenantId, ctx.tenantId))
      }
      await tx
        .update(taras)
        .set({
          nome: d.nome,
          pesoKg: String(d.peso_kg),
          ativo,
          padrao,
          updatedAt: new Date(),
        })
        .where(and(eq(taras.id, id), eq(taras.tenantId, ctx.tenantId)))
    })
    return { success: true }
  })

  app.patch('/api/cadastros/taras/:id/ativo', { preHandler: requirePermission('taras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const [atual] = await conn.db
      .select({ ativo: taras.ativo })
      .from(taras)
      .where(and(eq(taras.id, id), eq(taras.tenantId, ctx.tenantId)))
      .limit(1)
    if (!atual) throw new HttpError(404, 'Tara não encontrada.')
    const novoAtivo = atual.ativo === 1 ? 0 : 1
    await conn.db
      .update(taras)
      .set({
        ativo: novoAtivo,
        padrao: novoAtivo === 0 ? 0 : undefined,
        updatedAt: new Date(),
      })
      .where(eq(taras.id, id))
    return { success: true, ativo: novoAtivo }
  })

  app.post('/api/cadastros/taras/:id/padrao', { preHandler: requirePermission('taras') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db.transaction(async (tx) => {
      await tx.update(taras).set({ padrao: 0 }).where(eq(taras.tenantId, ctx.tenantId))
      await tx
        .update(taras)
        .set({ padrao: 1, ativo: 1, updatedAt: new Date() })
        .where(and(eq(taras.id, id), eq(taras.tenantId, ctx.tenantId)))
    })
    return { success: true }
  })

  // Locais
  app.get(
    '/api/cadastros/locais',
    {
      preHandler: requirePermission(
        [
          'locais',
          'movimentacao',
          'recebimento',
          'consulta_endereco',
          'estoque_enderecos',
          'inventario_coletor',
          'inventario_gestao',
          'retorno_producao',
          'desmembramento',
        ],
        { write: false }
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: locais.id,
          filial_id: locais.filialId,
          endereco: locais.endereco,
          capacidade_max_caixas: locais.capacidadeMaxCaixas,
          ativo: locais.ativo,
          is_insumo: locais.isInsumo,
          tipo_armazenamento: locais.tipoArmazenamento,
        })
        .from(locais)
        .where(and(eq(locais.tenantId, ctx.tenantId), eq(locais.filialId, ctx.filialId), eq(locais.ativo, 1)))
        .orderBy(asc(locais.endereco))
      return {
        success: true,
        data: rows.map((r) => ({ ...r, capacidade_max_caixas: Number(r.capacidade_max_caixas || 0) })),
      }
    }
  )

  app.get(
    '/api/cadastros/locais/endereco/:endereco',
    {
      preHandler: requirePermission(
        [
          'locais',
          'movimentacao',
          'recebimento',
          'consulta_endereco',
          'estoque_enderecos',
          'inventario_coletor',
          'inventario_gestao',
          'retorno_producao',
          'desmembramento',
        ],
        { write: false }
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const end = String((req.params as { endereco: string }).endereco || '').trim().toUpperCase()
      const [row] = await conn.db
        .select({
          id: locais.id,
          filial_id: locais.filialId,
          endereco: locais.endereco,
          capacidade_max_caixas: locais.capacidadeMaxCaixas,
          ativo: locais.ativo,
          is_insumo: locais.isInsumo,
          tipo_armazenamento: locais.tipoArmazenamento,
        })
        .from(locais)
        .where(
          and(
            eq(locais.tenantId, ctx.tenantId),
            eq(locais.filialId, ctx.filialId),
            eq(locais.endereco, end),
            eq(locais.ativo, 1),
          ),
        )
        .limit(1)
      return {
        data: row ? { ...row, capacidade_max_caixas: Number(row.capacidade_max_caixas || 0) } : null,
      }
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

  app.put('/api/cadastros/locais/:id', { preHandler: requirePermission('locais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    const parsed = LocalSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados invalidos.')
    const d = parsed.data
    await conn.db
      .update(locais)
      .set({
        endereco: d.endereco.toUpperCase(),
        capacidadeMaxCaixas: String(d.capacidade_max_caixas),
        isInsumo: d.is_insumo === true || Number(d.is_insumo) === 1 ? 1 : 0,
        tipoArmazenamento: d.tipo_armazenamento,
      })
      .where(and(eq(locais.id, id), eq(locais.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.delete('/api/cadastros/locais/:id', { preHandler: requirePermission('locais') }, async (req) => {
    const ctx = req.authCtx!
    const id = String((req.params as { id: string }).id || '').trim()
    await conn.db
      .update(locais)
      .set({ ativo: 0 })
      .where(and(eq(locais.id, id), eq(locais.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // Cadastros Mestres Estruturantes (Empresas, Filiais/SIF, Clientes+Espec, Fornecedores, Vendedores, Transportadoras/Rotas, Auxiliares)
  registerCadastrosMestresRoutes(app, conn)

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
