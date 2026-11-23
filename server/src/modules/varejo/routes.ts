import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  auditoriaAcessos,
  clientes,
  empresas,
  estoqueCaixas,
  etiquetasAcougue,
  filiais,
  financeiroContasBancarias,
  financeiroMovimentacoes,
  financeiroTitulos,
  fiscalConfigFilial,
  fiscalNotas,
  matrizTributaria,
  pdvCaixaMovimentos,
  pdvCaixas,
  pdvVendas,
  produtos,
  produtosEans,
  tabelasPreco,
  tabelasPrecoItens,
  tenants,
  varejoEstoque,
  varejoInventarios,
  varejoMovimentacoes,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  lerTenantFeatures,
  parseUuidOrBadRequest,
  toDec,
  toNum,
} from '../wms/helpers.js'
import { validarPinGerencial } from '../precos/routes.js'
import {
  calcularTributacaoItem,
  gerarChaveAcessoNfe,
  gerarXmlNfe400,
  onlyDigits,
} from '../fiscal/nfeBuilder.js'
import { gerarPixBrCode } from './pixBrCode.js'
import { baixarTitulo, obterContaBancariaPadrao } from '../financeiro/integracaoHelper.js'

const PERM_VAREJO = ['varejo_acougue', 'pdv_caixa', 'interunidades', 'produtos']
const PERM_PDV = ['pdv_caixa', 'varejo_acougue']

function somarDiasIso(baseIso: string, dias: number): string {
  const ms = new Date(`${baseIso}T12:00:00Z`).getTime()
  return new Date(ms + Math.max(0, Number(dias || 0)) * 86_400_000).toISOString().slice(0, 10)
}

function nomeCliente(c: { nomeFantasia?: string | null; razaoSocial?: string | null }): string {
  return String(c.nomeFantasia || c.razaoSocial || 'CLIENTE').trim()
}

/**
 * Decodificador universal de códigos bipados no PDV Frente de Caixa:
 * 1) QR Code personalizado Zebra 80x45: TRIC|ID=ETQ00001|COD=123|KG=1.250|VL=74.88|LT=...
 * 2) Etiqueta pesável de balança EAN-13 começando com '2' (todos os padrões Toledo/Filizola:
 *    Preço 4 ou 5 dígitos, Peso em gramas 4 ou 5 dígitos, ou AUTO)
 * 3) Código de barras comum (EAN-13/EAN-8) ou código interno / busca textual
 */
export function parseCodigoQrZebra(raw: string): {
  codigo_etiqueta: string
  codigo: string
  peso_kg: number | null
  valor_total: number | null
  lote: string
  validade: string
} | null {
  const s = String(raw || '').trim()
  if (!s.toUpperCase().startsWith('TRIC|')) return null
  const partes = s.split('|').slice(1)
  const map: Record<string, string> = {}
  for (const p of partes) {
    const idx = p.indexOf('=')
    if (idx > 0) {
      map[p.slice(0, idx).trim().toUpperCase()] = p.slice(idx + 1).trim()
    }
  }
  const codigo = map.COD || map.C || ''
  const codigoEtiqueta = map.ID || map.ETQ || ''
  if (!codigo && !codigoEtiqueta) return null
  const kgNum = map.KG !== undefined ? Number(String(map.KG).replace(',', '.')) : NaN
  const vlNum = map.VL !== undefined ? Number(String(map.VL).replace(',', '.')) : NaN
  return {
    codigo_etiqueta: codigoEtiqueta,
    codigo,
    peso_kg: Number.isFinite(kgNum) && kgNum > 0 ? Number(kgNum.toFixed(3)) : null,
    valor_total: Number.isFinite(vlNum) && vlNum > 0 ? Number(vlNum.toFixed(2)) : null,
    lote: map.LT || '',
    validade: map.VAL || '',
  }
}

export function parseEan2BalancaCandidatos(raw: string, padraoConfig = 'AUTO'): Array<{
  modo: 'PRECO' | 'PESO'
  codigosCandidatos: string[]
  valorTotal: number | null
  pesoKg: number | null
  padrao: string
}> {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length !== 13 || !digits.startsWith('2')) return []

  const c4 = digits.slice(1, 5)
  const v6 = digits.slice(5, 11) // 6 dígitos (ex: 4d cod + 6d valor/peso? padrão BR comum: 2 + CCCC + 0 + VVVVV + D ou 2 + CCCCC + VVVVVV + D)
  const c5 = digits.slice(1, 6)
  const v5 = digits.slice(6, 12) // 6 dígitos? Wait: digits[0]='2', digits[1..11]=11 dígitos, digits[12]=DV!
  // Estrutura real EAN-13 Brasil (13 dígitos: [0]='2', [1..11]=11 dígitos de dados, [12]=dígito verificador):
  // - Toledo/Filizola 4 dígitos código: [1..4]=cod(4), [5]=0/prefix, [6..11]=valor/peso(6) OU [5..11]
  // - Toledo/Filizola 5 dígitos código: [1..5]=cod(5), [6..11]=valor(6 centavos ou 6 gramas)
  // - Padrão 6 dígitos código + 5 dígitos valor/peso: [1..6]=cod(6), [7..11]=valor(5)
  const dados11 = digits.slice(1, 12)
  const cod4 = dados11.slice(0, 4)
  const val4_7 = dados11.slice(4) // 7 dígitos -> últimos 5 ou 6 costumam ser valor/peso (primeiro costuma ser 0)
  const val4_6 = dados11.slice(5) // 6 dígitos (pula 1 zero reservado)
  const cod5 = dados11.slice(0, 5)
  const val5_6 = dados11.slice(5) // 6 dígitos
  const cod6 = dados11.slice(0, 6)
  const val6_5 = dados11.slice(6) // 5 dígitos

  const normCodes = (c: string) => {
    const semZero = c.replace(/^0+/, '') || '0'
    return Array.from(new Set([c, semZero]))
  }

  const all: Array<{
    modo: 'PRECO' | 'PESO'
    codigosCandidatos: string[]
    valorTotal: number | null
    pesoKg: number | null
    padrao: string
  }> = []

  const add = (padrao: string, modo: 'PRECO' | 'PESO', cod: string, numStr: string) => {
    const n = Number(numStr)
    if (!Number.isFinite(n) || n <= 0) return
    all.push({
      padrao,
      modo,
      codigosCandidatos: normCodes(cod),
      valorTotal: modo === 'PRECO' ? Number((n / 100).toFixed(2)) : null,
      pesoKg: modo === 'PESO' ? Number((n / 1000).toFixed(3)) : null,
    })
  }

  const pref = String(padraoConfig || 'AUTO').toUpperCase()
  if (pref === 'TOLEDO_PRECO_4') {
    add('TOLEDO_PRECO_4', 'PRECO', cod4, val4_6)
    add('TOLEDO_PRECO_4_7', 'PRECO', cod4, val4_7)
  } else if (pref === 'TOLEDO_PRECO_5') {
    add('TOLEDO_PRECO_5', 'PRECO', cod5, val5_6)
    add('TOLEDO_PRECO_6', 'PRECO', cod6, val6_5)
  } else if (pref === 'TOLEDO_PESO_4') {
    add('TOLEDO_PESO_4', 'PESO', cod4, val4_6)
    add('TOLEDO_PESO_4_7', 'PESO', cod4, val4_7)
  } else if (pref === 'TOLEDO_PESO_5') {
    add('TOLEDO_PESO_5', 'PESO', cod5, val5_6)
    add('TOLEDO_PESO_6', 'PESO', cod6, val6_5)
  } else {
    // AUTO: tenta 5 dígitos e 4 dígitos e 6 dígitos (preço e peso — quem casar com código_balança/código do produto vence!)
    add('TOLEDO_PRECO_5', 'PRECO', cod5, val5_6)
    add('TOLEDO_PRECO_4', 'PRECO', cod4, val4_6)
    add('TOLEDO_PRECO_6', 'PRECO', cod6, val6_5)
    add('TOLEDO_PESO_5', 'PESO', cod5, val5_6)
    add('TOLEDO_PESO_4', 'PESO', cod4, val4_6)
    add('TOLEDO_PESO_6', 'PESO', cod6, val6_5)
  }
  void c4
  void v6
  void c5
  void v5
  return all
}

async function lerPadraoBalancaTenant(db: any, tenantId: string): Promise<string> {
  const [t] = await db.select({ featuresJson: tenants.featuresJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const raw = (t?.featuresJson || {}) as Record<string, unknown>
  return String(raw.padrao_balanca_loja || 'AUTO').toUpperCase()
}

export function registerVarejoRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. ESTOQUE DA LOJA (1/1 — AÇOUGUE & EMPÓRIO)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/varejo/estoque',
    { preHandler: requirePermission(PERM_VAREJO, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { busca?: string; setor?: string; apenas_abaixo_min?: string }

      const rows = await conn.db
        .select({
          id: varejoEstoque.id,
          produto_id: varejoEstoque.produtoId,
          unidade_venda: varejoEstoque.unidadeVenda,
          saldo_qtd: varejoEstoque.saldoQtd,
          preco_venda_varejo: varejoEstoque.precoVendaVarejo,
          estoque_minimo: varejoEstoque.estoqueMinimo,
          codigo_balanca: varejoEstoque.codigoBalanca,
          setor_loja: varejoEstoque.setorLoja,
          updated_at: varejoEstoque.updatedAt,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          produto_ean: produtos.ean,
          produto_grupo: produtos.grupo,
          produto_ncm: produtos.ncm,
          custo_medio_kg: produtos.custoMedioKg,
          valor_unitario_padrao: produtos.valorUnitario,
        })
        .from(varejoEstoque)
        .innerJoin(produtos, eq(produtos.id, varejoEstoque.produtoId))
        .where(and(eq(varejoEstoque.tenantId, ctx.tenantId), eq(varejoEstoque.filialId, ctx.filialId)))
        .orderBy(produtos.descricao)

      const busca = String(q.busca || '').trim().toLowerCase()
      const setor = String(q.setor || 'TODOS').toUpperCase()
      const soAbaixo = q.apenas_abaixo_min === '1' || q.apenas_abaixo_min === 'true'

      const data = rows
        .map((r) => {
          const saldo = toNum(r.saldo_qtd, 0)
          const minimo = toNum(r.estoque_minimo, 0)
          const preco = toNum(r.preco_venda_varejo, 0) || toNum(r.valor_unitario_padrao, 0)
          const custo = toNum(r.custo_medio_kg, 0)
          const margemPct = preco > 0 && custo > 0 ? Number((((preco - custo) / preco) * 100).toFixed(1)) : null
          return {
            id: r.id,
            produto_id: r.produto_id,
            produto_codigo: r.produto_codigo || '',
            produto_descricao: r.produto_descricao,
            produto_ean: r.produto_ean || '',
            produto_grupo: r.produto_grupo || '',
            produto_ncm: r.produto_ncm || '',
            unidade_venda: r.unidade_venda || 'KG',
            saldo_qtd: saldo,
            preco_venda_varejo: preco,
            custo_medio_kg: custo,
            margem_pct: margemPct,
            estoque_minimo: minimo,
            abaixo_minimo: minimo > 0 && saldo <= minimo,
            codigo_balanca: r.codigo_balanca || '',
            setor_loja: r.setor_loja || 'ACOUGUE',
            updated_at: r.updated_at,
          }
        })
        .filter((r) => {
          if (setor !== 'TODOS' && r.setor_loja !== setor) return false
          if (soAbaixo && !r.abaixo_minimo) return false
          if (busca) {
            return (
              r.produto_descricao.toLowerCase().includes(busca) ||
              r.produto_codigo.toLowerCase().includes(busca) ||
              r.codigo_balanca.toLowerCase().includes(busca) ||
              r.produto_ean.toLowerCase().includes(busca)
            )
          }
          return true
        })

      const padraoBalanca = await lerPadraoBalancaTenant(conn.db, ctx.tenantId)
      return {
        success: true,
        padrao_balanca_loja: padraoBalanca,
        resumo: {
          total_skus: data.length,
          total_acougue: data.filter((d) => d.setor_loja === 'ACOUGUE').length,
          total_emporio: data.filter((d) => d.setor_loja === 'EMPORIO').length,
          abaixo_minimo: data.filter((d) => d.abaixo_minimo).length,
        },
        data,
      }
    },
  )

  app.post(
    '/api/varejo/estoque/ajustar',
    { preHandler: requirePermission(['varejo_acougue', 'produtos']) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        produto_id?: string
        unidade_venda?: string
        preco_venda_varejo?: number
        estoque_minimo?: number
        codigo_balanca?: string
        setor_loja?: string
        tipo_movimento?: string // AJUSTE_MANUAL | ENTRADA_COMPRA | QUEBRA_BALCAO
        qtd_ajuste?: number // positivo soma, negativo subtrai (ou em QUEBRA_BALCAO subtrai)
        observacao?: string
      }

      const prodId = parseUuidOrBadRequest(body.produto_id, 'produto_id')
      const [prod] = await conn.db
        .select()
        .from(produtos)
        .where(and(eq(produtos.id, prodId), eq(produtos.tenantId, ctx.tenantId)))
        .limit(1)
      if (!prod) throw new HttpError(404, 'Produto não encontrado no catálogo.')

      const out = await conn.db.transaction(async (tx) => {
        const [atual] = await tx
          .select()
          .from(varejoEstoque)
          .where(
            and(
              eq(varejoEstoque.tenantId, ctx.tenantId),
              eq(varejoEstoque.filialId, ctx.filialId),
              eq(varejoEstoque.produtoId, prodId),
            ),
          )
          .limit(1)

        const saldoAnt = atual ? toNum(atual.saldoQtd, 0) : 0
        const tipoMov = String(body.tipo_movimento || 'AJUSTE_MANUAL').toUpperCase()
        let delta = Number(body.qtd_ajuste || 0)
        if (!Number.isFinite(delta)) delta = 0
        if (tipoMov === 'QUEBRA_BALCAO' && delta > 0) delta = -delta
        const saldoNovo = Number((saldoAnt + delta).toFixed(3))

        const unidade = String(body.unidade_venda || atual?.unidadeVenda || 'KG').toUpperCase() === 'UN' ? 'UN' : 'KG'
        const setor = String(body.setor_loja || atual?.setorLoja || 'ACOUGUE').toUpperCase() === 'EMPORIO' ? 'EMPORIO' : 'ACOUGUE'
        const preco =
          body.preco_venda_varejo !== undefined && Number.isFinite(Number(body.preco_venda_varejo))
            ? Math.max(0, Number(body.preco_venda_varejo))
            : atual
              ? toNum(atual.precoVendaVarejo, 0)
              : toNum(prod.valorUnitario, 0)
        const estMin =
          body.estoque_minimo !== undefined && Number.isFinite(Number(body.estoque_minimo))
            ? Math.max(0, Number(body.estoque_minimo))
            : atual
              ? toNum(atual.estoqueMinimo, 0)
              : 0
        const codBal =
          body.codigo_balanca !== undefined
            ? String(body.codigo_balanca).replace(/\D/g, '').slice(0, 6)
            : atual?.codigoBalanca || (prod.codigo || '').replace(/\D/g, '').slice(-5)

        let id = atual?.id || uuidv7()
        if (atual) {
          await tx
            .update(varejoEstoque)
            .set({
              unidadeVenda: unidade,
              saldoQtd: toDec(saldoNovo, 3),
              precoVendaVarejo: toDec(preco, 4),
              estoqueMinimo: toDec(estMin, 3),
              codigoBalanca: codBal,
              setorLoja: setor,
              updatedAt: new Date(),
            })
            .where(eq(varejoEstoque.id, atual.id))
        } else {
          await tx.insert(varejoEstoque).values({
            id,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: prodId,
            unidadeVenda: unidade,
            saldoQtd: toDec(saldoNovo, 3),
            precoVendaVarejo: toDec(preco, 4),
            estoqueMinimo: toDec(estMin, 3),
            codigoBalanca: codBal,
            setorLoja: setor,
          })
        }

        if (delta !== 0) {
          await tx.insert(varejoMovimentacoes).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: prodId,
            tipo: tipoMov,
            qtd: toDec(delta, 3),
            saldoAnterior: toDec(saldoAnt, 3),
            saldoNovo: toDec(saldoNovo, 3),
            referenciaTipo: 'MANUAL',
            observacao: String(body.observacao || '').trim() || `Ajuste ${tipoMov}`,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }

        return { id, produto_id: prodId, saldo_anterior: saldoAnt, saldo_novo: saldoNovo, preco_venda_varejo: preco, codigo_balanca: codBal }
      })

      return { success: true, data: out }
    },
  )

  // ── CARGA INICIAL / AJUSTE MANUAL DE EMPÓRIO (PROTEGIDO POR PIN + PARÂMETRO + AUDITORIA) ─
  app.post(
    '/api/varejo/emporio/entrada',
    { preHandler: requirePermission(['varejo_acougue', 'produtos', 'recebimento']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        produto_id?: string
        ean_ou_codigo?: string
        qtd_volumes?: number
        fator_conversao?: number
        unidade_venda?: string
        custo_unitario?: number
        preco_venda?: number
        estoque_minimo?: number
        observacao?: string
        motivo?: string
        tipo_operacao?: string // CARGA_INICIAL | AJUSTE_ENTRADA | AJUSTE_SAIDA
        pin?: string
      }

      const features = await lerTenantFeatures(conn.db, ctx.tenantId)
      if (features.permitir_carga_inicial_emporio === false) {
        throw new HttpError(
          403,
          'Carga Inicial e ajustes manuais no Empório estão desativados em Parâmetros Comerciais. Utilize Entrada Fiscal (XML NF-e) ou Inventário.',
        )
      }

      const autorizador = await validarPinGerencial(conn.db, ctx.tenantId, String(body.pin || ''))

      const motivoLimpo = String(body.motivo || body.observacao || '').trim()
      if (motivoLimpo.length < 3) {
        throw new HttpError(400, 'Informe o motivo obrigatório para esta movimentação manual no Empório.')
      }

      const tipoOp = String(body.tipo_operacao || 'CARGA_INICIAL').toUpperCase()
      const qtdVolumes = Number(body.qtd_volumes || 0)
      if (!Number.isFinite(qtdVolumes) || qtdVolumes <= 0) {
        throw new HttpError(400, 'Informe uma quantidade maior que zero.')
      }

      let prod: typeof produtos.$inferSelect | undefined
      if (body.produto_id) {
        const pid = parseUuidOrBadRequest(body.produto_id, 'produto_id')
        ;[prod] = await conn.db
          .select()
          .from(produtos)
          .where(and(eq(produtos.id, pid), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
      } else if (body.ean_ou_codigo) {
        const raw = String(body.ean_ou_codigo).trim()
        const rawLow = raw.toLowerCase()
        const allProds = await conn.db
          .select()
          .from(produtos)
          .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.ativo, 1)))
        prod = allProds.find(
          (p) =>
            String(p.ean || '').toLowerCase() === rawLow ||
            String(p.codigo || '').toLowerCase() === rawLow ||
            String(p.codigoAuxiliar || '').toLowerCase() === rawLow,
        )
        if (!prod) {
          const [alt] = await conn.db
            .select({ produtoId: produtosEans.produtoId })
            .from(produtosEans)
            .where(and(eq(produtosEans.tenantId, ctx.tenantId), sql`LOWER(${produtosEans.codigoBarras}) = ${rawLow}`))
            .limit(1)
          if (alt) prod = allProds.find((p) => p.id === alt.produtoId)
        }
      }
      if (!prod) {
        throw new HttpError(404, 'Produto não encontrado pelo EAN/código informado. Cadastre o produto primeiro.')
      }

      const fatorDefault = Math.max(1, toNum(prod.fatorConversaoCompra, 1))
      const fator =
        body.fator_conversao !== undefined && Number(body.fator_conversao) > 0
          ? Number(body.fator_conversao)
          : fatorDefault
      const qtdTotal = Number((qtdVolumes * fator).toFixed(3))
      const ehSaida = tipoOp === 'AJUSTE_SAIDA'
      const deltaAssinado = ehSaida ? -qtdTotal : qtdTotal

      const out = await conn.db.transaction(async (tx) => {
        const [atual] = await tx
          .select()
          .from(varejoEstoque)
          .where(
            and(
              eq(varejoEstoque.tenantId, ctx.tenantId),
              eq(varejoEstoque.filialId, ctx.filialId),
              eq(varejoEstoque.produtoId, prod!.id),
            ),
          )
          .limit(1)

        const saldoAnt = atual ? toNum(atual.saldoQtd, 0) : 0
        const saldoNovo = Number(Math.max(0, saldoAnt + deltaAssinado).toFixed(3))
        const unidade = String(body.unidade_venda || atual?.unidadeVenda || (prod!.unidade === 'KG' ? 'KG' : 'UN')).toUpperCase() === 'KG' ? 'KG' : 'UN'
        const precoVenda =
          body.preco_venda !== undefined && Number(body.preco_venda) > 0
            ? Number(body.preco_venda)
            : atual
              ? toNum(atual.precoVendaVarejo, 0)
              : toNum(prod!.valorUnitario, 0)
        const estMin =
          body.estoque_minimo !== undefined && Number.isFinite(Number(body.estoque_minimo))
            ? Math.max(0, Number(body.estoque_minimo))
            : atual
              ? toNum(atual.estoqueMinimo, 0)
              : 0

        if (atual) {
          await tx
            .update(varejoEstoque)
            .set({
              unidadeVenda: unidade,
              saldoQtd: toDec(saldoNovo, 3),
              precoVendaVarejo: toDec(precoVenda, 4),
              estoqueMinimo: toDec(estMin, 3),
              setorLoja: 'EMPORIO',
              updatedAt: new Date(),
            })
            .where(eq(varejoEstoque.id, atual.id))
        } else {
          await tx.insert(varejoEstoque).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: prod!.id,
            unidadeVenda: unidade,
            saldoQtd: toDec(saldoNovo, 3),
            precoVendaVarejo: toDec(precoVenda, 4),
            estoqueMinimo: toDec(estMin, 3),
            codigoBalanca: (prod!.codigo || '').replace(/\D/g, '').slice(-5),
            setorLoja: 'EMPORIO',
          })
        }

        // Atualiza último preço de compra / custo se informado
        if (body.custo_unitario !== undefined && Number(body.custo_unitario) > 0) {
          const custoUn = Number(body.custo_unitario)
          const prodPatch: Partial<typeof produtos.$inferInsert> = {
            ultimoPrecoCompra: toDec(custoUn, 4),
            updatedAt: new Date(),
          }
          if (toNum(prod!.custoMedioKg, 0) <= 0) {
            prodPatch.custoMedioKg = toDec(custoUn, 4)
          }
          if (!prod!.especie) prodPatch.especie = 'EMPORIO'
          await tx.update(produtos).set(prodPatch).where(eq(produtos.id, prod!.id))
        }

        // Se informou preço de venda > 0, vincula na tabela de preços padrão do varejo se ainda não existir
        if (precoVenda > 0) {
          const [tabPadrao] = await tx
            .select({ id: tabelasPreco.id })
            .from(tabelasPreco)
            .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.ativo, 1)))
            .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.codigo))
            .limit(1)
          if (tabPadrao) {
            const [itemExist] = await tx
              .select({ id: tabelasPrecoItens.id })
              .from(tabelasPrecoItens)
              .where(and(eq(tabelasPrecoItens.tabelaPrecoId, tabPadrao.id), eq(tabelasPrecoItens.produtoId, prod!.id)))
              .limit(1)
            if (itemExist) {
              if (body.preco_venda !== undefined && Number(body.preco_venda) > 0) {
                await tx
                  .update(tabelasPrecoItens)
                  .set({ precoVenda: toDec(precoVenda, 4), updatedAt: new Date() })
                  .where(eq(tabelasPrecoItens.id, itemExist.id))
              }
            } else {
              await tx.insert(tabelasPrecoItens).values({
                id: uuidv7(),
                tenantId: ctx.tenantId,
                tabelaPrecoId: tabPadrao.id,
                produtoId: prod!.id,
                precoVenda: toDec(precoVenda, 4),
                descontoPct: '0.00',
              })
            }
          }
        }

        await tx.insert(varejoMovimentacoes).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          produtoId: prod!.id,
          tipo: ehSaida ? 'AJUSTE_SAIDA_EMPORIO' : tipoOp === 'CARGA_INICIAL' ? 'CARGA_INICIAL_EMPORIO' : 'AJUSTE_ENTRADA_EMPORIO',
          qtd: toDec(deltaAssinado, 3),
          saldoAnterior: toDec(saldoAnt, 3),
          saldoNovo: toDec(saldoNovo, 3),
          referenciaTipo: 'EMPORIO_MANUAL_PIN',
          observacao: `[${tipoOp} • Aut: ${autorizador.nome}] ${motivoLimpo} (${qtdVolumes} vol × ${fator} = ${ehSaida ? '-' : '+'}${qtdTotal} ${unidade})`,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        await tx.insert(auditoriaAcessos).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          targetUserId: autorizador.id,
          targetUserNome: autorizador.nome,
          acao: tipoOp === 'CARGA_INICIAL' ? 'CARGA_INICIAL_EMPORIO' : 'AJUSTE_MANUAL_EMPORIO',
          detalhesAntes: { produto: prod!.descricao, saldo_anterior: saldoAnt },
          detalhesDepois: {
            produto: prod!.descricao,
            qtd: deltaAssinado,
            saldo_novo: saldoNovo,
            motivo: motivoLimpo,
          },
          executorId: ctx.operador.id,
          executorNome: ctx.operador.nome,
        })

        return {
          produto_id: prod!.id,
          produto_codigo: prod!.codigo || '',
          produto_ean: prod!.ean || '',
          produto_descricao: prod!.descricao,
          unidade_venda: unidade,
          qtd_entrada: qtdTotal,
          saldo_anterior: saldoAnt,
          saldo_novo: saldoNovo,
          preco_venda: precoVenda,
          autorizado_por: autorizador.nome,
          endereco: 'EMPORIO',
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  app.get(
    '/api/varejo/movimentacoes',
    { preHandler: requirePermission(PERM_VAREJO, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select({
          id: varejoMovimentacoes.id,
          tipo: varejoMovimentacoes.tipo,
          qtd: varejoMovimentacoes.qtd,
          saldo_anterior: varejoMovimentacoes.saldoAnterior,
          saldo_novo: varejoMovimentacoes.saldoNovo,
          observacao: varejoMovimentacoes.observacao,
          operador_nome: varejoMovimentacoes.operadorNome,
          created_at: varejoMovimentacoes.createdAt,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
        })
        .from(varejoMovimentacoes)
        .innerJoin(produtos, eq(produtos.id, varejoMovimentacoes.produtoId))
        .where(and(eq(varejoMovimentacoes.tenantId, ctx.tenantId), eq(varejoMovimentacoes.filialId, ctx.filialId)))
        .orderBy(desc(varejoMovimentacoes.createdAt))
        .limit(200)

      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          qtd: toNum(r.qtd, 0),
          saldo_anterior: toNum(r.saldo_anterior, 0),
          saldo_novo: toNum(r.saldo_novo, 0),
        })),
      }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. INVENTÁRIO VAREJO & AÇOUGUE (EMPÓRIO CONTAGEM ÀS CEGAS + AÇOUGUE BIPADO)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/varejo/inventarios',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_gestao', 'inventario_coletor'], { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { tipo?: string; apenas_liberados?: string }
      const rows = await conn.db
        .select()
        .from(varejoInventarios)
        .where(and(eq(varejoInventarios.tenantId, ctx.tenantId), eq(varejoInventarios.filialId, ctx.filialId)))
        .orderBy(desc(varejoInventarios.createdAt))
        .limit(60)

      const tipoFiltro = String(q.tipo || '').toUpperCase()
      const soLiberados = q.apenas_liberados === '1' || q.apenas_liberados === 'true'

      const data = rows
        .filter((r) => {
          if (tipoFiltro && String(r.tipoInventario || 'EMPORIO_CEGO').toUpperCase() !== tipoFiltro) return false
          if (soLiberados && (r.status !== 'ABERTO' || Number(r.liberadoOperador || 0) !== 1)) return false
          return true
        })
        .map((r) => ({
          ...r,
          tipo_inventario: r.tipoInventario || 'EMPORIO_CEGO',
          liberado_operador: Number(r.liberadoOperador ?? 1) === 1,
          total_itens: Number(r.totalItens || 0),
          total_divergencias: Number(r.totalDivergencias || 0),
          itens_json: r.itensJson || [],
          etiquetas_bipadas_json: r.etiquetasBipadasJson || [],
          mps_pesadas_json: r.mpsPesadasJson || [],
          operador_nome: r.operadorNome || '',
          created_at: r.createdAt,
          concluido_em: r.concluidoEm,
        }))

      return { success: true, data }
    },
  )

  app.post(
    '/api/varejo/inventarios',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_gestao']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        titulo?: string
        setor?: string
        tipo_inventario?: string // EMPORIO_CEGO | ACOUGUE_BIPADO
        liberado_operador?: boolean
      }

      const tipoInv =
        String(body.tipo_inventario || 'EMPORIO_CEGO').toUpperCase() === 'ACOUGUE_BIPADO'
          ? 'ACOUGUE_BIPADO'
          : 'EMPORIO_CEGO'
      const liberado = body.liberado_operador === false ? 0 : 1

      const id = uuidv7()
      const codigo = await gerarCodigoDocumento(conn.db, ctx.tenantId, 'VAREJO_INV', 'INVL', 4)

      if (tipoInv === 'ACOUGUE_BIPADO') {
        const [etqsAtivas, mpsAtivas] = await Promise.all([
          conn.db
            .select()
            .from(etiquetasAcougue)
            .where(
              and(
                eq(etiquetasAcougue.tenantId, ctx.tenantId),
                eq(etiquetasAcougue.filialId, ctx.filialId),
                eq(etiquetasAcougue.status, 'EM_ESTOQUE'),
              ),
            )
            .orderBy(asc(etiquetasAcougue.codigoEtiqueta)),
          conn.db
            .select({
              caixa_id: estoqueCaixas.id,
              ean_caixa: estoqueCaixas.eanCaixa,
              produto_id: estoqueCaixas.produtoId,
              produto_codigo: produtos.codigo,
              produto_descricao: produtos.descricao,
              lote: estoqueCaixas.lote,
              validade: estoqueCaixas.validade,
              status: estoqueCaixas.status,
              peso_kg: estoqueCaixas.pesoKg,
              peso_restante_kg: estoqueCaixas.pesoRestanteKg,
            })
            .from(estoqueCaixas)
            .innerJoin(produtos, eq(produtos.id, estoqueCaixas.produtoId))
            .where(
              and(
                eq(estoqueCaixas.tenantId, ctx.tenantId),
                eq(estoqueCaixas.filialId, ctx.filialId),
                inArray(estoqueCaixas.status, ['ABERTA_ACOUGUE', 'EM_TRANSITO_LOJA']),
              ),
            )
            .orderBy(asc(produtos.descricao)),
        ])

        const itensEtq = etqsAtivas.map((e) => ({
          etiqueta_id: e.id,
          codigo_etiqueta: e.codigoEtiqueta,
          produto_id: e.produtoId,
          produto_codigo: e.produtoCodigo || '',
          produto_descricao: e.produtoDescricao,
          especie: e.especie || 'OUTROS',
          peso_liquido_kg: toNum(e.pesoLiquidoKg, 0),
          valor_total: toNum(e.valorTotal, 0),
          lote: e.lote || '',
          validade: e.validade || '',
          status_sistema: e.status,
        }))

        const mpsList = mpsAtivas.map((m) => {
          const sisKg = m.peso_restante_kg != null ? toNum(m.peso_restante_kg, 0) : toNum(m.peso_kg, 0)
          return {
            caixa_id: m.caixa_id,
            ean_caixa: m.ean_caixa,
            produto_id: m.produto_id,
            produto_codigo: m.produto_codigo || '',
            produto_descricao: m.produto_descricao,
            lote: m.lote || '',
            validade: m.validade || '',
            status_mp: m.status,
            peso_original_kg: toNum(m.peso_kg, 0),
            peso_sistema_kg: sisKg,
            peso_medido_kg: null,
            divergencia_kg: 0,
            pesada: false,
          }
        })

        const titulo = String(body.titulo || '').trim() || `Inventário Açougue ${hojeIsoLocal()}`
        await conn.db.insert(varejoInventarios).values({
          id,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          titulo,
          tipoInventario: 'ACOUGUE_BIPADO',
          liberadoOperador: liberado,
          status: 'ABERTO',
          totalItens: itensEtq.length + mpsList.length,
          totalDivergencias: 0,
          itensJson: itensEtq,
          etiquetasBipadasJson: [],
          mpsPesadasJson: mpsList,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        return reply.code(201).send({
          success: true,
          data: {
            id,
            codigo,
            titulo,
            tipo_inventario: 'ACOUGUE_BIPADO',
            liberado_operador: liberado === 1,
            status: 'ABERTO',
            total_itens: itensEtq.length + mpsList.length,
            itens_json: itensEtq,
            etiquetas_bipadas_json: [],
            mps_pesadas_json: mpsList,
          },
        })
      }

      // EMPORIO_CEGO (ou TODOS quando explicitado)
      const estoqueAtual = await conn.db
        .select({
          produto_id: varejoEstoque.produtoId,
          unidade_venda: varejoEstoque.unidadeVenda,
          saldo_qtd: varejoEstoque.saldoQtd,
          setor_loja: varejoEstoque.setorLoja,
          codigo_balanca: varejoEstoque.codigoBalanca,
          produto_codigo: produtos.codigo,
          produto_descricao: produtos.descricao,
          produto_ean: produtos.ean,
        })
        .from(varejoEstoque)
        .innerJoin(produtos, eq(produtos.id, varejoEstoque.produtoId))
        .where(and(eq(varejoEstoque.tenantId, ctx.tenantId), eq(varejoEstoque.filialId, ctx.filialId)))
        .orderBy(produtos.descricao)

      const setorFiltro = String(body.setor || 'TODOS').toUpperCase()
      const itens = estoqueAtual
        .filter((e) => setorFiltro === 'TODOS' || e.setor_loja === setorFiltro)
        .map((e) => ({
          produto_id: e.produto_id,
          produto_codigo: e.produto_codigo || '',
          produto_ean: e.produto_ean || '',
          codigo_balanca: e.codigo_balanca || '',
          produto_descricao: e.produto_descricao,
          unidade_venda: e.unidade_venda,
          setor_loja: e.setor_loja,
          saldo_sistema: toNum(e.saldo_qtd, 0),
          qtd_contada: body.tipo_inventario === 'EMPORIO_CEGO' ? null : toNum(e.saldo_qtd, 0),
          divergencia: 0,
        }))

      const titulo =
        String(body.titulo || '').trim() ||
        `${setorFiltro === 'EMPORIO' ? 'Inventário Empório (Cego)' : 'Inventário Varejo'} ${hojeIsoLocal()}`

      await conn.db.insert(varejoInventarios).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        titulo,
        tipoInventario: 'EMPORIO_CEGO',
        liberadoOperador: liberado,
        status: 'ABERTO',
        totalItens: itens.length,
        totalDivergencias: 0,
        itensJson: itens,
        etiquetasBipadasJson: [],
        mpsPesadasJson: [],
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      return reply.code(201).send({
        success: true,
        data: {
          id,
          codigo,
          titulo,
          tipo_inventario: 'EMPORIO_CEGO',
          liberado_operador: liberado === 1,
          status: 'ABERTO',
          total_itens: itens.length,
          itens_json: itens,
          etiquetas_bipadas_json: [],
          mps_pesadas_json: [],
        },
      })
    },
  )

  app.put(
    '/api/varejo/inventarios/:id/liberar',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_gestao']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const body = (req.body || {}) as { liberado_operador?: boolean }

      const [inv] = await conn.db
        .select()
        .from(varejoInventarios)
        .where(and(eq(varejoInventarios.id, id), eq(varejoInventarios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!inv) throw new HttpError(404, 'Inventário não encontrado.')
      if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi concluído.')

      const novoVal = body.liberado_operador === false ? 0 : 1
      await conn.db
        .update(varejoInventarios)
        .set({ liberadoOperador: novoVal })
        .where(eq(varejoInventarios.id, id))

      return { success: true, liberado_operador: novoVal === 1 }
    },
  )

  app.put(
    '/api/varejo/inventarios/:id/contagem',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_gestao', 'inventario_coletor']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')
      const body = (req.body || {}) as {
        itens?: Array<{ produto_id: string; qtd_contada: number | null }>
      }

      const [inv] = await conn.db
        .select()
        .from(varejoInventarios)
        .where(and(eq(varejoInventarios.id, id), eq(varejoInventarios.tenantId, ctx.tenantId)))
        .limit(1)
      if (!inv) throw new HttpError(404, 'Inventário não encontrado.')
      if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi concluído.')

      const updates = new Map((body.itens || []).map((i) => [String(i.produto_id), i.qtd_contada]))
      const itensNovos = (inv.itensJson || []).map((it: any) => {
        const hasUpd = updates.has(String(it.produto_id))
        const rawVal = hasUpd ? updates.get(String(it.produto_id)) : it.qtd_contada
        if (rawVal === null || rawVal === undefined || rawVal === '') {
          return { ...it, qtd_contada: null, divergencia: 0 }
        }
        const contada = Math.max(0, Number(rawVal || 0))
        const sis = Number(it.saldo_sistema || 0)
        const div = Number((contada - sis).toFixed(3))
        return { ...it, qtd_contada: Number(contada.toFixed(3)), divergencia: div }
      })
      const totalDiv = itensNovos.filter((i: any) => i.qtd_contada !== null && Math.abs(i.divergencia) > 0.0005).length

      await conn.db
        .update(varejoInventarios)
        .set({ itensJson: itensNovos, totalDivergencias: totalDiv })
        .where(eq(varejoInventarios.id, id))

      return { success: true, total_divergencias: totalDiv, itens_json: itensNovos }
    },
  )

  app.post(
    '/api/varejo/inventarios/:id/finalizar',
    { preHandler: requirePermission(['varejo_acougue', 'inventario_gestao']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'inventario_id')

      const res = await conn.db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(varejoInventarios)
          .where(and(eq(varejoInventarios.id, id), eq(varejoInventarios.tenantId, ctx.tenantId)))
          .limit(1)
        if (!inv) throw new HttpError(404, 'Inventário não encontrado.')
        if (inv.status !== 'ABERTO') throw new HttpError(409, 'Este inventário já foi concluído.')

        if (inv.tipoInventario === 'ACOUGUE_BIPADO') {
          let divergencias = 0
          const esperadas = (inv.itensJson || []) as any[]
          const bipadas = (inv.etiquetasBipadasJson || []) as any[]
          const setBipadas = new Set(bipadas.map((b) => String(b.codigo_etiqueta || '').toUpperCase()))

          let etiquetasPerdidas = 0
          for (const esp of esperadas) {
            const cod = String(esp.codigo_etiqueta || '').toUpperCase()
            if (!setBipadas.has(cod)) {
              await tx
                .update(etiquetasAcougue)
                .set({ status: 'PERDA_INVENTARIO' })
                .where(
                  and(
                    eq(etiquetasAcougue.id, esp.etiqueta_id),
                    eq(etiquetasAcougue.status, 'EM_ESTOQUE'),
                  ),
                )
              etiquetasPerdidas += 1
              divergencias += 1
            }
          }

          let mpsAjustadas = 0
          for (const mp of (inv.mpsPesadasJson || []) as any[]) {
            if (!mp.pesada || mp.peso_medido_kg === null || mp.peso_medido_kg === undefined) continue
            const medido = Math.max(0, Number(mp.peso_medido_kg))
            const diff = Number((medido - Number(mp.peso_sistema_kg || 0)).toFixed(3))
            const novoStatus = medido <= 0.005 ? 'CONSUMIDA_ACOUGUE' : 'ABERTA_ACOUGUE'
            await tx
              .update(estoqueCaixas)
              .set({
                pesoRestanteKg: toDec(medido, 3),
                status: novoStatus,
                updatedAt: new Date(),
              })
              .where(eq(estoqueCaixas.id, mp.caixa_id))
            if (Math.abs(diff) > 0.005) {
              mpsAjustadas += 1
              divergencias += 1
            }
          }

          await tx
            .update(varejoInventarios)
            .set({ status: 'CONCLUIDO', concluidoEm: new Date(), totalDivergencias: divergencias })
            .where(eq(varejoInventarios.id, id))

          return {
            codigo: inv.codigo,
            tipo_inventario: 'ACOUGUE_BIPADO',
            ajustados: divergencias,
            etiquetas_perdidas: etiquetasPerdidas,
            mps_ajustadas: mpsAjustadas,
          }
        }

        let ajustados = 0
        for (const it of inv.itensJson as any[]) {
          if (it.qtd_contada === null || it.qtd_contada === undefined) continue
          const contada = Number(it.qtd_contada || 0)
          const [est] = await tx
            .select()
            .from(varejoEstoque)
            .where(
              and(
                eq(varejoEstoque.tenantId, ctx.tenantId),
                eq(varejoEstoque.filialId, inv.filialId),
                eq(varejoEstoque.produtoId, it.produto_id),
              ),
            )
            .limit(1)
          if (!est) continue
          const saldoAnt = toNum(est.saldoQtd, 0)
          const diff = Number((contada - saldoAnt).toFixed(3))
          if (Math.abs(diff) > 0.0005) {
            await tx
              .update(varejoEstoque)
              .set({ saldoQtd: toDec(contada, 3), updatedAt: new Date() })
              .where(eq(varejoEstoque.id, est.id))

            await tx.insert(varejoMovimentacoes).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              filialId: inv.filialId,
              produtoId: it.produto_id,
              tipo: 'INVENTARIO_AJUSTE',
              qtd: toDec(diff, 3),
              saldoAnterior: toDec(saldoAnt, 3),
              saldoNovo: toDec(contada, 3),
              referenciaTipo: 'VAREJO_INVENTARIO',
              referenciaId: inv.id,
              observacao: `Conciliação ${inv.codigo} (${diff > 0 ? 'Sobra' : 'Quebra/Perda'})`,
              operadorId: ctx.operador.id,
              operadorNome: ctx.operador.nome,
            })
            ajustados += 1
          }
        }

        await tx
          .update(varejoInventarios)
          .set({ status: 'CONCLUIDO', concluidoEm: new Date(), totalDivergencias: ajustados })
          .where(eq(varejoInventarios.id, id))

        return { codigo: inv.codigo, tipo_inventario: 'EMPORIO_CEGO', ajustados }
      })

      return { success: true, ...res }
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PDV FRENTE DE CAIXA (TURNO, PIX BR CODE, DESCONTO, CREDIÁRIO, NFC-e)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get(
    '/api/pdv/caixa-atual',
    { preHandler: requirePermission(PERM_PDV, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const [aberto] = await conn.db
        .select()
        .from(pdvCaixas)
        .where(
          and(
            eq(pdvCaixas.tenantId, ctx.tenantId),
            eq(pdvCaixas.filialId, ctx.filialId),
            eq(pdvCaixas.status, 'ABERTO'),
          ),
        )
        .orderBy(desc(pdvCaixas.abertoEm))
        .limit(1)

      const contas = await conn.db
        .select()
        .from(financeiroContasBancarias)
        .where(and(eq(financeiroContasBancarias.tenantId, ctx.tenantId), eq(financeiroContasBancarias.ativo, 1)))

      if (!aberto) {
        return { success: true, caixa: null, movimentos: [], vendas_turno: [], contas_bancarias: contas }
      }

      const [movs, vendas] = await Promise.all([
        conn.db
          .select()
          .from(pdvCaixaMovimentos)
          .where(eq(pdvCaixaMovimentos.caixaId, aberto.id))
          .orderBy(desc(pdvCaixaMovimentos.createdAt)),
        conn.db
          .select()
          .from(pdvVendas)
          .where(eq(pdvVendas.caixaId, aberto.id))
          .orderBy(desc(pdvVendas.createdAt))
          .limit(100),
      ])

      return {
        success: true,
        caixa: {
          ...aberto,
          operador_nome: aberto.operadorNome || '',
          conta_bancaria_id: aberto.contaBancariaId,
          aberto_em: aberto.abertoEm,
          fechado_em: aberto.fechadoEm,
          saldo_abertura: toNum(aberto.saldoAbertura, 0),
          total_vendas: toNum(aberto.totalVendas, 0),
          total_dinheiro: toNum(aberto.totalDinheiro, 0),
          total_pix: toNum(aberto.totalPix, 0),
          total_debito: toNum(aberto.totalDebito, 0),
          total_credito: toNum(aberto.totalCredito, 0),
          total_crediario: toNum(aberto.totalCrediario, 0),
          total_suprimentos: toNum(aberto.totalSuprimentos, 0),
          total_sangrias: toNum(aberto.totalSangrias, 0),
          saldo_esperado_dinheiro: toNum(aberto.saldoEsperadoDinheiro, 0),
        },
        movimentos: movs.map((m) => ({
          ...m,
          operador_nome: m.operadorNome || '',
          created_at: m.createdAt,
          valor: toNum(m.valor, 0),
        })),
        vendas_turno: vendas.map((v) => ({
          ...v,
          cliente_id: v.clienteId,
          cliente_nome: v.clienteNome,
          cliente_doc: v.clienteDoc,
          operador_nome: v.operadorNome || '',
          numero_nfce: v.numeroNfce,
          nota_fiscal_id: v.notaFiscalId,
          pagamentos_json: v.pagamentosJson || [],
          itens_json: v.itensJson || [],
          desconto_tipo: v.descontoTipo || 'VALOR',
          desconto_pct: toNum(v.descontoPct, 0),
          subtotal: toNum(v.subtotal, 0),
          desconto_valor: toNum(v.descontoValor, 0),
          valor_total: toNum(v.valorTotal, 0),
          troco_valor: toNum(v.trocoValor, 0),
          crediario_valor: toNum(v.crediarioValor, 0),
          vencimento_crediario: v.vencimentoCrediario,
          created_at: v.createdAt,
        })),
        contas_bancarias: contas,
      }
    },
  )

  app.get(
    '/api/pdv/caixas',
    { preHandler: requirePermission(PERM_PDV, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const rows = await conn.db
        .select()
        .from(pdvCaixas)
        .where(and(eq(pdvCaixas.tenantId, ctx.tenantId), eq(pdvCaixas.filialId, ctx.filialId)))
        .orderBy(desc(pdvCaixas.abertoEm))
        .limit(40)
      return {
        success: true,
        data: rows.map((r) => ({
          ...r,
          operador_nome: r.operadorNome || '',
          aberto_em: r.abertoEm,
          fechado_em: r.fechadoEm,
          saldo_abertura: toNum(r.saldoAbertura, 0),
          total_vendas: toNum(r.totalVendas, 0),
          total_dinheiro: toNum(r.totalDinheiro, 0),
          total_pix: toNum(r.totalPix, 0),
          total_debito: toNum(r.totalDebito, 0),
          total_credito: toNum(r.totalCredito, 0),
          total_crediario: toNum(r.totalCrediario, 0),
          saldo_esperado_dinheiro: toNum(r.saldoEsperadoDinheiro, 0),
          saldo_informado_fechamento: r.saldoInformadoFechamento != null ? toNum(r.saldoInformadoFechamento, 0) : null,
          diferenca_quebra: r.diferencaQuebra != null ? toNum(r.diferencaQuebra, 0) : null,
        })),
      }
    },
  )

  app.post(
    '/api/pdv/caixa/abrir',
    { preHandler: requirePermission(PERM_PDV) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        saldo_abertura?: number
        conta_bancaria_id?: string
        observacoes?: string
      }

      const [jaAberto] = await conn.db
        .select({ id: pdvCaixas.id, codigo: pdvCaixas.codigo })
        .from(pdvCaixas)
        .where(
          and(
            eq(pdvCaixas.tenantId, ctx.tenantId),
            eq(pdvCaixas.filialId, ctx.filialId),
            eq(pdvCaixas.status, 'ABERTO'),
          ),
        )
        .limit(1)
      if (jaAberto) {
        throw new HttpError(409, `Já existe um caixa aberto nesta filial (${jaAberto.codigo}). Feche-o antes de abrir novo turno.`)
      }

      let contaId = body.conta_bancaria_id ? parseUuidOrBadRequest(body.conta_bancaria_id, 'conta_bancaria_id') : null
      if (!contaId) {
        const [cxPadrao] = await conn.db
          .select({ id: financeiroContasBancarias.id })
          .from(financeiroContasBancarias)
          .where(and(eq(financeiroContasBancarias.tenantId, ctx.tenantId), eq(financeiroContasBancarias.ativo, 1)))
          .orderBy(desc(financeiroContasBancarias.padrao))
          .limit(1)
        contaId = cxPadrao?.id || null
      }

      const saldoIni = Math.max(0, Number(body.saldo_abertura || 0))
      const id = uuidv7()
      const codigo = await gerarCodigoDocumento(conn.db, ctx.tenantId, 'PDV_CAIXA', 'CXPDV', 4)

      await conn.db.insert(pdvCaixas).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        codigo,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
        contaBancariaId: contaId,
        status: 'ABERTO',
        saldoAbertura: toDec(saldoIni, 2),
        saldoEsperadoDinheiro: toDec(saldoIni, 2),
        observacoes: String(body.observacoes || '').trim(),
      })

      return reply.code(201).send({
        success: true,
        data: { id, codigo, status: 'ABERTO', saldo_abertura: saldoIni, saldo_esperado_dinheiro: saldoIni },
      })
    },
  )

  app.post(
    '/api/pdv/caixa/:id/movimento',
    { preHandler: requirePermission(PERM_PDV) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const caixaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'caixa_id')
      const body = (req.body || {}) as { tipo?: string; valor?: number; motivo?: string }
      const tipo = String(body.tipo || '').toUpperCase()
      if (tipo !== 'SANGRIA' && tipo !== 'SUPRIMENTO') {
        throw new HttpError(400, 'Tipo de movimento deve ser SANGRIA ou SUPRIMENTO.')
      }
      const valor = Number(body.valor || 0)
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new HttpError(400, 'Informe um valor maior que zero.')
      }

      const out = await conn.db.transaction(async (tx) => {
        const [cx] = await tx
          .select()
          .from(pdvCaixas)
          .where(and(eq(pdvCaixas.id, caixaId), eq(pdvCaixas.tenantId, ctx.tenantId)))
          .limit(1)
        if (!cx) throw new HttpError(404, 'Caixa PDV não encontrado.')
        if (cx.status !== 'ABERTO') throw new HttpError(409, 'Este caixa já está fechado.')

        const movId = uuidv7()
        await tx.insert(pdvCaixaMovimentos).values({
          id: movId,
          tenantId: ctx.tenantId,
          caixaId,
          tipo,
          valor: toDec(valor, 2),
          motivo: String(body.motivo || '').trim() || tipo,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        const sup = toNum(cx.totalSuprimentos, 0) + (tipo === 'SUPRIMENTO' ? valor : 0)
        const san = toNum(cx.totalSangrias, 0) + (tipo === 'SANGRIA' ? valor : 0)
        const esp = Number(
          (toNum(cx.saldoAbertura, 0) + toNum(cx.totalDinheiro, 0) + sup - san).toFixed(2),
        )

        await tx
          .update(pdvCaixas)
          .set({
            totalSuprimentos: toDec(sup, 2),
            totalSangrias: toDec(san, 2),
            saldoEsperadoDinheiro: toDec(esp, 2),
          })
          .where(eq(pdvCaixas.id, caixaId))

        return { id: movId, tipo, valor, saldo_esperado_dinheiro: esp }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  app.post(
    '/api/pdv/caixa/:id/fechar',
    { preHandler: requirePermission(PERM_PDV) },
    async (req) => {
      const ctx = req.authCtx!
      const caixaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'caixa_id')
      const body = (req.body || {}) as { saldo_informado?: number; observacoes?: string }

      const [cx] = await conn.db
        .select()
        .from(pdvCaixas)
        .where(and(eq(pdvCaixas.id, caixaId), eq(pdvCaixas.tenantId, ctx.tenantId)))
        .limit(1)
      if (!cx) throw new HttpError(404, 'Caixa PDV não encontrado.')
      if (cx.status !== 'ABERTO') throw new HttpError(409, 'Este caixa já foi fechado.')

      const esperado = toNum(cx.saldoEsperadoDinheiro, 0)
      const informado =
        body.saldo_informado !== undefined && Number.isFinite(Number(body.saldo_informado))
          ? Number(body.saldo_informado)
          : esperado
      const diferenca = Number((informado - esperado).toFixed(2))

      await conn.db
        .update(pdvCaixas)
        .set({
          status: 'FECHADO',
          saldoInformadoFechamento: toDec(informado, 2),
          diferencaQuebra: toDec(diferenca, 2),
          observacoes: body.observacoes ? `${cx.observacoes ? `${cx.observacoes} | ` : ''}${body.observacoes}` : cx.observacoes,
          fechadoEm: new Date(),
        })
        .where(eq(pdvCaixas.id, caixaId))

      return {
        success: true,
        data: {
          id: caixaId,
          codigo: cx.codigo,
          status: 'FECHADO',
          saldo_esperado_dinheiro: esperado,
          saldo_informado_fechamento: informado,
          diferenca_quebra: diferenca,
        },
      }
    },
  )

  // ── GERADOR NATIVO DE PIX BR CODE (EMV/CRC16) PARA MODAL DE PAGAMENTO PDV ──
  app.post(
    '/api/pdv/gerar-pix',
    { preHandler: requirePermission(PERM_PDV, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as { valor?: number; descricao?: string; txid?: string }
      const valor = Number(body.valor || 0)
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new HttpError(400, 'Informe um valor maior que zero para gerar o QR Code PIX.')
      }

      const [contas, filRows, empRows] = await Promise.all([
        conn.db
          .select()
          .from(financeiroContasBancarias)
          .where(and(eq(financeiroContasBancarias.tenantId, ctx.tenantId), eq(financeiroContasBancarias.ativo, 1))),
        conn.db.select().from(filiais).where(eq(filiais.id, ctx.filialId)).limit(1),
        conn.db.select().from(empresas).where(eq(empresas.id, ctx.empresaId)).limit(1),
      ])

      const fil = filRows[0]
      const emp = empRows[0]
      const contaComPix =
        contas.find((c) => c.filialId === ctx.filialId && String(c.chavePix || '').trim().length > 0) ||
        contas.find((c) => Number(c.padrao) === 1 && String(c.chavePix || '').trim().length > 0) ||
        contas.find((c) => String(c.chavePix || '').trim().length > 0)

      const fallbackCnpj = onlyDigits(fil?.cnpj || emp?.cnpj || '54142043000130') || '54142043000130'
      const chavePix = contaComPix ? String(contaComPix.chavePix).trim() : fallbackCnpj
      const nomeRecebedor = emp?.nomeFantasia || emp?.razaoSocial || fil?.nome || 'VAREJO ACOUGUE'
      const cidade = fil?.cidade || 'SAO PAULO'
      const txid = body.txid || `PDV${String(Date.now()).slice(-10)}`

      const payload = gerarPixBrCode({
        chavePix,
        nomeRecebedor,
        cidadeRecebedor: cidade,
        valor,
        txid,
        descricao: body.descricao || 'Compra PDV',
      })

      return {
        success: true,
        data: {
          payload,
          chave_pix: chavePix,
          nome_recebedor: nomeRecebedor,
          cidade,
          valor: Number(valor.toFixed(2)),
          txid,
          conta_nome: contaComPix?.nome || 'CNPJ da Unidade (configure Chave PIX em Contas Bancárias)',
          usando_chave_fallback: !contaComPix,
        },
      }
    },
  )

  // ── CREDIÁRIO DO CLIENTE (EXTRATO + RECEBIMENTO / LIBERAÇÃO DE LIMITE) ─────
  app.get(
    '/api/pdv/crediario/cliente/:clienteId',
    { preHandler: requirePermission(PERM_PDV, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const clienteId = parseUuidOrBadRequest((req.params as { clienteId: string }).clienteId, 'cliente_id')
      const [cli] = await conn.db
        .select()
        .from(clientes)
        .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!cli) throw new HttpError(404, 'Cliente não encontrado.')

      const titulos = await conn.db
        .select()
        .from(financeiroTitulos)
        .where(
          and(
            eq(financeiroTitulos.tenantId, ctx.tenantId),
            eq(financeiroTitulos.clienteId, clienteId),
            eq(financeiroTitulos.tipo, 'RECEBER'),
            inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']),
          ),
        )
        .orderBy(asc(financeiroTitulos.dataVencimento), asc(financeiroTitulos.createdAt))

      const utilizado = Number(titulos.reduce((s, t) => s + toNum(t.saldoAberto, 0), 0).toFixed(2))
      const limite = toNum(cli.limiteCredito, 0)
      const disponivel = Math.max(0, Number((limite - utilizado).toFixed(2)))

      return {
        success: true,
        cliente: {
          id: cli.id,
          nome: nomeCliente(cli),
          razao_social: cli.razaoSocial,
          nome_fantasia: cli.nomeFantasia,
          cnpj_cpf: cli.cnpjCpf || '',
          rg: cli.rg || '',
          crediario_ativo: Number(cli.crediarioAtivo || 0) === 1,
          bloqueado_financeiro: Number(cli.bloqueadoFinanceiro || 0) === 1,
          limite_credito: limite,
          credito_utilizado: utilizado,
          credito_disponivel: disponivel,
          prazo_crediario_dias: Number(cli.prazoCrediarioDias || 30),
        },
        titulos: titulos.map((t) => ({
          id: t.id,
          codigo: t.codigo,
          origem: t.origem,
          descricao: t.descricao,
          numero_documento: t.numeroDocumento,
          data_emissao: t.dataEmissao,
          data_vencimento: t.dataVencimento,
          valor_original: toNum(t.valorOriginal, 0),
          valor_pago: toNum(t.valorPago, 0),
          saldo_aberto: toNum(t.saldoAberto, 0),
          status: t.status,
        })),
      }
    },
  )

  app.post(
    '/api/pdv/crediario/receber',
    { preHandler: requirePermission(PERM_PDV) },
    async (req) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        cliente_id?: string
        titulo_id?: string
        valor?: number
        forma_pagamento?: string
        conta_bancaria_id?: string
        observacoes?: string
      }
      const clienteId = parseUuidOrBadRequest(body.cliente_id, 'cliente_id')
      const valorReceber = Number(body.valor || 0)
      if (!Number.isFinite(valorReceber) || valorReceber <= 0) {
        throw new HttpError(400, 'Informe um valor maior que zero para receber do crediário.')
      }

      const out = await conn.db.transaction(async (tx) => {
        const [cli] = await tx
          .select()
          .from(clientes)
          .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, ctx.tenantId)))
          .limit(1)
        if (!cli) throw new HttpError(404, 'Cliente não encontrado.')

        const forma = String(body.forma_pagamento || 'DINHEIRO').toUpperCase()
        const contaId = body.conta_bancaria_id
          ? parseUuidOrBadRequest(body.conta_bancaria_id, 'conta_bancaria_id')
          : (await obterContaBancariaPadrao(tx, ctx.tenantId)).id
        const baixas: Array<Record<string, unknown>> = []

        if (body.titulo_id) {
          const tid = parseUuidOrBadRequest(body.titulo_id, 'titulo_id')
          const res = await baixarTitulo(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            tituloId: tid,
            valorPago: valorReceber,
            formaPagamento: forma,
            contaBancariaId: contaId,
            observacoes: body.observacoes || `Recebimento crediário balcão (${forma})`,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
          baixas.push(res)
        } else {
          const abertos = await tx
            .select()
            .from(financeiroTitulos)
            .where(
              and(
                eq(financeiroTitulos.tenantId, ctx.tenantId),
                eq(financeiroTitulos.clienteId, clienteId),
                eq(financeiroTitulos.tipo, 'RECEBER'),
                inArray(financeiroTitulos.status, ['ABERTO', 'PARCIAL']),
              ),
            )
            .orderBy(asc(financeiroTitulos.dataVencimento), asc(financeiroTitulos.createdAt))

          if (abertos.length === 0) {
            throw new HttpError(400, 'Este cliente não possui títulos em aberto no crediário.')
          }
          const totalAberto = Number(abertos.reduce((s, t) => s + toNum(t.saldoAberto, 0), 0).toFixed(2))
          if (valorReceber > totalAberto + 0.01) {
            throw new HttpError(
              400,
              `Valor informado (R$ ${valorReceber.toFixed(2)}) é superior ao saldo devedor total (R$ ${totalAberto.toFixed(2)}).`,
            )
          }

          let restante = valorReceber
          for (const tit of abertos) {
            if (restante <= 0.009) break
            const saldoTit = toNum(tit.saldoAberto, 0)
            const pagarAqui = Number(Math.min(restante, saldoTit).toFixed(2))
            if (pagarAqui <= 0) continue
            const res = await baixarTitulo(tx, {
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              tituloId: tit.id,
              valorPago: pagarAqui,
              formaPagamento: forma,
              contaBancariaId: contaId,
              observacoes: body.observacoes || `Recebimento crediário balcão (${forma})`,
              operadorId: ctx.operador.id,
              operadorNome: ctx.operador.nome,
            })
            baixas.push(res)
            restante = Number((restante - pagarAqui).toFixed(2))
          }
        }

        const resSaldo = await tx.execute(sql`
          SELECT COALESCE(SUM(saldo_aberto), 0) AS utilizado
          FROM financeiro_titulos
          WHERE tenant_id = ${ctx.tenantId}
            AND cliente_id = ${clienteId}
            AND tipo = 'RECEBER'
            AND status IN ('ABERTO', 'PARCIAL')
        `)
        const utilizadoPos = toNum((resSaldo.rows as Array<{ utilizado: string }>)[0]?.utilizado, 0)
        const limite = toNum(cli.limiteCredito, 0)
        const disponivelPos = Math.max(0, Number((limite - utilizadoPos).toFixed(2)))

        return {
          cliente_id: cli.id,
          cliente_nome: nomeCliente(cli),
          valor_recebido: Number(valorReceber.toFixed(2)),
          forma_pagamento: forma,
          baixas,
          limite_credito: limite,
          credito_utilizado: utilizadoPos,
          credito_disponivel: disponivelPos,
        }
      })

      return { success: true, data: out }
    },
  )

  // ── BUSCA & PARSER UNIVERSAL PDV (QR ZEBRA 80x45 | EAN-2 BALANÇA | EAN-13 | NOME) ──
  app.get(
    '/api/pdv/buscar-codigo',
    { preHandler: requirePermission(PERM_PDV, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const qObj = (req.query || {}) as { q?: string; cliente_id?: string }
      const raw = String(qObj.q || '').trim()
      if (!raw) return { success: true, origem: 'VAZIO', match_exato: null, sugestoes: [] }

      // Resolve Tabela de Preços do Cliente (se vinculado) ou Tabela Padrão Varejo/PDV
      let tabelaPrecoIdAlvo: string | null = null
      if (qObj.cliente_id) {
        const [cliRow] = await conn.db
          .select({ tabelaPrecoId: clientes.tabelaPrecoId })
          .from(clientes)
          .where(and(eq(clientes.id, parseUuidOrBadRequest(qObj.cliente_id, 'cliente_id')), eq(clientes.tenantId, ctx.tenantId)))
          .limit(1)
        if (cliRow?.tabelaPrecoId) tabelaPrecoIdAlvo = cliRow.tabelaPrecoId
      }
      if (!tabelaPrecoIdAlvo) {
        const tabs = await conn.db
          .select({ id: tabelasPreco.id, finalidade: tabelasPreco.finalidade, padrao: tabelasPreco.padrao })
          .from(tabelasPreco)
          .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.ativo, 1)))
          .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.codigo))
        const tabPdv =
          tabs.find((t) => Number(t.padrao) === 1 && t.finalidade === 'VAREJO_PDV') ||
          tabs.find((t) => Number(t.padrao) === 1) ||
          tabs[0]
        tabelaPrecoIdAlvo = tabPdv?.id || null
      }

      const [estLojaRows, prodsAll, eansAlt, tabItensRows] = await Promise.all([
        conn.db
          .select()
          .from(varejoEstoque)
          .where(and(eq(varejoEstoque.tenantId, ctx.tenantId), eq(varejoEstoque.filialId, ctx.filialId))),
        conn.db
          .select()
          .from(produtos)
          .where(and(eq(produtos.tenantId, ctx.tenantId), eq(produtos.ativo, 1))),
        conn.db
          .select()
          .from(produtosEans)
          .where(eq(produtosEans.tenantId, ctx.tenantId)),
        tabelaPrecoIdAlvo
          ? conn.db
              .select({ produtoId: tabelasPrecoItens.produtoId, precoVenda: tabelasPrecoItens.precoVenda })
              .from(tabelasPrecoItens)
              .where(eq(tabelasPrecoItens.tabelaPrecoId, tabelaPrecoIdAlvo))
          : Promise.resolve([]),
      ])

      const estMap = new Map(estLojaRows.map((e) => [e.produtoId, e]))
      const prodMap = new Map(prodsAll.map((p) => [p.id, p]))
      const tabPrecoMap = new Map<string, number>()
      for (const ti of tabItensRows) {
        const pv = toNum(ti.precoVenda, 0)
        if (pv > 0) tabPrecoMap.set(ti.produtoId, pv)
      }

      const montarItem = (
        p: typeof produtos.$inferSelect,
        est: typeof varejoEstoque.$inferSelect | undefined,
        qtdOverride?: number | null,
        totalOverride?: number | null,
        extras?: {
          lote?: string
          validade?: string
          origem_leitura?: string
          etiqueta_acougue_id?: string | null
          codigo_etiqueta?: string
        },
      ) => {
        const preco = tabPrecoMap.get(p.id) || toNum(est?.precoVendaVarejo, 0) || toNum(p.valorUnitario, 0)
        let qtd = qtdOverride && qtdOverride > 0 ? qtdOverride : 1
        let valorTotal = totalOverride && totalOverride > 0 ? totalOverride : Number((qtd * preco).toFixed(2))
        let precoUnit = preco
        if (totalOverride && totalOverride > 0 && (!qtdOverride || qtdOverride <= 0)) {
          if (preco > 0) {
            qtd = Number((totalOverride / preco).toFixed(3))
          } else {
            qtd = 1
            precoUnit = totalOverride
          }
        } else if (totalOverride && totalOverride > 0 && qtdOverride && qtdOverride > 0) {
          precoUnit = Number((totalOverride / qtdOverride).toFixed(4))
        }
        return {
          produto_id: p.id,
          codigo: p.codigo || '',
          descricao: p.descricao,
          ncm: p.ncm || '02013000',
          unidade: est?.unidadeVenda || (p.unidade === 'UN' ? 'UN' : 'KG'),
          setor_loja: est?.setorLoja || 'ACOUGUE',
          saldo_loja: est ? toNum(est.saldoQtd, 0) : 0,
          codigo_balanca: est?.codigoBalanca || '',
          qtd: Number(qtd.toFixed(3)),
          preco_unitario: Number(precoUnit.toFixed(4)),
          valor_total: Number(valorTotal.toFixed(2)),
          lote: extras?.lote || '',
          validade: extras?.validade || '',
          etiqueta_acougue_id: extras?.etiqueta_acougue_id || null,
          codigo_etiqueta: extras?.codigo_etiqueta || '',
          origem_leitura: extras?.origem_leitura || 'MANUAL',
        }
      }

      // 1) QR Code personalizado Zebra 80x45 (TRIC|ID=ETQ...|COD=...|KG=...|VL=...) ou código ETQ direto
      const qr = parseCodigoQrZebra(raw)
      const codigoEtqDireto = !qr && /^ETQ-?\d+$/i.test(raw) ? raw.toUpperCase() : ''
      const codigoEtqBusca = (qr?.codigo_etiqueta || codigoEtqDireto || '').toUpperCase()

      if (codigoEtqBusca) {
        const [etq] = await conn.db
          .select()
          .from(etiquetasAcougue)
          .where(
            and(
              eq(etiquetasAcougue.tenantId, ctx.tenantId),
              eq(etiquetasAcougue.filialId, ctx.filialId),
              eq(etiquetasAcougue.codigoEtiqueta, codigoEtqBusca),
            ),
          )
          .limit(1)
        if (etq) {
          if (etq.status === 'VENDIDA') {
            throw new HttpError(
              409,
              `Etiqueta ${etq.codigoEtiqueta} já foi vendida anteriormente! Bipagem duplicada bloqueada.`,
            )
          }
          if (etq.status === 'CANCELADA') {
            throw new HttpError(409, `Etiqueta ${etq.codigoEtiqueta} foi cancelada no Açougue.`)
          }
          const prodHit = prodMap.get(etq.produtoId)
          if (!prodHit) {
            throw new HttpError(404, `Produto da etiqueta ${etq.codigoEtiqueta} não encontrado no cadastro.`)
          }
          return {
            success: true,
            origem: 'QR_ZEBRA_80X45',
            match_exato: montarItem(
              prodHit,
              estMap.get(prodHit.id),
              toNum(etq.pesoLiquidoKg, 0),
              toNum(etq.valorTotal, 0),
              {
                lote: etq.lote || '',
                validade: etq.validade || '',
                etiqueta_acougue_id: etq.id,
                codigo_etiqueta: etq.codigoEtiqueta,
                origem_leitura: 'QR_ZEBRA_80X45',
              },
            ),
            sugestoes: [],
          }
        }
      }

      if (qr) {
        const codLow = qr.codigo.toLowerCase()
        const codSemZero = codLow.replace(/^0+/, '') || codLow
        const estHit = estLojaRows.find(
          (e) =>
            e.codigoBalanca &&
            (e.codigoBalanca.toLowerCase() === codLow || e.codigoBalanca.replace(/^0+/, '') === codSemZero),
        )
        const prodHit =
          (estHit ? prodMap.get(estHit.produtoId) : null) ||
          prodsAll.find(
            (p) =>
              String(p.codigo || '').toLowerCase() === codLow ||
              String(p.codigo || '').replace(/^0+/, '').toLowerCase() === codSemZero ||
              String(p.codigoAuxiliar || '').toLowerCase() === codLow,
          )
        if (!prodHit) {
          throw new HttpError(404, `Produto do QR Code (código "${qr.codigo}") não encontrado no cadastro.`)
        }
        return {
          success: true,
          origem: 'QR_ZEBRA_80X45',
          match_exato: montarItem(prodHit, estMap.get(prodHit.id), qr.peso_kg, qr.valor_total, {
            lote: qr.lote,
            validade: qr.validade,
            codigo_etiqueta: qr.codigo_etiqueta,
            origem_leitura: 'QR_ZEBRA_80X45',
          }),
          sugestoes: [],
        }
      }

      // 2) Etiqueta pesável de balança EAN-13 começando com '2' (todos os padrões Toledo/Filizola)
      const padraoBalanca = await lerPadraoBalancaTenant(conn.db, ctx.tenantId)
      const candidatosEan2 = parseEan2BalancaCandidatos(raw, padraoBalanca)
      for (const cand of candidatosEan2) {
        const estHit = estLojaRows.find(
          (e) =>
            e.codigoBalanca &&
            cand.codigosCandidatos.some(
              (c) => e.codigoBalanca === c || e.codigoBalanca.replace(/^0+/, '') === c.replace(/^0+/, ''),
            ),
        )
        const prodHit =
          (estHit ? prodMap.get(estHit.produtoId) : null) ||
          prodsAll.find((p) =>
            cand.codigosCandidatos.some(
              (c) =>
                String(p.codigo || '').trim() === c ||
                String(p.codigo || '').trim().replace(/^0+/, '') === c.replace(/^0+/, ''),
            ),
          )
        if (prodHit) {
          return {
            success: true,
            origem: `BALANCA_${cand.padrao}`,
            match_exato: montarItem(prodHit, estMap.get(prodHit.id), cand.pesoKg, cand.valorTotal, {
              origem_leitura: `BALANCA_${cand.padrao}`,
            }),
            sugestoes: [],
          }
        }
      }

      // 3) EAN exato (produtos.ean ou produtos_eans) ou código exato
      const rawLow = raw.toLowerCase()
      const eanAltMatch = eansAlt.find((ea) => ea.codigoBarras.toLowerCase() === rawLow)
      const prodExato =
        (eanAltMatch ? prodMap.get(eanAltMatch.produtoId) : null) ||
        prodsAll.find(
          (p) =>
            String(p.ean || '').toLowerCase() === rawLow ||
            String(p.codigo || '').toLowerCase() === rawLow ||
            String(p.codigoAuxiliar || '').toLowerCase() === rawLow,
        )

      if (prodExato) {
        return {
          success: true,
          origem: 'EAN_OU_CODIGO',
          match_exato: montarItem(prodExato, estMap.get(prodExato.id), 1, null, {
            origem_leitura: 'EAN_OU_CODIGO',
          }),
          sugestoes: [],
        }
      }

      // 4) Sugestões por busca textual (priorizando itens já no estoque da Loja)
      const sugestoes = prodsAll
        .filter(
          (p) =>
            p.descricao.toLowerCase().includes(rawLow) ||
            String(p.codigo || '').toLowerCase().includes(rawLow) ||
            String(p.ean || '').toLowerCase().includes(rawLow),
        )
        .sort((a, b) => {
          const aLoja = estMap.has(a.id) ? 0 : 1
          const bLoja = estMap.has(b.id) ? 0 : 1
          if (aLoja !== bLoja) return aLoja - bLoja
          return a.descricao.localeCompare(b.descricao, 'pt-BR')
        })
        .slice(0, 15)
        .map((p) => montarItem(p, estMap.get(p.id), 1, null, { origem_leitura: 'BUSCA' }))

      return { success: true, origem: 'BUSCA', match_exato: null, sugestoes }
    },
  )

  // ── FINALIZAR VENDA NO PDV (BAIXA ESTOQUE + ETIQUETAS + DESCONTO + CREDIÁRIO + NFC-e 65) ──
  app.post(
    '/api/pdv/vendas',
    { preHandler: requirePermission(PERM_PDV) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        caixa_id?: string
        cliente_id?: string | null
        cliente_nome?: string
        cliente_doc?: string
        desconto_tipo?: string // VALOR | PCT
        desconto_pct?: number
        desconto_valor?: number
        emitir_nfce?: boolean
        itens?: Array<{
          produto_id: string
          qtd: number
          preco_unitario: number
          valor_total?: number
          unidade?: string
          lote?: string
          etiqueta_acougue_id?: string | null
          codigo_etiqueta?: string
        }>
        pagamentos?: Array<{
          forma: string // DINHEIRO | PIX | DEBITO | CREDITO | CREDIARIO
          valor: number
        }>
      }

      const itensInput = Array.isArray(body.itens) ? body.itens : []
      if (itensInput.length === 0) {
        throw new HttpError(400, 'Adicione ao menos um item ao carrinho antes de finalizar a venda.')
      }
      const pagamentosInput = Array.isArray(body.pagamentos) ? body.pagamentos : []
      if (pagamentosInput.length === 0) {
        throw new HttpError(400, 'Informe ao menos uma forma de pagamento (Dinheiro, PIX, Débito, Crédito ou Crediário).')
      }

      const resultado = await conn.db.transaction(async (tx) => {
        // Caixa aberto
        let cxRow: typeof pdvCaixas.$inferSelect | undefined
        if (body.caixa_id) {
          const cid = parseUuidOrBadRequest(body.caixa_id, 'caixa_id')
          ;[cxRow] = await tx
            .select()
            .from(pdvCaixas)
            .where(and(eq(pdvCaixas.id, cid), eq(pdvCaixas.tenantId, ctx.tenantId)))
            .limit(1)
        } else {
          ;[cxRow] = await tx
            .select()
            .from(pdvCaixas)
            .where(
              and(
                eq(pdvCaixas.tenantId, ctx.tenantId),
                eq(pdvCaixas.filialId, ctx.filialId),
                eq(pdvCaixas.status, 'ABERTO'),
              ),
            )
            .orderBy(desc(pdvCaixas.abertoEm))
            .limit(1)
        }
        if (!cxRow || cxRow.status !== 'ABERTO') {
          throw new HttpError(409, 'Nenhum caixa PDV aberto nesta filial. Abra o caixa antes de registrar vendas.')
        }

        // Cliente vinculado (se informado)
        let clienteRow: typeof clientes.$inferSelect | null = null
        if (body.cliente_id) {
          const cliId = parseUuidOrBadRequest(body.cliente_id, 'cliente_id')
          const [foundCli] = await tx
            .select()
            .from(clientes)
            .where(and(eq(clientes.id, cliId), eq(clientes.tenantId, ctx.tenantId)))
            .limit(1)
          if (!foundCli) throw new HttpError(404, 'Cliente selecionado não encontrado no cadastro.')
          clienteRow = foundCli
        }

        const prodIds = Array.from(new Set(itensInput.map((i) => parseUuidOrBadRequest(i.produto_id, 'produto_id'))))
        const prodsDb = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.tenantId, ctx.tenantId), inArray(produtos.id, prodIds)))
        const prodMap = new Map(prodsDb.map((p) => [p.id, p]))

        const itensNorm = itensInput.map((it) => {
          const p = prodMap.get(it.produto_id)
          if (!p) throw new HttpError(404, `Produto ${it.produto_id} não encontrado.`)
          const qtd = Math.max(0.001, Number(it.qtd || 0))
          const preco = Math.max(0, Number(it.preco_unitario || 0))
          const total =
            it.valor_total != null && Number(it.valor_total) > 0
              ? Number(Number(it.valor_total).toFixed(2))
              : Number((qtd * preco).toFixed(2))
          return {
            produto_id: p.id,
            codigo: p.codigo || '',
            descricao: p.descricao,
            ncm: p.ncm || '02013000',
            cest: p.cest || '',
            orig: p.origemMercadoria || '0',
            unidade: String(it.unidade || p.unidade || 'KG').toUpperCase(),
            qtd: Number(qtd.toFixed(3)),
            preco_unitario: Number(preco.toFixed(4)),
            valor_total: total,
            lote: it.lote || '',
            etiqueta_acougue_id: it.etiqueta_acougue_id || null,
            codigo_etiqueta: it.codigo_etiqueta || '',
          }
        })

        // Valida etiquetas únicas do açougue antes de efetivar
        const etqIdsParaBaixar: string[] = []
        for (const it of itensNorm) {
          if (it.etiqueta_acougue_id) {
            const eid = parseUuidOrBadRequest(it.etiqueta_acougue_id, 'etiqueta_acougue_id')
            if (etqIdsParaBaixar.includes(eid)) {
              throw new HttpError(409, `A etiqueta ${it.codigo_etiqueta || eid} está duplicada no carrinho.`)
            }
            const [etq] = await tx
              .select()
              .from(etiquetasAcougue)
              .where(and(eq(etiquetasAcougue.id, eid), eq(etiquetasAcougue.tenantId, ctx.tenantId)))
              .limit(1)
            if (!etq) throw new HttpError(404, `Etiqueta ${it.codigo_etiqueta || eid} não encontrada.`)
            if (etq.status !== 'EM_ESTOQUE') {
              throw new HttpError(
                409,
                `Etiqueta ${etq.codigoEtiqueta} não está disponível para venda (status atual: ${etq.status}).`,
              )
            }
            etqIdsParaBaixar.push(eid)
          }
        }

        const subtotal = Number(itensNorm.reduce((s, i) => s + i.valor_total, 0).toFixed(2))

        // Cálculo e trava de segurança do desconto (exige cliente cadastrado com desconto_ativo e respeita desconto_max_pct)
        const descontoTipo = String(body.desconto_tipo || 'VALOR').toUpperCase() === 'PCT' ? 'PCT' : 'VALOR'
        let desconto = 0
        let descontoPct = 0
        if (descontoTipo === 'PCT' && Number(body.desconto_pct || 0) > 0) {
          descontoPct = Math.min(100, Math.max(0, Number(body.desconto_pct || 0)))
          desconto = Number(((subtotal * descontoPct) / 100).toFixed(2))
        } else if (Number(body.desconto_valor || 0) > 0) {
          desconto = Math.min(subtotal, Math.max(0, Number(body.desconto_valor || 0)))
          descontoPct = subtotal > 0 ? Number(((desconto / subtotal) * 100).toFixed(2)) : 0
        }

        if (desconto > 0.005) {
          if (!clienteRow || Number(clienteRow.descontoAtivo || 0) !== 1) {
            throw new HttpError(
              400,
              'Desconto bloqueado: selecione um cliente cadastrado com permissão de desconto ativa.',
            )
          }
          const maxPct = toNum(clienteRow.descontoMaxPct, 0)
          if (descontoPct > maxPct + 0.01) {
            throw new HttpError(
              400,
              `Desconto solicitado (${descontoPct.toFixed(2)}%) ultrapassa o limite máximo de ${maxPct.toFixed(2)}% cadastrado para ${nomeCliente(clienteRow)}.`,
            )
          }
        }

        const valorTotal = Number((subtotal - desconto).toFixed(2))

        const pagsNorm = pagamentosInput
          .map((pg) => ({
            forma: String(pg.forma || 'DINHEIRO').toUpperCase(),
            valor: Math.max(0, Number(Number(pg.valor || 0).toFixed(2))),
          }))
          .filter((pg) => pg.valor > 0)

        const somaPags = Number(pagsNorm.reduce((s, p) => s + p.valor, 0).toFixed(2))
        if (somaPags + 0.009 < valorTotal) {
          throw new HttpError(
            400,
            `Valor pago (R$ ${somaPags.toFixed(2)}) é menor que o total da venda (R$ ${valorTotal.toFixed(2)}).`,
          )
        }

        const vCrediario = Number(
          pagsNorm.filter((p) => p.forma === 'CREDIARIO').reduce((s, p) => s + p.valor, 0).toFixed(2),
        )
        const vDinBruto = Number(
          pagsNorm.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + p.valor, 0).toFixed(2),
        )
        const excedente = Number(Math.max(0, somaPags - valorTotal).toFixed(2))
        if (excedente > 0.01 && vDinBruto + 0.009 < excedente) {
          throw new HttpError(
            400,
            'Troco só pode ser devolvido sobre pagamentos em Dinheiro. Ajuste o valor das formas eletrônicas/crediário.',
          )
        }
        const troco = excedente

        // Validação de Crediário (cliente cadastrado + crediario_ativo + limite disponível)
        let tituloReceberId: string | null = null
        let vencimentoCrediario: string | null = null
        let crediarioInfoPos: {
          limite_credito: number
          credito_utilizado_anterior: number
          credito_utilizado_pos: number
          credito_disponivel_pos: number
          titulo_codigo: string
        } | null = null

        const vendaId = uuidv7()
        const vendaCodigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'PDV_VENDA', 'VPDV', 5)

        if (vCrediario > 0) {
          if (!clienteRow) {
            throw new HttpError(400, 'Selecione um cliente cadastrado para finalizar venda no Crediário.')
          }
          if (Number(clienteRow.crediarioAtivo || 0) !== 1) {
            throw new HttpError(403, `O cliente ${nomeCliente(clienteRow)} não possui Crediário liberado no cadastro.`)
          }
          if (Number(clienteRow.bloqueadoFinanceiro || 0) === 1) {
            throw new HttpError(403, `O cliente ${nomeCliente(clienteRow)} está bloqueado financeiramente.`)
          }

          const resUtil = await tx.execute(sql`
            SELECT COALESCE(SUM(saldo_aberto), 0) AS utilizado
            FROM financeiro_titulos
            WHERE tenant_id = ${ctx.tenantId}
              AND cliente_id = ${clienteRow.id}
              AND tipo = 'RECEBER'
              AND status IN ('ABERTO', 'PARCIAL')
          `)
          const utilizadoAnt = toNum((resUtil.rows as Array<{ utilizado: string }>)[0]?.utilizado, 0)
          const limite = toNum(clienteRow.limiteCredito, 0)
          const disponivelAnt = Math.max(0, Number((limite - utilizadoAnt).toFixed(2)))

          if (vCrediario > disponivelAnt + 0.009) {
            throw new HttpError(
              409,
              `Limite de crediário insuficiente para ${nomeCliente(clienteRow)}. Limite disponível: R$ ${disponivelAnt.toFixed(2)} | Compra no crediário: R$ ${vCrediario.toFixed(2)}.`,
            )
          }

          const hoje = hojeIsoLocal()
          const prazoDias = Math.max(1, Number(clienteRow.prazoCrediarioDias || 30))
          vencimentoCrediario = somarDiasIso(hoje, prazoDias)
          tituloReceberId = uuidv7()
          const tituloCodigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'FIN_RECEBER', 'CRE', 5)

          await tx.insert(financeiroTitulos).values({
            id: tituloReceberId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            codigo: tituloCodigo,
            tipo: 'RECEBER',
            origem: 'CREDIARIO_PDV',
            descricao: `Crediário PDV ${vendaCodigo} — ${nomeCliente(clienteRow)}`,
            numeroDocumento: vendaCodigo,
            parcelaNum: 1,
            parcelaTotal: 1,
            clienteId: clienteRow.id,
            contaBancariaId: cxRow.contaBancariaId || null,
            dataEmissao: hoje,
            dataVencimento: vencimentoCrediario,
            valorOriginal: toDec(vCrediario, 2),
            saldoAberto: toDec(vCrediario, 2),
            status: 'ABERTO',
            formaPagamentoEfetiva: 'CREDIARIO',
            observacoes: `Gerado automaticamente no PDV Caixa ${cxRow.codigo}`,
            criadoPorId: ctx.operador.id,
            criadoPorNome: ctx.operador.nome,
          })

          const utilizadoPos = Number((utilizadoAnt + vCrediario).toFixed(2))
          const disponivelPos = Math.max(0, Number((limite - utilizadoPos).toFixed(2)))
          crediarioInfoPos = {
            limite_credito: limite,
            credito_utilizado_anterior: utilizadoAnt,
            credito_utilizado_pos: utilizadoPos,
            credito_disponivel_pos: disponivelPos,
            titulo_codigo: tituloCodigo,
          }
        }

        const clienteNomeFinal =
          (clienteRow ? nomeCliente(clienteRow) : '') || String(body.cliente_nome || '').trim() || 'CONSUMIDOR FINAL'
        const clienteDocFinal = onlyDigits(clienteRow?.cnpjCpf || body.cliente_doc || '')

        // 1) Baixa estoque no varejo_estoque + marca etiquetas únicas do Açougue como VENDIDA
        for (const it of itensNorm) {
          const [est] = await tx
            .select()
            .from(varejoEstoque)
            .where(
              and(
                eq(varejoEstoque.tenantId, ctx.tenantId),
                eq(varejoEstoque.filialId, ctx.filialId),
                eq(varejoEstoque.produtoId, it.produto_id),
              ),
            )
            .limit(1)
          const saldoAnt = est ? toNum(est.saldoQtd, 0) : 0
          const saldoNovo = Number((saldoAnt - it.qtd).toFixed(3))

          if (est) {
            await tx
              .update(varejoEstoque)
              .set({ saldoQtd: toDec(saldoNovo, 3), updatedAt: new Date() })
              .where(eq(varejoEstoque.id, est.id))
          } else {
            await tx.insert(varejoEstoque).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              produtoId: it.produto_id,
              unidadeVenda: it.unidade === 'UN' ? 'UN' : 'KG',
              saldoQtd: toDec(saldoNovo, 3),
              precoVendaVarejo: toDec(it.preco_unitario, 4),
              estoqueMinimo: '0.000',
              codigoBalanca: (it.codigo || '').replace(/\D/g, '').slice(-5),
              setorLoja: it.unidade === 'UN' ? 'EMPORIO' : 'ACOUGUE',
            })
          }

          await tx.insert(varejoMovimentacoes).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            produtoId: it.produto_id,
            tipo: 'VENDA_PDV',
            qtd: toDec(-it.qtd, 3),
            saldoAnterior: toDec(saldoAnt, 3),
            saldoNovo: toDec(saldoNovo, 3),
            referenciaTipo: 'PDV_VENDA',
            referenciaId: vendaId,
            observacao: `Venda PDV ${vendaCodigo}${it.codigo_etiqueta ? ` (${it.codigo_etiqueta})` : ''}`,
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }

        // Dados da empresa e filial (para NFC-e e Recibo de Crediário)
        const [empRow] = await tx.select().from(empresas).where(eq(empresas.id, ctx.empresaId)).limit(1)
        const [filRow] = await tx.select().from(filiais).where(eq(filiais.id, ctx.filialId)).limit(1)

        // 2) Emite NFC-e (modelo 65) se solicitado (padrão true)
        let notaFiscalId: string | null = null
        let numeroNfce: number | null = null
        let chaveNfce = ''
        if (body.emitir_nfce !== false) {
          const regras = await tx
            .select()
            .from(matrizTributaria)
            .where(eq(matrizTributaria.tenantId, ctx.tenantId))

          let [cfg] = await tx
            .select()
            .from(fiscalConfigFilial)
            .where(and(eq(fiscalConfigFilial.tenantId, ctx.tenantId), eq(fiscalConfigFilial.filialId, ctx.filialId)))
            .limit(1)
          if (!cfg) {
            const cfgId = uuidv7()
            await tx.insert(fiscalConfigFilial).values({
              id: cfgId,
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              ambiente: 'HOMOLOGACAO',
              provedor: 'SIMULACAO_LOCAL',
              serieNfe: 1,
              proximoNumeroNfe: 1,
              serieNfce: 1,
              proximoNumeroNfce: 1,
            })
            ;[cfg] = await tx.select().from(fiscalConfigFilial).where(eq(fiscalConfigFilial.id, cfgId)).limit(1)
          }

          const num = Number(cfg.proximoNumeroNfce || 1)
          const ser = Number(cfg.serieNfce || 1)
          await tx
            .update(fiscalConfigFilial)
            .set({ proximoNumeroNfce: num + 1, updatedAt: new Date() })
            .where(eq(fiscalConfigFilial.id, cfg.id))

          const ufOrig = (filRow?.uf || 'SP').toUpperCase()
          const cnpjEmit = onlyDigits(filRow?.cnpj || empRow?.cnpj || '54142043000130') || '54142043000130'
          const descRatio = subtotal > 0 ? desconto / subtotal : 0
          const itensFiscais = itensNorm.map((it, idx) =>
            calcularTributacaoItem({
              nItem: idx + 1,
              produtoId: it.produto_id,
              codigo: it.codigo || String(idx + 1),
              descricao: it.descricao,
              ncm: it.ncm,
              cest: it.cest,
              orig: it.orig,
              unidade: it.unidade,
              qtd: it.qtd,
              valorUnitario: it.preco_unitario,
              valorDesconto: Number((it.valor_total * descRatio).toFixed(2)),
              tipoOperacao: 'SAIDA',
              modelo: '65',
              tipoUnidadeFilial: 'VAREJO',
              ufOrigem: ufOrig,
              ufDestino: ufOrig,
              regimeTributario: empRow?.regimeTributario || 'SIMPLES',
              matrizRegras: regras,
            }),
          )

          const vBC = Number(itensFiscais.reduce((s, i) => s + i.v_bc_icms, 0).toFixed(2))
          const vICMS = Number(itensFiscais.reduce((s, i) => s + i.v_icms, 0).toFixed(2))
          const vPIS = Number(itensFiscais.reduce((s, i) => s + i.v_pis, 0).toFixed(2))
          const vCOFINS = Number(itensFiscais.reduce((s, i) => s + i.v_cofins, 0).toFixed(2))
          const { chave, cNF, cDV } = gerarChaveAcessoNfe({
            uf: ufOrig,
            cnpjEmitente: cnpjEmit,
            modelo: '65',
            serie: ser,
            numero: num,
          })
          const protocolo = `135${String(Date.now()).slice(-12)}`
          const formaPrinc = pagsNorm[0]?.forma || 'DINHEIRO'
          const tPag =
            formaPrinc === 'PIX'
              ? '17'
              : formaPrinc === 'CREDITO'
                ? '03'
                : formaPrinc === 'DEBITO'
                  ? '04'
                  : formaPrinc === 'CREDIARIO'
                    ? '05'
                    : '01'

          const xmlConteudo = gerarXmlNfe400({
            chave,
            cNF,
            cDV,
            protocolo,
            ambiente: cfg.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO',
            modelo: '65',
            serie: ser,
            numero: num,
            naturezaOperacao: 'VENDA A CONSUMIDOR FINAL (PDV)',
            tipoOperacao: 'SAIDA',
            finalidade: '1',
            dataEmissaoIso: new Date().toISOString(),
            emitente: {
              cnpj: cnpjEmit,
              razaoSocial: empRow?.razaoSocial || filRow?.nome || 'VAREJO & ACOUGUE',
              nomeFantasia: empRow?.nomeFantasia || filRow?.nome || 'VAREJO & ACOUGUE',
              ie: onlyDigits(filRow?.inscricaoEstadual || empRow?.inscricaoEstadual || 'ISENTO') || 'ISENTO',
              crt: String(empRow?.regimeTributario || 'SIMPLES').toUpperCase() === 'SIMPLES' ? '1' : '3',
              uf: ufOrig,
              cidade: filRow?.cidade || 'SAO PAULO',
              codigoIbge: filRow?.codigoIbge || '3550308',
            },
            destinatario: {
              nome: clienteNomeFinal,
              doc: clienteDocFinal,
              ie: '',
              uf: clienteRow?.uf || ufOrig,
              cidade: clienteRow?.cidade || filRow?.cidade || 'SAO PAULO',
              endereco: clienteRow?.endereco || 'BALCAO',
            },
            itens: itensFiscais,
            totais: {
              vProd: subtotal,
              vDesc: desconto,
              vFrete: 0,
              vBC,
              vICMS,
              vST: 0,
              vPIS,
              vCOFINS,
              vIBS: 0,
              vCBS: 0,
              vNF: valorTotal,
              pesoBruto: 0,
              pesoLiquido: 0,
              qtdVolumes: itensNorm.length,
            },
            tPag,
            infComplementar: `Venda PDV ${vendaCodigo} • Caixa ${cxRow.codigo}`,
          })

          notaFiscalId = uuidv7()
          numeroNfce = num
          chaveNfce = chave

          await tx.insert(fiscalNotas).values({
            id: notaFiscalId,
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            modelo: '65',
            tipoOperacao: 'SAIDA',
            finalidade: '1',
            ambiente: cfg.ambiente || 'HOMOLOGACAO',
            provedorUsado: cfg.provedor || 'SIMULACAO_LOCAL',
            serie: ser,
            numero: num,
            chaveAcesso: chave,
            protocoloAutorizacao: protocolo,
            dataAutorizacao: new Date(),
            status: 'AUTORIZADA',
            naturezaOperacao: 'VENDA A CONSUMIDOR FINAL (PDV)',
            destinatarioNome: clienteNomeFinal,
            destinatarioDoc: clienteDocFinal,
            destinatarioUf: clienteRow?.uf || ufOrig,
            formaPagamentoLabel: pagsNorm.map((p) => `${p.forma} R$ ${p.valor.toFixed(2)}`).join(' + '),
            valorProdutos: toDec(subtotal, 2),
            valorDesconto: toDec(desconto, 2),
            valorFrete: '0.00',
            valorIcmsBase: toDec(vBC, 2),
            valorIcms: toDec(vICMS, 2),
            valorIcmsSt: '0.00',
            valorPis: toDec(vPIS, 2),
            valorCofins: toDec(vCOFINS, 2),
            valorIbs: '0.00',
            valorCbs: '0.00',
            valorTotalNf: toDec(valorTotal, 2),
            modFrete: '9',
            qtdVolumes: itensNorm.length,
            itensJson: itensFiscais as unknown as Array<Record<string, unknown>>,
            xmlConteudo,
            infComplementar: `Venda PDV ${vendaCodigo} • Caixa ${cxRow.codigo}`,
            emitidaPorId: ctx.operador.id,
          })
        }

        // 3) Grava pdv_vendas
        await tx.insert(pdvVendas).values({
          id: vendaId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          caixaId: cxRow.id,
          codigo: vendaCodigo,
          clienteId: clienteRow?.id || null,
          clienteNome: clienteNomeFinal,
          clienteDoc: clienteDocFinal,
          subtotal: toDec(subtotal, 2),
          descontoTipo,
          descontoPct: toDec(descontoPct, 2),
          descontoValor: toDec(desconto, 2),
          valorTotal: toDec(valorTotal, 2),
          trocoValor: toDec(troco, 2),
          crediarioValor: toDec(vCrediario, 2),
          tituloReceberId,
          vencimentoCrediario,
          pagamentosJson: pagsNorm,
          itensJson: itensNorm,
          status: 'CONCLUIDA',
          notaFiscalId,
          numeroNfce,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        if (etqIdsParaBaixar.length > 0) {
          await tx
            .update(etiquetasAcougue)
            .set({ status: 'VENDIDA', vendaPdvId: vendaId, vendidaEm: new Date() })
            .where(inArray(etiquetasAcougue.id, etqIdsParaBaixar))
        }

        // 4) Atualiza acumuladores do Caixa PDV (dinheiro líquido já descontando o troco devolvido!)
        const vDin = Math.max(0, Number((vDinBruto - troco).toFixed(2)))
        const vPix = pagsNorm.filter((p) => p.forma === 'PIX').reduce((s, p) => s + p.valor, 0)
        const vDeb = pagsNorm.filter((p) => p.forma === 'DEBITO').reduce((s, p) => s + p.valor, 0)
        const vCred = pagsNorm.filter((p) => p.forma === 'CREDITO').reduce((s, p) => s + p.valor, 0)

        const novoTotVendas = Number((toNum(cxRow.totalVendas, 0) + valorTotal).toFixed(2))
        const novoTotDin = Number((toNum(cxRow.totalDinheiro, 0) + vDin).toFixed(2))
        const novoTotPix = Number((toNum(cxRow.totalPix, 0) + vPix).toFixed(2))
        const novoTotDeb = Number((toNum(cxRow.totalDebito, 0) + vDeb).toFixed(2))
        const novoTotCred = Number((toNum(cxRow.totalCredito, 0) + vCred).toFixed(2))
        const novoTotCrediario = Number((toNum(cxRow.totalCrediario, 0) + vCrediario).toFixed(2))
        const novoEsperadoDin = Number(
          (
            toNum(cxRow.saldoAbertura, 0) +
            novoTotDin +
            toNum(cxRow.totalSuprimentos, 0) -
            toNum(cxRow.totalSangrias, 0)
          ).toFixed(2),
        )

        await tx
          .update(pdvCaixas)
          .set({
            totalVendas: toDec(novoTotVendas, 2),
            totalDinheiro: toDec(novoTotDin, 2),
            totalPix: toDec(novoTotPix, 2),
            totalDebito: toDec(novoTotDeb, 2),
            totalCredito: toDec(novoTotCred, 2),
            totalCrediario: toDec(novoTotCrediario, 2),
            saldoEsperadoDinheiro: toDec(novoEsperadoDin, 2),
          })
          .where(eq(pdvCaixas.id, cxRow.id))

        // 5) Integra entrada financeira imediata no Caixa (apenas parcela à vista; Crediário já está em Contas a Receber!)
        const valorLiquidoCaixa = Number(Math.max(0, valorTotal - vCrediario).toFixed(2))
        if (cxRow.contaBancariaId && valorLiquidoCaixa > 0) {
          const [conta] = await tx
            .select()
            .from(financeiroContasBancarias)
            .where(eq(financeiroContasBancarias.id, cxRow.contaBancariaId))
            .limit(1)
          if (conta) {
            const formasCaixa = pagsNorm.filter((p) => p.forma !== 'CREDIARIO').map((p) => p.forma)
            await tx.insert(financeiroMovimentacoes).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              contaBancariaId: conta.id,
              tipo: 'ENTRADA',
              categoria: 'VENDA_PDV',
              dataMovimento: hojeIsoLocal(),
              valor: toDec(valorLiquidoCaixa, 2),
              formaPagamento: formasCaixa.join('+') || 'DINHEIRO',
              historico: `Venda PDV ${vendaCodigo}${numeroNfce ? ` • NFC-e #${numeroNfce}` : ''} (${cxRow.codigo})`,
              operadorId: ctx.operador.id,
              operadorNome: ctx.operador.nome,
            })
            const novoSaldoConta = Number((toNum(conta.saldoAtual, 0) + valorLiquidoCaixa).toFixed(2))
            await tx
              .update(financeiroContasBancarias)
              .set({ saldoAtual: toDec(novoSaldoConta, 2), updatedAt: new Date() })
              .where(eq(financeiroContasBancarias.id, conta.id))
          }
        }

        const crediarioRecibo =
          vCrediario > 0 && clienteRow && crediarioInfoPos
            ? {
                empresa_nome: empRow?.nomeFantasia || empRow?.razaoSocial || filRow?.nome || 'VAREJO & AÇOUGUE',
                empresa_cnpj: filRow?.cnpj || empRow?.cnpj || '',
                empresa_cidade: filRow?.cidade || '',
                venda_codigo: vendaCodigo,
                titulo_codigo: crediarioInfoPos.titulo_codigo,
                data_emissao: new Date().toISOString(),
                vencimento: vencimentoCrediario,
                cliente_id: clienteRow.id,
                cliente_nome: nomeCliente(clienteRow),
                cliente_cpf_cnpj: clienteRow.cnpjCpf || '',
                cliente_rg: clienteRow.rg || '',
                cliente_endereco: [
                  clienteRow.endereco,
                  clienteRow.numero,
                  clienteRow.bairro,
                  clienteRow.cidade,
                  clienteRow.uf,
                ]
                  .filter(Boolean)
                  .join(', '),
                cliente_telefone: clienteRow.telefone || '',
                subtotal,
                desconto_valor: desconto,
                valor_total_venda: valorTotal,
                valor_crediario: vCrediario,
                limite_credito: crediarioInfoPos.limite_credito,
                credito_utilizado_pos: crediarioInfoPos.credito_utilizado_pos,
                credito_disponivel_pos: crediarioInfoPos.credito_disponivel_pos,
                operador_nome: ctx.operador.nome,
                itens: itensNorm,
              }
            : null

        return {
          id: vendaId,
          codigo: vendaCodigo,
          subtotal,
          desconto_tipo: descontoTipo,
          desconto_pct: descontoPct,
          desconto_valor: desconto,
          valor_total: valorTotal,
          troco_valor: troco,
          crediario_valor: vCrediario,
          titulo_receber_id: tituloReceberId,
          vencimento_crediario: vencimentoCrediario,
          crediario_recibo: crediarioRecibo,
          pagamentos: pagsNorm,
          itens: itensNorm,
          nota_fiscal_id: notaFiscalId,
          numero_nfce: numeroNfce,
          chave_nfce: chaveNfce,
          cliente_id: clienteRow?.id || null,
          cliente_nome: clienteNomeFinal,
          cliente_doc: clienteDocFinal,
          operador_nome: ctx.operador.nome,
          created_at: new Date().toISOString(),
        }
      })

      return reply.code(201).send({ success: true, data: resultado })
    },
  )

  app.post(
    '/api/pdv/vendas/:id/cancelar',
    { preHandler: requirePermission(PERM_PDV) },
    async (req) => {
      const ctx = req.authCtx!
      const vendaId = parseUuidOrBadRequest((req.params as { id: string }).id, 'venda_id')
      const body = (req.body || {}) as { motivo?: string }

      const out = await conn.db.transaction(async (tx) => {
        const [v] = await tx
          .select()
          .from(pdvVendas)
          .where(and(eq(pdvVendas.id, vendaId), eq(pdvVendas.tenantId, ctx.tenantId)))
          .limit(1)
        if (!v) throw new HttpError(404, 'Venda PDV não encontrada.')
        if (v.status === 'CANCELADA') throw new HttpError(409, 'Esta venda já está cancelada.')

        // Estorna estoque da loja
        for (const it of (v.itensJson || []) as any[]) {
          const [est] = await tx
            .select()
            .from(varejoEstoque)
            .where(
              and(
                eq(varejoEstoque.tenantId, ctx.tenantId),
                eq(varejoEstoque.filialId, v.filialId),
                eq(varejoEstoque.produtoId, it.produto_id),
              ),
            )
            .limit(1)
          if (est) {
            const ant = toNum(est.saldoQtd, 0)
            const novo = Number((ant + Number(it.qtd || 0)).toFixed(3))
            await tx
              .update(varejoEstoque)
              .set({ saldoQtd: toDec(novo, 3), updatedAt: new Date() })
              .where(eq(varejoEstoque.id, est.id))
            await tx.insert(varejoMovimentacoes).values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              filialId: v.filialId,
              produtoId: it.produto_id,
              tipo: 'ESTORNO_PDV',
              qtd: toDec(Number(it.qtd || 0), 3),
              saldoAnterior: toDec(ant, 3),
              saldoNovo: toDec(novo, 3),
              referenciaTipo: 'PDV_VENDA',
              referenciaId: v.id,
              observacao: `Estorno cancelamento ${v.codigo}`,
              operadorId: ctx.operador.id,
              operadorNome: ctx.operador.nome,
            })
          }
        }

        // Restaura etiquetas únicas do açougue vendidas nessa venda
        await tx
          .update(etiquetasAcougue)
          .set({ status: 'EM_ESTOQUE', vendaPdvId: null, vendidaEm: null })
          .where(and(eq(etiquetasAcougue.tenantId, ctx.tenantId), eq(etiquetasAcougue.vendaPdvId, v.id)))

        // Cancela título de crediário ainda em aberto (liberando o limite do cliente!)
        if (v.tituloReceberId) {
          await tx
            .update(financeiroTitulos)
            .set({
              status: 'CANCELADO',
              saldoAberto: '0.00',
              observacoes: `Cancelado por estorno da venda ${v.codigo}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(financeiroTitulos.id, v.tituloReceberId),
                eq(financeiroTitulos.status, 'ABERTO'),
              ),
            )
        }

        // Cancela NFC-e se houver
        if (v.notaFiscalId) {
          await tx
            .update(fiscalNotas)
            .set({
              status: 'CANCELADA',
              motivoCancelamento: String(body.motivo || 'Cancelamento no PDV'),
              canceladaEm: new Date(),
            })
            .where(eq(fiscalNotas.id, v.notaFiscalId))
        }

        await tx
          .update(pdvVendas)
          .set({
            status: 'CANCELADA',
            motivoCancelamento: String(body.motivo || 'Cancelamento operacional PDV'),
            canceladaEm: new Date(),
          })
          .where(eq(pdvVendas.id, v.id))

        return { id: v.id, codigo: v.codigo, status: 'CANCELADA' }
      })

      return { success: true, data: out }
    },
  )
}
