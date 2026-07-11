import React, { useState, useEffect } from 'react'
import { MapPin, Box, CheckCircle2, AlertCircle, Plus, X, Package, Settings } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as inventariosQueries from '../queries/inventarios.js';
import * as locaisQueries from '../queries/locais.js';
import * as produtosQueries from '../queries/produtos.js';
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx'

export function InventarioOperador() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  
  const [inventarios, setInventarios] = useState([])
  const [inventarioAtivo, setInventarioAtivo] = useState(null)
  
  // Lista global de pendentes do inventário
  const [pendentesGlobais, setPendentesGlobais] = useState([])
  
  // Estado do endereço atual
  const [enderecoAtual, setEnderecoAtual] = useState('')
  const [itensDoEndereco, setItensDoEndereco] = useState([])
  
  // Contagens locais (em memória) antes de finalizar o endereço
  const [contagemLocal, setContagemLocal] = useState([]) // { item_id, codigo, descricao, caixas, kg }

  // Estado do item atual sendo contado
  const [itemAtual, setItemAtual] = useState(null)

  const [step, setStep] = useState(1) // 1: Bipar Endereco, 2: Bipar Produto, 3: Informar Qtd
  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [qtdValidade, setQtdValidade] = useState('')

  // Modal de cadastro rápido (CargaInicial)
  const [modalCadastro, setModalCadastro] = useState(null) // { ean }
  const [formCadastro, setFormCadastro] = useState({ descricao: '', tipo_produto: 'Materia Prima', status_curva: 'C', valor_unitario: '', grupo: '', produtoVinculado: null })
  const [salvandoCadastro, setSalvandoCadastro] = useState(false)
  const [produtosSemEan, setProdutosSemEan] = useState([])

  // Modal de vinculação rápida de EAN (todos os tipos de inventário)
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  // SSCC: dados pré-preenchidos da caixa quando EAN já está cadastrado
  const [ssccDadosCaixa, setSsccDadosCaixa] = useState(null)       // { peso_kg, validade, ean_caixa }
  const [ssccModoConfirmacao, setSsccModoConfirmacao] = useState(false) // true = mostrar confirm, false = editar

  // 1. Carregar inventários
  const carregar = async () => {
    try {
      const all = await inventariosQueries.listar()
      const emContagem = all.filter(i => i.status === 'Em Contagem' || i.status === 'Aberto')
      setInventarios(emContagem)
    } catch (e) {
      toastError('Erro', 'Falha ao buscar inventários')
    }
  }

  useEffect(() => { carregar() }, [])

  // 2. Selecionar inventário e agrupar
  const selecionarInventario = async (inv) => {
    try {
      const isCarga = inv.tipo === 'CargaInicial'
      const itens = await inventariosQueries.listarItens(inv.id)
      const pesoStatus = { 'Pendente': 1, '2ª Contagem': 2, '3ª Contagem': 3 }
      const pendentes = itens
        .filter(i => ['Pendente', '2ª Contagem', '3ª Contagem'].includes(i.status_item))
        .sort((a, b) => pesoStatus[a.status_item] - pesoStatus[b.status_item])
      
      if (!isCarga && pendentes.length === 0) {
        toastWarning('Aviso', 'Este inventário não tem itens pendentes.')
        return
      }

      setInventarioAtivo(inv)
      if (isCarga) {
        setPendentesGlobais([])
        setEnderecoAtual('')
        setItensDoEndereco([])
        setContagemLocal([])
        setStep(1)
        setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
      } else {
        atualizarFila(pendentes)
      }
    } catch (e) {
      toastError('Erro', 'Falha ao carregar itens')
    }
  }

  // Atualiza a fila global e define o próximo endereço (apenas para inventários normais)
  const atualizarFila = (pendentes) => {
    setPendentesGlobais(pendentes)
    if (pendentes.length > 0) {
      const proximoEndereco = pendentes[0].endereco
      setEnderecoAtual(proximoEndereco)
      setItensDoEndereco(pendentes.filter(i => i.endereco === proximoEndereco))
      setContagemLocal([])
      setStep(1)
      setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
    } else {
      toastSuccess('Inventário Concluído', 'Todos os endereços foram contados.')
      setInventarioAtivo(null)
      carregar()
    }
  }

  // Volta para a etapa de bipar produto (mantendo no mesmo endereço)
  const voltarParaProduto = () => {
    setItemAtual(null)
    setQtdCaixas('')
    setQtdKg('')
    setQtdValidade('')
    setSsccDadosCaixa(null)
    setSsccModoConfirmacao(false)
    setStep(2)
    setTimeout(() => document.getElementById('inv-produto')?.focus(), 100)
  }

  // Scanners
  const scanEndereco = async (val) => {
    if (!val || val.trim() === '') return
    const isCarga = inventarioAtivo?.tipo === 'CargaInicial'
    const addr = val.toUpperCase().trim()

    if (isCarga) {
      try {
        const locais = await locaisQueries.listar()
        if (!locais.find(l => l.endereco.toUpperCase() === addr)) {
          return toastError('Endereço Inválido', 'Este endereço não existe no sistema. Cadastre-o primeiro na aba Locais.')
        }
        setEnderecoAtual(addr)
        setItensDoEndereco([])
        setContagemLocal([])
        setStep(2)
        setTimeout(() => document.getElementById('inv-produto')?.focus(), 100)
      } catch (err) {
        toastError('Erro', 'Falha ao validar endereço')
      }
      return
    }

    if (addr !== enderecoAtual) {
      return toastError('Endereço Incorreto', `Vá para o endereço: ${enderecoAtual}`)
    }
    setStep(2)
    setTimeout(() => document.getElementById('inv-produto')?.focus(), 100)
  }

  const scanProduto = async (val) => {
    if (!val || val.trim() === '') return

    try {
      const resultado = await produtosQueries.buscarPorCodigoComInfo(val)
      if (!resultado) {
        const isCarga = inventarioAtivo?.tipo === 'CargaInicial'
        if (isCarga) {
          const prods = await produtosQueries.listar()
          setProdutosSemEan(prods.filter(p => !p.ean))
          setModalCadastro({ ean: val.trim() })
          setFormCadastro({ descricao: '', tipo_produto: 'Materia Prima', status_curva: 'C', valor_unitario: '', grupo: '', produtoVinculado: null })
        } else {
          setEanDesconhecido(val.trim())
          setModalEanOpen(true)
        }
        return
      }
      
      const { produto, eanUnico } = resultado

      if (val.trim() === produto.codigo) {
        return toastError('Código Inválido', 'Não é permitido usar o código interno do produto no inventário. Bipe a etiqueta da caixa!')
      }

      let caixaSSCC = null
      if (val.trim().length >= 8) {
        try {
          const { db } = await import('../lib/db.js')
          const res = await db.execute({
            sql: `SELECT peso_kg, validade, ean_caixa FROM estoque_caixas WHERE ean_caixa = ? AND status = 'DISPONIVEL' LIMIT 1`,
            args: [val.trim()]
          })
          if (res.rows.length > 0) caixaSSCC = res.rows[0]
        } catch (_) {}
      }

      setSsccDadosCaixa(caixaSSCC)

      if (caixaSSCC) {
        setQtdCaixas('1')
        setQtdKg(String(caixaSSCC.peso_kg))
        setQtdValidade(caixaSSCC.validade || '')
        setSsccModoConfirmacao(true)
      } else {
        setQtdCaixas('1')
        setQtdKg('')
        setQtdValidade('')
        setSsccModoConfirmacao(false)
      }

      setItemAtual({
        id: null,
        produto_id: produto.id,
        endereco: enderecoAtual,
        codigo: val.trim(),
        descricao: produto.descricao,
        status_curva: produto.status_curva,
        tipo_produto: produto.tipo_produto,
        grupo: produto.grupo,
        status_item: 'Pendente'
      })
      setStep(3)
      if (!caixaSSCC) setTimeout(() => document.getElementById('inv-validade')?.focus(), 100)
    } catch (err) {
      return toastError('Erro', err.message)
    }
  }

  // Salvar cadastro rápido do modal
  const salvarCadastroRapido = async (e) => {
    e.preventDefault()
    if (!formCadastro.descricao.trim()) return toastError('Atenção', 'A descrição do produto é obrigatória.')
    setSalvandoCadastro(true)
    try {
      let res;
      if (formCadastro.produtoVinculado) {
        // Atualiza o produto existente com o novo EAN e os campos da tela
        res = await produtosQueries.atualizar({
          ...formCadastro.produtoVinculado,
          ean: modalCadastro.isEdicao ? formCadastro.produtoVinculado.ean : modalCadastro.ean,
          descricao: formCadastro.descricao.trim(),
          tipo_produto: formCadastro.tipo_produto,
          status_curva: formCadastro.status_curva || 'C',
          grupo: formCadastro.grupo || '',
          valor_unitario: parseFloat(formCadastro.valor_unitario) || 0
        })
      } else {
        res = await produtosQueries.criar({
          ean: modalCadastro.ean,
          codigo: '',
          descricao: formCadastro.descricao.trim(),
          tipo_produto: formCadastro.tipo_produto,
          status_curva: formCadastro.status_curva || 'C',
          grupo: formCadastro.grupo || '',
          unidade: 'CX',
          valor_unitario: parseFloat(formCadastro.valor_unitario) || 0
        })
      }

      if (!res.success) {
        return toastError('Erro ao Salvar', res.error)
      }
      toastSuccess('Produto Salvo!', `${formCadastro.descricao} atualizado no sistema.`)
      const eanBipado = modalCadastro.ean
      setModalCadastro(null)
      // Busca o produto recém criado e preenche o item
      const p = await produtosQueries.buscarPorCodigo(eanBipado)
      if (p) {
        setItemAtual({
          id: null,
          produto_id: p.id,
          endereco: enderecoAtual,
          codigo: p.codigo || p.ean,
          descricao: p.descricao,
          status_curva: p.status_curva,
          tipo_produto: p.tipo_produto,
          grupo: p.grupo,
          status_item: 'Pendente'
        })
        setStep(3)
        setTimeout(() => document.getElementById('inv-validade')?.focus(), 100)
      }
    } catch (err) {
      toastError('Erro', err.message)
    } finally {
      setSalvandoCadastro(false)
    }
  }

  const abrirModalEdicaoProduto = async () => {
    try {
      const p = await produtosQueries.buscarPorCodigo(itemAtual.codigo)
      if (p) {
        setFormCadastro({
          descricao: p.descricao,
          tipo_produto: p.tipo_produto || 'Materia Prima',
          status_curva: p.status_curva || 'C',
          grupo: p.grupo || '',
          valor_unitario: p.valor_unitario || '',
          produtoVinculado: p
        })
        setModalCadastro({ ean: p.ean || p.codigo, isEdicao: true })
      }
    } catch (e) {
      toastError('Erro', 'Não foi possível carregar os dados do produto.')
    }
  }

  const submitContagem = async (e) => {
    e.preventDefault()
    if (qtdCaixas === '' || qtdKg === '' || qtdValidade === '') return
    
    const cx = parseFloat(qtdCaixas)
    const kg = parseFloat(qtdKg)
    const val = qtdValidade
    
    // Chave de acúmulo é código + validade (mesmo produto, validades diferentes = registros diferentes)
    const chave = `${itemAtual.codigo}__${val}`
    
    // Verifica se já bipamos esse código+validade nesta sessão
    const jaExiste = contagemLocal.find(c => c.chave === chave)
    
    if (jaExiste) {
      if (itemAtual.codigo.length >= 8) {
        toastError('Erro', 'Este código SSCC já foi bipado neste endereço!')
        return
      }
      setContagemLocal(prev => prev.map(c => c.chave === chave ? { ...c, caixas: c.caixas + cx, kg: c.kg + kg } : c))
      toastSuccess('Somado', `Volume adicionado à contagem de ${itemAtual.codigo} (Val: ${val}).`)
      voltarParaProduto()
      return
    }
    
    const valNorm = val ? val.toString().substring(0, 10) : null
    
    // Na nova lógica caixa-por-caixa, procuramos pelo ean_caixa nos itens pendentes do endereço
    const itemMatch = itensDoEndereco.find(i => i.ean_caixa === itemAtual.codigo)
    
    let item_id
    if (itemMatch) {
      item_id = itemMatch.id
    } else {
      // Bug fix (2ª Contagem): Antes de criar item surpresa, verificar se essa caixa
      // já existe neste inventário/endereço com status OK (da 1ª contagem).
      // Se sim, ela não é surpresa — foi apenas bipada de novo na recontagem. Ignorar.
      try {
        const { db } = await import('../lib/db.js')
        const { rows: jaContada } = await db.execute({
          sql: `SELECT id FROM inventario_itens WHERE inventario_id = ? AND endereco = ? AND ean_caixa = ? AND status_item = 'OK' LIMIT 1`,
          args: [inventarioAtivo.id, enderecoAtual, itemAtual.codigo]
        })
        if (jaContada.length > 0) {
          toastSuccess('Confirmado ✓', `Caixa ${itemAtual.codigo} já confirmada (OK na 1ª contagem).`)
          voltarParaProduto()
          return
        }
      } catch (_) {}

      // Se realmente não existe: é um item surpresa (nova caixa não prevista)
      const res = await inventariosQueries.adicionarItemSurpresa({
        inventario_id: inventarioAtivo.id,
        endereco: enderecoAtual,
        produto_id: itemAtual.produto_id,
        validade: val,
        ean_caixa: itemAtual.codigo
      })
      if (!res.success) return toastError('Erro', res.error)
      item_id = res.item_id
      setItensDoEndereco(prev => [...prev, { ...itemAtual, id: item_id, validade: val }])
    }
    
    setContagemLocal(prev => [...prev, {
      chave,
      item_id,
      produto_id: itemAtual.produto_id,
      codigo: itemAtual.codigo,
      descricao: itemAtual.descricao,
      validade: val,
      caixas: cx,
      kg: kg
    }])

    toastSuccess('Registrado', 'Volume salvo. Finalize o endereço para enviar.')
    voltarParaProduto()
  }


  const finalizarEndereco = async () => {
    if (inventarioAtivo?.tipo === 'CargaInicial' && contagemLocal.length === 0) {
      return toastWarning('Atenção', 'Nenhum item foi bipado neste endereço.')
    }
    try {
      const groupedCounted = []
      contagemLocal.forEach(c => {
        const existing = groupedCounted.find(g => g.item_id === c.item_id)
        if (existing) {
          existing.caixas += c.caixas
          existing.kg += c.kg
        } else {
          groupedCounted.push({
            item_id: c.item_id,
            caixas: c.caixas,
            kg: c.kg,
            validade: c.validade
          })
        }
      })

      const countedIds = groupedCounted.map(c => c.item_id)
      const uncounted = itensDoEndereco
        .filter(i => !countedIds.includes(i.id))
        .map(i => ({
          item_id: i.id,
          caixas: 0,
          kg: 0,
          validade: i.validade_contada || i.validade
        }))

      const todosParaEnviar = [...groupedCounted, ...uncounted]

      await Promise.all(
        todosParaEnviar.map(c => inventariosQueries.registrarContagem({
          item_id: c.item_id,
          qtd_contada_caixas: c.caixas,
          qtd_contada_kg: c.kg,
          validade_informada: c.validade
        }))
      )

      toastSuccess('Endereço Finalizado', `${enderecoAtual} registrado. Bipe o próximo endereço.`)
      
      setContagemLocal([])
      setEnderecoAtual('')
      setItensDoEndereco([])

      // Sempre registrar a caixa no estoque_caixas se for SSCC (EAN >= 8)
      // para que a visão serializada mostre o EAN certinho!
      const caixasSSCC = contagemLocal
        .filter(c => c.codigo && c.codigo.length >= 8)
        .map(c => ({
          ean_caixa: c.codigo,
          produto_id: c.produto_id,
          endereco: enderecoAtual,
          validade: c.validade,
          peso_kg: c.kg / (c.caixas || 1) // peso médio caso tenha mais de 1 (embora ean unico seja sempre 1)
        }))

      if (caixasSSCC.length > 0) {
        const { estoqueQueries } = await import('../queries/estoque.js')
        await estoqueQueries.inserirCaixasCargaInicial(caixasSSCC)
      }

      const isCarga = inventarioAtivo?.tipo === 'CargaInicial'
      if (isCarga) {
        // Na carga inicial volta para o step 1 para bipar novo endereço
        setStep(1)
        setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
      } else {
        const itens = await inventariosQueries.listarItens(inventarioAtivo.id)
        const pesoStatus = { 'Pendente': 1, '2ª Contagem': 2, '3ª Contagem': 3 }
        const pendentes = itens
          .filter(i => ['Pendente', '2ª Contagem', '3ª Contagem'].includes(i.status_item))
          .sort((a, b) => pesoStatus[a.status_item] - pesoStatus[b.status_item])
        atualizarFila(pendentes)
      }
    } catch(e) {
      toastError('Erro', 'Falha ao finalizar endereço.')
    }
  }

  if (!inventarioAtivo) {
    return (
      <div style={{ maxWidth: 600 }}>
        <h1 className="page-header__title mb-24">Selecione um Inventário</h1>
        {inventarios.length === 0 ? (
          <div className="card text-center text-muted">Nenhum inventário aberto no momento.</div>
        ) : (
          <div className="flex-col gap-12">
            {inventarios.map(inv => (
              <div key={inv.id} className="card card--elevated cursor-pointer" onClick={() => selecionarInventario(inv)}
                style={{ borderLeft: inv.tipo === 'CargaInicial' ? '4px solid var(--warning)' : '4px solid var(--primary)', cursor: 'pointer' }}>
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-primary font-bold mb-4">
                      {inv.tipo === 'CargaInicial' ? '🏭 Carga Inicial' : `Inventário #${inv.id}`}
                    </h3>
                    <div className="text-sm text-muted">
                      {inv.tipo === 'CargaInicial'
                        ? 'Carga Inicial do Sistema — Bipe endereços livremente'
                        : `Filtro: ${inv.tipo_filtro} - ${inv.identificador_filtro}`}
                    </div>
                  </div>
                  <div className="text-right">
                    {inv.tipo === 'CargaInicial' ? (
                      <div className="text-warning font-bold text-sm">INICIAR →</div>
                    ) : (
                      <div className="text-warning font-bold text-lg">{inv.pendentes || 0} pendentes</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const jaBipado = itemAtual ? contagemLocal.find(c => c.codigo === itemAtual.codigo) : null
  const isCargaAtiva = inventarioAtivo?.tipo === 'CargaInicial'

  const sugestoesDescricao = formCadastro.produtoVinculado ? [] : produtosSemEan.filter(p => formCadastro.descricao.length >= 2 && p.descricao.toLowerCase().includes(formCadastro.descricao.toLowerCase())).slice(0, 5)

  return (
    <div style={{ maxWidth: 600, position: 'relative' }}>

      {/* ── MODAL DE CADASTRO RÁPIDO ──────────────────────────────────────────── */}
      {modalCadastro && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 24, width: '100%', maxWidth: 440,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
          }}>
            <div className="flex justify-between items-center mb-16">
              <div className="flex items-center gap-8">
                <Package size={20} style={{ color: 'var(--warning)' }} />
                <h3 style={{ fontWeight: 800, fontSize: 16, color: 'var(--warning)' }}>
                  {modalCadastro.isEdicao ? 'Editar Produto' : 'Produto Não Cadastrado'}
                </h3>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => setModalCadastro(null)}><X size={16}/></button>
            </div>

            <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
              <div className="text-xs text-muted mb-2">EAN / Código Bipado</div>
              <div className="font-mono font-bold text-primary" style={{ fontSize: 18 }}>{modalCadastro.ean}</div>
            </div>

            <form onSubmit={salvarCadastroRapido} className="flex-col gap-12">
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">Descrição do Produto *</label>
                {formCadastro.produtoVinculado ? (
                  <div className="form-input flex items-center justify-between" style={{ height: 'auto', minHeight: 42, padding: '8px 12px' }}>
                    <div style={{ flex: 1 }}>
                      <div className="font-bold">{formCadastro.produtoVinculado.descricao}</div>
                      {!modalCadastro.isEdicao && <div className="text-xs text-muted" style={{ marginTop: 2 }}>Vincular EAN a este produto</div>}
                    </div>
                    {!modalCadastro.isEdicao && (
                      <button type="button" className="btn btn--ghost btn--sm" style={{ padding: 4, height: 'auto' }} onClick={() => setFormCadastro(prev => ({...prev, produtoVinculado: null, descricao: ''}))} title="Remover Vínculo"><X size={16}/></button>
                    )}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: COXAO MOLE (T7)"
                      autoFocus
                      value={formCadastro.descricao}
                      onChange={e => setFormCadastro(prev => ({ ...prev, descricao: e.target.value }))}
                      required
                    />
                    {sugestoesDescricao.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                        background: '#1a1d2e', border: '1px solid var(--border)', borderRadius: 8,
                        marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.8)', overflow: 'hidden'
                      }}>
                        {sugestoesDescricao.map(p => (
                          <div key={p.id} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                            className="hover:bg-bg-2 flex justify-between items-center"
                            onClick={() => {
                              setFormCadastro(prev => ({
                                ...prev,
                                produtoVinculado: p,
                                descricao: p.descricao,
                                tipo_produto: p.tipo_produto || 'Materia Prima',
                                status_curva: p.status_curva || 'C',
                                grupo: p.grupo || '',
                                valor_unitario: p.valor_unitario || ''
                              }))
                            }}>
                            <span className="font-bold">{p.descricao}</span>
                            <span className="text-muted text-xs">Cód: {p.codigo || 'Sem cód.'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-12">
                <div className="form-group" style={{ flex: 1.5 }}>
                  <label className="form-label">Tipo de Produto</label>
                  <select className="form-input" value={formCadastro.tipo_produto}
                    onChange={e => setFormCadastro(prev => ({ ...prev, tipo_produto: e.target.value }))}>
                    <option value="Materia Prima">Matéria Prima</option>
                    <option value="Produto Acabado">Produto Acabado</option>
                    <option value="Insumos">Insumos</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Curva ABC</label>
                  <select className="form-input" value={formCadastro.status_curva}
                    onChange={e => setFormCadastro(prev => ({ ...prev, status_curva: e.target.value }))}>
                    <option value="A">Curva A</option>
                    <option value="B">Curva B</option>
                    <option value="C">Curva C</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Valor (R$)</label>
                  <input
                    type="number" step="0.01"
                    className="form-input form-input--number"
                    placeholder="Opcional"
                    value={formCadastro.valor_unitario}
                    onChange={e => setFormCadastro(prev => ({ ...prev, valor_unitario: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Grupo</label>
                <select className="form-input" value={formCadastro.grupo} onChange={e => setFormCadastro(prev => ({ ...prev, grupo: e.target.value }))}>
                  <option value="">Selecione um Grupo...</option>
                  <option value="Carne Bovina">Carne Bovina</option>
                  <option value="Carne Suína">Carne Suína</option>
                  <option value="Carne de Frango">Carne de Frango</option>
                  <option value="Insumos">Insumos</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
              <div className="flex gap-8 mt-8">
                <button type="submit" className="btn btn--warning w-full" disabled={salvandoCadastro}>
                  <Plus size={16}/> {salvandoCadastro ? 'Salvando...' : (modalCadastro.isEdicao ? 'Salvar Alterações' : (formCadastro.produtoVinculado ? 'Vincular EAN e Salvar' : 'Cadastrar e Continuar'))}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setModalCadastro(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title">
            {isCargaAtiva ? '🏭 Carga Inicial' : 'Contagem por Endereço'}
          </h1>
          <p className="page-header__subtitle">
            {isCargaAtiva
              ? `Inventário #${inventarioAtivo.id} | ${contagemLocal.length > 0 ? `${enderecoAtual} — ${contagemLocal.length} itens bipados` : 'Bipe o endereço para começar'}`
              : `Inventário #${inventarioAtivo.id} | Falta contar: ${pendentesGlobais.length} itens`}
          </p>
        </div>
        <button className="btn btn--ghost" onClick={() => setInventarioAtivo(null)}>Sair</button>
      </div>

      <div className="mov-flow">
        
        {/* STEP 1: ENDEREÇO */}
        <div className={`mov-step ${step === 1 ? 'active' : 'completed'}`}>
          <div className="mov-step__header">
            <div className="mov-step__number">1</div>
            <div className="mov-step__label flex items-center gap-8 text-warning" style={{ fontSize: 14 }}>
              <MapPin size={16}/> {isCargaAtiva ? 'Bipe qualquer endereço do armazém' : 'Vá para o endereço'}
            </div>
          </div>
          {step === 1 ? (
            <>
              {!isCargaAtiva && (
                <div className="text-center py-24 mb-16" style={{ background: 'var(--bg-1)', borderRadius: 8, border: '1px solid var(--warning)' }}>
                  <div className="text-sm text-muted mb-4 uppercase tracking-widest">Endereço Alvo</div>
                  <div className="text-warning font-mono" style={{ fontSize: 42, fontWeight: 900 }}>{enderecoAtual}</div>
                </div>
              )}
              <input
                id="inv-endereco"
                className="form-input form-input--scanner"
                placeholder={isCargaAtiva ? 'Bipar etiqueta do endereço...' : 'Confirme bipando a etiqueta...'}
                onKeyDown={e => { if (e.key === 'Enter') { scanEndereco(e.target.value); e.target.value = '' } }}
                autoFocus
              />
            </>
          ) : (
            <div className="flex items-center gap-12 font-mono text-success text-lg"><MapPin size={20}/> {enderecoAtual}
              {isCargaAtiva && (
                <button className="btn btn--ghost btn--sm ml-auto" onClick={() => {
                  setEnderecoAtual('')
                  setContagemLocal([])
                  setItensDoEndereco([])
                  setStep(1)
                  setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
                }}>
                  Trocar
                </button>
              )}
            </div>
          )}
        </div>

        {/* STEP 2: PRODUTOS (LOOP) */}
        <div className={`mov-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`} style={{ opacity: step >= 2 ? 1 : 0.5 }}>
          <div className="mov-step__header">
            <div className="mov-step__number">2</div>
            <div className="mov-step__label">Bipe todos os materiais físicos nesta posição</div>
          </div>
          {step === 2 ? (
            <div>
              <input
                id="inv-produto"
                className="form-input form-input--scanner mb-16"
                placeholder="Bipar código do material ou EAN... (Enter vazio = Finalizar)"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (e.target.value.trim()) {
                      scanProduto(e.target.value)
                      e.target.value = ''
                    } else {
                      // Enter com campo vazio = finalizar endereço
                      finalizarEndereco()
                    }
                  }
                }}
              />
              
              {contagemLocal.length > 0 && (
                <div className="mb-16">
                  <div className="text-sm text-muted mb-8">Materiais já conferidos neste endereço:</div>
                  <div className="flex-col gap-4">
                    {contagemLocal.map(c => (
                      <div key={c.chave} className="flex justify-between items-center text-sm p-8" style={{ background: 'var(--bg-2)', borderRadius: 4, borderLeft: '3px solid var(--success)' }}>
                        <div>
                          <span className="font-mono font-bold">{c.codigo}</span>
                          <div className="text-muted text-xs">{c.descricao}</div>
                        </div>
                        <span className="text-muted text-xs">{c.validade}</span>
                        <span className="text-success font-bold">{c.caixas} cx</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <button className="btn btn--secondary w-full py-16" onClick={finalizarEndereco}
                disabled={isCargaAtiva && contagemLocal.length === 0}
                style={{ opacity: (isCargaAtiva && contagemLocal.length === 0) ? 0.5 : 1 }}>
                <CheckCircle2 size={18}/> Finalizar Endereço
              </button>
            </div>
          ) : step > 2 ? (
            <div className="flex items-center gap-12 font-mono text-success text-lg"><Box size={20}/> {itemAtual?.codigo}</div>
          ) : null}
        </div>

        {/* STEP 3: CONTAGEM */}
        <div className={`mov-step ${step === 3 ? 'active' : ''}`} style={{ opacity: step >= 3 ? 1 : 0.5, display: step >= 3 ? 'block' : 'none' }}>
          <div className="mov-step__header">
            <div className="mov-step__number">3</div>
            <div className="mov-step__label">{ssccModoConfirmacao ? 'Confirmar Caixa SSCC' : 'Informar as Quantidades'}</div>
          </div>
          {step === 3 && itemAtual && (
            <form onSubmit={submitContagem} className="flex-col gap-16">
              
              {jaBipado && (
                <div className="text-warning font-bold flex items-center gap-8 mb-8" style={{ background: 'var(--bg-warning)', padding: '12px', borderRadius: 4, lineHeight: 1.4 }}>
                  <AlertCircle size={24}/>
                  <div>
                    Este SKU já foi bipado neste endereço. Se informar uma validade diferente, será registrado como lote separado.
                  </div>
                </div>
              )}

              <div className="card card--accent mb-8 flex justify-between items-start">
                <div>
                  <div className="text-sm text-muted mb-4 flex gap-8 items-center">
                    Produto Identificado
                    {itemAtual.tipo_produto && <span className="badge" style={{background: 'var(--bg-1)', fontSize: 10}}>{itemAtual.tipo_produto}</span>}
                    {itemAtual.status_curva && <span className="badge" style={{background: 'var(--bg-1)', fontSize: 10}}>Curva {itemAtual.status_curva}</span>}
                  </div>
                  <div className="text-primary font-bold">{itemAtual.descricao}</div>
                  <div className="text-muted text-xs mt-2">{itemAtual.codigo}</div>
                </div>
                <button type="button" className="btn btn--icon btn--ghost text-muted hover:text-primary" onClick={abrirModalEdicaoProduto} title="Editar Cadastro">
                  <Settings size={16}/>
                </button>
              </div>

              {/* ── MODO CONFIRMAÇÃO SSCC ── */}
              {ssccModoConfirmacao && ssccDadosCaixa ? (
                <>
                  <div style={{ background: 'var(--bg-2)', border: '1px solid var(--primary)', borderRadius: 10, padding: '16px 20px' }}>
                    <div className="text-xs text-muted font-bold mb-12 uppercase tracking-widest">✅ Dados da Caixa no Sistema</div>
                    <div className="flex gap-24">
                      <div>
                        <div className="text-xs text-muted mb-2">Peso Cadastrado</div>
                        <div className="font-bold text-cyan" style={{ fontSize: 22 }}>{ssccDadosCaixa.peso_kg} kg</div>
                      </div>
                      {ssccDadosCaixa.validade && (
                        <div>
                          <div className="text-xs text-muted mb-2">Validade</div>
                          <div className="font-bold" style={{ fontSize: 18 }}>
                            {(() => { try { return new Date(ssccDadosCaixa.validade + 'T00:00:00').toLocaleDateString('pt-BR') } catch(_) { return ssccDadosCaixa.validade } })()}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-bold mt-16 mb-8">O peso e validade físicos estão corretos?</div>
                    <div className="flex gap-8">
                      <button
                        type="submit"
                        className="btn btn--primary flex-1"
                        style={{ background: 'var(--success)', borderColor: 'var(--success)' }}
                      >
                        <CheckCircle2 size={16}/> SIM, está correto
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
                        onClick={() => setSsccModoConfirmacao(false)}
                      >
                        NÃO, editar
                      </button>
                    </div>
                  </div>
                  <button type="button" className="btn btn--ghost text-muted" onClick={voltarParaProduto} style={{ marginTop: 8 }}>Cancelar</button>
                </>
              ) : (
                /* ── MODO EDIÇÃO (normal ou após clicar NÃO) ── */
                <>
                  {ssccDadosCaixa && !ssccModoConfirmacao && (
                    <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 4 }} className="text-sm text-warning">
                      Ajuste os valores corretos da caixa física:
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">Validade da Caixa (Física) *</label>
                    <input
                      id="inv-validade"
                      type="date"
                      className="form-input"
                      value={qtdValidade}
                      onChange={e => setQtdValidade(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-16 items-end">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Peso (KG Físico) *</label>
                      <input id="inv-kg" type="number" step="0.01" className="form-input form-input--number" value={qtdKg} onChange={e => setQtdKg(e.target.value)} required />
                    </div>
                  </div>
                  
                  <div className="flex gap-8 mt-8">
                    <button type="submit" className="btn btn--primary btn--lg w-full">
                      <CheckCircle2 size={18}/> {jaBipado ? 'Somar Quantidade' : 'Salvar Volume'}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={voltarParaProduto}>
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>

      </div>

      {/* Modal de vinculacao de EAN rapido (inventario ciclico e outros) */}
      <CadastroEanModal
        isOpen={modalEanOpen}
        onClose={() => { setModalEanOpen(false); setTimeout(() => document.getElementById('inv-produto')?.focus(), 100) }}
        codigoDesconhecido={eanDesconhecido}
        onRegraSalva={(p) => {
          // Após vincular, preence o item e avança para informar quantidade
          setItemAtual({
            id: null,
            produto_id: p.id,
            endereco: enderecoAtual,
            codigo: p.codigo || p.ean,
            descricao: p.descricao,
            status_curva: p.status_curva,
            tipo_produto: p.tipo_produto,
            grupo: p.grupo,
            status_item: 'Pendente'
          })
          setStep(3)
          setTimeout(() => document.getElementById('inv-validade')?.focus(), 100)
        }}
      />
    </div>
  )
}
