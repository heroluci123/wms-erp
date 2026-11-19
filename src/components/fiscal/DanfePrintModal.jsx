import React, { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { Download, Printer, Truck, X } from 'lucide-react'

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

function gerarBarcodeChaveSvg(chave) {
  if (!chave || typeof document === 'undefined') return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, String(chave).replace(/\D/g, ''), {
      format: 'CODE128',
      width: 1.05,
      height: 36,
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

export function imprimirDanfeDocumento(nota) {
  if (!nota) return
  const ehNfce = String(nota.modelo) === '65'
  const emit = nota.emitente || {}
  const itens = Array.isArray(nota.itens) ? nota.itens : []
  const duplicatas = Array.isArray(nota.duplicatas) ? nota.duplicatas : []
  const isHomolog = nota.ambiente !== 'PRODUCAO'
  const barcodeSvg = !ehNfce ? gerarBarcodeChaveSvg(nota.chave_acesso) : ''

  const w = window.open('', '_blank', ehNfce ? 'width=420,height=780' : 'width=1020,height=820')
  if (!w) return

  if (ehNfce) {
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
        .warn { border: 1px solid #000; padding: 3px; text-align: center; font-weight: 700; margin: 4px 0; }
      </style></head><body>
      <h2>${escHtml(emit.razaoSocial || emit.nomeFantasia || 'EMITENTE')}</h2>
      <p>CNPJ: ${escHtml(fmtDoc(emit.cnpj))} • IE: ${escHtml(emit.ie || 'ISENTO')}</p>
      <p>${escHtml(emit.cidade || '')} - ${escHtml(emit.uf || 'SP')}</p>
      <hr/>
      <p><strong>DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</strong></p>
      ${isHomolog ? '<div class="warn">EMITIDA EM HOMOLOGAÇÃO - SEM VALOR FISCAL</div>' : ''}
      ${nota.status === 'CANCELADA' ? '<div class="warn">*** DOCUMENTO CANCELADO ***</div>' : ''}
      <hr/>
      <table><thead><tr><th>Cód</th><th>Descrição</th><th style="text-align:right;">Qtd</th><th style="text-align:right;">Vl.Un</th><th style="text-align:right;">Total</th></tr></thead><tbody>${itensRows}</tbody></table>
      <hr/>
      <div class="tot"><span>Qtd. Total Itens</span><span>${itens.length}</span></div>
      ${Number(nota.valor_desconto) > 0 ? `<div class="tot"><span>Desconto</span><span>- ${escHtml(fmtMoeda(nota.valor_desconto))}</span></div>` : ''}
      <div class="tot" style="font-size:13px;"><span>VALOR A PAGAR</span><span>${escHtml(fmtMoeda(nota.valor_total_nf))}</span></div>
      <div class="tot" style="font-weight:400;"><span>Forma Pgto</span><span>${escHtml(nota.forma_pagamento_label || 'PIX')}</span></div>
      <hr/>
      <p><strong>CONSUMIDOR:</strong> ${escHtml(nota.destinatario_nome || 'NÃO IDENTIFICADO')}${nota.destinatario_doc ? ` • ${escHtml(fmtDoc(nota.destinatario_doc))}` : ''}</p>
      <hr/>
      <p>NFC-e nº <strong>${String(nota.numero).padStart(6, '0')}</strong> • Série <strong>${nota.serie}</strong> • ${escHtml(fmtDataHora(nota.data_autorizacao || nota.created_at))}</p>
      <p>Protocolo: ${escHtml(nota.protocolo_autorizacao || '-')}</p>
      <p style="font-size:8.5px;word-break:break-all;margin-top:4px;"><strong>CHAVE DE ACESSO:</strong><br/>${escHtml(fmtChave(nota.chave_acesso))}</p>
      ${nota.inf_complementar ? `<hr/><p style="font-size:8px;">${escHtml(nota.inf_complementar)}</p>` : ''}
      </body></html>`)
  } else {
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
                <div><strong>${escHtml(d.numero)}</strong></div>
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

    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NF-e ${fmtNumNota(nota.numero)}</title>
      <style>
        @page { size: A4 portrait; margin: 6mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 8.5px; margin: 0; background: #fff; }
        .canhoto { border: 1px solid #0f172a; border-radius: 3px; display: grid; grid-template-columns: 1fr 120px; margin-bottom: 5px; }
        .canhoto-left { border-right: 1px solid #0f172a; display: flex; flex-direction: column; }
        .canhoto-top { padding: 3px 6px; border-bottom: 1px solid #0f172a; font-size: 7px; line-height: 1.25; }
        .canhoto-bot { display: grid; grid-template-columns: 135px 1fr; flex: 1; }
        .canhoto-bot > div { padding: 3px 6px; min-height: 24px; }
        .canhoto-bot > div:first-child { border-right: 1px solid #0f172a; }
        .canhoto-right { padding: 4px 6px; text-align: center; display: flex; flex-direction: column; justify-content: center; background: #f8fafc; }
        .cut-line { border: none; border-top: 1px dashed #64748b; margin: 5px 0 6px; }

        .sec { font-size: 7.2px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; color: #0f172a; background: #e2e8f0; border: 1px solid #0f172a; border-bottom: none; padding: 2px 6px; margin-top: 5px; border-radius: 3px 3px 0 0; display: flex; justify-content: space-between; align-items: center; }
        .box { border: 1px solid #0f172a; border-radius: 0 0 3px 3px; overflow: hidden; }
        .box-round { border: 1px solid #0f172a; border-radius: 3px; overflow: hidden; }
        .grid { display: grid; }
        .cell { border-right: 1px solid #0f172a; border-bottom: 1px solid #0f172a; padding: 2.5px 5px; min-height: 23px; }
        .cell:last-child { border-right: none; }
        .row-last .cell { border-bottom: none; }
        .lbl { font-size: 6px; font-weight: 700; text-transform: uppercase; color: #475569; display: block; margin-bottom: 1px; letter-spacing: 0.2px; }
        .val { font-size: 8.5px; font-weight: 700; color: #0f172a; word-break: break-word; }
        .val-lg { font-size: 10.5px; font-weight: 900; }
        .mono { font-family: 'Consolas', 'Courier New', monospace; }
        .c { text-align: center; }
        .r { text-align: right; }
        .b { font-weight: 700; }

        .danfe-center { text-align: center; padding: 4px 5px !important; background: #f8fafc; }
        .tipo-box { display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin: 3px 0; }
        .tipo-sq { border: 1.5px solid #0f172a; font-size: 11px; font-weight: 900; width: 20px; height: 20px; line-height: 17px; text-align: center; border-radius: 2px; background: #fff; }
        .brand-pill { display: inline-block; font-size: 6.5px; font-weight: 800; letter-spacing: 0.5px; color: #0369a1; background: #e0f2fe; border: 1px solid #7dd3fc; padding: 1px 5px; border-radius: 99px; margin-bottom: 2px; }

        .dups-wrap { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 6px; background: #fff; }
        .dup-item { border: 1px solid #cbd5e1; border-radius: 2px; padding: 2px 6px; font-size: 7.5px; background: #f8fafc; min-width: 112px; display: flex; justify-content: space-between; gap: 8px; }
        .dup-empty { font-size: 8px; padding: 2px 0; }

        .reforma-strip { background: #f0f9ff; border-top: 1px solid #0f172a; }
        .reforma-strip .lbl { color: #0369a1; }

        table { width: 100%; border-collapse: collapse; border: 1px solid #0f172a; font-size: 7.6px; }
        th { background: #f1f5f9; border: 1px solid #0f172a; padding: 3px 3px; font-size: 6.3px; text-transform: uppercase; color: #0f172a; }
        td { border-left: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #e2e8f0; padding: 2.5px 3px; vertical-align: top; }
        tr:nth-child(even) td { background: #fafafa; }
        .sub-code { font-size: 6.5px; color: #475569; margin-top: 1px; }

        .watermark { background: #fef3c7; border: 1.5px solid #d97706; color: #92400e; text-align: center; font-weight: 800; padding: 3px; margin-bottom: 5px; font-size: 9px; border-radius: 3px; }
        .canceled { background: #fee2e2; border: 2px solid #dc2626; color: #991b1b; text-align: center; font-weight: 900; padding: 5px; margin-bottom: 5px; font-size: 11px; border-radius: 3px; }
        .footer-erp { margin-top: 5px; display: flex; justify-content: space-between; font-size: 6.8px; color: #64748b; }
      </style></head><body>

      ${nota.status === 'CANCELADA' ? `<div class="canceled">NF-e CANCELADA — SEM VALIDADE JURÍDICA (${escHtml(nota.motivo_cancelamento)})</div>` : ''}
      ${isHomolog ? `<div class="watermark">AMBIENTE DE HOMOLOGAÇÃO — EMITIDA SEM VALOR FISCAL</div>` : ''}

      <!-- CANHOTO DESTACÁVEL (PADRÃO SEFAZ) -->
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

      <!-- CABEÇALHO PRINCIPAL DANFE -->
      <div class="box-round">
        <div class="grid" style="grid-template-columns: 2.15fr 0.95fr 2.15fr;">
          <div class="cell">
            <span class="brand-pill">WMSphere ERP • NF-e 4.00</span>
            <div style="font-size:11.5px;font-weight:900;line-height:1.15;margin-top:2px;">${escHtml(emit.razaoSocial || emit.nomeFantasia)}</div>
            ${emit.nomeFantasia && emit.nomeFantasia !== emit.razaoSocial ? `<div style="font-size:8px;font-weight:700;color:#334155;">${escHtml(emit.nomeFantasia)}</div>` : ''}
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
            <div style="font-size:6.3px;text-align:center;color:#475569;margin-top:2px;line-height:1.2;">
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

      <!-- DESTINATÁRIO / REMETENTE -->
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

      <!-- FATURA / DUPLICATAS -->
      <div class="sec"><span>Fatura / Duplicatas</span><span>${duplicatas.length > 0 ? `${duplicatas.length} parcela(s)` : 'À Vista / Condição Direta'}</span></div>
      <div class="box">
        <div class="dups-wrap">${dupsHtml}</div>
      </div>

      <!-- CÁLCULO DO IMPOSTO + IBS/CBS 2026 -->
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
          <div class="cell r" style="background:#f1f5f9;"><span class="lbl">V. Total da Nota</span><span class="val-lg mono">${escHtml(fmtMoeda(nota.valor_total_nf))}</span></div>
        </div>
        <div class="grid row-last reforma-strip" style="grid-template-columns: repeat(4, 1fr);">
          <div class="cell r"><span class="lbl">Base Cálc. IBS / CBS (2026)</span><span class="val mono">${escHtml(fmtNum(bcIbsCbsTotal))}</span></div>
          <div class="cell r"><span class="lbl">Valor Total IBS (UF/Mun)</span><span class="val mono">${escHtml(fmtNum(totalIbs))}</span></div>
          <div class="cell r"><span class="lbl">Valor Total CBS (Federal)</span><span class="val mono">${escHtml(fmtNum(totalCbs))}</span></div>
          <div class="cell r"><span class="lbl">Total IBS + CBS (LC 214/2025)</span><span class="val mono">${escHtml(fmtNum(totalIbs + totalCbs))}</span></div>
        </div>
      </div>

      <!-- TRANSPORTADOR / VOLUMES TRANSPORTADOS (COMPLETO PADRÃO PÁGINA 2) -->
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

      <!-- DADOS DOS PRODUTOS / SERVIÇOS -->
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

      <!-- DADOS ADICIONAIS -->
      <div class="sec"><span>Dados Adicionais</span><span>Reservado ao Fisco</span></div>
      <div class="box">
        <div class="grid row-last" style="grid-template-columns: 2.35fr 1fr;">
          <div class="cell" style="min-height:56px;">
            <span class="lbl">Informações Complementares</span>
            <div style="font-size:7.6px;line-height:1.35;">
              ${escHtml(nota.inf_complementar || 'ICMS com redução de base de cálculo — Art. 74 Anexo II RICMS/SP (Cesta Básica Carnes). PIS/COFINS alíquota zero conforme Lei 10.925/2004.')}
              ${nota.vendedor_nome ? ` • Vendedor: <strong>${escHtml(nota.vendedor_nome)}</strong>` : ''}
              ${nota.condicao_pagamento_label ? ` • Cond. Pagto: <strong>${escHtml(nota.condicao_pagamento_label)}</strong>` : ''}
            </div>
          </div>
          <div class="cell" style="min-height:56px;background:#f8fafc;">
            <span class="lbl">Reservado ao Fisco</span>
            <div class="mono" style="font-size:7px;color:#475569;margin-top:4px;">
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
      </body></html>`)
  }

  w.document.close()
  setTimeout(() => w.print(), 250)
}

export function DanfePrintModal({ nota, onClose, onBaixarXml }) {
  const svgRef = useRef(null)
  useEffect(() => {
    if (!nota || String(nota.modelo) === '65' || !svgRef.current) return
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
  }, [nota])

  if (!nota) return null
  const ehNfce = String(nota.modelo) === '65'
  const duplicatas = Array.isArray(nota.duplicatas) ? nota.duplicatas : []
  const modFreteTxt = MOD_FRETE_LABEL[String(nota.mod_frete ?? '0')] || '0 - Emitente (CIF)'

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="card"
        style={{
          width: '96%',
          maxWidth: ehNfce ? 480 : 980,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: 'var(--bg-1)',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex justify-between items-center p-16"
          style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h3 className="text-base font-bold m-0">
              {ehNfce ? 'DANFE NFC-e (Cupom Fiscal 80mm)' : 'DANFE NF-e (Modelo 55 A4)'} — Nº{' '}
              {fmtNumNota(nota.numero)} / Série {nota.serie}
            </h3>
            <div className="text-xs text-muted font-mono mt-2">{fmtChave(nota.chave_acesso)}</div>
          </div>
          <div className="flex items-center gap-8">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onBaixarXml?.(nota.id)}>
              <Download size={14} /> XML
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => imprimirDanfeDocumento(nota)}>
              <Printer size={14} /> Imprimir {ehNfce ? 'Cupom 80mm' : 'DANFE A4'}
            </button>
            <button type="button" className="btn-icon" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-20 overflow-auto flex flex-col gap-12">
          {nota.ambiente !== 'PRODUCAO' && (
            <div
              className="p-10 rounded text-xs font-bold text-warning"
              style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.35)' }}
            >
              Emitida em ambiente de HOMOLOGAÇÃO ({nota.provedor_usado}) — sem valor fiscal até configurar Produção + Certificado A1.
            </div>
          )}

          {!ehNfce && (
            <div className="p-12 rounded flex flex-col items-center" style={{ background: '#fff', color: '#000' }}>
              <svg ref={svgRef} style={{ maxWidth: '100%' }} />
              <div className="font-mono text-xs font-bold mt-4">{fmtChave(nota.chave_acesso)}</div>
            </div>
          )}

          <div className="grid gap-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="p-12 rounded" style={{ background: 'var(--bg-2)' }}>
              <div className="text-xs text-muted uppercase font-bold">Destinatário</div>
              <div className="font-bold text-sm mt-4">{nota.destinatario_nome}</div>
              <div className="text-xs text-muted font-mono mt-2">
                Doc: {fmtDoc(nota.destinatario_doc)} • UF: {nota.destinatario_uf}
              </div>
              {nota.destinatario_endereco && (
                <div className="text-xs text-muted mt-2">{nota.destinatario_endereco}</div>
              )}
            </div>

            <div className="p-12 rounded" style={{ background: 'var(--bg-2)' }}>
              <div className="text-xs text-muted uppercase font-bold">Autorização SEFAZ</div>
              <div className="font-mono font-bold text-sm text-success mt-4">
                Protocolo: {nota.protocolo_autorizacao || '-'}
              </div>
              <div className="text-xs text-muted mt-2">{fmtDataHora(nota.data_autorizacao || nota.created_at)}</div>
              <div className="text-xs text-muted mt-2">{nota.natureza_operacao}</div>
            </div>

            <div className="p-12 rounded" style={{ background: 'var(--bg-2)' }}>
              <div className="text-xs text-muted uppercase font-bold">Totais &amp; Impostos (2026)</div>
              <div className="font-mono font-bold text-base text-cyan mt-4">{fmtMoeda(nota.valor_total_nf)}</div>
              <div className="text-xs text-muted mt-2 font-mono">
                BC ICMS: {fmtMoeda(nota.valor_icms_base)} • ICMS: {fmtMoeda(nota.valor_icms)}
              </div>
              <div className="text-xs text-muted mt-2 font-mono">
                IBS: {fmtMoeda(nota.valor_ibs)} • CBS: {fmtMoeda(nota.valor_cbs)}
              </div>
            </div>
          </div>

          {!ehNfce && (
            <div className="p-12 rounded flex flex-wrap justify-between gap-12" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <div>
                <div className="text-xs text-muted uppercase font-bold flex items-center gap-6">
                  <Truck size={13} className="text-cyan" /> Transportador &amp; Veículo
                </div>
                <div className="font-bold text-sm mt-4">
                  {nota.transportadora_nome || 'Transporte Próprio / Não informado'}
                </div>
                <div className="text-xs text-muted font-mono mt-2">
                  Frete: {modFreteTxt}
                  {nota.transportadora_doc ? ` • CNPJ: ${fmtDoc(nota.transportadora_doc)}` : ''}
                  {nota.transportadora_cidade ? ` • ${nota.transportadora_cidade}/${nota.transportadora_uf}` : ''}
                </div>
              </div>
              <div className="text-right font-mono text-xs">
                <div>
                  Placa: <strong className="text-cyan">{nota.veiculo_placa || '-'}</strong>{' '}
                  {nota.veiculo_uf ? `(${nota.veiculo_uf})` : ''}
                </div>
                {nota.transportadora_antt && <div className="text-muted mt-2">ANTT: {nota.transportadora_antt}</div>}
                <div className="text-muted mt-2">
                  {nota.qtd_volumes || 1} {nota.especie_volumes || 'CAIXA'} • Líq. {fmtNum(nota.peso_liquido_kg, 2)} kg / Bruto {fmtNum(nota.peso_bruto_kg, 2)} kg
                </div>
              </div>
            </div>
          )}

          {!ehNfce && duplicatas.length > 0 && (
            <div className="p-10 rounded flex flex-wrap items-center gap-8 text-xs" style={{ background: 'var(--bg-2)' }}>
              <span className="font-bold uppercase text-muted">Duplicatas:</span>
              {duplicatas.map((d) => (
                <span key={d.numero} className="badge badge--neutral font-mono">
                  #{d.numero} • {fmtData(d.vencimento)} • {fmtMoeda(d.valor)}
                </span>
              ))}
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
                      {it.c_class_trib ? <div className="text-[10px] text-muted">[{it.c_class_trib}]</div> : null}
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
                      {it.p_red_bc > 0 ? <div className="text-[10px] text-success">-{it.p_red_bc}%</div> : null}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                      {fmtMoeda(Number(it.v_ibs_uf || 0) + Number(it.v_cbs || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nota.inf_complementar && (
            <div className="p-10 rounded text-xs text-muted" style={{ background: 'var(--bg-2)' }}>
              <strong>Informações Complementares:</strong> {nota.inf_complementar}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
