import { isCliente, temPermissao, temAlgumaPermissao } from './permissoes.js'

/**
 * Catálogo unificado de módulos do WMSphere para o Menu Lateral e para a Busca
 * Dinâmica (Lupa no Sidebar + Command Palette Ctrl+K).
 *
 * Cada módulo carrega palavras-chave semânticas (sinônimos, siglas, termos do
 * dia a dia e categorias) para que pesquisas amplas (ex.: "compras") tragam
 * todos os módulos ligados ao fluxo, enquanto pesquisas específicas
 * (ex.: "pedido de compra") filtrem exclusivamente para o módulo exato.
 */

const STOPWORDS_PT = new Set([
  'de', 'da', 'do', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'pra', 'pro', 'por', 'com', 'o', 'a', 'os', 'as', 'p', 'ao', 'aos',
])

export function normalizarTexto(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function stemSimplesPt(word) {
  if (!word || word.length < 4) return word
  if (word.endsWith('oes') && word.length >= 5) return word.slice(0, -3) + 'ao'
  if (word.endsWith('ais') && word.length >= 5) return word.slice(0, -3) + 'al'
  if (word.endsWith('eis') && word.length >= 5) return word.slice(0, -3) + 'el'
  if (word.endsWith('es') && word.length >= 5 && !word.endsWith('tes')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function tokenizar(str, removerStopwords = true) {
  const norm = normalizarTexto(str)
  if (!norm) return []
  const raw = norm.split(/\s+/).filter(Boolean)
  if (!removerStopwords) return raw
  const filtrados = raw.filter((w) => !STOPWORDS_PT.has(w))
  return filtrados.length > 0 ? filtrados : raw
}

function levenshteinLimitado(a, b, maxDist = 2) {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > maxDist) return maxDist + 1
  let prev = new Array(lb + 1)
  let curr = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > maxDist) return maxDist + 1
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[lb]
}

function matchTokenEmPalavras(qTok, targetWords) {
  const qStem = stemSimplesPt(qTok)
  let melhor = 0 // 0 = não casa, 3 = exato/stem, 2 = prefixo/substring, 1 = fuzzy (erro de digitação)

  for (const w of targetWords) {
    if (!w) continue
    const wStem = stemSimplesPt(w)
    if (w === qTok || wStem === qStem) return 3
    if (w.startsWith(qTok) || wStem.startsWith(qStem)) {
      if (melhor < 2.5) melhor = 2.5
      continue
    }
    if (qTok.length >= 3 && w.includes(qTok)) {
      if (melhor < 2) melhor = 2
      continue
    }
    if (qStem.length >= 5 && wStem.length >= 5 && qStem[0] === wStem[0]) {
      const lim = qStem.length >= 8 ? 2 : 1
      const dist = levenshteinLimitado(qStem, wStem, lim)
      if (dist <= lim) {
        if (melhor < 1) melhor = 1
      }
    }
  }
  return melhor
}

/**
 * Monta a lista de módulos visíveis para o usuário e filial atuais, mantendo a
 * mesma ordem e regras de permissão da Sidebar.
 */
export function obterModulosVisiveis(operador, isFilialVarejo) {
  if (!operador) return []
  const cliente = isCliente(operador)

  if (cliente) {
    const items = [
      {
        id: 'portal-cliente',
        to: '/portal-cliente',
        label: 'Visão Consolidada',
        section: 'Portal do Cliente',
        icon: 'ShieldCheck',
        keywords: ['portal', 'cliente', 'visao', 'consolidada', 'inicio', 'estoque', 'resumo'],
      },
    ]
    if (temAlgumaPermissao(operador, ['relatorios_producao', 'relatorios_estoque'])) {
      items.push({
        id: 'relatorios-cli',
        to: '/relatorios',
        label: 'Relatórios Consolidados',
        section: 'Portal do Cliente',
        icon: 'PieChart',
        keywords: ['relatorio', 'pdf', 'executivo', 'producao', 'estoque', 'exportar'],
      })
    }
    return items
  }

  const temVisaoGeral = temAlgumaPermissao(operador, [
    'dashboard_executivo', 'estoque_enderecos', 'consulta_estoque', 'relatorios_estoque',
  ])
  const temOperacao = temAlgumaPermissao(operador, [
    'recebimento', 'recebimento_consultar', 'movimentacao', 'movimentacao_consultar',
    'retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op',
    'desmembramento', 'reimpressao', 'saida', 'expedicao', 'roteirizacao_carregamento',
    'devolucao', 'devolucao_fiscal',
  ])

  const secaoInicio = temVisaoGeral || !temOperacao ? 'Visão Geral' : 'Menu'

  const definicoes = [
    // ── VISÃO GERAL ───────────────────────────────────────────────────────────
    {
      id: 'home',
      to: '/',
      label: temPermissao(operador, 'dashboard_executivo') ? 'Dashboard' : 'Início / Operações',
      section: secaoInicio,
      icon: 'Package',
      visible: true,
      keywords: ['inicio', 'home', 'dashboard', 'painel', 'resumo', 'indicadores', 'kpi', 'visao geral', 'graficos'],
    },
    {
      id: 'pendencias',
      to: '/pendencias',
      label: 'Central de Pendências',
      section: secaoInicio,
      icon: 'BellRing',
      visible: true,
      keywords: ['pendencia', 'alerta', 'notificacao', 'aviso', 'validade', 'vencimento', 'aprovacao', 'central'],
    },
    {
      id: 'estoque',
      to: '/estoque',
      label: 'Estoque por Endereço',
      section: secaoInicio,
      icon: 'Layers',
      visible: temPermissao(operador, 'estoque_enderecos'),
      keywords: ['estoque', 'endereco', 'camara', 'fria', 'posicao', 'rua', 'prateleira', 'saldo', 'caixas', 'acougue', 'emporio'],
    },
    {
      id: 'estoque-minimo',
      to: '/estoque-minimo',
      label: 'Estoque Mínimo Dinâmico',
      section: secaoInicio,
      icon: 'TrendingDown',
      visible: temAlgumaPermissao(operador, ['consulta_estoque', 'relatorios_estoque']),
      keywords: ['estoque', 'minimo', 'dinamico', 'reposicao', 'ruptura', 'giro', 'consumo', 'compras', 'sugestao compra', 'cobertura'],
    },
    {
      id: 'mapa',
      to: '/mapa',
      label: 'Mapa de Capacidade',
      section: secaoInicio,
      icon: 'Map',
      visible: temPermissao(operador, 'estoque_enderecos'),
      keywords: ['mapa', 'capacidade', 'ocupacao', 'camara', 'estoque', 'lotacao', 'espaco'],
    },

    // ── VAREJO & AÇOUGUE (SOMENTE FILIAL VAREJO) ──────────────────────────────
    {
      id: 'pdv',
      to: '/pdv',
      label: 'PDV Frente de Caixa',
      section: 'Varejo & Açougue',
      icon: 'ShoppingCart',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['pdv_caixa', 'varejo_acougue']),
      keywords: ['pdv', 'caixa', 'frente de caixa', 'venda', 'varejo', 'cupom', 'nfce', 'pix', 'cartao', 'debito', 'credito', 'dinheiro', 'crediario', 'fiado', 'desconto', 'sangria', 'suprimento', 'troco', 'balcao', 'acougue', 'impressora'],
    },
    {
      id: 'acougue',
      to: '/acougue',
      label: 'Açougue',
      section: 'Varejo & Açougue',
      icon: 'Scale',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue']),
      keywords: ['acougue', 'balanca', 'pesagem', 'pesar', 'carne', 'corte', 'etiqueta', 'qr', 'zebra', 'entrada mp', 'materia prima', 'bovino', 'suino', 'aves', 'bandeja', 'varejo'],
    },
    {
      id: 'gerenciador-acougue',
      to: '/gerenciador-acougue',
      label: 'Gerenciador do Açougue',
      section: 'Varejo & Açougue',
      icon: 'Store',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue']),
      keywords: ['gerenciador', 'acougue', 'estoque acougue', 'mp aberta', 'etiquetas pesadas', 'validade', 'quebra', 'rendimento', 'relatorio acougue', 'varejo'],
    },
    {
      id: 'emporio',
      to: '/emporio',
      label: 'Empório (Estoque)',
      section: 'Varejo & Açougue',
      icon: 'ShoppingBag',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue']),
      keywords: ['emporio', 'mercearia', 'bebida', 'coca', 'refrigerante', 'carvao', 'tempero', 'revenda', 'ean', 'carga inicial', 'ajuste manual', 'estoque', 'varejo', 'fardo'],
    },
    {
      id: 'tabelas-preco-varejo',
      to: '/tabelas-preco',
      label: 'Tabelas de Preço',
      section: 'Varejo & Açougue',
      icon: 'Tag',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue']),
      keywords: ['tabela', 'preco', 'precos', 'valor', 'promocao', 'desconto', 'reajuste', 'varejo', 'acougue', 'atacado', 'margem', 'precificacao'],
    },
    {
      id: 'inventario-loja',
      to: '/inventario-loja',
      label: 'Inventário da Loja',
      section: 'Varejo & Açougue',
      icon: 'CheckSquare',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['varejo_acougue']),
      keywords: ['inventario', 'loja', 'varejo', 'acougue', 'emporio', 'contagem', 'cego', 'balanco', 'auditoria', 'divergencia', 'perda'],
    },
    {
      id: 'clientes-varejo',
      to: '/clientes-varejo',
      label: 'Clientes (Varejo)',
      section: 'Varejo & Açougue',
      icon: 'Users',
      visible: isFilialVarejo && temAlgumaPermissao(operador, ['pdv_caixa', 'varejo_acougue', 'clientes']),
      keywords: ['cliente', 'clientes', 'varejo', 'crediario', 'limite', 'credito', 'fiado', 'desconto', 'cpf', 'cadastro cliente', 'receber crediario'],
    },

    // ── COMPRAS & INSUMOS ─────────────────────────────────────────────────────
    {
      id: 'compras',
      to: '/compras',
      label: 'Pedidos de Compra',
      section: 'Compras & Insumos',
      icon: 'ShoppingBag',
      visible: temAlgumaPermissao(operador, ['compras', 'recebimento']),
      keywords: ['compras', 'compra', 'pedido de compra', 'pc', 'xml', 'nfe entrada', 'importar xml', 'nota entrada', 'fornecedor', 'cotacao', 'higiene', 'uso e consumo', 'escriturar', 'custo', 'suprimentos'],
    },
    {
      id: 'insumos-coleta',
      to: '/insumos-coleta',
      label: 'Coleta de Insumos',
      section: 'Compras & Insumos',
      icon: 'Boxes',
      visible: temAlgumaPermissao(operador, ['insumos_coleta', 'compras', 'varejo_acougue', 'producao_entrada']),
      keywords: ['compras', 'insumo', 'insumos', 'embalagem', 'saco vacuo', 'caixa papelao', 'coleta', 'retirada', 'almoxarifado', 'uso e consumo', 'material'],
    },

    // ── FATURAMENTO ───────────────────────────────────────────────────────────
    {
      id: 'interunidades',
      to: '/interunidades',
      label: 'Inter-Unidades',
      section: 'Faturamento',
      icon: 'ArrowRightLeft',
      visible: temAlgumaPermissao(operador, ['interunidades', 'movimentacao', 'fiscal', 'varejo_acougue']),
      keywords: ['interunidades', 'inter', 'unidade', 'filial', 'filiais', 'transferencia', 'remessa', 'industrializacao', 'retorno producao', 'faturamento diario', 'cfop 5901', 'cfop 5152', 'loja', 'matriz'],
    },
    {
      id: 'whatsapp-inbox',
      to: '/whatsapp-inbox',
      label: 'Entrada WhatsApp',
      section: 'Faturamento',
      icon: 'MessageSquare',
      visible: temAlgumaPermissao(operador, ['whatsapp_inbox', 'pedidos']),
      keywords: ['whatsapp', 'zap', 'mensagem', 'pedido', 'venda', 'inbox', 'entrada', 'atendimento', 'faturamento'],
    },
    {
      id: 'pedidos',
      to: '/pedidos',
      label: 'Pedidos de Venda',
      section: 'Faturamento',
      icon: 'ClipboardList',
      visible: temAlgumaPermissao(operador, ['pedidos', 'financeiro_pedidos']),
      keywords: ['pedido', 'pedidos', 'venda', 'vendas', 'atacado', 'faturamento', 'separacao', 'cliente', 'orcamento', 'comercial'],
    },
    {
      id: 'fiscal',
      to: '/fiscal',
      label: 'Fiscal (NF-e / NFC-e)',
      section: 'Faturamento',
      icon: 'FileCheck2',
      visible: temAlgumaPermissao(operador, ['fiscal', 'devolucao_fiscal', 'parametros_comerciais']),
      keywords: ['fiscal', 'nfe', 'nfce', 'nota', 'notas', 'danfe', 'xml', 'sefaz', 'certificado', 'a1', 'cce', 'carta correcao', 'inutilizacao', 'imposto', 'tributacao', 'faturamento', 'cofre xml', 'compras'],
    },
    {
      id: 'roteirizacao',
      to: '/roteirizacao',
      label: 'Roteirização / Embarques',
      section: 'Faturamento',
      icon: 'Truck',
      visible: temAlgumaPermissao(operador, ['roteirizacao', 'pedidos', 'transportadoras']),
      keywords: ['roteirizacao', 'embarque', 'carga', 'carregamento', 'caminhao', 'rota', 'entrega', 'motorista', 'logistica', 'expedicao', 'despacho', 'romaneio'],
    },

    // ── FINANCEIRO ────────────────────────────────────────────────────────────
    {
      id: 'financeiro',
      to: '/financeiro',
      label: 'Financeiro (Pagar/Receber)',
      section: 'Financeiro',
      icon: 'DollarSign',
      visible: temAlgumaPermissao(operador, ['financeiro', 'financeiro_pedidos']),
      keywords: ['financeiro', 'contas a pagar', 'contas a receber', 'pagar', 'receber', 'boleto', 'titulo', 'banco', 'conta bancaria', 'extrato', 'fluxo caixa', 'inadimplencia', 'comissao', 'baixa', 'pix', 'dinheiro'],
    },
    {
      id: 'dre',
      to: '/dre',
      label: 'DRE & Margem Real',
      section: 'Financeiro',
      icon: 'BarChart3',
      visible: temAlgumaPermissao(operador, ['financeiro', 'financeiro_pedidos', 'dashboard_executivo']),
      keywords: ['dre', 'margem', 'lucro', 'resultado', 'balanco', 'faturamento', 'despesa', 'custo', 'financeiro', 'gerencial', 'rentabilidade'],
    },

    // ── GESTÃO OPERACIONAL ────────────────────────────────────────────────────
    {
      id: 'mapa-producao',
      to: '/mapa-producao',
      label: 'Mapa de Produção',
      section: 'Gestão Operacional',
      icon: 'GitBranch',
      visible: temAlgumaPermissao(operador, ['mapa_producao', 'producao_criar_op']),
      keywords: ['mapa', 'producao', 'op', 'ordem de producao', 'desossa', 'rendimento', 'quebra', 'arvore', 'bom', 'industrial', 'planejamento'],
    },

    // ── OPERAÇÃO ──────────────────────────────────────────────────────────────
    {
      id: 'recebimento',
      to: '/recebimento',
      label: 'Recebimento (REC)',
      section: 'Operação',
      icon: 'Upload',
      visible: temAlgumaPermissao(operador, ['recebimento', 'recebimento_consultar']),
      keywords: ['recebimento', 'rec', 'doca', 'entrada', 'compras', 'conferencia', 'pesagem', 'temperatura', 'caminhao', 'descarga', 'fornecedor', 'bipar'],
    },
    {
      id: 'movimentacao',
      to: '/movimentacao',
      label: 'Movimentação Interna',
      section: 'Operação',
      icon: 'ArrowRightLeft',
      visible: temAlgumaPermissao(operador, ['movimentacao', 'movimentacao_consultar']),
      keywords: ['movimentacao', 'interna', 'transferencia', 'trocar endereco', 'enderecamento', 'camara', 'palete', 'armazenagem', 'bipar'],
    },
    {
      id: 'producao',
      to: '/producao',
      label: 'Retorno de Produção',
      section: 'Operação',
      icon: 'Factory',
      visible: temAlgumaPermissao(operador, ['retorno_producao', 'producao_entrada', 'producao_saida', 'producao_criar_op']),
      keywords: ['producao', 'retorno', 'op', 'ordem producao', 'desossa', 'etiqueta 100x70', 'caixa produzida', 'entrada op', 'saida op', 'industrial'],
    },
    {
      id: 'desmembramento',
      to: '/desmembramento',
      label: 'Desmembramento',
      section: 'Operação',
      icon: 'Scissors',
      visible: temPermissao(operador, 'desmembramento'),
      keywords: ['desmembramento', 'desmembrar', 'fracionar', 'dividir caixa', 'quebrar caixa', 'etiqueta', 'porcionamento'],
    },
    {
      id: 'reimpressao',
      to: '/reimpressao',
      label: 'Reimpressão Etiquetas',
      section: 'Operação',
      icon: 'Printer',
      visible: temPermissao(operador, 'reimpressao'),
      keywords: ['reimpressao', 'reimprimir', 'etiqueta', 'etiquetas', 'impressora', 'zebra', 'rotulo', 'codigo barras', 'ean'],
    },
    {
      id: 'saida',
      to: '/saida',
      label: 'Saída de Materiais',
      section: 'Operação',
      icon: 'LogOut',
      visible: temAlgumaPermissao(operador, ['saida', 'expedicao']),
      keywords: ['saida', 'expedicao', 'romaneio', 'separacao', 'despacho', 'baixar caixa', 'faturamento', 'carregamento'],
    },
    {
      id: 'roteirizacao-op',
      to: '/roteirizacao',
      label: 'Carregamento / Roteiros',
      section: 'Operação',
      icon: 'Truck',
      visible:
        temPermissao(operador, 'roteirizacao_carregamento') &&
        !temAlgumaPermissao(operador, ['roteirizacao', 'pedidos', 'transportadoras']),
      keywords: ['carregamento', 'roteiro', 'caminhao', 'embarque', 'entrega', 'doca', 'expedicao'],
    },
    {
      id: 'devolucao',
      to: '/devolucao',
      label: 'Devolução de Caixas',
      section: 'Operação',
      icon: 'RotateCcw',
      visible: temAlgumaPermissao(operador, ['devolucao', 'devolucao_fiscal', 'saida', 'expedicao', 'recebimento']),
      keywords: ['devolucao', 'devolver', 'estorno', 'retorno cliente', 'caixa devolvida', 'avaria', 'recusa'],
    },

    // ── CONTROLE ──────────────────────────────────────────────────────────────
    {
      id: 'relatorios',
      to: '/relatorios',
      label: 'Relatórios',
      section: 'Controle',
      icon: 'PieChart',
      visible: temAlgumaPermissao(operador, ['relatorios_producao', 'relatorios_estoque']),
      keywords: ['relatorio', 'relatorios', 'pdf', 'executivo', 'dossie', 'exportar', 'csv', 'excel', 'historico', 'estoque', 'producao', 'romaneio'],
    },
    {
      id: 'inventario',
      to: '/inventario',
      label: 'Inventário',
      section: 'Controle',
      icon: 'CheckSquare',
      visible: temAlgumaPermissao(operador, ['inventario_coletor', 'inventario_divergencias', 'inventario_gestao', 'inventario_carga_inicial']),
      keywords: ['inventario', 'contagem', 'balanco', 'divergencia', 'conciliacao', 'carga inicial', 'coletor', 'auditoria', 'estoque'],
    },
    {
      id: 'consulta-estoque',
      to: '/consulta-estoque',
      label: 'Consulta de Estoque',
      section: 'Controle',
      icon: 'Search',
      visible: temPermissao(operador, 'consulta_estoque'),
      keywords: ['consulta', 'estoque', 'saldo', 'pesquisar produto', 'buscar caixa', 'disponivel', 'kg'],
    },
    {
      id: 'rastreabilidade',
      to: '/rastreabilidade',
      label: 'Rastreabilidade de Caixa',
      section: 'Controle',
      icon: 'Package',
      visible: temPermissao(operador, 'rastreabilidade'),
      keywords: ['rastreabilidade', 'rastrear', 'caixa', 'lote', 'historico caixa', 'ean', 'origem', 'sif', 'sifagem', 'auditoria'],
    },
    {
      id: 'produtos',
      to: '/produtos',
      label: 'Produtos & Especificações',
      section: 'Controle',
      icon: 'Box',
      visible: temPermissao(operador, 'produtos'),
      keywords: ['produto', 'produtos', 'catalogo', 'sku', 'cadastro produto', 'especificacao', 'rotulo', 'dipoa', 'ncm', 'tara', 'validade', 'custo', 'preco medio', 'emporio', 'bebida', 'coca', 'carvao', 'carne', 'bom', 'fardo'],
    },
    {
      id: 'ean-editor',
      to: '/ean-editor',
      label: 'Editor de EAN',
      section: 'Controle',
      icon: 'Barcode',
      visible: temPermissao(operador, 'ean_etiquetas'),
      keywords: ['ean', 'editor', 'codigo de barras', 'regra', 'etiqueta', 'gtin', 'de para', 'fornecedor', 'leitura'],
    },
    {
      id: 'consulta-endereco',
      to: '/consulta-endereco',
      label: 'Consulta de Endereço',
      section: 'Controle',
      icon: 'ScanLine',
      visible: temPermissao(operador, 'consulta_endereco'),
      keywords: ['consulta', 'endereco', 'local', 'camara', 'rua', 'prateleira', 'bipar endereco', 'estoque'],
    },

    // ── COMERCIAL & ESTRUTURA ─────────────────────────────────────────────────
    {
      id: 'tabelas-preco-comercial',
      to: '/tabelas-preco',
      label: 'Tabelas de Preço',
      section: 'Comercial & Estrutura',
      icon: 'Tag',
      visible:
        !isFilialVarejo &&
        temAlgumaPermissao(operador, ['produtos', 'pedidos', 'varejo_acougue', 'parametros_comerciais']),
      keywords: ['tabela', 'preco', 'precos', 'valor', 'promocao', 'desconto', 'reajuste', 'atacado', 'varejo', 'margem', 'precificacao'],
    },
    {
      id: 'clientes',
      to: '/clientes',
      label: 'Clientes & Especif.',
      section: 'Comercial & Estrutura',
      icon: 'Building2',
      visible: temAlgumaPermissao(operador, ['clientes', 'pedidos', 'financeiro_pedidos']),
      keywords: ['cliente', 'clientes', 'cnpj', 'cadastro cliente', 'atacado', 'limite credito', 'especificacao cliente', 'comercial'],
    },
    {
      id: 'fornecedores',
      to: '/fornecedores',
      label: 'Fornecedores & SIF',
      section: 'Comercial & Estrutura',
      icon: 'Truck',
      visible: temAlgumaPermissao(operador, ['fornecedores', 'recebimento']),
      keywords: ['fornecedor', 'fornecedores', 'compras', 'sif', 'frigorifico', 'abatedouro', 'industria', 'parceiro', 'cnpj'],
    },
    {
      id: 'vendedores',
      to: '/vendedores',
      label: 'Vendedores',
      section: 'Comercial & Estrutura',
      icon: 'Briefcase',
      visible: temAlgumaPermissao(operador, ['vendedores', 'operadores']),
      keywords: ['vendedor', 'vendedores', 'representante', 'comissao', 'equipe venda', 'comercial'],
    },
    {
      id: 'transportadoras',
      to: '/transportadoras',
      label: 'Rotas & Transp.',
      section: 'Comercial & Estrutura',
      icon: 'Route',
      visible: temPermissao(operador, 'transportadoras'),
      keywords: ['transportadora', 'rota', 'rotas', 'frete', 'logistica', 'entrega', 'motorista'],
    },
    {
      id: 'tipos-veiculo',
      to: '/tipos-veiculo',
      label: 'Tipos de Veículo',
      section: 'Comercial & Estrutura',
      icon: 'Truck',
      visible: temAlgumaPermissao(operador, ['transportadoras', 'roteirizacao']),
      keywords: ['veiculo', 'caminhao', 'frota', 'bau', 'refrigerado', 'capacidade', 'peso', 'entrega', 'logistica'],
    },
    {
      id: 'filiais',
      to: '/filiais',
      label: 'Empresas & Filiais',
      section: 'Comercial & Estrutura',
      icon: 'Factory',
      visible: temPermissao(operador, 'empresas_filiais'),
      keywords: ['empresa', 'filial', 'filiais', 'unidade', 'matriz', 'loja', 'cnpj', 'ie', 'endereco empresa'],
    },
    {
      id: 'parametros-comerciais',
      to: '/parametros-comerciais',
      label: 'Parâmetros Comerciais & Fiscais',
      section: 'Comercial & Estrutura',
      icon: 'Settings2',
      visible: temPermissao(operador, 'parametros_comerciais'),
      keywords: ['parametro', 'configuracao', 'config', 'comercial', 'fiscal', 'cfop', 'tributaria', 'matriz tributaria', 'marchante', 'centro de custo', 'forma pagamento', 'banco', 'trava', 'temperatura', 'tolerancia', 'emporio', 'carga inicial'],
    },

    // ── CADASTROS ─────────────────────────────────────────────────────────────
    {
      id: 'taras',
      to: '/taras',
      label: 'Cadastro de Taras',
      section: 'Cadastros',
      icon: 'Scale',
      visible: temPermissao(operador, 'taras'),
      keywords: ['tara', 'taras', 'embalagem', 'caixa plastica', 'peso caixa', 'balanca', 'cadastro'],
    },
    {
      id: 'locais',
      to: '/locais',
      label: 'Cadastro de Locais',
      section: 'Cadastros',
      icon: 'MapPin',
      visible: temPermissao(operador, 'locais'),
      keywords: ['local', 'locais', 'endereco', 'camara', 'rua', 'posicao', 'almoxarifado', 'cadastro'],
    },
    {
      id: 'operadores',
      to: '/operadores',
      label: 'Usuários e Permissões',
      section: 'Cadastros',
      icon: 'Users',
      visible: temAlgumaPermissao(operador, ['operadores', 'perfis_gerenciar']),
      keywords: ['usuario', 'usuarios', 'operador', 'permissao', 'perfil', 'acesso', 'senha', 'pin', 'gerencial', 'filial', 'conta', 'login'],
    },
  ]

  return definicoes.filter((d) => d.visible)
}

/**
 * Busca inteligente por módulo com suporte a:
 * - Remoção de acentos e plurais simples em português
 * - Stopwords ignoradas ("pedido de compra" -> ["pedido", "compra"])
 * - Tolerância a pequenos erros de digitação (ex.: "acogue" -> "acougue")
 * - Busca ampla por categoria ("compras" -> todos módulos de compras)
 * - Precisão cirúrgica em buscas específicas ("pedido de compra" -> só Pedidos de Compra)
 */
export function filtrarModulosDinamico(modulos, queryRaw) {
  const qNorm = normalizarTexto(queryRaw)
  if (!qNorm) return modulos

  const qTokens = tokenizar(queryRaw, true)
  if (qTokens.length === 0) return modulos

  const avaliados = []

  for (const mod of modulos) {
    const labelNorm = normalizarTexto(mod.label)
    const sectionNorm = normalizarTexto(mod.section)
    const labelWords = tokenizar(mod.label, false)
    const sectionWords = tokenizar(mod.section, false)
    const kwListNorm = (mod.keywords || []).map(normalizarTexto)
    const kwWords = kwListNorm.flatMap((k) => k.split(/\s+/).filter(Boolean))

    let score = 0
    let todosTokensCasaram = true
    let tokensNoLabel = 0
    let tokensNaSecao = 0

    // Bônus de frase completa
    if (labelNorm === qNorm) score += 300
    else if (labelNorm.startsWith(qNorm)) score += 200
    else if (labelNorm.includes(qNorm)) score += 160

    if (sectionNorm.includes(qNorm)) score += 75
    if (kwListNorm.some((k) => k === qNorm)) score += 95
    else if (kwListNorm.some((k) => k.includes(qNorm))) score += 50

    for (const qt of qTokens) {
      const mLabel = matchTokenEmPalavras(qt, labelWords)
      const mSection = matchTokenEmPalavras(qt, sectionWords)
      const mKw = matchTokenEmPalavras(qt, kwWords)

      const best = Math.max(mLabel, mSection, mKw)
      if (best <= 0) {
        todosTokensCasaram = false
        break
      }

      if (mLabel > 0) {
        tokensNoLabel += 1
        score += mLabel * 32
      } else if (mSection > 0) {
        tokensNaSecao += 1
        score += mSection * 18
      } else {
        score += mKw * 14
      }
    }

    if (!todosTokensCasaram) continue

    const todosNoLabel = tokensNoLabel === qTokens.length
    if (todosNoLabel) score += 90

    avaliados.push({
      mod,
      score,
      todosNoLabel,
      tocouTituloOuSecao: tokensNoLabel > 0 || tokensNaSecao > 0,
    })
  }

  if (avaliados.length === 0) return []

  // Precisão cirúrgica: em consultas específicas (2+ palavras úteis), se existir
  // algum módulo que casa TODAS as palavras direto no título (ex.: "pedido de compra"
  // -> "Pedidos de Compra"), filtramos ruídos que só casaram por keywords genéricas.
  const existeMatchTotalTitulo = qTokens.length >= 2 && avaliados.some((a) => a.todosNoLabel)
  const finais = existeMatchTotalTitulo
    ? avaliados.filter((a) => a.todosNoLabel)
    : avaliados

  finais.sort((a, b) => b.score - a.score)
  return finais.map((a) => a.mod)
}
