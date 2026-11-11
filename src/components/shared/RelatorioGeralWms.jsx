import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet, Printer, Calendar, Search, Package, Truck,
  ArrowDownCircle, Layers, Box, CheckCircle2, RefreshCw, Filter
} from 'lucide-react';
import { subDays, startOfMonth, endOfMonth, startOfYear } from 'date-fns';
import * as relatoriosQueries from '../../queries/relatorios';
import { exportRelatorioWmsExcel } from '../../utils/exportRelatorioWmsExcel';

const fmtKg = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateBR = (d) => {
  if (!d) return '-';
  const s = String(d).slice(0, 10);
  const parts = s.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
};

const fmtDateTimeBR = (str) => {
  if (!str) return '-';
  const s = String(str).trim().replace(' ', 'T') + (/[Zz]$/.test(String(str).trim()) ? '' : 'Z');
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return str;
  const brt = new Date(dt.getTime() - 3 * 3600 * 1000);
  const dd = String(brt.getUTCDate()).padStart(2, '0');
  const mm = String(brt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = brt.getUTCFullYear();
  const hh = String(brt.getUTCHours()).padStart(2, '0');
  const min = String(brt.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

const PRESETS = [
  { label: 'Hoje',     getRange: () => { const d = new Date().toISOString().slice(0, 10); return [d, d]; } },
  { label: '7 dias',   getRange: () => [subDays(new Date(), 6).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: '30 dias',  getRange: () => [subDays(new Date(), 29).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: 'Este mês', getRange: () => [startOfMonth(new Date()).toISOString().slice(0, 10), endOfMonth(new Date()).toISOString().slice(0, 10)] },
  { label: 'Este ano', getRange: () => [startOfYear(new Date()).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
];

export function RelatorioGeralWms() {
  const [presetAtivo, setPresetAtivo] = useState(3); // Padrão: Este mês
  const [dataInicio, setDataInicio] = useState(() => startOfMonth(new Date()).toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(() => endOfMonth(new Date()).toISOString().slice(0, 10));
  const [periodoAtivo, setPeriodoAtivo] = useState(() => ({
    inicio: startOfMonth(new Date()).toISOString().slice(0, 10),
    fim: endOfMonth(new Date()).toISOString().slice(0, 10)
  }));

  const [loading, setLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [busca, setBusca] = useState('');

  // Controle de seções visíveis na tela e no PDF
  const [secoesAtivas, setSecoesAtivas] = useState({
    saidasRomaneio: true,
    entradas: true,
    estoqueProduto: true,
    estoqueCaixa: true
  });

  const [dados, setDados] = useState({
    estoqueAtual: [],
    romaneios: [],
    saidasItens: [],
    entradasCaixas: []
  });

  const carregar = async (ini, fim) => {
    setLoading(true);
    try {
      const res = await relatoriosQueries.getDadosRelatorioExecutivo(ini, fim);
      setDados(res);
    } catch (err) {
      console.error('Erro ao carregar Relatório Executivo WMS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar(periodoAtivo.inicio, periodoAtivo.fim);
  }, [periodoAtivo]);

  const aplicarPreset = (idx) => {
    const [ini, fim] = PRESETS[idx].getRange();
    setPresetAtivo(idx);
    setDataInicio(ini);
    setDataFim(fim);
    setPeriodoAtivo({ inicio: ini, fim: fim });
  };

  const buscarPeriodo = (e) => {
    if (e) e.preventDefault();
    setPresetAtivo(null);
    setPeriodoAtivo({ inicio: dataInicio, fim: dataFim });
  };

  const toggleSecao = (key) => {
    setSecoesAtivas(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Filtragem por busca rápida (opcional)
  const termo = busca.trim().toLowerCase();

  const estoqueCaixasFiltrado = useMemo(() => {
    if (!termo) return dados.estoqueAtual;
    return dados.estoqueAtual.filter(c =>
      (c.descricao || '').toLowerCase().includes(termo) ||
      String(c.codigo || '').toLowerCase().includes(termo) ||
      String(c.ean_caixa || '').toLowerCase().includes(termo) ||
      (c.endereco || '').toLowerCase().includes(termo)
    );
  }, [dados.estoqueAtual, termo]);

  const estoquePorProduto = useMemo(() => {
    const map = new Map();
    estoqueCaixasFiltrado.forEach(item => {
      const k = `${item.codigo}__${item.descricao}`;
      if (!map.has(k)) {
        map.set(k, {
          codigo: item.codigo,
          descricao: item.descricao,
          grupo: item.grupo || '-',
          tipo_produto: item.tipo_produto || '-',
          enderecos: new Set(),
          qtd_caixas: 0,
          peso_kg: 0,
          menor_validade: item.validade || null
        });
      }
      const p = map.get(k);
      if (item.endereco) p.enderecos.add(item.endereco);
      p.qtd_caixas += 1;
      p.peso_kg += Number(item.peso_kg || 0);
      if (item.validade && (!p.menor_validade || item.validade < p.menor_validade)) {
        p.menor_validade = item.validade;
      }
    });
    return Array.from(map.values())
      .map(p => ({ ...p, enderecosStr: Array.from(p.enderecos).sort().join(', ') }))
      .sort((a, b) => a.descricao.localeCompare(b.descricao));
  }, [estoqueCaixasFiltrado]);

  const romaneiosFiltrados = useMemo(() => {
    if (!termo) return dados.romaneios;
    return dados.romaneios.filter(rom =>
      (rom.codigo || '').toLowerCase().includes(termo) ||
      (rom.cliente || '').toLowerCase().includes(termo) ||
      (rom.itens || []).some(it =>
        (it.produto_descricao || '').toLowerCase().includes(termo) ||
        String(it.produto_codigo || '').toLowerCase().includes(termo) ||
        String(it.ean_caixa || '').toLowerCase().includes(termo)
      )
    );
  }, [dados.romaneios, termo]);

  const resumoSaidasPorProduto = useMemo(() => {
    const map = new Map();
    romaneiosFiltrados.forEach(rom => {
      (rom.itens || []).forEach(it => {
        const k = `${it.produto_codigo}__${it.produto_descricao}`;
        if (!map.has(k)) {
          map.set(k, {
            codigo: it.produto_codigo,
            descricao: it.produto_descricao,
            grupo: it.grupo || '-',
            qtd_caixas: 0,
            peso_kg: 0
          });
        }
        const p = map.get(k);
        p.qtd_caixas += 1;
        p.peso_kg += Number(it.peso_kg || 0);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.peso_kg - a.peso_kg);
  }, [romaneiosFiltrados]);

  const entradasFiltradas = useMemo(() => {
    if (!termo) return dados.entradasCaixas;
    return dados.entradasCaixas.filter(e =>
      (e.produto_descricao || '').toLowerCase().includes(termo) ||
      String(e.produto_codigo || '').toLowerCase().includes(termo) ||
      String(e.ean_caixa || '').toLowerCase().includes(termo) ||
      (e.endereco || '').toLowerCase().includes(termo)
    );
  }, [dados.entradasCaixas, termo]);

  const resumoEntradasPorProduto = useMemo(() => {
    const map = new Map();
    entradasFiltradas.forEach(it => {
      const k = `${it.produto_codigo}__${it.produto_descricao}`;
      const orig = it.origem_operacao === 'PRODUCAO' || it.endereco === 'PRODUÇÃO PAVAN'
        ? 'Retorno de Produção'
        : 'Recebimento / Carga';
      if (!map.has(k)) {
        map.set(k, {
          codigo: it.produto_codigo,
          descricao: it.produto_descricao,
          origem: orig,
          qtd_caixas: 0,
          peso_kg: 0
        });
      }
      const p = map.get(k);
      p.qtd_caixas += 1;
      p.peso_kg += Number(it.peso_kg || 0);
    });
    return Array.from(map.values()).sort((a, b) => b.peso_kg - a.peso_kg);
  }, [entradasFiltradas]);

  // Totais Gerais
  const totais = useMemo(() => {
    const estoqueCaixas = estoqueCaixasFiltrado.length;
    const estoqueKg = estoqueCaixasFiltrado.reduce((s, c) => s + Number(c.peso_kg || 0), 0);
    const totalRomaneios = romaneiosFiltrados.length;
    const saidasCaixas = romaneiosFiltrados.reduce((s, r) => s + (r.itens ? r.itens.length : 0), 0);
    const saidasKg = romaneiosFiltrados.reduce((s, r) => s + Number(r.peso_total || 0), 0);
    const entradasCaixasCount = entradasFiltradas.length;
    const entradasKg = entradasFiltradas.reduce((s, e) => s + Number(e.peso_kg || 0), 0);

    return {
      estoqueCaixas,
      estoqueKg,
      estoqueProdutos: estoquePorProduto.length,
      totalRomaneios,
      saidasCaixas,
      saidasKg,
      entradasCaixasCount,
      entradasKg
    };
  }, [estoqueCaixasFiltrado, estoquePorProduto, romaneiosFiltrados, entradasFiltradas]);

  const handleDownloadExcel = async () => {
    setExportingExcel(true);
    try {
      await exportRelatorioWmsExcel({
        estoqueAtual: estoqueCaixasFiltrado,
        romaneios: romaneiosFiltrados,
        saidasItens: dados.saidasItens,
        entradasCaixas: entradasFiltradas,
        dataInicio: periodoAtivo.inicio,
        dataFim: periodoAtivo.fim
      });
    } catch (err) {
      console.error('Erro ao gerar Excel:', err);
      alert('Erro ao gerar arquivo Excel: ' + err.message);
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="relatorio-geral-wms-wrapper">
      {/* ═══════════════════════════════════════════════════════════════════════
          ESTILOS EXCLUSIVOS DE IMPRESSÃO / PDF EXECUTIVO A4
         ═══════════════════════════════════════════════════════════════════════ */}
      <style>{`
        .print-wms-executive {
          display: none;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 9mm 10mm 9mm;
          }

          body * {
            visibility: hidden !important;
          }

          .print-wms-executive,
          .print-wms-executive * {
            visibility: visible !important;
          }

          .screen-wms-view,
          .no-print,
          nav,
          header,
          aside,
          .sidebar {
            display: none !important;
          }

          .print-wms-executive {
            display: block !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            color: #0f172a !important;
            background: #ffffff !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
            font-size: 9.5px !important;
            line-height: 1.25 !important;
          }

          .pw-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: flex-start !important;
            border-bottom: 2.5px solid #0f172a !important;
            padding-bottom: 6px !important;
            margin-bottom: 8px !important;
          }

          .pw-brand-title {
            font-size: 15px !important;
            font-weight: 900 !important;
            color: #0f172a !important;
            letter-spacing: -0.3px !important;
          }

          .pw-brand-sub {
            font-size: 8.5px !important;
            color: #475569 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.4px !important;
          }

          .pw-doc-title {
            font-size: 12px !important;
            font-weight: 800 !important;
            color: #0f172a !important;
            text-align: right !important;
          }

          .pw-doc-meta {
            display: flex !important;
            gap: 12px !important;
            font-size: 8.5px !important;
            color: #475569 !important;
            justify-content: flex-end !important;
            margin-top: 2px !important;
          }

          .pw-kpi-strip {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 6px !important;
            margin-bottom: 12px !important;
            background: #f8fafc !important;
            border: 1px solid #cbd5e1 !important;
            padding: 6px 8px !important;
            border-radius: 4px !important;
          }

          .pw-kpi-box {
            border-right: 1px solid #e2e8f0 !important;
            padding: 2px 6px !important;
          }
          .pw-kpi-box:last-child {
            border-right: none !important;
          }

          .pw-kpi-label {
            font-size: 7.5px !important;
            font-weight: 800 !important;
            color: #64748b !important;
            text-transform: uppercase !important;
          }

          .pw-kpi-val {
            font-size: 12px !important;
            font-weight: 900 !important;
            color: #0f172a !important;
            margin-top: 1px !important;
          }

          .pw-kpi-sub {
            font-size: 8px !important;
            color: #475569 !important;
          }

          .pw-major-section {
            margin-bottom: 14px !important;
          }

          .pw-major-header {
            background: #0f172a !important;
            color: #ffffff !important;
            padding: 5px 10px !important;
            font-size: 10px !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.3px !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            gap: 12px !important;
            white-space: nowrap !important;
            border-radius: 3px !important;
            margin-bottom: 8px !important;
          }

          .pw-table tfoot {
            display: table-row-group !important;
          }

          /* CARD INDIVIDUAL DE CADA ROMANEIO NO PDF */
          .pw-rom-card {
            border: 1.5px solid #64748b !important;
            border-radius: 4px !important;
            margin-bottom: 11px !important;
            page-break-inside: avoid !important;
            overflow: hidden !important;
          }

          .pw-rom-banner {
            background: #1e293b !important;
            color: #ffffff !important;
            padding: 5px 10px !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
          }

          .pw-rom-title {
            font-size: 10.5px !important;
            font-weight: 800 !important;
          }

          .pw-rom-badge-total {
            background: #059669 !important;
            color: #ffffff !important;
            padding: 2px 8px !important;
            border-radius: 3px !important;
            font-size: 9.5px !important;
            font-weight: 900 !important;
          }

          .pw-rom-meta {
            background: #f1f5f9 !important;
            border-bottom: 1px solid #cbd5e1 !important;
            padding: 4px 10px !important;
            display: flex !important;
            justify-content: space-between !important;
            font-size: 8.5px !important;
            color: #334155 !important;
          }

          .pw-rom-prod-pills {
            background: #f8fafc !important;
            border-bottom: 1px solid #e2e8f0 !important;
            padding: 3.5px 10px !important;
            font-size: 8px !important;
            color: #1e293b !important;
          }

          .pw-table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 8.2px !important;
          }

          .pw-table th {
            background: #e2e8f0 !important;
            color: #1e293b !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            border-bottom: 1px solid #94a3b8 !important;
            padding: 3.5px 6px !important;
            text-align: left !important;
            font-size: 7.8px !important;
          }

          .pw-table td {
            border-bottom: 1px solid #e2e8f0 !important;
            padding: 3px 6px !important;
            color: #0f172a !important;
          }

          .pw-tr-zebra {
            background: #f8fafc !important;
          }

          .pw-mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
            font-size: 8px !important;
          }

          .pw-tfoot-rom td {
            background: #dcfce7 !important;
            color: #065f46 !important;
            border-top: 1.5px solid #059669 !important;
            padding: 4.5px 6px !important;
            font-size: 9px !important;
            font-weight: 900 !important;
          }

          .pw-tfoot-general td {
            background: #e2e8f0 !important;
            color: #0f172a !important;
            border-top: 1.5px solid #0f172a !important;
            padding: 5px 6px !important;
            font-size: 9px !important;
            font-weight: 900 !important;
          }

          .pw-sub-title {
            background: #f1f5f9 !important;
            border: 1px solid #cbd5e1 !important;
            border-bottom: none !important;
            padding: 4px 8px !important;
            font-size: 8.5px !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            color: #1e293b !important;
            margin-top: 6px !important;
          }

          .pw-footer {
            display: flex !important;
            justify-content: space-between !important;
            border-top: 1px solid #cbd5e1 !important;
            padding-top: 4px !important;
            font-size: 7.5px !important;
            color: #64748b !important;
            margin-top: 12px !important;
          }
        }
      `}</style>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODO TELA INTERATIVO (WEB / SISTEMA)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="screen-wms-view">
        {/* BARRA SUPERIOR DE AÇÃO: GERAR PDF & EXCEL AUTOMATICAMENTE */}
        <div
          className="card mb-20 p-16"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(59,130,246,0.08))',
            border: '1px solid rgba(16,185,129,0.35)'
          }}
        >
          <div className="flex justify-between items-center flex-wrap gap-16">
            <div>
              <div className="flex items-center gap-8">
                <span className="text-xs font-black uppercase px-8 py-2 rounded-full bg-success/20 text-success border border-success/30">
                  Relatório Executivo Oficial
                </span>
                <h2 className="text-lg font-black">
                  Estoque Atual, Entradas e Saídas por Romaneio
                </h2>
              </div>
              <p className="text-xs text-muted mt-4">
                Gere e baixe automaticamente o relatório gerencial em <strong>PDF (formatado por seções e por romaneio)</strong> ou em <strong>Excel (.xlsx com múltiplas abas, filtros e somatórios)</strong>.
              </p>
            </div>

            <div className="flex items-center gap-10 flex-wrap">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => carregar(periodoAtivo.inicio, periodoAtivo.fim)}
                disabled={loading}
                title="Atualizar dados agora"
              >
                <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
              </button>

              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={loading || exportingExcel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 13,
                  background: '#059669',
                  color: '#ffffff',
                  border: '1px solid #10b981',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(5,150,105,0.25)'
                }}
              >
                <FileSpreadsheet size={17} />
                {exportingExcel ? 'Gerando Excel...' : 'Baixar Relatório Excel (.xlsx)'}
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                disabled={loading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 13,
                  background: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(59,130,246,0.25)'
                }}
              >
                <Printer size={17} />
                Exportar / Imprimir PDF Executivo
              </button>
            </div>
          </div>
        </div>

        {/* BARRA DE PERÍODO E SEÇÕES */}
        <div className="card p-16 mb-20" style={{ background: 'var(--bg-2)' }}>
          <div className="flex justify-between items-center flex-wrap gap-16">
            <div className="flex items-center gap-8 flex-wrap">
              <span className="text-xs font-bold text-muted flex items-center gap-4 uppercase">
                <Calendar size={14} /> Período (Entradas/Saídas):
              </span>
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => aplicarPreset(i)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 700,
                    border: '1.5px solid',
                    borderColor: presetAtivo === i ? 'var(--primary)' : 'var(--border)',
                    background: presetAtivo === i ? 'var(--primary-light)' : 'var(--bg-1)',
                    color: presetAtivo === i ? 'var(--primary)' : 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  {p.label}
                </button>
              ))}
              <input
                type="date"
                className="form-input text-xs"
                style={{ width: 135 }}
                value={dataInicio}
                onChange={e => { setDataInicio(e.target.value); setPresetAtivo(null); }}
              />
              <span className="text-xs text-muted">até</span>
              <input
                type="date"
                className="form-input text-xs"
                style={{ width: 135 }}
                value={dataFim}
                onChange={e => { setDataFim(e.target.value); setPresetAtivo(null); }}
              />
              <button type="button" className="btn btn--primary btn--sm" onClick={buscarPeriodo}>
                <Search size={13} /> Filtrar
              </button>
            </div>

            <div className="relative" style={{ minWidth: 240 }}>
              <Search size={15} className="absolute left-10 top-10 text-muted" />
              <input
                type="text"
                className="form-input pl-32 text-xs"
                placeholder="Filtrar produto, EAN, romaneio..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
              />
            </div>
          </div>

          {/* CHECKBOXES DE SEÇÕES INCLUÍDAS NO RELATÓRIO */}
          <div className="flex items-center gap-16 flex-wrap mt-12 pt-12 border-t border-border text-xs">
            <span className="font-bold text-muted flex items-center gap-4 uppercase">
              <Filter size={13} /> Seções do Relatório (Tela e PDF):
            </span>
            {[
              { key: 'saidasRomaneio', label: `1. Saídas por Romaneio (${totais.totalRomaneios})` },
              { key: 'entradas', label: `2. Entradas do Período (${totais.entradasCaixasCount} cx)` },
              { key: 'estoqueProduto', label: `3. Estoque por Produto (${totais.estoqueProdutos} prod.)` },
              { key: 'estoqueCaixa', label: `4. Estoque por Caixa (${totais.estoqueCaixas} cx)` },
            ].map(sec => (
              <label key={sec.key} className="flex items-center gap-6 cursor-pointer select-none font-bold">
                <input
                  type="checkbox"
                  checked={secoesAtivas[sec.key]}
                  onChange={() => toggleSecao(sec.key)}
                />
                <span>{sec.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* CARDS KPI GERENCIAIS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
          <div className="card p-14 border border-border" style={{ background: 'var(--bg-1)' }}>
            <div className="text-xs text-muted font-bold uppercase flex items-center gap-6">
              <Truck size={14} className="text-danger" /> Saídas no Período
            </div>
            <div className="text-2xl font-black font-mono text-danger mt-4">{fmtKg(totais.saidasKg)}</div>
            <div className="text-xs text-muted mt-2">
              <strong>{totais.totalRomaneios}</strong> romaneios expedidos • <strong>{totais.saidasCaixas}</strong> caixas
            </div>
          </div>

          <div className="card p-14 border border-border" style={{ background: 'var(--bg-1)' }}>
            <div className="text-xs text-muted font-bold uppercase flex items-center gap-6">
              <ArrowDownCircle size={14} className="text-info" /> Entradas no Período
            </div>
            <div className="text-2xl font-black font-mono text-info mt-4">{fmtKg(totais.entradasKg)}</div>
            <div className="text-xs text-muted mt-2">
              <strong>{totais.entradasCaixasCount}</strong> caixas registradas na entrada
            </div>
          </div>

          <div className="card p-14 border border-border" style={{ background: 'var(--bg-1)' }}>
            <div className="text-xs text-muted font-bold uppercase flex items-center gap-6">
              <Layers size={14} className="text-primary" /> Estoque por Produto
            </div>
            <div className="text-2xl font-black font-mono text-primary mt-4">{totais.estoqueProdutos} SKUs</div>
            <div className="text-xs text-muted mt-2">
              Produtos distintos ativos com saldo físico
            </div>
          </div>

          <div className="card p-14 border border-border" style={{ background: 'var(--bg-1)' }}>
            <div className="text-xs text-muted font-bold uppercase flex items-center gap-6">
              <Package size={14} className="text-success" /> Estoque Atual Total
            </div>
            <div className="text-2xl font-black font-mono text-success mt-4">{fmtKg(totais.estoqueKg)}</div>
            <div className="text-xs text-muted mt-2">
              <strong>{totais.estoqueCaixas}</strong> caixas físicas disponíveis no armazém
            </div>
          </div>
        </div>

        {/* ── SEÇÃO 1 (TELA): SAÍDAS POR ROMANEIO (SEPARADAS INDIVIDUALMENTE) ── */}
        {secoesAtivas.saidasRomaneio && (
          <div className="mb-28">
            <div className="flex justify-between items-center mb-12 pb-8 border-b border-border">
              <h3 className="text-base font-black uppercase flex items-center gap-8">
                <Truck size={18} className="text-danger" />
                1. Saídas por Romaneio (Individualizado com Peso Consolidado)
              </h3>
              <span className="text-xs font-mono font-bold text-muted">
                {totais.totalRomaneios} romaneios | {totais.saidasCaixas} caixas | Total Geral: {fmtKg(totais.saidasKg)}
              </span>
            </div>

            {romaneiosFiltrados.length === 0 ? (
              <div className="card p-24 text-center text-muted text-sm">
                Nenhum romaneio encontrado no período selecionado.
              </div>
            ) : (
              <div className="space-y-16">
                {romaneiosFiltrados.map(rom => (
                  <div
                    key={rom.id}
                    className="card overflow-hidden"
                    style={{
                      background: 'var(--bg-1)',
                      border: '1.5px solid var(--border)',
                      borderRadius: 10
                    }}
                  >
                    {/* Cabeçalho do Romaneio */}
                    <div
                      className="p-14 flex justify-between items-center flex-wrap gap-12"
                      style={{
                        background: 'var(--bg-2)',
                        borderBottom: '1px solid var(--border)'
                      }}
                    >
                      <div className="flex items-center gap-12 flex-wrap">
                        <span className="font-mono font-black text-base text-primary px-10 py-4 rounded bg-primary/15 border border-primary/30">
                          {rom.codigo}
                        </span>
                        <div>
                          <div className="font-bold text-sm">
                            Cliente / Destino: <span className="text-primary">{(rom.cliente || '-').trim()}</span>
                          </div>
                          <div className="text-xs text-muted flex items-center gap-12 mt-2">
                            <span>📅 Expedido em: <strong>{fmtDateTimeBR(rom.expedido_at || rom.created_at)}</strong></span>
                            <span>👤 Operador: <strong>{rom.operador_expedicao_nome || rom.operador_nome || 'Administrador'}</strong></span>
                            <span>Status: <strong>{rom.status}</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Peso Total Consolidado daquele Romaneio */}
                      <div className="flex items-center gap-16 bg-bg-1 px-14 py-8 rounded-lg border border-border">
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-bold text-muted">Caixas do Romaneio</div>
                          <div className="font-mono font-black text-sm">{rom.qtd_caixas} cx</div>
                        </div>
                        <div style={{ width: 1, height: 26, background: 'var(--border)' }} />
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-bold text-success">Peso Total ({rom.codigo})</div>
                          <div className="font-mono font-black text-base text-success">{fmtKg(rom.peso_total)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Resumo rápido por produto dentro do romaneio */}
                    {rom.resumo_produtos && rom.resumo_produtos.length > 0 && (
                      <div className="px-14 py-8 bg-bg-2/40 border-b border-border text-xs flex items-center gap-8 flex-wrap">
                        <span className="font-bold text-muted uppercase text-[11px]">Resumo do Romaneio:</span>
                        {rom.resumo_produtos.map((rp, idx) => (
                          <span key={idx} className="px-8 py-2 rounded bg-bg-2 border border-border font-mono text-[11px]">
                            <strong>{rp.descricao}</strong>: {rp.qtd_caixas} cx ({fmtKg(rp.peso_kg)})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Tabela de itens vinculados ao Romaneio */}
                    <div className="table-container" style={{ margin: 0 }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th style={{ width: 45 }}>#</th>
                            <th style={{ width: 85 }}>Código</th>
                            <th>Produto Vinculado</th>
                            <th>EAN da Caixa</th>
                            <th>End. Origem</th>
                            <th>Lote</th>
                            <th>Validade</th>
                            <th style={{ textAlign: 'center', width: 70 }}>Qtd</th>
                            <th style={{ textAlign: 'right', width: 120 }}>Peso (Kg)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(rom.itens || []).map((it, idx) => (
                            <tr key={it.item_id || idx}>
                              <td className="text-muted font-mono">{idx + 1}</td>
                              <td className="font-mono">{it.produto_codigo}</td>
                              <td className="font-bold">{it.produto_descricao}</td>
                              <td className="font-mono text-muted">{it.ean_caixa}</td>
                              <td className="font-mono">{it.endereco_atual_ou_origem || '-'}</td>
                              <td className="font-mono">{it.lote || '-'}</td>
                              <td>{fmtDateBR(it.validade)}</td>
                              <td style={{ textAlign: 'center' }} className="font-mono">1 cx</td>
                              <td style={{ textAlign: 'right' }} className="font-mono font-bold">{fmtNum(it.peso_kg)} kg</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: 'rgba(16,185,129,0.08)', fontWeight: 800 }}>
                            <td colSpan={7} style={{ textAlign: 'right' }} className="uppercase text-xs">
                              Peso Total Consolidado do Romaneio {rom.codigo}:
                            </td>
                            <td style={{ textAlign: 'center' }} className="font-mono text-success">{rom.qtd_caixas} cx</td>
                            <td style={{ textAlign: 'right' }} className="font-mono text-success text-sm">{fmtKg(rom.peso_total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SEÇÃO 2 (TELA): ENTRADAS DO PERÍODO ── */}
        {secoesAtivas.entradas && (
          <div className="mb-28">
            <div className="flex justify-between items-center mb-12 pb-8 border-b border-border">
              <h3 className="text-base font-black uppercase flex items-center gap-8">
                <ArrowDownCircle size={18} className="text-info" />
                2. Entradas Registradas no Período ({fmtDateBR(periodoAtivo.inicio)} a {fmtDateBR(periodoAtivo.fim)})
              </h3>
              <span className="text-xs font-mono font-bold text-muted">
                {totais.entradasCaixasCount} caixas | Peso Total de Entrada: {fmtKg(totais.entradasKg)}
              </span>
            </div>

            {resumoEntradasPorProduto.length === 0 ? (
              <div className="card p-24 text-center text-muted text-sm">
                Nenhuma entrada registrada neste período.
              </div>
            ) : (
              <div className="card overflow-hidden border border-border">
                <div className="table-container" style={{ margin: 0 }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th style={{ width: 90 }}>Código</th>
                        <th>Produto Recebido / Produzido</th>
                        <th>Origem da Entrada</th>
                        <th style={{ textAlign: 'right', width: 110 }}>Qtd. Caixas</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Peso Total (Kg)</th>
                        <th style={{ textAlign: 'right', width: 100 }}>% Entradas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumoEntradasPorProduto.map((p, idx) => (
                        <tr key={idx}>
                          <td className="font-mono">{p.codigo}</td>
                          <td className="font-bold">{p.descricao}</td>
                          <td>
                            <span className="px-8 py-2 rounded bg-bg-2 border border-border text-[11px] font-bold">
                              {p.origem}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }} className="font-mono">{p.qtd_caixas} cx</td>
                          <td style={{ textAlign: 'right' }} className="font-mono font-bold text-info">{fmtKg(p.peso_kg)}</td>
                          <td style={{ textAlign: 'right' }} className="font-mono text-muted">
                            {totais.entradasKg > 0 ? ((p.peso_kg / totais.entradasKg) * 100).toFixed(1) + '%' : '0.0%'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--bg-2)', fontWeight: 800 }}>
                        <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL GERAL DE ENTRADAS NO PERÍODO:</td>
                        <td style={{ textAlign: 'right' }} className="font-mono">{totais.entradasCaixasCount} cx</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-info">{fmtKg(totais.entradasKg)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono">100.0%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SEÇÃO 3 (TELA): ESTOQUE TOTAL POR PRODUTO (CONSOLIDADO) ── */}
        {secoesAtivas.estoqueProduto && (
          <div className="mb-28">
            <div className="flex justify-between items-center mb-12 pb-8 border-b border-border">
              <h3 className="text-base font-black uppercase flex items-center gap-8">
                <Layers size={18} className="text-primary" />
                3. Estoque Atual Total por Produto (Consolidado)
              </h3>
              <span className="text-xs font-mono font-bold text-muted">
                {totais.estoqueProdutos} produtos | {totais.estoqueCaixas} caixas | {fmtKg(totais.estoqueKg)}
              </span>
            </div>

            <div className="card overflow-hidden border border-border">
              <div className="table-container" style={{ margin: 0 }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th style={{ width: 85 }}>Código</th>
                      <th>Descrição do Produto</th>
                      <th>Grupo</th>
                      <th>Endereços Atuais</th>
                      <th style={{ textAlign: 'center', width: 110 }}>Menor Validade</th>
                      <th style={{ textAlign: 'right', width: 100 }}>Qtd. Caixas</th>
                      <th style={{ textAlign: 'right', width: 130 }}>Peso Total (Kg)</th>
                      <th style={{ textAlign: 'right', width: 90 }}>% Estoque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estoquePorProduto.map((p, idx) => (
                      <tr key={idx}>
                        <td className="font-mono">{p.codigo}</td>
                        <td className="font-bold">{p.descricao}</td>
                        <td className="text-muted">{p.grupo}</td>
                        <td className="font-mono">{p.enderecosStr}</td>
                        <td style={{ textAlign: 'center' }}>{fmtDateBR(p.menor_validade)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold">{p.qtd_caixas} cx</td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold text-success">{fmtKg(p.peso_kg)}</td>
                        <td style={{ textAlign: 'right' }} className="font-mono text-muted">
                          {totais.estoqueKg > 0 ? ((p.peso_kg / totais.estoqueKg) * 100).toFixed(1) + '%' : '0.0%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-2)', fontWeight: 800 }}>
                      <td colSpan={5} style={{ textAlign: 'right' }}>TOTAL GERAL EM ESTOQUE:</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{totais.estoqueCaixas} cx</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-success">{fmtKg(totais.estoqueKg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">100.0%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── SEÇÃO 4 (TELA): ESTOQUE ATUAL DETALHADO POR CAIXA ── */}
        {secoesAtivas.estoqueCaixa && (
          <div className="mb-16">
            <div className="flex justify-between items-center mb-12 pb-8 border-b border-border">
              <h3 className="text-base font-black uppercase flex items-center gap-8">
                <Box size={18} className="text-success" />
                4. Estoque Atual Detalhado por Caixa Física
              </h3>
              <span className="text-xs font-mono font-bold text-muted">
                {totais.estoqueCaixas} caixas individuais | {fmtKg(totais.estoqueKg)}
              </span>
            </div>

            <div className="card overflow-hidden border border-border">
              <div className="table-container" style={{ margin: 0, maxHeight: 520, overflowY: 'auto' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th style={{ width: 45 }}>#</th>
                      <th style={{ width: 120 }}>Endereço</th>
                      <th style={{ width: 80 }}>Código</th>
                      <th>Descrição do Produto</th>
                      <th>EAN da Caixa</th>
                      <th style={{ width: 90 }}>Lote</th>
                      <th style={{ width: 100 }}>Validade</th>
                      <th style={{ width: 100 }}>Status</th>
                      <th style={{ textAlign: 'right', width: 115 }}>Peso (Kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estoqueCaixasFiltrado.map((c, idx) => (
                      <tr key={c.id || idx}>
                        <td className="font-mono text-muted">{idx + 1}</td>
                        <td className="font-mono font-bold">{c.endereco}</td>
                        <td className="font-mono">{c.codigo}</td>
                        <td className="font-bold">{c.descricao}</td>
                        <td className="font-mono text-muted">{c.ean_caixa}</td>
                        <td className="font-mono">{c.lote || '-'}</td>
                        <td>{fmtDateBR(c.validade)}</td>
                        <td>
                          <span className="px-6 py-1 rounded bg-success/15 text-success font-bold text-[10px]">
                            {c.status_caixa || 'DISPONIVEL'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="font-mono font-bold">{fmtNum(c.peso_kg)} kg</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-2)', fontWeight: 800 }}>
                      <td colSpan={7} style={{ textAlign: 'right' }}>TOTAL DE CAIXAS FÍSICAS EM ESTOQUE:</td>
                      <td className="font-mono">{totais.estoqueCaixas} cx</td>
                      <td style={{ textAlign: 'right' }} className="font-mono text-success">{fmtKg(totais.estoqueKg)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          LAYOUT EXECUTIVO DE IMPRESSÃO / PDF (APENAS NO @media print)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="print-wms-executive">
        {/* CABEÇALHO CORPORATIVO */}
        <div className="pw-header">
          <div>
            <div className="pw-brand-title">TRICARNES ALIMENTOS LTDA.</div>
            <div className="pw-brand-sub">WMSphere ERP — Relatório Executivo de Estoque, Entradas e Expedições</div>
          </div>
          <div>
            <div className="pw-doc-title">RELATÓRIO GERENCIAL DE CONTROLE INTERNO</div>
            <div className="pw-doc-meta">
              <span><strong>Período Apurado:</strong> {fmtDateBR(periodoAtivo.inicio)} a {fmtDateBR(periodoAtivo.fim)}</span>
              <span><strong>Emissão:</strong> {new Date().toLocaleString('pt-BR')}</span>
            </div>
          </div>
        </div>

        {/* FAIXA DE INDICADORES GERAIS */}
        <div className="pw-kpi-strip">
          <div className="pw-kpi-box">
            <div className="pw-kpi-label">SAÍDAS NO PERÍODO (ROMANEIOS)</div>
            <div className="pw-kpi-val">{fmtKg(totais.saidasKg)}</div>
            <div className="pw-kpi-sub">{totais.totalRomaneios} romaneios | {totais.saidasCaixas} caixas expedidas</div>
          </div>
          <div className="pw-kpi-box">
            <div className="pw-kpi-label">ENTRADAS NO PERÍODO</div>
            <div className="pw-kpi-val">{fmtKg(totais.entradasKg)}</div>
            <div className="pw-kpi-sub">{totais.entradasCaixasCount} caixas registradas na entrada</div>
          </div>
          <div className="pw-kpi-box">
            <div className="pw-kpi-label">ESTOQUE ATUAL (PRODUTOS)</div>
            <div className="pw-kpi-val">{totais.estoqueProdutos} Produtos</div>
            <div className="pw-kpi-sub">SKUs ativos armazenados no frigorífico</div>
          </div>
          <div className="pw-kpi-box">
            <div className="pw-kpi-label">ESTOQUE ATUAL TOTAL (FÍSICO)</div>
            <div className="pw-kpi-val">{fmtKg(totais.estoqueKg)}</div>
            <div className="pw-kpi-sub">{totais.estoqueCaixas} caixas físicas em estoque</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 1 DO PDF: SAÍDAS ORGANIZADAS POR ROMANEIO (SEPARADAS)
           ═══════════════════════════════════════════════════════════════════ */}
        {secoesAtivas.saidasRomaneio && (
          <div className="pw-major-section">
            <div className="pw-major-header">
              <span>SEÇÃO 1 — SAÍDAS E EXPEDIÇÕES POR ROMANEIO (DETALHAMENTO INDIVIDUALIZADO)</span>
              <span>{totais.totalRomaneios} Romaneios | {totais.saidasCaixas} Caixas | Total: {fmtKg(totais.saidasKg)}</span>
            </div>

            {romaneiosFiltrados.map((rom) => (
              <div key={rom.id} className="pw-rom-card">
                {/* Barra de Identificação do Romaneio */}
                <div className="pw-rom-banner">
                  <div className="pw-rom-title">
                    ROMANEIO Nº {rom.codigo} — CLIENTE / DESTINO: {(rom.cliente || '-').trim().toUpperCase()}
                  </div>
                  <div className="pw-rom-badge-total">
                    TOTAL {rom.codigo}: {rom.qtd_caixas} caixas | {fmtKg(rom.peso_total)}
                  </div>
                </div>

                {/* Metadados do Romaneio */}
                <div className="pw-rom-meta">
                  <span><strong>Data/Hora Expedição:</strong> {fmtDateTimeBR(rom.expedido_at || rom.created_at)}</span>
                  <span><strong>Status:</strong> {rom.status}</span>
                  <span><strong>Operador Resp.:</strong> {rom.operador_expedicao_nome || rom.operador_nome || 'Administrador'}</span>
                  <span><strong>Produtos Distintos:</strong> {rom.resumo_produtos ? rom.resumo_produtos.length : 0}</span>
                </div>

                {/* Resumo consolidado por produto daquele romaneio */}
                {rom.resumo_produtos && rom.resumo_produtos.length > 0 && (
                  <div className="pw-rom-prod-pills">
                    <strong>Síntese por Produto ({rom.codigo}): </strong>
                    {rom.resumo_produtos.map((rp, i) => (
                      <span key={i}>
                        {i > 0 ? '  •  ' : ''}
                        <strong>{rp.descricao}</strong>: {rp.qtd_caixas} cx ({fmtNum(rp.peso_kg)} kg)
                      </span>
                    ))}
                  </div>
                )}

                {/* Tabela de itens daquele Romaneio */}
                <table className="pw-table">
                  <thead>
                    <tr>
                      <th style={{ width: '5%', textAlign: 'center' }}>#</th>
                      <th style={{ width: '9%' }}>Código</th>
                      <th style={{ width: '32%' }}>Descrição do Produto Vinculado</th>
                      <th style={{ width: '21%' }}>EAN da Caixa Física</th>
                      <th style={{ width: '12%', textAlign: 'center' }}>End. Origem</th>
                      <th style={{ width: '9%', textAlign: 'center' }}>Validade</th>
                      <th style={{ width: '12%', textAlign: 'right' }}>Peso (Kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rom.itens || []).map((it, idx) => (
                      <tr key={it.item_id || idx} className={idx % 2 === 1 ? 'pw-tr-zebra' : ''}>
                        <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                        <td className="pw-mono">{it.produto_codigo}</td>
                        <td><strong>{it.produto_descricao}</strong></td>
                        <td className="pw-mono">{it.ean_caixa}</td>
                        <td className="pw-mono" style={{ textAlign: 'center' }}>{it.endereco_atual_ou_origem || '-'}</td>
                        <td style={{ textAlign: 'center' }}>{fmtDateBR(it.validade)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(it.peso_kg)} kg</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="pw-tfoot-rom">
                      <td colSpan={5} style={{ textAlign: 'right' }}>
                        PESO TOTAL CONSOLIDADO DO ROMANEIO {rom.codigo} ({(rom.cliente || '').trim()}):
                      </td>
                      <td style={{ textAlign: 'center' }}>{rom.qtd_caixas} caixas</td>
                      <td style={{ textAlign: 'right' }}>{fmtKg(rom.peso_total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}

            {/* Resumo Consolidado Geral das Saídas por Produto */}
            {resumoSaidasPorProduto.length > 0 && (
              <div style={{ pageBreakInside: 'avoid' }}>
                <div className="pw-sub-title">
                  RESUMO CONSOLIDADO DE SAÍDAS POR PRODUTO NO PERÍODO ({totais.totalRomaneios} ROMANEIOS)
                </div>
                <table className="pw-table" style={{ border: '1px solid #cbd5e1' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '10%' }}>Código</th>
                      <th style={{ width: '46%' }}>Descrição do Produto Expedido</th>
                      <th style={{ width: '16%' }}>Grupo</th>
                      <th style={{ width: '12%', textAlign: 'right' }}>Qtd. Caixas</th>
                      <th style={{ width: '16%', textAlign: 'right' }}>Peso Total (Kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumoSaidasPorProduto.map((p, idx) => (
                      <tr key={idx} className={idx % 2 === 1 ? 'pw-tr-zebra' : ''}>
                        <td className="pw-mono">{p.codigo}</td>
                        <td><strong>{p.descricao}</strong></td>
                        <td>{p.grupo}</td>
                        <td style={{ textAlign: 'right' }}>{p.qtd_caixas} cx</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(p.peso_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="pw-tfoot-general">
                      <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL GERAL DE SAÍDAS NO PERÍODO:</td>
                      <td style={{ textAlign: 'right' }}>{totais.saidasCaixas} cx</td>
                      <td style={{ textAlign: 'right' }}>{fmtKg(totais.saidasKg)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 2 DO PDF: ENTRADAS DO PERÍODO
           ═══════════════════════════════════════════════════════════════════ */}
        {secoesAtivas.entradas && (
          <div className="pw-major-section" style={{ pageBreakInside: 'avoid' }}>
            <div className="pw-major-header">
              <span>SEÇÃO 2 — ENTRADAS REGISTRADAS NO PERÍODO (RECEBIMENTO / PRODUÇÃO)</span>
              <span>{totais.entradasCaixasCount} Caixas | Peso Total: {fmtKg(totais.entradasKg)}</span>
            </div>

            <table className="pw-table" style={{ border: '1px solid #cbd5e1' }}>
              <thead>
                <tr>
                  <th style={{ width: '10%' }}>Código</th>
                  <th style={{ width: '42%' }}>Descrição do Produto</th>
                  <th style={{ width: '20%' }}>Origem da Entrada</th>
                  <th style={{ width: '12%', textAlign: 'right' }}>Qtd. Caixas</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Peso Total (Kg)</th>
                </tr>
              </thead>
              <tbody>
                {resumoEntradasPorProduto.map((p, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'pw-tr-zebra' : ''}>
                    <td className="pw-mono">{p.codigo}</td>
                    <td><strong>{p.descricao}</strong></td>
                    <td>{p.origem}</td>
                    <td style={{ textAlign: 'right' }}>{p.qtd_caixas} cx</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(p.peso_kg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pw-tfoot-general">
                  <td colSpan={3} style={{ textAlign: 'right' }}>PESO TOTAL DE ENTRADAS NO PERÍODO:</td>
                  <td style={{ textAlign: 'right' }}>{totais.entradasCaixasCount} cx</td>
                  <td style={{ textAlign: 'right' }}>{fmtKg(totais.entradasKg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 3 DO PDF: ESTOQUE ATUAL TOTAL POR PRODUTO (CONSOLIDADO)
           ═══════════════════════════════════════════════════════════════════ */}
        {secoesAtivas.estoqueProduto && (
          <div className="pw-major-section" style={{ pageBreakInside: 'avoid' }}>
            <div className="pw-major-header">
              <span>SEÇÃO 3 — ESTOQUE ATUAL TOTAL POR PRODUTO (CONSOLIDADO)</span>
              <span>{totais.estoqueProdutos} Produtos | {totais.estoqueCaixas} Caixas | Total: {fmtKg(totais.estoqueKg)}</span>
            </div>

            <table className="pw-table" style={{ border: '1px solid #cbd5e1' }}>
              <thead>
                <tr>
                  <th style={{ width: '9%' }}>Código</th>
                  <th style={{ width: '36%' }}>Descrição do Produto</th>
                  <th style={{ width: '19%' }}>Endereços</th>
                  <th style={{ width: '11%', textAlign: 'center' }}>Menor Validade</th>
                  <th style={{ width: '9%', textAlign: 'right' }}>Caixas</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Peso Total (Kg)</th>
                </tr>
              </thead>
              <tbody>
                {estoquePorProduto.map((p, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'pw-tr-zebra' : ''}>
                    <td className="pw-mono">{p.codigo}</td>
                    <td><strong>{p.descricao}</strong></td>
                    <td className="pw-mono">{p.enderecosStr}</td>
                    <td style={{ textAlign: 'center' }}>{fmtDateBR(p.menor_validade)}</td>
                    <td style={{ textAlign: 'right' }}>{p.qtd_caixas} cx</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtKg(p.peso_kg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pw-tfoot-general">
                  <td colSpan={4} style={{ textAlign: 'right' }}>TOTAL GERAL DO ESTOQUE ATUAL (POR PRODUTO):</td>
                  <td style={{ textAlign: 'right' }}>{totais.estoqueCaixas} cx</td>
                  <td style={{ textAlign: 'right' }}>{fmtKg(totais.estoqueKg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            SEÇÃO 4 DO PDF: ESTOQUE ATUAL DETALHADO POR CAIXA FÍSICA
           ═══════════════════════════════════════════════════════════════════ */}
        {secoesAtivas.estoqueCaixa && (
          <div className="pw-major-section" style={{ pageBreakBefore: 'always' }}>
            <div className="pw-major-header">
              <span>SEÇÃO 4 — ESTOQUE ATUAL DETALHADO POR CAIXA FÍSICA (SERIALIZADO)</span>
              <span>{totais.estoqueCaixas} Caixas | Peso Total: {fmtKg(totais.estoqueKg)}</span>
            </div>

            <table className="pw-table" style={{ border: '1px solid #cbd5e1' }}>
              <thead>
                <tr>
                  <th style={{ width: '4%', textAlign: 'center' }}>#</th>
                  <th style={{ width: '13%' }}>Endereço</th>
                  <th style={{ width: '8%' }}>Código</th>
                  <th style={{ width: '31%' }}>Descrição do Produto</th>
                  <th style={{ width: '20%' }}>EAN da Caixa</th>
                  <th style={{ width: '7%', textAlign: 'center' }}>Lote</th>
                  <th style={{ width: '8%', textAlign: 'center' }}>Validade</th>
                  <th style={{ width: '9%', textAlign: 'right' }}>Peso (Kg)</th>
                </tr>
              </thead>
              <tbody>
                {estoqueCaixasFiltrado.map((c, idx) => (
                  <tr key={c.id || idx} className={idx % 2 === 1 ? 'pw-tr-zebra' : ''}>
                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                    <td className="pw-mono"><strong>{c.endereco}</strong></td>
                    <td className="pw-mono">{c.codigo}</td>
                    <td><strong>{c.descricao}</strong></td>
                    <td className="pw-mono">{c.ean_caixa}</td>
                    <td className="pw-mono" style={{ textAlign: 'center' }}>{c.lote || '-'}</td>
                    <td style={{ textAlign: 'center' }}>{fmtDateBR(c.validade)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{fmtNum(c.peso_kg)} kg</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pw-tfoot-general">
                  <td colSpan={6} style={{ textAlign: 'right' }}>TOTAL GERAL EM ESTOQUE FÍSICO (CAIXA A CAIXA):</td>
                  <td style={{ textAlign: 'center' }}>{totais.estoqueCaixas} cx</td>
                  <td style={{ textAlign: 'right' }}>{fmtKg(totais.estoqueKg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* RODAPÉ INSTITUCIONAL */}
        <div className="pw-footer">
          <span>WMSphere ERP • Tricarnes Alimentos Ltda.</span>
          <span>Relatório Gerado Automaticamente pelo Sistema WMS</span>
          <span>Controle Interno de Estoque e Expedição</span>
        </div>
      </div>
    </div>
  );
}

export default RelatorioGeralWms;
