import React, { useMemo } from 'react'
import { Lock, Scale, Layers } from 'lucide-react'
import {
  calcularPesoLiquido,
  fmtKg2,
  fmtKg3,
  gerarLotePorData,
  parseNumero,
} from '../../utils/rastreabilidade'

export function resolverTaraSelecionada(taras = [], taraId) {
  if (!taras || taras.length === 0) return null
  const found = taras.find(t => String(t.id) === String(taraId))
  return found || taras.find(t => Number(t.padrao) === 1) || taras[0]
}

export default function PesagemTaraFields({
  taras = [],
  value = {},
  onChange,
  validadeBloqueada = false,
  dataProducaoBloqueada = false,
  ocultarDatas = false,
  mostrarQtdPecas = true,
  qtdPecasObrigatorio = true,
  permitirTaraManual = true,
  permitirLoteManual = false,
  compact = false,
  pesoBrutoRef = null,
  onEnterPesoBruto = null,
}) {
  const taraModo = value.tara_modo === 'MANUAL' && permitirTaraManual ? 'MANUAL' : 'CADASTRADA'
  const taraAtual = useMemo(
    () => (taraModo === 'CADASTRADA' ? resolverTaraSelecionada(taras, value.tara_id) : null),
    [taras, value.tara_id, taraModo]
  )

  const taraIdAtual = taraAtual ? String(taraAtual.id) : ''
  const taraManualNum = parseNumero(value.tara_manual_kg)
  const taraKgAtual =
    taraModo === 'MANUAL'
      ? (Number.isFinite(taraManualNum) && taraManualNum >= 0 ? Number(taraManualNum.toFixed(3)) : 0)
      : (taraAtual ? Number(taraAtual.peso_kg || 0) : 0)
  const loteGerado = useMemo(() => gerarLotePorData(value.data_producao), [value.data_producao])
  const loteEfetivo = String(value.lote || '').trim() || loteGerado

  const brutoNum = parseNumero(value.peso_bruto)
  const pesoLiquido = useMemo(() => {
    if (!Number.isFinite(brutoNum)) return NaN
    return calcularPesoLiquido(brutoNum, taraKgAtual)
  }, [brutoNum, taraKgAtual])
  const pecasNum = parseNumero(value.qtd_pecas)
  const pecasVal = Number.isFinite(pecasNum) && pecasNum > 0 ? Math.trunc(pecasNum) : null

  const emitChange = (patch) => {
    const next = {
      ...value,
      tara_id: value.tara_id ?? taraIdAtual,
      ...patch,
    }
    const nextModo = next.tara_modo === 'MANUAL' && permitirTaraManual ? 'MANUAL' : 'CADASTRADA'
    const nextTara = nextModo === 'CADASTRADA' ? resolverTaraSelecionada(taras, next.tara_id) : null
    const nextManual = parseNumero(next.tara_manual_kg)
    const nextTaraKg =
      nextModo === 'MANUAL'
        ? (Number.isFinite(nextManual) && nextManual >= 0 ? Number(nextManual.toFixed(3)) : 0)
        : (nextTara ? Number(nextTara.peso_kg || 0) : 0)
    const nextBruto = parseNumero(next.peso_bruto)
    const nextLiquido = Number.isFinite(nextBruto) ? calcularPesoLiquido(nextBruto, nextTaraKg) : NaN
    const nextLote = String(next.lote || '').trim() || gerarLotePorData(next.data_producao)
    const nextPecasRaw = parseNumero(next.qtd_pecas)
    const nextPecas = Number.isFinite(nextPecasRaw) && nextPecasRaw > 0 ? Math.trunc(nextPecasRaw) : null

    onChange?.(next, {
      tara: nextTara,
      tara_id: nextTara ? nextTara.id : null,
      tara_kg: nextTaraKg,
      peso_bruto_kg: nextBruto,
      peso_liquido_kg: nextLiquido,
      lote: nextLote,
      qtd_pecas: nextPecas,
    })
  }

  const invalidoBrutoTara = Number.isFinite(brutoNum) && brutoNum > 0 && pesoLiquido <= 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 12 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: ocultarDatas
          ? 'repeat(auto-fit, minmax(170px, 1fr))'
          : (compact ? 'repeat(auto-fit, minmax(150px, 1fr))' : 'repeat(auto-fit, minmax(185px, 1fr))'),
        gap: compact ? 10 : 12,
      }}>
        {!ocultarDatas && (
          <div>
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5,
            }}>
              <span>Data de Produção *</span>
              {loteGerado && (
                <span style={{
                  fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  background: 'rgba(6,182,212,0.16)', color: '#38bdf8',
                  border: '1px solid rgba(56,189,248,0.35)', borderRadius: 4, padding: '1px 6px',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <Layers size={11} /> Lote: {loteGerado}
                </span>
              )}
            </label>
            <input
              type="date"
              className="form-input"
              value={value.data_producao || ''}
              disabled={dataProducaoBloqueada}
              onChange={e => emitChange({ data_producao: e.target.value })}
              style={{
                width: '100%',
                opacity: dataProducaoBloqueada ? 0.78 : 1,
                cursor: dataProducaoBloqueada ? 'not-allowed' : 'text',
              }}
            />
          </div>
        )}

        {!ocultarDatas && (
          <div>
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
              fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5,
            }}>
              <span>Data de Validade *</span>
              {validadeBloqueada && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#fbbf24',
                  background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.35)',
                  borderRadius: 4, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 3,
                }}>
                  <Lock size={10} /> Herdada
                </span>
              )}
            </label>
            <input
              type="date"
              className="form-input"
              value={value.validade || ''}
              disabled={validadeBloqueada}
              onChange={e => emitChange({ validade: e.target.value })}
              style={{
                width: '100%',
                opacity: validadeBloqueada ? 0.78 : 1,
                cursor: validadeBloqueada ? 'not-allowed' : 'text',
              }}
            />
          </div>
        )}

        {mostrarQtdPecas && (
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              color: 'var(--text-secondary)', marginBottom: 5,
            }}>
              Qtd. de Peças {qtdPecasObrigatorio ? '*' : ''}
            </label>
            <input
              type="text"
              inputMode="numeric"
              className="form-input"
              placeholder="Ex: 6"
              value={value.qtd_pecas ?? ''}
              onChange={e => {
                const digitsOnly = String(e.target.value || '').replace(/[^\d]/g, '')
                emitChange({ qtd_pecas: digitsOnly })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (Number.isFinite(pesoLiquido) && pesoLiquido > 0 && onEnterPesoBruto) {
                    onEnterPesoBruto()
                  } else if (pesoBrutoRef?.current) {
                    pesoBrutoRef.current.focus()
                  }
                }
              }}
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
            />
          </div>
        )}

        {permitirLoteManual && (
          <div>
            <label style={{
              display: 'block', fontSize: 12, fontWeight: 600,
              color: 'var(--text-secondary)', marginBottom: 5,
            }}>
              Lote (ou auto DDMMAA)
            </label>
            <input
              type="text"
              className="form-input"
              placeholder={loteGerado || 'Ex: 181126'}
              value={value.lote ?? ''}
              onChange={e => emitChange({ lote: e.target.value })}
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
            />
          </div>
        )}

        <div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 5,
          }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
              Tara da Caixa *
            </label>
            {permitirTaraManual && (
              <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => emitChange({ tara_modo: 'CADASTRADA' })}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', cursor: 'pointer', border: 'none',
                    background: taraModo === 'CADASTRADA' ? 'var(--primary)' : 'var(--bg-2)',
                    color: taraModo === 'CADASTRADA' ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  Cadastrada
                </button>
                <button
                  type="button"
                  onClick={() => emitChange({ tara_modo: 'MANUAL', tara_id: null })}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', cursor: 'pointer', border: 'none',
                    background: taraModo === 'MANUAL' ? 'var(--warning)' : 'var(--bg-2)',
                    color: taraModo === 'MANUAL' ? '#0f172a' : 'var(--text-muted)',
                  }}
                >
                  Manual (kg)
                </button>
              </div>
            )}
          </div>
          {taraModo === 'MANUAL' ? (
            <input
              type="number"
              step="0.001"
              min="0"
              className="form-input"
              placeholder="Ex: 0.850"
              value={value.tara_manual_kg ?? ''}
              onChange={e => emitChange({ tara_manual_kg: e.target.value })}
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
            />
          ) : (
            <select
              className="form-input"
              value={taraIdAtual}
              onChange={e => emitChange({ tara_id: e.target.value })}
              style={{ width: '100%' }}
            >
              {taras.length === 0 && <option value="">Nenhuma tara cadastrada</option>}
              {taras.map(t => (
                <option key={t.id} value={t.id}>
                  {t.nome} ({fmtKg3(t.peso_kg)})
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label style={{
            display: 'block', fontSize: 12, fontWeight: 600,
            color: 'var(--text-secondary)', marginBottom: 5,
          }}>
            Peso Bruto (kg) *
          </label>
          <input
            ref={pesoBrutoRef}
            type="number"
            step="0.001"
            min="0.001"
            className="form-input"
            placeholder="Ex: 21.450"
            value={value.peso_bruto ?? ''}
            onChange={e => emitChange({ peso_bruto: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onEnterPesoBruto) {
                e.preventDefault()
                onEnterPesoBruto()
              }
            }}
            style={{ width: '100%', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
          />
        </div>
      </div>

      {/* Painel automático Peso Líquido = Bruto - Tara */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: compact ? '8px 12px' : '10px 14px',
        borderRadius: 8,
        background: invalidoBrutoTara
          ? 'rgba(239,68,68,0.14)'
          : (Number.isFinite(pesoLiquido) && pesoLiquido > 0 ? 'rgba(34,197,94,0.12)' : 'var(--bg-3)'),
        border: `1px solid ${
          invalidoBrutoTara
            ? 'rgba(239,68,68,0.45)'
            : (Number.isFinite(pesoLiquido) && pesoLiquido > 0 ? 'rgba(34,197,94,0.35)' : 'var(--border)')
        }`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
            <Scale size={14} color="#38bdf8" />
            <strong>Bruto:</strong> {Number.isFinite(brutoNum) && brutoNum > 0 ? fmtKg2(brutoNum) : '--'}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            <strong>Tara:</strong> {fmtKg3(taraKgAtual)}
          </span>
          {loteEfetivo && (
            <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
              <strong>Lote:</strong> {loteEfetivo}
            </span>
          )}
          {mostrarQtdPecas && (
            <span style={{ color: pecasVal ? '#facc15' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              <strong>Peças:</strong> {pecasVal ? `${pecasVal} pç` : '--'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
            Peso Líquido Calculado:
          </span>
          <strong style={{
            fontSize: compact ? 15 : 17,
            fontFamily: 'var(--font-mono)',
            color: invalidoBrutoTara ? '#f87171' : (Number.isFinite(pesoLiquido) && pesoLiquido > 0 ? '#4ade80' : 'var(--text-primary)'),
          }}>
            {Number.isFinite(pesoLiquido) ? fmtKg2(pesoLiquido) : '0,00 kg'}
          </strong>
        </div>
      </div>

      {invalidoBrutoTara && (
        <div style={{ fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
          Atenção: O Peso Bruto informado precisa ser maior que a tara ({fmtKg3(taraKgAtual)}).
        </div>
      )}
    </div>
  )
}
