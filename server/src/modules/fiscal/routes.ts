import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { z } from 'zod'
import type { DbConnection } from '../../db/client.js'
import { env } from '../../config/env.js'
import {
  clientes,
  devolucaoItens,
  devolucoes,
  embarques,
  empresas,
  entregasTracking,
  estoqueCaixas,
  filiais,
  fiscalConfigFilial,
  fiscalEventos,
  fiscalNotas,
  formasPagamento,
  locaisCobranca,
  matrizTributaria,
  pedidos,
  pedidosItens,
  pedidosParcelas,
  pendenciasSetor,
  produtos,
  romaneios,
  romaneiosItens,
  rotas,
  transportadoras,
  transportadoraVeiculos,
  vendedores,
} from '../../db/schema/index.js'
import { createAuthMiddleware, HttpError } from '../../middlewares/auth.js'
import { uuidv7 } from '../../utils/uuid.js'
import { type DbOrTx, hojeIsoLocal, normalizarDataIso, parseUuidOrBadRequest, toDec, toNum } from '../wms/helpers.js'
import {
  calcularTributacaoItem,
  encryptFiscalSecret,
  gerarChaveAcessoNfe,
  gerarXmlEventoFiscal,
  gerarXmlNfe400,
  onlyDigits,
  type ItemFiscalCalculado,
} from './nfeBuilder.js'

const FiscalConfigSchema = z.object({
  ambiente: z.enum(['HOMOLOGACAO', 'PRODUCAO']).default('HOMOLOGACAO'),
  provedor: z
    .enum(['SIMULACAO_LOCAL', 'SEFAZ_DIRETO_A1', 'FOCUS_NFE', 'NUVEM_FISCAL', 'TECNOSPEED'])
    .default('SIMULACAO_LOCAL'),
  serie_nfe: z.coerce.number().int().min(1).max(999).default(1),
  proximo_numero_nfe: z.coerce.number().int().min(1).default(1),
  serie_nfce: z.coerce.number().int().min(1).max(999).default(1),
  proximo_numero_nfce: z.coerce.number().int().min(1).default(1),
  csc_id: z.string().nullish().transform((v) => (v ?? '').trim()),
  csc_token: z.string().nullish().transform((v) => (v ?? '').trim()),
  gateway_api_token: z.string().nullish().transform((v) => (v ?? '').trim()),
  inf_complementar_padrao: z.string().nullish().transform((v) => (v ?? '').trim()),
})

const CertificadoUploadSchema = z.object({
  arquivo_nome: z.string().trim().min(1, 'Informe o nome do arquivo .pfx.'),
  pfx_base64: z.string().trim().min(20, 'Selecione um arquivo de certificado A1 (.pfx / .p12) válido.'),
  senha: z.string().min(1, 'Informe a senha do Certificado Digital A1.'),
  titular: z.string().nullish().transform((v) => (v ?? '').trim()),
  cnpj: z.string().nullish().transform((v) => onlyDigits(v || '')),
  validade: z.string().nullish().transform((v) => (v ? normalizarDataIso(v) : null)),
})

const EmitirAvulsaSchema = z.object({
  modelo: z.enum(['55', '65']).default('65'),
  tipo_operacao: z.enum(['SAIDA', 'DEVOLUCAO', 'ENTRADA']).default('SAIDA'),
  natureza_operacao: z.string().trim().optional(),
  cliente_id: z.string().uuid().nullish(),
  destinatario_nome: z.string().nullish().transform((v) => (v ?? '').trim()),
  destinatario_doc: z.string().nullish().transform((v) => onlyDigits(v || '')),
  destinatario_ie: z.string().nullish().transform((v) => (v ?? '').trim()),
  destinatario_uf: z.string().nullish().transform((v) => (v ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP'),
  destinatario_cidade: z.string().nullish().transform((v) => (v ?? '').trim()),
  destinatario_endereco: z.string().nullish().transform((v) => (v ?? '').trim()),
  forma_pagamento_label: z.string().nullish().transform((v) => (v ?? '17 - PIX').trim()),
  t_pag: z.string().nullish().transform((v) => (v ?? '17').trim()),
  valor_frete: z.coerce.number().min(0).optional().default(0),
  mod_frete: z.enum(['0', '1', '2', '3', '4', '9']).optional(),
  transportadora_id: z.string().uuid().nullish(),
  veiculo_id: z.string().uuid().nullish(),
  veiculo_placa: z.string().nullish().transform((v) => (v ?? '').trim().toUpperCase()),
  veiculo_uf: z.string().nullish().transform((v) => (v ?? '').trim().toUpperCase().slice(0, 2)),
  transportadora_antt: z.string().nullish().transform((v) => (v ?? '').trim()),
  especie_volumes: z.string().nullish().transform((v) => (v ?? 'CAIXA').trim().toUpperCase()),
  inf_complementar: z.string().nullish().transform((v) => (v ?? '').trim()),
  itens: z
    .array(
      z.object({
        produto_id: z.string().uuid().nullish(),
        codigo: z.string().trim().min(1),
        descricao: z.string().trim().min(1),
        ncm: z.string().nullish().transform((v) => (v ?? '02013000').trim()),
        cest: z.string().nullish().transform((v) => (v ?? '').trim()),
        cfop: z.string().nullish().transform((v) => (v ?? '').trim()),
        unidade: z.string().nullish().transform((v) => (v ?? 'KG').trim()),
        qtd: z.coerce.number().positive(),
        valor_unitario: z.coerce.number().positive(),
        valor_desconto: z.coerce.number().min(0).optional().default(0),
      }),
    )
    .min(1, 'Informe ao menos 1 item para emitir o documento fiscal.'),
})

const InutilizacaoSchema = z.object({
  modelo: z.enum(['55', '65']).default('55'),
  serie: z.coerce.number().int().min(1).max(999).default(1),
  numero_inicial: z.coerce.number().int().min(1),
  numero_final: z.coerce.number().int().min(1),
  justificativa: z.string().trim().min(15, 'A justificativa da inutilização deve ter no mínimo 15 caracteres.'),
})

function gerarProtocoloSimulado(uf: string): string {
  const cUf = uf === 'SP' ? '335' : '135'
  const aa = String(new Date().getFullYear()).slice(-2)
  const rand = String(crypto.randomInt(100_000_000_0, 999_999_999_9))
  return `${cUf}${aa}${rand}`
}

async function obterOuCriarConfigFiscal(tx: DbOrTx, tenantId: string, filialId: string) {
  const [ex] = await tx
    .select()
    .from(fiscalConfigFilial)
    .where(and(eq(fiscalConfigFilial.tenantId, tenantId), eq(fiscalConfigFilial.filialId, filialId)))
    .limit(1)
  if (ex) return ex

  const id = uuidv7()
  await tx.insert(fiscalConfigFilial).values({
    id,
    tenantId,
    filialId,
    ambiente: 'HOMOLOGACAO',
    provedor: 'SIMULACAO_LOCAL',
    serieNfe: 1,
    proximoNumeroNfe: 1,
    serieNfce: 1,
    proximoNumeroNfce: 1,
  })
  const [criado] = await tx.select().from(fiscalConfigFilial).where(eq(fiscalConfigFilial.id, id)).limit(1)
  return criado!
}

async function obterContextoEmitente(tx: DbOrTx, tenantId: string, filialId: string) {
  const [row] = await tx
    .select({
      filialId: filiais.id,
      filialCodigo: filiais.codigo,
      filialNome: filiais.nome,
      tipoUnidade: filiais.tipoUnidade,
      filialCnpj: filiais.cnpj,
      filialIe: filiais.inscricaoEstadual,
      uf: filiais.uf,
      cidade: filiais.cidade,
      codigoIbge: filiais.codigoIbge,
      empRazao: empresas.razaoSocial,
      empFantasia: empresas.nomeFantasia,
      empCnpj: empresas.cnpj,
      empIe: empresas.inscricaoEstadual,
      regime: empresas.regimeTributario,
    })
    .from(filiais)
    .leftJoin(empresas, eq(empresas.id, filiais.empresaId))
    .where(and(eq(filiais.id, filialId), eq(filiais.tenantId, tenantId)))
    .limit(1)

  if (!row) throw new HttpError(404, 'Filial emitente não encontrada.')

  const regime = String(row.regime || 'SIMPLES').toUpperCase()
  return {
    filialId: row.filialId,
    tipoUnidade: row.tipoUnidade || 'DISTRIBUICAO',
    cnpj: onlyDigits(row.filialCnpj || row.empCnpj || '00000000000191') || '00000000000191',
    razaoSocial: row.empRazao || row.filialNome || 'EMPRESA EMITENTE',
    nomeFantasia: row.empFantasia || row.filialNome || 'EMPRESA EMITENTE',
    ie: onlyDigits(row.filialIe || row.empIe || ''),
    uf: (row.uf || 'SP').toUpperCase(),
    cidade: row.cidade || 'SAO PAULO',
    codigoIbge: row.codigoIbge || '',
    regime,
    crt: (regime === 'SIMPLES' ? '1' : '3') as '1' | '3',
  }
}

export interface TransporteResolvidoFiscal {
  modFrete: string
  transportadoraId: string | null
  transportadoraNome: string
  transportadoraDoc: string
  transportadoraIe: string
  transportadoraEndereco: string
  transportadoraCidade: string
  transportadoraUf: string
  transportadoraAntt: string
  veiculoPlaca: string
  veiculoUf: string
  especieVolumes: string
}

async function resolverTransporteFiscal(
  tx: DbOrTx,
  tenantId: string,
  modelo: '55' | '65',
  ufFallback: string,
  input?: {
    mod_frete?: string | null
    transportadora_id?: string | null
    veiculo_id?: string | null
    veiculo_placa?: string | null
    veiculo_uf?: string | null
    transportadora_antt?: string | null
    especie_volumes?: string | null
  },
): Promise<TransporteResolvidoFiscal> {
  const especieVolumes = (input?.especie_volumes || 'CAIXA').trim().toUpperCase() || 'CAIXA'
  if (modelo === '65') {
    return {
      modFrete: '9',
      transportadoraId: null,
      transportadoraNome: '',
      transportadoraDoc: '',
      transportadoraIe: '',
      transportadoraEndereco: '',
      transportadoraCidade: '',
      transportadoraUf: '',
      transportadoraAntt: '',
      veiculoPlaca: '',
      veiculoUf: '',
      especieVolumes,
    }
  }

  // Se caller não informou mod_frete na API, assume '3' (Transporte Próprio) quando não há transportadora, ou '0' (CIF) quando informada
  const modFreteRaw = String(input?.mod_frete ?? '').trim()
  const modFrete = ['0', '1', '2', '3', '4', '9'].includes(modFreteRaw)
    ? modFreteRaw
    : input?.transportadora_id
      ? '0'
      : '3'

  const transpId = input?.transportadora_id ? String(input.transportadora_id).trim() : null

  if ((modFrete === '0' || modFrete === '1') && !transpId) {
    throw new HttpError(
      400,
      `Para NF-e Modelo 55 com modalidade de frete ${modFrete === '0' ? '0 - Por conta do Emitente (CIF)' : '1 - Por conta do Destinatário (FOB)'}, é obrigatório informar a Transportadora.`,
    )
  }

  let transp: typeof transportadoras.$inferSelect | null = null
  if (transpId) {
    const [t] = await tx
      .select()
      .from(transportadoras)
      .where(and(eq(transportadoras.id, transpId), eq(transportadoras.tenantId, tenantId)))
      .limit(1)
    if (!t) throw new HttpError(404, 'Transportadora selecionada não encontrada.')
    transp = t
  }

  let veic: typeof transportadoraVeiculos.$inferSelect | null = null
  if (input?.veiculo_id && transp) {
    const [v] = await tx
      .select()
      .from(transportadoraVeiculos)
      .where(
        and(
          eq(transportadoraVeiculos.id, input.veiculo_id),
          eq(transportadoraVeiculos.transportadoraId, transp.id),
          eq(transportadoraVeiculos.tenantId, tenantId),
        ),
      )
      .limit(1)
    veic = v || null
  } else if (transp && !input?.veiculo_placa) {
    const [vPadrao] = await tx
      .select()
      .from(transportadoraVeiculos)
      .where(
        and(
          eq(transportadoraVeiculos.transportadoraId, transp.id),
          eq(transportadoraVeiculos.tenantId, tenantId),
          eq(transportadoraVeiculos.ativo, 1),
        ),
      )
      .orderBy(desc(transportadoraVeiculos.padrao))
      .limit(1)
    veic = vPadrao || null
  }

  const veiculoPlaca = String(input?.veiculo_placa || veic?.placa || transp?.placaPadrao || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  const veiculoUf = String(input?.veiculo_uf || veic?.ufPlaca || transp?.uf || ufFallback || 'SP')
    .toUpperCase()
    .slice(0, 2)
  const transportadoraAntt = String(input?.transportadora_antt || veic?.rntrcAntt || transp?.rntrcAntt || '').trim()
  const enderecoTransp = transp
    ? [transp.endereco, transp.numero, transp.bairro].filter(Boolean).join(', ')
    : ''

  return {
    modFrete,
    transportadoraId: transp?.id || null,
    transportadoraNome: transp?.razaoSocial || transp?.nomeFantasia || '',
    transportadoraDoc: onlyDigits(transp?.cnpjCpf || ''),
    transportadoraIe: transp?.inscricaoEstadual || '',
    transportadoraEndereco: enderecoTransp,
    transportadoraCidade: transp?.cidade || '',
    transportadoraUf: transp?.uf || '',
    transportadoraAntt,
    veiculoPlaca,
    veiculoUf: veiculoPlaca ? veiculoUf : '',
    especieVolumes,
  }
}

export async function emitirDocumentoFiscalTx(
  tx: DbOrTx,
  params: {
    tenantId: string
    filialId: string
    modelo: '55' | '65'
    tipoOperacao: 'SAIDA' | 'DEVOLUCAO' | 'ENTRADA'
    finalidade: '1' | '4'
    naturezaOperacao: string
    pedidoId?: string | null
    devolucaoId?: string | null
    clienteId?: string | null
    destinatario: {
      nome: string
      doc: string
      ie: string
      uf: string
      cidade: string
      endereco: string
    }
    itensRaw: Array<{
      produtoId?: string | null
      codigo: string
      descricao: string
      ncm?: string
      cest?: string
      orig?: string
      cfopExplicito?: string
      unidade?: string
      qtd: number
      valorUnitario: number
      valorDesconto?: number
      lote?: string
      validade?: string
    }>
    valorFrete?: number
    pesoBrutoKg?: number
    pesoLiquidoKg?: number
    qtdVolumes?: number
    transporte?: TransporteResolvidoFiscal
    duplicatas?: Array<{ numero: string; vencimento: string; valor: number }>
    vendedorNome?: string
    condicaoPagamentoLabel?: string
    formaPagamentoLabel?: string
    tPag?: string
    infComplementarExtra?: string
    operadorId?: string | null
    operadorNome?: string
  },
) {
  const [cfg, emitente, regrasMatriz] = await Promise.all([
    obterOuCriarConfigFiscal(tx, params.tenantId, params.filialId),
    obterContextoEmitente(tx, params.tenantId, params.filialId),
    tx.select().from(matrizTributaria).where(eq(matrizTributaria.tenantId, params.tenantId)),
  ])

  const serie = params.modelo === '65' ? Number(cfg.serieNfce || 1) : Number(cfg.serieNfe || 1)
  const numero = params.modelo === '65' ? Number(cfg.proximoNumeroNfce || 1) : Number(cfg.proximoNumeroNfe || 1)

  const itensCalc: ItemFiscalCalculado[] = params.itensRaw.map((it, idx) =>
    calcularTributacaoItem({
      nItem: idx + 1,
      produtoId: it.produtoId,
      codigo: it.codigo,
      descricao: it.descricao,
      ncm: it.ncm,
      cest: it.cest,
      orig: it.orig,
      cfopExplicito: it.cfopExplicito,
      unidade: it.unidade,
      qtd: it.qtd,
      valorUnitario: it.valorUnitario,
      valorDesconto: it.valorDesconto,
      tipoOperacao: params.tipoOperacao,
      modelo: params.modelo,
      tipoUnidadeFilial: emitente.tipoUnidade,
      ufOrigem: emitente.uf,
      ufDestino: params.destinatario.uf || emitente.uf,
      regimeTributario: emitente.regime,
      matrizRegras: regrasMatriz,
      lote: it.lote,
      validade: it.validade,
    }),
  )

  const vProd = Number(itensCalc.reduce((s, i) => s + i.valor_total, 0).toFixed(2))
  const vDesc = Number(itensCalc.reduce((s, i) => s + i.valor_desconto, 0).toFixed(2))
  const vFrete = Number(Math.max(0, Number(params.valorFrete || 0)).toFixed(2))
  const vBC = Number(itensCalc.reduce((s, i) => s + i.v_bc_icms, 0).toFixed(2))
  const vICMS = Number(itensCalc.reduce((s, i) => s + i.v_icms, 0).toFixed(2))
  const vST = Number(itensCalc.reduce((s, i) => s + i.v_icms_st, 0).toFixed(2))
  const vPIS = Number(itensCalc.reduce((s, i) => s + i.v_pis, 0).toFixed(2))
  const vCOFINS = Number(itensCalc.reduce((s, i) => s + i.v_cofins, 0).toFixed(2))
  const vIBS = Number(itensCalc.reduce((s, i) => s + (i.v_ibs_uf || 0), 0).toFixed(2))
  const vCBS = Number(itensCalc.reduce((s, i) => s + (i.v_cbs || 0), 0).toFixed(2))
  const vNF = Math.max(0, Number((vProd - vDesc + vFrete + vST).toFixed(2)))
  const pesoLiq =
    params.pesoLiquidoKg && params.pesoLiquidoKg > 0
      ? Number(params.pesoLiquidoKg.toFixed(3))
      : Number(itensCalc.reduce((s, i) => s + (i.unidade === 'KG' ? i.qtd : 0), 0).toFixed(3))
  const pesoBruto =
    params.pesoBrutoKg && params.pesoBrutoKg > 0 ? Number(params.pesoBrutoKg.toFixed(3)) : pesoLiq

  const transpRes = params.transporte || {
    modFrete: params.modelo === '65' ? '9' : '3',
    transportadoraId: null,
    transportadoraNome: '',
    transportadoraDoc: '',
    transportadoraIe: '',
    transportadoraEndereco: '',
    transportadoraCidade: '',
    transportadoraUf: '',
    transportadoraAntt: '',
    veiculoPlaca: '',
    veiculoUf: '',
    especieVolumes: 'CAIXA',
  }
  const duplicatasFinais = Array.isArray(params.duplicatas) ? params.duplicatas : []

  const agora = new Date()
  const { chave, cNF, cDV } = gerarChaveAcessoNfe({
    uf: emitente.uf,
    dataEmissao: agora,
    cnpjEmitente: emitente.cnpj,
    modelo: params.modelo,
    serie,
    numero,
  })
  const protocolo = gerarProtocoloSimulado(emitente.uf)
  const infComp = [cfg.infComplementarPadrao, params.infComplementarExtra].filter(Boolean).join(' | ')

  const xml = gerarXmlNfe400({
    chave,
    cNF,
    cDV,
    protocolo,
    ambiente: (cfg.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO') as 'HOMOLOGACAO' | 'PRODUCAO',
    modelo: params.modelo,
    serie,
    numero,
    naturezaOperacao: params.naturezaOperacao,
    tipoOperacao: params.tipoOperacao,
    finalidade: params.finalidade,
    dataEmissaoIso: agora.toISOString(),
    emitente,
    destinatario: params.destinatario,
    itens: itensCalc,
    totais: {
      vProd,
      vDesc,
      vFrete,
      vBC,
      vICMS,
      vST,
      vPIS,
      vCOFINS,
      vIBS,
      vCBS,
      vNF,
      pesoBruto,
      pesoLiquido: pesoLiq,
      qtdVolumes: params.qtdVolumes || 0,
    },
    transporte: {
      modFrete: transpRes.modFrete,
      transportadora: transpRes.transportadoraNome
        ? {
            nome: transpRes.transportadoraNome,
            doc: transpRes.transportadoraDoc,
            ie: transpRes.transportadoraIe,
            endereco: transpRes.transportadoraEndereco,
            cidade: transpRes.transportadoraCidade,
            uf: transpRes.transportadoraUf,
            antt: transpRes.transportadoraAntt,
          }
        : null,
      veiculo: transpRes.veiculoPlaca
        ? {
            placa: transpRes.veiculoPlaca,
            uf: transpRes.veiculoUf,
            rntrc: transpRes.transportadoraAntt,
          }
        : null,
      especieVolumes: transpRes.especieVolumes,
    },
    duplicatas: duplicatasFinais,
    tPag: params.tPag || '99',
    infComplementar: infComp,
  })

  const notaId = uuidv7()
  await tx.insert(fiscalNotas).values({
    id: notaId,
    tenantId: params.tenantId,
    filialId: params.filialId,
    modelo: params.modelo,
    tipoOperacao: params.tipoOperacao,
    finalidade: params.finalidade,
    ambiente: cfg.ambiente,
    provedorUsado: cfg.provedor,
    serie,
    numero,
    chaveAcesso: chave,
    protocoloAutorizacao: protocolo,
    dataAutorizacao: agora,
    status: 'AUTORIZADA',
    naturezaOperacao: params.naturezaOperacao,
    pedidoId: params.pedidoId || null,
    devolucaoId: params.devolucaoId || null,
    clienteId: params.clienteId || null,
    destinatarioNome: params.destinatario.nome || 'CONSUMIDOR FINAL',
    destinatarioDoc: onlyDigits(params.destinatario.doc),
    destinatarioIe: params.destinatario.ie || '',
    destinatarioUf: params.destinatario.uf || emitente.uf,
    destinatarioCidade: params.destinatario.cidade || '',
    destinatarioEndereco: params.destinatario.endereco || '',
    formaPagamentoLabel: params.formaPagamentoLabel || '99 - Outros',
    valorProdutos: toDec(vProd, 2),
    valorDesconto: toDec(vDesc, 2),
    valorFrete: toDec(vFrete, 2),
    valorIcmsBase: toDec(vBC, 2),
    valorIcms: toDec(vICMS, 2),
    valorIcmsSt: toDec(vST, 2),
    valorPis: toDec(vPIS, 2),
    valorCofins: toDec(vCOFINS, 2),
    valorIbs: toDec(vIBS, 2),
    valorCbs: toDec(vCBS, 2),
    valorTotalNf: toDec(vNF, 2),
    modFrete: transpRes.modFrete,
    transportadoraId: transpRes.transportadoraId,
    transportadoraNome: transpRes.transportadoraNome,
    transportadoraDoc: transpRes.transportadoraDoc,
    transportadoraIe: transpRes.transportadoraIe,
    transportadoraEndereco: transpRes.transportadoraEndereco,
    transportadoraCidade: transpRes.transportadoraCidade,
    transportadoraUf: transpRes.transportadoraUf,
    transportadoraAntt: transpRes.transportadoraAntt,
    veiculoPlaca: transpRes.veiculoPlaca,
    veiculoUf: transpRes.veiculoUf,
    especieVolumes: transpRes.especieVolumes,
    pesoBrutoKg: toDec(pesoBruto, 3),
    pesoLiquidoKg: toDec(pesoLiq, 3),
    qtdVolumes: params.qtdVolumes || 0,
    duplicatasJson: duplicatasFinais as unknown as Array<Record<string, unknown>>,
    vendedorNome: params.vendedorNome || '',
    condicaoPagamentoLabel: params.condicaoPagamentoLabel || '',
    itensJson: itensCalc as unknown as Array<Record<string, unknown>>,
    xmlConteudo: xml,
    infComplementar: infComp,
    emitidaPorId: params.operadorId || null,
    emitidaPorNome: params.operadorNome || 'Sistema',
  })

  // Conclui pendência de FATURAMENTO se o pedido aguardava NF-e para carregamento
  if (params.pedidoId) {
    await tx
      .update(pendenciasSetor)
      .set({
        status: 'CONCLUIDA',
        concluidaPorId: params.operadorId || null,
        concluidaAt: agora,
      })
      .where(
        and(
          eq(pendenciasSetor.tenantId, params.tenantId),
          eq(pendenciasSetor.referenciaId, params.pedidoId),
          eq(pendenciasSetor.tipoPendencia, 'PEDIDO_AGUARDANDO_FATURAMENTO'),
          eq(pendenciasSetor.status, 'PENDENTE'),
        ),
      )
  }

  // Incrementa o próximo número da série atomicamente
  await tx
    .update(fiscalConfigFilial)
    .set(
      params.modelo === '65'
        ? { proximoNumeroNfce: numero + 1, updatedAt: new Date() }
        : { proximoNumeroNfe: numero + 1, updatedAt: new Date() },
    )
    .where(eq(fiscalConfigFilial.id, cfg.id))

  return {
    id: notaId,
    modelo: params.modelo,
    serie,
    numero,
    chave_acesso: chave,
    protocolo_autorizacao: protocolo,
    status: 'AUTORIZADA',
    valor_total_nf: vNF,
    itens: itensCalc,
  }
}

export function registerFiscalRoutes(app: FastifyInstance, conn: DbConnection): void {
  const { requirePermission } = createAuthMiddleware(app, conn)
  const readPerm = requirePermission(['fiscal', 'devolucao_fiscal', 'parametros_comerciais'], {
    write: false,
    bloquearCliente: true,
  })
  const writePerm = requirePermission(['fiscal', 'devolucao_fiscal'])

  // ── CONFIGURAÇÃO FISCAL & CERTIFICADO DIGITAL A1 POR FILIAL ─────────────────
  app.get('/api/fiscal/config', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const [cfg, emitente] = await conn.db.transaction(async (tx) => [
      await obterOuCriarConfigFiscal(tx, ctx.tenantId, ctx.filialId),
      await obterContextoEmitente(tx, ctx.tenantId, ctx.filialId),
    ])

    return {
      success: true,
      data: {
        id: cfg.id,
        filial_id: cfg.filialId,
        ambiente: cfg.ambiente,
        provedor: cfg.provedor,
        serie_nfe: cfg.serieNfe,
        proximo_numero_nfe: cfg.proximoNumeroNfe,
        serie_nfce: cfg.serieNfce,
        proximo_numero_nfce: cfg.proximoNumeroNfce,
        csc_id: cfg.cscId,
        csc_token_configurado: Boolean(cfg.cscToken),
        csc_token: cfg.cscToken,
        certificado_configurado: Boolean(cfg.certificadoPfxBase64),
        certificado_nome: cfg.certificadoNome,
        certificado_validade: cfg.certificadoValidade,
        certificado_titular: cfg.certificadoTitular,
        certificado_cnpj: cfg.certificadoCnpj,
        gateway_token_configurado: Boolean(cfg.gatewayApiTokenEnc),
        inf_complementar_padrao: cfg.infComplementarPadrao,
        emitente,
      },
    }
  })

  app.put('/api/fiscal/config', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const parsed = FiscalConfigSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Configuração fiscal inválida.')
    const d = parsed.data

    await conn.db.transaction(async (tx) => {
      const cfg = await obterOuCriarConfigFiscal(tx, ctx.tenantId, ctx.filialId)
      const updates: Partial<typeof fiscalConfigFilial.$inferInsert> = {
        ambiente: d.ambiente,
        provedor: d.provedor,
        serieNfe: d.serie_nfe,
        proximoNumeroNfe: d.proximo_numero_nfe,
        serieNfce: d.serie_nfce,
        proximoNumeroNfce: d.proximo_numero_nfce,
        cscId: d.csc_id,
        cscToken: d.csc_token,
        infComplementarPadrao: d.inf_complementar_padrao,
        updatedAt: new Date(),
      }
      if (d.gateway_api_token) {
        updates.gatewayApiTokenEnc = encryptFiscalSecret(d.gateway_api_token, env.JWT_SECRET)
      }
      await tx.update(fiscalConfigFilial).set(updates).where(eq(fiscalConfigFilial.id, cfg.id))
    })

    return { success: true }
  })

  app.post('/api/fiscal/config/certificado', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const parsed = CertificadoUploadSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Certificado inválido.')
    const d = parsed.data

    const cleanB64 = d.pfx_base64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '')
    const buf = Buffer.from(cleanB64, 'base64')
    if (buf.length < 16 || buf[0] !== 0x30) {
      throw new HttpError(
        400,
        'Arquivo enviado não parece ser um Certificado Digital A1 (.pfx / .p12) PKCS#12 válido.',
      )
    }

    const senhaEnc = encryptFiscalSecret(d.senha, env.JWT_SECRET)
    await conn.db.transaction(async (tx) => {
      const cfg = await obterOuCriarConfigFiscal(tx, ctx.tenantId, ctx.filialId)
      await tx
        .update(fiscalConfigFilial)
        .set({
          certificadoNome: d.arquivo_nome,
          certificadoPfxBase64: cleanB64,
          certificadoSenhaEnc: senhaEnc,
          certificadoTitular: d.titular || '',
          certificadoCnpj: d.cnpj || '',
          certificadoValidade: d.validade || null,
          updatedAt: new Date(),
        })
        .where(eq(fiscalConfigFilial.id, cfg.id))
    })

    return {
      success: true,
      certificado_nome: d.arquivo_nome,
      certificado_validade: d.validade,
      tamanho_bytes: buf.length,
    }
  })

  // ── FILA DE EMISSÃO (PEDIDOS SEM NF + DEVOLUÇÕES PENDENTES) ────────────────
  app.get('/api/fiscal/fila-pedidos', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const [pedsRows, devsRows, notasAtivas] = await Promise.all([
      conn.db
        .select({
          id: pedidos.id,
          codigo: pedidos.codigo,
          titulo: pedidos.titulo,
          status: pedidos.status,
          cliente_id: pedidos.clienteId,
          cliente_texto: pedidos.cliente,
          cliente_fantasia: clientes.nomeFantasia,
          cliente_razao: clientes.razaoSocial,
          cliente_doc: clientes.cnpjCpf,
          cliente_uf: clientes.uf,
          valor_total: pedidos.valorTotal,
          numero_nf: pedidos.numeroNf,
          chave_nfe: pedidos.chaveNfe,
          created_at: pedidos.createdAt,
        })
        .from(pedidos)
        .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
        .where(
          and(
            eq(pedidos.tenantId, ctx.tenantId),
            eq(pedidos.filialId, ctx.filialId),
            ne(pedidos.status, 'CANCELADO'),
            ne(pedidos.status, 'RASCUNHO'),
          ),
        )
        .orderBy(desc(pedidos.createdAt))
        .limit(120),
      conn.db
        .select()
        .from(devolucoes)
        .where(
          and(
            eq(devolucoes.tenantId, ctx.tenantId),
            eq(devolucoes.filialId, ctx.filialId),
            eq(devolucoes.statusFiscal, 'PENDENTE_FATURAMENTO'),
          ),
        )
        .orderBy(desc(devolucoes.createdAt))
        .limit(60),
      conn.db
        .select({ pedidoId: fiscalNotas.pedidoId, devolucaoId: fiscalNotas.devolucaoId })
        .from(fiscalNotas)
        .where(and(eq(fiscalNotas.tenantId, ctx.tenantId), eq(fiscalNotas.status, 'AUTORIZADA'))),
    ])

    const pedComNf = new Set(notasAtivas.map((n) => n.pedidoId).filter(Boolean))
    const devComNf = new Set(notasAtivas.map((n) => n.devolucaoId).filter(Boolean))

    const pedidosPendentes = pedsRows
      .filter((p) => !pedComNf.has(p.id) && !p.chave_nfe)
      .map((p) => ({
        id: p.id,
        codigo: p.codigo,
        titulo: p.titulo,
        status: p.status,
        cliente_id: p.cliente_id,
        cliente_nome: p.cliente_fantasia || p.cliente_razao || p.cliente_texto || 'Cliente',
        cliente_doc: p.cliente_doc || '',
        cliente_uf: p.cliente_uf || 'SP',
        valor_total: toNum(p.valor_total, 0),
        created_at: p.created_at,
      }))

    const devolucoesPendentes = devsRows
      .filter((d) => !devComNf.has(d.id))
      .map((d) => ({
        id: d.id,
        codigo: d.codigo,
        motivo: d.motivo,
        pedido_codigo: d.pedidoCodigo,
        cliente_nome: d.clienteNome,
        qtd_caixas: d.qtdCaixas,
        peso_total_kg: toNum(d.pesoTotalKg, 0),
        valor_estimado: toNum(d.valorEstimado, 0),
        created_at: d.createdAt,
      }))

    return {
      success: true,
      pedidos: pedidosPendentes,
      devolucoes: devolucoesPendentes,
    }
  })

  // Helper para montar payload fiscal de um Pedido de Venda
  async function montarDadosPedidoFiscal(tx: DbOrTx, tenantId: string, filialId: string, pedidoId: string) {
    const [ped] = await tx
      .select()
      .from(pedidos)
      .where(and(eq(pedidos.id, pedidoId), eq(pedidos.tenantId, tenantId)))
      .limit(1)
    if (!ped) throw new HttpError(404, 'Pedido de venda não encontrado.')
    if (ped.status === 'CANCELADO') throw new HttpError(400, 'Não é possível emitir NF-e de pedido cancelado.')

    const [cli, itensPed, romsItens, emitente, regrasMatriz, parcelasPed, vendRow, fpRow, lcRow, embLink] =
      await Promise.all([
        ped.clienteId
          ? tx.select().from(clientes).where(eq(clientes.id, ped.clienteId)).limit(1).then((r) => r[0] || null)
          : Promise.resolve(null),
        tx
          .select({
            produtoId: pedidosItens.produtoId,
            codigo: produtos.codigo,
            descricao: produtos.descricao,
            ncm: produtos.ncm,
            cest: produtos.cest,
            orig: produtos.origemMercadoria,
            unidade: produtos.unidade,
            qtdKg: pedidosItens.qtdKgSolicitada,
            precoUnit: pedidosItens.precoUnitario,
            descontoVal: pedidosItens.descontoValor,
            cfopAplicado: pedidosItens.cfopAplicado,
          })
          .from(pedidosItens)
          .innerJoin(produtos, eq(produtos.id, pedidosItens.produtoId))
          .where(eq(pedidosItens.pedidoId, ped.id)),
        tx
          .select({
            produtoId: romaneiosItens.produtoId,
            pesoKg: romaneiosItens.pesoKg,
            pesoBruto: estoqueCaixas.pesoBrutoKg,
            lote: estoqueCaixas.lote,
            validade: estoqueCaixas.validade,
          })
          .from(romaneiosItens)
          .innerJoin(romaneios, eq(romaneios.id, romaneiosItens.romaneioId))
          .leftJoin(estoqueCaixas, eq(estoqueCaixas.id, romaneiosItens.caixaId))
          .where(eq(romaneios.pedidoId, ped.id)),
        obterContextoEmitente(tx, tenantId, filialId),
        tx.select().from(matrizTributaria).where(eq(matrizTributaria.tenantId, tenantId)),
        tx
          .select()
          .from(pedidosParcelas)
          .where(eq(pedidosParcelas.pedidoId, ped.id)),
        ped.vendedorId
          ? tx.select({ nome: vendedores.nome }).from(vendedores).where(eq(vendedores.id, ped.vendedorId)).limit(1).then((r) => r[0] || null)
          : Promise.resolve(null),
        ped.formaPagamentoId
          ? tx.select({ descricao: formasPagamento.descricao }).from(formasPagamento).where(eq(formasPagamento.id, ped.formaPagamentoId)).limit(1).then((r) => r[0] || null)
          : Promise.resolve(null),
        ped.localCobrancaId
          ? tx.select({ nome: locaisCobranca.nome }).from(locaisCobranca).where(eq(locaisCobranca.id, ped.localCobrancaId)).limit(1).then((r) => r[0] || null)
          : Promise.resolve(null),
        tx
          .select({
            transportadoraId: embarques.transportadoraId,
            veiculoPlaca: embarques.veiculoPlaca,
          })
          .from(entregasTracking)
          .innerJoin(embarques, eq(embarques.id, entregasTracking.embarqueId))
          .where(eq(entregasTracking.pedidoId, ped.id))
          .limit(1)
          .then((r) => r[0] || null),
      ])

    let sugTranspId = embLink?.transportadoraId || null
    let sugPlaca = embLink?.veiculoPlaca || ''
    if (!sugTranspId && cli?.rotaPadraoNome) {
      const [rotaRow] = await tx
        .select({ transportadoraId: rotas.transportadoraId, veiculoPadrao: rotas.veiculoPadrao })
        .from(rotas)
        .where(and(eq(rotas.tenantId, tenantId), eq(rotas.nome, cli.rotaPadraoNome)))
        .limit(1)
      if (rotaRow?.transportadoraId) sugTranspId = rotaRow.transportadoraId
      if (!sugPlaca && rotaRow?.veiculoPadrao) sugPlaca = rotaRow.veiculoPadrao
    }

    const duplicatas = parcelasPed
      .sort((a, b) => Number(a.numeroParcela || 0) - Number(b.numeroParcela || 0))
      .map((p) => ({
        numero: String(p.numeroParcela).padStart(3, '0'),
        vencimento: String(p.vencimento).slice(0, 10),
        valor: toNum(p.valor, 0),
      }))

    const vendedorNome = vendRow?.nome || ''
    const condicaoPagamentoLabel = [fpRow?.descricao, lcRow?.nome].filter(Boolean).join(' • ')

    if (itensPed.length === 0) throw new HttpError(400, 'Pedido sem itens para faturamento fiscal.')

    const pesoRealPorProd = new Map<string, { liq: number; bruto: number; cxs: number; lote: string }>()
    let qtdVolumes = 0
    let pesoBrutoTotal = 0
    let pesoLiqTotal = 0
    for (const ri of romsItens) {
      const liq = toNum(ri.pesoKg, 0)
      const bruto = toNum(ri.pesoBruto, 0) || liq
      const cur = pesoRealPorProd.get(ri.produtoId) || { liq: 0, bruto: 0, cxs: 0, lote: '' }
      cur.liq += liq
      cur.bruto += bruto
      cur.cxs += 1
      if (!cur.lote && ri.lote) cur.lote = ri.lote
      pesoRealPorProd.set(ri.produtoId, cur)
      qtdVolumes += 1
      pesoBrutoTotal += bruto
      pesoLiqTotal += liq
    }

    const destinatario = {
      nome: cli?.razaoSocial || cli?.nomeFantasia || ped.cliente || 'CONSUMIDOR FINAL',
      doc: onlyDigits(cli?.cnpjCpf || ''),
      ie: cli?.inscricaoEstadual || '',
      uf: (cli?.uf || emitente.uf).toUpperCase(),
      cidade: cli?.cidade || '',
      endereco: [cli?.endereco, cli?.numero, cli?.bairro].filter(Boolean).join(', '),
    }

    const itensRaw = itensPed.map((it) => {
      const real = pesoRealPorProd.get(it.produtoId)
      const qtd = real && real.liq > 0 ? real.liq : toNum(it.qtdKg, 0)
      return {
        produtoId: it.produtoId,
        codigo: it.codigo || '001',
        descricao: it.descricao,
        ncm: it.ncm || '02013000',
        cest: it.cest || '',
        orig: it.orig || '0',
        cfopExplicito: it.cfopAplicado || '',
        unidade: 'KG',
        qtd,
        valorUnitario: toNum(it.precoUnit, 0),
        valorDesconto: toNum(it.descontoVal, 0),
        lote: real?.lote || '',
      }
    })

    return {
      ped,
      cli,
      destinatario,
      itensRaw,
      emitente,
      regrasMatriz,
      qtdVolumes,
      pesoBrutoTotal,
      pesoLiqTotal,
      duplicatas,
      vendedorNome,
      condicaoPagamentoLabel,
      sugestaoTransporte: {
        transportadora_id: sugTranspId,
        veiculo_placa: sugPlaca,
      },
    }
  }

  // ── PRÉ-VISUALIZAÇÃO TRIBUTÁRIA DO PEDIDO ANTES DA EMISSÃO ─────────────────
  app.post('/api/fiscal/notas/preview-pedido/:pedidoId', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const pedidoId = parseUuidOrBadRequest((req.params as { pedidoId: string }).pedidoId, 'pedido_id')
    const body = (req.body || {}) as { modelo?: '55' | '65' }
    const modelo: '55' | '65' = body.modelo === '65' ? '65' : '55'

    const {
      ped,
      destinatario,
      itensRaw,
      emitente,
      regrasMatriz,
      qtdVolumes,
      pesoBrutoTotal,
      pesoLiqTotal,
      duplicatas,
      vendedorNome,
      condicaoPagamentoLabel,
      sugestaoTransporte,
    } = await montarDadosPedidoFiscal(conn.db, ctx.tenantId, ctx.filialId, pedidoId)

    const itensCalc = itensRaw.map((it, idx) =>
      calcularTributacaoItem({
        nItem: idx + 1,
        produtoId: it.produtoId,
        codigo: it.codigo,
        descricao: it.descricao,
        ncm: it.ncm,
        cest: it.cest,
        orig: it.orig,
        cfopExplicito: it.cfopExplicito,
        unidade: it.unidade,
        qtd: it.qtd,
        valorUnitario: it.valorUnitario,
        valorDesconto: it.valorDesconto,
        tipoOperacao: 'SAIDA',
        modelo,
        tipoUnidadeFilial: emitente.tipoUnidade,
        ufOrigem: emitente.uf,
        ufDestino: destinatario.uf,
        regimeTributario: emitente.regime,
        matrizRegras: regrasMatriz,
        lote: it.lote,
      }),
    )

    const vProd = Number(itensCalc.reduce((s, i) => s + i.valor_total, 0).toFixed(2))
    const vDesc = Number(itensCalc.reduce((s, i) => s + i.valor_desconto, 0).toFixed(2))
    const vBC = Number(itensCalc.reduce((s, i) => s + i.v_bc_icms, 0).toFixed(2))
    const vICMS = Number(itensCalc.reduce((s, i) => s + i.v_icms, 0).toFixed(2))
    const vST = Number(itensCalc.reduce((s, i) => s + i.v_icms_st, 0).toFixed(2))
    const vPIS = Number(itensCalc.reduce((s, i) => s + i.v_pis, 0).toFixed(2))
    const vCOFINS = Number(itensCalc.reduce((s, i) => s + i.v_cofins, 0).toFixed(2))
    const vIBS = Number(itensCalc.reduce((s, i) => s + (i.v_ibs_uf || 0), 0).toFixed(2))
    const vCBS = Number(itensCalc.reduce((s, i) => s + (i.v_cbs || 0), 0).toFixed(2))
    const vNF = Math.max(0, Number((vProd - vDesc + vST).toFixed(2)))

    return {
      success: true,
      pedido_codigo: ped.codigo,
      modelo,
      emitente,
      destinatario,
      vendedor_nome: vendedorNome,
      condicao_pagamento_label: condicaoPagamentoLabel,
      duplicatas,
      sugestao_transporte: sugestaoTransporte,
      itens: itensCalc,
      totais: {
        valor_produtos: vProd,
        valor_desconto: vDesc,
        valor_icms_base: vBC,
        valor_icms: vICMS,
        valor_icms_st: vST,
        valor_pis: vPIS,
        valor_cofins: vCOFINS,
        valor_ibs: vIBS,
        valor_cbs: vCBS,
        valor_total_nf: vNF,
        qtd_volumes: qtdVolumes,
        peso_bruto_kg: Number(pesoBrutoTotal.toFixed(3)),
        peso_liquido_kg: Number(pesoLiqTotal.toFixed(3)),
      },
    }
  })

  // ── EMITIR NF-e / NFC-e A PARTIR DE PEDIDO DE VENDA ────────────────────────
  app.post('/api/fiscal/notas/emitir-pedido/:pedidoId', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const pedidoId = parseUuidOrBadRequest((req.params as { pedidoId: string }).pedidoId, 'pedido_id')
    const body = (req.body || {}) as {
      modelo?: '55' | '65'
      natureza_operacao?: string
      valor_frete?: number
      mod_frete?: string
      transportadora_id?: string | null
      veiculo_id?: string | null
      veiculo_placa?: string
      veiculo_uf?: string
      transportadora_antt?: string
      especie_volumes?: string
      inf_complementar?: string
    }
    const modelo: '55' | '65' = body.modelo === '65' ? '65' : '55'

    const nota = await conn.db.transaction(async (tx) => {
      const [jaAutorizada] = await tx
        .select({ id: fiscalNotas.id, numero: fiscalNotas.numero })
        .from(fiscalNotas)
        .where(
          and(
            eq(fiscalNotas.tenantId, ctx.tenantId),
            eq(fiscalNotas.pedidoId, pedidoId),
            eq(fiscalNotas.status, 'AUTORIZADA'),
          ),
        )
        .limit(1)
      if (jaAutorizada) {
        throw new HttpError(409, `Este pedido já possui nota fiscal autorizada (Nº ${jaAutorizada.numero}).`)
      }

      const dados = await montarDadosPedidoFiscal(tx, ctx.tenantId, ctx.filialId, pedidoId)

      const transporte = await resolverTransporteFiscal(tx, ctx.tenantId, modelo, dados.emitente.uf, {
        mod_frete: body.mod_frete,
        transportadora_id: body.transportadora_id,
        veiculo_id: body.veiculo_id,
        veiculo_placa: body.veiculo_placa,
        veiculo_uf: body.veiculo_uf,
        transportadora_antt: body.transportadora_antt,
        especie_volumes: body.especie_volumes,
      })

      const emitida = await emitirDocumentoFiscalTx(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        modelo,
        tipoOperacao: 'SAIDA',
        finalidade: '1',
        naturezaOperacao: body.natureza_operacao?.trim() || 'VENDA DE MERCADORIA',
        pedidoId: dados.ped.id,
        clienteId: dados.ped.clienteId,
        destinatario: dados.destinatario,
        itensRaw: dados.itensRaw,
        valorFrete: Number(body.valor_frete || 0),
        pesoBrutoKg: dados.pesoBrutoTotal,
        pesoLiquidoKg: dados.pesoLiqTotal,
        qtdVolumes: dados.qtdVolumes,
        transporte,
        duplicatas: dados.duplicatas,
        vendedorNome: dados.vendedorNome,
        condicaoPagamentoLabel: dados.condicaoPagamentoLabel,
        formaPagamentoLabel: dados.condicaoPagamentoLabel || '99 - Outros',
        infComplementarExtra: [
          `Pedido: ${dados.ped.codigo}`,
          dados.vendedorNome ? `Vendedor: ${dados.vendedorNome}` : '',
          dados.condicaoPagamentoLabel ? `Cond. Pagto: ${dados.condicaoPagamentoLabel}` : '',
          body.inf_complementar?.trim() || '',
        ]
          .filter(Boolean)
          .join(' • '),
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      await tx
        .update(pedidos)
        .set({
          numeroNf: String(emitida.numero),
          chaveNfe: emitida.chave_acesso,
          updatedAt: new Date(),
        })
        .where(eq(pedidos.id, dados.ped.id))

      return emitida
    })

    return reply.status(201).send({ success: true, ...nota })
  })

  // ── EMITIR NF-e DE DEVOLUÇÃO A PARTIR DE DEVOLUÇÃO FÍSICA ──────────────────
  app.post('/api/fiscal/notas/emitir-devolucao/:devolucaoId', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const devId = parseUuidOrBadRequest((req.params as { devolucaoId: string }).devolucaoId, 'devolucao_id')

    const nota = await conn.db.transaction(async (tx) => {
      const [dev] = await tx
        .select()
        .from(devolucoes)
        .where(and(eq(devolucoes.id, devId), eq(devolucoes.tenantId, ctx.tenantId)))
        .limit(1)
      if (!dev) throw new HttpError(404, 'Devolução não encontrada.')

      const itensDev = await tx
        .select({
          produtoId: devolucaoItens.produtoId,
          codigo: produtos.codigo,
          descricao: produtos.descricao,
          ncm: produtos.ncm,
          cest: produtos.cest,
          orig: produtos.origemMercadoria,
          pesoKg: devolucaoItens.pesoKg,
          precoUnit: devolucaoItens.precoUnitario,
          lote: devolucaoItens.lote,
        })
        .from(devolucaoItens)
        .innerJoin(produtos, eq(produtos.id, devolucaoItens.produtoId))
        .where(eq(devolucaoItens.devolucaoId, dev.id))

      if (itensDev.length === 0) throw new HttpError(400, 'Devolução sem caixas/itens vinculados.')

      let cli = null
      if (dev.pedidoId) {
        const [ped] = await tx.select({ clienteId: pedidos.clienteId }).from(pedidos).where(eq(pedidos.id, dev.pedidoId)).limit(1)
        if (ped?.clienteId) {
          cli = await tx.select().from(clientes).where(eq(clientes.id, ped.clienteId)).limit(1).then((r) => r[0] || null)
        }
      }

      const emitida = await emitirDocumentoFiscalTx(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        modelo: '55',
        tipoOperacao: 'DEVOLUCAO',
        finalidade: '4',
        naturezaOperacao: 'DEVOLUCAO DE VENDA DE MERCADORIA',
        pedidoId: dev.pedidoId,
        devolucaoId: dev.id,
        clienteId: cli?.id || null,
        destinatario: {
          nome: cli?.razaoSocial || dev.clienteNome || 'CLIENTE DEVOLUCAO',
          doc: onlyDigits(cli?.cnpjCpf || ''),
          ie: cli?.inscricaoEstadual || '',
          uf: (cli?.uf || 'SP').toUpperCase(),
          cidade: cli?.cidade || '',
          endereco: [cli?.endereco, cli?.numero].filter(Boolean).join(', '),
        },
        itensRaw: itensDev.map((i) => ({
          produtoId: i.produtoId,
          codigo: i.codigo || '001',
          descricao: i.descricao,
          ncm: i.ncm || '02013000',
          cest: i.cest || '',
          orig: i.orig || '0',
          unidade: 'KG',
          qtd: toNum(i.pesoKg, 0),
          valorUnitario: Math.max(0.01, toNum(i.precoUnit, 0)),
          lote: i.lote || '',
        })),
        pesoLiquidoKg: toNum(dev.pesoTotalKg, 0),
        qtdVolumes: dev.qtdCaixas,
        infComplementarExtra: `Ref. Devolução ${dev.codigo} (${dev.motivo})${dev.pedidoCodigo ? ` • Pedido ${dev.pedidoCodigo}` : ''}`,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      await tx
        .update(devolucoes)
        .set({
          statusFiscal: 'NF_DEVOLUCAO_EMITIDA',
          numeroNfDevolucao: String(emitida.numero),
          fiscalTratadoPorNome: ctx.operador.nome,
          fiscalTratadoEm: new Date(),
        })
        .where(eq(devolucoes.id, dev.id))

      return emitida
    })

    return reply.status(201).send({ success: true, ...nota })
  })

  // ── EMITIR NF-e / NFC-e AVULSA (OU VIA PDV) ────────────────────────────────
  app.post('/api/fiscal/notas/emitir-avulsa', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = EmitirAvulsaSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados fiscais inválidos.')
    const d = parsed.data

    const nota = await conn.db.transaction(async (tx) => {
      let cli = null
      if (d.cliente_id) {
        cli = await tx
          .select()
          .from(clientes)
          .where(and(eq(clientes.id, d.cliente_id), eq(clientes.tenantId, ctx.tenantId)))
          .limit(1)
          .then((r) => r[0] || null)
      }

      const transporte = await resolverTransporteFiscal(tx, ctx.tenantId, d.modelo, d.destinatario_uf || 'SP', {
        mod_frete: d.mod_frete,
        transportadora_id: d.transportadora_id,
        veiculo_id: d.veiculo_id,
        veiculo_placa: d.veiculo_placa,
        veiculo_uf: d.veiculo_uf,
        transportadora_antt: d.transportadora_antt,
        especie_volumes: d.especie_volumes,
      })

      return emitirDocumentoFiscalTx(tx, {
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        modelo: d.modelo,
        tipoOperacao: d.tipo_operacao,
        finalidade: d.tipo_operacao === 'DEVOLUCAO' ? '4' : '1',
        naturezaOperacao:
          d.natureza_operacao ||
          (d.tipo_operacao === 'DEVOLUCAO'
            ? 'DEVOLUCAO DE MERCADORIA'
            : d.modelo === '65'
              ? 'VENDA AO CONSUMIDOR'
              : 'VENDA DE MERCADORIA'),
        clienteId: cli?.id || null,
        destinatario: {
          nome: d.destinatario_nome || cli?.razaoSocial || 'CONSUMIDOR FINAL',
          doc: d.destinatario_doc || onlyDigits(cli?.cnpjCpf || ''),
          ie: d.destinatario_ie || cli?.inscricaoEstadual || '',
          uf: d.destinatario_uf || cli?.uf || 'SP',
          cidade: d.destinatario_cidade || cli?.cidade || '',
          endereco: d.destinatario_endereco || [cli?.endereco, cli?.numero].filter(Boolean).join(', '),
        },
        itensRaw: d.itens.map((it) => ({
          produtoId: it.produto_id || null,
          codigo: it.codigo,
          descricao: it.descricao,
          ncm: it.ncm,
          cest: it.cest,
          cfopExplicito: it.cfop,
          unidade: it.unidade,
          qtd: it.qtd,
          valorUnitario: it.valor_unitario,
          valorDesconto: it.valor_desconto,
        })),
        valorFrete: d.valor_frete,
        transporte,
        formaPagamentoLabel: d.forma_pagamento_label,
        tPag: d.t_pag,
        infComplementarExtra: d.inf_complementar,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })
    })

    return reply.status(201).send({ success: true, ...nota })
  })

  // ── LISTAGEM, DETALHE & DOWNLOAD DE XML DAS NOTAS ──────────────────────────
  app.get('/api/fiscal/notas', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as {
      modelo?: string
      status?: string
      tipo_operacao?: string
      busca?: string
      data_inicio?: string
      data_fim?: string
    }

    const conds = [eq(fiscalNotas.tenantId, ctx.tenantId), eq(fiscalNotas.filialId, ctx.filialId)]
    if (q.modelo && ['55', '65'].includes(q.modelo)) conds.push(eq(fiscalNotas.modelo, q.modelo))
    if (q.status && q.status !== 'TODOS') conds.push(eq(fiscalNotas.status, q.status.toUpperCase()))
    if (q.tipo_operacao && q.tipo_operacao !== 'TODOS') {
      conds.push(eq(fiscalNotas.tipoOperacao, q.tipo_operacao.toUpperCase()))
    }

    const rows = await conn.db
      .select({
        id: fiscalNotas.id,
        modelo: fiscalNotas.modelo,
        tipo_operacao: fiscalNotas.tipoOperacao,
        finalidade: fiscalNotas.finalidade,
        ambiente: fiscalNotas.ambiente,
        provedor_usado: fiscalNotas.provedorUsado,
        serie: fiscalNotas.serie,
        numero: fiscalNotas.numero,
        chave_acesso: fiscalNotas.chaveAcesso,
        protocolo_autorizacao: fiscalNotas.protocoloAutorizacao,
        data_autorizacao: fiscalNotas.dataAutorizacao,
        status: fiscalNotas.status,
        natureza_operacao: fiscalNotas.naturezaOperacao,
        pedido_id: fiscalNotas.pedidoId,
        devolucao_id: fiscalNotas.devolucaoId,
        destinatario_nome: fiscalNotas.destinatarioNome,
        destinatario_doc: fiscalNotas.destinatarioDoc,
        destinatario_uf: fiscalNotas.destinatarioUf,
        valor_produtos: fiscalNotas.valorProdutos,
        valor_icms: fiscalNotas.valorIcms,
        valor_pis: fiscalNotas.valorPis,
        valor_cofins: fiscalNotas.valorCofins,
        valor_total_nf: fiscalNotas.valorTotalNf,
        peso_liquido_kg: fiscalNotas.pesoLiquidoKg,
        emitida_por_nome: fiscalNotas.emitidaPorNome,
        motivo_cancelamento: fiscalNotas.motivoCancelamento,
        created_at: fiscalNotas.createdAt,
      })
      .from(fiscalNotas)
      .where(and(...conds))
      .orderBy(desc(fiscalNotas.createdAt))
      .limit(300)

    const dIni = normalizarDataIso(q.data_inicio)
    const dFim = normalizarDataIso(q.data_fim)
    const bNorm = String(q.busca || '').trim().toLowerCase()

    const filtradas = rows
      .map((r) => ({
        ...r,
        valor_produtos: toNum(r.valor_produtos, 0),
        valor_icms: toNum(r.valor_icms, 0),
        valor_pis: toNum(r.valor_pis, 0),
        valor_cofins: toNum(r.valor_cofins, 0),
        valor_total_nf: toNum(r.valor_total_nf, 0),
        peso_liquido_kg: toNum(r.peso_liquido_kg, 0),
      }))
      .filter((r) => {
        const dia = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ''
        if (dIni && dia < dIni) return false
        if (dFim && dia > dFim) return false
        if (!bNorm) return true
        return (
          String(r.numero).includes(bNorm) ||
          String(r.chave_acesso || '').toLowerCase().includes(bNorm) ||
          String(r.destinatario_nome || '').toLowerCase().includes(bNorm) ||
          String(r.destinatario_doc || '').includes(bNorm)
        )
      })

    const autorizadas = filtradas.filter((n) => n.status === 'AUTORIZADA')
    return {
      success: true,
      resumo: {
        total_notas: filtradas.length,
        autorizadas: autorizadas.length,
        canceladas: filtradas.filter((n) => n.status === 'CANCELADA').length,
        nfe_55: autorizadas.filter((n) => n.modelo === '55').length,
        nfce_65: autorizadas.filter((n) => n.modelo === '65').length,
        valor_total_autorizado: Number(autorizadas.reduce((s, n) => s + n.valor_total_nf, 0).toFixed(2)),
        total_icms: Number(autorizadas.reduce((s, n) => s + n.valor_icms, 0).toFixed(2)),
      },
      data: filtradas,
    }
  })

  app.get('/api/fiscal/notas/:id', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'nota_id')
    const [nota] = await conn.db
      .select()
      .from(fiscalNotas)
      .where(and(eq(fiscalNotas.id, id), eq(fiscalNotas.tenantId, ctx.tenantId)))
      .limit(1)
    if (!nota) throw new HttpError(404, 'Nota fiscal não encontrada.')

    const [eventos, emitente] = await Promise.all([
      conn.db
        .select()
        .from(fiscalEventos)
        .where(eq(fiscalEventos.notaId, nota.id))
        .orderBy(desc(fiscalEventos.createdAt)),
      obterContextoEmitente(conn.db, ctx.tenantId, nota.filialId),
    ])

    return {
      success: true,
      data: {
        id: nota.id,
        modelo: nota.modelo,
        tipo_operacao: nota.tipoOperacao,
        finalidade: nota.finalidade,
        ambiente: nota.ambiente,
        provedor_usado: nota.provedorUsado,
        serie: nota.serie,
        numero: nota.numero,
        chave_acesso: nota.chaveAcesso,
        protocolo_autorizacao: nota.protocoloAutorizacao,
        data_autorizacao: nota.dataAutorizacao,
        status: nota.status,
        natureza_operacao: nota.naturezaOperacao,
        destinatario_nome: nota.destinatarioNome,
        destinatario_doc: nota.destinatarioDoc,
        destinatario_ie: nota.destinatarioIe,
        destinatario_uf: nota.destinatarioUf,
        destinatario_cidade: nota.destinatarioCidade,
        destinatario_endereco: nota.destinatarioEndereco,
        forma_pagamento_label: nota.formaPagamentoLabel,
        valor_produtos: toNum(nota.valorProdutos, 0),
        valor_desconto: toNum(nota.valorDesconto, 0),
        valor_frete: toNum(nota.valorFrete, 0),
        valor_icms_base: toNum(nota.valorIcmsBase, 0),
        valor_icms: toNum(nota.valorIcms, 0),
        valor_icms_st: toNum(nota.valorIcmsSt, 0),
        valor_pis: toNum(nota.valorPis, 0),
        valor_cofins: toNum(nota.valorCofins, 0),
        valor_ibs: toNum(nota.valorIbs, 0),
        valor_cbs: toNum(nota.valorCbs, 0),
        valor_total_nf: toNum(nota.valorTotalNf, 0),
        mod_frete: nota.modFrete || '0',
        transportadora_id: nota.transportadoraId || null,
        transportadora_nome: nota.transportadoraNome || '',
        transportadora_doc: nota.transportadoraDoc || '',
        transportadora_ie: nota.transportadoraIe || '',
        transportadora_endereco: nota.transportadoraEndereco || '',
        transportadora_cidade: nota.transportadoraCidade || '',
        transportadora_uf: nota.transportadoraUf || '',
        transportadora_antt: nota.transportadoraAntt || '',
        veiculo_placa: nota.veiculoPlaca || '',
        veiculo_uf: nota.veiculoUf || '',
        especie_volumes: nota.especieVolumes || 'CAIXA',
        peso_bruto_kg: toNum(nota.pesoBrutoKg, 0),
        peso_liquido_kg: toNum(nota.pesoLiquidoKg, 0),
        qtd_volumes: nota.qtdVolumes,
        duplicatas: Array.isArray(nota.duplicatasJson) ? nota.duplicatasJson : [],
        vendedor_nome: nota.vendedorNome || '',
        condicao_pagamento_label: nota.condicaoPagamentoLabel || '',
        itens: nota.itensJson || [],
        xml_conteudo: nota.xmlConteudo,
        inf_complementar: nota.infComplementar,
        motivo_cancelamento: nota.motivoCancelamento,
        emitida_por_nome: nota.emitidaPorNome,
        created_at: nota.createdAt,
        emitente,
        eventos: eventos.map((e) => ({
          id: e.id,
          tipo_evento: e.tipoEvento,
          sequencia: e.sequencia,
          descricao: e.descricao,
          protocolo: e.protocolo,
          operador_nome: e.operadorNome,
          created_at: e.createdAt,
        })),
      },
    }
  })

  app.get('/api/fiscal/notas/:id/xml', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'nota_id')
    const [nota] = await conn.db
      .select({
        chave: fiscalNotas.chaveAcesso,
        modelo: fiscalNotas.modelo,
        numero: fiscalNotas.numero,
        xml: fiscalNotas.xmlConteudo,
      })
      .from(fiscalNotas)
      .where(and(eq(fiscalNotas.id, id), eq(fiscalNotas.tenantId, ctx.tenantId)))
      .limit(1)
    if (!nota) throw new HttpError(404, 'Nota fiscal não encontrada.')
    return {
      success: true,
      nome_arquivo: `${nota.modelo === '65' ? 'NFCe' : 'NFe'}_${nota.chave}.xml`,
      xml: nota.xml,
    }
  })

  // ── CANCELAMENTO DE NOTA FISCAL ────────────────────────────────────────────
  app.post('/api/fiscal/notas/:id/cancelar', { preHandler: writePerm }, async (req) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'nota_id')
    const body = (req.body || {}) as { motivo?: string }
    const motivo = String(body.motivo || '').trim()
    if (motivo.length < 15) {
      throw new HttpError(400, 'A justificativa de cancelamento SEFAZ deve ter no mínimo 15 caracteres.')
    }

    const res = await conn.db.transaction(async (tx) => {
      const [nota] = await tx
        .select()
        .from(fiscalNotas)
        .where(and(eq(fiscalNotas.id, id), eq(fiscalNotas.tenantId, ctx.tenantId)))
        .limit(1)
      if (!nota) throw new HttpError(404, 'Nota fiscal não encontrada.')
      if (nota.status !== 'AUTORIZADA') {
        throw new HttpError(400, `Somente notas AUTORIZADAS podem ser canceladas (status atual: ${nota.status}).`)
      }

      const emitente = await obterContextoEmitente(tx, ctx.tenantId, nota.filialId)
      const agora = new Date()
      const protocoloEv = gerarProtocoloSimulado(emitente.uf)
      const xmlCanc = gerarXmlEventoFiscal({
        tipoEvento: 'CANCELAMENTO',
        chaveAcesso: nota.chaveAcesso,
        cnpjEmitente: emitente.cnpj,
        ambiente: (nota.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO') as 'HOMOLOGACAO' | 'PRODUCAO',
        sequencia: 1,
        descricao: motivo,
        protocoloOriginal: nota.protocoloAutorizacao,
        protocoloEvento: protocoloEv,
        dataEventoIso: agora.toISOString(),
      })

      await tx
        .update(fiscalNotas)
        .set({
          status: 'CANCELADA',
          motivoCancelamento: motivo,
          xmlCancelamento: xmlCanc,
          canceladaEm: agora,
          updatedAt: agora,
        })
        .where(eq(fiscalNotas.id, nota.id))

      await tx.insert(fiscalEventos).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        filialId: nota.filialId,
        notaId: nota.id,
        tipoEvento: 'CANCELAMENTO',
        sequencia: 1,
        modelo: nota.modelo,
        serie: nota.serie,
        numeroInicial: nota.numero,
        numeroFinal: nota.numero,
        descricao: motivo,
        protocolo: protocoloEv,
        xmlEvento: xmlCanc,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      // Libera o pedido de venda para permitir emissão de uma nova NF-e corrigida
      if (nota.pedidoId) {
        await tx
          .update(pedidos)
          .set({ numeroNf: '', chaveNfe: '', updatedAt: agora })
          .where(eq(pedidos.id, nota.pedidoId))
      }

      return { protocolo: protocoloEv, status: 'CANCELADA' }
    })

    return { success: true, ...res }
  })

  // ── CARTA DE CORREÇÃO ELETRÔNICA (CC-e) ────────────────────────────────────
  app.post('/api/fiscal/notas/:id/carta-correcao', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const id = parseUuidOrBadRequest((req.params as { id: string }).id, 'nota_id')
    const body = (req.body || {}) as { texto_correcao?: string }
    const texto = String(body.texto_correcao || '').trim()
    if (texto.length < 15) {
      throw new HttpError(400, 'O texto da Carta de Correção (CC-e) deve ter no mínimo 15 caracteres.')
    }

    const ev = await conn.db.transaction(async (tx) => {
      const [nota] = await tx
        .select()
        .from(fiscalNotas)
        .where(and(eq(fiscalNotas.id, id), eq(fiscalNotas.tenantId, ctx.tenantId)))
        .limit(1)
      if (!nota) throw new HttpError(404, 'Nota fiscal não encontrada.')
      if (nota.modelo !== '55') {
        throw new HttpError(400, 'Carta de Correção (CC-e) é permitida apenas para NF-e Modelo 55.')
      }
      if (nota.status !== 'AUTORIZADA') {
        throw new HttpError(400, 'Somente NF-e AUTORIZADA pode receber Carta de Correção.')
      }

      const ccesAnteriores = await tx
        .select({ seq: fiscalEventos.sequencia })
        .from(fiscalEventos)
        .where(and(eq(fiscalEventos.notaId, nota.id), eq(fiscalEventos.tipoEvento, 'CARTA_CORRECAO')))
      const proxSeq = ccesAnteriores.reduce((m, x) => Math.max(m, Number(x.seq || 0)), 0) + 1
      if (proxSeq > 20) {
        throw new HttpError(400, 'Limite máximo SEFAZ de 20 Cartas de Correção por NF-e atingido.')
      }

      const emitente = await obterContextoEmitente(tx, ctx.tenantId, nota.filialId)
      const agora = new Date()
      const protocoloEv = gerarProtocoloSimulado(emitente.uf)
      const xmlEv = gerarXmlEventoFiscal({
        tipoEvento: 'CARTA_CORRECAO',
        chaveAcesso: nota.chaveAcesso,
        cnpjEmitente: emitente.cnpj,
        ambiente: (nota.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO') as 'HOMOLOGACAO' | 'PRODUCAO',
        sequencia: proxSeq,
        descricao: texto,
        protocoloEvento: protocoloEv,
        dataEventoIso: agora.toISOString(),
      })

      const evId = uuidv7()
      await tx.insert(fiscalEventos).values({
        id: evId,
        tenantId: ctx.tenantId,
        filialId: nota.filialId,
        notaId: nota.id,
        tipoEvento: 'CARTA_CORRECAO',
        sequencia: proxSeq,
        modelo: nota.modelo,
        serie: nota.serie,
        numeroInicial: nota.numero,
        numeroFinal: nota.numero,
        descricao: texto,
        protocolo: protocoloEv,
        xmlEvento: xmlEv,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })

      return { id: evId, sequencia: proxSeq, protocolo: protocoloEv }
    })

    return reply.status(201).send({ success: true, ...ev })
  })

  // ── INUTILIZAÇÃO DE FAIXA DE NUMERAÇÃO & LISTAGEM DE EVENTOS ───────────────
  app.get('/api/fiscal/eventos', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const rows = await conn.db
      .select({
        id: fiscalEventos.id,
        nota_id: fiscalEventos.notaId,
        tipo_evento: fiscalEventos.tipoEvento,
        sequencia: fiscalEventos.sequencia,
        modelo: fiscalEventos.modelo,
        serie: fiscalEventos.serie,
        numero_inicial: fiscalEventos.numeroInicial,
        numero_final: fiscalEventos.numeroFinal,
        descricao: fiscalEventos.descricao,
        protocolo: fiscalEventos.protocolo,
        operador_nome: fiscalEventos.operadorNome,
        created_at: fiscalEventos.createdAt,
        chave_acesso: fiscalNotas.chaveAcesso,
      })
      .from(fiscalEventos)
      .leftJoin(fiscalNotas, eq(fiscalNotas.id, fiscalEventos.notaId))
      .where(and(eq(fiscalEventos.tenantId, ctx.tenantId), eq(fiscalEventos.filialId, ctx.filialId)))
      .orderBy(desc(fiscalEventos.createdAt))
      .limit(200)
    return { success: true, data: rows }
  })

  app.post('/api/fiscal/inutilizacao', { preHandler: writePerm }, async (req, reply) => {
    const ctx = req.authCtx!
    const parsed = InutilizacaoSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Dados de inutilização inválidos.')
    const d = parsed.data
    if (d.numero_final < d.numero_inicial) {
      throw new HttpError(400, 'Número final deve ser maior ou igual ao número inicial.')
    }

    const ev = await conn.db.transaction(async (tx) => {
      const [cfg, emitente] = await Promise.all([
        obterOuCriarConfigFiscal(tx, ctx.tenantId, ctx.filialId),
        obterContextoEmitente(tx, ctx.tenantId, ctx.filialId),
      ])
      const agora = new Date()
      const protocoloEv = gerarProtocoloSimulado(emitente.uf)
      const xmlEv = gerarXmlEventoFiscal({
        tipoEvento: 'INUTILIZACAO',
        cnpjEmitente: emitente.cnpj,
        ambiente: (cfg.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO') as 'HOMOLOGACAO' | 'PRODUCAO',
        sequencia: 1,
        descricao: d.justificativa,
        protocoloEvento: protocoloEv,
        dataEventoIso: agora.toISOString(),
        modelo: d.modelo,
        serie: d.serie,
        numeroInicial: d.numero_inicial,
        numeroFinal: d.numero_final,
      })
      const id = uuidv7()
      await tx.insert(fiscalEventos).values({
        id,
        tenantId: ctx.tenantId,
        filialId: ctx.filialId,
        notaId: null,
        tipoEvento: 'INUTILIZACAO',
        sequencia: 1,
        modelo: d.modelo,
        serie: d.serie,
        numeroInicial: d.numero_inicial,
        numeroFinal: d.numero_final,
        descricao: d.justificativa,
        protocolo: protocoloEv,
        xmlEvento: xmlEv,
        operadorId: ctx.operador.id,
        operadorNome: ctx.operador.nome,
      })
      return { id, protocolo: protocoloEv }
    })

    return reply.status(201).send({ success: true, ...ev })
  })

  // ── COFRE XML DO MÊS (EXPORTAÇÃO EM LOTE PARA O CONTADOR) ──────────────────
  app.get('/api/fiscal/cofre-xml', { preHandler: readPerm }, async (req) => {
    const ctx = req.authCtx!
    const q = (req.query || {}) as { mes?: string }
    const mes = /^\d{4}-\d{2}$/.test(String(q.mes || '')) ? String(q.mes) : hojeIsoLocal().slice(0, 7)

    const [notasRows, eventosRows] = await Promise.all([
      conn.db
        .select()
        .from(fiscalNotas)
        .where(and(eq(fiscalNotas.tenantId, ctx.tenantId), eq(fiscalNotas.filialId, ctx.filialId)))
        .orderBy(desc(fiscalNotas.createdAt)),
      conn.db
        .select()
        .from(fiscalEventos)
        .where(and(eq(fiscalEventos.tenantId, ctx.tenantId), eq(fiscalEventos.filialId, ctx.filialId)))
        .orderBy(desc(fiscalEventos.createdAt)),
    ])

    const notasMes = notasRows.filter((n) => new Date(n.createdAt).toISOString().slice(0, 7) === mes)
    const eventosMes = eventosRows.filter((e) => new Date(e.createdAt).toISOString().slice(0, 7) === mes)

    const arquivos = [
      ...notasMes.map((n) => ({
        nome: `${n.modelo === '65' ? 'NFCe' : 'NFe'}_${n.serie}_${n.numero}_${n.chaveAcesso}_${n.status}.xml`,
        tipo: n.modelo === '65' ? 'NFC-e 65' : 'NF-e 55',
        numero: n.numero,
        serie: n.serie,
        chave: n.chaveAcesso,
        status: n.status,
        destinatario: n.destinatarioNome,
        valor: toNum(n.valorTotalNf, 0),
        data: n.createdAt,
        xml: n.xmlConteudo,
      })),
      ...eventosMes.map((e) => ({
        nome: `EVENTO_${e.tipoEvento}_S${e.serie}_N${e.numeroInicial}_${e.sequencia}.xml`,
        tipo: e.tipoEvento,
        numero: e.numeroInicial,
        serie: e.serie,
        chave: e.protocolo,
        status: 'HOMOLOGADO',
        destinatario: e.descricao.slice(0, 60),
        valor: 0,
        data: e.createdAt,
        xml: e.xmlEvento,
      })),
    ]

    return {
      success: true,
      mes,
      resumo: {
        qtd_notas: notasMes.length,
        qtd_nfe_55: notasMes.filter((n) => n.modelo === '55').length,
        qtd_nfce_65: notasMes.filter((n) => n.modelo === '65').length,
        qtd_canceladas: notasMes.filter((n) => n.status === 'CANCELADA').length,
        qtd_eventos: eventosMes.length,
        valor_total_autorizado: Number(
          notasMes
            .filter((n) => n.status === 'AUTORIZADA')
            .reduce((s, n) => s + toNum(n.valorTotalNf, 0), 0)
            .toFixed(2),
        ),
      },
      arquivos,
    }
  })
}
