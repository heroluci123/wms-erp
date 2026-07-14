import { db } from '../lib/db.js';

/** Queries de Produtos */
export async function listar() {
  const res = await db.execute(`
    SELECT p.id, p.codigo, p.ean, p.descricao, p.valor_unitario, p.tipo_produto, p.status_curva, p.unidade, p.grupo, p.created_at, p.classificacao,
           GROUP_CONCAT(pai.id) as pais_ids, GROUP_CONCAT(pai.descricao, ', ') as pai_descricao
    FROM produtos p
    LEFT JOIN produto_arvore pa ON pa.filho_id = p.id
    LEFT JOIN produtos pai ON pai.id = pa.pai_id
    GROUP BY p.id
    ORDER BY p.descricao ASC
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
  // ATENÇÃO: Bloqueado para EANs longos reais (sem zeros à esquerda ≥ 14 dígitos).
  const codigoSemZeros = codigoStr.replace(/^0+/, '')
  if (codigoSemZeros.length >= 8 && codigoSemZeros.length < 14) {
    const ultimos6 = codigoSemZeros.slice(-6)
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

export async function criar({ codigo, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, classificacao, pais_ids }) {
  let codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null

  if (!codVal) {
    throw new Error('É obrigatório informar o Código Interno do Produto.')
  }

  try {
    const result = await db.execute({
      sql: `
        INSERT INTO produtos (codigo, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, classificacao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [codVal, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, classificacao || null]
    })
    
    const newId = result.lastInsertRowid.toString()
    
    if (classificacao === 'SUBPRODUTO' && Array.isArray(pais_ids) && pais_ids.length > 0) {
      for (const paiId of pais_ids) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO produto_arvore (pai_id, filho_id) VALUES (?, ?)`,
          args: [paiId, newId]
        })
      }
    }
    
    return { id: newId, success: true }
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return { success: false, error: 'Já existe um produto com este Código ou EAN.' }
    }
    throw err
  }
}

export async function atualizar({ id, codigo, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, classificacao, pais_ids }) {
  let codVal = (codigo && String(codigo).trim() !== '') ? String(codigo).trim() : null

  if (!codVal) {
    throw new Error('É obrigatório informar o Código Interno do Produto.')
  }

  try {
    await db.execute({
      sql: `
        UPDATE produtos SET codigo=?, descricao=?, valor_unitario=?, tipo_produto=?, status_curva=?, unidade=?, grupo=?, classificacao=?
        WHERE id=?
      `,
      args: [codVal, descricao, valor_unitario, tipo_produto, status_curva, unidade, grupo, classificacao || null, id]
    })

    // Atualizar Paternidade se for SUBPRODUTO
    await db.execute({ sql: `DELETE FROM produto_arvore WHERE filho_id = ?`, args: [id] })
    if (classificacao === 'SUBPRODUTO' && Array.isArray(pais_ids) && pais_ids.length > 0) {
      for (const paiId of pais_ids) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO produto_arvore (pai_id, filho_id) VALUES (?, ?)`,
          args: [paiId, id]
        })
      }
    }

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

export async function buscarHistoricoCaixa(ean) {
  const res = await db.execute({
    sql: `SELECT * FROM caixas_historico WHERE ean_caixa = ? ORDER BY data_hora ASC`,
    args: [ean]
  })
  return res.rows
}

export async function buscarCaixaPorEan(ean) {
  const res = await db.execute({
    sql: `SELECT c.*, p.descricao as produto_descricao, p.codigo as produto_codigo,
                 pl.codigo as palete_codigo
          FROM estoque_caixas c 
          JOIN produtos p ON c.produto_id = p.id 
          LEFT JOIN paletes pl ON c.palete_id = pl.id
          WHERE c.ean_caixa = ?`,
    args: [ean]
  })
  return res.rows.length > 0 ? res.rows[0] : null
}
