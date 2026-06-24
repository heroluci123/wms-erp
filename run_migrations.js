const { createClient } = require('@libsql/client');
const { runMigrations } = require('./electron/database/migrations.js');
require('dotenv').config();

async function migrate() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
  
  console.log('Running migrations...');
  await runMigrations(db);
  console.log('Migrations complete!');
}

migrate().catch(console.error);
