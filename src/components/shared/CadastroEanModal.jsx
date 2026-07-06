import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Check, Tag } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import * as produtosQueries from '../../queries/produtos.js';

export function CadastroEanModal({ isOpen, onClose, codigoDesconhecido, onRegraSalva }) {
  const { toastSuccess, toastError } = useAppStore();
  const [busca, setBusca] = useState('');
  const [produtosList, setProdutosList] = useState([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  const [mudaPorCaixa, setMudaPorCaixa] = useState(false);
  const [digitosFinais, setDigitosFinais] = useState('');
  
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setBusca('');
      setProdutoSelecionado(null);
      setMudaPorCaixa(false);
      setDigitosFinais(codigoDesconhecido?.slice(-6) || '');
      carregarProdutos();
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen, codigoDesconhecido]);

  const carregarProdutos = async () => {
    try {
      const p = await produtosQueries.listar();
      setProdutosList(p);
    } catch (e) {
      toastError('Erro', 'Não foi possível listar os produtos.');
    }
  };

  const produtosFiltrados = produtosList.filter(p => 
    p.descricao.toLowerCase().includes(busca.toLowerCase()) || 
    (p.codigo && p.codigo.includes(busca))
  );

  const handleSave = async () => {
    if (!produtoSelecionado) {
      return toastError('Atenção', 'Selecione um produto da lista.');
    }

    let regra = codigoDesconhecido;
    let tipo = 'EXATO';

    if (mudaPorCaixa) {
      if (!digitosFinais || digitosFinais.length < 3) {
        return toastError('Atenção', 'Informe os últimos dígitos que se repetem (mínimo 3 dígitos).');
      }
      regra = digitosFinais;
      tipo = 'CONTEM';
    }

    try {
      const res = await produtosQueries.salvarRegraEan(produtoSelecionado.id, regra, tipo);
      if (res.success) {
        toastSuccess('Regra Salva', `O sistema agora reconhece esse código como ${produtoSelecionado.descricao}.`);
        if (onRegraSalva) onRegraSalva(produtoSelecionado);
        onClose();
      } else {
        toastError('Erro', res.error);
      }
    } catch (err) {
      toastError('Erro Fatal', err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2 className="text-warning flex items-center gap-8">
            <Tag size={20} /> EAN Desconhecido
          </h2>
          <button className="btn btn--ghost" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">
          <p className="text-muted mb-16">
            O código <strong>{codigoDesconhecido}</strong> não está cadastrado. A qual produto ele pertence?
          </p>

          <div className="form-group mb-16">
            <div className="input-with-icon">
              <Search size={16} />
              <input
                ref={searchInputRef}
                type="text"
                className="form-input"
                placeholder="Buscar produto por nome ou código..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
              />
            </div>
          </div>

          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
            {produtosFiltrados.length === 0 ? (
              <div className="p-16 text-center text-muted">Nenhum produto encontrado.</div>
            ) : (
              produtosFiltrados.map(p => (
                <div 
                  key={p.id} 
                  className={`p-12 cursor-pointer hover-bg-2 ${produtoSelecionado?.id === p.id ? 'bg-primary-muted border-primary' : ''}`}
                  style={{ borderBottom: '1px solid var(--border)', borderLeft: produtoSelecionado?.id === p.id ? '4px solid var(--primary)' : '4px solid transparent' }}
                  onClick={() => setProdutoSelecionado(p)}
                >
                  <div className="font-bold">{p.descricao}</div>
                  <div className="text-sm text-muted">Código: {p.codigo || '-'} | Unidade: {p.unidade}</div>
                </div>
              ))
            )}
          </div>

          {produtoSelecionado && (
            <div className="card mt-16 bg-bg-2">
              <h4 className="font-bold mb-8">Padrão do Código de Barras</h4>
              <label className="flex items-center gap-8 mb-12 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={mudaPorCaixa} 
                  onChange={e => setMudaPorCaixa(e.target.checked)}
                />
                Esse código MUDA por caixa (ex: peso embutido)
              </label>

              {mudaPorCaixa ? (
                <div className="form-group">
                  <label className="form-label">Quais são os DÍGITOS FINAIS que sempre se repetem?</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={digitosFinais} 
                    onChange={e => setDigitosFinais(e.target.value)}
                    maxLength={10}
                  />
                  <div className="text-xs text-muted mt-4">
                    O sistema vai reconhecer qualquer código que terminar com <strong>{digitosFinais}</strong>.
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted">
                  O sistema vai salvar o código <strong>{codigoDesconhecido}</strong> exato para este produto.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!produtoSelecionado}>
            <Check size={16} /> Salvar Regra
          </button>
        </div>
      </div>
    </div>
  );
}
