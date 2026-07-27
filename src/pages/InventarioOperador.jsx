import React, { useState, useEffect, useCallback } from 'react'
import { MapPin, Box, CheckCircle2, AlertCircle, Plus, X, Package, Settings, List, ArrowRight, MoveRight, Layers } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import * as inventariosQueries from '../queries/inventarios.js';
import * as locaisQueries from '../queries/locais.js';
import * as produtosQueries from '../queries/produtos.js';
import * as estoqueQueries from '../queries/estoque.js'
import { CadastroEanModal } from '../components/shared/CadastroEanModal.jsx'

// ─── Badge de status de item ────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cores = {
    'Pendente': { bg: 'rgba(251,191,36,0.15)', color: 'var(--warning)' },
    '2ª Contagem': { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
    '3ª Contagem': { bg: 'rgba(239,68,68,0.15)', color: 'var(--danger)' },
    'OK': { bg: 'rgba(34,197,94,0.15)', color: 'var(--success)' },
    'Aguardando Ajuste': { bg: 'rgba(239,68,68,0.15)', color: 'var(--danger)' },
  }
  const c = cores[status] || { bg: 'var(--bg-2)', color: 'var(--text-muted)' }
  return (
    <span style={{
      background: c.bg, color: c.color, border: `1px solid ${c.color}40`,
      borderRadius: 99, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap'
    }}>{status}</span>
  )
}

export function InventarioOperador() {
  const { toastSuccess, toastError, toastWarning } = useAppStore()

  const [inventarios, setInventarios] = useState([])
  const [inventarioAtivo, setInventarioAtivo] = useState(null)

  // step 0 = lista de endereços, 1 = confirmar endereço, 2 = bipar produtos, 3 = qtd manual
  const [step, setStep] = useState(1)

  // Lista de endereços pendentes agrupados
  const [enderecosPendentes, setEnderecosPendentes] = useState([]) // [{ endereco, itens: [], status_dominante }]

  // Estado do endereço atual
  const [enderecoAtual, setEnderecoAtual] = useState('')
  const [itensDoEndereco, setItensDoEndereco] = useState([])

  // Contagens locais (em memória) antes de finalizar o endereço
  const [contagemLocal, setContagemLocal] = useState([]) // { chave, item_id, codigo, descricao, caixas, kg, validade }

  // Estado do item atual sendo contado
  const [itemAtual, setItemAtual] = useState(null)

  const [qtdCaixas, setQtdCaixas] = useState('')
  const [qtdKg, setQtdKg] = useState('')
  const [qtdValidade, setQtdValidade] = useState('')

  // Modal DE-PARA (caixa em endereço errado)
  const [modalDePara, setModalDePara] = useState(null) // { caixa, produto, enderecoOrigem }
  const [movendo, setMovendo] = useState(false)

  // Modal de cadastro rápido (CargaInicial)
  const [modalCadastro, setModalCadastro] = useState(null)
  const [formCadastro, setFormCadastro] = useState({ descricao: '', tipo_produto: 'Materia Prima', status_curva: 'C', valor_unitario: '', grupo: '', produtoVinculado: null })
  const [salvandoCadastro, setSalvandoCadastro] = useState(false)
  const [produtosSemEan, setProdutosSemEan] = useState([])

  // Modal de vinculação rápida de EAN
  const [modalEanOpen, setModalEanOpen] = useState(false)
  const [eanDesconhecido, setEanDesconhecido] = useState('')

  // SSCC: dados pré-preenchidos da caixa quando EAN já está cadastrado
  const [ssccDadosCaixa, setSsccDadosCaixa] = useState(null)
  const [ssccModoConfirmacao, setSsccModoConfirmacao] = useState(false)

  const [isFinalizando, setIsFinalizando] = useState(false)

  // ─── 1. Carregar inventários ──────────────────────────────────────────────
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

  // ─── 2. Agrupar itens por endereço ────────────────────────────────────────
  const agruparPorEndereco = useCallback((itens) => {
    const mapa = {}
    itens.forEach(i => {
      if (!mapa[i.endereco]) mapa[i.endereco] = { endereco: i.endereco, itens: [], contagens: {} }
      mapa[i.endereco].itens.push(i)
      mapa[i.endereco].contagens[i.status_item] = (mapa[i.endereco].contagens[i.status_item] || 0) + 1
    })
    const prioStatus = { '3ª Contagem': 0, '2ª Contagem': 1, 'Pendente': 2 }
    return Object.values(mapa)
      .map(g => {
        const statusDom = Object.keys(g.contagens).sort((a, b) => (prioStatus[a] ?? 9) - (prioStatus[b] ?? 9))[0]
        return { ...g, status_dominante: statusDom }
      })
      .sort((a, b) => {
        const pa = prioStatus[a.status_dominante] ?? 9
        const pb = prioStatus[b.status_dominante] ?? 9
        return pa !== pb ? pa - pb : a.endereco.localeCompare(b.endereco)
      })
  }, [])

  // ─── 3. Selecionar inventário ─────────────────────────────────────────────
  const selecionarInventario = async (inv) => {
    try {
      const isCarga = inv.tipo === 'CargaInicial'
      setInventarioAtivo(inv)

      if (isCarga) {
        setEnderecosPendentes([])
        setEnderecoAtual('')
        setItensDoEndereco([])
        setContagemLocal([])
        setStep(1)
        setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
      } else {
        const itens = await inventariosQueries.listarItens(inv.id)
        const pendentes = itens.filter(i => ['Pendente', '2ª Contagem', '3ª Contagem'].includes(i.status_item))

        if (pendentes.length === 0) {
          toastWarning('Aviso', 'Este inventário não tem itens pendentes.')
          setInventarioAtivo(null)
          return
        }

        setEnderecosPendentes(agruparPorEndereco(pendentes))
        setEnderecoAtual('')
        setItensDoEndereco([])
        setContagemLocal([])
        setStep(0) // tela de seleção de endereço
      }
    } catch (e) {
      toastError('Erro', 'Falha ao carregar itens')
    }
  }

  // ─── 4. Clicar num endereço da lista ─────────────────────────────────────
  const selecionarEndereco = (grupo) => {
    setEnderecoAtual(grupo.endereco)
    setItensDoEndereco(grupo.itens)
    setContagemLocal([])
    setItemAtual(null)
    setQtdCaixas(''); setQtdKg(''); setQtdValidade('')
    setSsccDadosCaixa(null); setSsccModoConfirmacao(false)
    setStep(1)
    setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
  }

  // ─── 5. Recarregar endereços após finalizar ────────────────────────────────
  const recarregarEnderecos = useCallback(async () => {
    if (!inventarioAtivo) return
    const itens = await inventariosQueries.listarItens(inventarioAtivo.id)
    const pendentes = itens.filter(i => ['Pendente', '2ª Contagem', '3ª Contagem'].includes(i.status_item))
    if (pendentes.length === 0) {
      toastSuccess('Inventário Concluído', 'Todos os endereços foram contados!')
      setInventarioAtivo(null)
      carregar()
      return
    }
    setEnderecosPendentes(agruparPorEndereco(pendentes))
    setEnderecoAtual('')
    setItensDoEndereco([])
    setContagemLocal([])
    setStep(0)
  }, [inventarioAtivo, agruparPorEndereco])

  // Volta para a etapa de bipar produto
  const voltarParaProduto = () => {
    setItemAtual(null)
    setQtdCaixas(''); setQtdKg(''); setQtdValidade('')
    setSsccDadosCaixa(null); setSsccModoConfirmacao(false)
    setStep(2)
    setTimeout(() => document.getElementById('inv-produto')?.focus(), 100)
  }

  // ─── Scanners ─────────────────────────────────────────────────────────────
  const scanEndereco = async (val) => {
    if (!val || val.trim() === '') return
    const isCarga = inventarioAtivo?.tipo === 'CargaInicial'
    const addr = val.toUpperCase().trim()

    if (isCarga) {
      try {
        const locais = await locaisQueries.listar()
        if (!locais.find(l => l.endereco.toUpperCase() === addr)) {
          return toastError('Endereço Inválido', 'Este endereço não existe no sistema.')
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

    // Inventário normal: confirmar que bipou o endereço correto
    if (addr !== enderecoAtual) {
      return toastError('Endereço Incorreto', `Você está no endereço: ${enderecoAtual}. Bipe a etiqueta correta.`)
    }
    setStep(2)
    setTimeout(() => document.getElementById('inv-produto')?.focus(), 100)
  }

  const scanProduto = async (val) => {
    if (!val || val.trim() === '') return
    const eanBipado = val.trim()

    try {
      const resultado = await produtosQueries.buscarPorCodigoComInfo(eanBipado)
      if (!resultado) {
        const isCarga = inventarioAtivo?.tipo === 'CargaInicial'
        if (isCarga) {
          const prods = await produtosQueries.listar()
          setProdutosSemEan(prods.filter(p => !p.ean))
          setModalCadastro({ ean: eanBipado })
          setFormCadastro({ descricao: '', tipo_produto: 'Materia Prima', status_curva: 'C', valor_unitario: '', grupo: '', produtoVinculado: null })
        } else {
          setEanDesconhecido(eanBipado)
          setModalEanOpen(true)
        }
        return
      }

      const { produto } = resultado

      if (eanBipado === produto.codigo) {
        return toastError('Código Inválido', 'Não é permitido usar o código interno. Bipe a etiqueta da caixa!')
      }

      // Busca a caixa no estoque
      const { db } = await import('../lib/db.js')
      const resEstoque = await db.execute({
        sql: `SELECT peso_kg, validade, ean_caixa, endereco, status FROM estoque_caixas WHERE ean_caixa = ? LIMIT 1`,
        args: [eanBipado]
      })
      const caixaNoEstoque = resEstoque.rows.length > 0 ? resEstoque.rows[0] : null

      if (caixaNoEstoque) {
        const chave = `${eanBipado}__${caixaNoEstoque.validade || ''}`
        const jaExisteNaContagem = contagemLocal.find(c => c.chave === chave)
        if (jaExisteNaContagem) {
          toastWarning('Atenção', 'Esta caixa já foi bipada nesta contagem!')
          return
        }

        // Verifica se já foi OK neste inventário
        const { rows: jaOk } = await db.execute({
          sql: `SELECT id FROM inventario_itens WHERE inventario_id = ? AND ean_caixa = ? AND status_item = 'OK' LIMIT 1`,
          args: [inventarioAtivo.id, eanBipado]
        })
        if (jaOk.length > 0) {
          toastSuccess('Confirmado ✓', `Caixa já contada e confirmada (OK).`)
          return
        }

        // ── MELHORIA 2: Caixa em endereço diferente → Modal DE-PARA ──────────
        const enderecoOrigem = (caixaNoEstoque.endereco || '').toUpperCase().trim()
        const enderecoDestino = enderecoAtual.toUpperCase().trim()
        const enderecosEspeciais = ['REC', 'EXPEDICAO', 'SAIDA', 'PERDIDO']
        if (
          enderecoOrigem &&
          enderecoOrigem !== enderecoDestino &&
          !enderecosEspeciais.includes(enderecoOrigem)
        ) {
          setModalDePara({
            caixa: caixaNoEstoque,
            produto,
            enderecoOrigem,
            eanBipado,
            chave
          })
          return
        }

        // Sem divergência de endereço: registrar na contagem
        await registrarNaContagem({ eanBipado, produto, caixaNoEstoque, chave })
        return
      }

      // Caixa não existe no estoque — pedir peso e validade manualmente
      setSsccDadosCaixa(null)
      setSsccModoConfirmacao(false)
      setQtdCaixas('1'); setQtdKg(''); setQtdValidade('')
      setItemAtual({
        id: null, produto_id: produto.id, endereco: enderecoAtual,
        codigo: eanBipado, descricao: produto.descricao,
        status_curva: produto.status_curva, tipo_produto: produto.tipo_produto,
        grupo: produto.grupo, status_item: 'Pendente'
      })
      setStep(3)
      setTimeout(() => document.getElementById('inv-validade')?.focus(), 100)
    } catch (err) {
      return toastError('Erro', err.message)
    }
  }

  // ─── Helper: registrar caixa SSCC já conhecida na contagem local ──────────
  const registrarNaContagem = async ({ eanBipado, produto, caixaNoEstoque, chave }) => {
    const itemMatch = itensDoEndereco.find(i => i.ean_caixa === eanBipado)
    let item_id
    if (itemMatch) {
      item_id = itemMatch.id
    } else {
      const res = await inventariosQueries.adicionarItemSurpresa({
        inventario_id: inventarioAtivo.id,
        endereco: enderecoAtual,
        produto_id: produto.id,
        validade: caixaNoEstoque.validade,
        ean_caixa: eanBipado
      })
      if (!res.success) { toastError('Erro', res.error); return }
      item_id = res.item_id
      setItensDoEndereco(prev => [...prev, {
        ...produto, id: item_id, ean_caixa: eanBipado,
        validade: caixaNoEstoque.validade, endereco: enderecoAtual
      }])
    }

    setContagemLocal(prev => [...prev, {
      chave,
      item_id,
      produto_id: produto.id,
      codigo: eanBipado,
      descricao: produto.descricao,
      validade: caixaNoEstoque.validade || '',
      caixas: 1,
      kg: caixaNoEstoque.peso_kg || 0
    }])
    toastSuccess('Caixa Contada ✓', `${produto.descricao} — ${(caixaNoEstoque.peso_kg || 0).toFixed(2)} kg`)
    setTimeout(() => document.getElementById('inv-produto')?.focus(), 100)
  }

  // ─── Confirmar DE-PARA ────────────────────────────────────────────────────
  const confirmarDePara = async () => {
    if (!modalDePara) return
    setMovendo(true)
    try {
      const { db } = await import('../lib/db.js')
      const { caixa, produto, enderecoOrigem, eanBipado, chave } = modalDePara

      // Mover a caixa no estoque_caixas
      await db.execute({
        sql: `UPDATE estoque_caixas SET endereco = ?, updated_at = CURRENT_TIMESTAMP WHERE ean_caixa = ?`,
        args: [enderecoAtual, eanBipado]
      })

      // Retirar do estoque_posicao de origem
      await db.execute({
        sql: `UPDATE estoque_posicao SET qtd_caixas = MAX(0, qtd_caixas - 1), qtd_kg = MAX(0, qtd_kg - ?), updated_at = CURRENT_TIMESTAMP
              WHERE endereco = ? AND produto_id = ?`,
        args: [caixa.peso_kg || 0, enderecoOrigem, produto.id]
      })

      // Adicionar no estoque_posicao de destino
      const val = caixa.validade || null
      const { rows: posExiste } = await db.execute({
        sql: `SELECT id FROM estoque_posicao WHERE produto_id = ? AND endereco = ? AND (validade = ? OR (validade IS NULL AND ? IS NULL))`,
        args: [produto.id, enderecoAtual, val, val]
      })
      if (posExiste[0]) {
        await db.execute({
          sql: `UPDATE estoque_posicao SET qtd_caixas = qtd_caixas + 1, qtd_kg = qtd_kg + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          args: [caixa.peso_kg || 0, posExiste[0].id]
        })
      } else {
        await db.execute({
          sql: `INSERT INTO estoque_posicao (produto_id, endereco, lote, validade, qtd_caixas, qtd_kg) VALUES (?, ?, '', ?, 1, ?)`,
          args: [produto.id, enderecoAtual, val, caixa.peso_kg || 0]
        })
      }

      // Limpar posição de origem com saldo zerado
      await db.execute({
        sql: `DELETE FROM estoque_posicao WHERE endereco = ? AND produto_id = ? AND qtd_caixas <= 0`,
        args: [enderecoOrigem, produto.id]
      })

      toastSuccess('Movido!', `Caixa movida de ${enderecoOrigem} → ${enderecoAtual}`)
      setModalDePara(null)

      // Registrar na contagem após mover
      await registrarNaContagem({ eanBipado, produto, caixaNoEstoque: { ...caixa, endereco: enderecoAtual }, chave })
    } catch (err) {
      toastError('Erro ao Mover', err.message)
    } finally {
      setMovendo(false)
    }
  }

  // ─── Salvar cadastro rápido ───────────────────────────────────────────────
  const salvarCadastroRapido = async (e) => {
    e.preventDefault()
    if (!formCadastro.descricao.trim()) return toastError('Atenção', 'A descrição do produto é obrigatória.')
    setSalvandoCadastro(true)
    try {
      let res;
      if (formCadastro.produtoVinculado) {
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
          ean: modalCadastro.ean, codigo: '',
          descricao: formCadastro.descricao.trim(),
          tipo_produto: formCadastro.tipo_produto,
          status_curva: formCadastro.status_curva || 'C',
          grupo: formCadastro.grupo || '',
          unidade: 'CX',
          valor_unitario: parseFloat(formCadastro.valor_unitario) || 0
        })
      }
      if (!res.success) return toastError('Erro ao Salvar', res.error)
      toastSuccess('Produto Salvo!', `${formCadastro.descricao} atualizado no sistema.`)
      const eanBipado = modalCadastro.ean
      setModalCadastro(null)
      const p = await produtosQueries.buscarPorCodigo(eanBipado)
      if (p) {
        setItemAtual({
          id: null, produto_id: p.id, endereco: enderecoAtual,
          codigo: p.codigo || p.ean, descricao: p.descricao,
          status_curva: p.status_curva, tipo_produto: p.tipo_produto,
          grupo: p.grupo, status_item: 'Pendente'
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
    const chave = `${itemAtual.codigo}__${val}`
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
    const itemMatch = itensDoEndereco.find(i => i.ean_caixa === itemAtual.codigo)
    let item_id
    if (itemMatch) {
      item_id = itemMatch.id
    } else {
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
      chave, item_id, produto_id: itemAtual.produto_id,
      codigo: itemAtual.codigo, descricao: itemAtual.descricao,
      validade: val, caixas: cx, kg: kg
    }])

    toastSuccess('Registrado', 'Volume salvo. Finalize o endereço para enviar.')
    voltarParaProduto()
  }

  const finalizarEndereco = async () => {
    if (isFinalizando) return
    if (inventarioAtivo?.tipo === 'CargaInicial' && contagemLocal.length === 0) {
      return toastWarning('Atenção', 'Nenhum item foi bipado neste endereço.')
    }
    setIsFinalizando(true)
    try {
      const groupedCounted = []
      contagemLocal.forEach(c => {
        const existing = groupedCounted.find(g => g.item_id === c.item_id)
        if (existing) { existing.caixas += c.caixas; existing.kg += c.kg }
        else groupedCounted.push({ item_id: c.item_id, caixas: c.caixas, kg: c.kg, validade: c.validade })
      })

      const countedIds = groupedCounted.map(c => c.item_id)
      const uncounted = itensDoEndereco
        .filter(i => !countedIds.includes(i.id))
        .map(i => ({ item_id: i.id, caixas: 0, kg: 0, validade: i.validade_contada || i.validade }))

      await Promise.all(
        [...groupedCounted, ...uncounted].map(c => inventariosQueries.registrarContagem({
          item_id: c.item_id,
          qtd_contada_caixas: c.caixas,
          qtd_contada_kg: c.kg,
          validade_informada: c.validade
        }))
      )

      // Registrar caixas SSCC no estoque
      const caixasSSCC = contagemLocal
        .filter(c => c.codigo && c.codigo.length >= 8)
        .map(c => ({
          ean_caixa: c.codigo, produto_id: c.produto_id, endereco: enderecoAtual,
          validade: c.validade, peso_kg: c.kg / (c.caixas || 1)
        }))
      if (caixasSSCC.length > 0) {
        await estoqueQueries.inserirCaixasCargaInicial(caixasSSCC)
      }

      toastSuccess('Endereço Finalizado', `${enderecoAtual} registrado com sucesso.`)

      const isCarga = inventarioAtivo?.tipo === 'CargaInicial'
      if (isCarga) {
        setContagemLocal([])
        setEnderecoAtual('')
        setItensDoEndereco([])
        setStep(1)
        setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
      } else {
        await recarregarEnderecos()
      }
    } catch (e) {
      toastError('Erro ao Finalizar', e.message || 'Falha ao finalizar endereço.')
    } finally {
      setIsFinalizando(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  // Tela de seleção de inventário
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
                      {inv.tipo === 'CargaInicial' ? '🏭 Carga Inicial' : `Inventário #${inv.id} — ${inv.tipo_filtro} ${inv.identificador_filtro || ''}`}
                    </h3>
                    <div className="text-sm text-muted">
                      {inv.tipo === 'CargaInicial'
                        ? 'Carga Inicial do Sistema — Bipe endereços livremente'
                        : `${inv.itens_pendentes || 0} posições pendentes · ${inv.itens_ok || 0} OK`}
                    </div>
                  </div>
                  <div className="text-right">
                    {inv.tipo === 'CargaInicial' ? (
                      <div className="text-warning font-bold text-sm">INICIAR →</div>
                    ) : (
                      <div className="text-warning font-bold text-lg">{inv.itens_pendentes || 0} pendentes</div>
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
  const totalCaixasBipadas = contagemLocal.reduce((sum, c) => sum + c.caixas, 0)
  const totalKgBipados = contagemLocal.reduce((sum, c) => sum + c.kg, 0)
  const sugestoesDescricao = formCadastro.produtoVinculado ? [] : produtosSemEan.filter(p => formCadastro.descricao.length >= 2 && p.descricao.toLowerCase().includes(formCadastro.descricao.toLowerCase())).slice(0, 5)

  return (
    <div style={{ maxWidth: 600, position: 'relative' }}>

      {/* ── MODAL DE CADASTRO RÁPIDO ──────────────────────────────────────── */}
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
                      type="text" className="form-input" placeholder="Ex: COXAO MOLE (T7)" autoFocus
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
                            onClick={() => setFormCadastro(prev => ({
                              ...prev, produtoVinculado: p, descricao: p.descricao,
                              tipo_produto: p.tipo_produto || 'Materia Prima',
                              status_curva: p.status_curva || 'C',
                              grupo: p.grupo || '', valor_unitario: p.valor_unitario || ''
                            }))}>
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
                  <select className="form-input" value={formCadastro.tipo_produto} onChange={e => setFormCadastro(prev => ({ ...prev, tipo_produto: e.target.value }))}>
                    <option value="Materia Prima">Matéria Prima</option>
                    <option value="Produto Acabado">Produto Acabado</option>
                    <option value="Insumos">Insumos</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Curva ABC</label>
                  <select className="form-input" value={formCadastro.status_curva} onChange={e => setFormCadastro(prev => ({ ...prev, status_curva: e.target.value }))}>
                    <option value="A">Curva A</option>
                    <option value="B">Curva B</option>
                    <option value="C">Curva C</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Valor (R$)</label>
                  <input type="number" step="0.01" className="form-input form-input--number" placeholder="Opcional"
                    value={formCadastro.valor_unitario} onChange={e => setFormCadastro(prev => ({ ...prev, valor_unitario: e.target.value }))} />
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
                <button type="button" className="btn btn--ghost" onClick={() => setModalCadastro(null)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL DE-PARA (caixa em endereço diferente) ───────────────────── */}
      {modalDePara && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '2px solid var(--warning)',
            borderRadius: 14, padding: 28, width: '100%', maxWidth: 420,
            boxShadow: '0 24px 64px rgba(0,0,0,0.7)'
          }}>
            <div className="flex items-center gap-10 mb-20">
              <div style={{ background: 'rgba(251,191,36,0.15)', borderRadius: 10, padding: 10 }}>
                <MoveRight size={24} style={{ color: 'var(--warning)' }} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--warning)' }}>Caixa em Outro Endereço</div>
                <div className="text-muted text-sm">Deseja movê-la para cá?</div>
              </div>
            </div>

            {/* Produto */}
            <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div className="text-xs text-muted mb-4">Produto</div>
              <div className="font-bold" style={{ fontSize: 15 }}>{modalDePara.produto.descricao}</div>
              <div className="font-mono text-muted text-xs mt-2">{modalDePara.eanBipado}</div>
            </div>

            {/* De → Para */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ flex: 1, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                <div className="text-xs text-muted mb-4">DE</div>
                <div className="font-mono font-bold text-danger" style={{ fontSize: 22 }}>{modalDePara.enderecoOrigem}</div>
              </div>
              <ArrowRight size={28} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              <div style={{ flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
                <div className="text-xs text-muted mb-4">PARA</div>
                <div className="font-mono font-bold text-success" style={{ fontSize: 22 }}>{enderecoAtual}</div>
              </div>
            </div>

            <div className="flex gap-10">
              <button
                className="btn btn--primary flex-1"
                style={{ background: 'var(--success)', borderColor: 'var(--success)', padding: '14px 0', fontSize: 15 }}
                onClick={confirmarDePara}
                disabled={movendo}
              >
                <CheckCircle2 size={18}/> {movendo ? 'Movendo...' : 'Sim, Mover!'}
              </button>
              <button
                className="btn btn--ghost flex-1"
                style={{ borderColor: 'var(--border)', padding: '14px 0', fontSize: 15 }}
                onClick={() => { setModalDePara(null); setTimeout(() => document.getElementById('inv-produto')?.focus(), 100) }}
                disabled={movendo}
              >
                <X size={16}/> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="page-header mb-16">
        <div>
          <h1 className="page-header__title">
            {isCargaAtiva ? '🏭 Carga Inicial' : step === 0 ? `Inventário #${inventarioAtivo.id}` : `Contando: ${enderecoAtual}`}
          </h1>
          <p className="page-header__subtitle">
            {isCargaAtiva
              ? `Inventário #${inventarioAtivo.id} | ${contagemLocal.length > 0 ? `${enderecoAtual} — ${totalCaixasBipadas} caixas` : 'Bipe o endereço para começar'}`
              : step === 0 ? `${enderecosPendentes.length} endereços pendentes` : `Inventário #${inventarioAtivo.id}`}
          </p>
        </div>
        <div className="flex gap-8">
          {step > 0 && !isCargaAtiva && (
            <button className="btn btn--ghost btn--sm" onClick={() => { setStep(0); setEnderecoAtual(''); setContagemLocal([]); setItensDoEndereco([]) }}>
              <List size={14}/> Lista
            </button>
          )}
          <button className="btn btn--ghost" onClick={() => setInventarioAtivo(null)}>Sair</button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STEP 0: SELECIONAR ENDEREÇO (lista clicável)
      ══════════════════════════════════════════════════════════════════════ */}
      {step === 0 && !isCargaAtiva && (
        <div>
          <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            <Layers size={14} style={{ display: 'inline', marginRight: 6 }} />
            Escolha qual posição deseja contar agora
          </div>
          <div className="flex-col gap-8">
            {enderecosPendentes.map(grupo => (
              <div
                key={grupo.endereco}
                onClick={() => selecionarEndereco(grupo)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderLeft: `4px solid ${grupo.status_dominante === '3ª Contagem' ? 'var(--danger)' : grupo.status_dominante === '2ª Contagem' ? '#f97316' : 'var(--warning)'}`,
                  borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
              >
                <div className="flex items-center gap-12">
                  <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '6px 10px' }}>
                    <MapPin size={18} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div>
                    <div className="font-mono font-bold" style={{ fontSize: 20 }}>{grupo.endereco}</div>
                    <div className="text-muted text-xs mt-2">{grupo.itens.length} item{grupo.itens.length !== 1 ? 'ns' : ''} a contar</div>
                  </div>
                </div>
                <div className="flex items-center gap-10">
                  <StatusBadge status={grupo.status_dominante} />
                  <ArrowRight size={18} style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          STEPS 1/2/3: FLUXO DE CONTAGEM
      ══════════════════════════════════════════════════════════════════════ */}
      {(step >= 1) && (
        <div className="mov-flow">

          {/* STEP 1: CONFIRMAR ENDEREÇO */}
          <div className={`mov-step ${step === 1 ? 'active' : 'completed'}`}>
            <div className="mov-step__header">
              <div className="mov-step__number">1</div>
              <div className="mov-step__label flex items-center gap-8 text-warning" style={{ fontSize: 14 }}>
                <MapPin size={16}/> {isCargaAtiva ? 'Bipe qualquer endereço do armazém' : 'Confirme o endereço bipando a etiqueta'}
              </div>
            </div>
            {step === 1 ? (
              <>
                {!isCargaAtiva && (
                  <div className="text-center py-20 mb-16" style={{ background: 'var(--bg-1)', borderRadius: 8, border: '1px solid var(--warning)' }}>
                    <div className="text-sm text-muted mb-4 uppercase tracking-widest">Vá para o endereço</div>
                    <div className="text-warning font-mono" style={{ fontSize: 48, fontWeight: 900 }}>{enderecoAtual}</div>
                    <div className="text-muted text-sm mt-4">{itensDoEndereco.length} item{itensDoEndereco.length !== 1 ? 'ns' : ''} esperados nesta posição</div>
                  </div>
                )}
                <input
                  id="inv-endereco"
                  className="form-input form-input--scanner"
                  placeholder={isCargaAtiva ? 'Bipar etiqueta do endereço...' : 'Bipe a etiqueta para confirmar...'}
                  onKeyDown={e => { if (e.key === 'Enter') { scanEndereco(e.target.value); e.target.value = '' } }}
                  autoFocus
                />
              </>
            ) : (
              <div className="flex items-center gap-12 font-mono text-success text-lg">
                <MapPin size={20}/> {enderecoAtual}
                {isCargaAtiva && (
                  <button className="btn btn--ghost btn--sm ml-auto" onClick={() => {
                    setEnderecoAtual(''); setContagemLocal([]); setItensDoEndereco([]); setStep(1)
                    setTimeout(() => document.getElementById('inv-endereco')?.focus(), 100)
                  }}>Trocar</button>
                )}
              </div>
            )}
          </div>

          {/* STEP 2: BIPAR PRODUTOS */}
          <div className={`mov-step ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`} style={{ opacity: step >= 2 ? 1 : 0.5 }}>
            <div className="mov-step__header">
              <div className="mov-step__number">2</div>
              <div className="mov-step__label">Bipe todos os materiais físicos nesta posição</div>
            </div>
            {step === 2 ? (
              <div>
                {/* ── MELHORIA 3: Contador de caixas em destaque ── */}
                {contagemLocal.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))',
                    border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12,
                    padding: '14px 20px', marginBottom: 16
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 38, fontWeight: 900, color: 'var(--success)', lineHeight: 1 }}>{totalCaixasBipadas}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>CAIXAS BIPADAS</div>
                    </div>
                    <div style={{ width: 1, height: 44, background: 'var(--border)' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{totalKgBipados.toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>KG TOTAL</div>
                    </div>
                    <div style={{ width: 1, height: 44, background: 'var(--border)' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{contagemLocal.length}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>REGISTROS</div>
                    </div>
                  </div>
                )}

                <input
                  id="inv-produto"
                  className="form-input form-input--scanner mb-16"
                  placeholder="Bipar código do material ou EAN... (Enter vazio = Finalizar)"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (e.target.value.trim()) { scanProduto(e.target.value); e.target.value = '' }
                      else finalizarEndereco()
                    }
                  }}
                />

                {/* Lista de caixas já bipadas */}
                {contagemLocal.length > 0 && (
                  <div className="mb-16">
                    <div className="text-sm text-muted mb-8">Materiais conferidos neste endereço:</div>
                    <div className="flex-col gap-6">
                      {contagemLocal.map(c => (
                        <div key={c.chave} style={{
                          background: 'var(--bg-2)', borderRadius: 8,
                          border: '1px solid rgba(34,197,94,0.25)', borderLeft: '4px solid var(--success)',
                          padding: '10px 14px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="font-mono font-bold text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.codigo}</div>
                            <div className="text-muted text-xs mt-1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descricao}</div>
                            {c.validade && <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>Val: {c.validade}</div>}
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--success)', lineHeight: 1 }}>{c.caixas}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>cx</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.kg.toFixed(2)} kg</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button className="btn btn--secondary w-full py-16" onClick={finalizarEndereco}
                  disabled={(isCargaAtiva && contagemLocal.length === 0) || isFinalizando}
                  style={{ opacity: ((isCargaAtiva && contagemLocal.length === 0) || isFinalizando) ? 0.5 : 1 }}>
                  <CheckCircle2 size={18}/> {isFinalizando ? 'Finalizando...' : `Finalizar Endereço (${totalCaixasBipadas} cx)`}
                </button>
              </div>
            ) : step > 2 ? (
              <div className="flex items-center gap-12 font-mono text-success text-lg"><Box size={20}/> {itemAtual?.codigo}</div>
            ) : null}
          </div>

          {/* STEP 3: CONTAGEM MANUAL */}
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
                    <div>Este SKU já foi bipado neste endereço. Validade diferente = lote separado.</div>
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
                        <button type="submit" className="btn btn--primary flex-1" style={{ background: 'var(--success)', borderColor: 'var(--success)' }}>
                          <CheckCircle2 size={16}/> SIM, está correto
                        </button>
                        <button type="button" className="btn btn--ghost" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }} onClick={() => setSsccModoConfirmacao(false)}>
                          NÃO, editar
                        </button>
                      </div>
                    </div>
                    <button type="button" className="btn btn--ghost text-muted" onClick={voltarParaProduto} style={{ marginTop: 8 }}>Cancelar</button>
                  </>
                ) : (
                  <>
                    {ssccDadosCaixa && !ssccModoConfirmacao && (
                      <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 4 }} className="text-sm text-warning">
                        Ajuste os valores corretos da caixa física:
                      </div>
                    )}
                    <div className="form-group">
                      <label className="form-label">Validade da Caixa (Física) *</label>
                      <input id="inv-validade" type="date" className="form-input" value={qtdValidade}
                        onChange={e => setQtdValidade(e.target.value)} required autoFocus />
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
                      <button type="button" className="btn btn--ghost" onClick={voltarParaProduto}>Cancelar</button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>

        </div>
      )}

      {/* Modal de vinculação de EAN */}
      <CadastroEanModal
        isOpen={modalEanOpen}
        onClose={() => { setModalEanOpen(false); setTimeout(() => document.getElementById('inv-produto')?.focus(), 100) }}
        codigoDesconhecido={eanDesconhecido}
        onRegraSalva={(p) => {
          setItemAtual({
            id: null, produto_id: p.id, endereco: enderecoAtual,
            codigo: p.codigo || p.ean, descricao: p.descricao,
            status_curva: p.status_curva, tipo_produto: p.tipo_produto,
            grupo: p.grupo, status_item: 'Pendente'
          })
          setStep(3)
          setTimeout(() => document.getElementById('inv-validade')?.focus(), 100)
        }}
      />
    </div>
  )
}
