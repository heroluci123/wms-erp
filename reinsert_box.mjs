import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function reinsert() {
  const p = await db.execute("SELECT id, endereco_atual FROM paletes WHERE codigo = 'PLT-0032'");
  if (p.rows.length === 0) return console.log('Pallet not found');
  const pltId = p.rows[0].id;
  const end = p.rows[0].endereco_atual;

  const bx = await db.execute("SELECT produto_id FROM estoque_caixas WHERE ean_caixa = '0025601730006729' LIMIT 1");
  if (bx.rows.length === 0) return console.log('Reference box not found');
  const prodId = bx.rows[0].produto_id;

  const newEan = '0025601676006729';
  const peso = 15.11;
  const validade = '2026-08-15';

  const r = await db.execute({
    sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, peso_kg, validade, status, endereco, palete_id)
          VALUES (?, ?, ?, ?, 'DISPONIVEL', ?, ?)`,
    args: [newEan, prodId, peso, validade, end, pltId]
  });
  
  const caixaId = r.lastInsertRowid;
  
  await db.execute({
    sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
          VALUES (?, ?, 'RECEBIMENTO', ?, 'Administrador')`,
    args: [caixaId, newEan, `Recebida do Fornecedor (Re-inserida após correção de EAN vazio)`]
  });

  console.log('Caixa re-inserida com sucesso!', {
    ean: newEan,
    peso,
    validade,
    pltId
  });
}
reinsert();
