const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ─── Inicialização do Banco de Dados ──────────────────────────────────────────
let db
async function initDatabase() {
  const { createClient } = require('@libsql/client')
  
  if (app.isPackaged) {
    require('dotenv').config({ path: path.join(process.resourcesPath, '.env') })
  } else {
    require('dotenv').config()
  }

  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'wms.db')
  
  console.log('[WMS] Banco de dados em:', dbPath)
  
  const syncUrl = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (syncUrl && authToken) {
    db = createClient({
      url: `file:${dbPath}`,
      syncUrl,
      authToken,
      syncInterval: 60
    })
    try {
      await db.sync()
      console.log('[WMS] Banco sincronizado com Turso.')
    } catch (e) {
      console.error('[WMS] Falha ao sincronizar Turso (modo offline ativado):', e.message)
    }
  } else {
    db = createClient({ url: `file:${dbPath}` })
  }
  
  // Executar migrations
  const { runMigrations } = require('./database/migrations')
  await runMigrations(db)
  
  return db
}

// ─── Janela Principal ─────────────────────────────────────────────────────────
let mainWindow
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,           // Frameless para custom titlebar
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
    mainWindow.webContents.openDevTools()
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
        type: 'question',
        title: 'Atualização Pronta',
        message: 'A atualização foi baixada. Deseja reiniciar agora para aplicar?',
        buttons: ['Reiniciar Agora', 'Mais Tarde']
      }).then(result => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
    })

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdate] Erro:', err.message)
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (db) db.close()
    app.quit()
  }
})

// ─── IPC: Controles da Janela ─────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.restore()
  else mainWindow.maximize()
})
ipcMain.on('window-close', () => mainWindow.close())

// ─── IPC: Retornar caminho do banco ───────────────────────────────────────────
ipcMain.handle('db:get-path', () => {
  return path.join(app.getPath('userData'), 'wms.db')
})

// ─── IPC: Exportar CSV ────────────────────────────────────────────────────────
ipcMain.handle('export:csv', async (event, { filename, content }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (filePath) {
    fs.writeFileSync(filePath, '\uFEFF' + content, 'utf8') // BOM para Excel
    return { success: true, path: filePath }
  }
  return { success: false }
})

// ─── IPC: Queries de Produtos ─────────────────────────────────────────────────
const produtosQueries = require('./database/queries/produtos')
ipcMain.handle('produtos:listar', () => produtosQueries.listar(db))
ipcMain.handle('produtos:buscar-por-codigo', (_, codigo) => produtosQueries.buscarPorCodigo(db, codigo))
ipcMain.handle('produtos:criar', (_, dados) => produtosQueries.criar(db, dados))
ipcMain.handle('produtos:atualizar', (_, dados) => produtosQueries.atualizar(db, dados))
ipcMain.handle('produtos:deletar', (_, id) => produtosQueries.deletar(db, id))

// ─── IPC: Queries de Estoque ──────────────────────────────────────────────────
const estoqueQueries = require('./database/queries/estoque')
ipcMain.handle('estoque:listar-geral', () => estoqueQueries.listarGeral(db))
ipcMain.handle('estoque:buscar-por-endereco-produto', (_, { endereco, produto_id }) => 
  estoqueQueries.buscarPorEnderecoProduto(db, endereco, produto_id))
ipcMain.handle('estoque:buscar-por-endereco', (_, endereco) => 
  estoqueQueries.buscarPorEndereco(db, endereco))
ipcMain.handle('estoque:sugestao-putaway', (_, { produto_id, lote }) => 
  estoqueQueries.sugestaoPutaway(db, produto_id, lote))
ipcMain.handle('estoque:verificar-fefo', (_, { produto_id, validade }) => 
  estoqueQueries.verificarFEFO(db, produto_id, validade))
ipcMain.handle('estoque:kpis', (_, filtros) => estoqueQueries.calcularKPIs(db, filtros))

// ─── IPC: Movimentações ───────────────────────────────────────────────────────
const movimentacoesQueries = require('./database/queries/movimentacoes')
ipcMain.handle('movimentacoes:transferir', (_, dados) => movimentacoesQueries.transferir(db, dados))
ipcMain.handle('movimentacoes:receber', (_, dados) => movimentacoesQueries.receber(db, dados))
ipcMain.handle('movimentacoes:confirmar-despacho', (_, { produto_id, lote, operador_id }) => 
  movimentacoesQueries.confirmarDespacho(db, produto_id, lote, operador_id))
ipcMain.handle('movimentacoes:listar-log', (_, filtros) => movimentacoesQueries.listarLog(db, filtros))
ipcMain.handle('expedicao:listar', () => movimentacoesQueries.listarExpedicao(db))
ipcMain.handle('expedicao:estornar', (_, dados) => movimentacoesQueries.estornarExpedicao(db, dados))
ipcMain.handle('expedicao:enviar', (_, dados) => movimentacoesQueries.enviarParaExpedicao(db, dados))
ipcMain.handle('movimentacoes:relatorio-executivo', (_, filtros) => movimentacoesQueries.relatorioExecutivo(db, filtros))
ipcMain.handle('movimentacoes:deletar-log', (_, id) => movimentacoesQueries.deletarLog(db, id))

// ─── IPC: Inventários ─────────────────────────────────────────────────────────
const inventariosQueries = require('./database/queries/inventarios')
// Ciclos
ipcMain.handle('inventarios:ciclos-listar', () => inventariosQueries.ciclos_listar(db))
ipcMain.handle('inventarios:ciclos-buscar-ativo', () => inventariosQueries.ciclos_buscarAtivo(db))
ipcMain.handle('inventarios:ciclos-criar', (_, dados) => inventariosQueries.ciclos_criar(db, dados))
ipcMain.handle('inventarios:ciclos-encerrar', (_, dados) => inventariosQueries.ciclos_encerrar(db, dados))
ipcMain.handle('inventarios:ciclos-dashboard', (_, ciclo_id) => inventariosQueries.ciclos_dashboard(db, ciclo_id))
// Inventários
ipcMain.handle('inventarios:criar', (_, dados) => inventariosQueries.criar(db, dados))
ipcMain.handle('inventarios:criar-geral', (_, dados) => inventariosQueries.criarGeral(db, dados))
ipcMain.handle('inventarios:criar-carga-inicial', () => inventariosQueries.criarCargaInicial(db))
ipcMain.handle('inventarios:listar', () => inventariosQueries.listar(db))
ipcMain.handle('inventarios:buscar', (_, id) => inventariosQueries.buscar(db, id))
ipcMain.handle('inventarios:itens', (_, inventario_id) => inventariosQueries.listarItens(db, inventario_id))
ipcMain.handle('inventarios:zonas', (_, inventario_id) => inventariosQueries.listarZonas(db, inventario_id))
ipcMain.handle('inventarios:adicionar-item', (_, dados) => inventariosQueries.adicionarItemSurpresa(db, dados))
// Contagem
ipcMain.handle('inventarios:registrar-contagem', (_, dados) => inventariosQueries.registrarContagem(db, dados))
// Conciliação
ipcMain.handle('inventarios:conciliar', (_, dados) => inventariosQueries.conciliar(db, dados))
ipcMain.handle('inventarios:conciliar-carga-inicial', (_, dados) => inventariosQueries.conciliarCargaInicial(db, dados))
ipcMain.handle('inventarios:validar-sem-ajuste', (_, dados) => inventariosQueries.validarEstoqueSemAjuste(db, dados.item_id, dados.operador_id, dados.operador_nome))
// Cancelamento
ipcMain.handle('inventarios:cancelar', (_, id) => inventariosQueries.cancelar(db, id))
ipcMain.handle('inventarios:cancelar-item', (_, item_id) => inventariosQueries.cancelarItem(db, item_id))
ipcMain.handle('inventarios:recontar-item', (_, item_id) => inventariosQueries.recontarItem(db, item_id))
// IRA
ipcMain.handle('inventarios:calcular-ira', (_, inventario_id) => inventariosQueries.calcularIRA(db, inventario_id))
// Log
ipcMain.handle('inventarios:ajustes-log', (_, filtros) => inventariosQueries.listarAjustesLog(db, filtros))
// Bloqueios
ipcMain.handle('inventarios:enderecos-bloqueados', () => inventariosQueries.enderecosBloqueados(db))
ipcMain.handle('inventarios:verificar-bloqueio', (_, endereco) => inventariosQueries.verificarEnderecoBloqueado(db, endereco))

// ─── IPC: Operadores ─────────────────────────────────────────────────────────
const operadoresQueries = require('./database/queries/operadores')
ipcMain.handle('operadores:autenticar', (_, { pin }) => operadoresQueries.autenticar(db, pin))
ipcMain.handle('operadores:listar', () => operadoresQueries.listar(db))
ipcMain.handle('operadores:criar', (_, dados) => operadoresQueries.criar(db, dados))
ipcMain.handle('operadores:atualizar', (_, dados) => operadoresQueries.atualizar(db, dados))
ipcMain.handle('operadores:desativar', (_, id) => operadoresQueries.desativar(db, id))

// ─── IPC: Locais ─────────────────────────────────────────────────────────────
const locaisQueries = require('./database/queries/locais')
ipcMain.handle('locais:listar', () => locaisQueries.listar(db))
ipcMain.handle('locais:buscar', (_, endereco) => locaisQueries.buscarPorEndereco(db, endereco))
ipcMain.handle('locais:criar', (_, dados) => locaisQueries.criar(db, dados))
ipcMain.handle('locais:atualizar', (_, dados) => locaisQueries.atualizar(db, dados))
ipcMain.handle('locais:deletar', (_, id) => locaisQueries.deletar(db, id))
