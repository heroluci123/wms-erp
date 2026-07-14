import React from 'react'
import { AlertTriangle, CheckCircle, XCircle, X, Info } from 'lucide-react'

/**
 * Modal de Confirmação / Alerta reutilizável.
 * 
 * Props:
 *  - isOpen: boolean
 *  - type: 'confirm' | 'alert' | 'success' | 'error'
 *  - title: string
 *  - message: string
 *  - onConfirm: () => void   (só para type='confirm')
 *  - onClose: () => void
 *  - confirmLabel?: string   (padrão: 'Confirmar')
 *  - cancelLabel?: string    (padrão: 'Cancelar')
 */
export function ModalDialog({ isOpen, type = 'alert', title, message, onConfirm, onClose, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }) {
  if (!isOpen) return null

  const icons = {
    confirm: <AlertTriangle size={28} style={{ color: 'var(--warning)' }} />,
    alert:   <Info size={28} style={{ color: 'var(--primary)' }} />,
    success: <CheckCircle size={28} style={{ color: 'var(--success)' }} />,
    error:   <XCircle size={28} style={{ color: 'var(--danger)' }} />,
  }

  const confirmBtnClass = {
    confirm: 'btn btn--warning',
    alert:   'btn btn--primary',
    success: 'btn btn--success',
    error:   'btn btn--danger',
  }

  return (
    <div
      className="flex items-center justify-center p-24 fade-in"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.7)'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="card border border-border rounded-lg shadow-2xl w-full max-w-[480px]"
        style={{ backgroundColor: 'var(--bg)', padding: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-20 border-b border-border">
          <div className="flex items-center gap-12">
            {icons[type]}
            <h3 className="text-base font-bold">{title}</h3>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-24">
          <p className="text-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {message}
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-12 p-16 border-t border-border" style={{ backgroundColor: 'var(--bg-1)', borderRadius: '0 0 8px 8px' }}>
          {type === 'confirm' ? (
            <>
              <button className="btn btn--ghost" onClick={onClose}>{cancelLabel}</button>
              <button className={confirmBtnClass[type]} onClick={() => { onConfirm(); onClose() }}>
                {confirmLabel}
              </button>
            </>
          ) : (
            <button className={confirmBtnClass[type]} onClick={onClose}>OK</button>
          )}
        </div>
      </div>
    </div>
  )
}
