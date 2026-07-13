import React, { useState, useEffect, useCallback } from 'react'
import { Check, Trash2, Package, Layers, Plus, X, AlertTriangle, Tag, ArrowLeft, ScanBarcode, History, Download, Search, Filter, ChevronRight, Eye, CheckCircle2, Clock, Box, Unlock } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as movimentacoesQueries from '../queries/movimentacoes.js';
import * as produtosQueries from '../queries/produtos.js';
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx';

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
  const { toastError, toastSuccess } = useAppStore();
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
    const paletesExport = paletesFiltrados.map(p => ({
      Codigo: p.codigo,
      Status: p.status === 'EM_MONTAGEM' ? 'Na Doca' : (p.status === 'FECHADO' && p.endereco_atual === 'DOCA' && p.qtd_disponiveis > 0) ? 'Na Doca (Finalizado)' : 'Armazenado',
      'Endereço': p.endereco_atual,
      'Qtd Caixas': p.qtd_caixas || 0,
      'Peso Total': parseFloat(p.peso_total || 0).toFixed(2),
      'Aberto Em': p.created_at ? format(new Date(p.created_at + 'Z'), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-',
      'Última Bipagem': p.ultima_caixa ? format(new Date(p.ultima_caixa + 'Z'), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-',
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

  // ── DETALHE DO PALETE ──
  if (paleteAberto) {
    const pesoTotal = caixasDetalhe.reduce((s, c) => s + c.peso_kg, 0);
    const qtdDisponiveis = caixasDetalhe.filter(c => c.status === 'DISPONIVEL').length;
    const qtdConsumidas = caixasDetalhe.filter(c => c.status === 'CONSUMIDA').length;

    return (
      <div style={{ maxWidth: 900 }}>
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
                    background: paleteAberto.status === 'EM_MONTAGEM' ? 'var(--warning-muted)' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA') ? 'var(--info-muted)' : 'var(--success-muted)', 
                    color: paleteAberto.status === 'EM_MONTAGEM' ? 'var(--warning)' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA') ? 'var(--info)' : 'var(--success)' 
                  }}>
                    {paleteAberto.status === 'EM_MONTAGEM' ? '🟡 Na Doca' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual === 'DOCA') ? '🏁 Na Doca (Finalizado)' : (paleteAberto.status === 'FECHADO' && paleteAberto.endereco_atual !== 'DOCA') ? '✅ Armazenado' : '✅ Finalizado'} · Endereço: <strong>{paleteAberto.endereco_atual}</strong>
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
              <div className="text-xs text-muted mb-2">Em Estoque</div>
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
                const isDoca = c.status === 'DISPONIVEL' && (c.endereco === 'DOCA' || paleteAberto.endereco_atual === 'DOCA');
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
                    {c.created_at && (
                      <div className="text-xs text-muted mt-2">
                        🕐 {(() => {
                          try {
                            const parsed = new Date(c.created_at.replace(' ', 'T') + (c.created_at.includes('Z') ? '' : 'Z'));
                            return isNaN(parsed.getTime()) ? '-' : format(parsed, 'dd/MM/yy HH:mm', { locale: ptBR });
                          } catch (e) {
                            return '-';
                          }
                        })()}
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
                      {c.status === 'DISPONIVEL' ? (isDoca ? '⏳ Na Doca' : '✅ Estoque') : '📤 Retirada'}
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
    <div style={{ maxWidth: 900 }}>
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
        <div className="flex gap-10 mb-16" style={{ flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', flex: 1, minWidth: 120 }}>
            <div className="text-xs text-muted">Paletes encontrados</div>
            <div className="font-bold text-primary" style={{ fontSize: 18 }}>{paletesFiltrados.length}</div>
          </div>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', flex: 1, minWidth: 120 }}>
            <div className="text-xs text-muted">Total Caixas</div>
            <div className="font-bold text-cyan" style={{ fontSize: 18 }}>{totalCaixasFiltradas}</div>
          </div>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', flex: 1, minWidth: 120 }}>
            <div className="text-xs text-muted">Peso Total</div>
            <div className="font-bold text-success" style={{ fontSize: 18 }}>{totalPesoFiltrado.toFixed(1)} kg</div>
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
                      background: isAtivo ? 'var(--warning-muted)' : (isFinalizado && p.endereco_atual === 'DOCA') ? 'var(--info-muted)' : 'var(--success-muted)', 
                      color: isAtivo ? 'var(--warning)' : (isFinalizado && p.endereco_atual === 'DOCA') ? 'var(--info)' : 'var(--success)' 
                    }}>
                      {isAtivo ? '🟡 NA DOCA' : (isFinalizado && p.endereco_atual === 'DOCA') ? '🏁 NA DOCA (FINALIZADO)' : '✅ ARMAZENADO'}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    📍 {p.endereco_atual} &nbsp;·&nbsp;
                    📦 {p.qtd_caixas || 0} caixas &nbsp;·&nbsp;
                    ⚖️ {parseFloat(p.peso_total || 0).toFixed(2)} kg
                  </div>
                  {p.created_at && (
                    <div className="text-xs text-muted mt-2">
                      🕐 Aberto em {format(new Date(p.created_at + 'Z'), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                      {p.ultima_caixa && ` · Última bipagem: ${format(new Date(p.ultima_caixa + 'Z'), 'dd/MM/yyyy HH:mm', { locale: ptBR })}${p.ultimo_operador ? ` por ${p.ultimo_operador}` : ''}`}
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
  
  // Tabs
  const [activeTab, setActiveTab] = useState('palete') // 'palete' | 'historico'
  
  // Estado do Palete LPN
  const [paletesAbertos, setPaletesAbertos] = useState([])
  const [paleteAtivo, setPaleteAtivo] = useState(null)
  const [caixasDoPalete, setCaixasDoPalete] = useState([])
  const [modalConcluirOpen, setModalConcluirOpen] = useState(false)
  
  // Formulário de Caixa SSCC
  const [eanBipado, setEanBipado] = useState('')
  const [eanCaixaReal, setEanCaixaReal] = useState('')
  const [eanEhUnico, setEanEhUnico] = useState(true)
  const [produtoDetectado, setProdutoDetectado] = useState(null)
  const [boxData, setBoxData] = useState({ peso_kg: '', validade: '' })
  
  // Modal de EAN
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  // Carregar dados iniciais
  useEffect(() => {
    carregarPaletesAbertos()
  }, [])

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
    if (!window.confirm(`Tem certeza que deseja apagar a caixa de ${c.peso_kg}kg do palete?`)) return;
    try {
      const res = await movimentacoesQueries.removerCaixaSerializada(c.id, operador.id, operador.nome);
      if (res.success) {
        toastSuccess('Sucesso', 'Caixa apagada.');
        selecionarPalete(paleteAtivo);
        carregarPaletesAbertos();
      } else {
        toastError('Erro', res.error);
      }
    } catch (e) {
      toastError('Erro fatal', e.message);
    }
  };

  const handleConcluirPalete = async () => {
    if (!paleteAtivo) return;
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

  // --- Fluxo de Bipagem da Caixa (SSCC) ---
  const { inputRef: codigoRef, handleKeyDown: handleCodigoKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      if (!paleteAtivo) return toastWarning('Atenção', 'Abra ou selecione um palete primeiro.')
      setEanBipado(val)
      setProdutoDetectado(null)
      
      try {
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
            // O EAN completo é único por caixa física — apenas o produto é identificado por sufixo
            setEanCaixaReal(val)
            toastWarning('EAN Genérico', `${produto.descricao} — EAN identificado por sufixo. Informe peso e validade.`)
          }
          setTimeout(() => document.getElementById('box-peso')?.focus(), 100)
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
    e.preventDefault()
    if (!paleteAtivo) return toastError('Atenção', 'Selecione um palete.')
    if (!produtoDetectado) return toastError('Atenção', 'Produto não detectado.')
    if (!boxData.peso_kg || !boxData.validade) return toastWarning('Atenção', 'Informe peso e validade.')

    try {
      const res = await movimentacoesQueries.receberCaixaSerializada({
        ean_caixa: eanCaixaReal,
        produto_id: produtoDetectado.id,
        palete_id: paleteAtivo.id,
        peso_kg: parseFloat(boxData.peso_kg),
        validade: boxData.validade,
        operador_id: operador.id,
        operador_nome: operador.nome
      })

      if (res.success) {
        toastSuccess('Caixa Adicionada', `${produtoDetectado.descricao} adicionado ao ${paleteAtivo.codigo}.`)
        setEanBipado('')
        setEanCaixaReal('')
        setEanEhUnico(true)
        setProdutoDetectado(null)
        setBoxData({ peso_kg: '', validade: boxData.validade })
        selecionarPalete(paleteAtivo)
        carregarPaletesAbertos()
        codigoRef.current?.focus()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro fatal', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title">Recebimento (Inbound)</h1>
          <p className="page-header__subtitle">Montagem de Paletes LPN e Rastreabilidade SSCC</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
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
        <button
          className={`btn ${activeTab === 'historico' ? 'btn--primary' : 'btn--ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          onClick={() => setActiveTab('historico')}
        >
          <History size={16} /> Histórico de Paletes
        </button>
      </div>

      {/* TAB: Recebimento */}
      {activeTab === 'palete' && (
        <div className="grid-responsive">
          
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
                    <div style={{ background: 'var(--bg-2)', padding: 16, borderRadius: 10, border: `1px solid ${eanEhUnico ? 'var(--primary)' : 'var(--warning)'}`, marginBottom: 16 }}>
                      <div className="text-xs font-bold mb-4 uppercase" style={{ color: eanEhUnico ? 'var(--primary)' : 'var(--warning)' }}>
                        {eanEhUnico ? '✅ Caixa SSCC Única' : '⚠️ EAN Genérico — Produto identificado por sufixo do EAN'}
                      </div>
                      <div className="font-bold" style={{ fontSize: 16 }}>{produtoDetectado.descricao}</div>
                      <div className="text-sm text-muted mb-4">Código: {produtoDetectado.codigo || '-'}</div>
                      {!eanEhUnico && (
                        <div style={{ fontSize: 11, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, padding: '6px 10px', color: 'var(--warning)', marginBottom: 8 }}>
                          🏷️ EAN bipado identificado por sufixo — caixa salva com EAN original: <strong style={{ fontFamily: 'monospace' }}>{eanCaixaReal}</strong>
                        </div>
                      )}

                      <div className="form-grid form-grid--2">
                        <div className="form-group">
                          <label className="form-label">Peso Real (KG) *</label>
                          <input
                            id="box-peso"
                            type="number"
                            step="0.001"
                            className="form-input form-input--number"
                            value={boxData.peso_kg}
                            onChange={e => setBoxData({ ...boxData, peso_kg: e.target.value })}
                            required
                            autoComplete="off"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Data de Validade *</label>
                          <input
                            type="date"
                            className="form-input"
                            value={boxData.validade}
                            onChange={e => setBoxData({ ...boxData, validade: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                      
                      <div className="mt-16 text-right">
                        <button type="submit" className="btn btn--primary btn--lg w-full">
                          <Check size={18} /> Salvar Caixa
                        </button>
                      </div>
                    </div>
                  )}
                </form>

                {/* Lista de caixas do palete ativo */}
                <div className="mt-16">
                  <h4 className="text-xs text-muted font-bold mb-8 uppercase tracking-wider">Caixas no Palete ({caixasDoPalete.length})</h4>
                  <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    {caixasDoPalete.length === 0 ? (
                      <div className="text-center text-muted p-24 text-sm">Nenhuma caixa bipada ainda.</div>
                    ) : (
                      caixasDoPalete.map((c, i) => (
                        <div key={c.id} style={{ padding: '10px 12px', borderBottom: i < caixasDoPalete.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div className="font-bold text-sm" style={{ lineHeight: 1.2 }}>{c.produto_descricao}</div>
                            <div className="text-xs text-muted font-mono mt-4">{c.ean_caixa}</div>
                          </div>
                          <div className="text-right flex items-center gap-12">
                            <div>
                              <div className="font-bold text-cyan text-sm">{c.peso_kg} kg</div>
                              <div className="text-xs text-muted">Venc: {c.validade ? format(new Date(c.validade + 'T00:00:00'), 'dd/MM/yy') : '-'}</div>
                            </div>
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

      {/* TAB: Histórico */}
      {activeTab === 'historico' && <HistoricoPaletes />}

      {/* Modal EAN Desconhecido */}
      <CadastroEanModal 
        isOpen={modalEanOpen}
        onClose={() => { setModalEanOpen(false); setTimeout(() => codigoRef.current?.focus(), 100); }}
        codigoDesconhecido={eanDesconhecido}
        onRegraSalva={(p) => {
          setProdutoDetectado(p)
          setEanEhUnico(true)
          setModalEanOpen(false)
          setTimeout(() => document.getElementById('box-peso')?.focus(), 100)
        }}
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
