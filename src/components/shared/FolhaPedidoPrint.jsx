import React from 'react'
import { PrintDocumentModal, fmtKg, fmtNum, fmtData, fmtDataHora } from './PrintDocumentModal'

const STATUS_LABELS = {
  RASCUNHO: 'Rascunho',
  LIBERADO: 'Liberado para Separação',
  EM_SEPARACAO: 'Em Separação',
  AGUARDANDO_CONFERENCIA: 'Separação Finalizada / Aguardando Conferência',
  EM_CONFERENCIA: 'Em Conferência',
  EXPEDIDO: 'Expedido',
  CANCELADO: 'Cancelado'
}

export function FolhaPedidoPrint({ pedido, onClose, autoPrint = true }) {
  if (!pedido) return null

  const itens = pedido.itens || []
  const totalKgSolicitado = itens.reduce((s, it) => s + Number(it.qtd_kg_solicitada || 0), 0)
  const totalCxSolicitadas = itens.reduce((s, it) => s + Number(it.qtd_caixas_solicitada || 0), 0)

  return (
    <PrintDocumentModal
      title={`Folha do Pedido — ${pedido.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
    >
      <div className="wms-print-header">
        <div>
          <div className="wms-print-brand">TRICARNES ALIMENTOS LTDA.</div>
          <div className="wms-print-brand-sub">WMSphere ERP — Folha de Pedido para Separação em Câmara</div>
        </div>
        <div>
          <div className="wms-print-doc-title">FOLHA DO PEDIDO — {pedido.codigo}</div>
          <div style={{ textAlign: 'right', fontSize: '10px', color: '#475569', marginTop: '2px' }}>
            Emissão da Folha: {new Date().toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <div style={{
        background: '#0f172a',
        color: '#ffffff',
        padding: '8px 12px',
        borderRadius: '4px',
        marginBottom: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px'
      }}>
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', opacity: 0.8 }}>Título do Pedido (Romaneio de Embarque)</div>
          <div style={{ fontSize: '14px', fontWeight: 800 }}>{pedido.titulo}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', opacity: 0.8 }}>Status</div>
          <div style={{ fontSize: '11px', fontWeight: 700 }}>{STATUS_LABELS[pedido.status] || pedido.status}</div>
        </div>
      </div>

      <div className="wms-print-meta-grid">
        <div>
          <div className="wms-print-meta-label">Nº do Pedido</div>
          <div className="wms-print-meta-value wms-print-mono">{pedido.codigo}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Cliente / Destino</div>
          <div className="wms-print-meta-value">{pedido.cliente || 'PAVAN'}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Previsão de Coleta / Entrega</div>
          <div className="wms-print-meta-value">{fmtData(pedido.previsao_entrega)}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Criado por</div>
          <div className="wms-print-meta-value">{pedido.criado_por_nome || '-'}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Data de Criação</div>
          <div className="wms-print-meta-value">{fmtDataHora(pedido.created_at)}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Total Solicitado</div>
          <div className="wms-print-meta-value">{itens.length} itens | {fmtKg(totalKgSolicitado)}</div>
        </div>
      </div>

      <div className="wms-print-section-title">Relação de Itens Solicitados no Pedido</div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '5%', textAlign: 'center' }}>#</th>
            <th style={{ width: '10%' }}>Cód.</th>
            <th style={{ width: '37%' }}>Produto / Corte</th>
            <th style={{ width: '13%', textAlign: 'right' }}>Kg Pedido</th>
            <th style={{ width: '11%', textAlign: 'center' }}>Cx Prev.</th>
            <th style={{ width: '12%', textAlign: 'center' }}>Separado</th>
            <th style={{ width: '12%' }}>Obs.</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((it, idx) => (
            <tr key={it.id || idx}>
              <td style={{ textAlign: 'center' }}>{idx + 1}</td>
              <td className="wms-print-mono">{it.produto_codigo || '-'}</td>
              <td style={{ fontWeight: 700 }}>{it.produto_descricao}</td>
              <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmtKg(it.qtd_kg_solicitada)}</td>
              <td style={{ textAlign: 'center' }}>{it.qtd_caixas_solicitada ? `${it.qtd_caixas_solicitada} cx` : '-'}</td>
              <td style={{ textAlign: 'center', color: '#64748b' }}>_______ kg / ___ cx</td>
              <td>{it.observacao || '-'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ textAlign: 'right' }}>TOTAIS DO PEDIDO:</td>
            <td style={{ textAlign: 'right' }}>{fmtKg(totalKgSolicitado)}</td>
            <td style={{ textAlign: 'center' }}>{totalCxSolicitadas > 0 ? `${totalCxSolicitadas} cx` : '-'}</td>
            <td colSpan={2} style={{ textAlign: 'center' }}>{itens.length} produto(s)</td>
          </tr>
        </tfoot>
      </table>

      <div className="wms-print-section-title">Observações do Pedido</div>
      <div className="wms-print-obs">
        {pedido.observacoes?.trim() ? pedido.observacoes : 'Sem observações adicionais registradas.'}
      </div>

      <div style={{ marginTop: '14px', fontSize: '10px', color: '#475569', border: '1px dashed #94a3b8', padding: '7px 10px', borderRadius: '4px' }}>
        <strong>Instrução de Câmara:</strong> Seguir regra FEFO (validade mais próxima sai primeiro). Tolerância padrão de separação: até +50% por item; acima de +50% ou item fora do pedido requer confirmação na tela de Saída.
      </div>

      <div className="wms-print-footer">
        <span>WMSphere ERP — Gestão de Pedidos e Câmara Fria</span>
        <span>Pedido {pedido.codigo}</span>
        <span>Impresso em {new Date().toLocaleDateString('pt-BR')}</span>
      </div>
    </PrintDocumentModal>
  )
}
