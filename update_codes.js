import { createClient } from '@libsql/client/web';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

let rawData = fs.readFileSync('data.json', 'utf8');
if (rawData.charCodeAt(0) === 0xFEFF) {
  rawData = rawData.slice(1);
}
const dataObj = JSON.parse(rawData);
const text = dataObj.content;

const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

const parsedLines = [];
let hasCodeRegex = /^(\d+)\s+(.+)$/;
for (let line of lines) {
  const match = line.match(hasCodeRegex);
  if (match) {
    parsedLines.push({ code: match[1], rest: match[2].trim() });
  }
}

async function run() {
  const url = process.env.VITE_TURSO_DATABASE_URL.replace(/^libsql:\/\//i, 'https://');
  const authToken = process.env.VITE_TURSO_AUTH_TOKEN;
  const db = createClient({ url, authToken });

  const { rows } = await db.execute('SELECT id, codigo, descricao FROM produtos');
  
  let updates = [];
  
  for (let row of rows) {
    let dbDesc = row.descricao.trim();
    
    let matchedLine = null;
    for (let pl of parsedLines) {
      if (pl.rest.startsWith(dbDesc)) {
        matchedLine = pl;
        break;
      }
    }
    
    if (matchedLine) {
      let expectedCode = matchedLine.code;
      if (String(row.codigo) !== String(expectedCode)) {
        updates.push({ id: row.id, oldCode: row.codigo, newCode: expectedCode, desc: row.descricao });
      }
    }
  }

  console.log('Found', updates.length, 'products to update.');
  
  let successCount = 0;
  let failCount = 0;

  for (let u of updates) {
    try {
      // 1. Check if another product has this newCode
      const { rows: conflictRows } = await db.execute({
        sql: 'SELECT id, descricao FROM produtos WHERE codigo = ? AND id != ?',
        args: [u.newCode, u.id]
      });
      
      if (conflictRows.length > 0) {
        console.log(`Conflict! Code ${u.newCode} is currently used by: ${conflictRows[0].descricao}. Freeing it...`);
        // Append _old to the conflict product's code
        await db.execute({
          sql: 'UPDATE produtos SET codigo = codigo || ? WHERE id = ?',
          args: ['_old_' + Math.floor(Math.random()*1000), conflictRows[0].id]
        });
      }

      await db.execute({
        sql: 'UPDATE produtos SET codigo = ? WHERE id = ?',
        args: [u.newCode, u.id]
      });
      console.log(`✅ Updated: "${u.desc}" -> Code: ${u.newCode}`);
      successCount++;
    } catch (err) {
      console.error(`❌ Failed: "${u.desc}" -> Code: ${u.newCode}`, err.message);
      failCount++;
    }
  }

  console.log(`Done! ${successCount} updated, ${failCount} failed.`);
}

run().catch(console.error);
