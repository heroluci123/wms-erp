const { db } = require('./src/lib/db.js');

async function check() {
  const res = await db.execute('PRAGMA table_info(locais)');
  console.log(res.rows);
}

check().catch(console.error);
