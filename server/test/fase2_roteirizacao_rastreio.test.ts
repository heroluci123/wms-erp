import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-roteirizacao-fase2p3-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Fase 2 Parte 3: Roteirizacao, Reordenacao, Bipagem Unica Operador, Despacho e Rastreio QR Motorista', async () => {
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

    // Cadastros mínimos: produto, tara, cliente com endereço
    const prodRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '20100',
        descricao: 'CONTRA FILE BOVINO T7',
        tipo_produto: 'Produto Acabado',
        valor_unitario: 55.0,
        unidade: 'KG',
      },
    })
    assert.equal(prodRes.statusCode, 201)
    const prodId = prodRes.json().id as string

    const taraRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/taras',
      headers,
      payload: { nome: 'Caixa Papelão 1kg', peso_kg: 1.0 },
    })
    assert.equal(taraRes.statusCode, 201)
    const taraId = taraRes.json().id as string

    const cliRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: '901',
        razao_social: 'CHURRASCARIA BOI NOBRE LTDA',
        nome_fantasia: 'Boi Nobre',
        endereco: 'Av. Brasil',
        numero: '1500',
        cidade: 'CAMPINAS',
        uf: 'SP',
      },
    })
    assert.equal(cliRes.statusCode, 201)
    const cliId = cliRes.json().id as string

    // Receber 2 caixas em estoque
    for (const [ean, pesoBruto] of [
      ['7890009000011', 21.0],
      ['7890009000028', 16.0],
    ] as const) {
      const rec = await app.inject({
        method: 'POST',
        url: '/api/recebimento/caixa',
        headers,
        payload: {
          ean_caixa: ean,
          produto_id: prodId,
          endereco: 'A-01-01',
          data_producao: '2026-11-16',
          validade: '2026-12-25',
          peso_bruto_kg: pesoBruto,
          tara_id: taraId,
          tara_kg: 1.0,
          qtd_pecas: 4,
        },
      })
      assert.equal(rec.statusCode, 201)
    }

    // 2. Criar 2 pedidos (Pedido 2 com Pagamento na Entrega obrigatório), separar 1 caixa em cada e finalizar montagem
    const p1Res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Entrega Centro Manhã',
        cliente_id: cliId,
        previsao_entrega: '2026-11-17',
        pagamento_na_entrega: 0,
        liberar: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 20, preco_unitario: 55 }],
      },
    })
    assert.equal(p1Res.statusCode, 201)
    const ped1Id = p1Res.json().id as string

    const p2Res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Entrega Cambuí PIX',
        cliente_id: cliId,
        previsao_entrega: '2026-11-17',
        pagamento_na_entrega: 1,
        liberar: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 15, preco_unitario: 55 }],
      },
    })
    assert.equal(p2Res.statusCode, 201)
    const ped2Id = p2Res.json().id as string

    // Separar caixas nos dois romaneios -> AGUARDANDO_EXPEDICAO (prontos para roteiro)
    for (const [pedId, ean] of [
      [ped1Id, '7890009000011'],
      [ped2Id, '7890009000028'],
    ] as const) {
      const ini = await app.inject({ method: 'POST', url: `/api/saida/iniciar-pedido/${pedId}`, headers })
      assert.equal(ini.statusCode, 200)
      const romId = ini.json().romaneio.id as string

      const bip = await app.inject({
        method: 'POST',
        url: `/api/romaneios/${romId}/caixa`,
        headers,
        payload: { ean_caixa: ean },
      })
      assert.equal(bip.statusCode, 200)

      const fin = await app.inject({
        method: 'POST',
        url: `/api/romaneios/${romId}/finalizar-montagem`,
        headers,
      })
      assert.equal(fin.statusCode, 200)
    }

    // 3. Verificar pedidos disponíveis para roteirização e criar Embarque (Opção B padrão)
    const dispRes = await app.inject({ method: 'GET', url: '/api/roteirizacao/pedidos-disponiveis', headers })
    assert.equal(dispRes.statusCode, 200)
    const disp = dispRes.json().data
    assert.equal(disp.length, 2)
    assert.ok(disp.every((d: any) => d.pronto_para_embarque === true))

    const embRes = await app.inject({
      method: 'POST',
      url: '/api/roteirizacao/embarques',
      headers,
      payload: {
        data_embarque: '2026-11-17',
        pedido_ids: [ped1Id, ped2Id],
      },
    })
    assert.equal(embRes.statusCode, 201, `Criar embarque falhou: ${embRes.body}`)
    const embId = embRes.json().id as string
    const qrToken = embRes.json().qr_token as string
    assert.ok(embRes.json().codigo.startsWith('EMB-'))
    assert.ok(qrToken)

    // Reordenar paradas para [ped2Id, ped1Id]
    const reordRes = await app.inject({
      method: 'PUT',
      url: `/api/roteirizacao/embarques/${embId}/reordenar`,
      headers,
      payload: { pedido_ids_ordenados: [ped2Id, ped1Id] },
    })
    assert.equal(reordRes.statusCode, 200)

    const detEmb = await app.inject({ method: 'GET', url: `/api/roteirizacao/embarques/${embId}`, headers })
    assert.equal(detEmb.statusCode, 200)
    assert.equal(detEmb.json().data.modalidade_impressao, 'OPCAO_B')
    assert.equal(detEmb.json().data.paradas[0].pedido_id, ped2Id)
    assert.equal(detEmb.json().data.paradas[0].ordem_parada, 1)

    // 4. Operador comum (bipagem liberada, gestão bloqueada)
    const opRes = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers,
      payload: {
        nome: 'Operador Doca',
        login: 'opdoca',
        senha: '1234',
        perfil: 'OPERADOR',
        nivel: 'OPERACIONAL',
        deve_trocar_senha: false,
        permissoes: { saida: true, expedicao: true, pedidos: false, transportadoras: false },
      },
    })
    assert.equal(opRes.statusCode, 201)
    const opLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'opdoca', senha: '1234' } })
    assert.equal(opLogin.statusCode, 200)
    assert.equal(opLogin.json().operador.permissoes.roteirizacao_carregamento, true)
    assert.equal(opLogin.json().operador.permissoes.roteirizacao, false)
    const opHeaders = { authorization: `Bearer ${opLogin.json().token}` }

    // Operador NÃO pode criar embarque (403)
    const opCriaBlock = await app.inject({
      method: 'POST',
      url: '/api/roteirizacao/embarques',
      headers: opHeaders,
      payload: { data_embarque: '2026-11-17' },
    })
    assert.equal(opCriaBlock.statusCode, 403)

    // Operador BIPA as 2 caixas (1 bipada única, aceita zeros à esquerda e rejeita caixa fora da rota)
    const bipErrada = await app.inject({
      method: 'POST',
      url: `/api/roteirizacao/embarques/${embId}/carregar-caixa`,
      headers: opHeaders,
      payload: { ean_caixa: '9999999999999' },
    })
    assert.equal(bipErrada.statusCode, 409)

    const bip1 = await app.inject({
      method: 'POST',
      url: `/api/roteirizacao/embarques/${embId}/carregar-caixa`,
      headers: opHeaders,
      payload: { ean_caixa: '007890009000011' },
    })
    assert.equal(bip1.statusCode, 200, `Bip 1 carregamento falhou: ${bip1.body}`)

    const bip2 = await app.inject({
      method: 'POST',
      url: `/api/roteirizacao/embarques/${embId}/carregar-caixa`,
      headers: opHeaders,
      payload: { ean_caixa: '7890009000028' },
    })
    assert.equal(bip2.statusCode, 200)

    // Despachar veículo -> expede os 2 romaneios/pedidos automaticamente
    const desp = await app.inject({
      method: 'POST',
      url: `/api/roteirizacao/embarques/${embId}/despachar`,
      headers: opHeaders,
      payload: { numero_nf_lote: 'NF-8801, NF-8802' },
    })
    assert.equal(desp.statusCode, 200, `Despachar embarque falhou: ${desp.body}`)
    assert.equal(desp.json().expedidosAgora, 2)

    const p1Pos = await app.inject({ method: 'GET', url: `/api/pedidos/${ped1Id}`, headers })
    assert.equal(p1Pos.json().data.status, 'EXPEDIDO')

    // 5. Rastreio Público via QR Code do Motorista (sem JWT!)
    const qrGet = await app.inject({ method: 'GET', url: `/api/public/rastreio/${qrToken}` })
    assert.equal(qrGet.statusCode, 200)
    assert.equal(qrGet.json().paradas.length, 2)

    const qrIni = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/iniciar`,
      payload: { motorista_nome: 'Carlos Motorista', veiculo_placa: 'ABC-9X99' },
    })
    assert.equal(qrIni.statusCode, 200)

    // Tentar concluir parada 1 (ped2Id - pagamento na entrega) SEM confirmar pagamento -> 400!
    const pgBloq = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped2Id}`,
      payload: { status_entrega: 'ENTREGUE', pagamento_confirmado: false },
    })
    assert.equal(pgBloq.statusCode, 400)

    // Confirmar pagamento + entregar ambas paradas -> Embarque vira CONCLUIDO
    const ent1 = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped2Id}`,
      payload: { status_entrega: 'ENTREGUE', pagamento_confirmado: true, observacao_motorista: 'Recebido PIX' },
    })
    assert.equal(ent1.statusCode, 200)

    const ent2 = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped1Id}`,
      payload: { status_entrega: 'ENTREGUE' },
    })
    assert.equal(ent2.statusCode, 200)

    const detFinal = await app.inject({ method: 'GET', url: `/api/roteirizacao/embarques/${embId}`, headers })
    assert.equal(detFinal.json().data.status, 'CONCLUIDO')
    assert.equal(detFinal.json().data.veiculo_placa, 'ABC-9X99')
    assert.equal(detFinal.json().data.motorista_nome, 'Carlos Motorista')

    // Rastreio público do pedido pelo cliente
    const pedTrackToken = detFinal.json().data.paradas.find((p: any) => p.pedido_id === ped1Id).rastreio_token
    const pedPub = await app.inject({ method: 'GET', url: `/api/public/pedido/${pedTrackToken}` })
    assert.equal(pedPub.statusCode, 200)
    assert.equal(pedPub.json().pedido.status_entrega, 'ENTREGUE')

    // Desativar módulo de rastreio QR -> endpoint público bloqueia (403)
    const offRes = await app.inject({
      method: 'PATCH',
      url: '/api/configuracoes/modulos',
      headers,
      payload: { rastreio_motorista_ativo: false },
    })
    assert.equal(offRes.statusCode, 200)

    const qrDesativado = await app.inject({ method: 'GET', url: `/api/public/rastreio/${qrToken}` })
    assert.equal(qrDesativado.statusCode, 403)
  } finally {
    await app.close()
    await conn.close()
  }
})
