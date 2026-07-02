const { app } = require('electron');
const DB = require('better-sqlite3');
const { createClient } = require('@libsql/client');

app.whenReady().then(async () => {
  const remote = createClient({ 
    url: 'https://wms-erp-heroluci123.aws-us-east-1.turso.io', 
    authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg' 
  });
  
  const local = new DB('C:/Users/rafac/AppData/Roaming/wms-erp/wms-local.db');
  
  const tables = ['produtos', 'locais', 'estoque_posicao'];
  
  for (const t of tables) {
    try {
      const res = await remote.execute('SELECT * FROM ' + t);
      if (res.rows.length === 0) continue;
      
      const cols = Object.keys(res.rows[0]);
      const placeholders = cols.map(() => '?').join(', ');
      const colNames = cols.join(', ');
      const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(', ');
      
      const stmt = local.prepare('INSERT INTO ' + t + ' (' + colNames + ') VALUES (' + placeholders + ') ON CONFLICT(id) DO UPDATE SET ' + updates);
      
      const insertMany = local.transaction((rows) => {
        for (const row of rows) {
          stmt.run(cols.map(c => row[c]));
        }
      });
      insertMany(res.rows);
      console.log('Sync ' + t + ' OK');
    } catch (e) {
      console.error('Error in ' + t + ':', e.message);
    }
  }
  app.quit();
});
