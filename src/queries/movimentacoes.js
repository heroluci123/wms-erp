import { db } from '../lib/db.js';

/** Queries de Movimentações — operações atômicas com transação SQLite */

import * as inventariosQueries from './inventarios.js';

/**
 * TRANSFERÊNCIA INTERNA: decrementa origem, incrementa (ou cria) destino
 * Executa tudo em uma única transação para garantir integridade
 */
export async function transferir({ produto_id, lote, validade, qtd_caixas, qtd_kg, origem, destino, operador_id, operador_nome }) {
  if (destino === 'REC' || destino === 'EXPEDICAO') {
    return { success: false, error: 'Proibido transferir diretamente para REC ou EXPEDICAO usando a Movimentação. Use as telas adequadas.' }
  }

  try {
    // Verificar bloqueio de inventário nos endereços
    const bloqOrigem = await inventariosQueries.verificarEnderecoBloqueado(db, origem)
    if (bloqOrigem) return { success: false, error: `Endereço ${origem} está bloqueado por inventário em andamento.`, bloqueado: true }
    const bloqDestino = await inventariosQueries.verificarEnderecoBloqueado(db, destino)
    if (bloqDestino) return { success: false, error: `Endereço ${destino} está bloqueado por inventário em andamento.`, bloqueado: true }

    // 1. Verificar saldo na origem
    const resOrigem = await db.execute({
      sql: `SELECT qtd_caixas, qtd_kg FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
      args: [produto_id, origem, lote || '', validade || '']
    })
    const saldoOrigem = resOrigem.rows[0]
    if (!saldoOrigem) return { success: false, error: `Saldo não encontrado: produto no endereço ${origem}` }
    if (saldoOrigem.qtd_caixas < qtd_caixas) return { success: false, error: `Saldo insuficiente: disponível ${saldoOrigem.qtd_caixas} cx, solicitado ${qtd_caixas} cx` }
    if (saldoOrigem.qtd_kg < qtd_kg) return { success: false, error: `Saldo insuficiente: disponível ${saldoOrigem.qtd_kg} kg, solicitado ${qtd_kg} kg` }

    // 2-4. Executar operações em lote atômico
    await db.batch([
      {
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - ?, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND lote = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
        args: [qtd_caixas, qtd_kg, produto_id, origem, lote || '', validade || '']
      },
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + excluded.qtd_caixas, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, destino, lote || '', validade || '', qtd_caixas, qtd_kg]
      },
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [produto_id, origem, destino, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write')

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * RECEBIMENTO: cria saldo no endereço 'REC'
 */
export async function receber({ produto_id, lote, validade, qtd_caixas, qtd_kg, operador_id, operador_nome }) {
  try {
    await db.batch([
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, 'REC', ?, ?, ?, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + excluded.qtd_caixas, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, lote || '', validade || '', qtd_caixas, qtd_kg]
      },
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, 'DOCA', 'REC', ?, ?, ?, ?, ?, 'RECEBIMENTO')`,
        args: [produto_id, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * DESPACHO (Checkout): baixa definitiva do endereço EXPEDICAO
 * Pode confirmar item por item ou todos de uma vez
 */
export async function confirmarDespacho(produto_id, lote, validade, operador_id) {
  try {
    const resSaldo = await db.execute({
      sql: `SELECT qtd_caixas, qtd_kg FROM estoque_posicao WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
      args: [produto_id, lote || '', validade || '']
    })
    const saldo = resSaldo.rows[0]
    if (!saldo || (saldo.qtd_caixas === 0 && saldo.qtd_kg === 0)) {
      return { success: false, error: 'Nenhum saldo encontrado na área de Expedição para este item.' }
    }

    await db.batch([
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, tipo) VALUES (?, 'EXPEDICAO', 'SAIDA_DEFINITIVA', ?, ?, ?, ?, 'DESPACHO')`,
        args: [produto_id, lote || '', saldo.qtd_caixas, saldo.qtd_kg, operador_id || null]
      },
      {
        sql: `DELETE FROM estoque_posicao WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
        args: [produto_id, lote || '', validade || '']
      }
    ], 'write')

    return { success: true, qtd_caixas: saldo.qtd_caixas, qtd_kg: saldo.qtd_kg }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Listar log de movimentações com filtros opcionais
 */
export async function listarLog({ limit = 100, tipo, produto_id, data_inicio, data_fim, incluirInsumos } = {}) {
  let query = `
    SELECT
      ml.id, ml.tipo, ml.endereco_origem, ml.endereco_destino,
      ml.lote, ml.qtd_caixas, ml.qtd_kg, ml.data_hora,
      ml.operador_nome,
      p.codigo, p.descricao, p.valor_unitario, p.tipo_produto
    FROM movimentacoes_log ml
    LEFT JOIN produtos p ON p.id = ml.produto_id
    WHERE 1=1
  `
  const params = []
  if (tipo) { query += ` AND ml.tipo = ?`; params.push(tipo) }
  if (String(incluirInsumos) === 'true') {
    query += ` AND p.tipo_produto = 'Insumos'`
  } else {
    query += ` AND p.tipo_produto != 'Insumos'`
  }
  if (produto_id) { query += ` AND ml.produto_id = ?`; params.push(produto_id) }
  if (data_inicio) { query += ` AND ml.data_hora >= ?`; params.push(data_inicio) }
  if (data_fim) { query += ` AND ml.data_hora <= ?`; params.push(data_fim) }
  query += ` ORDER BY ml.data_hora DESC LIMIT ?`
  params.push(limit)

  const res = await db.execute({ sql: query, args: params })
  return res.rows
}

export async function listarExpedicao() {
  const res = await db.execute({
    sql: `
      SELECT
        ep.produto_id, ep.endereco, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
        p.codigo, p.descricao
      FROM estoque_posicao ep
      JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.endereco = 'EXPEDICAO' AND ep.qtd_caixas > 0
    `,
    args: []
  })
  return res.rows
}

export async function estornarExpedicao({ produto_id, lote, destino, operador_id, operador_nome }) {
  if (!destino || destino === 'EXPEDICAO') {
    return { success: false, error: 'Endereço de destino inválido para estorno.' }
  }

  // Verificar bloqueio de inventário no destino
  const bloqDestino = await inventariosQueries.verificarEnderecoBloqueado(db, destino)
  if (bloqDestino) return { success: false, error: `Endereço de devolução (${destino}) está bloqueado por inventário em andamento.`, bloqueado: true }

  try {
    const resSaldo = await db.execute({
      sql: `SELECT qtd_caixas, qtd_kg, validade FROM estoque_posicao WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ?`,
      args: [produto_id, lote || '']
    })
    const saldo = resSaldo.rows[0]
    if (!saldo || saldo.qtd_caixas <= 0) return { success: false, error: 'Item não encontrado na Expedição.' }

    await db.batch([
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + excluded.qtd_caixas, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, destino, lote || '', saldo.validade || '', saldo.qtd_caixas, saldo.qtd_kg]
      },
      {
        sql: `DELETE FROM estoque_posicao WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ?`,
        args: [produto_id, lote || '']
      },
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, 'EXPEDICAO', ?, ?, ?, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [produto_id, destino, lote || '', saldo.qtd_caixas, saldo.qtd_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write')

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * SAÍDA: Transfere de um endereço interno para EXPEDICAO (rota exclusiva da tela de Saída)
 * A função transferir() bloqueia destino EXPEDICAO intencionalmente para proteger a Movimentação.
 * Esta função é a única rota permitida para enviar material à área de Expedição.
 */
export async function enviarParaExpedicao({ produto_id, lote, validade, qtd_caixas, qtd_kg, origem, operador_id, operador_nome }) {
  if (!origem || origem === 'REC' || origem === 'EXPEDICAO') {
    return { success: false, error: 'Endereço de origem inválido para saída.' }
  }

  // Verificar bloqueio de inventário na origem
  const bloqOrigem = await inventariosQueries.verificarEnderecoBloqueado(db, origem)
  if (bloqOrigem) return { success: false, error: `Endereço ${origem} está bloqueado por inventário em andamento.`, bloqueado: true }

  try {
    const resOrigem = await db.execute({
      sql: `SELECT qtd_caixas, qtd_kg FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
      args: [produto_id, origem, lote || '', validade || '']
    })
    const saldoOrigem = resOrigem.rows[0]
    if (!saldoOrigem) return { success: false, error: `Saldo não encontrado no endereço ${origem}` }
    if (saldoOrigem.qtd_caixas < qtd_caixas) return { success: false, error: `Saldo insuficiente: disponível ${saldoOrigem.qtd_caixas} cx` }
    if (saldoOrigem.qtd_kg < qtd_kg) return { success: false, error: `Saldo insuficiente: disponível ${saldoOrigem.qtd_kg} kg` }

    await db.batch([
      {
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - ?, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND lote = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
        args: [qtd_caixas, qtd_kg, produto_id, origem, lote || '', validade || '']
      },
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, 'EXPEDICAO', ?, ?, ?, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + excluded.qtd_caixas, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, lote || '', validade || '', qtd_caixas, qtd_kg]
      },
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, 'EXPEDICAO', ?, ?, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [produto_id, origem, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write')

    return { success: true }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

export async function relatorioExecutivo(filtros = {}) {
  const isEstritoInsumo = filtros.incluirInsumos === true
  const filterSQL = isEstritoInsumo ? " AND p.tipo_produto = 'Insumos'" : " AND p.tipo_produto != 'Insumos'";

  let { data_inicio, data_fim } = filtros
  
  const dInicio = data_inicio ? new Date(data_inicio) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const dFim = data_fim ? new Date(data_fim) : new Date()
  
  const dataInicio = dInicio.toISOString().split('T')[0]
  const dataFim = dFim.toISOString().split('T')[0]

  const batchQueries = [
    // 1. Fluxo Diário
    {
      sql: `
        SELECT date(m.data_hora) as data,
               SUM(CASE WHEN m.tipo = 'RECEBIMENTO' THEN m.qtd_kg ELSE 0 END) as entradas_kg,
               SUM(CASE WHEN m.tipo = 'DESPACHO' THEN m.qtd_kg ELSE 0 END) as saidas_kg
        FROM movimentacoes_log m
        JOIN produtos p ON p.id = m.produto_id
        WHERE date(m.data_hora) >= ? AND date(m.data_hora) <= ? ${filterSQL}
        GROUP BY date(m.data_hora)
        ORDER BY date(m.data_hora) ASC
      `,
      args: [dataInicio, dataFim]
    },
    // 2. Totais (Entradas vs Saídas)
    {
      sql: `
        SELECT 
          SUM(CASE WHEN m.tipo = 'RECEBIMENTO' THEN m.qtd_kg ELSE 0 END) as total_entradas,
          SUM(CASE WHEN m.tipo = 'DESPACHO' THEN m.qtd_kg ELSE 0 END) as total_saidas
        FROM movimentacoes_log m
        JOIN produtos p ON p.id = m.produto_id
        WHERE date(m.data_hora) >= ? AND date(m.data_hora) <= ? ${filterSQL}
      `,
      args: [dataInicio, dataFim]
    },
    // 3. Top 5 Produtos com Maior Entrada
    {
      sql: `
        SELECT p.codigo, p.descricao, SUM(m.qtd_kg) as total_kg
        FROM movimentacoes_log m
        JOIN produtos p ON p.id = m.produto_id
        WHERE m.tipo = 'RECEBIMENTO' AND date(m.data_hora) >= ? AND date(m.data_hora) <= ? ${filterSQL}
        GROUP BY p.id ORDER BY total_kg DESC LIMIT 5
      `,
      args: [dataInicio, dataFim]
    },
    // 4. Top 5 Produtos com Maior Saída
    {
      sql: `
        SELECT p.codigo, p.descricao, SUM(m.qtd_kg) as total_kg
        FROM movimentacoes_log m
        JOIN produtos p ON p.id = m.produto_id
        WHERE m.tipo = 'DESPACHO' AND date(m.data_hora) >= ? AND date(m.data_hora) <= ? ${filterSQL}
        GROUP BY p.id ORDER BY total_kg DESC LIMIT 5
      `,
      args: [dataInicio, dataFim]
    },
    // 5. Produtos Estagnados
    {
      sql: `
        SELECT p.codigo, p.descricao, ep.endereco, ep.lote, ep.qtd_kg,
               julianday('now') - julianday(ep.updated_at) as dias_parado
        FROM estoque_posicao ep
        JOIN produtos p ON p.id = ep.produto_id
        WHERE ep.qtd_caixas > 0 AND ep.updated_at < date('now', '-30 days') ${filterSQL}
        ORDER BY dias_parado DESC LIMIT 10
      `,
      args: []
    },
    // 6. Alertas de validade
    {
      sql: `
        SELECT p.codigo, p.descricao, ep.endereco, ep.validade, ep.qtd_caixas, ep.qtd_kg,
               CAST(julianday(ep.validade) - julianday('now') AS INTEGER) as dias_para_vencer
        FROM estoque_posicao ep
        JOIN produtos p ON p.id = ep.produto_id
        WHERE ep.qtd_caixas > 0 AND ep.validade IS NOT NULL AND ep.validade != ''
          AND julianday(ep.validade) <= julianday('now', '+30 days') ${filterSQL}
        ORDER BY ep.validade ASC LIMIT 10
      `,
      args: []
    }
  ]

  const res = await db.batch(batchQueries, 'read')

  const totais = res[1].rows[0] || { total_entradas: 0, total_saidas: 0 }

  return {
    fluxoDiario: res[0].rows,
    totais,
    topEntradas: res[2].rows,
    topSaidas:   res[3].rows,
    estagnados:  res[4].rows,
    alertasValidade: res[5].rows,
    dataInicio,
    dataFim
  }
}

export async function deletarLog(id) {
  try {
    const res = await db.execute({
      sql: 'DELETE FROM movimentacoes_log WHERE id = ?',
      args: [id]
    })
    if (res.rowsAffected === 0) {
      return { success: false, error: 'Registro não encontrado' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
