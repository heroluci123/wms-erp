import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const client = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function run() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS caixas_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caixa_id INTEGER,
      ean_caixa TEXT NOT NULL,
      operacao TEXT NOT NULL,
      detalhes TEXT,
      operador_nome TEXT,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_caixas_historico_ean ON caixas_historico(ean_caixa)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_caixas_historico_id ON caixas_historico(caixa_id)`);

  console.log("Table caixas_historico created.");
}
run();
