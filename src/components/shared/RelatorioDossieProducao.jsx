import React, { useState, useEffect, useMemo } from 'react';
import { 
  Factory, Search, Download, Printer, ChevronDown, ChevronRight, 
  Calendar, CheckCircle, Truck, Package, Layers, RefreshCw, ArrowRight,
  TrendingUp, Scale, AlertCircle
} from 'lucide-react';
import * as producaoQueries from '../../queries/producao';

const fmtKg = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return '-';
  const s = String(d).split('T')[0];
  const parts = s.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
};

export function RelatorioDossieProducao({ titulo = "Dossiê de Transformação & Rendimento", enderecoFixo = null }) {
  const [loading, setLoading] = useState(false);
  const [dossies, setDossies] = useState([]);
  
  // Filtros
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    return d.toISOString().slice(0, 10);
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtroCliente, setFiltroCliente] = useState('TODOS');
  const [filtroEndereco, setFiltroEndereco] = useState(enderecoFixo || 'TODOS');
  const [busca, setBusca] = useState('');
  
  // Controle de cards expandidos (por padrão, o mais recente vem expandido)
  const [expandidos, setExpandidos] = useState({});

  const carregarDados = async () => {
    setLoading(true);
    try {
      const lista = await producaoQueries.listarDossiesProducao({
        dataInicio,
        dataFim,
        cliente: filtroCliente,
        endereco: enderecoFixo || filtroEndereco,
        busca
      });
      setDossies(lista);
      if (lista.length > 0) {
        setExpandidos(prev => ({ ...prev, [lista[0].id]: true }));
      }
    } catch (err) {
      console.error('Erro ao carregar dossiês:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [dataInicio, dataFim, filtroCliente, filtroEndereco]);

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
    const totalEntradaKg = dossies.reduce((s, d) => s + (Number(d.total_entrada_kg) || 0), 0);
    const totalSaidaKg = dossies.reduce((s, d) => s + (Number(d.total_saida_kg) || 0), 0);
    const diferencaKg = totalSaidaKg - totalEntradaKg;
    const rendMedio = totalEntradaKg > 0 ? ((totalSaidaKg / totalEntradaKg) * 100).toFixed(1) : 0;
    const totalCaixasGeradas = dossies.reduce((s, d) => s + (d.retornos ? d.retornos.length : 0), 0);
    const totalCaixasExpedidas = dossies.reduce((s, d) => s + (d.retornos ? d.retornos.filter(r => r.caixa_status === 'EXPEDIDA').length : 0), 0);
    return { totalOps, totalEntradaKg, totalSaidaKg, diferencaKg, rendMedio, totalCaixasGeradas, totalCaixasExpedidas };
  }, [dossies]);

  // Exportar Excel (CSV)
  const exportarCSV = () => {
    if (dossies.length === 0) return;
    const header = [
      'OP_CODIGO',
      'OP_NOME',
      'CLIENTE',
      'ENDERECO_PRODUCAO',
      'DATA_PRODUCAO',
      'STATUS_OP',
      'TIPO_REGISTRO', // ENTRADA (INSUMO) ou SAIDA (RETORNO)
      'PRODUTO_CODIGO',
      'PRODUTO_DESCRICAO',
      'EAN_CAIXA',
      'PESO_KG',
      'VALIDADE',
      'LOTE',
      'SITUACAO_CAIXA',
      'ROMANEIO_DESTINO',
      'ROMANEIO_CLIENTE',
      'ROMANEIO_DATA_EXPEDICAO'
    ].join(';') + '\n';

    const rows = [];
    dossies.forEach(op => {
      // Insumos
      (op.insumos || []).forEach(ins => {
        rows.push([
          op.codigo,
          `"${op.nome}"`,
          `"${op.cliente || ''}"`,
          `"${op.endereco || ''}"`,
          fmtDate(op.data_producao),
          op.status,
          'ENTRADA (INSUMO)',
          ins.produto_codigo || '',
          `"${ins.produto_descricao || ''}"`,
          `'${ins.ean_caixa || ''}'`,
          String(Number(ins.peso_kg || 0).toFixed(2)).replace('.', ','),
          fmtDate(ins.validade),
          ins.lote || '',
          'CONSUMIDA',
          '',
          '',
          ''
        ].join(';'));
      });

      // Retornos
      (op.retornos || []).forEach(ret => {
        rows.push([
          op.codigo,
          `"${op.nome}"`,
          `"${op.cliente || ''}"`,
          `"${op.endereco || ''}"`,
          fmtDate(op.data_producao),
          op.status,
          'SAIDA (PRODUTO GERADO)',
          ret.produto_codigo || '',
          `"${ret.produto_descricao || ''}"`,
          `'${ret.ean_caixa || ''}'`,
          String(Number(ret.peso_kg || 0).toFixed(2)).replace('.', ','),
          fmtDate(ret.validade),
          ret.lote || '',
          ret.caixa_status || 'DISPONIVEL',
          ret.romaneio_codigo || '',
          `"${ret.romaneio_cliente || ''}"`,
          ret.romaneio_expedido_em ? fmtDate(ret.romaneio_expedido_em) : ''
        ].join(';'));
      });
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(header + rows.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `dossie_producao_transformacao_${dataInicio}_${dataFim}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="relatorio-dossie-root">
      {/* Estilos específicos para visualização em tela e para impressão/PDF */}
      <style>{`
        @media print {
          body { background: #fff !important; color: #000 !important; }
          .no-print, header, nav, .sidebar, .btn, .page-header { display: none !important; }
          .relatorio-dossie-root { padding: 0 !important; width: 100% !important; }
          .card-dossie { border: 1px solid #ccc !important; box-shadow: none !important; margin-bottom: 24px !important; page-break-inside: avoid; }
          .lado-a-lado { display: flex !important; flex-direction: row !important; gap: 12px !important; }
          .bloco-print { flex: 1 !important; border: 1px solid #ddd !important; padding: 8px !important; }
          table { width: 100% !important; border-collapse: collapse !important; font-size: 11px !important; }
          th, td { border: 1px solid #ddd !important; padding: 4px 6px !important; color: #000 !important; }
        }
      `}</style>

      {/* ── CABEÇALHO DO RELATÓRIO ── */}
      <div className="flex justify-between items-center mb-16 flex-wrap gap-12 no-print">
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
          <button className="btn btn--secondary btn--sm" onClick={exportarCSV} title="Exportar dados completos para Excel/CSV">
            <Download size={15} /> Exportar Excel
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => window.print()} title="Imprimir ou Salvar em PDF">
            <Printer size={15} /> Imprimir / PDF
          </button>
        </div>
      </div>

      {/* ── FILTROS ── */}
      <div className="card p-16 mb-20 no-print" style={{ background: 'var(--bg-2)' }}>
        <form onSubmit={handleBuscar} className="flex gap-12 items-end flex-wrap">
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
            <div className="form-group mb-0" style={{ minWidth: 150 }}>
              <label className="text-xs text-muted font-bold uppercase mb-4 block">Cliente</label>
              <select 
                className="form-input form-input--sm"
                value={filtroCliente}
                onChange={e => setFiltroCliente(e.target.value)}
              >
                <option value="TODOS">Todos os Clientes</option>
                {clientesDisponiveis.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {!enderecoFixo && enderecosDisponiveis.length > 0 && (
            <div className="form-group mb-0" style={{ minWidth: 160 }}>
              <label className="text-xs text-muted font-bold uppercase mb-4 block">Local / Endereço</label>
              <select 
                className="form-input form-input--sm"
                value={filtroEndereco}
                onChange={e => setFiltroEndereco(e.target.value)}
              >
                <option value="TODOS">Todos os Locais</option>
                {enderecosDisponiveis.map(end => (
                  <option key={end} value={end}>{end}</option>
                ))}
              </select>
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

      {/* ── KPIS GERAIS NO TOPO ── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-12 mb-20">
        <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-xs text-muted font-bold uppercase">Produções</div>
          <div className="text-lg font-black text-primary mt-4">{kpis.totalOps} OPs</div>
        </div>
        <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-xs text-muted font-bold uppercase">Entrada Insumos</div>
          <div className="text-lg font-black text-warning mt-4">{fmtKg(kpis.totalEntradaKg)}</div>
        </div>
        <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-xs text-muted font-bold uppercase">Saída Produzida</div>
          <div className="text-lg font-black text-success mt-4">{fmtKg(kpis.totalSaidaKg)}</div>
        </div>
        <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-xs text-muted font-bold uppercase">Rendimento Médio</div>
          <div className="text-lg font-black mt-4" style={{ color: Number(kpis.rendMedio) >= 90 ? 'var(--success)' : 'var(--primary)' }}>
            {kpis.rendMedio}%
          </div>
        </div>
        <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-xs text-muted font-bold uppercase">Caixas Geradas</div>
          <div className="text-lg font-black mt-4">{kpis.totalCaixasGeradas} cx</div>
        </div>
        <div className="card p-12 text-center" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="text-xs text-muted font-bold uppercase">Já Expedidas</div>
          <div className="text-lg font-black text-info mt-4">{kpis.totalCaixasExpedidas} cx</div>
        </div>
      </div>

      {/* ── BOTÕES DE EXPANDIR/RECOLHER ── */}
      <div className="flex justify-between items-center mb-12 no-print">
        <div className="text-xs text-muted font-bold">
          Exibindo {dossies.length} produção(ões) encontrada(s)
        </div>
        <div className="flex gap-8 text-xs">
          <button className="text-primary hover:underline font-bold" onClick={expandirTodos}>Expandir Todos</button>
          <span>•</span>
          <button className="text-muted hover:underline" onClick={recolherTodos}>Recolher Todos</button>
        </div>
      </div>

      {/* ── LISTAGEM DOS DOSSIÊS DE PRODUÇÃO ── */}
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
                className="card card-dossie overflow-hidden transition-all"
                style={{ 
                  background: 'var(--bg-1)', 
                  border: isExp ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: 12
                }}
              >
                {/* ── BARRA SUPERIOR DO CARD (HEADER DA OP) ── */}
                <div 
                  className="p-16 flex justify-between items-center flex-wrap gap-12 cursor-pointer hover:bg-bg-2 select-none"
                  onClick={() => toggleExpandir(op.id)}
                  style={{ background: isExp ? 'rgba(56, 189, 248, 0.04)' : 'transparent' }}
                >
                  <div className="flex items-center gap-12">
                    <span className="text-muted">
                      {isExp ? <ChevronDown size={20} className="text-primary" /> : <ChevronRight size={20} />}
                    </span>
                    <div>
                      <div className="flex items-center gap-8 flex-wrap">
                        <span className="font-mono font-black text-base px-8 py-2 rounded bg-primary-light text-primary">
                          {op.codigo}
                        </span>
                        <span className="font-bold text-base text-foreground">
                          {op.nome}
                        </span>
                        <span className="text-xs px-8 py-2 rounded bg-bg-2 text-muted font-bold uppercase">
                          📍 {op.endereco}
                        </span>
                        {op.cliente && op.cliente !== 'INTERNO' && (
                          <span className="text-xs px-8 py-2 rounded bg-warning-light text-warning font-bold">
                            Cliente: {op.cliente}
                          </span>
                        )}
                        <span className={`badge ${op.status === 'FECHADA' ? 'badge--success' : 'badge--warning'}`}>
                          {op.status === 'FECHADA' ? 'Finalizada' : op.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted mt-4 flex items-center gap-12">
                        <span>📅 Produzido em: <strong>{fmtDate(op.data_producao)}</strong></span>
                        <span>👤 Operador: <strong>{op.operador_nome || 'Administrador'}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* KPIs resumidos da OP */}
                  <div className="flex items-center gap-16 text-right">
                    <div>
                      <div className="text-xs text-muted uppercase font-bold">Entrada Insumo</div>
                      <div className="font-mono font-bold text-warning text-sm">{fmtKg(op.total_entrada_kg)}</div>
                    </div>
                    <ArrowRight size={14} className="text-muted opacity-50" />
                    <div>
                      <div className="text-xs text-muted uppercase font-bold">Saída Gerada</div>
                      <div className="font-mono font-bold text-success text-sm">{fmtKg(op.total_saida_kg)}</div>
                    </div>
                    <div className="pl-8 border-l border-border">
                      <div className="text-xs text-muted uppercase font-bold">Rendimento</div>
                      <div className="font-mono font-black text-sm" style={{ color: rendColor }}>
                        {rend}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── CORPO EXPANDIDO (VISÃO LADO A LADO DA TRANSFORMAÇÃO) ── */}
                {isExp && (
                  <div className="p-16 border-t border-border" style={{ background: 'var(--bg-card)' }}>
                    <div className="lado-a-lado grid grid-cols-1 lg:grid-cols-2 gap-16">

                      {/* 🥩 LADO ESQUERDO: MATÉRIA-PRIMA (ENTRADA / INSUMOS) */}
                      <div className="bloco-print p-12 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                        <div className="flex justify-between items-center mb-10 pb-6 border-b border-border">
                          <h4 className="font-bold text-sm text-warning flex items-center gap-6">
                            🥩 Matéria-Prima Consumida (Entrada)
                          </h4>
                          <span className="font-mono text-xs font-bold px-8 py-2 rounded bg-bg-1 text-muted">
                            {op.insumos?.length || 0} caixa(s) | {fmtKg(op.total_entrada_kg)}
                          </span>
                        </div>

                        {(!op.insumos || op.insumos.length === 0) ? (
                          <div className="p-12 text-center text-xs text-muted">Nenhum insumo registrado.</div>
                        ) : (
                          <div className="table-container">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted text-left border-b border-border">
                                  <th>Produto</th>
                                  <th>EAN da Caixa</th>
                                  <th>Validade</th>
                                  <th className="text-right">Peso (KG)</th>
                                  <th className="text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {op.insumos.map((ins, idx) => (
                                  <tr key={idx} className="border-b border-border hover:bg-bg-1">
                                    <td className="py-6 font-bold">{ins.produto_descricao}</td>
                                    <td className="py-6 font-mono text-muted">{ins.ean_caixa}</td>
                                    <td className="py-6 text-muted">{fmtDate(ins.validade)}</td>
                                    <td className="py-6 text-right font-mono font-bold text-warning">{fmtNum(ins.peso_kg)}</td>
                                    <td className="py-6 text-center">
                                      <span className="text-[10px] px-6 py-1 rounded bg-bg-1 text-muted font-bold">
                                        CONSUMIDA
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="font-bold border-t border-border">
                                  <td colSpan={3} className="pt-8 text-muted">Total de Entrada:</td>
                                  <td className="pt-8 text-right font-mono text-warning text-sm">{fmtKg(op.total_entrada_kg)}</td>
                                  <td></td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* 📦 LADO DIREITO: PRODUTOS GERADOS (SAÍDA / RETORNOS) */}
                      <div className="bloco-print p-12 rounded-lg" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                        <div className="flex justify-between items-center mb-10 pb-6 border-b border-border">
                          <h4 className="font-bold text-sm text-success flex items-center gap-6">
                            📦 Produtos Finais Gerados (Saída)
                          </h4>
                          <span className="font-mono text-xs font-bold px-8 py-2 rounded bg-bg-1 text-muted">
                            {op.retornos?.length || 0} caixa(s) | {fmtKg(op.total_saida_kg)}
                          </span>
                        </div>

                        {(!op.retornos || op.retornos.length === 0) ? (
                          <div className="p-12 text-center text-xs text-muted">Nenhum retorno registrado.</div>
                        ) : (
                          <div className="table-container">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted text-left border-b border-border">
                                  <th>Produto Gerado</th>
                                  <th>EAN da Nova Caixa</th>
                                  <th className="text-right">Peso (KG)</th>
                                  <th>Situação Atual da Caixa</th>
                                </tr>
                              </thead>
                              <tbody>
                                {op.retornos.map((ret, idx) => {
                                  const isExpedida = ret.caixa_status === 'EXPEDIDA';
                                  return (
                                    <tr key={idx} className="border-b border-border hover:bg-bg-1">
                                      <td className="py-6 font-bold">{ret.produto_descricao}</td>
                                      <td className="py-6 font-mono text-muted">{ret.ean_caixa}</td>
                                      <td className="py-6 text-right font-mono font-bold text-success">{fmtNum(ret.peso_kg)}</td>
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
                                  <td colSpan={2} className="pt-8 text-muted">Total de Saída:</td>
                                  <td className="pt-8 text-right font-mono text-success text-sm">{fmtKg(op.total_saida_kg)}</td>
                                  <td></td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>

                    </div>

                    {/* ── NOTA DE AUDITORIA DO RENDIMENTO ── */}
                    <div className="mt-12 p-10 rounded bg-bg-2 border border-border flex justify-between items-center flex-wrap gap-8 text-xs">
                      <div className="text-muted">
                        ⚖️ Balanço da Transformação: 
                        Entrada <strong>{fmtKg(op.total_entrada_kg)}</strong> ➔ 
                        Saída <strong>{fmtKg(op.total_saida_kg)}</strong>
                        {op.diferenca_kg !== 0 && (
                          <span className="ml-8 font-mono">
                            ({op.diferenca_kg > 0 ? `+${op.diferenca_kg} kg de ganho/aditivo` : `${op.diferenca_kg} kg de quebra de desossa`})
                          </span>
                        )}
                      </div>
                      <div>
                        Rendimento Oficial: <strong className="font-mono text-sm" style={{ color: rendColor }}>{rend}%</strong>
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
  );
}

export default RelatorioDossieProducao;

