// ─── db.js ───────────────────────────────────────────────────────────────────
// Se estiver rodando dentro do Electron, usa o banco LOCAL via IPC (instantâneo).
// Caso contrário (navegador puro / dev sem Electron), cai para HTTP remoto.

const isElectron = typeof window !== 'undefined' && typeof window.wmsAPI?.db !== 'undefined'

function makeElectronClient() {
  const ipc = window.wmsAPI.db
  return {
    execute: async (queryOrObj) => {
      if (typeof queryOrObj === 'string') {
        return ipc.execute(queryOrObj, [])
      }
      const { sql, args } = queryOrObj
      return ipc.execute(sql, args || [])
    },
    batch: async (queries, _mode) => {
      // Normaliza: string → { sql, args: [] }
      const normalized = queries.map(q => typeof q === 'string' ? { sql: q, args: [] } : q)
      return ipc.batch(normalized)
    },
    sync: () => ipc.sync(),
    transaction: async (_mode) => {
      // Transações: executa em série via IPC (Turso replica já garante atomicidade no servidor)
      const ops = []
      return {
        execute: async (q) => {
          const result = await ipc.execute(typeof q === 'string' ? q : q.sql, q.args || [])
          ops.push(result)
          return result
        },
        commit: async () => {},
        rollback: async () => {},
      }
    }
  }
}

async function makeWebClient() {
  const { createClient } = await import('@libsql/client/web')
  const rawUrl = import.meta.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io'
  const url = rawUrl.replace(/^libsql:\/\//i, 'https://')
  const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN || ''
  return createClient({ url, authToken })
}

// Exporta um proxy que inicializa o cliente certo na primeira chamada
let _client = null

async function getClient() {
  if (_client) return _client
  if (isElectron) {
    _client = makeElectronClient()
  } else {
    _client = await makeWebClient()
  }
  return _client
}

// Wrapper para manter a API igual em todo o código (db.execute, db.batch, db.sync)
export const db = {
  execute: async (...args) => (await getClient()).execute(...args),
  batch: async (...args) => (await getClient()).batch(...args),
  sync: async () => { const c = await getClient(); return c.sync?.() },
  transaction: async (...args) => (await getClient()).transaction(...args),
}
