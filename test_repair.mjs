import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function repair(pid) {
  try {
    console.log(`Limpando estoque_posicao para produto ${pid}...`);
    await db.execute(`DELETE FROM estoque_posicao WHERE produto_id = '${pid}'`);

    const caixas = await db.execute(`
      SELECT endereco, count(*) as cx, sum(peso_kg) as kg 
      FROM estoque_caixas 
      WHERE produto_id = '${pid}' AND status = 'DISPONIVEL' 
      GROUP BY endereco
    `);

    for (const row of caixas.rows) {
      console.log(`Inserindo ${row.cx} caixas em ${row.endereco}`);
      await db.execute({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', NULL, ?, ?)`,
        args: [pid, row.endereco, row.cx, row.kg]
      });
    }

    console.log('Reparo concluído!');
  } catch (err) {
    console.error('Erro:', err.message);
  }
}
repair(74);
