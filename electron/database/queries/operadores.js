const crypto = require('crypto')
const { getDb } = require('../connection')

const ITERATIONS = 100000

function hashSenhaSync(plain) {
  const clean = String(plain ?? '')
  if (!clean) throw new Error('Senha vazia')
  const saltHex = crypto.randomBytes(16).toString('hex')
  const hashHex = crypto.pbkdf2Sync(clean, Buffer.from(saltHex, 'hex'), ITERATIONS, 32, 'sha256').toString('hex')
  return `pbkdf2$sha256$${ITERATIONS}$${saltHex}$${hashHex}`
}

function verificarSenhaSync(plain, storedHash) {
  const candidate = String(plain ?? '')
  const stored = String(storedHash ?? '').trim()
  if (!candidate || !stored) return false
  if (stored.startsWith('pbkdf2$sha256$')) {
    const [, , iterStr, saltHex, expectedHex] = stored.split('$')
    const iter = Number(iterStr) || ITERATIONS
    const derived = crypto.pbkdf2Sync(candidate, Buffer.from(saltHex, 'hex'), iter, 32, 'sha256')
    const expected = Buffer.from(expectedHex || '', 'hex')
    if (derived.length !== expected.length) return false
    return crypto.timingSafeEqual(derived, expected)
  }
  return false
}

const operadoresQueries = {
  listar: () => {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, nome, login, perfil, nivel, setor, is_adm, ativo, deve_trocar_senha, permissoes, ultimo_acesso, created_at, updated_at
         FROM operadores ORDER BY nome ASC`
      )
      .all()
    return rows.map((r) => {
      let permissoes = {}
      try {
        permissoes = JSON.parse(r.permissoes || '{}')
      } catch {
        permissoes = {}
      }
      return { ...r, permissoes }
    })
  },

  autenticarComSenha: (login, senha) => {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT id, nome, login, senha_hash, perfil, nivel, setor, is_adm, ativo, deve_trocar_senha, permissoes
         FROM operadores WHERE LOWER(COALESCE(login,'')) = LOWER(?) LIMIT 1`
      )
      .get(String(login || '').trim())
    if (!row || Number(row.ativo) !== 1) return null
    if (!verificarSenhaSync(senha, row.senha_hash)) return null
    let permissoes = {}
    try {
      permissoes = JSON.parse(row.permissoes || '{}')
    } catch {
      permissoes = {}
    }
    const { senha_hash: _omit, ...clean } = row
    return { ...clean, permissoes }
  },

  autenticar: () => {
    return null
  },

  criar: ({ nome, login, senha, perfil = 'OPERADOR', nivel = 'OPERACIONAL', setor = 'Produção', is_adm = 0, deve_trocar_senha = 0, permissoes = {} }) => {
    const db = getDb()
    const cleanLogin = String(login || nome || '').trim()
    const hash = hashSenhaSync(senha)
    const info = db
      .prepare(
        `INSERT INTO operadores (nome, login, pin, senha_hash, perfil, nivel, setor, is_adm, deve_trocar_senha, permissoes, ativo)
         VALUES (?, ?, '****', ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        String(nome || '').trim(),
        cleanLogin,
        hash,
        String(perfil).toUpperCase(),
        String(nivel).toUpperCase(),
        setor,
        is_adm ? 1 : 0,
        deve_trocar_senha ? 1 : 0,
        JSON.stringify(permissoes)
      )
    return { id: info.lastInsertRowid, success: true }
  },

  atualizar: ({ id, nome, login, senha, perfil, nivel, setor, is_adm, ativo, permissoes }) => {
    const db = getDb()
    const fields = []
    const params = []
    if (nome !== undefined) { fields.push('nome = ?'); params.push(String(nome).trim()) }
    if (login !== undefined) { fields.push('login = ?'); params.push(String(login).trim()) }
    if (perfil !== undefined) { fields.push('perfil = ?'); params.push(String(perfil).toUpperCase()) }
    if (nivel !== undefined) { fields.push('nivel = ?'); params.push(String(nivel).toUpperCase()) }
    if (setor !== undefined) { fields.push('setor = ?'); params.push(setor) }
    if (is_adm !== undefined) { fields.push('is_adm = ?'); params.push(is_adm ? 1 : 0) }
    if (ativo !== undefined) { fields.push('ativo = ?'); params.push(ativo ? 1 : 0) }
    if (permissoes !== undefined) { fields.push('permissoes = ?'); params.push(JSON.stringify(permissoes)) }
    if (senha) {
      fields.push('senha_hash = ?', "pin = '****'")
      params.push(hashSenhaSync(senha))
    }
    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)
    db.prepare(`UPDATE operadores SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return { success: true }
  },

  desativar: (id) => {
    const db = getDb()
    db.prepare(`UPDATE operadores SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    return { success: true }
  },
}

module.exports = operadoresQueries
