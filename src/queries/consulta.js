import { db } from '../lib/db.js';

/**
 * Busca as métricas de resumo de um produto
 * @param {string} produto_id 
 * @returns { saldoCaixas, saldoKg, entradasCaixas, saidasCaixas }
 */
export async function buscarResumoProduto(produto_id) {
  // Saldo Atual
  const saldoRes = await db.execute({
    sql: `SELECT SUM(qtd_caixas) as saldoCaixas, SUM(qtd_kg) as saldoKg FROM estoque_posicao WHERE produto_id = ? AND endereco != 'EXPEDICAO' AND endereco != 'PERDIDO'`,
    args: [produto_id]
  });
  const saldoCaixas = saldoRes.rows[0]?.saldoCaixas || 0;
  const saldoKg = saldoRes.rows[0]?.saldoKg || 0;

  // Entradas (RECEBIMENTO)
  const entradasRes = await db.execute({
    sql: `SELECT SUM(qtd_caixas) as entradasCaixas FROM movimentacoes_log WHERE produto_id = ? AND tipo = 'RECEBIMENTO'`,
    args: [produto_id]
  });
  const entradasCaixas = entradasRes.rows[0]?.entradasCaixas || 0;

  // Saídas (EXPEDICAO e SAIDAS)
  const saidasRes = await db.execute({
    sql: `SELECT SUM(qtd_caixas) as saidasCaixas FROM movimentacoes_log WHERE produto_id = ? AND tipo IN ('EXPEDICAO', 'SAIDA_PRODUCAO', 'AJUSTE_SAIDA')`,
    args: [produto_id]
  });
  const saidasCaixas = saidasRes.rows[0]?.saidasCaixas || 0;

  return { saldoCaixas, saldoKg, entradasCaixas, saidasCaixas };
}

/**
 * Busca os endereços onde o produto está estocado
 * @param {string} produto_id 
 */
export async function buscarEnderecosPorProduto(produto_id) {
  const res = await db.execute({
    sql: `
      SELECT endereco, SUM(qtd_caixas) as qtd_caixas, SUM(qtd_kg) as qtd_kg
      FROM estoque_posicao
      WHERE produto_id = ? AND (qtd_caixas > 0 OR qtd_kg > 0)
      GROUP BY endereco
      ORDER BY endereco ASC
    `,
    args: [produto_id]
  });
  return res.rows;
}

/**
 * Busca as caixas exatas em um endereço para drill-down
 * @param {string} produto_id 
 * @param {string} endereco 
 */
export async function buscarCaixasPorEnderecoEProduto(produto_id, endereco) {
  const res = await db.execute({
    sql: `
      SELECT *
      FROM estoque_caixas
      WHERE produto_id = ? AND endereco = ? AND status = 'DISPONIVEL'
      ORDER BY validade ASC
    `,
    args: [produto_id, endereco]
  });
  return res.rows;
}

/**
 * Busca o histórico geral das últimas N movimentações de um produto
 * @param {string} produto_id 
 * @param {number} limite 
 */
export async function buscarHistoricoPorProduto(produto_id, limite = 500) {
  const res = await db.execute({
    sql: `
      SELECT *
      FROM movimentacoes_log
      WHERE produto_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [produto_id, limite]
  });
  return res.rows;
}
