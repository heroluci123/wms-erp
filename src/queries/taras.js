import { db } from '../lib/db'
import { montarEan16Interno } from '../utils/rastreabilidade'
import { assertPermissao } from '../lib/authGuard'

let _schemaReadyPromise = null

async function tryDDL(sql, args = []) {
  try {
    await db.execute({ sql, args })
  } catch (err) {
    const msg = String(err?.message || err || '').toLowerCase()
    if (
      msg.includes('duplicate column') ||
      msg.includes('already exists')
    ) {
      return
    }
    throw err
  }
}

/**
 * Garante que todas as tabelas e colunas de Taras, Lote automático,
 * Rastreabilidade de Desmembramento, OP planejada e Reimpressão existam no banco.
 * Idempotente e seguro para Turso HTTP e SQLite local.
 */
export async function ensureRastreabilidadeSchema(force = false) {
  if (_schemaReadyPromise && !force) return _schemaReadyPromise

  _schemaReadyPromise = (async () => {
    // 1. Tabela de Taras
    await tryDDL(`
      CREATE TABLE IF NOT EXISTS taras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        peso_kg REAL NOT NULL,
        ativo INTEGER DEFAULT 1,
        padrao INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const tarasCountRes = await db.execute('SELECT COUNT(*) AS total FROM taras')
    if (Number(tarasCountRes.rows[0]?.total || 0) === 0) {
      await db.execute({
        sql: `INSERT INTO taras (nome, peso_kg, ativo, padrao) VALUES (?, ?, 1, 1)`,
        args: ['Caixa de 1,000 kg', 1.0],
      })
      await db.execute({
        sql: `INSERT INTO taras (nome, peso_kg, ativo, padrao) VALUES (?, ?, 1, 0)`,
        args: ['Caixa de 0,700 kg', 0.7],
      })
    }

    // 2. Controle sequencial de EANs internos da empresa (padrão CODE128 16 dígitos)
    await tryDDL(`
      CREATE TABLE IF NOT EXISTS ean_sequencias (
        chave TEXT PRIMARY KEY,
        ultimo_numero INTEGER NOT NULL DEFAULT 900000,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await db.execute({
      sql: `INSERT OR IGNORE INTO ean_sequencias (chave, ultimo_numero) VALUES ('CAIXA_INTERNA', 900000)`,
      args: [],
    })

    // 3. Vínculos explícitos de Desmembramento (Caixa Origem -> Novas Caixas)
    await tryDDL(`
      CREATE TABLE IF NOT EXISTS desmembramentos_vinculos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_operacao TEXT NOT NULL,
        caixa_origem_id INTEGER NOT NULL,
        ean_origem TEXT NOT NULL,
        caixa_destino_id INTEGER NOT NULL,
        ean_destino TEXT NOT NULL,
        produto_id INTEGER NOT NULL,
        peso_liquido_kg REAL NOT NULL,
        peso_bruto_kg REAL DEFAULT NULL,
        tara_kg REAL DEFAULT 0,
        lote TEXT DEFAULT '',
        data_producao DATE DEFAULT NULL,
        validade DATE DEFAULT NULL,
        operador_id INTEGER,
        operador_nome TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_desm_ean_origem ON desmembramentos_vinculos(ean_origem)`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_desm_ean_destino ON desmembramentos_vinculos(ean_destino)`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_desm_op_cod ON desmembramentos_vinculos(codigo_operacao)`)

    // 4. Itens previstos da Ordem de Produção (configurados pelo ADM)
    await tryDDL(`
      CREATE TABLE IF NOT EXISTS op_itens_previstos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id INTEGER NOT NULL REFERENCES ordens_producao(id) ON DELETE CASCADE,
        tipo TEXT CHECK(tipo IN ('ENTRADA','SAIDA')) NOT NULL,
        produto_id INTEGER NOT NULL REFERENCES produtos(id),
        qtd_caixas_prevista REAL DEFAULT NULL,
        peso_kg_previsto REAL DEFAULT NULL,
        observacao TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_op_itens_prev_op ON op_itens_previstos(op_id)`)

    // 5. Novas colunas em estoque_caixas
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN peso_bruto_kg REAL DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN tara_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN tara_kg REAL DEFAULT 0`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN data_producao DATE DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN origem_tipo TEXT DEFAULT 'RECEBIMENTO'`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN caixa_origem_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN ean_origem TEXT DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN op_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN operador_cadastro_nome TEXT DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN qtd_pecas INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN pedido_reservado_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN pedido_reservado_codigo TEXT DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN romaneio_reservado_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN romaneio_reservado_codigo TEXT DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN cliente_reservado_nome TEXT DEFAULT NULL`)
    await tryDDL(`ALTER TABLE estoque_caixas ADD COLUMN reservado_em DATETIME DEFAULT NULL`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_estoque_caixas_op ON estoque_caixas(op_id)`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_estoque_caixas_ean_origem ON estoque_caixas(ean_origem)`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_estoque_caixas_ean ON estoque_caixas(ean_caixa)`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_estoque_caixas_status_prod ON estoque_caixas(status, produto_id)`)
    await tryDDL(`CREATE INDEX IF NOT EXISTS idx_estoque_caixas_pedido_res ON estoque_caixas(pedido_reservado_id)`)

    // 6. Novas colunas em op_insumos, op_retornos e op_itens_previstos
    await tryDDL(`ALTER TABLE op_insumos ADD COLUMN peso_bruto_kg REAL DEFAULT NULL`)
    await tryDDL(`ALTER TABLE op_insumos ADD COLUMN tara_kg REAL DEFAULT 0`)
    await tryDDL(`ALTER TABLE op_insumos ADD COLUMN data_producao DATE DEFAULT NULL`)
    await tryDDL(`ALTER TABLE op_insumos ADD COLUMN lote TEXT DEFAULT ''`)
    await tryDDL(`ALTER TABLE op_insumos ADD COLUMN qtd_pecas INTEGER DEFAULT NULL`)

    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN peso_bruto_kg REAL DEFAULT NULL`)
    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN tara_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN tara_kg REAL DEFAULT 0`)
    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN data_producao DATE DEFAULT NULL`)
    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN validade DATE DEFAULT NULL`)
    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN lote TEXT DEFAULT ''`)
    await tryDDL(`ALTER TABLE op_retornos ADD COLUMN qtd_pecas INTEGER DEFAULT NULL`)

    await tryDDL(`ALTER TABLE op_itens_previstos ADD COLUMN unidade_prevista TEXT DEFAULT 'KG'`)

    // 7. Novas colunas em desmembramentos_vinculos e ordens_producao
    await tryDDL(`ALTER TABLE desmembramentos_vinculos ADD COLUMN qtd_pecas INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE desmembramentos_vinculos ADD COLUMN perda_pecas INTEGER DEFAULT 0`)
    await tryDDL(`ALTER TABLE desmembramentos_vinculos ADD COLUMN motivo_diferenca_pecas TEXT DEFAULT ''`)

    await tryDDL(`ALTER TABLE ordens_producao ADD COLUMN observacoes TEXT DEFAULT ''`)
    await tryDDL(`ALTER TABLE ordens_producao ADD COLUMN criado_por_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE ordens_producao ADD COLUMN criado_por_nome TEXT DEFAULT NULL`)
    await tryDDL(`ALTER TABLE ordens_producao ADD COLUMN liberada_em DATETIME DEFAULT NULL`)

    // 8. Novas colunas em inventario_itens
    await tryDDL(`ALTER TABLE inventario_itens ADD COLUMN peso_bruto_contado_kg REAL DEFAULT NULL`)
    await tryDDL(`ALTER TABLE inventario_itens ADD COLUMN tara_id INTEGER DEFAULT NULL`)
    await tryDDL(`ALTER TABLE inventario_itens ADD COLUMN tara_kg REAL DEFAULT 0`)
    await tryDDL(`ALTER TABLE inventario_itens ADD COLUMN data_producao_contada DATE DEFAULT NULL`)
    await tryDDL(`ALTER TABLE inventario_itens ADD COLUMN qtd_pecas_contada INTEGER DEFAULT NULL`)
  })().catch((err) => {
    _schemaReadyPromise = null
    throw err
  })

  return _schemaReadyPromise
}

export const tarasQueries = {
  /**
   * Lista taras cadastradas (por padrão apenas ativas para formulários operacionais).
   */
  async listar(apenasAtivas = true) {
    await assertPermissao(['taras', 'recebimento', 'inventario_coletor', 'inventario_gestao', 'desmembramento', 'retorno_producao', 'producao_saida'], { write: false, bloquearCliente: true })
    await ensureRastreabilidadeSchema()
    const where = apenasAtivas ? 'WHERE ativo = 1' : ''
    const res = await db.execute(`
      SELECT id, nome, peso_kg, ativo, padrao, created_at, updated_at
      FROM taras
      ${where}
      ORDER BY padrao DESC, peso_kg DESC, id ASC
    `)
    return res.rows
  },

  async criar({ nome, peso_kg, padrao = false }) {
    await assertPermissao('taras')
    await ensureRastreabilidadeSchema()
    const peso = Number(Number(peso_kg).toFixed(3))
    if (!nome?.trim()) throw new Error('Informe o nome descritivo da tara.')
    if (!Number.isFinite(peso) || peso < 0) throw new Error('Informe um peso válido para a tara (em kg).')

    if (padrao) {
      await db.execute('UPDATE taras SET padrao = 0')
    }

    const res = await db.execute({
      sql: `
        INSERT INTO taras (nome, peso_kg, ativo, padrao, created_at, updated_at)
        VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      args: [nome.trim(), peso, padrao ? 1 : 0],
    })
    return Number(res.lastInsertRowid)
  },

  async atualizar(id, { nome, peso_kg, ativo, padrao }) {
    await assertPermissao('taras')
    await ensureRastreabilidadeSchema()
    const peso = Number(Number(peso_kg).toFixed(3))
    if (!nome?.trim()) throw new Error('Informe o nome descritivo da tara.')
    if (!Number.isFinite(peso) || peso < 0) throw new Error('Informe um peso válido para a tara (em kg).')

    if (padrao) {
      await db.execute('UPDATE taras SET padrao = 0')
    }

    await db.execute({
      sql: `
        UPDATE taras
        SET nome = ?,
            peso_kg = ?,
            ativo = COALESCE(?, ativo),
            padrao = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [
        nome.trim(),
        peso,
        ativo === undefined ? null : (ativo ? 1 : 0),
        padrao ? 1 : 0,
        id,
      ],
    })
  },

  async alternarAtivo(id, ativoAtual) {
    await assertPermissao('taras')
    await ensureRastreabilidadeSchema()
    const novoAtivo = Number(ativoAtual) === 1 ? 0 : 1
    await db.execute({
      sql: `UPDATE taras SET ativo = ?, padrao = CASE WHEN ? = 0 THEN 0 ELSE padrao END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [novoAtivo, novoAtivo, id],
    })
    return novoAtivo
  },

  async definirPadrao(id) {
    await assertPermissao('taras')
    await ensureRastreabilidadeSchema()
    await db.execute('UPDATE taras SET padrao = 0')
    await db.execute({
      sql: `UPDATE taras SET padrao = 1, ativo = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [id],
    })
  },

  /**
   * Reserva e gera `quantidade` EANs únicos internos de 16 dígitos para a empresa (CODE128).
   */
  async gerarProximosEansInternos(quantidade = 1, codigoProduto = '') {
    await assertPermissao(['desmembramento', 'producao_saida', 'retorno_producao', 'reimpressao', 'recebimento'])
    await ensureRastreabilidadeSchema()
    const qtd = Math.max(1, Number(quantidade) || 1)
    const gerados = []

    for (let i = 0; i < qtd; i++) {
      let tentativas = 0
      while (tentativas < 25) {
        tentativas++
        const updRes = await db.execute({
          sql: `
            UPDATE ean_sequencias
            SET ultimo_numero = ultimo_numero + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE chave = 'CAIXA_INTERNA'
            RETURNING ultimo_numero
          `,
          args: [],
        })
        const seqNum = Number(updRes.rows[0]?.ultimo_numero || 900001)
        const ean = montarEan16Interno(seqNum, codigoProduto)

        // Garante unicidade em estoque_caixas
        const existsRes = await db.execute({
          sql: `SELECT id FROM estoque_caixas WHERE ean_caixa = ? LIMIT 1`,
          args: [ean],
        })
        if (existsRes.rows.length === 0 && !gerados.includes(ean)) {
          gerados.push(ean)
          break
        }
      }
      if (gerados.length <= i) {
        throw new Error('Não foi possível gerar EAN interno único. Tente novamente.')
      }
    }

    return gerados
  },

  async gerarProximoEanInterno(codigoProduto = '') {
    const lista = await this.gerarProximosEansInternos(1, codigoProduto)
    return lista[0]
  },

  /**
   * Busca caixa completa para reimpressão de etiqueta preservando o EAN original.
   */
  async buscarCaixaParaReimpressao(ean) {
    await assertPermissao(['reimpressao', 'desmembramento', 'retorno_producao', 'producao_saida', 'ean_etiquetas', 'rastreabilidade'], { write: false, bloquearCliente: true })
    await ensureRastreabilidadeSchema()
    const clean = String(ean || '').trim()
    if (!clean) throw new Error('Informe ou bipe o EAN da caixa.')

    const res = await db.execute({
      sql: `
        SELECT
          ec.*,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao,
          p.ean AS produto_ean_padrao,
          t.nome AS tara_nome,
          op.codigo AS op_codigo,
          op.nome AS op_nome
        FROM estoque_caixas ec
        JOIN produtos p ON ec.produto_id = p.id
        LEFT JOIN taras t ON ec.tara_id = t.id
        LEFT JOIN ordens_producao op ON ec.op_id = op.id
        WHERE ec.ean_caixa = ?
        LIMIT 1
      `,
      args: [clean],
    })

    if (res.rows.length === 0) {
      throw new Error(`Nenhuma caixa encontrada para o EAN "${clean}".`)
    }
    return res.rows[0]
  },

  async listarCaixasRecentesParaEtiqueta(filtro = '', limite = 40) {
    await assertPermissao(['reimpressao', 'desmembramento', 'retorno_producao', 'producao_saida', 'ean_etiquetas', 'rastreabilidade'], { write: false, bloquearCliente: true })
    await ensureRastreabilidadeSchema()
    const q = `%${String(filtro || '').trim()}%`
    const res = await db.execute({
      sql: `
        SELECT
          ec.id,
          ec.ean_caixa,
          ec.produto_id,
          ec.endereco,
          ec.lote,
          ec.data_producao,
          ec.validade,
          ec.peso_bruto_kg,
          ec.tara_kg,
          ec.peso_kg,
          ec.qtd_pecas,
          ec.origem_tipo,
          ec.ean_origem,
          ec.status,
          ec.pedido_reservado_id,
          ec.pedido_reservado_codigo,
          ec.romaneio_reservado_id,
          ec.romaneio_reservado_codigo,
          ec.cliente_reservado_nome,
          ec.created_at,
          p.codigo AS produto_codigo,
          p.descricao AS produto_descricao,
          t.nome AS tara_nome,
          op.codigo AS op_codigo
        FROM estoque_caixas ec
        JOIN produtos p ON ec.produto_id = p.id
        LEFT JOIN taras t ON ec.tara_id = t.id
        LEFT JOIN ordens_producao op ON ec.op_id = op.id
        WHERE (
          ? = '%%'
          OR ec.ean_caixa LIKE ?
          OR p.codigo LIKE ?
          OR UPPER(p.descricao) LIKE UPPER(?)
          OR COALESCE(ec.lote, '') LIKE ?
        )
        ORDER BY ec.id DESC
        LIMIT ?
      `,
      args: [q, q, q, q, q, Number(limite) || 40],
    })
    return res.rows
  },

  async registrarReimpressaoHistorico({ caixa_id, ean_caixa, origem_tipo, operador_nome }) {
    await assertPermissao(['reimpressao', 'desmembramento', 'producao_saida', 'retorno_producao'])
    await ensureRastreabilidadeSchema()
    await db.execute({
      sql: `
        INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora)
        VALUES (?, ?, 'REIMPRESSAO_ETIQUETA', ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [
        caixa_id,
        ean_caixa,
        `Etiqueta 100x70mm reimpressa preservando EAN original (${origem_tipo || 'ESTOQUE'})`,
        operador_nome || 'Operador',
      ],
    })
  },
}
