import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  estoqueCaixas,
  pedidos,
  pedidosItens,
  pendenciasSetor,
  produtos,
  romaneios,
  romaneiosItens,
} from '../../db/schema/index.js'
import { uuidv7 } from '../../utils/uuid.js'
import { toNum } from '../wms/helpers.js'

type TxOrDb = DbConnection['db'] | Parameters<Parameters<DbConnection['db']['transaction']>[0]>[0]

export interface ItemInsuficiente {
  produto_id: string
  codigo: string
  descricao: string
  solicitado_kg: number
  disponivel_kg: number
  deficit_kg: number
}

export async function verificarEstoquePedido(
  tx: TxOrDb,
  params: {
    tenantId: string
    filialId: string
    ignorePedidoId?: string
    itens: Array<{ produto_id: string; qtd_kg_solicitada: number }>
  },
): Promise<{ suficiente: boolean; insuficientes: ItemInsuficiente[] }> {
  if (!params.itens.length) return { suficiente: true, insuficientes: [] }
  const prodIds = [...new Set(params.itens.map((i) => i.produto_id))]

  const condOutros = [
    eq(pedidos.tenantId, params.tenantId),
    eq(pedidos.filialId, params.filialId),
    inArray(pedidos.status, ['LIBERADO', 'EM_SEPARACAO']),
    inArray(pedidosItens.produtoId, prodIds),
  ]
  if (params.ignorePedidoId) {
    condOutros.push(ne(pedidos.id, params.ignorePedidoId))
  }

  const [saldosRes, prodsRes, outrosPedsRes, outrosSepRes] = await Promise.all([
    tx
      .select({
        produto_id: estoqueCaixas.produtoId,
        saldo_kg: sql<string>`COALESCE(ROUND(SUM(${estoqueCaixas.pesoKg}), 3), 0)`,
      })
      .from(estoqueCaixas)
      .where(
        and(
          eq(estoqueCaixas.tenantId, params.tenantId),
          eq(estoqueCaixas.filialId, params.filialId),
          eq(estoqueCaixas.status, 'DISPONIVEL'),
          inArray(estoqueCaixas.produtoId, prodIds),
        ),
      )
      .groupBy(estoqueCaixas.produtoId),
    tx
      .select({ id: produtos.id, codigo: produtos.codigo, descricao: produtos.descricao })
      .from(produtos)
      .where(inArray(produtos.id, prodIds)),
    tx
      .select({
        pedido_id: pedidos.id,
        produto_id: pedidosItens.produtoId,
        qtd_solicitada: pedidosItens.qtdKgSolicitada,
      })
      .from(pedidosItens)
      .innerJoin(pedidos, eq(pedidos.id, pedidosItens.pedidoId))
      .where(and(...condOutros)),
    tx
      .select({
        pedido_id: romaneios.pedidoId,
        produto_id: romaneiosItens.produtoId,
        kg_separado: sql<string>`COALESCE(SUM(${romaneiosItens.pesoKg}), 0)`,
      })
      .from(romaneiosItens)
      .innerJoin(romaneios, eq(romaneios.id, romaneiosItens.romaneioId))
      .innerJoin(pedidos, eq(pedidos.id, romaneios.pedidoId))
      .where(
        and(
          eq(pedidos.tenantId, params.tenantId),
          eq(pedidos.filialId, params.filialId),
          inArray(pedidos.status, ['LIBERADO', 'EM_SEPARACAO']),
          inArray(romaneiosItens.produtoId, prodIds),
        ),
      )
      .groupBy(romaneios.pedidoId, romaneiosItens.produtoId),
  ])

  const sepMap = new Map<string, number>()
  for (const s of outrosSepRes) {
    if (!s.pedido_id) continue
    sepMap.set(`${s.pedido_id}_${s.produto_id}`, toNum(s.kg_separado, 0))
  }

  const comprometidoMap = new Map<string, number>()
  for (const o of outrosPedsRes) {
    const jaSep = sepMap.get(`${o.pedido_id}_${o.produto_id}`) || 0
    const pend = Math.max(0, toNum(o.qtd_solicitada, 0) - jaSep)
    comprometidoMap.set(o.produto_id, (comprometidoMap.get(o.produto_id) || 0) + pend)
  }

  const saldoMap = new Map(saldosRes.map((s) => [s.produto_id, toNum(s.saldo_kg, 0)]))
  const prodMap = new Map(prodsRes.map((p) => [p.id, p]))
  const insuficientes: ItemInsuficiente[] = []

  for (const it of params.itens) {
    const sol = toNum(it.qtd_kg_solicitada, 0)
    const fisico = saldoMap.get(it.produto_id) || 0
    const comprometidoOutros = comprometidoMap.get(it.produto_id) || 0
    const disp = Math.max(0, Number((fisico - comprometidoOutros).toFixed(3)))
    if (sol > disp + 0.001) {
      const p = prodMap.get(it.produto_id)
      insuficientes.push({
        produto_id: it.produto_id,
        codigo: p?.codigo || '',
        descricao: p?.descricao || 'Produto',
        solicitado_kg: Number(sol.toFixed(3)),
        disponivel_kg: disp,
        deficit_kg: Number((sol - disp).toFixed(3)),
      })
    }
  }

  return { suficiente: insuficientes.length === 0, insuficientes }
}

export async function registrarPendenciaTravaEstoque(
  tx: TxOrDb,
  params: {
    tenantId: string
    filialId: string
    pedidoId: string
    codigoPedido: string
    clienteNome: string
    insuficientes: ItemInsuficiente[]
  },
): Promise<void> {
  const resumo = params.insuficientes
    .slice(0, 3)
    .map((x) => `${x.codigo ? `[${x.codigo}] ` : ''}${x.descricao} (falta ${x.deficit_kg.toFixed(2)} kg)`)
    .join(', ')
  const sufixoMais = params.insuficientes.length > 3 ? ` +${params.insuficientes.length - 3}` : ''
  const titulo = `${params.codigoPedido} — ${params.clienteNome}: Estoque insuficiente (${resumo}${sufixoMais}). Cadeado aguardando liberação p/ operação.`

  const [existente] = await tx
    .select({ id: pendenciasSetor.id })
    .from(pendenciasSetor)
    .where(
      and(
        eq(pendenciasSetor.tenantId, params.tenantId),
        eq(pendenciasSetor.referenciaId, params.pedidoId),
        eq(pendenciasSetor.tipoPendencia, 'TRAVA_ESTOQUE_PEDIDO'),
        sql`${pendenciasSetor.status} != 'CONCLUIDA'`,
      ),
    )
    .limit(1)

  if (existente) {
    await tx
      .update(pendenciasSetor)
      .set({ titulo, prioridade: 4 })
      .where(eq(pendenciasSetor.id, existente.id))
  } else {
    await tx.insert(pendenciasSetor).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      filialId: params.filialId,
      setorDestino: 'SUPPLY_CHAIN',
      tipoPendencia: 'TRAVA_ESTOQUE_PEDIDO',
      referenciaTabela: 'pedidos',
      referenciaId: params.pedidoId,
      titulo,
      prioridade: 4,
      status: 'PENDENTE',
    })
  }
}
