import { db } from '../lib/db'
import { recalcularPosicaoEnderecos } from './movimentacoes'

async function gerarProximoCodigoPedido() {
  const res = await db.execute("SELECT codigo FROM pedidos ORDER BY id DESC LIMIT 1")
  let seq = 1
  if (res.rows.length > 0 && res.rows[0].codigo) {
    const match = String(res.rows[0].codigo).match(/PED-(\d+)/i)
    if (match) seq = parseInt(match[1], 10) + 1
  }
  return `PED-${String(seq).padStart(4, '0')}`
}

export const pedidosQueries = {
  /** Lista todos os produtos com saldo serializado disponível para separação */
  async listarSaldosProdutosParaPedido() {
    const res = await db.execute(`
      SELECT
        p.id,
        p.codigo,
        p.ean,
        p.descricao,
        p.tipo_produto,
        p.unidade,
        p.grupo,
        COALESCE(ec.saldo_kg, 0) AS saldo_kg,
        COALESCE(ec.qtd_caixas, 0) AS qtd_caixas
      FROM produtos p
      LEFT JOIN (
        SELECT
          produto_id,
          ROUND(SUM(peso_kg), 3) AS saldo_kg,
          COUNT(*) AS qtd_caixas
        FROM estoque_caixas
        WHERE status = 'DISPONIVEL'
        GROUP BY produto_id
      ) ec ON ec.produto_id = p.id
      ORDER BY p.descricao ASC
    `)
    return res.rows
  },

  /** Lista pedidos com totais solicitados, separados, conferidos e romaneio vinculado */
  async listarPedidos(filtros = {}) {
    let where = '1=1'
    const args = []

    if (filtros.status && filtros.status !== 'TODOS') {
      where += ' AND ped.status = ?'
      args.push(filtros.status)
    }
    if (filtros.busca && filtros.busca.trim()) {
      const q = `%${filtros.busca.trim()}%`
      where += ' AND (ped.codigo LIKE ? OR ped.titulo LIKE ? OR ped.cliente LIKE ? OR ped.criado_por_nome LIKE ?)'
      args.push(q, q, q, q)
    }
    if (filtros.dataInicio) {
      where += ' AND DATE(ped.created_at) >= ?'
      args.push(filtros.dataInicio)
    }
    if (filtros.dataFim) {
      where += ' AND DATE(ped.created_at) <= ?'
      args.push(filtros.dataFim)
    }

    const res = await db.execute({
      sql: `
        SELECT
          ped.*,
          COALESCE((SELECT COUNT(*) FROM pedidos_itens pi WHERE pi.pedido_id = ped.id), 0) AS qtd_itens,
          COALESCE((SELECT ROUND(SUM(pi.qtd_kg_solicitada), 3) FROM pedidos_itens pi WHERE pi.pedido_id = ped.id), 0) AS total_kg_solicitado,
          COALESCE((SELECT SUM(COALESCE(pi.qtd_caixas_solicitada, 0)) FROM pedidos_itens pi WHERE pi.pedido_id = ped.id), 0) AS total_caixas_solicitadas,
          r.id AS romaneio_id,
          r.codigo AS romaneio_codigo,
          r.status AS romaneio_status,
          r.operador_nome AS separador_nome,
          r.operador_conferencia_nome,
          r.operador_expedicao_nome,
          r.conferido_at,
          COALESCE((SELECT ROUND(SUM(ri.peso_kg), 3) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id), 0) AS total_kg_separado,
          COALESCE((SELECT COUNT(*) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id), 0) AS total_caixas_separadas,
          COALESCE((SELECT COUNT(*) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id AND ri.conferido = 1), 0) AS qtd_conferidas,
          COALESCE((SELECT ROUND(SUM(ri.peso_kg), 3) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id AND ri.conferido = 1), 0) AS peso_conferido
        FROM pedidos ped
        LEFT JOIN romaneios r ON r.id = (
          SELECT id FROM romaneios WHERE pedido_id = ped.id ORDER BY id DESC LIMIT 1
        )
        WHERE ${where}
        ORDER BY ped.id DESC
      `,
      args
    })
    return res.rows
  },

  /** Retorna pedido completo com itens, comparação solicitado vs separado e romaneio vinculado */
  async obterPedido(id) {
    const pedRes = await db.execute({
      sql: `
        SELECT ped.*,
          r.id AS romaneio_id,
          r.codigo AS romaneio_codigo,
          r.status AS romaneio_status,
          r.operador_nome AS separador_nome,
          r.operador_conferencia_nome,
          r.operador_expedicao_nome,
          r.created_at AS romaneio_created_at,
          r.conferido_at,
          r.expedido_at AS romaneio_expedido_at
        FROM pedidos ped
        LEFT JOIN romaneios r ON r.id = (
          SELECT id FROM romaneios WHERE pedido_id = ped.id ORDER BY id DESC LIMIT 1
        )
        WHERE ped.id = ?
      `,
      args: [id]
    })
    if (pedRes.rows.length === 0) return null
    const pedido = pedRes.rows[0]

    const itensRes = await db.execute({
      sql: `
        SELECT
          pi.*,
          p.codigo AS produto_codigo,
          p.ean AS produto_ean,
          p.descricao AS produto_descricao,
          p.unidade,
          p.grupo,
          COALESCE((
            SELECT ROUND(SUM(ec.peso_kg), 3)
            FROM estoque_caixas ec
            WHERE ec.produto_id = pi.produto_id AND ec.status = 'DISPONIVEL'
          ), 0) AS estoque_disponivel_kg,
          COALESCE((
            SELECT COUNT(*)
            FROM estoque_caixas ec
            WHERE ec.produto_id = pi.produto_id AND ec.status = 'DISPONIVEL'
          ), 0) AS estoque_disponivel_caixas,
          COALESCE((
            SELECT ROUND(SUM(ri.peso_kg), 3)
            FROM romaneios_itens ri
            WHERE ri.romaneio_id = ? AND ri.produto_id = pi.produto_id
          ), 0) AS kg_separado,
          COALESCE((
            SELECT COUNT(*)
            FROM romaneios_itens ri
            WHERE ri.romaneio_id = ? AND ri.produto_id = pi.produto_id
          ), 0) AS caixas_separadas,
          COALESCE((
            SELECT COUNT(*)
            FROM romaneios_itens ri
            WHERE ri.romaneio_id = ? AND ri.produto_id = pi.produto_id AND ri.conferido = 1
          ), 0) AS caixas_conferidas
        FROM pedidos_itens pi
        JOIN produtos p ON pi.produto_id = p.id
        WHERE pi.pedido_id = ?
        ORDER BY pi.id ASC
      `,
      args: [pedido.romaneio_id || -1, pedido.romaneio_id || -1, pedido.romaneio_id || -1, id]
    })

    let caixasRomaneio = []
    if (pedido.romaneio_id) {
      const caixasRes = await db.execute({
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
            CASE WHEN EXISTS (
              SELECT 1 FROM pedidos_itens pi WHERE pi.pedido_id = ? AND pi.produto_id = ri.produto_id
            ) THEN 0 ELSE 1 END AS extra_fora_pedido
          FROM romaneios_itens ri
          JOIN estoque_caixas ec ON ri.caixa_id = ec.id
          JOIN produtos p ON ri.produto_id = p.id
          WHERE ri.romaneio_id = ?
          ORDER BY ri.id ASC
        `,
        args: [id, pedido.romaneio_id]
      })
      caixasRomaneio = caixasRes.rows
    }

    return {
      ...pedido,
      itens: itensRes.rows,
      caixas: caixasRomaneio
    }
  },

  /** Cria novo pedido com itens */
  async criarPedido({ titulo, cliente = 'PAVAN', previsao_entrega = null, observacoes = '', itens = [], operador, liberar = true }) {
    const tituloTrim = (titulo || '').trim()
    if (!tituloTrim) throw new Error('Informe o título do pedido (ex: Pedido PAVAN Semana 12).')
    if (!Array.isArray(itens) || itens.length === 0) throw new Error('Adicione pelo menos um item ao pedido.')

    const consolidados = new Map()
    for (const item of itens) {
      const pid = Number(item.produto_id)
      const kg = Number(item.qtd_kg_solicitada)
      const cx = item.qtd_caixas_solicitada !== '' && item.qtd_caixas_solicitada != null ? Number(item.qtd_caixas_solicitada) : null
      if (!pid || !Number.isFinite(kg) || kg <= 0) {
        throw new Error('Todos os itens do pedido devem ter produto selecionado e peso (kg) maior que zero.')
      }
      if (consolidados.has(pid)) {
        const prev = consolidados.get(pid)
        prev.qtd_kg_solicitada = Number((prev.qtd_kg_solicitada + kg).toFixed(3))
        if (cx !== null) prev.qtd_caixas_solicitada = (prev.qtd_caixas_solicitada || 0) + cx
        if (item.observacao && !prev.observacao) prev.observacao = String(item.observacao).trim()
      } else {
        consolidados.set(pid, {
          produto_id: pid,
          qtd_kg_solicitada: Number(kg.toFixed(3)),
          qtd_caixas_solicitada: cx !== null && Number.isFinite(cx) && cx > 0 ? cx : null,
          observacao: String(item.observacao || '').trim()
        })
      }
    }

    const codigo = await gerarProximoCodigoPedido()
    const status = liberar ? 'LIBERADO' : 'RASCUNHO'

    const res = await db.execute({
      sql: `
        INSERT INTO pedidos (
          codigo, titulo, cliente, previsao_entrega, observacoes, status,
          criado_por_id, criado_por_nome, liberado_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'LIBERADO' THEN CURRENT_TIMESTAMP ELSE NULL END)
      `,
      args: [
        codigo,
        tituloTrim,
        (cliente || 'PAVAN').trim() || 'PAVAN',
        previsao_entrega || null,
        (observacoes || '').trim(),
        status,
        operador?.id || null,
        operador?.nome || 'Admin',
        status
      ]
    })

    const pedidoId = Number(res.lastInsertRowid)
    for (const item of consolidados.values()) {
      await db.execute({
        sql: `
          INSERT INTO pedidos_itens (pedido_id, produto_id, qtd_kg_solicitada, qtd_caixas_solicitada, observacao)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [pedidoId, item.produto_id, item.qtd_kg_solicitada, item.qtd_caixas_solicitada, item.observacao]
      })
    }

    return { id: pedidoId, codigo, status }
  },

  /** Atualiza pedido em status RASCUNHO ou LIBERADO */
  async atualizarPedido({ id, titulo, cliente = 'PAVAN', previsao_entrega = null, observacoes = '', itens = [], liberar }) {
    const check = await db.execute({ sql: 'SELECT id, status FROM pedidos WHERE id = ?', args: [id] })
    if (check.rows.length === 0) throw new Error('Pedido não encontrado.')
    const atual = check.rows[0]
    if (!['RASCUNHO', 'LIBERADO'].includes(atual.status)) {
      throw new Error(`Não é possível editar itens de um pedido no status ${atual.status}.`)
    }

    const tituloTrim = (titulo || '').trim()
    if (!tituloTrim) throw new Error('Informe o título do pedido.')
    if (!Array.isArray(itens) || itens.length === 0) throw new Error('O pedido precisa de pelo menos um item.')

    const consolidados = new Map()
    for (const item of itens) {
      const pid = Number(item.produto_id)
      const kg = Number(item.qtd_kg_solicitada)
      const cx = item.qtd_caixas_solicitada !== '' && item.qtd_caixas_solicitada != null ? Number(item.qtd_caixas_solicitada) : null
      if (!pid || !Number.isFinite(kg) || kg <= 0) {
        throw new Error('Todos os itens devem ter produto e peso (kg) maior que zero.')
      }
      if (consolidados.has(pid)) {
        const prev = consolidados.get(pid)
        prev.qtd_kg_solicitada = Number((prev.qtd_kg_solicitada + kg).toFixed(3))
        if (cx !== null) prev.qtd_caixas_solicitada = (prev.qtd_caixas_solicitada || 0) + cx
      } else {
        consolidados.set(pid, {
          produto_id: pid,
          qtd_kg_solicitada: Number(kg.toFixed(3)),
          qtd_caixas_solicitada: cx !== null && Number.isFinite(cx) && cx > 0 ? cx : null,
          observacao: String(item.observacao || '').trim()
        })
      }
    }

    const novoStatus = liberar === true ? 'LIBERADO' : liberar === false ? 'RASCUNHO' : atual.status

    await db.execute({
      sql: `
        UPDATE pedidos
        SET titulo = ?,
            cliente = ?,
            previsao_entrega = ?,
            observacoes = ?,
            status = ?,
            liberado_at = CASE WHEN ? = 'LIBERADO' AND liberado_at IS NULL THEN CURRENT_TIMESTAMP ELSE liberado_at END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [
        tituloTrim,
        (cliente || 'PAVAN').trim() || 'PAVAN',
        previsao_entrega || null,
        (observacoes || '').trim(),
        novoStatus,
        novoStatus,
        id
      ]
    })

    await db.execute({ sql: 'DELETE FROM pedidos_itens WHERE pedido_id = ?', args: [id] })
    for (const item of consolidados.values()) {
      await db.execute({
        sql: `
          INSERT INTO pedidos_itens (pedido_id, produto_id, qtd_kg_solicitada, qtd_caixas_solicitada, observacao)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [id, item.produto_id, item.qtd_kg_solicitada, item.qtd_caixas_solicitada, item.observacao]
      })
    }

    return { id, status: novoStatus }
  },

  /** Libera um pedido RASCUNHO para separação */
  async liberarPedido(id) {
    const check = await db.execute({ sql: 'SELECT status FROM pedidos WHERE id = ?', args: [id] })
    if (check.rows.length === 0) throw new Error('Pedido não encontrado.')
    if (check.rows[0].status !== 'RASCUNHO') {
      throw new Error('Somente pedidos em RASCUNHO podem ser liberados.')
    }
    await db.execute({
      sql: `
        UPDATE pedidos
        SET status = 'LIBERADO',
            liberado_at = COALESCE(liberado_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [id]
    })
  },

  /** Cancela um pedido antes da expedição e devolve eventuais caixas reservadas para DISPONIVEL */
  async cancelarPedido(id, operador) {
    const pedRes = await db.execute({ sql: 'SELECT id, codigo, status FROM pedidos WHERE id = ?', args: [id] })
    if (pedRes.rows.length === 0) throw new Error('Pedido não encontrado.')
    const ped = pedRes.rows[0]
    if (ped.status === 'EXPEDIDO') throw new Error('Não é possível cancelar um pedido já expedido.')
    if (ped.status === 'CANCELADO') return

    const romRes = await db.execute({
      sql: "SELECT id, codigo, status FROM romaneios WHERE pedido_id = ? AND status != 'EXPEDIDO'",
      args: [id]
    })

    const enderecosAfetados = new Set()
    for (const rom of romRes.rows) {
      const itensRes = await db.execute({
        sql: `
          SELECT ri.caixa_id, ec.endereco
          FROM romaneios_itens ri
          JOIN estoque_caixas ec ON ri.caixa_id = ec.id
          WHERE ri.romaneio_id = ?
        `,
        args: [rom.id]
      })

      for (const item of itensRes.rows) {
        if (item.endereco) enderecosAfetados.add(item.endereco)
        await db.execute({
          sql: "UPDATE estoque_caixas SET status = 'DISPONIVEL', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          args: [item.caixa_id]
        })
        await db.execute({
          sql: `
            INSERT INTO caixas_historico (caixa_id, tipo_evento, endereco_origem, endereco_destino, operador_id, operador_nome, observacao)
            VALUES (?, 'ESTORNO', ?, ?, ?, ?, ?)
          `,
          args: [
            item.caixa_id,
            item.endereco || null,
            item.endereco || null,
            operador?.id || null,
            operador?.nome || 'Admin',
            `Cancelamento do ${ped.codigo} (${rom.codigo})`
          ]
        })
      }

      await db.execute({ sql: 'DELETE FROM romaneios_itens WHERE romaneio_id = ?', args: [rom.id] })
      await db.execute({ sql: 'DELETE FROM romaneios WHERE id = ?', args: [rom.id] })
    }

    if (enderecosAfetados.size > 0) {
      await recalcularPosicaoEnderecos([...enderecosAfetados])
    }

    await db.execute({
      sql: `
        UPDATE pedidos
        SET status = 'CANCELADO',
            cancelado_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [id]
    })
  }
}
