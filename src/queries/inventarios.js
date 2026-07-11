import { db } from '../lib/db.js';

/** Queries de Inventário — Cíclico, Geral (Wall-to-Wall), Carga Inicial e Ciclos */

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna lista de endereços bloqueados (em inventário aberto) */
export async function enderecosBloqueados() {
  const { rows } = await db.execute({
    sql: `
    SELECT DISTINCT ii.endereco
    FROM inventario_itens ii
    JOIN inventarios i ON i.id = ii.inventario_id
    WHERE i.status NOT IN ('Finalizado OK', 'Cancelado')
  `, args: []});
  return rows.map(r => r.endereco)
}

/** Verifica se um endereço está bloqueado */
export async function verificarEnderecoBloqueado(endereco) {
  const { rows } = await db.execute({
    sql: `
    SELECT i.id, i.tipo, i.nome, i.tipo_filtro, i.identificador_filtro
    FROM inventario_itens ii
    JOIN inventarios i ON i.id = ii.inventario_id
    WHERE ii.endereco = ? AND i.status NOT IN ('Finalizado OK', 'Cancelado')
    LIMIT 1
  `, args: [endereco]});
  return rows[0] || null
}

// ─────────────────────────────────────────────────────────────────────────────
// CICLOS
// ─────────────────────────────────────────────────────────────────────────────

export async function ciclos_listar() {
  const { rows } = await db.execute({ sql: `SELECT * FROM inventario_ciclos ORDER BY data_criacao DESC`, args: [] })
  return rows
}

export async function ciclos_buscarAtivo() {
  const { rows } = await db.execute({ sql: `SELECT * FROM inventario_ciclos WHERE status = 'Ativo' LIMIT 1`, args: [] })
  return rows[0]
}

export async function ciclos_criar({ nome, target_pct = 99.9 }) {
  try {
    const { rows: ativoRows } = await db.execute({ sql: `SELECT id FROM inventario_ciclos WHERE status = 'Ativo' LIMIT 1`, args: [] })
    const ativo = ativoRows[0]
    if (ativo) return { success: false, error: 'Já existe um ciclo ativo. Encerre-o antes de criar um novo.' }
    const res = await db.execute({ sql: `INSERT INTO inventario_ciclos (nome, target_pct) VALUES (?, ?)`, args: [nome, target_pct] })
    return { success: true, id: res.lastInsertRowid.toString() }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function ciclos_encerrar({ ciclo_id, forcar = false }) {
  const tx = await db.transaction('write')
  try {
    // 1. Verificar se há inventários ativos para este ciclo
    const { rows: ativosRows } = await tx.execute({ sql: `SELECT COUNT(*) as count FROM inventarios WHERE ciclo_id = ? AND status NOT IN ('Finalizado OK', 'Cancelado')`, args: [ciclo_id] })
    const ativos = ativosRows[0].count
    if (ativos > 0 && !forcar) {
      await tx.rollback()
      return { success: false, error: 'Existem inventários não finalizados vinculados a este ciclo.', inventarios_ativos: true }
    }

    // 2. Calcular endereços contados vs total do armazém
    const { rows: contadosRows } = await tx.execute({
      sql: `
      SELECT COUNT(DISTINCT ii.endereco) as contados
      FROM inventario_itens ii
      JOIN inventarios i ON i.id = ii.inventario_id
      WHERE i.ciclo_id = ?
    `, args: [ciclo_id] })
    const contados = contadosRows[0].contados

    // Total de endereços físicos válidos no armazém
    const { rows: totalRows } = await tx.execute({
      sql: `
      SELECT COUNT(endereco) as total FROM locais WHERE endereco NOT IN ('REC','EXPEDICAO','SAIDA','PERDIDO')
    `, args: [] })
    const totalEnderecos = totalRows[0].total

    if (contados < totalEnderecos && !forcar) {
      await tx.rollback()
      return { 
        success: false, 
        error: `Faltam ${totalEnderecos - contados} endereços físicos para contar. Deseja realmente encerrar o ciclo? Os endereços não contados serão desconsiderados.`,
        enderecos_faltantes: true
      }
    }

    await tx.execute({ sql: `UPDATE inventario_ciclos SET status = 'Encerrado', data_encerramento = CURRENT_TIMESTAMP WHERE id = ?`, args: [ciclo_id] })
    await tx.commit()
    return { success: true }
  } catch (e) { 
    await tx.rollback()
    return { success: false, error: e.message } 
  }
}

export async function recontarItem(item_id) {
  try {
    await db.execute({ sql: `UPDATE inventario_itens SET qtd_contada_caixas = NULL, qtd_contada_kg = NULL, status_item = 'Pendente', contagem_atual = contagem_atual + 1 WHERE id = ?`, args: [item_id] })
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
}

// Recontar endereço inteiro — reseta TODOS os itens de um endereço para Pendente
// O coletor vai carregar todos os itens deste endereço na próxima vez que bipá-lo
export async function recontarEndereco(inventario_id, endereco) {
  try {
    await db.execute({
      sql: `UPDATE inventario_itens 
            SET qtd_contada_caixas = NULL, qtd_contada_kg = NULL, 
                status_item = 'Pendente', contagem_atual = contagem_atual + 1
            WHERE inventario_id = ? AND endereco = ? AND status_item IN ('Aguardando Ajuste', '2ª Contagem', '3ª Contagem')`,
      args: [inventario_id, endereco]
    })
    // Também reabrir o inventário caso esteja em 'Aguardando Ajuste'
    await db.execute({
      sql: `UPDATE inventarios SET status = 'Em Contagem' WHERE id = ? AND status = 'Aguardando Ajuste'`,
      args: [inventario_id]
    })
    return { success: true }
  } catch (err) { return { success: false, error: err.message } }
}

export async function validarEstoqueSemAjuste(item_id, operador_id, operador_nome) {
  const tx = await db.transaction('write')
  try {
    const { rows: itemRows } = await tx.execute({ sql: `SELECT * FROM inventario_itens WHERE id = ?`, args: [item_id] })
    const item = itemRows[0]
    if (!item) throw new Error('Item não encontrado.')
    if (item.status_item !== 'Aguardando Ajuste') throw new Error('Apenas itens divergentes podem ser validados sem ajuste.')
    
    await tx.execute({
      sql: `
      UPDATE inventario_itens 
      SET qtd_contada_caixas = qtd_sistema_caixas, 
          qtd_contada_kg = qtd_sistema_kg, 
          status_item = 'OK' 
      WHERE id = ?
    `, args: [item_id]})
    
    // Log de auditoria (Registro de validação)
    await tx.execute({
      sql: `
      INSERT INTO inventario_ajustes_log 
      (inventario_id, ciclo_id, produto_id, endereco, lote, qtd_ajustada_caixas, qtd_ajustada_kg, tipo_ajuste, usuario_aprovou_id, usuario_aprovou_nome)
      VALUES (?, (SELECT ciclo_id FROM inventarios WHERE id = ?), ?, ?, ?, 0, 0, 'Validado Físico (Sem Ajuste)', ?, ?)
    `, args: [item.inventario_id, item.inventario_id, item.produto_id, item.endereco, item.lote, operador_id, operador_nome]})
    
    // Verificar se o inventário como um todo pode ser finalizado
    const { rows: pendentesRows } = await tx.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item IN ('Pendente','2ª Contagem','3ª Contagem')`, args: [item.inventario_id] })
    const pendentes = pendentesRows[0].v
    const { rows: ajustesRows } = await tx.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item = 'Aguardando Ajuste'`, args: [item.inventario_id] })
    const ajustes = ajustesRows[0].v
    
    if (pendentes === 0 && ajustes === 0) {
      await tx.execute({ sql: `UPDATE inventarios SET status = 'Finalizado OK', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`, args: [item.inventario_id] })
    }
    
    await tx.commit()
    return { success: true }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

export async function ciclos_dashboard(ciclo_id) {
  // Todos os inventários finalizados do ciclo
  const { rows: inventariosFinalizados } = await db.execute({
    sql: `
    SELECT id FROM inventarios 
    WHERE ciclo_id = ? AND status = 'Finalizado OK'
  `, args: [ciclo_id] })
  const ids = inventariosFinalizados.map(i => i.id)

  // Contagem de endereços no ciclo (total de locais cadastrados não especiais)
  const { rows: enderecosTotalRows } = await db.execute({ sql: `SELECT COUNT(*) as v FROM locais WHERE ativo = 1 AND endereco NOT IN ('REC','EXPEDICAO','SAIDA','PERDIDO')`, args: [] })
  const enderecos_total = enderecosTotalRows[0].v

  if (ids.length === 0) {
    return { ira: 0, ila: 0, perdas: 0, ganhos: 0, saldo: 0, enderecos_contados: 0, enderecos_total, itens_acurados: 0, itens_total: 0, ajustes: [] }
  }

  const placeholders = ids.map(() => '?').join(',')

  // IRA: porcentagem de itens com qtd_contada === qtd_sistema
  const { rows: iraItensRows } = await db.execute({
    sql: `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN ABS(COALESCE(qtd_contada_caixas,0) - qtd_sistema_caixas) < 0.001 THEN 1 ELSE 0 END) as acurados
    FROM inventario_itens
    WHERE inventario_id IN (${placeholders}) AND qtd_contada_caixas IS NOT NULL
  `, args: [...ids] })
  const iraItens = iraItensRows[0]

  const ira = iraItens.total > 0 ? ((iraItens.acurados / iraItens.total) * 100) : 0

  // ILA: % de endereços onde TODOS os itens estavam corretos
  const { rows: enderecoStats } = await db.execute({
    sql: `
    SELECT endereco,
      COUNT(*) as total,
      SUM(CASE WHEN ABS(COALESCE(qtd_contada_caixas,0) - qtd_sistema_caixas) < 0.001 THEN 1 ELSE 0 END) as acurados
    FROM inventario_itens
    WHERE inventario_id IN (${placeholders}) AND qtd_contada_caixas IS NOT NULL
    GROUP BY endereco
  `, args: [...ids] })

  const totalEnderecos = enderecoStats.length
  const enderecos100 = enderecoStats.filter(e => e.total === e.acurados).length
  const ila = totalEnderecos > 0 ? ((enderecos100 / totalEnderecos) * 100) : 0

  // Perdas e Ganhos do log de ajustes
  const { rows: financeiroRows } = await db.execute({
    sql: `
    SELECT 
      SUM(CASE WHEN qtd_ajustada_caixas < 0 THEN ABS(qtd_ajustada_caixas) * custo_unitario_data ELSE 0 END) as perdas,
      SUM(CASE WHEN qtd_ajustada_caixas > 0 THEN qtd_ajustada_caixas * custo_unitario_data ELSE 0 END) as ganhos
    FROM inventario_ajustes_log
    WHERE ciclo_id = ?
  `, args: [ciclo_id] })
  const financeiro = financeiroRows[0]

  const { rows: ajustes } = await db.execute({
    sql: `
    SELECT al.*, p.codigo, p.descricao
    FROM inventario_ajustes_log al
    JOIN produtos p ON p.id = al.produto_id
    WHERE al.ciclo_id = ?
    ORDER BY al.data_ajuste DESC
    LIMIT 100
  `, args: [ciclo_id] })

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
export async function getProdutoVazio() {
  let { rows: pRows } = await db.execute({ sql: `SELECT id FROM produtos WHERE codigo = 'VAZIO'`, args: [] })
  let p = pRows[0]
  if (!p) {
    const res = await db.execute({ sql: `INSERT INTO produtos (codigo, descricao, tipo_produto) VALUES ('VAZIO', 'Endereço Vazio (Para Contagem)', 'Insumos')`, args: [] })
    return res.lastInsertRowid.toString()
  }
  return p.id
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTÁRIO CÍCLICO (rotativo)
// ─────────────────────────────────────────────────────────────────────────────

export async function criar({ tipo_filtro, identificador_filtro }) {
  const tx = await db.transaction('write')
  try {
    const { rows: ativoRows } = await tx.execute({
      sql: `
      SELECT id FROM inventarios 
      WHERE status NOT IN ('Finalizado OK', 'Cancelado') 
        AND tipo_filtro = ? AND identificador_filtro = ? AND tipo = 'Ciclico'
    `, args: [tipo_filtro, identificador_filtro] })
    const ativo = ativoRows[0]
    if (ativo) throw new Error('Já existe um inventário em andamento para este filtro.')

    // Vincular ao ciclo ativo automaticamente
    const { rows: cicloAtivoRows } = await tx.execute({ sql: `SELECT id FROM inventario_ciclos WHERE status = 'Ativo' LIMIT 1`, args: [] })
    const cicloAtivo = cicloAtivoRows[0]

    const result = await tx.execute({
      sql: `
      INSERT INTO inventarios (tipo_filtro, identificador_filtro, tipo, ciclo_id, status)
      VALUES (?, ?, 'Ciclico', ?, 'Aberto')
    `, args: [tipo_filtro, identificador_filtro, cicloAtivo ? cicloAtivo.id : null] })

    const inventario_id = result.lastInsertRowid.toString()
    let saldos = []
    if (tipo_filtro === 'Curva') {
      const { rows } = await tx.execute({
        sql: `
        SELECT NULL as ean_caixa, ep.endereco, ep.produto_id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg
        FROM estoque_posicao ep
        JOIN produtos p ON p.id = ep.produto_id
        WHERE p.status_curva = ? AND ep.qtd_caixas > 0
          AND ep.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
        ORDER BY ep.endereco, p.descricao
      `, args: [identificador_filtro] })
      saldos = rows
    } else if (tipo_filtro === 'Rua') {
      const pVazio = await getProdutoVazio(tx)
      const { rows } = await tx.execute({
        sql: `
        SELECT l.endereco, 
               NULL as ean_caixa,
               IFNULL(ep.produto_id, ?) as produto_id, 
               IFNULL(ep.lote, '') as lote, 
               ep.validade, 
               IFNULL(ep.qtd_caixas, 0) as qtd_caixas, 
               IFNULL(ep.qtd_kg, 0) as qtd_kg
        FROM locais l
        LEFT JOIN estoque_posicao ep ON ep.endereco = l.endereco AND ep.qtd_caixas > 0
        WHERE l.endereco LIKE ? AND l.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
        ORDER BY l.endereco
      `, args: [pVazio, identificador_filtro + '%'] })
      saldos = rows
    }

    if (saldos.length === 0) throw new Error('Nenhum item ou endereço encontrado para os critérios selecionados.')

    for (const s of saldos) {
      await tx.execute({
        sql: `
        INSERT INTO inventario_itens
          (inventario_id, ean_caixa, endereco, produto_id, lote, validade, qtd_sistema_caixas, qtd_sistema_kg, qtd_contada_caixas, qtd_contada_kg, status_item)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'Pendente')
      `, args: [inventario_id, s.ean_caixa || null, s.endereco, s.produto_id, s.lote, s.validade, s.qtd_caixas, s.qtd_kg] })
    }
    await tx.execute({ sql: `UPDATE inventarios SET status = 'Em Contagem' WHERE id = ?`, args: [inventario_id] })
    
    await tx.commit()
    return { success: true, inventario_id, total_itens: saldos.length }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTÁRIO GERAL (Wall-to-Wall)
// ─────────────────────────────────────────────────────────────────────────────

export async function criarGeral({ nome, zonas = [] }) {
  const tx = await db.transaction('write')
  try {
    const result = await tx.execute({
      sql: `
      INSERT INTO inventarios (nome, tipo, status) VALUES (?, 'Geral', 'Em Contagem')
    `, args: [nome] })
    const inventario_id = result.lastInsertRowid.toString()

    for (const zona of zonas) {
      const pVazio = await getProdutoVazio(tx)
      const { rows: saldos } = await tx.execute({
        sql: `
        SELECT l.endereco, 
               NULL as ean_caixa,
               IFNULL(ep.produto_id, ?) as produto_id, 
               IFNULL(ep.lote, '') as lote, 
               ep.validade, 
               IFNULL(ep.qtd_caixas, 0) as qtd_caixas, 
               IFNULL(ep.qtd_kg, 0) as qtd_kg
        FROM locais l
        LEFT JOIN estoque_posicao ep ON ep.endereco = l.endereco AND ep.qtd_caixas > 0
        WHERE l.endereco LIKE ? AND l.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
        ORDER BY l.endereco
      `, args: [pVazio, zona + '%'] })

      const zonaRes = await tx.execute({ sql: `INSERT INTO inventario_zonas (inventario_id, nome_zona) VALUES (?, ?)`, args: [inventario_id, zona] })
      
      for (const s of saldos) {
        await tx.execute({
          sql: `
          INSERT INTO inventario_itens
            (inventario_id, ean_caixa, endereco, produto_id, lote, validade, qtd_sistema_caixas, qtd_sistema_kg, status_item)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')
        `, args: [inventario_id, s.ean_caixa || null, s.endereco, s.produto_id, s.lote, s.validade, s.qtd_caixas, s.qtd_kg] })
      }
    }
    await tx.commit()
    return { success: true, inventario_id }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

export async function listarZonas(inventario_id) {
  const { rows: zonas } = await db.execute({ sql: `SELECT * FROM inventario_zonas WHERE inventario_id = ? ORDER BY id`, args: [inventario_id] })
  const result = []
  for (const z of zonas) {
    const { rows: statsRows } = await db.execute({
      sql: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status_item NOT IN ('Pendente','2ª Contagem','3ª Contagem') THEN 1 ELSE 0 END) as contados,
        SUM(CASE WHEN status_item = 'OK' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN status_item = 'Aguardando Ajuste' THEN 1 ELSE 0 END) as divergentes
      FROM inventario_itens
      WHERE inventario_id = ? AND endereco LIKE ?
    `, args: [inventario_id, z.nome_zona + '%'] })
    const stats = statsRows[0]
    result.push({ ...z, ...stats, pct: stats.total > 0 ? Math.round((stats.contados / stats.total) * 100) : 0 })
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTÁRIO CARGA INICIAL
// ─────────────────────────────────────────────────────────────────────────────

export async function criarCargaInicial() {
  try {
    const { rows: existeRows } = await db.execute({ sql: `SELECT id FROM inventarios WHERE tipo = 'CargaInicial' AND status NOT IN ('Finalizado OK','Cancelado') LIMIT 1`, args: [] })
    const existe = existeRows[0]
    if (existe) return { success: false, error: 'Já existe uma carga inicial em andamento.' }

    // Buscar todos os locais cadastrados (exceto especiais)
    const { rows: locais } = await db.execute({ sql: `SELECT endereco FROM locais WHERE ativo = 1 AND endereco NOT IN ('REC','EXPEDICAO','SAIDA','PERDIDO') ORDER BY endereco`, args: [] })
    if (locais.length === 0) return { success: false, error: 'Cadastre endereços antes de iniciar a carga inicial.' }

    const result = await db.execute({ sql: `INSERT INTO inventarios (nome, tipo, status) VALUES ('Carga Inicial do Sistema', 'CargaInicial', 'Em Contagem')`, args: [] })
    const inventario_id = result.lastInsertRowid.toString()

    // Para a carga inicial, inserimos 1 item-slot por endereço SEM produto (produto_id fictício)
    // Na verdade, o coletor adiciona itens surpresa. Retornamos apenas o ID
    return { success: true, inventario_id, total_locais: locais.length }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function conciliarCargaInicial({ inventario_id, operador_id, operador_nome }) {
  const tx = await db.transaction('write')
  try {
    const { rows: itens } = await tx.execute({
      sql: `
      SELECT ii.*, p.valor_unitario
      FROM inventario_itens ii
      JOIN produtos p ON p.id = ii.produto_id
      WHERE ii.inventario_id = ? AND ii.qtd_contada_caixas IS NOT NULL
    `, args: [inventario_id] })

    let inseridos = 0
    for (const item of itens) {
      const validadeReal = item.validade_contada || item.validade
      let existe
      if (validadeReal) {
        const { rows } = await tx.execute({ sql: `SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND validade = ?`, args: [item.produto_id, item.endereco, item.lote || '', validadeReal] })
        existe = rows[0]
      } else {
        const { rows } = await tx.execute({ sql: `SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND lote = ? AND validade IS NULL`, args: [item.produto_id, item.endereco, item.lote || ''] })
        existe = rows[0]
      }
      if (existe) {
        await tx.execute({ sql: `UPDATE estoque_posicao SET qtd_caixas = ?, qtd_kg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [item.qtd_contada_caixas, item.qtd_contada_kg, existe.id] })
      } else {
        await tx.execute({ sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, ?, ?, ?, ?)`, args: [item.produto_id, item.endereco, item.lote || '', validadeReal, item.qtd_contada_caixas, item.qtd_contada_kg] })
      }
      inseridos++
    }
    await tx.execute({ sql: `UPDATE inventarios SET status = 'Finalizado OK', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`, args: [inventario_id] })
    await tx.commit()
    return { success: true, inseridos }
  } catch (e) {
    await tx.rollback()
    return { success: false, error: e.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTAGEM GERAL
// ─────────────────────────────────────────────────────────────────────────────

export async function listar() {
  const { rows } = await db.execute({
    sql: `
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
  `, args: [] })
  return rows
}

export async function buscar(id) {
  const { rows } = await db.execute({
    sql: `
    SELECT i.*, ic.nome as ciclo_nome
    FROM inventarios i
    LEFT JOIN inventario_ciclos ic ON ic.id = i.ciclo_id
    WHERE i.id = ?
  `, args: [id] })
  return rows[0]
}

export async function listarItens(inventario_id) {
  const { rows } = await db.execute({
    sql: `
    SELECT
      ii.id, ii.ean_caixa, ii.endereco, ii.lote, ii.validade, ii.validade_contada,
      ii.qtd_sistema_caixas, ii.qtd_sistema_kg,
      ii.qtd_contada_caixas, ii.qtd_contada_kg,
      ii.contagem_atual, ii.qtd_1_caixas, ii.qtd_1_kg, ii.qtd_2_caixas, ii.qtd_2_kg, ii.qtd_3_caixas, ii.qtd_3_kg,
      ii.status_item, ii.data_contagem,
      p.id as produto_id, p.codigo, p.descricao, p.status_curva, p.valor_unitario
    FROM inventario_itens ii
    JOIN produtos p ON p.id = ii.produto_id
    WHERE ii.inventario_id = ?
    ORDER BY ii.endereco, p.descricao, ii.ean_caixa
  `, args: [inventario_id] })
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTAGEM (Coletor)
// ─────────────────────────────────────────────────────────────────────────────

export async function registrarContagem({ item_id, qtd_contada_caixas, qtd_contada_kg, validade_informada }) {
  const { rows: itemRows } = await db.execute({ sql: `SELECT ii.*, i.tipo as tipo_inventario FROM inventario_itens ii JOIN inventarios i ON i.id = ii.inventario_id WHERE ii.id = ?`, args: [item_id] })
  const item = itemRows[0]
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
    // Endereço bateu com o sistema → OK
    // Caso especial: era um item surpresa (ean_caixa existe mas a contagem foi corrigida para 0 pelo operador)
    // Isso só acontece se o item foi criado com qtd_sistema = 0 E tem ean_caixa (é real surpresa)
    // Neste caso, removemos o item pois o produto não existia de fato.
    if (item.ean_caixa && item.qtd_sistema_caixas === 0 && qtd_contada_caixas === 0) {
      await db.execute({ sql: `DELETE FROM inventario_itens WHERE id = ?`, args: [item_id] })
      
      const { rows: pendentesRows2 } = await db.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item IN ('Pendente','2ª Contagem','3ª Contagem')`, args: [item.inventario_id] })
      const pendentes2 = pendentesRows2[0]
      const { rows: ajustesRows2 } = await db.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item = 'Aguardando Ajuste'`, args: [item.inventario_id] })
      const ajustes2 = ajustesRows2[0]
      if (pendentes2.v === 0) {
        const novoStatusInv = ajustes2.v > 0 ? 'Aguardando Ajuste' : 'Finalizado OK'
        await db.execute({ sql: `UPDATE inventarios SET status = ? WHERE id = ?`, args: [novoStatusInv, item.inventario_id] })
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
  await db.execute({ sql: updateSql, args: [qtd_contada_caixas, qtd_contada_kg, validadeInformada, novoStatus, contagem_atual, qtd_contada_caixas, qtd_contada_kg, item_id] })
  
  const { rows: invRows } = await db.execute({ sql: `SELECT inventario_id FROM inventario_itens WHERE id = ?`, args: [item_id] })
  const inventario = invRows[0]
  if (inventario) {
    const { rows: pendentesRows } = await db.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item IN ('Pendente','2ª Contagem','3ª Contagem')`, args: [inventario.inventario_id] })
    const pendentes = pendentesRows[0]
    const { rows: ajustesRows } = await db.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ? AND status_item = 'Aguardando Ajuste'`, args: [inventario.inventario_id] })
    const ajustes = ajustesRows[0]

    if (!isCargaInicial && pendentes.v === 0) {
      const novoStatusInv = ajustes.v > 0 ? 'Aguardando Ajuste' : 'Finalizado OK'
      await db.execute({ sql: `UPDATE inventarios SET status = ? WHERE id = ?`, args: [novoStatusInv, inventario.inventario_id] })
    }
  }

  return { success: true, status_item: novoStatus }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCILIAÇÃO COM LOG DE AUDITORIA
// ─────────────────────────────────────────────────────────────────────────────

export async function conciliar({ inventario_id, operador_id, operador_nome }) {
  const tx = await db.transaction('write')
  try {
    const { rows: invRows } = await tx.execute({ sql: `SELECT * FROM inventarios WHERE id = ?`, args: [inventario_id] })
    const inv = invRows[0]
    const { rows: itensParaAjuste } = await tx.execute({
      sql: `
      SELECT ii.*, p.valor_unitario
      FROM inventario_itens ii
      JOIN produtos p ON p.id = ii.produto_id
      WHERE ii.inventario_id = ? AND ii.status_item = 'Aguardando Ajuste'
    `, args: [inventario_id] })

    let atualizados = 0

    for (const item of itensParaAjuste) {
      const diffCx = (item.qtd_contada_caixas || 0) - (item.qtd_sistema_caixas || 0)
      const diffKg = (item.qtd_contada_kg || 0) - (item.qtd_sistema_kg || 0)
      
      // tipoAjuste corrigido para qualquer quantidade (nao apenas 1 caixa)
      let tipoAjuste = 'Divergência de Peso/Validade'
      if ((item.qtd_contada_caixas || 0) < (item.qtd_sistema_caixas || 0)) {
        tipoAjuste = 'Perda' // Falta: sistema tinha mais do que foi contado
      } else if ((item.qtd_contada_caixas || 0) > (item.qtd_sistema_caixas || 0)) {
        tipoAjuste = 'Sobra' // Sobra: foi contado mais do que o sistema esperava
      }

      const validadeReal = item.validade_contada || item.validade
      const qtdContada = item.qtd_contada_caixas || 0
      const kgContado = item.qtd_contada_kg || 0

      // Se for SSCC (possui ean_caixa)
      if (item.ean_caixa) {
        if (tipoAjuste === 'Perda') {
          // Move para o endereço PERDIDO e marca como BLOQUEADO
          await tx.execute({
            sql: `UPDATE estoque_caixas SET endereco = 'PERDIDO', status = 'BLOQUEADO', updated_at = CURRENT_TIMESTAMP WHERE ean_caixa = ?`,
            args: [item.ean_caixa]
          })
          await tx.execute({
            sql: `INSERT INTO caixas_historico (ean_caixa, operacao, detalhes, operador_nome) VALUES (?, 'INVENTARIO_PERDA', 'Caixa declarada perdida no inventário ' || ?, ?)`,
            args: [item.ean_caixa, inventario_id, operador_nome || 'Sistema']
          })
          // Deduz da posicao atual (que é o item.endereco)
          await tx.execute({
            sql: `UPDATE estoque_posicao SET qtd_caixas = MAX(0, qtd_caixas - 1), qtd_kg = MAX(0, qtd_kg - ?), updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND validade IS ?`,
            args: [item.qtd_sistema_kg, item.produto_id, item.endereco, item.validade]
          })
        } else if (tipoAjuste === 'Sobra') {
          // Verifica se já existia na estoque_caixas em outro lugar
          const { rows: caixas } = await tx.execute({ sql: `SELECT id, endereco, peso_kg FROM estoque_caixas WHERE ean_caixa = ?`, args: [item.ean_caixa] })
          if (caixas.length > 0) {
            // Estava perdida, move pra cá
            await tx.execute({
              sql: `UPDATE estoque_caixas SET endereco = ?, peso_kg = ?, validade = ?, status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE ean_caixa = ?`,
              args: [item.endereco, kgContado, validadeReal, item.ean_caixa]
            })
            await tx.execute({
              sql: `INSERT INTO caixas_historico (ean_caixa, operacao, detalhes, operador_nome) VALUES (?, 'INVENTARIO_SOBRA', 'Caixa reencontrada no inventário ' || ?, ?)`,
              args: [item.ean_caixa, inventario_id, operador_nome || 'Sistema']
            })
          } else {
            // Cria a caixa
            await tx.execute({
              sql: `INSERT INTO estoque_caixas (ean_caixa, produto_id, endereco, lote, validade, peso_kg, status) VALUES (?, ?, ?, ?, ?, ?, 'DISPONIVEL')`,
              args: [item.ean_caixa, item.produto_id, item.endereco, item.lote || '', validadeReal, kgContado]
            })
            await tx.execute({
              sql: `INSERT INTO caixas_historico (ean_caixa, operacao, detalhes, operador_nome) VALUES (?, 'INVENTARIO_SOBRA', 'Caixa criada como sobra no inventário ' || ?, ?)`,
              args: [item.ean_caixa, inventario_id, operador_nome || 'Sistema']
            })
          }
          // Adiciona na posição atual
          const { rows: pos } = await tx.execute({ sql: `SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND validade IS ?`, args: [item.produto_id, item.endereco, validadeReal] })
          if (pos[0]) {
            await tx.execute({ sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [kgContado, pos[0].id] })
          } else {
            await tx.execute({ sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, ?, ?, 1, ?)`, args: [item.produto_id, item.endereco, item.lote || '', validadeReal, kgContado] })
          }
        } else {
          // Divergência de Peso/Validade (SSCC)
          await tx.execute({
            sql: `UPDATE estoque_caixas SET peso_kg = ?, validade = ?, status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE ean_caixa = ?`,
            args: [kgContado, validadeReal, item.ean_caixa]
          })
          await tx.execute({
            sql: `INSERT INTO caixas_historico (ean_caixa, operacao, detalhes, operador_nome) VALUES (?, 'INVENTARIO_AJUSTE', 'Peso/Validade ajustados no inventário ' || ?, ?)`,
            args: [item.ean_caixa, inventario_id, operador_nome || 'Sistema']
          })
          // Atualiza posição subtraindo a diferença de peso
          await tx.execute({
            sql: `UPDATE estoque_posicao SET qtd_kg = MAX(0, qtd_kg + ?), updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND validade IS ?`,
            args: [diffKg, item.produto_id, item.endereco, item.validade]
          })
        }
      } else {
        // ─── SEM SSCC: ajuste direto em estoque_posicao ──────────────────────
        // Estes itens vieram de estoque_posicao (sem serialização individual)
        // Precisamos ajustar a quantidade diretamente na tabela.
        if (qtdContada === 0) {
          // Zerar a posição (falta total ou endereço vazio)
          await tx.execute({
            sql: `UPDATE estoque_posicao SET qtd_caixas = 0, qtd_kg = 0, updated_at = CURRENT_TIMESTAMP WHERE produto_id = ? AND endereco = ? AND validade IS ?`,
            args: [item.produto_id, item.endereco, item.validade || null]
          })
          // Remover linhas zeradas
          await tx.execute({
            sql: `DELETE FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND qtd_caixas <= 0`,
            args: [item.produto_id, item.endereco]
          })
        } else {
          // Ajustar para a quantidade contada
          const { rows: posRows } = await tx.execute({
            sql: `SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND validade IS ?`,
            args: [item.produto_id, item.endereco, item.validade || null]
          })
          if (posRows[0]) {
            await tx.execute({
              sql: `UPDATE estoque_posicao SET qtd_caixas = ?, qtd_kg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              args: [qtdContada, kgContado, posRows[0].id]
            })
          } else {
            await tx.execute({
              sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, ?, ?, ?, ?)`,
              args: [item.produto_id, item.endereco, item.lote || '', item.validade, qtdContada, kgContado]
            })
          }
        }
      }


      await tx.execute({ sql: `UPDATE inventario_itens SET status_item = 'OK' WHERE id = ?`, args: [item.id] })

      await tx.execute({
        sql: `
        INSERT INTO inventario_ajustes_log
          (inventario_id, ciclo_id, item_id, produto_id, endereco, lote, custo_unitario_data,
           qtd_ajustada_caixas, qtd_ajustada_kg, tipo_ajuste, usuario_aprovou_id, usuario_aprovou_nome)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, args: [
        inventario_id, inv.ciclo_id, item.id, item.produto_id,
        item.endereco, item.lote, item.valor_unitario || 0,
        diffCx, diffKg, tipoAjuste,
        operador_id || null, operador_nome || ''
      ] })
      atualizados++
    }

    await tx.execute({ sql: `UPDATE inventarios SET status = 'Finalizado OK', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`, args: [inventario_id] })
    await tx.commit()
    return { success: true, atualizados }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCELAMENTOS E RESETS
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelar(id) {
  await db.execute({ sql: `UPDATE inventarios SET status = 'Cancelado', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`, args: [id] })
  return { success: true }
}

export async function cancelarItem(item_id) {
  try {
    const { rows: itemRows } = await db.execute({ sql: `SELECT inventario_id FROM inventario_itens WHERE id = ?`, args: [item_id] })
    const item = itemRows[0]
    if (!item) return { success: false, error: 'Item não encontrado.' }
    await db.execute({ sql: `DELETE FROM inventario_itens WHERE id = ?`, args: [item_id] })
    // Verificar se inventário ficou vazio
    const { rows: restantesRows } = await db.execute({ sql: `SELECT COUNT(*) as v FROM inventario_itens WHERE inventario_id = ?`, args: [item.inventario_id] })
    const restantes = restantesRows[0]
    if (restantes.v === 0) {
      await db.execute({ sql: `UPDATE inventarios SET status = 'Cancelado', data_finalizacao = CURRENT_TIMESTAMP WHERE id = ?`, args: [item.inventario_id] })
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IRA E ITENS SURPRESA
// ─────────────────────────────────────────────────────────────────────────────

export async function calcularIRA(inventario_id) {
  const { rows: itens } = await db.execute({
    sql: `
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
  `, args: [inventario_id] })

  const totalItens = itens.length
  const iraGeral = totalItens > 0 ? (itens.reduce((acc, i) => acc + i.ira_pct, 0) / totalItens).toFixed(2) : 100
  return { itens, ira_geral: parseFloat(iraGeral) }
}

export async function adicionarItemSurpresa({ inventario_id, endereco, produto_id, validade, ean_caixa }) {
  // Se o endereço recebeu um item surpresa, ele não está mais vazio.
  // Deletar o item dummy (VAZIO) se existir para este endereço.
  const { rows: dummyProdRows } = await db.execute({ sql: `SELECT id FROM produtos WHERE codigo = 'VAZIO'`, args: [] })
  const dummyProd = dummyProdRows[0]
  if (dummyProd) {
    await db.execute({ sql: `DELETE FROM inventario_itens WHERE inventario_id = ? AND endereco = ? AND produto_id = ?`, args: [inventario_id, endereco, dummyProd.id] })
  }

  // Considera lotes diferentes (validade_contada diferente) como registros separados se validade for NULL
  // Com o EAN único, nós apenas verificamos se o EAN já está na lista
  const validadeNorm = validade ? validade.toString().substring(0, 10) : null
  const { rows: existenteRows } = await db.execute({
    sql: `
    SELECT * FROM inventario_itens 
    WHERE inventario_id = ? AND endereco = ? AND ean_caixa = ?
  `, args: [inventario_id, endereco, ean_caixa] })
  const existente = existenteRows[0]
  
  if (existente) return { success: true, item_id: existente.id, status_item: existente.status_item, contagem_atual: existente.contagem_atual }
  
  const res = await db.execute({
    sql: `
    INSERT INTO inventario_itens (inventario_id, ean_caixa, endereco, produto_id, lote, validade, validade_contada, qtd_sistema_caixas, qtd_sistema_kg, status_item)
    VALUES (?, ?, ?, ?, '', NULL, ?, 0, 0, 'Pendente')
  `, args: [inventario_id, ean_caixa, endereco, produto_id, validadeNorm] })
  return { success: true, item_id: res.lastInsertRowid.toString(), status_item: 'Pendente', contagem_atual: 1 }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG DE AJUSTES
// ─────────────────────────────────────────────────────────────────────────────

export async function listarAjustesLog({ ciclo_id, inventario_id } = {}) {
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
  const { rows } = await db.execute({ sql, args: params })
  return rows
}
