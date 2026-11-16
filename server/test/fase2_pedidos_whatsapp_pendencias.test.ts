import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-fase2-super-seguro-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

async function setupTestApp() {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)
  return { conn, app }
}

async function loginAs(app: any, login: string, senha: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login, senha },
  })
  assert.equal(res.statusCode, 200, `Login falhou para ${login}: ${res.body}`)
  const body = res.json()
  return body.token as string
}

function extrairId(body: any): string | undefined {
  return body?.id || body?.data?.id || body?.produto?.id || body?.cliente?.id || body?.item?.id
}

test('Fase 2: WhatsApp parser, Inbox -> Pedido, Parcelas, Clonar, Gerar OP e Central de Pendências', async () => {
  const { app, conn } = await setupTestApp()

  try {
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // 1. Seed produtos (MP e subprodutos) via API
    const resMp = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '90001',
        descricao: 'PESCOCO T7',
        tipo_produto: 'Materia Prima',
        classificacao: 'MP',
        unidade: 'KG',
        custo_medio_kg: 32.5,
      },
    })
    assert.ok(
      resMp.statusCode === 200 || resMp.statusCode === 201,
      `Criar MP falhou (${resMp.statusCode}): ${resMp.body}`
    )
    const mpBody = resMp.json()
    const mpId = extrairId(mpBody)
    assert.ok(mpId, `ID da MP nao retornado: ${resMp.body}`)

    const subprodutos = [
      {
        codigo: '10232',
        descricao: 'BABY BEEF 250KG (4X1)',
        tipo_produto: 'Subproduto',
        valor_unitario: 126.9,
      },
      {
        codigo: '10200',
        descricao: 'FILE MIGNON MEDALHAO 230/250 GR CONGELADA',
        tipo_produto: 'Subproduto',
        valor_unitario: 149.9,
      },
      {
        codigo: '10399',
        descricao: 'FILE MIGNON MEDALHAO 50G (12X1)',
        tipo_produto: 'Subproduto',
        valor_unitario: 119.9,
      },
      {
        codigo: '10181',
        descricao: 'FILE MIGNON STROGONOFF CONGELADA',
        tipo_produto: 'Subproduto',
        valor_unitario: 116.9,
      },
      {
        codigo: '10108',
        descricao: 'OSSOBUCO T7',
        tipo_produto: 'Subproduto',
        valor_unitario: 49.9,
        arvore_vinculos: [
          {
            pai_id: mpId,
            rendimento_esperado_pct: 68.5,
          },
        ],
      },
    ]

    for (const sp of subprodutos) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/cadastros/produtos',
        headers,
        payload: {
          ...sp,
          classificacao: 'SUBPRODUTO',
          unidade: 'KG',
        },
      })
      assert.ok(
        r.statusCode === 200 || r.statusCode === 201,
        `Criar subproduto ${sp.codigo} falhou (${r.statusCode}): ${r.body}`
      )
    }

    // 2. Resolver forma de pagamento 14/21 dias e seed cliente
    const resAux = await app.inject({
      method: 'GET',
      url: '/api/cadastros/auxiliares',
      headers,
    })
    assert.equal(resAux.statusCode, 200, `Listar auxiliares falhou: ${resAux.body}`)
    const auxBody = resAux.json()
    const fpsData = auxBody.data?.formasPagamento || auxBody.formasPagamento || auxBody.formas_pagamento || []
    let fp1421 = fpsData.find(
      (f: any) =>
        (Array.isArray(f.dias_parcelas) &&
          f.dias_parcelas.length === 2 &&
          Number(f.dias_parcelas[0]) === 14 &&
          Number(f.dias_parcelas[1]) === 21) ||
        String(f.descricao || '').includes('14/21') ||
        String(f.codigo || '').includes('14')
    )
    if (!fp1421) {
      const resNewFp = await app.inject({
        method: 'POST',
        url: '/api/cadastros/formas-pagamento',
        headers,
        payload: {
          codigo: '14_21_TEST',
          descricao: '14 / 21 dias teste',
          dias_parcelas: [14, 21],
        },
      })
      assert.ok(resNewFp.statusCode === 200 || resNewFp.statusCode === 201, `Criar FP falhou: ${resNewFp.body}`)
      fp1421 = { id: extrairId(resNewFp.json()) }
    }
    const fp1421Id = fp1421.id
    assert.ok(fp1421Id, 'ID da forma de pagamento 14/21 nao encontrado')

    const resCli = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: '822',
        razao_social: 'GALLE RESTAURANTE BAR LTDA',
        nome_fantasia: 'Gale Osteria',
        cidade: 'CAMPINAS',
        uf: 'SP',
        forma_pagamento_padrao_id: fp1421Id,
      },
    })
    assert.ok(
      resCli.statusCode === 200 || resCli.statusCode === 201,
      `Criar cliente falhou (${resCli.statusCode}): ${resCli.body}`
    )
    const cliBody = resCli.json()
    const clienteId = extrairId(cliBody)
    assert.ok(clienteId, `ID do cliente nao retornado: ${resCli.body}`)

    // 3. WhatsApp Inbox POST (parser + auto pendência SUPPLY_CHAIN)
    const mensagemWhatsapp = [
      'Galê Osteria — Campinas',
      '1. Baby Beef — 2 kg × R$ 126,90',
      '2. Filé Mignon Medalhão — 4 kg × R$ 149,90',
      '↳ 230 a 250 g, congelado, 4x1',
      '3. Filé Mignon Medalhão — 4 kg × R$ 119,90',
      '↳ 50 g, 10x1',
      '5. Estrogonofe de Mignon — 4 kg × R$ 116,90',
      '7. Ossobuco — 5 kg × R$ 49,90',
      '↳ T7 — ⚠️ PORÇÕES UNIFORMES (reclamação anterior)',
      'PAGAMENTO: 14/21 dias',
    ].join('\n')

    const resInboxPost = await app.inject({
      method: 'POST',
      url: '/api/whatsapp/inbox',
      headers,
      payload: {
        remetente_nome: 'Galê Osteria',
        remetente_telefone: '19999990000',
        mensagem_bruta: mensagemWhatsapp,
      },
    })
    assert.equal(
      resInboxPost.statusCode,
      201,
      `POST /api/whatsapp/inbox falhou: ${resInboxPost.body}`
    )
    const inboxPost = resInboxPost.json()
    const inboxId = inboxPost.id || inboxPost.item?.id
    assert.ok(inboxId, `Inbox ID ausente: ${resInboxPost.body}`)

    // Verificar Inbox PENDENTE e Pendências + filaAoVivo
    const resInboxList = await app.inject({
      method: 'GET',
      url: '/api/whatsapp/inbox?status=PENDENTE',
      headers,
    })
    assert.equal(resInboxList.statusCode, 200)
    const inboxPendentes = resInboxList.json()
    const listaPend = Array.isArray(inboxPendentes.data)
      ? inboxPendentes.data
      : Array.isArray(inboxPendentes)
      ? inboxPendentes
      : inboxPendentes.itens || []
    assert.ok(listaPend.some((x: any) => x.id === inboxId), 'Inbox recem-criado deve estar em PENDENTE')

    const resPend = await app.inject({
      method: 'GET',
      url: '/api/pendencias?setor=SUPPLY_CHAIN',
      headers,
    })
    assert.equal(resPend.statusCode, 200)
    const pendData = resPend.json()
    assert.ok(pendData.filaAoVivo, 'GET /api/pendencias deve retornar filaAoVivo')
    assert.ok(
      Number(pendData.filaAoVivo.whatsapp_pendentes) >= 1,
      `Esperava whatsapp_pendentes >= 1, veio ${pendData.filaAoVivo.whatsapp_pendentes}`
    )
    const listaTarefas = Array.isArray(pendData.data)
      ? pendData.data
      : Array.isArray(pendData.pendencias)
      ? pendData.pendencias
      : pendData.itens || pendData.lista || []
    assert.ok(
      listaTarefas.some((p: any) => (p.tipo_pendencia || p.tipo) === 'PEDIDO_WHATSAPP'),
      `Esperava pendencia PEDIDO_WHATSAPP em ${JSON.stringify(pendData)}`
    )

    // 4. Converter WhatsApp Inbox -> Pedido RASCUNHO (1-click)
    const resConv = await app.inject({
      method: 'POST',
      url: `/api/whatsapp/inbox/${inboxId}/converter-pedido`,
      headers,
      payload: { liberar: false },
    })
    assert.equal(
      resConv.statusCode,
      201,
      `POST converter-pedido falhou (${resConv.statusCode}): ${resConv.body}`
    )
    const convBody = resConv.json()
    assert.equal(convBody.success, true)
    assert.equal(convBody.status, 'RASCUNHO')
    assert.ok(convBody.id && convBody.codigo)
    const pedidoId = convBody.id

    // Verificar detalhes do pedido convertido
    const resPedDet = await app.inject({
      method: 'GET',
      url: `/api/pedidos/${pedidoId}`,
      headers,
    })
    assert.equal(resPedDet.statusCode, 200)
    const pedDetJson = resPedDet.json()
    const pedDet = pedDetJson.data || pedDetJson
    assert.equal(pedDet.itens.length, 5, `Esperava 5 itens no pedido convertido, veio ${pedDet.itens.length}`)
    assert.equal(pedDet.parcelas.length, 2, `Esperava 2 parcelas (14/21), veio ${pedDet.parcelas?.length}`)

    const somaParcelas = pedDet.parcelas.reduce((acc: number, p: any) => acc + Number(p.valor || 0), 0)
    assert.ok(
      Math.abs(somaParcelas - Number(pedDet.valor_total)) < 0.05,
      `Soma das parcelas (${somaParcelas}) difere do valor_total (${pedDet.valor_total})`
    )

    const itemOssobuco = pedDet.itens.find((it: any) => String(it.produto_codigo) === '10108')
    assert.ok(itemOssobuco, 'Item Ossobuco 10108 deveria estar no pedido')
    assert.ok(
      itemOssobuco.alerta_reclamacao && String(itemOssobuco.alerta_reclamacao).length > 0,
      `Esperava alerta_reclamacao preenchido no Ossobuco: ${JSON.stringify(itemOssobuco)}`
    )

    // Inbox deve aparecer em CONVERTIDO
    const resInboxConv = await app.inject({
      method: 'GET',
      url: '/api/whatsapp/inbox?status=CONVERTIDO',
      headers,
    })
    assert.equal(resInboxConv.statusCode, 200)
    const convListRaw = resInboxConv.json()
    const convList = Array.isArray(convListRaw.data)
      ? convListRaw.data
      : Array.isArray(convListRaw)
      ? convListRaw
      : convListRaw.itens || []
    assert.ok(convList.some((x: any) => x.id === inboxId), 'Inbox convertido deve aparecer em status=CONVERTIDO')

    // 5. PUT /api/pedidos/:id com liberar: true e sem estoque -> Trava Estoque + Cadeado na Central de Pendencias
    const resPut = await app.inject({
      method: 'PUT',
      url: `/api/pedidos/${pedidoId}`,
      headers,
      payload: {
        titulo: pedDet.titulo || 'Galê Osteria — Campinas',
        cliente_id: clienteId,
        forma_pagamento_id: fp1421Id,
        liberar: true,
        itens: pedDet.itens.map((it: any) => ({
          produto_id: it.produto_id,
          qtd_kg_solicitada: Number(it.qtd_kg_solicitada ?? it.quantidade ?? 1),
          preco_unitario: Number(it.preco_unitario || 0),
          alerta_reclamacao: it.alerta_reclamacao || '',
        })),
      },
    })
    assert.equal(
      resPut.statusCode,
      200,
      `PUT /api/pedidos/:id falhou (${resPut.statusCode}): ${resPut.body}`
    )
    const putBody = resPut.json()
    assert.equal(putBody.trava_estoque, true, 'Sem estoque deve ativar trava_estoque')
    assert.equal(putBody.status, 'BLOQUEADO_ESTOQUE')

    // Pedido bloqueado NAO aparece na fila dos operadores (Saida de Materiais)
    const resFilaLocked = await app.inject({ method: 'GET', url: '/api/saida/fila', headers })
    assert.equal(resFilaLocked.statusCode, 200)
    assert.ok(
      !(resFilaLocked.json().data || []).some((x: any) => x.id === pedidoId),
      'Pedido BLOQUEADO_ESTOQUE nao pode aparecer em /api/saida/fila antes de liberar cadeado',
    )

    // Cadeado registrado na Central de Pendencias
    const resPendTrava = await app.inject({ method: 'GET', url: '/api/pendencias?setor=SUPPLY_CHAIN', headers })
    assert.equal(resPendTrava.statusCode, 200)
    assert.ok(
      (resPendTrava.json().data || []).some((p: any) => p.tipo_pendencia === 'TRAVA_ESTOQUE_PEDIDO' && p.referencia_id === pedidoId),
      'Pendencia TRAVA_ESTOQUE_PEDIDO (cadeado) deve existir em Central de Pendencias',
    )

    // Liberar Cadeado (ignorar_trava_estoque: true) -> vai para LIBERADO e aparece em /api/saida/fila
    const resUnlock = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedidoId}/liberar`,
      headers,
      payload: { ignorar_trava_estoque: true },
    })
    assert.equal(resUnlock.statusCode, 200, `Unlock falhou: ${resUnlock.body}`)
    assert.equal(resUnlock.json().status, 'LIBERADO')

    const resPedPosPut = await app.inject({
      method: 'GET',
      url: `/api/pedidos/${pedidoId}`,
      headers,
    })
    const pedPosPut = resPedPosPut.json().data || resPedPosPut.json()
    assert.equal(pedPosPut.status, 'LIBERADO')

    // Saldos de produtos expoe qtd_caixas
    const resSaldos = await app.inject({ method: 'GET', url: '/api/pedidos/saldos-produtos', headers })
    assert.equal(resSaldos.statusCode, 200)
    assert.ok('qtd_caixas' in (resSaldos.json().data?.[0] || {}), 'saldos-produtos deve retornar qtd_caixas')

    // 6. Clonar pedido
    const resClone = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${pedidoId}/clonar`,
      headers,
      payload: { liberar: false },
    })
    assert.equal(
      resClone.statusCode,
      201,
      `POST /api/pedidos/:id/clonar falhou (${resClone.statusCode}): ${resClone.body}`
    )
    const cloneBody = resClone.json()
    assert.equal(cloneBody.status, 'RASCUNHO')
    assert.ok(cloneBody.id && cloneBody.id !== pedidoId)

    const resCloneDet = await app.inject({
      method: 'GET',
      url: `/api/pedidos/${cloneBody.id}`,
      headers,
    })
    assert.equal(resCloneDet.statusCode, 200)
    const cloneDet = resCloneDet.json().data || resCloneDet.json()
    assert.equal(cloneDet.itens.length, 5)
    assert.equal(cloneDet.parcelas.length, 2)

    // 7. Gerar OP automática para pedido sem saldo (Ossobuco 5kg com rendimento 68.5% -> Entrada MP ~7.3kg)
    const resOp = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${cloneBody.id}/gerar-op`,
      headers,
      payload: {},
    })
    assert.equal(
      resOp.statusCode,
      201,
      `POST /api/pedidos/:id/gerar-op falhou (${resOp.statusCode}): ${resOp.body}`
    )
    const opBody = resOp.json()
    assert.ok(opBody.op_id && opBody.op_codigo, `Retorno gerar-op invalido: ${resOp.body}`)
    assert.ok(Number(opBody.itens_sem_saldo) >= 1, `Esperava itens_sem_saldo >= 1, veio ${opBody.itens_sem_saldo}`)

    const resOps = await app.inject({
      method: 'GET',
      url: '/api/ops',
      headers,
    })
    assert.equal(resOps.statusCode, 200)
    const opsRaw = resOps.json()
    const opsList = Array.isArray(opsRaw.data)
      ? opsRaw.data
      : Array.isArray(opsRaw)
      ? opsRaw
      : opsRaw.ops || opsRaw.itens || []
    const opCriada = opsList.find((o: any) => o.id === opBody.op_id || o.codigo === opBody.op_codigo)
    assert.ok(opCriada, `OP ${opBody.op_codigo} nao encontrada em GET /api/ops`)

    // Verificar detalhe/itens da OP (previstos_saida e previstos_entrada via produto_arvore)
    const resOpDet = await app.inject({
      method: 'GET',
      url: `/api/ops/${opBody.op_id}`,
      headers,
    })
    assert.equal(resOpDet.statusCode, 200)
    const opDet = resOpDet.json().data || resOpDet.json()
    const saidas = opDet.previstos_saida || []
    const entradas = opDet.previstos_entrada || []
    assert.ok(saidas.length >= 1, `OP automatica deve ter previstos_saida: ${JSON.stringify(opDet)}`)
    assert.ok(entradas.length >= 1, `OP automatica deve calcular previstos_entrada via produto_arvore: ${JSON.stringify(opDet)}`)
    const entradaMp = entradas.find((e: any) => String(e.produto_codigo) === '90001' || e.produto_id === mpId)
    assert.ok(entradaMp, `Esperava MP 90001 na ENTRADA da OP: ${JSON.stringify(entradas)}`)
    const pesoMp = Number(entradaMp.peso_kg_previsto || entradaMp.peso_previsto_kg || entradaMp.peso_kg || 0)
    // 5kg / 0.685 = 7.299...
    assert.ok(
      pesoMp >= 7.0 && pesoMp <= 7.6,
      `Peso de ENTRADA da MP deveria ser ~7.30kg (5 / 0.685), veio ${pesoMp}`
    )

    // Verificar pendencia OP_POR_PEDIDO no setor PCP
    const resPendPcp = await app.inject({
      method: 'GET',
      url: '/api/pendencias?setor=PCP',
      headers,
    })
    assert.equal(resPendPcp.statusCode, 200)
    const pendPcpData = resPendPcp.json()
    const pendPcpList = Array.isArray(pendPcpData.data)
      ? pendPcpData.data
      : Array.isArray(pendPcpData.pendencias)
      ? pendPcpData.pendencias
      : pendPcpData.itens || []
    assert.ok(
      pendPcpList.some((p: any) => (p.tipo_pendencia || p.tipo) === 'OP_POR_PEDIDO'),
      `Esperava pendencia OP_POR_PEDIDO em PCP: ${JSON.stringify(pendPcpData)}`
    )

    // 7B. Regressao: listagens com subqueries (sem ambiguidade SQL "id") + Marchante FRIGODIL + Rastreabilidade usuário
    for (const ep of ['/api/pedidos?status=TODOS', '/api/ops', '/api/mapas-producao', '/api/inventario']) {
      const rEp = await app.inject({ method: 'GET', url: ep, headers })
      assert.equal(rEp.statusCode, 200, `GET ${ep} deveria retornar 200, veio ${rEp.statusCode}: ${rEp.body}`)
    }

    const rAux = await app.inject({ method: 'GET', url: '/api/cadastros/auxiliares', headers })
    assert.equal(rAux.statusCode, 200)
    const auxData = rAux.json().data
    assert.ok(
      Array.isArray(auxData.marchantes) &&
        auxData.marchantes.some((m: any) => m.codigo === '001' && m.nome === 'FRIGODIL' && Number(m.is_padrao) === 1),
      `Esperava marchante padrao 001 FRIGODIL em auxiliares: ${JSON.stringify(auxData.marchantes)}`,
    )

    const rMarcPost = await app.inject({
      method: 'POST',
      url: '/api/cadastros/marchantes',
      headers,
      payload: { codigo: '002', nome: 'FRIGO TESTE', is_padrao: false },
    })
    assert.equal(rMarcPost.statusCode, 201, `POST /api/cadastros/marchantes falhou: ${rMarcPost.body}`)

    const rPedAuto = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Rastreabilidade Automatica',
        liberar: false,
        itens: [{ produto_id: itemOssobuco.produto_id, qtd_kg_solicitada: 5 }],
      },
    })
    assert.equal(rPedAuto.statusCode, 201, `POST /api/pedidos automatico falhou: ${rPedAuto.body}`)
    const pedAutoId = rPedAuto.json().id
    const rPedAutoDet = await app.inject({ method: 'GET', url: `/api/pedidos/${pedAutoId}`, headers })
    assert.equal(rPedAutoDet.statusCode, 200)
    const pedAuto = rPedAutoDet.json().data
    assert.equal(pedAuto.marchante, 'FRIGODIL')
    assert.equal(pedAuto.criado_por_nome, 'Luciano')
    assert.ok(String(pedAuto.setor_solicitante || '').length > 0)

    // 7C. Preview de OP sem gravar no banco + Bloqueio de OP sem MP ENTRADA + Re-trava ao editar pedido já LIBERADO
    const resOpSemMp = await app.inject({
      method: 'POST',
      url: '/api/ops',
      headers,
      payload: {
        nome: 'OP Sem MP Invalida',
        itensPrevistos: [{ tipo: 'SAIDA', produto_id: itemOssobuco.produto_id, peso_kg_previsto: 5 }],
      },
    })
    assert.equal(resOpSemMp.statusCode, 400, `POST /api/ops sem ENTRADA deveria falhar 400: ${resOpSemMp.body}`)

    const resOpsAntesPreview = await app.inject({ method: 'GET', url: '/api/ops', headers })
    const opsAntesCount = (resOpsAntesPreview.json().data || []).length

    const resOpPreview = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${cloneBody.id}/gerar-op`,
      headers,
      payload: { preview_only: true },
    })
    assert.ok(
      resOpPreview.statusCode === 200 || resOpPreview.statusCode === 201,
      `preview_only falhou (${resOpPreview.statusCode}): ${resOpPreview.body}`,
    )
    const previewBody = resOpPreview.json()
    assert.equal(previewBody.preview_only, true)
    assert.ok(Array.isArray(previewBody.previstos_saida) && previewBody.previstos_saida.length >= 1)
    assert.ok(Array.isArray(previewBody.previstos_entrada) && previewBody.previstos_entrada.length >= 1)

    const resOpsPosPreview = await app.inject({ method: 'GET', url: '/api/ops', headers })
    assert.equal((resOpsPosPreview.json().data || []).length, opsAntesCount, 'preview_only nao pode gravar OP no banco')

    // Pedido já LIBERADO (apos liberar cadeado) ao ter item aumentado volta a disparar trava_estoque
    const resReEditLock = await app.inject({
      method: 'PUT',
      url: `/api/pedidos/${pedidoId}`,
      headers,
      payload: {
        titulo: pedPosPut.titulo || 'Galê Osteria — Campinas',
        cliente_id: clienteId,
        forma_pagamento_id: fp1421Id,
        liberar: true,
        itens: pedPosPut.itens.map((it: any, idx: number) => ({
          produto_id: it.produto_id,
          qtd_kg_solicitada: Number(it.qtd_kg_solicitada ?? 1) + (idx === 0 ? 15 : 0),
          preco_unitario: Number(it.preco_unitario || 0),
        })),
      },
    })
    assert.equal(resReEditLock.statusCode, 200, `Re-edicao pedido liberado falhou: ${resReEditLock.body}`)
    assert.equal(resReEditLock.json().trava_estoque, true, 'Editar pedido ja LIBERADO aumentando qtd sem estoque deve disparar trava_estoque')
    assert.equal(resReEditLock.json().status, 'BLOQUEADO_ESTOQUE')

    // 8. RBAC: usuario CLIENTE bloqueado (403)
    const resCliUser = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers,
      payload: {
        nome: 'ClienteTesteF2',
        login: 'clientetestef2',
        senha: '1122',
        perfil: 'CLIENTE',
        nivel: 'CLIENTE',
        permissoes: { whatsapp_inbox: true, pedidos: true },
      },
    })
    assert.ok(
      resCliUser.statusCode === 200 || resCliUser.statusCode === 201,
      `Falha ao criar operador CLIENTE para RBAC test: ${resCliUser.statusCode} ${resCliUser.body}`
    )
    const cliToken = await loginAs(app, 'clientetestef2', '1122')
    const cliHeaders = { authorization: `Bearer ${cliToken}` }

    const resBlockWa = await app.inject({
      method: 'GET',
      url: '/api/whatsapp/inbox',
      headers: cliHeaders,
    })
    assert.equal(
      resBlockWa.statusCode,
      403,
      `CLIENTE devia receber 403 em /api/whatsapp/inbox, veio ${resBlockWa.statusCode}`
    )

    const resBlockOp = await app.inject({
      method: 'POST',
      url: `/api/pedidos/${cloneBody.id}/gerar-op`,
      headers: cliHeaders,
      payload: {},
    })
    assert.equal(
      resBlockOp.statusCode,
      403,
      `CLIENTE devia receber 403 em /api/pedidos/:id/gerar-op, veio ${resBlockOp.statusCode}`
    )
  } finally {
    await app.close()
    await conn.close?.()
  }
})
