import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, Package, Plus, Search, X } from 'lucide-react'

const normTxt = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Seletor rápido de itens para Pedido de Compra:
 * - Campos separados de Código e Descrição com autocomplete
 * - Checkbox "Usar código do fornecedor (De-Para)" que traduz o código do frigorífico para o nosso produto
 * - Botão Lupa com modal expandido para pesquisa completa (inspirado em Pedidos de Venda)
 */
export function SeletorItemCompra({
  produtos = [],
  deparas = [],
  fornecedorId = '',
  fornecedorNome = '',
  onIncluirItem,
  onAviso,
}) {
  const [usarCodigoFornecedor, setUsarCodigoFornecedor] = useState(false)
  const [codigoInput, setCodigoInput] = useState('')
  const [descricaoInput, setDescricaoInput] = useState('')
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [deparaMatch, setDeparaMatch] = useState(null) // { codigo_fornecedor, descricao_fornecedor }
  const [qtdInput, setQtdInput] = useState('')
  const [precoInput, setPrecoInput] = useState('')

  const [mostrarSugestoes, setMostrarSugestoes] = useState(false)
  const [indiceSugestao, setIndiceSugestao] = useState(-1)
  const [dropdownRect, setDropdownRect] = useState(null)

  // Modal expandido da Lupa
  const [modalBuscaAberto, setModalBuscaAberto] = useState(false)
  const [modalBuscaTexto, setModalBuscaTexto] = useState('')
  const [modalSomenteMp, setModalSomenteMp] = useState(false)
  const [modalSomenteDepara, setModalSomenteDepara] = useState(false)

  const codigoRef = useRef(null)
  const descricaoWrapRef = useRef(null)
  const descricaoRef = useRef(null)
  const qtdRef = useRef(null)
  const precoRef = useRef(null)
  const modalBuscaRef = useRef(null)

  const atualizarPosicaoDropdown = () => {
    const el = descricaoWrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const espacoAbaixo = window.innerHeight - rect.bottom - 16
    const espacoAcima = rect.top - 16
    const abrirAcima = espacoAbaixo < 210 && espacoAcima > espacoAbaixo
    const maxH = Math.max(160, Math.min(340, abrirAcima ? espacoAcima : espacoAbaixo))
    setDropdownRect({
      left: rect.left,
      width: Math.max(rect.width, 360),
      top: abrirAcima ? undefined : rect.bottom + 4,
      bottom: abrirAcima ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: maxH,
    })
  }

  useEffect(() => {
    if (!mostrarSugestoes) return
    atualizarPosicaoDropdown()
    const onMove = () => atualizarPosicaoDropdown()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [mostrarSugestoes, descricaoInput])

  const deparasFornecedor = useMemo(() => {
    if (!fornecedorId) return []
    return deparas.filter((d) => String(d.fornecedor_id) === String(fornecedorId))
  }, [deparas, fornecedorId])

  const deparaPorProdutoId = useMemo(() => {
    const map = new Map()
    for (const d of deparasFornecedor) {
      const pid = String(d.produto_id)
      const list = map.get(pid) || []
      list.push(d)
      map.set(pid, list)
    }
    return map
  }, [deparasFornecedor])

  // Ao trocar o fornecedor, limpa apenas tag de De-Para se ela não pertencer ao novo fornecedor
  useEffect(() => {
    setDeparaMatch(null)
    if (usarCodigoFornecedor) {
      setProdutoSelecionado(null)
      setCodigoInput('')
      setDescricaoInput('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornecedorId])

  useEffect(() => {
    if (modalBuscaAberto) {
      setTimeout(() => modalBuscaRef.current?.focus(), 60)
    }
  }, [modalBuscaAberto])

  const sugestoesProdutos = useMemo(() => {
    const q = normTxt(descricaoInput)
    const filtrados = !q
      ? produtos
      : produtos.filter((p) => {
          const dps = deparaPorProdutoId.get(String(p.id)) || []
          const matchDepara = dps.some(
            (d) => normTxt(d.codigo_fornecedor).includes(q) || normTxt(d.descricao_fornecedor).includes(q),
          )
          return (
            normTxt(p.descricao).includes(q) ||
            normTxt(p.codigo).includes(q) ||
            normTxt(p.codigo_auxiliar).includes(q) ||
            normTxt(p.ean).includes(q) ||
            matchDepara
          )
        })

    return [...filtrados].slice(0, 16)
  }, [produtos, descricaoInput, deparaPorProdutoId])

  const produtosModalFiltrados = useMemo(() => {
    const q = normTxt(modalBuscaTexto)
    return produtos.filter((p) => {
      if (modalSomenteMp && p.classificacao !== 'MATERIA_PRIMA' && p.tipo_produto !== 'Materia Prima') {
        return false
      }
      const dps = deparaPorProdutoId.get(String(p.id)) || []
      if (modalSomenteDepara && dps.length === 0) return false
      if (!q) return true
      const matchDepara = dps.some(
        (d) => normTxt(d.codigo_fornecedor).includes(q) || normTxt(d.descricao_fornecedor).includes(q),
      )
      return (
        normTxt(p.descricao).includes(q) ||
        normTxt(p.codigo).includes(q) ||
        normTxt(p.codigo_auxiliar).includes(q) ||
        normTxt(p.ean).includes(q) ||
        normTxt(p.grupo).includes(q) ||
        matchDepara
      )
    })
  }, [produtos, modalBuscaTexto, modalSomenteMp, modalSomenteDepara, deparaPorProdutoId])

  const limparCampos = (focarCodigo = false) => {
    setProdutoSelecionado(null)
    setDeparaMatch(null)
    setCodigoInput('')
    setDescricaoInput('')
    setQtdInput('')
    setPrecoInput('')
    setMostrarSugestoes(false)
    setIndiceSugestao(-1)
    if (focarCodigo) {
      setTimeout(() => codigoRef.current?.focus(), 40)
    }
  }

  const aplicarProduto = (prod, focarQtd = true, dpOrigem = null) => {
    setProdutoSelecionado(prod)
    const dpPreferido = dpOrigem || (deparaPorProdutoId.get(String(prod.id)) || [])[0] || null
    setDeparaMatch(dpOrigem || (usarCodigoFornecedor ? dpPreferido : null))
    setCodigoInput(
      usarCodigoFornecedor && dpOrigem
        ? String(dpOrigem.codigo_fornecedor || '')
        : String(prod.codigo || ''),
    )
    setDescricaoInput(prod.descricao || '')
    setMostrarSugestoes(false)
    setIndiceSugestao(-1)
    const precoSug = Number(prod.custo_medio_kg || prod.valor_unitario || 0)
    setPrecoInput(precoSug > 0 ? String(precoSug) : '')
    if (focarQtd) {
      setTimeout(() => {
        qtdRef.current?.focus()
        qtdRef.current?.select?.()
      }, 40)
    }
  }

  const buscarPorCodigoFornecedor = (raw) => {
    const clean = String(raw || '').trim().toLowerCase()
    if (!clean || !fornecedorId) return null
    const semZero = clean.replace(/^0+/, '') || clean
    const exato = deparasFornecedor.find(
      (d) => String(d.codigo_fornecedor || '').trim().toLowerCase() === clean,
    )
    const dp =
      exato ||
      deparasFornecedor.find(
        (d) => (String(d.codigo_fornecedor || '').trim().toLowerCase().replace(/^0+/, '') || '') === semZero,
      )
    if (!dp) return null
    const prod = produtos.find((p) => String(p.id) === String(dp.produto_id))
    return prod ? { prod, dp } : null
  }

  const handleCodigoChange = (val) => {
    setCodigoInput(val)
    const clean = val.trim().toLowerCase()
    if (!clean) {
      setProdutoSelecionado(null)
      setDeparaMatch(null)
      setDescricaoInput('')
      return
    }

    if (usarCodigoFornecedor) {
      const achado = buscarPorCodigoFornecedor(val)
      if (achado) {
        aplicarProduto(achado.prod, false, achado.dp)
      } else {
        setProdutoSelecionado(null)
        setDeparaMatch(null)
        setDescricaoInput('')
      }
      return
    }

    const match = produtos.find(
      (p) =>
        String(p.codigo || '').trim().toLowerCase() === clean ||
        String(p.codigo_auxiliar || '').trim().toLowerCase() === clean ||
        String(p.ean || '').trim().toLowerCase() === clean,
    )
    if (match) {
      aplicarProduto(match, false, null)
    } else if (produtoSelecionado) {
      setProdutoSelecionado(null)
      setDeparaMatch(null)
      setDescricaoInput('')
    }
  }

  const handleCodigoKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()

    if (produtoSelecionado) {
      qtdRef.current?.focus()
      qtdRef.current?.select?.()
      return
    }

    const clean = codigoInput.trim().toLowerCase()
    if (!clean) {
      descricaoRef.current?.focus()
      return
    }

    if (usarCodigoFornecedor) {
      if (!fornecedorId) {
        onAviso?.('Fornecedor necessário', 'Selecione o Fornecedor acima antes de buscar pelo código De-Para.')
        return
      }
      const achado = buscarPorCodigoFornecedor(codigoInput)
      if (achado) {
        aplicarProduto(achado.prod, true, achado.dp)
        return
      }
      onAviso?.(
        'Código não encontrado no De-Para',
        `O código do fornecedor "${codigoInput.trim()}" não tem vínculo salvo para ${fornecedorNome || 'este fornecedor'}. Pesquise na Descrição ou clique na Lupa.`,
      )
      return
    }

    const prefixMatches = produtos.filter(
      (p) =>
        String(p.codigo || '').trim().toLowerCase().startsWith(clean) ||
        String(p.codigo_auxiliar || '').trim().toLowerCase().startsWith(clean),
    )
    if (prefixMatches.length === 1) {
      aplicarProduto(prefixMatches[0], true, null)
    } else if (prefixMatches.length > 1) {
      setModalBuscaTexto(codigoInput.trim())
      setModalBuscaAberto(true)
    } else {
      onAviso?.('Produto não encontrado', `Nenhum produto cadastrado com o código "${codigoInput.trim()}".`)
    }
  }

  const handleDescricaoChange = (val) => {
    setDescricaoInput(val)
    setMostrarSugestoes(true)
    setIndiceSugestao(0)
    if (produtoSelecionado && normTxt(val) !== normTxt(produtoSelecionado.descricao)) {
      setProdutoSelecionado(null)
      setDeparaMatch(null)
      setCodigoInput('')
    }
  }

  const handleDescricaoKeyDown = (e) => {
    if (!mostrarSugestoes || sugestoesProdutos.length === 0) {
      if (e.key === 'ArrowDown') {
        setMostrarSugestoes(true)
        setIndiceSugestao(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceSugestao((prev) => Math.min(sugestoesProdutos.length - 1, prev + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceSugestao((prev) => Math.max(0, prev - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = sugestoesProdutos[indiceSugestao >= 0 ? indiceSugestao : 0]
      if (chosen) aplicarProduto(chosen, true)
    } else if (e.key === 'Escape') {
      setMostrarSugestoes(false)
    }
  }

  const handleSubmitItem = () => {
    if (!produtoSelecionado) {
      onAviso?.('Selecione um produto', 'Informe o Código, selecione na Descrição ou clique na Lupa.')
      codigoRef.current?.focus()
      return
    }
    const qtd = Number(String(qtdInput || '').replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd <= 0) {
      onAviso?.('Quantidade inválida', 'Informe a quantidade em kg maior que zero.')
      qtdRef.current?.focus()
      return
    }
    const preco = Math.max(0, Number(String(precoInput || '0').replace(',', '.')) || 0)

    onIncluirItem?.({
      produto: produtoSelecionado,
      qtd_kg_solicitada: qtd,
      preco_unitario_kg: preco,
      codigo_fornecedor_usado: deparaMatch?.codigo_fornecedor || null,
    })

    limparCampos(true)
  }

  const toggleUsarCodigoFornecedor = (checked) => {
    setUsarCodigoFornecedor(checked)
    if (checked && produtoSelecionado) {
      const dp = (deparaPorProdutoId.get(String(produtoSelecionado.id)) || [])[0] || null
      setDeparaMatch(dp)
      if (dp?.codigo_fornecedor) setCodigoInput(String(dp.codigo_fornecedor))
    } else if (!checked && produtoSelecionado) {
      setDeparaMatch(null)
      setCodigoInput(String(produtoSelecionado.codigo || ''))
    }
    setTimeout(() => codigoRef.current?.focus(), 40)
  }

  return (
    <div
      className="p-14 rounded"
      style={{
        background: 'rgba(15, 23, 42, 0.55)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
      }}
    >
      <div className="flex justify-between items-center flex-wrap gap-8 mb-12">
        <div className="flex items-center gap-8 text-sm font-bold">
          <Package size={17} className="text-info" />
          <span>Lançar Item do Cadastro de Produtos</span>
        </div>
        <span className="text-xs text-muted">
          Digite o <strong>Código</strong>, pesquise na <strong>Descrição</strong> ou clique na <strong>Lupa</strong>
        </span>
      </div>

      {/* Grid Principal estilo Pedido de Vendas */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '150px minmax(250px, 2fr) 125px 125px auto',
          gap: 10,
          alignItems: 'end',
        }}
      >
        {/* 1. Campo Código (Interno ou De-Para do Fornecedor) */}
        <div>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{usarCodigoFornecedor ? 'Cód. Fornecedor' : 'Código'}</span>
            {produtoSelecionado && (
              <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 11 }}>✓ OK</span>
            )}
          </label>
          <input
            ref={codigoRef}
            className="form-input font-mono"
            placeholder={usarCodigoFornecedor ? 'Ex: 75' : 'Ex: 88001'}
            value={codigoInput}
            onChange={(e) => handleCodigoChange(e.target.value)}
            onKeyDown={handleCodigoKeyDown}
            style={{
              borderColor: produtoSelecionado
                ? 'var(--success)'
                : usarCodigoFornecedor
                  ? 'rgba(56, 189, 248, 0.55)'
                  : undefined,
            }}
          />
        </div>

        {/* 2. Campo Descrição c/ Autocomplete + 3. Lupa */}
        <div style={{ position: 'relative' }}>
          <label className="form-label">Descrição do Produto *</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <div ref={descricaoWrapRef} style={{ position: 'relative', flex: 1 }}>
              <input
                ref={descricaoRef}
                className="form-input"
                placeholder="Comece a digitar o nome do produto..."
                value={descricaoInput}
                onFocus={() => setMostrarSugestoes(true)}
                onBlur={() => setTimeout(() => setMostrarSugestoes(false), 160)}
                onChange={(e) => handleDescricaoChange(e.target.value)}
                onKeyDown={handleDescricaoKeyDown}
                style={{
                  paddingRight: descricaoInput ? 30 : undefined,
                  borderColor: produtoSelecionado ? 'var(--success)' : undefined,
                }}
              />
              {descricaoInput && (
                <button
                  type="button"
                  title="Limpar seleção"
                  onClick={() => limparCampos(false)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 2,
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn--secondary btn--icon"
              title="Pesquisar produto na lista expandida (Lupa)"
              onClick={() => {
                setModalBuscaTexto(descricaoInput || codigoInput || '')
                setModalBuscaAberto(true)
              }}
              style={{ height: 40, width: 42, justifyContent: 'center', flexShrink: 0 }}
            >
              <Search size={17} />
            </button>
          </div>

          {/* Dropdown Autocomplete via Portal para nunca cortar dentro de containers com scroll */}
          {mostrarSugestoes &&
            dropdownRect &&
            createPortal(
              <div
                style={{
                  position: 'fixed',
                  top: dropdownRect.top,
                  bottom: dropdownRect.bottom,
                  left: dropdownRect.left,
                  width: dropdownRect.width,
                  zIndex: 1150,
                  background: '#0f172a',
                  border: '1px solid var(--accent)',
                  borderRadius: 10,
                  boxShadow: '0 18px 42px rgba(0,0,0,0.85)',
                  maxHeight: dropdownRect.maxHeight,
                  overflowY: 'auto',
                }}
              >
                {sugestoesProdutos.length === 0 ? (
                  <div style={{ padding: '12px 14px', fontSize: 12.5, color: '#94a3b8' }}>
                    Nenhum produto encontrado para "{descricaoInput}". Use a lupa para explorar o cadastro.
                  </div>
                ) : (
                  sugestoesProdutos.map((p, idx) => {
                    const ativo = idx === indiceSugestao
                    const dps = deparaPorProdutoId.get(String(p.id)) || []
                    const dpBadge = dps[0]
                    return (
                      <div
                        key={p.id}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          aplicarProduto(p, true, dpBadge || null)
                        }}
                        onMouseEnter={() => setIndiceSugestao(idx)}
                        style={{
                          padding: '9px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
                          background: ativo ? 'rgba(59, 130, 246, 0.22)' : 'transparent',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span
                              className="font-mono"
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#38bdf8',
                                background: 'rgba(56, 189, 248, 0.14)',
                                padding: '1px 6px',
                                borderRadius: 4,
                              }}
                            >
                              {p.codigo || 'S/C'}
                            </span>
                            {dpBadge && (
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  color: '#fbbf24',
                                  background: 'rgba(245, 158, 11, 0.16)',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                }}
                                title={`De-Para cadastrado: ${dpBadge.descricao_fornecedor || dpBadge.codigo_fornecedor}`}
                              >
                                Forn: {dpBadge.codigo_fornecedor}
                              </span>
                            )}
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: '#f8fafc',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {p.descricao}
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-xs text-muted" style={{ flexShrink: 0 }}>
                          {Number(p.custo_medio_kg || 0) > 0 ? `${fmtMoeda(p.custo_medio_kg)}/kg` : p.unidade || 'KG'}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>,
              document.body,
            )}
        </div>

        {/* 4. Quantidade (kg) */}
        <div>
          <label className="form-label">Qtd (kg) *</label>
          <input
            ref={qtdRef}
            type="number"
            step="0.001"
            min="0"
            className="form-input font-mono text-right"
            placeholder="500"
            value={qtdInput}
            onChange={(e) => setQtdInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                precoRef.current?.focus()
                precoRef.current?.select?.()
              }
            }}
          />
        </div>

        {/* 5. Preço/kg (R$) */}
        <div>
          <label className="form-label">Preço R$/kg</label>
          <input
            ref={precoRef}
            type="number"
            step="0.01"
            min="0"
            className="form-input font-mono text-right"
            placeholder="25,00"
            value={precoInput}
            onChange={(e) => setPrecoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSubmitItem()
              }
            }}
          />
        </div>

        {/* 6. Botão Incluir */}
        <button type="button" className="btn btn--primary" style={{ height: 40 }} onClick={handleSubmitItem}>
          <Plus size={16} /> Incluir
        </button>
      </div>

      {/* Caixinha "Usar código do fornecedor (De-Para)" + Preview automático do produto selecionado */}
      <div className="flex flex-wrap justify-between items-center gap-10 mt-10 pt-10 border-t border-border">
        <label className="flex items-center gap-8 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={usarCodigoFornecedor}
            onChange={(e) => toggleUsarCodigoFornecedor(e.target.checked)}
          />
          <ArrowRightLeft size={14} className={usarCodigoFornecedor ? 'text-cyan' : 'text-muted'} />
          <span>
            Usar <strong>código do fornecedor (De-Para)</strong> — converte automaticamente para o nosso código interno
          </span>
          {fornecedorId && (
            <span className="badge badge--neutral">
              {deparasFornecedor.length} De-Para(s)
            </span>
          )}
        </label>

        {usarCodigoFornecedor && !fornecedorId && (
          <span className="text-xs text-warning">
            Selecione o fornecedor acima para traduzir pelo De-Para.
          </span>
        )}
      </div>

      {produtoSelecionado && (
        <div
          className="mt-10 p-10 rounded flex flex-wrap justify-between items-center gap-10 text-xs"
          style={{
            background: '#0d1526',
            border: '1px solid rgba(34, 197, 94, 0.35)',
          }}
        >
          <div className="flex items-center gap-8 flex-wrap">
            {deparaMatch && (
              <span className="badge badge--info font-mono">
                De-Para Cód. Forn: {deparaMatch.codigo_fornecedor} ➔ Nosso: {produtoSelecionado.codigo}
              </span>
            )}
            <span className="font-bold text-primary" style={{ fontSize: 13 }}>
              [{produtoSelecionado.codigo || 'S/C'}] {produtoSelecionado.descricao}
            </span>
          </div>
          <span className="text-muted font-mono">
            {produtoSelecionado.tipo_produto} • Custo cadastro: {fmtMoeda(produtoSelecionado.custo_medio_kg || 0)}/kg
          </span>
        </div>
      )}

      {/* ════════════ MODAL LUPA EXPANDIDA: TABELA DE PRODUTOS ════════════ */}
      {modalBuscaAberto && (
        <div
          className="modal-overlay"
          style={{ padding: 16, zIndex: 1100 }}
          onClick={() => setModalBuscaAberto(false)}
        >
          <div
            className="card"
            style={{ width: 980, maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-12 gap-12">
              <div>
                <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Search size={19} className="text-info" /> Pesquisar Produto no Cadastro (Compras)
                </h2>
                <div className="text-muted text-xs mt-4">
                  Clique em qualquer linha para selecionar automaticamente com nosso código interno
                  {fornecedorId ? ` (De-Para de ${fornecedorNome || 'fornecedor'} integrado)` : ''}.
                </div>
              </div>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setModalBuscaAberto(false)}
              >
                <X size={15} /> Fechar
              </button>
            </div>

            <div className="flex gap-12 items-center mb-12 flex-wrap">
              <div style={{ flex: '1 1 280px' }}>
                <input
                  ref={modalBuscaRef}
                  className="form-input"
                  placeholder="Filtrar por nosso código, cód. fornecedor (De-Para), EAN, descrição ou grupo..."
                  value={modalBuscaTexto}
                  onChange={(e) => setModalBuscaTexto(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-6 cursor-pointer text-xs text-muted">
                <input
                  type="checkbox"
                  checked={modalSomenteMp}
                  onChange={(e) => setModalSomenteMp(e.target.checked)}
                />
                Somente Matéria-Prima
              </label>
              {fornecedorId && (
                <label className="flex items-center gap-6 cursor-pointer text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={modalSomenteDepara}
                    onChange={(e) => setModalSomenteDepara(e.target.checked)}
                  />
                  Com De-Para deste fornecedor ({deparasFornecedor.length})
                </label>
              )}
            </div>

            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 105 }}>Nosso Cód.</th>
                    <th style={{ width: 120 }}>Cód. Forn (De-Para)</th>
                    <th>Descrição / Grupo</th>
                    <th style={{ width: 75 }}>Unid.</th>
                    <th style={{ textAlign: 'right', width: 125 }}>Custo Médio</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosModalFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 28 }} className="text-muted">
                        Nenhum produto encontrado para o filtro informado.
                      </td>
                    </tr>
                  ) : (
                    produtosModalFiltrados.map((p) => {
                      const dps = deparaPorProdutoId.get(String(p.id)) || []
                      return (
                        <tr
                          key={p.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            aplicarProduto(p, true, dps[0] || null)
                            setModalBuscaAberto(false)
                          }}
                        >
                          <td className="font-mono font-bold" style={{ color: '#38bdf8' }}>
                            {p.codigo || '-'}
                          </td>
                          <td className="font-mono">
                            {dps.length > 0 ? (
                              <span className="badge badge--warning">{dps.map((d) => d.codigo_fornecedor).join(', ')}</span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{p.descricao}</div>
                            {(p.grupo || p.tipo_produto) && (
                              <div className="text-xs text-muted">
                                {p.tipo_produto} {p.grupo ? `• ${p.grupo}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="font-mono">{p.unidade || 'KG'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }} className="font-mono text-success">
                            {Number(p.custo_medio_kg || 0) > 0 ? `${fmtMoeda(p.custo_medio_kg)}/kg` : '-'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="btn btn--primary btn--sm">
                              Selecionar
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SeletorItemCompra
