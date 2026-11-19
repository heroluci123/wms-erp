import crypto from 'node:crypto'

export interface OfxTransaction {
  fitid: string
  tipo: 'ENTRADA' | 'SAIDA'
  trn_type: string
  data_movimento: string // YYYY-MM-DD
  valor: number // sempre positivo
  valor_assinado: number // + para entrada, - para saída
  memo: string
  checknum: string
  forma_sugerida: string
}

export interface OfxParsedResult {
  bank_id: string
  acct_id: string
  acct_type: string
  currency: string
  dt_start: string | null
  dt_end: string | null
  saldo_extrato: number | null
  transacoes: OfxTransaction[]
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function parseOfxDate(raw: string): string | null {
  const digits = String(raw || '').replace(/[^0-9]/g, '')
  if (digits.length < 8) return null
  const y = digits.slice(0, 4)
  const m = digits.slice(4, 6)
  const d = digits.slice(6, 8)
  const yi = Number(y)
  const mi = Number(m)
  const di = Number(d)
  if (yi < 1990 || yi > 2100 || mi < 1 || mi > 12 || di < 1 || di > 31) return null
  return `${y}-${m}-${d}`
}

function parseOfxNumber(raw: string): number {
  let s = String(raw || '').trim().replace(/\s+/g, '')
  if (!s) return NaN
  // Trata formatos brasileiros: "-1.400,50" ou "-1400,50" vs padrão "-1400.50"
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : NaN
}

function extractTag(block: string, tagName: string): string {
  // Suporta XML (<TAG>valor</TAG>) e SGML (<TAG>valor\n<OUTRATAG>)
  const reXml = new RegExp(`<${tagName}\\s*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'i')
  const mXml = block.match(reXml)
  if (mXml) return decodeXmlEntities(mXml[1])

  const reSgml = new RegExp(`<${tagName}\\s*>([^<\\r\\n]+)`, 'i')
  const mSgml = block.match(reSgml)
  if (mSgml) return decodeXmlEntities(mSgml[1])

  return ''
}

export function detectarFormaPagamentoOfx(memo: string, trnType: string): string {
  const t = `${memo} ${trnType}`.toUpperCase()
  if (t.includes('PIX')) return 'PIX'
  if (t.includes('BOLETO') || t.includes('COBRANCA') || t.includes('COBRANÇA') || t.includes('TITULO') || t.includes('TÍTULO') || t.includes('LIQ COB')) {
    return 'BOLETO'
  }
  if (t.includes('TED') || t.includes('DOC')) return 'TED'
  if (t.includes('CARTAO') || t.includes('CARTÃO') || t.includes('CIELO') || t.includes('REDE') || t.includes('STONE') || t.includes('GETNET')) {
    return 'CARTAO'
  }
  if (t.includes('CHEQUE') || t.includes('CHQ')) return 'CHEQUE'
  if (t.includes('TARIFA') || t.includes('IOF') || t.includes('JUROS') || t.includes('FEE') || t.includes('SRVCHG')) {
    return 'DEBITO_AUTO'
  }
  if (t.includes('TRANSF') || t.includes('XFER')) return 'TRANSFERENCIA'
  return 'DEBITO_CONTA'
}

export function parseOfxContent(rawText: string): OfxParsedResult {
  const text = String(rawText || '').trim()
  if (!text) throw new Error('Arquivo OFX vazio.')

  const ofxIdx = text.search(/<OFX\b/i)
  const body = ofxIdx >= 0 ? text.slice(ofxIdx) : text
  if (!/<STMTTRN\b/i.test(body) && !/<BANKTRANLIST\b/i.test(body)) {
    throw new Error('Conteúdo não parece ser um extrato OFX válido (tags <BANKTRANLIST> / <STMTTRN> ausentes).')
  }

  const bankId = extractTag(body, 'BANKID')
  const acctId = extractTag(body, 'ACCTID')
  const acctType = extractTag(body, 'ACCTTYPE')
  const currency = extractTag(body, 'CURDEF') || 'BRL'
  const dtStart = parseOfxDate(extractTag(body, 'DTSTART'))
  const dtEnd = parseOfxDate(extractTag(body, 'DTEND'))

  let saldoExtrato: number | null = null
  const ledgerMatch = body.match(/<LEDGERBAL\b[\s\S]*?(?:<\/LEDGERBAL>|<AVAILBAL\b|<\/STMTRS>|$)/i)
  if (ledgerMatch) {
    const bal = parseOfxNumber(extractTag(ledgerMatch[0], 'BALAMT'))
    if (Number.isFinite(bal)) saldoExtrato = bal
  }

  // Extrai todos os blocos <STMTTRN> (suportando com ou sem </STMTTRN>)
  const blocks: string[] = []
  const reClosed = /<STMTTRN\b[^>]*>([\s\S]*?)<\/STMTTRN>/gi
  let m: RegExpExecArray | null
  while ((m = reClosed.exec(body)) !== null) {
    blocks.push(m[1])
  }

  if (blocks.length === 0) {
    // Fallback para OFX SGML onde nem <STMTTRN> tem tag de fechamento
    const parts = body.split(/<STMTTRN\b[^>]*>/i)
    for (let i = 1; i < parts.length; i += 1) {
      const cut = parts[i].split(/<\/BANKTRANLIST>|<LEDGERBAL\b/i)[0]
      if (cut && cut.trim()) blocks.push(cut)
    }
  }

  const seenFitids = new Map<string, number>()
  const transacoes: OfxTransaction[] = []

  for (const blk of blocks) {
    const trnAmt = parseOfxNumber(extractTag(blk, 'TRNAMT'))
    if (!Number.isFinite(trnAmt) || Math.abs(trnAmt) < 0.005) continue

    const dtPosted = parseOfxDate(extractTag(blk, 'DTPOSTED'))
    if (!dtPosted) continue

    const trnType = (extractTag(blk, 'TRNTYPE') || (trnAmt > 0 ? 'CREDIT' : 'DEBIT')).toUpperCase()
    const rawMemo = extractTag(blk, 'MEMO')
    const rawName = extractTag(blk, 'NAME')
    const checknum = extractTag(blk, 'CHECKNUM') || extractTag(blk, 'REFNUM')
    const memoParts = [rawName, rawMemo].filter(Boolean)
    const memoUnique = Array.from(new Set(memoParts)).join(' — ') || `${trnType} ${checknum}`.trim()

    let fitidBase = extractTag(blk, 'FITID')
    if (!fitidBase) {
      const hash = crypto
        .createHash('sha1')
        .update(`${dtPosted}|${trnAmt.toFixed(2)}|${checknum}|${memoUnique}`)
        .digest('hex')
        .slice(0, 16)
      fitidBase = `AUTO-${dtPosted}-${hash}`
    }

    // Se o banco repetir o mesmo FITID dentro do mesmo arquivo (comum em tarifas do mesmo dia), gera sufixo determinístico
    const count = (seenFitids.get(fitidBase) || 0) + 1
    seenFitids.set(fitidBase, count)
    const fitid = count > 1 ? `${fitidBase}#${count}` : fitidBase

    const tipo: 'ENTRADA' | 'SAIDA' = trnAmt > 0 ? 'ENTRADA' : 'SAIDA'
    transacoes.push({
      fitid,
      tipo,
      trn_type: trnType,
      data_movimento: dtPosted,
      valor: Number(Math.abs(trnAmt).toFixed(2)),
      valor_assinado: trnAmt,
      memo: memoUnique,
      checknum,
      forma_sugerida: detectarFormaPagamentoOfx(memoUnique, trnType),
    })
  }

  return {
    bank_id: bankId,
    acct_id: acctId,
    acct_type: acctType,
    currency,
    dt_start: dtStart,
    dt_end: dtEnd,
    saldo_extrato: saldoExtrato,
    transacoes,
  }
}
