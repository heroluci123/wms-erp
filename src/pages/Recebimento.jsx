import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Trash2, Package, Layers, Plus, X, AlertTriangle, Tag, ArrowLeft, ScanBarcode, History, Download, Search, Filter, ChevronRight, Eye, CheckCircle2, Clock, Box, Unlock, Printer, FileText, RefreshCw, ClipboardCheck } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { temPermissao } from '../utils/permissoes'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as movimentacoesQueries from '../queries/movimentacoes.js';
import * as produtosQueries from '../queries/produtos.js';
import * as estoqueQueries from '../queries/estoque.js';
import { tarasQueries } from '../queries/taras.js';
import { comprasQueries } from '../queries/compras.js';
import { isApiEnabled } from '../lib/apiClient.js';
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx';
import PesagemTaraFields, { resolverTaraSelecionada } from '../components/shared/PesagemTaraFields.jsx';
import EtiquetaZebraModal from '../components/shared/EtiquetaZebraPrint.jsx';
import RecebimentoPedidoDoca from '../components/recebimento/RecebimentoPedidoDoca.jsx';
import { hojeIsoLocal, validarPesagemTara, fmtDataBR, fmtKg2, fmtKg3 } from '../utils/rastreabilidade.js';

// ─── Helper: exportar CSV ────────────────────────────────────────────────────
function downloadCSV(rows, filename) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(';'),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── ABA HISTÓRICO ───────────────────────────────────────────────────────────
function HistoricoPaletes() {
  const { toastError, toastSuccess, operador } = useAppStore();
  const [paletes, setPaletes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paleteAberto, setPaleteAberto] = useState(null); // palete selecionado para ver caixas
  const [caixasDetalhe, setCaixasDetalhe] = useState([]);
  const [loadingDetalhe, setLoadingDetalhe] = useState(false);
  const [modalReabrirOpen, setModalReabrirOpen] = useState(false);

  // Filtros
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroCodigo, setFiltroCodigo] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await movimentacoesQueries.listarHistoricoPaletes({
        dataInicio: filtroDataInicio || undefined,
        dataFim: filtroDataFim || undefined,
        status: filtroStatus !== 'TODOS' ? filtroStatus : undefined,
      });
      setPaletes(data);
    } catch (e) {
      toastError('Erro', 'Falha ao carregar histórico de paletes.');
    } finally {
      setLoading(false);
    }
  }, [filtroDataInicio, filtroDataFim, filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirDetalhe = async (palete) => {
    setPaleteAberto(palete);
    setLoadingDetalhe(true);
    try {
      const caixas = await movimentacoesQueries.listarTodasCaixasDoPalete(palete.id);
      setCaixasDetalhe(caixas);
    } catch (e) {
      toastError('Erro', 'Falha ao carregar caixas do palete.');
    } finally {
      setLoadingDetalhe(false);
    }
  };

  const handleReabrirPalete = async () => {
    setLoadingDetalhe(true);
    try {
      const res = await movimentacoesQueries.reabrirPalete(paleteAberto.id);
      if (res.success) {
        toastSuccess("Sucesso", "Palete reaberto. Adicione mais caixas na aba de Montagem.");
        setPaleteAberto(null);
        setModalReabrirOpen(false);
        carregar();
      } else {
        toastError("Erro", res.error);
      }
    } catch (e) {
      toastError("Erro", "Falha ao reabrir palete.");
    } finally {
      setLoadingDetalhe(false);
    }
  };


  const exportarPaletesCSV = () => {
    const safeFmt = (v, fmt) => { try { if (!v) return '-'; const d = new Date(v.toString().includes('Z') ? v : v + 'Z'); return isNaN(d.getTime()) ? '-' : format(d, fmt, { locale: ptBR }); } catch { return '-'; } };
    const paletesExport = paletesFiltrados.map(p => ({
      Codigo: p.codigo,
      Status: p.status === 'EM_MONTAGEM' ? 'Na Doca' : (p.status === 'FECHADO' && p.endereco_atual === 'DOCA' && p.qtd_disponiveis > 0) ? 'Na Doca (Finalizado)' : 'Armazenado',
      'Endereço': p.endereco_atual,
      'Qtd Caixas': p.qtd_caixas || 0,
      'Peso Total': parseFloat(p.peso_total || 0).toFixed(2),
      'Aberto Em': safeFmt(p.created_at, 'dd/MM/yyyy HH:mm'),
      'Última Bipagem': safeFmt(p.ultima_caixa, 'dd/MM/yyyy HH:mm'),
      'Último Operador': p.ultimo_operador || '-'
    }));
    downloadCSV(paletesExport, `historico_paletes_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const exportarCaixasCSV = () => {
    if (!paleteAberto) return;
    const rows = caixasDetalhe.map(c => ({
      EAN_Caixa: c.ean_caixa,
      Produto: c.produto_descricao,
      CodigoProduto: c.produto_codigo || '',
      TipoProduto: c.tipo_produto || '',
      PesoKg: c.peso_kg,
      Validade: c.validade || '',
      Status: c.status,
      Endereco: c.endereco || '',
      BipadoEm: (() => {
        if (!c.created_at) return '';
        try {
          const p = new Date(c.created_at.replace(' ', 'T') + (c.created_at.includes('Z') ? '' : 'Z'));
          return isNaN(p.getTime()) ? '' : format(p, 'dd/MM/yyyy HH:mm', { locale: ptBR });
        } catch(e) { return ''; }
      })(),
    }));
    downloadCSV(rows, `${paleteAberto.codigo}_caixas_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const paletesFiltrados = paletes.filter(p =>
    !filtroCodigo || p.codigo.toLowerCase().includes(filtroCodigo.toLowerCase())
  );

  const totalCaixasFiltradas = paletesFiltrados.reduce((s, p) => s + (p.qtd_caixas || 0), 0);
  const totalPesoFiltrado = paletesFiltrados.reduce((s, p) => s + parseFloat(p.peso_total || 0), 0);
  const qtdNaDoca = paletesFiltrados.filter(p => p.status === 'EM_MONTAGEM').length;
  const qtdDocaFinalizado = paletesFiltrados.filter(p => p.status === 'FECHADO' && p.endereco_atual === 'DOCA' && p.qtd_disponiveis > 0).length;
  const qtdArmazenados = paletesFiltrados.filter(p => p.status === 'FECHADO' && (p.endereco_atual !== 'DOCA' || p.qtd_disponiveis <= 0)).length;

  // ── DETALHE DO PALETE ──
  if (paleteAberto) {
    const pesoTotal = caixasDetalhe.reduce((s, c) => s + c.peso_kg, 0);
    const qtdDisponiveis = caixasDetalhe.filter(c => c.palete_id === paleteAberto.id && c.status === 'DISPONIVEL').length;
    const qtdConsumidas = caixasDetalhe.length - qtdDisponiveis;

    return (
      <div key="detalhe" style={{ maxWidth: 900 }}>
        {/* Header do detalhe */}
        <div className="card mb-16" style={{ padding: '14px 18px' }}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-12">
              <button className="btn btn--ghost btn--sm text-muted p-0" onClick={() => { setPaleteAberto(null); setCaixasDetalhe([]); }}>
                <ArrowLeft size={16} /> Voltar
              </button>
              <div>
                <h2 className="text-xl" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 12 }}>
                  {paleteAberto.codigo}
                  <span className="badge text-sm" style={{ 
                    background: paleteAberto.status === 'EM_MONTAGEM' ? 'var(--warning-muted)' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA' && caixasDetalhe.some(c => c.status === 'DISPONIVEL')) ? 'var(--info-muted)' : 'var(--success-muted)', 
                    color: paleteAberto.status === 'EM_MONTAGEM' ? 'var(--warning)' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA' && caixasDetalhe.some(c => c.status === 'DISPONIVEL')) ? 'var(--info)' : 'var(--success)' 
                  }}>
                    {paleteAberto.status === 'EM_MONTAGEM' ? '🟡 Na Doca' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA' && caixasDetalhe.some(c => c.status === 'DISPONIVEL')) ? '🏁 Na Doca (Finalizado)' : '✅ Armazenado'} · Endereço: <strong>{paleteAberto.endereco_atual}</strong>
                  </span>
                </h2>
              </div>
            </div>
            <div className="flex gap-8 items-center">
              {paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA' && operador?.perm_produtos === 1 && (
                <button className="btn btn--sm" style={{ background: 'var(--warning-muted)', color: 'var(--warning)', borderColor: 'rgba(251,191,36,0.3)', borderWidth: 1, borderStyle: 'solid', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setModalReabrirOpen(true)}>
                  <Unlock size={14} /> Reabrir Palete
                </button>
              )}
              <button className="btn btn--ghost btn--sm" onClick={exportarCaixasCSV}>
                <Download size={14} /> CSV
              </button>
            </div>
          </div>

          {/* Totalizadores */}
          <div className="flex gap-16 mt-14" style={{ flexWrap: 'wrap' }}>
            <div style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '8px 16px', textAlign: 'center', flex: 1, minWidth: 80 }}>
              <div className="text-xs text-muted mb-2">Total Caixas</div>
              <div className="font-bold text-primary" style={{ fontSize: 20 }}>{caixasDetalhe.length}</div>
            </div>
            <div style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '8px 16px', textAlign: 'center', flex: 1, minWidth: 80 }}>
              <div className="text-xs text-muted mb-2">Peso Total</div>
              <div className="font-bold text-cyan" style={{ fontSize: 20 }}>{pesoTotal.toFixed(2)} kg</div>
            </div>
            <div style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '8px 16px', textAlign: 'center', flex: 1, minWidth: 80 }}>
              <div className="text-xs text-muted mb-2">No Palete</div>
              <div className="font-bold text-success" style={{ fontSize: 20 }}>{qtdDisponiveis}</div>
            </div>
            <div style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '8px 16px', textAlign: 'center', flex: 1, minWidth: 80 }}>
              <div className="text-xs text-muted mb-2">Retiradas</div>
              <div className="font-bold text-warning" style={{ fontSize: 20 }}>{qtdConsumidas}</div>
            </div>
          </div>
        </div>

        {/* Lista de caixas */}
        {loadingDetalhe ? (
          <div className="card text-center p-32 text-muted">Carregando caixas...</div>
        ) : caixasDetalhe.length === 0 ? (
          <div className="card text-center p-32 text-muted">
            <Package size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <div>Nenhuma caixa registrada neste palete.</div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs text-muted font-bold uppercase">Caixas do Palete ({caixasDetalhe.length})</span>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 520 }}>
              {caixasDetalhe.map((c, i) => {
                const enderecoCaixa = c.endereco || paleteAberto.endereco_atual;
                const isDoca = c.status === 'DISPONIVEL' && (enderecoCaixa === 'DOCA' || enderecoCaixa === 'REC');
                return (
                <div key={c.id} style={{
                  padding: '10px 16px',
                  borderBottom: i < caixasDetalhe.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: c.status === 'CONSUMIDA' ? 'rgba(251,191,36,0.04)' : 'transparent'
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="font-bold text-sm" style={{ lineHeight: 1.3 }}>{c.produto_descricao}</div>
                    <div className="text-xs font-mono text-muted mt-2" style={{ wordBreak: 'break-all' }}>{c.ean_caixa}</div>
                    <div className="text-muted text-xs">
                      {c.palete_id === paleteAberto.id && c.status === 'DISPONIVEL' ? '-' : `Endereço: ${c.endereco || 'Desconhecido'}`}
                    </div>
                    {c.created_at && (
                      <div className="text-xs text-muted mt-2">
                        🕐 {(() => {
                          try {
                            const parsed = new Date(c.created_at.replace(' ', 'T') + (c.created_at.includes('Z') ? '' : 'Z'));
                            return isNaN(parsed.getTime()) ? '-' : format(parsed, 'dd/MM/yy HH:mm', { locale: ptBR });
                          } catch (e) {
                            return '-';
                          }
                        })()}{c.bipado_por ? ` · por ${c.bipado_por}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-12" style={{ flexShrink: 0 }}>
                    <div className="font-bold text-cyan text-sm">{c.peso_kg} kg</div>
                    {c.validade && (
                      <div className="text-xs text-muted">Venc: {format(new Date(c.validade + 'T00:00:00'), 'dd/MM/yy')}</div>
                    )}
                    <div style={{
                      marginTop: 4, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: c.status === 'DISPONIVEL' ? (isDoca ? 'var(--info-muted)' : 'rgba(16,185,129,0.15)') : 'rgba(251,191,36,0.15)',
                      color: c.status === 'DISPONIVEL' ? (isDoca ? 'var(--info)' : 'var(--success)') : 'var(--warning)'
                    }}>
                      {c.status === 'DISPONIVEL' ? (isDoca ? '⏳ Na Doca' : '✅ Estoque') : `📤 ${c.status === 'RESERVADA' && c.endereco ? c.endereco : c.status.replace('_', ' ')}`}
                    </div>
                  </div>
                </div>
              )})}
            </div>
          </div>
        )}

        {/* Modal Reabrir Palete */}
        {modalReabrirOpen && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
            <div className="card animate-fade-in" style={{ width: 420, padding: 24, position: 'relative' }}>
              <button className="btn btn--ghost" style={{ position: 'absolute', top: 12, right: 12, padding: 4 }} onClick={() => setModalReabrirOpen(false)}>
                <X size={20} />
              </button>
              
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--warning-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <Unlock size={24} style={{ color: 'var(--warning)' }} />
                </div>
                <h3 className="font-bold text-lg mb-8">Reabrir Palete</h3>
                <p className="text-muted text-sm" style={{ lineHeight: 1.5 }}>
                  Ao reabrir este palete, ele retornará para a aba de montagem na Doca para a adição de novas caixas.
                </p>
              </div>

              <div style={{ background: 'rgba(239,68,68,0.1)', padding: 12, borderRadius: 8, marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
                <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  <strong>Atenção:</strong> As caixas que já foram finalizadas e estão na Doca <strong className="text-danger">não poderão ser apagadas</strong> do sistema após a reabertura.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setModalReabrirOpen(false)} disabled={loadingDetalhe}>
                  Cancelar
                </button>
                <button className="btn" style={{ flex: 1, background: 'var(--warning)', color: '#000', fontWeight: 600 }} onClick={handleReabrirPalete} disabled={loadingDetalhe}>
                  {loadingDetalhe ? 'Reabrindo...' : 'Sim, Reabrir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── LISTA DE PALETES ──
  return (
    <div key="lista" style={{ maxWidth: 900 }}>
      {/* Filtros */}
      <div className="card mb-16">
        <div className="flex items-center gap-8 mb-14">
          <Filter size={16} className="text-muted" />
          <span className="font-bold text-sm">Filtros</span>
        </div>
        <div className="form-grid form-grid--2" style={{ gap: 10 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Código do Palete</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="PLT-0001..."
                value={filtroCodigo}
                onChange={e => setFiltroCodigo(e.target.value)}
                style={{ paddingLeft: 30 }}
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Status</label>
            <select className="form-input" value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
              <option value="TODOS">Todos os paletes</option>
              <option value="EM_MONTAGEM">Na Doca</option>
              <option value="FECHADO">Finalizados / Armazenados</option>
              <option value="FINALIZADO">Finalizados (Vazios)</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Data Início</label>
            <input type="date" className="form-input" value={filtroDataInicio} onChange={e => setFiltroDataInicio(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Data Fim</label>
            <input type="date" className="form-input" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-8 mt-14">
          <button className="btn btn--primary flex-1" onClick={carregar}>
            <Search size={14} /> Buscar
          </button>
          <button className="btn btn--ghost" onClick={() => { setFiltroDataInicio(''); setFiltroDataFim(''); setFiltroStatus('TODOS'); setFiltroCodigo(''); }}>
            Limpar
          </button>
          <button className="btn btn--ghost" onClick={exportarPaletesCSV} title="Exportar lista como CSV">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {/* Totalizadores gerais */}
      {paletesFiltrados.length > 0 && (
        <div className="flex gap-16 mb-16" style={{ flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', flex: 1, minWidth: 100, textAlign: 'center' }}>
            <div className="text-xs text-muted">Paletes encontrados</div>
            <div className="font-bold text-primary" style={{ fontSize: 20 }}>{paletesFiltrados.length}</div>
          </div>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', flex: 1, minWidth: 100, textAlign: 'center' }}>
            <div className="text-xs text-muted">Total Caixas</div>
            <div className="font-bold text-cyan" style={{ fontSize: 20 }}>{totalCaixasFiltradas}</div>
          </div>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', flex: 1, minWidth: 100, textAlign: 'center' }}>
            <div className="text-xs text-muted">Peso Total</div>
            <div className="font-bold text-success" style={{ fontSize: 20 }}>{totalPesoFiltrado.toFixed(1)} kg</div>
          </div>
          <div style={{ background: 'var(--warning-muted)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 16px', flex: 1, minWidth: 100, textAlign: 'center' }}>
            <div className="text-xs" style={{ color: 'var(--warning)', opacity: 0.8 }}>🟡 Na Doca</div>
            <div className="font-bold" style={{ fontSize: 20, color: 'var(--warning)' }}>{qtdNaDoca}</div>
          </div>
          <div style={{ background: 'var(--info-muted)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8, padding: '10px 16px', flex: 1, minWidth: 100, textAlign: 'center' }}>
            <div className="text-xs" style={{ color: 'var(--info)', opacity: 0.8 }}>🏁 Doca Finalizado</div>
            <div className="font-bold" style={{ fontSize: 20, color: 'var(--info)' }}>{qtdDocaFinalizado}</div>
          </div>
          <div style={{ background: 'var(--success-muted)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 16px', flex: 1, minWidth: 100, textAlign: 'center' }}>
            <div className="text-xs" style={{ color: 'var(--success)', opacity: 0.8 }}>✅ Armazenados</div>
            <div className="font-bold" style={{ fontSize: 20, color: 'var(--success)' }}>{qtdArmazenados}</div>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="card text-center p-32 text-muted">Carregando histórico...</div>
      ) : paletesFiltrados.length === 0 ? (
        <div className="card text-center p-32 text-muted">
          <History size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <div>Nenhum palete encontrado com esses filtros.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs text-muted font-bold uppercase">Histórico de Paletes — {paletesFiltrados.length} resultados</span>
          </div>
          {paletesFiltrados.map((p, i) => {
            const isAtivo = p.status === 'EM_MONTAGEM';
            const isFinalizado = p.status === 'FECHADO';
            return (
              <div
                key={p.id}
                onClick={() => abrirDetalhe(p)}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < paletesFiltrados.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-8 mb-4">
                    <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{p.codigo}</span>
                    <span className="badge" style={{ 
                      fontSize: 10, 
                      background: isAtivo ? 'var(--warning-muted)' : (isFinalizado && p.endereco_atual === 'DOCA' && p.qtd_disponiveis > 0) ? 'var(--info-muted)' : 'var(--success-muted)', 
                      color: isAtivo ? 'var(--warning)' : (isFinalizado && p.endereco_atual === 'DOCA' && p.qtd_disponiveis > 0) ? 'var(--info)' : 'var(--success)' 
                    }}>
                      {isAtivo ? '🟡 NA DOCA' : (isFinalizado && p.endereco_atual === 'DOCA' && p.qtd_disponiveis > 0) ? '🏁 NA DOCA (FINALIZADO)' : '✅ ARMAZENADO'}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    📍 {p.endereco_atual} &nbsp;·&nbsp;
                    📦 {p.qtd_caixas || 0} caixas &nbsp;·&nbsp;
                    ⚖️ {parseFloat(p.peso_total || 0).toFixed(2)} kg
                  </div>
                  {p.created_at && (
                    <div className="text-xs text-muted mt-2">
                      🕐 Aberto em {(() => { try { const d = new Date(String(p.created_at).endsWith('Z') ? p.created_at : p.created_at + 'Z'); return isNaN(d.getTime()) ? '-' : format(d, 'dd/MM/yyyy HH:mm', { locale: ptBR }); } catch { return '-'; } })()}
                      {p.ultima_caixa && ` · Última bipagem: ${(() => { try { const d = new Date(String(p.ultima_caixa).endsWith('Z') ? p.ultima_caixa : p.ultima_caixa + 'Z'); return isNaN(d.getTime()) ? '-' : format(d, 'dd/MM/yyyy HH:mm', { locale: ptBR }); } catch { return '-'; } })()} ${p.ultimo_operador ? `por ${p.ultimo_operador}` : ''}`}
                    </div>
                  )}
                </div>
                <ChevronRight size={16} className="text-muted" style={{ flexShrink: 0, marginLeft: 8 }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────────
export function Recebimento() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  const apiAtiva = isApiEnabled()
  
  // Tabs
  const [activeTab, setActiveTab] = useState(apiAtiva ? 'pedidos' : 'palete') // 'pedidos' | 'palete' | 'historico'

  // Caixas pré-importadas via TXT (Recebimento Guiado)
  const [preCaixas, setPreCaixas] = useState([])
  const [preCaixasResumo, setPreCaixasResumo] = useState({ total: 0, pendentes: 0, bipadas: 0, peso_total_kg: 0, peso_bipada_kg: 0 })
  const [filtroStatusPre, setFiltroStatusPre] = useState('PENDENTE')
  const [eanPreScanner, setEanPreScanner] = useState('')
  const [enderecoPre, setEnderecoPre] = useState('REC')
  const [paletePreId, setPaletePreId] = useState('')
  const [loadingPre, setLoadingPre] = useState(false)
  const preScanRef = useRef(null)
  
  // Pedido de Compra vinculado na doca (ERP API)
  const [pcsDoca, setPcsDoca] = useState([])
  const [travaSemPc, setTravaSemPc] = useState(false)
  const [pcSelecionadoId, setPcSelecionadoId] = useState('')
  const [numeroNfPc, setNumeroNfPc] = useState('')
  
  // Estado do Palete LPN
  const [paletesAbertos, setPaletesAbertos] = useState([])
  const [paleteAtivo, setPaleteAtivo] = useState(null)
  const [caixasDoPalete, setCaixasDoPalete] = useState([])
  const [modalConcluirOpen, setModalConcluirOpen] = useState(false)
  
  // Formulário de Caixa SSCC (novo padrão com Data Produção, Validade, Tara, Peso Bruto -> Peso Líquido e Lote DDMMYY)
  const [eanBipado, setEanBipado] = useState('')
  const [eanCaixaReal, setEanCaixaReal] = useState('')
  const [eanEhUnico, setEanEhUnico] = useState(true)
  const [produtoDetectado, setProdutoDetectado] = useState(null)
  const [taras, setTaras] = useState([])
  const [boxData, setBoxData] = useState({
    data_producao: hojeIsoLocal(),
    validade: '',
    tara_id: '',
    peso_bruto: '',
    qtd_pecas: '',
  })
  const [etiquetaPreview, setEtiquetaPreview] = useState(null)
  const pesoBrutoRef = useRef(null)
  
  // Modal de EAN
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  const carregarPcsDoca = useCallback(async () => {
    if (!apiAtiva) return
    try {
      const res = await comprasQueries.listarPedidosLiberadosParaDoca()
      setPcsDoca(res?.data || [])
      setTravaSemPc(Boolean(res?.trava_recebimento_sem_pc))
    } catch { /* ignore */ }
  }, [apiAtiva])

  const carregarPreCaixas = useCallback(async () => {
    if (!apiAtiva) return
    setLoadingPre(true)
    try {
      const res = await comprasQueries.listarPreCaixasRecebimento({
        pedido_compra_id: pcSelecionadoId || undefined,
        status: filtroStatusPre,
      })
      setPreCaixas(res?.data || [])
      setPreCaixasResumo(res?.resumo || { total: 0, pendentes: 0, bipadas: 0, peso_total_kg: 0, peso_bipada_kg: 0 })
    } catch {
      /* ignore */
    } finally {
      setLoadingPre(false)
    }
  }, [apiAtiva, pcSelecionadoId, filtroStatusPre])

  // Carregar dados iniciais
  useEffect(() => {
    carregarPaletesAbertos()
    carregarPcsDoca()
    carregarPreCaixas()
    tarasQueries.listar(true).then((lista) => {
      setTaras(lista)
      const padrao = resolverTaraSelecionada(lista, '')
      if (padrao) {
        setBoxData(prev => prev.tara_id ? prev : { ...prev, tara_id: String(padrao.id) })
      }
    }).catch(() => {})
  }, [carregarPcsDoca, carregarPreCaixas])

  const carregarPaletesAbertos = async () => {
    try {
      const lista = await movimentacoesQueries.listarPaletesAbertos()
      setPaletesAbertos(lista)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar paletes abertos.')
    }
  }

  const selecionarPalete = async (p) => {
    setPaleteAtivo(p)
    try {
      const caixas = await movimentacoesQueries.listarCaixasDoPalete(p.id)
      setCaixasDoPalete(caixas)
    } catch (e) {
      console.error(e)
    }
  }

  const handleCriarPalete = async () => {
    try {
      const novo = await movimentacoesQueries.criarPalete()
      toastSuccess('Palete Aberto', `Código gerado: ${novo.codigo}`)
      await carregarPaletesAbertos()
      selecionarPalete(novo)
    } catch (e) {
      toastError('Erro', e.message)
    }
  }

  const handleRemoverCaixa = async (c) => {
    if (c.endereco === 'DOCA') {
      toastWarning('Atenção', 'Esta caixa já foi fechada na Doca anteriormente e não pode ser apagada do sistema.');
      return;
    }
    const ok = await useAppStore.getState().confirmar({
      title: 'Apagar Caixa do Palete',
      message: `Tem certeza que deseja apagar a caixa de ${c.peso_kg}kg do palete?`,
      type: 'error',
      confirmLabel: 'Apagar Caixa',
    })
    if (!ok) return;
    try {
      const res = await movimentacoesQueries.removerCaixaSerializada(c.id, operador.id, operador.nome);
      if (res.success) {
        toastSuccess('Sucesso', 'Caixa apagada.');
        selecionarPalete(paleteAtivo);
        carregarPaletesAbertos();
        carregarPcsDoca();
      } else {
        toastError('Erro', res.error);
      }
    } catch (e) {
      toastError('Erro fatal', e.message);
    }
  };

  const handleConcluirPalete = async () => {
    if (!paleteAtivo) return;
    if (caixasDoPalete.length === 0) {
      toastWarning('Palete Vazio', 'Não é possível finalizar um palete sem caixas. Adicione pelo menos uma caixa ou exclua este palete.');
      setModalConcluirOpen(false);
      return;
    }
    try {
      const res = await movimentacoesQueries.concluirPalete(paleteAtivo.id);
      if (res.success) {
        toastSuccess('Palete Concluído ✅', `${paleteAtivo.codigo} fechado com sucesso.`);
        setPaleteAtivo(null);
        setCaixasDoPalete([]);
        setModalConcluirOpen(false);
        carregarPaletesAbertos();
      } else {
        toastError('Erro', res.error);
      }
    } catch (e) {
      toastError('Erro fatal', e.message);
    }
  };

  const handleBiparPreCaixa = async (codigoRaw, { paleteIdOverride = paletePreId, enderecoOverride = enderecoPre } = {}) => {
    const cod = String(codigoRaw || eanPreScanner || '').trim()
    if (!cod) return
    try {
      const res = await comprasQueries.biparPreCaixa({
        ean_caixa: cod,
        pedido_compra_id: pcSelecionadoId || null,
        palete_id: paleteIdOverride || null,
        endereco: enderecoOverride || 'REC',
      })
      const cx = res.caixa
      toastSuccess(
        'Pré-Caixa Efetivada ✅',
        `${cx.produto_descricao} • ${Number(cx.peso_kg || 0).toFixed(2)} kg${cx.qtd_pecas ? ` (${cx.qtd_pecas} pç)` : ''}`,
      )
      setEanPreScanner('')
      carregarPreCaixas()
      carregarPcsDoca()
      if (paleteAtivo && paleteIdOverride === paleteAtivo.id) {
        selecionarPalete(paleteAtivo)
        carregarPaletesAbertos()
      }
      return true
    } catch (err) {
      toastError('Bipagem Pré-Caixa', err.message)
      return false
    } finally {
      setTimeout(() => preScanRef.current?.focus(), 80)
    }
  }

  const handleConfirmarLotePreCaixas = async () => {
    const pendentesIds = preCaixas.filter((c) => c.status === 'PENDENTE').map((c) => c.id)
    if (pendentesIds.length === 0) return toastWarning('Nada pendente', 'Não há pré-caixas pendentes nesta seleção.')
    const ok = await useAppStore.getState().confirmar({
      title: 'Confirmar Pré-Caixas em Lote',
      message: `Efetivar direto no endereço ${enderecoPre || 'REC'} todas as ${pendentesIds.length} caixa(s) pendente(s) listadas?`,
      type: 'confirm',
      confirmLabel: 'Confirmar Lote',
    })
    if (!ok) return
    try {
      const res = await comprasQueries.confirmarPreCaixasLote({
        pre_caixa_ids: pendentesIds,
        endereco: enderecoPre || 'REC',
        palete_id: paletePreId || null,
      })
      toastSuccess('Lote Confirmado ✅', `${res.confirmadas} caixa(s) (${fmtKg2(res.peso_kg)}) inseridas no estoque!`)
      carregarPreCaixas()
      carregarPcsDoca()
      if (paleteAtivo) {
        selecionarPalete(paleteAtivo)
        carregarPaletesAbertos()
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  // --- Fluxo de Bipagem da Caixa (SSCC) ---
  const { inputRef: codigoRef, handleKeyDown: handleCodigoKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      if (!paleteAtivo) return toastWarning('Atenção', 'Abra ou selecione um palete primeiro.')
      setEanBipado(val)
      setProdutoDetectado(null)
      
      try {
        const caixaExistente = await estoqueQueries.buscarCaixaPorEan(val)
        if (caixaExistente) {
          toastError('Caixa Duplicada', 'Esta caixa já foi recebida e consta no estoque.')
          setEanBipado('')
          setTimeout(() => codigoRef.current?.focus(), 100)
          return
        }

        if (apiAtiva) {
          const valSemZero = String(val).trim().replace(/^0+/, '')
          const matchPre = preCaixas.find(
            (p) =>
              p.status === 'PENDENTE' &&
              (p.ean_caixa === val || String(p.ean_caixa || '').replace(/^0+/, '') === valSemZero),
          )
          if (matchPre) {
            await handleBiparPreCaixa(val, {
              paleteIdOverride: paleteAtivo.id,
              enderecoOverride: paleteAtivo.endereco_atual || 'REC',
            })
            setEanBipado('')
            setTimeout(() => codigoRef.current?.focus(), 100)
            return
          }
        }

        const resultado = await produtosQueries.buscarPorCodigoComInfo(val)
        if (resultado) {
          const { produto, eanUnico } = resultado
          setProdutoDetectado(produto)
          setEanEhUnico(eanUnico)
          if (eanUnico) {
            setEanCaixaReal(val)
            toastSuccess('Caixa SSCC Identificada', produto.descricao)
          } else {
            // EAN genérico (identificado por sufixo/regra): usa o EAN original como identificador da caixa
            setEanCaixaReal(val)
            toastWarning('EAN Genérico', `${produto.descricao} — informe datas, tara e peso bruto.`)
          }
          setTimeout(() => pesoBrutoRef.current?.focus(), 100)
        } else {
          setEanDesconhecido(val)
          setModalEanOpen(true)
        }
      } catch (e) {
        toastError('Erro', 'Falha ao processar código.')
      }
    }
  })

  const handleAdicionarCaixa = async (e) => {
    e?.preventDefault()
    if (!paleteAtivo) return toastError('Atenção', 'Selecione um palete.')
    if (!produtoDetectado) return toastError('Atenção', 'Produto não detectado.')
    if (!eanCaixaReal || eanCaixaReal.trim() === '') return toastError('Atenção', 'EAN inválido ou vazio. Bipe novamente.')

    const taraAtual = resolverTaraSelecionada(taras, boxData.tara_id)
    const valid = validarPesagemTara({
      dataProducao: boxData.data_producao,
      validade: boxData.validade,
      taraId: taraAtual?.id,
      taraKg: taraAtual?.peso_kg ?? 0,
      pesoBruto: boxData.peso_bruto,
      qtdPecas: boxData.qtd_pecas,
    })
    if (!valid.ok) return toastWarning('Dados da Caixa', valid.erro)
    if (valid.peso_bruto_kg > 1000) {
      return toastError('Peso Inválido', 'O peso bruto da caixa está muito alto. Verifique se você bipou o código de barras no campo de peso acidentalmente!')
    }

    try {
      const res = await movimentacoesQueries.receberCaixaSerializada({
        ean_caixa: eanCaixaReal,
        produto_id: produtoDetectado.id,
        palete_id: paleteAtivo.id,
        pedido_compra_id: pcSelecionadoId || null,
        numero_nf: numeroNfPc || '',
        peso_kg: valid.peso_liquido_kg,
        peso_bruto_kg: valid.peso_bruto_kg,
        tara_id: valid.tara_id,
        tara_kg: valid.tara_kg,
        qtd_pecas: valid.qtd_pecas,
        data_producao: valid.data_producao,
        lote: valid.lote,
        validade: valid.validade,
        origem_tipo: 'RECEBIMENTO',
        operador_id: operador.id,
        operador_nome: operador.nome
      })

      if (res.success) {
        toastSuccess(
          'Caixa Adicionada',
          `${produtoDetectado.descricao} • ${valid.qtd_pecas} pç • Líq ${fmtKg2(valid.peso_liquido_kg)} (Lote ${valid.lote}) no ${paleteAtivo.codigo}.`
        )
        setEanBipado('')
        setEanCaixaReal('')
        setEanEhUnico(true)
        setProdutoDetectado(null)
        setBoxData(prev => ({
          data_producao: prev.data_producao || hojeIsoLocal(),
          validade: prev.validade,
          tara_id: prev.tara_id || (taraAtual ? String(taraAtual.id) : ''),
          peso_bruto: '',
          qtd_pecas: '',
        }))
        selecionarPalete(paleteAtivo)
        carregarPaletesAbertos()
        carregarPcsDoca()
        codigoRef.current?.focus()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro fatal', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 1240 }}>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title">Recebimento (Inbound)</h1>
          <p className="page-header__subtitle">
            {apiAtiva
              ? 'Conferência na Doca por Pedido de Compra, Balança e Etiqueta .TXT'
              : 'Montagem de Paletes LPN e Rastreabilidade SSCC'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {apiAtiva ? (
          <button
            className={`btn ${activeTab === 'pedidos' ? 'btn--primary' : 'btn--ghost'}`}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
            onClick={() => setActiveTab('pedidos')}
          >
            <ClipboardCheck size={16} /> Recebimento por Pedido de Compra
          </button>
        ) : (
          <button
            className={`btn ${activeTab === 'palete' ? 'btn--primary' : 'btn--ghost'}`}
            style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
            onClick={() => {
              setActiveTab('palete');
              carregarPaletesAbertos();
              setTimeout(() => codigoRef.current?.focus(), 100);
            }}
          >
            <Layers size={16} /> Recebimento c/ Palete
          </button>
        )}
        <button
          className={`btn ${activeTab === 'historico' ? 'btn--primary' : 'btn--ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => setActiveTab('historico')}
        >
          <History size={16} /> Histórico de Paletes
        </button>
      </div>

      {/* TAB: Recebimento guiado por Pedido de Compra (API) */}
      {apiAtiva && activeTab === 'pedidos' && <RecebimentoPedidoDoca />}

      {/* TAB: Recebimento offline c/ Palete (apenas sem API) */}
      {!apiAtiva && activeTab === 'palete' && (
        <div className="grid-responsive">
          {apiAtiva && (
            <div className="card mb-12" style={{ borderColor: travaSemPc && !pcSelecionadoId ? 'var(--warning)' : 'var(--border)' }}>
              <div className="flex justify-between items-center flex-wrap gap-8 mb-8">
                <div className="text-xs font-bold uppercase text-primary">
                  {travaSemPc ? '🔒 Vínculo Obrigatório: Pedido de Compra' : '📋 Pedido de Compra (Opcional)'}
                </div>
                {pcSelecionadoId && (
                  <button
                    type="button"
                    className="btn btn--info btn--sm"
                    onClick={async () => {
                      try {
                        const r = await comprasQueries.enviarParaValidacao(pcSelecionadoId, { numero_nf: numeroNfPc })
                        toastSuccess('Enviado para Supply Chain', `Recebimento ${r.recebimento_codigo} (${r.status_validacao}) aguardando validação 3-Way!`)
                        carregarPcsDoca()
                      } catch (err) {
                        toastError('Erro', err.message)
                      }
                    }}
                  >
                    Enviar p/ Validação 3-Way
                  </button>
                )}
              </div>
              <div className="form-grid form-grid--3" style={{ gap: 8 }}>
                <div className="form-group" style={{ gridColumn: 'span 2', marginBottom: 0 }}>
                  <select className="form-input" value={pcSelecionadoId} onChange={(e) => setPcSelecionadoId(e.target.value)}>
                    <option value="">{travaSemPc ? 'Selecione um Pedido de Compra aprovado (obrigatório)...' : 'Recebimento avulso (sem PC vinculado)...'}</option>
                    {pcsDoca.map((pc) => (
                      <option key={pc.id} value={pc.id}>
                        {pc.codigo} — {pc.fornecedor_nome} ({pc.status}) {pc.fornecedor_sif ? `• SIF ${pc.fornecedor_sif}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Nº Nota Fiscal (opcional)"
                    value={numeroNfPc}
                    onChange={(e) => setNumeroNfPc(e.target.value)}
                  />
                </div>
              </div>
              {pcSelecionadoId && (() => {
                const pcObj = pcsDoca.find((x) => x.id === pcSelecionadoId)
                if (!pcObj?.itens?.length) return null
                return (
                  <div className="flex gap-8 flex-wrap mt-8">
                    {pcObj.itens.map((it) => (
                      <span key={it.id} className="badge badge--neutral">
                        {it.produto_descricao}: {Number(it.qtd_kg_recebida || 0).toFixed(1)} / {Number(it.qtd_kg_solicitada || 0).toFixed(1)} kg
                      </span>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}
          
          {/* MASTER: Seleção de Palete */}
          {!paleteAtivo && (
            <div className="card">
              <div className="flex justify-between items-center mb-16">
                <h3 className="font-bold text-primary flex items-center gap-8"><Layers size={18} /> Paletes de Entrada</h3>
                <button className="btn btn--sm btn--primary" onClick={handleCriarPalete}><Plus size={14}/> Novo Palete</button>
              </div>

              {paletesAbertos.length > 0 ? (
                <div className="mb-16">
                  <label className="text-xs text-muted font-bold mb-8 block">PALETES NA DOCA</label>
                  <div className="flex flex-col gap-8">
                  {paletesAbertos.map(p => (
                    <div
                      key={p.id}
                      onClick={() => selecionarPalete(p)}
                      style={{
                        padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: '1px solid',
                        borderColor: 'var(--border)',
                        background: 'var(--bg-2)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--primary-muted)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-2)'; }}
                    >
                      <div>
                        <div className="font-bold text-primary font-mono">{p.codigo}</div>
                        <div className="text-xs text-muted mt-2">{p.qtd_caixas || 0} caixas · {parseFloat(p.peso_total || 0).toFixed(2)} kg</div>
                        {p.created_at && <div className="text-xs text-muted">{format(new Date(p.created_at), 'dd/MM HH:mm', { locale: ptBR })}</div>}
                      </div>
                      <ChevronRight size={16} className="text-muted" />
                    </div>
                  ))}
                  </div>
                </div>
              ) : (
                <div className="p-32 text-center text-muted" style={{ border: '2px dashed var(--border)', borderRadius: 10 }}>
                  <Layers size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <div className="mb-12">Nenhum palete na doca.</div>
                  <button className="btn btn--primary" onClick={handleCriarPalete}><Plus size={14}/> Abrir um novo palete</button>
                </div>
              )}
            </div>
          )}

          {/* DETAIL: Bipagem */}
          {paleteAtivo && (
            <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
              {/* Header do palete */}
              <div style={{ background: 'var(--bg-2)', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="flex justify-between items-center mb-10">
                  <button className="btn btn--ghost btn--sm text-muted p-0" onClick={() => { setPaleteAtivo(null); setCaixasDoPalete([]); }}>
                    <ArrowLeft size={16}/> Voltar
                  </button>
                  <div className="text-sm font-bold text-primary font-mono">{paleteAtivo.codigo}</div>
                  <button 
                    className="btn btn--sm"
                    style={{ background: 'var(--success)', color: 'white', border: 'none' }}
                    onClick={() => setModalConcluirOpen(true)}
                    title="Fechar o palete na doca"
                  >
                    <Check size={14}/> Concluir
                  </button>
                </div>
                <div className="flex justify-between text-sm px-4">
                  <div>Caixas: <strong className="text-primary">{caixasDoPalete.length}</strong></div>
                  <div>Peso: <strong className="text-cyan">{caixasDoPalete.reduce((sum, c) => sum + c.peso_kg, 0).toFixed(2)} kg</strong></div>
                </div>
              </div>
              
              <div style={{ padding: '16px' }}>
                {/* Scanner */}
                <h3 className="font-bold text-warning flex items-center gap-8 mb-16"><ScanBarcode size={18} /> Bipar Caixa SSCC</h3>
                <form onSubmit={handleAdicionarCaixa}>
                  <div className="form-group mb-16">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        ref={codigoRef}
                        type="text"
                        className="form-input form-input--scanner"
                        placeholder="Bipe o código de barras..."
                        value={eanBipado}
                        onChange={(e) => setEanBipado(e.target.value)}
                        onKeyDown={handleCodigoKeyDown}
                      />
                      {eanBipado && (
                        <button type="button" className="btn btn--ghost text-muted" onClick={() => { setEanBipado(''); setProdutoDetectado(null); codigoRef.current?.focus() }}>
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {produtoDetectado && (
                    <div style={{ background: 'var(--bg-2)', padding: '14px 16px', borderRadius: 10, border: `1px solid ${eanEhUnico ? 'var(--primary)' : 'var(--warning)'}`, marginBottom: 16 }}>
                      <div className="text-xs font-bold mb-4 uppercase" style={{ color: eanEhUnico ? 'var(--primary)' : 'var(--warning)' }}>
                        {eanEhUnico ? '✅ Caixa SSCC Identificada' : '⚠️ EAN Genérico (Sufixo)'}
                      </div>
                      <div className="font-bold text-sm" style={{ lineHeight: 1.2 }}>{produtoDetectado.descricao}</div>
                      <div className="text-xs text-muted mb-8">Código: {produtoDetectado.codigo || '-'} • EAN: <span className="font-mono">{eanCaixaReal}</span></div>
                      {!eanEhUnico && (
                        <div style={{ fontSize: 10, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, padding: '4px 8px', color: 'var(--warning)', marginBottom: 10 }}>
                          🏷️ Salva com EAN original: <strong style={{ fontFamily: 'monospace' }}>{eanCaixaReal}</strong>
                        </div>
                      )}

                      <PesagemTaraFields
                        taras={taras}
                        value={boxData}
                        onChange={(next) => setBoxData(next)}
                        pesoBrutoRef={pesoBrutoRef}
                        onEnterPesoBruto={handleAdicionarCaixa}
                      />

                      <div className="mt-16 text-right">
                        <button type="submit" className="btn btn--primary btn--lg w-full">
                          <Check size={18} /> Salvar Caixa no Palete
                        </button>
                      </div>
                    </div>
                  )}
                </form>

                {/* Lista de caixas do palete ativo */}
                <div className="mt-16">
                  <h4 className="text-xs text-muted font-bold mb-8 uppercase tracking-wider">Caixas no Palete ({caixasDoPalete.length})</h4>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                    {caixasDoPalete.length === 0 ? (
                      <div className="text-center text-muted p-24 text-sm">Nenhuma caixa bipada ainda.</div>
                    ) : (
                      caixasDoPalete.map((c, i) => (
                        <div key={c.id} style={{ padding: '10px 12px', borderBottom: i < caixasDoPalete.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <div>
                            <div className="font-bold text-sm" style={{ lineHeight: 1.2 }}>{c.produto_descricao}</div>
                            <div className="text-xs text-muted font-mono mt-4">
                              {c.ean_caixa}
                              {c.lote ? ` • Lote ${c.lote}` : ''}
                              {c.data_producao ? ` • Prod ${fmtDataBR(c.data_producao)}` : ''}
                            </div>
                          </div>
                          <div className="text-right flex items-center gap-8">
                            <div>
                              <div className="font-bold text-cyan text-sm">
                                Líq: {fmtKg2(c.peso_kg)}{c.qtd_pecas ? ` • ${c.qtd_pecas} pç` : ''}
                              </div>
                              <div className="text-xs text-muted">
                                {c.peso_bruto_kg != null ? `Bruto: ${fmtKg2(c.peso_bruto_kg)} | Tara: ${fmtKg3(c.tara_kg || 0)} • ` : ''}
                                Venc: {fmtDataBR(c.validade)}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn--ghost p-4"
                              onClick={() => setEtiquetaPreview([c])}
                              title="Imprimir etiqueta 100x70mm (EAN original)"
                            >
                              <Printer size={15} />
                            </button>
                            <button className="btn btn--ghost text-danger p-4" onClick={() => handleRemoverCaixa(c)} title="Excluir caixa do palete"><Trash2 size={16}/></button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Caixas Pré-Importadas (Só Bipar via TXT) */}
      {activeTab === 'pre_caixas' && apiAtiva && (
        <div className="flex flex-col gap-16">
          <div className="card">
            <div className="flex justify-between items-start flex-wrap gap-12 mb-12">
              <div>
                <h2 className="text-base font-bold flex items-center gap-8 text-cyan">
                  <ScanBarcode size={18} /> Recebimento Guiado de Caixas Pré-Importadas (.TXT)
                </h2>
                <p className="text-xs text-muted mt-4">
                  Como peso, peças, validade, lote e custo já vieram dos arquivos TXT, <strong>basta bipar o código de barras da etiqueta</strong> para efetivar a entrada no estoque!
                </p>
              </div>
              <div className="flex gap-8">
                <button type="button" className="btn btn--ghost btn--sm" onClick={carregarPreCaixas} disabled={loadingPre}>
                  <RefreshCw size={14} className={loadingPre ? 'animate-spin' : ''} /> Atualizar
                </button>
                {(temPermissao(operador, 'recebimento') || temPermissao(operador, 'compras')) && preCaixas.some((c) => c.status === 'PENDENTE') && (
                  <button type="button" className="btn btn--info btn--sm" onClick={handleConfirmarLotePreCaixas}>
                    <CheckCircle2 size={14} /> Confirmar Restantes em Lote ({preCaixas.filter((c) => c.status === 'PENDENTE').length})
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Filtrar Pedido de Compra</label>
                <select className="form-input" value={pcSelecionadoId} onChange={(e) => setPcSelecionadoId(e.target.value)}>
                  <option value="">Todos os Lotes / Recebimentos</option>
                  {pcsDoca.map((pc) => (
                    <option key={pc.id} value={pc.id}>
                      {pc.codigo} — {pc.fornecedor_nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Status</label>
                <select className="form-input" value={filtroStatusPre} onChange={(e) => setFiltroStatusPre(e.target.value)}>
                  <option value="PENDENTE">Pendentes na Doca</option>
                  <option value="BIPADA">Já Bipadas</option>
                  <option value="TODOS">Todas</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Palete LPN (Opcional)</label>
                <select className="form-input" value={paletePreId} onChange={(e) => setPaletePreId(e.target.value)}>
                  <option value="">Sem palete (direto no endereço)</option>
                  {paletesAbertos.map((p) => (
                    <option key={p.id} value={p.id}>{p.codigo} ({p.qtd_caixas || 0} cx)</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Endereço Destino</label>
                <input
                  type="text"
                  className="form-input"
                  value={enderecoPre}
                  onChange={(e) => setEnderecoPre(e.target.value.toUpperCase())}
                  placeholder="REC"
                />
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleBiparPreCaixa(eanPreScanner)
              }}
              className="flex gap-8 items-center mb-16"
            >
              <input
                ref={preScanRef}
                type="text"
                className="form-input form-input--scanner"
                style={{ flex: 1 }}
                placeholder="Bipe ou digite o código de barras da etiqueta pré-importada e aperte Enter..."
                value={eanPreScanner}
                onChange={(e) => setEanPreScanner(e.target.value)}
              />
              <button type="submit" className="btn btn--primary">
                <Check size={16} /> Bipar Caixa
              </button>
            </form>

            <div className="flex gap-16 flex-wrap text-xs p-10 rounded" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <span>Total carregadas: <strong>{preCaixasResumo.total} cx</strong> ({fmtKg2(preCaixasResumo.peso_total_kg)})</span>
              <span className="text-warning">Pendentes (faltam bipar): <strong>{preCaixasResumo.pendentes} cx</strong></span>
              <span className="text-success">Bipadas no estoque: <strong>{preCaixasResumo.bipadas} cx</strong> ({fmtKg2(preCaixasResumo.peso_bipada_kg)})</span>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>EAN / Etiqueta</th>
                    <th>Produto</th>
                    <th>Origem / NF</th>
                    <th style={{ textAlign: 'right' }}>Peso Líq.</th>
                    <th style={{ textAlign: 'right' }}>Peças</th>
                    <th>Lote / Validade</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {preCaixas.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono font-bold text-cyan">{c.ean_caixa}</td>
                      <td>
                        <div className="font-bold text-sm">{c.produto_codigo} — {c.produto_descricao}</div>
                        <div className="text-xs text-muted">{c.fornecedor_nome || ''} {c.pedido_compra_codigo ? `• ${c.pedido_compra_codigo}` : ''}</div>
                      </td>
                      <td className="text-xs text-muted">
                        <div>{c.documento_origem || c.numero_nf || '-'}</div>
                        <div>{c.arquivo_origem || '-'}</div>
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono font-bold">{fmtKg2(c.peso_liquido_kg)}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{c.qtd_pecas ?? '-'}</td>
                      <td className="text-xs font-mono">
                        <div>{c.lote || '-'}</div>
                        <div className="text-muted">{c.validade ? fmtDataBR(c.validade) : '-'}</div>
                      </td>
                      <td>
                        {c.status === 'BIPADA' ? (
                          <span className="badge badge--success">Bipada ✅</span>
                        ) : (
                          <span className="badge badge--warning">Pendente Doca</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {c.status === 'PENDENTE' && (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => handleBiparPreCaixa(c.ean_caixa)}
                          >
                            <Check size={13} /> Bipar Agora
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {preCaixas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center p-24 text-muted">
                        Nenhuma caixa pré-importada encontrada para este filtro. Importe os arquivos `.txt` na tela de Compras!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Histórico */}
      {activeTab === 'historico' && <HistoricoPaletes />}

      {/* Modal EAN Desconhecido */}
      <CadastroEanModal 
        isOpen={modalEanOpen}
        onClose={() => { setModalEanOpen(false); setTimeout(() => codigoRef.current?.focus(), 100); }}
        codigoDesconhecido={eanDesconhecido}
        onRegraSalva={(p) => {
          setProdutoDetectado(p)
          setEanCaixaReal(eanDesconhecido)
          setEanEhUnico(true)
          setModalEanOpen(false)
          setTimeout(() => pesoBrutoRef.current?.focus(), 100)
        }}
      />

      <EtiquetaZebraModal
        isOpen={Boolean(etiquetaPreview)}
        etiquetas={etiquetaPreview || []}
        autoPrint={false}
        onClose={() => setEtiquetaPreview(null)}
        titulo="Etiqueta da Caixa Recebida"
      />

      {/* Modal Concluir Palete */}
      {modalConcluirOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card animate-fade-in" style={{ width: 420, padding: 24, position: 'relative' }}>
            <button className="btn btn--ghost" style={{ position: 'absolute', top: 12, right: 12, padding: 4 }} onClick={() => setModalConcluirOpen(false)}>
              <X size={20} />
            </button>
            
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--success-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <CheckCircle2 size={24} style={{ color: 'var(--success)' }} />
              </div>
              <h3 className="font-bold text-lg mb-8">Concluir Palete</h3>
              <p className="text-muted text-sm" style={{ lineHeight: 1.5 }}>
                Tem certeza que deseja fechar o palete <strong className="text-primary">{paleteAtivo?.codigo}</strong> na Doca?
              </p>
            </div>

            <div style={{ background: 'rgba(16,185,129,0.1)', padding: 12, borderRadius: 8, marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start', border: '1px solid rgba(16,185,129,0.2)' }}>
              <Check size={18} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                <strong>Tudo Certo:</strong> As caixas ficarão disponíveis na Doca e poderão ser movimentadas ou transferidas para os porta-paletes.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, width: '100%' }}>
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setModalConcluirOpen(false)}>
                Cancelar
              </button>
              <button className="btn" style={{ flex: 1, background: 'var(--success)', color: '#fff', fontWeight: 600 }} onClick={handleConcluirPalete}>
                Sim, Fechar Palete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
