import React from 'react'
import { useAppStore } from '../../store/appStore'
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'

const icons = {
  success: <CheckCircle2 size={18} />,
  error:   <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info:    <Info size={18} />,
}

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore()

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          <span style={{ color: 'inherit', flexShrink: 0, marginTop: 1 }}>
            {icons[toast.type]}
          </span>
          <div className="toast__content">
            <div className="toast__title">{toast.title}</div>
            {toast.message && <div className="toast__msg">{toast.message}</div>}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
