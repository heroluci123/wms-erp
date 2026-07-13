import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  // How many boxes are in REC?
  const total = await db.execute("SELECT COUNT(*) as total, SUM(peso_kg) as kg FROM estoque_caixas WHERE endereco = 'REC' AND status = 'DISPONIVEL'");
  console.log('Total caixas em REC:');
  console.table(total.rows);

  // Are they linked to any pallet?
  const comPalete = await db.execute("SELECT COUNT(*) as com_palete FROM estoque_caixas WHERE endereco = 'REC' AND status = 'DISPONIVEL' AND palete_id IS NOT NULL");
  const semPalete = await db.execute("SELECT COUNT(*) as sem_palete FROM estoque_caixas WHERE endereco = 'REC' AND status = 'DISPONIVEL' AND palete_id IS NULL");
  console.log('Com palete (vinculadas a um pallet):'); console.table(comPalete.rows);
  console.log('Sem palete (soltas/legado):'); console.table(semPalete.rows);

  // Sample without pallet
  const sample = await db.execute(`
    SELECT c.ean_caixa, p.descricao, c.peso_kg, c.validade, c.created_at, c.palete_id
    FROM estoque_caixas c 
    JOIN produtos p ON p.id = c.produto_id
    WHERE c.endereco = 'REC' AND c.status = 'DISPONIVEL' AND c.palete_id IS NULL
    LIMIT 10
  `);
  console.log('Sample sem palete:');
  console.table(sample.rows);

  // Sample WITH pallet - check which pallets
  const comPal = await db.execute(`
    SELECT plt.codigo, plt.status, plt.endereco_atual, COUNT(c.id) as cx
    FROM estoque_caixas c 
    JOIN paletes plt ON plt.id = c.palete_id
    WHERE c.endereco = 'REC' AND c.status = 'DISPONIVEL'
    GROUP BY plt.id
    LIMIT 10
  `);
  console.log('Paletes com caixas em REC:');
  console.table(comPal.rows);
}
test();
