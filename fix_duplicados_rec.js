import { createClient } from '@libsql/client';

const db = createClient({
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function fixar() {
  console.log('=== FIXANDO: Zerando REC duplicados onde nenhuma caixa fisica existe em REC ===\n');

  // Busca todos os grupos em REC do estoque_posicao
  const linhasRec = await db.execute(`
    SELECT ep.id, ep.produto_id, ep.validade, ep.qtd_caixas, ep.qtd_kg, p.descricao
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = 'REC' AND ep.qtd_caixas > 0
  `);

  let deletados = 0;

  for (const linha of linhasRec.rows) {
    // Verifica quantas caixas físicas realmente existem em REC para este produto+validade
    const caixasReais = await db.execute({
      sql: `SELECT COUNT(*) as total FROM estoque_caixas WHERE produto_id = ? AND endereco = 'REC' AND status = 'DISPONIVEL' AND IFNULL(validade, '') = IFNULL(?, '')`,
      args: [linha.produto_id, linha.validade || '']
    });
    const totalReal = caixasReais.rows[0].total;

    if (totalReal == 0 && linha.qtd_caixas > 0) {
      // Duplicado confirmado - deletar da posicao em REC
      await db.execute({
        sql: `DELETE FROM estoque_posicao WHERE id = ?`,
        args: [linha.id]
      });
      console.log(`✅ Removido REC duplicado: ${linha.descricao} | validade=${linha.validade} | ${linha.qtd_caixas}cx / ${linha.qtd_kg}kg`);
      deletados++;
    } else if (totalReal < linha.qtd_caixas) {
      // Parcialmente correto - ajustar quantidade (caso de erro parcial)
      console.log(`⚠️  Parcial: ${linha.descricao} | posicao=${linha.qtd_caixas}cx | real=${totalReal}cx (deixa como está)`);
    } else {
      console.log(`✅ OK (${totalReal}cx reais em REC): ${linha.descricao}`);
    }
  }

  console.log(`\n=== Removidos ${deletados} registros duplicados de REC ===`);
  console.log('\nVerificando resultado final...');
  
  const recFinal = await db.execute(`SELECT COUNT(*) as total FROM estoque_posicao WHERE endereco = 'REC' AND qtd_caixas > 0`);
  console.log(`Linhas em REC restantes: ${recFinal.rows[0].total}`);
  
  const destFinal = await db.execute(`SELECT COUNT(*) as total FROM estoque_posicao WHERE endereco = '1R-01-1' AND qtd_caixas > 0`);
  console.log(`Linhas em 1R-01-1: ${destFinal.rows[0].total}`);
}

fixar().catch(console.error);
