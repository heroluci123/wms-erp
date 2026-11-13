import { db } from '../lib/db'
import { recalcularPosicaoEnderecos } from './movimentacoes'
import { assertPermissao } from '../lib/authGuard'

async function gerarProximoCodigoRomaneio() {
  const seqRes = await db.execute("SELECT codigo FROM romaneios ORDER BY id DESC LIMIT 1")
  let seqNum = 1
  if (seqRes.rows.length > 0 && seqRes.rows[0].codigo) {
    const match = String(seqRes.rows[0].codigo).match(/ROM-(\d+)/i)
    if (match) seqNum = parseInt(match[1], 10) + 1
  }
  return `ROM-${String(seqNum).padStart(4, '0')}`
}

/**
 * Lista romaneios de saída filtrando por status, datas e vínculo com pedido
 */
export async function listarRomaneios(status = 'TODOS', dataInicio = null, dataFim = null, previsaoEntrega = null) {
  await assertPermissao(['saida', 'expedicao', 'pedidos_consultar', 'pedidos'], { write: false, bloquearCliente: true })
  let sql = `
    SELECT
      r.*,
      ped.codigo AS pedido_codigo,
      ped.titulo AS pedido_titulo,
      ped.cliente AS pedido_cliente,
      ped.status AS pedido_status,
      ped.observacoes AS pedido_observacoes,
      COALESCE(SUM(ri.peso_kg), 0) AS total_peso,
      COUNT(ri.id) AS total_caixas,
      COUNT(DISTINCT ri.produto_id) AS qtd_produtos,
      COALESCE(SUM(CASE WHEN ri.conferido = 1 THEN 1 ELSE 0 END), 0) AS qtd_conferidas,
      COALESCE(SUM(CASE WHEN ri.conferido = 1 THEN ri.peso_kg ELSE 0 END), 0) AS peso_conferido
    FROM romaneios r
    LEFT JOIN pedidos ped ON r.pedido_id = ped.id
    LEFT JOIN romaneios_itens ri ON r.id = ri.romaneio_id
    WHERE 1=1
  `
  const args = []
  if (status && status !== 'TODOS') {
    sql += ` AND r.status = ?`
    args.push(status)
  }

  if (status === 'EXPEDIDO') {
    if (dataInicio) {
      sql += ` AND DATE(COALESCE(r.expedido_at, r.created_at)) >= ?`
      args.push(dataInicio)
    }
    if (dataFim) {
      sql += ` AND DATE(COALESCE(r.expedido_at, r.created_at)) <= ?`
      args.push(dataFim)
    }
  } else {
    if (dataInicio) {
      sql += ` AND DATE(r.created_at) >= ?`
      args.push(dataInicio)
    }
    if (dataFim) {
      sql += ` AND DATE(r.created_at) <= ?`
      args.push(dataFim)
    }
  }

  if (previsaoEntrega) {
    sql += ` AND DATE(r.previsao_entrega) = ?`
    args.push(previsaoEntrega)
  }

  sql += ` GROUP BY r.id ORDER BY r.id DESC`
  const res = await db.execute({ sql, args })
  return res.rows
}

/**
 * Lista pedidos liberados ou em separação disponíveis para o operador separar
 */
export async function listarPedidosParaSeparacao() {
  await assertPermissao(['saida', 'expedicao', 'pedidos_consultar', 'pedidos'], { write: false, bloquearCliente: true })
  const res = await db.execute(`
    SELECT
      ped.*,
      COALESCE((SELECT COUNT(*) FROM pedidos_itens pi WHERE pi.pedido_id = ped.id), 0) AS qtd_itens,
      COALESCE((SELECT ROUND(SUM(pi.qtd_kg_solicitada), 3) FROM pedidos_itens pi WHERE pi.pedido_id = ped.id), 0) AS total_kg_solicitado,
      COALESCE((SELECT SUM(COALESCE(pi.qtd_caixas_solicitada, 0)) FROM pedidos_itens pi WHERE pi.pedido_id = ped.id), 0) AS total_caixas_solicitadas,
      r.id AS romaneio_id,
      r.codigo AS romaneio_codigo,
      r.status AS romaneio_status,
      r.operador_nome AS separador_nome,
      COALESCE((SELECT ROUND(SUM(ri.peso_kg), 3) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id), 0) AS total_kg_separado,
      COALESCE((SELECT COUNT(*) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id), 0) AS total_caixas_separadas
    FROM pedidos ped
    LEFT JOIN romaneios r ON r.id = (
      SELECT id FROM romaneios WHERE pedido_id = ped.id AND status != 'EXPEDIDO' ORDER BY id DESC LIMIT 1
    )
    WHERE ped.status IN ('LIBERADO', 'EM_SEPARACAO')
    ORDER BY
      CASE WHEN ped.previsao_entrega IS NULL OR ped.previsao_entrega = '' THEN 1 ELSE 0 END ASC,
      ped.previsao_entrega ASC,
      ped.id DESC
  `)
  return res.rows
}

/**
 * Inicia ou retoma a separação de um pedido, criando/abrindo seu romaneio vinculado
 */
export async function iniciarOuAbrirSeparacaoPedido(pedido_id, operador_id, operador_nome) {
  await assertPermissao(['saida', 'expedicao', 'pedidos'])
  const pedRes = await db.execute({ sql: 'SELECT * FROM pedidos WHERE id = ?', args: [pedido_id] })
  if (pedRes.rows.length === 0) {
    return { success: false, error: 'Pedido não encontrado.' }
  }
  const ped = pedRes.rows[0]
  if (!['LIBERADO', 'EM_SEPARACAO'].includes(ped.status)) {
    return { success: false, error: `Pedido ${ped.codigo} está no status ${ped.status} e não pode ser separado aqui.` }
  }

  const existingRes = await db.execute({
    sql: "SELECT * FROM romaneios WHERE pedido_id = ? AND status != 'EXPEDIDO' ORDER BY id DESC LIMIT 1",
    args: [pedido_id]
  })
  if (existingRes.rows.length > 0) {
    const rom = existingRes.rows[0]
    if (rom.status !== 'MONTANDO') {
      return {
        success: false,
        error: `O romaneio ${rom.codigo} deste pedido já foi finalizado e está na etapa de Expedição/Conferência.`
      }
    }
    return { success: true, romaneio: rom }
  }

  const codigo = await gerarProximoCodigoRomaneio()
  const rotuloCliente = ped.cliente ? `${ped.titulo} (${ped.cliente})` : ped.titulo
  const insRes = await db.execute({
    sql: `
      INSERT INTO romaneios (codigo, cliente, previsao_entrega, status, operador_id, operador_nome, pedido_id)
      VALUES (?, ?, ?, 'MONTANDO', ?, ?, ?)
    `,
    args: [codigo, rotuloCliente, ped.previsao_entrega || null, operador_id, operador_nome, pedido_id]
  })

  if (ped.status === 'LIBERADO') {
    await db.execute({
      sql: "UPDATE pedidos SET status = 'EM_SEPARACAO', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [pedido_id]
    })
  }

  const created = await db.execute({ sql: 'SELECT * FROM romaneios WHERE id = ?', args: [insRes.lastInsertRowid] })
  return { success: true, romaneio: created.rows[0] }
}

/**
 * Cria um novo romaneio (usado também para romaneio avulso de emergência)
 */
export async function criarRomaneio({ cliente, previsao_entrega, operador_id, operador_nome, pedido_id = null }) {
  try {
    await assertPermissao(['saida', 'expedicao', 'pedidos'])
    const codigo = await gerarProximoCodigoRomaneio()
    const res = await db.execute({
      sql: `
        INSERT INTO romaneios (codigo, cliente, previsao_entrega, status, operador_id, operador_nome, pedido_id)
        VALUES (?, ?, ?, 'MONTANDO', ?, ?, ?)
      `,
      args: [codigo, cliente || 'PAVAN', previsao_entrega || null, operador_id, operador_nome, pedido_id]
    })

    const created = await db.execute({ sql: `SELECT * FROM romaneios WHERE id = ?`, args: [res.lastInsertRowid] })
    return { success: true, romaneio: created.rows[0] }
  } catch (err) {
    console.error('Erro ao criar romaneio:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Busca todos os detalhes do romaneio, suas caixas bipadas, conferência e checklist do pedido
 */
export async function detalhesRomaneio(romaneio_id) {
  await assertPermissao(['saida', 'expedicao', 'pedidos_consultar', 'pedidos'], { write: false, bloquearCliente: true })
  const romRes = await db.execute({
    sql: `
      SELECT
        r.*,
        ped.codigo AS pedido_codigo,
        ped.titulo AS pedido_titulo,
        ped.cliente AS pedido_cliente,
        ped.status AS pedido_status,
        ped.observacoes AS pedido_observacoes,
        ped.criado_por_nome AS pedido_criado_por_nome,
        ped.created_at AS pedido_created_at
      FROM romaneios r
      LEFT JOIN pedidos ped ON r.pedido_id = ped.id
      WHERE r.id = ?
    `,
    args: [romaneio_id]
  })
  if (romRes.rows.length === 0) return null
  const romaneio = romRes.rows[0]

  const itensRes = await db.execute({
    sql: `
      SELECT
        ri.id,
        ri.romaneio_id,
        ri.caixa_id,
        ri.produto_id,
        ri.peso_kg,
        ri.conferido,
        ri.conferido_at,
        ri.conferido_por,
        ri.created_at,
        ec.ean_caixa,
        ec.lote,
        ec.validade,
        ec.endereco,
        p.codigo AS produto_codigo,
        p.descricao AS produto_descricao,
        p.tipo_produto,
        CASE WHEN r.pedido_id IS NULL THEN 0
             WHEN EXISTS (SELECT 1 FROM pedidos_itens pi WHERE pi.pedido_id = r.pedido_id AND pi.produto_id = ri.produto_id) THEN 0
             ELSE 1 END AS extra_fora_pedido
      FROM romaneios_itens ri
      JOIN romaneios r ON ri.romaneio_id = r.id
      JOIN estoque_caixas ec ON ri.caixa_id = ec.id
      JOIN produtos p ON ri.produto_id = p.id
      WHERE ri.romaneio_id = ?
      ORDER BY ri.conferido ASC, ri.created_at DESC
    `,
    args: [romaneio_id]
  })

  const resumoMap = new Map()
  let qtdConferidas = 0
  let pesoConferido = 0

  for (const item of itensRes.rows) {
    if (Number(item.conferido) === 1) {
      qtdConferidas += 1
      pesoConferido += Number(item.peso_kg || 0)
    }

    if (!resumoMap.has(item.produto_id)) {
      resumoMap.set(item.produto_id, {
        produto_id: item.produto_id,
        produto_codigo: item.produto_codigo,
        produto_descricao: item.produto_descricao,
        qtd_caixas: 0,
        qtd_conferidas: 0,
        total_kg: 0,
        peso_conferido: 0
      })
    }
    const r = resumoMap.get(item.produto_id)
    r.qtd_caixas += 1
    r.total_kg = Number((r.total_kg + Number(item.peso_kg || 0)).toFixed(3))
    if (Number(item.conferido) === 1) {
      r.qtd_conferidas += 1
      r.peso_conferido = Number((r.peso_conferido + Number(item.peso_kg || 0)).toFixed(3))
    }
  }

  let pedidoItens = []
  if (romaneio.pedido_id) {
    const piRes = await db.execute({
      sql: `
        SELECT
          pi.*,
          p.codigo AS produto_codigo,
          p.ean AS produto_ean,
          p.descricao AS produto_descricao,
          p.unidade
        FROM pedidos_itens pi
        JOIN produtos p ON pi.produto_id = p.id
        WHERE pi.pedido_id = ?
        ORDER BY pi.id ASC
      `,
      args: [romaneio.pedido_id]
    })

    pedidoItens = piRes.rows.map((pi) => {
      const sep = resumoMap.get(pi.produto_id) || { qtd_caixas: 0, total_kg: 0, qtd_conferidas: 0 }
      const kgSep = Number(sep.total_kg || 0)
      const kgSol = Number(pi.qtd_kg_solicitada || 0)
      const limiteMaxKg = Number((kgSol * 1.5).toFixed(3))
      const pct = kgSol > 0 ? Math.round((kgSep / kgSol) * 100) : 0
      return {
        ...pi,
        kg_separado: kgSep,
        caixas_separadas: sep.qtd_caixas,
        caixas_conferidas: sep.qtd_conferidas,
        kg_faltante: Math.max(0, Number((kgSol - kgSep).toFixed(3))),
        limite_max_kg: limiteMaxKg,
        pct_separado: pct
      }
    })
  }

  return {
    ...romaneio,
    itens: itensRes.rows,
    resumoProdutos: Array.from(resumoMap.values()),
    pedidoItens,
    conferenciasSummary: {
      totalCaixas: itensRes.rows.length,
      qtdConferidas,
      pesoConferido: Number(pesoConferido.toFixed(3)),
      todasConferidas: itensRes.rows.length > 0 && qtdConferidas === itensRes.rows.length
    }
  }
}

/**
 * Adiciona uma caixa ao romaneio em separação, validando regras do pedido (produto fora / +50% peso)
 */
export async function adicionarCaixa(romaneio_id, caixa, operador_id, operador_nome, opcoes = {}) {
  try {
    await assertPermissao(['saida', 'expedicao', 'pedidos'])
    const romRes = await db.execute({ sql: `SELECT id, codigo, status, pedido_id FROM romaneios WHERE id = ?`, args: [romaneio_id] })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado.' }
    const romaneio = romRes.rows[0]
    if (romaneio.status !== 'MONTANDO') {
      return { success: false, error: 'Este romaneio não está aberto para separação.' }
    }

    const cxCheck = await db.execute({ sql: 'SELECT ean_caixa, status, endereco, peso_kg, produto_id FROM estoque_caixas WHERE id = ?', args: [caixa.id] })
    if (cxCheck.rows.length === 0) {
      return { success: false, error: 'Caixa não encontrada no estoque.' }
    }
    const cxAtual = cxCheck.rows[0]
    if (cxAtual.status !== 'DISPONIVEL') {
      return { success: false, error: `Esta caixa está com status ${cxAtual.status} e não pode ser separada.` }
    }

    const jaNoRomaneio = await db.execute({
      sql: 'SELECT id FROM romaneios_itens WHERE romaneio_id = ? AND caixa_id = ?',
      args: [romaneio_id, caixa.id]
    })
    if (jaNoRomaneio.rows.length > 0) {
      return { success: false, error: 'Esta caixa já foi bipada neste romaneio.' }
    }

    // Validações vinculadas ao pedido (quando não confirmadas ainda)
    if (romaneio.pedido_id && !opcoes.confirmado) {
      const piRes = await db.execute({
        sql: 'SELECT * FROM pedidos_itens WHERE pedido_id = ? AND produto_id = ?',
        args: [romaneio.pedido_id, caixa.produto_id]
      })

      if (piRes.rows.length === 0) {
        return {
          success: false,
          requiresConfirmation: true,
          tipoConfirmacao: 'PRODUTO_FORA_PEDIDO',
          mensagem: `O produto "${caixa.produto_descricao}" (${Number(caixa.peso_kg).toFixed(2)} kg) NÃO consta nos itens solicitados deste pedido. Deseja incluir mesmo assim?`
        }
      }

      const itemPedido = piRes.rows[0]
      const kgAtualRes = await db.execute({
        sql: 'SELECT COALESCE(SUM(peso_kg), 0) AS total_kg FROM romaneios_itens WHERE romaneio_id = ? AND produto_id = ?',
        args: [romaneio_id, caixa.produto_id]
      })
      const kgAtual = Number(kgAtualRes.rows[0]?.total_kg || 0)
      const kgSolicitado = Number(itemPedido.qtd_kg_solicitada || 0)
      const kgNovo = Number((kgAtual + Number(caixa.peso_kg || 0)).toFixed(3))
      const limiteMaxKg = Number((kgSolicitado * 1.5).toFixed(3))

      if (kgSolicitado > 0 && kgNovo > limiteMaxKg + 0.0001) {
        const pctExcedente = Math.round(((kgNovo - kgSolicitado) / kgSolicitado) * 100)
        return {
          success: false,
          requiresConfirmation: true,
          tipoConfirmacao: 'EXCESSO_PESO_50',
          kgAtual,
          kgNovo,
          kgSolicitado,
          limiteMaxKg,
          pctExcedente,
          mensagem: `Com esta caixa (${Number(caixa.peso_kg).toFixed(2)} kg), o separado para "${caixa.produto_descricao}" irá para ${kgNovo.toFixed(2)} kg (+${pctExcedente}% acima dos ${kgSolicitado.toFixed(2)} kg pedidos, ultrapassando a tolerância de 50%). Deseja confirmar a inclusão?`
        }
      }
    }

    await db.execute({
      sql: `INSERT INTO romaneios_itens (romaneio_id, caixa_id, produto_id, peso_kg, conferido) VALUES (?, ?, ?, ?, 0)`,
      args: [romaneio_id, caixa.id, caixa.produto_id, caixa.peso_kg]
    })

    await db.execute({
      sql: `UPDATE estoque_caixas SET status = 'RESERVADA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [caixa.id]
    })

    await db.execute({
      sql: `
        INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
        VALUES (?, ?, 'SEPARACAO', ?, ?)
      `,
      args: [
        caixa.id,
        cxAtual.ean_caixa || caixa.ean_caixa || '',
        `Separada no romaneio ${romaneio.codigo} (origem: ${cxAtual.endereco || caixa.endereco || '-'} -> EXPEDICAO)`,
        operador_nome || 'Sistema'
      ]
    })

    if (romaneio.pedido_id) {
      await db.execute({
        sql: `
          UPDATE pedidos
          SET status = CASE WHEN status = 'LIBERADO' THEN 'EM_SEPARACAO' ELSE status END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        args: [romaneio.pedido_id]
      })
    }

    const enderecoAfetado = cxAtual.endereco || caixa.endereco
    if (enderecoAfetado) {
      await recalcularPosicaoEnderecos([enderecoAfetado])
    }

    return { success: true }
  } catch (err) {
    console.error('Erro ao adicionar caixa ao romaneio:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Remove uma caixa do romaneio (apenas quando em MONTANDO) e devolve ao estoque
 */
export async function removerCaixa(romaneio_id, item_id, caixa_id, produto_id, peso_kg, validade, endereco, operador_id = null, operador_nome = 'Sistema') {
  try {
    await assertPermissao(['saida', 'expedicao', 'pedidos'])
    const romRes = await db.execute({ sql: 'SELECT codigo, status FROM romaneios WHERE id = ?', args: [romaneio_id] })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado.' }
    if (romRes.rows[0].status !== 'MONTANDO') {
      return { success: false, error: 'Reabra a separação antes de remover caixas.' }
    }

    const cxRes = await db.execute({ sql: 'SELECT ean_caixa, endereco FROM estoque_caixas WHERE id = ?', args: [caixa_id] })
    const endReal = cxRes.rows[0]?.endereco || endereco

    await db.execute({ sql: `DELETE FROM romaneios_itens WHERE id = ?`, args: [item_id] })
    await db.execute({
      sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [caixa_id]
    })

    await db.execute({
      sql: `
        INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
        VALUES (?, ?, 'ESTORNO', ?, ?)
      `,
      args: [
        caixa_id,
        cxRes.rows[0]?.ean_caixa || '',
        `Removida da separação ${romRes.rows[0].codigo} (devolvida para ${endReal || '-'})`,
        operador_nome || 'Sistema'
      ]
    })

    if (endReal) {
      await recalcularPosicaoEnderecos([endReal])
    }

    return { success: true }
  } catch (err) {
    console.error('Erro ao remover caixa do romaneio:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Finaliza a separação e move o romaneio/pedido para Conferência & Expedição
 * (A partir daqui já é possível imprimir o Romaneio de Embarque!)
 */
export async function finalizarMontagem(romaneio_id) {
  try {
    await assertPermissao(['saida', 'expedicao', 'pedidos'])
    const romRes = await db.execute({ sql: 'SELECT id, pedido_id, status FROM romaneios WHERE id = ?', args: [romaneio_id] })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado.' }
    const rom = romRes.rows[0]

    const countRes = await db.execute({
      sql: `SELECT COUNT(*) as qtd FROM romaneios_itens WHERE romaneio_id = ?`,
      args: [romaneio_id]
    })
    if (countRes.rows[0].qtd === 0) {
      return { success: false, error: 'Não é possível finalizar um romaneio vazio!' }
    }

    await db.execute({
      sql: `UPDATE romaneios SET status = 'AGUARDANDO_EXPEDICAO', conferido_at = NULL, operador_conferencia_nome = NULL WHERE id = ?`,
      args: [romaneio_id]
    })

    await db.execute({
      sql: `UPDATE romaneios_itens SET conferido = 0, conferido_at = NULL, conferido_por = NULL WHERE romaneio_id = ?`,
      args: [romaneio_id]
    })

    if (rom.pedido_id) {
      await db.execute({
        sql: `
          UPDATE pedidos
          SET status = 'AGUARDANDO_CONFERENCIA',
              separado_at = COALESCE(separado_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        args: [rom.pedido_id]
      })
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export const finalizarSeparacao = finalizarMontagem

/**
 * Reabre um romaneio da expedição devolvendo-o para separação (zera conferências)
 */
export async function reabrirRomaneio(romaneio_id) {
  try {
    await assertPermissao(['saida', 'expedicao', 'pedidos'])
    const romRes = await db.execute({ sql: 'SELECT id, pedido_id, status FROM romaneios WHERE id = ?', args: [romaneio_id] })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado.' }
    const rom = romRes.rows[0]
    if (rom.status === 'EXPEDIDO') return { success: false, error: 'Romaneio já expedido não pode ser reaberto.' }

    await db.execute({
      sql: `UPDATE romaneios SET status = 'MONTANDO', conferido_at = NULL, operador_conferencia_nome = NULL WHERE id = ?`,
      args: [romaneio_id]
    })
    await db.execute({
      sql: `UPDATE romaneios_itens SET conferido = 0, conferido_at = NULL, conferido_por = NULL WHERE romaneio_id = ?`,
      args: [romaneio_id]
    })

    if (rom.pedido_id) {
      await db.execute({
        sql: `UPDATE pedidos SET status = 'EM_SEPARACAO', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [rom.pedido_id]
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Confere caixa a caixa via leitura de código de barras na aba Expedição
 */
export async function conferirCaixaRomaneio(romaneio_id, codigoBipado, operador_id, operador_nome) {
  try {
    await assertPermissao(['expedicao', 'saida'])
    const codigoLimpo = String(codigoBipado || '').trim()
    if (!codigoLimpo) return { success: false, error: 'Informe ou bipe o código da caixa.' }

    const romRes = await db.execute({
      sql: 'SELECT id, codigo, status, pedido_id FROM romaneios WHERE id = ?',
      args: [romaneio_id]
    })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado.' }
    const rom = romRes.rows[0]
    if (rom.status !== 'AGUARDANDO_EXPEDICAO') {
      return { success: false, error: `Este romaneio está no status ${rom.status} e não aceita conferência.` }
    }

    const matchRes = await db.execute({
      sql: `
        SELECT
          ri.id AS item_id,
          ri.caixa_id,
          ri.peso_kg,
          ri.conferido,
          ec.ean_caixa,
          ec.lote,
          ec.validade,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao
        FROM romaneios_itens ri
        JOIN estoque_caixas ec ON ri.caixa_id = ec.id
        JOIN produtos p ON ri.produto_id = p.id
        WHERE ri.romaneio_id = ? AND LTRIM(ec.ean_caixa, '0') = LTRIM(?, '0')
        LIMIT 1
      `,
      args: [romaneio_id, codigoLimpo]
    })

    if (matchRes.rows.length === 0) {
      return {
        success: false,
        notInRomaneio: true,
        error: `A caixa "${codigoLimpo}" NÃO pertence ao romaneio ${rom.codigo}!`
      }
    }

    const item = matchRes.rows[0]
    if (Number(item.conferido) === 1) {
      return {
        success: false,
        alreadyChecked: true,
        item,
        error: `A caixa "${codigoLimpo}" (${item.produto_descricao}) já foi conferida.`
      }
    }

    await db.execute({
      sql: `
        UPDATE romaneios_itens
        SET conferido = 1, conferido_at = CURRENT_TIMESTAMP, conferido_por = ?
        WHERE id = ?
      `,
      args: [operador_nome, item.item_id]
    })

    await db.execute({
      sql: `
        INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
        VALUES (?, ?, 'CONFERENCIA', ?, ?)
      `,
      args: [item.caixa_id, item.ean_caixa || '', `Conferência de embarque ${rom.codigo}`, operador_nome || 'Sistema']
    })

    const statsRes = await db.execute({
      sql: `
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN conferido = 1 THEN 1 ELSE 0 END), 0) AS conferidas
        FROM romaneios_itens
        WHERE romaneio_id = ?
      `,
      args: [romaneio_id]
    })
    const totalCaixas = Number(statsRes.rows[0]?.total || 0)
    const qtdConferidas = Number(statsRes.rows[0]?.conferidas || 0)
    const todasConferidas = totalCaixas > 0 && qtdConferidas === totalCaixas

    await db.execute({
      sql: `
        UPDATE romaneios
        SET operador_conferencia_nome = ?,
            conferido_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE conferido_at END
        WHERE id = ?
      `,
      args: [operador_nome, todasConferidas ? 1 : 0, romaneio_id]
    })

    if (rom.pedido_id) {
      await db.execute({
        sql: `UPDATE pedidos SET status = 'EM_CONFERENCIA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [rom.pedido_id]
      })
    }

    return {
      success: true,
      item,
      totalCaixas,
      qtdConferidas,
      todasConferidas
    }
  } catch (err) {
    console.error('Erro ao conferir caixa:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Expide definitivamente o romaneio SOMENTE após 100% das caixas terem sido conferidas
 */
export async function expedirRomaneio(romaneio_id, operador_id, operador_nome) {
  try {
    await assertPermissao(['expedicao', 'saida'])
    const romRes = await db.execute({
      sql: `SELECT id, codigo, cliente, status, pedido_id FROM romaneios WHERE id = ?`,
      args: [romaneio_id]
    })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado' }
    const rom = romRes.rows[0]
    if (rom.status !== 'AGUARDANDO_EXPEDICAO') {
      return { success: false, error: 'Romaneio não está aguardando expedição.' }
    }

    const itensRes = await db.execute({
      sql: `
        SELECT ri.id, ri.caixa_id, ri.produto_id, ri.peso_kg, ri.conferido, ec.ean_caixa, ec.lote
        FROM romaneios_itens ri
        JOIN estoque_caixas ec ON ri.caixa_id = ec.id
        WHERE ri.romaneio_id = ?
      `,
      args: [romaneio_id]
    })
    if (itensRes.rows.length === 0) {
      return { success: false, error: 'Romaneio sem caixas não pode ser expedido.' }
    }

    const pendentes = itensRes.rows.filter((i) => Number(i.conferido) !== 1)
    if (pendentes.length > 0) {
      return {
        success: false,
        error: `Conferência incompleta: ainda faltam ${pendentes.length} caixa(s) para bipar na Expedição antes de expedir.`
      }
    }

    for (const item of itensRes.rows) {
      await db.execute({
        sql: `UPDATE estoque_caixas SET status = 'EXPEDIDA', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [item.caixa_id]
      })

      await db.execute({
        sql: `
          INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
          VALUES (?, ?, 'EXPEDICAO', ?, ?)
        `,
        args: [item.caixa_id, item.ean_caixa || '', `Expedido no romaneio ${rom.codigo} para ${rom.cliente}`, operador_nome || 'Sistema']
      })

      await db.execute({
        sql: `
          INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo, num_pedido, cliente)
          VALUES (?, 'EXPEDICAO', 'SAIDA_DEFINITIVA', ?, 1, ?, ?, ?, 'DESPACHO', ?, ?)
        `,
        args: [
          item.produto_id,
          item.lote || '',
          item.peso_kg,
          operador_id || null,
          operador_nome || 'Sistema',
          rom.codigo,
          rom.cliente || ''
        ]
      })
    }

    await db.execute({
      sql: `
        UPDATE romaneios
        SET status = 'EXPEDIDO',
            expedido_at = CURRENT_TIMESTAMP,
            operador_expedicao_nome = ?
        WHERE id = ?
      `,
      args: [operador_nome, romaneio_id]
    })

    if (rom.pedido_id) {
      await db.execute({
        sql: `
          UPDATE pedidos
          SET status = 'EXPEDIDO',
              expedido_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        args: [rom.pedido_id]
      })
    }

    return { success: true }
  } catch (err) {
    console.error('Erro ao expedir romaneio:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Exclui um romaneio não expedido devolvendo todas as caixas ao estoque disponível
 */
export async function excluirRomaneio(romaneio_id) {
  try {
    await assertPermissao(['saida', 'expedicao', 'pedidos'])
    const romRes = await db.execute({ sql: 'SELECT id, status, pedido_id FROM romaneios WHERE id = ?', args: [romaneio_id] })
    if (romRes.rows.length === 0) return { success: false, error: 'Romaneio não encontrado.' }
    const rom = romRes.rows[0]
    if (rom.status === 'EXPEDIDO') {
      return { success: false, error: 'Não é possível excluir um romaneio já expedido.' }
    }

    const itensRes = await db.execute({
      sql: `
        SELECT ri.id, ri.caixa_id, ec.endereco
        FROM romaneios_itens ri
        JOIN estoque_caixas ec ON ri.caixa_id = ec.id
        WHERE ri.romaneio_id = ?
      `,
      args: [romaneio_id]
    })

    const enderecosAfetados = new Set()
    for (const item of itensRes.rows) {
      if (item.endereco) enderecosAfetados.add(item.endereco)
      await db.execute({
        sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [item.caixa_id]
      })
    }

    await db.execute({ sql: `DELETE FROM romaneios_itens WHERE romaneio_id = ?`, args: [romaneio_id] })
    await db.execute({ sql: `DELETE FROM romaneios WHERE id = ?`, args: [romaneio_id] })

    if (enderecosAfetados.size > 0) {
      await recalcularPosicaoEnderecos([...enderecosAfetados])
    }

    if (rom.pedido_id) {
      await db.execute({
        sql: `
          UPDATE pedidos
          SET status = CASE WHEN status IN ('EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA') THEN 'LIBERADO' ELSE status END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        args: [rom.pedido_id]
      })
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
