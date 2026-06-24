import { db } from '../lib/db.js';

/** Queries de Estoque e Posições */

// Listagem geral com JOIN em produtos, excluindo registros zerados
export async function listarGeral() {
  const res = await db.execute(`
    SELECT
      ep.id, ep.endereco, ep.lote, ep.validade,
      ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
      p.status_curva, p.valor_unitario, p.unidade, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.qtd_caixas > 0 OR ep.qtd_kg > 0
    ORDER BY ep.endereco, p.descricao, ep.validade
  `)
  return res.rows
}

// Busca saldo de um produto em um endereço específico (apenas lotes com saldo > 0)
export async function buscarPorEnderecoProduto(endereco, produto_id) {
  const res = await db.execute({
    sql: `
      SELECT
        ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg,
        p.descricao, p.codigo, p.status_curva, p.grupo
      FROM estoque_posicao ep
      JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.endereco = ? AND ep.produto_id = ?
        AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
      ORDER BY ep.validade ASC
    `,
    args: [endereco, produto_id]
  })
  return res.rows
}

// Tudo em um endereço
export async function buscarPorEndereco(endereco) {
  const res = await db.execute({
    sql: `
      SELECT
        ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg,
        p.id as produto_id, p.descricao, p.codigo, p.status_curva, p.grupo
      FROM estoque_posicao ep
      JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.endereco = ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
      ORDER BY ep.validade ASC
    `,
    args: [endereco]
  })
  return res.rows
}

// Sugestão de Putaway: endereços onde o produto já tem saldo (excluindo REC e EXPEDICAO)
export async function sugestaoPutaway(produto_id, lote) {
  const res = await db.execute({
    sql: `
      SELECT endereco, lote, qtd_caixas, qtd_kg, validade
      FROM estoque_posicao
      WHERE produto_id = ?
        AND endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
        AND (qtd_caixas > 0 OR qtd_kg > 0)
      ORDER BY
        CASE WHEN lote = ? THEN 0 ELSE 1 END,
        qtd_caixas DESC
    `,
    args: [produto_id, lote || '']
  })
  return res.rows
}

// Verificação FEFO: existem lotes mais antigos do mesmo produto?
// Retorna lotes com validade MENOR que a bipada (mais antigos que deveriam sair primeiro)
export async function verificarFEFO(produto_id, validade_bipada) {
  const res = await db.execute({
    sql: `
      SELECT ep.endereco, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg
      FROM estoque_posicao ep
      WHERE ep.produto_id = ?
        AND ep.validade IS NOT NULL
        AND ep.validade < ?
        AND ep.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
        AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
      ORDER BY ep.validade ASC
    `,
    args: [produto_id, validade_bipada]
  })
  return res.rows
}

// Listar área de expedição
export async function listarExpedicao() {
  const res = await db.execute(`
    SELECT
      ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.status_curva, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = 'EXPEDICAO'
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
    ORDER BY ep.updated_at DESC
  `)
  return res.rows
}

// KPIs para o Dashboard
export async function calcularKPIs(filtros = {}) {
  const isEstritoInsumo = filtros.incluirInsumos === true
  const filterSQL = isEstritoInsumo ? " AND p.tipo_produto = 'Insumos'" : " AND p.tipo_produto != 'Insumos'";

  const totalSKUs = (await db.execute(`SELECT COUNT(DISTINCT ep.produto_id) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`)).rows[0]
  const itensREC = (await db.execute(`SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'REC' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`)).rows[0]
  const itensExpedicao = (await db.execute(`SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'EXPEDICAO' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`)).rows[0]
  const inventariosAbertos = (await db.execute(`SELECT COUNT(*) as v FROM inventarios WHERE status NOT IN ('Finalizado')`)).rows[0]
  
  const hoje = new Date()
  const em30dias = new Date(hoje)
  em30dias.setDate(hoje.getDate() + 30)
  const dataLimite = em30dias.toISOString().split('T')[0]
  const dataHoje = hoje.toISOString().split('T')[0]
  
  const vencendoBreve = (await db.execute({
    sql: `
      SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.validade IS NOT NULL
        AND ep.validade >= ? AND ep.validade <= ?
        AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}
    `,
    args: [dataHoje, dataLimite]
  })).rows[0]

  const vencidos = (await db.execute({
    sql: `
      SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.validade IS NOT NULL AND ep.validade < ?
        AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}
    `,
    args: [dataHoje]
  })).rows[0]

  return {
    totalSKUs: Number(totalSKUs.v),
    itensREC: Number(itensREC.v),
    itensExpedicao: Number(itensExpedicao.v),
    inventariosAbertos: Number(inventariosAbertos.v),
    vencendoBreve: Number(vencendoBreve.v),
    vencidos: Number(vencidos.v),
  }
}
