import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function analyze() {
  const res = await db.execute(`
    SELECT c.ean_caixa, p.descricao, p.codigo, c.peso_kg, c.validade 
    FROM estoque_caixas c
    JOIN produtos p ON p.id = c.produto_id
    LIMIT 50
  `);
  
  console.log('Analisando 50 caixas do banco de dados para achar padrões:');
  
  for (let r of res.rows) {
    console.log(`EAN: ${r.ean_caixa.padEnd(20)} | Produto: ${r.codigo.padEnd(6)} | Peso: ${r.peso_kg.toString().padEnd(6)} | Validade: ${r.validade}`);
  }
}
analyze();
