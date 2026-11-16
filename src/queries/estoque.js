import { db } from '../lib/db.js';
import { apiRequest, buildQueryString, isApiEnabled } from '../lib/apiClient.js';
import { ensureRastreabilidadeSchema } from './taras.js';
import { gerarLotePorData } from '../utils/rastreabilidade.js';
import { assertPermissao } from '../lib/authGuard.js';

const PERM_EST_OP = ['consulta_estoque', 'estoque_enderecos', 'movimentacao', 'recebimento', 'inventario_coletor', 'inventario_gestao', 'saida', 'expedicao', 'pedidos', 'retorno_producao', 'desmembramento', 'rastreabilidade', 'reimpressao'];

/** Queries de Estoque e Posições */

// Listagem geral com JOIN em produtos, excluindo registros zerados
export async function listarGeral() {
  if (isApiEnabled()) {
    return (await apiRequest('/api/estoque/posicoes?incluirInsumos=all')).data;
  }
  await assertPermissao(['consulta_estoque', 'estoque_enderecos', 'relatorios_estoque', 'dashboard_executivo', 'movimentacao', 'pedidos', 'saida'], { write: false, bloquearCliente: false });
  const res = await db.execute(`
    SELECT
      ep.id, ep.endereco, ep.lote, ep.validade,
      ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
      p.status_curva, p.valor_unitario, p.unidade, p.grupo,
      l.tipo_armazenamento as tipo_armazenamento,
      (
        SELECT GROUP_CONCAT(DISTINCT pl.codigo)
        FROM estoque_caixas ec
        JOIN paletes pl ON pl.id = ec.palete_id
        WHERE ec.produto_id = ep.produto_id
          AND ec.endereco = ep.endereco
          AND ec.status = 'DISPONIVEL'
      ) as palete_codigos,
      (
        SELECT CASE
          WHEN COUNT(*) = 1 THEN MIN(ec2.ean_caixa)
          ELSE COUNT(*) || ' caixas'
        END
        FROM estoque_caixas ec2
        WHERE ec2.produto_id = ep.produto_id
          AND ec2.endereco = ep.endereco
          AND ec2.status = 'DISPONIVEL'
      ) as ean_caixas
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    LEFT JOIN locais l ON l.endereco = ep.endereco
    WHERE ep.qtd_caixas > 0 OR ep.qtd_kg > 0
    ORDER BY ep.endereco, p.descricao, ep.validade
  `)
  return res.rows
}

// Listagem caixa a caixa (serializada) com EAN individual — usa estoque_caixas direto
// Inclui TODAS as caixas que ainda estão fisicamente no armazém:
// DISPONIVEL (livre), RESERVADA (em romaneio/OP), BLOQUEADO
// Exclui apenas EXPEDIDA (saiu do galpão) e CONSUMIDA (desmembrada/produção)
export async function listarGeralCaixas() {
  if (isApiEnabled()) {
    return (await apiRequest('/api/estoque/caixas?status=DISPONIVEL,RESERVADA,BLOQUEADO&limit=2000')).data;
  }
  await assertPermissao(PERM_EST_OP, { write: false, bloquearCliente: true });
  await ensureRastreabilidadeSchema();
  const res = await db.execute({
    sql: `
      SELECT
        c.id, c.ean_caixa, c.endereco, c.validade, c.lote, c.data_producao,
        c.peso_bruto_kg, c.tara_kg, c.peso_kg, c.qtd_pecas,
        c.status, c.palete_id, c.updated_at,
        c.pedido_reservado_id, c.pedido_reservado_codigo,
        c.romaneio_reservado_id, c.romaneio_reservado_codigo,
        c.cliente_reservado_nome, c.reservado_em,
        p.id as produto_id, p.codigo, p.descricao, p.tipo_produto,
        p.status_curva, p.valor_unitario, p.unidade, p.grupo,
        pl.codigo as palete_codigo,
        COALESCE(l.tipo_armazenamento, 'SECO') as tipo_armazenamento
      FROM estoque_caixas c
      JOIN produtos p ON p.id = c.produto_id
      LEFT JOIN paletes pl ON pl.id = c.palete_id
      LEFT JOIN locais l ON l.endereco = c.endereco
      WHERE c.status IN ('DISPONIVEL', 'RESERVADA', 'BLOQUEADO')
        AND c.ean_caixa IS NOT NULL
        AND c.ean_caixa != ''
        AND (c.endereco IS NOT NULL OR c.palete_id IS NOT NULL)
      ORDER BY c.endereco, p.descricao, c.validade
    `,
    args: []
  })
  return res.rows
}

// Verifica se uma caixa já existe no estoque pelo EAN
export async function buscarCaixaPorEan(ean_caixa) {
  if (isApiEnabled()) {
    try {
      return (await apiRequest(`/api/estoque/caixa/${encodeURIComponent(String(ean_caixa || '').trim())}`)).data;
    } catch {
      return null;
    }
  }
  await assertPermissao(PERM_EST_OP, { write: false, bloquearCliente: true });
  const res = await db.execute({
    sql: `SELECT id, ean_caixa, status, endereco, palete_id FROM estoque_caixas WHERE ean_caixa = ?`,
    args: [ean_caixa]
  })
  return res.rows.length > 0 ? res.rows[0] : null
}

// Busca saldo de um produto em um endereço específico (apenas lotes com saldo > 0)
export async function buscarPorEnderecoProduto(endereco, produto_id) {
  if (isApiEnabled()) {
    return (await apiRequest(`/api/estoque/posicoes${buildQueryString({ endereco, produto_id, incluirInsumos: 'all' })}`)).data;
  }
  await assertPermissao(PERM_EST_OP, { write: false, bloquearCliente: true });
  const res = await db.execute({
    sql: `
      SELECT
        ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg,
        p.descricao, p.codigo, p.status_curva, p.grupo
      FROM estoque_posicao ep
      JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.endereco = ? AND ep.produto_id = ?
        AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
      ORDER BY ep.validade ASC
    `,
    args: [endereco, produto_id]
  })
  return res.rows
}

// Remove uma caixa do estoque
export async function removerCaixa(id) {
  if (isApiEnabled()) {
    await apiRequest(`/api/recebimento/caixa/${id}`, { method: 'DELETE' });
    return;
  }
  await assertPermissao(['deletar_historico', 'inventario_gestao', 'movimentacao']);
  await db.execute({
    sql: `DELETE FROM estoque_caixas WHERE id = ?`,
    args: [id]
  })
  return { success: true }
}

// Cria ou atualiza caixas no estoque_caixas durante o Inventário / Carga Inicial
export async function inserirCaixasCargaInicial(caixas) {
  if (isApiEnabled()) {
    if (!caixas || caixas.length === 0) return { success: true };
    try {
      return await apiRequest('/api/estoque/carga-inicial', {
        method: 'POST',
        body: { caixas },
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  await assertPermissao(['inventario_carga_inicial', 'inventario_coletor', 'inventario_gestao']);
  if (!caixas || caixas.length === 0) return { success: true };
  await ensureRastreabilidadeSchema();
  const tx = await db.transaction('write');
  try {
    for (const c of caixas) {
      const loteFinal = String(c.lote || (c.data_producao ? gerarLotePorData(c.data_producao) : '') || '').trim();
      const taraVal = Number(c.tara_kg || 0);
      const liqVal = Number(Number(c.peso_kg || 0).toFixed(3));
      const brutoVal = c.peso_bruto_kg !== undefined && c.peso_bruto_kg !== null
        ? Number(Number(c.peso_bruto_kg).toFixed(3))
        : Number((liqVal + taraVal).toFixed(3));
      const pecasVal = c.qtd_pecas !== undefined && c.qtd_pecas !== null && Number(c.qtd_pecas) > 0
        ? Math.trunc(Number(c.qtd_pecas))
        : null;

      const { rows } = await tx.execute({
        sql: `SELECT id FROM estoque_caixas WHERE LTRIM(ean_caixa, '0') = LTRIM(?, '0')`,
        args: [c.ean_caixa]
      });
      if (rows.length === 0) {
        const insRes = await tx.execute({
          sql: `INSERT INTO estoque_caixas (
                  ean_caixa, produto_id, endereco, lote, data_producao, validade,
                  peso_kg, peso_bruto_kg, tara_id, tara_kg, qtd_pecas, origem_tipo, operador_cadastro_nome, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISPONIVEL')`,
          args: [
            c.ean_caixa, c.produto_id, c.endereco,
            loteFinal, c.data_producao || null, c.validade || null,
            liqVal, brutoVal, c.tara_id || null, taraVal,
            pecasVal, c.origem_tipo || 'INVENTARIO', c.operador_cadastro_nome || 'Inventário'
          ]
        });
        await tx.execute({
          sql: `INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome)
                VALUES (?, ?, 'RECEBIMENTO_INVENTARIO', ?, ?)`,
          args: [
            Number(insRes.lastInsertRowid),
            c.ean_caixa,
            `Inventário em ${c.endereco} • Lote ${loteFinal || '-'} • ${pecasVal ? `${pecasVal} pç • ` : ''}Bruto ${brutoVal.toFixed(2)}kg | Tara ${taraVal.toFixed(3)}kg | Líq ${liqVal.toFixed(2)}kg`,
            c.operador_cadastro_nome || 'Inventário'
          ]
        });
      } else {
        await tx.execute({
          sql: `UPDATE estoque_caixas
                SET endereco = ?,
                    lote = COALESCE(NULLIF(?, ''), lote),
                    data_producao = COALESCE(?, data_producao),
                    validade = COALESCE(?, validade),
                    peso_kg = ?,
                    peso_bruto_kg = COALESCE(?, peso_bruto_kg),
                    tara_id = COALESCE(?, tara_id),
                    tara_kg = CASE WHEN ? IS NOT NULL THEN ? ELSE tara_kg END,
                    qtd_pecas = COALESCE(?, qtd_pecas),
                    status = 'DISPONIVEL',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
          args: [
            c.endereco,
            loteFinal,
            c.data_producao || null,
            c.validade || null,
            liqVal,
            c.peso_bruto_kg ?? null,
            c.tara_id ?? null,
            c.tara_kg ?? null,
            taraVal,
            pecasVal,
            rows[0].id
          ]
        });
      }
    }
    await tx.commit();
    return { success: true };
  } catch (err) {
    await tx.rollback();
    return { success: false, error: err.message };
  }
}

// Tudo em um endereço
export async function buscarPorEndereco(endereco) {
  if (isApiEnabled()) {
    return (await apiRequest(`/api/estoque/endereco/${encodeURIComponent(String(endereco || '').trim().toUpperCase())}`)).data;
  }
  await assertPermissao(PERM_EST_OP, { write: false, bloquearCliente: true });
  const res = await db.execute({
    sql: `
      SELECT
        ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg,
        p.id as produto_id, p.descricao, p.codigo, p.status_curva, p.grupo
      FROM estoque_posicao ep
      JOIN produtos p ON p.id = ep.produto_id
      WHERE ep.endereco = ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
      ORDER BY ep.validade ASC
    `,
    args: [endereco]
  })
  return res.rows
}

// Sugestão de Putaway: endereços onde o produto já tem saldo (excluindo REC e EXPEDICAO)
export async function sugestaoPutaway(produto_id, lote) {
  if (isApiEnabled()) {
    return (await apiRequest(`/api/estoque/putaway/${produto_id}${buildQueryString({ lote })}`)).data;
  }
  await assertPermissao(PERM_EST_OP, { write: false, bloquearCliente: true });
  const res = await db.execute({
    sql: `
      SELECT endereco, lote, qtd_caixas, qtd_kg, validade
      FROM estoque_posicao
      WHERE produto_id = ?
        AND endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
        AND (qtd_caixas > 0 OR qtd_kg > 0)
      ORDER BY
        CASE WHEN lote = ? THEN 0 ELSE 1 END,
        qtd_caixas DESC
    `,
    args: [produto_id, lote || '']
  })
  return res.rows
}

// Verificação FEFO: existem lotes mais antigos do mesmo produto?
// Retorna lotes com validade MENOR que a bipada (mais antigos que deveriam sair primeiro)
export async function verificarFEFO(produto_id, validade_bipada) {
  if (isApiEnabled()) {
    return (await apiRequest(`/api/estoque/fefo${buildQueryString({ produto_id, validade: validade_bipada })}`)).data;
  }
  await assertPermissao(PERM_EST_OP, { write: false, bloquearCliente: true });
  const res = await db.execute({
    sql: `
      SELECT ep.endereco, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg
      FROM estoque_posicao ep
      WHERE ep.produto_id = ?
        AND ep.validade IS NOT NULL
        AND ep.validade < ?
        AND ep.endereco NOT IN ('REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO')
        AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
      ORDER BY ep.validade ASC
    `,
    args: [produto_id, validade_bipada]
  })
  return res.rows
}

// Listar área de expedição
export async function listarExpedicao() {
  if (isApiEnabled()) {
    return (await apiRequest('/api/estoque/expedicao')).data;
  }
  await assertPermissao(['saida', 'expedicao', 'pedidos_consultar', 'consulta_estoque', 'estoque_enderecos'], { write: false, bloquearCliente: true });
  const res = await db.execute(`
    SELECT
      ep.id, ep.lote, ep.validade, ep.qtd_caixas, ep.qtd_kg, ep.updated_at,
      p.id as produto_id, p.codigo, p.descricao, p.status_curva, p.grupo
    FROM estoque_posicao ep
    JOIN produtos p ON p.id = ep.produto_id
    WHERE ep.endereco = 'EXPEDICAO'
      AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0)
    ORDER BY ep.updated_at DESC
  `)
  return res.rows
}

// KPIs para o Dashboard
export async function calcularKPIs(filtros = {}) {
  if (isApiEnabled()) {
    return apiRequest(`/api/estoque/kpis${buildQueryString({ incluirInsumos: filtros.incluirInsumos === true ? 'true' : 'false' })}`);
  }
  await assertPermissao(['dashboard_executivo', 'consulta_estoque', 'relatorios_estoque', 'estoque_enderecos'], { write: false, bloquearCliente: true });
  const filterSQL = (filtros.incluirInsumos === true) ? " AND p.tipo_produto = 'Insumos'" : " AND p.tipo_produto != 'Insumos'";

  const hoje = new Date()
  const em30dias = new Date(hoje)
  em30dias.setDate(hoje.getDate() + 30)
  const dataLimite = em30dias.toISOString().split('T')[0]
  const dataHoje = hoje.toISOString().split('T')[0]

  const batchQueries = [
    `SELECT COUNT(DISTINCT ep.produto_id) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`,
    `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'REC' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`,
    `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.endereco = 'EXPEDICAO' AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`,
    `SELECT COUNT(*) as v FROM inventarios WHERE status NOT IN ('Finalizado OK', 'Cancelado')`,
    { sql: `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.validade IS NOT NULL AND ep.validade >= ? AND ep.validade <= ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`, args: [dataHoje, dataLimite] },
    { sql: `SELECT COUNT(*) as v FROM estoque_posicao ep JOIN produtos p ON p.id = ep.produto_id WHERE ep.validade IS NOT NULL AND ep.validade < ? AND (ep.qtd_caixas > 0 OR ep.qtd_kg > 0) ${filterSQL}`, args: [dataHoje] }
  ]

  const res = await db.batch(batchQueries, 'read')

  return {
    totalSKUs: Number(res[0].rows[0].v),
    itensREC: Number(res[1].rows[0].v),
    itensExpedicao: Number(res[2].rows[0].v),
    inventariosAbertos: Number(res[3].rows[0].v),
    vencendoBreve: Number(res[4].rows[0].v),
    vencidos: Number(res[5].rows[0].v),
  }
}
