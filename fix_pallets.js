import { createClient } from '@libsql/client';

async function fixPallets() {
  try {
    const client = createClient({
      url: 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
      authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
    });
    
    const res = await client.execute(`
      UPDATE paletes 
      SET status = 'FECHADO' 
      WHERE status = 'FINALIZADO' 
        AND endereco_atual = 'DOCA' 
        AND (
          SELECT count(*) FROM estoque_caixas 
          WHERE palete_id = paletes.id AND status = 'DISPONIVEL'
        ) = 0
    `);
    console.log('Fixed pallets. Rows affected:', res.rowsAffected);
  } catch (err) {
    console.error(err);
  }
}

fixPallets();
