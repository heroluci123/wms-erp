import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL,
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function addIndexes() {
  console.log('Creating database indexes for performance...');
  try {
    await db.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_mov_data ON movimentacoes_log(data_hora);
      CREATE INDEX IF NOT EXISTS idx_mov_tipo_data ON movimentacoes_log(tipo, data_hora);
      CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentacoes_log(produto_id);
      
      CREATE INDEX IF NOT EXISTS idx_estoque_produto ON estoque_posicao(produto_id);
      CREATE INDEX IF NOT EXISTS idx_estoque_endereco ON estoque_posicao(endereco);
      
      CREATE INDEX IF NOT EXISTS idx_produtos_curva ON produtos(status_curva);
    `);
    console.log('Indexes created successfully!');
  } catch (e) {
    console.error('Error creating indexes:', e.message);
  }
}

addIndexes();
