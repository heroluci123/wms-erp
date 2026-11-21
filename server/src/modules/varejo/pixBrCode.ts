/**
 * Gerador oficial de payload BR Code PIX (Padrão EMV-QRCPS-MPM / Banco Central do Brasil)
 * com cálculo real de CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF).
 * Permite gerar QR Code PIX já com o VALOR EXATO da compra dentro do próprio PDV!
 */

function limparAscii(str: string, maxLen: number): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 \-./]/g, '')
    .trim()
    .slice(0, maxLen)
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0')
  return `${id}${len}${value}`
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff
      } else {
        crc = (crc << 1) & 0xffff
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function gerarPixBrCode(params: {
  chavePix: string
  nomeRecebedor: string
  cidadeRecebedor: string
  valor: number
  txid?: string
  descricao?: string
}): string {
  const chave = String(params.chavePix || '').trim()
  if (!chave) {
    throw new Error('Chave PIX não configurada na conta bancária da filial.')
  }
  const nome = limparAscii(params.nomeRecebedor || 'LOJA VAREJO', 25) || 'LOJA VAREJO'
  const cidade = limparAscii(params.cidadeRecebedor || 'SAO PAULO', 15) || 'SAO PAULO'
  const txid =
    String(params.txid || '***')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 25) || '***'
  const desc = limparAscii(params.descricao || '', 40)

  const maiContent =
    tlv('00', 'br.gov.bcb.pix') +
    tlv('01', chave) +
    (desc ? tlv('02', desc) : '')

  const valorNum = Number(params.valor || 0)
  const campo54 = valorNum > 0 ? tlv('54', valorNum.toFixed(2)) : ''
  const campo62 = tlv('62', tlv('05', txid))

  const semCrc =
    tlv('00', '01') + // Payload Format Indicator
    tlv('26', maiContent) + // Merchant Account Information (PIX)
    tlv('52', '0000') + // Merchant Category Code
    tlv('53', '986') + // Currency BRL
    campo54 +
    tlv('58', 'BR') + // Country Code
    tlv('59', nome) +
    tlv('60', cidade) +
    campo62 +
    '6304'

  const crc = crc16Ccitt(semCrc)
  return `${semCrc}${crc}`
}
