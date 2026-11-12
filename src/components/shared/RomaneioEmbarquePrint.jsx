import React from 'react'
import { PrintDocumentModal, fmtKg, fmtNum, fmtData, fmtDataHora } from './PrintDocumentModal'

export function RomaneioEmbarquePrint({ romaneio, onClose, autoPrint = true }) {
  if (!romaneio) return null

  const itens = romaneio.itens || []
  const resumoProdutos = romaneio.resumoProdutos || []
  const pedidoItens = romaneio.pedidoItens || []
  const totalCaixas = itens.length
  const totalPeso = itens.reduce((s, it) => s + Number(it.peso_kg || 0), 0)
  const qtdConferidas = itens.filter((it) => Number(it.conferido) === 1).length
  const temPedido = Boolean(romaneio.pedido_id)

  const tituloPrincipal = romaneio.pedido_titulo || romaneio.cliente || 'Romaneio de Embarque'
  const clienteExibido = romaneio.pedido_cliente || romaneio.cliente || 'PAVAN'

  let statusDocumento = 'Separação Finalizada (Pré-Embarque)'
  if (romaneio.status === 'EXPEDIDO') {
    statusDocumento = 'EXPEDIDO'
  } else if (totalCaixas > 0 && qtdConferidas === totalCaixas) {
    statusDocumento = 'Conferido (Pronto para Expedir)'
  } else if (qtdConferidas > 0) {
    statusDocumento = `Em Conferência (${qtdConferidas}/${totalCaixas} cx)`
  }

  // Consolida resumo comparando Pedido x Separado (incluindo itens extras fora do pedido se houver)
  const linhasResumo = []
  const idsNoPedido = new Set()
  for (const pi of pedidoItens) {
    idsNoPedido.add(pi.produto_id)
    const sep = resumoProdutos.find((r) => r.produto_id === pi.produto_id)
    const kgPedido = Number(pi.qtd_kg_solicitada || 0)
    const kgSeparado = Number(sep?.total_kg || 0)
    linhasResumo.push({
      produto_id: pi.produto_id,
      codigo: pi.produto_codigo,
      descricao: pi.produto_descricao,
      kgPedido,
      kgSeparado,
      difKg: kgSeparado - kgPedido,
      caixas: sep?.qtd_caixas || 0,
      conferidas: sep?.qtd_conferidas || 0,
      extra: false
    })
  }
  for (const r of resumoProdutos) {
    if (!idsNoPedido.has(r.produto_id)) {
      linhasResumo.push({
        produto_id: r.produto_id,
        codigo: r.produto_codigo,
        descricao: r.produto_descricao,
        kgPedido: 0,
        kgSeparado: Number(r.total_kg || 0),
        difKg: Number(r.total_kg || 0),
        caixas: r.qtd_caixas || 0,
        conferidas: r.qtd_conferidas || 0,
        extra: temPedido
      })
    }
  }

  const totalPedidoKg = linhasResumo.reduce((s, r) => s + r.kgPedido, 0)

  return (
    <PrintDocumentModal
      title={`Romaneio de Embarque — ${romaneio.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
    >
      <div className="wms-print-header">
        <div>
          <div className="wms-print-brand">TRICARNES ALIMENTOS LTDA.</div>
          <div className="wms-print-brand-sub">WMSphere ERP — Comprovante Oficial de Separação e Embarque</div>
        </div>
        <div>
          <div className="wms-print-doc-title">ROMANEIO DE EMBARQUE — {romaneio.codigo}</div>
          <div style={{ textAlign: 'right', fontSize: '10px', color: '#475569', marginTop: '2px' }}>
            {romaneio.pedido_codigo ? `Pedido Vinculado: ${romaneio.pedido_codigo} • ` : ''}
            Emissão: {new Date().toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      {/* Título do Pedido em destaque */}
      <div style={{
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
        gap: '12px'
      }}>
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 800, color: '#475569' }}>
            {temPedido ? 'Título do Pedido / Identificação da Carga' : 'Identificação / Destino'}
          </div>
          <div style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a' }}>{tituloPrincipal}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 800, color: '#475569' }}>Situação</div>
          <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>{statusDocumento}</div>
        </div>
      </div>

      <div className="wms-print-meta-grid">
        <div>
          <div className="wms-print-meta-label">Romaneio / Pedido</div>
          <div className="wms-print-meta-value wms-print-mono">
            {romaneio.codigo}{romaneio.pedido_codigo ? ` / ${romaneio.pedido_codigo}` : ''}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Cliente / Coleta</div>
          <div className="wms-print-meta-value">{clienteExibido}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Previsão de Entrega</div>
          <div className="wms-print-meta-value">{fmtData(romaneio.previsao_entrega)}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Separado por</div>
          <div className="wms-print-meta-value">{romaneio.operador_nome || '-'}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Conferido por</div>
          <div className="wms-print-meta-value">
            {romaneio.operador_conferencia_nome || `${qtdConferidas}/${totalCaixas} cx bipadas`}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">
            {romaneio.status === 'EXPEDIDO' ? 'Expedido em / por' : 'Total Carregamento'}
          </div>
          <div className="wms-print-meta-value">
            {romaneio.status === 'EXPEDIDO'
              ? `${fmtDataHora(romaneio.expedido_at)} (${romaneio.operador_expedicao_nome || '-'})`
              : `${totalCaixas} cx | ${fmtKg(totalPeso)}`}
          </div>
        </div>
      </div>

      {/* Resumo consolidado por produto */}
      <div className="wms-print-section-title">
        1. Resumo Consolidado por Produto ({linhasResumo.length} {linhasResumo.length === 1 ? 'produto' : 'produtos'})
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '9%' }}>Cód.</th>
            <th style={{ width: temPedido ? '37%' : '53%' }}>Produto</th>
            {temPedido && <th style={{ width: '13%', textAlign: 'right' }}>Kg Pedido</th>}
            <th style={{ width: '14%', textAlign: 'right' }}>Kg Embarque</th>
            {temPedido && <th style={{ width: '11%', textAlign: 'right' }}>Diferença</th>}
            <th style={{ width: '8%', textAlign: 'center' }}>Caixas</th>
            <th style={{ width: '8%', textAlign: 'center' }}>Conf.</th>
          </tr>
        </thead>
        <tbody>
          {linhasResumo.map((r, idx) => (
            <tr key={r.produto_id || idx}>
              <td className="wms-print-mono">{r.codigo || '-'}</td>
              <td>
                <strong>{r.descricao}</strong>
                {r.extra && (
                  <span style={{
                    marginLeft: '6px',
                    fontSize: '8.5px',
                    padding: '1px 4px',
                    borderRadius: '3px',
                    background: '#fef3c7',
                    color: '#92400e',
                    border: '1px solid #f59e0b'
                  }}>
                    FORA DO PEDIDO
                  </span>
                )}
              </td>
              {temPedido && <td style={{ textAlign: 'right' }}>{r.kgPedido > 0 ? fmtKg(r.kgPedido) : '-'}</td>}
              <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtKg(r.kgSeparado)}</td>
              {temPedido && (
                <td style={{ textAlign: 'right', color: r.difKg < 0 ? '#b91c1c' : '#15803d', fontWeight: 700 }}>
                  {r.kgPedido > 0 ? `${r.difKg >= 0 ? '+' : ''}${fmtNum(r.difKg)} kg` : '-'}
                </td>
              )}
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.caixas}</td>
              <td style={{ textAlign: 'center' }}>{r.conferidas}/{r.caixas}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} style={{ textAlign: 'right' }}>TOTAIS:</td>
            {temPedido && <td style={{ textAlign: 'right' }}>{fmtKg(totalPedidoKg)}</td>}
            <td style={{ textAlign: 'right' }}>{fmtKg(totalPeso)}</td>
            {temPedido && (
              <td style={{ textAlign: 'right' }}>
                {`${totalPeso - totalPedidoKg >= 0 ? '+' : ''}${fmtNum(totalPeso - totalPedidoKg)} kg`}
              </td>
            )}
            <td style={{ textAlign: 'center' }}>{totalCaixas} cx</td>
            <td style={{ textAlign: 'center' }}>{qtdConferidas}/{totalCaixas}</td>
          </tr>
        </tfoot>
      </table>

      {/* Relação caixa a caixa */}
      <div className="wms-print-section-title">
        2. Relação Analítica Caixa a Caixa — {totalCaixas} caixas | {fmtKg(totalPeso)}
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '5%', textAlign: 'center' }}>#</th>
            <th style={{ width: '31%' }}>Produto</th>
            <th style={{ width: '22%' }}>EAN / Código da Caixa</th>
            <th style={{ width: '10%', textAlign: 'center' }}>Lote</th>
            <th style={{ width: '11%', textAlign: 'center' }}>Validade</th>
            <th style={{ width: '11%', textAlign: 'right' }}>Peso</th>
            <th style={{ width: '10%', textAlign: 'center' }}>Conf.</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((cx, i) => (
            <tr key={cx.id || i}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td style={{ fontWeight: 600 }}>{cx.produto_descricao}</td>
              <td className="wms-print-mono">{cx.ean_caixa}</td>
              <td className="wms-print-mono" style={{ textAlign: 'center' }}>{cx.lote || '-'}</td>
              <td style={{ textAlign: 'center' }}>{fmtData(cx.validade)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(cx.peso_kg)}</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: Number(cx.conferido) === 1 ? '#15803d' : '#64748b' }}>
                {Number(cx.conferido) === 1 ? 'OK' : 'Pendente'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} style={{ textAlign: 'right' }}>TOTAL GERAL DO ROMANEIO:</td>
            <td style={{ textAlign: 'right' }}>{fmtKg(totalPeso)}</td>
            <td style={{ textAlign: 'center' }}>{totalCaixas} cx</td>
          </tr>
        </tfoot>
      </table>

      {romaneio.pedido_observacoes?.trim() && (
        <div className="wms-print-obs">
          <strong>Observações do Pedido:</strong> {romaneio.pedido_observacoes}
        </div>
      )}

      {/* Assinaturas obrigatórias (coleta própria PAVAN - sem placa/motorista) */}
      <div className="wms-print-signatures">
        <div className="wms-print-sign-box">
          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
            Expedido por (Tricarnes / WMS)
          </div>
          <div className="wms-print-sign-sub">
            Nome: {romaneio.operador_expedicao_nome || romaneio.operador_conferencia_nome || '___________________________________'}<br />
            Data/Hora: {romaneio.expedido_at ? fmtDataHora(romaneio.expedido_at) : '____/____/________  ____:____'}
          </div>
          <div className="wms-print-sign-line">Assinatura de quem expediu</div>
        </div>

        <div className="wms-print-sign-box">
          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
            Recebido / Retirado por ({clienteExibido})
          </div>
          <div className="wms-print-sign-sub">
            Nome Legível: _______________________________________<br />
            RG / CPF: _______________________ &nbsp; Data: ____/____/________
          </div>
          <div className="wms-print-sign-line">Assinatura de quem retirou / conferiu</div>
        </div>
      </div>

      <div className="wms-print-footer">
        <span>WMSphere ERP — Romaneio de Embarque</span>
        <span>{romaneio.codigo}{romaneio.pedido_codigo ? ` • ${romaneio.pedido_codigo}` : ''}</span>
        <span>Coleta Própria — Conferência Caixa a Caixa</span>
      </div>
    </PrintDocumentModal>
  )
}
