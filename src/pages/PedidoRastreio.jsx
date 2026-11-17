import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Truck, CheckCircle2, Package, AlertTriangle } from 'lucide-react'
import { roteirizacaoQueries } from '../queries/roteirizacao'

const STATUS_MAP = {
  AGUARDANDO_ROTA: { label: 'Em preparação / Aguardando roteiro', cor: '#94a3b8' },
  PENDENTE: { label: 'Roteirizado para embarque', cor: '#38bdf8' },
  A_CAMINHO: { label: 'Saiu para entrega (Em rota)', cor: '#f59e0b' },
  NO_CLIENTE: { label: 'Veículo no local de entrega', cor: '#a78bfa' },
  ENTREGUE: { label: 'Pedido Entregue ✅', cor: '#22c55e' },
  DEVOLVIDA: { label: 'Entrega não realizada / Retornou', cor: '#ef4444' },
}

export function PedidoRastreio() {
  const { rastreioToken } = useParams()
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ativo = true
    roteirizacaoQueries
      .obterPedidoPublico(rastreioToken)
      .then((res) => {
        if (ativo) setDados(res?.pedido || null)
      })
      .catch((err) => {
        if (ativo) setErro(err.message || 'Rastreamento indisponível.')
      })
      .finally(() => {
        if (ativo) setLoading(false)
      })
    return () => {
      ativo = false
    }
  }, [rastreioToken])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', padding: 32, textAlign: 'center' }}>
        Consultando status da entrega...
      </div>
    )
  }

  const st = STATUS_MAP[dados?.status_entrega] || { label: dados?.status_entrega || '-', cor: '#38bdf8' }

  return (
    <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', padding: 20 }}>
      <div style={{ maxWidth: 500, margin: '24px auto', background: '#111c33', border: '1px solid #1e293b', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Truck size={26} style={{ color: '#38bdf8' }} />
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>TRICARNES ALIMENTOS • RASTREIO DE PEDIDO</div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{dados ? `${dados.codigo} — ${dados.cliente}` : 'Rastreio'}</h2>
          </div>
        </div>

        {erro ? (
          <div style={{ color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} /> {erro}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ padding: 12, borderRadius: 10, background: 'rgba(56,189,248,0.1)', border: `1px solid ${st.cor}` }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>SITUAÇÃO ATUAL DA ENTREGA</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: st.cor, marginTop: 2 }}>{st.label}</div>
            </div>
            <div>
              <Package size={14} style={{ verticalAlign: 'middle' }} /> Status WMS: <strong>{dados.status_pedido}</strong>
            </div>
            {dados.embarque_codigo && (
              <div>
                Roteiro: <strong>{dados.embarque_codigo}</strong> • Motorista: <strong>{dados.motorista_nome || '-'}</strong> • Placa:{' '}
                <strong>{dados.veiculo_placa || '-'}</strong>
              </div>
            )}
            {dados.concluido_at && (
              <div style={{ color: '#4ade80' }}>
                <CheckCircle2 size={14} style={{ verticalAlign: 'middle' }} /> Concluído em{' '}
                {new Date(dados.concluido_at).toLocaleString('pt-BR')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
