/** Queries de Inventário — Cíclico, Geral (Wall-to-Wall), Carga Inicial e Ciclos */

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna lista de endereços bloqueados (em inventário aberto) */
function enderecosBloqueados(db) {
  const rows = db.prepare(`
    SELECT DISTINCT ii.endereco
    FROM inventario_itens ii
    JOIN inventarios i ON i.id = ii.inventario_id
    WHERE i.status NOT IN ('Finalizado OK', 'Cancelado')
  `).all()
  return rows.map(r => r.endereco)
}

/** Verifica se um endereço está bloqueado */
function verificarEnderecoBloqueado(db, endereco) {
  const row = db.prepare(`
    SELECT i.id, i.tipo, i.nome, i.tipo_filtro, i.identificador_filtro
    FROM inventario_itens ii
    JOIN inventarios i ON i.id = ii.inventario_id
    WHERE ii.endereco = ? AND i.status NOT IN ('Finalizado OK', 'Cancelado')
    LIMIT 1
  `).get(endereco)
  return row || null
}

// ─────────────────────────────────────────────────────────────────────────────
// CICLOS
// ─────────────────────────────────────────────────────────────────────────────

function ciclos_listar(db) {
  return db.prepare(`SELECT * FROM inventario_ciclos ORDER BY data_criacao DESC`).all()
}

function ciclos_buscarAtivo(db) {
  return db.prepare(`SELECT * FROM inventario_ciclos WHERE status = 'Ativo' LIMIT 1`).get()
}

function ciclos_criar(db, { nome, target_pct = 99.9 }) {
  try {
    const ativo = db.prepare(`SELECT id FROM inventario_ciclos WHERE status = 'Ativo' LIMIT 1`).get()
    if (ativo) return { success: false, error: 'Já existe um ciclo ativo. Encerre-o antes de criar um novo.' }
    const res = db.prepare(`INSERT INTO inventario_ciclos (nome, target_pct) VALUES (?, ?)`).run(nome, target_pct)
    return { success: true, id: res.lastInsertRowid }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function ciclos_encerrar(db, { ciclo_id, forcar = false }) {
  const execute = db.transaction(() => {
    // 1. Verificar se há inventários ativos para este ciclo
    const ativos = db.prepare(`SELECT COUNT(*) as count FROM inventarios WHERE ciclo_id = ? AND status NOT IN ('Finalizado OK', 'Cancelado')`).get(ciclo_id).count
    if (ativos > 0 && !forcar) {
      return { success: false, error: 'Existem inventários não finalizados vinculados a este ciclo.', inventarios_ativos: true }
    }

    // 2. Calcular endereços contados vs total do armazém
    const contados = db.prepare(`
      SELECT COUNT(DISTINCT ii.endereco) as contados
      FROM inventario_itens ii
      JOIN inventarios i ON i.id = ii.inventario_id
      WHERE i.ciclo_id = ?
    `).get(ciclo_id).contados

    // Total de endereços físicos válidos no armazém
    const totalEnderecos = db.prepare(`
      SELECT COUNT(endereco) as total FROM locais WHERE endereco NOT IN ('REC','EXPEDICAO','SAIDA')
    `).get().total

    if (contados < totalEnderecos && !forcar) {
      return { 
        success: false, 
        error: `Faltam ${totalEnderecos - contados} endereços físicos para contar. Deseja realmente encerrar o ciclo? Os endereços não contados serão desconsiderados.`,
        enderecos_faltantes: true
      }
    }

    db.prepare(`UPDATE inventario_ciclos SET status = 'Encerrado', data_encerramento = CURRENT_TIMESTAMP WHERE id = ?`).run(ciclo_id)
    return { success: true }
  })
  try { return execute() } catch (e) { return { success: false, error: e.message } }
}

function recontarItem(db, item_id) {
  try {
    db.prepare(`UPDATE inventario_itens SET qtd_contada_caixas = NULL, qtd_contada_kg = NULL, status_item = 'Pendente', contagem_atual = contagem_atual + 1 WHERE id = ?`).run(item_id)
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
}

function validarEstoqueSemAjuste(db, item_id, operador_id, operador_nome) {
  const execute = db.transaction(() => {
    const item = db.prepare(`SELECT * FROM inventario_itens WHERE id = ?`).get(item_id)
    if (!item) throw new Error('Item não encontrado.')
    if (item.status_item !== 'Aguardando Ajuste') throw new Error('Apenas itens divergentes podem ser validados sem ajuste.')
    
    db.prepare(`
      UPDATE inventario_itens 
      SET qtd_contada_caixas = qtd_sistema_caixas, 
          qtd_contada_kg = qtd_sistema_kg, 
          status_item = 'OK' 
      WHERE id = ?
    `).run(item_id)
    
    // Log de auditoria (Registro de validação)
    db.prepare(`
      INSERT INTO inventario_ajustes_log 
      (inventario_id, ciclo_id, produto_id, endereco, lote, qtd_ajustada_caixas, qtd_ajustada_kg, tipo_ajuste, usuario_aprovou_id, usuario_aprovou_nome)
      VALUES (?, (SELECT ciclo_id FROM inventarios WHERE id = ?), ?, ?, ?, 0, 0, 'Validado Físico (Sem Ajuste)', ?, ?)
    `).run(item.inventario_id, item.inventario_id, item.produto_id, item.endereco, item.lote, operador_id, operador_nome)
    
    // Verificar se o inventário como um todo pode ser finalizado
    const pendentes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item IN ('Pendente','2ª Contagem','3ª Contagem')`).get(item.inventario_id).v
    const ajustes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item = 'Aguardando Ajuste'`).get(item.inventario_id).v
    
    if (pendentes === 0 && ajustes === 0) {
      db.prepare(`UPDATE inventarios SET status = 'Finalizado OK', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`).run(item.inventario_id)
    }
    
    return { success: true }
  })
  try { return execute() } catch (err) { return { success: false, error: err.message } }
}

function ciclos_dashboard(db, ciclo_id) {
  // Todos os inventários finalizados do ciclo
  const inventariosFinalizados = db.prepare(`
    SELECT id FROM inventarios 
    WHERE ciclo_id = ? AND status = 'Finalizado OK'
  `).all(ciclo_id)
  const ids = inventariosFinalizados.map(i => i.id)

  // Contagem de endereços no ciclo (total de locais cadastrados não especiais)
  const enderecosTotalRow = db.prepare(`SELECT COUNT(*) as v FROM locais WHERE ativo = 1 AND endereco NOT IN ('REC','EXPEDICAO','SAIDA')`).get()
  const enderecos_total = enderecosTotalRow.v

  if (ids.length === 0) {
    return { ira: 0, ila: 0, perdas: 0, ganhos: 0, saldo: 0, enderecos_contados: 0, enderecos_total, itens_acurados: 0, itens_total: 0, ajustes: [] }
  }

  const placeholders = ids.map(() => '?').join(',')

  // IRA: porcentagem de itens com qtd_contada === qtd_sistema
  const iraItens = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN ABS(COALESCE(qtd_contada_caixas,0) - qtd_sistema_caixas) < 0.001 THEN 1 ELSE 0 END) as acurados
    FROM inventario_itens
    WHERE inventario_id IN (${placeholders}) AND qtd_contada_caixas IS NOT NULL
  `).get(...ids)

  const ira = iraItens.total > 0 ? ((iraItens.acurados / iraItens.total) * 100) : 0

  // ILA: % de endereços onde TODOS os itens estavam corretos
  const enderecoStats = db.prepare(`
    SELECT endereco,
      COUNT(*) as total,
      SUM(CASE WHEN ABS(COALESCE(qtd_contada_caixas,0) - qtd_sistema_caixas) < 0.001 THEN 1 ELSE 0 END) as acurados
    FROM inventario_itens
    WHERE inventario_id IN (${placeholders}) AND qtd_contada_caixas IS NOT NULL
    GROUP BY endereco
  `).all(...ids)

  const totalEnderecos = enderecoStats.length
  const enderecos100 = enderecoStats.filter(e => e.total === e.acurados).length
  const ila = totalEnderecos > 0 ? ((enderecos100 / totalEnderecos) * 100) : 0

  // Perdas e Ganhos do log de ajustes
  const financeiro = db.prepare(`
    SELECT 
      SUM(CASE WHEN qtd_ajustada_caixas < 0 THEN ABS(qtd_ajustada_caixas) * custo_unitario_data ELSE 0 END) as perdas,
      SUM(CASE WHEN qtd_ajustada_caixas > 0 THEN qtd_ajustada_caixas * custo_unitario_data ELSE 0 END) as ganhos
    FROM inventario_ajustes_log
    WHERE ciclo_id = ?
  `).get(ciclo_id)

  const ajustes = db.prepare(`
    SELECT al.*, p.codigo, p.descricao
    FROM inventario_ajustes_log al
    JOIN produtos p ON p.id = al.produto_id
    WHERE al.ciclo_id = ?
    ORDER BY al.data_ajuste DESC
    LIMIT 100
  `).all(ciclo_id)

  return {
    ira: Math.round(ira * 100) / 100,
    ila: Math.round(ila * 100) / 100,
    perdas: financeiro.perdas || 0,
    ganhos: financeiro.ganhos || 0,
    saldo: (financeiro.ganhos || 0) - (financeiro.perdas || 0),
    enderecos_contados: totalEnderecos,
    enderecos_total,
    itens_acurados: iraItens.acurados || 0,
    itens_total: iraItens.total || 0,
    ajustes
  }
}

// Retorna ou cria o produto dummy para endereços vazios
function getProdutoVazio(db) {
  let p = db.prepare(`SELECT id FROM produtos WHERE codigo = 'VAZIO'`).get()
  if (!p) {
    const res = db.prepare(`INSERT INTO produtos (codigo, descricao, tipo_produto) VALUES ('VAZIO', 'Endereço Vazio (Para Contagem)', 'Insumos')`).run()
    return res.lastInsertRowid
  }
  return p.id
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTÁRIO CÍCLICO (rotativo)
// ─────────────────────────────────────────────────────────────────────────────

function criar(db, { tipo_filtro, identificador_filtro }) {
  const execute = db.transaction(() => {
    const ativo = db.prepare(`
      SELECT id FROM inventarios 
      WHERE status NOT IN ('Finalizado OK', 'Cancelado') 
        AND tipo_filtro = ? AND identificador_filtro = ? AND tipo = 'Ciclico'
    `).get(tipo_filtro, identificador_filtro)
    if (ativo) throw new Error('Já existe um inventário em andamento para este filtro.')

    // Vincular ao ciclo ativo automaticamente
    const cicloAtivo = db.prepare(`SELECT id FROM inventario_ciclos WHERE status = 'Ativo' LIMIT 1`).get()

    const result = db.prepare(`
      INSERT INTO inventarios (tipo_filtro, identificador_filtro, tipo, ciclo_id, status)
      VALUES (?, ?, 'Ciclico', ?, 'Aberto')
    `).run(tipo_filtro, identificador_filtro, cicloAtivo ? cicloAtivo.id : null)

    const inventario_id = result.lastInsertRowid
    let saldos = []
    if (tipo_filtro === 'Curva') {
      saldos = db.prepare(`
        SELECT ep.endereco, ep.produto_id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg
        FROM estoque_posicao ep
        JOIN produtos p ON p.id = ep.produto_id
        WHERE p.status_curva = ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
          AND ep.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
        ORDER BY ep.endereco, p.descricao
      `).all(identificador_filtro)
    } else if (tipo_filtro === 'Rua') {
      const pVazio = getProdutoVazio(db)
      saldos = db.prepare(`
        SELECT l.endereco, 
               IFNULL(ep.produto_id, ?) as produto_id, 
               IFNULL(ep.lote, '') as lote, 
               ep.validade, 
               IFNULL(ep.qtd_caixas, 0) as qtd_caixas, 
               IFNULL(ep.qtd_kg, 0) as qtd_kg
        FROM locais l
        LEFT JOIN estoque_posicao ep ON ep.endereco = l.endereco AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
        WHERE l.endereco LIKE ? AND l.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
        ORDER BY l.endereco
      `).all(pVazio, identificador_filtro + '%')
    }

    if (saldos.length === 0) throw new Error('Nenhum item ou endereço encontrado para os critérios selecionados.')

    const insertItem = db.prepare(`
      INSERT INTO inventario_itens
        (inventario_id, endereco, produto_id, lote, validade, qtd_sistema_caixas, qtd_sistema_kg, qtd_contada_caixas, qtd_contada_kg, status_item)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'Pendente')
    `)
    for (const s of saldos) {
      insertItem.run(inventario_id, s.endereco, s.produto_id, s.lote, s.validade, s.qtd_caixas, s.qtd_kg)
    }
    db.prepare(`UPDATE inventarios SET status = 'Em Contagem' WHERE id = ?`).run(inventario_id)
    return { success: true, inventario_id, total_itens: saldos.length }
  })
  try { return execute() } catch (err) { return { success: false, error: err.message } }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTÁRIO GERAL (Wall-to-Wall)
// ─────────────────────────────────────────────────────────────────────────────

function criarGeral(db, { nome, zonas = [] }) {
  const execute = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO inventarios (nome, tipo, status) VALUES (?, 'Geral', 'Em Contagem')
    `).run(nome)
    const inventario_id = result.lastInsertRowid

    for (const zona of zonas) {
      const pVazio = getProdutoVazio(db)
      const saldos = db.prepare(`
        SELECT l.endereco, 
               IFNULL(ep.produto_id, ?) as produto_id, 
               IFNULL(ep.lote, '') as lote, 
               ep.validade, 
               IFNULL(ep.qtd_caixas, 0) as qtd_caixas, 
               IFNULL(ep.qtd_kg, 0) as qtd_kg
        FROM locais l
        LEFT JOIN estoque_posicao ep ON ep.endereco = l.endereco AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
        WHERE l.endereco LIKE ? AND l.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
        ORDER BY l.endereco
      `).all(pVazio, zona + '%')

      const zonaRes = db.prepare(`INSERT INTO inventario_zonas (inventario_id, nome_zona) VALUES (?, ?)`).run(inventario_id, zona)
      const zona_id = zonaRes.lastInsertRowid

      const insertItem = db.prepare(`
        INSERT INTO inventario_itens
          (inventario_id, endereco, produto_id, lote, validade, qtd_sistema_caixas, qtd_sistema_kg, status_item)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente')
      `)
      for (const s of saldos) {
        insertItem.run(inventario_id, s.endereco, s.produto_id, s.lote, s.validade, s.qtd_caixas, s.qtd_kg)
      }
    }
    return { success: true, inventario_id }
  })
  try { return execute() } catch (err) { return { success: false, error: err.message } }
}

function listarZonas(db, inventario_id) {
  const zonas = db.prepare(`SELECT * FROM inventario_zonas WHERE inventario_id = ? ORDER BY id`).all(inventario_id)
  return zonas.map(z => {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status_item NOT IN ('Pendente','2ª Contagem','3ª Contagem') THEN 1 ELSE 0 END) as contados,
        SUM(CASE WHEN status_item = 'OK' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN status_item = 'Aguardando Ajuste' THEN 1 ELSE 0 END) as divergentes
      FROM inventario_itens
      WHERE inventario_id = ? AND endereco LIKE ?
    `).get(inventario_id, z.nome_zona + '%')
    return { ...z, ...stats, pct: stats.total > 0 ? Math.round((stats.contados / stats.total) * 100) : 0 }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTÁRIO CARGA INICIAL
// ─────────────────────────────────────────────────────────────────────────────

function criarCargaInicial(db) {
  try {
    const existe = db.prepare(`SELECT id FROM inventarios WHERE tipo = 'CargaInicial' AND status NOT IN ('Finalizado OK','Cancelado') LIMIT 1`).get()
    if (existe) return { success: false, error: 'Já existe uma carga inicial em andamento.' }

    // Buscar todos os locais cadastrados (exceto especiais)
    const locais = db.prepare(`SELECT endereco FROM locais WHERE ativo = 1 AND endereco NOT IN ('REC','EXPEDICAO','SAIDA') ORDER BY endereco`).all()
    if (locais.length === 0) return { success: false, error: 'Cadastre endereços antes de iniciar a carga inicial.' }

    const result = db.prepare(`INSERT INTO inventarios (nome, tipo, status) VALUES ('Carga Inicial do Sistema', 'CargaInicial', 'Em Contagem')`).run()
    const inventario_id = result.lastInsertRowid

    // Para a carga inicial, inserimos 1 item-slot por endereço SEM produto (produto_id fictício)
    // Na verdade, o coletor adiciona itens surpresa. Retornamos apenas o ID
    return { success: true, inventario_id, total_locais: locais.length }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function conciliarCargaInicial(db, { inventario_id, operador_id, operador_nome }) {
  const execute = db.transaction(() => {
    const itens = db.prepare(`
      SELECT ii.*, p.valor_unitario
      FROM inventario_itens ii
      JOIN produtos p ON p.id = ii.produto_id
      WHERE ii.inventario_id = ? AND ii.qtd_contada_caixas IS NOT NULL
    `).all(inventario_id)

    let inseridos = 0
    for (const item of itens) {
      const validadeReal = item.validade_contada || item.validade
      let existe
      if (validadeReal) {
        existe = db.prepare(`SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND validade = ?`).get(item.produto_id, item.endereco, item.lote || '', validadeReal)
      } else {
        existe = db.prepare(`SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND validade IS NULL`).get(item.produto_id, item.endereco, item.lote || '')
      }
      if (existe) {
        db.prepare(`UPDATE estoque_posicao SET qtd_caixas = ?, qtd_kg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(item.qtd_contada_caixas, item.qtd_contada_kg, existe.id)
      } else {
        db.prepare(`INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, ?, ?, ?, ?)`).run(item.produto_id, item.endereco, item.lote || '', validadeReal, item.qtd_contada_caixas, item.qtd_contada_kg)
      }
      inseridos++
    }
    db.prepare(`UPDATE inventarios SET status = 'Finalizado OK', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`).run(inventario_id)
    return { success: true, inseridos }
  })
  try { return execute() } catch (e) { return { success: false, error: e.message } }
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTAGEM GERAL
// ─────────────────────────────────────────────────────────────────────────────

function listar(db) {
  return db.prepare(`
    SELECT i.*,
      ic.nome as ciclo_nome,
      COUNT(ii.id) as total_itens,
      SUM(CASE WHEN ii.status_item IN ('Pendente','2ª Contagem','3ª Contagem') THEN 1 ELSE 0 END) as pendentes,
      SUM(CASE WHEN ii.status_item = 'OK' THEN 1 ELSE 0 END) as ok,
      SUM(CASE WHEN ii.status_item = 'Aguardando Ajuste' THEN 1 ELSE 0 END) as divergentes
    FROM inventarios i
    LEFT JOIN inventario_ciclos ic ON ic.id = i.ciclo_id
    LEFT JOIN inventario_itens ii ON ii.inventario_id = i.id
    GROUP BY i.id
    ORDER BY i.data_criacao DESC
  `).all()
}

function buscar(db, id) {
  return db.prepare(`
    SELECT i.*, ic.nome as ciclo_nome
    FROM inventarios i
    LEFT JOIN inventario_ciclos ic ON ic.id = i.ciclo_id
    WHERE i.id = ?
  `).get(id)
}

function listarItens(db, inventario_id) {
  return db.prepare(`
    SELECT
      ii.id, ii.endereco, ii.lote, ii.validade, ii.validade_contada,
      ii.qtd_sistema_caixas, ii.qtd_sistema_kg,
      ii.qtd_contada_caixas, ii.qtd_contada_kg,
      ii.contagem_atual, ii.qtd_1_caixas, ii.qtd_1_kg, ii.qtd_2_caixas, ii.qtd_2_kg, ii.qtd_3_caixas, ii.qtd_3_kg,
      ii.status_item, ii.data_contagem,
      p.id as produto_id, p.codigo, p.descricao, p.status_curva, p.valor_unitario
    FROM inventario_itens ii
    JOIN produtos p ON p.id = ii.produto_id
    WHERE ii.inventario_id = ?
    ORDER BY ii.endereco, p.descricao
  `).all(inventario_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTAGEM (Coletor)
// ─────────────────────────────────────────────────────────────────────────────

function registrarContagem(db, { item_id, qtd_contada_caixas, qtd_contada_kg, validade_informada }) {
  const item = db.prepare(`SELECT ii.*, i.tipo as tipo_inventario FROM inventario_itens ii JOIN inventarios i ON i.id = ii.inventario_id WHERE ii.id = ?`).get(item_id)
  if (!item) return { success: false, error: 'Item não encontrado' }

  // Normaliza datas para comparar apenas a parte da data (YYYY-MM-DD)
  const validadeSistema = item.validade ? item.validade.toString().substring(0, 10) : null
  const validadeInformada = validade_informada ? validade_informada.toString().substring(0, 10) : null

  const isCargaInicial = item.tipo_inventario === 'CargaInicial'

  const caixasOK = Math.abs((item.qtd_sistema_caixas || 0) - qtd_contada_caixas) < 0.001
  const kgOK = Math.abs((item.qtd_sistema_kg || 0) - qtd_contada_kg) < 0.001
  // Validade: se o sistema não tem validade definida (surpresa/VAZIO), considera OK para validade
  const validadeOK = !validadeSistema || (validadeInformada === validadeSistema)
  const isOK = caixasOK && kgOK && validadeOK

  let novoStatus = item.status_item
  let contagem_atual = item.contagem_atual || 1
  const col_caixas = 'qtd_' + contagem_atual + '_caixas'
  const col_kg = 'qtd_' + contagem_atual + '_kg'

  if (isCargaInicial) {
    // Na Carga Inicial: sem segunda contagem. Vai direto para Aguardando Ajuste (sempre é uma entrada nova)
    novoStatus = 'Aguardando Ajuste'
  } else if (isOK) {
    if (item.qtd_sistema_caixas === 0 && qtd_contada_caixas === 0) {
      // Se era um item surpresa e a contagem final foi corrigida para 0, ele não existe fisicamente. Remove.
      db.prepare(`DELETE FROM inventario_itens WHERE id = ?`).run(item_id)
      
      const inventario = db.prepare(`SELECT inventario_id FROM inventario_itens WHERE id = ?`).get(item_id) || { inventario_id: item.inventario_id }
      const pendentes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item IN ('Pendente','2ª Contagem','3ª Contagem')`).get(inventario.inventario_id)
      const ajustes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item = 'Aguardando Ajuste'`).get(inventario.inventario_id)
      if (!isCargaInicial && pendentes.v === 0) {
        const novoStatusInv = ajustes.v > 0 ? 'Aguardando Ajuste' : 'Finalizado OK'
        db.prepare(`UPDATE inventarios SET status = ? WHERE id = ?`).run(novoStatusInv, inventario.inventario_id)
      }
      return { success: true, status_item: 'OK' }
    } else {
      novoStatus = 'OK'
    }
  } else {
    if (contagem_atual === 1) {
      novoStatus = '2ª Contagem'; contagem_atual = 2
    } else if (contagem_atual === 2) {
      const igual1 = Math.abs((item.qtd_1_caixas || 0) - qtd_contada_caixas) < 0.001 && Math.abs((item.qtd_1_kg || 0) - qtd_contada_kg) < 0.001
      if (igual1) { novoStatus = 'Aguardando Ajuste' }
      else { novoStatus = '3ª Contagem'; contagem_atual = 3 }
    } else {
      // Terceira contagem (ou mais) é sempre final, enviando para ajuste
      novoStatus = 'Aguardando Ajuste'
    }
  }

  const updateSql = 'UPDATE inventario_itens SET qtd_contada_caixas = ?, qtd_contada_kg = ?, validade_contada = ?, status_item = ?, data_contagem = CURRENT_TIMESTAMP, contagem_atual = ?, ' + col_caixas + ' = ?, ' + col_kg + ' = ? WHERE id = ?'
  db.prepare(updateSql).run(qtd_contada_caixas, qtd_contada_kg, validadeInformada, novoStatus, contagem_atual, qtd_contada_caixas, qtd_contada_kg, item_id)
  const inventario = db.prepare(`SELECT inventario_id FROM inventario_itens WHERE id = ?`).get(item_id)
  const pendentes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item IN ('Pendente','2ª Contagem','3ª Contagem')`).get(inventario.inventario_id)
  const ajustes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item = 'Aguardando Ajuste'`).get(inventario.inventario_id)

  if (!isCargaInicial && pendentes.v === 0) {
    const novoStatusInv = ajustes.v > 0 ? 'Aguardando Ajuste' : 'Finalizado OK'
    db.prepare(`UPDATE inventarios SET status = ? WHERE id = ?`).run(novoStatusInv, inventario.inventario_id)
  }

  return { success: true, status_item: novoStatus }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCILIAÇÃO COM LOG DE AUDITORIA
// ─────────────────────────────────────────────────────────────────────────────

function conciliar(db, { inventario_id, operador_id, operador_nome }) {
  const execute = db.transaction(() => {
    const inv = db.prepare(`SELECT * FROM inventarios WHERE id = ?`).get(inventario_id)
    const itensParaAjuste = db.prepare(`
      SELECT ii.*, p.valor_unitario
      FROM inventario_itens ii
      JOIN produtos p ON p.id = ii.produto_id
      WHERE ii.inventario_id = ? AND ii.status_item = 'Aguardando Ajuste'
    `).all(inventario_id)

    let atualizados = 0
    const insertLog = db.prepare(`
      INSERT INTO inventario_ajustes_log
        (inventario_id, ciclo_id, item_id, produto_id, endereco, lote, custo_unitario_data,
         qtd_ajustada_caixas, qtd_ajustada_kg, tipo_ajuste, usuario_aprovou_id, usuario_aprovou_nome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const item of itensParaAjuste) {
      const diffCx = (item.qtd_contada_caixas || 0) - (item.qtd_sistema_caixas || 0)
      const diffKg = (item.qtd_contada_kg || 0) - (item.qtd_sistema_kg || 0)
      const tipoAjuste = diffCx < 0 ? 'Perda' : 'Sobra'

      const validadeReal = item.validade_contada || item.validade
      let existente
      if (validadeReal) {
        existente = db.prepare(`SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND validade = ?`).get(item.produto_id, item.endereco, item.lote || '', validadeReal)
      } else {
        existente = db.prepare(`SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND validade IS NULL`).get(item.produto_id, item.endereco, item.lote || '')
      }

      if (existente) {
        db.prepare(`
          UPDATE estoque_posicao SET qtd_caixas = ?, qtd_kg = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(item.qtd_contada_caixas, item.qtd_contada_kg, existente.id)
      } else {
        db.prepare(`
          INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(item.produto_id, item.endereco, item.lote || '', validadeReal, item.qtd_contada_caixas, item.qtd_contada_kg)
      }

      db.prepare(`UPDATE inventario_itens SET status_item = 'OK' WHERE id = ?`).run(item.id)

      insertLog.run(
        inventario_id, inv.ciclo_id, item.id, item.produto_id,
        item.endereco, item.lote, item.valor_unitario || 0,
        diffCx, diffKg, tipoAjuste,
        operador_id || null, operador_nome || ''
      )
      atualizados++
    }

    db.prepare(`UPDATE inventarios SET status = 'Finalizado OK', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`).run(inventario_id)
    return { success: true, atualizados }
  })
  try { return execute() } catch (err) { return { success: false, error: err.message } }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCELAMENTOS E RESETS
// ─────────────────────────────────────────────────────────────────────────────

function cancelar(db, id) {
  db.prepare(`UPDATE inventarios SET status = 'Cancelado', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
  return { success: true }
}

function cancelarItem(db, item_id) {
  try {
    const item = db.prepare(`SELECT inventario_id FROM inventario_itens WHERE id = ?`).get(item_id)
    if (!item) return { success: false, error: 'Item não encontrado.' }
    db.prepare(`DELETE FROM inventario_itens WHERE id = ?`).run(item_id)
    // Verificar se inventário ficou vazio
    const restantes = db.prepare(`SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ?`).get(item.inventario_id)
    if (restantes.v === 0) {
      db.prepare(`UPDATE inventarios SET status = 'Cancelado', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`).run(item.inventario_id)
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IRA E ITENS SURPRESA
// ─────────────────────────────────────────────────────────────────────────────

function calcularIRA(db, inventario_id) {
  const itens = db.prepare(`
    SELECT
      ii.endereco, p.codigo, p.descricao, p.status_curva,
      ii.lote, ii.validade,
      ii.qtd_sistema_caixas, ii.qtd_contada_caixas,
      ii.qtd_sistema_kg, ii.qtd_contada_kg, ii.status_item,
      ROUND(
        CASE
          WHEN ii.qtd_sistema_caixas = 0 AND COALESCE(ii.qtd_contada_caixas,0) = 0 THEN 100
          WHEN ii.qtd_sistema_caixas = 0 THEN 0
          ELSE MAX(0, (1.0 - ABS(COALESCE(ii.qtd_contada_caixas,0) - ii.qtd_sistema_caixas) / ii.qtd_sistema_caixas) * 100)
        END, 2
      ) as ira_pct
    FROM inventario_itens ii
    JOIN produtos p ON p.id = ii.produto_id
    WHERE ii.inventario_id = ? AND ii.qtd_contada_caixas IS NOT NULL
    ORDER BY ira_pct ASC, ii.endereco
  `).all(inventario_id)

  const totalItens = itens.length
  const iraGeral = totalItens > 0 ? (itens.reduce((acc, i) => acc + i.ira_pct, 0) / totalItens).toFixed(2) : 100
  return { itens, ira_geral: parseFloat(iraGeral) }
}

function adicionarItemSurpresa(db, { inventario_id, endereco, produto_id, validade }) {
  // Se o endereço recebeu um item surpresa, ele não está mais vazio.
  // Deletar o item dummy (VAZIO) se existir para este endereço.
  const dummyProd = db.prepare(`SELECT id FROM produtos WHERE codigo = 'VAZIO'`).get()
  if (dummyProd) {
    db.prepare(`DELETE FROM inventario_itens WHERE inventario_id = ? AND endereco = ? AND produto_id = ?`).run(inventario_id, endereco, dummyProd.id)
  }

  // Considera lotes diferentes (validade_contada diferente) como registros separados se validade for NULL
  const validadeNorm = validade ? validade.toString().substring(0, 10) : null
  const existente = db.prepare(`
    SELECT * FROM inventario_itens 
    WHERE inventario_id = ? AND endereco = ? AND produto_id = ?
    AND (validade = ? OR (validade IS NULL AND validade_contada = ?))
  `).get(inventario_id, endereco, produto_id, validadeNorm, validadeNorm)
  
  if (existente) return { success: true, item_id: existente.id, status_item: existente.status_item, contagem_atual: existente.contagem_atual }
  
  const res = db.prepare(`
    INSERT INTO inventario_itens (inventario_id, endereco, produto_id, lote, validade, validade_contada, qtd_sistema_caixas, qtd_sistema_kg, status_item)
    VALUES (?, ?, ?, '', NULL, ?, 0, 0, 'Pendente')
  `).run(inventario_id, endereco, produto_id, validadeNorm)
  return { success: true, item_id: res.lastInsertRowid, status_item: 'Pendente', contagem_atual: 1 }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG DE AJUSTES
// ─────────────────────────────────────────────────────────────────────────────

function listarAjustesLog(db, { ciclo_id, inventario_id } = {}) {
  let sql = `
    SELECT al.*, p.codigo, p.descricao, p.tipo_produto
    FROM inventario_ajustes_log al
    JOIN produtos p ON p.id = al.produto_id
    WHERE 1=1
  `
  const params = []
  if (ciclo_id) { sql += ' AND al.ciclo_id = ?'; params.push(ciclo_id) }
  if (inventario_id) { sql += ' AND al.inventario_id = ?'; params.push(inventario_id) }
  sql += ' ORDER BY al.data_ajuste DESC LIMIT 500'
  return db.prepare(sql).all(...params)
}

module.exports = {
  // Ciclos
  ciclos_listar, ciclos_buscarAtivo, ciclos_criar, ciclos_encerrar, ciclos_dashboard,
  // Inventários
  criar, criarGeral, criarCargaInicial,
  listar, buscar, listarItens, listarZonas,
  // Contagem
  registrarContagem,
  // Conciliação
  conciliar, conciliarCargaInicial,
  // Cancelamento e Reset
  cancelar, cancelarItem, recontarItem,
  // IRA
  calcularIRA, adicionarItemSurpresa,
  // Log
  listarAjustesLog,
  // Bloqueio de endereços
  enderecosBloqueados, verificarEnderecoBloqueado,
  // Validação
  validarEstoqueSemAjuste
}
