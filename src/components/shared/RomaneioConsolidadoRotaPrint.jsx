import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { PrintDocumentModal, fmtKg, fmtData, fmtDataHora } from './PrintDocumentModal'

const fmtTemp = (v) =>
  `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`

/**
 * Romaneio Consolidado do Roteiro / Embarque (A4) — Sem exibição de valores financeiros (R$).
 * Suporta:
 * - 'OPCAO_B' / 'ANTES_BIPAGEM': impresso antes da bipagem — exibe apenas "Caixas" (sem contagem bipada) e campo de Temperatura do Baú p/ caneta.
 * - 'OPCAO_A_PREVIA': prévia de carregamento antes da bipagem (sem assinatura).
 * - 'OPCAO_A_OFICIAL' / 'POS_BIPAGEM': via oficial pós-bipagem — exibe "Caixas (Bipadas)", Temperatura do Baú digitada pelo operador e assinatura.
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
  const mostrarBipadas = modo === 'OPCAO_A_OFICIAL' || modo === 'POS_BIPAGEM'
  const tituloDoc = isPrevia
    ? `PRÉVIA DE CARREGAMENTO DO ROTEIRO — ${embarque.codigo}`
    : `ROMANEIO CONSOLIDADO DE EMBARQUE — ${embarque.codigo}`

  const paradas = embarque.paradas || []
  const produtosConsolidados = embarque.produtos_consolidados || []
  const resumo = embarque.resumo || {}
  const pesoReal = Number(resumo.peso_real_kg || 0)
  const pesoBruto = Number(resumo.peso_bruto_kg || 0)
  const pesoPedido = Number(resumo.peso_pedido_kg || 0)
  const temPesosReais = pesoReal > 0 && Number(resumo.pedidos_sem_peso_real || 0) === 0

  // Puxa automaticamente NFs de pedidos já faturados no roteiro (sem campo manual)
  const nfsAuto = Array.from(
    new Set([
      ...(Array.isArray(embarque.nfs_vinculadas) ? embarque.nfs_vinculadas : []),
      ...paradas.map((p) => p.numero_nf).filter((n) => n && String(n).trim() !== ''),
    ]),
  )

  const tempTexto =
    embarque.temperatura_bau !== null && embarque.temperatura_bau !== undefined
      ? fmtTemp(embarque.temperatura_bau)
      : '________ °C'

  const veiculoLabel = [
    embarque.tipo_veiculo_nome
      ? `${embarque.tipo_veiculo_nome}${embarque.capacidade_kg ? ` (${Number(embarque.capacidade_kg)} kg)` : ''}`
      : null,
    embarque.rota_nome,
    embarque.transportadora_nome,
  ]
    .filter(Boolean)
    .join(' • ')

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
              Data Embarque: {fmtData(embarque.data_embarque)}
              {embarque.horario_saida ? ` • Saída: ${embarque.horario_saida}` : ''} • Emissão: {new Date().toLocaleString('pt-BR')}
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

      {/* Aviso claro caso haja pedido ainda sem pesagem final na câmara */}
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
          ATENÇÃO: {resumo.pedidos_sem_peso_real || 0} pedido(s) neste roteiro ainda não tiveram a separação finalizada (pesos exatos aparecerão após pesagem na câmara).
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
          <div className="wms-print-meta-label">Veículo / Rota / Transp.</div>
          <div className="wms-print-meta-value">
            {veiculoLabel || 'Transporte Próprio / A Definir'}
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
          <div className="wms-print-meta-label">Temperatura do Baú</div>
          <div className="wms-print-meta-value wms-print-mono">{tempTexto}</div>
        </div>
        <div>
          <div className="wms-print-meta-label">Paradas{nfsAuto.length > 0 ? ' / NFs Faturadas' : ''}</div>
          <div className="wms-print-meta-value">
            {paradas.length} entrega(s)
            {nfsAuto.length > 0 ? ` • NFs: ${nfsAuto.join(', ')}` : ''}
          </div>
        </div>
        <div>
          <div className="wms-print-meta-label">Volumes &amp; Pesos Consolidados</div>
          <div className="wms-print-meta-value">
            {resumo.total_caixas || 0} cx
            {mostrarBipadas ? ` (${resumo.caixas_carregadas || 0} bipadas)` : ''} •{' '}
            {pesoBruto > 0 ? `Bruto: ${fmtKg(pesoBruto)}` : `Ped: ${fmtKg(pesoPedido)}`}
          </div>
        </div>
      </div>

      {/* 1. Ordem das Entregas (Zero R$, com Caixas, Peso Pedido, Peso Bruto, Peso Real e Observações) */}
      <div className="wms-print-section-title">
        1. Sequência de Entregas no Roteiro ({paradas.length} {paradas.length === 1 ? 'parada' : 'paradas'})
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '5%', textAlign: 'center' }}>Seq.</th>
            <th style={{ width: '11%' }}>Pedido</th>
            <th style={{ width: '29%' }}>Cliente / Endereço de Entrega</th>
            <th style={{ width: '9%', textAlign: 'center' }}>
              {mostrarBipadas ? 'Caixas Bipadas' : 'Caixas'}
            </th>
            <th style={{ width: '11%', textAlign: 'right' }}>Peso Pedido</th>
            <th style={{ width: '11%', textAlign: 'right' }}>Peso Bruto</th>
            <th style={{ width: '11%', textAlign: 'right' }}>Peso Real</th>
            <th style={{ width: '13%' }}>Observações</th>
          </tr>
        </thead>
        <tbody>
          {paradas.map((p) => (
            <tr key={p.pedido_id}>
              <td style={{ textAlign: 'center', fontWeight: 900, fontSize: '12px' }}>#{p.ordem_parada}</td>
              <td className="wms-print-mono">
                <strong>{p.pedido_codigo}</strong>
                {p.romaneio_codigo && <div style={{ fontSize: '9px', color: '#475569' }}>{p.romaneio_codigo}</div>}
                {p.numero_nf && <div style={{ fontSize: '8.5px', color: '#0f172a', fontWeight: 700 }}>NF {p.numero_nf}</div>}
              </td>
              <td>
                <strong>{p.cliente}</strong>
                <div style={{ fontSize: '9.5px', color: '#475569' }}>{p.endereco_entrega}</div>
              </td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>
                {p.caixas_total > 0
                  ? mostrarBipadas
                    ? `${p.caixas_carregadas}/${p.caixas_total} cx`
                    : `${p.caixas_total} cx`
                  : <span style={{ color: '#b45309', fontSize: '9.5px' }}>A definir</span>}
              </td>
              <td style={{ textAlign: 'right' }}>{fmtKg(p.kg_pedido)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>
                {p.peso_bruto_kg > 0 ? fmtKg(p.peso_bruto_kg) : <span style={{ color: '#b45309', fontSize: '9.5px' }}>A definir</span>}
              </td>
              <td style={{ textAlign: 'right', fontWeight: 800 }}>
                {p.kg_real > 0 ? fmtKg(p.kg_real) : <span style={{ color: '#b45309', fontSize: '9.5px' }}>A definir</span>}
              </td>
              <td>
                {p.pagamento_na_entrega && (
                  <div
                    style={{
                      fontSize: '8px',
                      fontWeight: 800,
                      color: '#991b1b',
                      background: '#fee2e2',
                      padding: '2px 5px',
                      borderRadius: 3,
                      display: 'inline-block',
                    }}
                  >
                    COBRAR NA ENTREGA
                  </div>
                )}
                {p.pedido_observacoes?.trim() && (
                  <div style={{ fontSize: '8.5px', color: '#334155', marginTop: p.pagamento_na_entrega ? 2 : 0 }}>
                    {p.pedido_observacoes}
                  </div>
                )}
                {!p.pagamento_na_entrega && !p.pedido_observacoes?.trim() && <span style={{ color: '#64748b' }}>-</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ textAlign: 'right' }}>
              TOTAIS DO ROTEIRO:
            </td>
            <td style={{ textAlign: 'center' }}>
              {mostrarBipadas
                ? `${resumo.caixas_carregadas || 0}/${resumo.total_caixas || 0} cx`
                : `${resumo.total_caixas || 0} cx`}
            </td>
            <td style={{ textAlign: 'right' }}>{fmtKg(pesoPedido)}</td>
            <td style={{ textAlign: 'right' }}>{pesoBruto > 0 ? fmtKg(pesoBruto) : '-'}</td>
            <td style={{ textAlign: 'right' }}>{pesoReal > 0 ? fmtKg(pesoReal) : '-'}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* 2. Consolidado Geral de Cortes para Carregamento */}
      <div className="wms-print-section-title">
        2. Consolidado de Cortes da Carga ({produtosConsolidados.length} {produtosConsolidados.length === 1 ? 'produto' : 'produtos'})
      </div>
      <table className="wms-print-table">
        <thead>
          <tr>
            <th style={{ width: '10%' }}>Cód.</th>
            <th style={{ width: '40%' }}>Produto / Corte</th>
            <th style={{ width: '14%', textAlign: 'center' }}>
              {mostrarBipadas ? 'Caixas (Bipadas)' : 'Caixas'}
            </th>
            <th style={{ width: '12%', textAlign: 'right' }}>Kg Pedido</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Kg Bruto</th>
            <th style={{ width: '12%', textAlign: 'right' }}>Kg Real</th>
          </tr>
        </thead>
        <tbody>
          {produtosConsolidados.map((prod) => (
            <tr key={prod.produto_id}>
              <td className="wms-print-mono">{prod.codigo}</td>
              <td style={{ fontWeight: 700 }}>{prod.descricao}</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>
                {prod.caixas_total > 0
                  ? mostrarBipadas
                    ? `${prod.caixas_carregadas}/${prod.caixas_total} cx`
                    : `${prod.caixas_total} cx`
                  : <span style={{ color: '#b45309', fontSize: '9.5px' }}>A definir</span>}
              </td>
              <td style={{ textAlign: 'right' }}>{fmtKg(prod.kg_pedido)}</td>
              <td style={{ textAlign: 'right' }}>
                {prod.kg_bruto > 0 ? fmtKg(prod.kg_bruto) : <span style={{ color: '#b45309', fontSize: '9.5px' }}>A definir</span>}
              </td>
              <td style={{ textAlign: 'right', fontWeight: 800 }}>
                {prod.kg_real > 0 ? fmtKg(prod.kg_real) : <span style={{ color: '#b45309', fontSize: '9.5px' }}>A definir</span>}
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

      {/* Assinaturas no fim do carregamento (oculto apenas na Prévia Opção A) */}
      {!isPrevia && (
        <div className="wms-print-signatures" style={{ marginTop: '24px' }}>
          <div className="wms-print-sign-box">
            <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: '#0f172a' }}>
              Conferente / Operador Carregamento (WMS)
            </div>
            <div className="wms-print-sign-sub">
              Operador: {embarque.operador_carregamento_nome || '___________________________________'}
              <br />
              Temp. Baú na Doca: {tempTexto} • Carregamento:{' '}
              {embarque.iniciado_em ? fmtDataHora(embarque.iniciado_em) : '____/____/________ ____:____'}
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
              {nfsAuto.length > 0 && (
                <>
                  <br />
                  NFs Vinculadas: {nfsAuto.join(', ')}
                </>
              )}
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
          {embarque.codigo} •{' '}
          {modo === 'OPCAO_A_PREVIA'
            ? 'Prévia s/ Assinatura'
            : mostrarBipadas
              ? 'Via Pós-Bipagem (Pós-Conferência)'
              : 'Via Padrão (Antes da Bipagem)'}
        </span>
        <span>{paradas.length} entrega(s) • {resumo.total_caixas || 0} cx</span>
      </div>
    </PrintDocumentModal>
  )
}
