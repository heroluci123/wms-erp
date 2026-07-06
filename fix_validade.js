import { createClient } from '@libsql/client';

const REMOTE_URL = 'https://wms-erp-heroluci123.aws-us-east-1.turso.io';
const REMOTE_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg';

const db = createClient({
  url: REMOTE_URL,
  authToken: REMOTE_TOKEN
});

async function main() {
  try {
    // Buscar o item
    const res = await db.execute(`
      SELECT e.*, p.descricao 
      FROM estoque_posicao e 
      JOIN produtos p ON e.produto_id = p.id 
      WHERE e.endereco = 'LOJA' AND p.descricao LIKE '%PESCOCO DE FRANGO%' AND e.qtd_kg = 6.205
    `);
    
    console.log("Encontrado(s):", res.rows);
    
    if (res.rows.length > 0) {
      await db.execute(`
        UPDATE estoque_posicao 
        SET validade = '2027-06-30T00:00:00.000Z' 
        WHERE id = ${res.rows[0].id}
      `);
      console.log("Validade atualizada para 2027-06-30!");
    } else {
      console.log("Nenhum item correspondente encontrado.");
    }
  } catch (err) {
    console.error("Erro:", err);
  }
}

main();
