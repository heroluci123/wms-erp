/**
 * Utilitários de formatação e validação de CNPJ para os formulários de cadastro.
 */

export function limparCnpj(valor) {
  return String(valor ?? '').replace(/\D+/g, '').slice(0, 14)
}

export function formatarCnpjInput(valor) {
  const d = String(valor ?? '').replace(/\D+/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export function validarCnpj(valor) {
  const cnpj = limparCnpj(valor)
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const calc = (base, pesos) => {
    let soma = 0
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * pesos[i]
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const d1 = calc(cnpj.slice(0, 12), p1)
  const d2 = calc(cnpj.slice(0, 12) + String(d1), p2)
  return Number(cnpj[12]) === d1 && Number(cnpj[13]) === d2
}
