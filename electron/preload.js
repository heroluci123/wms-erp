const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wmsAPI', {
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
  },
  // Ponte para o banco de dados local (IPC)
  db: {
    execute: (query, args) => ipcRenderer.invoke('db-execute', query, args),
    batch: (queries) => ipcRenderer.invoke('db-batch', queries),
    sync: () => ipcRenderer.invoke('db-sync'),
  }
})
