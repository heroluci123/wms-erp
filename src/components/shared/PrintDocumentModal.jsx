import React, { useEffect } from 'react'
import { Printer, X } from 'lucide-react'

export const fmtKg = (v) =>
  `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`

export const fmtNum = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

export function PrintDocumentModal({ title, onClose, autoPrint = true, children }) {
  useEffect(() => {
    if (!autoPrint) return undefined
    const t = setTimeout(() => {
      window.print()
    }, 200)
    return () => clearTimeout(t)
  }, [autoPrint])

  return (
    <div
      className="wms-print-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        overflowY: 'auto',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <style>{`
        .wms-print-sheet {
          width: 210mm;
          max-width: 100%;
          min-height: 297mm;
          background: #ffffff;
          color: #0f172a;
          padding: 12mm 14mm;
          border-radius: 6px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 11px;
          line-height: 1.35;
          box-sizing: border-box;
        }
        .wms-print-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 10px;
          margin-bottom: 12px;
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
          color: #475569;
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
          margin-bottom: 12px;
        }
        .wms-print-meta-label {
          font-size: 9px;
          text-transform: uppercase;
          color: #64748b;
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
          font-size: 10.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #0f172a;
          background: #e2e8f0;
          padding: 5px 8px;
          border-left: 4px solid #0f172a;
          margin: 12px 0 6px 0;
        }
        .wms-print-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 10px;
          font-size: 10.5px;
        }
        .wms-print-table th {
          background: #0f172a;
          color: #ffffff;
          text-align: left;
          padding: 5px 7px;
          font-size: 9.5px;
          text-transform: uppercase;
          font-weight: 700;
          border: 1px solid #0f172a;
        }
        .wms-print-table td {
          padding: 5px 7px;
          border: 1px solid #cbd5e1;
          vertical-align: middle;
          color: #0f172a;
        }
        .wms-print-table tbody tr:nth-child(even) td {
          background: #f8fafc;
        }
        .wms-print-table tfoot td {
          background: #e2e8f0;
          font-weight: 800;
          border: 1px solid #94a3b8;
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
          min-height: 36px;
        }
        .wms-print-signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-top: 28px;
          page-break-inside: avoid;
        }
        .wms-print-sign-box {
          border: 1px solid #94a3b8;
          border-radius: 4px;
          padding: 10px 12px;
          background: #ffffff;
        }
        .wms-print-sign-line {
          border-top: 1px solid #0f172a;
          margin-top: 34px;
          padding-top: 4px;
          font-size: 10px;
          font-weight: 700;
          text-align: center;
          color: #0f172a;
        }
        .wms-print-sign-sub {
          font-size: 9.5px;
          color: #475569;
          margin-top: 5px;
          line-height: 1.5;
        }
        .wms-print-footer {
          margin-top: 16px;
          padding-top: 6px;
          border-top: 1px solid #cbd5e1;
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          color: #64748b;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 10mm 10mm 10mm;
          }
          body * {
            visibility: hidden !important;
          }
          .wms-print-overlay {
            position: static !important;
            background: transparent !important;
            padding: 0 !important;
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
          }
          .wms-print-sheet {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            min-height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
        }
      `}</style>

      <div
        className="wms-print-toolbar no-print"
        style={{
          width: '210mm',
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
        <div style={{ fontWeight: 700, fontSize: '14px' }}>{title}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.print()}
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

      <div className="wms-print-sheet">{children}</div>
    </div>
  )
}
