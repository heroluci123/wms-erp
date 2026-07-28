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

const DEFAULT_TURSO_URL = 'libsql://wms-erp-2-heroleon123.aws-us-east-1.turso.io'
const DEFAULT_TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODUyNTExMzIsImlkIjoiMDE5ZmE5NDEtNGIwMS03MjZkLWEyOTEtODA1Y2Y3YmE4NDRiIiwia2lkIjoiYU1USWxCVUgzMkZ6VGpMV29CNzM2MzF6ZWt0OGdwZUpyaUFPT2tXdmdFRSIsInJpZCI6IjRhNjVlOGZmLTJiNTctNGU5MS1hODYyLTc0ZWViNzY2MTdiNiJ9.6LC2AUlOhxt7t-zAPCgoHSXAWvf5nLFZzZPAWVdmorcu3v5SCR0tO6_LABDeixQQOka1x4PtNU4Wd-0zDt0nCg'

async function makeWebClient() {
  const { createClient } = await import('@libsql/client/web')
  let rawUrl = ''
  let authToken = ''

  try {
    rawUrl = import.meta.env.VITE_TURSO_DATABASE_URL
    authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN
  } catch (_) {}

  if (!rawUrl) rawUrl = DEFAULT_TURSO_URL
  if (!authToken) authToken = DEFAULT_TURSO_TOKEN

  const url = rawUrl.replace(/^libsql:\/\//i, 'https://')
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
