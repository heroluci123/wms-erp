import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Barcode,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Lock,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  Unlock,
  X,
  XCircle,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { varejoQueries } from '../queries/varejo'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function imprimirCupomPdv80mm(venda, filialNome = 'LOJA 1/1 • AÇOUGUE & EMPÓRIO') {
  const linhas = (venda.itens || [])
    .map(
      (it) => `
      <tr>
        <td colspan="3" style="font-weight:700;padding-top:3px;">${String(it.descricao || '').toUpperCase()}</td>
      </tr>
      <tr>
        <td>${Number(it.qtd || 0).toFixed(it.unidade === 'UN' ? 0 : 3)} ${it.unidade || 'KG'} x ${fmtMoeda(it.preco_unitario)}</td>
        <td></td>
        <td style="text-align:right;font-weight:700;">${fmtMoeda(it.valor_total)}</td>
      </tr>`,
    )
    .join('')

  const pags = (venda.pagamentos || [])
    .map(
      (p) =>
        `<div style="display:flex;justify-content:space-between;"><span>${p.forma}</span><span>${fmtMoeda(p.valor)}</span></div>`,
    )
    .join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cupom ${venda.codigo}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { box-sizing: border-box; color: #000 !important; }
  body { margin: 0; font-family: 'Courier New', monospace; font-size: 11px; width: 76mm; }
  .ctr { text-align: center; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
</style>
</head>
<body>
  <div class="ctr">
    <div style="font-weight:900;font-size:13px;">${filialNome}</div>
    <div>${venda.numero_nfce ? `NFC-e Nº ${String(venda.numero_nfce).padStart(6, '0')} — HOMOLOGAÇÃO` : 'CUPOM NÃO FISCAL PDV'}</div>
    <div>Venda ${venda.codigo} • ${new Date(venda.created_at || Date.now()).toLocaleString('pt-BR')}</div>
    <div>Cliente: ${venda.cliente_nome || 'CONSUMIDOR FINAL'} ${venda.cliente_doc ? `(${venda.cliente_doc})` : ''}</div>
  </div>
  <div class="sep"></div>
  <table>${linhas}</table>
  <div class="sep"></div>
  <div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>${fmtMoeda(venda.subtotal)}</span></div>
  ${Number(venda.desconto_valor || 0) > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Desconto:</span><span>-${fmtMoeda(venda.desconto_valor)}</span></div>` : ''}
  <div style="display:flex;justify-content:space-between;font-weight:900;font-size:14px;margin-top:3px;"><span>TOTAL:</span><span>${fmtMoeda(venda.valor_total)}</span></div>
  <div class="sep"></div>
  ${pags}
  ${Number(venda.troco_valor || 0) > 0 ? `<div style="display:flex;justify-content:space-between;font-weight:700;"><span>TROCO:</span><span>${fmtMoeda(venda.troco_valor)}</span></div>` : ''}
  ${venda.chave_nfce ? `<div class="sep"></div><div class="ctr" style="font-size:9px;word-break:break-all;">CHAVE NFC-e:<br/>${venda.chave_nfce}</div>` : ''}
  <div class="sep"></div>
  <div class="ctr" style="font-size:10px;">Obrigado pela preferência!</div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=360,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch {
      /* ignore */
    }
  }, 200)
}

export function PdvCaixa() {
  const { filialAtivaId, filiaisDisponiveis, toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()
  const inputScanRef = useRef(null)

  const filialAtual = useMemo(
    () => filiaisDisponiveis.find((f) => String(f.id) === String(filialAtivaId)) || null,
    [filiaisDisponiveis, filialAtivaId],
  )

  const [loading, setLoading] = useState(false)
  const [caixa, setCaixa] = useState(null)
  const [movimentos, setMovimentos] = useState([])
  const [vendasTurno, setVendasTurno] = useState([])
  const [contasBancarias, setContasBancarias] = useState([])

  // Abertura / Fechamento / Sangria-Suprimento
  const [saldoAbertura, setSaldoAbertura] = useState('200,00')
  const [contaBancariaId, setContaBancariaId] = useState('')
  const [modalMovCaixa, setModalMovCaixa] = useState(null) // 'SANGRIA' | 'SUPRIMENTO' | 'FECHAR'
  const [valorMovCaixa, setValorMovCaixa] = useState('')
  const [motivoMovCaixa, setMotivoMovCaixa] = useState('')

  // Bipagem & Carrinho
  const [codigoInput, setCodigoInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [sugestoes, setSugestoes] = useState([])
  const [ultimaOrigem, setUltimaOrigem] = useState('')
  const [carrinho, setCarrinho] = useState([])
  const [descontoValor, setDescontoValor] = useState('')
  const [clienteNome, setClienteNome] = useState('')
  const [clienteDoc, setClienteDoc] = useState('')
  const [emitirNfce, setEmitirNfce] = useState(true)

  // Pagamento múltiplo
  const [formaAtual, setFormaAtual] = useState('DINHEIRO')
  const [valorPagAtual, setValorPagAtual] = useState('')
  const [pagamentos, setPagamentos] = useState([])
  const [finalizando, setFinalizando] = useState(false)
  const [ultimaVenda, setUltimaVenda] = useState(null)
  const [verHistoricoTurno, setVerHistoricoTurno] = useState(false)

  const carregar = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const res = await varejoQueries.obterCaixaAtual()
      setCaixa(res.caixa || null)
      setMovimentos(res.movimentos || [])
      setVendasTurno(res.vendas_turno || [])
      setContasBancarias(res.contas_bancarias || [])
      if (!contaBancariaId && res.contas_bancarias?.length > 0) {
        const cxFis = res.contas_bancarias.find((c) => c.tipo === 'CAIXA_FISICO') || res.contas_bancarias[0]
        setContaBancariaId(cxFis.id)
      }
    } catch (err) {
      toastError('Erro ao carregar PDV', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, contaBancariaId, toastError])

  useEffect(() => {
    carregar()
  }, [carregar, filialAtivaId])

  useEffect(() => {
    if (caixa && inputScanRef.current) {
      inputScanRef.current.focus()
    }
  }, [caixa])

  const subtotal = useMemo(
    () => Number(carrinho.reduce((s, it) => s + Number(it.valor_total || 0), 0).toFixed(2)),
    [carrinho],
  )
  const descontoNum = useMemo(() => {
    const v = Number(String(descontoValor || '0').replace(',', '.'))
    return Number.isFinite(v) && v > 0 ? Math.min(subtotal, v) : 0
  }, [descontoValor, subtotal])
  const totalVenda = useMemo(() => Number((subtotal - descontoNum).toFixed(2)), [subtotal, descontoNum])
  const totalPago = useMemo(
    () => Number(pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0).toFixed(2)),
    [pagamentos],
  )
  const restantePagar = useMemo(() => Number(Math.max(0, totalVenda - totalPago).toFixed(2)), [totalVenda, totalPago])
  const trocoPrevisto = useMemo(() => Number(Math.max(0, totalPago - totalVenda).toFixed(2)), [totalPago, totalVenda])

  const adicionarItemAoCarrinho = (item) => {
    setCarrinho((prev) => {
      // Etiquetas pesadas (QR ou Balança EAN-2) entram como linha individual para manter peso/valor exatos da bandeja
      const ehEtiquetaUnica = String(item.origem_leitura || '').startsWith('QR_') || String(item.origem_leitura || '').startsWith('BALANCA_')
      if (!ehEtiquetaUnica) {
        const idx = prev.findIndex((p) => p.produto_id === item.produto_id && !p.etiqueta_unica)
        if (idx >= 0) {
          const next = [...prev]
          const novaQtd = Number((Number(next[idx].qtd) + Number(item.qtd || 1)).toFixed(3))
          const novoTot = Number((novaQtd * Number(next[idx].preco_unitario)).toFixed(2))
          next[idx] = { ...next[idx], qtd: novaQtd, valor_total: novoTot }
          return next
        }
      }
      return [
        ...prev,
        {
          uid: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ...item,
          etiqueta_unica: ehEtiquetaUnica,
        },
      ]
    })
    setSugestoes([])
    setCodigoInput('')
    setTimeout(() => inputScanRef.current?.focus(), 30)
  }

  const handleBiparOuBuscar = async (e) => {
    e?.preventDefault?.()
    const q = codigoInput.trim()
    if (!q) return
    setBuscando(true)
    try {
      const res = await varejoQueries.buscarCodigoPdv(q)
      setUltimaOrigem(res.origem || '')
      if (res.match_exato) {
        adicionarItemAoCarrinho(res.match_exato)
        if (res.origem === 'QR_ZEBRA_80X45') {
          toastSuccess('QR Zebra 80×45 lido!', `${res.match_exato.descricao} • ${res.match_exato.qtd} kg • ${fmtMoeda(res.match_exato.valor_total)}`)
        } else if (String(res.origem || '').startsWith('BALANCA_')) {
          toastSuccess('Etiqueta Balança EAN-2 lida!', `${res.match_exato.descricao} • ${fmtMoeda(res.match_exato.valor_total)}`)
        }
      } else if (Array.isArray(res.sugestoes) && res.sugestoes.length > 0) {
        setSugestoes(res.sugestoes)
      } else {
        setSugestoes([])
        toastWarning('Não encontrado', `Nenhum produto encontrado para "${q}".`)
      }
    } catch (err) {
      toastError('Erro na leitura', err.message)
    } finally {
      setBuscando(false)
    }
  }

  const handleAbrirCaixa = async (e) => {
    e.preventDefault()
    const v = Number(String(saldoAbertura || '0').replace(',', '.')) || 0
    try {
      await varejoQueries.abrirCaixa({ saldo_abertura: v, conta_bancaria_id: contaBancariaId || undefined })
      toastSuccess('Caixa aberto!', 'Turno iniciado no PDV Frente de Caixa.')
      carregar()
    } catch (err) {
      toastError('Erro ao abrir caixa', err.message)
    }
  }

  const handleConfirmarMovCaixa = async (e) => {
    e.preventDefault()
    if (!caixa) return
    const v = Number(String(valorMovCaixa || '0').replace(',', '.'))
    try {
      if (modalMovCaixa === 'FECHAR') {
        const res = await varejoQueries.fecharCaixa(caixa.id, {
          saldo_informado: Number.isFinite(v) ? v : caixa.saldo_esperado_dinheiro,
          observacoes: motivoMovCaixa,
        })
        toastSuccess(
          `Caixa ${res.data.codigo} fechado!`,
          `Esperado: ${fmtMoeda(res.data.saldo_esperado_dinheiro)} • Diferença: ${fmtMoeda(res.data.diferenca_quebra)}`,
        )
      } else {
        await varejoQueries.registrarMovimentoCaixa(caixa.id, {
          tipo: modalMovCaixa,
          valor: v,
          motivo: motivoMovCaixa,
        })
        toastSuccess(
          modalMovCaixa === 'SANGRIA' ? 'Sangria registrada' : 'Suprimento registrado',
          `${fmtMoeda(v)} lançado no caixa ${caixa.codigo}.`,
        )
      }
      setModalMovCaixa(null)
      setValorMovCaixa('')
      setMotivoMovCaixa('')
      carregar()
    } catch (err) {
      toastError('Erro no caixa', err.message)
    }
  }

  const handleAdicionarPagamento = (formaOverride = null) => {
    const forma = formaOverride || formaAtual
    const rawVal = Number(String(valorPagAtual || '').replace(',', '.'))
    const val = Number.isFinite(rawVal) && rawVal > 0 ? rawVal : restantePagar
    if (val <= 0) return toastWarning('Valor', 'Informe o valor recebido ou adicione itens ao carrinho.')
    setPagamentos((prev) => [...prev, { id: Date.now() + Math.random(), forma, valor: Number(val.toFixed(2)) }])
    setValorPagAtual('')
  }

  const handleFinalizarVenda = async () => {
    if (carrinho.length === 0) return toastWarning('Carrinho vazio', 'Bipe ou adicione produtos antes de finalizar.')
    const pagsEnvio =
      pagamentos.length > 0
        ? pagamentos.map((p) => ({ forma: p.forma, valor: p.valor }))
        : [{ forma: formaAtual, valor: totalVenda }]

    const soma = pagsEnvio.reduce((s, p) => s + p.valor, 0)
    if (soma + 0.009 < totalVenda) {
      return toastWarning('Pagamento incompleto', `Falta receber ${fmtMoeda(totalVenda - soma)}.`)
    }

    setFinalizando(true)
    try {
      const res = await varejoQueries.finalizarVendaPdv({
        caixa_id: caixa?.id,
        cliente_nome: clienteNome.trim() || 'CONSUMIDOR FINAL',
        cliente_doc: clienteDoc.trim(),
        desconto_valor: descontoNum,
        emitir_nfce: emitirNfce,
        itens: carrinho.map((it) => ({
          produto_id: it.produto_id,
          qtd: Number(it.qtd),
          preco_unitario: Number(it.preco_unitario),
          valor_total: Number(it.valor_total),
          unidade: it.unidade,
          lote: it.lote || '',
        })),
        pagamentos: pagsEnvio,
      })
      setUltimaVenda(res.data)
      toastSuccess(
        `Venda ${res.data.codigo} concluída!`,
        res.data.numero_nfce
          ? `NFC-e #${res.data.numero_nfce} emitida • Total ${fmtMoeda(res.data.valor_total)}${res.data.troco_valor > 0 ? ` • Troco ${fmtMoeda(res.data.troco_valor)}` : ''}`
          : `Total ${fmtMoeda(res.data.valor_total)}`,
      )
      setCarrinho([])
      setPagamentos([])
      setDescontoValor('')
      setValorPagAtual('')
      setClienteNome('')
      setClienteDoc('')
      carregar()
      setTimeout(() => inputScanRef.current?.focus(), 80)
    } catch (err) {
      toastError('Falha ao finalizar venda', err.message)
    } finally {
      setFinalizando(false)
    }
  }

  const handleCancelarVenda = async (v) => {
    const ok = await confirmar({
      title: `Cancelar Venda ${v.codigo}`,
      message: `Estornar ${fmtMoeda(v.valor_total)}, devolver os itens ao estoque da Loja e cancelar a NFC-e vinculada?`,
      type: 'error',
      confirmLabel: 'Cancelar Venda',
    })
    if (!ok) return
    try {
      await varejoQueries.cancelarVendaPdv(v.id, 'Cancelamento operacional PDV')
      toastSuccess('Venda cancelada', `Estoque estornado para ${v.codigo}.`)
      carregar()
    } catch (err) {
      toastError('Erro ao cancelar venda', err.message)
    }
  }

  if (!apiAtiva) return <ApiModeRequiredBanner titulo="PDV Frente de Caixa (Loja 1/1)" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* HEADER */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <ShoppingCart size={24} className="text-primary" /> PDV Frente de Caixa — {filialAtual ? `${filialAtual.codigo} • ${filialAtual.nome}` : 'Loja 1/1'}
          </h1>
          <p className="page-header__subtitle">
            Leitura instantânea de QR Code Zebra 80×45, Etiqueta Balança (EAN-2 todos padrões), EAN-13 e emissão imediata de NFC-e (65)
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {caixa && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setModalMovCaixa('SUPRIMENTO')
                  setValorMovCaixa('')
                  setMotivoMovCaixa('Reforço de troco')
                }}
              >
                <ArrowUpCircle size={15} className="text-success" /> Suprimento
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setModalMovCaixa('SANGRIA')
                  setValorMovCaixa('')
                  setMotivoMovCaixa('Retirada p/ cofre')
                }}
              >
                <ArrowDownCircle size={15} className="text-warning" /> Sangria
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setVerHistoricoTurno((p) => !p)}
              >
                Vendas do Turno ({vendasTurno.length})
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => {
                  setModalMovCaixa('FECHAR')
                  setValorMovCaixa(String(caixa.saldo_esperado_dinheiro || 0).replace('.', ','))
                  setMotivoMovCaixa('')
                }}
              >
                <Lock size={14} /> Fechar Caixa ({caixa.codigo})
              </button>
            </>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={carregar} disabled={loading}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* CAIXA FECHADO -> TELA DE ABERTURA */}
      {!caixa ? (
        <form
          className="card"
          style={{ maxWidth: 520, margin: '24px auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}
          onSubmit={handleAbrirCaixa}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Unlock size={24} className="text-primary" />
            <div>
              <h2 className="text-base font-bold m-0">Abrir Turno de Caixa PDV</h2>
              <div className="text-xs text-muted">
                Unidade ativa: <strong>{filialAtual ? `${filialAtual.codigo} - ${filialAtual.nome}` : 'Filial Ativa'}</strong>
              </div>
            </div>
          </div>

          <div>
            <label className="form-label">Fundo de Troco (Dinheiro na Gaveta R$)</label>
            <input
              type="text"
              className="form-input font-mono"
              value={saldoAbertura}
              onChange={(e) => setSaldoAbertura(e.target.value)}
              placeholder="200,00"
            />
          </div>

          <div>
            <label className="form-label">Conta / Caixa Financeiro Vinculado</label>
            <select
              className="form-input"
              value={contaBancariaId}
              onChange={(e) => setContaBancariaId(e.target.value)}
            >
              {contasBancarias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.nome} ({c.tipo})
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn--primary" style={{ height: 42, fontWeight: 700 }}>
            <Unlock size={16} /> Abrir Caixa e Iniciar Vendas
          </button>
        </form>
      ) : (
        <>
          {/* KPIs DO TURNO ATIVO */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
            <div className="kpi-card">
              <span className="kpi-card__label">Turno Ativo</span>
              <span className="kpi-card__value font-mono" style={{ fontSize: 18, color: '#4ade80' }}>
                {caixa.codigo}
              </span>
              <span className="text-xs text-muted">Operador: {caixa.operador_nome}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-card__label">Total Vendido no Turno</span>
              <span className="kpi-card__value font-mono" style={{ fontSize: 18 }}>
                {fmtMoeda(caixa.total_vendas)}
              </span>
              <span className="text-xs text-muted">{vendasTurno.filter((v) => v.status === 'CONCLUIDA').length} venda(s)</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-card__label">Dinheiro Esperado Gaveta</span>
              <span className="kpi-card__value font-mono" style={{ fontSize: 18, color: '#60a5fa' }}>
                {fmtMoeda(caixa.saldo_esperado_dinheiro)}
              </span>
              <span className="text-xs text-muted">Abertura {fmtMoeda(caixa.saldo_abertura)}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-card__label">PIX / Cartões</span>
              <span className="kpi-card__value font-mono" style={{ fontSize: 15 }}>
                PIX {fmtMoeda(caixa.total_pix)}
              </span>
              <span className="text-xs text-muted">
                Déb {fmtMoeda(caixa.total_debito)} • Créd {fmtMoeda(caixa.total_credito)}
              </span>
            </div>
          </div>

          {/* BANNER ÚLTIMA VENDA CONCLUÍDA */}
          {ultimaVenda && (
            <div
              className="card"
              style={{
                padding: '12px 16px',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1.5px solid #22c55e',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div>
                <div className="font-bold text-sm" style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={16} /> Venda {ultimaVenda.codigo} finalizada — {fmtMoeda(ultimaVenda.valor_total)}
                  {ultimaVenda.numero_nfce ? ` • NFC-e #${ultimaVenda.numero_nfce}` : ''}
                  {ultimaVenda.troco_valor > 0 ? ` • TROCO: ${fmtMoeda(ultimaVenda.troco_valor)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--success btn--sm"
                  onClick={() => imprimirCupomPdv80mm(ultimaVenda, filialAtual?.nome)}
                >
                  <Printer size={14} /> Imprimir Cupom 80mm
                </button>
                <button type="button" className="btn-icon" onClick={() => setUltimaVenda(null)}>
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          {/* GRADE PRINCIPAL DO PDV: ESQUERDA (LEITOR + CARRINHO) | DIREITA (PAGAMENTO) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }}>
            {/* ESQUERDA: CAMPO DE BIPAGEM UNIVERSAL + ITENS */}
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <form onSubmit={handleBiparOuBuscar} style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <QrCode
                    size={18}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#60a5fa',
                    }}
                  />
                  <input
                    ref={inputScanRef}
                    type="text"
                    className="form-input font-mono"
                    style={{ paddingLeft: 38, height: 44, fontSize: 15, fontWeight: 700 }}
                    value={codigoInput}
                    onChange={(e) => setCodigoInput(e.target.value)}
                    placeholder="Bipe QR Zebra 80×45, Etiqueta Balança (2...), EAN-13 ou digite nome..."
                  />
                </div>
                <button type="submit" className="btn btn--primary" style={{ height: 44, padding: '0 18px' }} disabled={buscando}>
                  <Search size={16} /> {buscando ? '...' : 'Lançar'}
                </button>
              </form>

              <div className="text-xs text-muted" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span>
                  <Barcode size={12} style={{ verticalAlign: 'middle' }} /> Aceita: <strong>QR Zebra (TRIC|...)</strong> •{' '}
                  <strong>Balança EAN-2 (Preço/Peso)</strong> • <strong>EAN-13 / Código</strong>
                </span>
                {ultimaOrigem && <span className="badge badge--info">Última leitura: {ultimaOrigem}</span>}
              </div>

              {/* SUGESTÕES DE BUSCA TEXTUAL */}
              {sugestoes.length > 0 && (
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    maxHeight: 220,
                    overflowY: 'auto',
                    background: 'var(--bg-2)',
                  }}
                >
                  {sugestoes.map((s) => (
                    <button
                      key={s.produto_id}
                      type="button"
                      onClick={() => adicionarItemAoCarrinho(s)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 12px',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <div>
                        <div className="font-bold text-sm">
                          <span className="font-mono text-muted">{s.codigo}</span> • {s.descricao}
                        </div>
                        <div className="text-xs text-muted">
                          Saldo Loja: {s.saldo_loja} {s.unidade} • {s.setor_loja}
                        </div>
                      </div>
                      <div className="font-mono font-bold text-success">
                        {fmtMoeda(s.preco_unitario)}/{s.unidade}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* TABELA DO CARRINHO */}
              <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto / Origem</th>
                      <th style={{ width: 105, textAlign: 'right' }}>Qtd / Peso</th>
                      <th style={{ width: 110, textAlign: 'right' }}>Unitário</th>
                      <th style={{ width: 110, textAlign: 'right' }}>Total</th>
                      <th style={{ width: 42 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {carrinho.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-muted" style={{ padding: 36 }}>
                          Caixa livre — bipe a etiqueta QR Zebra 80×45, etiqueta de balança ou código de barras.
                        </td>
                      </tr>
                    ) : (
                      carrinho.map((it) => (
                        <tr key={it.uid}>
                          <td>
                            <div className="font-bold text-sm">{it.descricao}</div>
                            <div className="text-xs text-muted font-mono">
                              Cód {it.codigo} • {it.unidade}
                              {it.origem_leitura === 'QR_ZEBRA_80X45' && (
                                <span className="badge badge--success" style={{ marginLeft: 6, fontSize: 10 }}>
                                  QR Zebra
                                </span>
                              )}
                              {String(it.origem_leitura || '').startsWith('BALANCA_') && (
                                <span className="badge badge--info" style={{ marginLeft: 6, fontSize: 10 }}>
                                  Balança EAN-2
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              type="number"
                              step={it.unidade === 'UN' ? '1' : '0.005'}
                              min="0.001"
                              className="form-input font-mono"
                              style={{ height: 30, textAlign: 'right', padding: '2px 6px' }}
                              value={it.qtd}
                              onChange={(e) => {
                                const q = Math.max(0.001, Number(e.target.value || 0))
                                setCarrinho((prev) =>
                                  prev.map((x) =>
                                    x.uid === it.uid
                                      ? { ...x, qtd: q, valor_total: Number((q * Number(x.preco_unitario)).toFixed(2)) }
                                      : x,
                                  ),
                                )
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="form-input font-mono"
                              style={{ height: 30, textAlign: 'right', padding: '2px 6px' }}
                              value={it.preco_unitario}
                              onChange={(e) => {
                                const pr = Math.max(0, Number(e.target.value || 0))
                                setCarrinho((prev) =>
                                  prev.map((x) =>
                                    x.uid === it.uid
                                      ? { ...x, preco_unitario: pr, valor_total: Number((Number(x.qtd) * pr).toFixed(2)) }
                                      : x,
                                  ),
                                )
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">
                            {fmtMoeda(it.valor_total)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-icon text-danger"
                              onClick={() => setCarrinho((prev) => prev.filter((x) => x.uid !== it.uid))}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* DIREITA: TOTALIZADOR + PAGAMENTO + FINALIZAR */}
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Subtotal ({carrinho.length} item(ns))</span>
                  <span className="font-mono">{fmtMoeda(subtotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                  <span className="text-xs text-muted">Desconto (R$):</span>
                  <input
                    type="text"
                    className="form-input font-mono"
                    style={{ width: 110, height: 30, textAlign: 'right' }}
                    value={descontoValor}
                    onChange={(e) => setDescontoValor(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span className="font-bold text-sm">TOTAL A PAGAR</span>
                  <span className="font-mono font-bold" style={{ fontSize: 28, color: '#4ade80' }}>
                    {fmtMoeda(totalVenda)}
                  </span>
                </div>
              </div>

              {/* CLIENTE OPCIONAL (CPF NA NOTA) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label className="form-label">CPF / CNPJ na Nota</label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    style={{ height: 34 }}
                    value={clienteDoc}
                    onChange={(e) => setClienteDoc(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
                <div>
                  <label className="form-label">Nome Cliente</label>
                  <input
                    type="text"
                    className="form-input"
                    style={{ height: 34 }}
                    value={clienteNome}
                    onChange={(e) => setClienteNome(e.target.value)}
                    placeholder="Consumidor Final"
                  />
                </div>
              </div>

              {/* FORMAS DE PAGAMENTO */}
              <div>
                <label className="form-label">Forma de Pagamento</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[
                    { id: 'DINHEIRO', label: 'Dinheiro' },
                    { id: 'PIX', label: 'PIX' },
                    { id: 'DEBITO', label: 'Débito' },
                    { id: 'CREDITO', label: 'Crédito' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`btn btn--sm ${formaAtual === f.id ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setFormaAtual(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    type="text"
                    className="form-input font-mono"
                    style={{ flex: 1, height: 36 }}
                    value={valorPagAtual}
                    onChange={(e) => setValorPagAtual(e.target.value)}
                    placeholder={`Valor recebido (Falta ${fmtMoeda(restantePagar)})`}
                  />
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => handleAdicionarPagamento()}
                    disabled={totalVenda <= 0}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>

              {pagamentos.length > 0 && (
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {pagamentos.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <span>
                        <CreditCard size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        <strong>{p.forma}</strong>
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="font-mono font-bold">{fmtMoeda(p.valor)}</span>
                        <button
                          type="button"
                          className="btn-icon text-danger"
                          onClick={() => setPagamentos((prev) => prev.filter((x) => x.id !== p.id))}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      borderTop: '1px solid var(--border)',
                      paddingTop: 6,
                      marginTop: 4,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <span>{restantePagar > 0 ? 'Falta receber:' : 'Troco ao cliente:'}</span>
                    <span className="font-mono" style={{ color: restantePagar > 0 ? '#f59e0b' : '#4ade80' }}>
                      {restantePagar > 0 ? fmtMoeda(restantePagar) : fmtMoeda(trocoPrevisto)}
                    </span>
                  </div>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={emitirNfce} onChange={(e) => setEmitirNfce(e.target.checked)} />
                Emitir NFC-e (Modelo 65) automaticamente ao finalizar
              </label>

              <button
                type="button"
                className="btn btn--success"
                style={{ height: 48, fontSize: 15, fontWeight: 800 }}
                disabled={finalizando || carrinho.length === 0}
                onClick={handleFinalizarVenda}
              >
                <DollarSign size={18} /> {finalizando ? 'Finalizando...' : `Finalizar Venda (${fmtMoeda(totalVenda)})`}
              </button>
            </div>
          </div>

          {/* VENDAS DO TURNO (EXPANSÍVEL) */}
          {verHistoricoTurno && (
            <div className="card" style={{ padding: 16 }}>
              <h3 className="text-sm font-bold m-0 mb-12">Vendas & Movimentos do Turno ({caixa.codigo})</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Horário</th>
                      <th>Cliente</th>
                      <th>NFC-e</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendasTurno.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-muted p-16">
                          Nenhuma venda registrada neste turno ainda.
                        </td>
                      </tr>
                    ) : (
                      vendasTurno.map((v) => (
                        <tr key={v.id}>
                          <td className="font-mono font-bold">{v.codigo}</td>
                          <td className="text-xs text-muted">{new Date(v.createdAt || v.created_at).toLocaleTimeString('pt-BR')}</td>
                          <td className="text-xs">{v.clienteNome || v.cliente_nome}</td>
                          <td className="font-mono text-xs">{v.numeroNfce || v.numero_nfce ? `#${v.numeroNfce || v.numero_nfce}` : '-'}</td>
                          <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                            {fmtMoeda(v.valor_total)}
                          </td>
                          <td>
                            <span className={`badge ${v.status === 'CANCELADA' ? 'badge--danger' : 'badge--success'}`}>
                              {v.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() =>
                                  imprimirCupomPdv80mm(
                                    {
                                      ...v,
                                      itens: v.itensJson || v.itens || [],
                                      pagamentos: v.pagamentosJson || v.pagamentos || [],
                                      numero_nfce: v.numeroNfce || v.numero_nfce,
                                      cliente_nome: v.clienteNome || v.cliente_nome,
                                      cliente_doc: v.clienteDoc || v.cliente_doc,
                                    },
                                    filialAtual?.nome,
                                  )
                                }
                              >
                                <Printer size={13} /> Cupom
                              </button>
                              {v.status === 'CONCLUIDA' && (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm text-danger"
                                  onClick={() => handleCancelarVenda(v)}
                                >
                                  <XCircle size={13} /> Estornar
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
              {movimentos.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 12 }} className="text-muted">
                  Sangrias/Suprimentos do turno:{' '}
                  {movimentos.map((m) => `${m.tipo} ${fmtMoeda(m.valor)} (${m.motivo})`).join(' • ')}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL SANGRIA / SUPRIMENTO / FECHAMENTO */}
      {modalMovCaixa && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModalMovCaixa(null)}>
          <form
            className="card"
            style={{ width: '95%', maxWidth: 420, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={handleConfirmarMovCaixa}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="text-base font-bold m-0">
                {modalMovCaixa === 'FECHAR'
                  ? `Fechar Caixa (${caixa?.codigo})`
                  : modalMovCaixa === 'SANGRIA'
                    ? 'Registrar Sangria'
                    : 'Registrar Suprimento'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalMovCaixa(null)}>
                <X size={18} />
              </button>
            </div>

            {modalMovCaixa === 'FECHAR' && (
              <div style={{ background: 'var(--bg-2)', padding: 12, borderRadius: 8, fontSize: 12 }}>
                <div>
                  Dinheiro esperado na gaveta:{' '}
                  <strong className="font-mono" style={{ color: '#60a5fa' }}>
                    {fmtMoeda(caixa?.saldo_esperado_dinheiro)}
                  </strong>
                </div>
                <div className="text-muted" style={{ marginTop: 4 }}>
                  Total Vendas: {fmtMoeda(caixa?.total_vendas)} • PIX: {fmtMoeda(caixa?.total_pix)} • Cartões:{' '}
                  {fmtMoeda(Number(caixa?.total_debito || 0) + Number(caixa?.total_credito || 0))}
                </div>
              </div>
            )}

            <div>
              <label className="form-label">
                {modalMovCaixa === 'FECHAR' ? 'Valor Contado em Dinheiro na Gaveta (R$) *' : 'Valor (R$) *'}
              </label>
              <input
                type="text"
                required
                className="form-input font-mono"
                value={valorMovCaixa}
                onChange={(e) => setValorMovCaixa(e.target.value)}
                placeholder="0,00"
              />
            </div>

            <div>
              <label className="form-label">{modalMovCaixa === 'FECHAR' ? 'Observações do Fechamento' : 'Motivo *'}</label>
              <input
                type="text"
                className="form-input"
                value={motivoMovCaixa}
                onChange={(e) => setMotivoMovCaixa(e.target.value)}
                placeholder={modalMovCaixa === 'FECHAR' ? 'Opcional' : 'Ex.: Retirada para cofre / Troco'}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalMovCaixa(null)}>
                Cancelar
              </button>
              <button
                type="submit"
                className={`btn ${modalMovCaixa === 'FECHAR' ? 'btn--danger' : 'btn--primary'}`}
              >
                Confirmar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
