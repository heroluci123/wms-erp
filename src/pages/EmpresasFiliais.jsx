import React, { useState, useEffect, useCallback } from 'react'
import { Factory, Plus, Edit2, CheckCircle2, ShieldCheck, X, Save } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const UNIDADE_LABELS = {
  VAREJO: 'Açougue / Caixa Fechada (Varejo)',
  DISTRIBUICAO: 'Estoque / Distribuição (Pedidos)',
  INDUSTRIA: 'Fábrica / FG Industrialização',
}

export function EmpresasFiliais() {
  const { filialAtivaId, setFilialAtiva, setFiliaisDisponiveis, toastSuccess, toastError } = useAppStore()
  const [empresas, setEmpresas] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalEmp, setModalEmp] = useState(false)
  const [formEmp, setFormEmp] = useState({
    id: null,
    codigo: '1',
    razao_social: '',
    nome_fantasia: '',
    cnpj: '',
    inscricao_estadual: '',
    regime_tributario: 'SIMPLES',
  })

  const [modalFil, setModalFil] = useState(false)
  const [formFil, setFormFil] = useState({
    id: null,
    empresa_id: '',
    codigo: '',
    nome: '',
    tipo_unidade: 'DISTRIBUICAO',
    cnpj: '',
    inscricao_estadual: '',
    uf: 'SP',
    cidade: '',
    codigo_ibge: '',
    registro_sanitario_tipo: 'SIF',
    registro_sanitario_num: '',
    is_padrao: 0,
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, ctx] = await Promise.all([
        cadastrosQueries.listarEmpresas(),
        cadastrosQueries.listarContextoFiliais(),
      ])
      setEmpresas(emps || [])
      if (ctx?.data) setFiliaisDisponiveis(ctx.data)
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError, setFiliaisDisponiveis])

  useEffect(() => {
    carregar()
  }, [carregar])

  const handleSalvarEmp = async (e) => {
    e.preventDefault()
    try {
      await cadastrosQueries.salvarEmpresa(formEmp)
      toastSuccess('Empresa salva', 'Dados fiscais atualizados.')
      setModalEmp(false)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleSalvarFil = async (e) => {
    e.preventDefault()
    try {
      await cadastrosQueries.salvarFilial(formFil)
      toastSuccess('Filial salva', `Unidade ${formFil.codigo} - ${formFil.nome} salva.`)
      setModalFil(false)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Factory className="text-primary" size={26} /> Empresas, Filiais & DIPOA / SIF
          </h1>
          <p className="page-header__subtitle">
            Estrutura Multi-Unidade (ex: 1/1 Açougue, 1/2 Estoque Principal, 2/1 FG Industrialização) com registro sanitário SIF/DIPOA/SISBI
          </p>
        </div>
        <button
          className="btn btn--secondary"
          disabled={!isApiEnabled()}
          onClick={() => {
            setFormEmp({ id: null, codigo: String(empresas.length + 1), razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '', regime_tributario: 'SIMPLES' })
            setModalEmp(true)
          }}
        >
          <Plus size={16} /> Nova Empresa
        </button>
      </div>

      <ApiModeRequiredBanner modulo="Empresas, Filiais e Registros SIF/DIPOA" />

      {loading ? (
        <div className="card p-24 text-center text-muted">Carregando estrutura...</div>
      ) : (
        <div className="flex flex-col gap-20">
          {empresas.map((emp) => (
            <div key={emp.id} className="card">
              <div className="flex items-center justify-between mb-16 pb-12 border-b border-border flex-wrap gap-12">
                <div>
                  <div className="flex items-center gap-8">
                    <span className="badge badge--info">Empresa {emp.codigo}</span>
                    <h2 className="text-lg font-bold">{emp.razao_social}</h2>
                    <span className="badge badge--ghost">{emp.regime_tributario}</span>
                  </div>
                  <div className="text-xs text-muted mt-4">
                    Fantasia: {emp.nome_fantasia} • CNPJ: {emp.cnpj || 'Não informado'} • IE: {emp.inscricao_estadual || '-'}
                  </div>
                </div>
                <div className="flex gap-8">
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={!isApiEnabled()}
                    onClick={() => {
                      setFormEmp({
                        id: emp.id,
                        codigo: emp.codigo,
                        razao_social: emp.razao_social,
                        nome_fantasia: emp.nome_fantasia,
                        cnpj: emp.cnpj || '',
                        inscricao_estadual: emp.inscricao_estadual || '',
                        regime_tributario: emp.regime_tributario || 'SIMPLES',
                      })
                      setModalEmp(true)
                    }}
                  >
                    <Edit2 size={14} /> Editar Empresa
                  </button>
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={!isApiEnabled()}
                    onClick={() => {
                      setFormFil({
                        id: null,
                        empresa_id: emp.id,
                        codigo: `${emp.codigo}/${(emp.filiais || []).length + 1}`,
                        nome: '',
                        tipo_unidade: 'DISTRIBUICAO',
                        cnpj: emp.cnpj || '',
                        inscricao_estadual: emp.inscricao_estadual || '',
                        uf: 'SP',
                        cidade: '',
                        codigo_ibge: '',
                        registro_sanitario_tipo: 'SIF',
                        registro_sanitario_num: '',
                        is_padrao: 0,
                      })
                      setModalFil(true)
                    }}
                  >
                    <Plus size={14} /> Nova Filial / Unidade
                  </button>
                </div>
              </div>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Unidade / Filial</th>
                      <th>Papel Operacional</th>
                      <th>UF / Cidade</th>
                      <th>DIPOA / SIF / SISBI</th>
                      <th>Sessão Atual</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(emp.filiais || []).map((f) => {
                      const ativa = String(f.id) === String(filialAtivaId)
                      return (
                        <tr key={f.id}>
                          <td className="td-mono font-bold">{f.codigo}</td>
                          <td>
                            <div className="font-bold flex items-center gap-6">
                              <span>{f.nome}</span>
                              {Number(f.is_padrao) === 1 && <span className="badge badge--info" style={{ fontSize: 10 }}>Padrão</span>}
                            </div>
                            <div className="td-muted">CNPJ: {f.cnpj || emp.cnpj || '-'}</div>
                          </td>
                          <td>{UNIDADE_LABELS[f.tipo_unidade] || f.tipo_unidade}</td>
                          <td>
                            {f.uf} {f.cidade ? `• ${f.cidade}` : ''}
                          </td>
                          <td>
                            <span className="badge badge--success">
                              <ShieldCheck size={12} /> {f.registro_sanitario_tipo} {f.registro_sanitario_num || '-'}
                            </span>
                          </td>
                          <td>
                            {ativa ? (
                              <span className="badge badge--success">
                                <CheckCircle2 size={12} /> Em uso agora
                              </span>
                            ) : (
                              <button
                                className="btn btn--sm btn--ghost"
                                onClick={() => {
                                  setFilialAtiva(f.id)
                                  toastSuccess('Filial alterada', `Agora operando na unidade ${f.codigo} - ${f.nome}.`)
                                }}
                              >
                                Trocar para esta Filial
                              </button>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn--ghost btn--icon"
                              disabled={!isApiEnabled()}
                              onClick={() => {
                                setFormFil({
                                  id: f.id,
                                  empresa_id: emp.id,
                                  codigo: f.codigo,
                                  nome: f.nome,
                                  tipo_unidade: f.tipo_unidade,
                                  cnpj: f.cnpj || '',
                                  inscricao_estadual: f.inscricao_estadual || '',
                                  uf: f.uf || 'SP',
                                  cidade: f.cidade || '',
                                  codigo_ibge: f.codigo_ibge || '',
                                  registro_sanitario_tipo: f.registro_sanitario_tipo || 'SIF',
                                  registro_sanitario_num: f.registro_sanitario_num || '',
                                  is_padrao: Number(f.is_padrao || 0),
                                })
                                setModalFil(true)
                              }}
                            >
                              <Edit2 size={15} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalEmp && (
        <div className="flex items-center justify-center p-24 fade-in" style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)' }}>
          <div className="card" style={{ width: '100%', maxWidth: 620, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{formEmp.id ? 'Editar Empresa' : 'Nova Empresa'}</h3>
              <button className="btn-icon" onClick={() => setModalEmp(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvarEmp} className="p-20 flex flex-col gap-14">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código</label>
                  <input className="form-input" value={formEmp.codigo} onChange={(e) => setFormEmp({ ...formEmp, codigo: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Razão Social *</label>
                  <input className="form-input" required value={formEmp.razao_social} onChange={(e) => setFormEmp({ ...formEmp, razao_social: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Nome Fantasia</label>
                  <input className="form-input" value={formEmp.nome_fantasia} onChange={(e) => setFormEmp({ ...formEmp, nome_fantasia: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">CNPJ</label>
                  <input className="form-input" value={formEmp.cnpj} onChange={(e) => setFormEmp({ ...formEmp, cnpj: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Regime Tributário</label>
                  <select className="form-input" value={formEmp.regime_tributario} onChange={(e) => setFormEmp({ ...formEmp, regime_tributario: e.target.value })}>
                    <option value="SIMPLES">Simples Nacional</option>
                    <option value="PRESUMIDO">Lucro Presumido</option>
                    <option value="REAL">Lucro Real</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalEmp(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <Save size={16} /> Salvar Empresa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalFil && (
        <div className="flex items-center justify-center p-24 fade-in" style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)' }}>
          <div className="card" style={{ width: '100%', maxWidth: 680, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{formFil.id ? 'Editar Filial' : 'Nova Filial'}</h3>
              <button className="btn-icon" onClick={() => setModalFil(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvarFil} className="p-20 flex flex-col gap-14">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código (ex: 1/1, 1/2, 2/1) *</label>
                  <input className="form-input" required value={formFil.codigo} onChange={(e) => setFormFil({ ...formFil, codigo: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Nome da Unidade *</label>
                  <input className="form-input" required value={formFil.nome} onChange={(e) => setFormFil({ ...formFil, nome: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Tipo de Unidade</label>
                  <select className="form-input" value={formFil.tipo_unidade} onChange={(e) => setFormFil({ ...formFil, tipo_unidade: e.target.value })}>
                    <option value="DISTRIBUICAO">Estoque / Distribuição</option>
                    <option value="VAREJO">Açougue / Caixa Fechada</option>
                    <option value="INDUSTRIA">Fábrica / FG Industrialização</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Registro Sanitário (Filial)</label>
                  <select className="form-input" value={formFil.registro_sanitario_tipo} onChange={(e) => setFormFil({ ...formFil, registro_sanitario_tipo: e.target.value })}>
                    <option value="SISP">SISP (Estadual SP)</option>
                    <option value="SISBI">SISBI (Equivalência Nacional)</option>
                    <option value="SIF">SIF (Federal MAPA)</option>
                    <option value="SIM">SIM (Municipal)</option>
                    <option value="DIPOA">DIPOA</option>
                    <option value="NENHUM">Nenhum</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Nº Registro da Filial (ex: 1929 / 2173)</label>
                  <input className="form-input font-mono" value={formFil.registro_sanitario_num} onChange={(e) => setFormFil({ ...formFil, registro_sanitario_num: e.target.value })} placeholder="Ex: 1929 (SISP) ou 2173 (SISBI)" />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">CNPJ da Filial</label>
                  <input className="form-input" value={formFil.cnpj} onChange={(e) => setFormFil({ ...formFil, cnpj: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">UF</label>
                  <input className="form-input" maxLength={2} value={formFil.uf} onChange={(e) => setFormFil({ ...formFil, uf: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Cidade</label>
                  <input className="form-input" value={formFil.cidade} onChange={(e) => setFormFil({ ...formFil, cidade: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <label className="flex items-center gap-8 cursor-pointer text-sm">
                <input type="checkbox" checked={Number(formFil.is_padrao) === 1} onChange={(e) => setFormFil({ ...formFil, is_padrao: e.target.checked ? 1 : 0 })} />
                Marcar como Filial Padrão ao fazer login
              </label>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalFil(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <Save size={16} /> Salvar Filial
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
