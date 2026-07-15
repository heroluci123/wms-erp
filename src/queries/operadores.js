import { db } from '../lib/db.js';

/** Queries de Operadores/Usuários */

export async function autenticar(pin) {
  const res = await db.execute({
    sql: 'SELECT id, nome, perfil, is_adm, permissoes FROM operadores WHERE pin = ? AND ativo = 1',
    args: [pin]
  })
  
  const operador = res.rows[0]
  if (!operador) return { success: false, error: 'PIN inválido ou operador inativo.' }
  
  // Fazer o parse das permissões
  try {
    operador.permissoes = JSON.parse(operador.permissoes || '{}')
  } catch (e) {
    operador.permissoes = {}
  }
  
  return { success: true, operador }
}

export async function listar() {
  const res = await db.execute('SELECT id, nome, pin, perfil, is_adm, permissoes, ativo, created_at FROM operadores ORDER BY nome')
  
  return res.rows.map(op => {
    try {
      op.permissoes = JSON.parse(op.permissoes || '{}')
    } catch(e) {
      op.permissoes = {}
    }
    return op
  })
}

export async function criar({ nome, pin, perfil = 'operador', is_adm = 0, permissoes = {} }) {
  try {
    const permissoesStr = JSON.stringify(permissoes)
    const result = await db.execute({
      sql: 'INSERT INTO operadores (nome, pin, perfil, is_adm, permissoes) VALUES (?, ?, ?, ?, ?)',
      args: [nome, pin, perfil, is_adm, permissoesStr]
    })
    return { success: true, id: result.lastInsertRowid.toString() }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function desativar(id) {
  await db.execute({
    sql: 'UPDATE operadores SET ativo = 0 WHERE id = ?',
    args: [id]
  })
  return { success: true }
}

export async function atualizar({ id, nome, pin, perfil, is_adm = 0, permissoes, ativo }) {
  try {
    const permissoesStr = JSON.stringify(permissoes || {})
    await db.execute({
      sql: 'UPDATE operadores SET nome = ?, pin = ?, perfil = ?, is_adm = ?, permissoes = ?, ativo = ? WHERE id = ?',
      args: [nome, pin, perfil, is_adm, permissoesStr, ativo, id]
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
