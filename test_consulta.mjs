import { createClient } from '@libsql/client';

const db = createClient({ 
  url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'
});

async function test() {
  try {
    const prodRes = await db.execute("SELECT id FROM produtos WHERE descricao = 'PEIXINHO (T7)'");
    if (prodRes.rows.length === 0) return console.log('Produto não encontrado');
    const pid = prodRes.rows[0].id;
    console.log('ID do produto:', pid);

    console.log('Testando buscarResumoProduto...');
    await db.execute("SELECT SUM(qtd_caixas) as saldoCaixas, SUM(qtd_kg) as saldoKg FROM estoque_posicao WHERE produto_id = '" + pid + "' AND endereco != 'EXPEDICAO' AND endereco != 'PERDIDO'");
    await db.execute("SELECT SUM(qtd_caixas) as entradasCaixas FROM movimentacoes_log WHERE produto_id = '" + pid + "' AND tipo = 'RECEBIMENTO'");
    await db.execute("SELECT SUM(qtd_caixas) as saidasCaixas FROM movimentacoes_log WHERE produto_id = '" + pid + "' AND tipo IN ('EXPEDICAO', 'SAIDA_PRODUCAO', 'AJUSTE_SAIDA')");
    
    console.log('Testando buscarEnderecosPorProduto...');
    await db.execute("SELECT endereco, SUM(qtd_caixas) as qtd_caixas, SUM(qtd_kg) as qtd_kg FROM estoque_posicao WHERE produto_id = '" + pid + "' AND (qtd_caixas > 0 OR qtd_kg > 0) GROUP BY endereco ORDER BY endereco ASC");

    console.log('Testando buscarHistoricoPorProduto...');
    await db.execute("SELECT m.*, p.descricao as produto_descricao, p.codigo as produto_codigo FROM movimentacoes_log m JOIN produtos p ON m.produto_id = p.id WHERE m.produto_id = '" + pid + "' ORDER BY m.created_at DESC LIMIT 500");

    console.log('Tudo OK');
  } catch (err) {
    console.error('Erro:', err.message);
  }
}
test();
