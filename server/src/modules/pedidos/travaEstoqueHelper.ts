import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import { estoqueCaixas, pendenciasSetor, produtos } from '../../db/schema/index.js'
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
    itens: Array<{ produto_id: string; qtd_kg_solicitada: number }>
  },
): Promise<{ suficiente: boolean; insuficientes: ItemInsuficiente[] }> {
  if (!params.itens.length) return { suficiente: true, insuficientes: [] }
  const prodIds = [...new Set(params.itens.map((i) => i.produto_id))]

  const [saldosRes, prodsRes] = await Promise.all([
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
  ])

  const saldoMap = new Map(saldosRes.map((s) => [s.produto_id, toNum(s.saldo_kg, 0)]))
  const prodMap = new Map(prodsRes.map((p) => [p.id, p]))
  const insuficientes: ItemInsuficiente[] = []

  for (const it of params.itens) {
    const sol = toNum(it.qtd_kg_solicitada, 0)
    const disp = saldoMap.get(it.produto_id) || 0
    if (sol > disp + 0.001) {
      const p = prodMap.get(it.produto_id)
      insuficientes.push({
        produto_id: it.produto_id,
        codigo: p?.codigo || '',
        descricao: p?.descricao || 'Produto',
        solicitado_kg: Number(sol.toFixed(3)),
        disponivel_kg: Number(disp.toFixed(3)),
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
