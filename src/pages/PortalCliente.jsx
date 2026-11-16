import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Box,
  Download,
  Factory,
  FileSpreadsheet,
  Lock,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import * as estoqueQueries from '../queries/estoque'
import { useAppStore } from '../store/appStore'
import { temAlgumaPermissao, temPermissao } from '../utils/permissoes'
import { RelatorioDossieProducao } from '../components/shared/RelatorioDossieProducao'
import { RelatorioGeralWms } from '../components/shared/RelatorioGeralWms'

const fmtKg = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg'

const fmtDate = (d) => {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  const parts = s.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s
}

export function PortalCliente() {
  const { operador } = useAppStore()

  const podeVerEstoque = temAlgumaPermissao(operador, [
    'consulta_estoque',
    'estoque_enderecos',
    'relatorios_estoque',
  ])
  const podeRelProducao = temPermissao(operador, 'relatorios_producao')
  const podeRelEstoque = temPermissao(operador, 'relatorios_estoque')

  const abasDisponiveis = useMemo(() => {
    const abas = []
    if (podeVerEstoque) abas.push({ id: 'estoque', label: 'Saldo Consolidado de Estoque', icon: Package })
    if (podeRelProducao) abas.push({ id: 'producao', label: 'Relatórios de Produção (Finalizada)', icon: Factory })
    if (podeRelEstoque) abas.push({ id: 'wms', label: 'Relatório Geral & Exportação', icon: FileSpreadsheet })
    return abas
  }, [podeVerEstoque, podeRelProducao, podeRelEstoque])

  const [abaAtiva, setAbaAtiva] = useState(() => abasDisponiveis[0]?.id || 'estoque')
  const [estoqueRaw, setEstoqueRaw] = useState([])
  const [loadingEstoque, setLoadingEstoque] = useState(false)
  const [busca, setBusca] = useState('')
  const [grupoFiltro, setGrupoFiltro] = useState('TODOS')

  useEffect(() => {
    if (abasDisponiveis.length > 0 && !abasDisponiveis.some((a) => a.id === abaAtiva)) {
      setAbaAtiva(abasDisponiveis[0].id)
    }
  }, [abasDisponiveis, abaAtiva])

  const carregarEstoque = async () => {
    if (!podeVerEstoque) return
    setLoadingEstoque(true)
    try {
      const rows = await estoqueQueries.listarGeral()
      setEstoqueRaw(rows || [])
    } catch (err) {
      console.error('Erro ao carregar saldo consolidado:', err)
    } finally {
      setLoadingEstoque(false)
    }
  }

  useEffect(() => {
    if (abaAtiva === 'estoque') {
      carregarEstoque()
    }
  }, [abaAtiva, podeVerEstoque])

  const grupos = useMemo(() => {
    const set = new Set()
    estoqueRaw.forEach((r) => {
      if (r.grupo) set.add(r.grupo)
    })
    return ['TODOS', ...Array.from(set).sort()]
  }, [estoqueRaw])

  // Consolidação por produto (sem expor filas operacionais, operadores ou leituras ao vivo)
  const produtosConsolidados = useMemo(() => {
    const mapa = new Map()
    estoqueRaw.forEach((item) => {
      const pid = String(item.produto_id)
      if (!mapa.has(pid)) {
        mapa.set(pid, {
          produto_id: item.produto_id,
          codigo: item.codigo || '-',
          descricao: item.descricao || 'Produto',
          grupo: item.grupo || 'Sem Grupo',
          tipo_produto: item.tipo_produto || '-',
          qtd_caixas: 0,
          qtd_kg: 0,
          validade_proxima: item.validade || null,
          lotes: new Set(),
        })
      }
      const p = mapa.get(pid)
      p.qtd_caixas += Number(item.qtd_caixas || 0)
      p.qtd_kg += Number(item.qtd_kg || 0)
      if (item.lote) p.lotes.add(item.lote)
      if (item.validade && (!p.validade_proxima || item.validade < p.validade_proxima)) {
        p.validade_proxima = item.validade
      }
    })

    const termo = busca.trim().toLowerCase()
    return Array.from(mapa.values())
      .map((p) => ({ ...p, lotesLista: Array.from(p.lotes).sort() }))
      .filter((p) => {
        if (grupoFiltro !== 'TODOS' && p.grupo !== grupoFiltro) return false
        if (!termo) return true
        return (
          String(p.codigo).toLowerCase().includes(termo) ||
          String(p.descricao).toLowerCase().includes(termo) ||
          String(p.grupo).toLowerCase().includes(termo)
        )
      })
      .sort((a, b) => b.qtd_kg - a.qtd_kg)
  }, [estoqueRaw, busca, grupoFiltro])

  const totais = useMemo(() => {
    return produtosConsolidados.reduce(
      (acc, p) => {
        acc.produtos += 1
        acc.caixas += p.qtd_caixas
        acc.kg += p.qtd_kg
        return acc
      },
      { produtos: 0, caixas: 0, kg: 0 }
    )
  }, [produtosConsolidados])

  const exportarCsvCliente = () => {
    const header = 'Codigo;Produto;Grupo;Lotes;Caixas;Peso Total (kg);Proxima Validade'
    const lines = produtosConsolidados.map((p) =>
      [
        p.codigo,
        `"${String(p.descricao).replace(/"/g, '""')}"`,
        `"${String(p.grupo).replace(/"/g, '""')}"`,
        `"${p.lotesLista.join(', ')}"`,
        p.qtd_caixas,
        Number(p.qtd_kg || 0).toFixed(2).replace('.', ','),
        fmtDate(p.validade_proxima),
      ].join(';')
    )
    const csv = '\uFEFF' + [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `saldo-consolidado-cliente-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Cabeçalho do Portal Exclusivo */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(15, 23, 42, 0.85))',
          border: '1px solid rgba(56, 189, 248, 0.25)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <ShieldCheck size={22} color="#38bdf8" />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
              Portal do Cliente — Consultas & Relatórios
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            Bem-vindo, <strong>{operador?.nome}</strong> • Ambiente exclusivo de consulta consolidada de estoque e produção finalizada.
          </p>
        </div>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(14, 165, 233, 0.16)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: '#bae6fd',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <Lock size={14} />
          Acesso Somente Leitura (Cliente)
        </div>
      </div>

      {/* Navegação por Abas */}
      {abasDisponiveis.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {abasDisponiveis.map((aba) => {
            const Icon = aba.icon
            const ativa = abaAtiva === aba.id
            return (
              <button
                key={aba.id}
                type="button"
                onClick={() => setAbaAtiva(aba.id)}
                className={`btn ${ativa ? 'btn--primary' : 'btn--ghost'}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  fontWeight: 600,
                }}
              >
                <Icon size={16} />
                {aba.label}
              </button>
            )
          })}
        </div>
      )}

      {abasDisponiveis.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <Lock size={34} style={{ marginBottom: 10, opacity: 0.6 }} />
          <h3 style={{ margin: '0 0 6px' }}>Nenhuma consulta habilitada</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
            Solicite ao administrador a liberação dos relatórios permitidos para sua conta.
          </p>
        </div>
      )}

      {/* Aba 1: Saldo Consolidado de Estoque */}
      {abaAtiva === 'estoque' && podeVerEstoque && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Produtos com Saldo
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: '#38bdf8' }}>
                {totais.produtos}
              </div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Total de Caixas em Câmara
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: '#22c55e' }}>
                {totais.caixas.toLocaleString('pt-BR')} cx
              </div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Peso Total Disponível
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: '#f8fafc' }}>
                {fmtKg(totais.kg)}
              </div>
            </div>
          </div>

          <div className="card">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
                <div style={{ position: 'relative', minWidth: 240, flex: 1, maxWidth: 380 }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                    }}
                  />
                  <input
                    className="form-input"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por código ou produto..."
                    style={{ paddingLeft: 36, width: '100%' }}
                  />
                </div>
                <select
                  className="form-input"
                  value={grupoFiltro}
                  onChange={(e) => setGrupoFiltro(e.target.value)}
                  style={{ minWidth: 180, width: 'auto' }}
                >
                  {grupos.map((g) => (
                    <option key={g} value={g}>
                      {g === 'TODOS' ? 'Todas as Categorias' : g}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={carregarEstoque}
                  disabled={loadingEstoque}
                >
                  <RefreshCw size={15} />
                  Atualizar
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={exportarCsvCliente}
                  disabled={produtosConsolidados.length === 0}
                >
                  <Download size={15} />
                  Exportar CSV
                </button>
              </div>
            </div>

            {loadingEstoque ? (
              <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                Carregando saldos consolidados...
              </div>
            ) : produtosConsolidados.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                <Box size={30} style={{ opacity: 0.4, marginBottom: 8 }} />
                <div>Nenhum saldo encontrado para os filtros aplicados.</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Produto / Corte</th>
                      <th>Categoria</th>
                      <th>Lotes Disponíveis</th>
                      <th style={{ textAlign: 'right' }}>Caixas</th>
                      <th style={{ textAlign: 'right' }}>Saldo (kg)</th>
                      <th>Próx. Validade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtosConsolidados.map((p) => (
                      <tr key={p.produto_id}>
                        <td className="font-mono">{p.codigo}</td>
                        <td style={{ fontWeight: 600 }}>{p.descricao}</td>
                        <td>
                          <span className="badge badge--info">{p.grupo}</span>
                        </td>
                        <td className="font-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {p.lotesLista.length > 0 ? p.lotesLista.slice(0, 4).join(', ') : '-'}
                          {p.lotesLista.length > 4 ? ` (+${p.lotesLista.length - 4})` : ''}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {p.qtd_caixas.toLocaleString('pt-BR')} cx
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>
                          {fmtKg(p.qtd_kg)}
                        </td>
                        <td className="font-mono">{fmtDate(p.validade_proxima)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aba 2: Relatórios Consolidados de Produção Finalizada */}
      {abaAtiva === 'producao' && podeRelProducao && (
        <RelatorioDossieProducao
          titulo="Relatório Consolidado de Produção Finalizada & Rendimento"
          somenteClienteFinalizado={true}
        />
      )}

      {/* Aba 3: Relatório Geral de Estoque & Exportação */}
      {abaAtiva === 'wms' && podeRelEstoque && (
        <RelatorioGeralWms somenteCliente={true} />
      )}
    </div>
  )
}
export default PortalCliente
