/**
 * Matriz completa de Permissões por Setor, Perfis Predefinidos e Helpers de Autorização.
 */

export const SETORES_EMPRESA = [
  'Produção',
  'Câmara Fria / Estoque',
  'Recebimento',
  'Expedição / Pedidos',
  'Inventário',
  'Qualidade',
  'Administrativo',
  'Diretoria / Master',
  'CLIENTE',
]

export const SETORES_PERMISSOES = [
  {
    id: 'producao',
    nome: 'Produção & Desmembramento',
    descricao: 'Ordens de produção, entrada de insumos, retorno de produção, etiquetas e desmembramento.',
    permissoes: [
      { key: 'retorno_producao', label: 'Abrir OPs já liberadas', desc: 'Visualizar ordens de produção liberadas para execução.' },
      { key: 'producao_entrada', label: 'Registrar entrada na produção', desc: 'Bipar e alocar caixas de matéria-prima na OP.' },
      { key: 'producao_saida', label: 'Registrar saída da produção', desc: 'Pesar, gerar etiquetas próprias e retornar caixas produzidas.' },
      { key: 'producao_criar_op', label: 'Criar / Configurar / Finalizar OP', desc: 'Abrir novas OPs, editar itens previstos, liberar, finalizar e reabrir.' },
      { key: 'desmembramento', label: 'Desmembramento de caixas', desc: 'Dividir caixas originais em múltiplas etiquetas herdando validade.' },
      { key: 'reimpressao', label: 'Gerar e reimprimir etiquetas (100×70mm)', desc: 'Imprimir e reimprimir etiquetas térmicas preservando EAN original.' },
    ],
  },
  {
    id: 'movimentacao',
    nome: 'Movimentação Interna',
    descricao: 'Transferências entre endereços, montagem de paletes e consultas de movimentação.',
    permissoes: [
      { key: 'movimentacao', label: 'Registrar movimentações e transferências', desc: 'Bipar caixas e movimentar entre endereços ou paletes autorizados.' },
      { key: 'movimentacao_consultar', label: 'Consultar movimentações internas', desc: 'Visualizar histórico e posição de movimentações entre câmaras.' },
    ],
  },
  {
    id: 'recebimento',
    nome: 'Recebimento',
    descricao: 'Entrada de mercadorias, conferência de EAN e pesagem com tara.',
    permissoes: [
      { key: 'recebimento', label: 'Registrar recebimentos e novas caixas', desc: 'Bipar EANs, informar peso bruto, tara, produção e validade.' },
      { key: 'recebimento_consultar', label: 'Consultar recebimentos', desc: 'Acompanhar paletes e registros de entrada no recebimento.' },
    ],
  },
  {
    id: 'inventario',
    nome: 'Inventário',
    descricao: 'Contagens por coletor, conciliação e divergências de estoque.',
    permissoes: [
      { key: 'inventario_coletor', label: 'Inventário modo coletor e contagens', desc: 'Acessar inventário, bipar produtos, registrar contagens e conferências.' },
      { key: 'inventario_divergencias', label: 'Consultar divergências', desc: 'Visualizar diferenças encontradas durante a apuração.' },
      { key: 'inventario_gestao', label: 'Gestão e conciliação de inventários', desc: 'Abrir, encerrar e aplicar conciliações de inventário.' },
      { key: 'inventario_carga_inicial', label: 'Carga inicial de estoque', desc: 'Realizar importação/implantação inicial massiva de caixas.' },
    ],
  },
  {
    id: 'pedidos',
    nome: 'Pedidos & Expedição',
    descricao: 'Gestão de pedidos de venda, separação bipada na câmara e expedição.',
    permissoes: [
      { key: 'pedidos_consultar', label: 'Consultar pedidos e status', desc: 'Visualizar carteira de pedidos, folhas de separação e romaneios.' },
      { key: 'saida', label: 'Bipar e registrar separação de pedidos', desc: 'Separar caixas bipadas na câmara para atender pedidos liberados.' },
      { key: 'expedicao', label: 'Conferência caixa a caixa e expedição', desc: 'Conferir e expedir pedidos com emissão do romaneio de embarque.' },
      { key: 'pedidos', label: 'Criar / Editar / Liberar pedidos', desc: 'Cadastrar novos pedidos, editar quantidades e liberar para câmara.' },
    ],
  },
  {
    id: 'consultas',
    nome: 'Consultas Operacionais & Estoque',
    descricao: 'Saldo de estoque, endereços, lotes, etiquetas e rastreabilidade de caixas.',
    permissoes: [
      { key: 'estoque_enderecos', label: 'Consultar estoque por endereço', desc: 'Ver mapas, câmaras, posições e lotes armazenados.' },
      { key: 'consulta_estoque', label: 'Consultar saldo de estoque e produtos', desc: 'Consultar quantidades totais e disponibilidade por produto.' },
      { key: 'rastreabilidade', label: 'Consultar rastreabilidade de caixas', desc: 'Rastrear timeline completa, origem, lote e desmembramentos.' },
      { key: 'consulta_endereco', label: 'Consultar endereço dos produtos', desc: 'Localizar rapidamente endereços físicos por código ou leitor.' },
      { key: 'movimentacao_historico', label: 'Consultar histórico de movimentações', desc: 'Acompanhar auditoria de movimentos das caixas.' },
      { key: 'ean_etiquetas', label: 'Consultar e editar etiquetas / EANs', desc: 'Acessar e manter mapeamentos no Editor de EAN.' },
    ],
  },
  {
    id: 'relatorios',
    nome: 'Relatórios & Indicadores',
    descricao: 'Relatórios consolidados de produção, rendimento, estoque e painel executivo.',
    permissoes: [
      { key: 'relatorios_producao', label: 'Consultar relatórios de produção', desc: 'Histórico consolidado, pesos de entrada/saída, quantidades e rendimento.' },
      { key: 'relatorios_estoque', label: 'Consultar relatórios de estoque', desc: 'Saldos de estoque, relatórios WMS e exportação Excel/PDF.' },
      { key: 'dashboard_executivo', label: 'Painel executivo em tempo real', desc: 'KPIs operacionais ao vivo e indicadores internos (bloqueado para CLIENTE).' },
    ],
  },
  {
    id: 'administracao',
    nome: 'Cadastros & Administração',
    descricao: 'Cadastros mestres, usuários, perfis, configurações e ações sensíveis.',
    permissoes: [
      { key: 'produtos', label: 'Gerenciar cadastro de produtos', desc: 'Criar, editar produtos e consultar catálogo completo.' },
      { key: 'taras', label: 'Gerenciar cadastro de taras', desc: 'Cadastrar e definir taras padrão das caixas.' },
      { key: 'locais', label: 'Gerenciar cadastro de locais', desc: 'Criar e manter câmaras e endereços do armazém.' },
      { key: 'operadores', label: 'Gerenciar usuários e permissões', desc: 'Cadastrar contas, atribuir perfis, ativar/desativar e auditar.' },
      { key: 'perfis_gerenciar', label: 'Criar e gerenciar perfis de acesso', desc: 'Definir novos modelos predefinidos por setor.' },
      { key: 'redefinir_senhas', label: 'Redefinir senhas de usuários', desc: 'Alterar senhas iniciais e resetar credenciais de outras contas.' },
      { key: 'alterar_propria_senha', label: 'Alterar a própria senha', desc: 'Permite que o próprio usuário atualize sua senha de acesso.' },
      { key: 'configurar_sistema', label: 'Configurar o sistema', desc: 'Acessar configurações globais e parâmetros técnicos.' },
      { key: 'deletar_historico', label: 'Excluir registros e ajustar históricos', desc: 'Permissão crítica para exclusão ou estorno de logs.' },
    ],
  },
]

export const TODAS_CHAVES_PERMISSAO = SETORES_PERMISSOES.flatMap((s) => s.permissoes.map((p) => p.key))

// Permissões que um usuário CLIENTE JAMAIS pode receber (garante isolamento absoluto da operação)
export const CHAVES_PROIBIDAS_CLIENTE = new Set([
  'retorno_producao',
  'producao_entrada',
  'producao_saida',
  'producao_criar_op',
  'desmembramento',
  'reimpressao',
  'movimentacao',
  'movimentacao_consultar',
  'movimentacao_historico',
  'recebimento',
  'recebimento_consultar',
  'inventario_coletor',
  'inventario_divergencias',
  'inventario_gestao',
  'inventario_carga_inicial',
  'pedidos',
  'pedidos_consultar',
  'saida',
  'expedicao',
  'ean_etiquetas',
  'dashboard_executivo',
  'produtos',
  'taras',
  'locais',
  'operadores',
  'perfis_gerenciar',
  'redefinir_senhas',
  'configurar_sistema',
  'deletar_historico',
])

// Permissões permitidas para consulta pelo perfil CLIENTE
export const PERMISSOES_PADRAO_CLIENTE = {
  relatorios_producao: true,
  relatorios_estoque: true,
  consulta_estoque: true,
  estoque_enderecos: true,
  alterar_propria_senha: true,
}

// Permissões marcadas automaticamente pelo perfil OPERADOR (sem privilégios administrativos)
export const PERMISSOES_PADRAO_OPERADOR = {
  // Produção (exceto criar/configurar OP)
  retorno_producao: true,
  producao_entrada: true,
  producao_saida: true,
  desmembramento: true,
  reimpressao: true,
  // Movimentação interna
  movimentacao: true,
  movimentacao_consultar: true,
  // Recebimento
  recebimento: true,
  recebimento_consultar: true,
  // Inventário
  inventario_coletor: true,
  inventario_divergencias: true,
  // Pedidos
  pedidos_consultar: true,
  saida: true,
  expedicao: true,
  // Consultas operacionais
  estoque_enderecos: true,
  consulta_estoque: true,
  rastreabilidade: true,
  consulta_endereco: true,
  movimentacao_historico: true,
  ean_etiquetas: true,
  // Conta própria
  alterar_propria_senha: true,
}

export const PERMISSOES_PADRAO_ADMINISTRADOR = (() => {
  const base = {}
  TODAS_CHAVES_PERMISSAO.forEach((k) => {
    if (!['configurar_sistema'].includes(k)) {
      base[k] = true
    }
  })
  return base
})()

export const PERMISSOES_MASTER_COMPLETAS = (() => {
  const base = {}
  TODAS_CHAVES_PERMISSAO.forEach((k) => {
    base[k] = true
  })
  return base
})()

export const PERFIS_SISTEMA_BASE = [
  {
    codigo: 'OPERADOR',
    nome: 'OPERADOR',
    nivel: 'OPERACIONAL',
    setor_padrao: 'Produção',
    descricao: 'Operação diária: recebimento, inventário coletor, entrada/saída de produção, movimentações, separação de pedidos e consultas.',
    permissoes: PERMISSOES_PADRAO_OPERADOR,
    sistema_fixo: 1,
  },
  {
    codigo: 'CLIENTE',
    nome: 'CLIENTE',
    nivel: 'CLIENTE',
    setor_padrao: 'CLIENTE',
    descricao: 'Portal de consulta isolado da operação: relatórios consolidados de produção, rendimento e saldo de estoque.',
    permissoes: PERMISSOES_PADRAO_CLIENTE,
    sistema_fixo: 1,
  },
  {
    codigo: 'ADMINISTRADOR',
    nome: 'ADMINISTRADOR',
    nivel: 'ADMINISTRADOR',
    setor_padrao: 'Administrativo',
    descricao: 'Gestão operacional e cadastros: gerencia usuários comuns, cria OPs/pedidos e acessa relatórios completos.',
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

export function criarMapaPermissoesVazio() {
  const mapa = {}
  TODAS_CHAVES_PERMISSAO.forEach((k) => {
    mapa[k] = false
  })
  return mapa
}

export function isMaster(operador) {
  if (!operador) return false
  const nivel = String(operador.nivel || '').toUpperCase()
  const perfil = String(operador.perfil || '').toUpperCase()
  return nivel === 'MASTER' || perfil === 'MASTER'
}

export function isCliente(operador) {
  if (!operador || isMaster(operador)) return false
  const nivel = String(operador.nivel || '').toUpperCase()
  const perfil = String(operador.perfil || '').toUpperCase()
  return nivel === 'CLIENTE' || perfil === 'CLIENTE'
}

export function isAdministradorOuSuperior(operador) {
  if (!operador) return false
  if (isMaster(operador)) return true
  const nivel = String(operador.nivel || '').toUpperCase()
  const perfil = String(operador.perfil || '').toUpperCase()
  return Number(operador.is_adm) === 1 || nivel === 'ADMINISTRADOR' || perfil === 'GESTOR' || perfil === 'ADMINISTRADOR'
}

/**
 * Sanitiza permissões respeitando o nível/perfil (especialmente CLIENTE estritamente consulta).
 */
export function sanitizarPermissoes(rawPermissoes = {}, nivel = 'OPERACIONAL', perfil = 'OPERADOR') {
  const nivelUp = String(nivel || '').toUpperCase()
  const perfilUp = String(perfil || '').toUpperCase()
  if (nivelUp === 'MASTER' || perfilUp === 'MASTER') {
    return { ...PERMISSOES_MASTER_COMPLETAS }
  }

  let obj = rawPermissoes
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj) } catch { obj = {} }
  }
  const mapa = criarMapaPermissoesVazio()

  TODAS_CHAVES_PERMISSAO.forEach((k) => {
    mapa[k] = !!obj?.[k]
  })

  // Migração suave de permissões legadas apenas quando as granulares ainda não existiam
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

  if (nivelUp === 'CLIENTE' || perfilUp === 'CLIENTE') {
    CHAVES_PROIBIDAS_CLIENTE.forEach((blocked) => {
      mapa[blocked] = false
    })
  }

  return mapa
}

/**
 * Verifica se o usuário possui determinada permissão (com fallback de legado).
 */
export function temPermissao(operador, chave) {
  if (!operador || Number(operador.ativo ?? 1) !== 1) return false
  if (isMaster(operador)) return true

  if (isCliente(operador) && CHAVES_PROIBIDAS_CLIENTE.has(chave)) {
    return false
  }

  const p = operador.permissoes || {}
  if (p[chave] === true) return true

  // Equivalências compatíveis com contas antigas
  switch (chave) {
    case 'producao_entrada':
    case 'producao_saida':
      return !!p.retorno_producao || (!!p.movimentacao && p[chave] !== false)
    case 'producao_criar_op':
      return isAdministradorOuSuperior(operador)
    case 'movimentacao_consultar':
    case 'movimentacao_historico':
      return !!p.movimentacao
    case 'recebimento_consultar':
      return !!p.recebimento
    case 'inventario_divergencias':
      return !!p.inventario_coletor || !!p.inventario_gestao
    case 'pedidos_consultar':
      return !!p.pedidos || !!p.saida || !!p.expedicao || isAdministradorOuSuperior(operador)
    case 'relatorios_producao':
    case 'relatorios_estoque':
      return !!p.produtos || !!p.dashboard_executivo || !!p[chave]
    case 'reimpressao':
      return p.reimpressao !== false && (!!p.recebimento || !!p.desmembramento || !!p.retorno_producao || !!p.produtos)
    case 'taras':
      return !!p.produtos || isAdministradorOuSuperior(operador)
    case 'alterar_propria_senha':
      return p.alterar_propria_senha !== false
    default:
      return false
  }
}

export function temAlgumaPermissao(operador, chaves = []) {
  if (!operador) return false
  if (isMaster(operador)) return true
  return chaves.some((k) => temPermissao(operador, k))
}

export function aplicarSetorPermissoes(permissoesAtuais, setorId, marcar, nivel = 'OPERACIONAL') {
  const setor = SETORES_PERMISSOES.find((s) => s.id === setorId)
  if (!setor) return permissoesAtuais
  const next = { ...permissoesAtuais }
  setor.permissoes.forEach((perm) => {
    if (String(nivel).toUpperCase() === 'CLIENTE' && CHAVES_PROIBIDAS_CLIENTE.has(perm.key)) {
      next[perm.key] = false
    } else {
      next[perm.key] = !!marcar
    }
  })
  return next
}
