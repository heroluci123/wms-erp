import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-modulo-financeiro-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

async function loginAs(app: any, login: string, senha: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login, senha },
  })
  assert.equal(res.statusCode, 200, `Login falhou para ${login}: ${res.body}`)
  return res.json().token as string
}

test('Módulo Financeiro: Bancos, Pagar (XML/PC), Receber (Pedidos), Baixa Parcial/Estorno, Transferência, Comissões e Inadimplência', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // 1. Contas bancárias semeadas (CX1 padrão + BB1) + criar conta ITAU com saldo inicial R$ 10.000,00
    const resContasInit = await app.inject({ method: 'GET', url: '/api/financeiro/contas', headers })
    assert.equal(resContasInit.statusCode, 200, resContasInit.body)
    const contasInit = resContasInit.json().data
    const contaCx1 = contasInit.find((c: any) => c.codigo === 'CX1')
    const contaBb1 = contasInit.find((c: any) => c.codigo === 'BB1')
    assert.ok(contaCx1, 'Conta CAIXA GERAL (CX1) deve vir semeada')
    assert.equal(contaCx1.padrao, 1, 'CX1 deve ser a conta padrão inicial')
    assert.ok(contaBb1, 'Conta BANCO DO BRASIL (BB1) deve vir semeada')

    const resItau = await app.inject({
      method: 'POST',
      url: '/api/financeiro/contas',
      headers,
      payload: {
        codigo: 'ITAU',
        nome: 'Itaú Empresas',
        tipo: 'CONTA_CORRENTE',
        banco_codigo: '341',
        agencia: '0412',
        conta: '55432-1',
        chave_pix: 'financeiro@tricarnes.com.br',
        saldo_inicial: 10000,
        padrao: 0,
      },
    })
    assert.equal(resItau.statusCode, 201, resItau.body)
    const itauId = resItau.json().id as string

    // 2. Cadastros base: Fornecedor, Cliente, 2 Vendedores (LIQUIDACAO vs FATURAMENTO), Produto, Forma Pagamento 14/21
    const resForn = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'FIN-FORN',
        razao_social: 'FRIGORIFICO FINANCEIRO LTDA',
        nome_fantasia: 'Frigo Financeiro',
        cnpj_cpf: '44555666000177',
        uf: 'SP',
        cidade: 'SAO PAULO',
      },
    })
    assert.equal(resForn.statusCode, 201, resForn.body)
    const fornId = resForn.json().id as string

    const resVendLiq = await app.inject({
      method: 'POST',
      url: '/api/cadastros/vendedores',
      headers,
      payload: {
        codigo: 'V-LIQ',
        sigla: 'VL',
        nome: 'MARCOS LIQUIDACAO',
        tipo_comissao: 'PCT_VENDA',
        pct_comissao: 5.0,
        regra_liberacao: 'LIQUIDACAO',
      },
    })
    assert.equal(resVendLiq.statusCode, 201, resVendLiq.body)
    const vendLiqId = resVendLiq.json().id as string

    const resVendFat = await app.inject({
      method: 'POST',
      url: '/api/cadastros/vendedores',
      headers,
      payload: {
        codigo: 'V-FAT',
        sigla: 'VF',
        nome: 'ANA FATURAMENTO',
        tipo_comissao: 'PCT_VENDA',
        pct_comissao: 3.0,
        regra_liberacao: 'FATURAMENTO',
      },
    })
    assert.equal(resVendFat.statusCode, 201, resVendFat.body)
    const vendFatId = resVendFat.json().id as string

    const resCli = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: 'FIN-CLI',
        razao_social: 'CHURRASCARIA BOI NOBRE LTDA',
        nome_fantasia: 'Boi Nobre',
        cnpj_cpf: '77888999000122',
        uf: 'SP',
        cidade: 'CAMPINAS',
        limite_credito: 1500,
        vendedor_id: vendLiqId,
      },
    })
    assert.equal(resCli.statusCode, 201, resCli.body)
    const cliId = resCli.json().id as string

    const resProd = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '99100',
        descricao: 'CONTRA FILE BOVINO RESFRIADO',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        unidade: 'KG',
        custo_medio_kg: 30.0,
        valor_unitario: 50.0,
      },
    })
    assert.equal(resProd.statusCode, 201, resProd.body)
    const prodId = resProd.json().id as string

    const resFp = await app.inject({
      method: 'POST',
      url: '/api/cadastros/formas-pagamento',
      headers,
      payload: {
        codigo: 'FIN1421',
        descricao: '14/21 DIAS FIN',
        dias_parcelas: [14, 21],
        pagamento_na_entrega: 0,
      },
    })
    assert.equal(resFp.statusCode, 201, resFp.body)
    const formaPgtoId = resFp.json().id as string

    // 3. Importar XML NF-e com 2 duplicatas <dup> -> deve gerar automaticamente 2 Contas a Pagar (CPA)
    const xmlNfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35261144555666000177550010000055011000055012">
  <ide><nNF>5501</nNF><serie>1</serie><dhEmi>2026-11-18T10:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>44555666000177</CNPJ><xNome>FRIGORIFICO FINANCEIRO LTDA</xNome><xFant>Frigo Financeiro</xFant><IE>123456</IE><enderEmit><xMun>SAO PAULO</xMun><UF>SP</UF></enderEmit></emit>
  <det nItem="1"><prod><cProd>99100</cProd><xProd>CONTRA FILE BOVINO RESFRIADO</xProd><NCM>02013000</NCM><qCom>100.0000</qCom><vUnCom>25.0000</vUnCom><vProd>2500.00</vProd></prod></det>
  <total><ICMSTot><vProd>2500.00</vProd><vFrete>50.00</vFrete><vDesc>0.00</vDesc><vNF>2550.00</vNF></ICMSTot></total>
  <cobr>
    <dup><nDup>001</nDup><dVenc>2026-12-05</dVenc><vDup>1400.00</vDup></dup>
    <dup><nDup>002</nDup><dVenc>2026-12-20</dVenc><vDup>1150.00</vDup></dup>
  </cobr>
</infNFe></NFe></nfeProc>`

    const resImpXml = await app.inject({
      method: 'POST',
      url: '/api/compras/importar-lote',
      headers,
      payload: { xml_conteudo: xmlNfe, fornecedor_id: fornId },
    })
    assert.equal(resImpXml.statusCode, 201, resImpXml.body)

    const resPagarXml = await app.inject({ method: 'GET', url: '/api/financeiro/titulos?tipo=PAGAR', headers })
    assert.equal(resPagarXml.statusCode, 200)
    const titsXml = resPagarXml.json().data.filter((t: any) => t.origem === 'COMPRA_NFE_XML')
    assert.equal(titsXml.length, 2, 'XML com 2 duplicatas deve gerar 2 títulos a pagar')
    assert.equal(
      Number(titsXml.reduce((s: number, t: any) => s + t.valor_original, 0).toFixed(2)),
      2550,
    )
    assert.ok(titsXml[0].codigo.startsWith('CPA-'), 'Código a pagar deve ter prefixo CPA-')

    // Sincronização operacional idempotente não pode duplicar títulos do XML
    const resSync1 = await app.inject({ method: 'POST', url: '/api/financeiro/sincronizar-operacional', headers })
    assert.equal(resSync1.statusCode, 200, resSync1.body)
    assert.equal(resSync1.json().pagar_gerados, 0, 'Sincronização não deve duplicar títulos já gerados')

    // 4. Pedido de Compra finalizado na doca -> gera Conta a Pagar automaticamente (origem PEDIDO_COMPRA)
    const resPc = await app.inject({
      method: 'POST',
      url: '/api/compras',
      headers,
      payload: {
        fornecedor_id: fornId,
        finalidade: 'REVENDA',
        forma_pagamento_id: formaPgtoId,
        aprovar: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 10, preco_unitario_kg: 40 }],
      },
    })
    assert.equal(resPc.statusCode, 201, resPc.body)
    const pcId = resPc.json().id as string

    const resCx = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: 'AUTO',
        produto_id: prodId,
        pedido_compra_id: pcId,
        exigir_pedido_compra: true,
        peso_bruto_kg: 10.5,
        tara_id: null,
        tara_kg: 0.5,
        peso_kg: 10.0,
        qtd_pecas: 5,
        data_producao: '2026-11-18',
        validade: '2026-12-20',
        lote: 'L-FIN-01',
        endereco: 'REC',
      },
    })
    assert.equal(resCx.statusCode, 201, resCx.body)

    const resFinDoca = await app.inject({
      method: 'POST',
      url: `/api/recebimento/pedidos/${pcId}/finalizar-doca`,
      headers,
      payload: {},
    })
    assert.equal(resFinDoca.statusCode, 200, resFinDoca.body)

    const resPagarPc = await app.inject({ method: 'GET', url: '/api/financeiro/titulos?tipo=PAGAR', headers })
    const titsPc = resPagarPc.json().data.filter((t: any) => t.pedido_compra_id === pcId)
    assert.equal(titsPc.length, 2, 'PC com forma 14/21 deve gerar 2 parcelas a pagar')
    assert.equal(
      Number(titsPc.reduce((s: number, t: any) => s + t.valor_original, 0).toFixed(2)),
      400,
    )

    // 5. Pedidos de Venda -> geram Contas a Receber (CRE) automaticamente; cancelar pedido cancela seus CREs
    const resPedLiq = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Boi Nobre Liquidação',
        cliente_id: cliId,
        cliente_nome: 'Boi Nobre',
        vendedor_id: vendLiqId,
        forma_pagamento_id: formaPgtoId,
        liberar_agora: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 40, preco_unitario: 50 }], // R$ 2.000 -> 2x R$ 1.000
      },
    })
    assert.equal(resPedLiq.statusCode, 201, resPedLiq.body)
    const pedLiqId = resPedLiq.json().id as string

    const resPedFat = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Boi Nobre Faturamento',
        cliente_id: cliId,
        cliente_nome: 'Boi Nobre',
        vendedor_id: vendFatId,
        liberar_agora: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 10, preco_unitario: 50 }], // R$ 500 (1x R$ 500)
      },
    })
    assert.equal(resPedFat.statusCode, 201, resPedFat.body)
    const pedFatId = resPedFat.json().id as string

    const resPedCancel = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Boi Nobre Cancelamento',
        cliente_id: cliId,
        cliente_nome: 'Boi Nobre',
        liberar_agora: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 4, preco_unitario: 50 }], // R$ 200
      },
    })
    assert.equal(resPedCancel.statusCode, 201, resPedCancel.body)
    const pedCancelId = resPedCancel.json().id as string

    const resCancela = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedCancelId}/cancelar`,
      headers,
      payload: { motivo: 'Teste cancelamento financeiro' },
    })
    assert.equal(resCancela.statusCode, 200, resCancela.body)

    const resReceber = await app.inject({ method: 'GET', url: '/api/financeiro/titulos?tipo=RECEBER', headers })
    assert.equal(resReceber.statusCode, 200)
    const todosReceber = resReceber.json().data
    const titsPedLiq = todosReceber.filter((t: any) => t.pedido_venda_id === pedLiqId)
    const titsPedFat = todosReceber.filter((t: any) => t.pedido_venda_id === pedFatId)
    const titsPedCancel = todosReceber.filter((t: any) => t.pedido_venda_id === pedCancelId)

    assert.equal(titsPedLiq.length, 2, 'Pedido com 14/21 DIAS deve gerar 2 CREs')
    assert.equal(titsPedLiq[0].valor_original, 1000)
    assert.ok(titsPedLiq[0].codigo.startsWith('CRE-'))
    assert.equal(titsPedFat.length, 1)
    assert.equal(titsPedFat[0].valor_original, 500)
    assert.equal(titsPedCancel.length, 1)
    assert.equal(titsPedCancel[0].status, 'CANCELADO', 'Cancelar pedido deve cancelar título a receber em aberto')

    // 6. Baixa Parcial + Quitação c/ Desconto & Juros + Estorno + Nova Quitação (validando saldo exato no Itaú)
    const tituloAlvoId = titsPedLiq[0].id as string

    // Baixa parcial: R$ 400 -> saldo aberto cai para R$ 600, Itaú sobe para R$ 10.400
    const resBaixa1 = await app.inject({
      method: 'POST',
      url: `/api/financeiro/titulos/${tituloAlvoId}/baixar`,
      headers,
      payload: {
        conta_bancaria_id: itauId,
        valor_pago: 400,
        forma_pagamento: 'PIX',
        observacoes: 'Adiantamento parcial',
      },
    })
    assert.equal(resBaixa1.statusCode, 200, resBaixa1.body)
    assert.equal(resBaixa1.json().status, 'PARCIAL')
    assert.equal(resBaixa1.json().saldo_aberto, 600)
    assert.equal(resBaixa1.json().saldo_conta_atual, 10400)

    // Baixa final: restam R$ 600 -> desconto R$ 50 + juros R$ 10 -> valor pago efetivo R$ 560 -> quita R$ 600
    const resBaixa2 = await app.inject({
      method: 'POST',
      url: `/api/financeiro/titulos/${tituloAlvoId}/baixar`,
      headers,
      payload: {
        conta_bancaria_id: itauId,
        valor_pago: 560,
        valor_desconto: 50,
        valor_juros_multa: 10,
        forma_pagamento: 'PIX',
        observacoes: 'Quitação saldo restante',
      },
    })
    assert.equal(resBaixa2.statusCode, 200, resBaixa2.body)
    assert.equal(resBaixa2.json().status, 'PAGO')
    assert.equal(resBaixa2.json().saldo_aberto, 0)
    assert.equal(resBaixa2.json().saldo_conta_atual, 10960)

    // Estornar o título -> volta a ABERTO (saldo 1000) e devolve saldo do Itaú para exatos R$ 10.000
    const resEstorno = await app.inject({
      method: 'POST',
      url: `/api/financeiro/titulos/${tituloAlvoId}/estornar`,
      headers,
      payload: { motivo: 'PIX devolvido pelo banco' },
    })
    assert.equal(resEstorno.statusCode, 200, resEstorno.body)
    assert.equal(resEstorno.json().status, 'ABERTO')
    assert.equal(resEstorno.json().saldo_conta_atual, 10000)

    const resContasPosEstorno = await app.inject({ method: 'GET', url: '/api/financeiro/contas', headers })
    const itauPosEstorno = resContasPosEstorno.json().data.find((c: any) => c.id === itauId)
    assert.equal(itauPosEstorno.saldo_atual, 10000, 'Saldo do Itaú deve voltar exatamente para R$ 10.000 após estorno')

    // Quitar integralmente R$ 1.000 agora para testar comissão por LIQUIDACAO
    const resBaixaFull = await app.inject({
      method: 'POST',
      url: `/api/financeiro/titulos/${tituloAlvoId}/baixar`,
      headers,
      payload: {
        conta_bancaria_id: itauId,
        valor_pago: 1000,
        forma_pagamento: 'PIX',
      },
    })
    assert.equal(resBaixaFull.statusCode, 200, resBaixaFull.body)
    assert.equal(resBaixaFull.json().status, 'PAGO')
    assert.equal(resBaixaFull.json().saldo_conta_atual, 11000)

    // 7. Transferência entre contas: R$ 1.500 do Itaú (11.000 -> 9.500) para CX1 (0 -> 1.500)
    const resTransf = await app.inject({
      method: 'POST',
      url: '/api/financeiro/transferencias',
      headers,
      payload: {
        conta_origem_id: itauId,
        conta_destino_id: contaCx1.id,
        valor: 1500,
        historico: 'Reforço de caixa físico',
      },
    })
    assert.equal(resTransf.statusCode, 201, resTransf.body)
    assert.equal(resTransf.json().saldo_origem, 9500)
    assert.equal(resTransf.json().saldo_destino, 1500)

    const resMovs = await app.inject({ method: 'GET', url: '/api/financeiro/movimentacoes', headers })
    assert.equal(resMovs.statusCode, 200)
    const transfMovs = resMovs.json().data.filter((m: any) => m.categoria === 'TRANSFERENCIA')
    assert.equal(transfMovs.length, 2, 'Transferência deve registrar 1 SAIDA e 1 ENTRADA no extrato')

    // 8. Apuração de Comissões (FATURAMENTO vs LIQUIDACAO) + Gerar Conta a Pagar da comissão
    const hoje = new Date().toISOString().slice(0, 10)
    const inicioMes = `${hoje.slice(0, 7)}-01`
    const resCom = await app.inject({
      method: 'GET',
      url: `/api/financeiro/comissoes?data_inicio=${inicioMes}&data_fim=${hoje}`,
      headers,
    })
    assert.equal(resCom.statusCode, 200, resCom.body)
    const comLiq = resCom.json().data.find((v: any) => v.vendedor_id === vendLiqId)
    const comFat = resCom.json().data.find((v: any) => v.vendedor_id === vendFatId)

    // Marcos (LIQUIDACAO 5%): tem 1 parcela paga (R$ 1.000) e 1 aberta (R$ 1.000) -> comissão = R$ 50,00
    assert.ok(comLiq, 'Vendedor LIQUIDACAO deve constar na apuração')
    assert.equal(comLiq.base_valor, 1000)
    assert.equal(comLiq.comissao_total, 50)

    // Ana (FATURAMENTO 3%): tem 1 título aberto emitido hoje (R$ 500) -> comissão = R$ 15,00
    assert.ok(comFat, 'Vendedor FATURAMENTO deve constar na apuração')
    assert.equal(comFat.base_valor, 500)
    assert.equal(comFat.comissao_total, 15)

    const resGerarCom = await app.inject({
      method: 'POST',
      url: '/api/financeiro/comissoes/gerar-pagar',
      headers,
      payload: {
        vendedor_id: vendLiqId,
        valor: comLiq.comissao_total,
        periodo_label: `${inicioMes} a ${hoje}`,
      },
    })
    assert.equal(resGerarCom.statusCode, 201, resGerarCom.body)
    assert.ok(resGerarCom.json().codigo.startsWith('CPA-'))

    // 9. Título vencido manual + Inadimplência & Bloqueio Financeiro + Guarda de Exclusão
    const resVencido = await app.inject({
      method: 'POST',
      url: '/api/financeiro/titulos',
      headers,
      payload: {
        tipo: 'RECEBER',
        descricao: 'NF Antiga em Atraso',
        cliente_id: cliId,
        data_vencimento: '2026-01-10',
        valor_original: 800,
      },
    })
    assert.equal(resVencido.statusCode, 201, resVencido.body)

    const resInad = await app.inject({ method: 'GET', url: '/api/financeiro/inadimplencia', headers })
    assert.equal(resInad.statusCode, 200, resInad.body)
    const rowCli = resInad.json().data.find((c: any) => c.cliente_id === cliId)
    assert.ok(rowCli, 'Cliente com títulos abertos e vencidos deve aparecer na inadimplência')
    assert.equal(rowCli.saldo_vencido, 800)
    assert.equal(rowCli.saldo_aberto, 2300) // 1000 (2a parc Liq) + 500 (Fat) + 800 (Vencido)
    assert.equal(rowCli.excedeu_limite, true, 'Saldo R$ 2.300 excede limite de R$ 1.500')
    assert.ok(rowCli.maior_atraso_dias > 0)

    const resBloq = await app.inject({
      method: 'POST',
      url: `/api/financeiro/clientes/${cliId}/bloqueio`,
      headers,
      payload: { bloqueado: true },
    })
    assert.equal(resBloq.statusCode, 200)
    assert.equal(resBloq.json().bloqueado_financeiro, 1)

    // Guarda de exclusão: cliente com títulos financeiros em aberto não pode ser excluído definitivamente
    const resDelCli = await app.inject({
      method: 'DELETE',
      url: `/api/cadastros/clientes/${cliId}`,
      headers,
    })
    assert.equal(resDelCli.statusCode, 409, 'Exclusão de cliente com títulos em aberto deve ser bloqueada')

    // 10. Dashboard Financeiro consolidado e Fluxo Projetado (30 dias)
    const resDash = await app.inject({
      method: 'GET',
      url: '/api/financeiro/dashboard?dias_projecao=30',
      headers,
    })
    assert.equal(resDash.statusCode, 200, resDash.body)
    const dash = resDash.json().data
    assert.equal(dash.kpis.saldo_bancos, 11000) // Itaú 9.500 + CX1 1.500
    assert.equal(dash.kpis.receber_aberto, 2300)
    assert.equal(dash.kpis.receber_vencido, 800)
    assert.equal(dash.kpis.pagar_aberto, 3000) // XML 2.550 + PC 400 + Comissão 50
    assert.equal(dash.kpis.saldo_projetado, 10300) // 11.000 + 2.300 - 3.000
    assert.equal(dash.fluxo_projetado.length, 31)
  } finally {
    await app.close()
    await conn.close()
  }
})
