import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const client = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

async function run() {
  try {
    await client.execute('ALTER TABLE op_insumos ADD COLUMN operador_nome TEXT;');
    console.log('Added operador_nome to op_insumos');
  } catch (e) { console.log(e.message) }
  try {
    await client.execute('ALTER TABLE op_retornos ADD COLUMN operador_nome TEXT;');
    console.log('Added operador_nome to op_retornos');
  } catch (e) { console.log(e.message) }
}
run();
