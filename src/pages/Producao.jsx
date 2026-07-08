import React, { useState, useEffect } from 'react'
import { Layers, Plus, Factory, Check, Info, ArrowRight, Package } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as producaoQueries from '../queries/producao.js'
import * as produtosQueries from '../queries/produtos.js'
import * as movimentacoesQueries from '../queries/movimentacoes.js'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'

export function Producao() {
  const { toastSuccess, toastError, toastWarning, operador } = useAppStore()
  const [ops, setOps] = useState([])
  const [opSelecionada, setOpSelecionada] = useState(null)
  const [detalhes, setDetalhes] = useState(null)

  const carregarOPs = async () => {
    try {
      const d = await producaoQueries.listarOPs('ABERTA')
      setOps(d)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar OPs')
    }
  }

  const carregarDetalhes = async (id) => {
    try {
      const d = await producaoQueries.detalhesOP(id)
      setDetalhes(d)
    } catch (e) {
      toastError('Erro', 'Falha ao carregar detalhes')
    }
  }

  useEffect(() => { carregarOPs() }, [])

  useEffect(() => {
    if (opSelecionada) {
      carregarDetalhes(opSelecionada.id)
    } else {
      setDetalhes(null)
    }
  }, [opSelecionada])

  const { inputRef, handleKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      const codigo = val.toUpperCase().trim()
      if (!opSelecionada) return toastWarning('Aviso', 'Selecione uma Ordem de Produção primeiro.')

      try {
        // 1. Tentar identificar se é uma caixa existente (Insumo)
        const resCod = await movimentacoesQueries.identificarCodigoMovimentacao(codigo)
        if (resCod && resCod.tipo === 'CAIXA') {
          const caixa = resCod.dados
          if (caixa.status !== 'DISPONIVEL') {
            return toastError('Inválido', `Esta caixa não está disponível (Status: ${caixa.status}).`)
          }
          
          if (!window.confirm(`Alocar caixa de ${caixa.peso_kg}kg (${caixa.produto_descricao}) como INSUMO nesta OP?`)) return

          const resAlo = await producaoQueries.alocarInsumos(opSelecionada.id, [caixa], operador.id, operador.nome)
          if (resAlo.success) {
            toastSuccess('Insumo Adicionado', `Caixa alocada com sucesso.`)
            carregarDetalhes(opSelecionada.id)
          } else {
            toastError('Erro ao Alocar', resAlo.error)
          }
          return
        }

        // 2. Se não é caixa existente, então é um NOVO produto acabado (Retorno)
        const resultado = await produtosQueries.buscarPorCodigoComInfo(codigo)
        if (!resultado) {
          return toastError('Erro', 'Código EAN não corresponde a nenhum produto cadastrado nem caixa existente.')
        }

        const { produto } = resultado
        
        const pesoStr = window.prompt(`[RETORNO DE PRODUÇÃO]\n\nQual o peso da nova caixa para ${produto.descricao} (EAN: ${codigo})?`)
        if (!pesoStr) return
        const peso = parseFloat(pesoStr.replace(',', '.'))
        if (isNaN(peso) || peso <= 0) return toastError('Aviso', 'Peso inválido.')

        const res = await producaoQueries.adicionarRetorno(
          opSelecionada.id,
          { ean_caixa: codigo, produto_id: produto.id, peso_kg: peso, validade: null },
          operador.id,
          operador.nome
        )

        if (res.success) {
          toastSuccess('Retorno Registrado', `Nova caixa de ${peso}kg adicionada à Produção.`)
          carregarDetalhes(opSelecionada.id)
        } else {
          toastError('Erro', res.error)
        }

      } catch (err) {
        toastError('Erro fatal', err.message)
      }
    }
  })

  const finalizarOP = async () => {
    if (!window.confirm('Deseja realmente finalizar esta Ordem de Produção? Os insumos serão baixados e não será possível bipar novos retornos.')) return
    try {
      const res = await producaoQueries.finalizarOP(opSelecionada.id)
      if (res.success) {
        toastSuccess('Sucesso', 'Ordem de Produção Finalizada.')
        setOpSelecionada(null)
        carregarOPs()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleNovaOP = async () => {
    const nome = window.prompt("Nome / Descrição da Ordem de Produção (Ex: Produção de Picanha):")
    if (!nome) return
    try {
      const res = await producaoQueries.criarOP(nome, operador.id, operador.nome)
      if (res.success) {
        toastSuccess('Sucesso', 'Ordem de Produção criada.')
        carregarOPs()
        setOpSelecionada(res.op)
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Retorno de Produção</h1>
          <p className="page-header__subtitle">Acompanhe OPs em aberto e bipagem de produtos acabados</p>
        </div>
        {opSelecionada && (
          <button className="btn btn--ghost" onClick={() => setOpSelecionada(null)}>Voltar para lista</button>
        )}
      </div>

      {!opSelecionada ? (
        <div>
          <div className="mb-24">
            <button className="btn btn--primary btn--lg w-full max-w-sm" onClick={handleNovaOP}>
              <Plus size={18}/> Abrir Nova Ordem de Produção
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-16">
            {ops.length === 0 && <div className="text-muted col-span-3">Nenhuma Ordem de Produção em aberto.</div>}
            {ops.map(op => (
              <div key={op.id} className="card cursor-pointer hover:border-primary" onClick={() => setOpSelecionada(op)}>
                <div className="flex items-center justify-between mb-8">
                  <span className="font-bold text-lg text-primary">{op.codigo}</span>
                  <Factory size={20} className="text-muted"/>
                </div>
                <div className="mb-12 font-bold">{op.nome}</div>
                <div className="text-sm text-muted mb-4">Insumos Alocados: <strong className="text-white">{(op.peso_insumos || 0).toFixed(2)} kg</strong></div>
                <div className="text-sm text-muted">Retorno até o momento: <strong className="text-white">{(op.peso_retornos || 0).toFixed(2)} kg</strong></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        detalhes && (
          <div className="flex-col gap-24">
            <div className="card" style={{ background: 'var(--bg-2)' }}>
              <div className="flex items-center justify-between mb-16">
                <div>
                  <h2 className="font-bold text-xl text-primary">{detalhes.codigo} - {detalhes.nome}</h2>
                  <div className="text-muted text-sm mt-4">Criado em: {new Date(detalhes.created_at).toLocaleString()}</div>
                </div>
                <button className="btn btn--primary" onClick={finalizarOP}>
                  Finalizar OP <Check size={18}/>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-16 mb-16">
                <div className="p-16 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-muted text-sm uppercase font-bold mb-8">Entradas (Insumos)</div>
                  <div className="text-2xl font-bold font-mono text-cyan mb-8">{detalhes.peso_insumos.toFixed(2)} kg</div>
                  <div className="text-xs text-muted">
                    {detalhes.insumos.map((i, idx) => (
                      <div key={idx}>• {i.produto_descricao} ({i.peso_kg}kg) [EAN: {i.ean_caixa}]</div>
                    ))}
                    {detalhes.insumos.length === 0 && 'Nenhum insumo'}
                  </div>
                </div>

                <div className="p-16 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-muted text-sm uppercase font-bold mb-8">Saídas (Retornos)</div>
                  <div className="text-2xl font-bold font-mono text-success mb-8">{detalhes.peso_retornos.toFixed(2)} kg</div>
                  <div className="text-xs text-muted">
                    {detalhes.retornos.map((r, idx) => (
                      <div key={idx}>• {r.produto_descricao} ({r.peso_kg}kg) [EAN: {r.ean_caixa}]</div>
                    ))}
                    {detalhes.retornos.length === 0 && 'Nenhum retorno'}
                  </div>
                </div>
              </div>

              <div className="bg-bg-0 p-16 rounded border border-border">
                <h3 className="font-bold mb-8 flex items-center gap-8 text-warning"><Plus size={18}/> Bipar Itens para OP</h3>
                <p className="text-sm text-muted mb-16">
                  Bipe o EAN da caixa: 
                  <br/>- <strong>Insumo:</strong> Se a caixa existir no estoque, será consumida como insumo.
                  <br/>- <strong>Retorno:</strong> Se a caixa for nova, será tratada como produto acabado (retorno).
                </p>
                <input
                  ref={inputRef}
                  className="form-input form-input--scanner"
                  placeholder="Bipe a caixa..."
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
              </div>
            </div>

            {detalhes.retornos.length > 0 && (
              <div className="table-container mt-24">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>EAN Caixa</th>
                      <th style={{ textAlign: 'right' }}>Peso (kg)</th>
                      <th style={{ textAlign: 'right' }}>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhes.retornos.map(r => (
                      <tr key={r.id}>
                        <td>{r.produto_codigo} - {r.produto_descricao}</td>
                        <td className="td-mono text-muted">{r.ean_caixa}</td>
                        <td className="font-bold text-success" style={{ textAlign: 'right' }}>{r.peso_kg.toFixed(2)}</td>
                        <td className="text-muted text-sm" style={{ textAlign: 'right' }}>{new Date(r.created_at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
