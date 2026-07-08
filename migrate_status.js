import { createClient } from '@libsql/client';

async function migrate() {
  const url = 'https://wms-erp-heroluci123.aws-us-east-1.turso.io';
  const authToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDMwMjUsImlkIjoiMDE5ZWY5ODktOTEwMS03N2IwLTlkYzUtNWIzMjZkYmQwNTk0IiwicmlkIjoiZjg0ZmM3ZTEtZGE4ZC00MWY0LTliODUtYTQ2ZTdhMTk3ODU2In0.jwPV7pJtq6P7s-ApY4hXEMG7TGerCpi1FEEVY2ND8642kawySSLH2udkUgXx4XoaYzNa3y2xgudPeY7Rj-4pBg';
  
  const client = createClient({ url, authToken });

  const sql = `
    PRAGMA foreign_keys=off;
    
    CREATE TABLE new_paletes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      endereco_atual TEXT DEFAULT 'REC',
      status TEXT CHECK(status IN ('EM_MONTAGEM','FECHADO','FINALIZADO')) DEFAULT 'EM_MONTAGEM',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO new_paletes (id, codigo, endereco_atual, status, created_at)
    SELECT id, codigo, endereco_atual,
      CASE
        WHEN status = 'ATIVO' THEN 'EM_MONTAGEM'
        WHEN status = 'DESMONTADO' THEN 'FECHADO'
        ELSE 'EM_MONTAGEM'
      END,
      created_at
    FROM paletes;

    DROP TABLE paletes;
    ALTER TABLE new_paletes RENAME TO paletes;
    CREATE INDEX idx_paletes_codigo ON paletes(codigo);
    
    PRAGMA foreign_keys=on;
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
