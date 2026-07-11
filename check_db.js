import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const client = createClient({ url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io', authToken: process.env.VITE_TURSO_AUTH_TOKEN });
async function check() {
  const res = await client.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('estoque_caixas', 'movimentacoes_log')");
  console.log(res.rows.map(r => r.sql).join('\n\n'));
}
check();
