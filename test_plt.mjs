import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  const rs = await db.execute("SELECT id, codigo, status, endereco_atual FROM paletes WHERE codigo IN ('PLT-0030', 'PLT-0031')");
  console.log('Paletes:');
  console.table(rs.rows);

  const rs2 = await db.execute("SELECT c.id, c.palete_id, c.status, c.endereco, c.peso_kg FROM estoque_caixas c JOIN paletes p ON c.palete_id = p.id WHERE p.codigo IN ('PLT-0030', 'PLT-0031')");
  console.log('Caixas:');
  console.table(rs2.rows);
}
test();
