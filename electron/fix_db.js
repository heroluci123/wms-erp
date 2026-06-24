const db = require('better-sqlite3')('database.sqlite');
db.exec(`
  PRAGMA foreign_keys=off;
  BEGIN TRANSACTION;
  CREATE TABLE estoque_posicao_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
    endereco    TEXT    NOT NULL,
    lote        TEXT    NOT NULL DEFAULT '',
    validade    DATE,
    qtd_caixas  REAL    DEFAULT 0,
    qtd_kg      REAL    DEFAULT 0,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(produto_id, endereco, lote, validade)
  );
  INSERT INTO estoque_posicao_new SELECT * FROM estoque_posicao;
  DROP TABLE estoque_posicao;
  ALTER TABLE estoque_posicao_new RENAME TO estoque_posicao;
  CREATE INDEX IF NOT EXISTS idx_estoque_endereco ON estoque_posicao(endereco);
  CREATE INDEX IF NOT EXISTS idx_estoque_produto  ON estoque_posicao(produto_id);
  CREATE INDEX IF NOT EXISTS idx_estoque_validade ON estoque_posicao(validade);
  COMMIT;
  PRAGMA foreign_keys=on;
`);
console.log("Banco de dados corrigido com sucesso!");
