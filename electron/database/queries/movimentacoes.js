/** Queries de Movimentações — operações atômicas com transação SQLite */

const inventariosQueries = require('./inventarios')

/**
 * TRANSFERÊNCIA INTERNA: decrementa origem, incrementa (ou cria) destino
 * Executa tudo em uma única transação para garantir integridade
 */
function transferir(db, { produto_id, lote, validade, qtd_caixas, qtd_kg, origem, destino, operador_id, operador_nome }) {
  if (destino === 'REC' || destino === 'EXPEDICAO') {
    return { success: false, error: 'Proibido transferir diretamente para REC ou EXPEDICAO usando a Movimentação. Use as telas adequadas.' }
  }

  // Verificar bloqueio de inventário nos endereços
  const bloqOrigem = inventariosQueries.verificarEnderecoBloqueado(db, origem)
  if (bloqOrigem) return { success: false, error: `Endereço ${origem} está bloqueado por inventário em andamento. Encerre o inventário para movimentar.`, bloqueado: true }
  const bloqDestino = inventariosQueries.verificarEnderecoBloqueado(db, destino)
  if (bloqDestino) return { success: false, error: `Endereço ${destino} está bloqueado por inventário em andamento. Encerre o inventário para movimentar.`, bloqueado: true }

  const execute = db.transaction(() => {
    // 1. Verificar saldo na origem
    const saldoOrigem = db.prepare(`
      SELECT qtd_caixas, qtd_kg FROM estoque_posicao
      WHERE produto_id = ? AND endereco = ? AND lote = ?
    `).get(produto_id, origem, lote || '')

    if (!saldoOrigem) throw new Error(`Saldo não encontrado: produto no endereço ${origem}`)
    if (saldoOrigem.qtd_caixas < qtd_caixas) throw new Error(`Saldo insuficiente: disponível ${saldoOrigem.qtd_caixas} cx, solicitado ${qtd_caixas} cx`)
    if (saldoOrigem.qtd_kg < qtd_kg) throw new Error(`Saldo insuficiente: disponível ${saldoOrigem.qtd_kg} kg, solicitado ${qtd_kg} kg`)

    // 2. Decrementar origem
    db.prepare(`
      UPDATE estoque_posicao
      SET qtd_caixas = qtd_caixas - ?, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP
      WHERE produto_id = ? AND endereco = ? AND lote = ?
    `).run(qtd_caixas, qtd_kg, produto_id, origem, lote || '')

    // 3. Incrementar (ou criar) destino via UPSERT
    db.prepare(`
      INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET
        qtd_caixas = qtd_caixas + excluded.qtd_caixas,
        qtd_kg     = qtd_kg + excluded.qtd_kg,
        updated_at = CURRENT_TIMESTAMP
    `).run(produto_id, destino, lote || '', validade || '', qtd_caixas, qtd_kg)

    // 4. Registrar log de auditoria
    db.prepare(`
      INSERT INTO movimentacoes_log
        (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRANSFERENCIA')
    `).run(produto_id, origem, destino, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema')

    return { success: true }
  })

  try {
    return execute()
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * RECEBIMENTO: cria saldo no endereço 'REC'
 */
function receber(db, { produto_id, lote, validade, qtd_caixas, qtd_kg, operador_id, operador_nome }) {
  const execute = db.transaction(() => {
    db.prepare(`
      INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg)
      VALUES (?, 'REC', ?, ?, ?, ?)
      ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET
        qtd_caixas = qtd_caixas + excluded.qtd_caixas,
        qtd_kg     = qtd_kg + excluded.qtd_kg,
        updated_at = CURRENT_TIMESTAMP
    `).run(produto_id, lote || '', validade || '', qtd_caixas, qtd_kg)

    db.prepare(`
      INSERT INTO movimentacoes_log
        (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
      VALUES (?, 'DOCA', 'REC', ?, ?, ?, ?, ?, 'RECEBIMENTO')
    `).run(produto_id, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema')

    return { success: true }
  })

  try {
    return execute()
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * DESPACHO (Checkout): baixa definitiva do endereço EXPEDICAO
 * Pode confirmar item por item ou todos de uma vez
 */
function confirmarDespacho(db, produto_id, lote, operador_id) {
  const execute = db.transaction(() => {
    // Buscar o que está em EXPEDICAO para este produto/lote
    const saldo = db.prepare(`
      SELECT qtd_caixas, qtd_kg FROM estoque_posicao
      WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ?
    `).get(produto_id, lote || '')

    if (!saldo || (saldo.qtd_caixas === 0 && saldo.qtd_kg === 0)) {
      throw new Error('Nenhum saldo encontrado na área de Expedição para este item.')
    }

    // Registrar log de despacho antes de deletar
    db.prepare(`
      INSERT INTO movimentacoes_log
        (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, tipo)
      VALUES (?, 'EXPEDICAO', 'SAIDA_DEFINITIVA', ?, ?, ?, ?, 'DESPACHO')
    `).run(produto_id, lote || '', saldo.qtd_caixas, saldo.qtd_kg, operador_id || null)

    // Zerar o registro (ou deletar)
    db.prepare(`
      DELETE FROM estoque_posicao
      WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ?
    `).run(produto_id, lote || '')

    return { success: true, qtd_caixas: saldo.qtd_caixas, qtd_kg: saldo.qtd_kg }
  })

  try {
    return execute()
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Listar log de movimentações com filtros opcionais
 */
function listarLog(db, { limit = 100, tipo, produto_id, data_inicio, data_fim, incluirInsumos } = {}) {
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

  return db.prepare(query).all(...params)
}

function listarExpedicao(db) {
  return db.prepare(`
    SELECT
      ep.produto_id, ep.endereco, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.codigo, p.descricao
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = 'EXPEDICAO' AND ep.qtd_caixas > 0
  `).all()
}

function estornarExpedicao(db, { produto_id, lote, destino, operador_id, operador_nome }) {
  if (!destino || destino === 'EXPEDICAO') {
    return { success: false, error: 'Endereço de destino inválido para estorno.' }
  }

  // Verificar bloqueio de inventário no destino
  const bloqDestino = inventariosQueries.verificarEnderecoBloqueado(db, destino)
  if (bloqDestino) return { success: false, error: `Endereço de devolução (${destino}) está bloqueado por inventário em andamento.`, bloqueado: true }

  const execute = db.transaction(() => {
    const saldo = db.prepare(`
      SELECT qtd_caixas, qtd_kg, validade FROM estoque_posicao
      WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ?
    `).get(produto_id, lote || '')

    if (!saldo || saldo.qtd_caixas <= 0) {
      throw new Error('Item não encontrado na Expedição.')
    }

    // 1. Voltar para o destino (estorno)
    db.prepare(`
      INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET
        qtd_caixas = qtd_caixas + excluded.qtd_caixas,
        qtd_kg     = qtd_kg + excluded.qtd_kg,
        updated_at = CURRENT_TIMESTAMP
    `).run(produto_id, destino, lote || '', saldo.validade || '', saldo.qtd_caixas, saldo.qtd_kg)

    // 2. Zerar/Remover da expedição
    db.prepare(`
      DELETE FROM estoque_posicao
      WHERE produto_id = ? AND endereco = 'EXPEDICAO' AND lote = ?
    `).run(produto_id, lote || '')

    // 3. Log
    db.prepare(`
      INSERT INTO movimentacoes_log
        (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
      VALUES (?, 'EXPEDICAO', ?, ?, ?, ?, ?, ?, 'TRANSFERENCIA')
    `).run(produto_id, destino, lote || '', saldo.qtd_caixas, saldo.qtd_kg, operador_id || null, operador_nome || 'Sistema')

    return { success: true }
  })

  try {
    return execute()
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * SAÍDA: Transfere de um endereço interno para EXPEDICAO (rota exclusiva da tela de Saída)
 * A função transferir() bloqueia destino EXPEDICAO intencionalmente para proteger a Movimentação.
 * Esta função é a única rota permitida para enviar material à área de Expedição.
 */
function enviarParaExpedicao(db, { produto_id, lote, validade, qtd_caixas, qtd_kg, origem, operador_id, operador_nome }) {
  if (!origem || origem === 'REC' || origem === 'EXPEDICAO') {
    return { success: false, error: 'Endereço de origem inválido para saída.' }
  }

  // Verificar bloqueio de inventário na origem
  const bloqOrigem = inventariosQueries.verificarEnderecoBloqueado(db, origem)
  if (bloqOrigem) return { success: false, error: `Endereço ${origem} está bloqueado por inventário em andamento.`, bloqueado: true }

  const execute = db.transaction(() => {
    // 1. Verificar saldo na origem
    const saldoOrigem = db.prepare(`
      SELECT qtd_caixas, qtd_kg FROM estoque_posicao
      WHERE produto_id = ? AND endereco = ? AND lote = ?
    `).get(produto_id, origem, lote || '')

    if (!saldoOrigem) throw new Error(`Saldo não encontrado no endereço ${origem}`)
    if (saldoOrigem.qtd_caixas < qtd_caixas) throw new Error(`Saldo insuficiente: disponível ${saldoOrigem.qtd_caixas} cx`)
    if (saldoOrigem.qtd_kg < qtd_kg) throw new Error(`Saldo insuficiente: disponível ${saldoOrigem.qtd_kg} kg`)

    // 2. Decrementar origem
    db.prepare(`
      UPDATE estoque_posicao
      SET qtd_caixas = qtd_caixas - ?, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP
      WHERE produto_id = ? AND endereco = ? AND lote = ?
    `).run(qtd_caixas, qtd_kg, produto_id, origem, lote || '')

    // 3. Incrementar EXPEDICAO
    db.prepare(`
      INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg)
      VALUES (?, 'EXPEDICAO', ?, ?, ?, ?)
      ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET
        qtd_caixas = qtd_caixas + excluded.qtd_caixas,
        qtd_kg     = qtd_kg + excluded.qtd_kg,
        updated_at = CURRENT_TIMESTAMP
    `).run(produto_id, lote || '', validade || '', qtd_caixas, qtd_kg)

    // 4. Log de auditoria
    db.prepare(`
      INSERT INTO movimentacoes_log
        (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
      VALUES (?, ?, 'EXPEDICAO', ?, ?, ?, ?, ?, 'TRANSFERENCIA')
    `).run(produto_id, origem, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema')

    return { success: true }
  })

  try {
    return execute()
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function relatorioExecutivo(db, filtros = {}) {
  const isEstritoInsumo = filtros.incluirInsumos === true;
  const filterSQL = isEstritoInsumo ? " AND p.tipo_produto = 'Insumos'" : " AND p.tipo_produto != 'Insumos'";

  // 1. Entradas x Saídas (Últimos 30 dias)
  const fluxoDiario = db.prepare(`
    SELECT 
      strftime('%Y-%m-%d', data_hora) as data,
      SUM(CASE WHEN m.tipo = 'RECEBIMENTO' THEN m.qtd_kg ELSE 0 END) as entradas_kg,
      SUM(CASE WHEN m.tipo = 'DESPACHO' THEN m.qtd_kg ELSE 0 END) as saidas_kg
    FROM movimentacoes_log m
    LEFT JOIN produtos p ON p.id = m.produto_id
    WHERE m.data_hora >= date('now', '-30 days') ${filterSQL}
    GROUP BY data
    ORDER BY data ASC
  `).all()

  // 2. Top Produtos (Entrada) - 30 dias
  const topEntradas = db.prepare(`
    SELECT 
      p.codigo, p.descricao, SUM(m.qtd_kg) as total_kg
    FROM movimentacoes_log m
    JOIN produtos p ON p.id = m.produto_id
    WHERE m.tipo = 'RECEBIMENTO' AND m.data_hora >= date('now', '-30 days') ${filterSQL}
    GROUP BY p.id
    ORDER BY total_kg DESC
    LIMIT 5
  `).all()

  // 3. Top Produtos (Saída) - 30 dias
  const topSaidas = db.prepare(`
    SELECT 
      p.codigo, p.descricao, SUM(m.qtd_kg) as total_kg
    FROM movimentacoes_log m
    JOIN produtos p ON p.id = m.produto_id
    WHERE m.tipo = 'DESPACHO' AND m.data_hora >= date('now', '-30 days') ${filterSQL}
    GROUP BY p.id
    ORDER BY total_kg DESC
    LIMIT 5
  `).all()

  // 4. Produtos Estagnados (Sem movimentação há mais de 30 dias com saldo > 0)
  const estagnados = db.prepare(`
    SELECT 
      p.codigo, p.descricao, ep.endereco, ep.lote, ep.qtd_kg,
      julianday('now') - julianday(ep.updated_at) as dias_parado
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.qtd_caixas > 0 AND ep.updated_at < date('now', '-30 days') ${filterSQL}
    ORDER BY dias_parado DESC
    LIMIT 10
  `).all()

  return {
    fluxoDiario,
    topEntradas,
    topSaidas,
    estagnados
  }
}

function deletarLog(db, id) {
  try {
    const res = db.prepare('DELETE FROM movimentacoes_log WHERE id = ?').run(id)
    if (res.changes === 0) {
      return { success: false, error: 'Registro não encontrado' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = {
  transferir,
  receber,
  confirmarDespacho,
  listarLog,
  listarExpedicao,
  estornarExpedicao,
  enviarParaExpedicao,
  relatorioExecutivo,
  deletarLog
}
