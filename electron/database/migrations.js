/**
 * Migrations do banco SQLite do WMS/ERP
 * Executa criação de tabelas e índices na ordem correta
 */
function runMigrations(db) {
  db.exec(`
    -- ── Locais (Endereços Físicos) ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS locais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endereco TEXT NOT NULL UNIQUE,
      capacidade_max_caixas REAL DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      is_insumo INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_locais_endereco ON locais(endereco);

    -- ── Produtos ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS produtos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo         TEXT UNIQUE,
      ean            TEXT UNIQUE,
      descricao      TEXT NOT NULL,
      valor_unitario REAL DEFAULT 0,
      tipo_produto   TEXT DEFAULT 'Materia Prima',
      status_curva   TEXT CHECK(status_curva IN ('A','B','C')) DEFAULT 'C',
      unidade        TEXT DEFAULT 'CX',
      grupo          TEXT DEFAULT '',
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos(codigo);

    -- ── Estoque por Posição ────────────────────────────────────────────────────
    -- Chave única: produto_id + endereco + lote (mesmo produto/lote em endereços diferentes = linhas diferentes)
    CREATE TABLE IF NOT EXISTS estoque_posicao (
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
    CREATE INDEX IF NOT EXISTS idx_estoque_endereco ON estoque_posicao(endereco);
    CREATE INDEX IF NOT EXISTS idx_estoque_produto  ON estoque_posicao(produto_id);
    CREATE INDEX IF NOT EXISTS idx_estoque_validade ON estoque_posicao(validade);

    -- ── Log de Movimentações (auditoria imutável) ──────────────────────────────
    CREATE TABLE IF NOT EXISTS movimentacoes_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id        INTEGER REFERENCES produtos(id),
      endereco_origem   TEXT,
      endereco_destino  TEXT,
      lote              TEXT,
      qtd_caixas        REAL,
      qtd_kg            REAL,
      data_hora         DATETIME DEFAULT CURRENT_TIMESTAMP,
      operador_id       INTEGER REFERENCES operadores(id),
      operador_nome     TEXT,
      tipo              TEXT CHECK(tipo IN ('RECEBIMENTO','TRANSFERENCIA','DESPACHO','AJUSTE'))
    );
    CREATE INDEX IF NOT EXISTS idx_log_data ON movimentacoes_log(data_hora DESC);

    -- ── Ciclos de Inventário ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventario_ciclos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      nome             TEXT NOT NULL,
      status           TEXT DEFAULT 'Ativo',
      target_pct       REAL DEFAULT 99.9,
      data_criacao     DATETIME DEFAULT CURRENT_TIMESTAMP,
      data_encerramento DATETIME
    );

    -- ── Inventários ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventarios (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_filtro          TEXT,
      identificador_filtro TEXT,
      nome                 TEXT,
      tipo                 TEXT DEFAULT 'Ciclico',
      ciclo_id             INTEGER REFERENCES inventario_ciclos(id),
      status               TEXT DEFAULT 'Aberto',
      data_criacao         DATETIME DEFAULT CURRENT_TIMESTAMP,
      data_finalizacao     DATETIME
    );

    -- ── Zonas de Inventário Geral (Wall-to-Wall) ───────────────────────────────
    CREATE TABLE IF NOT EXISTS inventario_zonas (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id  INTEGER NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
      nome_zona      TEXT NOT NULL,
      status         TEXT DEFAULT 'Aberto'
    );

    -- ── Log de Ajustes de Inventário ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS inventario_ajustes_log (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id        INTEGER REFERENCES inventarios(id),
      ciclo_id             INTEGER REFERENCES inventario_ciclos(id),
      item_id              INTEGER REFERENCES inventario_itens(id),
      produto_id           INTEGER REFERENCES produtos(id),
      endereco             TEXT,
      lote                 TEXT,
      custo_unitario_data  REAL DEFAULT 0,
      qtd_ajustada_caixas  REAL DEFAULT 0,
      qtd_ajustada_kg      REAL DEFAULT 0,
      tipo_ajuste          TEXT,
      usuario_contou_id    INTEGER REFERENCES operadores(id),
      usuario_aprovou_id   INTEGER REFERENCES operadores(id),
      usuario_aprovou_nome TEXT,
      data_ajuste          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ajustes_log_ciclo ON inventario_ajustes_log(ciclo_id);
    CREATE INDEX IF NOT EXISTS idx_ajustes_log_inv   ON inventario_ajustes_log(inventario_id);

    CREATE TABLE IF NOT EXISTS inventario_itens (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id        INTEGER NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
      endereco             TEXT    NOT NULL,
      produto_id           INTEGER NOT NULL REFERENCES produtos(id),
      lote                 TEXT    NOT NULL DEFAULT '',
      validade             DATE,
      qtd_sistema_caixas   REAL,
      qtd_sistema_kg       REAL,
      qtd_contada_caixas   REAL,
      qtd_contada_kg       REAL,
      contagem_atual       INTEGER DEFAULT 1,
      qtd_1_caixas         REAL,
      qtd_1_kg             REAL,
      qtd_2_caixas         REAL,
      qtd_2_kg             REAL,
      qtd_3_caixas         REAL,
      qtd_3_kg             REAL,
      status_item          TEXT DEFAULT 'Pendente', -- Removido CHECK restrito
      data_contagem        DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_inv_itens_inventario ON inventario_itens(inventario_id);

    -- ── Operadores / Usuários ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS operadores (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nome       TEXT NOT NULL,
      pin        TEXT NOT NULL,
      perfil     TEXT CHECK(perfil IN ('operador','gestor')) DEFAULT 'operador',
      ativo      INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Seed inicial: criar operador gestor padrão se não existir
  const gestor = db.prepare("SELECT id FROM operadores WHERE pin = '0000' LIMIT 1").get()
  if (!gestor) {
    db.prepare(`
      INSERT INTO operadores (nome, pin, perfil) VALUES ('Administrador', '0000', 'gestor')
    `).run()
  }

  // Migrations dinâmicas: adicionar colunas novas (ignora se já existir)
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN contagem_atual INTEGER DEFAULT 1;") } catch(e){}
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN qtd_1_caixas REAL;") } catch(e){}
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN qtd_1_kg REAL;") } catch(e){}
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN qtd_2_caixas REAL;") } catch(e){}
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN qtd_2_kg REAL;") } catch(e){}
  // Migrations dinâmicas: Ajustes incrementais sem apagar dados
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN qtd_3_caixas REAL;") } catch(e){}
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN qtd_3_kg REAL;") } catch(e){}
  // Validade informada pelo operador (separada da validade do sistema)
  try { db.exec("ALTER TABLE inventario_itens ADD COLUMN validade_contada DATE;") } catch(e){}
  try {
    db.prepare(`
      ALTER TABLE produtos ADD COLUMN tipo_produto TEXT DEFAULT 'Materia Prima'
    `).run()
    console.log('[WMS] Coluna tipo_produto adicionada a produtos.')
  } catch (e) {
    console.log('[WMS] Coluna tipo_produto já existe ou não pôde ser criada:', e.message)
  }

  try {
    db.exec("ALTER TABLE produtos ADD COLUMN ean TEXT;")
    console.log('[WMS] Coluna ean adicionada a produtos.')
  } catch (e) {
    console.log('[WMS] Coluna ean já existe:', e.message)
  }
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_ean ON produtos(ean) WHERE ean IS NOT NULL AND ean != '';") } catch(e){}

  try {
    db.prepare(`
      ALTER TABLE locais ADD COLUMN is_insumo INTEGER DEFAULT 0
    `).run()
    console.log('[WMS] Coluna is_insumo adicionada a locais.')
  } catch (e) {
    console.log('[WMS] Coluna is_insumo já existe ou não pôde ser criada:', e.message)
  }

  // Patch: is_adm em operadores
  try { db.exec("ALTER TABLE operadores ADD COLUMN is_adm INTEGER DEFAULT 0;") } catch(e){}
  // Patch: coluna 'tipo' e 'ciclo_id' em inventarios (retrocompatível)
  try { db.exec("ALTER TABLE inventarios ADD COLUMN tipo TEXT DEFAULT 'Ciclico';") } catch(e){}
  try { db.exec("ALTER TABLE inventarios ADD COLUMN ciclo_id INTEGER;") } catch(e){}
  try { db.exec("ALTER TABLE inventarios ADD COLUMN nome TEXT;") } catch(e){}
  // Garantir que o ADM padrão tem is_adm=1
  try {
    db.prepare("UPDATE operadores SET is_adm = 1 WHERE pin = '0000' AND perfil = 'gestor'").run()
  } catch(e) {}

  try { 
    db.exec("ALTER TABLE operadores ADD COLUMN permissoes TEXT DEFAULT '{}';") 
    // Se a coluna foi criada com sucesso, migra os perfis antigos
    console.log('[WMS] Coluna permissoes adicionada. Migrando perfis legados...')
    
    // Permissões completas para gestor
    const permissoesGestor = JSON.stringify({
      recebimento: true,
      movimentacao: true,
      saida: true,
      expedicao: true,
      inventario_coletor: true,
      inventario_gestao: true,
      produtos: true,
      locais: true,
      operadores: true,
      dashboard_executivo: true
    })
    
    // Permissões limitadas para operador antigo (por padrão)
    const permissoesOperador = JSON.stringify({
      recebimento: true,
      movimentacao: true,
      saida: true,
      expedicao: true,
      inventario_coletor: true,
      inventario_gestao: false,
      produtos: true,
      locais: false,
      operadores: false,
      dashboard_executivo: false
    })

    db.prepare(`UPDATE operadores SET permissoes = ? WHERE perfil = 'gestor'`).run(permissoesGestor)
    db.prepare(`UPDATE operadores SET permissoes = ? WHERE perfil = 'operador'`).run(permissoesOperador)
    console.log('[WMS] Migração de permissões concluída.')
  } catch(e) {
    // Coluna já existe — fazer patch incremental para adicionar dashboard_executivo
    // nos gestores existentes que ainda não possuem esse campo
    try {
      const gestores = db.prepare("SELECT id, permissoes FROM operadores WHERE perfil = 'gestor'").all()
      for (const g of gestores) {
        try {
          const perms = JSON.parse(g.permissoes || '{}')
          if (perms.dashboard_executivo === undefined) {
            perms.dashboard_executivo = true
            db.prepare('UPDATE operadores SET permissoes = ? WHERE id = ?').run(JSON.stringify(perms), g.id)
            console.log('[WMS] Patch dashboard_executivo aplicado no operador id=' + g.id)
          }
        } catch(pe) {}
      }
    } catch(pe2) {}
  }

  // Migration crítica: remover CHECK constraints antigos que bloqueiam novos status
  // Verifica se a tabela inventario_itens ainda tem o CHECK antigo
  const itemsTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventario_itens'").get()
  if (itemsTableInfo && itemsTableInfo.sql && itemsTableInfo.sql.includes("'Pendente','OK','Divergente'")) {
    console.log('[WMS] Recriando inventario_itens sem CHECK constraint antigo...')
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE inventario_itens_v3 (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        inventario_id        INTEGER NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
        endereco             TEXT    NOT NULL,
        produto_id           INTEGER NOT NULL REFERENCES produtos(id),
        lote                 TEXT    NOT NULL DEFAULT '',
        validade             DATE,
        qtd_sistema_caixas   REAL,
        qtd_sistema_kg       REAL,
        qtd_contada_caixas   REAL,
        qtd_contada_kg       REAL,
        contagem_atual       INTEGER DEFAULT 1,
        qtd_1_caixas         REAL,
        qtd_1_kg             REAL,
        qtd_2_caixas         REAL,
        qtd_2_kg             REAL,
        qtd_3_caixas         REAL,
        qtd_3_kg             REAL,
        status_item          TEXT    DEFAULT 'Pendente',
        data_contagem        DATETIME
      );
      INSERT INTO inventario_itens_v3
        SELECT id, inventario_id, endereco, produto_id, lote, validade,
               qtd_sistema_caixas, qtd_sistema_kg, qtd_contada_caixas, qtd_contada_kg,
               1, NULL, NULL, NULL, NULL, NULL, NULL, status_item, data_contagem
        FROM inventario_itens;
      DROP TABLE inventario_itens;
      ALTER TABLE inventario_itens_v3 RENAME TO inventario_itens;
      CREATE INDEX IF NOT EXISTS idx_inv_itens_inventario ON inventario_itens(inventario_id);
      PRAGMA foreign_keys = ON;
    `)
    console.log('[WMS] inventario_itens recriada com sucesso.')
  }

  // Verifica se a tabela inventarios ainda tem o CHECK antigo
  const invTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventarios'").get()
  if (invTableInfo && invTableInfo.sql && invTableInfo.sql.includes("'Aberto','Em Contagem','Divergente','Finalizado'")) {
    console.log('[WMS] Recriando inventarios sem CHECK constraint antigo...')
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE inventarios_v3 (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo_filtro          TEXT CHECK(tipo_filtro IN ('Curva','Rua')),
        identificador_filtro TEXT,
        status               TEXT DEFAULT 'Aberto',
        data_criacao         DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_finalizacao     DATETIME
      );
      INSERT INTO inventarios_v3 SELECT * FROM inventarios;
      DROP TABLE inventarios;
      ALTER TABLE inventarios_v3 RENAME TO inventarios;
      PRAGMA foreign_keys = ON;
    `)
    console.log('[WMS] inventarios recriada com sucesso.')
  }

  console.log('[WMS] Migrations executadas com sucesso.')

  // ─── Migração Especial: Atualizar UNIQUE de estoque_posicao ─────────────────
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='estoque_posicao'").get()
    if (tableInfo && !tableInfo.sql.includes('UNIQUE(produto_id, endereco, lote, validade)')) {
      console.log('[WMS] Aplicando migração da constraint UNIQUE em estoque_posicao...')
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
      `)
      console.log('[WMS] Migração UNIQUE concluída.')
    }
  } catch (err) {
    console.error('[WMS] Erro na migração UNIQUE de estoque_posicao:', err)
  }

  // ─── Migração Especial: Flexibilização da Tabela de Produtos ─────────────────
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='produtos'").get()
    if (tableInfo && (tableInfo.sql.includes('codigo         TEXT NOT NULL UNIQUE') || !tableInfo.sql.includes('ean            TEXT UNIQUE'))) {
      console.log('[WMS] Aplicando migração de flexibilização na tabela produtos...')
      db.exec(`
        PRAGMA foreign_keys=off;
        BEGIN TRANSACTION;
        CREATE TABLE produtos_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo         TEXT UNIQUE,
          ean            TEXT UNIQUE,
          descricao      TEXT NOT NULL,
          valor_unitario REAL DEFAULT 0,
          tipo_produto   TEXT DEFAULT 'Materia Prima',
          status_curva   TEXT CHECK(status_curva IN ('A','B','C')) DEFAULT 'C',
          unidade        TEXT DEFAULT 'CX',
          created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO produtos_new (id, codigo, ean, descricao, valor_unitario, tipo_produto, status_curva, unidade, created_at)
        SELECT id, 
               CASE WHEN codigo = '' THEN NULL ELSE codigo END, 
               CASE WHEN ean = '' THEN NULL ELSE ean END, 
               descricao, valor_unitario, tipo_produto, status_curva, unidade, created_at 
        FROM produtos;
        DROP TABLE produtos;
        ALTER TABLE produtos_new RENAME TO produtos;
        CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos(codigo);
        COMMIT;
        PRAGMA foreign_keys=on;
      `)
      console.log('[WMS] Migração de produtos concluída.')
    }
  } catch (err) {
    console.error('[WMS] Erro na migração da tabela produtos:', err)
  }
  try {
    db.exec("ALTER TABLE produtos ADD COLUMN grupo TEXT DEFAULT '';")
    console.log('[WMS] Coluna grupo adicionada à tabela produtos.')
  } catch (e) {
    // Ignora se a coluna já existir
  }
}

module.exports = { runMigrations }
