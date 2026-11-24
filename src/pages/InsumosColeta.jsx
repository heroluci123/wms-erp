import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  History,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  ScanLine,
  Unlock,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { insumosQueries } from '../queries/varejo'
import { comprasQueries } from '../queries/compras'
import { cadastrosQueries } from '../queries/cadastros'
import * as produtosQueries from '../queries/produtos'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalEtiquetaZebra80x45 } from '../components/shared/EtiquetaZebra80x45'
import { ProdutoSearchSelect } from '../components/shared/SmartSearchSelect'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const SETORES_COLETA = [
  'DESOSSA / PRODUÇÃO',
  'EMBALAGEM / VÁCUO',
  'EXPEDIÇÃO / CÂMARA',
  'AÇOUGUE / LOJA 1/1',
  'HIGIENE / LIMPEZA',
  'MANUTENÇÃO',
  'ADMINISTRATIVO',
]

export function InsumosColeta() {
  const { filialAtivaId, toastSuccess, toastError, toastWarning } = useAppStore()
  const apiAtiva = isApiEnabled()
  const inputEndRef = useRef(null)

  const [aba, setAba] = useState('COLETAR') // 'COLETAR' | 'ENDERECOS' | 'HISTORICO'
  const [loading, setLoading] = useState(false)
  const [controlarAtivo, setControlarAtivo] = useState(false)
  const [estoque, setEstoque] = useState([])
  const [resumo, setResumo] = useState({ total_enderecos: 0, abaixo_minimo: 0, valor_total_almoxarifado: 0 })
  const [coletas, setColetas] = useState([])
  const [resumoSetores, setResumoSetores] = useState([])
  const [produtosCatalogo, setProdutosCatalogo] = useState([])
  const [centrosCusto, setCentrosCusto] = useState([])

  // Coleta bipando endereço
  const [endInput, setEndInput] = useState('')
  const [insumoEncontrado, setInsumoEncontrado] = useState(null)
  const [qtdRetirar, setQtdRetirar] = useState('1')
  const [setorDestino, setSetorDestino] = useState('DESOSSA / PRODUÇÃO')
  const [centroCustoId, setCentroCustoId] = useState('')
  const [obsColeta, setObsColeta] = useState('')
  const [coletando, setColetando] = useState(false)

  // Modal Novo Endereço de Insumo + Modal Reposição + Etiqueta 80x45
  const [modalNovo, setModalNovo] = useState(false)
  const [novoForm, setNovoForm] = useState({
    produto_id: '',
    endereco_codigo: '',
    unidade: 'UN',
    saldo_inicial: '0',
    estoque_minimo: '10',
    custo_unitario: '',
  })
  const [modalRepor, setModalRepor] = useState(null)
  const [reporQtd, setReporQtd] = useState('')
  const [etiquetaInsumo, setEtiquetaInsumo] = useState(null)

  const carregar = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [resEst, resCol, listProd, aux] = await Promise.all([
        insumosQueries.listarEstoque(),
        insumosQueries.listarColetas(),
        produtosQueries.listar().catch(() => []),
        cadastrosQueries.listarAuxiliares().catch(() => ({ centrosCusto: [] })),
      ])
      setControlarAtivo(Boolean(resEst.controlar_estoque_insumos))
      setEstoque(resEst.data || [])
      setResumo(resEst.resumo || { total_enderecos: 0, abaixo_minimo: 0, valor_total_almoxarifado: 0 })
      setColetas(resCol.data || [])
      setResumoSetores(resCol.resumo_setores || [])
      setProdutosCatalogo(Array.isArray(listProd) ? listProd : [])
      setCentrosCusto(aux?.centrosCusto || [])
    } catch (err) {
      toastError('Erro ao carregar Insumos', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, toastError])

  useEffect(() => {
    carregar()
  }, [carregar, filialAtivaId])

  const handleToggleControleInsumos = async () => {
    const proximo = !controlarAtivo
    try {
      await comprasQueries.salvarConfigModulos({ controlar_estoque_insumos: proximo })
      setControlarAtivo(proximo)
      toastSuccess(
        proximo ? 'Controle de Estoque de Insumos ATIVADO' : 'Controle de Insumos DESATIVADO',
        proximo
          ? 'Agora Compras de Insumos exigem Pedido de Compra, alimentam o almoxarifado e habilitam baixa por coleta.'
          : 'Insumos agora permitem entrada direta na NF-e sem obrigatoriedade de Pedido de Compra.',
      )
    } catch (err) {
      toastError('Erro ao alterar parâmetro', err.message)
    }
  }

  const handleBuscarEndereco = async (e) => {
    e?.preventDefault?.()
    const cod = endInput.trim()
    if (!cod) return
    try {
      const res = await insumosQueries.buscarPorEndereco(cod)
      setInsumoEncontrado(res.data)
      setQtdRetirar('1')
    } catch (err) {
      setInsumoEncontrado(null)
      toastError('Endereço não encontrado', err.message)
    }
  }

  const handleConfirmarColeta = async (e) => {
    e.preventDefault()
    if (!insumoEncontrado) return toastWarning('Endereço', 'Bipe ou selecione o endereço do insumo primeiro.')
    const qtd = Number(String(qtdRetirar || '0').replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd <= 0) return toastWarning('Quantidade', 'Informe a quantidade retirada.')
    setColetando(true)
    try {
      const res = await insumosQueries.registrarColeta({
        endereco_codigo: insumoEncontrado.endereco_codigo,
        quantidade: qtd,
        setor_destino: setorDestino,
        centro_custo_id: centroCustoId || null,
        observacao: obsColeta,
      })
      toastSuccess(
        `Retirada registrada (${res.data.endereco_codigo})`,
        `-${res.data.quantidade} ${res.data.unidade} para ${res.data.setor_destino} • Novo saldo: ${res.data.saldo_novo} ${res.data.unidade}`,
      )
      if (res.data.alerta_estoque_minimo) {
        toastWarning(
          'Alerta de Estoque Mínimo!',
          `${res.data.produto_descricao} atingiu o estoque mínimo (${res.data.saldo_novo} ${res.data.unidade}). Programe reposição!`,
        )
      }
      setInsumoEncontrado(null)
      setEndInput('')
      setObsColeta('')
      carregar()
      setTimeout(() => inputEndRef.current?.focus(), 60)
    } catch (err) {
      toastError('Falha na coleta', err.message)
    } finally {
      setColetando(false)
    }
  }

  const handleSalvarEndereco = async (e) => {
    e.preventDefault()
    if (!novoForm.produto_id || !novoForm.endereco_codigo.trim()) {
      return toastWarning('Campos obrigatórios', 'Informe o produto e o código do endereço (ex: ALM-VACUO-01).')
    }
    try {
      await insumosQueries.salvarEnderecoInsumo({
        produto_id: novoForm.produto_id,
        endereco_codigo: novoForm.endereco_codigo.trim().toUpperCase(),
        unidade: novoForm.unidade,
        saldo_inicial: Number(String(novoForm.saldo_inicial || '0').replace(',', '.')),
        estoque_minimo: Number(String(novoForm.estoque_minimo || '0').replace(',', '.')),
        custo_unitario: Number(String(novoForm.custo_unitario || '0').replace(',', '.')),
      })
      toastSuccess('Endereço de insumo salvo!', `Endereço ${novoForm.endereco_codigo.toUpperCase()} pronto para bipagem.`)
      setModalNovo(false)
      setNovoForm({ produto_id: '', endereco_codigo: '', unidade: 'UN', saldo_inicial: '0', estoque_minimo: '10', custo_unitario: '' })
      carregar()
    } catch (err) {
      toastError('Erro ao salvar endereço', err.message)
    }
  }

  const handleReporSaldo = async (e) => {
    e.preventDefault()
    if (!modalRepor) return
    const qtd = Number(String(reporQtd || '0').replace(',', '.'))
    if (!Number.isFinite(qtd) || qtd <= 0) return toastWarning('Quantidade', 'Informe um valor positivo.')
    try {
      await insumosQueries.registrarEntradaManual({
        insumo_estoque_id: modalRepor.id,
        quantidade: qtd,
        observacao: 'Reposição manual no almoxarifado',
      })
      toastSuccess('Saldo reposto!', `+${qtd} ${modalRepor.unidade} em ${modalRepor.endereco_codigo}.`)
      setModalRepor(null)
      setReporQtd('')
      carregar()
    } catch (err) {
      toastError('Erro ao repor saldo', err.message)
    }
  }

  if (!apiAtiva) return <ApiModeRequiredBanner titulo="Almoxarifado & Coleta de Insumos" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <Boxes size={24} className="text-primary" /> Almoxarifado & Coleta de Insumos
          </h1>
          <p className="page-header__subtitle">
            Bipe o endereço do insumo (sacos vácuo, caixas, etiquetas, filmes, condimentos) e informe a quantidade retirada para baixa rastreada por setor
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn--sm ${controlarAtivo ? 'btn--success' : 'btn--ghost'}`}
            onClick={handleToggleControleInsumos}
            title="Parâmetro configurável por empresa: quando ATIVADO, NF-e de Insumo exige Pedido de Compra e controla estoque; quando DESATIVADO, permite entrada direta"
          >
            {controlarAtivo ? <Lock size={14} /> : <Unlock size={14} />}
            {controlarAtivo ? 'Controle Estoque Insumos: ATIVO (PC Obrig.)' : 'Controle Estoque Insumos: Opcional (Baixa Direta)'}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setModalNovo(true)}>
            <Plus size={14} /> Cadastrar Endereço Insumo
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={carregar} disabled={loading}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-card__label">Endereços Cadastrados</span>
          <span className="kpi-card__value">{resumo.total_enderecos}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Insumos Abaixo do Mínimo</span>
          <span className="kpi-card__value" style={{ color: resumo.abaixo_minimo > 0 ? '#f87171' : '#4ade80' }}>
            {resumo.abaixo_minimo}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Valor em Almoxarifado</span>
          <span className="kpi-card__value font-mono" style={{ fontSize: 18 }}>
            {fmtMoeda(resumo.valor_total_almoxarifado)}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Regra Fiscal de Insumos</span>
          <span className="kpi-card__value" style={{ fontSize: 14, color: controlarAtivo ? '#4ade80' : '#fbbf24' }}>
            {controlarAtivo ? 'Exige PC + Estoque' : 'Entrada Direta Liberada'}
          </span>
        </div>
      </div>

      {/* ABAS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        {[
          { id: 'COLETAR', label: 'Coleta Rápida (Bipar Endereço)', icon: ScanLine },
          { id: 'ENDERECOS', label: `Endereços & Etiquetas 80×45 (${estoque.length})`, icon: QrCode },
          { id: 'HISTORICO', label: `Histórico & Custo por Setor (${coletas.length})`, icon: History },
        ].map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              className={`btn ${aba === t.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setAba(t.id)}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ABA 1: COLETA RÁPIDA BIPANDO ENDEREÇO */}
      {aba === 'COLETAR' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 className="text-sm font-bold m-0">1. Bipar ou Selecionar Endereço do Insumo</h3>
            <form onSubmit={handleBuscarEndereco} style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputEndRef}
                type="text"
                autoFocus
                className="form-input font-mono"
                style={{ flex: 1, height: 42, fontSize: 15, fontWeight: 700 }}
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                placeholder="Bipe o QR 80×45 ou digite o endereço (ex.: ALM-VACUO-01)..."
              />
              <button type="submit" className="btn btn--primary" style={{ height: 42 }}>
                Localizar
              </button>
            </form>

            {insumoEncontrado && (
              <form
                onSubmit={handleConfirmarColeta}
                style={{
                  border: '1.5px solid #3b82f6',
                  background: 'rgba(59, 130, 246, 0.08)',
                  borderRadius: 8,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="font-mono font-bold text-sm" style={{ color: '#60a5fa' }}>
                      {insumoEncontrado.endereco_codigo}
                    </div>
                    <div className="font-bold text-base">{insumoEncontrado.produto_descricao}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="text-xs text-muted">Saldo Atual</div>
                    <div className="font-mono font-bold" style={{ fontSize: 18, color: '#4ade80' }}>
                      {insumoEncontrado.saldo_atual} {insumoEncontrado.unidade}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="form-label">Quantidade Retirada ({insumoEncontrado.unidade}) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      className="form-input font-mono"
                      style={{ height: 40, fontSize: 16, fontWeight: 700 }}
                      value={qtdRetirar}
                      onChange={(e) => setQtdRetirar(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Setor de Destino *</label>
                    <select
                      className="form-input"
                      style={{ height: 40 }}
                      value={setorDestino}
                      onChange={(e) => setSetorDestino(e.target.value)}
                    >
                      {SETORES_COLETA.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="form-label">Centro de Custo (Opcional)</label>
                    <select
                      className="form-input"
                      value={centroCustoId}
                      onChange={(e) => setCentroCustoId(e.target.value)}
                    >
                      <option value="">-- Nenhum --</option>
                      {centrosCusto.map((c) => (
                        <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Observação</label>
                    <input
                      type="text"
                      className="form-input"
                      value={obsColeta}
                      onChange={(e) => setObsColeta(e.target.value)}
                      placeholder="Ex.: Turno manhã / OP-0015"
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn--success" style={{ height: 44, fontWeight: 700 }} disabled={coletando}>
                  <CheckCircle2 size={16} /> {coletando ? 'Registrando...' : 'Confirmar Retirada & Baixar Saldo'}
                </button>
              </form>
            )}
          </div>

          {/* ATALHO RÁPIDO: CLIQUE EM UM ENDEREÇO CADASTRADO */}
          <div className="card" style={{ padding: 16 }}>
            <h3 className="text-sm font-bold m-0 mb-12">Endereços Disponíveis (Clique para selecionar)</h3>
            {estoque.length === 0 ? (
              <div className="text-xs text-muted">
                Nenhum endereço cadastrado ainda. Clique em "+ Cadastrar Endereço Insumo" no topo.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
                {estoque.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setEndInput(item.endereco_codigo)
                      setInsumoEncontrado(item)
                      setQtdRetirar('1')
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-2)',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div className="font-mono font-bold text-xs" style={{ color: '#60a5fa' }}>
                        {item.endereco_codigo}
                      </div>
                      <div className="text-xs font-bold">{item.produto_descricao}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="font-mono text-xs font-bold" style={{ color: item.abaixo_minimo ? '#f87171' : '#4ade80' }}>
                        {item.saldo_atual} {item.unidade}
                      </div>
                      {item.abaixo_minimo && <div style={{ fontSize: 10, color: '#f87171' }}>Mín: {item.estoque_minimo}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: ENDEREÇOS & ETIQUETAS 80x45 */}
      {aba === 'ENDERECOS' && (
        <div className="card" style={{ padding: 16 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Endereço</th>
                  <th>Insumo / Embalagem</th>
                  <th style={{ textAlign: 'right' }}>Saldo Atual</th>
                  <th style={{ textAlign: 'right' }}>Mínimo</th>
                  <th style={{ textAlign: 'right' }}>Custo Unit.</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {estoque.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted p-24">
                      Nenhum endereço de insumo cadastrado nesta filial.
                    </td>
                  </tr>
                ) : (
                  estoque.map((item) => (
                    <tr key={item.id}>
                      <td className="font-mono font-bold text-sm" style={{ color: '#60a5fa' }}>
                        {item.endereco_codigo}
                      </td>
                      <td>
                        <div className="font-bold text-sm">{item.produto_descricao}</div>
                        {item.abaixo_minimo && (
                          <span className="badge badge--danger" style={{ fontSize: 10 }}>
                            <AlertTriangle size={10} /> Reposição necessária
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                        {item.saldo_atual} {item.unidade}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-xs text-muted">
                        {item.estoque_minimo} {item.unidade}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                        {fmtMoeda(item.custo_unitario)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => setEtiquetaInsumo(item)}
                          >
                            <QrCode size={13} /> Etiqueta 80×45 QR
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => {
                              setModalRepor(item)
                              setReporQtd('')
                            }}
                          >
                            + Repor
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 3: HISTÓRICO & CUSTO POR SETOR */}
      {aba === 'HISTORICO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {resumoSetores.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {resumoSetores.map((s) => (
                <div key={s.setor} className="kpi-card">
                  <span className="kpi-card__label">{s.setor}</span>
                  <span className="kpi-card__value font-mono" style={{ fontSize: 18 }}>
                    {fmtMoeda(s.custo_total)}
                  </span>
                  <span className="text-xs text-muted">{s.qtd_retiradas} retirada(s)</span>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data/Hora</th>
                    <th>Endereço</th>
                    <th>Insumo</th>
                    <th>Tipo</th>
                    <th>Setor</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Custo</th>
                    <th>Operador</th>
                  </tr>
                </thead>
                <tbody>
                  {coletas.map((c) => (
                    <tr key={c.id}>
                      <td className="text-xs text-muted">{new Date(c.created_at).toLocaleString('pt-BR')}</td>
                      <td className="font-mono text-xs font-bold">{c.endereco_codigo}</td>
                      <td className="text-xs font-bold">{c.produto_descricao}</td>
                      <td>
                        <span className={`badge ${c.tipo === 'COLETA_MANUAL' ? 'badge--warning' : 'badge--success'}`}>
                          {c.tipo}
                        </span>
                      </td>
                      <td className="text-xs">{c.setor_destino}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-xs font-bold">
                        {c.tipo === 'COLETA_MANUAL' ? `-${c.quantidade}` : `+${c.quantidade}`}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                        {fmtMoeda(c.custo_total)}
                      </td>
                      <td className="text-xs text-muted">{c.operador_nome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CADASTRAR ENDEREÇO DE INSUMO */}
      {modalNovo && (
        <div className="modal-overlay" style={{ zIndex: 1050 }} onClick={(e) => e.target === e.currentTarget && setModalNovo(false)}>
          <form
            className="card"
            style={{ width: '95%', maxWidth: 480, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={handleSalvarEndereco}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="text-base font-bold m-0">Cadastrar Endereço de Insumo</h3>
              <button type="button" className="btn-icon" onClick={() => setModalNovo(false)}>
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="form-label">Produto / Insumo *</label>
              <ProdutoSearchSelect
                produtos={produtosCatalogo}
                value={novoForm.produto_id}
                onChange={(val) => setNovoForm((p) => ({ ...p, produto_id: val }))}
                placeholder="Pesquisar insumo, embalagem, etiqueta ou produto..."
                modalTitle="Pesquisar Produto / Insumo (Catálogo Completo)"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Código do Endereço (Bipável) *</label>
                <input
                  type="text"
                  required
                  className="form-input font-mono"
                  value={novoForm.endereco_codigo}
                  onChange={(e) => setNovoForm((p) => ({ ...p, endereco_codigo: e.target.value }))}
                  placeholder="Ex.: ALM-VACUO-01"
                />
              </div>
              <div>
                <label className="form-label">Unidade</label>
                <select
                  className="form-input"
                  value={novoForm.unidade}
                  onChange={(e) => setNovoForm((p) => ({ ...p, unidade: e.target.value }))}
                >
                  <option value="UN">UN (Unidade)</option>
                  <option value="PCT">PCT (Pacote)</option>
                  <option value="CX">CX (Caixa)</option>
                  <option value="RL">RL (Rolo)</option>
                  <option value="MIL">MIL (Milheiro)</option>
                  <option value="KG">KG (Quilo)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Saldo Inicial</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={novoForm.saldo_inicial}
                  onChange={(e) => setNovoForm((p) => ({ ...p, saldo_inicial: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Estoque Mínimo</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={novoForm.estoque_minimo}
                  onChange={(e) => setNovoForm((p) => ({ ...p, estoque_minimo: e.target.value }))}
                />
              </div>
              <div>
                <label className="form-label">Custo Unit. (R$)</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={novoForm.custo_unitario}
                  onChange={(e) => setNovoForm((p) => ({ ...p, custo_unitario: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalNovo(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--primary">
                Salvar Endereço
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL REPOR SALDO */}
      {modalRepor && (
        <div className="modal-overlay" style={{ zIndex: 1050 }} onClick={(e) => e.target === e.currentTarget && setModalRepor(null)}>
          <form
            className="card"
            style={{ width: '95%', maxWidth: 380, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={handleReporSaldo}
          >
            <h3 className="text-base font-bold m-0">Repor Saldo — {modalRepor.endereco_codigo}</h3>
            <div className="text-xs text-muted">{modalRepor.produto_descricao}</div>
            <div>
              <label className="form-label">Quantidade a adicionar ({modalRepor.unidade}) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                autoFocus
                className="form-input font-mono"
                value={reporQtd}
                onChange={(e) => setReporQtd(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalRepor(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--success">
                Repor
              </button>
            </div>
          </form>
        </div>
      )}

      <ModalEtiquetaZebra80x45
        aberto={Boolean(etiquetaInsumo)}
        onClose={() => setEtiquetaInsumo(null)}
        dados={etiquetaInsumo}
        modo="INSUMO"
        toastSuccess={toastSuccess}
      />
    </div>
  )
}
