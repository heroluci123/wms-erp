import { HttpError } from '../../middlewares/auth.js'

export type ProvedorCnpj = 'AUTO' | 'BRASILAPI' | 'CNPJWS' | 'RECEITAWS' | 'OPENCNPJ'

export interface InscricaoEstadualInfo {
  uf: string
  numero: string
  ativo: boolean
}

export interface CnpjConsultaResultado {
  cnpj: string
  cnpj_formatado: string
  provedor_usado: string
  provedores_consultados: string[]
  tipo_empresa: string
  porte: string
  abertura: string
  razao_social: string
  nome_fantasia: string
  endereco: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  email: string
  telefone: string
  inscricao_estadual: string
  inscricoes_estaduais: InscricaoEstadualInfo[]
  regime_apuracao: string
  cnae_principal: string
  situacao: string
  motivo_situacao: string
}

const CACHE_TTL_MS = 15 * 60 * 1000
const lookupCache = new Map<string, { exp: number; data: CnpjConsultaResultado }>()

export function clearCnpjLookupCache(): void {
  lookupCache.clear()
}

export function limparCnpj(raw: unknown): string {
  return String(raw ?? '').replace(/\D+/g, '')
}

export function formatarCnpj(raw: unknown): string {
  const d = limparCnpj(raw)
  if (d.length !== 14) return d
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function validarCnpjDigitos(raw: unknown): boolean {
  const cnpj = limparCnpj(raw)
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const calcDigito = (base: string, pesos: number[]) => {
    let soma = 0
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * pesos[i]
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const d1 = calcDigito(cnpj.slice(0, 12), p1)
  const d2 = calcDigito(cnpj.slice(0, 12) + String(d1), p2)
  return Number(cnpj[12]) === d1 && Number(cnpj[13]) === d2
}

function fmtCep(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D+/g, '').slice(0, 8)
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`
  return d
}

function fmtTel(dddOrFull: unknown, numOpt?: unknown): string {
  const full = `${String(dddOrFull ?? '')}${String(numOpt ?? '')}`.replace(/\D+/g, '')
  if (!full) return ''
  if (full.length === 11) return full.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (full.length === 10) return full.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return full
}

function fmtDataBr(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
  return s
}

function fmtCnae(codRaw: unknown, descRaw: unknown): string {
  const digits = String(codRaw ?? '').replace(/\D+/g, '')
  const codFmt =
    digits.length === 7
      ? `${digits.slice(0, 4)}-${digits[4]}/${digits.slice(5)}`
      : String(codRaw ?? '').trim()
  const desc = String(descRaw ?? '').trim()
  if (codFmt && desc) return `${codFmt} - ${desc}`
  return codFmt || desc
}

function up(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 5500): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'WMSphere-ERP/1.0',
        Accept: 'application/json',
      },
    })
    if (res.status === 404) {
      throw Object.assign(new Error('CNPJ não encontrado na Receita Federal.'), { notFound: true })
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function parseBrasilApi(b: any, cnpj: string): Partial<CnpjConsultaResultado> {
  if (!b || !b.razao_social) throw new Error('Resposta inválida da BrasilAPI.')

  const tipoLogr = up(b.descricao_tipo_de_logradouro)
  const logr = up(b.logradouro)
  const endereco = tipoLogr && logr && !logr.startsWith(tipoLogr) ? `${tipoLogr} ${logr}` : logr

  let regime = ''
  if (b.opcao_pelo_mei) {
    regime = 'MEI (SIMPLES NACIONAL)'
  } else if (b.opcao_pelo_simples) {
    regime = 'OPTANTE SIMPLES NACIONAL'
  } else if (Array.isArray(b.regime_tributario) && b.regime_tributario.length > 0) {
    const ultimo = [...b.regime_tributario].sort((x, y) => Number(y?.ano || 0) - Number(x?.ano || 0))[0]
    if (ultimo?.forma_de_tributacao) {
      regime = up(ultimo.forma_de_tributacao)
    }
  }
  if (!regime && b.opcao_pelo_simples === false) {
    regime = 'NORMAL (NAO OPTANTE SIMPLES)'
  }

  return {
    cnpj,
    cnpj_formatado: formatarCnpj(cnpj),
    tipo_empresa: up(b.descricao_identificador_matriz_filial || (b.identificador_matriz_filial === 1 ? 'MATRIZ' : 'FILIAL')),
    porte: up(b.porte),
    abertura: fmtDataBr(b.data_inicio_atividade),
    razao_social: up(b.razao_social),
    nome_fantasia: up(b.nome_fantasia || b.razao_social),
    endereco,
    numero: up(b.numero),
    complemento: up(b.complemento),
    bairro: up(b.bairro),
    cidade: up(b.municipio),
    uf: up(b.uf).slice(0, 2),
    cep: fmtCep(b.cep),
    email: String(b.email || '').trim().toLowerCase(),
    telefone: fmtTel(b.ddd_telefone_1) || fmtTel(b.ddd_telefone_2),
    regime_apuracao: regime,
    cnae_principal: fmtCnae(b.cnae_fiscal, b.cnae_fiscal_descricao),
    situacao: up(b.descricao_situacao_cadastral),
    motivo_situacao: up(b.descricao_motivo_situacao_cadastral),
  }
}

function parseCnpjWs(c: any, cnpj: string): Partial<CnpjConsultaResultado> {
  const est = c?.estabelecimento
  if (!c?.razao_social || !est) throw new Error('Resposta inválida da CNPJ.ws.')

  const ufEstab = up(est.estado?.sigla).slice(0, 2)
  const iesRaw: any[] = Array.isArray(est.inscricoes_estaduais) ? est.inscricoes_estaduais : []
  const ies: InscricaoEstadualInfo[] = iesRaw
    .map((ie) => ({
      uf: up(ie?.estado?.sigla).slice(0, 2),
      numero: String(ie?.inscricao_estadual || '').trim(),
      ativo: Boolean(ie?.ativo),
    }))
    .filter((ie) => ie.numero)

  const iePreferida =
    ies.find((x) => x.ativo && x.uf === ufEstab) ||
    ies.find((x) => x.ativo) ||
    ies.find((x) => x.uf === ufEstab) ||
    ies[0]

  const tipoLogr = up(est.tipo_logradouro)
  const logr = up(est.logradouro)
  const endereco = tipoLogr && logr && !logr.startsWith(tipoLogr) ? `${tipoLogr} ${logr}` : logr

  let regime = ''
  if (up(c.simples?.mei) === 'SIM') regime = 'MEI (SIMPLES NACIONAL)'
  else if (up(c.simples?.simples) === 'SIM') regime = 'OPTANTE SIMPLES NACIONAL'

  return {
    cnpj,
    cnpj_formatado: formatarCnpj(cnpj),
    tipo_empresa: up(est.tipo),
    porte: up(c.porte?.descricao),
    abertura: fmtDataBr(est.data_inicio_atividade),
    razao_social: up(c.razao_social),
    nome_fantasia: up(est.nome_fantasia || c.razao_social),
    endereco,
    numero: up(est.numero),
    complemento: up(est.complemento),
    bairro: up(est.bairro),
    cidade: up(est.cidade?.nome),
    uf: ufEstab,
    cep: fmtCep(est.cep),
    email: String(est.email || '').trim().toLowerCase(),
    telefone: fmtTel(est.ddd1, est.telefone1) || fmtTel(est.ddd2, est.telefone2),
    inscricao_estadual: iePreferida?.numero || '',
    inscricoes_estaduais: ies,
    regime_apuracao: regime,
    cnae_principal: fmtCnae(est.atividade_principal?.id, est.atividade_principal?.descricao),
    situacao: up(est.situacao_cadastral),
    motivo_situacao: up(est.motivo_situacao_cadastral?.descricao),
  }
}

function parseReceitaWs(r: any, cnpj: string): Partial<CnpjConsultaResultado> {
  if (!r || r.status === 'ERROR' || !r.nome) {
    throw new Error(r?.message || 'Resposta inválida da ReceitaWS.')
  }
  const cnaeObj = Array.isArray(r.atividade_principal) ? r.atividade_principal[0] : null
  const tel = String(r.telefone || '').split('/')[0]?.trim() || ''
  let regime = ''
  if (r.simei?.optante) regime = 'MEI (SIMPLES NACIONAL)'
  else if (r.simples?.optante) regime = 'OPTANTE SIMPLES NACIONAL'

  return {
    cnpj,
    cnpj_formatado: formatarCnpj(cnpj),
    tipo_empresa: up(r.tipo),
    porte: up(r.porte),
    abertura: fmtDataBr(r.abertura),
    razao_social: up(r.nome),
    nome_fantasia: up(r.fantasia || r.nome),
    endereco: up(r.logradouro),
    numero: up(r.numero),
    complemento: up(r.complemento),
    bairro: up(r.bairro),
    cidade: up(r.municipio),
    uf: up(r.uf).slice(0, 2),
    cep: fmtCep(r.cep),
    email: String(r.email || '').trim().toLowerCase(),
    telefone: fmtTel(tel) || tel,
    regime_apuracao: regime,
    cnae_principal: fmtCnae(cnaeObj?.code, cnaeObj?.text),
    situacao: up(r.situacao),
    motivo_situacao: up(r.motivo_situacao),
  }
}

function parseOpenCnpj(o: any, cnpj: string): Partial<CnpjConsultaResultado> {
  if (!o || !o.razao_social) throw new Error('Resposta inválida da OpenCNPJ.')
  const cnaePrin = Array.isArray(o.cnaes) ? o.cnaes.find((c: any) => c.is_principal) || o.cnaes[0] : null
  const telObj = Array.isArray(o.telefones) ? o.telefones.find((t: any) => !t.is_fax) || o.telefones[0] : null
  const tel = telObj ? fmtTel(telObj.ddd, telObj.numero) : ''

  let regime = ''
  if (up(o.opcao_mei) === 'S' || o.opcao_mei === true) regime = 'MEI (SIMPLES NACIONAL)'
  else if (up(o.opcao_simples) === 'S' || o.opcao_simples === true) regime = 'OPTANTE SIMPLES NACIONAL'

  return {
    cnpj,
    cnpj_formatado: formatarCnpj(cnpj),
    tipo_empresa: up(o.matriz_filial),
    porte: up(o.porte_empresa),
    abertura: fmtDataBr(o.data_inicio_atividade),
    razao_social: up(o.razao_social),
    nome_fantasia: up(o.nome_fantasia || o.razao_social),
    endereco: up(o.logradouro),
    numero: up(o.numero),
    complemento: up(o.complemento),
    bairro: up(o.bairro),
    cidade: up(o.municipio),
    uf: up(o.uf).slice(0, 2),
    cep: fmtCep(o.cep),
    email: String(o.email || '').trim().toLowerCase(),
    telefone: tel,
    regime_apuracao: regime,
    cnae_principal: fmtCnae(o.cnae_principal || cnaePrin?.codigo, cnaePrin?.descricao),
    situacao: up(o.situacao_cadastral),
    motivo_situacao: '',
  }
}

function mergePartials(
  cnpj: string,
  partials: Array<{ provider: string; data: Partial<CnpjConsultaResultado> }>,
): CnpjConsultaResultado {
  const firstNonEmpty = <K extends keyof CnpjConsultaResultado>(key: K, fallback: any = '') => {
    for (const p of partials) {
      const val = p.data[key]
      if (Array.isArray(val) && val.length > 0) return val
      if (!Array.isArray(val) && val !== undefined && val !== null && String(val).trim() !== '') return val
    }
    return fallback
  }

  return {
    cnpj,
    cnpj_formatado: formatarCnpj(cnpj),
    provedor_usado: partials.map((p) => p.provider).join(' + '),
    provedores_consultados: partials.map((p) => p.provider),
    tipo_empresa: String(firstNonEmpty('tipo_empresa', '')),
    porte: String(firstNonEmpty('porte', '')),
    abertura: String(firstNonEmpty('abertura', '')),
    razao_social: String(firstNonEmpty('razao_social', '')),
    nome_fantasia: String(firstNonEmpty('nome_fantasia', '')),
    endereco: String(firstNonEmpty('endereco', '')),
    numero: String(firstNonEmpty('numero', '')),
    complemento: String(firstNonEmpty('complemento', '')),
    bairro: String(firstNonEmpty('bairro', '')),
    cidade: String(firstNonEmpty('cidade', '')),
    uf: String(firstNonEmpty('uf', '')),
    cep: String(firstNonEmpty('cep', '')),
    email: String(firstNonEmpty('email', '')),
    telefone: String(firstNonEmpty('telefone', '')),
    inscricao_estadual: String(firstNonEmpty('inscricao_estadual', '')),
    inscricoes_estaduais: firstNonEmpty('inscricoes_estaduais', []) as InscricaoEstadualInfo[],
    regime_apuracao: String(firstNonEmpty('regime_apuracao', '')),
    cnae_principal: String(firstNonEmpty('cnae_principal', '')),
    situacao: String(firstNonEmpty('situacao', '')),
    motivo_situacao: String(firstNonEmpty('motivo_situacao', '')),
  }
}

export async function consultarCnpjReceita(
  cnpjRaw: string,
  provedorReq: ProvedorCnpj = 'AUTO',
  options?: { ignorarCache?: boolean },
): Promise<CnpjConsultaResultado> {
  const cnpj = limparCnpj(cnpjRaw)
  if (!validarCnpjDigitos(cnpj)) {
    throw new HttpError(400, 'CNPJ inválido. Verifique os 14 dígitos informados.')
  }

  const prov = (String(provedorReq || 'AUTO').toUpperCase() as ProvedorCnpj) || 'AUTO'
  const cacheKey = `${prov}:${cnpj}`
  if (!options?.ignorarCache) {
    const cached = lookupCache.get(cacheKey)
    if (cached && cached.exp > Date.now()) {
      return cached.data
    }
  }

  const runBrasilApi = async () => ({
    provider: 'BrasilAPI',
    data: parseBrasilApi(await fetchJsonWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`), cnpj),
  })
  const runCnpjWs = async () => ({
    provider: 'CNPJ.ws',
    data: parseCnpjWs(await fetchJsonWithTimeout(`https://publica.cnpj.ws/cnpj/${cnpj}`), cnpj),
  })
  const runReceitaWs = async () => ({
    provider: 'ReceitaWS',
    data: parseReceitaWs(await fetchJsonWithTimeout(`https://receitaws.com.br/v1/cnpj/${cnpj}`), cnpj),
  })
  const runOpenCnpj = async () => ({
    provider: 'OpenCNPJ',
    data: parseOpenCnpj(await fetchJsonWithTimeout(`https://api.opencnpj.org/${cnpj}`), cnpj),
  })

  const resultados: Array<{ provider: string; data: Partial<CnpjConsultaResultado> }> = []
  let notFoundSeen = false
  let lastError = 'Nenhum provedor público de CNPJ respondeu no momento.'

  if (prov === 'BRASILAPI') {
    const r = await runBrasilApi().catch((e) => {
      if (e?.notFound) notFoundSeen = true
      lastError = e?.message || lastError
      return null
    })
    if (r) resultados.push(r)
  } else if (prov === 'CNPJWS') {
    const r = await runCnpjWs().catch((e) => {
      if (e?.notFound) notFoundSeen = true
      lastError = e?.message || lastError
      return null
    })
    if (r) resultados.push(r)
  } else if (prov === 'RECEITAWS') {
    const r = await runReceitaWs().catch((e) => {
      if (e?.notFound) notFoundSeen = true
      lastError = e?.message || lastError
      return null
    })
    if (r) resultados.push(r)
  } else if (prov === 'OPENCNPJ') {
    const r = await runOpenCnpj().catch((e) => {
      if (e?.notFound) notFoundSeen = true
      lastError = e?.message || lastError
      return null
    })
    if (r) resultados.push(r)
  } else {
    // AUTO: consulta CNPJ.ws (traz I.E. + E-mail) + BrasilAPI (traz Regime Tributário completo) em paralelo
    const [resCnpjWs, resBrasil] = await Promise.allSettled([runCnpjWs(), runBrasilApi()])
    if (resCnpjWs.status === 'fulfilled') resultados.push(resCnpjWs.value)
    else {
      if (resCnpjWs.reason?.notFound) notFoundSeen = true
      lastError = resCnpjWs.reason?.message || lastError
    }
    if (resBrasil.status === 'fulfilled') resultados.push(resBrasil.value)
    else {
      if (resBrasil.reason?.notFound) notFoundSeen = true
      lastError = resBrasil.reason?.message || lastError
    }

    // Fallback para OpenCNPJ / ReceitaWS se nenhum dos principais respondeu
    if (resultados.length === 0) {
      for (const fallbackFn of [runOpenCnpj, runReceitaWs]) {
        try {
          resultados.push(await fallbackFn())
          break
        } catch (err: any) {
          if (err?.notFound) notFoundSeen = true
          lastError = err?.message || lastError
        }
      }
    }
  }

  if (resultados.length === 0) {
    if (notFoundSeen) {
      throw new HttpError(404, `CNPJ ${formatarCnpj(cnpj)} não encontrado na base da Receita Federal.`)
    }
    throw new HttpError(502, `Falha ao consultar CNPJ nos provedores públicos (${lastError}). Tente novamente em alguns segundos.`)
  }

  const finalData = mergePartials(cnpj, resultados)
  lookupCache.set(cacheKey, { exp: Date.now() + CACHE_TTL_MS, data: finalData })
  return finalData
}
