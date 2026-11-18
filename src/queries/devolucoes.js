import { db } from '../lib/db'
import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient'
import { assertPermissao } from '../lib/authGuard'
import { recalcularPosicaoEnderecos } from './movimentacoes'
import { ensureRastreabilidadeSchema } from './taras'
import { useAppStore } from '../store/appStore'

const PERM_READ = ['devolucao', 'devolucao_fiscal', 'saida', 'expedicao', 'recebimento', 'pedidos', 'financeiro_pedidos']
const PERM_WRITE = ['devolucao', 'saida', 'expedicao', 'recebimento']
const PERM_FISCAL = ['devolucao_fiscal', 'pedidos', 'financeiro_pedidos']

export const MOTIVOS_DEVOLUCAO = [
  {
    key: 'DIVERGENCIA_PEDIDO',
    label: 'Divergência no Pedido',
    desc: 'Caixa enviada errada, corte trocado ou sobra na entrega',
    padraoAcao: 'DISPONIVEL',
    cor: '#38bdf8',
  },
  {
    key: 'LOCAL_FECHADO',
    label: 'Local Fechado',
    desc: 'Estabelecimento fechado ou cliente ausente para receber',
    padraoAcao: 'DISPONIVEL',
    cor: '#f59e0b',
  },
  {
    key: 'VALIDADE',
    label: 'Validade / Qualidade',
    desc: 'Recusa por validade curta ou necessidade de inspeção',
    padraoAcao: 'BLOQUEADO',
    cor: '#ef4444',
  },
  {
    key: 'AVARIA',
    label: 'Avaria / Embalagem',
    desc: 'Caixa ou embalagem danificada no transporte',
    padraoAcao: 'BLOQUEADO',
    cor: '#f97316',
  },
  {
    key: 'OUTROS',
    label: 'Recusa / Outros',
    desc: 'Outro motivo comercial ou operacional',
    padraoAcao: 'DISPONIVEL',
    cor: '#94a3b8',
  },
]

const MOTIVOS_LABEL = Object.fromEntries(MOTIVOS_DEVOLUCAO.map((m) => [m.key, m.label]))

let schemaReadyPromise = null
async function ensureDevolucoesSchema() {
  if (isApiEnabled()) return
  if (schemaReadyPromise) return schemaReadyPromise
  schemaReadyPromise = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS devolucoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL,
        motivo TEXT NOT NULL,
        acao_estoque TEXT NOT NULL DEFAULT 'DISPONIVEL',
        endereco_destino TEXT NOT NULL DEFAULT 'REC',
        pedido_id INTEGER,
        pedido_codigo TEXT NOT NULL DEFAULT '',
        romaneio_id INTEGER,
        romaneio_codigo TEXT NOT NULL DEFAULT '',
        cliente_nome TEXT NOT NULL DEFAULT '',
        observacoes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'CONCLUIDA_FISICA',
        status_fiscal TEXT NOT NULL DEFAULT 'PENDENTE_FATURAMENTO',
        numero_nf_devolucao TEXT NOT NULL DEFAULT '',
        qtd_caixas INTEGER NOT NULL DEFAULT 0,
        peso_total_kg REAL NOT NULL DEFAULT 0,
        valor_estimado REAL NOT NULL DEFAULT 0,
        operador_id INTEGER,
        operador_nome TEXT NOT NULL DEFAULT '',
        fiscal_tratado_por_nome TEXT NOT NULL DEFAULT '',
        fiscal_tratado_em DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS devolucao_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        devolucao_id INTEGER NOT NULL,
        caixa_id INTEGER NOT NULL,
        ean_caixa TEXT NOT NULL,
        produto_id INTEGER NOT NULL,
        produto_codigo TEXT NOT NULL DEFAULT '',
        produto_descricao TEXT NOT NULL DEFAULT '',
        lote TEXT NOT NULL DEFAULT '',
        validade TEXT,
        peso_kg REAL NOT NULL DEFAULT 0,
        preco_unitario REAL NOT NULL DEFAULT 0,
        pedido_id INTEGER,
        pedido_codigo TEXT NOT NULL DEFAULT '',
        romaneio_id INTEGER,
        romaneio_codigo TEXT NOT NULL DEFAULT '',
        cliente_nome TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  })().catch((err) => {
    schemaReadyPromise = null
    throw err
  })
  return schemaReadyPromise
}

async function localizarUltimoEmbarqueCaixaLocal(caixaId, produtoId) {
  const vincRes = await db.execute({
    sql: `
      SELECT
        r.id AS romaneio_id,
        r.codigo AS romaneio_codigo,
        r.cliente AS romaneio_cliente,
        r.expedido_at,
        r.pedido_id,
        p.codigo AS pedido_codigo,
        p.titulo AS pedido_titulo,
        p.cliente AS pedido_cliente
      FROM romaneios_itens ri
      JOIN romaneios r ON r.id = ri.romaneio_id
      LEFT JOIN pedidos p ON p.id = r.pedido_id
      WHERE ri.caixa_id = ?
      ORDER BY r.expedido_at DESC, ri.id DESC
      LIMIT 1
    `,
    args: [caixaId],
  })
  const v = vincRes.rows[0] || null
  let precoUnitario = 0
  if (v?.pedido_id) {
    try {
      const prRes = await db.execute({
        sql: `SELECT preco_unitario FROM pedidos_itens WHERE pedido_id = ? AND produto_id = ? LIMIT 1`,
        args: [v.pedido_id, produtoId],
      })
      if (prRes.rows[0]) {
        precoUnitario = Number(prRes.rows[0].preco_unitario || 0)
      }
    } catch {
      precoUnitario = 0
    }
  }
  return {
    pedido_id: v?.pedido_id || null,
    pedido_codigo: v?.pedido_codigo || '',
    pedido_titulo: v?.pedido_titulo || '',
    romaneio_id: v?.romaneio_id || null,
    romaneio_codigo: v?.romaneio_codigo || '',
    cliente_nome: v?.pedido_cliente || v?.romaneio_cliente || '',
    expedido_at: v?.expedido_at || null,
    preco_unitario: precoUnitario,
  }
}

export const devolucoesQueries = {
  async buscarCaixaParaDevolucao(ean) {
    const codigo = String(ean || '').trim()
    if (!codigo) throw new Error('Bipe ou informe o código EAN da caixa.')
    if (isApiEnabled()) {
      return (await apiRequest(`/api/devolucoes/buscar-caixa${buildQueryString({ ean: codigo })}`)).caixa
    }

    await assertPermissao(PERM_READ, { write: false, bloquearCliente: true })
    const semZeros = codigo.replace(/^0+/, '') || codigo
    const cxRes = await db.execute({
      sql: `
        SELECT
          ec.*,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao,
          p.grupo AS produto_grupo,
          COALESCE(p.valor_unitario, 0) AS prod_valor_unitario
        FROM estoque_caixas ec
        JOIN produtos p ON p.id = ec.produto_id
        WHERE ec.ean_caixa = ?
           OR LTRIM(ec.ean_caixa, '0') = ?
           OR CAST(ec.id AS TEXT) = ?
        ORDER BY CASE WHEN ec.ean_caixa = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
      args: [codigo, semZeros, codigo, codigo],
    })
    if (cxRes.rows.length === 0) {
      throw new Error(`Nenhuma caixa encontrada no WMS para o código "${codigo}".`)
    }
    const cx = cxRes.rows[0]
    if (cx.status !== 'SAIDA' && cx.status !== 'EXPEDIDA') {
      if (cx.status === 'DISPONIVEL') {
        throw new Error(`A caixa ${cx.ean_caixa} já consta como DISPONÍVEL no estoque (endereço ${cx.endereco || '-'}).`)
      }
      if (cx.status === 'RESERVADA') {
        throw new Error(
          `A caixa ${cx.ean_caixa} está RESERVADA em um romaneio ainda não expedido (${cx.romaneio_reservado_codigo || cx.pedido_reservado_codigo || '-'}). Estorne na tela Saída de Materiais.`,
        )
      }
      if (cx.status === 'BLOQUEADO') {
        throw new Error(`A caixa ${cx.ean_caixa} já está em QUARENTENA / BLOQUEADA no endereço ${cx.endereco || '-'}.`)
      }
      throw new Error(`A caixa ${cx.ean_caixa} está com status "${cx.status}" e não pode entrar por devolução de venda.`)
    }

    const origem = await localizarUltimoEmbarqueCaixaLocal(cx.id, cx.produto_id)
    const peso = Number(cx.peso_kg || 0)
    const preco = origem.preco_unitario > 0 ? origem.preco_unitario : Number(cx.prod_valor_unitario || 0)

    return {
      ...cx,
      peso_kg: peso,
      preco_unitario: preco,
      valor_estimado: Number((peso * preco).toFixed(2)),
      pedido_id: origem.pedido_id,
      pedido_codigo: origem.pedido_codigo,
      pedido_titulo: origem.pedido_titulo,
      romaneio_id: origem.romaneio_id,
      romaneio_codigo: origem.romaneio_codigo,
      cliente_nome: origem.cliente_nome,
      expedido_at: origem.expedido_at,
    }
  },

  async listarDevolucoes(filtros = {}) {
    if (isApiEnabled()) {
      return (
        await apiRequest(
          `/api/devolucoes${buildQueryString({
            status_fiscal: filtros.statusFiscal && filtros.statusFiscal !== 'TODOS' ? filtros.statusFiscal : undefined,
            motivo: filtros.motivo && filtros.motivo !== 'TODOS' ? filtros.motivo : undefined,
            q: filtros.busca || undefined,
          })}`,
        )
      ).data
    }

    await assertPermissao(PERM_FISCAL, { write: false, bloquearCliente: true })
    await ensureDevolucoesSchema()

    let where = '1=1'
    const args = []
    if (filtros.statusFiscal && filtros.statusFiscal !== 'TODOS') {
      where += ' AND status_fiscal = ?'
      args.push(filtros.statusFiscal)
    }
    if (filtros.motivo && filtros.motivo !== 'TODOS') {
      where += ' AND motivo = ?'
      args.push(filtros.motivo)
    }
    if (filtros.busca && filtros.busca.trim()) {
      const pat = `%${filtros.busca.trim().toUpperCase()}%`
      where += ' AND (UPPER(codigo) LIKE ? OR UPPER(pedido_codigo) LIKE ? OR UPPER(cliente_nome) LIKE ? OR UPPER(romaneio_codigo) LIKE ?)'
      args.push(pat, pat, pat, pat)
    }

    const res = await db.execute({
      sql: `SELECT * FROM devolucoes WHERE ${where} ORDER BY id DESC LIMIT 150`,
      args,
    })
    const lista = res.rows || []
    if (lista.length === 0) return []

    const ids = lista.map((d) => d.id)
    const ph = ids.map(() => '?').join(',')
    const itRes = await db.execute({
      sql: `
        SELECT di.*, ec.status AS caixa_status_atual, ec.endereco AS caixa_endereco_atual
        FROM devolucao_itens di
        LEFT JOIN estoque_caixas ec ON ec.id = di.caixa_id
        WHERE di.devolucao_id IN (${ph})
        ORDER BY di.id ASC
      `,
      args: ids,
    })

    const byDev = new Map()
    for (const it of itRes.rows || []) {
      const arr = byDev.get(it.devolucao_id) || []
      arr.push(it)
      byDev.set(it.devolucao_id, arr)
    }

    return lista.map((d) => ({
      ...d,
      motivo_label: MOTIVOS_LABEL[d.motivo] || d.motivo,
      itens: byDev.get(d.id) || [],
    }))
  },

  async buscarDevolucoesAbertasPorPedidos(pedidosCodigos = []) {
    const listaPed = Array.from(
      new Set((pedidosCodigos || []).map((p) => String(p || '').trim().toUpperCase()).filter(Boolean)),
    )
    if (listaPed.length === 0) return []

    if (isApiEnabled()) {
      return (
        (
          await apiRequest(
            `/api/devolucoes/abertas-por-pedido${buildQueryString({ pedidos: listaPed.join(',') })}`,
          )
        ).data || []
      )
    }

    await assertPermissao(PERM_READ, { write: false, bloquearCliente: true })
    await ensureDevolucoesSchema()

    const res = await db.execute({
      sql: `
        SELECT id, codigo, motivo, acao_estoque, endereco_destino, pedido_id, pedido_codigo,
               romaneio_id, romaneio_codigo, cliente_nome, observacoes, qtd_caixas, peso_total_kg, valor_estimado, created_at
        FROM devolucoes
        WHERE status_fiscal = 'PENDENTE_FATURAMENTO'
        ORDER BY id DESC
        LIMIT 80
      `,
      args: [],
    })
    return (res.rows || []).filter((d) => {
      const peds = String(d.pedido_codigo || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      return peds.some((p) => listaPed.includes(p))
    })
  },

  async finalizarDevolucao({
    eans = [],
    motivo,
    acao_estoque = 'DISPONIVEL',
    endereco_destino = 'REC',
    observacoes = '',
    devolucao_destino_id = null,
  }) {
    const eansLimpos = Array.from(new Set(eans.map((e) => String(e || '').trim()).filter(Boolean)))
    if (eansLimpos.length === 0) {
      throw new Error('Bipe ao menos 1 caixa antes de finalizar a devolução.')
    }
    if (!motivo || !MOTIVOS_LABEL[motivo]) {
      throw new Error('Selecione o motivo da devolução.')
    }

    if (isApiEnabled()) {
      return await apiRequest('/api/devolucoes', {
        method: 'POST',
        body: {
          eans: eansLimpos,
          motivo,
          acao_estoque,
          endereco_destino,
          observacoes,
          devolucao_destino_id: devolucao_destino_id || undefined,
        },
      })
    }

    await assertPermissao(PERM_WRITE)
    await ensureDevolucoesSchema()
    await ensureRastreabilidadeSchema()

    const operador = useAppStore.getState().operador
    const opNome = operador?.nome || 'Sistema'
    const opId = operador?.id || null
    const endFinal = String(endereco_destino || 'REC').trim().toUpperCase() || 'REC'
    const acaoFinal = acao_estoque === 'BLOQUEADO' ? 'BLOQUEADO' : 'DISPONIVEL'

    const resolvidas = []
    for (const ean of eansLimpos) {
      const cx = await this.buscarCaixaParaDevolucao(ean)
      resolvidas.push(cx)
    }

    const obsNova = String(observacoes || '').trim()
    const pesoLoteKg = Number(resolvidas.reduce((s, r) => s + Number(r.peso_kg || 0), 0).toFixed(3))
    const valorLote = Number(
      resolvidas.reduce((s, r) => s + Number(r.peso_kg || 0) * Number(r.preco_unitario || 0), 0).toFixed(2),
    )

    const pedidosUnicos = Array.from(new Set(resolvidas.map((r) => r.pedido_codigo).filter(Boolean)))
    const romaneiosUnicos = Array.from(new Set(resolvidas.map((r) => r.romaneio_codigo).filter(Boolean)))
    const clientesUnicos = Array.from(new Set(resolvidas.map((r) => r.cliente_nome).filter(Boolean)))
    const pedidoIdHeader = resolvidas.find((r) => r.pedido_id)?.pedido_id || null
    const romaneioIdHeader = resolvidas.find((r) => r.romaneio_id)?.romaneio_id || null
    const pedidoCodigoResumo = pedidosUnicos.join(', ')
    const romaneioCodigoResumo = romaneiosUnicos.join(', ')
    const clienteResumo = clientesUnicos.join(', ')

    let devId = null
    let codigo = ''

    if (devolucao_destino_id) {
      const exRes = await db.execute({
        sql: 'SELECT * FROM devolucoes WHERE id = ? LIMIT 1',
        args: [Number(devolucao_destino_id)],
      })
      const ex = exRes.rows[0]
      if (!ex) {
        throw new Error('Romaneio de devolução de destino não encontrado.')
      }
      if (ex.status_fiscal !== 'PENDENTE_FATURAMENTO') {
        throw new Error(`A devolução ${ex.codigo} já teve tratativa fiscal encerrada e não aceita novos itens.`)
      }
      devId = Number(ex.id)
      codigo = ex.codigo
    } else {
      const maxRes = await db.execute('SELECT MAX(id) AS max_id FROM devolucoes')
      const seq = Number(maxRes.rows[0]?.max_id || 0) + 1
      codigo = `DEV-${String(seq).padStart(4, '0')}`
      const insDev = await db.execute({
        sql: `
          INSERT INTO devolucoes (
            codigo, motivo, acao_estoque, endereco_destino, pedido_id, pedido_codigo,
            romaneio_id, romaneio_codigo, cliente_nome, observacoes, status, status_fiscal,
            qtd_caixas, peso_total_kg, valor_estimado, operador_id, operador_nome
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONCLUIDA_FISICA', 'PENDENTE_FATURAMENTO', ?, ?, ?, ?, ?)
        `,
        args: [
          codigo,
          motivo,
          acaoFinal,
          endFinal,
          pedidoIdHeader,
          pedidoCodigoResumo,
          romaneioIdHeader,
          romaneioCodigoResumo,
          clienteResumo,
          obsNova,
          resolvidas.length,
          pesoLoteKg,
          valorLote,
          opId,
          opNome,
        ],
      })
      devId = Number(insDev.lastInsertRowid)
    }

    const motivoLabel = MOTIVOS_LABEL[motivo] || motivo
    const statusDesc = acaoFinal === 'BLOQUEADO' ? 'QUARENTENA / BLOQUEADO' : 'DISPONIVEL NO ESTOQUE'
    const endsAfetados = new Set([endFinal])
    const stmts = []

    for (const r of resolvidas) {
      if (r.endereco) endsAfetados.add(r.endereco)
      stmts.push({
        sql: `
          INSERT INTO devolucao_itens (
            devolucao_id, caixa_id, ean_caixa, produto_id, produto_codigo, produto_descricao,
            lote, validade, peso_kg, preco_unitario, pedido_id, pedido_codigo,
            romaneio_id, romaneio_codigo, cliente_nome
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          devId,
          r.id,
          r.ean_caixa,
          r.produto_id,
          r.produto_codigo || '',
          r.produto_descricao || '',
          r.lote || '',
          r.validade || null,
          Number(r.peso_kg || 0),
          Number(r.preco_unitario || 0),
          r.pedido_id || null,
          r.pedido_codigo || '',
          r.romaneio_id || null,
          r.romaneio_codigo || '',
          r.cliente_nome || '',
        ],
      })

      stmts.push({
        sql: `
          UPDATE estoque_caixas
          SET status = ?,
              endereco = ?,
              palete_id = NULL,
              pedido_reservado_id = NULL,
              pedido_reservado_codigo = NULL,
              romaneio_reservado_id = NULL,
              romaneio_reservado_codigo = NULL,
              cliente_reservado_nome = NULL,
              reservado_em = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        args: [acaoFinal, endFinal, r.id],
      })

      stmts.push({
        sql: `
          INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
          VALUES (?, ?, 'DEVOLUCAO', ?, ?)
        `,
        args: [
          r.id,
          r.ean_caixa,
          `Retornou via ${codigo} (${motivoLabel}) • ${statusDesc} em ${endFinal}${r.pedido_codigo ? ` • Origem: ${r.pedido_codigo}` : ''}`,
          opNome,
        ],
      })

      stmts.push({
        sql: `
          INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo, num_pedido, cliente)
          VALUES (?, 'SAIDA', ?, ?, 1, ?, ?, ?, 'AJUSTE', ?, ?)
        `,
        args: [
          r.produto_id,
          endFinal,
          r.lote || '',
          Number(r.peso_kg || 0),
          opId,
          opNome,
          r.pedido_codigo || codigo,
          r.cliente_nome || clienteResumo || '-',
        ],
      })
    }

    await db.batch(stmts, 'write')

    // Recalcular totais exatos do cabeçalho a partir de todos os itens (garante consistência quando anexado a um romaneio existente)
    const itensAllRes = await db.execute({
      sql: `SELECT * FROM devolucao_itens WHERE devolucao_id = ? ORDER BY id ASC`,
      args: [devId],
    })
    const todosItens = itensAllRes.rows || []
    const totalCaixasFinal = todosItens.length
    const pesoTotalFinal = Number(todosItens.reduce((s, i) => s + Number(i.peso_kg || 0), 0).toFixed(3))
    const valorFinal = Number(
      todosItens.reduce((s, i) => s + Number(i.peso_kg || 0) * Number(i.preco_unitario || 0), 0).toFixed(2),
    )
    const pedsFinal = Array.from(new Set(todosItens.map((i) => i.pedido_codigo).filter(Boolean))).join(', ')
    const romsFinal = Array.from(new Set(todosItens.map((i) => i.romaneio_codigo).filter(Boolean))).join(', ')
    const clisFinal = Array.from(new Set(todosItens.map((i) => i.cliente_nome).filter(Boolean))).join(', ')

    if (devolucao_destino_id) {
      await db.execute({
        sql: `
          UPDATE devolucoes
          SET qtd_caixas = ?,
              peso_total_kg = ?,
              valor_estimado = ?,
              pedido_codigo = ?,
              romaneio_codigo = ?,
              cliente_nome = ?,
              observacoes = CASE WHEN ? != '' AND observacoes != ? THEN CASE WHEN observacoes = '' THEN ? ELSE observacoes || ' | ' || ? END ELSE observacoes END
          WHERE id = ?
        `,
        args: [
          totalCaixasFinal,
          pesoTotalFinal,
          valorFinal,
          pedsFinal,
          romsFinal,
          clisFinal,
          obsNova,
          obsNova,
          obsNova,
          obsNova,
          devId,
        ],
      })
    }

    await recalcularPosicaoEnderecos([...endsAfetados])

    return {
      success: true,
      id: devId,
      codigo,
      anexado_em_existente: Boolean(devolucao_destino_id),
      motivo,
      motivo_label: motivoLabel,
      acao_estoque: acaoFinal,
      endereco_destino: endFinal,
      pedido_codigo: pedsFinal || pedidoCodigoResumo,
      romaneio_codigo: romsFinal || romaneioCodigoResumo,
      cliente_nome: clisFinal || clienteResumo,
      qtd_caixas: totalCaixasFinal,
      peso_total_kg: pesoTotalFinal,
      valor_estimado: valorFinal,
      itens: todosItens,
    }
  },

  async mesclarDevolucoes(devolucaoDestinoId, devolucaoOrigemId) {
    if (String(devolucaoDestinoId) === String(devolucaoOrigemId)) {
      throw new Error('Selecione dois romaneios de devolução diferentes para unificar.')
    }
    if (isApiEnabled()) {
      return await apiRequest(`/api/devolucoes/${devolucaoDestinoId}/mesclar`, {
        method: 'POST',
        body: { devolucao_origem_id: devolucaoOrigemId },
      })
    }

    await assertPermissao(PERM_FISCAL)
    await ensureDevolucoesSchema()

    const destId = Number(devolucaoDestinoId)
    const origId = Number(devolucaoOrigemId)
    const [destRes, origRes] = await Promise.all([
      db.execute({ sql: 'SELECT * FROM devolucoes WHERE id = ? LIMIT 1', args: [destId] }),
      db.execute({ sql: 'SELECT * FROM devolucoes WHERE id = ? LIMIT 1', args: [origId] }),
    ])
    const dest = destRes.rows[0]
    const orig = origRes.rows[0]
    if (!dest || !orig) throw new Error('Um dos registros de devolução não foi encontrado.')
    if (dest.status_fiscal !== 'PENDENTE_FATURAMENTO' || orig.status_fiscal !== 'PENDENTE_FATURAMENTO') {
      throw new Error('Só é possível unificar devoluções que ainda estejam pendentes de tratativa fiscal.')
    }

    const itensOrig = (
      await db.execute({ sql: 'SELECT caixa_id FROM devolucao_itens WHERE devolucao_id = ?', args: [origId] })
    ).rows || []

    const batchStmts = [
      {
        sql: 'UPDATE devolucao_itens SET devolucao_id = ? WHERE devolucao_id = ?',
        args: [destId, origId],
      },
      ...itensOrig.map((it) => ({
        sql: `UPDATE caixas_historico SET detalhes = REPLACE(detalhes, ?, ?) WHERE caixa_id = ? AND operacao = 'DEVOLUCAO'`,
        args: [orig.codigo, dest.codigo, it.caixa_id],
      })),
      {
        sql: 'DELETE FROM devolucoes WHERE id = ?',
        args: [origId],
      },
    ]
    await db.batch(batchStmts, 'write')

    const itensAllRes = await db.execute({
      sql: 'SELECT * FROM devolucao_itens WHERE devolucao_id = ? ORDER BY id ASC',
      args: [destId],
    })
    const todosItens = itensAllRes.rows || []
    const qtd = todosItens.length
    const peso = Number(todosItens.reduce((s, i) => s + Number(i.peso_kg || 0), 0).toFixed(3))
    const valor = Number(
      todosItens.reduce((s, i) => s + Number(i.peso_kg || 0) * Number(i.preco_unitario || 0), 0).toFixed(2),
    )
    const peds = Array.from(new Set(todosItens.map((i) => i.pedido_codigo).filter(Boolean))).join(', ')
    const roms = Array.from(new Set(todosItens.map((i) => i.romaneio_codigo).filter(Boolean))).join(', ')
    const clis = Array.from(new Set(todosItens.map((i) => i.cliente_nome).filter(Boolean))).join(', ')

    await db.execute({
      sql: `
        UPDATE devolucoes
        SET qtd_caixas = ?, peso_total_kg = ?, valor_estimado = ?,
            pedido_codigo = ?, romaneio_codigo = ?, cliente_nome = ?
        WHERE id = ?
      `,
      args: [qtd, peso, valor, peds, roms, clis, destId],
    })

    return { success: true, id: destId, codigo: dest.codigo, codigo_removido: orig.codigo, qtd_caixas: qtd, peso_total_kg: peso }
  },

  async tratarFiscal(devolucaoId, { status_fiscal, numero_nf_devolucao = '', observacoes }) {
    if (isApiEnabled()) {
      return await apiRequest(`/api/devolucoes/${devolucaoId}/tratar-fiscal`, {
        method: 'POST',
        body: { status_fiscal, numero_nf_devolucao, observacoes },
      })
    }
    await assertPermissao(PERM_FISCAL)
    await ensureDevolucoesSchema()
    const nextStatus = status_fiscal === 'DISPENSA_FISCAL' ? 'DISPENSA_FISCAL' : 'NF_DEVOLUCAO_EMITIDA'
    const nfNum = String(numero_nf_devolucao || '').trim()
    if (nextStatus === 'NF_DEVOLUCAO_EMITIDA' && !nfNum) {
      throw new Error('Informe o número da NF-e de Devolução / Estorno.')
    }
    const opNome = useAppStore.getState().operador?.nome || 'Sistema'
    await db.execute({
      sql: `
        UPDATE devolucoes
        SET status_fiscal = ?,
            numero_nf_devolucao = ?,
            observacoes = COALESCE(?, observacoes),
            fiscal_tratado_por_nome = ?,
            fiscal_tratado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [nextStatus, nfNum, observacoes !== undefined ? String(observacoes).trim() : null, opNome, devolucaoId],
    })
    return { success: true }
  },

  async liberarCaixaQuarentena(caixaId, { endereco_destino } = {}) {
    if (isApiEnabled()) {
      return await apiRequest(`/api/devolucoes/caixas/${caixaId}/liberar-quarentena`, {
        method: 'POST',
        body: { endereco_destino },
      })
    }
    await assertPermissao(['devolucao', 'movimentacao', 'recebimento', 'inventario_gestao'])
    const cxRes = await db.execute({ sql: 'SELECT * FROM estoque_caixas WHERE id = ? LIMIT 1', args: [caixaId] })
    if (cxRes.rows.length === 0) throw new Error('Caixa não encontrada.')
    const cx = cxRes.rows[0]
    if (cx.status !== 'BLOQUEADO') {
      throw new Error(`Esta caixa está com status "${cx.status}" (não está bloqueada em quarentena).`)
    }
    const endFinal = String(endereco_destino || cx.endereco || 'REC').trim().toUpperCase() || 'REC'
    const opNome = useAppStore.getState().operador?.nome || 'Sistema'

    await db.execute({
      sql: `UPDATE estoque_caixas SET status = 'DISPONIVEL', endereco = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [endFinal, caixaId],
    })
    await db.execute({
      sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome) VALUES (?, ?, 'LIBERACAO_QUARENTENA', ?, ?)`,
      args: [caixaId, cx.ean_caixa, `Liberada da quarentena de devolução para DISPONÍVEL em ${endFinal}`, opNome],
    })
    await recalcularPosicaoEnderecos([cx.endereco, endFinal].filter(Boolean))
    return { success: true, ean_caixa: cx.ean_caixa, endereco: endFinal }
  },
}
