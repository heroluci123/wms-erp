import React, { useState, useEffect, useCallback } from 'react'
import { Barcode, Search, CheckCircle, AlertTriangle, RefreshCw, Edit2, X, Check } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { db } from '../lib/db.js'

// Busca todas as caixas com EAN interno (INT-...)
async function listarCaixasComEanInt({ filtroEndereco = '', filtroProduto = '' } = {}) {
  const res = await db.execute({
    sql: `
      SELECT 
        c.id, c.ean_caixa, c.endereco, c.validade, c.peso_kg, c.status, c.palete_id,
        p.id as produto_id, p.descricao, p.codigo,
        pl.codigo as palete_codigo
      FROM estoque_caixas c
      JOIN produtos p ON p.id = c.produto_id
      LEFT JOIN paletes pl ON pl.id = c.palete_id
      WHERE c.ean_caixa LIKE 'INT-%'
        AND c.status = 'DISPONIVEL'
        AND (? = '' OR c.endereco LIKE ?)
        AND (? = '' OR p.descricao LIKE ? OR p.codigo LIKE ?)
      ORDER BY p.descricao, c.endereco
    `,
    args: [
      filtroEndereco, filtroEndereco ? `%${filtroEndereco}%` : '%',
      filtroProduto, filtroProduto ? `%${filtroProduto}%` : '%', filtroProduto ? `%${filtroProduto}%` : '%'
    ]
  })
  return res.rows
}

async function atualizarEan(id, novoEan) {
  // Verifica se o novo EAN já existe
  const existe = await db.execute({
    sql: `SELECT id FROM estoque_caixas WHERE ean_caixa = ? AND id != ?`,
    args: [novoEan, id]
  })
  if (existe.rows.length > 0) {
    return { success: false, error: `EAN "${novoEan}" já está em uso por outra caixa.` }
  }
  if (!novoEan || novoEan.trim().length < 4) {
    return { success: false, error: 'EAN inválido (mínimo 4 caracteres).' }
  }
  await db.execute({
    sql: `UPDATE estoque_caixas SET ean_caixa = ? WHERE id = ?`,
    args: [novoEan.trim(), id]
  })
  return { success: true }
}

export function EanEditor() {
  const { operador, toastSuccess, toastError } = useAppStore()
  const [caixas, setCaixas] = useState([])
  const [loading, setLoading] = useState(false)
  const [filtroEndereco, setFiltroEndereco] = useState('')
  const [filtroProduto, setFiltroProduto] = useState('')
  const [editando, setEditando] = useState(null) // { id, valor }
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listarCaixasComEanInt({ filtroEndereco, filtroProduto })
      setCaixas(rows)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar caixas.')
    } finally {
      setLoading(false)
    }
  }, [filtroEndereco, filtroProduto])

  useEffect(() => { carregar() }, [])

  const salvarEan = async (id) => {
    if (!editando || editando.id !== id) return
    setSalvando(true)
    try {
      const res = await atualizarEan(id, editando.valor)
      if (res.success) {
        toastSuccess('EAN Atualizado', `Código atualizado com sucesso.`)
        setEditando(null)
        await carregar()
      } else {
        toastError('Erro', res.error)
      }
    } catch (e) {
      toastError('Erro', e.message)
    } finally {
      setSalvando(false)
    }
  }

  // Verifica permissão
  const temPermissao = operador?.permissoes?.produtos || operador?.permissoes?.operadores
  if (!temPermissao) {
    return (
      <div className="card p-32 text-center">
        <AlertTriangle size={32} className="text-warning mb-12" style={{ margin: '0 auto 12px' }} />
        <div className="font-bold mb-4">Acesso Restrito</div>
        <div className="text-muted text-sm">Esta tela requer permissão de <strong>Consulta & Produtos</strong> ou <strong>Operadores</strong>.</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Barcode size={26} /> Editor de EAN de Caixas
          </h1>
          <p className="page-header__subtitle">
            Corrija EANs internos (INT-...) substituindo pelo código de barras real da caixa
          </p>
        </div>
        <button className="btn btn--primary" onClick={carregar}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Info box */}
      <div style={{ background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.3)', borderRadius:10, padding:'12px 16px', marginBottom:20, display:'flex', gap:12, alignItems:'flex-start' }}>
        <AlertTriangle size={18} style={{ color:'var(--warning)', flexShrink:0, marginTop:2 }} />
        <div style={{ fontSize:13, color:'var(--warning)' }}>
          <strong>Como usar:</strong> Estas caixas foram recebidas com EAN genérico e receberam um código interno automático.
          Clique no ícone de edição (✏️) ao lado do código INT, cole/digite o EAN real da etiqueta da caixa e confirme.
          Após salvar, o coletor de barras poderá localizá-la normalmente.
        </div>
      </div>

      {/* Filtros */}
      <div className="card mb-16">
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div style={{ flex:'1 1 160px' }}>
            <label className="form-label">Endereço</label>
            <input className="form-input" placeholder="ex: 1R-01-1" value={filtroEndereco} onChange={e => setFiltroEndereco(e.target.value)} />
          </div>
          <div style={{ flex:'1 1 220px' }}>
            <label className="form-label">Produto / Descrição</label>
            <input className="form-input" placeholder="ex: bombom" value={filtroProduto} onChange={e => setFiltroProduto(e.target.value)} />
          </div>
          <button className="btn btn--primary" onClick={carregar}>
            <Search size={15} /> Filtrar
          </button>
          <button className="btn btn--ghost" onClick={() => { setFiltroEndereco(''); setFiltroProduto(''); }}>
            Limpar
          </button>
        </div>
      </div>

      {/* Contagem */}
      <div style={{ marginBottom:12, fontSize:13, color:'var(--text-muted)' }}>
        {loading ? 'Carregando...' : `${caixas.length} caixa(s) com EAN interno encontrada(s)`}
      </div>

      {/* Lista */}
      {caixas.length === 0 && !loading ? (
        <div className="card p-32 text-center">
          <CheckCircle size={32} style={{ color:'var(--success)', margin:'0 auto 12px', display:'block' }} />
          <div className="font-bold mb-4">Nenhuma caixa com EAN interno</div>
          <div className="text-muted text-sm">Todas as caixas já possuem EAN real cadastrado. ✅</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {caixas.map(cx => (
            <div key={cx.id} style={{
              background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 16px',
              display:'flex', gap:16, alignItems:'center', flexWrap:'wrap'
            }}>
              {/* Info do produto */}
              <div style={{ flex:'1 1 200px', minWidth:150 }}>
                <div className="font-bold" style={{ fontSize:13 }}>{cx.descricao}</div>
                <div className="text-xs text-muted">{cx.codigo}</div>
                <div style={{ marginTop:4, display:'flex', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:11, background:'var(--bg-3)', padding:'2px 7px', borderRadius:4, color:'var(--text-muted)' }}>
                    📍 {cx.endereco || 'Sem endereço'}
                  </span>
                  {cx.palete_codigo && (
                    <span style={{ fontSize:11, background:'rgba(59,130,246,0.12)', color:'var(--primary)', padding:'2px 7px', borderRadius:4, fontWeight:700 }}>
                      🧱 {cx.palete_codigo}
                    </span>
                  )}
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>⚖️ {cx.peso_kg} kg</span>
                  {cx.validade && <span style={{ fontSize:11, color:'var(--text-muted)' }}>📅 {cx.validade?.toString().substring(0,10)}</span>}
                </div>
              </div>

              {/* EAN atual e editor */}
              <div style={{ flex:'1 1 300px', display:'flex', alignItems:'center', gap:10 }}>
                {editando?.id === cx.id ? (
                  <>
                    <input
                      className="form-input form-input--scanner"
                      style={{ flex:1, fontSize:13, padding:'8px 12px' }}
                      placeholder="Digite ou bipe o EAN real..."
                      value={editando.valor}
                      onChange={e => setEditando({ id: cx.id, valor: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') salvarEan(cx.id)
                        if (e.key === 'Escape') setEditando(null)
                      }}
                      autoFocus
                    />
                    <button
                      className="btn btn--primary btn--icon"
                      onClick={() => salvarEan(cx.id)}
                      disabled={salvando}
                      title="Confirmar"
                      style={{ padding:'8px 12px' }}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      className="btn btn--ghost btn--icon"
                      onClick={() => setEditando(null)}
                      title="Cancelar"
                      style={{ padding:'8px 12px' }}
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{
                      flex:1, fontFamily:'monospace', fontSize:12, padding:'8px 12px',
                      background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.25)',
                      borderRadius:7, color:'var(--warning)', fontWeight:700
                    }}>
                      ⚠️ {cx.ean_caixa}
                    </div>
                    <button
                      className="btn btn--ghost btn--icon"
                      onClick={() => setEditando({ id: cx.id, valor: '' })}
                      title="Editar EAN"
                      style={{ padding:'8px 12px', color:'var(--primary)' }}
                    >
                      <Edit2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
