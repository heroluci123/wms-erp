import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Slash,
  Sparkles,
  Upload,
} from 'lucide-react'
import { financeiroQueries } from '../../queries/financeiro'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const FORMAS_OPCOES = ['PIX', 'BOLETO', 'TED', 'DEBITO_AUTO', 'CARTAO', 'TRANSFERENCIA', 'DEBITO_CONTA', 'DINHEIRO']

async function lerArquivoOfxComEncoding(file) {
  const buf = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  const pedeWin1252 =
    /CHARSET\s*:\s*1252/i.test(utf8) ||
    /ENCODING\s*:\s*USASCII/i.test(utf8) ||
    /ISO-8859-1/i.test(utf8) ||
    utf8.includes('\uFFFD')
  if (pedeWin1252) {
    try {
      return new TextDecoder('windows-1252').decode(buf)
    } catch {
      return utf8
    }
  }
  return utf8
}

export function AbaConciliacaoOfx({ contas, onAtualizar, toastSuccess, toastError }) {
  const [contaId, setContaId] = useState('')
  const [arquivoNome, setArquivoNome] = useState('')
  const [ofxTexto, setOfxTexto] = useState('')
  const [analisando, setAnalisando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [preview, setPreview] = useState(null)
  const [linhasEdicao, setLinhasEdicao] = useState([])
  const [filtroLinha, setFiltroLinha] = useState('PENDENTES') // 'PENDENTES' | 'MATCH' | 'SEM_MATCH' | 'CONCILIADAS' | 'TODAS'
  const inputFileRef = useRef(null)

  useEffect(() => {
    if (!contaId && contas?.length > 0) {
      const banco = contas.find((c) => c.tipo !== 'CAIXA_FISICO') || contas.find((c) => c.padrao === 1) || contas[0]
      setContaId(banco?.id || '')
    }
  }, [contas, contaId])

  const analisarOfx = async (conteudo, contaAlvo = contaId) => {
    if (!contaAlvo) {
      toastError('Selecione a Conta Bancária', 'Escolha em qual conta bancária deseja conciliar o extrato .OFX.')
      return
    }
    if (!conteudo || conteudo.trim().length < 20) {
      toastError('Arquivo inválido', 'Selecione um arquivo .OFX exportado pelo seu banco.')
      return
    }
    setAnalisando(true)
    try {
      const res = await financeiroQueries.previewOfx({
        conta_bancaria_id: contaAlvo,
        ofx_conteudo: conteudo,
      })
      setPreview(res)
      setLinhasEdicao(
        (res.linhas || []).map((l) => ({
          ...l,
          acao: l.acao_sugerida || (l.ja_conciliada ? 'IGNORAR' : 'LANCAR_AVULSO'),
          titulo_id: l.titulo_sugerido_id || '',
          historico_custom: l.memo || '',
          forma_custom: l.forma_sugerida || 'PIX',
          quitar_diferenca_desconto: false,
        })),
      )
      setFiltroLinha(res.resumo?.novas > 0 ? 'PENDENTES' : 'TODAS')
      toastSuccess(
        'Extrato OFX analisado ✅',
        `${res.resumo?.novas || 0} lançamento(s) novo(s) • ${
          (res.resumo?.match_exato || 0) + (res.resumo?.match_sugerido || 0)
        } casamento(s) automático(s) encontrados.`,
      )
    } catch (err) {
      toastError('Erro ao ler OFX', err.message)
      setPreview(null)
      setLinhasEdicao([])
    } finally {
      setAnalisando(false)
    }
  }

  const handleSelecionarArquivo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setArquivoNome(file.name)
    try {
      const texto = await lerArquivoOfxComEncoding(file)
      setOfxTexto(texto)
      await analisarOfx(texto, contaId)
    } catch (err) {
      toastError('Erro ao abrir arquivo', err.message)
    } finally {
      if (inputFileRef.current) inputFileRef.current.value = ''
    }
  }

  const atualizarLinha = (fitid, patch) => {
    setLinhasEdicao((prev) => prev.map((l) => (l.fitid === fitid ? { ...l, ...patch } : l)))
  }

  const aplicarAcaoSemMatch = (novaAcao) => {
    setLinhasEdicao((prev) =>
      prev.map((l) => (!l.ja_conciliada && l.match_nivel === 'SEM_MATCH' ? { ...l, acao: novaAcao } : l)),
    )
  }

  const titulosPorTipo = useMemo(() => {
    const abertos = preview?.titulos_abertos || []
    return {
      RECEBER: abertos.filter((t) => t.tipo === 'RECEBER'),
      PAGAR: abertos.filter((t) => t.tipo === 'PAGAR'),
    }
  }, [preview])

  const titulosMap = useMemo(() => {
    const m = new Map()
    ;(preview?.titulos_abertos || []).forEach((t) => m.set(t.id, t))
    return m
  }, [preview])

  const linhasFiltradas = useMemo(() => {
    return linhasEdicao.filter((l) => {
      if (filtroLinha === 'PENDENTES') return !l.ja_conciliada
      if (filtroLinha === 'MATCH') return !l.ja_conciliada && (l.match_nivel === 'EXATO' || l.match_nivel === 'SUGERIDO')
      if (filtroLinha === 'SEM_MATCH') return !l.ja_conciliada && l.match_nivel === 'SEM_MATCH'
      if (filtroLinha === 'CONCILIADAS') return l.ja_conciliada
      return true
    })
  }, [linhasEdicao, filtroLinha])

  const contadoresAcao = useMemo(() => {
    const novas = linhasEdicao.filter((l) => !l.ja_conciliada)
    const baixar = novas.filter((l) => l.acao === 'BAIXAR_TITULO' && l.titulo_id)
    const baixarSemTitulo = novas.filter((l) => l.acao === 'BAIXAR_TITULO' && !l.titulo_id)
    const avulso = novas.filter((l) => l.acao === 'LANCAR_AVULSO')
    const ignorar = novas.filter((l) => l.acao === 'IGNORAR')
    const valorBaixar = baixar.reduce((s, l) => s + Number(l.valor || 0), 0)
    const valorAvulso = avulso.reduce((s, l) => s + Number(l.valor || 0), 0)
    return {
      totalProcessar: baixar.length + avulso.length,
      baixar: baixar.length,
      baixarSemTitulo: baixarSemTitulo.length,
      avulso: avulso.length,
      ignorar: ignorar.length,
      valorBaixar,
      valorAvulso,
    }
  }, [linhasEdicao])

  const handleConfirmarConciliacao = async () => {
    if (contadoresAcao.baixarSemTitulo > 0) {
      toastError(
        'Título pendente de vínculo',
        `Há ${contadoresAcao.baixarSemTitulo} linha(s) marcadas como "Baixar Título" sem nenhum título selecionado.`,
      )
      return
    }
    if (contadoresAcao.totalProcessar === 0) {
      toastError('Nada para conciliar', 'Selecione ao menos uma movimentação para baixar título ou lançar avulso.')
      return
    }

    setConfirmando(true)
    try {
      const itens = linhasEdicao
        .filter((l) => !l.ja_conciliada)
        .map((l) => ({
          fitid: l.fitid,
          tipo: l.tipo,
          data_movimento: l.data_movimento,
          valor: l.valor,
          memo: l.memo,
          acao: l.acao,
          titulo_id: l.acao === 'BAIXAR_TITULO' ? l.titulo_id || null : null,
          forma_pagamento: l.forma_custom || l.forma_sugerida || '',
          historico: l.historico_custom || l.memo || '',
          quitar_diferenca_desconto: Boolean(l.quitar_diferenca_desconto),
        }))

      const res = await financeiroQueries.conciliarOfx({
        conta_bancaria_id: contaId,
        itens,
      })

      toastSuccess(
        'Conciliação Bancária Concluída ✅',
        `${res.baixados} título(s) baixados • ${res.lancados_avulsos} lançamento(s) avulsos • Saldo atual da conta: ${fmtMoeda(
          res.saldo_conta_atual,
        )}`,
      )
      await onAtualizar?.()
      if (ofxTexto) {
        await analisarOfx(ofxTexto, contaId)
      }
    } catch (err) {
      toastError('Erro ao conciliar OFX', err.message)
    } finally {
      setConfirmando(false)
    }
  }

  return (
    <div className="flex flex-col gap-16">
      {/* UPLOAD & SELEÇÃO DA CONTA */}
      <div className="card" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end justify-between gap-12">
          <div style={{ minWidth: 260, flex: '1 1 280px' }}>
            <label className="form-label">1. Conta Bancária do Extrato *</label>
            <select
              className="form-input"
              value={contaId}
              onChange={(e) => {
                const novoId = e.target.value
                setContaId(novoId)
                if (ofxTexto && novoId) analisarOfx(ofxTexto, novoId)
              }}
            >
              <option value="">Selecione a conta bancária...</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.nome} (Saldo ERP: {fmtMoeda(c.saldo_atual)})
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: '2 1 360px' }}>
            <label className="form-label">2. Importar Extrato Bancário (.OFX)</label>
            <div className="flex flex-wrap items-center gap-8">
              <input
                ref={inputFileRef}
                type="file"
                accept=".ofx,.qfx,.xml,text/plain"
                style={{ display: 'none' }}
                onChange={handleSelecionarArquivo}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={analisando || !contaId}
                onClick={() => inputFileRef.current?.click()}
              >
                <Upload size={15} /> {analisando ? 'Analisando Extrato...' : 'Selecionar Arquivo .OFX'}
              </button>
              {ofxTexto && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={analisando}
                  onClick={() => analisarOfx(ofxTexto, contaId)}
                >
                  <RefreshCw size={14} /> Reanalisar
                </button>
              )}
              {arquivoNome && (
                <span className="badge badge--info font-mono text-xs">
                  <FileSpreadsheet size={12} /> {arquivoNome}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-muted mt-10 flex items-center gap-6">
          <ShieldCheck size={14} className="text-success" />
          <span>
            Compatível com Itaú, Banco do Brasil, Bradesco, Santander, Caixa, Inter, Sicredi, Sicoob, Cora e BTG. Trava
            automática anti-duplicidade via <code>FITID</code>: você pode reimportar o extrato da semana sem duplicar
            nenhum lançamento.
          </span>
        </div>
      </div>

      {/* RESUMO DO EXTRATO CARREGADO */}
      {preview && (
        <>
          <div className="grid gap-12" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="text-xs text-muted uppercase font-bold">Banco / Período OFX</div>
              <div className="text-sm font-bold mt-4">
                Banco {preview.cabecalho?.bank_id || '-'} • Conta {preview.cabecalho?.acct_id || '-'}
              </div>
              <div className="text-xs text-muted font-mono mt-2">
                {fmtData(preview.cabecalho?.dt_start)} até {fmtData(preview.cabecalho?.dt_end)}
              </div>
            </div>

            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="text-xs text-muted uppercase font-bold">Casamento Automático</div>
              <div className="text-lg font-bold font-mono text-success mt-4">
                {(preview.resumo?.match_exato || 0) + (preview.resumo?.match_sugerido || 0)} de{' '}
                {preview.resumo?.novas || 0} novas
              </div>
              <div className="text-xs text-muted mt-2">
                Exato: <strong>{preview.resumo?.match_exato || 0}</strong> • Sugerido:{' '}
                <strong>{preview.resumo?.match_sugerido || 0}</strong> • Já conciliadas:{' '}
                <strong>{preview.resumo?.ja_conciliadas || 0}</strong>
              </div>
            </div>

            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="text-xs text-muted uppercase font-bold">Movimento Novo no OFX</div>
              <div className="flex gap-12 mt-4 font-mono text-sm font-bold">
                <span className="text-success">+{fmtMoeda(preview.resumo?.total_entradas)}</span>
                <span className="text-danger">-{fmtMoeda(preview.resumo?.total_saidas)}</span>
              </div>
              <div className="text-xs text-muted mt-2">
                Sem vínculo prévio: <strong>{preview.resumo?.sem_match || 0}</strong> linha(s)
              </div>
            </div>

            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="text-xs text-muted uppercase font-bold">Saldo ERP × Saldo Extrato</div>
              <div className="text-sm font-mono font-bold mt-4">
                ERP: <span className="text-cyan">{fmtMoeda(preview.cabecalho?.conta_erp_saldo_atual)}</span>
              </div>
              <div className="text-xs font-mono text-muted mt-2">
                Extrato OFX:{' '}
                <strong>
                  {preview.cabecalho?.saldo_extrato != null ? fmtMoeda(preview.cabecalho.saldo_extrato) : 'Não informado'}
                </strong>
              </div>
            </div>
          </div>

          {/* FILTROS & AÇÕES RÁPIDAS */}
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-center justify-between gap-10">
              <div className="flex gap-6 flex-wrap">
                {[
                  { id: 'PENDENTES', label: `Pendentes (${preview.resumo?.novas || 0})` },
                  {
                    id: 'MATCH',
                    label: `Match Automático (${(preview.resumo?.match_exato || 0) + (preview.resumo?.match_sugerido || 0)})`,
                  },
                  { id: 'SEM_MATCH', label: `Sem Match (${preview.resumo?.sem_match || 0})` },
                  { id: 'CONCILIADAS', label: `Já Conciliadas (${preview.resumo?.ja_conciliadas || 0})` },
                  { id: 'TODAS', label: `Todas (${preview.resumo?.total_linhas || 0})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`btn btn--sm ${filtroLinha === f.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setFiltroLinha(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {(preview.resumo?.sem_match || 0) > 0 && (
                <div className="flex gap-6 flex-wrap">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => aplicarAcaoSemMatch('LANCAR_AVULSO')}
                  >
                    <PlusCircle size={13} /> Sem Match → Lançar Avulso
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => aplicarAcaoSemMatch('IGNORAR')}
                  >
                    <Slash size={13} /> Sem Match → Ignorar
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* TABELA DE CONCILIAÇÃO */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Data</th>
                    <th>Lançamento no Extrato do Banco (OFX)</th>
                    <th style={{ textAlign: 'right', width: 120 }}>Valor</th>
                    <th style={{ width: 165 }}>Ação na Conciliação</th>
                    <th>Título Vinculado / Descrição do Lançamento</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center p-24 text-muted">
                        Nenhuma linha do extrato neste filtro.
                      </td>
                    </tr>
                  ) : (
                    linhasFiltradas.map((l) => {
                      const opcoesTit = l.tipo === 'ENTRADA' ? titulosPorTipo.RECEBER : titulosPorTipo.PAGAR
                      const titSel = l.titulo_id ? titulosMap.get(l.titulo_id) : null
                      const diffMenor = titSel && l.valor < titSel.saldo_aberto - 0.009
                      const diffMaior = titSel && l.valor > titSel.saldo_aberto + 0.009

                      return (
                        <tr
                          key={l.fitid}
                          style={
                            l.ja_conciliada
                              ? { opacity: 0.55 }
                              : l.acao === 'IGNORAR'
                                ? { opacity: 0.65 }
                                : undefined
                          }
                        >
                          <td className="font-mono text-xs font-bold">{fmtData(l.data_movimento)}</td>
                          <td>
                            <div className="flex items-center gap-6 flex-wrap">
                              {l.tipo === 'ENTRADA' ? (
                                <span className="badge badge--success" style={{ fontSize: 10 }}>
                                  <ArrowDownLeft size={11} /> Entrada
                                </span>
                              ) : (
                                <span className="badge badge--danger" style={{ fontSize: 10 }}>
                                  <ArrowUpRight size={11} /> Saída
                                </span>
                              )}
                              {l.match_nivel === 'JA_CONCILIADA' && (
                                <span className="badge badge--info" style={{ fontSize: 10 }}>
                                  <CheckCheck size={11} /> Já Conciliada
                                </span>
                              )}
                              {l.match_nivel === 'EXATO' && (
                                <span className="badge badge--success" style={{ fontSize: 10 }}>
                                  <Sparkles size={11} /> Match Exato ({l.match_score}%)
                                </span>
                              )}
                              {l.match_nivel === 'SUGERIDO' && (
                                <span className="badge badge--warning" style={{ fontSize: 10 }}>
                                  <Link2 size={11} /> Sugerido ({l.match_score}%)
                                </span>
                              )}
                              {l.match_nivel === 'SEM_MATCH' && (
                                <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                                  Sem Título Correspondente
                                </span>
                              )}
                            </div>
                            <div className="font-bold text-xs mt-4">{l.memo}</div>
                            {l.match_motivos?.length > 0 && (
                              <div className="text-xs text-success mt-2">{l.match_motivos.join(' • ')}</div>
                            )}
                          </td>
                          <td
                            style={{ textAlign: 'right' }}
                            className={`font-mono font-bold text-sm ${
                              l.tipo === 'ENTRADA' ? 'text-success' : 'text-danger'
                            }`}
                          >
                            {l.tipo === 'ENTRADA' ? '+' : '-'} {fmtMoeda(l.valor)}
                          </td>
                          <td>
                            {l.ja_conciliada ? (
                              <span className="text-xs text-muted">Importada anteriormente</span>
                            ) : (
                              <select
                                className="form-input"
                                style={{ height: 34, fontSize: 12, padding: '4px 8px' }}
                                value={l.acao}
                                onChange={(e) => atualizarLinha(l.fitid, { acao: e.target.value })}
                              >
                                <option value="BAIXAR_TITULO">Baixar Título</option>
                                <option value="LANCAR_AVULSO">Lançar Avulso</option>
                                <option value="IGNORAR">Ignorar</option>
                              </select>
                            )}
                          </td>
                          <td>
                            {l.ja_conciliada ? (
                              <span className="text-xs font-mono text-muted">FITID: {l.fitid}</span>
                            ) : l.acao === 'BAIXAR_TITULO' ? (
                              <div className="flex flex-col gap-4">
                                <select
                                  className="form-input"
                                  style={{
                                    height: 34,
                                    fontSize: 12,
                                    padding: '4px 8px',
                                    borderColor: !l.titulo_id ? 'var(--danger)' : undefined,
                                  }}
                                  value={l.titulo_id}
                                  onChange={(e) =>
                                    atualizarLinha(l.fitid, {
                                      titulo_id: e.target.value,
                                      quitar_diferenca_desconto: false,
                                    })
                                  }
                                >
                                  <option value="">
                                    -- Selecione o título {l.tipo === 'ENTRADA' ? 'a Receber' : 'a Pagar'} --
                                  </option>
                                  {opcoesTit.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.codigo} • {t.parceiro_nome || t.descricao} • Venc {fmtData(t.data_vencimento)} •
                                      Aberto {fmtMoeda(t.saldo_aberto)}
                                    </option>
                                  ))}
                                </select>
                                {diffMaior && (
                                  <div className="text-xs text-warning">
                                    Diferença de +{fmtMoeda(l.valor - titSel.saldo_aberto)} será lançada automaticamente
                                    como Juros/Multa.
                                  </div>
                                )}
                                {diffMenor && (
                                  <label className="flex items-center gap-6 text-xs text-muted cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(l.quitar_diferenca_desconto)}
                                      onChange={(e) =>
                                        atualizarLinha(l.fitid, { quitar_diferenca_desconto: e.target.checked })
                                      }
                                    />
                                    <span>
                                      Quitar diferença de {fmtMoeda(titSel.saldo_aberto - l.valor)} como Desconto (se
                                      desmarcado, fica como Baixa Parcial)
                                    </span>
                                  </label>
                                )}
                              </div>
                            ) : l.acao === 'LANCAR_AVULSO' ? (
                              <div className="flex gap-6 flex-wrap items-center">
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ flex: '1 1 200px', height: 34, fontSize: 12 }}
                                  value={l.historico_custom}
                                  onChange={(e) => atualizarLinha(l.fitid, { historico_custom: e.target.value })}
                                  placeholder="Descrição no extrato..."
                                />
                                <select
                                  className="form-input"
                                  style={{ width: 130, height: 34, fontSize: 12, padding: '4px 8px' }}
                                  value={l.forma_custom}
                                  onChange={(e) => atualizarLinha(l.fitid, { forma_custom: e.target.value })}
                                >
                                  {FORMAS_OPCOES.map((f) => (
                                    <option key={f} value={f}>
                                      {f}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <span className="text-xs text-muted">Não será importada no extrato ERP.</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* BARRA FINAL DE CONFIRMAÇÃO */}
          <div
            className="card flex flex-wrap items-center justify-between gap-12"
            style={{
              padding: '14px 18px',
              borderColor: 'var(--accent)',
              background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(16,185,129,0.08))',
            }}
          >
            <div className="flex flex-wrap gap-16 text-xs">
              <span>
                Baixar Títulos:{' '}
                <strong className="text-success">
                  {contadoresAcao.baixar} ({fmtMoeda(contadoresAcao.valorBaixar)})
                </strong>
              </span>
              <span>
                Lançamentos Avulsos:{' '}
                <strong className="text-cyan">
                  {contadoresAcao.avulso} ({fmtMoeda(contadoresAcao.valorAvulso)})
                </strong>
              </span>
              <span>
                Ignorados: <strong>{contadoresAcao.ignorar}</strong>
              </span>
              {contadoresAcao.baixarSemTitulo > 0 && (
                <span className="text-danger font-bold">
                  {contadoresAcao.baixarSemTitulo} linha(s) aguardando escolha do título!
                </span>
              )}
            </div>

            <button
              type="button"
              className="btn btn--success"
              disabled={confirmando || contadoresAcao.totalProcessar === 0 || contadoresAcao.baixarSemTitulo > 0}
              onClick={handleConfirmarConciliacao}
            >
              <CheckCircle2 size={16} />{' '}
              {confirmando
                ? 'Conciliando...'
                : `Confirmar Conciliação (${contadoresAcao.totalProcessar} lançamento${
                    contadoresAcao.totalProcessar === 1 ? '' : 's'
                  })`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
