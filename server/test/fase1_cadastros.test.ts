import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-fase1-cadastros-wms-erp-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Fase 1: Cadastros Mestres, Multi-Filial (x-filial-id), Clientes+Espec, CFOP e Pedido Financeiro -> Pendencia Supply Chain', async () => {
  const conn = await createDbConnection(TEST_ENV)
  const seed = await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(loginRes.statusCode, 200)
    const token = loginRes.json().token as string
    const headers = { authorization: `Bearer ${token}` }

    // 1. Contexto multi-filial & troca pelo header x-filial-id
    const ctxPadrao = await app.inject({ method: 'GET', url: '/api/contexto/filiais', headers })
    assert.equal(ctxPadrao.statusCode, 200)
    assert.equal(ctxPadrao.json().filial_ativa_id, seed.filialIds.estoque)
    assert.equal(ctxPadrao.json().data.length, 3)

    const ctxInd = await app.inject({
      method: 'GET',
      url: '/api/contexto/filiais',
      headers: { ...headers, 'x-filial-id': seed.filialIds.industrializacao },
    })
    assert.equal(ctxInd.statusCode, 200)
    assert.equal(ctxInd.json().filial_ativa_id, seed.filialIds.industrializacao)

    // Atualizar filial com registro sanitario DIPOA / SIF 007 / 1929
    const updFil = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/filiais/${seed.filialIds.estoque}`,
      headers,
      payload: {
        codigo: '1/2',
        nome: 'FRIGODIL DISTRIBUICAO',
        tipo_unidade: 'DISTRIBUICAO',
        uf: 'SP',
        cidade: 'CAMPINAS',
        registro_sanitario_tipo: 'SIF',
        registro_sanitario_num: '007 / 1929',
        is_padrao: 1,
      },
    })
    assert.equal(updFil.statusCode, 200)

    const empsRes = await app.inject({ method: 'GET', url: '/api/cadastros/empresas', headers })
    assert.equal(empsRes.statusCode, 200)
    assert.equal(empsRes.json().data[0].filiais.length, 3)

    // Header invalido deve retornar 400/403
    const badFil = await app.inject({
      method: 'GET',
      url: '/api/contexto/filiais',
      headers: { ...headers, 'x-filial-id': 'nao-e-uuid' },
    })
    assert.equal(badFil.statusCode, 400)

    // 2. Fornecedores + Vendedores + Transportadoras & Rotas
    const fornRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'F01',
        razao_social: 'FRIGORIFICO MATRIZ SUL LTDA',
        cnpj_cpf: '11222333000181',
        uf: 'MT',
        cidade: 'CUIABA',
        registro_sanitario_sif: 'SIF 2450',
        prazo_entrega_dias: 4,
      },
    })
    assert.equal(fornRes.statusCode, 201)
    const fornId = fornRes.json().id as string

    const vendRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/vendedores',
      headers,
      payload: {
        codigo: '4',
        sigla: 'CH',
        nome: 'CARLOS HENRIQUE',
        tipo_comissao: 'PCT_VENDA',
        pct_comissao: 2.0,
        regra_liberacao: 'LIQUIDACAO',
        meta_mensal_kg: 15000,
      },
    })
    assert.equal(vendRes.statusCode, 201)
    const vendedorId = vendRes.json().id as string

    const transpRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/transportadoras',
      headers,
      payload: { razao_social: 'FROTA FRIO SP LTDA', placa_padrao: 'FGH9K12', uf: 'SP', cidade: 'CAMPINAS' },
    })
    assert.equal(transpRes.statusCode, 201)
    const transpId = transpRes.json().id as string

    const rotaRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/rotas',
      headers,
      payload: { nome: 'CAMPINAS / RMC', regiao: 'Campinas', transportadora_id: transpId, dias_entrega: 'Seg/Qua/Sex' },
    })
    assert.equal(rotaRes.statusCode, 201)

    // 3. Auxiliares + Sugestao automatica CFOP 510201 vs 610201
    const fpRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/formas-pagamento',
      headers,
      payload: { codigo: '155', descricao: '14/21 DIAS', dias_parcelas: [14, 21], pagamento_na_entrega: 0 },
    })
    assert.equal(fpRes.statusCode, 201)
    const formaPgtoId = fpRes.json().id as string

    const cfopSp = await app.inject({
      method: 'GET',
      url: '/api/cadastros/cfop-sugestao?tipo_movimento=SAIDA&finalidade=REVENDA&uf_parceiro=SP',
      headers,
    })
    assert.equal(cfopSp.statusCode, 200)
    assert.equal(cfopSp.json().data.cfop_completo, '510201')

    const cfopMg = await app.inject({
      method: 'GET',
      url: '/api/cadastros/cfop-sugestao?tipo_movimento=SAIDA&finalidade=REVENDA&uf_parceiro=MG',
      headers,
    })
    assert.equal(cfopMg.statusCode, 200)
    assert.equal(cfopMg.json().data.cfop_completo, '610201')

    // 4. Produtos com embalagem primaria + arvore BOM com % rendimento esperado
    const mpRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '10010',
        descricao: 'PESCOCO T7',
        tipo_produto: 'Materia Prima',
        classificacao: 'MATERIA_PRIMA',
        valor_unitario: 22.5,
      },
    })
    assert.equal(mpRes.statusCode, 201)
    const mpId = mpRes.json().id as string

    const paRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '10108',
        codigo_auxiliar: '4213',
        descricao: 'OSSOBUCO T7',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        valor_unitario: 49.9,
        tara_primaria_peca_kg: 0.015,
        ncm: '02013000',
        cest: '1708300',
        arvore_vinculos: [{ pai_id: mpId, rendimento_esperado_pct: 68.5 }],
      },
    })
    assert.equal(paRes.statusCode, 201)
    const paId = paRes.json().id as string

    const prodsList = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    assert.equal(prodsList.statusCode, 200)
    const paItem = prodsList.json().data.find((x: any) => x.id === paId)
    assert.equal(paItem.tara_primaria_peca_kg, 0.015)
    assert.equal(paItem.arvore_vinculos[0].rendimento_esperado_pct, 68.5)

    // 5. Clientes + Especificacoes & Alerta de Reclamacao Anterior
    const cliRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: '822',
        razao_social: 'GALLE RESTAURANTE BAR LTDA',
        uf: 'SP',
        cidade: 'CAMPINAS',
        vendedor_padrao_id: vendedorId,
        forma_pagamento_padrao_id: formaPgtoId,
        marchante_padrao: 'FRIGODIL ALIMENTOS LTDA',
        rota_padrao_nome: 'CAMPINAS / RMC',
        limite_credito: 25000,
      },
    })
    assert.equal(cliRes.statusCode, 201)
    const clienteId = cliRes.json().id as string

    const espRes = await app.inject({
      method: 'POST',
      url: `/api/cadastros/clientes/${clienteId}/especificacoes`,
      headers,
      payload: {
        produto_id: paId,
        codigo_aux_cliente: '4213',
        especificacao_corte: 'PORCOES UNIFORMES',
        preco_negociado: 49.9,
        alerta_reclamacao: 1,
        alerta_descricao: 'Reclamacao anterior em tamanho das rodelas',
      },
    })
    assert.equal(espRes.statusCode, 200)

    const clisList = await app.inject({ method: 'GET', url: '/api/cadastros/clientes', headers })
    assert.equal(clisList.statusCode, 200)
    const galle = clisList.json().data.find((x: any) => x.id === clienteId)
    assert.equal(galle.vendedor_sigla, 'CH')
    assert.equal(galle.qtd_especificacoes, 1)
    assert.equal(galle.qtd_alertas, 1)

    // 6. Operador Financeiro lanca pedido -> cai automaticamente como pendencia para SUPPLY_CHAIN
    const finUserRes = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers,
      payload: {
        nome: 'Ana Financeiro',
        login: 'anafin',
        senha: '1234',
        deve_trocar_senha: false,
        nivel: 'OPERACIONAL',
        setor: 'Financeiro',
        permissoes: { financeiro_pedidos: true, pedidos_consultar: true, alterar_propria_senha: true },
      },
    })
    assert.equal(finUserRes.statusCode, 201)

    const finLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'anafin', senha: '1234' },
    })
    assert.equal(finLogin.statusCode, 200)
    const finHeaders = { authorization: `Bearer ${finLogin.json().token}` }

    const pedFin = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers: finHeaders,
      payload: {
        titulo: 'Solicitacao Financeiro - Galle',
        cliente_id: clienteId,
        origem_pedido: 'FINANCEIRO',
        setor_solicitante: 'FINANCEIRO',
        itens: [{ produto_id: paId, qtd_kg_solicitada: 5, preco_unitario: 49.9 }],
      },
    })
    assert.equal(pedFin.statusCode, 201)
    assert.equal(pedFin.json().status, 'RASCUNHO')

    const pendRes = await app.inject({
      method: 'GET',
      url: '/api/pendencias?setor=SUPPLY_CHAIN&status=ATIVAS',
      headers,
    })
    assert.equal(pendRes.statusCode, 200)
    assert.ok(pendRes.json().contadores.SUPPLY_CHAIN >= 1)
    const pendItem = pendRes.json().data.find((p: any) => p.referencia_id === pedFin.json().id)
    assert.ok(pendItem)
    assert.equal(pendItem.tipo_pendencia, 'PEDIDO_FINANCEIRO')

    const donePend = await app.inject({
      method: 'PATCH',
      url: `/api/pendencias/${pendItem.id}/status`,
      headers,
      payload: { status: 'CONCLUIDA' },
    })
    assert.equal(donePend.statusCode, 200)
    assert.equal(donePend.json().status, 'CONCLUIDA')

    // 7. RBAC: CLIENTE bloqueado de rotas administrativas/comerciais da Fase 1
    const cliUserRes = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers,
      payload: {
        nome: 'Cliente Portal',
        login: 'cliportal1',
        senha: '1234',
        deve_trocar_senha: false,
        nivel: 'CLIENTE',
        perfil: 'CLIENTE',
      },
    })
    assert.equal(cliUserRes.statusCode, 201)
    const cliLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'cliportal1', senha: '1234' },
    })
    const cliHeaders = { authorization: `Bearer ${cliLogin.json().token}` }

    for (const blocked of ['/api/cadastros/clientes', '/api/cadastros/fornecedores', '/api/cadastros/vendedores', '/api/pendencias']) {
      const r = await app.inject({ method: 'GET', url: blocked, headers: cliHeaders })
      assert.equal(r.statusCode, 403, `CLIENTE deve ser bloqueado em ${blocked}`)
    }

    // Limpeza de fornecedor/vendedor criado (soft delete funciona 200)
    const delForn = await app.inject({ method: 'DELETE', url: `/api/cadastros/fornecedores/${fornId}`, headers })
    assert.equal(delForn.statusCode, 200)
  } finally {
    await app.close()
    await conn.close()
  }
})
