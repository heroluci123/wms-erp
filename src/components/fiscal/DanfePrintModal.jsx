import React, { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { CheckSquare, ClipboardList, CreditCard, Download, FileText, Layers, Printer, Truck, X } from 'lucide-react'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtNum = (v, dec = 2) =>
  Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })

const fmtChave = (c) =>
  String(c || '')
    .replace(/\D/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim()

const fmtNumNota = (n) => {
  const s = String(n || 0).padStart(9, '0')
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}`
}

const fmtDoc = (d) => {
  const s = String(d || '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d || '-'
}

const fmtData = (d) => {
  if (!d) return '-'
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    const [y, m, day] = String(d).split('-')
    return `${day}/${m}/${y}`
  }
  try {
    return new Date(d).toLocaleDateString('pt-BR')
  } catch {
    return String(d)
  }
}

const fmtHora = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return '-'
  }
}

const fmtDataHora = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleString('pt-BR')
  } catch {
    return String(d)
  }
}

const MOD_FRETE_LABEL = {
  '0': '0 - Emitente (CIF)',
  '1': '1 - Destinatário (FOB)',
  '2': '2 - Terceiros',
  '3': '3 - Próprio Remet.',
  '4': '4 - Próprio Dest.',
  '9': '9 - Sem Frete',
}

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function gerarBarcodeSvg(codigo, height = 36, width = 1.05) {
  if (!codigo || typeof document === 'undefined') return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, String(codigo).replace(/\D/g, ''), {
      format: 'CODE128',
      width,
      height,
      displayValue: false,
      margin: 2,
      background: '#ffffff',
      lineColor: '#000000',
    })
    return svg.outerHTML
  } catch {
    return ''
  }
}

function construirBoletosFallback(nota) {
  if (Array.isArray(nota.boletos) && nota.boletos.length > 0) return nota.boletos
  const emit = nota.emitente || {}
  const dups = Array.isArray(nota.duplicatas) && nota.duplicatas.length > 0
    ? nota.duplicatas
    : [
        {
          numero: '001',
          vencimento: nota.data_autorizacao || nota.created_at || new Date().toISOString().slice(0, 10),
          valor: Number(nota.valor_total_nf || 0),
        },
      ]
  return dups.map((d, idx) => {
    const nossoNumero = `${String(nota.numero || 1).padStart(7, '0')}${String(idx + 1).padStart(2, '0')}`
    const valorCent = String(Math.round(Number(d.valor || 0) * 100)).padStart(10, '0').slice(-10)
    const codBarras = `001919500${valorCent}123400056789${nossoNumero}1700`.slice(0, 44)
    return {
      parcela_numero: d.numero || String(idx + 1).padStart(3, '0'),
      parcela_total: dups.length,
      nosso_numero: nossoNumero,
      numero_documento: `${String(nota.numero || 1).padStart(6, '0')}/${d.numero || '001'}`,
      data_documento: nota.data_autorizacao || nota.created_at || new Date().toISOString().slice(0, 10),
      vencimento: d.vencimento,
      valor: Number(d.valor || 0),
      banco_codigo: '001-9',
      banco_nome: 'BANCO DO BRASIL S.A. (SIMULAÇÃO)',
      agencia_codigo_cedente: '1234-5 / 00056789-0',
      carteira: '17',
      especie_doc: 'DM',
      aceite: 'N',
      codigo_barras: codBarras,
      linha_digitavel: `00191.23409 00567.89${nossoNumero.slice(0, 3)}6 ${nossoNumero.slice(3)}.170004 1 9500${valorCent}`,
      simulado: true,
      cedente: {
        nome: emit.razaoSocial || emit.nomeFantasia || 'EMPRESA EMITENTE',
        cnpj: emit.cnpj || '',
        cidade: emit.cidade || 'SAO PAULO',
        uf: emit.uf || 'SP',
      },
      sacado: {
        nome: nota.destinatario_nome || 'CLIENTE',
        doc: nota.destinatario_doc || '',
        endereco: nota.destinatario_endereco || '',
        cidade: nota.destinatario_cidade || '',
        uf: nota.destinatario_uf || 'SP',
      },
      instrucoes: [
        'Pagável em qualquer banco ou via Internet Banking até o vencimento.',
        'Após o vencimento cobrar multa de 2,00% e juros de mora de 0,033% ao dia.',
        `Referente à NF-e Nº ${String(nota.numero || 1).padStart(6, '0')} (Série ${nota.serie || 1}).`,
      ],
    }
  })
}

function construirRomaneioFallback(nota) {
  if (nota.romaneio_produtos && Array.isArray(nota.romaneio_produtos.itens)) {
    return nota.romaneio_produtos
  }
  const itens = Array.isArray(nota.itens) ? nota.itens : []
  return {
    pedido_codigo: nota.pedido_codigo || `NF-${nota.numero}`,
    pedido_titulo: nota.pedido_titulo || nota.natureza_operacao || 'VENDA DE MERCADORIA',
    previsao_entrega: nota.data_autorizacao || nota.created_at,
    vendedor_nome: nota.vendedor_nome || '-',
    condicao_pagamento: nota.condicao_pagamento_label || nota.forma_pagamento_label || 'À VISTA',
    cliente: {
      razao_social: nota.destinatario_nome,
      nome_fantasia: nota.destinatario_nome,
      cnpj_cpf: nota.destinatario_doc,
      inscricao_estadual: nota.destinatario_ie,
      endereco: nota.destinatario_endereco,
      cidade: nota.destinatario_cidade,
      uf: nota.destinatario_uf,
    },
    total_caixas: nota.qtd_volumes || itens.length || 1,
    total_peso_kg: Number(nota.peso_liquido_kg || 0),
    valor_total: Number(nota.valor_total_nf || 0),
    itens: itens.map((it) => ({
      codigo: it.codigo,
      descricao: it.descricao,
      unidade: it.unidade || 'KG',
      qtd_caixas: 1,
      peso_kg: Number(it.qtd || 0),
      preco_unitario: Number(it.valor_unitario || 0),
      valor_total: Number(it.valor_total || 0),
      lotes: it.lote || '',
    })),
  }
}

function renderizarHtmlDanfeA4(nota) {
  const emit = nota.emitente || {}
  const itens = Array.isArray(nota.itens) ? nota.itens : []
  const duplicatas = Array.isArray(nota.duplicatas) ? nota.duplicatas : []
  const isHomolog = nota.ambiente !== 'PRODUCAO'
  const barcodeSvg = gerarBarcodeSvg(nota.chave_acesso, 36, 1.05)
  const modFreteTxt = MOD_FRETE_LABEL[String(nota.mod_frete ?? '0')] || '0 - Emitente (CIF)'
  const bcIbsCbsTotal = itens.reduce((s, i) => s + Number(i.v_bc_ibs_cbs || 0), 0)
  const totalIbs = Number(nota.valor_ibs ?? itens.reduce((s, i) => s + Number(i.v_ibs_uf || 0), 0))
  const totalCbs = Number(nota.valor_cbs ?? itens.reduce((s, i) => s + Number(i.v_cbs || 0), 0))
  const dtEmissao = nota.data_autorizacao || nota.created_at

  const dupsHtml =
    duplicatas.length > 0
      ? duplicatas
          .map(
            (d) => `<div class="dup-item">
              <div><strong>#${escHtml(d.numero)}</strong></div>
              <div>Venc: <strong>${escHtml(fmtData(d.vencimento))}</strong></div>
              <div style="font-weight:800;">${escHtml(fmtMoeda(d.valor))}</div>
            </div>`,
          )
          .join('')
      : `<div class="dup-empty">Condição: <strong>${escHtml(nota.condicao_pagamento_label || nota.forma_pagamento_label || 'À VISTA')}</strong> • Valor Líquido: <strong>${escHtml(fmtMoeda(nota.valor_total_nf))}</strong></div>`

  const itensRows = itens
    .map((it) => {
      const cClass = it.c_class_trib || ''
      const ncmCell = cClass
        ? `${escHtml(it.ncm)}<div class="sub-code">[${escHtml(cClass)}]</div>`
        : escHtml(it.ncm)
      const descCell = `${escHtml(it.descricao)}${it.lote ? `<div class="sub-code">Lote: ${escHtml(it.lote)}</div>` : ''}`
      const cstFull = `${escHtml(it.orig || '0')}${escHtml(String(it.cst_csosn || '').padStart(2, '0'))}`
      const ibsCbsItem = Number(it.v_ibs_uf || 0) + Number(it.v_cbs || 0)
      return `<tr>
        <td class="mono">${escHtml(it.codigo)}</td>
        <td>${descCell}</td>
        <td class="mono c">${ncmCell}</td>
        <td class="mono c">${cstFull}</td>
        <td class="mono c">${escHtml(it.cfop)}</td>
        <td class="c">${escHtml(it.unidade)}</td>
        <td class="mono r">${fmtNum(it.qtd, 3)}</td>
        <td class="mono r">${fmtNum(it.valor_unitario, 2)}</td>
        <td class="mono r b">${fmtNum(it.valor_total, 2)}</td>
        <td class="mono r">${fmtNum(it.v_bc_icms, 2)}</td>
        <td class="mono r">${fmtNum(it.v_icms, 2)}</td>
        <td class="mono r">${fmtNum(it.p_icms, 1)}%</td>
        <td class="mono r">${ibsCbsItem > 0 ? fmtNum(ibsCbsItem, 2) : '0,00'}</td>
      </tr>`
    })
    .join('')

  return `
    <div class="page-sheet">
      ${
        isHomolog
          ? `<div class="center-watermark">SEM VALOR FISCAL<br/><span>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO</span></div>`
          : ''
      }
      ${
        nota.status === 'CANCELADA'
          ? `<div class="center-watermark canceled-wm">NF-e CANCELADA<br/><span>SEM VALIDADE FISCAL</span></div>`
          : ''
      }

      ${nota.status === 'CANCELADA' ? `<div class="canceled">NF-e CANCELADA — SEM VALIDADE JURÍDICA (${escHtml(nota.motivo_cancelamento)})</div>` : ''}
      ${isHomolog ? `<div class="watermark">AMBIENTE DE HOMOLOGAÇÃO — NOTA FISCAL EMITIDA SEM VALOR FISCAL</div>` : ''}

      <div class="canhoto">
        <div class="canhoto-left">
          <div class="canhoto-top">
            RECEBEMOS DE <strong>${escHtml(emit.razaoSocial || emit.nomeFantasia)}</strong> OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO.
            DESTINATÁRIO: <strong>${escHtml(nota.destinatario_nome)}</strong> • VALOR TOTAL: <strong>${escHtml(fmtMoeda(nota.valor_total_nf))}</strong> • EMISSÃO: <strong>${escHtml(fmtData(dtEmissao))}</strong>
          </div>
          <div class="canhoto-bot">
            <div><span class="lbl">Data de Recebimento</span></div>
            <div><span class="lbl">Identificação e Assinatura do Recebedor</span></div>
          </div>
        </div>
        <div class="canhoto-right">
          <div style="font-size:9px;font-weight:900;">NF-e</div>
          <div style="font-size:9.5px;font-weight:900;">Nº ${escHtml(fmtNumNota(nota.numero))}</div>
          <div style="font-size:8px;font-weight:700;">SÉRIE ${escHtml(nota.serie)}</div>
        </div>
      </div>
      <hr class="cut-line"/>

      <div class="box-round">
        <div class="grid" style="grid-template-columns: 2.15fr 0.95fr 2.15fr;">
          <div class="cell">
            <span class="brand-pill">WMSphere ERP • NF-e 4.00</span>
            <div style="font-size:11.5px;font-weight:900;line-height:1.15;margin-top:2px;">${escHtml(emit.razaoSocial || emit.nomeFantasia)}</div>
            ${emit.nomeFantasia && emit.nomeFantasia !== emit.razaoSocial ? `<div style="font-size:8px;font-weight:700;color:#000000;">${escHtml(emit.nomeFantasia)}</div>` : ''}
            <div style="margin-top:3px;font-size:8px;">${escHtml(emit.cidade || '')} - ${escHtml(emit.uf || 'SP')} • Regime: <strong>${escHtml(emit.regime || 'SIMPLES')}</strong></div>
            <div style="font-size:8px;">CNPJ: <strong>${escHtml(fmtDoc(emit.cnpj))}</strong> • IE: <strong>${escHtml(emit.ie || 'ISENTO')}</strong></div>
          </div>
          <div class="cell danfe-center">
            <div style="font-size:13px;font-weight:900;letter-spacing:1px;">DANFE</div>
            <div style="font-size:6.5px;line-height:1.15;">Documento Auxiliar da Nota Fiscal Eletrônica</div>
            <div class="tipo-box">
              <div style="text-align:left;font-size:6.5px;line-height:1.2;">0 - ENTRADA<br/>1 - SAÍDA</div>
              <div class="tipo-sq">${nota.tipo_operacao === 'SAIDA' ? '1' : '0'}</div>
            </div>
            <div style="font-size:9.5px;font-weight:900;">Nº ${escHtml(fmtNumNota(nota.numero))}</div>
            <div style="font-size:8px;font-weight:700;">SÉRIE ${escHtml(nota.serie)} • Folha 1/1</div>
          </div>
          <div class="cell">
            <div style="text-align:center;">${barcodeSvg}</div>
            <span class="lbl">Chave de Acesso</span>
            <div class="mono" style="font-size:7.8px;font-weight:800;text-align:center;letter-spacing:0.2px;">${escHtml(fmtChave(nota.chave_acesso))}</div>
            <div style="font-size:6.3px;text-align:center;color:#000000;margin-top:2px;line-height:1.2;">
              Consulta de autenticidade no portal nacional da NF-e <strong>www.nfe.fazenda.gov.br/portal</strong> ou no site da SEFAZ Autorizadora.
            </div>
          </div>
        </div>
        <div class="grid" style="grid-template-columns: 2.7fr 2.55fr;">
          <div class="cell"><span class="lbl">Natureza da Operação</span><span class="val">${escHtml(nota.natureza_operacao)}</span></div>
          <div class="cell"><span class="lbl">Protocolo de Autorização de Uso</span><span class="val mono">${escHtml(nota.protocolo_autorizacao || '-')} — ${escHtml(fmtDataHora(dtEmissao))}</span></div>
        </div>
        <div class="grid row-last" style="grid-template-columns: 1.5fr 1.5fr 2.25fr;">
          <div class="cell"><span class="lbl">Inscrição Estadual</span><span class="val mono">${escHtml(emit.ie || 'ISENTO')}</span></div>
          <div class="cell"><span class="lbl">Inscrição Estadual do Subst. Tributário</span><span class="val mono">-</span></div>
          <div class="cell"><span class="lbl">CNPJ do Emitente</span><span class="val mono">${escHtml(fmtDoc(emit.cnpj))}</span></div>
        </div>
      </div>

      <div class="sec"><span>Destinatário / Remetente</span><span>Emissão: ${escHtml(fmtData(dtEmissao))}</span></div>
      <div class="box">
        <div class="grid" style="grid-template-columns: 3.1fr 1.2fr 0.95fr;">
          <div class="cell"><span class="lbl">Nome / Razão Social</span><span class="val">${escHtml(nota.destinatario_nome)}</span></div>
          <div class="cell"><span class="lbl">CNPJ / CPF</span><span class="val mono">${escHtml(fmtDoc(nota.destinatario_doc))}</span></div>
          <div class="cell"><span class="lbl">Data da Emissão</span><span class="val mono">${escHtml(fmtData(dtEmissao))}</span></div>
        </div>
        <div class="grid row-last" style="grid-template-columns: 2.35fr 1.25fr 0.35fr 0.85fr 0.65fr;">
          <div class="cell"><span class="lbl">Endereço</span><span class="val">${escHtml(nota.destinatario_endereco || '-')}</span></div>
          <div class="cell"><span class="lbl">Município</span><span class="val">${escHtml(nota.destinatario_cidade || '-')}</span></div>
          <div class="cell c"><span class="lbl">UF</span><span class="val">${escHtml(nota.destinatario_uf || '-')}</span></div>
          <div class="cell"><span class="lbl">Inscrição Estadual</span><span class="val mono">${escHtml(nota.destinatario_ie || 'ISENTO')}</span></div>
          <div class="cell"><span class="lbl">Hora Saída</span><span class="val mono">${escHtml(fmtHora(dtEmissao))}</span></div>
        </div>
      </div>

      <div class="sec"><span>Fatura / Duplicatas</span><span>${duplicatas.length > 0 ? `${duplicatas.length} parcela(s)` : 'À Vista / Condição Direta'}</span></div>
      <div class="box">
        <div class="dups-wrap">${dupsHtml}</div>
      </div>

      <div class="sec"><span>Cálculo do Imposto</span><span>Reforma Tributária 2026 (LC 214/2025) integrada</span></div>
      <div class="box">
        <div class="grid" style="grid-template-columns: repeat(5, 1fr);">
          <div class="cell r"><span class="lbl">Base de Cálculo do ICMS</span><span class="val mono">${escHtml(fmtNum(nota.valor_icms_base))}</span></div>
          <div class="cell r"><span class="lbl">Valor do ICMS</span><span class="val mono">${escHtml(fmtNum(nota.valor_icms))}</span></div>
          <div class="cell r"><span class="lbl">Base Cálc. ICMS S.T.</span><span class="val mono">0,00</span></div>
          <div class="cell r"><span class="lbl">Valor do ICMS Subst.</span><span class="val mono">${escHtml(fmtNum(nota.valor_icms_st))}</span></div>
          <div class="cell r"><span class="lbl">V. Total dos Produtos</span><span class="val mono">${escHtml(fmtNum(nota.valor_produtos))}</span></div>
        </div>
        <div class="grid" style="grid-template-columns: repeat(5, 1fr);">
          <div class="cell r"><span class="lbl">Valor do Frete</span><span class="val mono">${escHtml(fmtNum(nota.valor_frete))}</span></div>
          <div class="cell r"><span class="lbl">Valor do Desconto</span><span class="val mono">${escHtml(fmtNum(nota.valor_desconto))}</span></div>
          <div class="cell r"><span class="lbl">PIS / COFINS</span><span class="val mono">${escHtml(fmtNum(Number(nota.valor_pis || 0) + Number(nota.valor_cofins || 0)))}</span></div>
          <div class="cell r"><span class="lbl">Valor Total do IPI</span><span class="val mono">0,00</span></div>
          <div class="cell r" style="background:#d4d4d4;"><span class="lbl">V. Total da Nota</span><span class="val-lg mono">${escHtml(fmtMoeda(nota.valor_total_nf))}</span></div>
        </div>
        <div class="grid row-last reforma-strip" style="grid-template-columns: repeat(4, 1fr);">
          <div class="cell r"><span class="lbl">Base Cálc. IBS / CBS (2026)</span><span class="val mono">${escHtml(fmtNum(bcIbsCbsTotal))}</span></div>
          <div class="cell r"><span class="lbl">Valor Total IBS (UF/Mun)</span><span class="val mono">${escHtml(fmtNum(totalIbs))}</span></div>
          <div class="cell r"><span class="lbl">Valor Total CBS (Federal)</span><span class="val mono">${escHtml(fmtNum(totalCbs))}</span></div>
          <div class="cell r"><span class="lbl">Total IBS + CBS (LC 214/2025)</span><span class="val mono">${escHtml(fmtNum(totalIbs + totalCbs))}</span></div>
        </div>
      </div>

      <div class="sec"><span>Transportador / Volumes Transportados</span><span>${escHtml(modFreteTxt)}</span></div>
      <div class="box">
        <div class="grid" style="grid-template-columns: 2.15fr 1.15fr 0.75fr 0.75fr 0.35fr 1.1fr;">
          <div class="cell"><span class="lbl">Nome / Razão Social</span><span class="val">${escHtml(nota.transportadora_nome || 'TRANSPORTE PRÓPRIO / NÃO INFORMADO')}</span></div>
          <div class="cell"><span class="lbl">Frete por Conta</span><span class="val">${escHtml(modFreteTxt)}</span></div>
          <div class="cell"><span class="lbl">Código ANTT</span><span class="val mono">${escHtml(nota.transportadora_antt || '-')}</span></div>
          <div class="cell"><span class="lbl">Placa do Veículo</span><span class="val mono">${escHtml(nota.veiculo_placa || '-')}</span></div>
          <div class="cell c"><span class="lbl">UF</span><span class="val">${escHtml(nota.veiculo_uf || '-')}</span></div>
          <div class="cell"><span class="lbl">CNPJ / CPF</span><span class="val mono">${escHtml(nota.transportadora_doc ? fmtDoc(nota.transportadora_doc) : '-')}</span></div>
        </div>
        <div class="grid" style="grid-template-columns: 2.75fr 1.65fr 0.35fr 1.5fr;">
          <div class="cell"><span class="lbl">Endereço</span><span class="val">${escHtml(nota.transportadora_endereco || '-')}</span></div>
          <div class="cell"><span class="lbl">Município</span><span class="val">${escHtml(nota.transportadora_cidade || '-')}</span></div>
          <div class="cell c"><span class="lbl">UF</span><span class="val">${escHtml(nota.transportadora_uf || '-')}</span></div>
          <div class="cell"><span class="lbl">Inscrição Estadual</span><span class="val mono">${escHtml(nota.transportadora_ie || '-')}</span></div>
        </div>
        <div class="grid row-last" style="grid-template-columns: 0.7fr 1fr 1fr 0.9fr 1.1fr 1.1fr;">
          <div class="cell r"><span class="lbl">Quantidade</span><span class="val mono">${nota.qtd_volumes || 1}</span></div>
          <div class="cell"><span class="lbl">Espécie</span><span class="val">${escHtml(nota.especie_volumes || 'CAIXA')}</span></div>
          <div class="cell"><span class="lbl">Marca</span><span class="val">${escHtml(emit.nomeFantasia || '-')}</span></div>
          <div class="cell"><span class="lbl">Numeração</span><span class="val">-</span></div>
          <div class="cell r"><span class="lbl">Peso Bruto (kg)</span><span class="val mono">${escHtml(fmtNum(nota.peso_bruto_kg, 3))}</span></div>
          <div class="cell r"><span class="lbl">Peso Líquido (kg)</span><span class="val mono">${escHtml(fmtNum(nota.peso_liquido_kg, 3))}</span></div>
        </div>
      </div>

      <div class="sec"><span>Dados dos Produtos / Serviços</span><span>${itens.length} item(ns)</span></div>
      <table>
        <thead>
          <tr>
            <th style="width:46px;">Cód.</th>
            <th>Descrição do Produto / Serviço</th>
            <th style="width:62px;">NCM / cClassTrib</th>
            <th style="width:36px;">O/CST</th>
            <th style="width:36px;">CFOP</th>
            <th style="width:26px;">Un</th>
            <th style="width:48px;text-align:right;">Quant.</th>
            <th style="width:48px;text-align:right;">V.Unit</th>
            <th style="width:54px;text-align:right;">V.Total</th>
            <th style="width:50px;text-align:right;">BC ICMS</th>
            <th style="width:46px;text-align:right;">V.ICMS</th>
            <th style="width:36px;text-align:right;">Alíq.</th>
            <th style="width:44px;text-align:right;">IBS/CBS</th>
          </tr>
        </thead>
        <tbody>${itensRows}</tbody>
      </table>

      <div class="sec"><span>Dados Adicionais</span><span>Reservado ao Fisco</span></div>
      <div class="box">
        <div class="grid row-last" style="grid-template-columns: 2.35fr 1fr;">
          <div class="cell" style="min-height:52px;">
            <span class="lbl">Informações Complementares</span>
            <div style="font-size:7.6px;line-height:1.35;">
              ${escHtml(nota.inf_complementar || 'ICMS com redução de base de cálculo — Art. 74 Anexo II RICMS/SP (Cesta Básica Carnes). PIS/COFINS alíquota zero conforme Lei 10.925/2004.')}
              ${nota.vendedor_nome ? ` • Vendedor: <strong>${escHtml(nota.vendedor_nome)}</strong>` : ''}
              ${nota.condicao_pagamento_label ? ` • Cond. Pagto: <strong>${escHtml(nota.condicao_pagamento_label)}</strong>` : ''}
            </div>
          </div>
          <div class="cell" style="min-height:52px;background:#ffffff;">
            <span class="lbl">Reservado ao Fisco</span>
            <div class="mono" style="font-size:7px;color:#000000;margin-top:4px;">
              Emitida por: ${escHtml(nota.emitida_por_nome || 'Sistema')}<br/>
              Provedor: ${escHtml(nota.provedor_usado || 'SIMULACAO_LOCAL')}
            </div>
          </div>
        </div>
      </div>

      <div class="footer-erp">
        <span>WMSphere ERP — Documento Auxiliar gerado conforme Manual de Orientação do Contribuinte NF-e 4.00 / NT 2025.002 (IBS/CBS)</span>
        <span>Impresso em ${escHtml(fmtDataHora(new Date()))}</span>
      </div>
    </div>`
}

function renderizarHtmlBoletosNota(nota) {
  const boletos = construirBoletosFallback(nota)
  return boletos
    .map((b) => {
      const barcodeBoleto = gerarBarcodeSvg(b.codigo_barras, 44, 1.15)
      const instHtml = (b.instrucoes || []).map((l) => `<div>• ${escHtml(l)}</div>`).join('')
      return `
      <div class="page-sheet">
        ${
          b.simulado
            ? `<div class="center-watermark">BOLETO SIMULADO<br/><span>SEM VALOR BANCÁRIO — HOMOLOGAÇÃO</span></div>`
            : ''
        }
        ${
          b.simulado
            ? `<div class="watermark">SIMULAÇÃO DE BOLETO BANCÁRIO FEBRABAN — SEM REGISTRO BANCÁRIO OFICIAL</div>`
            : ''
        }

        <!-- RECIBO DO PAGADOR -->
        <div class="sec"><span>Recibo do Pagador — Parcela ${escHtml(b.parcela_numero)}/${escHtml(b.parcela_total)}</span><span>NF-e Nº ${escHtml(fmtNumNota(nota.numero))}</span></div>
        <div class="box" style="margin-bottom:8px;">
          <div class="grid" style="grid-template-columns: 1.4fr 0.7fr 1.8fr;">
            <div class="cell"><span class="lbl">Banco</span><span class="val">${escHtml(b.banco_nome)}</span></div>
            <div class="cell c"><span class="lbl">Cód. Banco</span><span class="val-lg mono">${escHtml(b.banco_codigo)}</span></div>
            <div class="cell r"><span class="lbl">Linha Digitável</span><span class="val mono">${escHtml(b.linha_digitavel)}</span></div>
          </div>
          <div class="grid" style="grid-template-columns: 2.2fr 1fr 0.9fr 1fr;">
            <div class="cell"><span class="lbl">Beneficiário / Cedente</span><span class="val">${escHtml(b.cedente?.nome)} (${escHtml(fmtDoc(b.cedente?.cnpj))})</span></div>
            <div class="cell"><span class="lbl">Agência / Cód. Beneficiário</span><span class="val mono">${escHtml(b.agencia_codigo_cedente)}</span></div>
            <div class="cell"><span class="lbl">Nosso Número</span><span class="val mono">${escHtml(b.nosso_numero)}</span></div>
            <div class="cell r" style="background:#d4d4d4;"><span class="lbl">Vencimento</span><span class="val-lg mono">${escHtml(fmtData(b.vencimento))}</span></div>
          </div>
          <div class="grid row-last" style="grid-template-columns: 2.2fr 1fr 0.9fr 1fr;">
            <div class="cell"><span class="lbl">Pagador / Sacado</span><span class="val">${escHtml(b.sacado?.nome)} — ${escHtml(fmtDoc(b.sacado?.doc))}</span></div>
            <div class="cell"><span class="lbl">Nº do Documento</span><span class="val mono">${escHtml(b.numero_documento)}</span></div>
            <div class="cell"><span class="lbl">Data Documento</span><span class="val mono">${escHtml(fmtData(b.data_documento))}</span></div>
            <div class="cell r" style="background:#d4d4d4;"><span class="lbl">(=) Valor do Documento</span><span class="val-lg mono">${escHtml(fmtMoeda(b.valor))}</span></div>
          </div>
        </div>

        <hr class="cut-line" style="margin: 12px 0;"/>

        <!-- FICHA DE COMPENSAÇÃO -->
        <div class="box-round">
          <div class="grid" style="grid-template-columns: 1.5fr 0.55fr 2.8fr; background:#ffffff;">
            <div class="cell" style="display:flex;align-items:center;font-weight:900;font-size:11px;">${escHtml(b.banco_nome)}</div>
            <div class="cell c" style="display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;">${escHtml(b.banco_codigo)}</div>
            <div class="cell r" style="display:flex;align-items:center;justify-content:flex-end;font-weight:900;font-size:10.5px;" class="mono">${escHtml(b.linha_digitavel)}</div>
          </div>

          <div class="grid" style="grid-template-columns: 3.6fr 1.25fr;">
            <div class="cell"><span class="lbl">Local de Pagamento</span><span class="val">PAGÁVEL EM QUALQUER BANCO OU CORTE PIX / INTERNET BANKING ATÉ O VENCIMENTO</span></div>
            <div class="cell r" style="background:#d4d4d4;"><span class="lbl">Vencimento</span><span class="val-lg mono">${escHtml(fmtData(b.vencimento))}</span></div>
          </div>

          <div class="grid" style="grid-template-columns: 3.6fr 1.25fr;">
            <div class="cell"><span class="lbl">Beneficiário / Cedente</span><span class="val">${escHtml(b.cedente?.nome)} • CNPJ: ${escHtml(fmtDoc(b.cedente?.cnpj))} • ${escHtml(b.cedente?.cidade || '')}/${escHtml(b.cedente?.uf || 'SP')}</span></div>
            <div class="cell r"><span class="lbl">Agência / Código Beneficiário</span><span class="val mono">${escHtml(b.agencia_codigo_cedente)}</span></div>
          </div>

          <div class="grid" style="grid-template-columns: 0.9fr 1.1fr 0.55fr 0.45fr 0.6fr 1.25fr;">
            <div class="cell"><span class="lbl">Data do Doc.</span><span class="val mono">${escHtml(fmtData(b.data_documento))}</span></div>
            <div class="cell"><span class="lbl">Nº do Documento</span><span class="val mono">${escHtml(b.numero_documento)}</span></div>
            <div class="cell c"><span class="lbl">Espécie Doc.</span><span class="val">${escHtml(b.especie_doc)}</span></div>
            <div class="cell c"><span class="lbl">Aceite</span><span class="val">${escHtml(b.aceite)}</span></div>
            <div class="cell"><span class="lbl">Data Proc.</span><span class="val mono">${escHtml(fmtData(b.data_documento))}</span></div>
            <div class="cell r"><span class="lbl">Nosso Número</span><span class="val mono">${escHtml(b.nosso_numero)}</span></div>
          </div>

          <div class="grid" style="grid-template-columns: 0.9fr 0.6fr 0.5fr 0.8fr 0.8fr 1.25fr;">
            <div class="cell"><span class="lbl">Uso do Banco</span><span class="val">-</span></div>
            <div class="cell c"><span class="lbl">Carteira</span><span class="val mono">${escHtml(b.carteira)}</span></div>
            <div class="cell c"><span class="lbl">Espécie</span><span class="val">R$</span></div>
            <div class="cell"><span class="lbl">Quantidade</span><span class="val">-</span></div>
            <div class="cell"><span class="lbl">Valor</span><span class="val">-</span></div>
            <div class="cell r" style="background:#d4d4d4;"><span class="lbl">(=) Valor do Documento</span><span class="val-lg mono">${escHtml(fmtMoeda(b.valor))}</span></div>
          </div>

          <div class="grid" style="grid-template-columns: 3.6fr 1.25fr;">
            <div class="cell" style="min-height:86px;">
              <span class="lbl">Instruções (Texto de responsabilidade do Beneficiário)</span>
              <div style="font-size:8.5px;line-height:1.45;margin-top:4px;">${instHtml}</div>
            </div>
            <div style="display:flex;flex-direction:column;">
              <div class="cell r"><span class="lbl">(-) Desconto / Abatimento</span><span class="val mono">-</span></div>
              <div class="cell r"><span class="lbl">(+) Mora / Multa</span><span class="val mono">-</span></div>
              <div class="cell r" style="border-bottom:1px solid #000000;"><span class="lbl">(=) Valor Cobrado</span><span class="val mono">-</span></div>
            </div>
          </div>

          <div class="grid row-last" style="grid-template-columns: 1fr;">
            <div class="cell">
              <span class="lbl">Pagador / Sacado</span>
              <div class="val">${escHtml(b.sacado?.nome)} — CNPJ/CPF: ${escHtml(fmtDoc(b.sacado?.doc))}</div>
              <div style="font-size:8px;color:#000000;margin-top:2px;">
                ${escHtml(b.sacado?.endereco || 'Endereço não informado')} • ${escHtml(b.sacado?.cidade || '')}/${escHtml(b.sacado?.uf || 'SP')} ${b.sacado?.cep ? `• CEP: ${escHtml(b.sacado.cep)}` : ''}
              </div>
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:10px;padding:0 4px;">
          <div>${barcodeBoleto}</div>
          <div style="font-size:7px;color:#000000;text-align:right;">
            Ficha de Compensação — Autenticação Mecânica<br/>
            Emitido por WMSphere ERP
          </div>
        </div>
      </div>`
    })
    .join('')
}

function renderizarHtmlRomaneioProdutos(nota) {
  const emit = nota.emitente || {}
  const rom = construirRomaneioFallback(nota)
  const cli = rom.cliente || {}
  const itens = Array.isArray(rom.itens) ? rom.itens : []
  const modFreteTxt = MOD_FRETE_LABEL[String(nota.mod_frete ?? '0')] || '0 - Emitente (CIF)'

  const rowsHtml = itens
    .map(
      (it, idx) => `<tr>
        <td class="mono c">${idx + 1}</td>
        <td class="mono b">${escHtml(it.codigo)}</td>
        <td>
          <div class="b">${escHtml(it.descricao)}</div>
          ${it.observacao ? `<div class="sub-code">Obs: ${escHtml(it.observacao)}</div>` : ''}
        </td>
        <td class="mono c">${escHtml(it.lotes || '-')}</td>
        <td class="mono c b">${Number(it.qtd_caixas || 1)} cx</td>
        <td class="mono r b">${fmtNum(it.peso_kg, 3)} kg</td>
        <td class="mono r">${fmtMoeda(it.preco_unitario)}</td>
        <td class="mono r b">${fmtMoeda(it.valor_total)}</td>
      </tr>`,
    )
    .join('')

  return `
    <div class="page-sheet">
      <div class="box-round" style="margin-bottom:8px;">
        <div class="grid row-last" style="grid-template-columns: 2.3fr 1.5fr 1.2fr; background:#ffffff;">
          <div class="cell">
            <span class="brand-pill">WMSphere ERP • ROMANEIO DE PRODUTOS</span>
            <div style="font-size:13px;font-weight:900;margin-top:2px;">RELAÇÃO DE PRODUTOS DO PEDIDO / CONFERÊNCIA</div>
            <div style="font-size:8.5px;color:#000000;margin-top:2px;">Emitente: <strong>${escHtml(emit.razaoSocial || emit.nomeFantasia)}</strong> (${escHtml(fmtDoc(emit.cnpj))})</div>
          </div>
          <div class="cell c" style="display:flex;flex-direction:column;justify-content:center;">
            <span class="lbl">Pedido de Venda</span>
            <div class="mono" style="font-size:13px;font-weight:900;color:#000000;">${escHtml(rom.pedido_codigo)}</div>
            <div style="font-size:8px;font-weight:700;">${escHtml(rom.pedido_titulo)}</div>
          </div>
          <div class="cell c" style="display:flex;flex-direction:column;justify-content:center;">
            <span class="lbl">Nota Fiscal Vinculada</span>
            <div class="mono" style="font-size:12px;font-weight:900;">NF-e Nº ${escHtml(fmtNumNota(nota.numero))}</div>
            <div style="font-size:8px;">Série ${escHtml(nota.serie)} • ${escHtml(fmtData(nota.data_autorizacao || nota.created_at))}</div>
          </div>
        </div>
      </div>

      <div class="sec"><span>Dados do Cliente &amp; Local de Entrega</span><span>Previsão Entrega: ${escHtml(fmtData(rom.previsao_entrega))}</span></div>
      <div class="box" style="margin-bottom:8px;">
        <div class="grid" style="grid-template-columns: 2.4fr 1.1fr 0.9fr 0.9fr;">
          <div class="cell"><span class="lbl">Cliente / Razão Social</span><span class="val">${escHtml(cli.razao_social || nota.destinatario_nome)}</span></div>
          <div class="cell"><span class="lbl">CNPJ / CPF</span><span class="val mono">${escHtml(fmtDoc(cli.cnpj_cpf || nota.destinatario_doc))}</span></div>
          <div class="cell"><span class="lbl">Inscrição Estadual</span><span class="val mono">${escHtml(cli.inscricao_estadual || nota.destinatario_ie || 'ISENTO')}</span></div>
          <div class="cell"><span class="lbl">Telefone</span><span class="val mono">${escHtml(cli.telefone || '-')}</span></div>
        </div>
        <div class="grid" style="grid-template-columns: 2.5fr 1.2fr 0.4fr 1.2fr;">
          <div class="cell"><span class="lbl">Endereço de Entrega</span><span class="val">${escHtml(cli.endereco || nota.destinatario_endereco || '-')} ${cli.bairro ? `• ${escHtml(cli.bairro)}` : ''}</span></div>
          <div class="cell"><span class="lbl">Município</span><span class="val">${escHtml(cli.cidade || nota.destinatario_cidade || '-')}</span></div>
          <div class="cell c"><span class="lbl">UF</span><span class="val">${escHtml(cli.uf || nota.destinatario_uf || 'SP')}</span></div>
          <div class="cell"><span class="lbl">Condição de Pagamento</span><span class="val">${escHtml(rom.condicao_pagamento)}</span></div>
        </div>
        <div class="grid row-last" style="grid-template-columns: 2.2fr 1.2fr 1.1fr 0.8fr;">
          <div class="cell"><span class="lbl">Transportadora</span><span class="val">${escHtml(nota.transportadora_nome || 'TRANSPORTE PRÓPRIO')}</span></div>
          <div class="cell"><span class="lbl">Modalidade Frete</span><span class="val">${escHtml(modFreteTxt)}</span></div>
          <div class="cell"><span class="lbl">Placa / UF</span><span class="val mono">${escHtml(nota.veiculo_placa || '-')} ${nota.veiculo_uf ? `(${escHtml(nota.veiculo_uf)})` : ''}</span></div>
          <div class="cell"><span class="lbl">Vendedor</span><span class="val">${escHtml(rom.vendedor_nome || '-')}</span></div>
        </div>
      </div>

      <div class="sec"><span>Relação de Produtos &amp; Pesos do Pedido</span><span>${itens.length} Produto(s)</span></div>
      <table>
        <thead>
          <tr>
            <th style="width:28px;">#</th>
            <th style="width:65px;">Código</th>
            <th>Descrição do Produto</th>
            <th style="width:90px;">Lote(s)</th>
            <th style="width:68px;text-align:center;">Caixas</th>
            <th style="width:88px;text-align:right;">Peso Líq. (kg)</th>
            <th style="width:76px;text-align:right;">Preço/kg</th>
            <th style="width:88px;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div class="box" style="margin-top:8px;">
        <div class="grid row-last" style="grid-template-columns: repeat(4, 1fr); background:#ffffff;">
          <div class="cell"><span class="lbl">Total de Produtos</span><span class="val-lg mono">${itens.length} item(ns)</span></div>
          <div class="cell"><span class="lbl">Total de Volumes / Caixas</span><span class="val-lg mono">${rom.total_caixas} cx</span></div>
          <div class="cell r"><span class="lbl">Peso Total Separado</span><span class="val-lg mono">${fmtNum(rom.total_peso_kg, 3)} kg</span></div>
          <div class="cell r" style="background:#d4d4d4;"><span class="lbl">Valor Total do Pedido</span><span class="val-lg mono">${fmtMoeda(rom.valor_total)}</span></div>
        </div>
      </div>

      ${
        rom.observacoes
          ? `<div class="box-round" style="margin-top:8px;padding:6px 8px;font-size:8.5px;"><strong>Observações do Pedido:</strong> ${escHtml(rom.observacoes)}</div>`
          : ''
      }

      <div class="box-round" style="margin-top:16px;padding:10px;">
        <div style="font-size:8px;font-weight:700;margin-bottom:18px;">
          DECLARO QUE CONFERI E RECEBI OS PRODUTOS ACIMA RELACIONADOS EM PERFEITO ESTADO E TEMPERATURA ADEQUADA:
        </div>
        <div style="display:grid;grid-template-columns: 1fr 1fr 1fr;gap:20px;margin-top:20px;text-align:center;font-size:7.5px;">
          <div style="border-top:1.2px solid #000000;padding-top:4px;">Data e Hora da Entrega</div>
          <div style="border-top:1.2px solid #000000;padding-top:4px;">Assinatura do Conferente / Motorista</div>
          <div style="border-top:1.2px solid #000000;padding-top:4px;">Nome Legível, RG/CPF e Assinatura do Cliente</div>
        </div>
      </div>
    </div>`
}

export function imprimirPacoteNotas(
  notasInput,
  opcoes = { danfe: true, boleto: true, romaneio: false },
) {
  const lista = Array.isArray(notasInput) ? notasInput.filter(Boolean) : [notasInput].filter(Boolean)
  if (lista.length === 0) return

  // Se for 1 única nota modelo 65 (NFC-e 80mm) e apenas DANFE solicitado
  if (lista.length === 1 && String(lista[0].modelo) === '65' && !opcoes.romaneio && !opcoes.boleto) {
    const nota = lista[0]
    const emit = nota.emitente || {}
    const itens = Array.isArray(nota.itens) ? nota.itens : []
    const isHomolog = nota.ambiente !== 'PRODUCAO'
    const w = window.open('', '_blank', 'width=420,height=780')
    if (!w) return
    const itensRows = itens
      .map(
        (it) => `<tr>
          <td>${escHtml(it.codigo)}</td>
          <td>${escHtml(it.descricao)}</td>
          <td style="text-align:right;">${Number(it.qtd || 0).toFixed(3)} ${escHtml(it.unidade)}</td>
          <td style="text-align:right;">${Number(it.valor_unitario || 0).toFixed(2)}</td>
          <td style="text-align:right;font-weight:700;">${Number(it.valor_total || 0).toFixed(2)}</td>
        </tr>`,
      )
      .join('')
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NFC-e ${nota.numero}</title>
      <style>
        @page { size: 80mm auto; margin: 2mm; }
        body { font-family: 'Courier New', monospace; font-size: 10px; color: #000; width: 76mm; margin: 0 auto; }
        h2, p { margin: 2px 0; text-align: center; }
        hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th { text-align: left; border-bottom: 1px solid #000; padding: 2px 0; }
        td { padding: 2px 0; vertical-align: top; }
        .tot { display: flex; justify-content: space-between; font-weight: 700; font-size: 11px; margin: 2px 0; }
        .warn { border: 1.5px solid #000; padding: 4px; text-align: center; font-weight: 900; margin: 5px 0; font-size: 11px; }
      </style></head><body>
      <h2>${escHtml(emit.razaoSocial || emit.nomeFantasia || 'EMITENTE')}</h2>
      <p>CNPJ: ${escHtml(fmtDoc(emit.cnpj))} • IE: ${escHtml(emit.ie || 'ISENTO')}</p>
      <hr/>
      <p><strong>DANFE NFC-e - Cupom Fiscal Eletrônico</strong></p>
      ${isHomolog ? '<div class="warn">*** SEM VALOR FISCAL ***<br/>EMITIDA EM HOMOLOGAÇÃO</div>' : ''}
      ${nota.status === 'CANCELADA' ? '<div class="warn">*** DOCUMENTO CANCELADO ***</div>' : ''}
      <hr/>
      <table><thead><tr><th>Cód</th><th>Descrição</th><th style="text-align:right;">Qtd</th><th style="text-align:right;">Vl.Un</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itensRows}</tbody></table>
      <hr/>
      <div class="tot" style="font-size:13px;"><span>VALOR A PAGAR</span><span>${escHtml(fmtMoeda(nota.valor_total_nf))}</span></div>
      <p>NFC-e nº <strong>${String(nota.numero).padStart(6, '0')}</strong> • Série <strong>${nota.serie}</strong></p>
      <p style="font-size:8.5px;word-break:break-all;"><strong>CHAVE:</strong><br/>${escHtml(fmtChave(nota.chave_acesso))}</p>
      </body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 250)
    return
  }

  const paginas = []
  for (const nota of lista) {
    if (opcoes.danfe !== false) {
      paginas.push(renderizarHtmlDanfeA4(nota))
    }
    if (opcoes.boleto) {
      paginas.push(renderizarHtmlBoletosNota(nota))
    }
    if (opcoes.romaneio) {
      paginas.push(renderizarHtmlRomaneioProdutos(nota))
    }
  }

  const w = window.open('', '_blank', 'width=1040,height=840')
  if (!w) return

  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Impressão Fiscal (${lista.length} nota(s))</title>
    <style>
      @page { size: A4 portrait; margin: 6mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000000; font-size: 8.5px; margin: 0; background: #ffffff; }
      .page-sheet { position: relative; page-break-after: always; padding-bottom: 4px; }
      .page-sheet:last-child { page-break-after: auto; }
      .center-watermark {
        position: absolute;
        top: 46%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-30deg);
        font-size: 46px;
        font-weight: 900;
        color: transparent;
        -webkit-text-stroke: 1.6px #000000;
        border: 3.5px solid #000000;
        padding: 12px 28px;
        border-radius: 12px;
        text-align: center;
        white-space: nowrap;
        pointer-events: none;
        z-index: 20;
        letter-spacing: 2px;
        line-height: 1.1;
        background: transparent;
      }
      .center-watermark span {
        display: block;
        font-size: 15px;
        font-weight: 900;
        letter-spacing: 1px;
        margin-top: 4px;
        color: #000000;
        -webkit-text-stroke: 0;
      }
      .canceled-wm { -webkit-text-stroke: 1.8px #000000; border-color: #000000; }

      .canhoto { border: 1.2px solid #000000; border-radius: 3px; display: grid; grid-template-columns: 1fr 120px; margin-bottom: 5px; }
      .canhoto-left { border-right: 1.2px solid #000000; display: flex; flex-direction: column; }
      .canhoto-top { padding: 3px 6px; border-bottom: 1.2px solid #000000; font-size: 7px; line-height: 1.25; color: #000000; }
      .canhoto-bot { display: grid; grid-template-columns: 135px 1fr; flex: 1; }
      .canhoto-bot > div { padding: 3px 6px; min-height: 24px; }
      .canhoto-bot > div:first-child { border-right: 1.2px solid #000000; }
      .canhoto-right { padding: 4px 6px; text-align: center; display: flex; flex-direction: column; justify-content: center; background: #ffffff; color: #000000; }
      .cut-line { border: none; border-top: 1.2px dashed #000000; margin: 5px 0 6px; }

      .sec { font-size: 7.4px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.4px; color: #000000; background: #cccccc; border: 1.2px solid #000000; border-bottom: none; padding: 2.5px 6px; margin-top: 5px; border-radius: 3px 3px 0 0; display: flex; justify-content: space-between; align-items: center; }
      .box { border: 1.2px solid #000000; border-radius: 0 0 3px 3px; overflow: hidden; }
      .box-round { border: 1.2px solid #000000; border-radius: 3px; overflow: hidden; }
      .grid { display: grid; }
      .cell { border-right: 1.2px solid #000000; border-bottom: 1.2px solid #000000; padding: 2.5px 5px; min-height: 23px; background: #ffffff; color: #000000; }
      .cell:last-child { border-right: none; }
      .row-last .cell { border-bottom: none; }
      .lbl { font-size: 6.2px; font-weight: 800; text-transform: uppercase; color: #000000; display: block; margin-bottom: 1px; letter-spacing: 0.2px; }
      .val { font-size: 8.5px; font-weight: 700; color: #000000; word-break: break-word; }
      .val-lg { font-size: 10.5px; font-weight: 900; color: #000000; }
      .mono { font-family: 'Consolas', 'Courier New', monospace; color: #000000; }
      .c { text-align: center; }
      .r { text-align: right; }
      .b { font-weight: 700; }

      .danfe-center { text-align: center; padding: 4px 5px !important; background: #ffffff; color: #000000; }
      .tipo-box { display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin: 3px 0; }
      .tipo-sq { border: 1.6px solid #000000; font-size: 11px; font-weight: 900; width: 20px; height: 20px; line-height: 17px; text-align: center; border-radius: 2px; background: #ffffff; color: #000000; }
      .brand-pill { display: inline-block; font-size: 6.5px; font-weight: 900; letter-spacing: 0.5px; color: #000000; background: #ffffff; border: 1.2px solid #000000; padding: 1px 5px; border-radius: 99px; margin-bottom: 2px; }

      .dups-wrap { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 6px; background: #ffffff; }
      .dup-item { border: 1.2px solid #000000; border-radius: 2px; padding: 2px 6px; font-size: 7.5px; background: #ffffff; color: #000000; min-width: 112px; display: flex; justify-content: space-between; gap: 8px; }
      .dup-empty { font-size: 8px; padding: 2px 0; color: #000000; }

      .reforma-strip { background: #ffffff; border-top: 1.2px solid #000000; }
      .reforma-strip .lbl { color: #000000; }

      table { width: 100%; border-collapse: collapse; border: 1.2px solid #000000; font-size: 7.6px; color: #000000; }
      th { background: #cccccc; border: 1.2px solid #000000; padding: 3px 3px; font-size: 6.4px; font-weight: 900; text-transform: uppercase; color: #000000; }
      td { border-left: 1px solid #000000; border-right: 1px solid #000000; border-bottom: 1px solid #000000; padding: 2.5px 3px; vertical-align: top; color: #000000; background: #ffffff; }
      tr:nth-child(even) td { background: #ffffff; }
      .sub-code { font-size: 6.5px; color: #000000; font-weight: 700; margin-top: 1px; }

      .watermark { background: #ffffff; border: 2px solid #000000; color: #000000; text-align: center; font-weight: 900; padding: 3.5px; margin-bottom: 5px; font-size: 9px; border-radius: 3px; }
      .canceled { background: #000000; border: 2px solid #000000; color: #ffffff; text-align: center; font-weight: 900; padding: 5px; margin-bottom: 5px; font-size: 11px; border-radius: 3px; }
      .footer-erp { margin-top: 5px; display: flex; justify-content: space-between; font-size: 6.8px; color: #000000; font-weight: 700; }
    </style></head><body>
    ${paginas.join('\n')}
    </body></html>`)

  w.document.close()
  setTimeout(() => w.print(), 280)
}

// Atalhos diretos para 1 nota
export function imprimirDanfeDocumento(nota, opcoes = { danfe: true, boleto: true, romaneio: false }) {
  imprimirPacoteNotas([nota], opcoes)
}

export function imprimirSomenteDanfe(nota) {
  imprimirPacoteNotas([nota], { danfe: true, boleto: false, romaneio: false })
}

export function imprimirBoletoNota(nota) {
  imprimirPacoteNotas([nota], { danfe: false, boleto: true, romaneio: false })
}

export function imprimirRomaneioProdutosNota(nota) {
  imprimirPacoteNotas([nota], { danfe: false, boleto: false, romaneio: true })
}

export function imprimirPacoteCompletoNota(nota) {
  imprimirPacoteNotas([nota], { danfe: true, boleto: true, romaneio: true })
}

// ── MODAL DE IMPRESSÃO INDIVIDUAL (1 NOTA) ───────────────────────────────────
export function DanfePrintModal({ nota, onClose, onBaixarXml }) {
  const svgRef = useRef(null)
  const [abaDoc, setAbaDoc] = useState('DANFE') // 'DANFE' | 'BOLETO' | 'ROMANEIO'

  useEffect(() => {
    if (!nota || String(nota.modelo) === '65' || abaDoc !== 'DANFE' || !svgRef.current) return
    try {
      JsBarcode(svgRef.current, String(nota.chave_acesso || '').replace(/\D/g, ''), {
        format: 'CODE128',
        width: 1.25,
        height: 40,
        displayValue: false,
        margin: 2,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch { /* ignore */ }
  }, [nota, abaDoc])

  if (!nota) return null
  const ehNfce = String(nota.modelo) === '65'
  const modFreteTxt = MOD_FRETE_LABEL[String(nota.mod_frete ?? '0')] || '0 - Emitente (CIF)'
  const boletos = construirBoletosFallback(nota)
  const rom = construirRomaneioFallback(nota)

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="card"
        style={{
          width: '96%',
          maxWidth: ehNfce ? 500 : 1020,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: 'var(--bg-1)',
          overflow: 'hidden',
        }}
      >
        {/* TOPO DO MODAL */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            padding: '16px 20px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <h3 className="text-base font-bold m-0">
              {ehNfce ? 'NFC-e (Cupom 80mm)' : `NF-e Nº ${fmtNumNota(nota.numero)} / Série ${nota.serie}`}
              {nota.pedido_codigo ? ` — Pedido ${nota.pedido_codigo}` : ''}
            </h3>
            <div className="text-xs text-muted font-mono mt-4">{fmtChave(nota.chave_acesso)}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onBaixarXml?.(nota.id)}>
              <Download size={14} /> XML
            </button>
            {!ehNfce && (
              <>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => imprimirSomenteDanfe(nota)}
                  title="Imprimir apenas a folha da DANFE NF-e"
                >
                  <FileText size={14} /> Só DANFE
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => imprimirBoletoNota(nota)}
                  title="Imprimir apenas o(s) Boleto(s)"
                >
                  <CreditCard size={14} /> Só Boleto
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => imprimirRomaneioProdutosNota(nota)}
                  title="Imprimir apenas o Romaneio de Produtos do Pedido"
                >
                  <ClipboardList size={14} /> Só Romaneio
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => imprimirDanfeDocumento(nota, { danfe: true, boleto: true, romaneio: false })}
                  title="Imprimir DANFE + Boleto Bancário juntos"
                >
                  <Printer size={14} /> Imprimir DANFE + Boleto
                </button>
                <button
                  type="button"
                  className="btn btn--success btn--sm"
                  onClick={() => imprimirPacoteCompletoNota(nota)}
                  title="Imprimir Pacote Completo: DANFE + Boleto + Romaneio de Produtos"
                >
                  <Layers size={14} /> Pacote (NF + Boleto + Romaneio)
                </button>
              </>
            )}
            {ehNfce && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => imprimirSomenteDanfe(nota)}
              >
                <Printer size={14} /> Imprimir Cupom 80mm
              </button>
            )}
            <button type="button" className="btn-icon" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ABAS INTERNAS DE PRÉ-VISUALIZAÇÃO */}
        {!ehNfce && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '10px 20px',
              background: 'var(--bg-1)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              className={`btn btn--sm ${abaDoc === 'DANFE' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAbaDoc('DANFE')}
            >
              <FileText size={14} /> 1. DANFE NF-e (Modelo 55)
            </button>
            <button
              type="button"
              className={`btn btn--sm ${abaDoc === 'BOLETO' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAbaDoc('BOLETO')}
            >
              <CreditCard size={14} /> 2. Boleto Bancário ({boletos.length})
            </button>
            <button
              type="button"
              className={`btn btn--sm ${abaDoc === 'ROMANEIO' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAbaDoc('ROMANEIO')}
            >
              <ClipboardList size={14} /> 3. Romaneio de Produtos ({rom.itens.length} item(ns))
            </button>
          </div>
        )}

        {/* CORPO DO MODAL */}
        <div style={{ padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {nota.ambiente !== 'PRODUCAO' && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.14)',
                border: '2px dashed rgba(239, 68, 68, 0.5)',
                color: '#fca5a5',
                textAlign: 'center',
                fontWeight: 800,
                fontSize: 13,
                letterSpacing: 0.4,
              }}
            >
              ⚠️ DOCUMENTO EMITIDO EM HOMOLOGAÇÃO — SEM VALOR FISCAL
            </div>
          )}

          {abaDoc === 'DANFE' && (
            <>
              {!ehNfce && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: '#ffffff',
                    color: '#000000',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <svg ref={svgRef} style={{ maxWidth: '100%' }} />
                  <div className="font-mono text-xs font-bold" style={{ marginTop: 4 }}>
                    {fmtChave(nota.chave_acesso)}
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 12,
                }}
              >
                <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted uppercase font-bold">Destinatário</div>
                  <div className="font-bold text-sm" style={{ marginTop: 6 }}>{nota.destinatario_nome}</div>
                  <div className="text-xs text-muted font-mono" style={{ marginTop: 4 }}>
                    CNPJ/CPF: {fmtDoc(nota.destinatario_doc)} • UF: {nota.destinatario_uf}
                  </div>
                  {nota.destinatario_endereco && (
                    <div className="text-xs text-muted" style={{ marginTop: 4 }}>{nota.destinatario_endereco}</div>
                  )}
                </div>

                <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted uppercase font-bold">Autorização SEFAZ</div>
                  <div className="font-mono font-bold text-sm text-success" style={{ marginTop: 6 }}>
                    Protocolo: {nota.protocolo_autorizacao || '-'}
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                    {fmtDataHora(nota.data_autorizacao || nota.created_at)}
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 4 }}>{nota.natureza_operacao}</div>
                </div>

                <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  <div className="text-xs text-muted uppercase font-bold">Totais &amp; Impostos (2026)</div>
                  <div className="font-mono font-bold text-base text-cyan" style={{ marginTop: 6 }}>
                    {fmtMoeda(nota.valor_total_nf)}
                  </div>
                  <div className="text-xs text-muted font-mono" style={{ marginTop: 4 }}>
                    BC ICMS: {fmtMoeda(nota.valor_icms_base)} • ICMS: {fmtMoeda(nota.valor_icms)}
                  </div>
                  <div className="text-xs text-muted font-mono" style={{ marginTop: 4 }}>
                    IBS: {fmtMoeda(nota.valor_ibs)} • CBS: {fmtMoeda(nota.valor_cbs)}
                  </div>
                </div>
              </div>

              {!ehNfce && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div>
                    <div className="text-xs text-muted uppercase font-bold flex items-center gap-6">
                      <Truck size={14} className="text-cyan" /> Transportador &amp; Veículo
                    </div>
                    <div className="font-bold text-sm" style={{ marginTop: 6 }}>
                      {nota.transportadora_nome || 'Transporte Próprio / Não informado'}
                    </div>
                    <div className="text-xs text-muted font-mono" style={{ marginTop: 4 }}>
                      Frete: {modFreteTxt}
                      {nota.transportadora_doc ? ` • CNPJ: ${fmtDoc(nota.transportadora_doc)}` : ''}
                      {nota.transportadora_cidade ? ` • ${nota.transportadora_cidade}/${nota.transportadora_uf}` : ''}
                    </div>
                  </div>
                  <div className="font-mono text-xs" style={{ textAlign: 'right' }}>
                    <div>
                      Placa: <strong className="text-cyan">{nota.veiculo_placa || '-'}</strong>{' '}
                      {nota.veiculo_uf ? `(${nota.veiculo_uf})` : ''}
                    </div>
                    {nota.transportadora_antt && <div className="text-muted" style={{ marginTop: 4 }}>ANTT: {nota.transportadora_antt}</div>}
                    <div className="text-muted" style={{ marginTop: 4 }}>
                      {nota.qtd_volumes || 1} {nota.especie_volumes || 'CAIXA'} • Líq. {fmtNum(nota.peso_liquido_kg, 2)} kg / Bruto {fmtNum(nota.peso_bruto_kg, 2)} kg
                    </div>
                  </div>
                </div>
              )}

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cód</th>
                      <th>Produto</th>
                      <th>NCM / cClass</th>
                      <th>CST</th>
                      <th>CFOP</th>
                      <th style={{ textAlign: 'right' }}>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Unit</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>ICMS</th>
                      <th style={{ textAlign: 'right' }}>IBS/CBS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(nota.itens || []).map((it, idx) => (
                      <tr key={idx}>
                        <td className="font-mono text-xs">{it.codigo}</td>
                        <td className="text-xs font-bold">{it.descricao}</td>
                        <td className="font-mono text-xs">
                          {it.ncm}
                          {it.c_class_trib ? <div className="text-xs text-muted">[{it.c_class_trib}]</div> : null}
                        </td>
                        <td className="font-mono text-xs">{it.cst_csosn}</td>
                        <td className="font-mono text-xs">{it.cfop}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {Number(it.qtd || 0).toFixed(3)} {it.unidade}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(it.valor_unitario)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                          {fmtMoeda(it.valor_total)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(it.v_icms)}
                          {it.p_red_bc > 0 ? <div className="text-xs text-success">-{it.p_red_bc}%</div> : null}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {fmtMoeda(Number(it.v_ibs_uf || 0) + Number(it.v_cbs || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {abaDoc === 'BOLETO' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {boletos.map((b, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div className="font-bold text-sm flex items-center gap-8">
                      <CreditCard size={16} className="text-cyan" /> {b.banco_nome} ({b.banco_codigo}) — Parcela #{b.parcela_numero}/{b.parcela_total}
                      {b.simulado && <span className="badge badge--warning">Boleto Simulado</span>}
                    </div>
                    <div className="font-mono font-bold text-base text-success">{fmtMoeda(b.valor)}</div>
                  </div>
                  <div className="font-mono text-xs" style={{ padding: '8px 10px', background: 'var(--bg-1)', borderRadius: 6 }}>
                    <strong>Linha Digitável:</strong> {b.linha_digitavel}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }} className="text-xs">
                    <div><span className="text-muted">Vencimento:</span> <strong className="font-mono">{fmtData(b.vencimento)}</strong></div>
                    <div><span className="text-muted">Nosso Número:</span> <strong className="font-mono">{b.nosso_numero}</strong></div>
                    <div><span className="text-muted">Nº Documento:</span> <strong className="font-mono">{b.numero_documento}</strong></div>
                    <div><span className="text-muted">Agência / Conta:</span> <strong className="font-mono">{b.agencia_codigo_cedente}</strong></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {abaDoc === 'ROMANEIO' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 8,
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div>
                  <div className="text-xs text-muted uppercase font-bold">Romaneio de Produtos do Pedido</div>
                  <div className="font-bold text-sm" style={{ marginTop: 4 }}>
                    {rom.pedido_codigo} — {rom.pedido_titulo}
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                    Cliente: <strong>{rom.cliente?.razao_social}</strong> • Cond. Pagto: {rom.condicao_pagamento}
                  </div>
                </div>
                <div className="font-mono text-xs" style={{ textAlign: 'right' }}>
                  <div>Total Volumes: <strong>{rom.total_caixas} cx</strong></div>
                  <div style={{ marginTop: 4 }}>Peso Total: <strong className="text-cyan">{fmtNum(rom.total_peso_kg, 3)} kg</strong></div>
                  <div style={{ marginTop: 4 }}>Valor Total: <strong className="text-success">{fmtMoeda(rom.valor_total)}</strong></div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto</th>
                      <th>Lote(s)</th>
                      <th style={{ textAlign: 'center' }}>Caixas</th>
                      <th style={{ textAlign: 'right' }}>Peso (kg)</th>
                      <th style={{ textAlign: 'right' }}>Preço/kg</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rom.itens.map((it, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{it.codigo}</td>
                        <td className="font-bold text-xs">{it.descricao}</td>
                        <td className="font-mono text-xs">{it.lotes || '-'}</td>
                        <td style={{ textAlign: 'center' }} className="font-mono font-bold text-xs">{it.qtd_caixas} cx</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs">{fmtNum(it.peso_kg, 3)} kg</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">{fmtMoeda(it.preco_unitario)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs">{fmtMoeda(it.valor_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MODAL DIFERENTE PARA IMPRESSÃO DE LOTE (2 OU MAIS NOTAS FATURADAS/SELECIONADAS) ──
export function PacoteLotePrintModal({ notas, onClose, onAbrirNotaIndividual }) {
  const [incluirDanfe, setIncluirDanfe] = useState(true)
  const [incluirBoleto, setIncluirBoleto] = useState(true)
  const [incluirRomaneio, setIncluirRomaneio] = useState(true)

  if (!Array.isArray(notas) || notas.length === 0) return null

  const totalValor = notas.reduce((s, n) => s + Number(n.valor_total_nf || 0), 0)
  const totalPeso = notas.reduce((s, n) => s + Number(n.peso_liquido_kg || 0), 0)
  const totalCaixas = notas.reduce((s, n) => s + Number(n.qtd_volumes || 1), 0)
  const totalBoletos = notas.reduce((s, n) => s + construirBoletosFallback(n).length, 0)

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="card"
        style={{
          width: '96%',
          maxWidth: 960,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: 'var(--bg-1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <h3 className="text-base font-bold m-0 flex items-center gap-8">
              <Layers size={19} className="text-success" /> Central de Impressão em Lote — {notas.length} Nota(s) Fiscal(is)
            </h3>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>
              Imprima todas as DANFEs, Boletos e Romaneios de Produtos de uma só vez, agrupados cliente por cliente.
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* RESUMO DO LOTE */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <div className="text-xs text-muted uppercase font-bold">Notas no Lote</div>
              <div className="text-xl font-bold font-mono text-cyan" style={{ marginTop: 6 }}>{notas.length} NF-e(s)</div>
            </div>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <div className="text-xs text-muted uppercase font-bold">Boletos Gerados</div>
              <div className="text-xl font-bold font-mono text-warning" style={{ marginTop: 6 }}>{totalBoletos} boleto(s)</div>
            </div>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <div className="text-xs text-muted uppercase font-bold">Volumes &amp; Peso Total</div>
              <div className="text-lg font-bold font-mono" style={{ marginTop: 6 }}>
                {totalCaixas} cx • {fmtNum(totalPeso, 2)} kg
              </div>
            </div>
            <div style={{ padding: 14, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <div className="text-xs text-muted uppercase font-bold">Valor Total Faturado</div>
              <div className="text-xl font-bold font-mono text-success" style={{ marginTop: 6 }}>{fmtMoeda(totalValor)}</div>
            </div>
          </div>

          {/* SELETOR DE DOCUMENTOS DO LOTE */}
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="text-xs font-bold uppercase text-success">
              Documentos incluídos na impressão em lote (agrupados pedido por pedido):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              <label className="flex items-center gap-8 text-sm font-bold cursor-pointer">
                <input type="checkbox" checked={incluirDanfe} onChange={(e) => setIncluirDanfe(e.target.checked)} />
                1. DANFE NF-e (Modelo 55)
              </label>
              <label className="flex items-center gap-8 text-sm font-bold cursor-pointer">
                <input type="checkbox" checked={incluirBoleto} onChange={(e) => setIncluirBoleto(e.target.checked)} />
                2. Boleto(s) Bancário(s) ({totalBoletos} parcela(s))
              </label>
              <label className="flex items-center gap-8 text-sm font-bold cursor-pointer">
                <input type="checkbox" checked={incluirRomaneio} onChange={(e) => setIncluirRomaneio(e.target.checked)} />
                3. Romaneio de Produtos (Relação de itens, caixas e pesos do pedido)
              </label>
            </div>
          </div>

          {/* TABELA DAS NOTAS DO LOTE */}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>NF-e / Série</th>
                  <th>Pedido</th>
                  <th>Cliente / Destinatário</th>
                  <th>Transportadora / Placa</th>
                  <th style={{ textAlign: 'right' }}>Caixas / Peso</th>
                  <th style={{ textAlign: 'right' }}>Valor NF</th>
                  <th style={{ textAlign: 'right' }}>Ações Individuais</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id}>
                    <td className="font-mono font-bold text-xs">
                      Nº {fmtNumNota(n.numero)} • S{n.serie}
                    </td>
                    <td className="font-mono text-xs text-cyan">{n.pedido_codigo || '-'}</td>
                    <td>
                      <div className="font-bold text-xs">{n.destinatario_nome}</div>
                      <div className="text-xs text-muted font-mono">{fmtDoc(n.destinatario_doc)}</div>
                    </td>
                    <td className="text-xs">
                      <div>{n.transportadora_nome || 'Próprio'}</div>
                      {n.veiculo_placa && <div className="font-mono text-muted">Placa: {n.veiculo_placa}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                      {n.qtd_volumes || 1} cx • {fmtNum(n.peso_liquido_kg, 2)} kg
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono font-bold text-xs text-success">
                      {fmtMoeda(n.valor_total_nf)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => onAbrirNotaIndividual?.(n)}
                          title="Visualizar nota individualmente"
                        >
                          Ver
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() =>
                            imprimirPacoteNotas([n], {
                              danfe: incluirDanfe,
                              boleto: incluirBoleto,
                              romaneio: incluirRomaneio,
                            })
                          }
                        >
                          <Printer size={13} /> Imprimir Esta
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div
          style={{
            padding: '16px 20px',
            background: 'var(--bg-2)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Fechar
          </button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!incluirDanfe && !incluirBoleto && !incluirRomaneio}
              onClick={() =>
                imprimirPacoteNotas(notas, {
                  danfe: incluirDanfe,
                  boleto: incluirBoleto,
                  romaneio: incluirRomaneio,
                })
              }
            >
              <Printer size={16} /> Imprimir Lote Selecionado ({notas.length} Cliente(s))
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
