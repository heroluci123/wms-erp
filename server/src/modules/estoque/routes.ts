import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  caixasHistorico,
  desmembramentosVinculos,
  estoqueCaixas,
  estoquePosicao,
  inventarios,
  locais,
  movimentacoesLog,
  ordensProducao,
  paletes,
  produtoArvore,
  produtos,
  produtosEans,
  taras,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  assertEnderecosNaoBloqueados,
  calcularPesoLiquido,
  gerarCodigoDocumento,
  gerarLotePorData,
  gerarProximosEansInternos,
  hojeIsoLocal,
  normalizarDataIso,
  normalizeCaixaRow,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  resolverTaraPeso,
  toDec,
  toNum,
  validarPesagemTaraPayload,
} from '../wms/helpers.js'

const PERM_EST_READ = [
  'consulta_estoque',
  'estoque_enderecos',
  'consulta_endereco',
  'recebimento',
  'recebimento_consultar',
  'movimentacao',
  'movimentacao_consultar',
  'desmembramento',
  'reimpressao',
  'rastreabilidade',
  'ean_etiquetas',
  'pedidos',
  'pedidos_consultar',
  'saida',
  'expedicao',
  'relatorios_estoque',
  'dashboard_executivo',
]

export function registerEstoqueRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── POSIÇÃO AGREGADA E CAIXAS SERIALIZADAS ──────────────────────────────────
  app.get(
    '/api/estoque/posicoes',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { incluirInsumos?: string; endereco?: string; produto_id?: string }
      const conds = [
        eq(estoquePosicao.tenantId, ctx.tenantId),
        eq(estoquePosicao.filialId, ctx.filialId),
        sql`(${estoquePosicao.qtdCaixas} > 0 OR ${estoquePosicao.qtdKg} > 0)`,
      ]
      if (q.endereco) {
        conds.push(eq(estoquePosicao.endereco, q.endereco.trim().toUpperCase()))
      }
      if (q.produto_id) {
        conds.push(eq(estoquePosicao.produtoId, parseUuidOrBadRequest(q.produto_id, 'produto_id')))
      }
      if (q.incluirInsumos === 'true') {
        conds.push(eq(produtos.tipoProduto, 'Insumos'))
      } else if (q.incluirInsumos !== 'all') {
        conds.push(sql`${produtos.tipoProduto} != 'Insumos'`)
      }

      const rows = await conn.db
        .select({
          id: estoquePosicao.id,
          produto_id: estoquePosicao.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          unidade: produtos.unidade,
          grupo: produtos.grupo,
          tipo_produto: produtos.tipoProduto,
          status_curva: produtos.statusCurva,
          endereco: estoquePosicao.endereco,
          lote: estoquePosicao.lote,
          validade: estoquePosicao.validade,
          qtd_caixas: estoquePosicao.qtdCaixas,
          qtd_kg: estoquePosicao.qtdKg,
          updated_at: estoquePosicao.updatedAt,
        })
        .from(estoquePosicao)
        .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
        .where(and(...conds))
        .orderBy(estoquePosicao.endereco, produtos.descricao, estoquePosicao.validade)

      return {
        data: rows.map((r) => ({
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: toNum(r.qtd_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/estoque/caixas',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const query = req.query as {
        status?: string
        endereco?: string
        produto_id?: string
        q?: string
        limit?: string
      }
      const limit = Math.min(2000, Math.max(1, Number(query.limit) || 500))
      const conds = [
        eq(estoqueCaixas.tenantId, ctx.tenantId),
        eq(estoqueCaixas.filialId, ctx.filialId),
      ]
      if (query.status && query.status !== 'TODOS') {
        conds.push(eq(estoqueCaixas.status, query.status.trim().toUpperCase()))
      } else if (!query.status) {
        conds.push(eq(estoqueCaixas.status, 'DISPONIVEL'))
      }
      if (query.endereco) {
        conds.push(eq(estoqueCaixas.endereco, query.endereco.trim().toUpperCase()))
      }
      if (query.produto_id) {
        conds.push(eq(estoqueCaixas.produtoId, parseUuidOrBadRequest(query.produto_id, 'produto_id')))
      }
      if (query.q && query.q.trim()) {
        const pattern = `%${query.q.trim().toUpperCase()}%`
        conds.push(
          sql`(UPPER(${estoqueCaixas.eanCaixa}) LIKE ${pattern} OR UPPER(${produtos.codigo}) LIKE ${pattern} OR UPPER(${produtos.descricao}) LIKE ${pattern} OR UPPER(${estoqueCaixas.lote}) LIKE ${pattern})`,
        )
      }

      const rows = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          grupo: produtos.grupo,
          tipo_produto: produtos.tipoProduto,
          palete_id: estoqueCaixas.paleteId,
          palete_codigo: paletes.codigo,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
          tara_id: estoqueCaixas.taraId,
          tara_kg: estoqueCaixas.taraKg,
          tara_nome: taras.nome,
          tara_primaria_total_kg: estoqueCaixas.taraPrimariaTotalKg,
          peso_kg: estoqueCaixas.pesoKg,
          qtd_pecas: estoqueCaixas.qtdPecas,
          custo_unitario_kg: estoqueCaixas.custoUnitarioKg,
          origem_tipo: estoqueCaixas.origemTipo,
          ean_origem: estoqueCaixas.eanOrigem,
          op_id: estoqueCaixas.opId,
          sif_origem: estoqueCaixas.sifOrigem,
          operador_cadastro_nome: estoqueCaixas.operadorCadastroNome,
          status: estoqueCaixas.status,
          pedido_reservado_id: estoqueCaixas.pedidoReservadoId,
          pedido_reservado_codigo: estoqueCaixas.pedidoReservadoCodigo,
          romaneio_reservado_id: estoqueCaixas.romaneioReservadoId,
          romaneio_reservado_codigo: estoqueCaixas.romaneioReservadoCodigo,
          cliente_reservado_nome: estoqueCaixas.clienteReservadoNome,
          created_at: estoqueCaixas.createdAt,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .leftJoin(paletes, eq(paletes.id, estoqueCaixas.paleteId))
        .leftJoin(taras, eq(taras.id, estoqueCaixas.taraId))
        .where(and(...conds))
        .orderBy(desc(estoqueCaixas.createdAt))
        .limit(limit)

      return { data: rows.map(normalizeCaixaRow) }
    },
  )

  app.get(
    '/api/estoque/caixas/recentes',
    {
      preHandler: requirePermission(
        ['reimpressao', 'desmembramento', 'retorno_producao', 'producao_saida', 'ean_etiquetas', 'rastreabilidade'],
        { write: false, bloquearCliente: true },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const query = req.query as { q?: string; limit?: string }
      const limit = Math.min(200, Math.max(1, Number(query.limit) || 40))
      const filtro = query.q?.trim() ? `%${query.q.trim().toUpperCase()}%` : null

      const rows = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
          tara_kg: estoqueCaixas.taraKg,
          tara_nome: taras.nome,
          peso_kg: estoqueCaixas.pesoKg,
          qtd_pecas: estoqueCaixas.qtdPecas,
          origem_tipo: estoqueCaixas.origemTipo,
          ean_origem: estoqueCaixas.eanOrigem,
          op_codigo: ordensProducao.codigo,
          status: estoqueCaixas.status,
          pedido_reservado_codigo: estoqueCaixas.pedidoReservadoCodigo,
          romaneio_reservado_codigo: estoqueCaixas.romaneioReservadoCodigo,
          cliente_reservado_nome: estoqueCaixas.clienteReservadoNome,
          created_at: estoqueCaixas.createdAt,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .leftJoin(taras, eq(taras.id, estoqueCaixas.taraId))
        .leftJoin(ordensProducao, eq(ordensProducao.id, estoqueCaixas.opId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            filtro
              ? sql`(UPPER(${estoqueCaixas.eanCaixa}) LIKE ${filtro} OR UPPER(${produtos.codigo}) LIKE ${filtro} OR UPPER(${produtos.descricao}) LIKE ${filtro} OR UPPER(${estoqueCaixas.lote}) LIKE ${filtro})`
              : sql`TRUE`,
          ),
        )
        .orderBy(desc(estoqueCaixas.createdAt))
        .limit(limit)

      return { data: rows.map(normalizeCaixaRow) }
    },
  )

  app.get(
    '/api/estoque/caixa/:ean',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const ean = String((req.params as { ean: string }).ean || '').trim()
      if (!ean) throw new HttpError(400, 'Informe o EAN da caixa.')

      const rows = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          produto_ean_padrao: produtos.ean,
          palete_id: estoqueCaixas.paleteId,
          palete_codigo: paletes.codigo,
          palete_endereco: paletes.enderecoAtual,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
          tara_id: estoqueCaixas.taraId,
          tara_kg: estoqueCaixas.taraKg,
          tara_nome: taras.nome,
          peso_kg: estoqueCaixas.pesoKg,
          qtd_pecas: estoqueCaixas.qtdPecas,
          origem_tipo: estoqueCaixas.origemTipo,
          ean_origem: estoqueCaixas.eanOrigem,
          op_id: estoqueCaixas.opId,
          op_codigo: ordensProducao.codigo,
          op_nome: ordensProducao.nome,
          status: estoqueCaixas.status,
          pedido_reservado_id: estoqueCaixas.pedidoReservadoId,
          pedido_reservado_codigo: estoqueCaixas.pedidoReservadoCodigo,
          romaneio_reservado_id: estoqueCaixas.romaneioReservadoId,
          romaneio_reservado_codigo: estoqueCaixas.romaneioReservadoCodigo,
          cliente_reservado_nome: estoqueCaixas.clienteReservadoNome,
          created_at: estoqueCaixas.createdAt,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .leftJoin(paletes, eq(paletes.id, estoqueCaixas.paleteId))
        .leftJoin(taras, eq(taras.id, estoqueCaixas.taraId))
        .leftJoin(ordensProducao, eq(ordensProducao.id, estoqueCaixas.opId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${ean}, '0')`,
          ),
        )
        .limit(1)

      if (rows.length === 0) {
        throw new HttpError(404, `Nenhuma caixa encontrada para o EAN "${ean}".`)
      }
      return { data: normalizeCaixaRow(rows[0]) }
    },
  )

  app.get(
    '/api/estoque/endereco/:endereco',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const endereco = String((req.params as { endereco: string }).endereco || '')
        .trim()
        .toUpperCase()
      if (!endereco) throw new HttpError(400, 'Endereço obrigatório.')

      const rows = await conn.db
        .select({
          id: estoquePosicao.id,
          produto_id: estoquePosicao.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          status_curva: produtos.statusCurva,
          grupo: produtos.grupo,
          lote: estoquePosicao.lote,
          validade: estoquePosicao.validade,
          qtd_caixas: estoquePosicao.qtdCaixas,
          qtd_kg: estoquePosicao.qtdKg,
        })
        .from(estoquePosicao)
        .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
        .where(
          and(
            eq(estoquePosicao.tenantId, ctx.tenantId),
            eq(estoquePosicao.filialId, ctx.filialId),
            eq(estoquePosicao.endereco, endereco),
            sql`(${estoquePosicao.qtdCaixas} > 0 OR ${estoquePosicao.qtdKg} > 0)`,
          ),
        )
        .orderBy(estoquePosicao.validade)

      return {
        data: rows.map((r) => ({
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: toNum(r.qtd_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/estoque/putaway/:produtoId',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const produtoId = parseUuidOrBadRequest((req.params as { produtoId: string }).produtoId, 'produtoId')
      const lote = String((req.query as { lote?: string }).lote || '').trim()

      const rows = await conn.db
        .select({
          endereco: estoquePosicao.endereco,
          lote: estoquePosicao.lote,
          validade: estoquePosicao.validade,
          qtd_caixas: estoquePosicao.qtdCaixas,
          qtd_kg: estoquePosicao.qtdKg,
        })
        .from(estoquePosicao)
        .where(
          and(
            eq(estoquePosicao.tenantId, ctx.tenantId),
            eq(estoquePosicao.filialId, ctx.filialId),
            eq(estoquePosicao.produtoId, produtoId),
            sql`${estoquePosicao.endereco} NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')`,
            sql`(${estoquePosicao.qtdCaixas} > 0 OR ${estoquePosicao.qtdKg} > 0)`,
          ),
        )
        .orderBy(
          sql`CASE WHEN ${estoquePosicao.lote} = ${lote} THEN 0 ELSE 1 END`,
          desc(estoquePosicao.qtdCaixas),
        )

      return {
        data: rows.map((r) => ({
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: toNum(r.qtd_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/estoque/fefo',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { produto_id?: string; validade?: string }
      const produtoId = parseUuidOrBadRequest(q.produto_id, 'produto_id')
      const validade = normalizarDataIso(q.validade)
      if (!validade) return { data: [] }

      const rows = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          validade: estoqueCaixas.validade,
          peso_kg: estoqueCaixas.pesoKg,
          produto_descricao: produtos.descricao,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            eq(estoqueCaixas.produtoId, produtoId),
            eq(estoqueCaixas.status, 'DISPONIVEL'),
            sql`${estoqueCaixas.validade} IS NOT NULL AND ${estoqueCaixas.validade} < ${validade}`,
          ),
        )
        .orderBy(estoqueCaixas.validade)
        .limit(10)

      return { data: rows.map((r) => ({ ...r, peso_kg: toNum(r.peso_kg, 0) })) }
    },
  )

  app.get(
    '/api/estoque/expedicao',
    { preHandler: requirePermission(PERM_EST_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: estoquePosicao.id,
          produto_id: estoquePosicao.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          status_curva: produtos.statusCurva,
          grupo: produtos.grupo,
          lote: estoquePosicao.lote,
          validade: estoquePosicao.validade,
          qtd_caixas: estoquePosicao.qtdCaixas,
          qtd_kg: estoquePosicao.qtdKg,
          updated_at: estoquePosicao.updatedAt,
        })
        .from(estoquePosicao)
        .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
        .where(
          and(
            eq(estoquePosicao.tenantId, ctx.tenantId),
            eq(estoquePosicao.filialId, ctx.filialId),
            eq(estoquePosicao.endereco, 'EXPEDICAO'),
            sql`(${estoquePosicao.qtdCaixas} > 0 OR ${estoquePosicao.qtdKg} > 0)`,
          ),
        )
        .orderBy(desc(estoquePosicao.updatedAt))

      return {
        data: rows.map((r) => ({
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: toNum(r.qtd_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/estoque/kpis',
    {
      preHandler: requirePermission(
        ['dashboard_executivo', 'consulta_estoque', 'relatorios_estoque', 'estoque_enderecos'],
        { write: false, bloquearCliente: true },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const incluirInsumos = (req.query as { incluirInsumos?: string }).incluirInsumos === 'true'
      const dataHoje = hojeIsoLocal()
      const dtLimit = new Date(dataHoje)
      dtLimit.setDate(dtLimit.getDate() + 30)
      const dataLimite = dtLimit.toISOString().slice(0, 10)
      const prodFilter = incluirInsumos
        ? eq(produtos.tipoProduto, 'Insumos')
        : sql`${produtos.tipoProduto} != 'Insumos'`
      const saldoPos = sql`(${estoquePosicao.qtdCaixas} > 0 OR ${estoquePosicao.qtdKg} > 0)`

      const [skusRes, recRes, expRes, invRes, vencRes, vencidosRes] = await Promise.all([
        conn.db
          .select({ v: sql<number>`COUNT(DISTINCT ${estoquePosicao.produtoId})::int` })
          .from(estoquePosicao)
          .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
          .where(and(eq(estoquePosicao.tenantId, ctx.tenantId), eq(estoquePosicao.filialId, ctx.filialId), saldoPos, prodFilter)),
        conn.db
          .select({ v: sql<number>`COUNT(*)::int` })
          .from(estoquePosicao)
          .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
          .where(and(eq(estoquePosicao.tenantId, ctx.tenantId), eq(estoquePosicao.filialId, ctx.filialId), eq(estoquePosicao.endereco, 'REC'), saldoPos, prodFilter)),
        conn.db
          .select({ v: sql<number>`COUNT(*)::int` })
          .from(estoquePosicao)
          .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
          .where(and(eq(estoquePosicao.tenantId, ctx.tenantId), eq(estoquePosicao.filialId, ctx.filialId), eq(estoquePosicao.endereco, 'EXPEDICAO'), saldoPos, prodFilter)),
        conn.db
          .select({ v: sql<number>`COUNT(*)::int` })
          .from(inventarios)
          .where(and(eq(inventarios.tenantId, ctx.tenantId), eq(inventarios.filialId, ctx.filialId), sql`${inventarios.status} NOT IN ('Finalizado OK', 'Cancelado')`)),
        conn.db
          .select({ v: sql<number>`COUNT(*)::int` })
          .from(estoquePosicao)
          .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
          .where(and(eq(estoquePosicao.tenantId, ctx.tenantId), eq(estoquePosicao.filialId, ctx.filialId), saldoPos, prodFilter, sql`${estoquePosicao.validade} >= ${dataHoje} AND ${estoquePosicao.validade} <= ${dataLimite}`)),
        conn.db
          .select({ v: sql<number>`COUNT(*)::int` })
          .from(estoquePosicao)
          .innerJoin(produtos, eq(produtos.id, estoquePosicao.produtoId))
          .where(and(eq(estoquePosicao.tenantId, ctx.tenantId), eq(estoquePosicao.filialId, ctx.filialId), saldoPos, prodFilter, sql`${estoquePosicao.validade} < ${dataHoje}`)),
      ])

      return {
        totalSKUs: Number(skusRes[0]?.v || 0),
        itensREC: Number(recRes[0]?.v || 0),
        itensExpedicao: Number(expRes[0]?.v || 0),
        inventariosAbertos: Number(invRes[0]?.v || 0),
        vencendoBreve: Number(vencRes[0]?.v || 0),
        vencidos: Number(vencidosRes[0]?.v || 0),
      }
    },
  )

  app.get(
    '/api/estoque/minimo',
    {
      preHandler: requirePermission(['consulta_estoque', 'dashboard_executivo', 'relatorios_estoque'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as {
        diasAnalise?: string
        leadTimePadrao?: string
        margemSegurancaPct?: string
      }
      const diasAnalise = Math.max(1, Math.min(365, parseInt(q.diasAnalise || '30', 10) || 30))
      const leadTimePadrao = Math.max(0.5, toNum(q.leadTimePadrao, 2))
      const margemSegurancaPct = Math.max(0, toNum(q.margemSegurancaPct, 20))
      const dataLimite = new Date(Date.now() - diasAnalise * 86400 * 1000)

      const allProds = await conn.db
        .select({
          id: produtos.id,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          tipo_produto: produtos.tipoProduto,
          classificacao: produtos.classificacao,
          grupo: produtos.grupo,
          produto_pai_id: produtos.produtoPaiId,
        })
        .from(produtos)
        .where(and(eq(produtos.tenantId, ctx.tenantId), sql`${produtos.codigo} != 'VAZIO'`))

      const arvoreRows = await conn.db
        .select({ paiId: produtoArvore.paiId, filhoId: produtoArvore.filhoId })
        .from(produtoArvore)
        .where(eq(produtoArvore.tenantId, ctx.tenantId))

      const paiMap = new Map<string, string>()
      for (const p of allProds) {
        if (p.produto_pai_id) paiMap.set(p.id, p.produto_pai_id)
      }
      for (const a of arvoreRows) {
        if (!paiMap.has(a.filhoId)) paiMap.set(a.filhoId, a.paiId)
      }
      const encontrarPaiId = (pid: string): string => {
        let cur = pid
        const seen = new Set<string>()
        while (paiMap.has(cur) && !seen.has(cur)) {
          seen.add(cur)
          cur = paiMap.get(cur)!
        }
        return cur
      }

      const [caixasDisp, consumoRes] = await Promise.all([
        conn.db
          .select({
            produtoId: estoqueCaixas.produtoId,
            pesoKg: sql<string>`COALESCE(SUM(${estoqueCaixas.pesoKg}), 0)`,
            qtd: sql<number>`COUNT(*)::int`,
          })
          .from(estoqueCaixas)
          .where(
            and(
              eq(estoqueCaixas.tenantId, ctx.tenantId),
              eq(estoqueCaixas.filialId, ctx.filialId),
              eq(estoqueCaixas.status, 'DISPONIVEL'),
              sql`COALESCE(${estoqueCaixas.endereco}, '') NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO', 'PRODUCAO')`,
            ),
          )
          .groupBy(estoqueCaixas.produtoId),
        conn.db
          .select({
            produtoId: movimentacoesLog.produtoId,
            tipo: movimentacoesLog.tipo,
            totalKg: sql<string>`COALESCE(SUM(${movimentacoesLog.qtdKg}), 0)`,
          })
          .from(movimentacoesLog)
          .where(
            and(
              eq(movimentacoesLog.tenantId, ctx.tenantId),
              eq(movimentacoesLog.filialId, ctx.filialId),
              sql`${movimentacoesLog.tipo} IN ('EXPEDICAO', 'SAIDA') AND ${movimentacoesLog.dataHora} >= ${dataLimite}`,
            ),
          )
          .groupBy(movimentacoesLog.produtoId, movimentacoesLog.tipo),
      ])

      const paisRecord = new Map<
        string,
        {
          id: string
          codigo: string | null
          descricao: string
          grupo: string | null
          estoque_caixas: number
          estoque_kg: number
          consumo_total_kg: number
        }
      >()
      for (const p of allProds) {
        if (p.tipo_produto === 'Materia Prima' || p.classificacao === 'MATERIA_PRIMA') {
          paisRecord.set(p.id, {
            id: p.id,
            codigo: p.codigo,
            descricao: p.descricao,
            grupo: p.grupo,
            estoque_caixas: 0,
            estoque_kg: 0,
            consumo_total_kg: 0,
          })
        }
      }
      for (const cx of caixasDisp) {
        const entry = paisRecord.get(cx.produtoId)
        if (entry) {
          entry.estoque_caixas += Number(cx.qtd || 0)
          entry.estoque_kg += toNum(cx.pesoKg, 0)
        }
      }
      for (const c of consumoRes) {
        if (!c.produtoId) continue
        const paiId = encontrarPaiId(c.produtoId)
        const entry = paisRecord.get(paiId)
        if (entry) entry.consumo_total_kg += toNum(c.totalKg, 0)
      }

      const itens = Array.from(paisRecord.values()).map((p) => {
        const consumoDiario = p.consumo_total_kg / diasAnalise
        const estoqueMinimo = consumoDiario * leadTimePadrao * (1 + margemSegurancaPct / 100)
        const diasCobertura =
          consumoDiario > 0 ? p.estoque_kg / consumoDiario : p.estoque_kg > 0 ? 999 : 0
        const sugestaoCompra = Math.max(0, estoqueMinimo - p.estoque_kg)
        const status =
          p.estoque_kg < estoqueMinimo
            ? 'CRITICO'
            : p.estoque_kg < estoqueMinimo * 1.25
              ? 'ALERTA'
              : 'OK'
        return {
          ...p,
          consumo_diario_kg: Math.round(consumoDiario * 100) / 100,
          estoque_minimo_kg: Math.round(estoqueMinimo * 100) / 100,
          dias_cobertura: Math.round(diasCobertura * 10) / 10,
          sugestao_compra_kg: Math.round(sugestaoCompra * 100) / 100,
          status,
        }
      })

      const ordem: Record<string, number> = { CRITICO: 0, ALERTA: 1, OK: 2 }
      itens.sort((a, b) =>
        ordem[a.status] !== ordem[b.status]
          ? ordem[a.status] - ordem[b.status]
          : b.consumo_diario_kg - a.consumo_diario_kg,
      )

      return {
        kpis: {
          totalCriticos: itens.filter((i) => i.status === 'CRITICO').length,
          totalAlertas: itens.filter((i) => i.status === 'ALERTA').length,
          totalOk: itens.filter((i) => i.status === 'OK').length,
          totalSugestaoCompraKg:
            Math.round(itens.reduce((acc, i) => acc + i.sugestao_compra_kg, 0) * 100) / 100,
          totalMateriasPrimas: itens.length,
        },
        parametros: { diasAnalise, leadTimePadrao, margemSegurancaPct },
        itens,
      }
    },
  )

  app.post(
    '/api/estoque/carga-inicial',
    { preHandler: requirePermission(['inventario_carga_inicial', 'estoque_enderecos']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = req.body as {
        caixas?: Array<{
          ean_caixa: string
          produto_id: string
          endereco: string
          data_producao?: string
          lote?: string
          validade?: string
          peso_bruto_kg?: number
          peso_kg: number
          tara_id?: string
          tara_kg?: number
          qtd_pecas?: number
        }>
      }
      if (!Array.isArray(body.caixas) || body.caixas.length === 0) {
        throw new HttpError(400, 'Informe ao menos uma caixa para carga inicial.')
      }

      const enderecosAfetados = new Set<string>()
      let inseridas = 0
      let atualizadas = 0

      await conn.db.transaction(async (tx) => {
        for (const c of body.caixas!) {
          const ean = String(c.ean_caixa || '').trim()
          const end = String(c.endereco || 'DOCA').trim().toUpperCase()
          const prodId = parseUuidOrBadRequest(c.produto_id, 'produto_id')
          if (!ean) throw new HttpError(400, 'EAN da caixa é obrigatório na carga inicial.')

          enderecosAfetados.add(end)
          const dataProdIso = normalizarDataIso(c.data_producao)
          const validadeIso = normalizarDataIso(c.validade)
          const lote = String(c.lote || (dataProdIso ? gerarLotePorData(dataProdIso) : '')).trim()
          const { taraId, taraKg } = await resolverTaraPeso(tx, ctx.tenantId, c.tara_id, c.tara_kg)
          const pesoLiq = Number(toNum(c.peso_kg, 0).toFixed(3))
          const pesoBruto =
            c.peso_bruto_kg != null ? Number(toNum(c.peso_bruto_kg, 0).toFixed(3)) : Number((pesoLiq + taraKg).toFixed(3))
          const pecas = c.qtd_pecas != null && toNum(c.qtd_pecas) > 0 ? Math.trunc(toNum(c.qtd_pecas)) : null

          const existe = await tx
            .select({ id: estoqueCaixas.id, endereco: estoqueCaixas.endereco })
            .from(estoqueCaixas)
            .where(and(eq(estoqueCaixas.tenantId, ctx.tenantId), eq(estoqueCaixas.eanCaixa, ean)))
            .limit(1)

          if (existe.length === 0) {
            const caixaId = uuidv7()
            await tx.insert(estoqueCaixas).values({
              id: caixaId,
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              eanCaixa: ean,
              produtoId: prodId,
              endereco: end,
              lote,
              dataProducao: dataProdIso,
              validade: validadeIso,
              pesoBrutoKg: toDec(pesoBruto, 3),
              taraId,
              taraKg: toDec(taraKg, 3),
              pesoKg: toDec(pesoLiq, 3),
              qtdPecas: pecas,
              origemTipo: 'INVENTARIO',
              operadorCadastroNome: ctx.operador.nome,
              status: 'DISPONIVEL',
            })
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId,
              eanCaixa: ean,
              operacao: 'RECEBIMENTO_INVENTARIO',
              detalhes: `Carga Inicial em ${end} • Lote ${lote || '-'} • Líq ${pesoLiq.toFixed(2)}kg`,
              operadorNome: ctx.operador.nome,
            })
            inseridas++
          } else {
            if (existe[0].endereco) enderecosAfetados.add(existe[0].endereco)
            await tx
              .update(estoqueCaixas)
              .set({
                endereco: end,
                lote: lote || undefined,
                dataProducao: dataProdIso,
                validade: validadeIso,
                pesoBrutoKg: toDec(pesoBruto, 3),
                taraId,
                taraKg: toDec(taraKg, 3),
                pesoKg: toDec(pesoLiq, 3),
                qtdPecas: pecas,
                status: 'DISPONIVEL',
                updatedAt: new Date(),
              })
              .where(eq(estoqueCaixas.id, existe[0].id))
            atualizadas++
          }
        }
        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...enderecosAfetados])
      })

      return { success: true, inseridas, atualizadas }
    },
  )

  // ── PALETES & RECEBIMENTO ──────────────────────────────────────────────────
  app.get(
    '/api/paletes',
    {
      preHandler: requirePermission(['recebimento', 'recebimento_consultar', 'movimentacao', 'movimentacao_consultar'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { status?: string; dataInicio?: string; dataFim?: string }
      const conds = [eq(paletes.tenantId, ctx.tenantId), eq(paletes.filialId, ctx.filialId)]
      if (q.status && q.status !== 'TODOS') {
        conds.push(eq(paletes.status, q.status.trim().toUpperCase()))
      }
      if (q.dataInicio) conds.push(sql`DATE(${paletes.createdAt}) >= ${q.dataInicio}`)
      if (q.dataFim) conds.push(sql`DATE(${paletes.createdAt}) <= ${q.dataFim}`)

      const rows = await conn.db
        .select({
          id: paletes.id,
          codigo: paletes.codigo,
          endereco_atual: paletes.enderecoAtual,
          status: paletes.status,
          ultimo_operador: paletes.ultimoOperador,
          created_at: paletes.createdAt,
          qtd_caixas: sql<number>`COUNT(${estoqueCaixas.id})::int`,
          peso_total: sql<string>`COALESCE(SUM(${estoqueCaixas.pesoKg}), 0)`,
        })
        .from(paletes)
        .leftJoin(
          estoqueCaixas,
          and(eq(estoqueCaixas.paleteId, paletes.id), eq(estoqueCaixas.status, 'DISPONIVEL')),
        )
        .where(and(...conds))
        .groupBy(paletes.id)
        .orderBy(desc(paletes.createdAt))
        .limit(200)

      return {
        data: rows.map((r) => ({ ...r, peso_total: toNum(r.peso_total, 0) })),
      }
    },
  )

  app.post('/api/paletes', { preHandler: requirePermission('recebimento') }, async (req, reply) => {
    const ctx = req.authCtx!
    const created = await conn.db.transaction(async (tx) => {
      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PALETE', 'PLT', 4)
      const id = uuidv7()
      const [row] = await tx
        .insert(paletes)
        .values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          enderecoAtual: 'REC',
          status: 'EM_MONTAGEM',
          ultimoOperador: ctx.operador.nome,
        })
        .returning()
      return row
    })
    return reply.code(201).send({
      success: true,
      palete: {
        id: created.id,
        codigo: created.codigo,
        endereco_atual: created.enderecoAtual,
        status: created.status,
      },
    })
  })

  app.get(
    '/api/paletes/:id/caixas',
    {
      preHandler: requirePermission(['recebimento', 'recebimento_consultar', 'movimentacao', 'movimentacao_consultar'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const paleteId = parseUuidOrBadRequest((req.params as { id: string }).id, 'palete_id')
      const todas = (req.query as { todas?: string }).todas === 'true'

      const rows = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
          tara_kg: estoqueCaixas.taraKg,
          peso_kg: estoqueCaixas.pesoKg,
          qtd_pecas: estoqueCaixas.qtdPecas,
          status: estoqueCaixas.status,
          created_at: estoqueCaixas.createdAt,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.paleteId, paleteId),
            todas ? sql`TRUE` : eq(estoqueCaixas.status, 'DISPONIVEL'),
          ),
        )
        .orderBy(desc(estoqueCaixas.createdAt))

      return { data: rows.map(normalizeCaixaRow) }
    },
  )

  app.post('/api/paletes/:id/concluir', { preHandler: requirePermission('recebimento') }, async (req) => {
    const ctx = req.authCtx!
    const paleteId = parseUuidOrBadRequest((req.params as { id: string }).id, 'palete_id')

    await conn.db.transaction(async (tx) => {
      const [pal] = await tx
        .select()
        .from(paletes)
        .where(and(eq(paletes.id, paleteId), eq(paletes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pal) throw new HttpError(404, 'Palete não encontrado.')

      const cnt = await tx
        .select({ v: sql<number>`COUNT(*)::int` })
        .from(estoqueCaixas)
        .where(and(eq(estoqueCaixas.paleteId, paleteId), eq(estoqueCaixas.status, 'DISPONIVEL')))
      if (Number(cnt[0]?.v || 0) === 0) {
        throw new HttpError(400, 'Não é possível finalizar um palete vazio. Adicione caixas primeiro.')
      }

      await tx
        .update(paletes)
        .set({ status: 'FECHADO', enderecoAtual: 'DOCA', ultimoOperador: ctx.operador.nome })
        .where(eq(paletes.id, paleteId))

      await tx
        .update(estoqueCaixas)
        .set({ endereco: 'DOCA', updatedAt: new Date() })
        .where(
          and(
            eq(estoqueCaixas.paleteId, paleteId),
            sql`(${estoqueCaixas.endereco} IS NULL OR ${estoqueCaixas.endereco} = 'REC')`,
          ),
        )

      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [pal.enderecoAtual, 'REC', 'DOCA'])
    })

    return { success: true }
  })

  app.post('/api/paletes/:id/reabrir', { preHandler: requirePermission('recebimento') }, async (req) => {
    const ctx = req.authCtx!
    const paleteId = parseUuidOrBadRequest((req.params as { id: string }).id, 'palete_id')
    await conn.db
      .update(paletes)
      .set({ status: 'EM_MONTAGEM', enderecoAtual: 'REC' })
      .where(and(eq(paletes.id, paleteId), eq(paletes.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.post('/api/recebimento/caixa', { preHandler: requirePermission('recebimento') }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = req.body as {
      palete_id?: string | null
      ean_caixa: string
      produto_id: string
      endereco?: string
      data_producao?: string
      validade?: string
      lote?: string
      peso_bruto_kg?: number
      peso_kg?: number
      tara_id?: string | null
      tara_kg?: number
      tara_primaria_total_kg?: number
      qtd_pecas?: number | null
      sif_origem?: string
      fornecedor_id?: string | null
      custo_unitario_kg?: number
      exigir_qtd_pecas?: boolean
    }

    const ean = String(body.ean_caixa || '').trim()
    if (!ean) throw new HttpError(400, 'Informe ou bipe o EAN da caixa.')
    const produtoId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
    const enderecoFinal = String(body.endereco || 'REC').trim().toUpperCase() || 'REC'

    const criado = await conn.db.transaction(async (tx) => {
      await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [enderecoFinal])

      const [dup] = await tx
        .select({ id: estoqueCaixas.id })
        .from(estoqueCaixas)
        .where(and(eq(estoqueCaixas.tenantId, ctx.tenantId), eq(estoqueCaixas.eanCaixa, ean)))
        .limit(1)
      if (dup) {
        throw new HttpError(409, `A caixa com EAN "${ean}" já está registrada no sistema!`)
      }

      const [prod] = await tx
        .select({ id: produtos.id, codigo: produtos.codigo, descricao: produtos.descricao })
        .from(produtos)
        .where(and(eq(produtos.id, produtoId), eq(produtos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!prod) throw new HttpError(404, 'Produto não encontrado.')

      let paleteIdFinal: string | null = null
      let endEfetivo = enderecoFinal
      if (body.palete_id) {
        paleteIdFinal = parseUuidOrBadRequest(body.palete_id, 'palete_id')
        const [pal] = await tx
          .select({ id: paletes.id, enderecoAtual: paletes.enderecoAtual })
          .from(paletes)
          .where(and(eq(paletes.id, paleteIdFinal), eq(paletes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!pal) throw new HttpError(404, 'Palete selecionado não encontrado.')
        if (!body.endereco) endEfetivo = pal.enderecoAtual || 'REC'
      }

      const { taraId, taraKg } = await resolverTaraPeso(tx, ctx.tenantId, body.tara_id, body.tara_kg)
      const taraPrimTotal = Math.max(0, toNum(body.tara_primaria_total_kg, 0))

      let pesagem
      if (body.peso_bruto_kg != null && body.data_producao && body.validade) {
        pesagem = validarPesagemTaraPayload({
          data_producao: body.data_producao,
          validade: body.validade,
          peso_bruto_kg: body.peso_bruto_kg,
          tara_id: taraId,
          tara_kg: taraKg + taraPrimTotal,
          qtd_pecas: body.qtd_pecas,
          exigirQtdPecas: body.exigir_qtd_pecas ?? body.qtd_pecas != null,
          exigirTara: false,
        })
      } else {
        const pesoLiq =
          body.peso_kg != null
            ? Number(toNum(body.peso_kg, NaN).toFixed(3))
            : calcularPesoLiquido(body.peso_bruto_kg, taraKg + taraPrimTotal)
        if (!Number.isFinite(pesoLiq) || pesoLiq <= 0) {
          throw new HttpError(400, 'Peso líquido da caixa deve ser maior que zero.')
        }
        const bruto =
          body.peso_bruto_kg != null
            ? Number(toNum(body.peso_bruto_kg, 0).toFixed(3))
            : Number((pesoLiq + taraKg + taraPrimTotal).toFixed(3))
        const dpIso = normalizarDataIso(body.data_producao)
        const valIso = normalizarDataIso(body.validade)
        pesagem = {
          dataProducao: dpIso,
          validade: valIso,
          lote: String(body.lote || (dpIso ? gerarLotePorData(dpIso) : '')).trim(),
          taraId,
          taraKg,
          pesoBrutoKg: bruto,
          pesoLiquidoKg: pesoLiq,
          qtdPecas: body.qtd_pecas != null && toNum(body.qtd_pecas) > 0 ? Math.trunc(toNum(body.qtd_pecas)) : null,
        }
      }

      const caixaId = uuidv7()
      await tx.insert(estoqueCaixas).values({
        id: caixaId,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        eanCaixa: ean,
        produtoId: prod.id,
        paleteId: paleteIdFinal,
        paleteOrigemId: paleteIdFinal,
        fornecedorId: body.fornecedor_id ? parseUuidOrBadRequest(body.fornecedor_id, 'fornecedor_id') : null,
        sifOrigem: String(body.sif_origem || '').trim(),
        endereco: endEfetivo,
        lote: pesagem.lote,
        dataProducao: pesagem.dataProducao,
        validade: pesagem.validade,
        pesoBrutoKg: toDec(pesagem.pesoBrutoKg, 3),
        taraId: pesagem.taraId,
        taraKg: toDec(taraKg, 3),
        taraPrimariaTotalKg: toDec(taraPrimTotal, 3),
        pesoKg: toDec(pesagem.pesoLiquidoKg, 3),
        qtdPecas: pesagem.qtdPecas,
        custoUnitarioKg: toDec(toNum(body.custo_unitario_kg, 0), 4),
        origemTipo: 'RECEBIMENTO',
        operadorCadastroNome: ctx.operador.nome,
        status: 'DISPONIVEL',
      })

      if (paleteIdFinal) {
        await tx
          .update(paletes)
          .set({ ultimoOperador: ctx.operador.nome })
          .where(eq(paletes.id, paleteIdFinal))
      }

      await registrarHistoricoCaixa(tx, {
        tenantId: ctx.tenantId,
        caixaId,
        eanCaixa: ean,
        operacao: 'RECEBIMENTO',
        detalhes: `Recebida em ${endEfetivo} • Lote ${pesagem.lote || '-'} • ${pesagem.qtdPecas ? `${pesagem.qtdPecas} pç • ` : ''}Bruto ${pesagem.pesoBrutoKg.toFixed(2)}kg | Tara ${(taraKg + taraPrimTotal).toFixed(3)}kg | Líq ${pesagem.pesoLiquidoKg.toFixed(2)}kg`,
        operadorNome: ctx.operador.nome,
      })

      await registrarMovimentacaoLog(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        produtoId: prod.id,
        enderecoOrigem: 'EXTERNO',
        enderecoDestino: endEfetivo,
        lote: pesagem.lote,
        qtdCaixas: 1,
        qtdKg: pesagem.pesoLiquidoKg,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
        tipo: 'ENTRADA',
      })

      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [endEfetivo])

      return {
        id: caixaId,
        ean_caixa: ean,
        produto_id: prod.id,
        produto_codigo: prod.codigo,
        produto_descricao: prod.descricao,
        palete_id: paleteIdFinal,
        endereco: endEfetivo,
        lote: pesagem.lote,
        data_producao: pesagem.dataProducao,
        validade: pesagem.validade,
        peso_bruto_kg: pesagem.pesoBrutoKg,
        tara_kg: taraKg,
        peso_kg: pesagem.pesoLiquidoKg,
        qtd_pecas: pesagem.qtdPecas,
        status: 'DISPONIVEL',
      }
    })

    return reply.code(201).send({ success: true, caixa: criado })
  })

  app.delete('/api/recebimento/caixa/:id', { preHandler: requirePermission('recebimento') }, async (req) => {
    const ctx = req.authCtx!
    const caixaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'caixa_id')

    await conn.db.transaction(async (tx) => {
      const lockRes = await tx.execute(sql`
        SELECT id, ean_caixa, endereco, status, produto_id, peso_kg, lote
        FROM estoque_caixas
        WHERE id = ${caixaId} AND tenant_id = ${ctx.tenantId}
        FOR UPDATE
      `)
      const caixa = lockRes.rows[0] as
        | {
            id: string
            ean_caixa: string
            endereco: string | null
            status: string
            produto_id: string
            peso_kg: string
            lote: string
          }
        | undefined
      if (!caixa) throw new HttpError(404, 'Caixa não encontrada.')
      if (caixa.status !== 'DISPONIVEL') {
        throw new HttpError(409, `Não é possível estornar caixa com status ${caixa.status}.`)
      }

      await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [caixa.endereco])

      await tx
        .update(caixasHistorico)
        .set({ caixaId: null })
        .where(eq(caixasHistorico.caixaId, caixa.id))

      await registrarHistoricoCaixa(tx, {
        tenantId: ctx.tenantId,
        caixaId: null,
        eanCaixa: caixa.ean_caixa,
        operacao: 'ESTORNO_RECEBIMENTO',
        detalhes: `Caixa removida do recebimento em ${caixa.endereco || 'REC'}`,
        operadorNome: ctx.operador.nome,
      })

      await tx.delete(estoqueCaixas).where(eq(estoqueCaixas.id, caixa.id))
      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [caixa.endereco])
    })

    return { success: true }
  })

  // ── MOVIMENTAÇÃO & RASTREABILIDADE ─────────────────────────────────────────
  app.get(
    '/api/movimentacao/identificar/:codigo',
    {
      preHandler: requirePermission(
        ['movimentacao', 'movimentacao_consultar', 'consulta_endereco', 'consulta_estoque', 'inventario_coletor'],
        { write: false, bloquearCliente: true },
      ),
    },
    async (req) => {
      const ctx = req.authCtx!
      const codigo = String((req.params as { codigo: string }).codigo || '').trim()
      if (!codigo) return { tipo: 'DESCONHECIDO', dados: null }

      if (codigo.toUpperCase().startsWith('PLT-')) {
        const [pal] = await conn.db
          .select()
          .from(paletes)
          .where(
            and(
              eq(paletes.tenantId, ctx.tenantId),
              eq(paletes.filialId, ctx.filialId),
              sql`UPPER(${paletes.codigo}) = ${codigo.toUpperCase()}`,
            ),
          )
          .limit(1)
        if (pal) {
          const caixas = await conn.db
            .select({
              id: estoqueCaixas.id,
              ean_caixa: estoqueCaixas.eanCaixa,
              produto_id: estoqueCaixas.produtoId,
              peso_kg: estoqueCaixas.pesoKg,
              validade: estoqueCaixas.validade,
              lote: estoqueCaixas.lote,
              produto_descricao: produtos.descricao,
            })
            .from(estoqueCaixas)
            .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
            .where(and(eq(estoqueCaixas.paleteId, pal.id), eq(estoqueCaixas.status, 'DISPONIVEL')))
          const caixasNorm = caixas.map((c) => ({ ...c, peso_kg: toNum(c.peso_kg, 0) }))
          return {
            tipo: 'PALETE',
            dados: {
              id: pal.id,
              codigo: pal.codigo,
              endereco_atual: pal.enderecoAtual,
              status: pal.status,
              caixas: caixasNorm,
              peso_total: caixasNorm.reduce((acc, c) => acc + c.peso_kg, 0),
            },
          }
        }
      }

      const [caixa] = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          palete_id: estoqueCaixas.paleteId,
          palete_codigo: paletes.codigo,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          validade: estoqueCaixas.validade,
          peso_kg: estoqueCaixas.pesoKg,
          status: estoqueCaixas.status,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .leftJoin(paletes, eq(paletes.id, estoqueCaixas.paleteId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            eq(estoqueCaixas.status, 'DISPONIVEL'),
            sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${codigo}, '0')`,
          ),
        )
        .limit(1)
      if (caixa) {
        return { tipo: 'CAIXA', dados: { ...caixa, peso_kg: toNum(caixa.peso_kg, 0) } }
      }

      const [loc] = await conn.db
        .select()
        .from(locais)
        .where(
          and(
            eq(locais.tenantId, ctx.tenantId),
            eq(locais.filialId, ctx.filialId),
            eq(locais.endereco, codigo.toUpperCase()),
          ),
        )
        .limit(1)
      if (loc) {
        return { tipo: 'ENDERECO', dados: loc }
      }

      return { tipo: 'DESCONHECIDO', dados: null }
    },
  )

  app.post('/api/movimentacao/palete', { preHandler: requirePermission('movimentacao') }, async (req) => {
    const ctx = req.authCtx!
    const body = req.body as { palete_id: string; destino: string }
    const paleteId = parseUuidOrBadRequest(body.palete_id, 'palete_id')
    const destino = String(body.destino || '').trim().toUpperCase()
    if (!destino || destino === 'REC' || destino === 'EXPEDICAO') {
      throw new HttpError(400, 'Destino inválido para transferência de palete (proibido REC ou EXPEDICAO).')
    }

    await conn.db.transaction(async (tx) => {
      const [pal] = await tx
        .select()
        .from(paletes)
        .where(and(eq(paletes.id, paleteId), eq(paletes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pal) throw new HttpError(404, 'Palete não encontrado.')

      const origem = pal.enderecoAtual
      await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [origem, destino])

      const caixas = await tx
        .select()
        .from(estoqueCaixas)
        .where(and(eq(estoqueCaixas.paleteId, paleteId), eq(estoqueCaixas.status, 'DISPONIVEL')))

      await tx
        .update(paletes)
        .set({ enderecoAtual: destino, status: 'FECHADO', ultimoOperador: ctx.operador.nome })
        .where(eq(paletes.id, paleteId))

      await tx
        .update(estoqueCaixas)
        .set({ endereco: destino, updatedAt: new Date() })
        .where(and(eq(estoqueCaixas.paleteId, paleteId), eq(estoqueCaixas.status, 'DISPONIVEL')))

      const porProdLote = new Map<string, { prodId: string; lote: string; cxs: number; kg: number }>()
      for (const c of caixas) {
        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: c.id,
          eanCaixa: c.eanCaixa,
          operacao: 'TRANSFERENCIA',
          detalhes: `Transferida via Palete (${pal.codigo}) de ${origem} para ${destino}`,
          operadorNome: ctx.operador.nome,
        })
        const k = `${c.produtoId}__${c.lote || ''}`
        const g = porProdLote.get(k) || { prodId: c.produtoId, lote: c.lote || '', cxs: 0, kg: 0 }
        g.cxs += 1
        g.kg += toNum(c.pesoKg, 0)
        porProdLote.set(k, g)
      }

      for (const g of porProdLote.values()) {
        await registrarMovimentacaoLog(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: g.prodId,
          enderecoOrigem: origem,
          enderecoDestino: destino,
          lote: g.lote,
          qtdCaixas: g.cxs,
          qtdKg: g.kg,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          tipo: 'TRANSFERENCIA',
        })
      }

      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [origem, destino])
    })

    return { success: true }
  })

  app.post('/api/movimentacao/endereco', { preHandler: requirePermission('movimentacao') }, async (req) => {
    const ctx = req.authCtx!
    const body = req.body as { origem: string; destino: string }
    const origem = String(body.origem || '').trim().toUpperCase()
    const destino = String(body.destino || '').trim().toUpperCase()
    if (!origem || !destino || destino === 'REC' || destino === 'EXPEDICAO') {
      throw new HttpError(400, 'Origem/destino inválidos para transferência de endereço.')
    }
    if (origem === destino) {
      throw new HttpError(400, 'Origem e destino devem ser diferentes.')
    }

    const res = await conn.db.transaction(async (tx) => {
      await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [origem, destino])

      const palRows = await tx
        .select({ id: paletes.id })
        .from(paletes)
        .where(
          and(
            eq(paletes.tenantId, ctx.tenantId),
            eq(paletes.filialId, ctx.filialId),
            eq(paletes.enderecoAtual, origem),
          ),
        )
      const palIds = palRows.map((p) => p.id)

      const caixas = await tx
        .select()
        .from(estoqueCaixas)
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            eq(estoqueCaixas.status, 'DISPONIVEL'),
            palIds.length > 0
              ? sql`(${estoqueCaixas.endereco} = ${origem} OR ${inArray(estoqueCaixas.paleteId, palIds)})`
              : eq(estoqueCaixas.endereco, origem),
          ),
        )

      if (palIds.length === 0 && caixas.length === 0) {
        throw new HttpError(400, `Nenhum saldo encontrado no endereço ${origem}.`)
      }

      if (palIds.length > 0) {
        await tx
          .update(paletes)
          .set({ enderecoAtual: destino, ultimoOperador: ctx.operador.nome })
          .where(inArray(paletes.id, palIds))
      }

      const porProdLote = new Map<string, { prodId: string; lote: string; cxs: number; kg: number }>()
      if (caixas.length > 0) {
        await tx
          .update(estoqueCaixas)
          .set({ endereco: destino, updatedAt: new Date() })
          .where(inArray(estoqueCaixas.id, caixas.map((c) => c.id)))

        for (const c of caixas) {
          await registrarHistoricoCaixa(tx, {
            tenantId: ctx.tenantId,
            caixaId: c.id,
            eanCaixa: c.eanCaixa,
            operacao: 'TRANSFERENCIA',
            detalhes: `Transferência de Endereço Completo (${origem}) para ${destino}`,
            operadorNome: ctx.operador.nome,
          })
          const k = `${c.produtoId}__${c.lote || ''}`
          const g = porProdLote.get(k) || { prodId: c.produtoId, lote: c.lote || '', cxs: 0, kg: 0 }
          g.cxs += 1
          g.kg += toNum(c.pesoKg, 0)
          porProdLote.set(k, g)
        }

        for (const g of porProdLote.values()) {
          await registrarMovimentacaoLog(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: g.prodId,
            enderecoOrigem: origem,
            enderecoDestino: destino,
            lote: g.lote,
            qtdCaixas: g.cxs,
            qtdKg: g.kg,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
            tipo: 'TRANSFERENCIA',
          })
        }
      }

      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [origem, destino])
      return { totalPaletes: palIds.length, totalCaixas: caixas.length }
    })

    return { success: true, ...res }
  })

  app.post('/api/movimentacao/caixas', { preHandler: requirePermission('movimentacao') }, async (req) => {
    const ctx = req.authCtx!
    const body = req.body as { caixas_ids: string[]; destino: string }
    const destino = String(body.destino || '').trim().toUpperCase()
    if (!destino || destino === 'REC' || destino === 'EXPEDICAO') {
      throw new HttpError(400, 'Proibido transferir diretamente para REC ou EXPEDICAO pela Movimentação.')
    }
    if (!Array.isArray(body.caixas_ids) || body.caixas_ids.length === 0) {
      throw new HttpError(400, 'Selecione pelo menos uma caixa para transferir.')
    }
    const ids = body.caixas_ids.map((id) => parseUuidOrBadRequest(id, 'caixa_id'))

    const total = await conn.db.transaction(async (tx) => {
      const caixas = await tx
        .select()
        .from(estoqueCaixas)
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            eq(estoqueCaixas.status, 'DISPONIVEL'),
            inArray(estoqueCaixas.id, ids),
          ),
        )
        .for('update')

      if (caixas.length === 0) {
        throw new HttpError(404, 'Nenhuma caixa disponível encontrada para transferência.')
      }

      const enderecos = new Set<string>([destino])
      const porGrupo = new Map<string, { prodId: string; orig: string; lote: string; cxs: number; kg: number }>()

      for (const c of caixas) {
        const orig = c.endereco || 'REC'
        enderecos.add(orig)
        const k = `${c.produtoId}__${orig}__${c.lote || ''}`
        const g = porGrupo.get(k) || { prodId: c.produtoId, orig, lote: c.lote || '', cxs: 0, kg: 0 }
        g.cxs += 1
        g.kg += toNum(c.pesoKg, 0)
        porGrupo.set(k, g)
      }

      await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [...enderecos])

      await tx
        .update(estoqueCaixas)
        .set({ endereco: destino, paleteId: null, updatedAt: new Date() })
        .where(inArray(estoqueCaixas.id, caixas.map((c) => c.id)))

      for (const c of caixas) {
        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: c.id,
          eanCaixa: c.eanCaixa,
          operacao: 'TRANSFERENCIA',
          detalhes: `Transferida de ${c.endereco || 'REC'} para ${destino}`,
          operadorNome: ctx.operador.nome,
        })
      }

      for (const g of porGrupo.values()) {
        await registrarMovimentacaoLog(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: g.prodId,
          enderecoOrigem: g.orig,
          enderecoDestino: destino,
          lote: g.lote,
          qtdCaixas: g.cxs,
          qtdKg: g.kg,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          tipo: 'TRANSFERENCIA',
        })
      }

      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...enderecos])
      return caixas.length
    })

    return { success: true, totalCaixas: total }
  })

  app.get(
    '/api/movimentacao/historico',
    {
      preHandler: requirePermission(['movimentacao_historico', 'movimentacao_consultar', 'movimentacao', 'dashboard_executivo'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as {
        limit?: string
        tipo?: string
        produto_id?: string
        filtroEndereco?: string
        filtroProduto?: string
        data_inicio?: string
        data_fim?: string
        incluirInsumos?: string
      }
      const limit = Math.min(500, Math.max(1, Number(q.limit) || 150))
      const conds = [
        eq(movimentacoesLog.tenantId, ctx.tenantId),
        eq(movimentacoesLog.filialId, ctx.filialId),
      ]
      if (q.tipo) conds.push(eq(movimentacoesLog.tipo, q.tipo.trim().toUpperCase()))
      if (q.produto_id) conds.push(eq(movimentacoesLog.produtoId, parseUuidOrBadRequest(q.produto_id, 'produto_id')))
      if (q.filtroEndereco) {
        const pe = `%${q.filtroEndereco.trim().toUpperCase()}%`
        conds.push(sql`(UPPER(${movimentacoesLog.enderecoOrigem}) LIKE ${pe} OR UPPER(${movimentacoesLog.enderecoDestino}) LIKE ${pe})`)
      }
      if (q.filtroProduto) {
        const pp = `%${q.filtroProduto.trim().toUpperCase()}%`
        conds.push(sql`(UPPER(${produtos.codigo}) LIKE ${pp} OR UPPER(${produtos.descricao}) LIKE ${pp})`)
      }
      if (q.data_inicio) conds.push(sql`DATE(${movimentacoesLog.dataHora}) >= ${q.data_inicio}`)
      if (q.data_fim) conds.push(sql`DATE(${movimentacoesLog.dataHora}) <= ${q.data_fim}`)
      if (q.incluirInsumos === 'true') {
        conds.push(eq(produtos.tipoProduto, 'Insumos'))
      } else if (q.incluirInsumos !== 'all') {
        conds.push(sql`(${produtos.tipoProduto} IS NULL OR ${produtos.tipoProduto} != 'Insumos')`)
      }

      const rows = await conn.db
        .select({
          id: movimentacoesLog.id,
          tipo: movimentacoesLog.tipo,
          endereco_origem: movimentacoesLog.enderecoOrigem,
          endereco_destino: movimentacoesLog.enderecoDestino,
          lote: movimentacoesLog.lote,
          qtd_caixas: movimentacoesLog.qtdCaixas,
          qtd_kg: movimentacoesLog.qtdKg,
          data_hora: movimentacoesLog.dataHora,
          operador_nome: movimentacoesLog.operadorNome,
          num_pedido: movimentacoesLog.numPedido,
          cliente: movimentacoesLog.cliente,
          produto_id: movimentacoesLog.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          valor_unitario: produtos.valorUnitario,
          tipo_produto: produtos.tipoProduto,
        })
        .from(movimentacoesLog)
        .leftJoin(produtos, eq(produtos.id, movimentacoesLog.produtoId))
        .where(and(...conds))
        .orderBy(desc(movimentacoesLog.dataHora))
        .limit(limit)

      return {
        data: rows.map((r) => ({
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: toNum(r.qtd_kg, 0),
          valor_unitario: toNum(r.valor_unitario, 0),
        })),
      }
    },
  )

  app.delete('/api/movimentacao/historico/:id', { preHandler: requirePermission('deletar_historico') }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'id')
    await conn.db
      .delete(movimentacoesLog)
      .where(and(eq(movimentacoesLog.id, id), eq(movimentacoesLog.tenantId, ctx.tenantId)))
    return { success: true }
  })

  app.get(
    '/api/rastreabilidade/:ean',
    { preHandler: requirePermission(['rastreabilidade', 'consulta_estoque', 'desmembramento'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const ean = String((req.params as { ean: string }).ean || '').trim()
      if (!ean) throw new HttpError(400, 'Informe o EAN para rastreabilidade.')

      const [caixa] = await conn.db
        .select({
          id: estoqueCaixas.id,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
          tara_kg: estoqueCaixas.taraKg,
          peso_kg: estoqueCaixas.pesoKg,
          qtd_pecas: estoqueCaixas.qtdPecas,
          origem_tipo: estoqueCaixas.origemTipo,
          caixa_origem_id: estoqueCaixas.caixaOrigemId,
          ean_origem: estoqueCaixas.eanOrigem,
          op_id: estoqueCaixas.opId,
          op_codigo: ordensProducao.codigo,
          op_nome: ordensProducao.nome,
          status: estoqueCaixas.status,
          pedido_reservado_codigo: estoqueCaixas.pedidoReservadoCodigo,
          romaneio_reservado_codigo: estoqueCaixas.romaneioReservadoCodigo,
          cliente_reservado_nome: estoqueCaixas.clienteReservadoNome,
          created_at: estoqueCaixas.createdAt,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .leftJoin(ordensProducao, eq(ordensProducao.id, estoqueCaixas.opId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${ean}, '0')`,
          ),
        )
        .limit(1)

      if (!caixa) throw new HttpError(404, `EAN "${ean}" não localizado na rastreabilidade.`)

      const [historico, desmembradas] = await Promise.all([
        conn.db
          .select()
          .from(caixasHistorico)
          .where(and(eq(caixasHistorico.tenantId, ctx.tenantId), eq(caixasHistorico.eanCaixa, caixa.ean_caixa)))
          .orderBy(desc(caixasHistorico.dataHora)),
        conn.db
          .select()
          .from(desmembramentosVinculos)
          .where(
            and(
              eq(desmembramentosVinculos.tenantId, ctx.tenantId),
              eq(desmembramentosVinculos.caixaOrigemId, caixa.id),
            ),
          )
          .orderBy(desc(desmembramentosVinculos.createdAt)),
      ])

      return {
        caixa: normalizeCaixaRow(caixa),
        historico,
        filhos_desmembramento: desmembradas,
      }
    },
  )

  // ── DESMEMBRAMENTO ──────────────────────────────────────────────────────────
  app.post('/api/desmembramento/validar', { preHandler: requirePermission('desmembramento') }, async (req) => {
    const ctx = req.authCtx!
    const ean = String((req.body as { ean?: string })?.ean || '').trim()
    if (!ean) throw new HttpError(400, 'Informe ou bipe o EAN da caixa.')

    const [caixa] = await conn.db
      .select({
        id: estoqueCaixas.id,
        ean_caixa: estoqueCaixas.eanCaixa,
        produto_id: estoqueCaixas.produtoId,
        produto_codigo: produtos.codigo,
        produto_descricao: produtos.descricao,
        palete_id: estoqueCaixas.paleteId,
        palete_endereco: paletes.enderecoAtual,
        endereco: estoqueCaixas.endereco,
        lote: estoqueCaixas.lote,
        data_producao: estoqueCaixas.dataProducao,
        validade: estoqueCaixas.validade,
        peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
        tara_kg: estoqueCaixas.taraKg,
        peso_kg: estoqueCaixas.pesoKg,
        qtd_pecas: estoqueCaixas.qtdPecas,
        status: estoqueCaixas.status,
      })
      .from(estoqueCaixas)
      .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
      .leftJoin(paletes, eq(paletes.id, estoqueCaixas.paleteId))
      .where(
        and(
          eq(estoqueCaixas.tenantId, ctx.tenantId),
          eq(estoqueCaixas.filialId, ctx.filialId),
          sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${ean}, '0')`,
        ),
      )
      .limit(1)

    if (!caixa) return { valid: false, error: `Caixa "${ean}" não encontrada no estoque.` }
    if (caixa.status !== 'DISPONIVEL') {
      return { valid: false, error: `Caixa está com status "${caixa.status}" e não pode ser desmembrada.` }
    }
    return { valid: true, caixa: normalizeCaixaRow(caixa) }
  })

  app.post('/api/desmembramento', { preHandler: requirePermission('desmembramento') }, async (req) => {
    const ctx = req.authCtx!
    const body = req.body as {
      caixa_origem_id?: string
      ean_origem?: string
      motivo_diferenca_pecas?: string
      itens: Array<{
        peso_bruto_kg: number
        tara_id?: string | null
        tara_kg?: number
        qtd_pecas: number
        ean_caixa?: string
      }>
    }

    if (!Array.isArray(body.itens) || body.itens.length < 1) {
      throw new HttpError(400, 'Adicione ao menos uma nova caixa ao desmembramento.')
    }

    const res = await conn.db.transaction(async (tx) => {
      const cleanEan = String(body.ean_origem || '').trim()
      const origRes = body.caixa_origem_id
        ? await tx.execute(sql`
            SELECT ec.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, pal.endereco_atual AS palete_endereco
            FROM estoque_caixas ec
            JOIN produtos p ON p.id = ec.produto_id
            LEFT JOIN paletes pal ON pal.id = ec.palete_id
            WHERE ec.id = ${parseUuidOrBadRequest(body.caixa_origem_id, 'caixa_origem_id')} AND ec.tenant_id = ${ctx.tenantId}
            FOR UPDATE OF ec
          `)
        : await tx.execute(sql`
            SELECT ec.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, pal.endereco_atual AS palete_endereco
            FROM estoque_caixas ec
            JOIN produtos p ON p.id = ec.produto_id
            LEFT JOIN paletes pal ON pal.id = ec.palete_id
            WHERE ec.tenant_id = ${ctx.tenantId} AND ec.filial_id = ${ctx.filialId}
              AND LTRIM(ec.ean_caixa, '0') = LTRIM(${cleanEan}, '0')
            LIMIT 1
            FOR UPDATE OF ec
          `)

      const orig = origRes.rows[0] as
        | {
            id: string
            ean_caixa: string
            produto_id: string
            produto_codigo: string
            produto_descricao: string
            palete_id: string | null
            palete_endereco: string | null
            endereco: string | null
            lote: string
            data_producao: string | null
            validade: string | null
            peso_kg: string
            qtd_pecas: number | null
            status: string
          }
        | undefined

      if (!orig) throw new HttpError(404, 'Caixa original não encontrada no estoque.')
      if (orig.status !== 'DISPONIVEL') {
        throw new HttpError(409, `Caixa original já está com status "${orig.status}".`)
      }

      const enderecoFinal = orig.endereco || orig.palete_endereco || 'DOCA'
      await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [enderecoFinal])

      const loteFinal = String(
        orig.lote || (orig.data_producao ? gerarLotePorData(orig.data_producao) : ''),
      ).trim()

      const itensNorm = []
      for (const it of body.itens) {
        const { taraId, taraKg } = await resolverTaraPeso(tx, ctx.tenantId, it.tara_id, it.tara_kg)
        const bruto = Number(toNum(it.peso_bruto_kg, 0).toFixed(3))
        const liq = calcularPesoLiquido(bruto, taraKg)
        const pecas = Math.trunc(toNum(it.qtd_pecas, 0))
        if (!Number.isFinite(liq) || liq <= 0) {
          throw new HttpError(400, `Peso bruto (${bruto} kg) deve ser maior que a tara (${taraKg} kg).`)
        }
        if (pecas <= 0) {
          throw new HttpError(400, 'Quantidade de peças de cada nova caixa deve ser maior que zero.')
        }
        itensNorm.push({
          taraId,
          taraKg,
          pesoBrutoKg: bruto,
          pesoLiquidoKg: liq,
          qtdPecas: pecas,
          eanInformado: it.ean_caixa ? String(it.ean_caixa).trim() : null,
        })
      }

      const somaPecasNovas = itensNorm.reduce((acc, i) => acc + i.qtdPecas, 0)
      const origPecas = orig.qtd_pecas != null && Number(orig.qtd_pecas) > 0 ? Math.trunc(Number(orig.qtd_pecas)) : null
      const perdaPecas = origPecas != null ? origPecas - somaPecasNovas : 0
      const motivoLimpo = String(body.motivo_diferenca_pecas || '').trim()

      const autoEans = await gerarProximosEansInternos(tx, ctx.tenantId, itensNorm.length, orig.produto_codigo)
      const novosEans = itensNorm.map((it, idx) => it.eanInformado || autoEans[idx])
      const codigoOperacao = await gerarCodigoDocumento(tx, ctx.tenantId, 'DESM', 'DESM', 5)

      await tx
        .update(estoqueCaixas)
        .set({ status: 'CONSUMIDA', updatedAt: new Date() })
        .where(and(eq(estoqueCaixas.id, orig.id), eq(estoqueCaixas.status, 'DISPONIVEL')))

      const resumoPecas =
        origPecas != null
          ? ` • Peças: orig ${origPecas} pç → soma ${somaPecasNovas} pç${perdaPecas !== 0 ? ` (dif ${perdaPecas > 0 ? '-' : '+'}${Math.abs(perdaPecas)} pç${motivoLimpo ? `: ${motivoLimpo}` : ''})` : ''}`
          : ` • Total peças geradas: ${somaPecasNovas} pç`

      await registrarHistoricoCaixa(tx, {
        tenantId: ctx.tenantId,
        caixaId: orig.id,
        eanCaixa: orig.ean_caixa,
        operacao: 'DESMEMBRAMENTO_ORIGEM',
        detalhes: `Desmembrada (${codigoOperacao}) em ${itensNorm.length} caixas: ${novosEans.join(', ')}${resumoPecas}`,
        operadorNome: ctx.operador.nome,
      })

      await registrarMovimentacaoLog(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        produtoId: orig.produto_id,
        enderecoOrigem: enderecoFinal,
        enderecoDestino: 'DESMEMBRAMENTO',
        lote: loteFinal,
        qtdCaixas: 1,
        qtdKg: toNum(orig.peso_kg, 0),
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
        tipo: 'TRANSFERENCIA',
      })

      const caixasGeradas = []
      for (let i = 0; i < itensNorm.length; i++) {
        const novoEan = novosEans[i]
        const item = itensNorm[i]
        const novaId = uuidv7()

        await tx.insert(estoqueCaixas).values({
          id: novaId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          eanCaixa: novoEan,
          produtoId: orig.produto_id,
          paleteId: orig.palete_id,
          paleteOrigemId: orig.palete_id,
          endereco: orig.endereco || enderecoFinal,
          lote: loteFinal,
          dataProducao: orig.data_producao,
          validade: orig.validade,
          pesoBrutoKg: toDec(item.pesoBrutoKg, 3),
          taraId: item.taraId,
          taraKg: toDec(item.taraKg, 3),
          pesoKg: toDec(item.pesoLiquidoKg, 3),
          qtdPecas: item.qtdPecas,
          origemTipo: 'DESMEMBRAMENTO',
          caixaOrigemId: orig.id,
          eanOrigem: orig.ean_caixa,
          operadorCadastroNome: ctx.operador.nome,
          status: 'DISPONIVEL',
        })

        await tx.insert(desmembramentosVinculos).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          codigoOperacao,
          caixaOrigemId: orig.id,
          eanOrigem: orig.ean_caixa,
          caixaDestinoId: novaId,
          eanDestino: novoEan,
          produtoId: orig.produto_id,
          pesoLiquidoKg: toDec(item.pesoLiquidoKg, 3),
          pesoBrutoKg: toDec(item.pesoBrutoKg, 3),
          taraKg: toDec(item.taraKg, 3),
          lote: loteFinal,
          dataProducao: orig.data_producao,
          validade: orig.validade,
          qtdPecas: item.qtdPecas,
          perdaPecas,
          motivoDiferencaPecas: motivoLimpo,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: novaId,
          eanCaixa: novoEan,
          operacao: 'DESMEMBRAMENTO_NOVA_CAIXA',
          detalhes: `Gerada de ${orig.ean_caixa} (${codigoOperacao}) • Lote ${loteFinal || '-'} • ${item.qtdPecas} pç • Bruto ${item.pesoBrutoKg.toFixed(2)}kg | Tara ${item.taraKg.toFixed(3)}kg | Líq ${item.pesoLiquidoKg.toFixed(2)}kg`,
          operadorNome: ctx.operador.nome,
        })

        await registrarMovimentacaoLog(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: orig.produto_id,
          enderecoOrigem: 'DESMEMBRAMENTO',
          enderecoDestino: orig.endereco || enderecoFinal,
          lote: loteFinal,
          qtdCaixas: 1,
          qtdKg: item.pesoLiquidoKg,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          tipo: 'TRANSFERENCIA',
        })

        caixasGeradas.push({
          id: novaId,
          ean_caixa: novoEan,
          ean_origem: orig.ean_caixa,
          produto_id: orig.produto_id,
          produto_codigo: orig.produto_codigo,
          produto_descricao: orig.produto_descricao,
          lote: loteFinal,
          data_producao: orig.data_producao,
          validade: orig.validade,
          peso_bruto_kg: item.pesoBrutoKg,
          tara_kg: item.taraKg,
          peso_liquido_kg: item.pesoLiquidoKg,
          peso_kg: item.pesoLiquidoKg,
          qtd_pecas: item.qtdPecas,
          origem_tipo: 'DESMEMBRAMENTO',
        })
      }

      await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [enderecoFinal])
      return { codigo_operacao: codigoOperacao, caixas_geradas: caixasGeradas }
    })

    return { success: true, ...res }
  })

  app.get(
    '/api/desmembramento/recentes',
    { preHandler: requirePermission(['desmembramento', 'reimpressao', 'rastreabilidade'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string }).limit) || 30))
      const rows = await conn.db
        .select({
          id: desmembramentosVinculos.id,
          codigo_operacao: desmembramentosVinculos.codigoOperacao,
          caixa_origem_id: desmembramentosVinculos.caixaOrigemId,
          ean_origem: desmembramentosVinculos.eanOrigem,
          caixa_destino_id: desmembramentosVinculos.caixaDestinoId,
          ean_destino: desmembramentosVinculos.eanDestino,
          produto_id: desmembramentosVinculos.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          peso_liquido_kg: desmembramentosVinculos.pesoLiquidoKg,
          peso_bruto_kg: desmembramentosVinculos.pesoBrutoKg,
          tara_kg: desmembramentosVinculos.taraKg,
          qtd_pecas: desmembramentosVinculos.qtdPecas,
          perda_pecas: desmembramentosVinculos.perdaPecas,
          motivo_diferenca_pecas: desmembramentosVinculos.motivoDiferencaPecas,
          lote: desmembramentosVinculos.lote,
          data_producao: desmembramentosVinculos.dataProducao,
          validade: desmembramentosVinculos.validade,
          operador_nome: desmembramentosVinculos.operadorNome,
          created_at: desmembramentosVinculos.createdAt,
        })
        .from(desmembramentosVinculos)
        .innerJoin(produtos, eq(produtos.id, desmembramentosVinculos.produtoId))
        .where(eq(desmembramentosVinculos.tenantId, ctx.tenantId))
        .orderBy(desc(desmembramentosVinculos.createdAt))
        .limit(limit)

      return {
        data: rows.map((r) => ({
          ...r,
          peso_liquido_kg: toNum(r.peso_liquido_kg, 0),
          peso_bruto_kg: toNum(r.peso_bruto_kg, 0),
          tara_kg: toNum(r.tara_kg, 0),
        })),
      }
    },
  )

  // ── EANS INTERNOS, EDITOR DE EAN E LOG DE REIMPRESSÃO ─────────────────────
  app.post(
    '/api/eans/internos',
    { preHandler: requirePermission(['desmembramento', 'producao_saida', 'retorno_producao', 'reimpressao', 'recebimento']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = req.body as { quantidade?: number; codigo_produto?: string }
      const eans = await conn.db.transaction((tx) =>
        gerarProximosEansInternos(tx, ctx.tenantId, body.quantidade || 1, body.codigo_produto || ''),
      )
      return { success: true, eans }
    },
  )

  app.get(
    '/api/ean-editor/regras',
    { preHandler: requirePermission(['ean_etiquetas', 'produtos'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: produtosEans.id,
          produto_id: produtosEans.produtoId,
          codigo_barras: produtosEans.codigoBarras,
          tipo_regra: produtosEans.tipoRegra,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
        })
        .from(produtosEans)
        .innerJoin(produtos, eq(produtos.id, produtosEans.produtoId))
        .where(eq(produtosEans.tenantId, ctx.tenantId))
        .orderBy(produtos.codigo, produtosEans.codigoBarras)
      return { data: rows }
    },
  )

  app.post('/api/ean-editor/:produtoId/eans', { preHandler: requirePermission(['ean_etiquetas', 'produtos']) }, async (req, reply) => {
    const ctx = req.authCtx!
    const produtoId = parseUuidOrBadRequest((req.params as { produtoId: string }).produtoId, 'produto_id')
    const body = req.body as { codigo_barras: string; tipo_regra?: string }
    const cod = String(body.codigo_barras || '').trim()
    if (!cod) throw new HttpError(400, 'Código de barras obrigatório.')

    const id = uuidv7()
    await conn.db
      .insert(produtosEans)
      .values({
        id,
        tenantId: ctx.tenantId,
        produtoId,
        codigoBarras: cod,
        tipoRegra: body.tipo_regra || 'DUN14',
      })
      .onConflictDoNothing()

    return reply.code(201).send({ success: true, id })
  })

  app.post(
    '/api/reimpressao/log',
    { preHandler: requirePermission(['reimpressao', 'desmembramento', 'producao_saida', 'retorno_producao']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = req.body as { caixa_id?: string | null; ean_caixa: string; origem_tipo?: string }
      const ean = String(body.ean_caixa || '').trim()
      if (!ean) throw new HttpError(400, 'ean_caixa obrigatório.')

      await registrarHistoricoCaixa(conn.db, {
        tenantId: ctx.tenantId,
        caixaId: body.caixa_id ? parseUuidOrBadRequest(body.caixa_id, 'caixa_id') : null,
        eanCaixa: ean,
        operacao: 'REIMPRESSAO_ETIQUETA',
        detalhes: `Etiqueta 100x70mm reimpressa preservando EAN original (${body.origem_tipo || 'ESTOQUE'})`,
        operadorNome: ctx.operador.nome,
      })

      return { success: true }
    },
  )
}
