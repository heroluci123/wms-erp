import React, { useState, useEffect, useCallback } from 'react'
import { Route, Truck, Plus, Edit2, Trash2, X, Save } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'

const TRANS_INICIAL = {
  id: null,
  codigo: '',
  razao_social: '',
  nome_fantasia: '',
  cnpj_cpf: '',
  inscricao_estadual: '',
  uf: 'SP',
  cidade: '',
  telefone: '',
  placa_padrao: '',
}

const ROTA_INICIAL = {
  id: null,
  nome: '',
  regiao: '',
  transportadora_id: '',
  veiculo_padrao: '',
  dias_entrega: '',
}

export function TransportadorasRotas() {
  const { toastSuccess, toastError } = useAppStore()
  const [aba, setAba] = useState('rotas')
  const [transportadoras, setTransportadoras] = useState([])
  const [rotas, setRotas] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalTransp, setModalTransp] = useState(false)
  const [formTransp, setFormTransp] = useState(TRANS_INICIAL)

  const [modalRota, setModalRota] = useState(false)
  const [formRota, setFormRota] = useState(ROTA_INICIAL)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [tr, rt] = await Promise.all([
        cadastrosQueries.listarTransportadoras(),
        cadastrosQueries.listarRotas(),
      ])
      setTransportadoras(tr || [])
      setRotas(rt || [])
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const salvarTransp = async (e) => {
    e.preventDefault()
    try {
      await cadastrosQueries.salvarTransportadora(formTransp)
      toastSuccess('Salvo', 'Transportadora salva com sucesso.')
      setModalTransp(false)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const salvarRota = async (e) => {
    e.preventDefault()
    try {
      await cadastrosQueries.salvarRota({
        ...formRota,
        transportadora_id: formRota.transportadora_id || null,
      })
      toastSuccess('Salvo', 'Rota salva com sucesso.')
      setModalRota(false)
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
            <Route className="text-primary" size={26} /> Transportadoras & Rotas de Embarque
          </h1>
          <p className="page-header__subtitle">
            Base logística para roteirização de entregas, carros/placas e transportadoras parceiras
          </p>
        </div>
        <div className="flex gap-8">
          <button
            className="btn btn--primary"
            disabled={!isApiEnabled()}
            onClick={() => {
              if (aba === 'rotas') {
                setFormRota(ROTA_INICIAL)
                setModalRota(true)
              } else {
                setFormTransp(TRANS_INICIAL)
                setModalTransp(true)
              }
            }}
          >
            <Plus size={18} /> {aba === 'rotas' ? 'Nova Rota' : 'Nova Transportadora'}
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Transportadoras e Rotas" />

      <div className="flex gap-8 mb-16">
        <button className={`btn ${aba === 'rotas' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAba('rotas')}>
          <Route size={16} /> Rotas ({rotas.length})
        </button>
        <button className={`btn ${aba === 'transportadoras' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAba('transportadoras')}>
          <Truck size={16} /> Transportadoras / Frota ({transportadoras.length})
        </button>
      </div>

      {aba === 'rotas' ? (
        <div className="table-container">
          {loading ? (
            <div className="p-24 text-center text-muted">Carregando...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome da Rota</th>
                  <th>Região / Cidades</th>
                  <th>Transportadora Padrão</th>
                  <th>Veículo / Placa</th>
                  <th>Dias de Saída</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rotas.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                      Nenhuma rota cadastrada.
                    </td>
                  </tr>
                ) : (
                  rotas.map((r) => (
                    <tr key={r.id}>
                      <td className="font-bold">{r.nome}</td>
                      <td>{r.regiao || '-'}</td>
                      <td>{r.transportadora_nome || '-'}</td>
                      <td className="td-mono">{r.veiculo_padrao || '-'}</td>
                      <td>{r.dias_entrega || '-'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-end gap-6">
                          <button
                            className="btn btn--ghost btn--icon"
                            disabled={!isApiEnabled()}
                            onClick={() => {
                              setFormRota({
                                id: r.id,
                                nome: r.nome || '',
                                regiao: r.regiao || '',
                                transportadora_id: r.transportadora_id || '',
                                veiculo_padrao: r.veiculo_padrao || '',
                                dias_entrega: r.dias_entrega || '',
                              })
                              setModalRota(true)
                            }}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={async () => {
                              try {
                                await cadastrosQueries.excluirRota(r.id)
                                toastSuccess('Rota removida', 'Rota desativada.')
                                carregar()
                              } catch (err) {
                                toastError('Erro', err.message)
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="table-container">
          {loading ? (
            <div className="p-24 text-center text-muted">Carregando...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Transportadora</th>
                  <th>CNPJ / CPF</th>
                  <th>UF / Cidade</th>
                  <th>Placa Padrão</th>
                  <th>Telefone</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {transportadoras.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                      Nenhuma transportadora cadastrada.
                    </td>
                  </tr>
                ) : (
                  transportadoras.map((t) => (
                    <tr key={t.id}>
                      <td className="td-mono">{t.codigo || '-'}</td>
                      <td className="font-bold">{t.razao_social}</td>
                      <td className="td-mono">{t.cnpj_cpf || '-'}</td>
                      <td>
                        {t.uf} {t.cidade ? `• ${t.cidade}` : ''}
                      </td>
                      <td className="td-mono">{t.placa_padrao || '-'}</td>
                      <td>{t.telefone || '-'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-end gap-6">
                          <button
                            className="btn btn--ghost btn--icon"
                            disabled={!isApiEnabled()}
                            onClick={() => {
                              setFormTransp({
                                id: t.id,
                                codigo: t.codigo || '',
                                razao_social: t.razao_social || '',
                                nome_fantasia: t.nome_fantasia || '',
                                cnpj_cpf: t.cnpj_cpf || '',
                                inscricao_estadual: t.inscricao_estadual || '',
                                uf: t.uf || 'SP',
                                cidade: t.cidade || '',
                                telefone: t.telefone || '',
                                placa_padrao: t.placa_padrao || '',
                              })
                              setModalTransp(true)
                            }}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            onClick={async () => {
                              try {
                                await cadastrosQueries.excluirTransportadora(t.id)
                                toastSuccess('Removido', 'Transportadora desativada.')
                                carregar()
                              } catch (err) {
                                toastError('Erro', err.message)
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modalRota && (
        <div className="flex items-center justify-center p-24 fade-in" style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)' }}>
          <div className="card" style={{ width: '100%', maxWidth: 560, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{formRota.id ? 'Editar Rota' : 'Nova Rota'}</h3>
              <button className="btn-icon" onClick={() => setModalRota(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={salvarRota} className="p-20 flex flex-col gap-14">
              <div>
                <label className="form-label">Nome da Rota *</label>
                <input className="form-input" required value={formRota.nome} onChange={(e) => setFormRota({ ...formRota, nome: e.target.value.toUpperCase() })} placeholder="Ex: CAMPINAS / RMC" />
              </div>
              <div>
                <label className="form-label">Região / Cidades Atendidas</label>
                <input className="form-input" value={formRota.regiao} onChange={(e) => setFormRota({ ...formRota, regiao: e.target.value })} placeholder="Ex: Campinas, Valinhos, Vinhedo" />
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Transportadora Padrão</label>
                  <select className="form-input" value={formRota.transportadora_id} onChange={(e) => setFormRota({ ...formRota, transportadora_id: e.target.value })}>
                    <option value="">-- Própria / Livre --</option>
                    {transportadoras.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.razao_social}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Veículo / Placa Padrão</label>
                  <input className="form-input" value={formRota.veiculo_padrao} onChange={(e) => setFormRota({ ...formRota, veiculo_padrao: e.target.value.toUpperCase() })} placeholder="Ex: ABC-1D23 (Baú -18º)" />
                </div>
              </div>
              <div>
                <label className="form-label">Dias de Entrega</label>
                <input className="form-input" value={formRota.dias_entrega} onChange={(e) => setFormRota({ ...formRota, dias_entrega: e.target.value })} placeholder="Ex: Terça, Quinta e Sábado" />
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalRota(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <Save size={16} /> Salvar Rota
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalTransp && (
        <div className="flex items-center justify-center p-24 fade-in" style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)' }}>
          <div className="card" style={{ width: '100%', maxWidth: 640, padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{formTransp.id ? 'Editar Transportadora' : 'Nova Transportadora'}</h3>
              <button className="btn-icon" onClick={() => setModalTransp(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={salvarTransp} className="p-20 flex flex-col gap-14">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código</label>
                  <input className="form-input" value={formTransp.codigo} onChange={(e) => setFormTransp({ ...formTransp, codigo: e.target.value })} />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Razão Social / Nome *</label>
                  <input className="form-input" required value={formTransp.razao_social} onChange={(e) => setFormTransp({ ...formTransp, razao_social: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">CNPJ / CPF</label>
                  <input className="form-input" value={formTransp.cnpj_cpf} onChange={(e) => setFormTransp({ ...formTransp, cnpj_cpf: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Placa Padrão</label>
                  <input className="form-input" value={formTransp.placa_padrao} onChange={(e) => setFormTransp({ ...formTransp, placa_padrao: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Telefone</label>
                  <input className="form-input" value={formTransp.telefone} onChange={(e) => setFormTransp({ ...formTransp, telefone: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--2">
                <div>
                  <label className="form-label">Cidade</label>
                  <input className="form-input" value={formTransp.cidade} onChange={(e) => setFormTransp({ ...formTransp, cidade: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">UF</label>
                  <input className="form-input" maxLength={2} value={formTransp.uf} onChange={(e) => setFormTransp({ ...formTransp, uf: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalTransp(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  <Save size={16} /> Salvar Transportadora
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
