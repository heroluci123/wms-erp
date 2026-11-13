import { db } from '../lib/db.js';
import { assertPermissao } from '../lib/authGuard.js';

/** Queries para Locais (Endereços Físicos) */

export async function listar() {
  await assertPermissao(['locais', 'movimentacao', 'recebimento', 'consulta_endereco', 'estoque_enderecos', 'inventario_coletor', 'inventario_gestao', 'retorno_producao', 'desmembramento'], { write: false, bloquearCliente: true });
  const res = await db.execute('SELECT * FROM locais WHERE ativo = 1 ORDER BY endereco ASC')
  return res.rows
}

export async function buscarPorEndereco(endereco) {
  await assertPermissao(['locais', 'movimentacao', 'recebimento', 'consulta_endereco', 'estoque_enderecos', 'inventario_coletor', 'inventario_gestao', 'retorno_producao', 'desmembramento'], { write: false, bloquearCliente: true });
  const res = await db.execute({
    sql: 'SELECT * FROM locais WHERE endereco = ? AND ativo = 1',
    args: [endereco]
  })
  return res.rows[0]
}

export async function criar({ endereco, capacidade_max_caixas, is_insumo = 0, tipo_armazenamento = 'SECO' }) {
  try {
    await assertPermissao('locais');
    const res = await db.execute({
      sql: 'INSERT INTO locais (endereco, capacidade_max_caixas, is_insumo, tipo_armazenamento) VALUES (?, ?, ?, ?)',
      args: [endereco.toUpperCase(), capacidade_max_caixas, is_insumo ? 1 : 0, tipo_armazenamento]
    })
    return { success: true, id: res.lastInsertRowid.toString() }
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return { success: false, error: 'Endereço já cadastrado.' }
    }
    return { success: false, error: err.message }
  }
}

export async function atualizar({ id, endereco, capacidade_max_caixas, is_insumo = 0, tipo_armazenamento = 'SECO' }) {
  try {
    await assertPermissao('locais');
    await db.execute({
      sql: 'UPDATE locais SET endereco = ?, capacidade_max_caixas = ?, is_insumo = ?, tipo_armazenamento = ? WHERE id = ?',
      args: [endereco.toUpperCase(), capacidade_max_caixas, is_insumo ? 1 : 0, tipo_armazenamento, id]
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
    await assertPermissao('locais');
    await db.execute({
      sql: 'UPDATE locais SET ativo = 0 WHERE id = ?',
      args: [id]
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
