import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  Navigation,
  QrCode,
  RefreshCw,
  Smartphone,
  Thermometer,
  Truck,
} from 'lucide-react'
import { roteirizacaoQueries } from '../queries/roteirizacao'
import { useAppStore } from '../store/appStore'
import { PwaInstallBanner } from '../components/shared/PwaInstallBanner'
import { QrCameraModal } from '../components/shared/QrCameraModal'
import { extrairQrTokenDeEntrada, listarRotasRecentes } from '../utils/motoristaPwa'

const STATUS_CFG = {
  EM_ROTA: { label: 'EM ROTA', bg: 'rgba(168,85,247,0.18)', border: '#a855f7', color: '#d8b4fe' },
  EM_CARREGAMENTO: { label: 'CARREGANDO', bg: 'rgba(245,158,11,0.18)', border: '#f59e0b', color: '#fcd34d' },
  PLANEJADO: { label: 'PLANEJADA', bg: 'rgba(56,189,248,0.16)', border: '#38bdf8', color: '#7dd3fc' },
  CONCLUIDO: { label: 'CONCLUÍDA', bg: 'rgba(34,197,94,0.16)', border: '#22c55e', color: '#86efac' },
}

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

export function MotoristaHub() {
  const navigate = useNavigate()
  const { operador, sessionToken } = useAppStore()
  const autenticado = Boolean(operador && sessionToken)

  const [linkOuToken, setLinkOuToken] = useState('')
  const [rotasAtivas, setRotasAtivas] = useState([])
  const [rotasRecentes, setRotasRecentes] = useState(() => listarRotasRecentes())
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [cameraAberta, setCameraAberta] = useState(false)

  const carregar = useCallback(async () => {
    setRotasRecentes(listarRotasRecentes())
    if (!autenticado) return
    setLoading(true)
    setErro('')
    try {
      const res = await roteirizacaoQueries.listarMinhasRotas()
      setRotasAtivas(res?.data || [])
    } catch (err) {
      setErro(err.message || 'Não foi possível carregar as rotas.')
    } finally {
      setLoading(false)
    }
  }, [autenticado])

  useEffect(() => {
    carregar()
  }, [carregar])

  const handleAbrirPorToken = (e) => {
    e.preventDefault()
    const token = extrairQrTokenDeEntrada(linkOuToken)
    if (!token) {
      setErro('Cole o link recebido no WhatsApp ou leia o QR Code da rota com a câmera.')
      return
    }
    setErro('')
    navigate(`/motorista/${encodeURIComponent(token)}`)
  }

  const handleQrLidoCamera = (rawText) => {
    setCameraAberta(false)
    const token = extrairQrTokenDeEntrada(rawText)
    if (!token) {
      setErro('QR Code lido, mas não corresponde a uma rota do WMSphere.')
      return
    }
    setErro('')
    setLinkOuToken(rawText)
    navigate(`/motorista/${encodeURIComponent(token)}`)
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0b1120',
        color: '#f8fafc',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 36px)',
        paddingLeft: 14,
        paddingRight: 14,
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* HEADER MOBILE APP */}
        <div
          style={{
            background: '#111c33',
            border: '1px solid #1e293b',
            borderRadius: 14,
            padding: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #2563eb, #06b6d4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Truck size={23} color="#ffffff" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 800, letterSpacing: '0.06em' }}>
                WMSPHERE • APP MOTORISTA
              </div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>Central de Entregas</h1>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {autenticado && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(window.innerWidth <= 768 ? '/' : '/roteirizacao')}
                title="Voltar ao ERP"
              >
                <ArrowLeft size={14} /> Início
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={carregar} disabled={loading}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* BANNER INSTALAÇÃO PWA (iPhone Safari / Android Chrome) */}
        <PwaInstallBanner />

        {/* ABRIR ROTA POR LINK / TOKEN DO QR CODE */}
        <form
          onSubmit={handleAbrirPorToken}
          style={{
            background: '#111c33',
            border: '1px solid #1e293b',
            borderRadius: 14,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 7 }}>
            <QrCode size={16} color="#38bdf8" /> Abrir Rota por QR Code ou Link
          </div>
          <button
            type="button"
            onClick={() => {
              setErro('')
              setCameraAberta(true)
            }}
            style={{
              width: '100%',
              height: 48,
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, #2563eb, #06b6d4)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              boxShadow: '0 6px 18px rgba(37, 99, 235, 0.35)',
            }}
          >
            <Camera size={18} /> Ler QR Code com a Câmera
          </button>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Ou cole abaixo o link enviado no WhatsApp / código do roteiro:
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="form-input"
              style={{ flex: 1, height: 44, fontSize: 13 }}
              placeholder="Cole o link da rota ou código QR..."
              value={linkOuToken}
              onChange={(e) => setLinkOuToken(e.target.value)}
            />
            <button type="submit" className="btn btn--primary" style={{ height: 44, padding: '0 16px' }}>
              <Navigation size={15} /> Abrir
            </button>
          </div>
          {erro && <div style={{ fontSize: 12, color: '#fca5a5' }}>{erro}</div>}
        </form>

        {/* ROTAS DO SISTEMA (QUANDO LOGADO NO ERP / PERFIL MOTORISTA) */}
        {autenticado && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
                Rotas da Filial ({rotasAtivas.length})
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>Usuário: {operador?.nome}</span>
            </div>

            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                Carregando rotas...
              </div>
            ) : rotasAtivas.length === 0 ? (
              <div
                style={{
                  background: '#111c33',
                  border: '1px solid #1e293b',
                  borderRadius: 12,
                  padding: 20,
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: 13,
                }}
              >
                Nenhuma rota disponível no momento. Crie e despache um embarque em <strong>Roteirização</strong>.
              </div>
            ) : (
              rotasAtivas.map((r) => {
                const st = STATUS_CFG[r.status] || STATUS_CFG.PLANEJADO
                const concluidas = Number(r.entregues || 0) + Number(r.devolvidas || 0)
                const total = Number(r.total_paradas || 0)
                const pct = total > 0 ? Math.round((concluidas / total) * 100) : 0
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!r.qr_token}
                    onClick={() => r.qr_token && navigate(`/motorista/${encodeURIComponent(r.qr_token)}`)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: '#111c33',
                      border: `1.5px solid ${r.status === 'EM_ROTA' ? 'rgba(168,85,247,0.55)' : '#1e293b'}`,
                      borderRadius: 14,
                      padding: 15,
                      color: '#f8fafc',
                      cursor: r.qr_token ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: '#38bdf8' }}>
                        {r.codigo} {r.rota_nome ? `• ${r.rota_nome}` : ''}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 800,
                          padding: '3px 9px',
                          borderRadius: 99,
                          background: st.bg,
                          border: `1px solid ${st.border}`,
                          color: st.color,
                        }}
                      >
                        {st.label}
                      </span>
                    </div>

                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.titulo || 'Roteiro de Entrega'}</div>

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#94a3b8' }}>
                      <span>
                        <Clock size={12} style={{ verticalAlign: 'middle' }} /> {fmtData(r.data_embarque)}
                        {r.horario_saida ? ` às ${r.horario_saida}` : ''}
                      </span>
                      {r.veiculo_placa && <span>Placa: <strong style={{ color: '#e2e8f0' }}>{r.veiculo_placa}</strong></span>}
                      {r.motorista_nome && <span>Mot.: <strong style={{ color: '#e2e8f0' }}>{r.motorista_nome}</strong></span>}
                      {r.temperatura_bau != null && (
                        <span>
                          <Thermometer size={12} style={{ verticalAlign: 'middle' }} /> {r.temperatura_bau}°C
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                      <div style={{ flex: 1, height: 6, background: '#1e293b', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#38bdf8' }} />
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
                        {concluidas}/{total} ({pct}%)
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        )}

        {/* ROTAS RECENTES SALVAS NESTE APARELHO (FUNCIONA SEM LOGIN) */}
        {rotasRecentes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', padding: '0 4px' }}>
              Acessadas recentemente neste celular
            </div>
            {rotasRecentes.map((r) => (
              <button
                key={r.qr_token}
                type="button"
                onClick={() => navigate(`/motorista/${encodeURIComponent(r.qr_token)}`)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: '#111c33',
                  border: '1px solid #1e293b',
                  borderRadius: 12,
                  padding: '12px 14px',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#38bdf8' }}>
                    {r.codigo} {r.veiculo_placa ? `• ${r.veiculo_placa}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.titulo || 'Roteiro'} • {r.entregues}/{r.total_paradas} entregas
                  </div>
                </div>
                <ExternalLink size={16} color="#94a3b8" />
              </button>
            ))}
          </div>
        )}

        {!autenticado && (
          <div style={{ textAlign: 'center', paddingTop: 6 }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/login')}>
              <Smartphone size={14} /> Entrar com usuário do sistema
            </button>
          </div>
        )}
      </div>

      <QrCameraModal
        open={cameraAberta}
        onClose={() => setCameraAberta(false)}
        onDetected={handleQrLidoCamera}
        titulo="Ler QR Code do Roteiro"
      />
    </div>
  )
}
