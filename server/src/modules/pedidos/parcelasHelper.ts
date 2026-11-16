import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { formasPagamento, pedidosParcelas } from '../../db/schema/index.js'
import type * as schema from '../../db/schema/index.js'
import { uuidv7 } from '../../utils/uuid.js'
import { normalizarDataIso, toDec } from '../wms/helpers.js'

type TxDb = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'delete'>

export async function calcularESalvarParcelas(
  tx: TxDb,
  params: {
    tenantId: string
    pedidoId: string
    formaPagamentoId: string | null | undefined
    valorTotal: number
    dataBaseIso?: string | null
  }
) {
  await tx.delete(pedidosParcelas).where(eq(pedidosParcelas.pedidoId, params.pedidoId))
  if (!params.formaPagamentoId || params.valorTotal <= 0) return []

  const [fp] = await tx
    .select()
    .from(formasPagamento)
    .where(eq(formasPagamento.id, params.formaPagamentoId))
    .limit(1)
  if (!fp) return []

  const dias =
    Array.isArray(fp.diasParcelasJson) && fp.diasParcelasJson.length > 0
      ? fp.diasParcelasJson
      : [0]

  const baseDate = normalizarDataIso(params.dataBaseIso) || new Date().toISOString().slice(0, 10)
  const baseMs = new Date(`${baseDate}T12:00:00Z`).getTime()
  let somaParc = 0

  const rows = dias.map((d, idx) => {
    const isLast = idx === dias.length - 1
    const val = isLast
      ? Number((params.valorTotal - somaParc).toFixed(2))
      : Number((params.valorTotal / dias.length).toFixed(2))
    somaParc += val
    const venc = new Date(baseMs + Number(d || 0) * 86400000).toISOString().slice(0, 10)
    return {
      id: uuidv7(),
      tenantId: params.tenantId,
      pedidoId: params.pedidoId,
      numeroParcela: idx + 1,
      diasPrazo: Number(d || 0),
      vencimento: venc,
      valor: toDec(val, 2),
    }
  })

  if (rows.length > 0) {
    await tx.insert(pedidosParcelas).values(rows)
  }
  return rows
}
