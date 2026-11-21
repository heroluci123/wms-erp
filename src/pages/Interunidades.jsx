import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  Barcode,
  CheckCircle2,
  Factory,
  FileCheck2,
  History,
  PackageCheck,
  RefreshCw,
  Send,
  Store,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { interunidadesQueries } from '../queries/varejo'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`

const ESPECIE_BADGE = {
  BOVINO: { label: 'BOVINO', bg: 'rgba(239, 68, 68, 0.16)', color: '#f87171', border: 'rgba(239, 68, 68, 0.45)' },
  SUINO: { label: 'SUÍNO', bg: 'rgba(236, 72, 153, 0.16)', color: '#f472b6', border: 'rgba(236, 72, 153, 0.45)' },
  AVES: { label: 'AVES', bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.45)' },
  OUTROS: { label: 'OUTROS', bg: 'rgba(148, 163, 184, 0.16)', color: '#cbd5e1', border: 'rgba(148, 163, 184, 0.4)' },
}

export function Interunidades() {
  const navigate = useNavigate()
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const apiAtiva = isApiEnabled()
  const inputRef = useRef(null)

  const [aba, setAba] = useState('TRANSF_LOJA') // 'TRANSF_LOJA' | 'REMESSA_IND' | 'RETORNO_PROD' | 'FATURAMENTO' | 'HISTORICO'
  const [loading, setLoading] = useState(false)
  const [mapaFiliais, setMapaFiliais] = useState({ loja: null, matriz: null, industria: null })
  const [movimentacoes, setMovimentacoes] = useState([])
  const [lotesDiario, setLotesDiario] = useState([])
  const [selecionadosLotes, setSelecionadosLotes] = useState([])

  // Campos de bipagem rápida
  const [eanInput, setEanInput] = useState('')
  const [especieOverride, setEspecieOverride] = useState('')
  const [enderecoRetorno, setEnderecoRetorno] = useState('EXPEDICAO-MATRIZ')
  const [bipando, setBipando] = useState(false)
  const [ultimoRegistro, setUltimoRegistro] = useState(null)

  // Faturamento diário
  const [dataIniFat, setDataIniFat] = useState('')
  const [dataFimFat, setDataFimFat] = useState('')
  const [emitindoLote, setEmitindoLote] = useState(false)
  const [notasRecemEmitidas, setNotasRecemEmitidas] = useState([])

  const carregar = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [resMapa, resMov, resFat] = await Promise.all([
        interunidadesQueries.obterMapaFiliais(),
        interunidadesQueries.listarMovimentacoes(),
        interunidadesQueries.obterFaturamentoDiario({ data_ini: dataIniFat, data_fim: dataFimFat }),
      ])
      setMapaFiliais({ loja: resMapa.loja, matriz: resMapa.matriz, industria: resMapa.industria })
      setMovimentacoes(resMov.data || [])
      const lotes = resFat.lotes || []
      setLotesDiario(lotes)
      setSelecionadosLotes(lotes.map((l) => l.lote_key))
    } catch (err) {
      toastError('Erro ao carregar Inter-Unidades', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, dataIniFat, dataFimFat, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    if (['TRANSF_LOJA', 'REMESSA_IND', 'RETORNO_PROD'].includes(aba)) {
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [aba])

  const handleBipar = async (e) => {
    e.preventDefault()
    const ean = eanInput.trim()
    if (!ean) return toastWarning('Código obrigatório', 'Bipe ou digite o EAN da caixa.')
    setBipando(true)
    try {
      let res
      if (aba === 'TRANSF_LOJA') {
        res = await interunidadesQueries.biparTransferenciaLoja({ ean_caixa: ean })
        toastSuccess(
          `Transferida p/ Loja 1/1 (${res.data.codigo})`,
          `${res.data.produto_descricao} • ${fmtKg(res.data.peso_kg)} já disponível no Açougue/PDV!`,
        )
      } else if (aba === 'REMESSA_IND') {
        res = await interunidadesQueries.biparRemessaIndustrializacao({
          ean_caixa: ean,
          especie: especieOverride || undefined,
        })
        toastSuccess(
          `Remessa 1/2 → 2/1 [${res.data.especie}]`,
          `${res.data.produto_descricao} • ${fmtKg(res.data.peso_kg)} na fila do Faturamento Diário (CFOP 5901).`,
        )
      } else if (aba === 'RETORNO_PROD') {
        res = await interunidadesQueries.biparRetornoProducao({
          ean_caixa: ean,
          endereco_destino: enderecoRetorno,
        })
        toastSuccess(
          `Retorno 2/1 → 1/2 (${res.data.codigo})`,
          `${res.data.produto_descricao} • ${fmtKg(res.data.peso_kg)} liberado no estoque de vendas da Matriz (sem NF).`,
        )
      }
      setUltimoRegistro({ tipo: aba, ...res.data })
      setEanInput('')
      carregar()
    } catch (err) {
      toastError('Erro ao bipar caixa', err.message)
    } finally {
      setBipando(false)
      setTimeout(() => inputRef.current?.focus(), 40)
    }
  }

  const handleAlterarEspecieMov = async (movId, novaEspecie) => {
    try {
      await interunidadesQueries.editarMovimentacao(movId, { especie: novaEspecie })
      toastSuccess('Espécie atualizada', `Reclassificada para ${novaEspecie}.`)
      carregar()
    } catch (err) {
      toastError('Erro ao reclassificar', err.message)
    }
  }

  const handleEmitirLotesSelecionados = async () => {
    const lotesAlvo = lotesDiario.filter((l) => selecionadosLotes.includes(l.lote_key))
    if (lotesAlvo.length === 0) return toastWarning('Nenhum lote selecionado', 'Marque ao menos um lote para emitir NF-e.')
    setEmitindoLote(true)
    try {
      const res = await interunidadesQueries.emitirFaturamentoDiario(
        lotesAlvo.map((l) => ({ movimentacao_ids: l.movimentacao_ids })),
      )
      setNotasRecemEmitidas(res.notas || [])
      toastSuccess(
        `${res.total_notas_emitidas} NF-e(s) emitida(s) em lote!`,
        'Notas fiscais de remessa/transferência autorizadas sem gerar títulos no Contas a Receber.',
      )
      carregar()
    } catch (err) {
      toastError('Falha ao emitir lotes', err.message)
    } finally {
      setEmitindoLote(false)
    }
  }

  if (!apiAtiva) return <ApiModeRequiredBanner titulo="Central Inter-Unidades (1/2 ↔ 2/1 ↔ 1/1)" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <ArrowLeftRight size={24} className="text-primary" /> Central Inter-Unidades & Faturamento Diário
          </h1>
          <p className="page-header__subtitle">
            Bipagem rápida entre Matriz ({mapaFiliais.matriz?.codigo || '1/2'}), FG Industrialização ({mapaFiliais.industria?.codigo || '2/1'}) e Loja/Açougue ({mapaFiliais.loja?.codigo || '1/1'}) sem travar a operação
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={carregar} disabled={loading}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {/* ABAS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        {[
          { id: 'TRANSF_LOJA', label: '1/2 → 1/1 Transferência Loja', icon: Store },
          { id: 'REMESSA_IND', label: '1/2 → 2/1 Remessa Industrialização', icon: Factory },
          { id: 'RETORNO_PROD', label: '2/1 → 1/2 Retorno p/ Estoque (s/ NF)', icon: PackageCheck },
          { id: 'FATURAMENTO', label: `Faturamento Diário (${lotesDiario.length} lote(s))`, icon: FileCheck2 },
          { id: 'HISTORICO', label: `Histórico (${movimentacoes.length})`, icon: History },
        ].map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              className={`btn ${aba === t.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAba(t.id)}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ABAS DE BIPAGEM RÁPIDA (1/2->1/1 | 1/2->2/1 | 2/1->1/2) */}
      {['TRANSF_LOJA', 'REMESSA_IND', 'RETORNO_PROD'].includes(aba) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            className="card"
            style={{
              padding: 18,
              borderLeft: `4px solid ${aba === 'TRANSF_LOJA' ? '#3b82f6' : aba === 'REMESSA_IND' ? '#f59e0b' : '#22c55e'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div>
              <h2 className="text-base font-bold m-0">
                {aba === 'TRANSF_LOJA' && 'Bipar Caixa — Transferência Matriz (1/2) → Filial Loja / Açougue (1/1)'}
                {aba === 'REMESSA_IND' && 'Bipar Caixa — Remessa p/ Industrialização (1/2 → 2/1 FG Foods)'}
                {aba === 'RETORNO_PROD' && 'Bipar Caixa — Retorno Produção → Estoque de Vendas Matriz (2/1 → 1/2)'}
              </h2>
              <p className="text-xs text-muted m-0" style={{ marginTop: 4 }}>
                {aba === 'TRANSF_LOJA' &&
                  'Sai da câmara fria da Matriz e soma o peso real imediatamente no Estoque da Loja (1/1) para venda no PDV. Acumula para NF-e CFOP 5152 no Faturamento Diário.'}
                {aba === 'REMESSA_IND' &&
                  'Libera a matéria-prima na hora para a OP na 2/1 e separa automaticamente em BOVINO, SUÍNO e AVES no Faturamento Diário (CFOP 5901). Dica: se bipar uma caixa da 1/2 direto na OP da 2/1, ela também cai nessa fila automaticamente!'}
                {aba === 'RETORNO_PROD' &&
                  'Não precisa esperar a OP finalizar! Basta bipar o código de barras da caixa produzida na 2/1 que ela entra imediatamente no estoque da Matriz (1/2) pronta para Pedidos de Venda. Movimento operacional sem faturamento.'}
              </p>
            </div>

            <form onSubmit={handleBipar} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 300px' }}>
                <label className="form-label">Código de Barras (EAN) da Caixa *</label>
                <div style={{ position: 'relative' }}>
                  <Barcode
                    size={18}
                    style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#60a5fa' }}
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    className="form-input font-mono"
                    style={{ paddingLeft: 38, height: 44, fontSize: 15, fontWeight: 700 }}
                    value={eanInput}
                    onChange={(e) => setEanInput(e.target.value)}
                    placeholder="Bipe ou digite o EAN da caixa..."
                  />
                </div>
              </div>

              {aba === 'REMESSA_IND' && (
                <div style={{ width: 190 }}>
                  <label className="form-label">Espécie (Auto se vazio)</label>
                  <select
                    className="form-input"
                    style={{ height: 44 }}
                    value={especieOverride}
                    onChange={(e) => setEspecieOverride(e.target.value)}
                  >
                    <option value="">Automático (Grupo/NCM)</option>
                    <option value="BOVINO">BOVINO</option>
                    <option value="SUINO">SUÍNO</option>
                    <option value="AVES">AVES</option>
                    <option value="OUTROS">OUTROS</option>
                  </select>
                </div>
              )}

              {aba === 'RETORNO_PROD' && (
                <div style={{ width: 210 }}>
                  <label className="form-label">Endereço Destino na 1/2</label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    style={{ height: 44 }}
                    value={enderecoRetorno}
                    onChange={(e) => setEnderecoRetorno(e.target.value)}
                  />
                </div>
              )}

              <button type="submit" className="btn btn--primary" style={{ height: 44, padding: '0 22px' }} disabled={bipando}>
                <Send size={15} /> {bipando ? 'Registrando...' : 'Confirmar Bipagem'}
              </button>
            </form>

            {ultimoRegistro && ultimoRegistro.tipo === aba && (
              <div
                style={{
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.45)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 12,
                  color: '#4ade80',
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span>
                  <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  <strong>{ultimoRegistro.codigo}</strong> • EAN <span className="font-mono">{ultimoRegistro.ean_caixa}</span> •{' '}
                  {ultimoRegistro.produto_descricao} • <strong>{fmtKg(ultimoRegistro.peso_kg)}</strong>
                </span>
                <span className="font-mono">
                  Destino: <strong>{ultimoRegistro.filial_destino}</strong>
                </span>
              </div>
            )}
          </div>

          {/* LISTA RECENTE DESTA OPERAÇÃO */}
          <div className="card" style={{ padding: 16 }}>
            <h3 className="text-sm font-bold m-0 mb-12">Últimas caixas bipadas nesta operação</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>EAN Caixa</th>
                    <th>Produto</th>
                    <th>Espécie</th>
                    <th style={{ textAlign: 'right' }}>Peso</th>
                    <th>Status Fiscal</th>
                    <th>Operador / Data</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoes
                    .filter((m) =>
                      aba === 'TRANSF_LOJA'
                        ? m.tipo_operacao === 'TRANSFERENCIA_LOJA'
                        : aba === 'REMESSA_IND'
                          ? m.tipo_operacao === 'REMESSA_IND'
                          : m.tipo_operacao === 'RETORNO_PROD',
                    )
                    .slice(0, 25)
                    .map((m) => {
                      const esp = ESPECIE_BADGE[m.especie] || ESPECIE_BADGE.OUTROS
                      return (
                        <tr key={m.id}>
                          <td className="font-mono font-bold text-xs">{m.codigo}</td>
                          <td className="font-mono text-xs">{m.ean_caixa}</td>
                          <td className="text-xs font-bold">{m.produto_descricao}</td>
                          <td>
                            <span
                              className="badge"
                              style={{ background: esp.bg, color: esp.color, border: `1px solid ${esp.border}` }}
                            >
                              {esp.label}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                            {fmtKg(m.peso_kg)}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                m.status_fiscal === 'FATURADO'
                                  ? 'badge--success'
                                  : m.status_fiscal === 'NAO_FATURAVEL'
                                    ? 'badge--neutral'
                                    : 'badge--warning'
                              }`}
                            >
                              {m.status_fiscal === 'FATURADO'
                                ? `NF #${m.numero_nf}`
                                : m.status_fiscal === 'NAO_FATURAVEL'
                                  ? 'Operacional (s/ NF)'
                                  : 'Aguard. Fat. Diário'}
                            </span>
                          </td>
                          <td className="text-xs text-muted">
                            {m.operador_nome} • {new Date(m.created_at).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 4: FATURAMENTO DIÁRIO CONSOLIDADO (BOVINO / SUÍNO / AVES + TRANSFERÊNCIA LOJA) */}
      {aba === 'FATURAMENTO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            className="card"
            style={{
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h2 className="text-base font-bold m-0">Fechamento & Faturamento Fiscal Diário (em Lote)</h2>
              <p className="text-xs text-muted m-0" style={{ marginTop: 4 }}>
                Lotes consolidados automaticamente por Espécie (<strong>Bovino, Suíno e Aves — CFOP 5901</strong>) e{' '}
                <strong>Transferência Loja (CFOP 5152)</strong>. Emitir aqui <strong>não gera Contas a Receber</strong> nem suja vendas comerciais!
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                className="form-input font-mono"
                style={{ width: 145, height: 34 }}
                value={dataIniFat}
                onChange={(e) => setDataIniFat(e.target.value)}
              />
              <span className="text-xs text-muted">até</span>
              <input
                type="date"
                className="form-input font-mono"
                style={{ width: 145, height: 34 }}
                value={dataFimFat}
                onChange={(e) => setDataFimFat(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--success"
                disabled={emitindoLote || selecionadosLotes.length === 0}
                onClick={handleEmitirLotesSelecionados}
              >
                <FileCheck2 size={15} />{' '}
                {emitindoLote ? 'Emitindo...' : `Emitir NF-es do Dia (${selecionadosLotes.length} lote(s))`}
              </button>
            </div>
          </div>

          {notasRecemEmitidas.length > 0 && (
            <div
              className="card"
              style={{
                padding: 14,
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1.5px solid #22c55e',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div>
                <div className="font-bold text-sm" style={{ color: '#4ade80' }}>
                  {notasRecemEmitidas.length} NF-e(s) emitida(s) com sucesso!
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  {notasRecemEmitidas
                    .map((n) => `NF #${n.numero} (${n.cfop} • ${n.especie} • ${fmtKg(n.peso_total_kg)})`)
                    .join(' | ')}
                </div>
              </div>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/fiscal?aba=NOTAS')}>
                Ver Notas Emitidas / DANFE
              </button>
            </div>
          )}

          {lotesDiario.length === 0 ? (
            <div className="card text-center text-muted" style={{ padding: 36 }}>
              Nenhuma remessa ou transferência pendente de faturamento neste período.
            </div>
          ) : (
            lotesDiario.map((lote) => {
              const esp = ESPECIE_BADGE[lote.especie] || ESPECIE_BADGE.OUTROS
              const marcado = selecionadosLotes.includes(lote.lote_key)
              return (
                <div
                  key={lote.lote_key}
                  className="card"
                  style={{
                    padding: 16,
                    border: marcado ? `1.5px solid ${esp.border}` : '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelecionadosLotes((prev) => Array.from(new Set([...prev, lote.lote_key])))
                          } else {
                            setSelecionadosLotes((prev) => prev.filter((k) => k !== lote.lote_key))
                          }
                        }}
                      />
                      <div>
                        <div className="font-bold text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>{lote.titulo}</span>
                          <span className="badge badge--info font-mono">CFOP {lote.cfop}</span>
                          {lote.tipo_operacao === 'REMESSA_IND' && (
                            <span
                              className="badge"
                              style={{ background: esp.bg, color: esp.color, border: `1px solid ${esp.border}` }}
                            >
                              {esp.label}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                          Origem: {lote.filial_origem_label} → Destino: {lote.filial_destino_label}
                        </div>
                      </div>
                    </label>

                    <div style={{ textAlign: 'right' }}>
                      <div className="font-mono font-bold text-sm">
                        {lote.qtd_caixas} caixa(s) • {fmtKg(lote.peso_total_kg)}
                      </div>
                      <div className="font-mono text-xs text-success font-bold">
                        Valor Remessa/Custo: {fmtMoeda(lote.valor_total)}
                      </div>
                    </div>
                  </div>

                  {/* RESUMO CONSOLIDADO POR PRODUTO + RECLASSIFICAÇÃO RÁPIDA DE ESPÉCIE */}
                  <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Cód</th>
                          <th>Produto</th>
                          <th style={{ textAlign: 'right' }}>Caixas</th>
                          <th style={{ textAlign: 'right' }}>Peso Total</th>
                          <th style={{ textAlign: 'right' }}>Custo/kg</th>
                          <th style={{ textAlign: 'right' }}>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lote.itens_consolidados.map((it) => (
                          <tr key={it.produto_id}>
                            <td className="font-mono text-xs">{it.produto_codigo}</td>
                            <td className="font-bold text-xs">{it.produto_descricao}</td>
                            <td style={{ textAlign: 'right' }} className="font-mono text-xs">{it.qtd_caixas}</td>
                            <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">{fmtKg(it.peso_kg)}</td>
                            <td style={{ textAlign: 'right' }} className="font-mono text-xs">{fmtMoeda(it.valor_unitario_kg)}</td>
                            <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold text-success">
                              {fmtMoeda(it.valor_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {lote.tipo_operacao === 'REMESSA_IND' && (
                    <details style={{ fontSize: 12 }}>
                      <summary className="text-muted" style={{ cursor: 'pointer' }}>
                        Ver / reclassificar espécie das {lote.movimentacoes.length} caixa(s) deste lote
                      </summary>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {lote.movimentacoes.map((m) => (
                          <div
                            key={m.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '4px 8px',
                              background: 'var(--bg-2)',
                              borderRadius: 4,
                            }}
                          >
                            <span className="font-mono text-xs">
                              {m.codigo} • {m.ean_caixa} • {m.produto_descricao} ({fmtKg(m.peso_kg)})
                            </span>
                            <select
                              className="form-input"
                              style={{ width: 120, height: 28, fontSize: 11 }}
                              value={m.especie}
                              onChange={(e) => handleAlterarEspecieMov(m.id, e.target.value)}
                            >
                              <option value="BOVINO">BOVINO</option>
                              <option value="SUINO">SUÍNO</option>
                              <option value="AVES">AVES</option>
                              <option value="OUTROS">OUTROS</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ABA 5: HISTÓRICO COMPLETO */}
      {aba === 'HISTORICO' && (
        <div className="card" style={{ padding: 16 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Operação</th>
                  <th>Origem → Destino</th>
                  <th>EAN / Produto</th>
                  <th>Espécie</th>
                  <th style={{ textAlign: 'right' }}>Peso</th>
                  <th>Fiscal</th>
                </tr>
              </thead>
              <tbody>
                {movimentacoes.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs font-bold">{m.codigo}</td>
                    <td className="text-xs">{m.tipo_operacao}</td>
                    <td className="text-xs text-muted">
                      {m.filial_origem_label} → {m.filial_destino_label}
                    </td>
                    <td className="text-xs">
                      <div className="font-bold">{m.produto_descricao}</div>
                      <div className="font-mono text-muted">{m.ean_caixa}</div>
                    </td>
                    <td className="text-xs font-bold">{m.especie}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">{fmtKg(m.peso_kg)}</td>
                    <td className="text-xs">
                      {m.status_fiscal === 'FATURADO'
                        ? `NF #${m.numero_nf}`
                        : m.status_fiscal === 'NAO_FATURAVEL'
                          ? 'Sem NF (Operacional)'
                          : 'Pendente Fat.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
