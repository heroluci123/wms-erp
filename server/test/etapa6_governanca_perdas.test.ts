import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-etapa6-governanca-perdas-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

function isoDiasOffset(offsetDias: number): string {
  const dt = new Date(Date.now() - 3 * 3600 * 1000 + offsetDias * 86400 * 1000)
  return dt.toISOString().slice(0, 10)
}

test('Etapa 6: Governança de Compras (RFQ), Score SIF, Monitor FEFO/Promoção/Perdas e Radar Antifraude', async () => {
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
    const headers = { authorization: `Bearer ${loginRes.json().token}` }

    // 2. Criar 2 Fornecedores frigoríficos com SIF + 1 Produto (Resfriado)
    const resFornA = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'FRIG-A',
        razao_social: 'FRIGORIFICO ALFA CARNES LTDA',
        nome_fantasia: 'Frigo Alfa',
        uf: 'SP',
        cidade: 'BARRETOS',
        registro_sanitario_sif: 'SIF 2021',
      },
    })
    assert.equal(resFornA.statusCode, 201, resFornA.body)
    const fornAId = resFornA.json().id as string

    const resFornB = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'FRIG-B',
        razao_social: 'FRIGORIFICO BETA BOI S/A',
        nome_fantasia: 'Frigo Beta',
        uf: 'GO',
        cidade: 'GOIANIA',
        registro_sanitario_sif: 'SIF 3032',
      },
    })
    assert.equal(resFornB.statusCode, 201, resFornB.body)
    const fornBId = resFornB.json().id as string

    const resProd = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '60101',
        descricao: 'COXAO MOLE RESFRIADO MATURADO',
        tipo_produto: 'Materia Prima',
        classificacao: 'MATERIA_PRIMA',
        especie: 'BOVINO',
        conservacao: 'RESFRIADO',
        unidade: 'KG',
        custo_medio_kg: 30.0,
        valor_unitario: 50.0,
      },
    })
    assert.equal(resProd.statusCode, 201, resProd.body)
    const prodId = resProd.json().id as string

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 1: COTAÇÕES DE COMPRAS (RFQ) & MAPA COMPARATIVO -> GERAR PC
    // ═════════════════════════════════════════════════════════════════════════
    const resCot = await app.inject({
      method: 'POST',
      url: '/api/governanca/cotacoes',
      headers,
      payload: {
        titulo: 'Cotação Semanal Traseiro & Coxão',
        tipo_compra: 'MATERIA_PRIMA',
        data_validade: isoDiasOffset(5),
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 200 }],
      },
    })
    assert.equal(resCot.statusCode, 201, resCot.body)
    const cotJson = resCot.json()
    assert.ok(String(cotJson.codigo).startsWith('COT-'))
    const cotId = cotJson.id as string
    const cotItemId = cotJson.itens[0].item_id as string

    // Lançar propostas concorrentes (Frigo Alfa: 28 + 1 = 29; Frigo Beta: 31 + 0 = 31)
    const resProps = await app.inject({
      method: 'POST',
      url: `/api/governanca/cotacoes/${cotId}/propostas`,
      headers,
      payload: {
        propostas: [
          {
            cotacao_item_id: cotItemId,
            fornecedor_id: fornAId,
            preco_unitario_kg: 28.0,
            frete_kg: 1.0,
            prazo_entrega_dias: 2,
            condicao_pagamento: '14 DDL',
          },
          {
            cotacao_item_id: cotItemId,
            fornecedor_id: fornBId,
            preco_unitario_kg: 31.0,
            frete_kg: 0,
            prazo_entrega_dias: 3,
            condicao_pagamento: '21 DDL',
          },
        ],
      },
    })
    assert.equal(resProps.statusCode, 200, resProps.body)

    // Auto-selecionar menor custo efetivo (preço + frete)
    const resAuto = await app.inject({
      method: 'POST',
      url: `/api/governanca/cotacoes/${cotId}/selecionar-vencedor`,
      headers,
      payload: { auto_menor_custo: true },
    })
    assert.equal(resAuto.statusCode, 200, resAuto.body)

    // Validar detalhe do mapa comparativo
    const resDet = await app.inject({
      method: 'GET',
      url: `/api/governanca/cotacoes/${cotId}`,
      headers,
    })
    assert.equal(resDet.statusCode, 200, resDet.body)
    const det = resDet.json().data
    assert.equal(det.status, 'EM_ANALISE')
    const propAlfa = det.itens[0].propostas.find((p: any) => p.fornecedor_id === fornAId)
    const propBeta = det.itens[0].propostas.find((p: any) => p.fornecedor_id === fornBId)
    assert.equal(propAlfa.vencedor, true)
    assert.equal(propAlfa.melhor_preco, true)
    assert.equal(propBeta.vencedor, false)

    // Gerar Pedidos de Compra vencedores (Economia = 200 kg * (31 - 29) = R$ 400,00)
    const resGerar = await app.inject({
      method: 'POST',
      url: `/api/governanca/cotacoes/${cotId}/gerar-pedidos`,
      headers,
      payload: { aprovar_automaticamente: true },
    })
    assert.equal(resGerar.statusCode, 201, resGerar.body)
    const gerarJson = resGerar.json()
    assert.equal(gerarJson.pedidos_gerados.length, 1)
    assert.ok(String(gerarJson.pedidos_gerados[0].codigo).startsWith('PC-'))
    assert.equal(gerarJson.economia_estimada, 400)
    const pcGeradoId = gerarJson.pedidos_gerados[0].id as string

    // Confirmar listagem com cotação FECHADA
    const resListCot = await app.inject({
      method: 'GET',
      url: '/api/governanca/cotacoes',
      headers,
    })
    assert.equal(resListCot.statusCode, 200)
    assert.equal(resListCot.json().data[0].status, 'FECHADA')

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 2: SCORE DE FORNECEDORES (SIF) & RECEBIMENTO NA DOCA
    // ═════════════════════════════════════════════════════════════════════════
    const resPal = await app.inject({
      method: 'POST',
      url: '/api/paletes',
      headers,
      payload: {},
    })
    assert.equal(resPal.statusCode, 201, resPal.body)
    const paleteId = resPal.json().id as string

    // Receber 200kg vinculados ao PC gerado (100% no prazo e exato no peso!)
    // Caixa 1: 100kg já VENCIDA (-2 dias) para testar Monitor FEFO + Baixa de Perda
    const resCxVenc = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        pedido_compra_id: pcGeradoId,
        numero_nf: '55100',
        ean_caixa: '0060101000001',
        produto_id: prodId,
        peso_kg: 100,
        data_producao: isoDiasOffset(-15),
        validade: isoDiasOffset(-2),
      },
    })
    assert.equal(resCxVenc.statusCode, 201, resCxVenc.body)
    const caixaVencId = resCxVenc.json().caixa_id || resCxVenc.json().id

    // Caixa 2: 100kg CRÍTICA (vence em +2 dias) para testar Alerta Crítico + Promoção FEFO
    const resCxCrit = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        pedido_compra_id: pcGeradoId,
        numero_nf: '55100',
        ean_caixa: '0060101000002',
        produto_id: prodId,
        peso_kg: 100,
        data_producao: isoDiasOffset(-10),
        validade: isoDiasOffset(2),
      },
    })
    assert.equal(resCxCrit.statusCode, 201, resCxCrit.body)

    const resScore = await app.inject({
      method: 'GET',
      url: '/api/governanca/score-fornecedores?dias=90',
      headers,
    })
    assert.equal(resScore.statusCode, 200, resScore.body)
    const scoreAlfa = resScore.json().data.find((f: any) => f.fornecedor_id === fornAId)
    assert.ok(scoreAlfa, 'Fornecedor Alfa deve aparecer no ranking')
    assert.equal(scoreAlfa.total_pedidos, 1)
    assert.equal(scoreAlfa.valor_comprado, 5800) // 200 * (28 + 1)
    assert.equal(scoreAlfa.classe, 'A')
    assert.ok(scoreAlfa.nota_score >= 85)
    assert.equal(scoreAlfa.sif, 'SIF 2021')

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 3: MONITOR FEFO, PROMOÇÃO LIQUIDAÇÃO & BAIXA DE PERDA CONTROLADA
    // ═════════════════════════════════════════════════════════════════════════
    const resFefo = await app.inject({
      method: 'GET',
      url: '/api/governanca/fefo-perdas?dias_alerta=15',
      headers,
    })
    assert.equal(resFefo.statusCode, 200, resFefo.body)
    const fefo = resFefo.json()
    assert.equal(fefo.resumo.vencido.qtd, 1)
    assert.equal(fefo.resumo.critico.qtd, 1)
    assert.equal(fefo.resumo.total_itens, 2)
    assert.ok(fefo.resumo.capital_em_risco > 0)

    const itemVencido = fefo.data.find((i: any) => i.faixa === 'VENCIDO')
    assert.ok(itemVencido)
    const caixaVencidoIdReal = caixaVencId || itemVencido.id

    // Ação FEFO #1: Criar Promoção Liquidação (-25%) para o SKU crítico
    const resPromo = await app.inject({
      method: 'POST',
      url: '/api/governanca/fefo/aplicar-promocao',
      headers,
      payload: {
        titulo: 'Queima FEFO Coxão Mole (-25%)',
        desconto_pct: 25,
        dias_validade: 3,
        produto_ids: [prodId],
      },
    })
    assert.equal(resPromo.statusCode, 201, resPromo.body)
    const promo = resPromo.json().data
    assert.ok(String(promo.codigo).startsWith('TAB-'))
    assert.equal(promo.itens[0].preco_base, 50)
    assert.equal(promo.itens[0].preco_promocional, 37.5)

    // Ação FEFO #2: Baixar Perda / Descarte Controlado da caixa vencida
    const resPerda = await app.inject({
      method: 'POST',
      url: '/api/governanca/fefo/baixar-perda',
      headers,
      payload: {
        origem: 'ESTOQUE_CAIXA',
        caixa_id: caixaVencidoIdReal,
        motivo: 'VENCIMENTO',
        observacoes: 'Lote vencido descartado conforme protocolo SIF',
      },
    })
    assert.equal(resPerda.statusCode, 201, resPerda.body)
    const perda = resPerda.json()
    assert.ok(String(perda.codigo).startsWith('PRD-'))
    assert.equal(perda.qtd_kg, 100)
    assert.ok(perda.custo_total_perda > 0)

    // Verificar que no Monitor FEFO restou apenas 1 item (a caixa vencida saiu!)
    const resFefoApos = await app.inject({
      method: 'GET',
      url: '/api/governanca/fefo-perdas?dias_alerta=15',
      headers,
    })
    assert.equal(resFefoApos.statusCode, 200)
    assert.equal(resFefoApos.json().resumo.vencido.qtd, 0)
    assert.equal(resFefoApos.json().resumo.critico.qtd, 1)

    // Verificar Histórico Mensal de Perdas
    const mesAtual = isoDiasOffset(0).slice(0, 7)
    const resHistPerdas = await app.inject({
      method: 'GET',
      url: `/api/governanca/perdas?mes=${mesAtual}`,
      headers,
    })
    assert.equal(resHistPerdas.statusCode, 200, resHistPerdas.body)
    const hist = resHistPerdas.json()
    assert.equal(hist.resumo.total_registros, 1)
    assert.equal(hist.resumo.total_kg, 100)
    assert.ok(hist.resumo.total_custo > 0)
    assert.equal(hist.resumo.por_motivo[0].motivo, 'VENCIMENTO')

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 4: RADAR ANTIFRAUDE & AUDITORIA DE EVENTOS SENSÍVEIS
    // ═════════════════════════════════════════════════════════════════════════
    const resAnti = await app.inject({
      method: 'GET',
      url: '/api/governanca/antifraude?dias=30',
      headers,
    })
    assert.equal(resAnti.statusCode, 200, resAnti.body)
    const anti = resAnti.json()
    assert.equal(anti.resumo.perdas_estoque_qtd, 1)
    assert.ok(anti.resumo.perdas_estoque_valor > 0)
    assert.ok(anti.resumo.total_eventos >= 3)
    assert.ok(anti.eventos.some((e: any) => e.categoria === 'PERDA_ESTOQUE'))
    assert.ok(anti.eventos.some((e: any) => e.categoria === 'AUDITORIA_GOVERNANCA' && e.titulo.includes('COTACAO FECHADA GEROU PC')))
    assert.ok(anti.eventos.some((e: any) => e.categoria === 'AUDITORIA_GOVERNANCA' && e.titulo.includes('PROMOCAO FEFO CRIADA')))
  } finally {
    await app.close()
    await conn.close()
  }
})
