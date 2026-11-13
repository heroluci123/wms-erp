/**
 * Utilitários compartilhados de Rastreabilidade, Lote automático, Pesagem por Tara e Formatação.
 */

export function hojeIsoLocal() {
  const d = new Date()
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

export function parseNumero(val) {
  if (val === null || val === undefined || val === '') return NaN
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN
  const clean = String(val).trim().replace(',', '.')
  const num = Number(clean)
  return Number.isFinite(num) ? num : NaN
}

/**
 * Converte data de produção ('YYYY-MM-DD', 'DD/MM/YYYY' ou ISO datetime) para lote no padrão DDMMYY.
 * Exemplo: '2026-11-12' => '121126'.
 */
export function gerarLotePorData(dataProducao) {
  if (!dataProducao) return ''
  const s = String(dataProducao).trim()

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch
    return `${dd}${mm}${yyyy.slice(-2)}`
  }

  const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brMatch) {
    const [, dd, mm, yyyy] = brMatch
    return `${dd}${mm}${yyyy.slice(-2)}`
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}

/**
 * Normaliza data para YYYY-MM-DD.
 */
export function normalizarDataIso(data) {
  if (!data) return ''
  const s = String(data).trim()
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`
  return ''
}

/**
 * Calcula peso líquido = peso bruto - tara (3 casas decimais para suportar taras em gramas ex: 0,700 kg).
 */
export function calcularPesoLiquido(pesoBruto, taraKg = 0) {
  const bruto = parseNumero(pesoBruto)
  const tara = parseNumero(taraKg ?? 0)
  if (!Number.isFinite(bruto)) return NaN
  const taraVal = Number.isFinite(tara) ? tara : 0
  return Number((bruto - taraVal).toFixed(3))
}

/**
 * Valida o conjunto completo de pesagem obrigatória por Tara e Quantidade de Peças e gera lote DDMMYY.
 */
export function validarPesagemTara({
  dataProducao,
  validade,
  taraId,
  taraKg,
  pesoBruto,
  qtdPecas,
  exigirDataProducao = true,
  exigirValidade = true,
  exigirTara = true,
  exigirQtdPecas = true,
}) {
  const dataProdIso = normalizarDataIso(dataProducao)
  if (exigirDataProducao && !dataProdIso) {
    return { ok: false, erro: 'Informe a Data de Produção.' }
  }

  const validadeIso = normalizarDataIso(validade)
  if (exigirValidade && !validadeIso) {
    return { ok: false, erro: 'Informe a Data de Validade.' }
  }

  if (dataProdIso && validadeIso && validadeIso < dataProdIso) {
    return { ok: false, erro: 'A Data de Validade não pode ser anterior à Data de Produção.' }
  }

  const taraNum = parseNumero(taraKg)
  if (exigirTara && (!Number.isFinite(taraNum) || taraNum < 0)) {
    return { ok: false, erro: 'Selecione uma Tara válida.' }
  }
  const taraFinal = Number.isFinite(taraNum) ? Number(taraNum.toFixed(3)) : 0

  const brutoNum = parseNumero(pesoBruto)
  if (!Number.isFinite(brutoNum) || brutoNum <= 0) {
    return { ok: false, erro: 'Informe um Peso Bruto válido maior que zero.' }
  }
  const brutoFinal = Number(brutoNum.toFixed(3))

  const liquidoFinal = calcularPesoLiquido(brutoFinal, taraFinal)
  if (!Number.isFinite(liquidoFinal) || liquidoFinal <= 0) {
    return {
      ok: false,
      erro: `O Peso Bruto (${fmtKg3(brutoFinal)}) deve ser maior que a Tara selecionada (${fmtKg3(taraFinal)}).`,
    }
  }

  const pecasNum = parseNumero(qtdPecas)
  const pecasInt = Number.isFinite(pecasNum) ? Math.trunc(pecasNum) : NaN
  if (exigirQtdPecas && (!Number.isFinite(pecasNum) || pecasInt <= 0 || pecasInt !== pecasNum)) {
    return { ok: false, erro: 'Informe a Quantidade de Peças (número inteiro maior que zero).' }
  }
  const qtdPecasFinal = Number.isFinite(pecasInt) && pecasInt > 0 ? pecasInt : null

  const lote = gerarLotePorData(dataProdIso)

  return {
    ok: true,
    erro: null,
    data_producao: dataProdIso || null,
    validade: validadeIso || null,
    lote,
    tara_id: taraId ? Number(taraId) : null,
    tara_kg: taraFinal,
    peso_bruto_kg: brutoFinal,
    peso_liquido_kg: liquidoFinal,
    qtd_pecas: qtdPecasFinal,
  }
}

export function fmtDataBR(val) {
  if (!val) return '-'
  const s = String(val).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('pt-BR')
}

export function fmtDataHoraBR(val) {
  if (!val) return '-'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return String(val)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtKg(val, casas = 2, comUnidade = true) {
  const num = Number(val)
  if (!Number.isFinite(num)) return comUnidade ? '0,00 kg' : '0,00'
  const fmt = num.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
  return comUnidade ? `${fmt} kg` : fmt
}

export function fmtKg2(val, comUnidade = true) {
  return fmtKg(val, 2, comUnidade)
}

export function fmtKg3(val, comUnidade = true) {
  return fmtKg(val, 3, comUnidade)
}

/**
 * Gera EAN interno da empresa com 16 dígitos padrão CODE128 (Tricarnes):
 * 0025 + sequencial 6 dígitos (ex: 900001) + código produto 6 dígitos (zero-padded).
 */
export function montarEan16Interno(seqNum, codigoProduto = '') {
  const seq = String(Math.max(1, Number(seqNum) || 900001)).padStart(6, '0').slice(-6)
  const prod = String(codigoProduto || '000000').replace(/\D/g, '').padStart(6, '0').slice(-6)
  return `0025${seq}${prod}`
}
