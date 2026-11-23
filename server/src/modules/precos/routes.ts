import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  acougueConfigFilial,
  auditoriaAcessos,
  operadores,
  produtos,
  tabelasPreco,
  tabelasPrecoItens,
  varejoEstoque,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { verificarSenha } from '../../utils/crypto.js'
import { gerarCodigoDocumento, parseUuidOrBadRequest, toDec, toNum } from '../wms/helpers.js'
import { detectarEspecieProduto } from '../interunidades/helpers.js'

const PERM_PRECOS_READ = ['varejo_acougue', 'pdv_caixa', 'produtos', 'pedidos', 'parametros_comerciais']
const PERM_PRECOS_WRITE = ['varejo_acougue', 'parametros_comerciais', 'produtos']

const FINALIDADES_VALIDAS = ['VAREJO_PDV', 'ACOUGUE_BALANCA', 'PROMOCIONAL', 'CLIENTE', 'ATACADO']

/**
 * Resolve a tabela de preços ativa para a balança/pesagem do Açougue nesta filial.
 */
export async function obterTabelaAtivaAcougue(db: any, tenantId: string, filialId: string) {
  const [cfg] = await db
    .select()
    .from(acougueConfigFilial)
    .where(and(eq(acougueConfigFilial.tenantId, tenantId), eq(acougueConfigFilial.filialId, filialId)))
    .limit(1)

  if (cfg?.tabelaAtivaId) {
    const [tab] = await db
      .select()
      .from(tabelasPreco)
      .where(and(eq(tabelasPreco.id, cfg.tabelaAtivaId), eq(tabelasPreco.tenantId, tenantId), eq(tabelasPreco.ativo, 1)))
      .limit(1)
    if (tab) return { cfg, tabela: tab }
  }

  // Fallback: tabela padrão do tenant
  const tabs = await db
    .select()
    .from(tabelasPreco)
    .where(and(eq(tabelasPreco.tenantId, tenantId), eq(tabelasPreco.ativo, 1)))
    .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.codigo))

  const padrao =
    tabs.find((t: any) => Number(t.padrao) === 1 && t.finalidade === 'ACOUGUE_BALANCA') ||
    tabs.find((t: any) => Number(t.padrao) === 1) ||
    tabs[0] ||
    null

  return { cfg: cfg || null, tabela: padrao }
}

/**
 * Valida o PIN numérico gerencial (4 a 6 dígitos) de um usuário MASTER ou ADMINISTRADOR ativo.
 */
export async function validarPinGerencial(db: any, tenantId: string, pinInformado: string) {
  const pinClean = String(pinInformado || '').trim()
  if (!pinClean || pinClean.length < 4) {
    throw new HttpError(400, 'Informe um PIN gerencial válido (mínimo 4 dígitos).')
  }

  const gestores = await db
    .select({
      id: operadores.id,
      nome: operadores.nome,
      login: operadores.login,
      nivel: operadores.nivel,
      perfil: operadores.perfil,
      pinGerencialHash: operadores.pinGerencialHash,
      senhaHash: operadores.senhaHash,
    })
    .from(operadores)
    .where(and(eq(operadores.tenantId, tenantId), eq(operadores.ativo, 1)))

  const autorizados = gestores.filter((g: any) => {
    const niv = String(g.nivel || '').toUpperCase()
    const perf = String(g.perfil || '').toUpperCase()
    return niv === 'MASTER' || niv === 'ADMINISTRADOR' || perf === 'GERENTE_LOJA'
  })

  for (const g of autorizados) {
    if (g.pinGerencialHash) {
      const ok = await verificarSenha(pinClean, g.pinGerencialHash)
      if (ok) return { id: g.id, nome: g.nome, login: g.login, nivel: g.nivel }
    }
  }

  // Fallback seguro apenas se nenhum gestor tiver PIN configurado ainda: valida senha de MASTER/ADMIN
  const algumComPin = autorizados.some((g: any) => Boolean(g.pinGerencialHash))
  if (!algumComPin) {
    for (const g of autorizados) {
      const ok = await verificarSenha(pinClean, g.senhaHash)
      if (ok) return { id: g.id, nome: g.nome, login: g.login, nivel: g.nivel }
    }
  }

  throw new HttpError(403, 'PIN gerencial inválido ou sem autorização de Gerente/Master.')
}

export function registerPrecosRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── 1) LISTAR TABELAS DE PREÇO ──────────────────────────────────────────────
  app.get(
    '/api/tabelas-preco',
    { preHandler: requirePermission(PERM_PRECOS_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { incluir_inativas?: string; finalidade?: string }

      const [tabs, countsRes, ativaInfo] = await Promise.all([
        conn.db
          .select()
          .from(tabelasPreco)
          .where(eq(tabelasPreco.tenantId, ctx.tenantId))
          .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.codigo)),
        conn.db.execute(sql`
          SELECT tabela_preco_id, COUNT(*)::int AS total_itens
          FROM tabelas_preco_itens
          WHERE tenant_id = ${ctx.tenantId} AND preco_venda > 0
          GROUP BY tabela_preco_id
        `),
        obterTabelaAtivaAcougue(conn.db, ctx.tenantId, ctx.filialId),
      ])

      const countMap = new Map<string, number>()
      for (const r of countsRes.rows as Array<{ tabela_preco_id: string; total_itens: number }>) {
        countMap.set(r.tabela_preco_id, Number(r.total_itens || 0))
      }

      const incluirInat = q.incluir_inativas === '1' || q.incluir_inativas === 'true'
      const finFiltro = String(q.finalidade || '').toUpperCase()
      const hoje = new Date().toISOString().slice(0, 10)

      const data = tabs
        .filter((t) => {
          if (!incluirInat && Number(t.ativo) !== 1) return false
          if (finFiltro && finFiltro !== 'TODAS' && t.finalidade !== finFiltro) return false
          return true
        })
        .map((t) => {
          const vencida = Boolean(t.dataFim && String(t.dataFim).slice(0, 10) < hoje)
          return {
            id: t.id,
            filial_id: t.filialId,
            codigo: t.codigo,
            nome: t.nome,
            finalidade: t.finalidade,
            padrao: Number(t.padrao) === 1,
            desconto_padrao_pct: toNum(t.descontoPadraoPct, 0),
            data_inicio: t.dataInicio,
            data_fim: t.dataFim,
            vencida,
            observacoes: t.observacoes || '',
            ativo: Number(t.ativo) === 1,
            total_itens: countMap.get(t.id) || 0,
            ativa_no_acougue: ativaInfo.tabela?.id === t.id,
            updated_at: t.updatedAt,
          }
        })

      return {
        success: true,
        tabela_ativa_acougue_id: ativaInfo.tabela?.id || null,
        data,
      }
    },
  )

  // ── 2) DETALHE DE UMA TABELA DE PREÇO + ITENS COM MARGEM REAL ───────────────
  app.get(
    '/api/tabelas-preco/:id',
    { preHandler: requirePermission(PERM_PRECOS_READ, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'tabela_preco_id')
      const q = (req.query || {}) as { busca?: string; especie?: string }

      const [tab] = await conn.db
        .select()
        .from(tabelasPreco)
        .where(and(eq(tabelasPreco.id, id), eq(tabelasPreco.tenantId, ctx.tenantId)))
        .limit(1)
      if (!tab) throw new HttpError(404, 'Tabela de preços não encontrada.')

      const rows = await conn.db
        .select({
          id: tabelasPrecoItens.id,
          produto_id: tabelasPrecoItens.produtoId,
          preco_venda: tabelasPrecoItens.precoVenda,
          preco_promocional: tabelasPrecoItens.precoPromocional,
          desconto_pct: tabelasPrecoItens.descontoPct,
          updated_at: tabelasPrecoItens.updatedAt,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          produto_ean: produtos.ean,
          produto_unidade: produtos.unidade,
          produto_grupo: produtos.grupo,
          produto_ncm: produtos.ncm,
          produto_especie: produtos.especie,
          produto_conservacao: produtos.conservacao,
          validade_dias: produtos.validadeDias,
          tara_embalagem_kg: produtos.taraEmbalagemKg,
          custo_medio_kg: produtos.custoMedioKg,
          ultimo_preco_compra: produtos.ultimoPrecoCompra,
        })
        .from(tabelasPrecoItens)
        .innerJoin(produtos, eq(produtos.id, tabelasPrecoItens.produtoId))
        .where(and(eq(tabelasPrecoItens.tabelaPrecoId, id), eq(tabelasPrecoItens.tenantId, ctx.tenantId)))
        .orderBy(asc(produtos.descricao))

      const busca = String(q.busca || '').trim().toLowerCase()
      const espFiltro = String(q.especie || 'TODOS').toUpperCase()

      const itens = rows
        .map((r) => {
          const preco = toNum(r.preco_venda, 0)
          const custo = toNum(r.custo_medio_kg, 0) || toNum(r.ultimo_preco_compra, 0)
          const margemPct = preco > 0 && custo > 0 ? Number((((preco - custo) / preco) * 100).toFixed(1)) : null
          const especie =
            r.produto_especie ||
            detectarEspecieProduto({ grupo: r.produto_grupo, ncm: r.produto_ncm, descricao: r.produto_descricao })
          return {
            id: r.id,
            produto_id: r.produto_id,
            produto_codigo: r.produto_codigo || '',
            produto_descricao: r.produto_descricao,
            produto_ean: r.produto_ean || '',
            unidade: r.produto_unidade || 'KG',
            especie,
            conservacao: r.produto_conservacao || 'RESFRIADO',
            validade_dias: Number(r.validade_dias ?? 5),
            tara_embalagem_kg: toNum(r.tara_embalagem_kg, 0),
            custo_medio_kg: custo,
            preco_venda: preco,
            preco_promocional: r.preco_promocional != null ? toNum(r.preco_promocional, 0) : null,
            desconto_pct: toNum(r.desconto_pct, 0),
            margem_pct: margemPct,
            abaixo_custo: custo > 0 && preco < custo,
            updated_at: r.updated_at,
          }
        })
        .filter((it) => {
          if (espFiltro !== 'TODOS' && it.especie !== espFiltro) return false
          if (busca) {
            return (
              it.produto_descricao.toLowerCase().includes(busca) ||
              it.produto_codigo.toLowerCase().includes(busca) ||
              it.produto_ean.toLowerCase().includes(busca)
            )
          }
          return true
        })

      return {
        success: true,
        tabela: {
          id: tab.id,
          codigo: tab.codigo,
          nome: tab.nome,
          finalidade: tab.finalidade,
          padrao: Number(tab.padrao) === 1,
          desconto_padrao_pct: toNum(tab.descontoPadraoPct, 0),
          data_inicio: tab.dataInicio,
          data_fim: tab.dataFim,
          observacoes: tab.observacoes || '',
          ativo: Number(tab.ativo) === 1,
        },
        itens,
      }
    },
  )

  // ── 3) CRIAR TABELA DE PREÇO (OPCIONAL: COPIAR DE OUTRA TABELA C/ DESCONTO) ─
  app.post(
    '/api/tabelas-preco',
    { preHandler: requirePermission(PERM_PRECOS_WRITE) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        nome?: string
        finalidade?: string
        padrao?: boolean
        desconto_padrao_pct?: number
        data_inicio?: string | null
        data_fim?: string | null
        observacoes?: string
        copiar_de_tabela_id?: string | null
        importar_precos_atuais?: boolean
      }

      const nome = String(body.nome || '').trim()
      if (!nome) throw new HttpError(400, 'Informe o nome da tabela de preços.')
      const fin = String(body.finalidade || 'VAREJO_PDV').toUpperCase()
      const finalidade = FINALIDADES_VALIDAS.includes(fin) ? fin : 'VAREJO_PDV'
      const descPadrao = Math.min(99, Math.max(-200, Number(body.desconto_padrao_pct || 0)))
      const ehPadrao = Boolean(body.padrao)

      const out = await conn.db.transaction(async (tx) => {
        if (ehPadrao) {
          await tx
            .update(tabelasPreco)
            .set({ padrao: 0 })
            .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.finalidade, finalidade)))
        }

        const id = uuidv7()
        let codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'TABELA_PRECO', 'TAB', 3)
        for (let tent = 0; tent < 20; tent++) {
          const [dupCod] = await tx
            .select({ id: tabelasPreco.id })
            .from(tabelasPreco)
            .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.codigo, codigo)))
            .limit(1)
          if (!dupCod) break
          codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'TABELA_PRECO', 'TAB', 3)
        }
        await tx.insert(tabelasPreco).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          nome,
          finalidade,
          padrao: ehPadrao ? 1 : 0,
          descontoPadraoPct: toDec(descPadrao, 2),
          dataInicio: body.data_inicio && /^\d{4}-\d{2}-\d{2}$/.test(body.data_inicio) ? body.data_inicio : null,
          dataFim: body.data_fim && /^\d{4}-\d{2}-\d{2}$/.test(body.data_fim) ? body.data_fim : null,
          observacoes: String(body.observacoes || '').trim(),
          ativo: 1,
        })

        let totalCopiados = 0
        const fator = Number((1 - descPadrao / 100).toFixed(4))

        if (body.copiar_de_tabela_id) {
          const origId = parseUuidOrBadRequest(body.copiar_de_tabela_id, 'copiar_de_tabela_id')
          const origItens = await tx
            .select()
            .from(tabelasPrecoItens)
            .where(and(eq(tabelasPrecoItens.tabelaPrecoId, origId), eq(tabelasPrecoItens.tenantId, ctx.tenantId)))

          const novos = origItens.map((it) => {
            const pOrig = toNum(it.precoVenda, 0)
            const pNovo = Math.max(0.01, Number((pOrig * fator).toFixed(2)))
            return {
              id: uuidv7(),
              tenantId: ctx.tenantId,
              tabelaPrecoId: id,
              produtoId: it.produtoId,
              precoVenda: toDec(pNovo, 4),
              descontoPct: toDec(Math.max(0, descPadrao), 2),
            }
          })
          for (let i = 0; i < novos.length; i += 100) {
            await tx.insert(tabelasPrecoItens).values(novos.slice(i, i + 100)).onConflictDoNothing()
          }
          totalCopiados = novos.length
        } else if (body.importar_precos_atuais) {
          const [estPrecos, prodsPrecos] = await Promise.all([
            tx
              .select({ produtoId: varejoEstoque.produtoId, preco: varejoEstoque.precoVendaVarejo })
              .from(varejoEstoque)
              .where(eq(varejoEstoque.tenantId, ctx.tenantId)),
            tx
              .select({ id: produtos.id, valorUnitario: produtos.valorUnitario })
              .from(produtos)
              .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.ativo, 1))),
          ])
          const mapPreco = new Map<string, number>()
          for (const p of prodsPrecos) {
            const v = toNum(p.valorUnitario, 0)
            if (v > 0) mapPreco.set(p.id, v)
          }
          for (const e of estPrecos) {
            const v = toNum(e.preco, 0)
            if (v > 0) mapPreco.set(e.produtoId, v)
          }
          const novos = Array.from(mapPreco.entries()).map(([prodId, preco]) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            tabelaPrecoId: id,
            produtoId: prodId,
            precoVenda: toDec(Math.max(0.01, Number((preco * fator).toFixed(2))), 4),
            descontoPct: toDec(Math.max(0, descPadrao), 2),
          }))
          for (let i = 0; i < novos.length; i += 100) {
            await tx.insert(tabelasPrecoItens).values(novos.slice(i, i + 100)).onConflictDoNothing()
          }
          totalCopiados = novos.length
        }

        return { id, codigo, nome, finalidade, total_itens: totalCopiados }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── 4) ATUALIZAR METADADOS DA TABELA ────────────────────────────────────────
  app.put(
    '/api/tabelas-preco/:id',
    { preHandler: requirePermission(PERM_PRECOS_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'tabela_preco_id')
      const body = (req.body || {}) as {
        nome?: string
        finalidade?: string
        padrao?: boolean
        desconto_padrao_pct?: number
        data_inicio?: string | null
        data_fim?: string | null
        observacoes?: string
        ativo?: boolean
      }

      const [atual] = await conn.db
        .select()
        .from(tabelasPreco)
        .where(and(eq(tabelasPreco.id, id), eq(tabelasPreco.tenantId, ctx.tenantId)))
        .limit(1)
      if (!atual) throw new HttpError(404, 'Tabela de preços não encontrada.')

      const finalidade =
        body.finalidade && FINALIDADES_VALIDAS.includes(body.finalidade.toUpperCase())
          ? body.finalidade.toUpperCase()
          : atual.finalidade

      await conn.db.transaction(async (tx) => {
        if (body.padrao === true) {
          await tx
            .update(tabelasPreco)
            .set({ padrao: 0 })
            .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.finalidade, finalidade)))
        }
        await tx
          .update(tabelasPreco)
          .set({
            nome: body.nome ? body.nome.trim() : atual.nome,
            finalidade,
            padrao: body.padrao !== undefined ? (body.padrao ? 1 : 0) : atual.padrao,
            descontoPadraoPct:
              body.desconto_padrao_pct !== undefined
                ? toDec(Number(body.desconto_padrao_pct || 0), 2)
                : atual.descontoPadraoPct,
            dataInicio:
              body.data_inicio !== undefined
                ? body.data_inicio && /^\d{4}-\d{2}-\d{2}$/.test(body.data_inicio)
                  ? body.data_inicio
                  : null
                : atual.dataInicio,
            dataFim:
              body.data_fim !== undefined
                ? body.data_fim && /^\d{4}-\d{2}-\d{2}$/.test(body.data_fim)
                  ? body.data_fim
                  : null
                : atual.dataFim,
            observacoes: body.observacoes !== undefined ? String(body.observacoes).trim() : atual.observacoes,
            ativo: body.ativo !== undefined ? (body.ativo ? 1 : 0) : atual.ativo,
            updatedAt: new Date(),
          })
          .where(eq(tabelasPreco.id, id))
      })

      return { success: true }
    },
  )

  // ── 5) ADICIONAR / ATUALIZAR ITENS NA TABELA DE PREÇO ───────────────────────
  app.post(
    '/api/tabelas-preco/:id/itens',
    { preHandler: requirePermission(PERM_PRECOS_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'tabela_preco_id')
      const body = (req.body || {}) as {
        produto_id?: string
        preco_venda?: number
        desconto_pct?: number
        itens?: Array<{ produto_id: string; preco_venda: number; desconto_pct?: number }>
      }

      const [tab] = await conn.db
        .select()
        .from(tabelasPreco)
        .where(and(eq(tabelasPreco.id, id), eq(tabelasPreco.tenantId, ctx.tenantId)))
        .limit(1)
      if (!tab) throw new HttpError(404, 'Tabela de preços não encontrada.')

      const lista = Array.isArray(body.itens)
        ? body.itens
        : body.produto_id
          ? [{ produto_id: body.produto_id, preco_venda: Number(body.preco_venda || 0), desconto_pct: Number(body.desconto_pct || 0) }]
          : []

      if (lista.length === 0) throw new HttpError(400, 'Informe ao menos um produto e preço.')

      let salvos = 0
      await conn.db.transaction(async (tx) => {
        for (const it of lista) {
          const pid = parseUuidOrBadRequest(it.produto_id, 'produto_id')
          const preco = Number(it.preco_venda)
          if (!Number.isFinite(preco) || preco <= 0) {
            throw new HttpError(400, 'O preço de venda deve ser maior que zero.')
          }
          const descPct = Number(it.desconto_pct || 0)

          const [exist] = await tx
            .select({ id: tabelasPrecoItens.id })
            .from(tabelasPrecoItens)
            .where(and(eq(tabelasPrecoItens.tabelaPrecoId, id), eq(tabelasPrecoItens.produtoId, pid)))
            .limit(1)

          if (exist) {
            await tx
              .update(tabelasPrecoItens)
              .set({
                precoVenda: toDec(preco, 4),
                descontoPct: toDec(descPct, 2),
                updatedAt: new Date(),
              })
              .where(eq(tabelasPrecoItens.id, exist.id))
          } else {
            await tx.insert(tabelasPrecoItens).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              tabelaPrecoId: id,
              produtoId: pid,
              precoVenda: toDec(preco, 4),
              descontoPct: toDec(descPct, 2),
            })
          }
          salvos += 1
        }
      })

      return { success: true, salvos }
    },
  )

  app.delete(
    '/api/tabelas-preco/:id/itens/:produtoId',
    { preHandler: requirePermission(PERM_PRECOS_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'tabela_preco_id')
      const prodId = parseUuidOrBadRequest((req.params as { produtoId: string }).produtoId, 'produto_id')

      await conn.db
        .delete(tabelasPrecoItens)
        .where(
          and(
            eq(tabelasPrecoItens.tabelaPrecoId, id),
            eq(tabelasPrecoItens.produtoId, prodId),
            eq(tabelasPrecoItens.tenantId, ctx.tenantId),
          ),
        )
      return { success: true }
    },
  )

  // ── 6) APLICAR DESCONTO / REAJUSTE EM MASSA (% OU R$) ───────────────────────
  app.post(
    '/api/tabelas-preco/:id/aplicar-reajuste',
    { preHandler: requirePermission(PERM_PRECOS_WRITE) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'tabela_preco_id')
      const body = (req.body || {}) as {
        operacao?: string // DESCONTO | ACRESCIMO
        tipo_valor?: string // PCT | VALOR
        valor?: number
        especie?: string // TODOS | BOVINO | SUINO | AVES | EMPORIO | OUTROS
      }

      const operacao = String(body.operacao || 'DESCONTO').toUpperCase() === 'ACRESCIMO' ? 'ACRESCIMO' : 'DESCONTO'
      const tipoVal = String(body.tipo_valor || 'PCT').toUpperCase() === 'VALOR' ? 'VALOR' : 'PCT'
      const val = Number(body.valor || 0)
      if (!Number.isFinite(val) || val <= 0) {
        throw new HttpError(400, 'Informe um valor de reajuste/desconto maior que zero.')
      }
      if (tipoVal === 'PCT' && operacao === 'DESCONTO' && val >= 100) {
        throw new HttpError(400, 'Desconto percentual deve ser menor que 100%.')
      }

      const espFiltro = String(body.especie || 'TODOS').toUpperCase()

      const rows = await conn.db
        .select({
          itemId: tabelasPrecoItens.id,
          precoVenda: tabelasPrecoItens.precoVenda,
          grupo: produtos.grupo,
          ncm: produtos.ncm,
          descricao: produtos.descricao,
          especie: produtos.especie,
        })
        .from(tabelasPrecoItens)
        .innerJoin(produtos, eq(produtos.id, tabelasPrecoItens.produtoId))
        .where(and(eq(tabelasPrecoItens.tabelaPrecoId, id), eq(tabelasPrecoItens.tenantId, ctx.tenantId)))

      let atualizados = 0
      await conn.db.transaction(async (tx) => {
        for (const r of rows) {
          const esp = r.especie || detectarEspecieProduto({ grupo: r.grupo, ncm: r.ncm, descricao: r.descricao })
          if (espFiltro !== 'TODOS' && esp !== espFiltro) continue
          const atual = toNum(r.precoVenda, 0)
          let novo = atual
          if (tipoVal === 'PCT') {
            novo = operacao === 'DESCONTO' ? atual * (1 - val / 100) : atual * (1 + val / 100)
          } else {
            novo = operacao === 'DESCONTO' ? atual - val : atual + val
          }
          novo = Math.max(0.01, Number(novo.toFixed(2)))
          await tx
            .update(tabelasPrecoItens)
            .set({
              precoVenda: toDec(novo, 4),
              descontoPct: operacao === 'DESCONTO' && tipoVal === 'PCT' ? toDec(val, 2) : '0.00',
              updatedAt: new Date(),
            })
            .where(eq(tabelasPrecoItens.id, r.itemId))
          atualizados += 1
        }
      })

      return { success: true, atualizados }
    },
  )

  // ── 7) AÇOUGUE: CONSULTAR TABELA ATIVA & TROCAR TABELA COM PIN GERENCIAL ───
  app.get(
    '/api/acougue/tabela-ativa',
    { preHandler: requirePermission(['varejo_acougue', 'pdv_caixa'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const { cfg, tabela } = await obterTabelaAtivaAcougue(conn.db, ctx.tenantId, ctx.filialId)

      const todasAtivas = await conn.db
        .select({
          id: tabelasPreco.id,
          codigo: tabelasPreco.codigo,
          nome: tabelasPreco.nome,
          finalidade: tabelasPreco.finalidade,
          padrao: tabelasPreco.padrao,
          data_fim: tabelasPreco.dataFim,
        })
        .from(tabelasPreco)
        .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.ativo, 1)))
        .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.codigo))

      return {
        success: true,
        tabela_ativa: tabela
          ? {
              id: tabela.id,
              codigo: tabela.codigo,
              nome: tabela.nome,
              finalidade: tabela.finalidade,
              padrao: Number(tabela.padrao) === 1,
              data_inicio: tabela.dataInicio,
              data_fim: tabela.dataFim,
            }
          : null,
        tabela_padrao_id: cfg?.tabelaPadraoId || tabela?.id || null,
        em_tabela_alternativa: Boolean(cfg?.tabelaPadraoId && tabela && cfg.tabelaPadraoId !== tabela.id),
        alterada_por_nome: cfg?.alteradaPorNome || '',
        alterada_em: cfg?.alteradaEm || null,
        motivo: cfg?.motivo || '',
        historico: (cfg?.historicoJson || []).slice(0, 20),
        tabelas_disponiveis: todasAtivas.map((t) => ({
          ...t,
          padrao: Number(t.padrao) === 1,
        })),
      }
    },
  )

  app.post(
    '/api/acougue/trocar-tabela',
    { preHandler: requirePermission(['varejo_acougue']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        tabela_preco_id?: string
        pin?: string
        motivo?: string
      }

      const novaTabId = parseUuidOrBadRequest(body.tabela_preco_id, 'tabela_preco_id')
      const autorizador = await validarPinGerencial(conn.db, ctx.tenantId, String(body.pin || ''))

      const [novaTab] = await conn.db
        .select()
        .from(tabelasPreco)
        .where(and(eq(tabelasPreco.id, novaTabId), eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.ativo, 1)))
        .limit(1)
      if (!novaTab) throw new HttpError(404, 'Tabela de preços selecionada não encontrada ou inativa.')

      const out = await conn.db.transaction(async (tx) => {
        const [cfgAtual] = await tx
          .select()
          .from(acougueConfigFilial)
          .where(and(eq(acougueConfigFilial.tenantId, ctx.tenantId), eq(acougueConfigFilial.filialId, ctx.filialId)))
          .limit(1)

        let tabAnteriorNome = '-'
        if (cfgAtual?.tabelaAtivaId) {
          const [ant] = await tx
            .select({ codigo: tabelasPreco.codigo, nome: tabelasPreco.nome })
            .from(tabelasPreco)
            .where(eq(tabelasPreco.id, cfgAtual.tabelaAtivaId))
            .limit(1)
          if (ant) tabAnteriorNome = `${ant.codigo} — ${ant.nome}`
        }

        const histEntry = {
          data_hora: new Date().toISOString(),
          de: tabAnteriorNome,
          para: `${novaTab.codigo} — ${novaTab.nome}`,
          autorizado_por: autorizador.nome,
          executado_por: ctx.operador.nome,
          motivo: String(body.motivo || '').trim() || 'Troca de tabela na balança',
        }
        const novoHist = [histEntry, ...((cfgAtual?.historicoJson || []) as Array<Record<string, unknown>>)].slice(0, 50)

        if (cfgAtual) {
          await tx
            .update(acougueConfigFilial)
            .set({
              tabelaAtivaId: novaTab.id,
              tabelaPadraoId: cfgAtual.tabelaPadraoId || novaTab.id,
              alteradaPorId: autorizador.id,
              alteradaPorNome: autorizador.nome,
              alteradaEm: new Date(),
              motivo: histEntry.motivo,
              historicoJson: novoHist,
              updatedAt: new Date(),
            })
            .where(eq(acougueConfigFilial.id, cfgAtual.id))
        } else {
          await tx.insert(acougueConfigFilial).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            tabelaAtivaId: novaTab.id,
            tabelaPadraoId: novaTab.id,
            alteradaPorId: autorizador.id,
            alteradaPorNome: autorizador.nome,
            alteradaEm: new Date(),
            motivo: histEntry.motivo,
            historicoJson: novoHist,
          })
        }

        await tx.insert(auditoriaAcessos).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          targetUserId: autorizador.id,
          targetUserNome: autorizador.nome,
          acao: 'TROCA_TABELA_ACOUGUE',
          detalhesAntes: { tabela: tabAnteriorNome },
          detalhesDepois: { tabela: `${novaTab.codigo} — ${novaTab.nome}`, motivo: histEntry.motivo },
          executorId: ctx.operador.id,
          executorNome: ctx.operador.nome,
        })

        return {
          tabela_ativa: {
            id: novaTab.id,
            codigo: novaTab.codigo,
            nome: novaTab.nome,
            finalidade: novaTab.finalidade,
          },
          autorizado_por: autorizador.nome,
          em_tabela_alternativa: Boolean(cfgAtual?.tabelaPadraoId && cfgAtual.tabelaPadraoId !== novaTab.id),
        }
      })

      return { success: true, data: out }
    },
  )
}
