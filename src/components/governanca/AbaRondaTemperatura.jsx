import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Plus,
  RefreshCw,
  Snowflake,
  Thermometer,
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { governancaQueries } from '../../queries/governanca'
import * as locaisQueries from '../../queries/locais'

const FAIXAS_UI = {
  RESFRIADO: { label: 'Câmara Resfriada (-1°C a +7°C)', min: -1, max: 7 },
  CONGELADO: { label: 'Câmara Congelada (-25°C a -12°C)', min: -25, max: -12 },
  CLIMATIZADO: { label: 'Sala Desossa / Climatizada (+4°C a +12°C)', min: 4, max: 12 },
  BALCAO_ACOUGUE: { label: 'Balcão / Expositor Açougue (0°C a +7°C)', min: 0, max: 7 },
  VEICULO: { label: 'Baú / Caminhão Frigorífico (-18°C a +7°C)', min: -18, max: 7 },
}

const fmtDataHora = (iso) => {
  if (!iso) return '-'
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime())
    ? String(iso)
    : dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function AbaRondaTemperatura() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [dias, setDias] = useState(7)
  const [dados, setDados] = useState({ semaforo_locais: [], historico: [], resumo: {} })
  const [locaisSugestoes, setLocaisSugestoes] = useState([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const [form, setForm] = useState({
    local_nome: '',
    tipo_ambiente: 'RESFRIADO',
    temperatura_c: '',
    temp_min_c: '-1',
    temp_max_c: '7',
    acao_corretiva: '',
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [res, locs] = await Promise.all([
        governancaQueries.listarTemperatura(dias),
        locaisQueries.listar().catch(() => []),
      ])
      setDados(res || { semaforo_locais: [], historico: [], resumo: {} })
      const nomesLoc = Array.from(
        new Set([
          'CAMARA-RESFRIADA-01',
          'CAMARA-CONGELADA-01',
          'SALA-DESOSSA',
          'BALCAO-ACOUGUE',
          'DOCA-EXPEDICAO',
          ...(locs || []).map((l) => String(l.endereco || '').trim().toUpperCase()).filter(Boolean),
        ]),
      )
      setLocaisSugestoes(nomesLoc)
    } catch (err) {
      toastError('Erro ao carregar ronda de temperatura', err.message)
    } finally {
      setLoading(false)
    }
  }, [dias, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const handleTrocarTipo = (novoTipo) => {
    const f = FAIXAS_UI[novoTipo] || FAIXAS_UI.RESFRIADO
    setForm((prev) => ({
      ...prev,
      tipo_ambiente: novoTipo,
      temp_min_c: String(f.min),
      temp_max_c: String(f.max),
    }))
  }

  const tempNum = Number(String(form.temperatura_c).replace(',', '.'))
  const minNum = Number(String(form.temp_min_c).replace(',', '.'))
  const maxNum = Number(String(form.temp_max_c).replace(',', '.'))
  const previewForaFaixa =
    form.temperatura_c !== '' &&
    Number.isFinite(tempNum) &&
    Number.isFinite(minNum) &&
    Number.isFinite(maxNum) &&
    (tempNum < minNum || tempNum > maxNum)

  const handleSalvar = async (e) => {
    e.preventDefault()
    if (!form.local_nome.trim()) return toastWarning('Informe a câmara ou local aferido.')
    if (form.temperatura_c === '' || !Number.isFinite(tempNum)) {
      return toastWarning('Informe a temperatura medida em °C.')
    }
    setSalvando(true)
    try {
      const res = await governancaQueries.registrarTemperatura({
        local_nome: form.local_nome.trim(),
        tipo_ambiente: form.tipo_ambiente,
        temperatura_c: tempNum,
        temp_min_c: minNum,
        temp_max_c: maxNum,
        acao_corretiva: form.acao_corretiva.trim(),
      })
      if (res.data?.conforme) {
        toastSuccess(
          `Temperatura registrada: ${res.data.local_nome} (${res.data.temperatura_c}°C)`,
          'Dentro da faixa de segurança SIF.',
        )
      } else {
        toastWarning(
          `ALERTA CADEIA DE FRIO: ${res.data.local_nome} (${res.data.temperatura_c}°C)!`,
          'Desvio registrado no Radar Antifraude & Auditoria.',
        )
      }
      setForm((prev) => ({ ...prev, temperatura_c: '', acao_corretiva: '' }))
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar leitura', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const exportarCsvSif = () => {
    const hist = dados.historico || []
    if (hist.length === 0) return toastWarning('Não há leituras no período para exportar.')
    const header = [
      'Data/Hora',
      'Local/Camara',
      'Tipo Ambiente',
      'Temp Medida (C)',
      'Min (C)',
      'Max (C)',
      'Status SIF',
      'Desvio (C)',
      'Acao Corretiva',
      'Operador',
    ].join(';')
    const lines = hist.map((r) =>
      [
        fmtDataHora(r.created_at),
        r.local_nome,
        r.tipo_ambiente,
        String(r.temperatura_c).replace('.', ','),
        String(r.temp_min_c).replace('.', ','),
        String(r.temp_max_c).replace('.', ','),
        r.conforme ? 'CONFORME' : 'FORA_DA_FAIXA',
        String(r.desvio_c).replace('.', ','),
        `"${String(r.acao_corretiva || '').replace(/"/g, '""')}"`,
        `"${String(r.operador_nome || '').replace(/"/g, '""')}"`,
      ].join(';'),
    )
    const blob = new Blob(['\uFEFF' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `laudo_ronda_temperatura_${dias}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const r = dados.resumo || {}

  return (
    <div className="flex flex-col gap-16">
      {/* KPIs */}
      <div className="grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-xs text-muted uppercase font-bold">Conformidade Cadeia de Frio</div>
          <div className={`text-2xl font-mono font-bold mt-4 ${(r.conformidade_pct ?? 100) >= 95 ? 'text-success' : 'text-danger'}`}>
            {(r.conformidade_pct ?? 100).toFixed(1)}%
          </div>
          <div className="text-xs text-muted mt-2">{r.leituras_conformes || 0} de {r.total_leituras || 0} leituras OK</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-xs text-muted uppercase font-bold">Alertas Fora da Faixa</div>
          <div className={`text-2xl font-mono font-bold mt-4 ${(r.alertas_fora_faixa || 0) > 0 ? 'text-danger' : 'text-success'}`}>
            {r.alertas_fora_faixa || 0}
          </div>
          <div className="text-xs text-muted mt-2">Últimos {dias} dias</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="text-xs text-muted uppercase font-bold">Locais Monitorados</div>
          <div className="text-2xl font-mono font-bold text-info mt-4">{r.locais_monitorados || 0}</div>
          <div className="text-xs text-muted mt-2">Câmaras, balcões e salas</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: (r.locais_em_alerta || 0) > 0 ? 'rgba(239,68,68,0.6)' : undefined }}>
          <div className="text-xs text-muted uppercase font-bold">Locais em Alerta Agora</div>
          <div className={`text-2xl font-mono font-bold mt-4 ${(r.locais_em_alerta || 0) > 0 ? 'text-danger' : 'text-success'}`}>
            {r.locais_em_alerta || 0}
          </div>
          <div className="text-xs text-muted mt-2">Última aferição fora do padrão</div>
        </div>
      </div>

      {/* FORMULÁRIO RÁPIDO DE RONDA (DESKTOP & MOBILE) */}
      <form onSubmit={handleSalvar} className="card" style={{ padding: 18 }}>
        <div className="flex justify-between items-center flex-wrap gap-10 mb-14">
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }} className="flex items-center gap-8">
              <Thermometer size={18} className="text-info" /> Registrar Ronda de Temperatura (°C)
            </h3>
            <div className="text-xs text-muted mt-2">
              Recomendado 3× ao dia (manhã, tarde e fechamento). Qualquer leitura fora da faixa SIF gera alerta imediato no Radar Antifraude.
            </div>
          </div>
          <div className="flex items-center gap-8">
            <select
              className="form-input"
              style={{ width: 135, height: 36 }}
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
            >
              <option value={1}>Últimas 24h</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
            <button type="button" className="btn btn--secondary btn--sm" onClick={exportarCsvSif}>
              <Download size={14} /> Laudo CSV (SIF)
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={carregar} disabled={loading}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label className="form-label">Câmara / Balcão / Local *</label>
            <input
              list="locais-ronda-temp"
              className="form-input"
              placeholder="Ex: CAMARA-RESFRIADA-01"
              value={form.local_nome}
              onChange={(e) => setForm((f) => ({ ...f, local_nome: e.target.value.toUpperCase() }))}
              required
            />
            <datalist id="locais-ronda-temp">
              {locaisSugestoes.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="form-label">Tipo de Ambiente (Faixa SIF)</label>
            <select
              className="form-input"
              value={form.tipo_ambiente}
              onChange={(e) => handleTrocarTipo(e.target.value)}
            >
              {Object.entries(FAIXAS_UI).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">Temperatura Medida (°C) *</label>
            <input
              type="number"
              step="0.1"
              required
              className="form-input font-mono font-bold"
              placeholder="Ex: 2.4 ou -18.5"
              value={form.temperatura_c}
              onChange={(e) => setForm((f) => ({ ...f, temperatura_c: e.target.value }))}
              style={{
                borderColor: previewForaFaixa ? '#ef4444' : undefined,
                color: previewForaFaixa ? '#f87171' : undefined,
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div>
              <label className="form-label">Mín (°C)</label>
              <input
                type="number"
                step="0.5"
                className="form-input font-mono"
                value={form.temp_min_c}
                onChange={(e) => setForm((f) => ({ ...f, temp_min_c: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label">Máx (°C)</label>
              <input
                type="number"
                step="0.5"
                className="form-input font-mono"
                value={form.temp_max_c}
                onChange={(e) => setForm((f) => ({ ...f, temp_max_c: e.target.value }))}
              />
            </div>
          </div>

          <button type="submit" className={`btn ${previewForaFaixa ? 'btn--danger' : 'btn--primary'}`} disabled={salvando}>
            <Plus size={15} /> {salvando ? 'Gravando...' : previewForaFaixa ? 'Gravar Alerta' : 'Gravar Leitura'}
          </button>
        </div>

        {previewForaFaixa && (
          <div className="mt-10 p-10 rounded" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.45)' }}>
            <div className="text-xs font-bold text-danger flex items-center gap-6 mb-6">
              <AlertTriangle size={14} /> TEMPERATURA FORA DA FAIXA SIF ({form.temp_min_c}°C a {form.temp_max_c}°C)! Informe a ação corretiva:
            </div>
            <input
              className="form-input"
              placeholder="Ex: Acionado técnico de refrigeração, porta vedada, carga transferida para Câmara 02..."
              value={form.acao_corretiva}
              onChange={(e) => setForm((f) => ({ ...f, acao_corretiva: e.target.value }))}
            />
          </div>
        )}
      </form>

      {/* SEMÁFORO AO VIVO DAS CÂMARAS */}
      {(dados.semaforo_locais || []).length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase text-muted mb-8 flex items-center gap-6">
            <Snowflake size={14} className="text-info" /> Semáforo em Tempo Real por Câmara / Ambiente
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {dados.semaforo_locais.map((s) => (
              <div
                key={s.local_nome}
                className="card"
                style={{
                  padding: 14,
                  borderColor: s.conforme ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.7)',
                  background: s.conforme ? 'rgba(15,23,42,0.8)' : 'rgba(239,68,68,0.08)',
                }}
              >
                <div className="flex justify-between items-start gap-8">
                  <div>
                    <div className="font-bold text-sm">{s.local_nome}</div>
                    <div className="text-xs text-muted">{s.tipo_ambiente}</div>
                  </div>
                  <span className={`badge ${s.conforme ? 'badge--success' : 'badge--danger'}`}>
                    {s.conforme ? 'OK' : `DESVIO ${s.desvio_c > 0 ? '+' : ''}${s.desvio_c}°C`}
                  </span>
                </div>
                <div className={`text-2xl font-mono font-bold mt-8 ${s.conforme ? 'text-success' : 'text-danger'}`}>
                  {s.ultima_temp_c.toFixed(1)}°C
                </div>
                <div className="text-xs text-muted mt-4">
                  Faixa: {s.temp_min_c}°C a {s.temp_max_c}°C • Há {s.horas_desde_leitura}h ({s.operador_nome})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HISTÓRICO COMPLETO */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-14" style={{ borderBottom: '1px solid var(--border)' }}>
          <strong className="text-sm">Histórico de Rondas ({(dados.historico || []).length} registros)</strong>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data / Hora</th>
                <th>Local / Câmara</th>
                <th>Ambiente</th>
                <th style={{ textAlign: 'right' }}>Medida</th>
                <th style={{ textAlign: 'right' }}>Faixa SIF</th>
                <th>Status</th>
                <th>Ação Corretiva / Obs</th>
                <th>Operador</th>
              </tr>
            </thead>
            <tbody>
              {(dados.historico || []).length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center p-24 text-muted">
                    Nenhuma ronda de temperatura registrada nos últimos {dias} dias. Use o formulário acima para registrar a primeira aferição!
                  </td>
                </tr>
              ) : (
                dados.historico.map((h) => (
                  <tr key={h.id}>
                    <td className="font-mono text-xs">{fmtDataHora(h.created_at)}</td>
                    <td className="font-bold">{h.local_nome}</td>
                    <td className="text-xs text-muted">{h.tipo_ambiente}</td>
                    <td className={`font-mono font-bold text-right ${h.conforme ? 'text-success' : 'text-danger'}`}>
                      {h.temperatura_c.toFixed(1)}°C
                    </td>
                    <td className="font-mono text-xs text-right text-muted">
                      {h.temp_min_c}°C a {h.temp_max_c}°C
                    </td>
                    <td>
                      {h.conforme ? (
                        <span className="badge badge--success">
                          <CheckCircle2 size={11} /> Conforme
                        </span>
                      ) : (
                        <span className="badge badge--danger">
                          <AlertTriangle size={11} /> Fora ({h.desvio_c > 0 ? '+' : ''}{h.desvio_c}°C)
                        </span>
                      )}
                    </td>
                    <td className="text-xs">{h.acao_corretiva || '-'}</td>
                    <td className="text-xs text-muted">{h.operador_nome || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
