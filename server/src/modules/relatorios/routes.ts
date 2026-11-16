import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { hojeIsoLocal, normalizarDataIso, toNum } from '../wms/helpers.js'

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
        SELECT p.id, p.codigo, p.descricao, p.unidade, p.valor_unitario,
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

      const [vinculos, opsHist] = await Promise.all([
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

      return {
        vinculos: (vinculos.rows as Array<Record<string, unknown>>).map((v) => ({
          ...v,
          rendimento_esperado_pct:
            v.rendimento_esperado_pct != null ? toNum(v.rendimento_esperado_pct, 0) : null,
          rendimento_aprendido_pct:
            v.rendimento_aprendido_pct != null ? toNum(v.rendimento_aprendido_pct, 0) : null,
        })),
        producao_acumulada: (opsHist.rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          total_produzido_kg: toNum(r.total_produzido_kg, 0),
        })),
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
          SELECT p.id AS produto_id, p.codigo, p.descricao, p.grupo, p.tipo_produto, p.valor_unitario,
                 COUNT(c.id)::int AS qtd_caixas,
                 COALESCE(SUM(c.peso_kg), 0) AS saldo_kg,
                 COUNT(DISTINCT c.endereco)::int AS enderecos_ativos
          FROM estoque_caixas c
          JOIN produtos p ON p.id = c.produto_id
          WHERE c.tenant_id = ${ctx.tenantId}
            AND c.filial_id = ${ctx.filialId}
            AND c.status = 'DISPONIVEL'
            AND p.tipo_produto != 'Insumos'
          GROUP BY p.id
          HAVING COALESCE(SUM(c.peso_kg), 0) > 0
          ORDER BY p.grupo ASC, p.descricao ASC
        `),
        conn.db.execute(sql`
          SELECT r.*,
                 (SELECT COUNT(*)::int FROM romaneios_itens ri WHERE ri.romaneio_id = r.id) AS qtd_caixas,
                 COALESCE((SELECT SUM(ri.peso_kg) FROM romaneios_itens ri WHERE ri.romaneio_id = r.id), 0) AS peso_total,
                 COALESCE((SELECT SUM(ri.peso_kg * COALESCE(p.valor_unitario, 0)) FROM romaneios_itens ri JOIN produtos p ON p.id = ri.produto_id WHERE ri.romaneio_id = r.id), 0) AS valor_total
          FROM romaneios r
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
                 ri.id AS item_id, ri.caixa_id, ri.produto_id, ri.peso_kg,
                 c.ean_caixa, c.lote, c.data_producao, c.validade, c.peso_bruto_kg, c.tara_kg, c.qtd_pecas,
                 c.endereco AS endereco_atual_ou_origem, c.status AS caixa_status_atual,
                 p.codigo AS produto_codigo, p.descricao AS produto_descricao,
                 p.grupo, p.tipo_produto, p.valor_unitario
          FROM romaneios_itens ri
          JOIN romaneios r ON r.id = ri.romaneio_id
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
                 p.id AS produto_id, p.codigo AS produto_codigo, p.descricao AS produto_descricao,
                 p.grupo, p.tipo_produto, p.valor_unitario,
                 (SELECT ch.operacao FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.data_hora ASC LIMIT 1) AS origem_operacao,
                 (SELECT ch.operador_nome FROM caixas_historico ch WHERE ch.caixa_id = c.id ORDER BY ch.data_hora ASC LIMIT 1) AS operador_entrada
          FROM estoque_caixas c
          JOIN produtos p ON p.id = c.produto_id
          WHERE c.tenant_id = ${ctx.tenantId}
            AND c.filial_id = ${ctx.filialId}
            AND c.ean_caixa != ''
            AND DATE(c.created_at - INTERVAL '3 hours') BETWEEN ${dIni} AND ${dFim}
          ORDER BY c.created_at DESC
          LIMIT 1000
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
          saldo_kg: toNum(r.saldo_kg, 0),
          valor_unitario: toNum(r.valor_unitario, 0),
        })),
        romaneios: romaneiosFinal,
        saidasItens,
        entradasCaixas,
      }
    },
  )
}
