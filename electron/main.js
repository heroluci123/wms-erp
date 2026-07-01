const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ─── Banco de Dados LOCAL (Embedded Replica) ──────────────────────────────────
let db = null

async function initDatabase() {
  try {
    const { createClient } = await import('@libsql/client')
    
    const dbPath = path.join(app.getPath('userData'), 'wms-local.db')
    const remoteUrl = 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io'
    const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg'

    console.log('[DB] Inicializando banco local em:', dbPath)

    db = createClient({
      url: `file:${dbPath}`,
      syncUrl: remoteUrl,
      authToken: authToken,
    })

    // Sincronização inicial com a nuvem
    console.log('[DB] Sincronizando com a nuvem...')
    await db.sync()
    console.log('[DB] Sincronização concluída! Banco local pronto.')

    // Sync periódico a cada 30 segundos
    setInterval(async () => {
      try {
        await db.sync()
        console.log('[DB] Sync periódico OK')
      } catch (e) {
        console.warn('[DB] Sync periódico falhou (sem internet?):', e.message)
      }
    }, 30000)

  } catch (err) {
    console.error('[DB] Falha ao inicializar banco local, caindo para HTTP:', err.message)
    // Fallback para conexão HTTP direta caso embedded replica falhe
    const { createClient } = await import('@libsql/client')
    db = createClient({
      url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io',
      authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg',
    })
    console.log('[DB] Usando conexão HTTP direta como fallback.')
  }
}

// ─── IPC Handlers de Banco de Dados ───────────────────────────────────────────
ipcMain.handle('db-execute', async (event, query, args) => {
  if (!db) throw new Error('Banco de dados não inicializado')
  const result = await db.execute(typeof query === 'string' ? { sql: query, args: args || [] } : query)
  return {
    rows: result.rows.map(r => Object.fromEntries(Object.entries(r))),
    rowsAffected: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid?.toString()
  }
})

ipcMain.handle('db-batch', async (event, queries) => {
  if (!db) throw new Error('Banco de dados não inicializado')
  const results = await db.batch(queries, 'deferred')
  return results.map(r => ({
    rows: r.rows.map(row => Object.fromEntries(Object.entries(row))),
    rowsAffected: r.rowsAffected,
    lastInsertRowid: r.lastInsertRowid?.toString()
  }))
})

ipcMain.handle('db-sync', async () => {
  if (!db) throw new Error('Banco de dados não inicializado')
  await db.sync()
  return { ok: true }
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
    // mainWindow.webContents.openDevTools()
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

  // ─── Auto-Update ──────────────────────────────────────────────────────────
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

// ─── IPC Handlers da Janela ───────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.restore()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window-close', () => mainWindow?.close())
