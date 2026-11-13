/**
 * Utilitários criptográficos compatíveis com Browser (Web Crypto API) e Node/Electron.
 * Senhas nunca são armazenadas em texto puro: formato PBKDF2-SHA256 com salt aleatório.
 */

const ITERATIONS = 100000
const HASH_LEN_BITS = 256

function getCrypto() {
  const c = globalThis.crypto
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API indisponível neste ambiente.')
  }
  return c
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim()
  if (clean.length % 2 !== 0) return new Uint8Array(0)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function timingSafeEqualStr(a, b) {
  const s1 = String(a || '')
  const s2 = String(b || '')
  if (s1.length !== s2.length) return false
  let diff = 0
  for (let i = 0; i < s1.length; i++) {
    diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i)
  }
  return diff === 0
}

async function derivePbkdf2Hex(password, saltBytes, iterations = ITERATIONS) {
  const c = getCrypto()
  const enc = new TextEncoder()
  const keyMaterial = await c.subtle.importKey(
    'raw',
    enc.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const derivedBits = await c.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LEN_BITS
  )
  return bytesToHex(new Uint8Array(derivedBits))
}

/**
 * Gera hash seguro com salt aleatório: pbkdf2$sha256$<iter>$<saltHex>$<hashHex>
 */
export async function hashSenha(senhaPlain) {
  const clean = String(senhaPlain ?? '')
  if (!clean) throw new Error('A senha não pode estar vazia.')
  const c = getCrypto()
  const saltBytes = new Uint8Array(16)
  c.getRandomValues(saltBytes)
  const saltHex = bytesToHex(saltBytes)
  const hashHex = await derivePbkdf2Hex(clean, saltBytes, ITERATIONS)
  return `pbkdf2$sha256$${ITERATIONS}$${saltHex}$${hashHex}`
}

/**
 * Verifica uma senha informada contra o hash armazenado.
 */
export async function verificarSenha(senhaInformada, storedHash) {
  const candidate = String(senhaInformada ?? '')
  const stored = String(storedHash ?? '').trim()
  if (!candidate || !stored) return false

  if (stored.startsWith('pbkdf2$sha256$')) {
    const parts = stored.split('$')
    if (parts.length !== 5) return false
    const iter = Number(parts[2]) || ITERATIONS
    const saltBytes = hexToBytes(parts[3])
    const expectedHex = parts[4]
    if (!saltBytes.length || !expectedHex) return false
    const computedHex = await derivePbkdf2Hex(candidate, saltBytes, iter)
    return timingSafeEqualStr(computedHex, expectedHex)
  }

  return false
}

/**
 * Gera uma senha inicial legível e forte para novos usuários.
 */
export function gerarSenhaInicial(tamanho = 8) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '@#$%'
  const all = upper + lower + digits
  const c = getCrypto()
  const buf = new Uint32Array(Math.max(tamanho, 8))
  c.getRandomValues(buf)

  const chars = [
    upper[buf[0] % upper.length],
    lower[buf[1] % lower.length],
    digits[buf[2] % digits.length],
    symbols[buf[3] % symbols.length],
  ]
  for (let i = 4; i < buf.length; i++) {
    chars.push(all[buf[i] % all.length])
  }
  // Embaralhar posições de forma determinística com os bytes aleatórios
  for (let i = chars.length - 1; i > 0; i--) {
    const j = buf[i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/**
 * Gera token aleatório criptográfico para controle de sessão no banco.
 */
export function gerarTokenSessao() {
  const c = getCrypto()
  const bytes = new Uint8Array(24)
  c.getRandomValues(bytes)
  return `wms_${bytesToHex(bytes)}`
}
