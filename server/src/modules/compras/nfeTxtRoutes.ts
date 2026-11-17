import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  estoqueCaixas,
  fornecedorProdutoDepara,
  fornecedores,
  layoutsImportacaoTxt,
  paletes,
  pedidosCompra,
  pedidosCompraItens,
  produtos,
  recebimentoPreCaixas,
  recebimentos,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  assertEnderecosNaoBloqueados,
  type DbOrTx,
  gerarCodigoDocumento,
  lerTenantFeatures,
  normalizarDataIso,
  normalizeCaixaRow,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  toDec,
  toNum,
} from '../wms/helpers.js'
import { parseNfeXml } from './nfeXmlParser.js'
import { parseTxtEtiquetasBatch } from './txtEtiquetasParser.js'

const LayoutTxtSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do layout.'),
  fornecedor_id: z.string().uuid().nullish(),
  tipo_arquivo: z.enum(['DELIMITADO', 'POSICIONAL']).default('DELIMITADO'),
  delimitador: z.string().min(1).default(';'),
  saltar_linhas: z.coerce.number().int().min(0).default(0),
  formato_data: z.string().trim().default('DDMMYYYY'),
  decimal_ponto: z.union([z.boolean(), z.number()]).optional().default(0),
  mapeamento_json: z.record(z.coerce.number().int().min(0)),
})

async function carregarMapaProdutosEDepara(
  dbOrTx: DbOrTx,
  tenantId: string,
  fornecedorId?: string | null,
) {
  const [allProds, deparaRows] = await Promise.all([
    dbOrTx
      .select({
        id: produtos.id,
        codigo: produtos.codigo,
        codigo_auxiliar: produtos.codigoAuxiliar,
        ean: produtos.ean,
        descricao: produtos.descricao,
        unidade: produtos.unidade,
        custo_medio_kg: produtos.custoMedioKg,
      })
      .from(produtos)
      .where(and(eq(produtos.tenantId, tenantId), eq(produtos.ativo, 1))),
    fornecedorId
      ? dbOrTx
          .select()
          .from(fornecedorProdutoDepara)
          .where(
            and(
              eq(fornecedorProdutoDepara.tenantId, tenantId),
              eq(fornecedorProdutoDepara.fornecedorId, fornecedorId),
            ),
          )
      : Promise.resolve([]),
  ])

  const prodById = new Map(allProds.map((p) => [p.id, p]))
  const deparaByCod = new Map(deparaRows.map((d) => [d.codigoFornecedor.trim().toUpperCase(), d]))

  const resolverProduto = (codigoFornecedor: string, eanComercial = '') => {
    const codNorm = String(codigoFornecedor || '').trim().toUpperCase()
    const codSemZero = codNorm.replace(/^0+/, '') || codNorm

    const dep = deparaByCod.get(codNorm) || deparaByCod.get(codSemZero)
    if (dep && prodById.has(dep.produtoId)) {
      return {
        produto: prodById.get(dep.produtoId)!,
        fator_conversao: toNum(dep.fatorConversao, 1),
        origem_vinculo: 'DEPARA' as const,
      }
    }

    const matchDirect = allProds.find((p) => {
      const pc = String(p.codigo || '').trim().toUpperCase()
      const pa = String(p.codigo_auxiliar || '').trim().toUpperCase()
      const pe = String(p.ean || '').trim()
      return (
        (pc && (pc === codNorm || pc.replace(/^0+/, '') === codSemZero)) ||
        (pa && (pa === codNorm || pa.replace(/^0+/, '') === codSemZero)) ||
        (eanComercial && pe && pe === eanComercial)
      )
    })
    if (matchDirect) {
      return { produto: matchDirect, fator_conversao: 1, origem_vinculo: 'CODIGO_PRODUTO' as const }
    }
    return { produto: null, fator_conversao: 1, origem_vinculo: 'NAO_MAPEADO' as const }
  }

  return { allProds, prodById, deparaRows, resolverProduto }
}

async function efetivarPreCaixaNoEstoque(
  tx: DbOrTx,
  params: {
    ctx: { tenantId: string; filialId: string; operador: { id: string; nome: string } }
    pre: typeof recebimentoPreCaixas.$inferSelect
    sifOrigem: string
    paleteId: string | null
    endereco: string
    forcarProdutoExtra?: boolean
  },
) {
  const { ctx, pre } = params
  if (!pre.produtoId) {
    throw new HttpError(
      400,
      `A caixa ${pre.eanCaixa} (cód. fornecedor "${pre.codigoProdutoFornecedor}") ainda não possui De-Para vinculado a um produto interno.`,
    )
  }

  const [dup] = await tx
    .select({ id: estoqueCaixas.id })
    .from(estoqueCaixas)
    .where(and(eq(estoqueCaixas.tenantId, ctx.tenantId), eq(estoqueCaixas.eanCaixa, pre.eanCaixa)))
    .limit(1)
  if (dup) {
    throw new HttpError(409, `A caixa com EAN "${pre.eanCaixa}" já deu entrada no estoque!`)
  }

  let pcItemMatchId: string | null = null
  let custoPcFallback = 0
  if (pre.pedidoCompraId) {
    const [pcItem] = await tx
      .select()
      .from(pedidosCompraItens)
      .where(
        and(
          eq(pedidosCompraItens.pedidoCompraId, pre.pedidoCompraId),
          eq(pedidosCompraItens.produtoId, pre.produtoId),
        ),
      )
      .limit(1)
    if (pcItem) {
      pcItemMatchId = pcItem.id
      custoPcFallback = toNum(pcItem.precoUnitarioKg, 0)
    } else if (!params.forcarProdutoExtra) {
      const [pcRow] = await tx
        .select({ codigo: pedidosCompra.codigo })
        .from(pedidosCompra)
        .where(eq(pedidosCompra.id, pre.pedidoCompraId))
        .limit(1)
      throw new HttpError(
        409,
        `O produto da caixa ${pre.eanCaixa} (${pre.descricaoProdutoFornecedor || pre.codigoProdutoFornecedor}) não consta no Pedido de Compra ${pcRow?.codigo || ''}.`,
      )
    }
  }

  const pesoLiq = toNum(pre.pesoLiquidoKg, 0)
  const taraKg = toNum(pre.taraKg, 0)
  const pesoBruto = pre.pesoBrutoKg != null ? toNum(pre.pesoBrutoKg, pesoLiq + taraKg) : Number((pesoLiq + taraKg).toFixed(3))
  const custoKg = toNum(pre.custoUnitarioKg, 0) > 0 ? toNum(pre.custoUnitarioKg, 0) : custoPcFallback
  const caixaId = uuidv7()
  const now = new Date()

  await tx.insert(estoqueCaixas).values({
    id: caixaId,
    tenantId: ctx.tenantId,
    filialId: ctx.filialId,
    eanCaixa: pre.eanCaixa,
    produtoId: pre.produtoId,
    paleteId: params.paleteId,
    paleteOrigemId: params.paleteId,
    fornecedorId: pre.fornecedorId,
    recebimentoId: pre.recebimentoId,
    sifOrigem: params.sifOrigem,
    endereco: params.endereco,
    lote: pre.lote || '',
    dataProducao: pre.dataProducao,
    validade: pre.validade,
    pesoBrutoKg: toDec(pesoBruto, 3),
    taraKg: toDec(taraKg, 3),
    pesoKg: toDec(pesoLiq, 3),
    qtdPecas: pre.qtdPecas,
    custoUnitarioKg: toDec(custoKg, 4),
    origemTipo: 'RECEBIMENTO',
    operadorCadastroNome: ctx.operador.nome,
    status: 'DISPONIVEL',
  })

  await tx
    .update(recebimentoPreCaixas)
    .set({ status: 'BIPADA', caixaEstoqueId: caixaId, bipadaEm: now })
    .where(eq(recebimentoPreCaixas.id, pre.id))

  if (pcItemMatchId && pre.pedidoCompraId) {
    await tx
      .update(pedidosCompraItens)
      .set({
        qtdKgRecebida: sql`${pedidosCompraItens.qtdKgRecebida} + ${toDec(pesoLiq, 3)}`,
      })
      .where(eq(pedidosCompraItens.id, pcItemMatchId))
    await tx
      .update(pedidosCompra)
      .set({ status: 'PARCIAL', updatedAt: now })
      .where(and(eq(pedidosCompra.id, pre.pedidoCompraId), eq(pedidosCompra.status, 'APROVADO')))
  }

  await registrarHistoricoCaixa(tx, {
    tenantId: ctx.tenantId,
    caixaId,
    eanCaixa: pre.eanCaixa,
    operacao: 'RECEBIMENTO',
    detalhes: `Entrada via Pré-Recebimento (${pre.arquivoOrigem || 'TXT'}) em ${params.endereco} • Lote ${pre.lote || '-'} • Líq ${pesoLiq.toFixed(2)}kg • Custo R$ ${custoKg.toFixed(2)}/kg`,
    operadorNome: ctx.operador.nome,
  })

  await registrarMovimentacaoLog(tx, {
    tenantId: ctx.tenantId,
    filialId: ctx.filialId,
    produtoId: pre.produtoId,
    enderecoOrigem: 'EXTERNO',
    enderecoDestino: params.endereco,
    lote: pre.lote || '',
    qtdCaixas: 1,
    qtdKg: pesoLiq,
    operadorId: ctx.operador.id,
    operadorNome: ctx.operador.nome,
    tipo: 'ENTRADA',
  })

  return { caixaId, pesoLiq, produtoId: pre.produtoId, custoKg }
}

export function registerNfeTxtRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── LAYOUTS DE IMPORTAÇÃO TXT ───────────────────────────────────────────────
  app.get(
    '/api/compras/layouts-txt',
    { preHandler: requirePermission(['compras', 'recebimento', 'fornecedores'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: layoutsImportacaoTxt.id,
          fornecedor_id: layoutsImportacaoTxt.fornecedorId,
          fornecedor_nome: fornecedores.nomeFantasia,
          nome: layoutsImportacaoTxt.nome,
          tipo_arquivo: layoutsImportacaoTxt.tipoArquivo,
          delimitador: layoutsImportacaoTxt.delimitador,
          saltar_linhas: layoutsImportacaoTxt.saltarLinhas,
          formato_data: layoutsImportacaoTxt.formatoData,
          decimal_ponto: layoutsImportacaoTxt.decimalPonto,
          mapeamento_json: layoutsImportacaoTxt.mapeamentoJson,
        })
        .from(layoutsImportacaoTxt)
        .leftJoin(fornecedores, eq(fornecedores.id, layoutsImportacaoTxt.fornecedorId))
        .where(and(eq(layoutsImportacaoTxt.tenantId, ctx.tenantId), eq(layoutsImportacaoTxt.ativo, 1)))
        .orderBy(asc(layoutsImportacaoTxt.createdAt))
      return { success: true, data: rows }
    },
  )

  app.post(
    '/api/compras/layouts-txt',
    { preHandler: requirePermission(['compras', 'recebimento', 'fornecedores']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsed = LayoutTxtSchema.safeParse(req.body)
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Layout inválido.')
      const d = parsed.data
      const id = uuidv7()
      await conn.db.insert(layoutsImportacaoTxt).values({
        id,
        tenantId: ctx.tenantId,
        fornecedorId: d.fornecedor_id || null,
        nome: d.nome,
        tipoArquivo: d.tipo_arquivo,
        delimitador: d.delimitador,
        saltarLinhas: d.saltar_linhas,
        formatoData: d.formato_data,
        decimalPonto: d.decimal_ponto ? 1 : 0,
        mapeamentoJson: d.mapeamento_json,
        ativo: 1,
      })
      return reply.code(201).send({ success: true, id })
    },
  )

  app.delete(
    '/api/compras/layouts-txt/:id',
    { preHandler: requirePermission(['compras', 'recebimento', 'fornecedores']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'layout_id')
      await conn.db
        .update(layoutsImportacaoTxt)
        .set({ ativo: 0 })
        .where(and(eq(layoutsImportacaoTxt.id, id), eq(layoutsImportacaoTxt.tenantId, ctx.tenantId)))
      return { success: true }
    },
  )

  // ── DE-PARA FORNECEDOR -> PRODUTO WMS ───────────────────────────────────────
  app.get(
    '/api/compras/depara',
    { preHandler: requirePermission(['compras', 'recebimento', 'fornecedores'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { fornecedor_id?: string }
      const conds = [eq(fornecedorProdutoDepara.tenantId, ctx.tenantId)]
      if (q.fornecedor_id) {
        conds.push(eq(fornecedorProdutoDepara.fornecedorId, parseUuidOrBadRequest(q.fornecedor_id, 'fornecedor_id')))
      }
      const rows = await conn.db
        .select({
          id: fornecedorProdutoDepara.id,
          fornecedor_id: fornecedorProdutoDepara.fornecedorId,
          fornecedor_nome: fornecedores.nomeFantasia,
          codigo_fornecedor: fornecedorProdutoDepara.codigoFornecedor,
          descricao_fornecedor: fornecedorProdutoDepara.descricaoFornecedor,
          ncm: fornecedorProdutoDepara.ncm,
          produto_id: fornecedorProdutoDepara.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          fator_conversao: fornecedorProdutoDepara.fatorConversao,
          updated_at: fornecedorProdutoDepara.updatedAt,
        })
        .from(fornecedorProdutoDepara)
        .innerJoin(fornecedores, eq(fornecedores.id, fornecedorProdutoDepara.fornecedorId))
        .innerJoin(produtos, eq(produtos.id, fornecedorProdutoDepara.produtoId))
        .where(and(...conds))
        .orderBy(asc(fornecedores.nomeFantasia), asc(fornecedorProdutoDepara.codigoFornecedor))

      return {
        success: true,
        data: rows.map((r) => ({ ...r, fator_conversao: toNum(r.fator_conversao, 1) })),
      }
    },
  )

  app.post(
    '/api/compras/depara',
    { preHandler: requirePermission(['compras', 'recebimento', 'fornecedores']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        fornecedor_id?: string
        vinculos?: Array<{
          codigo_fornecedor: string
          descricao_fornecedor?: string
          ncm?: string
          produto_id: string
          fator_conversao?: number
        }>
      }
      const fornecedorId = parseUuidOrBadRequest(body.fornecedor_id, 'fornecedor_id')
      const vinculos = Array.isArray(body.vinculos) ? body.vinculos : []
      if (vinculos.length === 0) throw new HttpError(400, 'Informe ao menos 1 vínculo De-Para.')

      await conn.db.transaction(async (tx) => {
        for (const v of vinculos) {
          const codForn = String(v.codigo_fornecedor || '').trim()
          if (!codForn) continue
          const prodId = parseUuidOrBadRequest(v.produto_id, 'produto_id')
          await tx
            .insert(fornecedorProdutoDepara)
            .values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              fornecedorId,
              codigoFornecedor: codForn,
              descricaoFornecedor: String(v.descricao_fornecedor || '').trim(),
              ncm: String(v.ncm || '').trim(),
              produtoId: prodId,
              fatorConversao: toDec(toNum(v.fator_conversao, 1) || 1, 4),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                fornecedorProdutoDepara.tenantId,
                fornecedorProdutoDepara.fornecedorId,
                fornecedorProdutoDepara.codigoFornecedor,
              ],
              set: {
                produtoId: prodId,
                descricaoFornecedor: String(v.descricao_fornecedor || '').trim(),
                ncm: String(v.ncm || '').trim(),
                fatorConversao: toDec(toNum(v.fator_conversao, 1) || 1, 4),
                updatedAt: new Date(),
              },
            })
        }
      })

      return { success: true }
    },
  )

  app.delete(
    '/api/compras/depara/:id',
    { preHandler: requirePermission(['compras', 'recebimento', 'fornecedores']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'depara_id')
      await conn.db
        .delete(fornecedorProdutoDepara)
        .where(and(eq(fornecedorProdutoDepara.id, id), eq(fornecedorProdutoDepara.tenantId, ctx.tenantId)))
      return { success: true }
    },
  )

  // ── PRÉ-VISUALIZAÇÃO DE XML NF-e DE ENTRADA ─────────────────────────────────
  app.post(
    '/api/compras/xml/parse-preview',
    { preHandler: requirePermission(['compras', 'recebimento']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        xml_conteudo?: string
        fornecedor_id?: string | null
        pedido_compra_id?: string | null
      }
      const xmlRaw = String(body.xml_conteudo || '').trim()
      if (!xmlRaw) throw new HttpError(400, 'Cole ou selecione o conteúdo do arquivo XML da NF-e.')

      let parsed
      try {
        parsed = parseNfeXml(xmlRaw)
      } catch (err: any) {
        throw new HttpError(400, err?.message || 'Não foi possível ler o XML informado.')
      }

      let fornecedorMatch = null
      if (body.fornecedor_id) {
        const fid = parseUuidOrBadRequest(body.fornecedor_id, 'fornecedor_id')
        const [f] = await conn.db
          .select()
          .from(fornecedores)
          .where(and(eq(fornecedores.id, fid), eq(fornecedores.tenantId, ctx.tenantId)))
          .limit(1)
        fornecedorMatch = f || null
      }
      if (!fornecedorMatch && parsed.emitente.cnpj) {
        const allForn = await conn.db
          .select()
          .from(fornecedores)
          .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
        fornecedorMatch =
          allForn.find((f) => f.cnpjCpf.replace(/\D/g, '') === parsed.emitente.cnpj) || null
      }

      let pcItensMap = new Map<string, { qtd: number; preco: number }>()
      if (body.pedido_compra_id) {
        const pcId = parseUuidOrBadRequest(body.pedido_compra_id, 'pedido_compra_id')
        const pcIts = await conn.db
          .select()
          .from(pedidosCompraItens)
          .where(eq(pedidosCompraItens.pedidoCompraId, pcId))
        for (const it of pcIts) {
          pcItensMap.set(it.produtoId, {
            qtd: toNum(it.qtdKgSolicitada, 0),
            preco: toNum(it.precoUnitarioKg, 0),
          })
        }
      }

      const { resolverProduto } = await carregarMapaProdutosEDepara(conn.db, ctx.tenantId, fornecedorMatch?.id)
      const extrasTotais = Math.max(
        0,
        parsed.totais.valor_frete + parsed.totais.valor_outras + parsed.totais.valor_ipi + parsed.totais.valor_st - parsed.totais.valor_desconto,
      )
      const baseProd = parsed.totais.valor_produtos > 0 ? parsed.totais.valor_produtos : parsed.itens.reduce((s, i) => s + i.valor_total, 0)

      const itens = parsed.itens.map((it) => {
        const res = resolverProduto(it.codigo_fornecedor, it.ean)
        const rateioExtra = baseProd > 0 ? (it.valor_total / baseProd) * extrasTotais : 0
        const custoComFrete =
          it.quantidade > 0 ? Number(((it.valor_total + rateioExtra) / it.quantidade).toFixed(4)) : it.valor_unitario
        const pcRef = res.produto ? pcItensMap.get(res.produto.id) || null : null
        const difPrecoPct =
          pcRef && pcRef.preco > 0
            ? Number((((it.valor_unitario - pcRef.preco) / pcRef.preco) * 100).toFixed(2))
            : null
        return {
          ...it,
          produto_sugerido_id: res.produto?.id || null,
          produto_sugerido_codigo: res.produto?.codigo || null,
          produto_sugerido_descricao: res.produto?.descricao || null,
          origem_vinculo: res.origem_vinculo,
          custo_unitario_com_frete: custoComFrete,
          pc_qtd_solicitada: pcRef?.qtd ?? null,
          pc_preco_unitario: pcRef?.preco ?? null,
          divergencia_preco_pct: difPrecoPct,
        }
      })

      return {
        success: true,
        nfe: {
          ...parsed,
          itens,
        },
        fornecedor_encontrado: fornecedorMatch
          ? {
              id: fornecedorMatch.id,
              razao_social: fornecedorMatch.razaoSocial,
              nome_fantasia: fornecedorMatch.nomeFantasia,
              cnpj_cpf: fornecedorMatch.cnpjCpf,
              uf: fornecedorMatch.uf,
            }
          : null,
      }
    },
  )

  // ── PRÉ-VISUALIZAÇÃO EM LOTE DE MÚLTIPLOS TXTs DE ETIQUETAS ──────────────────
  app.post(
    '/api/compras/txt/parse-preview',
    { preHandler: requirePermission(['compras', 'recebimento']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        arquivos?: Array<{ nome: string; conteudo: string }>
        layout_id?: string | null
        fornecedor_id?: string | null
        pedido_compra_id?: string | null
      }
      const arquivos = Array.isArray(body.arquivos) ? body.arquivos.filter((a) => a?.conteudo) : []
      if (arquivos.length === 0) throw new HttpError(400, 'Selecione ao menos 1 arquivo TXT para leitura.')

      let fornecedorIdFinal = body.fornecedor_id ? parseUuidOrBadRequest(body.fornecedor_id, 'fornecedor_id') : null
      if (!fornecedorIdFinal && body.pedido_compra_id) {
        const pcId = parseUuidOrBadRequest(body.pedido_compra_id, 'pedido_compra_id')
        const [pc] = await conn.db
          .select({ fornecedorId: pedidosCompra.fornecedorId })
          .from(pedidosCompra)
          .where(eq(pedidosCompra.id, pcId))
          .limit(1)
        fornecedorIdFinal = pc?.fornecedorId || null
      }

      let layoutRow = null
      if (body.layout_id) {
        const lid = parseUuidOrBadRequest(body.layout_id, 'layout_id')
        const [lr] = await conn.db
          .select()
          .from(layoutsImportacaoTxt)
          .where(and(eq(layoutsImportacaoTxt.id, lid), eq(layoutsImportacaoTxt.tenantId, ctx.tenantId)))
          .limit(1)
        layoutRow = lr || null
      } else {
        const [lr] = await conn.db
          .select()
          .from(layoutsImportacaoTxt)
          .where(and(eq(layoutsImportacaoTxt.tenantId, ctx.tenantId), eq(layoutsImportacaoTxt.ativo, 1)))
          .orderBy(asc(layoutsImportacaoTxt.createdAt))
          .limit(1)
        layoutRow = lr || null
      }

      const parsed = parseTxtEtiquetasBatch(
        arquivos,
        layoutRow
          ? {
              tipo_arquivo: layoutRow.tipoArquivo,
              delimitador: layoutRow.delimitador,
              saltar_linhas: layoutRow.saltarLinhas,
              formato_data: layoutRow.formatoData,
              decimal_ponto: layoutRow.decimalPonto,
              mapeamento_json: layoutRow.mapeamentoJson,
            }
          : {},
      )

      const { resolverProduto } = await carregarMapaProdutosEDepara(conn.db, ctx.tenantId, fornecedorIdFinal)

      // Verificar EANs já existentes em estoque_caixas ou recebimento_pre_caixas
      const eans = parsed.caixas.map((c) => c.ean_caixa)
      const jaExistemSet = new Set<string>()
      if (eans.length > 0) {
        const [inEst, inPre] = await Promise.all([
          conn.db
            .select({ ean: estoqueCaixas.eanCaixa })
            .from(estoqueCaixas)
            .where(and(eq(estoqueCaixas.tenantId, ctx.tenantId), inArray(estoqueCaixas.eanCaixa, eans))),
          conn.db
            .select({ ean: recebimentoPreCaixas.eanCaixa })
            .from(recebimentoPreCaixas)
            .where(and(eq(recebimentoPreCaixas.tenantId, ctx.tenantId), inArray(recebimentoPreCaixas.eanCaixa, eans))),
        ])
        for (const r of [...inEst, ...inPre]) jaExistemSet.add(r.ean)
      }

      const gruposCod = new Map<
        string,
        {
          codigo_fornecedor: string
          descricao_fornecedor: string
          qtd_caixas: number
          qtd_novas: number
          peso_kg: number
          qtd_pecas: number
          produto_id: string | null
          produto_codigo: string | null
          produto_descricao: string | null
          origem_vinculo: string
        }
      >()

      let totalPeso = 0
      let totalPecas = 0
      let novasCount = 0

      const caixasPreview = parsed.caixas.map((c) => {
        const jaExiste = jaExistemSet.has(c.ean_caixa)
        if (!jaExiste) novasCount += 1
        totalPeso += c.peso_liquido_kg
        totalPecas += c.qtd_pecas || 0

        const res = resolverProduto(c.codigo_produto_fornecedor, '')
        const gKey = c.codigo_produto_fornecedor.trim().toUpperCase()
        const g = gruposCod.get(gKey) || {
          codigo_fornecedor: c.codigo_produto_fornecedor,
          descricao_fornecedor: c.descricao_produto_fornecedor,
          qtd_caixas: 0,
          qtd_novas: 0,
          peso_kg: 0,
          qtd_pecas: 0,
          produto_id: res.produto?.id || null,
          produto_codigo: res.produto?.codigo || null,
          produto_descricao: res.produto?.descricao || null,
          origem_vinculo: res.origem_vinculo,
        }
        g.qtd_caixas += 1
        if (!jaExiste) g.qtd_novas += 1
        g.peso_kg = Number((g.peso_kg + c.peso_liquido_kg).toFixed(3))
        g.qtd_pecas += c.qtd_pecas || 0
        gruposCod.set(gKey, g)

        return {
          ...c,
          ja_no_sistema: jaExiste,
          produto_id: res.produto?.id || null,
          produto_descricao: res.produto?.descricao || null,
          origem_vinculo: res.origem_vinculo,
        }
      })

      return {
        success: true,
        resumo: {
          arquivos_lidos: arquivos.length,
          total_linhas_lidas: parsed.total_linhas_lidas,
          total_unicas: parsed.caixas.length,
          caixas_novas: novasCount,
          ja_no_sistema: jaExistemSet.size,
          duplicadas_ignoradas: parsed.duplicadas_ignoradas,
          total_peso_kg: Number(totalPeso.toFixed(3)),
          total_pecas: totalPecas,
          linhas_invalidas: parsed.linhas_invalidas,
        },
        codigos_encontrados: Array.from(gruposCod.values()),
        caixas: caixasPreview,
      }
    },
  )

  // ── IMPORTAR LOTE COMPLETO (TXT(s) e/ou XML NF-e) ───────────────────────────
  app.post(
    '/api/compras/importar-lote',
    { preHandler: requirePermission(['compras', 'recebimento']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        pedido_compra_id?: string | null
        fornecedor_id?: string | null
        auto_cadastrar_fornecedor?: boolean
        xml_conteudo?: string
        txts?: Array<{ nome: string; conteudo: string }>
        layout_id?: string | null
        depara_vinculos?: Array<{
          codigo_fornecedor: string
          descricao_fornecedor?: string
          ncm?: string
          produto_id: string
          fator_conversao?: number
        }>
        modo_entrada?: 'PRE_RECEBIMENTO' | 'DIRETO_ESTOQUE'
        endereco_direto?: string
        palete_id?: string | null
      }

      const xmlRaw = String(body.xml_conteudo || '').trim()
      const txts = Array.isArray(body.txts) ? body.txts.filter((t) => t?.conteudo) : []
      if (!xmlRaw && txts.length === 0) {
        throw new HttpError(400, 'Envie ao menos 1 arquivo TXT de etiquetas ou o XML da NF-e.')
      }

      const modoEntrada = body.modo_entrada === 'DIRETO_ESTOQUE' ? 'DIRETO_ESTOQUE' : 'PRE_RECEBIMENTO'
      const enderecoFinal = String(body.endereco_direto || 'REC').trim().toUpperCase() || 'REC'

      const out = await conn.db.transaction(async (tx) => {
        const xmlParsed = xmlRaw ? parseNfeXml(xmlRaw) : null

        let pcRow: typeof pedidosCompra.$inferSelect | null = null
        if (body.pedido_compra_id) {
          const pcId = parseUuidOrBadRequest(body.pedido_compra_id, 'pedido_compra_id')
          const [pc] = await tx
            .select()
            .from(pedidosCompra)
            .where(and(eq(pedidosCompra.id, pcId), eq(pedidosCompra.tenantId, ctx.tenantId)))
            .limit(1)
          if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')
          if (pc.status === 'CANCELADO') {
            throw new HttpError(400, `Pedido de Compra ${pc.codigo} está cancelado.`)
          }
          pcRow = pc
        }

        // 1. Resolver Fornecedor (explicit > PC > CNPJ do XML)
        let fornecedorRow: typeof fornecedores.$inferSelect | null = null
        const fornIdExplicito = body.fornecedor_id
          ? parseUuidOrBadRequest(body.fornecedor_id, 'fornecedor_id')
          : pcRow?.fornecedorId || null
        if (fornIdExplicito) {
          const [f] = await tx
            .select()
            .from(fornecedores)
            .where(and(eq(fornecedores.id, fornIdExplicito), eq(fornecedores.tenantId, ctx.tenantId)))
            .limit(1)
          fornecedorRow = f || null
        } else if (xmlParsed?.emitente.cnpj) {
          const allForn = await tx
            .select()
            .from(fornecedores)
            .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
          fornecedorRow =
            allForn.find((f) => f.cnpjCpf.replace(/\D/g, '') === xmlParsed.emitente.cnpj) || null
          if (!fornecedorRow && body.auto_cadastrar_fornecedor) {
            const newFornId = uuidv7()
            await tx.insert(fornecedores).values({
              id: newFornId,
              tenantId: ctx.tenantId,
              razaoSocial: xmlParsed.emitente.razao_social || 'FORNECEDOR XML NFE',
              nomeFantasia: xmlParsed.emitente.nome_fantasia || xmlParsed.emitente.razao_social || 'FORNECEDOR XML',
              cnpjCpf: xmlParsed.emitente.cnpj,
              inscricaoEstadual: xmlParsed.emitente.ie || '',
              uf: xmlParsed.emitente.uf || 'SP',
              cidade: xmlParsed.emitente.cidade || '',
              ativo: 1,
            })
            const [createdF] = await tx.select().from(fornecedores).where(eq(fornecedores.id, newFornId)).limit(1)
            fornecedorRow = createdF || null
          }
        }

        // 2. Salvar novos vínculos De-Para caso enviados
        if (fornecedorRow && Array.isArray(body.depara_vinculos)) {
          for (const v of body.depara_vinculos) {
            const codForn = String(v.codigo_fornecedor || '').trim()
            if (!codForn || !v.produto_id) continue
            const prodId = parseUuidOrBadRequest(v.produto_id, 'produto_id')
            await tx
              .insert(fornecedorProdutoDepara)
              .values({
                id: uuidv7(),
                tenantId: ctx.tenantId,
                fornecedorId: fornecedorRow.id,
                codigoFornecedor: codForn,
                descricaoFornecedor: String(v.descricao_fornecedor || '').trim(),
                ncm: String(v.ncm || '').trim(),
                produtoId: prodId,
                fatorConversao: toDec(toNum(v.fator_conversao, 1) || 1, 4),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  fornecedorProdutoDepara.tenantId,
                  fornecedorProdutoDepara.fornecedorId,
                  fornecedorProdutoDepara.codigoFornecedor,
                ],
                set: {
                  produtoId: prodId,
                  descricaoFornecedor: String(v.descricao_fornecedor || '').trim(),
                  ncm: String(v.ncm || '').trim(),
                  updatedAt: new Date(),
                },
              })
          }
        }

        const { resolverProduto } = await carregarMapaProdutosEDepara(tx, ctx.tenantId, fornecedorRow?.id)

        // 3. Calcular mapa de custos por produto_id (XML > Pedido de Compra > Cadastro Produto)
        const custoPorProduto = new Map<string, number>()
        if (pcRow) {
          const pcItens = await tx
            .select()
            .from(pedidosCompraItens)
            .where(eq(pedidosCompraItens.pedidoCompraId, pcRow.id))
          const pcExtra = toNum(pcRow.freteValor, 0) + toNum(pcRow.despesasValor, 0)
          const pcKgTotal = pcItens.reduce((s, i) => s + toNum(i.qtdKgSolicitada, 0), 0)
          const pcRateio = pcKgTotal > 0 ? pcExtra / pcKgTotal : 0
          for (const it of pcItens) {
            const preco = toNum(it.precoUnitarioKg, 0)
            if (preco > 0) custoPorProduto.set(it.produtoId, Number((preco + pcRateio).toFixed(4)))
          }
        }

        let xmlItensResolvidos: Array<Record<string, unknown>> = []
        if (xmlParsed) {
          const extrasXml = Math.max(
            0,
            xmlParsed.totais.valor_frete +
              xmlParsed.totais.valor_outras +
              xmlParsed.totais.valor_ipi +
              xmlParsed.totais.valor_st -
              xmlParsed.totais.valor_desconto,
          )
          const baseXml =
            xmlParsed.totais.valor_produtos > 0
              ? xmlParsed.totais.valor_produtos
              : xmlParsed.itens.reduce((s, i) => s + i.valor_total, 0)

          xmlItensResolvidos = xmlParsed.itens.map((it) => {
            const res = resolverProduto(it.codigo_fornecedor, it.ean)
            const rateio = baseXml > 0 ? (it.valor_total / baseXml) * extrasXml : 0
            const custoRealKg =
              it.quantidade > 0 ? Number(((it.valor_total + rateio) / it.quantidade).toFixed(4)) : it.valor_unitario
            if (res.produto && custoRealKg > 0) {
              custoPorProduto.set(res.produto.id, custoRealKg)
            }
            return {
              ...it,
              produto_id: res.produto?.id || null,
              produto_codigo: res.produto?.codigo || null,
              produto_descricao: res.produto?.descricao || null,
              custo_unitario_com_frete: custoRealKg,
            }
          })
        }

        // 4. Localizar ou criar Recebimento vinculando XML/PC
        let recRow: typeof recebimentos.$inferSelect | null = null
        if (pcRow) {
          const [exist] = await tx
            .select()
            .from(recebimentos)
            .where(and(eq(recebimentos.pedidoCompraId, pcRow.id), eq(recebimentos.tenantId, ctx.tenantId)))
            .limit(1)
          recRow = exist || null
        }

        if (!recRow) {
          const recId = uuidv7()
          const recCod = await gerarCodigoDocumento(tx, ctx.tenantId, 'RECEBIMENTO', 'REC', 4)
          await tx.insert(recebimentos).values({
            id: recId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo: recCod,
            pedidoCompraId: pcRow?.id || null,
            fornecedorId: fornecedorRow?.id || null,
            chaveNfe: xmlParsed?.chave_nfe || '',
            numeroNf: xmlParsed?.numero_nf || '',
            serieNf: xmlParsed?.serie || '',
            dataEmissaoNf: xmlParsed?.data_emissao || null,
            valorProdutosNf: toDec(xmlParsed?.totais.valor_produtos || 0, 2),
            valorFreteNf: toDec(xmlParsed?.totais.valor_frete || 0, 2),
            valorOutrasDespNf: toDec(xmlParsed?.totais.valor_outras || 0, 2),
            valorDescontoNf: toDec(xmlParsed?.totais.valor_desconto || 0, 2),
            valorTotalNf: toDec(xmlParsed?.totais.valor_nf || 0, 2),
            xmlItensJson: xmlItensResolvidos,
            xmlDuplicatasJson: (xmlParsed?.duplicatas || []) as unknown as Array<Record<string, unknown>>,
            xmlConteudo: xmlRaw,
            statusValidacao: txts.length > 0 ? 'AGUARDANDO_BIPAGEM' : 'AGUARDANDO_VALIDACAO_SISTEMICA',
          })
          const [criadoRec] = await tx.select().from(recebimentos).where(eq(recebimentos.id, recId)).limit(1)
          recRow = criadoRec
        } else if (xmlParsed) {
          await tx
            .update(recebimentos)
            .set({
              fornecedorId: fornecedorRow?.id || recRow.fornecedorId,
              chaveNfe: xmlParsed.chave_nfe || recRow.chaveNfe,
              numeroNf: xmlParsed.numero_nf || recRow.numeroNf,
              serieNf: xmlParsed.serie || recRow.serieNf,
              dataEmissaoNf: xmlParsed.data_emissao || recRow.dataEmissaoNf,
              valorProdutosNf: toDec(xmlParsed.totais.valor_produtos, 2),
              valorFreteNf: toDec(xmlParsed.totais.valor_frete, 2),
              valorOutrasDespNf: toDec(xmlParsed.totais.valor_outras, 2),
              valorDescontoNf: toDec(xmlParsed.totais.valor_desconto, 2),
              valorTotalNf: toDec(xmlParsed.totais.valor_nf, 2),
              xmlItensJson: xmlItensResolvidos,
              xmlDuplicatasJson: xmlParsed.duplicatas as unknown as Array<Record<string, unknown>>,
              xmlConteudo: xmlRaw,
            })
            .where(eq(recebimentos.id, recRow.id))
        }

        // 5. Se vieram TXTs, gravar pré-caixas (ou entrar direto no estoque se modo DIRETO_ESTOQUE)
        let caixasImportadas = 0
        let duplicadasIgnoradas = 0
        let pesoTotalImportado = 0

        if (txts.length > 0) {
          if (modoEntrada === 'DIRETO_ESTOQUE') {
            await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [enderecoFinal])
          }

          let layoutRow = null
          if (body.layout_id) {
            const lid = parseUuidOrBadRequest(body.layout_id, 'layout_id')
            const [lr] = await tx.select().from(layoutsImportacaoTxt).where(eq(layoutsImportacaoTxt.id, lid)).limit(1)
            layoutRow = lr || null
          } else {
            const [lr] = await tx
              .select()
              .from(layoutsImportacaoTxt)
              .where(and(eq(layoutsImportacaoTxt.tenantId, ctx.tenantId), eq(layoutsImportacaoTxt.ativo, 1)))
              .orderBy(asc(layoutsImportacaoTxt.createdAt))
              .limit(1)
            layoutRow = lr || null
          }

          const parsedBatch = parseTxtEtiquetasBatch(
            txts,
            layoutRow
              ? {
                  tipo_arquivo: layoutRow.tipoArquivo,
                  delimitador: layoutRow.delimitador,
                  saltar_linhas: layoutRow.saltarLinhas,
                  formato_data: layoutRow.formatoData,
                  decimal_ponto: layoutRow.decimalPonto,
                  mapeamento_json: layoutRow.mapeamentoJson,
                }
              : {},
          )

          duplicadasIgnoradas = parsedBatch.duplicadas_ignoradas
          const allEans = parsedBatch.caixas.map((c) => c.ean_caixa)
          const existingEans = new Set<string>()
          if (allEans.length > 0) {
            const [inEst, inPre] = await Promise.all([
              tx
                .select({ ean: estoqueCaixas.eanCaixa })
                .from(estoqueCaixas)
                .where(and(eq(estoqueCaixas.tenantId, ctx.tenantId), inArray(estoqueCaixas.eanCaixa, allEans))),
              tx
                .select({ ean: recebimentoPreCaixas.eanCaixa })
                .from(recebimentoPreCaixas)
                .where(and(eq(recebimentoPreCaixas.tenantId, ctx.tenantId), inArray(recebimentoPreCaixas.eanCaixa, allEans))),
            ])
            for (const r of [...inEst, ...inPre]) existingEans.add(r.ean)
          }

          const sifForn = fornecedorRow?.registroSanitarioSif || ''
          const paleteId = body.palete_id ? parseUuidOrBadRequest(body.palete_id, 'palete_id') : null

          for (const c of parsedBatch.caixas) {
            if (existingEans.has(c.ean_caixa)) {
              duplicadasIgnoradas += 1
              continue
            }

            const resProd = resolverProduto(c.codigo_produto_fornecedor, '')
            if (!resProd.produto) {
              throw new HttpError(
                400,
                `Código de produto "${c.codigo_produto_fornecedor}" (${c.descricao_produto_fornecedor}) ainda não possui vínculo De-Para com produto interno.`,
              )
            }
            const custoKg =
              custoPorProduto.get(resProd.produto.id) ?? toNum(resProd.produto.custo_medio_kg, 0)

            const preId = uuidv7()
            const preValues: typeof recebimentoPreCaixas.$inferInsert = {
              id: preId,
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              recebimentoId: recRow.id,
              pedidoCompraId: pcRow?.id || null,
              fornecedorId: fornecedorRow?.id || null,
              eanCaixa: c.ean_caixa,
              codigoProdutoFornecedor: c.codigo_produto_fornecedor,
              descricaoProdutoFornecedor: c.descricao_produto_fornecedor,
              produtoId: resProd.produto.id,
              pesoLiquidoKg: toDec(c.peso_liquido_kg, 3),
              pesoBrutoKg: toDec(c.peso_liquido_kg, 3),
              taraKg: '0.000',
              qtdPecas: c.qtd_pecas,
              dataProducao: c.data_producao,
              validade: c.validade,
              lote: c.lote,
              documentoOrigem: c.documento_origem || c.romaneio_origem || xmlParsed?.numero_nf || '',
              arquivoOrigem: c.arquivo_origem,
              custoUnitarioKg: toDec(custoKg, 4),
              status: 'PENDENTE',
            }

            await tx.insert(recebimentoPreCaixas).values(preValues)

            if (modoEntrada === 'DIRETO_ESTOQUE') {
              const [preInserted] = await tx
                .select()
                .from(recebimentoPreCaixas)
                .where(eq(recebimentoPreCaixas.id, preId))
                .limit(1)
              await efetivarPreCaixaNoEstoque(tx, {
                ctx,
                pre: preInserted,
                sifOrigem: sifForn,
                paleteId,
                endereco: enderecoFinal,
                forcarProdutoExtra: true,
              })
            }

            caixasImportadas += 1
            pesoTotalImportado = Number((pesoTotalImportado + c.peso_liquido_kg).toFixed(3))
          }

          if (modoEntrada === 'DIRETO_ESTOQUE' && caixasImportadas > 0) {
            await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [enderecoFinal])
          }
        }

        // Se só houve XML (ou TXT direto), também atualizar custo médio dos produtos recebidos do XML
        if (xmlParsed && modoEntrada === 'DIRETO_ESTOQUE') {
          for (const [pid, custo] of custoPorProduto.entries()) {
            if (custo > 0) {
              await tx
                .update(produtos)
                .set({ custoMedioKg: toDec(custo, 4), updatedAt: new Date() })
                .where(and(eq(produtos.id, pid), eq(produtos.tenantId, ctx.tenantId)))
            }
          }
        }

        return {
          recebimento_id: recRow.id,
          recebimento_codigo: recRow.codigo,
          numero_nf: xmlParsed?.numero_nf || recRow.numeroNf || '',
          chave_nfe: xmlParsed?.chave_nfe || recRow.chaveNfe || '',
          fornecedor_id: fornecedorRow?.id || null,
          fornecedor_nome: fornecedorRow?.nomeFantasia || null,
          modo_entrada: modoEntrada,
          caixas_importadas: caixasImportadas,
          duplicadas_ignoradas: duplicadasIgnoradas,
          peso_total_importado_kg: pesoTotalImportado,
          duplicatas_xml: xmlParsed?.duplicatas || [],
        }
      })

      return reply.code(201).send({ success: true, ...out })
    },
  )

  // ── CONFERÊNCIA / BIPAGEM ULTRA-RÁPIDA DE PRÉ-CAIXAS NA DOCA ─────────────────
  app.get(
    '/api/recebimento/pre-caixas',
    { preHandler: requirePermission(['recebimento', 'recebimento_consultar', 'compras'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { recebimento_id?: string; pedido_compra_id?: string; status?: string }
      const conds = [eq(recebimentoPreCaixas.tenantId, ctx.tenantId), eq(recebimentoPreCaixas.filialId, ctx.filialId)]
      if (q.recebimento_id) {
        conds.push(eq(recebimentoPreCaixas.recebimentoId, parseUuidOrBadRequest(q.recebimento_id, 'recebimento_id')))
      }
      if (q.pedido_compra_id) {
        conds.push(eq(recebimentoPreCaixas.pedidoCompraId, parseUuidOrBadRequest(q.pedido_compra_id, 'pedido_compra_id')))
      }
      if (q.status && q.status !== 'TODOS') {
        conds.push(eq(recebimentoPreCaixas.status, String(q.status).toUpperCase()))
      }

      const rows = await conn.db
        .select({
          id: recebimentoPreCaixas.id,
          recebimento_id: recebimentoPreCaixas.recebimentoId,
          recebimento_codigo: recebimentos.codigo,
          numero_nf: recebimentos.numeroNf,
          pedido_compra_id: recebimentoPreCaixas.pedidoCompraId,
          pedido_compra_codigo: pedidosCompra.codigo,
          fornecedor_id: recebimentoPreCaixas.fornecedorId,
          fornecedor_nome: fornecedores.nomeFantasia,
          ean_caixa: recebimentoPreCaixas.eanCaixa,
          codigo_produto_fornecedor: recebimentoPreCaixas.codigoProdutoFornecedor,
          descricao_produto_fornecedor: recebimentoPreCaixas.descricaoProdutoFornecedor,
          produto_id: recebimentoPreCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          peso_liquido_kg: recebimentoPreCaixas.pesoLiquidoKg,
          peso_bruto_kg: recebimentoPreCaixas.pesoBrutoKg,
          qtd_pecas: recebimentoPreCaixas.qtdPecas,
          data_producao: recebimentoPreCaixas.dataProducao,
          validade: recebimentoPreCaixas.validade,
          lote: recebimentoPreCaixas.lote,
          documento_origem: recebimentoPreCaixas.documentoOrigem,
          arquivo_origem: recebimentoPreCaixas.arquivoOrigem,
          custo_unitario_kg: recebimentoPreCaixas.custoUnitarioKg,
          status: recebimentoPreCaixas.status,
          bipada_em: recebimentoPreCaixas.bipadaEm,
        })
        .from(recebimentoPreCaixas)
        .leftJoin(recebimentos, eq(recebimentos.id, recebimentoPreCaixas.recebimentoId))
        .leftJoin(pedidosCompra, eq(pedidosCompra.id, recebimentoPreCaixas.pedidoCompraId))
        .leftJoin(fornecedores, eq(fornecedores.id, recebimentoPreCaixas.fornecedorId))
        .leftJoin(produtos, eq(produtos.id, recebimentoPreCaixas.produtoId))
        .where(and(...conds))
        .orderBy(asc(recebimentoPreCaixas.status), asc(recebimentoPreCaixas.eanCaixa))
        .limit(500)

      const pendentes = rows.filter((r) => r.status === 'PENDENTE').length
      const bipadas = rows.filter((r) => r.status === 'BIPADA').length

      return {
        success: true,
        resumo: {
          total: rows.length,
          pendentes,
          bipadas,
          peso_total_kg: Number(rows.reduce((s, r) => s + toNum(r.peso_liquido_kg, 0), 0).toFixed(3)),
          peso_bipada_kg: Number(
            rows.filter((r) => r.status === 'BIPADA').reduce((s, r) => s + toNum(r.peso_liquido_kg, 0), 0).toFixed(3),
          ),
        },
        data: rows.map((r) => ({
          ...r,
          peso_liquido_kg: toNum(r.peso_liquido_kg, 0),
          peso_bruto_kg: r.peso_bruto_kg != null ? toNum(r.peso_bruto_kg, 0) : null,
          custo_unitario_kg: toNum(r.custo_unitario_kg, 0),
        })),
      }
    },
  )

  app.post(
    '/api/recebimento/bipar-pre-caixa',
    { preHandler: requirePermission('recebimento') },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        ean_caixa?: string
        pedido_compra_id?: string | null
        recebimento_id?: string | null
        palete_id?: string | null
        endereco?: string
      }
      const codigo = String(body.ean_caixa || '').trim()
      if (!codigo) throw new HttpError(400, 'Bipe ou digite o código de barras da caixa.')
      const semZeros = codigo.replace(/^0+/, '') || codigo

      const out = await conn.db.transaction(async (tx) => {
        const conds = [
          eq(recebimentoPreCaixas.tenantId, ctx.tenantId),
          sql`(${recebimentoPreCaixas.eanCaixa} = ${codigo} OR LTRIM(${recebimentoPreCaixas.eanCaixa}, '0') = ${semZeros})`,
        ]
        if (body.pedido_compra_id) {
          conds.push(eq(recebimentoPreCaixas.pedidoCompraId, parseUuidOrBadRequest(body.pedido_compra_id, 'pedido_compra_id')))
        }
        if (body.recebimento_id) {
          conds.push(eq(recebimentoPreCaixas.recebimentoId, parseUuidOrBadRequest(body.recebimento_id, 'recebimento_id')))
        }

        const [pre] = await tx
          .select()
          .from(recebimentoPreCaixas)
          .where(and(...conds))
          .limit(1)
        if (!pre) {
          throw new HttpError(404, `Etiqueta "${codigo}" não encontrada nos arquivos pré-importados deste recebimento.`)
        }
        if (pre.status === 'BIPADA') {
          throw new HttpError(409, `A caixa ${pre.eanCaixa} já foi bipada e lançada no estoque!`)
        }

        const features = await lerTenantFeatures(tx, ctx.tenantId)
        if (Boolean(features.trava_recebimento_sem_pc) && !pre.pedidoCompraId && !body.pedido_compra_id) {
          throw new HttpError(400, 'Trava ativa: vincule um Pedido de Compra antes de bipar pré-caixas.')
        }

        let paleteId: string | null = body.palete_id ? parseUuidOrBadRequest(body.palete_id, 'palete_id') : null
        let endEfetivo = String(body.endereco || 'REC').trim().toUpperCase() || 'REC'
        if (paleteId) {
          const [pal] = await tx.select().from(paletes).where(eq(paletes.id, paleteId)).limit(1)
          if (!pal) throw new HttpError(404, 'Palete selecionado não encontrado.')
          if (!body.endereco) endEfetivo = pal.enderecoAtual || 'REC'
        }
        await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [endEfetivo])

        let sifForn = ''
        if (pre.fornecedorId) {
          const [f] = await tx
            .select({ sif: fornecedores.registroSanitarioSif })
            .from(fornecedores)
            .where(eq(fornecedores.id, pre.fornecedorId))
            .limit(1)
          sifForn = f?.sif || ''
        }

        const eff = await efetivarPreCaixaNoEstoque(tx, {
          ctx,
          pre,
          sifOrigem: sifForn,
          paleteId,
          endereco: endEfetivo,
          forcarProdutoExtra: true,
        })

        if (paleteId) {
          await tx
            .update(paletes)
            .set({ ultimoOperador: ctx.operador.nome })
            .where(eq(paletes.id, paleteId))
        }
        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [endEfetivo])

        const [cxFull] = await tx
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
            custo_unitario_kg: estoqueCaixas.custoUnitarioKg,
          })
          .from(estoqueCaixas)
          .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
          .where(eq(estoqueCaixas.id, eff.caixaId))
          .limit(1)

        return normalizeCaixaRow(cxFull!)
      })

      return reply.code(201).send({ success: true, caixa: out })
    },
  )

  app.post(
    '/api/recebimento/confirmar-pre-caixas-lote',
    { preHandler: requirePermission(['recebimento', 'compras']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        recebimento_id?: string
        pre_caixa_ids?: string[]
        endereco?: string
        palete_id?: string | null
      }
      const endEfetivo = String(body.endereco || 'REC').trim().toUpperCase() || 'REC'
      const paleteId = body.palete_id ? parseUuidOrBadRequest(body.palete_id, 'palete_id') : null

      const res = await conn.db.transaction(async (tx) => {
        await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [endEfetivo])
        const conds = [eq(recebimentoPreCaixas.tenantId, ctx.tenantId), eq(recebimentoPreCaixas.status, 'PENDENTE')]
        if (body.recebimento_id) {
          conds.push(eq(recebimentoPreCaixas.recebimentoId, parseUuidOrBadRequest(body.recebimento_id, 'recebimento_id')))
        }
        if (Array.isArray(body.pre_caixa_ids) && body.pre_caixa_ids.length > 0) {
          conds.push(
            inArray(
              recebimentoPreCaixas.id,
              body.pre_caixa_ids.map((id) => parseUuidOrBadRequest(id, 'pre_caixa_id')),
            ),
          )
        }
        const lista = await tx.select().from(recebimentoPreCaixas).where(and(...conds))
        if (lista.length === 0) throw new HttpError(400, 'Nenhuma pré-caixa pendente encontrada para confirmar.')

        const sifs = new Map<string, string>()
        let confirmadas = 0
        let pesoKg = 0
        for (const pre of lista) {
          let sif = ''
          if (pre.fornecedorId) {
            if (!sifs.has(pre.fornecedorId)) {
              const [f] = await tx
                .select({ sif: fornecedores.registroSanitarioSif })
                .from(fornecedores)
                .where(eq(fornecedores.id, pre.fornecedorId))
                .limit(1)
              sifs.set(pre.fornecedorId, f?.sif || '')
            }
            sif = sifs.get(pre.fornecedorId) || ''
          }
          const eff = await efetivarPreCaixaNoEstoque(tx, {
            ctx,
            pre,
            sifOrigem: sif,
            paleteId,
            endereco: endEfetivo,
            forcarProdutoExtra: true,
          })
          confirmadas += 1
          pesoKg = Number((pesoKg + eff.pesoLiq).toFixed(3))
        }
        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [endEfetivo])
        return { confirmadas, peso_kg: pesoKg }
      })

      return { success: true, ...res }
    },
  )
}
