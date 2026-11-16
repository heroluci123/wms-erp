import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-fase2p2-super-seguro-2026',
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

test('Fase 2 Parte 2: Pedido de Compra + Trava Recebimento + Mapa Producao + Arvore Auto-Aprendiz + Sugestao Compras', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // 1. Cadastros base: Fornecedor fora de SP (MT, c/ SIF), Produtos (MP + Corte vinculado + Apara), Cliente
    const resForn = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'FRIG-MT',
        razao_social: 'FRIGORIFICO MATO GROSSO S/A',
        nome_fantasia: 'Frigo MT',
        uf: 'MT',
        cidade: 'CUIABA',
        registro_sanitario_sif: 'SIF 1945',
      },
    })
    assert.equal(resForn.statusCode, 201, `Criar fornecedor falhou: ${resForn.body}`)
    const fornId = resForn.json().id

    const resMp = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '95001',
        descricao: 'TRASEIRO BOVINO MT',
        tipo_produto: 'Materia Prima',
        classificacao: 'MATERIA_PRIMA',
        unidade: 'KG',
        custo_medio_kg: 24.0,
      },
    })
    assert.equal(resMp.statusCode, 201, `Criar MP falhou: ${resMp.body}`)
    const mpId = resMp.json().id

    const resCorte = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '15101',
        descricao: 'PICANHA FATIADA GRILL',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        grupo: 'BOVINO',
        unidade: 'KG',
        valor_unitario: 98.5,
        arvore_vinculos: [{ pai_id: mpId, rendimento_esperado_pct: 50 }],
      },
    })
    assert.equal(resCorte.statusCode, 201, `Criar corte falhou: ${resCorte.body}`)
    const corteId = resCorte.json().id

    const resApara = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '15999',
        descricao: 'APARA BOVINA ESPECIAL',
        tipo_produto: 'Produto Acabado',
        classificacao: 'APARA',
        grupo: 'BOVINO',
        unidade: 'KG',
        valor_unitario: 18.0,
      },
    })
    assert.equal(resApara.statusCode, 201, `Criar apara falhou: ${resApara.body}`)
    const aparaId = resApara.json().id

    const resCli = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: '901',
        razao_social: 'CHURRASCARIA PRIME LTDA',
        nome_fantasia: 'Churrascaria Prime',
        uf: 'SP',
        cidade: 'CAMPINAS',
      },
    })
    assert.equal(resCli.statusCode, 201)
    const cliId = resCli.json().id

    // 2. Ativar Trava no Recebimento (exigir Pedido de Compra aprovado)
    const resCfg = await app.inject({
      method: 'PATCH',
      url: '/api/configuracoes/modulos',
      headers,
      payload: { trava_recebimento_sem_pc: true },
    })
    assert.equal(resCfg.statusCode, 200)
    assert.equal(resCfg.json().data.trava_recebimento_sem_pc, true)

    const resPal = await app.inject({ method: 'POST', url: '/api/paletes', headers })
    assert.equal(resPal.statusCode, 201)
    const paleteId = resPal.json().palete.id

    // Tentar receber caixa SEM Pedido de Compra -> BLOQUEADO (400)
    const resRecSemPc = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        ean_caixa: '009990000001',
        produto_id: mpId,
        peso_kg: 100,
        data_producao: '2026-11-16',
        validade: '2026-12-30',
      },
    })
    assert.equal(resRecSemPc.statusCode, 400, `Deveria bloquear sem PC: ${resRecSemPc.body}`)

    // Criar Pedido de Compra em RASCUNHO (ABERTO) com frete R$200 + despesas R$50
    const resPc = await app.inject({
      method: 'POST',
      url: '/api/compras',
      headers,
      payload: {
        fornecedor_id: fornId,
        finalidade: 'MATERIA_PRIMA',
        marchante: 'Carlos Boiadeiro',
        frete_valor: 200,
        despesas_valor: 50,
        aprovar: false,
        itens: [{ produto_id: mpId, qtd_kg_solicitada: 100, preco_unitario_kg: 26.0 }],
      },
    })
    assert.equal(resPc.statusCode, 201, `Criar PC falhou: ${resPc.body}`)
    const pcBody = resPc.json()
    assert.equal(pcBody.status, 'ABERTO')
    assert.ok(String(pcBody.cfop_sugerido || '').startsWith('2'), `CFOP interestadual SP<-MT devia iniciar com 2: ${pcBody.cfop_sugerido}`)
    const pcId = pcBody.id

    // Tentar receber com PC ainda ABERTO -> BLOQUEADO (400)
    const resRecNaoAprov = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        pedido_compra_id: pcId,
        ean_caixa: '009990000001',
        produto_id: mpId,
        peso_kg: 100,
        data_producao: '2026-11-16',
        validade: '2026-12-30',
      },
    })
    assert.equal(resRecNaoAprov.statusCode, 400, `PC ABERTO nao devia liberar doca: ${resRecNaoAprov.body}`)

    // Aprovar PC e receber 100kg na doca -> SUCESSO + herança SIF e custo
    const resAprov = await app.inject({ method: 'POST', url: `/api/compras/${pcId}/aprovar`, headers })
    assert.equal(resAprov.statusCode, 200)

    const resRecOk = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        pedido_compra_id: pcId,
        numero_nf: '98765',
        ean_caixa: '009990000001',
        produto_id: mpId,
        peso_kg: 100,
        data_producao: '2026-11-16',
        validade: '2026-12-30',
      },
    })
    assert.equal(resRecOk.statusCode, 201, `Recebimento com PC aprovado falhou: ${resRecOk.body}`)

    // Movimentar caixa para rua de câmara (ex: 'CAM-01') para entrar no saldo DISPONIVEL em câmara
    const resLocal = await app.inject({
      method: 'POST',
      url: '/api/cadastros/locais',
      headers,
      payload: { endereco: 'CAM-01', capacidade_max_caixas: 100, tipo_armazenamento: 'FRIO' },
    })
    assert.ok(resLocal.statusCode === 200 || resLocal.statusCode === 201)

    const resConclPal = await app.inject({ method: 'POST', url: `/api/paletes/${paleteId}/concluir`, headers })
    assert.equal(resConclPal.statusCode, 200)

    const resMover = await app.inject({
      method: 'POST',
      url: '/api/movimentacao/palete',
      headers,
      payload: { palete_id: paleteId, destino: 'CAM-01' },
    })
    assert.equal(resMover.statusCode, 200, `Mover palete falhou: ${resMover.body}`)

    // Enviar p/ validação sistêmica 3-Way e aprovar
    const resEnvVal = await app.inject({
      method: 'POST',
      url: `/api/compras/${pcId}/enviar-validacao`,
      headers,
      payload: { numero_nf: '98765' },
    })
    assert.equal(resEnvVal.statusCode, 200)
    assert.equal(resEnvVal.json().status_validacao, 'AGUARDANDO_VALIDACAO_SISTEMICA')

    const resPendSc = await app.inject({ method: 'GET', url: '/api/pendencias?setor=SUPPLY_CHAIN', headers })
    assert.ok(resPendSc.json().filaAoVivo.recebimentos_validacao >= 1)
    assert.ok(resPendSc.json().data.some((p: any) => p.tipo_pendencia === 'VALIDACAO_RECEBIMENTO'))

    const resVal3Way = await app.inject({
      method: 'POST',
      url: `/api/compras/${pcId}/validar-sistemica`,
      headers,
      payload: { encerrar_pc: true },
    })
    assert.equal(resVal3Way.statusCode, 200)
    assert.equal(resVal3Way.json().status, 'RECEBIDO')

    // Verificar atualização de custo médio com rateio de frete/despesas: 26 + (250/100) = 28.50
    const resProds = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    const mpAtual = resProds.json().data.find((p: any) => p.id === mpId)
    assert.ok(Math.abs(Number(mpAtual.custo_medio_kg) - 28.5) < 0.05, `Custo medio MP devia ser 28.50, veio ${mpAtual.custo_medio_kg}`)

    // 3. Pedido Comercial de 80kg PICANHA -> Sugestão de Compras & Mapa de Produção
    const resPed = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Prime 80kg Picanha',
        cliente_id: cliId,
        liberar: true,
        itens: [{ produto_id: corteId, qtd_kg_solicitada: 80, preco_unitario: 98.5 }],
      },
    })
    assert.equal(resPed.statusCode, 201, `Criar pedido falhou: ${resPed.body}`)

    // Sugestão de Compras: 80kg Picanha @ 50% rend = 160kg MP; estoque = 100kg => déficit = 60kg
    const resMin = await app.inject({ method: 'GET', url: '/api/estoque/minimo', headers })
    assert.equal(resMin.statusCode, 200)
    const mpMinItem = resMin.json().itens.find((i: any) => i.id === mpId)
    assert.ok(mpMinItem, 'MP 95001 deve aparecer em /api/estoque/minimo')
    assert.ok(
      Math.abs(Number(mpMinItem.demanda_pedidos_kg) - 160) < 0.5,
      `Demanda MP devia ser ~160kg, veio ${mpMinItem.demanda_pedidos_kg}`,
    )
    assert.ok(
      Number(mpMinItem.sugestao_compra_kg) >= 59.5,
      `Sugestao de compra devia ser >= 60kg (160 demanda - 100 estoque), veio ${mpMinItem.sugestao_compra_kg}`,
    )

    // Criar Mapa de Produção puxando demanda dos pedidos e Gerar OPs em 1 clique
    const resMapa = await app.inject({
      method: 'POST',
      url: '/api/mapas-producao',
      headers,
      payload: { puxar_pedidos: true, observacoes: 'Mapa Turno 1' },
    })
    assert.equal(resMapa.statusCode, 201, `Criar mapa falhou: ${resMapa.body}`)
    const mapaId = resMapa.json().id

    const resGerarOps = await app.inject({
      method: 'POST',
      url: `/api/mapas-producao/${mapaId}/gerar-ops`,
      headers,
      payload: { agrupar_por: 'MP' },
    })
    assert.equal(resGerarOps.statusCode, 201, `Gerar OPs do mapa falhou: ${resGerarOps.body}`)
    const opGerada = resGerarOps.json().ops[0]
    assert.ok(opGerada?.id && opGerada?.codigo)

    // 4. Apontar entrada da caixa de 100kg na OP + retorno de Apara (15999 - 45kg) -> Finalizar -> Árvore Auto-Aprendiz
    const resEnt = await app.inject({
      method: 'POST',
      url: `/api/ops/${opGerada.id}/entrar-caixa`,
      headers,
      payload: { ean: '009990000001' },
    })
    assert.equal(resEnt.statusCode, 200, `Entrada na OP falhou: ${resEnt.body}`)

    const resRet = await app.inject({
      method: 'POST',
      url: `/api/ops/${opGerada.id}/retorno`,
      headers,
      payload: {
        produto_id: aparaId,
        peso_bruto_kg: 45,
        tara_kg: 0,
        qtd_pecas: 5,
        data_producao: '2026-11-16',
        validade: '2026-12-30',
      },
    })
    assert.ok(resRet.statusCode === 200 || resRet.statusCode === 201, `Retorno na OP falhou: ${resRet.body}`)

    const resFin = await app.inject({
      method: 'POST',
      url: `/api/ops/${opGerada.id}/finalizar`,
      headers,
    })
    assert.equal(resFin.statusCode, 200, `Finalizar OP falhou: ${resFin.body}`)

    // Verificar vínculo OP_AUTO aprendido na Árvore (45kg apara / 100kg MP = 45%)
    const resArv = await app.inject({ method: 'GET', url: '/api/arvore-produtos', headers })
    assert.equal(resArv.statusCode, 200)
    const vincAuto = resArv.json().data.find(
      (a: any) => a.pai_id === mpId && a.filho_id === aparaId && a.origem_vinculo === 'OP_AUTO',
    )
    assert.ok(vincAuto, `Vinculo OP_AUTO nao criado para apara: ${JSON.stringify(resArv.json().data)}`)
    assert.equal(vincAuto.confirmado, 0)
    assert.equal(vincAuto.amostras_aprendizado, 1)
    assert.ok(Math.abs(Number(vincAuto.rendimento_aprendido_pct) - 45) < 0.1)

    const resConfArv = await app.inject({
      method: 'POST',
      url: `/api/arvore-produtos/${vincAuto.id}/confirmar`,
      headers,
      payload: {},
    })
    assert.equal(resConfArv.statusCode, 200)
    assert.equal(resConfArv.json().rendimento_esperado_pct, 45)

    // 4B. Fluxo Dinamico do Mapa Diario: criar vazio c/ titulo opcional, reabrir mesma data, puxar disponibilidade, auto-aprender especificacao e programacao semanal
    const resNovoMapa = await app.inject({
      method: 'POST',
      url: '/api/mapas-producao',
      headers,
      payload: { data_mapa: '2026-11-20', tipo: 'PRINCIPAL' },
    })
    assert.equal(resNovoMapa.statusCode, 201, `Criar mapa principal vazio falhou: ${resNovoMapa.body}`)
    const novoMapaId = resNovoMapa.json().id
    assert.ok(String(resNovoMapa.json().titulo || '').includes('20/11/2026'), `Titulo auto-gerado invalido: ${resNovoMapa.body}`)

    const resReabrir = await app.inject({
      method: 'POST',
      url: '/api/mapas-producao',
      headers,
      payload: { data_mapa: '2026-11-20', tipo: 'PRINCIPAL' },
    })
    assert.ok(resReabrir.statusCode === 200 || resReabrir.statusCode === 201)
    assert.equal(resReabrir.json().reopened, true)
    assert.equal(resReabrir.json().id, novoMapaId)

    const resDisp = await app.inject({
      method: 'GET',
      url: '/api/mapas-producao/itens-pedidos-disponiveis',
      headers,
    })
    assert.equal(resDisp.statusCode, 200)
    assert.ok(Array.isArray(resDisp.json().gruposProduto), `gruposProduto ausente: ${resDisp.body}`)
    assert.ok(Array.isArray(resDisp.json().datasDisponiveis), `datasDisponiveis ausente: ${resDisp.body}`)

    const resAddMapa = await app.inject({
      method: 'POST',
      url: `/api/mapas-producao/${novoMapaId}/itens`,
      headers,
      payload: {
        itens: [{ produto_id: corteId, cliente_id: cliId, materia_prima_id: mpId, qtd_prevista_kg: 12 }],
      },
    })
    assert.equal(resAddMapa.statusCode, 201, `Adicionar item no mapa falhou: ${resAddMapa.body}`)

    const resDetMapa = await app.inject({ method: 'GET', url: `/api/mapas-producao/${novoMapaId}`, headers })
    assert.equal(resDetMapa.statusCode, 200)
    const itemMapaId = resDetMapa.json().data.itens[0].id

    const resEditEspec = await app.inject({
      method: 'PUT',
      url: `/api/mapas-producao/${novoMapaId}/itens/${itemMapaId}`,
      headers,
      payload: {
        especificacao: 'BIFE 200G EMBALAGEM 5KG',
        conservacao: 'CONGELADO',
        grupo_mapa: 'NOBRES',
      },
    })
    assert.equal(resEditEspec.statusCode, 200)

    const resListaEspec = await app.inject({ method: 'GET', url: '/api/mapas-producao/especificacoes', headers })
    assert.equal(resListaEspec.statusCode, 200)
    assert.ok(
      resListaEspec.json().data.some(
        (e: any) => e.cliente_id === cliId && e.produto_id === corteId && e.especificacao === 'BIFE 200G EMBALAGEM 5KG',
      ),
      `Especificacao auto-aprendida nao encontrada: ${resListaEspec.body}`,
    )

    const resSemanalPost = await app.inject({
      method: 'POST',
      url: '/api/mapas-producao/programacao-semanal',
      headers,
      payload: {
        dia_semana: 2,
        produto_id: corteId,
        cliente_id: cliId,
        materia_prima_id: mpId,
        especificacao: 'PROGRAMACAO TERCA 5KG',
        conservacao: 'RESFRIADO',
        qtd_meta_kg: 30,
      },
    })
    assert.equal(resSemanalPost.statusCode, 201)

    const resImportSemanal = await app.inject({
      method: 'POST',
      url: `/api/mapas-producao/${novoMapaId}/importar-semanal`,
      headers,
      payload: { dia_semana: 2 },
    })
    assert.equal(resImportSemanal.statusCode, 200, `Importar semanal falhou: ${resImportSemanal.body}`)
    assert.ok(Number(resImportSemanal.json().importados) >= 1, `Esperava importados >= 1: ${resImportSemanal.body}`)

    const resDetPosSemanal = await app.inject({ method: 'GET', url: `/api/mapas-producao/${novoMapaId}`, headers })
    assert.equal(resDetPosSemanal.statusCode, 200)
    assert.ok((resDetPosSemanal.json().data?.itens || []).length >= 2, 'Item importado da semanal deve constar no mapa')

    // 5. RBAC: usuario CLIENTE bloqueado (403)
    const resCliUser = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers,
      payload: {
        nome: 'ClienteTesteF2P2',
        login: 'clientetestef2p2',
        senha: '1122',
        perfil: 'CLIENTE',
        nivel: 'CLIENTE',
        permissoes: { compras: true, mapa_producao: true },
      },
    })
    assert.equal(resCliUser.statusCode, 201)
    const cliToken = await loginAs(app, 'clientetestef2p2', '1122')
    const cliHeaders = { authorization: `Bearer ${cliToken}` }

    assert.equal((await app.inject({ method: 'GET', url: '/api/compras', headers: cliHeaders })).statusCode, 403)
    assert.equal((await app.inject({ method: 'GET', url: '/api/mapas-producao', headers: cliHeaders })).statusCode, 403)
    assert.equal((await app.inject({ method: 'GET', url: '/api/arvore-produtos', headers: cliHeaders })).statusCode, 403)
    assert.equal((await app.inject({ method: 'GET', url: '/api/estoque/minimo', headers: cliHeaders })).statusCode, 403)
  } finally {
    await app.close()
    await conn.close?.()
  }
})
