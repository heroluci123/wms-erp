import { db } from './src/lib/db.js';

async function check() {
  const res = await db.execute('SELECT * FROM paletes WHERE codigo = "PLT-0031"');
  console.log(res.rows);
}
check();
