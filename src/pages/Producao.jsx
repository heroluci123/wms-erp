import React, { useState, useEffect } from 'react'
import { Layers, Plus, Factory, Check, Info, ArrowRight, Package } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as producaoQueries from '../queries/producao.js'
import * as produtosQueries from '../queries/produtos.js'
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
        const resultado = await produtosQueries.buscarPorCodigoComInfo(codigo)
        if (!resultado) {
          return toastError('Erro', 'EAN não reconhecido no sistema.')
        }

        const { produto, eanUnico } = resultado
        
        // Em um EAN único de caixa SSCC (gerado pela balança e cadastrado na tabela de produtos ou extraido), o peso não vem no ean.
        // A Tricarnes usa peso no código EAN em alguns casos. Mas vamos assumir que o operador informa o peso da caixa ou o EAN de pesagem já contém.
        // Para simplificar agora, e usando a lógica anterior: a caixa retornada tem que ter peso.
        // Se for codigo EAN 13 normal com peso na balança, precisamos extrair.
        
        // Pede o peso se não soubermos (mock simples para peso):
        const pesoStr = window.prompt(`Qual o peso gerado para ${produto.descricao} (EAN: ${codigo})?`)
        if (!pesoStr) return
        const peso = parseFloat(pesoStr.replace(',', '.'))
        if (isNaN(peso) || peso <= 0) return toastError('Aviso', 'Peso inválido.')

        // Vamos inserir a caixa
        const res = await producaoQueries.adicionarRetorno(
          opSelecionada.id,
          { ean_caixa: codigo, produto_id: produto.id, peso_kg: peso, validade: null },
          operador.id,
          operador.nome
        )

        if (res.success) {
          toastSuccess('Retorno Registrado', `Caixa de ${peso}kg de ${produto.descricao} adicionada à Produção.`)
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-16">
          {ops.length === 0 && <div className="text-muted">Nenhuma Ordem de Produção aberta no momento. Vá em Movimentação para enviar materiais para produção.</div>}
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
                      <div key={idx}>• {i.produto_descricao} ({i.peso_kg}kg)</div>
                    ))}
                  </div>
                </div>
                <div className="p-16 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-muted text-sm uppercase font-bold mb-8">Saídas (Produto Acabado)</div>
                  <div className="text-2xl font-bold font-mono text-success mb-8">{detalhes.peso_retornos.toFixed(2)} kg</div>
                  <div className="text-xs text-muted">
                    Quebra atual: {((1 - (detalhes.peso_retornos / (detalhes.peso_insumos || 1))) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="mb-16 font-bold flex items-center gap-8"><Package size={18}/> Bipar Novo Produto Acabado</h3>
              <div className="form-group mb-16" style={{ maxWidth: 400 }}>
                <input
                  ref={inputRef}
                  className="form-input form-input--scanner"
                  placeholder="Bipar EAN da caixa gerada..."
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
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
          </div>
        )
      )}
    </div>
  )
}
