import { db } from '../lib/db'
import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'
import { recalcularPosicaoEnderecos } from './movimentacoes'
import { assertPermissao } from '../lib/authGuard'

async function gerarProximoCodigoPedido() {
  const res = await db.execute("SELECT codigo FROM pedidos ORDER BY id DESC LIMIT 1")
  let seq = 1
  if (res.rows.length > 0 && res.rows[0].codigo) {
    const match = String(res.rows[0].codigo).match(/PED-(\d+)/i)
    if (match) seq = parseInt(match[1], 10) + 1
  }
  return `PED-${String(seq).padStart(4, '0')}`
}

function consolidarItensPedido(itens = []) {
  const consolidados = new Map()
  for (const item of itens) {
    const pid = Number(item.produto_id)
    const kg = Number(item.qtd_kg_solicitada)
    const cx =
      item.qtd_caixas_solicitada !== '' && item.qtd_caixas_solicitada != null
        ? Number(item.qtd_caixas_solicitada)
        : null
    const unid = item.unidade_solicitada === 'CX' ? 'CX' : 'KG'
    const qtdExib =
      item.qtd_solicitada_exibicao !== '' && item.qtd_solicitada_exibicao != null
        ? Number(item.qtd_solicitada_exibicao)
        : unid === 'CX' && cx
          ? cx
          : kg

    if (!pid || !Number.isFinite(kg) || kg <= 0) {
      throw new Error('Todos os itens do pedido devem ter produto selecionado e peso (kg) maior que zero.')
    }

    if (consolidados.has(pid)) {
      const prev = consolidados.get(pid)
      prev.qtd_kg_solicitada = Number((prev.qtd_kg_solicitada + kg).toFixed(3))
      if (cx !== null) prev.qtd_caixas_solicitada = (prev.qtd_caixas_solicitada || 0) + cx
      if (prev.unidade_solicitada === unid) {
        prev.qtd_solicitada_exibicao = Number(((prev.qtd_solicitada_exibicao || 0) + qtdExib).toFixed(3))
      } else {
        prev.unidade_solicitada = 'KG'
        prev.qtd_solicitada_exibicao = prev.qtd_kg_solicitada
      }
      if (item.observacao && !prev.observacao) prev.observacao = String(item.observacao).trim()
    } else {
      consolidados.set(pid, {
        produto_id: pid,
        qtd_kg_solicitada: Number(kg.toFixed(3)),
        qtd_caixas_solicitada: cx !== null && Number.isFinite(cx) && cx > 0 ? cx : null,
        unidade_solicitada: unid,
        qtd_solicitada_exibicao: Number((qtdExib || kg).toFixed(3)),
        observacao: String(item.observacao || '').trim()
      })
    }
  }
  return Array.from(consolidados.values())
}

export const pedidosQueries = {
  /** Lista clientes cadastrados (BEEF CONTAINER LIMITADA vem marcada como padrão) */
  async listarClientes() {
    if (isApiEnabled()) {
      return (await apiRequest('/api/cadastros/clientes')).data
    }
    await assertPermissao(['pedidos', 'pedidos_consultar', 'saida', 'expedicao'], { write: false, bloquearCliente: true })
    const res = await db.execute(`
      SELECT *
      FROM clientes
      WHERE ativo = 1
      ORDER BY is_padrao DESC, razao_social ASC
    `)
    return res.rows
  },

  /** Cadastra um novo cliente para uso futuro em pedidos */
  async criarCliente(dados) {
    if (isApiEnabled()) {
      const res = await apiRequest('/api/cadastros/clientes', {
        method: 'POST',
        body: dados,
      })
      return { id: res.id, ...dados }
    }
    await assertPermissao('pedidos')
    const razao = (dados.razao_social || '').trim()
    const fantasia = (dados.nome_fantasia || razao).trim()
    if (!razao) throw new Error('Informe a Razão Social do cliente.')

    const res = await db.execute({
      sql: `
        INSERT INTO clientes (
          codigo, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual,
          endereco, numero, complemento, bairro, cep, cidade, uf, pais,
          telefone, icms, is_padrao, ativo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      args: [
        (dados.codigo || '').trim() || null,
        razao,
        fantasia,
        (dados.cnpj_cpf || '').trim(),
        (dados.inscricao_estadual || '').trim(),
        (dados.endereco || '').trim(),
        (dados.numero || '').trim(),
        (dados.complemento || '').trim(),
        (dados.bairro || '').trim(),
        (dados.cep || '').trim(),
        (dados.cidade || '').trim(),
        (dados.uf || '').trim().toUpperCase(),
        (dados.pais || 'BRASIL').trim(),
        (dados.telefone || '').trim(),
        (dados.icms || 'CONTRIBUINTE').trim(),
        dados.is_padrao ? 1 : 0
      ]
    })

    const id = Number(res.lastInsertRowid)
    if (dados.is_padrao) {
      await db.execute({ sql: 'UPDATE clientes SET is_padrao = CASE WHEN id = ? THEN 1 ELSE 0 END', args: [id] })
    }
    const created = await db.execute({ sql: 'SELECT * FROM clientes WHERE id = ?', args: [id] })
    return created.rows[0]
  },

  /** Lista todos os produtos com saldo serializado disponível para separação */
  async listarSaldosProdutosParaPedido() {
    if (isApiEnabled()) {
      return (await apiRequest('/api/pedidos/saldos-produtos')).data
    }
    await assertPermissao(['pedidos', 'pedidos_consultar', 'saida', 'expedicao'], { write: false, bloquearCliente: true })
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
        COALESCE(ec.qtd_caixas, 0) AS qtd_caixas,
        COALESCE(ec.peso_medio_disp, hist.peso_medio_hist, 0) AS peso_medio_cx
      FROM produtos p
      LEFT JOIN (
        SELECT
          produto_id,
          ROUND(SUM(peso_kg), 3) AS saldo_kg,
          COUNT(*) AS qtd_caixas,
          ROUND(AVG(peso_kg), 4) AS peso_medio_disp
        FROM estoque_caixas
        WHERE status = 'DISPONIVEL'
        GROUP BY produto_id
      ) ec ON ec.produto_id = p.id
      LEFT JOIN (
        SELECT
          produto_id,
          ROUND(AVG(peso_kg), 4) AS peso_medio_hist
        FROM estoque_caixas
        GROUP BY produto_id
      ) hist ON hist.produto_id = p.id
      ORDER BY
        CASE WHEN COALESCE(ec.saldo_kg, 0) > 0 OR COALESCE(ec.qtd_caixas, 0) > 0 THEN 0 ELSE 1 END ASC,
        p.descricao ASC
    `)
    return res.rows
  },

  /** Lista pedidos com totais solicitados, separados, conferidos e romaneio vinculado */
  async listarPedidos(filtros = {}) {
    if (isApiEnabled()) {
      return (await apiRequest(`/api/pedidos${buildQueryString({
        status: filtros.status && filtros.status !== 'TODOS' ? filtros.status : undefined,
        q: filtros.busca || filtros.q,
      })}`)).data
    }
    await assertPermissao(['pedidos_consultar', 'pedidos', 'saida', 'expedicao'], { write: false, bloquearCliente: true })
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
    if (isApiEnabled()) {
      try {
        return (await apiRequest(`/api/pedidos/${id}`)).data
      } catch {
        return null
      }
    }
    await assertPermissao(['pedidos_consultar', 'pedidos', 'saida', 'expedicao'], { write: false, bloquearCliente: true })
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

    let clienteDados = null
    if (pedido.cliente_id) {
      const cliRes = await db.execute({ sql: 'SELECT * FROM clientes WHERE id = ?', args: [pedido.cliente_id] })
      clienteDados = cliRes.rows[0] || null
    }
    if (!clienteDados) {
      const padRes = await db.execute('SELECT * FROM clientes WHERE is_padrao = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1')
      clienteDados = padRes.rows[0] || null
    }

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
            SELECT ROUND(AVG(ec.peso_kg), 4)
            FROM estoque_caixas ec
            WHERE ec.produto_id = pi.produto_id AND ec.status = 'DISPONIVEL'
          ), (
            SELECT ROUND(AVG(ec2.peso_kg), 4)
            FROM estoque_caixas ec2
            WHERE ec2.produto_id = pi.produto_id
          ), 0) AS peso_medio_cx,
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
      cliente_dados: clienteDados,
      itens: itensRes.rows,
      caixas: caixasRomaneio
    }
  },

  /** Cria novo pedido com itens */
  async criarPedido({
    titulo,
    cliente_id = null,
    cliente = 'BEEF CONTAINER LIMITADA',
    vendedor_id = null,
    forma_pagamento_id = null,
    local_cobranca_id = null,
    natureza_id = null,
    marchante = '',
    pagamento_na_entrega,
    previsao_entrega = null,
    observacoes = '',
    origem_pedido,
    setor_solicitante,
    itens = [],
    operador,
    liberar = true,
    ignorar_trava_estoque = false,
  }) {
    if (isApiEnabled()) {
      return apiRequest('/api/pedidos', {
        method: 'POST',
        body: {
          titulo,
          cliente_id,
          cliente,
          vendedor_id,
          forma_pagamento_id,
          local_cobranca_id,
          natureza_id,
          marchante,
          pagamento_na_entrega,
          previsao_entrega,
          observacoes,
          origem_pedido,
          setor_solicitante,
          itens,
          liberar,
          ignorar_trava_estoque,
        },
      })
    }
    await assertPermissao('pedidos')
    const tituloTrim = (titulo || '').trim()
    if (!tituloTrim) throw new Error('Informe o título do pedido (ex: Carga Quinta-feira).')
    if (!Array.isArray(itens) || itens.length === 0) throw new Error('Adicione pelo menos um item ao pedido.')

    const itensConsolidados = consolidarItensPedido(itens)

    let resolvedClienteId = cliente_id ? Number(cliente_id) : null
    let resolvedClienteNome = (cliente || '').trim()
    if (!resolvedClienteId) {
      const padRes = await db.execute('SELECT id, razao_social FROM clientes WHERE is_padrao = 1 AND ativo = 1 LIMIT 1')
      if (padRes.rows.length > 0) {
        resolvedClienteId = padRes.rows[0].id
        if (!resolvedClienteNome) resolvedClienteNome = padRes.rows[0].razao_social
      }
    } else if (!resolvedClienteNome) {
      const cliRes = await db.execute({ sql: 'SELECT razao_social FROM clientes WHERE id = ?', args: [resolvedClienteId] })
      if (cliRes.rows.length > 0) resolvedClienteNome = cliRes.rows[0].razao_social
    }
    if (!resolvedClienteNome) resolvedClienteNome = 'BEEF CONTAINER LIMITADA'

    const codigo = await gerarProximoCodigoPedido()
    const status = liberar ? 'LIBERADO' : 'RASCUNHO'

    const res = await db.execute({
      sql: `
        INSERT INTO pedidos (
          codigo, titulo, cliente_id, cliente, previsao_entrega, observacoes, status,
          criado_por_id, criado_por_nome, liberado_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'LIBERADO' THEN CURRENT_TIMESTAMP ELSE NULL END)
      `,
      args: [
        codigo,
        tituloTrim,
        resolvedClienteId,
        resolvedClienteNome,
        previsao_entrega || null,
        (observacoes || '').trim(),
        status,
        operador?.id || null,
        operador?.nome || 'Admin',
        status
      ]
    })

    const pedidoId = Number(res.lastInsertRowid)
    for (const item of itensConsolidados) {
      await db.execute({
        sql: `
          INSERT INTO pedidos_itens (
            pedido_id, produto_id, qtd_kg_solicitada, qtd_caixas_solicitada,
            unidade_solicitada, qtd_solicitada_exibicao, observacao
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          pedidoId,
          item.produto_id,
          item.qtd_kg_solicitada,
          item.qtd_caixas_solicitada,
          item.unidade_solicitada,
          item.qtd_solicitada_exibicao,
          item.observacao
        ]
      })
    }

    return { id: pedidoId, codigo, status }
  },

  /** Atualiza pedido em status RASCUNHO ou LIBERADO */
  async atualizarPedido({
    id,
    titulo,
    cliente_id = null,
    cliente = 'BEEF CONTAINER LIMITADA',
    vendedor_id,
    forma_pagamento_id,
    local_cobranca_id,
    natureza_id,
    marchante,
    pagamento_na_entrega,
    previsao_entrega = null,
    observacoes = '',
    itens = [],
    liberar,
  }) {
    if (isApiEnabled()) {
      return apiRequest(`/api/pedidos/${id}`, {
        method: 'PUT',
        body: {
          titulo,
          cliente_id,
          cliente,
          vendedor_id,
          forma_pagamento_id,
          local_cobranca_id,
          natureza_id,
          marchante,
          pagamento_na_entrega,
          previsao_entrega,
          observacoes,
          itens,
          liberar,
        },
      })
    }
    await assertPermissao('pedidos')
    const check = await db.execute({ sql: 'SELECT id, status, cliente_id FROM pedidos WHERE id = ?', args: [id] })
    if (check.rows.length === 0) throw new Error('Pedido não encontrado.')
    const atual = check.rows[0]
    if (!['RASCUNHO', 'LIBERADO'].includes(atual.status)) {
      throw new Error(`Não é possível editar itens de um pedido no status ${atual.status}.`)
    }

    const tituloTrim = (titulo || '').trim()
    if (!tituloTrim) throw new Error('Informe o título do pedido.')
    if (!Array.isArray(itens) || itens.length === 0) throw new Error('O pedido precisa de pelo menos um item.')

    const itensConsolidados = consolidarItensPedido(itens)
    const novoStatus = liberar === true ? 'LIBERADO' : liberar === false ? 'RASCUNHO' : atual.status
    const resolvedClienteId = cliente_id ? Number(cliente_id) : atual.cliente_id || null

    await db.execute({
      sql: `
        UPDATE pedidos
        SET titulo = ?,
            cliente_id = ?,
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
        resolvedClienteId,
        (cliente || 'BEEF CONTAINER LIMITADA').trim() || 'BEEF CONTAINER LIMITADA',
        previsao_entrega || null,
        (observacoes || '').trim(),
        novoStatus,
        novoStatus,
        id
      ]
    })

    await db.execute({ sql: 'DELETE FROM pedidos_itens WHERE pedido_id = ?', args: [id] })
    for (const item of itensConsolidados) {
      await db.execute({
        sql: `
          INSERT INTO pedidos_itens (
            pedido_id, produto_id, qtd_kg_solicitada, qtd_caixas_solicitada,
            unidade_solicitada, qtd_solicitada_exibicao, observacao
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          item.produto_id,
          item.qtd_kg_solicitada,
          item.qtd_caixas_solicitada,
          item.unidade_solicitada,
          item.qtd_solicitada_exibicao,
          item.observacao
        ]
      })
    }

    return { id, status: novoStatus }
  },

  /** Libera um pedido RASCUNHO para separação */
  async liberarPedido(id, { ignorar_trava_estoque = false } = {}) {
    if (isApiEnabled()) {
      return apiRequest(`/api/pedidos/${id}/liberar`, {
        method: 'POST',
        body: { ignorar_trava_estoque },
      })
    }
    await assertPermissao('pedidos')
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
    if (isApiEnabled()) {
      return apiRequest(`/api/pedidos/${id}/cancelar`, { method: 'POST' })
    }
    await assertPermissao('pedidos')
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
          SELECT ri.caixa_id, ec.ean_caixa, ec.endereco
          FROM romaneios_itens ri
          JOIN estoque_caixas ec ON ri.caixa_id = ec.id
          WHERE ri.romaneio_id = ?
        `,
        args: [rom.id]
      })

      for (const item of itensRes.rows) {
        if (item.endereco) enderecosAfetados.add(item.endereco)
        await db.execute({
          sql: `
            UPDATE estoque_caixas
            SET status = 'DISPONIVEL',
                pedido_reservado_id = NULL,
                pedido_reservado_codigo = NULL,
                romaneio_reservado_id = NULL,
                romaneio_reservado_codigo = NULL,
                cliente_reservado_nome = NULL,
                reservado_em = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          args: [item.caixa_id]
        })
        await db.execute({
          sql: `
            INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
            VALUES (?, ?, 'ESTORNO', ?, ?)
          `,
          args: [
            item.caixa_id,
            item.ean_caixa || '',
            `Cancelamento do ${ped.codigo} (${rom.codigo})`,
            operador?.nome || 'Admin'
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
  },

  /** Clona um pedido existente em 1 clique */
  async clonarPedido(id, { liberar = false } = {}) {
    if (!isApiEnabled()) {
      throw new Error('Clonagem rápida requer o Backend PostgreSQL ativo (VITE_API_URL).')
    }
    return apiRequest(`/api/pedidos/${id}/clonar`, {
      method: 'POST',
      body: { liberar },
    })
  },

  /** Gera Ordem de Produção automática (ou carrega preview para abrir na tela de OP) */
  async gerarOpAutomatica(id, { preview_only = false } = {}) {
    if (!isApiEnabled()) {
      throw new Error('Geração automática de OP por pedido requer o Backend PostgreSQL ativo (VITE_API_URL).')
    }
    return apiRequest(`/api/pedidos/${id}/gerar-op`, {
      method: 'POST',
      body: preview_only ? { preview_only: true } : {},
    })
  },
}
