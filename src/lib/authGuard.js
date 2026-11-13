import { db } from './db.js'
import { useAppStore } from '../store/appStore.js'
import {
  isMaster,
  isCliente,
  temPermissao,
  temAlgumaPermissao,
  sanitizarPermissoes,
  PERFIS_SISTEMA_BASE,
  CHAVES_PROIBIDAS_CLIENTE,
} from '../utils/permissoes.js'
import { hashSenha } from '../utils/authCrypto.js'

let schemaPromise = null
let lastCheck = { token: '', ts: 0, operador: null }

export function limparCacheSessao() {
  lastCheck = { token: '', ts: 0, operador: null }
}

/**
 * Garante que todas as tabelas e colunas de autenticação, sessões, perfis e auditoria existem.
 * Também garante a existência da conta MASTER (Luciano) e da conta CLIENTE inicial (Paulo).
 */
export async function ensureAuthSchema() {
  if (schemaPromise) return schemaPromise
  schemaPromise = (async () => {
    const statements = [
      `ALTER TABLE operadores ADD COLUMN login TEXT`,
      `ALTER TABLE operadores ADD COLUMN senha_hash TEXT`,
      `ALTER TABLE operadores ADD COLUMN nivel TEXT DEFAULT 'OPERACIONAL'`,
      `ALTER TABLE operadores ADD COLUMN setor TEXT DEFAULT 'Produção'`,
      `ALTER TABLE operadores ADD COLUMN deve_trocar_senha INTEGER DEFAULT 0`,
      `ALTER TABLE operadores ADD COLUMN ultimo_acesso DATETIME`,
      `ALTER TABLE operadores ADD COLUMN criado_por_nome TEXT`,
      `ALTER TABLE operadores ADD COLUMN atualizado_por_nome TEXT`,
      `ALTER TABLE operadores ADD COLUMN updated_at DATETIME`,
    ]
    for (const sql of statements) {
      try {
        await db.execute(sql)
      } catch { /* coluna já existente */ }
    }

    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_operadores_login_unique ON operadores(LOWER(login)) WHERE login IS NOT NULL AND login != ''`)

    await db.execute(`
      CREATE TABLE IF NOT EXISTS perfis_acesso (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT NOT NULL UNIQUE,
        nome TEXT NOT NULL,
        nivel TEXT NOT NULL DEFAULT 'OPERACIONAL',
        setor_padrao TEXT DEFAULT 'Produção',
        descricao TEXT DEFAULT '',
        permissoes_json TEXT NOT NULL DEFAULT '{}',
        sistema_fixo INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessoes_usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operador_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        ativo INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ultimo_ping DATETIME DEFAULT CURRENT_TIMESTAMP,
        encerrada_em DATETIME
      )
    `)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes_usuarios(token)`)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_sessoes_op ON sessoes_usuarios(operador_id, ativo)`)

    await db.execute(`
      CREATE TABLE IF NOT EXISTS auditoria_acessos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id INTEGER,
        target_user_nome TEXT,
        acao TEXT NOT NULL,
        detalhes_antes TEXT,
        detalhes_depois TEXT,
        executor_id INTEGER,
        executor_nome TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_auditoria_acessos_data ON auditoria_acessos(created_at DESC)`)

    // Seed perfis base se ainda não existirem
    for (const p of PERFIS_SISTEMA_BASE) {
      await db.execute({
        sql: `
          INSERT OR IGNORE INTO perfis_acesso (codigo, nome, nivel, setor_padrao, descricao, permissoes_json, sistema_fixo)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        args: [p.codigo, p.nome, p.nivel, p.setor_padrao, p.descricao, JSON.stringify(p.permissoes), p.sistema_fixo],
      })
    }

    // Garantir conta MASTER "Luciano" (senha inicial 7410 com troca obrigatória no 1º acesso)
    const masterCheck = await db.execute({
      sql: `SELECT id, senha_hash FROM operadores WHERE LOWER(COALESCE(login, '')) = 'luciano' OR UPPER(nivel) = 'MASTER' LIMIT 1`,
      args: [],
    })
    if (masterCheck.rows.length === 0) {
      const hash7410 = await hashSenha('7410')
      const permsMaster = JSON.stringify(PERFIS_SISTEMA_BASE.find((x) => x.codigo === 'MASTER').permissoes)
      await db.execute({
        sql: `
          INSERT INTO operadores (nome, login, pin, senha_hash, perfil, nivel, setor, is_adm, ativo, deve_trocar_senha, permissoes, criado_por_nome)
          VALUES ('Luciano', 'Luciano', '****', ?, 'MASTER', 'MASTER', 'Diretoria / Master', 1, 1, 1, ?, 'Sistema')
        `,
        args: [hash7410, permsMaster],
      })
    }
  })()

  try {
    await schemaPromise
  } catch (err) {
    schemaPromise = null
    throw err
  }
}

export async function registrarAuditoriaAcesso({
  targetUserId = null,
  targetUserNome = '',
  acao,
  detalhesAntes = null,
  detalhesDepois = null,
  executor = null,
}) {
  const execUser = executor || useAppStore.getState().operador
  try {
    await db.execute({
      sql: `
        INSERT INTO auditoria_acessos (
          target_user_id, target_user_nome, acao, detalhes_antes, detalhes_depois, executor_id, executor_nome
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        targetUserId ? Number(targetUserId) : null,
        targetUserNome || '',
        acao,
        detalhesAntes ? (typeof detalhesAntes === 'string' ? detalhesAntes : JSON.stringify(detalhesAntes)) : null,
        detalhesDepois ? (typeof detalhesDepois === 'string' ? detalhesDepois : JSON.stringify(detalhesDepois)) : null,
        execUser?.id ? Number(execUser.id) : null,
        execUser?.nome ? `${execUser.nome}${execUser.login ? ` (${execUser.login})` : ''}` : 'Sistema',
      ],
    })
  } catch (err) {
    console.warn('Falha ao gravar auditoria de acessos:', err.message)
  }
}

/**
 * Valida a sessão ativa diretamente contra o banco de dados.
 * Se a conta foi desativada ou a sessão revogada, encerra a sessão local imediatamente.
 */
export async function validarSessaoServidor({ forceFresh = false } = {}) {
  await ensureAuthSchema()
  const state = useAppStore.getState()
  const token = state.sessionToken
  const opLocal = state.operador

  if (!token || !opLocal?.id) {
    throw new Error('Sessão não autenticada. Faça login para continuar.')
  }

  const now = Date.now()
  if (!forceFresh && lastCheck.token === token && now - lastCheck.ts < 2500 && lastCheck.operador) {
    return lastCheck.operador
  }

  const res = await db.execute({
    sql: `
      SELECT
        o.id, o.nome, o.login, o.perfil, o.nivel, o.setor, o.is_adm,
        o.ativo, o.deve_trocar_senha, o.permissoes,
        s.ativo AS sessao_ativa
      FROM sessoes_usuarios s
      JOIN operadores o ON o.id = s.operador_id
      WHERE s.token = ? AND s.operador_id = ?
      LIMIT 1
    `,
    args: [token, Number(opLocal.id)],
  })

  const row = res.rows[0]
  if (!row || Number(row.sessao_ativa) !== 1 || Number(row.ativo) !== 1) {
    limparCacheSessao()
    useAppStore.getState().logout()
    const msg = row && Number(row.ativo) !== 1
      ? 'Sua conta foi desativada por um administrador. Acesso encerrado.'
      : 'Sessão expirada ou revogada. Faça login novamente.'
    throw new Error(msg)
  }

  const nivel = String(row.nivel || (Number(row.is_adm) === 1 ? 'ADMINISTRADOR' : 'OPERACIONAL')).toUpperCase()
  const perfil = String(row.perfil || nivel).toUpperCase()
  const operadorAtualizado = {
    id: Number(row.id),
    nome: row.nome,
    login: row.login || row.nome,
    perfil,
    nivel,
    setor: row.setor || 'Produção',
    is_adm: nivel === 'MASTER' || nivel === 'ADMINISTRADOR' || Number(row.is_adm) === 1 ? 1 : 0,
    ativo: Number(row.ativo),
    deve_trocar_senha: Number(row.deve_trocar_senha || 0),
    permissoes: sanitizarPermissoes(row.permissoes, nivel, perfil),
  }

  lastCheck = { token, ts: now, operador: operadorAtualizado }
  useAppStore.getState().setOperador(operadorAtualizado)

  // Atualiza último ping sem bloquear a operação
  db.execute({
    sql: `UPDATE sessoes_usuarios SET ultimo_ping = CURRENT_TIMESTAMP WHERE token = ?`,
    args: [token],
  }).catch(() => {})

  return operadorAtualizado
}

/**
 * Valida sessão + permissão específica na camada de dados/servidor antes de executar operações.
 * @param {string|string[]|null} permissaoRequerida
 * @param {{ write?: boolean, forceFresh?: boolean, bloquearCliente?: boolean }} opcoes
 */
export async function assertPermissao(permissaoRequerida = null, opcoes = {}) {
  const { write = true, forceFresh = false, bloquearCliente = write } = opcoes
  const operador = await validarSessaoServidor({ forceFresh })

  if (isMaster(operador)) {
    return operador
  }

  if (operador.deve_trocar_senha === 1) {
    throw new Error('Altere sua senha inicial antes de realizar operações no sistema.')
  }

  if (isCliente(operador)) {
    if (write || bloquearCliente) {
      throw new Error('Acesso negado: o perfil CLIENTE possui acesso estritamente de consulta.')
    }
    if (typeof permissaoRequerida === 'string' && CHAVES_PROIBIDAS_CLIENTE.has(permissaoRequerida)) {
      throw new Error('Acesso negado: módulo operacional indisponível para o perfil CLIENTE.')
    }
  }

  if (permissaoRequerida) {
    const ok = Array.isArray(permissaoRequerida)
      ? temAlgumaPermissao(operador, permissaoRequerida)
      : temPermissao(operador, permissaoRequerida)
    if (!ok) {
      throw new Error('Acesso negado: seu usuário não possui permissão para esta ação.')
    }
  }

  return operador
}
