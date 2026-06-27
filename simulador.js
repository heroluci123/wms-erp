import { createClient } from '@libsql/client';
import http from 'http';
import fs from 'fs';

const DB_FILE = 'file:banco-simulacao.db';
const PORT = 3001;

// Inicializa o banco local
const db = createClient({ url: DB_FILE });

async function setupFakeData() {
  console.log('Verificando banco de simulação...');
  
  // Cria tabelas se não existirem
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS locais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endereco TEXT UNIQUE NOT NULL,
      capacidade_max_caixas INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      descricao TEXT NOT NULL,
      grupo TEXT,
      tipo_produto TEXT,
      dias_validade INTEGER,
      valor_unitario REAL,
      status_curva TEXT DEFAULT 'C',
      unidade TEXT DEFAULT 'CX',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS estoque_posicao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER,
      endereco TEXT NOT NULL,
      lote TEXT,
      validade DATE,
      qtd_caixas INTEGER DEFAULT 0,
      qtd_kg REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(produto_id) REFERENCES produtos(id)
    );
    CREATE TABLE IF NOT EXISTS movimentacoes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER,
      endereco_origem TEXT,
      endereco_destino TEXT,
      lote TEXT,
      qtd_caixas INTEGER,
      qtd_kg REAL,
      operador_id INTEGER,
      operador_nome TEXT,
      tipo TEXT,
      data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(produto_id) REFERENCES produtos(id)
    );
    CREATE TABLE IF NOT EXISTS operadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      pin TEXT UNIQUE NOT NULL,
      perfil TEXT DEFAULT 'operador',
      is_adm INTEGER DEFAULT 0,
      permissoes TEXT DEFAULT '{}',
      ativo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inventarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'Aberto'
    );
  `);

  console.log('Limpando dados antigos...');
  await db.executeMultiple(`
    DELETE FROM movimentacoes_log;
    DELETE FROM estoque_posicao;
    DELETE FROM locais;
    DELETE FROM produtos;
    DELETE FROM operadores;
    DELETE FROM inventarios;
  `);

  await db.execute({
    sql: 'INSERT INTO operadores (nome, pin, perfil, is_adm, permissoes, ativo) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['Admin (Simulador)', '0106', 'gestor', 1, '{"dashboard_executivo":true}', 1]
  });

  console.log('Gerando dados fictícios... (isso pode levar uns segundos)');
  
  // 1. Produtos
  const produtos = [
    { cod: 'P01', desc: 'PESCOCO (T7)', valor: 25.50 },
    { cod: 'P02', desc: 'ALCATRA COMPLETA (T7)', valor: 45.90 },
    { cod: 'P03', desc: 'PICANHA (T7)', valor: 85.00 },
    { cod: 'P04', desc: 'CONTRA FILE (T7)', valor: 55.20 },
    { cod: 'P05', desc: 'COXAO MOLE (T7)', valor: 38.00 },
    { cod: 'P06', desc: 'COXAO DURO (T7)', valor: 35.00 },
    { cod: 'P07', desc: 'PATINHO (T7)', valor: 40.50 },
    { cod: 'P08', desc: 'MAMINHA (T7)', valor: 48.00 },
    { cod: 'P09', desc: 'FRALDINHA (T7)', valor: 39.90 },
    { cod: 'P10', desc: 'LAGARTO (T7)', valor: 36.50 },
    { cod: 'P11', desc: 'CUPIM (T7)', valor: 42.00 },
    { cod: 'P12', desc: 'COSTELA (T7)', valor: 22.90 },
    { cod: 'I01', desc: 'CAIXA DE PAPELAO 20KG', valor: 2.50, tipo: 'Insumos' },
    { cod: 'I02', desc: 'FILME PVC', valor: 85.00, tipo: 'Insumos' },
  ];

  for (const p of produtos) {
    await db.execute({
      sql: 'INSERT INTO produtos (codigo, descricao, valor_unitario, tipo_produto) VALUES (?, ?, ?, ?)',
      args: [p.cod, p.desc, p.valor, p.tipo || 'Acabado']
    });
  }

  const produtosDb = (await db.execute('SELECT id, codigo FROM produtos')).rows;

  // 2. Locais
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 6; c++) {
      for (let n = 1; n <= 3; n++) {
        await db.execute({
          sql: 'INSERT INTO locais (endereco, capacidade_max_caixas) VALUES (?, ?)',
          args: [`${r}R-0${c}-${n}`, 54]
        });
      }
    }
  }

  // 3. Histórico de 6 meses (aprox 180 dias)
  const lotesAtuais = {};
  for (let d = 180; d >= 0; d--) {
    const dataHora = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const dataIso = dataHora.toISOString().replace('T', ' ').substring(0, 19);
    
    // 2 a 5 recebimentos por dia
    const numRecebimentos = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numRecebimentos; i++) {
      const prod = produtosDb[Math.floor(Math.random() * produtosDb.length)];
      const lote = `L${dataHora.toISOString().slice(2,10).replace(/-/g,'')}${i}`;
      const caixas = Math.floor(Math.random() * 50) + 10;
      const pesoKg = caixas * (Math.random() * 15 + 15); // de 15 a 30kg por caixa
      
      await db.execute({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_nome, tipo, data_hora)
              VALUES (?, 'FORNECEDOR', 'DOCA-REC', ?, ?, ?, 'Simulador', 'RECEBIMENTO', ?)`,
        args: [prod.id, lote, caixas, pesoKg, dataIso]
      });

      if (!lotesAtuais[prod.id]) lotesAtuais[prod.id] = [];
      lotesAtuais[prod.id].push({ lote, caixas, pesoKg, dataCriacao: dataHora });
    }

    // 2 a 5 despachos por dia (apenas de produtos que tem em estoque falso)
    const numDespachos = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numDespachos; i++) {
      const prodId = Object.keys(lotesAtuais)[Math.floor(Math.random() * Object.keys(lotesAtuais).length)];
      if (!lotesAtuais[prodId] || lotesAtuais[prodId].length === 0) continue;
      
      const idxLote = Math.floor(Math.random() * lotesAtuais[prodId].length);
      const loteData = lotesAtuais[prodId][idxLote];
      
      const caixasSair = Math.floor(Math.random() * loteData.caixas) + 1;
      const pesoSair = (loteData.pesoKg / loteData.caixas) * caixasSair;
      
      await db.execute({
        sql: `INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_nome, tipo, data_hora)
              VALUES (?, 'EXPEDICAO', 'CLIENTE', ?, ?, ?, 'Simulador', 'DESPACHO', ?)`,
        args: [prodId, loteData.lote, caixasSair, pesoSair, dataIso]
      });

      loteData.caixas -= caixasSair;
      loteData.pesoKg -= pesoSair;
      if (loteData.caixas <= 0) {
        lotesAtuais[prodId].splice(idxLote, 1);
      }
    }
  }

  // 4. Saldo atual do Estoque
  let idxEndereco = 1;
  const dataHoje = new Date();
  
  for (const prodId of Object.keys(lotesAtuais)) {
    for (const loteData of lotesAtuais[prodId]) {
      const row = Math.ceil(idxEndereco / 18);
      const col = Math.ceil((idxEndereco % 18) / 3) || 6;
      const niv = (idxEndereco % 3) || 3;
      const ender = `${row}R-0${col}-${niv}`;
      
      // Validade: alguns vencidos, alguns ok
      const diasAdd = Math.floor(Math.random() * 60) - 10;
      const validade = new Date(dataHoje.getTime() + diasAdd * 24*60*60*1000).toISOString().slice(0,10);
      
      // updated_at: simular produtos estagnados
      const diasParado = Math.floor(Math.random() * 40);
      const updatedAt = new Date(dataHoje.getTime() - diasParado * 24*60*60*1000).toISOString().replace('T',' ').substring(0,19);

      await db.execute({
        sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [prodId, ender, loteData.lote, validade, loteData.caixas, loteData.pesoKg, updatedAt]
      });
      idxEndereco++;
      if (idxEndereco > 36) idxEndereco = 1;
    }
  }

  console.log('✅ Banco de simulação populado com sucesso!');
}

const server = http.createServer(async (req, res) => {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { sql, args } = JSON.parse(body);
        const result = await db.execute({ sql, args: args || [] });
        
        // Convert rows to plain objects to survive JSON.stringify
        const plainRows = result.rows.map(row => {
          const obj = {};
          result.columns.forEach((col, i) => {
            obj[col] = row[i];
          });
          return obj;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result, rows: plainRows }));
      } catch (err) {
        console.error('SQL Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

setupFakeData().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Servidor de simulação rodando em http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Erro no setup:', err);
});
