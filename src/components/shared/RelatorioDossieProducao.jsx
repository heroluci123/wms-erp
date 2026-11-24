import React, { useState, useEffect, useMemo } from 'react';
import { 
  Factory, Search, Download, Printer, ChevronDown, ChevronRight, 
  Calendar, CheckCircle, Truck, Package, Layers, RefreshCw, ArrowRight,
  TrendingUp, Scale, AlertCircle
} from 'lucide-react';
import * as producaoQueries from '../../queries/producao';
import { exportProducaoExcel } from '../../utils/exportProducaoExcel';
import { useAppStore } from '../../store/appStore';
import { isCliente } from '../../utils/permissoes';
import { SmartSearchSelect } from './SmartSearchSelect';

const fmtKg = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
const fmtKg3 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return '-';
  const s = String(d).split('T')[0];
  const parts = s.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
};

export function RelatorioDossieProducao({ titulo = "Dossiê de Transformação & Rendimento", enderecoFixo = null, opIdInicial = null, somenteClienteFinalizado = false }) {
  const { operador } = useAppStore();
  const modoCliente = somenteClienteFinalizado || isCliente(operador);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [dossies, setDossies] = useState([]);
  const [opsDisponiveis, setOpsDisponiveis] = useState([]);

  // Filtros
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    return d.toISOString().slice(0, 10);
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtroOpId, setFiltroOpId] = useState(opIdInicial ? String(opIdInicial) : 'TODOS');
  const [filtroCliente, setFiltroCliente] = useState('TODOS');
  const [filtroEndereco, setFiltroEndereco] = useState(enderecoFixo || 'TODOS');
  const [busca, setBusca] = useState('');
  
  // Controle de cards expandidos no modo tela
  const [expandidos, setExpandidos] = useState({});

  useEffect(() => {
    if (opIdInicial) setFiltroOpId(String(opIdInicial));
  }, [opIdInicial]);

  useEffect(() => {
    if (modoCliente) return;
    producaoQueries.listarOPs('TODAS')
      .then((ops) => setOpsDisponiveis(ops || []))
      .catch(() => {});
  }, [modoCliente]);

  const carregarDados = async () => {
    setLoading(true);
    try {
      const lista = await producaoQueries.listarDossiesProducao({
        dataInicio,
        dataFim,
        cliente: filtroCliente,
        endereco: enderecoFixo || filtroEndereco,
        busca,
        opId: filtroOpId !== 'TODOS' ? (/^\d+$/.test(String(filtroOpId)) ? Number(filtroOpId) : filtroOpId) : null,
      });
      setDossies(lista);
      if (modoCliente && Array.isArray(lista)) {
        setOpsDisponiveis((prev) => prev.length > 0 ? prev : lista.map((o) => ({
          id: o.id,
          numero_op: o.numero_op,
          data_producao: o.data_producao,
          status: o.status,
        })));
      }
      if (lista.length > 0) {
        const autoOpen = { [lista[0].id]: true };
        if (filtroOpId !== 'TODOS') {
          lista.forEach((o) => { autoOpen[o.id] = true; });
        }
        setExpandidos(prev => ({ ...prev, ...autoOpen }));
      }
    } catch (err) {
      console.error('Erro ao carregar dossiês:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [dataInicio, dataFim, filtroCliente, filtroEndereco, filtroOpId]);

  const handleBuscar = (e) => {
    e.preventDefault();
    carregarDados();
  };

  const toggleExpandir = (id) => {
    setExpandidos(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const expandirTodos = () => {
    const todos = {};
    dossies.forEach(d => { todos[d.id] = true; });
    setExpandidos(todos);
  };

  const recolherTodos = () => {
    setExpandidos({});
  };

  // Clientes e Endereços únicos para os filtros
  const clientesDisponiveis = useMemo(() => {
    const set = new Set(dossies.map(d => d.cliente).filter(Boolean));
    return Array.from(set);
  }, [dossies]);

  const enderecosDisponiveis = useMemo(() => {
    const set = new Set(dossies.map(d => d.endereco).filter(Boolean));
    return Array.from(set);
  }, [dossies]);

  // KPIs Totais do Relatório
  const kpis = useMemo(() => {
    const totalOps = dossies.length;
    const totalEntradaCaixas = dossies.reduce((s, d) => s + (Number(d.total_entrada_caixas ?? d.insumos?.length) || 0), 0);
    const totalEntradaKg = dossies.reduce((s, d) => s + (Number(d.total_entrada_kg) || 0), 0);
    const totalEntradaBrutoKg = dossies.reduce((s, d) => s + (Number(d.total_entrada_bruto_kg ?? d.total_entrada_kg) || 0), 0);
    const totalSaidaKg = dossies.reduce((s, d) => s + (Number(d.total_saida_kg) || 0), 0);
    const totalSaidaBrutoKg = dossies.reduce((s, d) => s + (Number(d.total_saida_bruto_kg ?? d.total_saida_kg) || 0), 0);
    const diferencaKg = totalSaidaKg - totalEntradaKg;
    const rendMedio = totalEntradaKg > 0 ? ((totalSaidaKg / totalEntradaKg) * 100).toFixed(1) : 0;
    const totalCaixasGeradas = dossies.reduce((s, d) => s + (Number(d.total_saida_caixas ?? d.retornos?.length) || 0), 0);
    const totalCaixasExpedidas = dossies.reduce((s, d) => s + (d.retornos ? d.retornos.filter(r => r.caixa_status === 'EXPEDIDA').length : 0), 0);
    return {
      totalOps,
      totalEntradaCaixas,
      totalEntradaKg,
      totalEntradaBrutoKg,
      totalSaidaKg,
      totalSaidaBrutoKg,
      diferencaKg,
      rendMedio,
      totalCaixasGeradas,
      totalCaixasExpedidas,
    };
  }, [dossies]);

  // Exportar Excel (.xlsx) estruturado
  const exportarExcel = async () => {
    if (dossies.length === 0) return;
    setExportando(true);
    try {
      const opObj = opsDisponiveis.find(o => String(o.id) === String(filtroOpId));
      await exportProducaoExcel({
        dossies,
        dataInicio,
        dataFim,
        opSelecionadaLabel: opObj ? `${opObj.codigo} — ${opObj.nome}` : '',
      });
    } catch (err) {
      console.error('Erro ao gerar Excel de produção:', err);
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="relatorio-dossie-root">
      {/* ─── ESTILOS ESPECÍFICOS: TELA VS IMPRESSÃO EXECUTIVA A4 ────────────────── */}
      <style>{`
        @media screen {
          .print-dossie-executive {
            display: none !important;
          }
        }

        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm 10mm 10mm 10mm;
          }

          /* Oculta rigorosamente tudo que não faz parte do dossiê executivo */
          body * {
            visibility: hidden !important;
          }

          .print-dossie-executive,
          .print-dossie-executive * {
            visibility: visible !important;
          }

          .screen-dossie-view,
          .no-print,
          nav,
          header,
          aside,
          .sidebar {
            display: none !important;
          }

          .print-dossie-executive {
            display: block !important;
            position: static !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            color: #0f172a !important;
            background: #ffffff !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
            font-size: 10px !important;
            line-height: 1.25 !important;
          }

          .print-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: flex-start !important;
            border-bottom: 2px solid #0f172a !important;
            padding-bottom: 6px !important;
            margin-bottom: 8px !important;
          }

          .print-brand-title {
            font-size: 15px !important;
            font-weight: 900 !important;
            letter-spacing: -0.3px !important;
            color: #0f172a !important;
          }

          .print-brand-sub {
            font-size: 8.5px !important;
            color: #475569 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
          }

          .print-doc-title {
            font-size: 12px !important;
            font-weight: 800 !important;
            color: #0f172a !important;
            text-align: right !important;
          }

          .print-doc-meta {
            display: flex !important;
            gap: 12px !important;
            font-size: 8.5px !important;
            color: #475569 !important;
            justify-content: flex-end !important;
            margin-top: 2px !important;
          }

          .print-kpi-bar {
            display: grid !important;
            grid-template-columns: repeat(6, 1fr) !important;
            gap: 6px !important;
            margin-bottom: 12px !important;
            background: #f8fafc !important;
            border: 1px solid #cbd5e1 !important;
            padding: 6px !important;
            border-radius: 4px !important;
          }

          .print-kpi-item {
            text-align: center !important;
            padding: 4px !important;
            border-right: 1px solid #e2e8f0 !important;
          }
          .print-kpi-item:last-child {
            border-right: none !important;
          }

          .print-kpi-label {
            display: block !important;
            font-size: 7.5px !important;
            font-weight: 700 !important;
            color: #64748b !important;
            text-transform: uppercase !important;
          }

          .print-kpi-val {
            display: block !important;
            font-size: 11px !important;
            font-weight: 900 !important;
            color: #0f172a !important;
            margin-top: 1px !important;
          }

          .print-kpi-item.highlight .print-kpi-val {
            color: #047857 !important;
          }

          .print-op-card {
            border: 1px solid #94a3b8 !important;
            border-radius: 4px !important;
            margin-bottom: 16px !important;
            break-inside: auto !important;
          }

          .print-op-header {
            display: flex !important;
            justify-content: space-between !important;
            background: #0f172a !important;
            color: #ffffff !important;
            padding: 5px 10px !important;
            font-size: 11px !important;
          }

          .print-op-meta-grid {
            display: flex !important;
            justify-content: space-between !important;
            background: #f1f5f9 !important;
            border-bottom: 1px solid #cbd5e1 !important;
            padding: 5px 10px !important;
            font-size: 9px !important;
          }

          .print-rend-highlight {
            color: #047857 !important;
            font-size: 10px !important;
          }

          .print-section-title {
            background: #e2e8f0 !important;
            color: #1e293b !important;
            font-size: 9px !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            padding: 3px 8px !important;
            letter-spacing: 0.3px !important;
            border-bottom: 1px solid #cbd5e1 !important;
          }

          .print-table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 8.5px !important;
          }

          .print-table th {
            background: #f8fafc !important;
            color: #334155 !important;
            font-weight: 700 !important;
            text-transform: uppercase !important;
            border-bottom: 1px solid #cbd5e1 !important;
            padding: 4px 6px !important;
            text-align: left !important;
            font-size: 8px !important;
          }

          .print-table td {
            border-bottom: 1px solid #e2e8f0 !important;
            padding: 3.5px 6px !important;
            color: #0f172a !important;
          }

          .print-tr-alt {
            background: #f8fafc !important;
          }

          .print-mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
            font-size: 8px !important;
          }

          .print-tfoot-row td {
            background: #f1f5f9 !important;
            border-top: 1.5px solid #94a3b8 !important;
            border-bottom: none !important;
            padding: 5px 6px !important;
            font-size: 9px !important;
          }

          .print-badge-expedida {
            display: inline-block !important;
            background: #e0f2fe !important;
            color: #0369a1 !important;
            border: 1px solid #bae6fd !important;
            border-radius: 3px !important;
            padding: 1px 4px !important;
            font-size: 7.5px !important;
            font-weight: 700 !important;
          }

          .print-badge-estoque {
            display: inline-block !important;
            background: #ecfdf5 !important;
            color: #047857 !important;
            border: 1px solid #a7f3d0 !important;
            border-radius: 3px !important;
            padding: 1px 4px !important;
            font-size: 7.5px !important;
            font-weight: 700 !important;
          }

          .print-audit-box {
            display: flex !important;
            justify-content: space-between !important;
            background: #f8fafc !important;
            border-top: 1.5px solid #cbd5e1 !important;
            padding: 6px 12px !important;
            font-size: 8.5px !important;
          }

          .print-audit-col {
            flex: 1 !important;
          }

          .print-audit-col.center {
            text-align: center !important;
            border-left: 1px solid #cbd5e1 !important;
            border-right: 1px solid #cbd5e1 !important;
            padding: 0 10px !important;
          }

          .print-audit-rend-label {
            font-size: 7.5px !important;
            font-weight: 800 !important;
            color: #64748b !important;
            text-transform: uppercase !important;
          }

          .print-audit-rend-value {
            font-size: 14px !important;
            font-weight: 900 !important;
            color: #047857 !important;
          }

.print-footer {
            display: flex !important;
            justify-content: space-between !important;
            border-top: 1px solid #cbd5e1 !important;
            padding-top: 4px !important;
            font-size: 7.5px !important;
            color: #94a3b8 !important;
            margin-top: 10px !important;
          }
        }
      `}</style>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODO TELA INTERATIVO (DARK THEME / WEB APP)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="screen-dossie-view">
        {/* CABEÇALHO DO RELATÓRIO NA TELA */}
        <div className="flex justify-between items-center mb-16 flex-wrap gap-12">
          <div>
            <h2 className="text-xl font-black flex items-center gap-8">
              <Factory className="text-primary" size={24} />
              {titulo}
            </h2>
            <p className="text-xs text-muted mt-2">
              Rastreabilidade permanente de matérias-primas consumidas e produtos gerados, com status de romaneio e estoque.
            </p>
          </div>
          <div className="flex gap-8">
            <a 
              href="/etiquetas_producao_pavan.html" 
              target="_blank" 
              rel="noreferrer"
              className="btn btn--secondary btn--sm"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Abrir página de impressão das etiquetas térmicas da produção"
            >
              🏷️ Etiquetas Térmicas (PAVAN)
            </a>
            <button className="btn btn--secondary btn--sm" onClick={exportarExcel} disabled={exportando || dossies.length === 0} title="Exportar relatório completo para Excel (.xlsx)">
              <Download size={15} /> {exportando ? 'Gerando Excel...' : 'Exportar Excel (.xlsx)'}
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => window.print()} title="Imprimir ou Salvar em PDF">
              <Printer size={15} /> Imprimir / PDF
            </button>
          </div>
        </div>

        {/* FILTROS */}
        <div className="card p-16 mb-20" style={{ background: 'var(--bg-2)' }}>
          <form onSubmit={handleBuscar} className="flex gap-12 items-end flex-wrap">
            <div className="form-group mb-0" style={{ minWidth: 250 }}>
              <label className="text-xs text-muted font-bold uppercase mb-4 block">Ordem de Produção (OP)</label>
              <SmartSearchSelect
                items={opsDisponiveis}
                value={filtroOpId === 'TODOS' ? '' : String(filtroOpId)}
                onChange={(val) => setFiltroOpId(val || 'TODOS')}
                compact
                icon="product"
                getValue={(op) => String(op.id)}
                getCode={(op) => String(op.codigo || '')}
                getLabel={(op) => String(op.nome || op.codigo || '')}
                getSubLabel={(op) => `Status: ${op.status || '-'}`}
                emptyLabel="Todas as OPs no período"
                placeholder="Pesquisar OP (código, nome)..."
                modalTitle="Selecionar Ordem de Produção (OP)"
              />
            </div>
            <div className="form-group mb-0" style={{ minWidth: 140 }}>
              <label className="text-xs text-muted font-bold uppercase mb-4 block">Data Inicial</label>
              <input 
                type="date" 
                className="form-input form-input--sm" 
                value={dataInicio} 
                onChange={e => setDataInicio(e.target.value)} 
              />
            </div>
            <div className="form-group mb-0" style={{ minWidth: 140 }}>
              <label className="text-xs text-muted font-bold uppercase mb-4 block">Data Final</label>
              <input 
                type="date" 
                className="form-input form-input--sm" 
                value={dataFim} 
                onChange={e => setDataFim(e.target.value)} 
              />
            </div>

            {clientesDisponiveis.length > 0 && (
              <div className="form-group mb-0" style={{ minWidth: 210 }}>
                <label className="text-xs text-muted font-bold uppercase mb-4 block">Cliente</label>
                <SmartSearchSelect
                  items={clientesDisponiveis.map((c) => ({ id: c, nome: c }))}
                  value={filtroCliente === 'TODOS' ? '' : filtroCliente}
                  onChange={(val) => setFiltroCliente(val || 'TODOS')}
                  compact
                  icon="client"
                  getValue={(c) => c.id}
                  getCode={() => ''}
                  getLabel={(c) => c.nome}
                  emptyLabel="Todos os Clientes"
                  placeholder="Filtrar cliente..."
                  modalTitle="Filtrar por Cliente"
                />
              </div>
            )}

            {!enderecoFixo && enderecosDisponiveis.length > 0 && (
              <div className="form-group mb-0" style={{ minWidth: 200 }}>
                <label className="text-xs text-muted font-bold uppercase mb-4 block">Local / Endereço</label>
                <SmartSearchSelect
                  items={enderecosDisponiveis.map((end) => ({ id: end, nome: end }))}
                  value={filtroEndereco === 'TODOS' ? '' : filtroEndereco}
                  onChange={(val) => setFiltroEndereco(val || 'TODOS')}
                  compact
                  icon="location"
                  getValue={(e) => e.id}
                  getCode={() => ''}
                  getLabel={(e) => e.nome}
                  emptyLabel="Todos os Locais"
                  placeholder="Filtrar endereço..."
                  modalTitle="Filtrar por Local / Endereço"
                />
              </div>
            )}

            <div className="form-group mb-0 flex-1" style={{ minWidth: 200 }}>
              <label className="text-xs text-muted font-bold uppercase mb-4 block">Busca por OP, EAN ou Produto</label>
              <div className="relative">
                <Search size={14} className="absolute left-10 top-10 text-muted" />
                <input 
                  type="text" 
                  placeholder="Ex: OP-0001, PAVAN, Blend, ou bipe o EAN..." 
                  className="form-input form-input--sm pl-32 w-full"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="btn btn--primary btn--sm" disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Filtrar
            </button>
          </form>
        </div>

        {/* KPIS GERAIS NO TOPO DA TELA */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-12 mb-20">
          <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs text-muted font-bold uppercase">Produções</div>
            <div className="text-lg font-black text-primary mt-4">{kpis.totalOps} OPs</div>
          </div>
          <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs text-muted font-bold uppercase">Entrada Líquida ({kpis.totalEntradaCaixas} cx)</div>
            <div className="text-lg font-black text-warning mt-4">{fmtKg(kpis.totalEntradaKg)}</div>
          </div>
          <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs text-muted font-bold uppercase">Saída Bruta</div>
            <div className="text-lg font-black mt-4" style={{ color: 'var(--text-primary)' }}>{fmtKg(kpis.totalSaidaBrutoKg)}</div>
          </div>
          <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs text-muted font-bold uppercase">Saída Líquida ({kpis.totalCaixasGeradas} cx)</div>
            <div className="text-lg font-black text-success mt-4">{fmtKg(kpis.totalSaidaKg)}</div>
          </div>
          <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs text-muted font-bold uppercase">Diferença / Quebra</div>
            <div className="text-lg font-black mt-4" style={{ color: kpis.diferencaKg >= 0 ? 'var(--success)' : '#fb923c' }}>
              {kpis.diferencaKg >= 0 ? '+' : ''}{fmtKg(kpis.diferencaKg)}
            </div>
          </div>
          <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs text-muted font-bold uppercase">Rendimento Médio</div>
            <div className="text-lg font-black mt-4" style={{ color: Number(kpis.rendMedio) >= 90 ? 'var(--success)' : 'var(--primary)' }}>
              {kpis.rendMedio}%
            </div>
          </div>
        </div>

        {/* BOTÕES DE EXPANDIR/RECOLHER */}
        <div className="flex justify-between items-center mb-12">
          <div className="text-xs text-muted font-bold">
            Exibindo {dossies.length} produção(ões) encontrada(s)
          </div>
          <div className="flex gap-8 text-xs">
            <button className="text-primary hover:underline font-bold" onClick={expandirTodos}>Expandir Todos</button>
            <span>•</span>
            <button className="text-muted hover:underline" onClick={recolherTodos}>Recolher Todos</button>
          </div>
        </div>

        {/* LISTAGEM DOS DOSSIÊS NA TELA */}
        {dossies.length === 0 ? (
          <div className="card p-32 text-center text-muted">
            <Factory size={36} className="mx-auto mb-12 opacity-30" />
            <p className="font-bold">Nenhum dossiê de produção encontrado com os filtros selecionados.</p>
          </div>
        ) : (
          <div className="space-y-16">
            {dossies.map(op => {
              const isExp = !!expandidos[op.id];
              const rend = op.rendimento_calc || 0;
              const rendColor = rend >= 90 ? 'var(--success)' : rend >= 80 ? 'var(--primary)' : 'var(--warning)';

              return (
                <div 
                  key={op.id} 
                  className="card overflow-hidden transition-all"
                  style={{ 
                    background: 'var(--bg-1)', 
                    border: isExp ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: 12
                  }}
                >
                  {/* CABEÇALHO DO CARD DA OP */}
                  <div 
                    className="flex items-center justify-between p-16 cursor-pointer select-none"
                    onClick={() => toggleExpandir(op.id)}
                    style={{ background: isExp ? 'rgba(var(--primary-rgb), 0.05)' : 'transparent' }}
                  >
                    <div className="flex items-center gap-16 flex-wrap">
                      <div className="w-28 h-28 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {isExp ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-8 flex-wrap">
                          <span className="font-mono text-sm font-black text-primary">{op.codigo}</span>
                          <span className="font-bold text-base">{op.nome}</span>
                          <span className="text-xs px-8 py-2 rounded-full font-bold bg-border/40 text-muted">
                            {op.endereco || 'PRODUÇÃO'}
                          </span>
                          {op.cliente && (
                            <span className="text-xs px-8 py-2 rounded-full font-bold bg-primary/15 text-primary border border-primary/30">
                              Cliente: {op.cliente}
                            </span>
                          )}
                          <span className={`text-xs px-8 py-2 rounded-full font-bold ${
                            op.status === 'FECHADA' ? 'bg-success/15 text-success border border-success/30' : 'bg-warning/15 text-warning border border-warning/30'
                          }`}>
                            {op.status === 'FECHADA' ? 'Finalizada' : op.status}
                          </span>
                        </div>
                        <div className="text-xs text-muted mt-4 flex items-center gap-12 flex-wrap">
                          <span>📅 Abertura/Prod.: <strong>{fmtDate(op.data_producao)}</strong></span>
                          {!modoCliente && (
                            <span>👤 Criador: <strong>{op.criado_por_nome || op.operador_nome || 'Administrador'}</strong></span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-24 text-right">
                      <div>
                        <div className="text-xs text-muted">Entrada ({op.total_entrada_caixas ?? (op.insumos?.length || 0)} cx)</div>
                        <div className="font-mono font-bold text-warning">{fmtKg(op.total_entrada_kg)}</div>
                      </div>
                      <div className="text-muted font-bold">➔</div>
                      <div>
                        <div className="text-xs text-muted">Saída ({op.total_saida_caixas ?? (op.retornos?.length || 0)} cx)</div>
                        <div className="font-mono font-bold text-success">{fmtKg(op.total_saida_kg)}</div>
                        <div className="text-[10px] text-muted">Bruto: {fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)}</div>
                      </div>
                      <div className="border-l border-border pl-16">
                        <div className="text-xs text-muted">Rendimento</div>
                        <div className="font-mono font-black text-lg" style={{ color: rendColor }}>
                          {rend}%
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CORPO EXPANSÍVEL: INSUMOS VS RETORNOS */}
                  {isExp && (
                    <div className="p-16 border-t border-border" style={{ background: 'var(--bg-2)' }}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                        
                        {/* ── COLUNA 1: INSUMOS ── */}
                        <div className="card p-12 bg-bg-1 border border-border">
                          <div className="flex justify-between items-center mb-8 border-b border-border pb-6">
                            <div className="flex items-center gap-6 font-bold text-sm text-warning">
                              <Layers size={16} /> Entradas na Produção (Matéria-Prima)
                            </div>
                            <span className="text-xs text-muted font-mono font-bold">
                              {op.total_entrada_caixas ?? (op.insumos ? op.insumos.length : 0)} cx | Bruto: {fmtKg(op.total_entrada_bruto_kg ?? op.total_entrada_kg)} | Líq: {fmtKg(op.total_entrada_kg)}
                            </span>
                          </div>

                          {!op.insumos || op.insumos.length === 0 ? (
                            <div className="text-muted text-xs p-16 text-center">Nenhum insumo registrado nesta OP.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted text-[11px] border-b border-border text-left">
                                    <th className="py-4">Produto</th>
                                    <th className="py-4">EAN</th>
                                    <th className="py-4">Lote</th>
                                    <th className="py-4">Validade</th>
                                    <th className="py-4 text-right">Peças</th>
                                    <th className="py-4 text-right">Bruto</th>
                                    <th className="py-4 text-right">Líquido</th>
                                    <th className="py-4">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {op.insumos.map((ins, idx) => {
                                    const liq = Number(ins.peso_kg || 0);
                                    const bruto = ins.peso_bruto_kg != null ? Number(ins.peso_bruto_kg) : Number((liq + Number(ins.tara_kg || 0)).toFixed(2));
                                    return (
                                      <tr key={idx} className="border-b border-border hover:bg-bg-1">
                                        <td className="py-6 font-bold">{ins.produto_descricao}</td>
                                        <td className="py-6 font-mono text-muted">{ins.ean_caixa}</td>
                                        <td className="py-6 font-mono">{ins.lote || '-'}</td>
                                        <td className="py-6">{fmtDate(ins.validade)}</td>
                                        <td className="py-6 text-right font-mono">{ins.qtd_pecas != null ? `${ins.qtd_pecas} pç` : '-'}</td>
                                        <td className="py-6 text-right font-mono text-muted">{fmtNum(bruto)}</td>
                                        <td className="py-6 text-right font-mono font-bold text-warning">{fmtNum(liq)}</td>
                                        <td className="py-6">
                                          <span className="text-[10px] uppercase font-bold text-muted px-4 py-1 rounded bg-bg-2 border border-border">
                                            {ins.caixa_status || 'CONSUMIDA'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="font-bold border-t border-border">
                                    <td colSpan={5} className="pt-8 text-muted">Total Entrada ({op.total_entrada_caixas ?? op.insumos.length} cx):</td>
                                    <td className="pt-8 text-right font-mono text-muted">{fmtKg(op.total_entrada_bruto_kg ?? op.total_entrada_kg)}</td>
                                    <td className="pt-8 text-right font-mono text-warning text-sm">{fmtKg(op.total_entrada_kg)}</td>
                                    <td></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          )}
                        </div>

                        {/* ── COLUNA 2: RETORNOS ── */}
                        <div className="card p-12 bg-bg-1 border border-border">
                          <div className="flex justify-between items-center mb-8 border-b border-border pb-6">
                            <div className="flex items-center gap-6 font-bold text-sm text-success">
                              <Package size={16} /> Saídas da Produção (Produtos Gerados)
                            </div>
                            <span className="text-xs text-muted font-mono font-bold">
                              {op.total_saida_caixas ?? (op.retornos ? op.retornos.length : 0)} cx | Bruto: {fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)} | Líq: {fmtKg(op.total_saida_kg)}
                            </span>
                          </div>

                          {!op.retornos || op.retornos.length === 0 ? (
                            <div className="text-muted text-xs p-16 text-center">Nenhum produto gerado registrado nesta OP.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted text-[11px] border-b border-border text-left">
                                    <th className="py-4">Produto Gerado</th>
                                    <th className="py-4">EAN Gerado</th>
                                    <th className="py-4">Lote</th>
                                    <th className="py-4">Prod / Val</th>
                                    <th className="py-4 text-right">Peças</th>
                                    <th className="py-4 text-right">Tara</th>
                                    <th className="py-4 text-right">Bruto</th>
                                    <th className="py-4 text-right">Líquido</th>
                                    <th className="py-4">Rastreabilidade</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {op.retornos.map((ret, idx) => {
                                    const isExpedida = ret.caixa_status === 'EXPEDIDA';
                                    const liq = Number(ret.peso_kg || 0);
                                    const tara = Number(ret.tara_kg || 0);
                                    const bruto = ret.peso_bruto_kg != null ? Number(ret.peso_bruto_kg) : Number((liq + tara).toFixed(2));
                                    return (
                                      <tr key={idx} className="border-b border-border hover:bg-bg-1">
                                        <td className="py-6 font-bold">{ret.produto_descricao}</td>
                                        <td className="py-6 font-mono text-muted">{ret.ean_caixa}</td>
                                        <td className="py-6 font-mono">{ret.lote || '-'}</td>
                                        <td className="py-6 text-[11px]">
                                          <div>P: {fmtDate(ret.data_producao || op.data_producao)}</div>
                                          <div className="text-muted">V: {fmtDate(ret.validade)}</div>
                                        </td>
                                        <td className="py-6 text-right font-mono">{ret.qtd_pecas != null ? `${ret.qtd_pecas} pç` : '-'}</td>
                                        <td className="py-6 text-right font-mono text-muted">{fmtKg3(tara)}</td>
                                        <td className="py-6 text-right font-mono text-muted">{fmtNum(bruto)}</td>
                                        <td className="py-6 text-right font-mono font-bold text-success">{fmtNum(liq)}</td>
                                        <td className="py-6">
                                          {isExpedida ? (
                                            <div className="flex items-center gap-4 text-info font-bold text-[11px]">
                                              <Truck size={13} />
                                              <span>Expedida ({ret.romaneio_codigo || 'Romaneio'})</span>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-4 text-success font-bold text-[11px]">
                                              <CheckCircle size={13} />
                                              <span>Em Estoque ({ret.caixa_endereco || op.endereco})</span>
                                            </div>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="font-bold border-t border-border">
                                    <td colSpan={5} className="pt-8 text-muted">Total Saída ({op.total_saida_caixas ?? op.retornos.length} cx):</td>
                                    <td className="pt-8 text-right font-mono text-muted">{fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)}</td>
                                    <td className="pt-8 text-right font-mono text-success text-sm">{fmtKg(op.total_saida_kg)}</td>
                                    <td></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          )}
                        </div>

                      </div>

                      {/* ── NOTA DE AUDITORIA / CONSOLIDAÇÃO DO RENDIMENTO ── */}
                      <div className="mt-12 p-10 rounded bg-bg-2 border border-border flex justify-between items-center flex-wrap gap-8 text-xs">
                        <div className="text-muted">
                          ⚖️ Consolidação da OP:
                          Entrada <strong>{op.total_entrada_caixas ?? op.insumos?.length ?? 0} cx / {fmtKg(op.total_entrada_kg)}</strong> ➔
                          Saída <strong>{op.total_saida_caixas ?? op.retornos?.length ?? 0} cx</strong> (Bruto: <strong>{fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)}</strong> | Líq.: <strong>{fmtKg(op.total_saida_kg)}</strong>)
                          {op.diferenca_kg !== 0 && (
                            <span className="ml-8 font-mono">
                              ({op.diferenca_kg > 0 ? `+${op.diferenca_kg} kg ganho` : `${op.diferenca_kg} kg diferença/quebra`})
                            </span>
                          )}
                        </div>
                        <div>
                          Rendimento: <strong className="font-mono text-sm" style={{ color: rendColor }}>{rend}%</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          VISUALIZAÇÃO EXECUTIVA DE IMPRESSÃO / PDF (SOMENTE NA IMPRESSÃO)
          Formatado especificamente para apresentação à Diretoria e Gerência.
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="print-dossie-executive">
        {/* CABEÇALHO INSTITUCIONAL FORMAL */}
        <div className="print-header">
          <div className="print-header-left">
            <div className="print-brand-title">TRICARNES ALIMENTOS LTDA.</div>
            <div className="print-brand-sub">WMSphere ERP — Sistema Integrado de Gestão & Rastreabilidade Frigorífica</div>
          </div>
          <div className="print-header-right">
            <div className="print-doc-title">DOSSIÊ EXECUTIVO DE PRODUÇÃO & RENDIMENTO</div>
            <div className="print-doc-meta">
              <span><strong>Emissão:</strong> {new Date().toLocaleString('pt-BR')}</span>
              <span><strong>Período:</strong> {fmtDate(dataInicio)} a {fmtDate(dataFim)}</span>
            </div>
          </div>
        </div>

        {/* FAIXA RESUMO GERENCIAL / AUDITORIA */}
        <div className="print-kpi-bar">
          <div className="print-kpi-item">
            <span className="print-kpi-label">PRODUÇÕES (OPS)</span>
            <span className="print-kpi-val">{kpis.totalOps} OP(s)</span>
          </div>
          <div className="print-kpi-item">
            <span className="print-kpi-label">INSUMOS CONSUMIDOS</span>
            <span className="print-kpi-val">{fmtKg(kpis.totalEntradaKg)}</span>
          </div>
          <div className="print-kpi-item">
            <span className="print-kpi-label">PRODUTOS GERADOS</span>
            <span className="print-kpi-val">{fmtKg(kpis.totalSaidaKg)}</span>
          </div>
          <div className="print-kpi-item">
            <span className="print-kpi-label">VARIAÇÃO / BALANÇO</span>
            <span className="print-kpi-val">{kpis.diferencaKg >= 0 ? `+${fmtKg(kpis.diferencaKg)}` : fmtKg(kpis.diferencaKg)}</span>
          </div>
          <div className="print-kpi-item highlight">
            <span className="print-kpi-label">RENDIMENTO MÉDIO</span>
            <span className="print-kpi-val">{kpis.rendMedio}%</span>
          </div>
          <div className="print-kpi-item">
            <span className="print-kpi-label">CAIXAS TOTAIS</span>
            <span className="print-kpi-val">{kpis.totalCaixasGeradas} cx ({kpis.totalCaixasExpedidas} expedidas)</span>
          </div>
        </div>

        {/* CADA ORDEM DE PRODUÇÃO */}
        {dossies.map((op) => {
          const rend = op.rendimento_calc || 0;
          return (
            <div key={op.id} className="print-op-card">
              {/* BARRA DA OP */}
              <div className="print-op-header">
                <div className="print-op-title">
                  ORDEM DE PRODUÇÃO: <strong>{op.codigo}</strong> — {op.nome}
                </div>
                <div className="print-op-status">
                  STATUS: <strong>{op.status}</strong>
                </div>
              </div>

              {/* DADOS CADASTRAIS DA PRODUÇÃO */}
              <div className="print-op-meta-grid">
                <div><span>Cliente / Destino:</span> <strong>{op.cliente || 'PAVAN'}</strong></div>
                <div><span>Local / Endereço:</span> <strong>{op.endereco || 'PRODUÇÃO'}</strong></div>
                <div><span>Data Abertura/Prod.:</span> <strong>{fmtDate(op.data_producao)}</strong></div>
                {!modoCliente && (
                  <div><span>Criador:</span> <strong>{op.criado_por_nome || op.operador_nome || 'Administrador'}</strong></div>
                )}
                <div><span>Rendimento da OP:</span> <strong className="print-rend-highlight">{rend}%</strong></div>
              </div>

              {/* TABELA 1: MATÉRIA-PRIMA UTILIZADA (ENTRADA) */}
              <div className="print-section-title">
                1. ENTRADAS NA PRODUÇÃO (MATÉRIA-PRIMA) — {op.total_entrada_caixas ?? (op.insumos ? op.insumos.length : 0)} caixas | Bruto: {fmtKg(op.total_entrada_bruto_kg ?? op.total_entrada_kg)} | Líquido: {fmtKg(op.total_entrada_kg)}
              </div>
              <table className="print-table">
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}>#</th>
                    <th style={{ width: '8%' }}>Código</th>
                    <th style={{ width: '25%' }}>Descrição da Matéria-Prima</th>
                    <th style={{ width: '19%' }}>EAN da Caixa Física</th>
                    <th style={{ width: '8%' }}>Lote</th>
                    <th style={{ width: '9%' }}>Validade</th>
                    <th style={{ width: '6%', textAlign: 'right' }}>Peças</th>
                    <th style={{ width: '10%', textAlign: 'right' }}>Bruto (Kg)</th>
                    <th style={{ width: '11%', textAlign: 'right' }}>Líquido (Kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {op.insumos && op.insumos.map((ins, i) => {
                    const liq = Number(ins.peso_kg || 0);
                    const bruto = ins.peso_bruto_kg != null ? Number(ins.peso_bruto_kg) : Number((liq + Number(ins.tara_kg || 0)).toFixed(2));
                    return (
                      <tr key={i} className={i % 2 === 1 ? 'print-tr-alt' : ''}>
                        <td style={{ textAlign: 'center' }}>{i + 1}</td>
                        <td className="print-mono">{ins.produto_codigo || '-'}</td>
                        <td><strong>{ins.produto_descricao}</strong></td>
                        <td className="print-mono">{ins.ean_caixa}</td>
                        <td className="print-mono" style={{ textAlign: 'center' }}>{ins.lote || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{fmtDate(ins.validade)}</td>
                        <td className="print-mono" style={{ textAlign: 'right' }}>{ins.qtd_pecas != null ? `${ins.qtd_pecas} pç` : '-'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(bruto)} kg</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(liq)} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="print-tfoot-row">
                    <td colSpan={7} style={{ textAlign: 'right' }}><strong>TOTAL DE ENTRADAS ({op.total_entrada_caixas ?? (op.insumos ? op.insumos.length : 0)} cx):</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(op.total_entrada_bruto_kg ?? op.total_entrada_kg)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(op.total_entrada_kg)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* TABELA 2: PRODUTOS FABRICADOS (SAÍDA) */}
              <div className="print-section-title" style={{ marginTop: '8px' }}>
                2. SAÍDAS DA PRODUÇÃO (PRODUTOS GERADOS) — {op.total_saida_caixas ?? (op.retornos ? op.retornos.length : 0)} caixas | Bruto: {fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)} | Líquido: {fmtKg(op.total_saida_kg)}
              </div>
              <table className="print-table">
                <thead>
                  <tr>
                    <th style={{ width: '3%' }}>#</th>
                    <th style={{ width: '6%' }}>Cód.</th>
                    <th style={{ width: '19%' }}>Produto Gerado</th>
                    <th style={{ width: '15%' }}>EAN Gerado</th>
                    <th style={{ width: '7%' }}>Lote</th>
                    <th style={{ width: '8%' }}>Data Prod.</th>
                    <th style={{ width: '8%' }}>Validade</th>
                    <th style={{ width: '6%', textAlign: 'right' }}>Peças</th>
                    <th style={{ width: '7%', textAlign: 'right' }}>Tara</th>
                    <th style={{ width: '7%', textAlign: 'right' }}>Bruto</th>
                    <th style={{ width: '7%', textAlign: 'right' }}>Líquido</th>
                    <th style={{ width: '13%' }}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {op.retornos && op.retornos.map((ret, i) => {
                    const isExp = ret.caixa_status === 'EXPEDIDA';
                    const liq = Number(ret.peso_kg || 0);
                    const tara = Number(ret.tara_kg || 0);
                    const bruto = ret.peso_bruto_kg != null ? Number(ret.peso_bruto_kg) : Number((liq + tara).toFixed(2));
                    return (
                      <tr key={i} className={i % 2 === 1 ? 'print-tr-alt' : ''}>
                        <td style={{ textAlign: 'center' }}>{i + 1}</td>
                        <td className="print-mono">{ret.produto_codigo || '-'}</td>
                        <td><strong>{ret.produto_descricao}</strong></td>
                        <td className="print-mono">{ret.ean_caixa}</td>
                        <td className="print-mono" style={{ textAlign: 'center' }}>{ret.lote || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{fmtDate(ret.data_producao || op.data_producao)}</td>
                        <td style={{ textAlign: 'center' }}>{fmtDate(ret.validade)}</td>
                        <td className="print-mono" style={{ textAlign: 'right' }}>{ret.qtd_pecas != null ? `${ret.qtd_pecas} pç` : '-'}</td>
                        <td style={{ textAlign: 'right' }}>{tara.toFixed(3).replace('.', ',')} kg</td>
                        <td style={{ textAlign: 'right' }}>{fmtNum(bruto)} kg</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(liq)} kg</td>
                        <td>
                          {isExp ? (
                            <span className="print-badge-expedida">EXPEDIDA ({ret.romaneio_codigo || 'ROMANEIO'})</span>
                          ) : (
                            <span className="print-badge-estoque">EM ESTOQUE ({ret.caixa_endereco || op.endereco})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="print-tfoot-row">
                    <td colSpan={9} style={{ textAlign: 'right' }}><strong>TOTAL DE SAÍDAS ({op.total_saida_caixas ?? (op.retornos ? op.retornos.length : 0)} cx):</strong></td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(op.total_saida_kg)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>

              {/* BALANÇO OFICIAL / CONSOLIDAÇÃO DE RENDIMENTO */}
              <div className="print-audit-box">
                <div className="print-audit-col">
                  <div><strong>Caixas Entrada / Saída:</strong> {op.total_entrada_caixas ?? (op.insumos?.length || 0)} cx ➔ {op.total_saida_caixas ?? (op.retornos?.length || 0)} cx</div>
                  <div><strong>Peso Entrada (Líquido):</strong> {fmtKg(op.total_entrada_kg)}</div>
                  <div><strong>Peso Saída Bruto / Líquido:</strong> {fmtKg(op.total_saida_bruto_kg ?? op.total_saida_kg)} / {fmtKg(op.total_saida_kg)}</div>
                </div>
                <div className="print-audit-col center">
                  <div className="print-audit-rend-label">RENDIMENTO INDUSTRIAL</div>
                  <div className="print-audit-rend-value">{rend}%</div>
                  <div style={{ fontSize: '8px', marginTop: '2px' }}>
                    Diferença: {op.diferenca_kg >= 0 ? `+${op.diferenca_kg}` : op.diferenca_kg} kg
                  </div>
                </div>
                <div className="print-audit-col">
                  <div><strong>Status da OP:</strong> {op.status}</div>
                  <div><strong>Caixas Expedidas:</strong> {op.retornos ? op.retornos.filter(r => r.caixa_status === 'EXPEDIDA').length : 0} cx</div>
                  <div><strong>Caixas em Estoque:</strong> {op.retornos ? op.retornos.filter(r => r.caixa_status !== 'EXPEDIDA').length : 0} cx</div>
                </div>
              </div>


            </div>
          );
        })}

        {/* RODAPÉ DO RELATÓRIO */}
        <div className="print-footer">
          <span>WMSphere ERP — Inteligência e Rastreabilidade Operacional</span>
          <span>Dossiê Permanente de Auditoria Frigorífica</span>
          <span>Documento Emitido para Fins Gerenciais</span>
        </div>
      </div>
    </div>
  );
}

export default RelatorioDossieProducao;
