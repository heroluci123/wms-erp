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
  eanSequencias,
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

CREATE TABLE IF NOT EXISTS fornecedores (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo TEXT,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT NOT NULL,
  cnpj_cpf TEXT NOT NULL DEFAULT '',
  inscricao_estadual TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT 'SP',
  cidade TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS pedidos_compra (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  fornecedor_id UUID NOT NULL REFERENCES fornecedores(id),
  natureza_id UUID REFERENCES naturezas_operacao(id),
  centro_custo_id UUID REFERENCES centros_custo(id),
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
  cfop_aplicado TEXT NOT NULL DEFAULT ''
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
  xml_storage_key TEXT NOT NULL DEFAULT '',
  status_validacao TEXT NOT NULL DEFAULT 'AGUARDANDO_BIPAGEM',
  validado_por_id UUID,
  validado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_codigo ON recebimentos(tenant_id, codigo);

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
  especificacao TEXT NOT NULL DEFAULT '',
  conservacao TEXT NOT NULL DEFAULT 'RESFRIADO',
  qtd_prevista_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  qtd_mp_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mpi_mapa ON mapas_producao_itens(mapa_id);

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
  status TEXT NOT NULL DEFAULT 'LIBERADO',
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
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS embarques (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filial_id UUID NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  rota_id UUID REFERENCES rotas(id),
  motorista_id UUID REFERENCES operadores(id),
  veiculo_placa TEXT NOT NULL DEFAULT '',
  data_embarque DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANEJADO',
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rom_itens_romaneio ON romaneios_itens(romaneio_id);

CREATE TABLE IF NOT EXISTS entregas_tracking (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  embarque_id UUID NOT NULL REFERENCES embarques(id) ON DELETE CASCADE,
  pedido_id UUID NOT NULL REFERENCES pedidos(id),
  ordem_parada INTEGER NOT NULL DEFAULT 1,
  status_entrega TEXT NOT NULL DEFAULT 'PENDENTE',
  pagamento_confirmado INTEGER NOT NULL DEFAULT 0,
  canhoto_foto_url TEXT,
  assinatura_url TEXT,
  observacao_motorista TEXT NOT NULL DEFAULT '',
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
`

export interface SeedDefaultsResult {
  tenantId: string
  empresaId: string
  filialIds: { estoque: string; acougue: string; industrializacao: string }
}

export async function runMigrationsAndSeed(conn: DbConnection): Promise<SeedDefaultsResult> {
  await conn.execMulti(SCHEMA_SQL)

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

  await db
    .insert(centrosCusto)
    .values({ id: uuidv7(), tenantId, codigo: '557', descricao: 'COMPRA DE MERCADORIA' })
    .onConflictDoNothing()

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
    const masterPerms = PERFIS_SISTEMA_BASE.find((p) => p.codigo === 'MASTER')!.permissoes
    await db.insert(operadores).values({
      id: uuidv7(),
      tenantId,
      empresaId,
      filialPadraoId: filialEstoque,
      nome: 'Luciano',
      login: 'Luciano',
      pin: '****',
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
