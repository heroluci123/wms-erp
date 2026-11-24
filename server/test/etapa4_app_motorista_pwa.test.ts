import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-etapa4-app-motorista-pwa-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

// 1x1 PNG e JPEG mínimos válidos em data URL
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

test('Etapa 4: App Motorista PWA (Hub Minhas Rotas, Checklist Pré-Viagem, GPS, POD Assinatura/Foto, Devolução Parcial, Recusa e Timeline Cliente)', async () => {
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

    // Cadastros mínimos
    const prodRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '40100',
        descricao: 'PICANHA BOVINA RESERVA',
        tipo_produto: 'Produto Acabado',
        valor_unitario: 68.0,
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
        codigo: '940',
        razao_social: 'EMPORIO STEAK HOUSE LTDA',
        nome_fantasia: 'Empório Steak',
        endereco: 'Av. Norte-Sul',
        numero: '820',
        bairro: 'Cambuí',
        cidade: 'CAMPINAS',
        uf: 'SP',
        telefone: '19999998888',
      },
    })
    assert.equal(cliRes.statusCode, 201)
    const cliId = cliRes.json().id as string

    // Receber 2 caixas em estoque
    for (const [ean, pesoBruto] of [
      ['7890004000011', 21.0],
      ['7890004000028', 16.0],
    ] as const) {
      const rec = await app.inject({
        method: 'POST',
        url: '/api/recebimento/caixa',
        headers,
        payload: {
          ean_caixa: ean,
          produto_id: prodId,
          endereco: 'A-01-01',
          data_producao: '2026-11-23',
          validade: '2026-12-30',
          peso_bruto_kg: pesoBruto,
          tara_id: taraId,
          tara_kg: 1.0,
          qtd_pecas: 4,
        },
      })
      assert.equal(rec.statusCode, 201)
    }

    // Criar 2 pedidos (Pedido 1 exige pagamento na entrega; Pedido 2 será recusado)
    const p1Res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Entrega Cambuí PIX',
        cliente_id: cliId,
        previsao_entrega: '2026-11-24',
        pagamento_na_entrega: 1,
        liberar: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 20, preco_unitario: 68 }],
      },
    })
    assert.equal(p1Res.statusCode, 201)
    const ped1Id = p1Res.json().id as string

    const p2Res = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Entrega Centro Tarde',
        cliente_id: cliId,
        previsao_entrega: '2026-11-24',
        pagamento_na_entrega: 0,
        liberar: true,
        itens: [{ produto_id: prodId, qtd_kg_solicitada: 15, preco_unitario: 68 }],
      },
    })
    assert.equal(p2Res.statusCode, 201)
    const ped2Id = p2Res.json().id as string

    // Separar caixas nos dois pedidos
    for (const [pedId, ean] of [
      [ped1Id, '7890004000011'],
      [ped2Id, '7890004000028'],
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

    // Criar embarque, bipar as 2 caixas no carregamento e despachar (EM_ROTA)
    const tvListRes = await app.inject({ method: 'GET', url: '/api/cadastros/tipos-veiculo', headers })
    assert.equal(tvListRes.statusCode, 200)
    const veiculoId = tvListRes.json().data[0].id as string

    const embRes = await app.inject({
      method: 'POST',
      url: '/api/roteirizacao/embarques',
      headers,
      payload: {
        data_embarque: '2026-11-24',
        tipo_veiculo_id: veiculoId,
        horario_saida: '06:00',
        pedido_ids: [ped1Id, ped2Id],
      },
    })
    assert.equal(embRes.statusCode, 201)
    const embId = embRes.json().id as string
    const qrToken = embRes.json().qr_token as string
    assert.ok(qrToken)

    for (const ean of ['7890004000011', '7890004000028']) {
      const carr = await app.inject({
        method: 'POST',
        url: `/api/roteirizacao/embarques/${embId}/carregar-caixa`,
        headers,
        payload: { ean_caixa: ean },
      })
      assert.equal(carr.statusCode, 200)
    }

    const desp = await app.inject({
      method: 'POST',
      url: `/api/roteirizacao/embarques/${embId}/despachar`,
      headers,
      payload: { motorista_nome: 'Carlos Silva', veiculo_placa: 'ABC-1D23' },
    })
    assert.equal(desp.statusCode, 200)

    // 2. Hub do App Motorista (autenticado): GET /api/roteirizacao/minhas-rotas
    const hubRes = await app.inject({
      method: 'GET',
      url: '/api/roteirizacao/minhas-rotas',
      headers,
    })
    assert.equal(hubRes.statusCode, 200)
    const minhaRota = hubRes.json().data.find((r: any) => r.id === embId)
    assert.ok(minhaRota, 'Embarque despachado deve aparecer em minhas-rotas')
    assert.equal(minhaRota.qr_token, qrToken)
    assert.equal(minhaRota.status, 'EM_ROTA')
    assert.equal(minhaRota.total_paradas, 2)
    assert.equal(minhaRota.entregues, 0)

    // 3. Carregar rota pública no celular do motorista (sem login)
    const pubGet = await app.inject({
      method: 'GET',
      url: `/api/public/rastreio/${qrToken}`,
    })
    assert.equal(pubGet.statusCode, 200)
    const pubData = pubGet.json()
    assert.equal(pubData.paradas.length, 2)
    assert.ok(pubData.paradas[0].itens_pedido.length >= 1, 'Parada deve trazer lista de itens do pedido')
    const rastreioTokenPed1 = pubData.paradas.find((p: any) => p.pedido_id === ped1Id)?.rastreio_token as string
    assert.ok(rastreioTokenPed1, 'Pedido deve possuir rastreio_token público')

    // 4. Iniciar rota com Checklist Pré-Viagem + Temperatura + Odômetro + GPS
    const iniRota = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/iniciar`,
      payload: {
        motorista_nome: 'Carlos Silva',
        veiculo_placa: 'ABC-1D23',
        checklist_saida: {
          bau_limpo: true,
          temperatura_ok: true,
          temperatura_saida_c: 1.5,
          documentos_nf_ok: true,
          carga_lacrada: true,
          odometro_saida: 145820,
          observacao_checklist: 'Baú resfriado e higienizado antes da saída.',
        },
        lat: -22.9056,
        lng: -47.0608,
      },
    })
    assert.equal(iniRota.statusCode, 200)

    // 5. Check-in GPS em rota + validação de coordenada inválida
    const gpsBad = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/localizacao`,
      payload: { lat: 999, lng: -47.06 },
    })
    assert.equal(gpsBad.statusCode, 400)

    const gpsOk = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/localizacao`,
      payload: { lat: -22.9101, lng: -47.0652 },
    })
    assert.equal(gpsOk.statusCode, 200)
    assert.equal(gpsOk.json().lat, -22.9101)

    // 6. Validação de segurança: rejeita assinatura/foto com formato inválido (XSS / não imagem)
    const podBadImg = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped1Id}`,
      payload: {
        status_entrega: 'ENTREGUE',
        pagamento_confirmado: true,
        assinatura_url: 'javascript:alert(1)',
      },
    })
    assert.equal(podBadImg.statusCode, 400)

    // 7. Chegada no Cliente (NO_CLIENTE)
    const chegouRes = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped1Id}`,
      payload: {
        status_entrega: 'NO_CLIENTE',
        lat: -22.911,
        lng: -47.066,
      },
    })
    assert.equal(chegouRes.statusCode, 200)

    // 8. Entrega completa com POD (Assinatura PNG + Foto Canhoto JPEG + Temp + PIX + Devolução Parcial + GPS)
    const entregaPodRes = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped1Id}`,
      payload: {
        status_entrega: 'ENTREGUE',
        recebedor_nome: 'João da Câmara',
        recebedor_documento: '12.345.678-9',
        temperatura_entrega: 2.1,
        pagamento_confirmado: true,
        forma_pagamento_recebida: 'PIX',
        valor_pago: 1360.0,
        assinatura_url: TINY_PNG_DATA_URL,
        canhoto_foto_url: TINY_JPEG_DATA_URL,
        itens_recusados: [
          {
            produto_id: prodId,
            produto_descricao: 'PICANHA BOVINA RESERVA',
            qtd_caixas: 1,
            peso_kg: 4.5,
            motivo: 'Avaria / Embalagem Danificada',
          },
        ],
        observacao_motorista: 'Descarregado na doca lateral.',
        lat: -22.9112,
        lng: -47.0665,
      },
    })
    assert.equal(entregaPodRes.statusCode, 200, `Entrega POD falhou: ${entregaPodRes.body}`)

    // 9. Parada 2: Recusa total com foto da ocorrência -> cria pendência LOGISTICA e auto-conclui embarque
    const recusaRes = await app.inject({
      method: 'POST',
      url: `/api/public/rastreio/${qrToken}/paradas/${ped2Id}`,
      payload: {
        status_entrega: 'DEVOLVIDA',
        motivo_recusa: 'Local Fechado / Sem Recebedor',
        canhoto_foto_url: TINY_JPEG_DATA_URL,
        observacao_motorista: 'Estabelecimento fechado às 14h15.',
        lat: -22.9205,
        lng: -47.0711,
      },
    })
    assert.equal(recusaRes.statusCode, 200)

    // 10. Conferir Backoffice (GET /api/roteirizacao/embarques/:id)
    const detRes = await app.inject({
      method: 'GET',
      url: `/api/roteirizacao/embarques/${embId}`,
      headers,
    })
    assert.equal(detRes.statusCode, 200)
    const embDet = detRes.json().data
    assert.equal(embDet.status, 'CONCLUIDO', 'Embarque deve concluir automaticamente ao finalizar todas as paradas')
    assert.equal(embDet.checklist_saida.bau_limpo, true)
    assert.equal(embDet.checklist_saida.odometro_saida, 145820)
    assert.equal(embDet.checklist_saida.temperatura_saida_c, 1.5)
    assert.equal(embDet.temperatura_bau, 1.5)
    assert.equal(embDet.ultima_lat, -22.9205)
    assert.equal(embDet.ultima_lng, -47.0711)

    const stop1 = embDet.paradas.find((p: any) => p.pedido_id === ped1Id)
    assert.equal(stop1.status_entrega, 'ENTREGUE')
    assert.equal(stop1.recebedor_nome, 'João da Câmara')
    assert.equal(stop1.recebedor_documento, '12.345.678-9')
    assert.equal(stop1.temperatura_entrega, 2.1)
    assert.equal(stop1.pagamento_confirmado, true)
    assert.equal(stop1.forma_pagamento_recebida, 'PIX')
    assert.equal(stop1.valor_pago, 1360)
    assert.equal(stop1.assinatura_url, TINY_PNG_DATA_URL)
    assert.equal(stop1.canhoto_foto_url, TINY_JPEG_DATA_URL)
    assert.equal(stop1.itens_recusados.length, 1)
    assert.equal(stop1.itens_recusados[0].peso_kg, 4.5)
    assert.equal(stop1.entrega_lat, -22.9112)
    assert.ok(stop1.chegou_em, 'Timestamp chegou_em deve estar salvo')
    assert.ok(stop1.concluido_at, 'Timestamp concluido_at deve estar salvo')

    const stop2 = embDet.paradas.find((p: any) => p.pedido_id === ped2Id)
    assert.equal(stop2.status_entrega, 'DEVOLVIDA')
    assert.equal(stop2.motivo_recusa, 'Local Fechado / Sem Recebedor')
    assert.equal(stop2.canhoto_foto_url, TINY_JPEG_DATA_URL)

    // 11. Conferir Timeline Pública do Cliente (GET /api/public/pedido/:rastreioToken)
    const cliTrackRes = await app.inject({
      method: 'GET',
      url: `/api/public/pedido/${rastreioTokenPed1}`,
    })
    assert.equal(cliTrackRes.statusCode, 200)
    const pedTrack = cliTrackRes.json().pedido
    assert.equal(pedTrack.status_entrega, 'ENTREGUE')
    assert.equal(pedTrack.recebedor_nome, 'João da Câmara')
    assert.equal(pedTrack.temperatura_entrega, 2.1)
    assert.equal(pedTrack.tem_comprovante, true)
    assert.equal(pedTrack.motorista_nome, 'Carlos Silva')
    assert.equal(pedTrack.veiculo_placa, 'ABC-1D23')
    assert.ok(pedTrack.chegou_em)
    assert.ok(pedTrack.concluido_at)

    // 12. Conferir alertas automáticos gerados na Central de Pendências (Setor LOGISTICA)
    const pendRes = await app.inject({
      method: 'GET',
      url: '/api/pendencias?setor=LOGISTICA',
      headers,
    })
    assert.equal(pendRes.statusCode, 200)
    const pendList = pendRes.json().data as Array<any>
    assert.ok(
      pendList.some((p) => p.tipo_pendencia === 'DEVOLUCAO_PARCIAL' && p.referencia_id === ped1Id),
      'Deve gerar alerta DEVOLUCAO_PARCIAL para LOGISTICA',
    )
    assert.ok(
      pendList.some((p) => p.tipo_pendencia === 'RECUSA_ENTREGA' && p.referencia_id === ped2Id),
      'Deve gerar alerta RECUSA_ENTREGA para LOGISTICA',
    )
  } finally {
    await app.close()
    await conn.close()
  }
})
