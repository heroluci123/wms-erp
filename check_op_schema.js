import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const client = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function run() {
  try {
    const res = await client.execute("SELECT sql FROM sqlite_master WHERE name='ordens_producao'");
    console.log(res.rows[0].sql);
  } catch (e) { console.log(e.message) }
}
run();
