import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-fase0-parte2-wms-erp-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

async function setupBaseApp() {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login: 'Luciano', senha: '7410' },
  })
  assert.equal(loginRes.statusCode, 200)
  const token = loginRes.json().token as string
  const headers = { authorization: `Bearer ${token}` }

  // Criar produtos base (MP + PA + PA Extra)
  const mpRes = await app.inject({
    method: 'POST',
    url: '/api/cadastros/produtos',
    headers,
    payload: {
      codigo: '10010',
      descricao: 'PESCOCO BOVINO T7',
      tipo_produto: 'Materia Prima',
      valor_unitario: 24.5,
      unidade: 'KG',
    },
  })
  assert.equal(mpRes.statusCode, 201)
  const mpId = mpRes.json().id as string

  const paRes = await app.inject({
    method: 'POST',
    url: '/api/cadastros/produtos',
    headers,
    payload: {
      codigo: '10055',
      descricao: 'ACEM (CARNE SEM OSSO)',
      tipo_produto: 'Produto Acabado',
      valor_unitario: 38.9,
      unidade: 'KG',
    },
  })
  assert.equal(paRes.statusCode, 201)
  const paId = paRes.json().id as string

  const extraRes = await app.inject({
    method: 'POST',
    url: '/api/cadastros/produtos',
    headers,
    payload: {
      codigo: '10405',
      descricao: 'FLAT IRON 230G',
      tipo_produto: 'Produto Acabado',
      valor_unitario: 139.9,
      unidade: 'KG',
    },
  })
  assert.equal(extraRes.statusCode, 201)
  const extraProdId = extraRes.json().id as string

  const taraRes = await app.inject({
    method: 'POST',
    url: '/api/cadastros/taras',
    headers,
    payload: { nome: 'Caixa Padrao 1kg', peso_kg: 1.0, padrao: 1, ativo: 1 },
  })
  assert.equal(taraRes.statusCode, 201)
  const taraId = taraRes.json().id as string

  const locA = await app.inject({
    method: 'POST',
    url: '/api/cadastros/locais',
    headers,
    payload: { endereco: 'A-01-01', capacidade_max_caixas: 50, tipo_armazenamento: 'FRIO' },
  })
  assert.equal(locA.statusCode, 201)

  const locB = await app.inject({
    method: 'POST',
    url: '/api/cadastros/locais',
    headers,
    payload: { endereco: 'B-02-01', capacidade_max_caixas: 50, tipo_armazenamento: 'FRIO' },
  })
  assert.equal(locB.statusCode, 201)

  const cliRes = await app.inject({
    method: 'POST',
    url: '/api/cadastros/clientes',
    headers,
    payload: {
      codigo: '822',
      razao_social: 'GALLE RESTAURANTE BAR LTDA',
      nome_fantasia: 'Gale Osteria',
      uf: 'SP',
      cidade: 'CAMPINAS',
      is_padrao: 1,
    },
  })
  assert.equal(cliRes.statusCode, 201)
  const clienteId = cliRes.json().id as string

  return { conn, app, headers, token, mpId, paId, extraProdId, taraId, clienteId }
}

test('WMS Parte 2A: Recebimento (Palete + Bruto/Tara/Pecas) -> Transferencia -> Desmembramento -> Rastreabilidade', async () => {
  const { conn, app, headers, mpId, taraId } = await setupBaseApp()
  try {
    // 1. Abrir Palete
    const palRes = await app.inject({ method: 'POST', url: '/api/paletes', headers })
    assert.equal(palRes.statusCode, 201)
    const paleteId = palRes.json().palete.id as string
    assert.match(palRes.json().palete.codigo, /^PLT-\d+/)

    // Concluir palete vazio deve retornar 400
    const emptyClose = await app.inject({
      method: 'POST',
      url: `/api/paletes/${paleteId}/concluir`,
      headers,
    })
    assert.equal(emptyClose.statusCode, 400)

    // 2. Receber 2 caixas no palete
    const rec1 = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        ean_caixa: '7890001001001',
        produto_id: mpId,
        data_producao: '2026-11-16',
        validade: '2026-12-30',
        peso_bruto_kg: 21.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 4,
      },
    })
    assert.equal(rec1.statusCode, 201)
    assert.equal(rec1.json().caixa.peso_kg, 20)
    assert.equal(rec1.json().caixa.lote, '161126')

    const rec2 = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        ean_caixa: '7890001001002',
        produto_id: mpId,
        data_producao: '2026-11-10',
        validade: '2026-12-15',
        peso_bruto_kg: 26.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 5,
      },
    })
    assert.equal(rec2.statusCode, 201)
    assert.equal(rec2.json().caixa.peso_kg, 25)
    assert.equal(rec2.json().caixa.lote, '101126')

    // Duplicidade de EAN deve retornar 409
    const recDup = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        palete_id: paleteId,
        ean_caixa: '7890001001001',
        produto_id: mpId,
        data_producao: '2026-11-16',
        validade: '2026-12-30',
        peso_bruto_kg: 21.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 4,
      },
    })
    assert.equal(recDup.statusCode, 409)

    // 3. Concluir palete (vai para DOCA) e transferir palete para A-01-01
    const conclRes = await app.inject({
      method: 'POST',
      url: `/api/paletes/${paleteId}/concluir`,
      headers,
    })
    assert.equal(conclRes.statusCode, 200)

    const movPalRes = await app.inject({
      method: 'POST',
      url: '/api/movimentacao/palete',
      headers,
      payload: { palete_id: paleteId, destino: 'A-01-01' },
    })
    assert.equal(movPalRes.statusCode, 200)

    // Verificar posicao em A-01-01 soma 45 kg (2 caixas)
    const posRes = await app.inject({
      method: 'GET',
      url: '/api/estoque/posicoes?endereco=A-01-01',
      headers,
    })
    assert.equal(posRes.statusCode, 200)
    const totalKgA = posRes.json().data.reduce((acc: number, r: { qtd_kg: number }) => acc + r.qtd_kg, 0)
    assert.equal(totalKgA, 45)

    // 4. Desmembrar caixa 1 (20kg, 4 pecas) em 2 caixas (soma 3 pecas -> perda_pecas = 1)
    const desmRes = await app.inject({
      method: 'POST',
      url: '/api/desmembramento',
      headers,
      payload: {
        ean_origem: '7890001001001',
        motivo_diferenca_pecas: 'Apara limpa',
        itens: [
          { peso_bruto_kg: 11.0, tara_id: taraId, tara_kg: 1.0, qtd_pecas: 2 },
          { peso_bruto_kg: 10.5, tara_id: taraId, tara_kg: 1.0, qtd_pecas: 1 },
        ],
      },
    })
    assert.equal(desmRes.statusCode, 200)
    const desmBody = desmRes.json()
    assert.equal(desmBody.success, true)
    assert.equal(desmBody.caixas_geradas.length, 2)
    assert.match(desmBody.caixas_geradas[0].ean_caixa, /^0025\d{12}$/)
    assert.equal(desmBody.caixas_geradas[0].peso_kg, 10)
    assert.equal(desmBody.caixas_geradas[0].lote, '161126')

    // Rastreabilidade da caixa filha e origem
    const rastroRes = await app.inject({
      method: 'GET',
      url: `/api/rastreabilidade/${desmBody.caixas_geradas[0].ean_caixa}`,
      headers,
    })
    assert.equal(rastroRes.statusCode, 200)
    assert.equal(rastroRes.json().caixa.ean_origem, '7890001001001')

    const recentesRes = await app.inject({ method: 'GET', url: '/api/desmembramento/recentes', headers })
    assert.equal(recentesRes.statusCode, 200)
    assert.equal(recentesRes.json().data[0].perda_pecas, 1)
  } finally {
    await app.close()
    await conn.close()
  }
})

test('WMS Parte 2B: OP Producao (FEFO, Lock Concorrente FOR UPDATE, Auto-Arvore BOM) + Relatorio Executivo CLIENTE', async () => {
  const { conn, app, headers, mpId, paId, taraId } = await setupBaseApp()
  try {
    // Receber 2 caixas MP com validades diferentes para testar FEFO
    await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: '7890002000011',
        produto_id: mpId,
        endereco: 'A-01-01',
        data_producao: '2026-11-10',
        validade: '2026-12-10', // MAIS ANTIGA (FEFO)
        peso_bruto_kg: 26.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 5,
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: '7890002000028',
        produto_id: mpId,
        endereco: 'A-01-01',
        data_producao: '2026-11-16',
        validade: '2026-12-28', // MAIS NOVA
        peso_bruto_kg: 21.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 4,
      },
    })

    // Criar OP com previsao de ENTRADA e SAIDA
    const opRes = await app.inject({
      method: 'POST',
      url: '/api/ops',
      headers,
      payload: {
        nome: 'Desossa Pescoco Acem',
        data_producao: '2026-11-16',
        status: 'LIBERADA',
        itensPrevistos: [
          { tipo: 'ENTRADA', produto_id: mpId, qtd_caixas_prevista: 2, unidade_prevista: 'CX' },
          { tipo: 'SAIDA', produto_id: paId, peso_kg_previsto: 18, unidade_prevista: 'KG' },
        ],
      },
    })
    assert.equal(opRes.statusCode, 201)
    const opId = opRes.json().id as string

    // Bipar caixa mais nova primeiro sem confirmar -> deve pedir confirmacao FEFO!
    const fefoCheck = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/entrar-caixa`,
      headers,
      payload: { ean: '7890002000028', forcarConfirmacao: false },
    })
    assert.equal(fefoCheck.statusCode, 200)
    assert.equal(fefoCheck.json().requiresConfirmation, true)
    assert.equal(fefoCheck.json().avisoFefo.ean_caixa, '7890002000011')

    // Concorrencia: 2 requisicoes simultaneas na mesma caixa mais antiga -> exatamente 1 entra e 1 e bloqueada!
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/ops/${opId}/entrar-caixa`,
        headers,
        payload: { ean: '7890002000011' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/ops/${opId}/entrar-caixa`,
        headers,
        payload: { ean: '7890002000011' },
      }),
    ])
    const sucessos = [r1.json(), r2.json()].filter((x) => x.success === true)
    assert.equal(sucessos.length, 1, 'Lock PostgreSQL deve impedir reserva dupla concorrente da mesma caixa')

    // Registrar Retorno da Producao (18.5 kg liquido de ACEM)
    const retRes = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/retorno`,
      headers,
      payload: {
        produto_id: paId,
        peso_bruto_kg: 19.5,
        tara_id: taraId,
        tara_kg: 1.0,
        data_producao: '2026-11-16',
        validade: '2026-12-20',
        qtd_pecas: 10,
      },
    })
    assert.equal(retRes.statusCode, 201)
    assert.equal(retRes.json().retorno.peso_kg, 18.5)
    assert.match(retRes.json().retorno.ean_caixa, /^0025\d{12}$/)

    // Finalizar OP -> rendimento = 18.5 / 25.0 = 74% e aprende arvore PESCOCO -> ACEM!
    const finRes = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/finalizar`,
      headers,
    })
    assert.equal(finRes.statusCode, 200)
    assert.equal(finRes.json().rendimento_pct, 74)
    assert.equal(finRes.json().perda_pct, 26)

    const arvRes = await app.inject({ method: 'GET', url: '/api/relatorios/arvore', headers })
    assert.equal(arvRes.statusCode, 200)
    assert.equal(arvRes.json().vinculos.length, 1)
    assert.equal(arvRes.json().vinculos[0].pai_id, mpId)
    assert.equal(arvRes.json().vinculos[0].filho_id, paId)
    assert.equal(arvRes.json().vinculos[0].rendimento_aprendido_pct, 74)
    assert.equal(arvRes.json().vinculos[0].amostras_aprendizado, 1)

    // Verificar Dossie de Producao
    const dossieRes = await app.inject({ method: 'GET', url: `/api/ops/dossies?opId=${opId}`, headers })
    assert.equal(dossieRes.statusCode, 200)
    assert.equal(dossieRes.json().data[0].peso_insumos, 25)
    assert.equal(dossieRes.json().data[0].peso_retornos, 18.5)
  } finally {
    await app.close()
    await conn.close()
  }
})

test('WMS Parte 2C: Pedido -> Separacao (+50% e Extra) -> Conferencia -> Expedicao -> Relatorio Executivo CLIENTE', async () => {
  const { conn, app, headers, paId, extraProdId, taraId, clienteId } = await setupBaseApp()
  try {
    // Criar cliente portal (CLIENTE) para validar isolamento de operador_nome no relatorio executivo
    const cliUserRes = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers,
      payload: {
        nome: 'Portal Gale',
        login: 'gale_cli',
        senha: '1234',
        perfil: 'CLIENTE',
        nivel: 'CLIENTE',
        deve_trocar_senha: false,
        permissoes: { relatorios_estoque: true },
      },
    })
    assert.equal(cliUserRes.statusCode, 201)
    const cliLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'gale_cli', senha: '1234' },
    })
    const cliToken = cliLogin.json().token as string

    // Estocar caixas
    await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: '7890003000011',
        produto_id: paId,
        endereco: 'A-01-01',
        data_producao: '2026-11-16',
        validade: '2026-12-20',
        peso_bruto_kg: 19.5,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 8,
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: '7890003000028',
        produto_id: extraProdId,
        endereco: 'B-02-01',
        data_producao: '2026-11-16',
        validade: '2026-12-20',
        peso_bruto_kg: 5.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 4,
      },
    })

    // 1. Criar Pedido pedindo 10 kg de ACEM
    const pedRes = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Carga Terça Gale',
        cliente_id: clienteId,
        cliente: 'GALLE RESTAURANTE BAR LTDA',
        previsao_entrega: '2026-11-17',
        liberar: true,
        itens: [{ produto_id: paId, qtd_kg_solicitada: 10.0, preco_unitario: 38.9 }],
      },
    })
    assert.equal(pedRes.statusCode, 201)
    const pedidoId = pedRes.json().id as string

    // 2. Iniciar separacao -> cria ROM-0001
    const iniRes = await app.inject({
      method: 'POST',
      url: `/api/saida/iniciar-pedido/${pedidoId}`,
      headers,
    })
    assert.equal(iniRes.statusCode, 200)
    const romId = iniRes.json().romaneio.id as string

    // Bipar caixa 18.5 kg para pedido de 10 kg (+85% > +50%) -> pede confirmacao EXCESSO_PESO_50
    const excRes = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/caixa`,
      headers,
      payload: { ean_caixa: '7890003000011' },
    })
    assert.equal(excRes.statusCode, 200)
    assert.equal(excRes.json().requiresConfirmation, true)
    assert.equal(excRes.json().reason, 'EXCESSO_PESO_50')

    // Confirmar excesso -> reserva caixa
    const okExc = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/caixa`,
      headers,
      payload: { ean_caixa: '7890003000011', confirmarExcesso: true },
    })
    assert.equal(okExc.statusCode, 200)
    assert.equal(okExc.json().success, true)

    // Bipar item fora do pedido sem confirmarExtra -> pede confirmacao PRODUTO_FORA_PEDIDO
    const extraCheck = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/caixa`,
      headers,
      payload: { ean_caixa: '7890003000028' },
    })
    assert.equal(extraCheck.statusCode, 200)
    assert.equal(extraCheck.json().requiresConfirmation, true)
    assert.equal(extraCheck.json().reason, 'PRODUTO_FORA_PEDIDO')

    // Durante MONTANDO, CLIENTE NAO enxerga esse romaneio no relatorio executivo
    const execAntes = await app.inject({
      method: 'GET',
      url: '/api/relatorios/executivo',
      headers: { authorization: `Bearer ${cliToken}` },
    })
    assert.equal(execAntes.statusCode, 200)
    assert.equal(execAntes.json().romaneios.length, 0)

    // 3. Finalizar montagem -> AGUARDANDO_EXPEDICAO
    const finMont = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/finalizar-montagem`,
      headers,
    })
    assert.equal(finMont.statusCode, 200)

    // Tentar expedir sem conferir 100% -> 409!
    const expSemConf = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/expedir`,
      headers,
    })
    assert.equal(expSemConf.statusCode, 409)

    // Conferir caixa
    const confRes = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/conferir`,
      headers,
      payload: { codigo: '007890003000011' }, // zeros a esquerda testados!
    })
    assert.equal(confRes.statusCode, 200)
    assert.equal(confRes.json().todasConferidas, true)

    // Expedir agora passa!
    const expRes = await app.inject({
      method: 'POST',
      url: `/api/romaneios/${romId}/expedir`,
      headers,
    })
    assert.equal(expRes.statusCode, 200)
    assert.equal(expRes.json().total_caixas, 1)
    assert.equal(expRes.json().total_peso, 18.5)

    // Verificar etiquetas & status EXPEDIDO
    const pedFinal = await app.inject({ method: 'GET', url: `/api/pedidos/${pedidoId}`, headers })
    assert.equal(pedFinal.json().data.status, 'EXPEDIDO')

    // CLIENTE agora ve romaneio EXPEDIDO mas com operador_expedicao_nome = null!
    const execDepois = await app.inject({
      method: 'GET',
      url: '/api/relatorios/executivo',
      headers: { authorization: `Bearer ${cliToken}` },
    })
    assert.equal(execDepois.statusCode, 200)
    assert.equal(execDepois.json().romaneios.length, 1)
    assert.equal(execDepois.json().romaneios[0].operador_expedicao_nome, null)
  } finally {
    await app.close()
    await conn.close()
  }
})

test('WMS Parte 2D: Inventario Ciclico (Bloqueio 409, Contagem, Surpresa, IRA e Conciliacao)', async () => {
  const { conn, app, headers, mpId, taraId } = await setupBaseApp()
  try {
    // Colocar caixa em A-01-01
    const recRes = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: '7890004000010',
        produto_id: mpId,
        endereco: 'A-01-01',
        data_producao: '2026-11-16',
        validade: '2026-12-25',
        peso_bruto_kg: 16.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 3,
      },
    })
    const caixaId = recRes.json().caixa.id as string

    // 1. Criar Ciclo + Inventario Rua A
    const cicloRes = await app.inject({
      method: 'POST',
      url: '/api/inventario/ciclos',
      headers,
      payload: { nome: 'Ciclo Novembro 2026', target_pct: 99.5 },
    })
    assert.equal(cicloRes.statusCode, 201)

    const invRes = await app.inject({
      method: 'POST',
      url: '/api/inventario',
      headers,
      payload: { tipo: 'Ciclico', tipo_filtro: 'Rua', identificador_filtro: 'A' },
    })
    assert.equal(invRes.statusCode, 201)
    const invId = invRes.json().inventario_id as string

    // 2. Endereco A-01-01 deve estar bloqueado para movimentacao (409!)
    const blqRes = await app.inject({ method: 'GET', url: '/api/inventario/bloqueados', headers })
    assert.equal(blqRes.statusCode, 200)
    assert.ok(blqRes.json().data.includes('A-01-01'))

    const movBlq = await app.inject({
      method: 'POST',
      url: '/api/movimentacao/caixas',
      headers,
      payload: { caixas_ids: [caixaId], destino: 'B-02-01' },
    })
    assert.equal(movBlq.statusCode, 409)

    // 3. Contar item sem divergencia -> OK, depois conciliar e liberar bloqueio
    const itensRes = await app.inject({
      method: 'GET',
      url: `/api/inventario/${invId}/itens`,
      headers,
    })
    assert.equal(itensRes.statusCode, 200)
    const item = itensRes.json().data[0]
    assert.equal(item.endereco, 'A-01-01')

    const contRes = await app.inject({
      method: 'POST',
      url: '/api/inventario/contagem',
      headers,
      payload: {
        item_id: item.id,
        qtd_contada_caixas: 1,
        qtd_contada_kg: 15.0,
        validade_informada: '2026-12-25',
      },
    })
    assert.equal(contRes.statusCode, 200)

    const concRes = await app.inject({
      method: 'POST',
      url: `/api/inventario/${invId}/conciliar`,
      headers,
    })
    assert.equal(concRes.statusCode, 200)

    const iraRes = await app.inject({ method: 'GET', url: `/api/inventario/${invId}/ira`, headers })
    assert.equal(iraRes.statusCode, 200)
    assert.equal(iraRes.json().ira_geral, 100)

    // Agora movimentacao de A-01-01 -> B-02-01 deve funcionar (200)!
    const movOk = await app.inject({
      method: 'POST',
      url: '/api/movimentacao/caixas',
      headers,
      payload: { caixas_ids: [caixaId], destino: 'B-02-01' },
    })
    assert.equal(movOk.statusCode, 200)
  } finally {
    await app.close()
    await conn.close()
  }
})

test('WMS Stage A: Paridade UI (Cadastros, EAN Editor, Consulta, Mover Endereco, Relatorios)', async () => {
  const { conn, app, headers, mpId, paId, taraId } = await setupBaseApp()
  try {
    // 1. Produto filho com pais_ids (BOM via PUT /api/cadastros/produtos/:id)
    const updPa = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/produtos/${paId}`,
      headers,
      payload: {
        codigo: '10055',
        descricao: 'ACEM (CARNE SEM OSSO)',
        tipo_produto: 'Produto Acabado',
        valor_unitario: 38.9,
        unidade: 'KG',
        classificacao: 'SUBPRODUTO',
        pais_ids: [mpId],
      },
    })
    assert.equal(updPa.statusCode, 200)

    // Receber caixa com prefixo INT- para testar EanEditor + saldo_kg + Consulta
    const recInt = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: 'INT-99001',
        produto_id: mpId,
        endereco: 'A-01-01',
        data_producao: '2026-11-16',
        validade: '2026-12-25',
        peso_bruto_kg: 11.0,
        tara_id: taraId,
        tara_kg: 1.0,
        qtd_pecas: 2,
      },
    })
    assert.equal(recInt.statusCode, 201)
    const intCaixaId = recInt.json().caixa.id as string

    // 2. Produtos list deve trazer pais_ids e saldo_kg
    const prodsRes = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    assert.equal(prodsRes.statusCode, 200)
    const prodsList = prodsRes.json().data ?? prodsRes.json()
    const paRow = prodsList.find((p: any) => p.id === paId)
    const mpRow = prodsList.find((p: any) => p.id === mpId)
    assert.ok(paRow)
    assert.ok('pais_ids' in paRow)
    assert.ok(mpRow && Number(mpRow.saldo_kg) >= 10)

    const buscarProd = await app.inject({ method: 'GET', url: '/api/cadastros/produtos/buscar/10010', headers })
    assert.equal(buscarProd.statusCode, 200)

    // 3. EAN Editor: listar INT- -> alterar EAN -> verificar movimentacao por endereco
    const intList = await app.inject({ method: 'GET', url: '/api/ean-editor/caixas-int', headers })
    assert.equal(intList.statusCode, 200)
    assert.ok(intList.json().data.some((c: any) => c.id === intCaixaId))

    const patchEan = await app.inject({
      method: 'PATCH',
      url: `/api/estoque/caixas/${intCaixaId}/ean`,
      headers,
      payload: { ean_caixa: '7890009900011' },
    })
    assert.equal(patchEan.statusCode, 200)

    const moverDePara = await app.inject({
      method: 'POST',
      url: '/api/estoque/mover-caixa-endereco',
      headers,
      payload: { ean_caixa: '7890009900011', destino: 'B-02-01' },
    })
    assert.equal(moverDePara.statusCode, 200)

    // 4. Consulta routes & Estoque posicoes/caixas
    for (const url of [
      `/api/consulta/resumo/${mpId}`,
      `/api/consulta/enderecos/${mpId}`,
      `/api/consulta/caixas/${mpId}/B-02-01`,
      `/api/consulta/historico/${mpId}`,
      '/api/consulta/consolidado',
      '/api/consulta/endereco-fisico/B-02-01',
      '/api/estoque/posicoes',
      '/api/estoque/caixas?status=DISPONIVEL,EXPEDIDA',
      '/api/ops?status=ATIVAS',
      '/api/inventario',
    ]) {
      const r = await app.inject({ method: 'GET', url, headers })
      assert.equal(r.statusCode, 200, `Expected 200 for ${url}`)
    }

    // 5. Relatorios Stage A shapes
    const balRes = await app.inject({ method: 'GET', url: '/api/relatorios/balanco', headers })
    assert.equal(balRes.statusCode, 200)
    const balData = balRes.json().data ?? balRes.json()
    assert.ok(Array.isArray(balData))
    if (balData.length > 0) {
      assert.ok('produto_id' in balData[0])
      assert.ok('total_entrada' in balData[0])
      assert.ok('total_saida' in balData[0])
    }

    const arvRes = await app.inject({ method: 'GET', url: '/api/relatorios/arvore', headers })
    assert.equal(arvRes.statusCode, 200)
    assert.ok('produtos' in arvRes.json() && 'arvore' in arvRes.json())

    const dashExecRes = await app.inject({ method: 'GET', url: '/api/relatorios/dashboard-executivo', headers })
    assert.equal(dashExecRes.statusCode, 200, `dashboard-executivo failed: ${dashExecRes.body}`)

    const execRes = await app.inject({ method: 'GET', url: '/api/relatorios/executivo', headers })
    assert.equal(execRes.statusCode, 200, `executivo failed: ${execRes.body}`)
    const execBody = execRes.json()
    assert.ok(Array.isArray(execBody.estoqueAtual))
    assert.ok(execBody.estoqueAtual.length >= 1)
    assert.ok('ean_caixa' in execBody.estoqueAtual[0])

    const opsRelRes = await app.inject({ method: 'GET', url: '/api/relatorios/ordens-producao', headers })
    assert.equal(opsRelRes.statusCode, 200, `ordens-producao failed: ${opsRelRes.body}`)

    const subprodRes = await app.inject({ method: 'GET', url: '/api/relatorios/op-subprodutos/161126', headers })
    assert.equal(subprodRes.statusCode, 200, `op-subprodutos failed: ${subprodRes.body}`)
  } finally {
    await app.close()
    await conn.close()
  }
})
