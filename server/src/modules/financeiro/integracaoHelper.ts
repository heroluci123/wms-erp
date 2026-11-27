import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  clientes,
  financeiroContasBancarias,
  financeiroMovimentacoes,
  financeiroTitulos,
  formasPagamento,
  fornecedores,
  pedidos,
  pedidosCompra,
  pedidosCompraItens,
  pedidosParcelas,
  recebimentos,
} from '../../db/schema/index.js'
import { HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  normalizarDataIso,
  toDec,
  toNum,
  type DbOrTx,
} from '../wms/helpers.js'

function somarDiasIso(baseIso: string, dias: number): string {
  const d = normalizarDataIso(baseIso) || hojeIsoLocal()
  const ms = new Date(`${d}T12:00:00Z`).getTime()
  return new Date(ms + Number(dias || 0) * 86_400_000).toISOString().slice(0, 10)
}

export async function obterContaBancariaPadrao(
  tx: DbOrTx,
  tenantId: string,
  localCobrancaId?: string | null,
) {
  if (localCobrancaId) {
    const [porLocal] = await tx
      .select()
      .from(financeiroContasBancarias)
      .where(
        and(
          eq(financeiroContasBancarias.tenantId, tenantId),
          eq(financeiroContasBancarias.localCobrancaId, localCobrancaId),
          eq(financeiroContasBancarias.ativo, 1),
        ),
      )
      .limit(1)
    if (porLocal) return porLocal
  }

  const contas = await tx
    .select()
    .from(financeiroContasBancarias)
    .where(and(eq(financeiroContasBancarias.tenantId, tenantId), eq(financeiroContasBancarias.ativo, 1)))
    .orderBy(asc(financeiroContasBancarias.codigo))

  const padrao = contas.find((c) => Number(c.padrao) === 1) || contas[0]
  if (padrao) return padrao

  const novaId = uuidv7()
  await tx.insert(financeiroContasBancarias).values({
    id: novaId,
    tenantId,
    codigo: 'CX1',
    nome: 'CAIXA GERAL',
    tipo: 'CAIXA_FISICO',
    saldoInicial: '0.00',
    saldoAtual: '0.00',
    padrao: 1,
    ativo: 1,
  })
  const [criada] = await tx
    .select()
    .from(financeiroContasBancarias)
    .where(eq(financeiroContasBancarias.id, novaId))
    .limit(1)
  return criada
}

export async function recalcularSaldoConta(tx: DbOrTx, tenantId: string, contaId: string): Promise<number> {
  const [conta] = await tx
    .select({ id: financeiroContasBancarias.id, saldoInicial: financeiroContasBancarias.saldoInicial })
    .from(financeiroContasBancarias)
    .where(and(eq(financeiroContasBancarias.id, contaId), eq(financeiroContasBancarias.tenantId, tenantId)))
    .limit(1)
  if (!conta) return 0

  const res = await tx.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo = 'SAIDA' THEN valor ELSE 0 END), 0) AS saidas
    FROM financeiro_movimentacoes
    WHERE tenant_id = ${tenantId} AND conta_bancaria_id = ${contaId}
  `)
  const row = (res.rows as Array<{ entradas: string; saidas: string }>)[0]
  const saldo = Number(
    (toNum(conta.saldoInicial, 0) + toNum(row?.entradas, 0) - toNum(row?.saidas, 0)).toFixed(2),
  )

  await tx
    .update(financeiroContasBancarias)
    .set({ saldoAtual: toDec(saldo, 2), updatedAt: new Date() })
    .where(eq(financeiroContasBancarias.id, contaId))

  return saldo
}

export async function sincronizarTitulosPedidoVenda(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    pedidoId: string
    operadorId?: string | null
    operadorNome?: string
  },
): Promise<number> {
  const [ped] = await tx
    .select()
    .from(pedidos)
    .where(and(eq(pedidos.id, params.pedidoId), eq(pedidos.tenantId, params.tenantId)))
    .limit(1)
  if (!ped) return 0

  const existentes = await tx
    .select()
    .from(financeiroTitulos)
    .where(
      and(
        eq(financeiroTitulos.tenantId, params.tenantId),
        eq(financeiroTitulos.pedidoVendaId, ped.id),
        eq(financeiroTitulos.tipo, 'RECEBER'),
      ),
    )

  if (ped.status === 'CANCELADO') {
    const abertosIds = existentes.filter((t) => t.status === 'ABERTO').map((t) => t.id)
    if (abertosIds.length > 0) {
      await tx
        .update(financeiroTitulos)
        .set({ status: 'CANCELADO', saldoAberto: '0.00', updatedAt: new Date() })
        .where(inArray(financeiroTitulos.id, abertosIds))
    }
    return 0
  }

  const valorTotal = toNum(ped.valorTotal, 0)
  let clienteNaoFaturar = false
  if (ped.clienteId) {
    const [cliFlag] = await tx
      .select({ naoFaturar: clientes.naoFaturar })
      .from(clientes)
      .where(and(eq(clientes.id, ped.clienteId), eq(clientes.tenantId, params.tenantId)))
      .limit(1)
    clienteNaoFaturar = Number(cliFlag?.naoFaturar || 0) === 1
  }

  if (clienteNaoFaturar || ped.status === 'RASCUNHO' || ped.status === 'BLOQUEADO_COMERCIAL' || valorTotal <= 0) {
    const abertosIds = existentes.filter((t) => t.status === 'ABERTO').map((t) => t.id)
    if (abertosIds.length > 0) {
      await tx.delete(financeiroTitulos).where(inArray(financeiroTitulos.id, abertosIds))
    }
    return 0
  }

  // Se já houve alguma baixa (PAGO ou PARCIAL), preserva o histórico financeiro
  if (existentes.some((t) => t.status === 'PAGO' || t.status === 'PARCIAL')) {
    return 0
  }

  // Limpa títulos ABERTO anteriores para refletir edição atualizada de parcelas/valor
  const abertosIds = existentes.filter((t) => t.status === 'ABERTO').map((t) => t.id)
  if (abertosIds.length > 0) {
    await tx.delete(financeiroTitulos).where(inArray(financeiroTitulos.id, abertosIds))
  }

  const parcelas = await tx
    .select()
    .from(pedidosParcelas)
    .where(eq(pedidosParcelas.pedidoId, ped.id))
    .orderBy(asc(pedidosParcelas.numeroParcela))

  let clienteNome = ped.cliente || 'CLIENTE'
  if (ped.clienteId) {
    const [cli] = await tx
      .select({ razao: clientes.razaoSocial, fant: clientes.nomeFantasia })
      .from(clientes)
      .where(eq(clientes.id, ped.clienteId))
      .limit(1)
    if (cli) clienteNome = cli.fant || cli.razao || clienteNome
  }

  const contaPadrao = await obterContaBancariaPadrao(tx, params.tenantId, ped.localCobrancaId)
  const dataEmissao = ped.createdAt
    ? new Date(ped.createdAt).toISOString().slice(0, 10)
    : hojeIsoLocal()

  const listaGerar =
    parcelas.length > 0
      ? parcelas.map((p, idx) => ({
          num: p.numeroParcela || idx + 1,
          total: parcelas.length,
          venc: normalizarDataIso(p.vencimento) || dataEmissao,
          valor: toNum(p.valor, 0),
        }))
      : [
          {
            num: 1,
            total: 1,
            venc: normalizarDataIso(ped.previsaoEntrega) || dataEmissao,
            valor: valorTotal,
          },
        ]

  let criados = 0
  for (const item of listaGerar) {
    if (item.valor <= 0) continue
    const cod = await gerarCodigoDocumento(tx, params.tenantId, 'FIN_RECEBER', 'CRE', 4)
    const sufixoParc = item.total > 1 ? ` (${item.num}/${item.total})` : ''
    await tx.insert(financeiroTitulos).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      filialId: ped.filialId || params.filialId,
      codigo: cod,
      tipo: 'RECEBER',
      origem: 'VENDA_PEDIDO',
      descricao: `${ped.codigo} • ${clienteNome}${sufixoParc}`,
      numeroDocumento: ped.numeroNf || ped.codigo,
      parcelaNum: item.num,
      parcelaTotal: item.total,
      clienteId: ped.clienteId || null,
      vendedorId: ped.vendedorId || null,
      pedidoVendaId: ped.id,
      formaPagamentoId: ped.formaPagamentoId || null,
      contaBancariaId: contaPadrao?.id || null,
      dataEmissao,
      dataVencimento: item.venc,
      valorOriginal: toDec(item.valor, 2),
      valorDesconto: '0.00',
      valorJurosMulta: '0.00',
      valorPago: '0.00',
      saldoAberto: toDec(item.valor, 2),
      status: 'ABERTO',
      observacoes: ped.pagamentoNaEntrega ? 'Pagamento na Entrega' : '',
      criadoPorId: params.operadorId || null,
      criadoPorNome: params.operadorNome || ped.criadoPorNome || 'Sistema',
    })
    criados += 1
  }

  return criados
}

export async function baixarTitulosPedidoEntregaConfirmada(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    pedidoId: string
    formaPagamentoRecebida?: string
    valorPago?: number | null
    operadorId?: string | null
    operadorNome?: string
  },
): Promise<number> {
  await sincronizarTitulosPedidoVenda(tx, {
    tenantId: params.tenantId,
    filialId: params.filialId,
    pedidoId: params.pedidoId,
    operadorId: params.operadorId,
    operadorNome: params.operadorNome,
  })

  const abertos = await tx
    .select()
    .from(financeiroTitulos)
    .where(
      and(
        eq(financeiroTitulos.tenantId, params.tenantId),
        eq(financeiroTitulos.pedidoVendaId, params.pedidoId),
        eq(financeiroTitulos.tipo, 'RECEBER'),
        inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']),
      ),
    )
    .orderBy(asc(financeiroTitulos.parcelaNum))

  if (abertos.length === 0) return 0

  const contaPadrao = await obterContaBancariaPadrao(tx, params.tenantId)
  const hoje = hojeIsoLocal()
  const forma = String(params.formaPagamentoRecebida || 'PAGAMENTO_ENTREGA').trim().toUpperCase()
  let baixados = 0

  for (const tit of abertos) {
    const contaId = tit.contaBancariaId || contaPadrao.id
    const saldo = toNum(tit.saldoAberto, 0)
    if (saldo <= 0) continue
    await baixarTitulo(tx, {
      tenantId: params.tenantId,
      filialId: tit.filialId || params.filialId,
      tituloId: tit.id,
      contaBancariaId: contaId,
      valorPago: saldo,
      valorDesconto: 0,
      valorJurosMulta: 0,
      dataPagamento: hoje,
      formaPagamento: forma,
      observacoes: 'Baixa automática via confirmação de pagamento na entrega (Motorista)',
      operadorId: params.operadorId,
      operadorNome: params.operadorNome || 'Motorista',
    })
    baixados += 1
  }

  return baixados
}

export async function gerarTitulosCompraOuXml(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    pedidoCompraId?: string | null
    recebimentoId?: string | null
    operadorId?: string | null
    operadorNome?: string
    substituirPrevisaoPc?: boolean
  },
): Promise<number> {
  if (!params.pedidoCompraId && !params.recebimentoId) return 0

  // Se for escrituração oficial de NF-e XML vinculada a um PC, substitui eventual previsão COMPRA_PC ainda em ABERTO
  if (params.substituirPrevisaoPc && params.pedidoCompraId) {
    const existPc = await tx
      .select({
        id: financeiroTitulos.id,
        origem: financeiroTitulos.origem,
        status: financeiroTitulos.status,
      })
      .from(financeiroTitulos)
      .where(
        and(
          eq(financeiroTitulos.tenantId, params.tenantId),
          eq(financeiroTitulos.tipo, 'PAGAR'),
          eq(financeiroTitulos.pedidoCompraId, params.pedidoCompraId),
          ne(financeiroTitulos.status, 'CANCELADO'),
        ),
      )
    if (
      existPc.length > 0 &&
      existPc.every((t) => t.origem === 'COMPRA_PC' && t.status === 'ABERTO')
    ) {
      await tx
        .delete(financeiroTitulos)
        .where(inArray(financeiroTitulos.id, existPc.map((t) => t.id)))
    }
  }

  // Checa idempotência: se já há títulos PAGAR ativos para o recebimento ou PC, não duplica
  const condExist = []
  if (params.recebimentoId) condExist.push(eq(financeiroTitulos.recebimentoId, params.recebimentoId))
  if (params.pedidoCompraId) condExist.push(eq(financeiroTitulos.pedidoCompraId, params.pedidoCompraId))

  for (const cond of condExist) {
    const [ja] = await tx
      .select({ id: financeiroTitulos.id })
      .from(financeiroTitulos)
      .where(
        and(
          eq(financeiroTitulos.tenantId, params.tenantId),
          eq(financeiroTitulos.tipo, 'PAGAR'),
          ne(financeiroTitulos.status, 'CANCELADO'),
          cond,
        ),
      )
      .limit(1)
    if (ja) return 0
  }

  let recRow: typeof recebimentos.$inferSelect | null = null
  if (params.recebimentoId) {
    const [r] = await tx
      .select()
      .from(recebimentos)
      .where(and(eq(recebimentos.id, params.recebimentoId), eq(recebimentos.tenantId, params.tenantId)))
      .limit(1)
    recRow = r || null
  } else if (params.pedidoCompraId) {
    const [r] = await tx
      .select()
      .from(recebimentos)
      .where(and(eq(recebimentos.pedidoCompraId, params.pedidoCompraId), eq(recebimentos.tenantId, params.tenantId)))
      .limit(1)
    recRow = r || null
  }

  const pcIdEfetivo = params.pedidoCompraId || recRow?.pedidoCompraId || null
  let pcRow: typeof pedidosCompra.$inferSelect | null = null
  if (pcIdEfetivo) {
    const [p] = await tx
      .select()
      .from(pedidosCompra)
      .where(and(eq(pedidosCompra.id, pcIdEfetivo), eq(pedidosCompra.tenantId, params.tenantId)))
      .limit(1)
    pcRow = p || null
  }

  const fornId = recRow?.fornecedorId || pcRow?.fornecedorId || null
  let fornNome = 'FORNECEDOR'
  if (fornId) {
    const [f] = await tx
      .select({ fant: fornecedores.nomeFantasia, razao: fornecedores.razaoSocial })
      .from(fornecedores)
      .where(eq(fornecedores.id, fornId))
      .limit(1)
    if (f) fornNome = f.fant || f.razao || fornNome
  }

  const contaPadrao = await obterContaBancariaPadrao(tx, params.tenantId)
  const dataEmissao =
    normalizarDataIso(recRow?.dataEmissaoNf) ||
    (pcRow?.createdAt ? new Date(pcRow.createdAt).toISOString().slice(0, 10) : hojeIsoLocal())

  const dupsRaw = Array.isArray(recRow?.xmlDuplicatasJson) ? recRow!.xmlDuplicatasJson : []
  const dupsValidas = dupsRaw
    .map((d: any, idx: number) => ({
      num: idx + 1,
      doc: String(d?.numero || recRow?.numeroNf || pcRow?.codigo || '').trim(),
      venc: normalizarDataIso(d?.vencimento) || dataEmissao,
      valor: toNum(d?.valor, 0),
    }))
    .filter((d) => d.valor > 0)

  let parcelasGerar: Array<{ num: number; total: number; venc: string; valor: number; doc: string; origem: string }> = []

  if (dupsValidas.length > 0) {
    parcelasGerar = dupsValidas.map((d) => ({
      num: d.num,
      total: dupsValidas.length,
      venc: d.venc,
      valor: d.valor,
      doc: recRow?.numeroNf ? `NF ${recRow.numeroNf}${d.doc ? `/${d.doc}` : ''}` : d.doc,
      origem: 'COMPRA_NFE_XML',
    }))
  } else {
    // Calcula valor total: prioriza NF-e > valor efetivamente recebido no PC > valorTotal do PC
    let valorBase = toNum(recRow?.valorTotalNf, 0)
    if (valorBase <= 0 && pcRow) {
      const itensPc = await tx
        .select()
        .from(pedidosCompraItens)
        .where(eq(pedidosCompraItens.pedidoCompraId, pcRow.id))
      const somaRec = itensPc.reduce(
        (s, it) => s + toNum(it.qtdKgRecebida, 0) * toNum(it.precoUnitarioKg, 0),
        0,
      )
      const extras = toNum(pcRow.freteValor, 0) + toNum(pcRow.despesasValor, 0)
      valorBase = somaRec > 0 ? Number((somaRec + extras).toFixed(2)) : toNum(pcRow.valorTotal, 0)
    }

    if (valorBase <= 0) return 0

    let diasParc = [0]
    if (pcRow?.formaPagamentoId) {
      const [fp] = await tx
        .select()
        .from(formasPagamento)
        .where(eq(formasPagamento.id, pcRow.formaPagamentoId))
        .limit(1)
      if (fp && Array.isArray(fp.diasParcelasJson) && fp.diasParcelasJson.length > 0) {
        diasParc = fp.diasParcelasJson.map((x) => Number(x || 0))
      }
    }

    let acum = 0
    parcelasGerar = diasParc.map((dias, idx) => {
      const isLast = idx === diasParc.length - 1
      const v = isLast
        ? Number((valorBase - acum).toFixed(2))
        : Number((valorBase / diasParc.length).toFixed(2))
      acum += v
      return {
        num: idx + 1,
        total: diasParc.length,
        venc: somarDiasIso(dataEmissao, dias),
        valor: v,
        doc: recRow?.numeroNf ? `NF ${recRow.numeroNf}` : pcRow?.codigo || recRow?.codigo || '',
        origem: recRow?.numeroNf ? 'COMPRA_NFE_XML' : 'COMPRA_PC',
      }
    })
  }

  let criados = 0
  for (const p of parcelasGerar) {
    if (p.valor <= 0) continue
    const cod = await gerarCodigoDocumento(tx, params.tenantId, 'FIN_PAGAR', 'CPA', 4)
    const refDoc = pcRow?.codigo || (recRow?.numeroNf ? `NF ${recRow.numeroNf}` : recRow?.codigo || 'COMPRA')
    const sufixo = p.total > 1 ? ` (${p.num}/${p.total})` : ''
    const catPrefix = recRow?.categoriaDre ? `[${recRow.categoriaDre}] ` : ''
    await tx.insert(financeiroTitulos).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      filialId: recRow?.filialId || pcRow?.filialId || params.filialId,
      codigo: cod,
      tipo: 'PAGAR',
      origem: p.origem,
      descricao: `${catPrefix}${refDoc} • ${fornNome}${sufixo}`,
      numeroDocumento: p.doc,
      parcelaNum: p.num,
      parcelaTotal: p.total,
      fornecedorId: fornId,
      pedidoCompraId: pcRow?.id || null,
      recebimentoId: recRow?.id || null,
      centroCustoId: pcRow?.centroCustoId || recRow?.centroCustoId || null,
      formaPagamentoId: pcRow?.formaPagamentoId || null,
      contaBancariaId: contaPadrao?.id || null,
      dataEmissao,
      dataVencimento: p.venc,
      valorOriginal: toDec(p.valor, 2),
      valorDesconto: '0.00',
      valorJurosMulta: '0.00',
      valorPago: '0.00',
      saldoAberto: toDec(p.valor, 2),
      status: 'ABERTO',
      criadoPorId: params.operadorId || null,
      criadoPorNome: params.operadorNome || 'Sistema',
    })
    criados += 1
  }

  return criados
}

export async function baixarTitulo(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    tituloId: string
    contaBancariaId: string
    valorPago: number
    valorDesconto?: number
    valorJurosMulta?: number
    dataPagamento?: string | null
    formaPagamento?: string
    observacoes?: string
    ofxFitid?: string
    ofxMemo?: string
    operadorId?: string | null
    operadorNome?: string
  },
) {
  const [tit] = await tx
    .select()
    .from(financeiroTitulos)
    .where(and(eq(financeiroTitulos.id, params.tituloId), eq(financeiroTitulos.tenantId, params.tenantId)))
    .limit(1)
  if (!tit) throw new HttpError(404, 'Título financeiro não encontrado.')
  if (tit.status === 'PAGO') throw new HttpError(400, `Título ${tit.codigo} já está totalmente liquidado.`)
  if (tit.status === 'CANCELADO') throw new HttpError(400, `Título ${tit.codigo} está cancelado.`)

  const [conta] = await tx
    .select()
    .from(financeiroContasBancarias)
    .where(
      and(
        eq(financeiroContasBancarias.id, params.contaBancariaId),
        eq(financeiroContasBancarias.tenantId, params.tenantId),
        eq(financeiroContasBancarias.ativo, 1),
      ),
    )
    .limit(1)
  if (!conta) throw new HttpError(404, 'Conta bancária / caixa selecionado não encontrado ou inativo.')

  const saldoAtual = toNum(tit.saldoAberto, 0)
  const desc = Math.max(0, Number(params.valorDesconto || 0))
  const juros = Math.max(0, Number(params.valorJurosMulta || 0))
  const pagoAgora = Number(params.valorPago || 0)
  if (!Number.isFinite(pagoAgora) || pagoAgora <= 0) {
    throw new HttpError(400, 'Informe um valor de baixa maior que zero.')
  }

  const exigivel = Math.max(0, Number((saldoAtual - desc + juros).toFixed(2)))
  if (pagoAgora > exigivel + 0.01) {
    throw new HttpError(
      400,
      `Valor informado (R$ ${pagoAgora.toFixed(2)}) excede o saldo exigível do título (R$ ${exigivel.toFixed(2)}).`,
    )
  }

  const novoSaldoAberto = Math.max(0, Number((exigivel - pagoAgora).toFixed(2)))
  const novoStatus = novoSaldoAberto <= 0.009 ? 'PAGO' : 'PARCIAL'
  const novoValorPago = Number((toNum(tit.valorPago, 0) + pagoAgora).toFixed(2))
  const novoDesconto = Number((toNum(tit.valorDesconto, 0) + desc).toFixed(2))
  const novoJuros = Number((toNum(tit.valorJurosMulta, 0) + juros).toFixed(2))
  const dataPag = normalizarDataIso(params.dataPagamento) || hojeIsoLocal()
  const forma = String(params.formaPagamento || tit.formaPagamentoEfetiva || 'PIX').trim().toUpperCase()

  await tx
    .update(financeiroTitulos)
    .set({
      contaBancariaId: conta.id,
      valorPago: toDec(novoValorPago, 2),
      valorDesconto: toDec(novoDesconto, 2),
      valorJurosMulta: toDec(novoJuros, 2),
      saldoAberto: toDec(novoStatus === 'PAGO' ? 0 : novoSaldoAberto, 2),
      status: novoStatus,
      dataPagamento: novoStatus === 'PAGO' ? dataPag : tit.dataPagamento || dataPag,
      formaPagamentoEfetiva: forma,
      observacoes: params.observacoes
        ? [tit.observacoes, params.observacoes].filter(Boolean).join(' | ')
        : tit.observacoes,
      updatedAt: new Date(),
    })
    .where(eq(financeiroTitulos.id, tit.id))

  const tipoMov = tit.tipo === 'RECEBER' ? 'ENTRADA' : 'SAIDA'
  const catMov = tit.tipo === 'RECEBER' ? 'RECEBIMENTO_TITULO' : 'PAGAMENTO_TITULO'

  await tx.insert(financeiroMovimentacoes).values({
    id: uuidv7(),
    tenantId: params.tenantId,
    filialId: tit.filialId || params.filialId,
    contaBancariaId: conta.id,
    tituloId: tit.id,
    tipo: tipoMov,
    categoria: catMov,
    dataMovimento: dataPag,
    valor: toDec(pagoAgora, 2),
    formaPagamento: forma,
    historico: `${tit.tipo === 'RECEBER' ? 'Recebimento' : 'Pagamento'} ${tit.codigo} — ${tit.descricao}${novoStatus === 'PARCIAL' ? ' (Parcial)' : ''}`,
    ofxFitid: String(params.ofxFitid || '').trim(),
    ofxMemo: String(params.ofxMemo || '').trim(),
    operadorId: params.operadorId || null,
    operadorNome: params.operadorNome || 'Sistema',
  })

  const novoSaldoConta = await recalcularSaldoConta(tx, params.tenantId, conta.id)

  return {
    titulo_id: tit.id,
    codigo: tit.codigo,
    status: novoStatus,
    valor_pago_total: novoValorPago,
    saldo_aberto: novoStatus === 'PAGO' ? 0 : novoSaldoAberto,
    saldo_conta_atual: novoSaldoConta,
  }
}

export async function estornarTitulo(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    tituloId: string
    motivo?: string
    operadorId?: string | null
    operadorNome?: string
  },
) {
  const [tit] = await tx
    .select()
    .from(financeiroTitulos)
    .where(and(eq(financeiroTitulos.id, params.tituloId), eq(financeiroTitulos.tenantId, params.tenantId)))
    .limit(1)
  if (!tit) throw new HttpError(404, 'Título financeiro não encontrado.')
  if (!['PAGO', 'PARCIAL'].includes(tit.status)) {
    throw new HttpError(400, `Somente títulos pagos ou parciais podem ser estornados (status atual: ${tit.status}).`)
  }

  const valorPago = toNum(tit.valorPago, 0)
  const contaId = tit.contaBancariaId || (await obterContaBancariaPadrao(tx, params.tenantId)).id
  const hoje = hojeIsoLocal()

  if (valorPago > 0) {
    // Libera eventual FITID OFX das movimentações anteriores desse título para permitir reconferência
    await tx
      .update(financeiroMovimentacoes)
      .set({ ofxFitid: '' })
      .where(and(eq(financeiroMovimentacoes.tenantId, params.tenantId), eq(financeiroMovimentacoes.tituloId, tit.id)))

    await tx.insert(financeiroMovimentacoes).values({
      id: uuidv7(),
      tenantId: params.tenantId,
      filialId: tit.filialId || params.filialId,
      contaBancariaId: contaId,
      tituloId: tit.id,
      tipo: tit.tipo === 'RECEBER' ? 'SAIDA' : 'ENTRADA',
      categoria: 'ESTORNO',
      dataMovimento: hoje,
      valor: toDec(valorPago, 2),
      formaPagamento: tit.formaPagamentoEfetiva || '',
      historico: `Estorno ${tit.codigo} — ${tit.descricao}${params.motivo ? ` (${params.motivo})` : ''}`,
      operadorId: params.operadorId || null,
      operadorNome: params.operadorNome || 'Sistema',
    })
  }

  await tx
    .update(financeiroTitulos)
    .set({
      status: 'ABERTO',
      valorPago: '0.00',
      valorDesconto: '0.00',
      valorJurosMulta: '0.00',
      saldoAberto: tit.valorOriginal,
      dataPagamento: null,
      observacoes: [tit.observacoes, `Estornado em ${hoje}${params.motivo ? `: ${params.motivo}` : ''}`]
        .filter(Boolean)
        .join(' | '),
      updatedAt: new Date(),
    })
    .where(eq(financeiroTitulos.id, tit.id))

  const saldoConta = await recalcularSaldoConta(tx, params.tenantId, contaId)
  return { titulo_id: tit.id, status: 'ABERTO', saldo_conta_atual: saldoConta }
}
