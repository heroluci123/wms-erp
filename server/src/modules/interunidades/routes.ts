import type { FastifyInstance } from 'fastify'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  empresas,
  estoqueCaixas,
  filiais,
  fiscalConfigFilial,
  fiscalNotas,
  interunidadesMovimentacoes,
  matrizTributaria,
  produtos,
  varejoEstoque,
  varejoMovimentacoes,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  toDec,
  toNum,
} from '../wms/helpers.js'
import {
  calcularTributacaoItem,
  gerarChaveAcessoNfe,
  gerarXmlNfe400,
  onlyDigits,
} from '../fiscal/nfeBuilder.js'
import {
  carregarMapaFiliais,
  detectarEspecieProduto,
  type EspecieCarne,
} from './helpers.js'

const PERM_INTERUNIDADES = ['interunidades', 'movimentacao', 'fiscal', 'varejo_acougue', 'producao_entrada', 'producao_saida']

function normalizarEspecie(v: unknown, fallback: EspecieCarne = 'OUTROS'): EspecieCarne {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'BOVINO' || s === 'SUINO' || s === 'AVES' || s === 'OUTROS') return s
  return fallback
}

async function buscarCaixaPorCodigo(tx: any, tenantId: string, codigoRaw: string) {
  const code = String(codigoRaw || '').trim()
  if (!code) throw new HttpError(400, 'Informe ou bipe o código de barras (EAN) da caixa.')
  const rows = await tx
    .select()
    .from(estoqueCaixas)
    .where(and(eq(estoqueCaixas.tenantId, tenantId), eq(estoqueCaixas.eanCaixa, code)))
    .limit(1)
  if (!rows[0]) {
    throw new HttpError(404, `Caixa "${code}" não encontrada no estoque WMS.`)
  }
  return rows[0] as typeof estoqueCaixas.$inferSelect
}

export function registerInterunidadesRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // ── MAPA DE UNIDADES (1/1 LOJA, 1/2 MATRIZ, 2/1 FG FOODS) ───────────────────
  app.get(
    '/api/interunidades/filiais-mapa',
    { preHandler: requirePermission(PERM_INTERUNIDADES, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const mapa = await carregarMapaFiliais(conn.db, ctx.tenantId)
      return {
        success: true,
        loja: mapa.loja,
        matriz: mapa.matriz,
        industria: mapa.industria,
        filiais: mapa.todas,
      }
    },
  )

  // ── LISTAR MOVIMENTAÇÕES INTER-UNIDADES ─────────────────────────────────────
  app.get(
    '/api/interunidades/movimentacoes',
    { preHandler: requirePermission(PERM_INTERUNIDADES, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as {
        tipo?: string
        status_fiscal?: string
        especie?: string
        data_ini?: string
        data_fim?: string
        busca?: string
      }

      const conds = [eq(interunidadesMovimentacoes.tenantId, ctx.tenantId)]
      if (q.tipo && q.tipo !== 'TODOS') {
        conds.push(eq(interunidadesMovimentacoes.tipoOperacao, q.tipo.toUpperCase()))
      }
      if (q.status_fiscal && q.status_fiscal !== 'TODOS') {
        conds.push(eq(interunidadesMovimentacoes.statusFiscal, q.status_fiscal.toUpperCase()))
      }
      if (q.especie && q.especie !== 'TODOS') {
        conds.push(eq(interunidadesMovimentacoes.especie, q.especie.toUpperCase()))
      }
      if (q.data_ini && /^\d{4}-\d{2}-\d{2}$/.test(q.data_ini)) {
        conds.push(sql`${interunidadesMovimentacoes.dataMovimento} >= ${q.data_ini}`)
      }
      if (q.data_fim && /^\d{4}-\d{2}-\d{2}$/.test(q.data_fim)) {
        conds.push(sql`${interunidadesMovimentacoes.dataMovimento} <= ${q.data_fim}`)
      }

      const rows = await conn.db
        .select()
        .from(interunidadesMovimentacoes)
        .where(and(...conds))
        .orderBy(desc(interunidadesMovimentacoes.createdAt))
        .limit(400)

      const filiaisMap = new Map<string, { codigo: string; nome: string }>()
      const fs = await conn.db.select().from(filiais).where(eq(filiais.tenantId, ctx.tenantId))
      for (const f of fs) filiaisMap.set(f.id, { codigo: f.codigo, nome: f.nome })

      const busca = String(q.busca || '').trim().toLowerCase()
      const data = rows
        .map((r) => {
          const orig = filiaisMap.get(r.filialOrigemId)
          const dest = filiaisMap.get(r.filialDestinoId)
          return {
            id: r.id,
            codigo: r.codigo,
            tipo_operacao: r.tipoOperacao,
            filial_origem_id: r.filialOrigemId,
            filial_origem_label: orig ? `${orig.codigo} - ${orig.nome}` : '-',
            filial_destino_id: r.filialDestinoId,
            filial_destino_label: dest ? `${dest.codigo} - ${dest.nome}` : '-',
            caixa_id: r.caixaId,
            ean_caixa: r.eanCaixa,
            produto_id: r.produtoId,
            produto_codigo: r.produtoCodigo,
            produto_descricao: r.produtoDescricao,
            especie: r.especie,
            peso_kg: toNum(r.pesoKg, 0),
            valor_unitario_kg: toNum(r.valorUnitarioKg, 0),
            valor_total: toNum(r.valorTotal, 0),
            op_id: r.opId,
            requer_faturamento: Number(r.requerFaturamento || 0) === 1,
            status_fiscal: r.statusFiscal,
            nota_fiscal_id: r.notaFiscalId,
            numero_nf: r.numeroNf,
            data_movimento: r.dataMovimento,
            operador_nome: r.operadorNome,
            observacao: r.observacao,
            created_at: r.createdAt,
          }
        })
        .filter((r) => {
          if (!busca) return true
          return (
            r.codigo.toLowerCase().includes(busca) ||
            r.ean_caixa.toLowerCase().includes(busca) ||
            r.produto_descricao.toLowerCase().includes(busca) ||
            r.produto_codigo.toLowerCase().includes(busca)
          )
        })

      return { success: true, data }
    },
  )

  // ── 1) TRANSFERÊNCIA MATRIZ (1/2) -> FILIAL LOJA (1/1) BIPANDO A CAIXA ──────
  app.post(
    '/api/interunidades/bipar-transferencia-loja',
    { preHandler: requirePermission(['interunidades', 'movimentacao', 'varejo_acougue']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        ean_caixa?: string
        filial_destino_id?: string
        observacao?: string
      }

      const out = await conn.db.transaction(async (tx) => {
        const mapa = await carregarMapaFiliais(tx, ctx.tenantId)
        const filialLoja =
          (body.filial_destino_id
            ? mapa.todas.find((f) => f.id === body.filial_destino_id)
            : mapa.loja) || null
        if (!filialLoja) {
          throw new HttpError(400, 'Filial Loja (1/1 - Varejo) não encontrada no cadastro de Filiais.')
        }

        const cx = await buscarCaixaPorCodigo(tx, ctx.tenantId, body.ean_caixa || '')
        if (cx.status !== 'DISPONIVEL') {
          throw new HttpError(409, `Caixa ${cx.eanCaixa} não está disponível (status atual: ${cx.status}).`)
        }
        if (cx.filialId === filialLoja.id) {
          throw new HttpError(409, `Caixa ${cx.eanCaixa} já pertence à filial ${filialLoja.codigo} - ${filialLoja.nome}.`)
        }

        const [prod] = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.id, cx.produtoId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto da caixa não encontrado.')

        const pesoKg = toNum(cx.pesoKg, 0)
        const valorUnit = toNum(prod.custoMedioKg, 0) > 0 ? toNum(prod.custoMedioKg, 0) : toNum(prod.valorUnitario, 0)
        const valorTotal = Number((pesoKg * valorUnit).toFixed(2))
        const especie = detectarEspecieProduto({ grupo: prod.grupo, ncm: prod.ncm, descricao: prod.descricao })
        const endAnterior = cx.endereco || ''

        // 1. Baixa caixa da câmara fria (1/2)
        await tx
          .update(estoqueCaixas)
          .set({
            status: 'TRANSFERIDA_LOJA',
            endereco: `LOJA-${filialLoja.codigo}`,
            paleteId: null,
            updatedAt: new Date(),
          })
          .where(eq(estoqueCaixas.id, cx.id))

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, cx.filialId, [endAnterior])

        // 2. Soma saldo na hora no Estoque da Loja (1/1)
        const [estLoja] = await tx
          .select()
          .from(varejoEstoque)
          .where(
            and(
              eq(varejoEstoque.tenantId, ctx.tenantId),
              eq(varejoEstoque.filialId, filialLoja.id),
              eq(varejoEstoque.produtoId, prod.id),
            ),
          )
          .limit(1)

        const saldoAnt = estLoja ? toNum(estLoja.saldoQtd, 0) : 0
        const saldoNovo = Number((saldoAnt + pesoKg).toFixed(3))

        if (estLoja) {
          await tx
            .update(varejoEstoque)
            .set({ saldoQtd: toDec(saldoNovo, 3), updatedAt: new Date() })
            .where(eq(varejoEstoque.id, estLoja.id))
        } else {
          await tx.insert(varejoEstoque).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            filialId: filialLoja.id,
            produtoId: prod.id,
            unidadeVenda: 'KG',
            saldoQtd: toDec(saldoNovo, 3),
            precoVendaVarejo: toDec(toNum(prod.valorUnitario, 0) || valorUnit, 4),
            estoqueMinimo: '0.000',
            codigoBalanca: (prod.codigo || '').replace(/\D/g, '').slice(-5),
            setorLoja: especie === 'OUTROS' ? 'EMPORIO' : 'ACOUGUE',
          })
        }

        const movId = uuidv7()
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'INTERUNIDADES', 'TRL', 5)

        await tx.insert(interunidadesMovimentacoes).values({
          id: movId,
          tenantId: ctx.tenantId,
          codigo,
          tipoOperacao: 'TRANSFERENCIA_LOJA',
          filialOrigemId: cx.filialId,
          filialDestinoId: filialLoja.id,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          produtoId: prod.id,
          produtoCodigo: prod.codigo || '',
          produtoDescricao: prod.descricao,
          especie,
          pesoKg: toDec(pesoKg, 3),
          valorUnitarioKg: toDec(valorUnit, 4),
          valorTotal: toDec(valorTotal, 2),
          requerFaturamento: 1,
          statusFiscal: 'PENDENTE',
          dataMovimento: hojeIsoLocal(),
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          observacao: String(body.observacao || '').trim() || `Transferência bipada para ${filialLoja.codigo} - ${filialLoja.nome}`,
        })

        await tx.insert(varejoMovimentacoes).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          filialId: filialLoja.id,
          produtoId: prod.id,
          tipo: 'ENTRADA_TRANSFERENCIA',
          qtd: toDec(pesoKg, 3),
          saldoAnterior: toDec(saldoAnt, 3),
          saldoNovo: toDec(saldoNovo, 3),
          referenciaTipo: 'INTERUNIDADES',
          referenciaId: movId,
          observacao: `Caixa ${cx.eanCaixa} recebida da Matriz (${codigo})`,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
        })

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          operacao: 'TRANSFERENCIA_LOJA',
          detalhes: `Transferida para ${filialLoja.codigo} - ${filialLoja.nome} (${codigo}) • ${pesoKg.toFixed(3)} kg`,
          operadorNome: ctx.operador.nome,
        })

        await registrarMovimentacaoLog(tx, {
          tenantId: ctx.tenantId,
          filialId: cx.filialId,
          produtoId: prod.id,
          enderecoOrigem: endAnterior,
          enderecoDestino: `LOJA-${filialLoja.codigo}`,
          lote: cx.lote || '',
          qtdCaixas: 1,
          qtdKg: pesoKg,
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          tipo: 'TRANSFERENCIA',
        })

        return {
          id: movId,
          codigo,
          ean_caixa: cx.eanCaixa,
          produto_codigo: prod.codigo || '',
          produto_descricao: prod.descricao,
          especie,
          peso_kg: pesoKg,
          valor_total: valorTotal,
          saldo_loja_novo: saldoNovo,
          filial_destino: `${filialLoja.codigo} - ${filialLoja.nome}`,
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── 2) REMESSA P/ INDUSTRIALIZAÇÃO (1/2 -> 2/1 FG FOODS) BIPANDO A CAIXA ────
  app.post(
    '/api/interunidades/bipar-remessa-industrializacao',
    { preHandler: requirePermission(['interunidades', 'movimentacao', 'producao_entrada']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        ean_caixa?: string
        filial_destino_id?: string
        especie?: string
        observacao?: string
      }

      const out = await conn.db.transaction(async (tx) => {
        const mapa = await carregarMapaFiliais(tx, ctx.tenantId)
        const filialInd =
          (body.filial_destino_id
            ? mapa.todas.find((f) => f.id === body.filial_destino_id)
            : mapa.industria) || null
        if (!filialInd) {
          throw new HttpError(400, 'Filial Industrial (2/1 - FG Foods) não encontrada no cadastro de Filiais.')
        }

        const cx = await buscarCaixaPorCodigo(tx, ctx.tenantId, body.ean_caixa || '')
        if (cx.status !== 'DISPONIVEL') {
          throw new HttpError(409, `Caixa ${cx.eanCaixa} não está disponível (status atual: ${cx.status}).`)
        }
        if (cx.filialId === filialInd.id) {
          throw new HttpError(409, `Caixa ${cx.eanCaixa} já está na unidade ${filialInd.codigo} - ${filialInd.nome}.`)
        }

        const [prod] = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.id, cx.produtoId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto da caixa não encontrado.')

        const pesoKg = toNum(cx.pesoKg, 0)
        const valorUnit = toNum(prod.custoMedioKg, 0) > 0 ? toNum(prod.custoMedioKg, 0) : toNum(prod.valorUnitario, 0)
        const valorTotal = Number((pesoKg * valorUnit).toFixed(2))
        const especieDetectada = detectarEspecieProduto({ grupo: prod.grupo, ncm: prod.ncm, descricao: prod.descricao })
        const especie = body.especie ? normalizarEspecie(body.especie, especieDetectada) : especieDetectada

        const filialOrigId = cx.filialId
        const endAnterior = cx.endereco || ''

        // Transfere custódia da caixa para 2/1 (fica DISPONIVEL imediatamente para OP na 2/1!)
        await tx
          .update(estoqueCaixas)
          .set({
            filialId: filialInd.id,
            endereco: `IND-${filialInd.codigo}`,
            paleteId: null,
            updatedAt: new Date(),
          })
          .where(eq(estoqueCaixas.id, cx.id))

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, filialOrigId, [endAnterior])

        const movId = uuidv7()
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'INTERUNIDADES', 'REM', 5)

        await tx.insert(interunidadesMovimentacoes).values({
          id: movId,
          tenantId: ctx.tenantId,
          codigo,
          tipoOperacao: 'REMESSA_IND',
          filialOrigemId: filialOrigId,
          filialDestinoId: filialInd.id,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          produtoId: prod.id,
          produtoCodigo: prod.codigo || '',
          produtoDescricao: prod.descricao,
          especie,
          pesoKg: toDec(pesoKg, 3),
          valorUnitarioKg: toDec(valorUnit, 4),
          valorTotal: toDec(valorTotal, 2),
          requerFaturamento: 1,
          statusFiscal: 'PENDENTE',
          dataMovimento: hojeIsoLocal(),
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          observacao: String(body.observacao || '').trim() || `Remessa p/ Industrialização ${filialInd.codigo}`,
        })

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          operacao: 'REMESSA_INDUSTRIALIZACAO',
          detalhes: `Remetida para ${filialInd.codigo} - ${filialInd.nome} [${especie}] (${codigo}) • Aguardando faturamento diário CFOP 5901`,
          operadorNome: ctx.operador.nome,
        })

        return {
          id: movId,
          codigo,
          ean_caixa: cx.eanCaixa,
          produto_codigo: prod.codigo || '',
          produto_descricao: prod.descricao,
          especie,
          peso_kg: pesoKg,
          valor_total: valorTotal,
          filial_destino: `${filialInd.codigo} - ${filialInd.nome}`,
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── 3) RETORNO PRODUÇÃO -> MATRIZ (2/1 -> 1/2) BIPANDO SEM ESPERAR OP FECHAR (NÃO FATURADO) ──
  app.post(
    '/api/interunidades/bipar-retorno-producao',
    { preHandler: requirePermission(['interunidades', 'movimentacao', 'producao_saida']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        ean_caixa?: string
        endereco_destino?: string
        filial_destino_id?: string
        observacao?: string
      }

      const out = await conn.db.transaction(async (tx) => {
        const mapa = await carregarMapaFiliais(tx, ctx.tenantId)
        const filialMatriz =
          (body.filial_destino_id
            ? mapa.todas.find((f) => f.id === body.filial_destino_id)
            : mapa.matriz) || null
        if (!filialMatriz) {
          throw new HttpError(400, 'Filial Matriz (1/2 - Distribuição/Estoque) não encontrada.')
        }

        const cx = await buscarCaixaPorCodigo(tx, ctx.tenantId, body.ean_caixa || '')
        if (cx.status !== 'DISPONIVEL') {
          throw new HttpError(409, `Caixa ${cx.eanCaixa} não está disponível para transferência (status: ${cx.status}).`)
        }
        if (cx.filialId === filialMatriz.id) {
          throw new HttpError(409, `Caixa ${cx.eanCaixa} já está no estoque da Matriz (${filialMatriz.codigo}).`)
        }

        const [prod] = await tx
          .select()
          .from(produtos)
          .where(and(eq(produtos.id, cx.produtoId), eq(produtos.tenantId, ctx.tenantId)))
          .limit(1)
        if (!prod) throw new HttpError(404, 'Produto da caixa não encontrado.')

        const pesoKg = toNum(cx.pesoKg, 0)
        const valorUnit = toNum(prod.custoMedioKg, 0) > 0 ? toNum(prod.custoMedioKg, 0) : toNum(prod.valorUnitario, 0)
        const valorTotal = Number((pesoKg * valorUnit).toFixed(2))
        const especie = detectarEspecieProduto({ grupo: prod.grupo, ncm: prod.ncm, descricao: prod.descricao })

        const filialOrigId = cx.filialId
        const endAnterior = cx.endereco || ''
        const endDestino = String(body.endereco_destino || '').trim().toUpperCase() || 'EXPEDICAO-MATRIZ'

        // Transfere imediatamente para o estoque da Matriz (1/2) -> já entra disponível nos Pedidos de Venda!
        await tx
          .update(estoqueCaixas)
          .set({
            filialId: filialMatriz.id,
            endereco: endDestino,
            paleteId: null,
            updatedAt: new Date(),
          })
          .where(eq(estoqueCaixas.id, cx.id))

        await recalcularPosicaoEnderecos(tx, ctx.tenantId, filialOrigId, [endAnterior])
        await recalcularPosicaoEnderecos(tx, ctx.tenantId, filialMatriz.id, [endDestino])

        const movId = uuidv7()
        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'INTERUNIDADES', 'RET', 5)

        // Regra definida: a volta 2/1 -> 1/2 é operacional (NÃO faturada por padrão)
        await tx.insert(interunidadesMovimentacoes).values({
          id: movId,
          tenantId: ctx.tenantId,
          codigo,
          tipoOperacao: 'RETORNO_PROD',
          filialOrigemId: filialOrigId,
          filialDestinoId: filialMatriz.id,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          produtoId: prod.id,
          produtoCodigo: prod.codigo || '',
          produtoDescricao: prod.descricao,
          especie,
          pesoKg: toDec(pesoKg, 3),
          valorUnitarioKg: toDec(valorUnit, 4),
          valorTotal: toDec(valorTotal, 2),
          requerFaturamento: 0,
          statusFiscal: 'NAO_FATURAVEL',
          dataMovimento: hojeIsoLocal(),
          operadorId: ctx.operador.id,
          operadorNome: ctx.operador.nome,
          observacao:
            String(body.observacao || '').trim() ||
            `Retorno operacional 2/1 → ${filialMatriz.codigo} (pronto para Pedidos de Venda • sem faturamento)`,
        })

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: cx.id,
          eanCaixa: cx.eanCaixa,
          operacao: 'RETORNO_PRODUCAO_MATRIZ',
          detalhes: `Transferida da 2/1 para Matriz ${filialMatriz.codigo} (${endDestino}) • ${codigo} (movimento operacional sem NF)`,
          operadorNome: ctx.operador.nome,
        })

        return {
          id: movId,
          codigo,
          ean_caixa: cx.eanCaixa,
          produto_codigo: prod.codigo || '',
          produto_descricao: prod.descricao,
          especie,
          peso_kg: pesoKg,
          endereco_destino: endDestino,
          filial_destino: `${filialMatriz.codigo} - ${filialMatriz.nome}`,
          requer_faturamento: false,
        }
      })

      return reply.code(201).send({ success: true, data: out })
    },
  )

  // ── EDITAR / AJUSTAR ESPÉCIE OU PREÇO DE REMESSA PENDENTE ANTES DE FATURAR ──
  app.patch(
    '/api/interunidades/movimentacoes/:id',
    { preHandler: requirePermission(['interunidades', 'fiscal']) },
    async (req) => {
      const ctx = req.authCtx!
      const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'movimentacao_id')
      const body = (req.body || {}) as {
        especie?: string
        valor_unitario_kg?: number
        observacao?: string
      }

      const [row] = await conn.db
        .select()
        .from(interunidadesMovimentacoes)
        .where(and(eq(interunidadesMovimentacoes.id, id), eq(interunidadesMovimentacoes.tenantId, ctx.tenantId)))
        .limit(1)

      if (!row) throw new HttpError(404, 'Movimentação inter-unidades não encontrada.')
      if (row.statusFiscal === 'FATURADO') {
        throw new HttpError(409, 'Esta movimentação já foi faturada e não pode ser alterada.')
      }

      const novaEspecie = body.especie
        ? normalizarEspecie(body.especie, row.especie as EspecieCarne)
        : row.especie
      const novoValorUnit =
        body.valor_unitario_kg !== undefined && Number.isFinite(Number(body.valor_unitario_kg))
          ? Math.max(0, Number(body.valor_unitario_kg))
          : toNum(row.valorUnitarioKg, 0)
      const pesoKg = toNum(row.pesoKg, 0)
      const novoTotal = Number((pesoKg * novoValorUnit).toFixed(2))

      await conn.db
        .update(interunidadesMovimentacoes)
        .set({
          especie: novaEspecie,
          valorUnitarioKg: toDec(novoValorUnit, 4),
          valorTotal: toDec(novoTotal, 2),
          observacao: body.observacao !== undefined ? String(body.observacao) : row.observacao,
        })
        .where(eq(interunidadesMovimentacoes.id, id))

      return {
        success: true,
        data: {
          id,
          especie: novaEspecie,
          valor_unitario_kg: novoValorUnit,
          valor_total: novoTotal,
        },
      }
    },
  )

  // ── CONSOLIDADOR DE FATURAMENTO DIÁRIO (LOTES BOVINO / SUÍNO / AVES + TRANSF. LOJA) ──
  app.get(
    '/api/interunidades/faturamento-diario',
    { preHandler: requirePermission(['interunidades', 'fiscal']) },
    async (req) => {
      const ctx = req.authCtx!
      const q = (req.query || {}) as { data_ini?: string; data_fim?: string }

      const conds = [
        eq(interunidadesMovimentacoes.tenantId, ctx.tenantId),
        eq(interunidadesMovimentacoes.requerFaturamento, 1),
        eq(interunidadesMovimentacoes.statusFiscal, 'PENDENTE'),
      ]
      if (q.data_ini && /^\d{4}-\d{2}-\d{2}$/.test(q.data_ini)) {
        conds.push(sql`${interunidadesMovimentacoes.dataMovimento} >= ${q.data_ini}`)
      }
      if (q.data_fim && /^\d{4}-\d{2}-\d{2}$/.test(q.data_fim)) {
        conds.push(sql`${interunidadesMovimentacoes.dataMovimento} <= ${q.data_fim}`)
      }

      const pendentes = await conn.db
        .select()
        .from(interunidadesMovimentacoes)
        .where(and(...conds))
        .orderBy(desc(interunidadesMovimentacoes.createdAt))

      const fs = await conn.db.select().from(filiais).where(eq(filiais.tenantId, ctx.tenantId))
      const fMap = new Map(fs.map((f) => [f.id, f]))

      // Agrupa em lotes distintos:
      // - REMESSA_IND::BOVINO / SUINO / AVES / OUTROS (CFOP 5901)
      // - TRANSFERENCIA_LOJA::GERAL (CFOP 5152)
      const lotesMap = new Map<
        string,
        {
          lote_key: string
          tipo_operacao: string
          especie: string
          cfop: string
          natureza_operacao: string
          titulo: string
          filial_origem_id: string
          filial_origem_label: string
          filial_destino_id: string
          filial_destino_label: string
          qtd_caixas: number
          peso_total_kg: number
          valor_total: number
          movimentacao_ids: string[]
          itens_consolidados: Array<{
            produto_id: string
            produto_codigo: string
            produto_descricao: string
            qtd_caixas: number
            peso_kg: number
            valor_unitario_kg: number
            valor_total: number
          }>
          movimentacoes: Array<Record<string, unknown>>
        }
      >()

      for (const m of pendentes) {
        const ehRemessa = m.tipoOperacao === 'REMESSA_IND'
        const especieChave = ehRemessa ? m.especie : 'TRANSFERENCIA_LOJA'
        const key = `${m.tipoOperacao}::${m.filialOrigemId}::${m.filialDestinoId}::${especieChave}`
        const orig = fMap.get(m.filialOrigemId)
        const dest = fMap.get(m.filialDestinoId)
        const mesmaUf = (orig?.uf || 'SP') === (dest?.uf || 'SP')
        const cfop = ehRemessa ? (mesmaUf ? '5901' : '6901') : mesmaUf ? '5152' : '6152'
        const natureza = ehRemessa
          ? `REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA (${m.especie})`
          : 'TRANSFERENCIA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS'
        const titulo = ehRemessa
          ? `Remessa Industrialização — ${m.especie} (${orig?.codigo || '1/2'} → ${dest?.codigo || '2/1'})`
          : `Transferência Matriz → Loja (${orig?.codigo || '1/2'} → ${dest?.codigo || '1/1'})`

        if (!lotesMap.has(key)) {
          lotesMap.set(key, {
            lote_key: key,
            tipo_operacao: m.tipoOperacao,
            especie: m.especie,
            cfop,
            natureza_operacao: natureza,
            titulo,
            filial_origem_id: m.filialOrigemId,
            filial_origem_label: orig ? `${orig.codigo} - ${orig.nome}` : '-',
            filial_destino_id: m.filialDestinoId,
            filial_destino_label: dest ? `${dest.codigo} - ${dest.nome}` : '-',
            qtd_caixas: 0,
            peso_total_kg: 0,
            valor_total: 0,
            movimentacao_ids: [],
            itens_consolidados: [],
            movimentacoes: [],
          })
        }

        const lote = lotesMap.get(key)!
        const peso = toNum(m.pesoKg, 0)
        const val = toNum(m.valorTotal, 0)
        const vUnit = toNum(m.valorUnitarioKg, 0)
        lote.qtd_caixas += 1
        lote.peso_total_kg = Number((lote.peso_total_kg + peso).toFixed(3))
        lote.valor_total = Number((lote.valor_total + val).toFixed(2))
        lote.movimentacao_ids.push(m.id)
        lote.movimentacoes.push({
          id: m.id,
          codigo: m.codigo,
          ean_caixa: m.eanCaixa,
          produto_codigo: m.produtoCodigo,
          produto_descricao: m.produtoDescricao,
          especie: m.especie,
          peso_kg: peso,
          valor_unitario_kg: vUnit,
          valor_total: val,
          data_movimento: m.dataMovimento,
          op_id: m.opId,
        })

        const itemExist = lote.itens_consolidados.find((i) => i.produto_id === m.produtoId)
        if (itemExist) {
          itemExist.qtd_caixas += 1
          itemExist.peso_kg = Number((itemExist.peso_kg + peso).toFixed(3))
          itemExist.valor_total = Number((itemExist.valor_total + val).toFixed(2))
          itemExist.valor_unitario_kg =
            itemExist.peso_kg > 0 ? Number((itemExist.valor_total / itemExist.peso_kg).toFixed(4)) : vUnit
        } else {
          lote.itens_consolidados.push({
            produto_id: m.produtoId,
            produto_codigo: m.produtoCodigo,
            produto_descricao: m.produtoDescricao,
            qtd_caixas: 1,
            peso_kg: peso,
            valor_unitario_kg: vUnit,
            valor_total: val,
          })
        }
      }

      const ordemEspecie: Record<string, number> = {
        BOVINO: 1,
        SUINO: 2,
        AVES: 3,
        OUTROS: 4,
      }
      const lotes = Array.from(lotesMap.values()).sort((a, b) => {
        if (a.tipo_operacao !== b.tipo_operacao) return a.tipo_operacao === 'REMESSA_IND' ? -1 : 1
        return (ordemEspecie[a.especie] || 9) - (ordemEspecie[b.especie] || 9)
      })

      return { success: true, lotes, total_caixas_pendentes: pendentes.length }
    },
  )

  // ── EMITIR NF-e(s) DO FATURAMENTO DIÁRIO EM LOTE (SEM GERAR CONTAS A RECEBER) ──
  app.post(
    '/api/interunidades/faturamento-diario/emitir',
    { preHandler: requirePermission(['interunidades', 'fiscal']) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        lotes?: Array<{ movimentacao_ids: string[]; inf_complementar?: string }>
      }

      const lotesInput = Array.isArray(body.lotes) ? body.lotes.filter((l) => l.movimentacao_ids?.length > 0) : []
      if (lotesInput.length === 0) {
        throw new HttpError(400, 'Selecione ao menos um lote pendente para emitir NF-e.')
      }

      const notasEmitidas = await conn.db.transaction(async (tx) => {
        const [empRow] = await tx.select().from(empresas).where(eq(empresas.id, ctx.empresaId)).limit(1)
        const fs = await tx.select().from(filiais).where(eq(filiais.tenantId, ctx.tenantId))
        const fMap = new Map(fs.map((f) => [f.id, f]))
        const regras = await tx
          .select()
          .from(matrizTributaria)
          .where(eq(matrizTributaria.tenantId, ctx.tenantId))

        const outNotas: Array<{
          nota_id: string
          numero: number
          serie: number
          chave_acesso: string
          cfop: string
          natureza_operacao: string
          especie: string
          valor_total_nf: number
          qtd_caixas: number
          peso_total_kg: number
        }> = []

        for (const loteReq of lotesInput) {
          const ids = loteReq.movimentacao_ids.map((x) => parseUuidOrBadRequest(x, 'movimentacao_id'))
          const movs = await tx
            .select()
            .from(interunidadesMovimentacoes)
            .where(
              and(
                eq(interunidadesMovimentacoes.tenantId, ctx.tenantId),
                inArray(interunidadesMovimentacoes.id, ids),
                eq(interunidadesMovimentacoes.statusFiscal, 'PENDENTE'),
              ),
            )

          if (movs.length === 0) continue

          const first = movs[0]
          const fOrig = fMap.get(first.filialOrigemId)
          const fDest = fMap.get(first.filialDestinoId)
          const ehRemessa = first.tipoOperacao === 'REMESSA_IND'
          const ufOrig = (fOrig?.uf || 'SP').toUpperCase()
          const ufDest = (fDest?.uf || ufOrig).toUpperCase()
          const cfop = ehRemessa ? (ufOrig === ufDest ? '5901' : '6901') : ufOrig === ufDest ? '5152' : '6152'
          const natureza = ehRemessa
            ? `REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA (${first.especie})`
            : 'TRANSFERENCIA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS'

          // Busca/cria config fiscal da filial emitente (origem)
          let [cfg] = await tx
            .select()
            .from(fiscalConfigFilial)
            .where(
              and(
                eq(fiscalConfigFilial.tenantId, ctx.tenantId),
                eq(fiscalConfigFilial.filialId, first.filialOrigemId),
              ),
            )
            .limit(1)

          if (!cfg) {
            const cfgId = uuidv7()
            await tx.insert(fiscalConfigFilial).values({
              id: cfgId,
              tenantId: ctx.tenantId,
              filialId: first.filialOrigemId,
              ambiente: 'HOMOLOGACAO',
              provedor: 'SIMULACAO_LOCAL',
              serieNfe: 1,
              proximoNumeroNfe: 1,
              serieNfce: 1,
              proximoNumeroNfce: 1,
            })
            ;[cfg] = await tx
              .select()
              .from(fiscalConfigFilial)
              .where(eq(fiscalConfigFilial.id, cfgId))
              .limit(1)
          }

          const numeroNf = Number(cfg.proximoNumeroNfe || 1)
          const serieNf = Number(cfg.serieNfe || 1)
          await tx
            .update(fiscalConfigFilial)
            .set({ proximoNumeroNfe: numeroNf + 1, updatedAt: new Date() })
            .where(eq(fiscalConfigFilial.id, cfg.id))

          // Consolida por produto para gerar os itens da NF-e
          const prodIds = Array.from(new Set(movs.map((m) => m.produtoId)))
          const prodsDb = await tx
            .select()
            .from(produtos)
            .where(and(eq(produtos.tenantId, ctx.tenantId), inArray(produtos.id, prodIds)))
          const prodMap = new Map(prodsDb.map((p) => [p.id, p]))

          const porProd = new Map<
            string,
            { prodId: string; codigo: string; descricao: string; ncm: string; cest: string; orig: string; peso: number; valor: number }
          >()
          for (const m of movs) {
            const p = prodMap.get(m.produtoId)
            const cur = porProd.get(m.produtoId)
            const peso = toNum(m.pesoKg, 0)
            const val = toNum(m.valorTotal, 0)
            if (cur) {
              cur.peso = Number((cur.peso + peso).toFixed(3))
              cur.valor = Number((cur.valor + val).toFixed(2))
            } else {
              porProd.set(m.produtoId, {
                prodId: m.produtoId,
                codigo: p?.codigo || m.produtoCodigo || '001',
                descricao: p?.descricao || m.produtoDescricao,
                ncm: p?.ncm || '02013000',
                cest: p?.cest || '',
                orig: p?.origemMercadoria || '0',
                peso,
                valor: val,
              })
            }
          }

          const itensCalc = Array.from(porProd.values()).map((it, idx) => {
            const vUn = it.peso > 0 ? Number((it.valor / it.peso).toFixed(4)) : 0
            return calcularTributacaoItem({
              nItem: idx + 1,
              produtoId: it.prodId,
              codigo: it.codigo,
              descricao: it.descricao,
              ncm: it.ncm,
              cest: it.cest,
              orig: it.orig,
              unidade: 'KG',
              qtd: it.peso,
              valorUnitario: vUn > 0 ? vUn : 0.01,
              cfopExplicito: cfop,
              tipoOperacao: 'SAIDA',
              modelo: '55',
              tipoUnidadeFilial: fOrig?.tipoUnidade || 'DISTRIBUICAO',
              ufOrigem: ufOrig,
              ufDestino: ufDest,
              regimeTributario: empRow?.regimeTributario || 'SIMPLES',
              matrizRegras: regras,
            })
          })

          const vProd = Number(itensCalc.reduce((s, i) => s + i.valor_total, 0).toFixed(2))
          const vBC = ehRemessa ? 0 : Number(itensCalc.reduce((s, i) => s + i.v_bc_icms, 0).toFixed(2))
          const vICMS = ehRemessa ? 0 : Number(itensCalc.reduce((s, i) => s + i.v_icms, 0).toFixed(2))
          const pesoTotal = Number(movs.reduce((s, m) => s + toNum(m.pesoKg, 0), 0).toFixed(3))

          const cnpjEmit = onlyDigits(fOrig?.cnpj || empRow?.cnpj || '54142043000130') || '54142043000130'
          const { chave, cNF, cDV } = gerarChaveAcessoNfe({
            uf: ufOrig,
            cnpjEmitente: cnpjEmit,
            modelo: '55',
            serie: serieNf,
            numero: numeroNf,
          })
          const protocolo = `135${String(Date.now()).slice(-12)}`
          const dataEmissaoIso = new Date().toISOString()
          const infComp =
            String(loteReq.inf_complementar || '').trim() ||
            (ehRemessa
              ? `Suspensão de ICMS/IPI conforme Art. 402 RICMS/SP — Remessa p/ Industrialização (${first.especie}) • ${movs.length} caixa(s) • Sem efeito financeiro.`
              : `Transferência entre estabelecimentos (${fOrig?.codigo || '1/2'} → ${fDest?.codigo || '1/1'}) • ${movs.length} caixa(s) • Sem efeito financeiro.`)

          const xmlConteudo = gerarXmlNfe400({
            chave,
            cNF,
            cDV,
            protocolo,
            ambiente: cfg.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO',
            modelo: '55',
            serie: serieNf,
            numero: numeroNf,
            naturezaOperacao: natureza,
            tipoOperacao: 'SAIDA',
            finalidade: '1',
            dataEmissaoIso,
            emitente: {
              cnpj: cnpjEmit,
              razaoSocial: empRow?.razaoSocial || fOrig?.nome || 'TRICARNES ALIMENTOS LTDA',
              nomeFantasia: fOrig?.nome || empRow?.nomeFantasia || 'MATRIZ',
              ie: onlyDigits(fOrig?.inscricaoEstadual || empRow?.inscricaoEstadual || 'ISENTO') || 'ISENTO',
              crt: String(empRow?.regimeTributario || 'SIMPLES').toUpperCase() === 'SIMPLES' ? '1' : '3',
              uf: ufOrig,
              cidade: fOrig?.cidade || 'SAO PAULO',
              codigoIbge: fOrig?.codigoIbge || '3550308',
            },
            destinatario: {
              nome: `${fDest?.codigo || ''} ${fDest?.nome || 'FILIAL DESTINO'}`.trim(),
              doc: onlyDigits(fDest?.cnpj || cnpjEmit),
              ie: onlyDigits(fDest?.inscricaoEstadual || ''),
              uf: ufDest,
              cidade: fDest?.cidade || fOrig?.cidade || 'SAO PAULO',
              endereco: fDest?.nome || 'UNIDADE INTERNA',
            },
            itens: itensCalc,
            totais: {
              vProd,
              vDesc: 0,
              vFrete: 0,
              vBC,
              vICMS,
              vST: 0,
              vPIS: 0,
              vCOFINS: 0,
              vIBS: 0,
              vCBS: 0,
              vNF: vProd,
              pesoBruto: pesoTotal,
              pesoLiquido: pesoTotal,
              qtdVolumes: movs.length,
            },
            tPag: '90', // 90 = Sem Pagamento (SEFAZ padrão p/ Remessa e Transferência!)
            infComplementar: infComp,
          })

          const notaId = uuidv7()
          await tx.insert(fiscalNotas).values({
            id: notaId,
            tenantId: ctx.tenantId,
            filialId: first.filialOrigemId,
            modelo: '55',
            tipoOperacao: 'SAIDA',
            finalidade: '1',
            ambiente: cfg.ambiente || 'HOMOLOGACAO',
            provedorUsado: cfg.provedor || 'SIMULACAO_LOCAL',
            serie: serieNf,
            numero: numeroNf,
            chaveAcesso: chave,
            protocoloAutorizacao: protocolo,
            dataAutorizacao: new Date(),
            status: 'AUTORIZADA',
            naturezaOperacao: natureza,
            destinatarioNome: `${fDest?.codigo || ''} - ${fDest?.nome || 'UNIDADE INTERNA'}`.trim(),
            destinatarioDoc: onlyDigits(fDest?.cnpj || cnpjEmit),
            destinatarioIe: onlyDigits(fDest?.inscricaoEstadual || ''),
            destinatarioUf: ufDest,
            destinatarioCidade: fDest?.cidade || '',
            destinatarioEndereco: fDest?.nome || '',
            formaPagamentoLabel: '90 - Sem Pagamento (Operação Interna)',
            valorProdutos: toDec(vProd, 2),
            valorDesconto: '0.00',
            valorFrete: '0.00',
            valorIcmsBase: toDec(vBC, 2),
            valorIcms: toDec(vICMS, 2),
            valorIcmsSt: '0.00',
            valorPis: '0.00',
            valorCofins: '0.00',
            valorIbs: '0.00',
            valorCbs: '0.00',
            valorTotalNf: toDec(vProd, 2),
            modFrete: '9',
            pesoBrutoKg: toDec(pesoTotal, 3),
            pesoLiquidoKg: toDec(pesoTotal, 3),
            qtdVolumes: movs.length,
            itensJson: itensCalc as unknown as Array<Record<string, unknown>>,
            xmlConteudo,
            infComplementar: infComp,
            emitidaPorId: ctx.operador.id,
          })

          // Marca todas as movimentações deste lote como FATURADO (e NUNCA gera Contas a Receber!)
          const movIdsOk = movs.map((m) => m.id)
          await tx
            .update(interunidadesMovimentacoes)
            .set({
              statusFiscal: 'FATURADO',
              notaFiscalId: notaId,
              numeroNf,
            })
            .where(inArray(interunidadesMovimentacoes.id, movIdsOk))

          outNotas.push({
            nota_id: notaId,
            numero: numeroNf,
            serie: serieNf,
            chave_acesso: chave,
            cfop,
            natureza_operacao: natureza,
            especie: first.especie,
            valor_total_nf: vProd,
            qtd_caixas: movs.length,
            peso_total_kg: pesoTotal,
          })
        }

        return outNotas
      })

      return reply.code(201).send({
        success: true,
        total_notas_emitidas: notasEmitidas.length,
        notas: notasEmitidas,
      })
    },
  )
}
