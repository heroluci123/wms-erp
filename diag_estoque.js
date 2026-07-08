import { createClient } from '@libsql/client';

const db = createClient({
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function diagnostico() {
  console.log('=== ESTOQUE_POSICAO em REC ===');
  const rec = await db.execute(`
    SELECT ep.produto_id, ep.validade, ep.qtd_caixas, ep.qtd_kg, p.descricao 
    FROM estoque_posicao ep 
    JOIN produtos p ON p.id = ep.produto_id 
    WHERE ep.endereco = 'REC' AND ep.qtd_caixas > 0
    ORDER BY ep.produto_id
  `);
  console.log(`Total linhas em REC: ${rec.rows.length}`);
  for (const r of rec.rows) {
    console.log(`  produto_id=${r.produto_id} | ${r.descricao} | validade=${r.validade} | caixas=${r.qtd_caixas} | kg=${r.qtd_kg}`);
  }

  console.log('\n=== ESTOQUE_CAIXAS REC (disponiveis) ===');
  const cxRec = await db.execute(`
    SELECT COUNT(*) as total FROM estoque_caixas WHERE endereco = 'REC' AND status = 'DISPONIVEL'
  `);
  console.log(`Caixas ainda com endereco=REC: ${cxRec.rows[0].total}`);

  console.log('\n=== ESTOQUE_POSICAO em 1R-01-1 ===');
  const pos = await db.execute(`
    SELECT ep.produto_id, ep.validade, ep.qtd_caixas, ep.qtd_kg, p.descricao 
    FROM estoque_posicao ep 
    JOIN produtos p ON p.id = ep.produto_id 
    WHERE ep.endereco = '1R-01-1' AND ep.qtd_caixas > 0
    ORDER BY ep.produto_id
  `);
  console.log(`Total linhas em 1R-01-1: ${pos.rows.length}`);
  for (const r of pos.rows) {
    console.log(`  produto_id=${r.produto_id} | ${r.descricao} | validade=${r.validade} | caixas=${r.qtd_caixas} | kg=${r.qtd_kg}`);
  }

  console.log('\n=== CAIXAS em 1R-01-1 por produto (estoque_caixas) ===');
  const cxDest = await db.execute(`
    SELECT c.produto_id, COUNT(*) as total_caixas, SUM(c.peso_kg) as total_kg, c.validade, p.descricao
    FROM estoque_caixas c 
    JOIN produtos p ON p.id = c.produto_id 
    WHERE c.endereco = '1R-01-1' AND c.status = 'DISPONIVEL'
    GROUP BY c.produto_id, c.validade
    ORDER BY p.descricao
  `);
  console.log(`Produtos distintos em 1R-01-1: ${cxDest.rows.length}`);
  for (const r of cxDest.rows) {
    console.log(`  ${r.descricao} | validade=${r.validade} | caixas=${r.total_caixas} | kg=${r.total_kg?.toFixed(3)}`);
  }

  console.log('\n=== DIFERENÇA (REC no posicao que deveriam ter saido) ===');
  // Produtos que estão em REC na posicao mas não têm caixas em REC (foram movimentados mas posicao nao atualizou)
  const diff = await db.execute(`
    SELECT ep.produto_id, ep.validade, ep.qtd_caixas, ep.qtd_kg, p.descricao,
           (SELECT COUNT(*) FROM estoque_caixas c2 WHERE c2.produto_id = ep.produto_id AND c2.endereco = 'REC' AND c2.status = 'DISPONIVEL') as caixas_reais_rec
    FROM estoque_posicao ep 
    JOIN produtos p ON p.id = ep.produto_id 
    WHERE ep.endereco = 'REC' AND ep.qtd_caixas > 0
  `);
  console.log('\nLinhas REC com caixas reais vs posicao:');
  for (const r of diff.rows) {
    const diferente = r.caixas_reais_rec != r.qtd_caixas;
    console.log(`  ${diferente ? '❌ DIVERGE' : '✅ OK'} ${r.descricao} | posicao=${r.qtd_caixas}cx | caixas_reais_em_REC=${r.caixas_reais_rec}`);
  }
}

diagnostico().catch(console.error);
