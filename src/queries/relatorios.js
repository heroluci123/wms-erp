import { db } from '../lib/db.js';

export async function getBalanco(dataInicio, dataFim) {
  const res = await db.execute({
    sql: `
      SELECT p.id as produto_id, p.descricao, p.classificacao, p.produto_pai_id,
        SUM(CASE WHEN ch.operacao IN ('RECEBIMENTO', 'RETORNO_PRODUCAO', 'RECEBIMENTO_DESMEMBRAMENTO') THEN c.peso_kg ELSE 0 END) as total_entrada,
        SUM(CASE WHEN ch.operacao IN ('EXPEDICAO', 'INVENTARIO_PERDA', 'ALOCADA_PRODUCAO', 'DESMEMBRADA') THEN c.peso_kg ELSE 0 END) as total_saida
      FROM caixas_historico ch
      JOIN estoque_caixas c ON c.id = ch.caixa_id
      JOIN produtos p ON p.id = c.produto_id
      WHERE date(ch.data_hora) BETWEEN ? AND ?
      GROUP BY p.id, p.descricao, p.classificacao
      ORDER BY p.descricao ASC
    `,
    args: [dataInicio, dataFim]
  })
  return res.rows
}

export async function getArvoreProducao() {
  const produtosRes = await db.execute(`
    SELECT id, descricao, classificacao
    FROM produtos 
    ORDER BY descricao ASC
  `)
  const arvoreRes = await db.execute(`SELECT pai_id, filho_id FROM produto_arvore`)
  
  return {
    produtos: produtosRes.rows,
    arvore: arvoreRes.rows
  }
}

export async function getOrdensProducao(dataInicio, dataFim) {
  const res = await db.execute({
    sql: `
      SELECT 
        op.id,
        op.status,
        op.lote,
        op.peso_enviado,
        op.peso_retornado,
        op.perda,
        op.data_inicio,
        op.data_fim,
        op.operador_id,
        p.descricao  AS materia_prima,
        p.codigo     AS mp_codigo,
        o.nome       AS operador_nome,
        -- Subprodutos gerados nesta OP (estoque_caixas com endereco = 'OP-'||op.id ou lote = op.lote)
        (SELECT COUNT(*) FROM estoque_caixas ec 
          WHERE ec.lote = op.lote 
            AND ec.produto_id != op.materia_prima_id
        ) AS qtd_caixas_geradas,
        (SELECT COALESCE(SUM(ec2.peso_kg),0) FROM estoque_caixas ec2 
          WHERE ec2.lote = op.lote 
            AND ec2.produto_id != op.materia_prima_id
        ) AS kg_gerados
      FROM ordens_producao op
      JOIN produtos p ON p.id = op.materia_prima_id
      LEFT JOIN operadores o ON o.id = op.operador_id
      WHERE date(op.data_inicio) BETWEEN ? AND ?
      ORDER BY op.data_inicio DESC
    `,
    args: [dataInicio, dataFim]
  })
  return res.rows
}

export async function getOPSubprodutos(lote) {
  const res = await db.execute({
    sql: `
      SELECT 
        ec.ean_caixa,
        ec.lote,
        ec.validade,
        ec.peso_kg,
        ec.status,
        ec.endereco,
        p.descricao,
        p.codigo
      FROM estoque_caixas ec
      JOIN produtos p ON p.id = ec.produto_id
      WHERE ec.lote = ?
      ORDER BY p.descricao, ec.validade
    `,
    args: [lote]
  })
  return res.rows
}
