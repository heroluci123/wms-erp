/**
 * Utilitários PWA para o App Motorista (iPhone / iOS Safari + Android Chrome):
 * - Compressão de fotos da câmera (12MP -> JPEG leve ~80-150KB)
 * - Captura segura de GPS sem travar a entrega
 * - Fila offline (localStorage) para sincronizar entregas quando o sinal voltar
 * - Histórico local de rotas recentes no dispositivo
 * - Deep links nativos para Waze, Google Maps, Apple Maps e WhatsApp
 */

const KEY_OFFLINE_QUEUE = 'wmsphere_motorista_offline_queue_v1'
const KEY_RECENT_ROUTES = 'wmsphere_motorista_rotas_recentes_v1'
const KEY_CACHE_PREFIX = 'wmsphere_motorista_cache_'

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '')
}

export function isStandalonePwa() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator?.standalone === true
  )
}

export function comprimirFotoImagem(file, maxDim = 1080, qualidade = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Nenhum arquivo selecionado.'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem da câmera.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Formato de imagem inválido.'))
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, width)
        canvas.height = Math.max(1, height)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', qualidade))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export function obterGpsAtual(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }
    let finalizado = false
    const done = (val) => {
      if (!finalizado) {
        finalizado = true
        resolve(val)
      }
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        done({
          lat: Number(pos.coords.latitude.toFixed(7)),
          lng: Number(pos.coords.longitude.toFixed(7)),
        })
      },
      () => {
        clearTimeout(timer)
        done(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

// ── LINKS DE NAVEGAÇÃO & CONTATO (iOS + ANDROID) ─────────────────────────────

export function gerarLinkWaze(endereco) {
  return `https://waze.com/ul?q=${encodeURIComponent(String(endereco || '').trim())}&navigate=yes`
}

export function gerarLinkMaps(endereco) {
  const q = encodeURIComponent(String(endereco || '').trim())
  if (isIosDevice()) {
    return `https://maps.apple.com/?daddr=${q}`
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}

export function gerarLinkGoogleMapsCoords(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
}

export function gerarLinkWhatsApp(telefone, texto = '') {
  const digits = String(telefone || '').replace(/\D/g, '')
  if (!digits) return ''
  const num = digits.length <= 11 ? `55${digits}` : digits
  const msg = texto ? `?text=${encodeURIComponent(texto)}` : ''
  return `https://wa.me/${num}${msg}`
}

// ── CACHE OFFLINE DA ROTA & FILA DE SINCRONIZAÇÃO ────────────────────────────

export function salvarCacheRota(qrToken, dados) {
  try {
    if (!qrToken || !dados) return
    localStorage.setItem(`${KEY_CACHE_PREFIX}${qrToken}`, JSON.stringify({ savedAt: Date.now(), dados }))
  } catch {
    /* quota cheia */
  }
}

export function lerCacheRota(qrToken) {
  try {
    const raw = localStorage.getItem(`${KEY_CACHE_PREFIX}${qrToken}`)
    if (!raw) return null
    return JSON.parse(raw)?.dados || null
  } catch {
    return null
  }
}

export function listarFilaOffline(qrToken = null) {
  try {
    const raw = localStorage.getItem(KEY_OFFLINE_QUEUE)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return qrToken ? arr.filter((x) => x.qrToken === qrToken) : arr
  } catch {
    return []
  }
}

export function enfileirarAcaoOffline(item) {
  try {
    const atual = listarFilaOffline()
    const novo = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...item,
    }
    const next = [...atual, novo]
    localStorage.setItem(KEY_OFFLINE_QUEUE, JSON.stringify(next))
    return novo
  } catch {
    return null
  }
}

export function removerAcaoOffline(id) {
  try {
    const atual = listarFilaOffline()
    localStorage.setItem(KEY_OFFLINE_QUEUE, JSON.stringify(atual.filter((x) => x.id !== id)))
  } catch {
    /* ignore */
  }
}

// ── HISTÓRICO DE ROTAS RECENTES NO DISPOSITIVO ───────────────────────────────

export function registrarRotaRecente(info) {
  try {
    if (!info?.qr_token) return
    const atual = listarRotasRecentes().filter((r) => r.qr_token !== info.qr_token)
    const next = [
      {
        qr_token: info.qr_token,
        codigo: info.codigo || 'ROTA',
        titulo: info.titulo || '',
        status: info.status || 'EM_ROTA',
        data_embarque: info.data_embarque || '',
        veiculo_placa: info.veiculo_placa || '',
        motorista_nome: info.motorista_nome || '',
        total_paradas: Number(info.total_paradas || 0),
        entregues: Number(info.entregues || 0),
        aberto_em: new Date().toISOString(),
      },
      ...atual,
    ].slice(0, 12)
    localStorage.setItem(KEY_RECENT_ROUTES, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function listarRotasRecentes() {
  try {
    const raw = localStorage.getItem(KEY_RECENT_ROUTES)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function extrairQrTokenDeEntrada(rawInput) {
  const s = String(rawInput || '').trim()
  if (!s) return ''
  const match = s.match(/motorista\/([a-zA-Z0-9_-]+)/i)
  if (match?.[1]) return match[1]
  if (/^https?:\/\//i.test(s)) return ''
  return s
}

export function resolverUrlRotaOutroAmbiente(rawInput) {
  const s = String(rawInput || '').trim()
  if (!/^https?:\/\//i.test(s) || !/motorista\/[a-zA-Z0-9_-]+/i.test(s)) return ''
  try {
    const parsed = new URL(s)
    const h = parsed.hostname || ''
    const hostPermitido =
      h === 'localhost' ||
      h === '127.0.0.1' ||
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
      /\.vercel\.app$/i.test(h) ||
      h === window.location.hostname
    if (hostPermitido && parsed.origin !== window.location.origin) {
      return parsed.href
    }
  } catch {
    return ''
  }
  return ''
}
