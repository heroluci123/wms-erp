import { db } from '../lib/db.js';

export async function listarRomaneios(status = 'TODOS', filtroPeriodo = 'todos') {
  let query = `
    SELECT 
      r.*,
      (SELECT count(*) FROM romaneios_itens WHERE romaneio_id = r.id) as qtd_caixas,
      (SELECT sum(peso_kg) FROM romaneios_itens WHERE romaneio_id = r.id) as peso_total
    FROM romaneios r
    WHERE 1=1
  `
  const args = []
  
  if (status !== 'TODOS') {
    query += ` AND r.status = ?`
    args.push(status)
  }

  if (filtroPeriodo === 'hoje') {
    query += ` AND date(COALESCE(r.expedido_at, r.created_at), 'localtime') = date('now', 'localtime')`
  } else if (filtroPeriodo === '7d') {
    query += ` AND date(COALESCE(r.expedido_at, r.created_at), 'localtime') >= date('now', '-7 days', 'localtime')`
  } else if (filtroPeriodo === '30d') {
    query += ` AND date(COALESCE(r.expedido_at, r.created_at), 'localtime') >= date('now', '-30 days', 'localtime')`
  }
  
  query += ` ORDER BY r.created_at DESC`
  
  const res = await db.execute({ sql: query, args })
  return res.rows
}

export async function criarRomaneio({ cliente, previsao_entrega, operador_id, operador_nome }) {
  const resCount = await db.execute("SELECT count(*) as total FROM romaneios");
  const num = (resCount.rows[0].total + 1).toString().padStart(4, '0');
  const codigo = `ROM-${num}`;
  
  const res = await db.execute({
    sql: `INSERT INTO romaneios (codigo, cliente, previsao_entrega, operador_id, operador_nome, status) VALUES (?, ?, ?, ?, ?, 'MONTANDO') RETURNING *`,
    args: [codigo, cliente, previsao_entrega, operador_id || null, operador_nome || 'Sistema']
  })
  
  return { success: true, romaneio: res.rows[0] }
}

export async function detalhesRomaneio(romaneio_id) {
  const rRes = await db.execute({ sql: `SELECT * FROM romaneios WHERE id = ?`, args: [romaneio_id] })
  if (rRes.rows.length === 0) return null
  const romaneio = rRes.rows[0]

  const itensRes = await db.execute({
    sql: `
      SELECT ri.*, c.ean_caixa, p.descricao as produto_descricao, p.codigo as produto_codigo
      FROM romaneios_itens ri
      JOIN estoque_caixas c ON c.id = ri.caixa_id
      JOIN produtos p ON p.id = ri.produto_id
      WHERE ri.romaneio_id = ?
      ORDER BY ri.created_at DESC
    `,
    args: [romaneio_id]
  })

  return {
    ...romaneio,
    itens: itensRes.rows,
    qtd_caixas: itensRes.rows.length,
    peso_total: itensRes.rows.reduce((sum, i) => sum + i.peso_kg, 0)
  }
}

export async function adicionarCaixa(romaneio_id, caixa, operador_id, operador_nome) {
  try {
    const queries = []
    
    // Marcar caixa como RESERVADA
    queries.push({
      sql: `UPDATE estoque_caixas SET status = 'RESERVADA' WHERE id = ?`,
      args: [caixa.id]
    })
    
    queries.push({
      sql: `INSERT INTO romaneios_itens (romaneio_id, caixa_id, produto_id, peso_kg) VALUES (?, ?, ?, ?)`,
      args: [romaneio_id, caixa.id, caixa.produto_id, caixa.peso_kg]
    })

    // Histórico
    queries.push({
      sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'ROMANEIO', 'Adicionada ao Romaneio', ?)`,
      args: [caixa.id, caixa.ean_caixa, operador_nome || 'Sistema']
    })

    // Subtrair do estoque disponivel
    queries.push({
      sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ?`,
      args: [caixa.peso_kg, caixa.produto_id, caixa.endereco || 'REC']
    })

    // Clean up empty records
    queries.push(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`)

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Esta caixa jÃ¡ foi adicionada.' }
    }
    return { success: false, error: err.message }
  }
}

export async function removerCaixa(romaneio_id, caixa_id, produto_id, peso_kg, endereco_origem, operador_id, operador_nome) {
  try {
    const queries = [
      {
        sql: `DELETE FROM romaneios_itens WHERE romaneio_id = ? AND caixa_id = ?`,
        args: [romaneio_id, caixa_id]
      },
      {
        sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL' WHERE id = ?`,
        args: [caixa_id]
      },
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', NULL, 1, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, endereco_origem || 'REC', peso_kg]
      },
      // Histórico
      {
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, (SELECT ean_caixa FROM estoque_caixas WHERE id = ?), 'ROMANEIO_REMOVIDA', 'Removida do Romaneio e devolvida para ' || ?, ?)`,
        args: [caixa_id, caixa_id, endereco_origem || 'REC', operador_nome || 'Sistema']
      }
    ]

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function finalizarMontagem(romaneio_id) {
  try {
    await db.execute({
      sql: `UPDATE romaneios SET status = 'AGUARDANDO_EXPEDICAO' WHERE id = ?`,
      args: [romaneio_id]
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function reabrirRomaneio(romaneio_id) {
  try {
    await db.execute({
      sql: `UPDATE romaneios SET status = 'MONTANDO' WHERE id = ?`,
      args: [romaneio_id]
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function expedirRomaneio(romaneio_id, operador_id, operador_nome) {
  try {
    // Busca todas as caixas deste romaneio para gerar log de saÃ­da
    const itensRes = await db.execute({
      sql: `
        SELECT ri.caixa_id, ri.produto_id, ri.peso_kg, c.endereco, c.ean_caixa
        FROM romaneios_itens ri
        JOIN estoque_caixas c ON c.id = ri.caixa_id
        WHERE ri.romaneio_id = ?
      `,
      args: [romaneio_id]
    })

    const queries = []

    queries.push({
      sql: `UPDATE romaneios SET status = 'EXPEDIDO', expedido_at = CURRENT_TIMESTAMP, operador_expedicao_nome = ? WHERE id = ?`,
      args: [operador_nome || 'Sistema', romaneio_id]
    })

    for (const item of itensRes.rows) {
      queries.push({
        sql: `UPDATE estoque_caixas SET status = 'EXPEDIDA' WHERE id = ?`,
        args: [item.caixa_id]
      })

      // Adiciona no log de movimentações como DESPACHO
      queries.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, 'CLIENTE', 1, ?, ?, ?, 'DESPACHO')`,
        args: [item.produto_id, item.endereco || 'REC', item.peso_kg, operador_id || null, operador_nome || 'Sistema']
      })
      
      // Histórico
      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'EXPEDICAO', 'Expedida ao Cliente pelo Romaneio', ?)`,
        args: [item.caixa_id, item.ean_caixa, operador_nome || 'Sistema']
      })
    }

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function excluirRomaneio(romaneio_id) {
  try {
    const romRes = await db.execute({ sql: `SELECT status FROM romaneios WHERE id = ?`, args: [romaneio_id] })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado' }
    if (romRes.rows[0].status === 'EXPEDIDO') return { success: false, error: 'Não é possível excluir um romaneio já expedido' }

    const itensRes = await db.execute({
      sql: `SELECT ri.caixa_id, ri.produto_id, ri.peso_kg, c.endereco FROM romaneios_itens ri JOIN estoque_caixas c ON c.id = ri.caixa_id WHERE ri.romaneio_id = ?`,
      args: [romaneio_id]
    })

    const queries = []
    
    for (const item of itensRes.rows) {
      queries.push({
        sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL' WHERE id = ?`,
        args: [item.caixa_id]
      })
      queries.push({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', NULL, 1, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [item.produto_id, item.endereco || 'REC', item.peso_kg]
      })
    }

    queries.push({ sql: `DELETE FROM romaneios_itens WHERE romaneio_id = ?`, args: [romaneio_id] })
    queries.push({ sql: `DELETE FROM romaneios WHERE id = ?`, args: [romaneio_id] })

    await db.batch(queries, 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

