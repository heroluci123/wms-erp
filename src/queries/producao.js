import { db } from '../lib/db.js';

export async function listarOPs(status = 'TODAS') {
  let query = `
    SELECT 
      op.*,
      (SELECT SUM(peso_kg) FROM op_insumos WHERE op_id = op.id) as peso_insumos,
      (SELECT SUM(peso_kg) FROM op_retornos WHERE op_id = op.id) as peso_retornos
    FROM ordens_producao op
  `
  const args = []
  
  if (status !== 'TODAS') {
    query += ` WHERE op.status = ?`
    args.push(status)
  }
  
  query += ` ORDER BY op.created_at DESC`
  
  const res = await db.execute({ sql: query, args })
  return res.rows
}

export async function criarOP(nome, operador_id, operador_nome) {
  const resMax = await db.execute("SELECT MAX(CAST(SUBSTR(codigo, 4) AS INTEGER)) as max_num FROM ordens_producao WHERE codigo LIKE 'OP-%'");
  const maxNum = resMax.rows[0].max_num || 0;
  const num = (maxNum + 1).toString().padStart(4, '0');
  const codigo = `OP-${num}`;
  
  const res = await db.execute({
    sql: `INSERT INTO ordens_producao (codigo, nome, operador_id, operador_nome) VALUES (?, ?, ?, ?) RETURNING id, codigo, nome`,
    args: [codigo, nome || 'OP Sem Nome', operador_id || null, operador_nome || 'Sistema']
  })
  
  return { success: true, op: res.rows[0] }
}

export async function detalhesOP(op_id) {
  const opRes = await db.execute({ sql: `SELECT * FROM ordens_producao WHERE id = ?`, args: [op_id] })
  if (opRes.rows.length === 0) return null
  const op = opRes.rows[0]

  const insumosRes = await db.execute({
    sql: `
      SELECT oi.*, c.ean_caixa, p.descricao as produto_descricao, p.codigo as produto_codigo
      FROM op_insumos oi
      JOIN estoque_caixas c ON c.id = oi.caixa_id
      JOIN produtos p ON p.id = oi.produto_id
      WHERE oi.op_id = ?
    `,
    args: [op_id]
  })

  const retornosRes = await db.execute({
    sql: `
      SELECT oret.*, c.ean_caixa, p.descricao as produto_descricao, p.codigo as produto_codigo
      FROM op_retornos oret
      JOIN estoque_caixas c ON c.id = oret.caixa_id
      JOIN produtos p ON p.id = oret.produto_id
      WHERE oret.op_id = ?
    `,
    args: [op_id]
  })

  return {
    ...op,
    insumos: insumosRes.rows,
    retornos: retornosRes.rows,
    peso_insumos: insumosRes.rows.reduce((sum, i) => sum + i.peso_kg, 0),
    peso_retornos: retornosRes.rows.reduce((sum, r) => sum + r.peso_kg, 0)
  }
}

export async function alocarInsumos(op_id, caixas, operador_id, operador_nome) {
  try {
    const queries = []
    
    // Pegar o código da OP para usar como endereço
    const opRes = await db.execute({ sql: `SELECT codigo FROM ordens_producao WHERE id = ?`, args: [op_id] })
    const opCodigo = opRes.rows[0]?.codigo || 'PRODUCAO'
    
    for (const c of caixas) {
      queries.push({
        sql: `UPDATE estoque_caixas SET status = 'RESERVADA', endereco = ? WHERE id = ?`,
        args: [opCodigo, c.id]
      })
      
      queries.push({
        sql: `INSERT INTO op_insumos (op_id, caixa_id, produto_id, peso_kg, operador_nome) VALUES (?, ?, ?, ?, ?)`,
        args: [op_id, c.id, c.produto_id, c.peso_kg, operador_nome || 'Sistema']
      })

      // Subtrair do estoque no endereço antigo
      queries.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ?`,
        args: [c.peso_kg, c.produto_id, c.endereco || 'REC']
      })
      
      // Adicionar no novo endereço (OP)
      queries.push({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', ?, 1, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [c.produto_id, opCodigo, c.validade || null, c.peso_kg]
      })
      
      // Se estava num palete que estava na doca (FINALIZADO), forçar para FECHADO (pois saiu da doca)
      if (c.palete_id) {
        queries.push({
          sql: `UPDATE paletes SET status = 'FECHADO' WHERE id = ? AND status = 'FINALIZADO'`,
          args: [c.palete_id]
        })
      }
      
      queries.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, ?, 1, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [c.produto_id, c.endereco || 'REC', opCodigo, c.peso_kg, operador_id || null, operador_nome || 'Sistema']
      })
      
      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'ALOCADA_PRODUCAO', 'Enviada para a OP ' || ?, ?)`,
        args: [c.id, c.ean_caixa, opCodigo, operador_nome || 'Sistema']
      })
    }

    // Clean up empty records
    queries.push(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`)

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function adicionarRetorno(op_id, { ean_caixa, produto_id, peso_kg, validade }, operador_id, operador_nome) {
  try {
    const opStats = await db.execute({
      sql: `
        SELECT 
          (SELECT COALESCE(SUM(peso_kg), 0) FROM op_insumos WHERE op_id = ?) as total_insumo,
          (SELECT COALESCE(SUM(peso_kg), 0) FROM op_retornos WHERE op_id = ?) as total_retorno
      `,
      args: [op_id, op_id]
    })
    
    const { total_insumo, total_retorno } = opStats.rows[0]
    
    if (total_retorno + peso_kg > total_insumo + 0.2) {
      return { 
        success: false, 
        error: `Fisicamente impossível: O peso total de retornos (${(total_retorno + peso_kg).toFixed(2)}kg) não pode ser maior que o total de insumos alocados na OP (${total_insumo.toFixed(2)}kg). Aloque mais insumos primeiro.` 
      }
    }

    const queries = [
      {
        sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, endereco, peso_kg, validade, status) VALUES (?, ?, 'PRODUCAO', ?, ?, 'DISPONIVEL') RETURNING id`,
        args: [ean_caixa, produto_id, peso_kg, validade || null]
      }
    ]

    const resCaixa = await db.execute(queries[0])
    const newCaixaId = resCaixa.rows[0].id

    const batch = [
      {
        sql: `INSERT INTO op_retornos (op_id, caixa_id, produto_id, peso_kg, operador_nome) VALUES (?, ?, ?, ?, ?)`,
        args: [op_id, newCaixaId, produto_id, peso_kg, operador_nome || 'Sistema']
      },
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, 'PRODUCAO', '', ?, 1, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, validade || null, peso_kg]
      },
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, 'PRODUCAO', 'PRODUCAO', 1, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [produto_id, peso_kg, operador_id || null, operador_nome || 'Sistema']
      },
      {
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'RETORNO_PRODUCAO', 'Nova caixa gerada a partir da OP ' || (SELECT codigo FROM ordens_producao WHERE id = ?), ?)`,
        args: [newCaixaId, ean_caixa, op_id, operador_nome || 'Sistema']
      }
    ]

    await db.batch(batch, 'write')
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: estoque_caixas.ean_caixa')) {
      return { success: false, error: 'Este código EAN já existe no sistema.' };
    }
    return { success: false, error: err.message }
  }
}



export async function removerItemOP(op_id, tipo, item_id, caixa_id) {
  try {
    const queries = []
    
    const caixaRes = await db.execute({ sql: `SELECT * FROM estoque_caixas WHERE id = ?`, args: [caixa_id] })
    if (caixaRes.rows.length === 0) return { success: false, error: 'Caixa não encontrada' }
    const caixa = caixaRes.rows[0]

    if (tipo === 'INSUMO') {
      queries.push({ sql: `DELETE FROM op_insumos WHERE id = ?`, args: [item_id] })
      // Muda pra disponivel mas mantém no endereço que estava (OP-XXX) para o operador poder movimentar
      queries.push({ sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL' WHERE id = ?`, args: [caixa_id] })
      
      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'ESTORNO_INSUMO', 'Removida da OP ' || (SELECT codigo FROM ordens_producao WHERE id = ?) || ' e devolvida ao estoque', 'Sistema')`,
        args: [caixa.id, caixa.ean_caixa, op_id]
      })
    } else if (tipo === 'RETORNO') {
      queries.push({ sql: `DELETE FROM op_retornos WHERE id = ?`, args: [item_id] })
      queries.push({ sql: `DELETE FROM estoque_caixas WHERE id = ?`, args: [caixa_id] })
      queries.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = 'PRODUCAO'`,
        args: [caixa.peso_kg, caixa.produto_id]
      })
      queries.push(`DELETE FROM estoque_posicao WHERE (qtd_caixas <= 0 OR qtd_kg <= 0) AND endereco = 'PRODUCAO'`)
      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'ESTORNO_RETORNO', 'Caixa excluída. Estorno de retorno da OP ' || (SELECT codigo FROM ordens_producao WHERE id = ?), 'Sistema')`,
        args: [caixa.id, caixa.ean_caixa, op_id]
      })
    }

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function verificarFEFO(produto_id, validadeAtual) {
  if (!validadeAtual) return null 
  
  const res = await db.execute({
    sql: `
      SELECT c.*, p.descricao as produto_descricao 
      FROM estoque_caixas c
      JOIN produtos p ON p.id = c.produto_id
      WHERE c.produto_id = ? 
        AND c.status = 'DISPONIVEL'
        AND c.validade IS NOT NULL
      ORDER BY c.validade ASC
      LIMIT 1
    `,
    args: [produto_id]
  })
  
  if (res.rows.length === 0) return null
  
  const caixaMaisVelha = res.rows[0]
  
  const vMaisVelha = new Date(caixaMaisVelha.validade)
  const vAtual = new Date(validadeAtual)
  
  if (vMaisVelha < vAtual) {
    return caixaMaisVelha 
  }
  
  return null
}

export async function finalizarOP(op_id) {
  try {
    const queries = [
      {
        sql: `UPDATE ordens_producao SET status = 'FECHADA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [op_id]
      },
      {
        sql: `UPDATE estoque_caixas SET status = 'CONSUMIDA' WHERE id IN (SELECT caixa_id FROM op_insumos WHERE op_id = ?)`,
        args: [op_id]
      }
    ]
    
    // Precisamos decrementar as caixas de insumo de estoque_posicao já que agora elas ficavam no endereço da OP
    const insumosRes = await db.execute({
      sql: `SELECT c.produto_id, c.endereco, c.validade, c.peso_kg FROM op_insumos oi JOIN estoque_caixas c ON c.id = oi.caixa_id WHERE oi.op_id = ?`,
      args: [op_id]
    })
    
    for (const c of insumosRes.rows) {
      queries.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ?`,
        args: [c.peso_kg, c.produto_id, c.endereco]
      })
    }
    
    queries.push(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`)

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function cancelarOP(op_id) {
  try {
    const opStats = await db.execute({
      sql: `
        SELECT 
          (SELECT count(*) FROM op_insumos WHERE op_id = ?) as qtd_insumos,
          (SELECT count(*) FROM op_retornos WHERE op_id = ?) as qtd_retornos
      `,
      args: [op_id, op_id]
    })
    
    const { qtd_insumos, qtd_retornos } = opStats.rows[0]
    
    if (qtd_insumos > 0 || qtd_retornos > 0) {
      return { success: false, error: 'Não é possível cancelar. A OP já possui itens alocados. Remova os itens ou finalize a OP.' }
    }

    await db.execute({ sql: `DELETE FROM ordens_producao WHERE id = ?`, args: [op_id] })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
