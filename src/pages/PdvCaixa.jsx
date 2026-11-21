import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  BookOpen,
  CheckCircle2,
  Copy,
  CreditCard,
  DollarSign,
  Lock,
  Percent,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { varejoQueries } from '../queries/varejo'
import { cadastrosQueries } from '../queries/cadastros'
import { useAppStore } from '../store/appStore'
import { ConfigEstacaoModal } from '../components/shared/ConfigEstacaoModal'
import { lerConfigEstacao } from '../utils/estacaoConfig'
import { imprimirCupomVendaTermico, imprimirReciboCrediarioTermico } from '../utils/impressaoTermica'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtDataHora = (s) => {
  if (!s) return '-'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('pt-BR')
}

const FORMAS_PAG = [
  { id: 'DINHEIRO', label: 'Dinheiro', icon: Banknote, cor: '#22c55e' },
  { id: 'PIX', label: 'PIX (QR Code)', icon: QrCode, cor: '#06b6d4' },
  { id: 'DEBITO', label: 'Débito', icon: CreditCard, cor: '#3b82f6' },
  { id: 'CREDITO', label: 'Crédito', icon: CreditCard, cor: '#a855f7' },
  { id: 'CREDIARIO', label: 'Crediário', icon: BookOpen, cor: '#f59e0b' },
]

export function PdvCaixa() {
  const { operador, filiaisDisponiveis, filialAtivaId, toastSuccess, toastError, toastWarning } = useAppStore()

  const filialAtual = useMemo(
    () => (filiaisDisponiveis || []).find((f) => String(f.id) === String(filialAtivaId)),
    [filiaisDisponiveis, filialAtivaId],
  )

  const [loading, setLoading] = useState(true)
  const [caixa, setCaixa] = useState(null)
  const [vendasTurno, setVendasTurno] = useState([])
  const [contasBancarias, setContasBancarias] = useState([])
  const [clientesLista, setClientesLista] = useState([])

  // Abertura / Fechamento / Movimento
  const [saldoAbertura, setSaldoAbertura] = useState('200.00')
  const [contaSelecionada, setContaSelecionada] = useState('')
  const [modalMov, setModalMov] = useState(null) // 'SANGRIA' | 'SUPRIMENTO' | 'FECHAR' | 'VENDAS'
  const [movValor, setMovValor] = useState('')
  const [movMotivo, setMovMotivo] = useState('')
  const [saldoInformadoFech, setSaldoInformadoFech] = useState('')
  const [modalEstacao, setModalEstacao] = useState(false)

  // Carrinho PDV
  const [codigoInput, setCodigoInput] = useState('')
  const [sugestoes, setSugestoes] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [carrinho, setCarrinho] = useState([])
  const [emitirNfce, setEmitirNfce] = useState(true)

  // Cliente & Desconto
  const [clienteSel, setClienteSel] = useState(null)
  const [modalCliente, setModalCliente] = useState(false)
  const [buscaCliente, setBuscaCliente] = useState('')

  const [modalDesconto, setModalDesconto] = useState(false)
  const [descTipo, setDescTipo] = useState('PCT') // 'PCT' | 'VALOR'
  const [descInput, setDescInput] = useState('')
  const [descontoAplicado, setDescontoAplicado] = useState({ tipo: 'VALOR', pct: 0, valor: 0 })

  // Modal de Finalização / Pagamentos (abre SOMENTE ao clicar Finalizar Compra)
  const [modalPagamento, setModalPagamento] = useState(false)
  const [formaAtiva, setFormaAtiva] = useState('DINHEIRO')
  const [valorFormaInput, setValorFormaInput] = useState('')
  const [pagamentos, setPagamentos] = useState([])
  const [finalizando, setFinalizando] = useState(false)
  const [buscaCrediario, setBuscaCrediario] = useState('')

  // PIX QR Code nativo
  const [pixInfo, setPixInfo] = useState(null)
  const [pixQrUrl, setPixQrUrl] = useState('')
  const [gerandoPix, setGerandoPix] = useState(false)

  // Última venda concluída (para reimpressão rápida de Cupom / Comprovante Crediário)
  const [ultimaVenda, setUltimaVenda] = useState(null)

  const inputBuscaRef = useRef(null)
  const inputClienteRef = useRef(null)
  const inputDescRef = useRef(null)

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const [resCx, listaCli] = await Promise.all([
        varejoQueries.obterCaixaAtual(),
        cadastrosQueries.listarClientes().catch(() => []),
      ])
      setCaixa(resCx.caixa || null)
      setVendasTurno(resCx.vendas_turno || [])
      setContasBancarias(resCx.contas_bancarias || [])
      setClientesLista(Array.isArray(listaCli) ? listaCli : [])
      if (!contaSelecionada && resCx.contas_bancarias?.length) {
        const pad = resCx.contas_bancarias.find((c) => Number(c.padrao) === 1) || resCx.contas_bancarias[0]
        setContaSelecionada(pad.id)
      }
      // Atualiza dados de limite do cliente selecionado se houver
      setClienteSel((prev) => {
        if (!prev) return null
        return (listaCli || []).find((c) => c.id === prev.id) || prev
      })
    } catch (err) {
      toastError('Erro ao carregar PDV', err.message)
    } finally {
      setLoading(false)
    }
  }, [contaSelecionada, toastError])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  // Cálculos do carrinho
  const subtotal = useMemo(
    () => Number(carrinho.reduce((s, it) => s + Number(it.valor_total || 0), 0).toFixed(2)),
    [carrinho],
  )

  const descontoEfetivo = useMemo(() => {
    if (subtotal <= 0) return { valor: 0, pct: 0 }
    if (descontoAplicado.tipo === 'PCT' && descontoAplicado.pct > 0) {
      const v = Number(((subtotal * descontoAplicado.pct) / 100).toFixed(2))
      return { valor: Math.min(subtotal, v), pct: descontoAplicado.pct }
    }
    if (descontoAplicado.valor > 0) {
      const v = Math.min(subtotal, Number(descontoAplicado.valor))
      const p = subtotal > 0 ? Number(((v / subtotal) * 100).toFixed(2)) : 0
      return { valor: v, pct: p }
    }
    return { valor: 0, pct: 0 }
  }, [subtotal, descontoAplicado])

  const valorTotal = useMemo(
    () => Number(Math.max(0, subtotal - descontoEfetivo.valor).toFixed(2)),
    [subtotal, descontoEfetivo],
  )

  const clientePermiteDesconto = Boolean(
    clienteSel && Number(clienteSel.desconto_ativo) === 1 && Number(clienteSel.desconto_max_pct || 0) > 0,
  )

  // Se remover cliente ou trocar para um sem desconto, zera o desconto automaticamente
  useEffect(() => {
    if (!clientePermiteDesconto && (descontoAplicado.valor > 0 || descontoAplicado.pct > 0)) {
      setDescontoAplicado({ tipo: 'VALOR', pct: 0, valor: 0 })
    }
  }, [clientePermiteDesconto, descontoAplicado.valor, descontoAplicado.pct])

  const totalPago = useMemo(
    () => Number(pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0).toFixed(2)),
    [pagamentos],
  )
  const faltaPagar = useMemo(() => Number(Math.max(0, valorTotal - totalPago).toFixed(2)), [valorTotal, totalPago])
  const troco = useMemo(() => Number(Math.max(0, totalPago - valorTotal).toFixed(2)), [valorTotal, totalPago])

  // Atalhos de teclado globais do PDV (F2, F4, F6, F10, ESC)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!caixa) return
      if (e.key === 'Escape') {
        setModalCliente(false)
        setModalDesconto(false)
        setModalPagamento(false)
        setModalMov(null)
        setSugestoes([])
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        inputBuscaRef.current?.focus()
      } else if (e.key === 'F4') {
        e.preventDefault()
        setBuscaCliente('')
        setModalCliente(true)
      } else if (e.key === 'F6') {
        e.preventDefault()
        if (clientePermiteDesconto && subtotal > 0) {
          setDescTipo('PCT')
          setDescInput('')
          setModalDesconto(true)
        } else {
          toastWarning('Desconto bloqueado', 'Selecione primeiro um cliente cadastrado com desconto liberado (F4).')
        }
      } else if (e.key === 'F10') {
        e.preventDefault()
        if (carrinho.length > 0 && !modalPagamento) {
          abrirModalPagamento()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    if (modalCliente) setTimeout(() => inputClienteRef.current?.focus(), 60)
  }, [modalCliente])

  useEffect(() => {
    if (modalDesconto) setTimeout(() => inputDescRef.current?.focus(), 60)
  }, [modalDesconto])

  // Adicionar item ao carrinho
  const adicionarAoCarrinho = (item) => {
    setCarrinho((prev) => {
      // Etiqueta única do açougue (QR com serial) não agrupa e bloqueia duplicidade no carrinho
      if (item.etiqueta_acougue_id) {
        if (prev.some((x) => x.etiqueta_acougue_id === item.etiqueta_acougue_id)) {
          toastWarning('Etiqueta já no carrinho', `A etiqueta ${item.codigo_etiqueta} já foi bipada nesta compra.`)
          return prev
        }
        return [
          ...prev,
          {
            ...item,
            _key: `${item.etiqueta_acougue_id}`,
          },
        ]
      }
      if (item.origem_leitura === 'EAN_OU_CODIGO' || item.origem_leitura === 'BUSCA') {
        const idx = prev.findIndex(
          (x) => !x.etiqueta_acougue_id && x.produto_id === item.produto_id && x.unidade === item.unidade,
        )
        if (idx >= 0) {
          const clone = [...prev]
          const novoQtd = Number((Number(clone[idx].qtd) + Number(item.qtd || 1)).toFixed(3))
          clone[idx] = {
            ...clone[idx],
            qtd: novoQtd,
            valor_total: Number((novoQtd * Number(clone[idx].preco_unitario)).toFixed(2)),
          }
          return clone
        }
      }
      return [...prev, { ...item, _key: `${item.produto_id}-${Date.now()}-${Math.random()}` }]
    })
    setCodigoInput('')
    setSugestoes([])
    setTimeout(() => inputBuscaRef.current?.focus(), 30)
  }

  const handleBuscarOuBipar = async (e) => {
    e?.preventDefault()
    const q = codigoInput.trim()
    if (!q) return
    setBuscando(true)
    try {
      const res = await varejoQueries.buscarCodigoPdv(q)
      if (res.match_exato) {
        adicionarAoCarrinho(res.match_exato)
        if (res.origem === 'QR_ZEBRA_80X45') {
          toastSuccess(
            'Etiqueta QR Lida',
            `${res.match_exato.descricao} — ${Number(res.match_exato.qtd).toFixed(3)} kg • ${fmtMoeda(res.match_exato.valor_total)}`,
          )
        }
      } else if (res.sugestoes?.length === 1) {
        adicionarAoCarrinho(res.sugestoes[0])
      } else if (res.sugestoes?.length > 1) {
        setSugestoes(res.sugestoes)
      } else {
        toastWarning('Não encontrado', `Nenhum produto ou etiqueta para "${q}".`)
      }
    } catch (err) {
      toastError('Erro na leitura', err.message)
    } finally {
      setBuscando(false)
    }
  }

  const alterarQtdItem = (key, novaQtd) => {
    const q = Math.max(0.001, Number(novaQtd || 0))
    setCarrinho((prev) =>
      prev.map((it) =>
        it._key === key
          ? { ...it, qtd: Number(q.toFixed(3)), valor_total: Number((q * Number(it.preco_unitario)).toFixed(2)) }
          : it,
      ),
    )
  }

  const removerItem = (key) => {
    setCarrinho((prev) => prev.filter((it) => it._key !== key))
  }

  // Filtragem dinâmica de clientes (modal Cliente e aba Crediário)
  const clientesFiltrados = useMemo(() => {
    const q = buscaCliente.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clientesLista
      .filter((c) => Number(c.ativo ?? 1) === 1)
      .filter((c) => {
        if (!q) return true
        const nome = `${c.nome_fantasia || ''} ${c.razao_social || ''}`.toLowerCase()
        const doc = String(c.cnpj_cpf || '').replace(/\D/g, '')
        const rg = String(c.rg || '').replace(/\D/g, '')
        return nome.includes(q) || (digits && (doc.includes(digits) || rg.includes(digits)))
      })
      .slice(0, 40)
  }, [clientesLista, buscaCliente])

  const clientesCrediario = useMemo(() => {
    const q = buscaCrediario.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return clientesLista
      .filter((c) => Number(c.ativo ?? 1) === 1 && Number(c.crediario_ativo) === 1)
      .filter((c) => {
        if (!q) return true
        const nome = `${c.nome_fantasia || ''} ${c.razao_social || ''}`.toLowerCase()
        const doc = String(c.cnpj_cpf || '').replace(/\D/g, '')
        return nome.includes(q) || (digits && doc.includes(digits))
      })
  }, [clientesLista, buscaCrediario])

  // Aplicar Desconto no Modal
  const handleAplicarDesconto = (e) => {
    e?.preventDefault()
    if (!clientePermiteDesconto) {
      toastError('Desconto não permitido', 'Selecione um cliente com permissão de desconto.')
      return
    }
    const num = Number(String(descInput || '0').replace(',', '.'))
    if (!Number.isFinite(num) || num < 0) {
      toastError('Valor inválido', 'Informe um número válido.')
      return
    }
    if (num === 0) {
      setDescontoAplicado({ tipo: 'VALOR', pct: 0, valor: 0 })
      setModalDesconto(false)
      return
    }
    const maxPct = Number(clienteSel.desconto_max_pct || 0)
    const pctCalc = descTipo === 'PCT' ? num : subtotal > 0 ? Number(((num / subtotal) * 100).toFixed(2)) : 0
    if (pctCalc > maxPct + 0.01) {
      toastError(
        'Limite de desconto excedido',
        `O cliente ${clienteSel.nome_fantasia || clienteSel.razao_social} possui desconto máximo de ${maxPct.toFixed(1)}% (máx. ${fmtMoeda((subtotal * maxPct) / 100)}).`,
      )
      return
    }
    if (descTipo === 'PCT') {
      setDescontoAplicado({ tipo: 'PCT', pct: Number(num.toFixed(2)), valor: Number(((subtotal * num) / 100).toFixed(2)) })
    } else {
      setDescontoAplicado({ tipo: 'VALOR', pct: pctCalc, valor: Number(Math.min(subtotal, num).toFixed(2)) })
    }
    setModalDesconto(false)
    toastSuccess('Desconto aplicado', `${pctCalc.toFixed(1)}% (- ${fmtMoeda(descTipo === 'PCT' ? (subtotal * num) / 100 : Math.min(subtotal, num))})`)
  }

  // Abrir Modal de Pagamento
  const abrirModalPagamento = () => {
    if (carrinho.length === 0) {
      toastWarning('Carrinho vazio', 'Adicione itens antes de finalizar a compra.')
      return
    }
    setPagamentos([])
    setFormaAtiva('DINHEIRO')
    setValorFormaInput(valorTotal.toFixed(2))
    setPixInfo(null)
    setPixQrUrl('')
    setBuscaCrediario('')
    setModalPagamento(true)
  }

  // Gerar QR Code PIX automático ao selecionar PIX ou clicar em Gerar
  const gerarQrCodePix = async (valorAlvo) => {
    const v = Number(valorAlvo || faltaPagar || valorTotal)
    if (!Number.isFinite(v) || v <= 0) return
    setGerandoPix(true)
    try {
      const res = await varejoQueries.gerarPixPdv({ valor: v, descricao: `PDV ${caixa?.codigo || ''}` })
      setPixInfo(res.data)
      const dataUrl = await QRCode.toDataURL(res.data.payload, {
        width: 220,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      })
      setPixQrUrl(dataUrl)
    } catch (err) {
      toastError('Erro ao gerar PIX', err.message)
    } finally {
      setGerandoPix(false)
    }
  }

  const selecionarForma = (formaId) => {
    setFormaAtiva(formaId)
    const valSug = faltaPagar > 0 ? faltaPagar : valorTotal
    setValorFormaInput(valSug.toFixed(2))
    if (formaId === 'PIX' && valSug > 0) {
      gerarQrCodePix(valSug)
    }
  }

  const adicionarPagamento = (formaOverride = null, valorOverride = null) => {
    const forma = formaOverride || formaAtiva
    const val = Number(String(valorOverride ?? (valorFormaInput || faltaPagar)).replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) {
      toastWarning('Valor inválido', 'Informe um valor maior que zero.')
      return
    }
    if (forma === 'CREDIARIO') {
      if (!clienteSel) {
        toastError('Selecione o cliente', 'Escolha um cliente com crediário liberado abaixo.')
        return
      }
      if (Number(clienteSel.crediario_ativo) !== 1) {
        toastError('Crediário indisponível', `${clienteSel.nome_fantasia || clienteSel.razao_social} não tem crediário ativo.`)
        return
      }
      if (Number(clienteSel.bloqueado_financeiro) === 1) {
        toastError('Cliente bloqueado', 'Este cliente está bloqueado financeiramente.')
        return
      }
      const jaCred = pagamentos.filter((p) => p.forma === 'CREDIARIO').reduce((s, p) => s + p.valor, 0)
      const disp = Number(clienteSel.credito_disponivel || 0)
      if (jaCred + val > disp + 0.009) {
        toastError(
          'Limite de crediário insuficiente',
          `Disponível: ${fmtMoeda(disp)} • Solicitado: ${fmtMoeda(jaCred + val)}.`,
        )
        return
      }
    }
    if (forma !== 'DINHEIRO' && val > faltaPagar + 0.009) {
      toastWarning('Valor acima do saldo', `Para ${forma}, o valor máximo restante é ${fmtMoeda(faltaPagar)}.`)
      return
    }
    const novoList = [...pagamentos, { forma, valor: Number(val.toFixed(2)) }]
    setPagamentos(novoList)
    const novoTotalPago = novoList.reduce((s, p) => s + p.valor, 0)
    const novoResto = Math.max(0, Number((valorTotal - novoTotalPago).toFixed(2)))
    setValorFormaInput(novoResto > 0 ? novoResto.toFixed(2) : '')
  }

  const handleConfirmarVenda = async () => {
    let pagsFinal = pagamentos
    if (pagsFinal.length === 0) {
      const val = Number(String(valorFormaInput || valorTotal).replace(',', '.'))
      if (formaAtiva === 'CREDIARIO') {
        if (!clienteSel || Number(clienteSel.crediario_ativo) !== 1) {
          toastError('Selecione o cliente', 'Escolha um cliente com crediário liberado antes de finalizar.')
          return
        }
        if (val > Number(clienteSel.credito_disponivel || 0) + 0.009) {
          toastError(
            'Limite insuficiente',
            `Limite disponível de ${clienteSel.nome_fantasia || clienteSel.razao_social}: ${fmtMoeda(clienteSel.credito_disponivel)}.`,
          )
          return
        }
      }
      pagsFinal = [{ forma: formaAtiva, valor: Number((val > 0 ? val : valorTotal).toFixed(2)) }]
    }
    const soma = pagsFinal.reduce((s, p) => s + p.valor, 0)
    if (soma + 0.009 < valorTotal) {
      toastError('Pagamento incompleto', `Ainda falta receber ${fmtMoeda(valorTotal - soma)}.`)
      return
    }

    setFinalizando(true)
    try {
      const res = await varejoQueries.finalizarVendaPdv({
        caixa_id: caixa.id,
        cliente_id: clienteSel?.id || null,
        cliente_nome: clienteSel ? clienteSel.nome_fantasia || clienteSel.razao_social : 'CONSUMIDOR FINAL',
        cliente_doc: clienteSel?.cnpj_cpf || '',
        desconto_tipo: descontoAplicado.tipo,
        desconto_pct: descontoEfetivo.pct,
        desconto_valor: descontoEfetivo.valor,
        emitir_nfce: emitirNfce,
        itens: carrinho.map((it) => ({
          produto_id: it.produto_id,
          qtd: it.qtd,
          preco_unitario: it.preco_unitario,
          valor_total: it.valor_total,
          unidade: it.unidade,
          lote: it.lote || '',
          etiqueta_acougue_id: it.etiqueta_acougue_id || null,
          codigo_etiqueta: it.codigo_etiqueta || '',
        })),
        pagamentos: pagsFinal,
      })

      const venda = res.data
      setUltimaVenda(venda)
      setModalPagamento(false)
      setCarrinho([])
      setPagamentos([])
      setDescontoAplicado({ tipo: 'VALOR', pct: 0, valor: 0 })
      setClienteSel(null)
      setPixInfo(null)
      setPixQrUrl('')

      toastSuccess(
        `Venda ${venda.codigo} concluída!`,
        `Total ${fmtMoeda(venda.valor_total)}${venda.troco_valor > 0 ? ` • Troco ${fmtMoeda(venda.troco_valor)}` : ''}${venda.numero_nfce ? ` • NFC-e #${venda.numero_nfce}` : ''}`,
      )

      const estCfg = lerConfigEstacao()
      if (venda.crediario_recibo && (estCfg.imprimirCrediarioAuto ?? true)) {
        imprimirReciboCrediarioTermico(venda.crediario_recibo)
      } else if (estCfg.imprimirCupomAuto) {
        imprimirCupomVendaTermico(venda, filialAtual?.nome || 'VAREJO & AÇOUGUE')
      }

      await carregarDados()
      setTimeout(() => inputBuscaRef.current?.focus(), 100)
    } catch (err) {
      toastError('Erro ao finalizar venda', err.message)
    } finally {
      setFinalizando(false)
    }
  }

  // Abertura, Movimento e Fechamento de Caixa
  const handleAbrirCaixa = async (e) => {
    e.preventDefault()
    try {
      await varejoQueries.abrirCaixa({
        saldo_abertura: Number(saldoAbertura || 0),
        conta_bancaria_id: contaSelecionada || undefined,
      })
      toastSuccess('Caixa aberto!', 'Turno iniciado e pronto para vendas.')
      await carregarDados()
    } catch (err) {
      toastError('Erro ao abrir caixa', err.message)
    }
  }

  const handleMovimento = async (e) => {
    e.preventDefault()
    if (!caixa) return
    try {
      if (modalMov === 'FECHAR') {
        const res = await varejoQueries.fecharCaixa(caixa.id, {
          saldo_informado: Number(saldoInformadoFech || caixa.saldo_esperado_dinheiro || 0),
          observacoes: movMotivo,
        })
        toastSuccess(
          `Caixa ${res.data.codigo} fechado!`,
          `Diferença: ${fmtMoeda(res.data.diferenca_quebra)}`,
        )
      } else {
        await varejoQueries.registrarMovimentoCaixa(caixa.id, {
          tipo: modalMov,
          valor: Number(movValor || 0),
          motivo: movMotivo,
        })
        toastSuccess(`${modalMov === 'SANGRIA' ? 'Sangria' : 'Suprimento'} registrado!`, fmtMoeda(movValor))
      }
      setModalMov(null)
      setMovValor('')
      setMovMotivo('')
      await carregarDados()
    } catch (err) {
      toastError('Erro na operação do caixa', err.message)
    }
  }

  const handleCancelarVenda = async (venda) => {
    try {
      await varejoQueries.cancelarVendaPdv(venda.id, 'Cancelamento no PDV')
      toastSuccess(`Venda ${venda.codigo} cancelada`, 'Estoque, etiquetas e limite de crediário estornados.')
      await carregarDados()
    } catch (err) {
      toastError('Erro ao cancelar venda', err.message)
    }
  }

  if (loading) {
    return (
      <div className="p-24 text-center text-muted">
        <RefreshCw size={22} className="spin" /> Carregando PDV Frente de Caixa...
      </div>
    )
  }

  // Tela de Abertura de Turno
  if (!caixa) {
    return (
      <div className="fade-in" style={{ maxWidth: 520, margin: '48px auto' }}>
        <div className="card" style={{ padding: 28, background: 'var(--bg-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: 'rgba(34,197,94,0.14)',
                border: '1px solid rgba(34,197,94,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Unlock size={22} color="#22c55e" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>PDV Frente de Caixa</h1>
              <div className="text-xs text-muted">Abra um turno para iniciar as vendas • Operador: {operador?.nome}</div>
            </div>
          </div>

          <form onSubmit={handleAbrirCaixa} className="flex flex-col gap-14">
            <div className="form-group">
              <label className="form-label">Fundo de Troco / Abertura em Dinheiro (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input font-mono"
                style={{ fontSize: 18, fontWeight: 700, height: 46 }}
                value={saldoAbertura}
                onChange={(e) => setSaldoAbertura(e.target.value)}
                autoFocus
              />
            </div>

            {contasBancarias.length > 0 && (
              <div className="form-group">
                <label className="form-label">Conta / Caixa Financeiro Vinculado</label>
                <select
                  className="form-input"
                  value={contaSelecionada}
                  onChange={(e) => setContaSelecionada(e.target.value)}
                >
                  {contasBancarias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} — {c.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button type="submit" className="btn btn--success" style={{ height: 46, fontSize: 15, fontWeight: 700 }}>
              <Unlock size={18} /> Abrir Turno do Caixa
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER LIMPO E COMPACTO */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingCart size={20} className="text-primary" /> PDV Frente de Caixa
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Turno <strong className="font-mono text-success">{caixa.codigo}</strong> • Operador:{' '}
            <strong>{caixa.operador_nome || operador?.nome}</strong> • Atalhos: <code>F2</code> Bipar • <code>F4</code> Cliente • <code>F6</code> Desconto • <code>F10</code> Finalizar
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalEstacao(true)} title="Configurar Impressora Térmica 80mm/58mm e Zebra">
            <Settings size={14} /> Impressoras
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setMovValor('')
              setMovMotivo('')
              setModalMov('SUPRIMENTO')
            }}
          >
            <ArrowUpCircle size={14} color="#22c55e" /> Suprimento
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setMovValor('')
              setMovMotivo('')
              setModalMov('SANGRIA')
            }}
          >
            <ArrowDownCircle size={14} color="#f59e0b" /> Sangria
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setModalMov('VENDAS')}>
            <Receipt size={14} /> Vendas ({vendasTurno.length})
          </button>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => {
              setSaldoInformadoFech(Number(caixa.saldo_esperado_dinheiro || 0).toFixed(2))
              setMovMotivo('')
              setModalMov('FECHAR')
            }}
          >
            <Lock size={14} /> Fechar Caixa
          </button>
        </div>
      </div>

      {/* BARRA DE RESUMO DO TURNO (4 CARDS LIMPOS) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="text-xs text-muted uppercase">Vendido no Turno</div>
          <div className="font-mono font-bold" style={{ fontSize: 18, color: '#f8fafc', marginTop: 2 }}>
            {fmtMoeda(caixa.total_vendas)}
          </div>
        </div>
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="text-xs text-muted uppercase">Gaveta (Dinheiro)</div>
          <div className="font-mono font-bold" style={{ fontSize: 18, color: '#38bdf8', marginTop: 2 }}>
            {fmtMoeda(caixa.saldo_esperado_dinheiro)}
          </div>
        </div>
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="text-xs text-muted uppercase">PIX + Cartões</div>
          <div className="font-mono font-bold" style={{ fontSize: 16, color: '#a78bfa', marginTop: 3 }}>
            {fmtMoeda(Number(caixa.total_pix || 0) + Number(caixa.total_debito || 0) + Number(caixa.total_credito || 0))}
          </div>
        </div>
        <div className="card" style={{ padding: '10px 14px' }}>
          <div className="text-xs text-muted uppercase">Crediário no Turno</div>
          <div className="font-mono font-bold" style={{ fontSize: 16, color: '#fbbf24', marginTop: 3 }}>
            {fmtMoeda(caixa.total_crediario || 0)}
          </div>
        </div>
      </div>

      {/* BANNER RÁPIDO DA ÚLTIMA VENDA (PARA IMPRIMIR CUPOM OU COMPROVANTE CREDIÁRIO) */}
      {ultimaVenda && (
        <div
          className="card"
          style={{
            padding: '10px 14px',
            background: 'rgba(34,197,94,0.09)',
            border: '1px solid rgba(34,197,94,0.35)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={16} color="#22c55e" />
            <span>
              Última venda: <strong>{ultimaVenda.codigo}</strong> • <strong>{fmtMoeda(ultimaVenda.valor_total)}</strong>
              {ultimaVenda.troco_valor > 0 && ` • Troco ${fmtMoeda(ultimaVenda.troco_valor)}`}
              {ultimaVenda.crediario_valor > 0 && ` • Crediário ${fmtMoeda(ultimaVenda.crediario_valor)}`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => imprimirCupomVendaTermico(ultimaVenda, filialAtual?.nome || 'VAREJO & AÇOUGUE')}
            >
              <Printer size={13} /> Cupom Térmico
            </button>
            {ultimaVenda.crediario_recibo && (
              <button
                type="button"
                className="btn btn--warning btn--sm"
                onClick={() => imprimirReciboCrediarioTermico(ultimaVenda.crediario_recibo)}
              >
                <Printer size={13} /> Comprovante Crediário (Assinatura)
              </button>
            )}
            <button type="button" className="btn-icon" onClick={() => setUltimaVenda(null)}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* CORPO PRINCIPAL CLEAN (ESQUERDA: LEITOR + CARRINHO | DIREITA: CLIENTE + TOTAL + AÇÕES) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.75fr) minmax(310px, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* ESQUERDA: BIPAGEM E ITENS */}
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <form onSubmit={handleBuscarOuBipar} style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <QrCode
                size={18}
                style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: '#60a5fa' }}
              />
              <input
                ref={inputBuscaRef}
                type="text"
                className="form-input font-mono"
                style={{ paddingLeft: 40, height: 46, fontSize: 15, fontWeight: 600 }}
                placeholder="Bipe QR Zebra 80×45, Etiqueta Balança, EAN-13 ou digite nome/código... (F2)"
                value={codigoInput}
                onChange={(e) => setCodigoInput(e.target.value)}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn--primary" style={{ height: 46, padding: '0 20px' }} disabled={buscando}>
              <Search size={16} /> {buscando ? '...' : 'Lançar'}
            </button>
          </form>

          {sugestoes.length > 0 && (
            <div
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--border-light)',
                borderRadius: 10,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {sugestoes.map((s) => (
                <button
                  key={s.produto_id}
                  type="button"
                  onClick={() => adicionarAoCarrinho(s)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div className="font-bold text-sm">{s.descricao}</div>
                    <div className="text-xs text-muted font-mono">
                      Cód: {s.codigo || '-'} • {s.unidade}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-success">{fmtMoeda(s.preco_unitario)}</div>
                </button>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto', minHeight: 280 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th style={{ width: 115, textAlign: 'center' }}>Qtd / Peso</th>
                  <th style={{ width: 105, textAlign: 'right' }}>Unitário</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Total</th>
                  <th style={{ width: 42 }}></th>
                </tr>
              </thead>
              <tbody>
                {carrinho.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '56px 16px', color: 'var(--text-muted)' }}>
                      Caixa livre — bipe a etiqueta QR do açougue, etiqueta de balança ou código de barras.
                    </td>
                  </tr>
                ) : (
                  carrinho.map((it) => (
                    <tr key={it._key}>
                      <td>
                        <div className="font-bold text-sm">{it.descricao}</div>
                        <div className="text-xs text-muted" style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                          <span className="font-mono">Cód {it.codigo || '-'}</span>
                          {it.codigo_etiqueta && (
                            <span className="badge badge--info" style={{ fontSize: 10 }}>
                              QR {it.codigo_etiqueta}
                            </span>
                          )}
                          {it.lote && <span className="font-mono">Lote {it.lote}</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {it.etiqueta_acougue_id ? (
                          <span className="font-mono font-bold">
                            {Number(it.qtd).toFixed(3)} {it.unidade}
                          </span>
                        ) : (
                          <input
                            type="number"
                            step={it.unidade === 'KG' ? '0.005' : '1'}
                            min="0.001"
                            className="form-input font-mono text-center"
                            style={{ width: 90, height: 32, padding: '2px 6px' }}
                            value={it.qtd}
                            onChange={(e) => alterarQtdItem(it._key, e.target.value)}
                          />
                        )}
                      </td>
                      <td className="font-mono" style={{ textAlign: 'right' }}>
                        {fmtMoeda(it.preco_unitario)}
                      </td>
                      <td className="font-mono font-bold text-success" style={{ textAlign: 'right', fontSize: 14 }}>
                        {fmtMoeda(it.valor_total)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="btn-icon text-danger" onClick={() => removerItem(it._key)} title="Remover item">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* DIREITA: CLIENTE + TOTAL CLEAN + BOTÕES DE AÇÃO */}
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* BLOCO CLIENTE (BOTÃO F4) */}
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: clienteSel ? 'rgba(59,130,246,0.09)' : 'var(--bg-2)',
              border: `1px solid ${clienteSel ? 'rgba(59,130,246,0.38)' : 'var(--border)'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="text-xs text-muted uppercase">Cliente na Compra</div>
                <div className="font-bold text-sm" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {clienteSel ? clienteSel.nome_fantasia || clienteSel.razao_social : 'Consumidor Final'}
                </div>
                {clienteSel && (
                  <div className="text-xs text-muted font-mono" style={{ marginTop: 2 }}>
                    {clienteSel.cnpj_cpf || 'Sem CPF/CNPJ'}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    setBuscaCliente('')
                    setModalCliente(true)
                  }}
                >
                  <Users size={14} /> Cliente (F4)
                </button>
                {clienteSel && (
                  <button
                    type="button"
                    className="btn-icon"
                    title="Remover cliente"
                    onClick={() => setClienteSel(null)}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {clienteSel && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {clientePermiteDesconto ? (
                  <span className="badge badge--success" style={{ fontSize: 11 }}>
                    Desconto até {Number(clienteSel.desconto_max_pct).toFixed(1)}%
                  </span>
                ) : (
                  <span className="badge badge--neutral" style={{ fontSize: 11 }}>
                    Sem desconto cadastrado
                  </span>
                )}
                {Number(clienteSel.crediario_ativo) === 1 && (
                  <span className="badge badge--warning" style={{ fontSize: 11 }}>
                    Crediário Disp: {fmtMoeda(clienteSel.credito_disponivel)} / {fmtMoeda(clienteSel.limite_credito)}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* TOTAIS */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span className="text-muted">Subtotal ({carrinho.length} {carrinho.length === 1 ? 'item' : 'itens'})</span>
              <span className="font-mono font-bold">{fmtMoeda(subtotal)}</span>
            </div>

            {descontoEfetivo.valor > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#fbbf24' }}>
                <span>
                  Desconto ({descontoEfetivo.pct.toFixed(1)}%)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="font-mono font-bold">- {fmtMoeda(descontoEfetivo.valor)}</span>
                  <button
                    type="button"
                    className="btn-icon"
                    title="Remover desconto"
                    onClick={() => setDescontoAplicado({ tipo: 'VALOR', pct: 0, valor: 0 })}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}

            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 10,
                marginTop: 4,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <span className="text-xs font-bold uppercase text-muted">Total a Pagar</span>
              <span className="font-mono font-bold" style={{ fontSize: 32, color: '#22c55e', lineHeight: 1 }}>
                {fmtMoeda(valorTotal)}
              </span>
            </div>
          </div>

          {/* BOTÃO DESCONTO (BLOQUEADO ATÉ SELECIONAR CLIENTE COM DESCONTO DISPONÍVEL) */}
          <button
            type="button"
            className={`btn ${clientePermiteDesconto ? 'btn--secondary' : 'btn--ghost'}`}
            disabled={!clientePermiteDesconto || subtotal <= 0}
            style={{
              height: 42,
              justifyContent: 'space-between',
              opacity: !clientePermiteDesconto || subtotal <= 0 ? 0.5 : 1,
              cursor: !clientePermiteDesconto || subtotal <= 0 ? 'not-allowed' : 'pointer',
            }}
            onClick={() => {
              setDescTipo('PCT')
              setDescInput(descontoAplicado.pct > 0 ? String(descontoAplicado.pct) : '')
              setModalDesconto(true)
            }}
            title={
              clientePermiteDesconto
                ? `Aplicar desconto (máx ${Number(clienteSel.desconto_max_pct).toFixed(1)}%)`
                : 'Selecione primeiro um cliente com permissão de desconto ativa (F4)'
            }
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Percent size={16} /> Aplicar Desconto (F6)
            </span>
            <span className="text-xs font-mono">
              {clientePermiteDesconto ? `Máx ${Number(clienteSel.desconto_max_pct).toFixed(0)}%` : 'Bloqueado'}
            </span>
          </button>

          <label className="flex items-center gap-8 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={emitirNfce} onChange={(e) => setEmitirNfce(e.target.checked)} />
            Emitir NFC-e (Modelo 65) automaticamente ao finalizar
          </label>

          {/* CTA FINALIZAR COMPRA (ABRE MODAL DE PAGAMENTOS) */}
          <button
            type="button"
            className="btn btn--success"
            disabled={carrinho.length === 0}
            style={{ height: 54, fontSize: 16, fontWeight: 800, letterSpacing: '0.02em' }}
            onClick={abrirModalPagamento}
          >
            <DollarSign size={20} /> Finalizar Compra — {fmtMoeda(valorTotal)} (F10)
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: SELECIONAR CLIENTE (FILTRO DINÂMICO POR NOME / CPF / CNPJ)    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalCliente && (
        <div className="modal-overlay" style={{ zIndex: 1050 }} onClick={(e) => e.target === e.currentTarget && setModalCliente(false)}>
          <div className="modal" style={{ maxWidth: 660, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} className="text-primary" /> Selecionar Cliente
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalCliente(false)}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  ref={inputClienteRef}
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 38, height: 42 }}
                  placeholder="Digite nome, CPF, CNPJ ou RG para filtrar automaticamente..."
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && clientesFiltrados.length > 0) {
                      setClienteSel(clientesFiltrados[0])
                      setModalCliente(false)
                    }
                  }}
                />
              </div>

              <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {clientesFiltrados.length === 0 ? (
                  <div className="text-center text-muted p-24 text-sm">
                    Nenhum cliente encontrado para "{buscaCliente}". Cadastre em <strong>Clientes (Varejo)</strong>.
                  </div>
                ) : (
                  clientesFiltrados.map((c) => {
                    const temDesc = Number(c.desconto_ativo) === 1 && Number(c.desconto_max_pct || 0) > 0
                    const temCred = Number(c.crediario_ativo) === 1
                    const bloqueado = Number(c.bloqueado_financeiro) === 1
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setClienteSel(c)
                          setModalCliente(false)
                        }}
                        style={{
                          textAlign: 'left',
                          padding: '12px 14px',
                          borderRadius: 10,
                          background: clienteSel?.id === c.id ? 'rgba(59,130,246,0.16)' : 'var(--bg-2)',
                          border: `1px solid ${clienteSel?.id === c.id ? '#3b82f6' : 'var(--border)'}`,
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <div>
                          <div className="font-bold text-sm">{c.nome_fantasia || c.razao_social}</div>
                          <div className="text-xs text-muted font-mono" style={{ marginTop: 2 }}>
                            CPF/CNPJ: {c.cnpj_cpf || '-'}{c.rg ? ` • RG: ${c.rg}` : ''}{c.cidade ? ` • ${c.cidade}/${c.uf}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          {temDesc ? (
                            <span className="badge badge--success" style={{ fontSize: 11 }}>
                              Desc. até {Number(c.desconto_max_pct).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="badge badge--neutral" style={{ fontSize: 10 }}>Sem desconto</span>
                          )}
                          {temCred && (
                            <span className={`badge ${bloqueado ? 'badge--danger' : 'badge--warning'}`} style={{ fontSize: 11 }}>
                              {bloqueado ? 'Crediário Bloqueado' : `Cred. Disp: ${fmtMoeda(c.credito_disponivel)}`}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: APLICAR DESCONTO (% OU R$, ENTER CONFIRMA)                    */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalDesconto && clienteSel && (
        <div className="modal-overlay" style={{ zIndex: 1060 }} onClick={(e) => e.target === e.currentTarget && setModalDesconto(false)}>
          <div className="modal" style={{ maxWidth: 420, width: '95%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Percent size={16} className="text-warning" /> Aplicar Desconto
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalDesconto(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAplicarDesconto} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="text-xs text-muted">
                Cliente: <strong style={{ color: '#f8fafc' }}>{clienteSel.nome_fantasia || clienteSel.razao_social}</strong> • Limite autorizado:{' '}
                <strong className="text-success">{Number(clienteSel.desconto_max_pct).toFixed(1)}%</strong> (máx{' '}
                <strong>{fmtMoeda((subtotal * Number(clienteSel.desconto_max_pct || 0)) / 100)}</strong>)
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  className={`btn ${descTipo === 'PCT' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => {
                    setDescTipo('PCT')
                    setDescInput('')
                    setTimeout(() => inputDescRef.current?.focus(), 20)
                  }}
                >
                  Porcentagem (%)
                </button>
                <button
                  type="button"
                  className={`btn ${descTipo === 'VALOR' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => {
                    setDescTipo('VALOR')
                    setDescInput('')
                    setTimeout(() => inputDescRef.current?.focus(), 20)
                  }}
                >
                  Valor Fixo (R$)
                </button>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">
                  {descTipo === 'PCT' ? 'Percentual de desconto (%) — pressione Enter' : 'Valor do desconto (R$) — pressione Enter'}
                </label>
                <input
                  ref={inputDescRef}
                  type="number"
                  step="0.01"
                  min="0"
                  max={descTipo === 'PCT' ? Number(clienteSel.desconto_max_pct || 0) : Number(((subtotal * Number(clienteSel.desconto_max_pct || 0)) / 100).toFixed(2))}
                  className="form-input font-mono text-right"
                  style={{ fontSize: 22, fontWeight: 800, height: 50 }}
                  placeholder={descTipo === 'PCT' ? `0 a ${Number(clienteSel.desconto_max_pct).toFixed(1)}%` : '0,00'}
                  value={descInput}
                  onChange={(e) => setDescInput(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setModalDesconto(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  Confirmar Desconto (Enter)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: FINALIZAR COMPRA — PAGAMENTOS (DINHEIRO/PIX QR/CARTÃO/CREDIÁRIO) */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {modalPagamento && (
        <div className="modal-overlay" style={{ zIndex: 1070 }} onClick={(e) => e.target === e.currentTarget && !finalizando && setModalPagamento(false)}>
          <div className="modal" style={{ maxWidth: 780, width: '96%', padding: 0, overflow: 'hidden', maxHeight: '94vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 20px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DollarSign size={18} color="#22c55e" /> Finalizar Compra — Pagamento
                </h3>
                <div className="text-xs text-muted">
                  Escolha uma ou mais formas de pagamento para fechar a venda
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => !finalizando && setModalPagamento(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* RESUMO NUMÉRICO NO TOPO DO MODAL */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted uppercase">Total da Compra</div>
                  <div className="font-mono font-bold" style={{ fontSize: 22, color: '#f8fafc' }}>{fmtMoeda(valorTotal)}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted uppercase">Falta Pagar</div>
                  <div className="font-mono font-bold" style={{ fontSize: 22, color: faltaPagar > 0 ? '#fbbf24' : '#22c55e' }}>{fmtMoeda(faltaPagar)}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted uppercase">Troco</div>
                  <div className="font-mono font-bold" style={{ fontSize: 22, color: '#38bdf8' }}>{fmtMoeda(troco)}</div>
                </div>
              </div>

              {/* SELETOR DAS 5 FORMAS DE PAGAMENTO */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
                {FORMAS_PAG.map((f) => {
                  const Icon = f.icon
                  const ativa = formaAtiva === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => selecionarForma(f.id)}
                      style={{
                        padding: '12px 8px',
                        borderRadius: 10,
                        border: `2px solid ${ativa ? f.cor : 'var(--border)'}`,
                        background: ativa ? `${f.cor}22` : 'var(--bg-2)',
                        color: ativa ? '#ffffff' : 'var(--text-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      <Icon size={20} color={ativa ? f.cor : '#94a3b8'} />
                      <span>{f.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* ÁREA CONTEXTUAL POR FORMA DE PAGAMENTO */}
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label">Valor em {FORMAS_PAG.find((x) => x.id === formaAtiva)?.label} (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input font-mono"
                      style={{ height: 44, fontSize: 18, fontWeight: 700 }}
                      value={valorFormaInput}
                      onChange={(e) => setValorFormaInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          adicionarPagamento()
                        }
                      }}
                    />
                  </div>
                  <button type="button" className="btn btn--primary" style={{ height: 44 }} onClick={() => adicionarPagamento()}>
                    <Plus size={16} /> Adicionar Parcela
                  </button>
                </div>

                {/* ATALHOS DE CÉDULAS PARA DINHEIRO */}
                {formaAtiva === 'DINHEIRO' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setValorFormaInput((faltaPagar || valorTotal).toFixed(2))}>
                      Exato ({fmtMoeda(faltaPagar || valorTotal)})
                    </button>
                    {[20, 50, 100, 200].map((nota) => (
                      <button
                        key={nota}
                        type="button"
                        className="btn btn--ghost btn--sm font-mono"
                        onClick={() => setValorFormaInput(nota.toFixed(2))}
                      >
                        R$ {nota}
                      </button>
                    ))}
                  </div>
                )}

                {/* QR CODE PIX GERADO AUTOMATICAMENTE */}
                {formaAtiva === 'PIX' && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      padding: 12,
                      borderRadius: 10,
                      background: 'var(--bg-1)',
                      border: '1px dashed rgba(6,182,212,0.5)',
                    }}
                  >
                    <div style={{ background: '#ffffff', padding: 8, borderRadius: 8, width: 164, height: 164, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {gerandoPix ? (
                        <span style={{ color: '#000', fontSize: 12 }}>Gerando QR...</span>
                      ) : pixQrUrl ? (
                        <img src={pixQrUrl} alt="QR Code PIX" style={{ width: 148, height: 148 }} />
                      ) : (
                        <span style={{ color: '#666', fontSize: 11, textAlign: 'center' }}>Clique em Gerar QR PIX</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div className="font-bold text-sm" style={{ color: '#22d3ee' }}>
                        QR Code PIX — {fmtMoeda(pixInfo?.valor || Number(valorFormaInput || faltaPagar))}
                      </div>
                      <div className="text-xs text-muted">
                        Recebedor: <strong>{pixInfo?.nome_recebedor || '-'}</strong> • Chave: <code className="font-mono">{pixInfo?.chave_pix || '-'}</code>
                      </div>
                      {pixInfo?.usando_chave_fallback && (
                        <div className="text-xs" style={{ color: '#fbbf24' }}>
                          Dica: cadastre sua Chave PIX oficial em Financeiro → Contas Bancárias.
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => gerarQrCodePix(Number(valorFormaInput || faltaPagar || valorTotal))}
                        >
                          <RefreshCw size={13} /> Atualizar Valor QR
                        </button>
                        {pixInfo?.payload && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => {
                              navigator.clipboard?.writeText(pixInfo.payload)
                              toastSuccess('PIX Copia e Cola copiado!', 'Código BR Code copiado para área de transferência.')
                            }}
                          >
                            <Copy size={13} /> Copia e Cola
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* LISTA DE CLIENTES COM CREDIÁRIO ABERTO + LIMITE TOTAL/UTILIZADO/DISPONÍVEL */}
                {formaAtiva === 'CREDIARIO' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div className="text-xs font-bold uppercase" style={{ color: '#fbbf24' }}>
                        Clientes com Crediário Liberado ({clientesCrediario.length})
                      </div>
                      <input
                        type="text"
                        className="form-input"
                        style={{ width: 240, height: 32, fontSize: 12 }}
                        placeholder="Filtrar cliente crediário..."
                        value={buscaCrediario}
                        onChange={(e) => setBuscaCrediario(e.target.value)}
                      />
                    </div>

                    <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {clientesCrediario.length === 0 ? (
                        <div className="text-xs text-muted p-12 text-center">
                          Nenhum cliente com crediário ativo encontrado. Libere em <strong>Clientes (Varejo)</strong>.
                        </div>
                      ) : (
                        clientesCrediario.map((c) => {
                          const sel = clienteSel?.id === c.id
                          const lim = Number(c.limite_credito || 0)
                          const util = Number(c.credito_utilizado || 0)
                          const disp = Number(c.credito_disponivel || 0)
                          const pctUso = lim > 0 ? Math.min(100, Math.round((util / lim) * 100)) : 0
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setClienteSel(c)}
                              style={{
                                textAlign: 'left',
                                padding: '10px 12px',
                                borderRadius: 8,
                                background: sel ? 'rgba(245,158,11,0.16)' : 'var(--bg-1)',
                                border: `1.5px solid ${sel ? '#f59e0b' : 'var(--border)'}`,
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <div>
                                  <span className="font-bold text-sm">{c.nome_fantasia || c.razao_social}</span>
                                  <span className="text-xs text-muted font-mono" style={{ marginLeft: 8 }}>
                                    {c.cnpj_cpf}
                                  </span>
                                </div>
                                <div className="text-xs font-mono">
                                  Disp: <strong style={{ color: disp > 0 ? '#22c55e' : '#ef4444' }}>{fmtMoeda(disp)}</strong>
                                  <span className="text-muted"> • Util: {fmtMoeda(util)} / Lim: {fmtMoeda(lim)}</span>
                                </div>
                              </div>
                              <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${pctUso}%`,
                                    height: '100%',
                                    background: pctUso >= 90 ? '#ef4444' : pctUso >= 65 ? '#f59e0b' : '#22c55e',
                                  }}
                                />
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      Ao concluir no Crediário, o sistema gera automaticamente o título no Financeiro e emite o <strong>comprovante térmico para assinatura do cliente</strong>.
                    </div>
                  </div>
                )}
              </div>

              {/* PARCELAS ADICIONADAS (PAGAMENTO MISTO) */}
              {pagamentos.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="text-xs font-bold uppercase text-muted">Pagamentos Lançados</div>
                  {pagamentos.map((pg, idx) => (
                    <div
                      key={`${pg.forma}-${idx}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'var(--bg-2)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span className="font-bold text-sm">{pg.forma}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="font-mono font-bold text-success">{fmtMoeda(pg.valor)}</span>
                        <button
                          type="button"
                          className="btn-icon text-danger"
                          onClick={() => setPagamentos((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 20px', background: 'var(--bg-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalPagamento(false)} disabled={finalizando}>
                Voltar (ESC)
              </button>
              <button
                type="button"
                className="btn btn--success"
                style={{ height: 46, padding: '0 26px', fontSize: 15, fontWeight: 800 }}
                disabled={finalizando}
                onClick={handleConfirmarVenda}
              >
                <CheckCircle2 size={18} /> {finalizando ? 'Processando...' : `Confirmar Venda (${fmtMoeda(valorTotal)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SUPRIMENTO / SANGRIA / FECHAR / VENDAS DO TURNO */}
      {modalMov && (
        <div className="modal-overlay" style={{ zIndex: 1080 }} onClick={(e) => e.target === e.currentTarget && setModalMov(null)}>
          <div className="modal" style={{ maxWidth: modalMov === 'VENDAS' ? 760 : 440, width: '96%', padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                {modalMov === 'VENDAS'
                  ? `Vendas do Turno (${caixa.codigo})`
                  : modalMov === 'FECHAR'
                    ? `Fechar Caixa (${caixa.codigo})`
                    : modalMov === 'SANGRIA'
                      ? 'Registrar Sangria (Retirada)'
                      : 'Registrar Suprimento (Reforço)'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalMov(null)}>
                <X size={16} />
              </button>
            </div>

            {modalMov === 'VENDAS' ? (
              <div style={{ padding: 16, maxHeight: '72vh', overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Hora</th>
                      <th>Cliente</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendasTurno.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-muted p-24">
                          Nenhuma venda registrada neste turno ainda.
                        </td>
                      </tr>
                    ) : (
                      vendasTurno.map((v) => (
                        <tr key={v.id}>
                          <td className="font-mono font-bold">{v.codigo}</td>
                          <td className="text-xs">{fmtDataHora(v.created_at)}</td>
                          <td className="text-sm">{v.cliente_nome || 'Consumidor Final'}</td>
                          <td className="font-mono font-bold" style={{ textAlign: 'right' }}>
                            {fmtMoeda(v.valor_total)}
                          </td>
                          <td>
                            <span className={`badge ${v.status === 'CANCELADA' ? 'badge--danger' : 'badge--success'}`}>
                              {v.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => imprimirCupomVendaTermico(v, filialAtual?.nome || 'VAREJO & AÇOUGUE')}
                            >
                              <Printer size={13} />
                            </button>
                            {v.status !== 'CANCELADA' && (
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={() => handleCancelarVenda(v)}
                              >
                                Cancelar
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <form onSubmit={handleMovimento} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {modalMov === 'FECHAR' ? (
                  <>
                    <div className="p-12 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', fontSize: 13 }}>
                      <div>Dinheiro esperado na gaveta: <strong className="font-mono text-info">{fmtMoeda(caixa.saldo_esperado_dinheiro)}</strong></div>
                      <div>Total vendido no turno: <strong className="font-mono text-success">{fmtMoeda(caixa.total_vendas)}</strong></div>
                      <div>Crediário no turno: <strong className="font-mono text-warning">{fmtMoeda(caixa.total_crediario || 0)}</strong></div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Dinheiro Conferido na Gaveta (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input font-mono"
                        value={saldoInformadoFech}
                        onChange={(e) => setSaldoInformadoFech(e.target.value)}
                        required
                      />
                    </div>
                  </>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Valor (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="form-input font-mono"
                      value={movValor}
                      onChange={(e) => setMovValor(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Observação / Motivo</label>
                  <input
                    type="text"
                    className="form-input"
                    value={movMotivo}
                    onChange={(e) => setMovMotivo(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" className="btn btn--ghost" onClick={() => setModalMov(null)}>Cancelar</button>
                  <button type="submit" className={`btn ${modalMov === 'FECHAR' ? 'btn--danger' : 'btn--primary'}`}>
                    Confirmar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <ConfigEstacaoModal isOpen={modalEstacao} onClose={() => setModalEstacao(false)} />
    </div>
  )
}
