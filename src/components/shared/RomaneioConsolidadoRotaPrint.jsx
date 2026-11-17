import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { PrintDocumentModal, fmtKg, fmtData, fmtDataHora } from './PrintDocumentModal'

const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Romaneio Consolidado do Roteiro / Embarque (A4).
 * Suporta:
 * - 'OPCAO_B' (padrão): impresso antes ou na carga, lista entregas na sequência e traz quadro para o motorista preencher/assinar placa & NF na saída.
 * - 'OPCAO_A_PREVIA': prévia de carregamento antes da bipagem (sem assinatura).
 * - 'OPCAO_A_OFICIAL': via oficial pós-bipagem com pesos reais carregados, placa, NF e assinatura.
 */
export function RomaneioConsolidadoRotaPrint({
  embarque,
  modo = 'OPCAO_B',
  rastreioAtivo = true,
  onClose,
  autoPrint = true,
}) {
  const [qrDataUrl, setQrDataUrl] = useState('')

  const baseAppUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''
  const motoristaUrl = embarque?.qr_token ? `${baseAppUrl}#/motorista/${embarque.qr_token}` : ''

  useEffect(() => {
    let alive = true
    if (rastreioAtivo && motoristaUrl) {
      QRCode.toDataURL(motoristaUrl, { width: 120, margin: 1 })
        .then((url) => {
          if (alive) setQrDataUrl(url)
        })
        .catch(() => {})
    } else {
      setQrDataUrl('')
    }
    return () => {
      alive = false
    }
  }, [rastreioAtivo, motoristaUrl])

  if (!embarque) return null

  const isPrevia = modo === 'OPCAO_A_PREVIA'
  const tituloDoc = isPrevia
    ? `PRÉVIA DE CARREGAMENTO DO ROTEIRO — ${embarque.codigo}`
    : `ROMANEIO CONSOLIDADO DE EMBARQUE — ${embarque.codigo}`

  const paradas = embarque.paradas || []
  const produtosConsolidados = embarque.produtos_consolidados || []
  const resumo = embarque.resumo || {}
  const pesoReal = Number(resumo.peso_real_kg || 0)
  const pesoPedido = Number(resumo.peso_pedido_kg || 0)
  const temPesosReais = pesoReal > 0 && Number(resumo.pedidos_sem_peso_real || 0) === 0

  return (
    <PrintDocumentModal
      title={`${isPrevia ? 'Prévia de Carregamento' : 'Romaneio Consolidado'} — ${embarque.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
    >
      <div className="wms-print-header">
        <div>
          <div className="wms-print-brand">TRICARNES ALIMENTOS LTDA.</div>
          <div className="wms-print-brand-sub">
            WMSphere ERP — {isPrevia ? 'Prévia de Separação e Carregamento (Sem Assinatura)' : 'Romaneio Consolidado de Entrega e Transporte'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="wms-print-doc-title">{tituloDoc}</div>
            <div style={{ textAlign: 'right', fontSize: '10px', color: '#475569', marginTop: '2px' }}>
              Data Embarque: {fmtData(embarque.data_embarque)} • Emissão: {new Date().toLocaleString('pt-BR')}
            </div>
          </div>
          {qrDataUrl && !isPrevia && (
            <div style={{ textAlign: 'center', border: '1px solid #cbd5e1', padding: 3, borderRadius: 4, background: '#fff' }}>
              <img src={qrDataUrl} alt="QR Code Motorista" style={{ width: 62, height: 62, display: 'block' }} />
              <div style={{ fontSize: '7.5px', fontWeight: 700, color: '#0f172a' }}>QR ROTA MOTORISTA</div>
            </div>
          )}
        </div>
      </div>

      {/* Aviso claro se impresso como prévia sem pesos reais */}
      {!temPesosReais && (
        <div
          style={{
            background: '#fef3c7',
            border: '1.5px solid #f59e0b',
            color: '#92400e',
            padding: '6px 10px',
            borderRadius: '4px',
            marginBottom: '10px',
            fontSize: '10px',
            fontWeight: 700,
          }}
        >
          ATENÇÃO: Documento impresso com pesos solicitados / parciais ({resumo.pedidos_sem_peso_real || 0} pedido(s) ainda sem pesagem final). Não utilizar para faturamento definitivo antes de concluir a separação.
        </div>
      )}

      <div className="wms-print-meta-grid">
        <div>
          <div className="wms-print-meta-label">Roteiro / Embarque</div>
          <div className="wms-print-meta-value wms-print-mono">
            {embarque.codigo} • {embarque.titulo || '-'}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Rota / Transportadora</div>
          <div className="wms-print-meta-value">
            {[embarque.rota_nome, embarque.transportadora_nome].filter(Boolean).join(' • ') || 'Transporte Próprio / A Definir'}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Motorista / Placa</div>
          <div className="wms-print-meta-value">
            {embarque.motorista_nome || embarque.veiculo_placa
              ? `${embarque.motorista_nome || '___________'} • Placa: ${embarque.veiculo_placa || '________'}`
              : 'Motorista: ____________ • Placa: ________'}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Total de Paradas / NFs</div>
          <div className="wms-print-meta-value">
            {paradas.length} entrega(s) {embarque.numero_nf_lote ? `• NFs: ${embarque.numero_nf_lote}` : '• NFs: ____________'}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Volumes &amp; Pesos Consolidados</div>
          <div className="wms-print-meta-value">
            {resumo.total_caixas || 0} cx ({resumo.caixas_carregadas || 0} carregadas) • {fmtKg(pesoReal > 0 ? pesoReal : pesoPedido)}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Valor Total da Carga</div>
          <div className="wms-print-meta-value">{fmtMoeda(resumo.valor_total)}</div>
        </div>
      </div>

      {/* 1. Ordem das Entregas */}
      <div className="wms-print-section-title">
        1. Sequência de Entregas no Roteiro ({paradas.length} {paradas.length === 1 ? 'parada' : 'paradas'})
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '6%', textAlign: 'center' }}>Seq.</th>
            <th style={{ width: '11%' }}>Pedido</th>
            <th style={{ width: '31%' }}>Cliente / Endereço de Entrega</th>
            <th style={{ width: '10%', textAlign: 'center' }}>Caixas</th>
            <th style={{ width: '13%', textAlign: 'right' }}>Peso Pedido</th>
            <th style={{ width: '13%', textAlign: 'right' }}>Peso Real</th>
            <th style={{ width: '16%', textAlign: 'right' }}>Valor / Cobrança</th>
          </tr>
        </thead>
        <tbody>
          {paradas.map((p) => (
            <tr key={p.pedido_id}>
              <td style={{ textAlign: 'center', fontWeight: 900, fontSize: '12px' }}>#{p.ordem_parada}</td>
              <td className="wms-print-mono">
                <strong>{p.pedido_codigo}</strong>
                {p.romaneio_codigo && <div style={{ fontSize: '9px', color: '#475569' }}>{p.romaneio_codigo}</div>}
              </td>
              <td>
                <strong>{p.cliente}</strong>
                <div style={{ fontSize: '9.5px', color: '#475569' }}>{p.endereco_entrega}</div>
              </td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>
                {p.caixas_total > 0 ? `${p.caixas_carregadas}/${p.caixas_total}` : '-'}
              </td>
              <td style={{ textAlign: 'right' }}>{fmtKg(p.kg_pedido)}</td>
              <td style={{ textAlign: 'right', fontWeight: 800 }}>
                {p.kg_real > 0 ? fmtKg(p.kg_real) : <span style={{ color: '#b45309' }}>A pesar</span>}
              </td>
              <td style={{ textAlign: 'right' }}>
                <strong>{fmtMoeda(p.valor_total)}</strong>
                {p.pagamento_na_entrega && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: '8px',
                      fontWeight: 800,
                      color: '#991b1b',
                      background: '#fee2e2',
                      padding: '1px 4px',
                      borderRadius: 3,
                      display: 'inline-block',
                    }}
                  >
                    COBRAR NA ENTREGA
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ textAlign: 'right' }}>
              TOTAIS DO ROTEIRO:
            </td>
            <td style={{ textAlign: 'center' }}>{resumo.total_caixas || 0} cx</td>
            <td style={{ textAlign: 'right' }}>{fmtKg(pesoPedido)}</td>
            <td style={{ textAlign: 'right' }}>{fmtKg(pesoReal)}</td>
            <td style={{ textAlign: 'right' }}>{fmtMoeda(resumo.valor_total)}</td>
          </tr>
        </tfoot>
      </table>

      {/* 2. Consolidado Geral de Produtos para Carregamento */}
      <div className="wms-print-section-title">
        2. Consolidado de Cortes da Carga ({produtosConsolidados.length} {produtosConsolidados.length === 1 ? 'produto' : 'produtos'})
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '11%' }}>Cód.</th>
            <th style={{ width: '47%' }}>Produto / Corte</th>
            <th style={{ width: '14%', textAlign: 'center' }}>Caixas (Bipadas)</th>
            <th style={{ width: '14%', textAlign: 'right' }}>Kg Pedido</th>
            <th style={{ width: '14%', textAlign: 'right' }}>Kg Real</th>
          </tr>
        </thead>
        <tbody>
          {produtosConsolidados.map((prod) => (
            <tr key={prod.produto_id}>
              <td className="wms-print-mono">{prod.codigo}</td>
              <td style={{ fontWeight: 700 }}>{prod.descricao}</td>
              <td style={{ textAlign: 'center' }}>
                {prod.caixas_carregadas}/{prod.caixas_total} cx
              </td>
              <td style={{ textAlign: 'right' }}>{fmtKg(prod.kg_pedido)}</td>
              <td style={{ textAlign: 'right', fontWeight: 800 }}>
                {prod.kg_real > 0 ? fmtKg(prod.kg_real) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {embarque.observacoes?.trim() && (
        <div className="wms-print-obs">
          <strong>Observações da Expedição:</strong> {embarque.observacoes}
        </div>
      )}

      {/* Assinatura do Motorista no fim do carregamento (oculto apenas na Prévia Opção A) */}
      {!isPrevia && (
        <div className="wms-print-signatures" style={{ marginTop: '24px' }}>
          <div className="wms-print-sign-box">
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
              Conferente / Operador Carregamento (WMS)
            </div>
            <div className="wms-print-sign-sub">
              Operador: {embarque.operador_carregamento_nome || '___________________________________'}
              <br />
              Carregamento: {embarque.iniciado_em ? fmtDataHora(embarque.iniciado_em) : '____/____/________  ____:____'}
            </div>
            <div className="wms-print-sign-line" style={{ marginTop: '44px' }}>
              Assinatura Doca / Expedição
            </div>
          </div>

          <div className="wms-print-sign-box">
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
              Recebido para Transporte (Motorista / Transportadora)
            </div>
            <div className="wms-print-sign-sub">
              Nome: {embarque.motorista_nome || '_______________________________'} • Placa:{' '}
              {embarque.veiculo_placa || '__________'}
              <br />
              NFs Vinculadas: {embarque.numero_nf_lote || '________________________________________'}
            </div>
            <div className="wms-print-sign-line" style={{ marginTop: '44px' }}>
              Assinatura do Motorista (Declaro conferir caixas e volumes acima)
            </div>
          </div>
        </div>
      )}

      <div className="wms-print-footer">
        <span>WMSphere ERP — Romaneio Consolidado de Roteiro</span>
        <span>
          {embarque.codigo} • {modo === 'OPCAO_A_PREVIA' ? 'Prévia s/ Assinatura' : modo === 'OPCAO_A_OFICIAL' ? 'Via Oficial Carregada' : 'Modalidade Padrão (Opção B)'}
        </span>
        <span>{paradas.length} entrega(s) • {resumo.total_caixas || 0} cx</span>
      </div>
    </PrintDocumentModal>
  )
}
