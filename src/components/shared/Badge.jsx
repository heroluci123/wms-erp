import React from 'react'

/** Badge de Curva ABC */
export function CurvaBadge({ curva }) {
  if (!curva) return null
  return (
    <span className={`badge badge--curva-${curva.toLowerCase()}`}>
      Curva {curva}
    </span>
  )
}

/** Badge de endereço especial */
export function EnderecoBadge({ endereco }) {
  if (endereco === 'REC') {
    return <span className="badge badge--rec">⚠ REC</span>
  }
  if (endereco === 'EXPEDICAO' || endereco === 'SAIDA') {
    return <span className="badge badge--expedicao">📦 {endereco}</span>
  }
  return <span className="td-mono">{endereco}</span>
}

/** Status de inventário */
export function InventarioStatusBadge({ status }) {
  const map = {
    'Aberto':            { cls: 'aberto',     label: 'Aberto' },
    'Em Contagem':       { cls: 'contagem',   label: 'Em Contagem' },
    'Aguardando Ajuste': { cls: 'divergente', label: 'Aguardando Ajuste' },
    'Finalizado OK':     { cls: 'finalizado', label: 'Finalizado OK' },
    'Cancelado':         { cls: 'cancelado',  label: 'Cancelado' }
  }
  const { cls, label } = map[status] || { cls: 'aberto', label: status }
  return (
    <span className="status-badge">
      <span className={`status-dot status-dot--${cls}`} />
      {label}
    </span>
  )
}

/** Badge genérico */
export function StatusItemBadge({ status }) {
  const map = {
    'Pendente':          'badge--warning',
    '2ª Contagem':       'badge--warning',
    '3ª Contagem':       'badge--warning',
    'OK':                'badge--success',
    'Aguardando Ajuste': 'badge--danger',
  }
  return <span className={`badge ${map[status] || ''}`}>{status}</span>
}
