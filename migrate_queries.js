const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'electron/database/queries');
const destDir = path.join(__dirname, 'src/queries');

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

const files = fs.readdirSync(srcDir);

for (const file of files) {
  if (!file.endsWith('.js')) continue;
  
  const srcPath = path.join(srcDir, file);
  const destPath = path.join(destDir, file);
  
  let content = fs.readFileSync(srcPath, 'utf-8');
  
  // Replace module.exports
  content = content.replace(/module\.exports\s*=\s*{[^}]+}/g, '');
  
  // Replace function definitions
  content = content.replace(/async function (\w+)\(db,\s*/g, 'export async function $1(');
  content = content.replace(/async function (\w+)\(db\)/g, 'export async function $1()');
  
  // Some internal functions might not be exported, but making them all exported is fine for now, or the regex just catches them.
  // Actually, wait, some functions might just be function foo(db) without async if they were missed? No, we made them all async.

  // Prepend import
  content = `import { db } from '../lib/db.js';\n\n` + content;
  
  fs.writeFileSync(destPath, content.trim() + '\n', 'utf-8');
  console.log('Migrated', file);
}
