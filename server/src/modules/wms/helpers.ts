import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  caixasHistorico,
  eanSequencias,
  estoqueCaixas,
  estoquePosicao,
  filiais,
  inventarioItens,
  inventarios,
  movimentacoesLog,
  naturezasOperacao,
  ordensProducao,
  paletes,
  pedidos,
  produtos,
  romaneios,
  tabelasPreco,
  taras,
  tenants,
} from '../../db/schema/index.js'
import { HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'

export type DbOrTx = Pick<
  DbConnection['db'],
  'select' | 'insert' | 'update' | 'delete' | 'execute' | 'query'
>

export const ENDERECOS_ESPECIAIS_EXCLUSOS = ['REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO', 'PRODUCAO']

export function toNum(val: unknown, fallback = 0): number {
  if (val == null || val === '') return fallback
  const n = typeof val === 'string' ? Number(val.replace(',', '.')) : Number(val)
  return Number.isFinite(n) ? n : fallback
}

export function toDec(val: number, scale = 3): string {
  return Number(val || 0).toFixed(scale)
}

export function parseUuidOrBadRequest(val: unknown, label = 'ID'): string {
  const s = String(val ?? '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new HttpError(400, `${label} inválido.`)
  }
  return s
}

export function hojeIsoLocal(): string {
  const now = new Date(Date.now() - 3 * 3600 * 1000)
  return now.toISOString().slice(0, 10)
}

export function normalizarDataIso(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()
  if (!s) return null
  const mIso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (mIso) return mIso[1]
  const mBr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (mBr) return `${mBr[3]}-${mBr[2]}-${mBr[1]}`
  return null
}

/** Gera lote no padrão frigorífico DDMMAA a partir da data de produção YYYY-MM-DD */
export function gerarLotePorData(dataProducao: unknown): string {
  const iso = normalizarDataIso(dataProducao)
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}${m}${y.slice(-2)}`
}

export function calcularPesoLiquido(pesoBrutoKg: unknown, taraKg: unknown = 0): number {
  const bruto = toNum(pesoBrutoKg, NaN)
  const tara = toNum(taraKg, 0)
  if (!Number.isFinite(bruto)) return NaN
  return Number((bruto - (Number.isFinite(tara) ? tara : 0)).toFixed(3))
}

export interface PesagemValidada {
  dataProducao: string | null
  validade: string | null
  lote: string
  taraId: string | null
  taraKg: number
  pesoBrutoKg: number
  pesoLiquidoKg: number
  qtdPecas: number | null
}

export function validarPesagemTaraPayload(input: {
  data_producao?: unknown
  validade?: unknown
  lote?: unknown
  peso_bruto_kg?: unknown
  tara_id?: unknown
  tara_kg?: unknown
  qtd_pecas?: unknown
  exigirDataProducao?: boolean
  exigirValidade?: boolean
  exigirTara?: boolean
  exigirQtdPecas?: boolean
}): PesagemValidada {
  const exigirDataProducao = input.exigirDataProducao ?? true
  const exigirValidade = input.exigirValidade ?? true
  const exigirTara = input.exigirTara ?? true
  const exigirQtdPecas = input.exigirQtdPecas ?? true

  const dataProducao = normalizarDataIso(input.data_producao)
  if (exigirDataProducao && !dataProducao) {
    throw new HttpError(400, 'Informe a Data de Produção válida.')
  }

  const validade = normalizarDataIso(input.validade)
  if (exigirValidade && !validade) {
    throw new HttpError(400, 'Informe a Data de Validade válida.')
  }

  if (dataProducao && validade && validade < dataProducao) {
    throw new HttpError(400, 'A Validade não pode ser anterior à Data de Produção.')
  }

  const taraNum = toNum(input.tara_kg, NaN)
  if (exigirTara && (!Number.isFinite(taraNum) || taraNum < 0)) {
    throw new HttpError(400, 'Selecione uma Tara válida.')
  }
  const taraKg = Number.isFinite(taraNum) ? Number(taraNum.toFixed(3)) : 0

  const brutoNum = toNum(input.peso_bruto_kg, NaN)
  if (!Number.isFinite(brutoNum) || brutoNum <= 0) {
    throw new HttpError(400, 'Informe um Peso Bruto válido maior que zero.')
  }
  const pesoBrutoKg = Number(brutoNum.toFixed(3))
  const pesoLiquidoKg = calcularPesoLiquido(pesoBrutoKg, taraKg)

  if (!Number.isFinite(pesoLiquidoKg) || pesoLiquidoKg <= 0) {
    throw new HttpError(
      400,
      `O Peso Bruto (${pesoBrutoKg.toFixed(3)} kg) deve ser maior que a Tara selecionada (${taraKg.toFixed(3)} kg).`,
    )
  }

  const pecasNum = toNum(input.qtd_pecas, NaN)
  const pecasInt = Number.isFinite(pecasNum) ? Math.trunc(pecasNum) : NaN
  if (exigirQtdPecas && (!Number.isFinite(pecasNum) || pecasInt <= 0 || pecasInt !== pecasNum)) {
    throw new HttpError(400, 'Informe a Quantidade de Peças (número inteiro maior que zero).')
  }

  const qtdPecas = Number.isFinite(pecasInt) && pecasInt > 0 ? pecasInt : null
  const taraId = input.tara_id ? String(input.tara_id).trim() || null : null
  const loteInformado = String(input.lote || '').trim()
  const lote = loteInformado || gerarLotePorData(dataProducao)

  return {
    dataProducao,
    validade,
    lote,
    taraId,
    taraKg,
    pesoBrutoKg,
    pesoLiquidoKg,
    qtdPecas,
  }
}

export async function resolverTaraPeso(
  tx: DbOrTx,
  tenantId: string,
  taraId?: string | null,
  taraKgInformada?: unknown,
): Promise<{ taraId: string | null; taraKg: number }> {
  if (taraId) {
    const cleanId = parseUuidOrBadRequest(taraId, 'tara_id')
    const rows = await tx
      .select({ id: taras.id, pesoKg: taras.pesoKg })
      .from(taras)
      .where(and(eq(taras.id, cleanId), eq(taras.tenantId, tenantId)))
      .limit(1)
    if (rows[0]) {
      return {
        taraId: rows[0].id,
        taraKg: Number.isFinite(toNum(taraKgInformada, NaN))
          ? toNum(taraKgInformada, 0)
          : toNum(rows[0].pesoKg, 0),
      }
    }
  }
  return { taraId: null, taraKg: toNum(taraKgInformada, 0) }
}

export function montarEan16Interno(seqNum: number, codigoProduto = ''): string {
  const seq = String(Math.max(1, Number(seqNum) || 900001)).padStart(6, '0').slice(-6)
  const prod = String(codigoProduto || '000000').replace(/\D/g, '').padStart(6, '0').slice(-6)
  return `0025${seq}${prod}`
}

/**
 * Reserva sequência atômica por tenant + chave em PostgreSQL (ean_sequencias).
 */
export async function nextSequenceNumber(
  tx: DbOrTx,
  tenantId: string,
  chave: string,
  initialValue = 1,
): Promise<number> {
  const existing = await tx
    .select({ ultimoNumero: eanSequencias.ultimoNumero })
    .from(eanSequencias)
    .where(and(eq(eanSequencias.tenantId, tenantId), eq(eanSequencias.chave, chave)))
    .limit(1)

  if (existing.length === 0) {
    await tx
      .insert(eanSequencias)
      .values({
        id: uuidv7(),
        tenantId,
        chave,
        ultimoNumero: initialValue - 1,
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
  }

  const res = await tx.execute(sql`
    UPDATE ean_sequencias
    SET ultimo_numero = ultimo_numero + 1, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND chave = ${chave}
    RETURNING ultimo_numero
  `)
  const row = res.rows[0] as { ultimo_numero: number } | undefined
  return Number(row?.ultimo_numero || initialValue)
}

export async function gerarProximosEansInternos(
  tx: DbOrTx,
  tenantId: string,
  quantidade = 1,
  codigoProduto = '',
): Promise<string[]> {
  const qtd = Math.max(1, Math.min(200, Number(quantidade) || 1))
  const gerados: string[] = []

  for (let i = 0; i < qtd; i++) {
    let tentativas = 0
    while (tentativas < 25) {
      tentativas++
      const seqNum = await nextSequenceNumber(tx, tenantId, 'CAIXA_INTERNA', 900001)
      const ean = montarEan16Interno(seqNum, codigoProduto)
      const existe = await tx
        .select({ id: estoqueCaixas.id })
        .from(estoqueCaixas)
        .where(and(eq(estoqueCaixas.tenantId, tenantId), eq(estoqueCaixas.eanCaixa, ean)))
        .limit(1)
      if (existe.length === 0 && !gerados.includes(ean)) {
        gerados.push(ean)
        break
      }
    }
    if (gerados.length <= i) {
      throw new HttpError(500, 'Não foi possível gerar EAN interno único. Tente novamente.')
    }
  }
  return gerados
}

export async function gerarCodigoDocumento(
  tx: DbOrTx,
  tenantId: string,
  chave:
    | 'PALETE'
    | 'PEDIDO'
    | 'ROMANEIO'
    | 'OP'
    | 'DESM'
    | 'PEDIDO_COMPRA'
    | 'RECEBIMENTO'
    | 'MAPA_PRODUCAO'
    | 'EMBARQUE'
    | 'DEVOLUCAO'
    | 'FIN_PAGAR'
    | 'FIN_RECEBER'
    | 'INTERUNIDADES'
    | 'VAREJO_INV'
    | 'PDV_CAIXA'
    | 'PDV_VENDA'
    | 'ETQ_ACOUGUE'
    | 'TABELA_PRECO'
    | 'COTACAO_COMPRA'
    | 'PERDA_ESTOQUE',
  prefix: string,
  pad = 4,
): Promise<string> {
  let maxAtual = 0
  if (
    chave === 'PEDIDO' ||
    chave === 'ROMANEIO' ||
    chave === 'OP' ||
    chave === 'PALETE' ||
    chave === 'TABELA_PRECO'
  ) {
    let rows: Array<{ codigo: string }> = []
    if (chave === 'PEDIDO') {
      rows = await tx
        .select({ codigo: pedidos.codigo })
        .from(pedidos)
        .where(eq(pedidos.tenantId, tenantId))
        .orderBy(desc(pedidos.createdAt))
        .limit(20)
    } else if (chave === 'ROMANEIO') {
      rows = await tx
        .select({ codigo: romaneios.codigo })
        .from(romaneios)
        .where(eq(romaneios.tenantId, tenantId))
        .orderBy(desc(romaneios.createdAt))
        .limit(20)
    } else if (chave === 'OP') {
      rows = await tx
        .select({ codigo: ordensProducao.codigo })
        .from(ordensProducao)
        .where(eq(ordensProducao.tenantId, tenantId))
        .orderBy(desc(ordensProducao.createdAt))
        .limit(20)
    } else if (chave === 'TABELA_PRECO') {
      rows = await tx
        .select({ codigo: tabelasPreco.codigo })
        .from(tabelasPreco)
        .where(eq(tabelasPreco.tenantId, tenantId))
        .orderBy(desc(tabelasPreco.createdAt))
        .limit(50)
    } else {
      rows = await tx
        .select({ codigo: paletes.codigo })
        .from(paletes)
        .where(eq(paletes.tenantId, tenantId))
        .orderBy(desc(paletes.createdAt))
        .limit(20)
    }
    const re = new RegExp(`${prefix}-(\\d+)`, 'i')
    for (const r of rows) {
      const m = String(r.codigo || '').match(re)
      if (m) maxAtual = Math.max(maxAtual, parseInt(m[1], 10))
    }
  }

  const seq = await nextSequenceNumber(tx, tenantId, chave, Math.max(1, maxAtual + 1))
  const finalNum = Math.max(seq, maxAtual + 1)
  if (finalNum > seq) {
    await tx.execute(sql`
      UPDATE ean_sequencias SET ultimo_numero = ${finalNum}, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND chave = ${chave}
    `)
  }
  return `${prefix}-${String(finalNum).padStart(pad, '0')}`
}

/**
 * Recalcula estoque_posicao para endereços a partir de estoque_caixas (status = 'DISPONIVEL').
 * Deve ser chamado dentro da mesma transação após alterações de caixas.
 */
export async function recalcularPosicaoEnderecos(
  tx: DbOrTx,
  tenantId: string,
  filialId: string,
  enderecos: Array<string | null | undefined>,
): Promise<void> {
  const listaEnd = [...new Set(enderecos.map((e) => String(e || '').trim()).filter(Boolean))]
  if (listaEnd.length === 0) return

  const saldos = await tx
    .select({
      produtoId: estoqueCaixas.produtoId,
      endereco: sql<string>`COALESCE(${estoqueCaixas.endereco}, '')`,
      lote: sql<string>`COALESCE(${estoqueCaixas.lote}, '')`,
      validade: estoqueCaixas.validade,
      qtdCaixas: sql<number>`COUNT(*)::int`,
      qtdKg: sql<string>`ROUND(COALESCE(SUM(${estoqueCaixas.pesoKg}), 0), 3)`,
    })
    .from(estoqueCaixas)
    .where(
      and(
        eq(estoqueCaixas.tenantId, tenantId),
        eq(estoqueCaixas.filialId, filialId),
        eq(estoqueCaixas.status, 'DISPONIVEL'),
        inArray(estoqueCaixas.endereco, listaEnd),
      ),
    )
    .groupBy(
      estoqueCaixas.produtoId,
      estoqueCaixas.endereco,
      sql`COALESCE(${estoqueCaixas.lote}, '')`,
      estoqueCaixas.validade,
    )

  await tx
    .delete(estoquePosicao)
    .where(
      and(
        eq(estoquePosicao.tenantId, tenantId),
        eq(estoquePosicao.filialId, filialId),
        inArray(estoquePosicao.endereco, listaEnd),
      ),
    )

  const paraInserir = saldos
    .filter((s) => Number(s.qtdCaixas) > 0 && s.endereco)
    .map((s) => ({
      id: uuidv7(),
      tenantId,
      filialId,
      produtoId: s.produtoId,
      endereco: s.endereco,
      lote: s.lote || '',
      validade: s.validade || null,
      qtdCaixas: String(s.qtdCaixas),
      qtdKg: toDec(toNum(s.qtdKg, 0), 3),
      updatedAt: new Date(),
    }))

  if (paraInserir.length > 0) {
    await tx.insert(estoquePosicao).values(paraInserir)
  }
}

export async function verificarEnderecoBloqueado(
  tx: DbOrTx,
  tenantId: string,
  filialId: string,
  endereco: string,
): Promise<{ id: string; tipo: string; nome: string | null } | null> {
  const rows = await tx
    .select({
      id: inventarios.id,
      tipo: inventarios.tipo,
      nome: inventarios.nome,
    })
    .from(inventarioItens)
    .innerJoin(inventarios, eq(inventarios.id, inventarioItens.inventarioId))
    .where(
      and(
        eq(inventarios.tenantId, tenantId),
        eq(inventarios.filialId, filialId),
        eq(inventarioItens.endereco, endereco),
        sql`${inventarios.status} NOT IN ('Finalizado OK', 'Cancelado')`,
      ),
    )
    .limit(1)
  return rows[0] || null
}

export async function assertEnderecosNaoBloqueados(
  tx: DbOrTx,
  tenantId: string,
  filialId: string,
  enderecos: Array<string | null | undefined>,
): Promise<void> {
  const unicos = [...new Set(enderecos.map((e) => String(e || '').trim()).filter(Boolean))]
  for (const end of unicos) {
    const blq = await verificarEnderecoBloqueado(tx, tenantId, filialId, end)
    if (blq) {
      throw new HttpError(
        409,
        `Endereço ${end} está bloqueado pelo inventário em aberto (${blq.nome || blq.tipo}).`,
      )
    }
  }
}

export async function registrarHistoricoCaixa(
  tx: DbOrTx,
  params: {
    tenantId: string
    caixaId: string | null
    eanCaixa: string
    operacao: string
    detalhes: string
    operadorNome: string
  },
): Promise<void> {
  await tx.insert(caixasHistorico).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    caixaId: params.caixaId,
    eanCaixa: params.eanCaixa,
    operacao: params.operacao,
    detalhes: params.detalhes,
    operadorNome: params.operadorNome || 'Sistema',
    dataHora: new Date(),
  })
}

export async function registrarMovimentacaoLog(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    produtoId: string | null
    enderecoOrigem?: string | null
    enderecoDestino?: string | null
    lote?: string | null
    qtdCaixas?: number
    qtdKg?: number
    operadorId?: string | null
    operadorNome?: string | null
    tipo: string
    numPedido?: string | null
    cliente?: string | null
  },
): Promise<void> {
  await tx.insert(movimentacoesLog).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    filialId: params.filialId,
    produtoId: params.produtoId,
    enderecoOrigem: params.enderecoOrigem ?? null,
    enderecoDestino: params.enderecoDestino ?? null,
    lote: params.lote || '',
    qtdCaixas: String(params.qtdCaixas ?? 0),
    qtdKg: toDec(params.qtdKg ?? 0, 3),
    dataHora: new Date(),
    operadorId: params.operadorId ?? null,
    operadorNome: params.operadorNome || 'Sistema',
    tipo: params.tipo,
    numPedido: params.numPedido ?? null,
    cliente: params.cliente ?? null,
  })
}

export async function buscarProdutoVazio(tx: DbOrTx, tenantId: string): Promise<string> {
  const rows = await tx
    .select({ id: produtos.id })
    .from(produtos)
    .where(and(eq(produtos.tenantId, tenantId), eq(produtos.codigo, 'VAZIO')))
    .limit(1)
  if (rows[0]) return rows[0].id
  const novoId = uuidv7()
  await tx.insert(produtos).values({
    id: novoId,
    tenantId,
    codigo: 'VAZIO',
    descricao: 'ENDEREÇO VAZIO / SEM SALDO',
    tipoProduto: 'Sistema',
    unidade: 'CX',
    ativo: 0,
  })
  return novoId
}

export function normalizeCaixaRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    peso_kg: toNum(row.peso_kg ?? row.pesoKg, 0),
    peso_bruto_kg:
      row.peso_bruto_kg != null || row.pesoBrutoKg != null
        ? toNum(row.peso_bruto_kg ?? row.pesoBrutoKg, 0)
        : null,
    tara_kg: toNum(row.tara_kg ?? row.taraKg, 0),
    custo_unitario_kg: toNum(row.custo_unitario_kg ?? row.custoUnitarioKg, 0),
  }
}

export async function lerTenantFeatures(tx: DbOrTx, tenantId: string): Promise<Record<string, boolean>> {
  const [row] = await tx
    .select({ featuresJson: tenants.featuresJson })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return (row?.featuresJson as Record<string, boolean>) || {}
}

export async function sugerirCfopOperacao(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    tipoMovimento?: string
    finalidade?: string
    ufParceiro?: string
    naturezaId?: string | null
  },
) {
  const [filial] = await tx
    .select({ uf: filiais.uf })
    .from(filiais)
    .where(and(eq(filiais.id, params.filialId), eq(filiais.tenantId, params.tenantId)))
    .limit(1)
  const ufFilial = (filial?.uf || 'SP').toUpperCase()
  const ufParceiro = String(params.ufParceiro || ufFilial).trim().toUpperCase() || ufFilial
  const dentroEstado = ufFilial === ufParceiro

  const tipo = String(params.tipoMovimento || 'SAIDA').toUpperCase()
  const finalidade = String(params.finalidade || '').toUpperCase()

  const nats = await tx
    .select()
    .from(naturezasOperacao)
    .where(
      and(
        eq(naturezasOperacao.tenantId, params.tenantId),
        eq(naturezasOperacao.tipoMovimento, tipo),
        eq(naturezasOperacao.ativo, 1),
      ),
    )

  let chosen = params.naturezaId ? nats.find((n) => n.id === params.naturezaId) : undefined
  if (!chosen && params.naturezaId) {
    const [directNat] = await tx
      .select()
      .from(naturezasOperacao)
      .where(and(eq(naturezasOperacao.tenantId, params.tenantId), eq(naturezasOperacao.id, params.naturezaId)))
      .limit(1)
    chosen = directNat
  }
  if (!chosen) {
    chosen = finalidade ? nats.find((n) => n.finalidade.toUpperCase() === finalidade) || nats[0] : nats[0]
  }
  if (!chosen) return null

  const cfopBase = dentroEstado ? chosen.cfopEstadual : chosen.cfopInterestadual
  return {
    natureza_id: chosen.id,
    descricao: chosen.descricao,
    finalidade: chosen.finalidade,
    uf_filial: ufFilial,
    uf_parceiro: ufParceiro,
    dentro_estado: dentroEstado,
    cfop: cfopBase,
    codigo_sub_operacao: chosen.codigoSubOperacao,
    cfop_completo: `${cfopBase}${chosen.codigoSubOperacao}`,
  }
}
