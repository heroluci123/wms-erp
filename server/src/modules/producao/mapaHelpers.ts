import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  clienteProdutoEspec,
  mapaEspecificacoesPadrao,
  produtoArvore,
} from '../../db/schema/index.js'
import { uuidv7 } from '../../utils/uuid.js'
import { toNum } from '../wms/helpers.js'

type TxOrDb = DbConnection['db'] | Parameters<Parameters<DbConnection['db']['transaction']>[0]>[0]

export async function carregarMapasEspecificacoes(
  dbOrTx: TxOrDb,
  params: { tenantId: string; produtoIds: string[] },
) {
  const { tenantId, produtoIds } = params
  if (produtoIds.length === 0) {
    return {
      especPadraoRows: [] as Array<typeof mapaEspecificacoesPadrao.$inferSelect>,
      cliEspecRows: [] as Array<typeof clienteProdutoEspec.$inferSelect>,
      arvMap: new Map<string, { paiId: string; rend: number }>(),
    }
  }

  const [especPadraoRows, cliEspecRows, arvRows] = await Promise.all([
    dbOrTx
      .select()
      .from(mapaEspecificacoesPadrao)
      .where(and(eq(mapaEspecificacoesPadrao.tenantId, tenantId), inArray(mapaEspecificacoesPadrao.produtoId, produtoIds))),
    dbOrTx
      .select()
      .from(clienteProdutoEspec)
      .where(and(eq(clienteProdutoEspec.tenantId, tenantId), inArray(clienteProdutoEspec.produtoId, produtoIds))),
    dbOrTx
      .select()
      .from(produtoArvore)
      .where(and(eq(produtoArvore.tenantId, tenantId), inArray(produtoArvore.filhoId, produtoIds)))
      .orderBy(desc(produtoArvore.confirmado), desc(produtoArvore.amostrasAprendizado)),
  ])

  const arvMap = new Map<string, { paiId: string; rend: number }>()
  for (const a of arvRows) {
    if (!arvMap.has(a.filhoId)) {
      const r = toNum(a.rendimentoAprendidoPct ?? a.rendimentoEsperadoPct, 100)
      arvMap.set(a.filhoId, { paiId: a.paiId, rend: r > 5 && r <= 100 ? r : 100 })
    }
  }

  return { especPadraoRows, cliEspecRows, arvMap }
}

export function resolverEspecificacaoParaItem(
  cache: Awaited<ReturnType<typeof carregarMapasEspecificacoes>>,
  params: {
    produtoId: string
    clienteId?: string | null
    grupoProduto?: string | null
    observacaoItem?: string | null
  },
) {
  const { especPadraoRows, cliEspecRows, arvMap } = cache
  const especCliente = params.clienteId
    ? especPadraoRows.find((e) => e.produtoId === params.produtoId && e.clienteId === params.clienteId)
    : undefined
  const especGeral = especPadraoRows.find((e) => e.produtoId === params.produtoId && !e.clienteId)
  const cliProdEspec = params.clienteId
    ? cliEspecRows.find((e) => e.produtoId === params.produtoId && e.clienteId === params.clienteId)
    : undefined

  const escolhida = especCliente || especGeral
  const especificacao = String(
    escolhida?.especificacao || cliProdEspec?.especificacaoCorte || params.observacaoItem || '',
  ).trim()
  const conservacao = String(escolhida?.conservacao || 'RESFRIADO').trim().toUpperCase() || 'RESFRIADO'
  const grupoMapa = String(escolhida?.grupoMapa || params.grupoProduto || '').trim().toUpperCase()
  const arv = arvMap.get(params.produtoId)
  const materiaPrimaId = escolhida?.materiaPrimaId || arv?.paiId || null
  const rendimentoPct = arv?.rend || 100

  return {
    especificacao,
    conservacao,
    grupoMapa,
    materiaPrimaId,
    rendimentoPct,
  }
}

export async function upsertEspecificacaoMapa(
  tx: TxOrDb,
  params: {
    tenantId: string
    produtoId: string
    clienteId?: string | null
    especificacao?: string
    conservacao?: string
    grupoMapa?: string
    materiaPrimaId?: string | null
  },
): Promise<void> {
  const espec = String(params.especificacao || '').trim()
  const cons = String(params.conservacao || 'RESFRIADO').trim().toUpperCase() || 'RESFRIADO'
  const grp = String(params.grupoMapa || '').trim().toUpperCase()
  const mpId = params.materiaPrimaId || null
  if (!espec && !mpId && !grp) return

  const cond = [
    eq(mapaEspecificacoesPadrao.tenantId, params.tenantId),
    eq(mapaEspecificacoesPadrao.produtoId, params.produtoId),
    params.clienteId ? eq(mapaEspecificacoesPadrao.clienteId, params.clienteId) : isNull(mapaEspecificacoesPadrao.clienteId),
  ]

  const [exist] = await tx.select().from(mapaEspecificacoesPadrao).where(and(...cond)).limit(1)
  if (exist) {
    await tx
      .update(mapaEspecificacoesPadrao)
      .set({
        especificacao: espec || exist.especificacao,
        conservacao: cons || exist.conservacao,
        grupoMapa: grp || exist.grupoMapa,
        materiaPrimaId: mpId !== null ? mpId : exist.materiaPrimaId,
        updatedAt: new Date(),
      })
      .where(eq(mapaEspecificacoesPadrao.id, exist.id))
  } else {
    await tx.insert(mapaEspecificacoesPadrao).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      clienteId: params.clienteId || null,
      produtoId: params.produtoId,
      especificacao: espec,
      conservacao: cons,
      grupoMapa: grp,
      materiaPrimaId: mpId,
    })
  }
}
