import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  const prodRes = await db.execute("SELECT id FROM produtos WHERE descricao = 'PEIXINHO (T7)'");
  const pid = prodRes.rows[0].id;

  const res1 = await db.execute("SELECT * FROM estoque_posicao WHERE produto_id = '" + pid + "'");
  console.log('estoque_posicao:');
  console.table(res1.rows);

  const res2 = await db.execute("SELECT endereco, count(*) as cx, sum(peso_kg) as kg FROM estoque_caixas WHERE produto_id = '" + pid + "' AND status = 'DISPONIVEL' GROUP BY endereco");
  console.log('estoque_caixas agrupado:');
  console.table(res2.rows);
}
test();
