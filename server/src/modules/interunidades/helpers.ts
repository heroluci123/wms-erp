import { and, eq } from 'drizzle-orm'
import {
  filiais,
  interunidadesMovimentacoes,
  produtos,
} from '../../db/schema/index.js'
import { uuidv7 } from '../../utils/uuid.js'
import { gerarCodigoDocumento, hojeIsoLocal, toDec, toNum } from '../wms/helpers.js'

export type EspecieCarne = 'BOVINO' | 'SUINO' | 'AVES' | 'OUTROS'

/**
 * Classifica automaticamente a espécie da proteína (BOVINO | SUINO | AVES | OUTROS)
 * usando Grupo do produto, NCM oficial (0201/0202 Bovino, 0203 Suíno, 0207 Aves) e Descrição.
 */
export function detectarEspecieProduto(params: {
  grupo?: string | null
  ncm?: string | null
  descricao?: string | null
}): EspecieCarne {
  const ncm = String(params.ncm || '').replace(/\D/g, '')
  const texto = `${params.grupo || ''} ${params.descricao || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

  if (ncm.startsWith('0203') || /\b(SUIN|PORC|PERNIL|LOMBO SUIN|BISTECA SUIN|COSTELINHA|BACON|TOUCINHO|PANCETA|COPA LOMBO|LINGUICA SUIN)\b/.test(texto)) {
    return 'SUINO'
  }
  if (ncm.startsWith('0207') || /\b(AVE|AVES|FRANGO|GALINHA|PEITO DE FRANGO|COXA|SOBRECOXA|ASA|TULIPA|SASSAMI|PERU|CHESTER|CORACAO DE FRANGO)\b/.test(texto)) {
    return 'AVES'
  }
  if (
    ncm.startsWith('0201') ||
    ncm.startsWith('0202') ||
    ncm.startsWith('02061') ||
    ncm.startsWith('02062') ||
    /\b(BOVIN|BOI|VACA|NOVILH|PICANHA|ALCATRA|CONTRA\s*FILE|FILE MIGNON|ACEM|PATINHO|COXAO|MAMINHA|FRALDINHA|COSTELA|CUPIM|MUSCULO|PALETA|LAGARTO|CAPA DE FILE|DIANTEIRO|TRASEIRO|PONTA DE AGULHA|CARCACA|BIFE ANCHO|CHORIZO|PRIME RIB|SHORT RIB)\b/.test(
      texto,
    )
  ) {
    return 'BOVINO'
  }
  return 'OUTROS'
}

export interface MapaFiliaisTenant {
  loja: typeof filiais.$inferSelect | null
  matriz: typeof filiais.$inferSelect | null
  industria: typeof filiais.$inferSelect | null
  todas: Array<typeof filiais.$inferSelect>
}

export async function carregarMapaFiliais(db: any, tenantId: string): Promise<MapaFiliaisTenant> {
  const todas = (await db
    .select()
    .from(filiais)
    .where(and(eq(filiais.tenantId, tenantId), eq(filiais.ativo, 1)))) as Array<typeof filiais.$inferSelect>

  const loja =
    todas.find((f) => String(f.codigo).trim() === '1/1') ||
    todas.find((f) => String(f.tipoUnidade).toUpperCase() === 'VAREJO') ||
    null

  const matriz =
    todas.find((f) => String(f.codigo).trim() === '1/2') ||
    todas.find((f) => String(f.tipoUnidade).toUpperCase() === 'DISTRIBUICAO') ||
    todas.find((f) => Number(f.isPadrao) === 1) ||
    todas[0] ||
    null

  const industria =
    todas.find((f) => String(f.codigo).trim() === '2/1') ||
    todas.find((f) => String(f.tipoUnidade).toUpperCase() === 'INDUSTRIA') ||
    null

  return { loja, matriz, industria, todas }
}

/**
 * Quando uma caixa ainda pertencente à Matriz (1/2) é bipada diretamente numa OP da Planta (2/1),
 * gera automaticamente o lançamento de Remessa para Industrialização (CFOP 5901) na fila de Faturamento Diário.
 */
export async function registrarRemessaAutomaticaNaOp(
  tx: any,
  params: {
    tenantId: string
    filialOrigemId: string
    filialDestinoId: string
    caixaId: string
    eanCaixa: string
    produtoId: string
    pesoKg: number
    opId: string
    opCodigo: string
    operadorId: string
    operadorNome: string
  },
): Promise<{ movId: string; codigo: string; especie: EspecieCarne } | null> {
  if (!params.filialOrigemId || !params.filialDestinoId || params.filialOrigemId === params.filialDestinoId) {
    return null
  }

  const [prod] = await tx
    .select()
    .from(produtos)
    .where(and(eq(produtos.id, params.produtoId), eq(produtos.tenantId, params.tenantId)))
    .limit(1)

  if (!prod) return null

  const especie = detectarEspecieProduto({
    grupo: prod.grupo,
    ncm: prod.ncm,
    descricao: prod.descricao,
  })
  const valorUnit = toNum(prod.custoMedioKg, 0) > 0 ? toNum(prod.custoMedioKg, 0) : toNum(prod.valorUnitario, 0)
  const valorTotal = Number((params.pesoKg * valorUnit).toFixed(2))
  const movId = uuidv7()
  const codigo = await gerarCodigoDocumento(tx, params.tenantId, 'INTERUNIDADES', 'REM', 5)

  await tx.insert(interunidadesMovimentacoes).values({
    id: movId,
    tenantId: params.tenantId,
    codigo,
    tipoOperacao: 'REMESSA_IND',
    filialOrigemId: params.filialOrigemId,
    filialDestinoId: params.filialDestinoId,
    caixaId: params.caixaId,
    eanCaixa: params.eanCaixa,
    produtoId: prod.id,
    produtoCodigo: prod.codigo || '',
    produtoDescricao: prod.descricao,
    especie,
    pesoKg: toDec(params.pesoKg, 3),
    valorUnitarioKg: toDec(valorUnit, 4),
    valorTotal: toDec(valorTotal, 2),
    opId: params.opId,
    requerFaturamento: 1,
    statusFiscal: 'PENDENTE',
    dataMovimento: hojeIsoLocal(),
    operadorId: params.operadorId,
    operadorNome: params.operadorNome,
    observacao: `Remessa automática gerada ao bipar MP na OP ${params.opCodigo}`,
  })

  return { movId, codigo, especie }
}
