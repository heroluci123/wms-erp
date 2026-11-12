import React, { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { Printer, Download, X, Tag, CheckCircle2 } from 'lucide-react'
import { fmtDataBR, fmtKg2, fmtKg3, gerarLotePorData } from '../../utils/rastreabilidade'

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizarEtiqueta(raw) {
  const ean = String(raw?.ean_caixa || raw?.ean || '').trim()
  const lote = String(raw?.lote || (raw?.data_producao ? gerarLotePorData(raw.data_producao) : '') || '-').trim()
  const liquido = Number(raw?.peso_liquido_kg ?? raw?.peso_kg ?? 0)
  const tara = Number(raw?.tara_kg ?? 0)
  const bruto = raw?.peso_bruto_kg !== null && raw?.peso_bruto_kg !== undefined
    ? Number(raw.peso_bruto_kg)
    : (Number.isFinite(liquido) && Number.isFinite(tara) ? Number((liquido + tara).toFixed(3)) : liquido)

  const badgeOrigem = raw?.op_codigo
    ? `${raw?.origem_tipo || 'PRODUCAO'} • ${raw.op_codigo}`
    : (raw?.origem_tipo || 'TRICARNES WMS')

  return {
    ean,
    codigo: String(raw?.produto_codigo || raw?.codigo || '-').trim(),
    descricao: String(raw?.produto_descricao || raw?.descricao || 'PRODUTO SEM DESCRIÇÃO').trim().toUpperCase(),
    lote,
    data_producao: raw?.data_producao || null,
    validade: raw?.validade || null,
    peso_bruto_kg: bruto,
    tara_kg: tara,
    peso_liquido_kg: liquido,
    origem_tipo: badgeOrigem,
    ean_origem: raw?.ean_origem || '',
  }
}

/**
 * Gera código ZPL II nativo para impressoras Zebra (203 DPI — 100mm x 70mm = 800 x 560 dots).
 */
export function gerarZplEtiqueta100x70(raw) {
  const e = normalizarEtiqueta(raw)
  const desc1 = e.descricao.slice(0, 34)
  const desc2 = e.descricao.slice(34, 68)
  const prodData = fmtDataBR(e.data_producao)
  const valData = fmtDataBR(e.validade)
  const brutoTxt = `${Number(e.peso_bruto_kg || 0).toFixed(2).replace('.', ',')} kg`
  const taraTxt = `${Number(e.tara_kg || 0).toFixed(3).replace('.', ',')} kg`
  const liqTxt = `${Number(e.peso_liquido_kg || 0).toFixed(2).replace('.', ',')} kg`

  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL560',
    '^LH0,0',
    '^FO24,18^GB752,524,3^FS',
    '^FO24,62^GB752,2,2^FS',
    '^FO38,28^A0N,26,26^FDTRICARNES ALIMENTOS LTDA^FS',
    `^FO450,28^A0N,20,20^FD${e.origem_tipo.slice(0, 26)}^FS`,
    `^FO38,74^A0N,30,30^FD${desc1}^FS`,
    desc2 ? `^FO38,108^A0N,26,26^FD${desc2}^FS` : '',
    `^FO38,144^A0N,24,24^FDCOD: ${e.codigo}   LOTE: ${e.lote}^FS`,
    `^FO38,178^A0N,24,24^FDPROD: ${prodData}   VAL: ${valData}^FS`,
    '^FO24,214^GB752,2,2^FS',
    `^FO38,228^A0N,24,24^FDBRUTO: ${brutoTxt}   TARA: ${taraTxt}^FS`,
    `^FO38,262^A0N,34,34^FDPESO LIQ: ${liqTxt}^FS`,
    '^FO24,308^GB752,2,2^FS',
    `^FO90,330^BY2,3,105^BCN,105,Y,N,N^FD${e.ean}^FS`,
    e.ean_origem ? `^FO38,512^A0N,18,18^FDORIGEM EAN: ${e.ean_origem}^FS` : '',
    '^XZ',
  ].filter(Boolean).join('\n')
}

export function baixarZplEtiquetas(etiquetas, nomeArquivo = 'etiquetas_zebra_100x70.zpl') {
  const lista = Array.isArray(etiquetas) ? etiquetas : [etiquetas]
  const conteudo = lista.map(gerarZplEtiqueta100x70).join('\n\n')
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Renderiza etiqueta térmica exata de 100mm x 70mm em iframe isolado e dispara impressão automática.
 */
export function imprimirEtiquetasZebraAuto(etiquetas) {
  const lista = (Array.isArray(etiquetas) ? etiquetas : [etiquetas])
    .filter(Boolean)
    .map(normalizarEtiqueta)
  if (lista.length === 0) return

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow.document
  const cardsHtml = lista.map((e, idx) => `
    <div class="zlabel">
      <div class="zheader">
        <div>
          <div class="zbrand">TRICARNES ALIMENTOS</div>
          <div class="zsub">WMS RASTREABILIDADE • COD. ${escHtml(e.codigo)}</div>
        </div>
        <div class="zbadge">${escHtml(e.origem_tipo)}</div>
      </div>

      <div class="zprod">${escHtml(e.descricao)}</div>

      <div class="zmeta-grid">
        <div class="zcell">
          <span class="zlbl">LOTE</span>
          <strong class="zval zval-big">${escHtml(e.lote)}</strong>
        </div>
        <div class="zcell">
          <span class="zlbl">DATA PROD.</span>
          <strong class="zval">${escHtml(fmtDataBR(e.data_producao))}</strong>
        </div>
        <div class="zcell">
          <span class="zlbl">VALIDADE</span>
          <strong class="zval">${escHtml(fmtDataBR(e.validade))}</strong>
        </div>
      </div>

      <div class="zpeso-strip">
        <div class="zpeso-item">
          <span>PESO BRUTO</span>
          <strong>${escHtml(fmtKg2(e.peso_bruto_kg))}</strong>
        </div>
        <div class="zpeso-item">
          <span>TARA</span>
          <strong>${escHtml(fmtKg3(e.tara_kg))}</strong>
        </div>
        <div class="zpeso-item zpeso-liq">
          <span>PESO LÍQUIDO</span>
          <strong>${escHtml(fmtKg2(e.peso_liquido_kg))}</strong>
        </div>
      </div>

      <div class="zbarcode-wrap">
        <svg id="zbarcode-${idx}"></svg>
        ${e.ean_origem ? `<div class="zorigem">Origem: EAN ${escHtml(e.ean_origem)}</div>` : ''}
      </div>
    </div>
  `).join('')

  doc.open()
  doc.write(`<!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Etiqueta Zebra 100x70mm</title>
    <style>
      @page {
        size: 100mm 70mm;
        margin: 0;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      html, body {
        width: 100mm;
        background: #fff;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
      }
      .zlabel {
        width: 100mm;
        height: 70mm;
        padding: 2.6mm 3.2mm 2mm 3.2mm;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
        background: #fff;
      }
      .zlabel:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .zheader {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1.5pt solid #000;
        padding-bottom: 1.2mm;
      }
      .zbrand {
        font-size: 9pt;
        font-weight: 900;
        letter-spacing: 0.4px;
        line-height: 1;
      }
      .zsub {
        font-size: 6.5pt;
        font-weight: 700;
        margin-top: 0.6mm;
      }
      .zbadge {
        background: #000;
        color: #fff;
        font-size: 6.5pt;
        font-weight: 800;
        padding: 1mm 2mm;
        border-radius: 1mm;
        text-transform: uppercase;
        max-width: 44mm;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .zprod {
        font-size: 10.5pt;
        font-weight: 900;
        line-height: 1.15;
        text-transform: uppercase;
        max-height: 8.5mm;
        overflow: hidden;
        margin: 1mm 0;
      }
      .zmeta-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1.5mm;
        border-top: 0.8pt solid #000;
        border-bottom: 0.8pt solid #000;
        padding: 1mm 0;
      }
      .zcell {
        display: flex;
        flex-direction: column;
      }
      .zlbl {
        font-size: 6pt;
        font-weight: 700;
        color: #222;
      }
      .zval {
        font-size: 8.5pt;
        font-weight: 800;
      }
      .zval-big {
        font-family: 'Courier New', monospace;
        font-size: 9.5pt;
        font-weight: 900;
      }
      .zpeso-strip {
        display: grid;
        grid-template-columns: 1fr 0.9fr 1.2fr;
        gap: 1.5mm;
        background: #f3f4f6;
        border: 1pt solid #000;
        padding: 1mm 1.5mm;
        margin-top: 1mm;
      }
      .zpeso-item {
        display: flex;
        flex-direction: column;
      }
      .zpeso-item span {
        font-size: 5.8pt;
        font-weight: 700;
      }
      .zpeso-item strong {
        font-size: 8.8pt;
        font-weight: 800;
      }
      .zpeso-liq strong {
        font-size: 10.5pt;
        font-weight: 900;
      }
      .zbarcode-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin-top: 0.8mm;
      }
      .zbarcode-wrap svg {
        max-width: 92mm;
        height: 15.5mm;
      }
      .zorigem {
        font-size: 6pt;
        font-family: 'Courier New', monospace;
        font-weight: 700;
        margin-top: 0.3mm;
      }
    </style>
  </head>
  <body>${cardsHtml}</body>
  </html>`)
  doc.close()

  // Gera SVG CODE128 dentro de cada etiqueta no iframe
  lista.forEach((e, idx) => {
    const svg = doc.getElementById(`zbarcode-${idx}`)
    if (svg && e.ean) {
      try {
        JsBarcode(svg, e.ean, {
          format: 'CODE128',
          width: 2.1,
          height: 36,
          displayValue: true,
          fontSize: 12,
          fontOptions: 'bold',
          textMargin: 1,
          margin: 2,
          background: '#ffffff',
          lineColor: '#000000',
        })
      } catch (err) {
        console.warn('JsBarcode print error:', err)
      }
    }
  })

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 500)
  }

  setTimeout(() => {
    try {
      iframe.contentWindow.onafterprint = cleanup
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      setTimeout(cleanup, 15000)
    } catch (err) {
      console.error('Erro ao disparar impressão Zebra:', err)
      cleanup()
    }
  }, 150)
}

function BarcodeSvg({ value }) {
  const svgRef = useRef(null)
  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, String(value), {
        format: 'CODE128',
        width: 1.9,
        height: 44,
        displayValue: true,
        fontSize: 12,
        fontOptions: 'bold',
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch (_) {}
  }, [value])

  return <svg ref={svgRef} style={{ maxWidth: '100%', height: 'auto' }} />
}

export function EtiquetaZebraCard({ etiqueta }) {
  const e = normalizarEtiqueta(etiqueta)
  return (
    <div style={{
      background: '#ffffff',
      color: '#090d16',
      border: '2px solid #090d16',
      borderRadius: 8,
      padding: '12px 14px',
      width: '100%',
      maxWidth: 380,
      fontFamily: 'Arial, Helvetica, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #090d16', paddingBottom: 6, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.4px' }}>TRICARNES ALIMENTOS</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#334155' }}>COD. {e.codigo}</div>
        </div>
        <span style={{
          background: '#090d16', color: '#ffffff', fontSize: 10, fontWeight: 800,
          padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase',
        }}>
          {e.origem_tipo}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
        {e.descricao}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
        borderTop: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1',
        padding: '6px 0', marginBottom: 8,
      }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>LOTE</div>
          <div style={{ fontSize: 13, fontWeight: 900, fontFamily: 'monospace' }}>{e.lote}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>DATA PROD.</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtDataBR(e.data_producao)}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>VALIDADE</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtDataBR(e.validade)}</div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 0.9fr 1.2fr', gap: 6,
        background: '#f1f5f9', border: '1px solid #090d16', borderRadius: 4, padding: '6px 8px',
        marginBottom: 8,
      }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>PESO BRUTO</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtKg2(e.peso_bruto_kg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>TARA</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtKg3(e.tara_kg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#475569' }}>PESO LÍQUIDO</div>
          <div style={{ fontSize: 14, fontWeight: 900 }}>{fmtKg2(e.peso_liquido_kg)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <BarcodeSvg value={e.ean} />
        {e.ean_origem && (
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#334155', marginTop: 2 }}>
            Origem EAN: {e.ean_origem}
          </div>
        )}
      </div>
    </div>
  )
}

export function EtiquetaZebraModal({
  isOpen,
  etiquetas = [],
  autoPrint = false,
  onClose,
  titulo = 'Etiquetas Térmicas Zebra (100 × 70 mm)',
  subtitulo = 'Confira os dados abaixo. A janela de impressão é configurada em 100mm × 70mm.',
}) {
  const autoPrintedKeyRef = useRef('')

  useEffect(() => {
    if (!isOpen || !autoPrint || !etiquetas?.length) return
    const key = etiquetas.map(x => `${x.ean_caixa || x.ean}-${x.peso_liquido_kg || x.peso_kg}`).join('|')
    if (autoPrintedKeyRef.current !== key) {
      autoPrintedKeyRef.current = key
      imprimirEtiquetasZebraAuto(etiquetas)
    }
  }, [isOpen, autoPrint, etiquetas])

  if (!isOpen || !etiquetas?.length) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: 'rgba(4, 8, 18, 0.85)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--border-light)',
        borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag size={20} color="#38bdf8" />
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                {titulo} ({etiquetas.length})
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                {subtitulo}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => baixarZplEtiquetas(etiquetas)}
              style={{
                background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border-light)',
                padding: '8px 13px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Download size={15} /> Baixar ZPL
            </button>
            <button
              type="button"
              onClick={() => imprimirEtiquetasZebraAuto(etiquetas)}
              style={{
                background: '#16a34a', color: '#fff', border: 'none',
                padding: '8px 15px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Printer size={15} /> Imprimir Zebra (100×70mm)
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent', color: 'var(--text-secondary)', border: 'none',
                padding: 6, cursor: 'pointer', borderRadius: 6,
              }}
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div style={{
          padding: 20, overflowY: 'auto', display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 18, justifyItems: 'center', background: 'var(--bg-1)',
        }}>
          {etiquetas.map((et, idx) => (
            <div key={et.ean_caixa || et.ean || idx} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> Etiqueta #{idx + 1} • EAN {et.ean_caixa || et.ean}
              </div>
              <EtiquetaZebraCard etiqueta={et} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default EtiquetaZebraModal
