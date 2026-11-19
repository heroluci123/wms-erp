import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import { calcularDigitoVerificadorMod11 } from '../src/modules/fiscal/nfeBuilder.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-modulo-fiscal-nfe-nfce-2026',
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

test('Etapa 2 Módulo Fiscal: Motor Tributário Carnes, NF-e 55, NFC-e 65, XML 4.00, CC-e, Cancelamento, Inutilização, Cofre XML & Certificado A1', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)

  try {
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // 1. Configurar empresa como LUCRO PRESUMIDO para testar redução de BC ICMS (Cesta Básica Carnes) e PIS/COFINS Zero
    const resEmps = await app.inject({ method: 'GET', url: '/api/cadastros/empresas', headers })
    const emp = resEmps.json().data[0]
    const resUpdEmp = await app.inject({
      method: 'PUT',
      url: `/api/cadastros/empresas/${emp.id}`,
      headers,
      payload: {
        codigo: emp.codigo,
        razao_social: emp.razao_social,
        nome_fantasia: emp.nome_fantasia,
        cnpj: '12345678000195',
        inscricao_estadual: '110042490114',
        regime_tributario: 'PRESUMIDO',
      },
    })
    assert.equal(resUpdEmp.statusCode, 200, resUpdEmp.body)

    // 2. Config Fiscal + Certificado A1 (.pfx com magic byte 0x30 PKCS#12 + rejeição de arquivo inválido)
    const resCfgPut = await app.inject({
      method: 'PUT',
      url: '/api/fiscal/config',
      headers,
      payload: {
        ambiente: 'HOMOLOGACAO',
        provedor: 'SIMULACAO_LOCAL',
        serie_nfe: 1,
        proximo_numero_nfe: 1,
        serie_nfce: 2,
        proximo_numero_nfce: 10,
        csc_id: '000001',
        csc_token: 'TOKEN-CSC-HOMOLOG-12345',
      },
    })
    assert.equal(resCfgPut.statusCode, 200, resCfgPut.body)

    const resCertBad = await app.inject({
      method: 'POST',
      url: '/api/fiscal/config/certificado',
      headers,
      payload: {
        arquivo_nome: 'falso.txt',
        pfx_base64: Buffer.from('ISTO NAO E UM CERTIFICADO PFX VALIDO').toString('base64'),
        senha: '123',
      },
    })
    assert.equal(resCertBad.statusCode, 400, 'Arquivo que não inicia com 0x30 (ASN.1 PKCS#12) deve ser rejeitado')

    const fakePfxBytes = Buffer.concat([Buffer.from([0x30, 0x82, 0x01, 0x00]), Buffer.alloc(32, 0xaa)])
    const resCertOk = await app.inject({
      method: 'POST',
      url: '/api/fiscal/config/certificado',
      headers,
      payload: {
        arquivo_nome: 'tricarnes_a1_2026.pfx',
        pfx_base64: fakePfxBytes.toString('base64'),
        senha: 'SenhaUltraSecreta2026!',
        titular: 'TRICARNES ALIMENTOS LTDA',
        cnpj: '12.345.678/0001-95',
        validade: '2027-11-19',
      },
    })
    assert.equal(resCertOk.statusCode, 200, resCertOk.body)

    const resCfgGet = await app.inject({ method: 'GET', url: '/api/fiscal/config', headers })
    assert.equal(resCfgGet.statusCode, 200)
    const cfg = resCfgGet.json().data
    assert.equal(cfg.certificado_configurado, true)
    assert.equal(cfg.certificado_nome, 'tricarnes_a1_2026.pfx')
    assert.equal(cfg.certificado_senha_enc, undefined, 'Senha criptografada nunca deve ser exposta na API')

    // 3. Cadastrar Cliente SP + 2 Produtos (Carne Bovina NCM 02013000 + Carvão NCM 44029000) + Pedido de Venda
    const resCli = await app.inject({
      method: 'POST',
      url: '/api/cadastros/clientes',
      headers,
      payload: {
        codigo: 'FISC-C1',
        razao_social: 'CHURRASCARIA FOGO DE CHAO SP LTDA',
        nome_fantasia: 'Fogo de Chao SP',
        cnpj_cpf: '22333444000155',
        inscricao_estadual: '206123456789',
        uf: 'SP',
        cidade: 'SAO PAULO',
      },
    })
    assert.equal(resCli.statusCode, 201, resCli.body)
    const cliId = resCli.json().id as string

    const resCarne = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: 'FISC01',
        descricao: 'PICANHA BOVINA RESFRIADA',
        tipo_produto: 'Produto Acabado',
        unidade: 'KG',
        ncm: '02013000',
        valor_unitario: 100,
      },
    })
    const carneId = resCarne.json().id as string

    const resCarvao = await app.inject({
      method: 'POST',
      url: '/api/cadastros/produtos',
      headers,
      payload: {
        codigo: 'FISC02',
        descricao: 'CARVAO VEGETAL 5KG',
        tipo_produto: 'Insumo',
        unidade: 'UN',
        ncm: '44029000',
        valor_unitario: 20,
      },
    })
    const carvaoId = resCarvao.json().id as string

    const resPed = await app.inject({
      method: 'POST',
      url: '/api/pedidos',
      headers,
      payload: {
        titulo: 'Pedido Fiscal Teste',
        cliente_id: cliId,
        cliente_nome: 'Fogo de Chao SP',
        liberar_agora: true,
        itens: [
          { produto_id: carneId, qtd_kg_solicitada: 10, preco_unitario: 100 }, // R$ 1.000 carne
          { produto_id: carvaoId, qtd_kg_solicitada: 5, preco_unitario: 20 }, // R$ 100 carvão
        ],
      },
    })
    assert.equal(resPed.statusCode, 201, resPed.body)
    const pedId = resPed.json().id as string

    // 4. Fila de emissão deve listar o pedido + Pré-visualização Tributária deve aplicar Cesta Básica Carnes
    const resFila = await app.inject({ method: 'GET', url: '/api/fiscal/fila-pedidos', headers })
    assert.equal(resFila.statusCode, 200)
    assert.ok(resFila.json().pedidos.some((p: any) => p.id === pedId), 'Pedido deve aparecer na fila de emissão fiscal')

    const resPrev = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/preview-pedido/${pedId}`,
      headers,
      payload: { modelo: '55' },
    })
    assert.equal(resPrev.statusCode, 200, resPrev.body)
    const prev = resPrev.json()
    const itCarne = prev.itens.find((i: any) => i.produto_id === carneId)
    const itCarvao = prev.itens.find((i: any) => i.produto_id === carvaoId)

    // Carne Bovina (Presumido SP->SP): CST 20, redução BC 61,11%, ICMS efetivo 7% (= R$ 70,00), PIS/COFINS CST 06 = R$ 0
    assert.equal(itCarne.cfop, '5102')
    assert.equal(itCarne.cst_csosn, '20')
    assert.equal(itCarne.p_red_bc, 61.11)
    assert.equal(itCarne.v_icms, 70)
    assert.equal(itCarne.cst_pis, '06')
    assert.equal(itCarne.v_pis, 0)
    assert.equal(itCarne.v_cofins, 0)

    // Carvão (Presumido SP->SP): CST 00, ICMS 18% (= R$ 18,00), PIS 0,65% (= R$ 0,65), COFINS 3% (= R$ 3,00)
    assert.equal(itCarvao.cst_csosn, '00')
    assert.equal(itCarvao.v_icms, 18)
    assert.equal(itCarvao.v_pis, 0.65)
    assert.equal(itCarvao.v_cofins, 3)

    // 5. Emitir NF-e Modelo 55 -> validar Chave 44 dígitos (Módulo 11), XML 4.00 e trava de duplicidade 409
    const resEmit = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/emitir-pedido/${pedId}`,
      headers,
      payload: { modelo: '55' },
    })
    assert.equal(resEmit.statusCode, 201, resEmit.body)
    const nfe = resEmit.json()
    assert.equal(nfe.modelo, '55')
    assert.equal(nfe.numero, 1)
    assert.equal(nfe.chave_acesso.length, 44, 'Chave NF-e deve ter exatamente 44 dígitos')
    assert.equal(
      calcularDigitoVerificadorMod11(nfe.chave_acesso.slice(0, 43)),
      nfe.chave_acesso.slice(43),
      'Dígito verificador Módulo 11 da chave de acesso deve bater exatamente',
    )

    const resXml = await app.inject({ method: 'GET', url: `/api/fiscal/notas/${nfe.id}/xml`, headers })
    assert.equal(resXml.statusCode, 200)
    const xmlStr = resXml.json().xml as string
    assert.ok(xmlStr.includes('<nfeProc versao="4.00"'), 'XML deve estar no padrão nfeProc 4.00')
    assert.ok(xmlStr.includes('<ICMS20>'), 'XML deve conter tag ICMS20 para carne com redução de base')
    assert.ok(xmlStr.includes('<PISNT><CST>06</CST></PISNT>'), 'XML deve conter PIS alíquota zero CST 06')
    assert.ok(xmlStr.includes(`<chNFe>${nfe.chave_acesso}</chNFe>`))

    // Bloquear emissão duplicada no mesmo pedido
    const resEmitDup = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/emitir-pedido/${pedId}`,
      headers,
      payload: { modelo: '55' },
    })
    assert.equal(resEmitDup.statusCode, 409)

    // 6. Emitir NFC-e Modelo 65 avulsa (padrão PDV) -> série 2, número 10
    const resNfce = await app.inject({
      method: 'POST',
      url: '/api/fiscal/notas/emitir-avulsa',
      headers,
      payload: {
        modelo: '65',
        destinatario_nome: 'CONSUMIDOR FINAL',
        t_pag: '17',
        forma_pagamento_label: '17 - PIX',
        itens: [
          {
            produto_id: carneId,
            codigo: 'FISC01',
            descricao: 'PICANHA EM BIFES',
            ncm: '02013000',
            unidade: 'KG',
            qtd: 1.5,
            valor_unitario: 80,
          },
        ],
      },
    })
    assert.equal(resNfce.statusCode, 201, resNfce.body)
    assert.equal(resNfce.json().modelo, '65')
    assert.equal(resNfce.json().serie, 2)
    assert.equal(resNfce.json().numero, 10)
    assert.equal(resNfce.json().valor_total_nf, 120)

    // 7. Carta de Correção (CC-e) na NF-e 55 + Rejeitar CC-e em NFC-e 65
    const resCce = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/${nfe.id}/carta-correcao`,
      headers,
      payload: { texto_correcao: 'Corrige-se a placa do caminhão refrigerado nos dados adicionais para ABC1D23.' },
    })
    assert.equal(resCce.statusCode, 201, resCce.body)
    assert.equal(resCce.json().sequencia, 1)

    const resCceNfce = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/${resNfce.json().id}/carta-correcao`,
      headers,
      payload: { texto_correcao: 'Tentativa inválida de CC-e em NFC-e modelo 65.' },
    })
    assert.equal(resCceNfce.statusCode, 400)

    // 8. Cancelamento da NF-e 1 libera o pedido para nova emissão corrigida (NF-e 2!)
    const resCanc = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/${nfe.id}/cancelar`,
      headers,
      payload: { motivo: 'Cancelamento por ajuste de peso real conferido na expedição.' },
    })
    assert.equal(resCanc.statusCode, 200, resCanc.body)
    assert.equal(resCanc.json().status, 'CANCELADA')

    const resReemit = await app.inject({
      method: 'POST',
      url: `/api/fiscal/notas/emitir-pedido/${pedId}`,
      headers,
      payload: { modelo: '55' },
    })
    assert.equal(resReemit.statusCode, 201, resReemit.body)
    assert.equal(resReemit.json().numero, 2, 'Após cancelar NF-e 1, nova emissão do pedido deve receber número 2')

    // 9. Inutilização de faixa de numeração (10 a 12) + Cofre XML do Contador
    const resInut = await app.inject({
      method: 'POST',
      url: '/api/fiscal/inutilizacao',
      headers,
      payload: {
        modelo: '55',
        serie: 1,
        numero_inicial: 10,
        numero_final: 12,
        justificativa: 'Pulo de sequência durante migração do sistema legado.',
      },
    })
    assert.equal(resInut.statusCode, 201, resInut.body)

    const mesAtual = new Date().toISOString().slice(0, 7)
    const resCofre = await app.inject({ method: 'GET', url: `/api/fiscal/cofre-xml?mes=${mesAtual}`, headers })
    assert.equal(resCofre.statusCode, 200, resCofre.body)
    const cofre = resCofre.json()
    assert.equal(cofre.resumo.qtd_notas, 3) // NF-e 1 cancelada + NFC-e 10 + NF-e 2 autorizada
    assert.equal(cofre.resumo.qtd_canceladas, 1)
    assert.equal(cofre.resumo.qtd_eventos, 3) // 1 CC-e + 1 Cancelamento + 1 Inutilização
    assert.equal(cofre.arquivos.length, 6)
  } finally {
    await app.close()
    await conn.close()
  }
})
