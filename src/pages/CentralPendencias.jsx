import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BellRing,
  CheckCircle2,
  Clock,
  ArrowRight,
  Plus,
  RefreshCw,
  Factory,
  ClipboardList,
  Truck,
  MessageSquare,
  DollarSign,
  Package,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { pendenciasQueries } from '../queries/pendencias'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const SETORES = [
  { id: 'SUPPLY_CHAIN', label: 'Supply Chain', cor: '#38bdf8', rota: '/pedidos' },
  { id: 'PCP', label: 'PCP / Produção', cor: '#f59e0b', rota: '/producao' },
  { id: 'CAMARA_FRIA', label: 'Câmara Fria', cor: '#22c55e', rota: '/saida' },
  { id: 'LOGISTICA', label: 'Logística', cor: '#a78bfa', rota: '/saida' },
  { id: 'FATURAMENTO', label: 'Faturamento', cor: '#06b6d4', rota: '/pedidos' },
  { id: 'FINANCEIRO', label: 'Financeiro', cor: '#ec4899', rota: '/pedidos' },
]

const STATUS_BADGE = {
  PENDENTE: { label: 'Pendente', cls: 'badge--warning' },
  EM_ATENDIMENTO: { label: 'Em Atendimento', cls: 'badge--info' },
  CONCLUIDA: { label: 'Concluída', cls: 'badge--success' },
}

export function CentralPendencias() {
  const { toastSuccess, toastError } = useAppStore()
  const navigate = useNavigate()

  const [setorFiltro, setSetorFiltro] = useState('TODOS')
  const [statusFiltro, setStatusFiltro] = useState('ATIVAS')
  const [lista, setLista] = useState([])
  const [contadores, setContadores] = useState({})
  const [filaAoVivo, setFilaAoVivo] = useState({})
  const [loading, setLoading] = useState(true)

  const [modalNovo, setModalNovo] = useState(false)
  const [formNovo, setFormNovo] = useState({
    setor_destino: 'SUPPLY_CHAIN',
    tipo_pendencia: 'AVISO_SETOR',
    titulo: '',
    prioridade: 2,
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await pendenciasQueries.listar({ setor: setorFiltro, status: statusFiltro })
      setLista(res?.data || [])
      setContadores(res?.contadores || {})
      setFilaAoVivo(res?.filaAoVivo || {})
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoading(false)
    }
  }, [setorFiltro, statusFiltro, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const mudarStatus = async (id, novoStatus) => {
    try {
      await pendenciasQueries.atualizarStatus(id, novoStatus)
      toastSuccess('Atualizado', `Pendência marcada como ${STATUS_BADGE[novoStatus]?.label || novoStatus}.`)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const rotaParaPendencia = (p) => {
    if (p.tipo_pendencia === 'PEDIDO_WHATSAPP' && p.referencia_tabela === 'whatsapp_inbox') return '/whatsapp-inbox'
    if (p.referencia_tabela === 'pedidos') return '/pedidos'
    if (p.referencia_tabela === 'ordens_producao') return '/producao'
    const s = SETORES.find((x) => x.id === p.setor_destino)
    return s?.rota || '/'
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <BellRing className="text-primary" size={26} /> Central de Pendências por Setor (On-Demand Work)
          </h1>
          <p className="page-header__subtitle">
            Visão unificada do que está pendente para Supply Chain, Financeiro, Produção/PCP, Câmara Fria, Logística e Faturamento
          </p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--secondary" onClick={carregar}>
            <RefreshCw size={16} /> Atualizar
          </button>
          <button className="btn btn--primary" onClick={() => setModalNovo(true)} disabled={!isApiEnabled()}>
            <Plus size={16} /> Enviar Pendência p/ Setor
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Central de Pendências (On-Demand Work)" />

      {/* Painel Ao Vivo da Operação */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/whatsapp-inbox')}>
          <div className="kpi-card__label flex items-center gap-6">
            <MessageSquare size={13} /> WhatsApp Aguardando
          </div>
          <div className="kpi-card__value">{filaAoVivo.whatsapp_pendentes || 0}</div>
          <div className="kpi-card__sub">Mensagens p/ converter em pedido</div>
        </div>
        <div className="kpi-card kpi-card--warning" style={{ cursor: 'pointer' }} onClick={() => navigate('/pedidos')}>
          <div className="kpi-card__label flex items-center gap-6">
            <DollarSign size={13} /> Pedidos do Financeiro
          </div>
          <div className="kpi-card__value">{filaAoVivo.pedidos_financeiro || 0}</div>
          <div className="kpi-card__sub">Aguardando Supply Chain liberar</div>
        </div>
        <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/producao')}>
          <div className="kpi-card__label flex items-center gap-6">
            <Factory size={13} /> OPs em Aberto (PCP)
          </div>
          <div className="kpi-card__value">{filaAoVivo.ops_pendentes || 0}</div>
          <div className="kpi-card__sub">Liberadas ou em produção</div>
        </div>
        <div className="kpi-card kpi-card--success" style={{ cursor: 'pointer' }} onClick={() => navigate('/saida')}>
          <div className="kpi-card__label flex items-center gap-6">
            <Package size={13} /> Separação Câmara Fria
          </div>
          <div className="kpi-card__value">{filaAoVivo.pedidos_separacao || 0}</div>
          <div className="kpi-card__sub">Pedidos liberados/em separação</div>
        </div>
        <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/saida')}>
          <div className="kpi-card__label flex items-center gap-6">
            <Truck size={13} /> Conferência / Expedição
          </div>
          <div className="kpi-card__value">{filaAoVivo.romaneios_conferencia || 0}</div>
          <div className="kpi-card__sub">Romaneios prontos para conferir</div>
        </div>
      </div>

      {/* Filtros por Setor */}
      <div className="card mb-16" style={{ padding: 14 }}>
        <div className="flex justify-between items-center flex-wrap gap-10">
          <div className="flex gap-8 flex-wrap">
            <button
              className={`btn btn--sm ${setorFiltro === 'TODOS' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setSetorFiltro('TODOS')}
            >
              Todos os Setores ({contadores.TOTAL_ATIVAS || 0})
            </button>
            {SETORES.map((s) => (
              <button
                key={s.id}
                className={`btn btn--sm ${setorFiltro === s.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setSetorFiltro(s.id)}
              >
                {s.label} ({contadores[s.id] || 0})
              </button>
            ))}
          </div>
          <select className="form-input" style={{ width: 170 }} value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
            <option value="ATIVAS">Pendentes / Em Andamento</option>
            <option value="CONCLUIDA">Concluídas</option>
            <option value="TODOS">Todas</option>
          </select>
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="p-24 text-center text-muted">Carregando fila de tarefas...</div>
        ) : lista.length === 0 ? (
          <div className="p-32 text-center text-muted">
            <CheckCircle2 size={34} style={{ margin: '0 auto 10px', opacity: 0.45 }} />
            <div>Nenhuma pendência na fila para este filtro.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Setor Destino</th>
                <th>Tipo</th>
                <th>Demanda / Descrição</th>
                <th>Prioridade</th>
                <th>Status</th>
                <th>Criado em</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const setorObj = SETORES.find((s) => s.id === p.setor_destino)
                const st = STATUS_BADGE[p.status] || { label: p.status, cls: 'badge--ghost' }
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="badge badge--info" style={{ borderColor: setorObj?.cor }}>
                        {setorObj?.label || p.setor_destino}
                      </span>
                    </td>
                    <td className="td-mono" style={{ fontSize: 11 }}>{p.tipo_pendencia}</td>
                    <td className="font-bold">{p.titulo}</td>
                    <td>
                      {Number(p.prioridade) >= 3 ? (
                        <span className="badge badge--danger">Alta ({p.prioridade})</span>
                      ) : (
                        <span className="badge badge--ghost">Normal ({p.prioridade})</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="td-muted">{new Date(p.created_at).toLocaleString('pt-BR')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-6 flex-wrap">
                        <button className="btn btn--sm btn--secondary" onClick={() => navigate(rotaParaPendencia(p))}>
                          Abrir <ArrowRight size={13} />
                        </button>
                        {p.status === 'PENDENTE' && (
                          <button className="btn btn--sm btn--primary" onClick={() => mudarStatus(p.id, 'EM_ATENDIMENTO')}>
                            <Clock size={13} /> Assumir
                          </button>
                        )}
                        {p.status !== 'CONCLUIDA' && (
                          <button className="btn btn--sm btn--success" onClick={() => mudarStatus(p.id, 'CONCLUIDA')}>
                            <CheckCircle2 size={13} /> Concluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {modalNovo && (
        <div className="flex items-center justify-center p-24 fade-in" style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)' }}>
          <div className="card" style={{ width: '100%', maxWidth: 520, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">Nova Demanda / Aviso para Setor</h3>
              <button className="btn-icon" onClick={() => setModalNovo(false)}>
                <X size={18} />
              </button>
            </div>
            <form
              className="p-20 flex flex-col gap-14"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  await pendenciasQueries.criar(formNovo)
                  toastSuccess('Enviado', `Demanda encaminhada para ${formNovo.setor_destino}.`)
                  setModalNovo(false)
                  setFormNovo({ setor_destino: 'SUPPLY_CHAIN', tipo_pendencia: 'AVISO_SETOR', titulo: '', prioridade: 2 })
                  carregar()
                } catch (err) {
                  toastError('Erro', err.message)
                }
              }}
            >
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Setor Destino *</label>
                  <select className="form-input" value={formNovo.setor_destino} onChange={(e) => setFormNovo({ ...formNovo, setor_destino: e.target.value })}>
                    {SETORES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Prioridade (1 a 5)</label>
                  <select className="form-input" value={formNovo.prioridade} onChange={(e) => setFormNovo({ ...formNovo, prioridade: Number(e.target.value) })}>
                    <option value={1}>1 - Baixa</option>
                    <option value={2}>2 - Normal</option>
                    <option value={3}>3 - Alta</option>
                    <option value={4}>4 - Urgente</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">Descrição da Pendência *</label>
                <input
                  className="form-input"
                  required
                  value={formNovo.titulo}
                  onChange={(e) => setFormNovo({ ...formNovo, titulo: e.target.value })}
                  placeholder="Ex: Validar NF 1045 vs pedido de compra e bipagem na câmara"
                />
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalNovo(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <ClipboardList size={15} /> Enviar para Fila do Setor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
