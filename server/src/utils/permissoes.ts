export const TODAS_CHAVES_PERMISSAO = [
  'retorno_producao',
  'producao_entrada',
  'producao_saida',
  'producao_criar_op',
  'mapa_producao',
  'desmembramento',
  'reimpressao',
  'movimentacao',
  'movimentacao_consultar',
  'recebimento',
  'recebimento_consultar',
  'compras',
  'inventario_coletor',
  'inventario_divergencias',
  'inventario_gestao',
  'inventario_carga_inicial',
  'pedidos_consultar',
  'saida',
  'expedicao',
  'devolucao',
  'devolucao_fiscal',
  'roteirizacao',
  'roteirizacao_carregamento',
  'pedidos',
  'financeiro_pedidos',
  'whatsapp_inbox',
  'estoque_enderecos',
  'consulta_estoque',
  'rastreabilidade',
  'consulta_endereco',
  'movimentacao_historico',
  'ean_etiquetas',
  'relatorios_producao',
  'relatorios_estoque',
  'dashboard_executivo',
  'produtos',
  'taras',
  'locais',
  'clientes',
  'fornecedores',
  'vendedores',
  'transportadoras',
  'empresas_filiais',
  'parametros_comerciais',
  'operadores',
  'perfis_gerenciar',
  'redefinir_senhas',
  'alterar_propria_senha',
  'configurar_sistema',
  'deletar_historico',
] as const

export type ChavePermissao = (typeof TODAS_CHAVES_PERMISSAO)[number]
export type MapaPermissoes = Record<string, boolean>

export const CHAVES_PROIBIDAS_CLIENTE = new Set<string>([
  'retorno_producao',
  'producao_entrada',
  'producao_saida',
  'producao_criar_op',
  'mapa_producao',
  'desmembramento',
  'reimpressao',
  'movimentacao',
  'movimentacao_consultar',
  'movimentacao_historico',
  'recebimento',
  'recebimento_consultar',
  'compras',
  'inventario_coletor',
  'inventario_divergencias',
  'inventario_gestao',
  'inventario_carga_inicial',
  'pedidos',
  'pedidos_consultar',
  'financeiro_pedidos',
  'whatsapp_inbox',
  'saida',
  'expedicao',
  'devolucao',
  'devolucao_fiscal',
  'roteirizacao',
  'roteirizacao_carregamento',
  'ean_etiquetas',
  'dashboard_executivo',
  'produtos',
  'taras',
  'locais',
  'clientes',
  'fornecedores',
  'vendedores',
  'transportadoras',
  'empresas_filiais',
  'parametros_comerciais',
  'operadores',
  'perfis_gerenciar',
  'redefinir_senhas',
  'configurar_sistema',
  'deletar_historico',
])

export const PERMISSOES_PADRAO_CLIENTE: MapaPermissoes = {
  relatorios_producao: true,
  relatorios_estoque: true,
  consulta_estoque: true,
  estoque_enderecos: true,
  alterar_propria_senha: true,
}

export const PERMISSOES_PADRAO_OPERADOR: MapaPermissoes = {
  retorno_producao: true,
  producao_entrada: true,
  producao_saida: true,
  desmembramento: true,
  reimpressao: true,
  movimentacao: true,
  movimentacao_consultar: true,
  recebimento: true,
  recebimento_consultar: true,
  inventario_coletor: true,
  inventario_divergencias: true,
  pedidos_consultar: true,
  saida: true,
  expedicao: true,
  devolucao: true,
  roteirizacao_carregamento: true,
  estoque_enderecos: true,
  consulta_estoque: true,
  rastreabilidade: true,
  consulta_endereco: true,
  movimentacao_historico: true,
  ean_etiquetas: true,
  alterar_propria_senha: true,
}

export const PERMISSOES_PADRAO_ADMINISTRADOR: MapaPermissoes = (() => {
  const base: MapaPermissoes = {}
  for (const k of TODAS_CHAVES_PERMISSAO) {
    if (k !== 'configurar_sistema') base[k] = true
  }
  return base
})()

export const PERMISSOES_MASTER_COMPLETAS: MapaPermissoes = (() => {
  const base: MapaPermissoes = {}
  for (const k of TODAS_CHAVES_PERMISSAO) {
    base[k] = true
  }
  return base
})()

export const PERFIS_SISTEMA_BASE = [
  {
    codigo: 'OPERADOR',
    nome: 'OPERADOR',
    nivel: 'OPERACIONAL',
    setor_padrao: 'Produção',
    descricao:
      'Operação diária: recebimento, inventário coletor, entrada/saída de produção, movimentações, separação de pedidos e consultas.',
    permissoes: PERMISSOES_PADRAO_OPERADOR,
    sistema_fixo: 1,
  },
  {
    codigo: 'CLIENTE',
    nome: 'CLIENTE',
    nivel: 'CLIENTE',
    setor_padrao: 'CLIENTE',
    descricao:
      'Portal de consulta isolado da operação: relatórios consolidados de produção, rendimento e saldo de estoque.',
    permissoes: PERMISSOES_PADRAO_CLIENTE,
    sistema_fixo: 1,
  },
  {
    codigo: 'ADMINISTRADOR',
    nome: 'ADMINISTRADOR',
    nivel: 'ADMINISTRADOR',
    setor_padrao: 'Administrativo',
    descricao:
      'Gestão operacional e cadastros: gerencia usuários comuns, cria OPs/pedidos e acessa relatórios completos.',
    permissoes: PERMISSOES_PADRAO_ADMINISTRADOR,
    sistema_fixo: 1,
  },
  {
    codigo: 'MASTER',
    nome: 'MASTER',
    nivel: 'MASTER',
    setor_padrao: 'Diretoria / Master',
    descricao: 'Controle irrestrito total do sistema, usuários, perfis e configurações.',
    permissoes: PERMISSOES_MASTER_COMPLETAS,
    sistema_fixo: 1,
  },
]

export interface OperadorAuthContext {
  id: string
  tenantId: string
  empresaId: string
  filialId: string
  nome: string
  login: string
  perfil: string
  nivel: string
  setor: string
  is_adm: number
  ativo: number
  deve_trocar_senha: number
  permissoes: MapaPermissoes
}

export function criarMapaPermissoesVazio(): MapaPermissoes {
  const mapa: MapaPermissoes = {}
  for (const k of TODAS_CHAVES_PERMISSAO) mapa[k] = false
  return mapa
}

export function isMaster(op?: { nivel?: string | null; perfil?: string | null } | null): boolean {
  if (!op) return false
  const nivel = String(op.nivel || '').toUpperCase()
  const perfil = String(op.perfil || '').toUpperCase()
  return nivel === 'MASTER' || perfil === 'MASTER'
}

export function isCliente(op?: { nivel?: string | null; perfil?: string | null } | null): boolean {
  if (!op || isMaster(op)) return false
  const nivel = String(op.nivel || '').toUpperCase()
  const perfil = String(op.perfil || '').toUpperCase()
  return nivel === 'CLIENTE' || perfil === 'CLIENTE'
}

export function isAdministradorOuSuperior(
  op?: { nivel?: string | null; perfil?: string | null; is_adm?: number | null } | null
): boolean {
  if (!op) return false
  if (isMaster(op)) return true
  const nivel = String(op.nivel || '').toUpperCase()
  const perfil = String(op.perfil || '').toUpperCase()
  return Number(op.is_adm) === 1 || nivel === 'ADMINISTRADOR' || perfil === 'GESTOR' || perfil === 'ADMINISTRADOR'
}

export function sanitizarPermissoes(
  rawPermissoes: unknown = {},
  nivel = 'OPERACIONAL',
  perfil = 'OPERADOR'
): MapaPermissoes {
  const nivelUp = String(nivel || '').toUpperCase()
  const perfilUp = String(perfil || '').toUpperCase()
  if (nivelUp === 'MASTER' || perfilUp === 'MASTER') {
    return { ...PERMISSOES_MASTER_COMPLETAS }
  }

  let obj: Record<string, unknown> = {}
  if (typeof rawPermissoes === 'string') {
    try {
      obj = JSON.parse(rawPermissoes) as Record<string, unknown>
    } catch {
      obj = {}
    }
  } else if (rawPermissoes && typeof rawPermissoes === 'object') {
    obj = rawPermissoes as Record<string, unknown>
  }

  const mapa = criarMapaPermissoesVazio()
  for (const k of TODAS_CHAVES_PERMISSAO) {
    mapa[k] = Boolean(obj?.[k])
  }

  if (obj?.retorno_producao && obj?.producao_entrada === undefined) {
    mapa.producao_entrada = true
    mapa.producao_saida = true
  }
  if (obj?.movimentacao && obj?.movimentacao_consultar === undefined) {
    mapa.movimentacao_consultar = true
  }
  if (obj?.recebimento && obj?.recebimento_consultar === undefined) {
    mapa.recebimento_consultar = true
  }
  if (obj?.inventario_coletor && obj?.inventario_divergencias === undefined) {
    mapa.inventario_divergencias = true
  }
  if ((obj?.pedidos || obj?.saida) && obj?.pedidos_consultar === undefined) {
    mapa.pedidos_consultar = true
  }
  if (obj?.produtos && obj?.relatorios_estoque === undefined) {
    mapa.relatorios_producao = true
    mapa.relatorios_estoque = true
  }
  if (obj?.pedidos && obj?.clientes === undefined) {
    mapa.clientes = true
  }
  if ((obj?.pedidos || obj?.financeiro_pedidos) && obj?.whatsapp_inbox === undefined) {
    mapa.whatsapp_inbox = true
  }
  if ((obj?.fornecedores || obj?.pedidos) && obj?.compras === undefined) {
    mapa.compras = true
  }
  if ((obj?.producao_criar_op || obj?.pedidos) && obj?.mapa_producao === undefined) {
    mapa.mapa_producao = true
  }
  if ((obj?.saida || obj?.expedicao || obj?.recebimento) && obj?.devolucao === undefined) {
    mapa.devolucao = true
  }
  if ((obj?.pedidos || obj?.financeiro_pedidos) && obj?.devolucao_fiscal === undefined) {
    mapa.devolucao_fiscal = true
  }
  if ((obj?.pedidos || obj?.transportadoras) && obj?.roteirizacao === undefined) {
    mapa.roteirizacao = true
  }
  if ((obj?.saida || obj?.expedicao) && obj?.roteirizacao_carregamento === undefined) {
    mapa.roteirizacao_carregamento = true
  }
  if (nivelUp === 'ADMINISTRADOR' || perfilUp === 'ADMINISTRADOR') {
    for (const k of ['clientes', 'fornecedores', 'vendedores', 'transportadoras', 'empresas_filiais', 'parametros_comerciais', 'financeiro_pedidos', 'whatsapp_inbox', 'compras', 'mapa_producao', 'devolucao_fiscal', 'roteirizacao', 'roteirizacao_carregamento'] as const) {
      if (obj?.[k] === undefined) mapa[k] = true
    }
  }

  if (nivelUp === 'CLIENTE' || perfilUp === 'CLIENTE') {
    for (const blocked of CHAVES_PROIBIDAS_CLIENTE) {
      mapa[blocked] = false
    }
  }

  return mapa
}

export function temPermissao(op: OperadorAuthContext | null | undefined, chave: string): boolean {
  if (!op || Number(op.ativo ?? 1) !== 1) return false
  if (isMaster(op)) return true
  if (isCliente(op) && CHAVES_PROIBIDAS_CLIENTE.has(chave)) return false

  const p = op.permissoes || {}
  if (p[chave] === true) return true

  switch (chave) {
    case 'producao_entrada':
    case 'producao_saida':
      return Boolean(p.retorno_producao) || (Boolean(p.movimentacao) && p[chave] !== false)
    case 'producao_criar_op':
      return isAdministradorOuSuperior(op)
    case 'movimentacao_consultar':
    case 'movimentacao_historico':
      return Boolean(p.movimentacao)
    case 'recebimento_consultar':
      return Boolean(p.recebimento)
    case 'inventario_divergencias':
      return Boolean(p.inventario_coletor || p.inventario_gestao)
    case 'pedidos_consultar':
      return Boolean(p.pedidos || p.saida || p.expedicao) || isAdministradorOuSuperior(op)
    case 'devolucao':
      return p.devolucao !== false && (Boolean(p.saida || p.expedicao || p.recebimento) || isAdministradorOuSuperior(op))
    case 'devolucao_fiscal':
      return Boolean(p.pedidos || p.financeiro_pedidos) || isAdministradorOuSuperior(op)
    case 'roteirizacao':
      return Boolean(p.pedidos || p.transportadoras) || isAdministradorOuSuperior(op)
    case 'roteirizacao_carregamento':
      return (
        p.roteirizacao_carregamento !== false &&
        (Boolean(p.saida || p.expedicao || p.roteirizacao) || isAdministradorOuSuperior(op))
      )
    case 'relatorios_producao':
    case 'relatorios_estoque':
      return Boolean(p.produtos || p.dashboard_executivo || p[chave])
    case 'reimpressao':
      return (
        p.reimpressao !== false &&
        Boolean(p.recebimento || p.desmembramento || p.retorno_producao || p.produtos)
      )
    case 'taras':
      return Boolean(p.produtos) || isAdministradorOuSuperior(op)
    case 'alterar_propria_senha':
      return p.alterar_propria_senha !== false
    default:
      return false
  }
}

export function temAlgumaPermissao(op: OperadorAuthContext | null | undefined, chaves: string[] = []): boolean {
  if (!op) return false
  if (isMaster(op)) return true
  return chaves.some((k) => temPermissao(op, k))
}
