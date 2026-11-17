/**
 * Parser de arquivos TXT/CSV em lote de etiquetas de frigorífico (ex: Paula & Ribeiro / Frigodil).
 * Aceita múltiplos arquivos simultaneamente, remove duplicidade por EAN e padroniza datas e pesos.
 */

export interface LayoutTxtConfig {
  tipo_arquivo?: string
  delimitador?: string
  saltar_linhas?: number
  formato_data?: string
  decimal_ponto?: number | boolean
  mapeamento_json?: Record<string, number>
}

export interface TxtCaixaParsed {
  ean_caixa: string
  codigo_produto_fornecedor: string
  descricao_produto_fornecedor: string
  peso_liquido_kg: number
  qtd_pecas: number | null
  data_producao: string | null
  validade: string | null
  lote: string
  romaneio_origem: string
  documento_origem: string
  origem_texto: string
  arquivo_origem: string
}

export interface TxtBatchParseResult {
  caixas: TxtCaixaParsed[]
  total_linhas_lidas: number
  duplicadas_ignoradas: number
  linhas_invalidas: Array<{ arquivo: string; linha: number; motivo: string }>
}

const DEFAULT_MAP: Record<string, number> = {
  origem_texto: 1,
  romaneio_origem: 2,
  ean: 3,
  codigo_produto: 4,
  descricao_produto: 5,
  peso_liquido: 6,
  qtd_pecas: 7,
  data_producao: 8,
  data_validade: 9,
  documento_origem: 10,
}

function parseDataTxt(raw: string | undefined, formato = 'DDMMYYYY'): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [dd, mm, yyyy] = s.slice(0, 10).split('/')
    return `${yyyy}-${mm}-${dd}`
  }
  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) {
    if (formato.toUpperCase() === 'YYYYMMDD') {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    }
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
  }
  if (digits.length === 6) {
    return `20${digits.slice(4, 6)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
  }
  return null
}

function parseNumTxt(raw: string | undefined, decimalPonto: boolean): number {
  const s = String(raw || '').trim()
  if (!s) return NaN
  const normalized = decimalPonto ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  return Number(normalized)
}

function loteFromIso(iso: string | null): string {
  if (!iso || iso.length < 10) return ''
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`
}

export function parseTxtEtiquetasBatch(
  arquivos: Array<{ nome: string; conteudo: string }>,
  layout: LayoutTxtConfig = {},
): TxtBatchParseResult {
  const delim = layout.delimitador === '\\t' ? '\t' : layout.delimitador || ';'
  const saltar = Math.max(0, Number(layout.saltar_linhas || 0))
  const fmtData = layout.formato_data || 'DDMMYYYY'
  const decPonto = Boolean(layout.decimal_ponto)
  const colMap = { ...DEFAULT_MAP, ...(layout.mapeamento_json || {}) }

  const getCol = (cols: string[], key: string): string => {
    const idx1 = Number(colMap[key] || 0)
    if (!idx1 || idx1 < 1) return ''
    return String(cols[idx1 - 1] ?? '').trim()
  }

  const porEan = new Map<string, TxtCaixaParsed>()
  const linhasInvalidas: Array<{ arquivo: string; linha: number; motivo: string }> = []
  let totalLinhas = 0
  let duplicadas = 0

  for (const arq of arquivos) {
    const nomeArq = String(arq.nome || 'arquivo.txt').trim()
    const rawLines = String(arq.conteudo || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)

    for (let i = 0; i < rawLines.length; i++) {
      if (i < saltar) continue
      const line = rawLines[i].trim()
      if (!line) continue
      totalLinhas += 1

      const cols = line.split(delim)
      const ean = getCol(cols, 'ean')
      const codProd = getCol(cols, 'codigo_produto')
      const pesoRaw = getCol(cols, 'peso_liquido')
      const peso = parseNumTxt(pesoRaw, decPonto)

      if (!ean || !codProd || !Number.isFinite(peso) || peso <= 0) {
        linhasInvalidas.push({
          arquivo: nomeArq,
          linha: i + 1,
          motivo: !ean
            ? 'Código de barras vazio'
            : !codProd
              ? 'Código de produto vazio'
              : `Peso líquido inválido ("${pesoRaw}")`,
        })
        continue
      }

      if (porEan.has(ean)) {
        duplicadas += 1
        continue
      }

      const pecasNum = parseNumTxt(getCol(cols, 'qtd_pecas'), decPonto)
      const dtProd = parseDataTxt(getCol(cols, 'data_producao'), fmtData)
      const dtVal = parseDataTxt(getCol(cols, 'data_validade'), fmtData)

      porEan.set(ean, {
        ean_caixa: ean,
        codigo_produto_fornecedor: codProd,
        descricao_produto_fornecedor: getCol(cols, 'descricao_produto'),
        peso_liquido_kg: Number(peso.toFixed(3)),
        qtd_pecas: Number.isFinite(pecasNum) && pecasNum > 0 ? Math.trunc(pecasNum) : null,
        data_producao: dtProd,
        validade: dtVal,
        lote: loteFromIso(dtProd),
        romaneio_origem: getCol(cols, 'romaneio_origem'),
        documento_origem: getCol(cols, 'documento_origem'),
        origem_texto: getCol(cols, 'origem_texto'),
        arquivo_origem: nomeArq,
      })
    }
  }

  return {
    caixas: Array.from(porEan.values()),
    total_linhas_lidas: totalLinhas,
    duplicadas_ignoradas: duplicadas,
    linhas_invalidas: linhasInvalidas,
  }
}
