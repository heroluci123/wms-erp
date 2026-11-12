import React from 'react'
import { PrintDocumentModal, fmtKg, fmtQtdLivre, fmtData, fmtDataHora } from './PrintDocumentModal'

const STATUS_LABELS = {
  RASCUNHO: 'Rascunho',
  LIBERADO: 'Liberado para Separação',
  EM_SEPARACAO: 'Em Separação',
  AGUARDANDO_CONFERENCIA: 'Separação Finalizada',
  EM_CONFERENCIA: 'Em Conferência',
  EXPEDIDO: 'Expedido',
  CANCELADO: 'Cancelado'
}

const CLIENTE_PADRAO_FALLBACK = {
  codigo: '737',
  razao_social: 'BEEF CONTAINER LIMITADA',
  nome_fantasia: 'BEEF CONTAINER LIMITADA',
  cnpj_cpf: '54.142.043/0001-30',
  inscricao_estadual: '513236396113',
  endereco: 'DOUTOR HEITOR NASCIMENTO DE 3/4 A 598/599',
  numero: '581',
  complemento: '',
  bairro: 'MORUMBI',
  cep: '13140-729',
  cidade: 'PAULINIA',
  uf: 'SP',
  pais: 'BRASIL',
  telefone: '(19)99199-231',
  icms: 'CONTRIBUINTE'
}

export function FolhaPedidoPrint({ pedido, onClose, autoPrint = true }) {
  if (!pedido) return null

  const itens = pedido.itens || []
  const cli = pedido.cliente_dados || {
    ...CLIENTE_PADRAO_FALLBACK,
    razao_social: pedido.cliente || CLIENTE_PADRAO_FALLBACK.razao_social,
    nome_fantasia: pedido.cliente || CLIENTE_PADRAO_FALLBACK.nome_fantasia
  }

  const totalKgSolicitado = itens.reduce((s, it) => s + Number(it.qtd_kg_solicitada || 0), 0)
  const totalCxSolicitadas = itens.reduce((s, it) => s + Number(it.qtd_caixas_solicitada || 0), 0)

  const enderecoLinha = [
    cli.endereco,
    cli.numero ? `Nº ${cli.numero}` : '',
    cli.complemento || ''
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <PrintDocumentModal
      title={`Folha do Pedido — ${pedido.codigo}`}
      onClose={onClose}
      autoPrint={autoPrint}
      orientation="landscape"
    >
      {/* Cabeçalho Superior Horizontal */}
      <div className="wms-print-header" style={{ alignItems: 'center', borderBottomWidth: '2.5px', paddingBottom: '8px', marginBottom: '10px' }}>
        <div>
          <div className="wms-print-brand" style={{ fontSize: '18px', letterSpacing: '0.5px' }}>
            TRICARNES ALIMENTOS LTDA.
          </div>
          <div className="wms-print-brand-sub" style={{ fontSize: '10px' }}>
            WMSphere ERP — Ordem de Separação de Pedido em Câmara Fria
          </div>
        </div>

        <div
          style={{
            border: '2px solid #0f172a',
            borderRadius: '5px',
            padding: '6px 14px',
            textAlign: 'right',
            background: '#f8fafc'
          }}
        >
          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
            Ordem de Separação / Pedido
          </div>
          <div className="wms-print-mono" style={{ fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
            {pedido.codigo}
          </div>
          <div style={{ fontSize: '9.5px', color: '#334155', marginTop: '1px' }}>
            Emissão: {new Date().toLocaleString('pt-BR')} • Status: <strong>{STATUS_LABELS[pedido.status] || pedido.status}</strong>
          </div>
        </div>
      </div>

      {/* Faixa de Título do Pedido em destaque nítido */}
      <div
        style={{
          border: '1.5px solid #0f172a',
          borderLeft: '6px solid #0f172a',
          background: '#f1f5f9',
          color: '#0f172a',
          padding: '7px 12px',
          borderRadius: '4px',
          marginBottom: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px'
        }}
      >
        <div>
          <div style={{ fontSize: '8.5px', fontWeight: 800, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.5px' }}>
            Título do Pedido (Identificação da Carga)
          </div>
          <div style={{ fontSize: '15px', fontWeight: 900, color: '#0f172a' }}>{pedido.titulo}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: '8.5px', fontWeight: 800, textTransform: 'uppercase', color: '#475569' }}>
            Previsão de Coleta
          </div>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
            {fmtData(pedido.previsao_entrega)}
          </div>
        </div>
      </div>

      {/* Blocos Lado a Lado em Paisagem: Cliente (58%) + Dados Operacionais (42%) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.35fr 1fr',
          gap: '10px',
          marginBottom: '10px'
        }}
      >
        {/* Dados Completos do Cliente */}
        <div
          style={{
            border: '1px solid #94a3b8',
            borderRadius: '4px',
            padding: '8px 11px',
            background: '#ffffff'
          }}
        >
          <div
            style={{
              fontSize: '9px',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: '#0f172a',
              borderBottom: '1px solid #cbd5e1',
              paddingBottom: '4px',
              marginBottom: '6px',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <span>Dados do Cliente / Destinatário</span>
            <span className="wms-print-mono">Cód. {cli.codigo || '-'}</span>
          </div>

          <div style={{ fontSize: '12.5px', fontWeight: 900, color: '#0f172a', marginBottom: '4px' }}>
            {cli.razao_social}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px 10px', fontSize: '10px', color: '#1e293b' }}>
            <div>
              <strong>CNPJ/CPF:</strong> <span className="wms-print-mono">{cli.cnpj_cpf || '-'}</span>
            </div>
            <div>
              <strong>Inscr. Est.:</strong> <span className="wms-print-mono">{cli.inscricao_estadual || '-'}</span>
            </div>
            <div>
              <strong>ICMS:</strong> {cli.icms || 'CONTRIBUINTE'}
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <strong>Endereço:</strong> {enderecoLinha || '-'}
            </div>
            <div>
              <strong>Bairro:</strong> {cli.bairro || '-'}
            </div>
            <div>
              <strong>Cidade/UF:</strong> {[cli.cidade, cli.uf].filter(Boolean).join(' - ') || '-'}
            </div>
            <div>
              <strong>CEP:</strong> <span className="wms-print-mono">{cli.cep || '-'}</span> {cli.pais ? `• ${cli.pais}` : ''}
            </div>
            <div>
              <strong>Telefone:</strong> <span className="wms-print-mono">{cli.telefone || '-'}</span>
            </div>
          </div>
        </div>

        {/* Dados Operacionais do Pedido */}
        <div
          style={{
            border: '1px solid #94a3b8',
            borderRadius: '4px',
            padding: '8px 11px',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}
        >
          <div
            style={{
              fontSize: '9px',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: '#0f172a',
              borderBottom: '1px solid #cbd5e1',
              paddingBottom: '4px',
              marginBottom: '6px'
            }}
          >
            Informações de Separação &amp; Observações
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: '10px', color: '#1e293b' }}>
            <div>
              <strong>Local de Estoque:</strong> CÂMARA FRIA
            </div>
            <div>
              <strong>Modalidade:</strong> Coleta Própria
            </div>
            <div>
              <strong>Criado por:</strong> {pedido.criado_por_nome || '-'}
            </div>
            <div>
              <strong>Criado em:</strong> {fmtDataHora(pedido.created_at)}
            </div>
          </div>

          <div
            style={{
              marginTop: '6px',
              padding: '5px 8px',
              border: '1px solid #cbd5e1',
              borderRadius: '3px',
              background: '#ffffff',
              fontSize: '10px',
              minHeight: '28px',
              color: '#0f172a'
            }}
          >
            <strong>Observações:</strong>{' '}
            {pedido.observacoes?.trim() ? pedido.observacoes : 'Sem observações adicionais registradas.'}
          </div>
        </div>
      </div>

      {/* Tabela Horizontal de Produtos para Separação */}
      <div className="wms-print-section-title" style={{ marginTop: '6px', marginBottom: '5px' }}>
        Relação de Produtos para Separação ({itens.length} {itens.length === 1 ? 'item' : 'itens'})
      </div>

      <table className="wms-print-table" style={{ marginBottom: '8px' }}>
        <thead>
          <tr>
            <th style={{ width: '48px', textAlign: 'center' }}>Sep.</th>
            <th style={{ width: '36px', textAlign: 'center' }}>#</th>
            <th style={{ width: '92px' }}>Código</th>
            <th>Descrição do Produto / Corte</th>
            <th style={{ width: '115px', textAlign: 'right' }}>Quantidade</th>
            <th style={{ width: '68px', textAlign: 'center' }}>Unid.</th>
            <th style={{ width: '125px', textAlign: 'right' }}>Referência</th>
            <th style={{ width: '21%' }}>Observação do Item</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((it, idx) => {
            const unid = it.unidade_solicitada === 'CX' ? 'CX' : 'KG'
            const qtdExibida =
              it.qtd_solicitada_exibicao != null
                ? Number(it.qtd_solicitada_exibicao)
                : unid === 'CX' && it.qtd_caixas_solicitada
                  ? Number(it.qtd_caixas_solicitada)
                  : Number(it.qtd_kg_solicitada || 0)

            const referenciaTexto =
              unid === 'CX'
                ? `≈ ${fmtKg(it.qtd_kg_solicitada)}`
                : it.qtd_caixas_solicitada
                  ? `≈ ${fmtQtdLivre(it.qtd_caixas_solicitada)} cx`
                  : '-'

            return (
              <tr key={it.id || idx}>
                <td style={{ textAlign: 'center', padding: '7px 6px' }}>
                  <div
                    aria-label="Caixa de conferência manual"
                    style={{
                      width: '18px',
                      height: '18px',
                      border: '1.8px solid #0f172a',
                      borderRadius: '3px',
                      margin: '0 auto',
                      background: '#ffffff'
                    }}
                  />
                </td>
                <td style={{ textAlign: 'center', color: '#475569', fontWeight: 700 }}>{idx + 1}</td>
                <td className="wms-print-mono" style={{ fontSize: '12px', fontWeight: 800 }}>
                  {it.produto_codigo || '-'}
                </td>
                <td style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                  {it.produto_descricao}
                </td>
                <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '13px', fontWeight: 900 }}>
                  {fmtQtdLivre(qtdExibida)}
                </td>
                <td style={{ textAlign: 'center', fontSize: '11.5px', fontWeight: 800 }}>
                  {unid}
                </td>
                <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '10.5px', color: '#334155' }}>
                  {referenciaTexto}
                </td>
                <td style={{ fontSize: '10.5px', color: '#334155' }}>
                  {it.observacao || '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ textAlign: 'right', fontSize: '11px' }}>
              TOTAIS DO PEDIDO ({itens.length} {itens.length === 1 ? 'produto' : 'produtos'}):
            </td>
            <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '12.5px' }}>
              {fmtQtdLivre(totalKgSolicitado)}
            </td>
            <td style={{ textAlign: 'center', fontSize: '11px' }}>KG</td>
            <td className="wms-print-mono" style={{ textAlign: 'right', fontSize: '11px' }}>
              {totalCxSolicitadas > 0 ? `${fmtQtdLivre(totalCxSolicitadas)} cx prev.` : '-'}
            </td>
            <td style={{ fontSize: '10px', fontWeight: 600, color: '#334155' }}>
              Regra FEFO (vencimento mais próximo primeiro)
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Linha de Conferência do Separador em Câmara */}
      <div
        style={{
          marginTop: '10px',
          border: '1px solid #94a3b8',
          borderRadius: '4px',
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          fontSize: '10.5px',
          color: '#0f172a',
          background: '#f8fafc',
          pageBreakInside: 'avoid'
        }}
      >
        <div>
          <strong>Separado em Câmara por:</strong> ___________________________________________
        </div>
        <div>
          <strong>Início:</strong> ____:____ &nbsp;&nbsp; <strong>Término:</strong> ____:____
        </div>
        <div>
          <strong>Data:</strong> ____/____/________
        </div>
      </div>

      <div className="wms-print-footer" style={{ marginTop: '10px' }}>
        <span>TRICARNES ALIMENTOS LTDA. — WMSphere ERP</span>
        <span>Pedido {pedido.codigo} • {cli.razao_social}</span>
        <span>Formato Paisagem • Conferência de Separação</span>
      </div>
    </PrintDocumentModal>
  )
}
