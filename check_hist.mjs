import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  // Check caixas_historico schema
  const s = await db.execute("PRAGMA table_info(caixas_historico)");
  console.log('caixas_historico schema:');
  console.table(s.rows);

  // Check a few rows
  const r = await db.execute("SELECT * FROM caixas_historico WHERE operacao = 'RECEBIMENTO' LIMIT 5");
  console.log('Sample rows:');
  console.table(r.rows);
}
test();
