import React, { useEffect, useState } from 'react'
import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react'
import { isIosDevice, isStandalonePwa } from '../../utils/motoristaPwa'

/**
 * Banner inteligente de instalação PWA:
 * - No iPhone (iOS Safari): ensina os 2 toques ("Compartilhar" -> "Adicionar à Tela de Início")
 *   para transformar o site em aplicativo de tela cheia SEM precisar de App Store!
 * - No Android / Chrome: oferece instalação nativa em 1 toque (beforeinstallprompt).
 * - Se já estiver aberto como aplicativo instalado (standalone), oculta automaticamente.
 */
export function PwaInstallBanner() {
  const [standalone, setStandalone] = useState(() => isStandalonePwa())
  const [ios] = useState(() => isIosDevice())
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [mostrarGuiaIos, setMostrarGuiaIos] = useState(false)
  const [dispensado, setDispensado] = useState(() => {
    try {
      return sessionStorage.getItem('wms_pwa_banner_closed') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const check = () => setStandalone(isStandalonePwa())
    mq?.addEventListener?.('change', check)

    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => {
      mq?.removeEventListener?.('change', check)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    }
  }, [])

  if (standalone || dispensado) return null
  if (!ios && !deferredPrompt) return null

  const fechar = () => {
    setDispensado(true)
    try {
      sessionStorage.setItem('wms_pwa_banner_closed', '1')
    } catch {
      /* ignore */
    }
  }

  const handleInstalarAndroid = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    try {
      await deferredPrompt.userChoice
    } catch {
      /* ignore */
    }
    setDeferredPrompt(null)
  }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(6,182,212,0.12))',
        border: '1px solid rgba(56,189,248,0.42)',
        borderRadius: 12,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: 'rgba(56,189,248,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Smartphone size={18} color="#38bdf8" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#f8fafc' }}>
              {ios ? 'Instalar no iPhone (sem App Store)' : 'Instalar App Motorista'}
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1' }}>
              {ios
                ? 'Abre em tela cheia com ícone na tela inicial do iPhone'
                : 'Acesso rápido direto da tela inicial e suporte offline'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {ios ? (
            <button
              type="button"
              onClick={() => setMostrarGuiaIos((v) => !v)}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {mostrarGuiaIos ? 'Ocultar' : 'Como instalar'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleInstalarAndroid}
              style={{
                background: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Download size={13} /> Instalar
            </button>
          )}
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar aviso"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {ios && mostrarGuiaIos && (
        <div
          style={{
            background: 'rgba(11,17,32,0.75)',
            borderRadius: 9,
            padding: '10px 12px',
            fontSize: 12,
            color: '#e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#1e293b', padding: '3px 7px', borderRadius: 6, fontWeight: 800, color: '#38bdf8' }}>1</span>
            <span>
              Abra este link no <strong>Safari</strong> e toque no botão{' '}
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#38bdf8' }}>
                <Share size={13} /> Compartilhar
              </strong>{' '}
              na barra inferior do iPhone.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#1e293b', padding: '3px 7px', borderRadius: 6, fontWeight: 800, color: '#38bdf8' }}>2</span>
            <span>
              Role para baixo e toque em{' '}
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#4ade80' }}>
                <PlusSquare size={13} /> Adicionar à Tela de Início
              </strong>{' '}
              → <strong>Adicionar</strong>. Pronto, virou app!
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
