import test from 'node:test'
import assert from 'node:assert/strict'
import { createDbConnection } from '../src/db/client.js'
import { runMigrationsAndSeed } from '../src/db/migrate.js'
import { buildApp } from '../src/app.js'
import { clearCnpjLookupCache } from '../src/modules/cadastros/cnpjLookup.js'

const TEST_ENV = {
  NODE_ENV: 'test' as const,
  PG_DRIVER: 'pglite' as const,
  PGLITE_DATA_DIR: 'memory://',
  JWT_SECRET: 'test-jwt-secret-consulta-cnpj-2026',
  CORS_ORIGIN: 'http://localhost:5173',
}

async function loginAs(app: any, login: string, senha: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login, senha },
  })
  assert.equal(res.statusCode, 200)
  return res.json().token as string
}

test('Consulta CNPJ Multi-Provedor + Fallback + Checagem de Duplicidade + Cadastro Completo Fornecedor', async () => {
  const conn = await createDbConnection(TEST_ENV)
  await runMigrationsAndSeed(conn)
  const app = await buildApp(conn, TEST_ENV)
  const originalFetch = globalThis.fetch

  try {
    clearCnpjLookupCache()
    const token = await loginAs(app, 'Luciano', '7410')
    const headers = { authorization: `Bearer ${token}` }

    // 1. CNPJ inválido deve retornar 400 imediatamente
    const resInv = await app.inject({
      method: 'GET',
      url: '/api/cadastros/consultar-cnpj/11111111111111',
      headers,
    })
    assert.equal(resInv.statusCode, 400)

    // 2. Mock multi-provedor: CNPJ.ws + BrasilAPI combinados (AUTO)
    globalThis.fetch = async (url: any) => {
      const sUrl = String(url)
      if (sUrl.includes('publica.cnpj.ws')) {
        return new Response(
          JSON.stringify({
            razao_social: 'PAULA E RIBEIRO ALIMENTOS LTDA',
            porte: { descricao: 'Demais' },
            simples: { simples: 'Não', mei: 'Não' },
            estabelecimento: {
              tipo: 'Matriz',
              nome_fantasia: 'FRIGODIL PAULA RIBEIRO',
              situacao_cadastral: 'Ativa',
              data_inicio_atividade: '2018-05-10',
              tipo_logradouro: 'RODOVIA',
              logradouro: 'ANHANGUERA KM 110',
              numero: 'S/N',
              complemento: 'GALPAO 2',
              bairro: 'DISTRITO INDUSTRIAL',
              cep: '13180000',
              ddd1: '19',
              telefone1: '38889900',
              email: 'fiscal@paularibeiro.com.br',
              estado: { sigla: 'SP' },
              cidade: { nome: 'Sumaré' },
              atividade_principal: {
                id: '1011201',
                descricao: 'Frigorífico - abate de bovinos',
              },
              inscricoes_estaduais: [
                { inscricao_estadual: '671099887766', ativo: true, estado: { sigla: 'SP' } },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (sUrl.includes('brasilapi.com.br')) {
        return new Response(
          JSON.stringify({
            cnpj: '00000000000191',
            razao_social: 'PAULA E RIBEIRO ALIMENTOS LTDA',
            nome_fantasia: 'FRIGODIL PAULA RIBEIRO',
            uf: 'SP',
            municipio: 'SUMARE',
            cep: '13180000',
            bairro: 'DISTRITO INDUSTRIAL',
            logradouro: 'ANHANGUERA KM 110',
            descricao_tipo_de_logradouro: 'RODOVIA',
            numero: 'S/N',
            complemento: 'GALPAO 2',
            ddd_telefone_1: '1938889900',
            cnae_fiscal: 1011201,
            cnae_fiscal_descricao: 'Frigorífico - abate de bovinos',
            descricao_situacao_cadastral: 'ATIVA',
            descricao_motivo_situacao_cadastral: 'SEM MOTIVO',
            descricao_identificador_matriz_filial: 'MATRIZ',
            porte: 'DEMAIS',
            data_inicio_atividade: '2018-05-10',
            opcao_pelo_simples: false,
            opcao_pelo_mei: false,
            regime_tributario: [{ ano: 2025, forma_de_tributacao: 'LUCRO REAL' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    }

    const resAuto = await app.inject({
      method: 'GET',
      url: '/api/cadastros/consultar-cnpj/00000000000191',
      headers,
    })
    assert.equal(resAuto.statusCode, 200, resAuto.body)
    const jAuto = resAuto.json()
    assert.equal(jAuto.data.cnpj, '00000000000191')
    assert.equal(jAuto.data.cnpj_formatado, '00.000.000/0001-91')
    assert.equal(jAuto.data.razao_social, 'PAULA E RIBEIRO ALIMENTOS LTDA')
    assert.equal(jAuto.data.inscricao_estadual, '671099887766')
    assert.equal(jAuto.data.email, 'fiscal@paularibeiro.com.br')
    assert.equal(jAuto.data.telefone, '(19) 3888-9900')
    assert.equal(jAuto.data.regime_apuracao, 'LUCRO REAL')
    assert.equal(jAuto.data.uf, 'SP')
    assert.equal(jAuto.data.situacao, 'ATIVA')
    assert.equal(jAuto.ja_cadastrado.fornecedor, null)

    // 3. Fallback automático quando CNPJ.ws e BrasilAPI falham -> OpenCNPJ responde
    clearCnpjLookupCache()
    globalThis.fetch = async (url: any) => {
      const sUrl = String(url)
      if (sUrl.includes('api.opencnpj.org')) {
        return new Response(
          JSON.stringify({
            cnpj: '00000000000191',
            razao_social: 'FORNECEDOR FALLBACK LTDA',
            nome_fantasia: 'FALLBACK CARNES',
            situacao_cadastral: 'Ativa',
            matriz_filial: 'Matriz',
            data_inicio_atividade: '2020-01-15',
            logradouro: 'RUA TESTE',
            numero: '100',
            bairro: 'CENTRO',
            municipio: 'CAMPINAS',
            uf: 'SP',
            cep: '13010000',
            email: 'contato@fallback.com',
            telefones: [{ ddd: '19', numero: '999990000', is_fax: false }],
            opcao_simples: 'S',
            cnaes: [{ codigo: '4634601', descricao: 'Atacado de carnes', is_principal: true }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('Rate limited', { status: 429 })
    }

    const resFb = await app.inject({
      method: 'GET',
      url: '/api/cadastros/consultar-cnpj/00000000000191?refresh=1',
      headers,
    })
    assert.equal(resFb.statusCode, 200, resFb.body)
    assert.equal(resFb.json().data.provedor_usado, 'OpenCNPJ')
    assert.equal(resFb.json().data.regime_apuracao, 'OPTANTE SIMPLES NACIONAL')

    // 4. Importar e salvar Fornecedor completo com endereço, CEP, email, I.E., CNAE e regime
    const resPostForn = await app.inject({
      method: 'POST',
      url: '/api/cadastros/fornecedores',
      headers,
      payload: {
        codigo: '9001',
        razao_social: jAuto.data.razao_social,
        nome_fantasia: jAuto.data.nome_fantasia,
        cnpj_cpf: jAuto.data.cnpj_formatado,
        inscricao_estadual: jAuto.data.inscricao_estadual,
        endereco: jAuto.data.endereco,
        numero: jAuto.data.numero,
        complemento: jAuto.data.complemento,
        bairro: jAuto.data.bairro,
        cep: jAuto.data.cep,
        uf: jAuto.data.uf,
        cidade: jAuto.data.cidade,
        telefone: jAuto.data.telefone,
        email: jAuto.data.email,
        cnae_principal: jAuto.data.cnae_principal,
        regime_apuracao: jAuto.data.regime_apuracao,
        situacao_cadastral: jAuto.data.situacao,
        registro_sanitario_sif: 'SIF 3586',
      },
    })
    assert.equal(resPostForn.statusCode, 201, resPostForn.body)
    const fornId = resPostForn.json().id

    // 5. Reconsultar CNPJ -> deve acusar ja_cadastrado.fornecedor igual ao "Cadastro no Sistec"
    const resJa = await app.inject({
      method: 'GET',
      url: '/api/cadastros/consultar-cnpj/00000000000191',
      headers,
    })
    assert.equal(resJa.statusCode, 200)
    assert.equal(resJa.json().ja_cadastrado.fornecedor.id, fornId)
    assert.equal(resJa.json().ja_cadastrado.fornecedor.codigo, '9001')

    const resList = await app.inject({ method: 'GET', url: '/api/cadastros/fornecedores', headers })
    assert.equal(resList.statusCode, 200)
    const saved = resList.json().data.find((x: any) => x.id === fornId)
    assert.equal(saved.cep, '13180-000')
    assert.equal(saved.email, 'fiscal@paularibeiro.com.br')
    assert.equal(saved.regime_apuracao, 'LUCRO REAL')
  } finally {
    globalThis.fetch = originalFetch
    clearCnpjLookupCache()
    await app.close()
    await conn.close?.()
  }
})
