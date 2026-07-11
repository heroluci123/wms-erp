const { createClient } = require('@libsql/client');
require('dotenv').config();

async function migrate() {
  const db = createClient({
    url: process.env.VITE_TURSO_DATABASE_URL || 'file:local.db',
    authToken: process.env.VITE_TURSO_AUTH_TOKEN
  });

  try {
    console.log('Iniciando migração de tipo_armazenamento em locais...');

    // 1. Adicionar coluna (ignora erro se já existir)
    try {
      await db.execute("ALTER TABLE locais ADD COLUMN tipo_armazenamento TEXT DEFAULT 'SECO'");
      console.log('Coluna tipo_armazenamento adicionada.');
    } catch (e) {
      if (e.message.includes('duplicate column name')) {
        console.log('Coluna tipo_armazenamento já existe.');
      } else {
        throw e;
      }
    }

    // 2. Classificar locais existentes
    const resResfriado = await db.execute("UPDATE locais SET tipo_armazenamento = 'FRIO' WHERE endereco LIKE '1R%' OR endereco LIKE '2R%'");
    console.log(`Locais FRIO atualizados: ${resResfriado.rowsAffected || 0}`);

    const resCongelado = await db.execute("UPDATE locais SET tipo_armazenamento = 'CONGELADO' WHERE endereco LIKE 'CON%'");
    console.log(`Locais CONGELADO atualizados: ${resCongelado.rowsAffected || 0}`);

    console.log('Migração concluída com sucesso.');
  } catch (err) {
    console.error('Erro na migração:', err);
  }
}

migrate();
