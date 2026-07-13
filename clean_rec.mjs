import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function fix() {
  // Confirm there are truly no physical boxes in REC
  const physical = await db.execute("SELECT COUNT(*) as total FROM estoque_caixas WHERE endereco = 'REC' AND status = 'DISPONIVEL'");
  console.log('Caixas físicas em REC:', physical.rows[0].total);
  
  if (physical.rows[0].total > 0) {
    console.log('ATENÇÃO: Existem caixas físicas em REC! Não limpar sem investigar.');
    return;
  }
  
  // Count what we'll delete
  const before = await db.execute("SELECT COUNT(*) as registros, SUM(qtd_caixas) as cx FROM estoque_posicao WHERE endereco = 'REC'");
  console.log('Registros a remover:', before.rows[0].registros, 'caixas:', before.rows[0].cx);
  
  // Delete ghost REC entries
  await db.execute("DELETE FROM estoque_posicao WHERE endereco = 'REC'");
  
  const after = await db.execute("SELECT COUNT(*) as registros FROM estoque_posicao WHERE endereco = 'REC'");
  console.log('Após limpeza, registros em REC:', after.rows[0].registros);
  console.log('Limpeza concluída com sucesso!');
}
fix();
