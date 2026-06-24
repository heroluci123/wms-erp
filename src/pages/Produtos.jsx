import React, { useState, useEffect } from 'react'
import { Plus, Search, Trash2, Edit2, FileDown } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { CurvaBadge } from '../components/shared/Badge'

export function Produtos() {
  const { toastSuccess, toastError, operador } = useAppStore()
  const [produtos, setProdutos] = useState([])
  const [busca, setBusca] = useState('')
  
  // Form State
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ id: null, codigo: '', ean: '', descricao: '', status_curva: 'C', unidade: 'CX', valor_unitario: 0, tipo_produto: 'Materia Prima', grupo: '' })

  const carregar = async () => {
    try {
      const data = await window.wmsAPI.produtos.listar()
      setProdutos(data)
    } catch (err) {
      toastError('Erro', 'Falha ao carregar produtos')
    }
  }

  useEffect(() => { carregar() }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Somente gestores podem alterar produtos.')
    try {
      const payload = {
        ...formData,
        codigo: formData.codigo.trim(),
        ean: formData.ean.trim(),
        valor_unitario: parseFloat(formData.valor_unitario) || 0
      }

      if (!payload.codigo && !payload.ean) {
        return toastError('Atenção', 'É necessário informar pelo menos o Código Interno ou o EAN.')
      }

      if (isEditing) {
        const res = await window.wmsAPI.produtos.atualizar(payload)
        if (res.success) toastSuccess('Sucesso', 'Produto atualizado.')
      } else {
        const res = await window.wmsAPI.produtos.criar(payload)
        if (res.success) toastSuccess('Sucesso', 'Produto cadastrado.')
      }
      resetForm()
      carregar()
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const handleDelete = async (id) => {
    if (operador?.perfil !== 'gestor') return toastError('Acesso Negado', 'Ação restrita a gestores.')
    if (!window.confirm('Tem certeza que deseja excluir este produto?')) return
    try {
      const res = await window.wmsAPI.produtos.deletar(id)
      if (res.success) {
        toastSuccess('Excluído', 'Produto removido com sucesso.')
        carregar()
      } else {
        toastError('Aviso', res.error) // Trata erro de produto com saldo
      }
    } catch (err) {
      toastError('Erro', err.message)
    }
  }

  const editProduto = (p) => {
    setFormData({ ...p, valor_unitario: p.valor_unitario ?? 0 })
    setIsEditing(true)
    document.getElementById('form-produto').scrollIntoView({ behavior: 'smooth' })
  }

  const resetForm = () => {
    setIsEditing(false)
    setFormData({ id: null, codigo: '', ean: '', descricao: '', status_curva: 'C', unidade: 'CX', valor_unitario: 0, tipo_produto: 'Materia Prima', grupo: '' })
  }

  const filtrados = produtos.filter(p => 
    (p.codigo || '').toLowerCase().includes(busca.toLowerCase()) || 
    (p.ean || '').toLowerCase().includes(busca.toLowerCase()) ||
    (p.descricao || '').toLowerCase().includes(busca.toLowerCase())
  )

  const formatarMoeda = (valor) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(valor) || 0)
  }

  const exportarCSV = async () => {
    if (produtos.length === 0) return
    const header = "ID;CODIGO;EAN;DESCRICAO;GRUPO;TIPO;CURVA;UNIDADE;VALOR_UNIT\n"
    const rows = produtos.map(p =>
      `${p.id};${p.codigo || ''};${p.ean || ''};${p.descricao};${p.grupo || ''};${p.tipo_produto};${p.status_curva};${p.unidade};${p.valor_unitario || 0}`
    ).join("\n")
    await window.wmsAPI.export.csv('cadastro_produtos.csv', header + rows)
  }

  return (
    <div>
      <div className="page-header mb-24">
        <div>
          <h1 className="page-header__title">Cadastro de Produtos</h1>
          <p className="page-header__subtitle">Gerenciamento de SKUs, descrições e classificação ABC</p>
        </div>
        <div className="flex gap-8">
          <button className="btn btn--secondary btn--sm" onClick={exportarCSV}>
            <FileDown size={16}/> Exportar CSV
          </button>
        </div>
      </div>

      <div className="form-grid form-grid--2 items-start mb-24">
        <div className="card" id="form-produto">
          <h2 className="table-title mb-16 flex items-center gap-8">
            {isEditing ? <Edit2 size={18}/> : <Plus size={18}/>} 
            {isEditing ? 'Editar Produto' : 'Novo Produto'}
          </h2>
          <form onSubmit={handleSubmit} className="flex-col gap-12">
            <div className="flex gap-12">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Código Interno (SKU)</label>
                <input type="text" className="form-input" value={formData.codigo} onChange={e => setFormData({...formData, codigo: e.target.value.toUpperCase()})} placeholder="Opcional se tiver EAN" disabled={isEditing} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">EAN (Cód. Barras)</label>
                <input type="text" className="form-input" value={formData.ean} onChange={e => setFormData({...formData, ean: e.target.value})} placeholder="Opcional" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Descrição *</label>
              <input type="text" className="form-input" value={formData.descricao} onChange={e => setFormData({...formData, descricao: e.target.value})} required />
            </div>
            <div className="form-group">
              <label className="form-label">Grupo (Ex: Carne Bovina, Frango...)</label>
              <input type="text" list="grupos-list" className="form-input" value={formData.grupo} onChange={e => setFormData({...formData, grupo: e.target.value})} />
              <datalist id="grupos-list">
                <option value="Carne Bovina" />
                <option value="Carne Suína" />
                <option value="Carne de Frango" />
                <option value="Insumos" />
                <option value="Outros" />
              </datalist>
            </div>
            <div className="flex gap-12">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Valor Unitário (R$) *</label>
                <input type="number" step="0.01" className="form-input form-input--number" value={formData.valor_unitario} onChange={e => setFormData({...formData, valor_unitario: parseFloat(e.target.value) || 0})} required />
              </div>
              <div className="form-group" style={{ flex: 1.5 }}>
                <label className="form-label">Tipo de Produto</label>
                <select className="form-input" value={formData.tipo_produto} onChange={e => setFormData({...formData, tipo_produto: e.target.value})}>
                  <option value="Materia Prima">Matéria Prima</option>
                  <option value="Produto Acabado">Produto Acabado</option>
                  <option value="Insumos">Insumos</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Curva ABC</label>
                <select className="form-input" value={formData.status_curva} onChange={e => setFormData({...formData, status_curva: e.target.value})}>
                  <option value="A">Curva A (Alta Rotatividade)</option>
                  <option value="B">Curva B (Média)</option>
                  <option value="C">Curva C (Baixa)</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Unidade Base</label>
                <input type="text" className="form-input" value={formData.unidade} onChange={e => setFormData({...formData, unidade: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-8 mt-8">
              {isEditing && <button type="button" className="btn btn--ghost w-full" onClick={resetForm}>Cancelar</button>}
              <button type="submit" className="btn btn--primary w-full">{isEditing ? 'Salvar Alterações' : 'Cadastrar'}</button>
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
                placeholder="Buscar por código ou descrição..." 
                value={busca} 
                onChange={e => setBusca(e.target.value)} 
              />
            </div>
          </div>
          
          <div className="table-container" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Grupo</th>
                  <th style={{ width: 120 }}>EAN</th>
                  <th style={{ width: 120 }}>Curva</th>
                  <th style={{ textAlign: 'right' }}>Valor Unit.</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(p => (
                  <tr key={p.id}>
                    <td className="td-mono">{p.codigo || '-'}</td>
                    <td className="truncate" style={{ maxWidth: 150 }} title={p.descricao}>{p.descricao}</td>
                    <td>{p.grupo || '-'}</td>
                    <td className="td-mono text-muted">{p.ean || '-'}</td>
                    <td><CurvaBadge curva={p.status_curva} /></td>
                    <td style={{ textAlign: 'right' }} className="text-success font-bold">R$ {parseFloat(p.valor_unitario || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex justify-end gap-4">
                        <button className="btn btn--ghost btn--icon" onClick={() => editProduto(p)}><Edit2 size={14}/></button>
                        <button className="btn btn--ghost btn--icon text-danger" onClick={() => handleDelete(p.id)}><Trash2 size={14}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
