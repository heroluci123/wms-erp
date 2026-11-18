import { and, eq, ne, sql } from 'drizzle-orm'
import {
  clientes,
  fornecedores,
  produtos,
  transportadoras,
  vendedores,
} from '../../db/schema/index.js'
import { HttpError } from '../../middlewares/auth.js'
import type { DbOrTx } from '../wms/helpers.js'

export type CadastroTipoCodigo = 'produto' | 'cliente' | 'fornecedor' | 'transportadora' | 'vendedor'

interface CodigoTabelaSpec {
  table: any
  idCol: any
  tenantCol: any
  codigoCol: any
  ativoCol: any
  artigo: 'o' | 'a'
  rotulo: string
}

const SPECS: Record<CadastroTipoCodigo, CodigoTabelaSpec> = {
  produto: {
    table: produtos,
    idCol: produtos.id,
    tenantCol: produtos.tenantId,
    codigoCol: produtos.codigo,
    ativoCol: produtos.ativo,
    artigo: 'o',
    rotulo: 'produto/item',
  },
  cliente: {
    table: clientes,
    idCol: clientes.id,
    tenantCol: clientes.tenantId,
    codigoCol: clientes.codigo,
    ativoCol: clientes.ativo,
    artigo: 'o',
    rotulo: 'cliente',
  },
  fornecedor: {
    table: fornecedores,
    idCol: fornecedores.id,
    tenantCol: fornecedores.tenantId,
    codigoCol: fornecedores.codigo,
    ativoCol: fornecedores.ativo,
    artigo: 'o',
    rotulo: 'fornecedor',
  },
  transportadora: {
    table: transportadoras,
    idCol: transportadoras.id,
    tenantCol: transportadoras.tenantId,
    codigoCol: transportadoras.codigo,
    ativoCol: transportadoras.ativo,
    artigo: 'a',
    rotulo: 'transportadora',
  },
  vendedor: {
    table: vendedores,
    idCol: vendedores.id,
    tenantCol: vendedores.tenantId,
    codigoCol: vendedores.codigo,
    ativoCol: vendedores.ativo,
    artigo: 'o',
    rotulo: 'vendedor',
  },
}

const ALIAS_MAP: Record<string, CadastroTipoCodigo> = {
  produto: 'produto',
  produtos: 'produto',
  item: 'produto',
  itens: 'produto',
  cliente: 'cliente',
  clientes: 'cliente',
  fornecedor: 'fornecedor',
  fornecedores: 'fornecedor',
  transportadora: 'transportadora',
  transportadoras: 'transportadora',
  vendedor: 'vendedor',
  vendedores: 'vendedor',
}

export function normalizarTipoCadastroCodigo(rawTipo: unknown): CadastroTipoCodigo {
  const key = String(rawTipo || '').trim().toLowerCase()
  const tipo = ALIAS_MAP[key]
  if (!tipo) {
    throw new HttpError(400, `Tipo de cadastro inválido para geração de código: "${key}".`)
  }
  return tipo
}

/**
 * Gera o próximo código sequencial numérico disponível para o cadastro dentro do tenant
 * considerando registros ativos e inativos para evitar colisão de chave única.
 */
export async function gerarProximoCodigoCadastro(
  dbOrTx: DbOrTx,
  tenantId: string,
  tipo: CadastroTipoCodigo,
): Promise<string> {
  const spec = SPECS[tipo]
  const rows = (await dbOrTx
    .select({ codigo: spec.codigoCol })
    .from(spec.table)
    .where(eq(spec.tenantCol, tenantId))) as Array<{ codigo: string | null }>

  let maxNum = 0
  const usados = new Set<string>()
  for (const r of rows) {
    const raw = String(r.codigo ?? '').trim()
    if (!raw) continue
    usados.add(raw.toLowerCase())
    if (/^\d{1,12}$/.test(raw)) {
      const n = Number(raw)
      if (Number.isSafeInteger(n) && n > maxNum) {
        maxNum = n
      }
    }
  }

  let candidate = maxNum + 1
  while (usados.has(String(candidate))) {
    candidate += 1
  }
  return String(candidate)
}

/**
 * Garante unicidade do código dentro do tenant para o cadastro alvo (inclusive contra inativos).
 */
export async function validarCodigoUnicoCadastro(
  dbOrTx: DbOrTx,
  tenantId: string,
  tipo: CadastroTipoCodigo,
  codigoRaw: string,
  excludeId?: string,
): Promise<string> {
  const codigo = codigoRaw.trim()
  if (!codigo) {
    throw new HttpError(400, 'Informe um código válido.')
  }

  const spec = SPECS[tipo]
  const conds = [
    eq(spec.tenantCol, tenantId),
    sql`LOWER(TRIM(COALESCE(${spec.codigoCol}, ''))) = LOWER(${codigo})`,
  ]
  if (excludeId) {
    conds.push(ne(spec.idCol, excludeId))
  }

  const dup = (await dbOrTx
    .select({ id: spec.idCol, ativo: spec.ativoCol })
    .from(spec.table)
    .where(and(...conds))
    .limit(1)) as Array<{ id: string; ativo: number }>

  if (dup.length > 0) {
    const sufixoInativo = Number(dup[0].ativo) === 0 ? ' (cadastro inativo no histórico)' : ''
    throw new HttpError(
      409,
      `Já existe outr${spec.artigo} ${spec.rotulo} com o código "${codigo}"${sufixoInativo}.`,
    )
  }

  return codigo
}

/**
 * Na criação: usa o código digitado (validando unicidade) ou gera automaticamente se omitido/vazio.
 */
export async function resolverCodigoCadastroOnCreate(
  tx: DbOrTx,
  tenantId: string,
  tipo: CadastroTipoCodigo,
  codigoInformado: string | null | undefined,
): Promise<string> {
  const limpo = codigoInformado ? codigoInformado.trim() : ''
  if (!limpo) {
    return gerarProximoCodigoCadastro(tx, tenantId, tipo)
  }
  return validarCodigoUnicoCadastro(tx, tenantId, tipo, limpo)
}

/**
 * Na edição: exige código não vazio (exceto se omitido em registros sem código) e bloqueia duplicidade.
 */
export async function resolverCodigoCadastroOnUpdate(
  tx: DbOrTx,
  tenantId: string,
  tipo: CadastroTipoCodigo,
  id: string,
  codigoInformado: string | null | undefined,
): Promise<string> {
  const limpo = codigoInformado ? codigoInformado.trim() : ''
  if (!limpo) {
    const spec = SPECS[tipo]
    throw new HttpError(400, `Informe o código d${spec.artigo} ${spec.rotulo}.`)
  }
  return validarCodigoUnicoCadastro(tx, tenantId, tipo, limpo, id)
}
