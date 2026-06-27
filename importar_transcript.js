import fs from 'fs';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
  url: process.env.VITE_TURSO_DATABASE_URL,
  authToken: process.env.VITE_TURSO_AUTH_TOKEN
});

const transcriptPath = `C:\\Users\\rafac\\.gemini\\antigravity\\brain\\e78e844c-9d57-4661-a5ad-84792ab41254\\.system_generated\\logs\\transcript_full.jsonl`;

async function run() {
  const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
  let userData = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    try {
      const step = JSON.parse(lines[i]);
      if (step.type === 'USER_INPUT' && step.content.includes('cadastre mais esses itens aqui')) {
        userData = step.content;
        break;
      }
    } catch(e) {}
  }

  if (!userData) {
    console.error('Could not find user request in transcript.');
    return;
  }

  const match = userData.match(/CODIGO\s+DESCRICAO\s+GRUPO\n([\s\S]+)$/);
  if (!match) {
    console.error('Could not parse table');
    return;
  }
  
  let rawText = match[1];
  rawText = rawText.replace(/<\/USER_REQUEST>[\s\S]*/, '');
  rawText = rawText.replace(/NOTE: The output was truncated[\s\S]*/, '');
  
  const rows = rawText.trim().split('\n');
  console.log(`Encontradas ${rows.length} linhas. Iniciando importação em lotes...`);

  const batchStmts = [];
  for (let row of rows) {
    const parts = row.split('\t');
    if (parts.length >= 2) {
      const codigo = parts[0].trim();
      const descricao = parts[1].trim();
      const grupo = parts[2] ? parts[2].trim() : '';
      
      batchStmts.push({
        sql: 'INSERT OR IGNORE INTO produtos (codigo, descricao, grupo, tipo_produto, status_curva, unidade, valor_unitario) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [codigo, descricao, grupo, 'Materia Prima', 'C', 'CX', 0]
      });
    }
  }
  
  const chunkSize = 100;
  let successCount = 0;
  for (let i = 0; i < batchStmts.length; i += chunkSize) {
    const chunk = batchStmts.slice(i, i + chunkSize);
    try {
        const results = await db.batch(chunk, 'write');
        successCount += results.filter(r => r.rowsAffected > 0).length;
        console.log(`Lote ${Math.floor(i/chunkSize) + 1} processado. Produtos inseridos neste lote: ${results.filter(r => r.rowsAffected > 0).length}`);
    } catch(e) {
        console.error('Erro no lote:', e.message);
    }
  }

  console.log(`Importação concluída! Total processado: ${batchStmts.length} | Inserções Novas: ${successCount} | Pulados (já existiam): ${batchStmts.length - successCount}`);
}

run();
