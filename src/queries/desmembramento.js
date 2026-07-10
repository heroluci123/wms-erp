import { db } from '../lib/db.js';

export async function validarCaixa(ean) {
  const res = await db.execute({
    sql: `SELECT c.*, p.descricao as produto_descricao, p.codigo as produto_codigo 
          FROM estoque_caixas c 
          JOIN produtos p ON c.produto_id = p.id 
          WHERE c.ean_caixa = ?`,
    args: [ean]
  });
  
  if (res.rows.length === 0) return { success: false, error: 'Caixa não encontrada.' };
  
  const caixa = res.rows[0];
  if (caixa.status !== 'DISPONIVEL') {
    return { success: false, error: `A caixa não está disponível (Status: ${caixa.status}).` };
  }
  
  return { success: true, caixa };
}

export async function desmembrarCaixa(caixa_original, novas_caixas, operador_id, operador_nome) {
  try {
    const queries = [];
    
    // 1. Inativar caixa original (Muda status para CONSUMIDA)
    queries.push({
      sql: `UPDATE estoque_caixas SET status = 'CONSUMIDA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [caixa_original.id]
    });
    
    // 2. Histórico da caixa original
    queries.push({
      sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'DESMEMBRADA', 'Caixa dividida em ' || ? || ' novas caixas.', ?)`,
      args: [caixa_original.id, caixa_original.ean_caixa, novas_caixas.length, operador_nome || 'Sistema']
    });
    
    // 3. Atualizar estoque agregado (remover original)
    queries.push({
      sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
      args: [caixa_original.peso_kg, caixa_original.produto_id, caixa_original.endereco || 'REC', caixa_original.validade || '']
    });

    // 4. Log global (Ajuste saída)
    queries.push({
      sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, 'DESMEMBRAMENTO', 1, ?, ?, ?, 'AJUSTE')`,
      args: [caixa_original.produto_id, caixa_original.endereco || 'REC', caixa_original.peso_kg, operador_id || null, operador_nome || 'Sistema']
    });

    let totalNovoPeso = 0;

    // 5. Inserir novas caixas
    for (const nova of novas_caixas) {
      totalNovoPeso += nova.peso_kg;
      
      queries.push({
        sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, endereco, validade, peso_kg, status) VALUES (?, ?, ?, ?, ?, 'DISPONIVEL')`,
        args: [nova.ean_caixa, caixa_original.produto_id, caixa_original.endereco || 'REC', caixa_original.validade || null, nova.peso_kg]
      });
      
      queries.push({
        sql: `INSERT INTO caixas_historico (ean_caixa, operacao, detalhes, operador_nome) VALUES (?, 'RECEBIMENTO_DESMEMBRAMENTO', 'Caixa gerada a partir do EAN ' || ?, ?)`,
        args: [nova.ean_caixa, caixa_original.ean_caixa, operador_nome || 'Sistema']
      });

      // Atualizar estoque agregado (inserir nova)
      queries.push({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', ?, 1, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [caixa_original.produto_id, caixa_original.endereco || 'REC', caixa_original.validade || null, nova.peso_kg]
      });
    }

    // 6. Log global (Ajuste entrada)
    queries.push({
      sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, 'DESMEMBRAMENTO', ?, ?, ?, ?, ?, 'AJUSTE')`,
      args: [caixa_original.produto_id, caixa_original.endereco || 'REC', novas_caixas.length, totalNovoPeso, operador_id || null, operador_nome || 'Sistema']
    });
    
    await db.batch(queries, 'write');
    return { success: true };
    
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: estoque_caixas.ean_caixa')) {
      return { success: false, error: 'Um dos novos códigos EAN já existe no sistema.' };
    }
    return { success: false, error: err.message };
  }
}
