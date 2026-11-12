import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardList,
  Plus,
  Search,
  Printer,
  Truck,
  CheckCircle2,
  Edit3,
  Trash2,
  Send,
  Eye,
  X,
  AlertTriangle,
  ShieldAlert,
  Package,
  RefreshCw,
  Scale,
  Box
} from 'lucide-react'
import { pedidosQueries } from '../queries/pedidos'
import * as saidaQueries from '../queries/saida'
import { useAppStore } from '../store/appStore'
import { FolhaPedidoPrint } from '../components/shared/FolhaPedidoPrint'
import { RomaneioEmbarquePrint } from '../components/shared/RomaneioEmbarquePrint'

const STATUS_BADGE = {
  RASCUNHO: { label: 'Rascunho', cls: 'badge--neutral' },
  LIBERADO: { label: 'Liberado p/ Separação', cls: 'badge--info' },
  EM_SEPARACAO: { label: 'Em Separação', cls: 'badge--warning' },
  AGUARDANDO_CONFERENCIA: { label: 'Separação Finalizada', cls: 'badge--purple' },
  EM_CONFERENCIA: { label: 'Em Conferência', cls: 'badge--warning' },
  EXPEDIDO: { label: 'Expedido', cls: 'badge--success' },
  CANCELADO: { label: 'Cancelado', cls: 'badge--danger' }
}

const normTxt = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

const temSaldoProduto = (p) => Number(p?.saldo_kg || 0) > 0 || Number(p?.qtd_caixas || 0) > 0

/** Ordena produtos priorizando itens com saldo em estoque antes dos zerados */
const ordenarProdutosSaldoPrimeiro = (lista) =>
  [...lista].sort((a, b) => {
    const prioA = temSaldoProduto(a) ? 0 : 1
    const prioB = temSaldoProduto(b) ? 0 : 1
    if (prioA !== prioB) return prioA - prioB
    return String(a?.descricao || '').localeCompare(String(b?.descricao || ''), 'pt-BR')
  })

const fmtCx = (v) => {
  const n = Number(v || 0)
  const rounded = Math.abs(n - Math.round(n)) < 0.01 ? Math.round(n) : Number(n.toFixed(2))
  return `${rounded.toLocaleString('pt-BR')} cx`
}

const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0].split(' ')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

const fmtDataHora = (d) => {
  if (!d) return '-'
  const raw = String(d)
  const utc = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const dt = new Date(utc)
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleString('pt-BR')
}

export function Pedidos() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeGerenciarPedidos = Boolean(
    operador &&
      (Number(operador.is_adm) === 1 || operador.perfil === 'gestor' || operador.permissoes?.pedidos)
  )

  const [aba, setAba] = useState('GERENCIADOR') // 'GERENCIADOR' | 'FORM'
  const [loading, setLoading] = useState(false)
  const [pedidos, setPedidos] = useState([])
  const [produtos, setProdutos] = useState([])
  const [clientes, setClientes] = useState([])

  // Filtros do Gerenciador
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  // Formulário Novo / Editar Pedido
  const [editId, setEditId] = useState(null)
  const [editCodigo, setEditCodigo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState(null)
  const [mostrarTrocaCliente, setMostrarTrocaCliente] = useState(false)
  const [modalNovoClienteAberto, setModalNovoClienteAberto] = useState(false)
  const [novoCliForm, setNovoCliForm] = useState({
    codigo: '', razao_social: '', nome_fantasia: '', cnpj_cpf: '', inscricao_estadual: '',
    endereco: '', numero: '', bairro: '', cep: '', cidade: '', uf: 'SP', pais: 'BRASIL',
    telefone: '', icms: 'CONTRIBUINTE'
  })
  const [previsaoEntrega, setPrevisaoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [itensForm, setItensForm] = useState([])

  // Novo seletor integrado de produto (Código + Autocomplete Descrição + Lupa)
  const [codigoInput, setCodigoInput] = useState('')
  const [descricaoInput, setDescricaoInput] = useState('')
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false)
  const [indiceSugestao, setIndiceSugestao] = useState(-1)

  // Modal da lupa
  const [modalBuscaAberto, setModalBuscaAberto] = useState(false)
  const [modalBuscaTexto, setModalBuscaTexto] = useState('')
  const [modalSomenteComSaldo, setModalSomenteComSaldo] = useState(false)

  // Quantidade, Unidade (KG padrão / CX) e Peso Manual fallback
  const [unidadeInput, setUnidadeInput] = useState('KG') // 'KG' | 'CX'
  const [qtdInput, setQtdInput] = useState('')
  const [pesoManualCxInput, setPesoManualCxInput] = useState('')
  const [obsItemInput, setObsItemInput] = useState('')

  const codigoRef = useRef(null)
  const descricaoRef = useRef(null)
  const qtdRef = useRef(null)
  const modalBuscaRef = useRef(null)

  // Modais de detalhes & impressão
  const [pedidoDetalhe, setPedidoDetalhe] = useState(null)
  const [printPedido, setPrintPedido] = useState(null)
  const [printRomaneio, setPrintRomaneio] = useState(null)

  const carregarDados = async () => {
    setLoading(true)
    try {
      const [listaPed, listaProd, listaCli] = await Promise.all([
        pedidosQueries.listarPedidos({
          status: filtroStatus,
          busca: filtroBusca,
          dataInicio: dataInicio || null,
          dataFim: dataFim || null
        }),
        pedidosQueries.listarSaldosProdutosParaPedido(),
        pedidosQueries.listarClientes()
      ])
      setPedidos(listaPed)
      setProdutos(listaProd)
      setClientes(listaCli)
      if (!clienteIdSelecionado && listaCli.length > 0) {
        const pad = listaCli.find((c) => Number(c.is_padrao) === 1) || listaCli[0]
        setClienteIdSelecionado(pad.id)
      }
    } catch (err) {
      toastError('Erro ao carregar pedidos: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (podeGerenciarPedidos) {
      carregarDados()
    }
  }, [podeGerenciarPedidos, filtroStatus, dataInicio, dataFim])

  useEffect(() => {
    if (modalBuscaAberto) {
      setTimeout(() => modalBuscaRef.current?.focus(), 60)
    }
  }, [modalBuscaAberto])

  const sugestoesProdutos = useMemo(() => {
    const q = normTxt(descricaoInput)
    if (!q) return ordenarProdutosSaldoPrimeiro(produtos).slice(0, 12)
    return ordenarProdutosSaldoPrimeiro(
      produtos.filter(
        (p) =>
          normTxt(p.descricao).includes(q) ||
          normTxt(p.codigo).includes(q) ||
          normTxt(p.ean).includes(q)
      )
    ).slice(0, 15)
  }, [produtos, descricaoInput])

  const produtosModalFiltrados = useMemo(() => {
    const q = normTxt(modalBuscaTexto)
    return ordenarProdutosSaldoPrimeiro(
      produtos.filter((p) => {
        if (modalSomenteComSaldo && !temSaldoProduto(p)) return false
        if (!q) return true
        return (
          normTxt(p.descricao).includes(q) ||
          normTxt(p.codigo).includes(q) ||
          normTxt(p.ean).includes(q) ||
          normTxt(p.grupo).includes(q)
        )
      })
    )
  }, [produtos, modalBuscaTexto, modalSomenteComSaldo])

  const kpis = useMemo(() => {
    return {
      liberados: pedidos.filter((p) => p.status === 'LIBERADO').length,
      emSeparacao: pedidos.filter((p) => p.status === 'EM_SEPARACAO').length,
      emConferencia: pedidos.filter((p) => ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA'].includes(p.status)).length,
      expedidos: pedidos.filter((p) => p.status === 'EXPEDIDO').length
    }
  }, [pedidos])

  const limparCamposItem = (focarCodigo = false) => {
    setCodigoInput('')
    setDescricaoInput('')
    setProdutoSelecionado(null)
    setMostrarSugestoes(false)
    setIndiceSugestao(-1)
    setUnidadeInput('KG')
    setQtdInput('')
    setPesoManualCxInput('')
    setObsItemInput('')
    if (focarCodigo) {
      setTimeout(() => codigoRef.current?.focus(), 40)
    }
  }

  const clientePadrao = useMemo(
    () => clientes.find((c) => Number(c.is_padrao) === 1) || clientes[0] || null,
    [clientes]
  )

  const clienteAtivo = useMemo(
    () => clientes.find((c) => Number(c.id) === Number(clienteIdSelecionado)) || clientePadrao,
    [clientes, clienteIdSelecionado, clientePadrao]
  )

  const resetarFormulario = () => {
    setEditId(null)
    setEditCodigo('')
    setTitulo('')
    setClienteIdSelecionado(clientePadrao?.id || null)
    setMostrarTrocaCliente(false)
    setPrevisaoEntrega('')
    setObservacoes('')
    setItensForm([])
    limparCamposItem(false)
  }

  const aplicarProdutoSelecionado = (prod, focarQtd = true) => {
    setProdutoSelecionado(prod)
    setCodigoInput(prod.codigo || '')
    setDescricaoInput(prod.descricao || '')
    setMostrarSugestoes(false)
    setIndiceSugestao(-1)
    setPesoManualCxInput('')
    if (focarQtd) {
      setTimeout(() => {
        qtdRef.current?.focus()
        qtdRef.current?.select?.()
      }, 40)
    }
  }

  // Digitação no campo Código: identificação automática por código exato ou EAN
  const handleCodigoChange = (val) => {
    setCodigoInput(val)
    const clean = val.trim().toLowerCase()
    if (!clean) {
      setProdutoSelecionado(null)
      setDescricaoInput('')
      return
    }
    const match = produtos.find(
      (p) =>
        String(p.codigo || '').trim().toLowerCase() === clean ||
        String(p.ean || '').trim().toLowerCase() === clean
    )
    if (match) {
      setProdutoSelecionado(match)
      setDescricaoInput(match.descricao || '')
      setMostrarSugestoes(false)
    } else if (produtoSelecionado) {
      setProdutoSelecionado(null)
      setDescricaoInput('')
    }
  }

  const handleCodigoKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (produtoSelecionado) {
      qtdRef.current?.focus()
      qtdRef.current?.select?.()
      return
    }
    const clean = codigoInput.trim().toLowerCase()
    if (!clean) {
      descricaoRef.current?.focus()
      return
    }
    const prefixMatches = produtos.filter((p) =>
      String(p.codigo || '').trim().toLowerCase().startsWith(clean)
    )
    if (prefixMatches.length === 1) {
      aplicarProdutoSelecionado(prefixMatches[0], true)
    } else if (prefixMatches.length > 1) {
      setModalBuscaTexto(codigoInput.trim())
      setModalBuscaAberto(true)
    } else {
      toastWarning(`Nenhum produto encontrado com o código "${codigoInput.trim()}".`)
    }
  }

  // Digitação no campo Descrição: abre sugestões abaixo
  const handleDescricaoChange = (val) => {
    setDescricaoInput(val)
    setMostrarSugestoes(true)
    setIndiceSugestao(0)
    if (produtoSelecionado && normTxt(val) !== normTxt(produtoSelecionado.descricao)) {
      setProdutoSelecionado(null)
      setCodigoInput('')
    }
  }

  const handleDescricaoKeyDown = (e) => {
    if (!mostrarSugestoes || sugestoesProdutos.length === 0) {
      if (e.key === 'ArrowDown') {
        setMostrarSugestoes(true)
        setIndiceSugestao(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceSugestao((prev) => Math.min(sugestoesProdutos.length - 1, prev + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceSugestao((prev) => Math.max(0, prev - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = sugestoesProdutos[indiceSugestao >= 0 ? indiceSugestao : 0]
      if (chosen) aplicarProdutoSelecionado(chosen, true)
    } else if (e.key === 'Escape') {
      setMostrarSugestoes(false)
    }
  }

  // Conversão dinâmica KG <-> CX + cálculo de saldo projetado
  const conversaoItem = useMemo(() => {
    if (!produtoSelecionado) return null
    const pesoMedioCadastro = Number(produtoSelecionado.peso_medio_cx || 0)
    const pesoManual = Number(String(pesoManualCxInput).replace(',', '.') || 0)
    const pesoPorCx = pesoMedioCadastro > 0 ? pesoMedioCadastro : pesoManual

    const itemExistente = itensForm.find((i) => Number(i.produto_id) === Number(produtoSelecionado.id))
    const kgJaNoPedido = Number(String(itemExistente?.qtd_kg_solicitada || 0).replace(',', '.') || 0)
    const cxJaNoPedido = Number(
      String(itemExistente?.qtd_caixas_solicitada || 0).replace(',', '.') ||
        (pesoPorCx > 0 ? kgJaNoPedido / pesoPorCx : 0)
    )

    const qtdDigitada = Number(String(qtdInput).replace(',', '.'))
    const qtdValida = Number.isFinite(qtdDigitada) && qtdDigitada > 0 ? qtdDigitada : 0

    const saldoAtualKg = Number(produtoSelecionado.saldo_kg || 0)
    const saldoAtualCx = Number(produtoSelecionado.qtd_caixas || 0)

    const lancamentoKg =
      unidadeInput === 'KG'
        ? qtdValida
        : pesoPorCx > 0
          ? Number((qtdValida * pesoPorCx).toFixed(3))
          : 0

    const lancamentoCx =
      unidadeInput === 'CX'
        ? qtdValida
        : pesoPorCx > 0
          ? Number((qtdValida / pesoPorCx).toFixed(2))
          : 0

    const projetadoKg = Number((saldoAtualKg - kgJaNoPedido - lancamentoKg).toFixed(3))
    const projetadoCx = Number((saldoAtualCx - cxJaNoPedido - lancamentoCx).toFixed(2))

    return {
      pesoMedioCadastro,
      pesoPorCx,
      precisaPesoManualCx: unidadeInput === 'CX' && pesoMedioCadastro <= 0,
      saldoAtualKg,
      saldoAtualCx,
      kgJaNoPedido,
      cxJaNoPedido,
      lancamentoKg,
      lancamentoCx,
      projetadoKg,
      projetadoCx
    }
  }, [produtoSelecionado, unidadeInput, qtdInput, pesoManualCxInput, itensForm])

  const handleTrocarUnidade = (novaUnidade) => {
    if (novaUnidade === unidadeInput) return
    const qtdAtual = Number(String(qtdInput).replace(',', '.'))
    const pesoPorCx = conversaoItem?.pesoPorCx || 0

    if (Number.isFinite(qtdAtual) && qtdAtual > 0 && pesoPorCx > 0) {
      if (novaUnidade === 'CX') {
        const emCx = Number((qtdAtual / pesoPorCx).toFixed(2))
        setQtdInput(String(emCx))
      } else {
        const emKg = Number((qtdAtual * pesoPorCx).toFixed(2))
        setQtdInput(String(emKg))
      }
    }
    setUnidadeInput(novaUnidade)
    setTimeout(() => qtdRef.current?.focus(), 20)
  }

  const abrirNovoPedido = () => {
    resetarFormulario()
    setAba('FORM')
  }

  const abrirEditarPedido = async (pedId) => {
    try {
      const ped = await pedidosQueries.obterPedido(pedId)
      if (!ped) return toastError('Pedido não encontrado.')
      if (!['RASCUNHO', 'LIBERADO'].includes(ped.status)) {
        return toastWarning('Somente pedidos em Rascunho ou Liberado podem ser editados.')
      }
      setEditId(ped.id)
      setEditCodigo(ped.codigo)
      setTitulo(ped.titulo || '')
      setClienteIdSelecionado(ped.cliente_id || clientePadrao?.id || null)
      setMostrarTrocaCliente(false)
      setPrevisaoEntrega(ped.previsao_entrega ? String(ped.previsao_entrega).slice(0, 10) : '')
      setObservacoes(ped.observacoes || '')
      setItensForm(
        (ped.itens || []).map((it) => ({
          produto_id: it.produto_id,
          produto_codigo: it.produto_codigo,
          produto_descricao: it.produto_descricao,
          saldo_kg: Number(it.estoque_disponivel_kg || 0),
          qtd_caixas_estoque: Number(it.estoque_disponivel_caixas || 0),
          peso_medio_cx: Number(it.peso_medio_cx || 0),
          qtd_kg_solicitada: String(it.qtd_kg_solicitada),
          qtd_caixas_solicitada: it.qtd_caixas_solicitada != null ? String(it.qtd_caixas_solicitada) : '',
          unidade_solicitada: it.unidade_solicitada === 'CX' ? 'CX' : 'KG',
          qtd_solicitada_exibicao: it.qtd_solicitada_exibicao != null ? Number(it.qtd_solicitada_exibicao) : Number(it.qtd_kg_solicitada),
          observacao: it.observacao || ''
        }))
      )
      limparCamposItem(false)
      setAba('FORM')
    } catch (err) {
      toastError('Erro ao carregar pedido para edição: ' + err.message)
    }
  }

  const handleAdicionarItem = () => {
    if (!produtoSelecionado) {
      return toastWarning('Localize e selecione um produto pelo código, descrição ou pela lupa.')
    }
    const qtdNum = Number(String(qtdInput).replace(',', '.'))
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
      return toastWarning('Informe a quantidade do pedido maior que zero.')
    }

    const pesoPorCx = conversaoItem?.pesoPorCx || 0
    if (unidadeInput === 'CX' && pesoPorCx <= 0) {
      return toastWarning(
        'Este produto ainda não possui peso médio por caixa no estoque. Informe o kg médio por caixa ou alterne para KG.'
      )
    }

    const kgFinal =
      unidadeInput === 'KG'
        ? Number(qtdNum.toFixed(3))
        : Number((qtdNum * pesoPorCx).toFixed(3))

    const cxFinal =
      unidadeInput === 'CX'
        ? Number(qtdNum.toFixed(2))
        : pesoPorCx > 0
          ? Math.max(1, Math.round(kgFinal / pesoPorCx))
          : null

    if (
      (unidadeInput === 'KG' && (conversaoItem?.projetadoKg ?? 0) < 0) ||
      (unidadeInput === 'CX' && (conversaoItem?.projetadoCx ?? 0) < 0)
    ) {
      toastWarning(
        `Item incluído acima do estoque atual: "${produtoSelecionado.descricao}" ficará com saldo projetado negativo após o pedido.`
      )
    }

    setItensForm((prev) => {
      const idx = prev.findIndex((i) => Number(i.produto_id) === Number(produtoSelecionado.id))
      if (idx >= 0) {
        const next = [...prev]
        const novoKg = Number(next[idx].qtd_kg_solicitada || 0) + kgFinal
        const prevCx = next[idx].qtd_caixas_solicitada !== '' ? Number(next[idx].qtd_caixas_solicitada) : 0
        const novoCx =
          cxFinal !== null || next[idx].qtd_caixas_solicitada !== ''
            ? String(Number((prevCx + (cxFinal || 0)).toFixed(2)))
            : ''
        next[idx] = {
          ...next[idx],
          qtd_kg_solicitada: String(Number(novoKg.toFixed(3))),
          qtd_caixas_solicitada: novoCx,
          unidade_solicitada:
            next[idx].unidade_solicitada === unidadeInput ? unidadeInput : 'KG',
          qtd_solicitada_exibicao:
            next[idx].unidade_solicitada === unidadeInput && unidadeInput === 'CX'
              ? Number(novoCx || 0)
              : Number(novoKg.toFixed(3)),
          observacao: obsItemInput.trim() || next[idx].observacao
        }
        return next
      }
      return [
        ...prev,
        {
          produto_id: produtoSelecionado.id,
          produto_codigo: produtoSelecionado.codigo,
          produto_descricao: produtoSelecionado.descricao,
          saldo_kg: Number(produtoSelecionado.saldo_kg || 0),
          qtd_caixas_estoque: Number(produtoSelecionado.qtd_caixas || 0),
          peso_medio_cx: pesoPorCx,
          qtd_kg_solicitada: String(kgFinal),
          qtd_caixas_solicitada: cxFinal !== null ? String(cxFinal) : '',
          unidade_solicitada: unidadeInput,
          qtd_solicitada_exibicao: qtdNum,
          observacao: obsItemInput.trim()
        }
      ]
    })

    limparCamposItem(true)
  }

  const handleSalvarNovoCliente = async (e) => {
    e.preventDefault()
    if (!novoCliForm.razao_social.trim()) {
      return toastWarning('Informe a Razão Social do cliente.')
    }
    try {
      const criado = await pedidosQueries.criarCliente(novoCliForm)
      const listaCli = await pedidosQueries.listarClientes()
      setClientes(listaCli)
      setClienteIdSelecionado(criado.id)
      setModalNovoClienteAberto(false)
      setMostrarTrocaCliente(false)
      setNovoCliForm({
        codigo: '', razao_social: '', nome_fantasia: '', cnpj_cpf: '', inscricao_estadual: '',
        endereco: '', numero: '', bairro: '', cep: '', cidade: '', uf: 'SP', pais: 'BRASIL',
        telefone: '', icms: 'CONTRIBUINTE'
      })
      toastSuccess(`Cliente "${criado.razao_social}" cadastrado e selecionado neste pedido.`)
    } catch (err) {
      toastError('Erro ao cadastrar cliente: ' + err.message)
    }
  }

  const handleSalvarPedido = async (liberar) => {
    if (!titulo.trim()) return toastWarning('Informe o Título do Pedido (será impresso no Romaneio de Embarque).')
    if (itensForm.length === 0) return toastWarning('Adicione pelo menos 1 item ao pedido.')

    const payloadItens = itensForm.map((i) => ({
      produto_id: i.produto_id,
      qtd_kg_solicitada: Number(String(i.qtd_kg_solicitada).replace(',', '.')),
      qtd_caixas_solicitada: i.qtd_caixas_solicitada
        ? Number(String(i.qtd_caixas_solicitada).replace(',', '.'))
        : null,
      unidade_solicitada: i.unidade_solicitada || 'KG',
      qtd_solicitada_exibicao: i.qtd_solicitada_exibicao != null ? Number(i.qtd_solicitada_exibicao) : null,
      observacao: i.observacao || ''
    }))

    const cliId = clienteAtivo?.id || null
    const cliNome = clienteAtivo?.razao_social || 'BEEF CONTAINER LIMITADA'

    setLoading(true)
    try {
      if (editId) {
        await pedidosQueries.atualizarPedido({
          id: editId,
          titulo,
          cliente_id: cliId,
          cliente: cliNome,
          previsao_entrega: previsaoEntrega || null,
          observacoes,
          itens: payloadItens,
          liberar
        })
        toastSuccess(
          liberar
            ? `Pedido ${editCodigo} atualizado e liberado para Separação!`
            : `Rascunho do pedido ${editCodigo} atualizado.`
        )
      } else {
        const res = await pedidosQueries.criarPedido({
          titulo,
          cliente_id: cliId,
          cliente: cliNome,
          previsao_entrega: previsaoEntrega || null,
          observacoes,
          itens: payloadItens,
          operador,
          liberar
        })
        toastSuccess(
          liberar
            ? `Pedido ${res.codigo} criado e enviado para Saída de Materiais!`
            : `Pedido ${res.codigo} salvo como rascunho.`
        )
      }
      resetarFormulario()
      setAba('GERENCIADOR')
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLiberar = async (ped) => {
    try {
      await pedidosQueries.liberarPedido(ped.id)
      toastSuccess(`Pedido ${ped.codigo} liberado para separação!`)
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleCancelar = async (ped) => {
    const msg =
      ped.total_caixas_separadas > 0
        ? `O pedido ${ped.codigo} possui ${ped.total_caixas_separadas} caixa(s) já reservadas na separação. Ao cancelar, todas voltarão para DISPONIVEL no estoque. Confirma o cancelamento?`
        : `Deseja cancelar o pedido ${ped.codigo} ("${ped.titulo}")?`
    if (!window.confirm(msg)) return

    try {
      await pedidosQueries.cancelarPedido(ped.id, operador)
      toastSuccess(`Pedido ${ped.codigo} cancelado.`)
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleVerDetalhes = async (pedId) => {
    try {
      const det = await pedidosQueries.obterPedido(pedId)
      setPedidoDetalhe(det)
    } catch (err) {
      toastError('Erro ao carregar detalhes: ' + err.message)
    }
  }

  const handleImprimirFolhaPedido = async (pedId) => {
    try {
      const det = await pedidosQueries.obterPedido(pedId)
      setPrintPedido(det)
    } catch (err) {
      toastError('Erro ao preparar impressão: ' + err.message)
    }
  }

  const handleImprimirRomaneioEmbarque = async (ped) => {
    if (!ped.romaneio_id) {
      return toastWarning('Este pedido ainda não possui separação iniciada.')
    }
    if (['RASCUNHO', 'LIBERADO', 'EM_SEPARACAO'].includes(ped.status)) {
      return toastWarning('Finalize a separação na aba Saída de Materiais para emitir o Romaneio de Embarque.')
    }
    try {
      const det = await saidaQueries.detalhesRomaneio(ped.romaneio_id)
      if (!det) return toastError('Romaneio vinculado não encontrado.')
      setPrintRomaneio(det)
    } catch (err) {
      toastError('Erro ao carregar romaneio: ' + err.message)
    }
  }

  if (!podeGerenciarPedidos) {
    return (
      <div className="page-container">
        <div className="card" style={{ maxWidth: '580px', margin: '40px auto', textAlign: 'center', padding: '32px' }}>
          <ShieldAlert size={48} className="text-warning" style={{ margin: '0 auto 12px' }} />
          <h2 style={{ marginBottom: '8px' }}>Acesso Restrito à Gerência / Administração</h2>
          <p className="text-muted">
            A criação e o gerenciamento de Pedidos são permitidos apenas para usuários Administradores ou da Gerência.
            Para separar pedidos liberados, acesse <strong>Saída de Materiais</strong>.
          </p>
        </div>
      </div>
    )
  }

  const totalFormKg = itensForm.reduce((s, i) => s + Number(String(i.qtd_kg_solicitada).replace(',', '.') || 0), 0)
  const totalFormCx = itensForm.reduce((s, i) => s + Number(String(i.qtd_caixas_solicitada).replace(',', '.') || 0), 0)

  return (
    <div className="page-container">
      {/* Cabeçalho */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ClipboardList size={26} /> Pedidos &amp; Programação de Embarque
          </h1>
          <p className="page-subtitle">
            Crie pedidos com os cortes solicitados para liberar automaticamente na Separação (Saída de Materiais) e emitir Folha do Pedido / Romaneio.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${aba === 'GERENCIADOR' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setAba('GERENCIADOR')}
          >
            <ClipboardList size={16} /> Gerenciador de Pedidos
          </button>
          <button
            type="button"
            className={`btn ${aba === 'FORM' ? 'btn--primary' : 'btn--success'}`}
            onClick={abrirNovoPedido}
          >
            <Plus size={16} /> Novo Pedido
          </button>
        </div>
      </div>

      {aba === 'GERENCIADOR' && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Liberados p/ Separação</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#38bdf8' }}>{kpis.liberados}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Em Separação na Câmara</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#f59e0b' }}>{kpis.emSeparacao}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Prontos / Em Conferência</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#a78bfa' }}>{kpis.emConferencia}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Pedidos Expedidos</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#22c55e' }}>{kpis.expedidos}</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="card" style={{ marginBottom: '16px', padding: '14px' }}>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                carregarDados()
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}
            >
              <div style={{ flex: '1 1 240px' }}>
                <label className="form-label">Buscar Pedido / Título / Cliente</label>
                <input
                  className="form-input"
                  placeholder="PED-0001, Título, BEEF CONTAINER..."
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                />
              </div>
              <div style={{ flex: '0 1 210px' }}>
                <label className="form-label">Status</label>
                <select className="form-input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                  <option value="TODOS">Todos os Status</option>
                  <option value="RASCUNHO">Rascunho</option>
                  <option value="LIBERADO">Liberado p/ Separação</option>
                  <option value="EM_SEPARACAO">Em Separação</option>
                  <option value="AGUARDANDO_CONFERENCIA">Separação Finalizada</option>
                  <option value="EM_CONFERENCIA">Em Conferência</option>
                  <option value="EXPEDIDO">Expedido</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>
              <div>
                <label className="form-label">De</label>
                <input type="date" className="form-input" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Até</label>
                <input type="date" className="form-input" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
              <button type="submit" className="btn btn--primary" disabled={loading}>
                <Search size={15} /> Filtrar
              </button>
              <button type="button" className="btn btn--secondary" onClick={carregarDados} disabled={loading}>
                <RefreshCw size={15} /> Atualizar
              </button>
            </form>
          </div>

          {/* Lista */}
          <div className="card">
            {pedidos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }} className="text-muted">
                <Package size={40} style={{ opacity: 0.4, margin: '0 auto 10px' }} />
                <div>Nenhum pedido encontrado para os filtros atuais.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Título (Romaneio) / Cliente</th>
                      <th>Status</th>
                      <th>Romaneio</th>
                      <th style={{ textAlign: 'right' }}>Pedido</th>
                      <th style={{ textAlign: 'right' }}>Separado</th>
                      <th>Conferência</th>
                      <th>Previsão</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((ped) => {
                      const st = STATUS_BADGE[ped.status] || { label: ped.status, cls: 'badge--neutral' }
                      const pct =
                        Number(ped.total_kg_solicitado) > 0
                          ? Math.min(100, Math.round((Number(ped.total_kg_separado) / Number(ped.total_kg_solicitado)) * 100))
                          : 0
                      const podeImprimirRomaneio =
                        Boolean(ped.romaneio_id) &&
                        ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(ped.status)

                      return (
                        <tr key={ped.id}>
                          <td className="font-mono font-bold">{ped.codigo}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{ped.titulo}</div>
                            <div className="text-muted text-xs">
                              {ped.cliente || 'BEEF CONTAINER LIMITADA'} • Criado em {fmtDataHora(ped.created_at)} por {ped.criado_por_nome || '-'}
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="font-mono">
                            {ped.romaneio_codigo ? (
                              <span style={{ fontWeight: 700 }}>{ped.romaneio_codigo}</span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {fmtKg(ped.total_kg_solicitado)}
                            <div className="text-muted text-xs">{ped.qtd_itens} produto(s)</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700 }}>
                              {fmtKg(ped.total_kg_separado)} ({ped.total_caixas_separadas} cx)
                            </div>
                            <div style={{ width: '100px', height: '5px', background: '#1e293b', borderRadius: '999px', marginLeft: 'auto', marginTop: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#38bdf8' }} />
                            </div>
                          </td>
                          <td>
                            {ped.total_caixas_separadas > 0 ? (
                              <span className="text-xs font-mono">
                                {ped.qtd_conferidas}/{ped.total_caixas_separadas} cx
                              </span>
                            ) : (
                              <span className="text-muted text-xs">-</span>
                            )}
                          </td>
                          <td>{fmtData(ped.previsao_entrega)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                title="Ver detalhes do pedido"
                                onClick={() => handleVerDetalhes(ped.id)}
                              >
                                <Eye size={14} /> Detalhes
                              </button>
                              <button
                                type="button"
                                className="btn btn--secondary btn--sm"
                                title="Imprimir Folha do Pedido"
                                onClick={() => handleImprimirFolhaPedido(ped.id)}
                              >
                                <Printer size={14} /> Folha Pedido
                              </button>
                              {podeImprimirRomaneio && (
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  title="Imprimir Romaneio de Embarque"
                                  onClick={() => handleImprimirRomaneioEmbarque(ped)}
                                >
                                  <Truck size={14} /> Romaneio
                                </button>
                              )}
                              {ped.status === 'RASCUNHO' && (
                                <button
                                  type="button"
                                  className="btn btn--success btn--sm"
                                  title="Liberar para Separação"
                                  onClick={() => handleLiberar(ped)}
                                >
                                  <Send size={14} /> Liberar
                                </button>
                              )}
                              {['RASCUNHO', 'LIBERADO'].includes(ped.status) && (
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  title="Editar Pedido"
                                  onClick={() => abrirEditarPedido(ped.id)}
                                >
                                  <Edit3 size={14} /> Editar
                                </button>
                              )}
                              {!['EXPEDIDO', 'CANCELADO'].includes(ped.status) && (
                                <button
                                  type="button"
                                  className="btn btn--danger btn--sm"
                                  title="Cancelar Pedido"
                                  onClick={() => handleCancelar(ped)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {aba === 'FORM' && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0 }}>{editId ? `Editando Pedido ${editCodigo}` : 'Novo Pedido de Saída'}</h2>
              <p className="text-muted text-xs" style={{ marginTop: '4px' }}>
                Localize os produtos pelo código, pela descrição com autocomplete ou pela lupa, escolha KG ou CX e acompanhe o saldo projetado na hora.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                resetarFormulario()
                setAba('GERENCIADOR')
              }}
            >
              Voltar ao Gerenciador
            </button>
          </div>

          {/* Cartão automático do Cliente Padrão (BEEF CONTAINER LIMITADA) + opção futura de troca/cadastro */}
          <div
            style={{
              background: 'rgba(13, 20, 36, 0.72)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '16px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                  Cliente Destinatário (Pré-selecionado automaticamente)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="badge badge--info font-mono">Cód. {clienteAtivo?.codigo || '737'}</span>
                  <strong style={{ fontSize: '15px', color: '#f8fafc' }}>
                    {clienteAtivo?.razao_social || 'BEEF CONTAINER LIMITADA'}
                  </strong>
                  {Number(clienteAtivo?.is_padrao) === 1 && (
                    <span className="badge badge--success">Cliente Padrão</span>
                  )}
                </div>
                <div className="text-xs text-muted" style={{ marginTop: '4px', lineHeight: 1.5 }}>
                  CNPJ: <span className="font-mono">{clienteAtivo?.cnpj_cpf || '54.142.043/0001-30'}</span>
                  {' • '}IE: <span className="font-mono">{clienteAtivo?.inscricao_estadual || '513236396113'}</span>
                  {' • '}ICMS: {clienteAtivo?.icms || 'CONTRIBUINTE'}
                  <br />
                  Endereço: {clienteAtivo?.endereco || 'DOUTOR HEITOR NASCIMENTO DE 3/4 A 598/599'}
                  {clienteAtivo?.numero ? `, Nº ${clienteAtivo.numero}` : ', Nº 581'}
                  {clienteAtivo?.bairro ? ` • ${clienteAtivo.bairro}` : ' • MORUMBI'}
                  {' • '}
                  {clienteAtivo?.cidade || 'PAULINIA'}/{clienteAtivo?.uf || 'SP'}
                  {' • '}CEP: <span className="font-mono">{clienteAtivo?.cep || '13140-729'}</span>
                  {clienteAtivo?.telefone ? ` • Fone: ${clienteAtivo.telefone}` : ' • Fone: (19)99199-231'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setMostrarTrocaCliente((v) => !v)}
                >
                  {mostrarTrocaCliente ? 'Fechar Seleção' : 'Alterar / Cadastrar Cliente'}
                </button>
              </div>
            </div>

            {mostrarTrocaCliente && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 280px' }}>
                  <label className="form-label">Selecionar Cliente Cadastrado</label>
                  <select
                    className="form-input"
                    value={clienteIdSelecionado || ''}
                    onChange={(e) => setClienteIdSelecionado(Number(e.target.value))}
                  >
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo ? `[${c.codigo}] ` : ''}{c.razao_social} ({c.cidade}/{c.uf})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setModalNovoClienteAberto(true)}
                >
                  <Plus size={14} /> Novo Cliente
                </button>
              </div>
            )}
          </div>

          {/* Dados principais */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Título do Pedido (sai no Romaneio e na Folha do Pedido) *</label>
              <input
                className="form-input"
                placeholder="Ex: Carga Quinta-feira / Pedido Semana 46"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Previsão de Coleta</label>
              <input
                type="date"
                className="form-input"
                value={previsaoEntrega}
                onChange={(e) => setPrevisaoEntrega(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label className="form-label">Observações do Pedido</label>
            <input
              className="form-input"
              placeholder="Instruções especiais de separação, horário de coleta, etc."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>

          {/* ── Novo Seletor Dinâmico de Produtos (Código + Autocomplete + Lupa + KG/CX) ── */}
          <div
            style={{
              background: 'rgba(13, 20, 36, 0.9)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={17} className="text-info" />
                Lançar Item do Cadastro de Produtos
              </div>
              <span className="text-xs text-muted">
                Digite o <strong>Código</strong>, pesquise na <strong>Descrição</strong> ou clique na <strong>Lupa</strong>
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '145px minmax(260px, 1.8fr) 205px minmax(140px, 1fr) auto',
                gap: '10px',
                alignItems: 'end'
              }}
            >
              {/* 1. Campo Código */}
              <div>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Código</span>
                  {produtoSelecionado && (
                    <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '11px' }}>✓ OK</span>
                  )}
                </label>
                <input
                  ref={codigoRef}
                  className="form-input font-mono"
                  placeholder="Ex: 5897"
                  value={codigoInput}
                  onChange={(e) => handleCodigoChange(e.target.value)}
                  onKeyDown={handleCodigoKeyDown}
                />
              </div>

              {/* 2. Campo Descrição com Autocomplete + 3. Botão Lupa */}
              <div style={{ position: 'relative' }}>
                <label className="form-label">Descrição do Produto *</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      ref={descricaoRef}
                      className="form-input"
                      placeholder="Comece a digitar o nome do produto..."
                      value={descricaoInput}
                      onFocus={() => setMostrarSugestoes(true)}
                      onBlur={() => setTimeout(() => setMostrarSugestoes(false), 160)}
                      onChange={(e) => handleDescricaoChange(e.target.value)}
                      onKeyDown={handleDescricaoKeyDown}
                      style={{
                        paddingRight: descricaoInput ? '30px' : undefined,
                        borderColor: produtoSelecionado ? 'var(--success)' : undefined
                      }}
                    />
                    {descricaoInput && (
                      <button
                        type="button"
                        title="Limpar seleção"
                        onClick={() => limparCamposItem(false)}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '2px'
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn--secondary btn--icon"
                    title="Pesquisar produto na tabela completa (Lupa)"
                    onClick={() => {
                      setModalBuscaTexto(descricaoInput || codigoInput || '')
                      setModalBuscaAberto(true)
                    }}
                    style={{ height: '40px', width: '42px', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Search size={17} />
                  </button>
                </div>

                {/* Lista de Sugestões de Autocomplete */}
                {mostrarSugestoes && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: '48px',
                      zIndex: 80,
                      background: '#0f172a',
                      border: '1px solid var(--accent)',
                      borderRadius: '10px',
                      boxShadow: '0 16px 36px rgba(0,0,0,0.75)',
                      maxHeight: '290px',
                      overflowY: 'auto'
                    }}
                  >
                    {sugestoesProdutos.length === 0 ? (
                      <div style={{ padding: '12px 14px', fontSize: '12.5px', color: '#94a3b8' }}>
                        Nenhum produto encontrado para "{descricaoInput}". Use a lupa para explorar o cadastro.
                      </div>
                    ) : (
                      sugestoesProdutos.map((p, idx) => {
                        const ativo = idx === indiceSugestao
                        const temSaldo = Number(p.saldo_kg || 0) > 0
                        return (
                          <div
                            key={p.id}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              aplicarProdutoSelecionado(p, true)
                            }}
                            onMouseEnter={() => setIndiceSugestao(idx)}
                            style={{
                              padding: '9px 12px',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '10px',
                              borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
                              background: ativo ? 'rgba(59, 130, 246, 0.22)' : 'transparent'
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: '#38bdf8',
                                    background: 'rgba(56, 189, 248, 0.14)',
                                    padding: '1px 6px',
                                    borderRadius: '4px'
                                  }}
                                >
                                  {p.codigo || 'S/C'}
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {p.descricao}
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, fontSize: '11.5px', fontFamily: 'var(--font-mono)' }}>
                              <span style={{ color: temSaldo ? '#4ade80' : '#94a3b8', fontWeight: 700 }}>
                                {fmtKg(p.saldo_kg)}
                              </span>
                              <span style={{ color: '#94a3b8', marginLeft: '6px' }}>({p.qtd_caixas} cx)</span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              {/* 4. Quantidade + Seletor KG / CX */}
              <div>
                <label className="form-label">Quantidade ({unidadeInput}) *</label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                  <input
                    ref={qtdRef}
                    type="number"
                    step={unidadeInput === 'KG' ? '0.01' : '1'}
                    min="0.01"
                    className="form-input font-mono"
                    placeholder={unidadeInput === 'KG' ? 'Ex: 40' : 'Ex: 2'}
                    value={qtdInput}
                    onChange={(e) => setQtdInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAdicionarItem()
                      }
                    }}
                    style={{ flex: 1, minWidth: '80px', fontWeight: 700 }}
                  />
                  <div
                    style={{
                      display: 'inline-flex',
                      background: 'var(--bg-1)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '2px',
                      gap: '2px'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleTrocarUnidade('KG')}
                      style={{
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0 10px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: unidadeInput === 'KG' ? 'var(--accent)' : 'transparent',
                        color: unidadeInput === 'KG' ? '#ffffff' : 'var(--text-secondary)'
                      }}
                    >
                      KG
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTrocarUnidade('CX')}
                      style={{
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0 10px',
                        fontSize: '12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                        background: unidadeInput === 'CX' ? 'var(--accent)' : 'transparent',
                        color: unidadeInput === 'CX' ? '#ffffff' : 'var(--text-secondary)'
                      }}
                    >
                      CX
                    </button>
                  </div>
                </div>
              </div>

              {/* 5. Observação do item */}
              <div>
                <label className="form-label">Obs. do Item</label>
                <input
                  className="form-input"
                  placeholder="Opcional"
                  value={obsItemInput}
                  onChange={(e) => setObsItemInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAdicionarItem()
                    }
                  }}
                />
              </div>

              <button type="button" className="btn btn--primary" style={{ height: '40px' }} onClick={handleAdicionarItem}>
                <Plus size={16} /> Adicionar
              </button>
            </div>

            {/* Painel Dinâmico de Estoque Atual, Conversão KG<->CX e Saldo Projetado */}
            {produtoSelecionado && conversaoItem && (
              <div
                style={{
                  marginTop: '14px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: '#0d1526',
                  border:
                    (unidadeInput === 'KG' ? conversaoItem.projetadoKg : conversaoItem.projetadoCx) < 0
                      ? '1px solid #f59e0b'
                      : '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
                  <div>
                    <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Produto Selecionado
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: '#f8fafc' }}>
                      {produtoSelecionado.codigo ? `[${produtoSelecionado.codigo}] ` : ''}
                      {produtoSelecionado.descricao}
                    </div>
                    <div className="text-xs" style={{ color: '#94a3b8', marginTop: '2px' }}>
                      Cadastro: <strong>{produtoSelecionado.unidade || 'CX'}</strong>
                      {conversaoItem.pesoMedioCadastro > 0 ? (
                        <>
                          {' '}• Peso médio/cx: <strong>{conversaoItem.pesoMedioCadastro.toFixed(2)} kg/cx</strong>
                        </>
                      ) : (
                        <> • Sem peso médio histórico de caixa</>
                      )}
                    </div>
                  </div>

                  {/* Estoque Atual na Unidade Selecionada */}
                  <div style={{ paddingLeft: '14px', borderLeft: '1px solid var(--border)' }}>
                    <div className="text-xs text-muted" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {unidadeInput === 'KG' ? <Scale size={12} /> : <Box size={12} />}
                      ESTOQUE ATUAL ({unidadeInput})
                    </div>
                    <div className="font-mono" style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8' }}>
                      {unidadeInput === 'KG' ? fmtKg(conversaoItem.saldoAtualKg) : fmtCx(conversaoItem.saldoAtualCx)}
                    </div>
                    <div className="text-xs text-muted font-mono">
                      {unidadeInput === 'KG'
                        ? `Equiv.: ${fmtCx(conversaoItem.saldoAtualCx)}`
                        : `Equiv.: ${fmtKg(conversaoItem.saldoAtualKg)}`}
                    </div>
                  </div>

                  {/* Este Lançamento + Equivalente */}
                  <div style={{ paddingLeft: '14px', borderLeft: '1px solid var(--border)' }}>
                    <div className="text-xs text-muted">SOLICITADO NESTE ITEM</div>
                    <div className="font-mono" style={{ fontSize: '18px', fontWeight: 800, color: '#e2e8f0' }}>
                      {unidadeInput === 'KG' ? fmtKg(conversaoItem.lancamentoKg) : fmtCx(conversaoItem.lancamentoCx)}
                    </div>
                    <div className="text-xs text-muted font-mono">
                      {conversaoItem.pesoPorCx > 0
                        ? unidadeInput === 'KG'
                          ? `≈ ${fmtCx(conversaoItem.lancamentoCx)}`
                          : `≈ ${fmtKg(conversaoItem.lancamentoKg)}`
                        : 'Conversão p/ cx indisponível'}
                    </div>
                  </div>

                  {/* Saldo Projetado Após Pedido na Unidade Selecionada */}
                  <div style={{ paddingLeft: '14px', borderLeft: '1px solid var(--border)' }}>
                    <div className="text-xs text-muted">PROJETADO APÓS PEDIDO ({unidadeInput})</div>
                    {(() => {
                      const valProj = unidadeInput === 'KG' ? conversaoItem.projetadoKg : conversaoItem.projetadoCx
                      const negativo = valProj < 0
                      return (
                        <>
                          <div
                            className="font-mono"
                            style={{
                              fontSize: '18px',
                              fontWeight: 800,
                              color: negativo ? '#fbbf24' : '#4ade80'
                            }}
                          >
                            {unidadeInput === 'KG' ? fmtKg(conversaoItem.projetadoKg) : fmtCx(conversaoItem.projetadoCx)}
                          </div>
                          <div className="text-xs font-mono" style={{ color: negativo ? '#fcd34d' : '#94a3b8' }}>
                            {unidadeInput === 'KG'
                              ? conversaoItem.pesoPorCx > 0
                                ? `≈ ${fmtCx(conversaoItem.projetadoCx)}`
                                : ''
                              : `≈ ${fmtKg(conversaoItem.projetadoKg)}`}
                            {conversaoItem.kgJaNoPedido > 0 && ` (inclui ${fmtKg(conversaoItem.kgJaNoPedido)} já no pedido)`}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* Fallback manual caso o usuário selecione CX para produto que nunca teve caixa pesada */}
                {conversaoItem.precisaPesoManualCx && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: '#2c1f09',
                      border: '1px solid #f59e0b',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      color: '#fde68a'
                    }}
                  >
                    <AlertTriangle size={16} />
                    <span className="text-xs">Sem histórico de peso/cx. Informe kg por caixa:</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="form-input font-mono"
                      placeholder="Ex: 20"
                      value={pesoManualCxInput}
                      onChange={(e) => setPesoManualCxInput(e.target.value)}
                      style={{ width: '90px', height: '32px', padding: '4px 8px' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Lista de itens */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <strong>Itens do Pedido ({itensForm.length})</strong>
              <span className="font-mono font-bold">
                Total Solicitado: {fmtKg(totalFormKg)} {totalFormCx > 0 ? `• ~${fmtCx(totalFormCx)}` : ''}
              </span>
            </div>

            {itensForm.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '20px', textAlign: 'center', border: '1px dashed rgba(148, 163, 184, 0.3)', borderRadius: '6px' }}>
                Nenhum item adicionado ainda. Use os campos acima (Código, Descrição ou Lupa) para incluir os produtos solicitados.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Estoque Atual</th>
                      <th style={{ width: '140px' }}>Kg Solicitado *</th>
                      <th style={{ width: '110px' }}>Cx Previstas</th>
                      <th style={{ textAlign: 'right' }}>Saldo Projetado</th>
                      <th>Obs.</th>
                      <th style={{ textAlign: 'right' }}>Remover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensForm.map((item, idx) => {
                      const kgNum = Number(String(item.qtd_kg_solicitada).replace(',', '.') || 0)
                      const cxNum = Number(String(item.qtd_caixas_solicitada).replace(',', '.') || 0)
                      const projKg = Number((Number(item.saldo_kg || 0) - kgNum).toFixed(2))
                      const projCx = Number((Number(item.qtd_caixas_estoque || 0) - cxNum).toFixed(2))
                      const abaixoEstoque = projKg < 0
                      return (
                        <tr key={item.produto_id}>
                          <td className="font-mono">{item.produto_codigo || '-'}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{item.produto_descricao}</div>
                            {abaixoEstoque && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  marginTop: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: '#2c1f09',
                                  border: '1px solid #f59e0b',
                                  color: '#fde68a',
                                  fontSize: '11px',
                                  fontWeight: 600
                                }}
                              >
                                <AlertTriangle size={12} /> Solicitado acima do estoque atual
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            <div>{fmtKg(item.saldo_kg)}</div>
                            <div className="text-xs text-muted">{fmtCx(item.qtd_caixas_estoque)}</div>
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              className="form-input font-mono"
                              value={item.qtd_kg_solicitada}
                              onChange={(e) => {
                                const v = e.target.value
                                const kg = Number(String(v).replace(',', '.') || 0)
                                setItensForm((prev) =>
                                  prev.map((r, i) => {
                                    if (i !== idx) return r
                                    const pm = Number(r.peso_medio_cx || 0)
                                    return {
                                      ...r,
                                      qtd_kg_solicitada: v,
                                      unidade_solicitada: 'KG',
                                      qtd_solicitada_exibicao: kg > 0 ? kg : r.qtd_solicitada_exibicao,
                                      qtd_caixas_solicitada: pm > 0 && kg > 0 ? String(Math.max(1, Math.round(kg / pm))) : r.qtd_caixas_solicitada
                                    }
                                  })
                                )
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              className="form-input font-mono"
                              value={item.qtd_caixas_solicitada}
                              onChange={(e) => {
                                const v = e.target.value
                                setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, qtd_caixas_solicitada: v } : r)))
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            <div style={{ fontWeight: 700, color: projKg < 0 ? '#fbbf24' : '#4ade80' }}>
                              {fmtKg(projKg)}
                            </div>
                            <div className="text-xs" style={{ color: projCx < 0 ? '#fcd34d' : '#94a3b8' }}>
                              {item.qtd_caixas_solicitada ? fmtCx(projCx) : '-'}
                            </div>
                          </td>
                          <td>
                            <input
                              className="form-input"
                              value={item.observacao}
                              onChange={(e) => {
                                const v = e.target.value
                                setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, observacao: v } : r)))
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              onClick={() => setItensForm((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => handleSalvarPedido(false)}>
              Salvar como Rascunho
            </button>
            <button type="button" className="btn btn--success" disabled={loading} onClick={() => handleSalvarPedido(true)}>
              <Send size={16} /> Liberar Pedido para Separação
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════ MODAL LUPA: TABELA DE PRODUTOS ══════════════════ */}
      {modalBuscaAberto && (
        <div
          className="modal-overlay"
          style={{ padding: '16px' }}
          onClick={() => setModalBuscaAberto(false)}
        >
          <div
            className="card"
            style={{ width: '960px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={19} className="text-info" /> Pesquisar Produto no Cadastro
                </h2>
                <div className="text-muted text-xs" style={{ marginTop: '2px' }}>
                  Clique em qualquer linha para selecionar o produto automaticamente.
                </div>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalBuscaAberto(false)}>
                <X size={15} /> Fechar
              </button>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px' }}>
                <input
                  ref={modalBuscaRef}
                  className="form-input"
                  placeholder="Filtrar por código, EAN, descrição ou grupo..."
                  value={modalBuscaTexto}
                  onChange={(e) => setModalBuscaTexto(e.target.value)}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={modalSomenteComSaldo}
                  onChange={(e) => setModalSomenteComSaldo(e.target.checked)}
                />
                Somente com saldo disponível (&gt; 0)
              </label>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: '8px' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '110px' }}>Código</th>
                    <th>Descrição</th>
                    <th style={{ width: '75px' }}>Unid.</th>
                    <th style={{ textAlign: 'right', width: '120px' }}>Estoque (KG)</th>
                    <th style={{ textAlign: 'right', width: '95px' }}>Estoque (CX)</th>
                    <th style={{ textAlign: 'right', width: '110px' }}>Média kg/cx</th>
                    <th style={{ textAlign: 'right', width: '110px' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosModalFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '28px' }} className="text-muted">
                        Nenhum produto encontrado para o filtro informado.
                      </td>
                    </tr>
                  ) : (
                    produtosModalFiltrados.map((p) => (
                      <tr
                        key={p.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          aplicarProdutoSelecionado(p, true)
                          setModalBuscaAberto(false)
                        }}
                      >
                        <td className="font-mono font-bold" style={{ color: '#38bdf8' }}>{p.codigo || '-'}</td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{p.descricao}</div>
                          {p.grupo && <div className="text-xs text-muted">{p.grupo}</div>}
                        </td>
                        <td className="font-mono">{p.unidade || 'CX'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: Number(p.saldo_kg) > 0 ? '#4ade80' : '#94a3b8' }} className="font-mono">
                          {fmtKg(p.saldo_kg)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{fmtCx(p.qtd_caixas)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-muted">
                          {Number(p.peso_medio_cx) > 0 ? `${Number(p.peso_medio_cx).toFixed(2)} kg` : '-'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn--primary btn--sm">
                            Selecionar
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

      {/* Modal de Detalhes do Pedido */}
      {pedidoDetalhe && (
        <div
          className="modal-overlay"
          style={{ padding: '16px' }}
        >
          <div className="card" style={{ width: '920px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {pedidoDetalhe.codigo} — {pedidoDetalhe.titulo}
                </h2>
                <div className="text-muted text-xs" style={{ marginTop: '4px' }}>
                  Cliente: {pedidoDetalhe.cliente} • Status:{' '}
                  <strong>{STATUS_BADGE[pedidoDetalhe.status]?.label || pedidoDetalhe.status}</strong>
                  {pedidoDetalhe.romaneio_codigo ? ` • Romaneio: ${pedidoDetalhe.romaneio_codigo}` : ''}
                </div>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPedidoDetalhe(null)}>
                <X size={16} /> Fechar
              </button>
            </div>

            <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Itens Solicitados × Separados</h3>
            <table className="table" style={{ marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Produto</th>
                  <th style={{ textAlign: 'right' }}>Pedido</th>
                  <th style={{ textAlign: 'right' }}>Separado</th>
                  <th style={{ textAlign: 'center' }}>Caixas</th>
                  <th style={{ textAlign: 'center' }}>Conferidas</th>
                </tr>
              </thead>
              <tbody>
                {(pedidoDetalhe.itens || []).map((it) => (
                  <tr key={it.id}>
                    <td className="font-mono">{it.produto_codigo || '-'}</td>
                    <td style={{ fontWeight: 700 }}>{it.produto_descricao}</td>
                    <td style={{ textAlign: 'right' }}>{fmtKg(it.qtd_kg_solicitada)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(it.kg_separado)}</td>
                    <td style={{ textAlign: 'center' }}>{it.caixas_separadas} cx</td>
                    <td style={{ textAlign: 'center' }}>{it.caixas_conferidas}/{it.caixas_separadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pedidoDetalhe.caixas?.length > 0 && (
              <>
                <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>
                  Caixas Separadas ({pedidoDetalhe.caixas.length})
                </h3>
                <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>EAN Caixa</th>
                        <th>Lote</th>
                        <th>Validade</th>
                        <th style={{ textAlign: 'right' }}>Peso</th>
                        <th style={{ textAlign: 'center' }}>Conferência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidoDetalhe.caixas.map((cx) => (
                        <tr key={cx.id}>
                          <td>
                            {cx.produto_descricao}
                            {Number(cx.extra_fora_pedido) === 1 && (
                              <span className="badge badge--warning" style={{ marginLeft: '6px' }}>Extra</span>
                            )}
                          </td>
                          <td className="font-mono">{cx.ean_caixa}</td>
                          <td className="font-mono">{cx.lote || '-'}</td>
                          <td>{fmtData(cx.validade)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtKg(cx.peso_kg)}</td>
                          <td style={{ textAlign: 'center' }}>
                            {Number(cx.conferido) === 1 ? (
                              <span className="badge badge--success">Conferida</span>
                            ) : (
                              <span className="badge badge--neutral">Pendente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setPrintPedido(pedidoDetalhe)
                }}
              >
                <Printer size={15} /> Imprimir Folha do Pedido
              </button>
              {pedidoDetalhe.romaneio_id &&
                ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(pedidoDetalhe.status) && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={async () => {
                      const rom = await saidaQueries.detalhesRomaneio(pedidoDetalhe.romaneio_id)
                      setPrintRomaneio(rom)
                    }}
                  >
                    <Truck size={15} /> Imprimir Romaneio de Embarque
                  </button>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Modal para Cadastro Futuro de Outros Clientes */}
      {modalNovoClienteAberto && (
        <div className="modal-overlay" style={{ padding: '16px' }} onClick={() => setModalNovoClienteAberto(false)}>
          <form
            className="card"
            style={{ width: '740px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSalvarNovoCliente}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Cadastrar Novo Cliente</h2>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setModalNovoClienteAberto(false)}>
                <X size={15} /> Fechar
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">Código</label>
                <input className="form-input font-mono" value={novoCliForm.codigo} onChange={(e) => setNovoCliForm({ ...novoCliForm, codigo: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Razão Social *</label>
                <input className="form-input" required value={novoCliForm.razao_social} onChange={(e) => setNovoCliForm({ ...novoCliForm, razao_social: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Nome Fantasia</label>
                <input className="form-input" value={novoCliForm.nome_fantasia} onChange={(e) => setNovoCliForm({ ...novoCliForm, nome_fantasia: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">CPF / CNPJ</label>
                <input className="form-input font-mono" value={novoCliForm.cnpj_cpf} onChange={(e) => setNovoCliForm({ ...novoCliForm, cnpj_cpf: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Inscrição Estadual</label>
                <input className="form-input font-mono" value={novoCliForm.inscricao_estadual} onChange={(e) => setNovoCliForm({ ...novoCliForm, inscricao_estadual: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Telefone</label>
                <input className="form-input font-mono" value={novoCliForm.telefone} onChange={(e) => setNovoCliForm({ ...novoCliForm, telefone: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label className="form-label">Endereço</label>
                <input className="form-input" value={novoCliForm.endereco} onChange={(e) => setNovoCliForm({ ...novoCliForm, endereco: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Número</label>
                <input className="form-input" value={novoCliForm.numero} onChange={(e) => setNovoCliForm({ ...novoCliForm, numero: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Bairro</label>
                <input className="form-input" value={novoCliForm.bairro} onChange={(e) => setNovoCliForm({ ...novoCliForm, bairro: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 140px 1fr', gap: '10px', marginBottom: '16px' }}>
              <div>
                <label className="form-label">Cidade</label>
                <input className="form-input" value={novoCliForm.cidade} onChange={(e) => setNovoCliForm({ ...novoCliForm, cidade: e.target.value })} />
              </div>
              <div>
                <label className="form-label">UF</label>
                <input className="form-input" maxLength={2} value={novoCliForm.uf} onChange={(e) => setNovoCliForm({ ...novoCliForm, uf: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="form-label">CEP</label>
                <input className="form-input font-mono" value={novoCliForm.cep} onChange={(e) => setNovoCliForm({ ...novoCliForm, cep: e.target.value })} />
              </div>
              <div>
                <label className="form-label">ICMS</label>
                <input className="form-input" value={novoCliForm.icms} onChange={(e) => setNovoCliForm({ ...novoCliForm, icms: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn--secondary" onClick={() => setModalNovoClienteAberto(false)}>Cancelar</button>
              <button type="submit" className="btn btn--success">Salvar Cliente</button>
            </div>
          </form>
        </div>
      )}

      {printPedido && (
        <FolhaPedidoPrint pedido={printPedido} onClose={() => setPrintPedido(null)} />
      )}
      {printRomaneio && (
        <RomaneioEmbarquePrint romaneio={printRomaneio} onClose={() => setPrintRomaneio(null)} />
      )}
    </div>
  )
}
