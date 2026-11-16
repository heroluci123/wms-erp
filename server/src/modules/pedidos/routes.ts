import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  clientes,
  estoqueCaixas,
  pedidos,
  pedidosItens,
  produtos,
  romaneios,
  romaneiosItens,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  assertEnderecosNaoBloqueados,
  gerarCodigoDocumento,
  normalizarDataIso,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  toDec,
  toNum,
} from '../wms/helpers.js'

const PERM_PED_READ = ['pedidos_consultar', 'pedidos', 'saida', 'expedicao']

interface ItemPedidoInput {
  produto_id: string
  qtd_kg_solicitada: number
  qtd_caixas_solicitada?: number | null
  unidade_solicitada?: 'KG' | 'CX'
  qtd_solicitada_exibicao?: number | null
  preco_unitario?: number
  desconto_pct?: number
  desconto_valor?: number
  cfop_aplicado?: string
  codigo_aux?: string
  observacao?: string
}

function consolidarItensPedido(itens: ItemPedidoInput[]) {
  const consolidados = new Map<
    string,
    {
      produto_id: string
      qtd_kg_solicitada: number
      qtd_caixas_solicitada: number | null
      unidade_solicitada: 'KG' | 'CX'
      qtd_solicitada_exibicao: number
      preco_unitario: number
      desconto_pct: number
      desconto_valor: number
      cfop_aplicado: string
      codigo_aux: string
      observacao: string
    }
  >()

  for (const item of itens) {
    const pid = parseUuidOrBadRequest(item.produto_id, 'produto_id')
    const kg = toNum(item.qtd_kg_solicitada, 0)
    if (!Number.isFinite(kg) || kg <= 0) {
      throw new HttpError(400, 'Todos os itens do pedido devem ter peso (kg) maior que zero.')
    }
    const cx =
      item.qtd_caixas_solicitada != null && toNum(item.qtd_caixas_solicitada, 0) > 0
        ? Math.trunc(toNum(item.qtd_caixas_solicitada, 0))
        : null
    const unid = item.unidade_solicitada === 'CX' ? 'CX' : 'KG'
    const qtdExib =
      item.qtd_solicitada_exibicao != null && toNum(item.qtd_solicitada_exibicao, 0) > 0
        ? toNum(item.qtd_solicitada_exibicao, kg)
        : unid === 'CX' && cx
          ? cx
          : kg

    if (consolidados.has(pid)) {
      const prev = consolidados.get(pid)!
      prev.qtd_kg_solicitada = Number((prev.qtd_kg_solicitada + kg).toFixed(3))
      if (cx !== null) prev.qtd_caixas_solicitada = (prev.qtd_caixas_solicitada || 0) + cx
      if (prev.unidade_solicitada === unid) {
        prev.qtd_solicitada_exibicao = Number((prev.qtd_solicitada_exibicao + qtdExib).toFixed(3))
      } else {
        prev.unidade_solicitada = 'KG'
        prev.qtd_solicitada_exibicao = prev.qtd_kg_solicitada
      }
      if (item.observacao && !prev.observacao) prev.observacao = String(item.observacao).trim()
    } else {
      consolidados.set(pid, {
        produto_id: pid,
        qtd_kg_solicitada: Number(kg.toFixed(3)),
        qtd_caixas_solicitada: cx,
        unidade_solicitada: unid,
        qtd_solicitada_exibicao: Number(qtdExib.toFixed(3)),
        preco_unitario: toNum(item.preco_unitario, 0),
        desconto_pct: toNum(item.desconto_pct, 0),
        desconto_valor: toNum(item.desconto_valor, 0),
        cfop_aplicado: String(item.cfop_aplicado || '').trim(),
        codigo_aux: String(item.codigo_aux || '').trim(),
        observacao: String(item.observacao || '').trim(),
      })
    }
  }
  return Array.from(consolidados.values())
}

export function registerPedidosRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── PEDIDOS DE VENDA ───────────────────────────────────────────────────────
  app.get(
    '/api/pedidos',
    { preHandler: requirePermission(PERM_PED_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { status?: string; q?: string }

      const conds = [eq(pedidos.tenantId, ctx.tenantId), eq(pedidos.filialId, ctx.filialId)]
      if (q.status && q.status !== 'TODOS') {
        conds.push(eq(pedidos.status, q.status.trim().toUpperCase()))
      }
      if (q.q && q.q.trim()) {
        const pat = `%${q.q.trim().toUpperCase()}%`
        conds.push(
          sql`(UPPER(${pedidos.codigo}) LIKE ${pat} OR UPPER(${pedidos.titulo}) LIKE ${pat} OR UPPER(${pedidos.cliente}) LIKE ${pat})`,
        )
      }

      const rows = await conn.db
        .select({
          id: pedidos.id,
          codigo: pedidos.codigo,
          titulo: pedidos.titulo,
          cliente_id: pedidos.clienteId,
          cliente: pedidos.cliente,
          vendedor_id: pedidos.vendedorId,
          forma_pagamento_id: pedidos.formaPagamentoId,
          local_cobranca_id: pedidos.localCobrancaId,
          natureza_id: pedidos.naturezaId,
          marchante: pedidos.marchante,
          pagamento_na_entrega: pedidos.pagamentoNaEntrega,
          previsao_entrega: pedidos.previsaoEntrega,
          valor_total: pedidos.valorTotal,
          observacoes: pedidos.observacoes,
          status: pedidos.status,
          rastreio_token: pedidos.rastreioToken,
          criado_por_nome: pedidos.criadoPorNome,
          created_at: pedidos.createdAt,
          liberado_at: pedidos.liberadoAt,
          expedido_at: pedidos.expedidoAt,
          qtd_itens: sql<number>`(SELECT COUNT(*)::int FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id})`,
          total_kg_solicitado: sql<string>`COALESCE((SELECT ROUND(SUM(pi.qtd_kg_solicitada), 3) FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id}), 0)`,
          romaneio_id: sql<string | null>`(SELECT r.id FROM romaneios r WHERE r.pedido_id = ${pedidos.id} ORDER BY r.created_at DESC LIMIT 1)`,
          romaneio_codigo: sql<string | null>`(SELECT r.codigo FROM romaneios r WHERE r.pedido_id = ${pedidos.id} ORDER BY r.created_at DESC LIMIT 1)`,
          romaneio_status: sql<string | null>`(SELECT r.status FROM romaneios r WHERE r.pedido_id = ${pedidos.id} ORDER BY r.created_at DESC LIMIT 1)`,
          total_kg_separado: sql<string>`COALESCE((SELECT ROUND(SUM(ri.peso_kg), 3) FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id WHERE r.pedido_id = ${pedidos.id}), 0)`,
          total_caixas_separadas: sql<number>`COALESCE((SELECT COUNT(*)::int FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id WHERE r.pedido_id = ${pedidos.id}), 0)`,
        })
        .from(pedidos)
        .where(and(...conds))
        .orderBy(desc(pedidos.createdAt))
        .limit(200)

      return {
        data: rows.map((r) => ({
          ...r,
          valor_total: toNum(r.valor_total, 0),
          total_kg_solicitado: toNum(r.total_kg_solicitado, 0),
          total_kg_separado: toNum(r.total_kg_separado, 0),
        })),
      }
    },
  )

  app.get(
    '/api/pedidos/saldos-produtos',
    { preHandler: requirePermission([...PERM_PED_READ, 'produtos'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: produtos.id,
          codigo: produtos.codigo,
          codigo_auxiliar: produtos.codigoAuxiliar,
          ean: produtos.ean,
          descricao: produtos.descricao,
          unidade: produtos.unidade,
          grupo: produtos.grupo,
          valor_unitario: produtos.valorUnitario,
          peso_padrao_cx: produtos.pesoPadraoCx,
          saldo_caixas: sql<number>`COUNT(${estoqueCaixas.id})::int`,
          saldo_kg: sql<string>`COALESCE(ROUND(SUM(${estoqueCaixas.pesoKg}), 3), 0)`,
          peso_medio_cx: sql<string>`COALESCE(ROUND(AVG(${estoqueCaixas.pesoKg}), 4), 0)`,
        })
        .from(produtos)
        .leftJoin(
          estoqueCaixas,
          and(
            eq(estoqueCaixas.produtoId, produtos.id),
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            eq(estoqueCaixas.filialId, ctx.filialId),
            eq(estoqueCaixas.status, 'DISPONIVEL'),
          ),
        )
        .where(
          and(
            eq(produtos.tenantId, ctx.tenantId),
            eq(produtos.ativo, 1),
            sql`${produtos.tipoProduto} NOT IN ('Insumos', 'Sistema')`,
          ),
        )
        .groupBy(produtos.id)
        .orderBy(produtos.descricao)

      return {
        data: rows.map((r) => ({
          ...r,
          valor_unitario: toNum(r.valor_unitario, 0),
          peso_padrao_cx: r.peso_padrao_cx != null ? toNum(r.peso_padrao_cx, 0) : null,
          saldo_kg: toNum(r.saldo_kg, 0),
          peso_medio_cx: toNum(r.peso_medio_cx, 0),
        })),
      }
    },
  )

  app.get(
    '/api/pedidos/:id',
    { preHandler: requirePermission(PERM_PED_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const pedidoId = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_id')

      const [pedido] = await conn.db
        .select()
        .from(pedidos)
        .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!pedido) throw new HttpError(404, 'Pedido não encontrado.')

      const [rom] = await conn.db
        .select()
        .from(romaneios)
        .where(and(eq(romaneios.pedidoId, pedidoId), eq(romaneios.tenantId, ctx.tenantId)))
        .orderBy(desc(romaneios.createdAt))
        .limit(1)

      let clienteDados = null
      if (pedido.clienteId) {
        const [cli] = await conn.db
          .select()
          .from(clientes)
          .where(eq(clientes.id, pedido.clienteId))
          .limit(1)
        clienteDados = cli || null
      }
      if (!clienteDados) {
        const [pad] = await conn.db
          .select()
          .from(clientes)
          .where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.isPadrao, 1), eq(clientes.ativo, 1)))
          .limit(1)
        clienteDados = pad || null
      }

      const romId = rom?.id || null
      const itens = await conn.db
        .select({
          id: pedidosItens.id,
          pedido_id: pedidosItens.pedidoId,
          produto_id: pedidosItens.produtoId,
          codigo_aux: pedidosItens.codigoAux,
          qtd_kg_solicitada: pedidosItens.qtdKgSolicitada,
          qtd_caixas_solicitada: pedidosItens.qtdCaixasSolicitada,
          unidade_solicitada: pedidosItens.unidadeSolicitada,
          qtd_solicitada_exibicao: pedidosItens.qtdSolicitadaExibicao,
          preco_unitario: pedidosItens.precoUnitario,
          desconto_pct: pedidosItens.descontoPct,
          desconto_valor: pedidosItens.descontoValor,
          cfop_aplicado: pedidosItens.cfopAplicado,
          observacao: pedidosItens.observacao,
          produto_codigo: produtos.codigo,
          produto_ean: produtos.ean,
          produto_descricao: produtos.descricao,
          unidade: produtos.unidade,
          grupo: produtos.grupo,
          estoque_disponivel_kg: sql<string>`COALESCE((SELECT ROUND(SUM(ec.peso_kg), 3) FROM estoque_caixas ec WHERE ec.tenant_id = ${ctx.tenantId} AND ec.filial_id = ${ctx.filialId} AND ec.produto_id = ${pedidosItens.produtoId} AND ec.status = 'DISPONIVEL'), 0)`,
          estoque_disponivel_caixas: sql<number>`COALESCE((SELECT COUNT(*)::int FROM estoque_caixas ec WHERE ec.tenant_id = ${ctx.tenantId} AND ec.filial_id = ${ctx.filialId} AND ec.produto_id = ${pedidosItens.produtoId} AND ec.status = 'DISPONIVEL'), 0)`,
          kg_separado: romId
            ? sql<string>`COALESCE((SELECT ROUND(SUM(ri.peso_kg), 3) FROM romaneios_itens ri WHERE ri.romaneio_id = ${romId} AND ri.produto_id = ${pedidosItens.produtoId}), 0)`
            : sql<string>`'0.000'`,
          caixas_separadas: romId
            ? sql<number>`COALESCE((SELECT COUNT(*)::int FROM romaneios_itens ri WHERE ri.romaneio_id = ${romId} AND ri.produto_id = ${pedidosItens.produtoId}), 0)`
            : sql<number>`0`,
          caixas_conferidas: romId
            ? sql<number>`COALESCE((SELECT COUNT(*)::int FROM romaneios_itens ri WHERE ri.romaneio_id = ${romId} AND ri.produto_id = ${pedidosItens.produtoId} AND ri.conferido = 1), 0)`
            : sql<number>`0`,
        })
        .from(pedidosItens)
        .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
        .where(eq(pedidosItens.pedidoId, pedidoId))

      const caixasRomaneio = romId
        ? await conn.db
            .select({
              id: romaneiosItens.id,
              romaneio_id: romaneiosItens.romaneioId,
              caixa_id: romaneiosItens.caixaId,
              produto_id: romaneiosItens.produtoId,
              peso_kg: romaneiosItens.pesoKg,
              conferido: romaneiosItens.conferido,
              conferido_at: romaneiosItens.conferidoAt,
              conferido_por: romaneiosItens.conferidoPor,
              ean_caixa: estoqueCaixas.eanCaixa,
              lote: estoqueCaixas.lote,
              validade: estoqueCaixas.validade,
              endereco: estoqueCaixas.endereco,
              produto_codigo: produtos.codigo,
              produto_descricao: produtos.descricao,
            })
            .from(romaneiosItens)
            .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
            .innerJoin(produtos, eq(produtos.id, romaneiosItens.produtoId))
            .where(eq(romaneiosItens.romaneioId, romId))
            .orderBy(romaneiosItens.createdAt)
        : []

      return {
        data: {
          id: pedido.id,
          codigo: pedido.codigo,
          titulo: pedido.titulo,
          cliente_id: pedido.clienteId,
          cliente: pedido.cliente,
          vendedor_id: pedido.vendedorId,
          forma_pagamento_id: pedido.formaPagamentoId,
          local_cobranca_id: pedido.localCobrancaId,
          natureza_id: pedido.naturezaId,
          marchante: pedido.marchante,
          pagamento_na_entrega: pedido.pagamentoNaEntrega,
          previsao_entrega: pedido.previsaoEntrega,
          valor_total: toNum(pedido.valorTotal, 0),
          observacoes: pedido.observacoes,
          status: pedido.status,
          rastreio_token: pedido.rastreioToken,
          criado_por_nome: pedido.criadoPorNome,
          created_at: pedido.createdAt,
          romaneio_id: rom?.id || null,
          romaneio_codigo: rom?.codigo || null,
          romaneio_status: rom?.status || null,
          separador_nome: rom?.operadorNome || null,
          operador_conferencia_nome: rom?.operadorConferenciaNome || null,
          operador_expedicao_nome: rom?.operadorExpedicaoNome || null,
          cliente_dados: clienteDados,
          itens: itens.map((it) => ({
            ...it,
            qtd_kg_solicitada: toNum(it.qtd_kg_solicitada, 0),
            qtd_caixas_solicitada:
              it.qtd_caixas_solicitada != null ? toNum(it.qtd_caixas_solicitada, 0) : null,
            qtd_solicitada_exibicao:
              it.qtd_solicitada_exibicao != null ? toNum(it.qtd_solicitada_exibicao, 0) : null,
            preco_unitario: toNum(it.preco_unitario, 0),
            desconto_pct: toNum(it.desconto_pct, 0),
            estoque_disponivel_kg: toNum(it.estoque_disponivel_kg, 0),
            kg_separado: toNum(it.kg_separado, 0),
          })),
          caixas: caixasRomaneio.map((c) => ({ ...c, peso_kg: toNum(c.peso_kg, 0) })),
        },
      }
    },
  )

  app.post('/api/pedidos', { preHandler: requirePermission('pedidos') }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = req.body as {
      titulo: string
      cliente_id?: string | null
      cliente?: string
      vendedor_id?: string | null
      forma_pagamento_id?: string | null
      local_cobranca_id?: string | null
      natureza_id?: string | null
      marchante?: string
      pagamento_na_entrega?: boolean | number
      previsao_entrega?: string | null
      observacoes?: string
      liberar?: boolean
      itens: ItemPedidoInput[]
    }

    const tituloTrim = String(body.titulo || '').trim()
    if (!tituloTrim) throw new HttpError(400, 'Informe o título do pedido.')
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      throw new HttpError(400, 'Adicione pelo menos um item ao pedido.')
    }
    const itensConsolidados = consolidarItensPedido(body.itens)

    const created = await conn.db.transaction(async (tx) => {
      let clienteId: string | null = body.cliente_id
        ? parseUuidOrBadRequest(body.cliente_id, 'cliente_id')
        : null
      let clienteNome = String(body.cliente || '').trim()
      let cliDefaults: typeof clientes.$inferSelect | null = null

      if (clienteId) {
        const [c] = await tx
          .select()
          .from(clientes)
          .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, ctx.tenantId)))
          .limit(1)
        cliDefaults = c || null
        if (!clienteNome && c) clienteNome = c.razaoSocial
      } else {
        const [pad] = await tx
          .select()
          .from(clientes)
          .where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.isPadrao, 1), eq(clientes.ativo, 1)))
          .limit(1)
        if (pad) {
          cliDefaults = pad
          clienteId = pad.id
          if (!clienteNome) clienteNome = pad.razaoSocial
        }
      }
      if (!clienteNome) clienteNome = 'CLIENTE PADRÃO'

      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PEDIDO', 'PED', 4)
      const status = body.liberar === false ? 'RASCUNHO' : 'LIBERADO'
      const valorTotal = itensConsolidados.reduce(
        (acc, it) =>
          acc + Math.max(0, it.qtd_kg_solicitada * it.preco_unitario * (1 - it.desconto_pct / 100) - it.desconto_valor),
        0,
      )

      const pedidoId = uuidv7()
      await tx.insert(pedidos).values({
        id: pedidoId,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        titulo: tituloTrim,
        clienteId,
        cliente: clienteNome,
        vendedorId: body.vendedor_id
          ? parseUuidOrBadRequest(body.vendedor_id, 'vendedor_id')
          : cliDefaults?.vendedorPadraoId || null,
        formaPagamentoId: body.forma_pagamento_id
          ? parseUuidOrBadRequest(body.forma_pagamento_id, 'forma_pagamento_id')
          : cliDefaults?.formaPagamentoPadraoId || null,
        localCobrancaId: body.local_cobranca_id
          ? parseUuidOrBadRequest(body.local_cobranca_id, 'local_cobranca_id')
          : cliDefaults?.localCobrancaPadraoId || null,
        naturezaId: body.natureza_id ? parseUuidOrBadRequest(body.natureza_id, 'natureza_id') : null,
        marchante: String(body.marchante || cliDefaults?.marchantePadrao || '').trim(),
        pagamentoNaEntrega:
          body.pagamento_na_entrega != null
            ? body.pagamento_na_entrega
              ? 1
              : 0
            : cliDefaults?.permitePagamentoEntrega || 0,
        previsaoEntrega: normalizarDataIso(body.previsao_entrega),
        valorTotal: toDec(valorTotal, 2),
        observacoes: String(body.observacoes || '').trim(),
        status,
        rastreioToken: uuidv7(),
        criadoPorId: ctx.operador.id,
        criadoPorNome: ctx.operador.nome,
        liberadoAt: status === 'LIBERADO' ? new Date() : null,
      })

      await tx.insert(pedidosItens).values(
        itensConsolidados.map((it) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          pedidoId,
          produtoId: it.produto_id,
          codigoAux: it.codigo_aux,
          qtdKgSolicitada: toDec(it.qtd_kg_solicitada, 3),
          qtdCaixasSolicitada:
            it.qtd_caixas_solicitada != null ? String(it.qtd_caixas_solicitada) : null,
          unidadeSolicitada: it.unidade_solicitada,
          qtdSolicitadaExibicao: toDec(it.qtd_solicitada_exibicao, 3),
          precoUnitario: toDec(it.preco_unitario, 4),
          descontoPct: toDec(it.desconto_pct, 2),
          descontoValor: toDec(it.desconto_valor, 2),
          cfopAplicado: it.cfop_aplicado,
          observacao: it.observacao,
        })),
      )

      return { id: pedidoId, codigo, status }
    })

    return reply.code(201).send({ success: true, ...created })
  })

  app.put('/api/pedidos/:id', { preHandler: requirePermission('pedidos') }, async (req) => {
    const ctx = req.authCtx!
    const pedidoId = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_id')
    const body = req.body as {
      titulo: string
      cliente_id?: string | null
      cliente?: string
      previsao_entrega?: string | null
      observacoes?: string
      liberar?: boolean
      itens: ItemPedidoInput[]
    }

    const tituloTrim = String(body.titulo || '').trim()
    if (!tituloTrim) throw new HttpError(400, 'Informe o título do pedido.')
    if (!Array.isArray(body.itens) || body.itens.length === 0) {
      throw new HttpError(400, 'O pedido precisa de pelo menos um item.')
    }
    const itensConsolidados = consolidarItensPedido(body.itens)

    const novoStatus = await conn.db.transaction(async (tx) => {
      const [atual] = await tx
        .select()
        .from(pedidos)
        .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!atual) throw new HttpError(404, 'Pedido não encontrado.')
      if (!['RASCUNHO', 'LIBERADO'].includes(atual.status)) {
        throw new HttpError(409, `Não é possível editar itens de um pedido no status ${atual.status}.`)
      }

      const nextStatus =
        body.liberar === true ? 'LIBERADO' : body.liberar === false ? 'RASCUNHO' : atual.status
      const valorTotal = itensConsolidados.reduce(
        (acc, it) =>
          acc + Math.max(0, it.qtd_kg_solicitada * it.preco_unitario * (1 - it.desconto_pct / 100) - it.desconto_valor),
        0,
      )

      await tx
        .update(pedidos)
        .set({
          titulo: tituloTrim,
          clienteId: body.cliente_id
            ? parseUuidOrBadRequest(body.cliente_id, 'cliente_id')
            : atual.clienteId,
          cliente: body.cliente ? body.cliente.trim() : atual.cliente,
          previsaoEntrega: normalizarDataIso(body.previsao_entrega),
          valorTotal: toDec(valorTotal, 2),
          observacoes: body.observacoes != null ? body.observacoes.trim() : atual.observacoes,
          status: nextStatus,
          liberadoAt: nextStatus === 'LIBERADO' && !atual.liberadoAt ? new Date() : atual.liberadoAt,
          updatedAt: new Date(),
        })
        .where(eq(pedidos.id, pedidoId))

      await tx.delete(pedidosItens).where(eq(pedidosItens.pedidoId, pedidoId))
      await tx.insert(pedidosItens).values(
        itensConsolidados.map((it) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          pedidoId,
          produtoId: it.produto_id,
          codigoAux: it.codigo_aux,
          qtdKgSolicitada: toDec(it.qtd_kg_solicitada, 3),
          qtdCaixasSolicitada:
            it.qtd_caixas_solicitada != null ? String(it.qtd_caixas_solicitada) : null,
          unidadeSolicitada: it.unidade_solicitada,
          qtdSolicitadaExibicao: toDec(it.qtd_solicitada_exibicao, 3),
          precoUnitario: toDec(it.preco_unitario, 4),
          descontoPct: toDec(it.desconto_pct, 2),
          descontoValor: toDec(it.desconto_valor, 2),
          cfopAplicado: it.cfop_aplicado,
          observacao: it.observacao,
        })),
      )

      return nextStatus
    })

    return { success: true, id: pedidoId, status: novoStatus }
  })

  app.post('/api/pedidos/:id/liberar', { preHandler: requirePermission('pedidos') }, async (req) => {
    const ctx = req.authCtx!
    const pedidoId = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_id')
    const [ped] = await conn.db
      .select({ status: pedidos.status })
      .from(pedidos)
      .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
      .limit(1)
    if (!ped) throw new HttpError(404, 'Pedido não encontrado.')
    if (ped.status !== 'RASCUNHO') {
      throw new HttpError(400, 'Somente pedidos em RASCUNHO podem ser liberados.')
    }
    await conn.db
      .update(pedidos)
      .set({ status: 'LIBERADO', liberadoAt: new Date(), updatedAt: new Date() })
      .where(eq(pedidos.id, pedidoId))
    return { success: true }
  })

  app.post('/api/pedidos/:id/cancelar', { preHandler: requirePermission('pedidos') }, async (req) => {
    const ctx = req.authCtx!
    const pedidoId = parseUuidOrBadRequest((req.params as { id: string }).id, 'pedido_id')

    await conn.db.transaction(async (tx) => {
      const [ped] = await tx
        .select()
        .from(pedidos)
        .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!ped) throw new HttpError(404, 'Pedido não encontrado.')
      if (ped.status === 'EXPEDIDO') throw new HttpError(409, 'Não é possível cancelar um pedido já expedido.')
      if (ped.status === 'CANCELADO') return

      const roms = await tx
        .select()
        .from(romaneios)
        .where(and(eq(romaneios.pedidoId, pedidoId), sql`${romaneios.status} != 'EXPEDIDO'`))

      const ends = new Set<string>()
      for (const rom of roms) {
        const itens = await tx
          .select({
            caixaId: romaneiosItens.caixaId,
            eanCaixa: estoqueCaixas.eanCaixa,
            endereco: estoqueCaixas.endereco,
          })
          .from(romaneiosItens)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
          .where(eq(romaneiosItens.romaneioId, rom.id))

        for (const it of itens) {
          if (it.endereco) ends.add(it.endereco)
          if (it.caixaId) {
            await tx
              .update(estoqueCaixas)
              .set({
                status: 'DISPONIVEL',
                pedidoReservadoId: null,
                pedidoReservadoCodigo: null,
                romaneioReservadoId: null,
                romaneioReservadoCodigo: null,
                clienteReservadoNome: null,
                reservadoEm: null,
                updatedAt: new Date(),
              })
              .where(eq(estoqueCaixas.id, it.caixaId))
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId: it.caixaId,
              eanCaixa: it.eanCaixa,
              operacao: 'ESTORNO',
              detalhes: `Cancelamento do ${ped.codigo} (${rom.codigo})`,
              operadorNome: ctx.operador.nome,
            })
          }
        }
        await tx.delete(romaneiosItens).where(eq(romaneiosItens.romaneioId, rom.id))
        await tx.delete(romaneios).where(eq(romaneios.id, rom.id))
      }

      if (ends.size > 0) {
        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...ends])
      }

      await tx
        .update(pedidos)
        .set({ status: 'CANCELADO', canceladoAt: new Date(), updatedAt: new Date() })
        .where(eq(pedidos.id, pedidoId))
    })

    return { success: true }
  })

  // ── SAÍDA / SEPARAÇÃO / CONFERÊNCIA / EXPEDIÇÃO ────────────────────────────
  app.get(
    '/api/saida/fila',
    { preHandler: requirePermission(PERM_PED_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: pedidos.id,
          codigo: pedidos.codigo,
          titulo: pedidos.titulo,
          cliente: pedidos.cliente,
          previsao_entrega: pedidos.previsaoEntrega,
          status: pedidos.status,
          observacoes: pedidos.observacoes,
          qtd_itens: sql<number>`(SELECT COUNT(*)::int FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id})`,
          total_kg_solicitado: sql<string>`COALESCE((SELECT ROUND(SUM(pi.qtd_kg_solicitada), 3) FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id}), 0)`,
          romaneio_id: sql<string | null>`(SELECT r.id FROM romaneios r WHERE r.pedido_id = ${pedidos.id} AND r.status != 'EXPEDIDO' ORDER BY r.created_at DESC LIMIT 1)`,
          romaneio_codigo: sql<string | null>`(SELECT r.codigo FROM romaneios r WHERE r.pedido_id = ${pedidos.id} AND r.status != 'EXPEDIDO' ORDER BY r.created_at DESC LIMIT 1)`,
          romaneio_status: sql<string | null>`(SELECT r.status FROM romaneios r WHERE r.pedido_id = ${pedidos.id} AND r.status != 'EXPEDIDO' ORDER BY r.created_at DESC LIMIT 1)`,
        })
        .from(pedidos)
        .where(
          and(
            eq(pedidos.tenantId, ctx.tenantId),
            eq(pedidos.filialId, ctx.filialId),
            sql`${pedidos.status} IN ('LIBERADO', 'EM_SEPARACAO')`,
          ),
        )
        .orderBy(sql`${pedidos.previsaoEntrega} ASC NULLS LAST`, desc(pedidos.createdAt))

      return {
        data: rows.map((r) => ({ ...r, total_kg_solicitado: toNum(r.total_kg_solicitado, 0) })),
      }
    },
  )

  app.post(
    '/api/saida/iniciar-pedido/:pedidoId',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const pedidoId = parseUuidOrBadRequest((req.params as { pedidoId: string }).pedidoId, 'pedido_id')

      const romaneio = await conn.db.transaction(async (tx) => {
        const [ped] = await tx
          .select()
          .from(pedidos)
          .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!ped) throw new HttpError(404, 'Pedido não encontrado.')
        if (!['LIBERADO', 'EM_SEPARACAO'].includes(ped.status)) {
          throw new HttpError(409, `Pedido ${ped.codigo} está no status ${ped.status} e não pode ser separado aqui.`)
        }

        const [existing] = await tx
          .select()
          .from(romaneios)
          .where(
            and(
              eq(romaneios.pedidoId, pedidoId),
              eq(romaneios.tenantId, ctx.tenantId),
              sql`${romaneios.status} != 'EXPEDIDO'`,
            ),
          )
          .orderBy(desc(romaneios.createdAt))
          .limit(1)

        if (existing) {
          if (existing.status !== 'MONTANDO') {
            throw new HttpError(
              409,
              `O romaneio ${existing.codigo} deste pedido já foi finalizado e está na etapa de Expedição/Conferência.`,
            )
          }
          return existing
        }

        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'ROMANEIO', 'ROM', 4)
        const rotuloCliente = ped.cliente ? `${ped.titulo} (${ped.cliente})` : ped.titulo
        const romId = uuidv7()
        const [created] = await tx
          .insert(romaneios)
          .values({
            id: romId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo,
            pedidoId,
            cliente: rotuloCliente,
            previsaoEntrega: ped.previsaoEntrega,
            status: 'MONTANDO',
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
          .returning()

        if (ped.status === 'LIBERADO') {
          await tx
            .update(pedidos)
            .set({ status: 'EM_SEPARACAO', updatedAt: new Date() })
            .where(eq(pedidos.id, pedidoId))
        }

        return created
      })

      return { success: true, romaneio }
    },
  )

  app.get(
    '/api/romaneios',
    { preHandler: requirePermission(PERM_PED_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as {
        status?: string
        dataInicio?: string
        dataFim?: string
        previsaoEntrega?: string
      }

      const conds = [eq(romaneios.tenantId, ctx.tenantId), eq(romaneios.filialId, ctx.filialId)]
      if (q.status && q.status !== 'TODOS') {
        conds.push(eq(romaneios.status, q.status.trim().toUpperCase()))
      }
      if (q.status === 'EXPEDIDO') {
        if (q.dataInicio) conds.push(sql`DATE(COALESCE(${romaneios.expedidoAt}, ${romaneios.createdAt})) >= ${q.dataInicio}`)
        if (q.dataFim) conds.push(sql`DATE(COALESCE(${romaneios.expedidoAt}, ${romaneios.createdAt})) <= ${q.dataFim}`)
      } else {
        if (q.dataInicio) conds.push(sql`DATE(${romaneios.createdAt}) >= ${q.dataInicio}`)
        if (q.dataFim) conds.push(sql`DATE(${romaneios.createdAt}) <= ${q.dataFim}`)
      }
      if (q.previsaoEntrega) conds.push(sql`DATE(${romaneios.previsaoEntrega}) = ${q.previsaoEntrega}`)

      const rows = await conn.db
        .select({
          id: romaneios.id,
          codigo: romaneios.codigo,
          pedido_id: romaneios.pedidoId,
          cliente: romaneios.cliente,
          previsao_entrega: romaneios.previsaoEntrega,
          status: romaneios.status,
          operador_nome: romaneios.operadorNome,
          operador_conferencia_nome: romaneios.operadorConferenciaNome,
          operador_expedicao_nome: romaneios.operadorExpedicaoNome,
          conferido_at: romaneios.conferidoAt,
          expedido_at: romaneios.expedidoAt,
          created_at: romaneios.createdAt,
          pedido_codigo: pedidos.codigo,
          pedido_titulo: pedidos.titulo,
          pedido_cliente: pedidos.cliente,
          pedido_status: pedidos.status,
          total_peso: sql<string>`COALESCE(SUM(${romaneiosItens.pesoKg}), 0)`,
          total_caixas: sql<number>`COUNT(${romaneiosItens.id})::int`,
          qtd_produtos: sql<number>`COUNT(DISTINCT ${romaneiosItens.produtoId})::int`,
          qtd_conferidas: sql<number>`COALESCE(SUM(CASE WHEN ${romaneiosItens.conferido} = 1 THEN 1 ELSE 0 END), 0)::int`,
          peso_conferido: sql<string>`COALESCE(SUM(CASE WHEN ${romaneiosItens.conferido} = 1 THEN ${romaneiosItens.pesoKg} ELSE 0 END), 0)`,
        })
        .from(romaneios)
        .leftJoin(pedidos, eq(pedidos.id, romaneios.pedidoId))
        .leftJoin(romaneiosItens, eq(romaneiosItens.romaneioId, romaneios.id))
        .where(and(...conds))
        .groupBy(romaneios.id, pedidos.id)
        .orderBy(desc(romaneios.createdAt))
        .limit(200)

      return {
        data: rows.map((r) => ({
          ...r,
          total_peso: toNum(r.total_peso, 0),
          peso_conferido: toNum(r.peso_conferido, 0),
        })),
      }
    },
  )

  app.post(
    '/api/romaneios',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = req.body as {
        cliente?: string
        previsao_entrega?: string | null
        pedido_id?: string | null
      }

      const rom = await conn.db.transaction(async (tx) => {
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'ROMANEIO', 'ROM', 4)
        const id = uuidv7()
        const [created] = await tx
          .insert(romaneios)
          .values({
            id,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo,
            pedidoId: body.pedido_id ? parseUuidOrBadRequest(body.pedido_id, 'pedido_id') : null,
            cliente: String(body.cliente || 'CLIENTE AVULSO').trim(),
            previsaoEntrega: normalizarDataIso(body.previsao_entrega),
            status: 'MONTANDO',
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
          .returning()
        return created
      })

      return reply.code(201).send({ success: true, romaneio: rom })
    },
  )

  app.get(
    '/api/romaneios/:id',
    { preHandler: requirePermission(PERM_PED_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')

      const [rom] = await conn.db
        .select()
        .from(romaneios)
        .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')

      const itens = await conn.db
        .select({
          id: romaneiosItens.id,
          romaneio_id: romaneiosItens.romaneioId,
          caixa_id: romaneiosItens.caixaId,
          produto_id: romaneiosItens.produtoId,
          peso_kg: romaneiosItens.pesoKg,
          conferido: romaneiosItens.conferido,
          conferido_at: romaneiosItens.conferidoAt,
          conferido_por: romaneiosItens.conferidoPor,
          ean_caixa: estoqueCaixas.eanCaixa,
          lote: estoqueCaixas.lote,
          validade: estoqueCaixas.validade,
          endereco: estoqueCaixas.endereco,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
        })
        .from(romaneiosItens)
        .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
        .innerJoin(produtos, eq(produtos.id, romaneiosItens.produtoId))
        .where(eq(romaneiosItens.romaneioId, romId))
        .orderBy(romaneiosItens.createdAt)

      let pedidoItens: Array<Record<string, unknown>> = []
      if (rom.pedidoId) {
        const pItens = await conn.db
          .select({
            id: pedidosItens.id,
            produto_id: pedidosItens.produtoId,
            qtd_kg_solicitada: pedidosItens.qtdKgSolicitada,
            qtd_caixas_solicitada: pedidosItens.qtdCaixasSolicitada,
            unidade_solicitada: pedidosItens.unidadeSolicitada,
            observacao: pedidosItens.observacao,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
          })
          .from(pedidosItens)
          .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
          .where(eq(pedidosItens.pedidoId, rom.pedidoId))

        pedidoItens = pItens.map((pi) => {
          const doProd = itens.filter((i) => i.produto_id === pi.produto_id)
          const kgSep = doProd.reduce((acc, i) => acc + toNum(i.peso_kg, 0), 0)
          return {
            ...pi,
            qtd_kg_solicitada: toNum(pi.qtd_kg_solicitada, 0),
            kg_separado: Number(kgSep.toFixed(3)),
            caixas_separadas: doProd.length,
            caixas_conferidas: doProd.filter((i) => i.conferido === 1).length,
          }
        })
      }

      return {
        data: {
          ...rom,
          itens: itens.map((i) => ({ ...i, peso_kg: toNum(i.peso_kg, 0) })),
          pedido_itens: pedidoItens,
        },
      }
    },
  )

  app.post(
    '/api/romaneios/:id/caixa',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')
      const body = req.body as {
        ean_caixa?: string
        caixa_id?: string
        confirmarExtra?: boolean
        confirmarExcesso?: boolean
      }

      const outcome = await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')
        if (rom.status !== 'MONTANDO') {
          throw new HttpError(
            409,
            `Este romaneio está no status ${rom.status}. Reabra a separação para bipar novas caixas.`,
          )
        }

        const cleanEan = String(body.ean_caixa || '').trim()
        const caixaRes = body.caixa_id
          ? await tx.execute(sql`
              SELECT ec.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao
              FROM estoque_caixas ec
              JOIN produtos p ON p.id = ec.produto_id
              WHERE ec.id = ${parseUuidOrBadRequest(body.caixa_id, 'caixa_id')} AND ec.tenant_id = ${ctx.tenantId}
              FOR UPDATE OF ec
            `)
          : await tx.execute(sql`
              SELECT ec.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao
              FROM estoque_caixas ec
              JOIN produtos p ON p.id = ec.produto_id
              WHERE ec.tenant_id = ${ctx.tenantId} AND ec.filial_id = ${ctx.filialId}
                AND LTRIM(ec.ean_caixa, '0') = LTRIM(${cleanEan}, '0')
              LIMIT 1
              FOR UPDATE OF ec
            `)

        const caixa = caixaRes.rows[0] as
          | {
              id: string
              ean_caixa: string
              produto_id: string
              produto_codigo: string
              produto_descricao: string
              endereco: string | null
              peso_kg: string
              status: string
              cliente_reservado_nome: string | null
              pedido_reservado_codigo: string | null
              romaneio_reservado_codigo: string | null
            }
          | undefined

        if (!caixa) {
          throw new HttpError(404, `Caixa "${cleanEan || body.caixa_id}" não encontrada no estoque.`)
        }

        const [jaNoRomaneio] = await tx
          .select({ id: romaneiosItens.id })
          .from(romaneiosItens)
          .where(and(eq(romaneiosItens.romaneioId, romId), eq(romaneiosItens.caixaId, caixa.id)))
          .limit(1)
        if (jaNoRomaneio) {
          throw new HttpError(409, `A caixa "${caixa.ean_caixa}" já foi bipada nesta separação.`)
        }

        if (caixa.status !== 'DISPONIVEL') {
          const destinoAtual =
            caixa.cliente_reservado_nome ||
            caixa.pedido_reservado_codigo ||
            caixa.romaneio_reservado_codigo ||
            caixa.status
          throw new HttpError(409, `Esta caixa já está separada/reservada (${destinoAtual}) e não pode ser bipada.`)
        }

        if (caixa.endereco) {
          await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [caixa.endereco])
        }

        const pesoCaixa = toNum(caixa.peso_kg, 0)
        let pedidoRow: typeof pedidos.$inferSelect | null = null

        if (rom.pedidoId) {
          const [ped] = await tx
            .select()
            .from(pedidos)
            .where(eq(pedidos.id, rom.pedidoId))
            .limit(1)
          pedidoRow = ped || null

          const [pedItem] = await tx
            .select()
            .from(pedidosItens)
            .where(and(eq(pedidosItens.pedidoId, rom.pedidoId), eq(pedidosItens.produtoId, caixa.produto_id)))
            .limit(1)

          if (!pedItem && !body.confirmarExtra) {
            return {
              success: false,
              requiresConfirmation: true,
              reason: 'PRODUTO_FORA_PEDIDO',
              error: `${caixa.produto_descricao} (${caixa.produto_codigo}) NÃO está na lista deste pedido! Deseja adicionar mesmo assim?`,
            }
          }

          if (pedItem && !body.confirmarExcesso) {
            const solicitKg = toNum(pedItem.qtdKgSolicitada, 0)
            if (solicitKg > 0) {
              const [sep] = await tx
                .select({ totalKg: sql<string>`COALESCE(SUM(${romaneiosItens.pesoKg}), 0)` })
                .from(romaneiosItens)
                .where(
                  and(eq(romaneiosItens.romaneioId, romId), eq(romaneiosItens.produtoId, caixa.produto_id)),
                )
              const jaSepKg = toNum(sep?.totalKg, 0)
              const novoTotalKg = jaSepKg + pesoCaixa
              if (novoTotalKg > solicitKg * 1.5) {
                const excessoPct = Math.round(((novoTotalKg - solicitKg) / solicitKg) * 100)
                return {
                  success: false,
                  requiresConfirmation: true,
                  reason: 'EXCESSO_PESO_50',
                  solicitado_kg: solicitKg,
                  ja_separado_kg: jaSepKg,
                  novo_total_kg: Number(novoTotalKg.toFixed(3)),
                  excesso_pct: excessoPct,
                  error: `Quantidade de ${caixa.produto_descricao} excede o pedido em +${excessoPct}% (${novoTotalKg.toFixed(2)} kg / ${solicitKg.toFixed(2)} kg)! Deseja incluir?`,
                }
              }
            }
          }
        }

        const clienteNome =
          pedidoRow?.cliente?.trim() || rom.cliente.trim()

        await tx.insert(romaneiosItens).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          romaneioId: romId,
          caixaId: caixa.id,
          produtoId: caixa.produto_id,
          pesoKg: toDec(pesoCaixa, 3),
          conferido: 0,
        })

        await tx
          .update(estoqueCaixas)
          .set({
            status: 'RESERVADA',
            pedidoReservadoId: rom.pedidoId,
            pedidoReservadoCodigo: pedidoRow?.codigo || null,
            romaneioReservadoId: romId,
            romaneioReservadoCodigo: rom.codigo,
            clienteReservadoNome: clienteNome,
            reservadoEm: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(estoqueCaixas.id, caixa.id), eq(estoqueCaixas.status, 'DISPONIVEL')))

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: caixa.id,
          eanCaixa: caixa.ean_caixa,
          operacao: 'RESERVA',
          detalhes: `Reservada para ${clienteNome} • ${pedidoRow?.codigo ? `${pedidoRow.codigo} / ` : ''}${rom.codigo}`,
          operadorNome: ctx.operador.nome,
        })

        if (pedidoRow && pedidoRow.status === 'LIBERADO') {
          await tx
            .update(pedidos)
            .set({ status: 'EM_SEPARACAO', updatedAt: new Date() })
            .where(eq(pedidos.id, pedidoRow.id))
        }

        if (caixa.endereco) {
          await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [caixa.endereco])
        }

        return {
          success: true,
          caixa: {
            id: caixa.id,
            ean_caixa: caixa.ean_caixa,
            produto_codigo: caixa.produto_codigo,
            produto_descricao: caixa.produto_descricao,
            peso_kg: pesoCaixa,
          },
        }
      })

      return outcome
    },
  )

  app.delete(
    '/api/romaneios/:id/item/:itemId',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; itemId: string }
      const romId = parseUuidOrBadRequest(p.id, 'romaneio_id')
      const itemId = parseUuidOrBadRequest(p.itemId, 'item_id')

      await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')
        if (rom.status !== 'MONTANDO') {
          throw new HttpError(409, 'Reabra a separação antes de remover caixas.')
        }

        const [item] = await tx
          .select()
          .from(romaneiosItens)
          .where(and(eq(romaneiosItens.id, itemId), eq(romaneiosItens.romaneioId, romId)))
          .limit(1)
        if (!item) throw new HttpError(404, 'Item não encontrado no romaneio.')

        await tx.delete(romaneiosItens).where(eq(romaneiosItens.id, itemId))

        if (item.caixaId) {
          const [cx] = await tx
            .select({ eanCaixa: estoqueCaixas.eanCaixa, endereco: estoqueCaixas.endereco })
            .from(estoqueCaixas)
            .where(eq(estoqueCaixas.id, item.caixaId))
            .limit(1)

          await tx
            .update(estoqueCaixas)
            .set({
              status: 'DISPONIVEL',
              pedidoReservadoId: null,
              pedidoReservadoCodigo: null,
              romaneioReservadoId: null,
              romaneioReservadoCodigo: null,
              clienteReservadoNome: null,
              reservadoEm: null,
              updatedAt: new Date(),
            })
            .where(eq(estoqueCaixas.id, item.caixaId))

          if (cx) {
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId: item.caixaId,
              eanCaixa: cx.eanCaixa,
              operacao: 'ESTORNO',
              detalhes: `Removida da separação ${rom.codigo} (devolvida para ${cx.endereco || '-'})`,
              operadorNome: ctx.operador.nome,
            })
            if (cx.endereco) {
              await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [cx.endereco])
            }
          }
        }
      })

      return { success: true }
    },
  )

  app.post(
    '/api/romaneios/:id/finalizar-montagem',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')

      await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')

        const itens = await tx
          .select({ caixaId: romaneiosItens.caixaId })
          .from(romaneiosItens)
          .where(eq(romaneiosItens.romaneioId, romId))
        if (itens.length === 0) {
          throw new HttpError(400, 'Não é possível finalizar um romaneio vazio!')
        }

        let pedRow: typeof pedidos.$inferSelect | null = null
        if (rom.pedidoId) {
          const [p] = await tx.select().from(pedidos).where(eq(pedidos.id, rom.pedidoId)).limit(1)
          pedRow = p || null
        }
        const clienteExato = pedRow?.cliente?.trim() || rom.cliente.trim()

        await tx
          .update(romaneios)
          .set({ status: 'AGUARDANDO_EXPEDICAO', conferidoAt: null, operadorConferenciaNome: null })
          .where(eq(romaneios.id, romId))

        await tx
          .update(romaneiosItens)
          .set({ conferido: 0, conferidoAt: null, conferidoPor: null })
          .where(eq(romaneiosItens.romaneioId, romId))

        const cIds = itens.map((i) => i.caixaId).filter(Boolean) as string[]
        if (cIds.length > 0) {
          await tx
            .update(estoqueCaixas)
            .set({
              status: 'RESERVADA',
              pedidoReservadoId: rom.pedidoId,
              pedidoReservadoCodigo: pedRow?.codigo || null,
              romaneioReservadoId: romId,
              romaneioReservadoCodigo: rom.codigo,
              clienteReservadoNome: clienteExato,
              updatedAt: new Date(),
            })
            .where(inArray(estoqueCaixas.id, cIds))
        }

        if (rom.pedidoId) {
          await tx
            .update(pedidos)
            .set({ status: 'AGUARDANDO_CONFERENCIA', separadoAt: new Date(), updatedAt: new Date() })
            .where(eq(pedidos.id, rom.pedidoId))
        }
      })

      return { success: true }
    },
  )

  app.post(
    '/api/romaneios/:id/reabrir',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')

      await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')
        if (rom.status === 'EXPEDIDO') throw new HttpError(409, 'Romaneio já expedido não pode ser reaberto.')

        await tx
          .update(romaneios)
          .set({ status: 'MONTANDO', conferidoAt: null, operadorConferenciaNome: null })
          .where(eq(romaneios.id, romId))

        await tx
          .update(romaneiosItens)
          .set({ conferido: 0, conferidoAt: null, conferidoPor: null })
          .where(eq(romaneiosItens.romaneioId, romId))

        if (rom.pedidoId) {
          await tx
            .update(pedidos)
            .set({ status: 'EM_SEPARACAO', updatedAt: new Date() })
            .where(eq(pedidos.id, rom.pedidoId))
        }
      })

      return { success: true }
    },
  )

  app.post(
    '/api/romaneios/:id/conferir',
    { preHandler: requirePermission(['expedicao', 'saida']) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')
      const codigoLimpo = String((req.body as { codigo?: string })?.codigo || '').trim()
      if (!codigoLimpo) throw new HttpError(400, 'Informe ou bipe o código da caixa.')

      const res = await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')
        if (rom.status !== 'AGUARDANDO_EXPEDICAO') {
          throw new HttpError(409, `Este romaneio está no status ${rom.status} e não aceita conferência.`)
        }

        const [item] = await tx
          .select({
            item_id: romaneiosItens.id,
            caixa_id: romaneiosItens.caixaId,
            peso_kg: romaneiosItens.pesoKg,
            conferido: romaneiosItens.conferido,
            ean_caixa: estoqueCaixas.eanCaixa,
            lote: estoqueCaixas.lote,
            validade: estoqueCaixas.validade,
            produto_codigo: produtos.codigo,
            produto_descricao: produtos.descricao,
          })
          .from(romaneiosItens)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
          .innerJoin(produtos, eq(produtos.id, romaneiosItens.produtoId))
          .where(
            and(
              eq(romaneiosItens.romaneioId, romId),
              sql`LTRIM(${estoqueCaixas.eanCaixa}, '0') = LTRIM(${codigoLimpo}, '0')`,
            ),
          )
          .limit(1)

        if (!item) {
          return {
            success: false,
            notInRomaneio: true,
            error: `A caixa "${codigoLimpo}" NÃO pertence ao romaneio ${rom.codigo}!`,
          }
        }

        if (item.conferido === 1) {
          return {
            success: false,
            alreadyChecked: true,
            item: { ...item, peso_kg: toNum(item.peso_kg, 0) },
            error: `A caixa "${codigoLimpo}" (${item.produto_descricao}) já foi conferida.`,
          }
        }

        await tx
          .update(romaneiosItens)
          .set({ conferido: 1, conferidoAt: new Date(), conferidoPor: ctx.operador.nome })
          .where(eq(romaneiosItens.id, item.item_id))

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: item.caixa_id,
          eanCaixa: item.ean_caixa,
          operacao: 'CONFERENCIA',
          detalhes: `Conferência de embarque ${rom.codigo}`,
          operadorNome: ctx.operador.nome,
        })

        const [stats] = await tx
          .select({
            total: sql<number>`COUNT(*)::int`,
            conferidas: sql<number>`COALESCE(SUM(CASE WHEN ${romaneiosItens.conferido} = 1 THEN 1 ELSE 0 END), 0)::int`,
          })
          .from(romaneiosItens)
          .where(eq(romaneiosItens.romaneioId, romId))

        const totalCaixas = Number(stats?.total || 0)
        const qtdConferidas = Number(stats?.conferidas || 0)
        const todasConferidas = totalCaixas > 0 && qtdConferidas === totalCaixas

        await tx
          .update(romaneios)
          .set({
            operadorConferenciaNome: ctx.operador.nome,
            conferidoAt: todasConferidas ? new Date() : rom.conferidoAt,
          })
          .where(eq(romaneios.id, romId))

        if (rom.pedidoId) {
          await tx
            .update(pedidos)
            .set({ status: 'EM_CONFERENCIA', updatedAt: new Date() })
            .where(eq(pedidos.id, rom.pedidoId))
        }

        return {
          success: true,
          item: { ...item, peso_kg: toNum(item.peso_kg, 0), conferido: 1 },
          totalCaixas,
          qtdConferidas,
          todasConferidas,
        }
      })

      return res
    },
  )

  app.post(
    '/api/romaneios/:id/expedir',
    { preHandler: requirePermission(['expedicao', 'saida']) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')

      const res = await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')
        if (rom.status !== 'AGUARDANDO_EXPEDICAO') {
          throw new HttpError(409, `Romaneio no status ${rom.status} não pode ser expedido.`)
        }

        const itens = await tx
          .select({
            id: romaneiosItens.id,
            caixaId: romaneiosItens.caixaId,
            produtoId: romaneiosItens.produtoId,
            pesoKg: romaneiosItens.pesoKg,
            conferido: romaneiosItens.conferido,
            eanCaixa: estoqueCaixas.eanCaixa,
            endereco: estoqueCaixas.endereco,
            lote: estoqueCaixas.lote,
          })
          .from(romaneiosItens)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
          .where(eq(romaneiosItens.romaneioId, romId))

        if (itens.length === 0) throw new HttpError(400, 'Romaneio vazio não pode ser expedido.')
        const naoConferidas = itens.filter((i) => i.conferido !== 1)
        if (naoConferidas.length > 0) {
          throw new HttpError(
            409,
            `Ainda existem ${naoConferidas.length} caixa(s) não conferida(s). Confira 100% da carga antes de expedir.`,
          )
        }

        const cIds = itens.map((i) => i.caixaId).filter(Boolean) as string[]
        if (cIds.length > 0) {
          await tx
            .update(estoqueCaixas)
            .set({ status: 'SAIDA', endereco: 'SAIDA', paleteId: null, updatedAt: new Date() })
            .where(inArray(estoqueCaixas.id, cIds))
        }

        const porProd = new Map<string, { origem: string; lote: string; cxs: number; kg: number }>()
        const endsAfetados = new Set<string>(['SAIDA', 'EXPEDICAO'])

        for (const it of itens) {
          const orig = it.endereco || 'DOCA'
          endsAfetados.add(orig)
          if (it.caixaId) {
            await registrarHistoricoCaixa(tx, {
              tenantId: ctx.tenantId,
              caixaId: it.caixaId,
              eanCaixa: it.eanCaixa,
              operacao: 'EXPEDICAO',
              detalhes: `Expedida no ${rom.codigo} para ${rom.cliente}`,
              operadorNome: ctx.operador.nome,
            })
          }
          const k = `${it.produtoId}__${orig}__${it.lote || ''}`
          const cur = porProd.get(k) || { origem: orig, lote: it.lote || '', cxs: 0, kg: 0 }
          cur.cxs += 1
          cur.kg += toNum(it.pesoKg, 0)
          porProd.set(k, cur)
        }

        for (const [key, val] of porProd.entries()) {
          const [prodId] = key.split('__')
          await registrarMovimentacaoLog(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: prodId,
            enderecoOrigem: val.origem,
            enderecoDestino: 'EXPEDICAO',
            lote: val.lote,
            qtdCaixas: val.cxs,
            qtdKg: val.kg,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
            tipo: 'DESPACHO',
            numPedido: rom.codigo,
            cliente: rom.cliente,
          })
        }

        await tx
          .update(romaneios)
          .set({
            status: 'EXPEDIDO',
            operadorExpedicaoNome: ctx.operador.nome,
            expedidoAt: new Date(),
          })
          .where(eq(romaneios.id, romId))

        if (rom.pedidoId) {
          await tx
            .update(pedidos)
            .set({ status: 'EXPEDIDO', expedidoAt: new Date(), updatedAt: new Date() })
            .where(eq(pedidos.id, rom.pedidoId))
        }

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...endsAfetados])

        return {
          codigo: rom.codigo,
          total_caixas: itens.length,
          total_peso: Number(itens.reduce((s, i) => s + toNum(i.pesoKg, 0), 0).toFixed(3)),
        }
      })

      return { success: true, ...res }
    },
  )

  app.delete(
    '/api/romaneios/:id',
    { preHandler: requirePermission(['saida', 'expedicao', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')

      await conn.db.transaction(async (tx) => {
        const [rom] = await tx
          .select()
          .from(romaneios)
          .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')
        if (rom.status === 'EXPEDIDO') {
          throw new HttpError(409, 'Não é possível excluir um romaneio já expedido.')
        }

        const itens = await tx
          .select({ caixaId: romaneiosItens.caixaId, endereco: estoqueCaixas.endereco })
          .from(romaneiosItens)
          .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
          .where(eq(romaneiosItens.romaneioId, romId))

        const cIds = itens.map((i) => i.caixaId).filter(Boolean) as string[]
        const ends = itens.map((i) => i.endereco).filter(Boolean) as string[]
        if (cIds.length > 0) {
          await tx
            .update(estoqueCaixas)
            .set({
              status: 'DISPONIVEL',
              pedidoReservadoId: null,
              pedidoReservadoCodigo: null,
              romaneioReservadoId: null,
              romaneioReservadoCodigo: null,
              clienteReservadoNome: null,
              reservadoEm: null,
              updatedAt: new Date(),
            })
            .where(inArray(estoqueCaixas.id, cIds))
        }

        await tx.delete(romaneiosItens).where(eq(romaneiosItens.romaneioId, romId))
        await tx.delete(romaneios).where(eq(romaneios.id, romId))

        if (ends.length > 0) {
          await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, ends)
        }

        if (rom.pedidoId) {
          await tx
            .update(pedidos)
            .set({
              status: sql`CASE WHEN ${pedidos.status} IN ('EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA') THEN 'LIBERADO' ELSE ${pedidos.status} END`,
              updatedAt: new Date(),
            })
            .where(eq(pedidos.id, rom.pedidoId))
        }
      })

      return { success: true }
    },
  )

  app.get(
    '/api/romaneios/:id/etiquetas',
    { preHandler: requirePermission(PERM_PED_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const romId = parseUuidOrBadRequest((req.params as { id: string }).id, 'romaneio_id')

      const [rom] = await conn.db
        .select({
          id: romaneios.id,
          romaneio_codigo: romaneios.codigo,
          romaneio_cliente: romaneios.cliente,
          pedido_id: romaneios.pedidoId,
          status: romaneios.status,
          pedido_codigo: pedidos.codigo,
          pedido_titulo: pedidos.titulo,
          pedido_cliente: pedidos.cliente,
        })
        .from(romaneios)
        .leftJoin(pedidos, eq(pedidos.id, romaneios.pedidoId))
        .where(and(eq(romaneios.id, romId), eq(romaneios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!rom) throw new HttpError(404, 'Romaneio não encontrado.')

      const clienteExato = String(rom.pedido_cliente || rom.romaneio_cliente || '').trim()
      const itens = await conn.db
        .select({
          item_id: romaneiosItens.id,
          caixa_id: romaneiosItens.caixaId,
          peso_kg: romaneiosItens.pesoKg,
          ean_caixa: estoqueCaixas.eanCaixa,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          qtd_pecas: estoqueCaixas.qtdPecas,
          cliente_reservado_nome: estoqueCaixas.clienteReservadoNome,
          pedido_reservado_codigo: estoqueCaixas.pedidoReservadoCodigo,
          romaneio_reservado_codigo: estoqueCaixas.romaneioReservadoCodigo,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
        })
        .from(romaneiosItens)
        .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
        .innerJoin(produtos, eq(produtos.id, romaneiosItens.produtoId))
        .where(eq(romaneiosItens.romaneioId, rom.id))
        .orderBy(romaneiosItens.createdAt)

      return {
        success: true,
        romaneio: rom,
        cliente_nome: clienteExato,
        etiquetas: itens.map((row) => ({
          id: row.caixa_id,
          caixa_id: row.caixa_id,
          ean_caixa: row.ean_caixa,
          cliente_nome: clienteExato || String(row.cliente_reservado_nome || '').trim(),
          pedido_codigo: rom.pedido_codigo || row.pedido_reservado_codigo || '',
          romaneio_codigo: rom.romaneio_codigo || row.romaneio_reservado_codigo || '',
          produto_codigo: row.produto_codigo || '',
          produto_descricao: row.produto_descricao || '',
          qtd_pecas: row.qtd_pecas ?? null,
          peso_kg: toNum(row.peso_kg, 0),
          lote: row.lote || '',
          data_producao: row.data_producao || null,
          validade: row.validade || null,
        })),
      }
    },
  )
}
