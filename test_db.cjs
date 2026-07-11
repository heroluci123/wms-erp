const Database = require('better-sqlite3');
const db = new Database('./data/wms.db');
const rows = db.prepare("SELECT endereco, qtd_caixas, produto_id FROM estoque_posicao WHERE endereco LIKE 'CON%'").all();
console.log(rows);
const locais = db.prepare("SELECT endereco FROM locais WHERE endereco LIKE 'CON%'").all();
console.log('Locais:', locais);
