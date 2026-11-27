import React, { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'

export const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

export const fmtNum = (v, decimals = 2) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

export const fmtQtdLivre = (v) => {
  const n = Number(v || 0)
  const isInt = Math.abs(n - Math.round(n)) < 0.001
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2
  })
}

export const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0].split(' ')[0]
  const p = s.split('-')
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`
  return s
}

export const fmtDataHora = (d) => {
  if (!d) return '-'
  const raw = String(d)
  const utc = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const dt = new Date(utc)
  if (Number.isNaN(dt.getTime())) return raw
  return dt.toLocaleString('pt-BR')
}

export const WMS_PRINT_SHEET_BASE_CSS = `
  .wms-print-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 8px;
    margin-bottom: 10px;
    gap: 16px;
  }
  .wms-print-brand {
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 0.4px;
  }
  .wms-print-brand-sub {
    font-size: 9.5px;
    color: #334155;
    margin-top: 2px;
  }
  .wms-print-doc-title {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    text-align: right;
  }
  .wms-print-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 14px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 9px 12px;
    margin-bottom: 10px;
  }
  .wms-print-meta-label {
    font-size: 8.5px;
    text-transform: uppercase;
    color: #475569;
    font-weight: 700;
    letter-spacing: 0.4px;
  }
  .wms-print-meta-value {
    font-size: 11.5px;
    font-weight: 700;
    color: #0f172a;
    margin-top: 1px;
  }
  .wms-print-section-title {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #0f172a;
    background: #f1f5f9;
    padding: 5px 8px;
    border-left: 4px solid #0f172a;
    border-bottom: 1px solid #cbd5e1;
    margin: 10px 0 6px 0;
  }
  .wms-print-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 10px;
    font-size: 11px;
  }
  .wms-print-table th {
    background: #f1f5f9;
    color: #0f172a;
    text-align: left;
    padding: 6px 8px;
    font-size: 9.5px;
    text-transform: uppercase;
    font-weight: 800;
    border: 1px solid #334155;
  }
  .wms-print-table td {
    padding: 6px 8px;
    border: 1px solid #cbd5e1;
    vertical-align: middle;
    color: #0f172a;
  }
  .wms-print-table tbody tr:nth-child(even) td {
    background: #f8fafc;
  }
  .wms-print-table tfoot td {
    background: #f1f5f9;
    color: #0f172a;
    font-weight: 800;
    border: 1px solid #334155;
  }
  .wms-print-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .wms-print-obs {
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    border-radius: 4px;
    padding: 8px 10px;
    margin-top: 8px;
    font-size: 10.5px;
    color: #0f172a;
    min-height: 32px;
  }
  .wms-print-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 24px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .wms-print-sign-box {
    border: 1px solid #94a3b8;
    border-radius: 4px;
    padding: 14px 16px;
    background: #ffffff;
  }
  .wms-print-sign-line {
    border-top: 1px solid #0f172a;
    margin-top: 52px;
    padding-top: 5px;
    font-size: 10.5px;
    font-weight: 700;
    text-align: center;
    color: #0f172a;
  }
  .wms-print-sign-sub {
    font-size: 10px;
    color: #334155;
    margin-top: 8px;
    line-height: 1.85;
  }
  .wms-print-footer {
    margin-top: 14px;
    padding-top: 6px;
    border-top: 1px solid #cbd5e1;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #475569;
  }
  .badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 9.5px;
    font-weight: 700;
    border: 1px solid #94a3b8;
    color: #0f172a;
    background: #f1f5f9;
  }
  .badge--success { background: #dcfce7; color: #166534; border-color: #86efac; }
  .badge--warning { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
  .badge--danger  { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .badge--info    { background: #e0f2fe; color: #075985; border-color: #7dd3fc; }
`

/**
 * Imprime qualquer elemento/HTML em um <iframe> oculto 100% isolado da SPA.
 * Evita definitivamente capturar a tela escura de fundo (#root) ou gerar folhas extras.
 */
export function imprimirHtmlIsolado({
  title = 'Documento WMSphere',
  orientation = 'portrait',
  css = '',
  element = null,
  bodyHtml = '',
}) {
  if (typeof document === 'undefined') return

  let htmlFinal = bodyHtml
  if (element) {
    const clone = element.cloneNode(true)
    const origCanvases = element.querySelectorAll('canvas')
    const cloneCanvases = clone.querySelectorAll('canvas')
    origCanvases.forEach((cv, idx) => {
      try {
        const img = document.createElement('img')
        img.src = cv.toDataURL('image/png')
        img.style.cssText = cv.style.cssText
        img.width = cv.width
        img.height = cv.height
        cloneCanvases[idx]?.replaceWith(img)
      } catch {
        /* ignore tainted canvas */
      }
    })
    htmlFinal = clone.outerHTML
  }

  const orient = orientation === 'landscape' ? 'landscape' : 'portrait'
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    window.print()
    return
  }

  const safeTitle = String(title || 'Documento').replace(/[<>]/g, '')
  doc.open()
  doc.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle}</title>
  <style>
    @page {
      size: A4 ${orient};
      margin: 8mm 10mm 8mm 10mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      background: #ffffff !important;
      color: #0f172a !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
    }
    .wms-print-sheet {
      width: 100% !important;
      max-width: none !important;
      min-height: 0 !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      background: #ffffff !important;
      color: #0f172a !important;
    }
    .no-print {
      display: none !important;
    }
    ${WMS_PRINT_SHEET_BASE_CSS}
    ${css}
  </style>
</head>
<body>
  ${htmlFinal}
</body>
</html>`)
  doc.close()

  let limpou = false
  const cleanup = () => {
    if (limpou) return
    limpou = true
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 600)
  }

  setTimeout(() => {
    try {
      const win = iframe.contentWindow
      if (!win) throw new Error('Sem janela de impressao')
      win.onafterprint = cleanup
      win.focus()
      win.print()
      setTimeout(cleanup, 45000)
    } catch {
      cleanup()
      window.print()
    }
  }, 180)
}

export function PrintDocumentModal({ title, onClose, autoPrint = true, orientation = 'portrait', children }) {
  const isLandscape = orientation === 'landscape'
  const sheetRef = useRef(null)

  const handlePrint = useCallback(() => {
    if (sheetRef.current) {
      imprimirHtmlIsolado({
        title: title || 'Documento WMSphere',
        orientation,
        element: sheetRef.current,
      })
    } else {
      window.print()
    }
  }, [title, orientation])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    document.body.classList.add('wms-printing-modal')
    return () => {
      document.body.classList.remove('wms-printing-modal')
    }
  }, [])

  useEffect(() => {
    if (!autoPrint) return undefined
    const t = setTimeout(() => {
      handlePrint()
    }, 260)
    return () => clearTimeout(t)
  }, [autoPrint, handlePrint])

  const modalContent = (
    <div
      className="wms-print-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        overflowY: 'auto',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <style>{`
        .wms-print-sheet {
          width: ${isLandscape ? '297mm' : '210mm'};
          max-width: 100%;
          min-height: ${isLandscape ? '205mm' : '297mm'};
          background: #ffffff;
          color: #0f172a;
          padding: ${isLandscape ? '9mm 11mm' : '12mm 14mm'};
          border-radius: 6px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 11px;
          line-height: 1.35;
          box-sizing: border-box;
        }
        ${WMS_PRINT_SHEET_BASE_CSS}

        @media print {
          @page {
            size: A4 ${orientation};
            margin: 8mm 10mm 8mm 10mm;
          }
          html,
          body {
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }
          body > #root,
          body > *:not(.wms-print-overlay) {
            display: none !important;
          }
          .wms-print-overlay {
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            display: block !important;
          }
          .wms-print-toolbar,
          .no-print {
            display: none !important;
          }
          .wms-print-sheet,
          .wms-print-sheet * {
            visibility: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .wms-print-sheet {
            position: static !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 0 !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: #ffffff !important;
          }
        }
      `}</style>

      <div
        className="wms-print-toolbar no-print"
        style={{
          width: isLandscape ? '297mm' : '210mm',
          maxWidth: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '14px',
          color: '#f8fafc',
          gap: '12px'
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '14px' }}>
          {title} {isLandscape ? '(Paisagem / A4 Horizontal)' : '(Retrato / A4 Vertical)'}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handlePrint}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Printer size={15} /> Imprimir / Salvar PDF
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <X size={15} /> Fechar
          </button>
        </div>
      </div>

      <div ref={sheetRef} className="wms-print-sheet">{children}</div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent
}
