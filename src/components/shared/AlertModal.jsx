import React, { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, X } from 'lucide-react'

/**
 * Modal genérico (Pode atuar como Aviso FEFO, Sucesso ou Confirmação)
 */
export function AlertModal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  type = 'warning', // 'warning', 'danger', 'success'
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  onConfirm
}) {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const icons = {
    warning: <AlertTriangle size={28} />,
    danger:  <XCircle size={28} />,
    success: <CheckCircle2 size={28} />
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal modal--${type}`} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-8">
          <div className="modal__icon">
            {icons[type]}
          </div>
          <button className="btn btn--ghost btn--icon" onClick={onClose} style={{ border: 'none' }}>
            <X size={20} />
          </button>
        </div>
        
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>
        
        <div className="modal__actions">
          {onClose && onConfirm && (
            <button className="btn btn--ghost" onClick={onClose}>
              {cancelText}
            </button>
          )}
          {onConfirm ? (
            <button className={`btn btn--${type === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm}>
              {confirmText}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={onClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
