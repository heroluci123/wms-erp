import { db } from '../lib/db.js';

/** Queries de Produtos */
export async function listar() {
  const res = await db.execute(`
    SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, created_at
    FROM produtos ORDER BY descricao ASC
  `)
  return res.rows
}

/**
 * Busca sugestão automática de produto baseado em regras CONTEM já cadastradas.
 * Ex: EAN "0025584829004960" pode ser Filé de Costela se existir regra CONTEM com "004960".
 * Retorna { produto, regraUsada } ou null.
 */
export async function buscarSugestaoEan(codigo) {
  const codigoStr = String(codigo).trim()
  if (!codigoStr || codigoStr.length < 4) return null

  // Testa sufixos progressivos (últimos 4, 5, 6, 7, 8 dígitos) contra regras CONTEM
  const regrasRes = await db.execute({
    sql: `
      SELECT p.*, pe.codigo_barras as regra_usada
      FROM produtos_eans pe
      JOIN produtos p ON pe.produto_id = p.id
      WHERE pe.tipo_regra = 'CONTEM' AND ? LIKE '%' || pe.codigo_barras
      ORDER BY length(pe.codigo_barras) DESC
      LIMIT 1
    `,
    args: [codigoStr]
  })

  if (regrasRes.rows.length > 0) {
    const row = regrasRes.rows[0]
    return { produto: row, regraUsada: row.regra_usada }
  }
  return null
}


export async function buscarPorCodigo(codigo) {
  const codigoStr = String(codigo).trim()
  if (!codigoStr) return undefined

  // 1. Exact match attempts (normalizing zeros)
  const codigoNorm = codigoStr.replace(/^0+/, '') || codigoStr
  const codigoExato = codigoStr
  
  const res = await db.execute({
    sql: `
      SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo
      FROM produtos WHERE codigo = ? OR ean = ? OR codigo = ? OR ean = ?
    `,
    args: [codigoNorm, codigoExato, codigoExato, codigoNorm]
  })
  
  if (res.rows.length > 0) return res.rows[0]

  // 2. Busca nas Regras (produtos_eans)
  const regrasRes = await db.execute({
    sql: `
      SELECT p.*
      FROM produtos_eans pe
      JOIN produtos p ON pe.produto_id = p.id
      WHERE pe.codigo_barras = ?
         OR (pe.tipo_regra = 'CONTEM' AND ? LIKE '%' || pe.codigo_barras)
      ORDER BY pe.tipo_regra DESC LIMIT 1
    `,
    args: [codigoExato, codigoExato]
  })
  
  if (regrasRes.rows.length > 0) return regrasRes.rows[0]

  // 3. Extração Inteligente Legada (últimos 6 dígitos)
  // ATENÇÃO: Só aplica para EANs curtos (< 14 dígitos).
  // EANs longos (≥ 14 dígitos) são SSCCs/GTINs únicos por caixa e NUNCA devem ser
  // resolvidos por sufixo — isso causaria correspondências erradas (ex: sufixo 6115
  // de um EAN de Contra File acertando CARVÃO IPÊ 7KG que tem código 6115).
  if (codigoStr.length >= 8 && codigoStr.length < 14) {
    const ultimos6 = codigoStr.slice(-6)
    const ultimos6Norm = ultimos6.replace(/^0+/, '') || ultimos6
    
    const resExtraido = await db.execute({
      sql: `
        SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo
        FROM produtos WHERE codigo = ? OR ean = ? OR codigo = ? OR ean = ?
      `,
      args: [ultimos6, ultimos6, ultimos6Norm, ultimos6Norm]
    })
    
    if (resExtraido.rows.length > 0) return resExtraido.rows[0]
  }

  return undefined
}

/**
 * Igual ao buscarPorCodigo mas retorna também como o produto foi encontrado:
 * - eanUnico: true = o codigo bipado é único dessa caixa (match direto no EAN/codigo do produto)
 * - eanUnico: false = foi encontrado via regra genérica (CONTEM/EXATO via produtos_eans)
 *   Neste caso, o EAN bipado é genérico e NÃO deve ser usado como chave única de caixa.
 */
export async function buscarPorCodigoComInfo(codigo) {
  const codigoStr = String(codigo).trim()
  if (!codigoStr) return undefined

  const codigoNorm = codigoStr.replace(/^0+/, '') || codigoStr
  const codigoExato = codigoStr

  // 1. Match direto no campo codigo ou ean do produto = EAN único
  const res = await db.execute({
    sql: `SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo FROM produtos WHERE codigo = ? OR ean = ? OR codigo = ? OR ean = ?`,
    args: [codigoNorm, codigoExato, codigoExato, codigoNorm]
  })
  if (res.rows.length > 0) return { produto: res.rows[0], eanUnico: true }

  // 2. Match via regra (CONTEM ou EXATO em produtos_eans) = EAN genérico
  const regrasRes = await db.execute({
    sql: `SELECT p.* FROM produtos_eans pe JOIN produtos p ON pe.produto_id = p.id WHERE pe.codigo_barras = ? OR (pe.tipo_regra = 'CONTEM' AND ? LIKE '%' || pe.codigo_barras) ORDER BY pe.tipo_regra DESC LIMIT 1`,
    args: [codigoExato, codigoExato]
  })
  if (regrasRes.rows.length > 0) return { produto: regrasRes.rows[0], eanUnico: false }

  // 3. Extração legada (últimos 6 dígitos) = genérico
  // ATENÇÃO: Bloqueado para EANs longos (≥ 14 dígitos) — SSCCs/GTINs de caixas são
  // únicos e o sufixo pode coincidir com o código de um produto completamente diferente.
  if (codigoStr.length >= 8 && codigoStr.length < 14) {
    const ultimos6 = codigoStr.slice(-6)
    const ultimos6Norm = ultimos6.replace(/^0+/, '') || ultimos6
    const resExtraido = await db.execute({
      sql: `SELECT id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo FROM produtos WHERE codigo = ? OR ean = ? OR codigo = ? OR ean = ?`,
      args: [ultimos6, ultimos6, ultimos6Norm, ultimos6Norm]
    })
    if (resExtraido.rows.length > 0) return { produto: resExtraido.rows[0], eanUnico: false }
  }

  return undefined
}

export async function salvarRegraEan(produto_id, codigo_barras, tipo_regra = 'EXATO') {
  try {
    await db.execute({
      sql: `INSERT INTO produtos_eans (produto_id, codigo_barras, tipo_regra) VALUES (?, ?, ?)`,
      args: [produto_id, codigo_barras.trim(), tipo_regra]
    })
    return { success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Esta regra ou EAN já está vinculada a outro produto.' }
    }
    return { success: false, error: err.message }
  }
}

export async function listarRegras(produto_id) {
  const res = await db.execute({
    sql: `SELECT * FROM produtos_eans WHERE produto_id = ? ORDER BY created_at DESC`,
    args: [produto_id]
  })
  return res.rows
}

export async function removerRegraEan(id) {
  try {
    await db.execute({ sql: `DELETE FROM produtos_eans WHERE id = ?`, args: [id] })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function criar({ codigo, ean, descricao, valor_unitario = 0, tipo_produto = 'Materia Prima', status_curva = 'C', unidade = 'CX', grupo = '' }) {
  let codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null
  let eanVal = (ean && String(ean).trim() !== '') ? String(ean).trim() : null

  if (eanVal && eanVal.length >= 15) {
    if (!codVal) {
      const u6 = eanVal.slice(-6)
      codVal = u6.replace(/^0+/, '') || u6
    }
    eanVal = null
  }
  if (codVal && codVal.length >= 15) {
    const u6 = codVal.slice(-6)
    codVal = u6.replace(/^0+/, '') || u6
  }
  
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
  let codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null
  let eanVal = (ean && String(ean).trim() !== '') ? String(ean).trim() : null

  if (eanVal && eanVal.length >= 15) {
    if (!codVal) {
      const u6 = eanVal.slice(-6)
      codVal = u6.replace(/^0+/, '') || u6
    }
    eanVal = null
  }
  if (codVal && codVal.length >= 15) {
    const u6 = codVal.slice(-6)
    codVal = u6.replace(/^0+/, '') || u6
  }

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
