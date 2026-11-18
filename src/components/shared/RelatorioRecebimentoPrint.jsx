import React from 'react'
import { PrintDocumentModal, fmtKg, fmtData, fmtDataHora } from './PrintDocumentModal'

export function RelatorioRecebimentoPrint({ pedido, onClose, autoPrint = true }) {
  if (!pedido) return null

  const itens = pedido.itens || []
  const caixas = pedido.caixas_bipadas || []
  const totalSol = itens.reduce((s, i) => s + Number(i.qtd_kg_solicitada || 0), 0)
  const totalRec = itens.reduce((s, i) => s + Number(i.qtd_kg_recebida || 0), 0)
  const difGeral = totalRec - totalSol

  return (
    <PrintDocumentModal
      title={`Relatório de Conferência de Recebimento — ${pedido.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
    >
      <div className="wms-print-header">
        <div>
          <div className="wms-print-brand">TRICARNES ALIMENTOS LTDA.</div>
          <div className="wms-print-brand-sub">WMSphere ERP — Relatório de Recebimento, Pesagem & Temperatura (SIF)</div>
        </div>
        <div>
          <div className="wms-print-doc-title">RECEBIMENTO — {pedido.codigo}</div>
          <div style={{ textAlign: 'right', fontSize: '10px', color: '#475569', marginTop: '2px' }}>
            {pedido.recebimento?.codigo ? `${pedido.recebimento.codigo} • ` : ''}
            Impressão: {new Date().toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <div className="wms-print-meta-grid">
        <div>
          <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>Fornecedor / Frigorífico</div>
          <div style={{ fontSize: '12px', fontWeight: 800 }}>
            {pedido.fornecedor_nome} {pedido.fornecedor_sif ? `(SIF ${pedido.fornecedor_sif})` : ''}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>NF-e / Status Pedido</div>
          <div style={{ fontSize: '11px', fontWeight: 700 }}>
            {pedido.recebimento?.numero_nf ? `NF ${pedido.recebimento.numero_nf}` : 'Sem NF informada'} • {pedido.status}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>Total Solicitado vs Recebido</div>
          <div style={{ fontSize: '12px', fontWeight: 800 }}>
            {fmtKg(totalSol)} → {fmtKg(totalRec)} ({difGeral >= 0 ? `+${fmtKg(difGeral)}` : fmtKg(difGeral)})
          </div>
        </div>
      </div>

      <div style={{ fontSize: '11px', fontWeight: 800, margin: '10px 0 4px', textTransform: 'uppercase' }}>
        1. Itens Conferidos & Controle de Temperatura (Amostragem)
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th style={{ textAlign: 'right' }}>Solicitado (kg)</th>
            <th style={{ textAlign: 'right' }}>Recebido (kg)</th>
            <th style={{ textAlign: 'right' }}>Diferença</th>
            <th style={{ textAlign: 'center' }}>Temperatura (°C)</th>
            <th>Aferido por</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((it) => {
            const sol = Number(it.qtd_kg_solicitada || 0)
            const rec = Number(it.qtd_kg_recebida || 0)
            const dif = rec - sol
            const pct = sol > 0 ? (dif / sol) * 100 : 0
            return (
              <tr key={it.id}>
                <td><strong>{it.produto_codigo}</strong> — {it.produto_descricao}</td>
                <td style={{ textAlign: 'right' }}>{fmtKg(sol)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(rec)}</td>
                <td style={{ textAlign: 'right' }}>
                  {dif >= 0 ? `+${fmtKg(dif)}` : fmtKg(dif)} ({pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`})
                </td>
                <td style={{ textAlign: 'center', fontWeight: 800 }}>
                  {it.temperatura_c != null ? `${Number(it.temperatura_c).toFixed(1).replace('.', ',')} °C` : 'Não aferida'}
                </td>
                <td>
                  {it.temperatura_registrada_por ? `${it.temperatura_registrada_por} (${fmtDataHora(it.temperatura_registrada_em)})` : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {caixas.length > 0 && (
        <>
          <div style={{ fontSize: '11px', fontWeight: 800, margin: '12px 0 4px', textTransform: 'uppercase' }}>
            2. Detalhamento das Caixas Pesadas / Bipadas ({caixas.length} vol.)
          </div>
          <table className="wms-print-table">
            <thead>
              <tr>
                <th>EAN / Etiqueta</th>
                <th>Produto</th>
                <th>Lote / Validade</th>
                <th>Peças</th>
                <th style={{ textAlign: 'right' }}>Bruto</th>
                <th style={{ textAlign: 'right' }}>Tara</th>
                <th style={{ textAlign: 'right' }}>Líquido</th>
                <th>End.</th>
              </tr>
            </thead>
            <tbody>
              {caixas.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'monospace' }}>{c.ean_caixa}</td>
                  <td>{c.produto_codigo} — {c.produto_descricao}</td>
                  <td>{c.lote || '-'} • {fmtData(c.validade)}</td>
                  <td>{c.qtd_pecas ?? '-'}</td>
                  <td style={{ textAlign: 'right' }}>{c.peso_bruto_kg != null ? fmtKg(c.peso_bruto_kg) : '-'}</td>
                  <td style={{ textAlign: 'right' }}>{c.tara_kg != null ? `${Number(c.tara_kg).toFixed(3)} kg` : '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(c.peso_kg)}</td>
                  <td>{c.endereco || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px', fontSize: '10px' }}>
        <div style={{ borderTop: '1px solid #000', paddingTop: '4px', textAlign: 'center' }}>
          Conferente / Operador Doca
        </div>
        <div style={{ borderTop: '1px solid #000', paddingTop: '4px', textAlign: 'center' }}>
          Controle de Qualidade / Analista
        </div>
      </div>
    </PrintDocumentModal>
  )
}
