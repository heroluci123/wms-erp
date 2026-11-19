import crypto from 'node:crypto'

export const UF_CODIGO_IBGE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
}

const UFS_SUL_SUDESTE_EXCETO_ES = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'])

// NCMs de carnes in natura / miúdos beneficiados por Cesta Básica & Alíquota Zero PIS/COFINS (Lei 10.925/2004)
const PREFIXOS_NCM_CARNE_CESTA_BASICA = ['0201', '0202', '0203', '0204', '0206', '0207', '0210']

export function onlyDigits(v: unknown): string {
  return String(v || '').replace(/\D/g, '')
}

export function escXml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .trim()
}

export function encryptFiscalSecret(plain: string, masterKey: string): string {
  if (!plain) return ''
  const key = crypto.createHash('sha256').update(masterKey || 'wms-erp-fiscal-key').digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptFiscalSecret(payload: string, masterKey: string): string {
  if (!payload || !payload.includes(':')) return ''
  const [ivHex, tagHex, dataHex] = payload.split(':')
  if (!ivHex || !tagHex || !dataHex) return ''
  const key = crypto.createHash('sha256').update(masterKey || 'wms-erp-fiscal-key').digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()])
  return dec.toString('utf8')
}

export function calcularDigitoVerificadorMod11(chave43: string): string {
  let soma = 0
  let peso = 2
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto
  return String(dv)
}

export function gerarChaveAcessoNfe(params: {
  uf: string
  dataEmissao?: Date
  cnpjEmitente: string
  modelo: '55' | '65'
  serie: number
  numero: number
  tpEmis?: string
}): { chave: string; cNF: string; cDV: string } {
  const cUF = UF_CODIGO_IBGE[String(params.uf || 'SP').toUpperCase()] || '35'
  const dt = params.dataEmissao || new Date()
  const aa = String(dt.getFullYear()).slice(-2)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const cnpj = onlyDigits(params.cnpjEmitente).padStart(14, '0').slice(-14)
  const mod = params.modelo === '65' ? '65' : '55'
  const serie = String(Math.max(1, Math.trunc(params.serie || 1))).padStart(3, '0')
  const nNF = String(Math.max(1, Math.trunc(params.numero || 1))).padStart(9, '0')
  const tpEmis = String(params.tpEmis || '1').slice(0, 1)
  const cNF = String(crypto.randomInt(10_000_000, 99_999_999))
  const chave43 = `${cUF}${aa}${mm}${cnpj}${mod}${serie}${nNF}${tpEmis}${cNF}`
  const cDV = calcularDigitoVerificadorMod11(chave43)
  return { chave: `${chave43}${cDV}`, cNF, cDV }
}

export interface MatrizRegraInput {
  ncm: string
  ufOrigem: string
  ufDestino: string
  regimeTributario: string
  cstCsosn: string
  aliqIcms: string | number
  reducaoBaseIcmsPct: string | number
  aliqIcmsSt: string | number
}

export interface ItemFiscalCalculado {
  n_item: number
  produto_id: string | null
  codigo: string
  descricao: string
  ncm: string
  cest: string
  cfop: string
  unidade: string
  qtd: number
  valor_unitario: number
  valor_total: number
  valor_desconto: number
  orig: string
  cst_csosn: string
  p_red_bc: number
  v_bc_icms: number
  p_icms: number
  v_icms: number
  v_icms_st: number
  cst_pis: string
  p_pis: number
  v_pis: number
  cst_cofins: string
  p_cofins: number
  v_cofins: number
  // Reforma Tributária 2026 (LC 214/2025 — IBS / CBS)
  c_class_trib: string
  v_bc_ibs_cbs: number
  p_ibs_uf: number
  v_ibs_uf: number
  p_cbs: number
  v_cbs: number
  regra_origem: string
  lote?: string
  validade?: string
}

export function ehNcmCarneCestaBasica(ncm: string): boolean {
  const d = onlyDigits(ncm)
  return PREFIXOS_NCM_CARNE_CESTA_BASICA.some((pref) => d.startsWith(pref))
}

export function calcularTributacaoItem(params: {
  nItem: number
  produtoId?: string | null
  codigo: string
  descricao: string
  ncm?: string
  cest?: string
  orig?: string
  unidade?: string
  qtd: number
  valorUnitario: number
  valorDesconto?: number
  cfopExplicito?: string
  tipoOperacao: 'SAIDA' | 'DEVOLUCAO' | 'ENTRADA'
  modelo: '55' | '65'
  tipoUnidadeFilial?: string
  ufOrigem: string
  ufDestino: string
  regimeTributario: string // SIMPLES | PRESUMIDO | REAL
  matrizRegras?: MatrizRegraInput[]
  lote?: string
  validade?: string
}): ItemFiscalCalculado {
  const ufOrig = String(params.ufOrigem || 'SP').toUpperCase()
  const ufDest = params.modelo === '65' ? ufOrig : String(params.ufDestino || ufOrig).toUpperCase()
  const mesmaUf = ufOrig === ufDest
  const regime = String(params.regimeTributario || 'SIMPLES').toUpperCase()
  const ncmLimpo = onlyDigits(params.ncm || '').padEnd(8, '0').slice(0, 8) || '02013000'
  const ncmFinal = onlyDigits(params.ncm || '').length >= 4 ? onlyDigits(params.ncm || '').slice(0, 8) : '02013000'
  const ehCarne = ehNcmCarneCestaBasica(ncmFinal)

  let cfop = onlyDigits(params.cfopExplicito || '').slice(0, 4)
  if (cfop.length !== 4) {
    if (params.tipoOperacao === 'DEVOLUCAO') {
      cfop = mesmaUf ? '1202' : '2202'
    } else if (params.modelo === '65') {
      cfop = '5102'
    } else if (params.tipoUnidadeFilial === 'INDUSTRIA') {
      cfop = mesmaUf ? '5101' : '6101'
    } else {
      cfop = mesmaUf ? '5102' : '6102'
    }
  }

  const qtd = Number(Number(params.qtd || 0).toFixed(4))
  const vUn = Number(Number(params.valorUnitario || 0).toFixed(4))
  const vProd = Number((qtd * vUn).toFixed(2))
  const vDesc = Number(Math.max(0, Number(params.valorDesconto || 0)).toFixed(2))
  const vLiquido = Math.max(0, Number((vProd - vDesc).toFixed(2)))

  // 1. Procura regra explícita na Matriz Tributária do Tenant (NCM exato ou 4 primeiros dígitos)
  const regras = params.matrizRegras || []
  const matchMatriz =
    regras.find(
      (r) =>
        onlyDigits(r.ncm) === ncmFinal &&
        r.ufOrigem.toUpperCase() === ufOrig &&
        r.ufDestino.toUpperCase() === ufDest &&
        r.regimeTributario.toUpperCase() === regime,
    ) ||
    regras.find(
      (r) =>
        onlyDigits(r.ncm) === ncmFinal.slice(0, 4) &&
        r.ufOrigem.toUpperCase() === ufOrig &&
        r.ufDestino.toUpperCase() === ufDest &&
        r.regimeTributario.toUpperCase() === regime,
    )

  let cstCsosn = '102'
  let pRedBc = 0
  let pIcms = 0
  let vBcIcms = 0
  let vIcms = 0
  let vIcmsSt = 0
  let regraOrigem = 'PADRAO_CARNES_BR'

  if (matchMatriz) {
    cstCsosn = String(matchMatriz.cstCsosn || (regime === 'SIMPLES' ? '102' : '00')).trim()
    pIcms = Number(matchMatriz.aliqIcms || 0)
    pRedBc = Number(matchMatriz.reducaoBaseIcmsPct || 0)
    const pSt = Number(matchMatriz.aliqIcmsSt || 0)
    regraOrigem = 'MATRIZ_TRIBUTARIA'
    if (regime !== 'SIMPLES' && pIcms > 0) {
      vBcIcms = Number((vLiquido * (1 - pRedBc / 100)).toFixed(2))
      vIcms = Number((vBcIcms * (pIcms / 100)).toFixed(2))
    }
    if (pSt > 0) {
      vIcmsSt = Number((vLiquido * (pSt / 100)).toFixed(2))
    }
  } else if (regime === 'SIMPLES') {
    cstCsosn = '102'
    pIcms = 0
    vBcIcms = 0
    vIcms = 0
    regraOrigem = ehCarne ? 'SIMPLES_CARNES_CSOSN102' : 'SIMPLES_PADRAO_CSOSN102'
  } else {
    // Lucro Presumido ou Lucro Real
    if (ehCarne && mesmaUf) {
      // Cesta Básica Carnes SP — Art. 74 Anexo II RICMS/SP: alíquota 12% c/ redução de BC 41,67% (carga efetiva = 7,00%)
      cstCsosn = '20'
      pIcms = 12
      pRedBc = 41.67
      vBcIcms = Number((vLiquido * (1 - pRedBc / 100)).toFixed(2))
      vIcms = Number((vBcIcms * (pIcms / 100)).toFixed(2))
      regraOrigem = 'CESTA_BASICA_CARNES_ART74_SP_7PCT'
    } else if (mesmaUf) {
      cstCsosn = '00'
      pIcms = 18
      vBcIcms = vLiquido
      vIcms = Number((vBcIcms * 0.18).toFixed(2))
      regraOrigem = 'ICMS_INTERNO_18PCT'
    } else {
      // Interestadual: 7% para N/NE/CO/ES saindo de S/SE; 12% demais
      cstCsosn = '00'
      pIcms = UFS_SUL_SUDESTE_EXCETO_ES.has(ufOrig) && !UFS_SUL_SUDESTE_EXCETO_ES.has(ufDest) ? 7 : 12
      vBcIcms = vLiquido
      vIcms = Number((vBcIcms * (pIcms / 100)).toFixed(2))
      regraOrigem = `ICMS_INTERESTADUAL_${pIcms}PCT`
    }
  }

  // PIS & COFINS (Carnes in natura = CST 06 Alíquota Zero Lei 10.925/2004!)
  let cstPis = '49'
  let pPis = 0
  let vPis = 0
  let cstCofins = '49'
  let pCofins = 0
  let vCofins = 0

  if (regime === 'SIMPLES') {
    cstPis = '49'
    cstCofins = '49'
  } else if (ehCarne) {
    cstPis = '06'
    cstCofins = '06'
  } else if (regime === 'REAL') {
    cstPis = '01'
    pPis = 1.65
    vPis = Number((vLiquido * 0.0165).toFixed(2))
    cstCofins = '01'
    pCofins = 7.6
    vCofins = Number((vLiquido * 0.076).toFixed(2))
  } else {
    cstPis = '01'
    pPis = 0.65
    vPis = Number((vLiquido * 0.0065).toFixed(2))
    cstCofins = '01'
    pCofins = 3.0
    vCofins = Number((vLiquido * 0.03).toFixed(2))
  }

  // Reforma Tributária 2026 (LC 214/2025 — Cesta Básica Nacional Carnes cClassTrib 200003 = 0% IBS/CBS; demais = 000001 c/ alíquota teste 0,10% IBS UF + 0,90% CBS)
  const cClassTrib = ehCarne ? '200003' : '000001'
  const incideIbsCbsTeste = regime !== 'SIMPLES' && !ehCarne
  const vBcIbsCbs = incideIbsCbsTeste ? vLiquido : 0
  const pIbsUf = incideIbsCbsTeste ? 0.1 : 0
  const vIbsUf = incideIbsCbsTeste ? Number((vBcIbsCbs * 0.001).toFixed(2)) : 0
  const pCbs = incideIbsCbsTeste ? 0.9 : 0
  const vCbs = incideIbsCbsTeste ? Number((vBcIbsCbs * 0.009).toFixed(2)) : 0

  return {
    n_item: params.nItem,
    produto_id: params.produtoId || null,
    codigo: String(params.codigo || params.nItem).trim(),
    descricao: String(params.descricao || 'MERCADORIA').trim().toUpperCase().slice(0, 120),
    ncm: ncmFinal.padEnd(8, '0').slice(0, 8) || ncmLimpo,
    cest: onlyDigits(params.cest || '').slice(0, 7),
    cfop,
    unidade: String(params.unidade || 'KG').trim().toUpperCase().slice(0, 6),
    qtd,
    valor_unitario: vUn,
    valor_total: vProd,
    valor_desconto: vDesc,
    orig: String(params.orig || '0').slice(0, 1),
    cst_csosn: cstCsosn,
    p_red_bc: pRedBc,
    v_bc_icms: vBcIcms,
    p_icms: pIcms,
    v_icms: vIcms,
    v_icms_st: vIcmsSt,
    cst_pis: cstPis,
    p_pis: pPis,
    v_pis: vPis,
    cst_cofins: cstCofins,
    p_cofins: pCofins,
    v_cofins: vCofins,
    c_class_trib: cClassTrib,
    v_bc_ibs_cbs: vBcIbsCbs,
    p_ibs_uf: pIbsUf,
    v_ibs_uf: vIbsUf,
    p_cbs: pCbs,
    v_cbs: vCbs,
    regra_origem: regraOrigem,
    lote: params.lote || '',
    validade: params.validade || '',
  }
}

export function gerarXmlNfe400(params: {
  chave: string
  cNF: string
  cDV: string
  protocolo: string
  ambiente: 'HOMOLOGACAO' | 'PRODUCAO'
  modelo: '55' | '65'
  serie: number
  numero: number
  naturezaOperacao: string
  tipoOperacao: 'SAIDA' | 'DEVOLUCAO' | 'ENTRADA'
  finalidade: '1' | '4'
  dataEmissaoIso: string
  emitente: {
    cnpj: string
    razaoSocial: string
    nomeFantasia: string
    ie: string
    crt: '1' | '3'
    uf: string
    cidade: string
    codigoIbge: string
  }
  destinatario: {
    nome: string
    doc: string
    ie: string
    uf: string
    cidade: string
    endereco: string
  }
  itens: ItemFiscalCalculado[]
  totais: {
    vProd: number
    vDesc: number
    vFrete: number
    vBC: number
    vICMS: number
    vST: number
    vPIS: number
    vCOFINS: number
    vIBS?: number
    vCBS?: number
    vNF: number
    pesoBruto: number
    pesoLiquido: number
    qtdVolumes: number
  }
  transporte?: {
    modFrete: string
    transportadora?: {
      nome: string
      doc?: string
      ie?: string
      endereco?: string
      cidade?: string
      uf?: string
      antt?: string
    } | null
    veiculo?: {
      placa: string
      uf?: string
      rntrc?: string
    } | null
    especieVolumes?: string
  }
  duplicatas?: Array<{
    numero: string
    vencimento: string
    valor: number
  }>
  tPag?: string
  infComplementar?: string
}): string {
  const tpAmb = params.ambiente === 'PRODUCAO' ? '1' : '2'
  const cUF = UF_CODIGO_IBGE[params.emitente.uf.toUpperCase()] || '35'
  const cMunFG = onlyDigits(params.emitente.codigoIbge) || `${cUF}50308`
  const tpNF = params.tipoOperacao === 'ENTRADA' || params.tipoOperacao === 'DEVOLUCAO' ? '0' : '1'
  const idDest =
    params.modelo === '65' || params.emitente.uf.toUpperCase() === (params.destinatario.uf || params.emitente.uf).toUpperCase()
      ? '1'
      : '2'
  const tpImp = params.modelo === '65' ? '4' : '1'
  const indFinal = params.modelo === '65' || !onlyDigits(params.destinatario.ie) ? '1' : '0'
  const indPres = params.modelo === '65' ? '1' : '9'

  const docDest = onlyDigits(params.destinatario.doc)
  const destNome =
    tpAmb === '2'
      ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
      : params.destinatario.nome || 'CONSUMIDOR FINAL'
  const ieDest = onlyDigits(params.destinatario.ie)
  const indIEDest = ieDest ? '1' : '9'

  const destXml =
    params.modelo === '65' && !docDest
      ? ''
      : `<dest>
      ${docDest.length === 14 ? `<CNPJ>${docDest}</CNPJ>` : docDest.length === 11 ? `<CPF>${docDest}</CPF>` : `<idEstrangeiro></idEstrangeiro>`}
      <xNome>${escXml(destNome)}</xNome>
      ${
        params.modelo === '55'
          ? `<enderDest>
        <xLgr>${escXml(params.destinatario.endereco || 'ENDERECO NAO INFORMADO')}</xLgr>
        <nro>SN</nro>
        <xBairro>CENTRO</xBairro>
        <cMun>${UF_CODIGO_IBGE[(params.destinatario.uf || 'SP').toUpperCase()] || '35'}50308</cMun>
        <xMun>${escXml(params.destinatario.cidade || 'SAO PAULO')}</xMun>
        <UF>${escXml((params.destinatario.uf || 'SP').toUpperCase())}</UF>
        <cPais>1058</cPais>
        <xPais>BRASIL</xPais>
      </enderDest>`
          : ''
      }
      <indIEDest>${indIEDest}</indIEDest>
      ${ieDest ? `<IE>${ieDest}</IE>` : ''}
    </dest>`

  const detsXml = params.itens
    .map((it) => {
      const isSimples = params.emitente.crt === '1'
      const icmsXml = isSimples
        ? `<ICMSSN102><orig>${it.orig}</orig><CSOSN>${escXml(it.cst_csosn || '102')}</CSOSN></ICMSSN102>`
        : it.cst_csosn === '20'
          ? `<ICMS20><orig>${it.orig}</orig><CST>20</CST><modBC>3</modBC><pRedBC>${it.p_red_bc.toFixed(2)}</pRedBC><vBC>${it.v_bc_icms.toFixed(2)}</vBC><pICMS>${it.p_icms.toFixed(2)}</pICMS><vICMS>${it.v_icms.toFixed(2)}</vICMS></ICMS20>`
          : `<ICMS00><orig>${it.orig}</orig><CST>00</CST><modBC>3</modBC><vBC>${it.v_bc_icms.toFixed(2)}</vBC><pICMS>${it.p_icms.toFixed(2)}</pICMS><vICMS>${it.v_icms.toFixed(2)}</vICMS></ICMS00>`

      const pisXml =
        it.cst_pis === '01'
          ? `<PISAliq><CST>01</CST><vBC>${Math.max(0, it.valor_total - it.valor_desconto).toFixed(2)}</vBC><pPIS>${it.p_pis.toFixed(2)}</pPIS><vPIS>${it.v_pis.toFixed(2)}</vPIS></PISAliq>`
          : it.cst_pis === '06'
            ? `<PISNT><CST>06</CST></PISNT>`
            : `<PISOutr><CST>${escXml(it.cst_pis || '49')}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr>`

      const cofinsXml =
        it.cst_cofins === '01'
          ? `<COFINSAliq><CST>01</CST><vBC>${Math.max(0, it.valor_total - it.valor_desconto).toFixed(2)}</vBC><pCOFINS>${it.p_cofins.toFixed(2)}</pCOFINS><vCOFINS>${it.v_cofins.toFixed(2)}</vCOFINS></COFINSAliq>`
          : it.cst_cofins === '06'
            ? `<COFINSNT><CST>06</CST></COFINSNT>`
            : `<COFINSOutr><CST>${escXml(it.cst_cofins || '49')}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr>`

      return `<det nItem="${it.n_item}">
      <prod>
        <cProd>${escXml(it.codigo)}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${escXml(it.descricao)}</xProd>
        <NCM>${escXml(it.ncm)}</NCM>
        ${it.cest ? `<CEST>${escXml(it.cest)}</CEST>` : ''}
        <CFOP>${escXml(it.cfop)}</CFOP>
        <uCom>${escXml(it.unidade)}</uCom>
        <qCom>${it.qtd.toFixed(4)}</qCom>
        <vUnCom>${it.valor_unitario.toFixed(4)}</vUnCom>
        <vProd>${it.valor_total.toFixed(2)}</vProd>
        <cEANTrib>SEM GTIN</cEANTrib>
        <uTrib>${escXml(it.unidade)}</uTrib>
        <qTrib>${it.qtd.toFixed(4)}</qTrib>
        <vUnTrib>${it.valor_unitario.toFixed(4)}</vUnTrib>
        ${it.valor_desconto > 0 ? `<vDesc>${it.valor_desconto.toFixed(2)}</vDesc>` : ''}
        <indTot>1</indTot>
      </prod>
      <imposto>
        <ICMS>${icmsXml}</ICMS>
        <PIS>${pisXml}</PIS>
        <COFINS>${cofinsXml}</COFINS>
      </imposto>
    </det>`
    })
    .join('\n    ')

  const digestVal = crypto.createHash('sha256').update(`${params.chave}|${params.totais.vNF}`).digest('base64')

  const modFreteXml = params.modelo === '65' ? '9' : escXml(params.transporte?.modFrete || '0')
  const transpObj = params.transporte?.transportadora
  const transpDoc = onlyDigits(transpObj?.doc || '')
  const transportaXml =
    params.modelo === '55' && transpObj?.nome
      ? `<transporta>
          ${transpDoc.length === 14 ? `<CNPJ>${transpDoc}</CNPJ>` : transpDoc.length === 11 ? `<CPF>${transpDoc}</CPF>` : ''}
          <xNome>${escXml(transpObj.nome)}</xNome>
          ${onlyDigits(transpObj.ie) ? `<IE>${onlyDigits(transpObj.ie)}</IE>` : ''}
          ${transpObj.endereco ? `<xEnder>${escXml(transpObj.endereco)}</xEnder>` : ''}
          ${transpObj.cidade ? `<xMun>${escXml(transpObj.cidade)}</xMun>` : ''}
          ${transpObj.uf ? `<UF>${escXml(transpObj.uf.toUpperCase())}</UF>` : ''}
        </transporta>`
      : ''

  const veicObj = params.transporte?.veiculo
  const placaLimpa = String(veicObj?.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const veicXml =
    params.modelo === '55' && placaLimpa
      ? `<veicTransp>
          <placa>${escXml(placaLimpa)}</placa>
          <UF>${escXml((veicObj?.uf || params.emitente.uf || 'SP').toUpperCase())}</UF>
          ${veicObj?.rntrc || transpObj?.antt ? `<RNTC>${escXml(veicObj?.rntrc || transpObj?.antt)}</RNTC>` : ''}
        </veicTransp>`
      : ''

  const dups = Array.isArray(params.duplicatas) ? params.duplicatas.filter((d) => Number(d.valor) > 0) : []
  const cobrXml =
    params.modelo === '55' && dups.length > 0
      ? `<cobr>
        <fat>
          <nFat>${String(params.numero).padStart(6, '0')}</nFat>
          <vOrig>${params.totais.vNF.toFixed(2)}</vOrig>
          <vDesc>${params.totais.vDesc.toFixed(2)}</vDesc>
          <vLiq>${params.totais.vNF.toFixed(2)}</vLiq>
        </fat>
        ${dups
          .map(
            (d, idx) => `<dup>
          <nDup>${escXml(d.numero || String(idx + 1).padStart(3, '0'))}</nDup>
          <dVenc>${escXml(String(d.vencimento).slice(0, 10))}</dVenc>
          <vDup>${Number(d.valor).toFixed(2)}</vDup>
        </dup>`,
          )
          .join('\n        ')}
      </cobr>`
      : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${params.chave}" versao="4.00">
      <ide>
        <cUF>${cUF}</cUF>
        <cNF>${params.cNF}</cNF>
        <natOp>${escXml(params.naturezaOperacao)}</natOp>
        <mod>${params.modelo}</mod>
        <serie>${params.serie}</serie>
        <nNF>${params.numero}</nNF>
        <dhEmi>${params.dataEmissaoIso}</dhEmi>
        <tpNF>${tpNF}</tpNF>
        <idDest>${idDest}</idDest>
        <cMunFG>${cMunFG}</cMunFG>
        <tpImp>${tpImp}</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>${params.cDV}</cDV>
        <tpAmb>${tpAmb}</tpAmb>
        <finNFe>${params.finalidade}</finNFe>
        <indFinal>${indFinal}</indFinal>
        <indPres>${indPres}</indPres>
        <procEmi>0</procEmi>
        <verProc>WMSphere-ERP-4.00</verProc>
      </ide>
      <emit>
        <CNPJ>${onlyDigits(params.emitente.cnpj).padStart(14, '0').slice(-14)}</CNPJ>
        <xNome>${escXml(params.emitente.razaoSocial)}</xNome>
        <xFant>${escXml(params.emitente.nomeFantasia || params.emitente.razaoSocial)}</xFant>
        <enderEmit>
          <xLgr>SEDE OPERACIONAL</xLgr>
          <nro>SN</nro>
          <xBairro>DISTRITO INDUSTRIAL</xBairro>
          <cMun>${cMunFG}</cMun>
          <xMun>${escXml(params.emitente.cidade || 'SAO PAULO')}</xMun>
          <UF>${escXml(params.emitente.uf.toUpperCase())}</UF>
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>
        </enderEmit>
        <IE>${onlyDigits(params.emitente.ie) || 'ISENTO'}</IE>
        <CRT>${params.emitente.crt}</CRT>
      </emit>
      ${destXml}
      ${detsXml}
      <total>
        <ICMSTot>
          <vBC>${params.totais.vBC.toFixed(2)}</vBC>
          <vICMS>${params.totais.vICMS.toFixed(2)}</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>${params.totais.vST.toFixed(2)}</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>${params.totais.vProd.toFixed(2)}</vProd>
          <vFrete>${params.totais.vFrete.toFixed(2)}</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>${params.totais.vDesc.toFixed(2)}</vDesc>
          <vII>0.00</vII>
          <vIPI>0.00</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>${params.totais.vPIS.toFixed(2)}</vPIS>
          <vCOFINS>${params.totais.vCOFINS.toFixed(2)}</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>${params.totais.vNF.toFixed(2)}</vNF>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>${modFreteXml}</modFrete>
        ${transportaXml}
        ${veicXml}
        ${
          params.modelo === '55' && (params.totais.qtdVolumes > 0 || params.totais.pesoLiquido > 0)
            ? `<vol>
          <qVol>${params.totais.qtdVolumes || 1}</qVol>
          <esp>${escXml(params.transporte?.especieVolumes || 'CAIXA')}</esp>
          <pesoL>${params.totais.pesoLiquido.toFixed(3)}</pesoL>
          <pesoB>${(params.totais.pesoBruto || params.totais.pesoLiquido).toFixed(3)}</pesoB>
        </vol>`
            : ''
        }
      </transp>
      ${cobrXml}
      <pag>
        <detPag>
          <tPag>${escXml(params.tPag || '99')}</tPag>
          <vPag>${params.totais.vNF.toFixed(2)}</vPag>
        </detPag>
      </pag>
      ${
        params.infComplementar
          ? `<infAdic><infCpl>${escXml(params.infComplementar)}</infCpl></infAdic>`
          : ''
      }
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>${tpAmb}</tpAmb>
      <verAplic>SVRS_WMSphere_4.00</verAplic>
      <chNFe>${params.chave}</chNFe>
      <dhRecbto>${params.dataEmissaoIso}</dhRecbto>
      <nProt>${escXml(params.protocolo)}</nProt>
      <digVal>${digestVal}</digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da ${params.modelo === '65' ? 'NFC-e' : 'NF-e'}</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`
}

export function gerarXmlEventoFiscal(params: {
  tipoEvento: 'CANCELAMENTO' | 'CARTA_CORRECAO' | 'INUTILIZACAO'
  chaveAcesso?: string
  cnpjEmitente: string
  ambiente: 'HOMOLOGACAO' | 'PRODUCAO'
  sequencia: number
  descricao: string
  protocoloOriginal?: string
  protocoloEvento: string
  dataEventoIso: string
  modelo?: string
  serie?: number
  numeroInicial?: number
  numeroFinal?: number
}): string {
  const tpAmb = params.ambiente === 'PRODUCAO' ? '1' : '2'
  const cnpj = onlyDigits(params.cnpjEmitente).padStart(14, '0').slice(-14)
  if (params.tipoEvento === 'INUTILIZACAO') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ProcInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <inutNFe versao="4.00">
    <infInut>
      <tpAmb>${tpAmb}</tpAmb>
      <xServ>INUTILIZAR</xServ>
      <CNPJ>${cnpj}</CNPJ>
      <mod>${escXml(params.modelo || '55')}</mod>
      <serie>${params.serie || 1}</serie>
      <nNFIni>${params.numeroInicial || 0}</nNFIni>
      <nNFFin>${params.numeroFinal || 0}</nNFFin>
      <xJust>${escXml(params.descricao)}</xJust>
    </infInut>
  </inutNFe>
  <retInutNFe versao="4.00">
    <infInut>
      <tpAmb>${tpAmb}</tpAmb>
      <cStat>102</cStat>
      <xMotivo>Inutilizacao de numero homologado</xMotivo>
      <dhRecbto>${params.dataEventoIso}</dhRecbto>
      <nProt>${escXml(params.protocoloEvento)}</nProt>
    </infInut>
  </retInutNFe>
</ProcInutNFe>`
  }

  const tpEvento = params.tipoEvento === 'CANCELAMENTO' ? '110111' : '110110'
  const descEvento = params.tipoEvento === 'CANCELAMENTO' ? 'Cancelamento' : 'Carta de Correcao'
  const detEvento =
    params.tipoEvento === 'CANCELAMENTO'
      ? `<nProt>${escXml(params.protocoloOriginal || '')}</nProt><xJust>${escXml(params.descricao)}</xJust>`
      : `<xCorrecao>${escXml(params.descricao)}</xCorrecao><xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal.</xCondUso>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <evento versao="1.00">
    <infEvento>
      <tpAmb>${tpAmb}</tpAmb>
      <CNPJ>${cnpj}</CNPJ>
      <chNFe>${escXml(params.chaveAcesso || '')}</chNFe>
      <dhEvento>${params.dataEventoIso}</dhEvento>
      <tpEvento>${tpEvento}</tpEvento>
      <nSeqEvento>${params.sequencia}</nSeqEvento>
      <verEvento>1.00</verEvento>
      <detEvento versao="1.00">
        <descEvento>${descEvento}</descEvento>
        ${detEvento}
      </detEvento>
    </infEvento>
  </evento>
  <retEvento versao="1.00">
    <infEvento>
      <tpAmb>${tpAmb}</tpAmb>
      <cStat>135</cStat>
      <xMotivo>Evento registrado e vinculado a NF-e</xMotivo>
      <dhRegEvento>${params.dataEventoIso}</dhRegEvento>
      <nProt>${escXml(params.protocoloEvento)}</nProt>
    </infEvento>
  </retEvento>
</procEventoNFe>`
}
