import { createClient } from '@libsql/client/web';

const dbUrl = import.meta.env.VITE_TURSO_DATABASE_URL;
const dbToken = import.meta.env.VITE_TURSO_AUTH_TOKEN;

// Se não tiver as variáveis (e estiver rodando num ambiente configurado), avisa no console
if (!dbUrl || !dbToken) {
  console.warn('[WMS] Variáveis de ambiente VITE_TURSO_DATABASE_URL e VITE_TURSO_AUTH_TOKEN ausentes.');
}

// Cria o cliente apontando diretamente para o Turso
export const db = createClient({
  url: dbUrl || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
  authToken: dbToken || ''
});
