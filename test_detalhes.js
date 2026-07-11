import { db } from './src/lib/db.js';
import { detalhesOP } from './src/queries/producao.js';

async function main() {
  try {
    const d = await detalhesOP(2); // OP-0002
    console.log(JSON.stringify(d, null, 2));
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
main();
