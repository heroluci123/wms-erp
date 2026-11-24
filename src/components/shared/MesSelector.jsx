import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

const MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MESES_LONGO = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

function parseYm(val) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(val || '').trim())
  if (m) {
    const ano = Number(m[1])
    const mes = Math.min(12, Math.max(1, Number(m[2])))
    return { ano, mes }
  }
  const now = new Date()
  return { ano: now.getFullYear(), mes: now.getMonth() + 1 }
}

function formatYm(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}`
}

/**
 * Seletor de Mês/Ano customizado no tema escuro WMSphere (substitui o <input type="month"> nativo).
 * Valor esperado/retornado: 'YYYY-MM' (ex: '2026-11').
 */
export function MesSelector({ value, onChange, align = 'left' }) {
  const { ano, mes } = useMemo(() => parseYm(value), [value])
  const [aberto, setAberto] = useState(false)
  const [anoView, setAnoView] = useState(ano)
  const containerRef = useRef(null)

  useEffect(() => {
    setAnoView(ano)
  }, [ano])

  useEffect(() => {
    if (!aberto) return undefined
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setAberto(false)
      }
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [aberto])

  const navegarMes = (delta) => {
    const dt = new Date(ano, mes - 1 + delta, 1)
    onChange?.(formatYm(dt.getFullYear(), dt.getMonth() + 1))
  }

  const selecionarMes = (novoAno, novoMes) => {
    onChange?.(formatYm(novoAno, novoMes))
    setAberto(false)
  }

  const hoje = new Date()
  const hojeAno = hoje.getFullYear()
  const hojeMes = hoje.getMonth() + 1

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 40,
          borderRadius: 10,
          background: 'var(--bg-2, #111c33)',
          border: `1px solid ${aberto ? '#38bdf8' : 'var(--border, #24324d)'}`,
          boxShadow: aberto ? '0 0 0 2px rgba(56,189,248,0.2)' : 'none',
          overflow: 'hidden',
          transition: 'border-color 0.15s ease',
        }}
      >
        <button
          type="button"
          onClick={() => navegarMes(-1)}
          title="Mês anterior"
          style={{
            width: 34,
            height: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            color: '#94a3b8',
            cursor: 'pointer',
          }}
        >
          <ChevronLeft size={16} />
        </button>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          style={{
            height: '100%',
            padding: '0 14px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            color: '#f8fafc',
            fontSize: 13.5,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            minWidth: 162,
            justifyContent: 'center',
          }}
        >
          <Calendar size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
          <span>
            {MESES_LONGO[mes - 1]} <span style={{ color: '#94a3b8', fontWeight: 600 }}>{ano}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => navegarMes(1)}
          title="Próximo mês"
          style={{
            width: 34,
            height: '100%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderLeft: '1px solid rgba(255,255,255,0.06)',
            color: '#94a3b8',
            cursor: 'pointer',
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {aberto && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
            zIndex: 120,
            width: 268,
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 14,
            boxShadow: '0 18px 42px rgba(0, 0, 0, 0.55)',
            padding: 14,
          }}
        >
          {/* CABEÇALHO DO ANO */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              paddingBottom: 10,
              borderBottom: '1px solid rgba(148,163,184,0.14)',
            }}
          >
            <button
              type="button"
              onClick={() => setAnoView((a) => a - 1)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: '1px solid #24324d',
                background: '#162238',
                color: '#cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#f8fafc', letterSpacing: '0.02em' }}>
              {anoView}
            </span>
            <button
              type="button"
              onClick={() => setAnoView((a) => a + 1)}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: '1px solid #24324d',
                background: '#162238',
                color: '#cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* GRADE 3x4 DOS MESES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {MESES_CURTO.map((nome, idx) => {
              const mNum = idx + 1
              const selecionado = anoView === ano && mNum === mes
              const ehAtual = anoView === hojeAno && mNum === hojeMes
              return (
                <button
                  key={nome}
                  type="button"
                  onClick={() => selecionarMes(anoView, mNum)}
                  style={{
                    height: 36,
                    borderRadius: 9,
                    border: selecionado
                      ? '1px solid #38bdf8'
                      : ehAtual
                        ? '1px dashed rgba(56,189,248,0.55)'
                        : '1px solid transparent',
                    background: selecionado
                      ? 'linear-gradient(135deg, #2563eb, #0284c7)'
                      : 'rgba(30, 41, 59, 0.55)',
                    color: selecionado ? '#ffffff' : ehAtual ? '#7dd3fc' : '#cbd5e1',
                    fontSize: 12.5,
                    fontWeight: selecionado ? 800 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {nome}
                </button>
              )
            })}
          </div>

          {/* ATALHO MÊS ATUAL */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid rgba(148,163,184,0.14)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => selecionarMes(hojeAno, hojeMes)}
              style={{
                background: 'rgba(56,189,248,0.12)',
                border: '1px solid rgba(56,189,248,0.35)',
                color: '#7dd3fc',
                borderRadius: 7,
                padding: '5px 10px',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Mês Atual ({MESES_CURTO[hojeMes - 1]}/{hojeAno})
            </button>
            <button
              type="button"
              onClick={() => setAberto(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 11.5,
                cursor: 'pointer',
                padding: '4px 6px',
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
