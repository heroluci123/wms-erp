/**
 * Feedback sonoro leve (Web Audio API) para leituras de código de barras.
 * Não depende de arquivos de áudio externos e falha silenciosamente em ambientes sem áudio/SSR.
 */
let _audioCtx = null

function getCtx() {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!_audioCtx) _audioCtx = new Ctx()
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {})
  }
  return _audioCtx
}

function playTone(freq, durationMs, type = 'sine', startOffsetSec = 0, volume = 0.14) {
  try {
    const ctx = getCtx()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    const start = ctx.currentTime + startOffsetSec
    const end = start + durationMs / 1000
    gain.gain.setValueAtTime(0.001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, end)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(end + 0.01)
  } catch {
    // Sem suporte de áudio
  }
}

export const feedbackSom = {
  /** Bipe agudo curto confirmando leitura válida */
  sucesso() {
    playTone(1046.5, 90, 'sine', 0, 0.14)
    playTone(1318.5, 120, 'sine', 0.085, 0.14)
  },
  /** Alerta sonoro moderado (FEFO / Confirmação / Duplicado) */
  alerta() {
    playTone(587.3, 120, 'triangle', 0, 0.16)
    playTone(587.3, 140, 'triangle', 0.15, 0.16)
  },
  /** Som grave de bloqueio / limite atingido / EAN inválido */
  erro() {
    playTone(240, 170, 'sawtooth', 0, 0.14)
    playTone(175, 240, 'sawtooth', 0.18, 0.15)
  },
}
