import React, { useMemo } from 'react'
import { PrintDocumentModal, fmtKg, fmtQtdLivre, fmtData, fmtDataHora } from './PrintDocumentModal'

const STATUS_LABELS = {
  RASCUNHO: 'Rascunho',
  LIBERADA: 'Liberada para Produção',
  ABERTA: 'Em Produção',
  FECHADA: 'Finalizada',
}

function agruparRealizadoPorProduto(registros = []) {
  const map = new Map()
  for (const r of registros) {
    const pid = Number(r.produto_id)
    const atual = map.get(pid) || { kg: 0, cx: 0 }
    atual.kg += Number(r.peso_kg || 0)
    atual.cx += 1
    map.set(pid, atual)
  }
  return map
}

function formatarPrevistoItem(it) {
  const peso = Number(it.peso_kg_previsto || 0)
  const cxs = Number(it.qtd_caixas_prevista || 0)
  if (peso > 0 && cxs > 0) {
    return { principal: fmtKg(peso), sub: `${fmtQtdLivre(cxs)} cx prev.` }
  }
  if (peso > 0) {
    return { principal: fmtKg(peso), sub: '' }
  }
  if (cxs > 0) {
    return { principal: `${fmtQtdLivre(cxs)} cx`, sub: 'peso na balança' }
  }
  return { principal: 'Livre / Balança', sub: '' }
}

function TabelaItensOP({
  titulo,
  corBorda,
  corHeaderBg,
  corTextoHeader,
  corTotalBg,
  itens = [],
  realizadosMap,
  msgVazio,
  labelColunaRealizado,
}) {
  const totalKgPrev = itens.reduce((s, it) => s + Number(it.peso_kg_previsto || 0), 0)
  const totalCxPrev = itens.reduce((s, it) => s + Number(it.qtd_caixas_prevista || 0), 0)
  const totalKgReal = itens.reduce((s, it) => s + (realizadosMap.get(Number(it.produto_id))?.kg || 0), 0)
  const totalCxReal = itens.reduce((s, it) => s + (realizadosMap.get(Number(it.produto_id))?.cx || 0), 0)

  return (
    <div style={{ marginBottom: '10px', breakInside: 'avoid' }}>
      <div
        style={{
          fontSize: '10px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.45px',
          color: corTextoHeader,
          background: corHeaderBg,
          padding: '5px 10px',
          borderLeft: `5px solid ${corBorda}`,
          border: `1px solid ${corBorda}`,
          borderLeftWidth: '5px',
          borderRadius: '4px 4px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{titulo}</span>
        <span style={{ fontSize: '9.5px', fontWeight: 800 }}>
          {itens.length} {itens.length === 1 ? 'produto' : 'produtos'}
        </span>
      </div>

      {itens.length === 0 ? (
        <div
          style={{
            border: `1px solid ${corBorda}`,
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            padding: '8px 12px',
            fontSize: '10px',
            color: '#475569',
            background: '#ffffff',
            fontStyle: 'italic',
          }}
        >
          {msgVazio}
        </div>
      ) : (
        <table className="wms-print-table" style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '44px', textAlign: 'center', background: corTotalBg, color: corTextoHeader }}>Conf.</th>
              <th style={{ width: '34px', textAlign: 'center', background: corTotalBg, color: corTextoHeader }}>#</th>
              <th style={{ width: '88px', background: corTotalBg, color: corTextoHeader }}>Código</th>
              <th style={{ background: corTotalBg, color: corTextoHeader }}>Descrição do Produto / Corte</th>
              <th style={{ width: '155px', textAlign: 'right', background: corTotalBg, color: corTextoHeader }}>Quantidade Prevista</th>
              <th style={{ width: '145px', textAlign: 'right', background: corTotalBg, color: corTextoHeader }}>{labelColunaRealizado}</th>
              <th style={{ width: '20%', background: corTotalBg, color: corTextoHeader }}>Observação do Item</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it, idx) => {
              const prev = formatarPrevistoItem(it)
              const real = realizadosMap.get(Number(it.produto_id)) || { kg: 0, cx: 0 }
              return (
                <tr key={it.id || `${it.produto_id}-${idx}`}>
                  <td style={{ textAlign: 'center', padding: '6px' }}>
                    <div
                      aria-label="Caixa de conferência manual"
                      style={{
                        width: '17px',
                        height: '17px',
                        border: '1.8px solid #0f172a',
                        borderRadius: '3px',
                        margin: '0 auto',
                        background: '#ffffff',
                      }}
                    />
                  </td>
                  <td style={{ textAlign: 'center', color: '#475569', fontWeight: 700 }}>{idx + 1}</td>
                  <td className="wms-print-mono" style={{ fontSize: '11.5px', fontWeight: 800 }}>
                    {it.produto_codigo || '-'}
                  </td>
                  <td style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                    {it.produto_descricao}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="wms-print-mono" style={{ fontSize: '12px', fontWeight: 900, color: '#0f172a' }}>
                      {prev.principal}
                    </div>
                    {prev.sub && (
                      <div className="wms-print-mono" style={{ fontSize: '9.5px', color: '#475569' }}>
                        ({prev.sub})
                      </div>
                    )}
                  </td>
                  <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '10.5px', color: real.cx > 0 ? '#0f172a' : '#64748b' }}>
                    {real.cx > 0 ? (
                      <>
                        <strong>{fmtKg(real.kg)}</strong> ({real.cx} cx)
                      </>
                    ) : (
                      '0 cx / 0,00 kg'
                    )}
                  </td>
                  <td style={{ fontSize: '10px', color: '#334155' }}>
                    {it.observacao?.trim() ? it.observacao : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ textAlign: 'right', fontSize: '10.5px', background: corTotalBg, color: corTextoHeader }}>
                TOTAL ({itens.length} {itens.length === 1 ? 'item' : 'itens'}):
              </td>
              <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '11px', background: corTotalBg, color: corTextoHeader }}>
                {totalKgPrev > 0 ? fmtKg(totalKgPrev) : '-'}
                {totalCxPrev > 0 ? ` • ${fmtQtdLivre(totalCxPrev)} cx` : ''}
              </td>
              <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '10.5px', background: corTotalBg, color: corTextoHeader }}>
                {totalCxReal > 0 ? `${fmtKg(totalKgReal)} (${totalCxReal} cx)` : '0 cx / 0,00 kg'}
              </td>
              <td style={{ background: corTotalBg }} />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

export function FolhaOrdemProducaoPrint({ op, onClose, autoPrint = true }) {
  const entradas = op?.previstos_entrada || []
  const saidas = op?.previstos_saida || []

  const realizadosEntradaMap = useMemo(() => agruparRealizadoPorProduto(op?.insumos || []), [op?.insumos])
  const realizadosSaidaMap = useMemo(() => agruparRealizadoPorProduto(op?.retornos || []), [op?.retornos])

  if (!op) return null

  const temObs = Boolean(op.observacoes && String(op.observacoes).trim())

  return (
    <PrintDocumentModal
      title={`Folha da Ordem de Produção — ${op.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
      orientation="landscape"
    >
      {/* Cabeçalho Executivo Paisagem */}
      <div
        className="wms-print-header"
        style={{
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
          color: '#ffffff',
          padding: '9px 14px',
          borderRadius: '6px',
          borderBottom: '3.5px solid #0ea5e9',
          marginBottom: '10px',
        }}
      >
        <div>
          <div style={{ fontSize: '17px', fontWeight: 900, letterSpacing: '0.4px', color: '#ffffff' }}>
            TRICARNES ALIMENTOS LTDA.
          </div>
          <div style={{ fontSize: '10px', color: '#bae6fd', marginTop: '2px' }}>
            WMSphere ERP — Folha da Ordem de Produção (Programação de Entrada &amp; Saída)
          </div>
        </div>

        <div
          style={{
            border: '1.5px solid rgba(255,255,255,0.4)',
            borderRadius: '5px',
            padding: '5px 13px',
            textAlign: 'right',
            background: 'rgba(15, 23, 42, 0.55)',
          }}
        >
          <div style={{ fontSize: '8.5px', fontWeight: 700, textTransform: 'uppercase', color: '#93c5fd' }}>
            Ordem de Produção
          </div>
          <div className="wms-print-mono" style={{ fontSize: '17px', fontWeight: 900, color: '#ffffff' }}>
            {op.codigo}
          </div>
          <div style={{ fontSize: '9px', color: '#e2e8f0', marginTop: '1px' }}>
            Emissão: {new Date().toLocaleString('pt-BR')} • Status: <strong>{STATUS_LABELS[op.status] || op.status}</strong>
          </div>
        </div>
      </div>

      {/* Identificação da OP */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr',
          gap: '10px',
          marginBottom: '10px',
        }}
      >
        <div
          style={{
            border: '1.5px solid #1e3a8a',
            borderLeft: '6px solid #1e3a8a',
            background: '#eff6ff',
            padding: '7px 12px',
            borderRadius: '4px',
          }}
        >
          <div style={{ fontSize: '8.5px', fontWeight: 800, textTransform: 'uppercase', color: '#1e3a8a', letterSpacing: '0.5px' }}>
            Título / Descrição da Ordem de Produção
          </div>
          <div style={{ fontSize: '15px', fontWeight: 900, color: '#0f172a', marginTop: '2px' }}>
            {op.nome}
          </div>
        </div>

        <div
          style={{
            border: '1px solid #94a3b8',
            background: '#f8fafc',
            padding: '7px 12px',
            borderRadius: '4px',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '6px 10px',
            fontSize: '10px',
            color: '#0f172a',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '8px', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Data de Produção</div>
            <strong style={{ fontSize: '12px' }}>{fmtData(op.data_producao)}</strong>
          </div>
          <div>
            <div style={{ fontSize: '8px', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Criada Por</div>
            <strong>{op.criado_por_nome || op.operador_nome || '-'}</strong>
          </div>
          <div>
            <div style={{ fontSize: '8px', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Criada Em</div>
            <strong>{fmtDataHora(op.created_at)}</strong>
          </div>
        </div>
      </div>

      {/* Observações / Instruções para a Produção */}
      <div
        style={{
          border: temObs ? '1.5px solid #d97706' : '1px solid #cbd5e1',
          borderLeft: temObs ? '6px solid #d97706' : '4px solid #64748b',
          background: temObs ? '#fffbeb' : '#f8fafc',
          borderRadius: '4px',
          padding: '8px 12px',
          marginBottom: '10px',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            fontSize: '9px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.45px',
            color: temObs ? '#92400e' : '#475569',
            marginBottom: '3px',
          }}
        >
          Observações / Instruções da Ordem de Produção
        </div>
        <div style={{ fontSize: '11.5px', fontWeight: temObs ? 700 : 400, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
          {temObs ? op.observacoes : 'Sem observações adicionais registradas nesta OP.'}
        </div>
      </div>

      {/* 1. Itens Previstos de ENTRADA (Matéria-Prima) */}
      <TabelaItensOP
        titulo="1. Itens Previstos de ENTRADA (Matéria-Prima para Desossa / Produção)"
        corBorda="#d97706"
        corHeaderBg="#fef3c7"
        corTextoHeader="#92400e"
        corTotalBg="#fffbeb"
        itens={entradas}
        realizadosMap={realizadosEntradaMap}
        labelColunaRealizado="Alocado / Entrada"
        msgVazio="Nenhum item de entrada previsto cadastrado nesta OP."
      />

      {/* 2. Itens Previstos de SAÍDA (Produtos Produzidos) */}
      <TabelaItensOP
        titulo="2. Itens Previstos de SAÍDA (Cortes / Produtos Produzidos)"
        corBorda="#059669"
        corHeaderBg="#d1fae5"
        corTextoHeader="#065f46"
        corTotalBg="#ecfdf5"
        itens={saidas}
        realizadosMap={realizadosSaidaMap}
        labelColunaRealizado="Produzido / Retorno"
        msgVazio="Nenhum item de saída previsto cadastrado nesta OP."
      />

      {/* Linha de Execução e Assinatura em Chão de Fábrica */}
      <div
        style={{
          marginTop: '10px',
          border: '1px solid #94a3b8',
          borderRadius: '4px',
          padding: '9px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          fontSize: '10.5px',
          color: '#0f172a',
          background: '#f8fafc',
          pageBreakInside: 'avoid',
        }}
      >
        <div>
          <strong>Responsável Produção:</strong> ____________________________________
        </div>
        <div>
          <strong>Conferência / Qualidade:</strong> ____________________________________
        </div>
        <div>
          <strong>Início:</strong> ____:____ &nbsp; <strong>Término:</strong> ____:____ &nbsp; <strong>Data:</strong> ____/____/______
        </div>
      </div>

      <div className="wms-print-footer" style={{ marginTop: '8px' }}>
        <span>TRICARNES ALIMENTOS LTDA. — WMSphere ERP</span>
        <span>Ordem de Produção {op.codigo} — {op.nome}</span>
        <span>Formato Paisagem • Folha de Produção</span>
      </div>
    </PrintDocumentModal>
  )
}
