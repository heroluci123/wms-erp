import React, { useState, useEffect, useCallback } from 'react'
import { FileDown, Search, RefreshCw, Layers } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as estoqueQueries from '../queries/estoque.js'
import { format, differenceInDays } from 'date-fns'
import { CurvaBadge, EnderecoBadge } from '../components/shared/Badge'

function downloadCSV(content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `estoque_enderecos_${Date.now()}.csv` })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function EstoqueEnderecos() {
  const { operador } = useAppStore()
  const isExecutivo = !!(operador?.permissoes?.dashboard_executivo)

  const [estoque, setEstoque] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Filtros
  const [incluirInsumos, setIncluirInsumos] = useState(false)
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const [filtroCodigo,    setFiltroCodigo]    = useState('')
  const [filtroEndereco,  setFiltroEndereco]  = useState('')
  const [filtroVencimento,setFiltroVencimento]= useState('todos') // 'todos', 'vencidos_proximos'

  const carregarDados = useCallback(async () => {
    setLoading(true)
    try {
      const estoqueData = await estoqueQueries.listarGeral()
      setEstoque(incluirInsumos
        ? estoqueData.filter(i => i.tipo_produto === 'Insumos')
        : estoqueData.filter(i => i.tipo_produto !== 'Insumos')
      )
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [incluirInsumos])

  useEffect(() => { carregarDados() }, [carregarDados])

  // Filtros da tabela
  let estoqueFiltrado = estoque.filter(item => {
    if (filtroVencimento === 'vencidos_proximos') {
      if (!item.validade) return false
      const dataStr = item.validade.toString().substring(0, 10) + 'T12:00:00'
      const dias = differenceInDays(new Date(dataStr), new Date())
      if (dias > 30) return false
    }
    return (item.descricao || '').toLowerCase().includes(filtroDescricao.toLowerCase()) &&
           (item.codigo || '').toLowerCase().includes(filtroCodigo.toLowerCase()) &&
           (item.endereco || '').toLowerCase().includes(filtroEndereco.toLowerCase())
  })

  if (filtroVencimento === 'vencidos_proximos') {
    estoqueFiltrado = estoqueFiltrado.sort((a, b) => new Date(a.validade) - new Date(b.validade))
  }

  const exportarCSV = async () => {
    if (estoqueFiltrado.length === 0) return
    const header = "ENDERECO;PRODUTO_ID;CODIGO;DESCRICAO;GRUPO;LOTE;VALIDADE;CAIXAS;KG;CURVA;VALOR_UNIT\n"
    const rows = estoqueFiltrado.map(i =>
      `${i.endereco};${i.produto_id};${i.codigo};${i.descricao};${i.grupo || ''};${i.lote || ''};${i.validade || ''};${String(i.qtd_caixas).replace('.', ',')};${String(i.qtd_kg).replace('.', ',')};${i.status_curva};${String(i.valor_unitario || 0).replace('.', ',')}`
    ).join("\n")
    await downloadCSV(header + rows)
  }

  const renderValidade = (data) => {
    if (!data) return <span className="td-muted">-</span>
    const dataStr = data.toString().substring(0, 10) + 'T12:00:00'
    const dataObj = new Date(dataStr)
    const dias = differenceInDays(dataObj, new Date())
    if (dias < 0) return <span className="validade--critico">{format(dataObj, 'dd/MM/yyyy')} (Vencido)</span>
    if (dias <= 30) return <span className="validade--alerta">{format(dataObj, 'dd/MM/yyyy')} ({dias} dias)</span>
    return <span className="validade--ok">{format(dataObj, 'dd/MM/yyyy')}</span>
  }

  // Totais baseados no filtro atual
  const totalCx = estoqueFiltrado.reduce((acc, i) => acc + (parseFloat(i.qtd_caixas) || 0), 0)
  const totalKg = estoqueFiltrado.reduce((acc, i) => acc + (parseFloat(i.qtd_kg) || 0), 0)
  const totalVal = estoqueFiltrado.reduce((acc, i) => acc + (parseFloat(i.qtd_kg) * (parseFloat(i.valor_unitario) || 0)), 0)
  const totalItens = estoqueFiltrado.length

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Layers size={26} /> Estoque por Endereço
          </h1>
          <p className="page-header__subtitle">
            Consulta de saldos detalhados por posição
          </p>
        </div>
        <div className="flex gap-12 items-center">
          <button className="btn btn--secondary" onClick={exportarCSV}><FileDown size={16} /> Exportar CSV</button>
          <button className="btn btn--primary" onClick={carregarDados}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar</button>
        </div>
      </div>

      {/* ── CSS Local para Tabela Densa ──────────────────────────────────────── */}
      <style>{`
        .table-densa th, .table-densa td {
          padding: 8px 8px !important;
          font-size: 11.5px !important;
          white-space: nowrap;
        }
        .table-densa th {
          font-size: 10px !important;
        }
        .td-desc {
          white-space: normal !important;
          min-width: 150px;
          max-width: 250px;
        }
      `}</style>

      {/* ── Body: Layout responsivo (Tabela esq, Totais dir) ──────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        
        {/* Lado Esquerdo: Tabela */}
        <div className="card card--elevated p-0" style={{ flex: '1 1 700px', minWidth: 0, border: '1px solid var(--border)' }}>
          {/* Barra de Filtros */}
          <div className="p-16 border-b border-border bg-bg-2 flex items-center gap-12 flex-wrap">
            <div className="flex items-center gap-8 text-primary font-bold mr-auto">
              <Search size={18} /> Filtros
            </div>
            
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', flex: 1, minWidth: 400, justifyContent: 'flex-end' }}>
              <select
                className="form-input bg-bg-card"
                style={{ flex: '1 1 160px', fontWeight: 600 }}
                value={incluirInsumos ? 'insumos' : 'operacao'}
                onChange={e => setIncluirInsumos(e.target.value === 'insumos')}
              >
                <option value="operacao">Visão: Operação (MP/PA)</option>
                <option value="insumos">Visão: Insumos</option>
              </select>
              <select
                className="form-input bg-bg-card"
                style={{ flex: '1 1 180px', fontWeight: 600 }}
                value={filtroVencimento}
                onChange={e => setFiltroVencimento(e.target.value)}
              >
                <option value="todos">Validade: Todas</option>
                <option value="vencidos_proximos">⚠️ Vencidos e Próximos (30d)</option>
              </select>
              <input type="text" className="form-input" style={{ flex: '1 1 100px' }}
                placeholder="Endereço..." value={filtroEndereco} onChange={e => setFiltroEndereco(e.target.value)} />
              <input type="text" className="form-input" style={{ flex: '1 1 100px' }}
                placeholder="Código..." value={filtroCodigo} onChange={e => setFiltroCodigo(e.target.value)} />
              <input type="text" className="form-input" style={{ flex: '1 1 140px' }}
                placeholder="Descrição..." value={filtroDescricao} onChange={e => setFiltroDescricao(e.target.value)} />
            </div>
          </div>

          {/* Tabela Scrollável */}
          <div className="table-container">
            <table className="table-densa">
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th>Endereço</th>
                  <th>Código</th>
                  <th style={{ width: '100%' }}>Descrição</th>
                  <th>Grupo</th>
                  <th>Tipo</th>
                  <th>Curva</th>
                  <th>Lote</th>
                  <th>Validade</th>
                  <th style={{ textAlign: 'right' }}>Caixas</th>
                  <th style={{ textAlign: 'right' }}>KG</th>
                  {isExecutivo && <th style={{ textAlign: 'right' }}>Valor Total</th>}
                </tr>
              </thead>
              <tbody>
                {estoqueFiltrado.length === 0 ? (
                  <tr><td colSpan={isExecutivo ? 11 : 10} className="text-center text-muted py-24">Nenhum saldo encontrado.</td></tr>
                ) : (
                  estoqueFiltrado.map((item) => (
                    <tr key={item.id}>
                      <td><EnderecoBadge endereco={item.endereco} /></td>
                      <td className="td-mono">{item.codigo}</td>
                      <td className="td-desc truncate" title={item.descricao}>{item.descricao}</td>
                      <td>{item.grupo || '-'}</td>
                      <td><span className="badge" style={{ backgroundColor: 'var(--color-bg-2)', fontSize: 10 }}>{item.tipo_produto || 'N/A'}</span></td>
                      <td><CurvaBadge curva={item.status_curva} /></td>
                      <td className="td-mono">{item.lote || '-'}</td>
                      <td>{renderValidade(item.validade)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--cyan)' }}>{item.qtd_caixas}</td>
                      <td style={{ textAlign: 'right' }} className="td-muted">{item.qtd_kg}</td>
                      {isExecutivo && (
                        <td style={{ textAlign: 'right' }} className="text-success font-bold">
                          R$ {(item.qtd_kg * (item.valor_unitario || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lado Direito: Totalizador */}
        <div style={{ flex: '1 1 300px', maxWidth: 400 }}>
          <div className="card card--elevated" style={{
            position: 'sticky', top: 24,
            background: 'linear-gradient(180deg, rgba(30,33,52,0.95) 0%, rgba(26,29,46,0.95) 100%)',
            border: '1px solid var(--border)',
            borderTop: '3px solid var(--accent)'
          }}>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 24, textAlign: 'center', fontWeight: 700 }}>
              Totalizador do Filtro
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Linhas Retornadas</div>
                <div style={{ fontWeight: 700, fontSize: 24, color: 'var(--primary)' }}>{totalItens}</div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Total de Caixas</div>
                <div style={{ fontWeight: 700, fontSize: 28, color: 'var(--cyan)' }}>{totalCx.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</div>
              </div>

              <div style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.05)', borderRadius: 12, padding: '16px 8px', border: '1px solid rgba(16, 185, 129, 0.1)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Volume Total</div>
                <div style={{ fontWeight: 700, fontSize: 32, color: 'var(--success)', lineHeight: 1.1 }}>
                  {totalKg.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                  <span style={{ fontSize: 16, color: 'var(--success-muted)', marginLeft: 4 }}>kg</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {(totalKg / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} toneladas
                </div>
              </div>

              {isExecutivo && (
                <div style={{ textAlign: 'center', background: 'rgba(251, 191, 36, 0.05)', borderRadius: 12, padding: '16px 8px', border: '1px solid rgba(251, 191, 36, 0.1)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Custo Aproximado</div>
                  <div style={{ fontWeight: 700, fontSize: 24, color: 'var(--warning)', lineHeight: 1.1 }}>
                    <span style={{ fontSize: 14, color: 'var(--warning-muted)', marginRight: 4 }}>R$</span>
                    {totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
