import { db } from '../lib/db.js';
import { listarDossiesProducao } from './producao.js';

export async function getBalanco(dataInicio, dataFim) {
  const res = await db.execute({
    sql: `
      SELECT p.id as produto_id, p.descricao, p.classificacao, p.produto_pai_id,
        SUM(CASE WHEN ch.operacao IN ('RECEBIMENTO', 'RETORNO_PRODUCAO', 'RECEBIMENTO_DESMEMBRAMENTO') THEN c.peso_kg ELSE 0 END) as total_entrada,
        SUM(CASE WHEN ch.operacao IN ('EXPEDICAO', 'INVENTARIO_PERDA', 'ALOCADA_PRODUCAO', 'DESMEMBRADA') THEN c.peso_kg ELSE 0 END) as total_saida
      FROM caixas_historico ch
      JOIN estoque_caixas c ON c.id = ch.caixa_id
      JOIN produtos p ON p.id = c.produto_id
      WHERE date(ch.data_hora) BETWEEN ? AND ?
      GROUP BY p.id, p.descricao, p.classificacao
      ORDER BY p.descricao ASC
    `,
    args: [dataInicio, dataFim]
  })
  return res.rows
}

export async function getArvoreProducao() {
  const produtosRes = await db.execute(`
    SELECT id, descricao, classificacao
    FROM produtos 
    ORDER BY descricao ASC
  `)
  const arvoreRes = await db.execute(`SELECT pai_id, filho_id FROM produto_arvore`)
  
  return {
    produtos: produtosRes.rows,
    arvore: arvoreRes.rows
  }
}

export async function getOrdensProducao(dataInicio, dataFim) {
  return listarDossiesProducao({ dataInicio, dataFim });
}

export async function getOPSubprodutos(lote) {
  const res = await db.execute({
    sql: `
      SELECT 
        ec.ean_caixa,
        ec.lote,
        ec.validade,
        ec.peso_kg,
        ec.status,
        ec.endereco,
        p.descricao,
        p.codigo
      FROM estoque_caixas ec
      JOIN produtos p ON p.id = ec.produto_id
      WHERE ec.lote = ?
      ORDER BY p.descricao, ec.validade
    `,
    args: [lote]
  })
  return res.rows
}

/**
 * Busca todos os dados consolidados e detalhados para o Relatório Executivo WMS
 * (Saídas por Romaneio, Entradas do Período, Estoque Consolidado por Produto e Estoque por Caixa)
 */
export async function getDadosRelatorioExecutivo(dataInicio, dataFim) {
  const [estRes, romRes, saiRes, entRes] = await Promise.all([
    // 1. Estoque Atual (Caixa a Caixa)
    db.execute({
      sql: `
        SELECT
          c.id, c.ean_caixa, c.endereco, c.lote, c.validade, c.peso_kg,
          c.status as status_caixa, c.palete_id, c.created_at, c.updated_at,
          p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
          p.status_curva, p.valor_unitario, p.unidade, p.grupo,
          COALESCE(pl.codigo, '') as palete_codigo,
          COALESCE(l.tipo_armazenamento, 'FRIO') as tipo_armazenamento
        FROM estoque_caixas c
        JOIN produtos p ON p.id = c.produto_id
        LEFT JOIN paletes pl ON pl.id = c.palete_id
        LEFT JOIN locais l ON l.endereco = c.endereco
        WHERE c.status IN ('DISPONIVEL', 'RESERVADA', 'BLOQUEADO')
          AND c.ean_caixa IS NOT NULL AND c.ean_caixa != ''
          AND (c.endereco IS NOT NULL OR c.palete_id IS NOT NULL)
        ORDER BY c.endereco ASC, p.descricao ASC, c.validade ASC
      `,
      args: []
    }),

    // 2. Romaneios do Período
    db.execute({
      sql: `
        SELECT
          r.*,
          (SELECT count(*) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id) as qtd_caixas,
          (SELECT sum(peso_kg) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id) as peso_total,
          (SELECT sum(ri.peso_kg * COALESCE(p.valor_unitario, 0)) FROM romaneios_itens ri JOIN produtos p ON p.id = ri.produto_id WHERE ri.romaneio_id = r.id) as valor_total
        FROM romaneios r
        WHERE date(COALESCE(r.expedido_at, r.created_at), '-3 hours') BETWEEN ? AND ?
        ORDER BY COALESCE(r.expedido_at, r.created_at) DESC
      `,
      args: [dataInicio, dataFim]
    }),

    // 3. Itens vinculados aos Romaneios do Período
    db.execute({
      sql: `
        SELECT
          r.id as romaneio_id, r.codigo as romaneio_codigo, r.cliente as romaneio_cliente,
          r.status as romaneio_status, r.previsao_entrega,
          r.created_at as romaneio_criado_em, r.expedido_at as romaneio_expedido_em,
          r.operador_nome as operador_montagem, r.operador_expedicao_nome as operador_expedicao,
          ri.id as item_id, ri.caixa_id, ri.produto_id, ri.peso_kg,
          c.ean_caixa, c.lote, c.validade, c.endereco as endereco_atual_ou_origem,
          c.status as caixa_status_atual,
          p.codigo as produto_codigo, p.descricao as produto_descricao,
          p.grupo, p.tipo_produto, p.valor_unitario
        FROM romaneios_itens ri
        JOIN romaneios r ON r.id = ri.romaneio_id
        JOIN estoque_caixas c ON c.id = ri.caixa_id
        JOIN produtos p ON p.id = ri.produto_id
        WHERE date(COALESCE(r.expedido_at, r.created_at), '-3 hours') BETWEEN ? AND ?
        ORDER BY COALESCE(r.expedido_at, r.created_at) DESC, p.descricao ASC, c.ean_caixa ASC
      `,
      args: [dataInicio, dataFim]
    }),

    // 4. Entradas registradas no período
    db.execute({
      sql: `
        SELECT
          c.id, c.ean_caixa, c.endereco, c.lote, c.validade, c.peso_kg,
          c.status as status_caixa, c.created_at, c.updated_at,
          p.id as produto_id, p.codigo as produto_codigo, p.descricao as produto_descricao,
          p.grupo, p.tipo_produto, p.valor_unitario,
          (SELECT ch.operacao FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.id ASC LIMIT 1) as origem_operacao,
          (SELECT ch.detalhes FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.id ASC LIMIT 1) as origem_detalhe,
          (SELECT ch.operador_nome FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.id ASC LIMIT 1) as operador_entrada
        FROM estoque_caixas c
        JOIN produtos p ON p.id = c.produto_id
        WHERE c.ean_caixa IS NOT NULL AND c.ean_caixa != ''
          AND (
            date(c.created_at, '-3 hours') BETWEEN ? AND ?
            OR EXISTS (
              SELECT 1 FROM caixas_historico ch
              WHERE ch.caixa_id = c.id
                AND date(ch.data_hora, '-3 hours') BETWEEN ? AND ?
            )
          )
        ORDER BY c.created_at DESC, p.descricao ASC
      `,
      args: [dataInicio, dataFim, dataInicio, dataFim]
    })
  ]);

  const estoqueAtual = estRes.rows || [];
  const saidasItens = saiRes.rows || [];
  const entradasCaixas = entRes.rows || [];

  // Enriquecer cada Romaneio com seus próprios itens, resumo por produto e totais individuais
  const romaneios = (romRes.rows || []).map(rom => {
    const itens = saidasItens.filter(it => Number(it.romaneio_id) === Number(rom.id));
    const pesoTotal = itens.reduce((acc, it) => acc + Number(it.peso_kg || 0), 0);
    const prodMap = new Map();
    itens.forEach(it => {
      const k = `${it.produto_codigo}__${it.produto_descricao}`;
      if (!prodMap.has(k)) {
        prodMap.set(k, {
          codigo: it.produto_codigo,
          descricao: it.produto_descricao,
          grupo: it.grupo,
          qtd_caixas: 0,
          peso_kg: 0
        });
      }
      const p = prodMap.get(k);
      p.qtd_caixas += 1;
      p.peso_kg += Number(it.peso_kg || 0);
    });
    return {
      ...rom,
      qtd_caixas: itens.length,
      peso_total: Number(pesoTotal.toFixed(2)),
      itens,
      resumo_produtos: Array.from(prodMap.values()).sort((a, b) => b.peso_kg - a.peso_kg)
    };
  });

  return {
    estoqueAtual,
    romaneios,
    saidasItens,
    entradasCaixas
  };
}
