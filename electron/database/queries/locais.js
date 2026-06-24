/** Queries para Locais (Endereços Físicos) */

function listar(db) {
  return db.prepare('SELECT * FROM locais WHERE ativo = 1 ORDER BY endereco ASC').all()
}

function buscarPorEndereco(db, endereco) {
  return db.prepare('SELECT * FROM locais WHERE endereco = ? AND ativo = 1').get(endereco)
}

function criar(db, { endereco, capacidade_max_caixas, is_insumo = 0 }) {
  try {
    const res = db.prepare(`
      INSERT INTO locais (endereco, capacidade_max_caixas, is_insumo) VALUES (?, ?, ?)
    `).run(endereco.toUpperCase(), capacidade_max_caixas, is_insumo ? 1 : 0)
    return { success: true, id: res.lastInsertRowid }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return { success: false, error: 'Endereço já cadastrado.' }
    }
    return { success: false, error: err.message }
  }
}

function atualizar(db, { id, endereco, capacidade_max_caixas, is_insumo = 0 }) {
  try {
    db.prepare(`
      UPDATE locais SET endereco = ?, capacidade_max_caixas = ?, is_insumo = ? WHERE id = ?
    `).run(endereco.toUpperCase(), capacidade_max_caixas, is_insumo ? 1 : 0, id)
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return { success: false, error: 'Endereço já cadastrado.' }
    }
    return { success: false, error: err.message }
  }
}

function deletar(db, id) {
  try {
    db.prepare('UPDATE locais SET ativo = 0 WHERE id = ?').run(id)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = { listar, buscarPorEndereco, criar, atualizar, deletar }
