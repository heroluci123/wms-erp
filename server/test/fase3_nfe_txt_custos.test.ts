import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-fase3-custos-nfe-txt-2026',
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

test('Fase 3: Multi-TXT (sem XML) + De-Para + Pré-Caixas Doca + XML NF-e + Motor Custos NRV & Ranking Fornecedores', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // 1. Verificar Layout TXT semeado padrão ('Paula & Ribeiro / Frigodil')
    const resLayouts = await app.inject({ method: 'GET', url: '/api/compras/layouts-txt', headers })
    assert.equal(resLayouts.statusCode, 200)
    const layoutPadrao = resLayouts.json().data.find((l: any) => l.delimitador === ';')
    assert.ok(layoutPadrao, 'Layout padrão 12 colunas (;) deve existir no seed')

    // 2. Cadastrar Fornecedor, Matéria-Prima, 2 Cortes Principais e 1 Apara
    const resForn = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: 'PAULA-RIB',
        razao_social: 'PAULA & RIBEIRO ALIMENTOS LTDA',
        nome_fantasia: 'Paula & Ribeiro / Frigodil',
        cnpj_cpf: '12345678000195',
        uf: 'SP',
        cidade: 'SAO PAULO',
        registro_sanitario_sif: 'SIF 3301',
      },
    })
    assert.equal(resForn.statusCode, 201, resForn.body)
    const fornId = resForn.json().id

    const resMp = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '88001',
        descricao: 'PEIXINHO T7 MP (BLOCO)',
        tipo_produto: 'Materia Prima',
        classificacao: 'MATERIA_PRIMA',
        unidade: 'KG',
        custo_medio_kg: 19.0,
      },
    })
    assert.equal(resMp.statusCode, 201)
    const mpId = resMp.json().id

    const resCorteNobre = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '88101',
        descricao: 'BIFE DE PEIXINHO PADRAO',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        unidade: 'KG',
        valor_unitario: 60.0,
      },
    })
    assert.equal(resCorteNobre.statusCode, 201)
    const corteNobreId = resCorteNobre.json().id

    const resCorteMedio = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '88102',
        descricao: 'CUBOS DE PEIXINHO T7',
        tipo_produto: 'Produto Acabado',
        classificacao: 'SUBPRODUTO',
        unidade: 'KG',
        valor_unitario: 30.0,
      },
    })
    assert.equal(resCorteMedio.statusCode, 201)
    const corteMedioId = resCorteMedio.json().id

    const resApara = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: '88999',
        descricao: 'APARA DE PEIXINHO LIMPEZA',
        tipo_produto: 'Subproduto / Apara',
        classificacao: 'APARA',
        unidade: 'KG',
        valor_unitario: 5.0,
      },
    })
    assert.equal(resApara.statusCode, 201)
    const aparaId = resApara.json().id

    // Garantir endereço Doca e Produção cadastrados (ou válidos)
    await app.inject({
      method: 'POST',
      url: '/api/cadastros/enderecos',
      headers,
      payload: { codigo: 'REC', descricao: 'Doca Recebimento', tipo: 'DOCA' },
    })

    // 3. Criar Pedido de Compra aprovado (50 kg @ R$ 20,00/kg + R$ 100,00 frete = R$ 22,00/kg efetivo)
    const resPc = await app.inject({
      method: 'POST',
      url: '/api/compras',
      headers,
      payload: {
        fornecedor_id: fornId,
        finalidade: 'MATERIA_PRIMA',
        frete_valor: 100.0,
        aprovar: true,
        itens: [{ produto_id: mpId, qtd_kg_solicitada: 50, preco_unitario_kg: 20.0 }],
      },
    })
    assert.equal(resPc.statusCode, 201, resPc.body)
    const pcId = resPc.json().id

    // 4. Doca & Parametrização: Pedido sem TXT no banco do fornecedor NÃO pode bipar no modo TXT (400)
    const resLibAntes = await app.inject({ method: 'GET', url: '/api/recebimento/pedidos-liberados', headers })
    assert.equal(resLibAntes.statusCode, 200)
    const pcLibAntes = resLibAntes.json().data.find((p: any) => p.id === pcId)
    assert.ok(pcLibAntes, 'PC aprovado deve aparecer em /api/recebimento/pedidos-liberados')
    assert.equal(pcLibAntes.txt_disponiveis_fornecedor, 0)
    const pcItemId = pcLibAntes.itens[0].id

    const resBipSemTxt = await app.inject({
      method: 'POST',
      url: '/api/recebimento/bipar-pre-caixa',
      headers,
      payload: {
        ean_caixa: '0025722336000075',
        pedido_compra_id: pcId,
        endereco: 'REC',
      },
    })
    assert.equal(resBipSemTxt.statusCode, 400, 'Bipar em modo TXT sem etiquetas importadas deve bloquear com 400')

    // Total real das 3 caixas únicas = 20,00 + 15,00 + 15,00 = 50,00 kg (com 1 EAN repetido entre os arquivos)
    const txt1 = [
      'FRIGODIL ALIMENTOS LTDA (TR CM);35861;0025722336000075;75;PEIXINHO (T7);20,00;24;19102026;18122026;226057;Expedida;26102026 10:01',
      'FRIGODIL ALIMENTOS LTDA (TR CM);35861;0025722336000076;75;PEIXINHO (T7);15,00;18;19102026;18122026;226057;Expedida;26102026 10:02',
    ].join('\n')
    const txt2 = [
      'FRIGODIL ALIMENTOS LTDA (TR CM);35861;0025722336000075;75;PEIXINHO (T7);20,00;24;19102026;18122026;226057;Expedida;26102026 10:01', // duplicada!
      'FRIGODIL ALIMENTOS LTDA (TR CM);35862;0025722336000077;75;PEIXINHO (T7);15,00;16;19102026;18122026;226057;Expedida;26102026 10:05',
    ].join('\n')

    // Proibido usar DIRETO_ESTOQUE quando houver arquivos .TXT (obrigatório bipar na doca)
    const resBloqueioDireto = await app.inject({
      method: 'POST',
      url: '/api/compras/importar-lote',
      headers,
      payload: {
        fornecedor_id: fornId,
        layout_id: layoutPadrao.id,
        modo_entrada: 'DIRETO_ESTOQUE',
        depara_vinculos: [
          { codigo_fornecedor: '75', descricao_fornecedor: 'PEIXINHO (T7)', produto_id: mpId },
        ],
        txts: [{ nome: 'ETIQUETAS_REMESSA_1.txt', conteudo: txt1 }],
      },
    })
    assert.equal(resBloqueioDireto.statusCode, 400, 'Importação de TXT direto para estoque sem bipar deve ser bloqueada')

    // Pré-visualizar MÚLTIPLOS TXT SEM vincular a Pedido de Compra (universal por fornecedor)
    const resTxtPrev = await app.inject({
      method: 'POST',
      url: '/api/compras/txt/parse-preview',
      headers,
      payload: {
        arquivos: [
          { nome: 'ETIQUETAS_REMESSA_1.txt', conteudo: txt1 },
          { nome: 'ETIQUETAS_REMESSA_2.txt', conteudo: txt2 },
        ],
        layout_id: layoutPadrao.id,
        fornecedor_id: fornId,
      },
    })
    assert.equal(resTxtPrev.statusCode, 200, resTxtPrev.body)
    const prevJson = resTxtPrev.json()
    assert.equal(prevJson.resumo.arquivos_lidos, 2)
    assert.equal(prevJson.resumo.total_unicas, 3)
    assert.equal(prevJson.resumo.duplicadas_ignoradas, 1)
    assert.equal(prevJson.resumo.total_peso_kg, 50)
    assert.equal(prevJson.resumo.total_pecas, 58)
    assert.equal(prevJson.codigos_encontrados[0].codigo_fornecedor, '75')
    assert.equal(prevJson.codigos_encontrados[0].origem_vinculo, 'NAO_MAPEADO')

    // 5. Importar Lote TXT UNIVERSAL para o Fornecedor (SEM pedido_compra_id! Fica disponível para qualquer PC do fornecedor)
    const resImpTxt = await app.inject({
      method: 'POST',
      url: '/api/compras/importar-lote',
      headers,
      payload: {
        fornecedor_id: fornId,
        layout_id: layoutPadrao.id,
        modo_entrada: 'PRE_RECEBIMENTO',
        depara_vinculos: [
          { codigo_fornecedor: '75', descricao_fornecedor: 'PEIXINHO (T7)', produto_id: mpId },
        ],
        txts: [
          { nome: 'ETIQUETAS_REMESSA_1.txt', conteudo: txt1 },
          { nome: 'ETIQUETAS_REMESSA_2.txt', conteudo: txt2 },
        ],
      },
    })
    assert.equal(resImpTxt.statusCode, 201, resImpTxt.body)
    assert.equal(resImpTxt.json().caixas_importadas, 3)
    assert.equal(resImpTxt.json().peso_total_importado_kg, 50)

    // De-Para deve ficar salvo permanentemente para esse fornecedor
    const resDp = await app.inject({ method: 'GET', url: `/api/compras/depara?fornecedor_id=${fornId}`, headers })
    assert.equal(resDp.statusCode, 200)
    assert.equal(resDp.json().data.length, 1)
    assert.equal(resDp.json().data[0].codigo_fornecedor, '75')
    assert.equal(resDp.json().data[0].produto_id, mpId)

    // Pedidos liberados para o mesmo fornecedor já enxergam automaticamente as 3 caixas universais do banco .TXT
    const resLibDepois = await app.inject({ method: 'GET', url: '/api/recebimento/pedidos-liberados', headers })
    assert.equal(resLibDepois.statusCode, 200)
    const pcLibDepois = resLibDepois.json().data.find((p: any) => p.id === pcId)
    assert.equal(pcLibDepois.txt_disponiveis_fornecedor, 3)

    // 6. Doca: listar Pré-Caixas pelo PC (traz pool universal do fornecedor) -> bipar e validar tolerância ±3% + temperatura
    const resPreList = await app.inject({
      method: 'GET',
      url: `/api/recebimento/pre-caixas?pedido_compra_id=${pcId}&status=PENDENTE`,
      headers,
    })
    assert.equal(resPreList.statusCode, 200)
    assert.equal(resPreList.json().resumo.pendentes, 3)

    const resBipPre = await app.inject({
      method: 'POST',
      url: '/api/recebimento/bipar-pre-caixa',
      headers,
      payload: {
        ean_caixa: '25722336000075', // sem os dois 0 iniciais de 0025722336000075!
        pedido_compra_id: pcId,
        endereco: 'REC',
      },
    })
    assert.equal(resBipPre.statusCode, 201, resBipPre.body)
    const cx1 = resBipPre.json().caixa
    assert.equal(cx1.ean_caixa, '0025722336000075')
    assert.equal(Number(cx1.peso_kg), 20)
    assert.equal(Number(cx1.qtd_pecas), 24)
    assert.equal(Number(cx1.custo_unitario_kg), 22) // R$ 20,00 PC + R$ 2,00/kg rateio frete

    // Re-bipe da mesma etiqueta deve retornar 409 Conflict
    const resBipDup = await app.inject({
      method: 'POST',
      url: '/api/recebimento/bipar-pre-caixa',
      headers,
      payload: { ean_caixa: '0025722336000075', pedido_compra_id: pcId },
    })
    assert.equal(resBipDup.statusCode, 409)

    // Tentar finalizar na doca com apenas 20kg de 50kg (fora de ±3%) deve bloquear com 409
    const resFinPrematuro = await app.inject({
      method: 'POST',
      url: `/api/recebimento/pedidos/${pcId}/finalizar-doca`,
      headers,
      payload: {},
    })
    assert.equal(resFinPrematuro.statusCode, 409, 'Fechamento direto fora da tolerância de ±3% deve ser bloqueado')

    // Bipar as outras 2 etiquetas do banco universal vinculando ao PC ativo (total 50kg / 50kg)
    for (const eanRest of ['0025722336000076', '0025722336000077']) {
      const rBip = await app.inject({
        method: 'POST',
        url: '/api/recebimento/bipar-pre-caixa',
        headers,
        payload: { ean_caixa: eanRest, pedido_compra_id: pcId, endereco: 'REC' },
      })
      assert.equal(rBip.statusCode, 201, rBip.body)
    }

    // Ligar exigência de temperatura obrigatória e validar bloqueio antes de registrar temperatura
    await app.inject({
      method: 'PATCH',
      url: '/api/configuracoes/modulos',
      headers,
      payload: { exigir_temperatura_recebimento: true, tolerancia_recebimento_pct: 3 },
    })
    const resFinSemTemp = await app.inject({
      method: 'POST',
      url: `/api/recebimento/pedidos/${pcId}/finalizar-doca`,
      headers,
      payload: {},
    })
    assert.equal(resFinSemTemp.statusCode, 400, 'Temperatura obrigatória deve bloquear finalização sem °C')

    // Registrar temperatura de amostragem única por item (-1.5 °C) e finalizar na doca
    const resTemp = await app.inject({
      method: 'PATCH',
      url: `/api/recebimento/pedidos/${pcId}/itens/${pcItemId}/temperatura`,
      headers,
      payload: { temperatura_c: -1.5 },
    })
    assert.equal(resTemp.statusCode, 200, resTemp.body)
    assert.equal(resTemp.json().temperatura_c, -1.5)

    const resFinOk = await app.inject({
      method: 'POST',
      url: `/api/recebimento/pedidos/${pcId}/finalizar-doca`,
      headers,
      payload: {},
    })
    assert.equal(resFinOk.statusCode, 200, resFinOk.body)
    assert.equal(resFinOk.json().status_validacao, 'VALIDADO')

    // Restaurar parâmetro Temperatura como Recomendada (padrão)
    await app.inject({
      method: 'PATCH',
      url: '/api/configuracoes/modulos',
      headers,
      payload: { exigir_temperatura_recebimento: false },
    })

    // Verificar detalhe do PC mostra 50kg recebidos, temperatura registrada e 3/3 pré-caixas bipadas
    const resPcDet = await app.inject({ method: 'GET', url: `/api/compras/${pcId}`, headers })
    assert.equal(resPcDet.statusCode, 200)
    assert.equal(resPcDet.json().data.pre_caixas_resumo.total, 3)
    assert.equal(resPcDet.json().data.pre_caixas_resumo.bipadas, 3)
    assert.equal(resPcDet.json().data.itens[0].temperatura_c, -1.5)

    // 6b. Pesagem Manual na Doca c/ Tara Manual (tara_id: null, tara_kg: 0.85) + EAN interno AUTO
    const resPcManual = await app.inject({
      method: 'POST',
      url: '/api/compras',
      headers,
      payload: {
        fornecedor_id: fornId,
        finalidade: 'MATERIA_PRIMA',
        aprovar: true,
        itens: [{ produto_id: corteNobreId, qtd_kg_solicitada: 10, preco_unitario_kg: 40.0 }],
      },
    })
    assert.equal(resPcManual.statusCode, 201, resPcManual.body)
    const pcManualId = resPcManual.json().id

    const resCaixaAuto = await app.inject({
      method: 'POST',
      url: '/api/recebimento/caixa',
      headers,
      payload: {
        ean_caixa: 'AUTO',
        produto_id: corteNobreId,
        pedido_compra_id: pcManualId,
        exigir_pedido_compra: true,
        peso_bruto_kg: 10.85,
        tara_id: null,
        tara_kg: 0.85,
        peso_kg: 10.0,
        qtd_pecas: 10,
        data_producao: '2026-11-17',
        validade: '2026-12-20',
        lote: 'LOTE-DOCA-01',
        endereco: 'REC',
      },
    })
    assert.equal(resCaixaAuto.statusCode, 201, resCaixaAuto.body)
    assert.ok(String(resCaixaAuto.json().caixa.ean_caixa || '').length >= 8, 'EAN interno AUTO deve ser gerado')
    assert.equal(Number(resCaixaAuto.json().caixa.peso_kg), 10)
    assert.equal(Number(resCaixaAuto.json().caixa.tara_kg), 0.85)
    assert.equal(resCaixaAuto.json().caixa.lote, 'LOTE-DOCA-01')

    const resFinManual = await app.inject({
      method: 'POST',
      url: `/api/recebimento/pedidos/${pcManualId}/finalizar-doca`,
      headers,
      payload: {},
    })
    assert.equal(resFinManual.statusCode, 200, 'Com temperatura recomendada, doca dentro de ±3% fecha direto')

    // 7. Importação opcional via XML NF-e (CNPJ novo com auto-cadastro, frete R$ 50 e duplicatas <dup>)
    const xmlNfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35261199887766000144550010000091231000091234">
  <ide><nNF>9123</nNF><serie>1</serie><dhEmi>2026-11-17T09:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>99887766000144</CNPJ><xNome>FRIGORIFICO NOVO BRASIL S/A</xNome><xFant>Frigo Novo Brasil</xFant><IE>12345678</IE><enderEmit><xMun>CAMPINAS</xMun><UF>SP</UF></enderEmit></emit>
  <det nItem="1"><prod><cProd>88001</cProd><xProd>PEIXINHO T7 MP</xProd><NCM>02013000</NCM><qCom>100.0000</qCom><vUnCom>25.0000</vUnCom><vProd>2500.00</vProd></prod></det>
  <total><ICMSTot><vProd>2500.00</vProd><vFrete>50.00</vFrete><vDesc>0.00</vDesc><vNF>2550.00</vNF></ICMSTot></total>
  <cobr><dup><nDup>001</nDup><dVenc>2026-12-17</dVenc><vDup>2550.00</vDup></dup></cobr>
</infNFe></NFe></nfeProc>`

    const resXmlPrev = await app.inject({
      method: 'POST',
      url: '/api/compras/xml/parse-preview',
      headers,
      payload: { xml_conteudo: xmlNfe },
    })
    assert.equal(resXmlPrev.statusCode, 200, resXmlPrev.body)
    assert.equal(resXmlPrev.json().nfe.numero_nf, '9123')
    assert.equal(resXmlPrev.json().nfe.duplicatas.length, 1)
    assert.equal(resXmlPrev.json().nfe.itens[0].custo_unitario_com_frete, 25.5) // 2500 + 50 frete / 100kg

    const resImpXml = await app.inject({
      method: 'POST',
      url: '/api/compras/importar-lote',
      headers,
      payload: {
        xml_conteudo: xmlNfe,
        auto_cadastrar_fornecedor: true,
        modo_entrada: 'DIRETO_ESTOQUE',
      },
    })
    assert.equal(resImpXml.statusCode, 201, resImpXml.body)
    assert.equal(resImpXml.json().numero_nf, '9123')
    assert.ok(resImpXml.json().fornecedor_id, 'Fornecedor do XML deve ter sido auto-cadastrado')

    // 8. Motor de Custos NRV & Rendimento Industrial na Ordem de Produção
    const resOp = await app.inject({
      method: 'POST',
      url: '/api/ops',
      headers,
      payload: {
        nome: 'Desossa Peixinho Paula & Ribeiro',
        status: 'LIBERADA',
        data_producao: '2026-11-17',
        itensPrevistos: [{ tipo: 'ENTRADA', produto_id: mpId, peso_kg_previsto: 50 }],
      },
    })
    assert.equal(resOp.statusCode, 201, resOp.body)
    const opId = resOp.json().id

    // Apontar todas as 3 caixas recebidas (20 + 15 + 15 = 50 kg @ R$ 22,00/kg = R$ 1.100,00 MP)
    for (const ean of ['0025722336000075', '0025722336000076', '0025722336000077']) {
      const rEnt = await app.inject({
        method: 'POST',
        url: `/api/ops/${opId}/entrar-caixa`,
        headers,
        payload: { ean },
      })
      assert.equal(rEnt.statusCode, 200, `Entrada ${ean} falhou: ${rEnt.body}`)
    }

    // Lançar retornos: 30kg Bife Peixinho (@60), 10kg Cubos (@30), 4kg Apara (@5) => Total 44kg / 50kg = 88% rendimento
    const ret1 = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/retorno`,
      headers,
      payload: {
        produto_id: corteNobreId,
        peso_bruto_kg: 30,
        tara_kg: 0,
        qtd_pecas: 30,
        data_producao: '2026-11-17',
        validade: '2026-12-20',
      },
    })
    assert.ok(ret1.statusCode === 200 || ret1.statusCode === 201, ret1.body)

    const ret2 = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/retorno`,
      headers,
      payload: {
        produto_id: corteMedioId,
        peso_bruto_kg: 10,
        tara_kg: 0,
        qtd_pecas: 10,
        data_producao: '2026-11-17',
        validade: '2026-12-20',
      },
    })
    assert.ok(ret2.statusCode === 200 || ret2.statusCode === 201, ret2.body)

    const ret3 = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/retorno`,
      headers,
      payload: {
        produto_id: aparaId,
        peso_bruto_kg: 4,
        tara_kg: 0,
        qtd_pecas: 1,
        data_producao: '2026-11-17',
        validade: '2026-12-20',
      },
    })
    assert.ok(ret3.statusCode === 200 || ret3.statusCode === 201, ret3.body)

    // Informar Embalagens R$ 60,00 e MO/Energia R$ 140,00 -> Total OP = 1100 + 60 + 140 = R$ 1.300,00
    const resPatchCustos = await app.inject({
      method: 'PATCH',
      url: `/api/ops/${opId}/custos`,
      headers,
      payload: { custo_embalagens: 60, custo_mo_indireto: 140 },
    })
    assert.equal(resPatchCustos.statusCode, 200, resPatchCustos.body)

    // Finalizar OP -> consolida NRV + estoque_caixas + produtos.custo_medio_kg
    const resFinOp = await app.inject({
      method: 'POST',
      url: `/api/ops/${opId}/finalizar`,
      headers,
    })
    assert.equal(resFinOp.statusCode, 200, resFinOp.body)
    const finJson = resFinOp.json()
    assert.equal(finJson.rendimento_pct, 88)
    assert.equal(finJson.perda_pct, 12)
    assert.equal(finJson.custos_resumo.metodo_rateio, 'NRV')
    assert.equal(finJson.custos_resumo.custo_mp_total, 1100)
    assert.equal(finJson.custos_resumo.custo_total_op, 1300)

    const cutNobre = finJson.custos_resumo.cortes.find((c: any) => c.produto_id === corteNobreId)
    const cutMedio = finJson.custos_resumo.cortes.find((c: any) => c.produto_id === corteMedioId)
    const cutApara = finJson.custos_resumo.cortes.find((c: any) => c.produto_id === aparaId)

    // Potencial venda: Nobre = 1800, Medio = 300 (soma = 2100); Credito Apara = 4 * 5 = R$ 20 => Restante = 1280
    // Nobre = (1800/2100)*1280 / 30 = R$ 36,5714/kg; Medio = (300/2100)*1280 / 10 = R$ 18,2857/kg
    assert.ok(Math.abs(cutNobre.custo_alocado_kg - 36.5714) < 0.01, `Nobre custo/kg esperado ~36.5714, veio ${cutNobre.custo_alocado_kg}`)
    assert.ok(Math.abs(cutMedio.custo_alocado_kg - 18.2857) < 0.01, `Medio custo/kg esperado ~18.2857, veio ${cutMedio.custo_alocado_kg}`)
    assert.ok(Math.abs(cutApara.custo_alocado_kg - 5.0) < 0.01, `Apara custo/kg esperado 5.00, veio ${cutApara.custo_alocado_kg}`)

    // Conferir Análise Comparativa & Ranking de Fornecedores
    const resAnalise = await app.inject({ method: 'GET', url: '/api/ops/analise-custos', headers })
    assert.equal(resAnalise.statusCode, 200, resAnalise.body)
    const rankForn = resAnalise.json().data.ranking_fornecedores.find((r: any) => r.fornecedor_id === fornId)
    assert.ok(rankForn, 'Fornecedor Paula & Ribeiro deve constar no ranking de rendimento')
    assert.equal(rankForn.rendimento_medio_pct, 88)
    assert.equal(rankForn.custo_medio_mp_kg, 22)
    assert.equal(rankForn.custo_efetivo_aproveitado_kg, 25) // 1100 / 44 kg aproveitados = R$ 25,00/kg real!
  } finally {
    await app.close()
    await conn.close?.()
  }
})
