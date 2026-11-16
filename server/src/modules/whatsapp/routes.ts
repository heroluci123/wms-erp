import type { FastifyInstance } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  clientes,
  formasPagamento,
  pedidos,
  pedidosItens,
  pendenciasSetor,
  produtos,
  whatsappInbox,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { gerarCodigoDocumento, normalizarDataIso, parseUuidOrBadRequest, toDec, toNum } from '../wms/helpers.js'
import { calcularESalvarParcelas } from '../pedidos/parcelasHelper.js'
import { parseWhatsappMensagem } from './parser.js'

const InboxCreateSchema = z.object({
  remetente_phone: z.string().nullish().transform((v) => (v ?? '').trim()),
  remetente_nome: z.string().nullish().transform((v) => (v ?? '').trim()),
  mensagem_bruta: z.string().trim().min(3, 'Informe o texto da mensagem do WhatsApp.'),
})

async function carregarCatalogosParaParser(conn: DbConnection, tenantId: string) {
  const [clis, prods, formas] = await Promise.all([
    conn.db
      .select({
        id: clientes.id,
        codigo: clientes.codigo,
        razao_social: clientes.razaoSocial,
        nome_fantasia: clientes.nomeFantasia,
        telefone: clientes.telefone,
      })
      .from(clientes)
      .where(and(eq(clientes.tenantId, tenantId), eq(clientes.ativo, 1))),
    conn.db
      .select({
        id: produtos.id,
        codigo: produtos.codigo,
        codigo_auxiliar: produtos.codigoAuxiliar,
        ean: produtos.ean,
        descricao: produtos.descricao,
        valor_unitario: produtos.valorUnitario,
        unidade: produtos.unidade,
      })
      .from(produtos)
      .where(and(eq(produtos.tenantId, tenantId), eq(produtos.ativo, 1))),
    conn.db
      .select({
        id: formasPagamento.id,
        codigo: formasPagamento.codigo,
        descricao: formasPagamento.descricao,
      })
      .from(formasPagamento)
      .where(and(eq(formasPagamento.tenantId, tenantId), eq(formasPagamento.ativo, 1))),
  ])

  return {
    clientes: clis,
    produtos: prods.map((p) => ({ ...p, valor_unitario: Number(p.valor_unitario || 0) })),
    formasPagamento: formas,
  }
}

export function registerWhatsappRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // Preview de parse sem gravar na inbox (util no modal rapido dentro de Pedidos)
  app.post(
    '/api/whatsapp/parse',
    { preHandler: requirePermission(['whatsapp_inbox', 'pedidos', 'financeiro_pedidos'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const parsedBody = InboxCreateSchema.safeParse(req.body)
      if (!parsedBody.success) {
        throw new HttpError(400, parsedBody.error.issues[0]?.message || 'Dados invalidos.')
      }
      const catalogos = await carregarCatalogosParaParser(conn, ctx.tenantId)
      const parsed = parseWhatsappMensagem(parsedBody.data.mensagem_bruta, catalogos, {
        remetenteNome: parsedBody.data.remetente_nome,
        remetentePhone: parsedBody.data.remetente_phone,
      })
      return { success: true, data: parsed }
    }
  )

  app.get(
    '/api/whatsapp/inbox',
    { preHandler: requirePermission(['whatsapp_inbox', 'pedidos', 'pedidos_consultar'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const status = String((req.query as { status?: string }).status || 'PENDENTE').trim().toUpperCase()
      const conds = [eq(whatsappInbox.tenantId, ctx.tenantId)]
      if (status !== 'TODOS') conds.push(eq(whatsappInbox.status, status))

      const rows = await conn.db
        .select({
          id: whatsappInbox.id,
          remetente_phone: whatsappInbox.remetentePhone,
          remetente_nome: whatsappInbox.remetenteNome,
          cliente_sugerido_id: whatsappInbox.clienteSugeridoId,
          cliente_razao_social: clientes.razaoSocial,
          mensagem_bruta: whatsappInbox.mensagemBruta,
          parsed_json: whatsappInbox.parsedJson,
          confianca_pct: whatsappInbox.confiancaPct,
          status: whatsappInbox.status,
          pedido_gerado_id: whatsappInbox.pedidoGeradoId,
          recebido_em: whatsappInbox.recebidoEm,
        })
        .from(whatsappInbox)
        .leftJoin(clientes, eq(clientes.id, whatsappInbox.clienteSugeridoId))
        .where(and(...conds))
        .orderBy(desc(whatsappInbox.recebidoEm))
        .limit(100)

      return {
        success: true,
        data: rows.map((r) => ({ ...r, confianca_pct: toNum(r.confianca_pct, 0) })),
      }
    }
  )

  app.post(
    '/api/whatsapp/inbox',
    { preHandler: requirePermission(['whatsapp_inbox', 'pedidos', 'financeiro_pedidos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const parsedBody = InboxCreateSchema.safeParse(req.body)
      if (!parsedBody.success) {
        throw new HttpError(400, parsedBody.error.issues[0]?.message || 'Dados invalidos.')
      }
      const d = parsedBody.data
      const catalogos = await carregarCatalogosParaParser(conn, ctx.tenantId)
      const parsed = parseWhatsappMensagem(d.mensagem_bruta, catalogos, {
        remetenteNome: d.remetente_nome,
        remetentePhone: d.remetente_phone,
      })

      const id = uuidv7()
      await conn.db.transaction(async (tx) => {
        await tx.insert(whatsappInbox).values({
          id,
          tenantId: ctx.tenantId,
          remetentePhone: d.remetente_phone || 'manual',
          remetenteNome: d.remetente_nome || parsed.cliente_texto || 'WhatsApp',
          clienteSugeridoId: parsed.cliente_sugerido_id,
          mensagemBruta: d.mensagem_bruta,
          parsedJson: parsed as unknown as Record<string, unknown>,
          confiancaPct: String(parsed.confianca_pct),
          status: 'PENDENTE',
        })

        await tx.insert(pendenciasSetor).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          setorDestino: 'SUPPLY_CHAIN',
          tipoPendencia: 'PEDIDO_WHATSAPP',
          referenciaTabela: 'whatsapp_inbox',
          referenciaId: id,
          titulo: `WhatsApp: ${d.remetente_nome || parsed.cliente_texto || 'Novo pedido'} (${parsed.itens.length} itens)`,
          prioridade: 3,
          status: 'PENDENTE',
        })
      })

      return reply.status(201).send({ success: true, id, parsed })
    }
  )

  app.post(
    '/api/whatsapp/inbox/:id/converter-pedido',
    { preHandler: requirePermission(['whatsapp_inbox', 'pedidos']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const inboxId = parseUuidOrBadRequest((req.params as { id: string }).id, 'inbox_id')
      const body = (req.body || {}) as {
        cliente_id?: string | null
        titulo?: string
        previsao_entrega?: string | null
        liberar?: boolean
        itens?: Array<{
          produto_id: string
          qtd_kg_solicitada: number
          preco_unitario?: number
          codigo_aux?: string
          observacao?: string
          alerta_reclamacao?: string
        }>
      }

      const [msg] = await conn.db
        .select()
        .from(whatsappInbox)
        .where(and(eq(whatsappInbox.id, inboxId), eq(whatsappInbox.tenantId, ctx.tenantId)))
        .limit(1)
      if (!msg) throw new HttpError(404, 'Mensagem WhatsApp não encontrada.')
      if (msg.status === 'CONVERTIDO' && msg.pedidoGeradoId) {
        return { success: true, id: msg.pedidoGeradoId, already_converted: true }
      }

      const parsed = (msg.parsedJson || {}) as {
        cliente_sugerido_id?: string | null
        cliente_texto?: string
        forma_pagamento_sugerida_id?: string | null
        observacoes?: string
        itens?: Array<Record<string, unknown>>
      }

      const itensBrutos = Array.isArray(body.itens) && body.itens.length > 0
        ? body.itens
        : (parsed.itens || [])
            .filter((it) => it.produto_id && Number(it.qtd_kg_solicitada || 0) > 0)
            .map((it) => ({
              produto_id: String(it.produto_id),
              qtd_kg_solicitada: Number(it.qtd_kg_solicitada || 0),
              preco_unitario: Number(it.preco_unitario || 0),
              codigo_aux: String(it.codigo_aux || ''),
              observacao: String(it.observacao || ''),
              alerta_reclamacao: String(it.alerta_reclamacao || ''),
            }))

      if (itensBrutos.length === 0) {
        throw new HttpError(400, 'Nenhum item vinculado a produtos do cadastro para gerar pedido.')
      }

      const clienteId = body.cliente_id || parsed.cliente_sugerido_id || null
      let cliRow: typeof clientes.$inferSelect | null = null
      if (clienteId) {
        const [c] = await conn.db
          .select()
          .from(clientes)
          .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, ctx.tenantId)))
          .limit(1)
        cliRow = c || null
      }

      const clienteNome = cliRow?.razaoSocial || parsed.cliente_texto || msg.remetenteNome || 'CLIENTE WHATSAPP'
      const formaPgtoId = parsed.forma_pagamento_sugerida_id || cliRow?.formaPagamentoPadraoId || null
      const statusPedido = body.liberar === true ? 'LIBERADO' : 'RASCUNHO'

      const criado = await conn.db.transaction(async (tx) => {
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PEDIDO', 'PED', 4)
        const pedidoId = uuidv7()
        const valorTotal = itensBrutos.reduce(
          (acc, it) => acc + Number(it.qtd_kg_solicitada || 0) * Number(it.preco_unitario || 0),
          0
        )

        await tx.insert(pedidos).values({
          id: pedidoId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          titulo: (body.titulo || '').trim() || `WhatsApp — ${clienteNome}`,
          clienteId: cliRow?.id || null,
          cliente: clienteNome,
          vendedorId: cliRow?.vendedorPadraoId || null,
          formaPagamentoId: formaPgtoId,
          localCobrancaId: cliRow?.localCobrancaPadraoId || null,
          marchante: cliRow?.marchantePadrao || '',
          pagamentoNaEntrega: cliRow?.permitePagamentoEntrega || 0,
          previsaoEntrega: normalizarDataIso(body.previsao_entrega),
          valorTotal: toDec(valorTotal, 2),
          observacoes: parsed.observacoes || '',
          origemPedido: 'WHATSAPP',
          setorSolicitante: 'WHATSAPP',
          status: statusPedido,
          rastreioToken: uuidv7(),
          criadoPorId: ctx.operador.id,
          criadoPorNome: ctx.operador.nome,
          liberadoAt: statusPedido === 'LIBERADO' ? new Date() : null,
        })

        // Consolidar produtos repetidos para respeitar uq_pedido_item_prod
        const mapItens = new Map<string, (typeof itensBrutos)[number]>()
        for (const it of itensBrutos) {
          const prev = mapItens.get(it.produto_id)
          if (prev) {
            prev.qtd_kg_solicitada = Number((prev.qtd_kg_solicitada + it.qtd_kg_solicitada).toFixed(3))
            if (it.observacao) prev.observacao = [prev.observacao, it.observacao].filter(Boolean).join(' | ')
            if (it.alerta_reclamacao) prev.alerta_reclamacao = [prev.alerta_reclamacao, it.alerta_reclamacao].filter(Boolean).join(' | ')
          } else {
            mapItens.set(it.produto_id, { ...it })
          }
        }

        const listaFinal = Array.from(mapItens.values())
        await tx.insert(pedidosItens).values(
          listaFinal.map((it) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            pedidoId,
            produtoId: it.produto_id,
            codigoAux: it.codigo_aux || '',
            qtdKgSolicitada: toDec(it.qtd_kg_solicitada, 3),
            unidadeSolicitada: 'KG',
            qtdSolicitadaExibicao: toDec(it.qtd_kg_solicitada, 3),
            precoUnitario: toDec(it.preco_unitario || 0, 4),
            observacao: it.observacao || '',
            alertaReclamacao: it.alerta_reclamacao || '',
          }))
        )

        await calcularESalvarParcelas(tx, {
          tenantId: ctx.tenantId,
          pedidoId,
          formaPagamentoId: formaPgtoId,
          valorTotal,
          dataBaseIso: body.previsao_entrega,
        })

        await tx
          .update(whatsappInbox)
          .set({ status: 'CONVERTIDO', pedidoGeradoId: pedidoId, clienteSugeridoId: cliRow?.id || msg.clienteSugeridoId })
          .where(eq(whatsappInbox.id, inboxId))

        await tx
          .update(pendenciasSetor)
          .set({ status: 'CONCLUIDA', concluidaPorId: ctx.operador.id, concluidaAt: new Date() })
          .where(and(eq(pendenciasSetor.tenantId, ctx.tenantId), eq(pendenciasSetor.referenciaId, inboxId)))

        return { id: pedidoId, codigo, status: statusPedido }
      })

      return reply.status(201).send({ success: true, ...criado })
    }
  )

  app.patch(
    '/api/whatsapp/inbox/:id/ignorar',
    { preHandler: requirePermission(['whatsapp_inbox', 'pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const inboxId = parseUuidOrBadRequest((req.params as { id: string }).id, 'inbox_id')
      await conn.db.transaction(async (tx) => {
        await tx
          .update(whatsappInbox)
          .set({ status: 'IGNORADO' })
          .where(and(eq(whatsappInbox.id, inboxId), eq(whatsappInbox.tenantId, ctx.tenantId)))

        await tx
          .update(pendenciasSetor)
          .set({ status: 'CONCLUIDA', concluidaPorId: ctx.operador.id, concluidaAt: new Date() })
          .where(and(eq(pendenciasSetor.tenantId, ctx.tenantId), eq(pendenciasSetor.referenciaId, inboxId)))
      })
      return { success: true }
    }
  )
}
