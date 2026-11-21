import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Package,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Store,
  Trash2,
  XCircle,
} from 'lucide-react'
import { acougueQueries } from '../queries/varejo'
import { useAppStore } from '../store/appStore'
import { ModalEtiquetaZebra80x45 } from '../components/shared/EtiquetaZebra80x45'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtKg = (v) => `${Number(v || 0).toFixed(3).replace('.', ',')} kg`

export function GerenciadorAcougue() {
  const { toastSuccess, toastError } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState('ETIQUETAS') // 'ETIQUETAS' | 'MP_ABERTAS' | 'MP_TRANSITO' | 'MP_ENCERRADAS'
  const [busca, setBusca] = useState('')
  const [especie, setEspecie] = useState('TODOS')
  const [conservacao, setConservacao] = useState('TODOS')
  const [statusEtq, setStatusEtq] = useState('EM_ESTOQUE')

  const [dados, setDados] = useState({
    resumo: {},
    mps_transito: [],
    mps_abertas: [],
    mps_encerradas: [],
    etiquetas: [],
  })
  const [etiquetaPreview, setEtiquetaPreview] = useState(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await acougueQueries.obterGerenciador({
        busca: busca.trim() || undefined,
        especie: especie !== 'TODOS' ? especie : undefined,
        conservacao: conservacao !== 'TODOS' ? conservacao : undefined,
        status_etiqueta: statusEtq !== 'TODOS' ? statusEtq : undefined,
      })
      setDados({
        resumo: res.kpis || res.resumo || {},
        mps_transito: res.mps_transito || [],
        mps_abertas: res.mps_abertas || [],
        mps_encerradas: res.mps_encerradas || [],
        etiquetas: res.etiquetas || [],
      })
    } catch (err) {
      toastError('Erro ao carregar Gerenciador do Açougue', err.message)
    } finally {
      setLoading(false)
    }
  }, [busca, especie, conservacao, statusEtq, toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const handleEncerrarMp = async (mp) => {
    try {
      const res = await acougueQueries.encerrarMp(mp.id, 'Encerramento no Gerenciador do Açougue')
      toastSuccess(
        'MP encerrada e quebra apurada!',
        `Quebra/Apara: ${fmtKg(res.data.quebra_kg)} • Rendimento: ${Number(res.data.rendimento_pct || 0).toFixed(1)}%`,
      )
      await carregar()
    } catch (err) {
      toastError('Erro ao encerrar MP', err.message)
    }
  }

  const handleCancelarEtiqueta = async (etq) => {
    try {
      await acougueQueries.cancelarEtiqueta(etq.id)
      toastSuccess(`Etiqueta ${etq.codigo_etiqueta} cancelada`, 'Peso devolvido à MP de origem.')
      await carregar()
    } catch (err) {
      toastError('Erro ao cancelar etiqueta', err.message)
    }
  }

  const exportarCsv = () => {
    let header = ''
    let rows = []
    if (aba === 'ETIQUETAS') {
      header = 'ETIQUETA;CODIGO;PRODUTO;ESPECIE;CONSERVACAO;PESO_LIQ_KG;PRECO_KG;VALOR_TOTAL;LOTE;VALIDADE;MP_ORIGEM;STATUS\n'
      rows = dados.etiquetas.map((e) =>
        [
          e.codigo_etiqueta,
          e.produto_codigo,
          e.produto_descricao,
          e.especie,
          e.conservacao,
          Number(e.peso_liquido_kg || 0).toFixed(3),
          Number(e.preco_kg || 0).toFixed(2),
          Number(e.valor_total || 0).toFixed(2),
          e.lote || '',
          e.validade || '',
          e.ean_mp_origem || '',
          e.status,
        ].join(';'),
      )
    } else {
      const lista =
        aba === 'MP_ABERTAS'
          ? dados.mps_abertas
          : aba === 'MP_TRANSITO'
            ? dados.mps_transito
            : dados.mps_encerradas
      header = 'EAN_CAIXA;CODIGO;PRODUTO;ESPECIE;LOTE;STATUS;PESO_ORIGINAL_KG;PESO_PESADO_KG;RESTANTE_KG;QUEBRA_KG;RENDIMENTO_PCT\n'
      rows = lista.map((m) =>
        [
          m.ean_caixa,
          m.produto_codigo,
          m.produto_descricao,
          m.especie,
          m.lote || '',
          m.status,
          Number(m.peso_kg || 0).toFixed(3),
          Number(m.peso_pesado_kg || 0).toFixed(3),
          Number(m.peso_restante_kg || 0).toFixed(3),
          Number(m.quebra_acougue_kg || 0).toFixed(3),
          Number(m.rendimento_pct || 0).toFixed(1),
        ].join(';'),
      )
    }
    const blob = new Blob(['\uFEFF' + header + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gerenciador_acougue_${aba.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    toastSuccess('Relatório exportado!', 'Arquivo CSV baixado com sucesso.')
  }

  const r = dados.resumo || {}

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Store size={20} className="text-primary" /> Gerenciador do Açougue
          </h1>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            Estoque em tempo real de Matérias-Primas vivas (transferidas e abertas) e Etiquetas QR 80×45 pesadas
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn--secondary btn--sm" onClick={exportarCsv}>
            <Download size={14} /> Exportar Relatório CSV
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">MPs Aguardando 2º Bip</div>
          <div className="font-mono font-bold text-warning" style={{ fontSize: 20, marginTop: 2 }}>
            {r.qtd_mp_transito || 0} cx • {fmtKg(r.kg_mp_transito || 0)}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">MPs Abertas (Saldo Vivo)</div>
          <div className="font-mono font-bold text-info" style={{ fontSize: 20, marginTop: 2 }}>
            {r.qtd_mp_aberta || 0} cx • {fmtKg(r.kg_mp_aberta || 0)}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Etiquetas QR em Estoque</div>
          <div className="font-mono font-bold text-success" style={{ fontSize: 20, marginTop: 2 }}>
            {r.qtd_etiquetas_estoque || 0} un • {fmtKg(r.kg_etiquetas_estoque || 0)}
          </div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="text-xs text-muted uppercase">Valor Etiquetado em Estoque</div>
          <div className="font-mono font-bold" style={{ fontSize: 20, color: '#22c55e', marginTop: 2 }}>
            {fmtMoeda(r.valor_etiquetas_estoque || 0)}
          </div>
        </div>
      </div>

      {/* BARRA DE ABAS + FILTROS */}
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { id: 'ETIQUETAS', label: `Etiquetas Pesadas (${dados.etiquetas.length})` },
              { id: 'MP_ABERTAS', label: `MPs Abertas (${dados.mps_abertas.length})` },
              { id: 'MP_TRANSITO', label: `MPs em Trânsito (${dados.mps_transito.length})` },
              { id: 'MP_ENCERRADAS', label: `MPs Encerradas (${dados.mps_encerradas.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn btn--sm ${aba === t.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setAba(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: 32, height: 34, width: 220, fontSize: 12 }}
                placeholder="Buscar produto, ETQ, EAN, lote..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <select className="form-input" style={{ height: 34, width: 130, fontSize: 12 }} value={especie} onChange={(e) => setEspecie(e.target.value)}>
              <option value="TODOS">Todas Espécies</option>
              <option value="BOVINO">Bovinos</option>
              <option value="SUINO">Suínos</option>
              <option value="AVES">Aves</option>
              <option value="EMPORIO">Empório</option>
              <option value="OUTROS">Outros</option>
            </select>
            <select className="form-input" style={{ height: 34, width: 135, fontSize: 12 }} value={conservacao} onChange={(e) => setConservacao(e.target.value)}>
              <option value="TODOS">Conservação</option>
              <option value="RESFRIADO">Resfriado</option>
              <option value="CONGELADO">Congelado</option>
              <option value="SECO">Seco</option>
            </select>
            {aba === 'ETIQUETAS' && (
              <select className="form-input" style={{ height: 34, width: 145, fontSize: 12 }} value={statusEtq} onChange={(e) => setStatusEtq(e.target.value)}>
                <option value="EM_ESTOQUE">Em Estoque</option>
                <option value="VENDIDA">Vendidas</option>
                <option value="CANCELADA">Canceladas</option>
                <option value="PERDA_INVENTARIO">Perda Inventário</option>
                <option value="TODOS">Todos Status</option>
              </select>
            )}
          </div>
        </div>

        {/* TABELA CONTEXTUAL */}
        {loading ? (
          <div className="text-center text-muted p-24">Carregando estoque em tempo real...</div>
        ) : aba === 'ETIQUETAS' ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Serial QR</th>
                  <th>Produto</th>
                  <th>Espécie / Cons.</th>
                  <th style={{ textAlign: 'right' }}>Peso Líq.</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th>Validade / Lote</th>
                  <th>MP Origem</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {dados.etiquetas.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted p-24">
                      Nenhuma etiqueta encontrada para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  dados.etiquetas.map((e) => (
                    <tr key={e.id}>
                      <td className="font-mono font-bold text-info">{e.codigo_etiqueta}</td>
                      <td>
                        <div className="font-bold text-sm">{e.produto_descricao}</div>
                        <div className="text-xs text-muted font-mono">Cód {e.produto_codigo || '-'}</div>
                      </td>
                      <td>
                        <span className="badge badge--neutral" style={{ fontSize: 10 }}>{e.especie}</span>{' '}
                        <span className="text-xs text-muted">{e.conservacao}</span>
                      </td>
                      <td className="font-mono font-bold" style={{ textAlign: 'right' }}>{fmtKg(e.peso_liquido_kg)}</td>
                      <td className="font-mono font-bold text-success" style={{ textAlign: 'right' }}>{fmtMoeda(e.valor_total)}</td>
                      <td className="font-mono text-xs">
                        {e.validade || '-'} {e.lote ? `• ${e.lote}` : ''}
                      </td>
                      <td className="font-mono text-xs text-muted">{e.ean_mp_origem || '-'}</td>
                      <td>
                        <span
                          className={`badge ${
                            e.status === 'EM_ESTOQUE'
                              ? 'badge--success'
                              : e.status === 'VENDIDA'
                                ? 'badge--info'
                                : 'badge--danger'
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          title="Reimprimir Etiqueta 80×45"
                          onClick={() =>
                            setEtiquetaPreview({
                              codigo_etiqueta: e.codigo_etiqueta,
                              codigo: e.produto_codigo,
                              descricao: e.produto_descricao,
                              conservacao: e.conservacao,
                              unidade: 'KG',
                              peso_kg: e.peso_liquido_kg,
                              preco_unitario: e.preco_kg,
                              valor_total: e.valor_total,
                              lote: e.lote,
                              validade: e.validade,
                              payload_qr: e.payload_qr,
                            })
                          }
                        >
                          <Printer size={13} />
                        </button>
                        {e.status === 'EM_ESTOQUE' && (
                          <button
                            type="button"
                            className="btn-icon text-danger"
                            title="Cancelar etiqueta e estornar MP"
                            onClick={() => handleCancelarEtiqueta(e)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Etiqueta MP (EAN)</th>
                  <th>Produto</th>
                  <th>Espécie</th>
                  <th>Lote / Validade</th>
                  <th style={{ textAlign: 'right' }}>Peso Orig.</th>
                  <th style={{ textAlign: 'right' }}>Pesado ({aba === 'MP_TRANSITO' ? '-' : 'Etqs'})</th>
                  <th style={{ textAlign: 'right' }}>Restante</th>
                  <th style={{ textAlign: 'right' }}>Quebra / Rend.</th>
                  {aba === 'MP_ABERTAS' && <th style={{ textAlign: 'right' }}>Ação</th>}
                </tr>
              </thead>
              <tbody>
                {(aba === 'MP_ABERTAS'
                  ? dados.mps_abertas
                  : aba === 'MP_TRANSITO'
                    ? dados.mps_transito
                    : dados.mps_encerradas
                ).length === 0 ? (
                  <tr>
                    <td colSpan={aba === 'MP_ABERTAS' ? 9 : 8} className="text-center text-muted p-24">
                      Nenhuma matéria-prima nesta listagem.
                    </td>
                  </tr>
                ) : (
                  (aba === 'MP_ABERTAS'
                    ? dados.mps_abertas
                    : aba === 'MP_TRANSITO'
                      ? dados.mps_transito
                      : dados.mps_encerradas
                  ).map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono font-bold text-info">{m.ean_caixa}</td>
                      <td>
                        <div className="font-bold text-sm">{m.produto_descricao}</div>
                        <div className="text-xs text-muted font-mono">Cód {m.produto_codigo || '-'} • End: {m.endereco}</div>
                      </td>
                      <td><span className="badge badge--neutral">{m.especie}</span></td>
                      <td className="font-mono text-xs">{m.lote || '-'} • {m.validade || '-'}</td>
                      <td className="font-mono" style={{ textAlign: 'right' }}>{fmtKg(m.peso_kg)}</td>
                      <td className="font-mono" style={{ textAlign: 'right' }}>
                        {fmtKg(m.peso_pesado_kg)} <span className="text-xs text-muted">({m.qtd_etqs || 0})</span>
                      </td>
                      <td className="font-mono font-bold text-success" style={{ textAlign: 'right' }}>
                        {fmtKg(m.peso_restante_kg)}
                      </td>
                      <td className="font-mono text-xs" style={{ textAlign: 'right' }}>
                        {aba === 'MP_ENCERRADAS'
                          ? `${fmtKg(m.quebra_acougue_kg)} (${Number(m.rendimento_pct || 0).toFixed(1)}%)`
                          : `${Number(m.rendimento_pct || 0).toFixed(1)}%`}
                      </td>
                      {aba === 'MP_ABERTAS' && (
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn--warning btn--sm"
                            onClick={() => handleEncerrarMp(m)}
                          >
                            <CheckCircle2 size={13} /> Encerrar MP / Apurar Quebra
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ModalEtiquetaZebra80x45
        aberto={Boolean(etiquetaPreview)}
        onClose={() => setEtiquetaPreview(null)}
        dados={etiquetaPreview}
        modo="PDV"
        toastSuccess={toastSuccess}
      />
    </div>
  )
}
