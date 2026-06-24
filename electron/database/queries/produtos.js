/** Queries de Produtos */
function listar(db) {
  return db.prepare(`
    SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, created_at
    FROM produtos ORDER BY descricao ASC
  `).all()
}

function buscarPorCodigo(db, codigo) {
  // Remove zeros à esquerda para o código interno
  const codigoNorm = String(codigo).replace(/^0+/, '') || codigo
  // O EAN geralmente precisa dos zeros à esquerda intactos
  const codigoExato = String(codigo)
  
  return db.prepare(`
    SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo
    FROM produtos WHERE codigo = ? OR ean = ? OR codigo = ? OR ean = ?
  `).get(codigoNorm, codigoExato, codigoExato, codigoNorm)
}

function criar(db, { codigo, ean, descricao, valor_unitario = 0, tipo_produto = 'Materia Prima', status_curva = 'C', unidade = 'CX', grupo = '' }) {
  const codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null
  const eanVal = (ean && String(ean).trim() !== '') ? String(ean).trim() : null
  
  if (!codVal && !eanVal) {
    throw new Error('É necessário informar pelo menos o Código Interno ou o EAN.')
  }

  const stmt = db.prepare(`
    INSERT INTO produtos (codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  try {
    const result = stmt.run(codVal, eanVal, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo)
    return { id: result.lastInsertRowid, success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Já existe um produto com este Código ou EAN.' }
    }
    throw err
  }
}

function atualizar(db, { id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo }) {
  const codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null
  const eanVal = (ean && String(ean).trim() !== '') ? String(ean).trim() : null

  if (!codVal && !eanVal) {
    throw new Error('É necessário informar pelo menos o Código Interno ou o EAN.')
  }

  try {
    db.prepare(`
      UPDATE produtos SET codigo=?, ean=?, descricao=?, valor_unitario=?, tipo_produto=?, status_curva=?, unidade=?, grupo=?
      WHERE id=?
    `).run(codVal, eanVal, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, id)
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Já existe um outro produto com este Código ou EAN.' }
    }
    throw err
  }
}

function deletar(db, id) {
  // Verificar se tem estoque ativo
  const saldo = db.prepare(`SELECT SUM(qtd_caixas) as total FROM estoque_posicao WHERE produto_id = ?`).get(id)
  if (saldo && saldo.total > 0) {
    return { success: false, error: 'Produto possui saldo em estoque. Zere o saldo antes de excluir.' }
  }
  try {
    db.prepare(`DELETE FROM produtos WHERE id = ?`).run(id)
    return { success: true }
  } catch (err) {
    if (err.message.includes('FOREIGN KEY')) {
      return { success: false, error: 'Este produto possui histórico de movimentações ou inventários e não pode ser excluído. Em vez disso, remova seu estoque.' }
    }
    throw err
  }
}

module.exports = { listar, buscarPorCodigo, criar, atualizar, deletar }
