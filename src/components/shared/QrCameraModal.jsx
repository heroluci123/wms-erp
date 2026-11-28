import React, { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, Image as ImageIcon, Loader2, QrCode, RefreshCw, X } from 'lucide-react'

function decodeImageElement(img, maxDim = 1400) {
  let { width, height } = img
  if (!width || !height) return null
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  })
  return code?.data || null
}

function decodeQrFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Formato de imagem não suportado.'))
      img.onload = () => {
        // Tenta em duas escalas (1400px e 900px) para maximizar leitura de fotos 12MP do iPhone
        const found = decodeImageElement(img, 1400) || decodeImageElement(img, 900)
        resolve(found)
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export function QrCameraModal({ open, onClose, onDetected, titulo = 'Ler QR Code da Rota' }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const fileInputRef = useRef(null)
  const galleryInputRef = useRef(null)
  const detectedRef = useRef(false)

  const [cameraState, setCameraState] = useState('IDLE') // IDLE | STARTING | LIVE | FALLBACK | ERROR
  const [erro, setErro] = useState('')
  const [lendoFoto, setLendoFoto] = useState(false)

  const pararCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop()
        } catch {
          /* ignore */
        }
      })
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const dispararLeitura = useCallback(
    (texto) => {
      if (!texto || detectedRef.current) return
      detectedRef.current = true
      pararCamera()
      try {
        navigator.vibrate?.(80)
      } catch {
        /* ignore */
      }
      onDetected?.(texto)
    },
    [onDetected, pararCamera],
  )

  const iniciarCamera = useCallback(async () => {
    pararCamera()
    detectedRef.current = false
    setErro('')

    const isSecure = typeof window !== 'undefined' && window.isSecureContext
    const hasGetUserMedia = Boolean(navigator?.mediaDevices?.getUserMedia)

    if (!isSecure || !hasGetUserMedia) {
      setCameraState('FALLBACK')
      return
    }

    setCameraState('STARTING')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        pararCamera()
        return
      }
      video.srcObject = stream
      await video.play()
      setCameraState('LIVE')

      let lastTick = 0
      const scanFrame = (now) => {
        if (detectedRef.current || !streamRef.current) return
        if (now - lastTick >= 140 && video.readyState >= 2 && video.videoWidth > 0) {
          lastTick = now
          const canvas = canvasRef.current
          if (canvas) {
            const targetW = Math.min(video.videoWidth, 720)
            const targetH = Math.round((video.videoHeight * targetW) / video.videoWidth)
            if (canvas.width !== targetW || canvas.height !== targetH) {
              canvas.width = targetW
              canvas.height = targetH
            }
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            ctx.drawImage(video, 0, 0, targetW, targetH)
            const imgData = ctx.getImageData(0, 0, targetW, targetH)
            const code = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            })
            if (code?.data) {
              dispararLeitura(code.data)
              return
            }
          }
        }
        rafRef.current = requestAnimationFrame(scanFrame)
      }
      rafRef.current = requestAnimationFrame(scanFrame)
    } catch (err) {
      pararCamera()
      setCameraState('ERROR')
      if (err?.name === 'NotAllowedError') {
        setErro('Permissão da câmera negada no navegador. Você pode liberar nos ajustes ou usar "Fotografar QR Code" abaixo.')
      } else {
        setErro('Não foi possível abrir a câmera ao vivo neste aparelho. Use o botão "Fotografar QR Code" abaixo.')
      }
    }
  }, [dispararLeitura, pararCamera])

  useEffect(() => {
    if (open) {
      iniciarCamera()
    } else {
      pararCamera()
      setCameraState('IDLE')
      setErro('')
    }
    return () => pararCamera()
  }, [open, iniciarCamera, pararCamera])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErro('')
    setLendoFoto(true)
    try {
      const decoded = await decodeQrFromFile(file)
      if (decoded) {
        dispararLeitura(decoded)
      } else {
        setErro('Nenhum QR Code encontrado nessa foto. Chegue mais perto do código, garanta boa iluminação e tente novamente.')
      }
    } catch (err) {
      setErro(err.message || 'Erro ao ler imagem do QR Code.')
    } finally {
      setLendoFoto(false)
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(2, 6, 23, 0.92)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        paddingLeft: 14,
        paddingRight: 14,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)',
          color: '#f8fafc',
        }}
      >
        {/* TOPO */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '1px solid #1e293b',
            background: '#111c33',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15 }}>
            <QrCode size={18} color="#38bdf8" />
            <span>{titulo}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              pararCamera()
              onClose?.()
            }}
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 10,
              color: '#e2e8f0',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Fechar câmera"
          >
            <X size={18} />
          </button>
        </div>

        {/* ÁREA DA CÂMERA */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(cameraState === 'STARTING' || cameraState === 'LIVE') && (
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1',
                maxHeight: 340,
                background: '#020617',
                borderRadius: 14,
                overflow: 'hidden',
                border: '1px solid #1e293b',
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {/* Mira central */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    width: '68%',
                    height: '68%',
                    borderRadius: 16,
                    border: '2.5px solid rgba(56, 189, 248, 0.9)',
                    boxShadow: '0 0 0 999px rgba(2, 6, 23, 0.48)',
                  }}
                />
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: 10,
                  left: 10,
                  right: 10,
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#e0f2fe',
                  background: 'rgba(15, 23, 42, 0.82)',
                  padding: '6px 10px',
                  borderRadius: 99,
                }}
              >
                {cameraState === 'STARTING'
                  ? 'Abrindo câmera traseira...'
                  : 'Aponte a câmera para o QR Code impresso no romaneio'}
              </div>
            </div>
          )}

          {(cameraState === 'FALLBACK' || cameraState === 'ERROR') && (
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.28)',
                borderRadius: 12,
                padding: 14,
                fontSize: 12.5,
                color: '#cbd5e1',
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 800, color: '#7dd3fc', marginBottom: 4 }}>
                {cameraState === 'FALLBACK'
                  ? 'Leitura rápida via câmera do celular'
                  : 'Câmera ao vivo indisponível'}
              </div>
              {cameraState === 'FALLBACK' ? (
                <span>
                  Em links locais de teste (HTTP), o Safari do iPhone libera a câmera ao vivo apenas em HTTPS (como no
                  site oficial). Aqui você pode tocar em <strong>Fotografar QR Code</strong> abaixo para abrir a câmera
                  do iPhone na hora!
                </span>
              ) : (
                <span>{erro}</span>
              )}
            </div>
          )}

          {erro && cameraState !== 'ERROR' && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.14)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 12.5,
                color: '#fecaca',
              }}
            >
              {erro}
            </div>
          )}

          {/* BOTÕES DE CAPTURA NATIVA / GALERIA (FUNCIONA EM IPHONE HTTP E HTTPS) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              disabled={lendoFoto}
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%',
                height: 48,
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #2563eb, #06b6d4)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              {lendoFoto ? <Loader2 size={18} className="spin" /> : <Camera size={18} />}
              {lendoFoto ? 'Lendo QR Code...' : 'Fotografar QR Code (Câmera do Celular)'}
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={lendoFoto}
                onClick={() => galleryInputRef.current?.click()}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  fontWeight: 700,
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <ImageIcon size={15} /> Escolher Print / Foto
              </button>

              {cameraState === 'ERROR' && (
                <button
                  type="button"
                  onClick={iniciarCamera}
                  style={{
                    height: 40,
                    padding: '0 14px',
                    borderRadius: 10,
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#7dd3fc',
                    fontWeight: 700,
                    fontSize: 12.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={14} /> Tentar Câmera
                </button>
              )}
            </div>
          </div>

          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}
