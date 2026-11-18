/**
 * Leitura de balança industrial via Web Serial API (Toledo, Filizola, Urano e genéricas ASCII).
 * Funciona nativamente no Chrome / Edge e no Electron Windows via porta USB-Serial / COM.
 */

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.serial !== 'undefined'
}

export function parsePesoBalancaFrame(rawText) {
  const s = String(rawText || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim()
  if (!s) return null

  // Padrão decimal explícito (ex: "ST,GS,+  18.450kg", "PESO: 18,45", "18.450")
  const decMatch = s.match(/([0-9]{1,5}[.,][0-9]{1,3})/)
  if (decMatch) {
    const val = Number(decMatch[1].replace(',', '.'))
    if (Number.isFinite(val) && val >= 0 && val <= 9999) {
      return Number(val.toFixed(3))
    }
  }

  // Padrão 5 ou 6 dígitos inteiros sem separador (ex: Filizola/Toledo Prt2 "018450" = 18.450 kg ou "01845" = 18.45 kg)
  const int6Match = s.match(/\b(\d{6})\b/)
  if (int6Match) {
    const val = Number(int6Match[1]) / 1000
    if (Number.isFinite(val) && val >= 0 && val <= 999) return Number(val.toFixed(3))
  }

  const int5Match = s.match(/\b(\d{5})\b/)
  if (int5Match) {
    const val = Number(int5Match[1]) / 100
    if (Number.isFinite(val) && val >= 0 && val <= 999) return Number(val.toFixed(3))
  }

  return null
}

export async function conectarBalancaSerial({
  baudRate = 9600,
  dataBits = 8,
  leiturasEstaveis = 3,
  onPeso,
  onStatus,
  onError,
} = {}) {
  if (!isWebSerialSupported()) {
    throw new Error(
      'Este navegador não suporta leitura serial USB (Web Serial). Utilize Google Chrome, Microsoft Edge ou o aplicativo Desktop.',
    )
  }

  const port = await navigator.serial.requestPort()
  await port.open({
    baudRate: Number(baudRate) || 9600,
    dataBits: Number(dataBits) || 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
  })

  onStatus?.('CONECTADA')
  let ativo = true
  let reader = null
  const decoder = new TextDecoder()
  let buffer = ''
  const ultimasLeituras = []

  const loopLeitura = async () => {
    try {
      while (ativo && port.readable) {
        reader = port.readable.getReader()
        try {
          while (ativo) {
            const { value, done } = await reader.read()
            if (done) break
            if (!value) continue
            buffer += decoder.decode(value, { stream: true })
            const partes = buffer.split(/[\r\n\x03]+/)
            buffer = partes.pop() || ''
            for (const frame of partes) {
              const kg = parsePesoBalancaFrame(frame)
              if (kg === null || kg <= 0) continue
              ultimasLeituras.push(kg)
              if (ultimasLeituras.length > Math.max(2, Number(leiturasEstaveis) || 3)) {
                ultimasLeituras.shift()
              }
              const estavel =
                ultimasLeituras.length >= Math.max(2, Number(leiturasEstaveis) || 3) &&
                ultimasLeituras.every((v) => Math.abs(v - kg) <= 0.005)
              onPeso?.(kg, { estavel, brutoFrame: frame })
            }
          }
        } finally {
          try {
            reader?.releaseLock()
          } catch {
            /* ignore */
          }
          reader = null
        }
      }
    } catch (err) {
      if (ativo) onError?.(err)
    }
  }

  loopLeitura()

  return {
    port,
    async disconnect() {
      ativo = false
      try {
        await reader?.cancel()
      } catch {
        /* ignore */
      }
      try {
        await port.close()
      } catch {
        /* ignore */
      }
      onStatus?.('DESCONECTADA')
    },
  }
}
