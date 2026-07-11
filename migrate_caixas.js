import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const client = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function run() {
  try {
    const queries = [
      'PRAGMA foreign_keys=off',
      `CREATE TABLE estoque_caixas_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ean_caixa TEXT NOT NULL UNIQUE,
        produto_id INTEGER NOT NULL REFERENCES produtos(id),
        palete_id INTEGER REFERENCES paletes(id),
        endereco TEXT,
        lote TEXT DEFAULT '',
        validade DATE,
        peso_kg REAL NOT NULL,
        status TEXT CHECK(status IN ('DISPONIVEL','CONSUMIDA','RESERVADA','BLOQUEADO','EXPEDIDA')) DEFAULT 'DISPONIVEL',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `INSERT INTO estoque_caixas_new (id, ean_caixa, produto_id, palete_id, endereco, lote, validade, peso_kg, status, created_at, updated_at)
       SELECT id, ean_caixa, produto_id, palete_id, endereco, lote, validade, peso_kg, status, created_at, updated_at
       FROM estoque_caixas`,
      'DROP TABLE estoque_caixas',
      'ALTER TABLE estoque_caixas_new RENAME TO estoque_caixas',
      'PRAGMA foreign_keys=on'
    ];

    await client.batch(queries, 'write');
    console.log("Migration successful");
  } catch(e) {
    console.error("Migration failed:", e);
  }
}
run();
