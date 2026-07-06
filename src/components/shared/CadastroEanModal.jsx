import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Check, Tag, Sparkles } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import * as produtosQueries from '../../queries/produtos.js';

/**
 * Modal de Cadastro Dinâmico de EAN
 * 
 * Lógica:
 * 1. Ao abrir, tenta encontrar sugestão automática por regra CONTEM já salva
 * 2. Se achar → mostra a sugestão, usuário só confirma
 * 3. Se não achar → mostra busca manual, usuário seleciona o produto
 * 4. SEMPRE salva como regra CONTEM (sufixo) para EANs longos (>= 8 dígitos)
 *    ou EXATO para códigos curtos internos
 * Sem toggle "muda por caixa" — é sempre variável na prática.
 */
export function CadastroEanModal({ isOpen, onClose, codigoDesconhecido, onRegraSalva }) {
  const { toastSuccess, toastError } = useAppStore();

  const [sugestao, setSugestao] = useState(null);
  const [modo, setModo] = useState('carregando'); // 'carregando' | 'sugestao' | 'busca'
  const [busca, setBusca] = useState('');
  const [produtosList, setProdutosList] = useState([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);

  // Quantos dígitos finais usar como sufixo (editável pelo usuário)
  const [sufixoLen, setSufixoLen] = useState(6);

  const searchInputRef = useRef(null);

  const ean = codigoDesconhecido || '';
  const isEanLongo = ean.length >= 8;
  const sufixo = ean.slice(-sufixoLen);
  const prefixo = ean.slice(0, ean.length - sufixoLen);

  useEffect(() => {
    if (!isOpen || !codigoDesconhecido) return;

    // Reset
    setSugestao(null);
    setModo('carregando');
    setBusca('');
    setProdutoSelecionado(null);
    setSufixoLen(Math.min(6, codigoDesconhecido.length));

    Promise.all([
      produtosQueries.buscarSugestaoEan(codigoDesconhecido),
      produtosQueries.listar()
    ]).then(([sug, lista]) => {
      setProdutosList(lista);
      if (sug) {
        setSugestao(sug);
        setProdutoSelecionado(sug.produto);
        setSufixoLen(sug.regraUsada?.length || 6);
        setModo('sugestao');
      } else {
        setModo('busca');
        setTimeout(() => searchInputRef.current?.focus(), 150);
      }
    }).catch(() => {
      setModo('busca');
      setTimeout(() => searchInputRef.current?.focus(), 150);
    });
  }, [isOpen, codigoDesconhecido]);

  const salvarRegra = async (produto, tipo, regra) => {
    const res = await produtosQueries.salvarRegraEan(produto.id, regra, tipo);
    // Se já existe, tudo bem — só seguir em frente
    if (res.success || res.error?.includes('já está vinculada')) {
      if (onRegraSalva) onRegraSalva(produto);
      onClose();
      return true;
    }
    toastError('Erro ao salvar regra', res.error);
    return false;
  };

  const handleConfirmarSugestao = async () => {
    // Sugestão confirmada: salva o EAN exato (pra próxima bipagem ser instantânea)
    const ok = await salvarRegra(sugestao.produto, 'EXATO', ean);
    if (ok) toastSuccess('✅ Produto reconhecido!', `${sugestao.produto.descricao} — EAN registrado.`);
  };

  const handleSalvarManual = async () => {
    if (!produtoSelecionado) return toastError('Atenção', 'Selecione um produto da lista.');

    let tipo, regra;
    if (isEanLongo) {
      // EAN longo: salva como sufixo CONTEM para cobrir todas as caixas futuras
      if (!sufixo || sufixo.length < 3) return toastError('Atenção', 'O sufixo precisa ter ao menos 3 dígitos.');
      tipo = 'CONTEM';
      regra = sufixo;
    } else {
      // Código curto interno: salva exato
      tipo = 'EXATO';
      regra = ean;
    }

    const ok = await salvarRegra(produtoSelecionado, tipo, regra);
    if (ok) {
      const msg = tipo === 'CONTEM'
        ? `Qualquer caixa com EAN terminando em "…${sufixo}" será reconhecida como ${produtoSelecionado.descricao}.`
        : `Código ${ean} vinculado a ${produtoSelecionado.descricao}.`;
      toastSuccess('Regra salva! 🎉', msg);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 600 }}>

        {/* HEADER */}
        <div className="modal-header">
          <h2 className="flex items-center gap-8" style={{ color: 'var(--warning)' }}>
            <Tag size={20} /> Produto não encontrado
          </h2>
          <button className="btn btn--ghost" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-body">

          {/* Visualização do EAN com sufixo destacado */}
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Código bipado</div>
            <div style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 3, wordBreak: 'break-all' }}>
              <span style={{ color: 'var(--text-muted)' }}>{prefixo}</span>
              <span style={{ color: 'var(--warning)', fontWeight: 700, background: 'rgba(251,191,36,0.15)', borderRadius: 4, padding: '2px 6px' }}>{sufixo}</span>
            </div>
            {isEanLongo && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                Parte em <span style={{ color: 'var(--warning)' }}>amarelo</span> = sufixo fixo do produto
                {' '}·{' '}
                <span
                  style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setSufixoLen(l => Math.min(l + 1, ean.length))}>+1</span>
                {' '}
                <span
                  style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setSufixoLen(l => Math.max(l - 1, 3))}>-1</span>
              </div>
            )}
          </div>

          {/* ── CARREGANDO ── */}
          {modo === 'carregando' && (
            <div className="text-center p-24 text-muted">Buscando correspondências...</div>
          )}

          {/* ── SUGESTÃO AUTOMÁTICA ── */}
          {modo === 'sugestao' && sugestao && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Sparkles size={16} style={{ color: '#a78bfa' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>Produto identificado automaticamente</span>
              </div>

              <div style={{ background: 'rgba(167,139,250,0.1)', border: '2px solid #a78bfa', borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  ✅ Encontrado pela regra "…{sugestao.regraUsada}"
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, color: 'white', marginBottom: 4 }}>{sugestao.produto.descricao}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Código: {sugestao.produto.codigo || '-'} | {sugestao.produto.unidade}
                </div>
              </div>

              <div className="flex gap-10 mt-4">
                <button className="btn btn--ghost" onClick={() => { setModo('busca'); setTimeout(() => searchInputRef.current?.focus(), 100) }}>
                  <Search size={14} /> Não é esse
                </button>
                <button className="btn btn--lg" style={{ flex: 1, background: '#a78bfa', color: 'white' }} onClick={handleConfirmarSugestao}>
                  <Check size={18} /> Confirmar
                </button>
              </div>
            </div>
          )}

          {/* ── BUSCA MANUAL ── */}
          {modo === 'busca' && (
            <div>
              {sugestao && (
                <button className="btn btn--ghost btn--sm mb-14 flex items-center gap-8" style={{ color: '#a78bfa', fontSize: 12 }} onClick={() => setModo('sugestao')}>
                  <Sparkles size={13} /> Voltar à sugestão automática
                </button>
              )}

              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 14 }}>
                A qual produto pertence esse código?
              </p>

              {/* Campo de busca */}
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 38 }}
                  placeholder="Buscar produto pelo nome..."
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
              </div>

              {/* Lista de produtos */}
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
                {produtosList.filter(p =>
                  p.descricao.toLowerCase().includes(busca.toLowerCase()) ||
                  (p.codigo && p.codigo.toLowerCase().includes(busca.toLowerCase()))
                ).length === 0 ? (
                  <div className="p-16 text-center text-muted text-sm">Nenhum produto encontrado.</div>
                ) : (
                  produtosList
                    .filter(p =>
                      p.descricao.toLowerCase().includes(busca.toLowerCase()) ||
                      (p.codigo && p.codigo.toLowerCase().includes(busca.toLowerCase()))
                    )
                    .map(p => (
                      <div key={p.id}
                        onClick={() => setProdutoSelecionado(p)}
                        style={{
                          padding: '10px 14px', cursor: 'pointer',
                          borderBottom: '1px solid var(--border)',
                          borderLeft: produtoSelecionado?.id === p.id ? '4px solid var(--primary)' : '4px solid transparent',
                          background: produtoSelecionado?.id === p.id ? 'rgba(99,102,241,0.09)' : 'transparent',
                          transition: 'background 0.12s'
                        }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{p.descricao}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {p.codigo || '-'} | {p.unidade}
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* Prévia da regra que vai ser salva */}
              {produtoSelecionado && isEanLongo && (
                <div style={{ padding: '10px 14px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Toda caixa com EAN terminando em </span>
                  <strong style={{ color: 'var(--warning)', fontFamily: 'monospace' }}>…{sufixo}</strong>
                  <span style={{ color: 'var(--text-muted)' }}> será reconhecida como </span>
                  <strong>{produtoSelecionado.descricao}</strong>.
                </div>
              )}

              <button
                className="btn btn--primary btn--lg w-full"
                onClick={handleSalvarManual}
                disabled={!produtoSelecionado}>
                <Check size={16} /> Vincular e Salvar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
