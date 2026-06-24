const Database = require('better-sqlite3');
const path = require('path');

try {
  const dbPath = path.join(__dirname, 'wms.db');
  const db = new Database(dbPath, { fileMustExist: true });
  
  const locais = db.prepare('SELECT * FROM locais').all();
  console.log(JSON.stringify(locais));
} catch(err) {
  console.error(err.message);
}
