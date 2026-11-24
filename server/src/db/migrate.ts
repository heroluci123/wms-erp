import { eq, sql } from 'drizzle-orm'
import type { DbConnection } from './client.js'
import {
  tenants,
  empresas,
  filiais,
  operadores,
  perfisAcesso,
  formasPagamento,
  locaisCobranca,
  centrosCusto,
  naturezasOperacao,
  marchantes,
  tiposVeiculo,
  layoutsImportacaoTxt,
  eanSequencias,
  financeiroContasBancarias,
  produtoEspecificacoes,
  produtos,
  varejoEstoque,
  tabelasPreco,
  tabelasPrecoItens,
  acougueConfigFilial,
} from './schema/index.js'
import { uuidv7 } from '../utils/uuid.js'
import { hashSenha } from '../utils/crypto.js'
import { PERFIS_SISTEMA_BASE } from '../utils/permissoes.js'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  nome_conta TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plano TEXT NOT NULL DEFAULT 'PRO',
  status_assinatura TEXT NOT NULL DEFAULT 'ATIVO',
  limite_usuarios INTEGER NOT NULL DEFAULT 50,
  features_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL DEFAULT '1',
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  cnpj TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  regime_tributario TEXT NOT NULL DEFAULT 'SIMPLES',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_empresas_tenant ON empresas(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_tenant_codigo ON empresas(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS filiais (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL DEFAULT '1',
  nome TEXT NOT NULL,
  tipo_unidade TEXT NOT NULL DEFAULT 'DISTRIBUICAO',
  cnpj TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT 'SP',
  cidade TEXT NOT NULL DEFAULT '',
  codigo_ibge TEXT NOT NULL DEFAULT '',
  registro_sanitario_tipo TEXT NOT NULL DEFAULT 'SIF',
  registro_sanitario_num TEXT NOT NULL DEFAULT '',
  is_padrao INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_filiais_tenant ON filiais(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_filiais_empresa_codigo ON filiais(tenant_id, empresa_id, codigo);

CREATE TABLE IF NOT EXISTS colaboradores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID REFERENCES filiais(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  cpf TEXT NOT NULL DEFAULT '',
  cargo TEXT NOT NULL DEFAULT 'Operador',
  setor TEXT NOT NULL DEFAULT 'Produção',
  salario_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  custo_hora NUMERIC(14,4) NOT NULL DEFAULT 0,
  aso_validade DATE,
  epi_obs TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_colaboradores_tenant ON colaboradores(tenant_id);

CREATE TABLE IF NOT EXISTS operadores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  filial_padrao_id UUID REFERENCES filiais(id) ON DELETE SET NULL,
  colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL,
  legacy_id INTEGER,
  nome TEXT NOT NULL,
  login TEXT NOT NULL,
  pin TEXT NOT NULL DEFAULT '****',
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'OPERADOR',
  nivel TEXT NOT NULL DEFAULT 'OPERACIONAL',
  setor TEXT NOT NULL DEFAULT 'Produção',
  is_adm INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  deve_trocar_senha INTEGER NOT NULL DEFAULT 0,
  permissoes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ultimo_acesso TIMESTAMPTZ,
  criado_por_nome TEXT,
  atualizado_por_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operadores_tenant ON operadores(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_operadores_tenant_login_lower ON operadores(tenant_id, LOWER(login));

CREATE TABLE IF NOT EXISTS perfis_acesso (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'OPERACIONAL',
  setor_padrao TEXT NOT NULL DEFAULT 'Produção',
  descricao TEXT NOT NULL DEFAULT '',
  permissoes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sistema_fixo INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_perfis_tenant_codigo ON perfis_acesso(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS sessoes_usuarios (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operador_id UUID NOT NULL REFERENCES operadores(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  device_info TEXT NOT NULL DEFAULT 'web',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_ping TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encerrada_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes_usuarios(token);
CREATE INDEX IF NOT EXISTS idx_sessoes_operador_ativo ON sessoes_usuarios(operador_id, ativo);

CREATE TABLE IF NOT EXISTS auditoria_acessos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_user_id UUID,
  target_user_nome TEXT NOT NULL DEFAULT '',
  acao TEXT NOT NULL,
  detalhes_antes JSONB,
  detalhes_depois JSONB,
  executor_id UUID,
  executor_nome TEXT NOT NULL DEFAULT 'Sistema',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_tenant_data ON auditoria_acessos(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS vendedores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL,
  codigo TEXT NOT NULL,
  sigla TEXT NOT NULL DEFAULT '',
  nome TEXT NOT NULL,
  tipo_comissao TEXT NOT NULL DEFAULT 'PCT_VENDA',
  pct_comissao NUMERIC(7,3) NOT NULL DEFAULT 0,
  regra_liberacao TEXT NOT NULL DEFAULT 'FATURAMENTO',
  meta_mensal_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  meta_mensal_valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendedores_tenant ON vendedores(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendedores_tenant_codigo ON vendedores(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS produtos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo TEXT,
  codigo_auxiliar TEXT,
  ean TEXT,
  descricao TEXT NOT NULL,
  valor_unitario NUMERIC(14,4) NOT NULL DEFAULT 0,
  custo_medio_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  tipo_produto TEXT NOT NULL DEFAULT 'Materia Prima',
  status_curva TEXT NOT NULL DEFAULT 'C',
  unidade TEXT NOT NULL DEFAULT 'CX',
  grupo TEXT NOT NULL DEFAULT '',
  classificacao TEXT,
  produto_pai_id UUID,
  peso_padrao_cx NUMERIC(14,3),
  tara_primaria_peca_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  ncm TEXT NOT NULL DEFAULT '',
  cest TEXT NOT NULL DEFAULT '',
  origem_mercadoria TEXT NOT NULL DEFAULT '0',
  registro_dipoa TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_produtos_tenant ON produtos(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_tenant_codigo ON produtos(tenant_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_tenant_ean ON produtos(tenant_id, ean);

CREATE TABLE IF NOT EXISTS produtos_eans (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  codigo_barras TEXT NOT NULL,
  tipo_regra TEXT NOT NULL DEFAULT 'EXATO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_eans_tenant_cod ON produtos_eans(tenant_id, codigo_barras);

CREATE TABLE IF NOT EXISTS produto_arvore (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pai_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  filho_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  rendimento_esperado_pct NUMERIC(7,2),
  rendimento_aprendido_pct NUMERIC(7,2),
  amostras_aprendizado INTEGER NOT NULL DEFAULT 0,
  origem_vinculo TEXT NOT NULL DEFAULT 'MANUAL',
  confirmado INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produto_arvore_par ON produto_arvore(tenant_id, pai_id, filho_id);

CREATE TABLE IF NOT EXISTS taras (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  nome TEXT NOT NULL,
  peso_kg NUMERIC(14,3) NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  padrao INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_taras_tenant ON taras(tenant_id);

CREATE TABLE IF NOT EXISTS locais (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  endereco TEXT NOT NULL,
  capacidade_max_caixas NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  is_insumo INTEGER NOT NULL DEFAULT 0,
  tipo_armazenamento TEXT NOT NULL DEFAULT 'SECO'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_filial_endereco ON locais(tenant_id, filial_id, endereco);

CREATE TABLE IF NOT EXISTS formas_pagamento (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  dias_parcelas_json JSONB NOT NULL DEFAULT '[0]'::jsonb,
  pagamento_na_entrega INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_formas_pgto_tenant_cod ON formas_pagamento(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS locais_cobranca (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_cobr_tenant_cod ON locais_cobranca(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS centros_custo (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_centros_custo_tenant_cod ON centros_custo(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS naturezas_operacao (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo_movimento TEXT NOT NULL,
  finalidade TEXT NOT NULL,
  descricao TEXT NOT NULL,
  cfop_estadual TEXT NOT NULL,
  cfop_interestadual TEXT NOT NULL,
  codigo_sub_operacao TEXT NOT NULL DEFAULT '01',
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_naturezas_tenant ON naturezas_operacao(tenant_id);

CREATE TABLE IF NOT EXISTS matriz_tributaria (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ncm TEXT NOT NULL,
  uf_origem TEXT NOT NULL,
  uf_destino TEXT NOT NULL,
  regime_tributario TEXT NOT NULL DEFAULT 'SIMPLES',
  cst_csosn TEXT NOT NULL DEFAULT '',
  aliq_icms NUMERIC(6,2) NOT NULL DEFAULT 0,
  reducao_base_icms_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  aliq_icms_st NUMERIC(6,2) NOT NULL DEFAULT 0,
  validado_por_contador TEXT NOT NULL DEFAULT '',
  updated_by_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_matriz_trib_tenant_ncm ON matriz_tributaria(tenant_id, ncm);

CREATE TABLE IF NOT EXISTS marchantes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  is_padrao INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marchantes_tenant_cod ON marchantes(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS transportadoras (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  cnpj_cpf TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  endereco TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  bairro TEXT NOT NULL DEFAULT '',
  cep TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT 'SP',
  cidade TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  rntrc_antt TEXT NOT NULL DEFAULT '',
  placa_padrao TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transportadoras_tenant ON transportadoras(tenant_id);

CREATE TABLE IF NOT EXISTS transportadora_veiculos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transportadora_id UUID NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  placa TEXT NOT NULL,
  uf_placa TEXT NOT NULL DEFAULT 'SP',
  modelo TEXT NOT NULL DEFAULT '',
  rntrc_antt TEXT NOT NULL DEFAULT '',
  capacidade_kg NUMERIC(14,2),
  motorista_padrao TEXT NOT NULL DEFAULT '',
  padrao INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transp_veic_tenant_transp ON transportadora_veiculos(tenant_id, transportadora_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transp_veic_placa ON transportadora_veiculos(tenant_id, transportadora_id, placa);

CREATE TABLE IF NOT EXISTS tipos_veiculo (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'UTILITARIO',
  capacidade_kg NUMERIC(14,2) NOT NULL DEFAULT 650,
  tolerancia_pct NUMERIC(6,2) NOT NULL DEFAULT 10,
  observacoes TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tipos_veiculo_tenant ON tipos_veiculo(tenant_id, ativo);

CREATE TABLE IF NOT EXISTS fornecedores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  cnpj_cpf TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  endereco TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  complemento TEXT NOT NULL DEFAULT '',
  bairro TEXT NOT NULL DEFAULT '',
  cep TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT 'SP',
  cidade TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  cnae_principal TEXT NOT NULL DEFAULT '',
  regime_apuracao TEXT NOT NULL DEFAULT '',
  situacao_cadastral TEXT NOT NULL DEFAULT '',
  registro_sanitario_sif TEXT NOT NULL DEFAULT '',
  prazo_entrega_dias INTEGER NOT NULL DEFAULT 5,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fornecedores_tenant ON fornecedores(tenant_id);

CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo TEXT,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  cnpj_cpf TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  endereco TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  complemento TEXT NOT NULL DEFAULT '',
  bairro TEXT NOT NULL DEFAULT '',
  cep TEXT NOT NULL DEFAULT '',
  cidade TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT 'SP',
  pais TEXT NOT NULL DEFAULT 'BRASIL',
  telefone TEXT NOT NULL DEFAULT '',
  icms TEXT NOT NULL DEFAULT 'CONTRIBUINTE',
  vendedor_padrao_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  forma_pagamento_padrao_id UUID REFERENCES formas_pagamento(id) ON DELETE SET NULL,
  local_cobranca_padrao_id UUID REFERENCES locais_cobranca(id) ON DELETE SET NULL,
  marchante_padrao TEXT NOT NULL DEFAULT '',
  rota_padrao_nome TEXT NOT NULL DEFAULT '',
  limite_credito NUMERIC(14,2) NOT NULL DEFAULT 0,
  bloqueado_financeiro INTEGER NOT NULL DEFAULT 0,
  permite_pagamento_entrega INTEGER NOT NULL DEFAULT 1,
  is_padrao INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_tenant ON clientes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_tenant_codigo ON clientes(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS cliente_produto_espec (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  codigo_aux_cliente TEXT NOT NULL DEFAULT '',
  especificacao_corte TEXT NOT NULL DEFAULT '',
  preco_negociado NUMERIC(14,4),
  ultima_venda_preco NUMERIC(14,4),
  alerta_reclamacao INTEGER NOT NULL DEFAULT 0,
  alerta_descricao TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cli_prod_espec ON cliente_produto_espec(tenant_id, cliente_id, produto_id);

CREATE TABLE IF NOT EXISTS fornecedor_produto_depara (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fornecedor_id UUID NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  codigo_fornecedor TEXT NOT NULL,
  descricao_fornecedor TEXT NOT NULL DEFAULT '',
  ncm TEXT NOT NULL DEFAULT '',
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  fator_conversao NUMERIC(14,4) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_depara_forn_cod ON fornecedor_produto_depara(tenant_id, fornecedor_id, codigo_fornecedor);
CREATE INDEX IF NOT EXISTS idx_depara_prod ON fornecedor_produto_depara(tenant_id, produto_id);

CREATE TABLE IF NOT EXISTS layouts_importacao_txt (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  tipo_arquivo TEXT NOT NULL DEFAULT 'DELIMITADO',
  delimitador TEXT NOT NULL DEFAULT ';',
  saltar_linhas INTEGER NOT NULL DEFAULT 0,
  formato_data TEXT NOT NULL DEFAULT 'DDMMYYYY',
  decimal_ponto INTEGER NOT NULL DEFAULT 0,
  mapeamento_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layouts_txt_tenant ON layouts_importacao_txt(tenant_id, ativo);

CREATE TABLE IF NOT EXISTS pedidos_compra (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  fornecedor_id UUID NOT NULL REFERENCES fornecedores(id),
  natureza_id UUID REFERENCES naturezas_operacao(id),
  centro_custo_id UUID REFERENCES centros_custo(id),
  forma_pagamento_id UUID REFERENCES formas_pagamento(id),
  comprador_id UUID REFERENCES operadores(id),
  marchante TEXT NOT NULL DEFAULT '',
  frete_valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  despesas_valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  previsao_entrega DATE,
  observacoes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ABERTO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_compra_codigo ON pedidos_compra(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_pedidos_compra_status ON pedidos_compra(tenant_id, status);

CREATE TABLE IF NOT EXISTS pedidos_compra_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pedido_compra_id UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  qtd_kg_solicitada NUMERIC(14,3) NOT NULL,
  preco_unitario_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  qtd_kg_recebida NUMERIC(14,3) NOT NULL DEFAULT 0,
  cfop_aplicado TEXT NOT NULL DEFAULT '',
  temperatura_c NUMERIC(6,2),
  temperatura_registrada_em TIMESTAMPTZ,
  temperatura_registrada_por TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pci_pedido ON pedidos_compra_itens(pedido_compra_id);

CREATE TABLE IF NOT EXISTS recebimentos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  pedido_compra_id UUID REFERENCES pedidos_compra(id),
  fornecedor_id UUID REFERENCES fornecedores(id),
  chave_nfe TEXT NOT NULL DEFAULT '',
  numero_nf TEXT NOT NULL DEFAULT '',
  serie_nf TEXT NOT NULL DEFAULT '',
  data_emissao_nf DATE,
  valor_produtos_nf NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_frete_nf NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_outras_desp_nf NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_desconto_nf NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total_nf NUMERIC(14,2) NOT NULL DEFAULT 0,
  xml_itens_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  xml_duplicatas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  xml_conteudo TEXT NOT NULL DEFAULT '',
  xml_storage_key TEXT NOT NULL DEFAULT '',
  status_validacao TEXT NOT NULL DEFAULT 'AGUARDANDO_BIPAGEM',
  validado_por_id UUID,
  validado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_codigo ON recebimentos(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS recebimento_pre_caixas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  recebimento_id UUID REFERENCES recebimentos(id) ON DELETE CASCADE,
  pedido_compra_id UUID REFERENCES pedidos_compra(id) ON DELETE SET NULL,
  fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
  ean_caixa TEXT NOT NULL,
  codigo_produto_fornecedor TEXT NOT NULL DEFAULT '',
  descricao_produto_fornecedor TEXT NOT NULL DEFAULT '',
  produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  peso_liquido_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  peso_bruto_kg NUMERIC(14,3),
  tara_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  qtd_pecas INTEGER,
  data_producao DATE,
  validade DATE,
  lote TEXT NOT NULL DEFAULT '',
  documento_origem TEXT NOT NULL DEFAULT '',
  arquivo_origem TEXT NOT NULL DEFAULT '',
  custo_unitario_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  caixa_estoque_id UUID,
  bipada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pre_caixas_tenant_ean ON recebimento_pre_caixas(tenant_id, ean_caixa);
CREATE INDEX IF NOT EXISTS idx_pre_caixas_rec_status ON recebimento_pre_caixas(tenant_id, recebimento_id, status);

CREATE TABLE IF NOT EXISTS paletes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo TEXT NOT NULL,
  endereco_atual TEXT NOT NULL DEFAULT 'REC',
  status TEXT NOT NULL DEFAULT 'EM_MONTAGEM',
  ultimo_operador TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_paletes_tenant_codigo ON paletes(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS estoque_caixas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  ean_caixa TEXT NOT NULL,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  palete_id UUID REFERENCES paletes(id),
  palete_origem_id UUID REFERENCES paletes(id),
  fornecedor_id UUID REFERENCES fornecedores(id),
  recebimento_id UUID REFERENCES recebimentos(id),
  sif_origem TEXT NOT NULL DEFAULT '',
  endereco TEXT,
  lote TEXT NOT NULL DEFAULT '',
  data_producao DATE,
  validade DATE,
  peso_bruto_kg NUMERIC(14,3),
  tara_id UUID REFERENCES taras(id),
  tara_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  tara_primaria_total_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  peso_kg NUMERIC(14,3) NOT NULL,
  qtd_pecas INTEGER,
  custo_unitario_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  origem_tipo TEXT NOT NULL DEFAULT 'RECEBIMENTO',
  caixa_origem_id UUID,
  ean_origem TEXT,
  op_id UUID,
  operador_cadastro_nome TEXT,
  status TEXT NOT NULL DEFAULT 'DISPONIVEL',
  pedido_reservado_id UUID,
  pedido_reservado_codigo TEXT,
  romaneio_reservado_id UUID,
  romaneio_reservado_codigo TEXT,
  cliente_reservado_nome TEXT,
  reservado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_caixas_tenant_ean ON estoque_caixas(tenant_id, ean_caixa);
CREATE INDEX IF NOT EXISTS idx_caixas_tenant_status ON estoque_caixas(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_caixas_endereco ON estoque_caixas(tenant_id, endereco);
CREATE INDEX IF NOT EXISTS idx_caixas_op ON estoque_caixas(tenant_id, op_id);

CREATE TABLE IF NOT EXISTS estoque_posicao (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  endereco TEXT NOT NULL,
  lote TEXT NOT NULL DEFAULT '',
  validade DATE,
  qtd_caixas NUMERIC(14,2) NOT NULL DEFAULT 0,
  qtd_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_tenant_produto ON estoque_posicao(tenant_id, produto_id);

CREATE TABLE IF NOT EXISTS caixas_historico (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  caixa_id UUID,
  ean_caixa TEXT NOT NULL,
  operacao TEXT NOT NULL,
  detalhes TEXT NOT NULL DEFAULT '',
  operador_nome TEXT NOT NULL DEFAULT 'Sistema',
  data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ch_tenant_ean ON caixas_historico(tenant_id, ean_caixa);

CREATE TABLE IF NOT EXISTS movimentacoes_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  produto_id UUID REFERENCES produtos(id),
  endereco_origem TEXT,
  endereco_destino TEXT,
  lote TEXT,
  qtd_caixas NUMERIC(14,2),
  qtd_kg NUMERIC(14,3),
  data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operador_id UUID REFERENCES operadores(id),
  operador_nome TEXT,
  tipo TEXT NOT NULL,
  num_pedido TEXT,
  cliente TEXT
);
CREATE INDEX IF NOT EXISTS idx_mov_log_tenant_data ON movimentacoes_log(tenant_id, data_hora);

CREATE TABLE IF NOT EXISTS desmembramentos_vinculos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo_operacao TEXT NOT NULL,
  caixa_origem_id UUID NOT NULL,
  ean_origem TEXT NOT NULL,
  caixa_destino_id UUID NOT NULL,
  ean_destino TEXT NOT NULL,
  produto_id UUID NOT NULL,
  peso_liquido_kg NUMERIC(14,3) NOT NULL,
  peso_bruto_kg NUMERIC(14,3),
  tara_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  lote TEXT NOT NULL DEFAULT '',
  data_producao DATE,
  validade DATE,
  qtd_pecas INTEGER,
  perda_pecas INTEGER NOT NULL DEFAULT 0,
  motivo_diferenca_pecas TEXT NOT NULL DEFAULT '',
  operador_id UUID,
  operador_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_desm_tenant_origem ON desmembramentos_vinculos(tenant_id, ean_origem);

CREATE TABLE IF NOT EXISTS ean_sequencias (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  ultimo_numero INTEGER NOT NULL DEFAULT 900000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ean_seq_tenant_chave ON ean_sequencias(tenant_id, chave);

CREATE TABLE IF NOT EXISTS mapas_producao (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'PRINCIPAL',
  data_mapa DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ABERTO',
  observacoes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mapas_codigo ON mapas_producao(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS mapas_producao_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mapa_id UUID NOT NULL REFERENCES mapas_producao(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  materia_prima_id UUID REFERENCES produtos(id),
  cliente_id UUID REFERENCES clientes(id),
  pedido_id UUID,
  pedido_item_id UUID,
  pedido_codigo TEXT NOT NULL DEFAULT '',
  previsao_entrega DATE,
  grupo_mapa TEXT NOT NULL DEFAULT '',
  especificacao TEXT NOT NULL DEFAULT '',
  conservacao TEXT NOT NULL DEFAULT 'RESFRIADO',
  observacao TEXT NOT NULL DEFAULT '',
  qtd_prevista_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  qtd_mp_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  qtd_realizada_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  concluido INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mpi_mapa ON mapas_producao_itens(mapa_id);

CREATE TABLE IF NOT EXISTS mapa_especificacoes_padrao (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  materia_prima_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  especificacao TEXT NOT NULL DEFAULT '',
  conservacao TEXT NOT NULL DEFAULT 'RESFRIADO',
  grupo_mapa TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mapa_espec_tenant_prod ON mapa_especificacoes_padrao(tenant_id, produto_id);

CREATE TABLE IF NOT EXISTS mapa_programacao_semanal (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  materia_prima_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  especificacao TEXT NOT NULL DEFAULT '',
  conservacao TEXT NOT NULL DEFAULT 'RESFRIADO',
  grupo_mapa TEXT NOT NULL DEFAULT '',
  qtd_meta_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  observacao TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_mapa_prog_sem ON mapa_programacao_semanal(tenant_id, filial_id, dia_semana);

CREATE TABLE IF NOT EXISTS ordens_producao (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  mapa_id UUID REFERENCES mapas_producao(id) ON DELETE SET NULL,
  codigo TEXT NOT NULL,
  nome TEXT,
  status TEXT NOT NULL DEFAULT 'ABERTA',
  operador_id UUID REFERENCES operadores(id),
  operador_nome TEXT,
  reaberta INTEGER NOT NULL DEFAULT 0,
  rendimento_pct NUMERIC(7,2),
  perda_pct NUMERIC(7,2),
  custo_mp_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  custo_embalagens NUMERIC(14,2) NOT NULL DEFAULT 0,
  custo_mo_indireto NUMERIC(14,2) NOT NULL DEFAULT 0,
  cliente TEXT NOT NULL DEFAULT 'INTERNO',
  endereco TEXT NOT NULL DEFAULT 'PRODUCAO',
  data_producao DATE,
  observacoes TEXT NOT NULL DEFAULT '',
  criado_por_id UUID,
  criado_por_nome TEXT,
  liberada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_tenant_codigo ON ordens_producao(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS op_itens_previstos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  op_id UUID NOT NULL REFERENCES ordens_producao(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  qtd_caixas_prevista NUMERIC(14,2),
  peso_kg_previsto NUMERIC(14,3),
  unidade_prevista TEXT NOT NULL DEFAULT 'KG',
  observacao TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_op_prev_op ON op_itens_previstos(op_id);

CREATE TABLE IF NOT EXISTS op_insumos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  op_id UUID NOT NULL REFERENCES ordens_producao(id) ON DELETE CASCADE,
  caixa_id UUID REFERENCES estoque_caixas(id),
  produto_id UUID REFERENCES produtos(id),
  peso_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  peso_bruto_kg NUMERIC(14,3),
  tara_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  data_producao DATE,
  lote TEXT NOT NULL DEFAULT '',
  qtd_pecas INTEGER,
  custo_unitario_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  operador_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_op_insumos_op ON op_insumos(op_id);

CREATE TABLE IF NOT EXISTS op_retornos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  op_id UUID NOT NULL REFERENCES ordens_producao(id) ON DELETE CASCADE,
  caixa_id UUID REFERENCES estoque_caixas(id),
  produto_id UUID REFERENCES produtos(id),
  peso_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  peso_bruto_kg NUMERIC(14,3),
  tara_id UUID REFERENCES taras(id),
  tara_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  data_producao DATE,
  validade DATE,
  lote TEXT NOT NULL DEFAULT '',
  qtd_pecas INTEGER,
  custo_alocado_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  preco_venda_ref_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  operador_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_op_retornos_op ON op_retornos(op_id);

CREATE TABLE IF NOT EXISTS inventario_ciclos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Ativo',
  target_pct NUMERIC(6,2) NOT NULL DEFAULT 99.90,
  data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_encerramento TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inv_ciclos_tenant ON inventario_ciclos(tenant_id);

CREATE TABLE IF NOT EXISTS inventarios (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  tipo_filtro TEXT,
  identificador_filtro TEXT,
  nome TEXT,
  tipo TEXT NOT NULL DEFAULT 'Ciclico',
  ciclo_id UUID REFERENCES inventario_ciclos(id),
  status TEXT NOT NULL DEFAULT 'Aberto',
  data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_finalizacao TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inv_tenant ON inventarios(tenant_id);

CREATE TABLE IF NOT EXISTS inventario_zonas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  inventario_id UUID NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
  nome_zona TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Aberto'
);

CREATE TABLE IF NOT EXISTS inventario_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  inventario_id UUID NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
  endereco TEXT NOT NULL,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  lote TEXT NOT NULL DEFAULT '',
  validade DATE,
  ean_caixa TEXT,
  qtd_sistema_caixas NUMERIC(14,2),
  qtd_sistema_kg NUMERIC(14,3),
  qtd_contada_caixas NUMERIC(14,2),
  qtd_contada_kg NUMERIC(14,3),
  contagem_atual INTEGER NOT NULL DEFAULT 1,
  qtd_1_caixas NUMERIC(14,2),
  qtd_1_kg NUMERIC(14,3),
  qtd_2_caixas NUMERIC(14,2),
  qtd_2_kg NUMERIC(14,3),
  qtd_3_caixas NUMERIC(14,2),
  qtd_3_kg NUMERIC(14,3),
  validade_contada DATE,
  peso_bruto_contado_kg NUMERIC(14,3),
  tara_id UUID,
  tara_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  data_producao_contada DATE,
  qtd_pecas_contada INTEGER,
  status_item TEXT NOT NULL DEFAULT 'Pendente',
  data_contagem TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_inv_itens_inv ON inventario_itens(inventario_id);

CREATE TABLE IF NOT EXISTS inventario_ajustes_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  inventario_id UUID REFERENCES inventarios(id),
  ciclo_id UUID REFERENCES inventario_ciclos(id),
  item_id UUID REFERENCES inventario_itens(id),
  produto_id UUID REFERENCES produtos(id),
  endereco TEXT,
  lote TEXT,
  custo_unitario_data NUMERIC(14,4) NOT NULL DEFAULT 0,
  qtd_ajustada_caixas NUMERIC(14,2) NOT NULL DEFAULT 0,
  qtd_ajustada_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  tipo_ajuste TEXT,
  usuario_contou_id UUID,
  usuario_aprovou_id UUID,
  usuario_aprovou_nome TEXT,
  data_ajuste TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_inbox (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  remetente_phone TEXT NOT NULL,
  remetente_nome TEXT NOT NULL DEFAULT '',
  cliente_sugerido_id UUID REFERENCES clientes(id),
  mensagem_bruta TEXT NOT NULL,
  parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confianca_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  pedido_gerado_id UUID,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wpp_tenant_status ON whatsapp_inbox(tenant_id, status);

CREATE TABLE IF NOT EXISTS pedidos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  cliente_id UUID REFERENCES clientes(id),
  cliente TEXT NOT NULL DEFAULT 'PAVAN',
  vendedor_id UUID REFERENCES vendedores(id),
  forma_pagamento_id UUID REFERENCES formas_pagamento(id),
  local_cobranca_id UUID REFERENCES locais_cobranca(id),
  natureza_id UUID REFERENCES naturezas_operacao(id),
  marchante TEXT NOT NULL DEFAULT '',
  pagamento_na_entrega INTEGER NOT NULL DEFAULT 0,
  previsao_entrega DATE,
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  observacoes TEXT NOT NULL DEFAULT '',
  origem_pedido TEXT NOT NULL DEFAULT 'SUPPLY_CHAIN',
  setor_solicitante TEXT NOT NULL DEFAULT 'SUPPLY_CHAIN',
  status TEXT NOT NULL DEFAULT 'LIBERADO',
  numero_nf TEXT NOT NULL DEFAULT '',
  chave_nfe TEXT NOT NULL DEFAULT '',
  rastreio_token TEXT,
  criado_por_id UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  liberado_at TIMESTAMPTZ,
  separado_at TIMESTAMPTZ,
  expedido_at TIMESTAMPTZ,
  cancelado_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_tenant_codigo ON pedidos(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_pedidos_tenant_status ON pedidos(tenant_id, status);

CREATE TABLE IF NOT EXISTS pedidos_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  codigo_aux TEXT NOT NULL DEFAULT '',
  qtd_kg_solicitada NUMERIC(14,3) NOT NULL DEFAULT 0,
  qtd_caixas_solicitada NUMERIC(14,2),
  unidade_solicitada TEXT NOT NULL DEFAULT 'KG',
  qtd_solicitada_exibicao NUMERIC(14,3),
  preco_unitario NUMERIC(14,4) NOT NULL DEFAULT 0,
  desconto_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  desconto_valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  cfop_aplicado TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  alerta_reclamacao TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_item_prod ON pedidos_itens(pedido_id, produto_id);

CREATE TABLE IF NOT EXISTS pedidos_parcelas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  numero_parcela INTEGER NOT NULL,
  dias_prazo INTEGER NOT NULL DEFAULT 0,
  vencimento DATE NOT NULL,
  valor NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parcelas_pedido ON pedidos_parcelas(pedido_id);

CREATE TABLE IF NOT EXISTS rotas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  regiao TEXT NOT NULL DEFAULT '',
  transportadora_id UUID REFERENCES transportadoras(id) ON DELETE SET NULL,
  veiculo_padrao TEXT NOT NULL DEFAULT '',
  dias_entrega TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS embarques (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  rota_id UUID REFERENCES rotas(id),
  transportadora_id UUID,
  tipo_veiculo_id UUID REFERENCES tipos_veiculo(id) ON DELETE SET NULL,
  capacidade_kg NUMERIC(14,2),
  tolerancia_pct NUMERIC(6,2) NOT NULL DEFAULT 10,
  horario_saida TEXT NOT NULL DEFAULT '',
  temperatura_bau NUMERIC(6,2),
  motorista_id UUID REFERENCES operadores(id),
  motorista_nome TEXT NOT NULL DEFAULT '',
  veiculo_placa TEXT NOT NULL DEFAULT '',
  modalidade_impressao TEXT NOT NULL DEFAULT 'OPCAO_B',
  qr_token TEXT,
  numero_nf_lote TEXT NOT NULL DEFAULT '',
  observacoes TEXT NOT NULL DEFAULT '',
  operador_carregamento_nome TEXT NOT NULL DEFAULT '',
  data_embarque DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANEJADO',
  iniciado_em TIMESTAMPTZ,
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_embarques_codigo ON embarques(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS romaneios (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  codigo TEXT NOT NULL,
  pedido_id UUID REFERENCES pedidos(id),
  embarque_id UUID REFERENCES embarques(id),
  cliente TEXT NOT NULL DEFAULT '',
  previsao_entrega TEXT,
  status TEXT NOT NULL DEFAULT 'MONTANDO',
  operador_id UUID,
  operador_nome TEXT,
  operador_conferencia_nome TEXT,
  operador_expedicao_nome TEXT,
  conferido_at TIMESTAMPTZ,
  expedido_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_romaneios_tenant_codigo ON romaneios(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS romaneios_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  legacy_id INTEGER,
  romaneio_id UUID NOT NULL REFERENCES romaneios(id) ON DELETE CASCADE,
  caixa_id UUID REFERENCES estoque_caixas(id),
  produto_id UUID NOT NULL REFERENCES produtos(id),
  peso_kg NUMERIC(14,3),
  conferido INTEGER NOT NULL DEFAULT 0,
  conferido_at TIMESTAMPTZ,
  conferido_por TEXT,
  carregado_veiculo INTEGER NOT NULL DEFAULT 0,
  carregado_at TIMESTAMPTZ,
  carregado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rom_itens_romaneio ON romaneios_itens(romaneio_id);

CREATE TABLE IF NOT EXISTS entregas_tracking (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  embarque_id UUID NOT NULL REFERENCES embarques(id) ON DELETE CASCADE,
  pedido_id UUID NOT NULL REFERENCES pedidos(id),
  romaneio_id UUID,
  ordem_parada INTEGER NOT NULL DEFAULT 1,
  status_entrega TEXT NOT NULL DEFAULT 'PENDENTE',
  pagamento_confirmado INTEGER NOT NULL DEFAULT 0,
  forma_pagamento_recebida TEXT NOT NULL DEFAULT '',
  valor_pago NUMERIC(14,2),
  canhoto_foto_url TEXT,
  assinatura_url TEXT,
  observacao_motorista TEXT NOT NULL DEFAULT '',
  iniciado_em TIMESTAMPTZ,
  chegou_em TIMESTAMPTZ,
  concluido_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tracking_embarque ON entregas_tracking(embarque_id);

CREATE TABLE IF NOT EXISTS pendencias_setor (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  setor_destino TEXT NOT NULL,
  tipo_pendencia TEXT NOT NULL,
  referencia_tabela TEXT NOT NULL,
  referencia_id UUID NOT NULL,
  titulo TEXT NOT NULL,
  prioridade INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  concluida_por_id UUID,
  concluida_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pendencias_setor ON pendencias_setor(tenant_id, setor_destino, status);

CREATE TABLE IF NOT EXISTS sync_operations_log (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entidade TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_op_idempotency ON sync_operations_log(tenant_id, operation_id);

CREATE TABLE IF NOT EXISTS devolucoes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  motivo TEXT NOT NULL,
  acao_estoque TEXT NOT NULL DEFAULT 'DISPONIVEL',
  endereco_destino TEXT NOT NULL DEFAULT 'REC',
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  pedido_codigo TEXT NOT NULL DEFAULT '',
  romaneio_id UUID REFERENCES romaneios(id) ON DELETE SET NULL,
  romaneio_codigo TEXT NOT NULL DEFAULT '',
  cliente_nome TEXT NOT NULL DEFAULT '',
  observacoes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'CONCLUIDA_FISICA',
  status_fiscal TEXT NOT NULL DEFAULT 'PENDENTE_FATURAMENTO',
  numero_nf_devolucao TEXT NOT NULL DEFAULT '',
  qtd_caixas INTEGER NOT NULL DEFAULT 0,
  peso_total_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  valor_estimado NUMERIC(14,2) NOT NULL DEFAULT 0,
  operador_id UUID,
  operador_nome TEXT NOT NULL DEFAULT '',
  fiscal_tratado_por_nome TEXT NOT NULL DEFAULT '',
  fiscal_tratado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_devolucoes_tenant_codigo ON devolucoes(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_devolucoes_tenant_filial ON devolucoes(tenant_id, filial_id, status_fiscal);

CREATE TABLE IF NOT EXISTS devolucao_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  devolucao_id UUID NOT NULL REFERENCES devolucoes(id) ON DELETE CASCADE,
  caixa_id UUID NOT NULL REFERENCES estoque_caixas(id),
  ean_caixa TEXT NOT NULL,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  produto_codigo TEXT NOT NULL DEFAULT '',
  produto_descricao TEXT NOT NULL DEFAULT '',
  lote TEXT NOT NULL DEFAULT '',
  validade DATE,
  peso_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  preco_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
  pedido_id UUID,
  pedido_codigo TEXT NOT NULL DEFAULT '',
  romaneio_id UUID,
  romaneio_codigo TEXT NOT NULL DEFAULT '',
  cliente_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dev_itens_dev ON devolucao_itens(devolucao_id);

CREATE TABLE IF NOT EXISTS financeiro_contas_bancarias (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID REFERENCES filiais(id) ON DELETE SET NULL,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'CONTA_CORRENTE',
  banco_codigo TEXT NOT NULL DEFAULT '',
  agencia TEXT NOT NULL DEFAULT '',
  conta TEXT NOT NULL DEFAULT '',
  chave_pix TEXT NOT NULL DEFAULT '',
  local_cobranca_id UUID REFERENCES locais_cobranca(id) ON DELETE SET NULL,
  saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_atual NUMERIC(14,2) NOT NULL DEFAULT 0,
  padrao INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_contas_tenant_cod ON financeiro_contas_bancarias(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_fin_contas_tenant ON financeiro_contas_bancarias(tenant_id, ativo);

CREATE TABLE IF NOT EXISTS financeiro_titulos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'MANUAL',
  descricao TEXT NOT NULL,
  numero_documento TEXT NOT NULL DEFAULT '',
  parcela_num INTEGER NOT NULL DEFAULT 1,
  parcela_total INTEGER NOT NULL DEFAULT 1,
  fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  pedido_compra_id UUID REFERENCES pedidos_compra(id) ON DELETE SET NULL,
  recebimento_id UUID REFERENCES recebimentos(id) ON DELETE SET NULL,
  pedido_venda_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  centro_custo_id UUID REFERENCES centros_custo(id) ON DELETE SET NULL,
  forma_pagamento_id UUID REFERENCES formas_pagamento(id) ON DELETE SET NULL,
  conta_bancaria_id UUID REFERENCES financeiro_contas_bancarias(id) ON DELETE SET NULL,
  data_emissao DATE NOT NULL,
  data_vencimento DATE NOT NULL,
  data_pagamento DATE,
  valor_original NUMERIC(14,2) NOT NULL,
  valor_desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_juros_multa NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_pago NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_aberto NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'ABERTO',
  forma_pagamento_efetiva TEXT NOT NULL DEFAULT '',
  observacoes TEXT NOT NULL DEFAULT '',
  criado_por_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  criado_por_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_titulos_tenant_cod ON financeiro_titulos(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_tipo_status_venc ON financeiro_titulos(tenant_id, tipo, status, data_vencimento);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_cliente ON financeiro_titulos(tenant_id, cliente_id, status);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_fornecedor ON financeiro_titulos(tenant_id, fornecedor_id, status);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_pedido_venda ON financeiro_titulos(tenant_id, pedido_venda_id);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_pedido_compra ON financeiro_titulos(tenant_id, pedido_compra_id);
CREATE INDEX IF NOT EXISTS idx_fin_titulos_recebimento ON financeiro_titulos(tenant_id, recebimento_id);

CREATE TABLE IF NOT EXISTS financeiro_movimentacoes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES financeiro_contas_bancarias(id) ON DELETE CASCADE,
  titulo_id UUID REFERENCES financeiro_titulos(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'LANCAMENTO_AVULSO',
  data_movimento DATE NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  forma_pagamento TEXT NOT NULL DEFAULT '',
  historico TEXT NOT NULL,
  ofx_fitid TEXT NOT NULL DEFAULT '',
  ofx_memo TEXT NOT NULL DEFAULT '',
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_mov_conta_data ON financeiro_movimentacoes(tenant_id, conta_bancaria_id, data_movimento);
CREATE INDEX IF NOT EXISTS idx_fin_mov_titulo ON financeiro_movimentacoes(titulo_id);

CREATE TABLE IF NOT EXISTS fiscal_config_filial (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  ambiente TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
  provedor TEXT NOT NULL DEFAULT 'SIMULACAO_LOCAL',
  serie_nfe INTEGER NOT NULL DEFAULT 1,
  proximo_numero_nfe INTEGER NOT NULL DEFAULT 1,
  serie_nfce INTEGER NOT NULL DEFAULT 1,
  proximo_numero_nfce INTEGER NOT NULL DEFAULT 1,
  csc_id TEXT NOT NULL DEFAULT '',
  csc_token TEXT NOT NULL DEFAULT '',
  certificado_nome TEXT NOT NULL DEFAULT '',
  certificado_pfx_base64 TEXT NOT NULL DEFAULT '',
  certificado_senha_enc TEXT NOT NULL DEFAULT '',
  certificado_validade DATE,
  certificado_titular TEXT NOT NULL DEFAULT '',
  certificado_cnpj TEXT NOT NULL DEFAULT '',
  gateway_api_token_enc TEXT NOT NULL DEFAULT '',
  inf_complementar_padrao TEXT NOT NULL DEFAULT 'ICMS com redução de base de cálculo (Cesta Básica Carnes). PIS/COFINS alíquota zero conforme Lei 10.925/2004.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_cfg_tenant_filial ON fiscal_config_filial(tenant_id, filial_id);

CREATE TABLE IF NOT EXISTS fiscal_notas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  modelo TEXT NOT NULL DEFAULT '55',
  tipo_operacao TEXT NOT NULL DEFAULT 'SAIDA',
  finalidade TEXT NOT NULL DEFAULT '1',
  ambiente TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
  provedor_usado TEXT NOT NULL DEFAULT 'SIMULACAO_LOCAL',
  serie INTEGER NOT NULL DEFAULT 1,
  numero INTEGER NOT NULL,
  chave_acesso TEXT NOT NULL,
  protocolo_autorizacao TEXT NOT NULL DEFAULT '',
  data_autorizacao TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'AUTORIZADA',
  natureza_operacao TEXT NOT NULL DEFAULT 'VENDA DE MERCADORIA',
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  devolucao_id UUID REFERENCES devolucoes(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  destinatario_nome TEXT NOT NULL DEFAULT 'CONSUMIDOR FINAL',
  destinatario_doc TEXT NOT NULL DEFAULT '',
  destinatario_ie TEXT NOT NULL DEFAULT '',
  destinatario_uf TEXT NOT NULL DEFAULT 'SP',
  destinatario_cidade TEXT NOT NULL DEFAULT '',
  destinatario_endereco TEXT NOT NULL DEFAULT '',
  forma_pagamento_label TEXT NOT NULL DEFAULT '99 - Outros',
  valor_produtos NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_desconto NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_frete NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_icms_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_icms NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_icms_st NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_pis NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_cofins NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_ibs NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_cbs NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total_nf NUMERIC(14,2) NOT NULL DEFAULT 0,
  mod_frete TEXT NOT NULL DEFAULT '0',
  transportadora_id UUID REFERENCES transportadoras(id) ON DELETE SET NULL,
  transportadora_nome TEXT NOT NULL DEFAULT '',
  transportadora_doc TEXT NOT NULL DEFAULT '',
  transportadora_ie TEXT NOT NULL DEFAULT '',
  transportadora_endereco TEXT NOT NULL DEFAULT '',
  transportadora_cidade TEXT NOT NULL DEFAULT '',
  transportadora_uf TEXT NOT NULL DEFAULT '',
  transportadora_antt TEXT NOT NULL DEFAULT '',
  veiculo_placa TEXT NOT NULL DEFAULT '',
  veiculo_uf TEXT NOT NULL DEFAULT '',
  especie_volumes TEXT NOT NULL DEFAULT 'CAIXA',
  peso_bruto_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  peso_liquido_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  qtd_volumes INTEGER NOT NULL DEFAULT 0,
  duplicatas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  vendedor_nome TEXT NOT NULL DEFAULT '',
  condicao_pagamento_label TEXT NOT NULL DEFAULT '',
  itens_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  xml_conteudo TEXT NOT NULL DEFAULT '',
  xml_cancelamento TEXT NOT NULL DEFAULT '',
  motivo_cancelamento TEXT NOT NULL DEFAULT '',
  cancelada_em TIMESTAMPTZ,
  inf_complementar TEXT NOT NULL DEFAULT '',
  emitida_por_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  emitida_por_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_nota_num ON fiscal_notas(tenant_id, filial_id, modelo, serie, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_nota_chave ON fiscal_notas(tenant_id, chave_acesso);
CREATE INDEX IF NOT EXISTS idx_fiscal_nota_status ON fiscal_notas(tenant_id, filial_id, modelo, status);
CREATE INDEX IF NOT EXISTS idx_fiscal_nota_pedido ON fiscal_notas(tenant_id, pedido_id);

CREATE TABLE IF NOT EXISTS fiscal_eventos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  nota_id UUID REFERENCES fiscal_notas(id) ON DELETE CASCADE,
  tipo_evento TEXT NOT NULL,
  sequencia INTEGER NOT NULL DEFAULT 1,
  modelo TEXT NOT NULL DEFAULT '55',
  serie INTEGER NOT NULL DEFAULT 1,
  numero_inicial INTEGER NOT NULL DEFAULT 0,
  numero_final INTEGER NOT NULL DEFAULT 0,
  descricao TEXT NOT NULL,
  protocolo TEXT NOT NULL DEFAULT '',
  xml_evento TEXT NOT NULL DEFAULT '',
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fiscal_ev_nota ON fiscal_eventos(nota_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_ev_tenant ON fiscal_eventos(tenant_id, filial_id, tipo_evento);
`

const POST_MIGRATIONS_SQL = `
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origem_pedido TEXT NOT NULL DEFAULT 'SUPPLY_CHAIN';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS setor_solicitante TEXT NOT NULL DEFAULT 'SUPPLY_CHAIN';
ALTER TABLE rotas ADD COLUMN IF NOT EXISTS transportadora_id UUID REFERENCES transportadoras(id) ON DELETE SET NULL;
ALTER TABLE rotas ADD COLUMN IF NOT EXISTS veiculo_padrao TEXT NOT NULL DEFAULT '';
ALTER TABLE rotas ADD COLUMN IF NOT EXISTS dias_entrega TEXT NOT NULL DEFAULT '';
ALTER TABLE mapas_producao ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT '';
ALTER TABLE mapas_producao ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'PRINCIPAL';
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS pedido_id UUID;
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS pedido_item_id UUID;
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS pedido_codigo TEXT NOT NULL DEFAULT '';
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS previsao_entrega DATE;
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS grupo_mapa TEXT NOT NULL DEFAULT '';
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS observacao TEXT NOT NULL DEFAULT '';
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS qtd_realizada_kg NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE mapas_producao_itens ADD COLUMN IF NOT EXISTS concluido INTEGER NOT NULL DEFAULT 0;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS transportadora_id UUID;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS motorista_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS modalidade_impressao TEXT NOT NULL DEFAULT 'OPCAO_B';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS numero_nf_lote TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS observacoes TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS operador_carregamento_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS iniciado_em TIMESTAMPTZ;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ;
ALTER TABLE romaneios_itens ADD COLUMN IF NOT EXISTS carregado_veiculo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE romaneios_itens ADD COLUMN IF NOT EXISTS carregado_at TIMESTAMPTZ;
ALTER TABLE romaneios_itens ADD COLUMN IF NOT EXISTS carregado_por TEXT;
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS romaneio_id UUID;
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS forma_pagamento_recebida TEXT NOT NULL DEFAULT '';
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS valor_pago NUMERIC(14,2);
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS iniciado_em TIMESTAMPTZ;
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS chegou_em TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS numero_nf TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chave_nfe TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS tipo_veiculo_id UUID REFERENCES tipos_veiculo(id) ON DELETE SET NULL;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS capacidade_kg NUMERIC(14,2);
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS tolerancia_pct NUMERIC(6,2) NOT NULL DEFAULT 10;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS horario_saida TEXT NOT NULL DEFAULT '';
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS temperatura_bau NUMERIC(6,2);
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS forma_pagamento_id UUID REFERENCES formas_pagamento(id);
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS serie_nf TEXT NOT NULL DEFAULT '';
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS data_emissao_nf DATE;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS valor_produtos_nf NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS valor_frete_nf NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS valor_outras_desp_nf NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS valor_desconto_nf NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS valor_total_nf NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS xml_itens_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS xml_duplicatas_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS xml_conteudo TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos_compra_itens ADD COLUMN IF NOT EXISTS temperatura_c NUMERIC(6,2);
ALTER TABLE pedidos_compra_itens ADD COLUMN IF NOT EXISTS temperatura_registrada_em TIMESTAMPTZ;
ALTER TABLE pedidos_compra_itens ADD COLUMN IF NOT EXISTS temperatura_registrada_por TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_pre_caixas_forn_status ON recebimento_pre_caixas(tenant_id, fornecedor_id, status);
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS endereco TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS numero TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS complemento TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS bairro TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cep TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cnae_principal TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS regime_apuracao TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS situacao_cadastral TEXT NOT NULL DEFAULT '';
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS inativado_em TIMESTAMPTZ;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS inativado_em TIMESTAMPTZ;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE fornecedores SET inativado_em = COALESCE(inativado_em, created_at) WHERE ativo = 0 AND inativado_em IS NULL;
UPDATE clientes SET inativado_em = COALESCE(inativado_em, created_at) WHERE ativo = 0 AND inativado_em IS NULL;
ALTER TABLE pedidos_compra ALTER COLUMN fornecedor_id DROP NOT NULL;
ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS ofx_fitid TEXT NOT NULL DEFAULT '';
ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS ofx_memo TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_fin_mov_ofx_fitid ON financeiro_movimentacoes(tenant_id, conta_bancaria_id, ofx_fitid);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS registro_dipoa TEXT NOT NULL DEFAULT '';
ALTER TABLE transportadoras ADD COLUMN IF NOT EXISTS endereco TEXT NOT NULL DEFAULT '';
ALTER TABLE transportadoras ADD COLUMN IF NOT EXISTS numero TEXT NOT NULL DEFAULT '';
ALTER TABLE transportadoras ADD COLUMN IF NOT EXISTS bairro TEXT NOT NULL DEFAULT '';
ALTER TABLE transportadoras ADD COLUMN IF NOT EXISTS cep TEXT NOT NULL DEFAULT '';
ALTER TABLE transportadoras ADD COLUMN IF NOT EXISTS rntrc_antt TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS valor_ibs NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS valor_cbs NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS mod_frete TEXT NOT NULL DEFAULT '0';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_id UUID REFERENCES transportadoras(id) ON DELETE SET NULL;
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_doc TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_ie TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_endereco TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_cidade TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_uf TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS transportadora_antt TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS veiculo_placa TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS veiculo_uf TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS especie_volumes TEXT NOT NULL DEFAULT 'CAIXA';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS duplicatas_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS vendedor_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE fiscal_notas ADD COLUMN IF NOT EXISTS condicao_pagamento_label TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS observacao_nf TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS tipo_compra TEXT NOT NULL DEFAULT 'MATERIA_PRIMA';
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS tipo_entrada TEXT NOT NULL DEFAULT 'COMPRA_ESTOQUE';
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS centro_custo_id UUID REFERENCES centros_custo(id) ON DELETE SET NULL;
ALTER TABLE recebimentos ADD COLUMN IF NOT EXISTS categoria_dre TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS varejo_estoque (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  unidade_venda TEXT NOT NULL DEFAULT 'KG',
  saldo_qtd NUMERIC(14,3) NOT NULL DEFAULT 0,
  preco_venda_varejo NUMERIC(14,4) NOT NULL DEFAULT 0,
  estoque_minimo NUMERIC(14,3) NOT NULL DEFAULT 0,
  codigo_balanca TEXT NOT NULL DEFAULT '',
  setor_loja TEXT NOT NULL DEFAULT 'ACOUGUE',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_varejo_est_filial_prod ON varejo_estoque(tenant_id, filial_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_varejo_est_balanca ON varejo_estoque(tenant_id, filial_id, codigo_balanca);

CREATE TABLE IF NOT EXISTS varejo_movimentacoes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  qtd NUMERIC(14,3) NOT NULL,
  saldo_anterior NUMERIC(14,3) NOT NULL DEFAULT 0,
  saldo_novo NUMERIC(14,3) NOT NULL DEFAULT 0,
  referencia_tipo TEXT NOT NULL DEFAULT '',
  referencia_id UUID,
  observacao TEXT NOT NULL DEFAULT '',
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT 'Sistema',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_varejo_mov_filial_data ON varejo_movimentacoes(tenant_id, filial_id, created_at);

CREATE TABLE IF NOT EXISTS pdv_caixas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  conta_bancaria_id UUID REFERENCES financeiro_contas_bancarias(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ABERTO',
  saldo_abertura NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_vendas NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_dinheiro NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_pix NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_debito NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_credito NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_suprimentos NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_sangrias NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_esperado_dinheiro NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_informado_fechamento NUMERIC(14,2),
  diferenca_quebra NUMERIC(14,2),
  observacoes TEXT NOT NULL DEFAULT '',
  aberto_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fechado_em TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdv_caixas_codigo ON pdv_caixas(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_pdv_caixas_filial_status ON pdv_caixas(tenant_id, filial_id, status);

CREATE TABLE IF NOT EXISTS pdv_caixa_movimentos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  caixa_id UUID NOT NULL REFERENCES pdv_caixas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pdv_cx_mov_caixa ON pdv_caixa_movimentos(caixa_id);

CREATE TABLE IF NOT EXISTS pdv_vendas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  caixa_id UUID NOT NULL REFERENCES pdv_caixas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome TEXT NOT NULL DEFAULT 'CONSUMIDOR FINAL',
  cliente_doc TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  desconto_valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  troco_valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  pagamentos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  itens_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'CONCLUIDA',
  nota_fiscal_id UUID REFERENCES fiscal_notas(id) ON DELETE SET NULL,
  numero_nfce INTEGER,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  motivo_cancelamento TEXT NOT NULL DEFAULT '',
  cancelada_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdv_vendas_codigo ON pdv_vendas(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_pdv_vendas_caixa ON pdv_vendas(caixa_id);

CREATE TABLE IF NOT EXISTS varejo_inventarios (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ABERTO',
  total_itens INTEGER NOT NULL DEFAULT 0,
  total_divergencias INTEGER NOT NULL DEFAULT 0,
  itens_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_varejo_inv_codigo ON varejo_inventarios(tenant_id, codigo);

CREATE TABLE IF NOT EXISTS interunidades_movimentacoes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  tipo_operacao TEXT NOT NULL,
  filial_origem_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  filial_destino_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  caixa_id UUID REFERENCES estoque_caixas(id) ON DELETE SET NULL,
  ean_caixa TEXT NOT NULL DEFAULT '',
  produto_id UUID NOT NULL REFERENCES produtos(id),
  produto_codigo TEXT NOT NULL DEFAULT '',
  produto_descricao TEXT NOT NULL DEFAULT '',
  especie TEXT NOT NULL DEFAULT 'OUTROS',
  peso_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  valor_unitario_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  op_id UUID REFERENCES ordens_producao(id) ON DELETE SET NULL,
  requer_faturamento INTEGER NOT NULL DEFAULT 1,
  status_fiscal TEXT NOT NULL DEFAULT 'PENDENTE',
  nota_fiscal_id UUID REFERENCES fiscal_notas(id) ON DELETE SET NULL,
  numero_nf INTEGER,
  data_movimento DATE NOT NULL,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  observacao TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_interunid_codigo ON interunidades_movimentacoes(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_interunid_tipo_status ON interunidades_movimentacoes(tenant_id, tipo_operacao, status_fiscal, data_movimento);

CREATE TABLE IF NOT EXISTS insumos_estoque (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  endereco_codigo TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'UN',
  saldo_atual NUMERIC(14,3) NOT NULL DEFAULT 0,
  estoque_minimo NUMERIC(14,3) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insumos_est_endereco ON insumos_estoque(tenant_id, filial_id, endereco_codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insumos_est_produto ON insumos_estoque(tenant_id, filial_id, produto_id);

CREATE TABLE IF NOT EXISTS insumos_coletas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  insumo_estoque_id UUID NOT NULL REFERENCES insumos_estoque(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  endereco_codigo TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'COLETA_MANUAL',
  quantidade NUMERIC(14,3) NOT NULL,
  saldo_anterior NUMERIC(14,3) NOT NULL DEFAULT 0,
  saldo_novo NUMERIC(14,3) NOT NULL DEFAULT 0,
  centro_custo_id UUID REFERENCES centros_custo(id) ON DELETE SET NULL,
  setor_destino TEXT NOT NULL DEFAULT 'PRODUCAO',
  custo_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  observacao TEXT NOT NULL DEFAULT '',
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insumos_coletas_filial_data ON insumos_coletas(tenant_id, filial_id, created_at);

ALTER TABLE operadores ADD COLUMN IF NOT EXISTS filiais_permitidas_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS especie TEXT NOT NULL DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS conservacao TEXT NOT NULL DEFAULT 'RESFRIADO';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS validade_dias INTEGER NOT NULL DEFAULT 5;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tara_embalagem_kg NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS rg TEXT NOT NULL DEFAULT '';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_cliente TEXT NOT NULL DEFAULT 'AMBOS';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS crediario_ativo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS prazo_crediario_dias INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS desconto_ativo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS desconto_max_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE estoque_caixas ADD COLUMN IF NOT EXISTS peso_restante_kg NUMERIC(14,3);
ALTER TABLE estoque_caixas ADD COLUMN IF NOT EXISTS entrada_acougue_em TIMESTAMPTZ;
ALTER TABLE estoque_caixas ADD COLUMN IF NOT EXISTS entrada_acougue_por TEXT NOT NULL DEFAULT '';
ALTER TABLE estoque_caixas ADD COLUMN IF NOT EXISTS quebra_acougue_kg NUMERIC(14,3);
ALTER TABLE pdv_caixas ADD COLUMN IF NOT EXISTS total_crediario NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS desconto_tipo TEXT NOT NULL DEFAULT 'VALOR';
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS desconto_pct NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS crediario_valor NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS titulo_receber_id UUID;
ALTER TABLE pdv_vendas ADD COLUMN IF NOT EXISTS vencimento_crediario DATE;
ALTER TABLE varejo_inventarios ADD COLUMN IF NOT EXISTS tipo_inventario TEXT NOT NULL DEFAULT 'EMPORIO_CEGO';
ALTER TABLE varejo_inventarios ADD COLUMN IF NOT EXISTS liberado_operador INTEGER NOT NULL DEFAULT 1;
ALTER TABLE varejo_inventarios ADD COLUMN IF NOT EXISTS etiquetas_bipadas_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE varejo_inventarios ADD COLUMN IF NOT EXISTS mps_pesadas_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS etiquetas_acougue (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo_etiqueta TEXT NOT NULL,
  produto_id UUID NOT NULL REFERENCES produtos(id),
  produto_codigo TEXT NOT NULL DEFAULT '',
  produto_descricao TEXT NOT NULL DEFAULT '',
  especie TEXT NOT NULL DEFAULT 'OUTROS',
  conservacao TEXT NOT NULL DEFAULT 'RESFRIADO',
  caixa_mp_id UUID REFERENCES estoque_caixas(id) ON DELETE SET NULL,
  ean_mp_origem TEXT NOT NULL DEFAULT '',
  peso_bruto_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  tara_kg NUMERIC(10,4) NOT NULL DEFAULT 0,
  peso_liquido_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  preco_kg NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  lote TEXT NOT NULL DEFAULT '',
  data_pesagem DATE NOT NULL,
  validade DATE,
  payload_qr TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'EM_ESTOQUE',
  venda_pdv_id UUID REFERENCES pdv_vendas(id) ON DELETE SET NULL,
  vendida_em TIMESTAMPTZ,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_etq_acougue_codigo ON etiquetas_acougue(tenant_id, codigo_etiqueta);
CREATE INDEX IF NOT EXISTS idx_etq_acougue_filial_status ON etiquetas_acougue(tenant_id, filial_id, status);
CREATE INDEX IF NOT EXISTS idx_etq_acougue_mp ON etiquetas_acougue(caixa_mp_id);

ALTER TABLE operadores ADD COLUMN IF NOT EXISTS pin_gerencial_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS produto_especificacoes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  especie TEXT NOT NULL DEFAULT 'BOVINO',
  conservacao TEXT NOT NULL DEFAULT 'RESFRIADO',
  temperatura_rotulo TEXT NOT NULL DEFAULT '',
  validade_dias_padrao INTEGER,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_espec_tenant_cod ON produto_especificacoes(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_prod_espec_tenant ON produto_especificacoes(tenant_id, ativo);

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS especificacao_id UUID REFERENCES produto_especificacoes(id) ON DELETE SET NULL;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ultimo_preco_compra NUMERIC(14,4) NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fator_conversao_compra NUMERIC(10,3) NOT NULL DEFAULT 1;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tabela_preco_id UUID;

CREATE TABLE IF NOT EXISTS tabelas_preco (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID REFERENCES filiais(id) ON DELETE SET NULL,
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  finalidade TEXT NOT NULL DEFAULT 'VAREJO_PDV',
  padrao INTEGER NOT NULL DEFAULT 0,
  desconto_padrao_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  data_inicio DATE,
  data_fim DATE,
  observacoes TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tabelas_preco_codigo ON tabelas_preco(tenant_id, codigo);
CREATE INDEX IF NOT EXISTS idx_tabelas_preco_finalidade ON tabelas_preco(tenant_id, finalidade, ativo);

CREATE TABLE IF NOT EXISTS tabelas_preco_itens (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tabela_preco_id UUID NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  preco_venda NUMERIC(14,4) NOT NULL DEFAULT 0,
  preco_promocional NUMERIC(14,4),
  desconto_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tabela_preco_item_prod ON tabelas_preco_itens(tabela_preco_id, produto_id);
CREATE INDEX IF NOT EXISTS idx_tabela_preco_itens_tab ON tabelas_preco_itens(tenant_id, tabela_preco_id);

CREATE TABLE IF NOT EXISTS acougue_config_filial (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  tabela_ativa_id UUID REFERENCES tabelas_preco(id) ON DELETE SET NULL,
  tabela_padrao_id UUID REFERENCES tabelas_preco(id) ON DELETE SET NULL,
  alterada_por_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  alterada_por_nome TEXT NOT NULL DEFAULT '',
  alterada_em TIMESTAMPTZ,
  motivo TEXT NOT NULL DEFAULT '',
  historico_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acougue_cfg_filial ON acougue_config_filial(tenant_id, filial_id);

-- Etapa 4: App Motorista PWA (Checklist Pré-Viagem, Comprovante Digital POD, Assinatura, Recusa Parcial & GPS)
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS checklist_saida_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS ultima_lat NUMERIC(10,7);
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS ultima_lng NUMERIC(10,7);
ALTER TABLE embarques ADD COLUMN IF NOT EXISTS ultima_localizacao_em TIMESTAMPTZ;
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS recebedor_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS recebedor_documento TEXT NOT NULL DEFAULT '';
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS temperatura_entrega NUMERIC(6,2);
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS motivo_recusa TEXT NOT NULL DEFAULT '';
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS itens_recusados_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS entrega_lat NUMERIC(10,7);
ALTER TABLE entregas_tracking ADD COLUMN IF NOT EXISTS entrega_lng NUMERIC(10,7);

-- Etapa 5: Comercial Atacado, Força de Vendas Mobile & Trava de Margem / Crédito
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS desconto_max_pct NUMERIC(6,2) NOT NULL DEFAULT 5;
ALTER TABLE vendedores ADD COLUMN IF NOT EXISTS margem_minima_pct NUMERIC(6,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tabela_preco_id UUID;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS custo_total_estimado NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS margem_bruta_pct NUMERIC(7,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS alerta_comercial_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aprovado_comercial_por_id UUID;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aprovado_comercial_por_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aprovado_comercial_em TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS aprovado_comercial_obs TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos_itens ADD COLUMN IF NOT EXISTS preco_tabela_ref NUMERIC(14,4);
ALTER TABLE pedidos_itens ADD COLUMN IF NOT EXISTS custo_unitario_ref NUMERIC(14,4) NOT NULL DEFAULT 0;
ALTER TABLE pedidos_itens ADD COLUMN IF NOT EXISTS margem_item_pct NUMERIC(7,2);

CREATE TABLE IF NOT EXISTS comercial_visitas (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  operador_id UUID REFERENCES operadores(id) ON DELETE SET NULL,
  operador_nome TEXT NOT NULL DEFAULT '',
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'PRESENCIAL',
  resultado TEXT NOT NULL DEFAULT 'CONTATO_REALIZADO',
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  observacoes TEXT NOT NULL DEFAULT '',
  lat NUMERIC(10,7),
  lng NUMERIC(10,7),
  proximo_contato_em DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_com_visitas_tenant_data ON comercial_visitas(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_com_visitas_vendedor ON comercial_visitas(tenant_id, vendedor_id);
CREATE INDEX IF NOT EXISTS idx_com_visitas_cliente ON comercial_visitas(tenant_id, cliente_id);
`

export interface SeedDefaultsResult {
  tenantId: string
  empresaId: string
  filialIds: { estoque: string; acougue: string; industrializacao: string }
}

async function backfillCodigosEIndicesUnicos(conn: DbConnection): Promise<void> {
  const tabelas: Array<{ nome: 'fornecedores' | 'clientes' | 'transportadoras'; idx: string }> = [
    { nome: 'fornecedores', idx: 'uq_fornecedores_tenant_codigo' },
    { nome: 'clientes', idx: 'uq_clientes_tenant_codigo' },
    { nome: 'transportadoras', idx: 'uq_transportadoras_tenant_codigo' },
  ]

  for (const tb of tabelas) {
    const rows = await conn.queryRaw<{ id: string; tenant_id: string; codigo: string | null }>(
      `SELECT id, tenant_id, codigo FROM ${tb.nome} ORDER BY created_at ASC, id ASC`,
    )
    const maxPorTenant = new Map<string, number>()
    const usadosPorTenant = new Map<string, Set<string>>()

    for (const r of rows) {
      const cod = (r.codigo || '').trim()
      if (!usadosPorTenant.has(r.tenant_id)) usadosPorTenant.set(r.tenant_id, new Set())
      if (cod && /^\d{1,12}$/.test(cod)) {
        const curMax = maxPorTenant.get(r.tenant_id) || 0
        const n = Number(cod)
        if (n > curMax) maxPorTenant.set(r.tenant_id, n)
      }
    }

    for (const r of rows) {
      const set = usadosPorTenant.get(r.tenant_id)!
      const cod = (r.codigo || '').trim()
      const keyLower = cod.toLowerCase()
      if (!cod || set.has(keyLower)) {
        let nextNum = (maxPorTenant.get(r.tenant_id) || 0) + 1
        while (set.has(String(nextNum).toLowerCase())) nextNum += 1
        maxPorTenant.set(r.tenant_id, nextNum)
        const novoCod = String(nextNum)
        set.add(novoCod.toLowerCase())
        await conn.queryRaw(`UPDATE ${tb.nome} SET codigo = $1 WHERE id = $2`, [novoCod, r.id])
      } else {
        set.add(keyLower)
        if (cod !== r.codigo) {
          await conn.queryRaw(`UPDATE ${tb.nome} SET codigo = $1 WHERE id = $2`, [cod, r.id])
        }
      }
    }

    await conn.execMulti(`CREATE UNIQUE INDEX IF NOT EXISTS ${tb.idx} ON ${tb.nome}(tenant_id, codigo);`)
  }
}

export async function runMigrationsAndSeed(conn: DbConnection): Promise<SeedDefaultsResult> {
  await conn.execMulti(SCHEMA_SQL)
  await conn.execMulti(POST_MIGRATIONS_SQL)
  await backfillCodigosEIndicesUnicos(conn)

  const { db } = conn
  const existingTenants = await db.select().from(tenants).limit(1)
  let tenantId = existingTenants[0]?.id

  if (!tenantId) {
    tenantId = uuidv7()
    await db.insert(tenants).values({
      id: tenantId,
      nomeConta: 'Operacao Principal / Lab PAVAN',
      slug: 'principal',
      plano: 'PRO',
      statusAssinatura: 'ATIVO',
      limiteUsuarios: 50,
      featuresJson: {
        wms: true,
        producao: true,
        pedidos: true,
        custos: true,
        financeiro: false,
        fiscal: false,
        pdv: false,
      },
    })
  }

  let existingEmps = await db.select().from(empresas).where(eq(empresas.tenantId, tenantId))
  let empresaId = existingEmps[0]?.id
  if (!empresaId) {
    empresaId = uuidv7()
    await db.insert(empresas).values({
      id: empresaId,
      tenantId,
      codigo: '1',
      razaoSocial: 'EMPRESA PADRAO LTDA',
      nomeFantasia: 'WMSphere Lab',
      cnpj: '',
      inscricaoEstadual: '',
      regimeTributario: 'SIMPLES',
    })
  }

  let existingFiliais = await db.select().from(filiais).where(eq(filiais.tenantId, tenantId))
  let filialEstoque = existingFiliais.find((f) => f.tipoUnidade === 'DISTRIBUICAO')?.id
  let filialAcougue = existingFiliais.find((f) => f.tipoUnidade === 'VAREJO')?.id
  let filialInd = existingFiliais.find((f) => f.tipoUnidade === 'INDUSTRIA')?.id

  if (!filialAcougue) {
    filialAcougue = uuidv7()
    await db.insert(filiais).values({
      id: filialAcougue,
      tenantId,
      empresaId,
      codigo: '1/1',
      nome: 'Unidade Varejo / Caixa Fechada',
      tipoUnidade: 'VAREJO',
      uf: 'SP',
      registroSanitarioTipo: 'SIF',
      isPadrao: 0,
    })
  }
  if (!filialEstoque) {
    filialEstoque = uuidv7()
    await db.insert(filiais).values({
      id: filialEstoque,
      tenantId,
      empresaId,
      codigo: '1/2',
      nome: 'Estoque / Distribuicao Principal',
      tipoUnidade: 'DISTRIBUICAO',
      uf: 'SP',
      registroSanitarioTipo: 'SIF',
      isPadrao: 1,
    })
  }
  if (!filialInd) {
    filialInd = uuidv7()
    await db.insert(filiais).values({
      id: filialInd,
      tenantId,
      empresaId,
      codigo: '2/1',
      nome: 'Unidade Produtiva / FG Industrializacao',
      tipoUnidade: 'INDUSTRIA',
      uf: 'SP',
      registroSanitarioTipo: 'SIF',
      isPadrao: 0,
    })
  }

  for (const perfil of PERFIS_SISTEMA_BASE) {
    await db
      .insert(perfisAcesso)
      .values({
        id: uuidv7(),
        tenantId,
        codigo: perfil.codigo,
        nome: perfil.nome,
        nivel: perfil.nivel,
        setorPadrao: perfil.setor_padrao,
        descricao: perfil.descricao,
        permissoesJson: perfil.permissoes,
        sistemaFixo: perfil.sistema_fixo,
      })
      .onConflictDoNothing()
  }

  // Seed inicial de catalogos comerciais/fiscais basicos
  const defaultFormas = [
    { codigo: 'AVISTA', descricao: 'A VISTA / PIX', dias: [0], pagEntrega: 0 },
    { codigo: '14_21', descricao: '14/21 DIAS', dias: [14, 21], pagEntrega: 0 },
    { codigo: 'ENTREGA', descricao: 'PAGAMENTO NA ENTREGA', dias: [0], pagEntrega: 1 },
  ]
  for (const fp of defaultFormas) {
    await db
      .insert(formasPagamento)
      .values({
        id: uuidv7(),
        tenantId,
        codigo: fp.codigo,
        descricao: fp.descricao,
        diasParcelasJson: fp.dias,
        pagamentoNaEntrega: fp.pagEntrega,
      })
      .onConflictDoNothing()
  }

  await db
    .insert(locaisCobranca)
    .values({ id: uuidv7(), tenantId, codigo: 'BB', nome: 'BANCO DO BRASIL' })
    .onConflictDoNothing()

  const existingContasFin = await db
    .select({ id: financeiroContasBancarias.id })
    .from(financeiroContasBancarias)
    .where(eq(financeiroContasBancarias.tenantId, tenantId))
    .limit(1)
  if (existingContasFin.length === 0) {
    const locaisList = await db
      .select()
      .from(locaisCobranca)
      .where(eq(locaisCobranca.tenantId, tenantId))
    const bbLocal = locaisList.find((l) => l.codigo === 'BB') || locaisList[0] || null
    await db
      .insert(financeiroContasBancarias)
      .values([
        {
          id: uuidv7(),
          tenantId,
          codigo: 'CX1',
          nome: 'CAIXA GERAL',
          tipo: 'CAIXA_FISICO',
          bancoCodigo: '',
          agencia: '',
          conta: '',
          chavePix: '',
          localCobrancaId: null,
          saldoInicial: '0.00',
          saldoAtual: '0.00',
          padrao: 1,
          ativo: 1,
        },
        {
          id: uuidv7(),
          tenantId,
          codigo: 'BB1',
          nome: bbLocal?.nome || 'BANCO DO BRASIL',
          tipo: 'CONTA_CORRENTE',
          bancoCodigo: '001',
          agencia: '',
          conta: '',
          chavePix: '',
          localCobrancaId: bbLocal?.id || null,
          saldoInicial: '0.00',
          saldoAtual: '0.00',
          padrao: 0,
          ativo: 1,
        },
      ])
      .onConflictDoNothing()
  }

  await db
    .insert(centrosCusto)
    .values({ id: uuidv7(), tenantId, codigo: '557', descricao: 'COMPRA DE MERCADORIA' })
    .onConflictDoNothing()

  const existingMarchantes = await db
    .select({ id: marchantes.id })
    .from(marchantes)
    .where(eq(marchantes.tenantId, tenantId))
    .limit(1)
  if (existingMarchantes.length === 0) {
    await db
      .insert(marchantes)
      .values({ id: uuidv7(), tenantId, codigo: '001', nome: 'FRIGODIL', isPadrao: 1, ativo: 1 })
      .onConflictDoNothing()
  }

  const existingTiposVeiculo = await db
    .select({ id: tiposVeiculo.id })
    .from(tiposVeiculo)
    .where(eq(tiposVeiculo.tenantId, tenantId))
    .limit(1)
  if (existingTiposVeiculo.length === 0) {
    await db.insert(tiposVeiculo).values([
      {
        id: uuidv7(),
        tenantId,
        nome: 'Carro Pequeno (Fiorino)',
        categoria: 'UTILITARIO',
        capacidadeKg: '650',
        toleranciaPct: '10',
        observacoes: 'Utilitário leve até 650 kg (máx. 715 kg com tolerância de 10%)',
        ativo: 1,
      },
      {
        id: uuidv7(),
        tenantId,
        nome: 'Carro Grande (Van)',
        categoria: 'VAN',
        capacidadeKg: '1250',
        toleranciaPct: '10',
        observacoes: 'Van / Baú médio até 1.250 kg (máx. 1.375 kg com tolerância de 10%)',
        ativo: 1,
      },
    ])
  }

  const existingLayoutsTxt = await db
    .select({ id: layoutsImportacaoTxt.id })
    .from(layoutsImportacaoTxt)
    .where(eq(layoutsImportacaoTxt.tenantId, tenantId))
    .limit(1)
  if (existingLayoutsTxt.length === 0) {
    await db.insert(layoutsImportacaoTxt).values({
      id: uuidv7(),
      tenantId,
      fornecedorId: null,
      nome: 'Paula & Ribeiro / Frigodil (12 colunas ;)',
      tipoArquivo: 'DELIMITADO',
      delimitador: ';',
      saltarLinhas: 0,
      formatoData: 'DDMMYYYY',
      decimalPonto: 0,
      mapeamentoJson: {
        origem_texto: 1,
        romaneio_origem: 2,
        ean: 3,
        codigo_produto: 4,
        descricao_produto: 5,
        peso_liquido: 6,
        qtd_pecas: 7,
        data_producao: 8,
        data_validade: 9,
        documento_origem: 10,
      },
      ativo: 1,
    })
  }

  const existingNat = await db.select().from(naturezasOperacao).where(eq(naturezasOperacao.tenantId, tenantId))
  if (existingNat.length === 0) {
    await db.insert(naturezasOperacao).values([
      {
        id: uuidv7(),
        tenantId,
        tipoMovimento: 'ENTRADA',
        finalidade: 'REVENDA',
        descricao: 'COMPRA PARA COMERCIALIZACAO',
        cfopEstadual: '1102',
        cfopInterestadual: '2102',
        codigoSubOperacao: '03',
      },
      {
        id: uuidv7(),
        tenantId,
        tipoMovimento: 'SAIDA',
        finalidade: 'REVENDA',
        descricao: 'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS',
        cfopEstadual: '5102',
        cfopInterestadual: '6102',
        codigoSubOperacao: '01',
      },
      {
        id: uuidv7(),
        tenantId,
        tipoMovimento: 'INDUSTRIALIZACAO',
        finalidade: 'REMESSA_IND',
        descricao: 'REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA',
        cfopEstadual: '5901',
        cfopInterestadual: '6901',
        codigoSubOperacao: '01',
      },
    ])
  }

  await db
    .insert(eanSequencias)
    .values({ id: uuidv7(), tenantId, chave: 'CAIXA_INTERNA', ultimoNumero: 900000 })
    .onConflictDoNothing()

  // Seed da conta MASTER Luciano se ainda nao existir operador MASTER neste tenant
  const masterRows = await db
    .select({ id: operadores.id })
    .from(operadores)
    .where(sql`${operadores.tenantId} = ${tenantId} AND UPPER(${operadores.nivel}) = 'MASTER'`)
    .limit(1)

  if (masterRows.length === 0) {
    const hash7410 = await hashSenha('7410')
    const hashPin1234 = await hashSenha('1234')
    const masterPerms = PERFIS_SISTEMA_BASE.find((p) => p.codigo === 'MASTER')!.permissoes
    await db.insert(operadores).values({
      id: uuidv7(),
      tenantId,
      empresaId,
      filialPadraoId: filialEstoque,
      nome: 'Luciano',
      login: 'Luciano',
      pin: '****',
      pinGerencialHash: hashPin1234,
      senhaHash: hash7410,
      perfil: 'MASTER',
      nivel: 'MASTER',
      setor: 'Diretoria / Master',
      isAdm: 1,
      ativo: 1,
      deveTrocarSenha: 1,
      permissoesJson: masterPerms,
      criadoPorNome: 'Sistema',
    })
  } else {
    // Garante PIN gerencial 1234 no MASTER se ainda não definido
    const mastersSemPin = await db
      .select({ id: operadores.id })
      .from(operadores)
      .where(sql`${operadores.tenantId} = ${tenantId} AND UPPER(${operadores.nivel}) = 'MASTER' AND COALESCE(${operadores.pinGerencialHash}, '') = ''`)
    if (mastersSemPin.length > 0) {
      const hashPin1234 = await hashSenha('1234')
      for (const m of mastersSemPin) {
        await db.update(operadores).set({ pinGerencialHash: hashPin1234 }).where(eq(operadores.id, m.id))
      }
    }
  }

  // Seed idempotente das 12 Especificações de Produto (Denominação de Venda para Rótulos 100x70)
  const especsBase = [
    { codigo: 'ESP-BOV-RES-SO', nome: 'CARNE RESFRIADA DE BOVINO SEM OSSO', especie: 'BOVINO', conservacao: 'RESFRIADO', temp: 'MANTER RESFRIADO DE 0°C A 4°C', dias: 45 },
    { codigo: 'ESP-BOV-RES-CO', nome: 'CARNE RESFRIADA DE BOVINO COM OSSO', especie: 'BOVINO', conservacao: 'RESFRIADO', temp: 'MANTER RESFRIADO DE 0°C A 4°C', dias: 30 },
    { codigo: 'ESP-BOV-CON-SO', nome: 'CARNE CONGELADA DE BOVINO SEM OSSO', especie: 'BOVINO', conservacao: 'CONGELADO', temp: 'MANTER CONGELADO A -18°C OU MAIS FRIO', dias: 365 },
    { codigo: 'ESP-BOV-CON-CO', nome: 'CARNE CONGELADA DE BOVINO COM OSSO', especie: 'BOVINO', conservacao: 'CONGELADO', temp: 'MANTER CONGELADO A -18°C OU MAIS FRIO', dias: 365 },
    { codigo: 'ESP-SUI-RES-SO', nome: 'CARNE RESFRIADA DE SUÍNO SEM OSSO', especie: 'SUINO', conservacao: 'RESFRIADO', temp: 'MANTER RESFRIADO DE 0°C A 4°C', dias: 20 },
    { codigo: 'ESP-SUI-RES-CO', nome: 'CARNE RESFRIADA DE SUÍNO COM OSSO', especie: 'SUINO', conservacao: 'RESFRIADO', temp: 'MANTER RESFRIADO DE 0°C A 4°C', dias: 15 },
    { codigo: 'ESP-SUI-CON-SO', nome: 'CARNE CONGELADA DE SUÍNO SEM OSSO', especie: 'SUINO', conservacao: 'CONGELADO', temp: 'MANTER CONGELADO A -18°C OU MAIS FRIO', dias: 365 },
    { codigo: 'ESP-SUI-CON-CO', nome: 'CARNE CONGELADA DE SUÍNO COM OSSO', especie: 'SUINO', conservacao: 'CONGELADO', temp: 'MANTER CONGELADO A -18°C OU MAIS FRIO', dias: 365 },
    { codigo: 'ESP-AVE-RES-SO', nome: 'CARNE RESFRIADA DE AVES SEM OSSO', especie: 'AVES', conservacao: 'RESFRIADO', temp: 'MANTER RESFRIADO DE 0°C A 4°C', dias: 10 },
    { codigo: 'ESP-AVE-RES-CO', nome: 'CARNE RESFRIADA DE AVES COM OSSO', especie: 'AVES', conservacao: 'RESFRIADO', temp: 'MANTER RESFRIADO DE 0°C A 4°C', dias: 10 },
    { codigo: 'ESP-AVE-CON-SO', nome: 'CARNE CONGELADA DE AVES SEM OSSO', especie: 'AVES', conservacao: 'CONGELADO', temp: 'MANTER CONGELADO A -18°C OU MAIS FRIO', dias: 365 },
    { codigo: 'ESP-AVE-CON-CO', nome: 'CARNE CONGELADA DE AVES COM OSSO', especie: 'AVES', conservacao: 'CONGELADO', temp: 'MANTER CONGELADO A -18°C OU MAIS FRIO', dias: 365 },
  ]
  for (const esp of especsBase) {
    await db
      .insert(produtoEspecificacoes)
      .values({
        id: uuidv7(),
        tenantId,
        codigo: esp.codigo,
        nome: esp.nome,
        especie: esp.especie,
        conservacao: esp.conservacao,
        temperaturaRotulo: esp.temp,
        validadeDiasPadrao: esp.dias,
        ativo: 1,
      })
      .onConflictDoNothing()
  }

  // Seed idempotente das Tabelas de Preço padrão + importação dos preços já cadastrados no banco
  const existingTabs = await db
    .select({ id: tabelasPreco.id, codigo: tabelasPreco.codigo })
    .from(tabelasPreco)
    .where(eq(tabelasPreco.tenantId, tenantId))

  let tabPadraoId = existingTabs.find((t) => t.codigo === 'TAB-001')?.id || existingTabs[0]?.id || ''
  if (existingTabs.length === 0) {
    tabPadraoId = uuidv7()
    const tabPromoId = uuidv7()
    await db.insert(tabelasPreco).values([
      {
        id: tabPadraoId,
        tenantId,
        filialId: filialAcougue,
        codigo: 'TAB-001',
        nome: 'Tabela Padrão Varejo & Açougue',
        finalidade: 'ACOUGUE_BALANCA',
        padrao: 1,
        descontoPadraoPct: '0.00',
        observacoes: 'Tabela padrão ativa na balança do Açougue e PDV',
        ativo: 1,
      },
      {
        id: tabPromoId,
        tenantId,
        filialId: filialAcougue,
        codigo: 'TAB-002',
        nome: 'Promoção Fim de Semana (-10%)',
        finalidade: 'PROMOCIONAL',
        padrao: 0,
        descontoPadraoPct: '10.00',
        observacoes: 'Tabela promocional pronta para troca rápida mediante PIN gerencial',
        ativo: 1,
      },
    ])

    // Popula TAB-001 e TAB-002 com todos os produtos que já têm preço cadastrado (> 0)
    const [estPrecos, prodsPrecos] = await Promise.all([
      db
        .select({ produtoId: varejoEstoque.produtoId, preco: varejoEstoque.precoVendaVarejo })
        .from(varejoEstoque)
        .where(eq(varejoEstoque.tenantId, tenantId)),
      db
        .select({ id: produtos.id, valorUnitario: produtos.valorUnitario })
        .from(produtos)
        .where(sql`${produtos.tenantId} = ${tenantId} AND ${produtos.ativo} = 1`),
    ])

    const mapPreco = new Map<string, number>()
    for (const p of prodsPrecos) {
      const v = Number(p.valorUnitario || 0)
      if (v > 0) mapPreco.set(p.id, v)
    }
    for (const e of estPrecos) {
      const v = Number(e.preco || 0)
      if (v > 0) mapPreco.set(e.produtoId, v)
    }

    const itensPadrao: Array<typeof tabelasPrecoItens.$inferInsert> = []
    const itensPromo: Array<typeof tabelasPrecoItens.$inferInsert> = []
    for (const [prodId, preco] of mapPreco.entries()) {
      itensPadrao.push({
        id: uuidv7(),
        tenantId,
        tabelaPrecoId: tabPadraoId,
        produtoId: prodId,
        precoVenda: preco.toFixed(4),
        descontoPct: '0.00',
      })
      const precoPromo = Number((preco * 0.9).toFixed(2))
      itensPromo.push({
        id: uuidv7(),
        tenantId,
        tabelaPrecoId: tabPromoId,
        produtoId: prodId,
        precoVenda: precoPromo.toFixed(4),
        descontoPct: '10.00',
      })
    }
    for (let i = 0; i < itensPadrao.length; i += 100) {
      await db.insert(tabelasPrecoItens).values(itensPadrao.slice(i, i + 100)).onConflictDoNothing()
      await db.insert(tabelasPrecoItens).values(itensPromo.slice(i, i + 100)).onConflictDoNothing()
    }
  }

  if (tabPadraoId && filialAcougue) {
    await db
      .insert(acougueConfigFilial)
      .values({
        id: uuidv7(),
        tenantId,
        filialId: filialAcougue,
        tabelaAtivaId: tabPadraoId,
        tabelaPadraoId: tabPadraoId,
        alteradaPorNome: 'Sistema',
        motivo: 'Configuração inicial padrão',
        historicoJson: [],
      })
      .onConflictDoNothing()
  }

  return {
    tenantId,
    empresaId,
    filialIds: {
      estoque: filialEstoque,
      acougue: filialAcougue,
      industrializacao: filialInd,
    },
  }
}
