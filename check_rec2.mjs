import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  // Check estoque_posicao table for REC entries
  const posRec = await db.execute(`
    SELECT ep.endereco, p.descricao, p.codigo, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = 'REC' AND ep.qtd_caixas > 0
    ORDER BY ep.qtd_caixas DESC
    LIMIT 20
  `);
  console.log('estoque_posicao em REC:');
  console.table(posRec.rows);
  
  const totalRec = await db.execute("SELECT SUM(qtd_caixas) as cx, SUM(qtd_kg) as kg FROM estoque_posicao WHERE endereco = 'REC'");
  console.log('Total posicao REC:');
  console.table(totalRec.rows);
}
test();
