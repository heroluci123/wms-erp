import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Truck, MapPin, CheckCircle2, AlertTriangle, Navigation, DollarSign, Phone, Package } from 'lucide-react'
import { roteirizacaoQueries } from '../queries/roteirizacao'

const STATUS_LABEL = {
  PENDENTE: 'Aguardando Saída',
  A_CAMINHO: 'A Caminho',
  NO_CLIENTE: 'No Cliente',
  ENTREGUE: 'Entregue ✅',
  DEVOLVIDA: 'Recusa / Devolvida',
}

export function MotoristaRastreio() {
  const { qrToken } = useParams()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [dados, setDados] = useState(null)
  const [motoristaNome, setMotoristaNome] = useState('')
  const [veiculoPlaca, setVeiculoPlaca] = useState('')
  const [iniciando, setIniciando] = useState(false)
  const [salvandoId, setSalvandoId] = useState(null)
  const [pgtoConfirmadoMap, setPgtoConfirmadoMap] = useState({})
  const [obsMap, setObsMap] = useState({})
  const [msgSucesso, setMsgSucesso] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const res = await roteirizacaoQueries.obterRotaPublica(qrToken)
      setDados(res)
      if (res?.rota?.motorista_nome) setMotoristaNome(res.rota.motorista_nome)
      if (res?.rota?.veiculo_placa) setVeiculoPlaca(res.rota.veiculo_placa)
    } catch (err) {
      setErro(err.message || 'Não foi possível carregar este roteiro.')
    } finally {
      setLoading(false)
    }
  }, [qrToken])

  useEffect(() => {
    if (qrToken) carregar()
  }, [qrToken, carregar])

  const handleIniciarRota = async (e) => {
    e.preventDefault()
    setErro('')
    setMsgSucesso('')
    setIniciando(true)
    try {
      await roteirizacaoQueries.iniciarRotaPublica(qrToken, {
        motorista_nome: motoristaNome,
        veiculo_placa: veiculoPlaca,
      })
      setMsgSucesso('Rota iniciada! Placa e motorista atualizados na central.')
      await carregar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setIniciando(false)
    }
  }

  const atualizarParada = async (parada, novoStatus) => {
    setErro('')
    setMsgSucesso('')
    setSalvandoId(parada.pedido_id)
    try {
      await roteirizacaoQueries.atualizarParadaPublica(qrToken, parada.pedido_id, {
        status_entrega: novoStatus,
        pagamento_confirmado: Boolean(pgtoConfirmadoMap[parada.pedido_id] ?? parada.pagamento_confirmado),
        observacao_motorista: obsMap[parada.pedido_id] ?? parada.observacao_motorista ?? '',
      })
      setMsgSucesso(`Parada #${parada.ordem_parada} (${parada.pedido_codigo}) atualizada para ${STATUS_LABEL[novoStatus] || novoStatus}.`)
      await carregar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setSalvandoId(null)
    }
  }

  if (loading && !dados) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', padding: 24, textAlign: 'center' }}>
        Carregando roteiro de entrega...
      </div>
    )
  }

  const rota = dados?.rota
  const paradas = dados?.paradas || []

  return (
    <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', padding: '16px 14px 40px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            background: '#111c33',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Truck size={24} style={{ color: '#38bdf8' }} />
            <div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>TRICARNES • PAINEL DO MOTORISTA</div>
              <h1 style={{ fontSize: 18, margin: 0 }}>
                {rota ? `${rota.codigo} — ${rota.titulo || rota.rota_nome || 'Entrega'}` : 'Rastreio de Rota'}
              </h1>
            </div>
          </div>
          {rota && (
            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 8 }}>
              Status: <strong>{rota.status}</strong> • Veículo: <strong>{rota.veiculo_placa || 'Não informado'}</strong> • Motorista:{' '}
              <strong>{rota.motorista_nome || 'Não informado'}</strong>
            </div>
          )}
        </div>

        {erro && (
          <div
            style={{
              background: 'rgba(239,68,68,0.16)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertTriangle size={16} /> {erro}
          </div>
        )}

        {msgSucesso && (
          <div
            style={{
              background: 'rgba(34,197,94,0.16)',
              border: '1px solid #22c55e',
              color: '#86efac',
              padding: '10px 14px',
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            {msgSucesso}
          </div>
        )}

        {rota && rota.status !== 'CONCLUIDO' && (
          <form
            onSubmit={handleIniciarRota}
            style={{
              background: '#111c33',
              border: '1px solid #1e293b',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#93c5fd' }}>
              1. Identificação do Veículo &amp; Início da Rota
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Nome do Motorista *</label>
                <input
                  className="form-input"
                  placeholder="Ex: Carlos Silva"
                  value={motoristaNome}
                  onChange={(e) => setMotoristaNome(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="form-label">Placa do Veículo *</label>
                <input
                  className="form-input"
                  placeholder="Ex: ABC-1D23"
                  value={veiculoPlaca}
                  onChange={(e) => setVeiculoPlaca(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>
            <button type="submit" className="btn btn--primary" disabled={iniciando}>
              <Navigation size={15} /> {iniciando ? 'Salvando...' : rota.status === 'EM_ROTA' ? 'Atualizar Placa / Motorista' : 'Iniciar Rota Agora'}
            </button>
          </form>
        )}

        {/* Paradas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {paradas.map((p) => {
            const finalizada = p.status_entrega === 'ENTREGUE' || p.status_entrega === 'DEVOLVIDA'
            const pagoOk = Boolean(pgtoConfirmadoMap[p.pedido_id] ?? p.pagamento_confirmado)
            return (
              <div
                key={p.pedido_id}
                style={{
                  background: '#111c33',
                  border: `1px solid ${finalizada ? '#22c55e66' : '#334155'}`,
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: '#38bdf8' }}>
                    Parada #{p.ordem_parada} • {p.pedido_codigo}
                  </span>
                  <span
                    className={`badge ${
                      p.status_entrega === 'ENTREGUE'
                        ? 'badge--success'
                        : p.status_entrega === 'DEVOLVIDA'
                          ? 'badge--danger'
                          : 'badge--info'
                    }`}
                  >
                    {STATUS_LABEL[p.status_entrega] || p.status_entrega}
                  </span>
                </div>

                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.cliente}</div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MapPin size={14} /> {p.endereco_completo || 'Endereço no cadastro'}
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>
                    <Package size={13} style={{ verticalAlign: 'middle' }} /> {p.total_caixas} cx ({p.total_kg} kg)
                  </span>
                  {p.telefone && (
                    <span>
                      <Phone size={13} style={{ verticalAlign: 'middle' }} /> {p.telefone}
                    </span>
                  )}
                </div>

                {p.pagamento_na_entrega && !finalizada && (
                  <label
                    style={{
                      background: 'rgba(239, 68, 68, 0.14)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontSize: 12.5,
                      color: '#fca5a5',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pagoOk}
                      onChange={(e) =>
                        setPgtoConfirmadoMap((prev) => ({ ...prev, [p.pedido_id]: e.target.checked }))
                      }
                    />
                    <span>
                      <DollarSign size={13} style={{ verticalAlign: 'middle' }} />{' '}
                      <strong>Pagamento na Entrega Obrigatório:</strong>{' '}
                      R$ {Number(p.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (marque após receber PIX/Cartão/Dinheiro)
                    </span>
                  </label>
                )}

                {!finalizada && (
                  <>
                    <input
                      className="form-input"
                      style={{ fontSize: 12 }}
                      placeholder="Observação da entrega / recebedor (opcional)..."
                      value={obsMap[p.pedido_id] ?? p.observacao_motorista ?? ''}
                      onChange={(e) => setObsMap((prev) => ({ ...prev, [p.pedido_id]: e.target.value }))}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {p.status_entrega !== 'NO_CLIENTE' && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={salvandoId === p.pedido_id}
                          onClick={() => atualizarParada(p, 'NO_CLIENTE')}
                        >
                          Cheguei no Cliente
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--success btn--sm"
                        style={{ flex: 1 }}
                        disabled={salvandoId === p.pedido_id}
                        onClick={() => atualizarParada(p, 'ENTREGUE')}
                      >
                        <CheckCircle2 size={14} /> Confirmar Entrega
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={salvandoId === p.pedido_id}
                        onClick={() => atualizarParada(p, 'DEVOLVIDA')}
                      >
                        Recusa / Voltou
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
