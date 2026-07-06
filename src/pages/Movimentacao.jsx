import React, { useState, useEffect } from 'react'
import { ArrowRight, MapPin, Box, Hash, AlertTriangle, Lightbulb, Check, Layers, Package, ScanLine, X, Search } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { format } from 'date-fns'
import * as locaisQueries from '../queries/locais.js';
import * as produtosQueries from '../queries/produtos.js';
import * as estoqueQueries from '../queries/estoque.js';
import * as movimentacoesQueries from '../queries/movimentacoes.js';

export function Movimentacao() {
  const { operador, toastSuccess, toastError, toastWarning } = useAppStore()
  
  // Modos: 'SCANNER_ORIGEM' | 'DESTINO' | 'ANTIGO_PRODUTO' | 'ANTIGO_QTD'
  const [step, setStep] = useState('SCANNER_ORIGEM')
  
  // Estado Universal
  const [entidadeTipo, setEntidadeTipo] = useState(null) // 'PALETE' | 'CAIXAS' | 'ANTIGO'
  const [paleteSelecionado, setPaleteSelecionado] = useState(null)
  const [caixasSelecionadas, setCaixasSelecionadas] = useState([])
  const [enderecoOrigem, setEnderecoOrigem] = useState(null) // Para o modo antigo
  
  // Estado Modo Antigo
  const [produtoAntigo, setProdutoAntigo] = useState(null)
  const [saldoAtual, setSaldoAtual] = useState(null)
  const [saldoOpcoes, setSaldoOpcoes] = useState([])
  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [sugestoes, setSugestoes] = useState([])

  const [destino, setDestino] = useState('')

  const resetAll = () => {
    setStep('SCANNER_ORIGEM')
    setEntidadeTipo(null)
    setPaleteSelecionado(null)
    setCaixasSelecionadas([])
    setEnderecoOrigem(null)
    setProdutoAntigo(null)
    setSaldoAtual(null)
    setSaldoOpcoes([])
    setQtdCaixas('')
    setQtdKg('')
    setDestino('')
    setSugestoes([])
    setTimeout(() => document.getElementById('input-universal')?.focus(), 100)
  }

  // --- SCANNER UNIVERSAL ---
  const { inputRef: universalRef, handleKeyDown: handleUniversalKeyDown } = useBarcodeScanner({
    onScan: async (val) => {
      const codigo = val.toUpperCase().trim()
      
      // Se já estiver na etapa de destino e bipar algo
      if (step === 'DESTINO') {
        return processarScanDestino(codigo)
      }

      // Se for modo ANTIGO aguardando produto
      if (step === 'ANTIGO_PRODUTO') {
        return processarScanProdutoAntigo(codigo)
      }

      // ESTAMOS NO PASSO INICIAL (Origem)
      try {
        const iden = await movimentacoesQueries.identificarCodigoMovimentacao(codigo)
        
        if (iden.tipo === 'PALETE') {
          if (entidadeTipo === 'CAIXAS') return toastWarning('Atenção', 'Você já estava bipando caixas avulsas. Conclua ou reinicie.')
          setEntidadeTipo('PALETE')
          setPaleteSelecionado(iden.dados)
          setStep('DESTINO')
          toastSuccess('Palete LPN Detectado', 'Mova o palete inteiro para o destino.')
        } 
        else if (iden.tipo === 'CAIXA') {
          if (entidadeTipo === 'PALETE') return toastWarning('Atenção', 'Você já selecionou um palete inteiro.')
          
          // Verifica se já bipou essa caixa
          if (caixasSelecionadas.find(c => c.id === iden.dados.id)) {
            return toastWarning('Aviso', 'Esta caixa já foi bipada.')
          }

          setEntidadeTipo('CAIXAS')
          setCaixasSelecionadas(prev => [iden.dados, ...prev])
          toastSuccess('Caixa SSCC Adicionada', iden.dados.produto_descricao)
        }
        else if (iden.tipo === 'ENDERECO') {
          // Se for REC ou EXPEDICAO não pode origem antiga genérica
          if (iden.dados.endereco === 'REC' || iden.dados.endereco === 'EXPEDICAO') {
            return toastWarning('Não permitido', `Para ${iden.dados.endereco}, bipe os paletes ou caixas individualmente.`)
          }
          
          if (entidadeTipo === 'CAIXAS') {
            // Se ele estava bipando caixas e de repente bipou um endereço, ele quer que seja o DESTINO!
            return processarScanDestino(codigo)
          }

          if (entidadeTipo === 'PALETE') return toastWarning('Atenção', 'Você já selecionou um palete.')

          setEntidadeTipo('ANTIGO')
          setEnderecoOrigem(iden.dados.endereco)
          setStep('ANTIGO_PRODUTO')
          toastSuccess('Endereço Confirmado', 'Fluxo antigo ativado.')
        }
        else {
          toastError('Código não reconhecido', 'Não é um Palete, Caixa ou Endereço válido.')
        }

      } catch (e) {
        toastError('Erro', e.message)
      }
    }
  })

  const processarScanDestino = async (val) => {
    const dst = val.toUpperCase().trim()
    if (dst === 'REC' || dst === 'EXPEDICAO') {
      return toastError('Destino Proibido', `Não é permitido transferir para "${dst}" pela Movimentação. Use a tela de Recebimento ou Saída.`)
    }
    const localDst = await locaisQueries.buscarPorEndereco(dst)
    if (!localDst) {
      return toastError('Endereço Inválido', `O endereço "${dst}" não está cadastrado.`)
    }
    setDestino(dst)
  }

  const processarScanProdutoAntigo = async (val) => {
    try {
      const p = await produtosQueries.buscarPorCodigo(val)
      if (!p) return toastWarning('Aviso', 'Produto não cadastrado.')
      
      const saldos = await estoqueQueries.buscarPorEnderecoProduto(enderecoOrigem, p.id)
      if (saldos.length === 0) {
        return toastError('Sem Saldo', `O produto não possui saldo em ${enderecoOrigem}`)
      }
      setProdutoAntigo(p)

      if (saldos.length === 1) {
        setSaldoAtual(saldos[0])
        setStep('ANTIGO_QTD')
      } else {
        setSaldoOpcoes(saldos)
        setStep('ANTIGO_SELECIONAR_LOTE')
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const selecionarLoteAntigo = async (saldo) => {
    setSaldoAtual(saldo)
    setSaldoOpcoes([])
    setStep('ANTIGO_QTD')
  }

  const handleQtdSubmitAntigo = (e) => {
    e.preventDefault()
    if (!qtdCaixas || !qtdKg) return toastWarning('Aviso', 'Preencha caixas e kg.')
    if (parseFloat(qtdCaixas) > saldoAtual.qtd_caixas || parseFloat(qtdKg) > saldoAtual.qtd_kg) {
      return toastError('Aviso', 'Quantidade excede o saldo disponível na origem.')
    }
    setStep('DESTINO')
  }

  const confirmarMovimentacao = async () => {
    if (!destino) return toastWarning('Aviso', 'Informe o destino.')

    try {
      let res;
      if (entidadeTipo === 'PALETE') {
        res = await movimentacoesQueries.transferirPalete({
          palete_id: paleteSelecionado.id,
          destino,
          operador_id: operador.id,
          operador_nome: operador.nome
        });
      } 
      else if (entidadeTipo === 'CAIXAS') {
        res = await movimentacoesQueries.transferirCaixasSSCC({
          caixas_ids: caixasSelecionadas.map(c => c.id),
          destino,
          operador_id: operador.id,
          operador_nome: operador.nome
        });
      }
      else if (entidadeTipo === 'ANTIGO') {
        res = await movimentacoesQueries.transferir({
          produto_id: produtoAntigo.id,
          lote: saldoAtual.lote,
          validade: saldoAtual.validade,
          qtd_caixas: parseFloat(qtdCaixas),
          qtd_kg: parseFloat(qtdKg),
          origem: enderecoOrigem,
          destino: destino,
          operador_id: operador.id,
          operador_nome: operador.nome
        });
      }

      if (res && res.success) {
        toastSuccess('Movimentação Concluída', `Transferência para ${destino} realizada.`)
        resetAll()
      } else {
        toastError('Erro', res ? res.error : 'Falha desconhecida')
      }
    } catch (err) {
      toastError('Erro Fatal', err.message)
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Movimentação Interna</h1>
          <p className="page-header__subtitle">Transfira Paletes LPN, Caixas SSCC ou Endereços Genéricos</p>
        </div>
        <button className="btn btn--ghost" onClick={resetAll}>Reiniciar Fluxo</button>
      </div>

      <div className="mov-flow">
        
        {/* STEP 1: SCANNER UNIVERSAL (Origem) */}
        <div className={`mov-step ${step === 'SCANNER_ORIGEM' || entidadeTipo === 'CAIXAS' ? 'active' : 'completed'}`}>
          <div className="mov-step__header">
            <div className="mov-step__number">1</div>
            <div className="mov-step__label">Bipar Origem (Palete, Caixa ou Endereço)</div>
          </div>
          
          {step === 'SCANNER_ORIGEM' || (entidadeTipo === 'CAIXAS' && !destino) ? (
            <div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input 
                    id="input-universal" 
                    ref={universalRef}
                    className="form-input form-input--scanner" 
                    placeholder="Bipar LPN, SSCC ou Endereço..." 
                    onKeyDown={handleUniversalKeyDown} 
                    autoFocus 
                  />
                  <ScanLine size={20} className="text-muted" style={{ position: 'absolute', right: 16, top: 12 }} />
                </div>
                {entidadeTipo === 'CAIXAS' && caixasSelecionadas.length > 0 && (
                  <button className="btn btn--primary" onClick={() => setStep('DESTINO')}>
                    Ir para Destino <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* DISPLAY DA ENTIDADE SELECIONADA */}
          {entidadeTipo === 'PALETE' && (
            <div className="mt-16 p-16" style={{ background: 'var(--primary-muted)', border: '1px solid var(--primary)', borderRadius: 8 }}>
              <div className="flex items-center gap-12 font-bold text-primary mb-8" style={{ fontSize: 18 }}>
                <Layers size={24} /> {paleteSelecionado.codigo}
              </div>
              <div className="text-sm text-muted">
                Local atual: <strong className="text-white">{paleteSelecionado.endereco_atual}</strong> | 
                Contém <strong>{paleteSelecionado.caixas?.length} caixas</strong> ({paleteSelecionado.peso_total?.toFixed(2)} kg)
              </div>
            </div>
          )}

          {entidadeTipo === 'CAIXAS' && caixasSelecionadas.length > 0 && (
            <div className="mt-16">
              <div className="text-sm font-bold text-primary mb-8 flex items-center gap-8">
                <Package size={16} /> {caixasSelecionadas.length} Caixa(s) Selecionada(s)
                <span className="text-muted font-normal text-xs ml-auto">Total: {caixasSelecionadas.reduce((s, c) => s + c.peso_kg, 0).toFixed(2)} kg</span>
              </div>
              <div style={{ display: 'grid', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {caixasSelecionadas.map(c => (
                  <div key={c.id} style={{ padding: '8px 12px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div className="font-bold text-sm">{c.produto_descricao}</div>
                      <div className="text-xs text-muted font-mono">{c.ean_caixa}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-cyan">{c.peso_kg} kg</div>
                      <div className="text-xs text-muted">Origem: {c.endereco || c.palete_codigo || 'REC'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {entidadeTipo === 'ANTIGO' && (
            <div className="mt-16 p-16" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div className="flex items-center gap-12 font-bold text-cyan" style={{ fontSize: 18 }}>
                <MapPin size={24} /> Origem Genérica: {enderecoOrigem}
              </div>
            </div>
          )}
        </div>

        {/* --- FLUXO ANTIGO ESCONDIDO DENTRO SE NECESSÁRIO --- */}
        {entidadeTipo === 'ANTIGO' && (
          <>
            <div className={`mov-step ${step === 'ANTIGO_PRODUTO' || step === 'ANTIGO_SELECIONAR_LOTE' ? 'active' : step === 'ANTIGO_QTD' || destino ? 'completed' : ''}`}>
              <div className="mov-step__header"><div className="mov-step__number">2</div><div className="mov-step__label">Material (Fluxo Antigo)</div></div>
              {step === 'ANTIGO_PRODUTO' && (
                <input className="form-input form-input--scanner" placeholder="Bipar material..." onKeyDown={(e) => e.key === 'Enter' && processarScanProdutoAntigo(e.target.value)} autoFocus />
              )}
              {step === 'ANTIGO_SELECIONAR_LOTE' && (
                <div className="flex-col gap-8">
                  {saldoOpcoes.map((s, i) => (
                    <div key={i} onClick={() => selecionarLoteAntigo(s)} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px', cursor: 'pointer' }}>
                      <div className="font-bold">Lote: {s.lote || 'N/A'} - {s.qtd_caixas} CX / {s.qtd_kg} KG</div>
                    </div>
                  ))}
                </div>
              )}
              {produtoAntigo && saldoAtual && (
                <div className="mt-8 text-cyan font-bold">{produtoAntigo.descricao} (Lote: {saldoAtual.lote})</div>
              )}
            </div>

            <div className={`mov-step ${step === 'ANTIGO_QTD' ? 'active' : destino ? 'completed' : ''}`}>
              <div className="mov-step__header"><div className="mov-step__number">3</div><div className="mov-step__label">Quantidade (Fluxo Antigo)</div></div>
              {step === 'ANTIGO_QTD' && (
                <form onSubmit={handleQtdSubmitAntigo} className="flex gap-16 items-end">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Caixas (Máx: {saldoAtual.qtd_caixas})</label>
                    <input type="number" step="0.01" className="form-input" value={qtdCaixas} onChange={e => setQtdCaixas(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">KG (Máx: {saldoAtual.qtd_kg})</label>
                    <input type="number" step="0.01" className="form-input" value={qtdKg} onChange={e => setQtdKg(e.target.value)} />
                  </div>
                  <button type="submit" className="btn btn--primary btn--lg">OK</button>
                </form>
              )}
              {destino && (
                <div className="mt-8 font-bold text-cyan">{qtdCaixas} cx / {qtdKg} kg</div>
              )}
            </div>
          </>
        )}

        {/* STEP DESTINO E CONFIRMAÇÃO */}
        {entidadeTipo && (step === 'DESTINO' || destino) && (
          <div className={`mov-step active`}>
            <div className="mov-step__header">
              <div className="mov-step__number">{entidadeTipo === 'ANTIGO' ? 4 : 2}</div>
              <div className="mov-step__label">Endereço Destino</div>
            </div>
            
            {!destino ? (
              <input 
                id="input-destino"
                className="form-input form-input--scanner" 
                placeholder="Bipar endereço de destino..." 
                onKeyDown={(e) => e.key === 'Enter' && processarScanDestino(e.target.value)} 
                autoFocus 
              />
            ) : (
              <div style={{ background: 'var(--success-muted)', border: '1px solid var(--success)', borderRadius: 8, padding: 24, textAlign: 'center' }}>
                <div className="text-muted text-sm uppercase font-bold mb-8">Movimentar para</div>
                <div className="font-mono text-success flex items-center justify-center gap-12" style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
                  <MapPin size={28} /> {destino}
                </div>
                
                <div className="flex gap-16 justify-center">
                  <button className="btn btn--ghost btn--lg" onClick={() => setDestino('')}>Alterar Destino</button>
                  <button className="btn btn--primary btn--lg" onClick={confirmarMovimentacao} style={{ paddingLeft: 40, paddingRight: 40 }}>
                    <Check size={20} /> CONFIRMAR MOVIMENTAÇÃO
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
