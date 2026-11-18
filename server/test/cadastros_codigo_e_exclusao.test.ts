import test from 'node:test'
import assert from 'node:assert/strict'
import { and, eq, sql } from 'drizzle-orm'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import {
  clientes,
  formasPagamento,
  fornecedores,
  pedidos,
  pedidosCompra,
  produtos,
  recebimentos,
} from '../src/db/schema/index.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-codigo-exclusao-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Cadastros: Codigo automatico/manual/duplicidade e trava de exclusao (contas pagar/receber + 180 dias + sem movimentacao)', async () => {
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
    const headers = { authorization: `Bearer ${loginRes.json().token as string}` }

    // 1. Sugestao automatica inicial + geracao automatica ao omitir/limpar codigo
    for (const tipo of ['produtos', 'clientes', 'fornecedores', 'transportadoras', 'vendedores']) {
      const prox = await app.inject({
        method: 'GET',
        url: `/api/cadastros/proximo-codigo/${tipo}`,
        headers,
      })
      assert.equal(prox.statusCode, 200)
      assert.equal(prox.json().data.codigo, '1')
    }

    const pAuto1 = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: { codigo: '', descricao: 'ITEM AUTO 1' },
    })
    assert.equal(pAuto1.statusCode, 201, pAuto1.body)
    assert.equal(pAuto1.json().codigo, '1')

    const pManual = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: { codigo: '500', descricao: 'ITEM MANUAL 500' },
    })
    assert.equal(pManual.statusCode, 201)
    assert.equal(pManual.json().codigo, '500')

    const pAutoNext = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: { descricao: 'ITEM AUTO POS 500' },
    })
    assert.equal(pAutoNext.statusCode, 201)
    assert.equal(pAutoNext.json().codigo, '501')

    // Duplicidade de codigo em item (POST e PUT, inclusive case-insensitive / com espacos)
    const pDup = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: { codigo: ' 500 ', descricao: 'DUPLICADO' },
    })
    assert.equal(pDup.statusCode, 409)

    const pPutDup = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/produtos/${pAuto1.json().id}`,
      headers,
      payload: { codigo: '500', descricao: 'TENTANDO ROUBAR CODIGO' },
    })
    assert.equal(pPutDup.statusCode, 409)

    // 2. Fornecedores: auto codigo, manual customizado, bloqueio duplicidade ativo/inativo
    const f1 = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { razao_social: 'FORNECEDOR AUTO 1', uf: 'SP' },
    })
    assert.equal(f1.statusCode, 201)
    assert.equal(f1.json().codigo, '1')

    const fManual = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { codigo: 'F-90', razao_social: 'FORNECEDOR MANUAL F90', uf: 'SP' },
    })
    assert.equal(fManual.statusCode, 201)
    assert.equal(fManual.json().codigo, 'F-90')

    const fDupCase = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { codigo: ' f-90 ', razao_social: 'FORN DUP CASE', uf: 'SP' },
    })
    assert.equal(fDupCase.statusCode, 409)

    // Inativar fManual nao libera seu codigo para duplicacao
    const inatFManual = await app.inject({
      method: 'PATCH',
      url: `/api/cadastros/fornecedores/${fManual.json().id}/ativo`,
      headers,
      payload: { ativo: 0 },
    })
    assert.equal(inatFManual.statusCode, 200)
    assert.equal(inatFManual.json().ativo, 0)

    const fDupInativo = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { codigo: 'F-90', razao_social: 'FORN DUP INATIVO', uf: 'SP' },
    })
    assert.equal(fDupInativo.statusCode, 409)

    // Fornecedor sem movimentacao pode ser apagado definitivamente do registro (mesmo ativo/recem criado)
    const delF1 = await app.inject({
      method: 'DELETE',
      url: `/api/cadastros/fornecedores/${f1.json().id}`,
      headers,
    })
    assert.equal(delF1.statusCode, 200)
    const fornRem = await conn.db
      .select({ id: fornecedores.id })
      .from(fornecedores)
      .where(eq(fornecedores.id, f1.json().id))
    assert.equal(fornRem.length, 0)

    // Clientes: auto codigo + duplicidade
    const c1 = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: { razao_social: 'CLIENTE AUTO 1' },
    })
    assert.equal(c1.statusCode, 201)
    assert.equal(c1.json().codigo, '1')

    const c2 = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: { codigo: '10', razao_social: 'CLIENTE COD 10' },
    })
    assert.equal(c2.statusCode, 201)

    const cDup = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: { codigo: '10', razao_social: 'CLIENTE DUPLICADO' },
    })
    assert.equal(cDup.statusCode, 409)

    // Cliente sem movimentacao -> pode apagar definitivamente mesmo ativo
    const delC1 = await app.inject({
      method: 'DELETE',
      url: `/api/cadastros/clientes/${c1.json().id}`,
      headers,
    })
    assert.equal(delC1.statusCode, 200)
    const cliRem = await conn.db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, c1.json().id))
    assert.equal(cliRem.length, 0)

    // 3. Cliente com movimentacao sem contas a receber: bloqueia ativo / <=180d, permite >180d
    const cMovRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: { codigo: '20', razao_social: 'CLIENTE MOVIMENTADO SEM CONTAS' },
    })
    const cMovId = cMovRes.json().id as string

    const pedSemConta = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Cancelado Teste',
        cliente_id: cMovId,
        itens: [{ produto_id: pAuto1.json().id, qtd_kg_solicitada: 10, preco_unitario: 0 }],
      },
    })
    assert.equal(pedSemConta.statusCode, 201)
    await conn.db
      .update(pedidos)
      .set({ status: 'CANCELADO', canceladoAt: new Date() })
      .where(eq(pedidos.id, pedSemConta.json().id))

    // Ativo -> 409
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/cadastros/clientes/${cMovId}`, headers })).statusCode,
      409,
    )

    // Inativar agora -> 30 dias atras (<= 180 dias) -> 409
    await app.inject({
      method: 'PATCH',
      url: `/api/cadastros/clientes/${cMovId}/ativo`,
      headers,
      payload: { ativo: 0 },
    })
    await conn.db
      .update(clientes)
      .set({ inativadoEm: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(clientes.id, cMovId))
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/cadastros/clientes/${cMovId}`, headers })).statusCode,
      409,
    )

    // Exato 180 dias -> ainda bloqueado (regra pede "mais de 180 dias")
    await conn.db
      .update(clientes)
      .set({ inativadoEm: new Date(Date.now() - 179.9 * 86_400_000) })
      .where(eq(clientes.id, cMovId))
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/cadastros/clientes/${cMovId}`, headers })).statusCode,
      409,
    )

    // Inativo ha 185 dias sem contas a receber -> permitido (200) e remove registro mantendo historico
    await conn.db
      .update(clientes)
      .set({ inativadoEm: new Date(Date.now() - 185 * 86_400_000) })
      .where(eq(clientes.id, cMovId))

    const listElegCli = await app.inject({
      method: 'GET',
      url: '/api/cadastros/clientes?incluir_inativos=1',
      headers,
    })
    const movCliRow = listElegCli.json().data.find((x: any) => x.id === cMovId)
    assert.equal(movCliRow.teve_movimentacao, true)
    assert.equal(movCliRow.tem_contas_financeiras, false)
    assert.equal(movCliRow.pode_excluir_definitivo, true)

    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/cadastros/clientes/${cMovId}`, headers })).statusCode,
      200,
    )
    assert.equal((await conn.db.select().from(clientes).where(eq(clientes.id, cMovId))).length, 0)
    const [pedPreservado] = await conn.db.select().from(pedidos).where(eq(pedidos.id, pedSemConta.json().id))
    assert.equal(pedPreservado.clienteId, null)

    // 4. Cliente com CONTAS A RECEBER (parcelas): JAMAIS pode ser apagado, mesmo inativo > 180 dias!
    const [fpPrazo] = await conn.db
      .select()
      .from(formasPagamento)
      .where(and(eq(formasPagamento.tenantId, seed.tenantId), eq(formasPagamento.codigo, '14_21')))
      .limit(1)
    assert.ok(fpPrazo)

    const cContaRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: { codigo: '30', razao_social: 'CLIENTE COM CONTAS A RECEBER' },
    })
    const cContaId = cContaRes.json().id as string

    const pedComConta = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Parcelado Teste',
        cliente_id: cContaId,
        forma_pagamento_id: fpPrazo.id,
        itens: [{ produto_id: pAuto1.json().id, qtd_kg_solicitada: 10, preco_unitario: 45 }],
      },
    })
    assert.equal(pedComConta.statusCode, 201)

    await app.inject({
      method: 'PATCH',
      url: `/api/cadastros/clientes/${cContaId}/ativo`,
      headers,
      payload: { ativo: 0 },
    })
    await conn.db
      .update(clientes)
      .set({ inativadoEm: new Date(Date.now() - 365 * 86_400_000) })
      .where(eq(clientes.id, cContaId))

    const delCliConta = await app.inject({
      method: 'DELETE',
      url: `/api/cadastros/clientes/${cContaId}`,
      headers,
    })
    assert.equal(delCliConta.statusCode, 409)
    assert.match(delCliConta.json().error, /contas a receber/i)

    // 5. Fornecedor com movimentacao s/ contas (>180d -> permitido) vs Fornecedor com CONTAS A PAGAR (duplicata NF-e -> sempre bloqueado!)
    const fMovRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { razao_social: 'FORNECEDOR MOV SEM CONTAS', uf: 'SP' },
    })
    const fMovId = fMovRes.json().id as string

    const pcSemConta = await app.inject({
      method: 'POST',
      url: '/api/compras',
      headers,
      payload: {
        fornecedor_id: fMovId,
        itens: [{ produto_id: pAuto1.json().id, qtd_kg_solicitada: 100, preco_unitario_kg: 0 }],
      },
    })
    assert.equal(pcSemConta.statusCode, 201)
    await conn.db
      .update(pedidosCompra)
      .set({ status: 'CANCELADO', updatedAt: new Date() })
      .where(eq(pedidosCompra.id, pcSemConta.json().id))

    await app.inject({
      method: 'PATCH',
      url: `/api/cadastros/fornecedores/${fMovId}/ativo`,
      headers,
      payload: { ativo: 0 },
    })
    // Com 10 dias inativo -> bloqueado
    await conn.db
      .update(fornecedores)
      .set({ inativadoEm: new Date(Date.now() - 10 * 86_400_000) })
      .where(eq(fornecedores.id, fMovId))
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/cadastros/fornecedores/${fMovId}`, headers })).statusCode,
      409,
    )

    // Com 190 dias inativo -> permitido e preserva consulta de compras
    await conn.db
      .update(fornecedores)
      .set({ inativadoEm: new Date(Date.now() - 190 * 86_400_000) })
      .where(eq(fornecedores.id, fMovId))
    assert.equal(
      (await app.inject({ method: 'DELETE', url: `/api/cadastros/fornecedores/${fMovId}`, headers })).statusCode,
      200,
    )
    const listCompras = await app.inject({ method: 'GET', url: '/api/compras', headers })
    assert.equal(listCompras.statusCode, 200)

    // Fornecedor com Contas a Pagar (duplicatas NF-e no recebimento) -> BLOQUEADO mesmo > 180 dias
    const fContaRes = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: { razao_social: 'FORNECEDOR COM DUPLICATA NFE', uf: 'SP' },
    })
    const fContaId = fContaRes.json().id as string

    await conn.db.insert(recebimentos).values({
      id: '01950000-0000-7000-8000-000000000999',
      tenantId: seed.tenantId,
      filialId: seed.filialIds.estoque,
      codigo: 'REC-9999',
      fornecedorId: fContaId,
      valorTotalNf: '2500.00',
      xmlDuplicatasJson: [{ numero: '001', vencimento: '2026-12-30', valor: 2500 }],
      statusValidacao: 'VALIDADO',
    })

    await app.inject({
      method: 'PATCH',
      url: `/api/cadastros/fornecedores/${fContaId}/ativo`,
      headers,
      payload: { ativo: 0 },
    })
    await conn.db
      .update(fornecedores)
      .set({ inativadoEm: new Date(Date.now() - 365 * 86_400_000) })
      .where(eq(fornecedores.id, fContaId))

    const delFornConta = await app.inject({
      method: 'DELETE',
      url: `/api/cadastros/fornecedores/${fContaId}`,
      headers,
    })
    assert.equal(delFornConta.statusCode, 409)
    assert.match(delFornConta.json().error, /contas a pagar/i)

    // Verifica que listagem ?incluir_inativos=1 expoe bloqueio corretamente
    const listForn = await app.inject({
      method: 'GET',
      url: '/api/cadastros/fornecedores?incluir_inativos=1',
      headers,
    })
    assert.equal(listForn.statusCode, 200)
    const rowConta = listForn.json().data.find((x: any) => x.id === fContaId)
    assert.equal(rowConta.ativo, 0)
    assert.equal(rowConta.tem_contas_financeiras, true)
    assert.equal(rowConta.pode_excluir_definitivo, false)
    // Garante que produtos com codigo automatico e manual estao todos intactos
    const listProds = await app.inject({ method: 'GET', url: '/api/cadastros/produtos', headers })
    assert.equal(listProds.statusCode, 200)
    assert.ok(listProds.json().data.some((p: any) => p.codigo === '1'))
    assert.ok(listProds.json().data.some((p: any) => p.codigo === '500'))
    assert.ok(listProds.json().data.some((p: any) => p.codigo === '501'))
    assert.equal(
      (await conn.db.select({ id: produtos.id }).from(produtos).where(eq(produtos.tenantId, seed.tenantId))).length >= 3,
      true,
    )
    void sql
  } finally {
    await app.close()
    await conn.close()
  }
})
