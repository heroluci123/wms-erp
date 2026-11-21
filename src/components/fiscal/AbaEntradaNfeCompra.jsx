import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Barcode,
  CheckCircle2,
  CreditCard,
  Download,
  FileCheck2,
  FileCode2,
  FileUp,
  FlaskConical,
  Link2,
  RefreshCw,
  Search,
  ShoppingCart,
  X,
} from 'lucide-react'
import { fiscalQueries } from '../../queries/fiscal'
import * as produtosQueries from '../../queries/produtos'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-')
    return `${day}/${m}/${y}`
  }
  try {
    return new Date(d).toLocaleDateString('pt-BR')
  } catch {
    return String(d)
  }
}

function downloadXmlFile(filename, content) {
  const blob = new Blob([content], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function AbaEntradaNfeCompra({
  toastSuccess,
  toastError,
  toastWarning,
  onEscriturado,
  pcInicialId = '',
}) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(false)
  const [pedidosPendentes, setPedidosPendentes] = useState([])
  const [notasEntrada, setNotasEntrada] = useState([])
  const [produtosCatalogo, setProdutosCatalogo] = useState([])
  const [centrosCusto, setCentrosCusto] = useState([])
  const [controlarInsumosAtivo, setControlarInsumosAtivo] = useState(false)

  // Tipo de entrada fiscal: COMPRA_ESTOQUE (exige PC) | HIGIENE_CONSUMO_DIRETO (sem PC, sem limite) | INSUMO_DIRETO
  const [tipoEntrada, setTipoEntrada] = useState('COMPRA_ESTOQUE')
  const [centroCustoDiretoId, setCentroCustoDiretoId] = useState('')
  const [categoriaDreDireta, setCategoriaDreDireta] = useState('HIGIENE / LIMPEZA')

  // Seleção do PC + XML + Chave bipada
  const [pcSelecionadoId, setPcSelecionadoId] = useState(pcInicialId || '')

  useEffect(() => {
    if (pcInicialId) {
      setTipoEntrada('COMPRA_ESTOQUE')
      setPcSelecionadoId(String(pcInicialId))
    }
  }, [pcInicialId])
  const [xmlFileName, setXmlFileName] = useState('')
  const [xmlConteudo, setXmlConteudo] = useState('')
  const [mostrarColarXml, setMostrarColarXml] = useState(false)
  const [chaveBipada, setChaveBipada] = useState('')
  const [previewXml, setPreviewXml] = useState(null)
  const [deparaMap, setDeparaMap] = useState({}) // { codigo_fornecedor: produto_id }
  const [salvando, setSalvando] = useState(false)
  const [ultimaEscriturada, setUltimaEscriturada] = useState(null)

  // Filtro da lista de NF-es de compra escrituradas
  const [buscaHist, setBuscaHist] = useState('')

  const carregar = async () => {
    setLoading(true)
    try {
      const [resEnt, prods] = await Promise.all([
        fiscalQueries.listarEntradasCompra(),
        produtosQueries.listar().catch(() => []),
      ])
      setPedidosPendentes(resEnt?.pedidos_pendentes || [])
      setNotasEntrada(resEnt?.notas_entrada || [])
      setCentrosCusto(resEnt?.centros_custo || [])
      setControlarInsumosAtivo(Boolean(resEnt?.controlar_estoque_insumos))
      setProdutosCatalogo(Array.isArray(prods) ? prods : [])
    } catch (err) {
      toastError('Erro ao carregar entradas fiscais de compra', err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pcSelecionado = useMemo(
    () => pedidosPendentes.find((p) => String(p.id) === String(pcSelecionadoId)) || null,
    [pedidosPendentes, pcSelecionadoId]
  )

  const rodarPreview = async (xmlStr, pcIdAlvo = pcSelecionadoId) => {
    const clean = String(xmlStr || '').trim()
    if (!clean) {
      setPreviewXml(null)
      return
    }
    try {
      const pcObj = pedidosPendentes.find((p) => String(p.id) === String(pcIdAlvo))
      const res = await fiscalQueries.previewXmlCompra({
        xml_conteudo: clean,
        pedido_compra_id: pcIdAlvo || null,
        fornecedor_id: pcObj?.fornecedor_id || null,
      })
      setPreviewXml(res)
      const mapInit = {}
      for (const it of res?.nfe?.itens || []) {
        if (it.produto_sugerido_id) {
          mapInit[it.codigo_fornecedor] = it.produto_sugerido_id
        }
      }
      setDeparaMap(mapInit)
    } catch (err) {
      setPreviewXml(null)
      toastError('Erro ao ler XML da NF-e', err.message)
    }
  }

  const handleTrocarPc = (novoPcId) => {
    setPcSelecionadoId(novoPcId)
    if (xmlConteudo.trim()) {
      rodarPreview(xmlConteudo, novoPcId)
    }
  }

  const handleSelecionarArquivoXml = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const txt = await file.text()
      setXmlFileName(file.name)
      setXmlConteudo(txt)
      await rodarPreview(txt, pcSelecionadoId)
    } catch (err) {
      toastError('Erro ao abrir arquivo XML', err.message)
    }
  }

  const handleGerarXmlTesteDoPc = async () => {
    if (!pcSelecionadoId) {
      return toastWarning('Selecione primeiro um Pedido de Compra para gerar o XML de teste.')
    }
    try {
      const res = await fiscalQueries.gerarXmlTesteCompra(pcSelecionadoId)
      downloadXmlFile(res.nome_arquivo, res.xml_conteudo)
      setXmlFileName(res.nome_arquivo)
      setXmlConteudo(res.xml_conteudo)
      setChaveBipada(res.chave_nfe || '')
      await rodarPreview(res.xml_conteudo, pcSelecionadoId)
      toastSuccess(
        `XML de Teste Gerado (${res.nome_arquivo})`,
        `Arquivo baixado no seu PC e carregado na conferência abaixo! Revise e clique em Confirmar Entrada Fiscal.`
      )
    } catch (err) {
      toastError('Erro ao gerar XML de teste', err.message)
    }
  }

  const handleCriarCenarioCompletoTeste = async () => {
    setLoading(true)
    try {
      const res = await fiscalQueries.criarCenarioTesteEntradaCompra()
      downloadXmlFile(res.nome_arquivo, res.xml_conteudo)
      await carregar()
      setPcSelecionadoId(res.pedido_compra_id)
      setXmlFileName(res.nome_arquivo)
      setXmlConteudo(res.xml_conteudo)
      setChaveBipada(res.chave_nfe || '')
      // Roda preview usando o novo pcId
      const prev = await fiscalQueries.previewXmlCompra({
        xml_conteudo: res.xml_conteudo,
        pedido_compra_id: res.pedido_compra_id,
      })
      setPreviewXml(prev)
      const mapInit = {}
      for (const it of prev?.nfe?.itens || []) {
        if (it.produto_sugerido_id) mapInit[it.codigo_fornecedor] = it.produto_sugerido_id
      }
      setDeparaMap(mapInit)
      toastSuccess(
        `Cenário Criado: ${res.pedido_compra_codigo} + XML NF-e ${res.numero_nf}`,
        `O Pedido de Compra aprovado e o arquivo ${res.nome_arquivo} foram gerados e carregados abaixo. Confira os itens/duplicatas e confirme a entrada!`
      )
    } catch (err) {
      toastError('Erro ao criar cenário de teste', err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCriarCenarioHigieneDireta = async () => {
    setLoading(true)
    try {
      const res = await fiscalQueries.criarCenarioTesteEntradaCompra({ tipo_cenario: 'HIGIENE_CONSUMO' })
      downloadXmlFile(res.nome_arquivo, res.xml_conteudo)
      setTipoEntrada('HIGIENE_CONSUMO_DIRETO')
      setPcSelecionadoId('')
      setCategoriaDreDireta('HIGIENE / LIMPEZA')
      setXmlFileName(res.nome_arquivo)
      setXmlConteudo(res.xml_conteudo)
      setChaveBipada(res.chave_nfe || '')
      const prev = await fiscalQueries.previewXmlCompra({ xml_conteudo: res.xml_conteudo })
      setPreviewXml(prev)
      toastSuccess(
        `XML Teste Higiene / Consumo gerado (NF ${res.numero_nf})`,
        'Modo Entrada Direta (sem PC e sem estoque) carregado! Confira o Centro de Custo/Categoria e confirme.',
      )
    } catch (err) {
      toastError('Erro ao criar teste de Higiene', err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmarEscrituracao = async () => {
    const exigePc = tipoEntrada === 'COMPRA_ESTOQUE' || (tipoEntrada === 'INSUMO_DIRETO' && controlarInsumosAtivo)
    if (exigePc && !pcSelecionadoId) {
      return toastWarning('Selecione o Pedido de Compra vinculado antes de dar entrada na NF-e.')
    }
    if (!xmlConteudo.trim() || !previewXml?.nfe) {
      return toastWarning('Importe ou cole o arquivo XML da NF-e de compra.')
    }
    const chaveLimpa = chaveBipada.replace(/\D/g, '')
    if (chaveLimpa && chaveLimpa.length !== 44) {
      return toastWarning('A chave de acesso bipada precisa ter 44 dígitos (ou deixe em branco para usar a chave do XML).')
    }
    if (chaveLimpa && previewXml.nfe.chave_nfe && chaveLimpa !== previewXml.nfe.chave_nfe) {
      return toastError(
        'Chave divergente!',
        `A chave bipada (${chaveLimpa}) não bate com a chave do XML (${previewXml.nfe.chave_nfe}).`
      )
    }

    const deparaVinculos =
      tipoEntrada === 'COMPRA_ESTOQUE'
        ? (previewXml.nfe.itens || [])
            .filter((it) => deparaMap[it.codigo_fornecedor])
            .map((it) => ({
              codigo_fornecedor: it.codigo_fornecedor,
              descricao_fornecedor: it.descricao,
              ncm: it.ncm,
              produto_id: deparaMap[it.codigo_fornecedor],
              fator_conversao: 1,
            }))
        : []

    setSalvando(true)
    try {
      const res = await fiscalQueries.escriturarEntradaCompra({
        tipo_entrada: tipoEntrada,
        pedido_compra_id: tipoEntrada === 'COMPRA_ESTOQUE' ? pcSelecionadoId : pcSelecionadoId || null,
        centro_custo_id: centroCustoDiretoId || null,
        categoria_dre: tipoEntrada !== 'COMPRA_ESTOQUE' ? categoriaDreDireta : '',
        xml_conteudo: xmlConteudo,
        chave_bipada: chaveLimpa || undefined,
        depara_vinculos: deparaVinculos,
      })
      setUltimaEscriturada(res)
      toastSuccess(
        `NF-e ${res.numero_nf} escriturada com sucesso!`,
        `Vinculada ao ${res.pedido_compra_codigo} • ${res.titulos_gerados?.length || 0} título(s) gerado(s) no Contas a Pagar.`
      )
      setPcSelecionadoId('')
      setXmlFileName('')
      setXmlConteudo('')
      setChaveBipada('')
      setPreviewXml(null)
      setDeparaMap({})
      await carregar()
      await onEscriturado?.()
    } catch (err) {
      toastError('Erro ao escriturar NF-e de compra', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const chaveLimpaInput = chaveBipada.replace(/\D/g, '')
  const chaveStatus = useMemo(() => {
    if (!chaveLimpaInput) return null
    if (chaveLimpaInput.length !== 44) return { ok: false, msg: `Faltam dígitos (${chaveLimpaInput.length}/44)` }
    if (!previewXml?.nfe?.chave_nfe) return { ok: true, msg: 'Chave 44 dígitos lida — importe o XML para confrontar' }
    if (chaveLimpaInput === previewXml.nfe.chave_nfe) {
      return { ok: true, msg: 'Chave bipada confere 100% com o XML da NF-e' }
    }
    return { ok: false, msg: 'Chave bipada DIFERE da chave presente no XML!' }
  }, [chaveLimpaInput, previewXml])

  const notasFiltradas = useMemo(() => {
    const q = buscaHist.trim().toLowerCase()
    if (!q) return notasEntrada
    return notasEntrada.filter((n) =>
      `${n.numero_nf || ''} ${n.chave_nfe || ''} ${n.pedido_compra_codigo || ''} ${n.fornecedor_razao || ''} ${n.fornecedor_nome || ''} ${n.fornecedor_cnpj || ''}`
        .toLowerCase()
        .includes(q)
    )
  }, [notasEntrada, buscaHist])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* FAIXA EXPLICATIVA DO FLUXO DE INTEGRAÇÃO */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div>
          <div className="text-sm font-bold" style={{ color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileUp size={16} /> Escrituração Fiscal de NF-e de Compra (XML) → Contas a Pagar
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            <strong>Compras (Operacional)</strong> cria o Pedido de Compra → <strong>Fiscal (esta tela)</strong> importa o XML vinculado ao Pedido e confere itens/preços/duplicatas → <strong>Financeiro</strong> recebe os títulos oficiais no Contas a Pagar + XML guardado no Cofre do Contador.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => navigate('/compras')}
          >
            <ShoppingCart size={14} /> Ver Pedidos de Compra
          </button>
          <button
            type="button"
            className="btn btn--warning btn--sm"
            onClick={handleCriarCenarioCompletoTeste}
            disabled={loading}
            title="Cria 1 Pedido de Compra aprovado e baixa o XML NF-e correspondente para testar todo o fluxo na hora"
          >
            <FlaskConical size={14} /> Teste PC + XML
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ borderColor: 'rgba(16, 185, 129, 0.45)', color: '#34d399' }}
            onClick={handleCriarCenarioHigieneDireta}
            disabled={loading}
            title="Gera XML de Higiene/Consumo para testar Entrada Direta sem Pedido de Compra e sem estoque"
          >
            <FlaskConical size={14} /> Teste Higiene (Sem PC)
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={carregar} disabled={loading}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* BANNER DE SUCESSO APÓS ESCRITURAR */}
      {ultimaEscriturada && (
        <div
          className="card"
          style={{
            padding: '14px 18px',
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1.5px solid #22c55e',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div className="font-bold text-sm" style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={16} /> NF-e Nº {ultimaEscriturada.numero_nf} (Série {ultimaEscriturada.serie_nf}) escriturada — {ultimaEscriturada.pedido_compra_codigo}!
            </div>
            <div className="text-xs" style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
              Valor Total NF: <strong className="font-mono">{fmtMoeda(ultimaEscriturada.valor_total_nf)}</strong> • Títulos lançados no Contas a Pagar:{' '}
              {(ultimaEscriturada.titulos_gerados || []).map((t) => (
                <span key={t.id} className="badge badge--success font-mono" style={{ marginRight: 6, fontSize: 11 }}>
                  {t.codigo} • Venc. {fmtData(t.data_vencimento)} • {fmtMoeda(t.valor_original)}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn--success btn--sm"
              onClick={() => navigate('/financeiro')}
            >
              <CreditCard size={14} /> Abrir Contas a Pagar <ArrowRight size={14} />
            </button>
            <button type="button" className="btn-icon" onClick={() => setUltimaEscriturada(null)}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* FORMULÁRIO DE ENTRADA FISCAL EM PASSOS */}
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* SELETOR DO MODO DE ENTRADA FISCAL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="text-xs font-bold text-muted">MODALIDADE DE ENTRADA FISCAL:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn--sm ${tipoEntrada === 'COMPRA_ESTOQUE' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setTipoEntrada('COMPRA_ESTOQUE')}
            >
              Com Pedido de Compra (Estoque / Revenda / Empório / Insumos)
            </button>
            <button
              type="button"
              className={`btn btn--sm ${tipoEntrada === 'HIGIENE_CONSUMO_DIRETO' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => {
                setTipoEntrada('HIGIENE_CONSUMO_DIRETO')
                setPcSelecionadoId('')
              }}
            >
              Entrada Direta — Higiene / Uso &amp; Consumo (Sem PC, Sem Estoque)
            </button>
            <button
              type="button"
              className={`btn btn--sm ${tipoEntrada === 'INSUMO_DIRETO' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => {
                setTipoEntrada('INSUMO_DIRETO')
                if (!controlarInsumosAtivo) setPcSelecionadoId('')
              }}
            >
              Insumos / Embalagens ({controlarInsumosAtivo ? 'Exige PC — Controle Ativo' : 'Entrada Direta Liberada'})
            </button>
          </div>
        </div>

        {/* PASSO 1: SELECIONAR PEDIDO DE COMPRA OU CLASSIFICAÇÃO DIRETA */}
        {tipoEntrada === 'HIGIENE_CONSUMO_DIRETO' || (tipoEntrada === 'INSUMO_DIRETO' && !controlarInsumosAtivo) ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="text-sm font-bold" style={{ color: '#34d399' }}>
              1. Entrada Direta sem Pedido de Compra (Sem limite de valor • Não movimenta estoque nem exige De-Para)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <div>
                <label className="form-label">Centro de Custo (DRE)</label>
                <select
                  className="form-input"
                  value={centroCustoDiretoId}
                  onChange={(e) => setCentroCustoDiretoId(e.target.value)}
                >
                  <option value="">-- Selecione o Centro de Custo --</option>
                  {centrosCusto.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.codigo} — {cc.descricao}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Categoria de Despesa (DRE)</label>
                <select
                  className="form-input"
                  value={categoriaDreDireta}
                  onChange={(e) => setCategoriaDreDireta(e.target.value)}
                >
                  <option value="HIGIENE / LIMPEZA">Higiene &amp; Limpeza (Papel, Detergente, Sanitizante)</option>
                  <option value="USO E CONSUMO">Uso &amp; Consumo / Escritório / EPI</option>
                  <option value="MANUTENCAO">Manutenção / Peças / Serviços</option>
                  <option value="INSUMOS / EMBALAGENS">Insumos &amp; Embalagens (Baixa Direta)</option>
                </select>
              </div>
            </div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="text-sm font-bold m-0" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link2 size={16} className="text-primary" /> 1. Vincular Pedido de Compra (Obrigatório)
            </h3>
            {pcSelecionado && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleGerarXmlTesteDoPc}
                title="Gera e baixa um arquivo XML NF-e 4.00 realista baseado nos itens e fornecedor deste Pedido de Compra"
              >
                <Download size={14} /> Baixar XML Simulado deste PC (Teste)
              </button>
            )}
          </div>

          <select
            className="form-input"
            value={pcSelecionadoId}
            onChange={(e) => handleTrocarPc(e.target.value)}
          >
            <option value="">
              {pedidosPendentes.length === 0
                ? 'Nenhum Pedido de Compra pendente de NF-e — crie um em Compras ou clique em "Gerar Cenário de Teste"'
                : `-- Selecione o Pedido de Compra (${pedidosPendentes.length} aguardando NF-e) --`}
            </option>
            {pedidosPendentes.map((pc) => (
              <option key={pc.id} value={pc.id}>
                {pc.codigo} • {pc.fornecedor_nome || pc.fornecedor_razao || 'Fornecedor'} • {pc.qtd_itens} item(ns) ({fmtKg(pc.total_kg_solicitado)}) • {fmtMoeda(pc.valor_total)} [{pc.status}]
              </option>
            ))}
          </select>

          {pcSelecionado && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                fontSize: 12,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
              }}
            >
              <span>Fornecedor: <strong>{pcSelecionado.fornecedor_razao || pcSelecionado.fornecedor_nome}</strong></span>
              <span className="font-mono">CNPJ: <strong>{pcSelecionado.fornecedor_cnpj || '-'}</strong></span>
              <span>Peso Pedido: <strong className="font-mono">{fmtKg(pcSelecionado.total_kg_solicitado)}</strong></span>
              <span>Valor Pedido: <strong className="font-mono text-success">{fmtMoeda(pcSelecionado.valor_total)}</strong></span>
              {pcSelecionado.forma_pagamento_desc && (
                <span>Cond. Pagto: <strong>{pcSelecionado.forma_pagamento_desc}</strong></span>
              )}
            </div>
          )}
        </div>
        )}

        {/* PASSO 2: XML DA NF-e + BIPAR CHAVE DE ACESSO */}
        <div
          style={{
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <h3 className="text-sm font-bold m-0" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCode2 size={16} className="text-cyan" /> 2. Importar XML da NF-e &amp; Conferir Chave de Acesso
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <label className="form-label">Arquivo XML da NF-e (4.00) *</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  style={{ display: 'none' }}
                  onChange={handleSelecionarArquivoXml}
                />
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp size={15} /> {xmlFileName ? `Trocar XML (${xmlFileName})` : 'Selecionar Arquivo .XML'}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setMostrarColarXml((v) => !v)}
                >
                  {mostrarColarXml ? 'Ocultar Texto' : 'Colar XML'}
                </button>
              </div>
            </div>

            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Barcode size={14} /> Bipar Chave de Acesso da DANFE (Opcional — 44 dígitos)
              </label>
              <input
                type="text"
                className="form-input font-mono"
                placeholder="Bipe o código de barras da DANFE para conferir com o XML..."
                value={chaveBipada}
                onChange={(e) => setChaveBipada(e.target.value)}
              />
              {chaveStatus && (
                <div
                  className="text-xs font-bold"
                  style={{
                    marginTop: 4,
                    color: chaveStatus.ok ? '#4ade80' : '#f87171',
                  }}
                >
                  {chaveStatus.ok ? '✅' : '❌'} {chaveStatus.msg}
                </div>
              )}
            </div>
          </div>

          {mostrarColarXml && (
            <div>
              <textarea
                className="form-input font-mono"
                rows={5}
                placeholder="Cole aqui o conteúdo completo do arquivo XML (<nfeProc>...</nfeProc>)..."
                value={xmlConteudo}
                onChange={(e) => setXmlConteudo(e.target.value)}
                onBlur={() => xmlConteudo.trim() && rodarPreview(xmlConteudo, pcSelecionadoId)}
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                style={{ marginTop: 6 }}
                onClick={() => rodarPreview(xmlConteudo, pcSelecionadoId)}
              >
                Ler XML Colado
              </button>
            </div>
          )}
        </div>

        {/* PASSO 3: CONFERÊNCIA 3-WAY (XML x PEDIDO DE COMPRA) + DUPLICATAS */}
        {previewXml?.nfe && (
          <div
            style={{
              paddingTop: 14,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h3 className="text-sm font-bold m-0" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileCheck2 size={16} className="text-success" /> 3. Conferência Fiscal (XML × Pedido de Compra) &amp; Duplicatas
            </h3>

            {/* KPIs do XML */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="text-xs text-muted uppercase">NF-e / Série</div>
                <div className="font-mono font-bold text-base" style={{ marginTop: 4 }}>
                  Nº {previewXml.nfe.numero_nf} / S{previewXml.nfe.serie}
                </div>
                <div className="text-xs text-muted">{fmtData(previewXml.nfe.data_emissao)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="text-xs text-muted uppercase">Emitente (Fornecedor)</div>
                <div className="font-bold text-xs" style={{ marginTop: 4 }}>
                  {previewXml.nfe.emitente?.razao_social || '-'}
                </div>
                <div className="text-xs text-muted font-mono">
                  CNPJ {previewXml.nfe.emitente?.cnpj || '-'} • {previewXml.nfe.emitente?.uf || ''}
                </div>
              </div>
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="text-xs text-muted uppercase">Produtos + Frete</div>
                <div className="font-mono font-bold text-sm" style={{ marginTop: 4 }}>
                  {fmtMoeda(previewXml.nfe.totais?.valor_produtos)}
                </div>
                <div className="text-xs text-muted font-mono">
                  Frete: {fmtMoeda(previewXml.nfe.totais?.valor_frete)} • Desc.: {fmtMoeda(previewXml.nfe.totais?.valor_desconto)}
                </div>
              </div>
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.4)' }}>
                <div className="text-xs text-muted uppercase">Valor Total da NF-e</div>
                <div className="font-mono font-bold text-lg text-success" style={{ marginTop: 4 }}>
                  {fmtMoeda(previewXml.nfe.totais?.valor_nf)}
                </div>
                <div className="text-xs text-muted">{(previewXml.nfe.itens || []).length} item(ns) no XML</div>
              </div>
            </div>

            {/* Itens do XML com De-Para e comparativo de preço com o PC */}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cód. Forn.</th>
                    <th>Produto no XML</th>
                    <th>Produto Interno (De-Para)</th>
                    <th style={{ textAlign: 'right' }}>Qtd. NF</th>
                    <th style={{ textAlign: 'right' }}>Preço NF</th>
                    <th style={{ textAlign: 'right' }}>Preço PC / Dif.</th>
                    <th style={{ textAlign: 'right' }}>Total Item</th>
                  </tr>
                </thead>
                <tbody>
                  {(previewXml.nfe.itens || []).map((it) => {
                    const prodIdAtual = deparaMap[it.codigo_fornecedor] || ''
                    const divPct = it.divergencia_preco_pct
                    const divAlta = divPct != null && Math.abs(divPct) > 2
                    return (
                      <tr key={`${it.n_item}_${it.codigo_fornecedor}`}>
                        <td className="font-mono text-xs">{it.codigo_fornecedor}</td>
                        <td>
                          <div className="font-bold text-xs">{it.descricao}</div>
                          <div className="text-xs text-muted font-mono">
                            NCM {it.ncm} • CFOP {it.cfop} {it.lote ? `• Lote ${it.lote}` : ''}
                          </div>
                        </td>
                        <td style={{ minWidth: 220 }}>
                          <select
                            className="form-input"
                            style={{
                              fontSize: 12,
                              padding: '4px 8px',
                              borderColor: !prodIdAtual ? '#f59e0b' : undefined,
                            }}
                            value={prodIdAtual}
                            onChange={(e) =>
                              setDeparaMap((prev) => ({ ...prev, [it.codigo_fornecedor]: e.target.value }))
                            }
                          >
                            <option value="">-- Vincular produto interno (De-Para) --</option>
                            {produtosCatalogo.map((p) => (
                              <option key={p.id} value={p.id}>
                                [{p.codigo}] {p.descricao}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {Number(it.quantidade || 0).toFixed(3)} {it.unidade}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                          {fmtMoeda(it.valor_unitario)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {it.pc_preco_unitario != null ? (
                            <div>
                              <div>{fmtMoeda(it.pc_preco_unitario)}</div>
                              <span
                                className={`badge ${divAlta ? 'badge--danger' : 'badge--success'}`}
                                style={{ fontSize: 10 }}
                              >
                                {divPct > 0 ? `+${divPct}%` : `${divPct}%`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold text-success">
                          {fmtMoeda(it.valor_total)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Prévia das Duplicatas -> Contas a Pagar */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="text-xs font-bold uppercase text-warning mb-8" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CreditCard size={14} /> Títulos que serão lançados automaticamente no Contas a Pagar
              </div>
              {Array.isArray(previewXml.nfe.duplicatas) && previewXml.nfe.duplicatas.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {previewXml.nfe.duplicatas.map((d, idx) => (
                    <div
                      key={`${d.numero}_${idx}`}
                      className="font-mono text-xs"
                      style={{
                        padding: '7px 12px',
                        borderRadius: 6,
                        background: 'var(--bg-1)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <strong>Duplicata #{d.numero || idx + 1}</strong> • Venc.:{' '}
                      <strong>{fmtData(d.vencimento)}</strong> •{' '}
                      <span className="text-warning font-bold">{fmtMoeda(d.valor)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} className="text-warning" /> XML sem tag &lt;dup&gt;: o Contas a Pagar será gerado usando o Valor Total da NF-e ({fmtMoeda(previewXml.nfe.totais?.valor_nf)}) + condição de pagamento do Pedido de Compra.
                </div>
              )}
            </div>

            {/* Botão Final */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setXmlFileName('')
                  setXmlConteudo('')
                  setChaveBipada('')
                  setPreviewXml(null)
                }}
              >
                Limpar XML
              </button>
              <button
                type="button"
                className="btn btn--success"
                disabled={
                  salvando ||
                  ((tipoEntrada === 'COMPRA_ESTOQUE' || (tipoEntrada === 'INSUMO_DIRETO' && controlarInsumosAtivo)) &&
                    !pcSelecionadoId) ||
                  (chaveStatus && !chaveStatus.ok)
                }
                onClick={handleConfirmarEscrituracao}
              >
                <CheckCircle2 size={16} />
                {salvando
                  ? 'Escriturando e Gerando Contas a Pagar...'
                  : 'Confirmar Entrada Fiscal & Gerar Contas a Pagar'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HISTÓRICO DE NF-es DE COMPRA ESCRITURADAS */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '14px 18px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <h3 className="text-sm font-bold m-0">
              NF-es de Compra Escrituradas ({notasFiltradas.length})
            </h3>
            <div className="text-xs text-muted" style={{ marginTop: 2 }}>
              Histórico fiscal de notas de entrada vinculadas a Pedidos de Compra e seus títulos no Contas a Pagar.
            </div>
          </div>
          <div style={{ position: 'relative', width: 290 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: 32 }}
              placeholder="Buscar Nº NF, PC, fornecedor ou chave..."
              value={buscaHist}
              onChange={(e) => setBuscaHist(e.target.value)}
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>NF-e / Série</th>
                <th>Pedido Compra</th>
                <th>Fornecedor</th>
                <th>Emissão</th>
                <th style={{ textAlign: 'right' }}>Valor Total NF</th>
                <th>Contas a Pagar Gerado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center p-24 text-muted">
                    Carregando notas de entrada...
                  </td>
                </tr>
              ) : notasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center p-24 text-muted">
                    Nenhuma NF-e de compra escriturada ainda. Selecione um Pedido de Compra acima ou clique em &quot;Gerar Cenário de Teste (PC + XML)&quot;.
                  </td>
                </tr>
              ) : (
                notasFiltradas.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <div className="font-mono font-bold">
                        NF {n.numero_nf || '-'} / S{n.serie_nf || '1'}
                      </div>
                      {n.chave_nfe && (
                        <div className="text-xs text-muted font-mono" title={n.chave_nfe}>
                          {String(n.chave_nfe).slice(0, 14)}...{String(n.chave_nfe).slice(-8)}
                        </div>
                      )}
                    </td>
                    <td>
                      {n.pedido_compra_codigo ? (
                        <span className="badge badge--info font-mono">{n.pedido_compra_codigo}</span>
                      ) : (
                        <span className="text-xs text-muted">Avulsa</span>
                      )}
                    </td>
                    <td>
                      <div className="font-bold text-xs">{n.fornecedor_razao || n.fornecedor_nome || '-'}</div>
                      <div className="text-xs text-muted font-mono">{n.fornecedor_cnpj || ''}</div>
                    </td>
                    <td className="font-mono text-xs">{fmtData(n.data_emissao_nf || n.created_at)}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">
                      {fmtMoeda(n.valor_total_nf)}
                    </td>
                    <td>
                      {n.qtd_titulos_pagar > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(n.titulos_pagar || []).map((t) => (
                            <span
                              key={t.id}
                              className={`badge ${t.status === 'PAGO' ? 'badge--success' : 'badge--warning'} font-mono`}
                              style={{ fontSize: 10.5 }}
                            >
                              {t.codigo} ({fmtData(t.data_vencimento)} • {fmtMoeda(t.valor_original)})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="badge badge--neutral" style={{ fontSize: 11 }}>
                          Sem título
                        </span>
                      )}
                    </td>
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
