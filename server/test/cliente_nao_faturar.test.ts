import test from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import { clientes, estoqueCaixas, estoquePosicao, financeiroTitulos, tenants } from '../src/db/schema/index.js'
import { uuidv7 } from '../src/utils/uuid.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-nao-faturar-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Cliente Somente Controle de Estoque (Não Faturar): zera preços, ignora travas comerciais/crédito e não gera financeiro nem fila fiscal', async () => {
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

    // Ativa travas comerciais estritas no tenant
    await conn.db
      .update(tenants)
      .set({
        featuresJson: {
          trava_margem_ativa: true,
          trava_credito_ativa: true,
          bloquear_venda_abaixo_custo: true,
          margem_minima_padrao_pct: 15,
        },
      })
      .where(eq(tenants.id, tenantId))

    // 1) Simula cliente legado BEEF CONTAINER sem definicao manual -> migrate auto-marca nao_faturar = 1
    const beefLegadoId = uuidv7()
    await conn.db.insert(clientes).values({
      id: beefLegadoId,
      tenantId,
      codigo: '737',
      razaoSocial: 'BEEF CONTAINER LIMITADA',
      nomeFantasia: 'BEEF CONTAINER',
      cnpjCpf: '54.142.043/0001-30',
      bloqueadoFinanceiro: 1,
      isPadrao: 1,
      ativo: 1,
    })

    await runMigrationsAndSeed(conn)

    const cliList1 = await app.inject({
      method: 'GET',
      url: '/api/cadastros/clientes',
      headers,
    })
    assert.equal(cliList1.statusCode, 200)
    const beefRow = (cliList1.json().data as Array<Record<string, unknown>>).find((c) => c.id === beefLegadoId)
    assert.ok(beefRow)
    assert.equal(beefRow.nao_faturar, 1, 'BEEF CONTAINER deve receber nao_faturar=1 automaticamente na migração')

    // 2) Cria produto com custo alto (R$ 35/kg) e saldo em estoque
    const prodRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '58970',
        descricao: 'COSTELA MINGA TESTE LOGISTICA',
        tipo_produto: 'Produto Acabado',
        custo_medio_kg: 35,
        valor_unitario: 48,
      },
    })
    assert.equal(prodRes.statusCode, 201)
    const prodId = prodRes.json().id as string

    await conn.db.insert(estoqueCaixas).values({
      id: uuidv7(),
      tenantId,
      filialId,
      produtoId: prodId,
      eanCaixa: '7890009911223',
      pesoKg: '50.000',
      lote: 'LOTE-NFAT-1',
      endereco: 'CAMARA-01',
      status: 'DISPONIVEL',
    })
    await conn.db.insert(estoquePosicao).values({
      id: uuidv7(),
      tenantId,
      filialId,
      produtoId: prodId,
      endereco: 'CAMARA-01',
      qtdCaixas: 1,
      qtdKg: '50.000',
    })

    // 3) Cria pedido liberado p/ BEEF CONTAINER (mesmo com bloqueadoFinanceiro=1 e preco=0 ou enviado acidentalmente)
    const pedRes = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'SAIDA LOGISTICA PAVAN',
        cliente_id: beefLegadoId,
        liberar: true,
        aplicar_trava_comercial: true,
        itens: [
          {
            produto_id: prodId,
            qtd_kg_solicitada: 25,
            qtd_caixas_solicitada: 1,
            unidade_solicitada: 'CX',
            preco_unitario: 55, // deve ser zerado automaticamente no backend!
          },
        ],
      },
    })
    assert.equal(pedRes.statusCode, 201, pedRes.body)
    const pedJson = pedRes.json()
    assert.equal(pedJson.status, 'LIBERADO', 'Cliente nao_faturar nunca deve cair em BLOQUEADO_COMERCIAL')
    assert.equal(pedJson.trava_comercial, false)

    // Detalhe do pedido confirma preco_unitario = 0 e valor_total = 0
    const detRes = await app.inject({
      method: 'GET',
      url: `/api/pedidos/${pedJson.id}`,
      headers,
    })
    assert.equal(detRes.statusCode, 200)
    const det = detRes.json().data
    assert.equal(det.valor_total, 0)
    assert.equal(det.cliente_nao_faturar, 1)
    assert.equal(det.itens[0].preco_unitario, 0)

    // Nenhum título financeiro gerado
    const titulos = await conn.db
      .select()
      .from(financeiroTitulos)
      .where(eq(financeiroTitulos.pedidoVendaId, pedJson.id))
    assert.equal(titulos.length, 0, 'Cliente nao_faturar não pode gerar Contas a Receber')

    // Não aparece na fila de emissão de NF-e
    const filaFiscalRes = await app.inject({
      method: 'GET',
      url: '/api/fiscal/fila-pedidos',
      headers,
    })
    assert.equal(filaFiscalRes.statusCode, 200)
    const naFila = (filaFiscalRes.json().pedidos as Array<{ id: string }>).some((p) => p.id === pedJson.id)
    assert.equal(naFila, false, 'Pedido de cliente nao_faturar não deve aparecer na fila fiscal de NF-e')

    // 4) Se o usuário desmarcar manualmente nao_faturar = 0 no cadastro, migrate subsequente respeita a escolha manual!
    const putCliRes = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/clientes/${beefLegadoId}`,
      headers,
      payload: {
        codigo: '737',
        razao_social: 'BEEF CONTAINER LIMITADA',
        nome_fantasia: 'BEEF CONTAINER',
        cnpj_cpf: '54.142.043/0001-30',
        uf: 'SP',
        nao_faturar: 0,
        is_padrao: 1,
      },
    })
    assert.equal(putCliRes.statusCode, 200, putCliRes.body)

    await runMigrationsAndSeed(conn)

    const cliList2 = await app.inject({
      method: 'GET',
      url: '/api/cadastros/clientes',
      headers,
    })
    const beefRowAfter = (cliList2.json().data as Array<Record<string, unknown>>).find((c) => c.id === beefLegadoId)
    assert.equal(beefRowAfter?.nao_faturar, 0, 'Escolha manual do usuário deve ser preservada após restart/migração')
  } finally {
    await app.close()
    await conn.close()
  }
})
