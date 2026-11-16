export interface ClienteCatalogo {
  id: string
  codigo: string | null
  razao_social: string
  nome_fantasia: string
  telefone: string
}

export interface ProdutoCatalogo {
  id: string
  codigo: string | null
  codigo_auxiliar: string | null
  ean: string | null
  descricao: string
  valor_unitario: number
  unidade: string
}

export interface FormaPgtoCatalogo {
  id: string
  codigo: string
  descricao: string
}

export interface ParsedItem {
  ordem: number
  texto_original: string
  observacao: string
  alerta_reclamacao: string
  produto_id: string | null
  produto_codigo: string | null
  produto_descricao: string | null
  codigo_aux: string | null
  qtd_kg_solicitada: number
  unidade_solicitada: 'KG' | 'CX'
  preco_unitario: number
  confianca_pct: number
}

export interface ParsedWhatsappOrder {
  cliente_sugerido_id: string | null
  cliente_texto: string
  forma_pagamento_sugerida_id: string | null
  forma_pagamento_texto: string
  observacoes: string
  confianca_pct: number
  itens: ParsedItem[]
}

const SINONIMOS: Record<string, string> = {
  estrogonofe: 'strogonoff',
  strogonofe: 'strogonoff',
  strogonoff: 'strogonoff',
  congelado: 'congelada',
  resfriado: 'resfriada',
  mignon: 'file mignon',
  filet: 'file',
  gr: 'g',
}

export function normalizeText(str: string): string {
  const base = String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/([a-z])\1+/g, '$1')
  return base.replace(/[^\p{L}\p{N}\s/.,-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(str: string): string[] {
  const norm = normalizeText(str)
  const rawTokens = norm.split(/[\s\-—,/()+]+/).filter((t) => t.length >= 2)
  const expanded = new Set<string>()
  for (const tk of rawTokens) {
    expanded.add(tk)
    const sin = SINONIMOS[tk]
    if (sin) {
      for (const s of sin.split(' ')) expanded.add(normalizeText(s))
    }
    // Separa numeros grudados em g/kg (ex: 250g -> 250)
    const mPeso = tk.match(/^(\d+)(g|gr|kg)$/)
    if (mPeso) expanded.add(mPeso[1])
  }
  return Array.from(expanded)
}

function parseBrNum(raw: string): number {
  const clean = String(raw || '')
    .replace(/r\$/gi, '')
    .replace(/\s+/g, '')
    .trim()
  if (!clean) return 0
  if (clean.includes(',') && clean.includes('.')) {
    return Number(clean.replace(/\./g, '').replace(',', '.')) || 0
  }
  if (clean.includes(',')) {
    return Number(clean.replace(',', '.')) || 0
  }
  return Number(clean) || 0
}

function matchCliente(headerText: string, remetenteNome: string, remetentePhone: string, clientes: ClienteCatalogo[]): { id: string | null; label: string } {
  const phoneDigits = String(remetentePhone || '').replace(/\D/g, '').slice(-8)
  if (phoneDigits.length >= 8) {
    const byPhone = clientes.find((c) => String(c.telefone || '').replace(/\D/g, '').endsWith(phoneDigits))
    if (byPhone) return { id: byPhone.id, label: byPhone.razao_social }
  }

  const candidatosTexto = [headerText, remetenteNome].filter(Boolean)
  let best: { id: string; score: number; label: string } | null = null

  for (const texto of candidatosTexto) {
    const normT = normalizeText(texto)
    const tokensT = tokenize(texto).filter((t) => t.length >= 3 && !['campinas', 'paulinia', 'sp', 'vendedor', 'confirmar', 'itens', 'cliente'].includes(t))
    for (const cli of clientes) {
      if (cli.codigo && normT.includes(normalizeText(cli.codigo))) {
        return { id: cli.id, label: cli.razao_social }
      }
      const normRazao = normalizeText(cli.razao_social)
      const normFant = normalizeText(cli.nome_fantasia)
      let hits = 0
      for (const tk of tokensT) {
        if (normRazao.includes(tk) || normFant.includes(tk)) hits += 1
      }
      const score = tokensT.length > 0 ? hits / tokensT.length : 0
      if (hits > 0 && (!best || score > best.score)) {
        best = { id: cli.id, score, label: cli.razao_social }
      }
    }
  }

  return best && best.score >= 0.4 ? { id: best.id, label: best.label } : { id: null, label: headerText || remetenteNome || '' }
}

function matchProduto(itemNome: string, detailText: string, produtos: ProdutoCatalogo[]): { prod: ProdutoCatalogo | null; score: number } {
  const fullTokens = tokenize(`${itemNome} ${detailText}`)
  const nameTokens = tokenize(itemNome)
  if (fullTokens.length === 0) return { prod: null, score: 0 }

  let bestProd: ProdutoCatalogo | null = null
  let bestScore = 0

  for (const p of produtos) {
    if (p.codigo && fullTokens.includes(normalizeText(p.codigo))) {
      return { prod: p, score: 100 }
    }
    const pTokens = tokenize(p.descricao)
    if (pTokens.length === 0) continue

    let score = 0
    for (const tk of nameTokens) {
      if (pTokens.some((pt) => pt === tk || (tk.length >= 4 && pt.includes(tk)))) score += 3
    }
    for (const tk of fullTokens) {
      if (!nameTokens.includes(tk) && pTokens.some((pt) => pt === tk || (tk.length >= 3 && pt.includes(tk)))) {
        score += 2
      }
    }
    // Bonus se a faixa de gramatura (ex: 230/250 ou 50 ou 120) bate exatamente
    const descNorm = normalizeText(p.descricao)
    for (const tk of fullTokens) {
      if (/^\d{2,4}$/.test(tk) && descNorm.includes(tk)) score += 3
    }

    if (score > bestScore) {
      bestScore = score
      bestProd = p
    }
  }

  const conf = bestProd ? Math.min(99, Math.round((bestScore / Math.max(4, nameTokens.length * 3 + 2)) * 100)) : 0
  return { prod: conf >= 35 ? bestProd : null, score: conf }
}

export function parseWhatsappMensagem(
  mensagemBruta: string,
  catalogos: {
    clientes: ClienteCatalogo[]
    produtos: ProdutoCatalogo[]
    formasPagamento: FormaPgtoCatalogo[]
  },
  meta: { remetenteNome?: string; remetentePhone?: string } = {}
): ParsedWhatsappOrder {
  const lines = String(mensagemBruta || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let headerCandidate = ''
  let pagamentoTexto = ''
  const rawItems: Array<{ nome: string; qtd: number; unid: 'KG' | 'CX'; preco: number; details: string[]; original: string }> = []

  let inItems = false
  for (const line of lines) {
    const cleanEmoji = line.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s•*-]+/u, '').trim()
    const upper = cleanEmoji.toUpperCase()

    if (/^(ITENS|PRODUTOS|PEDIDO)\b/.test(upper)) {
      inItems = true
      continue
    }
    if (/^(PESO TOTAL|VALOR TOTAL|TOTAL)\b/.test(upper)) {
      inItems = false
      continue
    }
    if (/^PAGAMENTO\s*:/.test(upper)) {
      pagamentoTexto = cleanEmoji.split(':').slice(1).join(':').trim()
      continue
    }
    if (/^(VENDEDOR|PREVISAO|ENTREGA)\s*:/.test(upper)) {
      continue
    }

    // Linha de subdetalhe (↳ 250 g, 4x1  ou - T7 — ⚠️ PORÇÕES UNIFORMES)
    if ((line.startsWith('↳') || line.startsWith('>') || line.startsWith('->')) && rawItems.length > 0) {
      rawItems[rawItems.length - 1].details.push(line.replace(/^[↳>\-\s]+/, '').trim())
      continue
    }

    // Padrao 1: "1. Baby Beef — 2 kg × R$ 126,90 = R$ 253,80" ou "Baby Beef - 2 kg x R$ 126,90"
    const mRich = cleanEmoji.match(
      /^(?:\d+[.)]\s*)?(.+?)\s*[—\-–]\s*([\d.,]+)\s*(kg|cx|un)?(?:\s*[×xX*]\s*(?:r\$\s*)?([\d.,]+))?/i
    )
    if (mRich && parseBrNum(mRich[2]) > 0) {
      inItems = true
      rawItems.push({
        nome: mRich[1].trim(),
        qtd: parseBrNum(mRich[2]),
        unid: mRich[3]?.toUpperCase() === 'CX' ? 'CX' : 'KG',
        preco: mRich[4] ? parseBrNum(mRich[4]) : 0,
        details: [],
        original: line,
      })
      continue
    }

    // Padrao 2: "2kg baby beef 126,90" ou "4 cx file mignon"
    const mPrefix = cleanEmoji.match(/^(?:\d+[.)]\s*)?([\d.,]+)\s*(kg|cx)\s+(.+?)(?:\s+(?:r\$\s*)?([\d.,]+))?$/i)
    if (mPrefix && parseBrNum(mPrefix[1]) > 0) {
      inItems = true
      rawItems.push({
        nome: mPrefix[3].trim(),
        qtd: parseBrNum(mPrefix[1]),
        unid: mPrefix[2]?.toUpperCase() === 'CX' ? 'CX' : 'KG',
        preco: mPrefix[4] ? parseBrNum(mPrefix[4]) : 0,
        details: [],
        original: line,
      })
      continue
    }

    if (!inItems && !headerCandidate && cleanEmoji.length >= 2) {
      headerCandidate = cleanEmoji.replace(/^cliente\s*:\s*/i, '').trim()
    } else if (inItems && rawItems.length > 0) {
      rawItems[rawItems.length - 1].details.push(cleanEmoji)
    }
  }

  const cliMatch = matchCliente(
    headerCandidate,
    meta.remetenteNome || '',
    meta.remetentePhone || '',
    catalogos.clientes
  )

  let formaPgtoId: string | null = null
  if (pagamentoTexto) {
    const normPg = normalizeText(pagamentoTexto).replace(/\bdias?\b/g, '').trim()
    const matchFp = catalogos.formasPagamento.find((fp) => {
      const nDesc = normalizeText(fp.descricao).replace(/\bdias?\b/g, '').trim()
      return nDesc === normPg || nDesc.includes(normPg) || normPg.includes(nDesc)
    })
    if (matchFp) formaPgtoId = matchFp.id
  }

  const itens: ParsedItem[] = rawItems.map((it, idx) => {
    const obs = it.details.join(' | ')
    const temReclamacao = /reclama|uniforme|⚠️|atencao|avaria/i.test(obs)
    const { prod, score } = matchProduto(it.nome, obs, catalogos.produtos)
    return {
      ordem: idx + 1,
      texto_original: it.original,
      observacao: obs,
      alerta_reclamacao: temReclamacao ? obs : '',
      produto_id: prod?.id || null,
      produto_codigo: prod?.codigo || null,
      produto_descricao: prod?.descricao || null,
      codigo_aux: prod?.codigo_auxiliar || null,
      qtd_kg_solicitada: it.qtd,
      unidade_solicitada: it.unid,
      preco_unitario: it.preco > 0 ? it.preco : prod?.valor_unitario || 0,
      confianca_pct: score,
    }
  })

  const confiancaGeral =
    itens.length > 0
      ? Math.round(itens.reduce((s, x) => s + x.confianca_pct, 0) / itens.length)
      : cliMatch.id
        ? 50
        : 0

  return {
    cliente_sugerido_id: cliMatch.id,
    cliente_texto: cliMatch.label,
    forma_pagamento_sugerida_id: formaPgtoId,
    forma_pagamento_texto: pagamentoTexto,
    observacoes: pagamentoTexto ? `Condição informada no WhatsApp: ${pagamentoTexto}` : '',
    confianca_pct: confiancaGeral,
    itens,
  }
}
