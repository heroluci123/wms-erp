import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Check, Tag, Sparkles, AlertTriangle, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import * as produtosQueries from '../../queries/produtos.js';

export function CadastroEanModal({ isOpen, onClose, codigoDesconhecido, onRegraSalva }) {
  const { toastSuccess, toastError } = useAppStore();

  // Estado de sugestão automática
  const [sugestao, setSugestao] = useState(null); // { produto, regraUsada }
  const [modo, setModo] = useState('sugestao'); // 'sugestao' | 'busca'

  // Estado de busca manual
  const [busca, setBusca] = useState('');
  const [produtosList, setProdutosList] = useState([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);

  // Configuração da regra
  const [mudaPorCaixa, setMudaPorCaixa] = useState(true); // padrão: caixas de peso variável
  const [digitosFinais, setDigitosFinais] = useState('');

  const searchInputRef = useRef(null);

  useEffect(() => {
    if (isOpen && codigoDesconhecido) {
      // Reset
      setSugestao(null);
      setModo('sugestao');
      setBusca('');
      setProdutoSelecionado(null);
      setMudaPorCaixa(true);
      setDigitosFinais(codigoDesconhecido?.slice(-6) || '');

      // Buscar sugestão automática em paralelo com a lista
      Promise.all([
        produtosQueries.buscarSugestaoEan(codigoDesconhecido),
        produtosQueries.listar()
      ]).then(([sug, lista]) => {
        setProdutosList(lista);
        if (sug) {
          setSugestao(sug);
          setProdutoSelecionado(sug.produto);
          setDigitosFinais(sug.regraUsada); // já usa a regra que achou
        } else {
          setModo('busca'); // sem sugestão → já vai pra busca manual
          setTimeout(() => searchInputRef.current?.focus(), 150);
        }
      }).catch(() => toastError('Erro', 'Falha ao buscar sugestão.'));
    }
  }, [isOpen, codigoDesconhecido]);

  const produtosFiltrados = produtosList.filter(p =>
    p.descricao.toLowerCase().includes(busca.toLowerCase()) ||
    (p.codigo && p.codigo.includes(busca))
  );

  const handleConfirmarSugestao = async () => {
    // Usuário confirmou a sugestão automática — só registra EAN exato sem perguntar mais nada
    try {
      const res = await produtosQueries.salvarRegraEan(sugestao.produto.id, codigoDesconhecido, 'EXATO');
      if (res.success || res.error?.includes('já está vinculada')) {
        toastSuccess('✅ Reconhecido!', `${sugestao.produto.descricao} — registrado automaticamente.`);
        if (onRegraSalva) onRegraSalva(sugestao.produto);
        onClose();
      } else {
        toastError('Erro', res.error);
      }
    } catch (err) {
      toastError('Erro Fatal', err.message);
    }
  };

  const handleSalvarManual = async () => {
    if (!produtoSelecionado) return toastError('Atenção', 'Selecione um produto da lista.');

    let regra = codigoDesconhecido;
    let tipo = 'EXATO';

    if (mudaPorCaixa) {
      if (!digitosFinais || digitosFinais.length < 3) {
        return toastError('Atenção', 'Os dígitos finais precisam ter ao menos 3 caracteres.');
      }
      regra = digitosFinais;
      tipo = 'CONTEM';
    }

    try {
      const res = await produtosQueries.salvarRegraEan(produtoSelecionado.id, regra, tipo);
      if (res.success) {
        const msg = tipo === 'CONTEM'
          ? `Qualquer código que termine com "${regra}" agora é ${produtoSelecionado.descricao}.`
          : `Código ${codigoDesconhecido} vinculado a ${produtoSelecionado.descricao}.`;
        toastSuccess('Regra Salva! 🎉', msg);
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

  // ── Extrai partes visuais do código para highlight
  const ean = codigoDesconhecido || '';
  const sufixoLen = digitosFinais?.length || 6;
  const prefixo = ean.slice(0, ean.length - sufixoLen);
  const sufixo = ean.slice(ean.length - sufixoLen);

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 620 }}>

        {/* HEADER */}
        <div className="modal-header">
          <h2 className="flex items-center gap-8" style={{ color: 'var(--warning)' }}>
            <Tag size={20} /> EAN Não Cadastrado
          </h2>
          <button className="btn btn--ghost" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">

          {/* Código bipado com highlight visual */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, textAlign: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>{prefixo}</span>
            <span style={{ color: 'var(--warning)', fontWeight: 700, background: 'rgba(251,191,36,0.15)', borderRadius: 4, padding: '0 4px' }}>{sufixo}</span>
          </div>

          {/* ── MODO SUGESTÃO: produto identificado automaticamente ── */}
          {modo === 'sugestao' && sugestao && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Sparkles size={18} style={{ color: '#a78bfa' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>Sugestão Automática</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— baseado na regra <strong>…{sugestao.regraUsada}</strong></span>
              </div>

              {/* Card da sugestão */}
              <div style={{ background: 'rgba(167,139,250,0.1)', border: '2px solid #a78bfa', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}>PRODUTO IDENTIFICADO</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'white', marginBottom: 4 }}>{sugestao.produto.descricao}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Código: {sugestao.produto.codigo || '-'} | Unidade: {sugestao.produto.unidade}</div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 8 }}>
                💡 O sistema reconheceu esse código pela regra <strong>CONTEM "…{sugestao.regraUsada}"</strong>. Se confirmar, esse EAN exato será salvo para que na próxima bipagem seja reconhecido instantaneamente.
              </div>

              <div className="flex gap-12">
                <button className="btn btn--ghost w-full" onClick={() => { setModo('busca'); setTimeout(() => searchInputRef.current?.focus(), 100) }}>
                  <Search size={15} /> Não é esse produto
                </button>
                <button className="btn btn--lg w-full" style={{ background: '#a78bfa', color: 'white' }} onClick={handleConfirmarSugestao}>
                  <Check size={18} /> Confirmar — {sugestao.produto.descricao}
                </button>
              </div>
            </div>
          )}

          {/* ── MODO BUSCA MANUAL ── */}
          {modo === 'busca' && (
            <div>
              {sugestao && (
                <button className="btn btn--ghost btn--sm mb-16 flex items-center gap-8" style={{ color: '#a78bfa' }} onClick={() => setModo('sugestao')}>
                  <Sparkles size={14} /> Voltar à sugestão automática
                </button>
              )}

              <p className="text-muted mb-12" style={{ fontSize: 14 }}>
                A qual produto esse código pertence?
              </p>

              {/* Campo de busca */}
              <div className="form-group mb-12">
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: 38 }}
                    placeholder="Digite o nome ou código do produto..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                  />
                </div>
              </div>

              {/* Lista de produtos */}
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
                {produtosFiltrados.length === 0 ? (
                  <div className="p-16 text-center text-muted text-sm">Nenhum produto encontrado.</div>
                ) : (
                  produtosFiltrados.map(p => (
                    <div key={p.id}
                      onClick={() => setProdutoSelecionado(p)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                        borderLeft: produtoSelecionado?.id === p.id ? '4px solid var(--primary)' : '4px solid transparent',
                        background: produtoSelecionado?.id === p.id ? 'rgba(99,102,241,0.08)' : 'transparent',
                        transition: 'background 0.15s'
                      }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{p.descricao}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Código: {p.codigo || '-'} | {p.unidade}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Configuração de regra */}
              {produtoSelecionado && (
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Como salvar esse código?</div>

                  <div className="flex gap-8 mb-12">
                    <button
                      className={`btn btn--sm ${mudaPorCaixa ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setMudaPorCaixa(true)}>
                      Código muda por caixa
                    </button>
                    <button
                      className={`btn btn--sm ${!mudaPorCaixa ? 'btn--primary' : 'btn--ghost'}`}
                      onClick={() => setMudaPorCaixa(false)}>
                      Código é sempre igual
                    </button>
                  </div>

                  {mudaPorCaixa ? (
                    <div>
                      <label className="form-label" style={{ fontSize: 12 }}>Dígitos finais que sempre repetem:</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="text"
                          className="form-input"
                          style={{ fontFamily: 'monospace', letterSpacing: 2, fontWeight: 700 }}
                          value={digitosFinais}
                          onChange={e => setDigitosFinais(e.target.value)}
                          maxLength={12}
                          placeholder="Ex: 004960"
                        />
                      </div>
                      {digitosFinais && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                          O sistema vai reconhecer qualquer código que termine com{' '}
                          <strong style={{ color: 'var(--warning)', fontFamily: 'monospace' }}>…{digitosFinais}</strong>{' '}
                          como <strong>{produtoSelecionado.descricao}</strong>.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      O código exato <strong style={{ fontFamily: 'monospace', color: 'var(--warning)' }}>{codigoDesconhecido}</strong> será vinculado a <strong>{produtoSelecionado.descricao}</strong>.
                    </div>
                  )}
                </div>
              )}

              <button
                className="btn btn--primary btn--lg w-full"
                onClick={handleSalvarManual}
                disabled={!produtoSelecionado}>
                <Check size={16} /> Salvar Regra
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
