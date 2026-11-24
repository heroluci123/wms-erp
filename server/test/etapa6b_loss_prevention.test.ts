import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import {
  estoqueCaixas,
  etiquetasAcougue,
  opInsumos,
  opRetornos,
  ordensProducao,
} from '../src/db/schema/index.js'
import { uuidv7 } from '../src/utils/uuid.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-etapa6b-loss-prevention-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

function isoDiasOffset(offsetDias: number): string {
  const dt = new Date(Date.now() - 3 * 3600 * 1000 + offsetDias * 86400 * 1000)
  return dt.toISOString().slice(0, 10)
}

test('Etapa 6B: Loss Prevention (Temperatura SIF, Hard-Stop FEFO, Furo de Rendimento e Etiquetas Fantasma)', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // 1. Login MASTER Luciano (PIN padrão seed = 1234)
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

    // Criar Produto bovino resfriado (custo 30, venda 50)
    const resProd = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '70101',
        descricao: 'ALCATRA BOVINA MATURADA',
        tipo_produto: 'Produto Acabado',
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
    // PILAR 4: RONDA DE TEMPERATURA DAS CÂMARAS (CADEIA DE FRIO / SIF)
    // ═════════════════════════════════════════════════════════════════════════
    const resTempOk = await app.inject({
      method: 'POST',
      url: '/api/governanca/temperatura',
      headers,
      payload: {
        local_nome: 'CAMARA-RESFRIADA-01',
        tipo_ambiente: 'RESFRIADO',
        temperatura_c: 2.5,
      },
    })
    assert.equal(resTempOk.statusCode, 201, resTempOk.body)
    assert.equal(resTempOk.json().data.conforme, true)
    assert.equal(resTempOk.json().data.desvio_c, 0)

    const resTempAlerta = await app.inject({
      method: 'POST',
      url: '/api/governanca/temperatura',
      headers,
      payload: {
        local_nome: 'CAMARA-CONGELADA-01',
        tipo_ambiente: 'CONGELADO',
        temperatura_c: -6.5, // máximo congelado = -12 -> desvio +5.5°C
        acao_corretiva: 'Acionado técnico refrigeração urgente',
      },
    })
    assert.equal(resTempAlerta.statusCode, 201, resTempAlerta.body)
    assert.equal(resTempAlerta.json().data.conforme, false)
    assert.equal(resTempAlerta.json().data.desvio_c, 5.5)

    const resTempList = await app.inject({
      method: 'GET',
      url: '/api/governanca/temperatura?dias=7',
      headers,
    })
    assert.equal(resTempList.statusCode, 200, resTempList.body)
    const tempJson = resTempList.json()
    assert.equal(tempJson.resumo.total_leituras, 2)
    assert.equal(tempJson.resumo.alertas_fora_faixa, 1)
    assert.equal(tempJson.resumo.conformidade_pct, 50)
    assert.equal(tempJson.resumo.locais_em_alerta, 1)

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 2: TRAVA HARD-STOP FEFO + AUDITORIA DE FURA-FILA NA EXPEDIÇÃO
    // ═════════════════════════════════════════════════════════════════════════
    const cxVencId = uuidv7()
    const cxAntigaId = uuidv7()
    const cxNovaId = uuidv7()
    const cxAcougueMpId = uuidv7()

    await conn.db.insert(estoqueCaixas).values([
      {
        id: cxVencId,
        tenantId,
        filialId,
        eanCaixa: '0070101000001',
        produtoId: prodId,
        endereco: 'CAM-01',
        pesoKg: '20.000',
        custoUnitarioKg: '30.0000',
        validade: isoDiasOffset(-2), // VENCIDA há 2 dias
        status: 'DISPONIVEL',
      },
      {
        id: cxAntigaId,
        tenantId,
        filialId,
        eanCaixa: '0070101000002',
        produtoId: prodId,
        endereco: 'CAM-01',
        pesoKg: '20.000',
        custoUnitarioKg: '30.0000',
        validade: isoDiasOffset(5), // Mais antiga válida
        status: 'DISPONIVEL',
      },
      {
        id: cxNovaId,
        tenantId,
        filialId,
        eanCaixa: '0070101000003',
        produtoId: prodId,
        endereco: 'CAM-02',
        pesoKg: '20.000',
        custoUnitarioKg: '30.0000',
        validade: isoDiasOffset(20), // Mais nova
        status: 'DISPONIVEL',
      },
      {
        id: cxAcougueMpId,
        tenantId,
        filialId,
        eanCaixa: '0070101000099',
        produtoId: prodId,
        endereco: 'ACOUGUE',
        pesoKg: '20.000',
        pesoRestanteKg: '0.000',
        quebraAcougueKg: '6.000', // 70% rendimento real vs 85% esperado -> -15% furo!
        custoUnitarioKg: '30.0000',
        validade: isoDiasOffset(10),
        status: 'CONSUMIDA_ACOUGUE',
      },
    ])

    const resRom = await app.inject({
      method: 'POST',
      url: '/api/romaneios',
      headers,
      payload: { cliente: 'CLIENTE TESTE FEFO' },
    })
    assert.equal(resRom.statusCode, 201, resRom.body)
    const romId = resRom.json().romaneio.id as string

    // 2A) Bipar caixa VENCIDA sem PIN -> BLOQUEADA (422)
    const resBloq = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/caixa`,
      headers,
      payload: { caixa_id: cxVencId },
    })
    assert.equal(resBloq.statusCode, 422, resBloq.body)
    assert.equal(resBloq.json().code, 'CAIXA_VENCIDA_BLOQUEADA')
    assert.ok(resBloq.json().dias_vencida >= 2)

    // 2B) Bipar caixa NOVA existindo caixa ANTIGA -> passa mas retorna alerta_fefo e audita FURO_FILA_FEFO
    const resFuraFila = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/caixa`,
      headers,
      payload: { caixa_id: cxNovaId },
    })
    assert.equal(resFuraFila.statusCode, 200, resFuraFila.body)
    assert.equal(resFuraFila.json().success, true)
    assert.equal(resFuraFila.json().alerta_fefo.existe_mais_antigo, true)
    assert.equal(resFuraFila.json().alerta_fefo.ean_sugerido, '0070101000002')
    assert.equal(resFuraFila.json().alerta_fefo.endereco_sugerido, 'CAM-01')

    // 2C) Bipar caixa VENCIDA com PIN Gerencial válido (1234) -> libera com auditoria crítica
    const resOverride = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/caixa`,
      headers,
      payload: { caixa_id: cxVencId, pin_gerencial: '1234' },
    })
    assert.equal(resOverride.statusCode, 200, resOverride.body)
    assert.equal(resOverride.json().success, true)

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 1: ALARME DE FURO DE RENDIMENTO (DESOSSA OP + AÇOUGUE MP)
    // ═════════════════════════════════════════════════════════════════════════
    const opProdId = uuidv7()
    await conn.db.insert(ordensProducao).values({
      id: opProdId,
      tenantId,
      filialId,
      codigo: 'OP-9001',
      nome: 'DESOSSA TRASEIRO TURNO 1',
      status: 'FECHADA',
      operadorId: opId,
      operadorNome: 'Luciano',
      rendimentoPct: '62.00',
      perdaPct: '38.00',
      custoMpTotal: '3000.00',
      dataProducao: isoDiasOffset(0),
    })
    await conn.db.insert(opInsumos).values({
      id: uuidv7(),
      tenantId,
      opId: opProdId,
      produtoId: prodId,
      pesoKg: '100.000',
      custoUnitarioKg: '30.0000',
      operadorNome: 'Luciano',
    })
    await conn.db.insert(opRetornos).values({
      id: uuidv7(),
      tenantId,
      opId: opProdId,
      produtoId: prodId,
      pesoKg: '62.000',
      operadorNome: 'Luciano',
    })

    const resRend = await app.inject({
      method: 'GET',
      url: '/api/governanca/loss-prevention/rendimento?dias=30&tolerancia_pct=5',
      headers,
    })
    assert.equal(resRend.statusCode, 200, resRend.body)
    const rend = resRend.json()
    assert.equal(rend.resumo.total_ops_anomalia, 1)
    assert.equal(rend.resumo.total_mps_acougue_anomalia, 1)
    assert.equal(rend.resumo.total_anomalias, 2)
    assert.ok(rend.resumo.kg_furo_total >= 15) // 13kg OP + 3kg Acougue = 16kg
    assert.ok(rend.resumo.prejuizo_estimado_total >= 450)

    // ═════════════════════════════════════════════════════════════════════════
    // PILAR 3: AUDITORIA DE ETIQUETAS FANTASMA & SUBFATURAMENTO
    // ═════════════════════════════════════════════════════════════════════════
    await conn.db.insert(etiquetasAcougue).values([
      {
        id: uuidv7(),
        tenantId,
        filialId,
        codigoEtiqueta: 'ETQ90001',
        produtoId: prodId,
        produtoCodigo: '70101',
        produtoDescricao: 'ALCATRA BOVINA MATURADA',
        especie: 'BOVINO',
        conservacao: 'RESFRIADO',
        pesoBrutoKg: '1.500',
        taraKg: '0.0200',
        pesoLiquidoKg: '1.480',
        precoKg: '50.0000',
        valorTotal: '74.00',
        lote: 'L901',
        dataPesagem: isoDiasOffset(-5),
        validade: isoDiasOffset(-2), // Vencida sem venda -> FANTASMA!
        status: 'EM_ESTOQUE',
        operadorId: opId,
        operadorNome: 'Açougueiro Teste',
      },
      {
        id: uuidv7(),
        tenantId,
        filialId,
        codigoEtiqueta: 'ETQ90002',
        produtoId: prodId,
        produtoCodigo: '70101',
        produtoDescricao: 'ALCATRA BOVINA MATURADA',
        especie: 'BOVINO',
        conservacao: 'RESFRIADO',
        pesoBrutoKg: '2.000',
        taraKg: '0.0200',
        pesoLiquidoKg: '1.980',
        precoKg: '20.0000', // Abaixo do custo (30) e 60% abaixo da tabela (50) -> SUBFATURADA!
        valorTotal: '39.60',
        lote: 'L902',
        dataPesagem: isoDiasOffset(0),
        validade: isoDiasOffset(5),
        status: 'VENDIDA',
        operadorId: opId,
        operadorNome: 'Açougueiro Teste',
      },
    ])

    const resEtq = await app.inject({
      method: 'GET',
      url: '/api/governanca/loss-prevention/etiquetas-fantasma?dias=30&dias_fantasma=3',
      headers,
    })
    assert.equal(resEtq.statusCode, 200, resEtq.body)
    const etq = resEtq.json()
    assert.equal(etq.resumo.fantasma_qtd, 1)
    assert.equal(etq.resumo.subfaturada_qtd, 1)
    assert.equal(etq.subfaturadas[0].abaixo_custo, true)
    assert.ok(etq.resumo.risco_total_valor > 100)

    // ═════════════════════════════════════════════════════════════════════════
    // INTEGRAÇÃO NO RADAR ANTIFRAUDE
    // ═════════════════════════════════════════════════════════════════════════
    const resAnti = await app.inject({
      method: 'GET',
      url: '/api/governanca/antifraude?dias=30',
      headers,
    })
    assert.equal(resAnti.statusCode, 200, resAnti.body)
    const anti = resAnti.json()
    assert.equal(anti.resumo.alertas_temperatura_qtd, 1)
    assert.equal(anti.resumo.furos_fefo_qtd, 2)
    assert.ok(anti.eventos.some((e: any) => e.titulo.includes('ALERTA TEMPERATURA CAMARA') && e.severidade === 'ALTA'))
    assert.ok(anti.eventos.some((e: any) => e.titulo.includes('OVERRIDE CAIXA VENCIDA EXPEDICAO') && e.severidade === 'ALTA'))
    assert.ok(anti.eventos.some((e: any) => e.titulo.includes('FURO FILA FEFO') && e.severidade === 'MEDIA'))
  } finally {
    await app.close()
    await conn.close()
  }
})
