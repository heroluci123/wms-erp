import React from 'react'
import { ServerCrash, Info } from 'lucide-react'
import { isApiEnabled } from '../../lib/apiClient'

export function ApiModeRequiredBanner({ modulo = 'Este módulo ERP' }) {
  if (isApiEnabled()) return null
  return (
    <div
      className="card mb-20 flex items-center gap-12"
      style={{
        background: 'rgba(245, 158, 11, 0.10)',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        padding: '12px 16px',
      }}
    >
      <Info size={18} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      <div style={{ fontSize: 13 }}>
        <strong style={{ color: 'var(--warning)' }}>{modulo} — Modo Turso Somente-WMS Ativo:</strong>{' '}
        <span style={{ color: 'var(--text-secondary)' }}>
          Este cadastro pertence à nova camada ERP no Backend PostgreSQL. Para criar ou alterar registros aqui,
          conecte o frontend com <code>VITE_API_URL</code> apontando para o servidor <code>server/</code>.
        </span>
      </div>
    </div>
  )
}
