import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-etapa5-comercial-trava-margem-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Etapa 5: Comercial Atacado, Preço em Cascata, Trava de Margem/Desconto/Crédito, Mesa de Aprovação (PIN) e CRM Visitas', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // 1. Login MASTER Luciano
    const loginMaster = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(loginMaster.statusCode, 200)
    const masterHeaders = { authorization: `Bearer ${loginMaster.json().token}` }
    const masterId = loginMaster.json().operador.id as string

    // Definir PIN gerencial (9988) para o Master
    const pinRes = await app.inject({
      method: 'PUT',
      url: `/api/operadores/${masterId}`,
      headers: masterHeaders,
      payload: { pin_gerencial: '9988' },
    })
    assert.equal(pinRes.statusCode, 200, pinRes.body)

    // Ativar Trava de Margem + Trava de Crédito no tenant
    const cfgPatch = await app.inject({
      method: 'PATCH',
      url: '/api/configuracoes/modulos',
      headers: masterHeaders,
      payload: {
        trava_margem_ativa: true,
        trava_credito_ativa: true,
        margem_minima_padrao_pct: 15,
        desconto_max_vendedor_pct: 5,
        dias_tolerancia_inadimplencia: 3,
        bloquear_venda_abaixo_custo: true,
      },
    })
    assert.equal(cfgPatch.statusCode, 200, cfgPatch.body)

    const cfgGet = await app.inject({ method: 'GET', url: '/api/comercial/config', headers: masterHeaders })
    assert.equal(cfgGet.statusCode, 200)
    assert.equal(cfgGet.json().data.trava_margem_ativa, true)
    assert.equal(cfgGet.json().data.margem_minima_padrao_pct, 15)

    // 2. Criar operador Vendedor comum (sem nível MASTER) + registro de Vendedor vinculado
    const opVendRes = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers: masterHeaders,
      payload: {
        nome: 'Vendedor Externo João',
        login: 'vendjoao',
        senha: '1234',
        perfil: 'OPERADOR',
        nivel: 'OPERACIONAL',
        setor: 'COMERCIAL',
        deve_trocar_senha: false,
        permissoes: { pedidos: true, clientes: true, vendedores: true },
      },
    })
    assert.equal(opVendRes.statusCode, 201, opVendRes.body)
    const opVendId = opVendRes.json().id as string

    const vendRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/vendedores',
      headers: masterHeaders,
      payload: {
        codigo: 'V50',
        sigla: 'JV',
        nome: 'JOÃO VENDEDOR',
        operador_id: opVendId,
        tipo_comissao: 'PCT_VENDA',
        pct_comissao: 2.5,
        regra_liberacao: 'FATURAMENTO',
        meta_mensal_kg: 500,
        meta_mensal_valor: 25000,
        desconto_max_pct: 5,
        margem_minima_pct: 15,
      },
    })
    assert.equal(vendRes.statusCode, 201, vendRes.body)
    const vendedorId = vendRes.json().id as string

    const loginVend = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'vendjoao', senha: '1234' },
    })
    assert.equal(loginVend.statusCode, 200)
    const vendHeaders = { authorization: `Bearer ${loginVend.json().token}` }

    // 3. Cadastrar produto com custo 40,00 e base 60,00 + dar entrada em estoque (100 kg)
    const prodRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers: masterHeaders,
      payload: {
        codigo: '50100',
        descricao: 'CONTRA FILE ATACADO PRIME',
        tipo_produto: 'Produto Acabado',
        unidade: 'KG',
        custo_medio_kg: 40.0,
        valor_unitario: 60.0,
      },
    })
    assert.equal(prodRes.statusCode, 201, prodRes.body)
    const prodId = prodRes.json().id as string

    const taraRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/taras',
      headers: masterHeaders,
      payload: { nome: 'Caixa 1kg Com', peso_kg: 1.0 },
    })
    assert.equal(taraRes.statusCode, 201)

    const recRes = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers: masterHeaders,
      payload: {
        ean_caixa: '7890005000011',
        produto_id: prodId,
        endereco: 'A-01-01',
        data_producao: '2026-11-23',
        validade: '2026-12-30',
        peso_bruto_kg: 101.0,
        tara_id: taraRes.json().id,
        tara_kg: 1.0,
        qtd_pecas: 10,
      },
    })
    assert.equal(recRes.statusCode, 201, recRes.body)

    // 4. Criar Tabela de Preço ATACADO (R$ 55/kg) + Cliente B2B com Limite R$ 2.000 + Contrato Negociado (R$ 52/kg)
    const tabRes = await app.inject({
      method: 'POST',
      url: '/api/tabelas-preco',
      headers: masterHeaders,
      payload: {
        nome: 'Tabela Atacado Padrão',
        finalidade: 'ATACADO',
        padrao: true,
      },
    })
    assert.equal(tabRes.statusCode, 201, tabRes.body)
    const tabId = tabRes.json().data.id as string

    const tabItemRes = await app.inject({
      method: 'POST',
      url: `/api/tabelas-preco/${tabId}/itens`,
      headers: masterHeaders,
      payload: { itens: [{ produto_id: prodId, preco_venda: 55.0 }] },
    })
    assert.equal(tabItemRes.statusCode, 200, tabItemRes.body)

    const cliRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers: masterHeaders,
      payload: {
        codigo: 'C500',
        razao_social: 'SUPERMERCADO ESTRELA DO SUL LTDA',
        nome_fantasia: 'Estrela do Sul',
        cidade: 'CAMPINAS',
        uf: 'SP',
        telefone: '19988887777',
        vendedor_padrao_id: vendedorId,
        tabela_preco_id: tabId,
        limite_credito: 2000,
        permite_pagamento_entrega: 1,
      },
    })
    assert.equal(cliRes.statusCode, 201, cliRes.body)
    const cliId = cliRes.json().id as string

    const especRes = await app.inject({
      method: 'POST',
      url: `/api/cadastros/clientes/${cliId}/especificacoes`,
      headers: masterHeaders,
      payload: {
        produto_id: prodId,
        codigo_aux_cliente: 'EXT-99',
        especificacao_corte: 'Sem gordura excessiva',
        preco_negociado: 52.0,
        alerta_reclamacao: 1,
        alerta_descricao: 'Cliente reclamou de embalagem furada na última entrega',
      },
    })
    assert.equal(especRes.statusCode, 200, especRes.body)

    // 5. Catálogo personalizado do cliente: cascata deve priorizar CONTRATO_CLIENTE (52,00) + alerta qualidade + saldo 100kg
    const catRes = await app.inject({
      method: 'GET',
      url: `/api/comercial/catalogo-cliente/${cliId}`,
      headers: vendHeaders,
    })
    assert.equal(catRes.statusCode, 200, catRes.body)
    const catBody = catRes.json()
    assert.equal(catBody.saude_financeira.semaforo, 'VERDE')
    const prodCat = catBody.catalogo.find((p: any) => p.id === prodId)
    assert.ok(prodCat)
    assert.equal(prodCat.origem_preco, 'CONTRATO_CLIENTE')
    assert.equal(prodCat.preco_sugerido, 52)
    assert.equal(prodCat.custo_unitario, 40)
    assert.equal(prodCat.saldo_kg, 100)
    assert.equal(prodCat.alerta_reclamacao, true)

    // 6. Simulador de Margem: preço R$ 35 (< custo 40) dispara bloqueado_abaixo_custo
    const simRes = await app.inject({
      method: 'POST',
      url: '/api/comercial/simular-margem',
      headers: vendHeaders,
      payload: {
        cliente_id: cliId,
        vendedor_id: vendedorId,
        forcar_regras: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 10, preco_unitario: 35, desconto_pct: 0 }],
      },
    })
    assert.equal(simRes.statusCode, 200, simRes.body)
    assert.equal(simRes.json().data.alerta.exige_aprovacao, true)
    assert.equal(simRes.json().data.alerta.bloqueado_abaixo_custo, true)
    assert.ok(simRes.json().data.margem_bruta_pct < 0)

    // 7. Vendedor lança pedido com desconto 10% (> 5%) e margem baixa -> BLOQUEADO_COMERCIAL + sem título financeiro + pendência
    const pedBloqRes = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: vendHeaders,
      payload: {
        titulo: '',
        cliente_id: cliId,
        vendedor_id: vendedorId,
        previsao_entrega: '2026-11-25',
        origem_pedido: 'VENDEDOR',
        liberar: true,
        aplicar_trava_comercial: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 20, preco_unitario: 46, desconto_pct: 10 }],
      },
    })
    assert.equal(pedBloqRes.statusCode, 201, pedBloqRes.body)
    const pedBloq = pedBloqRes.json()
    assert.equal(pedBloq.status, 'BLOQUEADO_COMERCIAL')
    assert.equal(pedBloq.trava_comercial, true)
    assert.equal(pedBloq.alerta_comercial.bloqueado_margem, true)
    assert.equal(pedBloq.alerta_comercial.bloqueado_desconto, true)
    const ped1Id = pedBloq.id as string

    // Enquanto BLOQUEADO_COMERCIAL, NÃO deve gerar título no Financeiro
    const finAntes = await app.inject({ method: 'GET', url: '/api/financeiro/titulos?tipo=RECEBER', headers: masterHeaders })
    assert.equal(finAntes.statusCode, 200)
    assert.equal(
      finAntes.json().data.filter((t: any) => t.pedido_venda_id === ped1Id).length,
      0,
      'Pedido bloqueado comercialmente não pode gerar Contas a Receber antes de aprovado',
    )

    // Central de Pendências deve acusar filaAoVivo.pedidos_trava_comercial >= 1
    const pendRes = await app.inject({ method: 'GET', url: '/api/pendencias', headers: masterHeaders })
    assert.equal(pendRes.statusCode, 200)
    assert.ok(pendRes.json().filaAoVivo.pedidos_trava_comercial >= 1)
    assert.ok(pendRes.json().data.some((p: any) => p.tipo_pendencia === 'TRAVA_COMERCIAL_PEDIDO' && p.referencia_id === ped1Id))

    // 8. POST /api/pedidos/:id/liberar comum deve ser bloqueado (409) enquanto BLOQUEADO_COMERCIAL
    const libBlock = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${ped1Id}/liberar`,
      headers: vendHeaders,
      payload: {},
    })
    assert.equal(libBlock.statusCode, 409)

    // 9. Vendedor comum NÃO pode aprovar sem PIN gerencial (403)
    const aprovSemPin = await app.inject({
      method: 'POST',
      url: `/api/comercial/pedidos/${ped1Id}/aprovar`,
      headers: vendHeaders,
      payload: { observacao: 'Tentativa sem PIN' },
    })
    assert.equal(aprovSemPin.statusCode, 403)

    // Fila de aprovações deve listar ped1Id
    const filaAprov = await app.inject({ method: 'GET', url: '/api/comercial/aprovacoes?status=PENDENTES', headers: masterHeaders })
    assert.equal(filaAprov.statusCode, 200)
    assert.ok(filaAprov.json().data.some((p: any) => p.id === ped1Id))

    // 10. Aprovação com PIN Gerencial válido (9988) -> libera pedido (LIBERADO) + gera Contas a Receber!
    const aprovPin = await app.inject({
      method: 'POST',
      url: `/api/comercial/pedidos/${ped1Id}/aprovar`,
      headers: vendHeaders,
      payload: { pin_gerencial: '9988', observacao: 'Aprovado pela diretoria para fechamento de carga' },
    })
    assert.equal(aprovPin.statusCode, 200, aprovPin.body)
    assert.equal(aprovPin.json().status, 'LIBERADO')

    const finDepois = await app.inject({ method: 'GET', url: '/api/financeiro/titulos?tipo=RECEBER', headers: masterHeaders })
    assert.equal(finDepois.statusCode, 200)
    assert.equal(
      finDepois.json().data.filter((t: any) => t.pedido_venda_id === ped1Id).length,
      1,
      'Após aprovação comercial, Contas a Receber deve ser sincronizado automaticamente',
    )

    // 11. Trava de Limite de Crédito: pedido 1 consumiu R$ 828; pedido 2 de R$ 1.560 (30kg x R$ 52) ultrapassa limite de R$ 2.000!
    const pedCredRes = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: vendHeaders,
      payload: {
        titulo: '',
        cliente_id: cliId,
        vendedor_id: vendedorId,
        previsao_entrega: '2026-11-26',
        pagamento_na_entrega: 0,
        origem_pedido: 'VENDEDOR',
        liberar: true,
        aplicar_trava_comercial: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 30, preco_unitario: 52, desconto_pct: 0 }],
      },
    })
    assert.equal(pedCredRes.statusCode, 201, pedCredRes.body)
    assert.equal(pedCredRes.json().status, 'BLOQUEADO_COMERCIAL')
    assert.equal(pedCredRes.json().alerta_comercial.bloqueado_credito, true)
    const ped2Id = pedCredRes.json().id as string

    // Master devolve pedido 2 para RASCUNHO via Mesa Comercial
    const rejRes = await app.inject({
      method: 'POST',
      url: `/api/comercial/pedidos/${ped2Id}/rejeitar`,
      headers: masterHeaders,
      payload: { motivo: 'Cliente sem limite; solicitar pagamento na entrega via PIX.' },
    })
    assert.equal(rejRes.statusCode, 200, rejRes.body)
    assert.equal(rejRes.json().status, 'RASCUNHO')

    // 12. CRM Check-in de Visita com GPS
    const visPost = await app.inject({
      method: 'POST',
      url: '/api/comercial/visitas',
      headers: vendHeaders,
      payload: {
        cliente_id: cliId,
        tipo: 'PRESENCIAL',
        resultado: 'PEDIDO_GERADO',
        pedido_id: ped1Id,
        observacoes: 'Visita presencial no açougue do supermercado, negociação concluída.',
        lat: -22.9099,
        lng: -47.0626,
        proximo_contato_em: '2026-12-01',
      },
    })
    assert.equal(visPost.statusCode, 201, visPost.body)

    const visGet = await app.inject({ method: 'GET', url: '/api/comercial/visitas', headers: vendHeaders })
    assert.equal(visGet.statusCode, 200)
    assert.equal(visGet.json().data.length, 1)
    assert.equal(visGet.json().data[0].lat, -22.9099)

    // 13. Cockpit Resumo do Vendedor & Ranking Comercial
    const resVend = await app.inject({
      method: 'GET',
      url: '/api/comercial/resumo-vendedor',
      headers: vendHeaders,
    })
    assert.equal(resVend.statusCode, 200, resVend.body)
    const rv = resVend.json()
    assert.equal(rv.vendedor_atual.id, vendedorId)
    assert.equal(rv.kpis.qtd_pedidos, 1)
    assert.equal(rv.kpis.kg_vendido, 20)
    assert.equal(rv.kpis.valor_vendido, 828)
    assert.equal(rv.kpis.comissao_estimada, 20.7) // 2.5% de 828
    assert.ok(rv.carteira_clientes.some((c: any) => c.id === cliId))
    assert.ok(rv.ranking_vendedores.some((r: any) => r.vendedor_id === vendedorId))
  } finally {
    await app.close()
    await conn.close()
  }
})
