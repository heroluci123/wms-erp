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
  const { toastSuccess, toastError, operador } = useAppStore();
  const podeCadastrar = operador?.is_adm === 1 || !!(operador?.permissoes?.produtos);

  const [sugestao, setSugestao] = useState(null);
  const [modo, setModo] = useState('carregando'); // 'carregando' | 'sugestao' | 'busca' | 'novo'
  const [busca, setBusca] = useState('');
  const [produtosList, setProdutosList] = useState([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);
  
  const [formNovo, setFormNovo] = useState({
    descricao: '', codigo: '', unidade: 'CX', grupo: '', tipo_produto: 'Materia Prima', status_curva: 'C'
  });

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

  const handleSalvarNovoProduto = async () => {
    if (!formNovo.descricao.trim()) return toastError('Atenção', 'Preencha a descrição do produto.');
    try {
      // Cria o produto sem EAN (vamos vincular a regra em vez do EAN direto se for SSCC longo)
      // Se for curto, podemos usar como código ou ean exato.
      const produtoArgs = { ...formNovo, valor_unitario: 0 };
      if (!isEanLongo && !produtoArgs.codigo) produtoArgs.codigo = ean;

      const resCriar = await produtosQueries.criar(produtoArgs);
      if (!resCriar.success) return toastError('Erro ao criar', resCriar.error);

      const novoProdutoObj = { id: resCriar.id, ...produtoArgs };
      
      let tipo, regra;
      if (isEanLongo) {
        if (!sufixo || sufixo.length < 3) return toastError('Atenção', 'O sufixo precisa ter ao menos 3 dígitos.');
        tipo = 'CONTEM';
        regra = sufixo;
      } else {
        tipo = 'EXATO';
        regra = ean;
      }

      const ok = await salvarRegra(novoProdutoObj, tipo, regra);
      if (ok) {
        toastSuccess('Produto criado e regra salva! 🎉', `${formNovo.descricao} adicionado.`);
      }
    } catch (err) {
      toastError('Erro fatal', err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 600, width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)' }}>

        {/* HEADER */}
        <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="flex items-center gap-8" style={{ color: 'var(--warning)', margin: 0, fontSize: 18 }}>
            <Tag size={20} /> Produto não encontrado
          </h2>
          <button className="btn btn--ghost" onClick={onClose} style={{ padding: 4 }}><X size={20} /></button>
        </div>

        <div className="modal-body" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>

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
              <div style={{ flex: 1, minHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
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

              <div style={{ flexShrink: 0 }}>
                <button
                  className="btn btn--primary btn--lg w-full"
                  onClick={handleSalvarManual}
                  disabled={!produtoSelecionado}>
                  <Check size={16} /> Vincular e Salvar
                </button>
              </div>

              {podeCadastrar && (
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <span className="text-muted text-sm">O produto não está na lista? </span>
                  <button className="btn btn--ghost btn--sm text-primary" onClick={() => {
                    setFormNovo({ descricao: '', codigo: isEanLongo ? '' : ean, unidade: 'CX', grupo: '', tipo_produto: 'Materia Prima', status_curva: 'C' });
                    setModo('novo');
                  }}>
                    Cadastrar novo produto
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── CADASTRO DE NOVO PRODUTO ── */}
          {modo === 'novo' && (
            <div>
              <button className="btn btn--ghost btn--sm mb-14 flex items-center gap-8" style={{ color: 'var(--text-muted)' }} onClick={() => setModo('busca')}>
                ← Voltar para a busca
              </button>

              <div style={{ background: 'var(--bg-1)', padding: 16, borderRadius: 10, marginBottom: 16 }}>
                <h4 className="font-bold mb-12 text-primary">Cadastrar Novo Produto</h4>
                
                <div className="form-group mb-12">
                  <label className="form-label">Descrição *</label>
                  <input type="text" className="form-input" autoFocus value={formNovo.descricao} onChange={e => setFormNovo({...formNovo, descricao: e.target.value})} placeholder="Ex: COXAO MOLE 20KG" />
                </div>
                
                <div className="form-grid form-grid--2 mb-12">
                  <div className="form-group">
                    <label className="form-label">Código Interno</label>
                    <input type="text" className="form-input" value={formNovo.codigo} onChange={e => setFormNovo({...formNovo, codigo: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unidade</label>
                    <select className="form-input" value={formNovo.unidade} onChange={e => setFormNovo({...formNovo, unidade: e.target.value})}>
                      <option value="CX">Caixa (CX)</option>
                      <option value="KG">Quilo (KG)</option>
                      <option value="UN">Unidade (UN)</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid form-grid--2 mb-12">
                  <div className="form-group">
                    <label className="form-label">Tipo de Produto</label>
                    <select className="form-input" value={formNovo.tipo_produto} onChange={e => setFormNovo({...formNovo, tipo_produto: e.target.value})}>
                      <option value="Materia Prima">Matéria Prima</option>
                      <option value="Embalagem">Embalagem</option>
                      <option value="Subproduto">Subproduto</option>
                      <option value="Revenda">Revenda</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Curva ABC</label>
                    <select className="form-input" value={formNovo.status_curva} onChange={e => setFormNovo({...formNovo, status_curva: e.target.value})}>
                      <option value="A">Curva A</option>
                      <option value="B">Curva B</option>
                      <option value="C">Curva C</option>
                    </select>
                  </div>
                </div>
              </div>

              {isEanLongo && (
                <div style={{ padding: '10px 14px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>O produto será criado e a regra do sufixo </span>
                  <strong style={{ color: 'var(--warning)', fontFamily: 'monospace' }}>…{sufixo}</strong>
                  <span style={{ color: 'var(--text-muted)' }}> será vinculada a ele automaticamente.</span>
                </div>
              )}

              <button
                className="btn btn--primary btn--lg w-full"
                onClick={handleSalvarNovoProduto}
                disabled={!formNovo.descricao.trim()}>
                <Check size={16} /> Salvar e Vincular
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
