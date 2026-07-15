import React, { useState, useEffect } from 'react'
import { Map, RefreshCw, BarChart2, CheckCircle2, AlertCircle, Database, Download } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as locaisQueries from '../queries/locais.js';
import * as estoqueQueries from '../queries/estoque.js';

export function MapaCapacidade() {
  const { toastError } = useAppStore()
  const [locais, setLocais] = useState([])
  const [estoque, setEstoque] = useState([])
  const [loading, setLoading] = useState(true)
  const [incluirInsumos, setIncluirInsumos] = useState(false)
  const [filtroArmazenamento, setFiltroArmazenamento] = useState('todos')

  const carregar = async () => {
    setLoading(true)
    try {
      const locData = await locaisQueries.listar()
      const estData = await estoqueQueries.listarGeral()
      setLocais(locData)
      setEstoque(estData)
    } catch (err) {
      toastError('Erro', 'Falha ao carregar mapa de capacidade.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  // Aplicar filtros de visão
  const locaisFiltrados = locais.filter(l => 
    (incluirInsumos ? l.is_insumo === 1 : l.is_insumo !== 1) &&
    (filtroArmazenamento === 'todos' || l.tipo_armazenamento === filtroArmazenamento)
  )
  const estoqueFiltrado = estoque.filter(e => 
    (incluirInsumos ? e.tipo_produto === 'Insumos' : e.tipo_produto !== 'Insumos') &&
    (filtroArmazenamento === 'todos' || e.tipo_armazenamento === filtroArmazenamento)
  )

  // Agrupar estoque por endereco
  const estoquePorEndereco = estoqueFiltrado.reduce((acc, item) => {
    if (!acc[item.endereco]) acc[item.endereco] = 0
    acc[item.endereco] += item.qtd_caixas
    return acc
  }, {})

  const getColor = (pct) => {
    if (pct < 50) return 'var(--success)'
    if (pct < 80) return 'var(--warning)'
    if (pct < 95) return 'var(--orange, #ff9800)'
    return 'var(--danger)'
  }

  // Cálculos Gerais do Estoque
  const locaisComLimite = locaisFiltrados.filter(l => l.capacidade_max_caixas > 0)
  const capacidadeGeral = locaisComLimite.reduce((acc, loc) => acc + loc.capacidade_max_caixas, 0)
  
  const caixasEmLocaisComLimite = locaisComLimite.reduce((acc, loc) => {
    return acc + (estoquePorEndereco[loc.endereco] || 0)
  }, 0)

  const pctUtilizadaGeral = capacidadeGeral > 0 ? (caixasEmLocaisComLimite / capacidadeGeral) * 100 : 0

  const posicoesVazias = locaisFiltrados.filter(loc => (estoquePorEndereco[loc.endereco] || 0) === 0).length
  const posicoesOcupadas = locaisFiltrados.filter(loc => (estoquePorEndereco[loc.endereco] || 0) > 0).length

  const handleExportarCSV = () => {
    let csvContent = "RUA;STATUS\n";
    
    locaisFiltrados.forEach(loc => {
      const totalCx = estoquePorEndereco[loc.endereco] || 0;
      const status = totalCx === 0 ? "VAZIO" : `${totalCx} cx`;
      csvContent += `${loc.endereco};${status}\n`;
    });

    const blob = new Blob(["\ufeff", csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `mapa_capacidade_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Map size={28} /> Mapa de Capacidade
          </h1>
          <p className="page-header__subtitle">Visualização de ocupação dos endereços físicos (% em caixas)</p>
        </div>
        <div className="flex gap-12 items-center">
          <select 
            className="form-input bg-bg-card" 
            style={{ width: 180, fontWeight: 600, border: '1px solid var(--border)' }}
            value={incluirInsumos ? 'insumos' : 'operacao'} 
            onChange={e => setIncluirInsumos(e.target.value === 'insumos')}
          >
            <option value="operacao">Visão: Operação (MP/PA)</option>
            <option value="insumos">Visão: Insumos</option>
          </select>
          <select 
            className="form-input bg-bg-card" 
            style={{ width: 180, fontWeight: 600, border: '1px solid var(--border)' }}
            value={filtroArmazenamento} 
            onChange={e => setFiltroArmazenamento(e.target.value)}
          >
            <option value="todos">Tipo de Armazenagem</option>
            <option value="SECO">📦 Seco</option>
            <option value="FRIO">❄️ Frio</option>
            <option value="CONGELADO">🧊 Congelado</option>
          </select>
          <button className="btn btn--outline" onClick={handleExportarCSV} title="Exportar para Excel/CSV">
            <Download size={16} /> Exportar
          </button>
          <button className="btn btn--secondary" onClick={carregar}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {!loading && locaisFiltrados.length > 0 && (
        <div className="kpi-grid mb-24">
          <div className="kpi-card" style={{ borderColor: 'var(--cyan)' }}>
            <span className="kpi-card__label flex items-center gap-8 text-cyan"><Database size={14}/> Capacidade Geral</span>
            <span className="kpi-card__value">{capacidadeGeral.toLocaleString('pt-BR')} CX</span>
            <span className="kpi-card__sub">Soma dos limites cadastrados</span>
          </div>

          <div className="kpi-card" style={{ borderColor: getColor(pctUtilizadaGeral) }}>
            <span className="kpi-card__label flex items-center gap-8" style={{ color: getColor(pctUtilizadaGeral) }}>
              <BarChart2 size={14}/> Utilização Geral
            </span>
            <span className="kpi-card__value">{pctUtilizadaGeral.toFixed(1)}%</span>
            <span className="kpi-card__sub">{caixasEmLocaisComLimite.toLocaleString('pt-BR')} CX armazenadas</span>
          </div>

          <div className="kpi-card" style={{ borderColor: 'var(--success)' }}>
            <span className="kpi-card__label flex items-center gap-8 text-success"><CheckCircle2 size={14}/> Posições Vazias</span>
            <span className="kpi-card__value">{posicoesVazias}</span>
            <span className="kpi-card__sub">De {locaisFiltrados.length} posições cadastradas</span>
          </div>
          
          <div className="kpi-card" style={{ borderColor: 'var(--warning)' }}>
            <span className="kpi-card__label flex items-center gap-8 text-warning"><AlertCircle size={14}/> Posições Ocupadas</span>
            <span className="kpi-card__value">{posicoesOcupadas}</span>
            <span className="kpi-card__sub">Com saldo físico &gt; 0</span>
          </div>
        </div>
      )}

      <div className="flex gap-16 mb-24" style={{ padding: '12px 16px', background: 'var(--bg-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-8 text-sm"><div style={{width: 12, height: 12, borderRadius: '50%', background: 'var(--text-disabled)'}}></div> Sem Limite / Vazio</div>
        <div className="flex items-center gap-8 text-sm"><div style={{width: 12, height: 12, borderRadius: '50%', background: 'var(--success)'}}></div> Livre (0-50%)</div>
        <div className="flex items-center gap-8 text-sm"><div style={{width: 12, height: 12, borderRadius: '50%', background: 'var(--warning)'}}></div> Médio (50-80%)</div>
        <div className="flex items-center gap-8 text-sm"><div style={{width: 12, height: 12, borderRadius: '50%', background: 'var(--orange, #ff9800)'}}></div> Alto (80-95%)</div>
        <div className="flex items-center gap-8 text-sm"><div style={{width: 12, height: 12, borderRadius: '50%', background: 'var(--danger)'}}></div> Crítico (95-100%+)</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {locaisFiltrados.length === 0 && !loading && (
          <div className="text-muted text-center py-24" style={{ gridColumn: '1 / -1' }}>Nenhum local cadastrado para esta visão.</div>
        )}
        
        {locaisFiltrados.map(loc => {
          const totalCx = estoquePorEndereco[loc.endereco] || 0
          const hasLimit = loc.capacidade_max_caixas > 0
          
          let pct = 0
          if (hasLimit) {
            pct = (totalCx / loc.capacidade_max_caixas) * 100
          }
          const pctSafe = Math.min(pct, 100)

          const color = hasLimit ? getColor(pct) : 'var(--text-disabled)'

          return (
            <div key={loc.id} className="card p-16 flex-col gap-12" style={{ borderTop: `4px solid ${color}` }}>
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-cyan">{loc.endereco}</span>
                {hasLimit ? (
                  <span style={{ color, fontWeight: 'bold' }}>{pct.toFixed(1)}%</span>
                ) : (
                  <span className="text-xs text-muted uppercase">S/ Limite</span>
                )}
              </div>
              
              <div className="text-center my-8">
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                  {totalCx.toFixed(1)} <span className="text-sm text-muted">CX</span>
                </div>
                {hasLimit && (
                  <div className="text-xs text-muted mt-4">
                    de {loc.capacidade_max_caixas} CX
                  </div>
                )}
              </div>

              {hasLimit && (
                <div style={{ height: 6, background: 'var(--bg-1)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pctSafe}%`, background: color, transition: 'width 0.3s' }}></div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
