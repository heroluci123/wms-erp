import { db } from '../lib/db.js';

/** Queries de Estoque e Posições */

// Listagem geral com JOIN em produtos, excluindo registros zerados
export async function listarGeral() {
  const res = await db.execute(`
    SELECT
      ep.id, ep.endereco, ep.lote, ep.validade,
      ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
      p.status_curva, p.valor_unitario, p.unidade, p.grupo,
      (
        SELECT GROUP_CONCAT(DISTINCT pl.codigo)
        FROM estoque_caixas ec
        JOIN paletes pl ON pl.id = ec.palete_id
        WHERE ec.produto_id = ep.produto_id
          AND ec.endereco = ep.endereco
          AND ec.status = 'DISPONIVEL'
      ) as palete_codigos,
      (
        SELECT CASE
          WHEN COUNT(*) = 1 THEN MIN(ec2.ean_caixa)
          ELSE COUNT(*) || ' caixas'
        END
        FROM estoque_caixas ec2
        WHERE ec2.produto_id = ep.produto_id
          AND ec2.endereco = ep.endereco
          AND ec2.status = 'DISPONIVEL'
      ) as ean_caixas
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.qtd_caixas > 0 OR ep.qtd_kg > 0
    ORDER BY ep.endereco, p.descricao, ep.validade
  `)
  return res.rows
}

// Listagem caixa a caixa (serializada) com EAN individual — usa estoque_caixas direto
export async function listarGeralCaixas({ incluirRec = false } = {}) {
  const res = await db.execute({
    sql: `
      SELECT
        c.id, c.ean_caixa, c.endereco, c.validade, c.peso_kg, c.status, c.palete_id,
        p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
        p.status_curva, p.valor_unitario, p.unidade, p.grupo,
        pl.codigo as palete_codigo
      FROM estoque_caixas c
      JOIN produtos p ON p.id = c.produto_id
      LEFT JOIN paletes pl ON pl.id = c.palete_id
      WHERE c.status = 'DISPONIVEL'
        AND c.endereco IS NOT NULL
        AND c.endereco != ''
        AND c.endereco != 'EXPEDICAO'
        AND (? = 1 OR c.endereco != 'REC')
      ORDER BY c.endereco, p.descricao, c.validade
    `,
    args: [incluirRec ? 1 : 0]
  })
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
  const filterSQL = (filtros.incluirInsumos === true) ? " AND p.tipo_produto = 'Insumos'" : " AND p.tipo_produto != 'Insumos'";

  const hoje = new Date()
  const em30dias = new Date(hoje)
  em30dias.setDate(hoje.getDate() + 30)
  const dataLimite = em30dias.toISOString().split('T')[0]
  const dataHoje = hoje.toISOString().split('T')[0]

  const batchQueries = [
    `SELECT COUNT(DISTINCT ep.produto_id) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`,
    `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'REC' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`,
    `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'EXPEDICAO' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`,
    `SELECT COUNT(*) as v FROM inventarios WHERE status NOT IN ('Finalizado OK', 'Cancelado')`,
    { sql: `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.validade IS NOT NULL AND ep.validade >= ? AND ep.validade <= ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`, args: [dataHoje, dataLimite] },
    { sql: `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.validade IS NOT NULL AND ep.validade < ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`, args: [dataHoje] }
  ]

  const res = await db.batch(batchQueries, 'read')

  return {
    totalSKUs: Number(res[0].rows[0].v),
    itensREC: Number(res[1].rows[0].v),
    itensExpedicao: Number(res[2].rows[0].v),
    inventariosAbertos: Number(res[3].rows[0].v),
    vencendoBreve: Number(res[4].rows[0].v),
    vencidos: Number(res[5].rows[0].v),
  }
}
