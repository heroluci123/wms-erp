import React, { useEffect, useState } from 'react'
import {
  Search,
  Download,
  X,
  Building2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileCheck2,
} from 'lucide-react'
import { cadastrosQueries } from '../../queries/cadastros'
import { formatarCnpjInput, limparCnpj, validarCnpj } from '../../utils/cnpj'

const PROVEDORES = [
  { id: 'AUTO', label: 'Automático (BrasilAPI + CNPJ.ws)' },
  { id: 'CNPJWS', label: 'CNPJ.ws Pública (c/ Inscrição Estadual)' },
  { id: 'BRASILAPI', label: 'BrasilAPI (Receita + Regime)' },
  { id: 'OPENCNPJ', label: 'OpenCNPJ' },
  { id: 'RECEITAWS', label: 'ReceitaWS' },
]

export function ConsultaCnpjModal({
  isOpen,
  onClose,
  cnpjInicial = '',
  tipoAlvo = 'fornecedor', // 'fornecedor' | 'cliente' | 'transportadora'
  onImportar,
  onCadastrarDireto = null,
}) {
  const [cnpjInput, setCnpjInput] = useState('')
  const [provedor, setProvedor] = useState('AUTO')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState(null)
  const [jaCadastrado, setJaCadastrado] = useState(null)
  const [ieSelecionada, setIeSelecionada] = useState('')
  const [importandoDireto, setImportandoDireto] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const limpo = limparCnpj(cnpjInicial)
    setCnpjInput(formatarCnpjInput(limpo))
    setErro('')
    setResultado(null)
    setJaCadastrado(null)
    setIeSelecionada('')
    if (limpo.length === 14 && validarCnpj(limpo)) {
      executarConsulta(limpo, 'AUTO')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cnpjInicial])

  const executarConsulta = async (cnpjAlvo = cnpjInput, provAlvo = provedor, refresh = false) => {
    const digits = limparCnpj(cnpjAlvo)
    if (digits.length !== 14) {
      setErro('Digite os 14 dígitos do CNPJ para consultar.')
      return
    }
    if (!validarCnpj(digits)) {
      setErro('CNPJ inválido. Confira os dígitos informados.')
      return
    }

    setLoading(true)
    setErro('')
    try {
      const res = await cadastrosQueries.consultarCnpj(digits, { provedor: provAlvo, refresh })
      const d = res?.data || null
      setResultado(d)
      setJaCadastrado(res?.ja_cadastrado || null)
      setIeSelecionada(d?.inscricao_estadual || '')
    } catch (err) {
      setErro(err?.message || 'Não foi possível consultar este CNPJ no momento.')
      setResultado(null)
      setJaCadastrado(null)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const registroExistente = jaCadastrado?.[tipoAlvo] || null
  const labelAlvo =
    tipoAlvo === 'cliente' ? 'Cliente' : tipoAlvo === 'transportadora' ? 'Transportadora' : 'Fornecedor'
  const situacaoAtiva = String(resultado?.situacao || '').includes('ATIVA')

  return (
    <div
      className="flex items-center justify-center p-20 fade-in"
      style={{ position: 'fixed', inset: 0, zIndex: 110, backgroundColor: 'rgba(5,9,18,0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 880,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          background: 'var(--bg-1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-16"
          style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-10">
            <Building2 size={20} className="text-primary" />
            <div>
              <h3 className="text-base font-bold">Consulta de CNPJ — Receita Federal</h3>
              <p className="text-xs text-muted">
                Busque os dados oficiais pelo CNPJ e importe automaticamente para o cadastro de {labelAlvo}
              </p>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div style={{ overflowY: 'auto', padding: 20 }} className="flex flex-col gap-16">
          {/* Barra de pesquisa igual ao fluxo Sistec */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              executarConsulta()
            }}
            className="flex flex-wrap items-end gap-12 p-14 rounded"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
          >
            <div style={{ flex: '1 1 220px' }}>
              <label className="form-label">Digite o CNPJ *</label>
              <input
                type="text"
                autoFocus
                className="form-input form-input--mono"
                placeholder="00.000.000/0000-00"
                value={cnpjInput}
                onChange={(e) => {
                  setErro('')
                  setCnpjInput(formatarCnpjInput(e.target.value))
                }}
              />
            </div>

            <div style={{ flex: '1 1 250px' }}>
              <label className="form-label">Provedor da Consulta</label>
              <select
                className="form-input"
                value={provedor}
                onChange={(e) => setProvedor(e.target.value)}
              >
                {PROVEDORES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-8">
              <button type="submit" className="btn btn--primary" disabled={loading}>
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                {loading ? 'Consultando...' : 'Consultar Provedores'}
              </button>
              {resultado && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  title="Ignorar cache local e reconsultar na API"
                  disabled={loading}
                  onClick={() => executarConsulta(cnpjInput, provedor, true)}
                >
                  <RefreshCw size={15} />
                </button>
              )}
            </div>
          </form>

          {erro && (
            <div
              className="flex items-center gap-10 p-12 rounded text-sm"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>{erro}</span>
            </div>
          )}

          {!resultado && !loading && !erro && (
            <div className="p-24 text-center text-sm text-muted" style={{ border: '1px dashed var(--border)', borderRadius: 8 }}>
              Informe um CNPJ acima (com ou sem pontuação) e clique em <strong>Consultar Provedores</strong> para carregar Razão Social, Nome Fantasia, Endereço, CEP, Telefone, E-mail, Inscrição Estadual, Regime Tributário e CNAE automaticamente.
            </div>
          )}

          {resultado && (
            <>
              {/* Cadastro no WMSphere (equivalente a "Cadastro no Sistec") */}
              {registroExistente ? (
                <div
                  className="flex items-center justify-between flex-wrap gap-10 p-12 rounded text-sm"
                  style={{
                    background: 'rgba(245, 158, 11, 0.14)',
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    color: '#fcd34d',
                  }}
                >
                  <div className="flex items-center gap-8">
                    <AlertTriangle size={18} />
                    <span>
                      <strong>Já cadastrado como {labelAlvo}:</strong>{' '}
                      {registroExistente.codigo ? `[Cód. ${registroExistente.codigo}] ` : ''}
                      {registroExistente.razao_social}
                    </span>
                  </div>
                  <span className="text-xs opacity-80">Ao importar, os dados deste cadastro serão atualizados</span>
                </div>
              ) : (
                <div
                  className="flex items-center justify-between flex-wrap gap-8 p-10 rounded text-xs"
                  style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    color: '#6ee7b7',
                  }}
                >
                  <span className="flex items-center gap-6">
                    <CheckCircle2 size={15} />
                    CNPJ novo — ainda não cadastrado na lista de {labelAlvo}s
                  </span>
                  <span className="text-muted">Fonte: {resultado.provedor_usado}</span>
                </div>
              )}

              {/* Dados Receita */}
              <div className="flex flex-col gap-12">
                <div className="form-grid form-grid--4">
                  <div>
                    <label className="form-label">Tipo / Porte</label>
                    <input
                      className="form-input"
                      readOnly
                      value={[resultado.tipo_empresa, resultado.porte].filter(Boolean).join(' • ') || '-'}
                    />
                  </div>
                  <div>
                    <label className="form-label">Abertura</label>
                    <input className="form-input form-input--mono" readOnly value={resultado.abertura || '-'} />
                  </div>
                  <div>
                    <label className="form-label">Situação</label>
                    <div
                      className="form-input font-bold flex items-center gap-6"
                      style={{
                        color: situacaoAtiva ? '#34d399' : '#f87171',
                        borderColor: situacaoAtiva ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)',
                      }}
                    >
                      {situacaoAtiva ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      <span>{resultado.situacao || '-'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Motivo Situação</label>
                    <input className="form-input" readOnly value={resultado.motivo_situacao || 'SEM MOTIVO'} />
                  </div>
                </div>

                <div className="form-grid form-grid--2">
                  <div>
                    <label className="form-label">Razão Social</label>
                    <input className="form-input font-bold" readOnly value={resultado.razao_social || ''} />
                  </div>
                  <div>
                    <label className="form-label">Nome Fantasia</label>
                    <input className="form-input" readOnly value={resultado.nome_fantasia || ''} />
                  </div>
                </div>

                <div className="form-grid form-grid--4">
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Endereço</label>
                    <input className="form-input" readOnly value={resultado.endereco || ''} />
                  </div>
                  <div>
                    <label className="form-label">Número</label>
                    <input className="form-input" readOnly value={resultado.numero || ''} />
                  </div>
                  <div>
                    <label className="form-label">Bairro</label>
                    <input className="form-input" readOnly value={resultado.bairro || ''} />
                  </div>
                </div>

                <div className="form-grid form-grid--4">
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Complemento</label>
                    <input className="form-input" readOnly value={resultado.complemento || '-'} />
                  </div>
                  <div>
                    <label className="form-label">Cidade / UF</label>
                    <input
                      className="form-input"
                      readOnly
                      value={[resultado.cidade, resultado.uf].filter(Boolean).join(' / ') || '-'}
                    />
                  </div>
                  <div>
                    <label className="form-label">CEP</label>
                    <input className="form-input form-input--mono" readOnly value={resultado.cep || '-'} />
                  </div>
                </div>

                <div className="form-grid form-grid--4">
                  <div>
                    <label className="form-label">E-mail</label>
                    <input className="form-input" readOnly value={resultado.email || '-'} />
                  </div>
                  <div>
                    <label className="form-label">Telefone</label>
                    <input className="form-input form-input--mono" readOnly value={resultado.telefone || '-'} />
                  </div>
                  <div>
                    <label className="form-label">Inscrição Estadual (I.E.)</label>
                    {Array.isArray(resultado.inscricoes_estaduais) && resultado.inscricoes_estaduais.length > 1 ? (
                      <select
                        className="form-input form-input--mono"
                        value={ieSelecionada}
                        onChange={(e) => setIeSelecionada(e.target.value)}
                      >
                        {resultado.inscricoes_estaduais.map((ie, idx) => (
                          <option key={`${ie.uf}-${ie.numero}-${idx}`} value={ie.numero}>
                            {ie.uf}: {ie.numero} {ie.ativo ? '(Ativa)' : '(Inativa)'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="form-input form-input--mono"
                        value={ieSelecionada}
                        placeholder="Não informada (editável)"
                        onChange={(e) => setIeSelecionada(e.target.value)}
                      />
                    )}
                  </div>
                  <div>
                    <label className="form-label">Regime de Apuração</label>
                    <input className="form-input" readOnly value={resultado.regime_apuracao || '-'} />
                  </div>
                </div>

                <div>
                  <label className="form-label">CNAE Principal</label>
                  <input className="form-input" readOnly value={resultado.cnae_principal || '-'} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between flex-wrap gap-10 p-16"
          style={{ background: 'var(--bg-2)', borderTop: '1px solid var(--border)' }}
        >
          <span className="text-xs text-muted">
            Dados obtidos em tempo real via APIs públicas da Receita Federal / CNPJ.ws.
          </span>
          <div className="flex gap-8 flex-wrap">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Sair
            </button>
            {resultado && onCadastrarDireto && !registroExistente && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={importandoDireto}
                onClick={async () => {
                  setImportandoDireto(true)
                  try {
                    await onCadastrarDireto({ ...resultado, inscricao_estadual: ieSelecionada.trim() })
                  } finally {
                    setImportandoDireto(false)
                  }
                }}
              >
                <FileCheck2 size={16} />
                {importandoDireto ? 'Cadastrando...' : 'Importar e Salvar Direto'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              style={{
                background: resultado ? 'var(--success)' : 'var(--bg-3)',
                color: '#fff',
                fontWeight: 600,
              }}
              disabled={!resultado || loading || importandoDireto}
              onClick={() => {
                if (!resultado) return
                onImportar?.(
                  { ...resultado, inscricao_estadual: ieSelecionada.trim() },
                  { existingRegistro: registroExistente },
                )
              }}
            >
              <Download size={16} />{' '}
              {registroExistente ? `Atualizar ${labelAlvo}` : 'Importar Dados'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConsultaCnpjModal
