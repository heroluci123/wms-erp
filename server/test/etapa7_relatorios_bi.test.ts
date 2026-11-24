import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import {
  camarasTemperaturaLog,
  estoqueCaixas,
  etiquetasAcougue,
  movimentacoesLog,
  pdvCaixas,
  pdvVendas,
  pedidos,
  pedidosCompra,
  pedidosCompraItens,
  pedidosItens,
  perdasRegistro,
  vendedores,
} from '../src/db/schema/index.js'
import { uuidv7 } from '../src/utils/uuid.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-etapa7-central-relatorios-bi-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

function isoDiasOffset(offsetDias: number): string {
  const dt = new Date(Date.now() - 3 * 3600 * 1000 + offsetDias * 86400 * 1000)
  return dt.toISOString().slice(0, 10)
}

test('Etapa 7: Central de Relatórios & BI Gerencial (14 Novos Relatórios BI + Clássicos Preservados)', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // 1. Login MASTER Luciano
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(loginRes.statusCode, 200)
    const loginJson = loginRes.json()
    const headers = { authorization: `Bearer ${loginJson.token}` }
    const tenantId = (loginJson.operador.tenant_id || loginJson.contexto?.tenant?.id) as string
    const filialId = (
      loginJson.operador.filial_padrao_id ||
      loginJson.operador.filial_id ||
      loginJson.contexto?.filiais?.[0]?.id
    ) as string
    const opId = loginJson.operador.id as string

    // 2. Criar 2 produtos + 1 fornecedor + 1 vendedor
    const resP1 = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '80101',
        descricao: 'PICANHA PREMIUM EXPORT',
        tipo_produto: 'Produto Acabado',
        especie: 'BOVINO',
        conservacao: 'RESFRIADO',
        unidade: 'KG',
        custo_medio_kg: 55.0,
        valor_unitario: 85.0,
      },
    })
    assert.equal(resP1.statusCode, 201, resP1.body)
    const p1Id = resP1.json().id as string

    const resP2 = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '80102',
        descricao: 'COSTELA BOVINA CONGELADA',
        tipo_produto: 'Produto Acabado',
        especie: 'BOVINO',
        conservacao: 'CONGELADO',
        unidade: 'KG',
        custo_medio_kg: 22.0,
        valor_unitario: 36.0,
      },
    })
    assert.equal(resP2.statusCode, 201, resP2.body)
    const p2Id = resP2.json().id as string

    const resForn = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'FRIG-BI',
        razao_social: 'FRIGORIFICO BI BRASIL S/A',
        nome_fantasia: 'Frigo BI',
        uf: 'SP',
      },
    })
    assert.equal(resForn.statusCode, 201, resForn.body)
    const fornId = resForn.json().id as string

    const vendId = uuidv7()
    await conn.db.insert(vendedores).values({
      id: vendId,
      tenantId,
      codigo: 'VBI1',
      sigla: 'VB',
      nome: 'VENDEDOR BI ALPHA',
      tipoComissao: 'PCT_VENDA',
      pctComissao: '3.00',
      metaMensalValor: '10000.00',
      ativo: 1,
    })

    // 3. Popular dados reais: caixas (p/ ABC, Valuation, Giro/DeadStock, FEFO), Kardex, Pedido Atacado, PDV, Açougue, Compras (inflação), Perdas, Temp
    await conn.db.insert(estoqueCaixas).values([
      {
        id: uuidv7(),
        tenantId,
        filialId,
        eanCaixa: '0080101000001',
        produtoId: p1Id,
        endereco: 'CAM-01',
        pesoKg: '100.000',
        custoUnitarioKg: '55.0000',
        validade: isoDiasOffset(2), // Crítico <= 3d
        status: 'DISPONIVEL',
      },
      {
        id: uuidv7(),
        tenantId,
        filialId,
        eanCaixa: '0080102000001',
        produtoId: p2Id,
        endereco: 'CAM-02',
        pesoKg: '50.000',
        custoUnitarioKg: '22.0000',
        validade: isoDiasOffset(60), // Longo prazo
        status: 'DISPONIVEL',
      },
      {
        id: uuidv7(),
        tenantId,
        filialId,
        eanCaixa: '0080101000099',
        produtoId: p1Id,
        endereco: 'ACOUGUE',
        pesoKg: '20.000',
        quebraAcougueKg: '2.000',
        custoUnitarioKg: '55.0000',
        status: 'CONSUMIDA_ACOUGUE',
      },
    ])

    await conn.db.insert(movimentacoesLog).values([
      {
        id: uuidv7(),
        tenantId,
        filialId,
        produtoId: p1Id,
        enderecoOrigem: 'REC',
        enderecoDestino: 'CAM-01',
        qtdCaixas: '5',
        qtdKg: '100.000',
        operadorId: opId,
        operadorNome: 'Luciano',
        tipo: 'RECEBIMENTO',
        numPedido: 'PC-BI01',
      },
      {
        id: uuidv7(),
        tenantId,
        filialId,
        produtoId: p1Id,
        enderecoOrigem: 'CAM-01',
        enderecoDestino: 'EXPEDICAO',
        qtdCaixas: '2',
        qtdKg: '40.000',
        operadorId: opId,
        operadorNome: 'Luciano',
        tipo: 'EXPEDICAO',
        numPedido: 'PED-BI01',
      },
    ])

    const pedId = uuidv7()
    await conn.db.insert(pedidos).values({
      id: pedId,
      tenantId,
      filialId,
      codigo: 'PED-BI01',
      titulo: 'PEDIDO BI CHURRASCARIA',
      cliente: 'CHURRASCARIA BI PRIME',
      vendedorId: vendId,
      status: 'EXPEDIDO',
      valorTotal: '3400.00',
      custoTotalEstimado: '2200.00',
    })
    await conn.db.insert(pedidosItens).values({
      id: uuidv7(),
      tenantId,
      pedidoId: pedId,
      produtoId: p1Id,
      qtdKgSolicitada: '40.000',
      precoUnitario: '85.0000',
    })

    const cxPdvId = uuidv7()
    await conn.db.insert(pdvCaixas).values({
      id: cxPdvId,
      tenantId,
      filialId,
      codigo: 'CX-BI01',
      operadorId: opId,
      operadorNome: 'Luciano',
      status: 'FECHADO',
      totalVendas: '500.00',
      totalPix: '350.00',
      totalDinheiro: '150.00',
      diferencaQuebra: '0.00',
    })
    await conn.db.insert(pdvVendas).values({
      id: uuidv7(),
      tenantId,
      filialId,
      caixaId: cxPdvId,
      codigo: 'PDV-BI01',
      valorTotal: '500.00',
      subtotal: '500.00',
      status: 'CONCLUIDA',
      operadorNome: 'Luciano',
      itensJson: [{ produto_id: p1Id, codigo: '80101', descricao: 'PICANHA PREMIUM EXPORT', qtd: 5, preco_unitario: 100, subtotal: 500 }],
      pagamentosJson: [{ forma: 'PIX', valor: 350 }, { forma: 'DINHEIRO', valor: 150 }],
    })

    await conn.db.insert(etiquetasAcougue).values({
      id: uuidv7(),
      tenantId,
      filialId,
      codigoEtiqueta: 'ETQ-BI01',
      produtoId: p1Id,
      produtoCodigo: '80101',
      produtoDescricao: 'PICANHA PREMIUM EXPORT',
      especie: 'BOVINO',
      pesoLiquidoKg: '2.000',
      precoKg: '90.0000',
      valorTotal: '180.00',
      dataPesagem: isoDiasOffset(0),
      status: 'VENDIDA',
      operadorNome: 'Luciano',
    })

    // 2 PCs com preços diferentes para testar cálculo de Inflação (+10%: 50 -> 55)
    const pc1Id = uuidv7()
    const pc2Id = uuidv7()
    await conn.db.insert(pedidosCompra).values([
      {
        id: pc1Id,
        tenantId,
        filialId,
        codigo: 'PC-BI01',
        fornecedorId: fornId,
        valorTotal: '5000.00',
        status: 'RECEBIDO',
        createdAt: new Date(Date.now() - 5 * 86400 * 1000),
      },
      {
        id: pc2Id,
        tenantId,
        filialId,
        codigo: 'PC-BI02',
        fornecedorId: fornId,
        valorTotal: '5500.00',
        status: 'APROVADO',
        createdAt: new Date(),
      },
    ])
    await conn.db.insert(pedidosCompraItens).values([
      { id: uuidv7(), tenantId, pedidoCompraId: pc1Id, produtoId: p1Id, qtdKgSolicitada: '100.000', precoUnitarioKg: '50.0000' },
      { id: uuidv7(), tenantId, pedidoCompraId: pc2Id, produtoId: p1Id, qtdKgSolicitada: '100.000', precoUnitarioKg: '55.0000' },
    ])

    await conn.db.insert(perdasRegistro).values({
      id: uuidv7(),
      tenantId,
      filialId,
      codigo: 'PRD-BI01',
      origem: 'MANUAL',
      produtoId: p1Id,
      produtoDescricao: 'PICANHA PREMIUM EXPORT',
      motivo: 'VENCIMENTO',
      qtdKg: '3.000',
      custoUnitario: '55.0000',
      custoTotalPerda: '165.00',
      operadorNome: 'Luciano',
    })

    await conn.db.insert(camarasTemperaturaLog).values({
      id: uuidv7(),
      tenantId,
      filialId,
      localNome: 'CAM-01',
      tipoAmbiente: 'RESFRIADO',
      temperaturaC: '2.00',
      tempMinC: '-1.00',
      tempMaxC: '7.00',
      conforme: 1,
      desvioC: '0.00',
      operadorNome: 'Luciano',
    })

    const dIni = isoDiasOffset(-15)
    const dFim = isoDiasOffset(1)
    const qPer = `dataInicio=${dIni}&dataFim=${dFim}`

    // 4. Validar TODOS os 14 novos endpoints BI + 3 clássicos
    const r1 = await app.inject({ method: 'GET', url: '/api/relatorios/bi/curva-abc-estoque', headers })
    assert.equal(r1.statusCode, 200, r1.body)
    assert.equal(r1.json().resumo.total_skus, 2)
    assert.equal(r1.json().data[0].classe_abc, 'A')

    const r2 = await app.inject({ method: 'GET', url: '/api/relatorios/bi/valuation-estoque', headers })
    assert.equal(r2.statusCode, 200, r2.body)
    assert.equal(r2.json().resumo.wms_camaras_custo, 6600) // 100*55 + 50*22

    const r3 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/kardex?produto_id=${p1Id}&${qPer}`, headers })
    assert.equal(r3.statusCode, 200, r3.body)
    assert.equal(r3.json().resumo.total_movimentos, 2)
    assert.equal(r3.json().resumo.entradas_kg, 100)
    assert.equal(r3.json().resumo.saidas_kg, 40)

    const r4 = await app.inject({ method: 'GET', url: '/api/relatorios/bi/giro-deadstock?dias=30', headers })
    assert.equal(r4.statusCode, 200, r4.body)
    assert.equal(r4.json().resumo.dead_stock_qtd, 1) // p2 sem saída!

    const r5 = await app.inject({ method: 'GET', url: '/api/relatorios/bi/mapa-fefo', headers })
    assert.equal(r5.statusCode, 200, r5.body)
    assert.equal(r5.json().resumo.total_caixas, 2)
    assert.equal(r5.json().resumo.capital_risco_15d, 5500)

    const r6 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/acuracidade-inventario?${qPer}`, headers })
    assert.equal(r6.statusCode, 200, r6.body)
    assert.equal(r6.json().resumo.ira_pct, 100)

    const r7 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/curva-abc-vendas?${qPer}`, headers })
    assert.equal(r7.statusCode, 200, r7.body)
    assert.equal(r7.json().resumo.receita_atacado, 3400)
    assert.equal(r7.json().resumo.receita_pdv, 500)
    assert.equal(r7.json().resumo.receita_total, 3900)

    const r8 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/rentabilidade?${qPer}`, headers })
    assert.equal(r8.statusCode, 200, r8.body)
    assert.equal(r8.json().resumo.receita_total, 3900)
    assert.equal(r8.json().por_cliente[0].cliente, 'CHURRASCARIA BI PRIME')

    const r9 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/fechamento-pdv?${qPer}`, headers })
    assert.equal(r9.statusCode, 200, r9.body)
    assert.equal(r9.json().resumo.faturamento_pdv, 500)
    assert.equal(r9.json().por_forma[0].forma, 'PIX')

    const r10 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/comissoes-vendedores?${qPer}`, headers })
    assert.equal(r10.statusCode, 200, r10.body)
    const vBi = r10.json().data.find((v: any) => v.codigo === 'VBI1')
    assert.ok(vBi)
    assert.equal(vBi.faturado, 3400)
    assert.equal(vBi.comissao_valor, 102) // 3% de 3400

    const r11 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/rendimento-acougue?${qPer}`, headers })
    assert.equal(r11.statusCode, 200, r11.body)
    assert.equal(r11.json().resumo.rendimento_medio_pct, 90) // (20-2)/20
    assert.equal(r11.json().resumo.valor_vendido, 180)

    const r12 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/compras-inflacao?${qPer}`, headers })
    assert.equal(r12.statusCode, 200, r12.body)
    assert.equal(r12.json().resumo.valor_comprado_total, 10500)
    assert.equal(r12.json().data[0].variacao_pct, 10) // 50 -> 55 = +10%

    const r13 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/logistica-otif?${qPer}`, headers })
    assert.equal(r13.statusCode, 200, r13.body)
    assert.equal(r13.json().resumo.otif_pct, 100)

    const r14 = await app.inject({ method: 'GET', url: `/api/relatorios/bi/interunidades-perdas?${qPer}`, headers })
    assert.equal(r14.statusCode, 200, r14.body)
    assert.equal(r14.json().resumo.perdas_valor, 165)
    assert.equal(r14.json().resumo.temp_conformidade_pct, 100)

    // Clássicos preservados intactos
    const rClassExec = await app.inject({ method: 'GET', url: `/api/relatorios/executivo?${qPer}`, headers })
    assert.equal(rClassExec.statusCode, 200, rClassExec.body)
    const rClassBal = await app.inject({ method: 'GET', url: `/api/relatorios/balanco?${qPer}`, headers })
    assert.equal(rClassBal.statusCode, 200, rClassBal.body)
    const rClassArv = await app.inject({ method: 'GET', url: '/api/relatorios/arvore', headers })
    assert.equal(rClassArv.statusCode, 200, rClassArv.body)
  } finally {
    await app.close()
    await conn.close()
  }
})
