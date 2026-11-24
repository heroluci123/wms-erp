import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  History,
  Plus,
  QrCode,
  RefreshCw,
  Scale,
  Search,
  Settings2,
  Store,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { isApiEnabled } from '../lib/apiClient'
import { varejoQueries } from '../queries/varejo'
import { comprasQueries } from '../queries/compras'
import * as produtosQueries from '../queries/produtos'
import { ApiModeRequiredBanner } from '../components/shared/ApiModeRequiredBanner'
import { ModalEtiquetaZebra80x45 } from '../components/shared/EtiquetaZebra80x45'
import { ProdutoSearchSelect } from '../components/shared/SmartSearchSelect'

const fmtMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function VarejoLoja() {
  const { filialAtivaId, filiaisDisponiveis, toastSuccess, toastError, toastWarning, confirmar } = useAppStore()
  const apiAtiva = isApiEnabled()

  const filialAtual = useMemo(
    () => filiaisDisponiveis.find((f) => String(f.id) === String(filialAtivaId)) || null,
    [filiaisDisponiveis, filialAtivaId],
  )

  const [aba, setAba] = useState('ESTOQUE') // 'ESTOQUE' | 'INVENTARIO' | 'EXTRATO'
  const [loading, setLoading] = useState(false)
  const [estoque, setEstoque] = useState([])
  const [resumo, setResumo] = useState({ total_skus: 0, total_acougue: 0, total_emporio: 0, abaixo_minimo: 0 })
  const [padraoBalanca, setPadraoBalanca] = useState('AUTO')
  const [produtosCatalogo, setProdutosCatalogo] = useState([])
  const [movimentacoes, setMovimentacoes] = useState([])
  const [inventarios, setInventarios] = useState([])
  const [invAberto, setInvAberto] = useState(null)

  // Filtros
  const [busca, setBusca] = useState('')
  const [setorFiltro, setSetorFiltro] = useState('TODOS')

  // Modal Cadastrar/Ajustar SKU da Loja
  const [modalAjuste, setModalAjuste] = useState(false)
  const [ajForm, setAjForm] = useState({
    produto_id: '',
    unidade_venda: 'KG',
    setor_loja: 'ACOUGUE',
    preco_venda_varejo: '',
    codigo_balanca: '',
    estoque_minimo: '',
    tipo_movimento: 'AJUSTE_MANUAL',
    qtd_ajuste: '',
    observacao: '',
  })

  // Modal Emitir Etiqueta QR 80x45 (digita peso -> mostra valor -> abre ModalEtiquetaZebra80x45)
  const [modalPesagemQr, setModalPesagemQr] = useState(null)
  const [qrPesoInput, setQrPesoInput] = useState('1.000')
  const [qrLoteInput, setQrLoteInput] = useState('')
  const [qrValidadeInput, setQrValidadeInput] = useState('')
  const [etiquetaPrintDados, setEtiquetaPrintDados] = useState(null)

  const carregar = useCallback(async () => {
    if (!apiAtiva) return
    setLoading(true)
    try {
      const [resEst, listProd, resMov, resInv] = await Promise.all([
        varejoQueries.listarEstoque({ busca, setor: setorFiltro }),
        produtosQueries.listar().catch(() => []),
        varejoQueries.listarMovimentacoes().catch(() => ({ data: [] })),
        varejoQueries.listarInventarios().catch(() => ({ data: [] })),
      ])
      setEstoque(resEst.data || [])
      setResumo(resEst.resumo || { total_skus: 0, total_acougue: 0, total_emporio: 0, abaixo_minimo: 0 })
      setPadraoBalanca(resEst.padrao_balanca_loja || 'AUTO')
      setProdutosCatalogo(Array.isArray(listProd) ? listProd : [])
      setMovimentacoes(resMov.data || [])
      setInventarios(resInv.data || [])
    } catch (err) {
      toastError('Erro ao carregar Loja', err.message)
    } finally {
      setLoading(false)
    }
  }, [apiAtiva, busca, setorFiltro, toastError])

  useEffect(() => {
    carregar()
  }, [carregar, filialAtivaId])

  const abrirModalAjuste = (item = null) => {
    if (item) {
      setAjForm({
        produto_id: item.produto_id,
        unidade_venda: item.unidade_venda || 'KG',
        setor_loja: item.setor_loja || 'ACOUGUE',
        preco_venda_varejo: String(item.preco_venda_varejo || ''),
        codigo_balanca: item.codigo_balanca || '',
        estoque_minimo: String(item.estoque_minimo || ''),
        tipo_movimento: 'AJUSTE_MANUAL',
        qtd_ajuste: '',
        observacao: '',
      })
    } else {
      setAjForm({
        produto_id: '',
        unidade_venda: 'KG',
        setor_loja: 'ACOUGUE',
        preco_venda_varejo: '',
        codigo_balanca: '',
        estoque_minimo: '',
        tipo_movimento: 'AJUSTE_MANUAL',
        qtd_ajuste: '',
        observacao: '',
      })
    }
    setModalAjuste(true)
  }

  const handleSalvarAjuste = async (e) => {
    e.preventDefault()
    if (!ajForm.produto_id) return toastWarning('Produto', 'Selecione o produto.')
    try {
      await varejoQueries.ajustarEstoque({
        produto_id: ajForm.produto_id,
        unidade_venda: ajForm.unidade_venda,
        setor_loja: ajForm.setor_loja,
        preco_venda_varejo: Number(String(ajForm.preco_venda_varejo || '0').replace(',', '.')),
        codigo_balanca: ajForm.codigo_balanca,
        estoque_minimo: Number(String(ajForm.estoque_minimo || '0').replace(',', '.')),
        tipo_movimento: ajForm.tipo_movimento,
        qtd_ajuste: Number(String(ajForm.qtd_ajuste || '0').replace(',', '.')),
        observacao: ajForm.observacao,
      })
      toastSuccess('Estoque da Loja atualizado!', 'Saldo e preço de varejo salvos.')
      setModalAjuste(false)
      carregar()
    } catch (err) {
      toastError('Erro ao salvar', err.message)
    }
  }

  const handleSalvarPadraoBalanca = async (novoPadrao) => {
    try {
      await comprasQueries.salvarConfigModulos({ padrao_balanca_loja: novoPadrao })
      setPadraoBalanca(novoPadrao)
      toastSuccess('Padrão de Balança salvo', `PDV configurado para padrão ${novoPadrao}.`)
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleCriarInventario = async () => {
    try {
      const res = await varejoQueries.criarInventario({
        titulo: `Inventário ${filialAtual?.codigo || 'Loja'} • ${new Date().toLocaleDateString('pt-BR')}`,
      })
      setInvAberto(res.data)
      toastSuccess('Inventário iniciado!', `Código ${res.data.codigo} com ${res.data.total_itens} produto(s).`)
      carregar()
    } catch (err) {
      toastError('Erro ao iniciar inventário', err.message)
    }
  }

  const handleSalvarContagem = async () => {
    if (!invAberto) return
    try {
      const res = await varejoQueries.salvarContagemInventario(
        invAberto.id,
        (invAberto.itens_json || invAberto.itensJson || []).map((i) => ({
          produto_id: i.produto_id,
          qtd_contada: Number(i.qtd_contada || 0),
        })),
      )
      setInvAberto((prev) => ({ ...prev, itens_json: res.itens_json, itensJson: res.itens_json, total_divergencias: res.total_divergencias }))
      toastSuccess('Contagem salva!', `${res.total_divergencias} divergência(s) encontrada(s).`)
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleFinalizarInventario = async () => {
    if (!invAberto) return
    const ok = await confirmar({
      title: `Aplicar Ajustes do Inventário ${invAberto.codigo}`,
      message: 'Todos os saldos da Loja serão ajustados para as quantidades contadas (registrando quebra/sobra no extrato). Continuar?',
      type: 'warning',
      confirmLabel: 'Finalizar & Ajustar Estoque',
    })
    if (!ok) return
    try {
      await varejoQueries.salvarContagemInventario(
        invAberto.id,
        (invAberto.itens_json || invAberto.itensJson || []).map((i) => ({
          produto_id: i.produto_id,
          qtd_contada: Number(i.qtd_contada || 0),
        })),
      )
      const res = await varejoQueries.finalizarInventario(invAberto.id)
      toastSuccess('Inventário concluído!', `${res.ajustados} produto(s) ajustado(s) no estoque da Loja.`)
      setInvAberto(null)
      carregar()
    } catch (err) {
      toastError('Erro ao finalizar', err.message)
    }
  }

  const abrirPesagemQr = (item) => {
    setModalPesagemQr(item)
    setQrPesoInput(item.unidade_venda === 'UN' ? '1' : '0.850')
    const valPadrao = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    setQrValidadeInput(valPadrao)
    setQrLoteInput(`L${new Date().toISOString().slice(5, 10).replace('-', '')}`)
  }

  const confirmarGerarEtiquetaQr = (e) => {
    e.preventDefault()
    if (!modalPesagemQr) return
    const peso = Math.max(0.001, Number(String(qrPesoInput || '0').replace(',', '.')))
    const preco = Number(modalPesagemQr.preco_venda_varejo || 0)
    const total = Number((peso * preco).toFixed(2))
    setEtiquetaPrintDados({
      codigo: modalPesagemQr.codigo_balanca || modalPesagemQr.produto_codigo || '001',
      descricao: modalPesagemQr.produto_descricao,
      unidade: modalPesagemQr.unidade_venda || 'KG',
      peso_kg: peso,
      preco_unitario: preco,
      valor_total: total,
      lote: qrLoteInput,
      validade: qrValidadeInput,
      empresa_nome: filialAtual?.nome || 'LOJA 1/1',
    })
    setModalPesagemQr(null)
  }

  if (!apiAtiva) return <ApiModeRequiredBanner titulo="Açougue, Empório & Estoque da Loja (1/1)" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <Store size={24} className="text-primary" /> Açougue, Empório & Estoque da Loja — {filialAtual ? `${filialAtual.codigo} • ${filialAtual.nome}` : '1/1'}
          </h1>
          <p className="page-header__subtitle">
            Saldo de balcão (KG) e empório (UN), emissão de Etiquetas Zebra 80×45mm com QR Code p/ PDV e Inventário Rápido do Varejo
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={carregar} disabled={loading}>
            <RefreshCw size={14} /> Atualizar
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => abrirModalAjuste(null)}>
            <Plus size={15} /> Incluir / Ajustar Produto na Loja
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-card__label">SKUs Ativos na Loja</span>
          <span className="kpi-card__value">{resumo.total_skus}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Açougue / Cortes (KG)</span>
          <span className="kpi-card__value" style={{ color: '#60a5fa' }}>{resumo.total_acougue}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Empório / Mercearia (UN)</span>
          <span className="kpi-card__value" style={{ color: '#a78bfa' }}>{resumo.total_emporio}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-card__label">Abaixo do Estoque Mínimo</span>
          <span className="kpi-card__value" style={{ color: resumo.abaixo_minimo > 0 ? '#f87171' : '#4ade80' }}>
            {resumo.abaixo_minimo}
          </span>
        </div>
      </div>

      {/* ABAS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        {[
          { id: 'ESTOQUE', label: `Estoque Loja & Etiquetas QR (${estoque.length})`, icon: QrCode },
          { id: 'INVENTARIO', label: `Inventário Rápido (${inventarios.length})`, icon: ClipboardCheck },
          { id: 'EXTRATO', label: 'Extrato & Config. Balança EAN-2', icon: Settings2 },
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

      {/* ABA 1: ESTOQUE DA LOJA & ETIQUETAS QR 80x45 */}
      {aba === 'ESTOQUE' && (
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 260px' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                style={{ paddingLeft: 32, height: 36 }}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar produto, código ou código balança..."
              />
            </div>
            {['TODOS', 'ACOUGUE', 'EMPORIO'].map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn--sm ${setorFiltro === s ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setSetorFiltro(s)}
              >
                {s === 'TODOS' ? 'Todos' : s === 'ACOUGUE' ? 'Açougue' : 'Empório'}
              </button>
            ))}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cód / Balança</th>
                  <th>Produto</th>
                  <th>Setor</th>
                  <th style={{ textAlign: 'right' }}>Saldo Loja</th>
                  <th style={{ textAlign: 'right' }}>Preço Varejo</th>
                  <th style={{ textAlign: 'right' }}>Margem</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {estoque.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted" style={{ padding: 28 }}>
                      Nenhum produto no estoque desta filial ainda. Transfira caixas da Matriz (1/2 → 1/1) ou clique em "Incluir / Ajustar Produto".
                    </td>
                  </tr>
                ) : (
                  estoque.map((item) => (
                    <tr key={item.id}>
                      <td className="font-mono text-xs">
                        <div>{item.produto_codigo || '-'}</div>
                        {item.codigo_balanca && (
                          <div className="text-muted">Bal: {item.codigo_balanca}</div>
                        )}
                      </td>
                      <td>
                        <div className="font-bold text-sm">{item.produto_descricao}</div>
                        {item.abaixo_minimo && (
                          <span className="badge badge--danger" style={{ fontSize: 10, marginTop: 2 }}>
                            <AlertTriangle size={10} /> Abaixo do mínimo ({item.estoque_minimo} {item.unidade_venda})
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${item.setor_loja === 'EMPORIO' ? 'badge--info' : 'badge--warning'}`}>
                          {item.setor_loja}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold">
                        {Number(item.saldo_qtd).toFixed(item.unidade_venda === 'UN' ? 0 : 3)} {item.unidade_venda}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">
                        {fmtMoeda(item.preco_venda_varejo)}/{item.unidade_venda}
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                        {item.margem_pct != null ? `${item.margem_pct}%` : '-'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => abrirPesagemQr(item)}
                            title="Imprimir Etiqueta Zebra 80×45mm com QR Code p/ bipar no PDV"
                          >
                            <QrCode size={13} /> Etiqueta 80×45 QR
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => abrirModalAjuste(item)}
                          >
                            Ajustar
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

      {/* ABA 2: INVENTÁRIO RÁPIDO DO VAREJO */}
      {aba === 'INVENTARIO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!invAberto ? (
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 className="text-sm font-bold m-0">Inventários Rápidos da Loja (Açougue & Empório)</h3>
                  <p className="text-xs text-muted m-0" style={{ marginTop: 4 }}>
                    Faça contagem de balcão/prateleira e aplique ajustes de quebra de açougue em 1 clique.
                  </p>
                </div>
                <button type="button" className="btn btn--primary btn--sm" onClick={handleCriarInventario}>
                  <Plus size={14} /> Abrir Nova Contagem
                </button>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Título</th>
                      <th>Itens</th>
                      <th>Divergências</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventarios.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-muted p-20">
                          Nenhum inventário do varejo realizado ainda.
                        </td>
                      </tr>
                    ) : (
                      inventarios.map((inv) => (
                        <tr key={inv.id}>
                          <td className="font-mono font-bold">{inv.codigo}</td>
                          <td className="text-sm">{inv.titulo}</td>
                          <td className="font-mono">{inv.totalItens ?? inv.total_itens}</td>
                          <td className="font-mono">{inv.totalDivergencias ?? inv.total_divergencias}</td>
                          <td>
                            <span className={`badge ${inv.status === 'CONCLUIDO' ? 'badge--success' : 'badge--warning'}`}>
                              {inv.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setInvAberto(inv)}
                            >
                              {inv.status === 'ABERTO' ? 'Continuar Contagem' : 'Ver Relatório'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 className="text-sm font-bold m-0">
                    {invAberto.codigo} — {invAberto.titulo} ({invAberto.status})
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInvAberto(null)}>
                    Voltar
                  </button>
                  {invAberto.status === 'ABERTO' && (
                    <>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={handleSalvarContagem}>
                        Salvar Parcial
                      </button>
                      <button type="button" className="btn btn--success btn--sm" onClick={handleFinalizarInventario}>
                        <CheckCircle2 size={14} /> Finalizar & Ajustar Saldo
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Setor</th>
                      <th style={{ textAlign: 'right' }}>Saldo Sistema</th>
                      <th style={{ width: 130, textAlign: 'right' }}>Qtd Contada</th>
                      <th style={{ textAlign: 'right' }}>Divergência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invAberto.itens_json || invAberto.itensJson || []).map((it, idx) => {
                      const div = Number((Number(it.qtd_contada || 0) - Number(it.saldo_sistema || 0)).toFixed(3))
                      return (
                        <tr key={it.produto_id || idx}>
                          <td className="font-bold text-sm">
                            <span className="font-mono text-muted">{it.produto_codigo}</span> • {it.produto_descricao}
                          </td>
                          <td className="text-xs">{it.setor_loja}</td>
                          <td style={{ textAlign: 'right' }} className="font-mono">
                            {Number(it.saldo_sistema || 0).toFixed(3)} {it.unidade_venda}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              type="number"
                              step="0.005"
                              min="0"
                              disabled={invAberto.status !== 'ABERTO'}
                              className="form-input font-mono"
                              style={{ height: 30, textAlign: 'right' }}
                              value={it.qtd_contada}
                              onChange={(e) => {
                                const val = Number(e.target.value || 0)
                                setInvAberto((prev) => {
                                  const arr = [...(prev.itens_json || prev.itensJson || [])]
                                  arr[idx] = { ...arr[idx], qtd_contada: val }
                                  return { ...prev, itens_json: arr, itensJson: arr }
                                })
                              }}
                            />
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              color: div < 0 ? '#f87171' : div > 0 ? '#4ade80' : 'var(--text-muted)',
                            }}
                            className="font-mono"
                          >
                            {div > 0 ? `+${div.toFixed(3)}` : div.toFixed(3)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 3: EXTRATO & CONFIGURAÇÃO DE BALANÇA EAN-2 */}
      {aba === 'EXTRATO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 className="text-sm font-bold m-0 flex items-center gap-8">
              <Scale size={16} className="text-primary" /> Padrão de Etiqueta Pesável de Balança (EAN-13 começando com "2")
            </h3>
            <p className="text-xs text-muted" style={{ marginTop: 4, marginBottom: 12 }}>
              Escolha <strong>Automático (Todos os Padrões)</strong> para o PDV detectar Toledo/Filizola tanto por Preço Total quanto por Peso em gramas, além do QR Code Zebra 80×45mm.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { id: 'AUTO', label: 'Automático (Todos os Padrões)' },
                { id: 'TOLEDO_PRECO_5', label: 'Toledo/Filizola — Preço Total (5 díg. cód)' },
                { id: 'TOLEDO_PRECO_4', label: 'Toledo/Filizola — Preço Total (4 díg. cód)' },
                { id: 'TOLEDO_PESO_5', label: 'Toledo/Filizola — Peso gramas (5 díg. cód)' },
                { id: 'TOLEDO_PESO_4', label: 'Toledo/Filizola — Peso gramas (4 díg. cód)' },
              ].map((op) => (
                <button
                  key={op.id}
                  type="button"
                  className={`btn btn--sm ${padraoBalanca === op.id ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => handleSalvarPadraoBalanca(op.id)}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <h3 className="text-sm font-bold m-0 mb-12 flex items-center gap-8">
              <History size={16} /> Últimas Movimentações do Estoque da Loja
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data / Hora</th>
                    <th>Produto</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: 'right' }}>Movimento</th>
                    <th style={{ textAlign: 'right' }}>Saldo Novo</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted p-20">
                        Nenhuma movimentação registrada nesta filial.
                      </td>
                    </tr>
                  ) : (
                    movimentacoes.map((m) => (
                      <tr key={m.id}>
                        <td className="text-xs text-muted">{new Date(m.created_at).toLocaleString('pt-BR')}</td>
                        <td className="font-bold text-xs">{m.produto_descricao}</td>
                        <td><span className="badge badge--info">{m.tipo}</span></td>
                        <td
                          style={{ textAlign: 'right', color: m.qtd < 0 ? '#f87171' : '#4ade80' }}
                          className="font-mono font-bold text-xs"
                        >
                          {m.qtd > 0 ? `+${m.qtd.toFixed(3)}` : m.qtd.toFixed(3)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-xs">
                          {m.saldo_novo.toFixed(3)}
                        </td>
                        <td className="text-xs text-muted">{m.observacao}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL INCLUIR / AJUSTAR PRODUTO NA LOJA */}
      {modalAjuste && (
        <div className="modal-overlay" style={{ zIndex: 1050 }} onClick={(e) => e.target === e.currentTarget && setModalAjuste(false)}>
          <form
            className="card"
            style={{ width: '95%', maxWidth: 540, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={handleSalvarAjuste}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="text-base font-bold m-0">Configurar / Ajustar Produto no Estoque da Loja</h3>
              <button type="button" className="btn-icon" onClick={() => setModalAjuste(false)}>
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="form-label">Produto *</label>
              <ProdutoSearchSelect
                produtos={produtosCatalogo}
                value={ajForm.produto_id}
                onChange={(pid, p) => {
                  setAjForm((prev) => ({
                    ...prev,
                    produto_id: pid,
                    preco_venda_varejo: prev.preco_venda_varejo || String(p?.valor_unitario || ''),
                    codigo_balanca: prev.codigo_balanca || String(p?.codigo || '').replace(/\D/g, '').slice(-5),
                  }))
                }}
                placeholder="Pesquisar produto (cód., descrição, EAN, Empório)..."
                modalTitle="Selecionar Produto da Loja"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Setor na Loja</label>
                <select
                  className="form-input"
                  value={ajForm.setor_loja}
                  onChange={(e) => setAjForm((p) => ({ ...p, setor_loja: e.target.value }))}
                >
                  <option value="ACOUGUE">Açougue</option>
                  <option value="EMPORIO">Empório</option>
                </select>
              </div>
              <div>
                <label className="form-label">Unidade Venda</label>
                <select
                  className="form-input"
                  value={ajForm.unidade_venda}
                  onChange={(e) => setAjForm((p) => ({ ...p, unidade_venda: e.target.value }))}
                >
                  <option value="KG">KG (Peso)</option>
                  <option value="UN">UN (Unidade)</option>
                </select>
              </div>
              <div>
                <label className="form-label">Cód. Balança (EAN-2)</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={ajForm.codigo_balanca}
                  onChange={(e) => setAjForm((p) => ({ ...p, codigo_balanca: e.target.value }))}
                  placeholder="Ex: 3244"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Preço Venda Varejo (R$)</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={ajForm.preco_venda_varejo}
                  onChange={(e) => setAjForm((p) => ({ ...p, preco_venda_varejo: e.target.value }))}
                  placeholder="59,90"
                />
              </div>
              <div>
                <label className="form-label">Estoque Mínimo Alerta</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={ajForm.estoque_minimo}
                  onChange={(e) => setAjForm((p) => ({ ...p, estoque_minimo: e.target.value }))}
                  placeholder="10"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Tipo de Movimento</label>
                <select
                  className="form-input"
                  value={ajForm.tipo_movimento}
                  onChange={(e) => setAjForm((p) => ({ ...p, tipo_movimento: e.target.value }))}
                >
                  <option value="AJUSTE_MANUAL">Ajuste / Entrada Saldo (+ ou -)</option>
                  <option value="QUEBRA_BALCAO">Quebra / Apara Balcão (Baixa)</option>
                  <option value="ENTRADA_COMPRA">Entrada Direta Loja</option>
                </select>
              </div>
              <div>
                <label className="form-label">Quantidade a Movimentar (0 = só preço)</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={ajForm.qtd_ajuste}
                  onChange={(e) => setAjForm((p) => ({ ...p, qtd_ajuste: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>

            <div>
              <label className="form-label">Observação</label>
              <input
                type="text"
                className="form-input"
                value={ajForm.observacao}
                onChange={(e) => setAjForm((p) => ({ ...p, observacao: e.target.value }))}
                placeholder="Ex.: Reposição balcão / Quebra de corte"
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalAjuste(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--primary">
                Salvar na Loja
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL GERAR ETIQUETA ZEBRA 80x45 COM QR CODE (PESO + VALOR) */}
      {modalPesagemQr && (
        <div className="modal-overlay" style={{ zIndex: 1050 }} onClick={(e) => e.target === e.currentTarget && setModalPesagemQr(null)}>
          <form
            className="card"
            style={{ width: '95%', maxWidth: 440, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
            onSubmit={confirmarGerarEtiquetaQr}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="text-base font-bold m-0 flex items-center gap-8">
                <QrCode size={18} className="text-primary" /> Gerar Etiqueta QR 80×45mm
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalPesagemQr(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-2)', padding: 10, borderRadius: 6 }}>
              <div className="font-bold text-sm">{modalPesagemQr.produto_descricao}</div>
              <div className="text-xs text-muted font-mono">
                Preço Varejo: <strong>{fmtMoeda(modalPesagemQr.preco_venda_varejo)}/{modalPesagemQr.unidade_venda}</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">
                  {modalPesagemQr.unidade_venda === 'UN' ? 'Quantidade (UN) *' : 'Peso da Bandeja (kg) *'}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  className="form-input font-mono"
                  value={qrPesoInput}
                  onChange={(e) => setQrPesoInput(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Valor Total Calculado</label>
                <div
                  className="form-input font-mono font-bold"
                  style={{ display: 'flex', alignItems: 'center', color: '#4ade80', background: 'var(--bg-2)' }}
                >
                  {fmtMoeda(
                    (Number(String(qrPesoInput || '0').replace(',', '.')) || 0) *
                      Number(modalPesagemQr.preco_venda_varejo || 0),
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Lote</label>
                <input
                  type="text"
                  className="form-input font-mono"
                  value={qrLoteInput}
                  onChange={(e) => setQrLoteInput(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Validade</label>
                <input
                  type="date"
                  className="form-input font-mono"
                  value={qrValidadeInput}
                  onChange={(e) => setQrValidadeInput(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setModalPesagemQr(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--primary">
                <QrCode size={15} /> Visualizar & Imprimir 80×45
              </button>
            </div>
          </form>
        </div>
      )}

      <ModalEtiquetaZebra80x45
        aberto={Boolean(etiquetaPrintDados)}
        onClose={() => setEtiquetaPrintDados(null)}
        dados={etiquetaPrintDados}
        modo="PDV"
        toastSuccess={toastSuccess}
      />
    </div>
  )
}
