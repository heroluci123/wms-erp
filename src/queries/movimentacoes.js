import { db } from '../lib/db.js';

/** Queries de Movimentações — operações atômicas com transação SQLite */

import * as inventariosQueries from './inventarios.js';

// ── LPN (Paletes) e SSCC (Caixas Serializadas) ──

export async function criarPalete() {
  // Gera um código único estilo PLT-XXXX
  const resCount = await db.execute("SELECT count(*) as total FROM paletes");
  const num = (resCount.rows[0].total + 1).toString().padStart(4, '0');
  const codigo = `PLT-${num}`;
  
  await db.execute({
    sql: `INSERT INTO paletes (codigo, endereco_atual, status) VALUES (?, 'REC', 'ATIVO')`,
    args: [codigo]
  });
  
  const res = await db.execute({
    sql: `SELECT * FROM paletes WHERE codigo = ?`,
    args: [codigo]
  });
  return res.rows[0];
}

export async function receberCaixaSerializada({ ean_caixa, produto_id, palete_id, peso_kg, validade, operador_id, operador_nome }) {
  try {
    // 1. Inserir a caixa serializada
    await db.batch([
      {
        sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, palete_id, peso_kg, validade, status) VALUES (?, ?, ?, ?, ?, 'DISPONIVEL')`,
        args: [ean_caixa, produto_id, palete_id || null, peso_kg, validade || null]
      },
      // 2. Aumentar o saldo agregado em REC (mantém compatibilidade com o WMS atual)
      {
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, 'REC', '', ?, 1, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [produto_id, validade || null, peso_kg]
      },
      // 3. Registrar no log
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, 'FORNECEDOR', 'REC', '', 1, ?, ?, ?, 'RECEBIMENTO')`,
        args: [produto_id, peso_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write');
    return { success: true };
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: estoque_caixas.ean_caixa')) {
      return { success: false, error: 'Este código EAN já foi recebido.' };
    }
    return { success: false, error: err.message };
  }
}

export async function removerCaixaSerializada(caixa_id, operador_id, operador_nome) {
  try {
    // Busca dados da caixa
    const res = await db.execute({ sql: `SELECT * FROM estoque_caixas WHERE id = ?`, args: [caixa_id] });
    if (res.rows.length === 0) return { success: false, error: 'Caixa não encontrada.' };
    const caixa = res.rows[0];

    await db.batch([
      // 1. Deletar a caixa
      { sql: `DELETE FROM estoque_caixas WHERE id = ?`, args: [caixa_id] },
      // 2. Subtrair do saldo agregado
      {
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = 'REC' AND validade IS ?`,
        args: [caixa.peso_kg, caixa.produto_id, caixa.validade]
      },
      // 3. Log de ajuste (deleção)
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, 'REC', 'EXCLUIDO', '', 1, ?, ?, ?, 'AJUSTE')`,
        args: [caixa.produto_id, caixa.peso_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write');

    // Limpa saldos zerados
    await db.execute(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function concluirPalete(palete_id) {
  try {
    await db.execute({
      sql: `UPDATE paletes SET status = 'FECHADO_DOCA' WHERE id = ?`,
      args: [palete_id]
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function listarCaixasDoPalete(palete_id) {
  const res = await db.execute({
    sql: `
      SELECT c.*, p.descricao as produto_descricao, p.codigo as produto_codigo 
      FROM estoque_caixas c
      JOIN produtos p ON c.produto_id = p.id
      WHERE c.palete_id = ? AND c.status = 'DISPONIVEL'
      ORDER BY c.created_at DESC
    `,
    args: [palete_id]
  });
  return res.rows;
}

export async function listarPaletesAbertos() {
  const res = await db.execute({
    sql: `
      SELECT p.*, count(c.id) as qtd_caixas, sum(c.peso_kg) as peso_total
      FROM paletes p
      LEFT JOIN estoque_caixas c ON c.palete_id = p.id AND c.status = 'DISPONIVEL'
      WHERE p.status = 'ATIVO' AND p.endereco_atual = 'REC'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `
  });
  return res.rows;
}

// ───────────────────────────────────────────────────

/**
 * MOTOR DE IDENTIFICAÇÃO UNIVERSAL PARA MOVIMENTAÇÕES
 * Retorna o tipo de entidade lida: PALETE, CAIXA, ou PRODUTO_GENERICO
 */
export async function identificarCodigoMovimentacao(codigo) {
  // 1. Tentar como Palete
  if (codigo.startsWith('PLT-')) {
    const resPalete = await db.execute({ sql: `SELECT * FROM paletes WHERE codigo = ?`, args: [codigo] });
    if (resPalete.rows.length > 0) {
      const p = resPalete.rows[0];
      const caixasRes = await db.execute({ sql: `SELECT * FROM estoque_caixas WHERE palete_id = ? AND status = 'DISPONIVEL'`, args: [p.id] });
      return { 
        tipo: 'PALETE', 
        dados: {
          ...p,
          caixas: caixasRes.rows,
          peso_total: caixasRes.rows.reduce((sum, c) => sum + c.peso_kg, 0)
        }
      };
    }
  }

  // 2. Tentar como Caixa SSCC Específica
  const resCaixa = await db.execute({ 
    sql: `SELECT c.*, p.descricao as produto_descricao, p.codigo as produto_codigo, pal.codigo as palete_codigo 
          FROM estoque_caixas c 
          JOIN produtos p ON c.produto_id = p.id
          LEFT JOIN paletes pal ON c.palete_id = pal.id
          WHERE c.ean_caixa = ? AND c.status = 'DISPONIVEL'`, 
    args: [codigo] 
  });
  
  if (resCaixa.rows.length > 0) {
    return { tipo: 'CAIXA', dados: resCaixa.rows[0] };
  }

  // 3. Tentar como Endereço Físico (modo antigo de origem)
  const resEnd = await db.execute({ sql: `SELECT * FROM locais WHERE endereco = ?`, args: [codigo] });
  if (resEnd.rows.length > 0) {
    return { tipo: 'ENDERECO', dados: resEnd.rows[0] };
  }

  // Se não for nenhum dos 3, a tela deverá tratar como "Não encontrado"
  return { tipo: 'DESCONHECIDO', dados: null };
}

export async function transferirPalete({ palete_id, destino, operador_id, operador_nome }) {
  if (destino === 'REC' || destino === 'EXPEDICAO') {
    return { success: false, error: 'Proibido transferir diretamente para REC ou EXPEDICAO usando a Movimentação. Use as telas adequadas.' }
  }

  try {
    const p = (await db.execute({ sql: `SELECT * FROM paletes WHERE id = ?`, args: [palete_id] })).rows[0];
    if (!p) return { success: false, error: 'Palete não encontrado.' };
    const origem = p.endereco_atual;

    const caixas = (await db.execute({ sql: `SELECT * FROM estoque_caixas WHERE palete_id = ? AND status = 'DISPONIVEL'`, args: [palete_id] })).rows;

    const blocos = [];

    // 1. Atualizar palete e suas caixas (caso a caixa tivesse endereço solto)
    blocos.push({ sql: `UPDATE paletes SET endereco_atual = ?, status = 'ARMAZENADO' WHERE id = ?`, args: [destino, palete_id] });
    blocos.push({ sql: `UPDATE estoque_caixas SET endereco = ? WHERE palete_id = ?`, args: [destino, palete_id] });

    // 2. Agrupar as caixas por produto e validade para ajustar os saldos agregados (estoque_posicao)
    const agrupamento = {};
    for (const c of caixas) {
      const key = `${c.produto_id}_${c.validade}`;
      if (!agrupamento[key]) agrupamento[key] = { produto_id: c.produto_id, validade: c.validade, caixas: 0, kg: 0 };
      agrupamento[key].caixas += 1;
      agrupamento[key].kg += c.peso_kg;
    }

    for (const g of Object.values(agrupamento)) {
      // Retira da Origem
      blocos.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - ?, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
        args: [g.caixas, g.kg, g.produto_id, origem, g.validade || '']
      });

      // Insere no Destino
      blocos.push({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', ?, ?, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + excluded.qtd_caixas, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [g.produto_id, destino, g.validade || null, g.caixas, g.kg]
      });

      // Log
      blocos.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, ?, '', ?, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [g.produto_id, origem, destino, g.caixas, g.kg, operador_id || null, operador_nome || 'Sistema']
      });
    }

    await db.batch(blocos, 'write');
    // Limpar posições zeradas
    await db.execute(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function transferirCaixasSSCC({ caixas_ids, destino, operador_id, operador_nome }) {
  if (destino === 'REC' || destino === 'EXPEDICAO') {
    return { success: false, error: 'Proibido transferir para REC/EXPEDICAO via Movimentação.' }
  }

  try {
    const placeholders = caixas_ids.map(() => '?').join(',');
    const caixas = (await db.execute({ sql: `SELECT c.*, p.endereco_atual as palete_endereco FROM estoque_caixas c LEFT JOIN paletes p ON c.palete_id = p.id WHERE c.id IN (${placeholders})`, args: caixas_ids })).rows;

    if (caixas.length === 0) return { success: false, error: 'Nenhuma caixa válida selecionada.' };

    const blocos = [];

    // Agrupamento para atualizar estoque genérico e logs
    const agrupamento = {};

    for (const c of caixas) {
      // Origem real da caixa é o endereço dela, ou se estiver num palete, o endereço do palete
      const origem_real = c.endereco || c.palete_endereco || 'REC';

      // Remove a caixa do palete (desmembramento) e atualiza o endereço
      blocos.push({ sql: `UPDATE estoque_caixas SET palete_id = NULL, endereco = ? WHERE id = ?`, args: [destino, c.id] });

      const key = `${c.produto_id}_${c.validade}_${origem_real}`;
      if (!agrupamento[key]) agrupamento[key] = { produto_id: c.produto_id, validade: c.validade, origem: origem_real, caixas: 0, kg: 0 };
      agrupamento[key].caixas += 1;
      agrupamento[key].kg += c.peso_kg;
    }

    for (const g of Object.values(agrupamento)) {
      // Retira da Origem
      blocos.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - ?, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND IFNULL(validade, '') = IFNULL(?, '')`,
        args: [g.caixas, g.kg, g.produto_id, g.origem, g.validade || '']
      });

      // Insere no Destino
      blocos.push({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', ?, ?, ?) ON CONFLICT(produto_id, endereco, lote, validade) DO UPDATE SET qtd_caixas = qtd_caixas + excluded.qtd_caixas, qtd_kg = qtd_kg + excluded.qtd_kg, updated_at = CURRENT_TIMESTAMP`,
        args: [g.produto_id, destino, g.validade || null, g.caixas, g.kg]
      });

      // Log
      blocos.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, ?, '', ?, ?, ?, ?, 'TRANSFERENCIA')`,
        args: [g.produto_id, g.origem, destino, g.caixas, g.kg, operador_id || null, operador_nome || 'Sistema']
      });
    }

    await db.batch(blocos, 'write');
    await db.execute(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * TRANSFERÊNCIA INTERNA ANTIGA: decrementa origem, incrementa (ou cria) destino
 * Usada para endereços genéricos (quando se transfere KG sem bipar caixa específica)
 */
export async function transferir({ produto_id, lote, validade, qtd_caixas, qtd_kg, origem, destino, operador_id, operador_nome }) {
  if (destino === 'REC' || destino === 'EXPEDICAO') {
    return { success: false, error: 'Proibido transferir diretamente para REC ou EXPEDICAO usando a Movimentação. Use as telas adequadas.' }
  }

  try {
    // Verificar bloqueio de inventário nos endereços
    const bloqOrigem = await inventariosQueries.verificarEnderecoBloqueado(origem)
    if (bloqOrigem) return { success: false, error: `Endereço ${origem} está bloqueado por inventário em andamento.`, bloqueado: true }
    const bloqDestino = await inventariosQueries.verificarEnderecoBloqueado(destino)
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

  // Verificar bloqueio no destino
  const bloqDestino = await inventariosQueries.verificarEnderecoBloqueado(destino)
  if (bloqDestino) return { success: false, error: `Endereço de destino ${destino} está bloqueado por inventário.`, bloqueado: true }

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
export async function enviarParaExpedicao({ produto_id, lote, validade, qtd_caixas, qtd_kg, origem, operador_id, operador_nome, num_pedido, cliente }) {
  if (!origem || origem === 'REC' || origem === 'EXPEDICAO') {
    return { success: false, error: 'Endereço de origem inválido para saída.' }
  }

  // Verificar bloqueio na origem
  const bloqOrigem = await inventariosQueries.verificarEnderecoBloqueado(origem)
  if (bloqOrigem) return { success: false, error: `Endereço de origem ${origem} está bloqueado por inventário.`, bloqueado: true }

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
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo, num_pedido, cliente) VALUES (?, ?, 'EXPEDICAO', ?, ?, ?, ?, ?, 'TRANSFERENCIA', ?, ?)`,
        args: [produto_id, origem, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema', num_pedido || null, cliente || null]
      }
    ], 'write')

    return { success: true }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

export async function abrirOrdemProducao({ produto_id, lote, validade, qtd_caixas, qtd_kg, origem, operador_id, operador_nome }) {
  if (!origem || origem === 'REC' || origem === 'EXPEDICAO') {
    return { success: false, error: 'Endereço de origem inválido para envio à produção.' }
  }

  // Verificar bloqueio na origem
  const bloqOrigem = await inventariosQueries.verificarEnderecoBloqueado(origem)
  if (bloqOrigem) return { success: false, error: `Endereço de origem ${origem} está bloqueado por inventário.`, bloqueado: true }

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
        sql: `INSERT INTO ordens_producao (materia_prima_id, lote, peso_enviado, operador_id) VALUES (?, ?, ?, ?)`,
        args: [produto_id, lote || '', qtd_kg, operador_id || null]
      },
      {
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, 'PRODUCAO', ?, ?, ?, ?, ?, 'DESPACHO')`,
        args: [produto_id, origem, lote || '', qtd_caixas, qtd_kg, operador_id || null, operador_nome || 'Sistema']
      }
    ], 'write')

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function abrirOrdemProducaoSSCC({ caixa_id, peso_enviado_kg, operador_id, operador_nome, ean_caixa_resto }) {
  try {
    const { rows } = await db.execute({
      sql: `SELECT c.*, p.descricao as produto_descricao
            FROM estoque_caixas c JOIN produtos p ON c.produto_id = p.id
            WHERE c.id = ? AND c.status = 'DISPONIVEL'`,
      args: [caixa_id]
    })
    if (rows.length === 0) return { success: false, error: 'Caixa não encontrada ou já consumida.' }
    const caixa = rows[0]

    const pesoCaixa = parseFloat(caixa.peso_kg)
    const pesoEnvio = parseFloat(peso_enviado_kg)

    if (pesoEnvio <= 0) return { success: false, error: 'O peso deve ser maior que zero.' }
    if (pesoEnvio > pesoCaixa + 0.001) return { success: false, error: `Peso maior que o da caixa.` }

    const isTotalExit = Math.abs(pesoEnvio - pesoCaixa) < 0.05
    const endereco = caixa.endereco || 'REC'
    
    // Verificar bloqueio na origem
    const bloqOrigem = await inventariosQueries.verificarEnderecoBloqueado(endereco)
    if (bloqOrigem) return { success: false, error: `Endereço de origem ${endereco} está bloqueado por inventário.`, bloqueado: true }

    const blocos = []

    if (isTotalExit) {
      blocos.push({ sql: `UPDATE estoque_caixas SET status = 'PRODUCAO', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [caixa_id] })
      blocos.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND IFNULL(validade,'') = IFNULL(?,'')`,
        args: [pesoCaixa, caixa.produto_id, endereco, caixa.validade]
      })
      blocos.push({
        sql: `INSERT INTO ordens_producao (materia_prima_id, lote, peso_enviado, operador_id) VALUES (?, '', ?, ?)`,
        args: [caixa.produto_id, pesoCaixa, operador_id || null]
      })
      blocos.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, 'PRODUCAO', '', 1, ?, ?, ?, 'DESPACHO')`,
        args: [caixa.produto_id, endereco, pesoCaixa, operador_id || null, operador_nome || 'Sistema']
      })
    } else {
      if (!ean_caixa_resto || ean_caixa_resto.trim() === '') return { success: false, error: 'EAN da caixa restante é obrigatório.' }
      const pesoResto = parseFloat((pesoCaixa - pesoEnvio).toFixed(3))

      blocos.push({ sql: `UPDATE estoque_caixas SET status = 'PRODUCAO', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [caixa_id] })
      blocos.push({
        sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, palete_id, endereco, peso_kg, validade, status) VALUES (?, ?, NULL, ?, ?, ?, 'DISPONIVEL')`,
        args: [ean_caixa_resto.trim(), caixa.produto_id, endereco, pesoResto, caixa.validade || null]
      })
      blocos.push({
        sql: `UPDATE estoque_posicao SET qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND IFNULL(validade,'') = IFNULL(?,'')`,
        args: [pesoEnvio, caixa.produto_id, endereco, caixa.validade]
      })
      blocos.push({
        sql: `INSERT INTO ordens_producao (materia_prima_id, lote, peso_enviado, operador_id) VALUES (?, '', ?, ?)`,
        args: [caixa.produto_id, pesoEnvio, operador_id || null]
      })
      blocos.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo) VALUES (?, ?, 'PRODUCAO', '', 1, ?, ?, ?, 'DESPACHO')`,
        args: [caixa.produto_id, endereco, pesoEnvio, operador_id || null, operador_nome || 'Sistema']
      })
    }

    await db.batch(blocos, 'write')
    await db.execute(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`)

    return {
      success: true,
      tipo: isTotalExit ? 'TOTAL' : 'PARCIAL',
      pesoEnvio,
      pesoResto: isTotalExit ? 0 : parseFloat((pesoCaixa - pesoEnvio).toFixed(3))
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function listarOrdensProducao(status = 'ABERTA') {
  const res = await db.execute({
    sql: `
      SELECT o.*, p.descricao as produto_descricao, p.codigo as produto_codigo, op.nome as operador_nome
      FROM ordens_producao o
      JOIN produtos p ON p.id = o.materia_prima_id
      LEFT JOIN operadores op ON op.id = o.operador_id
      WHERE o.status = ?
      ORDER BY o.data_inicio DESC
    `,
    args: [status]
  })
  return res.rows
}

export async function fecharOrdemProducao({ ordem_id, peso_retornado }) {
  try {
    const resOrdem = await db.execute({
      sql: `SELECT peso_enviado FROM ordens_producao WHERE id = ?`,
      args: [ordem_id]
    })
    const ordem = resOrdem.rows[0]
    if (!ordem) return { success: false, error: 'Ordem de produção não encontrada.' }

    const perda = ordem.peso_enviado - peso_retornado

    await db.execute({
      sql: `UPDATE ordens_producao SET status = 'CONCLUIDA', peso_retornado = ?, perda = ?, data_fim = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [peso_retornado, perda, ordem_id]
    })

    return { success: true }
  } catch (err) {
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
        ORDER BY dias_parado DESC
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
        ORDER BY ep.validade ASC
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

/**
 * SAÍDA POR CAIXA SSCC — com suporte a desmembramento parcial
 *
 * Fluxo completo:
 * - Saída TOTAL: marca a caixa como SAIDA, baixa do estoque_posicao, loga como DESPACHO
 * - Saída PARCIAL: baixa o peso retirado, mas mantém o restante como nova caixa com
 *   novo EAN (ean_caixa_resto) que o operador OBRIGATORIAMENTE escaneou.
 *
 * Parâmetros:
 *   caixa_id        — ID da caixa em estoque_caixas
 *   peso_saida_kg   — Quanto KG está saindo agora
 *   num_pedido      — Opcional
 *   cliente         — Opcional
 *   operador_id / operador_nome
 *   ean_caixa_resto — EAN da nova caixa (restante) — obrigatório se parcial
 */
export async function saidaPorCaixaSSCC({ caixa_id, peso_saida_kg, num_pedido, cliente, operador_id, operador_nome, ean_caixa_resto }) {
  try {
    // Buscar dados completos da caixa
    const { rows } = await db.execute({
      sql: `SELECT c.*, p.descricao as produto_descricao
            FROM estoque_caixas c JOIN produtos p ON c.produto_id = p.id
            WHERE c.id = ? AND c.status = 'DISPONIVEL'`,
      args: [caixa_id]
    })
    if (rows.length === 0) return { success: false, error: 'Caixa não encontrada ou já foi retirada do estoque.' }
    const caixa = rows[0]

    const pesoCaixa = parseFloat(caixa.peso_kg)
    const pesoSaida = parseFloat(peso_saida_kg)

    if (pesoSaida <= 0) return { success: false, error: 'O peso de saída deve ser maior que zero.' }
    if (pesoSaida > pesoCaixa + 0.001) return { success: false, error: `Peso de saída (${pesoSaida} kg) maior que o peso da caixa (${pesoCaixa} kg).` }

    const isTotalExit = Math.abs(pesoSaida - pesoCaixa) < 0.05 // diferença menor que 50g = saída total
    const endereco = caixa.endereco || 'REC'

    const blocos = []

    if (isTotalExit) {
      // ── SAÍDA TOTAL ──────────────────────────────────────────────────────────
      // 1. Marca a caixa como SAIDA
      blocos.push({
        sql: `UPDATE estoque_caixas SET status = 'SAIDA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [caixa_id]
      })
      // 2. Baixa o saldo agregado
      blocos.push({
        sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas - 1, qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP
              WHERE produto_id = ? AND endereco = ? AND IFNULL(validade,'') = IFNULL(?,'')`,
        args: [pesoCaixa, caixa.produto_id, endereco, caixa.validade]
      })
      // 3. Loga como DESPACHO
      blocos.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo, num_pedido, cliente)
              VALUES (?, ?, 'EXPEDICAO', '', 1, ?, ?, ?, 'DESPACHO', ?, ?)`,
        args: [caixa.produto_id, endereco, pesoCaixa, operador_id || null, operador_nome || 'Sistema', num_pedido || null, cliente || null]
      })
    } else {
      // ── SAÍDA PARCIAL (DESMEMBRAMENTO) ───────────────────────────────────────
      if (!ean_caixa_resto || ean_caixa_resto.trim() === '') {
        return { success: false, error: 'EAN da caixa restante é obrigatório para saída parcial.' }
      }
      const pesoResto = parseFloat((pesoCaixa - pesoSaida).toFixed(3))

      // 1. Marca a caixa original como SAIDA (consumida fisicamente)
      blocos.push({
        sql: `UPDATE estoque_caixas SET status = 'SAIDA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [caixa_id]
      })
      // 2. Cria nova caixa com o restante e o novo EAN
      blocos.push({
        sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, palete_id, endereco, peso_kg, validade, status)
              VALUES (?, ?, NULL, ?, ?, ?, 'DISPONIVEL')`,
        args: [ean_caixa_resto.trim(), caixa.produto_id, endereco, pesoResto, caixa.validade || null]
      })
      // 3. Ajusta o saldo agregado: sai pesoSaida, não altera caixas (1 caixa virou 1 caixa menor)
      blocos.push({
        sql: `UPDATE estoque_posicao SET qtd_kg = qtd_kg - ?, updated_at = CURRENT_TIMESTAMP
              WHERE produto_id = ? AND endereco = ? AND IFNULL(validade,'') = IFNULL(?,'')`,
        args: [pesoSaida, caixa.produto_id, endereco, caixa.validade]
      })
      // 4. Loga como DESPACHO parcial
      blocos.push({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo, num_pedido, cliente)
              VALUES (?, ?, 'EXPEDICAO', '', 1, ?, ?, ?, 'DESPACHO', ?, ?)`,
        args: [caixa.produto_id, endereco, pesoSaida, operador_id || null, operador_nome || 'Sistema', num_pedido || null, cliente || null]
      })
    }

    await db.batch(blocos, 'write')
    // Limpa posições zeradas
    await db.execute(`DELETE FROM estoque_posicao WHERE qtd_caixas <= 0 OR qtd_kg <= 0`)

    return {
      success: true,
      tipo: isTotalExit ? 'TOTAL' : 'PARCIAL',
      pesoSaida,
      pesoResto: isTotalExit ? 0 : parseFloat((pesoCaixa - pesoSaida).toFixed(3))
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
