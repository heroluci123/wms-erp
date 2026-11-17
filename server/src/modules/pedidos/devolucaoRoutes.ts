import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  devolucaoItens,
  devolucoes,
  estoqueCaixas,
  pedidos,
  pedidosItens,
  pendenciasSetor,
  produtos,
  romaneios,
  romaneiosItens,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  assertEnderecosNaoBloqueados,
  gerarCodigoDocumento,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  toDec,
  toNum,
} from '../wms/helpers.js'

const PERM_DEV_READ = ['devolucao', 'saida', 'expedicao', 'recebimento', 'pedidos', 'pedidos_consultar']
const PERM_DEV_WRITE = ['devolucao', 'saida', 'expedicao', 'recebimento']

export const MOTIVOS_DEVOLUCAO_LABEL: Record<string, string> = {
  DIVERGENCIA_PEDIDO: 'Divergência no Pedido',
  LOCAL_FECHADO: 'Local Fechado',
  VALIDADE: 'Validade / Qualidade',
  AVARIA: 'Avaria / Embalagem',
  OUTROS: 'Recusa / Outros',
}

async function localizarUltimoEmbarqueCaixa(
  db: Pick<DbConnection['db'], 'select'>,
  tenantId: string,
  caixaId: string,
  produtoId: string,
) {
  const [vinculo] = await db
    .select({
      romaneio_id: romaneios.id,
      romaneio_codigo: romaneios.codigo,
      romaneio_status: romaneios.status,
      expedido_at: romaneios.expedidoAt,
      romaneio_cliente: romaneios.cliente,
      pedido_id: romaneios.pedidoId,
      pedido_codigo: pedidos.codigo,
      pedido_titulo: pedidos.titulo,
      pedido_cliente: pedidos.cliente,
    })
    .from(romaneiosItens)
    .innerJoin(romaneios, eq(romaneios.id, romaneiosItens.romaneioId))
    .leftJoin(pedidos, eq(pedidos.id, romaneios.pedidoId))
    .where(and(eq(romaneiosItens.tenantId, tenantId), eq(romaneiosItens.caixaId, caixaId)))
    .orderBy(desc(romaneios.expedidoAt), desc(romaneiosItens.createdAt))
    .limit(1)

  let precoUnitario = 0
  if (vinculo?.pedido_id) {
    const [pedIt] = await db
      .select({ precoUnitario: pedidosItens.precoUnitario })
      .from(pedidosItens)
      .where(and(eq(pedidosItens.pedidoId, vinculo.pedido_id), eq(pedidosItens.produtoId, produtoId)))
      .limit(1)
    if (pedIt) precoUnitario = toNum(pedIt.precoUnitario, 0)
  }

  return {
    pedido_id: vinculo?.pedido_id || null,
    pedido_codigo: vinculo?.pedido_codigo || '',
    pedido_titulo: vinculo?.pedido_titulo || '',
    romaneio_id: vinculo?.romaneio_id || null,
    romaneio_codigo: vinculo?.romaneio_codigo || '',
    cliente_nome: vinculo?.pedido_cliente || vinculo?.romaneio_cliente || '',
    expedido_at: vinculo?.expedido_at || null,
    preco_unitario: precoUnitario,
  }
}

export function registerDevolucaoRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // Consulta rápida da caixa bipada na devolução + puxa pedido/romaneio/cliente de origem
  app.get(
    '/api/devolucoes/buscar-caixa',
    { preHandler: requirePermission(PERM_DEV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { ean?: string }
      const codigo = String(q.ean || '').trim()
      if (!codigo) {
        throw new HttpError(400, 'Bipe ou informe o EAN/código da caixa para consultar.')
      }

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codigo)
      const semZeros = codigo.replace(/^0+/, '')
      const [cx] = await conn.db
        .select({
          id: estoqueCaixas.id,
          filial_id: estoqueCaixas.filialId,
          ean_caixa: estoqueCaixas.eanCaixa,
          produto_id: estoqueCaixas.produtoId,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          produto_grupo: produtos.grupo,
          valor_unitario: produtos.valorUnitario,
          endereco: estoqueCaixas.endereco,
          lote: estoqueCaixas.lote,
          data_producao: estoqueCaixas.dataProducao,
          validade: estoqueCaixas.validade,
          peso_kg: estoqueCaixas.pesoKg,
          qtd_pecas: estoqueCaixas.qtdPecas,
          status: estoqueCaixas.status,
          romaneio_reservado_codigo: estoqueCaixas.romaneioReservadoCodigo,
          pedido_reservado_codigo: estoqueCaixas.pedidoReservadoCodigo,
        })
        .from(estoqueCaixas)
        .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
        .where(
          and(
            eq(estoqueCaixas.tenantId, ctx.tenantId),
            isUuid
              ? eq(estoqueCaixas.id, codigo)
              : semZeros
                ? sql`(${estoqueCaixas.eanCaixa} = ${codigo} OR LTRIM(${estoqueCaixas.eanCaixa}, '0') = ${semZeros})`
                : eq(estoqueCaixas.eanCaixa, codigo),
          ),
        )
        .limit(1)

      if (!cx) {
        throw new HttpError(404, `Nenhuma caixa encontrada no WMS para o código "${codigo}".`)
      }

      if (cx.status !== 'SAIDA' && cx.status !== 'EXPEDIDA') {
        if (cx.status === 'DISPONIVEL') {
          throw new HttpError(
            409,
            `A caixa ${cx.ean_caixa} já consta como DISPONÍVEL no estoque (endereço ${cx.endereco || '-'}).`,
          )
        }
        if (cx.status === 'RESERVADA') {
          throw new HttpError(
            409,
            `A caixa ${cx.ean_caixa} está RESERVADA em um romaneio ainda não expedido (${cx.romaneio_reservado_codigo || cx.pedido_reservado_codigo || '-'}). Estorne na tela Saída de Materiais.`,
          )
        }
        if (cx.status === 'BLOQUEADO') {
          throw new HttpError(
            409,
            `A caixa ${cx.ean_caixa} já está em QUARENTENA / BLOQUEADA no endereço ${cx.endereco || '-'}.`,
          )
        }
        throw new HttpError(
          409,
          `A caixa ${cx.ean_caixa} está com status "${cx.status}" (ex.: consumida na produção) e não pode entrar por devolução de venda.`,
        )
      }

      const origem = await localizarUltimoEmbarqueCaixa(conn.db, ctx.tenantId, cx.id, cx.produto_id)
      const precoUnit = origem.preco_unitario > 0 ? origem.preco_unitario : toNum(cx.valor_unitario, 0)

      return {
        success: true,
        caixa: {
          ...cx,
          peso_kg: toNum(cx.peso_kg, 0),
          preco_unitario: precoUnit,
          valor_estimado: Number((toNum(cx.peso_kg, 0) * precoUnit).toFixed(2)),
          pedido_id: origem.pedido_id,
          pedido_codigo: origem.pedido_codigo,
          pedido_titulo: origem.pedido_titulo,
          romaneio_id: origem.romaneio_id,
          romaneio_codigo: origem.romaneio_codigo,
          cliente_nome: origem.cliente_nome,
          expedido_at: origem.expedido_at,
        },
      }
    },
  )

  // Lista devoluções registradas (com filtros e itens)
  app.get(
    '/api/devolucoes',
    { preHandler: requirePermission(PERM_DEV_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { status_fiscal?: string; motivo?: string; q?: string }

      const conds = [eq(devolucoes.tenantId, ctx.tenantId), eq(devolucoes.filialId, ctx.filialId)]
      if (q.status_fiscal && q.status_fiscal !== 'TODOS') {
        conds.push(eq(devolucoes.statusFiscal, q.status_fiscal.trim().toUpperCase()))
      }
      if (q.motivo && q.motivo !== 'TODOS') {
        conds.push(eq(devolucoes.motivo, q.motivo.trim().toUpperCase()))
      }
      if (q.q && q.q.trim()) {
        const pat = `%${q.q.trim().toUpperCase()}%`
        conds.push(
          sql`(
            UPPER(${devolucoes.codigo}) LIKE ${pat}
            OR UPPER(${devolucoes.pedidoCodigo}) LIKE ${pat}
            OR UPPER(${devolucoes.clienteNome}) LIKE ${pat}
            OR UPPER(${devolucoes.romaneioCodigo}) LIKE ${pat}
          )`,
        )
      }

      const lista = await conn.db
        .select()
        .from(devolucoes)
        .where(and(...conds))
        .orderBy(desc(devolucoes.createdAt))
        .limit(150)

      if (lista.length === 0) return { data: [] }

      const devIds = lista.map((d) => d.id)
      const itens = await conn.db
        .select({
          id: devolucaoItens.id,
          devolucao_id: devolucaoItens.devolucaoId,
          caixa_id: devolucaoItens.caixaId,
          ean_caixa: devolucaoItens.eanCaixa,
          produto_id: devolucaoItens.produtoId,
          produto_codigo: devolucaoItens.produtoCodigo,
          produto_descricao: devolucaoItens.produtoDescricao,
          lote: devolucaoItens.lote,
          validade: devolucaoItens.validade,
          peso_kg: devolucaoItens.pesoKg,
          preco_unitario: devolucaoItens.precoUnitario,
          pedido_id: devolucaoItens.pedidoId,
          pedido_codigo: devolucaoItens.pedidoCodigo,
          romaneio_id: devolucaoItens.romaneioId,
          romaneio_codigo: devolucaoItens.romaneioCodigo,
          cliente_nome: devolucaoItens.clienteNome,
          caixa_status_atual: estoqueCaixas.status,
          caixa_endereco_atual: estoqueCaixas.endereco,
        })
        .from(devolucaoItens)
        .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, devolucaoItens.caixaId))
        .where(inArray(devolucaoItens.devolucaoId, devIds))

      const byDev = new Map<string, typeof itens>()
      for (const it of itens) {
        const arr = byDev.get(it.devolucao_id) || []
        arr.push(it)
        byDev.set(it.devolucao_id, arr)
      }

      return {
        data: lista.map((d) => ({
          id: d.id,
          codigo: d.codigo,
          motivo: d.motivo,
          motivo_label: MOTIVOS_DEVOLUCAO_LABEL[d.motivo] || d.motivo,
          acao_estoque: d.acaoEstoque,
          endereco_destino: d.enderecoDestino,
          pedido_id: d.pedidoId,
          pedido_codigo: d.pedidoCodigo,
          romaneio_id: d.romaneioId,
          romaneio_codigo: d.romaneioCodigo,
          cliente_nome: d.clienteNome,
          observacoes: d.observacoes,
          status: d.status,
          status_fiscal: d.statusFiscal,
          numero_nf_devolucao: d.numeroNfDevolucao,
          qtd_caixas: d.qtdCaixas,
          peso_total_kg: toNum(d.pesoTotalKg, 0),
          valor_estimado: toNum(d.valorEstimado, 0),
          operador_nome: d.operadorNome,
          fiscal_tratado_por_nome: d.fiscalTratadoPorNome,
          fiscal_tratado_em: d.fiscalTratadoEm,
          created_at: d.createdAt,
          itens: (byDev.get(d.id) || []).map((i) => ({
            ...i,
            peso_kg: toNum(i.peso_kg, 0),
            preco_unitario: toNum(i.preco_unitario, 0),
          })),
        })),
      }
    },
  )

  // Finaliza devolução física em lote e dispara pendência desacoplada para o Faturamento
  app.post(
    '/api/devolucoes',
    { preHandler: requirePermission(PERM_DEV_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        eans?: string[]
        motivo?: string
        acao_estoque?: 'DISPONIVEL' | 'BLOQUEADO'
        endereco_destino?: string
        observacoes?: string
      }

      const eansRaw = Array.isArray(body.eans)
        ? Array.from(new Set(body.eans.map((e) => String(e || '').trim()).filter(Boolean)))
        : []
      if (eansRaw.length === 0) {
        throw new HttpError(400, 'Bipe ao menos 1 caixa antes de finalizar a devolução.')
      }

      const motivo = String(body.motivo || '').trim().toUpperCase()
      if (!MOTIVOS_DEVOLUCAO_LABEL[motivo]) {
        throw new HttpError(
          400,
          'Selecione um motivo válido (VALIDADE, DIVERGENCIA_PEDIDO, LOCAL_FECHADO, AVARIA ou OUTROS).',
        )
      }

      const acaoEstoque = body.acao_estoque === 'BLOQUEADO' ? 'BLOQUEADO' : 'DISPONIVEL'
      const enderecoDestino = String(body.endereco_destino || 'REC').trim().toUpperCase() || 'REC'

      const result = await conn.db.transaction(async (tx) => {
        await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [enderecoDestino])

        const lockRes = await tx.execute(sql`
          SELECT ec.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, p.valor_unitario AS prod_valor_unitario
          FROM estoque_caixas ec
          JOIN produtos p ON p.id = ec.produto_id
          WHERE ec.tenant_id = ${ctx.tenantId}
            AND ec.ean_caixa IN (${sql.join(eansRaw.map((e) => sql`${e}`), sql`, `)})
          FOR UPDATE OF ec
        `)

        const foundMap = new Map(
          lockRes.rows.map((r: any) => [String(r.ean_caixa), r]),
        )

        const resolvidas: Array<{
          caixaId: string
          eanCaixa: string
          filialOrigemId: string
          enderecoOrigem: string
          produtoId: string
          produtoCodigo: string
          produtoDescricao: string
          lote: string
          validade: string | null
          pesoKg: number
          precoUnitario: number
          pedidoId: string | null
          pedidoCodigo: string
          romaneioId: string | null
          romaneioCodigo: string
          clienteNome: string
        }> = []

        for (const ean of eansRaw) {
          const cx = foundMap.get(ean) as Record<string, any> | undefined
          if (!cx) {
            throw new HttpError(404, `Caixa "${ean}" não encontrada no sistema.`)
          }
          if (cx.status !== 'SAIDA' && cx.status !== 'EXPEDIDA') {
            throw new HttpError(
              409,
              `A caixa "${ean}" está com status "${cx.status}" e não pode ser devolvida novamente.`,
            )
          }

          const origem = await localizarUltimoEmbarqueCaixa(tx, ctx.tenantId, String(cx.id), String(cx.produto_id))
          const peso = toNum(cx.peso_kg, 0)
          const preco = origem.preco_unitario > 0 ? origem.preco_unitario : toNum(cx.prod_valor_unitario, 0)

          resolvidas.push({
            caixaId: String(cx.id),
            eanCaixa: String(cx.ean_caixa),
            filialOrigemId: String(cx.filial_id),
            enderecoOrigem: String(cx.endereco || 'SAIDA'),
            produtoId: String(cx.produto_id),
            produtoCodigo: String(cx.produto_codigo || ''),
            produtoDescricao: String(cx.produto_descricao || ''),
            lote: String(cx.lote || ''),
            validade: cx.validade ? String(cx.validade).slice(0, 10) : null,
            pesoKg: peso,
            precoUnitario: preco,
            pedidoId: origem.pedido_id,
            pedidoCodigo: origem.pedido_codigo,
            romaneioId: origem.romaneio_id,
            romaneioCodigo: origem.romaneio_codigo,
            clienteNome: origem.cliente_nome,
          })
        }

        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'DEVOLUCAO', 'DEV', 4)
        const devId = uuidv7()
        const pesoTotalKg = Number(resolvidas.reduce((s, r) => s + r.pesoKg, 0).toFixed(3))
        const valorEstimado = Number(resolvidas.reduce((s, r) => s + r.pesoKg * r.precoUnitario, 0).toFixed(2))

        const pedidosUnicos = Array.from(new Set(resolvidas.map((r) => r.pedidoCodigo).filter(Boolean)))
        const romaneiosUnicos = Array.from(new Set(resolvidas.map((r) => r.romaneioCodigo).filter(Boolean)))
        const clientesUnicos = Array.from(new Set(resolvidas.map((r) => r.clienteNome).filter(Boolean)))

        const pedidoIdHeader = resolvidas.find((r) => r.pedidoId)?.pedidoId || null
        const romaneioIdHeader = resolvidas.find((r) => r.romaneioId)?.romaneioId || null
        const pedidoCodigoResumo = pedidosUnicos.join(', ')
        const romaneioCodigoResumo = romaneiosUnicos.join(', ')
        const clienteResumo = clientesUnicos.join(', ')

        await tx.insert(devolucoes).values({
          id: devId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          motivo,
          acaoEstoque,
          enderecoDestino,
          pedidoId: pedidoIdHeader,
          pedidoCodigo: pedidoCodigoResumo,
          romaneioId: romaneioIdHeader,
          romaneioCodigo: romaneioCodigoResumo,
          clienteNome: clienteResumo,
          observacoes: String(body.observacoes || '').trim(),
          status: 'CONCLUIDA_FISICA',
          statusFiscal: 'PENDENTE_FATURAMENTO',
          qtdCaixas: resolvidas.length,
          pesoTotalKg: toDec(pesoTotalKg, 3),
          valorEstimado: toDec(valorEstimado, 2),
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        await tx.insert(devolucaoItens).values(
          resolvidas.map((r) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            devolucaoId: devId,
            caixaId: r.caixaId,
            eanCaixa: r.eanCaixa,
            produtoId: r.produtoId,
            produtoCodigo: r.produtoCodigo,
            produtoDescricao: r.produtoDescricao,
            lote: r.lote,
            validade: r.validade,
            pesoKg: toDec(r.pesoKg, 3),
            precoUnitario: toDec(r.precoUnitario, 2),
            pedidoId: r.pedidoId,
            pedidoCodigo: r.pedidoCodigo,
            romaneioId: r.romaneioId,
            romaneioCodigo: r.romaneioCodigo,
            clienteNome: r.clienteNome,
          })),
        )

        const cIds = resolvidas.map((r) => r.caixaId)
        await tx
          .update(estoqueCaixas)
          .set({
            status: acaoEstoque,
            endereco: enderecoDestino,
            filialId: ctx.filialId,
            paleteId: null,
            pedidoReservadoId: null,
            pedidoReservadoCodigo: null,
            romaneioReservadoId: null,
            romaneioReservadoCodigo: null,
            clienteReservadoNome: null,
            reservadoEm: null,
            updatedAt: new Date(),
          })
          .where(inArray(estoqueCaixas.id, cIds))

        const motivoLabel = MOTIVOS_DEVOLUCAO_LABEL[motivo] || motivo
        const statusDesc = acaoEstoque === 'BLOQUEADO' ? 'QUARENTENA / BLOQUEADO' : 'DISPONIVEL NO ESTOQUE'
        const porGrupo = new Map<string, { cxs: number; kg: number; lote: string; prodId: string }>()
        const endsAfetados = new Set<string>([enderecoDestino])

        for (const r of resolvidas) {
          endsAfetados.add(r.enderecoOrigem)
          await registrarHistoricoCaixa(tx, {
            tenantId: ctx.tenantId,
            caixaId: r.caixaId,
            eanCaixa: r.eanCaixa,
            operacao: 'DEVOLUCAO',
            detalhes: `Retornou via ${codigo} (${motivoLabel}) • ${statusDesc} em ${enderecoDestino}${r.pedidoCodigo ? ` • Origem: ${r.pedidoCodigo}` : ''}`,
            operadorNome: ctx.operador.nome,
          })

          const k = `${r.produtoId}__${r.lote}`
          const cur = porGrupo.get(k) || { cxs: 0, kg: 0, lote: r.lote, prodId: r.produtoId }
          cur.cxs += 1
          cur.kg += r.pesoKg
          porGrupo.set(k, cur)
        }

        for (const g of porGrupo.values()) {
          await registrarMovimentacaoLog(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: g.prodId,
            enderecoOrigem: 'SAIDA',
            enderecoDestino,
            lote: g.lote,
            qtdCaixas: g.cxs,
            qtdKg: g.kg,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
            tipo: 'DEVOLUCAO',
            numPedido: pedidoCodigoResumo || codigo,
            cliente: clienteResumo || '-',
          })
        }

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...endsAfetados])

        // Desacoplamento Físico x Fiscal: cria tarefa para Faturamento emitir NF Devolução / ajustar título
        await tx.insert(pendenciasSetor).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          setorDestino: 'FATURAMENTO',
          tipoPendencia: 'DEVOLUCAO_FISCAL',
          referenciaTabela: 'devolucoes',
          referenciaId: devId,
          titulo: `${codigo} • Devolução física de ${resolvidas.length} cx (${pesoTotalKg.toFixed(2)} kg) [${motivoLabel}]${pedidoCodigoResumo ? ` — Ped. ${pedidoCodigoResumo}` : ''}${clienteResumo ? ` (${clienteResumo})` : ''}`,
          prioridade: motivo === 'VALIDADE' ? 3 : 2,
          status: 'PENDENTE',
        })

        return {
          id: devId,
          codigo,
          motivo,
          motivo_label: motivoLabel,
          acao_estoque: acaoEstoque,
          endereco_destino: enderecoDestino,
          pedido_codigo: pedidoCodigoResumo,
          romaneio_codigo: romaneioCodigoResumo,
          cliente_nome: clienteResumo,
          qtd_caixas: resolvidas.length,
          peso_total_kg: pesoTotalKg,
          valor_estimado: valorEstimado,
        }
      })

      return reply.code(201).send({ success: true, ...result })
    },
  )

  // Faturamento marca a tratativa fiscal (nº NF de Devolução ou Dispensa) sem afetar o físico já reintegrado
  app.post(
    '/api/devolucoes/:id/tratar-fiscal',
    { preHandler: requirePermission(['pedidos', 'devolucao', 'financeiro_pedidos']) },
    async (req) => {
      const ctx = req.authCtx!
      const devId = parseUuidOrBadRequest((req.params as { id: string }).id, 'devolucao_id')
      const body = (req.body || {}) as {
        status_fiscal?: 'NF_DEVOLUCAO_EMITIDA' | 'DISPENSA_FISCAL'
        numero_nf_devolucao?: string
        observacoes?: string
      }
      const nextStatus = body.status_fiscal === 'DISPENSA_FISCAL' ? 'DISPENSA_FISCAL' : 'NF_DEVOLUCAO_EMITIDA'
      const nfNum = String(body.numero_nf_devolucao || '').trim()
      if (nextStatus === 'NF_DEVOLUCAO_EMITIDA' && !nfNum) {
        throw new HttpError(400, 'Informe o número da NF-e de Devolução / Estorno.')
      }

      await conn.db.transaction(async (tx) => {
        const [dev] = await tx
          .select()
          .from(devolucoes)
          .where(and(eq(devolucoes.id, devId), eq(devolucoes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!dev) throw new HttpError(404, 'Registro de devolução não encontrado.')

        await tx
          .update(devolucoes)
          .set({
            statusFiscal: nextStatus,
            numeroNfDevolucao: nfNum,
            observacoes: body.observacoes !== undefined ? String(body.observacoes).trim() : dev.observacoes,
            fiscalTratadoPorNome: ctx.operador.nome,
            fiscalTratadoEm: new Date(),
          })
          .where(eq(devolucoes.id, devId))

        await tx
          .update(pendenciasSetor)
          .set({
            status: 'CONCLUIDA',
            concluidaPorId: ctx.operador.id,
            concluidaAt: new Date(),
          })
          .where(
            and(
              eq(pendenciasSetor.tenantId, ctx.tenantId),
              eq(pendenciasSetor.referenciaTabela, 'devolucoes'),
              eq(pendenciasSetor.referenciaId, devId),
            ),
          )
      })

      return { success: true }
    },
  )

  // Libera uma caixa que entrou em Quarentena (BLOQUEADO) de volta para DISPONIVEL após inspeção
  app.post(
    '/api/devolucoes/caixas/:caixaId/liberar-quarentena',
    { preHandler: requirePermission(['devolucao', 'movimentacao', 'recebimento', 'inventario_gestao']) },
    async (req) => {
      const ctx = req.authCtx!
      const caixaId = parseUuidOrBadRequest((req.params as { caixaId: string }).caixaId, 'caixa_id')
      const body = (req.body || {}) as { endereco_destino?: string }

      const resLib = await conn.db.transaction(async (tx) => {
        const [cx] = await tx
          .select()
          .from(estoqueCaixas)
          .where(and(eq(estoqueCaixas.id, caixaId), eq(estoqueCaixas.tenantId, ctx.tenantId)))
          .limit(1)
        if (!cx) throw new HttpError(404, 'Caixa não encontrada.')
        if (cx.status !== 'BLOQUEADO') {
          throw new HttpError(409, `Esta caixa está com status "${cx.status}" (não está bloqueada em quarentena).`)
        }

        const endFinal = String(body.endereco_destino || cx.endereco || 'REC').trim().toUpperCase() || 'REC'
        await assertEnderecosNaoBloqueados(tx, ctx.tenantId, ctx.filialId, [endFinal])

        await tx
          .update(estoqueCaixas)
          .set({ status: 'DISPONIVEL', endereco: endFinal, updatedAt: new Date() })
          .where(eq(estoqueCaixas.id, caixaId))

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId,
          eanCaixa: cx.eanCaixa,
          operacao: 'LIBERACAO_QUARENTENA',
          detalhes: `Liberada da quarentena de devolução para DISPONÍVEL em ${endFinal}`,
          operadorNome: ctx.operador.nome,
        })

        const endsAfetados = [cx.endereco, endFinal].filter(Boolean) as string[]
        await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, endsAfetados)

        return { ean_caixa: cx.eanCaixa, endereco: endFinal }
      })

      return { success: true, ...resLib }
    },
  )
}
