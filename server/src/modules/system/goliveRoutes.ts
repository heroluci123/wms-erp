import type { FastifyInstance } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import type { DbConnection } from '../../db/client.js'
import type { AppEnv } from '../../config/env.js'
import {
  camarasTemperaturaLog,
  clientes,
  empresas,
  estoqueCaixas,
  filiais,
  financeiroContasBancarias,
  formasPagamento,
  fornecedores,
  locais,
  operadores,
  ordensProducao,
  pedidos,
  produtoEspecificacoes,
  produtos,
  tabelasPreco,
  taras,
} from '../../db/schema/index.js'
import { createAuthMiddleware } from '../../middlewares/auth.js'

const PERM_GOLIVE = [
  'dashboard_executivo',
  'operadores',
  'empresas_filiais',
  'parametros_comerciais',
  'produtos',
  'relatorios_estoque',
]

export function registerGoliveRoutes(app: FastifyInstance, conn: DbConnection, cfg: AppEnv) {
  const { requirePermission } = createAuthMiddleware(app, conn)

  app.get(
    '/api/system/golive-status',
    { preHandler: requirePermission(PERM_GOLIVE, { write: false, bloquearCliente: true }) },
    async (req) => {
      const ctx = req.authCtx!
      const corte24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

      const countOf = async (query: Promise<Array<{ qtd: number | string }>>) => {
        const rows = await query
        return Number(rows[0]?.qtd || 0)
      }

      const [
        qtdEmpresas,
        qtdFiliais,
        qtdOperadores,
        qtdOperadoresSenhaPadrao,
        qtdTaras,
        qtdLocais,
        qtdProdutos,
        qtdEspecificacoes,
        qtdTabelasPreco,
        qtdClientes,
        qtdFornecedores,
        qtdFormasPagto,
        qtdContasBancarias,
        qtdCaixasEstoque,
        qtdOpsAbertas,
        qtdPedidosAbertos,
        qtdRondas24h,
      ] = await Promise.all([
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(empresas)
            .where(and(eq(empresas.tenantId, ctx.tenantId), eq(empresas.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(filiais)
            .where(and(eq(filiais.tenantId, ctx.tenantId), eq(filiais.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(operadores)
            .where(and(eq(operadores.tenantId, ctx.tenantId), eq(operadores.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(operadores)
            .where(
              and(
                eq(operadores.tenantId, ctx.tenantId),
                eq(operadores.ativo, 1),
                eq(operadores.deveTrocarSenha, 1),
              ),
            ),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(taras)
            .where(and(eq(taras.tenantId, ctx.tenantId), eq(taras.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(locais)
            .where(and(eq(locais.tenantId, ctx.tenantId), eq(locais.filialId, ctx.filialId))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(produtos)
            .where(
              and(
                eq(produtos.tenantId, ctx.tenantId),
                eq(produtos.ativo, 1),
                sql`UPPER(COALESCE(${produtos.codigo}, '')) <> 'VAZIO'`,
              ),
            ),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(produtoEspecificacoes)
            .where(and(eq(produtoEspecificacoes.tenantId, ctx.tenantId), eq(produtoEspecificacoes.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(tabelasPreco)
            .where(and(eq(tabelasPreco.tenantId, ctx.tenantId), eq(tabelasPreco.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(clientes)
            .where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(fornecedores)
            .where(and(eq(fornecedores.tenantId, ctx.tenantId), eq(fornecedores.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(formasPagamento)
            .where(and(eq(formasPagamento.tenantId, ctx.tenantId), eq(formasPagamento.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(financeiroContasBancarias)
            .where(and(eq(financeiroContasBancarias.tenantId, ctx.tenantId), eq(financeiroContasBancarias.ativo, 1))),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(estoqueCaixas)
            .where(
              and(
                eq(estoqueCaixas.tenantId, ctx.tenantId),
                eq(estoqueCaixas.filialId, ctx.filialId),
                sql`${estoqueCaixas.status} IN ('DISPONIVEL', 'RESERVADA', 'ABERTA_ACOUGUE')`,
              ),
            ),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(ordensProducao)
            .where(
              and(
                eq(ordensProducao.tenantId, ctx.tenantId),
                sql`${ordensProducao.status} NOT IN ('CONCLUIDA', 'CANCELADA')`,
              ),
            ),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(pedidos)
            .where(
              and(
                eq(pedidos.tenantId, ctx.tenantId),
                sql`${pedidos.status} NOT IN ('EXPEDIDO', 'CANCELADO')`,
              ),
            ),
        ),
        countOf(
          conn.db
            .select({ qtd: sql<number>`COUNT(*)::int` })
            .from(camarasTemperaturaLog)
            .where(
              and(
                eq(camarasTemperaturaLog.tenantId, ctx.tenantId),
                eq(camarasTemperaturaLog.filialId, ctx.filialId),
                sql`${camarasTemperaturaLog.createdAt} >= ${corte24h}::timestamptz`,
              ),
            ),
        ),
      ])

      const isPgProducao = conn.driver === 'pg'
      const jwtSeguro = !cfg.JWT_SECRET.includes('dev-secret') && cfg.JWT_SECRET.length >= 32
      const corsOrigens = cfg.CORS_ORIGIN.split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
      const temCorsExterno = corsOrigens.some((o) => !/localhost|127\.0\.0\.1/i.test(o))

      const checks = [
        {
          id: 'banco_pg',
          categoria: 'INFRA',
          titulo: 'Banco PostgreSQL Gerenciado (Neon / Supabase)',
          status: isPgProducao ? 'OK' : 'ALERTA',
          detalhe: isPgProducao
            ? 'Conectado via PostgreSQL real (driver pg + SSL).'
            : 'Rodando em PGlite local. Para produção na nuvem, configure PG_DRIVER=pg e DATABASE_URL.',
          rota: null,
        },
        {
          id: 'jwt_seguro',
          categoria: 'INFRA',
          titulo: 'Chave JWT de Produção (>= 32 caracteres)',
          status: jwtSeguro ? 'OK' : 'ALERTA',
          detalhe: jwtSeguro
            ? 'JWT_SECRET forte configurado.'
            : 'Usando segredo de desenvolvimento. Gere um JWT_SECRET aleatório forte em produção.',
          rota: null,
        },
        {
          id: 'cors_producao',
          categoria: 'INFRA',
          titulo: 'CORS liberado para o domínio Vercel',
          status: temCorsExterno ? 'OK' : 'ALERTA',
          detalhe: temCorsExterno
            ? `Origens liberadas: ${corsOrigens.join(', ')}`
            : `Somente localhost configurado (${corsOrigens.join(', ')}). Adicione https://wms-erp-cow3.vercel.app em CORS_ORIGIN.`,
          rota: null,
        },
        {
          id: 'empresas_filiais',
          categoria: 'CADASTROS',
          titulo: 'Empresas & Filiais (CNPJ / SIF / DIPOA)',
          status: qtdEmpresas > 0 && qtdFiliais > 0 ? 'OK' : 'PENDENTE',
          detalhe: `${qtdEmpresas} empresa(s) e ${qtdFiliais} filial(is) ativa(s).`,
          rota: '/filiais',
        },
        {
          id: 'taras',
          categoria: 'CADASTROS',
          titulo: 'Taras de Caixas & Embalagens',
          status: qtdTaras > 0 ? 'OK' : 'PENDENTE',
          detalhe: `${qtdTaras} tara(s) cadastrada(s).`,
          rota: '/taras',
        },
        {
          id: 'locais',
          categoria: 'CADASTROS',
          titulo: 'Locais / Câmaras Frias & Endereços',
          status: qtdLocais > 0 ? 'OK' : 'PENDENTE',
          detalhe: `${qtdLocais} endereço(s) ativo(s) nesta filial.`,
          rota: '/locais',
        },
        {
          id: 'produtos',
          categoria: 'CADASTROS',
          titulo: 'Catálogo de Produtos & Especificações de Rótulo',
          status: qtdProdutos > 0 ? 'OK' : 'PENDENTE',
          detalhe: `${qtdProdutos} produto(s) ativo(s) • ${qtdEspecificacoes} especificação(ões) de rótulo.`,
          rota: '/produtos',
        },
        {
          id: 'tabelas_preco',
          categoria: 'COMERCIAL',
          titulo: 'Tabelas de Preço (Atacado & Varejo)',
          status: qtdTabelasPreco > 0 ? 'OK' : 'PENDENTE',
          detalhe: `${qtdTabelasPreco} tabela(s) de preço ativa(s).`,
          rota: '/tabelas-preco',
        },
        {
          id: 'clientes_fornecedores',
          categoria: 'COMERCIAL',
          titulo: 'Clientes & Fornecedores (SIF)',
          status: qtdClientes > 0 && qtdFornecedores > 0 ? 'OK' : 'ALERTA',
          detalhe: `${qtdClientes} cliente(s) • ${qtdFornecedores} fornecedor(es) cadastrado(s).`,
          rota: '/clientes',
        },
        {
          id: 'financeiro_base',
          categoria: 'FINANCEIRO',
          titulo: 'Contas Bancárias & Formas de Pagamento',
          status: qtdContasBancarias > 0 && qtdFormasPagto > 0 ? 'OK' : 'PENDENTE',
          detalhe: `${qtdContasBancarias} conta(s) bancária(s) • ${qtdFormasPagto} forma(s) de pagamento.`,
          rota: '/parametros-comerciais',
        },
        {
          id: 'equipe_seguranca',
          categoria: 'SEGURANCA',
          titulo: 'Operadores, Perfis & Senhas Pessoais',
          status: qtdOperadores >= 2 && qtdOperadoresSenhaPadrao === 0 ? 'OK' : 'ALERTA',
          detalhe:
            qtdOperadoresSenhaPadrao > 0
              ? `${qtdOperadores} usuário(s) ativo(s), mas ${qtdOperadoresSenhaPadrao} ainda com troca de senha pendente.`
              : `${qtdOperadores} usuário(s) ativo(s). Cadastre perfis separados (separação, faturamento, motorista, PDV).`,
          rota: '/operadores',
        },
      ]

      const totalChecks = checks.length
      const checksOk = checks.filter((c) => c.status === 'OK').length
      const scorePct = Math.round((checksOk / totalChecks) * 100)

      return {
        success: true,
        ambiente: {
          node_env: cfg.NODE_ENV,
          driver: conn.driver,
          uptime_sec: Math.floor(process.uptime()),
          cors_origens: corsOrigens,
          jwt_seguro: jwtSeguro,
        },
        score_prontidao_pct: scorePct,
        resumo_checks: {
          total: totalChecks,
          ok: checksOk,
          alertas: checks.filter((c) => c.status === 'ALERTA').length,
          pendentes: checks.filter((c) => c.status === 'PENDENTE').length,
        },
        pulso_operacional: {
          caixas_em_estoque: qtdCaixasEstoque,
          ops_abertas: qtdOpsAbertas,
          pedidos_abertos: qtdPedidosAbertos,
          rondas_temperatura_24h: qtdRondas24h,
        },
        checks,
      }
    },
  )
}
