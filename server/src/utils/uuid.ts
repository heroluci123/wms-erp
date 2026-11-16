import crypto from 'node:crypto'

/**
 * Gera UUIDv7 (RFC 9562) ordenavel por timestamp (48 bits de ms + 12 bits rand_a + 62 bits rand_b).
 * Ideal para PKs em sistemas distribuidos / offline-first sem colisoes entre dispositivos.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  const ts = BigInt(Date.now())
  bytes[0] = Number((ts >> 40n) & 0xffn)
  bytes[1] = Number((ts >> 32n) & 0xffn)
  bytes[2] = Number((ts >> 24n) & 0xffn)
  bytes[3] = Number((ts >> 16n) & 0xffn)
  bytes[4] = Number((ts >> 8n) & 0xffn)
  bytes[5] = Number(ts & 0xffn)

  // Version 7 (0b0111)
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  // Variant RFC 4122 (0b10xx)
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
