import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function applyMissedAdjustment() {
  // Get all items from inventory 21 that had sistema > 0 but counted = 0 (missed adjustments)
  // These items were marked OK but never had estoque_posicao updated
  const { rows: items } = await db.execute(`
    SELECT ii.produto_id, ii.endereco, ii.validade, ii.qtd_sistema_caixas, ii.qtd_contada_caixas, p.descricao
    FROM inventario_itens ii
    JOIN produtos p ON p.id = ii.produto_id
    WHERE ii.inventario_id = 21 
      AND ii.qtd_sistema_caixas > 0 
      AND (ii.qtd_contada_caixas = 0 OR ii.qtd_contada_caixas IS NULL)
      AND ii.status_item = 'OK'
      AND ii.ean_caixa IS NULL
  `);
  
  console.log(`Found ${items.length} items to adjust manually`);
  
  let updated = 0;
  let deleted = 0;
  
  for (const item of items) {
    // Zero out estoque_posicao for this product/location/validade
    const updateRes = await db.execute({
      sql: `UPDATE estoque_posicao SET qtd_caixas = 0, qtd_kg = 0, updated_at = CURRENT_TIMESTAMP 
            WHERE produto_id = ? AND endereco = ? AND validade IS ?`,
      args: [item.produto_id, item.endereco, item.validade || null]
    });
    
    if (updateRes.rowsAffected > 0) {
      updated++;
      console.log(`  Updated: ${item.endereco} | ${item.descricao} | was ${item.qtd_sistema_caixas}cx → 0cx`);
    }
    
    // Delete zero rows
    const deleteRes = await db.execute({
      sql: `DELETE FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND qtd_caixas <= 0`,
      args: [item.produto_id, item.endereco]
    });
    
    if (deleteRes.rowsAffected > 0) {
      deleted += deleteRes.rowsAffected;
    }
  }
  
  console.log(`\nDone! Updated: ${updated}, Deleted (zero rows): ${deleted}`);
  
  // Verify remaining stock in CON
  const { rows: remaining } = await db.execute(`
    SELECT endereco, SUM(qtd_caixas) as total 
    FROM estoque_posicao 
    WHERE endereco LIKE 'CON%' 
    GROUP BY endereco 
    HAVING total > 0
  `);
  console.log('\nRemaining stock in CON addresses:');
  for (const r of remaining) {
    console.log(`  ${r.endereco}: ${r.total}cx`);
  }
}

applyMissedAdjustment().catch(console.error);
