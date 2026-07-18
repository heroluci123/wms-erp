import React, { useState, useRef, useEffect } from 'react'
import { MapPin, RefreshCw, Package, FileDown } from 'lucide-react'
import { db } from '../lib/db.js'
import { format, differenceInDays } from 'date-fns'

function downloadCSV(content) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `consulta_endereco_${Date.now()}.csv` })
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function consultarEndereco(endereco) {
  const { rows } = await db.execute({
    sql: `
      SELECT
        ec.id, ec.ean_caixa, ec.peso_kg, ec.validade, ec.lote, ec.status,
        p.codigo, p.descricao, p.status_curva, p.grupo, p.valor_unitario,
        pl.codigo as palete_codigo
      FROM estoque_caixas ec
      JOIN produtos p ON p.id = ec.produto_id
      LEFT JOIN paletes pl ON pl.id = ec.palete_id
      WHERE ec.endereco = ? AND ec.status IN ('DISPONIVEL', 'RESERVADA', 'BLOQUEADO')
      ORDER BY p.descricao, ec.validade
    `,
    args: [endereco.toUpperCase().trim()]
  })
  return rows
}

function BadgeValidade({ validade }) {
  if (!validade) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sem validade</span>
  const dataStr = validade.toString().substring(0, 10) + 'T12:00:00'
  const dataObj = new Date(dataStr)
  const dias = differenceInDays(dataObj, new Date())
  const label = format(dataObj, 'dd/MM/yyyy')
  if (dias < 0) return <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{label} <span style={{ fontSize: 10 }}>(VENCIDO)</span></span>
  if (dias <= 30) return <span style={{ color: 'var(--warning)', fontWeight: 700 }}>{label} <span style={{ fontSize: 10 }}>({dias}d)</span></span>
  return <span style={{ color: 'var(--success)', fontWeight: 600 }}>{label}</span>
}

export function ConsultaEndereco() {
  const [inputEndereco, setInputEndereco] = useState('')
  const [enderecoConsultado, setEnderecoConsultado] = useState(null)
  const [caixas, setCaixas] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleConsultar = async (e) => {
    e?.preventDefault()
    const val = inputEndereco.trim().toUpperCase()
    if (!val) return
    setLoading(true)
    try {
      const result = await consultarEndereco(val)
      setEnderecoConsultado(val)
      setCaixas(result)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setInputEndereco('')
    setEnderecoConsultado(null)
    setCaixas([])
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const exportarCSV = () => {
    if (caixas.length === 0) return
    const header = "ENDERECO;EAN_CAIXA;CODIGO;DESCRICAO;GRUPO;VALIDADE;KG;PALETE;CURVA\n"
    const rows = caixas.map(i =>
      `${enderecoConsultado};${i.ean_caixa || ''};${i.codigo};${i.descricao};${i.grupo || ''};${i.validade || ''};${String(i.peso_kg || 0).replace('.', ',')};${i.palete_codigo || ''};${i.status_curva || ''}`
    ).join("\n")
    downloadCSV(header + rows)
  }

  // Agrupamento por produto
  const porProduto = caixas.reduce((acc, cx) => {
    const key = cx.codigo
    if (!acc[key]) acc[key] = { descricao: cx.descricao, codigo: cx.codigo, curva: cx.status_curva, grupo: cx.grupo, caixas: [] }
    acc[key].caixas.push(cx)
    return acc
  }, {})

  const totalCx = caixas.length
  const totalKg = caixas.reduce((s, c) => s + (parseFloat(c.peso_kg) || 0), 0)
  const totalValor = caixas.reduce((s, c) => s + ((parseFloat(c.peso_kg) || 0) * (parseFloat(c.valor_unitario) || 0)), 0)

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', paddingBottom: 48 }}>
      {/* Header */}
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <MapPin size={26} /> Consulta de Endereço
          </h1>
          <p className="page-header__subtitle">
            Raio-X em tempo real — bipe ou digite um endereço para ver tudo que está lá
          </p>
        </div>
      </div>

      {/* Buscador */}
      <div className="card mb-24">
        <form onSubmit={handleConsultar} className="flex gap-12 items-end">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">Endereço</label>
            <input
              ref={inputRef}
              id="consulta-endereco-input"
              type="text"
              className="form-input"
              placeholder="Ex: 1R-01-1"
              value={inputEndereco}
              onChange={e => setInputEndereco(e.target.value.toUpperCase())}
              autoComplete="off"
              style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 18, letterSpacing: 2 }}
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={loading || !inputEndereco.trim()}>
            {loading ? <RefreshCw size={16} className="spin" /> : <MapPin size={16} />} Consultar
          </button>
          {enderecoConsultado && (
            <>
              <button type="button" className="btn btn--ghost" onClick={handleReset}>
                Limpar
              </button>
              {caixas.length > 0 && (
                <button type="button" className="btn btn--secondary" onClick={exportarCSV}>
                  <FileDown size={16} /> Exportar CSV
                </button>
              )}
            </>
          )}
        </form>
      </div>

      {/* Resultado */}
      {enderecoConsultado && !loading && (
        <>
          {/* Status em destaque */}
          <div className="card mb-16" style={{
            background: caixas.length === 0
              ? 'linear-gradient(135deg, rgba(100,100,120,0.15), rgba(60,60,80,0.1))'
              : 'linear-gradient(135deg, rgba(var(--primary-rgb, 99,102,241), 0.12), rgba(var(--primary-rgb, 99,102,241), 0.04))',
            border: `2px solid ${caixas.length === 0 ? 'var(--border)' : 'var(--primary)'}`,
            textAlign: 'center',
            padding: '28px 24px'
          }}>
            <div style={{
              fontSize: 40,
              fontWeight: 900,
              letterSpacing: 4,
              fontFamily: 'monospace',
              color: caixas.length === 0 ? 'var(--text-muted)' : 'var(--primary)',
              marginBottom: 8
            }}>
              {enderecoConsultado}
            </div>

            {caixas.length === 0 ? (
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-muted)', marginTop: 8 }}>
                📭 VAZIO
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', width: '100%', marginTop: 20 }}>
                <div style={{ textAlign: 'center', padding: '0 40px' }}>
                  <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--primary)', lineHeight: 1 }}>{totalCx}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 6 }}>Caixas</div>
                </div>
                <div style={{ width: 1, height: 48, background: 'var(--border)', opacity: 0.6 }} />
                <div style={{ textAlign: 'center', padding: '0 40px' }}>
                  <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--success)', lineHeight: 1 }}>{totalKg.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 6 }}>kg total</div>
                </div>
                <div style={{ width: 1, height: 48, background: 'var(--border)', opacity: 0.6 }} />
                <div style={{ textAlign: 'center', padding: '0 40px' }}>
                  <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--warning)', lineHeight: 1 }}>{Object.keys(porProduto).length}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 6 }}>Produtos</div>
                </div>
                <div style={{ width: 1, height: 48, background: 'var(--border)', opacity: 0.6 }} />
                <div style={{ textAlign: 'center', padding: '0 40px' }}>
                  <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--cyan)', lineHeight: 1 }}>R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 6 }}>Valor Agregado</div>
                </div>
              </div>

            )}
          </div>

          {/* Detalhe por produto */}
          {caixas.length > 0 && Object.values(porProduto).map(grupo => {
            const totalGrupoKg = grupo.caixas.reduce((s, c) => s + (parseFloat(c.peso_kg) || 0), 0)
            const curvaColor = grupo.curva === 'A' ? 'var(--success)' : grupo.curva === 'B' ? 'var(--warning)' : 'var(--text-muted)'
            return (
              <div key={grupo.codigo} className="card mb-12">
                {/* Cabeçalho do produto */}
                <div className="flex items-center justify-between mb-12">
                  <div className="flex items-center gap-12">
                    <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center' }}>
                      <Package size={18} style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{grupo.descricao}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {grupo.codigo}
                        {grupo.grupo && <> · {grupo.grupo}</>}
                      </div>
                    </div>
                    {grupo.curva && (
                      <span style={{ fontWeight: 900, fontSize: 12, color: curvaColor, padding: '2px 8px', borderRadius: 99, border: `1px solid ${curvaColor}` }}>
                        Curva {grupo.curva}
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--primary)' }}>{grupo.caixas.length} cx</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalGrupoKg.toFixed(2)} kg</div>
                  </div>
                </div>

                {/* Lista de caixas */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>EAN / SSCC</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Lote</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Peso</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Validade</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Palete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.caixas.map(cx => (
                        <tr key={cx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11, color: 'var(--primary)' }}>
                            {cx.ean_caixa || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>s/EAN</span>}
                            {cx.status === 'RESERVADA' && <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 4px', background: 'var(--warning-muted)', color: 'var(--warning)', borderRadius: 4, fontWeight: 700 }} title="Caixa em Romaneio/Expedição">RESERVADA</span>}
                            {cx.status === 'BLOQUEADO' && <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 4px', background: 'var(--danger-muted)', color: 'var(--danger)', borderRadius: 4, fontWeight: 700 }}>BLOQUEADA</span>}
                          </td>
                          <td style={{ padding: '7px 8px', color: 'var(--text-muted)' }}>{cx.lote || '—'}</td>
                          <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>{parseFloat(cx.peso_kg || 0).toFixed(2)} kg</td>
                          <td style={{ padding: '7px 8px' }}><BadgeValidade validade={cx.validade} /></td>
                          <td style={{ padding: '7px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{cx.palete_codigo || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
