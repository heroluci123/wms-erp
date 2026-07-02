const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ─── Configurações do banco ───────────────────────────────────────────────────
const REMOTE_URL = 'https://wms-erp-heroluci123.aws-us-east-1.turso.io'
const AUTH_TOKEN  = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'

let localDb   = null  // better-sqlite3 (leitura local instantânea)
let remoteDb  = null  // @libsql/client HTTP (escrita na nuvem)

// ─── Inicialização ────────────────────────────────────────────────────────────
async function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'wms-local.db')
  console.log('[DB] Caminho local:', dbPath)

  // 1. Banco local SQLite (melhor-sqlite3) — sempre rápido
  try {
    const Database = require('better-sqlite3')
    localDb = new Database(dbPath)
    localDb.pragma('journal_mode = WAL')
    localDb.pragma('foreign_keys = ON')
    console.log('[DB] Banco local SQLite aberto com sucesso.')
  } catch (err) {
    console.error('[DB] Falha ao abrir banco local:', err.message)
  }

  // 2. Cliente remoto HTTP (para escritas e sync)
  try {
    const { createClient } = await import('@libsql/client')
    remoteDb = createClient({ url: REMOTE_URL, authToken: AUTH_TOKEN })
    console.log('[DB] Cliente remoto HTTP conectado.')
  } catch (err) {
    console.error('[DB] Falha ao conectar cliente remoto:', err.message)
  }

  // 3. Sincronização inicial: baixar dados da nuvem para o local
  await syncFromRemote()

  // 4. Sync periódico a cada 60 segundos
  setInterval(syncFromRemote, 60000)
}

// ─── Sync: baixa tudo da nuvem para o SQLite local ────────────────────────────
async function syncFromRemote() {
  if (!remoteDb || !localDb) return
  try {
    console.log('[DB] Sincronizando tabelas da nuvem...')

    const tables = ['produtos', 'operadores', 'locais', 'estoque_posicao', 'movimentacoes_log', 'inventarios', 'inventario_itens']

    for (const table of tables) {
      try {
        const res = await remoteDb.execute(`SELECT * FROM ${table}`)
        if (res.rows.length === 0) continue

        const cols = Object.keys(res.rows[0])
        const placeholders = cols.map(() => '?').join(', ')
        const colNames = cols.join(', ')
        const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(', ')

        // Usa UPSERT para atualizar sem deletar a linha (evita erro de Foreign Key)
        const stmt = localDb.prepare(
          `INSERT INTO ${table} (${colNames}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`
        )

        const insertMany = localDb.transaction((rows) => {
          for (const row of rows) {
            stmt.run(cols.map(c => row[c]))
          }
        })
        insertMany(res.rows)
        console.log(`[DB] Sync ${table}: ${res.rows.length} registros`)
      } catch (e) {
        console.warn(`[DB] Sync ${table} falhou:`, e.message)
      }
    }

    console.log('[DB] Sincronização concluída.')
  } catch (err) {
    console.warn('[DB] Sync geral falhou (sem internet?):', err.message)
  }
}

// ─── Serializador para IPC (converte BigInt → Number) ─────────────────────────
function serializeVal(v) {
  if (typeof v === 'bigint') return Number(v)
  return v
}

function makeRows(stmt, params) {
  const raw = params ? stmt.all(...params) : stmt.all()
  return raw.map(row => {
    const obj = {}
    for (const [k, v] of Object.entries(row)) obj[k] = serializeVal(v)
    return obj
  })
}

function runStmt(stmt, params) {
  const info = params ? stmt.run(...params) : stmt.run()
  return {
    rows: [],
    rowsAffected: info.changes,
    lastInsertRowid: info.lastInsertRowid ? String(info.lastInsertRowid) : null
  }
}

// ─── Executa uma query (leitura local, escrita local+remota) ──────────────────
async function executeQuery(sql, args = []) {
  const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql)

  if (localDb) {
    try {
      const stmt = localDb.prepare(sql)
      if (!isWrite) {
        return { rows: makeRows(stmt, args), rowsAffected: 0, lastInsertRowid: null }
      } else {
        const res = runStmt(stmt, args)
        // Escrita também sobe para a nuvem (não bloqueia)
        if (remoteDb) {
          remoteDb.execute({ sql, args }).catch(e =>
            console.warn('[DB] Escrita remota falhou (será replicada no próximo sync):', e.message)
          )
        }
        return res
      }
    } catch (e) {
      console.warn('[DB] Erro no banco local, tentando remoto:', e.message)
    }
  }

  // Fallback: usa remoto
  if (remoteDb) {
    const res = await remoteDb.execute({ sql, args })
    return {
      rows: res.rows.map(r => { const o = {}; for (const [k,v] of Object.entries(r)) o[k] = serializeVal(v); return o }),
      rowsAffected: res.rowsAffected || 0,
      lastInsertRowid: res.lastInsertRowid ? String(res.lastInsertRowid) : null
    }
  }

  throw new Error('Banco de dados não disponível.')
}

// ─── Executa um batch de queries ─────────────────────────────────────────────
async function executeBatch(queries) {
  const results = []
  for (const q of queries) {
    const sql  = typeof q === 'string' ? q : q.sql
    const args = typeof q === 'string' ? [] : (q.args || [])
    results.push(await executeQuery(sql, args))
  }
  return results
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('db-execute', async (event, sql, args) => {
  try {
    return await executeQuery(sql, args || [])
  } catch (err) {
    throw new Error(err.message || 'Erro desconhecido no banco de dados')
  }
})

ipcMain.handle('db-batch', async (event, queries) => {
  try {
    return await executeBatch(queries)
  } catch (err) {
    throw new Error(err.message || 'Erro desconhecido no lote do banco de dados')
  }
})

ipcMain.handle('db-sync', async () => {
  try {
    await syncFromRemote()
    return { ok: true }
  } catch (err) {
    throw new Error(err.message || 'Erro ao sincronizar')
  }
})

// ─── Janela Principal ─────────────────────────────────────────────────────────
let mainWindow
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  await initDatabase()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.checkForUpdates()

    autoUpdater.on('update-available', (info) => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização Disponível',
        message: `Nova versão ${info.version} disponível! Baixando em segundo plano...`,
        buttons: ['OK']
      })
    })

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização Pronta',
        message: 'A atualização foi baixada. O aplicativo será reiniciado para instalar.',
        buttons: ['Reiniciar Agora', 'Depois']
      }).then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.restore()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window-close', () => mainWindow?.close())
