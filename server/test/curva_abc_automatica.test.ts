import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import {
  estoqueCaixas,
  opInsumos,
  ordensProducao,
  pdvCaixas,
  pdvVendas,
  pedidos,
  pedidosItens,
} from '../src/db/schema/index.js'
import { uuidv7 } from '../src/utils/uuid.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-curva-abc-automatica-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Curva ABC 100% Automática: bloqueia edição manual e classifica por Produção + Açougue + Vendas Diretas', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
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

    const criarProduto = async (payload: Record<string, unknown>) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/cadastros/produtos',
        headers,
        payload,
      })
      assert.equal(res.statusCode, 201, `Falha criando produto: ${res.body}`)
      return res.json().id as string
    }

    // 1) Criar 5 produtos — tentando forçar status_curva: 'A' manualmente em todos (deve ser ignorado -> inicia como 'C')
    const idMpAlto = await criarProduto({
      codigo: '91001',
      descricao: 'DIANTEIRO BOVINO MP DESOSSA',
      tipo_produto: 'Materia Prima',
      classificacao: 'MATERIA_PRIMA',
      custo_medio_kg: 40,
      valor_unitario: 40,
      status_curva: 'A',
    })
    const idPaVenda = await criarProduto({
      codigo: '91002',
      descricao: 'PICANHA PORCIONADA VENDA DIRETA',
      tipo_produto: 'Produto Acabado',
      custo_medio_kg: 55,
      valor_unitario: 100,
      status_curva: 'A',
    })
    const idMpAcougue = await criarProduto({
      codigo: '91003',
      descricao: 'ALCATRA MP BALCAO ACOUGUE',
      tipo_produto: 'Materia Prima',
      classificacao: 'MATERIA_PRIMA',
      custo_medio_kg: 30,
      valor_unitario: 30,
      status_curva: 'A',
    })
    const idPaBaixo = await criarProduto({
      codigo: '91004',
      descricao: 'COSTELA RIPA BAIXO GIRO',
      tipo_produto: 'Produto Acabado',
      custo_medio_kg: 20,
      valor_unitario: 30,
      status_curva: 'A',
    })
    const idSemGiro = await criarProduto({
      codigo: '91005',
      descricao: 'PRODUTO SEM MOVIMENTACAO',
      tipo_produto: 'Produto Acabado',
      custo_medio_kg: 25,
      valor_unitario: 35,
      status_curva: 'A',
    })

    // Verifica que nenhum produto recebeu Curva A manualmente na criação
    const listaInicial = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    assert.equal(listaInicial.statusCode, 200)
    const mapInicial = new Map<string, any>(listaInicial.json().data.map((p: any) => [p.id, p]))
    for (const id of [idMpAlto, idPaVenda, idMpAcougue, idPaBaixo, idSemGiro]) {
      assert.equal(mapInicial.get(id)?.status_curva, 'C', 'Produto novo sem giro deve iniciar como Curva C')
    }

    // 2) Simular giro operacional real (total = R$ 10.000):
    // 2a) MP_ALTO enviada para OP de Produção: 150 kg x R$ 40 = R$ 6.000 (60% -> acumAntes 0% -> A)
    const ordemId = uuidv7()
    await conn.db.insert(ordensProducao).values({
      id: ordemId,
      tenantId,
      filialId,
      codigo: 'OP-ABC-001',
      nome: 'DESOSSA TESTE CURVA ABC',
      status: 'CONCLUIDA',
      operadorId: opId,
      operadorNome: 'Luciano',
    })
    await conn.db.insert(opInsumos).values({
      id: uuidv7(),
      tenantId,
      opId: ordemId,
      produtoId: idMpAlto,
      pesoKg: '150.000',
      custoUnitarioKg: '40.0000',
      lote: 'LOTE-MP-1',
      operadorNome: 'Luciano',
    })

    // 2b) PA_VENDA vendida direto no Atacado (15 kg x R$ 100 = R$ 1.500) + PDV Varejo (10 kg x R$ 100 = R$ 1.000) = R$ 2.500
    // (25% -> acumAntes 60% < 80% -> A)
    // E PA_BAIXO vendida direto no Atacado (10 kg x R$ 30 = R$ 300) (3% -> acumAntes 97% >= 95% -> C)
    const pedidoId = uuidv7()
    await conn.db.insert(pedidos).values({
      id: pedidoId,
      tenantId,
      filialId,
      codigo: 'PED-ABC-001',
      titulo: 'PEDIDO TESTE CURVA ABC',
      cliente: 'CLIENTE TESTE ABC',
      status: 'EXPEDIDO',
      valorTotal: '1800.00',
      criadoPorId: opId,
      criadoPorNome: 'Luciano',
    })
    await conn.db.insert(pedidosItens).values([
      {
        id: uuidv7(),
        tenantId,
        pedidoId,
        produtoId: idPaVenda,
        qtdKgSolicitada: '15.000',
        precoUnitario: '100.0000',
        custoUnitarioRef: '55.0000',
      },
      {
        id: uuidv7(),
        tenantId,
        pedidoId,
        produtoId: idPaBaixo,
        qtdKgSolicitada: '10.000',
        precoUnitario: '30.0000',
        custoUnitarioRef: '20.0000',
      },
    ])

    const pdvCxId = uuidv7()
    await conn.db.insert(pdvCaixas).values({
      id: pdvCxId,
      tenantId,
      filialId,
      codigo: 'CX-ABC-001',
      operadorId: opId,
      operadorNome: 'Luciano',
      status: 'ABERTO',
    })
    await conn.db.insert(pdvVendas).values({
      id: uuidv7(),
      tenantId,
      filialId,
      caixaId: pdvCxId,
      codigo: 'PDV-ABC-001',
      subtotal: '1000.00',
      valorTotal: '1000.00',
      status: 'CONCLUIDA',
      itensJson: [
        {
          produto_id: idPaVenda,
          codigo: '91002',
          descricao: 'PICANHA PORCIONADA VENDA DIRETA',
          qtd: 10,
          preco_unitario: 100,
          subtotal: 1000,
        },
      ],
    })

    // 2c) MP_ACOUGUE enviada e aberta no balcão do açougue: 40 kg x R$ 30 = R$ 1.200
    // (12% -> acumAntes 85% >= 80% && < 95% -> B)
    await conn.db.insert(estoqueCaixas).values({
      id: uuidv7(),
      tenantId,
      filialId,
      eanCaixa: 'EAN-ABC-ACOUGUE-001',
      produtoId: idMpAcougue,
      endereco: 'ACOUGUE',
      lote: 'LOTE-AC-1',
      pesoKg: '40.000',
      custoUnitarioKg: '30.0000',
      status: 'ABERTA_ACOUGUE',
      entradaAcougueEm: new Date(),
      entradaAcouguePor: 'Luciano',
    })

    // 3) Recalcular automaticamente via endpoint
    const recRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos/recalcular-curva-abc',
      headers,
      payload: { dias: 90 },
    })
    assert.equal(recRes.statusCode, 200, recRes.body)
    const recJson = recRes.json().data
    assert.equal(recJson.criterio, 'VALOR')
    assert.equal(recJson.valor_producao_total, 7200) // 6000 OP + 1200 Açougue
    assert.equal(recJson.valor_venda_direta_total, 2800) // 1500 + 1000 + 300
    assert.equal(recJson.classe_a, 2)
    assert.equal(recJson.classe_b, 1)

    const porIdRec = new Map<string, any>(recJson.itens.map((x: any) => [x.produto_id, x]))
    assert.equal(porIdRec.get(idMpAlto)?.classe_abc, 'A')
    assert.equal(porIdRec.get(idMpAlto)?.origem_predominante, 'PRODUCAO')
    assert.equal(porIdRec.get(idPaVenda)?.classe_abc, 'A')
    assert.equal(porIdRec.get(idPaVenda)?.origem_predominante, 'VENDA_DIRETA')
    assert.equal(porIdRec.get(idMpAcougue)?.classe_abc, 'B')
    assert.equal(porIdRec.get(idMpAcougue)?.origem_predominante, 'PRODUCAO')
    assert.equal(porIdRec.get(idPaBaixo)?.classe_abc, 'C')
    assert.equal(porIdRec.get(idSemGiro)?.classe_abc, 'C')
    assert.equal(porIdRec.get(idSemGiro)?.origem_predominante, 'SEM_GIRO')

    // 4) Conferir persistência em GET /api/cadastros/produtos e resumo-gerencial
    const listaAtualizada = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    assert.equal(listaAtualizada.statusCode, 200)
    const mapAtual = new Map<string, any>(listaAtualizada.json().data.map((p: any) => [p.id, p]))
    assert.equal(mapAtual.get(idMpAlto)?.status_curva, 'A')
    assert.equal(mapAtual.get(idPaVenda)?.status_curva, 'A')
    assert.equal(mapAtual.get(idMpAcougue)?.status_curva, 'B')
    assert.equal(mapAtual.get(idPaBaixo)?.status_curva, 'C')
    assert.equal(mapAtual.get(idSemGiro)?.status_curva, 'C')

    const resumoRes = await app.inject({
      method: 'GET',
      url: `/api/cadastros/produtos/${idMpAlto}/resumo-gerencial`,
      headers,
    })
    assert.equal(resumoRes.statusCode, 200)
    assert.equal(resumoRes.json().data.status_curva, 'A')

    // 5) Editar produto tentando rebaixar status_curva para 'C' manualmente -> deve PRESERVAR 'A'
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/produtos/${idMpAlto}`,
      headers,
      payload: {
        codigo: '91001',
        descricao: 'DIANTEIRO BOVINO MP DESOSSA EDITADO',
        tipo_produto: 'Materia Prima',
        classificacao: 'MATERIA_PRIMA',
        custo_medio_kg: 40,
        valor_unitario: 40,
        status_curva: 'C',
      },
    })
    assert.equal(putRes.statusCode, 200)
    const listaPosPut = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    const prodPosPut = listaPosPut.json().data.find((p: any) => p.id === idMpAlto)
    assert.equal(prodPosPut.descricao, 'DIANTEIRO BOVINO MP DESOSSA EDITADO')
    assert.equal(prodPosPut.status_curva, 'A', 'PUT nunca deve sobrescrever a Curva ABC automática')

    // 6) Conferir relatório BI /api/relatorios/bi/curva-abc-demanda
    const biRes = await app.inject({
      method: 'GET',
      url: '/api/relatorios/bi/curva-abc-demanda',
      headers,
    })
    assert.equal(biRes.statusCode, 200)
    const biJson = biRes.json()
    assert.equal(biJson.success, true)
    assert.equal(biJson.resumo.valor_producao_total, 7200)
    assert.equal(biJson.resumo.valor_venda_direta_total, 2800)
    assert.equal(biJson.resumo.classe_a.skus, 2)
    assert.equal(biJson.resumo.classe_b.skus, 1)
  } finally {
    await app.close()
    await conn.close()
  }
})
