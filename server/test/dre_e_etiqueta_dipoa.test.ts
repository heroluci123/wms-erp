import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-dre-dipoa-2026',
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

test('Etapa 1: Registro DIPOA/SISP/SISBI em Filiais, Produtos & Etiquetas + DRE Gerencial & Rentabilidade Real', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // ── PARTE A: FILIAIS SISP 1929 / SISBI 2173 + PRODUTO DIPOA 005 / 007 + ETIQUETA ──
    const resEmps = await app.inject({ method: 'GET', url: '/api/cadastros/empresas', headers })
    assert.equal(resEmps.statusCode, 200)
    const empresaId = resEmps.json().data[0].id as string

    const resFilSisp = await app.inject({
      method: 'POST',
      url: '/api/cadastros/filiais',
      headers,
      payload: {
        empresa_id: empresaId,
        codigo: '1/9',
        nome: 'Unidade SISP SP',
        tipo_unidade: 'DISTRIBUICAO',
        uf: 'SP',
        cidade: 'SAO PAULO',
        registro_sanitario_tipo: 'SISP',
        registro_sanitario_num: '1929',
      },
    })
    assert.equal(resFilSisp.statusCode, 201, resFilSisp.body)

    const resFilSisbi = await app.inject({
      method: 'POST',
      url: '/api/cadastros/filiais',
      headers,
      payload: {
        empresa_id: empresaId,
        codigo: '2/9',
        nome: 'Unidade Indústria SISBI',
        tipo_unidade: 'INDUSTRIA',
        uf: 'SP',
        cidade: 'CAMPINAS',
        registro_sanitario_tipo: 'SISBI',
        registro_sanitario_num: '2173',
      },
    })
    assert.equal(resFilSisbi.statusCode, 201, resFilSisbi.body)

    const resCtxFiliais = await app.inject({ method: 'GET', url: '/api/contexto/filiais', headers })
    assert.equal(resCtxFiliais.statusCode, 200)
    const fSisp = resCtxFiliais.json().data.find((f: any) => f.codigo === '1/9')
    const fSisbi = resCtxFiliais.json().data.find((f: any) => f.codigo === '2/9')
    assert.equal(fSisp.registro_sanitario_tipo, 'SISP')
    assert.equal(fSisp.registro_sanitario_num, '1929')
    assert.ok(fSisp.empresa_razao_social, 'Contexto da filial deve trazer razão social da empresa para a etiqueta')
    assert.equal(fSisbi.registro_sanitario_tipo, 'SISBI')
    assert.equal(fSisbi.registro_sanitario_num, '2173')

    // Cadastrar 2 produtos com DIPOA distintos (Picanha = 005, Acém = 012)
    const resPic = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '77005',
        descricao: 'PICANHA BOVINA RESFRIADA',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        unidade: 'KG',
        custo_medio_kg: 40,
        valor_unitario: 70,
        registro_dipoa: '005',
      },
    })
    assert.equal(resPic.statusCode, 201, resPic.body)
    const picanhaId = resPic.json().id as string

    const resAcem = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '77012',
        descricao: 'ACEM BOVINO PROMOCAO',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        unidade: 'KG',
        custo_medio_kg: 28,
        valor_unitario: 25,
        registro_dipoa: '012',
      },
    })
    assert.equal(resAcem.statusCode, 201, resAcem.body)
    const acemId = resAcem.json().id as string

    // Verificar propagação do DIPOA na listagem de produtos e na geração de etiqueta da doca
    const resProds = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    const picRow = resProds.json().data.find((p: any) => p.id === picanhaId)
    assert.equal(picRow.registro_dipoa, '005')

    const resForn = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { codigo: 'DRE-F1', razao_social: 'FRIGORIFICO DRE LTDA', uf: 'SP' },
    })
    const fornId = resForn.json().id as string

    const resPc = await app.inject({
      method: 'POST',
      url: '/api/compras',
      headers,
      payload: {
        fornecedor_id: fornId,
        finalidade: 'REVENDA',
        aprovar: true,
        itens: [{ produto_id: picanhaId, qtd_kg_solicitada: 25, preco_unitario_kg: 40 }], // R$ 1.000 compra mercadoria
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
        produto_id: picanhaId,
        pedido_compra_id: pcId,
        exigir_pedido_compra: true,
        peso_bruto_kg: 25.5,
        tara_id: null,
        tara_kg: 0.5,
        peso_kg: 25.0,
        qtd_pecas: 12,
        data_producao: '2026-11-19',
        validade: '2026-12-25',
        lote: '191126',
        endereco: 'REC',
      },
    })
    assert.equal(resCx.statusCode, 201, resCx.body)
    assert.equal(resCx.json().caixa.registro_dipoa, '005', 'Caixa gerada na doca deve carregar registro_dipoa para a etiqueta testeira')

    // Finalizar PC -> gera título COMPRA_PC de R$ 1.000 (NÃO deve entrar em Despesas Operacionais do DRE!)
    const resFinPc = await app.inject({
      method: 'POST',
      url: `/api/recebimento/pedidos/${pcId}/finalizar-doca`,
      headers,
      payload: {},
    })
    assert.equal(resFinPc.statusCode, 200, resFinPc.body)

    // ── PARTE B: DRE GERENCIAL (COMPETÊNCIA & CAIXA) + RENTABILIDADE REAL ──
    const resVend = await app.inject({
      method: 'POST',
      url: '/api/cadastros/vendedores',
      headers,
      payload: {
        codigo: 'V-DRE',
        sigla: 'VD',
        nome: 'ROBERTO VENDAS DRE',
        tipo_comissao: 'PCT_VENDA',
        pct_comissao: 5,
        regra_liberacao: 'FATURAMENTO',
      },
    })
    const vendId = resVend.json().id as string

    const resCli = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: 'DRE-C1',
        razao_social: 'STEAKHOUSE NOBRE LTDA',
        nome_fantasia: 'Steakhouse Nobre',
        uf: 'SP',
        vendedor_id: vendId,
      },
    })
    const cliId = resCli.json().id as string

    // Pedido 1 (Saudável): 20 kg Picanha @ R$ 70 = R$ 1.400 (CMV = 20 × R$ 40 = R$ 800 → Lucro R$ 600 / 42,86%)
    const resPed1 = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Steakhouse Picanha',
        cliente_id: cliId,
        cliente_nome: 'Steakhouse Nobre',
        vendedor_id: vendId,
        liberar_agora: true,
        itens: [{ produto_id: picanhaId, qtd_kg_solicitada: 20, preco_unitario: 70 }],
      },
    })
    assert.equal(resPed1.statusCode, 201, resPed1.body)

    // Pedido 2 (Prejuízo!): 10 kg Acém @ R$ 25 = R$ 250 (CMV = 10 × R$ 28 = R$ 280 → Prejuízo -R$ 30 / -12%)
    const resPed2 = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Queima Estoque Acém',
        cliente_id: cliId,
        cliente_nome: 'Steakhouse Nobre',
        vendedor_id: vendId,
        liberar_agora: true,
        itens: [{ produto_id: acemId, qtd_kg_solicitada: 10, preco_unitario: 25 }],
      },
    })
    assert.equal(resPed2.statusCode, 201, resPed2.body)

    const hoje = new Date().toISOString().slice(0, 10)
    const inicioMes = `${hoje.slice(0, 7)}-01`

    // Despesa Operacional: Energia Câmara Fria R$ 200 (MANUAL) + Comissão R$ 70 + Tarifa Avulsa R$ 50
    const resContas = await app.inject({ method: 'GET', url: '/api/financeiro/contas', headers })
    const contaId = resContas.json().data[0].id as string

    const resAux = await app.inject({ method: 'GET', url: '/api/cadastros/auxiliares', headers })
    const ccId = resAux.json().data?.centrosCusto?.[0]?.id || null

    const resDesp = await app.inject({
      method: 'POST',
      url: '/api/financeiro/titulos',
      headers,
      payload: {
        tipo: 'PAGAR',
        descricao: 'Energia Elétrica Câmara Fria',
        centro_custo_id: ccId,
        data_vencimento: hoje,
        valor_original: 200,
      },
    })
    assert.equal(resDesp.statusCode, 201, resDesp.body)

    const resComPag = await app.inject({
      method: 'POST',
      url: '/api/financeiro/comissoes/gerar-pagar',
      headers,
      payload: {
        vendedor_id: vendId,
        valor: 70,
        data_vencimento: hoje,
        periodo_label: 'Mês Atual',
      },
    })
    assert.equal(resComPag.statusCode, 201, resComPag.body)

    const resTarifa = await app.inject({
      method: 'POST',
      url: '/api/financeiro/movimentacoes',
      headers,
      payload: {
        conta_bancaria_id: contaId,
        tipo: 'SAIDA',
        data_movimento: hoje,
        valor: 50,
        forma_pagamento: 'DEBITO_AUTO',
        historico: 'Tarifa bancária mensal',
      },
    })
    assert.equal(resTarifa.statusCode, 201, resTarifa.body)

    // 1. Validar DRE Gerencial (Competência)
    const resDre = await app.inject({
      method: 'GET',
      url: `/api/financeiro/dre?data_inicio=${inicioMes}&data_fim=${hoje}&regime=COMPETENCIA`,
      headers,
    })
    assert.equal(resDre.statusCode, 200, resDre.body)
    const dre = resDre.json()
    assert.equal(dre.kpis.receita_bruta, 1650) // 1400 + 250
    assert.equal(dre.kpis.receita_liquida, 1650)
    assert.equal(dre.kpis.cmv_real, 1080) // 800 + 280
    assert.equal(dre.kpis.lucro_bruto, 570) // 1650 - 1080
    assert.equal(dre.kpis.despesas_operacionais, 250, 'Compra de mercadoria (R$ 1000) não pode duplicar em despesas operacionais')
    assert.equal(dre.kpis.comissoes, 70)
    assert.equal(dre.kpis.comissao_origem, 'LANCADA')
    assert.equal(dre.kpis.lucro_liquido, 250) // 570 - 250 - 70
    assert.equal(dre.evolucao_mensal.length, 6)
    assert.ok(dre.despesas_por_centro_custo.length >= 2, 'Deve detalhar Centro de Custo e Tarifas Avulsas')

    // 2. Validar Rentabilidade Real (Produto, Cliente, Vendedor, Pedido)
    const resRent = await app.inject({
      method: 'GET',
      url: `/api/financeiro/rentabilidade?data_inicio=${inicioMes}&data_fim=${hoje}`,
      headers,
    })
    assert.equal(resRent.statusCode, 200, resRent.body)
    const rent = resRent.json()
    assert.equal(rent.resumo.qtd_pedidos, 2)
    assert.equal(rent.resumo.receita_total, 1650)
    assert.equal(rent.resumo.custo_total, 1080)
    assert.equal(rent.resumo.margem_total_rs, 570)
    assert.equal(rent.resumo.pedidos_prejuizo, 1, 'Pedido de Acém abaixo do custo deve sinalizar alerta PREJUIZO')

    const rPic = rent.por_produto.find((p: any) => p.produto_id === picanhaId)
    const rAcem = rent.por_produto.find((p: any) => p.produto_id === acemId)
    assert.equal(rPic.margem_rs, 600)
    assert.equal(rPic.alerta_margem, 'SAUDAVEL')
    assert.equal(rAcem.margem_rs, -30)
    assert.equal(rAcem.alerta_margem, 'PREJUIZO')

    assert.equal(rent.por_cliente.length, 1)
    assert.equal(rent.por_cliente[0].receita, 1650)
    assert.equal(rent.por_vendedor.length, 1)
    assert.equal(rent.por_vendedor[0].comissao_estimada, 82.5) // 5% de 1650
  } finally {
    await app.close()
    await conn.close()
  }
})
