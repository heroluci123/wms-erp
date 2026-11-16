import React, { useEffect } from 'react'
import { AlertTriangle, CheckCircle, XCircle, X, Info } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

/**
 * Modal de Confirmação / Alerta reutilizável (centralizado e estilizado pelo tema do sistema).
 */
export function ModalDialog({
  isOpen,
  type = 'alert',
  title,
  message,
  onConfirm,
  onClose,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  autoClose = true,
}) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const iconStyles = {
    confirm: { bg: 'var(--warning-muted)', border: 'rgba(245, 158, 11, 0.35)', icon: <AlertTriangle size={22} style={{ color: 'var(--warning)' }} /> },
    alert:   { bg: 'var(--accent-muted)',  border: 'rgba(59, 130, 246, 0.35)', icon: <Info size={22} style={{ color: 'var(--accent-hover)' }} /> },
    success: { bg: 'var(--success-muted)', border: 'rgba(34, 197, 94, 0.35)',  icon: <CheckCircle size={22} style={{ color: 'var(--success)' }} /> },
    error:   { bg: 'var(--danger-muted)',  border: 'rgba(239, 68, 68, 0.35)',  icon: <XCircle size={22} style={{ color: 'var(--danger)' }} /> },
  }

  const confirmBtnClass = {
    confirm: 'btn btn--warning',
    alert:   'btn btn--primary',
    success: 'btn btn--success',
    error:   'btn btn--danger',
  }

  const iconCfg = iconStyles[type] || iconStyles.confirm
  const btnCls = confirmBtnClass[type] || 'btn btn--warning'
  const isConfirmMode = type === 'confirm' || typeof onConfirm === 'function'

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 9999, padding: 20, backdropFilter: 'blur(6px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="card"
        style={{
          width: '92vw',
          maxWidth: 480,
          background: 'var(--bg-2)',
          border: '1px solid var(--border-light)',
          borderRadius: 'var(--radius-lg)',
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.72)',
          animation: 'slideUp 0.18s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: iconCfg.bg,
                border: `1px solid ${iconCfg.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {iconCfg.icon}
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px 20px' }}>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, whiteSpace: 'pre-line' }}>
            {message}
          </p>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-1)',
          }}
        >
          {isConfirmMode ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                {cancelLabel}
              </button>
              <button
                type="button"
                className={btnCls}
                autoFocus
                onClick={() => {
                  onConfirm?.()
                  if (autoClose) onClose?.()
                }}
              >
                {confirmLabel}
              </button>
            </>
          ) : (
            <button type="button" className={btnCls} autoFocus onClick={onClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function GlobalConfirmDialog() {
  const confirmState = useAppStore((s) => s.confirmState)
  const responderConfirmacao = useAppStore((s) => s.responderConfirmacao)

  if (!confirmState) return null

  return (
    <ModalDialog
      isOpen={true}
      type={confirmState.type}
      title={confirmState.title}
      message={confirmState.message}
      confirmLabel={confirmState.confirmLabel}
      cancelLabel={confirmState.cancelLabel}
      autoClose={false}
      onConfirm={() => responderConfirmacao(true)}
      onClose={() => responderConfirmacao(false)}
    />
  )
}
