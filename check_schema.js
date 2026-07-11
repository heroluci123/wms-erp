import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const client = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function run() {
  const res = await client.execute("SELECT sql FROM sqlite_master WHERE name='estoque_caixas'");
  console.log(res.rows[0].sql);
}
run();
