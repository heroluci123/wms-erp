import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import { eq } from 'drizzle-orm'
import { estoqueCaixas, financeiroTitulos, operadores, produtos } from '../src/db/schema/index.js'
import { uuidv7 } from '../src/utils/uuid.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-secret-etapa3-loja-interunidades-insumos',
  CORS_ORIGIN: 'http://localhost:5173',
}

test('Etapa 3 Completa: Filial Loja 1/1, PDV (QR 80x45 + Balanca EAN-2 + NFC-e), Inter-Unidades (1/2 <-> 2/1 <-> 1/1), Entrada Direta Higiene e Coleta de Insumos', async () => {
  const conn = await createDbConnection(TEST_ENV)
  const seed = await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    // 1. Login MASTER (Luciano)
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'Luciano', senha: '7410' },
    })
    assert.equal(resLogin.statusCode, 200, resLogin.body)
    const token = resLogin.json().token as string
    const hdrMatriz = { Authorization: `Bearer ${token}`, 'x-filial-id': seed.filialIds.estoque }
    const hdrLoja = { Authorization: `Bearer ${token}`, 'x-filial-id': seed.filialIds.acougue }
    const hdrInd = { Authorization: `Bearer ${token}`, 'x-filial-id': seed.filialIds.industrializacao }

    // 2. Verificar Perfis Enxutos de Loja semeados (CAIXA_PDV, ACOUGUE_BALCAO, GERENTE_LOJA) e criar operador CAIXA_PDV isolado
    const resPerfis = await app.inject({ method: 'GET', url: '/api/perfis', headers: hdrMatriz })
    assert.equal(resPerfis.statusCode, 200)
    const codigosPerfis = (resPerfis.json().data || []).map((p: any) => p.codigo)
    assert.ok(codigosPerfis.includes('CAIXA_PDV'), 'Perfil enxuto CAIXA_PDV deve estar semeado')
    assert.ok(codigosPerfis.includes('ACOUGUE_BALCAO'), 'Perfil enxuto ACOUGUE_BALCAO deve estar semeado')
    assert.ok(codigosPerfis.includes('GERENTE_LOJA'), 'Perfil enxuto GERENTE_LOJA deve estar semeado')

    const resCriarCaixaOp = await app.inject({
      method: 'POST',
      url: '/api/operadores',
      headers: hdrLoja,
      payload: {
        nome: 'Operadora Caixa 01',
        login: 'caixa01',
        senha: '1234',
        perfil: 'CAIXA_PDV',
        nivel: 'OPERACIONAL',
        setor: 'Loja / Açougue',
        filial_padrao_id: seed.filialIds.acougue,
        permissoes: { pdv_caixa: true, alterar_propria_senha: true },
      },
    })
    assert.equal(resCriarCaixaOp.statusCode, 201, resCriarCaixaOp.body)
    const opCaixaId = resCriarCaixaOp.json().data?.id || resCriarCaixaOp.json().id
    await conn.db.update(operadores).set({ deveTrocarSenha: 0 }).where(eq(operadores.id, opCaixaId))

    const resLoginCaixa = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'caixa01', senha: '1234' },
    })
    assert.equal(resLoginCaixa.statusCode, 200, resLoginCaixa.body)
    const hdrOpCaixa = { Authorization: `Bearer ${resLoginCaixa.json().token}`, 'x-filial-id': seed.filialIds.acougue }

    // CAIXA_PDV pode ler caixa PDV (200), mas é BLOQUEADO em Compras e OPs industriais (403)
    const resCaixaOk = await app.inject({ method: 'GET', url: '/api/pdv/caixa-atual', headers: hdrOpCaixa })
    assert.equal(resCaixaOk.statusCode, 200)
    const resCaixaBlockCompras = await app.inject({ method: 'GET', url: '/api/compras', headers: hdrOpCaixa })
    assert.equal(resCaixaBlockCompras.statusCode, 403, 'Perfil CAIXA_PDV não pode acessar Compras')
    const resCaixaBlockOps = await app.inject({ method: 'GET', url: '/api/ops', headers: hdrOpCaixa })
    assert.equal(resCaixaBlockOps.statusCode, 403, 'Perfil CAIXA_PDV não pode acessar OPs')

    // 3. Cadastrar 5 produtos (Bovino, Suíno, Aves, Empório UN, Insumo Saco Vácuo)
    const prodBovId = uuidv7()
    const prodSuiId = uuidv7()
    const prodAveId = uuidv7()
    const prodEmpId = uuidv7()
    const prodInsId = uuidv7()

    await conn.db.insert(produtos).values([
      {
        id: prodBovId,
        tenantId: seed.tenantId,
        codigo: '3244',
        ean: '7890000032441',
        descricao: 'PICANHA BOVINA RESFRIADA',
        valorUnitario: '59.90',
        custoMedioKg: '42.00',
        unidade: 'KG',
        grupo: 'Bovinos',
        ncm: '02013000',
        ativo: 1,
      },
      {
        id: prodSuiId,
        tenantId: seed.tenantId,
        codigo: '4100',
        ean: '7890000041009',
        descricao: 'PERNIL SUINO SEM OSSO',
        valorUnitario: '24.50',
        custoMedioKg: '16.50',
        unidade: 'KG',
        grupo: 'Suinos',
        ncm: '02031200',
        ativo: 1,
      },
      {
        id: prodAveId,
        tenantId: seed.tenantId,
        codigo: '5200',
        ean: '7890000052005',
        descricao: 'PEITO DE FRANGO CONGELADO',
        valorUnitario: '18.90',
        custoMedioKg: '12.20',
        unidade: 'KG',
        grupo: 'Aves',
        ncm: '02071400',
        ativo: 1,
      },
      {
        id: prodEmpId,
        tenantId: seed.tenantId,
        codigo: '8801',
        ean: '7891111222233',
        descricao: 'CARVAO VEGETAL PREMIUM 5KG',
        valorUnitario: '29.90',
        custoMedioKg: '18.00',
        unidade: 'UN',
        grupo: 'Emporio',
        ncm: '44029000',
        ativo: 1,
      },
      {
        id: prodInsId,
        tenantId: seed.tenantId,
        codigo: '9501',
        ean: '7899999009501',
        descricao: 'SACO VACUO 25X35 EMBALAGEM',
        valorUnitario: '0.85',
        custoMedioKg: '0.85',
        unidade: 'UN',
        grupo: 'Insumos',
        ncm: '39232190',
        ativo: 1,
      },
    ])

    // Criar 5 caixas no estoque da Matriz (1/2) + 1 caixa produzida na FG (2/1)
    const cxLojaEan = '9900000000001'
    const cxRemBovEan = '9900000000002'
    const cxRemSuiEan = '9900000000003'
    const cxRemAveOpEan = '9900000000004'
    const cxRetProdEan = '9900000000005'

    await conn.db.insert(estoqueCaixas).values([
      {
        id: uuidv7(),
        tenantId: seed.tenantId,
        filialId: seed.filialIds.estoque,
        produtoId: prodBovId,
        eanCaixa: cxLojaEan,
        pesoKg: '22.500',
        pesoBrutoKg: '23.000',
        taraKg: '0.500',
        endereco: 'CAM1-A1',
        status: 'DISPONIVEL',
      },
      {
        id: uuidv7(),
        tenantId: seed.tenantId,
        filialId: seed.filialIds.estoque,
        produtoId: prodBovId,
        eanCaixa: cxRemBovEan,
        pesoKg: '25.000',
        pesoBrutoKg: '25.500',
        taraKg: '0.500',
        endereco: 'CAM1-A2',
        status: 'DISPONIVEL',
      },
      {
        id: uuidv7(),
        tenantId: seed.tenantId,
        filialId: seed.filialIds.estoque,
        produtoId: prodSuiId,
        eanCaixa: cxRemSuiEan,
        pesoKg: '18.400',
        pesoBrutoKg: '18.900',
        taraKg: '0.500',
        endereco: 'CAM1-B1',
        status: 'DISPONIVEL',
      },
      {
        id: uuidv7(),
        tenantId: seed.tenantId,
        filialId: seed.filialIds.estoque,
        produtoId: prodAveId,
        eanCaixa: cxRemAveOpEan,
        pesoKg: '20.000',
        pesoBrutoKg: '20.500',
        taraKg: '0.500',
        endereco: 'CAM1-C1',
        status: 'DISPONIVEL',
      },
      {
        id: uuidv7(),
        tenantId: seed.tenantId,
        filialId: seed.filialIds.industrializacao,
        produtoId: prodBovId,
        eanCaixa: cxRetProdEan,
        pesoKg: '19.750',
        pesoBrutoKg: '20.250',
        taraKg: '0.500',
        endereco: 'PRODUCAO-2-1',
        status: 'DISPONIVEL',
      },
    ])

    // 4. INTER-UNIDADES: Transferência 1/2 -> 1/1 bipando caixa
    const resTrfLoja = await app.inject({
      method: 'POST',
      url: '/api/interunidades/bipar-transferencia-loja',
      headers: hdrMatriz,
      payload: { ean_caixa: cxLojaEan },
    })
    assert.equal(resTrfLoja.statusCode, 201, resTrfLoja.body)
    assert.equal(resTrfLoja.json().data.saldo_loja_novo, 22.5)

    // 5. INTER-UNIDADES: Remessas 1/2 -> 2/1 (Bovino + Suíno manual + Aves AUTOMÁTICA direto na OP da 2/1!)
    const resRemBov = await app.inject({
      method: 'POST',
      url: '/api/interunidades/bipar-remessa-industrializacao',
      headers: hdrMatriz,
      payload: { ean_caixa: cxRemBovEan },
    })
    assert.equal(resRemBov.statusCode, 201, resRemBov.body)
    assert.equal(resRemBov.json().data.especie, 'BOVINO')

    const resRemSui = await app.inject({
      method: 'POST',
      url: '/api/interunidades/bipar-remessa-industrializacao',
      headers: hdrMatriz,
      payload: { ean_caixa: cxRemSuiEan },
    })
    assert.equal(resRemSui.statusCode, 201, resRemSui.body)
    assert.equal(resRemSui.json().data.especie, 'SUINO')

    // Criar OP na filial 2/1 e bipar caixa de AVES que ainda está na 1/2 -> Remessa automática na fila diária!
    const resOpInd = await app.inject({
      method: 'POST',
      url: '/api/ops',
      headers: hdrInd,
      payload: {
        nome: 'OP FG Aves Teste',
        status: 'LIBERADA',
        itensPrevistos: [{ tipo: 'ENTRADA', produto_id: prodAveId, peso_kg_previsto: 20, unidade_prevista: 'KG' }],
      },
    })
    assert.equal(resOpInd.statusCode, 201, resOpInd.body)
    const opIndId = resOpInd.json().id || resOpInd.json().data?.id
    const resEntOpAuto = await app.inject({
      method: 'POST',
      url: `/api/ops/${opIndId}/entrar-caixa`,
      headers: hdrInd,
      payload: { ean: cxRemAveOpEan, forcarConfirmacao: true },
    })
    assert.equal(resEntOpAuto.statusCode, 200, resEntOpAuto.body)
    assert.equal(resEntOpAuto.json().success, true, resEntOpAuto.body)
    assert.equal(resEntOpAuto.json().remessa_automatica?.especie, 'AVES', 'Bipar caixa da 1/2 na OP da 2/1 deve gerar remessa automática AVES')

    // 6. INTER-UNIDADES: Retorno Produção 2/1 -> 1/2 sem fechar OP e SEM faturamento!
    const resRetProd = await app.inject({
      method: 'POST',
      url: '/api/interunidades/bipar-retorno-producao',
      headers: hdrInd,
      payload: { ean_caixa: cxRetProdEan, endereco_destino: 'EXPEDICAO-MATRIZ' },
    })
    assert.equal(resRetProd.statusCode, 201, resRetProd.body)
    assert.equal(resRetProd.json().data.requer_faturamento, false)

    // Confirma que a caixa retornada já pertence à Matriz 1/2 e está DISPONIVEL p/ Pedidos de Venda
    const [cxRetDb] = await conn.db.select().from(estoqueCaixas).where(eq(estoqueCaixas.eanCaixa, cxRetProdEan)).limit(1)
    assert.equal(cxRetDb.filialId, seed.filialIds.estoque)
    assert.equal(cxRetDb.status, 'DISPONIVEL')

    // 7. FATURAMENTO DIÁRIO: Deve consolidar 4 lotes separados (BOVINO 5901, SUINO 5901, AVES 5901 e TRANSF LOJA 5152) e NÃO incluir o retorno 2/1->1/2!
    const resFatDiario = await app.inject({
      method: 'GET',
      url: '/api/interunidades/faturamento-diario',
      headers: hdrMatriz,
    })
    assert.equal(resFatDiario.statusCode, 200, resFatDiario.body)
    const lotes = resFatDiario.json().lotes || []
    assert.equal(lotes.length, 4, `Esperava 4 lotes distintos (BOVINO, SUINO, AVES, TRANSF LOJA), veio ${lotes.length}: ${resFatDiario.body}`)
    assert.ok(lotes.some((l: any) => l.tipo_operacao === 'REMESSA_IND' && l.especie === 'BOVINO' && l.cfop === '5901'))
    assert.ok(lotes.some((l: any) => l.tipo_operacao === 'REMESSA_IND' && l.especie === 'SUINO' && l.cfop === '5901'))
    assert.ok(lotes.some((l: any) => l.tipo_operacao === 'REMESSA_IND' && l.especie === 'AVES' && l.cfop === '5901'))
    assert.ok(lotes.some((l: any) => l.tipo_operacao === 'TRANSFERENCIA_LOJA' && l.cfop === '5152'))

    const resEmitDiario = await app.inject({
      method: 'POST',
      url: '/api/interunidades/faturamento-diario/emitir',
      headers: hdrMatriz,
      payload: { lotes: lotes.map((l: any) => ({ movimentacao_ids: l.movimentacao_ids })) },
    })
    assert.equal(resEmitDiario.statusCode, 201, resEmitDiario.body)
    assert.equal(resEmitDiario.json().total_notas_emitidas, 4)

    // Garantir que Remessas/Transferências NÃO geraram Contas a Receber
    const titsRec = await conn.db
      .select()
      .from(financeiroTitulos)
      .where(eq(financeiroTitulos.tipo, 'RECEBER'))
    assert.equal(titsRec.length, 0, 'NF-es de Remessa/Transferência interna não podem gerar Contas a Receber!')

    // 8. PDV FRENTE DE CAIXA (LOJA 1/1): Abrir caixa, testar QR Zebra 80x45 + Balança EAN-2 + EAN-13, vender com NFC-e e fechar!
    const resAbrirCx = await app.inject({
      method: 'POST',
      url: '/api/pdv/caixa/abrir',
      headers: hdrOpCaixa,
      payload: { saldo_abertura: 200 },
    })
    assert.equal(resAbrirCx.statusCode, 201, resAbrirCx.body)
    const caixaId = resAbrirCx.json().data.id

    // Parser 1: QR Code Zebra 80x45 (TRIC|COD=3244|KG=1.250|VL=74.88|LT=L2111)
    const resScanQr = await app.inject({
      method: 'GET',
      url: `/api/pdv/buscar-codigo?q=${encodeURIComponent('TRIC|COD=3244|KG=1.250|VL=74.88|LT=L2111')}`,
      headers: hdrOpCaixa,
    })
    assert.equal(resScanQr.statusCode, 200, resScanQr.body)
    assert.equal(resScanQr.json().origem, 'QR_ZEBRA_80X45')
    assert.equal(resScanQr.json().match_exato.qtd, 1.25)
    assert.equal(resScanQr.json().match_exato.valor_total, 74.88)

    // Parser 2: Etiqueta Balança EAN-2 Toledo (2 + 03244 + 004550 + 9 -> cód 3244, R$ 45,50)
    const resScanBal = await app.inject({
      method: 'GET',
      url: '/api/pdv/buscar-codigo?q=2032440045509',
      headers: hdrOpCaixa,
    })
    assert.equal(resScanBal.statusCode, 200, resScanBal.body)
    assert.ok(String(resScanBal.json().origem).startsWith('BALANCA_'), `Esperava BALANCA_, veio: ${resScanBal.body}`)
    assert.equal(resScanBal.json().match_exato.valor_total, 45.5)

    // Parser 3: EAN-13 Empório (Carvão)
    const resScanEan = await app.inject({
      method: 'GET',
      url: '/api/pdv/buscar-codigo?q=7891111222233',
      headers: hdrOpCaixa,
    })
    assert.equal(resScanEan.statusCode, 200, resScanEan.body)
    assert.equal(resScanEan.json().match_exato.produto_id, prodEmpId)

    // Registrar Venda PDV com múltiplos pagamentos (Dinheiro c/ troco + PIX) + NFC-e (65)
    const resVenda = await app.inject({
      method: 'POST',
      url: '/api/pdv/vendas',
      headers: hdrOpCaixa,
      payload: {
        caixa_id: caixaId,
        emitir_nfce: true,
        itens: [
          { produto_id: prodBovId, qtd: 1.25, preco_unitario: 59.9, valor_total: 74.88, unidade: 'KG' },
          { produto_id: prodEmpId, qtd: 1, preco_unitario: 29.9, valor_total: 29.9, unidade: 'UN' },
        ],
        pagamentos: [
          { forma: 'PIX', valor: 54.78 },
          { forma: 'DINHEIRO', valor: 60.0 },
        ],
      },
    })
    assert.equal(resVenda.statusCode, 201, resVenda.body)
    assert.equal(resVenda.json().data.valor_total, 104.78)
    assert.equal(resVenda.json().data.troco_valor, 10.0)
    assert.ok(resVenda.json().data.numero_nfce >= 1, 'Venda PDV deve emitir NFC-e (65)')

    // Conferir baixa no estoque da Loja (22.500 - 1.250 = 21.250 kg)
    const resEstLoja = await app.inject({ method: 'GET', url: '/api/varejo/estoque', headers: hdrLoja })
    const itemPicanhaLoja = (resEstLoja.json().data || []).find((i: any) => i.produto_id === prodBovId)
    assert.equal(itemPicanhaLoja.saldo_qtd, 21.25)

    // Inventário Rápido do Varejo (registra quebra de balcão 21.25 -> 20.00)
    const resInvNovo = await app.inject({ method: 'POST', url: '/api/varejo/inventarios', headers: hdrLoja, payload: { titulo: 'Inv Loja Teste' } })
    assert.equal(resInvNovo.statusCode, 201)
    const invId = resInvNovo.json().data.id
    await app.inject({
      method: 'PUT',
      url: `/api/varejo/inventarios/${invId}/contagem`,
      headers: hdrLoja,
      payload: { itens: [{ produto_id: prodBovId, qtd_contada: 20.0 }] },
    })
    const resInvFin = await app.inject({ method: 'POST', url: `/api/varejo/inventarios/${invId}/finalizar`, headers: hdrLoja, payload: {} })
    assert.equal(resInvFin.statusCode, 200)
    assert.equal(resInvFin.json().ajustados, 1)

    // 9. ENTRADA DIRETA DE HIGIENE / USO & CONSUMO (SEM PC E SEM LIMITE DE VALOR)
    const resCenHig = await app.inject({
      method: 'POST',
      url: '/api/fiscal/entradas-compra/criar-cenario-teste',
      headers: hdrMatriz,
      payload: { tipo_cenario: 'HIGIENE_CONSUMO' },
    })
    assert.equal(resCenHig.statusCode, 201, resCenHig.body)

    const resEntHig = await app.inject({
      method: 'POST',
      url: '/api/fiscal/entradas-compra/escriturar',
      headers: hdrMatriz,
      payload: {
        tipo_entrada: 'HIGIENE_CONSUMO_DIRETO',
        categoria_dre: 'HIGIENE / LIMPEZA',
        xml_conteudo: resCenHig.json().xml_conteudo,
      },
    })
    assert.equal(resEntHig.statusCode, 201, resEntHig.body)
    assert.equal(resEntHig.json().tipo_entrada, 'HIGIENE_CONSUMO_DIRETO')
    assert.ok((resEntHig.json().titulos_gerados || []).length >= 1, 'Entrada direta Higiene deve gerar Contas a Pagar')

    // 10. PARÂMETRO ATIVÁVEL DE INSUMOS + MÓDULO DE COLETA BIPANDO ENDEREÇO
    // 10a. Ativar parâmetro controlar_estoque_insumos = true -> bloqueia INSUMO_DIRETO sem PC (400)
    const resCfgIns = await app.inject({
      method: 'PATCH',
      url: '/api/configuracoes/modulos',
      headers: hdrMatriz,
      payload: { controlar_estoque_insumos: true },
    })
    assert.equal(resCfgIns.statusCode, 200)

    const resInsDiretoBloq = await app.inject({
      method: 'POST',
      url: '/api/fiscal/entradas-compra/escriturar',
      headers: hdrMatriz,
      payload: {
        tipo_entrada: 'INSUMO_DIRETO',
        xml_conteudo: resCenHig.json().xml_conteudo,
      },
    })
    assert.equal(resInsDiretoBloq.statusCode, 400, 'Com controlar_estoque_insumos=true, INSUMO_DIRETO sem PC deve retornar 400')

    // 10b. Cadastrar endereço de insumo ALM-VACUO-01 e fazer coleta bipando QR (INS|END=ALM-VACUO-01) disparando alerta de mínimo!
    const resCadIns = await app.inject({
      method: 'POST',
      url: '/api/insumos/estoque',
      headers: hdrMatriz,
      payload: {
        produto_id: prodInsId,
        endereco_codigo: 'ALM-VACUO-01',
        unidade: 'PCT',
        saldo_inicial: 15,
        estoque_minimo: 10,
        custo_unitario: 12.5,
      },
    })
    assert.equal(resCadIns.statusCode, 201, resCadIns.body)

    const resColIns = await app.inject({
      method: 'POST',
      url: '/api/insumos/coletar',
      headers: hdrMatriz,
      payload: {
        endereco_codigo: 'INS|END=ALM-VACUO-01',
        quantidade: 7,
        setor_destino: 'DESOSSA / PRODUÇÃO',
      },
    })
    assert.equal(resColIns.statusCode, 201, resColIns.body)
    assert.equal(resColIns.json().data.saldo_novo, 8)
    assert.equal(resColIns.json().data.custo_total, 87.5)
    assert.equal(resColIns.json().data.alerta_estoque_minimo, true, 'Saldo 8 <= mínimo 10 deve disparar alerta_estoque_minimo')
  } finally {
    await app.close()
    await conn.close()
  }
})
