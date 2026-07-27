import { db } from '../lib/db.js'

/**
 * Query para Estoque Mínimo Dinâmico
 * Calcula o consumo médio dos últimos N dias a partir de:
 * 1. Consumo em Ordens de Produção (op_insumos)
 * 2. Saídas e Expedições (movimentacoes_log onde tipo = 'EXPEDICAO' ou 'SAIDA')
 *
 * Mapeia consumo de produtos filhos/derivados para o produto Pai (Matéria-Prima).
 */
export async function buscarEstoqueMinimoDinamico({
  diasAnalise = 15,
  leadTimePadrao = 5,
  margemSegurancaPct = 20
} = {}) {
  // 1. Buscar todas as matérias-primas e insumos (produtos Pai ou sem pai com tipo Materia Prima / Insumos)
  const { rows: todosProdutos } = await db.execute({
    sql: `
    SELECT id, codigo, ean, descricao, tipo_produto, grupo, status_curva, unidade, valor_unitario, produto_pai_id
    FROM produtos
    ORDER BY descricao
  `, args: []
  })

  // Mapeamento: se produto tem produto_pai_id, seu pai é ele. Se tem produto_arvore, mapeia também.
  const { rows: arvoreRows } = await db.execute({
    sql: `SELECT pai_id, filho_id FROM produto_arvore`,
    args: []
  })

  // Criar mapa de filho -> pai
  const filhoParaPai = {}

  // Mapear por produto_pai_id
  todosProdutos.forEach(p => {
    if (p.produto_pai_id) {
      filhoParaPai[p.id] = p.produto_pai_id
    }
  })

  // Mapear por produto_arvore (socreve ou reforça)
  arvoreRows.forEach(a => {
    filhoParaPai[a.filho_id] = a.pai_id
  })

  // Identificar quais produtos são considerados "PAIS" / Matéria-Prima Principal
  // São os produtos que NÃO são filhos de ninguém e que pertencem a tipo_produto != 'Produto Acabado'
  const paisMap = {}
  todosProdutos.forEach(p => {
    const isFilho = !!filhoParaPai[p.id]
    const isAcabado = p.tipo_produto === 'Produto Acabado'

    if (!isFilho && !isAcabado) {
      paisMap[p.id] = {
        ...p,
        estoque_caixas: 0,
        estoque_kg: 0,
        consumo_total_kg: 0,
        consumo_diario_kg: 0,
        estoque_minimo_kg: 0,
        dias_cobertura: 999,
        sugestao_compra_kg: 0,
        status: 'OK', // OK | ALERTA | CRITICO
        detalhamento: [] // Fontes de consumo
      }
    }
  })

  // Se houver algum produto que é filho, mas o pai não está no paisMap, tentar resolver a cadeia do pai
  const encontrarPaiId = (prodId) => {
    let atual = prodId
    let depth = 0
    while (filhoParaPai[atual] && depth < 5) {
      atual = filhoParaPai[atual]
      depth++
    }
    return atual
  }

  // 2. Buscar Estoque Atual em estoque_caixas por produto
  const { rows: caixasEstoque } = await db.execute({
    sql: `
    SELECT produto_id, COUNT(*) as cxs, SUM(peso_kg) as kg
    FROM estoque_caixas
    WHERE status IN ('DISPONIVEL', 'RESERVADA', 'BLOQUEADO')
    GROUP BY produto_id
  `, args: []
  })

  // Somar estoque no Pai correspondente
  caixasEstoque.forEach(c => {
    const paiId = encontrarPaiId(c.produto_id)
    if (paisMap[paiId]) {
      paisMap[paiId].estoque_caixas += (c.cxs || 0)
      paisMap[paiId].estoque_kg += (c.kg || 0)
    }
  })

  // Se não houver caixas serializadas para algum pai, verificar estoque_posicao como fallback
  const { rows: posicaoEstoque } = await db.execute({
    sql: `
    SELECT produto_id, SUM(qtd_caixas) as cxs, SUM(qtd_kg) as kg
    FROM estoque_posicao
    WHERE endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
    GROUP BY produto_id
  `, args: []
  })

  posicaoEstoque.forEach(p => {
    const paiId = encontrarPaiId(p.produto_id)
    if (paisMap[paiId] && paisMap[paiId].estoque_kg === 0 && p.kg > 0) {
      paisMap[paiId].estoque_caixas = p.cxs || 0
      paisMap[paiId].estoque_kg = p.kg || 0
    }
  })

  // 3. Buscar Consumo em Ordens de Produção (op_insumos) nos últimos N dias
  const dataLimiteSQL = `datetime('now', '-${diasAnalise} days')`

  const { rows: consumoOP } = await db.execute({
    sql: `
    SELECT i.produto_id, SUM(i.peso_kg) as total_kg, COUNT(*) as qtd_baixas, p.descricao as prod_nome, p.tipo_produto
    FROM op_insumos i
    JOIN produtos p ON p.id = i.produto_id
    WHERE i.created_at >= datetime('now', '-${parseInt(diasAnalise)} days')
    GROUP BY i.produto_id
  `, args: []
  })

  consumoOP.forEach(op => {
    const paiId = encontrarPaiId(op.produto_id)
    if (paisMap[paiId]) {
      paisMap[paiId].consumo_total_kg += (op.total_kg || 0)

      // Registrar no detalhamento do pai
      const detalheExistente = paisMap[paiId].detalhamento.find(d => d.produto_id === op.produto_id && d.origem === 'OP')
      if (detalheExistente) {
        detalheExistente.kg += op.total_kg
      } else {
        paisMap[paiId].detalhamento.push({
          produto_id: op.produto_id,
          descricao: op.prod_nome,
          tipo_produto: op.tipo_produto,
          origem: 'Baixa em Ordem de Produção (OP)',
          kg: op.total_kg
        })
      }
    }
  })

  // 4. Buscar Saídas e Expedições (movimentacoes_log) nos últimos N dias
  const { rows: consumoSaidas } = await db.execute({
    sql: `
    SELECT m.produto_id, SUM(m.qtd_kg) as total_kg, p.descricao as prod_nome, p.tipo_produto
    FROM movimentacoes_log m
    JOIN produtos p ON p.id = m.produto_id
    WHERE m.tipo IN ('EXPEDICAO', 'SAIDA')
      AND m.data_hora >= datetime('now', '-${parseInt(diasAnalise)} days')
    GROUP BY m.produto_id
  `, args: []
  })

  consumoSaidas.forEach(s => {
    const paiId = encontrarPaiId(s.produto_id)
    if (paisMap[paiId]) {
      paisMap[paiId].consumo_total_kg += (s.total_kg || 0)

      const detalheExistente = paisMap[paiId].detalhamento.find(d => d.produto_id === s.produto_id && d.origem === 'SAIDA')
      if (detalheExistente) {
        detalheExistente.kg += s.total_kg
      } else {
        paisMap[paiId].detalhamento.push({
          produto_id: s.produto_id,
          descricao: s.prod_nome,
          tipo_produto: s.tipo_produto,
          origem: 'Saída / Expedição',
          kg: s.total_kg
        })
      }
    }
  })

  // 5. Realizar Cálculos Dinâmicos por Produto Pai
  const listaPais = Object.values(paisMap).map(p => {
    const consumoDiario = p.consumo_total_kg / Math.max(1, diasAnalise)
    const estoqueMinimo = consumoDiario * leadTimePadrao * (1 + margemSegurancaPct / 100)
    const diasCobertura = consumoDiario > 0 ? (p.estoque_kg / consumoDiario) : (p.estoque_kg > 0 ? 999 : 0)
    const sugestaoCompra = Math.max(0, estoqueMinimo - p.estoque_kg)

    let status = 'OK'
    if (p.estoque_kg < estoqueMinimo) {
      status = 'CRITICO'
    } else if (p.estoque_kg < estoqueMinimo * 1.25) {
      status = 'ALERTA'
    }

    return {
      ...p,
      consumo_diario_kg: Math.round(consumoDiario * 100) / 100,
      estoque_minimo_kg: Math.round(estoqueMinimo * 100) / 100,
      dias_cobertura: Math.round(diasCobertura * 10) / 10,
      sugestao_compra_kg: Math.round(sugestaoCompra * 100) / 100,
      status
    }
  })

  // Ordenar: primeiro os CRITICOS, depois ALERTA, depois OK (e por maior consumo)
  const ordemStatus = { 'CRITICO': 0, 'ALERTA': 1, 'OK': 2 }
  listaPais.sort((a, b) => {
    if (ordemStatus[a.status] !== ordemStatus[b.status]) {
      return ordemStatus[a.status] - ordemStatus[b.status]
    }
    return b.consumo_diario_kg - a.consumo_diario_kg
  })

  // 6. Consolidar KPIs gerais
  const totalCriticos = listaPais.filter(p => p.status === 'CRITICO').length
  const totalAlertas = listaPais.filter(p => p.status === 'ALERTA').length
  const totalOk = listaPais.filter(p => p.status === 'OK').length
  const totalSugestaoCompraKg = Math.round(listaPais.reduce((acc, p) => acc + p.sugestao_compra_kg, 0) * 100) / 100

  return {
    kpis: {
      totalCriticos,
      totalAlertas,
      totalOk,
      totalSugestaoCompraKg,
      totalMatériasPrimas: listaPais.length
    },
    parametros: {
      diasAnalise,
      leadTimePadrao,
      margemSegurancaPct
    },
    itens: listaPais
  }
}
