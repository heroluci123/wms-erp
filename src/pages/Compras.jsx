import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ShoppingBag,
  Plus,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  RefreshCw,
  Eye,
  Trash2,
  AlertTriangle,
  Truck,
  X,
  Upload,
  FileText,
  FileCode2,
  FileUp,
  ArrowRightLeft,
  Settings2,
  Boxes,
  Check,
  Printer,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { temPermissao } from '../utils/permissoes'
import { isApiEnabled } from '../lib/apiClient'
import { comprasQueries } from '../queries/compras'
import { cadastrosQueries } from '../queries/cadastros'
import * as produtosQueries from '../queries/produtos.js'
import { RelatorioRecebimentoPrint } from '../components/shared/RelatorioRecebimentoPrint'
import { SeletorItemCompra } from '../components/compras/SeletorItemCompra'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`
const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const TIPO_COMPRA_BADGE = {
  MATERIA_PRIMA: { label: 'Matéria-Prima', cls: 'badge--info' },
  REVENDA: { label: 'Revenda', cls: 'badge--primary' },
  EMPORIO: { label: 'Empório / Loja', cls: 'badge--success' },
  INSUMO: { label: 'Insumos / Emb.', cls: 'badge--warning' },
  HIGIENE_CONSUMO: { label: 'Higiene / Consumo', cls: 'badge--neutral' },
}

const STATUS_PC_BADGE = {
  ABERTO: { label: 'Em Aberto', cls: 'badge--neutral' },
  APROVADO: { label: 'Aprovado p/ Doca', cls: 'badge--info' },
  PARCIAL: { label: 'Recebimento Parcial', cls: 'badge--warning' },
  RECEBIDO: { label: 'Recebido / Fechado', cls: 'badge--success' },
  CANCELADO: { label: 'Cancelado', cls: 'badge--danger' },
}

const STATUS_VAL_BADGE = {
  AGUARDANDO_BIPAGEM: { label: 'Aguardando Doca', cls: 'badge--neutral' },
  AGUARDANDO_VALIDACAO_SISTEMICA: { label: 'Validar 3-Way', cls: 'badge--warning' },
  DIVERGENTE: { label: 'Divergência ⚠️', cls: 'badge--danger' },
  VALIDADO: { label: 'Validado ✅', cls: 'badge--success' },
}

function readFileAsTextSmart(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`Falha ao ler arquivo ${file.name}`))
    reader.readAsText(file, 'UTF-8')
  })
}

export function Compras() {
  const location = useLocation()
  const navigate = useNavigate()
  const { operador, toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const podeEscrever = temPermissao(operador, 'compras')
  const apiAtiva = isApiEnabled()

  const [abaAtiva, setAbaAtiva] = useState('pedidos') // 'pedidos' | 'importar' | 'depara'
  const [loading, setLoading] = useState(false)
  const [compras, setCompras] = useState([])
  const [travaAtiva, setTravaAtiva] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [busca, setBusca] = useState('')

  const [fornecedores, setFornecedores] = useState([])
  const [produtos, setProdutos] = useState([])
  const [auxiliares, setAuxiliares] = useState({
    centrosCusto: [],
    naturezasOperacao: [],
    marchantes: [],
    formasPagamento: [],
  })
  const [layoutsTxt, setLayoutsTxt] = useState([])
  const [deparas, setDeparas] = useState([])

  // Modal Criar PC (corrigido centralizado com grid responsivo)
  const [modalNovo, setModalNovo] = useState(false)
  const [fornecedorId, setFornecedorId] = useState('')
  const [finalidade, setFinalidade] = useState('MATERIA_PRIMA')
  const [centroCustoId, setCentroCustoId] = useState('')
  const [formaPagamentoId, setFormaPagamentoId] = useState('')
  const [cfopPreview, setCfopPreview] = useState(null)
  const [marchante, setMarchante] = useState('FRIGODIL')
  const [freteValor, setFreteValor] = useState('')
  const [despesasValor, setDespesasValor] = useState('')
  const [previsaoEntrega, setPrevisaoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [aprovarAoCriar, setAprovarAoCriar] = useState(true)
  const [itensForm, setItensForm] = useState([])

  // Modal Detalhe / Validação 3-Way / Relatório
  const [detalhe, setDetalhe] = useState(null)
  const [relatorioRecPedido, setRelatorioRecPedido] = useState(null)

  // Banco Universal de Pré-Caixas (.TXT) por Fornecedor
  const [impFornId, setImpFornId] = useState('')
  const [impAutoCadForn, setImpAutoCadForn] = useState(true)
  const [impLayoutId, setImpLayoutId] = useState('')
  const [impXmlText, setImpXmlText] = useState('')
  const [impXmlFileName, setImpXmlFileName] = useState('')
  const [impXmlPreview, setImpXmlPreview] = useState(null)
  const [impTxtArquivos, setImpTxtArquivos] = useState([]) // [{ nome, conteudo }]
  const [impTxtPreview, setImpTxtPreview] = useState(null)
  const [impDeparaEdits, setImpDeparaEdits] = useState({}) // { [codigoForn]: produtoId }
  const [impExecutando, setImpExecutando] = useState(false)
  const [impResultado, setImpResultado] = useState(null)
  const [poolPreCaixas, setPoolPreCaixas] = useState([])

  // Aba De-Para & Layouts TXT
  const [filtroFornDepara, setFiltroFornDepara] = useState('')
  const [novoDpFornId, setNovoDpFornId] = useState('')
  const [novoDpCod, setNovoDpCod] = useState('')
  const [novoDpDesc, setNovoDpDesc] = useState('')
  const [novoDpProdId, setNovoDpProdId] = useState('')
  const [modalNovoLayout, setModalNovoLayout] = useState(false)
  const [layForm, setLayForm] = useState({
    nome: '',
    fornecedor_id: '',
    delimitador: ';',
    saltar_linhas: 0,
    formato_data: 'DDMMYYYY',
    decimal_ponto: false,
    col_ean: 3,
    col_cod: 4,
    col_desc: 5,
    col_peso: 6,
    col_pecas: 7,
    col_prod: 8,
    col_val: 9,
    col_romaneio: 2,
    col_doc: 10,
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [resCompras, listForn, listProd, aux, lays, dps] = await Promise.all([
        comprasQueries.listarCompras({ status: filtroStatus, busca }),
        apiAtiva ? cadastrosQueries.listarFornecedores().catch(() => []) : Promise.resolve([]),
        produtosQueries.listar().catch(() => []),
        apiAtiva
          ? cadastrosQueries
              .listarAuxiliares()
              .catch(() => ({ centrosCusto: [], naturezasOperacao: [], marchantes: [], formasPagamento: [] }))
          : Promise.resolve({ centrosCusto: [], naturezasOperacao: [], marchantes: [], formasPagamento: [] }),
        apiAtiva ? comprasQueries.listarLayoutsTxt().catch(() => []) : Promise.resolve([]),
        apiAtiva ? comprasQueries.listarDepara().catch(() => []) : Promise.resolve([]),
      ])
      if (apiAtiva) {
        comprasQueries.listarPreCaixasRecebimento({ status: 'PENDENTE' }).then((r) => setPoolPreCaixas(r?.data || [])).catch(() => {})
      }
      setCompras(resCompras.data || [])
      setTravaAtiva(Boolean(resCompras.trava_recebimento_sem_pc))
      setFornecedores(listForn || [])
      setProdutos(listProd || [])
      setAuxiliares(aux || { centrosCusto: [], naturezasOperacao: [], marchantes: [], formasPagamento: [] })
      setLayoutsTxt(lays || [])
      setDeparas(dps || [])
      if (!centroCustoId && aux?.centrosCusto?.length > 0) {
        setCentroCustoId(aux.centrosCusto[0].id)
      }
      if (!impLayoutId && lays?.length > 0) {
        setImpLayoutId(lays[0].id)
      }
      const marcPadrao =
        (aux?.marchantes || []).find((m) => Number(m.is_padrao) === 1)?.nome || aux?.marchantes?.[0]?.nome
      if (marcPadrao) setMarchante((prev) => prev || marcPadrao)
    } catch (err) {
      toastError('Erro', err.message || 'Falha ao carregar compras.')
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, filtroStatus, busca, toastError, centroCustoId, impLayoutId])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const pre = location.state?.prefillItens
    if (Array.isArray(pre) && pre.length > 0) {
      setItensForm(
        pre.map((p) => ({
          produto_id: p.produto_id,
          produto_codigo: p.produto_codigo,
          produto_descricao: p.produto_descricao,
          qtd_kg_solicitada: Number(p.qtd_kg_solicitada || 0),
          preco_unitario_kg: Number(p.preco_unitario_kg || 0),
        })),
      )
      setModalNovo(true)
    }
  }, [location.state])

  useEffect(() => {
    if (!apiAtiva || !fornecedorId) {
      setCfopPreview(null)
      return
    }
    const f = fornecedores.find((x) => x.id === fornecedorId)
    if (!f) return
    cadastrosQueries
      .sugerirCfop({ tipo_movimento: 'ENTRADA', finalidade, uf_parceiro: f.uf || 'SP' })
      .then((res) => setCfopPreview(res?.data || res || null))
      .catch(() => setCfopPreview(null))
  }, [apiAtiva, fornecedorId, finalidade, fornecedores])

  const kpis = useMemo(() => {
    return {
      abertos: compras.filter((c) => c.status === 'ABERTO').length,
      aprovados: compras.filter((c) => ['APROVADO', 'PARCIAL'].includes(c.status)).length,
      validacao: compras.filter((c) => ['AGUARDANDO_VALIDACAO_SISTEMICA', 'DIVERGENTE'].includes(c.status_validacao)).length,
      recebidos: compras.filter((c) => c.status === 'RECEBIDO').length,
    }
  }, [compras])

  const produtosOrdenados = useMemo(() => {
    return [...produtos].sort((a, b) => {
      const mpA = a.classificacao === 'MATERIA_PRIMA' || a.tipo_produto === 'Materia Prima' ? 0 : 1
      const mpB = b.classificacao === 'MATERIA_PRIMA' || b.tipo_produto === 'Materia Prima' ? 0 : 1
      if (mpA !== mpB) return mpA - mpB
      return String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR')
    })
  }, [produtos])

  const handleToggleTrava = async () => {
    if (!podeEscrever) return toastWarning('Sem permissão', 'Requer permissão de Compras.')
    try {
      const novo = !travaAtiva
      await comprasQueries.salvarConfigModulos({ trava_recebimento_sem_pc: novo })
      setTravaAtiva(novo)
      toastSuccess(
        novo ? 'Trava Ativada 🔒' : 'Trava Desativada',
        novo
          ? 'A Doca agora exige Pedido de Compra aprovado para receber mercadorias.'
          : 'A Doca pode receber caixas com ou sem Pedido de Compra vinculado.',
      )
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleIncluirItemSelecionado = ({
    produto,
    qtd_kg_solicitada,
    preco_unitario_kg,
    codigo_fornecedor_usado,
  }) => {
    if (!produto) return
    const qtd = Number(qtd_kg_solicitada || 0)
    const preco = Math.max(0, Number(preco_unitario_kg || 0))
    setItensForm((prev) => {
      const idx = prev.findIndex((i) => i.produto_id === produto.id)
      if (idx >= 0) {
        const clone = [...prev]
        clone[idx] = {
          ...clone[idx],
          qtd_kg_solicitada: Number((clone[idx].qtd_kg_solicitada + qtd).toFixed(3)),
          preco_unitario_kg: preco > 0 ? preco : clone[idx].preco_unitario_kg,
          codigo_fornecedor_usado: codigo_fornecedor_usado || clone[idx].codigo_fornecedor_usado,
        }
        return clone
      }
      return [
        ...prev,
        {
          produto_id: produto.id,
          produto_codigo: produto.codigo,
          produto_descricao: produto.descricao,
          qtd_kg_solicitada: qtd,
          preco_unitario_kg: preco || Number(produto.custo_medio_kg || 0),
          codigo_fornecedor_usado: codigo_fornecedor_usado || null,
        },
      ]
    })
  }

  const handleSalvarCompra = async (e) => {
    e.preventDefault()
    if (!fornecedorId) return toastWarning('Fornecedor', 'Selecione o fornecedor.')
    if (itensForm.length === 0) return toastWarning('Itens', 'Adicione ao menos um item ao Pedido de Compra.')
    try {
      const res = await comprasQueries.criarCompra({
        fornecedor_id: fornecedorId,
        finalidade: finalidade === 'HIGIENE_CONSUMO' || finalidade === 'INSUMO' ? 'CONSUMO' : finalidade === 'EMPORIO' ? 'REVENDA' : finalidade,
        tipo_compra: finalidade,
        centro_custo_id: centroCustoId || null,
        forma_pagamento_id: formaPagamentoId || null,
        natureza_id: cfopPreview?.natureza_id || null,
        marchante,
        frete_valor: Number(String(freteValor || '0').replace(',', '.')) || 0,
        despesas_valor: Number(String(despesasValor || '0').replace(',', '.')) || 0,
        previsao_entrega: previsaoEntrega || null,
        observacoes,
        aprovar: aprovarAoCriar,
        itens: itensForm,
      })
      toastSuccess('Pedido de Compra Criado', `${res.codigo} (${res.status}) criado com sucesso!`)
      setModalNovo(false)
      setItensForm([])
      setFormaPagamentoId('')
      const marcPadrao =
        (auxiliares.marchantes || []).find((m) => Number(m.is_padrao) === 1)?.nome ||
        auxiliares.marchantes?.[0]?.nome ||
        'FRIGODIL'
      setMarchante(marcPadrao)
      setFreteValor('')
      setDespesasValor('')
      setObservacoes('')
      carregar()
    } catch (err) {
      toastError('Erro ao salvar PC', err.message)
    }
  }

  const abrirDetalhe = async (id) => {
    try {
      const det = await comprasQueries.obterCompra(id)
      setDetalhe(det)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleAprovar = async (id) => {
    try {
      await comprasQueries.aprovarCompra(id)
      toastSuccess('Aprovado', 'Pedido de Compra liberado para recebimento na doca!')
      carregar()
      if (detalhe?.id === id) abrirDetalhe(id)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleValidarSistemica = async (id) => {
    try {
      const res = await comprasQueries.validarSistemica(id, { encerrar_pc: true })
      toastSuccess('Validação 3-Way Concluída ✅', `Entrada validada (${fmtKg(res.total_recebida_kg)}) e custos atualizados!`)
      setDetalhe(null)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleCancelar = async (id) => {
    const ok = await confirmar({
      title: 'Cancelar Pedido de Compra',
      message: 'Deseja realmente cancelar este Pedido de Compra?',
      type: 'error',
      confirmLabel: 'Sim, Cancelar PC',
    })
    if (!ok) return
    try {
      await comprasQueries.cancelarCompra(id)
      toastSuccess('Cancelado', 'Pedido de Compra cancelado.')
      setDetalhe(null)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── BANCO UNIVERSAL DE TXTs POR FORNECEDOR (+ XML NF-e OPCIONAL) ───────────
  const rodarPreviewXml = useCallback(
    async (xmlStr, fornIdOverride = impFornId) => {
      if (!xmlStr?.trim()) {
        setImpXmlPreview(null)
        return
      }
      try {
        const res = await comprasQueries.previewXmlNfe({
          xml_conteudo: xmlStr,
          fornecedor_id: fornIdOverride || null,
        })
        setImpXmlPreview(res)
        if (res.fornecedor_encontrado?.id && !fornIdOverride) {
          setImpFornId(res.fornecedor_encontrado.id)
        }
        const preEdits = {}
        for (const it of res.nfe?.itens || []) {
          if (it.produto_sugerido_id && it.codigo_fornecedor) {
            preEdits[it.codigo_fornecedor] = it.produto_sugerido_id
          }
        }
        setImpDeparaEdits((prev) => ({ ...preEdits, ...prev }))
      } catch (err) {
        toastError('Erro ao ler XML NF-e', err.message)
      }
    },
    [impFornId, toastError],
  )

  const rodarPreviewTxts = useCallback(
    async (arquivos, layoutIdOverride = impLayoutId, fornIdOverride = impFornId) => {
      if (!arquivos || arquivos.length === 0) {
        setImpTxtPreview(null)
        return
      }
      try {
        const res = await comprasQueries.previewTxtLote({
          arquivos,
          layout_id: layoutIdOverride || null,
          fornecedor_id: fornIdOverride || null,
        })
        setImpTxtPreview(res)
        const preEdits = {}
        for (const g of res.codigos_encontrados || []) {
          if (g.produto_id && g.codigo_fornecedor) {
            preEdits[g.codigo_fornecedor] = g.produto_id
          }
        }
        setImpDeparaEdits((prev) => ({ ...preEdits, ...prev }))
      } catch (err) {
        toastError('Erro ao ler TXTs', err.message)
      }
    },
    [impLayoutId, impFornId, toastError],
  )

  const handleSelecionarXmlFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await readFileAsTextSmart(file)
      setImpXmlFileName(file.name)
      setImpXmlText(text)
      setImpResultado(null)
      await rodarPreviewXml(text)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleSelecionarTxtFiles = async (e) => {
    const fileList = Array.from(e.target.files || [])
    e.target.value = ''
    if (fileList.length === 0) return
    try {
      const novos = await Promise.all(
        fileList.map(async (f) => ({
          nome: f.name,
          conteudo: await readFileAsTextSmart(f),
        })),
      )
      const combinados = [...impTxtArquivos]
      for (const n of novos) {
        const idx = combinados.findIndex((x) => x.nome === n.nome)
        if (idx >= 0) combinados[idx] = n
        else combinados.push(n)
      }
      setImpTxtArquivos(combinados)
      setImpResultado(null)
      await rodarPreviewTxts(combinados)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleSelecionarFornecedorTxt = async (fornId) => {
    setImpFornId(fornId)
    if (impXmlText) await rodarPreviewXml(impXmlText, fornId)
    if (impTxtArquivos.length > 0) await rodarPreviewTxts(impTxtArquivos, impLayoutId, fornId)
  }

  const codigosConsolidados = useMemo(() => {
    const map = new Map()
    for (const g of impTxtPreview?.codigos_encontrados || []) {
      map.set(g.codigo_fornecedor, {
        codigo_fornecedor: g.codigo_fornecedor,
        descricao_fornecedor: g.descricao_fornecedor,
        ncm: '',
        qtd_caixas: g.qtd_caixas,
        qtd_novas: g.qtd_novas,
        peso_kg: g.peso_kg,
        produto_id_sugerido: g.produto_id,
        origem_vinculo: g.origem_vinculo,
        fonte: 'TXT',
      })
    }
    for (const it of impXmlPreview?.nfe?.itens || []) {
      const existing = map.get(it.codigo_fornecedor)
      if (existing) {
        existing.ncm = it.ncm || ''
        existing.fonte = 'TXT + XML'
        if (!existing.produto_id_sugerido && it.produto_sugerido_id) {
          existing.produto_id_sugerido = it.produto_sugerido_id
          existing.origem_vinculo = it.origem_vinculo
        }
      } else {
        map.set(it.codigo_fornecedor, {
          codigo_fornecedor: it.codigo_fornecedor,
          descricao_fornecedor: it.descricao,
          ncm: it.ncm || '',
          qtd_caixas: 0,
          qtd_novas: 0,
          peso_kg: it.quantidade,
          produto_id_sugerido: it.produto_sugerido_id,
          origem_vinculo: it.origem_vinculo,
          fonte: 'XML',
        })
      }
    }
    return Array.from(map.values())
  }, [impTxtPreview, impXmlPreview])

  const codigosPendentesDepara = useMemo(() => {
    return codigosConsolidados.filter((c) => !(impDeparaEdits[c.codigo_fornecedor] || c.produto_id_sugerido))
  }, [codigosConsolidados, impDeparaEdits])

  const handleExecutarImportacao = async () => {
    if (!impXmlText.trim() && impTxtArquivos.length === 0) {
      return toastWarning('Arquivos', 'Selecione os arquivos TXT das etiquetas e/ou o XML da NF-e.')
    }
    if (!impFornId && (!impXmlText.trim() || !impAutoCadForn)) {
      return toastWarning(
        'Fornecedor obrigatório',
        'Selecione o Fornecedor / Frigorífico acima para gravar as etiquetas e o De-Para.',
      )
    }
    if (impTxtArquivos.length > 0 && codigosPendentesDepara.length > 0) {
      return toastWarning(
        'Mapeamento De-Para pendente',
        `Faltam ${codigosPendentesDepara.length} código(s) do fornecedor para vincular ao produto interno do WMS.`,
      )
    }

    const vinculos = codigosConsolidados
      .map((c) => {
        const pid = impDeparaEdits[c.codigo_fornecedor] || c.produto_id_sugerido
        if (!pid) return null
        return {
          codigo_fornecedor: c.codigo_fornecedor,
          descricao_fornecedor: c.descricao_fornecedor,
          ncm: c.ncm || '',
          produto_id: pid,
        }
      })
      .filter(Boolean)

    setImpExecutando(true)
    try {
      const res = await comprasQueries.importarLoteEntrada({
        pedido_compra_id: null,
        fornecedor_id: impFornId || null,
        auto_cadastrar_fornecedor: impAutoCadForn,
        xml_conteudo: impXmlText || undefined,
        txts: impTxtArquivos,
        layout_id: impLayoutId || null,
        depara_vinculos: vinculos,
        modo_entrada: 'PRE_RECEBIMENTO',
      })
      setImpResultado(res)
      toastSuccess(
        'Etiquetas Importadas ✅',
        `${res.caixas_importadas} caixa(s) gravadas no banco do fornecedor ${res.fornecedor_nome || ''} para bipagem na doca!`,
      )
      carregar()
    } catch (err) {
      toastError('Falha ao importar lote', err.message)
    } finally {
      setImpExecutando(false)
    }
  }

  const handleLimparImportacao = () => {
    setImpXmlText('')
    setImpXmlFileName('')
    setImpXmlPreview(null)
    setImpTxtArquivos([])
    setImpTxtPreview(null)
    setImpDeparaEdits({})
    setImpResultado(null)
  }

  // ── DE-PARA MANUAL E LAYOUTS TXT ────────────────────────────────────────────
  const handleSalvarNovoDepara = async (e) => {
    e.preventDefault()
    if (!novoDpFornId || !novoDpCod.trim() || !novoDpProdId) {
      return toastWarning('De-Para', 'Informe fornecedor, código no fornecedor e produto WMS.')
    }
    try {
      await comprasQueries.salvarDepara(novoDpFornId, [
        {
          codigo_fornecedor: novoDpCod.trim(),
          descricao_fornecedor: novoDpDesc.trim(),
          produto_id: novoDpProdId,
        },
      ])
      toastSuccess('Vínculo De-Para Salvo', `${novoDpCod.trim()} vinculado com sucesso!`)
      setNovoDpCod('')
      setNovoDpDesc('')
      setNovoDpProdId('')
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleExcluirDepara = async (id) => {
    const ok = await confirmar({
      title: 'Remover Vínculo De-Para',
      message: 'Deseja excluir este mapeamento de código?',
      type: 'error',
      confirmLabel: 'Excluir',
    })
    if (!ok) return
    try {
      await comprasQueries.excluirDepara(id)
      toastSuccess('Removido', 'Vínculo excluído.')
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleSalvarLayoutTxt = async (e) => {
    e.preventDefault()
    if (!layForm.nome.trim()) return toastWarning('Layout', 'Informe o nome do layout.')
    try {
      await comprasQueries.salvarLayoutTxt({
        nome: layForm.nome.trim(),
        fornecedor_id: layForm.fornecedor_id || null,
        tipo_arquivo: 'DELIMITADO',
        delimitador: layForm.delimitador || ';',
        saltar_linhas: Number(layForm.saltar_linhas || 0),
        formato_data: layForm.formato_data || 'DDMMYYYY',
        decimal_ponto: Boolean(layForm.decimal_ponto),
        mapeamento_json: {
          origem_texto: 1,
          romaneio_origem: Number(layForm.col_romaneio || 2),
          ean: Number(layForm.col_ean || 3),
          codigo_produto: Number(layForm.col_cod || 4),
          descricao_produto: Number(layForm.col_desc || 5),
          peso_liquido: Number(layForm.col_peso || 6),
          qtd_pecas: Number(layForm.col_pecas || 7),
          data_producao: Number(layForm.col_prod || 8),
          data_validade: Number(layForm.col_val || 9),
          documento_origem: Number(layForm.col_doc || 10),
        },
      })
      toastSuccess('Layout TXT Criado', `Layout "${layForm.nome}" salvo!`)
      setModalNovoLayout(false)
      setLayForm((p) => ({ ...p, nome: '' }))
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleExcluirLayout = async (id) => {
    const ok = await confirmar({
      title: 'Desativar Layout TXT',
      message: 'Remover este modelo de layout da lista de importação?',
      type: 'error',
      confirmLabel: 'Remover',
    })
    if (!ok) return
    try {
      await comprasQueries.excluirLayoutTxt(id)
      toastSuccess('Removido', 'Layout desativado.')
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const totalForm =
    itensForm.reduce((s, i) => s + Number(i.qtd_kg_solicitada || 0) * Number(i.preco_unitario_kg || 0), 0) +
    (Number(String(freteValor || '0').replace(',', '.')) || 0) +
    (Number(String(despesasValor || '0').replace(',', '.')) || 0)

  const deparasFiltrados = useMemo(() => {
    if (!filtroFornDepara) return deparas
    return deparas.filter((d) => d.fornecedor_id === filtroFornDepara)
  }, [deparas, filtroFornDepara])

  if (!apiAtiva) {
    return (
      <div className="card p-24">
        <h2 className="text-lg font-bold mb-8">Pedidos de Compra & Entrada XML / TXT (Modo ERP API)</h2>
        <p className="text-sm text-muted">
          Ative o Backend API PostgreSQL (`VITE_API_URL`) para gerenciar Pedidos de Compra, importação em lote de TXTs / XML NF-e, De-Para automático e trava na doca.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <ShoppingBag size={24} className="text-primary" /> Compras & Pré-Recebimento Operacional
          </h1>
          <p className="page-header__subtitle">
            Pedidos de Compra (Industrial/Operação), etiquetas (.txt) para bipagem na doca e De-Para permanente. A entrada fiscal da NF-e (XML → Contas a Pagar) é feita no Módulo Fiscal.
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          {podeEscrever && (
            <button
              type="button"
              className={`btn ${travaAtiva ? 'btn--warning' : 'btn--ghost'}`}
              onClick={handleToggleTrava}
              title="Quando ativada, impede bipagem no Recebimento sem Pedido de Compra aprovado"
            >
              {travaAtiva ? <Lock size={15} /> : <Unlock size={15} />}
              {travaAtiva ? 'Trava na Doca: ATIVA 🔒' : 'Trava na Doca: Desativada'}
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            style={{ borderColor: 'rgba(16, 185, 129, 0.45)', color: '#34d399' }}
            onClick={() => navigate('/fiscal?aba=ENTRADA_COMPRA')}
            title="Abrir Entrada Fiscal de NF-e de Compra (XML → Contas a Pagar) vinculada a um Pedido de Compra"
          >
            <FileUp size={15} /> Entrada NF-e (Fiscal)
          </button>
          <button type="button" className="btn btn--ghost" onClick={carregar} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          {podeEscrever && (
            <>
              <button
                type="button"
                className="btn btn--info"
                onClick={() => setAbaAtiva('importar')}
              >
                <Upload size={16} /> Importar Etiquetas (.TXT)
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setModalNovo(true)}>
                <Plus size={16} /> Novo Pedido de Compra
              </button>
            </>
          )}
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex gap-8 flex-wrap mb-16">
        <button
          type="button"
          className={`btn ${abaAtiva === 'pedidos' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setAbaAtiva('pedidos')}
        >
          <ShoppingBag size={15} /> Pedidos de Compra ({compras.length})
        </button>
        <button
          type="button"
          className={`btn ${abaAtiva === 'importar' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setAbaAtiva('importar')}
        >
          <Upload size={15} /> Importar Lote (TXTs / XML NF-e)
        </button>
        <button
          type="button"
          className={`btn ${abaAtiva === 'depara' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setAbaAtiva('depara')}
        >
          <ArrowRightLeft size={15} /> De-Para Fornecedor & Layouts TXT ({deparas.length})
        </button>
      </div>

      {/* ABA 1: PEDIDOS DE COMPRA */}
      {abaAtiva === 'pedidos' && (
        <>
          <div className="kpi-grid mb-16">
            <div className="kpi-card">
              <span className="kpi-card__label">Em Aberto (Aguardando Aprovação)</span>
              <span className="kpi-card__value">{kpis.abertos}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-card__label text-info">Liberados para Doca</span>
              <span className="kpi-card__value text-info">{kpis.aprovados}</span>
            </div>
            <div className="kpi-card" style={{ borderColor: kpis.validacao > 0 ? 'var(--warning)' : undefined }}>
              <span className="kpi-card__label text-warning">Aguardando Validação 3-Way</span>
              <span className="kpi-card__value text-warning">{kpis.validacao}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-card__label text-success">Recebidos / Validados</span>
              <span className="kpi-card__value text-success">{kpis.recebidos}</span>
            </div>
          </div>

          <div className="card mb-16">
            <div className="flex gap-12 flex-wrap items-end">
              <div className="form-group" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
                <label className="form-label">Buscar Pedido / Fornecedor / Marchante</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="PC-0001, JBS, Frigodil..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
                <label className="form-label">Status</label>
                <select className="form-input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                  <option value="TODOS">Todos os Status</option>
                  <option value="ABERTO">Em Aberto</option>
                  <option value="APROVADO">Aprovado p/ Doca</option>
                  <option value="PARCIAL">Recebimento Parcial</option>
                  <option value="RECEBIDO">Recebido / Fechado</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>
              <button type="button" className="btn btn--primary" onClick={carregar}>
                Filtrar
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Fornecedor / SIF</th>
                    <th>Marchante / Centro Custo</th>
                    <th>Previsão</th>
                    <th style={{ textAlign: 'right' }}>Solicitado</th>
                    <th style={{ textAlign: 'right' }}>Bipado Doca</th>
                    <th style={{ textAlign: 'right' }}>Valor Total</th>
                    <th>Status / 3-Way</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {compras.map((c) => {
                    const st = STATUS_PC_BADGE[c.status] || { label: c.status, cls: 'badge--neutral' }
                    const sv = c.status_validacao ? STATUS_VAL_BADGE[c.status_validacao] : null
                    const tp = TIPO_COMPRA_BADGE[c.tipo_compra] || TIPO_COMPRA_BADGE.MATERIA_PRIMA
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="font-mono font-bold text-primary">{c.codigo}</div>
                          <span className={`badge ${tp.cls}`} style={{ fontSize: 10, marginTop: 3 }}>
                            {tp.label}
                          </span>
                        </td>
                        <td>
                          <div className="font-bold">{c.fornecedor_nome}</div>
                          <div className="text-xs text-muted">
                            UF {c.fornecedor_uf} {c.fornecedor_sif ? `• SIF ${c.fornecedor_sif}` : ''}
                          </div>
                        </td>
                        <td>
                          <div className="text-sm">{c.marchante || '-'}</div>
                          <div className="text-xs text-muted">{c.centro_custo_descricao || '-'}</div>
                        </td>
                        <td className="text-sm">{fmtData(c.previsao_entrega)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(c.total_kg_solicitada)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">{fmtKg(c.total_kg_recebida)}</td>
                        <td style={{ textAlign: 'right' }} className="font-bold text-success">{fmtMoeda(c.valor_total)}</td>
                        <td>
                          <div className="flex flex-col gap-4">
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                            {sv && <span className={`badge ${sv.cls}`}>{sv.label}</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex justify-end gap-6">
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => abrirDetalhe(c.id)}>
                              <Eye size={14} /> Abrir
                            </button>
                            {podeEscrever && !['RECEBIDO', 'CANCELADO'].includes(c.status) && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm text-cyan"
                                title="Importar etiquetas TXT deste Fornecedor"
                                onClick={() => {
                                  handleSelecionarFornecedorTxt(c.fornecedor_id)
                                  setAbaAtiva('importar')
                                }}
                              >
                                <Upload size={14} /> TXT
                              </button>
                            )}
                            {podeEscrever && c.status === 'ABERTO' && (
                              <button type="button" className="btn btn--info btn--sm" onClick={() => handleAprovar(c.id)}>
                                <CheckCircle2 size={14} /> Aprovar
                              </button>
                            )}
                            {['APROVADO', 'PARCIAL', 'RECEBIDO'].includes(c.status) && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                style={{ color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.35)' }}
                                title="Dar Entrada Fiscal na NF-e de Compra (XML → Contas a Pagar) vinculada a este Pedido"
                                onClick={() => navigate(`/fiscal?aba=ENTRADA_COMPRA&pc=${c.id}`)}
                              >
                                <FileUp size={14} /> NF-e Fiscal
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {compras.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center p-24 text-muted">
                        Nenhum Pedido de Compra encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ABA 2: IMPORTAR LOTE (MÚLTIPLOS TXTs + XML OPCIONAL) */}
      {abaAtiva === 'importar' && (
        <div className="flex flex-col gap-16">
          <div className="card">
            <div className="flex justify-between items-start flex-wrap gap-12 mb-16 pb-12 border-b border-border">
              <div>
                <h2 className="text-base font-bold flex items-center gap-8">
                  <Upload size={18} className="text-info" /> Importação em Lote: Arquivos TXT de Etiquetas & XML NF-e
                </h2>
                <p className="text-xs text-muted mt-4">
                  <strong>Banco Universal por Fornecedor:</strong> Importe quantos arquivos <code>.txt</code> desejar selecionando apenas o <strong>Fornecedor e Layout</strong> (sem vínculo com Pedido de Compra). Quando qualquer Pedido desse fornecedor for aberto na doca, as caixas bipadas abaterão automaticamente!
                </p>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleLimparImportacao}>
                Limpar Arquivos
              </button>
            </div>

            {/* Fornecedor + Layout TXT */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">1. Fornecedor / Frigorífico *</label>
                <select
                  className="form-input"
                  value={impFornId}
                  onChange={(e) => handleSelecionarFornecedorTxt(e.target.value)}
                >
                  <option value="">Selecione o fornecedor (ou auto pelo XML)...</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome_fantasia} ({f.cnpj_cpf})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">2. Layout Leitura TXT</label>
                <select
                  className="form-input"
                  value={impLayoutId}
                  onChange={async (e) => {
                    const lid = e.target.value
                    setImpLayoutId(lid)
                    if (impTxtArquivos.length > 0) await rodarPreviewTxts(impTxtArquivos, lid, impFornId)
                  }}
                >
                  {layoutsTxt.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} ({l.delimitador})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Zona de Seleção: Múltiplos TXTs + XML Opcional */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {/* Card TXTs */}
              <div className="p-16 rounded" style={{ background: 'var(--bg-1)', border: '1px dashed var(--info)' }}>
                <div className="flex justify-between items-center mb-10">
                  <div className="font-bold text-sm flex items-center gap-8 text-info">
                    <FileText size={17} /> Arquivos .TXT de Etiquetas (Vários de uma vez)
                  </div>
                  <label className="btn btn--info btn--sm cursor-pointer">
                    <Upload size={14} /> Selecionar TXT(s)
                    <input
                      type="file"
                      accept=".txt,.csv,text/plain"
                      multiple
                      style={{ display: 'none' }}
                      onChange={handleSelecionarTxtFiles}
                    />
                  </label>
                </div>
                {impTxtArquivos.length === 0 ? (
                  <p className="text-xs text-muted">
                    Selecione 1 ou mais arquivos <code>.txt</code> enviados pelo frigorífico (ex.: <code>ETIQUETAS_*.txt</code>). O sistema junta tudo e remove etiquetas duplicadas pelo EAN.
                  </p>
                ) : (
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap gap-6">
                      {impTxtArquivos.map((arq) => (
                        <span key={arq.nome} className="badge badge--info flex items-center gap-4">
                          {arq.nome}
                          <button
                            type="button"
                            className="cursor-pointer"
                            style={{ background: 'none', border: 'none', color: 'inherit', padding: 0 }}
                            onClick={async () => {
                              const rest = impTxtArquivos.filter((x) => x.nome !== arq.nome)
                              setImpTxtArquivos(rest)
                              await rodarPreviewTxts(rest)
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    {impTxtPreview?.resumo && (
                      <div className="grid-2 text-xs mt-6 p-10 rounded" style={{ background: 'var(--bg-2)' }}>
                        <div>Caixas únicas: <strong className="text-cyan">{impTxtPreview.resumo.total_unicas}</strong></div>
                        <div>Caixas novas: <strong className="text-success">{impTxtPreview.resumo.caixas_novas}</strong></div>
                        <div>Peso líquido total: <strong>{fmtKg(impTxtPreview.resumo.total_peso_kg)}</strong></div>
                        <div>Total de peças: <strong>{impTxtPreview.resumo.total_pecas}</strong></div>
                        {impTxtPreview.resumo.duplicadas_ignoradas > 0 && (
                          <div className="text-warning">Duplicadas nos TXTs: {impTxtPreview.resumo.duplicadas_ignoradas}</div>
                        )}
                        {impTxtPreview.resumo.ja_no_sistema > 0 && (
                          <div className="text-muted">Já existiam no sistema: {impTxtPreview.resumo.ja_no_sistema}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Card XML NF-e (Opcional) */}
              <div className="p-16 rounded" style={{ background: 'var(--bg-1)', border: '1px dashed var(--border)' }}>
                <div className="flex justify-between items-center mb-10">
                  <div className="font-bold text-sm flex items-center gap-8">
                    <FileCode2 size={17} className="text-success" /> XML NF-e de Entrada <span className="badge badge--neutral">Opcional</span>
                  </div>
                  <label className="btn btn--ghost btn--sm cursor-pointer">
                    <Upload size={14} /> Selecionar .XML
                    <input
                      type="file"
                      accept=".xml,text/xml,application/xml"
                      style={{ display: 'none' }}
                      onChange={handleSelecionarXmlFile}
                    />
                  </label>
                </div>

                {!impXmlPreview ? (
                  <div className="flex flex-col gap-6">
                    <p className="text-xs text-muted">
                      Não é obrigatório se você só quiser importar os TXTs. Quando enviado, traz custos exatos por item, rateio de frete/ST, CNPJ e duplicatas.
                    </p>
                    <label className="flex items-center gap-6 text-xs cursor-pointer mt-4">
                      <input
                        type="checkbox"
                        checked={impAutoCadForn}
                        onChange={(e) => setImpAutoCadForn(e.target.checked)}
                      />
                      Cadastrar fornecedor automaticamente pelo CNPJ do XML se não existir
                    </label>
                  </div>
                ) : (
                  <div className="text-xs flex flex-col gap-6 p-10 rounded" style={{ background: 'var(--bg-2)' }}>
                    <div className="flex justify-between">
                      <strong>NF {impXmlPreview.nfe.numero_nf} (Série {impXmlPreview.nfe.serie})</strong>
                      <span className="text-success font-bold">{fmtMoeda(impXmlPreview.nfe.totais.valor_nf)}</span>
                    </div>
                    <div className="text-muted">
                      {impXmlFileName} • {impXmlPreview.nfe.emitente.nome_fantasia || impXmlPreview.nfe.emitente.razao_social} ({impXmlPreview.nfe.emitente.cnpj})
                    </div>
                    <div className="flex gap-12 flex-wrap">
                      <span>Produtos: <strong>{fmtMoeda(impXmlPreview.nfe.totais.valor_produtos)}</strong></span>
                      <span>Frete: <strong>{fmtMoeda(impXmlPreview.nfe.totais.valor_frete)}</strong></span>
                      <span>Parcelas/Dup: <strong>{(impXmlPreview.nfe.duplicatas || []).length}</strong></span>
                    </div>
                    {!impXmlPreview.fornecedor_encontrado && (
                      <div className="text-warning font-bold">
                        Fornecedor não encontrado no cadastro {impAutoCadForn ? '(será criado automaticamente pelo CNPJ)' : '(selecione manualmente acima)'}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tabela De-Para de Códigos Encontrados */}
          {codigosConsolidados.length > 0 && (
            <div className="card">
              <div className="flex justify-between items-center flex-wrap gap-8 mb-12">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-8">
                    <ArrowRightLeft size={17} className="text-primary" /> Conferência De-Para de Produtos ({codigosConsolidados.length} código(s))
                  </h3>
                  <p className="text-xs text-muted">
                    Vínculos feitos aqui são gravados permanentemente no cadastro deste fornecedor — na próxima carga entram automático!
                  </p>
                </div>
                {codigosPendentesDepara.length > 0 ? (
                  <span className="badge badge--warning">{codigosPendentesDepara.length} sem vínculo</span>
                ) : (
                  <span className="badge badge--success">Todos vinculados ✅</span>
                )}
              </div>

              <div className="table-wrap mb-16">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Cód. Fornecedor</th>
                      <th>Descrição no Arquivo</th>
                      <th style={{ textAlign: 'right' }}>Caixas / Peso</th>
                      <th>Produto Interno WMS *</th>
                      <th>Status Vínculo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codigosConsolidados.map((c) => {
                      const pidSel = impDeparaEdits[c.codigo_fornecedor] ?? c.produto_id_sugerido ?? ''
                      return (
                        <tr key={c.codigo_fornecedor}>
                          <td><span className="badge badge--neutral">{c.fonte}</span></td>
                          <td className="font-mono font-bold text-cyan">{c.codigo_fornecedor}</td>
                          <td className="text-sm">{c.descricao_fornecedor}</td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                            {c.qtd_caixas > 0 ? `${c.qtd_caixas} cx • ` : ''}{fmtKg(c.peso_kg)}
                          </td>
                          <td style={{ minWidth: 260 }}>
                            <select
                              className="form-input"
                              value={pidSel}
                              onChange={(e) =>
                                setImpDeparaEdits((prev) => ({
                                  ...prev,
                                  [c.codigo_fornecedor]: e.target.value,
                                }))
                              }
                            >
                              <option value="">-- Selecionar produto interno --</option>
                              {produtosOrdenados.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.codigo} — {p.descricao}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {pidSel ? (
                              <span className="badge badge--success">
                                <Check size={12} /> {c.origem_vinculo === 'DEPARA' ? 'De-Para Salvo' : c.origem_vinculo === 'CODIGO_PRODUTO' ? 'Cód. Igual' : 'Vinculado'}
                              </span>
                            ) : (
                              <span className="badge badge--warning">Mapear Produto</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Duplicatas do XML caso presentes */}
              {impXmlPreview?.nfe?.duplicatas?.length > 0 && (
                <div className="p-12 rounded mb-16" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-xs font-bold uppercase text-muted mb-8">Duplicatas / Parcelas Lidas do XML NF-e</div>
                  <div className="flex flex-wrap gap-8">
                    {impXmlPreview.nfe.duplicatas.map((d, idx) => (
                      <div key={idx} className="badge badge--info">
                        Parc. {d.numero || idx + 1}: {fmtData(d.vencimento)} — {fmtMoeda(d.valor)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end items-center gap-12">
                {impResultado && (
                  <div className="text-sm text-success font-bold flex items-center gap-6">
                    <Boxes size={16} /> Lote importado: {impResultado.caixas_importadas} cx ({fmtKg(impResultado.peso_total_importado_kg)}) p/ Doca
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={impExecutando}
                  onClick={handleExecutarImportacao}
                >
                  <CheckCircle2 size={16} />
                  {impExecutando
                    ? 'Importando Lote...'
                    : 'Gravar no Banco do Fornecedor (Aguardando Bipagem na Doca)'}
                </button>
              </div>
            </div>
          )}

          {/* Só XML sem códigos de TXT */}
          {codigosConsolidados.length === 0 && impXmlText && impXmlPreview && (
            <div className="card flex justify-end">
              <button
                type="button"
                className="btn btn--primary"
                disabled={impExecutando}
                onClick={handleExecutarImportacao}
              >
                <CheckCircle2 size={16} /> Importar NF-e XML
              </button>
            </div>
          )}

          {/* Banco de Etiquetas TXT Pendentes na Doca */}
          <div className="card">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-sm font-bold flex items-center gap-8 text-cyan">
                <Boxes size={16} /> Banco Universal de Etiquetas (.TXT) Prontas p/ Bipar na Doca ({poolPreCaixas.length})
              </h3>
            </div>
            {poolPreCaixas.length === 0 ? (
              <div className="text-xs text-muted">Nenhuma etiqueta pendente de bipagem no momento.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>EAN</th>
                      <th>Fornecedor</th>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Peso Líq.</th>
                      <th>Lote / Validade</th>
                      <th>Arquivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poolPreCaixas.slice(0, 60).map((cx) => (
                      <tr key={cx.id}>
                        <td className="font-mono text-cyan font-bold">{cx.ean_caixa}</td>
                        <td className="text-sm font-bold">{cx.fornecedor_nome || '-'}</td>
                        <td className="text-sm">{cx.produto_codigo} — {cx.produto_descricao}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(cx.peso_liquido_kg)}</td>
                        <td className="text-xs font-mono">{cx.lote || '-'} • {fmtData(cx.validade)}</td>
                        <td className="text-xs text-muted">{cx.arquivo_origem || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 3: DE-PARA & LAYOUTS TXT */}
      {abaAtiva === 'depara' && (
        <div className="flex flex-col gap-16">
          {/* Cadastro De-Para */}
          <div className="card">
            <div className="flex justify-between items-center flex-wrap gap-12 mb-12">
              <h2 className="text-base font-bold flex items-center gap-8">
                <ArrowRightLeft size={18} className="text-primary" /> Tabela De-Para Permanente (Fornecedor → Produto WMS)
              </h2>
              <select
                className="form-input"
                style={{ width: 260 }}
                value={filtroFornDepara}
                onChange={(e) => setFiltroFornDepara(e.target.value)}
              >
                <option value="">Todos os Fornecedores</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome_fantasia}</option>
                ))}
              </select>
            </div>

            {podeEscrever && (
              <form
                onSubmit={handleSalvarNovoDepara}
                className="p-12 rounded mb-16"
                style={{
                  background: 'var(--bg-1)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                  gap: 10,
                  alignItems: 'end',
                }}
              >
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Fornecedor *</label>
                  <select className="form-input" value={novoDpFornId} onChange={(e) => setNovoDpFornId(e.target.value)}>
                    <option value="">Selecione...</option>
                    {fornecedores.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome_fantasia}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Cód. no Fornecedor *</label>
                  <input type="text" className="form-input" placeholder="Ex: 75" value={novoDpCod} onChange={(e) => setNovoDpCod(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Descrição Forn. (Opcional)</label>
                  <input type="text" className="form-input" placeholder="PEIXINHO (T7)" value={novoDpDesc} onChange={(e) => setNovoDpDesc(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Produto Interno WMS *</label>
                  <select className="form-input" value={novoDpProdId} onChange={(e) => setNovoDpProdId(e.target.value)}>
                    <option value="">Selecione...</option>
                    {produtosOrdenados.map((p) => (
                      <option key={p.id} value={p.id}>{p.codigo} — {p.descricao}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn--info">
                  <Plus size={15} /> Vincular
                </button>
              </form>
            )}

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Cód. Fornecedor</th>
                    <th>Desc. Origem</th>
                    <th>Produto Interno WMS</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {deparasFiltrados.map((d) => (
                    <tr key={d.id}>
                      <td className="font-bold">{d.fornecedor_nome}</td>
                      <td className="font-mono text-cyan font-bold">{d.codigo_fornecedor}</td>
                      <td className="text-muted text-sm">{d.descricao_fornecedor || '-'}</td>
                      <td><strong>{d.produto_codigo}</strong> — {d.produto_descricao}</td>
                      <td style={{ textAlign: 'right' }}>
                        {podeEscrever && (
                          <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleExcluirDepara(d.id)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {deparasFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center p-20 text-muted">Nenhum vínculo De-Para cadastrado ainda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cadastro Layouts TXT */}
          <div className="card">
            <div className="flex justify-between items-center mb-12">
              <h2 className="text-base font-bold flex items-center gap-8">
                <Settings2 size={18} className="text-info" /> Layouts de Arquivos TXT (Frigoríficos)
              </h2>
              {podeEscrever && (
                <button type="button" className="btn btn--info btn--sm" onClick={() => setModalNovoLayout(true)}>
                  <Plus size={14} /> Novo Layout TXT
                </button>
              )}
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nome do Layout</th>
                    <th>Delimitador</th>
                    <th>Data / Decimal</th>
                    <th>Colunas Mapeadas (1-indexed)</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {layoutsTxt.map((l) => (
                    <tr key={l.id}>
                      <td className="font-bold">{l.nome}</td>
                      <td className="font-mono">{l.delimitador}</td>
                      <td className="text-xs">{l.formato_data} • {Number(l.decimal_ponto) === 1 ? 'Ponto (.)' : 'Vírgula (,)'}</td>
                      <td className="text-xs font-mono text-muted">
                        EAN:{l.mapeamento_json?.ean} | Cód:{l.mapeamento_json?.codigo_produto} | Peso:{l.mapeamento_json?.peso_liquido} | Pçs:{l.mapeamento_json?.qtd_pecas} | Val:{l.mapeamento_json?.data_validade}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {podeEscrever && (
                          <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleExcluirLayout(l.id)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AMPLO: NOVO PEDIDO DE COMPRA */}
      {modalNovo && (
        <div
          className="modal-overlay"
          style={{ padding: 14 }}
          onClick={(e) => e.target === e.currentTarget && setModalNovo(false)}
        >
          <div
            className="card"
            style={{
              width: '96vw',
              maxWidth: 1380,
              height: '92vh',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              background: 'var(--bg-1)',
              overflow: 'hidden',
            }}
          >
            {/* Header Fixo */}
            <div
              className="flex justify-between items-center p-16"
              style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}
            >
              <div>
                <h2 className="text-lg font-bold flex items-center gap-8" style={{ margin: 0 }}>
                  <ShoppingBag size={19} className="text-primary" /> Novo Pedido de Compra
                </h2>
                <div className="text-xs text-muted mt-4">
                  Preencha os dados do fornecedor, condições comerciais e lance os produtos por código, descrição, De-Para ou Lupa.
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setModalNovo(false)}>
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleSalvarCompra}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              {/* Área Scrollável Completa */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }} className="flex flex-col gap-16">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                    <label className="form-label">Fornecedor / Frigorífico *</label>
                    <select
                      className="form-input"
                      value={fornecedorId}
                      onChange={(e) => setFornecedorId(e.target.value)}
                      required
                    >
                      <option value="">Selecione o fornecedor...</option>
                      {fornecedores.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome_fantasia} ({f.uf}) {f.registro_sanitario_sif ? `• SIF ${f.registro_sanitario_sif}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Tipo de Compra / Finalidade (CFOP Auto)</label>
                    <select className="form-input" value={finalidade} onChange={(e) => setFinalidade(e.target.value)}>
                      <option value="MATERIA_PRIMA">Matéria-Prima / Carnes (Indústria)</option>
                      <option value="REVENDA">Mercadoria p/ Revenda (Atacado)</option>
                      <option value="EMPORIO">Empório / Loja (Varejo 1/1)</option>
                      <option value="INSUMO">Insumos / Embalagens (Almoxarifado)</option>
                      <option value="HIGIENE_CONSUMO">Higiene / Uso &amp; Consumo (Opcional PC)</option>
                    </select>
                  </div>
                </div>

                {cfopPreview && (
                  <div className="p-10 rounded text-xs" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)' }}>
                    CFOP Sugerido automaticamente: <strong>{cfopPreview.cfop}</strong> ({cfopPreview.descricao} • Filial {cfopPreview.uf_filial} × Fornecedor {cfopPreview.uf_parceiro})
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Centro de Custo</label>
                    <select className="form-input" value={centroCustoId} onChange={(e) => setCentroCustoId(e.target.value)}>
                      <option value="">Padrão</option>
                      {(auxiliares.centrosCusto || []).map((cc) => (
                        <option key={cc.id} value={cc.id}>
                          {cc.codigo} — {cc.descricao}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Forma Pagto Combinada</label>
                    <select className="form-input" value={formaPagamentoId} onChange={(e) => setFormaPagamentoId(e.target.value)}>
                      <option value="">-- A definir na NF --</option>
                      {(auxiliares.formasPagamento || []).map((fp) => (
                        <option key={fp.id} value={fp.id}>
                          {fp.codigo} — {fp.descricao}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Marchante / Corretor</label>
                    <select className="form-input" value={marchante} onChange={(e) => setMarchante(e.target.value)}>
                      {(auxiliares.marchantes || []).length === 0 ? (
                        <option value="FRIGODIL">001 — FRIGODIL</option>
                      ) : (
                        (auxiliares.marchantes || []).map((m) => (
                          <option key={m.id} value={m.nome}>
                            {m.codigo} — {m.nome}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Previsão Entrega</label>
                    <input type="date" className="form-input" value={previsaoEntrega} onChange={(e) => setPrevisaoEntrega(e.target.value)} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Frete (R$)</label>
                    <input type="number" step="0.01" className="form-input" value={freteValor} onChange={(e) => setFreteValor(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Despesas Acess. (R$)</label>
                    <input type="number" step="0.01" className="form-input" value={despesasValor} onChange={(e) => setDespesasValor(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Observações</label>
                    <input type="text" className="form-input" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Placa, prazo negociado..." />
                  </div>
                </div>

                {/* Adicionar Itens (Código / Descrição Autocomplete / Lupa / De-Para) */}
                <div className="flex flex-col gap-12">
                  <SeletorItemCompra
                    produtos={produtosOrdenados}
                    deparas={deparas}
                    fornecedorId={fornecedorId}
                    fornecedorNome={
                      fornecedores.find((f) => String(f.id) === String(fornecedorId))?.nome_fantasia || ''
                    }
                    onIncluirItem={handleIncluirItemSelecionado}
                    onAviso={(titulo, msg) => toastWarning(titulo, msg)}
                  />

                  <div className="table-wrap p-12 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', minHeight: 160 }}>
                    <div className="flex justify-between items-center mb-8">
                      <div className="text-xs font-bold uppercase text-muted">
                        Itens do Pedido de Compra ({itensForm.length})
                      </div>
                      <div className="text-xs text-muted font-mono">
                        Peso Total:{' '}
                        <strong>
                          {fmtKg(itensForm.reduce((s, it) => s + Number(it.qtd_kg_solicitada || 0), 0))}
                        </strong>
                      </div>
                    </div>
                    {itensForm.length === 0 ? (
                      <div className="p-24 text-center text-sm text-muted">
                        Nenhum item lançado ainda. Utilize os campos acima (Código, Descrição, De-Para ou Lupa) para incluir os produtos deste Pedido de Compra.
                      </div>
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th style={{ textAlign: 'right' }}>Qtd (kg)</th>
                            <th style={{ textAlign: 'right' }}>R$/kg</th>
                            <th style={{ textAlign: 'right' }}>Subtotal</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {itensForm.map((it, idx) => (
                            <tr key={it.produto_id}>
                              <td>
                                <div>
                                  <strong className="font-mono text-cyan">{it.produto_codigo}</strong> — {it.produto_descricao}
                                </div>
                                {it.codigo_fornecedor_usado && (
                                  <div className="text-xs text-muted">
                                    Lançado via De-Para Cód. Fornecedor: <span className="font-mono">{it.codigo_fornecedor_usado}</span>
                                  </div>
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <input
                                  type="number"
                                  step="0.001"
                                  className="form-input"
                                  style={{ width: 115, textAlign: 'right', display: 'inline-block' }}
                                  value={it.qtd_kg_solicitada}
                                  onChange={(e) => {
                                    const v = Number(e.target.value || 0)
                                    setItensForm((prev) => prev.map((x, i) => (i === idx ? { ...x, qtd_kg_solicitada: v } : x)))
                                  }}
                                />
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="form-input"
                                  style={{ width: 115, textAlign: 'right', display: 'inline-block' }}
                                  value={it.preco_unitario_kg}
                                  onChange={(e) => {
                                    const v = Number(e.target.value || 0)
                                    setItensForm((prev) => prev.map((x, i) => (i === idx ? { ...x, preco_unitario_kg: v } : x)))
                                  }}
                                />
                              </td>
                              <td style={{ textAlign: 'right' }} className="font-bold text-success">
                                {fmtMoeda(Number(it.qtd_kg_solicitada || 0) * Number(it.preco_unitario_kg || 0))}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => setItensForm((prev) => prev.filter((_, i) => i !== idx))}>
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer Fixo */}
              <div
                className="flex justify-between items-center flex-wrap gap-12 p-16"
                style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)', flexShrink: 0 }}
              >
                <label className="flex items-center gap-8 text-sm cursor-pointer">
                  <input type="checkbox" checked={aprovarAoCriar} onChange={(e) => setAprovarAoCriar(e.target.checked)} />
                  Já salvar <strong>Aprovado</strong> (liberar direto para a doca receber)
                </label>

                <div className="flex items-center gap-16 flex-wrap">
                  <div className="text-right">
                    <div className="text-xs text-muted">Total Geral c/ Frete e Despesas</div>
                    <div className="text-xl font-bold text-success">{fmtMoeda(totalForm)}</div>
                  </div>
                  <div className="flex gap-8">
                    <button type="button" className="btn btn--ghost" onClick={() => setModalNovo(false)}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn btn--primary">
                      <CheckCircle2 size={16} /> Salvar Pedido de Compra
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DETALHE & VALIDAÇÃO 3-WAY */}
      {detalhe && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDetalhe(null)}>
          <div className="modal" style={{ maxWidth: 920, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="flex justify-between items-center pb-12 mb-16 border-b border-border">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-8">
                  <Truck size={18} className="text-primary" /> {detalhe.codigo} — {detalhe.fornecedor_nome}
                </h2>
                <div className="text-xs text-muted">
                  UF {detalhe.fornecedor_uf} {detalhe.fornecedor_sif ? `• SIF ${detalhe.fornecedor_sif}` : ''} •{' '}
                  {detalhe.recebimento ? `Recebimento ${detalhe.recebimento.codigo} (${detalhe.recebimento.statusValidacao})` : 'Sem recebimento iniciado na doca'}
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setDetalhe(null)}>
                <X size={18} />
              </button>
            </div>

            {detalhe.pre_caixas_resumo?.total > 0 && (
              <div className="p-12 rounded mb-16 flex justify-between items-center flex-wrap gap-8 text-xs" style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.35)' }}>
                <div>
                  <strong className="text-cyan">Pré-Importação TXT na Doca:</strong>{' '}
                  {detalhe.pre_caixas_resumo.bipadas}/{detalhe.pre_caixas_resumo.total} caixas bipadas ({detalhe.pre_caixas_resumo.pendentes} pendentes)
                </div>
                <span className="font-mono font-bold text-cyan">{fmtKg(detalhe.pre_caixas_resumo.peso_total_kg)}</span>
              </div>
            )}

            <div className="table-wrap mb-16">
              <table className="table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>CFOP</th>
                    <th style={{ textAlign: 'right' }}>Solicitado (kg)</th>
                    <th style={{ textAlign: 'right' }}>Bipado Doca (kg)</th>
                    <th style={{ textAlign: 'right' }}>Diferença</th>
                    <th style={{ textAlign: 'center' }}>Temp. (°C)</th>
                    <th style={{ textAlign: 'right' }}>Preço/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {(detalhe.itens || []).map((it) => {
                    const dif = Number(it.qtd_kg_recebida || 0) - Number(it.qtd_kg_solicitada || 0)
                    return (
                      <tr key={it.id}>
                        <td><strong>{it.produto_codigo}</strong> — {it.produto_descricao}</td>
                        <td className="font-mono text-xs">{it.cfop_aplicado || '-'}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{fmtKg(it.qtd_kg_solicitada)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-cyan">{fmtKg(it.qtd_kg_recebida)}</td>
                        <td style={{ textAlign: 'right' }} className={`font-mono font-bold ${dif < -1 ? 'text-danger' : 'text-success'}`}>
                          {dif >= 0 ? `+${fmtKg(dif)}` : fmtKg(dif)}
                        </td>
                        <td style={{ textAlign: 'center' }} className="font-mono">
                          {it.temperatura_c != null ? `${Number(it.temperatura_c).toFixed(1).replace('.', ',')} °C` : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmtMoeda(it.preco_unitario_kg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {detalhe.recebimento?.statusValidacao === 'DIVERGENTE' && (
              <div className="p-12 rounded mb-16 flex items-center gap-8 text-xs font-bold" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
                <AlertTriangle size={16} /> Atenção: o peso bipado na doca diverge além da tolerância de 3% em relação ao Pedido de Compra. Confirme antes de validar!
              </div>
            )}

            <div className="flex justify-between items-center flex-wrap gap-8">
              <div className="text-sm text-muted">
                Frete: <strong>{fmtMoeda(detalhe.frete_valor)}</strong> • Despesas: <strong>{fmtMoeda(detalhe.despesas_valor)}</strong> • Total: <strong className="text-success">{fmtMoeda(detalhe.valor_total)}</strong>
              </div>
              <div className="flex gap-8 flex-wrap">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setRelatorioRecPedido(detalhe)}
                >
                  <Printer size={15} /> Relatório Recebimento (c/ Temp.)
                </button>
                {podeEscrever && !['RECEBIDO', 'CANCELADO'].includes(detalhe.status) && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      const fid = detalhe.fornecedor_id
                      setDetalhe(null)
                      handleSelecionarFornecedorTxt(fid)
                      setAbaAtiva('importar')
                    }}
                  >
                    <Upload size={15} /> Importar TXTs
                  </button>
                )}
                {podeEscrever && detalhe.status === 'ABERTO' && (
                  <button type="button" className="btn btn--info" onClick={() => handleAprovar(detalhe.id)}>
                    <CheckCircle2 size={15} /> Aprovar p/ Doca
                  </button>
                )}
                {podeEscrever && ['APROVADO', 'PARCIAL'].includes(detalhe.status) && (
                  <button type="button" className="btn btn--success" onClick={() => handleValidarSistemica(detalhe.id)}>
                    <CheckCircle2 size={15} /> Validar 3-Way & Atualizar Custo
                  </button>
                )}
                {podeEscrever && !['RECEBIDO', 'CANCELADO'].includes(detalhe.status) && (
                  <button type="button" className="btn btn--ghost text-danger" onClick={() => handleCancelar(detalhe.id)}>
                    <XCircle size={15} /> Cancelar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL NOVO LAYOUT TXT */}
      {modalNovoLayout && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalNovoLayout(false)}>
          <div className="modal" style={{ maxWidth: 680, width: '96%' }}>
            <div className="flex justify-between items-center pb-12 mb-16 border-b border-border">
              <h2 className="text-lg font-bold flex items-center gap-8">
                <Settings2 size={18} className="text-info" /> Cadastrar Layout de TXT (Frigorífico)
              </h2>
              <button type="button" className="btn-icon" onClick={() => setModalNovoLayout(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvarLayoutTxt} className="flex flex-col gap-12">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nome do Layout *</label>
                <input type="text" className="form-input" placeholder="Ex: Paula & Ribeiro / Minerva 10 colunas" value={layForm.nome} onChange={(e) => setLayForm((p) => ({ ...p, nome: e.target.value }))} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Delimitador</label>
                  <input type="text" className="form-input" value={layForm.delimitador} onChange={(e) => setLayForm((p) => ({ ...p, delimitador: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Saltar Linhas</label>
                  <input type="number" min="0" className="form-input" value={layForm.saltar_linhas} onChange={(e) => setLayForm((p) => ({ ...p, saltar_linhas: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Formato Data</label>
                  <input type="text" className="form-input" value={layForm.formato_data} onChange={(e) => setLayForm((p) => ({ ...p, formato_data: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Cód. Barras (EAN)</label>
                  <input type="number" className="form-input" value={layForm.col_ean} onChange={(e) => setLayForm((p) => ({ ...p, col_ean: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Cód. Produto</label>
                  <input type="number" className="form-input" value={layForm.col_cod} onChange={(e) => setLayForm((p) => ({ ...p, col_cod: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Descrição</label>
                  <input type="number" className="form-input" value={layForm.col_desc} onChange={(e) => setLayForm((p) => ({ ...p, col_desc: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Peso Líquido</label>
                  <input type="number" className="form-input" value={layForm.col_peso} onChange={(e) => setLayForm((p) => ({ ...p, col_peso: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Qtd Peças</label>
                  <input type="number" className="form-input" value={layForm.col_pecas} onChange={(e) => setLayForm((p) => ({ ...p, col_pecas: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Data Produção</label>
                  <input type="number" className="form-input" value={layForm.col_prod} onChange={(e) => setLayForm((p) => ({ ...p, col_prod: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Data Validade</label>
                  <input type="number" className="form-input" value={layForm.col_val} onChange={(e) => setLayForm((p) => ({ ...p, col_val: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Romaneio</label>
                  <input type="number" className="form-input" value={layForm.col_romaneio} onChange={(e) => setLayForm((p) => ({ ...p, col_romaneio: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Col. Carga / NF</label>
                  <input type="number" className="form-input" value={layForm.col_doc} onChange={(e) => setLayForm((p) => ({ ...p, col_doc: e.target.value }))} />
                </div>
              </div>
              <label className="flex items-center gap-8 text-xs cursor-pointer">
                <input type="checkbox" checked={layForm.decimal_ponto} onChange={(e) => setLayForm((p) => ({ ...p, decimal_ponto: e.target.checked }))} />
                Decimal separado por ponto (<code>.</code>) em vez de vírgula (<code>,</code>)
              </label>
              <div className="flex justify-end gap-8 pt-8">
                <button type="button" className="btn btn--ghost" onClick={() => setModalNovoLayout(false)}>Cancelar</button>
                <button type="submit" className="btn btn--primary">Salvar Layout</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {relatorioRecPedido && (
        <RelatorioRecebimentoPrint
          pedido={relatorioRecPedido}
          onClose={() => setRelatorioRecPedido(null)}
          autoPrint
        />
      )}
    </div>
  )
}
