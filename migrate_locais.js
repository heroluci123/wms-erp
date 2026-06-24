const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config();

async function run() {
  try {
    const dbPath = path.join(process.env.APPDATA, 'Electron', 'wms.db');
    // Lê do banco antigo local
    const localDb = createClient({ url: `file:${dbPath}` });
    const res = await localDb.execute('SELECT * FROM locais');
    const locais = res.rows;
    
    console.log(`Encontrados ${locais.length} locais no banco offline.`);
    
    if (locais.length > 0) {
      // Conecta no Turso
      const tursoDb = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
      });
      
      console.log('Migrando para a nuvem...');
      const tx = await tursoDb.transaction('write');
      for (const loc of locais) {
        try {
          await tx.execute({
            sql: 'INSERT INTO locais (codigo, descricao, tipo, capacidade_kg, status) VALUES (?, ?, ?, ?, ?)',
            args: [loc.codigo, loc.descricao, loc.tipo, loc.capacidade_kg, loc.status]
          });
        } catch (e) {
          if (!e.message.includes('UNIQUE')) {
            console.error(`Erro no local ${loc.codigo}:`, e.message);
          }
        }
      }
      await tx.commit();
      console.log('Locais migrados com sucesso!');
    }
  } catch(err) {
    console.error('Erro:', err.message);
  }
}

run();
