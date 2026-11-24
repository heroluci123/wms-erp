import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Route, Truck, Plus, Edit2, Trash2, X, Save, Search, CarFront, Star } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ConsultaCnpjModal } from '../components/shared/ConsultaCnpjModal'
import { SmartSearchSelect } from '../components/shared/SmartSearchSelect'
import { formatarCnpjInput } from '../utils/cnpj'
import {
  encontrarCodigoDuplicadoLocal,
  obterProximoCodigoDisponivel,
  sugerirProximoCodigoLocal,
} from '../utils/codigoCadastro'

const TRANS_INICIAL = {
  id: null,
  codigo: '',
  razao_social: '',
  nome_fantasia: '',
  cnpj_cpf: '',
  inscricao_estadual: '',
  endereco: '',
  numero: '',
  bairro: '',
  cep: '',
  uf: 'SP',
  cidade: '',
  telefone: '',
  rntrc_antt: '',
  placa_padrao: '',
}

const VEICULO_INICIAL = {
  id: null,
  placa: '',
  uf_placa: 'SP',
  modelo: '',
  rntrc_antt: '',
  capacidade_kg: '',
  motorista_padrao: '',
  padrao: false,
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
  const { toastSuccess, toastError, confirmar } = useAppStore()
  const [aba, setAba] = useState('transportadoras')
  const [transportadoras, setTransportadoras] = useState([])
  const [rotas, setRotas] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalTransp, setModalTransp] = useState(false)
  const [cnpjTranspOpen, setCnpjTranspOpen] = useState(false)
  const [formTransp, setFormTransp] = useState(TRANS_INICIAL)
  const codigoEditadoRef = useRef(false)

  // Modal de Veículos Individuais da Transportadora
  const [transpFrota, setTranspFrota] = useState(null) // objeto transportadora selecionado
  const [veiculosFrota, setVeiculosFrota] = useState([])
  const [loadingFrota, setLoadingFrota] = useState(false)
  const [formVeic, setFormVeic] = useState(VEICULO_INICIAL)

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

  const abrirFrotaTransportadora = async (t) => {
    setTranspFrota(t)
    setFormVeic({ ...VEICULO_INICIAL, uf_placa: t.uf || 'SP', rntrc_antt: t.rntrc_antt || '' })
    setLoadingFrota(true)
    try {
      const list = await cadastrosQueries.listarVeiculosTransportadora(t.id)
      setVeiculosFrota(list || [])
    } catch (err) {
      toastError('Erro ao carregar veículos', err.message)
      setVeiculosFrota(t.veiculos || [])
    } finally {
      setLoadingFrota(false)
    }
  }

  const salvarVeiculo = async (e) => {
    e.preventDefault()
    if (!transpFrota) return
    try {
      await cadastrosQueries.salvarVeiculoTransportadora(transpFrota.id, {
        ...formVeic,
        capacidade_kg: formVeic.capacidade_kg === '' ? null : Number(String(formVeic.capacidade_kg).replace(',', '.')),
      })
      toastSuccess('Veículo salvo ✅', `Placa ${formVeic.placa.toUpperCase()} vinculada à ${transpFrota.razao_social}.`)
      setFormVeic({ ...VEICULO_INICIAL, uf_placa: transpFrota.uf || 'SP', rntrc_antt: transpFrota.rntrc_antt || '' })
      const list = await cadastrosQueries.listarVeiculosTransportadora(transpFrota.id)
      setVeiculosFrota(list || [])
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar veículo', err.message)
    }
  }

  const excluirVeiculo = async (v) => {
    if (!transpFrota) return
    const ok = await confirmar({
      title: `Remover veículo ${v.placa}`,
      message: `Deseja desativar o veículo ${v.placa} (${v.modelo || 'Sem modelo'}) da transportadora ${transpFrota.razao_social}?`,
      type: 'danger',
      confirmLabel: 'Remover',
    })
    if (!ok) return
    try {
      await cadastrosQueries.excluirVeiculoTransportadora(transpFrota.id, v.id)
      toastSuccess('Veículo removido', `Placa ${v.placa} desativada.`)
      const list = await cadastrosQueries.listarVeiculosTransportadora(transpFrota.id)
      setVeiculosFrota(list || [])
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const preencherAutoCodigoTransp = async () => {
    const codServidor = await obterProximoCodigoDisponivel('transportadora', transportadoras)
    if (!codigoEditadoRef.current) {
      setFormTransp((prev) => (prev.id ? prev : { ...prev, codigo: codServidor }))
    }
  }

  const salvarTransp = async (e) => {
    e.preventDefault()
    const codDigitado = String(formTransp.codigo || '').trim()
    if (formTransp.id && !codDigitado) {
      return toastError('Código obrigatório', 'Informe o código da transportadora.')
    }
    if (codDigitado) {
      const dup = encontrarCodigoDuplicadoLocal(transportadoras, codDigitado, formTransp.id)
      if (dup) {
        return toastError('Código duplicado', `Já existe outra transportadora (${dup.razao_social}) com o código "${codDigitado}".`)
      }
    }
    try {
      await cadastrosQueries.salvarTransportadora({ ...formTransp, codigo: codDigitado })
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
                codigoEditadoRef.current = false
                setFormTransp({ ...TRANS_INICIAL, codigo: sugerirProximoCodigoLocal(transportadoras) })
                setModalTransp(true)
                preencherAutoCodigoTransp()
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
                  <th>CNPJ / IE</th>
                  <th>UF / Cidade / Endereço</th>
                  <th>Frota / Veículos</th>
                  <th>ANTT / Telefone</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {transportadoras.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                      Nenhuma transportadora cadastrada. Clique em <strong>+ Nova Transportadora</strong> e use a busca por CNPJ!
                    </td>
                  </tr>
                ) : (
                  transportadoras.map((t) => {
                    const listaVeic = Array.isArray(t.veiculos) ? t.veiculos : []
                    return (
                      <tr key={t.id}>
                        <td className="td-mono">{t.codigo || '-'}</td>
                        <td>
                          <div className="font-bold">{t.razao_social}</div>
                          {t.nome_fantasia && t.nome_fantasia !== t.razao_social && (
                            <div className="text-xs text-muted">{t.nome_fantasia}</div>
                          )}
                        </td>
                        <td className="td-mono text-xs">
                          <div>{t.cnpj_cpf || '-'}</div>
                          {t.inscricao_estadual && <div className="text-muted">IE: {t.inscricao_estadual}</div>}
                        </td>
                        <td className="text-xs">
                          <div>
                            <strong>{t.uf}</strong> {t.cidade ? `• ${t.cidade}` : ''}
                          </div>
                          {t.endereco && (
                            <div className="text-muted">
                              {[t.endereco, t.numero, t.bairro].filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() => abrirFrotaTransportadora(t)}
                            title="Cadastrar e gerenciar veículos/placas desta transportadora"
                          >
                            <CarFront size={13} /> Veículos ({listaVeic.length})
                          </button>
                          <div className="text-[11px] font-mono text-muted mt-4">
                            {listaVeic.length > 0
                              ? listaVeic.slice(0, 3).map((v) => v.placa).join(', ') +
                                (listaVeic.length > 3 ? ` +${listaVeic.length - 3}` : '')
                              : t.placa_padrao || 'Sem placas'}
                          </div>
                        </td>
                        <td className="text-xs">
                          {t.rntrc_antt && <div className="font-mono text-cyan">ANTT: {t.rntrc_antt}</div>}
                          <div>{t.telefone || '-'}</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex justify-end gap-6">
                            <button
                              className="btn btn--ghost btn--icon"
                              title="Editar transportadora"
                              disabled={!isApiEnabled()}
                              onClick={() => {
                                codigoEditadoRef.current = false
                                setFormTransp({
                                  id: t.id,
                                  codigo: t.codigo || '',
                                  razao_social: t.razao_social || '',
                                  nome_fantasia: t.nome_fantasia || '',
                                  cnpj_cpf: t.cnpj_cpf || '',
                                  inscricao_estadual: t.inscricao_estadual || '',
                                  endereco: t.endereco || '',
                                  numero: t.numero || '',
                                  bairro: t.bairro || '',
                                  cep: t.cep || '',
                                  uf: t.uf || 'SP',
                                  cidade: t.cidade || '',
                                  telefone: t.telefone || '',
                                  rntrc_antt: t.rntrc_antt || '',
                                  placa_padrao: t.placa_padrao || '',
                                })
                                setModalTransp(true)
                              }}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              className="btn btn--ghost btn--icon text-danger"
                              title="Remover transportadora"
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
                    )
                  })
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
                  <SmartSearchSelect
                    items={transportadoras}
                    value={formRota.transportadora_id}
                    onChange={(val) => setFormRota({ ...formRota, transportadora_id: val })}
                    icon="truck"
                    getCode={(t) => String(t?.codigo || t?.uf || '')}
                    getLabel={(t) => String(t?.razao_social || '')}
                    getSubLabel={(t) => [t?.cnpj_cpf, [t?.cidade, t?.uf].filter(Boolean).join('/')].filter(Boolean).join(' • ')}
                    emptyLabel="-- Própria / Livre --"
                    placeholder="Pesquisar transportadora..."
                    modalTitle="Selecionar Transportadora Padrão"
                  />
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
          <div className="card" style={{ width: '100%', maxWidth: 720, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{formTransp.id ? 'Editar Transportadora' : 'Nova Transportadora'}</h3>
              <div className="flex items-center gap-8">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setCnpjTranspOpen(true)}
                  title="Consultar dados da Transportadora automaticamente na Receita Federal"
                >
                  <Search size={14} /> Buscar CNPJ na Receita
                </button>
                <button className="btn-icon" onClick={() => setModalTransp(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <form onSubmit={salvarTransp} className="p-20 flex flex-col gap-12 overflow-auto">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código</label>
                  <input
                    className="form-input"
                    value={formTransp.codigo}
                    placeholder="Automático"
                    title="Gerado automaticamente. Apague para digitar outro código manualmente."
                    onChange={(e) => {
                      codigoEditadoRef.current = true
                      setFormTransp({ ...formTransp, codigo: e.target.value })
                    }}
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Razão Social / Nome *</label>
                  <input className="form-input" required value={formTransp.razao_social} onChange={(e) => setFormTransp({ ...formTransp, razao_social: e.target.value.toUpperCase() })} />
                </div>
              </div>

              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">CNPJ / CPF</label>
                  <div className="flex gap-6">
                    <input
                      className="form-input form-input--mono"
                      style={{ flex: 1 }}
                      placeholder="00.000.000/0000-00"
                      value={formTransp.cnpj_cpf}
                      onChange={(e) => {
                        const raw = e.target.value
                        const d = raw.replace(/\D+/g, '')
                        setFormTransp({ ...formTransp, cnpj_cpf: d.length > 11 ? formatarCnpjInput(raw) : raw })
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      onClick={() => setCnpjTranspOpen(true)}
                      title="Consultar CNPJ online"
                    >
                      <Search size={14} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">Inscrição Estadual (IE)</label>
                  <input className="form-input form-input--mono" placeholder="Ex: 112233445566" value={formTransp.inscricao_estadual} onChange={(e) => setFormTransp({ ...formTransp, inscricao_estadual: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Código ANTT / RNTRC</label>
                  <input className="form-input form-input--mono" placeholder="Opcional" value={formTransp.rntrc_antt} onChange={(e) => setFormTransp({ ...formTransp, rntrc_antt: e.target.value.toUpperCase() })} />
                </div>
              </div>

              <div className="form-grid form-grid--3">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Logradouro / Endereço (sai na NF-e)</label>
                  <input className="form-input" placeholder="Ex: RUA DOS TRANSPORTES" value={formTransp.endereco} onChange={(e) => setFormTransp({ ...formTransp, endereco: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Número</label>
                  <input className="form-input" placeholder="Ex: 450" value={formTransp.numero} onChange={(e) => setFormTransp({ ...formTransp, numero: e.target.value.toUpperCase() })} />
                </div>
              </div>

              <div className="form-grid form-grid--4">
                <div>
                  <label className="form-label">Bairro</label>
                  <input className="form-input" value={formTransp.bairro} onChange={(e) => setFormTransp({ ...formTransp, bairro: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">CEP</label>
                  <input className="form-input form-input--mono" placeholder="00000-000" value={formTransp.cep} onChange={(e) => setFormTransp({ ...formTransp, cep: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Município / Cidade</label>
                  <input className="form-input" value={formTransp.cidade} onChange={(e) => setFormTransp({ ...formTransp, cidade: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">UF</label>
                  <input className="form-input" maxLength={2} value={formTransp.uf} onChange={(e) => setFormTransp({ ...formTransp, uf: e.target.value.toUpperCase() })} />
                </div>
              </div>

              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Nome Fantasia</label>
                  <input className="form-input" value={formTransp.nome_fantasia} onChange={(e) => setFormTransp({ ...formTransp, nome_fantasia: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Telefone</label>
                  <input className="form-input" value={formTransp.telefone} onChange={(e) => setFormTransp({ ...formTransp, telefone: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Placa Padrão (atalho)</label>
                  <input className="form-input form-input--mono" placeholder="ABC1D23" value={formTransp.placa_padrao} onChange={(e) => setFormTransp({ ...formTransp, placa_padrao: e.target.value.toUpperCase() })} />
                </div>
              </div>

              <div className="flex justify-between items-center gap-8 pt-12 border-t border-border">
                {formTransp.id ? (
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => {
                      const alvo = transportadoras.find((x) => x.id === formTransp.id) || formTransp
                      setModalTransp(false)
                      abrirFrotaTransportadora(alvo)
                    }}
                  >
                    <CarFront size={15} /> Gerenciar Veículos / Placas desta Transportadora
                  </button>
                ) : (
                  <span className="text-xs text-muted">Após salvar, clique em <strong>Veículos</strong> para cadastrar toda a frota individualmente.</span>
                )}
                <div className="flex gap-8">
                  <button type="button" className="btn btn--ghost" onClick={() => setModalTransp(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn--primary">
                    <Save size={16} /> Salvar Transportadora
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE VEÍCULOS INDIVIDUAIS DA TRANSPORTADORA */}
      {transpFrota && (
        <div className="flex items-center justify-center p-24 fade-in" style={{ position: 'fixed', inset: 0, zIndex: 92, backgroundColor: 'rgba(5,9,18,0.84)' }}>
          <div className="card" style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}>
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <div>
                <h3 className="text-base font-bold m-0 flex items-center gap-8">
                  <CarFront size={18} className="text-cyan" /> Frota &amp; Veículos — {transpFrota.razao_social}
                </h3>
                <div className="text-xs text-muted mt-2">
                  Cadastre cada caminhão, van ou carreta individualmente para selecionar direto na emissão da NF-e e no embarque.
                </div>
              </div>
              <button type="button" className="btn-icon" onClick={() => setTranspFrota(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="p-20 overflow-auto flex flex-col gap-16">
              <form
                onSubmit={salvarVeiculo}
                className="p-14 rounded flex flex-col gap-10"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
              >
                <div className="text-xs font-bold uppercase text-cyan">
                  {formVeic.id ? `Editando Veículo (${formVeic.placa})` : '+ Cadastrar Novo Veículo na Transportadora'}
                </div>
                <div className="form-grid form-grid--4">
                  <div>
                    <label className="form-label">Placa *</label>
                    <input
                      required
                      className="form-input form-input--mono"
                      placeholder="Ex: ABC1D23"
                      value={formVeic.placa}
                      onChange={(e) => setFormVeic({ ...formVeic, placa: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <label className="form-label">UF Placa *</label>
                    <input
                      required
                      maxLength={2}
                      className="form-input form-input--mono"
                      placeholder="SP"
                      value={formVeic.uf_placa}
                      onChange={(e) => setFormVeic({ ...formVeic, uf_placa: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Modelo / Tipo de Baú</label>
                    <input
                      className="form-input"
                      placeholder="Ex: VW Delivery Baú Frigorífico -18°C"
                      value={formVeic.modelo}
                      onChange={(e) => setFormVeic({ ...formVeic, modelo: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>

                <div className="form-grid form-grid--3">
                  <div>
                    <label className="form-label">RNTRC / ANTT (opcional)</label>
                    <input
                      className="form-input form-input--mono"
                      placeholder="Se diferente da transp."
                      value={formVeic.rntrc_antt}
                      onChange={(e) => setFormVeic({ ...formVeic, rntrc_antt: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <label className="form-label">Capacidade (kg)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      className="form-input form-input--mono"
                      placeholder="Ex: 3500"
                      value={formVeic.capacidade_kg}
                      onChange={(e) => setFormVeic({ ...formVeic, capacidade_kg: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="form-label">Motorista Padrão</label>
                    <input
                      className="form-input"
                      placeholder="Ex: CARLOS SILVA"
                      value={formVeic.motorista_padrao}
                      onChange={(e) => setFormVeic({ ...formVeic, motorista_padrao: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between flex-wrap gap-8 pt-6">
                  <label className="flex items-center gap-8 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(formVeic.padrao)}
                      onChange={(e) => setFormVeic({ ...formVeic, padrao: e.target.checked })}
                    />
                    Definir como veículo padrão desta transportadora (pré-selecionado na NF-e)
                  </label>
                  <div className="flex gap-8">
                    {formVeic.id && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() =>
                          setFormVeic({
                            ...VEICULO_INICIAL,
                            uf_placa: transpFrota.uf || 'SP',
                            rntrc_antt: transpFrota.rntrc_antt || '',
                          })
                        }
                      >
                        Cancelar Edição
                      </button>
                    )}
                    <button type="submit" className="btn btn--primary btn--sm">
                      <Save size={14} /> {formVeic.id ? 'Atualizar Veículo' : 'Adicionar Veículo'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="table-container">
                {loadingFrota ? (
                  <div className="p-20 text-center text-muted">Carregando veículos...</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Placa / UF</th>
                        <th>Modelo / Baú</th>
                        <th>ANTT</th>
                        <th style={{ textAlign: 'right' }}>Capacidade</th>
                        <th>Motorista Padrão</th>
                        <th style={{ textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {veiculosFrota.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center p-20 text-muted">
                            Nenhum veículo individual cadastrado ainda para esta transportadora.
                          </td>
                        </tr>
                      ) : (
                        veiculosFrota.map((v) => (
                          <tr key={v.id}>
                            <td className="td-mono font-bold">
                              {v.placa} / {v.uf_placa}
                              {v.padrao && (
                                <span className="badge badge--success ml-6" style={{ fontSize: 10 }}>
                                  <Star size={10} /> Padrão
                                </span>
                              )}
                            </td>
                            <td className="text-xs">{v.modelo || '-'}</td>
                            <td className="td-mono text-xs">{v.rntrc_antt || transpFrota.rntrc_antt || '-'}</td>
                            <td style={{ textAlign: 'right' }} className="td-mono text-xs">
                              {v.capacidade_kg ? `${Number(v.capacidade_kg).toLocaleString('pt-BR')} kg` : '-'}
                            </td>
                            <td className="text-xs">{v.motorista_padrao || '-'}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div className="flex justify-end gap-6">
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--icon"
                                  title="Editar veículo"
                                  onClick={() =>
                                    setFormVeic({
                                      id: v.id,
                                      placa: v.placa || '',
                                      uf_placa: v.uf_placa || 'SP',
                                      modelo: v.modelo || '',
                                      rntrc_antt: v.rntrc_antt || '',
                                      capacidade_kg: v.capacidade_kg != null ? String(v.capacidade_kg) : '',
                                      motorista_padrao: v.motorista_padrao || '',
                                      padrao: Boolean(v.padrao),
                                    })
                                  }
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--icon text-danger"
                                  title="Remover veículo"
                                  onClick={() => excluirVeiculo(v)}
                                >
                                  <Trash2 size={14} />
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
            </div>
          </div>
        </div>
      )}

      <ConsultaCnpjModal
        isOpen={cnpjTranspOpen}
        onClose={() => setCnpjTranspOpen(false)}
        cnpjInicial={modalTransp ? formTransp.cnpj_cpf : ''}
        tipoAlvo="transportadora"
        onImportar={(dadosReceita) => {
          if (!modalTransp) {
            codigoEditadoRef.current = false
          }
          const precisaAutoCodigo = !formTransp?.id && !String(formTransp?.codigo || '').trim() && !codigoEditadoRef.current
          const codFallback = sugerirProximoCodigoLocal(transportadoras)
          setFormTransp((prev) => {
            const codigoBase = prev.codigo || (!prev.id ? codFallback : '')
            return {
              ...prev,
              codigo: codigoBase,
              razao_social: dadosReceita.razao_social || prev.razao_social,
              nome_fantasia: dadosReceita.nome_fantasia || dadosReceita.razao_social || prev.nome_fantasia,
              cnpj_cpf: dadosReceita.cnpj_formatado || dadosReceita.cnpj || prev.cnpj_cpf,
              inscricao_estadual: dadosReceita.inscricao_estadual || prev.inscricao_estadual,
              endereco: dadosReceita.endereco || prev.endereco,
              numero: dadosReceita.numero || prev.numero,
              bairro: dadosReceita.bairro || prev.bairro,
              cep: dadosReceita.cep || prev.cep,
              uf: dadosReceita.uf || prev.uf,
              cidade: dadosReceita.cidade || prev.cidade,
              telefone: dadosReceita.telefone || prev.telefone,
            }
          })
          setCnpjTranspOpen(false)
          setModalTransp(true)
          if (precisaAutoCodigo) preencherAutoCodigoTransp()
          toastSuccess('Dados importados ✅', 'CNPJ, endereço e dados da transportadora carregados automaticamente.')
        }}
      />
    </div>
  )
}
