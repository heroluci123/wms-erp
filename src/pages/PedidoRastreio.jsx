import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Truck, CheckCircle2, Package, AlertTriangle, MapPin, ShieldCheck, Thermometer, Clock } from 'lucide-react'
import { roteirizacaoQueries } from '../queries/roteirizacao'

const STATUS_MAP = {
  AGUARDANDO_ROTA: { label: 'Em preparação / Aguardando roteiro', cor: '#94a3b8', step: 0 },
  PENDENTE: { label: 'Roteirizado para embarque', cor: '#38bdf8', step: 1 },
  A_CAMINHO: { label: 'Saiu para entrega (Em rota)', cor: '#f59e0b', step: 2 },
  NO_CLIENTE: { label: 'Veículo no local de entrega', cor: '#a78bfa', step: 3 },
  ENTREGUE: { label: 'Pedido Entregue', cor: '#22c55e', step: 4 },
  DEVOLVIDA: { label: 'Entrega não realizada / Retornou', cor: '#ef4444', step: 4 },
}

const ETAPAS = [
  { key: 1, label: 'Roteirizado', icon: Package },
  { key: 2, label: 'Em Rota', icon: Truck },
  { key: 3, label: 'No Local', icon: MapPin },
  { key: 4, label: 'Concluído', icon: CheckCircle2 },
]

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
      <div
        style={{
          minHeight: '100dvh',
          background: '#0b1120',
          color: '#f8fafc',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 36px)',
          paddingLeft: 24,
          paddingRight: 24,
          textAlign: 'center',
        }}
      >
        Consultando status da entrega...
      </div>
    )
  }

  const st = STATUS_MAP[dados?.status_entrega] || { label: dados?.status_entrega || '-', cor: '#38bdf8', step: 0 }
  const devolvida = dados?.status_entrega === 'DEVOLVIDA'

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0b1120',
        color: '#f8fafc',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)',
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div style={{ maxWidth: 520, margin: '12px auto', background: '#111c33', border: '1px solid #1e293b', borderRadius: 16, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 18 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #2563eb, #06b6d4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Truck size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 800, letterSpacing: '0.06em' }}>
              WMSPHERE • RASTREIO DE ENTREGA
            </div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              {dados ? `${dados.codigo} — ${dados.cliente}` : 'Rastreio'}
            </h2>
          </div>
        </div>

        {erro ? (
          <div style={{ color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} /> {erro}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
            <div style={{ padding: 14, borderRadius: 12, background: `${st.cor}1a`, border: `1.5px solid ${st.cor}` }}>
              <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700 }}>SITUAÇÃO ATUAL</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: st.cor, marginTop: 2 }}>{st.label}</div>
              {devolvida && dados.motivo_recusa && (
                <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>Motivo: {dados.motivo_recusa}</div>
              )}
            </div>

            {/* LINHA DO TEMPO VISUAL */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {ETAPAS.map((et) => {
                const Icon = et.icon
                const atingida = st.step >= et.key
                const corStep = atingida ? (devolvida && et.key === 4 ? '#ef4444' : '#22c55e') : '#334155'
                return (
                  <div
                    key={et.key}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                      padding: '8px 4px',
                      borderRadius: 10,
                      background: atingida ? `${corStep}18` : '#0b1224',
                      border: `1px solid ${corStep}`,
                    }}
                  >
                    <Icon size={16} color={atingida ? corStep : '#64748b'} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: atingida ? '#f8fafc' : '#64748b' }}>
                      {et.label}
                    </span>
                  </div>
                )
              })}
            </div>

            <div
              style={{
                background: '#0b1224',
                border: '1px solid #1e293b',
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div>
                <Package size={14} style={{ verticalAlign: 'middle', color: '#38bdf8' }} /> Status do Pedido:{' '}
                <strong>{dados.status_pedido}</strong>
              </div>
              {dados.embarque_codigo && (
                <div>
                  <Truck size={14} style={{ verticalAlign: 'middle', color: '#38bdf8' }} /> Roteiro:{' '}
                  <strong>{dados.embarque_codigo}</strong> • Motorista: <strong>{dados.motorista_nome || '-'}</strong> • Placa:{' '}
                  <strong>{dados.veiculo_placa || '-'}</strong>
                </div>
              )}
              {dados.chegou_em && (
                <div style={{ color: '#cbd5e1' }}>
                  <Clock size={14} style={{ verticalAlign: 'middle', color: '#a78bfa' }} /> Chegada no local:{' '}
                  <strong>{new Date(dados.chegou_em).toLocaleString('pt-BR')}</strong>
                </div>
              )}
              {dados.concluido_at && (
                <div style={{ color: devolvida ? '#fca5a5' : '#4ade80' }}>
                  <CheckCircle2 size={14} style={{ verticalAlign: 'middle' }} />{' '}
                  {devolvida ? 'Ocorrência em ' : 'Entregue em '}
                  <strong>{new Date(dados.concluido_at).toLocaleString('pt-BR')}</strong>
                </div>
              )}
              {dados.recebedor_nome && (
                <div>
                  Recebido por: <strong>{dados.recebedor_nome}</strong>
                </div>
              )}
              {dados.temperatura_entrega != null && (
                <div>
                  <Thermometer size={14} style={{ verticalAlign: 'middle', color: '#38bdf8' }} /> Temperatura na entrega:{' '}
                  <strong>{dados.temperatura_entrega}°C</strong>
                </div>
              )}
              {dados.tem_comprovante && (
                <div style={{ color: '#4ade80', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <ShieldCheck size={16} /> Comprovante Digital (POD) registrado pela transportadora
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
