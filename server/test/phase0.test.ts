import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@libsql/client'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import { empresas, filiais, operadores, tenants } from '../src/db/schema/index.js'
import { hashSenha } from '../src/utils/crypto.js'
import { uuidv7 } from '../src/utils/uuid.js'
import { PERMISSOES_PADRAO_OPERADOR } from '../src/utils/permissoes.js'
import { migrateTursoToPostgres } from '../src/scripts/migrateFromTurso.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-fase0-super-seguro-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Fase 0: Schema PostgreSQL, Seed, Auth JWT, Troca Senha Obrigatoria e Logout', async () => {
  const conn = await createDbConnection(TEST_ENV)
  const seed = await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // 1. Health check real no PostgreSQL PGlite
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    assert.equal(health.statusCode, 200)
    assert.equal(health.json().ok, true)

    // 2. Seed de 3 filiais (1/1 Acougue, 1/2 Estoque, 2/1 FG Industrializacao)
    const filiaisRes = await conn.db.select().from(filiais)
    assert.equal(filiaisRes.length, 3)

    // 3. Login falha com senha errada
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: 'errada' },
    })
    assert.equal(badLogin.statusCode, 401)

    // 4. Login Luciano (MASTER, senha inicial 7410)
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(loginRes.statusCode, 200)
    const loginBody = loginRes.json()
    assert.equal(loginBody.success, true)
    assert.equal(loginBody.operador.nivel, 'MASTER')
    assert.equal(loginBody.operador.deve_trocar_senha, 1)
    const token = loginBody.token as string

    // 5. Auth /me retorna sessao valida
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(meRes.statusCode, 200)
    assert.equal(meRes.json().operador.login, 'Luciano')

    // 6. Troca obrigatoria de senha atualiza hash e zera flag
    const changeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { senhaAtual: '7410', novaSenha: 'Luciano@2026' },
    })
    assert.equal(changeRes.statusCode, 200)

    const oldAfter = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(oldAfter.statusCode, 401)

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: 'Luciano@2026' },
    })
    assert.equal(newLogin.statusCode, 200)
    assert.equal(newLogin.json().operador.deve_trocar_senha, 0)
    const freshToken = newLogin.json().token as string

    // 7. Logout revoga sessao no banco e invalida JWT imediatamente
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${freshToken}` },
    })
    assert.equal(logoutRes.statusCode, 200)

    const meAfterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${freshToken}` },
    })
    assert.equal(meAfterLogout.statusCode, 401)
    assert.ok(seed.tenantId)
  } finally {
    await app.close()
    await conn.close()
  }
})

test('Fase 0: RBAC Server-Side (MASTER vs OPERADOR vs CLIENTE) e Isolamento Multi-Tenant', async () => {
  const conn = await createDbConnection(TEST_ENV)
  const seed = await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // Login MASTER
    const loginMaster = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    const masterToken = loginMaster.json().token as string

    // MASTER cria operador Eliel (OPERADOR) com troca pendente = false e cliente Paulo (CLIENTE)
    const createEliel = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers: { authorization: `Bearer ${masterToken}` },
      payload: {
        nome: 'Eliel',
        login: 'eliel',
        senha: '1234',
        perfil: 'OPERADOR',
        nivel: 'OPERACIONAL',
        deve_trocar_senha: false,
        permissoes: PERMISSOES_PADRAO_OPERADOR,
      },
    })
    assert.equal(createEliel.statusCode, 201)

    const createPaulo = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers: { authorization: `Bearer ${masterToken}` },
      payload: {
        nome: 'Paulo Cliente',
        login: 'paulo',
        senha: '1234',
        perfil: 'CLIENTE',
        nivel: 'CLIENTE',
        deve_trocar_senha: false,
        permissoes: { relatorios_estoque: true, pedidos: true }, // tentando forcar permissao proibida!
      },
    })
    assert.equal(createPaulo.statusCode, 201)

    // MASTER cria produto no Tenant A
    const prodA = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers: { authorization: `Bearer ${masterToken}` },
      payload: {
        codigo: '3344',
        descricao: 'CORACAO DA ALCATRA (TR)',
        tipo_produto: 'Materia Prima',
        tara_primaria_peca_kg: 0.015,
      },
    })
    assert.equal(prodA.statusCode, 201)

    // Login Eliel (OPERADOR)
    const loginEliel = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'eliel', senha: '1234' },
    })
    const elielToken = loginEliel.json().token as string

    // Eliel NAO consegue acessar lista de operadores, criar cliente ou criar produto (403 no servidor!)
    const elielOps = await app.inject({
      method: 'GET',
      url: '/api/operadores',
      headers: { authorization: `Bearer ${elielToken}` },
    })
    assert.equal(elielOps.statusCode, 403)

    const elielCli = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers: { authorization: `Bearer ${elielToken}` },
      payload: { razao_social: 'Cliente Nao Autorizado' },
    })
    assert.equal(elielCli.statusCode, 403)

    // Eliel CONSEGUE consultar produtos
    const elielProds = await app.inject({
      method: 'GET',
      url: '/api/cadastros/produtos',
      headers: { authorization: `Bearer ${elielToken}` },
    })
    assert.equal(elielProds.statusCode, 200)
    assert.equal(elielProds.json().data.length, 1)

    // Login Paulo (CLIENTE): servidor sanitizou e bloqueou 'pedidos' mesmo enviado no POST
    const loginPaulo = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'paulo', senha: '1234' },
    })
    assert.equal(loginPaulo.json().operador.permissoes.pedidos, false)
    const pauloToken = loginPaulo.json().token as string

    const pauloFornecedores = await app.inject({
      method: 'GET',
      url: '/api/cadastros/fornecedores',
      headers: { authorization: `Bearer ${pauloToken}` },
    })
    assert.equal(pauloFornecedores.statusCode, 403)

    // Isolamento Multi-Tenant: criar Tenant B e garantir zero vazamento
    const tenantBId = uuidv7()
    const empBId = uuidv7()
    const filBId = uuidv7()
    await conn.db.insert(tenants).values({
      id: tenantBId,
      nomeConta: 'Frigorifico Concorrente B',
      slug: 'frigo-b',
      plano: 'PRO',
      statusAssinatura: 'ATIVO',
    })
    await conn.db.insert(empresas).values({
      id: empBId,
      tenantId: tenantBId,
      codigo: '1',
      razaoSocial: 'FRIGORIFICO B LTDA',
      nomeFantasia: 'Frigo B',
    })
    await conn.db.insert(filiais).values({
      id: filBId,
      tenantId: tenantBId,
      empresaId: empBId,
      codigo: '1/1',
      nome: 'Matriz B',
      isPadrao: 1,
    })
    const hashB = await hashSenha('b@1234')
    await conn.db.insert(operadores).values({
      id: uuidv7(),
      tenantId: tenantBId,
      empresaId: empBId,
      filialPadraoId: filBId,
      nome: 'Admin B',
      login: 'admin_b',
      senhaHash: hashB,
      perfil: 'ADMINISTRADOR',
      nivel: 'ADMINISTRADOR',
      isAdm: 1,
      ativo: 1,
      deveTrocarSenha: 0,
      permissoesJson: { produtos: true, operadores: true },
    })

    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'admin_b', senha: 'b@1234', tenantSlug: 'frigo-b' },
    })
    assert.equal(loginB.statusCode, 200)
    const tokenB = loginB.json().token as string

    // Tenant B nao enxerga produto '3344' nem operadores do Tenant A
    const prodsB = await app.inject({
      method: 'GET',
      url: '/api/cadastros/produtos',
      headers: { authorization: `Bearer ${tokenB}` },
    })
    assert.equal(prodsB.statusCode, 200)
    assert.equal(prodsB.json().data.length, 0)

    const opsB = await app.inject({
      method: 'GET',
      url: '/api/operadores',
      headers: { authorization: `Bearer ${tokenB}` },
    })
    assert.equal(opsB.statusCode, 200)
    assert.equal(opsB.json().data.length, 1)
    assert.equal(opsB.json().data[0].login, 'admin_b')
    assert.notEqual(seed.tenantId, tenantBId)
  } finally {
    await app.close()
    await conn.close()
  }
})

test('Fase 0: Migracao Turso (libSQL) -> PostgreSQL com Auditoria Matematica 100% Exata', async () => {
  const turso = createClient({ url: ':memory:' })
  const conn = await createDbConnection(TEST_ENV)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // Cria snapshot Turso minimo realista com hash PBKDF2 existente e pesos com 3 casas decimais
    const lucianoHash = await hashSenha('SenhaRealTurso@99')
    await turso.executeMultiple(`
      CREATE TABLE perfis_acesso (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE, nome TEXT, nivel TEXT, setor_padrao TEXT, descricao TEXT, permissoes_json TEXT, sistema_fixo INTEGER);
      CREATE TABLE operadores (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, login TEXT, pin TEXT, senha_hash TEXT, perfil TEXT, nivel TEXT, setor TEXT, is_adm INTEGER, ativo INTEGER, deve_trocar_senha INTEGER, permissoes TEXT);
      CREATE TABLE taras (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, peso_kg REAL, ativo INTEGER, padrao INTEGER);
      CREATE TABLE locais (id INTEGER PRIMARY KEY AUTOINCREMENT, endereco TEXT, capacidade_max_caixas REAL, ativo INTEGER, is_insumo INTEGER, tipo_armazenamento TEXT);
      CREATE TABLE produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, ean TEXT, descricao TEXT, valor_unitario REAL, tipo_produto TEXT, status_curva TEXT, unidade TEXT, grupo TEXT, classificacao TEXT, produto_pai_id INTEGER);
      CREATE TABLE produtos_eans (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER, codigo_barras TEXT, tipo_regra TEXT);
      CREATE TABLE produto_arvore (pai_id INTEGER, filho_id INTEGER);
      CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, razao_social TEXT, nome_fantasia TEXT, cnpj_cpf TEXT, inscricao_estadual TEXT, endereco TEXT, numero TEXT, complemento TEXT, bairro TEXT, cep TEXT, cidade TEXT, uf TEXT, pais TEXT, telefone TEXT, icms TEXT, is_padrao INTEGER, ativo INTEGER);
      CREATE TABLE paletes (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, endereco_atual TEXT, status TEXT, ultimo_operador TEXT);
      CREATE TABLE ordens_producao (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, nome TEXT, status TEXT, operador_id INTEGER, operador_nome TEXT, rendimento_pct REAL, perda_pct REAL, data_producao DATE);
      CREATE TABLE op_itens_previstos (id INTEGER PRIMARY KEY AUTOINCREMENT, op_id INTEGER, tipo TEXT, produto_id INTEGER, qtd_caixas_prevista REAL, peso_kg_previsto REAL, unidade_prevista TEXT);
      CREATE TABLE estoque_caixas (id INTEGER PRIMARY KEY AUTOINCREMENT, ean_caixa TEXT, produto_id INTEGER, palete_id INTEGER, endereco TEXT, lote TEXT, data_producao DATE, validade DATE, peso_bruto_kg REAL, tara_id INTEGER, tara_kg REAL, peso_kg REAL, qtd_pecas INTEGER, origem_tipo TEXT, status TEXT, op_id INTEGER);
      CREATE TABLE pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, titulo TEXT, cliente_id INTEGER, cliente TEXT, previsao_entrega DATE, status TEXT);
      CREATE TABLE pedidos_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, pedido_id INTEGER, produto_id INTEGER, qtd_kg_solicitada REAL, qtd_caixas_solicitada REAL, unidade_solicitada TEXT);
      CREATE TABLE romaneios (id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT, pedido_id INTEGER, cliente TEXT, status TEXT);
      CREATE TABLE romaneios_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, romaneio_id INTEGER, caixa_id INTEGER, produto_id INTEGER, peso_kg REAL, conferido INTEGER);
    `)

    await turso.execute({
      sql: `INSERT INTO operadores (id, nome, login, pin, senha_hash, perfil, nivel, setor, is_adm, ativo, deve_trocar_senha, permissoes)
            VALUES (1, 'Luciano', 'Luciano', '****', ?, 'MASTER', 'MASTER', 'Diretoria / Master', 1, 1, 0, '{}')`,
      args: [lucianoHash],
    })
    await turso.execute(
      `INSERT INTO taras (id, nome, peso_kg, ativo, padrao) VALUES (1, 'Caixa 0,700 kg', 0.7, 1, 1)`
    )
    await turso.execute(
      `INSERT INTO locais (id, endereco, capacidade_max_caixas, ativo, is_insumo, tipo_armazenamento) VALUES (1, '1R-01-1', 50, 1, 0, 'FRIO')`
    )
    await turso.execute(
      `INSERT INTO produtos (id, codigo, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, classificacao)
       VALUES (10, '3344', 'CORACAO DA ALCATRA (TR)', 42.5, 'Materia Prima', 'A', 'KG', 'BOVINOS', 'MATERIA_PRIMA'),
              (11, '3359', 'BANANINHA (TR)', 38.9, 'Produto Acabado', 'B', 'KG', 'BOVINOS', 'SUBPRODUTO')`
    )
    await turso.execute(`INSERT INTO produto_arvore (pai_id, filho_id) VALUES (10, 11)`)
    await turso.execute(
      `INSERT INTO clientes (id, codigo, razao_social, nome_fantasia, cnpj_cpf, uf, is_padrao, ativo)
       VALUES (1, '737', 'BEEF CONTAINER LIMITADA', 'PAVAN', '54.142.043/0001-30', 'SP', 1, 1)`
    )
    await turso.execute(
      `INSERT INTO estoque_caixas (id, ean_caixa, produto_id, endereco, lote, data_producao, validade, peso_bruto_kg, tara_id, tara_kg, peso_kg, qtd_pecas, origem_tipo, status)
       VALUES (100, '789000000001', 10, '1R-01-1', '121126', '2026-11-12', '2026-12-26', 18.455, 1, 0.700, 17.755, 4, 'RECEBIMENTO', 'DISPONIVEL'),
              (101, '789000000002', 11, '1R-01-1', '121126', '2026-11-12', '2026-12-15', 24.825, 1, 0.700, 24.125, 12, 'RECEBIMENTO', 'DISPONIVEL'),
              (102, '789000000003', 10, 'EXPEDICAO', '101126', '2026-11-10', '2026-12-20', 20.000, 1, 0.700, 19.300, 3, 'RECEBIMENTO', 'EXPEDIDA')`
    )

    const report = await migrateTursoToPostgres(turso, conn)
    assert.equal(report.counts.produtos.source, 2)
    assert.equal(report.counts.produtos.target, 2)
    assert.equal(report.counts.estoque_caixas.source, 3)
    assert.equal(report.counts.estoque_caixas.target, 3)
    assert.equal(report.estoqueDisponivel.sourceCount, 2)
    assert.equal(report.estoqueDisponivel.targetCount, 2)
    assert.equal(report.estoqueDisponivel.sourceKg, '41.880')
    assert.equal(report.estoqueDisponivel.targetKg, '41.880')

    // Senha original PBKDF2 do Turso continua autenticando no novo PostgreSQL!
    const loginMigrado = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: 'SenhaRealTurso@99' },
    })
    assert.equal(loginMigrado.statusCode, 200)
    assert.equal(loginMigrado.json().operador.deve_trocar_senha, 0)
  } finally {
    await app.close()
    await conn.close()
  }
})
