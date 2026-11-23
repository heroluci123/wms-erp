import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  empresas,
  estoqueCaixas,
  filiais,
  financeiroTitulos,
  formasPagamento,
  fornecedorProdutoDepara,
  fornecedores,
  insumosColetas,
  insumosEstoque,
  layoutsImportacaoTxt,
  paletes,
  pedidosCompra,
  pedidosCompraItens,
  produtos,
  recebimentoPreCaixas,
  recebimentos,
  varejoEstoque,
  varejoMovimentacoes,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { gerarTitulosCompraOuXml } from '../financeiro/integracaoHelper.js'
import {
  assertEnderecosNaoBloqueados,
  type DbOrTx,
  gerarCodigoDocumento,
  hojeIsoLocal,
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
import { gerarProximoCodigoCadastro } from '../cadastros/codigoHelper.js'

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
    pedidoCompraIdOverride?: string | null
    recebimentoIdOverride?: string | null
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

  const pcIdEfetivo = params.pedidoCompraIdOverride || pre.pedidoCompraId || null
  const recIdEfetivo = params.recebimentoIdOverride || pre.recebimentoId || null

  let pcItemMatchId: string | null = null
  let custoPcFallback = 0
  if (pcIdEfetivo) {
    const [pcRow] = await tx
      .select()
      .from(pedidosCompra)
      .where(and(eq(pedidosCompra.id, pcIdEfetivo), eq(pedidosCompra.tenantId, ctx.tenantId)))
      .limit(1)
    const pcItensAll = await tx
      .select()
      .from(pedidosCompraItens)
      .where(eq(pedidosCompraItens.pedidoCompraId, pcIdEfetivo))
    const pcItem = pcItensAll.find((i) => i.produtoId === pre.produtoId)
    if (pcItem) {
      pcItemMatchId = pcItem.id
      const basePreco = toNum(pcItem.precoUnitarioKg, 0)
      const extrasPc = pcRow ? toNum(pcRow.freteValor, 0) + toNum(pcRow.despesasValor, 0) : 0
      const kgTotalPc = pcItensAll.reduce((s, i) => s + toNum(i.qtdKgSolicitada, 0), 0)
      const rateioPc = kgTotalPc > 0 ? extrasPc / kgTotalPc : 0
      custoPcFallback = basePreco > 0 ? Number((basePreco + rateioPc).toFixed(4)) : 0
    } else if (!params.forcarProdutoExtra) {
      throw new HttpError(
        400,
        `O produto da caixa ${pre.eanCaixa} (${pre.descricaoProdutoFornecedor || pre.codigoProdutoFornecedor}) não consta no Pedido de Compra ${pcRow?.codigo || ''}.`,
      )
    }
  }

  const pesoLiq = toNum(pre.pesoLiquidoKg, 0)
  const taraKg = toNum(pre.taraKg, 0)
  const pesoBruto = pre.pesoBrutoKg != null ? toNum(pre.pesoBrutoKg, pesoLiq + taraKg) : Number((pesoLiq + taraKg).toFixed(3))
  const custoPre = toNum(pre.custoUnitarioKg, 0)
  const custoKg =
    !pre.recebimentoId && custoPcFallback > 0
      ? custoPcFallback
      : custoPre > 0
        ? custoPre
        : custoPcFallback
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
    recebimentoId: recIdEfetivo,
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
    .set({
      status: 'BIPADA',
      caixaEstoqueId: caixaId,
      pedidoCompraId: pcIdEfetivo,
      recebimentoId: recIdEfetivo,
      custoUnitarioKg: toDec(custoKg, 4),
      bipadaEm: now,
    })
    .where(eq(recebimentoPreCaixas.id, pre.id))

  if (pcItemMatchId && pcIdEfetivo) {
    await tx
      .update(pedidosCompraItens)
      .set({
        qtdKgRecebida: sql`${pedidosCompraItens.qtdKgRecebida} + ${toDec(pesoLiq, 3)}`,
      })
      .where(eq(pedidosCompraItens.id, pcItemMatchId))
    await tx
      .update(pedidosCompra)
      .set({ status: 'PARCIAL', updatedAt: now })
      .where(and(eq(pedidosCompra.id, pcIdEfetivo), eq(pedidosCompra.status, 'APROVADO')))
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
    { preHandler: requirePermission(['fiscal', 'compras', 'recebimento']) },
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
      if (txts.length > 0 && body.modo_entrada === 'DIRETO_ESTOQUE') {
        throw new HttpError(
          400,
          'Entrada direta sem bipar está desativada. Arquivos TXT vão sempre para o banco de Pré-Recebimento (aguardando bipagem na doca em cima de um Pedido de Compra).',
        )
      }

      const modoEntrada = txts.length > 0 ? 'PRE_RECEBIMENTO' : (body.modo_entrada === 'DIRETO_ESTOQUE' ? 'DIRETO_ESTOQUE' : 'PRE_RECEBIMENTO')
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
            const autoCodigo = await gerarProximoCodigoCadastro(tx, ctx.tenantId, 'fornecedor')
            await tx.insert(fornecedores).values({
              id: newFornId,
              tenantId: ctx.tenantId,
              codigo: autoCodigo,
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

        // 4. Localizar ou criar Recebimento apenas quando há Pedido de Compra ou XML NF-e vinculado
        // (Quando importa só TXTs pelo fornecedor, fica no banco universal do fornecedor com recebimentoId/pedidoCompraId = null)
        let recRow: typeof recebimentos.$inferSelect | null = null
        if (pcRow) {
          const [exist] = await tx
            .select()
            .from(recebimentos)
            .where(and(eq(recebimentos.pedidoCompraId, pcRow.id), eq(recebimentos.tenantId, ctx.tenantId)))
            .limit(1)
          recRow = exist || null
        }

        if (!recRow && (pcRow || xmlParsed)) {
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
        } else if (recRow && xmlParsed) {
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

        // 5. Se vieram TXTs, gravar sempre no banco de Pré-Caixas aguardando bipagem na doca
        let caixasImportadas = 0
        let duplicadasIgnoradas = 0
        let pesoTotalImportado = 0

        if (txts.length > 0) {
          if (!fornecedorRow) {
            throw new HttpError(400, 'Selecione o Fornecedor antes de importar arquivos TXT de etiquetas.')
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
              custoPorProduto.get(resProd.produto.id) ??
              (pcRow ? toNum(resProd.produto.custo_medio_kg, 0) : 0)

            const preId = uuidv7()
            const preValues: typeof recebimentoPreCaixas.$inferInsert = {
              id: preId,
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              recebimentoId: recRow?.id || null,
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

            caixasImportadas += 1
            pesoTotalImportado = Number((pesoTotalImportado + c.peso_liquido_kg).toFixed(3))
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

        // Gera títulos automáticos no Contas a Pagar quando houver XML NF-e importado
        if (xmlParsed && recRow?.id) {
          await gerarTitulosCompraOuXml(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            recebimentoId: recRow.id,
            pedidoCompraId: pcRow?.id || null,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }

        return {
          recebimento_id: recRow?.id || null,
          recebimento_codigo: recRow?.codigo || 'BANCO-TXT',
          numero_nf: xmlParsed?.numero_nf || recRow?.numeroNf || '',
          chave_nfe: xmlParsed?.chave_nfe || recRow?.chaveNfe || '',
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
      const q = req.query as { recebimento_id?: string; pedido_compra_id?: string; fornecedor_id?: string; status?: string }
      const conds = [eq(recebimentoPreCaixas.tenantId, ctx.tenantId), eq(recebimentoPreCaixas.filialId, ctx.filialId)]
      if (q.recebimento_id) {
        conds.push(eq(recebimentoPreCaixas.recebimentoId, parseUuidOrBadRequest(q.recebimento_id, 'recebimento_id')))
      }
      if (q.fornecedor_id) {
        conds.push(eq(recebimentoPreCaixas.fornecedorId, parseUuidOrBadRequest(q.fornecedor_id, 'fornecedor_id')))
      }
      if (q.pedido_compra_id) {
        const pcId = parseUuidOrBadRequest(q.pedido_compra_id, 'pedido_compra_id')
        const [pcRow] = await conn.db
          .select({ id: pedidosCompra.id, fornecedorId: pedidosCompra.fornecedorId })
          .from(pedidosCompra)
          .where(and(eq(pedidosCompra.id, pcId), eq(pedidosCompra.tenantId, ctx.tenantId)))
          .limit(1)
        if (pcRow && pcRow.fornecedorId) {
          conds.push(
            or(
              eq(recebimentoPreCaixas.pedidoCompraId, pcId),
              and(isNull(recebimentoPreCaixas.pedidoCompraId), eq(recebimentoPreCaixas.fornecedorId, pcRow.fornecedorId)),
            )!,
          )
        } else {
          conds.push(eq(recebimentoPreCaixas.pedidoCompraId, pcId))
        }
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
        forcar_produto_extra?: boolean
      }
      const codigo = String(body.ean_caixa || '').trim()
      if (!codigo) throw new HttpError(400, 'Bipe ou digite o código de barras da caixa.')
      const semZeros = codigo.replace(/^0+/, '') || codigo

      const out = await conn.db.transaction(async (tx) => {
        let pcRow: typeof pedidosCompra.$inferSelect | null = null
        let recIdPc: string | null = body.recebimento_id
          ? parseUuidOrBadRequest(body.recebimento_id, 'recebimento_id')
          : null

        if (body.pedido_compra_id) {
          const pcId = parseUuidOrBadRequest(body.pedido_compra_id, 'pedido_compra_id')
          const [pc] = await tx
            .select()
            .from(pedidosCompra)
            .where(and(eq(pedidosCompra.id, pcId), eq(pedidosCompra.tenantId, ctx.tenantId)))
            .limit(1)
          if (!pc) throw new HttpError(404, 'Pedido de Compra não encontrado.')
          if (!['APROVADO', 'PARCIAL'].includes(pc.status)) {
            throw new HttpError(400, `Pedido ${pc.codigo} está "${pc.status}" e não aceita recebimento.`)
          }
          pcRow = pc

          // Verificar se há TXT disponível para o fornecedor/pedido antes de aceitar bipagem no modo TXT
          const [poolRow] = await tx
            .select({ id: recebimentoPreCaixas.id })
            .from(recebimentoPreCaixas)
            .where(
              and(
                eq(recebimentoPreCaixas.tenantId, ctx.tenantId),
                eq(recebimentoPreCaixas.status, 'PENDENTE'),
                or(
                  eq(recebimentoPreCaixas.pedidoCompraId, pc.id),
                  ...(pc.fornecedorId
                    ? [and(isNull(recebimentoPreCaixas.pedidoCompraId), eq(recebimentoPreCaixas.fornecedorId, pc.fornecedorId))]
                    : []),
                )!,
              ),
            )
            .limit(1)
          if (!poolRow) {
            // Checar se já foi bipada antes para devolver 409 claro
            const [jaBip] = await tx
              .select({ id: recebimentoPreCaixas.id, ean: recebimentoPreCaixas.eanCaixa })
              .from(recebimentoPreCaixas)
              .where(
                and(
                  eq(recebimentoPreCaixas.tenantId, ctx.tenantId),
                  eq(recebimentoPreCaixas.status, 'BIPADA'),
                  sql`(${recebimentoPreCaixas.eanCaixa} = ${codigo} OR LTRIM(${recebimentoPreCaixas.eanCaixa}, '0') = ${semZeros})`,
                ),
              )
              .limit(1)
            if (jaBip) {
              throw new HttpError(409, `A caixa ${jaBip.ean} já foi bipada e lançada no estoque!`)
            }
            throw new HttpError(
              400,
              `Não há arquivos TXT pré-importados pendentes para este fornecedor/pedido (${pc.codigo}). Importe os TXTs em Compras ou utilize Pesagem Manual / Balança.`,
            )
          }
        }

        const conds = [
          eq(recebimentoPreCaixas.tenantId, ctx.tenantId),
          sql`(${recebimentoPreCaixas.eanCaixa} = ${codigo} OR LTRIM(${recebimentoPreCaixas.eanCaixa}, '0') = ${semZeros})`,
        ]
        if (pcRow) {
          conds.push(
            or(
              eq(recebimentoPreCaixas.pedidoCompraId, pcRow.id),
              ...(pcRow.fornecedorId
                ? [and(isNull(recebimentoPreCaixas.pedidoCompraId), eq(recebimentoPreCaixas.fornecedorId, pcRow.fornecedorId))]
                : []),
            )!,
          )
        } else if (body.recebimento_id) {
          conds.push(eq(recebimentoPreCaixas.recebimentoId, parseUuidOrBadRequest(body.recebimento_id, 'recebimento_id')))
        }

        const [pre] = await tx
          .select()
          .from(recebimentoPreCaixas)
          .where(and(...conds))
          .limit(1)
        if (!pre) {
          throw new HttpError(
            404,
            `Etiqueta "${codigo}" não encontrada no banco de arquivos TXT pré-importados deste fornecedor.`,
          )
        }
        if (pre.status === 'BIPADA') {
          throw new HttpError(409, `A caixa ${pre.eanCaixa} já foi bipada e lançada no estoque!`)
        }

        const features = await lerTenantFeatures(tx, ctx.tenantId)
        if (Boolean(features.trava_recebimento_sem_pc) && !pre.pedidoCompraId && !pcRow) {
          throw new HttpError(400, 'Selecione um Pedido de Compra liberado antes de bipar caixas na doca.')
        }

        if (pcRow && !recIdPc) {
          const [recEx] = await tx
            .select({ id: recebimentos.id })
            .from(recebimentos)
            .where(and(eq(recebimentos.pedidoCompraId, pcRow.id), eq(recebimentos.tenantId, ctx.tenantId)))
            .limit(1)
          if (recEx) {
            recIdPc = recEx.id
          } else {
            recIdPc = uuidv7()
            const recCod = await gerarCodigoDocumento(tx, ctx.tenantId, 'RECEBIMENTO', 'REC', 4)
            await tx.insert(recebimentos).values({
              id: recIdPc,
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              codigo: recCod,
              pedidoCompraId: pcRow.id,
              fornecedorId: pcRow.fornecedorId,
              statusValidacao: 'AGUARDANDO_BIPAGEM',
            })
          }
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
        const fornLookupId = pcRow?.fornecedorId || pre.fornecedorId
        if (fornLookupId) {
          const [f] = await tx
            .select({ sif: fornecedores.registroSanitarioSif })
            .from(fornecedores)
            .where(eq(fornecedores.id, fornLookupId))
            .limit(1)
          sifForn = f?.sif || ''
        }

        const eff = await efetivarPreCaixaNoEstoque(tx, {
          ctx,
          pre,
          sifOrigem: sifForn,
          paleteId,
          endereco: endEfetivo,
          pedidoCompraIdOverride: pcRow?.id || pre.pedidoCompraId,
          recebimentoIdOverride: recIdPc || pre.recebimentoId,
          forcarProdutoExtra: Boolean(body.forcar_produto_extra),
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
            registro_dipoa: produtos.registroDipoa,
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

  // ── HELPER: GERAR XML NF-e 4.00 REALISTA DE COMPRA P/ TESTE A PARTIR DE UM PC ──
  function escXml(v: string): string {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function calcularDvChave43(base43: string): string {
    let peso = 2
    let soma = 0
    for (let i = base43.length - 1; i >= 0; i--) {
      soma += Number(base43[i]) * peso
      peso = peso === 9 ? 2 : peso + 1
    }
    const mod = soma % 11
    return String(mod < 2 ? 0 : 11 - mod)
  }

  function gerarXmlCompraSimulado(params: {
    numeroNf: number
    serie: number
    dataEmissaoIso: string
    emitente: { cnpj: string; razaoSocial: string; nomeFantasia: string; ie: string; cidade: string; uf: string }
    destinatario: { cnpj: string; razaoSocial: string; uf: string }
    itens: Array<{ codigo: string; descricao: string; ncm: string; qtdKg: number; precoUnit: number }>
    freteValor: number
    diasParcelas: number[]
    pcCodigo: string
  }) {
    const cnpjEmit = (params.emitente.cnpj.replace(/\D/g, '') || '12345678000199').padStart(14, '0').slice(0, 14)
    const cnpjDest = (params.destinatario.cnpj.replace(/\D/g, '') || '54142043000130').padStart(14, '0').slice(0, 14)
    const aamm = `${params.dataEmissaoIso.slice(2, 4)}${params.dataEmissaoIso.slice(5, 7)}`
    const cNF = String(Math.floor(10000000 + Math.random() * 89999999))
    const nNF = String(params.numeroNf).padStart(9, '0')
    const seriePad = String(params.serie).padStart(3, '0')
    const base43 = `35${aamm}${cnpjEmit}55${seriePad}${nNF}1${cNF}`
    const chave44 = `${base43}${calcularDvChave43(base43)}`

    const vProdTotal = Number(
      params.itens.reduce((s, it) => s + Number((it.qtdKg * it.precoUnit).toFixed(2)), 0).toFixed(2),
    )
    const vFrete = Number(Math.max(0, params.freteValor || 0).toFixed(2))
    const vNfTotal = Number((vProdTotal + vFrete).toFixed(2))

    const baseMs = new Date(`${params.dataEmissaoIso}T12:00:00Z`).getTime()
    const diasList = params.diasParcelas.length > 0 ? params.diasParcelas : [14, 28]
    let somaDup = 0
    const dupsXml = diasList
      .map((dias, idx) => {
        const isLast = idx === diasList.length - 1
        const vDup = isLast
          ? Number((vNfTotal - somaDup).toFixed(2))
          : Number((vNfTotal / diasList.length).toFixed(2))
        somaDup += vDup
        const dVenc = new Date(baseMs + Number(dias || 0) * 86_400_000).toISOString().slice(0, 10)
        return `        <dup><nDup>${String(idx + 1).padStart(3, '0')}</nDup><dVenc>${dVenc}</dVenc><vDup>${vDup.toFixed(2)}</vDup></dup>`
      })
      .join('\n')

    const detsXml = params.itens
      .map((it, idx) => {
        const vItem = Number((it.qtdKg * it.precoUnit).toFixed(2))
        const freteItem = vProdTotal > 0 && vFrete > 0 ? Number(((vItem / vProdTotal) * vFrete).toFixed(2)) : 0
        const lote = `LT${params.dataEmissaoIso.replace(/-/g, '').slice(2)}`
        const validade = new Date(baseMs + 45 * 86_400_000).toISOString().slice(0, 10)
        return `      <det nItem="${idx + 1}">
        <prod>
          <cProd>${escXml(it.codigo)}</cProd>
          <cEAN>SEM GTIN</cEAN>
          <xProd>${escXml(it.descricao)}</xProd>
          <NCM>${escXml((it.ncm || '02013000').replace(/\D/g, '').padStart(8, '0').slice(0, 8))}</NCM>
          <CFOP>5101</CFOP>
          <uCom>KG</uCom>
          <qCom>${it.qtdKg.toFixed(3)}</qCom>
          <vUnCom>${it.precoUnit.toFixed(4)}</vUnCom>
          <vProd>${vItem.toFixed(2)}</vProd>
          ${freteItem > 0 ? `<vFrete>${freteItem.toFixed(2)}</vFrete>` : ''}
          <rastro>
            <nLote>${lote}</nLote>
            <qLote>${it.qtdKg.toFixed(3)}</qLote>
            <dFab>${params.dataEmissaoIso}</dFab>
            <dVal>${validade}</dVal>
          </rastro>
        </prod>
        <imposto>
          <ICMS><ICMS20><orig>0</orig><CST>20</CST><pRedBC>41.67</pRedBC><vBC>${(vItem * 0.5833).toFixed(2)}</vBC><pICMS>12.00</pICMS><vICMS>${(vItem * 0.07).toFixed(2)}</vICMS></ICMS20></ICMS>
        </imposto>
      </det>`
      })
      .join('\n')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chave44}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA DE PRODUCAO DO ESTABELECIMENTO</natOp>
        <mod>55</mod>
        <serie>${params.serie}</serie>
        <nNF>${params.numeroNf}</nNF>
        <dhEmi>${params.dataEmissaoIso}T10:30:00-03:00</dhEmi>
        <tpNF>1</tpNF>
        <tpAmb>2</tpAmb>
      </ide>
      <emit>
        <CNPJ>${cnpjEmit}</CNPJ>
        <xNome>${escXml(params.emitente.razaoSocial)}</xNome>
        <xFant>${escXml(params.emitente.nomeFantasia || params.emitente.razaoSocial)}</xFant>
        <enderEmit>
          <xMun>${escXml(params.emitente.cidade || 'SAO PAULO')}</xMun>
          <UF>${escXml(params.emitente.uf || 'SP')}</UF>
        </enderEmit>
        <IE>${escXml(params.emitente.ie || 'ISENTO')}</IE>
      </emit>
      <dest>
        <CNPJ>${cnpjDest}</CNPJ>
        <xNome>${escXml(params.destinatario.razaoSocial)}</xNome>
        <enderDest><UF>${escXml(params.destinatario.uf || 'SP')}</UF></enderDest>
      </dest>
${detsXml}
      <total>
        <ICMSTot>
          <vBC>${(vProdTotal * 0.5833).toFixed(2)}</vBC>
          <vICMS>${(vProdTotal * 0.07).toFixed(2)}</vICMS>
          <vST>0.00</vST>
          <vProd>${vProdTotal.toFixed(2)}</vProd>
          <vFrete>${vFrete.toFixed(2)}</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>0.00</vDesc>
          <vIPI>0.00</vIPI>
          <vOutro>0.00</vOutro>
          <vNF>${vNfTotal.toFixed(2)}</vNF>
        </ICMSTot>
      </total>
      <cobr>
        <fat><nFat>${params.numeroNf}</nFat><vOrig>${vNfTotal.toFixed(2)}</vOrig><vLiq>${vNfTotal.toFixed(2)}</vLiq></fat>
${dupsXml}
      </cobr>
      <infAdic>
        <infCpl>XML SIMULADO PARA TESTE DE ENTRADA FISCAL — REF. ${escXml(params.pcCodigo)}</infCpl>
      </infAdic>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <chNFe>${chave44}</chNFe>
      <nProt>1352600${String(params.numeroNf).padStart(8, '0')}</nProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`

    return {
      chave_nfe: chave44,
      numero_nf: String(params.numeroNf),
      serie: String(params.serie),
      nome_arquivo: `NFe_${params.numeroNf}_${params.pcCodigo}_TESTE.xml`,
      xml_conteudo: xml,
    }
  }

  // ── MÓDULO FISCAL: LISTAR ENTRADAS DE COMPRA (PCs PENDENTES DE NF-e + NF-es ESCRITURADAS) ──
  app.get(
    '/api/fiscal/entradas-compra',
    { preHandler: requirePermission(['fiscal', 'compras', 'financeiro'], { write: false }) },
    async (req) => {
      const ctx = req.authCtx!

      const [features, ccsAtivos, pcs, itensAll, recsAll, titsPagar] = await Promise.all([
        lerTenantFeatures(conn.db, ctx.tenantId),
        conn.db
          .select({ id: centrosCusto.id, codigo: centrosCusto.codigo, descricao: centrosCusto.descricao })
          .from(centrosCusto)
          .where(and(eq(centrosCusto.tenantId, ctx.tenantId), eq(centrosCusto.ativo, 1)))
          .orderBy(asc(centrosCusto.descricao)),
        conn.db
          .select({
            id: pedidosCompra.id,
            codigo: pedidosCompra.codigo,
            status: pedidosCompra.status,
            tipo_compra: pedidosCompra.tipoCompra,
            fornecedor_id: pedidosCompra.fornecedorId,
            fornecedor_nome: fornecedores.nomeFantasia,
            fornecedor_razao: fornecedores.razaoSocial,
            fornecedor_cnpj: fornecedores.cnpjCpf,
            fornecedor_uf: fornecedores.uf,
            forma_pagamento_id: pedidosCompra.formaPagamentoId,
            forma_pagamento_desc: formasPagamento.descricao,
            previsao_entrega: pedidosCompra.previsaoEntrega,
            valor_total: pedidosCompra.valorTotal,
            frete_valor: pedidosCompra.freteValor,
            observacoes: pedidosCompra.observacoes,
            created_at: pedidosCompra.createdAt,
          })
          .from(pedidosCompra)
          .leftJoin(fornecedores, eq(fornecedores.id, pedidosCompra.fornecedorId))
          .leftJoin(formasPagamento, eq(formasPagamento.id, pedidosCompra.formaPagamentoId))
          .where(
            and(
              eq(pedidosCompra.tenantId, ctx.tenantId),
              eq(pedidosCompra.filialId, ctx.filialId),
              inArray(pedidosCompra.status, ['APROVADO', 'PARCIAL', 'RECEBIDO', 'AGUARDANDO_VALIDACAO', 'RASCUNHO']),
            ),
          )
          .orderBy(desc(pedidosCompra.createdAt))
          .limit(120),
        conn.db
          .select({
            pedido_compra_id: pedidosCompraItens.pedidoCompraId,
            produto_id: pedidosCompraItens.produtoId,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
            qtd_kg_solicitada: pedidosCompraItens.qtdKgSolicitada,
            qtd_kg_recebida: pedidosCompraItens.qtdKgRecebida,
            preco_unitario_kg: pedidosCompraItens.precoUnitarioKg,
          })
          .from(pedidosCompraItens)
          .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
          .where(eq(pedidosCompraItens.tenantId, ctx.tenantId)),
        conn.db
          .select({
            id: recebimentos.id,
            codigo: recebimentos.codigo,
            pedido_compra_id: recebimentos.pedidoCompraId,
            pedido_compra_codigo: pedidosCompra.codigo,
            tipo_entrada: recebimentos.tipoEntrada,
            categoria_dre: recebimentos.categoriaDre,
            centro_custo_id: recebimentos.centroCustoId,
            fornecedor_id: recebimentos.fornecedorId,
            fornecedor_nome: fornecedores.nomeFantasia,
            fornecedor_razao: fornecedores.razaoSocial,
            fornecedor_cnpj: fornecedores.cnpjCpf,
            chave_nfe: recebimentos.chaveNfe,
            numero_nf: recebimentos.numeroNf,
            serie_nf: recebimentos.serieNf,
            data_emissao_nf: recebimentos.dataEmissaoNf,
            valor_produtos_nf: recebimentos.valorProdutosNf,
            valor_frete_nf: recebimentos.valorFreteNf,
            valor_desconto_nf: recebimentos.valorDescontoNf,
            valor_total_nf: recebimentos.valorTotalNf,
            xml_duplicatas_json: recebimentos.xmlDuplicatasJson,
            xml_itens_json: recebimentos.xmlItensJson,
            status_validacao: recebimentos.statusValidacao,
            created_at: recebimentos.createdAt,
          })
          .from(recebimentos)
          .leftJoin(pedidosCompra, eq(pedidosCompra.id, recebimentos.pedidoCompraId))
          .leftJoin(fornecedores, eq(fornecedores.id, recebimentos.fornecedorId))
          .where(and(eq(recebimentos.tenantId, ctx.tenantId), eq(recebimentos.filialId, ctx.filialId)))
          .orderBy(desc(recebimentos.createdAt))
          .limit(150),
        conn.db
          .select({
            id: financeiroTitulos.id,
            codigo: financeiroTitulos.codigo,
            recebimento_id: financeiroTitulos.recebimentoId,
            pedido_compra_id: financeiroTitulos.pedidoCompraId,
            status: financeiroTitulos.status,
            valor_original: financeiroTitulos.valorOriginal,
            data_vencimento: financeiroTitulos.dataVencimento,
            origem: financeiroTitulos.origem,
          })
          .from(financeiroTitulos)
          .where(
            and(
              eq(financeiroTitulos.tenantId, ctx.tenantId),
              eq(financeiroTitulos.tipo, 'PAGAR'),
              ne(financeiroTitulos.status, 'CANCELADO'),
            ),
          ),
      ])

      const pcIdsComNf = new Set(
        recsAll
          .filter((r) => Boolean(r.pedido_compra_id && (String(r.numero_nf || '').trim() || String(r.chave_nfe || '').trim())))
          .map((r) => r.pedido_compra_id!),
      )

      const itensPorPc = new Map<string, typeof itensAll>()
      for (const it of itensAll) {
        const arr = itensPorPc.get(it.pedido_compra_id) || []
        arr.push(it)
        itensPorPc.set(it.pedido_compra_id, arr)
      }

      const pedidosPendentes = pcs
        .filter((pc) => !pcIdsComNf.has(pc.id))
        .map((pc) => {
          const its = itensPorPc.get(pc.id) || []
          const totalKg = its.reduce((s, i) => s + toNum(i.qtd_kg_solicitada, 0), 0)
          return {
            ...pc,
            valor_total: toNum(pc.valor_total, 0),
            frete_valor: toNum(pc.frete_valor, 0),
            total_kg_solicitado: Number(totalKg.toFixed(3)),
            qtd_itens: its.length,
            itens: its.map((i) => ({
              ...i,
              qtd_kg_solicitada: toNum(i.qtd_kg_solicitada, 0),
              qtd_kg_recebida: toNum(i.qtd_kg_recebida, 0),
              preco_unitario_kg: toNum(i.preco_unitario_kg, 0),
            })),
          }
        })

      const notasEntrada = recsAll
        .filter((r) => Boolean(String(r.numero_nf || '').trim() || String(r.chave_nfe || '').trim()))
        .map((r) => {
          const tits = titsPagar.filter(
            (t) =>
              t.recebimento_id === r.id ||
              (r.pedido_compra_id && t.pedido_compra_id === r.pedido_compra_id && t.origem === 'COMPRA_NFE_XML'),
          )
          return {
            ...r,
            valor_produtos_nf: toNum(r.valor_produtos_nf, 0),
            valor_frete_nf: toNum(r.valor_frete_nf, 0),
            valor_desconto_nf: toNum(r.valor_desconto_nf, 0),
            valor_total_nf: toNum(r.valor_total_nf, 0),
            qtd_itens_xml: Array.isArray(r.xml_itens_json) ? r.xml_itens_json.length : 0,
            qtd_titulos_pagar: tits.length,
            valor_titulos_pagar: Number(tits.reduce((s, t) => s + toNum(t.valor_original, 0), 0).toFixed(2)),
            titulos_pagar: tits.map((t) => ({
              id: t.id,
              codigo: t.codigo,
              status: t.status,
              valor_original: toNum(t.valor_original, 0),
              data_vencimento: t.data_vencimento,
            })),
          }
        })

      return {
        success: true,
        controlar_estoque_insumos: Boolean(features.controlar_estoque_insumos),
        centros_custo: ccsAtivos,
        pedidos_pendentes: pedidosPendentes,
        notas_entrada: notasEntrada,
      }
    },
  )

  // ── MÓDULO FISCAL: ESCRITURAR NF-e DE COMPRA (XML) VINCULADA A PEDIDO DE COMPRA -> CONTAS A PAGAR ──
  app.post(
    '/api/fiscal/entradas-compra/escriturar',
    { preHandler: requirePermission(['fiscal', 'compras']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        tipo_entrada?: string // COMPRA_ESTOQUE | HIGIENE_CONSUMO_DIRETO | INSUMO_DIRETO
        pedido_compra_id?: string | null
        centro_custo_id?: string | null
        categoria_dre?: string
        xml_conteudo?: string
        chave_bipada?: string
        depara_vinculos?: Array<{
          codigo_fornecedor: string
          descricao_fornecedor?: string
          ncm?: string
          produto_id: string
          fator_conversao?: number
        }>
      }

      const tipoEntradaRaw = String(body.tipo_entrada || 'COMPRA_ESTOQUE').toUpperCase()
      const tipoEntrada =
        tipoEntradaRaw === 'HIGIENE_CONSUMO_DIRETO' || tipoEntradaRaw === 'INSUMO_DIRETO'
          ? tipoEntradaRaw
          : 'COMPRA_ESTOQUE'

      const features = await lerTenantFeatures(conn.db, ctx.tenantId)
      const controlarInsumosAtivo = Boolean(features.controlar_estoque_insumos)

      if (tipoEntrada === 'INSUMO_DIRETO' && controlarInsumosAtivo && !body.pedido_compra_id) {
        throw new HttpError(
          400,
          'O controle de estoque de Insumos está ATIVO para esta empresa. Crie e vincule um Pedido de Compra de Insumo antes de dar entrada na NF-e.',
        )
      }

      if (tipoEntrada === 'COMPRA_ESTOQUE' && !body.pedido_compra_id) {
        throw new HttpError(
          400,
          'Para dar entrada fiscal em uma NF-e de compra (estoque/revenda/empório) é obrigatório vincular a um Pedido de Compra.',
        )
      }

      const pcId = body.pedido_compra_id ? parseUuidOrBadRequest(body.pedido_compra_id, 'pedido_compra_id') : null
      const ccIdEntrada = body.centro_custo_id ? parseUuidOrBadRequest(body.centro_custo_id, 'centro_custo_id') : null
      const categoriaDreEntrada = String(body.categoria_dre || '').trim().toUpperCase()
      const xmlRaw = String(body.xml_conteudo || '').trim()
      if (!xmlRaw) {
        throw new HttpError(400, 'Selecione ou cole o arquivo XML da NF-e de compra.')
      }

      let xmlParsed
      try {
        xmlParsed = parseNfeXml(xmlRaw)
      } catch (err: any) {
        throw new HttpError(400, err?.message || 'Arquivo XML de NF-e inválido.')
      }

      const chaveBipadaLimpa = String(body.chave_bipada || '').replace(/\D/g, '')
      if (chaveBipadaLimpa) {
        if (chaveBipadaLimpa.length !== 44) {
          throw new HttpError(400, 'A chave de acesso bipada deve conter exatamente 44 dígitos.')
        }
        if (xmlParsed.chave_nfe && chaveBipadaLimpa !== xmlParsed.chave_nfe) {
          throw new HttpError(
            400,
            `Divergência de Chave de Acesso: a chave bipada (${chaveBipadaLimpa}) não corresponde à chave do XML (${xmlParsed.chave_nfe}).`,
          )
        }
      }

      const resultado = await conn.db.transaction(async (tx) => {
        let pcRow: typeof pedidosCompra.$inferSelect | null = null
        if (pcId) {
          const [foundPc] = await tx
            .select()
            .from(pedidosCompra)
            .where(and(eq(pedidosCompra.id, pcId), eq(pedidosCompra.tenantId, ctx.tenantId)))
            .limit(1)
          if (!foundPc) throw new HttpError(404, 'Pedido de Compra não encontrado.')
          if (foundPc.status === 'CANCELADO') {
            throw new HttpError(409, `Pedido de Compra ${foundPc.codigo} está CANCELADO e não pode receber NF-e.`)
          }
          pcRow = foundPc
        }

        if (xmlParsed.chave_nfe) {
          const [dupChave] = await tx
            .select({ id: recebimentos.id, codigo: recebimentos.codigo, numeroNf: recebimentos.numeroNf })
            .from(recebimentos)
            .where(
              and(
                eq(recebimentos.tenantId, ctx.tenantId),
                eq(recebimentos.chaveNfe, xmlParsed.chave_nfe),
              ),
            )
            .limit(1)
          if (dupChave) {
            throw new HttpError(
              409,
              `Esta NF-e (Nº ${dupChave.numeroNf || xmlParsed.numero_nf} / Chave ${xmlParsed.chave_nfe}) já foi escriturada no registro ${dupChave.codigo}!`,
            )
          }
        }

        // Resolver fornecedor (PC > CNPJ do XML > auto-cadastro para Entrada Direta)
        let fornecedorRow: typeof fornecedores.$inferSelect | null = null
        if (pcRow?.fornecedorId) {
          const [f] = await tx
            .select()
            .from(fornecedores)
            .where(eq(fornecedores.id, pcRow.fornecedorId))
            .limit(1)
          fornecedorRow = f || null
        }
        if (!fornecedorRow && xmlParsed.emitente.cnpj) {
          const allForn = await tx
            .select()
            .from(fornecedores)
            .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
          fornecedorRow =
            allForn.find((f) => f.cnpjCpf.replace(/\D/g, '') === xmlParsed.emitente.cnpj) || null
          if (!fornecedorRow && tipoEntrada !== 'COMPRA_ESTOQUE') {
            const novoFId = uuidv7()
            const fCod = await gerarProximoCodigoCadastro(tx, ctx.tenantId, 'fornecedor')
            await tx.insert(fornecedores).values({
              id: novoFId,
              tenantId: ctx.tenantId,
              codigo: fCod,
              razaoSocial: xmlParsed.emitente.razao_social || 'FORNECEDOR XML',
              nomeFantasia: xmlParsed.emitente.nome_fantasia || xmlParsed.emitente.razao_social || 'FORNECEDOR XML',
              cnpjCpf: xmlParsed.emitente.cnpj,
              inscricaoEstadual: xmlParsed.emitente.ie || '',
              cidade: xmlParsed.emitente.cidade || '',
              uf: xmlParsed.emitente.uf || 'SP',
              ativo: 1,
            })
            const [criadoF] = await tx.select().from(fornecedores).where(eq(fornecedores.id, novoFId)).limit(1)
            fornecedorRow = criadoF || null
          }
        }

        const ehEntradaDiretaSemEstoque = tipoEntrada === 'HIGIENE_CONSUMO_DIRETO' || tipoEntrada === 'INSUMO_DIRETO'
        let xmlItensResolvidos: Array<Record<string, unknown>> = []

        if (!ehEntradaDiretaSemEstoque) {
          // Salvar vínculos De-Para enviados pelo usuário
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

          const itensCalc = xmlParsed.itens.map((it) => {
            const res = resolverProduto(it.codigo_fornecedor, it.ean)
            const rateio = baseXml > 0 ? (it.valor_total / baseXml) * extrasXml : 0
            const custoRealKg =
              it.quantidade > 0
                ? Number(((it.valor_total + rateio) / it.quantidade).toFixed(4))
                : it.valor_unitario
            return {
              ...it,
              produto_id: res.produto?.id || null,
              produto_codigo: res.produto?.codigo || null,
              produto_descricao: res.produto?.descricao || null,
              custo_unitario_com_frete: custoRealKg,
            }
          })
          xmlItensResolvidos = itensCalc

          // Verifica se filial ativa é VAREJO (para creditar automaticamente endereço EMPORIO)
          const [filEnt] = await tx
            .select({ tipoUnidade: filiais.tipoUnidade })
            .from(filiais)
            .where(eq(filiais.id, ctx.filialId))
            .limit(1)
          const ehFilialVarejoEnt = String(filEnt?.tipoUnidade || '').toUpperCase() === 'VAREJO'

          // Atualizar último preço de compra + custo médio (+ somar saldo no almoxarifado de insumos ou Empório)
          for (const it of itensCalc) {
            if (it.produto_id && it.custo_unitario_com_frete > 0) {
              await tx
                .update(produtos)
                .set({
                  ultimoPrecoCompra: toDec(it.custo_unitario_com_frete, 4),
                  custoMedioKg: toDec(it.custo_unitario_com_frete, 4),
                  updatedAt: new Date(),
                })
                .where(and(eq(produtos.id, it.produto_id), eq(produtos.tenantId, ctx.tenantId)))
            }
            if ((pcRow?.tipoCompra === 'EMPORIO' || ehFilialVarejoEnt) && pcRow?.tipoCompra !== 'INSUMO' && it.produto_id && it.quantidade > 0) {
              const [estEmp] = await tx
                .select()
                .from(varejoEstoque)
                .where(
                  and(
                    eq(varejoEstoque.tenantId, ctx.tenantId),
                    eq(varejoEstoque.filialId, ctx.filialId),
                    eq(varejoEstoque.produtoId, it.produto_id),
                  ),
                )
                .limit(1)
              const antEmp = estEmp ? toNum(estEmp.saldoQtd, 0) : 0
              const novoEmp = Number((antEmp + it.quantidade).toFixed(3))
              if (estEmp) {
                await tx
                  .update(varejoEstoque)
                  .set({ saldoQtd: toDec(novoEmp, 3), updatedAt: new Date() })
                  .where(eq(varejoEstoque.id, estEmp.id))
              } else {
                await tx.insert(varejoEstoque).values({
                  id: uuidv7(),
                  tenantId: ctx.tenantId,
                  filialId: ctx.filialId,
                  produtoId: it.produto_id,
                  unidadeVenda: String(it.unidade || 'UN').toUpperCase() === 'KG' ? 'KG' : 'UN',
                  saldoQtd: toDec(novoEmp, 3),
                  precoVendaVarejo: '0.0000',
                  estoqueMinimo: '0.000',
                  codigoBalanca: (it.produto_codigo || '').replace(/\D/g, '').slice(-5),
                  setorLoja: 'EMPORIO',
                })
              }
              await tx.insert(varejoMovimentacoes).values({
                id: uuidv7(),
                tenantId: ctx.tenantId,
                filialId: ctx.filialId,
                produtoId: it.produto_id,
                tipo: 'ENTRADA_COMPRA',
                qtd: toDec(it.quantidade, 3),
                saldoAnterior: toDec(antEmp, 3),
                saldoNovo: toDec(novoEmp, 3),
                referenciaTipo: 'NFE_COMPRA',
                observacao: `Entrada XML NF ${xmlParsed.numero_nf}${pcRow ? ` (${pcRow.codigo})` : ''}`,
                operadorId: ctx.operador.id,
                operadorNome: ctx.operador.nome,
              })
            }
            if (pcRow?.tipoCompra === 'INSUMO' && controlarInsumosAtivo && it.produto_id && it.quantidade > 0) {
              const [insEst] = await tx
                .select()
                .from(insumosEstoque)
                .where(
                  and(
                    eq(insumosEstoque.tenantId, ctx.tenantId),
                    eq(insumosEstoque.filialId, ctx.filialId),
                    eq(insumosEstoque.produtoId, it.produto_id),
                  ),
                )
                .limit(1)
              if (insEst) {
                const ant = toNum(insEst.saldoAtual, 0)
                const novo = Number((ant + it.quantidade).toFixed(3))
                await tx
                  .update(insumosEstoque)
                  .set({
                    saldoAtual: toDec(novo, 3),
                    custoUnitario: toDec(it.custo_unitario_com_frete || toNum(insEst.custoUnitario, 0), 4),
                    updatedAt: new Date(),
                  })
                  .where(eq(insumosEstoque.id, insEst.id))
                await tx.insert(insumosColetas).values({
                  id: uuidv7(),
                  tenantId: ctx.tenantId,
                  filialId: ctx.filialId,
                  insumoEstoqueId: insEst.id,
                  produtoId: it.produto_id,
                  enderecoCodigo: insEst.enderecoCodigo,
                  tipo: 'ENTRADA_COMPRA',
                  quantidade: toDec(it.quantidade, 3),
                  saldoAnterior: toDec(ant, 3),
                  saldoNovo: toDec(novo, 3),
                  setorDestino: 'ALMOXARIFADO',
                  custoTotal: toDec(it.valor_total, 2),
                  observacao: `Entrada Fiscal NF ${xmlParsed.numero_nf} (${pcRow.codigo})`,
                  operadorId: ctx.operador.id,
                  operadorNome: ctx.operador.nome,
                })
              }
            }
          }
        } else {
          // Entrada Direta (Higiene / Uso & Consumo / Insumo Direto): não mexe em estoque nem exige De-Para
          xmlItensResolvidos = xmlParsed.itens.map((it) => ({
            ...it,
            produto_id: null,
            produto_codigo: null,
            produto_descricao: null,
            custo_unitario_com_frete: it.valor_unitario,
          }))
        }

        // Localizar ou criar registro de recebimento
        const [recExist] = pcRow
          ? await tx
              .select()
              .from(recebimentos)
              .where(and(eq(recebimentos.pedidoCompraId, pcRow.id), eq(recebimentos.tenantId, ctx.tenantId)))
              .limit(1)
          : []

        let recId = recExist?.id || ''
        let recCodigo = recExist?.codigo || ''
        const catDreFinal =
          categoriaDreEntrada ||
          (tipoEntrada === 'HIGIENE_CONSUMO_DIRETO'
            ? 'HIGIENE / USO E CONSUMO'
            : tipoEntrada === 'INSUMO_DIRETO'
              ? 'INSUMOS / EMBALAGENS'
              : '')

        if (recExist) {
          await tx
            .update(recebimentos)
            .set({
              fornecedorId: fornecedorRow?.id || recExist.fornecedorId,
              tipoEntrada,
              centroCustoId: ccIdEntrada || pcRow?.centroCustoId || recExist.centroCustoId,
              categoriaDre: catDreFinal || recExist.categoriaDre,
              chaveNfe: xmlParsed.chave_nfe || recExist.chaveNfe,
              numeroNf: xmlParsed.numero_nf || recExist.numeroNf,
              serieNf: xmlParsed.serie || recExist.serieNf,
              dataEmissaoNf: xmlParsed.data_emissao || recExist.dataEmissaoNf,
              valorProdutosNf: toDec(xmlParsed.totais.valor_produtos, 2),
              valorFreteNf: toDec(xmlParsed.totais.valor_frete, 2),
              valorOutrasDespNf: toDec(xmlParsed.totais.valor_outras, 2),
              valorDescontoNf: toDec(xmlParsed.totais.valor_desconto, 2),
              valorTotalNf: toDec(xmlParsed.totais.valor_nf, 2),
              xmlItensJson: xmlItensResolvidos,
              xmlDuplicatasJson: xmlParsed.duplicatas as unknown as Array<Record<string, unknown>>,
              xmlConteudo: xmlRaw,
              statusValidacao: 'VALIDADO',
              validadoPorId: ctx.operador.id,
              validadoAt: new Date(),
            })
            .where(eq(recebimentos.id, recExist.id))
        } else {
          recId = uuidv7()
          recCodigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'RECEBIMENTO', 'REC', 4)
          await tx.insert(recebimentos).values({
            id: recId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo: recCodigo,
            pedidoCompraId: pcRow?.id || null,
            fornecedorId: fornecedorRow?.id || null,
            tipoEntrada,
            centroCustoId: ccIdEntrada || pcRow?.centroCustoId || null,
            categoriaDre: catDreFinal,
            chaveNfe: xmlParsed.chave_nfe || '',
            numeroNf: xmlParsed.numero_nf || '',
            serieNf: xmlParsed.serie || '',
            dataEmissaoNf: xmlParsed.data_emissao || null,
            valorProdutosNf: toDec(xmlParsed.totais.valor_produtos, 2),
            valorFreteNf: toDec(xmlParsed.totais.valor_frete, 2),
            valorOutrasDespNf: toDec(xmlParsed.totais.valor_outras, 2),
            valorDescontoNf: toDec(xmlParsed.totais.valor_desconto, 2),
            valorTotalNf: toDec(xmlParsed.totais.valor_nf, 2),
            xmlItensJson: xmlItensResolvidos,
            xmlDuplicatasJson: xmlParsed.duplicatas as unknown as Array<Record<string, unknown>>,
            xmlConteudo: xmlRaw,
            statusValidacao: 'VALIDADO',
            validadoPorId: ctx.operador.id,
            validadoAt: new Date(),
          })
        }

        // Gerar títulos oficiais no Contas a Pagar pelas duplicatas do XML (substituindo previsão PC aberta)
        const qtdGerados = await gerarTitulosCompraOuXml(tx, {
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          recebimentoId: recId,
          pedidoCompraId: pcRow?.id || null,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          substituirPrevisaoPc: Boolean(pcRow),
        })

        const titulosGerados = await tx
          .select({
            id: financeiroTitulos.id,
            codigo: financeiroTitulos.codigo,
            numero_documento: financeiroTitulos.numeroDocumento,
            parcela_num: financeiroTitulos.parcelaNum,
            parcela_total: financeiroTitulos.parcelaTotal,
            data_vencimento: financeiroTitulos.dataVencimento,
            valor_original: financeiroTitulos.valorOriginal,
            status: financeiroTitulos.status,
          })
          .from(financeiroTitulos)
          .where(
            and(
              eq(financeiroTitulos.tenantId, ctx.tenantId),
              eq(financeiroTitulos.tipo, 'PAGAR'),
              eq(financeiroTitulos.recebimentoId, recId),
              ne(financeiroTitulos.status, 'CANCELADO'),
            ),
          )
          .orderBy(asc(financeiroTitulos.parcelaNum))

        return {
          recebimento_id: recId,
          recebimento_codigo: recCodigo,
          tipo_entrada: tipoEntrada,
          categoria_dre: catDreFinal,
          pedido_compra_codigo: pcRow?.codigo || 'ENTRADA DIRETA (SEM PC)',
          numero_nf: xmlParsed.numero_nf,
          serie_nf: xmlParsed.serie,
          chave_nfe: xmlParsed.chave_nfe,
          valor_total_nf: xmlParsed.totais.valor_nf,
          qtd_titulos_criados: qtdGerados,
          titulos_gerados: titulosGerados.map((t) => ({
            ...t,
            valor_original: toNum(t.valor_original, 0),
          })),
        }
      })

      return reply.code(201).send({ success: true, ...resultado })
    },
  )

  // ── MÓDULO FISCAL: GERAR XML DE NF-e DE COMPRA SIMULADO PARA TESTAR UM PC EXISTENTE ──
  app.post(
    '/api/fiscal/entradas-compra/gerar-xml-teste/:pcId',
    { preHandler: requirePermission(['fiscal', 'compras']) },
    async (req) => {
      const ctx = req.authCtx!
      const pcId = parseUuidOrBadRequest((req.params as { pcId: string }).pcId, 'pedido_compra_id')

      const [pcRow] = await conn.db
        .select()
        .from(pedidosCompra)
        .where(and(eq(pedidosCompra.id, pcId), eq(pedidosCompra.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pcRow) throw new HttpError(404, 'Pedido de Compra não encontrado.')

      const [fornRow, empRow, fpRow, itensPc] = await Promise.all([
        pcRow.fornecedorId
          ? conn.db.select().from(fornecedores).where(eq(fornecedores.id, pcRow.fornecedorId)).limit(1).then((r) => r[0] || null)
          : Promise.resolve(null),
        conn.db.select().from(empresas).where(eq(empresas.tenantId, ctx.tenantId)).limit(1).then((r) => r[0] || null),
        pcRow.formaPagamentoId
          ? conn.db.select().from(formasPagamento).where(eq(formasPagamento.id, pcRow.formaPagamentoId)).limit(1).then((r) => r[0] || null)
          : Promise.resolve(null),
        conn.db
          .select({
            codigo: produtos.codigo,
            descricao: produtos.descricao,
            ncm: produtos.ncm,
            qtdKg: pedidosCompraItens.qtdKgSolicitada,
            precoUnit: pedidosCompraItens.precoUnitarioKg,
          })
          .from(pedidosCompraItens)
          .innerJoin(produtos, eq(produtos.id, pedidosCompraItens.produtoId))
          .where(eq(pedidosCompraItens.pedidoCompraId, pcRow.id)),
      ])

      if (itensPc.length === 0) {
        throw new HttpError(400, 'Este Pedido de Compra não possui itens cadastrados.')
      }

      const numeroNf = Math.floor(10000 + Math.random() * 89000)
      const diasParc =
        fpRow && Array.isArray(fpRow.diasParcelasJson) && fpRow.diasParcelasJson.length > 0
          ? fpRow.diasParcelasJson.map((d) => Number(d || 0))
          : [14, 28]

      const gerado = gerarXmlCompraSimulado({
        numeroNf,
        serie: 1,
        dataEmissaoIso: hojeIsoLocal(),
        emitente: {
          cnpj: fornRow?.cnpjCpf || '18456789000144',
          razaoSocial: fornRow?.razaoSocial || 'FRIGORIFICO MODELO TESTE LTDA',
          nomeFantasia: fornRow?.nomeFantasia || fornRow?.razaoSocial || 'FRIGORIFICO MODELO',
          ie: fornRow?.inscricaoEstadual || '110220330440',
          cidade: fornRow?.cidade || 'BARRETOS',
          uf: fornRow?.uf || 'SP',
        },
        destinatario: {
          cnpj: empRow?.cnpj || '54142043000130',
          razaoSocial: empRow?.razaoSocial || 'TRICARNES ALIMENTOS LTDA',
          uf: 'SP',
        },
        itens: itensPc.map((it) => ({
          codigo: it.codigo || '001',
          descricao: it.descricao,
          ncm: it.ncm || '02013000',
          qtdKg: Math.max(1, toNum(it.qtdKg, 1)),
          precoUnit: Math.max(1, toNum(it.precoUnit, 30)),
        })),
        freteValor: toNum(pcRow.freteValor, 0),
        diasParcelas: diasParc,
        pcCodigo: pcRow.codigo,
      })

      return { success: true, pedido_compra_codigo: pcRow.codigo, ...gerado }
    },
  )

  // ── MÓDULO FISCAL: CRIAR CENÁRIO COMPLETO DE TESTE (1 PC APROVADO + XML NF-e PRONTO) ──
  app.post(
    '/api/fiscal/entradas-compra/criar-cenario-teste',
    { preHandler: requirePermission(['fiscal', 'compras']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const reqBody = (req.body || {}) as { tipo_cenario?: string }

      if (String(reqBody.tipo_cenario || '').toUpperCase() === 'HIGIENE_CONSUMO') {
        const [empRow] = await conn.db
          .select()
          .from(empresas)
          .where(eq(empresas.tenantId, ctx.tenantId))
          .limit(1)
        const hoje = hojeIsoLocal()
        const xmlGerado = gerarXmlCompraSimulado({
          numeroNf: Math.floor(30000 + Math.random() * 69000),
          serie: 1,
          dataEmissaoIso: hoje,
          emitente: {
            cnpj: '29876543000188',
            razaoSocial: 'DISTRIBUIDORA LIMPA MAIS HIGIENE E LIMPEZA LTDA',
            nomeFantasia: 'LIMPA MAIS HIGIENE',
            ie: '112233445566',
            cidade: 'CAMPINAS',
            uf: 'SP',
          },
          destinatario: {
            cnpj: empRow?.cnpj || '54142043000130',
            razaoSocial: empRow?.razaoSocial || 'TRICARNES ALIMENTOS LTDA',
            uf: 'SP',
          },
          itens: [
            { codigo: 'HIG-001', descricao: 'PAPEL HIGIENICO FOLHA DUPLA FARDO 64 ROLOS', ncm: '48181000', qtdKg: 5, precoUnit: 42.0 },
            { codigo: 'HIG-002', descricao: 'DETERGENTE ALCALINO CLORADO GALAO 5L', ncm: '34022000', qtdKg: 4, precoUnit: 38.5 },
          ],
          freteValor: 0,
          diasParcelas: [15],
          pcCodigo: 'ENTRADA-DIRETA-HIGIENE',
        })
        return reply.code(201).send({
          success: true,
          tipo_cenario: 'HIGIENE_CONSUMO',
          fornecedor_nome: 'LIMPA MAIS HIGIENE',
          valor_total: 364.0,
          ...xmlGerado,
        })
      }

      const out = await conn.db.transaction(async (tx) => {
        let [forn] = await tx
          .select()
          .from(fornecedores)
          .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1)))
          .orderBy(asc(fornecedores.createdAt))
          .limit(1)

        if (!forn) {
          const fid = uuidv7()
          const fCod = await gerarProximoCodigoCadastro(tx, ctx.tenantId, 'fornecedor')
          await tx.insert(fornecedores).values({
            id: fid,
            tenantId: ctx.tenantId,
            codigo: fCod,
            razaoSocial: 'FRIGORIFICO BOI VERDE TESTE LTDA',
            nomeFantasia: 'FRIGORIFICO BOI VERDE (TESTE)',
            cnpjCpf: '18456789000144',
            inscricaoEstadual: '110220330440',
            cidade: 'BARRETOS',
            uf: 'SP',
            ativo: 1,
          })
          const [criado] = await tx.select().from(fornecedores).where(eq(fornecedores.id, fid)).limit(1)
          forn = criado
        }

        const prods = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.ativo, 1)))
          .orderBy(asc(produtos.descricao))
          .limit(2)

        if (prods.length === 0) {
          throw new HttpError(400, 'Cadastre pelo menos 1 produto antes de gerar o cenário de teste.')
        }

        const [fp] = await tx
          .select()
          .from(formasPagamento)
          .where(and(eq(formasPagamento.tenantId, ctx.tenantId), eq(formasPagamento.ativo, 1)))
          .limit(1)
        const [empRow] = await tx
          .select()
          .from(empresas)
          .where(eq(empresas.tenantId, ctx.tenantId))
          .limit(1)

        const pcId = uuidv7()
        const pcCodigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PEDIDO_COMPRA', 'PC', 4)
        const itensData = prods.map((p, idx) => {
          const qtd = idx === 0 ? 120 : 80
          const preco = toNum(p.custoMedioKg, 0) > 0 ? toNum(p.custoMedioKg, 0) : idx === 0 ? 32.5 : 48.9
          return {
            produtoId: p.id,
            codigo: p.codigo || `P0${idx + 1}`,
            descricao: p.descricao,
            ncm: p.ncm || '02013000',
            qtdKg: qtd,
            precoUnit: Number(preco.toFixed(2)),
          }
        })
        const valorTotal = Number(itensData.reduce((s, it) => s + it.qtdKg * it.precoUnit, 0).toFixed(2))
        const hoje = hojeIsoLocal()

        await tx.insert(pedidosCompra).values({
          id: pcId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo: pcCodigo,
          fornecedorId: forn.id,
          formaPagamentoId: fp?.id || null,
          compradorId: ctx.operador.id,
          previsaoEntrega: hoje,
          valorTotal: toDec(valorTotal, 2),
          freteValor: '150.00',
          despesasValor: '0.00',
          observacoes: 'Pedido de Compra gerado para teste completo de Entrada Fiscal (XML -> Contas a Pagar)',
          status: 'APROVADO',
        })

        await tx.insert(pedidosCompraItens).values(
          itensData.map((it) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            pedidoCompraId: pcId,
            produtoId: it.produtoId,
            qtdKgSolicitada: toDec(it.qtdKg, 3),
            qtdKgRecebida: '0.000',
            precoUnitarioKg: toDec(it.precoUnit, 4),
            subtotal: toDec(it.qtdKg * it.precoUnit, 2),
          })),
        )

        const diasParc =
          fp && Array.isArray(fp.diasParcelasJson) && fp.diasParcelasJson.length > 0
            ? fp.diasParcelasJson.map((d) => Number(d || 0))
            : [14, 28]

        const xmlGerado = gerarXmlCompraSimulado({
          numeroNf: Math.floor(20000 + Math.random() * 79000),
          serie: 1,
          dataEmissaoIso: hoje,
          emitente: {
            cnpj: forn.cnpjCpf || '18456789000144',
            razaoSocial: forn.razaoSocial,
            nomeFantasia: forn.nomeFantasia || forn.razaoSocial,
            ie: forn.inscricaoEstadual || '110220330440',
            cidade: forn.cidade || 'BARRETOS',
            uf: forn.uf || 'SP',
          },
          destinatario: {
            cnpj: empRow?.cnpj || '54142043000130',
            razaoSocial: empRow?.razaoSocial || 'TRICARNES ALIMENTOS LTDA',
            uf: 'SP',
          },
          itens: itensData,
          freteValor: 150,
          diasParcelas: diasParc,
          pcCodigo,
        })

        return {
          pedido_compra_id: pcId,
          pedido_compra_codigo: pcCodigo,
          fornecedor_nome: forn.nomeFantasia || forn.razaoSocial,
          valor_total: valorTotal,
          ...xmlGerado,
        }
      })

      return reply.code(201).send({ success: true, ...out })
    },
  )
}
