import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  FileText,
  GitBranch,
  Layers,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { temPermissao } from '../utils/permissoes'
import { isApiEnabled } from '../lib/apiClient'
import { mapaProducaoQueries } from '../queries/mapaProducao'
import { cadastrosQueries } from '../queries/cadastros'
import * as produtosQueries from '../queries/produtos.js'
import { hojeIsoLocal } from '../utils/rastreabilidade.js'
import { ClienteSearchSelect, ProdutoSearchSelect } from '../components/shared/SmartSearchSelect'
import { PrintDocumentModal } from '../components/shared/PrintDocumentModal'

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`

const fmtDataBr = (iso) => {
  if (!iso) return '-'
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso)
}

const DIAS_SEMANA = [
  { id: 1, label: 'Segunda-feira' },
  { id: 2, label: 'Terça-feira' },
  { id: 3, label: 'Quarta-feira' },
  { id: 4, label: 'Quinta-feira' },
  { id: 5, label: 'Sexta-feira' },
  { id: 6, label: 'Sábado' },
]

const STATUS_MAPA_BADGE = {
  ABERTO: { label: 'ABERTO', cls: 'badge--info' },
  EM_PRODUCAO: { label: 'EM PRODUÇÃO', cls: 'badge--warning' },
  FINALIZADO: { label: 'FINALIZADO', cls: 'badge--success' },
  CONCLUIDO: { label: 'CONCLUÍDO', cls: 'badge--success' },
}

export function MapaProducao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeEscrever = temPermissao(operador, 'mapa_producao') || temPermissao(operador, 'producao_criar_op')
  const apiAtiva = isApiEnabled()

  const [abaTop, setAbaTop] = useState('MAPAS') // 'MAPAS' | 'ARVORE'
  const [filtroLista, setFiltroLista] = useState('ABERTOS') // 'ABERTOS' | 'HISTORICO'
  const [loading, setLoading] = useState(false)

  // Catálogos
  const [produtos, setProdutos] = useState([])
  const [clientes, setClientes] = useState([])
  const [mapas, setMapas] = useState([])
  const [mapaAtivo, setMapaAtivo] = useState(null)
  const [obsEdit, setObsEdit] = useState('')
  const [agruparModo, setAgruparModo] = useState('MP')

  // Modal Criar Novo Mapa
  const [modalNovoOpen, setModalNovoOpen] = useState(false)
  const [novoTipo, setNovoTipo] = useState('PRINCIPAL')
  const [novaData, setNovaData] = useState(() => hojeIsoLocal())
  const [novoTitulo, setNovoTitulo] = useState('')

  // Modal Puxar dos Pedidos ("Selecionar Itens dos Pedidos")
  const [modalPedidosOpen, setModalPedidosOpen] = useState(false)
  const [pedBusca, setPedBusca] = useState('')
  const [pedDataFiltro, setPedDataFiltro] = useState('')
  const [pedidosDisp, setPedidosDisp] = useState({ datasDisponiveis: [], gruposProduto: [] })
  const [loadingPedidosDisp, setLoadingPedidosDisp] = useState(false)
  const [selecionadosPedidos, setSelecionadosPedidos] = useState({}) // { [pedido_item_id]: itemObj }

  // Modal + Linha Manual
  const [modalLinhaOpen, setModalLinhaOpen] = useState(false)
  const [linhaForm, setLinhaForm] = useState({
    produto_id: '',
    cliente_id: '',
    materia_prima_id: '',
    especificacao: '',
    conservacao: 'RESFRIADO',
    grupo_mapa: '',
    qtd_prevista_kg: '',
    observacao: '',
  })

  // Modal Carregar Programação Semanal
  const [modalSemanalOpen, setModalSemanalOpen] = useState(false)
  const [diaSemanalSel, setDiaSemanalSel] = useState(() => {
    const d = new Date().getDay()
    return d >= 1 && d <= 6 ? d : 1
  })
  const [semanalLista, setSemanalLista] = useState([])
  const [mostrarFormSemanal, setMostrarFormSemanal] = useState(false)
  const [semForm, setSemForm] = useState({
    produto_id: '',
    cliente_id: '',
    materia_prima_id: '',
    especificacao: '',
    conservacao: 'RESFRIADO',
    qtd_meta_kg: '',
    observacao: '',
  })

  // Modal Especificações Automáticas
  const [modalEspecOpen, setModalEspecOpen] = useState(false)
  const [especsLista, setEspecsLista] = useState([])
  const [especForm, setEspecForm] = useState({
    produto_id: '',
    cliente_id: '',
    materia_prima_id: '',
    especificacao: '',
    conservacao: 'RESFRIADO',
    grupo_mapa: '',
  })

  // Modal Impressão do Mapa
  const [mapaPrint, setMapaPrint] = useState(null)

  // Rascunho de edição inline por linha ({ [itemId]: { ... } })
  const [edicaoItemMap, setEdicaoItemMap] = useState({})

  // Árvore Auto-Aprendiz
  const [arvore, setArvore] = useState([])
  const [apenasPendentes, setApenasPendentes] = useState(false)
  const [novoPaiId, setNovoPaiId] = useState('')
  const [novoFilhoId, setNovoFilhoId] = useState('')
  const [novoRendPct, setNovoRendPct] = useState('70')
  const [rendEditMap, setRendEditMap] = useState({})

  const carregarListagens = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [prods, clis, listMapas, listArv] = await Promise.all([
        produtosQueries.listar().catch(() => []),
        cadastrosQueries.listarClientes().catch(() => []),
        mapaProducaoQueries.listarMapas().catch(() => []),
        mapaProducaoQueries.listarArvore().catch(() => []),
      ])
      setProdutos(prods || [])
      setClientes(clis || [])
      setMapas(listMapas || [])
      setArvore(listArv || [])
    } catch (err) {
      toastError('Erro', err.message || 'Falha ao carregar Mapa de Produção.')
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, toastError])

  useEffect(() => {
    carregarListagens()
  }, [carregarListagens])

  const abrirMapa = useCallback(
    async (mapaId) => {
      try {
        const det = await mapaProducaoQueries.obterMapa(mapaId)
        setMapaAtivo(det)
        setObsEdit(det?.observacoes || '')
        setEdicaoItemMap({})
      } catch (err) {
        toastError('Erro', err.message)
      }
    },
    [toastError],
  )

  const mpsLista = useMemo(
    () => produtos.filter((p) => p.classificacao === 'MATERIA_PRIMA' || p.tipo_produto === 'Materia Prima'),
    [produtos],
  )

  const subprodutosLista = useMemo(
    () => produtos.filter((p) => p.classificacao !== 'MATERIA_PRIMA' && p.tipo_produto !== 'Materia Prima'),
    [produtos],
  )

  const gruposDisponiveis = useMemo(
    () => Array.from(new Set(produtos.map((p) => p.grupo).filter(Boolean).map((g) => String(g).toUpperCase()))).sort(),
    [produtos],
  )

  const mapasFiltrados = useMemo(() => {
    return mapas.filter((m) =>
      filtroLista === 'ABERTOS'
        ? ['ABERTO', 'EM_PRODUCAO'].includes(m.status)
        : ['FINALIZADO', 'CONCLUIDO'].includes(m.status),
    )
  }, [mapas, filtroLista])

  // Itens agrupados por grupo visual dentro do Mapa aberto
  const gruposNoMapa = useMemo(() => {
    const itens = mapaAtivo?.itens || []
    const grpMap = new Map()
    for (const it of itens) {
      const g = String(it.grupo_mapa || it.grupo || 'GERAL').toUpperCase()
      const arr = grpMap.get(g) || []
      arr.push(it)
      grpMap.set(g, arr)
    }
    return Array.from(grpMap.entries())
  }, [mapaAtivo])

  const qtdSemEspecNoMapa = useMemo(
    () => (mapaAtivo?.itens || []).filter((it) => !String(it.especificacao || '').trim()).length,
    [mapaAtivo],
  )

  // ── Criar / Reabrir Mapa ───────────────────────────────────────────────────
  const abrirModalNovoMapa = (tipoDefault = 'PRINCIPAL') => {
    setNovoTipo(tipoDefault)
    setNovaData(mapaAtivo?.data_mapa || hojeIsoLocal())
    setNovoTitulo('')
    setModalNovoOpen(true)
  }

  const handleCriarMapaModal = async (e) => {
    e.preventDefault()
    try {
      const res = await mapaProducaoQueries.criarMapa({
        tipo: novoTipo,
        data_mapa: novaData || hojeIsoLocal(),
        titulo: novoTitulo.trim() || undefined,
      })
      setModalNovoOpen(false)
      if (res.reopened) {
        toastSuccess('Mapa Reaberto', `${res.titulo} já estava aberto para esta data e foi carregado.`)
      } else {
        toastSuccess('Mapa Criado', `${res.titulo || res.codigo} criado com sucesso!`)
      }
      await carregarListagens()
      await abrirMapa(res.id)
    } catch (err) {
      toastError('Erro ao criar mapa', err.message)
    }
  }

  const handleExcluirMapa = async (m) => {
    const ok = await useAppStore.getState().confirmar({
      title: 'Excluir Mapa de Produção',
      message: `Deseja excluir "${m.titulo}" (${m.codigo})? As OPs já finalizadas não são apagadas.`,
      type: 'error',
      confirmLabel: 'Excluir Mapa',
    })
    if (!ok) return
    try {
      await mapaProducaoQueries.excluirMapa(m.id)
      toastSuccess('Excluído', `${m.codigo} removido.`)
      if (mapaAtivo?.id === m.id) setMapaAtivo(null)
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── Puxar Itens dos Pedidos (seleção a dedo com data de entrega) ───────────
  const carregarItensPedidosModal = useCallback(
    async (dataFiltroOverride = pedDataFiltro, buscaOverride = pedBusca) => {
      if (!mapaAtivo?.id) return
      setLoadingPedidosDisp(true)
      try {
        const res = await mapaProducaoQueries.listarItensPedidosDisponiveis({
          previsao_entrega: dataFiltroOverride,
          q: buscaOverride,
          mapa_id: mapaAtivo.id,
        })
        setPedidosDisp({
          datasDisponiveis: res?.datasDisponiveis || [],
          gruposProduto: res?.gruposProduto || [],
        })
      } catch (err) {
        toastError('Erro ao carregar itens de pedidos', err.message)
      } finally {
        setLoadingPedidosDisp(false)
      }
    },
    [mapaAtivo?.id, pedDataFiltro, pedBusca, toastError],
  )

  const abrirModalPuxarPedidos = () => {
    setPedBusca('')
    setPedDataFiltro('')
    setSelecionadosPedidos({})
    setModalPedidosOpen(true)
  }

  useEffect(() => {
    if (modalPedidosOpen && mapaAtivo?.id) {
      carregarItensPedidosModal(pedDataFiltro, pedBusca)
    }
  }, [modalPedidosOpen, pedDataFiltro, pedBusca, mapaAtivo?.id, carregarItensPedidosModal])

  const todosItensVisiveisModal = useMemo(() => {
    const lista = []
    for (const grp of pedidosDisp.gruposProduto || []) {
      for (const it of grp.itens || []) {
        lista.push(it)
      }
    }
    return lista
  }, [pedidosDisp])

  const toggleSelecionadoPedidoItem = (it) => {
    setSelecionadosPedidos((prev) => {
      const next = { ...prev }
      if (next[it.pedido_item_id]) delete next[it.pedido_item_id]
      else next[it.pedido_item_id] = it
      return next
    })
  }

  const selecionarTodosModal = () => {
    const next = {}
    for (const it of todosItensVisiveisModal) {
      if (!it.no_mapa_atual) next[it.pedido_item_id] = it
    }
    setSelecionadosPedidos(next)
  }

  const handleConfirmarPuxarPedidos = async () => {
    const escolhidos = Object.values(selecionadosPedidos)
    if (escolhidos.length === 0) return toastWarning('Seleção', 'Marque ao menos 1 item dos pedidos.')
    try {
      const payload = escolhidos.map((it) => ({
        produto_id: it.produto_id,
        cliente_id: it.cliente_id || null,
        pedido_id: it.pedido_id,
        pedido_item_id: it.pedido_item_id,
        pedido_codigo: it.pedido_codigo,
        previsao_entrega: it.previsao_entrega || null,
        materia_prima_id: it.materia_prima_auto_id || null,
        especificacao: it.especificacao_auto || '',
        conservacao: it.conservacao_auto || 'RESFRIADO',
        grupo_mapa: it.grupo_auto || '',
        qtd_prevista_kg: Number(it.qtd_kg_solicitada || 0),
      }))
      const res = await mapaProducaoQueries.adicionarItensMapa(mapaAtivo.id, payload)
      setModalPedidosOpen(false)
      await abrirMapa(mapaAtivo.id)
      carregarListagens()
      if (res.itens_sem_especificacao > 0) {
        toastWarning(
          `${res.adicionados} item(ns) incluído(s) (${res.itens_sem_especificacao} sem especificação)`,
          'Preencha a especificação na linha (ela será memorizada para o cliente!) ou cadastre em Especificações.',
        )
      } else {
        toastSuccess('Itens Adicionados ✅', `${res.adicionados} item(ns) incluído(s) com especificação automática.`)
      }
    } catch (err) {
      toastError('Erro ao incluir itens', err.message)
    }
  }

  // ── Inline Editing & Auto-Learning ─────────────────────────────────────────
  const getValItem = (it, campo) => {
    const draft = edicaoItemMap[it.id]
    if (draft && campo in draft) return draft[campo]
    return it[campo] ?? ''
  }

  const setValItemLocal = (itemId, campo, valor) => {
    setEdicaoItemMap((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), [campo]: valor },
    }))
  }

  const salvarCampoItem = async (it, patch) => {
    try {
      await mapaProducaoQueries.atualizarItemMapa(mapaAtivo.id, it.id, patch)
      await abrirMapa(mapaAtivo.id)
    } catch (err) {
      toastError('Erro ao salvar linha', err.message)
    }
  }

  const handleRemoverLinha = async (itemId) => {
    try {
      await mapaProducaoQueries.removerItemMapa(mapaAtivo.id, itemId)
      await abrirMapa(mapaAtivo.id)
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── Linha Manual ───────────────────────────────────────────────────────────
  const handleSalvarLinhaManual = async (e) => {
    e.preventDefault()
    if (!linhaForm.produto_id) return toastWarning('Produto', 'Selecione o produto/corte.')
    const qtd = Number(String(linhaForm.qtd_prevista_kg).replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd <= 0) return toastWarning('Peso', 'Informe o previsto (kg) maior que zero.')
    try {
      await mapaProducaoQueries.adicionarItensMapa(mapaAtivo.id, [
        {
          produto_id: linhaForm.produto_id,
          cliente_id: linhaForm.cliente_id || null,
          materia_prima_id: linhaForm.materia_prima_id || null,
          especificacao: linhaForm.especificacao,
          conservacao: linhaForm.conservacao,
          grupo_mapa: linhaForm.grupo_mapa,
          qtd_prevista_kg: qtd,
          observacao: linhaForm.observacao,
        },
      ])
      setModalLinhaOpen(false)
      setLinhaForm({
        produto_id: '',
        cliente_id: '',
        materia_prima_id: '',
        especificacao: '',
        conservacao: 'RESFRIADO',
        grupo_mapa: '',
        qtd_prevista_kg: '',
        observacao: '',
      })
      toastSuccess('Linha adicionada ao Mapa')
      await abrirMapa(mapaAtivo.id)
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── Programação Semanal ────────────────────────────────────────────────────
  const carregarSemanal = useCallback(
    async (dia = diaSemanalSel) => {
      try {
        const lista = await mapaProducaoQueries.listarProgramacaoSemanal({ dia_semana: dia })
        setSemanalLista(lista || [])
      } catch (err) {
        toastError('Erro', err.message)
      }
    },
    [diaSemanalSel, toastError],
  )

  useEffect(() => {
    if (modalSemanalOpen) carregarSemanal(diaSemanalSel)
  }, [modalSemanalOpen, diaSemanalSel, carregarSemanal])

  const handleImportarSemanal = async () => {
    try {
      const res = await mapaProducaoQueries.importarSemanalMapa(mapaAtivo.id, diaSemanalSel)
      setModalSemanalOpen(false)
      toastSuccess('Programação Semanal Importada', `${res.importados} item(ns) adicionado(s) ao mapa.`)
      await abrirMapa(mapaAtivo.id)
      carregarListagens()
    } catch (err) {
      toastWarning(err.message)
    }
  }

  const handleSalvarItemSemanal = async (e) => {
    e.preventDefault()
    if (!semForm.produto_id || !semForm.qtd_meta_kg) return toastWarning('Campos', 'Informe produto e meta kg.')
    try {
      await mapaProducaoQueries.salvarProgramacaoSemanal({
        dia_semana: diaSemanalSel,
        produto_id: semForm.produto_id,
        cliente_id: semForm.cliente_id || null,
        materia_prima_id: semForm.materia_prima_id || null,
        especificacao: semForm.especificacao,
        conservacao: semForm.conservacao,
        qtd_meta_kg: Number(String(semForm.qtd_meta_kg).replace(',', '.')),
        observacao: semForm.observacao,
      })
      setSemForm({
        produto_id: '',
        cliente_id: '',
        materia_prima_id: '',
        especificacao: '',
        conservacao: 'RESFRIADO',
        qtd_meta_kg: '',
        observacao: '',
      })
      carregarSemanal(diaSemanalSel)
      toastSuccess('Programação semanal atualizada')
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── Especificações Automáticas ─────────────────────────────────────────────
  const carregarEspecs = useCallback(async () => {
    try {
      const lista = await mapaProducaoQueries.listarEspecificacoesMapa()
      setEspecsLista(lista || [])
    } catch (err) {
      toastError('Erro', err.message)
    }
  }, [toastError])

  useEffect(() => {
    if (modalEspecOpen) carregarEspecs()
  }, [modalEspecOpen, carregarEspecs])

  const handleSalvarSpec = async (e) => {
    e.preventDefault()
    if (!especForm.produto_id) return toastWarning('Produto', 'Selecione o produto.')
    try {
      await mapaProducaoQueries.salvarEspecificacaoMapa(especForm)
      setEspecForm({
        produto_id: '',
        cliente_id: '',
        materia_prima_id: '',
        especificacao: '',
        conservacao: 'RESFRIADO',
        grupo_mapa: '',
      })
      await carregarEspecs()
      toastSuccess('Especificação Salva', 'Será aplicada automaticamente sempre que puxar esse corte/cliente.')
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handlePuxarEspecificacoesMapa = async () => {
    try {
      const res = await mapaProducaoQueries.aplicarEspecificacoesMapa(mapaAtivo.id)
      await abrirMapa(mapaAtivo.id)
      if (res.atualizados > 0) {
        toastSuccess('Especificações Aplicadas', `${res.atualizados} linha(s) preenchida(s) automaticamente!`)
      } else {
        setModalEspecOpen(true)
        toastWarning('Nenhuma especificação padrão encontrada', 'Cadastre abaixo para automatizar futuras importações.')
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // ── Status & Gerar OPs ─────────────────────────────────────────────────────
  const handleStatusMapa = async (novoStatus) => {
    try {
      await mapaProducaoQueries.atualizarMapa(mapaAtivo.id, { status: novoStatus })
      toastSuccess('Status Atualizado', `Mapa marcado como ${novoStatus}.`)
      await abrirMapa(mapaAtivo.id)
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleGerarOps = async () => {
    try {
      const res = await mapaProducaoQueries.gerarOpsDoMapa(mapaAtivo.id, { agrupar_por: agruparModo })
      toastSuccess('OPs Liberadas ✅', `${res.ops?.length || 0} Ordem(ns) de Produção enviada(s) para Produção!`)
      await abrirMapa(mapaAtivo.id)
      carregarListagens()
    } catch (err) {
      toastWarning('Atenção ao gerar OP', err.message)
    }
  }

  // ── Árvore Auto-Aprendiz handlers ──────────────────────────────────────────
  const pendentesArvore = useMemo(() => arvore.filter((a) => Number(a.confirmado) === 0), [arvore])
  const arvoreFiltrada = useMemo(() => (apenasPendentes ? pendentesArvore : arvore), [arvore, pendentesArvore, apenasPendentes])

  const handleSalvarVinculoManual = async (e) => {
    e.preventDefault()
    if (!novoPaiId || !novoFilhoId) return toastWarning('Vínculo', 'Escolha a Matéria-Prima e o Corte filho.')
    try {
      await mapaProducaoQueries.salvarVinculoArvore({
        pai_id: novoPaiId,
        filho_id: novoFilhoId,
        rendimento_esperado_pct: Number(novoRendPct || 0),
      })
      toastSuccess('Vínculo Salvo', 'Árvore de produtos atualizada com sucesso!')
      setNovoFilhoId('')
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleConfirmarArvore = async (item) => {
    try {
      const customRend = rendEditMap[item.id] ?? item.rendimento_aprendido_pct ?? item.rendimento_esperado_pct
      await mapaProducaoQueries.confirmarVinculoArvore(item.id, {
        rendimento_esperado_pct: customRend != null ? Number(customRend) : null,
      })
      toastSuccess('Rendimento Confirmado ✅', `${item.pai_descricao} → ${item.filho_descricao} oficializado na árvore.`)
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleDescartarArvore = async (id) => {
    try {
      await mapaProducaoQueries.removerVinculoArvore(id)
      toastSuccess('Vínculo Removido', 'Relação descartada da árvore.')
      carregarListagens()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  if (!apiAtiva) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <h1 className="page-header__title flex items-center gap-12">
            <GitBranch className="text-primary" size={26} /> Mapa de Produção Diário
          </h1>
        </div>
        <div className="card p-24 text-muted">
          O Mapa de Produção Diário requer a API Backend PostgreSQL conectada (`VITE_API_URL`).
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in">
      {/* Cabeçalho Principal quando está na listagem ou Árvore */}
      {(!mapaAtivo || abaTop === 'ARVORE') && (
        <div className="page-header">
          <div>
            <h1 className="page-header__title flex items-center gap-12">
              <GitBranch className="text-primary" size={26} /> Mapa de Produção Diário
            </h1>
            <p className="page-header__subtitle">
              Crie e gerencie mapas de produção diários selecionando itens de pedidos, especificações automáticas e programação semanal
            </p>
          </div>
          <div className="flex gap-8 flex-wrap">
            {abaTop === 'MAPAS' && podeEscrever && (
              <>
                <button type="button" className="btn btn--secondary" onClick={() => abrirModalNovoMapa('COMPLEMENTAR')}>
                  <Sparkles size={15} /> + Mapa Complementar
                </button>
                <button type="button" className="btn btn--primary" onClick={() => abrirModalNovoMapa('PRINCIPAL')}>
                  <Plus size={16} /> + Criar Novo Mapa
                </button>
              </>
            )}
            <button type="button" className="btn btn--ghost" onClick={carregarListagens} disabled={loading}>
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Abas superiores: Mapas Diários vs Árvore Auto-Aprendiz */}
      {!mapaAtivo && (
        <div className="flex justify-between items-center flex-wrap gap-10 mb-16">
          <div className="flex gap-8 flex-wrap">
            <button
              type="button"
              className={`btn ${abaTop === 'MAPAS' && filtroLista === 'ABERTOS' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => {
                setAbaTop('MAPAS')
                setFiltroLista('ABERTOS')
              }}
            >
              <ClipboardList size={15} /> Em Aberto
            </button>
            <button
              type="button"
              className={`btn ${abaTop === 'MAPAS' && filtroLista === 'HISTORICO' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => {
                setAbaTop('MAPAS')
                setFiltroLista('HISTORICO')
              }}
            >
              <FileText size={15} /> Histórico (Finalizados)
            </button>
            <button
              type="button"
              className={`btn ${abaTop === 'ARVORE' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAbaTop('ARVORE')}
            >
              <Sparkles size={15} /> Árvore Auto-Aprendiz ({arvore.length})
              {pendentesArvore.length > 0 && (
                <span className="badge badge--warning" style={{ marginLeft: 4 }}>
                  {pendentesArvore.length}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── LISTA EM CARDS DOS MAPAS (igual ao layout referência) ── */}
      {!mapaAtivo && abaTop === 'MAPAS' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
          {mapasFiltrados.map((m) => {
            const st = STATUS_MAPA_BADGE[m.status] || { label: m.status, cls: 'badge--neutral' }
            return (
              <div
                key={m.id}
                className="card"
                style={{
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div className="flex justify-between items-center gap-8 mb-8 flex-wrap">
                    <span className="text-xs text-muted flex items-center gap-6">
                      <Calendar size={13} /> {fmtDataBr(m.data_mapa)}
                    </span>
                    <div className="flex items-center gap-6">
                      {m.tipo === 'COMPLEMENTAR' && (
                        <span className="badge badge--warning" style={{ fontSize: 10 }}>
                          ✨ COMPLEMENTAR
                        </span>
                      )}
                      <span className={`badge ${st.cls}`} style={{ fontSize: 10 }}>
                        {st.label}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.35, color: 'var(--text-primary)' }}>
                    {m.titulo}
                  </div>
                  <div className="text-xs text-muted mt-6 font-mono">
                    {m.codigo} • {m.qtd_itens || 0} corte(s) • {fmtKg(m.total_previsto_kg)}
                    {m.qtd_ops > 0 ? ` • ${m.qtd_ops} OP(s)` : ''}
                  </div>
                </div>

                <div className="flex gap-8 items-center">
                  <button type="button" className="btn btn--primary btn--sm" style={{ flex: 1 }} onClick={() => abrirMapa(m.id)}>
                    <Edit3 size={14} /> Abrir
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={async () => setMapaPrint(await mapaProducaoQueries.obterMapa(m.id))}
                  >
                    <Printer size={14} /> Imprimir
                  </button>
                  {podeEscrever && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm text-danger"
                      title="Excluir Mapa"
                      onClick={() => handleExcluirMapa(m)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {mapasFiltrados.length === 0 && (
            <div className="card p-32 text-center text-muted" style={{ gridColumn: '1 / -1' }}>
              Nenhum mapa {filtroLista === 'ABERTOS' ? 'em aberto' : 'finalizado'} encontrado.
              Clique em <strong>+ Criar Novo Mapa</strong> para começar!
            </div>
          )}
        </div>
      )}

      {/* ── WORKSPACE DO MAPA ABERTO ── */}
      {mapaAtivo && abaTop === 'MAPAS' && (
        <div>
          <div className="card mb-14" style={{ padding: 16 }}>
            <div className="flex justify-between items-center flex-wrap gap-10 mb-12">
              <div className="flex items-center gap-12 flex-wrap">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setMapaAtivo(null)}>
                  <ArrowLeft size={14} /> Mapas
                </button>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{mapaAtivo.titulo}</h2>
                  <div className="text-xs text-muted">
                    {mapaAtivo.codigo} • Data de Produção: {fmtDataBr(mapaAtivo.data_mapa)} •{' '}
                    {(mapaAtivo.itens || []).length} linha(s)
                  </div>
                </div>
              </div>

              <div className="flex gap-8 flex-wrap items-center">
                <span className={`badge ${(STATUS_MAPA_BADGE[mapaAtivo.status] || { cls: 'badge--info' }).cls}`}>
                  {mapaAtivo.status}
                </span>
                {podeEscrever && (
                  <>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => abrirModalNovoMapa('COMPLEMENTAR')}>
                      <Sparkles size={13} /> + Mapa Complementar
                    </button>
                    {mapaAtivo.status !== 'FINALIZADO' && (
                      <button type="button" className="btn btn--success btn--sm" onClick={() => handleStatusMapa('FINALIZADO')}>
                        <CheckCircle2 size={13} /> Finalizar Mapa
                      </button>
                    )}
                    {mapaAtivo.status !== 'CONCLUIDO' && (
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleStatusMapa('CONCLUIDO')}>
                        <Zap size={13} /> Concluir / Marcar Produzido
                      </button>
                    )}
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => setModalSemanalOpen(true)}>
                      <Calendar size={13} /> Carregar Programação Semanal
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={abrirModalPuxarPedidos}>
                      <ClipboardList size={13} /> Puxar dos Pedidos
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalLinhaOpen(true)}>
                      <Plus size={13} /> Linha Manual
                    </button>
                  </>
                )}
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalEspecOpen(true)}>
                  <Settings size={13} /> Especificações
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setMapaPrint(mapaAtivo)}>
                  <Printer size={13} /> Imprimir Mapa
                </button>
              </div>
            </div>

            {/* Observações do Mapa */}
            <div className="flex items-center gap-10 flex-wrap">
              <div style={{ flex: 1, minWidth: 260, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="text-xs font-bold text-warning" style={{ whiteSpace: 'nowrap' }}>
                  📝 Observações do Mapa:
                </span>
                <input
                  className="form-input"
                  value={obsEdit}
                  placeholder="Escreva observações para este mapa de produção (aparecerá no mapa impresso)..."
                  onChange={(e) => setObsEdit(e.target.value)}
                  onBlur={() => {
                    if (obsEdit !== (mapaAtivo.observacoes || '')) {
                      mapaProducaoQueries.atualizarMapa(mapaAtivo.id, { observacoes: obsEdit }).catch(() => {})
                    }
                  }}
                />
              </div>

              {podeEscrever && (mapaAtivo.itens || []).length > 0 && (
                <div className="flex items-center gap-6">
                  <select className="form-input" style={{ width: 170 }} value={agruparModo} onChange={(e) => setAgruparModo(e.target.value)}>
                    <option value="MP">1 OP por Matéria-Prima</option>
                    <option value="GRUPO">1 OP por Grupo</option>
                    <option value="UNICO">OP Única</option>
                  </select>
                  <button type="button" className="btn btn--success btn--sm" onClick={handleGerarOps}>
                    <Play size={13} /> Gerar OPs no PCP
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Alerta se existirem itens sem especificação */}
          {qtdSemEspecNoMapa > 0 && (
            <div
              className="mb-12"
              style={{
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div className="text-xs" style={{ color: '#fde68a' }}>
                <strong>⚠️ {qtdSemEspecNoMapa} item(ns) sem especificação definida:</strong>{' '}
                digite diretamente na coluna <strong>Especificação</strong> (o sistema memoriza para as próximas vezes!) ou puxe o padrão cadastrado.
              </div>
              <button type="button" className="btn btn--warning btn--sm" onClick={handlePuxarEspecificacoesMapa}>
                <Download size={13} /> Puxar Especificações Padrão
              </button>
            </div>
          )}

          {/* Tabela Agrupada por Grupo (BOVINOS / AVES / etc.) */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Produto</th>
                    <th>Especificação (Auto)</th>
                    <th>Grupo</th>
                    <th>Conservação</th>
                    <th style={{ textAlign: 'right' }}>Previsto (kg)</th>
                    <th>Cliente</th>
                    <th>Matéria-Prima / Qtd MP</th>
                    <th>Observação</th>
                    <th style={{ textAlign: 'right' }}>Realizado</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposNoMapa.map(([nomeGrupo, rowsGrupo]) => (
                    <React.Fragment key={nomeGrupo}>
                      <tr style={{ background: 'rgba(59,130,246,0.1)' }}>
                        <td colSpan={11} style={{ fontWeight: 800, fontSize: 12, color: '#93c5fd', letterSpacing: '0.04em' }}>
                          📦 {nomeGrupo} ({rowsGrupo.length} {rowsGrupo.length === 1 ? 'item' : 'itens'} •{' '}
                          {fmtKg(rowsGrupo.reduce((s, r) => s + Number(r.qtd_prevista_kg || 0), 0))})
                        </td>
                      </tr>
                      {rowsGrupo.map((it) => {
                        const especVal = getValItem(it, 'especificacao')
                        const obsVal = getValItem(it, 'observacao')
                        const prevVal = getValItem(it, 'qtd_prevista_kg')
                        const mpKgVal = getValItem(it, 'qtd_mp_kg')
                        const realVal = getValItem(it, 'qtd_realizada_kg')
                        return (
                          <tr key={it.id}>
                            <td className="font-mono font-bold text-cyan">{it.produto_codigo || '-'}</td>
                            <td>
                              <div style={{ fontWeight: 700 }}>{it.produto_descricao}</div>
                              {it.pedido_codigo && (
                                <span className="badge badge--ghost" style={{ fontSize: 10 }}>
                                  #{it.pedido_codigo}
                                </span>
                              )}
                            </td>
                            <td style={{ minWidth: 190 }}>
                              <input
                                className="form-input"
                                style={{
                                  fontSize: 12,
                                  borderColor: !String(especVal).trim() ? '#f59e0b' : undefined,
                                }}
                                placeholder="Ex: PACOTES DE 5KG..."
                                value={especVal}
                                onChange={(e) => setValItemLocal(it.id, 'especificacao', e.target.value.toUpperCase())}
                                onBlur={() => {
                                  if (especVal !== (it.especificacao || '')) {
                                    salvarCampoItem(it, { especificacao: especVal })
                                  }
                                }}
                              />
                            </td>
                            <td style={{ minWidth: 110 }}>
                              <input
                                className="form-input"
                                style={{ fontSize: 11 }}
                                value={getValItem(it, 'grupo_mapa') || it.grupo || 'GERAL'}
                                onChange={(e) => setValItemLocal(it.id, 'grupo_mapa', e.target.value.toUpperCase())}
                                onBlur={() => {
                                  const v = getValItem(it, 'grupo_mapa')
                                  if (v !== (it.grupo_mapa || '')) {
                                    salvarCampoItem(it, { grupo_mapa: v })
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <select
                                className="form-input"
                                style={{ fontSize: 11, minWidth: 110 }}
                                value={it.conservacao || 'RESFRIADO'}
                                onChange={(e) => salvarCampoItem(it, { conservacao: e.target.value })}
                              >
                                <option value="RESFRIADO">RESFRIADO</option>
                                <option value="CONGELADO">CONGELADO</option>
                                <option value="IN NATURA">IN NATURA</option>
                              </select>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                className="form-input font-mono text-right"
                                style={{ width: 82 }}
                                value={prevVal}
                                onChange={(e) => setValItemLocal(it.id, 'qtd_prevista_kg', e.target.value)}
                                onBlur={() => {
                                  const num = Number(prevVal)
                                  if (Number.isFinite(num) && num > 0 && num !== Number(it.qtd_prevista_kg)) {
                                    salvarCampoItem(it, { qtd_prevista_kg: num })
                                  }
                                }}
                              />
                            </td>
                            <td className="text-xs" style={{ minWidth: 130 }}>
                              {it.cliente_nome || <span className="text-muted">Estoque / Interno</span>}
                            </td>
                            <td style={{ minWidth: 230 }}>
                              <div style={{ marginBottom: 4 }}>
                                <ProdutoSearchSelect
                                  produtos={mpsLista}
                                  value={it.materia_prima_id || ''}
                                  compact
                                  onChange={(val) => salvarCampoItem(it, { materia_prima_id: val || null })}
                                  emptyLabel="-- Sem MP definida --"
                                  placeholder="Buscar MP..."
                                  modalTitle="Selecionar Matéria-Prima"
                                />
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-xs text-muted">Qtd MP:</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="form-input font-mono text-right"
                                  style={{ width: 78, height: 26, fontSize: 11 }}
                                  value={mpKgVal}
                                  onChange={(e) => setValItemLocal(it.id, 'qtd_mp_kg', e.target.value)}
                                  onBlur={() => {
                                    const num = Number(mpKgVal)
                                    if (Number.isFinite(num) && num >= 0 && num !== Number(it.qtd_mp_kg)) {
                                      salvarCampoItem(it, { qtd_mp_kg: num })
                                    }
                                  }}
                                />
                                <span className="text-xs text-muted">kg</span>
                              </div>
                            </td>
                            <td style={{ minWidth: 130 }}>
                              <input
                                className="form-input"
                                style={{ fontSize: 11 }}
                                placeholder="Obs / dia entrega..."
                                value={obsVal}
                                onChange={(e) => setValItemLocal(it.id, 'observacao', e.target.value.toUpperCase())}
                                onBlur={() => {
                                  if (obsVal !== (it.observacao || '')) {
                                    salvarCampoItem(it, { observacao: obsVal })
                                  }
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                className="form-input font-mono text-right"
                                style={{ width: 78 }}
                                value={realVal}
                                onChange={(e) => setValItemLocal(it.id, 'qtd_realizada_kg', e.target.value)}
                                onBlur={() => {
                                  const num = Number(realVal)
                                  if (Number.isFinite(num) && num >= 0 && num !== Number(it.qtd_realizada_kg)) {
                                    salvarCampoItem(it, { qtd_realizada_kg: num })
                                  }
                                }}
                              />
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {podeEscrever && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm text-danger"
                                  title="Remover linha do Mapa"
                                  onClick={() => handleRemoverLinha(it.id)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  ))}

                  {gruposNoMapa.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-center p-32 text-muted">
                        Mapa vazio. Clique em <strong>Puxar dos Pedidos</strong>, <strong>Carregar Programação Semanal</strong> ou{' '}
                        <strong>+ Linha Manual</strong>.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {mapaAtivo.ops?.length > 0 && (
              <div className="p-14 border-t border-border" style={{ background: 'var(--bg-2)' }}>
                <strong className="text-xs uppercase text-muted">OPs Geradas por este Mapa ({mapaAtivo.ops.length}):</strong>
                <div className="flex gap-8 flex-wrap mt-6">
                  {mapaAtivo.ops.map((op) => (
                    <span key={op.id} className="badge badge--info">
                      {op.codigo} ({op.status}) — {op.nome}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ÁRVORE AUTO-APRENDIZ (mantida na 2ª aba) ── */}
      {!mapaAtivo && abaTop === 'ARVORE' && (
        <div>
          <div className="card mb-16" style={{ background: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.3)' }}>
            <div className="flex justify-between items-center flex-wrap gap-12">
              <div className="flex items-center gap-8 text-sm">
                <Sparkles size={18} className="text-primary" />
                <span>
                  Toda vez que uma <strong>OP é finalizada</strong>, o sistema aprende automaticamente qual Matéria-Prima originou cada corte e atualiza a média real de rendimento.
                </span>
              </div>
              <label className="flex items-center gap-6 text-xs font-bold cursor-pointer">
                <input type="checkbox" checked={apenasPendentes} onChange={(e) => setApenasPendentes(e.target.checked)} />
                Mostrar só pendentes de revisão ({pendentesArvore.length})
              </label>
            </div>
          </div>

          {podeEscrever && (
            <form onSubmit={handleSalvarVinculoManual} className="card mb-16">
              <div className="text-xs font-bold uppercase text-muted mb-8">Novo Vínculo Manual na Árvore</div>
              <div className="flex gap-8 flex-wrap items-end">
                <div className="form-group" style={{ flex: 1, minWidth: 230, marginBottom: 0 }}>
                  <label className="form-label">Matéria-Prima (Pai)</label>
                  <ProdutoSearchSelect
                    produtos={mpsLista}
                    value={novoPaiId}
                    onChange={(val) => setNovoPaiId(val)}
                    placeholder="Pesquisar matéria-prima (pai)..."
                    modalTitle="Selecionar Matéria-Prima (Pai)"
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 230, marginBottom: 0 }}>
                  <label className="form-label">Corte / Subproduto (Filho)</label>
                  <ProdutoSearchSelect
                    produtos={subprodutosLista}
                    value={novoFilhoId}
                    onChange={(val) => setNovoFilhoId(val)}
                    placeholder="Pesquisar corte / subproduto..."
                    modalTitle="Selecionar Corte / Subproduto (Filho)"
                  />
                </div>
                <div className="form-group" style={{ width: 130, marginBottom: 0 }}>
                  <label className="form-label">% Rendimento</label>
                  <input type="number" step="0.01" className="form-input" value={novoRendPct} onChange={(e) => setNovoRendPct(e.target.value)} />
                </div>
                <button type="submit" className="btn btn--primary">
                  <Plus size={15} /> Vincular
                </button>
              </div>
            </form>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Matéria-Prima (Pai)</th>
                    <th>Corte Produzido (Filho)</th>
                    <th>Origem</th>
                    <th style={{ textAlign: 'right' }}>Amostras OP</th>
                    <th style={{ textAlign: 'right' }}>% Aprendido Real</th>
                    <th style={{ textAlign: 'right' }}>% Oficial Esperado</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {arvoreFiltrada.map((a) => {
                    const conf = Number(a.confirmado) === 1
                    const valorRend = rendEditMap[a.id] ?? a.rendimento_esperado_pct ?? a.rendimento_aprendido_pct ?? ''
                    return (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.pai_codigo}</strong> — {a.pai_descricao}
                        </td>
                        <td>
                          <strong>{a.filho_codigo}</strong> — {a.filho_descricao}
                        </td>
                        <td>
                          <span className={`badge ${a.origem_vinculo === 'OP_AUTO' ? 'badge--warning' : 'badge--info'}`}>
                            {a.origem_vinculo === 'OP_AUTO' ? 'Aprendido OP' : 'Manual'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono">
                          {a.amostras_aprendizado || 0}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-cyan">
                          {a.rendimento_aprendido_pct != null ? `${a.rendimento_aprendido_pct}%` : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            step="0.01"
                            className="form-input"
                            style={{ width: 85, textAlign: 'right', display: 'inline-block' }}
                            value={valorRend}
                            onChange={(e) => setRendEditMap((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          />
                        </td>
                        <td>
                          <span className={`badge ${conf ? 'badge--success' : 'badge--warning'}`}>
                            {conf ? 'Confirmado' : 'Revisar'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {podeEscrever && (
                            <div className="flex justify-end gap-6">
                              <button type="button" className="btn btn--success btn--sm" onClick={() => handleConfirmarArvore(a)}>
                                <CheckCircle2 size={14} /> {conf ? 'Atualizar' : 'Confirmar'}
                              </button>
                              <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => handleDescartarArvore(a.id)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {arvoreFiltrada.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhum vínculo encontrado na árvore.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: NOVO MAPA DE PRODUÇÃO (Principal / Complementar) ── */}
      {modalNovoOpen && (
        <div className="modal-overlay" style={{ padding: 20, zIndex: 90 }}>
          <div className="card" style={{ width: '92vw', maxWidth: 520, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold flex items-center gap-8" style={{ margin: 0 }}>
                <ClipboardList size={18} className="text-primary" /> Novo Mapa de Produção
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalNovoOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCriarMapaModal} style={{ padding: 20 }} className="flex flex-col gap-14">
              <div>
                <label className="form-label">TIPO DE MAPA</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    {
                      id: 'PRINCIPAL',
                      title: '📋 Principal',
                      desc: 'Mapa diário padrão. Reabre o aberto se já existir.',
                    },
                    {
                      id: 'COMPLEMENTAR',
                      title: '✨ Complementar',
                      desc: 'Novo mapa do zero (0 itens) para a mesma data.',
                    },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setNovoTipo(opt.id)}
                      style={{
                        textAlign: 'left',
                        padding: 12,
                        borderRadius: 10,
                        border: novoTipo === opt.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: novoTipo === opt.id ? 'rgba(59,130,246,0.12)' : 'var(--bg-2)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{opt.title}</div>
                      <div className="text-xs text-muted">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="form-label">DATA DE PRODUÇÃO *</label>
                <input type="date" required className="form-input" value={novaData} onChange={(e) => setNovaData(e.target.value)} />
              </div>

              <div>
                <label className="form-label">TÍTULO DO MAPA (Opcional / Gerado automático)</label>
                <input
                  className="form-input"
                  value={novoTitulo}
                  onChange={(e) => setNovoTitulo(e.target.value.toUpperCase())}
                  placeholder={`MAPA DE PRODUÇÃO ${novoTipo === 'COMPLEMENTAR' ? 'COMPLEMENTAR ' : 'DIÁRIO '}${fmtDataBr(novaData)}`}
                />
              </div>

              <div
                className="text-xs"
                style={{
                  background: 'rgba(59,130,246,0.1)',
                  border: '1px solid rgba(59,130,246,0.28)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: '#cbd5e1',
                }}
              >
                📋 <strong>Mapa {novoTipo === 'PRINCIPAL' ? 'Principal' : 'Complementar'}:</strong>{' '}
                {novoTipo === 'PRINCIPAL'
                  ? 'Se já existir um mapa principal aberto para esta data, ele será reaberto automaticamente.'
                  : 'Cria um mapa extra independente para a mesma data começando do zero.'}
              </div>

              <div className="flex justify-end gap-8 pt-8 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalNovoOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  Criar Mapa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: SELECIONAR ITENS DOS PEDIDOS (Puxar por Data de Entrega) ── */}
      {modalPedidosOpen && (
        <div className="modal-overlay" style={{ padding: 20, zIndex: 92 }}>
          <div
            className="card"
            style={{ width: '94vw', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}
          >
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold flex items-center gap-8" style={{ margin: 0 }}>
                <ClipboardList size={18} className="text-primary" /> Selecionar Itens dos Pedidos
              </h3>
              <div className="flex items-center gap-12">
                <span className="text-xs text-muted font-mono">{Object.keys(selecionadosPedidos).length} selecionados</span>
                <button type="button" className="btn-icon" onClick={() => setModalPedidosOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="flex gap-8 flex-wrap items-center">
                <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
                  <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
                  <input
                    className="form-input"
                    style={{ paddingLeft: 32 }}
                    placeholder="Buscar produto ou cliente..."
                    value={pedBusca}
                    onChange={(e) => setPedBusca(e.target.value)}
                  />
                </div>
                <button type="button" className="btn btn--secondary btn--sm" onClick={selecionarTodosModal}>
                  ✓ Todos
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelecionadosPedidos({})}>
                  ✗ Limpar
                </button>
              </div>

              <div className="flex gap-6 flex-wrap items-center">
                <span className="text-xs text-muted flex items-center gap-4">
                  <Calendar size={12} /> Entrega:
                </span>
                <button
                  type="button"
                  className={`btn btn--sm ${!pedDataFiltro ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setPedDataFiltro('')}
                >
                  Todos
                </button>
                {(pedidosDisp.datasDisponiveis || []).map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    className={`btn btn--sm ${pedDataFiltro === dt ? 'btn--primary' : 'btn--ghost'}`}
                    onClick={() => setPedDataFiltro(pedDataFiltro === dt ? '' : dt)}
                  >
                    {fmtDataBr(dt).slice(0, 5)}
                  </button>
                ))}
                <input
                  type="date"
                  className="form-input"
                  style={{ width: 145, height: 30, fontSize: 12 }}
                  value={pedDataFiltro}
                  onChange={(e) => setPedDataFiltro(e.target.value)}
                />
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: 16 }} className="flex flex-col gap-12">
              {loadingPedidosDisp ? (
                <div className="p-24 text-center text-muted">Carregando itens dos pedidos...</div>
              ) : (pedidosDisp.gruposProduto || []).length === 0 ? (
                <div className="p-24 text-center text-muted">Nenhum item de pedido encontrado para os filtros informados.</div>
              ) : (
                (pedidosDisp.gruposProduto || []).map((grp) => (
                  <div key={grp.produto_id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-2)' }}>
                    <div
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 800,
                        fontSize: 13,
                        background: 'rgba(59,130,246,0.08)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span>
                        {grp.produto_codigo ? `${grp.produto_codigo} — ` : ''}
                        {grp.produto_descricao}
                      </span>
                      <span className="font-mono">{fmtKg(grp.total_kg)}</span>
                    </div>
                    <div className="flex flex-col">
                      {(grp.itens || []).map((it) => {
                        const checked = Boolean(selecionadosPedidos[it.pedido_item_id])
                        return (
                          <label
                            key={it.pedido_item_id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 10,
                              padding: '9px 14px',
                              borderTop: '1px solid rgba(42,58,85,0.45)',
                              cursor: 'pointer',
                              opacity: it.no_mapa_atual ? 0.55 : 1,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div className="flex items-center gap-10" style={{ flex: 1, minWidth: 220 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={it.no_mapa_atual}
                                onChange={() => toggleSelecionadoPedidoItem(it)}
                              />
                              <span className="font-mono font-bold text-cyan text-xs">#{it.pedido_codigo}</span>
                              <span style={{ fontWeight: 600, fontSize: 13 }}>{it.cliente_nome}</span>
                              {it.especificacao_auto ? (
                                <span className="badge badge--success" style={{ fontSize: 10 }}>
                                  {it.especificacao_auto} • {it.conservacao_auto}
                                </span>
                              ) : (
                                <span className="badge badge--warning" style={{ fontSize: 10 }}>
                                  Sem especificação padrão
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-10">
                              <span className="text-xs text-muted flex items-center gap-4">
                                <Calendar size={11} /> {fmtDataBr(it.previsao_entrega)}
                              </span>
                              <span className="font-mono font-bold text-success">{fmtKg(it.qtd_kg_solicitada)}</span>
                              {it.no_mapa_atual && (
                                <span className="badge badge--info" style={{ fontSize: 10 }}>
                                  ✓ Neste mapa
                                </span>
                              )}
                              {!it.no_mapa_atual && it.em_outro_mapa && (
                                <span className="badge badge--warning" style={{ fontSize: 10 }}>
                                  ⚠️ Em {it.em_outro_mapa}
                                </span>
                              )}
                              {it.em_embarque && (
                                <span className="badge badge--ghost" style={{ fontSize: 10 }}>
                                  🚚 em embarque
                                </span>
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end gap-8 p-16" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalPedidosOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn--primary" onClick={handleConfirmarPuxarPedidos}>
                Adicionar ao Mapa →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CARREGAR PROGRAMAÇÃO SEMANAL ── */}
      {modalSemanalOpen && (
        <div className="modal-overlay" style={{ padding: 20, zIndex: 93 }}>
          <div className="card" style={{ width: '92vw', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold flex items-center gap-8" style={{ margin: 0 }}>
                <Download size={18} className="text-primary" /> Carregar Programação Semanal
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalSemanalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: 18 }} className="flex flex-col gap-12">
              <p className="text-xs text-muted" style={{ margin: 0 }}>
                Selecione o dia da semana para importar os produtos oficiais, especificações padrão e metas de kg no mapa:
              </p>
              <div className="flex gap-8 items-end flex-wrap">
                <div style={{ flex: 1, minWidth: 240 }}>
                  <label className="form-label">DIA DA SEMANA</label>
                  <select className="form-input" value={diaSemanalSel} onChange={(e) => setDiaSemanalSel(Number(e.target.value))}>
                    {DIAS_SEMANA.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setMostrarFormSemanal((v) => !v)}>
                  <Plus size={14} /> {mostrarFormSemanal ? 'Fechar Cadastro' : 'Cadastrar Corte neste Dia'}
                </button>
              </div>

              {mostrarFormSemanal && (
                <form onSubmit={handleSalvarItemSemanal} className="card" style={{ background: 'var(--bg-2)', padding: 12 }}>
                  <div className="form-grid form-grid--3" style={{ gap: 8 }}>
                    <div>
                      <label className="form-label">Corte *</label>
                      <ProdutoSearchSelect
                        produtos={subprodutosLista}
                        value={semForm.produto_id}
                        onChange={(val) => setSemForm({ ...semForm, produto_id: val })}
                        placeholder="Pesquisar corte..."
                        modalTitle="Selecionar Corte na Programação Semanal"
                      />
                    </div>
                    <div>
                      <label className="form-label">Meta (kg) *</label>
                      <input type="number" step="0.01" required className="form-input" value={semForm.qtd_meta_kg} onChange={(e) => setSemForm({ ...semForm, qtd_meta_kg: e.target.value })} placeholder="Ex: 100" />
                    </div>
                    <div>
                      <label className="form-label">Especificação</label>
                      <input className="form-input" value={semForm.especificacao} onChange={(e) => setSemForm({ ...semForm, especificacao: e.target.value.toUpperCase() })} placeholder="PACOTES DE 5KG" />
                    </div>
                  </div>
                  <div className="form-grid form-grid--3 mt-8" style={{ gap: 8 }}>
                    <div>
                      <label className="form-label">Cliente (opcional)</label>
                      <ClienteSearchSelect
                        clientes={clientes}
                        value={semForm.cliente_id}
                        onChange={(val) => setSemForm({ ...semForm, cliente_id: val })}
                        emptyLabel="-- Estoque / Geral --"
                        placeholder="Pesquisar cliente..."
                      />
                    </div>
                    <div>
                      <label className="form-label">Matéria-Prima</label>
                      <ProdutoSearchSelect
                        produtos={mpsLista}
                        value={semForm.materia_prima_id}
                        onChange={(val) => setSemForm({ ...semForm, materia_prima_id: val })}
                        emptyLabel="-- Via Árvore --"
                        placeholder="Pesquisar MP..."
                        modalTitle="Selecionar Matéria-Prima"
                      />
                    </div>
                    <div className="flex items-end">
                      <button type="submit" className="btn btn--success w-full">
                        <Plus size={14} /> Salvar na Programação
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Especificação</th>
                      <th style={{ textAlign: 'right' }}>Meta (kg)</th>
                      <th style={{ textAlign: 'right' }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanalLista.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.produto_codigo}</strong> — {s.produto_descricao}
                          {s.cliente_nome && <div className="text-xs text-muted">{s.cliente_nome}</div>}
                        </td>
                        <td className="text-xs">{s.especificacao || s.conservacao}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                          {fmtKg(s.qtd_meta_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm text-danger"
                            onClick={async () => {
                              await mapaProducaoQueries.excluirProgramacaoSemanal(s.id)
                              carregarSemanal(diaSemanalSel)
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {semanalLista.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center p-16 text-muted">
                          Nenhum corte configurado para este dia da semana ainda.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end gap-8 p-16" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalSemanalOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn--primary" onClick={handleImportarSemanal} disabled={semanalLista.length === 0}>
                <Download size={14} /> Importar Itens →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: ESPECIFICAÇÕES AUTOMÁTICAS (Produto x Cliente) ── */}
      {modalEspecOpen && (
        <div className="modal-overlay" style={{ padding: 20, zIndex: 93 }}>
          <div className="card" style={{ width: '94vw', maxWidth: 840, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold flex items-center gap-8" style={{ margin: 0 }}>
                <Settings size={18} className="text-primary" /> Especificações Padrão por Corte &amp; Cliente
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalEspecOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div style={{ overflowY: 'auto', padding: 18 }} className="flex flex-col gap-12">
              <form onSubmit={handleSalvarSpec} className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
                <div className="form-grid form-grid--3" style={{ gap: 10 }}>
                  <div>
                    <label className="form-label">Produto / Corte *</label>
                    <ProdutoSearchSelect
                      produtos={subprodutosLista}
                      value={especForm.produto_id}
                      onChange={(val) => setEspecForm({ ...especForm, produto_id: val })}
                      placeholder="Pesquisar corte..."
                      modalTitle="Selecionar Produto / Corte"
                    />
                  </div>
                  <div>
                    <label className="form-label">Cliente (opcional — em branco = geral)</label>
                    <ClienteSearchSelect
                      clientes={clientes}
                      value={especForm.cliente_id}
                      onChange={(val) => setEspecForm({ ...especForm, cliente_id: val })}
                      emptyLabel="Padrão Geral (todos os clientes)"
                      placeholder="Pesquisar cliente..."
                    />
                  </div>
                  <div>
                    <label className="form-label">Conservação</label>
                    <select className="form-input" value={especForm.conservacao} onChange={(e) => setEspecForm({ ...especForm, conservacao: e.target.value })}>
                      <option value="RESFRIADO">RESFRIADO</option>
                      <option value="CONGELADO">CONGELADO</option>
                      <option value="IN NATURA">IN NATURA</option>
                    </select>
                  </div>
                </div>
                <div className="form-grid form-grid--3 mt-8" style={{ gap: 10 }}>
                  <div>
                    <label className="form-label">Especificação *</label>
                    <input className="form-input" required value={especForm.especificacao} onChange={(e) => setEspecForm({ ...especForm, especificacao: e.target.value.toUpperCase() })} placeholder="Ex: PACOTES DE 5KG" />
                  </div>
                  <div>
                    <label className="form-label">Matéria-Prima Padrão</label>
                    <ProdutoSearchSelect
                      produtos={mpsLista}
                      value={especForm.materia_prima_id}
                      onChange={(val) => setEspecForm({ ...especForm, materia_prima_id: val })}
                      emptyLabel="-- Via Árvore --"
                      placeholder="Pesquisar MP..."
                      modalTitle="Selecionar Matéria-Prima Padrão"
                    />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" className="btn btn--primary w-full">
                      <Check size={14} /> Salvar Especificação Automática
                    </button>
                  </div>
                </div>
              </form>

              <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Cliente</th>
                      <th>Especificação</th>
                      <th>Conservação</th>
                      <th>Matéria-Prima</th>
                      <th style={{ textAlign: 'right' }}>Excluir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {especsLista.map((sp) => (
                      <tr key={sp.id}>
                        <td>
                          <strong>{sp.produto_codigo}</strong> — {sp.produto_descricao}
                        </td>
                        <td className="text-xs">{sp.cliente_nome || 'Geral'}</td>
                        <td className="font-bold text-xs">{sp.especificacao}</td>
                        <td className="text-xs">{sp.conservacao}</td>
                        <td className="text-xs">{sp.materia_prima_descricao || '-'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm text-danger"
                            onClick={async () => {
                              await mapaProducaoQueries.excluirEspecificacaoMapa(sp.id)
                              carregarEspecs()
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {especsLista.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center p-16 text-muted">
                          Nenhuma especificação cadastrada ainda. Ao editar qualquer linha do mapa ela também é salva automaticamente aqui!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end gap-8 p-16" style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)' }}>
              {mapaAtivo && (
                <button
                  type="button"
                  className="btn btn--success"
                  onClick={async () => {
                    await handlePuxarEspecificacoesMapa()
                    setModalEspecOpen(false)
                  }}
                >
                  <Download size={14} /> Aplicar ao Mapa Atual
                </button>
              )}
              <button type="button" className="btn btn--ghost" onClick={() => setModalEspecOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: + LINHA MANUAL ── */}
      {modalLinhaOpen && (
        <div className="modal-overlay" style={{ padding: 20, zIndex: 93 }}>
          <div className="card" style={{ width: '92vw', maxWidth: 620, padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold" style={{ margin: 0 }}>
                + Adicionar Linha Manual no Mapa
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalLinhaOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvarLinhaManual} style={{ padding: 20 }} className="flex flex-col gap-12">
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Produto / Corte *</label>
                  <ProdutoSearchSelect
                    produtos={subprodutosLista}
                    value={linhaForm.produto_id}
                    onChange={(val) => setLinhaForm({ ...linhaForm, produto_id: val })}
                    placeholder="Pesquisar corte..."
                    modalTitle="Selecionar Produto / Corte"
                  />
                </div>
                <div>
                  <label className="form-label">Quantidade Prevista (kg) *</label>
                  <input type="number" step="0.01" required className="form-input" value={linhaForm.qtd_prevista_kg} onChange={(e) => setLinhaForm({ ...linhaForm, qtd_prevista_kg: e.target.value })} placeholder="Ex: 50" />
                </div>
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Cliente (opcional)</label>
                  <ClienteSearchSelect
                    clientes={clientes}
                    value={linhaForm.cliente_id}
                    onChange={(val) => setLinhaForm({ ...linhaForm, cliente_id: val })}
                    emptyLabel="-- Estoque / Interno --"
                    placeholder="Pesquisar cliente..."
                  />
                </div>
                <div>
                  <label className="form-label">Matéria-Prima (opcional — via Árvore)</label>
                  <ProdutoSearchSelect
                    produtos={mpsLista}
                    value={linhaForm.materia_prima_id}
                    onChange={(val) => setLinhaForm({ ...linhaForm, materia_prima_id: val })}
                    emptyLabel="-- Automática --"
                    placeholder="Pesquisar MP..."
                    modalTitle="Selecionar Matéria-Prima"
                  />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Especificação</label>
                  <input className="form-input" value={linhaForm.especificacao} onChange={(e) => setLinhaForm({ ...linhaForm, especificacao: e.target.value.toUpperCase() })} placeholder="Se vazio, puxa automática" />
                </div>
                <div>
                  <label className="form-label">Conservação</label>
                  <select className="form-input" value={linhaForm.conservacao} onChange={(e) => setLinhaForm({ ...linhaForm, conservacao: e.target.value })}>
                    <option value="RESFRIADO">RESFRIADO</option>
                    <option value="CONGELADO">CONGELADO</option>
                    <option value="IN NATURA">IN NATURA</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Grupo</label>
                  <input list="grupos-mapa-sug" className="form-input" value={linhaForm.grupo_mapa} onChange={(e) => setLinhaForm({ ...linhaForm, grupo_mapa: e.target.value.toUpperCase() })} placeholder="BOVINOS / AVES..." />
                  <datalist id="grupos-mapa-sug">
                    {gruposDisponiveis.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="form-label">Observação</label>
                <input className="form-input" value={linhaForm.observacao} onChange={(e) => setLinhaForm({ ...linhaForm, observacao: e.target.value.toUpperCase() })} />
              </div>
              <div className="flex justify-end gap-8 pt-8 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalLinhaOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <Plus size={15} /> Incluir no Mapa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL IMPRESSÃO A4 DO MAPA (ISOLADO EM PORTAL/IFRAME) ── */}
      {mapaPrint && (
        <PrintDocumentModal
          title={`Mapa de Produção — ${mapaPrint.codigo}`}
          orientation="landscape"
          autoPrint={false}
          onClose={() => setMapaPrint(null)}
        >
          <div className="wms-print-header">
            <div>
              <div className="wms-print-brand">WMSphere ERP — Planejamento &amp; Mapa de Produção</div>
              <div className="wms-print-brand-sub">
                {mapaPrint.titulo} ({mapaPrint.codigo})
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="wms-print-doc-title">MAPA — {mapaPrint.codigo}</div>
              <div style={{ fontSize: 10.5, color: '#334155', marginTop: 2 }}>
                Data: <strong>{fmtDataBr(mapaPrint.data_mapa)}</strong> • Status: <strong>{mapaPrint.status}</strong>
              </div>
            </div>
          </div>

          {mapaPrint.observacoes && (
            <div className="wms-print-obs" style={{ marginBottom: 10, minHeight: 0 }}>
              <strong>Observações:</strong> {mapaPrint.observacoes}
            </div>
          )}

          <table className="wms-print-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Especificação</th>
                <th>Conserv.</th>
                <th style={{ textAlign: 'right' }}>Previsto</th>
                <th>Cliente</th>
                <th>Matéria-Prima</th>
                <th>Obs.</th>
                <th style={{ textAlign: 'right' }}>Realizado</th>
              </tr>
            </thead>
            <tbody>
              {(mapaPrint.itens || []).map((it) => (
                <tr key={it.id}>
                  <td className="wms-print-mono">{it.produto_codigo || '-'}</td>
                  <td style={{ fontWeight: 700 }}>{it.produto_descricao}</td>
                  <td>{it.especificacao || '-'}</td>
                  <td>{it.conservacao}</td>
                  <td className="wms-print-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                    {fmtKg(it.qtd_prevista_kg)}
                  </td>
                  <td>{it.cliente_nome || 'INTERNO'}</td>
                  <td>
                    {it.materia_prima_descricao ? `${it.materia_prima_descricao} (${fmtKg(it.qtd_mp_kg)})` : '-'}
                  </td>
                  <td>{it.observacao || ''}</td>
                  <td className="wms-print-mono" style={{ textAlign: 'right' }}>
                    {Number(it.qtd_realizada_kg) > 0 ? fmtKg(it.qtd_realizada_kg) : '________ kg'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="wms-print-footer">
            <span>WMSphere ERP — Mapa de Produção {mapaPrint.codigo}</span>
            <span>Emitido em {new Date().toLocaleString('pt-BR')}</span>
          </div>
        </PrintDocumentModal>
      )}
    </div>
  )
}
