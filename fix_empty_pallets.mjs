import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function fix() {
  // Find and show empty pallets (status FECHADO, no boxes)
  const empty = await db.execute(`
    SELECT p.id, p.codigo, p.status, p.endereco_atual,
           COUNT(c.id) as cx_count
    FROM paletes p
    LEFT JOIN estoque_caixas c ON c.palete_id = p.id
    WHERE p.status = 'FECHADO'
    GROUP BY p.id
    HAVING cx_count = 0
  `);
  
  console.log('Paletes vazios encontrados:');
  console.table(empty.rows);
  
  if (empty.rows.length === 0) {
    console.log('Nenhum palete vazio encontrado.');
    return;
  }
  
  // Delete them
  const ids = empty.rows.map(r => r.id);
  console.log(`Excluindo ${ids.length} paletes vazios: IDs ${ids.join(', ')}`);
  
  for (const id of ids) {
    await db.execute({ sql: `DELETE FROM paletes WHERE id = ?`, args: [id] });
  }
  
  console.log('Paletes vazios excluídos com sucesso!');
}
fix();
