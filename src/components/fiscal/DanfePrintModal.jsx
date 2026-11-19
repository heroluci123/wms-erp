import React, { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { Download, Printer, X } from 'lucide-react'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtChave = (c) =>
  String(c || '')
    .replace(/\D/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim()

const fmtDoc = (d) => {
  const s = String(d || '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d || '-'
}

const fmtDataHora = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleString('pt-BR')
  } catch {
    return String(d)
  }
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
      width: 1.15,
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
  const isHomolog = nota.ambiente !== 'PRODUCAO'
  const barcodeSvg = !ehNfce ? gerarBarcodeChaveSvg(nota.chave_acesso) : ''

  const w = window.open('', '_blank', ehNfce ? 'width=420,height=780' : 'width=980,height=780')
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
    const itensRows = itens
      .map(
        (it) => `<tr>
          <td>${escHtml(it.codigo)}</td>
          <td>${escHtml(it.descricao)}</td>
          <td style="text-align:center;">${escHtml(it.ncm)}</td>
          <td style="text-align:center;">${escHtml(it.cst_csosn)}</td>
          <td style="text-align:center;">${escHtml(it.cfop)}</td>
          <td style="text-align:center;">${escHtml(it.unidade)}</td>
          <td style="text-align:right;">${Number(it.qtd || 0).toFixed(3)}</td>
          <td style="text-align:right;">${Number(it.valor_unitario || 0).toFixed(2)}</td>
          <td style="text-align:right;font-weight:700;">${Number(it.valor_total || 0).toFixed(2)}</td>
          <td style="text-align:right;">${Number(it.v_bc_icms || 0).toFixed(2)}</td>
          <td style="text-align:right;">${Number(it.v_icms || 0).toFixed(2)}</td>
          <td style="text-align:right;">${Number(it.p_icms || 0).toFixed(1)}%</td>
        </tr>`,
      )
      .join('')
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE NF-e ${nota.numero}</title>
      <style>
        @page { size: A4 portrait; margin: 8mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9.5px; margin: 0; }
        .box { border: 1px solid #000; margin-bottom: 5px; }
        .grid { display: grid; }
        .cell { border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 5px; }
        .cell:last-child { border-right: none; }
        .lbl { font-size: 6.5px; font-weight: 700; text-transform: uppercase; color: #333; display: block; }
        .val { font-size: 9.5px; font-weight: 700; }
        .sec { font-size: 8px; font-weight: 800; text-transform: uppercase; margin: 6px 0 2px; }
        table { width: 100%; border-collapse: collapse; border: 1px solid #000; font-size: 8.5px; }
        th { background: #f1f5f9; border: 1px solid #000; padding: 3px 4px; font-size: 7px; text-transform: uppercase; }
        td { border: 1px solid #ccc; padding: 3px 4px; }
        .watermark { background: #fef3c7; border: 1.5px solid #d97706; color: #92400e; text-align: center; font-weight: 800; padding: 4px; margin-bottom: 6px; font-size: 10px; }
        .canceled { background: #fee2e2; border: 2px solid #dc2626; color: #991b1b; text-align: center; font-weight: 900; padding: 6px; margin-bottom: 6px; font-size: 12px; }
      </style></head><body>
      ${nota.status === 'CANCELADA' ? `<div class="canceled">NF-e CANCELADA — SEM VALIDADE JURÍDICA (${escHtml(nota.motivo_cancelamento)})</div>` : ''}
      ${isHomolog ? `<div class="watermark">AMBIENTE DE HOMOLOGAÇÃO — EMITIDA SEM VALOR FISCAL</div>` : ''}

      <div class="box">
        <div class="grid" style="grid-template-columns: 2.2fr 0.9fr 2.1fr;">
          <div class="cell">
            <span class="lbl">Identificação do Emitente</span>
            <div style="font-size:13px;font-weight:900;margin:2px 0;">${escHtml(emit.razaoSocial || emit.nomeFantasia)}</div>
            <div>CNPJ: <strong>${escHtml(fmtDoc(emit.cnpj))}</strong> • IE: <strong>${escHtml(emit.ie || 'ISENTO')}</strong></div>
            <div>${escHtml(emit.cidade || '')} - ${escHtml(emit.uf || 'SP')} • Regime: ${escHtml(emit.regime || 'SIMPLES')}</div>
          </div>
          <div class="cell" style="text-align:center;">
            <div style="font-size:14px;font-weight:900;">DANFE</div>
            <div style="font-size:7px;">Documento Auxiliar da Nota Fiscal Eletrônica</div>
            <div style="margin:4px 0;font-weight:800;">${nota.tipo_operacao === 'SAIDA' ? '1 - SAÍDA' : '0 - ENTRADA'}</div>
            <div style="font-size:11px;font-weight:900;">Nº ${String(nota.numero).padStart(9, '0')}</div>
            <div style="font-weight:700;">SÉRIE ${nota.serie}</div>
          </div>
          <div class="cell">
            <div style="text-align:center;">${barcodeSvg}</div>
            <span class="lbl">Chave de Acesso</span>
            <div style="font-family:monospace;font-size:8.5px;font-weight:800;text-align:center;">${escHtml(fmtChave(nota.chave_acesso))}</div>
            <div style="font-size:7px;text-align:center;margin-top:2px;">Protocolo: <strong>${escHtml(nota.protocolo_autorizacao || '-')}</strong> • ${escHtml(fmtDataHora(nota.data_autorizacao || nota.created_at))}</div>
          </div>
        </div>
        <div class="grid" style="grid-template-columns: 2.5fr 1.5fr;">
          <div class="cell" style="border-bottom:none;"><span class="lbl">Natureza da Operação</span><span class="val">${escHtml(nota.natureza_operacao)}</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">Protocolo de Autorização de Uso</span><span class="val">${escHtml(nota.protocolo_autorizacao || '-')} — ${escHtml(fmtDataHora(nota.data_autorizacao))}</span></div>
        </div>
      </div>

      <div class="sec">Destinatário / Remetente</div>
      <div class="box">
        <div class="grid" style="grid-template-columns: 2.6fr 1.2fr 1fr;">
          <div class="cell"><span class="lbl">Nome / Razão Social</span><span class="val">${escHtml(nota.destinatario_nome)}</span></div>
          <div class="cell"><span class="lbl">CNPJ / CPF</span><span class="val">${escHtml(fmtDoc(nota.destinatario_doc))}</span></div>
          <div class="cell"><span class="lbl">Data Emissão</span><span class="val">${escHtml(fmtDataHora(nota.created_at))}</span></div>
        </div>
        <div class="grid" style="grid-template-columns: 2.2fr 1.2fr 0.5fr 1fr;">
          <div class="cell" style="border-bottom:none;"><span class="lbl">Endereço</span><span class="val">${escHtml(nota.destinatario_endereco || '-')}</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">Município</span><span class="val">${escHtml(nota.destinatario_cidade || '-')}</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">UF</span><span class="val">${escHtml(nota.destinatario_uf || '-')}</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">Inscrição Estadual</span><span class="val">${escHtml(nota.destinatario_ie || 'ISENTO')}</span></div>
        </div>
      </div>

      <div class="sec">Cálculo do Imposto</div>
      <div class="box">
        <div class="grid" style="grid-template-columns: repeat(5, 1fr);">
          <div class="cell"><span class="lbl">Base Cálc. ICMS</span><span class="val">${escHtml(fmtMoeda(nota.valor_icms_base))}</span></div>
          <div class="cell"><span class="lbl">Valor ICMS</span><span class="val">${escHtml(fmtMoeda(nota.valor_icms))}</span></div>
          <div class="cell"><span class="lbl">ICMS ST</span><span class="val">${escHtml(fmtMoeda(nota.valor_icms_st))}</span></div>
          <div class="cell"><span class="lbl">PIS / COFINS</span><span class="val">${escHtml(fmtMoeda(Number(nota.valor_pis || 0) + Number(nota.valor_cofins || 0)))}</span></div>
          <div class="cell"><span class="lbl">Valor Produtos</span><span class="val">${escHtml(fmtMoeda(nota.valor_produtos))}</span></div>
        </div>
        <div class="grid" style="grid-template-columns: repeat(5, 1fr);">
          <div class="cell" style="border-bottom:none;"><span class="lbl">Frete</span><span class="val">${escHtml(fmtMoeda(nota.valor_frete))}</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">Desconto</span><span class="val">${escHtml(fmtMoeda(nota.valor_desconto))}</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">Volumes</span><span class="val">${nota.qtd_volumes || 1} cx</span></div>
          <div class="cell" style="border-bottom:none;"><span class="lbl">Peso Líquido / Bruto</span><span class="val">${Number(nota.peso_liquido_kg || 0).toFixed(2)} / ${Number(nota.peso_bruto_kg || 0).toFixed(2)} kg</span></div>
          <div class="cell" style="border-bottom:none;background:#f1f5f9;"><span class="lbl">Valor Total da NF-e</span><span class="val" style="font-size:11.5px;">${escHtml(fmtMoeda(nota.valor_total_nf))}</span></div>
        </div>
      </div>

      <div class="sec">Dados dos Produtos / Serviços</div>
      <table>
        <thead>
          <tr>
            <th>Cód.</th><th>Descrição</th><th>NCM</th><th>CST/CSOSN</th><th>CFOP</th><th>Un</th>
            <th style="text-align:right;">Qtd</th><th style="text-align:right;">V.Unit</th><th style="text-align:right;">V.Total</th>
            <th style="text-align:right;">BC ICMS</th><th style="text-align:right;">V.ICMS</th><th style="text-align:right;">Alíq.</th>
          </tr>
        </thead>
        <tbody>${itensRows}</tbody>
      </table>

      <div class="sec">Dados Adicionais / Informações Complementares</div>
      <div class="box" style="padding:6px;min-height:42px;font-size:8.5px;">
        ${escHtml(nota.inf_complementar || 'Documento fiscal emitido pelo WMSphere ERP.')}
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

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="card"
        style={{
          width: '96%',
          maxWidth: ehNfce ? 480 : 940,
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
              {String(nota.numero).padStart(6, '0')} / Série {nota.serie}
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
            <div className="p-10 rounded text-xs font-bold text-warning" style={{ background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.35)' }}>
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
            </div>
            <div className="p-12 rounded" style={{ background: 'var(--bg-2)' }}>
              <div className="text-xs text-muted uppercase font-bold">Autorização SEFAZ</div>
              <div className="font-mono font-bold text-sm text-success mt-4">
                Protocolo: {nota.protocolo_autorizacao || '-'}
              </div>
              <div className="text-xs text-muted mt-2">
                {nota.status} • {fmtDataHora(nota.data_autorizacao || nota.created_at)}
              </div>
            </div>
            <div className="p-12 rounded" style={{ background: 'var(--bg-2)' }}>
              <div className="text-xs text-muted uppercase font-bold">Totais &amp; Tributos</div>
              <div className="font-mono font-bold text-base text-cyan mt-4">{fmtMoeda(nota.valor_total_nf)}</div>
              <div className="text-xs text-muted font-mono mt-2">
                ICMS: {fmtMoeda(nota.valor_icms)} • PIS/COFINS: {fmtMoeda(Number(nota.valor_pis) + Number(nota.valor_cofins))}
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>NCM</th>
                  <th>CST/CSOSN</th>
                  <th>CFOP</th>
                  <th style={{ textAlign: 'right' }}>Qtd</th>
                  <th style={{ textAlign: 'right' }}>V.Unit</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>ICMS</th>
                </tr>
              </thead>
              <tbody>
                {(nota.itens || []).map((it, idx) => (
                  <tr key={idx}>
                    <td className="text-xs font-bold">
                      {it.codigo} — {it.descricao}
                    </td>
                    <td className="font-mono text-xs">{it.ncm}</td>
                    <td className="font-mono text-xs">{it.cst_csosn}</td>
                    <td className="font-mono text-xs font-bold text-cyan">{it.cfop}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                      {Number(it.qtd || 0).toFixed(3)} {it.unidade}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                      {fmtMoeda(it.valor_unitario)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                      {fmtMoeda(it.valor_total)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                      {fmtMoeda(it.v_icms)} ({Number(it.p_icms || 0).toFixed(1)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(nota.eventos || []).length > 0 && (
            <div className="p-12 rounded" style={{ background: 'var(--bg-2)' }}>
              <div className="text-xs font-bold uppercase text-muted mb-6">Eventos Vinculados (CC-e / Cancelamento)</div>
              {nota.eventos.map((ev) => (
                <div key={ev.id} className="text-xs py-4 border-b border-border last:border-none">
                  <span className="badge badge--info mr-6">{ev.tipo_evento} #{ev.sequencia}</span>{' '}
                  <strong>{ev.descricao}</strong> — <span className="font-mono text-muted">Prot. {ev.protocolo}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
