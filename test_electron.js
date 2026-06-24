const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false });
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[CONSOLE] ${message}`);
  });
  win.loadURL('http://localhost:5173').catch(err => {
    console.error('Failed to load url:', err);
  });
  setTimeout(() => app.quit(), 5000);
});
