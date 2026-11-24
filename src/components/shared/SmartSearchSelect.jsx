import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Building2, ChevronDown, MapPin, Package, Search, Truck, User, X } from 'lucide-react'

const normTxt = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const fmtMoeda = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function matchTokens(queryNorm, searchableNorm) {
  if (!queryNorm) return true
  const tokens = queryNorm.split(/\s+/).filter(Boolean)
  for (const t of tokens) {
    if (!searchableNorm.includes(t)) return false
  }
  return true
}

/**
 * Classifica um produto em uma categoria operacional amigável para os filtros rápidos da Lupa.
 */
export function classificarCategoriaProduto(p) {
  const tipo = normTxt(p?.tipo_produto)
  const classif = normTxt(p?.classificacao)
  const catOp = normTxt(p?.categoria_operacional)
  const grupo = normTxt(p?.grupo)
  const desc = normTxt(p?.descricao)

  if (
    tipo.includes('insumo') ||
    tipo.includes('embalag') ||
    catOp.includes('insumo') ||
    grupo.includes('insumo') ||
    grupo.includes('embalag') ||
    desc.includes('etiqueta') ||
    desc.includes('saco vacuo') ||
    desc.includes('caixa papelao')
  ) {
    return 'INSUMO'
  }
  if (
    tipo.includes('higiene') ||
    tipo.includes('consumo') ||
    tipo.includes('limpeza') ||
    catOp.includes('higiene') ||
    grupo.includes('higiene') ||
    grupo.includes('limpeza')
  ) {
    return 'HIGIENE'
  }
  if (
    tipo.includes('emporio') ||
    tipo.includes('revenda') ||
    tipo.includes('mercearia') ||
    tipo.includes('bebida') ||
    catOp.includes('emporio') ||
    catOp.includes('revenda') ||
    grupo.includes('emporio') ||
    grupo.includes('bebida') ||
    grupo.includes('mercearia')
  ) {
    return 'EMPORIO'
  }
  if (
    tipo.includes('materia') ||
    classif === 'materia_prima' ||
    classif.includes('materia')
  ) {
    return 'MATERIA_PRIMA'
  }
  return 'CARNES_CORTES'
}

const PRODUTO_CATEGORIES = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'MATERIA_PRIMA', label: 'Matéria-Prima' },
  { id: 'CARNES_CORTES', label: 'Cortes & Acabados' },
  { id: 'EMPORIO', label: 'Empório / Revenda' },
  { id: 'INSUMO', label: 'Insumos & Embalagens' },
  { id: 'HIGIENE', label: 'Higiene / Consumo' },
]

const CAT_BADGE_MAP = {
  MATERIA_PRIMA: { label: 'Matéria-Prima', cls: 'badge--info' },
  CARNES_CORTES: { label: 'Corte / Acabado', cls: 'badge--success' },
  EMPORIO: { label: 'Empório', cls: 'badge--warning' },
  INSUMO: { label: 'Insumo', cls: 'badge--secondary' },
  HIGIENE: { label: 'Higiene/Consumo', cls: 'badge--secondary' },
}

/**
 * Seletor Dinâmico Universal (Autocomplete + Botão Lupa + Modal Expandido).
 * Suporta milhares de registros sem travar a interface (renderização limitada + busca multi-termo sem acento).
 *
 * Props:
 * - items: Array de objetos
 * - value: string (id/valor selecionado)
 * - onChange: (newValue, itemObj | null) => void
 * - getValue: (item) => string
 * - getLabel: (item) => string
 * - getCode?: (item) => string
 * - getSubLabel?: (item) => string
 * - getSearchText?: (item) => string
 * - getCategory?: (item) => string
 * - getBadge?: (item) => { label: string, cls?: string } | null
 * - getMetaRight?: (item) => string
 * - categories?: Array<{ id: string, label: string }>
 * - placeholder?: string
 * - modalTitle?: string
 * - modalSubtitle?: string
 * - emptyLabel?: string (opção "Todos / Nenhum" clicável quando clearable)
 * - allowClear?: boolean
 * - disabled?: boolean
 * - compact?: boolean
 * - showModalButton?: boolean (default true)
 * - style?: React.CSSProperties
 * - icon?: 'product' | 'client' | 'supplier' | 'truck' | 'user' | 'location'
 */
export function SmartSearchSelect({
  items = [],
  value = '',
  onChange,
  getValue = (it) => String(it?.id ?? ''),
  getLabel = (it) => String(it?.nome ?? it?.descricao ?? it?.label ?? ''),
  getCode = (it) => String(it?.codigo ?? ''),
  getSubLabel = () => '',
  getSearchText,
  getCategory,
  getBadge,
  getMetaRight,
  categories = null,
  placeholder = 'Digite para pesquisar...',
  modalTitle = 'Pesquisar Registro',
  modalSubtitle = 'Digite código, nome ou descrição e clique na linha desejada para selecionar.',
  emptyLabel = '',
  allowClear = true,
  disabled = false,
  compact = false,
  showModalButton = true,
  style,
  icon = 'product',
}) {
  const [aberto, setAberto] = useState(false)
  const [textoBusca, setTextoBusca] = useState('')
  const [indiceAtivo, setIndiceAtivo] = useState(0)
  const [dropdownRect, setDropdownRect] = useState(null)

  // Modal expandido da Lupa
  const [modalAberto, setModalAberto] = useState(false)
  const [modalBusca, setModalBusca] = useState('')
  const [modalCat, setModalCat] = useState('TODOS')

  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const modalInputRef = useRef(null)

  const indexed = useMemo(() => {
    return (items || []).map((raw) => {
      const val = String(getValue(raw) ?? '')
      const label = String(getLabel(raw) ?? '')
      const code = String(getCode(raw) ?? '')
      const sub = String(getSubLabel(raw) ?? '')
      const searchBase = getSearchText
        ? getSearchText(raw)
        : `${code} ${label} ${sub}`
      const cat = getCategory ? getCategory(raw) : 'TODOS'
      const badge = getBadge ? getBadge(raw) : null
      const metaRight = getMetaRight ? getMetaRight(raw) : ''
      return {
        raw,
        val,
        label,
        code,
        sub,
        cat,
        badge,
        metaRight,
        searchNorm: normTxt(searchBase),
        codeNorm: normTxt(code),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const selecionado = useMemo(() => {
    const target = String(value ?? '')
    if (!target) return null
    return indexed.find((i) => i.val === target) || null
  }, [indexed, value])

  const displaySelecionado = selecionado
    ? selecionado.code
      ? `[${selecionado.code}] ${selecionado.label}`
      : selecionado.label
    : ''

  const atualizarPosicao = () => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const espacoAbaixo = window.innerHeight - rect.bottom - 14
    const espacoAcima = rect.top - 14
    const abrirAcima = espacoAbaixo < 200 && espacoAcima > espacoAbaixo
    const maxH = Math.max(160, Math.min(340, abrirAcima ? espacoAcima : espacoAbaixo))
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24)
    const left = Math.min(rect.left, Math.max(12, window.innerWidth - width - 12))
    setDropdownRect({
      left,
      width,
      top: abrirAcima ? undefined : rect.bottom + 4,
      bottom: abrirAcima ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: maxH,
    })
  }

  useEffect(() => {
    if (!aberto) return undefined
    atualizarPosicao()
    const onMove = () => atualizarPosicao()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [aberto, textoBusca])

  useEffect(() => {
    if (modalAberto) {
      setTimeout(() => modalInputRef.current?.focus(), 50)
    }
  }, [modalAberto])

  const sugestoes = useMemo(() => {
    const q = normTxt(textoBusca)
    if (!q) return indexed.slice(0, 60)
    const out = []
    for (const item of indexed) {
      if (matchTokens(q, item.searchNorm)) {
        out.push(item)
        if (out.length >= 60) break
      }
    }
    // Prioriza match exato de código no topo
    out.sort((a, b) => {
      const aEx = a.codeNorm === q ? 0 : a.codeNorm.startsWith(q) ? 1 : 2
      const bEx = b.codeNorm === q ? 0 : b.codeNorm.startsWith(q) ? 1 : 2
      return aEx - bEx
    })
    return out
  }, [indexed, textoBusca])

  const modalFiltrados = useMemo(() => {
    const q = normTxt(modalBusca)
    const out = []
    for (const item of indexed) {
      if (modalCat !== 'TODOS' && item.cat !== modalCat) continue
      if (q && !matchTokens(q, item.searchNorm)) continue
      out.push(item)
    }
    return out
  }, [indexed, modalBusca, modalCat])

  const contadoresCategoria = useMemo(() => {
    if (!categories || !getCategory) return {}
    const map = { TODOS: indexed.length }
    for (const item of indexed) {
      map[item.cat] = (map[item.cat] || 0) + 1
    }
    return map
  }, [indexed, categories, getCategory])

  const escolherItem = (item) => {
    if (!item) {
      onChange?.('', null)
    } else {
      onChange?.(item.val, item.raw)
    }
    setTextoBusca('')
    setAberto(false)
    setModalAberto(false)
  }

  const handleKeyDown = (e) => {
    if (!aberto && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setAberto(true)
      return
    }
    if (!aberto) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceAtivo((i) => Math.min(sugestoes.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceAtivo((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (sugestoes[indiceAtivo]) {
        escolherItem(sugestoes[indiceAtivo])
      }
    } else if (e.key === 'Escape') {
      setAberto(false)
      setTextoBusca('')
    }
  }

  const IconComp =
    icon === 'client'
      ? User
      : icon === 'supplier'
        ? Building2
        : icon === 'truck'
          ? Truck
          : icon === 'location'
            ? MapPin
            : Package

  const altura = compact ? 34 : 40

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', minWidth: 0, ...style }}>
      <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <input
          ref={inputRef}
          type="text"
          className="form-input"
          disabled={disabled}
          value={aberto ? textoBusca : displaySelecionado}
          placeholder={aberto ? 'Digite código ou nome para filtrar...' : (emptyLabel || placeholder)}
          onFocus={() => {
            if (disabled) return
            setTextoBusca('')
            setIndiceAtivo(0)
            setAberto(true)
          }}
          onBlur={() => {
            setTimeout(() => {
              setAberto(false)
              setTextoBusca('')
            }, 170)
          }}
          onChange={(e) => {
            setTextoBusca(e.target.value)
            setIndiceAtivo(0)
            if (!aberto) setAberto(true)
          }}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            height: altura,
            minHeight: altura,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: compact ? 9 : 12,
            paddingRight: selecionado && allowClear ? 50 : 28,
            fontSize: compact ? 12.5 : 13.5,
            borderColor: aberto ? 'var(--accent)' : selecionado ? 'rgba(56, 189, 248, 0.5)' : undefined,
            textOverflow: 'ellipsis',
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />

        {/* Botão Limpar (X) */}
        {selecionado && allowClear && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            title="Limpar seleção"
            onMouseDown={(e) => {
              e.preventDefault()
              escolherItem(null)
            }}
            style={{
              position: 'absolute',
              right: 24,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 2,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <X size={13} />
          </button>
        )}

        {/* Setinha indicadora */}
        <ChevronDown
          size={14}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: `translateY(-50%) rotate(${aberto ? 180 : 0}deg)`,
            color: '#94a3b8',
            pointerEvents: 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </div>

      {/* Botão Lupa — Abre Modal Dinâmico Expandido */}
      {showModalButton && !disabled && (
        <button
          type="button"
          className="btn btn--secondary btn--icon"
          title={`Pesquisa avançada (${indexed.length} registros)`}
          onClick={() => {
            setModalBusca(textoBusca || '')
            setModalCat('TODOS')
            setModalAberto(true)
          }}
          style={{
            height: altura,
            width: compact ? 34 : 40,
            minWidth: compact ? 34 : 40,
            padding: 0,
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Search size={compact ? 14 : 16} />
        </button>
      )}

      {/* DROPDOWN AUTOCOMPLETE VIA PORTAL */}
      {aberto &&
        dropdownRect &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              bottom: dropdownRect.bottom,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 11500,
              background: '#0f172a',
              border: '1px solid #38bdf8',
              borderRadius: 10,
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)',
              maxHeight: dropdownRect.maxHeight,
              overflowY: 'auto',
            }}
          >
            {/* Opção Limpar / Todos */}
            {allowClear && emptyLabel && !textoBusca && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault()
                  escolherItem(null)
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  color: '#94a3b8',
                  fontStyle: 'italic',
                  borderBottom: '1px solid rgba(51, 65, 85, 0.55)',
                  background: !value ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                }}
              >
                {emptyLabel}
              </div>
            )}

            {sugestoes.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 12.5, color: '#94a3b8' }}>
                Nenhum resultado para &ldquo;{textoBusca}&rdquo;.
                {showModalButton && ' Clique na lupa para explorar por categoria.'}
              </div>
            ) : (
              <>
                {sugestoes.map((it, idx) => {
                  const isAtivo = idx === indiceAtivo
                  const isSel = it.val === String(value ?? '')
                  return (
                    <div
                      key={`${it.val}-${idx}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        escolherItem(it)
                      }}
                      onMouseEnter={() => setIndiceAtivo(idx)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        borderBottom: '1px solid rgba(51, 65, 85, 0.45)',
                        background: isAtivo
                          ? 'rgba(59, 130, 246, 0.24)'
                          : isSel
                            ? 'rgba(16, 185, 129, 0.14)'
                            : 'transparent',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {it.code && (
                            <span
                              className="font-mono"
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#38bdf8',
                                background: 'rgba(56, 189, 248, 0.14)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                              }}
                            >
                              {it.code}
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
                            {it.label}
                          </span>
                          {it.badge && (
                            <span
                              className={`badge ${it.badge.cls || 'badge--secondary'}`}
                              style={{ fontSize: 10, padding: '1px 6px' }}
                            >
                              {it.badge.label}
                            </span>
                          )}
                        </div>
                        {it.sub && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#94a3b8',
                              marginTop: 2,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.sub}
                          </div>
                        )}
                      </div>
                      {it.metaRight && (
                        <div
                          className="font-mono"
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: '#34d399',
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {it.metaRight}
                        </div>
                      )}
                    </div>
                  )
                })}

                {indexed.length > sugestoes.length && showModalButton && (
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setAberto(false)
                      setModalBusca(textoBusca)
                      setModalCat('TODOS')
                      setModalAberto(true)
                    }}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'center',
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: '#38bdf8',
                      background: 'rgba(15, 23, 42, 0.96)',
                      cursor: 'pointer',
                      borderTop: '1px solid #334155',
                    }}
                  >
                    🔍 Ver todos ({indexed.length}) na Pesquisa Avançada...
                  </div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}

      {/* MODAL EXPANDIDO DA LUPA VIA PORTAL */}
      {modalAberto &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 12500,
              background: 'rgba(2, 6, 23, 0.78)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={() => setModalAberto(false)}
          >
            <div
              className="card"
              style={{
                width: 'min(920px, 100%)',
                maxHeight: '88vh',
                display: 'flex',
                flexDirection: 'column',
                padding: 18,
                background: '#0f172a',
                border: '1px solid #334155',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.75)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Cabeçalho Modal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
                    <IconComp size={18} style={{ color: '#38bdf8' }} /> {modalTitle}
                  </h3>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    {modalSubtitle}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setModalAberto(false)}
                >
                  <X size={15} /> Fechar
                </button>
              </div>

              {/* Barra de Busca + Pílulas de Categoria */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#38bdf8',
                    }}
                  />
                  <input
                    ref={modalInputRef}
                    className="form-input"
                    value={modalBusca}
                    onChange={(e) => setModalBusca(e.target.value)}
                    placeholder="Digite código, descrição, EAN, CNPJ, cidade, categoria... (pode combinar palavras)"
                    style={{ paddingLeft: 38, paddingRight: modalBusca ? 36 : 12, width: '100%' }}
                  />
                  {modalBusca && (
                    <button
                      type="button"
                      onClick={() => setModalBusca('')}
                      style={{
                        position: 'absolute',
                        right: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>

                {categories && categories.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {categories.map((cat) => {
                      const ativo = modalCat === cat.id
                      const qtd = contadoresCategoria[cat.id] ?? 0
                      if (cat.id !== 'TODOS' && qtd === 0) return null
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setModalCat(cat.id)}
                          style={{
                            padding: '5px 11px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            border: ativo ? '1px solid #38bdf8' : '1px solid #24324d',
                            background: ativo ? 'rgba(56, 189, 248, 0.2)' : '#162238',
                            color: ativo ? '#f8fafc' : '#94a3b8',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <span>{cat.label}</span>
                          <span style={{ fontSize: 10.5, opacity: 0.78 }}>({qtd})</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Contador + Atalho Limpar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11.5, color: '#94a3b8' }}>
                <span>
                  {modalFiltrados.length > 150
                    ? `Mostrando os primeiros 150 de ${modalFiltrados.length.toLocaleString('pt-BR')} resultados — digite mais palavras para afunilar.`
                    : `${modalFiltrados.length.toLocaleString('pt-BR')} registro(s) encontrado(s)`}
                </span>
                {allowClear && emptyLabel && value && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => escolherItem(null)}
                  >
                    {emptyLabel}
                  </button>
                )}
              </div>

              {/* Tabela de Resultados */}
              <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #24324d', borderRadius: 10 }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 115 }}>Código</th>
                      <th>Descrição / Identificação</th>
                      <th style={{ width: 140 }}>Detalhes</th>
                      <th style={{ textAlign: 'right', width: 100 }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
                          Nenhum registro encontrado com esse filtro.
                        </td>
                      </tr>
                    ) : (
                      modalFiltrados.slice(0, 150).map((it, idx) => {
                        const isSel = it.val === String(value ?? '')
                        return (
                          <tr
                            key={`${it.val}-${idx}`}
                            onClick={() => escolherItem(it)}
                            style={{
                              cursor: 'pointer',
                              background: isSel ? 'rgba(16, 185, 129, 0.14)' : undefined,
                            }}
                          >
                            <td className="font-mono font-bold" style={{ color: '#38bdf8' }}>
                              {it.code || '-'}
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, color: '#f8fafc' }}>{it.label}</span>
                                {it.badge && (
                                  <span
                                    className={`badge ${it.badge.cls || 'badge--secondary'}`}
                                    style={{ fontSize: 10 }}
                                  >
                                    {it.badge.label}
                                  </span>
                                )}
                              </div>
                              {it.sub && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{it.sub}</div>}
                            </td>
                            <td className="font-mono" style={{ fontSize: 12, color: '#34d399', fontWeight: 700 }}>
                              {it.metaRight || '-'}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className={`btn ${isSel ? 'btn--success' : 'btn--primary'} btn--sm`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  escolherItem(it)
                                }}
                              >
                                {isSel ? 'Selecionado' : 'Selecionar'}
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
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Seletor Dinâmico de Produtos (com categorias rápidas: Matéria-Prima, Cortes, Empório, Insumos, Higiene).
 */
export function ProdutoSearchSelect({
  produtos = [],
  value = '',
  onChange,
  placeholder = 'Digite código, descrição ou EAN do produto...',
  modalTitle = 'Pesquisar Produto no Catálogo',
  emptyLabel = '',
  allowClear = true,
  compact = false,
  disabled = false,
  style,
}) {
  return (
    <SmartSearchSelect
      items={produtos}
      value={value}
      onChange={onChange}
      icon="product"
      getValue={(p) => String(p?.id ?? '')}
      getCode={(p) => String(p?.codigo ?? '')}
      getLabel={(p) => String(p?.descricao ?? '')}
      getSubLabel={(p) => {
        const partes = [
          p?.tipo_produto,
          p?.grupo,
          p?.especie,
          p?.conservacao,
          p?.ean ? `EAN: ${p.ean}` : '',
        ].filter(Boolean)
        return partes.join(' • ')
      }}
      getSearchText={(p) =>
        `${p?.codigo || ''} ${p?.descricao || ''} ${p?.ean || ''} ${p?.codigo_barras || ''} ${p?.tipo_produto || ''} ${p?.classificacao || ''} ${p?.categoria_operacional || ''} ${p?.grupo || ''} ${p?.especie || ''} ${p?.conservacao || ''}`
      }
      getCategory={classificarCategoriaProduto}
      getBadge={(p) => {
        const cat = classificarCategoriaProduto(p)
        return CAT_BADGE_MAP[cat] || null
      }}
      getMetaRight={(p) => {
        const un = p?.unidade || 'KG'
        const custo = Number(p?.custo_medio_kg || p?.ultimo_preco_compra || 0)
        const venda = Number(p?.valor_unitario || 0)
        if (venda > 0) return `${fmtMoeda(venda)}/${un}`
        if (custo > 0) return `Custo ${fmtMoeda(custo)}/${un}`
        return un
      }}
      categories={PRODUTO_CATEGORIES}
      placeholder={placeholder}
      modalTitle={modalTitle}
      modalSubtitle="Filtre por Matéria-Prima, Cortes, Empório, Insumos ou Higiene e pesquise por código, nome ou EAN."
      emptyLabel={emptyLabel}
      allowClear={allowClear}
      compact={compact}
      disabled={disabled}
      style={style}
    />
  )
}

/**
 * Seletor Dinâmico de Fornecedores (busca por código, razão social, fantasia, CNPJ, SIF, cidade/UF).
 */
export function FornecedorSearchSelect({
  fornecedores = [],
  value = '',
  onChange,
  placeholder = 'Pesquisar fornecedor (nome, CNPJ, SIF)...',
  modalTitle = 'Pesquisar Fornecedor',
  emptyLabel = '',
  allowClear = true,
  compact = false,
  disabled = false,
  style,
}) {
  return (
    <SmartSearchSelect
      items={fornecedores}
      value={value}
      onChange={onChange}
      icon="supplier"
      getValue={(f) => String(f?.id ?? '')}
      getCode={(f) => String(f?.codigo ?? '')}
      getLabel={(f) => String(f?.nome_fantasia || f?.razao_social || '')}
      getSubLabel={(f) => {
        const partes = [
          f?.razao_social && f?.nome_fantasia && f.razao_social !== f.nome_fantasia ? f.razao_social : '',
          f?.cnpj_cpf || f?.cnpj,
          [f?.cidade, f?.uf].filter(Boolean).join('/'),
        ].filter(Boolean)
        return partes.join(' • ')
      }}
      getSearchText={(f) =>
        `${f?.codigo || ''} ${f?.nome_fantasia || ''} ${f?.razao_social || ''} ${f?.cnpj_cpf || ''} ${f?.cnpj || ''} ${f?.registro_sanitario_sif || ''} ${f?.cidade || ''} ${f?.uf || ''}`
      }
      getBadge={(f) =>
        f?.registro_sanitario_sif ? { label: f.registro_sanitario_sif, cls: 'badge--info' } : null
      }
      getMetaRight={(f) => f?.uf || ''}
      placeholder={placeholder}
      modalTitle={modalTitle}
      modalSubtitle="Pesquise por razão social, nome fantasia, código, CNPJ, SIF ou cidade."
      emptyLabel={emptyLabel}
      allowClear={allowClear}
      compact={compact}
      disabled={disabled}
      style={style}
    />
  )
}

/**
 * Seletor Dinâmico de Clientes (busca por código, razão social, fantasia, CNPJ/CPF, cidade/UF).
 */
export function ClienteSearchSelect({
  clientes = [],
  value = '',
  onChange,
  getValue = (c) => String(c?.id ?? ''),
  placeholder = 'Pesquisar cliente (nome, código, CNPJ/CPF)...',
  modalTitle = 'Pesquisar Cliente',
  emptyLabel = '',
  allowClear = true,
  compact = false,
  disabled = false,
  style,
}) {
  return (
    <SmartSearchSelect
      items={clientes}
      value={value}
      onChange={onChange}
      icon="client"
      getValue={getValue}
      getCode={(c) => String(c?.codigo ?? '')}
      getLabel={(c) => String(c?.nome_fantasia || c?.razao_social || c?.nome || c?.cliente || '')}
      getSubLabel={(c) => {
        const partes = [
          c?.razao_social && c?.nome_fantasia && c.razao_social !== c.nome_fantasia ? c.razao_social : '',
          c?.cnpj_cpf || c?.cnpj || c?.cpf,
          [c?.cidade, c?.uf].filter(Boolean).join('/'),
        ].filter(Boolean)
        return partes.join(' • ')
      }}
      getSearchText={(c) =>
        `${c?.codigo || ''} ${c?.nome_fantasia || ''} ${c?.razao_social || ''} ${c?.nome || ''} ${c?.cnpj_cpf || ''} ${c?.cnpj || ''} ${c?.cpf || ''} ${c?.cidade || ''} ${c?.uf || ''}`
      }
      getMetaRight={(c) =>
        Number(c?.limite_credito || 0) > 0 ? `Lim. ${fmtMoeda(c.limite_credito)}` : (c?.uf || '')
      }
      placeholder={placeholder}
      modalTitle={modalTitle}
      modalSubtitle="Pesquise por nome fantasia, razão social, código, CNPJ/CPF ou cidade."
      emptyLabel={emptyLabel}
      allowClear={allowClear}
      compact={compact}
      disabled={disabled}
      style={style}
    />
  )
}
