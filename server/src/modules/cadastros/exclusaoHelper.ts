import { and, eq, sql } from 'drizzle-orm'
import {
  clientes,
  estoqueCaixas,
  fornecedores,
  layoutsImportacaoTxt,
  mapaProgramacaoSemanal,
  mapasProducaoItens,
  pedidos,
  pedidosCompra,
  recebimentoPreCaixas,
  recebimentos,
  whatsappInbox,
} from '../../db/schema/index.js'
import { HttpError } from '../../middlewares/auth.js'
import type { DbOrTx } from '../wms/helpers.js'

export const DIAS_INATIVIDADE_EXCLUSAO = 180
const MS_POR_DIA = 86_400_000
const MS_INATIVIDADE_EXCLUSAO = DIAS_INATIVIDADE_EXCLUSAO * MS_POR_DIA

export interface ElegibilidadeExclusaoCadastro {
  encontrado: boolean
  ativo: number
  inativado_em: string | null
  dias_inativo: number | null
  tem_contas_financeiras: boolean
  teve_movimentacao: boolean
  pode_excluir_definitivo: boolean
  motivo_bloqueio_exclusao: string | null
}

function toDateOrNull(val: unknown): Date | null {
  if (!val) return null
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val
  const d = new Date(String(val))
  return Number.isNaN(d.getTime()) ? null : d
}

function avaliarRegraExclusao(params: {
  entidade: 'Cliente' | 'Fornecedor'
  tipoConta: 'contas a receber' | 'contas a pagar'
  ativo: number
  inativadoEm: Date | null
  temContasFinanceiras: boolean
  teveMovimentacao: boolean
  agoraMs?: number
}): ElegibilidadeExclusaoCadastro {
  const agora = params.agoraMs ?? Date.now()
  const diasInativo =
    params.ativo === 0 && params.inativadoEm
      ? Math.max(0, Math.floor((agora - params.inativadoEm.getTime()) / MS_POR_DIA))
      : null

  if (params.temContasFinanceiras) {
    return {
      encontrado: true,
      ativo: params.ativo,
      inativado_em: params.inativadoEm ? params.inativadoEm.toISOString() : null,
      dias_inativo: diasInativo,
      tem_contas_financeiras: true,
      teve_movimentacao: params.teveMovimentacao,
      pode_excluir_definitivo: false,
      motivo_bloqueio_exclusao: `${params.entidade} possui ${params.tipoConta} vinculadas e não pode ser apagado do registro. Utilize a opção Inativar.`,
    }
  }

  if (!params.teveMovimentacao) {
    return {
      encontrado: true,
      ativo: params.ativo,
      inativado_em: params.inativadoEm ? params.inativadoEm.toISOString() : null,
      dias_inativo: diasInativo,
      tem_contas_financeiras: false,
      teve_movimentacao: false,
      pode_excluir_definitivo: true,
      motivo_bloqueio_exclusao: null,
    }
  }

  if (params.ativo !== 0 || !params.inativadoEm) {
    return {
      encontrado: true,
      ativo: params.ativo,
      inativado_em: null,
      dias_inativo: null,
      tem_contas_financeiras: false,
      teve_movimentacao: true,
      pode_excluir_definitivo: false,
      motivo_bloqueio_exclusao: `${params.entidade} já teve movimentação e está ativo. Inative o cadastro e aguarde mais de ${DIAS_INATIVIDADE_EXCLUSAO} dias para apagar do registro.`,
    }
  }

  const msInativo = agora - params.inativadoEm.getTime()
  if (msInativo <= MS_INATIVIDADE_EXCLUSAO) {
    return {
      encontrado: true,
      ativo: params.ativo,
      inativado_em: params.inativadoEm.toISOString(),
      dias_inativo: diasInativo,
      tem_contas_financeiras: false,
      teve_movimentacao: true,
      pode_excluir_definitivo: false,
      motivo_bloqueio_exclusao: `${params.entidade} possui movimentação e está inativo há ${diasInativo ?? 0} dia(s). Só é permitido apagar do registro após mais de ${DIAS_INATIVIDADE_EXCLUSAO} dias de inatividade.`,
    }
  }

  return {
    encontrado: true,
    ativo: params.ativo,
    inativado_em: params.inativadoEm.toISOString(),
    dias_inativo: diasInativo,
    tem_contas_financeiras: false,
    teve_movimentacao: true,
    pode_excluir_definitivo: true,
    motivo_bloqueio_exclusao: null,
  }
}

async function obterStatusMovimentacaoEContasClientes(
  dbOrTx: DbOrTx,
  tenantId: string,
  clienteId?: string,
): Promise<{ contasSet: Set<string>; movSet: Set<string> }> {
  const filtroCliP = clienteId ? sql`AND p.cliente_id = ${clienteId}` : sql``
  const filtroCliM = clienteId ? sql`AND m.cliente_id = ${clienteId}` : sql``
  const filtroCliW = clienteId ? sql`AND w.cliente_sugerido_id = ${clienteId}` : sql``

  const [contasRes, movRes] = await Promise.all([
    dbOrTx.execute(sql`
      SELECT DISTINCT p.cliente_id AS id
      FROM pedidos p
      WHERE p.tenant_id = ${tenantId}
        AND p.cliente_id IS NOT NULL
        ${filtroCliP}
        AND p.status != 'CANCELADO'
        AND NOT EXISTS (
          SELECT 1
          FROM entregas_tracking et
          WHERE et.pedido_id = p.id
            AND et.pagamento_confirmado = 1
        )
        AND (
          EXISTS (
            SELECT 1
            FROM pedidos_parcelas pp
            WHERE pp.pedido_id = p.id
          )
          OR (
            COALESCE(p.valor_total, 0) > 0
            AND (
              p.status NOT IN ('EXPEDIDO', 'CANCELADO')
              OR p.pagamento_na_entrega = 1
            )
          )
        )
    `),
    dbOrTx.execute(sql`
      SELECT DISTINCT id FROM (
        SELECT p.cliente_id AS id
        FROM pedidos p
        WHERE p.tenant_id = ${tenantId} AND p.cliente_id IS NOT NULL ${filtroCliP}
        UNION
        SELECT m.cliente_id AS id
        FROM mapas_producao_itens m
        WHERE m.tenant_id = ${tenantId} AND m.cliente_id IS NOT NULL ${filtroCliM}
        UNION
        SELECT w.cliente_sugerido_id AS id
        FROM whatsapp_inbox w
        WHERE w.tenant_id = ${tenantId} AND w.cliente_sugerido_id IS NOT NULL ${filtroCliW}
      ) movs
    `),
  ])

  const contasSet = new Set(
    (contasRes.rows as Array<{ id: string }>).map((r) => String(r.id)),
  )
  const movSet = new Set(
    (movRes.rows as Array<{ id: string }>).map((r) => String(r.id)),
  )
  return { contasSet, movSet }
}

async function obterStatusMovimentacaoEContasFornecedores(
  dbOrTx: DbOrTx,
  tenantId: string,
  fornecedorId?: string,
): Promise<{ contasSet: Set<string>; movSet: Set<string> }> {
  const filtroFornPc = fornecedorId ? sql`AND pc.fornecedor_id = ${fornecedorId}` : sql``
  const filtroFornRec = fornecedorId ? sql`AND r.fornecedor_id = ${fornecedorId}` : sql``
  const filtroFornPre = fornecedorId ? sql`AND pre.fornecedor_id = ${fornecedorId}` : sql``
  const filtroFornCx = fornecedorId ? sql`AND ec.fornecedor_id = ${fornecedorId}` : sql``

  const [contasRes, movRes] = await Promise.all([
    dbOrTx.execute(sql`
      SELECT DISTINCT id FROM (
        SELECT r.fornecedor_id AS id
        FROM recebimentos r
        WHERE r.tenant_id = ${tenantId}
          AND r.fornecedor_id IS NOT NULL
          ${filtroFornRec}
          AND (
            jsonb_array_length(COALESCE(r.xml_duplicatas_json, '[]'::jsonb)) > 0
            OR COALESCE(r.valor_total_nf, 0) > 0
          )
        UNION
        SELECT pc.fornecedor_id AS id
        FROM pedidos_compra pc
        WHERE pc.tenant_id = ${tenantId}
          AND pc.fornecedor_id IS NOT NULL
          ${filtroFornPc}
          AND pc.status != 'CANCELADO'
          AND (
            pc.status IN ('ABERTO', 'APROVADO', 'PARCIAL')
            OR pc.forma_pagamento_id IS NOT NULL
            OR COALESCE(pc.valor_total, 0) > 0
          )
      ) contas_pagar
    `),
    dbOrTx.execute(sql`
      SELECT DISTINCT id FROM (
        SELECT pc.fornecedor_id AS id
        FROM pedidos_compra pc
        WHERE pc.tenant_id = ${tenantId} AND pc.fornecedor_id IS NOT NULL ${filtroFornPc}
        UNION
        SELECT r.fornecedor_id AS id
        FROM recebimentos r
        WHERE r.tenant_id = ${tenantId} AND r.fornecedor_id IS NOT NULL ${filtroFornRec}
        UNION
        SELECT pre.fornecedor_id AS id
        FROM recebimento_pre_caixas pre
        WHERE pre.tenant_id = ${tenantId} AND pre.fornecedor_id IS NOT NULL ${filtroFornPre}
        UNION
        SELECT ec.fornecedor_id AS id
        FROM estoque_caixas ec
        WHERE ec.tenant_id = ${tenantId} AND ec.fornecedor_id IS NOT NULL ${filtroFornCx}
      ) movs
    `),
  ])

  const contasSet = new Set(
    (contasRes.rows as Array<{ id: string }>).map((r) => String(r.id)),
  )
  const movSet = new Set(
    (movRes.rows as Array<{ id: string }>).map((r) => String(r.id)),
  )
  return { contasSet, movSet }
}

export async function avaliarExclusaoEmLoteClientes(
  dbOrTx: DbOrTx,
  tenantId: string,
  rows: Array<{ id: string; ativo: unknown; inativado_em?: unknown }>,
): Promise<Map<string, ElegibilidadeExclusaoCadastro>> {
  const { contasSet, movSet } = await obterStatusMovimentacaoEContasClientes(dbOrTx, tenantId)
  const agoraMs = Date.now()
  const out = new Map<string, ElegibilidadeExclusaoCadastro>()
  for (const r of rows) {
    const id = String(r.id)
    out.set(
      id,
      avaliarRegraExclusao({
        entidade: 'Cliente',
        tipoConta: 'contas a receber',
        ativo: Number(r.ativo ?? 1),
        inativadoEm: toDateOrNull(r.inativado_em),
        temContasFinanceiras: contasSet.has(id),
        teveMovimentacao: movSet.has(id) || contasSet.has(id),
        agoraMs,
      }),
    )
  }
  return out
}

export async function avaliarExclusaoEmLoteFornecedores(
  dbOrTx: DbOrTx,
  tenantId: string,
  rows: Array<{ id: string; ativo: unknown; inativado_em?: unknown }>,
): Promise<Map<string, ElegibilidadeExclusaoCadastro>> {
  const { contasSet, movSet } = await obterStatusMovimentacaoEContasFornecedores(dbOrTx, tenantId)
  const agoraMs = Date.now()
  const out = new Map<string, ElegibilidadeExclusaoCadastro>()
  for (const r of rows) {
    const id = String(r.id)
    out.set(
      id,
      avaliarRegraExclusao({
        entidade: 'Fornecedor',
        tipoConta: 'contas a pagar',
        ativo: Number(r.ativo ?? 1),
        inativadoEm: toDateOrNull(r.inativado_em),
        temContasFinanceiras: contasSet.has(id),
        teveMovimentacao: movSet.has(id) || contasSet.has(id),
        agoraMs,
      }),
    )
  }
  return out
}

export async function executarExclusaoDefinitivaCliente(
  tx: DbOrTx,
  tenantId: string,
  clienteId: string,
): Promise<void> {
  const [cli] = await tx
    .select({ id: clientes.id, ativo: clientes.ativo, inativadoEm: clientes.inativadoEm })
    .from(clientes)
    .where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, tenantId)))
    .limit(1)

  if (!cli) {
    throw new HttpError(404, 'Cliente não encontrado.')
  }

  const { contasSet, movSet } = await obterStatusMovimentacaoEContasClientes(tx, tenantId, clienteId)
  const status = avaliarRegraExclusao({
    entidade: 'Cliente',
    tipoConta: 'contas a receber',
    ativo: Number(cli.ativo),
    inativadoEm: toDateOrNull(cli.inativadoEm),
    temContasFinanceiras: contasSet.has(clienteId),
    teveMovimentacao: movSet.has(clienteId) || contasSet.has(clienteId),
  })

  if (!status.pode_excluir_definitivo) {
    throw new HttpError(409, status.motivo_bloqueio_exclusao || 'Cliente não pode ser excluído do registro.')
  }

  await Promise.all([
    tx.update(pedidos).set({ clienteId: null }).where(and(eq(pedidos.tenantId, tenantId), eq(pedidos.clienteId, clienteId))),
    tx.update(mapasProducaoItens).set({ clienteId: null }).where(and(eq(mapasProducaoItens.tenantId, tenantId), eq(mapasProducaoItens.clienteId, clienteId))),
    tx.update(whatsappInbox).set({ clienteSugeridoId: null }).where(and(eq(whatsappInbox.tenantId, tenantId), eq(whatsappInbox.clienteSugeridoId, clienteId))),
    tx.update(mapaProgramacaoSemanal).set({ clienteId: null }).where(and(eq(mapaProgramacaoSemanal.tenantId, tenantId), eq(mapaProgramacaoSemanal.clienteId, clienteId))),
  ])

  await tx.delete(clientes).where(and(eq(clientes.id, clienteId), eq(clientes.tenantId, tenantId)))
}

export async function executarExclusaoDefinitivaFornecedor(
  tx: DbOrTx,
  tenantId: string,
  fornecedorId: string,
): Promise<void> {
  const [forn] = await tx
    .select({ id: fornecedores.id, ativo: fornecedores.ativo, inativadoEm: fornecedores.inativadoEm })
    .from(fornecedores)
    .where(and(eq(fornecedores.id, fornecedorId), eq(fornecedores.tenantId, tenantId)))
    .limit(1)

  if (!forn) {
    throw new HttpError(404, 'Fornecedor não encontrado.')
  }

  const { contasSet, movSet } = await obterStatusMovimentacaoEContasFornecedores(tx, tenantId, fornecedorId)
  const status = avaliarRegraExclusao({
    entidade: 'Fornecedor',
    tipoConta: 'contas a pagar',
    ativo: Number(forn.ativo),
    inativadoEm: toDateOrNull(forn.inativadoEm),
    temContasFinanceiras: contasSet.has(fornecedorId),
    teveMovimentacao: movSet.has(fornecedorId) || contasSet.has(fornecedorId),
  })

  if (!status.pode_excluir_definitivo) {
    throw new HttpError(409, status.motivo_bloqueio_exclusao || 'Fornecedor não pode ser excluído do registro.')
  }

  await Promise.all([
    tx.update(estoqueCaixas).set({ fornecedorId: null }).where(and(eq(estoqueCaixas.tenantId, tenantId), eq(estoqueCaixas.fornecedorId, fornecedorId))),
    tx.update(recebimentos).set({ fornecedorId: null }).where(and(eq(recebimentos.tenantId, tenantId), eq(recebimentos.fornecedorId, fornecedorId))),
    tx.update(recebimentoPreCaixas).set({ fornecedorId: null }).where(and(eq(recebimentoPreCaixas.tenantId, tenantId), eq(recebimentoPreCaixas.fornecedorId, fornecedorId))),
    tx.update(pedidosCompra).set({ fornecedorId: null }).where(and(eq(pedidosCompra.tenantId, tenantId), eq(pedidosCompra.fornecedorId, fornecedorId))),
    tx.update(layoutsImportacaoTxt).set({ fornecedorId: null }).where(and(eq(layoutsImportacaoTxt.tenantId, tenantId), eq(layoutsImportacaoTxt.fornecedorId, fornecedorId))),
  ])

  await tx.delete(fornecedores).where(and(eq(fornecedores.id, fornecedorId), eq(fornecedores.tenantId, tenantId)))
}
