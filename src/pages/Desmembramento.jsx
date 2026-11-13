import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Scissors, ScanBarcode, Plus, Trash2, Lock, CheckCircle2,
  AlertTriangle, History, Printer, RefreshCw, Package, Scale
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as desmembramentoQueries from '../queries/desmembramento'
import { tarasQueries } from '../queries/taras'
import { resolverTaraSelecionada } from '../components/shared/PesagemTaraFields'
import EtiquetaZebraModal from '../components/shared/EtiquetaZebraPrint'
import {
  calcularPesoLiquido,
  fmtDataBR,
  fmtDataHoraBR,
  fmtKg2,
  fmtKg3,
  parseNumero,
} from '../utils/rastreabilidade'

function criarNovaCaixaVazia(taras) {
  const padrao = resolverTaraSelecionada(taras, '')
  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tara_id: padrao ? String(padrao.id) : '',
    peso_bruto: '',
    qtd_pecas: '',
  }
}

export function Desmembramento() {
  const { operador, toastError, toastSuccess, toastWarning } = useAppStore()

  const [aba, setAba] = useState('operacao') // 'operacao' | 'historico'
  const [taras, setTaras] = useState([])

  // Etapa 1: caixa original única
  const [scanInput, setScanInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [caixaOrigem, setCaixaOrigem] = useState(null)

  // Etapa 2: 2 ou mais novas caixas
  const [novasCaixas, setNovasCaixas] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [modalDivergencia, setModalDivergencia] = useState(null)
  const [motivoDiferencaPecas, setMotivoDiferencaPecas] = useState('')

  // Impressão Zebra 100x70mm após desmembramento ou histórico
  const [etiquetasModal, setEtiquetasModal] = useState({ open: false, itens: [], autoPrint: false, titulo: '' })

  // Histórico
  const [historico, setHistorico] = useState([])
  const [loadingHist, setLoadingHist] = useState(false)

  const scanRef = useRef(null)

  useEffect(() => {
    tarasQueries.listar(true).then((lista) => {
      setTaras(lista)
      setNovasCaixas([criarNovaCaixaVazia(lista), criarNovaCaixaVazia(lista)])
    }).catch(() => {
      setNovasCaixas([criarNovaCaixaVazia([]), criarNovaCaixaVazia([])])
    })
    setTimeout(() => scanRef.current?.focus(), 100)
  }, [])

  const carregarHistorico = async () => {
    setLoadingHist(true)
    try {
      const lista = await desmembramentoQueries.listarDesmembramentosRecentes(60)
      setHistorico(lista)
    } catch (err) {
      toastError('Erro', `Falha ao carregar histórico: ${err.message}`)
    } finally {
      setLoadingHist(false)
    }
  }

  const handleIdentificarOrigem = async (e) => {
    e?.preventDefault()
    const ean = scanInput.trim()
    if (!ean) return
    setBuscando(true)
    try {
      const res = await desmembramentoQueries.validarCaixa(ean)
      if (!res.valid) {
        toastError('Caixa indisponível', res.error)
        setScanInput('')
        setTimeout(() => scanRef.current?.focus(), 80)
        return
      }
      setCaixaOrigem(res.caixa)
      setNovasCaixas([criarNovaCaixaVazia(taras), criarNovaCaixaVazia(taras)])
      toastSuccess('Caixa Original Identificada', `${res.caixa.produto_descricao} — ${fmtKg2(res.caixa.peso_kg)}`)
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setBuscando(false)
    }
  }

  const limparOperacao = () => {
    setCaixaOrigem(null)
    setScanInput('')
    setNovasCaixas([criarNovaCaixaVazia(taras), criarNovaCaixaVazia(taras)])
    setModalDivergencia(null)
    setMotivoDiferencaPecas('')
    setTimeout(() => scanRef.current?.focus(), 100)
  }

  const adicionarNovaCaixaRow = () => {
    setNovasCaixas(prev => [...prev, criarNovaCaixaVazia(taras)])
  }

  const removerNovaCaixaRow = (uid) => {
    if (novasCaixas.length <= 2) {
      toastWarning('Mínimo 2 caixas', 'O desmembramento precisa gerar pelo menos 2 novas caixas.')
      return
    }
    setNovasCaixas(prev => prev.filter(c => c.uid !== uid))
  }

  const atualizarNovaCaixa = (uid, patch) => {
    setNovasCaixas(prev => prev.map(c => (c.uid === uid ? { ...c, ...patch } : c)))
  }

  const caixasCalculadas = useMemo(() => {
    return novasCaixas.map((row, idx) => {
      const taraObj = resolverTaraSelecionada(taras, row.tara_id)
      const taraKg = taraObj ? Number(taraObj.peso_kg || 0) : 0
      const brutoNum = parseNumero(row.peso_bruto)
      const liqNum = Number.isFinite(brutoNum) ? calcularPesoLiquido(brutoNum, taraKg) : NaN
      const pecasNum = parseNumero(row.qtd_pecas)
      const pecasInt = Number.isFinite(pecasNum) ? Math.trunc(pecasNum) : NaN
      const pecasValido = Number.isFinite(pecasNum) && pecasInt > 0 && pecasInt === pecasNum
      const valido = Number.isFinite(brutoNum) && brutoNum > 0 && Number.isFinite(liqNum) && liqNum > 0 && pecasValido
      return {
        ...row,
        idx,
        tara_id: taraObj ? String(taraObj.id) : '',
        tara_nome: taraObj?.nome || 'Tara padrão',
        tara_kg: taraKg,
        peso_bruto_kg: brutoNum,
        peso_liquido_kg: liqNum,
        qtd_pecas_int: pecasValido ? pecasInt : null,
        pecasValido,
        valido,
      }
    })
  }, [novasCaixas, taras])

  const resumoBalanco = useMemo(() => {
    const origLiq = Number(caixaOrigem?.peso_kg || 0)
    const somaBruto = caixasCalculadas.reduce((acc, c) => acc + (Number.isFinite(c.peso_bruto_kg) && c.peso_bruto_kg > 0 ? c.peso_bruto_kg : 0), 0)
    const somaLiq = caixasCalculadas.reduce((acc, c) => acc + (Number.isFinite(c.peso_liquido_kg) && c.peso_liquido_kg > 0 ? c.peso_liquido_kg : 0), 0)
    const diferenca = Number((somaLiq - origLiq).toFixed(3))
    const origPecas = caixaOrigem?.qtd_pecas != null && Number(caixaOrigem.qtd_pecas) > 0 ? Math.trunc(Number(caixaOrigem.qtd_pecas)) : null
    const somaPecas = caixasCalculadas.reduce((acc, c) => acc + (c.qtd_pecas_int || 0), 0)
    const difPecas = origPecas != null ? somaPecas - origPecas : 0
    const todasValidas = caixasCalculadas.length >= 2 && caixasCalculadas.every(c => c.valido)
    return { origLiq, somaBruto, somaLiq, diferenca, origPecas, somaPecas, difPecas, todasValidas }
  }, [caixaOrigem, caixasCalculadas])

  const solicitarConfirmacao = () => {
    if (!caixaOrigem) return toastWarning('Atenção', 'Bipe primeiro a caixa original.')
    if (caixasCalculadas.length < 2) return toastWarning('Mínimo 2 caixas', 'Adicione ao menos 2 novas caixas.')

    const invalidIdx = caixasCalculadas.findIndex(c => !c.valido)
    if (invalidIdx !== -1) {
      const cxInv = caixasCalculadas[invalidIdx]
      if (!cxInv.pecasValido) {
        return toastWarning(
          `Nova Caixa #${invalidIdx + 1} incompleta`,
          'Informe a Quantidade de Peças (número inteiro maior que zero).'
        )
      }
      return toastWarning(
        `Nova Caixa #${invalidIdx + 1} incompleta`,
        'Informe um Peso Bruto maior que a Tara selecionada para todas as caixas.'
      )
    }

    const difPesoSignificativa = Math.abs(resumoBalanco.diferenca) > 1.0
    const difPecasSignificativa = resumoBalanco.origPecas != null && resumoBalanco.difPecas !== 0

    if (difPesoSignificativa || difPecasSignificativa) {
      setModalDivergencia({
        origLiq: resumoBalanco.origLiq,
        somaLiq: resumoBalanco.somaLiq,
        diferenca: resumoBalanco.diferenca,
        origPecas: resumoBalanco.origPecas,
        somaPecas: resumoBalanco.somaPecas,
        difPecas: resumoBalanco.difPecas,
      })
      return
    }

    executarDesmembramento()
  }

  const executarDesmembramento = async () => {
    setModalDivergencia(null)
    setSalvando(true)
    try {
      const res = await desmembramentoQueries.desmembrarCaixas({
        caixaOrigem,
        novasCaixas: caixasCalculadas.map(c => ({
          tara_id: c.tara_id,
          tara_kg: c.tara_kg,
          peso_bruto_kg: c.peso_bruto_kg,
          qtd_pecas: c.qtd_pecas_int,
        })),
        motivoDiferencaPecas: motivoDiferencaPecas.trim(),
        operador_id: operador?.id,
        operador_nome: operador?.nome || 'Operador',
      })

      if (!res.success) {
        toastError('Erro ao desmembrar', res.error)
        return
      }

      toastSuccess(
        'Desmembramento Concluído!',
        `${res.caixas_geradas.length} novas caixas com EANs próprios geradas (${res.codigo_operacao}).`
      )

      setEtiquetasModal({
        open: true,
        itens: res.caixas_geradas,
        autoPrint: true,
        titulo: `Etiquetas Geradas — Desmembramento ${res.codigo_operacao}`,
      })
      limparOperacao()
    } catch (err) {
      toastError('Erro fatal', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const reimprimirVinculo = async (v) => {
    try {
      const caixa = await tarasQueries.buscarCaixaParaReimpressao(v.ean_destino)
      await tarasQueries.registrarReimpressaoHistorico({
        caixa_id: caixa.id,
        ean_caixa: caixa.ean_caixa,
        origem_tipo: caixa.origem_tipo || 'DESMEMBRAMENTO',
        operador_nome: operador?.nome || 'Operador',
      })
      setEtiquetasModal({
        open: true,
        itens: [caixa],
        autoPrint: true,
        titulo: `Reimpressão — EAN ${caixa.ean_caixa}`,
      })
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-header__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scissors size={24} color="var(--cyan)" /> Desmembramento de Caixas
          </h1>
          <p className="page-header__subtitle">
            Bipe a caixa original, pese as novas frações por Tara + Peso Bruto e imprima automaticamente os novos EANs (100×70mm).
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`btn ${aba === 'operacao' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setAba('operacao')}
          >
            <Scissors size={16} /> Desmembrar Caixa
          </button>
          <button
            type="button"
            className={`btn ${aba === 'historico' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => { setAba('historico'); carregarHistorico() }}
          >
            <History size={16} /> Histórico de Desmembramentos
          </button>
        </div>
      </div>

      {aba === 'operacao' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* ETAPA 1 — IDENTIFICAÇÃO DA CAIXA ORIGINAL */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--cyan)' }}>
                Etapa 1 — Identificação da Caixa Original
              </h3>
              {caixaOrigem && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={limparOperacao}>
                  <RefreshCw size={14} /> Trocar Caixa
                </button>
              )}
            </div>

            {!caixaOrigem ? (
              <form onSubmit={handleIdentificarOrigem} style={{ display: 'flex', gap: 10 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <ScanBarcode size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--cyan)' }} />
                  <input
                    ref={scanRef}
                    type="text"
                    className="form-input form-input--scanner"
                    style={{ paddingLeft: 40 }}
                    placeholder="Bipe ou digite o EAN da caixa original para desmembrar..."
                    value={scanInput}
                    onChange={e => setScanInput(e.target.value)}
                    disabled={buscando}
                    autoFocus
                  />
                </div>
                <button type="submit" className="btn btn--primary" disabled={buscando}>
                  {buscando ? 'Buscando...' : 'Identificar Caixa'}
                </button>
              </form>
            ) : (
              <div style={{
                background: 'var(--bg-1)', border: '1.5px solid var(--cyan)', borderRadius: 10,
                padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14,
              }}>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Produto</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {caixaOrigem.produto_descricao}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Cód. Produto: <strong>{caixaOrigem.produto_codigo || '-'}</strong> • Endereço: <strong>{caixaOrigem.endereco_resolvido}</strong>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>EAN Original</div>
                    <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--cyan)' }}>
                      {caixaOrigem.ean_caixa}
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>LOTE (ORIGEM)</div>
                  <div style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>
                    {caixaOrigem.lote_resolvido || '-'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>DATA DE PRODUÇÃO</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtDataBR(caixaOrigem.data_producao)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Lock size={11} /> VALIDADE HERDADA (BLOQUEADA)
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fde68a' }}>
                    {fmtDataBR(caixaOrigem.validade)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PESO BRUTO / TARA</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {fmtKg2(caixaOrigem.peso_bruto_resolvido)} (Tara: {fmtKg3(caixaOrigem.tara_kg_resolvido)})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PESO LÍQUIDO ORIGINAL</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#4ade80', fontFamily: 'var(--font-mono)' }}>
                    {fmtKg2(caixaOrigem.peso_kg)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PEÇAS NA CAIXA ORIGINAL</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#facc15', fontFamily: 'var(--font-mono)' }}>
                    {caixaOrigem.qtd_pecas != null ? `${caixaOrigem.qtd_pecas} pç` : 'Não informado'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ETAPA 2 — PESAGEM E GERAÇÃO DAS NOVAS CAIXAS */}
          {caixaOrigem && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Etapa 2 — Pesagem e Geração das Novas Caixas ({caixasCalculadas.length})
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    Todas as novas etiquetas herdarão automaticamente Validade ({fmtDataBR(caixaOrigem.validade)}), Data de Produção ({fmtDataBR(caixaOrigem.data_producao)}) e Lote ({caixaOrigem.lote_resolvido || '-'}).
                  </p>
                </div>

                <button type="button" className="btn btn--secondary" onClick={adicionarNovaCaixaRow}>
                  <Plus size={16} /> Adicionar Mais 1 Caixa
                </button>
              </div>

              {/* Aviso de herança bloqueada */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8,
                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
                color: '#fde68a', fontSize: 12, fontWeight: 600, marginBottom: 16,
              }}>
                <Lock size={15} color="#fbbf24" />
                Regra ativa: A validade <strong>{fmtDataBR(caixaOrigem.validade)}</strong> e a rastreabilidade de lote da caixa original serão aplicadas sem permissão de edição manual.
              </div>

              {/* Lista das Novas Caixas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {caixasCalculadas.map((cx, i) => {
                  const invalidaBrutoTara = Number.isFinite(cx.peso_bruto_kg) && cx.peso_bruto_kg > 0 && cx.peso_liquido_kg <= 0
                  return (
                    <div
                      key={cx.uid}
                      style={{
                        background: 'var(--bg-1)',
                        border: `1.5px solid ${cx.valido ? 'rgba(34,197,94,0.4)' : (invalidaBrutoTara ? 'rgba(239,68,68,0.55)' : 'var(--border)')}`,
                        borderRadius: 10,
                        padding: '14px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Package size={16} color="var(--cyan)" />
                          <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>Nova Caixa #{i + 1}</strong>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            (EAN próprio automático)
                          </span>
                        </div>
                        {caixasCalculadas.length > 2 && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm text-danger"
                            onClick={() => removerNovaCaixaRow(cx.uid)}
                            title="Remover esta caixa"
                          >
                            <Trash2 size={15} /> Remover
                          </button>
                        )}
                      </div>

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: 12,
                        alignItems: 'end',
                      }}>
                        <div>
                          <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Qtd. de Peças *</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="form-input"
                            style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                            placeholder="Ex: 4"
                            value={cx.qtd_pecas ?? ''}
                            onChange={e => {
                              const digits = String(e.target.value || '').replace(/[^\d]/g, '')
                              atualizarNovaCaixa(cx.uid, { qtd_pecas: digits })
                            }}
                          />
                        </div>

                        <div>
                          <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Tara da Caixa *</label>
                          <select
                            className="form-input"
                            value={cx.tara_id}
                            onChange={e => atualizarNovaCaixa(cx.uid, { tara_id: e.target.value })}
                          >
                            {taras.map(t => (
                              <option key={t.id} value={t.id}>
                                {t.nome} ({fmtKg3(t.peso_kg)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Peso Bruto (kg) *</label>
                          <input
                            type="number"
                            step="0.001"
                            min="0.001"
                            className="form-input"
                            style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}
                            placeholder="Peso da balança..."
                            value={cx.peso_bruto}
                            onChange={e => atualizarNovaCaixa(cx.uid, { peso_bruto: e.target.value })}
                          />
                        </div>

                        <div>
                          <label className="form-label" style={{ display: 'block', marginBottom: 5 }}>Peso Líquido Calculado</label>
                          <div style={{
                            padding: '10px 12px',
                            borderRadius: 'var(--radius)',
                            background: cx.valido ? 'rgba(34,197,94,0.14)' : (invalidaBrutoTara ? 'rgba(239,68,68,0.18)' : 'var(--bg-3)'),
                            border: `1px solid ${cx.valido ? 'rgba(34,197,94,0.4)' : (invalidaBrutoTara ? 'rgba(239,68,68,0.5)' : 'var(--border)')}`,
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 800,
                            fontSize: 15,
                            color: cx.valido ? '#4ade80' : (invalidaBrutoTara ? '#f87171' : 'var(--text-muted)'),
                          }}>
                            {Number.isFinite(cx.peso_liquido_kg) ? fmtKg2(cx.peso_liquido_kg) : '0,00 kg'}
                          </div>
                        </div>

                        <div>
                          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                            <Lock size={11} color="#fbbf24" /> Validade Herdada
                          </label>
                          <div style={{
                            padding: '10px 12px', borderRadius: 'var(--radius)',
                            background: 'var(--bg-3)', border: '1px solid var(--border)',
                            color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700,
                          }}>
                            {fmtDataBR(caixaOrigem.validade)}
                          </div>
                        </div>
                      </div>

                      {invalidaBrutoTara && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
                          Peso bruto precisa ser maior que a tara selecionada ({fmtKg3(cx.tara_kg)}).
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Barra de Balanço e Ação Final */}
              <div style={{
                marginTop: 20, padding: '16px 18px', borderRadius: 10,
                background: 'var(--bg-1)', border: '1px solid var(--border-light)',
                display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16,
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ORIGINAL (LÍQ.)</div>
                    <strong style={{ fontSize: 16, fontFamily: 'var(--font-mono)' }}>{fmtKg2(resumoBalanco.origLiq)}</strong>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>NOVAS CAIXAS ({caixasCalculadas.length}×)</div>
                    <strong style={{ fontSize: 16, fontFamily: 'var(--font-mono)', color: '#4ade80' }}>{fmtKg2(resumoBalanco.somaLiq)}</strong>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>DIFERENÇA DE PESO</div>
                    <strong style={{
                      fontSize: 16, fontFamily: 'var(--font-mono)',
                      color: Math.abs(resumoBalanco.diferenca) > 1.0 ? '#fbbf24' : 'var(--text-secondary)',
                    }}>
                      {resumoBalanco.diferenca >= 0 ? '+' : ''}{fmtKg2(resumoBalanco.diferenca)}
                    </strong>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PEÇAS (ORIG. / SOMA)</div>
                    <strong style={{
                      fontSize: 16, fontFamily: 'var(--font-mono)',
                      color: resumoBalanco.origPecas != null && resumoBalanco.difPecas !== 0 ? '#fbbf24' : '#facc15',
                    }}>
                      {resumoBalanco.origPecas != null ? `${resumoBalanco.origPecas} pç` : '-'} / {resumoBalanco.somaPecas} pç
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn--success btn--lg"
                  disabled={salvando || !resumoBalanco.todasValidas}
                  onClick={solicitarConfirmacao}
                >
                  <CheckCircle2 size={18} />
                  {salvando ? 'Gerando Etiquetas...' : 'Confirmar Desmembramento e Imprimir Etiquetas'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA HISTÓRICO DE DESMEMBRAMENTOS */}
      {aba === 'historico' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Vínculos de Desmembramento Registrados ({historico.length})
            </h3>
            <button type="button" className="btn btn--secondary btn--sm" onClick={carregarHistorico}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>

          {loadingHist ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando histórico...</div>
          ) : historico.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum desmembramento registrado ainda.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11 }}>
                    <th style={{ padding: '8px 10px' }}>Data / Operação</th>
                    <th style={{ padding: '8px 10px' }}>Produto</th>
                    <th style={{ padding: '8px 10px' }}>EAN Origem</th>
                    <th style={{ padding: '8px 10px' }}>Novo EAN Gerado</th>
                    <th style={{ padding: '8px 10px' }}>Lote / Validade</th>
                    <th style={{ padding: '8px 10px' }}>Bruto / Tara / Líq</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Etiqueta</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map(v => (
                    <tr key={v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 10px' }}>
                        <div style={{ fontWeight: 600 }}>{fmtDataHoraBR(v.created_at)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.codigo_operacao} • {v.operador_nome}</div>
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <strong>{v.produto_descricao}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cód. {v.produto_codigo || '-'}</div>
                      </td>
                      <td style={{ padding: '9px 10px', fontFamily: 'monospace', color: '#fbbf24' }}>{v.ean_origem}</td>
                      <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#38bdf8' }}>{v.ean_destino}</td>
                      <td style={{ padding: '9px 10px' }}>
                        <span style={{ fontFamily: 'monospace' }}>{v.lote || '-'}</span> • Val {fmtDataBR(v.validade)}
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        <strong>Líq: {fmtKg2(v.peso_liquido_kg)}</strong>{v.qtd_pecas ? ` • ${v.qtd_pecas} pç` : ''}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Bruto: {fmtKg2(v.peso_bruto_kg)} | Tara: {fmtKg3(v.tara_kg)}
                          {Number(v.perda_pecas || 0) !== 0 ? ` | Dif. peças: ${v.perda_pecas > 0 ? '-' : '+'}${Math.abs(v.perda_pecas)} pç` : ''}
                        </div>
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => reimprimirVinculo(v)}
                        >
                          <Printer size={13} /> Reimprimir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmação quando há divergência significativa entre original e soma (peso ou peças) */}
      {modalDivergencia && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 490, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <AlertTriangle size={28} color="#f59e0b" />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Conferência de Divergência no Desmembramento</h3>
            </div>
            {Math.abs(modalDivergencia.diferenca) > 1.0 && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
                O peso líquido somado das novas caixas ({fmtKg2(modalDivergencia.somaLiq)}) difere do peso líquido original ({fmtKg2(modalDivergencia.origLiq)}) em{' '}
                <strong style={{ color: '#fbbf24' }}>{modalDivergencia.diferenca >= 0 ? '+' : ''}{fmtKg2(modalDivergencia.diferenca)}</strong>.
              </p>
            )}
            {modalDivergencia.origPecas != null && modalDivergencia.difPecas !== 0 && (
              <div style={{
                padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.35)', marginBottom: 14, fontSize: 13,
              }}>
                <div>
                  Quantidade de peças original: <strong>{modalDivergencia.origPecas} pç</strong> → Soma das novas caixas: <strong>{modalDivergencia.somaPecas} pç</strong>
                  {' '}(<strong style={{ color: '#fbbf24' }}>{modalDivergencia.difPecas > 0 ? `+${modalDivergencia.difPecas}` : modalDivergencia.difPecas} pç</strong>)
                </div>
                <label className="form-label" style={{ display: 'block', marginTop: 10, marginBottom: 4 }}>
                  Justificativa da diferença / perda de peças:
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: recorte de apara, perda em limpeza, ajuste de contagem..."
                  value={motivoDiferencaPecas}
                  onChange={e => setMotivoDiferencaPecas(e.target.value)}
                />
              </div>
            )}
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Deseja confirmar o desmembramento e gerar as etiquetas com estes valores?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--secondary" onClick={() => setModalDivergencia(null)}>
                Revisar Valores
              </button>
              <button type="button" className="btn btn--warning" onClick={executarDesmembramento}>
                <Scale size={15} /> Sim, Confirmar Desmembramento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Impressão Zebra 100x70mm automática */}
      <EtiquetaZebraModal
        isOpen={etiquetasModal.open}
        etiquetas={etiquetasModal.itens}
        autoPrint={etiquetasModal.autoPrint}
        titulo={etiquetasModal.titulo}
        onClose={() => setEtiquetasModal({ open: false, itens: [], autoPrint: false, titulo: '' })}
      />
    </div>
  )
}
