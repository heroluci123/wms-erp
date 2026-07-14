import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function check() {
  const p = await db.execute("SELECT * FROM paletes WHERE codigo = 'PLT-0019'");
  console.log("Pallet PLT-0019:", p.rows);

  const boxes = await db.execute("SELECT id, ean_caixa, status, endereco FROM estoque_caixas WHERE palete_id = ?", [p.rows[0].id]);
  console.log("Boxes in PLT-0019:", boxes.rows);
}
check();
