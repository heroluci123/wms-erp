import React, { useState, useEffect } from 'react'
import { MapPin, Search, Plus, Edit2, Trash2, FileDown } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as locaisQueries from '../queries/locais.js';

export function Locais() {
  const { operador, toastSuccess, toastError } = useAppStore()
  const [locais, setLocais] = useState([])
  const [busca, setBusca] = useState('')
  
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ id: null, endereco: '', capacidade_max_caixas: 0, is_insumo: 0 })

  const carregar = async () => {
    try {
      const data = await locaisQueries.listar()
      setLocais(data)
    } catch (err) {
      toastError('Erro', 'Falha ao carregar locais')
    }
  }

  useEffect(() => { carregar() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Ação restrita a gestores.')
    
    try {
      const payload = { ...formData, capacidade_max_caixas: parseFloat(formData.capacidade_max_caixas) || 0 }
      if (isEditing) {
        const res = await locaisQueries.atualizar(payload)
        if (res.success) toastSuccess('Sucesso', 'Local atualizado.')
        else return toastError('Erro', res.error)
      } else {
        const res = await locaisQueries.criar(payload)
        if (res.success) toastSuccess('Sucesso', 'Local cadastrado.')
        else return toastError('Erro', res.error)
      }
      resetForm()
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleDelete = async (id) => {
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Ação restrita a gestores.')
    if (!window.confirm('Tem certeza que deseja desativar este local?')) return
    
    try {
      const res = await locaisQueries.deletar(id)
      if (res.success) {
        toastSuccess('Sucesso', 'Local desativado.')
        carregar()
      } else {
        toastError('Erro', res.error)
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const editLocal = (loc) => {
    setFormData(loc)
    setIsEditing(true)
    document.getElementById('form-local').scrollIntoView({ behavior: 'smooth' })
  }

  const resetForm = () => {
    setIsEditing(false)
    setFormData({ id: null, endereco: '', capacidade_max_caixas: 0, is_insumo: 0 })
  }

  const filtrados = locais.filter(l => l.endereco.toLowerCase().includes(busca.toLowerCase()))

  const exportarCSV = async () => {
    const header = ['Endereço,Tipo,Capacidade Máx (CX)']
    const rows = filtrados.map(l => `${l.endereco},${l.is_insumo === 1 ? 'Insumos' : 'Geral'},${l.capacidade_max_caixas || 0}`)
    const content = [...header, ...rows].join('\n')
    await downloadCSV(content)
  }

  return (
    <div>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title flex items-center gap-12">
            <MapPin size={28} /> Cadastro de Locais
          </h1>
          <p className="page-header__subtitle">Gerenciamento de posições físicas do armazém e capacidade</p>
        </div>
        <button className="btn btn--secondary" onClick={exportarCSV}>
          <FileDown size={16}/> Exportar CSV
        </button>
      </div>

      <div className="form-grid form-grid--2 items-start mb-24">
        <div className="card" id="form-local">
          <h2 className="table-title mb-16 flex items-center gap-8">
            {isEditing ? <Edit2 size={18}/> : <Plus size={18}/>} 
            {isEditing ? 'Editar Local' : 'Novo Local'}
          </h2>
          <form onSubmit={handleSubmit} className="flex-col gap-12">
            <div className="form-group">
              <label className="form-label">Endereço (Identificação Única) *</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Ex: A-01-01" 
                value={formData.endereco} 
                onChange={e => setFormData({...formData, endereco: e.target.value.toUpperCase()})} 
                required 
              />
            </div>
            <div className="form-group">
              <label className="form-label">Capacidade Máxima (Caixas)</label>
              <input 
                type="number" 
                step="0.01" 
                className="form-input form-input--number" 
                placeholder="Ex: 50" 
                value={formData.capacidade_max_caixas} 
                onChange={e => setFormData({...formData, capacidade_max_caixas: e.target.value})} 
              />
              <span className="text-muted text-sm mt-4 inline-block">Deixe 0 para limite infinito.</span>
            </div>
            <div className="form-group flex items-center gap-8 mt-4">
              <input 
                type="checkbox" 
                id="check-insumo"
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                checked={formData.is_insumo === 1}
                onChange={e => setFormData({...formData, is_insumo: e.target.checked ? 1 : 0})}
              />
              <label htmlFor="check-insumo" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>
                Endereço Exclusivo para Insumos
              </label>
            </div>
            <div className="flex gap-8 mt-8">
              {isEditing && <button type="button" className="btn btn--ghost w-full" onClick={resetForm}>Cancelar</button>}
              <button type="submit" className="btn btn--primary w-full">{isEditing ? 'Salvar' : 'Cadastrar'}</button>
            </div>
          </form>
        </div>

        <div>
          <div className="form-group mb-16">
            <div className="flex items-center gap-8 bg-bg-2 border border-border rounded-lg px-12 py-8">
              <Search size={18} className="text-muted" />
              <input 
                type="text" 
                className="bg-transparent border-none text-primary w-full outline-none font-sans" 
                placeholder="Buscar por endereço..." 
                value={busca} 
                onChange={e => setBusca(e.target.value)} 
              />
            </div>
          </div>
          
          <div className="table-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th>Endereço</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Capacidade Máx (CX)</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr><td colSpan="3" className="text-center py-24 text-muted">Nenhum local encontrado.</td></tr>
                ) : (
                  filtrados.map(l => (
                    <tr key={l.id}>
                      <td className="font-mono text-cyan font-bold">{l.endereco}</td>
                      <td>
                        {l.is_insumo === 1 
                          ? <span className="badge" style={{ backgroundColor: 'var(--warning-muted)', color: 'var(--warning)' }}>Insumos</span>
                          : <span className="badge" style={{ backgroundColor: 'var(--bg-card)' }}>Geral</span>
                        }
                      </td>
                      <td style={{ textAlign: 'right' }}>{l.capacidade_max_caixas > 0 ? l.capacidade_max_caixas : <span className="text-muted">Sem limite</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-end gap-4">
                          <button className="btn btn--ghost btn--icon" onClick={() => editLocal(l)}><Edit2 size={14}/></button>
                          <button className="btn btn--ghost btn--icon text-danger" onClick={() => handleDelete(l.id)}><Trash2 size={14}/></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
