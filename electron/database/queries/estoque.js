/** Queries de Estoque e Posições */

// Listagem geral com JOIN em produtos, excluindo registros zerados
function listarGeral(db) {
  return db.prepare(`
    SELECT
      ep.id, ep.endereco, ep.lote, ep.validade,
      ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
      p.status_curva, p.valor_unitario, p.unidade, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.qtd_caixas > 0 OR ep.qtd_kg > 0
    ORDER BY ep.endereco, p.descricao, ep.validade
  `).all()
}

// Busca saldo de um produto em um endereço específico (apenas lotes com saldo > 0)
function buscarPorEnderecoProduto(db, endereco, produto_id) {
  return db.prepare(`
    SELECT
      ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg,
      p.descricao, p.codigo, p.status_curva, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = ? AND ep.produto_id = ?
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
    ORDER BY ep.validade ASC
  `).all(endereco, produto_id)
}

// Tudo em um endereço
function buscarPorEndereco(db, endereco) {
  return db.prepare(`
    SELECT
      ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg,
      p.id as produto_id, p.descricao, p.codigo, p.status_curva, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
    ORDER BY ep.validade ASC
  `).all(endereco)
}

// Sugestão de Putaway: endereços onde o produto já tem saldo (excluindo REC e EXPEDICAO)
function sugestaoPutaway(db, produto_id, lote) {
  return db.prepare(`
    SELECT endereco, lote, qtd_caixas, qtd_kg, validade
    FROM estoque_posicao
    WHERE produto_id = ?
      AND endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
      AND (qtd_caixas > 0 OR qtd_kg > 0)
    ORDER BY
      CASE WHEN lote = ? THEN 0 ELSE 1 END,
      qtd_caixas DESC
  `).all(produto_id, lote || '')
}

// Verificação FEFO: existem lotes mais antigos do mesmo produto?
// Retorna lotes com validade MENOR que a bipada (mais antigos que deveriam sair primeiro)
function verificarFEFO(db, produto_id, validade_bipada) {
  return db.prepare(`
    SELECT ep.endereco, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg
    FROM estoque_posicao ep
    WHERE ep.produto_id = ?
      AND ep.validade IS NOT NULL
      AND ep.validade < ?
      AND ep.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA')
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
    ORDER BY ep.validade ASC
  `).all(produto_id, validade_bipada)
}

// Listar área de expedição
function listarExpedicao(db) {
  return db.prepare(`
    SELECT
      ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.status_curva, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = 'EXPEDICAO'
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
    ORDER BY ep.updated_at DESC
  `).all()
}

// KPIs para o Dashboard
function calcularKPIs(db, filtros = {}) {
  const isEstritoInsumo = filtros.incluirInsumos === true
  const filterSQL = isEstritoInsumo ? " AND p.tipo_produto = 'Insumos'" : " AND p.tipo_produto != 'Insumos'";

  const totalSKUs = db.prepare(`SELECT COUNT(DISTINCT ep.produto_id) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`).get()
  const itensREC = db.prepare(`SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'REC' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`).get()
  const itensExpedicao = db.prepare(`SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'EXPEDICAO' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`).get()
  const inventariosAbertos = db.prepare(`SELECT COUNT(*) as v FROM inventarios WHERE status NOT IN ('Finalizado')`).get()
  
  const hoje = new Date()
  const em30dias = new Date(hoje)
  em30dias.setDate(hoje.getDate() + 30)
  const dataLimite = em30dias.toISOString().split('T')[0]
  const dataHoje = hoje.toISOString().split('T')[0]
  
  const vencendoBreve = db.prepare(`
    SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.validade IS NOT NULL
      AND ep.validade >= ? AND ep.validade <= ?
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}
  `).get(dataHoje, dataLimite)

  const vencidos = db.prepare(`
    SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.validade IS NOT NULL AND ep.validade < ?
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}
  `).get(dataHoje)

  return {
    totalSKUs: totalSKUs.v,
    itensREC: itensREC.v,
    itensExpedicao: itensExpedicao.v,
    inventariosAbertos: inventariosAbertos.v,
    vencendoBreve: vencendoBreve.v,
    vencidos: vencidos.v,
  }
}

module.exports = {
  listarGeral, buscarPorEnderecoProduto, buscarPorEndereco,
  sugestaoPutaway, verificarFEFO, listarExpedicao, calcularKPIs
}
