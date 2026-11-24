import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Save,
  AlertTriangle,
  Scissors,
  CheckCircle2,
  Ban,
  Star,
  Power,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { cadastrosQueries } from '../queries/cadastros'
import { precosQueries } from '../queries/varejo'
import * as produtosQueries from '../queries/produtos'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalDialog } from '../components/shared/ModalDialog'
import { ConsultaCnpjModal } from '../components/shared/ConsultaCnpjModal'
import { ProdutoSearchSelect, SmartSearchSelect } from '../components/shared/SmartSearchSelect'
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
  telefone: '',
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cep: '',
  cidade: '',
  uf: 'SP',
  icms: 'CONTRIBUINTE',
  vendedor_padrao_id: '',
  forma_pagamento_padrao_id: '',
  local_cobranca_padrao_id: '',
  marchante_padrao: '',
  rota_padrao_nome: '',
  limite_credito: 0,
  tabela_preco_id: '',
  desconto_ativo: 0,
  desconto_max_pct: 0,
  permite_pagamento_entrega: 1,
  bloqueado_financeiro: 0,
  is_padrao: 0,
}

export function Clientes() {
  const { toastSuccess, toastError } = useAppStore()
  const [clientes, setClientes] = useState([])
  const [vendedores, setVendedores] = useState([])
  const [auxiliares, setAuxiliares] = useState({ formasPagamento: [], locaisCobranca: [], marchantes: [] })
  const [rotas, setRotas] = useState([])
  const [tabelasPreco, setTabelasPreco] = useState([])
  const [produtos, setProdutos] = useState([])
  const [loading, setLoading] = useState(true)

  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('ATIVOS')
  const [filtro, setFiltro] = useState('TODOS')

  const [modalOpen, setModalOpen] = useState(false)
  const [cnpjModalOpen, setCnpjModalOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState(FORM_INICIAL)
  const codigoEditadoRef = useRef(false)

  // Modal Especificacoes por Produto (código aux cliente, corte, reclamações)
  const [clienteEspec, setClienteEspec] = useState(null)
  const [especs, setEspecs] = useState([])
  const [loadingEspec, setLoadingEspec] = useState(false)
  const [formEspec, setFormEspec] = useState({
    produto_id: '',
    codigo_aux_cliente: '',
    especificacao_corte: '',
    preco_negociado: '',
    ultima_venda_preco: '',
    alerta_reclamacao: false,
    alerta_descricao: '',
  })

  const [confirmDlg, setConfirmDlg] = useState({
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    confirmLabel: 'Confirmar',
    onConfirm: null,
  })

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [cliRes, vendRes, auxRes, rotRes, tabRes] = await Promise.all([
        cadastrosQueries.listarClientes({ incluirInativos: true }),
        cadastrosQueries.listarVendedores().catch(() => []),
        cadastrosQueries.listarAuxiliares().catch(() => ({ formasPagamento: [], locaisCobranca: [], marchantes: [] })),
        cadastrosQueries.listarRotas().catch(() => []),
        isApiEnabled() ? precosQueries.listarTabelas().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ])
      setClientes(cliRes || [])
      setVendedores(vendRes || [])
      setAuxiliares(auxRes || { formasPagamento: [], locaisCobranca: [], marchantes: [] })
      setRotas(rotRes || [])
      setTabelasPreco(tabRes?.data || [])
    } catch (err) {
      toastError('Erro ao carregar clientes', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregar()
  }, [carregar])

  const contadoresStatus = useMemo(() => {
    const ativos = clientes.filter((c) => Number(c.ativo) !== 0).length
    return { ativos, inativos: clientes.length - ativos, todos: clientes.length }
  }, [clientes])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return clientes.filter((c) => {
      const ativo = Number(c.ativo) !== 0
      if (statusFiltro === 'ATIVOS' && !ativo) return false
      if (statusFiltro === 'INATIVOS' && ativo) return false

      const matchBusca =
        !q ||
        String(c.razao_social || '').toLowerCase().includes(q) ||
        String(c.nome_fantasia || '').toLowerCase().includes(q) ||
        String(c.codigo || '').toLowerCase().includes(q) ||
        String(c.cnpj_cpf || '').toLowerCase().includes(q) ||
        String(c.cidade || '').toLowerCase().includes(q)

      if (!matchBusca) return false
      if (filtro === 'BLOQUEADOS') return Number(c.bloqueado_financeiro) === 1
      if (filtro === 'PGTO_ENTREGA') return Number(c.permite_pagamento_entrega) === 1
      if (filtro === 'COM_ALERTAS') return Number(c.qtd_alertas || 0) > 0
      return true
    })
  }, [clientes, busca, filtro, statusFiltro])

  const marchantePadraoDefault = useMemo(() => {
    const lista = auxiliares.marchantes || []
    return lista.find((m) => Number(m.is_padrao) === 1)?.nome || lista[0]?.nome || 'FRIGODIL'
  }, [auxiliares.marchantes])

  const preencherCodigoAutomaticoSeNovo = useCallback(async () => {
    const codServidor = await obterProximoCodigoDisponivel('cliente', clientes)
    if (!codigoEditadoRef.current) {
      setForm((prev) => (prev.id ? prev : { ...prev, codigo: codServidor }))
    }
  }, [clientes])

  const abrirNovo = () => {
    codigoEditadoRef.current = false
    setForm({
      ...FORM_INICIAL,
      codigo: sugerirProximoCodigoLocal(clientes),
      marchante_padrao: marchantePadraoDefault,
    })
    setModalOpen(true)
    preencherCodigoAutomaticoSeNovo()
  }

  const abrirEditar = (c) => {
    codigoEditadoRef.current = false
    setForm({
      id: c.id,
      codigo: c.codigo || '',
      razao_social: c.razao_social || '',
      nome_fantasia: c.nome_fantasia || '',
      cnpj_cpf: c.cnpj_cpf || '',
      inscricao_estadual: c.inscricao_estadual || '',
      telefone: c.telefone || '',
      endereco: c.endereco || '',
      numero: c.numero || '',
      complemento: c.complemento || '',
      bairro: c.bairro || '',
      cep: c.cep || '',
      cidade: c.cidade || '',
      uf: c.uf || 'SP',
      icms: c.icms || 'CONTRIBUINTE',
      vendedor_padrao_id: c.vendedor_padrao_id || '',
      forma_pagamento_padrao_id: c.forma_pagamento_padrao_id || '',
      local_cobranca_padrao_id: c.local_cobranca_padrao_id || '',
      marchante_padrao: c.marchante_padrao || marchantePadraoDefault,
      rota_padrao_nome: c.rota_padrao_nome || '',
      limite_credito: Number(c.limite_credito || 0),
      tabela_preco_id: c.tabela_preco_id || '',
      desconto_ativo: Number(c.desconto_ativo || 0),
      desconto_max_pct: Number(c.desconto_max_pct || 0),
      permite_pagamento_entrega: Number(c.permite_pagamento_entrega ?? 1),
      bloqueado_financeiro: Number(c.bloqueado_financeiro || 0),
      is_padrao: Number(c.is_padrao || 0),
    })
    setModalOpen(true)
  }

  const handleSalvar = async (e) => {
    e.preventDefault()
    if (!form.razao_social.trim()) {
      return toastError('Campo obrigatório', 'Informe a Razão Social do cliente.')
    }
    const codDigitado = String(form.codigo || '').trim()
    if (form.id && !codDigitado) {
      return toastError('Código obrigatório', 'Informe o código do cliente.')
    }
    if (codDigitado) {
      const dup = encontrarCodigoDuplicadoLocal(clientes, codDigitado, form.id)
      if (dup) {
        const suf = Number(dup.ativo) === 0 ? ' (cadastro inativo no histórico)' : ''
        return toastError('Código duplicado', `Já existe outro cliente (${dup.razao_social}) com o código "${codDigitado}"${suf}.`)
      }
    }
    setSalvando(true)
    try {
      await cadastrosQueries.salvarCliente({
        ...form,
        codigo: codDigitado,
        vendedor_padrao_id: form.vendedor_padrao_id || null,
        forma_pagamento_padrao_id: form.forma_pagamento_padrao_id || null,
        local_cobranca_padrao_id: form.local_cobranca_padrao_id || null,
        tabela_preco_id: form.tabela_preco_id || null,
        desconto_ativo: Number(form.desconto_max_pct || 0) > 0 ? 1 : Number(form.desconto_ativo || 0),
        desconto_max_pct: Number(form.desconto_max_pct || 0),
        limite_credito: Number(form.limite_credito || 0),
      })
      toastSuccess('Cliente salvo', `${form.razao_social.toUpperCase()} salvo com sucesso.`)
      setModalOpen(false)
      await carregar()
    } catch (err) {
      toastError('Erro ao salvar', err.message)
    } finally {
      setSalvando(false)
    }
  }

  const handleAlternarAtivo = async (c) => {
    const ativando = Number(c.ativo) === 0
    try {
      await cadastrosQueries.alterarAtivoCliente(c.id, ativando)
      toastSuccess(
        ativando ? 'Cliente reativado' : 'Cliente inativado',
        ativando
          ? `${c.razao_social} voltou para o catálogo ativo.`
          : `${c.razao_social} foi inativado e permanece no histórico.`,
      )
      await carregar()
    } catch (err) {
      toastError('Erro ao atualizar status', err.message)
    }
  }

  const handleExcluir = (c) => {
    if (c.pode_excluir_definitivo === false) {
      setConfirmDlg({
        isOpen: true,
        type: 'alert',
        title: 'Exclusão Bloqueada',
        message: c.motivo_bloqueio_exclusao || 'Este cliente não atende às regras para ser apagado do registro.',
        confirmLabel: 'Entendi',
        onConfirm: null,
      })
      return
    }
    setConfirmDlg({
      isOpen: true,
      type: 'confirm',
      title: 'Apagar Cliente do Registro',
      message: `Deseja apagar definitivamente "${c.razao_social}" do banco de dados? Esta ação é irreversível.`,
      confirmLabel: 'Sim, apagar do registro',
      onConfirm: async () => {
        try {
          await cadastrosQueries.excluirCliente(c.id)
          toastSuccess('Cliente apagado', `${c.razao_social} foi removido definitivamente do registro.`)
          setConfirmDlg((d) => ({ ...d, isOpen: false }))
          await carregar()
        } catch (err) {
          setConfirmDlg((d) => ({ ...d, isOpen: false }))
          toastError('Exclusão bloqueada', err.message)
        }
      },
    })
  }

  const abrirEspecificacoes = async (c) => {
    setClienteEspec(c)
    setLoadingEspec(true)
    setFormEspec({
      produto_id: '',
      codigo_aux_cliente: '',
      especificacao_corte: '',
      preco_negociado: '',
      ultima_venda_preco: '',
      alerta_reclamacao: false,
      alerta_descricao: '',
    })
    try {
      const [espRes, prodRes] = await Promise.all([
        cadastrosQueries.listarEspecificacoesCliente(c.id),
        produtos.length > 0 ? Promise.resolve(produtos) : produtosQueries.listar().catch(() => []),
      ])
      setEspecs(espRes || [])
      if (prodRes && produtos.length === 0) setProdutos(prodRes)
    } catch (err) {
      toastError('Erro ao carregar especificações', err.message)
    } finally {
      setLoadingEspec(false)
    }
  }

  const handleSalvarEspec = async (e) => {
    e.preventDefault()
    if (!clienteEspec) return
    if (!formEspec.produto_id) return toastError('Produto obrigatório', 'Selecione um corte/produto.')
    try {
      await cadastrosQueries.salvarEspecificacaoCliente(clienteEspec.id, {
        produto_id: formEspec.produto_id,
        codigo_aux_cliente: formEspec.codigo_aux_cliente,
        especificacao_corte: formEspec.especificacao_corte,
        preco_negociado: formEspec.preco_negociado === '' ? null : Number(formEspec.preco_negociado),
        ultima_venda_preco: formEspec.ultima_venda_preco === '' ? null : Number(formEspec.ultima_venda_preco),
        alerta_reclamacao: formEspec.alerta_reclamacao ? 1 : 0,
        alerta_descricao: formEspec.alerta_descricao,
      })
      toastSuccess('Especificação salva', 'Regra do corte vinculada ao cliente.')
      const updated = await cadastrosQueries.listarEspecificacoesCliente(clienteEspec.id)
      setEspecs(updated || [])
      setFormEspec({
        produto_id: '',
        codigo_aux_cliente: '',
        especificacao_corte: '',
        preco_negociado: '',
        ultima_venda_preco: '',
        alerta_reclamacao: false,
        alerta_descricao: '',
      })
      carregar()
    } catch (err) {
      toastError('Erro ao salvar especificação', err.message)
    }
  }

  const handleRemoverEspec = async (especId) => {
    if (!clienteEspec) return
    try {
      await cadastrosQueries.removerEspecificacaoCliente(clienteEspec.id, especId)
      setEspecs((prev) => prev.filter((x) => String(x.id) !== String(especId)))
      toastSuccess('Especificação removida', 'Vínculo removido com sucesso.')
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const aplicarDadosCnpjCliente = (dadosReceita, { existingRegistro } = {}) => {
    const baseExistente = existingRegistro?.id
      ? clientes.find((c) => String(c.id) === String(existingRegistro.id)) || null
      : null

    if (!modalOpen && !baseExistente) {
      codigoEditadoRef.current = false
    }
    const codAtual = modalOpen && !baseExistente ? String(form?.codigo || '').trim() : ''
    const precisaAutoCodigo = !baseExistente && (!modalOpen || (!form?.id && !codAtual)) && !codigoEditadoRef.current
    const codFallback = sugerirProximoCodigoLocal(clientes)

    setForm((prev) => {
      const base = baseExistente
        ? { ...FORM_INICIAL, ...baseExistente, marchante_padrao: baseExistente.marchante_padrao || marchantePadraoDefault }
        : prev?.id || modalOpen
          ? prev
          : { ...FORM_INICIAL, codigo: codFallback, marchante_padrao: marchantePadraoDefault }

      return {
        ...base,
        codigo: !base.id && !String(base.codigo || '').trim() ? codFallback : base.codigo,
        razao_social: dadosReceita.razao_social || base.razao_social,
        nome_fantasia: dadosReceita.nome_fantasia || dadosReceita.razao_social || base.nome_fantasia,
        cnpj_cpf: dadosReceita.cnpj_formatado || dadosReceita.cnpj || base.cnpj_cpf,
        inscricao_estadual: dadosReceita.inscricao_estadual || base.inscricao_estadual,
        telefone: dadosReceita.telefone || base.telefone,
        endereco: dadosReceita.endereco || base.endereco,
        numero: dadosReceita.numero || base.numero,
        complemento: dadosReceita.complemento || base.complemento,
        bairro: dadosReceita.bairro || base.bairro,
        cep: dadosReceita.cep || base.cep,
        cidade: dadosReceita.cidade || base.cidade,
        uf: dadosReceita.uf || base.uf,
      }
    })
    setCnpjModalOpen(false)
    setModalOpen(true)
    if (precisaAutoCodigo) {
      preencherCodigoAutomaticoSeNovo()
    }
    toastSuccess('CNPJ importado ✅', 'Dados da Receita preenchidos no cadastro do cliente.')
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Building2 className="text-primary" size={26} /> Cadastro de Clientes & Especificações
          </h1>
          <p className="page-header__subtitle">
            Regras padrão para pedidos (vendedor, condição de pagamento, banco, marchante, rota) e especificações de corte/alertas por cliente
          </p>
        </div>
        <div className="flex gap-8 flex-wrap">
          <button
            className="btn btn--outline"
            onClick={() => setCnpjModalOpen(true)}
            disabled={!isApiEnabled()}
            title="Consultar CNPJ na Receita Federal e preencher automático"
          >
            <Search size={17} /> Consultar CNPJ
          </button>
          <button className="btn btn--primary" onClick={abrirNovo} disabled={!isApiEnabled()}>
            <Plus size={18} /> Novo Cliente
          </button>
        </div>
      </div>

      <ApiModeRequiredBanner modulo="Clientes Completo & Especificações" />

      <div className="table-container">
        <div className="table-toolbar" style={{ flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 400 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: 36 }}
              placeholder="Buscar código, razão social, CNPJ, cidade..."
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
            <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
            {[
              { id: 'TODOS', label: 'Qualquer Perfil' },
              { id: 'PGTO_ENTREGA', label: 'Pgto na Entrega' },
              { id: 'BLOQUEADOS', label: 'Bloqueados Financeiro' },
              { id: 'COM_ALERTAS', label: 'Com Alertas ⚠️' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`btn btn--sm ${filtro === f.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setFiltro(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="p-24 text-center text-muted">Carregando clientes...</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Cliente / Razão Social</th>
                  <th>UF / Cidade</th>
                  <th>Vendedor Padrão</th>
                  <th>Pgto / Banco Cobrança</th>
                  <th style={{ textAlign: 'right' }}>Limite Créd.</th>
                  <th>Especificações</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 32 }} className="text-muted">
                      Nenhum cliente encontrado.
                    </td>
                  </tr>
                ) : (
                  filtrados.map((c) => (
                    <tr key={c.id}>
                      <td className="td-mono">{c.codigo || '-'}</td>
                      <td>
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{c.razao_social}</span>
                          {Number(c.ativo) === 0 && (
                            <span className="badge badge--warning" style={{ fontSize: 10 }}>
                              Inativo{c.dias_inativo != null ? ` (${c.dias_inativo}d)` : ''}
                            </span>
                          )}
                          {c.tem_contas_financeiras && (
                            <span className="badge badge--danger" style={{ fontSize: 10 }}>
                              Contas a Receber
                            </span>
                          )}
                          {Number(c.is_padrao) === 1 && (
                            <span className="badge badge--info" style={{ fontSize: 10 }}>
                              <Star size={10} /> Padrão
                            </span>
                          )}
                          {Number(c.bloqueado_financeiro) === 1 && (
                            <span className="badge badge--danger" style={{ fontSize: 10 }}>
                              <Ban size={10} /> Bloqueado
                            </span>
                          )}
                        </div>
                        <div className="td-muted">
                          {c.cnpj_cpf || 'Sem CNPJ/CPF'} {c.rota_padrao_nome ? `• Rota: ${c.rota_padrao_nome}` : ''}
                        </div>
                      </td>
                      <td>
                        <div>{c.uf || '-'}</div>
                        <div className="td-muted">{c.cidade || '-'}</div>
                      </td>
                      <td>
                        {c.vendedor_nome ? (
                          <span className="badge badge--ghost">
                            {c.vendedor_sigla ? `(${c.vendedor_sigla}) ` : ''}
                            {c.vendedor_nome}
                          </span>
                        ) : (
                          <span className="td-muted">Não definido</span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{c.forma_pagamento_descricao || '-'}</div>
                        <div className="td-muted">
                          {c.local_cobranca_nome || '-'}
                          {Number(c.permite_pagamento_entrega) === 1 ? ' • Aceita na Entrega' : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }} className="td-mono">
                        R$ {Number(c.limite_credito || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => abrirEspecificacoes(c)}
                          disabled={!isApiEnabled()}
                          title="Gerenciar especificações de corte e alertas"
                        >
                          <Scissors size={14} /> {Number(c.qtd_especificacoes || 0)}
                          {Number(c.qtd_alertas || 0) > 0 && (
                            <span className="badge badge--warning" style={{ marginLeft: 4, fontSize: 10 }}>
                              ⚠️ {c.qtd_alertas}
                            </span>
                          )}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-end gap-6">
                          <button
                            className="btn btn--ghost btn--icon"
                            onClick={() => abrirEditar(c)}
                            disabled={!isApiEnabled()}
                            title="Editar Cliente"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            className={`btn btn--ghost btn--icon ${Number(c.ativo) === 0 ? 'text-success' : 'text-warning'}`}
                            onClick={() => handleAlternarAtivo(c)}
                            disabled={!isApiEnabled()}
                            title={Number(c.ativo) === 0 ? 'Reativar Cliente' : 'Inativar Cliente'}
                          >
                            <Power size={15} />
                          </button>
                          <button
                            className="btn btn--ghost btn--icon text-danger"
                            onClick={() => handleExcluir(c)}
                            disabled={!isApiEnabled()}
                            title={c.motivo_bloqueio_exclusao || 'Apagar definitivamente do registro'}
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

      {/* Modal Cadastro / Edição Cliente */}
      {modalOpen && (
        <div
          className="modal-overlay fade-in"
          style={{ padding: 20, zIndex: 90 }}
        >
          <div className="card" style={{ width: '94vw', maxWidth: 1080, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <h3 className="text-base font-bold">{form.id ? 'Editar Cliente' : 'Novo Cliente'}</h3>
              <button className="btn-icon" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSalvar} style={{ overflowY: 'auto', padding: 20 }} className="flex flex-col gap-16">
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Código Interno (Sistec/ERP)</label>
                  <input
                    className="form-input"
                    value={form.codigo}
                    onChange={(e) => {
                      codigoEditadoRef.current = true
                      setForm({ ...form, codigo: e.target.value })
                    }}
                    placeholder="Automático"
                    title="Gerado automaticamente. Apague para digitar outro código manualmente."
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
                      value={form.cnpj_cpf}
                      placeholder="00.000.000/0000-00"
                      onChange={(e) => {
                        const raw = e.target.value
                        const d = raw.replace(/\D+/g, '')
                        setForm({ ...form, cnpj_cpf: d.length > 11 ? formatarCnpjInput(raw) : raw })
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      onClick={() => setCnpjModalOpen(true)}
                      title="Buscar CNPJ online"
                    >
                      <Search size={14} /> CNPJ
                    </button>
                  </div>
                </div>
                <div>
                  <label className="form-label">Inscrição Estadual</label>
                  <input className="form-input" value={form.inscricao_estadual} onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })} />
                </div>
              </div>

              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Telefone / WhatsApp</label>
                  <input className="form-input" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Cidade</label>
                  <input className="form-input" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="form-label">UF</label>
                  <input className="form-input" maxLength={2} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
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
                  <label className="form-label">CEP</label>
                  <input className="form-input form-input--mono" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
                </div>
              </div>
              <div className="form-grid form-grid--3">
                <div>
                  <label className="form-label">Bairro</label>
                  <input className="form-input" value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value.toUpperCase() })} placeholder="Bairro" />
                </div>
                <div>
                  <label className="form-label">Complemento</label>
                  <input className="form-input" value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value.toUpperCase() })} placeholder="Sala, Galpão..." />
                </div>
                <div>
                  <label className="form-label">Regime ICMS</label>
                  <select className="form-input" value={form.icms} onChange={(e) => setForm({ ...form, icms: e.target.value })}>
                    <option value="CONTRIBUINTE">CONTRIBUINTE ICMS</option>
                    <option value="ISENTO">ISENTO</option>
                    <option value="NAO_CONTRIBUINTE">NÃO CONTRIBUINTE</option>
                  </select>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="text-xs font-bold uppercase text-primary mb-12">Regras Comerciais Automáticas no Pedido</div>
                <div className="form-grid form-grid--3">
                  <div>
                    <label className="form-label">Vendedor Padrão</label>
                    <SmartSearchSelect
                      items={vendedores}
                      value={form.vendedor_padrao_id}
                      onChange={(val) => setForm({ ...form, vendedor_padrao_id: val })}
                      icon="user"
                      getCode={(v) => String(v?.codigo || v?.sigla || '')}
                      getLabel={(v) => String(v?.nome || '')}
                      emptyLabel="-- Nenhum --"
                      placeholder="Pesquisar vendedor..."
                      modalTitle="Selecionar Vendedor Padrão"
                    />
                  </div>
                  <div>
                    <label className="form-label">Forma de Pagamento Padrão</label>
                    <select className="form-input" value={form.forma_pagamento_padrao_id} onChange={(e) => setForm({ ...form, forma_pagamento_padrao_id: e.target.value })}>
                      <option value="">-- Selecionar --</option>
                      {(auxiliares.formasPagamento || []).map((fp) => (
                        <option key={fp.id} value={fp.id}>
                          {fp.descricao}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Local de Cobrança / Banco</label>
                    <select className="form-input" value={form.local_cobranca_padrao_id} onChange={(e) => setForm({ ...form, local_cobranca_padrao_id: e.target.value })}>
                      <option value="">-- Selecionar --</option>
                      {(auxiliares.locaisCobranca || []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-grid form-grid--3 mt-12">
                  <div>
                    <label className="form-label">Marchante Padrão</label>
                    <select className="form-input" value={form.marchante_padrao || marchantePadraoDefault} onChange={(e) => setForm({ ...form, marchante_padrao: e.target.value })}>
                      {(auxiliares.marchantes || []).length === 0 ? (
                        <option value="FRIGODIL">001 — FRIGODIL</option>
                      ) : (
                        <>
                          {(auxiliares.marchantes || []).map((m) => (
                            <option key={m.id} value={m.nome}>
                              {m.codigo} — {m.nome}
                            </option>
                          ))}
                          {form.marchante_padrao &&
                            !(auxiliares.marchantes || []).some((m) => m.nome === form.marchante_padrao) && (
                              <option value={form.marchante_padrao}>{form.marchante_padrao}</option>
                            )}
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Rota Padrão</label>
                    <input
                      list="rotas-sugestoes"
                      className="form-input"
                      value={form.rota_padrao_nome}
                      onChange={(e) => setForm({ ...form, rota_padrao_nome: e.target.value.toUpperCase() })}
                      placeholder="Ex: CAMPINAS"
                    />
                    <datalist id="rotas-sugestoes">
                      {rotas.map((r) => (
                        <option key={r.id} value={r.nome} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="form-label">Limite de Crédito (R$)</label>
                    <input type="number" step="0.01" className="form-input" value={form.limite_credito} onChange={(e) => setForm({ ...form, limite_credito: e.target.value })} />
                  </div>
                </div>

                <div className="form-grid form-grid--2 mt-12">
                  <div>
                    <label className="form-label">Tabela de Preço Padrão (Atacado / Contrato)</label>
                    <select
                      className="form-input"
                      value={form.tabela_preco_id}
                      onChange={(e) => setForm({ ...form, tabela_preco_id: e.target.value })}
                    >
                      <option value="">-- Usar Padrão Atacado / Base --</option>
                      {tabelasPreco.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.codigo} — {t.nome} ({t.finalidade})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Desconto Máximo Negociado (%)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="form-input"
                      value={form.desconto_max_pct}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          desconto_max_pct: e.target.value,
                          desconto_ativo: Number(e.target.value || 0) > 0 ? 1 : 0,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex gap-16 flex-wrap mt-16">
                  <label className="flex items-center gap-8 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={Number(form.permite_pagamento_entrega) === 1}
                      onChange={(e) => setForm({ ...form, permite_pagamento_entrega: e.target.checked ? 1 : 0 })}
                    />
                    Permite Pagamento na Entrega (Trava Motorista)
                  </label>
                  <label className="flex items-center gap-8 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={Number(form.bloqueado_financeiro) === 1}
                      onChange={(e) => setForm({ ...form, bloqueado_financeiro: e.target.checked ? 1 : 0 })}
                    />
                    <span className="text-danger font-bold">Bloqueio Financeiro / Inadimplência</span>
                  </label>
                  <label className="flex items-center gap-8 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={Number(form.is_padrao) === 1}
                      onChange={(e) => setForm({ ...form, is_padrao: e.target.checked ? 1 : 0 })}
                    />
                    Cliente Padrão
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-8 pt-12 border-t border-border">
                <button type="button" className="btn btn--ghost" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvando}>
                  <Save size={16} /> {salvando ? 'Salvando...' : 'Salvar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Especificacoes de Corte & Alertas por Cliente */}
      {clienteEspec && (
        <div
          className="modal-overlay fade-in"
          style={{ padding: 20, zIndex: 95 }}
        >
          <div className="card" style={{ width: '94vw', maxWidth: 1040, maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, background: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between p-16" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="text-base font-bold flex items-center gap-8">
                  <Scissors size={18} className="text-primary" /> Especificações de Corte & Alertas — {clienteEspec.razao_social}
                </h3>
                <p className="text-xs text-muted mt-4">
                  Código auxiliar do cliente, padrão de corte, último preço vendido e avisos de reclamações anteriores
                </p>
              </div>
              <button className="btn-icon" onClick={() => setClienteEspec(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: 20 }} className="flex flex-col gap-16">
              <form onSubmit={handleSalvarEspec} className="card" style={{ background: 'var(--bg-2)', padding: 14 }}>
                <div className="form-grid form-grid--3">
                  <div>
                    <label className="form-label">Produto / Corte *</label>
                    <ProdutoSearchSelect
                      produtos={produtos}
                      value={formEspec.produto_id}
                      onChange={(val) => setFormEspec({ ...formEspec, produto_id: val })}
                      placeholder="Pesquisar produto/corte (cód., descrição, EAN)..."
                      modalTitle="Selecionar Produto / Corte do Cliente"
                    />
                  </div>
                  <div>
                    <label className="form-label">Código Auxiliar no Cliente</label>
                    <input className="form-input" value={formEspec.codigo_aux_cliente} onChange={(e) => setFormEspec({ ...formEspec, codigo_aux_cliente: e.target.value })} placeholder="Ex: 5951" />
                  </div>
                  <div>
                    <label className="form-label">Especificação / Padrão do Corte</label>
                    <input className="form-input" value={formEspec.especificacao_corte} onChange={(e) => setFormEspec({ ...formEspec, especificacao_corte: e.target.value })} placeholder="Ex: 230 a 250g, congelado 4x1" />
                  </div>
                </div>
                <div className="form-grid form-grid--3 mt-12">
                  <div>
                    <label className="form-label">Preço Negociado (R$/kg)</label>
                    <input type="number" step="0.01" className="form-input" value={formEspec.preco_negociado} onChange={(e) => setFormEspec({ ...formEspec, preco_negociado: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Última Venda (R$/kg)</label>
                    <input type="number" step="0.01" className="form-input" value={formEspec.ultima_venda_preco} onChange={(e) => setFormEspec({ ...formEspec, ultima_venda_preco: e.target.value })} />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-8 cursor-pointer text-sm mb-8">
                      <input
                        type="checkbox"
                        checked={formEspec.alerta_reclamacao}
                        onChange={(e) => setFormEspec({ ...formEspec, alerta_reclamacao: e.target.checked })}
                      />
                      <span className="text-warning font-bold">⚠️ Alerta de Reclamação Anterior</span>
                    </label>
                  </div>
                </div>
                {formEspec.alerta_reclamacao && (
                  <div className="mt-12">
                    <label className="form-label">Descrição do Alerta (aparecerá na OP / Mapa / Pedido)</label>
                    <input className="form-input" value={formEspec.alerta_descricao} onChange={(e) => setFormEspec({ ...formEspec, alerta_descricao: e.target.value })} placeholder="Ex: Exige porções uniformes - reclamação anterior em Ossobuco" />
                  </div>
                )}
                <div className="flex justify-end mt-12">
                  <button type="submit" className="btn btn--primary btn--sm">
                    <Plus size={14} /> Vincular / Atualizar Regra
                  </button>
                </div>
              </form>

              {loadingEspec ? (
                <div className="text-center text-muted p-16">Carregando especificações...</div>
              ) : especs.length === 0 ? (
                <div className="text-center text-muted p-20">Nenhuma especificação cadastrada para este cliente ainda.</div>
              ) : (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Cód. Aux</th>
                        <th>Especificação do Corte</th>
                        <th style={{ textAlign: 'right' }}>Preços (Neg. / Últ.)</th>
                        <th>Alerta</th>
                        <th style={{ textAlign: 'right' }}>Remover</th>
                      </tr>
                    </thead>
                    <tbody>
                      {especs.map((esp) => (
                        <tr key={esp.id}>
                          <td>
                            <div className="font-bold">{esp.produto_descricao}</div>
                            <div className="td-mono">{esp.produto_codigo}</div>
                          </td>
                          <td className="td-mono">{esp.codigo_aux_cliente || '-'}</td>
                          <td>{esp.especificacao_corte || '-'}</td>
                          <td style={{ textAlign: 'right' }} className="td-mono">
                            {esp.preco_negociado != null ? `R$ ${Number(esp.preco_negociado).toFixed(2)}` : '-'} /{' '}
                            {esp.ultima_venda_preco != null ? `R$ ${Number(esp.ultima_venda_preco).toFixed(2)}` : '-'}
                          </td>
                          <td>
                            {Number(esp.alerta_reclamacao) === 1 ? (
                              <span className="badge badge--warning">⚠️ {esp.alerta_descricao || 'Reclamação'}</span>
                            ) : (
                              <span className="badge badge--success">
                                <CheckCircle2 size={12} /> Normal
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn--ghost btn--icon text-danger" onClick={() => handleRemoverEspec(esp.id)}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConsultaCnpjModal
        isOpen={cnpjModalOpen}
        onClose={() => setCnpjModalOpen(false)}
        cnpjInicial={modalOpen ? form.cnpj_cpf : ''}
        tipoAlvo="cliente"
        onImportar={aplicarDadosCnpjCliente}
      />

      <ModalDialog
        isOpen={confirmDlg.isOpen}
        type={confirmDlg.type || 'confirm'}
        title={confirmDlg.title}
        message={confirmDlg.message}
        onConfirm={confirmDlg.onConfirm}
        onClose={() => setConfirmDlg((d) => ({ ...d, isOpen: false }))}
        confirmLabel={confirmDlg.confirmLabel || 'Confirmar'}
      />
    </div>
  )
}
