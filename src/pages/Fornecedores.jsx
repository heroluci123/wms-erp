import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Truck, Plus, Search, Edit2, Trash2, X, Save, ShieldCheck, Building2, Power } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalDialog } from '../components/shared/ModalDialog'
import { ConsultaCnpjModal } from '../components/shared/ConsultaCnpjModal'
import { formatarCnpjInput } from '../utils/cnpj'
import {
  encontrarCodigoDuplicadoLocal,
  obterProximoCodigoDisponivel,
  sugerirProximoCodigoLocal,
} from '../utils/codigoCadastro'

const FORM_INICIAL = {
  id: null,
  codigo: '',
  razao_social: '',
  nome_fantasia: '',
  cnpj_cpf: '',
  inscricao_estadual: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cep: '',
  uf: 'SP',
  cidade: '',
  telefone: '',
  email: '',
  cnae_principal: '',
  regime_apuracao: '',
  situacao_cadastral: '',
  registro_sanitario_sif: '',
  prazo_entrega_dias: 5,
}

export function Fornecedores() {
  const { toastSuccess, toastError } = useAppStore()
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('ATIVOS')
  const [modalOpen, setModalOpen] = useState(false)
  const [cnpjModalOpen, setCnpjModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState(FORM_INICIAL)
  const [confirmDlg, setConfirmDlg] = useState({
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    confirmLabel: 'Confirmar',
    target: null,
  })
  const codigoEditadoRef = useRef(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await cadastrosQueries.listarFornecedores({ incluirInativos: true })
      setLista(rows || [])
    } catch (err) {
      toastError('Erro ao carregar fornecedores', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const contadoresStatus = useMemo(() => {
    const ativos = lista.filter((f) => Number(f.ativo) !== 0).length
    return { ativos, inativos: lista.length - ativos, todos: lista.length }
  }, [lista])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((f) => {
      const ativo = Number(f.ativo) !== 0
      if (statusFiltro === 'ATIVOS' && !ativo) return false
      if (statusFiltro === 'INATIVOS' && ativo) return false
      if (!q) return true
      return (
        String(f.codigo || '').toLowerCase().includes(q) ||
        String(f.razao_social || '').toLowerCase().includes(q) ||
        String(f.nome_fantasia || '').toLowerCase().includes(q) ||
        String(f.cnpj_cpf || '').toLowerCase().includes(q) ||
        String(f.registro_sanitario_sif || '').toLowerCase().includes(q)
      )
    })
  }, [lista, busca, statusFiltro])

  const preencherCodigoAutomaticoSeNovo = useCallback(async () => {
    const codServidor = await obterProximoCodigoDisponivel('fornecedor', lista)
    if (!codigoEditadoRef.current) {
      setForm((prev) => (prev.id ? prev : { ...prev, codigo: codServidor }))
    }
  }, [lista])

  const abrirNovoFornecedor = () => {
    codigoEditadoRef.current = false
    setForm({ ...FORM_INICIAL, codigo: sugerirProximoCodigoLocal(lista) })
    setModalOpen(true)
    preencherCodigoAutomaticoSeNovo()
  }

  const handleSalvar = async (e) => {
    e.preventDefault()
    if (!form.razao_social.trim()) return toastError('Obrigatório', 'Informe a Razão Social do fornecedor.')
    const codDigitado = String(form.codigo || '').trim()
    if (form.id && !codDigitado) {
      return toastError('Código obrigatório', 'Informe o código do fornecedor.')
    }
    if (codDigitado) {
      const dup = encontrarCodigoDuplicadoLocal(lista, codDigitado, form.id)
      if (dup) {
        const suf = Number(dup.ativo) === 0 ? ' (cadastro inativo no histórico)' : ''
        return toastError('Código duplicado', `Já existe outro fornecedor (${dup.razao_social}) com o código "${codDigitado}"${suf}.`)
      }
    }
    setSalvando(true)
    try {
      await cadastrosQueries.salvarFornecedor({
        ...form,
        codigo: codDigitado,
        prazo_entrega_dias: Number(form.prazo_entrega_dias || 0),
      })
      toastSuccess('Fornecedor salvo', `${form.razao_social} cadastrado/atualizado.`)
      setModalOpen(false)
      await carregar()
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const aplicarDadosCnpjNoForm = (dadosReceita, { existingRegistro } = {}) => {
    const baseExistente = existingRegistro?.id
      ? lista.find((f) => String(f.id) === String(existingRegistro.id)) || null
      : null

    if (!modalOpen && !baseExistente) {
      codigoEditadoRef.current = false
    }
    const codAtual = modalOpen && !baseExistente ? String(form?.codigo || '').trim() : ''
    const precisaAutoCodigo = !baseExistente && (!modalOpen || (!form?.id && !codAtual)) && !codigoEditadoRef.current
    const codFallback = sugerirProximoCodigoLocal(lista)

    setForm((prev) => {
      const base = baseExistente
        ? { ...FORM_INICIAL, ...baseExistente, prazo_entrega_dias: Number(baseExistente.prazo_entrega_dias ?? 5) }
        : prev?.id || modalOpen
          ? prev
          : { ...FORM_INICIAL, codigo: codFallback }

      return {
        ...base,
        codigo: !base.id && !String(base.codigo || '').trim() ? codFallback : base.codigo,
        razao_social: dadosReceita.razao_social || base.razao_social,
        nome_fantasia: dadosReceita.nome_fantasia || dadosReceita.razao_social || base.nome_fantasia,
        cnpj_cpf: dadosReceita.cnpj_formatado || dadosReceita.cnpj || base.cnpj_cpf,
        inscricao_estadual: dadosReceita.inscricao_estadual || base.inscricao_estadual,
        endereco: dadosReceita.endereco || base.endereco,
        numero: dadosReceita.numero || base.numero,
        complemento: dadosReceita.complemento || base.complemento,
        bairro: dadosReceita.bairro || base.bairro,
        cep: dadosReceita.cep || base.cep,
        uf: dadosReceita.uf || base.uf,
        cidade: dadosReceita.cidade || base.cidade,
        telefone: dadosReceita.telefone || base.telefone,
        email: dadosReceita.email || base.email,
        cnae_principal: dadosReceita.cnae_principal || base.cnae_principal,
        regime_apuracao: dadosReceita.regime_apuracao || base.regime_apuracao,
        situacao_cadastral: dadosReceita.situacao || base.situacao_cadastral,
      }
    })
    setCnpjModalOpen(false)
    setModalOpen(true)
    if (precisaAutoCodigo) {
      preencherCodigoAutomaticoSeNovo()
    }
    toastSuccess('Dados importados da Receita ✅', 'Confira os campos (como SIF e prazo) e salve o fornecedor.')
  }

  const cadastrarDiretoPeloCnpj = async (dadosReceita) => {
    try {
      await cadastrosQueries.salvarFornecedor({
        ...FORM_INICIAL,
        razao_social: dadosReceita.razao_social,
        nome_fantasia: dadosReceita.nome_fantasia || dadosReceita.razao_social,
        cnpj_cpf: dadosReceita.cnpj_formatado || dadosReceita.cnpj,
        inscricao_estadual: dadosReceita.inscricao_estadual || '',
        endereco: dadosReceita.endereco || '',
        numero: dadosReceita.numero || '',
        complemento: dadosReceita.complemento || '',
        bairro: dadosReceita.bairro || '',
        cep: dadosReceita.cep || '',
        uf: dadosReceita.uf || 'SP',
        cidade: dadosReceita.cidade || '',
        telefone: dadosReceita.telefone || '',
        email: dadosReceita.email || '',
        cnae_principal: dadosReceita.cnae_principal || '',
        regime_apuracao: dadosReceita.regime_apuracao || '',
        situacao_cadastral: dadosReceita.situacao || '',
        prazo_entrega_dias: 5,
      })
      toastSuccess('Fornecedor Cadastrado ✅', `${dadosReceita.razao_social} adicionado à lista de fornecedores!`)
      setCnpjModalOpen(false)
      await carregar()
    } catch (err) {
      toastError('Erro ao cadastrar fornecedor', err.message)
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Truck className="text-primary" size={26} /> Cadastro de Fornecedores & SIF
          </h1>
          <p className="page-header__subtitle">
            Frigoríficos, fornecedores de matéria-prima, embalagens, prazo de lead-time e registro sanitário SIF/DIPOA
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          <button
            className="btn btn--outline"
            onClick={() => setCnpjModalOpen(true)}
            disabled={!isApiEnabled()}
            title="Consultar CNPJ online na Receita Federal / BrasilAPI / CNPJ.ws"
          >
            <Building2 size={17} /> Consultar CNPJ
          </button>
          <button
            className="btn btn--primary"
            onClick={abrirNovoFornecedor}
            disabled={!isApiEnabled()}
          >
            <Plus size={18} /> Novo Fornecedor
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Fornecedores" />

      <div className="table-container">
        <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-input"
              style={{ paddingLeft: 36 }}
              placeholder="Buscar por código, razão social, CNPJ ou SIF..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="flex gap-8 flex-wrap items-center">
            {[
              { id: 'ATIVOS', label: `Ativos (${contadoresStatus.ativos})` },
              { id: 'INATIVOS', label: `Inativos (${contadoresStatus.inativos})` },
              { id: 'TODOS', label: `Todos (${contadoresStatus.todos})` },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                className={`btn btn--sm ${statusFiltro === s.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setStatusFiltro(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="p-24 text-center text-muted">Carregando...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Fornecedor / Razão Social</th>
                  <th>CNPJ / CPF • IE</th>
                  <th>UF / Cidade</th>
                  <th>SIF / Registro Sanitário</th>
                  <th style={{ textAlign: 'right' }}>Prazo Entrega</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                      Nenhum fornecedor cadastrado.
                    </td>
                  </tr>
                ) : (
                  filtrados.map((f) => (
                    <tr key={f.id}>
                      <td className="td-mono">{f.codigo || '-'}</td>
                      <td>
                        <div className="font-bold flex items-center gap-6 flex-wrap">
                          <span>{f.razao_social}</span>
                          {Number(f.ativo) === 0 && (
                            <span className="badge badge--warning" style={{ fontSize: 10 }}>
                              Inativo{f.dias_inativo != null ? ` (${f.dias_inativo}d)` : ''}
                            </span>
                          )}
                          {f.tem_contas_financeiras && (
                            <span className="badge badge--danger" style={{ fontSize: 10 }}>
                              Contas a Pagar
                            </span>
                          )}
                        </div>
                        <div className="td-muted">{f.nome_fantasia !== f.razao_social ? f.nome_fantasia : f.telefone || '-'}</div>
                      </td>
                      <td>
                        <div className="td-mono">{f.cnpj_cpf || '-'}</div>
                        <div className="td-muted">IE: {f.inscricao_estadual || '-'}</div>
                      </td>
                      <td>
                        {f.uf} {f.cidade ? `• ${f.cidade}` : ''}
                      </td>
                      <td>
                        {f.registro_sanitario_sif ? (
                          <span className="badge badge--success">
                            <ShieldCheck size={12} /> {f.registro_sanitario_sif}
                          </span>
                        ) : (
                          <span className="td-muted">-</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} className="td-mono">
                        {f.prazo_entrega_dias ?? 5} dias
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-end gap-6">
                          <button
                            className="btn btn--ghost btn--icon"
                            disabled={!isApiEnabled()}
                            onClick={() => {
                              codigoEditadoRef.current = false
                              setForm({
                                id: f.id,
                                codigo: f.codigo || '',
                                razao_social: f.razao_social || '',
                                nome_fantasia: f.nome_fantasia || '',
                                cnpj_cpf: f.cnpj_cpf || '',
                                inscricao_estadual: f.inscricao_estadual || '',
                                endereco: f.endereco || '',
                                numero: f.numero || '',
                                complemento: f.complemento || '',
                                bairro: f.bairro || '',
                                cep: f.cep || '',
                                uf: f.uf || 'SP',
                                cidade: f.cidade || '',
                                telefone: f.telefone || '',
                                email: f.email || '',
                                cnae_principal: f.cnae_principal || '',
                                regime_apuracao: f.regime_apuracao || '',
                                situacao_cadastral: f.situacao_cadastral || '',
                                registro_sanitario_sif: f.registro_sanitario_sif || '',
                                prazo_entrega_dias: Number(f.prazo_entrega_dias ?? 5),
                              })
                              setModalOpen(true)
                            }}
                            title="Editar Fornecedor"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            className={`btn btn--ghost btn--icon ${Number(f.ativo) === 0 ? 'text-success' : 'text-warning'}`}
                            disabled={!isApiEnabled()}
                            title={Number(f.ativo) === 0 ? 'Reativar Fornecedor' : 'Inativar Fornecedor'}
                            onClick={async () => {
                              try {
                                const ativando = Number(f.ativo) === 0
                                await cadastrosQueries.alterarAtivoFornecedor(f.id, ativando)
                                toastSuccess(
                                  ativando ? 'Fornecedor reativado' : 'Fornecedor inativado',
                                  ativando
                                    ? `${f.razao_social} voltou para o catálogo ativo.`
                                    : `${f.razao_social} foi inativado e permanece no histórico.`,
                                )
                                carregar()
                              } catch (err) {
                                toastError('Erro', err.message)
                              }
                            }}
                          >
                            <Power size={15} />
                          </button>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            disabled={!isApiEnabled()}
                            title={f.motivo_bloqueio_exclusao || 'Apagar definitivamente do registro'}
                            onClick={() => {
                              if (f.pode_excluir_definitivo === false) {
                                setConfirmDlg({
                                  isOpen: true,
                                  type: 'alert',
                                  title: 'Exclusão Bloqueada',
                                  message: f.motivo_bloqueio_exclusao || 'Este fornecedor não atende às regras para ser apagado do registro.',
                                  confirmLabel: 'Entendi',
                                  target: null,
                                })
                                return
                              }
                              setConfirmDlg({
                                isOpen: true,
                                type: 'confirm',
                                title: 'Apagar Fornecedor do Registro',
                                message: `Deseja apagar definitivamente "${f.razao_social}" do banco de dados? Esta ação é irreversível.`,
                                confirmLabel: 'Sim, apagar do registro',
                                target: f,
                              })
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
      </div>

      {modalOpen && (
        <div
          className="flex items-center justify-center p-20 fade-in"
          style={{ position: 'fixed', inset: 0, zIndex: 90, backgroundColor: 'rgba(5,9,18,0.82)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="card"
            style={{ width: '100%', maxWidth: 860, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)', overflow: 'hidden' }}
          >
            <div className="flex items-center justify-between p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <h3 className="text-base font-bold">{form.id ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvar} style={{ overflowY: 'auto', padding: 20 }} className="flex flex-col gap-14">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código</label>
                  <input
                    className="form-input"
                    value={form.codigo}
                    placeholder="Automático"
                    title="Gerado automaticamente. Apague para digitar outro código manualmente."
                    onChange={(e) => {
                      codigoEditadoRef.current = true
                      setForm({ ...form, codigo: e.target.value })
                    }}
                  />
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Razão Social *</label>
                  <input className="form-input" required value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Nome Fantasia</label>
                  <input className="form-input" value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">CNPJ / CPF</label>
                  <div className="flex gap-6">
                    <input
                      className="form-input form-input--mono"
                      style={{ flex: 1 }}
                      placeholder="00.000.000/0000-00"
                      value={form.cnpj_cpf}
                      onChange={(e) => {
                        const raw = e.target.value
                        const digits = raw.replace(/\D+/g, '')
                        setForm({ ...form, cnpj_cpf: digits.length > 11 ? formatarCnpjInput(raw) : raw })
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      title="Consultar CNPJ e preencher automático"
                      onClick={() => setCnpjModalOpen(true)}
                    >
                      <Search size={14} /> CNPJ
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">Inscrição Estadual</label>
                  <input className="form-input form-input--mono" value={form.inscricao_estadual} onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--4">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Endereço</label>
                  <input className="form-input" value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Número</label>
                  <input className="form-input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Bairro</label>
                  <input className="form-input" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="form-grid form-grid--4">
                <div>
                  <label className="form-label">Complemento</label>
                  <input className="form-input" value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">Cidade</label>
                  <input className="form-input" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">UF</label>
                  <input className="form-input" maxLength={2} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">CEP</label>
                  <input className="form-input form-input--mono" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--4">
                <div>
                  <label className="form-label">Telefone</label>
                  <input className="form-input" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">E-mail</label>
                  <input className="form-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })} />
                </div>
                <div>
                  <label className="form-label">Registro Sanitário (SIF / DIPOA)</label>
                  <input className="form-input" value={form.registro_sanitario_sif} onChange={(e) => setForm({ ...form, registro_sanitario_sif: e.target.value.toUpperCase() })} placeholder="Ex: SIF 1929 / DIPOA 007" />
                </div>
                <div>
                  <label className="form-label">Prazo Médio Entrega (dias)</label>
                  <input type="number" min="0" className="form-input" value={form.prazo_entrega_dias} onChange={(e) => setForm({ ...form, prazo_entrega_dias: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">CNAE Principal</label>
                  <input className="form-input" value={form.cnae_principal} onChange={(e) => setForm({ ...form, cnae_principal: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Regime / Situação</label>
                  <input
                    className="form-input"
                    value={form.regime_apuracao}
                    onChange={(e) => setForm({ ...form, regime_apuracao: e.target.value.toUpperCase() })}
                    placeholder={form.situacao_cadastral || 'Ex: SIMPLES NACIONAL'}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvando}>
                  <Save size={16} /> {salvando ? 'Salvando...' : 'Salvar Fornecedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConsultaCnpjModal
        isOpen={cnpjModalOpen}
        onClose={() => setCnpjModalOpen(false)}
        cnpjInicial={modalOpen ? form.cnpj_cpf : ''}
        tipoAlvo="fornecedor"
        onImportar={aplicarDadosCnpjNoForm}
        onCadastrarDireto={cadastrarDiretoPeloCnpj}
      />

      <ModalDialog
        isOpen={confirmDlg.isOpen}
        type={confirmDlg.type || 'confirm'}
        title={confirmDlg.title || 'Apagar Fornecedor'}
        message={confirmDlg.message || ''}
        onClose={() => setConfirmDlg((d) => ({ ...d, isOpen: false, target: null }))}
        confirmLabel={confirmDlg.confirmLabel || 'Confirmar'}
        onConfirm={
          confirmDlg.type === 'confirm' && confirmDlg.target
            ? async () => {
                try {
                  await cadastrosQueries.excluirFornecedor(confirmDlg.target.id)
                  toastSuccess('Fornecedor apagado', 'Cadastro removido definitivamente do registro.')
                  setConfirmDlg((d) => ({ ...d, isOpen: false, target: null }))
                  carregar()
                } catch (err) {
                  setConfirmDlg((d) => ({ ...d, isOpen: false, target: null }))
                  toastError('Exclusão bloqueada', err.message)
                }
              }
            : null
        }
      />
    </div>
  )
}
