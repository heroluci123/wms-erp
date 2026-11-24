import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Download,
  Save,
  Box,
  Boxes,
  Layers,
  ChevronLeft,
  ChevronRight,
  Tag,
  SlidersHorizontal,
  TrendingUp,
  Activity,
  DollarSign,
  CheckSquare,
  Snowflake,
  Package,
  AlertTriangle,
  ShoppingBag,
  Factory,
  ScanBarcode,
} from 'lucide-react'
import * as produtosQueries from '../queries/produtos'
import { ModalDialog } from '../components/shared/ModalDialog'
import { SmartSearchSelect } from '../components/shared/SmartSearchSelect'
import { useAppStore } from '../store/appStore'
import {
  encontrarCodigoDuplicadoLocal,
  obterProximoCodigoDisponivel,
  sugerirProximoCodigoLocal,
} from '../utils/codigoCadastro'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v, dec = 1) => `${Number(v || 0).toFixed(dec).replace('.', ',')} kg`

const FORM_PRODUTO_INICIAL = {
  id: null,
  codigo: '',
  codigo_auxiliar: '',
  ean: '',
  descricao: '',
  status_curva: 'C',
  unidade: 'CX',
  valor_unitario: 0,
  custo_medio_kg: 0,
  ultimo_preco_compra: 0,
  especificacao_id: '',
  tipo_produto: 'Materia Prima',
  grupo: '',
  especie: '',
  conservacao: 'RESFRIADO',
  validade_dias: 5,
  tara_embalagem_kg: 0,
  classificacao: '',
  peso_padrao_cx: '',
  fator_conversao_compra: 1,
  preco_inicial_tabela: '',
  tara_primaria_peca_kg: 0,
  ncm: '',
  cest: '',
  origem_mercadoria: '0',
  registro_dipoa: '',
  pais_ids: [],
  rendimentos_map: {},
}

function detectarModoProduto(p) {
  const esp = String(p?.especie || '').toUpperCase()
  const tipo = String(p?.tipo_produto || '')
  const grupo = String(p?.grupo || '')
  if (esp === 'EMPORIO' || /revenda|emp[oó]rio|bebida|mercearia|carv[aã]o/i.test(`${tipo} ${grupo}`)) {
    return 'EMPORIO'
  }
  if (esp === 'INSUMO' || /insumo|embalag|uso e cons/i.test(`${tipo} ${grupo}`)) {
    return 'INSUMO'
  }
  return 'CARNES'
}

const FORM_ESPEC_INICIAL = {
  id: null,
  codigo: '',
  nome: '',
  especie: 'BOVINO',
  conservacao: 'RESFRIADO',
  com_osso: false,
  temperatura_rotulo: 'MANTER RESFRIADO DE 0°C A 4°C',
}

export function Produtos() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [abaPagina, setAbaPagina] = useState('PRODUTOS') // 'PRODUTOS' | 'ESPECIFICACOES'

  const [produtos, setProdutos] = useState([])
  const [especificacoes, setEspecificacoes] = useState([])
  const [loading, setLoading] = useState(true)

  // Filtros de Produtos
  const [busca, setBusca] = useState('')
  const [filtroClassificacao, setFiltroClassificacao] = useState('TODOS')
  const [filtroEspecie, setFiltroEspecie] = useState('TODOS')
  const [apenasSemEspec, setApenasSemEspec] = useState(false)
  const [paginaAtual, setPaginaAtual] = useState(1)
  const [itensPorPagina, setItensPorPagina] = useState(50)

  // Seleção para Edição em Lote
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [modalLote, setModalLote] = useState(false)
  const [salvandoLote, setSalvandoLote] = useState(false)
  const [formLote, setFormLote] = useState({
    aplicarEspec: false,
    especificacao_id: '',
    aplicarEspecie: false,
    especie: 'BOVINO',
    aplicarConservacao: false,
    conservacao: 'RESFRIADO',
    aplicarValidade: false,
    validade_dias: '5',
    aplicarTara: false,
    tara_embalagem_kg: '0.0200',
  })

  // Modal de Confirmação / Alerta
  const [modal, setModal] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null })
  const showAlert = (title, message, type = 'error') =>
    setModal({ isOpen: true, type, title, message, onConfirm: null })
  const showConfirm = (title, message, onConfirm) =>
    setModal({ isOpen: true, type: 'confirm', title, message, onConfirm })
  const closeModal = () => setModal((m) => ({ ...m, isOpen: false }))

  // Modal de Produto (Adaptativo: CARNES | EMPORIO | INSUMO + Resumo Gerencial ao Vivo)
  const [isEditing, setIsEditing] = useState(false)
  const [modoProduto, setModoProduto] = useState('CARNES') // 'CARNES' | 'EMPORIO' | 'INSUMO'
  const [abaModal, setAbaModal] = useState('IDENTIFICACAO') // IDENTIFICACAO | ARMAZENAGEM | CUSTOS | BOM
  const [savedRowId, setSavedRowId] = useState(null)
  const [salvandoProd, setSalvandoProd] = useState(false)
  const [resumoGerencial, setResumoGerencial] = useState(null)
  const [loadingResumo, setLoadingResumo] = useState(false)
  const scrollYRef = useRef(0)
  const codigoEditadoRef = useRef(false)
  const [formData, setFormData] = useState(FORM_PRODUTO_INICIAL)

  // Modal de Especificações de Rótulo
  const [modalEspec, setModalEspec] = useState(false)
  const [formEspec, setFormEspec] = useState(FORM_ESPEC_INICIAL)
  const [salvandoEspec, setSalvandoEspec] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [p, esps] = await Promise.all([
        produtosQueries.listar(),
        produtosQueries.listarEspecificacoes().catch(() => []),
      ])
      setProdutos(Array.isArray(p) ? p : [])
      setEspecificacoes(Array.isArray(esps) ? esps : [])
    } catch (err) {
      console.error(err)
      toastError('Erro ao carregar produtos', err.message || 'Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const resetForm = () => {
    setIsEditing(false)
    setModoProduto('CARNES')
    setAbaModal('IDENTIFICACAO')
    setResumoGerencial(null)
    setFormData(FORM_PRODUTO_INICIAL)
  }

  const selecionarModoProduto = (novoModo) => {
    setModoProduto(novoModo)
    setAbaModal('IDENTIFICACAO')
    setFormData((prev) => {
      if (novoModo === 'EMPORIO') {
        return {
          ...prev,
          tipo_produto: 'Revenda / Emporio',
          especie: 'EMPORIO',
          grupo: !prev.grupo || ['BOVINO', 'SUINO', 'AVES', 'MATERIAL USO E CONS'].includes(prev.grupo) ? 'EMPORIO' : prev.grupo,
          unidade: prev.unidade === 'CX' ? 'UN' : prev.unidade || 'UN',
          conservacao: !prev.id ? 'SECO' : prev.conservacao || 'SECO',
          validade_dias: !prev.id && Number(prev.validade_dias) === 5 ? 180 : prev.validade_dias,
          tara_embalagem_kg: 0,
          tara_primaria_peca_kg: 0,
          especificacao_id: '',
          registro_dipoa: '',
          classificacao: '',
          pais_ids: [],
        }
      }
      if (novoModo === 'INSUMO') {
        return {
          ...prev,
          tipo_produto: 'Insumos',
          especie: 'INSUMO',
          grupo: !prev.grupo || ['BOVINO', 'SUINO', 'AVES', 'EMPORIO'].includes(prev.grupo) ? 'MATERIAL USO E CONS' : prev.grupo,
          unidade: prev.unidade === 'CX' ? 'UN' : prev.unidade || 'UN',
          conservacao: !prev.id ? 'SECO' : prev.conservacao || 'SECO',
          validade_dias: !prev.id && Number(prev.validade_dias) === 5 ? 365 : prev.validade_dias,
          tara_embalagem_kg: 0,
          tara_primaria_peca_kg: 0,
          especificacao_id: '',
          registro_dipoa: '',
          classificacao: '',
          pais_ids: [],
        }
      }
      return {
        ...prev,
        tipo_produto:
          prev.tipo_produto === 'Revenda / Emporio' || prev.tipo_produto === 'Insumos'
            ? 'Materia Prima'
            : prev.tipo_produto || 'Materia Prima',
        especie: prev.especie === 'EMPORIO' || prev.especie === 'INSUMO' ? '' : prev.especie,
        grupo: prev.grupo === 'EMPORIO' || prev.grupo === 'MATERIAL USO E CONS' ? 'BOVINO' : prev.grupo,
        unidade: !prev.id ? 'CX' : prev.unidade || 'CX',
        conservacao: !prev.id ? 'RESFRIADO' : prev.conservacao || 'RESFRIADO',
        validade_dias: !prev.id && Number(prev.validade_dias) > 90 ? 5 : prev.validade_dias,
      }
    })
  }

  const handleEdit = (p) => {
    scrollYRef.current = window.scrollY
    const rendMap = {}
    if (Array.isArray(p.arvore_vinculos)) {
      p.arvore_vinculos.forEach((v) => {
        if (v.pai_id && v.rendimento_esperado_pct != null) {
          rendMap[v.pai_id] = v.rendimento_esperado_pct
        }
      })
    }
    const modoDet = detectarModoProduto(p)
    setModoProduto(modoDet)
    setFormData({
      id: p.id,
      codigo: p.codigo || '',
      codigo_auxiliar: p.codigo_auxiliar || '',
      ean: p.ean || '',
      descricao: p.descricao || '',
      status_curva: p.status_curva || 'C',
      unidade: p.unidade || (modoDet === 'CARNES' ? 'CX' : 'UN'),
      valor_unitario: p.valor_unitario || 0,
      custo_medio_kg: p.custo_medio_kg || 0,
      ultimo_preco_compra: p.ultimo_preco_compra || 0,
      especificacao_id: p.especificacao_id || '',
      tipo_produto: p.tipo_produto || (modoDet === 'EMPORIO' ? 'Revenda / Emporio' : modoDet === 'INSUMO' ? 'Insumos' : 'Materia Prima'),
      grupo: p.grupo || '',
      especie: p.especie || '',
      conservacao: p.conservacao || (modoDet === 'CARNES' ? 'RESFRIADO' : 'SECO'),
      validade_dias: p.validade_dias != null ? p.validade_dias : modoDet === 'CARNES' ? 5 : 180,
      tara_embalagem_kg: p.tara_embalagem_kg != null ? p.tara_embalagem_kg : 0,
      classificacao: p.classificacao || '',
      peso_padrao_cx: p.peso_padrao_cx != null ? p.peso_padrao_cx : '',
      fator_conversao_compra: p.fator_conversao_compra != null ? p.fator_conversao_compra : 1,
      preco_inicial_tabela: '',
      tara_primaria_peca_kg: p.tara_primaria_peca_kg || 0,
      ncm: p.ncm || '',
      cest: p.cest || '',
      origem_mercadoria: p.origem_mercadoria || '0',
      registro_dipoa: p.registro_dipoa || '',
      pais_ids: p.pais_ids
        ? p.pais_ids
            .toString()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((v) => (/^\d+$/.test(v) ? Number(v) : v))
        : [],
      rendimentos_map: rendMap,
    })
    codigoEditadoRef.current = false
    setAbaModal('IDENTIFICACAO')
    setIsEditing(true)

    // Carrega o painel ao vivo (Preço Médio de Venda, Estoque Mínimo Dinâmico, Tabelas)
    setResumoGerencial(null)
    setLoadingResumo(true)
    produtosQueries
      .obterResumoGerencial(p.id)
      .then((res) => setResumoGerencial(res || null))
      .catch(() => setResumoGerencial(null))
      .finally(() => setLoadingResumo(false))
  }

  const abrirNovoProduto = useCallback(async (modoInicial = 'CARNES') => {
    setIsEditing(false)
    setAbaModal('IDENTIFICACAO')
    setResumoGerencial(null)
    setModoProduto(modoInicial)
    codigoEditadoRef.current = false
    const codLocal = sugerirProximoCodigoLocal(produtos)
    const base =
      modoInicial === 'EMPORIO'
        ? {
            ...FORM_PRODUTO_INICIAL,
            codigo: codLocal,
            tipo_produto: 'Revenda / Emporio',
            especie: 'EMPORIO',
            grupo: 'EMPORIO',
            unidade: 'UN',
            conservacao: 'SECO',
            validade_dias: 180,
            fator_conversao_compra: 1,
          }
        : modoInicial === 'INSUMO'
          ? {
              ...FORM_PRODUTO_INICIAL,
              codigo: codLocal,
              tipo_produto: 'Insumos',
              especie: 'INSUMO',
              grupo: 'MATERIAL USO E CONS',
              unidade: 'UN',
              conservacao: 'SECO',
              validade_dias: 365,
              fator_conversao_compra: 1,
            }
          : { ...FORM_PRODUTO_INICIAL, codigo: codLocal }
    setFormData(base)
    setIsEditing(true)
    const codServidor = await obterProximoCodigoDisponivel('produto', produtos)
    if (!codigoEditadoRef.current) {
      setFormData((prev) => (prev.id ? prev : { ...prev, codigo: codServidor }))
    }
  }, [produtos])

  // Suporte a atalho direto /produtos?novo=emporio (vindo da tela do Empório)
  useEffect(() => {
    const novoParam = searchParams.get('novo')
    if (!loading && novoParam) {
      const m = novoParam.toLowerCase() === 'emporio' ? 'EMPORIO' : novoParam.toLowerCase() === 'insumo' ? 'INSUMO' : 'CARNES'
      abrirNovoProduto(m)
      setSearchParams({}, { replace: true })
    }
  }, [loading, searchParams, setSearchParams, abrirNovoProduto])

  const handleSelecionarEspecificacaoNoProduto = (especId) => {
    const esp = especificacoes.find((x) => String(x.id) === String(especId))
    setFormData((prev) => ({
      ...prev,
      especificacao_id: especId,
      especie: esp && !prev.especie ? esp.especie : prev.especie,
      conservacao: esp ? esp.conservacao : prev.conservacao,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const editedId = formData.id
    const codDigitado = String(formData.codigo || '').trim()
    if (editedId && !codDigitado) {
      showAlert('Código obrigatório', 'Informe o código interno do produto.')
      return
    }
    if (codDigitado) {
      const dup = encontrarCodigoDuplicadoLocal(produtos, codDigitado, editedId)
      if (dup) {
        showAlert('Código já cadastrado', `Já existe outro produto (${dup.descricao}) com o código "${codDigitado}".`)
        return
      }
    }
    const payload = {
      ...formData,
      especificacao_id: formData.especificacao_id || null,
      arvore_vinculos:
        formData.classificacao === 'SUBPRODUTO'
          ? (formData.pais_ids || []).map((pid) => ({
              pai_id: String(pid),
              rendimento_esperado_pct:
                formData.rendimentos_map?.[pid] !== undefined && formData.rendimentos_map?.[pid] !== ''
                  ? Number(formData.rendimentos_map[pid])
                  : null,
            }))
          : [],
    }
    setSalvandoProd(true)
    try {
      if (formData.id) {
        const result = await produtosQueries.atualizar(payload)
        if (!result.success) throw new Error(result.error)
        toastSuccess('Produto atualizado!', formData.descricao)
      } else {
        const result = await produtosQueries.criar(payload)
        if (!result.success) throw new Error(result.error)
        toastSuccess('Produto cadastrado!', formData.descricao)
      }
      resetForm()
      await carregar()
      if (editedId) {
        setSavedRowId(editedId)
        window.scrollTo({ top: scrollYRef.current, behavior: 'smooth' })
        setTimeout(() => {
          const row = document.getElementById(`row-produto-${editedId}`)
          if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
        setTimeout(() => setSavedRowId(null), 2500)
      }
    } catch (err) {
      showAlert('Erro ao Salvar', err.message || 'Não foi possível salvar o produto.')
    } finally {
      setSalvandoProd(false)
    }
  }

  const handleDelete = (id, nome) => {
    showConfirm('Excluir Produto', `Deseja realmente excluir "${nome}"? Esta ação não pode ser desfeita.`, async () => {
      try {
        const result = await produtosQueries.deletar(id)
        if (!result.success) throw new Error(result.error)
        toastSuccess('Produto excluído', nome)
        await carregar()
      } catch (err) {
        showAlert('Erro ao Excluir', err.message || 'Não foi possível excluir este produto.')
      }
    })
  }

  // ── EDIÇÃO EM LOTE ──────────────────────────────────────────────────────────
  const alternarSelecionado = (id) => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSalvarLote = async (e) => {
    e.preventDefault()
    const ids = Array.from(selecionados)
    if (ids.length === 0) return
    const body = { ids }
    if (formLote.aplicarEspec) body.especificacao_id = formLote.especificacao_id || null
    if (formLote.aplicarEspecie) body.especie = formLote.especie
    if (formLote.aplicarConservacao) body.conservacao = formLote.conservacao
    if (formLote.aplicarValidade) body.validade_dias = Number(formLote.validade_dias || 0)
    if (formLote.aplicarTara) body.tara_embalagem_kg = Number(formLote.tara_embalagem_kg || 0)

    if (Object.keys(body).length <= 1) {
      toastWarning('Nenhum campo marcado', 'Marque ao menos um atributo para aplicar em lote.')
      return
    }
    setSalvandoLote(true)
    try {
      const res = await produtosQueries.editarEmLote(body)
      toastSuccess('Atualização em lote concluída!', `${res.atualizados || ids.length} produto(s) atualizado(s).`)
      setModalLote(false)
      setSelecionados(new Set())
      await carregar()
    } catch (err) {
      toastError('Erro na edição em lote', err.message)
    } finally {
      setSalvandoLote(false)
    }
  }

  // ── CRUD DE ESPECIFICAÇÕES DE RÓTULO ────────────────────────────────────────
  const abrirNovaEspec = () => {
    setFormEspec(FORM_ESPEC_INICIAL)
    setModalEspec(true)
  }

  const abrirEditarEspec = (esp) => {
    setFormEspec({
      id: esp.id,
      codigo: esp.codigo || '',
      nome: esp.nome || '',
      especie: esp.especie || 'BOVINO',
      conservacao: esp.conservacao || 'RESFRIADO',
      com_osso: Number(esp.com_osso) === 1,
      temperatura_rotulo: esp.temperatura_rotulo || '',
    })
    setModalEspec(true)
  }

  const handleSalvarEspec = async (e) => {
    e.preventDefault()
    if (!formEspec.nome.trim()) {
      toastWarning('Nome obrigatório', 'Informe o texto oficial da especificação (ex: CARNE RESFRIADA DE BOVINO SEM OSSO).')
      return
    }
    setSalvandoEspec(true)
    try {
      const payload = {
        codigo: formEspec.codigo.trim() || undefined,
        nome: formEspec.nome.trim().toUpperCase(),
        especie: formEspec.especie,
        conservacao: formEspec.conservacao,
        com_osso: formEspec.com_osso ? 1 : 0,
        temperatura_rotulo: formEspec.temperatura_rotulo.trim().toUpperCase(),
      }
      if (formEspec.id) {
        await produtosQueries.atualizarEspecificacao(formEspec.id, payload)
        toastSuccess('Especificação atualizada!', payload.nome)
      } else {
        await produtosQueries.criarEspecificacao(payload)
        toastSuccess('Especificação criada!', payload.nome)
      }
      setModalEspec(false)
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar especificação', err.message)
    } finally {
      setSalvandoEspec(false)
    }
  }

  const handleExcluirEspec = (esp) => {
    showConfirm('Excluir Especificação', `Deseja remover "${esp.nome}"?`, async () => {
      try {
        await produtosQueries.excluirEspecificacao(esp.id)
        toastSuccess('Especificação removida', esp.nome)
        await carregar()
      } catch (err) {
        toastError('Não foi possível excluir', err.message)
      }
    })
  }

  const exportarCSV = () => {
    if (produtos.length === 0) return
    const header =
      'CODIGO;DESCRICAO;ESPECIFICACAO;ESPECIE;CONSERVACAO;VALIDADE_DIAS;TARA_KG;ULT_COMPRA;CUSTO_MEDIO;PRECO_MEDIO_VENDA;EST_MIN_DINAMICO_KG;SALDO_KG;CLASSIFICACAO\n'
    const rows = produtos
      .map((p) =>
        [
          p.codigo || '',
          p.descricao || '',
          p.especificacao_nome || '',
          p.especie || '',
          p.conservacao || '',
          p.validade_dias ?? 5,
          Number(p.tara_embalagem_kg || 0).toFixed(4),
          Number(p.ultimo_preco_compra || 0).toFixed(2),
          Number(p.custo_medio_kg || 0).toFixed(2),
          Number(p.preco_medio_venda || 0).toFixed(2),
          Number(p.estoque_minimo_dinamico_kg || 0).toFixed(2),
          Number(p.saldo_kg || 0).toFixed(2),
          p.classificacao || '',
        ].join(';'),
      )
      .join('\n')

    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `Produtos_WMSphere_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const contagens = useMemo(() => {
    let mp = 0
    let sub = 0
    let sem = 0
    for (const p of produtos) {
      if (p.classificacao === 'MATERIA_PRIMA') mp += 1
      else if (p.classificacao === 'SUBPRODUTO') sub += 1
      else if (!p.classificacao) sem += 1
    }
    return { TODOS: produtos.length, MATERIA_PRIMA: mp, SUBPRODUTO: sub, SEM_CLASSIFICACAO: sem }
  }, [produtos])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return produtos.filter((p) => {
      const buscaOk =
        !q ||
        (p.descricao && p.descricao.toLowerCase().includes(q)) ||
        (p.codigo && String(p.codigo).toLowerCase().includes(q)) ||
        (p.codigo_auxiliar && String(p.codigo_auxiliar).toLowerCase().includes(q)) ||
        (p.ean && String(p.ean).toLowerCase().includes(q)) ||
        (p.especificacao_nome && p.especificacao_nome.toLowerCase().includes(q))

      const classOk =
        filtroClassificacao === 'TODOS'
          ? true
          : filtroClassificacao === 'SEM_CLASSIFICACAO'
            ? !p.classificacao
            : p.classificacao === filtroClassificacao

      const espOk =
        filtroEspecie === 'TODOS'
          ? true
          : String(p.especie || 'OUTROS').toUpperCase() === filtroEspecie

      const semEspecOk = !apenasSemEspec || !p.especificacao_id

      return buscaOk && classOk && espOk && semEspecOk
    })
  }, [produtos, busca, filtroClassificacao, filtroEspecie, apenasSemEspec])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / itensPorPagina))
  const paginaSegura = Math.min(paginaAtual, totalPaginas)
  const indiceInicio = (paginaSegura - 1) * itensPorPagina
  const paginados = useMemo(
    () => filtrados.slice(indiceInicio, indiceInicio + itensPorPagina),
    [filtrados, indiceInicio, itensPorPagina],
  )

  useEffect(() => {
    setPaginaAtual(1)
  }, [busca, filtroClassificacao, filtroEspecie, apenasSemEspec, itensPorPagina])

  const todosPaginaMarcados = paginados.length > 0 && paginados.every((p) => selecionados.has(p.id))
  const toggleTodosPagina = () => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (todosPaginaMarcados) {
        paginados.forEach((p) => next.delete(p.id))
      } else {
        paginados.forEach((p) => next.add(p.id))
      }
      return next
    })
  }

  const materiasPrimas = useMemo(
    () => produtos.filter((p) => p.classificacao === 'MATERIA_PRIMA' && p.id !== formData.id),
    [produtos, formData.id],
  )

  return (
    <div className="fade-in" style={{ maxWidth: 1480, margin: '0 auto', paddingBottom: 28 }}>
      {/* HEADER */}
      <div className="page-header" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <Box className="text-primary" size={24} /> Produtos &amp; Especificações
          </h1>
          <p className="page-header__subtitle">
            Cadastro global de SKUs, especificações de rótulo industrial (100×70), custos, preço médio de venda e estoque mínimo dinâmico
          </p>
        </div>

        <div className="flex gap-8 flex-wrap">
          <button
            type="button"
            className={`btn ${abaPagina === 'PRODUTOS' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setAbaPagina('PRODUTOS')}
          >
            <Package size={15} /> Catálogo ({produtos.length})
          </button>
          <button
            type="button"
            className={`btn ${abaPagina === 'ESPECIFICACOES' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setAbaPagina('ESPECIFICACOES')}
          >
            <Tag size={15} /> Especificações de Rótulo ({especificacoes.length})
          </button>
          {abaPagina === 'PRODUTOS' ? (
            <>
              <button type="button" className="btn btn--secondary" onClick={exportarCSV}>
                <Download size={15} /> Exportar CSV
              </button>
              <button type="button" className="btn btn--primary" onClick={() => abrirNovoProduto('CARNES')}>
                <Plus size={15} /> Novo Produto
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={abrirNovaEspec}>
              <Plus size={15} /> Nova Especificação
            </button>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 1: CATÁLOGO DE PRODUTOS                                             */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {abaPagina === 'PRODUTOS' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* BARRA DE BUSCA & FILTROS */}
          <div className="p-14 border-b border-border" style={{ background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="flex gap-10 flex-wrap items-center justify-between">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 360px' }}>
                <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
                  <Search
                    size={15}
                    style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    placeholder="Buscar código, descrição, EAN ou especificação..."
                    className="form-input w-full"
                    style={{ paddingLeft: 34, height: 36 }}
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </div>

                <select
                  className="form-input"
                  style={{ width: 174, height: 36, padding: '0 10px', fontSize: 12, lineHeight: 'normal' }}
                  value={filtroEspecie}
                  onChange={(e) => setFiltroEspecie(e.target.value)}
                >
                  <option value="TODOS">Todas Espécies</option>
                  <option value="BOVINO">Bovinos</option>
                  <option value="SUINO">Suínos</option>
                  <option value="AVES">Aves</option>
                  <option value="EMPORIO">Empório</option>
                  <option value="INSUMO">Insumos</option>
                  <option value="OUTROS">Outros</option>
                </select>

                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: apenasSemEspec ? '#fbbf24' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: apenasSemEspec ? 'rgba(245,158,11,0.14)' : 'var(--bg-3)',
                    border: `1px solid ${apenasSemEspec ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={apenasSemEspec}
                    onChange={(e) => setApenasSemEspec(e.target.checked)}
                  />
                  Sem Especificação
                </label>
              </div>

              <div className="flex gap-6 flex-wrap">
                {[
                  { label: 'Todos', value: 'TODOS' },
                  { label: 'Matéria Prima', value: 'MATERIA_PRIMA' },
                  { label: 'Subproduto', value: 'SUBPRODUTO' },
                  { label: 'Não Classif.', value: 'SEM_CLASSIFICACAO' },
                ].map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFiltroClassificacao(f.value)}
                    className={`btn btn--sm ${filtroClassificacao === f.value ? 'btn--primary' : 'btn--ghost'}`}
                  >
                    {f.label} <span style={{ opacity: 0.75 }}>({contagens[f.value] ?? 0})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* BARRA DE EDIÇÃO EM LOTE QUANDO HÁ ITENS MARCADOS */}
            {selecionados.size > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                  padding: '9px 14px',
                  borderRadius: 10,
                  background: 'rgba(59, 130, 246, 0.14)',
                  border: '1px solid rgba(59, 130, 246, 0.45)',
                }}
              >
                <div className="flex items-center gap-8 text-sm font-bold" style={{ color: '#93c5fd' }}>
                  <CheckSquare size={16} />
                  {selecionados.size} produto(s) selecionado(s)
                </div>
                <div className="flex gap-8">
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => setModalLote(true)}>
                    <SlidersHorizontal size={14} /> Aplicar Especificação / Tara / Validade em Lote
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelecionados(new Set())}>
                    Limpar Seleção
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* TABELA GERENCIAL */}
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            {loading ? (
              <div className="p-32 text-center text-muted">Carregando catálogo de produtos...</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34, textAlign: 'center' }}>
                      <input type="checkbox" checked={todosPaginaMarcados} onChange={toggleTodosPagina} />
                    </th>
                    <th>Código</th>
                    <th>Produto &amp; Especificação (Rótulo)</th>
                    <th>Espécie / Cons. / Val. / Tara</th>
                    <th style={{ textAlign: 'right' }}>Últ. Compra / Custo</th>
                    <th style={{ textAlign: 'right' }}>Preço Médio Venda</th>
                    <th style={{ textAlign: 'right' }}>Est. Mín. Dinâmico</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginados.map((p) => {
                    const saldoKg = Number(p.saldo_kg || 0)
                    const estMin = Number(p.estoque_minimo_dinamico_kg || 0)
                    const abaixoMin = estMin > 0 && saldoKg < estMin
                    const custoRef = Number(p.custo_medio_kg || 0)
                    const ultCompra = Number(p.ultimo_preco_compra || 0)
                    const precoMedVenda = Number(p.preco_medio_venda || 0)
                    const marcado = selecionados.has(p.id)

                    return (
                      <tr
                        key={p.id}
                        id={`row-produto-${p.id}`}
                        style={{
                          transition: 'background 0.3s',
                          background:
                            savedRowId === p.id
                              ? 'rgba(99,102,241,0.18)'
                              : marcado
                                ? 'rgba(59,130,246,0.08)'
                                : '',
                        }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={marcado} onChange={() => alternarSelecionado(p.id)} />
                        </td>
                        <td className="td-mono font-bold">{p.codigo || '-'}</td>
                        <td style={{ maxWidth: 320 }}>
                          <div className="font-semibold truncate" title={p.descricao}>
                            {p.descricao}
                          </div>
                          <div className="flex items-center gap-6 flex-wrap" style={{ marginTop: 3 }}>
                            {p.especificacao_nome ? (
                              <span
                                className="badge badge--info"
                                style={{ fontSize: 10, maxWidth: 270, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={p.especificacao_nome}
                              >
                                {p.especificacao_nome}
                              </span>
                            ) : detectarModoProduto(p) === 'EMPORIO' ? (
                              <span className="badge badge--success" style={{ fontSize: 10 }}>
                                Empório / Revenda{Number(p.fator_conversao_compra || 1) > 1 ? ` • Fardo ×${Number(p.fator_conversao_compra)}` : ''}
                              </span>
                            ) : detectarModoProduto(p) === 'INSUMO' ? (
                              <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                                Insumo / Embalagem
                              </span>
                            ) : (
                              <span className="text-xs text-muted" style={{ fontSize: 10.5 }}>
                                Sem especificação de rótulo
                              </span>
                            )}
                            {p.classificacao === 'MATERIA_PRIMA' && (
                              <span className="badge badge--success" style={{ fontSize: 10 }}>M. Prima</span>
                            )}
                            {p.classificacao === 'SUBPRODUTO' && (
                              <span className="badge badge--warning" style={{ fontSize: 10 }}>Subproduto</span>
                            )}
                          </div>
                          {p.pai_descricao && (
                            <div className="text-xs text-muted" style={{ marginTop: 2, fontSize: 10.5 }}>
                              ↳ Origem: {p.pai_descricao}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="badge badge--neutral" style={{ fontSize: 10 }}>
                              {p.especie || 'AUTO'}
                            </span>
                            <span className="text-xs text-muted">{p.conservacao || 'RESFRIADO'}</span>
                          </div>
                          <div className="text-xs font-mono text-muted" style={{ marginTop: 2 }}>
                            Val {p.validade_dias ?? 5}d • Tara {(Number(p.tara_embalagem_kg || 0) * 1000).toFixed(0)}g
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="font-mono font-bold text-xs">
                            {ultCompra > 0 ? fmtMoeda(ultCompra) : custoRef > 0 ? fmtMoeda(custoRef) : '—'}
                          </div>
                          <div className="text-xs text-muted font-mono" style={{ fontSize: 10.5 }}>
                            Custo: {custoRef > 0 ? fmtMoeda(custoRef) : '—'}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div
                            className="font-mono font-bold text-sm"
                            style={{ color: precoMedVenda > 0 ? '#22c55e' : 'var(--text-muted)' }}
                          >
                            {precoMedVenda > 0 ? fmtMoeda(precoMedVenda) : '—'}
                          </div>
                          {precoMedVenda > 0 && custoRef > 0 && (
                            <div className="text-xs font-mono text-muted" style={{ fontSize: 10.5 }}>
                              Mg {(((precoMedVenda - custoRef) / precoMedVenda) * 100).toFixed(1)}%
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {estMin > 0 ? (
                            <div
                              className="font-mono font-bold text-xs"
                              style={{ color: abaixoMin ? '#f59e0b' : 'var(--text-primary)' }}
                              title={`Consumo médio: ${Number(p.consumo_medio_dia_total_kg || 0).toFixed(2)} kg/dia`}
                            >
                              {abaixoMin && <AlertTriangle size={11} style={{ display: 'inline', marginRight: 3 }} />}
                              {fmtKg(estMin, 1)}
                            </div>
                          ) : (
                            <span className="text-xs text-muted">Sem giro</span>
                          )}
                          {Number(p.consumo_medio_dia_total_kg || 0) > 0 && (
                            <div className="text-xs text-muted font-mono" style={{ fontSize: 10 }}>
                              {Number(p.consumo_medio_dia_total_kg).toFixed(1)} kg/dia
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div
                            className="inline-flex flex-col items-end px-8 py-4 rounded text-xs font-bold"
                            style={{
                              background: saldoKg > 0 ? 'var(--success-muted)' : 'var(--bg-3)',
                              color: saldoKg > 0 ? 'var(--success)' : 'var(--text-muted)',
                            }}
                          >
                            <span>{saldoKg.toFixed(1)} kg</span>
                            <span style={{ fontSize: 10, opacity: 0.8 }}>{Number(p.qtd_caixas || 0)} cx</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex items-center justify-end gap-4">
                            <button
                              type="button"
                              title="Editar e ver painel gerencial"
                              onClick={() => handleEdit(p)}
                              className="btn-icon"
                              style={{ color: 'var(--accent-hover)' }}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              type="button"
                              title="Excluir"
                              onClick={() => handleDelete(p.id, p.descricao)}
                              className="btn-icon"
                              style={{ color: 'var(--danger)' }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filtrados.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center p-32 text-muted">
                        Nenhum produto encontrado para este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* PAGINAÇÃO */}
          {!loading && filtrados.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 16px',
                background: 'var(--bg-2)',
                borderTop: '1px solid var(--border)',
                fontSize: 12.5,
              }}
            >
              <div className="text-muted">
                Mostrando <strong style={{ color: 'var(--text-primary)' }}>{indiceInicio + 1}</strong>–
                <strong style={{ color: 'var(--text-primary)' }}>
                  {Math.min(indiceInicio + itensPorPagina, filtrados.length)}
                </strong>{' '}
                de <strong style={{ color: 'var(--text-primary)' }}>{filtrados.length.toLocaleString('pt-BR')}</strong>{' '}
                produtos
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label className="text-muted flex items-center gap-6">
                  Por página:
                  <select
                    className="form-input"
                    style={{ width: 76, padding: '4px 8px', fontSize: 12 }}
                    value={itensPorPagina}
                    onChange={(e) => setItensPorPagina(Number(e.target.value))}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={paginaSegura <= 1} onClick={() => setPaginaAtual(1)}>
                    «
                  </button>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={paginaSegura <= 1} onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}>
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <span className="font-mono text-xs" style={{ padding: '0 6px', color: 'var(--text-secondary)' }}>
                    Pág. {paginaSegura} / {totalPaginas}
                  </span>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={paginaSegura >= totalPaginas} onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}>
                    Próxima <ChevronRight size={14} />
                  </button>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={paginaSegura >= totalPaginas} onClick={() => setPaginaAtual(totalPaginas)}>
                    »
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 2: ESPECIFICAÇÕES DE RÓTULO (ETIQUETAS INDUSTRIAIS 100×70)          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {abaPagina === 'ESPECIFICACOES' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
            <div className="font-bold text-sm">Especificações Oficiais de Rotulagem Industrial (100×70mm)</div>
            <div className="text-xs text-muted mt-4">
              Este título aparece em destaque no topo das etiquetas adesivas de caixa (Retorno de Produção, Desmembramento, Recebimento e Reimpressão).
            </div>
          </div>

          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Texto Oficial da Especificação (Rótulo)</th>
                  <th>Espécie</th>
                  <th>Conservação</th>
                  <th>Osso</th>
                  <th>Temperatura no Rótulo</th>
                  <th style={{ textAlign: 'right' }}>Produtos</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {especificacoes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center p-24 text-muted">
                      Nenhuma especificação cadastrada.
                    </td>
                  </tr>
                ) : (
                  especificacoes.map((esp) => (
                    <tr key={esp.id}>
                      <td className="font-mono text-xs font-bold text-info">{esp.codigo || '-'}</td>
                      <td className="font-bold text-sm">{esp.nome}</td>
                      <td>
                        <span className="badge badge--neutral">{esp.especie}</span>
                      </td>
                      <td>
                        <span className={`badge ${esp.conservacao === 'CONGELADO' ? 'badge--info' : 'badge--success'}`}>
                          <Snowflake size={11} /> {esp.conservacao}
                        </span>
                      </td>
                      <td className="text-xs">{Number(esp.com_osso) === 1 ? 'Com Osso' : 'Sem Osso'}</td>
                      <td className="text-xs text-muted">{esp.temperatura_rotulo || '-'}</td>
                      <td className="font-mono font-bold" style={{ textAlign: 'right' }}>
                        {esp.qtd_produtos || 0}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-4">
                          <button type="button" className="btn-icon" style={{ color: 'var(--accent-hover)' }} onClick={() => abrirEditarEspec(esp)}>
                            <Edit2 size={14} />
                          </button>
                          <button type="button" className="btn-icon" style={{ color: 'var(--danger)' }} onClick={() => handleExcluirEspec(esp)}>
                            <Trash2 size={14} />
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
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL DE PRODUTO COM ABAS + KPI AO VIVO (PREÇO MÉDIO + EST. MÍNIMO)     */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {isEditing && (
        <div
          className="modal-overlay"
          style={{ padding: 20, zIndex: 1050 }}
          onClick={(e) => e.target === e.currentTarget && resetForm()}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 960,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-1)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
            }}
          >
            {/* CABEÇALHO */}
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 22px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <h2 className="text-lg font-bold flex items-center gap-8 m-0">
                  {formData.id ? <Edit2 size={18} className="text-primary" /> : <Plus size={18} className="text-primary" />}
                  {formData.id ? `${formData.codigo} — ${formData.descricao}` : 'Novo Produto'}
                </h2>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  Cadastro unificado para todas as filiais • Preços de venda são geridos em Tabelas de Preço
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={resetForm} title="Fechar">
                <X size={18} />
              </button>
            </div>

            {/* PAINEL GERENCIAL AO VIVO (AO EDITAR UM PRODUTO EXISTENTE) */}
            {formData.id && (
              <div
                style={{
                  flexShrink: 0,
                  padding: '12px 22px',
                  background: '#0d1526',
                  borderBottom: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 10,
                }}
              >
                {loadingResumo ? (
                  <div style={{ gridColumn: '1 / -1' }} className="text-xs text-muted">
                    Calculando preço médio de venda, margem e estoque mínimo dinâmico em tempo real...
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      <div className="text-xs text-muted uppercase flex items-center gap-4">
                        <DollarSign size={12} /> Últ. Compra / Custo
                      </div>
                      <div className="font-mono font-bold text-sm" style={{ marginTop: 2 }}>
                        {fmtMoeda(resumoGerencial?.ultimo_preco_compra || formData.ultimo_preco_compra || 0)}
                      </div>
                      <div className="text-xs text-muted font-mono">
                        Custo Médio: {fmtMoeda(resumoGerencial?.custo_medio_kg || formData.custo_medio_kg || 0)}
                      </div>
                    </div>

                    <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid rgba(34,197,94,0.35)' }}>
                      <div className="text-xs text-muted uppercase flex items-center gap-4">
                        <TrendingUp size={12} className="text-success" /> Preço Médio Venda
                      </div>
                      <div className="font-mono font-bold text-sm text-success" style={{ marginTop: 2 }}>
                        {Number(resumoGerencial?.preco_medio_venda || 0) > 0
                          ? fmtMoeda(resumoGerencial.preco_medio_venda)
                          : 'Sem vendas ainda'}
                      </div>
                      <div className="text-xs text-muted font-mono">
                        Margem Real:{' '}
                        <strong style={{ color: Number(resumoGerencial?.margem_real_pct || 0) >= 0 ? '#4ade80' : '#f87171' }}>
                          {Number(resumoGerencial?.margem_real_pct || 0).toFixed(1)}%
                        </strong>
                      </div>
                    </div>

                    <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid rgba(245,158,11,0.35)' }}>
                      <div className="text-xs text-muted uppercase flex items-center gap-4">
                        <Activity size={12} className="text-warning" /> Est. Mín. Dinâmico
                      </div>
                      <div className="font-mono font-bold text-sm text-warning" style={{ marginTop: 2 }}>
                        {fmtKg(resumoGerencial?.estoque_minimo_dinamico_kg || 0, 1)}
                      </div>
                      <div className="text-xs text-muted font-mono">
                        Giro: {Number(resumoGerencial?.consumo_medio_dia_total_kg || 0).toFixed(2)} kg/d
                        {resumoGerencial?.cobertura_dias != null ? ` • Cob. ${resumoGerencial.cobertura_dias}d` : ''}
                      </div>
                    </div>

                    <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      <div className="text-xs text-muted uppercase">Tabelas de Preço</div>
                      <div className="font-mono font-bold text-sm text-info" style={{ marginTop: 2 }}>
                        {(resumoGerencial?.tabelas_preco || []).length} tabela(s)
                      </div>
                      <div className="text-xs text-muted truncate">
                        {resumoGerencial?.tabelas_preco?.[0]
                          ? `${resumoGerencial.tabelas_preco[0].tabela_nome}: ${fmtMoeda(resumoGerencial.tabelas_preco[0].preco_venda)}`
                          : 'Configure em Tabelas de Preço'}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* SELETOR DE PERFIL DO PRODUTO (ADAPTA O FORMULÁRIO AUTOMATICAMENTE) */}
            <div
              style={{
                flexShrink: 0,
                padding: '10px 22px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, flex: '1 1 520px' }}>
                {[
                  {
                    id: 'CARNES',
                    label: 'Carnes / Industrial',
                    desc: 'Cortes, caixas, DIPOA, tara e BOM',
                    icon: Factory,
                    cor: '#3b82f6',
                  },
                  {
                    id: 'EMPORIO',
                    label: 'Empório / Revenda',
                    desc: 'Bebidas, carvão, EAN-13 e fardo',
                    icon: ShoppingBag,
                    cor: '#22c55e',
                  },
                  {
                    id: 'INSUMO',
                    label: 'Insumos / Embalagens',
                    desc: 'Sacos, caixas vazias, limpeza',
                    icon: Boxes,
                    cor: '#f59e0b',
                  },
                ].map((m) => {
                  const Icon = m.icon
                  const ativo = modoProduto === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selecionarModoProduto(m.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 10,
                        textAlign: 'left',
                        cursor: 'pointer',
                        border: `1.5px solid ${ativo ? m.cor : 'var(--border)'}`,
                        background: ativo ? `${m.cor}1d` : 'var(--bg-1)',
                        color: ativo ? '#ffffff' : 'var(--text-secondary)',
                      }}
                    >
                      <Icon size={17} color={ativo ? m.cor : '#94a3b8'} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="font-bold text-xs" style={{ color: ativo ? '#ffffff' : 'var(--text-primary)' }}>
                          {m.label}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.desc}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ABAS DO MODAL (ADAPTADAS AO PERFIL SELECIONADO) */}
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                gap: 6,
                padding: '9px 22px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}
            >
              {(modoProduto === 'CARNES'
                ? [
                    { id: 'IDENTIFICACAO', label: '1. Identificação & Rótulo' },
                    { id: 'ARMAZENAGEM', label: '2. Conservação, Validade & Taras' },
                    { id: 'CUSTOS', label: '3. Custos, Inteligência & Fiscal' },
                    { id: 'BOM', label: '4. Produção / BOM' },
                  ]
                : modoProduto === 'EMPORIO'
                  ? [
                      { id: 'IDENTIFICACAO', label: '1. Produto, EAN & Fardo' },
                      { id: 'CUSTOS', label: '2. Custos, Preço & Fiscal' },
                    ]
                  : [
                      { id: 'IDENTIFICACAO', label: '1. Identificação & Embalagem' },
                      { id: 'CUSTOS', label: '2. Custos & Fiscal' },
                    ]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`btn btn--sm ${abaModal === t.id ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setAbaModal(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* FORMULÁRIO */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 22 }}>
              <form id="produto-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* ═══════════════════════════════════════════════════════════════ */}
                {/* ABA 1 — MODO EMPÓRIO / REVENDA (TELA LIMPA E DEDICADA)          */}
                {/* ═══════════════════════════════════════════════════════════════ */}
                {abaModal === 'IDENTIFICACAO' && modoProduto === 'EMPORIO' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="card" style={{ padding: 18, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div className="form-grid form-grid--3">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Código Interno (SKU)</label>
                          <input
                            type="text"
                            className="form-input font-mono"
                            value={formData.codigo}
                            onChange={(e) => {
                              codigoEditadoRef.current = true
                              setFormData({ ...formData, codigo: e.target.value })
                            }}
                            required={Boolean(formData.id)}
                            placeholder="Automático"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ color: '#4ade80', fontWeight: 700 }}>
                            EAN-13 / Código de Barras (Bipável no PDV)
                          </label>
                          <div style={{ position: 'relative' }}>
                            <ScanBarcode
                              size={15}
                              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#4ade80' }}
                            />
                            <input
                              type="text"
                              className="form-input font-mono"
                              style={{ paddingLeft: 32 }}
                              value={formData.ean}
                              onChange={(e) => setFormData({ ...formData, ean: e.target.value })}
                              placeholder="Ex: 7894900011517"
                            />
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Categoria Empório</label>
                          <select
                            className="form-input"
                            value={formData.grupo || 'EMPORIO'}
                            onChange={(e) => setFormData({ ...formData, grupo: e.target.value })}
                          >
                            <option value="EMPORIO">Empório / Mercearia</option>
                            <option value="BEBIDAS">Bebidas / Refrigerantes</option>
                            <option value="BEBIDAS ALCOOLICA">Bebidas Alcoólicas</option>
                            <option value="CARVAO">Carvão &amp; Churrasco</option>
                            <option value="TEMPEROS">Temperos &amp; Molhos</option>
                            <option value="EMBUTIDOS">Embutidos / Frios</option>
                          </select>
                        </div>
                      </div>

                      <div className="form-grid form-grid--3">
                        <div className="form-group" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                          <label className="form-label">Descrição do Produto *</label>
                          <input
                            type="text"
                            className="form-input"
                            value={formData.descricao}
                            onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                            placeholder="Ex: COCA-COLA LATA 350ML ou CARVÃO VEGETAL 5KG"
                            required
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Curva ABC</label>
                          <select
                            className="form-input"
                            value={formData.status_curva}
                            onChange={(e) => setFormData({ ...formData, status_curva: e.target.value })}
                          >
                            <option value="A">Curva A (Alta)</option>
                            <option value="B">Curva B (Média)</option>
                            <option value="C">Curva C (Baixa)</option>
                          </select>
                        </div>
                      </div>

                      {/* CONVERSÃO COMPRA (FARDO) → VENDA (UNIDADE) + CONSERVAÇÃO */}
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 10,
                          background: 'rgba(34,197,94,0.08)',
                          border: '1px solid rgba(34,197,94,0.32)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                        }}
                      >
                        <div className="form-grid form-grid--4">
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Unidade de Venda (PDV)</label>
                            <select
                              className="form-input"
                              value={formData.unidade}
                              onChange={(e) => setFormData({ ...formData, unidade: e.target.value })}
                            >
                              <option value="UN">UN (Unidade)</option>
                              <option value="PC">PC (Peça)</option>
                              <option value="KG">KG (Quilograma)</option>
                              <option value="LT">LT (Litro)</option>
                              <option value="CX">CX (Caixa)</option>
                            </select>
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Unid. por Fardo/Caixa</label>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              className="form-input font-mono text-right"
                              value={formData.fator_conversao_compra}
                              onChange={(e) => setFormData({ ...formData, fator_conversao_compra: e.target.value })}
                              placeholder="12"
                            />
                            <span className="form-hint">Ex.: 12 p/ fardo de 12 latas (XML converte automático).</span>
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Conservação</label>
                            <select
                              className="form-input"
                              value={formData.conservacao}
                              onChange={(e) => setFormData({ ...formData, conservacao: e.target.value })}
                            >
                              <option value="SECO">Seco / Ambiente</option>
                              <option value="RESFRIADO">Resfriado (0°C a 4°C)</option>
                              <option value="CONGELADO">Congelado (-18°C)</option>
                            </select>
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Validade Padrão (dias)</label>
                            <input
                              type="number"
                              min="0"
                              max="3650"
                              className="form-input font-mono text-right"
                              value={formData.validade_dias}
                              onChange={(e) => setFormData({ ...formData, validade_dias: e.target.value })}
                            />
                          </div>
                        </div>

                        {!formData.id && (
                          <div className="form-grid form-grid--3" style={{ borderTop: '1px solid rgba(34,197,94,0.22)', paddingTop: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label">Últ. Preço Compra (R$/un)</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="form-input font-mono text-right"
                                value={formData.ultimo_preco_compra}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    ultimo_preco_compra: e.target.value,
                                    custo_medio_kg: Number(formData.custo_medio_kg || 0) === 0 ? e.target.value : formData.custo_medio_kg,
                                  })
                                }
                                placeholder="0,00"
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label" style={{ color: '#4ade80', fontWeight: 700 }}>
                                Preço Inicial Tabela Padrão (R$)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="form-input font-mono text-right"
                                style={{ fontWeight: 700 }}
                                value={formData.preco_inicial_tabela}
                                onChange={(e) => setFormData({ ...formData, preco_inicial_tabela: e.target.value })}
                                placeholder="Ex: 5.50 (Opcional)"
                              />
                              <span className="form-hint">Já vincula automaticamente na tabela padrão do PDV.</span>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label">NCM (Opcional)</label>
                              <input
                                type="text"
                                className="form-input font-mono"
                                value={formData.ncm}
                                onChange={(e) => setFormData({ ...formData, ncm: e.target.value })}
                                placeholder="Ex: 22021000"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══════════════════════════════════════════════════════════════ */}
                {/* ABA 1 — MODO INSUMOS / EMBALAGENS (TELA LIMPA E DEDICADA)       */}
                {/* ═══════════════════════════════════════════════════════════════ */}
                {abaModal === 'IDENTIFICACAO' && modoProduto === 'INSUMO' && (
                  <div className="card" style={{ padding: 18, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-grid form-grid--3">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Código Interno (SKU)</label>
                        <input
                          type="text"
                          className="form-input font-mono"
                          value={formData.codigo}
                          onChange={(e) => {
                            codigoEditadoRef.current = true
                            setFormData({ ...formData, codigo: e.target.value })
                          }}
                          required={Boolean(formData.id)}
                          placeholder="Automático"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">EAN / Código de Barras</label>
                        <input
                          type="text"
                          className="form-input font-mono"
                          value={formData.ean}
                          onChange={(e) => setFormData({ ...formData, ean: e.target.value })}
                          placeholder="Opcional"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Categoria</label>
                        <select
                          className="form-input"
                          value={formData.grupo || 'MATERIAL USO E CONS'}
                          onChange={(e) => setFormData({ ...formData, grupo: e.target.value })}
                        >
                          <option value="MATERIAL USO E CONS">Material de Uso e Consumo</option>
                          <option value="EMBALAGENS">Embalagens / Sacos / Caixas</option>
                          <option value="HIGIENE">Higiene &amp; Limpeza</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Descrição do Insumo / Embalagem *</label>
                      <input
                        type="text"
                        className="form-input"
                        value={formData.descricao}
                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                        placeholder="Ex: SACO VÁCUO 25X35 TRANSPARENTE"
                        required
                      />
                    </div>

                    <div className="form-grid form-grid--3">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Unidade de Controle</label>
                        <select
                          className="form-input"
                          value={formData.unidade}
                          onChange={(e) => setFormData({ ...formData, unidade: e.target.value })}
                        >
                          <option value="UN">UN (Unidade)</option>
                          <option value="PCT">PCT (Pacote)</option>
                          <option value="CX">CX (Caixa)</option>
                          <option value="RL">RL (Rolo)</option>
                          <option value="KG">KG (Quilograma)</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Unid. por Fardo/Caixa</label>
                        <input
                          type="number"
                          step="1"
                          min="1"
                          className="form-input font-mono text-right"
                          value={formData.fator_conversao_compra}
                          onChange={(e) => setFormData({ ...formData, fator_conversao_compra: e.target.value })}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Armazenagem</label>
                        <select
                          className="form-input"
                          value={formData.conservacao}
                          onChange={(e) => setFormData({ ...formData, conservacao: e.target.value })}
                        >
                          <option value="SECO">Seco / Temperatura Ambiente</option>
                          <option value="RESFRIADO">Resfriado</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══════════════════════════════════════════════════════════════ */}
                {/* ABA 1 — MODO CARNES / INDUSTRIAL (COMPLETO)                     */}
                {/* ═══════════════════════════════════════════════════════════════ */}
                {abaModal === 'IDENTIFICACAO' && modoProduto === 'CARNES' && (
                  <div className="card" style={{ padding: 18, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="form-grid form-grid--3">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Código Interno (SKU)</label>
                        <input
                          type="text"
                          className="form-input font-mono"
                          value={formData.codigo}
                          onChange={(e) => {
                            codigoEditadoRef.current = true
                            setFormData({ ...formData, codigo: e.target.value })
                          }}
                          required={Boolean(formData.id)}
                          placeholder="Automático"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Código Auxiliar</label>
                        <input
                          type="text"
                          className="form-input font-mono"
                          value={formData.codigo_auxiliar}
                          onChange={(e) => setFormData({ ...formData, codigo_auxiliar: e.target.value })}
                          placeholder="Ex: 5951"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">EAN / GTIN Principal</label>
                        <input
                          type="text"
                          className="form-input font-mono"
                          value={formData.ean}
                          onChange={(e) => setFormData({ ...formData, ean: e.target.value })}
                          placeholder="Ex: 7894900011517"
                        />
                      </div>
                    </div>

                    <div className="form-grid form-grid--3">
                      <div className="form-group" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                        <label className="form-label">Descrição do Produto / Corte *</label>
                        <input
                          type="text"
                          className="form-input"
                          value={formData.descricao}
                          onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                          placeholder="Ex: PICANHA BOVINA RESFRIADA"
                          required
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Grupo Comercial</label>
                        <select
                          className="form-input"
                          value={formData.grupo}
                          onChange={(e) => setFormData({ ...formData, grupo: e.target.value })}
                        >
                          <option value="">Selecione...</option>
                          <option value="BOVINO">BOVINO</option>
                          <option value="SUINO">SUINO</option>
                          <option value="AVES">AVES</option>
                          <option value="EMBUTIDOS">EMBUTIDOS</option>
                        </select>
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 14,
                        borderRadius: 10,
                        background: 'rgba(59,130,246,0.08)',
                        border: '1px solid rgba(59,130,246,0.32)',
                      }}
                    >
                      <label className="form-label" style={{ color: '#93c5fd', fontWeight: 700 }}>
                        Especificação do Produto
                      </label>
                      <SmartSearchSelect
                        items={especificacoes}
                        value={formData.especificacao_id}
                        onChange={(val) => handleSelecionarEspecificacaoNoProduto(val)}
                        icon="product"
                        getCode={(esp) => String(esp?.especie || '')}
                        getLabel={(esp) => String(esp?.nome || '')}
                        getSubLabel={(esp) => [esp?.especie, esp?.conservacao, esp?.validade_dias ? `${esp.validade_dias}d` : ''].filter(Boolean).join(' • ')}
                        emptyLabel="Nenhuma especificação vinculada..."
                        placeholder="Pesquisar especificação de rótulo..."
                        modalTitle="Selecionar Especificação do Produto"
                      />
                    </div>

                    <div className="form-grid form-grid--4">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Tipo de Produto</label>
                        <select
                          className="form-input"
                          value={formData.tipo_produto}
                          onChange={(e) => setFormData({ ...formData, tipo_produto: e.target.value })}
                        >
                          <option value="Materia Prima">Matéria Prima</option>
                          <option value="Produto Acabado">Produto Acabado</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Unidade Base</label>
                        <select
                          className="form-input"
                          value={formData.unidade}
                          onChange={(e) => setFormData({ ...formData, unidade: e.target.value })}
                        >
                          <option value="CX">CX (Caixa)</option>
                          <option value="KG">KG (Quilograma)</option>
                          <option value="UN">UN (Unidade)</option>
                          <option value="PC">PC (Peça)</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Curva ABC</label>
                        <select
                          className="form-input"
                          value={formData.status_curva}
                          onChange={(e) => setFormData({ ...formData, status_curva: e.target.value })}
                        >
                          <option value="A">Curva A (Alta)</option>
                          <option value="B">Curva B (Média)</option>
                          <option value="C">Curva C (Baixa)</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Registro DIPOA *</label>
                        <input
                          type="text"
                          className="form-input font-mono"
                          value={formData.registro_dipoa}
                          onChange={(e) => setFormData({ ...formData, registro_dipoa: e.target.value.toUpperCase() })}
                          placeholder="Ex: 005 ou 007"
                          required={!formData.id && modoProduto === 'CARNES'}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ABA 2: ARMAZENAGEM, VALIDADE & TARAS (SOMENTE CARNES / INDUSTRIAL) */}
                {abaModal === 'ARMAZENAGEM' && modoProduto === 'CARNES' && (
                  <div className="card" style={{ padding: 18, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="text-xs text-muted">
                      A <strong>Validade Padrão</strong> e a <strong>Tara da Embalagem</strong> definidas aqui são carregadas automaticamente e bloqueadas contra alteração manual na balança do Açougue.
                    </div>
                    <div className="form-grid form-grid--4">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Espécie / Categoria</label>
                        <select
                          className="form-input"
                          value={formData.especie}
                          onChange={(e) => setFormData({ ...formData, especie: e.target.value })}
                        >
                          <option value="">Auto (pelo Grupo / NCM)</option>
                          <option value="BOVINO">Bovino</option>
                          <option value="SUINO">Suíno</option>
                          <option value="AVES">Aves</option>
                          <option value="EMPORIO">Empório</option>
                          <option value="INSUMO">Insumo / Embalagem</option>
                          <option value="OUTROS">Outros</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Armazenagem / Conservação</label>
                        <select
                          className="form-input"
                          value={formData.conservacao}
                          onChange={(e) => setFormData({ ...formData, conservacao: e.target.value })}
                        >
                          <option value="RESFRIADO">Resfriado (0°C a 4°C)</option>
                          <option value="CONGELADO">Congelado (-18°C)</option>
                          <option value="SECO">Seco / Temperatura Ambiente</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Validade Padrão (dias) *</label>
                        <input
                          type="number"
                          min="0"
                          max="3650"
                          className="form-input text-right font-mono"
                          value={formData.validade_dias}
                          onChange={(e) => setFormData({ ...formData, validade_dias: e.target.value })}
                        />
                        <span className="form-hint">Calculada automaticamente nas etiquetas.</span>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Tara Bandeja / Embalagem (kg)</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          className="form-input text-right font-mono"
                          value={formData.tara_embalagem_kg}
                          onChange={(e) => setFormData({ ...formData, tara_embalagem_kg: e.target.value })}
                          placeholder="0.0200"
                        />
                        <span className="form-hint">Ex: 0.0200 = 20 gramas (trava no Açougue).</span>
                      </div>
                    </div>

                    <div className="form-grid form-grid--2">
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Peso Padrão Caixa Industrial (kg)</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          className="form-input text-right font-mono"
                          value={formData.peso_padrao_cx}
                          onChange={(e) => setFormData({ ...formData, peso_padrao_cx: e.target.value })}
                          placeholder="Ex: 20.000"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Tara Saco / Vácuo por Peça (kg)</label>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          className="form-input text-right font-mono"
                          value={formData.tara_primaria_peca_kg}
                          onChange={(e) => setFormData({ ...formData, tara_primaria_peca_kg: e.target.value })}
                          placeholder="Ex: 0.0150 (15g)"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ABA 3: CUSTOS, INTELIGÊNCIA & FISCAL */}
                {abaModal === 'CUSTOS' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="card" style={{ padding: 18, background: 'var(--bg-2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div className="form-grid form-grid--4">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Último Preço Compra (R$)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="form-input text-right font-mono"
                            value={formData.ultimo_preco_compra}
                            onChange={(e) => setFormData({ ...formData, ultimo_preco_compra: e.target.value })}
                          />
                          <span className="form-hint">Atualizado automaticamente via XML NF-e.</span>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Custo Médio (R$/kg ou un)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="form-input text-right font-mono"
                            value={formData.custo_medio_kg}
                            onChange={(e) => setFormData({ ...formData, custo_medio_kg: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">NCM</label>
                          <input
                            type="text"
                            className="form-input font-mono"
                            value={formData.ncm}
                            onChange={(e) => setFormData({ ...formData, ncm: e.target.value })}
                            placeholder="Ex: 02013000"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">CEST</label>
                          <input
                            type="text"
                            className="form-input font-mono"
                            value={formData.cest}
                            onChange={(e) => setFormData({ ...formData, cest: e.target.value })}
                            placeholder="Opcional"
                          />
                        </div>
                      </div>
                      <div className="form-grid form-grid--2">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Origem Mercadoria</label>
                          <select
                            className="form-input"
                            value={formData.origem_mercadoria}
                            onChange={(e) => setFormData({ ...formData, origem_mercadoria: e.target.value })}
                          >
                            <option value="0">0 - Nacional</option>
                            <option value="1">1 - Estrangeira (Imp. Direta)</option>
                            <option value="2">2 - Estrangeira (Merc. Interno)</option>
                          </select>
                        </div>
                        {!formData.id && (
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ color: '#4ade80' }}>
                              Preço Inicial Tabela Padrão (R$) — Opcional
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="form-input text-right font-mono"
                              value={formData.preco_inicial_tabela}
                              onChange={(e) => setFormData({ ...formData, preco_inicial_tabela: e.target.value })}
                              placeholder="Ex: 5.50 ou 59.90"
                            />
                            <span className="form-hint">Já cadastra o item na Tabela Padrão do PDV/Açougue.</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* DETALHAMENTO DE CONSUMO DINÂMICO E TABELAS DE PREÇO */}
                    {formData.id && resumoGerencial && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
                          <div className="text-xs font-bold uppercase text-warning mb-8">
                            Composição do Estoque Mínimo Dinâmico (30 dias)
                          </div>
                          <div className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span className="text-muted">Saídas p/ Ordens de Produção (OP):</span>
                              <strong className="font-mono">{Number(resumoGerencial.consumo_medio_dia_op_kg || 0).toFixed(2)} kg/dia</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span className="text-muted">Saídas p/ Pedidos / Expedição:</span>
                              <strong className="font-mono">{Number(resumoGerencial.consumo_medio_dia_pedidos_kg || 0).toFixed(2)} kg/dia</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span className="text-muted">Saídas Varejo / PDV:</span>
                              <strong className="font-mono">{Number(resumoGerencial.consumo_medio_dia_pdv_kg || 0).toFixed(2)} kg/dia</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                              <span>Estoque Mínimo Recomendado (7 dias):</span>
                              <strong className="font-mono text-warning">{fmtKg(resumoGerencial.estoque_minimo_dinamico_kg || 0, 1)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
                          <div className="text-xs font-bold uppercase text-info mb-8">
                            Tabelas de Preço Vinculadas ({(resumoGerencial.tabelas_preco || []).length})
                          </div>
                          {(resumoGerencial.tabelas_preco || []).length === 0 ? (
                            <div className="text-xs text-muted">
                              Este produto ainda não possui preço cadastrado em nenhuma tabela. Configure no módulo <strong>Tabelas de Preço</strong>.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {resumoGerencial.tabelas_preco.map((t) => (
                                <div key={t.tabela_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                  <span>
                                    <strong>{t.tabela_nome}</strong>{' '}
                                    <span className="text-xs text-muted">({t.finalidade})</span>
                                  </span>
                                  <span className="font-mono font-bold text-success">{fmtMoeda(t.preco_venda)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ABA 4: PRODUÇÃO / BOM (SOMENTE CARNES / INDUSTRIAL) */}
                {abaModal === 'BOM' && modoProduto === 'CARNES' && (
                  <div className="card" style={{ padding: 18, background: 'var(--bg-2)' }}>
                    <div className="flex items-center gap-8 text-xs font-bold uppercase text-primary mb-10">
                      <Layers size={15} /> Classificação &amp; Árvore BOM de Produção
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {[
                        { val: 'MATERIA_PRIMA', label: 'Matéria Prima (Raiz)', cor: '#22c55e', bg: 'rgba(34,197,94,0.16)' },
                        { val: 'SUBPRODUTO', label: 'Subproduto (Derivado)', cor: '#f59e0b', bg: 'rgba(245,158,11,0.16)' },
                        { val: '', label: 'Não se aplica', cor: '#60a5fa', bg: 'rgba(59,130,246,0.16)' },
                      ].map((op) => {
                        const ativo = formData.classificacao === op.val
                        return (
                          <button
                            key={op.label}
                            type="button"
                            onClick={() =>
                              setFormData({
                                ...formData,
                                classificacao: op.val,
                                pais_ids: op.val === 'SUBPRODUTO' ? formData.pais_ids : [],
                              })
                            }
                            style={{
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: `1.5px solid ${ativo ? op.cor : 'var(--border)'}`,
                              background: ativo ? op.bg : 'var(--bg-3)',
                              color: ativo ? op.cor : 'var(--text-secondary)',
                              fontWeight: 700,
                              fontSize: 12.5,
                              cursor: 'pointer',
                            }}
                          >
                            {op.label}
                          </button>
                        )
                      })}
                    </div>

                    {formData.classificacao === 'SUBPRODUTO' && (
                      <div className="mt-14 p-14 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                        <label className="form-label text-warning font-bold">Matérias-Primas de Origem &amp; Rendimento (%)</label>
                        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 6, marginTop: 8 }}>
                          {materiasPrimas.map((mp) => {
                            const marcado = formData.pais_ids.includes(mp.id)
                            return (
                              <div
                                key={mp.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 10px',
                                  borderRadius: 6,
                                  border: `1px solid ${marcado ? 'var(--accent)' : 'var(--border)'}`,
                                  background: marcado ? 'var(--accent-muted)' : 'var(--bg-2)',
                                }}
                              >
                                <label className="flex items-center gap-8 flex-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={marcado}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFormData({ ...formData, pais_ids: [...formData.pais_ids, mp.id] })
                                      } else {
                                        setFormData({ ...formData, pais_ids: formData.pais_ids.filter((id) => id !== mp.id) })
                                      }
                                    }}
                                  />
                                  <span className="text-xs font-semibold">{mp.descricao}</span>
                                </label>
                                {marcado && (
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="100"
                                    className="form-input font-mono text-right"
                                    style={{ width: 76, padding: '4px 6px', fontSize: 12 }}
                                    placeholder="% Rend"
                                    value={formData.rendimentos_map?.[mp.id] ?? ''}
                                    onChange={(e) =>
                                      setFormData({
                                        ...formData,
                                        rendimentos_map: { ...(formData.rendimentos_map || {}), [mp.id]: e.target.value },
                                      })
                                    }
                                  />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </div>

            {/* RODAPÉ FIXO */}
            <div
              style={{
                flexShrink: 0,
                padding: '14px 22px',
                background: 'var(--bg-2)',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <button type="button" className="btn btn--ghost" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" form="produto-form" className="btn btn--primary" disabled={salvandoProd}>
                <Save size={16} /> {salvandoProd ? 'Salvando...' : 'Salvar Produto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL EDIÇÃO EM LOTE                                                    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalLote && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalLote(false)}>
          <div className="modal" style={{ maxWidth: 560, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                Edição em Lote ({selecionados.size} produto(s))
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalLote(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSalvarLote} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="text-xs text-muted">
                Marque apenas os campos que deseja aplicar aos {selecionados.size} produtos selecionados:
              </div>

              <div className="card" style={{ padding: 12, background: 'var(--bg-2)' }}>
                <label className="flex items-center gap-8 font-bold text-xs mb-6 cursor-pointer">
                  <input type="checkbox" checked={formLote.aplicarEspec} onChange={(e) => setFormLote((p) => ({ ...p, aplicarEspec: e.target.checked }))} />
                  Aplicar Especificação de Rótulo (100×70mm)
                </label>
                {formLote.aplicarEspec && (
                  <SmartSearchSelect
                    items={especificacoes}
                    value={formLote.especificacao_id}
                    onChange={(val) => setFormLote((p) => ({ ...p, especificacao_id: val }))}
                    icon="product"
                    getCode={(esp) => String(esp?.especie || '')}
                    getLabel={(esp) => String(esp?.nome || '')}
                    getSubLabel={(esp) => [esp?.especie, esp?.conservacao].filter(Boolean).join(' • ')}
                    emptyLabel="Remover especificação"
                    placeholder="Pesquisar especificação de rótulo..."
                    modalTitle="Selecionar Especificação em Lote"
                  />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="card" style={{ padding: 12, background: 'var(--bg-2)' }}>
                  <label className="flex items-center gap-8 font-bold text-xs mb-6 cursor-pointer">
                    <input type="checkbox" checked={formLote.aplicarEspecie} onChange={(e) => setFormLote((p) => ({ ...p, aplicarEspecie: e.target.checked }))} />
                    Alterar Espécie
                  </label>
                  {formLote.aplicarEspecie && (
                    <select className="form-input" value={formLote.especie} onChange={(e) => setFormLote((p) => ({ ...p, especie: e.target.value }))}>
                      <option value="BOVINO">Bovino</option>
                      <option value="SUINO">Suíno</option>
                      <option value="AVES">Aves</option>
                      <option value="EMPORIO">Empório</option>
                      <option value="INSUMO">Insumo</option>
                      <option value="OUTROS">Outros</option>
                    </select>
                  )}
                </div>

                <div className="card" style={{ padding: 12, background: 'var(--bg-2)' }}>
                  <label className="flex items-center gap-8 font-bold text-xs mb-6 cursor-pointer">
                    <input type="checkbox" checked={formLote.aplicarConservacao} onChange={(e) => setFormLote((p) => ({ ...p, aplicarConservacao: e.target.checked }))} />
                    Alterar Conservação
                  </label>
                  {formLote.aplicarConservacao && (
                    <select className="form-input" value={formLote.conservacao} onChange={(e) => setFormLote((p) => ({ ...p, conservacao: e.target.value }))}>
                      <option value="RESFRIADO">Resfriado</option>
                      <option value="CONGELADO">Congelado</option>
                      <option value="SECO">Seco</option>
                    </select>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="card" style={{ padding: 12, background: 'var(--bg-2)' }}>
                  <label className="flex items-center gap-8 font-bold text-xs mb-6 cursor-pointer">
                    <input type="checkbox" checked={formLote.aplicarValidade} onChange={(e) => setFormLote((p) => ({ ...p, aplicarValidade: e.target.checked }))} />
                    Alterar Validade Padrão (dias)
                  </label>
                  {formLote.aplicarValidade && (
                    <input type="number" min="0" max="3650" className="form-input font-mono text-right" value={formLote.validade_dias} onChange={(e) => setFormLote((p) => ({ ...p, validade_dias: e.target.value }))} />
                  )}
                </div>

                <div className="card" style={{ padding: 12, background: 'var(--bg-2)' }}>
                  <label className="flex items-center gap-8 font-bold text-xs mb-6 cursor-pointer">
                    <input type="checkbox" checked={formLote.aplicarTara} onChange={(e) => setFormLote((p) => ({ ...p, aplicarTara: e.target.checked }))} />
                    Alterar Tara Embalagem (kg)
                  </label>
                  {formLote.aplicarTara && (
                    <input type="number" step="0.0001" min="0" className="form-input font-mono text-right" value={formLote.tara_embalagem_kg} onChange={(e) => setFormLote((p) => ({ ...p, tara_embalagem_kg: e.target.value }))} />
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalLote(false)}>Cancelar</button>
                <button type="submit" className="btn btn--primary" disabled={salvandoLote}>
                  {salvandoLote ? 'Aplicando...' : `Aplicar em ${selecionados.size} Produto(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL ESPECIFICAÇÃO DE RÓTULO                                           */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalEspec && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalEspec(false)}>
          <div className="modal" style={{ maxWidth: 560, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                {formEspec.id ? 'Editar Especificação de Rótulo' : 'Nova Especificação de Rótulo'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalEspec(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSalvarEspec} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Texto Oficial no Rótulo *</label>
                <input
                  className="form-input"
                  required
                  value={formEspec.nome}
                  onChange={(e) => setFormEspec((p) => ({ ...p, nome: e.target.value.toUpperCase() }))}
                  placeholder="Ex: CARNE RESFRIADA DE BOVINO SEM OSSO"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Espécie</label>
                  <select className="form-input" value={formEspec.especie} onChange={(e) => setFormEspec((p) => ({ ...p, especie: e.target.value }))}>
                    <option value="BOVINO">Bovino</option>
                    <option value="SUINO">Suíno</option>
                    <option value="AVES">Aves</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Conservação</label>
                  <select
                    className="form-input"
                    value={formEspec.conservacao}
                    onChange={(e) =>
                      setFormEspec((p) => ({
                        ...p,
                        conservacao: e.target.value,
                        temperatura_rotulo:
                          e.target.value === 'CONGELADO'
                            ? 'MANTER CONGELADO A -18°C OU MAIS FRIO'
                            : e.target.value === 'RESFRIADO'
                              ? 'MANTER RESFRIADO DE 0°C A 4°C'
                              : 'CONSERVAR EM LOCAL SECO E AREJADO',
                      }))
                    }
                  >
                    <option value="RESFRIADO">Resfriado</option>
                    <option value="CONGELADO">Congelado</option>
                    <option value="SECO">Seco</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Código (Opcional)</label>
                  <input className="form-input font-mono" value={formEspec.codigo} onChange={(e) => setFormEspec((p) => ({ ...p, codigo: e.target.value.toUpperCase() }))} placeholder="Auto" />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Texto de Temperatura / Conservação no Rótulo</label>
                <input
                  className="form-input"
                  value={formEspec.temperatura_rotulo}
                  onChange={(e) => setFormEspec((p) => ({ ...p, temperatura_rotulo: e.target.value.toUpperCase() }))}
                  placeholder="Ex: MANTER RESFRIADO DE 0°C A 4°C"
                />
              </div>
              <label className="flex items-center gap-8 text-sm cursor-pointer">
                <input type="checkbox" checked={formEspec.com_osso} onChange={(e) => setFormEspec((p) => ({ ...p, com_osso: e.target.checked }))} />
                Corte com Osso
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalEspec(false)}>Cancelar</button>
                <button type="submit" className="btn btn--primary" disabled={salvandoEspec}>
                  <Save size={15} /> {salvandoEspec ? 'Salvando...' : 'Salvar Especificação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalDialog
        isOpen={modal.isOpen}
        type={modal.type}
        title={modal.title}
        message={modal.message}
        onConfirm={modal.onConfirm}
        onClose={closeModal}
        confirmLabel="Sim, excluir"
        cancelLabel="Cancelar"
      />
    </div>
  )
}
