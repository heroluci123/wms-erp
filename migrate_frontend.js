const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      results.push(file);
    }
  });
  return results;
}

const files = walk('src').filter(f => f.endsWith('.jsx') || f.endsWith('.js'));

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;

  // Extract all namespaces used
  const namespaces = new Set();
  const regex = /window\.wmsAPI\.(\w+)\.(\w+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    namespaces.add(match[1]);
  }

  if (namespaces.size > 0) {
    // Replace window.wmsAPI.ns.method with nsQueries.method
    content = content.replace(/window\.wmsAPI\.(\w+)\.(\w+)/g, '$1Queries.$2');
    
    // Replace windowQueries.close(), etc with empty function or handle them
    content = content.replace(/windowQueries\.minimize\(\)/g, '(() => {})()');
    content = content.replace(/windowQueries\.maximize\(\)/g, '(() => {})()');
    content = content.replace(/windowQueries\.close\(\)/g, '(() => {})()');
    content = content.replace(/dbQueries\.getPath\(\)/g, '""');
    content = content.replace(/exportQueries\.csv\([^,]+,\s*([^)]+)\)/g, 'downloadCSV($1)'); // We will implement downloadCSV later if needed, or ignore

    namespaces.delete('window');
    namespaces.delete('db');
    namespaces.delete('export');

    // Add imports
    const depth = file.split(path.sep).length - 2; // src/pages/Login.jsx -> depth=1
    const prefix = depth === 0 ? './' : '../'.repeat(depth);
    
    let importsToAdd = '';
    namespaces.forEach(ns => {
      // Check if import already exists
      if (!content.includes(`import * as ${ns}Queries`)) {
        importsToAdd += `import * as ${ns}Queries from '${prefix}queries/${ns}.js';\n`;
      }
    });

    if (importsToAdd) {
      // Add after the last import, or at the top
      const lastImportIndex = content.lastIndexOf('import ');
      if (lastImportIndex !== -1) {
        const endOfImport = content.indexOf('\n', lastImportIndex);
        content = content.slice(0, endOfImport + 1) + importsToAdd + content.slice(endOfImport + 1);
      } else {
        content = importsToAdd + '\n' + content;
      }
    }

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      console.log('Updated', file);
    }
  }
});
