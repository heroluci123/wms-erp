import React, { useState, useEffect, useRef } from 'react'
import { X, Tag, Check, ArrowRight } from 'lucide-react'
import * as movimentacoesQueries from '../../queries/movimentacoes.js'
import { tarasQueries } from '../../queries/taras.js'
import { useAppStore } from '../../store/appStore'
import PesagemTaraFields, { resolverTaraSelecionada } from './PesagemTaraFields.jsx'
import { validarPesagemTara, hojeIsoLocal, fmtKg2, fmtDataBR } from '../../utils/rastreabilidade.js'

/**
 * Modal de Conversão de EAN Genérico → Etiqueta Única Rastreada
 */
export function ConverterSSCCModal({ isOpen, onClose, produto, eanGenerico, onConvertido }) {
  const { operador, toastSuccess, toastError } = useAppStore()
  const [taras, setTaras] = useState([])
  const [formPesagem, setFormPesagem] = useState({
    data_producao: hojeIsoLocal(),
    validade: '',
    tara_id: '',
    peso_bruto: '',
    qtd_pecas: '',
  })
  const [salvando, setSalvando] = useState(false)
  const pesoBrutoRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setSalvando(false)
    tarasQueries.listar(true).then((lista) => {
      setTaras(lista)
      const padrao = resolverTaraSelecionada(lista, '')
      setFormPesagem({
        data_producao: hojeIsoLocal(),
        validade: '',
        tara_id: padrao ? String(padrao.id) : '',
        peso_bruto: '',
        qtd_pecas: '',
      })
      setTimeout(() => pesoBrutoRef.current?.focus(), 150)
    }).catch(() => {})
  }, [isOpen])

  const handleConfirmar = async (e) => {
    e?.preventDefault()
    const taraAtual = resolverTaraSelecionada(taras, formPesagem.tara_id)
    const valid = validarPesagemTara({
      dataProducao: formPesagem.data_producao,
      validade: formPesagem.validade,
      taraId: taraAtual?.id,
      taraKg: taraAtual?.peso_kg ?? 0,
      pesoBruto: formPesagem.peso_bruto,
      qtdPecas: formPesagem.qtd_pecas,
    })
    if (!valid.ok) return toastError('Dados inválidos', valid.erro)

    setSalvando(true)
    try {
      const eanGerado = await tarasQueries.gerarProximoEanInterno(produto?.codigo || '')

      const res = await movimentacoesQueries.receberCaixaSerializada({
        ean_caixa: eanGerado,
        produto_id: produto.id,
        palete_id: null,
        peso_kg: valid.peso_liquido_kg,
        peso_bruto_kg: valid.peso_bruto_kg,
        tara_id: valid.tara_id,
        tara_kg: valid.tara_kg,
        qtd_pecas: valid.qtd_pecas,
        data_producao: valid.data_producao,
        lote: valid.lote,
        validade: valid.validade,
        origem_tipo: 'CONVERSAO_EAN',
        operador_id: operador?.id || null,
        operador_nome: operador?.nome || 'Sistema',
      })

      if (!res.success) {
        toastError('Erro ao converter', res.error)
        return
      }

      toastSuccess(
        'Caixa convertida e rastreada!',
        `${produto.descricao} • ${valid.qtd_pecas} pç • Líq ${fmtKg2(valid.peso_liquido_kg)} • Lote ${valid.lote} • Val: ${fmtDataBR(valid.validade)}`
      )
      onConvertido?.({
        ean_gerado: eanGerado,
        peso_kg: valid.peso_liquido_kg,
        peso_bruto_kg: valid.peso_bruto_kg,
        tara_kg: valid.tara_kg,
        qtd_pecas: valid.qtd_pecas,
        data_producao: valid.data_producao,
        lote: valid.lote,
        validade: valid.validade,
      })
      onClose()
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setSalvando(false)
    }
  }

  if (!isOpen || !produto) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 className="flex items-center gap-8" style={{ color: 'var(--warning)' }}>
            <Tag size={20} /> Converter para Caixa Rastreada
          </h2>
          <button className="btn btn--ghost" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <div style={{
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              EAN Genérico detectado
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 700, color: 'white', marginBottom: 4 }}>
              {eanGenerico}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Produto: <strong style={{ color: 'white' }}>{produto.descricao}</strong>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            Informe <strong>Data de Produção</strong> (lote gerado automaticamente), <strong>Validade</strong>, <strong>Tara</strong> e <strong>Peso Bruto</strong>. O peso líquido será calculado automaticamente.
          </p>

          <form onSubmit={handleConfirmar}>
            <PesagemTaraFields
              taras={taras}
              value={formPesagem}
              onChange={(next) => setFormPesagem(next)}
              pesoBrutoRef={pesoBrutoRef}
              onEnterPesoBruto={handleConfirmar}
            />

            <div style={{
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: 8, padding: '10px 14px', margin: '16px 0', fontSize: 12, color: 'var(--text-muted)',
            }}>
              <ArrowRight size={12} style={{ display: 'inline', marginRight: 6, color: 'var(--primary)' }} />
              Será gerado automaticamente um EAN interno exclusivo de 16 dígitos para esta caixa.
            </div>

            <div className="flex gap-12">
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--warning btn--lg" style={{ flex: 1 }} disabled={salvando}>
                <Check size={18} /> {salvando ? 'Convertendo...' : 'Converter e Continuar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
