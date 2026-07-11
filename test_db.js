import { db } from './src/lib/db.js';

async function test() {
  try {
    const { rows } = await db.execute({ sql: "SELECT endereco, qtd_caixas, produto_id FROM estoque_posicao WHERE endereco LIKE 'CON%'", args: [] });
    console.log(rows);
  } catch (e) {
    console.error(e);
  }
}
test();
