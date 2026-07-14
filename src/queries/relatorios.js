import { db } from '../lib/db.js';

export async function getBalancoMensal(mesAno) {
  const res = await db.execute({
    sql: `
      SELECT p.id as produto_id, p.descricao, p.classificacao, p.produto_pai_id,
        SUM(CASE WHEN ch.operacao IN ('RECEBIMENTO', 'RETORNO_PRODUCAO', 'RECEBIMENTO_DESMEMBRAMENTO') THEN c.peso_kg ELSE 0 END) as total_entrada,
        SUM(CASE WHEN ch.operacao IN ('EXPEDICAO', 'INVENTARIO_PERDA', 'ALOCADA_PRODUCAO', 'DESMEMBRADA') THEN c.peso_kg ELSE 0 END) as total_saida
      FROM caixas_historico ch
      JOIN estoque_caixas c ON c.id = ch.caixa_id
      JOIN produtos p ON p.id = c.produto_id
      WHERE strftime('%Y-%m', ch.created_at) = ?
      GROUP BY p.id, p.descricao, p.classificacao, p.produto_pai_id
      ORDER BY p.descricao ASC
    `,
    args: [mesAno]
  })
  return res.rows
}

export async function getArvoreProducao() {
  const res = await db.execute(`
    SELECT id, descricao, classificacao, produto_pai_id 
    FROM produtos 
    ORDER BY descricao ASC
  `)
  return res.rows
}
