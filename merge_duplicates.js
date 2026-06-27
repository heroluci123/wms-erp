import fs from 'fs';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL,
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function run() {
  const res = await db.execute('SELECT id, ean, codigo FROM produtos WHERE length(ean) >= 15 OR length(codigo) >= 15');
  for (let row of res.rows) {
    let u6 = null;
    if (row.ean && row.ean.length >= 15) u6 = row.ean.slice(-6);
    else if (row.codigo && row.codigo.length >= 15) u6 = row.codigo.slice(-6);
    
    if (u6) {
      const norm = u6.replace(/^0+/, '') || u6;
      try {
        await db.execute({sql: 'UPDATE produtos SET codigo = ?, ean = NULL WHERE id = ?', args: [norm, row.id]});
        console.log('Fixed', row.id, norm);
      } catch (e) {
        if(e.message.includes('UNIQUE constraint')) {
          console.log(`Duplicate found for ${norm}. Merging...`);
          // Find the original product ID
          const existingRes = await db.execute({
             sql: 'SELECT id FROM produtos WHERE codigo = ? OR ean = ?',
             args: [norm, norm]
          });
          if (existingRes.rows.length > 0) {
             const correctId = existingRes.rows[0].id;
             // Update references
             await db.execute({sql: 'UPDATE estoque_posicao SET produto_id = ? WHERE produto_id = ?', args: [correctId, row.id]});
             await db.execute({sql: 'UPDATE movimentacoes_log SET produto_id = ? WHERE produto_id = ?', args: [correctId, row.id]});
             await db.execute({sql: 'UPDATE inventario_itens SET produto_id = ? WHERE produto_id = ?', args: [correctId, row.id]});
             // Now delete the duplicate
             await db.execute({sql: 'DELETE FROM produtos WHERE id = ?', args: [row.id]});
             console.log(`Merged duplicate ${row.id} into ${correctId} and deleted ${row.id}.`);
          }
        } else {
          console.log('Error', row.id, e.message);
        }
      }
    }
  }
  console.log('Done');
}
run();
