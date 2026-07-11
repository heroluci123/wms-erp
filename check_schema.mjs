import { db } from './src/lib/db.js';

async function check() {
  const res = await db.execute('PRAGMA table_info(paletes)');
  console.log(res.rows);
  const res2 = await db.execute('PRAGMA table_info(estoque_caixas)');
  console.log(res2.rows);
}
check();
