import { createClient } from '@libsql/client/web';

const isSimulacao = import.meta.env.VITE_SIMULACAO === 'true';
const dbUrl = import.meta.env.VITE_TURSO_DATABASE_URL;
const dbToken = import.meta.env.VITE_TURSO_AUTH_TOKEN;

let client;

if (isSimulacao) {
  console.warn('⚠️ [WMS] Rodando em modo de SIMULAÇÃO. Conectado ao banco local.');
  // Cliente falso que repassa as queries para o servidor Node local
  client = {
    execute: async (query) => {
      const res = await fetch('http://localhost:3001/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof query === 'string' ? { sql: query, args: [] } : query)
      });
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    },
    transaction: async (mode) => {
      // Mock de transação para simulação (executa as queries sequencialmente)
      return {
        execute: async (query) => client.execute(query),
        commit: async () => {},
        rollback: async () => {}
      };
    }
  };
} else {
  if (!dbUrl || !dbToken) {
    console.warn('[WMS] Variáveis de ambiente VITE_TURSO_DATABASE_URL e VITE_TURSO_AUTH_TOKEN ausentes.');
  }
  client = createClient({
    url: dbUrl || 'libsql://wms-erp-heroluci123.aws-us-east-1.turso.io',
    authToken: dbToken || ''
  });
}

export const db = client;
