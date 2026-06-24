import { db } from '../lib/db.js';

/** Queries de Produtos */
export async function listar() {
  const res = await db.execute(`
    SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, created_at
    FROM produtos ORDER BY descricao ASC
  `)
  return res.rows
}

export async function buscarPorCodigo(codigo) {
  // Remove zeros à esquerda para o código interno
  const codigoNorm = String(codigo).replace(/^0+/, '') || codigo
  // O EAN geralmente precisa dos zeros à esquerda intactos
  const codigoExato = String(codigo)
  
  const res = await db.execute({
    sql: `
      SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo
      FROM produtos WHERE codigo = ? OR ean = ? OR codigo = ? OR ean = ?
    `,
    args: [codigoNorm, codigoExato, codigoExato, codigoNorm]
  })
  return res.rows[0]
}

export async function criar({ codigo, ean, descricao, valor_unitario = 0, tipo_produto = 'Materia Prima', status_curva = 'C', unidade = 'CX', grupo = '' }) {
  const codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null
  const eanVal = (ean && String(ean).trim() !== '') ? String(ean).trim() : null
  
  if (!codVal && !eanVal) {
    throw new Error('É necessário informar pelo menos o Código Interno ou o EAN.')
  }

  try {
    const result = await db.execute({
      sql: `
        INSERT INTO produtos (codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [codVal, eanVal, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo]
    })
    return { id: result.lastInsertRowid.toString(), success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Já existe um produto com este Código ou EAN.' }
    }
    throw err
  }
}

export async function atualizar({ id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo }) {
  const codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null
  const eanVal = (ean && String(ean).trim() !== '') ? String(ean).trim() : null

  if (!codVal && !eanVal) {
    throw new Error('É necessário informar pelo menos o Código Interno ou o EAN.')
  }

  try {
    await db.execute({
      sql: `
        UPDATE produtos SET codigo=?, ean=?, descricao=?, valor_unitario=?, tipo_produto=?, status_curva=?, unidade=?, grupo=?
        WHERE id=?
      `,
      args: [codVal, eanVal, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, id]
    })
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Já existe um outro produto com este Código ou EAN.' }
    }
    throw err
  }
}

export async function deletar(id) {
  // Verificar se tem estoque ativo
  const res = await db.execute({
    sql: `SELECT SUM(qtd_caixas) as total FROM estoque_posicao WHERE produto_id = ?`,
    args: [id]
  })
  const saldo = res.rows[0]
  if (saldo && saldo.total > 0) {
    return { success: false, error: 'Produto possui saldo em estoque. Zere o saldo antes de excluir.' }
  }
  try {
    await db.execute({
      sql: `DELETE FROM produtos WHERE id = ?`,
      args: [id]
    })
    return { success: true }
  } catch (err) {
    if (err.message.includes('FOREIGN KEY')) {
      return { success: false, error: 'Este produto possui histórico de movimentações ou inventários e não pode ser excluído. Em vez disso, remova seu estoque.' }
    }
    throw err
  }
}
