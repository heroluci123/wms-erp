/**
 * Parser estruturado de NF-e 4.00 XML (zero dependências nativas externas).
 * Extrai emitente, cabeçalho, totais, itens (<det>/<prod>/<rastro>) e duplicatas (<cobr>/<dup>).
 */

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  text: string
  children: XmlNode[]
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

export function parseXmlTree(xmlRaw: string): XmlNode | null {
  const cleaned = xmlRaw
    .replace(/^\uFEFF/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .trim()

  const root: XmlNode = { name: '__root__', attrs: {}, text: '', children: [] }
  const stack: XmlNode[] = [root]

  const tagRe = /<\/?([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tagRe.exec(cleaned)) !== null) {
    const textChunk = cleaned.slice(lastIndex, match.index)
    if (textChunk.trim()) {
      stack[stack.length - 1].text += decodeXmlEntities(textChunk)
    }
    lastIndex = match.index + match[0].length

    const rawTag = match[0]
    const rawName = match[1].includes(':') ? match[1].split(':').pop()! : match[1]
    const attrStr = match[2] || ''
    const selfClosing = match[3] === '/'
    const isClosing = rawTag.startsWith('</')

    if (isClosing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].name === rawName) {
          stack.length = i
          break
        }
      }
      continue
    }

    const attrs: Record<string, string> = {}
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let am: RegExpExecArray | null
    while ((am = attrRe.exec(attrStr)) !== null) {
      const aName = am[1].includes(':') ? am[1].split(':').pop()! : am[1]
      attrs[aName] = decodeXmlEntities(am[2] ?? am[3] ?? '')
    }

    const node: XmlNode = { name: rawName, attrs, text: '', children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) {
      stack.push(node)
    }
  }

  return root.children[0] || null
}

function findFirst(node: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!node) return null
  if (node.name === name) return node
  for (const ch of node.children) {
    const found = findFirst(ch, name)
    if (found) return found
  }
  return null
}

function findChildren(node: XmlNode | null | undefined, name: string): XmlNode[] {
  if (!node) return []
  return node.children.filter((c) => c.name === name)
}

function valText(node: XmlNode | null | undefined, path: string[]): string {
  let cur: XmlNode | null | undefined = node
  for (const seg of path) {
    if (!cur) return ''
    cur = cur.children.find((c) => c.name === seg) || null
  }
  return (cur?.text || '').trim()
}

function valNum(node: XmlNode | null | undefined, path: string[]): number {
  const s = valText(node, path)
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export interface NfeXmlItemParsed {
  n_item: number
  codigo_fornecedor: string
  ean: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valor_unitario: number
  valor_total: number
  valor_frete: number
  valor_desconto: number
  lote: string
  data_producao: string | null
  validade: string | null
}

export interface NfeXmlDuplicataParsed {
  numero: string
  vencimento: string | null
  valor: number
}

export interface NfeXmlParsed {
  chave_nfe: string
  numero_nf: string
  serie: string
  data_emissao: string | null
  natureza_operacao: string
  emitente: {
    cnpj: string
    razao_social: string
    nome_fantasia: string
    ie: string
    uf: string
    cidade: string
  }
  totais: {
    valor_produtos: number
    valor_frete: number
    valor_seguro: number
    valor_desconto: number
    valor_outras: number
    valor_ipi: number
    valor_icms: number
    valor_st: number
    valor_nf: number
  }
  itens: NfeXmlItemParsed[]
  duplicatas: NfeXmlDuplicataParsed[]
}

export function parseNfeXml(xmlRaw: string): NfeXmlParsed {
  const tree = parseXmlTree(xmlRaw)
  if (!tree) throw new Error('Arquivo XML inválido ou vazio.')

  const infNFe = findFirst(tree, 'infNFe')
  if (!infNFe) {
    throw new Error('XML não possui tag <infNFe> válida de NF-e 4.00.')
  }

  const chProt = valText(findFirst(tree, 'infProt'), ['chNFe'])
  const idAttr = (infNFe.attrs.Id || '').replace(/^NFe/i, '').trim()
  const chaveNfe = (chProt || idAttr).replace(/\D/g, '').slice(0, 44)

  const ide = findFirst(infNFe, 'ide')
  const emit = findFirst(infNFe, 'emit')
  const total = findFirst(infNFe, 'ICMSTot')
  const cobr = findFirst(infNFe, 'cobr')

  const dhEmi = valText(ide, ['dhEmi']) || valText(ide, ['dEmi'])
  const dataEmissao = dhEmi ? dhEmi.slice(0, 10) : null

  const detNodes = findChildren(infNFe, 'det')
  const itens: NfeXmlItemParsed[] = detNodes.map((det, idx) => {
    const prod = findFirst(det, 'prod')
    const rastro = findFirst(prod, 'rastro')
    const nItem = Number(det.attrs.nItem || idx + 1)
    const qtd = valNum(prod, ['qCom'])
    const vTot = valNum(prod, ['vProd'])
    const vUn = valNum(prod, ['vUnCom']) || (qtd > 0 ? vTot / qtd : 0)
    return {
      n_item: Number.isFinite(nItem) ? nItem : idx + 1,
      codigo_fornecedor: valText(prod, ['cProd']),
      ean: valText(prod, ['cEAN']) === 'SEM GTIN' ? '' : valText(prod, ['cEAN']),
      descricao: valText(prod, ['xProd']),
      ncm: valText(prod, ['NCM']),
      cfop: valText(prod, ['CFOP']),
      unidade: valText(prod, ['uCom']).toUpperCase(),
      quantidade: Number(qtd.toFixed(4)),
      valor_unitario: Number(vUn.toFixed(4)),
      valor_total: Number(vTot.toFixed(2)),
      valor_frete: Number(valNum(prod, ['vFrete']).toFixed(2)),
      valor_desconto: Number(valNum(prod, ['vDesc']).toFixed(2)),
      lote: valText(rastro, ['nLote']),
      data_producao: valText(rastro, ['dFab']) ? valText(rastro, ['dFab']).slice(0, 10) : null,
      validade: valText(rastro, ['dVal']) ? valText(rastro, ['dVal']).slice(0, 10) : null,
    }
  })

  if (itens.length === 0) {
    throw new Error('NF-e XML não possui itens (<det>) listados.')
  }

  const dupNodes = findChildren(cobr, 'dup')
  const duplicatas: NfeXmlDuplicataParsed[] = dupNodes.map((d, idx) => ({
    numero: valText(d, ['nDup']) || String(idx + 1).padStart(3, '0'),
    vencimento: valText(d, ['dVenc']) ? valText(d, ['dVenc']).slice(0, 10) : null,
    valor: Number(valNum(d, ['vDup']).toFixed(2)),
  }))

  return {
    chave_nfe: chaveNfe,
    numero_nf: valText(ide, ['nNF']),
    serie: valText(ide, ['serie']) || '1',
    data_emissao: dataEmissao,
    natureza_operacao: valText(ide, ['natOp']),
    emitente: {
      cnpj: (valText(emit, ['CNPJ']) || valText(emit, ['CPF'])).replace(/\D/g, ''),
      razao_social: valText(emit, ['xNome']),
      nome_fantasia: valText(emit, ['xFant']) || valText(emit, ['xNome']),
      ie: valText(emit, ['IE']),
      uf: valText(emit, ['enderEmit', 'UF']).toUpperCase(),
      cidade: valText(emit, ['enderEmit', 'xMun']),
    },
    totais: {
      valor_produtos: Number(valNum(total, ['vProd']).toFixed(2)),
      valor_frete: Number(valNum(total, ['vFrete']).toFixed(2)),
      valor_seguro: Number(valNum(total, ['vSeg']).toFixed(2)),
      valor_desconto: Number(valNum(total, ['vDesc']).toFixed(2)),
      valor_outras: Number(valNum(total, ['vOutro']).toFixed(2)),
      valor_ipi: Number(valNum(total, ['vIPI']).toFixed(2)),
      valor_icms: Number(valNum(total, ['vICMS']).toFixed(2)),
      valor_st: Number(valNum(total, ['vST']).toFixed(2)),
      valor_nf: Number(valNum(total, ['vNF']).toFixed(2)),
    },
    itens,
    duplicatas,
  }
}
