import { createClient, type Client } from '@libsql/client'
import { and, eq, sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { createDbConnection, type DbConnection } from '../db/client.js'
import { runMigrationsAndSeed } from '../db/migrate.js'
import {
  auditoriaAcessos,
  caixasHistorico,
  clientes,
  desmembramentosVinculos,
  eanSequencias,
  estoqueCaixas,
  estoquePosicao,
  inventarioAjustesLog,
  inventarioCiclos,
  inventarioItens,
  inventarioZonas,
  inventarios,
  locais,
  movimentacoesLog,
  opInsumos,
  opItensPrevistos,
  opRetornos,
  operadores,
  ordensProducao,
  paletes,
  pedidos,
  pedidosItens,
  perfisAcesso,
  produtoArvore,
  produtos,
  produtosEans,
  romaneios,
  romaneiosItens,
  taras,
} from '../db/schema/index.js'
import { hashSenha } from '../utils/crypto.js'
import { sanitizarPermissoes } from '../utils/permissoes.js'
import { uuidv7 } from '../utils/uuid.js'

export interface MigrationAuditReport {
  tenantId: string
  empresaId: string
  filialPadraoId: string
  counts: Record<string, { source: number; target: number }>
  estoqueDisponivel: {
    sourceCount: number
    targetCount: number
    sourceKg: string
    targetKg: string
  }
}

function parseJsonSafe(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function asIsoDate(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function asTimestamp(val: unknown): Date | null {
  if (!val) return null
  const s = String(val).trim()
  const normalized = s.includes('T') || s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d
}

function numStr(val: unknown, fallback = '0', decimals = 3): string {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return Number.isFinite(n) ? n.toFixed(decimals) : fallback
}

function nullableNumStr(val: unknown, decimals = 3): string | null {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n.toFixed(decimals) : null
}

async function readTursoRows(turso: Client, table: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await turso.execute(`SELECT * FROM "${table}"`)
    return res.rows as unknown as Record<string, unknown>[]
  } catch {
    return []
  }
}

export async function migrateTursoToPostgres(turso: Client, conn: DbConnection): Promise<MigrationAuditReport> {
  const seed = await runMigrationsAndSeed(conn)
  const { tenantId, empresaId, filialIds } = seed
  const filialPadraoId = filialIds.estoque
  const db = conn.db

  // Mapas legacy_id -> UUID
  const opIdMap = new Map<number, string>()
  const taraIdMap = new Map<number, string>()
  const prodIdMap = new Map<number, string>()
  const cliIdMap = new Map<number, string>()
  const palIdMap = new Map<number, string>()
  const opProdIdMap = new Map<number, string>() // ordens_producao
  const caixaIdMap = new Map<number, string>()
  const pedIdMap = new Map<number, string>()
  const romIdMap = new Map<number, string>()
  const cicloIdMap = new Map<number, string>()
  const invIdMap = new Map<number, string>()
  const invItemIdMap = new Map<number, string>()

  const [
    srcPerfis,
    srcOperadores,
    srcTaras,
    srcLocais,
    srcProdutos,
    srcProdEans,
    srcArvore,
    srcClientes,
    srcPaletes,
    srcOps,
    srcOpPrev,
    srcCaixas,
    srcOpInsumos,
    srcOpRetornos,
    srcDesm,
    srcSeqs,
    srcPosicao,
    srcPedidos,
    srcPedidosItens,
    srcRomaneios,
    srcRomItens,
    srcHistCaixas,
    srcMovLog,
    srcCiclos,
    srcInvs,
    srcZonas,
    srcInvItens,
    srcInvAjustes,
    srcAuditoria,
  ] = await Promise.all([
    readTursoRows(turso, 'perfis_acesso'),
    readTursoRows(turso, 'operadores'),
    readTursoRows(turso, 'taras'),
    readTursoRows(turso, 'locais'),
    readTursoRows(turso, 'produtos'),
    readTursoRows(turso, 'produtos_eans'),
    readTursoRows(turso, 'produto_arvore'),
    readTursoRows(turso, 'clientes'),
    readTursoRows(turso, 'paletes'),
    readTursoRows(turso, 'ordens_producao'),
    readTursoRows(turso, 'op_itens_previstos'),
    readTursoRows(turso, 'estoque_caixas'),
    readTursoRows(turso, 'op_insumos'),
    readTursoRows(turso, 'op_retornos'),
    readTursoRows(turso, 'desmembramentos_vinculos'),
    readTursoRows(turso, 'ean_sequencias'),
    readTursoRows(turso, 'estoque_posicao'),
    readTursoRows(turso, 'pedidos'),
    readTursoRows(turso, 'pedidos_itens'),
    readTursoRows(turso, 'romaneios'),
    readTursoRows(turso, 'romaneios_itens'),
    readTursoRows(turso, 'caixas_historico'),
    readTursoRows(turso, 'movimentacoes_log'),
    readTursoRows(turso, 'inventario_ciclos'),
    readTursoRows(turso, 'inventarios'),
    readTursoRows(turso, 'inventario_zonas'),
    readTursoRows(turso, 'inventario_itens'),
    readTursoRows(turso, 'inventario_ajustes_log'),
    readTursoRows(turso, 'auditoria_acessos'),
  ])

  // 1. Perfis de acesso
  for (const r of srcPerfis) {
    const codigo = String(r.codigo || '').trim().toUpperCase()
    if (!codigo) continue
    const nivel = String(r.nivel || 'OPERACIONAL').toUpperCase()
    const perms = sanitizarPermissoes(r.permissoes_json, nivel, codigo)
    await db
      .insert(perfisAcesso)
      .values({
        id: uuidv7(),
        tenantId,
        legacyId: Number(r.id),
        codigo,
        nome: String(r.nome || codigo),
        nivel,
        setorPadrao: String(r.setor_padrao || 'Produção'),
        descricao: String(r.descricao || ''),
        permissoesJson: perms,
        sistemaFixo: Number(r.sistema_fixo || 0),
      })
      .onConflictDoUpdate({
        target: [perfisAcesso.tenantId, perfisAcesso.codigo],
        set: {
          nome: String(r.nome || codigo),
          permissoesJson: perms,
          descricao: String(r.descricao || ''),
        },
      })
  }

  // 2. Operadores (preserva senha_hash PBKDF2 do Turso!)
  const fallbackHash = await hashSenha('123456')
  for (const r of srcOperadores) {
    const login = String(r.login || r.nome || `user_${r.id}`).trim()
    const nivel = String(r.nivel || (Number(r.is_adm) === 1 ? 'ADMINISTRADOR' : 'OPERACIONAL')).toUpperCase()
    const perfil = String(r.perfil || nivel).toUpperCase()
    const perms = sanitizarPermissoes(r.permissoes, nivel, perfil)
    const senhaHash = String(r.senha_hash || '').startsWith('pbkdf2$')
      ? String(r.senha_hash)
      : fallbackHash

    const existing = await db
      .select()
      .from(operadores)
      .where(and(eq(operadores.tenantId, tenantId), sql`LOWER(${operadores.login}) = LOWER(${login})`))
      .limit(1)

    if (existing[0]) {
      opIdMap.set(Number(r.id), existing[0].id)
      await db
        .update(operadores)
        .set({
          legacyId: Number(r.id),
          nome: String(r.nome || login),
          senhaHash,
          perfil,
          nivel,
          setor: String(r.setor || 'Produção'),
          isAdm: Number(r.is_adm ?? 0),
          ativo: Number(r.ativo ?? 1),
          deveTrocarSenha: Number(r.deve_trocar_senha ?? 0),
          permissoesJson: perms,
          ultimoAcesso: asTimestamp(r.ultimo_acesso),
        })
        .where(eq(operadores.id, existing[0].id))
    } else {
      const id = uuidv7()
      opIdMap.set(Number(r.id), id)
      await db.insert(operadores).values({
        id,
        tenantId,
        empresaId,
        filialPadraoId,
        legacyId: Number(r.id),
        nome: String(r.nome || login),
        login,
        pin: String(r.pin || '****'),
        senhaHash,
        perfil,
        nivel,
        setor: String(r.setor || 'Produção'),
        isAdm: Number(r.is_adm ?? 0),
        ativo: Number(r.ativo ?? 1),
        deveTrocarSenha: Number(r.deve_trocar_senha ?? 0),
        permissoesJson: perms,
        ultimoAcesso: asTimestamp(r.ultimo_acesso),
        criadoPorNome: r.criado_por_nome ? String(r.criado_por_nome) : null,
        atualizadoPorNome: r.atualizado_por_nome ? String(r.atualizado_por_nome) : null,
        createdAt: asTimestamp(r.created_at) ?? new Date(),
      })
    }
  }

  // 3. Taras
  for (const r of srcTaras) {
    const existing = await db
      .select()
      .from(taras)
      .where(and(eq(taras.tenantId, tenantId), eq(taras.legacyId, Number(r.id))))
      .limit(1)
    if (existing[0]) {
      taraIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    taraIdMap.set(Number(r.id), id)
    await db.insert(taras).values({
      id,
      tenantId,
      legacyId: Number(r.id),
      nome: String(r.nome),
      pesoKg: numStr(r.peso_kg, '0', 3),
      ativo: Number(r.ativo ?? 1),
      padrao: Number(r.padrao ?? 0),
    })
  }

  // 4. Locais
  for (const r of srcLocais) {
    const endereco = String(r.endereco || '').trim()
    if (!endereco) continue
    await db
      .insert(locais)
      .values({
        id: uuidv7(),
        tenantId,
        filialId: filialPadraoId,
        legacyId: Number(r.id),
        endereco,
        capacidadeMaxCaixas: numStr(r.capacidade_max_caixas, '0', 2),
        ativo: Number(r.ativo ?? 1),
        isInsumo: Number(r.is_insumo ?? 0),
        tipoArmazenamento: String(r.tipo_armazenamento || 'SECO'),
      })
      .onConflictDoNothing()
  }

  // 5. Produtos + Pai + EANs + Arvore
  for (const r of srcProdutos) {
    const existing = await db
      .select()
      .from(produtos)
      .where(and(eq(produtos.tenantId, tenantId), eq(produtos.legacyId, Number(r.id))))
      .limit(1)
    if (existing[0]) {
      prodIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    prodIdMap.set(Number(r.id), id)
    const cod = r.codigo ? String(r.codigo).trim() : null
    const ean = r.ean ? String(r.ean).trim() : null
    await db.insert(produtos).values({
      id,
      tenantId,
      legacyId: Number(r.id),
      codigo: cod || null,
      ean: ean || null,
      descricao: String(r.descricao || ''),
      valorUnitario: numStr(r.valor_unitario, '0', 4),
      tipoProduto: String(r.tipo_produto || 'Materia Prima'),
      statusCurva: String(r.status_curva || 'C'),
      unidade: String(r.unidade || 'CX'),
      grupo: String(r.grupo || ''),
      classificacao: r.classificacao ? String(r.classificacao) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }
  for (const r of srcProdutos) {
    if (r.produto_pai_id) {
      const id = prodIdMap.get(Number(r.id))
      const paiId = prodIdMap.get(Number(r.produto_pai_id))
      if (id && paiId) {
        await db.update(produtos).set({ produtoPaiId: paiId }).where(eq(produtos.id, id))
      }
    }
  }
  for (const r of srcProdEans) {
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!produtoId) continue
    await db
      .insert(produtosEans)
      .values({
        id: uuidv7(),
        tenantId,
        legacyId: Number(r.id),
        produtoId,
        codigoBarras: String(r.codigo_barras),
        tipoRegra: String(r.tipo_regra || 'EXATO'),
      })
      .onConflictDoNothing()
  }
  for (const r of srcArvore) {
    const paiId = prodIdMap.get(Number(r.pai_id))
    const filhoId = prodIdMap.get(Number(r.filho_id))
    if (!paiId || !filhoId) continue
    await db
      .insert(produtoArvore)
      .values({
        id: uuidv7(),
        tenantId,
        paiId,
        filhoId,
        origemVinculo: 'MANUAL',
      })
      .onConflictDoNothing()
  }

  // 6. Clientes
  for (const r of srcClientes) {
    const existing = await db
      .select()
      .from(clientes)
      .where(and(eq(clientes.tenantId, tenantId), eq(clientes.legacyId, Number(r.id))))
      .limit(1)
    if (existing[0]) {
      cliIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    cliIdMap.set(Number(r.id), id)
    await db.insert(clientes).values({
      id,
      tenantId,
      legacyId: Number(r.id),
      codigo: r.codigo ? String(r.codigo) : null,
      razaoSocial: String(r.razao_social || ''),
      nomeFantasia: String(r.nome_fantasia || r.razao_social || ''),
      cnpjCpf: String(r.cnpj_cpf || ''),
      inscricaoEstadual: String(r.inscricao_estadual || ''),
      endereco: String(r.endereco || ''),
      numero: String(r.numero || ''),
      complemento: String(r.complemento || ''),
      bairro: String(r.bairro || ''),
      cep: String(r.cep || ''),
      cidade: String(r.cidade || ''),
      uf: String(r.uf || 'SP'),
      pais: String(r.pais || 'BRASIL'),
      telefone: String(r.telefone || ''),
      icms: String(r.icms || 'CONTRIBUINTE'),
      isPadrao: Number(r.is_padrao ?? 0),
      ativo: Number(r.ativo ?? 1),
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }

  // 7. Paletes
  for (const r of srcPaletes) {
    const existing = await db
      .select()
      .from(paletes)
      .where(and(eq(paletes.tenantId, tenantId), eq(paletes.codigo, String(r.codigo))))
      .limit(1)
    if (existing[0]) {
      palIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    palIdMap.set(Number(r.id), id)
    await db.insert(paletes).values({
      id,
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      codigo: String(r.codigo),
      enderecoAtual: String(r.endereco_atual || 'REC'),
      status: String(r.status || 'EM_MONTAGEM'),
      ultimoOperador: r.ultimo_operador ? String(r.ultimo_operador) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }

  // 8. Ordens de Producao & Itens Previstos
  for (const r of srcOps) {
    const existing = await db
      .select()
      .from(ordensProducao)
      .where(and(eq(ordensProducao.tenantId, tenantId), eq(ordensProducao.codigo, String(r.codigo))))
      .limit(1)
    if (existing[0]) {
      opProdIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    opProdIdMap.set(Number(r.id), id)
    await db.insert(ordensProducao).values({
      id,
      tenantId,
      filialId: filialIds.industrializacao || filialPadraoId,
      legacyId: Number(r.id),
      codigo: String(r.codigo),
      nome: r.nome ? String(r.nome) : null,
      status: String(r.status || 'ABERTA'),
      operadorId: r.operador_id ? opIdMap.get(Number(r.operador_id)) ?? null : null,
      operadorNome: r.operador_nome ? String(r.operador_nome) : null,
      reaberta: Number(r.reaberta ?? 0),
      rendimentoPct: nullableNumStr(r.rendimento_pct, 2),
      perdaPct: nullableNumStr(r.perda_pct, 2),
      cliente: String(r.cliente || 'INTERNO'),
      endereco: String(r.endereco || 'PRODUCAO'),
      dataProducao: asIsoDate(r.data_producao),
      observacoes: String(r.observacoes || ''),
      criadoPorId: r.criado_por_id ? opIdMap.get(Number(r.criado_por_id)) ?? null : null,
      criadoPorNome: r.criado_por_nome ? String(r.criado_por_nome) : null,
      liberadaEm: asTimestamp(r.liberada_em),
      createdAt: asTimestamp(r.created_at) ?? new Date(),
      updatedAt: asTimestamp(r.updated_at) ?? new Date(),
    })
  }
  for (const r of srcOpPrev) {
    const opId = opProdIdMap.get(Number(r.op_id))
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!opId || !produtoId) continue
    await db.insert(opItensPrevistos).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      opId,
      tipo: String(r.tipo),
      produtoId,
      qtdCaixasPrevista: nullableNumStr(r.qtd_caixas_prevista, 2),
      pesoKgPrevisto: nullableNumStr(r.peso_kg_previsto, 3),
      unidadePrevista: String(r.unidade_prevista || 'KG'),
      observacao: String(r.observacao || ''),
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }

  // 9. Pedidos & Itens (antes das caixas para permitir referencia de reserva)
  for (const r of srcPedidos) {
    const existing = await db
      .select()
      .from(pedidos)
      .where(and(eq(pedidos.tenantId, tenantId), eq(pedidos.codigo, String(r.codigo))))
      .limit(1)
    if (existing[0]) {
      pedIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    pedIdMap.set(Number(r.id), id)
    await db.insert(pedidos).values({
      id,
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      codigo: String(r.codigo),
      titulo: String(r.titulo),
      clienteId: r.cliente_id ? cliIdMap.get(Number(r.cliente_id)) ?? null : null,
      cliente: String(r.cliente || 'PAVAN'),
      previsaoEntrega: asIsoDate(r.previsao_entrega),
      observacoes: String(r.observacoes || ''),
      status: String(r.status || 'LIBERADO'),
      criadoPorId: r.criado_por_id ? opIdMap.get(Number(r.criado_por_id)) ?? null : null,
      criadoPorNome: r.criado_por_nome ? String(r.criado_por_nome) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
      updatedAt: asTimestamp(r.updated_at) ?? new Date(),
      liberadoAt: asTimestamp(r.liberado_at),
      separadoAt: asTimestamp(r.separado_at),
      expedidoAt: asTimestamp(r.expedido_at),
      canceladoAt: asTimestamp(r.cancelado_at),
    })
  }
  for (const r of srcPedidosItens) {
    const pedidoId = pedIdMap.get(Number(r.pedido_id))
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!pedidoId || !produtoId) continue
    await db
      .insert(pedidosItens)
      .values({
        id: uuidv7(),
        tenantId,
        legacyId: Number(r.id),
        pedidoId,
        produtoId,
        qtdKgSolicitada: numStr(r.qtd_kg_solicitada, '0', 3),
        qtdCaixasSolicitada: nullableNumStr(r.qtd_caixas_solicitada, 2),
        unidadeSolicitada: String(r.unidade_solicitada || 'KG'),
        qtdSolicitadaExibicao: nullableNumStr(r.qtd_solicitada_exibicao, 3),
        observacao: String(r.observacao || ''),
        createdAt: asTimestamp(r.created_at) ?? new Date(),
      })
      .onConflictDoNothing()
  }

  // 10. Romaneios (cabecalho antes das caixas para mapear romaneio_reservado_id)
  for (const r of srcRomaneios) {
    const existing = await db
      .select()
      .from(romaneios)
      .where(and(eq(romaneios.tenantId, tenantId), eq(romaneios.codigo, String(r.codigo))))
      .limit(1)
    if (existing[0]) {
      romIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    romIdMap.set(Number(r.id), id)
    await db.insert(romaneios).values({
      id,
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      codigo: String(r.codigo),
      pedidoId: r.pedido_id ? pedIdMap.get(Number(r.pedido_id)) ?? null : null,
      cliente: String(r.cliente || ''),
      previsaoEntrega: r.previsao_entrega ? String(r.previsao_entrega) : null,
      status: String(r.status || 'MONTANDO'),
      operadorId: r.operador_id ? opIdMap.get(Number(r.operador_id)) ?? null : null,
      operadorNome: r.operador_nome ? String(r.operador_nome) : null,
      operadorConferenciaNome: r.operador_conferencia_nome ? String(r.operador_conferencia_nome) : null,
      operadorExpedicaoNome: r.operador_expedicao_nome ? String(r.operador_expedicao_nome) : null,
      conferidoAt: asTimestamp(r.conferido_at),
      expedidoAt: asTimestamp(r.expedido_at),
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }

  // 11. Estoque Serializado (Caixas)
  for (const r of srcCaixas) {
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!produtoId) continue
    const existing = await db
      .select()
      .from(estoqueCaixas)
      .where(and(eq(estoqueCaixas.tenantId, tenantId), eq(estoqueCaixas.eanCaixa, String(r.ean_caixa))))
      .limit(1)
    if (existing[0]) {
      caixaIdMap.set(Number(r.id), existing[0].id)
      continue
    }
    const id = uuidv7()
    caixaIdMap.set(Number(r.id), id)
    await db.insert(estoqueCaixas).values({
      id,
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      eanCaixa: String(r.ean_caixa),
      produtoId,
      paleteId: r.palete_id ? palIdMap.get(Number(r.palete_id)) ?? null : null,
      paleteOrigemId: r.palete_origem_id ? palIdMap.get(Number(r.palete_origem_id)) ?? null : null,
      endereco: r.endereco ? String(r.endereco) : null,
      lote: String(r.lote || ''),
      dataProducao: asIsoDate(r.data_producao),
      validade: asIsoDate(r.validade),
      pesoBrutoKg: nullableNumStr(r.peso_bruto_kg, 3),
      taraId: r.tara_id ? taraIdMap.get(Number(r.tara_id)) ?? null : null,
      taraKg: numStr(r.tara_kg, '0', 3),
      pesoKg: numStr(r.peso_kg, '0', 3),
      qtdPecas: r.qtd_pecas !== null && r.qtd_pecas !== undefined ? Number(r.qtd_pecas) : null,
      origemTipo: String(r.origem_tipo || 'RECEBIMENTO'),
      eanOrigem: r.ean_origem ? String(r.ean_origem) : null,
      opId: r.op_id ? opProdIdMap.get(Number(r.op_id)) ?? null : null,
      operadorCadastroNome: r.operador_cadastro_nome ? String(r.operador_cadastro_nome) : null,
      status: String(r.status || 'DISPONIVEL'),
      pedidoReservadoId: r.pedido_reservado_id ? pedIdMap.get(Number(r.pedido_reservado_id)) ?? null : null,
      pedidoReservadoCodigo: r.pedido_reservado_codigo ? String(r.pedido_reservado_codigo) : null,
      romaneioReservadoId: r.romaneio_reservado_id ? romIdMap.get(Number(r.romaneio_reservado_id)) ?? null : null,
      romaneioReservadoCodigo: r.romaneio_reservado_codigo ? String(r.romaneio_reservado_codigo) : null,
      clienteReservadoNome: r.cliente_reservado_nome ? String(r.cliente_reservado_nome) : null,
      reservadoEm: asTimestamp(r.reservado_em),
      createdAt: asTimestamp(r.created_at) ?? new Date(),
      updatedAt: asTimestamp(r.updated_at) ?? new Date(),
    })
  }
  for (const r of srcCaixas) {
    if (r.caixa_origem_id) {
      const id = caixaIdMap.get(Number(r.id))
      const origemId = caixaIdMap.get(Number(r.caixa_origem_id))
      if (id && origemId) {
        await db.update(estoqueCaixas).set({ caixaOrigemId: origemId }).where(eq(estoqueCaixas.id, id))
      }
    }
  }

  // 12. Op Insumos, Retornos, Desmembramentos, EAN Sequencias, Estoque Posicao, Romaneios Itens
  for (const r of srcOpInsumos) {
    const opId = opProdIdMap.get(Number(r.op_id))
    if (!opId) continue
    await db.insert(opInsumos).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      opId,
      caixaId: r.caixa_id ? caixaIdMap.get(Number(r.caixa_id)) ?? null : null,
      produtoId: r.produto_id ? prodIdMap.get(Number(r.produto_id)) ?? null : null,
      pesoKg: numStr(r.peso_kg, '0', 3),
      pesoBrutoKg: nullableNumStr(r.peso_bruto_kg, 3),
      taraKg: numStr(r.tara_kg, '0', 3),
      dataProducao: asIsoDate(r.data_producao),
      lote: String(r.lote || ''),
      qtdPecas: r.qtd_pecas !== null && r.qtd_pecas !== undefined ? Number(r.qtd_pecas) : null,
      operadorNome: r.operador_nome ? String(r.operador_nome) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }
  for (const r of srcOpRetornos) {
    const opId = opProdIdMap.get(Number(r.op_id))
    if (!opId) continue
    await db.insert(opRetornos).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      opId,
      caixaId: r.caixa_id ? caixaIdMap.get(Number(r.caixa_id)) ?? null : null,
      produtoId: r.produto_id ? prodIdMap.get(Number(r.produto_id)) ?? null : null,
      pesoKg: numStr(r.peso_kg, '0', 3),
      pesoBrutoKg: nullableNumStr(r.peso_bruto_kg, 3),
      taraId: r.tara_id ? taraIdMap.get(Number(r.tara_id)) ?? null : null,
      taraKg: numStr(r.tara_kg, '0', 3),
      dataProducao: asIsoDate(r.data_producao),
      validade: asIsoDate(r.validade),
      lote: String(r.lote || ''),
      qtdPecas: r.qtd_pecas !== null && r.qtd_pecas !== undefined ? Number(r.qtd_pecas) : null,
      operadorNome: r.operador_nome ? String(r.operador_nome) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }
  for (const r of srcDesm) {
    const origemId = caixaIdMap.get(Number(r.caixa_origem_id))
    const destId = caixaIdMap.get(Number(r.caixa_destino_id))
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!origemId || !destId || !produtoId) continue
    await db.insert(desmembramentosVinculos).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      codigoOperacao: String(r.codigo_operacao),
      caixaOrigemId: origemId,
      eanOrigem: String(r.ean_origem),
      caixaDestinoId: destId,
      eanDestino: String(r.ean_destino),
      produtoId,
      pesoLiquidoKg: numStr(r.peso_liquido_kg, '0', 3),
      pesoBrutoKg: nullableNumStr(r.peso_bruto_kg, 3),
      taraKg: numStr(r.tara_kg, '0', 3),
      lote: String(r.lote || ''),
      dataProducao: asIsoDate(r.data_producao),
      validade: asIsoDate(r.validade),
      qtdPecas: r.qtd_pecas !== null && r.qtd_pecas !== undefined ? Number(r.qtd_pecas) : null,
      perdaPecas: Number(r.perda_pecas ?? 0),
      motivoDiferencaPecas: String(r.motivo_diferenca_pecas || ''),
      operadorId: r.operador_id ? opIdMap.get(Number(r.operador_id)) ?? null : null,
      operadorNome: r.operador_nome ? String(r.operador_nome) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }
  for (const r of srcSeqs) {
    const chave = String(r.chave || '')
    const ult = Number(r.ultimo_numero || 900000)
    await db
      .insert(eanSequencias)
      .values({ id: uuidv7(), tenantId, chave, ultimoNumero: ult })
      .onConflictDoUpdate({
        target: [eanSequencias.tenantId, eanSequencias.chave],
        set: { ultimoNumero: sql`GREATEST(${eanSequencias.ultimoNumero}, ${ult})` },
      })
  }
  for (const r of srcPosicao) {
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!produtoId) continue
    await db.insert(estoquePosicao).values({
      id: uuidv7(),
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      produtoId,
      endereco: String(r.endereco),
      lote: String(r.lote || ''),
      validade: asIsoDate(r.validade),
      qtdCaixas: numStr(r.qtd_caixas, '0', 2),
      qtdKg: numStr(r.qtd_kg, '0', 3),
      updatedAt: asTimestamp(r.updated_at) ?? new Date(),
    })
  }
  for (const r of srcRomItens) {
    const romaneioId = romIdMap.get(Number(r.romaneio_id))
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!romaneioId || !produtoId) continue
    await db.insert(romaneiosItens).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      romaneioId,
      caixaId: r.caixa_id ? caixaIdMap.get(Number(r.caixa_id)) ?? null : null,
      produtoId,
      pesoKg: nullableNumStr(r.peso_kg, 3),
      conferido: Number(r.conferido ?? 0),
      conferidoAt: asTimestamp(r.conferido_at),
      conferidoPor: r.conferido_por ? String(r.conferido_por) : null,
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }

  // 13. Historico Caixas, Movimentacoes Log, Inventarios e Auditoria
  for (const r of srcHistCaixas) {
    await db.insert(caixasHistorico).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      caixaId: r.caixa_id ? caixaIdMap.get(Number(r.caixa_id)) ?? null : null,
      eanCaixa: String(r.ean_caixa || ''),
      operacao: String(r.operacao || 'INFO'),
      detalhes: String(r.detalhes || ''),
      operadorNome: String(r.operador_nome || 'Sistema'),
      dataHora: asTimestamp(r.data_hora) ?? new Date(),
    })
  }
  for (const r of srcMovLog) {
    await db.insert(movimentacoesLog).values({
      id: uuidv7(),
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      produtoId: r.produto_id ? prodIdMap.get(Number(r.produto_id)) ?? null : null,
      enderecoOrigem: r.endereco_origem ? String(r.endereco_origem) : null,
      enderecoDestino: r.endereco_destino ? String(r.endereco_destino) : null,
      lote: r.lote ? String(r.lote) : null,
      qtdCaixas: nullableNumStr(r.qtd_caixas, 2),
      qtdKg: nullableNumStr(r.qtd_kg, 3),
      dataHora: asTimestamp(r.data_hora) ?? new Date(),
      operadorId: r.operador_id ? opIdMap.get(Number(r.operador_id)) ?? null : null,
      operadorNome: r.operador_nome ? String(r.operador_nome) : null,
      tipo: String(r.tipo || 'AJUSTE'),
      numPedido: r.num_pedido ? String(r.num_pedido) : null,
      cliente: r.cliente ? String(r.cliente) : null,
    })
  }
  for (const r of srcCiclos) {
    const id = uuidv7()
    cicloIdMap.set(Number(r.id), id)
    await db.insert(inventarioCiclos).values({
      id,
      tenantId,
      legacyId: Number(r.id),
      nome: String(r.nome),
      status: String(r.status || 'Ativo'),
      targetPct: numStr(r.target_pct, '99.90', 2),
      dataCriacao: asTimestamp(r.data_criacao) ?? new Date(),
      dataEncerramento: asTimestamp(r.data_encerramento),
    })
  }
  for (const r of srcInvs) {
    const id = uuidv7()
    invIdMap.set(Number(r.id), id)
    await db.insert(inventarios).values({
      id,
      tenantId,
      filialId: filialPadraoId,
      legacyId: Number(r.id),
      tipoFiltro: r.tipo_filtro ? String(r.tipo_filtro) : null,
      identificadorFiltro: r.identificador_filtro ? String(r.identificador_filtro) : null,
      nome: r.nome ? String(r.nome) : null,
      tipo: String(r.tipo || 'Ciclico'),
      cicloId: r.ciclo_id ? cicloIdMap.get(Number(r.ciclo_id)) ?? null : null,
      status: String(r.status || 'Aberto'),
      dataCriacao: asTimestamp(r.data_criacao) ?? new Date(),
      dataFinalizacao: asTimestamp(r.data_finalizacao),
    })
  }
  for (const r of srcZonas) {
    const inventarioId = invIdMap.get(Number(r.inventario_id))
    if (!inventarioId) continue
    await db.insert(inventarioZonas).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      inventarioId,
      nomeZona: String(r.nome_zona),
      status: String(r.status || 'Aberto'),
    })
  }
  for (const r of srcInvItens) {
    const inventarioId = invIdMap.get(Number(r.inventario_id))
    const produtoId = prodIdMap.get(Number(r.produto_id))
    if (!inventarioId || !produtoId) continue
    const id = uuidv7()
    invItemIdMap.set(Number(r.id), id)
    await db.insert(inventarioItens).values({
      id,
      tenantId,
      legacyId: Number(r.id),
      inventarioId,
      endereco: String(r.endereco),
      produtoId,
      lote: String(r.lote || ''),
      validade: asIsoDate(r.validade),
      eanCaixa: r.ean_caixa ? String(r.ean_caixa) : null,
      qtdSistemaCaixas: nullableNumStr(r.qtd_sistema_caixas, 2),
      qtdSistemaKg: nullableNumStr(r.qtd_sistema_kg, 3),
      qtdContadaCaixas: nullableNumStr(r.qtd_contada_caixas, 2),
      qtdContadaKg: nullableNumStr(r.qtd_contada_kg, 3),
      contagemAtual: Number(r.contagem_atual ?? 1),
      qtd1Caixas: nullableNumStr(r.qtd_1_caixas, 2),
      qtd1Kg: nullableNumStr(r.qtd_1_kg, 3),
      qtd2Caixas: nullableNumStr(r.qtd_2_caixas, 2),
      qtd2Kg: nullableNumStr(r.qtd_2_kg, 3),
      qtd3Caixas: nullableNumStr(r.qtd_3_caixas, 2),
      qtd3Kg: nullableNumStr(r.qtd_3_kg, 3),
      validadeContada: asIsoDate(r.validade_contada),
      pesoBrutoContadoKg: nullableNumStr(r.peso_bruto_contado_kg, 3),
      taraId: r.tara_id ? taraIdMap.get(Number(r.tara_id)) ?? null : null,
      taraKg: numStr(r.tara_kg, '0', 3),
      dataProducaoContada: asIsoDate(r.data_producao_contada),
      qtdPecasContada: r.qtd_pecas_contada !== null && r.qtd_pecas_contada !== undefined ? Number(r.qtd_pecas_contada) : null,
      statusItem: String(r.status_item || 'Pendente'),
      dataContagem: asTimestamp(r.data_contagem),
    })
  }
  for (const r of srcInvAjustes) {
    await db.insert(inventarioAjustesLog).values({
      id: uuidv7(),
      tenantId,
      legacyId: Number(r.id),
      inventarioId: r.inventario_id ? invIdMap.get(Number(r.inventario_id)) ?? null : null,
      cicloId: r.ciclo_id ? cicloIdMap.get(Number(r.ciclo_id)) ?? null : null,
      itemId: r.item_id ? invItemIdMap.get(Number(r.item_id)) ?? null : null,
      produtoId: r.produto_id ? prodIdMap.get(Number(r.produto_id)) ?? null : null,
      endereco: r.endereco ? String(r.endereco) : null,
      lote: r.lote ? String(r.lote) : null,
      custoUnitarioData: numStr(r.custo_unitario_data, '0', 4),
      qtdAjustadaCaixas: numStr(r.qtd_ajustada_caixas, '0', 2),
      qtdAjustadaKg: numStr(r.qtd_ajustada_kg, '0', 3),
      tipoAjuste: r.tipo_ajuste ? String(r.tipo_ajuste) : null,
      usuarioContouId: r.usuario_contou_id ? opIdMap.get(Number(r.usuario_contou_id)) ?? null : null,
      usuarioAprovouId: r.usuario_aprovou_id ? opIdMap.get(Number(r.usuario_aprovou_id)) ?? null : null,
      usuarioAprovouNome: r.usuario_aprovou_nome ? String(r.usuario_aprovou_nome) : null,
      dataAjuste: asTimestamp(r.data_ajuste) ?? new Date(),
    })
  }
  for (const r of srcAuditoria) {
    await db.insert(auditoriaAcessos).values({
      id: uuidv7(),
      tenantId,
      targetUserId: r.target_user_id ? opIdMap.get(Number(r.target_user_id)) ?? null : null,
      targetUserNome: String(r.target_user_nome || ''),
      acao: String(r.acao || ''),
      detalhesAntes: r.detalhes_antes ? parseJsonSafe(r.detalhes_antes) : null,
      detalhesDepois: r.detalhes_depois ? parseJsonSafe(r.detalhes_depois) : null,
      executorId: r.executor_id ? opIdMap.get(Number(r.executor_id)) ?? null : null,
      executorNome: String(r.executor_nome || 'Sistema'),
      createdAt: asTimestamp(r.created_at) ?? new Date(),
    })
  }

  // 14. Auditoria Matematica Obrigatoria (Turso vs PostgreSQL)
  const srcDispRes = await turso.execute(
    `SELECT COUNT(*) AS n, COALESCE(ROUND(SUM(peso_kg), 3), 0) AS kg FROM estoque_caixas WHERE status = 'DISPONIVEL'`
  )
  const tgtDispRows = await conn.queryRaw<{ n: string; kg: string }>(
    `SELECT COUNT(*)::text AS n, COALESCE(ROUND(SUM(peso_kg), 3), 0)::text AS kg FROM estoque_caixas WHERE tenant_id = $1 AND status = 'DISPONIVEL'`,
    [tenantId]
  )

  const srcDispCount = Number(srcDispRes.rows[0]?.n || 0)
  const tgtDispCount = Number(tgtDispRows[0]?.n || 0)
  const srcDispKg = Number(srcDispRes.rows[0]?.kg || 0).toFixed(3)
  const tgtDispKg = Number(tgtDispRows[0]?.kg || 0).toFixed(3)

  const tablePairs: Array<[string, unknown[], string]> = [
    ['produtos', srcProdutos, 'produtos'],
    ['clientes', srcClientes, 'clientes'],
    ['ordens_producao', srcOps, 'ordens_producao'],
    ['pedidos', srcPedidos, 'pedidos'],
    ['romaneios', srcRomaneios, 'romaneios'],
    ['estoque_caixas', srcCaixas, 'estoque_caixas'],
  ]
  const counts: Record<string, { source: number; target: number }> = {}
  for (const [label, srcArr, pgTable] of tablePairs) {
    const r = await conn.queryRaw<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM "${pgTable}" WHERE tenant_id = $1`,
      [tenantId]
    )
    const targetCount = Number(r[0]?.n || 0)
    counts[label] = { source: srcArr.length, target: targetCount }
    if (targetCount !== srcArr.length) {
      throw new Error(
        `Divergencia na migracao da tabela ${label}: origem=${srcArr.length}, destino=${targetCount}`
      )
    }
  }

  if (srcDispCount !== tgtDispCount || srcDispKg !== tgtDispKg) {
    throw new Error(
      `Divergencia matematica de estoque DISPONIVEL: origem=${srcDispCount} cx / ${srcDispKg} kg vs destino=${tgtDispCount} cx / ${tgtDispKg} kg`
    )
  }

  return {
    tenantId,
    empresaId,
    filialPadraoId,
    counts,
    estoqueDisponivel: {
      sourceCount: srcDispCount,
      targetCount: tgtDispCount,
      sourceKg: srcDispKg,
      targetKg: tgtDispKg,
    },
  }
}

async function main() {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error('Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no ambiente antes de migrar.')
  }
  const turso = createClient({
    url: env.TURSO_DATABASE_URL.replace(/^libsql:\/\//i, 'https://'),
    authToken: env.TURSO_AUTH_TOKEN,
  })
  const conn = await createDbConnection()
  try {
    const report = await migrateTursoToPostgres(turso, conn)
    console.log('[MIGRACAO] Concluida com auditoria matematica 100% aprovada:')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await conn.close()
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrateFromTurso.ts')) {
  main().catch((err) => {
    console.error('[MIGRACAO] Falhou:', err)
    process.exit(1)
  })
}
