import React, { useState, useEffect, useRef } from 'react';
import { X, Tag, Check, ArrowRight } from 'lucide-react';
import * as movimentacoesQueries from '../../queries/movimentacoes.js';
import { useAppStore } from '../../store/appStore';

/**
 * Modal de Conversão de EAN Genérico → SSCC Único
 *
 * Aparece quando um EAN genérico (já vinculado a um produto via regra CONTEM/EXATO)
 * é bipado durante Movimentação ou Inventário Cíclico.
 *
 * O operador tem a caixa física na mão. O sistema pede o peso real e a validade
 * daquela caixa específica, gera um código interno único (INT-xxx) e cria um registro
 * em estoque_caixas — convertendo o item legado agregado para rastreabilidade por caixa.
 *
 * Props:
 *  - isOpen: boolean
 *  - onClose: () => void
 *  - produto: objeto produto encontrado via regra genérica
 *  - eanGenerico: string — o EAN genérico que foi bipado (ex: "460")
 *  - onConvertido: ({ ean_gerado, peso_kg, validade }) => void — chamado após gravar
 */
export function ConverterSSCCModal({ isOpen, onClose, produto, eanGenerico, onConvertido }) {
  const { operador, toastSuccess, toastError } = useAppStore();
  const [pesoKg, setPesoKg] = useState('');
  const [validade, setValidade] = useState('');
  const [salvando, setSalvando] = useState(false);
  const pesoRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setPesoKg('');
      setValidade('');
      setSalvando(false);
      setTimeout(() => pesoRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleConfirmar = async (e) => {
    e.preventDefault();
    if (!pesoKg || parseFloat(pesoKg) <= 0) return toastError('Atenção', 'Informe o peso real desta caixa.');
    if (!validade) return toastError('Atenção', 'Informe a data de validade.');

    setSalvando(true);
    try {
      // Gera código interno único para esta caixa física
      const eanGerado = `INT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Cria o registro serializado em estoque_caixas
      const res = await movimentacoesQueries.receberCaixaSerializada({
        ean_caixa: eanGerado,
        produto_id: produto.id,
        palete_id: null,
        peso_kg: parseFloat(pesoKg),
        validade,
        operador_id: operador?.id || null,
        operador_nome: operador?.nome || 'Sistema',
      });

      if (!res.success) {
        toastError('Erro ao converter', res.error);
        return;
      }

      toastSuccess('✅ Caixa convertida para SSCC!', `${produto.descricao} — ${pesoKg} kg — Val: ${validade}`);
      onConvertido?.({ ean_gerado: eanGerado, peso_kg: parseFloat(pesoKg), validade });
      onClose();
    } catch (err) {
      toastError('Erro', err.message);
    } finally {
      setSalvando(false);
    }
  };

  if (!isOpen || !produto) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 480 }}>

        {/* HEADER */}
        <div className="modal-header">
          <h2 className="flex items-center gap-8" style={{ color: 'var(--warning)' }}>
            <Tag size={20} /> Converter para SSCC Único
          </h2>
          <button className="btn btn--ghost" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">

          {/* Info do EAN genérico */}
          <div style={{
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: 10, padding: '12px 16px', marginBottom: 20
          }}>
            <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              EAN Genérico detectado
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'white', marginBottom: 4 }}>
              {eanGenerico}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Este código pertence a <strong style={{ color: 'white' }}>{produto.descricao}</strong>, mas não é único por caixa.
            </div>
          </div>

          {/* Instruções */}
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Você tem esta caixa na mão. Informe o <strong>peso real</strong> e a <strong>validade</strong> dela para que o sistema gere um código único de rastreabilidade.
          </p>

          {/* Formulário */}
          <form onSubmit={handleConfirmar}>
            <div className="form-grid form-grid--2" style={{ marginBottom: 20 }}>
              <div className="form-group">
                <label className="form-label">Peso real desta caixa (KG) *</label>
                <input
                  ref={pesoRef}
                  type="number"
                  step="0.001"
                  className="form-input form-input--number"
                  placeholder="Ex: 12.350"
                  value={pesoKg}
                  onChange={e => setPesoKg(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Validade *</label>
                <input
                  type="date"
                  className="form-input"
                  value={validade}
                  onChange={e => setValidade(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Preview do que será gerado */}
            <div style={{
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: 'var(--text-muted)'
            }}>
              <ArrowRight size={12} style={{ display: 'inline', marginRight: 6, color: 'var(--primary)' }} />
              Um código interno único será gerado automaticamente <span style={{ color: 'var(--primary)' }}>(INT-xxx)</span> e vinculado a esta caixa específica.
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
  );
}
