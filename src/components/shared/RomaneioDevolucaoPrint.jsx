import React from 'react'
import { PrintDocumentModal, fmtKg, fmtData, fmtDataHora } from './PrintDocumentModal'

const STATUS_FISCAL_LABEL = {
  PENDENTE_FATURAMENTO: 'Pendente de Tratativa Fiscal (Faturamento)',
  NF_DEVOLUCAO_EMITIDA: 'NF-e de Devolução Emitida',
  DISPENSA_FISCAL: 'Dispensa Fiscal / Ajuste Interno',
}

export function RomaneioDevolucaoPrint({ devolucao, onClose, autoPrint = true }) {
  if (!devolucao) return null

  const itens = devolucao.itens || []
  const totalCaixas = Number(devolucao.qtd_caixas ?? itens.length)
  const totalPeso = itens.length > 0
    ? itens.reduce((s, it) => s + Number(it.peso_kg || 0), 0)
    : Number(devolucao.peso_total_kg || 0)

  // Agrupa resumo por produto igual ao Romaneio de Embarque
  const resumoMap = new Map()
  for (const it of itens) {
    const key = String(it.produto_id || it.produto_codigo || it.produto_descricao)
    const cur = resumoMap.get(key) || {
      key,
      codigo: it.produto_codigo || '-',
      descricao: it.produto_descricao || '-',
      caixas: 0,
      kgTotal: 0,
      valorTotal: 0,
    }
    const kg = Number(it.peso_kg || 0)
    const preco = Number(it.preco_unitario || 0)
    cur.caixas += 1
    cur.kgTotal += kg
    cur.valorTotal += kg * preco
    resumoMap.set(key, cur)
  }
  const resumoProdutos = Array.from(resumoMap.values())
  const valorTotalCalc = Number(devolucao.valor_estimado ?? resumoProdutos.reduce((s, r) => s + r.valorTotal, 0))

  const pedidosUnicos = Array.from(
    new Set(
      [
        ...(devolucao.pedido_codigo ? String(devolucao.pedido_codigo).split(',').map((s) => s.trim()) : []),
        ...itens.map((i) => i.pedido_codigo).filter(Boolean),
      ].filter(Boolean),
    ),
  )
  const pedidoTexto = pedidosUnicos.length > 0 ? pedidosUnicos.join(', ') : 'Avulso / Sem Pedido Vinculado'

  const clientesUnicos = Array.from(
    new Set(
      [
        ...(devolucao.cliente_nome ? String(devolucao.cliente_nome).split(',').map((s) => s.trim()) : []),
        ...itens.map((i) => i.cliente_nome).filter(Boolean),
      ].filter(Boolean),
    ),
  )
  const clienteTexto = clientesUnicos.length > 0 ? clientesUnicos.join(', ') : '-'

  const statusFisicoTexto =
    devolucao.acao_estoque === 'BLOQUEADO'
      ? `Quarentena / Bloqueado (${devolucao.endereco_destino || '-'})`
      : `Reintegrado Disponível (${devolucao.endereco_destino || '-'})`

  return (
    <PrintDocumentModal
      title={`Romaneio de Devolução — ${devolucao.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
    >
      <div className="wms-print-header">
        <div>
          <div className="wms-print-brand">TRICARNES ALIMENTOS LTDA.</div>
          <div className="wms-print-brand-sub">WMSphere ERP — Romaneio Oficial de Devolução para Arquivo</div>
        </div>
        <div>
          <div className="wms-print-doc-title">ROMANEIO DE DEVOLUÇÃO — {devolucao.codigo}</div>
          <div style={{ textAlign: 'right', fontSize: '10px', color: '#475569', marginTop: '2px' }}>
            {pedidosUnicos.length > 0 ? `Pedido que Saiu: ${pedidoTexto} • ` : ''}
            Impressão: {new Date().toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      {/* Destaque principal para grampear junto ao pedido/NF */}
      <div
        style={{
          background: '#f1f5f9',
          border: '1.5px solid #0f172a',
          borderLeft: '6px solid #0f172a',
          color: '#0f172a',
          padding: '8px 12px',
          borderRadius: '4px',
          marginBottom: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 800, color: '#475569' }}>
            Cliente / Origem da Mercadoria Retornada
          </div>
          <div style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a' }}>{clienteTexto}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 800, color: '#475569' }}>
            Motivo da Devolução
          </div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
            {devolucao.motivo_label || devolucao.motivo}
          </div>
        </div>
      </div>

      {/* Metadados completos */}
      <div className="wms-print-meta-grid">
        <div>
          <div className="wms-print-meta-label">Protocolo Devolução</div>
          <div className="wms-print-meta-value wms-print-mono">{devolucao.codigo}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Pedido(s) de Saída / Romaneio</div>
          <div className="wms-print-meta-value wms-print-mono">
            {pedidoTexto}
            {devolucao.romaneio_codigo ? ` / ${devolucao.romaneio_codigo}` : ''}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Bipado / Conferido no Retorno por</div>
          <div className="wms-print-meta-value">{devolucao.operador_nome || '-'}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Data / Hora do Retorno</div>
          <div className="wms-print-meta-value">{fmtDataHora(devolucao.created_at)}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Destino Físico no Estoque</div>
          <div className="wms-print-meta-value">{statusFisicoTexto}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Totais Devolvidos</div>
          <div className="wms-print-meta-value">
            {totalCaixas} cx | {fmtKg(totalPeso)}
            {valorTotalCalc > 0
              ? ` | R$ ${valorTotalCalc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : ''}
          </div>
        </div>
      </div>

      {/* Resumo consolidado por produto */}
      <div className="wms-print-section-title">
        1. Resumo Consolidado por Produto ({resumoProdutos.length} {resumoProdutos.length === 1 ? 'produto' : 'produtos'})
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '12%' }}>Cód.</th>
            <th style={{ width: '56%' }}>Produto</th>
            <th style={{ width: '18%', textAlign: 'right' }}>Peso Devolvido</th>
            <th style={{ width: '14%', textAlign: 'center' }}>Caixas</th>
          </tr>
        </thead>
        <tbody>
          {resumoProdutos.map((r) => (
            <tr key={r.key}>
              <td className="wms-print-mono">{r.codigo}</td>
              <td>
                <strong>{r.descricao}</strong>
              </td>
              <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtKg(r.kgTotal)}</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.caixas}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} style={{ textAlign: 'right' }}>
              TOTAIS:
            </td>
            <td style={{ textAlign: 'right' }}>{fmtKg(totalPeso)}</td>
            <td style={{ textAlign: 'center' }}>{totalCaixas} cx</td>
          </tr>
        </tfoot>
      </table>

      {/* Relação caixa a caixa */}
      <div className="wms-print-section-title">
        2. Relação Analítica das Caixas Bipadas — {totalCaixas} caixas | {fmtKg(totalPeso)}
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '5%', textAlign: 'center' }}>#</th>
            <th style={{ width: '31%' }}>Produto</th>
            <th style={{ width: '22%' }}>EAN / Código da Caixa</th>
            <th style={{ width: '13%', textAlign: 'center' }}>Pedido Origem</th>
            <th style={{ width: '9%', textAlign: 'center' }}>Lote</th>
            <th style={{ width: '10%', textAlign: 'center' }}>Validade</th>
            <th style={{ width: '10%', textAlign: 'right' }}>Peso</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((cx, i) => (
            <tr key={cx.id || cx.ean_caixa || i}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td style={{ fontWeight: 600 }}>{cx.produto_descricao}</td>
              <td className="wms-print-mono">{cx.ean_caixa}</td>
              <td className="wms-print-mono" style={{ textAlign: 'center' }}>
                {cx.pedido_codigo || devolucao.pedido_codigo || '-'}
              </td>
              <td className="wms-print-mono" style={{ textAlign: 'center' }}>
                {cx.lote || '-'}
              </td>
              <td style={{ textAlign: 'center' }}>{fmtData(cx.validade)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(cx.peso_kg)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} style={{ textAlign: 'right' }}>
              TOTAL GERAL DO ROMANEIO DE DEVOLUÇÃO ({totalCaixas} cx):
            </td>
            <td style={{ textAlign: 'right' }}>{fmtKg(totalPeso)}</td>
          </tr>
        </tfoot>
      </table>

      {devolucao.observacoes?.trim() && (
        <div className="wms-print-obs">
          <strong>Observações da Devolução:</strong> {devolucao.observacoes}
        </div>
      )}

      {/* Quadro informativo fiscal para arquivamento (sem campo de assinatura externa) */}
      <div
        style={{
          marginTop: '14px',
          padding: '8px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: '4px',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '10px',
          color: '#334155',
        }}
      >
        <div>
          <strong>Situação Fiscal:</strong> {STATUS_FISCAL_LABEL[devolucao.status_fiscal] || devolucao.status_fiscal || 'Pendente NF Devolução'}
          {devolucao.numero_nf_devolucao ? ` (NF Devolução nº ${devolucao.numero_nf_devolucao})` : ''}
        </div>
        <div>
          <strong>Bipado no sistema por:</strong> {devolucao.operador_nome || '-'} em {fmtDataHora(devolucao.created_at)}
        </div>
      </div>

      <div className="wms-print-footer">
        <span>WMSphere ERP — Romaneio de Devolução (Via para Arquivo)</span>
        <span>
          {devolucao.codigo}
          {pedidosUnicos.length > 0 ? ` • Ped. ${pedidoTexto}` : ''}
        </span>
        <span>Operador: {devolucao.operador_nome || '-'}</span>
      </div>
    </PrintDocumentModal>
  )
}
