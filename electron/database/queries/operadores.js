/** Queries de Operadores/Usuários */

function autenticar(db, pin) {
  const operador = db.prepare(`
    SELECT id, nome, perfil, is_adm, permissoes FROM operadores WHERE pin = ? AND ativo = 1
  `).get(pin)
  
  if (!operador) return { success: false, error: 'PIN inválido ou operador inativo.' }
  
  // Fazer o parse das permissões
  try {
    operador.permissoes = JSON.parse(operador.permissoes || '{}')
  } catch (e) {
    operador.permissoes = {}
  }
  
  return { success: true, operador }
}

function listar(db) {
  const ops = db.prepare(`
    SELECT id, nome, perfil, is_adm, permissoes, ativo, created_at FROM operadores ORDER BY nome
  `).all()
  
  return ops.map(op => {
    try {
      op.permissoes = JSON.parse(op.permissoes || '{}')
    } catch(e) {
      op.permissoes = {}
    }
    return op
  })
}

function criar(db, { nome, pin, perfil = 'operador', is_adm = 0, permissoes = {} }) {
  try {
    const permissoesStr = JSON.stringify(permissoes)
    const result = db.prepare(`
      INSERT INTO operadores (nome, pin, perfil, is_adm, permissoes) VALUES (?, ?, ?, ?, ?)
    `).run(nome, pin, perfil, is_adm, permissoesStr)
    return { success: true, id: result.lastInsertRowid }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function desativar(db, id) {
  db.prepare(`UPDATE operadores SET ativo = 0 WHERE id = ?`).run(id)
  return { success: true }
}

function atualizar(db, { id, nome, pin, perfil, is_adm = 0, permissoes, ativo }) {
  try {
    const permissoesStr = JSON.stringify(permissoes || {})
    db.prepare(`
      UPDATE operadores SET nome = ?, pin = ?, perfil = ?, is_adm = ?, permissoes = ?, ativo = ? WHERE id = ?
    `).run(nome, pin, perfil, is_adm, permissoesStr, ativo, id)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = { autenticar, listar, criar, desativar, atualizar }
