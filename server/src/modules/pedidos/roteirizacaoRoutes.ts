import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import {
  clientes,
  embarques,
  entregasTracking,
  estoqueCaixas,
  fiscalNotas,
  pedidos,
  pedidosItens,
  produtos,
  romaneios,
  romaneiosItens,
  rotas,
  tenants,
  tiposVeiculo,
  transportadoras,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { baixarTitulosPedidoEntregaConfirmada } from '../financeiro/integracaoHelper.js'
import {
  gerarCodigoDocumento,
  hojeIsoLocal,
  lerTenantFeatures,
  normalizarDataIso,
  parseUuidOrBadRequest,
  recalcularPosicaoEnderecos,
  registrarHistoricoCaixa,
  registrarMovimentacaoLog,
  toNum,
} from '../wms/helpers.js'

const PERM_ROT_VIEW = ['roteirizacao', 'roteirizacao_carregamento', 'pedidos', 'saida', 'expedicao', 'transportadoras']
const PERM_ROT_GESTAO = ['roteirizacao', 'pedidos', 'transportadoras']
const PERM_ROT_BIPAR = ['roteirizacao_carregamento', 'saida', 'expedicao', 'roteirizacao']

const STATUS_EMBARQUE_ABERTO = ['PLANEJADO', 'EM_CARREGAMENTO', 'EM_ROTA']
const STATUS_PEDIDO_PRONTO = ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO']

function fmtDataBr(iso?: string | null) {
  if (!iso) return ''
  const s = String(iso).slice(0, 10)
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

function calcPesoBrutoCaixa(pesoLiq: unknown, pesoBruto: unknown, taraKg: unknown): number {
  const pb = toNum(pesoBruto, 0)
  if (pb > 0) return pb
  return toNum(pesoLiq, 0) + toNum(taraKg, 0)
}

async function calcularPesoCargaPedidos(
  dbOrTx: Pick<DbConnection['db'], 'execute'>,
  pedIds: string[],
): Promise<number> {
  if (pedIds.length === 0) return 0
  const inSql = sql.join(pedIds.map((id) => sql`${id}::uuid`), sql`, `)
  const res = await dbOrTx.execute(sql`
    SELECT
      p.id,
      COALESCE((
        SELECT SUM(
          CASE WHEN ec.peso_bruto_kg IS NOT NULL AND ec.peso_bruto_kg > 0
            THEN ec.peso_bruto_kg
            ELSE COALESCE(ri.peso_kg, 0) + COALESCE(ec.tara_kg, 0)
          END
        )
        FROM romaneios_itens ri
        JOIN romaneios r ON r.id = ri.romaneio_id
        JOIN estoque_caixas ec ON ec.id = ri.caixa_id
        WHERE r.pedido_id = p.id
      ), 0) AS bruto_sep,
      COALESCE((
        SELECT SUM(pi.qtd_kg_solicitada)
        FROM pedidos_itens pi
        WHERE pi.pedido_id = p.id
      ), 0) AS kg_ped
    FROM pedidos p
    WHERE p.id IN (${inSql})
  `)
  let total = 0
  for (const row of res.rows as Array<Record<string, unknown>>) {
    const bruto = toNum(row.bruto_sep, 0)
    const kgPed = toNum(row.kg_ped, 0)
    total += bruto > 0 ? bruto : kgPed
  }
  return Number(total.toFixed(3))
}

async function resolverLimitesVeiculo(
  dbOrTx: Pick<DbConnection['db'], 'select'>,
  tenantId: string,
  tipoVeiculoId?: string | null,
  fallbackCap?: unknown,
  fallbackTol?: unknown,
) {
  if (tipoVeiculoId) {
    const [tv] = await dbOrTx
      .select()
      .from(tiposVeiculo)
      .where(and(eq(tiposVeiculo.id, tipoVeiculoId), eq(tiposVeiculo.tenantId, tenantId)))
      .limit(1)
    if (!tv || tv.ativo === 0) {
      throw new HttpError(400, 'Tipo de veículo selecionado não encontrado ou inativo no cadastro.')
    }
    const cap = toNum(tv.capacidadeKg, 0)
    const tol = toNum(tv.toleranciaPct, 10)
    return {
      nome: tv.nome,
      capacidade_kg: cap,
      tolerancia_pct: tol,
      capacidade_maxima_kg: Number((cap * (1 + tol / 100)).toFixed(2)),
    }
  }
  const cap = toNum(fallbackCap, 0)
  const tol = toNum(fallbackTol, 10)
  return {
    nome: 'Veículo',
    capacidade_kg: cap,
    tolerancia_pct: tol,
    capacidade_maxima_kg: cap > 0 ? Number((cap * (1 + tol / 100)).toFixed(2)) : 0,
  }
}

async function validarCapacidadeEmbarque(
  dbOrTx: Pick<DbConnection['db'], 'select' | 'execute'>,
  opts: {
    tenantId: string
    tipoVeiculoId?: string | null
    capacidadeKg?: unknown
    toleranciaPct?: unknown
    pedIdsResultantes: string[]
  },
) {
  const lim = await resolverLimitesVeiculo(
    dbOrTx,
    opts.tenantId,
    opts.tipoVeiculoId,
    opts.capacidadeKg,
    opts.toleranciaPct,
  )
  if (!lim.capacidade_kg || lim.capacidade_kg <= 0 || opts.pedIdsResultantes.length === 0) return lim
  const pesoCargaKg = await calcularPesoCargaPedidos(dbOrTx, opts.pedIdsResultantes)
  if (pesoCargaKg > lim.capacidade_maxima_kg + 0.001) {
    throw new HttpError(
      409,
      `Capacidade do veículo "${lim.nome}" excedida! Carga do roteiro (${pesoCargaKg.toFixed(2)} kg) ultrapassa o limite máximo com tolerância de +${lim.tolerancia_pct}% (${lim.capacidade_maxima_kg.toFixed(2)} kg).`,
    )
  }
  return lim
}

export function registerRoteirizacaoRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)

  // Lista embarques (Em Aberto ou Histórico) com métricas e config do módulo
  app.get(
    '/api/roteirizacao/embarques',
    { preHandler: requirePermission(PERM_ROT_VIEW, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { status_grupo?: string }
      const grupo = String(q.status_grupo || 'ABERTO').trim().toUpperCase()

      const conds = [eq(embarques.tenantId, ctx.tenantId), eq(embarques.filialId, ctx.filialId)]
      if (grupo === 'ABERTO') {
        conds.push(inArray(embarques.status, STATUS_EMBARQUE_ABERTO))
      } else if (grupo === 'HISTORICO') {
        conds.push(inArray(embarques.status, ['CONCLUIDO', 'CANCELADO']))
      }

      const [rows, features] = await Promise.all([
        conn.db
          .select({
            id: embarques.id,
            codigo: embarques.codigo,
            titulo: embarques.titulo,
            data_embarque: embarques.dataEmbarque,
            status: embarques.status,
            rota_id: embarques.rotaId,
            rota_nome: rotas.nome,
            rota_regiao: rotas.regiao,
            transportadora_id: embarques.transportadoraId,
            transportadora_nome: transportadoras.nomeFantasia,
            tipo_veiculo_id: embarques.tipoVeiculoId,
            tipo_veiculo_nome: tiposVeiculo.nome,
            tipo_veiculo_categoria: tiposVeiculo.categoria,
            capacidade_kg: embarques.capacidadeKg,
            tolerancia_pct: embarques.toleranciaPct,
            horario_saida: embarques.horarioSaida,
            temperatura_bau: embarques.temperaturaBau,
            motorista_id: embarques.motoristaId,
            motorista_nome: embarques.motoristaNome,
            veiculo_placa: embarques.veiculoPlaca,
            modalidade_impressao: embarques.modalidadeImpressao,
            qr_token: embarques.qrToken,
            numero_nf_lote: embarques.numeroNfLote,
            observacoes: embarques.observacoes,
            operador_carregamento_nome: embarques.operadorCarregamentoNome,
            iniciado_em: embarques.iniciadoEm,
            concluido_em: embarques.concluidoEm,
            created_at: embarques.createdAt,
          })
          .from(embarques)
          .leftJoin(rotas, eq(rotas.id, embarques.rotaId))
          .leftJoin(transportadoras, eq(transportadoras.id, embarques.transportadoraId))
          .leftJoin(tiposVeiculo, eq(tiposVeiculo.id, embarques.tipoVeiculoId))
          .where(and(...conds))
          .orderBy(desc(embarques.dataEmbarque), desc(embarques.createdAt))
          .limit(120),
        lerTenantFeatures(conn.db, ctx.tenantId),
      ])

      if (rows.length === 0) {
        return {
          success: true,
          config: {
            rastreio_motorista_ativo: features.rastreio_motorista_ativo !== false,
            impressao_romaneio_padrao:
              String(features.impressao_romaneio_padrao || 'OPCAO_B') === 'OPCAO_A' ? 'OPCAO_A' : 'OPCAO_B',
          },
          data: [],
        }
      }

      const embIds = rows.map((r) => r.id)
      const [stops, romItensRows] = await Promise.all([
        conn.db
          .select({
            embarque_id: entregasTracking.embarqueId,
            pedido_id: entregasTracking.pedidoId,
            status_entrega: entregasTracking.statusEntrega,
            pedido_status: pedidos.status,
            valor_total: pedidos.valorTotal,
            cliente_cidade: clientes.cidade,
            total_kg_solicitado: sql<string>`COALESCE((SELECT ROUND(SUM(pi.qtd_kg_solicitada), 3) FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id}), 0)`,
          })
          .from(entregasTracking)
          .innerJoin(pedidos, eq(pedidos.id, entregasTracking.pedidoId))
          .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
          .where(inArray(entregasTracking.embarqueId, embIds)),
        conn.db
          .select({
            embarque_id: romaneios.embarqueId,
            pedido_id: romaneios.pedidoId,
            peso_kg: romaneiosItens.pesoKg,
            peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
            tara_kg: estoqueCaixas.taraKg,
            carregado_veiculo: romaneiosItens.carregadoVeiculo,
            conferido: romaneiosItens.conferido,
          })
          .from(romaneiosItens)
          .innerJoin(romaneios, eq(romaneios.id, romaneiosItens.romaneioId))
          .leftJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
          .where(inArray(romaneios.embarqueId, embIds)),
      ])

      const brutoPorPed = new Map<string, number>()
      const statsMap = new Map<
        string,
        {
          total_pedidos: number
          pedidos_prontos: number
          pedidos_expedidos: number
          pedidos_entregues: number
          peso_pedido_kg: number
          peso_real_kg: number
          peso_bruto_kg: number
          valor_total: number
          total_caixas: number
          caixas_carregadas: number
          cidades: Set<string>
        }
      >()
      const getStat = (id: string) => {
        if (!statsMap.has(id)) {
          statsMap.set(id, {
            total_pedidos: 0,
            pedidos_prontos: 0,
            pedidos_expedidos: 0,
            pedidos_entregues: 0,
            peso_pedido_kg: 0,
            peso_real_kg: 0,
            peso_bruto_kg: 0,
            valor_total: 0,
            total_caixas: 0,
            caixas_carregadas: 0,
            cidades: new Set(),
          })
        }
        return statsMap.get(id)!
      }

      for (const ri of romItensRows) {
        if (!ri.embarque_id) continue
        const st = getStat(ri.embarque_id)
        const pb = calcPesoBrutoCaixa(ri.peso_kg, ri.peso_bruto_kg, ri.tara_kg)
        st.total_caixas += 1
        st.peso_real_kg += toNum(ri.peso_kg, 0)
        st.peso_bruto_kg += pb
        if (ri.pedido_id) {
          brutoPorPed.set(ri.pedido_id, (brutoPorPed.get(ri.pedido_id) || 0) + pb)
        }
        if (Number(ri.carregado_veiculo) === 1 || Number(ri.conferido) === 1) {
          st.caixas_carregadas += 1
        }
      }

      const cargaPorEmb = new Map<string, number>()
      for (const s of stops) {
        const st = getStat(s.embarque_id)
        st.total_pedidos += 1
        if (STATUS_PEDIDO_PRONTO.includes(s.pedido_status)) st.pedidos_prontos += 1
        if (s.pedido_status === 'EXPEDIDO') st.pedidos_expedidos += 1
        if (s.status_entrega === 'ENTREGUE') st.pedidos_entregues += 1
        const kgPed = toNum(s.total_kg_solicitado, 0)
        st.peso_pedido_kg += kgPed
        st.valor_total += toNum(s.valor_total, 0)
        if (s.cliente_cidade?.trim()) st.cidades.add(s.cliente_cidade.trim().toUpperCase())
        const pbPed = brutoPorPed.get(s.pedido_id) || 0
        cargaPorEmb.set(s.embarque_id, (cargaPorEmb.get(s.embarque_id) || 0) + (pbPed > 0 ? pbPed : kgPed))
      }

      return {
        success: true,
        config: {
          rastreio_motorista_ativo: features.rastreio_motorista_ativo !== false,
          impressao_romaneio_padrao:
            String(features.impressao_romaneio_padrao || 'OPCAO_B') === 'OPCAO_A' ? 'OPCAO_A' : 'OPCAO_B',
        },
        data: rows.map((r) => {
          const st = getStat(r.id)
          const cap = toNum(r.capacidade_kg, 0)
          const tol = toNum(r.tolerancia_pct, 10)
          const capMax = cap > 0 ? Number((cap * (1 + tol / 100)).toFixed(2)) : 0
          const pesoCarga = cargaPorEmb.get(r.id) || (st.peso_real_kg > 0 ? st.peso_real_kg : st.peso_pedido_kg)
          return {
            ...r,
            capacidade_kg: cap > 0 ? Number(cap.toFixed(2)) : null,
            tolerancia_pct: Number(tol.toFixed(2)),
            capacidade_maxima_kg: capMax || null,
            temperatura_bau: r.temperatura_bau != null ? toNum(r.temperatura_bau, 0) : null,
            cidades_count: st.cidades.size,
            total_pedidos: st.total_pedidos,
            pedidos_prontos: st.pedidos_prontos,
            pedidos_expedidos: st.pedidos_expedidos,
            pedidos_entregues: st.pedidos_entregues,
            total_caixas: st.total_caixas,
            caixas_carregadas: st.caixas_carregadas,
            peso_bruto_kg: Number(st.peso_bruto_kg.toFixed(2)),
            peso_total_kg: Number(pesoCarga.toFixed(2)),
            valor_total: Number(st.valor_total.toFixed(2)),
          }
        }),
      }
    },
  )

  // Pedidos elegíveis para montar ou adicionar em um roteiro (filtrados estritamente pela data de embarque)
  app.get(
    '/api/roteirizacao/pedidos-disponiveis',
    { preHandler: requirePermission(PERM_ROT_GESTAO, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const q = req.query as { embarque_id?: string; data_embarque?: string }
      const embarqueAtualId = q.embarque_id ? parseUuidOrBadRequest(q.embarque_id, 'embarque_id') : null
      let dataFiltro = normalizarDataIso(q.data_embarque)
      if (!dataFiltro && embarqueAtualId) {
        const [embRef] = await conn.db
          .select({ dataEmbarque: embarques.dataEmbarque })
          .from(embarques)
          .where(and(eq(embarques.id, embarqueAtualId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        dataFiltro = embRef?.dataEmbarque ? String(embRef.dataEmbarque).slice(0, 10) : null
      }

      const pedConds = [
        eq(pedidos.tenantId, ctx.tenantId),
        eq(pedidos.filialId, ctx.filialId),
        inArray(pedidos.status, ['LIBERADO', 'EM_SEPARACAO', 'AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO']),
      ]
      if (dataFiltro) {
        pedConds.push(sql`${pedidos.previsaoEntrega} = ${dataFiltro}::date`)
      }

      const [pedRows, ativosTracking] = await Promise.all([
        conn.db
          .select({
            id: pedidos.id,
            codigo: pedidos.codigo,
            titulo: pedidos.titulo,
            cliente_id: pedidos.clienteId,
            cliente: pedidos.cliente,
            cliente_cidade: clientes.cidade,
            cliente_uf: clientes.uf,
            cliente_endereco: clientes.endereco,
            status: pedidos.status,
            previsao_entrega: pedidos.previsaoEntrega,
            valor_total: pedidos.valorTotal,
            pagamento_na_entrega: pedidos.pagamentoNaEntrega,
            total_kg_solicitado: sql<string>`COALESCE((SELECT ROUND(SUM(pi.qtd_kg_solicitada), 3) FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id}), 0)`,
            romaneio_id: sql<string | null>`(SELECT r.id FROM romaneios r WHERE r.pedido_id = ${pedidos.id} ORDER BY r.created_at DESC LIMIT 1)`,
            romaneio_codigo: sql<string | null>`(SELECT r.codigo FROM romaneios r WHERE r.pedido_id = ${pedidos.id} ORDER BY r.created_at DESC LIMIT 1)`,
            total_kg_separado: sql<string>`COALESCE((SELECT ROUND(SUM(ri.peso_kg), 3) FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id WHERE r.pedido_id = ${pedidos.id}), 0)`,
            total_bruto_separado: sql<string>`COALESCE((SELECT ROUND(SUM(CASE WHEN ec.peso_bruto_kg IS NOT NULL AND ec.peso_bruto_kg > 0 THEN ec.peso_bruto_kg ELSE COALESCE(ri.peso_kg, 0) + COALESCE(ec.tara_kg, 0) END), 3) FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id LEFT JOIN estoque_caixas ec ON ec.id = ri.caixa_id WHERE r.pedido_id = ${pedidos.id}), 0)`,
            total_caixas_separadas: sql<number>`COALESCE((SELECT COUNT(*)::int FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id WHERE r.pedido_id = ${pedidos.id}), 0)`,
          })
          .from(pedidos)
          .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
          .where(and(...pedConds))
          .orderBy(desc(pedidos.previsaoEntrega), desc(pedidos.createdAt))
          .limit(200),
        conn.db
          .select({
            pedido_id: entregasTracking.pedidoId,
            embarque_id: entregasTracking.embarqueId,
            embarque_codigo: embarques.codigo,
            embarque_status: embarques.status,
          })
          .from(entregasTracking)
          .innerJoin(embarques, eq(embarques.id, entregasTracking.embarqueId))
          .where(and(eq(embarques.tenantId, ctx.tenantId), sql`${embarques.status} != 'CANCELADO'`)),
      ])

      const vinculoMap = new Map<string, { embarque_id: string; embarque_codigo: string }>()
      for (const v of ativosTracking) {
        vinculoMap.set(v.pedido_id, { embarque_id: v.embarque_id, embarque_codigo: v.embarque_codigo })
      }

      const disponiveis = pedRows
        .map((p) => {
          const vinc = vinculoMap.get(p.id)
          const jaNesteEmbarque = Boolean(vinc && embarqueAtualId && vinc.embarque_id === embarqueAtualId)
          const emOutroEmbarque = Boolean(vinc && (!embarqueAtualId || vinc.embarque_id !== embarqueAtualId))
          const kgSep = toNum(p.total_kg_separado, 0)
          const brutoSep = toNum(p.total_bruto_separado, 0)
          const kgSolic = toNum(p.total_kg_solicitado, 0)
          const cxSep = Number(p.total_caixas_separadas || 0)
          const pronto = STATUS_PEDIDO_PRONTO.includes(p.status) && cxSep > 0
          return {
            ...p,
            valor_total: toNum(p.valor_total, 0),
            total_kg_solicitado: kgSolic,
            total_kg_separado: kgSep,
            total_bruto_separado: brutoSep,
            peso_carga_kg: brutoSep > 0 ? brutoSep : kgSolic,
            total_caixas_separadas: cxSep,
            pronto_para_embarque: pronto,
            ja_neste_embarque: jaNesteEmbarque,
            em_outro_embarque_codigo: emOutroEmbarque ? vinc!.embarque_codigo : null,
          }
        })
        .filter((p) => !p.ja_neste_embarque && !p.em_outro_embarque_codigo)

      return { success: true, data: disponiveis }
    },
  )

  // Criar novo Embarque / Roteiro
  app.post(
    '/api/roteirizacao/embarques',
    { preHandler: requirePermission(PERM_ROT_GESTAO) },
    async (req, reply) => {
      const ctx = req.authCtx!
      const body = (req.body || {}) as {
        data_embarque?: string
        titulo?: string
        rota_id?: string | null
        transportadora_id?: string | null
        tipo_veiculo_id?: string | null
        horario_saida?: string
        motorista_nome?: string
        veiculo_placa?: string
        modalidade_impressao?: 'OPCAO_B' | 'OPCAO_A'
        numero_nf_lote?: string
        observacoes?: string
        pedido_ids?: string[]
      }

      const dataEmb = normalizarDataIso(body.data_embarque) || hojeIsoLocal()
      const tipoVeiculoId = body.tipo_veiculo_id ? parseUuidOrBadRequest(body.tipo_veiculo_id, 'tipo_veiculo_id') : null
      const pedIds = Array.isArray(body.pedido_ids)
        ? Array.from(new Set(body.pedido_ids.map((id) => parseUuidOrBadRequest(id, 'pedido_id'))))
        : []

      const features = await lerTenantFeatures(conn.db, ctx.tenantId)
      const modalidadePadrao =
        String(body.modalidade_impressao || features.impressao_romaneio_padrao || 'OPCAO_B') === 'OPCAO_A'
          ? 'OPCAO_A'
          : 'OPCAO_B'

      const created = await conn.db.transaction(async (tx) => {
        const lim = await validarCapacidadeEmbarque(tx, {
          tenantId: ctx.tenantId,
          tipoVeiculoId,
          pedIdsResultantes: pedIds,
        })

        const codigo = await gerarCodigoDocumento(tx, ctx.tenantId, 'EMBARQUE', 'EMB', 4)
        const embId = uuidv7()
        const qrToken = uuidv7()
        const tituloFinal = String(body.titulo || '').trim() || `ROTEIRO ${fmtDataBr(dataEmb)} (${codigo})`

        await tx.insert(embarques).values({
          id: embId,
          tenantId: ctx.tenantId,
          filialId: ctx.filialId,
          codigo,
          titulo: tituloFinal,
          rotaId: body.rota_id ? parseUuidOrBadRequest(body.rota_id, 'rota_id') : null,
          transportadoraId: body.transportadora_id
            ? parseUuidOrBadRequest(body.transportadora_id, 'transportadora_id')
            : null,
          tipoVeiculoId,
          capacidadeKg: lim.capacidade_kg > 0 ? String(lim.capacidade_kg) : null,
          toleranciaPct: String(lim.tolerancia_pct ?? 10),
          horarioSaida: String(body.horario_saida || '').trim(),
          motoristaNome: String(body.motorista_nome || '').trim(),
          veiculoPlaca: String(body.veiculo_placa || '').trim().toUpperCase(),
          modalidadeImpressao: modalidadePadrao,
          qrToken,
          numeroNfLote: String(body.numero_nf_lote || '').trim(),
          observacoes: String(body.observacoes || '').trim(),
          dataEmbarque: dataEmb,
          status: 'PLANEJADO',
        })

        if (pedIds.length > 0) {
          const romRows = await tx
            .select({ id: romaneios.id, pedidoId: romaneios.pedidoId })
            .from(romaneios)
            .where(inArray(romaneios.pedidoId, pedIds))
          const romByPed = new Map<string, string>()
          for (const r of romRows) {
            if (r.pedidoId) romByPed.set(r.pedidoId, r.id)
          }

          await tx.insert(entregasTracking).values(
            pedIds.map((pid, idx) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              embarqueId: embId,
              pedidoId: pid,
              romaneioId: romByPed.get(pid) || null,
              ordemParada: idx + 1,
              statusEntrega: 'PENDENTE',
            })),
          )

          const romIdsToLink = pedIds.map((pid) => romByPed.get(pid)).filter(Boolean) as string[]
          if (romIdsToLink.length > 0) {
            await tx.update(romaneios).set({ embarqueId: embId }).where(inArray(romaneios.id, romIdsToLink))
          }
        }

        return { id: embId, codigo, titulo: tituloFinal, qr_token: qrToken, data_embarque: dataEmb }
      })

      return reply.code(201).send({ success: true, ...created })
    },
  )

  // Detalhe dinâmico completo do Embarque (paradas ordenadas, produtos, caixas e rastreio)
  app.get(
    '/api/roteirizacao/embarques/:id',
    { preHandler: requirePermission(PERM_ROT_VIEW, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')

      const [[emb], features] = await Promise.all([
        conn.db
          .select({
            id: embarques.id,
            codigo: embarques.codigo,
            titulo: embarques.titulo,
            data_embarque: embarques.dataEmbarque,
            status: embarques.status,
            rota_id: embarques.rotaId,
            rota_nome: rotas.nome,
            transportadora_id: embarques.transportadoraId,
            transportadora_nome: transportadoras.nomeFantasia,
            tipo_veiculo_id: embarques.tipoVeiculoId,
            tipo_veiculo_nome: tiposVeiculo.nome,
            tipo_veiculo_categoria: tiposVeiculo.categoria,
            capacidade_kg: embarques.capacidadeKg,
            tolerancia_pct: embarques.toleranciaPct,
            horario_saida: embarques.horarioSaida,
            temperatura_bau: embarques.temperaturaBau,
            motorista_nome: embarques.motoristaNome,
            veiculo_placa: embarques.veiculoPlaca,
            modalidade_impressao: embarques.modalidadeImpressao,
            qr_token: embarques.qrToken,
            numero_nf_lote: embarques.numeroNfLote,
            observacoes: embarques.observacoes,
            operador_carregamento_nome: embarques.operadorCarregamentoNome,
            iniciado_em: embarques.iniciadoEm,
            concluido_em: embarques.concluidoEm,
            created_at: embarques.createdAt,
          })
          .from(embarques)
          .leftJoin(rotas, eq(rotas.id, embarques.rotaId))
          .leftJoin(transportadoras, eq(transportadoras.id, embarques.transportadoraId))
          .leftJoin(tiposVeiculo, eq(tiposVeiculo.id, embarques.tipoVeiculoId))
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1),
        lerTenantFeatures(conn.db, ctx.tenantId),
      ])

      if (!emb) throw new HttpError(404, 'Embarque / Roteiro não encontrado.')

      const stopsRows = await conn.db
        .select({
          tracking_id: entregasTracking.id,
          ordem_parada: entregasTracking.ordemParada,
          status_entrega: entregasTracking.statusEntrega,
          pagamento_confirmado: entregasTracking.pagamentoConfirmado,
          forma_pagamento_recebida: entregasTracking.formaPagamentoRecebida,
          valor_pago: entregasTracking.valorPago,
          observacao_motorista: entregasTracking.observacaoMotorista,
          chegou_em: entregasTracking.chegouEm,
          concluido_at: entregasTracking.concluidoAt,
          pedido_id: pedidos.id,
          pedido_codigo: pedidos.codigo,
          pedido_titulo: pedidos.titulo,
          pedido_status: pedidos.status,
          numero_nf: pedidos.numeroNf,
          pedido_observacoes: pedidos.observacoes,
          cliente_id: pedidos.clienteId,
          cliente: pedidos.cliente,
          previsao_entrega: pedidos.previsaoEntrega,
          pagamento_na_entrega: pedidos.pagamentoNaEntrega,
          valor_total: pedidos.valorTotal,
          rastreio_token: pedidos.rastreioToken,
          cliente_cidade: clientes.cidade,
          cliente_uf: clientes.uf,
          cliente_endereco: clientes.endereco,
          cliente_bairro: clientes.bairro,
          cliente_numero: clientes.numero,
          cliente_telefone: clientes.telefone,
          romaneio_id: entregasTracking.romaneioId,
        })
        .from(entregasTracking)
        .innerJoin(pedidos, eq(pedidos.id, entregasTracking.pedidoId))
        .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
        .where(eq(entregasTracking.embarqueId, embId))
        .orderBy(asc(entregasTracking.ordemParada), asc(pedidos.codigo))

      const pedIds = stopsRows.map((s) => s.pedido_id)
      const pedItensRows =
        pedIds.length > 0
          ? await conn.db
              .select({
                pedido_id: pedidosItens.pedidoId,
                produto_id: pedidosItens.produtoId,
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                qtd_kg_solicitada: pedidosItens.qtdKgSolicitada,
                qtd_caixas_solicitada: pedidosItens.qtdCaixasSolicitada,
                preco_unitario: pedidosItens.precoUnitario,
              })
              .from(pedidosItens)
              .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
              .where(inArray(pedidosItens.pedidoId, pedIds))
          : []

      const romRows =
        pedIds.length > 0
          ? await conn.db
              .select({
                id: romaneios.id,
                codigo: romaneios.codigo,
                pedido_id: romaneios.pedidoId,
                status: romaneios.status,
              })
              .from(romaneios)
              .where(inArray(romaneios.pedidoId, pedIds))
          : []

      const romByPed = new Map(romRows.map((r) => [r.pedido_id, r]))
      const romIds = romRows.map((r) => r.id)
      const caixasRows =
        romIds.length > 0
          ? await conn.db
              .select({
                item_id: romaneiosItens.id,
                romaneio_id: romaneiosItens.romaneioId,
                caixa_id: romaneiosItens.caixaId,
                ean_caixa: estoqueCaixas.eanCaixa,
                lote: estoqueCaixas.lote,
                validade: estoqueCaixas.validade,
                produto_id: romaneiosItens.produtoId,
                produto_codigo: produtos.codigo,
                produto_descricao: produtos.descricao,
                peso_kg: romaneiosItens.pesoKg,
                peso_bruto_kg: estoqueCaixas.pesoBrutoKg,
                tara_kg: estoqueCaixas.taraKg,
                conferido: romaneiosItens.conferido,
                carregado_veiculo: romaneiosItens.carregadoVeiculo,
                carregado_por: romaneiosItens.carregadoPor,
                carregado_at: romaneiosItens.carregadoAt,
              })
              .from(romaneiosItens)
              .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
              .innerJoin(produtos, eq(produtos.id, romaneiosItens.produtoId))
              .where(inArray(romaneiosItens.romaneioId, romIds))
              .orderBy(asc(romaneiosItens.createdAt))
          : []

      const caixasPorRom = new Map<string, typeof caixasRows>()
      for (const c of caixasRows) {
        const arr = caixasPorRom.get(c.romaneio_id) || []
        arr.push(c)
        caixasPorRom.set(c.romaneio_id, arr)
      }

      const itensPorPed = new Map<string, typeof pedItensRows>()
      for (const pi of pedItensRows) {
        const arr = itensPorPed.get(pi.pedido_id) || []
        arr.push(pi)
        itensPorPed.set(pi.pedido_id, arr)
      }

      const produtosConsolidados = new Map<
        string,
        {
          produto_id: string
          codigo: string
          descricao: string
          kg_pedido: number
          kg_real: number
          kg_bruto: number
          caixas_total: number
          caixas_carregadas: number
        }
      >()

      let totalCaixas = 0
      let caixasCarregadas = 0
      let pesoPedidoTotal = 0
      let pesoRealTotal = 0
      let pesoBrutoTotal = 0
      let pesoCargaTotal = 0
      let valorTotal = 0
      let pedidosSemPesoReal = 0
      const cidadesSet = new Set<string>()
      const nfsSet = new Set<string>()

      const paradas = stopsRows.map((s) => {
        const rom = romByPed.get(s.pedido_id) || null
        const cxs = rom ? caixasPorRom.get(rom.id) || [] : []
        const pItens = itensPorPed.get(s.pedido_id) || []
        const kgPedido = pItens.reduce((acc, i) => acc + toNum(i.qtd_kg_solicitada, 0), 0)
        const kgReal = cxs.reduce((acc, c) => acc + toNum(c.peso_kg, 0), 0)
        const pesoBruto = cxs.reduce((acc, c) => acc + calcPesoBrutoCaixa(c.peso_kg, c.peso_bruto_kg, c.tara_kg), 0)
        const cxsCarregadasStop = cxs.filter((c) => Number(c.carregado_veiculo) === 1 || Number(c.conferido) === 1).length
        const temPesoReal = cxs.length > 0 && kgReal > 0 && STATUS_PEDIDO_PRONTO.includes(s.pedido_status)

        if (!temPesoReal) pedidosSemPesoReal += 1
        totalCaixas += cxs.length
        caixasCarregadas += cxsCarregadasStop
        pesoPedidoTotal += kgPedido
        pesoRealTotal += kgReal
        pesoBrutoTotal += pesoBruto
        pesoCargaTotal += pesoBruto > 0 ? pesoBruto : kgPedido
        valorTotal += toNum(s.valor_total, 0)
        if (s.cliente_cidade?.trim()) cidadesSet.add(s.cliente_cidade.trim().toUpperCase())
        if (s.numero_nf?.trim()) nfsSet.add(s.numero_nf.trim())

        for (const pi of pItens) {
          const cur = produtosConsolidados.get(pi.produto_id) || {
            produto_id: pi.produto_id,
            codigo: pi.produto_codigo || '',
            descricao: pi.produto_descricao,
            kg_pedido: 0,
            kg_real: 0,
            kg_bruto: 0,
            caixas_total: 0,
            caixas_carregadas: 0,
          }
          cur.kg_pedido += toNum(pi.qtd_kg_solicitada, 0)
          produtosConsolidados.set(pi.produto_id, cur)
        }
        for (const c of cxs) {
          const cur = produtosConsolidados.get(c.produto_id) || {
            produto_id: c.produto_id,
            codigo: c.produto_codigo || '',
            descricao: c.produto_descricao,
            kg_pedido: 0,
            kg_real: 0,
            kg_bruto: 0,
            caixas_total: 0,
            caixas_carregadas: 0,
          }
          cur.kg_real += toNum(c.peso_kg, 0)
          cur.kg_bruto += calcPesoBrutoCaixa(c.peso_kg, c.peso_bruto_kg, c.tara_kg)
          cur.caixas_total += 1
          if (Number(c.carregado_veiculo) === 1 || Number(c.conferido) === 1) cur.caixas_carregadas += 1
          produtosConsolidados.set(c.produto_id, cur)
        }

        const endFormatado = [s.cliente_endereco, s.cliente_numero, s.cliente_bairro, s.cliente_cidade, s.cliente_uf]
          .filter(Boolean)
          .join(', ')

        return {
          tracking_id: s.tracking_id,
          ordem_parada: s.ordem_parada,
          status_entrega: s.status_entrega,
          pagamento_confirmado: Number(s.pagamento_confirmado || 0) === 1,
          forma_pagamento_recebida: s.forma_pagamento_recebida || '',
          observacao_motorista: s.observacao_motorista || '',
          chegou_em: s.chegou_em,
          concluido_at: s.concluido_at,
          pedido_id: s.pedido_id,
          pedido_codigo: s.pedido_codigo,
          pedido_titulo: s.pedido_titulo,
          pedido_status: s.pedido_status,
          numero_nf: s.numero_nf || '',
          pedido_observacoes: s.pedido_observacoes || '',
          cliente: s.cliente,
          endereco_entrega: endFormatado || `${s.cliente_cidade || ''} ${s.cliente_uf || ''}`.trim() || '-',
          cliente_cidade: s.cliente_cidade || '',
          cliente_telefone: s.cliente_telefone || '',
          previsao_entrega: s.previsao_entrega,
          pagamento_na_entrega: Number(s.pagamento_na_entrega || 0) === 1,
          valor_total: toNum(s.valor_total, 0),
          rastreio_token: s.rastreio_token,
          romaneio_id: rom?.id || null,
          romaneio_codigo: rom?.codigo || null,
          romaneio_status: rom?.status || null,
          kg_pedido: Number(kgPedido.toFixed(3)),
          kg_real: Number(kgReal.toFixed(3)),
          peso_bruto_kg: Number(pesoBruto.toFixed(3)),
          caixas_total: cxs.length,
          caixas_carregadas: cxsCarregadasStop,
          pronto_para_faturamento: temPesoReal,
          caixas: cxs.map((c) => ({
            ...c,
            peso_kg: toNum(c.peso_kg, 0),
            peso_bruto_kg: Number(calcPesoBrutoCaixa(c.peso_kg, c.peso_bruto_kg, c.tara_kg).toFixed(3)),
            carregado: Number(c.carregado_veiculo) === 1 || Number(c.conferido) === 1,
          })),
        }
      })

      const capNominal = emb.capacidade_kg != null ? toNum(emb.capacidade_kg, 0) : 0
      const tolPct = toNum(emb.tolerancia_pct, 10)
      const capMax = capNominal > 0 ? Number((capNominal * (1 + tolPct / 100)).toFixed(2)) : 0
      const ocupacaoPct = capNominal > 0 ? Math.round((pesoCargaTotal / capNominal) * 100) : 0
      const restanteKg = capNominal > 0 ? Number((capNominal - pesoCargaTotal).toFixed(2)) : 0

      return {
        success: true,
        config: {
          rastreio_motorista_ativo: features.rastreio_motorista_ativo !== false,
          impressao_romaneio_padrao:
            String(features.impressao_romaneio_padrao || 'OPCAO_B') === 'OPCAO_A' ? 'OPCAO_A' : 'OPCAO_B',
        },
        data: {
          ...emb,
          capacidade_kg: capNominal > 0 ? Number(capNominal.toFixed(2)) : null,
          tolerancia_pct: Number(tolPct.toFixed(2)),
          capacidade_maxima_kg: capMax || null,
          temperatura_bau: emb.temperatura_bau != null ? toNum(emb.temperatura_bau, 0) : null,
          nfs_vinculadas: Array.from(nfsSet),
          paradas,
          produtos_consolidados: Array.from(produtosConsolidados.values()).map((p) => ({
            ...p,
            kg_pedido: Number(p.kg_pedido.toFixed(3)),
            kg_real: Number(p.kg_real.toFixed(3)),
            kg_bruto: Number(p.kg_bruto.toFixed(3)),
          })),
          resumo: {
            total_pedidos: paradas.length,
            cidades_count: cidadesSet.size,
            pedidos_sem_peso_real: pedidosSemPesoReal,
            pronto_para_impressao_oficial: paradas.length > 0 && pedidosSemPesoReal === 0,
            total_caixas: totalCaixas,
            caixas_carregadas: caixasCarregadas,
            peso_pedido_kg: Number(pesoPedidoTotal.toFixed(3)),
            peso_real_kg: Number(pesoRealTotal.toFixed(3)),
            peso_bruto_kg: Number(pesoBrutoTotal.toFixed(3)),
            peso_carga_kg: Number(pesoCargaTotal.toFixed(3)),
            capacidade_kg: capNominal > 0 ? Number(capNominal.toFixed(2)) : null,
            tolerancia_pct: Number(tolPct.toFixed(2)),
            capacidade_maxima_kg: capMax || null,
            ocupacao_pct: ocupacaoPct,
            restante_kg: restanteKg,
            valor_total: Number(valorTotal.toFixed(2)),
          },
        },
      }
    },
  )

  // Atualizar dados gerais do Embarque (placa, motorista, veículo, horário saída, temperatura, modalidade)
  app.put(
    '/api/roteirizacao/embarques/:id',
    { preHandler: requirePermission(PERM_ROT_GESTAO) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')
      const body = (req.body || {}) as {
        titulo?: string
        data_embarque?: string
        rota_id?: string | null
        transportadora_id?: string | null
        tipo_veiculo_id?: string | null
        horario_saida?: string
        temperatura_bau?: number | string | null
        motorista_nome?: string
        veiculo_placa?: string
        modalidade_impressao?: 'OPCAO_B' | 'OPCAO_A'
        numero_nf_lote?: string
        observacoes?: string
      }

      await conn.db.transaction(async (tx) => {
        const [atual] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!atual) throw new HttpError(404, 'Embarque não encontrado.')

        const novoTvId =
          body.tipo_veiculo_id !== undefined
            ? body.tipo_veiculo_id
              ? parseUuidOrBadRequest(body.tipo_veiculo_id, 'tipo_veiculo_id')
              : null
            : atual.tipoVeiculoId

        let nextCap = atual.capacidadeKg
        let nextTol = atual.toleranciaPct
        if (novoTvId && (body.tipo_veiculo_id !== undefined || atual.capacidadeKg == null)) {
          const paradasAtuais = await tx
            .select({ pedidoId: entregasTracking.pedidoId })
            .from(entregasTracking)
            .where(eq(entregasTracking.embarqueId, embId))
          const lim = await validarCapacidadeEmbarque(tx, {
            tenantId: ctx.tenantId,
            tipoVeiculoId: novoTvId,
            pedIdsResultantes: paradasAtuais.map((p) => p.pedidoId),
          })
          nextCap = String(lim.capacidade_kg)
          nextTol = String(lim.tolerancia_pct)
        } else if (body.tipo_veiculo_id === null || body.tipo_veiculo_id === '') {
          nextCap = null
          nextTol = '10'
        }

        let nextTemp = atual.temperaturaBau
        if (body.temperatura_bau !== undefined) {
          if (body.temperatura_bau === null || String(body.temperatura_bau).trim() === '') {
            nextTemp = null
          } else {
            const tv = Number(String(body.temperatura_bau).replace(',', '.'))
            if (Number.isNaN(tv) || tv < -50 || tv > 50) {
              throw new HttpError(400, 'Informe uma temperatura de baú válida (entre -50°C e 50°C).')
            }
            nextTemp = String(tv)
          }
        }

        await tx
          .update(embarques)
          .set({
            titulo: body.titulo !== undefined ? String(body.titulo || '').trim() || atual.titulo : atual.titulo,
            dataEmbarque:
              body.data_embarque !== undefined ? normalizarDataIso(body.data_embarque) || atual.dataEmbarque : atual.dataEmbarque,
            rotaId:
              body.rota_id !== undefined ? (body.rota_id ? parseUuidOrBadRequest(body.rota_id, 'rota_id') : null) : atual.rotaId,
            transportadoraId:
              body.transportadora_id !== undefined
                ? body.transportadora_id
                  ? parseUuidOrBadRequest(body.transportadora_id, 'transportadora_id')
                  : null
                : atual.transportadoraId,
            tipoVeiculoId: novoTvId,
            capacidadeKg: nextCap,
            toleranciaPct: nextTol,
            horarioSaida:
              body.horario_saida !== undefined ? String(body.horario_saida || '').trim() : atual.horarioSaida,
            temperaturaBau: nextTemp,
            motoristaNome: body.motorista_nome !== undefined ? String(body.motorista_nome || '').trim() : atual.motoristaNome,
            veiculoPlaca:
              body.veiculo_placa !== undefined ? String(body.veiculo_placa || '').trim().toUpperCase() : atual.veiculoPlaca,
            modalidadeImpressao:
              body.modalidade_impressao !== undefined
                ? body.modalidade_impressao === 'OPCAO_A'
                  ? 'OPCAO_A'
                  : 'OPCAO_B'
                : atual.modalidadeImpressao,
            numeroNfLote: body.numero_nf_lote !== undefined ? String(body.numero_nf_lote || '').trim() : atual.numeroNfLote,
            observacoes: body.observacoes !== undefined ? String(body.observacoes || '').trim() : atual.observacoes,
          })
          .where(eq(embarques.id, embId))
      })

      return { success: true }
    },
  )

  // Adicionar pedidos/paradas ao embarque (valida capacidade máxima + tolerância do veículo)
  app.post(
    '/api/roteirizacao/embarques/:id/paradas',
    { preHandler: requirePermission(PERM_ROT_GESTAO) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')
      const body = (req.body || {}) as { pedido_ids?: string[] }
      const pedIds = Array.isArray(body.pedido_ids)
        ? Array.from(new Set(body.pedido_ids.map((id) => parseUuidOrBadRequest(id, 'pedido_id'))))
        : []
      if (pedIds.length === 0) throw new HttpError(400, 'Selecione ao menos 1 pedido para incluir no roteiro.')

      await conn.db.transaction(async (tx) => {
        const [emb] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!emb) throw new HttpError(404, 'Embarque não encontrado.')

        const [{ maxOrdem }] = await tx
          .select({ maxOrdem: sql<number>`COALESCE(MAX(${entregasTracking.ordemParada}), 0)::int` })
          .from(entregasTracking)
          .where(eq(entregasTracking.embarqueId, embId))

        const existentes = await tx
          .select({ pedidoId: entregasTracking.pedidoId })
          .from(entregasTracking)
          .where(eq(entregasTracking.embarqueId, embId))
        const existSet = new Set(existentes.map((x) => x.pedidoId))
        const novos = pedIds.filter((id) => !existSet.has(id))
        if (novos.length === 0) return

        await validarCapacidadeEmbarque(tx, {
          tenantId: ctx.tenantId,
          tipoVeiculoId: emb.tipoVeiculoId,
          capacidadeKg: emb.capacidadeKg,
          toleranciaPct: emb.toleranciaPct,
          pedIdsResultantes: [...Array.from(existSet), ...novos],
        })

        const romRows = await tx
          .select({ id: romaneios.id, pedidoId: romaneios.pedidoId })
          .from(romaneios)
          .where(inArray(romaneios.pedidoId, novos))
        const romByPed = new Map<string, string>()
        for (const r of romRows) {
          if (r.pedidoId) romByPed.set(r.pedidoId, r.id)
        }

        await tx.insert(entregasTracking).values(
          novos.map((pid, idx) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            embarqueId: embId,
            pedidoId: pid,
            romaneioId: romByPed.get(pid) || null,
            ordemParada: (maxOrdem || 0) + idx + 1,
            statusEntrega: 'PENDENTE',
          })),
        )

        const romIdsToLink = novos.map((pid) => romByPed.get(pid)).filter(Boolean) as string[]
        if (romIdsToLink.length > 0) {
          await tx.update(romaneios).set({ embarqueId: embId }).where(inArray(romaneios.id, romIdsToLink))
        }
      })

      return { success: true }
    },
  )

  // Remover parada do roteiro
  app.delete(
    '/api/roteirizacao/embarques/:id/paradas/:pedidoId',
    { preHandler: requirePermission(PERM_ROT_GESTAO) },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; pedidoId: string }
      const embId = parseUuidOrBadRequest(p.id, 'embarque_id')
      const pedidoId = parseUuidOrBadRequest(p.pedidoId, 'pedido_id')

      await conn.db.transaction(async (tx) => {
        const [stop] = await tx
          .select()
          .from(entregasTracking)
          .where(
            and(
              eq(entregasTracking.embarqueId, embId),
              eq(entregasTracking.pedidoId, pedidoId),
              eq(entregasTracking.tenantId, ctx.tenantId),
            ),
          )
          .limit(1)
        if (!stop) throw new HttpError(404, 'Parada não encontrada neste roteiro.')
        if (stop.statusEntrega === 'ENTREGUE') {
          throw new HttpError(409, 'Não é possível remover um pedido já marcado como ENTREGUE.')
        }

        await tx.delete(entregasTracking).where(eq(entregasTracking.id, stop.id))
        await tx
          .update(romaneios)
          .set({ embarqueId: null })
          .where(and(eq(romaneios.pedidoId, pedidoId), eq(romaneios.embarqueId, embId)))
      })

      return { success: true }
    },
  )

  // Reordenar sequência de entregas do roteiro
  app.put(
    '/api/roteirizacao/embarques/:id/reordenar',
    { preHandler: requirePermission(PERM_ROT_GESTAO) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')
      const body = (req.body || {}) as { pedido_ids_ordenados?: string[] }
      const ordem = Array.isArray(body.pedido_ids_ordenados) ? body.pedido_ids_ordenados : []
      if (ordem.length === 0) throw new HttpError(400, 'Informe a lista ordenada de pedidos.')

      await conn.db.transaction(async (tx) => {
        for (let i = 0; i < ordem.length; i++) {
          const pid = parseUuidOrBadRequest(ordem[i], 'pedido_id')
          await tx
            .update(entregasTracking)
            .set({ ordemParada: i + 1 })
            .where(
              and(
                eq(entregasTracking.embarqueId, embId),
                eq(entregasTracking.pedidoId, pid),
                eq(entregasTracking.tenantId, ctx.tenantId),
              ),
            )
        }
      })

      return { success: true }
    },
  )

  // Bipagem única de carregamento na doca (Operador): valida caixa pertencente a este roteiro e marca carregada
  app.post(
    '/api/roteirizacao/embarques/:id/carregar-caixa',
    { preHandler: requirePermission(PERM_ROT_BIPAR) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')
      const body = (req.body || {}) as { ean_caixa?: string; temperatura_bau?: number | string | null }
      const codigo = String(body.ean_caixa || '').trim()
      if (!codigo) throw new HttpError(400, 'Bipe ou informe o código EAN da caixa.')
      const semZeros = codigo.replace(/^0+/, '') || codigo

      let tempInformada: string | undefined
      if (body.temperatura_bau !== undefined && body.temperatura_bau !== null && String(body.temperatura_bau).trim() !== '') {
        const tv = Number(String(body.temperatura_bau).replace(',', '.'))
        if (Number.isNaN(tv) || tv < -50 || tv > 50) {
          throw new HttpError(400, 'Informe uma temperatura de baú válida (entre -50°C e 50°C).')
        }
        tempInformada = String(tv)
      }

      const resBipe = await conn.db.transaction(async (tx) => {
        const [emb] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!emb) throw new HttpError(404, 'Embarque não encontrado.')

        const stops = await tx
          .select({
            pedido_id: entregasTracking.pedidoId,
            ordem_parada: entregasTracking.ordemParada,
            pedido_codigo: pedidos.codigo,
            cliente: pedidos.cliente,
          })
          .from(entregasTracking)
          .innerJoin(pedidos, eq(pedidos.id, entregasTracking.pedidoId))
          .where(eq(entregasTracking.embarqueId, embId))

        if (stops.length === 0) {
          throw new HttpError(400, 'Este roteiro não possui pedidos vinculados.')
        }
        const pedIds = stops.map((s) => s.pedido_id)

        const matchRes = await tx.execute(sql`
          SELECT
            ri.id AS item_id,
            ri.romaneio_id,
            ri.caixa_id,
            ri.peso_kg,
            ri.conferido,
            ri.carregado_veiculo,
            r.pedido_id,
            r.codigo AS romaneio_codigo,
            ec.ean_caixa,
            p.codigo AS produto_codigo,
            p.descricao AS produto_descricao
          FROM romaneios_itens ri
          JOIN romaneios r ON r.id = ri.romaneio_id
          JOIN estoque_caixas ec ON ec.id = ri.caixa_id
          JOIN produtos p ON p.id = ri.produto_id
          WHERE r.tenant_id = ${ctx.tenantId}
            AND r.pedido_id IN (${sql.join(pedIds.map((id) => sql`${id}`), sql`, `)})
            AND (ec.ean_caixa = ${codigo} OR LTRIM(ec.ean_caixa, '0') = ${semZeros})
          ORDER BY CASE WHEN ec.ean_caixa = ${codigo} THEN 0 ELSE 1 END
          LIMIT 1
        `)

        const item = matchRes.rows[0] as Record<string, any> | undefined
        if (!item) {
          throw new HttpError(409, `A caixa "${codigo}" NÃO pertence a nenhum pedido deste roteiro!`)
        }
        if (Number(item.carregado_veiculo) === 1) {
          throw new HttpError(409, `A caixa ${item.ean_caixa} já foi bipada no carregamento deste veículo.`)
        }

        const now = new Date()
        await tx
          .update(romaneiosItens)
          .set({
            carregadoVeiculo: 1,
            carregadoAt: now,
            carregadoPor: ctx.operador.nome,
            conferido: 1,
            conferidoAt: Number(item.conferido) === 1 ? undefined : now,
            conferidoPor: Number(item.conferido) === 1 ? undefined : ctx.operador.nome,
          })
          .where(eq(romaneiosItens.id, String(item.item_id)))

        await registrarHistoricoCaixa(tx, {
          tenantId: ctx.tenantId,
          caixaId: String(item.caixa_id),
          eanCaixa: String(item.ean_caixa),
          operacao: 'CARREGAMENTO_ROTA',
          detalhes: `Bipada no veículo ${emb.codigo}${emb.veiculoPlaca ? ` (${emb.veiculoPlaca})` : ''} • Pedido ${stops.find((s) => s.pedido_id === item.pedido_id)?.pedido_codigo || ''}`,
          operadorNome: ctx.operador.nome,
        })

        const embPatch: Partial<typeof embarques.$inferInsert> = {}
        if (emb.status === 'PLANEJADO') {
          embPatch.status = 'EM_CARREGAMENTO'
          embPatch.operadorCarregamentoNome = ctx.operador.nome
        } else if (!emb.operadorCarregamentoNome) {
          embPatch.operadorCarregamentoNome = ctx.operador.nome
        }
        if (tempInformada !== undefined) {
          embPatch.temperaturaBau = tempInformada
        }
        if (Object.keys(embPatch).length > 0) {
          await tx.update(embarques).set(embPatch).where(eq(embarques.id, embId))
        }

        const parada = stops.find((s) => s.pedido_id === String(item.pedido_id))
        return {
          ean_caixa: String(item.ean_caixa),
          produto_codigo: String(item.produto_codigo || ''),
          produto_descricao: String(item.produto_descricao || ''),
          peso_kg: toNum(item.peso_kg, 0),
          pedido_codigo: parada?.pedido_codigo || '',
          cliente: parada?.cliente || '',
          ordem_parada: parada?.ordem_parada || 1,
          temperatura_bau: tempInformada !== undefined ? toNum(tempInformada, 0) : emb.temperaturaBau != null ? toNum(emb.temperaturaBau, 0) : null,
        }
      })

      return { success: true, caixa: resBipe }
    },
  )

  // Atualizar Temperatura do Baú pelo operador/supervisor durante carregamento
  app.patch(
    '/api/roteirizacao/embarques/:id/temperatura',
    { preHandler: requirePermission(PERM_ROT_BIPAR) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')
      const body = (req.body || {}) as { temperatura_bau?: number | string | null }
      let nextTemp: string | null = null
      if (body.temperatura_bau !== undefined && body.temperatura_bau !== null && String(body.temperatura_bau).trim() !== '') {
        const tv = Number(String(body.temperatura_bau).replace(',', '.'))
        if (Number.isNaN(tv) || tv < -50 || tv > 50) {
          throw new HttpError(400, 'Informe uma temperatura de baú válida (entre -50°C e 50°C).')
        }
        nextTemp = String(tv)
      }
      await conn.db
        .update(embarques)
        .set({ temperaturaBau: nextTemp })
        .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
      return { success: true, temperatura_bau: nextTemp !== null ? Number(nextTemp) : null }
    },
  )

  // Estornar bipagem de carregamento antes do despacho
  app.post(
    '/api/roteirizacao/embarques/:id/estornar-carregamento/:itemId',
    { preHandler: requirePermission(PERM_ROT_BIPAR) },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; itemId: string }
      parseUuidOrBadRequest(p.id, 'embarque_id')
      const itemId = parseUuidOrBadRequest(p.itemId, 'item_id')

      await conn.db
        .update(romaneiosItens)
        .set({ carregadoVeiculo: 0, carregadoAt: null, carregadoPor: null })
        .where(and(eq(romaneiosItens.id, itemId), eq(romaneiosItens.tenantId, ctx.tenantId)))

      return { success: true }
    },
  )

  // Concluir carregamento e despachar veículo (expede romaneios conferidos/bipadados em 1 clique + inicia EM_ROTA)
  app.post(
    '/api/roteirizacao/embarques/:id/despachar',
    { preHandler: requirePermission(PERM_ROT_BIPAR) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')
      const body = (req.body || {}) as {
        veiculo_placa?: string
        motorista_nome?: string
        numero_nf_lote?: string
        ignorar_caixas_pendentes?: boolean
      }

      const resDesp = await conn.db.transaction(async (tx) => {
        const [emb] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!emb) throw new HttpError(404, 'Embarque não encontrado.')

        const stops = await tx
          .select({
            id: entregasTracking.id,
            pedido_id: entregasTracking.pedidoId,
            pedido_codigo: pedidos.codigo,
            pedido_status: pedidos.status,
            numero_nf: pedidos.numeroNf,
            chave_nfe: pedidos.chaveNfe,
          })
          .from(entregasTracking)
          .innerJoin(pedidos, eq(pedidos.id, entregasTracking.pedidoId))
          .where(eq(entregasTracking.embarqueId, embId))

        if (stops.length === 0) {
          throw new HttpError(400, 'Inclua ao menos 1 pedido no roteiro antes de despachar.')
        }

        const pedIds = stops.map((s) => s.pedido_id)

        // Trava Fiscal configurável por empresa: bloqueia despachar caminhão com pedidos sem NF-e autorizada
        const features = await lerTenantFeatures(tx, ctx.tenantId)
        if (Boolean(features.exigir_nf_para_expedir)) {
          const notasAut = await tx
            .select({ pedidoId: fiscalNotas.pedidoId })
            .from(fiscalNotas)
            .where(
              and(
                eq(fiscalNotas.tenantId, ctx.tenantId),
                inArray(fiscalNotas.pedidoId, pedIds),
                eq(fiscalNotas.status, 'AUTORIZADA'),
              ),
            )
          const setComNf = new Set(notasAut.map((n) => n.pedidoId).filter(Boolean))
          const pedidosSemNf = stops
            .filter((s) => !s.chave_nfe && !s.numero_nf && !setComNf.has(s.pedido_id))
            .map((s) => s.pedido_codigo)
          if (pedidosSemNf.length > 0) {
            throw new HttpError(
              409,
              `Bloqueio Fiscal: pedido(s) ${pedidosSemNf.join(', ')} ainda não possuem NF-e autorizada. Fature-os no Módulo Fiscal antes de despachar o veículo.`,
            )
          }
        }
        const romRows = await tx
          .select()
          .from(romaneios)
          .where(inArray(romaneios.pedidoId, pedIds))
        const romByPed = new Map(romRows.map((r) => [r.pedidoId!, r]))

        let expedidosAgora = 0
        const now = new Date()

        for (const st of stops) {
          const rom = romByPed.get(st.pedido_id)
          if (!rom) {
            throw new HttpError(
              409,
              `O pedido ${st.pedido_codigo} ainda não possui separação finalizada na câmara.`,
            )
          }
          if (rom.status === 'EXPEDIDO') continue

          const itens = await tx
            .select({
              id: romaneiosItens.id,
              caixaId: romaneiosItens.caixaId,
              produtoId: romaneiosItens.produtoId,
              pesoKg: romaneiosItens.pesoKg,
              conferido: romaneiosItens.conferido,
              carregadoVeiculo: romaneiosItens.carregadoVeiculo,
              eanCaixa: estoqueCaixas.eanCaixa,
              endereco: estoqueCaixas.endereco,
              lote: estoqueCaixas.lote,
            })
            .from(romaneiosItens)
            .innerJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
            .where(eq(romaneiosItens.romaneioId, rom.id))

          if (itens.length === 0) {
            throw new HttpError(409, `O romaneio ${rom.codigo} (${st.pedido_codigo}) está sem caixas separadas.`)
          }

          const pendentes = itens.filter((i) => Number(i.carregadoVeiculo) !== 1 && Number(i.conferido) !== 1)
          if (pendentes.length > 0) {
            throw new HttpError(
              409,
              `Não é possível despachar: ainda faltam ${pendentes.length} caixa(s) para bipar no pedido ${st.pedido_codigo} (${rom.codigo}).`,
            )
          }

          const cIds = itens.map((i) => i.caixaId).filter(Boolean) as string[]
          if (cIds.length > 0) {
            await tx
              .update(estoqueCaixas)
              .set({ status: 'SAIDA', endereco: 'SAIDA', paleteId: null, updatedAt: now })
              .where(inArray(estoqueCaixas.id, cIds))
          }

          const endsAfetados = new Set<string>(['SAIDA', 'EXPEDICAO'])
          const porProd = new Map<string, { origem: string; lote: string; cxs: number; kg: number }>()
          for (const it of itens) {
            const orig = it.endereco || 'DOCA'
            endsAfetados.add(orig)
            if (it.caixaId) {
              await registrarHistoricoCaixa(tx, {
                tenantId: ctx.tenantId,
                caixaId: it.caixaId,
                eanCaixa: it.eanCaixa,
                operacao: 'EXPEDICAO',
                detalhes: `Expedida via Roteiro ${emb.codigo} (${rom.codigo}) para ${rom.cliente}`,
                operadorNome: ctx.operador.nome,
              })
            }
            const k = `${it.produtoId}__${orig}__${it.lote || ''}`
            const cur = porProd.get(k) || { origem: orig, lote: it.lote || '', cxs: 0, kg: 0 }
            cur.cxs += 1
            cur.kg += toNum(it.pesoKg, 0)
            porProd.set(k, cur)
          }

          for (const [key, val] of porProd.entries()) {
            const [prodId] = key.split('__')
            await registrarMovimentacaoLog(tx, {
              tenantId: ctx.tenantId,
              filialId: ctx.filialId,
              produtoId: prodId,
              enderecoOrigem: val.origem,
              enderecoDestino: 'EXPEDICAO',
              lote: val.lote,
              qtdCaixas: val.cxs,
              qtdKg: val.kg,
              operadorId: ctx.operador.id,
              operadorNome: ctx.operador.nome,
              tipo: 'DESPACHO',
              numPedido: rom.codigo,
              cliente: rom.cliente,
            })
          }

          await tx
            .update(romaneios)
            .set({
              status: 'EXPEDIDO',
              embarqueId: embId,
              operadorConferenciaNome: rom.operadorConferenciaNome || ctx.operador.nome,
              conferidoAt: rom.conferidoAt || now,
              operadorExpedicaoNome: ctx.operador.nome,
              expedidoAt: now,
            })
            .where(eq(romaneios.id, rom.id))

          await tx
            .update(pedidos)
            .set({ status: 'EXPEDIDO', expedidoAt: now, updatedAt: now })
            .where(eq(pedidos.id, st.pedido_id))

          await recalcularPosicaoEnderecos(tx, ctx.tenantId, ctx.filialId, [...endsAfetados])
          expedidosAgora += 1
        }

        await tx
          .update(embarques)
          .set({
            status: 'EM_ROTA',
            veiculoPlaca:
              body.veiculo_placa !== undefined
                ? String(body.veiculo_placa || '').trim().toUpperCase()
                : emb.veiculoPlaca,
            motoristaNome:
              body.motorista_nome !== undefined ? String(body.motorista_nome || '').trim() : emb.motoristaNome,
            numeroNfLote:
              body.numero_nf_lote !== undefined ? String(body.numero_nf_lote || '').trim() : emb.numeroNfLote,
            operadorCarregamentoNome: emb.operadorCarregamentoNome || ctx.operador.nome,
            iniciadoEm: emb.iniciadoEm || now,
          })
          .where(eq(embarques.id, embId))

        await tx
          .update(entregasTracking)
          .set({ statusEntrega: 'A_CAMINHO', iniciadoEm: now })
          .where(and(eq(entregasTracking.embarqueId, embId), eq(entregasTracking.statusEntrega, 'PENDENTE')))

        return { expedidosAgora }
      })

      return { success: true, ...resDesp }
    },
  )

  // Atualização manual da parada / conclusão pelo gestor/operador (fallback quando rastreio QR estiver desativado)
  app.post(
    '/api/roteirizacao/embarques/:id/paradas/:pedidoId/status',
    { preHandler: requirePermission(PERM_ROT_BIPAR) },
    async (req) => {
      const ctx = req.authCtx!
      const p = req.params as { id: string; pedidoId: string }
      const embId = parseUuidOrBadRequest(p.id, 'embarque_id')
      const pedidoId = parseUuidOrBadRequest(p.pedidoId, 'pedido_id')
      const body = (req.body || {}) as {
        status_entrega?: 'PENDENTE' | 'A_CAMINHO' | 'NO_CLIENTE' | 'ENTREGUE' | 'DEVOLVIDA'
        pagamento_confirmado?: boolean
        observacao_motorista?: string
        forma_pagamento_recebida?: string
      }
      const nextStatus = String(body.status_entrega || 'ENTREGUE').toUpperCase()

      await conn.db.transaction(async (tx) => {
        const [emb] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!emb) throw new HttpError(404, 'Embarque não encontrado.')
        if (!['EM_ROTA', 'CONCLUIDO'].includes(emb.status)) {
          throw new HttpError(
            409,
            'O acompanhamento/baixa de entregas só fica disponível após bipar todas as caixas e despachar o veículo.',
          )
        }

        const [ped] = await tx
          .select({ pagamentoNaEntrega: pedidos.pagamentoNaEntrega, codigo: pedidos.codigo })
          .from(pedidos)
          .where(eq(pedidos.id, pedidoId))
          .limit(1)
        if (!ped) throw new HttpError(404, 'Pedido não encontrado.')

        if (ped.pagamentoNaEntrega === 1 && nextStatus === 'ENTREGUE' && !body.pagamento_confirmado) {
          throw new HttpError(
            400,
            `Pedido ${ped.codigo} exige confirmação do Pagamento na Entrega antes de concluir a entrega.`,
          )
        }

        const now = new Date()
        await tx
          .update(entregasTracking)
          .set({
            statusEntrega: nextStatus,
            pagamentoConfirmado: body.pagamento_confirmado ? 1 : 0,
            formaPagamentoRecebida: String(body.forma_pagamento_recebida || '').trim(),
            observacaoMotorista: String(body.observacao_motorista || '').trim(),
            chegouEm: nextStatus === 'NO_CLIENTE' ? now : undefined,
            concluidoAt: nextStatus === 'ENTREGUE' || nextStatus === 'DEVOLVIDA' ? now : null,
          })
          .where(
            and(
              eq(entregasTracking.embarqueId, embId),
              eq(entregasTracking.pedidoId, pedidoId),
              eq(entregasTracking.tenantId, ctx.tenantId),
            ),
          )

        if (body.pagamento_confirmado) {
          await baixarTitulosPedidoEntregaConfirmada(tx, {
            tenantId: ctx.tenantId,
            filialId: ctx.filialId,
            pedidoId,
            formaPagamentoRecebida: String(body.forma_pagamento_recebida || '').trim(),
            operadorId: ctx.operador.id,
            operadorNome: ctx.operador.nome,
          })
        }

        const allStops = await tx
          .select({ statusEntrega: entregasTracking.statusEntrega })
          .from(entregasTracking)
          .where(eq(entregasTracking.embarqueId, embId))

        if (allStops.length > 0 && allStops.every((s) => ['ENTREGUE', 'DEVOLVIDA'].includes(s.statusEntrega))) {
          await tx
            .update(embarques)
            .set({ status: 'CONCLUIDO', concluidoEm: now })
            .where(eq(embarques.id, embId))
        }
      })

      return { success: true }
    },
  )

  // Finalizar Rota no fim do dia (sem exigir baixa manual de todas as paradas)
  app.post(
    '/api/roteirizacao/embarques/:id/finalizar',
    { preHandler: requirePermission(Array.from(new Set([...PERM_ROT_GESTAO, ...PERM_ROT_BIPAR]))) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')

      await conn.db.transaction(async (tx) => {
        const [emb] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!emb) throw new HttpError(404, 'Embarque não encontrado.')
        if (emb.status === 'CONCLUIDO') return
        if (emb.status !== 'EM_ROTA') {
          throw new HttpError(
            409,
            'Só é possível finalizar a rota após concluir o carregamento e despachar o veículo (status EM ROTA).',
          )
        }

        const now = new Date()
        await tx
          .update(embarques)
          .set({ status: 'CONCLUIDO', concluidoEm: now })
          .where(eq(embarques.id, embId))
      })

      return { success: true }
    },
  )

  // Excluir embarque em aberto
  app.delete(
    '/api/roteirizacao/embarques/:id',
    { preHandler: requirePermission(PERM_ROT_GESTAO) },
    async (req) => {
      const ctx = req.authCtx!
      const embId = parseUuidOrBadRequest((req.params as { id: string }).id, 'embarque_id')

      await conn.db.transaction(async (tx) => {
        const [emb] = await tx
          .select()
          .from(embarques)
          .where(and(eq(embarques.id, embId), eq(embarques.tenantId, ctx.tenantId)))
          .limit(1)
        if (!emb) throw new HttpError(404, 'Embarque não encontrado.')
        if (emb.status === 'CONCLUIDO') {
          throw new HttpError(409, 'Não é possível excluir um embarque já concluído no histórico.')
        }

        await tx.update(romaneios).set({ embarqueId: null }).where(eq(romaneios.embarqueId, embId))
        await tx.delete(embarques).where(eq(embarques.id, embId))
      })

      return { success: true }
    },
  )

  // ── ROTAS PÚBLICAS DE RASTREIO (QR CODE DO MOTORISTA & CLIENTE — SEM LOGIN) ─────────────────────────
  async function assertRastreioHabilitado(dbOrTx: Pick<DbConnection['db'], 'select'>, tenantId: string) {
    const [t] = await dbOrTx.select({ featuresJson: tenants.featuresJson }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    const features = (t?.featuresJson as Record<string, boolean>) || {}
    if (features.rastreio_motorista_ativo === false) {
      throw new HttpError(403, 'O módulo de rastreio mobile por QR Code está desativado nas configurações.')
    }
  }

  app.get('/api/public/rastreio/:qrToken', async (req) => {
    const qrToken = String((req.params as { qrToken: string }).qrToken || '').trim()
    if (!qrToken) throw new HttpError(400, 'Token da rota inválido.')

    const [emb] = await conn.db
      .select({
        id: embarques.id,
        tenant_id: embarques.tenantId,
        codigo: embarques.codigo,
        titulo: embarques.titulo,
        data_embarque: embarques.dataEmbarque,
        status: embarques.status,
        motorista_nome: embarques.motoristaNome,
        veiculo_placa: embarques.veiculoPlaca,
        rota_nome: rotas.nome,
        transportadora_nome: transportadoras.nomeFantasia,
        iniciado_em: embarques.iniciadoEm,
      })
      .from(embarques)
      .leftJoin(rotas, eq(rotas.id, embarques.rotaId))
      .leftJoin(transportadoras, eq(transportadoras.id, embarques.transportadoraId))
      .where(eq(embarques.qrToken, qrToken))
      .limit(1)

    if (!emb) throw new HttpError(404, 'Rota de entrega não encontrada para este QR Code.')
    await assertRastreioHabilitado(conn.db, emb.tenant_id)

    const stops = await conn.db
      .select({
        pedido_id: pedidos.id,
        pedido_codigo: pedidos.codigo,
        cliente: pedidos.cliente,
        ordem_parada: entregasTracking.ordemParada,
        status_entrega: entregasTracking.statusEntrega,
        pagamento_na_entrega: pedidos.pagamentoNaEntrega,
        pagamento_confirmado: entregasTracking.pagamentoConfirmado,
        valor_total: pedidos.valorTotal,
        observacao_motorista: entregasTracking.observacaoMotorista,
        concluido_at: entregasTracking.concluidoAt,
        cidade: clientes.cidade,
        uf: clientes.uf,
        endereco: clientes.endereco,
        numero: clientes.numero,
        bairro: clientes.bairro,
        telefone: clientes.telefone,
        total_kg: sql<string>`COALESCE((SELECT ROUND(SUM(ri.peso_kg), 2) FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id WHERE r.pedido_id = ${pedidos.id}), (SELECT ROUND(SUM(pi.qtd_kg_solicitada), 2) FROM pedidos_itens pi WHERE pi.pedido_id = ${pedidos.id}), 0)`,
        total_caixas: sql<number>`COALESCE((SELECT COUNT(*)::int FROM romaneios_itens ri JOIN romaneios r ON r.id = ri.romaneio_id WHERE r.pedido_id = ${pedidos.id}), 0)`,
      })
      .from(entregasTracking)
      .innerJoin(pedidos, eq(pedidos.id, entregasTracking.pedidoId))
      .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
      .where(eq(entregasTracking.embarqueId, emb.id))
      .orderBy(asc(entregasTracking.ordemParada))

    return {
      success: true,
      rota: {
        codigo: emb.codigo,
        titulo: emb.titulo,
        data_embarque: emb.data_embarque,
        status: emb.status,
        motorista_nome: emb.motorista_nome,
        veiculo_placa: emb.veiculo_placa,
        rota_nome: emb.rota_nome,
        transportadora_nome: emb.transportadora_nome,
        iniciado_em: emb.iniciado_em,
      },
      paradas: stops.map((s) => ({
        pedido_id: s.pedido_id,
        pedido_codigo: s.pedido_codigo,
        cliente: s.cliente,
        ordem_parada: s.ordem_parada,
        status_entrega: s.status_entrega,
        pagamento_na_entrega: Number(s.pagamento_na_entrega || 0) === 1,
        pagamento_confirmado: Number(s.pagamento_confirmado || 0) === 1,
        valor_total: toNum(s.valor_total, 0),
        observacao_motorista: s.observacao_motorista,
        concluido_at: s.concluido_at,
        endereco_completo: [s.endereco, s.numero, s.bairro, s.cidade, s.uf].filter(Boolean).join(', '),
        telefone: s.telefone || '',
        total_kg: toNum(s.total_kg, 0),
        total_caixas: Number(s.total_caixas || 0),
      })),
    }
  })

  app.post('/api/public/rastreio/:qrToken/iniciar', async (req) => {
    const qrToken = String((req.params as { qrToken: string }).qrToken || '').trim()
    const body = (req.body || {}) as { motorista_nome?: string; veiculo_placa?: string }
    const motorista = String(body.motorista_nome || '').trim()
    const placa = String(body.veiculo_placa || '').trim().toUpperCase()
    if (!motorista || !placa) {
      throw new HttpError(400, 'Informe o nome do motorista e a placa do veículo para iniciar a rota.')
    }

    await conn.db.transaction(async (tx) => {
      const [emb] = await tx.select().from(embarques).where(eq(embarques.qrToken, qrToken)).limit(1)
      if (!emb) throw new HttpError(404, 'Rota não encontrada.')
      await assertRastreioHabilitado(tx, emb.tenantId)
      if (!['EM_ROTA', 'CONCLUIDO'].includes(emb.status)) {
        throw new HttpError(409, 'Este embarque ainda não foi despachado da doca.')
      }

      const now = new Date()
      await tx
        .update(embarques)
        .set({
          motoristaNome: motorista,
          veiculoPlaca: placa,
          status: emb.status === 'CONCLUIDO' ? 'CONCLUIDO' : 'EM_ROTA',
          iniciadoEm: emb.iniciadoEm || now,
        })
        .where(eq(embarques.id, emb.id))

      await tx
        .update(entregasTracking)
        .set({ statusEntrega: 'A_CAMINHO', iniciadoEm: now })
        .where(and(eq(entregasTracking.embarqueId, emb.id), eq(entregasTracking.statusEntrega, 'PENDENTE')))
    })

    return { success: true }
  })

  app.post('/api/public/rastreio/:qrToken/paradas/:pedidoId', async (req) => {
    const p = req.params as { qrToken: string; pedidoId: string }
    const qrToken = String(p.qrToken || '').trim()
    const pedidoId = parseUuidOrBadRequest(p.pedidoId, 'pedido_id')
    const body = (req.body || {}) as {
      status_entrega?: 'A_CAMINHO' | 'NO_CLIENTE' | 'ENTREGUE' | 'DEVOLVIDA'
      pagamento_confirmado?: boolean
      forma_pagamento_recebida?: string
      observacao_motorista?: string
    }
    const nextStatus = String(body.status_entrega || '').toUpperCase()
    if (!['A_CAMINHO', 'NO_CLIENTE', 'ENTREGUE', 'DEVOLVIDA'].includes(nextStatus)) {
      throw new HttpError(400, 'Status de parada inválido.')
    }

    await conn.db.transaction(async (tx) => {
      const [emb] = await tx.select().from(embarques).where(eq(embarques.qrToken, qrToken)).limit(1)
      if (!emb) throw new HttpError(404, 'Rota não encontrada.')
      await assertRastreioHabilitado(tx, emb.tenantId)
      if (!['EM_ROTA', 'CONCLUIDO'].includes(emb.status)) {
        throw new HttpError(409, 'Este embarque ainda não foi despachado da doca.')
      }

      const [ped] = await tx
        .select({ pagamentoNaEntrega: pedidos.pagamentoNaEntrega, codigo: pedidos.codigo })
        .from(pedidos)
        .where(eq(pedidos.id, pedidoId))
        .limit(1)
      if (!ped) throw new HttpError(404, 'Pedido não encontrado nesta rota.')

      if (ped.pagamentoNaEntrega === 1 && nextStatus === 'ENTREGUE' && !body.pagamento_confirmado) {
        throw new HttpError(
          400,
          `O pedido ${ped.codigo} exige confirmação do Pagamento na Entrega (PIX/Cartão/Dinheiro) antes de concluir.`,
        )
      }

      const now = new Date()
      await tx
        .update(entregasTracking)
        .set({
          statusEntrega: nextStatus,
          pagamentoConfirmado: body.pagamento_confirmado ? 1 : 0,
          formaPagamentoRecebida: String(body.forma_pagamento_recebida || '').trim(),
          observacaoMotorista: String(body.observacao_motorista || '').trim(),
          chegouEm: nextStatus === 'NO_CLIENTE' ? now : undefined,
          concluidoAt: nextStatus === 'ENTREGUE' || nextStatus === 'DEVOLVIDA' ? now : null,
        })
        .where(and(eq(entregasTracking.embarqueId, emb.id), eq(entregasTracking.pedidoId, pedidoId)))

      if (body.pagamento_confirmado) {
        await baixarTitulosPedidoEntregaConfirmada(tx, {
          tenantId: emb.tenantId,
          filialId: emb.filialId,
          pedidoId,
          formaPagamentoRecebida: String(body.forma_pagamento_recebida || '').trim(),
          operadorNome: emb.motoristaNome || 'Motorista',
        })
      }

      const allStops = await tx
        .select({ statusEntrega: entregasTracking.statusEntrega })
        .from(entregasTracking)
        .where(eq(entregasTracking.embarqueId, emb.id))

      if (allStops.length > 0 && allStops.every((s) => ['ENTREGUE', 'DEVOLVIDA'].includes(s.statusEntrega))) {
        await tx.update(embarques).set({ status: 'CONCLUIDO', concluidoEm: now }).where(eq(embarques.id, emb.id))
      }
    })

    return { success: true }
  })

  app.get('/api/public/pedido/:rastreioToken', async (req) => {
    const token = String((req.params as { rastreioToken: string }).rastreioToken || '').trim()
    if (!token) throw new HttpError(400, 'Token inválido.')

    const [ped] = await conn.db
      .select({
        id: pedidos.id,
        tenant_id: pedidos.tenantId,
        codigo: pedidos.codigo,
        cliente: pedidos.cliente,
        status: pedidos.status,
        previsao_entrega: pedidos.previsaoEntrega,
      })
      .from(pedidos)
      .where(eq(pedidos.rastreioToken, token))
      .limit(1)
    if (!ped) throw new HttpError(404, 'Rastreamento de pedido não encontrado.')

    await assertRastreioHabilitado(conn.db, ped.tenant_id)

    const [track] = await conn.db
      .select({
        status_entrega: entregasTracking.statusEntrega,
        ordem_parada: entregasTracking.ordemParada,
        concluido_at: entregasTracking.concluidoAt,
        embarque_codigo: embarques.codigo,
        motorista_nome: embarques.motoristaNome,
        veiculo_placa: embarques.veiculoPlaca,
      })
      .from(entregasTracking)
      .innerJoin(embarques, eq(embarques.id, entregasTracking.embarqueId))
      .where(eq(entregasTracking.pedidoId, ped.id))
      .orderBy(desc(embarques.createdAt))
      .limit(1)

    return {
      success: true,
      pedido: {
        codigo: ped.codigo,
        cliente: ped.cliente,
        status_pedido: ped.status,
        previsao_entrega: ped.previsao_entrega,
        status_entrega: track?.status_entrega || 'AGUARDANDO_ROTA',
        embarque_codigo: track?.embarque_codigo || null,
        motorista_nome: track?.motorista_nome || null,
        veiculo_placa: track?.veiculo_placa || null,
        concluido_at: track?.concluido_at || null,
      },
    }
  })
}
