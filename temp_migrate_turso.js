import { createClient } from '@libsql/client';

async function migrate() {
  const url = 'https://wms-erp-heroluci123.aws-us-east-1.turso.io';
  const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg';
  
  const client = createClient({ url, authToken });

  const sql = `
    CREATE TABLE IF NOT EXISTS paletes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      endereco_atual TEXT DEFAULT 'REC',
      status TEXT CHECK(status IN ('ATIVO','DESMONTADO')) DEFAULT 'ATIVO',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_paletes_codigo ON paletes(codigo);

    CREATE TABLE IF NOT EXISTS estoque_caixas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ean_caixa TEXT NOT NULL UNIQUE,
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      palete_id INTEGER REFERENCES paletes(id),
      endereco TEXT,
      lote TEXT DEFAULT '',
      validade DATE,
      peso_kg REAL NOT NULL,
      status TEXT CHECK(status IN ('DISPONIVEL','CONSUMIDA')) DEFAULT 'DISPONIVEL',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_estoque_caixas_ean ON estoque_caixas(ean_caixa);
    CREATE INDEX IF NOT EXISTS idx_estoque_caixas_palete ON estoque_caixas(palete_id);
    CREATE INDEX IF NOT EXISTS idx_estoque_caixas_endereco ON estoque_caixas(endereco);
  `;

  try {
    console.log('Running migrations on Turso...');
    await client.executeMultiple(sql);
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

migrate();
