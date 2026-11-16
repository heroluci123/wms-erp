import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MessageSquare,
  Sparkles,
  CheckCircle2,
  XCircle,
  Send,
  RefreshCw,
  AlertTriangle,
  Plus,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { whatsappQueries } from '../queries/whatsapp'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const EXEMPLO_WHATS = `Galê Osteria — Campinas
Vendedor: a confirmar

ITENS
1. Baby Beef — 2 kg × R$ 126,90 = R$ 253,80
↳ 250 g, 4x1
2. Ossobuco — 5 kg × R$ 49,90 = R$ 249,50
↳ T7 — ⚠️ PORÇÕES UNIFORMES (reclamação anterior)

PAGAMENTO: 14/21 dias`

export function WhatsappInbox() {
  const { toastSuccess, toastError } = useAppStore()
  const navigate = useNavigate()

  const [statusFiltro, setStatusFiltro] = useState('PENDENTE')
  const [mensagens, setMensagens] = useState([])
  const [loading, setLoading] = useState(true)

  const [novaMsg, setNovaMsg] = useState('')
  const [remetenteNome, setRemetenteNome] = useState('')
  const [processando, setProcessando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const data = await whatsappQueries.listarInbox({ status: statusFiltro })
      setMensagens(data || [])
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoading(false)
    }
  }, [statusFiltro, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const handleReceberColar = async (e) => {
    e.preventDefault()
    if (!novaMsg.trim()) return
    setProcessando(true)
    try {
      const res = await whatsappQueries.criarInbox({
        remetente_nome: remetenteNome.trim(),
        mensagem_bruta: novaMsg,
      })
      toastSuccess('Mensagem analisada!', `${res.parsed?.itens?.length || 0} item(ns) extraído(s) (${res.parsed?.confianca_pct || 0}% confiança).`)
      setNovaMsg('')
      setRemetenteNome('')
      setStatusFiltro('PENDENTE')
      await carregar()
    } catch (err) {
      toastError('Erro ao analisar', err.message)
    } finally {
      setProcessando(false)
    }
  }

  const handleConverter = async (msg, liberar) => {
    setProcessando(true)
    try {
      const res = await whatsappQueries.converterEmPedido(msg.id, { liberar })
      toastSuccess(
        liberar ? `Pedido ${res.codigo} criado e liberado!` : `Pedido ${res.codigo} criado em Rascunho!`,
        'Convertido direto da mensagem do WhatsApp em 1 clique.'
      )
      await carregar()
    } catch (err) {
      toastError('Erro ao converter', err.message)
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <MessageSquare className="text-primary" size={26} /> Entrada WhatsApp &amp; Parser Inteligente
          </h1>
          <p className="page-header__subtitle">
            Cole ou receba mensagens de clientes, confira os cortes/preços reconhecidos automaticamente e gere o pedido em 1 clique sem Alt+Tab
          </p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--secondary" onClick={carregar}>
            <RefreshCw size={16} /> Atualizar
          </button>
          <button className="btn btn--primary" onClick={() => navigate('/pedidos')}>
            Ir para Pedidos
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Entrada WhatsApp (Parser Inteligente)" />

      <div className="grid-responsive" style={{ alignItems: 'start' }}>
        {/* Colar / Simular recebimento WhatsApp */}
        <div className="card">
          <div className="flex justify-between items-center mb-12">
            <h3 className="text-base font-bold flex items-center gap-8">
              <Sparkles size={17} className="text-warning" /> Ler Nova Mensagem do WhatsApp
            </h3>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNovaMsg(EXEMPLO_WHATS)}>
              Usar Exemplo Real
            </button>
          </div>
          <form onSubmit={handleReceberColar} className="flex flex-col gap-12">
            <div>
              <label className="form-label">Nome / Contato Remetente (opcional)</label>
              <input
                className="form-input"
                placeholder="Ex: Galê Osteria - Campinas"
                value={remetenteNome}
                onChange={(e) => setRemetenteNome(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Mensagem Bruta do WhatsApp *</label>
              <textarea
                className="form-input font-mono"
                rows={10}
                required
                style={{ fontSize: 12, lineHeight: 1.5 }}
                placeholder="Cole aqui a mensagem do pedido recebida no WhatsApp..."
                value={novaMsg}
                onChange={(e) => setNovaMsg(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn--primary" disabled={!isApiEnabled() || processando}>
              <Plus size={16} /> {processando ? 'Analisando...' : 'Analisar & Colocar na Caixa de Entrada'}
            </button>
          </form>
        </div>

        {/* Lista Inbox */}
        <div className="flex flex-col gap-12">
          <div className="card" style={{ padding: 12 }}>
            <div className="flex gap-8 flex-wrap">
              {['PENDENTE', 'CONVERTIDO', 'IGNORADO', 'TODOS'].map((st) => (
                <button
                  key={st}
                  className={`btn btn--sm ${statusFiltro === st ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setStatusFiltro(st)}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="card p-24 text-center text-muted">Carregando caixa de entrada...</div>
          ) : mensagens.length === 0 ? (
            <div className="card p-32 text-center text-muted">Nenhuma mensagem encontrada em "{statusFiltro}".</div>
          ) : (
            mensagens.map((m) => {
              const p = m.parsed_json || {}
              const itens = Array.isArray(p.itens) ? p.itens : []
              const temVinc = itens.some((i) => i.produto_id)
              return (
                <div key={m.id} className="card" style={{ borderLeft: m.status === 'PENDENTE' ? '4px solid var(--warning)' : '4px solid var(--border)' }}>
                  <div className="flex justify-between items-start flex-wrap gap-8 mb-10">
                    <div>
                      <div className="flex items-center gap-8 flex-wrap">
                        <strong className="text-base">{m.cliente_razao_social || p.cliente_texto || m.remetente_nome || 'Cliente não identificado'}</strong>
                        <span className={`badge ${Number(m.confianca_pct) >= 70 ? 'badge--success' : 'badge--warning'}`}>
                          {m.confianca_pct}% Parser
                        </span>
                        <span className="badge badge--ghost">{m.status}</span>
                      </div>
                      <div className="text-xs text-muted mt-4">
                        Recebido em {new Date(m.recebido_em).toLocaleString('pt-BR')}
                        {p.forma_pagamento_texto ? ` • Pagamento: ${p.forma_pagamento_texto}` : ''}
                      </div>
                    </div>

                    {m.status === 'PENDENTE' && (
                      <div className="flex gap-6 flex-wrap">
                        <button
                          className="btn btn--sm btn--secondary"
                          disabled={processando || !temVinc}
                          onClick={() => handleConverter(m, false)}
                        >
                          <CheckCircle2 size={14} /> Criar Rascunho
                        </button>
                        <button
                          className="btn btn--sm btn--success"
                          disabled={processando || !temVinc}
                          onClick={() => handleConverter(m, true)}
                        >
                          <Send size={14} /> Converter &amp; Liberar
                        </button>
                        <button
                          className="btn btn--sm btn--ghost text-danger"
                          disabled={processando}
                          onClick={async () => {
                            try {
                              await whatsappQueries.ignorar(m.id)
                              toastSuccess('Ignorada', 'Mensagem arquivada como ignorada.')
                              carregar()
                            } catch (err) {
                              toastError('Erro', err.message)
                            }
                          }}
                        >
                          <XCircle size={14} /> Ignorar
                        </button>
                      </div>
                    )}
                  </div>

                  {itens.length > 0 && (
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Texto WhatsApp</th>
                            <th>Produto Reconhecido</th>
                            <th style={{ textAlign: 'right' }}>Qtd</th>
                            <th style={{ textAlign: 'right' }}>R$/kg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itens.map((it, idx) => (
                            <tr key={idx}>
                              <td>
                                <div style={{ fontSize: 12 }}>{it.texto_original}</div>
                                {it.observacao && (
                                  <div className="text-xs" style={{ color: it.alerta_reclamacao ? 'var(--warning)' : 'var(--text-muted)' }}>
                                    {it.alerta_reclamacao && <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />}
                                    {it.observacao}
                                  </div>
                                )}
                              </td>
                              <td>
                                {it.produto_id ? (
                                  <span className="badge badge--success">
                                    [{it.produto_codigo}] {it.produto_descricao}
                                  </span>
                                ) : (
                                  <span className="badge badge--danger">Não vinculado</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }} className="td-mono font-bold">
                                {it.qtd_kg_solicitada} {it.unidade_solicitada}
                              </td>
                              <td style={{ textAlign: 'right' }} className="td-mono">
                                R$ {Number(it.preco_unitario || 0).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
