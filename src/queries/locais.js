import { db } from '../lib/db.js';

/** Queries para Locais (Endereços Físicos) */

export async function listar() {
  const res = await db.execute('SELECT * FROM locais WHERE ativo = 1 ORDER BY endereco ASC')
  return res.rows
}

export async function buscarPorEndereco(endereco) {
  const res = await db.execute({
    sql: 'SELECT * FROM locais WHERE endereco = ? AND ativo = 1',
    args: [endereco]
  })
  return res.rows[0]
}

export async function criar({ endereco, capacidade_max_caixas, is_insumo = 0 }) {
  try {
    const res = await db.execute({
      sql: 'INSERT INTO locais (endereco, capacidade_max_caixas, is_insumo) VALUES (?, ?, ?)',
      args: [endereco.toUpperCase(), capacidade_max_caixas, is_insumo ? 1 : 0]
    })
    return { success: true, id: res.lastInsertRowid.toString() }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return { success: false, error: 'Endereço já cadastrado.' }
    }
    return { success: false, error: err.message }
  }
}

export async function atualizar({ id, endereco, capacidade_max_caixas, is_insumo = 0 }) {
  try {
    await db.execute({
      sql: 'UPDATE locais SET endereco = ?, capacidade_max_caixas = ?, is_insumo = ? WHERE id = ?',
      args: [endereco.toUpperCase(), capacidade_max_caixas, is_insumo ? 1 : 0, id]
    })
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return { success: false, error: 'Endereço já cadastrado.' }
    }
    return { success: false, error: err.message }
  }
}

export async function deletar(id) {
  try {
    await db.execute({
      sql: 'UPDATE locais SET ativo = 0 WHERE id = ?',
      args: [id]
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
