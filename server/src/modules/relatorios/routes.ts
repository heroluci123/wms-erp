import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { hojeIsoLocal, normalizarDataIso, toNum } from '../wms/helpers.js'
import { registerRelatoriosBiRoutes } from './biRoutes.js'

export function registerRelatoriosRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  app.get(
    '/api/relatorios/balanco',
    {
      preHandler: requirePermission(['relatorios_estoque', 'relatorios_producao', 'dashboard_executivo'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { dataInicio?: string; dataFim?: string }
      const dIni = normalizarDataIso(q.dataInicio) || hojeIsoLocal()
      const dFim = normalizarDataIso(q.dataFim) || dIni

      const res = await conn.db.execute(sql`
        SELECT p.id AS produto_id, p.id, p.codigo, p.descricao, p.unidade, p.classificacao, p.valor_unitario,
               COALESCE(SUM(CASE WHEN ml.tipo IN ('ENTRADA', 'RECEBIMENTO', 'PRODUCAO') THEN ml.qtd_kg ELSE 0 END), 0) AS total_entrada,
               COALESCE(SUM(CASE WHEN ml.tipo IN ('DESPACHO', 'EXPEDICAO', 'SAIDA', 'SAIDA_PRODUCAO', 'AJUSTE_SAIDA') THEN ml.qtd_kg ELSE 0 END), 0) AS total_saida,
               COALESCE(SUM(CASE WHEN ml.tipo = 'ENTRADA' THEN ml.qtd_kg ELSE 0 END), 0) AS total_entradas_kg,
               COALESCE(SUM(CASE WHEN ml.tipo = 'ENTRADA' THEN ml.qtd_caixas ELSE 0 END), 0) AS total_entradas_cx,
               COALESCE(SUM(CASE WHEN ml.tipo IN ('DESPACHO', 'SAIDA') THEN ml.qtd_kg ELSE 0 END), 0) AS total_saidas_kg,
               COALESCE(SUM(CASE WHEN ml.tipo IN ('DESPACHO', 'SAIDA') THEN ml.qtd_caixas ELSE 0 END), 0) AS total_saidas_cx,
               COALESCE(SUM(CASE WHEN ml.tipo = 'PRODUCAO' THEN ml.qtd_kg ELSE 0 END), 0) AS total_producao_kg
        FROM produtos p
        LEFT JOIN movimentacoes_log ml
          ON ml.produto_id = p.id
         AND ml.tenant_id = ${ctx.tenantId}
         AND ml.filial_id = ${ctx.filialId}
         AND DATE(ml.data_hora - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
        WHERE p.tenant_id = ${ctx.tenantId}
          AND p.codigo != 'VAZIO'
        GROUP BY p.id
        HAVING COALESCE(SUM(ml.qtd_kg), 0) > 0
        ORDER BY p.descricao ASC
      `)

      return {
        dataInicio: dIni,
        dataFim: dFim,
        data: (res.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          valor_unitario: toNum(r.valor_unitario, 0),
          total_entrada: toNum(r.total_entrada, 0),
          total_saida: toNum(r.total_saida, 0),
          total_entradas_kg: toNum(r.total_entradas_kg, 0),
          total_entradas_cx: toNum(r.total_entradas_cx, 0),
          total_saidas_kg: toNum(r.total_saidas_kg, 0),
          total_saidas_cx: toNum(r.total_saidas_cx, 0),
          total_producao_kg: toNum(r.total_producao_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/relatorios/arvore',
    {
      preHandler: requirePermission(['relatorios_producao', 'relatorios_estoque', 'dashboard_executivo'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!

      const [prodsRes, vinculos, opsHist] = await Promise.all([
        conn.db.execute(sql`
          SELECT id, codigo, descricao, classificacao, tipo_produto, grupo
          FROM produtos
          WHERE tenant_id = ${ctx.tenantId} AND ativo = 1 AND codigo != 'VAZIO'
          ORDER BY descricao ASC
        `),
        conn.db.execute(sql`
          SELECT pa.id, pa.pai_id, pa.filho_id,
                 pai.codigo AS pai_codigo, pai.descricao AS pai_descricao,
                 filho.codigo AS filho_codigo, filho.descricao AS filho_descricao,
                 pa.rendimento_esperado_pct, pa.rendimento_aprendido_pct,
                 pa.amostras_aprendizado, pa.origem_vinculo, pa.confirmado
          FROM produto_arvore pa
          JOIN produtos pai ON pai.id = pa.pai_id
          JOIN produtos filho ON filho.id = pa.filho_id
          WHERE pa.tenant_id = ${ctx.tenantId}
          ORDER BY pai.descricao ASC, filho.descricao ASC
        `),
        conn.db.execute(sql`
          SELECT p.id AS filho_id, p.codigo, p.descricao, p.grupo,
                 COUNT(DISTINCT op.id)::int AS ops_count,
                 COALESCE(SUM(oret.peso_kg), 0) AS total_produzido_kg
          FROM op_retornos oret
          JOIN ordens_producao op ON op.id = oret.op_id
          JOIN produtos p ON p.id = oret.produto_id
          WHERE op.tenant_id = ${ctx.tenantId}
            AND op.filial_id = ${ctx.filialId}
            AND op.status = 'FECHADA'
          GROUP BY p.id
          ORDER BY total_produzido_kg DESC
        `),
      ])

      const vinculosNorm = (vinculos.rows as Array<Record<string, unknown>>).map((v) => ({
        ...v,
        rendimento_esperado_pct:
          v.rendimento_esperado_pct != null ? toNum(v.rendimento_esperado_pct, 0) : null,
        rendimento_aprendido_pct:
          v.rendimento_aprendido_pct != null ? toNum(v.rendimento_aprendido_pct, 0) : null,
      }))

      return {
        produtos: prodsRes.rows,
        arvore: vinculosNorm,
        vinculos: vinculosNorm,
        producao_acumulada: (opsHist.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          total_produzido_kg: toNum(r.total_produzido_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/relatorios/ordens-producao',
    {
      preHandler: requirePermission(['relatorios_producao', 'relatorios_estoque', 'dashboard_executivo'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { dataInicio?: string; dataFim?: string }
      const dIni = normalizarDataIso(q.dataInicio) || hojeIsoLocal()
      const dFim = normalizarDataIso(q.dataFim) || dIni

      const res = await conn.db.execute(sql`
        SELECT
          op.id,
          op.codigo,
          COALESCE(op.nome, op.codigo) AS materia_prima,
          COALESCE(op.data_producao, DATE(op.created_at - INTERVAL '3 hours'))::text AS lote,
          CASE WHEN op.status = 'FECHADA' THEN 'CONCLUIDA' ELSE op.status END AS status,
          COALESCE((SELECT SUM(oi.peso_kg) FROM op_insumos oi WHERE oi.op_id = op.id), 0) AS peso_enviado,
          COALESCE((SELECT SUM(oret.peso_kg) FROM op_retornos oret WHERE oret.op_id = op.id), 0) AS peso_retornado,
          GREATEST(
            0,
            COALESCE((SELECT SUM(oi.peso_kg) FROM op_insumos oi WHERE oi.op_id = op.id), 0) -
            COALESCE((SELECT SUM(oret.peso_kg) FROM op_retornos oret WHERE oret.op_id = op.id), 0)
          ) AS perda,
          (SELECT COUNT(*)::int FROM op_retornos oret WHERE oret.op_id = op.id) AS qtd_caixas_geradas,
          COALESCE((SELECT SUM(oret.peso_kg) FROM op_retornos oret WHERE oret.op_id = op.id), 0) AS kg_gerados,
          op.created_at AS data_inicio,
          op.updated_at AS data_fim,
          op.operador_nome
        FROM ordens_producao op
        WHERE op.tenant_id = ${ctx.tenantId}
          AND op.filial_id = ${ctx.filialId}
          AND DATE(COALESCE(op.data_producao, op.created_at::date)) BETWEEN ${dIni} AND ${dFim}
        ORDER BY op.created_at DESC
      `)

      return {
        data: (res.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          peso_enviado: toNum(r.peso_enviado, 0),
          peso_retornado: toNum(r.peso_retornado, 0),
          perda: toNum(r.perda, 0),
          kg_gerados: toNum(r.kg_gerados, 0),
        })),
      }
    },
  )

  app.get(
    '/api/relatorios/op-subprodutos/:lote',
    {
      preHandler: requirePermission(['relatorios_producao', 'relatorios_estoque'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const lote = decodeURIComponent((req.params as { lote: string }).lote || '').trim()
      if (!lote) return { data: [] }

      const res = await conn.db.execute(sql`
        SELECT c.id, c.ean_caixa, c.peso_kg, c.endereco, c.lote, p.codigo, p.descricao, p.classificacao
        FROM estoque_caixas c
        JOIN produtos p ON p.id = c.produto_id
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.filial_id = ${ctx.filialId}
          AND c.lote = ${lote}
          AND c.status != 'CANCELADA'
        ORDER BY c.created_at DESC
      `)
      return {
        data: (res.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          peso_kg: toNum(r.peso_kg, 0),
        })),
      }
    },
  )

  app.get(
    '/api/relatorios/dashboard-executivo',
    {
      preHandler: requirePermission(['dashboard_executivo', 'relatorios_estoque', 'relatorios_producao'], {
        write: false,
        bloquearCliente: true,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { incluirInsumos?: string; data_inicio?: string; data_fim?: string }
      const incluirInsumos = q.incluirInsumos === 'true'
      const dIni =
        normalizarDataIso(q.data_inicio) ||
        new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
      const dFim = normalizarDataIso(q.data_fim) || hojeIsoLocal()
      const prodCond = incluirInsumos ? sql`p.tipo_produto = 'Insumos'` : sql`p.tipo_produto != 'Insumos'`

      const [fluxo, totaisRes, topEnt, topSai, estag, validades] = await Promise.all([
        conn.db.execute(sql`
          SELECT DATE(m.data_hora - INTERVAL '3 hours')::text AS data,
                 COALESCE(SUM(CASE WHEN m.tipo IN ('ENTRADA', 'RECEBIMENTO') THEN m.qtd_kg ELSE 0 END), 0) AS entradas_kg,
                 COALESCE(SUM(CASE WHEN m.tipo IN ('DESPACHO', 'SAIDA') THEN m.qtd_kg ELSE 0 END), 0) AS saidas_kg
          FROM movimentacoes_log m
          JOIN produtos p ON p.id = m.produto_id
          WHERE m.tenant_id = ${ctx.tenantId}
            AND m.filial_id = ${ctx.filialId}
            AND DATE(m.data_hora - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
            AND ${prodCond}
          GROUP BY DATE(m.data_hora - INTERVAL '3 hours')
          ORDER BY DATE(m.data_hora - INTERVAL '3 hours') ASC
        `),
        conn.db.execute(sql`
          SELECT
            COALESCE(SUM(CASE WHEN m.tipo IN ('ENTRADA', 'RECEBIMENTO') THEN m.qtd_kg ELSE 0 END), 0) AS total_entrada_kg,
            COALESCE(SUM(CASE WHEN m.tipo IN ('ENTRADA', 'RECEBIMENTO') THEN m.qtd_caixas ELSE 0 END), 0) AS total_entrada_cx,
            COALESCE(SUM(CASE WHEN m.tipo IN ('ENTRADA', 'RECEBIMENTO') THEN m.qtd_kg * COALESCE(p.valor_unitario, 0) ELSE 0 END), 0) AS total_entrada_valor,
            COALESCE(SUM(CASE WHEN m.tipo IN ('DESPACHO', 'SAIDA') THEN m.qtd_kg ELSE 0 END), 0) AS total_saida_kg,
            COALESCE(SUM(CASE WHEN m.tipo IN ('DESPACHO', 'SAIDA') THEN m.qtd_caixas ELSE 0 END), 0) AS total_saida_cx,
            COALESCE(SUM(CASE WHEN m.tipo IN ('DESPACHO', 'SAIDA') THEN m.qtd_kg * COALESCE(p.valor_unitario, 0) ELSE 0 END), 0) AS total_saida_valor
          FROM movimentacoes_log m
          JOIN produtos p ON p.id = m.produto_id
          WHERE m.tenant_id = ${ctx.tenantId}
            AND m.filial_id = ${ctx.filialId}
            AND DATE(m.data_hora - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
            AND ${prodCond}
        `),
        conn.db.execute(sql`
          SELECT p.codigo, p.descricao, COALESCE(SUM(m.qtd_kg), 0) AS total_kg
          FROM movimentacoes_log m
          JOIN produtos p ON p.id = m.produto_id
          WHERE m.tenant_id = ${ctx.tenantId}
            AND m.filial_id = ${ctx.filialId}
            AND m.tipo IN ('ENTRADA', 'RECEBIMENTO')
            AND DATE(m.data_hora - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
            AND ${prodCond}
          GROUP BY p.id
          ORDER BY total_kg DESC
          LIMIT 5
        `),
        conn.db.execute(sql`
          SELECT p.codigo, p.descricao, COALESCE(SUM(m.qtd_kg), 0) AS total_kg
          FROM movimentacoes_log m
          JOIN produtos p ON p.id = m.produto_id
          WHERE m.tenant_id = ${ctx.tenantId}
            AND m.filial_id = ${ctx.filialId}
            AND m.tipo IN ('DESPACHO', 'SAIDA')
            AND DATE(m.data_hora - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
            AND ${prodCond}
          GROUP BY p.id
          ORDER BY total_kg DESC
          LIMIT 5
        `),
        conn.db.execute(sql`
          SELECT p.codigo, p.descricao, ep.endereco, ep.lote, ep.qtd_kg,
                 EXTRACT(DAY FROM (NOW() - ep.updated_at))::int AS dias_parado
          FROM estoque_posicao ep
          JOIN produtos p ON p.id = ep.produto_id
          WHERE ep.tenant_id = ${ctx.tenantId}
            AND ep.filial_id = ${ctx.filialId}
            AND ep.qtd_caixas > 0
            AND ep.updated_at < NOW() - INTERVAL '30 days'
            AND ${prodCond}
          ORDER BY dias_parado DESC
        `),
        conn.db.execute(sql`
          SELECT p.codigo, p.descricao, ep.endereco, ep.validade, ep.qtd_caixas, ep.qtd_kg,
                 (ep.validade::date - CURRENT_DATE)::int AS dias_para_vencer
          FROM estoque_posicao ep
          JOIN produtos p ON p.id = ep.produto_id
          WHERE ep.tenant_id = ${ctx.tenantId}
            AND ep.filial_id = ${ctx.filialId}
            AND ep.qtd_caixas > 0
            AND ep.validade IS NOT NULL
            AND ep.validade::date <= CURRENT_DATE + INTERVAL '30 days'
            AND ${prodCond}
          ORDER BY ep.validade ASC
        `),
      ])

      const t = (totaisRes.rows[0] || {}) as Record<string, unknown>
      return {
        fluxoDiario: (fluxo.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          entradas_kg: toNum(r.entradas_kg, 0),
          saidas_kg: toNum(r.saidas_kg, 0),
        })),
        totais: {
          total_entrada_kg: toNum(t.total_entrada_kg, 0),
          total_entrada_cx: toNum(t.total_entrada_cx, 0),
          total_entrada_valor: toNum(t.total_entrada_valor, 0),
          total_saida_kg: toNum(t.total_saida_kg, 0),
          total_saida_cx: toNum(t.total_saida_cx, 0),
          total_saida_valor: toNum(t.total_saida_valor, 0),
        },
        topEntradas: (topEnt.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          total_kg: toNum(r.total_kg, 0),
        })),
        topSaidas: (topSai.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          total_kg: toNum(r.total_kg, 0),
        })),
        estagnados: (estag.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          qtd_kg: toNum(r.qtd_kg, 0),
        })),
        alertasValidade: (validades.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          qtd_caixas: toNum(r.qtd_caixas, 0),
          qtd_kg: toNum(r.qtd_kg, 0),
        })),
        dataInicio: dIni,
        dataFim: dFim,
      }
    },
  )

  app.get(
    '/api/relatorios/executivo',
    {
      preHandler: requirePermission(['relatorios_estoque', 'dashboard_executivo', 'relatorios_producao'], {
        write: false,
        bloquearCliente: false,
      }),
    },
    async (req) => {
      const ctx = req.authCtx!
      const modoCliente = ctx.operador.nivel === 'CLIENTE'
      const q = req.query as { dataInicio?: string; dataFim?: string }
      const dIni = normalizarDataIso(q.dataInicio) || hojeIsoLocal()
      const dFim = normalizarDataIso(q.dataFim) || dIni
      if (dFim < dIni) {
        throw new HttpError(400, 'Data final não pode ser menor que a inicial.')
      }

      const [estRes, romRes, saiRes, entRes] = await Promise.all([
        conn.db.execute(sql`
          SELECT c.id, c.ean_caixa, c.endereco, c.lote, c.data_producao, c.validade,
                 c.peso_bruto_kg, c.tara_kg, c.peso_kg, c.qtd_pecas, c.origem_tipo,
                 c.status AS status_caixa, c.palete_id, c.created_at, c.updated_at,
                 c.pedido_reservado_codigo, c.romaneio_reservado_codigo, c.cliente_reservado_nome,
                 p.id AS produto_id, p.codigo, p.descricao, p.tipo_produto, p.grupo, p.valor_unitario
          FROM estoque_caixas c
          JOIN produtos p ON p.id = c.produto_id
          WHERE c.tenant_id = ${ctx.tenantId}
            AND c.filial_id = ${ctx.filialId}
            AND c.status IN ('DISPONIVEL', 'RESERVADA')
            AND COALESCE(c.endereco, '') NOT IN ('EXPEDICAO', 'SAIDA', 'PERDIDO')
          ORDER BY p.descricao ASC, c.endereco ASC, c.validade ASC
          LIMIT 10000
        `),
        conn.db.execute(sql`
          SELECT r.*,
                 ped.codigo AS pedido_codigo,
                 ped.numero_nf AS numero_nf,
                 (SELECT COUNT(*)::int FROM romaneios_itens ri WHERE ri.romaneio_id = r.id) AS qtd_caixas,
                 COALESCE((SELECT SUM(ri.peso_kg) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id), 0) AS peso_total,
                 COALESCE((SELECT SUM(ri.peso_kg * COALESCE(p.valor_unitario, 0)) FROM romaneios_itens ri JOIN produtos p ON p.id = ri.produto_id WHERE ri.romaneio_id = r.id), 0) AS valor_total
          FROM romaneios r
          LEFT JOIN pedidos ped ON ped.id = r.pedido_id
          WHERE r.tenant_id = ${ctx.tenantId}
            AND r.filial_id = ${ctx.filialId}
            AND DATE(COALESCE(r.expedido_at, r.created_at) - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
          ORDER BY COALESCE(r.expedido_at, r.created_at) DESC
        `),
        conn.db.execute(sql`
          SELECT r.id AS romaneio_id, r.codigo AS romaneio_codigo, r.cliente AS romaneio_cliente,
                 r.status AS romaneio_status, r.previsao_entrega,
                 r.created_at AS romaneio_criado_em, r.expedido_at AS romaneio_expedido_em,
                 r.operador_nome AS operador_montagem, r.operador_expedicao_nome AS operador_expedicao,
                 ped.codigo AS pedido_codigo, ped.numero_nf AS numero_nf,
                 ri.id AS item_id, ri.caixa_id, ri.produto_id, ri.peso_kg,
                 c.ean_caixa, c.lote, c.data_producao, c.validade, c.peso_bruto_kg, c.tara_kg, c.qtd_pecas,
                 c.endereco AS endereco_atual_ou_origem, c.status AS caixa_status_atual,
                 p.codigo AS produto_codigo, p.descricao AS produto_descricao,
                 p.grupo, p.tipo_produto, p.valor_unitario
          FROM romaneios_itens ri
          JOIN romaneios r ON r.id = ri.romaneio_id
          LEFT JOIN pedidos ped ON ped.id = r.pedido_id
          JOIN estoque_caixas c ON c.id = ri.caixa_id
          JOIN produtos p ON p.id = ri.produto_id
          WHERE r.tenant_id = ${ctx.tenantId}
            AND r.filial_id = ${ctx.filialId}
            AND DATE(COALESCE(r.expedido_at, r.created_at) - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
          ORDER BY COALESCE(r.expedido_at, r.created_at) DESC, p.descricao ASC
        `),
        conn.db.execute(sql`
          SELECT c.id, c.ean_caixa, c.endereco, c.lote, c.data_producao, c.validade,
                 c.peso_bruto_kg, c.tara_kg, c.peso_kg, c.qtd_pecas, c.origem_tipo,
                 c.status AS status_caixa, c.created_at,
                 rec.codigo AS recebimento_codigo, rec.numero_nf AS recebimento_nf,
                 op.codigo AS op_codigo,
                 p.id AS produto_id, p.codigo AS produto_codigo, p.descricao AS produto_descricao,
                 p.grupo, p.tipo_produto, p.valor_unitario,
                 (SELECT ch.operacao FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.data_hora ASC LIMIT 1) AS origem_operacao,
                 (SELECT ch.operador_nome FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.data_hora ASC LIMIT 1) AS operador_entrada
          FROM estoque_caixas c
          JOIN produtos p ON p.id = c.produto_id
          LEFT JOIN recebimentos rec ON rec.id = c.recebimento_id
          LEFT JOIN ordens_producao op ON op.id = c.op_id
          WHERE c.tenant_id = ${ctx.tenantId}
            AND c.filial_id = ${ctx.filialId}
            AND c.ean_caixa != ''
            AND DATE(c.created_at - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
          ORDER BY c.created_at DESC
          LIMIT 10000
        `),
      ])

      const stripOperador = (item: Record<string, unknown>): Record<string, unknown> =>
        modoCliente
          ? {
              ...item,
              operador_montagem: null,
              operador_expedicao: null,
              operador_nome: null,
              operador_expedicao_nome: null,
              operador_entrada: null,
            }
          : item

      const romRows = (romRes.rows as Array<Record<string, unknown>>).filter(
        (r) => !modoCliente || String(r.status || '').toUpperCase() === 'EXPEDIDO',
      )
      const allowedIds = new Set(romRows.map((r) => String(r.id)))

      const saidasItens = (saiRes.rows as Array<Record<string, unknown>>)
        .filter((it) => !modoCliente || allowedIds.has(String(it.romaneio_id)))
        .map((it): Record<string, unknown> => ({
          ...stripOperador(it),
          peso_kg: toNum(it.peso_kg, 0),
          peso_bruto_kg: toNum(it.peso_bruto_kg, 0),
          tara_kg: toNum(it.tara_kg, 0),
          valor_unitario: toNum(it.valor_unitario, 0),
        }))

      const entradasCaixas = (entRes.rows as Array<Record<string, unknown>>).map((it) => ({
        ...stripOperador(it),
        peso_kg: toNum(it.peso_kg, 0),
        peso_bruto_kg: toNum(it.peso_bruto_kg, 0),
        tara_kg: toNum(it.tara_kg, 0),
        valor_unitario: toNum(it.valor_unitario, 0),
      }))

      const romaneiosFinal = romRows.map((rom) => {
        const itens = saidasItens.filter((it) => String(it.romaneio_id) === String(rom.id))
        const prodMap = new Map<
          string,
          { codigo: unknown; descricao: unknown; grupo: unknown; qtd_caixas: number; peso_kg: number }
        >()
        for (const it of itens) {
          const k = `${it.produto_codigo}__${it.produto_descricao}`
          const p = prodMap.get(k) || {
            codigo: it.produto_codigo,
            descricao: it.produto_descricao,
            grupo: it.grupo,
            qtd_caixas: 0,
            peso_kg: 0,
          }
          p.qtd_caixas += 1
          p.peso_kg += toNum(it.peso_kg, 0)
          prodMap.set(k, p)
        }
        return {
          ...stripOperador(rom),
          qtd_caixas: itens.length,
          peso_total: Number(itens.reduce((s, it) => s + toNum(it.peso_kg, 0), 0).toFixed(2)),
          valor_total: toNum(rom.valor_total, 0),
          itens,
          resumo_produtos: Array.from(prodMap.values()).sort((a, b) => b.peso_kg - a.peso_kg),
        }
      })

      return {
        dataInicio: dIni,
        dataFim: dFim,
        estoqueAtual: (estRes.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          peso_kg: toNum(r.peso_kg, 0),
          peso_bruto_kg: r.peso_bruto_kg != null ? toNum(r.peso_bruto_kg, 0) : null,
          tara_kg: toNum(r.tara_kg, 0),
          valor_unitario: toNum(r.valor_unitario, 0),
        })),
        romaneios: romaneiosFinal,
        saidasItens,
        entradasCaixas,
      }
    },
  )

  registerRelatoriosBiRoutes(app, conn)
}
