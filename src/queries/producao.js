import { db } from '../lib/db.js'
import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient.js'
import { ensureRastreabilidadeSchema, tarasQueries } from './taras.js'
import { recalcularPosicaoEnderecos } from './movimentacoes.js'
import { calcularPesoLiquido, gerarLotePorData, hojeIsoLocal } from '../utils/rastreabilidade.js'
import { assertPermissao } from '../lib/authGuard.js'
import { isCliente } from '../utils/permissoes.js'

export async function listarOPs(status = 'TODAS') {
  if (isApiEnabled()) {
    return (await apiRequest(`/api/ops${buildQueryString({ status })}`)).data
  }
  await assertPermissao(['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op', 'relatorios_producao', 'reimpressao'], { write: false, bloquearCliente: true })
  await ensureRastreabilidadeSchema()
  let query = `
    SELECT 
      op.*,
      COALESCE(op.data_producao, DATE(op.created_at)) AS data_producao,
      COALESCE((SELECT SUM(peso_kg) FROM op_insumos WHERE op_id = op.id), 0) AS peso_insumos,
      COALESCE((SELECT COUNT(*) FROM op_insumos WHERE op_id = op.id), 0) AS qtd_insumos,
      COALESCE((SELECT SUM(peso_kg) FROM op_retornos WHERE op_id = op.id), 0) AS peso_retornos,
      COALESCE((SELECT COUNT(*) FROM op_retornos WHERE op_id = op.id), 0) AS qtd_retornos,
      COALESCE((SELECT COUNT(*) FROM op_itens_previstos WHERE op_id = op.id AND tipo = 'ENTRADA'), 0) AS qtd_prev_entrada,
      COALESCE((SELECT COUNT(*) FROM op_itens_previstos WHERE op_id = op.id AND tipo = 'SAIDA'), 0) AS qtd_prev_saida
    FROM ordens_producao op
  `
  const args = []

  if (status === 'ATIVAS') {
    query += ` WHERE op.status IN ('RASCUNHO', 'LIBERADA', 'ABERTA')`
  } else if (status === 'EXECUTAVEIS') {
    query += ` WHERE op.status IN ('LIBERADA', 'ABERTA')`
  } else if (status === 'ABERTA') {
    query += ` WHERE op.status IN ('LIBERADA', 'ABERTA')`
  } else if (status !== 'TODAS') {
    query += ` WHERE op.status = ?`
    args.push(status)
  }

  query += ` ORDER BY op.id DESC`

  const res = await db.execute({ sql: query, args })
  return res.rows
}

export async function criarOP(arg1, operador_id_legacy, operador_nome_legacy) {
  if (isApiEnabled()) {
    const p = typeof arg1 === 'object' && arg1 !== null
      ? arg1
      : { nome: arg1, operador_id: operador_id_legacy, operador_nome: operador_nome_legacy }
    try {
      const res = await apiRequest('/api/ops', {
        method: 'POST',
        body: {
          nome: p.nome || 'OP Sem Nome',
          data_producao: p.data_producao || hojeIsoLocal(),
          cliente: p.cliente || 'INTERNO',
          endereco: p.endereco || 'PRODUCAO',
          observacoes: p.observacoes || '',
          status: p.liberarAgora === false ? 'RASCUNHO' : 'LIBERADA',
          itensPrevistos: (p.itensPrevistos || []).filter((it) => it?.produto_id),
        },
      })
      return { success: true, op: { id: res.id, codigo: res.codigo, nome: p.nome, status: res.status } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  await assertPermissao('producao_criar_op')
  await ensureRastreabilidadeSchema()

  const payload = typeof arg1 === 'object' && arg1 !== null
    ? arg1
    : { nome: arg1, operador_id: operador_id_legacy, operador_nome: operador_nome_legacy }

  const {
    nome = 'OP Sem Nome',
    data_producao = hojeIsoLocal(),
    cliente = 'INTERNO',
    endereco = 'PRODUCAO',
    observacoes = '',
    itensPrevistos = [],
    liberarAgora = true,
    operador_id = null,
    operador_nome = 'Administrador',
  } = payload

  const resMax = await db.execute("SELECT MAX(CAST(SUBSTR(codigo, 4) AS INTEGER)) AS max_num FROM ordens_producao WHERE codigo LIKE 'OP-%'")
  const maxNum = Number(resMax.rows[0]?.max_num || 0)
  const codigo = `OP-${String(maxNum + 1).padStart(4, '0')}`
  const statusInicial = liberarAgora ? 'LIBERADA' : 'RASCUNHO'

  const tx = await db.transaction('write')
  try {
    const res = await tx.execute({
      sql: `
        INSERT INTO ordens_producao (
          codigo, nome, status, operador_id, operador_nome,
          criado_por_id, criado_por_nome, data_producao, cliente, endereco, observacoes,
          liberada_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${liberarAgora ? 'CURRENT_TIMESTAMP' : 'NULL'})
        RETURNING id, codigo, nome, status, data_producao
      `,
      args: [
        codigo,
        String(nome || 'OP Sem Nome').trim(),
        statusInicial,
        operador_id || null,
        operador_nome || 'Administrador',
        operador_id || null,
        operador_nome || 'Administrador',
        data_producao || hojeIsoLocal(),
        cliente || 'INTERNO',
        endereco || 'PRODUCAO',
        String(observacoes || '').trim(),
      ],
    })

    const opCriada = res.rows[0]

    for (const item of itensPrevistos || []) {
      if (!item?.produto_id) continue
      const unidade = item.unidade_prevista === 'CX' || (!item.peso_kg_previsto && item.qtd_caixas_prevista) ? 'CX' : 'KG'
      await tx.execute({
        sql: `
          INSERT INTO op_itens_previstos (op_id, tipo, produto_id, qtd_caixas_prevista, peso_kg_previsto, unidade_prevista, observacao)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          opCriada.id,
          item.tipo === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
          Number(item.produto_id),
          item.qtd_caixas_prevista ? Number(item.qtd_caixas_prevista) : null,
          item.peso_kg_previsto ? Number(item.peso_kg_previsto) : null,
          unidade,
          String(item.observacao || '').trim(),
        ],
      })
    }

    await tx.commit()
    return { success: true, op: opCriada }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

export async function atualizarOPConfig(op_id, { nome, data_producao, observacoes = '', status, itensPrevistos = [] }) {
  if (isApiEnabled()) {
    try {
      return await apiRequest(`/api/ops/${op_id}`, {
        method: 'PUT',
        body: { nome, data_producao, observacoes, status, itensPrevistos },
      })
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  await assertPermissao('producao_criar_op')
  await ensureRastreabilidadeSchema()
  const tx = await db.transaction('write')
  try {
    const { rows: currRows } = await tx.execute({ sql: `SELECT * FROM ordens_producao WHERE id = ?`, args: [op_id] })
    const curr = currRows[0]
    if (!curr) throw new Error('Ordem de Produção não encontrada.')
    if (curr.status === 'FECHADA') throw new Error('OP já finalizada. Reabra antes de alterar a configuração.')

    const nextStatus = status || curr.status
    await tx.execute({
      sql: `
        UPDATE ordens_producao
        SET nome = ?,
            data_producao = ?,
            observacoes = ?,
            status = ?,
            liberada_em = CASE WHEN ? = 'LIBERADA' AND liberada_em IS NULL THEN CURRENT_TIMESTAMP ELSE liberada_em END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [
        String(nome || curr.nome).trim(),
        data_producao || curr.data_producao || hojeIsoLocal(),
        String(observacoes || '').trim(),
        nextStatus,
        nextStatus,
        op_id,
      ],
    })

    await tx.execute({ sql: `DELETE FROM op_itens_previstos WHERE op_id = ?`, args: [op_id] })

    for (const item of itensPrevistos || []) {
      if (!item?.produto_id) continue
      const unidade = item.unidade_prevista === 'CX' || (!item.peso_kg_previsto && item.qtd_caixas_prevista) ? 'CX' : 'KG'
      await tx.execute({
        sql: `
          INSERT INTO op_itens_previstos (op_id, tipo, produto_id, qtd_caixas_prevista, peso_kg_previsto, unidade_prevista, observacao)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          op_id,
          item.tipo === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
          Number(item.produto_id),
          item.qtd_caixas_prevista ? Number(item.qtd_caixas_prevista) : null,
          item.peso_kg_previsto ? Number(item.peso_kg_previsto) : null,
          unidade,
          String(item.observacao || '').trim(),
        ],
      })
    }

    await tx.commit()
    return { success: true }
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }
}

export async function liberarOP(op_id) {
  if (isApiEnabled()) {
    return apiRequest(`/api/ops/${op_id}/liberar`, { method: 'POST' })
  }
  await assertPermissao('producao_criar_op')
  await ensureRastreabilidadeSchema()
  await db.execute({
    sql: `UPDATE ordens_producao SET status = 'LIBERADA', liberada_em = COALESCE(liberada_em, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [op_id],
  })
  return { success: true }
}

export async function listarProdutosComSaldoOP() {
  if (isApiEnabled()) {
    return (await apiRequest('/api/ops/produtos-saldo')).data
  }
  await assertPermissao(
    ['producao_criar_op', 'retorno_producao', 'producao_entrada', 'producao_saida'],
    { write: false, bloquearCliente: true }
  )
  await ensureRastreabilidadeSchema()

  const res = await db.execute(`
    SELECT
      p.*,
      COALESCE(ec.saldo_kg, 0) AS saldo_kg,
      COALESCE(ec.qtd_caixas, 0) AS qtd_caixas,
      COALESCE(ec.peso_medio_disp, hist.peso_medio_hist, 0) AS peso_medio_cx
    FROM produtos p
    LEFT JOIN (
      SELECT
        produto_id,
        COALESCE(SUM(peso_kg), 0) AS saldo_kg,
        COUNT(*) AS qtd_caixas,
        AVG(peso_kg) AS peso_medio_disp
      FROM estoque_caixas
      WHERE status = 'DISPONIVEL'
      GROUP BY produto_id
    ) ec ON ec.produto_id = p.id
    LEFT JOIN (
      SELECT
        produto_id,
        AVG(peso_kg) AS peso_medio_hist
      FROM estoque_caixas
      WHERE peso_kg > 0
      GROUP BY produto_id
    ) hist ON hist.produto_id = p.id
    ORDER BY
      CASE WHEN COALESCE(ec.saldo_kg, 0) > 0 OR COALESCE(ec.qtd_caixas, 0) > 0 THEN 0 ELSE 1 END ASC,
      p.descricao ASC
  `)

  return res.rows.map(r => ({
    ...r,
    saldo_kg: Number(r.saldo_kg || 0),
    qtd_caixas: Number(r.qtd_caixas || 0),
    peso_medio_cx: Number(r.peso_medio_cx || 0),
  }))
}

export async function detalhesOP(op_id) {
  if (isApiEnabled()) {
    try {
      return (await apiRequest(`/api/ops/${op_id}`)).data
    } catch {
      return null
    }
  }
  await assertPermissao(['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op', 'relatorios_producao'], { write: false, bloquearCliente: true })
  await ensureRastreabilidadeSchema()
  const opRes = await db.execute({ sql: `SELECT * FROM ordens_producao WHERE id = ?`, args: [op_id] })
  if (opRes.rows.length === 0) return null
  const op = opRes.rows[0]

  const [prevRes, insumosRes, retornosRes] = await Promise.all([
    db.execute({
      sql: `
        SELECT ip.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao, p.unidade
        FROM op_itens_previstos ip
        JOIN produtos p ON p.id = ip.produto_id
        WHERE ip.op_id = ?
        ORDER BY ip.tipo ASC, ip.id ASC
      `,
      args: [op_id],
    }),
    db.execute({
      sql: `
        SELECT
          oi.*,
          c.ean_caixa,
          c.validade,
          COALESCE(NULLIF(oi.lote, ''), c.lote, '') AS lote,
          COALESCE(oi.data_producao, c.data_producao) AS data_producao,
          COALESCE(oi.peso_bruto_kg, c.peso_bruto_kg, oi.peso_kg + COALESCE(oi.tara_kg, c.tara_kg, 0)) AS peso_bruto_kg,
          COALESCE(oi.tara_kg, c.tara_kg, 0) AS tara_kg,
          COALESCE(oi.qtd_pecas, c.qtd_pecas) AS qtd_pecas,
          p.descricao AS produto_descricao,
          p.codigo AS produto_codigo
        FROM op_insumos oi
        JOIN estoque_caixas c ON c.id = oi.caixa_id
        JOIN produtos p ON p.id = oi.produto_id
        WHERE oi.op_id = ?
        ORDER BY oi.id DESC
      `,
      args: [op_id],
    }),
    db.execute({
      sql: `
        SELECT
          oret.*,
          c.ean_caixa,
          COALESCE(oret.validade, c.validade) AS validade,
          COALESCE(NULLIF(oret.lote, ''), c.lote, '') AS lote,
          COALESCE(oret.data_producao, c.data_producao) AS data_producao,
          COALESCE(oret.peso_bruto_kg, c.peso_bruto_kg, oret.peso_kg + COALESCE(oret.tara_kg, c.tara_kg, 0)) AS peso_bruto_kg,
          COALESCE(oret.tara_kg, c.tara_kg, 0) AS tara_kg,
          COALESCE(oret.qtd_pecas, c.qtd_pecas) AS qtd_pecas,
          t.nome AS tara_nome,
          p.descricao AS produto_descricao,
          p.codigo AS produto_codigo
        FROM op_retornos oret
        JOIN estoque_caixas c ON c.id = oret.caixa_id
        JOIN produtos p ON p.id = oret.produto_id
        LEFT JOIN taras t ON t.id = COALESCE(oret.tara_id, c.tara_id)
        WHERE oret.op_id = ?
        ORDER BY oret.id DESC
      `,
      args: [op_id],
    }),
  ])

  const previstosEntrada = prevRes.rows.filter(r => r.tipo === 'ENTRADA')
  const previstosSaida = prevRes.rows.filter(r => r.tipo === 'SAIDA')

  return {
    ...op,
    data_producao: op.data_producao || (op.created_at ? String(op.created_at).slice(0, 10) : hojeIsoLocal()),
    previstos_entrada: previstosEntrada,
    previstos_saida: previstosSaida,
    insumos: insumosRes.rows,
    retornos: retornosRes.rows,
    peso_insumos: insumosRes.rows.reduce((sum, i) => sum + (Number(i.peso_kg) || 0), 0),
    peso_retornos: retornosRes.rows.reduce((sum, r) => sum + (Number(r.peso_kg) || 0), 0),
    peso_retornos_bruto: retornosRes.rows.reduce((sum, r) => sum + (Number(r.peso_bruto_kg) || 0), 0),
  }
}

export async function buscarCaixaPorEanParaOP(ean) {
  if (isApiEnabled()) {
    const clean = String(ean || '').trim()
    if (!clean) return { valid: false, error: 'Informe ou bipe o EAN da caixa.' }
    try {
      const c = (await apiRequest(`/api/estoque/caixa/${encodeURIComponent(clean)}`)).data
      if (!c) return { valid: false, error: `Caixa "${clean}" não encontrada.` }
      if (c.status !== 'DISPONIVEL') return { valid: false, error: `Caixa está com status ${c.status}.` }
      return {
        valid: true,
        caixa: {
          ...c,
          endereco: c.endereco || c.palete_endereco || 'REC',
          lote: c.lote || (c.data_producao ? gerarLotePorData(c.data_producao) : ''),
          tara_kg: Number(c.tara_kg || 0),
          peso_bruto_kg: c.peso_bruto_kg != null ? Number(c.peso_bruto_kg) : Number((Number(c.peso_kg || 0) + Number(c.tara_kg || 0)).toFixed(3)),
        },
      }
    } catch (err) {
      return { valid: false, error: err.message }
    }
  }
  await assertPermissao(['producao_entrada', 'retorno_producao'], { write: false, bloquearCliente: true })
  await ensureRastreabilidadeSchema()
  const clean = String(ean || '').trim()
  if (!clean) return { valid: false, error: 'Informe ou bipe o EAN da caixa.' }

  const { rows } = await db.execute({
    sql: `
      SELECT
        ec.*,
        p.codigo AS produto_codigo,
        p.descricao AS produto_descricao,
        pal.endereco_atual AS palete_endereco,
        t.nome AS tara_nome
      FROM estoque_caixas ec
      JOIN produtos p ON p.id = ec.produto_id
      LEFT JOIN paletes pal ON pal.id = ec.palete_id
      LEFT JOIN taras t ON t.id = ec.tara_id
      WHERE ec.ean_caixa = ?
      LIMIT 1
    `,
    args: [clean],
  })

  if (rows.length === 0) return { valid: false, error: `Caixa com EAN "${clean}" não encontrada no estoque.` }
  const c = rows[0]
  if (c.status !== 'DISPONIVEL') {
    return { valid: false, error: `Caixa não está DISPONÍVEL para entrada na OP (Status atual: ${c.status}).` }
  }

  return {
    valid: true,
    caixa: {
      ...c,
      endereco: c.endereco || c.palete_endereco || 'REC',
      lote: c.lote || (c.data_producao ? gerarLotePorData(c.data_producao) : ''),
      tara_kg: Number(c.tara_kg || 0),
      peso_bruto_kg: c.peso_bruto_kg != null ? Number(c.peso_bruto_kg) : Number((Number(c.peso_kg || 0) + Number(c.tara_kg || 0)).toFixed(3)),
    },
  }
}

export async function alocarInsumos(op_id, caixas, operador_id, operador_nome) {
  if (isApiEnabled()) {
    try {
      for (const c of caixas || []) {
        const res = await apiRequest(`/api/ops/${op_id}/entrar-caixa`, {
          method: 'POST',
          body: { ean: c.ean_caixa, forcarConfirmacao: true },
        })
        if (!res.success) return res
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  await assertPermissao(['producao_entrada', 'retorno_producao'])
  await ensureRastreabilidadeSchema()
  try {
    const opRes = await db.execute({ sql: `SELECT codigo, status FROM ordens_producao WHERE id = ?`, args: [op_id] })
    if (opRes.rows.length === 0) return { success: false, error: 'Ordem de Produção não encontrada.' }
    const opCodigo = opRes.rows[0].codigo || 'PRODUCAO'
    if (!['LIBERADA', 'ABERTA'].includes(opRes.rows[0].status)) {
      return { success: false, error: `OP ${opCodigo} está com status "${opRes.rows[0].status}" e não aceita entradas.` }
    }

    const queries = []
    const enderecosAfetados = new Set([opCodigo])

    for (const c of caixas) {
      const check = await db.execute({ sql: `SELECT status, endereco FROM estoque_caixas WHERE id = ?`, args: [c.id] })
      if (!check.rows[0] || check.rows[0].status !== 'DISPONIVEL') {
        return { success: false, error: `A caixa ${c.ean_caixa} já foi alocada ou consumida.` }
      }
      const endOrig = check.rows[0].endereco || c.endereco || 'REC'
      enderecosAfetados.add(endOrig)

      const loteCaixa = c.lote || (c.data_producao ? gerarLotePorData(c.data_producao) : '')
      const taraCaixa = Number(c.tara_kg || 0)
      const brutoCaixa = c.peso_bruto_kg != null ? Number(c.peso_bruto_kg) : Number((Number(c.peso_kg || 0) + taraCaixa).toFixed(3))

      queries.push({
        sql: `UPDATE estoque_caixas SET status = 'RESERVADA', endereco = ?, palete_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [opCodigo, c.id],
      })

      queries.push({
        sql: `
          INSERT INTO op_insumos (op_id, caixa_id, produto_id, peso_kg, peso_bruto_kg, tara_kg, data_producao, lote, qtd_pecas, operador_nome)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [op_id, c.id, c.produto_id, c.peso_kg, brutoCaixa, taraCaixa, c.data_producao || null, loteCaixa, c.qtd_pecas ?? null, operador_nome || 'Sistema'],
      })

      if (c.palete_id) {
        queries.push({
          sql: `UPDATE paletes SET status = 'FECHADO' WHERE id = ? AND status = 'FINALIZADO'`,
          args: [c.palete_id],
        })
      }

      queries.push({
        sql: `
          INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'TRANSFERENCIA')
        `,
        args: [c.produto_id, endOrig, opCodigo, loteCaixa, c.peso_kg, operador_id || null, operador_nome || 'Sistema'],
      })

      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora) VALUES (?, ?, 'ALOCADA_PRODUCAO', ?, ?, CURRENT_TIMESTAMP)`,
        args: [
          c.id,
          c.ean_caixa,
          `Entrada na OP ${opCodigo} • Lote ${loteCaixa || '-'} • Líq ${Number(c.peso_kg || 0).toFixed(2)}kg`,
          operador_nome || 'Sistema',
        ],
      })
    }

    await db.batch(queries, 'write')
    await recalcularPosicaoEnderecos([...enderecosAfetados])
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Busca, valida (limite previsto + FEFO) e aloca atomicamente 1 caixa de entrada na OP
 * em no máximo 2 round-trips de rede para resposta instantânea na linha de produção.
 */
export async function escanearEAlocarEntradaOP({
  op_id,
  ean,
  forcarConfirmacao = false,
  operador_id = null,
  operador_nome = 'Operador',
}) {
  if (isApiEnabled()) {
    return apiRequest(`/api/ops/${op_id}/entrar-caixa`, {
      method: 'POST',
      body: { ean, forcarConfirmacao },
    })
  }
  await assertPermissao(['producao_entrada', 'retorno_producao'])
  await ensureRastreabilidadeSchema()

  const clean = String(ean || '').trim()
  if (!clean) {
    return { success: false, code: 'VAZIO', error: 'Informe ou bipe o EAN da caixa de entrada.' }
  }

  // Round-trip 1 paralelo: caixa + OP + previstos + insumos já bipados nesta OP
  const [caixaRes, opRes, prevRes, insRes] = await Promise.all([
    db.execute({
      sql: `
        SELECT
          ec.*,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao,
          pal.endereco_atual AS palete_endereco,
          t.nome AS tara_nome
        FROM estoque_caixas ec
        JOIN produtos p ON p.id = ec.produto_id
        LEFT JOIN paletes pal ON pal.id = ec.palete_id
        LEFT JOIN taras t ON t.id = ec.tara_id
        WHERE ec.ean_caixa = ?
        LIMIT 1
      `,
      args: [clean],
    }),
    db.execute({ sql: `SELECT id, codigo, status FROM ordens_producao WHERE id = ?`, args: [op_id] }),
    db.execute({
      sql: `
        SELECT id, produto_id, qtd_caixas_prevista, peso_kg_previsto, unidade_prevista
        FROM op_itens_previstos
        WHERE op_id = ? AND tipo = 'ENTRADA'
      `,
      args: [op_id],
    }),
    db.execute({
      sql: `SELECT id, caixa_id, produto_id, peso_kg FROM op_insumos WHERE op_id = ?`,
      args: [op_id],
    }),
  ])

  const op = opRes.rows[0]
  if (!op) {
    return { success: false, code: 'OP_NAO_ENCONTRADA', error: 'Ordem de Produção não encontrada.' }
  }
  const opCodigo = op.codigo || 'PRODUCAO'
  if (!['LIBERADA', 'ABERTA'].includes(op.status)) {
    return {
      success: false,
      code: 'OP_FECHADA',
      error: `OP ${opCodigo} está com status "${op.status}" e não aceita novas entradas.`,
    }
  }

  const cRaw = caixaRes.rows[0]
  if (!cRaw) {
    return { success: false, code: 'NAO_ENCONTRADA', error: `Caixa com EAN "${clean}" não encontrada no estoque.` }
  }

  const jaNaOp = insRes.rows.some((r) => Number(r.caixa_id) === Number(cRaw.id))
  if (jaNaOp) {
    return {
      success: false,
      code: 'DUPLICADA',
      error: `A caixa ${cRaw.ean_caixa} (${cRaw.produto_descricao}) já foi bipada nesta OP.`,
    }
  }

  if (cRaw.status !== 'DISPONIVEL') {
    const motivoExtra = cRaw.cliente_reservado_nome
      ? ` — reservada para ${cRaw.cliente_reservado_nome} (${cRaw.pedido_reservado_codigo || ''})`
      : ''
    return {
      success: false,
      code: 'INDISPONIVEL',
      error: `Caixa não está DISPONÍVEL para entrada na OP (Status atual: ${cRaw.status}${motivoExtra}).`,
    }
  }

  const loteCaixa = cRaw.lote || (cRaw.data_producao ? gerarLotePorData(cRaw.data_producao) : '')
  const taraCaixa = Number(cRaw.tara_kg || 0)
  const brutoCaixa = cRaw.peso_bruto_kg != null
    ? Number(cRaw.peso_bruto_kg)
    : Number((Number(cRaw.peso_kg || 0) + taraCaixa).toFixed(3))

  const caixaNormalizada = {
    ...cRaw,
    endereco: cRaw.endereco || cRaw.palete_endereco || 'REC',
    lote: loteCaixa,
    tara_kg: taraCaixa,
    peso_bruto_kg: brutoCaixa,
  }

  const previstos = prevRes.rows || []
  const prevMatch = previstos.find((p) => Number(p.produto_id) === Number(cRaw.produto_id)) || null
  const foraPrevisto = previstos.length > 0 && !prevMatch

  // Conferência inteligente de limite previsto em caixas (bloqueio imediato antes da transação)
  const temCapCaixas = Boolean(
    prevMatch &&
    prevMatch.qtd_caixas_prevista != null &&
    Number(prevMatch.qtd_caixas_prevista) > 0 &&
    (prevMatch.unidade_prevista === 'CX' || !prevMatch.peso_kg_previsto)
  )
  if (temCapCaixas) {
    const limiteCx = Math.trunc(Number(prevMatch.qtd_caixas_prevista))
    const bipadasProd = insRes.rows.filter((r) => Number(r.produto_id) === Number(cRaw.produto_id)).length
    if (bipadasProd >= limiteCx) {
      return {
        success: false,
        code: 'LIMITE_ATINGIDO',
        error: `Limite previsto atingido para ${cRaw.produto_descricao}: ${bipadasProd}/${limiteCx} caixa(s) já bipada(s). Não é possível bipar mais caixas deste item nesta OP.`,
      }
    }
  }

  // Checagem rápida FEFO apenas quando ainda não confirmado pelo operador
  if (!forcarConfirmacao) {
    let avisoFefo = null
    if (cRaw.validade) {
      const fefoRes = await db.execute({
        sql: `
          SELECT c.*, p.descricao AS produto_descricao
          FROM estoque_caixas c
          JOIN produtos p ON p.id = c.produto_id
          WHERE c.produto_id = ?
            AND c.status = 'DISPONIVEL'
            AND c.validade IS NOT NULL
            AND c.validade < ?
          ORDER BY c.validade ASC
          LIMIT 1
        `,
        args: [cRaw.produto_id, cRaw.validade],
      })
      if (fefoRes.rows[0]) {
        avisoFefo = fefoRes.rows[0]
      }
    }

    if (avisoFefo || foraPrevisto) {
      return {
        success: false,
        requiresConfirmation: true,
        caixa: caixaNormalizada,
        avisoFefo,
        foraPrevisto,
      }
    }
  }

  // Round-trip 2: Transação atômica com trava de limite e concorrência (status = 'DISPONIVEL')
  let insumoId = null
  const endOrig = cRaw.endereco || 'REC'

  const tx = await db.transaction('write')
  try {
    if (temCapCaixas) {
      const limiteCx = Math.trunc(Number(prevMatch.qtd_caixas_prevista))
      const cntRes = await tx.execute({
        sql: `SELECT COUNT(*) AS cnt FROM op_insumos WHERE op_id = ? AND produto_id = ?`,
        args: [op_id, cRaw.produto_id],
      })
      const jaCount = Number(cntRes.rows[0]?.cnt || 0)
      if (jaCount >= limiteCx) {
        await tx.rollback()
        return {
          success: false,
          code: 'LIMITE_ATINGIDO',
          error: `Limite previsto atingido para ${cRaw.produto_descricao}: ${jaCount}/${limiteCx} caixa(s) já bipada(s).`,
        }
      }
    }

    const updRes = await tx.execute({
      sql: `UPDATE estoque_caixas SET status = 'RESERVADA', endereco = ?, palete_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'DISPONIVEL'`,
      args: [opCodigo, cRaw.id],
    })
    if (!updRes.rowsAffected) {
      await tx.rollback()
      return {
        success: false,
        code: 'CONCORRENCIA',
        error: `A caixa ${cRaw.ean_caixa} já foi alocada ou movimentada simultaneamente.`,
      }
    }

    const insOp = await tx.execute({
      sql: `
        INSERT INTO op_insumos (op_id, caixa_id, produto_id, peso_kg, peso_bruto_kg, tara_kg, data_producao, lote, qtd_pecas, operador_nome)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `,
      args: [
        op_id,
        cRaw.id,
        cRaw.produto_id,
        cRaw.peso_kg,
        brutoCaixa,
        taraCaixa,
        cRaw.data_producao || null,
        loteCaixa,
        cRaw.qtd_pecas ?? null,
        operador_nome || 'Sistema',
      ],
    })
    insumoId = Number(insOp.rows[0]?.id || 0)

    if (cRaw.palete_id) {
      await tx.execute({
        sql: `UPDATE paletes SET status = 'FECHADO' WHERE id = ? AND status = 'FINALIZADO'`,
        args: [cRaw.palete_id],
      })
    }

    await tx.execute({
      sql: `
        INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'TRANSFERENCIA')
      `,
      args: [cRaw.produto_id, endOrig, opCodigo, loteCaixa, cRaw.peso_kg, operador_id || null, operador_nome || 'Sistema'],
    })

    await tx.execute({
      sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora) VALUES (?, ?, 'ALOCADA_PRODUCAO', ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        cRaw.id,
        cRaw.ean_caixa,
        `Entrada na OP ${opCodigo} • Lote ${loteCaixa || '-'} • ${cRaw.qtd_pecas ? `${cRaw.qtd_pecas} pç • ` : ''}Líq ${Number(cRaw.peso_kg || 0).toFixed(2)}kg`,
        operador_nome || 'Sistema',
      ],
    })

    if (op.status === 'LIBERADA') {
      await tx.execute({
        sql: `UPDATE ordens_producao SET status = 'ABERTA', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'LIBERADA'`,
        args: [op_id],
      })
    }

    await tx.commit()
  } catch (err) {
    try { await tx.rollback() } catch (_) {}
    return { success: false, code: 'ERRO', error: err.message }
  }

  // Atualiza posição dos 1-2 endereços afetados
  await recalcularPosicaoEnderecos([...new Set([endOrig, opCodigo])])

  return {
    success: true,
    caixa: caixaNormalizada,
    insumo: {
      id: insumoId,
      op_id: Number(op_id),
      caixa_id: Number(cRaw.id),
      produto_id: Number(cRaw.produto_id),
      produto_codigo: cRaw.produto_codigo || '',
      produto_descricao: cRaw.produto_descricao || '',
      ean_caixa: cRaw.ean_caixa,
      validade: cRaw.validade || null,
      data_producao: cRaw.data_producao || null,
      lote: loteCaixa,
      peso_bruto_kg: brutoCaixa,
      tara_kg: taraCaixa,
      peso_kg: Number(cRaw.peso_kg || 0),
      qtd_pecas: cRaw.qtd_pecas ?? null,
      operador_nome: operador_nome || 'Sistema',
    },
  }
}

export async function adicionarRetorno(
  op_id,
  { ean_caixa, produto_id, produto_codigo, peso_kg, peso_bruto_kg, tara_id, tara_kg = 0, qtd_pecas, data_producao, validade, lote },
  operador_id,
  operador_nome
) {
  if (isApiEnabled()) {
    try {
      const bruto = peso_bruto_kg != null ? Number(peso_bruto_kg) : Number((Number(peso_kg || 0) + Number(tara_kg || 0)).toFixed(3))
      const res = await apiRequest(`/api/ops/${op_id}/retorno`, {
        method: 'POST',
        body: {
          ean_caixa,
          produto_id,
          peso_bruto_kg: bruto,
          tara_id: tara_id || null,
          tara_kg: Number(tara_kg || 0),
          qtd_pecas,
          data_producao,
          validade,
        },
      })
      return {
        success: true,
        caixa_id: res.retorno?.caixa_id,
        ean_caixa: res.retorno?.ean_caixa,
        peso_kg: res.retorno?.peso_kg,
        caixa: res.retorno,
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  await assertPermissao(['producao_saida', 'retorno_producao'])
  await ensureRastreabilidadeSchema()
  try {
    const pecasNum = Number(qtd_pecas)
    const pecasInt = Number.isFinite(pecasNum) ? Math.trunc(pecasNum) : NaN
    if (!Number.isFinite(pecasNum) || pecasInt <= 0 || pecasInt !== pecasNum) {
      return { success: false, error: 'Informe uma Quantidade de Peças inteira maior que zero para gerar a caixa de saída.' }
    }

    const opRes = await db.execute({ sql: `SELECT * FROM ordens_producao WHERE id = ?`, args: [op_id] })
    const op = opRes.rows[0]
    if (!op) return { success: false, error: 'Ordem de Produção não encontrada.' }
    if (!['LIBERADA', 'ABERTA'].includes(op.status)) {
      return { success: false, error: `OP ${op.codigo} não está liberada para saída de produção.` }
    }

    const prodRes = await db.execute({ sql: `SELECT id, codigo, descricao FROM produtos WHERE id = ?`, args: [produto_id] })
    const produto = prodRes.rows[0]
    if (!produto) return { success: false, error: 'Produto de saída não encontrado.' }

    const taraVal = Number(Number(tara_kg || 0).toFixed(3))
    const liquidoVal = peso_kg !== undefined && peso_kg !== null
      ? Number(Number(peso_kg).toFixed(3))
      : calcularPesoLiquido(peso_bruto_kg, taraVal)
    const brutoVal = peso_bruto_kg !== undefined && peso_bruto_kg !== null
      ? Number(Number(peso_bruto_kg).toFixed(3))
      : Number((liquidoVal + taraVal).toFixed(3))

    if (!Number.isFinite(liquidoVal) || liquidoVal <= 0) {
      return { success: false, error: `Peso Bruto (${brutoVal.toFixed(2)} kg) deve ser maior que a tara (${taraVal.toFixed(3)} kg).` }
    }

    const dataProdFinal = data_producao || op.data_producao || hojeIsoLocal()
    const loteFinal = String(lote || gerarLotePorData(dataProdFinal) || '').trim()

    const opStats = await db.execute({
      sql: `
        SELECT 
          (SELECT COALESCE(SUM(peso_kg), 0) FROM op_insumos WHERE op_id = ?) AS total_insumo,
          (SELECT COALESCE(SUM(peso_kg), 0) FROM op_retornos WHERE op_id = ?) AS total_retorno
      `,
      args: [op_id, op_id],
    })
    const { total_insumo, total_retorno } = opStats.rows[0]

    if (Number(total_retorno) + liquidoVal > Number(total_insumo) + 0.2) {
      return {
        success: false,
        error: `Peso inválido: o total de saídas (${(Number(total_retorno) + liquidoVal).toFixed(2)} kg) não pode ultrapassar o peso de entrada alocado na OP (${Number(total_insumo).toFixed(2)} kg). Registre mais entradas primeiro.`,
      }
    }

    const eanFinal = ean_caixa && String(ean_caixa).trim()
      ? String(ean_caixa).trim()
      : await tarasQueries.gerarProximoEanInterno(produto_codigo || produto.codigo || '')

    const resCaixa = await db.execute({
      sql: `
        INSERT INTO estoque_caixas (
          ean_caixa, produto_id, endereco, lote, data_producao, validade,
          peso_kg, peso_bruto_kg, tara_id, tara_kg, qtd_pecas, origem_tipo, op_id, operador_cadastro_nome, status
        ) VALUES (?, ?, 'PRODUCAO', ?, ?, ?, ?, ?, ?, ?, ?, 'PRODUCAO', ?, ?, 'DISPONIVEL')
        RETURNING id
      `,
      args: [
        eanFinal, produto_id, loteFinal, dataProdFinal, validade || null,
        liquidoVal, brutoVal, tara_id || null, taraVal, pecasInt, op_id, operador_nome || 'Sistema',
      ],
    })
    const newCaixaId = Number(resCaixa.rows[0].id)

    await db.batch([
      {
        sql: `
          INSERT INTO op_retornos (
            op_id, caixa_id, produto_id, peso_kg, peso_bruto_kg, tara_id, tara_kg, qtd_pecas, data_producao, validade, lote, operador_nome
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          op_id, newCaixaId, produto_id, liquidoVal, brutoVal,
          tara_id || null, taraVal, pecasInt, dataProdFinal, validade || null, loteFinal, operador_nome || 'Sistema',
        ],
      },
      {
        sql: `
          INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
          VALUES (?, ?, 'PRODUCAO', ?, 1, ?, ?, ?, 'TRANSFERENCIA')
        `,
        args: [produto_id, op.codigo || 'PRODUCAO', loteFinal, liquidoVal, operador_id || null, operador_nome || 'Sistema'],
      },
      {
        sql: `
          INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora)
          VALUES (?, ?, 'RETORNO_PRODUCAO', ?, ?, CURRENT_TIMESTAMP)
        `,
        args: [
          newCaixaId,
          eanFinal,
          `Gerada na OP ${op.codigo} • Lote ${loteFinal} • ${pecasInt} pç • Bruto ${brutoVal.toFixed(2)}kg | Tara ${taraVal.toFixed(3)}kg | Líq ${liquidoVal.toFixed(2)}kg`,
          operador_nome || 'Sistema',
        ],
      },
    ], 'write')

    await recalcularPosicaoEnderecos(['PRODUCAO'])

    return {
      success: true,
      caixa_gerada: {
        id: newCaixaId,
        ean_caixa: eanFinal,
        produto_id,
        produto_codigo: produto.codigo || '',
        produto_descricao: produto.descricao || '',
        lote: loteFinal,
        data_producao: dataProdFinal,
        validade: validade || null,
        peso_bruto_kg: brutoVal,
        tara_kg: taraVal,
        peso_liquido_kg: liquidoVal,
        peso_kg: liquidoVal,
        qtd_pecas: pecasInt,
        origem_tipo: 'PRODUCAO',
        op_codigo: op.codigo,
      },
    }
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE constraint failed: estoque_caixas.ean_caixa')) {
      return { success: false, error: 'Este código EAN já existe no sistema.' }
    }
    return { success: false, error: err.message }
  }
}

export async function removerItemOP(op_id, tipo, item_id, caixa_id) {
  if (isApiEnabled()) {
    try {
      return await apiRequest(`/api/ops/${op_id}/item/${tipo}/${item_id}`, { method: 'DELETE' })
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  try {
    await assertPermissao(
      tipo === 'INSUMO'
        ? ['producao_entrada', 'producao_criar_op', 'retorno_producao']
        : ['producao_saida', 'producao_criar_op', 'retorno_producao']
    )
    const queries = []
    const caixaRes = await db.execute({ sql: `SELECT * FROM estoque_caixas WHERE id = ?`, args: [caixa_id] })
    if (caixaRes.rows.length === 0) return { success: false, error: 'Caixa não encontrada' }
    const caixa = caixaRes.rows[0]

    const opRes = await db.execute({ sql: `SELECT codigo FROM ordens_producao WHERE id = ?`, args: [op_id] })
    const opCod = opRes.rows[0]?.codigo || ''

    if (tipo === 'INSUMO') {
      queries.push({ sql: `DELETE FROM op_insumos WHERE id = ?`, args: [item_id] })
      queries.push({ sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args: [caixa_id] })
      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora) VALUES (?, ?, 'ESTORNO_INSUMO', ?, 'Sistema', CURRENT_TIMESTAMP)`,
        args: [caixa.id, caixa.ean_caixa, `Removida da OP ${opCod} e devolvida como disponível`],
      })
      await db.batch(queries, 'write')
      await recalcularPosicaoEnderecos([caixa.endereco || opCod])
    } else if (tipo === 'RETORNO') {
      queries.push({ sql: `DELETE FROM op_retornos WHERE id = ?`, args: [item_id] })
      queries.push({ sql: `DELETE FROM estoque_caixas WHERE id = ?`, args: [caixa_id] })
      queries.push({
        sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora) VALUES (?, ?, 'ESTORNO_RETORNO', ?, 'Sistema', CURRENT_TIMESTAMP)`,
        args: [caixa.id, caixa.ean_caixa, `Caixa excluída (Estorno saída da OP ${opCod})`],
      })
      await db.batch(queries, 'write')
      await recalcularPosicaoEnderecos(['PRODUCAO'])
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function verificarFEFO(produto_id, validadeAtual) {
  if (isApiEnabled()) {
    if (!validadeAtual) return null
    const list = (await apiRequest(`/api/estoque/fefo${buildQueryString({ produto_id, validade: validadeAtual })}`)).data
    return list?.[0] || null
  }
  await assertPermissao(['producao_entrada', 'retorno_producao', 'producao_criar_op'], { write: false, bloquearCliente: true })
  if (!validadeAtual) return null

  const res = await db.execute({
    sql: `
      SELECT c.*, p.descricao AS produto_descricao
      FROM estoque_caixas c
      JOIN produtos p ON p.id = c.produto_id
      WHERE c.produto_id = ?
        AND c.status = 'DISPONIVEL'
        AND c.validade IS NOT NULL
      ORDER BY c.validade ASC
      LIMIT 1
    `,
    args: [produto_id],
  })

  if (res.rows.length === 0) return null
  const caixaMaisVelha = res.rows[0]
  if (new Date(caixaMaisVelha.validade) < new Date(validadeAtual)) {
    return caixaMaisVelha
  }
  return null
}

export async function finalizarOP(op_id) {
  if (isApiEnabled()) {
    try {
      return await apiRequest(`/api/ops/${op_id}/finalizar`, { method: 'POST' })
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  try {
    await assertPermissao('producao_criar_op')
    const queries = []
    const opRes = await db.execute({ sql: `SELECT codigo FROM ordens_producao WHERE id = ?`, args: [op_id] })
    const opCod = opRes.rows[0]?.codigo || ''

    const insumosRes = await db.execute({
      sql: `
        SELECT c.produto_id, c.endereco, c.validade, c.peso_kg, p.classificacao
        FROM op_insumos oi
        JOIN estoque_caixas c ON c.id = oi.caixa_id
        JOIN produtos p ON p.id = c.produto_id
        WHERE oi.op_id = ?
      `,
      args: [op_id],
    })

    const retornosRes = await db.execute({
      sql: `
        SELECT c.produto_id, c.peso_kg, p.classificacao, p.produto_pai_id
        FROM op_retornos or_ret
        JOIN estoque_caixas c ON c.id = or_ret.caixa_id
        JOIN produtos p ON p.id = c.produto_id
        WHERE or_ret.op_id = ?
      `,
      args: [op_id],
    })

    const totalInsumos = insumosRes.rows.reduce((sum, i) => sum + (i.peso_kg || 0), 0)
    const totalRetornos = retornosRes.rows.reduce((sum, r) => sum + (r.peso_kg || 0), 0)

    let rendimento_pct = null
    let perda_pct = null
    if (totalInsumos > 0) {
      rendimento_pct = parseFloat(((totalRetornos / totalInsumos) * 100).toFixed(2))
      perda_pct = parseFloat((100 - rendimento_pct).toFixed(2))
    }

    queries.push({
      sql: `UPDATE ordens_producao SET status = 'FECHADA', rendimento_pct = ?, perda_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [rendimento_pct, perda_pct, op_id],
    })

    queries.push({
      sql: `UPDATE estoque_caixas SET status = 'CONSUMIDA', updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT caixa_id FROM op_insumos WHERE op_id = ?)`,
      args: [op_id],
    })

    const insumosMap = new Map()
    for (const i of insumosRes.rows) {
      insumosMap.set(i.produto_id, (insumosMap.get(i.produto_id) || 0) + i.peso_kg)
      if (!i.classificacao) {
        queries.push({ sql: `UPDATE produtos SET classificacao = 'MATERIA_PRIMA' WHERE id = ?`, args: [i.produto_id] })
        i.classificacao = 'MATERIA_PRIMA'
      }
    }

    let maiorMateriaPrimaId = null
    let maiorMateriaPrimaPeso = 0
    let maiorQualquerInsumoId = null
    let maiorQualquerInsumoPeso = 0

    for (const [prodId, peso] of insumosMap.entries()) {
      const prodData = insumosRes.rows.find(r => r.produto_id === prodId)
      if (prodData.classificacao === 'MATERIA_PRIMA' && peso > maiorMateriaPrimaPeso) {
        maiorMateriaPrimaPeso = peso
        maiorMateriaPrimaId = prodId
      }
      if (peso > maiorQualquerInsumoPeso) {
        maiorQualquerInsumoPeso = peso
        maiorQualquerInsumoId = prodId
      }
    }

    const produtoPaiId = maiorMateriaPrimaId || maiorQualquerInsumoId
    if (produtoPaiId) {
      for (const r of retornosRes.rows) {
        if (r.produto_id !== produtoPaiId) {
          queries.push({ sql: `INSERT OR IGNORE INTO produto_arvore (pai_id, filho_id) VALUES (?, ?)`, args: [produtoPaiId, r.produto_id] })
        }
        if (!r.classificacao) {
          queries.push({ sql: `UPDATE produtos SET classificacao = 'SUBPRODUTO' WHERE id = ?`, args: [r.produto_id] })
        }
      }
    }

    await db.batch(queries, 'write')
    const ends = [...new Set([opCod, ...insumosRes.rows.map(r => r.endereco)].filter(Boolean))]
    await recalcularPosicaoEnderecos(ends)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function cancelarOP(op_id) {
  if (isApiEnabled()) {
    try {
      return await apiRequest(`/api/ops/${op_id}/cancelar`, { method: 'POST' })
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  try {
    await assertPermissao('producao_criar_op')
    const opStats = await db.execute({
      sql: `
        SELECT
          (SELECT count(*) FROM op_insumos WHERE op_id = ?) AS qtd_insumos,
          (SELECT count(*) FROM op_retornos WHERE op_id = ?) AS qtd_retornos
      `,
      args: [op_id, op_id],
    })
    const { qtd_insumos, qtd_retornos } = opStats.rows[0]
    if (qtd_insumos > 0 || qtd_retornos > 0) {
      return { success: false, error: 'Não é possível cancelar. A OP já possui itens alocados. Remova os itens ou finalize a OP.' }
    }
    await db.execute({ sql: `DELETE FROM ordens_producao WHERE id = ?`, args: [op_id] })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export async function reabrirOP(op_id) {
  if (isApiEnabled()) {
    try {
      return await apiRequest(`/api/ops/${op_id}/reabrir`, { method: 'POST' })
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
  try {
    await assertPermissao('producao_criar_op')
    const opRes = await db.execute({ sql: `SELECT codigo FROM ordens_producao WHERE id = ?`, args: [op_id] })
    const opCod = opRes.rows[0]?.codigo || ''

    const queries = [
      {
        sql: `UPDATE ordens_producao SET status = 'LIBERADA', reaberta = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [op_id],
      },
      {
        sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT caixa_id FROM op_insumos WHERE op_id = ?)`,
        args: [op_id],
      },
    ]

    await db.batch(queries, 'write')
    if (opCod) await recalcularPosicaoEnderecos([opCod])
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

// ─── RELATÓRIOS ───────────────────────────────────────────────────────────────

export async function relatorioOPsPeriodo(dataInicio, dataFim) {
  const executor = await assertPermissao(['relatorios_producao', 'retorno_producao', 'producao_criar_op'], { write: false, bloquearCliente: false })
  const modoCliente = isCliente(executor)
  const opsRes = await db.execute({
    sql: `
      SELECT 
        op.*,
        COALESCE((SELECT SUM(peso_kg) FROM op_insumos WHERE op_id = op.id), 0) AS peso_insumos,
        COALESCE((SELECT SUM(peso_kg) FROM op_retornos WHERE op_id = op.id), 0) AS peso_retornos
      FROM ordens_producao op
      WHERE op.status = 'FECHADA'
        AND date(COALESCE(op.data_producao, op.created_at)) >= ? AND date(COALESCE(op.data_producao, op.created_at)) <= ?
      ORDER BY op.created_at DESC
    `,
    args: [dataInicio, dataFim],
  })
  return modoCliente
    ? opsRes.rows.map((r) => ({ ...r, operador_nome: null, criado_por_nome: null }))
    : opsRes.rows
}

export async function relatorioProdutoAcabadoPeriodo(dataInicio, dataFim) {
  await assertPermissao(['relatorios_producao', 'retorno_producao', 'producao_criar_op'], { write: false, bloquearCliente: false })
  const res = await db.execute({
    sql: `
      SELECT 
        p.id AS produto_id,
        p.codigo AS produto_codigo,
        p.descricao AS produto_descricao,
        COUNT(or_ret.id) AS qtd_caixas,
        SUM(or_ret.peso_kg) AS peso_total,
        AVG(or_ret.peso_kg) AS peso_medio
      FROM op_retornos or_ret
      JOIN ordens_producao op ON op.id = or_ret.op_id
      JOIN produtos p ON p.id = or_ret.produto_id
      WHERE op.status = 'FECHADA'
        AND date(COALESCE(op.data_producao, op.created_at)) >= ? AND date(COALESCE(op.data_producao, op.created_at)) <= ?
      GROUP BY p.id
      ORDER BY peso_total DESC
    `,
    args: [dataInicio, dataFim],
  })
  return res.rows
}

export async function listarDossiesProducao(filtros = {}) {
  if (isApiEnabled()) {
    const raw = (await apiRequest(`/api/ops/dossies${buildQueryString({
      dataInicio: filtros.dataInicio,
      dataFim: filtros.dataFim,
      cliente: filtros.cliente,
      endereco: filtros.endereco,
      opId: filtros.opId,
    })}`)).data || []
    return raw.map((op) => ({
      ...op,
      total_entrada_kg: Number(op.peso_insumos || 0),
      total_entrada_bruto_kg: Number(op.peso_insumos_bruto ?? (op.insumos || []).reduce((s, i) => s + Number(i.peso_bruto_kg || i.peso_kg || 0), 0)),
      total_entrada_caixas: (op.insumos || []).length,
      total_saida_kg: Number(op.peso_retornos || 0),
      total_saida_bruto_kg: (op.retornos || []).reduce((s, r) => s + Number(r.peso_bruto_kg || r.peso_kg || 0), 0),
      total_saida_caixas: (op.retornos || []).length,
    }))
  }
  const executor = await assertPermissao(['relatorios_producao', 'retorno_producao', 'producao_criar_op'], { write: false, bloquearCliente: false })
  const modoCliente = isCliente(executor)
  await ensureRastreabilidadeSchema()
  const { dataInicio, dataFim, cliente, endereco, busca, opId } = filtros

  let sql = `
    SELECT 
      op.id,
      op.codigo,
      op.nome,
      op.status,
      COALESCE(op.cliente, 'INTERNO') AS cliente,
      COALESCE(op.endereco, 'PRODUCAO') AS endereco,
      COALESCE(op.data_producao, DATE(op.created_at)) AS data_producao,
      op.operador_nome,
      COALESCE(op.criado_por_nome, op.operador_nome) AS criado_por_nome,
      op.observacoes,
      op.created_at,
      op.updated_at,
      op.rendimento_pct,
      op.perda_pct
    FROM ordens_producao op
    WHERE 1=1
  `
  const args = []

  if (modoCliente) {
    sql += ` AND op.status = 'FECHADA'`
  }

  if (opId) {
    sql += ` AND op.id = ?`
    args.push(Number(opId))
  } else if (dataInicio && dataFim) {
    sql += ` AND DATE(COALESCE(op.data_producao, op.created_at)) BETWEEN ? AND ?`
    args.push(dataInicio, dataFim)
  }

  if (cliente && cliente !== 'TODOS') {
    sql += ` AND op.cliente = ?`
    args.push(cliente)
  }

  if (endereco && endereco !== 'TODOS') {
    sql += ` AND op.endereco = ?`
    args.push(endereco)
  }

  sql += ` ORDER BY COALESCE(op.data_producao, DATE(op.created_at)) DESC, op.id DESC`

  const opRes = await db.execute({ sql, args })
  const ops = opRes.rows
  if (ops.length === 0) return []

  const opIds = ops.map(o => o.id)
  const placeholders = opIds.map(() => '?').join(',')

  const [insumosRes, retornosRes, previstosRes] = await Promise.all([
    db.execute({
      sql: `
        SELECT 
          oi.op_id,
          oi.id AS item_id,
          oi.caixa_id,
          oi.peso_kg,
          COALESCE(oi.peso_bruto_kg, c.peso_bruto_kg, oi.peso_kg + COALESCE(oi.tara_kg, c.tara_kg, 0)) AS peso_bruto_kg,
          COALESCE(oi.tara_kg, c.tara_kg, 0) AS tara_kg,
          COALESCE(oi.qtd_pecas, c.qtd_pecas) AS qtd_pecas,
          COALESCE(oi.data_producao, c.data_producao) AS data_producao,
          oi.created_at AS data_entrada,
          c.created_at AS data_entrada_estoque,
          oi.created_at,
          c.ean_caixa,
          c.validade,
          COALESCE(NULLIF(oi.lote, ''), c.lote, '') AS lote,
          c.status AS caixa_status,
          p.id AS produto_id,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao,
          p.grupo AS produto_grupo
        FROM op_insumos oi
        JOIN estoque_caixas c ON c.id = oi.caixa_id
        JOIN produtos p ON p.id = oi.produto_id
        WHERE oi.op_id IN (${placeholders})
        ORDER BY oi.id ASC
      `,
      args: opIds,
    }),
    db.execute({
      sql: `
        SELECT 
          oret.op_id,
          oret.id AS item_id,
          oret.caixa_id,
          oret.peso_kg,
          COALESCE(oret.peso_bruto_kg, c.peso_bruto_kg, oret.peso_kg + COALESCE(oret.tara_kg, c.tara_kg, 0)) AS peso_bruto_kg,
          COALESCE(oret.tara_kg, c.tara_kg, 0) AS tara_kg,
          COALESCE(oret.qtd_pecas, c.qtd_pecas) AS qtd_pecas,
          t.nome AS tara_nome,
          COALESCE(oret.data_producao, c.data_producao) AS data_producao,
          COALESCE(c.created_at, oret.created_at) AS data_entrada,
          oret.created_at,
          c.ean_caixa,
          COALESCE(oret.validade, c.validade) AS validade,
          COALESCE(NULLIF(oret.lote, ''), c.lote, '') AS lote,
          c.status AS caixa_status,
          c.endereco AS caixa_endereco,
          p.id AS produto_id,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao,
          p.grupo AS produto_grupo,
          r.codigo AS romaneio_codigo,
          r.cliente AS romaneio_cliente,
          r.expedido_at AS romaneio_expedido_em
        FROM op_retornos oret
        JOIN estoque_caixas c ON c.id = oret.caixa_id
        JOIN produtos p ON p.id = oret.produto_id
        LEFT JOIN taras t ON t.id = COALESCE(oret.tara_id, c.tara_id)
        LEFT JOIN romaneios_itens ri ON ri.caixa_id = c.id
        LEFT JOIN romaneios r ON r.id = ri.romaneio_id
        WHERE oret.op_id IN (${placeholders})
        ORDER BY oret.id ASC
      `,
      args: opIds,
    }),
    db.execute({
      sql: `
        SELECT ip.*, p.codigo AS produto_codigo, p.descricao AS produto_descricao
        FROM op_itens_previstos ip
        JOIN produtos p ON p.id = ip.produto_id
        WHERE ip.op_id IN (${placeholders})
      `,
      args: opIds,
    }),
  ])

  const insumosPorOp = {}
  for (const item of insumosRes.rows) {
    if (!insumosPorOp[item.op_id]) insumosPorOp[item.op_id] = []
    insumosPorOp[item.op_id].push(item)
  }

  const retornosPorOp = {}
  for (const item of retornosRes.rows) {
    if (!retornosPorOp[item.op_id]) retornosPorOp[item.op_id] = []
    retornosPorOp[item.op_id].push(item)
  }

  const previstosPorOp = {}
  for (const item of previstosRes.rows) {
    if (!previstosPorOp[item.op_id]) previstosPorOp[item.op_id] = []
    previstosPorOp[item.op_id].push(item)
  }

  const dossies = ops.map(op => {
    const insumos = insumosPorOp[op.id] || []
    const retornos = retornosPorOp[op.id] || []
    const previstos = previstosPorOp[op.id] || []

    const totalEntradaKg = insumos.reduce((sum, i) => sum + (Number(i.peso_kg) || 0), 0)
    const totalEntradaBrutoKg = insumos.reduce((sum, i) => sum + (Number(i.peso_bruto_kg) || 0), 0)
    const totalSaidaKg = retornos.reduce((sum, r) => sum + (Number(r.peso_kg) || 0), 0)
    const totalSaidaBrutoKg = retornos.reduce((sum, r) => sum + (Number(r.peso_bruto_kg) || 0), 0)
    const diferencaKg = parseFloat((totalSaidaKg - totalEntradaKg).toFixed(2))
    const quebraKg = totalEntradaKg > totalSaidaKg ? parseFloat((totalEntradaKg - totalSaidaKg).toFixed(2)) : 0
    const rendimento = totalEntradaKg > 0 ? parseFloat(((totalSaidaKg / totalEntradaKg) * 100).toFixed(1)) : 0

    return {
      ...op,
      operador_nome: modoCliente ? null : op.operador_nome,
      criado_por_nome: modoCliente ? null : op.criado_por_nome,
      insumos,
      retornos,
      previstos_entrada: previstos.filter(x => x.tipo === 'ENTRADA'),
      previstos_saida: previstos.filter(x => x.tipo === 'SAIDA'),
      total_entrada_caixas: insumos.length,
      total_saida_caixas: retornos.length,
      total_entrada_kg: parseFloat(totalEntradaKg.toFixed(2)),
      total_entrada_bruto_kg: parseFloat(totalEntradaBrutoKg.toFixed(2)),
      total_saida_kg: parseFloat(totalSaidaKg.toFixed(2)),
      total_saida_bruto_kg: parseFloat(totalSaidaBrutoKg.toFixed(2)),
      diferenca_kg: diferencaKg,
      quebra_kg: quebraKg,
      rendimento_calc: rendimento,
    }
  })

  if (busca && busca.trim()) {
    const termo = busca.trim().toLowerCase()
    return dossies.filter(d =>
      (d.codigo && d.codigo.toLowerCase().includes(termo)) ||
      (d.nome && d.nome.toLowerCase().includes(termo)) ||
      (d.cliente && d.cliente.toLowerCase().includes(termo)) ||
      (d.endereco && d.endereco.toLowerCase().includes(termo)) ||
      d.insumos.some(i => (i.ean_caixa && i.ean_caixa.toLowerCase().includes(termo)) || (i.produto_descricao && i.produto_descricao.toLowerCase().includes(termo)) || (i.lote && i.lote.toLowerCase().includes(termo))) ||
      d.retornos.some(r => (r.ean_caixa && r.ean_caixa.toLowerCase().includes(termo)) || (r.produto_descricao && r.produto_descricao.toLowerCase().includes(termo)) || (r.lote && r.lote.toLowerCase().includes(termo)))
    )
  }

  return dossies
}

export async function obterCustosOp(opId) {
  if (!isApiEnabled()) return null
  return (await apiRequest(`/api/ops/${opId}/custos-resumo`)).data
}

export async function atualizarCustosOp(opId, payload) {
  if (!isApiEnabled()) throw new Error('Cálculo de custos requer API central PostgreSQL.')
  return (await apiRequest(`/api/ops/${opId}/custos`, { method: 'PATCH', body: payload })).data
}

export async function listarAnaliseCustosOps({ dataInicio, dataFim } = {}) {
  if (!isApiEnabled()) return { ops: [], ranking_fornecedores: [] }
  return (await apiRequest(`/api/ops/analise-custos${buildQueryString({ dataInicio, dataFim })}`)).data
}
