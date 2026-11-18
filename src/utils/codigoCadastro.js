import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'

/**
 * Calcula o próximo código sequencial numérico a partir da lista já carregada em memória.
 */
export function sugerirProximoCodigoLocal(lista = []) {
  let maxNum = 0
  for (const item of lista || []) {
    const raw = String(item?.codigo ?? '').trim()
    if (/^\d{1,12}$/.test(raw)) {
      const n = Number(raw)
      if (Number.isSafeInteger(n) && n > maxNum) {
        maxNum = n
      }
    }
  }
  return String(maxNum + 1)
}

/**
 * Busca no backend o próximo código disponível (considerando inclusive registros inativos)
 * com fallback local imediato caso offline ou antes da resposta.
 */
export async function obterProximoCodigoDisponivel(tipo, listaFallback = []) {
  const local = sugerirProximoCodigoLocal(listaFallback)
  if (!isApiEnabled()) return local
  try {
    const cod = await cadastrosQueries.obterProximoCodigo(tipo)
    return cod || local
  } catch {
    return local
  }
}

/**
 * Verifica duplicidade de código no catálogo carregado em tela antes do envio,
 * retornando o registro conflitante (se encontrado) para feedback imediato.
 */
export function encontrarCodigoDuplicadoLocal(lista = [], codigoInformado, excludeId = null) {
  const cod = String(codigoInformado ?? '').trim().toLowerCase()
  if (!cod) return null
  return (
    (lista || []).find(
      (item) =>
        String(item?.id || '') !== String(excludeId || '') &&
        String(item?.codigo ?? '').trim().toLowerCase() === cod,
    ) || null
  )
}
