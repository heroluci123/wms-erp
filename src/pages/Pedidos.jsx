import React, { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList,
  Plus,
  Search,
  Printer,
  Truck,
  CheckCircle2,
  Edit3,
  Trash2,
  Send,
  Eye,
  X,
  AlertTriangle,
  ShieldAlert,
  Package,
  RefreshCw
} from 'lucide-react'
import { pedidosQueries } from '../queries/pedidos'
import * as saidaQueries from '../queries/saida'
import { useAppStore } from '../store/appStore'
import { FolhaPedidoPrint } from '../components/shared/FolhaPedidoPrint'
import { RomaneioEmbarquePrint } from '../components/shared/RomaneioEmbarquePrint'

const STATUS_BADGE = {
  RASCUNHO: { label: 'Rascunho', cls: 'badge-neutral' },
  LIBERADO: { label: 'Liberado p/ Separação', cls: 'badge-info' },
  EM_SEPARACAO: { label: 'Em Separação', cls: 'badge-warning' },
  AGUARDANDO_CONFERENCIA: { label: 'Separação Finalizada', cls: 'badge-purple' },
  EM_CONFERENCIA: { label: 'Em Conferência', cls: 'badge-warning' },
  EXPEDIDO: { label: 'Expedido', cls: 'badge-success' },
  CANCELADO: { label: 'Cancelado', cls: 'badge-danger' }
}

const fmtKg = (v) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
const fmtData = (d) => {
  if (!d) return '-'
  const s = String(d).split('T')[0].split(' ')[0]
  const p = s.split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}
const fmtDataHora = (d) => {
  if (!d) return '-'
  const raw = String(d)
  const utc = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const dt = new Date(utc)
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleString('pt-BR')
}

export function Pedidos() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const podeGerenciarPedidos = Boolean(
    operador &&
      (Number(operador.is_adm) === 1 || operador.perfil === 'gestor' || operador.permissoes?.pedidos)
  )

  const [aba, setAba] = useState('GERENCIADOR') // 'GERENCIADOR' | 'FORM'
  const [loading, setLoading] = useState(false)
  const [pedidos, setPedidos] = useState([])
  const [produtos, setProdutos] = useState([])

  // Filtros do Gerenciador
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  // Formulário Novo / Editar Pedido
  const [editId, setEditId] = useState(null)
  const [editCodigo, setEditCodigo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [cliente, setCliente] = useState('PAVAN')
  const [previsaoEntrega, setPrevisaoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [itensForm, setItensForm] = useState([])

  // Seletor para adicionar item
  const [buscaProduto, setBuscaProduto] = useState('')
  const [produtoSelecionadoId, setProdutoSelecionadoId] = useState('')
  const [kgItemInput, setKgItemInput] = useState('')
  const [cxItemInput, setCxItemInput] = useState('')
  const [obsItemInput, setObsItemInput] = useState('')

  // Modais de detalhes & impressão
  const [pedidoDetalhe, setPedidoDetalhe] = useState(null)
  const [printPedido, setPrintPedido] = useState(null)
  const [printRomaneio, setPrintRomaneio] = useState(null)

  const carregarDados = async () => {
    setLoading(true)
    try {
      const [listaPed, listaProd] = await Promise.all([
        pedidosQueries.listarPedidos({
          status: filtroStatus,
          busca: filtroBusca,
          dataInicio: dataInicio || null,
          dataFim: dataFim || null
        }),
        pedidosQueries.listarSaldosProdutosParaPedido()
      ])
      setPedidos(listaPed)
      setProdutos(listaProd)
    } catch (err) {
      toastError('Erro ao carregar pedidos: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (podeGerenciarPedidos) {
      carregarDados()
    }
  }, [podeGerenciarPedidos, filtroStatus, dataInicio, dataFim])

  const produtosFiltrados = useMemo(() => {
    const q = buscaProduto.trim().toLowerCase()
    if (!q) return produtos
    return produtos.filter(
      (p) =>
        String(p.descricao || '').toLowerCase().includes(q) ||
        String(p.codigo || '').toLowerCase().includes(q) ||
        String(p.ean || '').toLowerCase().includes(q)
    )
  }, [produtos, buscaProduto])

  const kpis = useMemo(() => {
    return {
      liberados: pedidos.filter((p) => p.status === 'LIBERADO').length,
      emSeparacao: pedidos.filter((p) => p.status === 'EM_SEPARACAO').length,
      emConferencia: pedidos.filter((p) => ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA'].includes(p.status)).length,
      expedidos: pedidos.filter((p) => p.status === 'EXPEDIDO').length
    }
  }, [pedidos])

  const resetarFormulario = () => {
    setEditId(null)
    setEditCodigo('')
    setTitulo('')
    setCliente('PAVAN')
    setPrevisaoEntrega('')
    setObservacoes('')
    setItensForm([])
    setBuscaProduto('')
    setProdutoSelecionadoId('')
    setKgItemInput('')
    setCxItemInput('')
    setObsItemInput('')
  }

  const abrirNovoPedido = () => {
    resetarFormulario()
    setAba('FORM')
  }

  const abrirEditarPedido = async (pedId) => {
    try {
      const ped = await pedidosQueries.obterPedido(pedId)
      if (!ped) return toastError('Pedido não encontrado.')
      if (!['RASCUNHO', 'LIBERADO'].includes(ped.status)) {
        return toastWarning('Somente pedidos em Rascunho ou Liberado podem ser editados.')
      }
      setEditId(ped.id)
      setEditCodigo(ped.codigo)
      setTitulo(ped.titulo || '')
      setCliente(ped.cliente || 'PAVAN')
      setPrevisaoEntrega(ped.previsao_entrega ? String(ped.previsao_entrega).slice(0, 10) : '')
      setObservacoes(ped.observacoes || '')
      setItensForm(
        (ped.itens || []).map((it) => ({
          produto_id: it.produto_id,
          produto_codigo: it.produto_codigo,
          produto_descricao: it.produto_descricao,
          saldo_kg: Number(it.estoque_disponivel_kg || 0),
          qtd_caixas_estoque: Number(it.estoque_disponivel_caixas || 0),
          qtd_kg_solicitada: String(it.qtd_kg_solicitada),
          qtd_caixas_solicitada: it.qtd_caixas_solicitada != null ? String(it.qtd_caixas_solicitada) : '',
          observacao: it.observacao || ''
        }))
      )
      setAba('FORM')
    } catch (err) {
      toastError('Erro ao carregar pedido para edição: ' + err.message)
    }
  }

  const handleAdicionarItem = () => {
    const pid = Number(produtoSelecionadoId)
    const kg = Number(String(kgItemInput).replace(',', '.'))
    const cx = cxItemInput.trim() ? Number(String(cxItemInput).replace(',', '.')) : ''

    if (!pid) return toastWarning('Selecione um produto do cadastro.')
    if (!Number.isFinite(kg) || kg <= 0) return toastWarning('Informe a quantidade em kg maior que zero.')

    const prod = produtos.find((p) => Number(p.id) === pid)
    if (!prod) return toastError('Produto inválido.')

    if (Number(prod.saldo_kg || 0) < kg) {
      toastWarning(
        `Atenção: "${prod.descricao}" possui ${fmtKg(prod.saldo_kg)} disponível no estoque atual (solicitado ${fmtKg(kg)}). Item adicionado mesmo assim.`
      )
    }

    setItensForm((prev) => {
      const idx = prev.findIndex((i) => Number(i.produto_id) === pid)
      if (idx >= 0) {
        const next = [...prev]
        const novoKg = Number(next[idx].qtd_kg_solicitada || 0) + kg
        const novoCx =
          cx !== '' || next[idx].qtd_caixas_solicitada !== ''
            ? String((Number(next[idx].qtd_caixas_solicitada || 0) + Number(cx || 0)) || '')
            : ''
        next[idx] = {
          ...next[idx],
          qtd_kg_solicitada: String(Number(novoKg.toFixed(3))),
          qtd_caixas_solicitada: novoCx,
          observacao: obsItemInput.trim() || next[idx].observacao
        }
        return next
      }
      return [
        ...prev,
        {
          produto_id: prod.id,
          produto_codigo: prod.codigo,
          produto_descricao: prod.descricao,
          saldo_kg: Number(prod.saldo_kg || 0),
          qtd_caixas_estoque: Number(prod.qtd_caixas || 0),
          qtd_kg_solicitada: String(Number(kg.toFixed(3))),
          qtd_caixas_solicitada: cx !== '' ? String(cx) : '',
          observacao: obsItemInput.trim()
        }
      ]
    })

    setProdutoSelecionadoId('')
    setKgItemInput('')
    setCxItemInput('')
    setObsItemInput('')
  }

  const handleSalvarPedido = async (liberar) => {
    if (!titulo.trim()) return toastWarning('Informe o Título do Pedido (será impresso no Romaneio de Embarque).')
    if (itensForm.length === 0) return toastWarning('Adicione pelo menos 1 item ao pedido.')

    const payloadItens = itensForm.map((i) => ({
      produto_id: i.produto_id,
      qtd_kg_solicitada: Number(String(i.qtd_kg_solicitada).replace(',', '.')),
      qtd_caixas_solicitada: i.qtd_caixas_solicitada
        ? Number(String(i.qtd_caixas_solicitada).replace(',', '.'))
        : null,
      observacao: i.observacao || ''
    }))

    setLoading(true)
    try {
      if (editId) {
        await pedidosQueries.atualizarPedido({
          id: editId,
          titulo,
          cliente,
          previsao_entrega: previsaoEntrega || null,
          observacoes,
          itens: payloadItens,
          liberar
        })
        toastSuccess(
          liberar
            ? `Pedido ${editCodigo} atualizado e liberado para Separação!`
            : `Rascunho do pedido ${editCodigo} atualizado.`
        )
      } else {
        const res = await pedidosQueries.criarPedido({
          titulo,
          cliente,
          previsao_entrega: previsaoEntrega || null,
          observacoes,
          itens: payloadItens,
          operador,
          liberar
        })
        toastSuccess(
          liberar
            ? `Pedido ${res.codigo} criado e enviado para Saída de Materiais!`
            : `Pedido ${res.codigo} salvo como rascunho.`
        )
      }
      resetarFormulario()
      setAba('GERENCIADOR')
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLiberar = async (ped) => {
    try {
      await pedidosQueries.liberarPedido(ped.id)
      toastSuccess(`Pedido ${ped.codigo} liberado para separação!`)
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleCancelar = async (ped) => {
    const msg =
      ped.total_caixas_separadas > 0
        ? `O pedido ${ped.codigo} possui ${ped.total_caixas_separadas} caixa(s) já reservadas na separação. Ao cancelar, todas voltarão para DISPONIVEL no estoque. Confirma o cancelamento?`
        : `Deseja cancelar o pedido ${ped.codigo} ("${ped.titulo}")?`
    if (!window.confirm(msg)) return

    try {
      await pedidosQueries.cancelarPedido(ped.id, operador)
      toastSuccess(`Pedido ${ped.codigo} cancelado.`)
      await carregarDados()
    } catch (err) {
      toastError(err.message)
    }
  }

  const handleVerDetalhes = async (pedId) => {
    try {
      const det = await pedidosQueries.obterPedido(pedId)
      setPedidoDetalhe(det)
    } catch (err) {
      toastError('Erro ao carregar detalhes: ' + err.message)
    }
  }

  const handleImprimirFolhaPedido = async (pedId) => {
    try {
      const det = await pedidosQueries.obterPedido(pedId)
      setPrintPedido(det)
    } catch (err) {
      toastError('Erro ao preparar impressão: ' + err.message)
    }
  }

  const handleImprimirRomaneioEmbarque = async (ped) => {
    if (!ped.romaneio_id) {
      return toastWarning('Este pedido ainda não possui separação iniciada.')
    }
    if (['RASCUNHO', 'LIBERADO', 'EM_SEPARACAO'].includes(ped.status)) {
      return toastWarning('Finalize a separação na aba Saída de Materiais para emitir o Romaneio de Embarque.')
    }
    try {
      const det = await saidaQueries.detalhesRomaneio(ped.romaneio_id)
      if (!det) return toastError('Romaneio vinculado não encontrado.')
      setPrintRomaneio(det)
    } catch (err) {
      toastError('Erro ao carregar romaneio: ' + err.message)
    }
  }

  if (!podeGerenciarPedidos) {
    return (
      <div className="page-container">
        <div className="card" style={{ maxWidth: '580px', margin: '40px auto', textAlign: 'center', padding: '32px' }}>
          <ShieldAlert size={48} className="text-warning" style={{ margin: '0 auto 12px' }} />
          <h2 style={{ marginBottom: '8px' }}>Acesso Restrito à Gerência / Administração</h2>
          <p className="text-muted">
            A criação e o gerenciamento de Pedidos são permitidos apenas para usuários Administradores ou da Gerência.
            Para separar pedidos liberados, acesse <strong>Saída de Materiais</strong>.
          </p>
        </div>
      </div>
    )
  }

  const totalFormKg = itensForm.reduce((s, i) => s + Number(String(i.qtd_kg_solicitada).replace(',', '.') || 0), 0)

  return (
    <div className="page-container">
      {/* Cabeçalho */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ClipboardList size={26} /> Pedidos &amp; Programação de Embarque
          </h1>
          <p className="page-subtitle">
            Crie pedidos com os cortes solicitados para liberar automaticamente na Separação (Saída de Materiais) e emitir Folha do Pedido / Romaneio.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${aba === 'GERENCIADOR' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAba('GERENCIADOR')}
          >
            <ClipboardList size={16} /> Gerenciador de Pedidos
          </button>
          <button
            type="button"
            className={`btn ${aba === 'FORM' ? 'btn-primary' : 'btn-success'}`}
            onClick={abrirNovoPedido}
          >
            <Plus size={16} /> Novo Pedido
          </button>
        </div>
      </div>

      {aba === 'GERENCIADOR' && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Liberados p/ Separação</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#38bdf8' }}>{kpis.liberados}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Em Separação na Câmara</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#f59e0b' }}>{kpis.emSeparacao}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Prontos / Em Conferência</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#a78bfa' }}>{kpis.emConferencia}</div>
            </div>
            <div className="card" style={{ padding: '14px' }}>
              <div className="text-muted text-xs">Pedidos Expedidos</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#22c55e' }}>{kpis.expedidos}</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="card" style={{ marginBottom: '16px', padding: '14px' }}>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                carregarDados()
              }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}
            >
              <div style={{ flex: '1 1 240px' }}>
                <label className="form-label">Buscar Pedido / Título / Cliente</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-input"
                    placeholder="PED-0001, Título, PAVAN..."
                    value={filtroBusca}
                    onChange={(e) => setFiltroBusca(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ flex: '0 1 210px' }}>
                <label className="form-label">Status</label>
                <select className="form-input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                  <option value="TODOS">Todos os Status</option>
                  <option value="RASCUNHO">Rascunho</option>
                  <option value="LIBERADO">Liberado p/ Separação</option>
                  <option value="EM_SEPARACAO">Em Separação</option>
                  <option value="AGUARDANDO_CONFERENCIA">Separação Finalizada</option>
                  <option value="EM_CONFERENCIA">Em Conferência</option>
                  <option value="EXPEDIDO">Expedido</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </div>
              <div>
                <label className="form-label">De</label>
                <input type="date" className="form-input" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Até</label>
                <input type="date" className="form-input" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <Search size={15} /> Filtrar
              </button>
              <button type="button" className="btn btn-secondary" onClick={carregarDados} disabled={loading}>
                <RefreshCw size={15} /> Atualizar
              </button>
            </form>
          </div>

          {/* Lista */}
          <div className="card">
            {pedidos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }} className="text-muted">
                <Package size={40} style={{ opacity: 0.4, margin: '0 auto 10px' }} />
                <div>Nenhum pedido encontrado para os filtros atuais.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Título (Romaneio) / Cliente</th>
                      <th>Status</th>
                      <th>Romaneio</th>
                      <th style={{ textAlign: 'right' }}>Pedido</th>
                      <th style={{ textAlign: 'right' }}>Separado</th>
                      <th>Conferência</th>
                      <th>Previsão</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((ped) => {
                      const st = STATUS_BADGE[ped.status] || { label: ped.status, cls: 'badge-neutral' }
                      const pct =
                        Number(ped.total_kg_solicitado) > 0
                          ? Math.min(100, Math.round((Number(ped.total_kg_separado) / Number(ped.total_kg_solicitado)) * 100))
                          : 0
                      const podeImprimirRomaneio =
                        Boolean(ped.romaneio_id) &&
                        ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(ped.status)

                      return (
                        <tr key={ped.id}>
                          <td className="font-mono font-bold">{ped.codigo}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{ped.titulo}</div>
                            <div className="text-muted text-xs">
                              {ped.cliente || 'PAVAN'} • Criado em {fmtDataHora(ped.created_at)} por {ped.criado_por_nome || '-'}
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="font-mono">
                            {ped.romaneio_codigo ? (
                              <span style={{ fontWeight: 700 }}>{ped.romaneio_codigo}</span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>
                            {fmtKg(ped.total_kg_solicitado)}
                            <div className="text-muted text-xs">{ped.qtd_itens} produto(s)</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700 }}>
                              {fmtKg(ped.total_kg_separado)} ({ped.total_caixas_separadas} cx)
                            </div>
                            <div style={{ width: '100px', height: '5px', background: '#1e293b', borderRadius: '999px', marginLeft: 'auto', marginTop: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#22c55e' : '#38bdf8' }} />
                            </div>
                          </td>
                          <td>
                            {ped.total_caixas_separadas > 0 ? (
                              <span className="text-xs font-mono">
                                {ped.qtd_conferidas}/{ped.total_caixas_separadas} cx
                              </span>
                            ) : (
                              <span className="text-muted text-xs">-</span>
                            )}
                          </td>
                          <td>{fmtData(ped.previsao_entrega)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                title="Ver detalhes do pedido"
                                onClick={() => handleVerDetalhes(ped.id)}
                              >
                                <Eye size={14} /> Detalhes
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                title="Imprimir Folha do Pedido"
                                onClick={() => handleImprimirFolhaPedido(ped.id)}
                              >
                                <Printer size={14} /> Folha Pedido
                              </button>
                              {podeImprimirRomaneio && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  title="Imprimir Romaneio de Embarque"
                                  onClick={() => handleImprimirRomaneioEmbarque(ped)}
                                >
                                  <Truck size={14} /> Romaneio
                                </button>
                              )}
                              {ped.status === 'RASCUNHO' && (
                                <button
                                  type="button"
                                  className="btn btn-success btn-sm"
                                  title="Liberar para Separação"
                                  onClick={() => handleLiberar(ped)}
                                >
                                  <Send size={14} /> Liberar
                                </button>
                              )}
                              {['RASCUNHO', 'LIBERADO'].includes(ped.status) && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  title="Editar Pedido"
                                  onClick={() => abrirEditarPedido(ped.id)}
                                >
                                  <Edit3 size={14} /> Editar
                                </button>
                              )}
                              {!['EXPEDIDO', 'CANCELADO'].includes(ped.status) && (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  title="Cancelar Pedido"
                                  onClick={() => handleCancelar(ped)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {aba === 'FORM' && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0 }}>{editId ? `Editando Pedido ${editCodigo}` : 'Novo Pedido de Saída'}</h2>
              <p className="text-muted text-xs" style={{ marginTop: '4px' }}>
                Sem valores financeiros por enquanto — defina os produtos e o peso solicitado (kg) para separação na câmara.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                resetarFormulario()
                setAba('GERENCIADOR')
              }}
            >
              Voltar ao Gerenciador
            </button>
          </div>

          {/* Dados principais */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Título do Pedido (sai no Romaneio de Embarque) *</label>
              <input
                className="form-input"
                placeholder="Ex: Carga PAVAN Terça-feira / Pedido Lote 45"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Cliente / Destino</label>
              <input
                className="form-input"
                placeholder="PAVAN"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Previsão de Coleta</label>
              <input
                type="date"
                className="form-input"
                value={previsaoEntrega}
                onChange={(e) => setPrevisaoEntrega(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label className="form-label">Observações do Pedido</label>
            <input
              className="form-input"
              placeholder="Instruções especiais de separação, horário de coleta, etc."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>

          {/* Adicionar item */}
          <div style={{ background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: '8px', padding: '14px', marginBottom: '18px' }}>
            <div style={{ fontWeight: 700, marginBottom: '10px', fontSize: '14px' }}>Adicionar Item do Cadastro de Produtos</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 120px 110px 1fr auto', gap: '10px', alignItems: 'end' }}>
              <div>
                <label className="form-label">Filtrar produto</label>
                <input
                  className="form-input"
                  placeholder="Código ou nome..."
                  value={buscaProduto}
                  onChange={(e) => setBuscaProduto(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Produto *</label>
                <select
                  className="form-input"
                  value={produtoSelecionadoId}
                  onChange={(e) => setProdutoSelecionadoId(e.target.value)}
                >
                  <option value="">-- Selecione um produto --</option>
                  {produtosFiltrados.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo ? `[${p.codigo}] ` : ''}
                      {p.descricao} — Disp: {Number(p.saldo_kg || 0).toFixed(2)} kg ({p.qtd_caixas} cx)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Qtd (kg) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="form-input"
                  placeholder="Ex: 40"
                  value={kgItemInput}
                  onChange={(e) => setKgItemInput(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Cx Prev.</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="form-input"
                  placeholder="Opcional"
                  value={cxItemInput}
                  onChange={(e) => setCxItemInput(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Obs. item</label>
                <input
                  className="form-input"
                  placeholder="Opcional"
                  value={obsItemInput}
                  onChange={(e) => setObsItemInput(e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-primary" onClick={handleAdicionarItem}>
                <Plus size={16} /> Adicionar
              </button>
            </div>
          </div>

          {/* Lista de itens */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong>Itens do Pedido ({itensForm.length})</strong>
              <span className="font-mono font-bold">Total Solicitado: {fmtKg(totalFormKg)}</span>
            </div>

            {itensForm.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '20px', textAlign: 'center', border: '1px dashed rgba(148, 163, 184, 0.3)', borderRadius: '6px' }}>
                Nenhum item adicionado ainda. Use o formulário acima para incluir os produtos solicitados.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Saldo em Estoque</th>
                      <th style={{ width: '140px' }}>Kg Solicitado *</th>
                      <th style={{ width: '110px' }}>Cx Previstas</th>
                      <th>Obs.</th>
                      <th style={{ textAlign: 'right' }}>Remover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensForm.map((item, idx) => {
                      const kgNum = Number(String(item.qtd_kg_solicitada).replace(',', '.') || 0)
                      const abaixoEstoque = kgNum > Number(item.saldo_kg || 0)
                      return (
                        <tr key={item.produto_id}>
                          <td className="font-mono">{item.produto_codigo || '-'}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{item.produto_descricao}</div>
                            {abaixoEstoque && (
                              <div style={{ color: '#f59e0b', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                <AlertTriangle size={12} /> Solicitado acima do estoque atual ({fmtKg(item.saldo_kg)})
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            {fmtKg(item.saldo_kg)} ({item.qtd_caixas_estoque} cx)
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              className="form-input"
                              value={item.qtd_kg_solicitada}
                              onChange={(e) => {
                                const v = e.target.value
                                setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, qtd_kg_solicitada: v } : r)))
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              className="form-input"
                              value={item.qtd_caixas_solicitada}
                              onChange={(e) => {
                                const v = e.target.value
                                setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, qtd_caixas_solicitada: v } : r)))
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="form-input"
                              value={item.observacao}
                              onChange={(e) => {
                                const v = e.target.value
                                setItensForm((prev) => prev.map((r, i) => (i === idx ? { ...r, observacao: v } : r)))
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => setItensForm((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => handleSalvarPedido(false)}>
              Salvar como Rascunho
            </button>
            <button type="button" className="btn btn-success" disabled={loading} onClick={() => handleSalvarPedido(true)}>
              <Send size={16} /> Liberar Pedido para Separação
            </button>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Pedido */}
      {pedidoDetalhe && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.78)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div className="card" style={{ width: '920px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  {pedidoDetalhe.codigo} — {pedidoDetalhe.titulo}
                </h2>
                <div className="text-muted text-xs" style={{ marginTop: '4px' }}>
                  Cliente: {pedidoDetalhe.cliente} • Status:{' '}
                  <strong>{STATUS_BADGE[pedidoDetalhe.status]?.label || pedidoDetalhe.status}</strong>
                  {pedidoDetalhe.romaneio_codigo ? ` • Romaneio: ${pedidoDetalhe.romaneio_codigo}` : ''}
                </div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPedidoDetalhe(null)}>
                <X size={16} /> Fechar
              </button>
            </div>

            <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>Itens Solicitados × Separados</h3>
            <table className="table" style={{ marginBottom: '16px' }}>
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Produto</th>
                  <th style={{ textAlign: 'right' }}>Pedido</th>
                  <th style={{ textAlign: 'right' }}>Separado</th>
                  <th style={{ textAlign: 'center' }}>Caixas</th>
                  <th style={{ textAlign: 'center' }}>Conferidas</th>
                </tr>
              </thead>
              <tbody>
                {(pedidoDetalhe.itens || []).map((it) => (
                  <tr key={it.id}>
                    <td className="font-mono">{it.produto_codigo || '-'}</td>
                    <td style={{ fontWeight: 700 }}>{it.produto_descricao}</td>
                    <td style={{ textAlign: 'right' }}>{fmtKg(it.qtd_kg_solicitada)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtKg(it.kg_separado)}</td>
                    <td style={{ textAlign: 'center' }}>{it.caixas_separadas} cx</td>
                    <td style={{ textAlign: 'center' }}>{it.caixas_conferidas}/{it.caixas_separadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {pedidoDetalhe.caixas?.length > 0 && (
              <>
                <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>
                  Caixas Separadas ({pedidoDetalhe.caixas.length})
                </h3>
                <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>EAN Caixa</th>
                        <th>Lote</th>
                        <th>Validade</th>
                        <th style={{ textAlign: 'right' }}>Peso</th>
                        <th style={{ textAlign: 'center' }}>Conferência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidoDetalhe.caixas.map((cx) => (
                        <tr key={cx.id}>
                          <td>
                            {cx.produto_descricao}
                            {Number(cx.extra_fora_pedido) === 1 && (
                              <span className="badge badge-warning" style={{ marginLeft: '6px' }}>Extra</span>
                            )}
                          </td>
                          <td className="font-mono">{cx.ean_caixa}</td>
                          <td className="font-mono">{cx.lote || '-'}</td>
                          <td>{fmtData(cx.validade)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtKg(cx.peso_kg)}</td>
                          <td style={{ textAlign: 'center' }}>
                            {Number(cx.conferido) === 1 ? (
                              <span className="badge badge-success">Conferida</span>
                            ) : (
                              <span className="badge badge-neutral">Pendente</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPrintPedido(pedidoDetalhe)
                }}
              >
                <Printer size={15} /> Imprimir Folha do Pedido
              </button>
              {pedidoDetalhe.romaneio_id &&
                ['AGUARDANDO_CONFERENCIA', 'EM_CONFERENCIA', 'EXPEDIDO'].includes(pedidoDetalhe.status) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      const rom = await saidaQueries.detalhesRomaneio(pedidoDetalhe.romaneio_id)
                      setPrintRomaneio(rom)
                    }}
                  >
                    <Truck size={15} /> Imprimir Romaneio de Embarque
                  </button>
                )}
            </div>
          </div>
        </div>
      )}

      {printPedido && (
        <FolhaPedidoPrint pedido={printPedido} onClose={() => setPrintPedido(null)} />
      )}
      {printRomaneio && (
        <RomaneioEmbarquePrint romaneio={printRomaneio} onClose={() => setPrintRomaneio(null)} />
      )}
    </div>
  )
}
