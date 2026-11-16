import crypto from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2Async = promisify(crypto.pbkdf2)

const ITERATIONS = 100_000
const HASH_LEN_BYTES = 32

/**
 * Gera hash seguro PBKDF2-SHA256 compativel 1:1 com o formato ja salvo no Turso (`authCrypto.js`).
 */
export async function hashSenha(senhaPlain: string): Promise<string> {
  const clean = String(senhaPlain ?? '')
  if (!clean) throw new Error('A senha nao pode estar vazia.')

  const saltBytes = crypto.randomBytes(16)
  const saltHex = saltBytes.toString('hex')
  const derived = await pbkdf2Async(clean, saltBytes, ITERATIONS, HASH_LEN_BYTES, 'sha256')
  return `pbkdf2$sha256$${ITERATIONS}$${saltHex}$${derived.toString('hex')}`
}

/**
 * Valida senha informada contra hash armazenado com comparacao em tempo constante.
 */
export async function verificarSenha(senhaInformada: string, storedHash: string | null | undefined): Promise<boolean> {
  const candidate = String(senhaInformada ?? '')
  const stored = String(storedHash ?? '').trim()
  if (!candidate || !stored) return false

  if (!stored.startsWith('pbkdf2$sha256$')) {
    return false
  }

  const parts = stored.split('$')
  if (parts.length !== 5) return false

  const iter = Number(parts[2]) || ITERATIONS
  const saltHex = parts[3]
  const expectedHex = parts[4]
  if (!saltHex || saltHex.length % 2 !== 0 || !expectedHex) return false

  const saltBytes = Buffer.from(saltHex, 'hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  if (!saltBytes.length || expectedBuf.length !== HASH_LEN_BYTES) return false

  const computedBuf = await pbkdf2Async(candidate, saltBytes, iter, HASH_LEN_BYTES, 'sha256')
  return crypto.timingSafeEqual(computedBuf, expectedBuf)
}

export function gerarTokenSessao(): string {
  return `wms_${crypto.randomBytes(24).toString('hex')}`
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

export function gerarSenhaInicial(tamanho = 8): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '@#$%'
  const all = upper + lower + digits
  const len = Math.max(tamanho, 8)
  const chars: string[] = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ]
  for (let i = 4; i < len; i++) {
    chars.push(all[crypto.randomInt(all.length)])
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
