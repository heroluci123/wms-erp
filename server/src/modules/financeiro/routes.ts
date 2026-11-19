import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import {
  centrosCusto,
  clientes,
  financeiroContasBancarias,
  financeiroMovimentacoes,
  financeiroTitulos,
  formasPagamento,
  fornecedores,
  locaisCobranca,
  pedidos,
  pedidosCompra,
  pedidosItens,
  produtos,
  recebimentos,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  normalizarDataIso,
  parseUuidOrBadRequest,
  toDec,
  toNum,
} from '../wms/helpers.js'
import {
  baixarTitulo,
  estornarTitulo,
  gerarTitulosCompraOuXml,
  obterContaBancariaPadrao,
  recalcularSaldoConta,
  sincronizarTitulosPedidoVenda,
} from './integracaoHelper.js'

const optStr = (fb = '') =>
  z
    .string()
    .nullish()
    .transform((v) => (v == null ? fb : v.trim()))

const optNullableUuid = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.string().uuid().nullable(),
)

const ContaBancariaSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe o código da conta (ex: CX1, BB1, ITAU).'),
  nome: z.string().trim().min(1, 'Informe o nome da conta ou banco.'),
  tipo: z.enum(['CONTA_CORRENTE', 'CAIXA_FISICO', 'CARTEIRA_PIX', 'POUPANCA']).default('CONTA_CORRENTE'),
  banco_codigo: optStr(''),
  agencia: optStr(''),
  conta: optStr(''),
  chave_pix: optStr(''),
  local_cobranca_id: optNullableUuid.optional(),
  saldo_inicial: z.coerce.number().default(0),
  padrao: z.union([z.boolean(), z.number()]).optional().default(0),
})

const TituloCreateSchema = z.object({
  tipo: z.enum(['PAGAR', 'RECEBER']),
  descricao: z.string().trim().min(1, 'Informe a descrição do lançamento.'),
  numero_documento: optStr(''),
  fornecedor_id: optNullableUuid.optional(),
  cliente_id: optNullableUuid.optional(),
  vendedor_id: optNullableUuid.optional(),
  centro_custo_id: optNullableUuid.optional(),
  forma_pagamento_id: optNullableUuid.optional(),
  conta_bancaria_id: optNullableUuid.optional(),
  data_emissao: optStr(''),
  data_vencimento: z.string().trim().min(8, 'Informe a data de vencimento.'),
  valor_original: z.coerce.number().positive('O valor deve ser maior que zero.'),
  qtd_parcelas: z.coerce.number().int().min(1).max(60).optional().default(1),
  intervalo_dias: z.coerce.number().int().min(1).max(365).optional().default(30),
  forma_pagamento_efetiva: optStr(''),
  observacoes: optStr(''),
  ja_pago: z.boolean().optional().default(false),
})

const TituloUpdateSchema = z.object({
  descricao: z.string().trim().min(1, 'Informe a descrição.').optional(),
  numero_documento: optStr('').optional(),
  fornecedor_id: optNullableUuid.optional(),
  cliente_id: optNullableUuid.optional(),
  centro_custo_id: optNullableUuid.optional(),
  conta_bancaria_id: optNullableUuid.optional(),
  data_vencimento: z.string().trim().min(8).optional(),
  valor_original: z.coerce.number().positive().optional(),
  observacoes: optStr('').optional(),
})

const BaixaSchema = z.object({
  conta_bancaria_id: z.string().uuid('Selecione a conta bancária ou caixa.'),
  valor_pago: z.coerce.number().positive('Informe o valor pago/recebido.'),
  valor_desconto: z.coerce.number().min(0).optional().default(0),
  valor_juros_multa: z.coerce.number().min(0).optional().default(0),
  data_pagamento: optStr(''),
  forma_pagamento: optStr('PIX'),
  observacoes: optStr(''),
})

const MovAvulsaSchema = z.object({
  conta_bancaria_id: z.string().uuid('Selecione a conta bancária ou caixa.'),
  tipo: z.enum(['ENTRADA', 'SAIDA']),
  data_movimento: optStr(''),
  valor: z.coerce.number().positive('Informe o valor maior que zero.'),
  forma_pagamento: optStr(''),
  historico: z.string().trim().min(1, 'Informe o histórico da movimentação.'),
})

const TransferenciaSchema = z.object({
  conta_origem_id: z.string().uuid('Selecione a conta de origem.'),
  conta_destino_id: z.string().uuid('Selecione a conta de destino.'),
  data_movimento: optStr(''),
  valor: z.coerce.number().positive('Informe o valor da transferência.'),
  historico: optStr(''),
})

function addDaysIso(isoDate: string, days: number): string {
  const base = normalizarDataIso(isoDate) || hojeIsoLocal()
  const ms = new Date(`${base}T12:00:00Z`).getTime()
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10)
}

function diffDaysIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00Z`).getTime()
  const b = new Date(`${toIso}T12:00:00Z`).getTime()
  return Math.floor((b - a) / 86_400_000)
}

export function registerFinanceiroRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)
  const readPerm = requirePermission(['financeiro', 'financeiro_pedidos'], { write: false })
  const writePerm = requirePermission(['financeiro', 'financeiro_pedidos'])

  // ── DASHBOARD FINANCEIRO & FLUXO DE CAIXA PROJETADO (30 DIAS) ───────────────
  app.get('/api/financeiro/dashboard', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as { dias_projecao?: string }
    const diasProj = Math.min(90, Math.max(7, Number(q.dias_projecao || 30)))
    const hoje = hojeIsoLocal()
    const fimProj = addDaysIso(hoje, diasProj)

    const [contasRows, titulosAbertos] = await Promise.all([
      conn.db
        .select()
        .from(financeiroContasBancarias)
        .where(
          and(
            eq(financeiroContasBancarias.tenantId, ctx.tenantId),
            eq(financeiroContasBancarias.ativo, 1),
          ),
        )
        .orderBy(desc(financeiroContasBancarias.padrao), asc(financeiroContasBancarias.codigo)),
      conn.db
        .select()
        .from(financeiroTitulos)
        .where(
          and(
            eq(financeiroTitulos.tenantId, ctx.tenantId),
            inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']),
          ),
        ),
    ])

    const saldoBancos = Number(
      contasRows.reduce((s, c) => s + toNum(c.saldoAtual, 0), 0).toFixed(2),
    )

    let receberAberto = 0
    let receberVencido = 0
    let receberHoje = 0
    let pagarAberto = 0
    let pagarVencido = 0
    let pagarHoje = 0

    const mapaDias = new Map<string, { data: string; entradas: number; saidas: number }>()
    for (let i = 0; i <= diasProj; i += 1) {
      const dt = addDaysIso(hoje, i)
      mapaDias.set(dt, { data: dt, entradas: 0, saidas: 0 })
    }

    for (const t of titulosAbertos) {
      const saldo = toNum(t.saldoAberto, 0)
      const venc = String(t.dataVencimento || hoje).slice(0, 10)
      if (t.tipo === 'RECEBER') {
        receberAberto += saldo
        if (venc < hoje) receberVencido += saldo
        if (venc === hoje) receberHoje += saldo
        if (venc >= hoje && venc <= fimProj) {
          const slot = mapaDias.get(venc)
          if (slot) slot.entradas = Number((slot.entradas + saldo).toFixed(2))
        }
      } else {
        pagarAberto += saldo
        if (venc < hoje) pagarVencido += saldo
        if (venc === hoje) pagarHoje += saldo
        if (venc >= hoje && venc <= fimProj) {
          const slot = mapaDias.get(venc)
          if (slot) slot.saidas = Number((slot.saidas + saldo).toFixed(2))
        }
      }
    }

    let saldoAcum = saldoBancos
    const fluxoProjetado = Array.from(mapaDias.values()).map((d) => {
      const liquido = Number((d.entradas - d.saidas).toFixed(2))
      saldoAcum = Number((saldoAcum + liquido).toFixed(2))
      return {
        data: d.data,
        entradas_previstas: d.entradas,
        saidas_previstas: d.saidas,
        saldo_dia: liquido,
        saldo_acumulado: saldoAcum,
      }
    })

    return {
      success: true,
      data: {
        hoje,
        kpis: {
          saldo_bancos: saldoBancos,
          receber_aberto: Number(receberAberto.toFixed(2)),
          receber_vencido: Number(receberVencido.toFixed(2)),
          receber_hoje: Number(receberHoje.toFixed(2)),
          pagar_aberto: Number(pagarAberto.toFixed(2)),
          pagar_vencido: Number(pagarVencido.toFixed(2)),
          pagar_hoje: Number(pagarHoje.toFixed(2)),
          saldo_projetado: Number((saldoBancos + receberAberto - pagarAberto).toFixed(2)),
        },
        contas: contasRows.map((c) => ({
          id: c.id,
          codigo: c.codigo,
          nome: c.nome,
          tipo: c.tipo,
          banco_codigo: c.bancoCodigo,
          agencia: c.agencia,
          conta: c.conta,
          chave_pix: c.chavePix,
          local_cobranca_id: c.localCobrancaId,
          saldo_inicial: toNum(c.saldoInicial, 0),
          saldo_atual: toNum(c.saldoAtual, 0),
          padrao: Number(c.padrao || 0),
        })),
        fluxo_projetado: fluxoProjetado,
      },
    }
  })

  // ── CONTAS BANCÁRIAS & CAIXAS (ENXUTO) ──────────────────────────────────────
  app.get('/api/financeiro/contas', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const rows = await conn.db
      .select({
        id: financeiroContasBancarias.id,
        codigo: financeiroContasBancarias.codigo,
        nome: financeiroContasBancarias.nome,
        tipo: financeiroContasBancarias.tipo,
        banco_codigo: financeiroContasBancarias.bancoCodigo,
        agencia: financeiroContasBancarias.agencia,
        conta: financeiroContasBancarias.conta,
        chave_pix: financeiroContasBancarias.chavePix,
        local_cobranca_id: financeiroContasBancarias.localCobrancaId,
        local_cobranca_nome: locaisCobranca.nome,
        saldo_inicial: financeiroContasBancarias.saldoInicial,
        saldo_atual: financeiroContasBancarias.saldoAtual,
        padrao: financeiroContasBancarias.padrao,
        ativo: financeiroContasBancarias.ativo,
      })
      .from(financeiroContasBancarias)
      .leftJoin(locaisCobranca, eq(locaisCobranca.id, financeiroContasBancarias.localCobrancaId))
      .where(
        and(
          eq(financeiroContasBancarias.tenantId, ctx.tenantId),
          eq(financeiroContasBancarias.ativo, 1),
        ),
      )
      .orderBy(desc(financeiroContasBancarias.padrao), asc(financeiroContasBancarias.codigo))

    return {
      success: true,
      data: rows.map((r) => ({
        ...r,
        saldo_inicial: toNum(r.saldo_inicial, 0),
        saldo_atual: toNum(r.saldo_atual, 0),
        padrao: Number(r.padrao || 0),
      })),
    }
  })

  app.post('/api/financeiro/contas', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = ContaBancariaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos.')
    const d = parsed.data

    const id = uuidv7()
    await conn.db.transaction(async (tx) => {
      const isPadrao = Number(Boolean(d.padrao))
      if (isPadrao === 1) {
        await tx
          .update(financeiroContasBancarias)
          .set({ padrao: 0 })
          .where(eq(financeiroContasBancarias.tenantId, ctx.tenantId))
      }

      await tx.insert(financeiroContasBancarias).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo: d.codigo.toUpperCase(),
        nome: d.nome.toUpperCase(),
        tipo: d.tipo,
        bancoCodigo: d.banco_codigo,
        agencia: d.agencia,
        conta: d.conta,
        chavePix: d.chave_pix,
        localCobrancaId: d.local_cobranca_id || null,
        saldoInicial: toDec(d.saldo_inicial, 2),
        saldoAtual: toDec(d.saldo_inicial, 2),
        padrao: isPadrao,
        ativo: 1,
      })
    })

    return reply.status(201).send({ success: true, id })
  })

  app.put('/api/financeiro/contas/:id', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'conta_id')
    const parsed = ContaBancariaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos.')
    const d = parsed.data

    const saldoAtual = await conn.db.transaction(async (tx) => {
      const [ex] = await tx
        .select({ id: financeiroContasBancarias.id })
        .from(financeiroContasBancarias)
        .where(
          and(eq(financeiroContasBancarias.id, id), eq(financeiroContasBancarias.tenantId, ctx.tenantId)),
        )
        .limit(1)
      if (!ex) throw new HttpError(404, 'Conta bancária não encontrada.')

      const isPadrao = Number(Boolean(d.padrao))
      if (isPadrao === 1) {
        await tx
          .update(financeiroContasBancarias)
          .set({ padrao: 0 })
          .where(eq(financeiroContasBancarias.tenantId, ctx.tenantId))
      }

      await tx
        .update(financeiroContasBancarias)
        .set({
          codigo: d.codigo.toUpperCase(),
          nome: d.nome.toUpperCase(),
          tipo: d.tipo,
          bancoCodigo: d.banco_codigo,
          agencia: d.agencia,
          conta: d.conta,
          chavePix: d.chave_pix,
          localCobrancaId: d.local_cobranca_id || null,
          saldoInicial: toDec(d.saldo_inicial, 2),
          padrao: isPadrao,
          updatedAt: new Date(),
        })
        .where(eq(financeiroContasBancarias.id, id))

      return recalcularSaldoConta(tx, ctx.tenantId, id)
    })

    return { success: true, saldo_atual: saldoAtual }
  })

  app.delete('/api/financeiro/contas/:id', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'conta_id')
    await conn.db
      .update(financeiroContasBancarias)
      .set({ ativo: 0, padrao: 0, updatedAt: new Date() })
      .where(and(eq(financeiroContasBancarias.id, id), eq(financeiroContasBancarias.tenantId, ctx.tenantId)))
    return { success: true }
  })

  // ── TÍTULOS (CONTAS A PAGAR & CONTAS A RECEBER) ─────────────────────────────
  app.get('/api/financeiro/titulos', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as {
      tipo?: string
      status?: string
      busca?: string
      fornecedor_id?: string
      cliente_id?: string
      centro_custo_id?: string
      data_inicio?: string
      data_fim?: string
    }

    const hoje = hojeIsoLocal()
    const conds = [eq(financeiroTitulos.tenantId, ctx.tenantId)]

    if (q.tipo && ['PAGAR', 'RECEBER'].includes(q.tipo.toUpperCase())) {
      conds.push(eq(financeiroTitulos.tipo, q.tipo.toUpperCase()))
    }
    if (q.fornecedor_id) {
      conds.push(eq(financeiroTitulos.fornecedorId, parseUuidOrBadRequest(q.fornecedor_id, 'fornecedor_id')))
    }
    if (q.cliente_id) {
      conds.push(eq(financeiroTitulos.clienteId, parseUuidOrBadRequest(q.cliente_id, 'cliente_id')))
    }
    if (q.centro_custo_id) {
      conds.push(eq(financeiroTitulos.centroCustoId, parseUuidOrBadRequest(q.centro_custo_id, 'centro_custo_id')))
    }
    if (q.data_inicio) {
      const dt = normalizarDataIso(q.data_inicio)
      if (dt) conds.push(gte(financeiroTitulos.dataVencimento, dt))
    }
    if (q.data_fim) {
      const dt = normalizarDataIso(q.data_fim)
      if (dt) conds.push(lte(financeiroTitulos.dataVencimento, dt))
    }

    const statusUp = String(q.status || 'TODOS').toUpperCase()
    if (statusUp === 'EM_ABERTO') {
      conds.push(inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']))
    } else if (statusUp === 'VENCIDO') {
      conds.push(inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']))
      conds.push(sql`${financeiroTitulos.dataVencimento} < ${hoje}`)
    } else if (statusUp === 'HOJE') {
      conds.push(inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']))
      conds.push(eq(financeiroTitulos.dataVencimento, hoje))
    } else if (['ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO'].includes(statusUp)) {
      conds.push(eq(financeiroTitulos.status, statusUp))
    }

    const rows = await conn.db
      .select({
        id: financeiroTitulos.id,
        codigo: financeiroTitulos.codigo,
        tipo: financeiroTitulos.tipo,
        origem: financeiroTitulos.origem,
        descricao: financeiroTitulos.descricao,
        numero_documento: financeiroTitulos.numeroDocumento,
        parcela_num: financeiroTitulos.parcelaNum,
        parcela_total: financeiroTitulos.parcelaTotal,
        fornecedor_id: financeiroTitulos.fornecedorId,
        fornecedor_nome: fornecedores.nomeFantasia,
        fornecedor_razao: fornecedores.razaoSocial,
        cliente_id: financeiroTitulos.clienteId,
        cliente_nome: clientes.nomeFantasia,
        cliente_razao: clientes.razaoSocial,
        cliente_bloqueado: clientes.bloqueadoFinanceiro,
        vendedor_id: financeiroTitulos.vendedorId,
        vendedor_nome: vendedores.nome,
        pedido_compra_id: financeiroTitulos.pedidoCompraId,
        pedido_compra_codigo: pedidosCompra.codigo,
        recebimento_id: financeiroTitulos.recebimentoId,
        pedido_venda_id: financeiroTitulos.pedidoVendaId,
        pedido_venda_codigo: pedidos.codigo,
        centro_custo_id: financeiroTitulos.centroCustoId,
        centro_custo_nome: centrosCusto.descricao,
        forma_pagamento_id: financeiroTitulos.formaPagamentoId,
        forma_pagamento_nome: formasPagamento.descricao,
        conta_bancaria_id: financeiroTitulos.contaBancariaId,
        conta_bancaria_nome: financeiroContasBancarias.nome,
        data_emissao: financeiroTitulos.dataEmissao,
        data_vencimento: financeiroTitulos.dataVencimento,
        data_pagamento: financeiroTitulos.dataPagamento,
        valor_original: financeiroTitulos.valorOriginal,
        valor_desconto: financeiroTitulos.valorDesconto,
        valor_juros_multa: financeiroTitulos.valorJurosMulta,
        valor_pago: financeiroTitulos.valorPago,
        saldo_aberto: financeiroTitulos.saldoAberto,
        status: financeiroTitulos.status,
        forma_pagamento_efetiva: financeiroTitulos.formaPagamentoEfetiva,
        observacoes: financeiroTitulos.observacoes,
        criado_por_nome: financeiroTitulos.criadoPorNome,
        created_at: financeiroTitulos.createdAt,
      })
      .from(financeiroTitulos)
      .leftJoin(fornecedores, eq(fornecedores.id, financeiroTitulos.fornecedorId))
      .leftJoin(clientes, eq(clientes.id, financeiroTitulos.clienteId))
      .leftJoin(vendedores, eq(vendedores.id, financeiroTitulos.vendedorId))
      .leftJoin(pedidosCompra, eq(pedidosCompra.id, financeiroTitulos.pedidoCompraId))
      .leftJoin(pedidos, eq(pedidos.id, financeiroTitulos.pedidoVendaId))
      .leftJoin(centrosCusto, eq(centrosCusto.id, financeiroTitulos.centroCustoId))
      .leftJoin(formasPagamento, eq(formasPagamento.id, financeiroTitulos.formaPagamentoId))
      .leftJoin(financeiroContasBancarias, eq(financeiroContasBancarias.id, financeiroTitulos.contaBancariaId))
      .where(and(...conds))
      .orderBy(asc(financeiroTitulos.dataVencimento), desc(financeiroTitulos.createdAt))
      .limit(500)

    const buscaNorm = String(q.busca || '').trim().toLowerCase()
    const mapped = rows
      .map((r) => {
        const venc = String(r.data_vencimento || hoje).slice(0, 10)
        const emAberto = r.status === 'ABERTO' || r.status === 'PARCIAL'
        const diasAtraso = emAberto && venc < hoje ? diffDaysIso(venc, hoje) : 0
        const parceiroNome =
          r.tipo === 'PAGAR'
            ? r.fornecedor_nome || r.fornecedor_razao || ''
            : r.cliente_nome || r.cliente_razao || ''

        return {
          ...r,
          parceiro_nome: parceiroNome,
          valor_original: toNum(r.valor_original, 0),
          valor_desconto: toNum(r.valor_desconto, 0),
          valor_juros_multa: toNum(r.valor_juros_multa, 0),
          valor_pago: toNum(r.valor_pago, 0),
          saldo_aberto: toNum(r.saldo_aberto, 0),
          dias_atraso: diasAtraso,
          vencido: diasAtraso > 0,
          vence_hoje: emAberto && venc === hoje,
        }
      })
      .filter((r) => {
        if (!buscaNorm) return true
        return (
          String(r.codigo || '').toLowerCase().includes(buscaNorm) ||
          String(r.descricao || '').toLowerCase().includes(buscaNorm) ||
          String(r.numero_documento || '').toLowerCase().includes(buscaNorm) ||
          String(r.parceiro_nome || '').toLowerCase().includes(buscaNorm) ||
          String(r.centro_custo_nome || '').toLowerCase().includes(buscaNorm) ||
          String(r.pedido_venda_codigo || '').toLowerCase().includes(buscaNorm) ||
          String(r.pedido_compra_codigo || '').toLowerCase().includes(buscaNorm)
        )
      })

    const resumo = {
      total_registros: mapped.length,
      total_original: Number(mapped.reduce((s, r) => s + r.valor_original, 0).toFixed(2)),
      total_pago: Number(mapped.reduce((s, r) => s + r.valor_pago, 0).toFixed(2)),
      total_aberto: Number(mapped.reduce((s, r) => s + r.saldo_aberto, 0).toFixed(2)),
      total_vencido: Number(mapped.filter((r) => r.vencido).reduce((s, r) => s + r.saldo_aberto, 0).toFixed(2)),
    }

    return { success: true, resumo, data: mapped }
  })

  app.post('/api/financeiro/titulos', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = TituloCreateSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos.')
    const d = parsed.data

    const emissao = normalizarDataIso(d.data_emissao) || hojeIsoLocal()
    const primeiroVenc = normalizarDataIso(d.data_vencimento)
    if (!primeiroVenc) throw new HttpError(400, 'Data de vencimento inválida.')

    const criados = await conn.db.transaction(async (tx) => {
      const conta = d.conta_bancaria_id
        ? await tx
            .select()
            .from(financeiroContasBancarias)
            .where(
              and(
                eq(financeiroContasBancarias.id, d.conta_bancaria_id),
                eq(financeiroContasBancarias.tenantId, ctx.tenantId),
              ),
            )
            .limit(1)
            .then((r) => r[0] || null)
        : await obterContaBancariaPadrao(tx, ctx.tenantId)

      const qtd = d.qtd_parcelas || 1
      let soma = 0
      const outIds: Array<{ id: string; codigo: string }> = []

      for (let i = 0; i < qtd; i += 1) {
        const isLast = i === qtd - 1
        const valParc = isLast
          ? Number((d.valor_original - soma).toFixed(2))
          : Number((d.valor_original / qtd).toFixed(2))
        soma += valParc

        const venc = i === 0 ? primeiroVenc : addDaysIso(primeiroVenc, i * (d.intervalo_dias || 30))
        const prefixo = d.tipo === 'PAGAR' ? 'CPA' : 'CRE'
        const seqKey = d.tipo === 'PAGAR' ? 'FIN_PAGAR' : 'FIN_RECEBER'
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, seqKey, prefixo, 4)
        const id = uuidv7()
        const descParc = qtd > 1 ? `${d.descricao} (${i + 1}/${qtd})` : d.descricao

        await tx.insert(financeiroTitulos).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          tipo: d.tipo,
          origem: 'MANUAL',
          descricao: descParc,
          numeroDocumento: d.numero_documento,
          parcelaNum: i + 1,
          parcelaTotal: qtd,
          fornecedorId: d.fornecedor_id || null,
          clienteId: d.cliente_id || null,
          vendedorId: d.vendedor_id || null,
          centroCustoId: d.centro_custo_id || null,
          formaPagamentoId: d.forma_pagamento_id || null,
          contaBancariaId: conta?.id || null,
          dataEmissao: emissao,
          dataVencimento: venc,
          valorOriginal: toDec(valParc, 2),
          valorDesconto: '0.00',
          valorJurosMulta: '0.00',
          valorPago: '0.00',
          saldoAberto: toDec(valParc, 2),
          status: 'ABERTO',
          formaPagamentoEfetiva: d.forma_pagamento_efetiva,
          observacoes: d.observacoes,
          criadoPorId: ctx.operador.id,
          criadoPorNome: ctx.operador.nome,
        })

        if (d.ja_pago && qtd === 1 && conta) {
          await baixarTitulo(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            tituloId: id,
            contaBancariaId: conta.id,
            valorPago: valParc,
            dataPagamento: emissao,
            formaPagamento: d.forma_pagamento_efetiva || 'PIX',
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }

        outIds.push({ id, codigo })
      }
      return outIds
    })

    return reply.status(201).send({ success: true, id: criados[0]?.id, titulos: criados })
  })

  app.put('/api/financeiro/titulos/:id', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'titulo_id')
    const parsed = TituloUpdateSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos.')
    const d = parsed.data

    await conn.db.transaction(async (tx) => {
      const [tit] = await tx
        .select()
        .from(financeiroTitulos)
        .where(and(eq(financeiroTitulos.id, id), eq(financeiroTitulos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!tit) throw new HttpError(404, 'Título financeiro não encontrado.')
      if (tit.status === 'PAGO' || tit.status === 'CANCELADO') {
        throw new HttpError(400, `Não é possível editar título com status "${tit.status}".`)
      }

      const updates: Partial<typeof financeiroTitulos.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (d.descricao !== undefined) updates.descricao = d.descricao
      if (d.numero_documento !== undefined) updates.numeroDocumento = d.numero_documento
      if (d.fornecedor_id !== undefined) updates.fornecedorId = d.fornecedor_id
      if (d.cliente_id !== undefined) updates.clienteId = d.cliente_id
      if (d.centro_custo_id !== undefined) updates.centroCustoId = d.centro_custo_id
      if (d.conta_bancaria_id !== undefined) updates.contaBancariaId = d.conta_bancaria_id
      if (d.observacoes !== undefined) updates.observacoes = d.observacoes
      if (d.data_vencimento !== undefined) {
        const dt = normalizarDataIso(d.data_vencimento)
        if (!dt) throw new HttpError(400, 'Data de vencimento inválida.')
        updates.dataVencimento = dt
      }
      if (d.valor_original !== undefined && tit.status === 'ABERTO') {
        updates.valorOriginal = toDec(d.valor_original, 2)
        updates.saldoAberto = toDec(d.valor_original, 2)
      }

      await tx.update(financeiroTitulos).set(updates).where(eq(financeiroTitulos.id, id))
    })

    return { success: true }
  })

  app.post('/api/financeiro/titulos/:id/baixar', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'titulo_id')
    const parsed = BaixaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados de baixa inválidos.')
    const d = parsed.data

    const result = await conn.db.transaction((tx) =>
      baixarTitulo(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        tituloId: id,
        contaBancariaId: d.conta_bancaria_id,
        valorPago: d.valor_pago,
        valorDesconto: d.valor_desconto,
        valorJurosMulta: d.valor_juros_multa,
        dataPagamento: d.data_pagamento,
        formaPagamento: d.forma_pagamento,
        observacoes: d.observacoes,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      }),
    )

    return { success: true, ...result }
  })

  app.post('/api/financeiro/titulos/:id/estornar', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'titulo_id')
    const body = (req.body || {}) as { motivo?: string }

    const result = await conn.db.transaction((tx) =>
      estornarTitulo(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        tituloId: id,
        motivo: String(body.motivo || '').trim(),
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      }),
    )

    return { success: true, ...result }
  })

  app.post('/api/financeiro/titulos/:id/cancelar', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'titulo_id')
    const body = (req.body || {}) as { motivo?: string }

    await conn.db.transaction(async (tx) => {
      const [tit] = await tx
        .select()
        .from(financeiroTitulos)
        .where(and(eq(financeiroTitulos.id, id), eq(financeiroTitulos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!tit) throw new HttpError(404, 'Título financeiro não encontrado.')
      if (tit.status === 'PAGO' || tit.status === 'PARCIAL') {
        throw new HttpError(400, 'Estorne a baixa antes de cancelar um título já movimentado.')
      }

      await tx
        .update(financeiroTitulos)
        .set({
          status: 'CANCELADO',
          saldoAberto: '0.00',
          observacoes: [tit.observacoes, body.motivo ? `Cancelado: ${body.motivo}` : 'Cancelado']
            .filter(Boolean)
            .join(' | '),
          updatedAt: new Date(),
        })
        .where(eq(financeiroTitulos.id, id))
    })

    return { success: true }
  })

  // ── EXTRATO / MOVIMENTAÇÕES BANCÁRIAS & TRANSFERÊNCIAS ──────────────────────
  app.get('/api/financeiro/movimentacoes', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as {
      conta_bancaria_id?: string
      tipo?: string
      data_inicio?: string
      data_fim?: string
    }
    const conds = [eq(financeiroMovimentacoes.tenantId, ctx.tenantId)]
    if (q.conta_bancaria_id) {
      conds.push(
        eq(
          financeiroMovimentacoes.contaBancariaId,
          parseUuidOrBadRequest(q.conta_bancaria_id, 'conta_bancaria_id'),
        ),
      )
    }
    if (q.tipo && ['ENTRADA', 'SAIDA'].includes(q.tipo.toUpperCase())) {
      conds.push(eq(financeiroMovimentacoes.tipo, q.tipo.toUpperCase()))
    }
    if (q.data_inicio) {
      const dt = normalizarDataIso(q.data_inicio)
      if (dt) conds.push(gte(financeiroMovimentacoes.dataMovimento, dt))
    }
    if (q.data_fim) {
      const dt = normalizarDataIso(q.data_fim)
      if (dt) conds.push(lte(financeiroMovimentacoes.dataMovimento, dt))
    }

    const rows = await conn.db
      .select({
        id: financeiroMovimentacoes.id,
        conta_bancaria_id: financeiroMovimentacoes.contaBancariaId,
        conta_nome: financeiroContasBancarias.nome,
        conta_codigo: financeiroContasBancarias.codigo,
        titulo_id: financeiroMovimentacoes.tituloId,
        titulo_codigo: financeiroTitulos.codigo,
        tipo: financeiroMovimentacoes.tipo,
        categoria: financeiroMovimentacoes.categoria,
        data_movimento: financeiroMovimentacoes.dataMovimento,
        valor: financeiroMovimentacoes.valor,
        forma_pagamento: financeiroMovimentacoes.formaPagamento,
        historico: financeiroMovimentacoes.historico,
        operador_nome: financeiroMovimentacoes.operadorNome,
        created_at: financeiroMovimentacoes.createdAt,
      })
      .from(financeiroMovimentacoes)
      .innerJoin(
        financeiroContasBancarias,
        eq(financeiroContasBancarias.id, financeiroMovimentacoes.contaBancariaId),
      )
      .leftJoin(financeiroTitulos, eq(financeiroTitulos.id, financeiroMovimentacoes.tituloId))
      .where(and(...conds))
      .orderBy(desc(financeiroMovimentacoes.dataMovimento), desc(financeiroMovimentacoes.createdAt))
      .limit(300)

    const mapped = rows.map((r) => ({ ...r, valor: toNum(r.valor, 0) }))
    const totalEntradas = Number(
      mapped.filter((m) => m.tipo === 'ENTRADA').reduce((s, m) => s + m.valor, 0).toFixed(2),
    )
    const totalSaidas = Number(
      mapped.filter((m) => m.tipo === 'SAIDA').reduce((s, m) => s + m.valor, 0).toFixed(2),
    )

    return {
      success: true,
      resumo: {
        total_entradas: totalEntradas,
        total_saidas: totalSaidas,
        saldo_periodo: Number((totalEntradas - totalSaidas).toFixed(2)),
      },
      data: mapped,
    }
  })

  app.post('/api/financeiro/movimentacoes', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = MovAvulsaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos.')
    const d = parsed.data
    const dataMov = normalizarDataIso(d.data_movimento) || hojeIsoLocal()

    const out = await conn.db.transaction(async (tx) => {
      const [conta] = await tx
        .select({ id: financeiroContasBancarias.id })
        .from(financeiroContasBancarias)
        .where(
          and(
            eq(financeiroContasBancarias.id, d.conta_bancaria_id),
            eq(financeiroContasBancarias.tenantId, ctx.tenantId),
            eq(financeiroContasBancarias.ativo, 1),
          ),
        )
        .limit(1)
      if (!conta) throw new HttpError(404, 'Conta bancária não encontrada.')

      const id = uuidv7()
      await tx.insert(financeiroMovimentacoes).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        contaBancariaId: d.conta_bancaria_id,
        tipo: d.tipo,
        categoria: 'LANCAMENTO_AVULSO',
        dataMovimento: dataMov,
        valor: toDec(d.valor, 2),
        formaPagamento: d.forma_pagamento.toUpperCase(),
        historico: d.historico,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      const saldo = await recalcularSaldoConta(tx, ctx.tenantId, d.conta_bancaria_id)
      return { id, saldo_conta_atual: saldo }
    })

    return reply.status(201).send({ success: true, ...out })
  })

  app.post('/api/financeiro/transferencias', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = TransferenciaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados inválidos.')
    const d = parsed.data
    if (d.conta_origem_id === d.conta_destino_id) {
      throw new HttpError(400, 'Selecione contas de origem e destino diferentes.')
    }
    const dataMov = normalizarDataIso(d.data_movimento) || hojeIsoLocal()

    const out = await conn.db.transaction(async (tx) => {
      const [orig, dest] = await Promise.all([
        tx
          .select()
          .from(financeiroContasBancarias)
          .where(
            and(
              eq(financeiroContasBancarias.id, d.conta_origem_id),
              eq(financeiroContasBancarias.tenantId, ctx.tenantId),
              eq(financeiroContasBancarias.ativo, 1),
            ),
          )
          .limit(1),
        tx
          .select()
          .from(financeiroContasBancarias)
          .where(
            and(
              eq(financeiroContasBancarias.id, d.conta_destino_id),
              eq(financeiroContasBancarias.tenantId, ctx.tenantId),
              eq(financeiroContasBancarias.ativo, 1),
            ),
          )
          .limit(1),
      ])
      if (!orig[0] || !dest[0]) throw new HttpError(404, 'Conta de origem ou destino não encontrada.')

      const histBase = d.historico || `Transferência ${orig[0].nome} → ${dest[0].nome}`
      await tx.insert(financeiroMovimentacoes).values([
        {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          contaBancariaId: orig[0].id,
          tipo: 'SAIDA',
          categoria: 'TRANSFERENCIA',
          dataMovimento: dataMov,
          valor: toDec(d.valor, 2),
          formaPagamento: 'TRANSFERENCIA',
          historico: `${histBase} (Saída)`,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        },
        {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          contaBancariaId: dest[0].id,
          tipo: 'ENTRADA',
          categoria: 'TRANSFERENCIA',
          dataMovimento: dataMov,
          valor: toDec(d.valor, 2),
          formaPagamento: 'TRANSFERENCIA',
          historico: `${histBase} (Entrada)`,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        },
      ])

      const [saldoOrig, saldoDest] = await Promise.all([
        recalcularSaldoConta(tx, ctx.tenantId, orig[0].id),
        recalcularSaldoConta(tx, ctx.tenantId, dest[0].id),
      ])

      return { saldo_origem: saldoOrig, saldo_destino: saldoDest }
    })

    return reply.status(201).send({ success: true, ...out })
  })

  // ── SINCRONIZAÇÃO RETROATIVA (COMPRAS + XML + VENDAS -> TÍTULOS) ───────────
  app.post('/api/financeiro/sincronizar-operacional', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const resumo = await conn.db.transaction(async (tx) => {
      let receberCriados = 0
      let pagarCriados = 0

      // 1. Pedidos de venda ativos sem títulos ainda
      const peds = await tx
        .select({ id: pedidos.id, filialId: pedidos.filialId })
        .from(pedidos)
        .where(
          and(
            eq(pedidos.tenantId, ctx.tenantId),
            ne(pedidos.status, 'CANCELADO'),
            ne(pedidos.status, 'RASCUNHO'),
          ),
        )

      for (const p of peds) {
        const [ja] = await tx
          .select({ id: financeiroTitulos.id })
          .from(financeiroTitulos)
          .where(and(eq(financeiroTitulos.tenantId, ctx.tenantId), eq(financeiroTitulos.pedidoVendaId, p.id)))
          .limit(1)
        if (!ja) {
          receberCriados += await sincronizarTitulosPedidoVenda(tx, {
            tenantId: ctx.tenantId,
            filialId: p.filialId || ctx.filialId,
            pedidoId: p.id,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }
      }

      // 2. Recebimentos XML / NF-e
      const recs = await tx
        .select({ id: recebimentos.id, pedidoCompraId: recebimentos.pedidoCompraId, filialId: recebimentos.filialId })
        .from(recebimentos)
        .where(eq(recebimentos.tenantId, ctx.tenantId))
      for (const r of recs) {
        pagarCriados += await gerarTitulosCompraOuXml(tx, {
          tenantId: ctx.tenantId,
          filialId: r.filialId || ctx.filialId,
          recebimentoId: r.id,
          pedidoCompraId: r.pedidoCompraId,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })
      }

      // 3. Pedidos de Compra recebidos sem recebimento com XML
      const pcs = await tx
        .select({ id: pedidosCompra.id, filialId: pedidosCompra.filialId })
        .from(pedidosCompra)
        .where(
          and(
            eq(pedidosCompra.tenantId, ctx.tenantId),
            inArray(pedidosCompra.status, ['RECEBIDO', 'PARCIAL']),
          ),
        )
      for (const pc of pcs) {
        pagarCriados += await gerarTitulosCompraOuXml(tx, {
          tenantId: ctx.tenantId,
          filialId: pc.filialId || ctx.filialId,
          pedidoCompraId: pc.id,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })
      }

      return { receber_gerados: receberCriados, pagar_gerados: pagarCriados }
    })

    return { success: true, ...resumo }
  })

  // ── INADIMPLÊNCIA & LIMITE DE CRÉDITO DE CLIENTES ───────────────────────────
  app.get('/api/financeiro/inadimplencia', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const hoje = hojeIsoLocal()

    const [clis, tits] = await Promise.all([
      conn.db
        .select()
        .from(clientes)
        .where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.ativo, 1)))
        .orderBy(asc(clientes.razaoSocial)),
      conn.db
        .select()
        .from(financeiroTitulos)
        .where(
          and(
            eq(financeiroTitulos.tenantId, ctx.tenantId),
            eq(financeiroTitulos.tipo, 'RECEBER'),
            inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']),
          ),
        ),
    ])

    const porCli = new Map<
      string,
      { aberto: number; vencido: number; qtd_aberto: number; qtd_vencido: number; maior_atraso: number }
    >()
    for (const t of tits) {
      if (!t.clienteId) continue
      const cur = porCli.get(t.clienteId) || { aberto: 0, vencido: 0, qtd_aberto: 0, qtd_vencido: 0, maior_atraso: 0 }
      const saldo = toNum(t.saldoAberto, 0)
      const venc = String(t.dataVencimento || hoje).slice(0, 10)
      cur.aberto += saldo
      cur.qtd_aberto += 1
      if (venc < hoje) {
        cur.vencido += saldo
        cur.qtd_vencido += 1
        cur.maior_atraso = Math.max(cur.maior_atraso, diffDaysIso(venc, hoje))
      }
      porCli.set(t.clienteId, cur)
    }

    const lista = clis
      .map((c) => {
        const agg = porCli.get(c.id) || { aberto: 0, vencido: 0, qtd_aberto: 0, qtd_vencido: 0, maior_atraso: 0 }
        const limite = toNum(c.limiteCredito, 0)
        const excedeuLimite = limite > 0 && agg.aberto > limite
        return {
          cliente_id: c.id,
          codigo: c.codigo || '',
          razao_social: c.razaoSocial,
          nome_fantasia: c.nomeFantasia,
          limite_credito: limite,
          bloqueado_financeiro: Number(c.bloqueadoFinanceiro || 0),
          saldo_aberto: Number(agg.aberto.toFixed(2)),
          saldo_vencido: Number(agg.vencido.toFixed(2)),
          qtd_titulos_abertos: agg.qtd_aberto,
          qtd_titulos_vencidos: agg.qtd_vencido,
          maior_atraso_dias: agg.maior_atraso,
          excedeu_limite: excedeuLimite,
        }
      })
      .filter((x) => x.saldo_aberto > 0 || x.bloqueado_financeiro === 1 || x.excedeu_limite)
      .sort((a, b) => b.saldo_vencido - a.saldo_vencido || b.saldo_aberto - a.saldo_aberto)

    return { success: true, data: lista }
  })

  app.post('/api/financeiro/clientes/:id/bloqueio', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const cliId = parseUuidOrBadRequest((req.params as { id: string }).id, 'cliente_id')
    const body = (req.body || {}) as { bloqueado?: boolean | number }
    const val = body.bloqueado ? 1 : 0

    await conn.db
      .update(clientes)
      .set({ bloqueadoFinanceiro: val })
      .where(and(eq(clientes.id, cliId), eq(clientes.tenantId, ctx.tenantId)))

    return { success: true, bloqueado_financeiro: val }
  })

  // ── APURAÇÃO DE COMISSÕES DE VENDEDORES (FATURAMENTO vs LIQUIDAÇÃO) ─────────
  app.get('/api/financeiro/comissoes', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as { data_inicio?: string; data_fim?: string; vendedor_id?: string }
    const hoje = hojeIsoLocal()
    const dataIni = normalizarDataIso(q.data_inicio) || `${hoje.slice(0, 7)}-01`
    const dataFim = normalizarDataIso(q.data_fim) || hoje

    const vConds = [eq(vendedores.tenantId, ctx.tenantId), eq(vendedores.ativo, 1)]
    if (q.vendedor_id) {
      vConds.push(eq(vendedores.id, parseUuidOrBadRequest(q.vendedor_id, 'vendedor_id')))
    }

    const [vends, titsReceber] = await Promise.all([
      conn.db.select().from(vendedores).where(and(...vConds)).orderBy(asc(vendedores.nome)),
      conn.db
        .select()
        .from(financeiroTitulos)
        .where(
          and(
            eq(financeiroTitulos.tenantId, ctx.tenantId),
            eq(financeiroTitulos.tipo, 'RECEBER'),
            ne(financeiroTitulos.status, 'CANCELADO'),
          ),
        ),
    ])

    // Pré-busca kg e margem por pedido_venda_id envolvido
    const pedIds = Array.from(
      new Set(titsReceber.map((t) => t.pedidoVendaId).filter(Boolean) as string[]),
    )
    const kgPorPedido = new Map<string, number>()
    const margemPorPedido = new Map<string, number>()
    if (pedIds.length > 0) {
      const itensRows = await conn.db
        .select({
          pedidoId: pedidosItens.pedidoId,
          qtdKg: pedidosItens.qtdKgSolicitada,
          preco: pedidosItens.precoUnitario,
          custo: produtos.custoMedioKg,
        })
        .from(pedidosItens)
        .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
        .where(inArray(pedidosItens.pedidoId, pedIds))

      for (const it of itensRows) {
        const kg = toNum(it.qtdKg, 0)
        const venda = kg * toNum(it.preco, 0)
        const custo = kg * toNum(it.custo, 0)
        kgPorPedido.set(it.pedidoId, (kgPorPedido.get(it.pedidoId) || 0) + kg)
        margemPorPedido.set(it.pedidoId, (margemPorPedido.get(it.pedidoId) || 0) + Math.max(0, venda - custo))
      }
    }

    const relatorio = vends.map((v) => {
      const regra = String(v.regraLiberacao || 'FATURAMENTO').toUpperCase()
      const tipoCom = String(v.tipoComissao || 'PCT_VENDA').toUpperCase()
      const taxa = toNum(v.pctComissao, 0)

      const titsVend = titsReceber.filter((t) => t.vendedorId === v.id)
      const elegiveis = titsVend.filter((t) => {
        if (regra === 'LIQUIDACAO') {
          if (t.status !== 'PAGO' && t.status !== 'PARCIAL') return false
          const dtPag = String(t.dataPagamento || '').slice(0, 10)
          return dtPag >= dataIni && dtPag <= dataFim
        }
        const dtEm = String(t.dataEmissao || '').slice(0, 10)
        return dtEm >= dataIni && dtEm <= dataFim
      })

      let baseValor = 0
      let baseKg = 0
      let comissaoTotal = 0

      const detalhes = elegiveis.map((t) => {
        const valorRef = regra === 'LIQUIDACAO' ? toNum(t.valorPago, 0) : toNum(t.valorOriginal, 0)
        const frac = t.parcelaTotal > 0 ? 1 / t.parcelaTotal : 1
        const kgProp = t.pedidoVendaId ? (kgPorPedido.get(t.pedidoVendaId) || 0) * frac : 0
        const margemProp = t.pedidoVendaId ? (margemPorPedido.get(t.pedidoVendaId) || 0) * frac : valorRef

        let comItem = 0
        if (tipoCom === 'VALOR_KG') {
          comItem = kgProp * taxa
        } else if (tipoCom === 'PCT_MARGEM') {
          comItem = margemProp * (taxa / 100)
        } else {
          comItem = valorRef * (taxa / 100)
        }

        baseValor += valorRef
        baseKg += kgProp
        comissaoTotal += comItem

        return {
          titulo_id: t.id,
          codigo: t.codigo,
          descricao: t.descricao,
          status: t.status,
          data_ref: regra === 'LIQUIDACAO' ? t.dataPagamento : t.dataEmissao,
          valor_base: Number(valorRef.toFixed(2)),
          kg_proporcional: Number(kgProp.toFixed(2)),
          comissao_valor: Number(comItem.toFixed(2)),
        }
      })

      return {
        vendedor_id: v.id,
        codigo: v.codigo,
        sigla: v.sigla,
        nome: v.nome,
        tipo_comissao: tipoCom,
        pct_comissao: taxa,
        regra_liberacao: regra,
        qtd_titulos: detalhes.length,
        base_valor: Number(baseValor.toFixed(2)),
        base_kg: Number(baseKg.toFixed(2)),
        comissao_total: Number(comissaoTotal.toFixed(2)),
        detalhes,
      }
    })

    return {
      success: true,
      periodo: { data_inicio: dataIni, data_fim: dataFim },
      data: relatorio,
    }
  })

  app.post('/api/financeiro/comissoes/gerar-pagar', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const body = (req.body || {}) as {
      vendedor_id?: string
      valor?: number
      data_vencimento?: string
      periodo_label?: string
      centro_custo_id?: string | null
    }
    const vendId = parseUuidOrBadRequest(body.vendedor_id, 'vendedor_id')
    const valor = Number(body.valor || 0)
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new HttpError(400, 'Informe o valor da comissão maior que zero.')
    }
    const venc = normalizarDataIso(body.data_vencimento) || addDaysIso(hojeIsoLocal(), 5)

    const out = await conn.db.transaction(async (tx) => {
      const [vend] = await tx
        .select()
        .from(vendedores)
        .where(and(eq(vendedores.id, vendId), eq(vendedores.tenantId, ctx.tenantId)))
        .limit(1)
      if (!vend) throw new HttpError(404, 'Vendedor não encontrado.')

      const conta = await obterContaBancariaPadrao(tx, ctx.tenantId)
      const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'FIN_PAGAR', 'CPA', 4)
      const id = uuidv7()
      const hoje = hojeIsoLocal()

      await tx.insert(financeiroTitulos).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        tipo: 'PAGAR',
        origem: 'COMISSAO',
        descricao: `Comissão Vendedor ${vend.nome}${body.periodo_label ? ` (${body.periodo_label})` : ''}`,
        numeroDocumento: `COM-${vend.codigo}`,
        parcelaNum: 1,
        parcelaTotal: 1,
        vendedorId: vend.id,
        centroCustoId: body.centro_custo_id
          ? parseUuidOrBadRequest(body.centro_custo_id, 'centro_custo_id')
          : null,
        contaBancariaId: conta.id,
        dataEmissao: hoje,
        dataVencimento: venc,
        valorOriginal: toDec(valor, 2),
        valorDesconto: '0.00',
        valorJurosMulta: '0.00',
        valorPago: '0.00',
        saldoAberto: toDec(valor, 2),
        status: 'ABERTO',
        criadoPorId: ctx.operador.id,
        criadoPorNome: ctx.operador.nome,
      })

      return { id, codigo }
    })

    return reply.status(201).send({ success: true, ...out })
  })
}
