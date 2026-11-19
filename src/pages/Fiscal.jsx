import React, { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  Ban,
  CheckCircle2,
  Download,
  FileCheck2,
  FileCode2,
  FileText,
  KeyRound,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { fiscalQueries } from '../queries/fiscal'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { DanfePrintModal, imprimirDanfeDocumento } from '../components/fiscal/DanfePrintModal'
import { AbaConfigCertificado } from '../components/fiscal/AbaConfigCertificado'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDataHora = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleString('pt-BR')
  } catch {
    return String(d)
  }
}

function downloadTextFile(filename, content, mime = 'application/xml;charset=utf-8;') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Fiscal() {
  const { toastSuccess, toastError, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()

  const [aba, setAba] = useState('FILA') // 'FILA' | 'NOTAS' | 'COFRE' | 'EVENTOS' | 'CONFIG'
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState(null)
  const [fila, setFila] = useState({ pedidos: [], devolucoes: [] })
  const [notas, setNotas] = useState([])
  const [resumoNotas, setResumoNotas] = useState({
    total_notas: 0,
    autorizadas: 0,
    canceladas: 0,
    nfe_55: 0,
    nfce_65: 0,
    valor_total_autorizado: 0,
    total_icms: 0,
  })
  const [eventos, setEventos] = useState([])

  // Filtros notas
  const [modeloFiltro, setModeloFiltro] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('TODOS')
  const [buscaNota, setBuscaNota] = useState('')

  // Cofre XML mensal
  const [mesCofre, setMesCofre] = useState(() => new Date().toISOString().slice(0, 7))
  const [cofre, setCofre] = useState({ resumo: {}, arquivos: [] })

  // Modais
  const [previewPedido, setPreviewPedido] = useState(null) // { pedido, preview, modelo, frete, infExtra }
  const [emitindo, setEmitindo] = useState(false)
  const [notaDanfe, setNotaDanfe] = useState(null)
  const [modalEvento, setModalEvento] = useState(null) // { tipo: 'CANCELAR' | 'CCE', nota, texto }
  const [modalAvulsa, setModalAvulsa] = useState(false)
  const [produtosCat, setProdutosCat] = useState([])
  const [avulsaForm, setAvulsaForm] = useState({
    modelo: '65',
    destinatario_nome: 'CONSUMIDOR FINAL',
    destinatario_doc: '',
    destinatario_uf: 'SP',
    forma_pagamento_label: '17 - PIX',
    t_pag: '17',
    produto_id: '',
    codigo: '001',
    descricao: '',
    ncm: '02013000',
    qtd: '1',
    valor_unitario: '',
  })

  // Form Inutilização
  const [inutForm, setInutForm] = useState({
    modelo: '55',
    serie: 1,
    numero_inicial: '',
    numero_final: '',
    justificativa: '',
  })

  const carregarTudo = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [cfgRes, filaRes, notasRes, evRes, prodsRes] = await Promise.all([
        fiscalQueries.obterConfig(),
        fiscalQueries.listarFilaEmissao(),
        fiscalQueries.listarNotas({
          modelo: modeloFiltro || undefined,
          status: statusFiltro,
          busca: buscaNota || undefined,
        }),
        fiscalQueries.listarEventos(),
        cadastrosQueries.listarProdutos?.().catch(() => []) || Promise.resolve([]),
      ])
      setConfig(cfgRes)
      setFila({ pedidos: filaRes?.pedidos || [], devolucoes: filaRes?.devolucoes || [] })
      setNotas(notasRes?.data || [])
      setResumoNotas(
        notasRes?.resumo || {
          total_notas: 0,
          autorizadas: 0,
          canceladas: 0,
          nfe_55: 0,
          nfce_65: 0,
          valor_total_autorizado: 0,
          total_icms: 0,
        },
      )
      setEventos(evRes || [])
      if (Array.isArray(prodsRes)) setProdutosCat(prodsRes)
    } catch (err) {
      toastError('Erro ao carregar Módulo Fiscal', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, modeloFiltro, statusFiltro, buscaNota, toastError])

  const carregarCofre = useCallback(async () => {
    if (!apiAtiva || aba !== 'COFRE') return
    try {
      const res = await fiscalQueries.obterCofreXml(mesCofre)
      setCofre(res || { resumo: {}, arquivos: [] })
    } catch (err) {
      toastError('Erro ao carregar Cofre XML', err.message)
    }
  }, [apiAtiva, aba, mesCofre, toastError])

  useEffect(() => {
    carregarTudo()
  }, [carregarTudo])

  useEffect(() => {
    carregarCofre()
  }, [carregarCofre])

  const abrirPreviewPedido = async (ped, modelo = '55') => {
    try {
      const prev = await fiscalQueries.previewPedido(ped.id, modelo)
      setPreviewPedido({
        pedido: ped,
        preview: prev,
        modelo,
        valor_frete: '0',
        inf_complementar: '',
      })
    } catch (err) {
      toastError('Erro ao calcular tributos do pedido', err.message)
    }
  }

  const confirmarEmissaoPedido = async () => {
    if (!previewPedido) return
    setEmitindo(true)
    try {
      const res = await fiscalQueries.emitirPedido(previewPedido.pedido.id, {
        modelo: previewPedido.modelo,
        valor_frete: Number(String(previewPedido.valor_frete || 0).replace(',', '.')),
        inf_complementar: previewPedido.inf_complementar,
      })
      toastSuccess(
        `${previewPedido.modelo === '65' ? 'NFC-e' : 'NF-e'} Autorizada ✅`,
        `Nº ${res.numero} / Série ${res.serie} • Chave ${res.chave_acesso}`,
      )
      setPreviewPedido(null)
      await carregarTudo()
      const detalhe = await fiscalQueries.obterNota(res.id)
      setNotaDanfe(detalhe)
    } catch (err) {
      toastError('Erro ao emitir nota fiscal', err.message)
    } finally {
      setEmitindo(false)
    }
  }

  const handleEmitirDevolucao = async (dev) => {
    const ok = await confirmar({
      title: `Emitir NF-e de Devolução (${dev.codigo})`,
      message: `Emitir NF-e de Entrada/Devolução (CFOP 1202/2202) para ${dev.cliente_nome || 'Cliente'} no valor estimado de ${fmtMoeda(
        dev.valor_estimado,
      )}?`,
      type: 'info',
      confirmLabel: 'Sim, Emitir NF-e Devolução',
    })
    if (!ok) return
    try {
      const res = await fiscalQueries.emitirDevolucao(dev.id)
      toastSuccess('NF-e de Devolução Autorizada ✅', `Nº ${res.numero} • Status fiscal da devolução atualizado.`)
      await carregarTudo()
      const detalhe = await fiscalQueries.obterNota(res.id)
      setNotaDanfe(detalhe)
    } catch (err) {
      toastError('Erro na emissão da devolução', err.message)
    }
  }

  const handleEmitirAvulsa = async (e) => {
    e.preventDefault()
    setEmitindo(true)
    try {
      const res = await fiscalQueries.emitirAvulsa({
        modelo: avulsaForm.modelo,
        destinatario_nome: avulsaForm.destinatario_nome,
        destinatario_doc: avulsaForm.destinatario_doc,
        destinatario_uf: avulsaForm.destinatario_uf,
        forma_pagamento_label: avulsaForm.forma_pagamento_label,
        t_pag: avulsaForm.t_pag,
        itens: [
          {
            produto_id: avulsaForm.produto_id || null,
            codigo: avulsaForm.codigo || '001',
            descricao: avulsaForm.descricao,
            ncm: avulsaForm.ncm || '02013000',
            unidade: 'KG',
            qtd: Number(String(avulsaForm.qtd).replace(',', '.')),
            valor_unitario: Number(String(avulsaForm.valor_unitario).replace(',', '.')),
          },
        ],
      })
      toastSuccess(
        `${avulsaForm.modelo === '65' ? 'NFC-e (Cupom)' : 'NF-e'} Emitida ✅`,
        `Nº ${res.numero} • Chave ${res.chave_acesso}`,
      )
      setModalAvulsa(false)
      await carregarTudo()
      const detalhe = await fiscalQueries.obterNota(res.id)
      setNotaDanfe(detalhe)
    } catch (err) {
      toastError('Erro na emissão avulsa', err.message)
    } finally {
      setEmitindo(false)
    }
  }

  const abrirDanfe = async (notaId) => {
    try {
      const det = await fiscalQueries.obterNota(notaId)
      setNotaDanfe(det)
    } catch (err) {
      toastError('Erro ao abrir DANFE', err.message)
    }
  }

  const baixarXmlNota = async (notaId) => {
    try {
      const res = await fiscalQueries.obterXmlNota(notaId)
      downloadTextFile(res.nome_arquivo, res.xml)
      toastSuccess('XML baixado ✅', res.nome_arquivo)
    } catch (err) {
      toastError('Erro ao baixar XML', err.message)
    }
  }

  const confirmarEventoModal = async (e) => {
    e.preventDefault()
    if (!modalEvento) return
    try {
      if (modalEvento.tipo === 'CANCELAR') {
        await fiscalQueries.cancelarNota(modalEvento.nota.id, modalEvento.texto)
        toastSuccess('Nota Cancelada ✅', `NF nº ${modalEvento.nota.numero} cancelada e evento registrado.`)
      } else {
        const res = await fiscalQueries.emitirCartaCorrecao(modalEvento.nota.id, modalEvento.texto)
        toastSuccess('Carta de Correção (CC-e) Registrada ✅', `Sequência #${res.sequencia} • Protocolo ${res.protocolo}`)
      }
      setModalEvento(null)
      await carregarTudo()
    } catch (err) {
      toastError('Erro no evento fiscal', err.message)
    }
  }

  const handleInutilizar = async (e) => {
    e.preventDefault()
    try {
      const res = await fiscalQueries.inutilizarNumeracao(inutForm)
      toastSuccess('Numeração Inutilizada ✅', `Protocolo SEFAZ: ${res.protocolo}`)
      setInutForm({ modelo: '55', serie: 1, numero_inicial: '', numero_final: '', justificativa: '' })
      await carregarTudo()
    } catch (err) {
      toastError('Erro ao inutilizar numeração', err.message)
    }
  }

  const exportarPacoteContador = () => {
    if (!cofre?.arquivos?.length) return
    const csvHeader = 'ARQUIVO;TIPO;SERIE;NUMERO;STATUS;CHAVE_OU_PROTOCOLO;DESTINATARIO;VALOR_R$\n'
    const csvBody = cofre.arquivos
      .map(
        (a) =>
          `"${a.nome}";"${a.tipo}";${a.serie};${a.numero};"${a.status}";"${a.chave}";"${String(a.destinatario || '').replace(/"/g, '')}";${Number(
            a.valor || 0,
          )
            .toFixed(2)
            .replace('.', ',')}`,
      )
      .join('\n')
    downloadTextFile(`Resumo_Fiscal_${mesCofre}.csv`, '\uFEFF' + csvHeader + csvBody, 'text/csv;charset=utf-8;')

    const xmlBundle = `<?xml version="1.0" encoding="UTF-8"?>\n<loteContador mes="${mesCofre}" totalArquivos="${cofre.arquivos.length}">\n${cofre.arquivos
      .map((a) => `<!-- ARQUIVO: ${a.nome} -->\n${String(a.xml || '').replace(/<\?xml[^?]*\?>/i, '').trim()}`)
      .join('\n')}\n</loteContador>`
    downloadTextFile(`Cofre_XML_Contador_${mesCofre}.xml`, xmlBundle)
    toastSuccess('Pacote do Contador exportado ✅', 'Planilha CSV + Lote XML consolidado baixados.')
  }

  return (
    <div className="fade-in">
      {/* CABEÇALHO */}
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <FileCheck2 className="text-primary" size={26} /> Módulo Fiscal — NF-e 55 &amp; NFC-e 65
          </h1>
          <p className="page-header__subtitle">
            Motor Tributário de Carnes (Cesta Básica / PIS-COFINS Zero), Emissão XML 4.00, DANFE, CC-e, Cofre XML e Certificado A1
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          <button type="button" className="btn btn--secondary" onClick={() => setModalAvulsa(true)}>
            <Plus size={15} /> Emitir NF-e / NFC-e Avulsa
          </button>
          <button type="button" className="btn btn--primary" onClick={carregarTudo} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Módulo Fiscal (NF-e / NFC-e)" />

      {/* 5 CARDS KPI */}
      <div className="grid gap-12 mb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Fila de Emissão</div>
          <div className="text-xl font-bold font-mono text-warning mt-6">
            {fila.pedidos.length + fila.devolucoes.length} pendente(s)
          </div>
          <div className="text-xs text-muted mt-4">
            {fila.pedidos.length} Pedido(s) • {fila.devolucoes.length} Devolução(ões)
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Notas Autorizadas</div>
          <div className="text-xl font-bold font-mono text-success mt-6">{resumoNotas.autorizadas}</div>
          <div className="text-xs text-muted mt-4">
            NF-e 55: <strong>{resumoNotas.nfe_55}</strong> • NFC-e 65: <strong>{resumoNotas.nfce_65}</strong>
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Total Faturado Fiscal</div>
          <div className="text-xl font-bold font-mono text-cyan mt-6">{fmtMoeda(resumoNotas.valor_total_autorizado)}</div>
          <div className="text-xs text-muted mt-4">ICMS destacado: {fmtMoeda(resumoNotas.total_icms)}</div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Ambiente &amp; Motor</div>
          <div className="mt-6 flex items-center gap-6">
            <span className={`badge ${config?.ambiente === 'PRODUCAO' ? 'badge--success' : 'badge--warning'}`}>
              {config?.ambiente || 'HOMOLOGACAO'}
            </span>
          </div>
          <div className="text-xs text-muted mt-4 font-mono">{config?.provedor || 'SIMULACAO_LOCAL'}</div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted uppercase font-bold">Certificado Digital A1</div>
          <div className="mt-6">
            {config?.certificado_configurado ? (
              <span className="badge badge--success">
                <CheckCircle2 size={12} /> A1 Instalado
              </span>
            ) : (
              <span className="badge badge--neutral">Modo Simulação (Sem A1)</span>
            )}
          </div>
          <div className="text-xs text-muted mt-4 font-mono">
            Próx. NF-e #{config?.proximo_numero_nfe || 1} • NFC-e #{config?.proximo_numero_nfce || 1}
          </div>
        </div>
      </div>

      {/* ABAS */}
      <div className="flex gap-8 flex-wrap mb-16 pb-8 border-b border-border">
        {[
          { id: 'FILA', label: `Fila de Emissão (${fila.pedidos.length + fila.devolucoes.length})`, icon: Send },
          { id: 'NOTAS', label: `Notas Emitidas (${notas.length})`, icon: FileText },
          { id: 'COFRE', label: 'Cofre XML (Contador)', icon: Archive },
          { id: 'EVENTOS', label: `Eventos & Inutilização (${eventos.length})`, icon: FileCode2 },
          { id: 'CONFIG', label: 'Certificado A1 & Config.', icon: KeyRound },
        ].map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              className={`btn ${aba === tab.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAba(tab.id)}
            >
              <Icon size={15} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* ABA 1: FILA DE EMISSÃO */}
      {aba === 'FILA' && (
        <div className="flex flex-col gap-16">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border flex justify-between items-center" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-sm font-bold m-0">Pedidos de Venda Aguardando NF-e / NFC-e</h3>
              <span className="text-xs text-muted">Puxa peso real das caixas expedidas e calcula impostos de carnes automaticamente</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Status Operacional</th>
                    <th>Cliente / UF</th>
                    <th style={{ textAlign: 'right' }}>Valor Pedido</th>
                    <th style={{ textAlign: 'right' }}>Emissão</th>
                  </tr>
                </thead>
                <tbody>
                  {fila.pedidos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center p-24 text-muted">
                        Todos os pedidos ativos já possuem NF-e autorizada ou ainda não há pedidos liberados.
                      </td>
                    </tr>
                  ) : (
                    fila.pedidos.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="font-mono font-bold text-xs text-cyan">{p.codigo}</div>
                          <div className="text-xs text-muted">{p.titulo}</div>
                        </td>
                        <td>
                          <span className="badge badge--info">{p.status}</span>
                        </td>
                        <td>
                          <div className="font-bold text-sm">{p.cliente_nome}</div>
                          <div className="text-xs text-muted font-mono">
                            {p.cliente_doc || 'Sem doc'} • UF {p.cliente_uf}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm">
                          {fmtMoeda(p.valor_total)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex justify-end gap-6">
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() => abrirPreviewPedido(p, '55')}
                            >
                              <FileCheck2 size={13} /> Emitir NF-e (55)
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => abrirPreviewPedido(p, '65')}
                            >
                              NFC-e (65)
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border flex justify-between items-center" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-sm font-bold m-0">Devoluções Pendentes de NF-e de Entrada (CFOP 1202 / 2202)</h3>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Devolução</th>
                    <th>Cliente / Pedido</th>
                    <th>Motivo</th>
                    <th style={{ textAlign: 'right' }}>Peso / Caixas</th>
                    <th style={{ textAlign: 'right' }}>Valor Est.</th>
                    <th style={{ textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {fila.devolucoes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-20 text-muted">
                        Nenhuma devolução pendente de NF-e fiscal.
                      </td>
                    </tr>
                  ) : (
                    fila.devolucoes.map((d) => (
                      <tr key={d.id}>
                        <td className="font-mono font-bold text-xs text-warning">{d.codigo}</td>
                        <td>
                          <div className="font-bold text-sm">{d.cliente_nome || '-'}</div>
                          <div className="text-xs text-muted font-mono">{d.pedido_codigo || '-'}</div>
                        </td>
                        <td className="text-xs">{d.motivo}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {Number(d.peso_total_kg || 0).toFixed(2)} kg ({d.qtd_caixas} cx)
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm">
                          {fmtMoeda(d.valor_estimado)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => handleEmitirDevolucao(d)}
                          >
                            <RotateCcw size={13} /> Emitir NF-e Devolução
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: NOTAS EMITIDAS */}
      {aba === 'NOTAS' && (
        <div className="flex flex-col gap-12">
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="flex flex-wrap items-center justify-between gap-10">
              <div className="flex gap-6 flex-wrap">
                {[
                  { id: '', label: 'Todos Modelos' },
                  { id: '55', label: 'NF-e (55)' },
                  { id: '65', label: 'NFC-e (65)' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`btn btn--sm ${modeloFiltro === m.id ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setModeloFiltro(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
                <select
                  className="form-input"
                  style={{ width: 140, height: 32, fontSize: 12, padding: '2px 8px' }}
                  value={statusFiltro}
                  onChange={(e) => setStatusFiltro(e.target.value)}
                >
                  <option value="TODOS">Todos Status</option>
                  <option value="AUTORIZADA">Autorizadas</option>
                  <option value="CANCELADA">Canceladas</option>
                </select>
              </div>
              <div style={{ position: 'relative', minWidth: 250 }}>
                <Search
                  size={14}
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 32, height: 34, fontSize: 12.5 }}
                  placeholder="Nº NF, chave de acesso, cliente..."
                  value={buscaNota}
                  onChange={(e) => setBuscaNota(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Modelo / Nº</th>
                    <th>Emissão</th>
                    <th>Destinatário / Chave</th>
                    <th style={{ textAlign: 'right' }}>Total NF</th>
                    <th>Situação</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-24 text-muted">
                        Nenhuma nota fiscal emitida neste filtro.
                      </td>
                    </tr>
                  ) : (
                    notas.map((n) => (
                      <tr key={n.id}>
                        <td>
                          <span className={`badge ${n.modelo === '65' ? 'badge--warning' : 'badge--info'}`}>
                            {n.modelo === '65' ? 'NFC-e 65' : 'NF-e 55'}
                          </span>
                          <div className="font-mono font-bold text-xs mt-4">
                            Nº {String(n.numero).padStart(6, '0')} • S{n.serie}
                          </div>
                        </td>
                        <td className="text-xs font-mono">
                          <div>{fmtDataHora(n.data_autorizacao || n.created_at)}</div>
                          <div className="text-muted">{n.ambiente}</div>
                        </td>
                        <td>
                          <div className="font-bold text-sm">{n.destinatario_nome}</div>
                          <div className="text-[11px] font-mono text-muted">
                            {n.chave_acesso}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-sm text-cyan">
                          {fmtMoeda(n.valor_total_nf)}
                          <div className="text-[11px] text-muted font-normal">ICMS: {fmtMoeda(n.valor_icms)}</div>
                        </td>
                        <td>
                          {n.status === 'AUTORIZADA' ? (
                            <span className="badge badge--success">Autorizada</span>
                          ) : (
                            <span className="badge badge--danger">{n.status}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex justify-end gap-6 flex-wrap">
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              title="Visualizar e Imprimir DANFE"
                              onClick={() => abrirDanfe(n.id)}
                            >
                              <Printer size={13} /> DANFE
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              title="Baixar XML 4.00"
                              onClick={() => baixarXmlNota(n.id)}
                            >
                              <Download size={13} /> XML
                            </button>
                            {n.status === 'AUTORIZADA' && n.modelo === '55' && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                title="Emitir Carta de Correção (CC-e)"
                                onClick={() => setModalEvento({ tipo: 'CCE', nota: n, texto: '' })}
                              >
                                CC-e
                              </button>
                            )}
                            {n.status === 'AUTORIZADA' && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm text-danger"
                                title="Cancelar Nota Fiscal"
                                onClick={() => setModalEvento({ tipo: 'CANCELAR', nota: n, texto: '' })}
                              >
                                <Ban size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: COFRE XML DO CONTADOR */}
      {aba === 'COFRE' && (
        <div className="flex flex-col gap-12">
          <div className="card p-16 flex flex-wrap items-center justify-between gap-12">
            <div className="flex items-center gap-12 flex-wrap">
              <div>
                <label className="form-label">Mês de Competência</label>
                <input
                  type="month"
                  className="form-input font-mono"
                  value={mesCofre}
                  onChange={(e) => setMesCofre(e.target.value)}
                />
              </div>
              <div className="text-xs text-muted flex gap-16 flex-wrap mt-16">
                <span>Notas: <strong>{cofre.resumo?.qtd_notas || 0}</strong></span>
                <span>Eventos: <strong>{cofre.resumo?.qtd_eventos || 0}</strong></span>
                <span>Autorizado: <strong className="font-mono text-success">{fmtMoeda(cofre.resumo?.valor_total_autorizado)}</strong></span>
              </div>
            </div>
            <button
              type="button"
              className="btn btn--success"
              disabled={!cofre.arquivos?.length}
              onClick={exportarPacoteContador}
            >
              <Download size={15} /> Exportar Pacote Mensal p/ Contador (XML + CSV)
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Arquivo XML</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Destinatário / Evento</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th style={{ textAlign: 'right' }}>Baixar</th>
                  </tr>
                </thead>
                <tbody>
                  {(cofre.arquivos || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-24 text-muted">
                        Nenhum XML armazenado em {mesCofre}.
                      </td>
                    </tr>
                  ) : (
                    cofre.arquivos.map((a, idx) => (
                      <tr key={idx}>
                        <td className="font-mono text-xs font-bold">{a.nome}</td>
                        <td><span className="badge badge--info">{a.tipo}</span></td>
                        <td className="text-xs">{a.status}</td>
                        <td className="text-xs">{a.destinatario}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {a.valor > 0 ? fmtMoeda(a.valor) : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => downloadTextFile(a.nome, a.xml)}
                          >
                            <Download size={13} /> XML
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 4: EVENTOS & INUTILIZAÇÃO */}
      {aba === 'EVENTOS' && (
        <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(300px, 380px) 1fr' }}>
          <form className="card p-16 flex flex-col gap-12" onSubmit={handleInutilizar}>
            <h3 className="text-sm font-bold m-0">Inutilizar Faixa de Numeração</h3>
            <p className="text-xs text-muted m-0">
              Use quando houver pulo de numeração de NF-e/NFC-e não utilizada na SEFAZ.
            </p>
            <div className="form-grid form-grid--2">
              <div>
                <label className="form-label">Modelo</label>
                <select className="form-input" value={inutForm.modelo} onChange={(e) => setInutForm({ ...inutForm, modelo: e.target.value })}>
                  <option value="55">55 — NF-e</option>
                  <option value="65">65 — NFC-e</option>
                </select>
              </div>
              <div>
                <label className="form-label">Série</label>
                <input type="number" min="1" className="form-input font-mono" value={inutForm.serie} onChange={(e) => setInutForm({ ...inutForm, serie: Number(e.target.value) })} />
              </div>
            </div>
            <div className="form-grid form-grid--2">
              <div>
                <label className="form-label">Nº Inicial *</label>
                <input type="number" min="1" required className="form-input font-mono" value={inutForm.numero_inicial} onChange={(e) => setInutForm({ ...inutForm, numero_inicial: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Nº Final *</label>
                <input type="number" min="1" required className="form-input font-mono" value={inutForm.numero_final} onChange={(e) => setInutForm({ ...inutForm, numero_final: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="form-label">Justificativa SEFAZ (mín. 15 caracteres) *</label>
              <textarea required minLength={15} rows={3} className="form-input" placeholder="Ex: Pulo de numeração por falha de sistema..." value={inutForm.justificativa} onChange={(e) => setInutForm({ ...inutForm, justificativa: e.target.value })} />
            </div>
            <button type="submit" className="btn btn--secondary">
              Registrar Inutilização
            </button>
          </form>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-14 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-sm font-bold m-0">Histórico de Eventos Fiscais (CC-e, Cancelamentos &amp; Inutilizações)</h3>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Mod / Série / Faixa</th>
                    <th>Descrição / Justificativa</th>
                    <th>Protocolo</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center p-24 text-muted">
                        Nenhum evento fiscal registrado ainda.
                      </td>
                    </tr>
                  ) : (
                    eventos.map((ev) => (
                      <tr key={ev.id}>
                        <td className="text-xs font-mono">{fmtDataHora(ev.created_at)}</td>
                        <td>
                          <span
                            className={`badge ${
                              ev.tipo_evento === 'CANCELAMENTO'
                                ? 'badge--danger'
                                : ev.tipo_evento === 'CARTA_CORRECAO'
                                  ? 'badge--info'
                                  : 'badge--warning'
                            }`}
                          >
                            {ev.tipo_evento} #{ev.sequencia}
                          </span>
                        </td>
                        <td className="font-mono text-xs">
                          Mod {ev.modelo} • S{ev.serie} • {ev.numero_inicial}
                          {ev.numero_final !== ev.numero_inicial ? `–${ev.numero_final}` : ''}
                        </td>
                        <td className="text-xs">{ev.descricao}</td>
                        <td className="font-mono text-xs text-muted">{ev.protocolo}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 5: CERTIFICADO A1 & CONFIGURAÇÃO */}
      {aba === 'CONFIG' && (
        <AbaConfigCertificado
          config={config}
          onAtualizar={carregarTudo}
          toastSuccess={toastSuccess}
          toastError={toastError}
        />
      )}

      {/* MODAL PRÉ-VISUALIZAÇÃO TRIBUTÁRIA & EMISSÃO DE PEDIDO */}
      {previewPedido && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setPreviewPedido(null)}>
          <div className="card" style={{ width: '96%', maxWidth: 920, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="text-base font-bold m-0 flex items-center gap-8">
                  <ShieldCheck size={18} className="text-success" /> Conferência Tributária — {previewPedido.preview.pedido_codigo} ({previewPedido.modelo === '65' ? 'NFC-e 65' : 'NF-e 55'})
                </h3>
                <div className="text-xs text-muted mt-2">
                  Destinatário: <strong>{previewPedido.preview.destinatario.nome}</strong> (UF {previewPedido.preview.destinatario.uf}) • Regime Emitente: <strong>{previewPedido.preview.emitente.regime}</strong>
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setPreviewPedido(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="p-20 overflow-auto flex flex-col gap-14">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>NCM</th>
                      <th>CFOP</th>
                      <th>CST/CSOSN</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>ICMS / Red.BC</th>
                      <th style={{ textAlign: 'right' }}>PIS/COFINS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(previewPedido.preview.itens || []).map((it) => (
                      <tr key={it.n_item}>
                        <td>
                          <div className="font-bold text-xs">{it.codigo} — {it.descricao}</div>
                          <div className="text-[11px] text-muted">{it.regra_origem}</div>
                        </td>
                        <td className="font-mono text-xs">{it.ncm}</td>
                        <td className="font-mono font-bold text-xs text-cyan">{it.cfop}</td>
                        <td className="font-mono text-xs">{it.cst_csosn}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">{it.qtd.toFixed(3)} {it.unidade}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs">{fmtMoeda(it.valor_total)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(it.v_icms)}
                          {it.p_red_bc > 0 && <div className="text-[10px] text-success">Red. {it.p_red_bc}%</div>}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(it.v_pis + it.v_cofins)}
                          <div className="text-[10px] text-muted">CST {it.cst_pis}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Frete Destacado (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input font-mono"
                    value={previewPedido.valor_frete}
                    onChange={(e) => setPreviewPedido({ ...previewPedido, valor_frete: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Informação Adicional Extra (Opcional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: Entregar na porta fundos / placa..."
                    value={previewPedido.inf_complementar}
                    onChange={(e) => setPreviewPedido({ ...previewPedido, inf_complementar: e.target.value })}
                  />
                </div>
              </div>

              <div className="p-12 rounded flex flex-wrap justify-between items-center gap-12" style={{ background: 'var(--bg-2)' }}>
                <div className="text-xs flex gap-16 flex-wrap">
                  <span>BC ICMS: <strong className="font-mono">{fmtMoeda(previewPedido.preview.totais.valor_icms_base)}</strong></span>
                  <span>ICMS: <strong className="font-mono">{fmtMoeda(previewPedido.preview.totais.valor_icms)}</strong></span>
                  <span>PIS/COFINS: <strong className="font-mono">{fmtMoeda(previewPedido.preview.totais.valor_pis + previewPedido.preview.totais.valor_cofins)}</strong></span>
                </div>
                <div className="text-base font-bold font-mono text-cyan">
                  Total NF: {fmtMoeda(previewPedido.preview.totais.valor_total_nf + Number(previewPedido.valor_frete || 0))}
                </div>
              </div>
            </div>

            <div className="p-16 border-t border-border flex justify-end gap-8" style={{ background: 'var(--bg-2)' }}>
              <button type="button" className="btn btn--ghost" onClick={() => setPreviewPedido(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn--success" disabled={emitindo} onClick={confirmarEmissaoPedido}>
                <Send size={15} /> {emitindo ? 'Transmitindo...' : `Autorizar e Emitir ${previewPedido.modelo === '65' ? 'NFC-e' : 'NF-e'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CANCELAMENTO / CC-e */}
      {modalEvento && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalEvento(null)}>
          <div className="card" style={{ width: '96%', maxWidth: 520, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0">
                {modalEvento.tipo === 'CANCELAR' ? 'Cancelar Nota Fiscal' : 'Emitir Carta de Correção (CC-e)'} — Nº {modalEvento.nota.numero}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalEvento(null)}>
                <X size={18} />
              </button>
            </div>
            <form className="p-20 flex flex-col gap-12" onSubmit={confirmarEventoModal}>
              <div>
                <label className="form-label">
                  {modalEvento.tipo === 'CANCELAR'
                    ? 'Justificativa do Cancelamento (mín. 15 caracteres) *'
                    : 'Texto da Correção CC-e (mín. 15 caracteres) *'}
                </label>
                <textarea
                  required
                  minLength={15}
                  rows={4}
                  className="form-input"
                  value={modalEvento.texto}
                  onChange={(e) => setModalEvento({ ...modalEvento, texto: e.target.value })}
                  placeholder={
                    modalEvento.tipo === 'CANCELAR'
                      ? 'Ex: Erro no peso faturado do corte de picanha, será emitida nova NF-e.'
                      : 'Ex: Corrige-se a placa do veículo transportador nos dados adicionais para ABC1D23.'
                  }
                />
              </div>
              <div className="flex justify-end gap-8 pt-8 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalEvento(null)}>
                  Voltar
                </button>
                <button
                  type="submit"
                  className={`btn ${modalEvento.tipo === 'CANCELAR' ? 'btn--danger' : 'btn--primary'}`}
                >
                  {modalEvento.tipo === 'CANCELAR' ? 'Confirmar Cancelamento' : 'Transmitir CC-e'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EMISSÃO AVULSA (NF-e 55 OU NFC-e 65) */}
      {modalAvulsa && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalAvulsa(false)}>
          <div className="card" style={{ width: '96%', maxWidth: 620, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex justify-between items-center p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold m-0">Emissão Avulsa — NF-e (55) ou Cupom NFC-e (65)</h3>
              <button type="button" className="btn-icon" onClick={() => setModalAvulsa(false)}>
                <X size={18} />
              </button>
            </div>
            <form className="p-20 flex flex-col gap-12" onSubmit={handleEmitirAvulsa}>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Modelo *</label>
                  <select className="form-input" value={avulsaForm.modelo} onChange={(e) => setAvulsaForm({ ...avulsaForm, modelo: e.target.value })}>
                    <option value="65">65 — NFC-e (Cupom Consumidor 80mm)</option>
                    <option value="55">55 — NF-e (Danfe A4)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Forma de Pagamento</label>
                  <select
                    className="form-input"
                    value={avulsaForm.t_pag}
                    onChange={(e) => {
                      const map = { '17': '17 - PIX', '01': '01 - Dinheiro', '03': '03 - Crédito', '04': '04 - Débito', '15': '15 - Boleto' }
                      setAvulsaForm({ ...avulsaForm, t_pag: e.target.value, forma_pagamento_label: map[e.target.value] || '99 - Outros' })
                    }}
                  >
                    <option value="17">PIX</option>
                    <option value="01">Dinheiro</option>
                    <option value="03">Cartão de Crédito</option>
                    <option value="04">Cartão de Débito</option>
                    <option value="15">Boleto</option>
                  </select>
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Destinatário / Consumidor</label>
                  <input className="form-input" value={avulsaForm.destinatario_nome} onChange={(e) => setAvulsaForm({ ...avulsaForm, destinatario_nome: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">CPF / CNPJ</label>
                  <input className="form-input font-mono" placeholder="Opcional NFC-e" value={avulsaForm.destinatario_doc} onChange={(e) => setAvulsaForm({ ...avulsaForm, destinatario_doc: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="form-label">Selecionar Produto Cadastrado (Opcional)</label>
                <select
                  className="form-input"
                  value={avulsaForm.produto_id}
                  onChange={(e) => {
                    const p = produtosCat.find((x) => x.id === e.target.value)
                    if (p) {
                      setAvulsaForm({
                        ...avulsaForm,
                        produto_id: p.id,
                        codigo: p.codigo || '001',
                        descricao: p.descricao,
                        ncm: p.ncm || '02013000',
                        valor_unitario: String(p.valor_unitario || ''),
                      })
                    }
                  }}
                >
                  <option value="">-- Ou digite manualmente abaixo --</option>
                  {produtosCat.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} — {p.descricao} ({fmtMoeda(p.valor_unitario)}/kg)
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid form-grid--3">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Descrição do Item *</label>
                  <input required className="form-input" value={avulsaForm.descricao} onChange={(e) => setAvulsaForm({ ...avulsaForm, descricao: e.target.value })} placeholder="Ex: PICANHA BOVINA RESFRIADA" />
                </div>
                <div>
                  <label className="form-label">NCM *</label>
                  <input required className="form-input font-mono" value={avulsaForm.ncm} onChange={(e) => setAvulsaForm({ ...avulsaForm, ncm: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Quantidade (kg/un) *</label>
                  <input required type="number" step="0.001" min="0.001" className="form-input font-mono" value={avulsaForm.qtd} onChange={(e) => setAvulsaForm({ ...avulsaForm, qtd: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Valor Unitário (R$) *</label>
                  <input required type="number" step="0.01" min="0.01" className="form-input font-mono" value={avulsaForm.valor_unitario} onChange={(e) => setAvulsaForm({ ...avulsaForm, valor_unitario: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-8 pt-10 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalAvulsa(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--success" disabled={emitindo}>
                  <Send size={14} /> {emitindo ? 'Emitindo...' : 'Emitir Documento Fiscal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DANFE / CUPOM NFC-e */}
      <DanfePrintModal
        nota={notaDanfe}
        onClose={() => setNotaDanfe(null)}
        onBaixarXml={baixarXmlNota}
      />
    </div>
  )
}
