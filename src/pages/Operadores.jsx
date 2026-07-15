import React, { useState, useEffect } from 'react'
import { Users, Plus, Edit2, Trash2 } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as operadoresQueries from '../queries/operadores.js';

export function Operadores() {
  const { operador, toastSuccess, toastError } = useAppStore()
  const [operadores, setOperadores] = useState([])
  
  const [isEditing, setIsEditing] = useState(false)
  const [alterandoSenha, setAlterandoSenha] = useState(false)
  const [formData, setFormData] = useState({ 
    id: null, 
    nome: '', 
    pin: '', 
    perfil: 'operador', 
    is_adm: 0,
    ativo: 1,
    permissoes: {
      recebimento: false,
      movimentacao: false,
      saida: false,
      expedicao: false,
      inventario_coletor: false,
      inventario_gestao: false,
      produtos: false,
      locais: false,
      operadores: false,
      dashboard_executivo: false,
      estoque_enderecos: false,
      inventario_carga_inicial: false,
      deletar_historico: false,
      consulta_endereco: false,
      rastreabilidade: false,
      retorno_producao: false,
      desmembramento: false,
      consulta_estoque: false
    }
  })

  const carregar = async () => {
    try {
      const data = await operadoresQueries.listar()
      setOperadores(data)
    } catch (err) {
      toastError('Erro', 'Falha ao carregar operadores')
    }
  }

  useEffect(() => { carregar() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Ação restrita a gestores.')
    
    // Validar PIN
    if (!/^\d{4}$/.test(formData.pin)) {
      return toastError('Aviso', 'O PIN deve conter exatamente 4 números.')
    }

    try {
      if (isEditing) {
        const res = await operadoresQueries.atualizar(formData)
        if (res.success) toastSuccess('Sucesso', 'Operador atualizado.')
        else return toastError('Erro', res.error)
      } else {
        const res = await operadoresQueries.criar(formData)
        if (res.success) toastSuccess('Sucesso', 'Operador cadastrado.')
        else return toastError('Erro', res.error)
      }
      resetForm()
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleDesativar = async (id) => {
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Ação restrita a gestores.')
    if (id === operador.id) return toastError('Aviso', 'Você não pode desativar o próprio usuário enquanto logado.')
    if (!window.confirm('Tem certeza que deseja desativar este operador?')) return
    
    try {
      const res = await operadoresQueries.desativar(id)
      if (res.success) {
        toastSuccess('Sucesso', 'Operador desativado.')
        carregar()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const editOperador = (op) => {
    // Garantir que as permissões existam no objeto editado
    const permissoesObj = typeof op.permissoes === 'object' ? op.permissoes : {}
    setFormData({ 
      ...op, 
      pin: op.pin || '',
      permissoes: {
        recebimento: !!permissoesObj.recebimento,
        movimentacao: !!permissoesObj.movimentacao,
        saida: !!permissoesObj.saida,
        expedicao: !!permissoesObj.expedicao,
        inventario_coletor: !!permissoesObj.inventario_coletor,
        inventario_gestao: !!permissoesObj.inventario_gestao,
        produtos: !!permissoesObj.produtos,
        locais: !!permissoesObj.locais,
        operadores: !!permissoesObj.operadores,
        dashboard_executivo: !!permissoesObj.dashboard_executivo,
        inventario_carga_inicial: !!permissoesObj.inventario_carga_inicial,
        deletar_historico: !!permissoesObj.deletar_historico,
        consulta_endereco: !!permissoesObj.consulta_endereco,
        rastreabilidade: !!permissoesObj.rastreabilidade,
        retorno_producao: !!permissoesObj.retorno_producao,
        desmembramento: !!permissoesObj.desmembramento,
        consulta_estoque: !!permissoesObj.consulta_estoque
      }
    })
    setIsEditing(true)
    document.getElementById('form-operador').scrollIntoView({ behavior: 'smooth' })
  }

  const resetForm = () => {
    setIsEditing(false)
    setFormData({ 
      id: null, 
      nome: '', 
      pin: '', 
      perfil: 'operador', 
      is_adm: 0,
      ativo: 1,
      permissoes: {
        recebimento: false,
        movimentacao: false,
        saida: false,
        expedicao: false,
        inventario_coletor: false,
        inventario_gestao: false,
        produtos: false,
        locais: false,
        operadores: false,
        dashboard_executivo: false,
        inventario_carga_inicial: false,
        deletar_historico: false,
        consulta_endereco: false,
        rastreabilidade: false,
        retorno_producao: false,
        desmembramento: false,
        consulta_estoque: false
      }
    })
    setAlterandoSenha(false)
  }

  const togglePermissao = (key) => {
    setFormData(prev => ({
      ...prev,
      permissoes: {
        ...prev.permissoes,
        [key]: !prev.permissoes[key]
      }
    }))
  }

  return (
    <div>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <Users size={28} /> Operadores e Permissões
          </h1>
          <p className="page-header__subtitle">Gerenciamento de usuários e controle de acesso (PIN)</p>
        </div>
      </div>

      <div className="form-grid form-grid--2 items-start mb-24">
        <div className="card" id="form-operador">
          <h2 className="table-title mb-16 flex items-center gap-8">
            {isEditing ? <Edit2 size={18}/> : <Plus size={18}/>} 
            {isEditing ? 'Editar Operador' : 'Novo Operador'}
          </h2>
          <form onSubmit={handleSubmit} className="flex-col gap-12">
            <div className="form-group">
              <label className="form-label">Nome Completo *</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.nome} 
                onChange={e => setFormData({...formData, nome: e.target.value})} 
                required 
              />
            </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">PIN (4 Dígitos) *</label>
                {isEditing && !alterandoSenha ? (
                  <div className="flex items-center gap-12" style={{ height: 42 }}>
                    <span className="font-mono text-lg tracking-widest bg-bg-2 px-12 py-4 rounded border border-border">{formData.pin || '****'}</span>
                    <button 
                      type="button" 
                      className="btn btn--outline btn--sm" 
                      onClick={() => {
                        setAlterandoSenha(true)
                        setFormData({...formData, pin: ''})
                      }}
                    >
                      Alterar Senha
                    </button>
                  </div>
                ) : (
                  <input 
                    type="password" 
                    className="form-input" 
                    maxLength={4}
                    placeholder="Ex: 1234"
                    value={formData.pin} 
                    onChange={e => setFormData({...formData, pin: e.target.value.replace(/\D/g, '')})} 
                    required 
                  />
                )}
              </div>
            
            <div className="form-group mt-8 flex items-center gap-8">
              <label className="form-label" style={{ marginBottom: 0 }}>Super Administrador?</label>
              <input 
                type="checkbox" 
                checked={formData.is_adm === 1}
                onChange={e => setFormData({...formData, is_adm: e.target.checked ? 1 : 0})}
              />
              <span className="text-xs text-muted">(Ignora permissões, tem acesso a tudo incluindo Carga Inicial)</span>
            </div>
            <div className="form-group mt-16">
              <label className="form-label mb-8">Permissões de Acesso</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: 'var(--bg-secondary)', padding: 16, borderRadius: 8 }}>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.recebimento} onChange={() => togglePermissao('recebimento')} />
                  Recebimento (REC)
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.movimentacao} onChange={() => togglePermissao('movimentacao')} />
                  Movimentação Interna
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.saida} onChange={() => togglePermissao('saida')} />
                  Saída de Materiais
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.expedicao} onChange={() => togglePermissao('expedicao')} />
                  Área de Expedição
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm text-warning">
                  <input type="checkbox" checked={formData.permissoes.inventario_coletor} onChange={() => togglePermissao('inventario_coletor')} />
                  Inventário (Coletor)
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm text-warning">
                  <input type="checkbox" checked={formData.permissoes.inventario_gestao} onChange={() => togglePermissao('inventario_gestao')} />
                  Inventário (Gestão Completa)
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm" style={{ color: 'var(--orange, #f97316)' }}>
                  <input type="checkbox" checked={formData.permissoes.inventario_carga_inicial} onChange={() => togglePermissao('inventario_carga_inicial')} disabled={formData.is_adm === 1} />
                  Inventário (Carga Inicial)
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.produtos} onChange={() => togglePermissao('produtos')} />
                  Cadastro de Produtos
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.consulta_estoque} onChange={() => togglePermissao('consulta_estoque')} />
                  Consulta de Estoque (Geral)
                </label>
                <label className="flex items-center gap-8 cursor-pointer p-8 hover:bg-bg-card rounded-md">
                  <input type="checkbox" checked={formData.permissoes.dashboard_executivo} onChange={() => togglePermissao('dashboard_executivo')} />
                  <span className="text-sm">Painel Executivo</span>
                </label>
                <label className="flex items-center gap-8 cursor-pointer p-8 hover:bg-bg-card rounded-md">
                  <input type="checkbox" checked={formData.permissoes.estoque_enderecos} onChange={() => togglePermissao('estoque_enderecos')} />
                  <span className="text-sm">Estoque por Endereço (Tabela)</span>
                </label>
                <label className="flex items-center gap-8 cursor-pointer p-8 hover:bg-bg-card rounded-md">
                  <input type="checkbox" checked={formData.permissoes.deletar_historico} onChange={() => togglePermissao('deletar_historico')} />
                  <span className="text-sm">Ajuste de Histórico (Deletar Logs)</span>
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm text-danger">
                  <input type="checkbox" checked={formData.permissoes.locais} onChange={() => togglePermissao('locais')} />
                  Cadastro de Locais
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm text-danger">
                  <input type="checkbox" checked={formData.permissoes.operadores} onChange={() => togglePermissao('operadores')} />
                  Operadores e Permissões
                </label>

                {/* ── Coletor: módulos extras ─────────────────────── */}
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' }}>Módulos Coletor</span>
                </div>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.consulta_endereco} onChange={() => togglePermissao('consulta_endereco')} />
                  Consulta de Endereço
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.rastreabilidade} onChange={() => togglePermissao('rastreabilidade')} />
                  Rastreabilidade de Caixa
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.retorno_producao} onChange={() => togglePermissao('retorno_producao')} />
                  Retorno de Produção
                </label>
                <label className="flex items-center gap-8 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.permissoes.desmembramento} onChange={() => togglePermissao('desmembramento')} />
                  Desmembramento
                </label>
              </div>
              <p className="text-xs text-muted mt-8">* Dashboard e Mapa de Capacidade estão sempre disponíveis para todos.</p>
            </div>
            
            {isEditing && (
              <div className="form-group mt-8">
                <label className="form-label">Status</label>
                <select 
                  className="form-input"
                  value={formData.ativo}
                  onChange={e => setFormData({...formData, ativo: parseInt(e.target.value)})}
                >
                  <option value={1}>Ativo</option>
                  <option value={0}>Inativo</option>
                </select>
              </div>
            )}

            <div className="flex gap-8 mt-16">
              {isEditing && <button type="button" className="btn btn--ghost w-full" onClick={resetForm}>Cancelar</button>}
              <button type="submit" className="btn btn--primary w-full">{isEditing ? 'Salvar Alterações' : 'Cadastrar Operador'}</button>
            </div>
          </form>
        </div>

        <div className="card card--elevated">
          <h2 className="table-title mb-16">Operadores Cadastrados</h2>
          <div className="table-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th>Nome</th>
                  <th>Permissões</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {operadores.map(op => {
                  const perms = typeof op.permissoes === 'object' ? op.permissoes : {}
                  const totalPerms = Object.values(perms).filter(Boolean).length
                  const isGestorTotal = totalPerms === 10
                  return (
                  <tr key={op.id}>
                    <td className="font-bold">{op.nome} {op.id === operador.id ? '(Você)' : ''}</td>
                    <td>
                      {isGestorTotal ? (
                        <span className="text-success font-bold" style={{ fontSize: 12 }}>Acesso Total</span>
                      ) : totalPerms === 0 ? (
                        <span className="text-muted" style={{ fontSize: 12 }}>Sem Acessos</span>
                      ) : (
                        <span className="text-warning font-bold" style={{ fontSize: 12 }}>{totalPerms} Acesso{totalPerms > 1 ? 's' : ''}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {op.ativo ? (
                        <span className="badge badge--success">Ativo</span>
                      ) : (
                        <span className="badge badge--danger">Inativo</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-4">
                        <button className="btn btn--ghost btn--icon" onClick={() => editOperador(op)} title="Editar"><Edit2 size={14}/></button>
                        {op.ativo === 1 && op.id !== operador.id && (
                          <button className="btn btn--ghost btn--icon text-danger" onClick={() => handleDesativar(op.id)} title="Desativar"><Trash2 size={14}/></button>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
