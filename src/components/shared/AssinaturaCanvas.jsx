import React, { useEffect, useRef, useState } from 'react'
import { Eraser, PenTool } from 'lucide-react'

/**
 * Pad de Assinatura Digital otimizado para toque no iPhone (Safari iOS), Android e Mouse.
 * Usa Pointer Events + touch-action: none para nunca rolar a tela enquanto o cliente assina.
 */
export function AssinaturaCanvas({ value, onChange, height = 165 }) {
  const canvasRef = useRef(null)
  const desenhandoRef = useRef(false)
  const ultimoPontoRef = useRef(null)
  const [temTraco, setTemTraco] = useState(Boolean(value))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(260, Math.round(rect.width * dpr))
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, height)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (value) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, height)
      }
      img.src = value
      setTemTraco(true)
    }
  }, [height]) // inicializa uma vez no mount

  const obterPonto = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const iniciar = (e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    desenhandoRef.current = true
    const pt = obterPonto(e)
    ultimoPontoRef.current = pt
    const ctx = canvas.getContext('2d')
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, 1.3, 0, Math.PI * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fill()
    setTemTraco(true)
  }

  const mover = (e) => {
    if (!desenhandoRef.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pt = obterPonto(e)
    const ant = ultimoPontoRef.current || pt
    ctx.beginPath()
    ctx.moveTo(ant.x, ant.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    ultimoPontoRef.current = pt
  }

  const finalizar = () => {
    if (!desenhandoRef.current) return
    desenhandoRef.current = false
    ultimoPontoRef.current = null
    const canvas = canvasRef.current
    if (canvas && onChange) {
      onChange(canvas.toDataURL('image/png'))
    }
  }

  const limpar = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, height)
    setTemTraco(false)
    if (onChange) onChange('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
          <PenTool size={13} color="#38bdf8" /> ASSINATURA DO RECEBEDOR (DEDO NA TELA)
        </span>
        <button
          type="button"
          onClick={limpar}
          style={{
            background: 'rgba(148,163,184,0.14)',
            border: '1px solid #334155',
            color: '#cbd5e1',
            borderRadius: 7,
            padding: '4px 10px',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Eraser size={12} /> Limpar
        </button>
      </div>

      <div
        style={{
          position: 'relative',
          borderRadius: 10,
          overflow: 'hidden',
          border: `2px solid ${temTraco ? '#22c55e' : '#334155'}`,
          background: '#ffffff',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height,
            display: 'block',
            touchAction: 'none',
            cursor: 'crosshair',
          }}
          onPointerDown={iniciar}
          onPointerMove={mover}
          onPointerUp={finalizar}
          onPointerLeave={finalizar}
          onPointerCancel={finalizar}
        />
        {!temTraco && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Peça ao cliente para assinar aqui
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 22,
            borderBottom: '1px dashed #cbd5e1',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}
