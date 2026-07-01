import { createClient } from '@libsql/client/web';

const rawDbUrl = import.meta.env.VITE_TURSO_DATABASE_URL || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io';
const dbUrl = rawDbUrl.replace(/^libsql:\/\//i, 'https://');
const dbToken = import.meta.env.VITE_TURSO_AUTH_TOKEN;

if (!dbToken) {
  console.warn('[WMS] Variável de ambiente VITE_TURSO_AUTH_TOKEN ausente.');
}

export const db = createClient({
  url: dbUrl,
  authToken: dbToken || ''
});
