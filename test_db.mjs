import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  // Check inventory #21 items - what status do they have and what are sistema vs contado
  const res = await db.execute("SELECT ii.endereco, p.descricao, ii.qtd_sistema_caixas, ii.qtd_contada_caixas, ii.qtd_sistema_kg, ii.qtd_contada_kg, ii.status_item, ii.ean_caixa FROM inventario_itens ii JOIN produtos p ON p.id = ii.produto_id WHERE ii.inventario_id = 21 LIMIT 30");
  console.log('Inventory 21 items:');
  for (const r of res.rows) {
    console.log(`  ${r.endereco} | ${r.descricao} | sis=${r.qtd_sistema_caixas}cx | cont=${r.qtd_contada_caixas}cx | status=${r.status_item} | ean=${r.ean_caixa}`);
  }
  
  // Count by status
  const stats = await db.execute("SELECT status_item, COUNT(*) as cnt FROM inventario_itens WHERE inventario_id = 21 GROUP BY status_item");
  console.log('\nStatus distribution:');
  for (const r of stats.rows) {
    console.log(`  ${r.status_item}: ${r.cnt}`);
  }
  
  // Check items where sistema > 0 but contado = 0 that are OK
  const wrong = await db.execute("SELECT COUNT(*) as cnt FROM inventario_itens WHERE inventario_id = 21 AND qtd_sistema_caixas > 0 AND (qtd_contada_caixas = 0 OR qtd_contada_caixas IS NULL) AND status_item = 'OK'");
  console.log('\nItems with sistema>0 but contado=0 marked OK:', wrong.rows[0].cnt);
}
test();
