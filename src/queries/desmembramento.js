import { db } from '../lib/db'
import { ensureRastreabilidadeSchema, tarasQueries } from './taras'
import { recalcularPosicaoEnderecos } from './movimentacoes'
import { verificarEnderecoBloqueado } from './inventarios'
import { calcularPesoLiquido, gerarLotePorData } from '../utils/rastreabilidade'
import { assertPermissao } from '../lib/authGuard'

export async function validarCaixa(ean) {
  await assertPermissao('desmembramento', { write: false, bloquearCliente: true })
  await ensureRastreabilidadeSchema()
  const clean = String(ean || '').trim()
  if (!clean) return { valid: false, error: 'Informe ou bipe o EAN da caixa original.' }

  const { rows } = await db.execute({
    sql: `
      SELECT
        ec.*,
        p.codigo AS produto_codigo,
        p.descricao AS produto_descricao,
        p.ean AS produto_ean,
        pal.codigo AS palete_codigo,
        pal.endereco_atual AS palete_endereco,
        t.nome AS tara_nome
      FROM estoque_caixas ec
      JOIN produtos p ON ec.produto_id = p.id
      LEFT JOIN paletes pal ON ec.palete_id = pal.id
      LEFT JOIN taras t ON ec.tara_id = t.id
      WHERE ec.ean_caixa = ?
      LIMIT 1
    `,
    args: [clean],
  })

  if (rows.length === 0) {
    return { valid: false, error: `Caixa com EAN "${clean}" não encontrada no sistema.` }
  }

  const caixa = rows[0]
  if (caixa.status !== 'DISPONIVEL') {
    return {
      valid: false,
      error: `Esta caixa está com status "${caixa.status}" e não está disponível para desmembramento.`,
    }
  }

  const enderecoReal = caixa.endereco || caixa.palete_endereco || 'DOCA'
  const bloq = await verificarEnderecoBloqueado(enderecoReal)
  if (bloq) {
    return {
      valid: false,
      error: `O endereço "${enderecoReal}" desta caixa está bloqueado por inventário em andamento.`,
    }
  }

  const loteResolvido = caixa.lote || (caixa.data_producao ? gerarLotePorData(caixa.data_producao) : '')
  const taraKg = Number(caixa.tara_kg || 0)
  const brutoResolvido = caixa.peso_bruto_kg !== null && caixa.peso_bruto_kg !== undefined
    ? Number(caixa.peso_bruto_kg)
    : Number((Number(caixa.peso_kg || 0) + taraKg).toFixed(3))

  return {
    valid: true,
    caixa: {
      ...caixa,
      endereco_resolvido: enderecoReal,
      lote_resolvido: loteResolvido,
      peso_bruto_resolvido: brutoResolvido,
      tara_kg_resolvido: taraKg,
    },
  }
}

/**
 * Executa o desmembramento de 1 caixa original em 2+ novas caixas com EANs próprios.
 * - Herda obrigatoriamente validade, lote e data de produção da caixa original.
 * - Calcula Peso Líquido = Peso Bruto - Tara selecionada para cada nova caixa.
 * - Consome a caixa original sem duplicar saldo em estoque_posicao.
 */
export async function desmembrarCaixas({
  caixaOrigem,
  novasCaixas,
  operador_id,
  operador_nome,
}) {
  await assertPermissao('desmembramento')
  await ensureRastreabilidadeSchema()
  if (!caixaOrigem?.id) {
    return { success: false, error: 'Caixa original inválida ou não selecionada.' }
  }
  if (!Array.isArray(novasCaixas) || novasCaixas.length < 2) {
    return { success: false, error: 'O desmembramento exige no mínimo 2 novas caixas.' }
  }

  const itensNormalizados = []
  for (let i = 0; i < novasCaixas.length; i++) {
    const item = novasCaixas[i]
    const bruto = Number(Number(item.peso_bruto_kg).toFixed(3))
    const tara = Number(Number(item.tara_kg || 0).toFixed(3))
    const liquido = calcularPesoLiquido(bruto, tara)
    if (!Number.isFinite(bruto) || bruto <= 0) {
      return { success: false, error: `Nova Caixa #${i + 1}: informe um peso bruto válido.` }
    }
    if (!Number.isFinite(liquido) || liquido <= 0) {
      return {
        success: false,
        error: `Nova Caixa #${i + 1}: peso bruto (${bruto.toFixed(2)} kg) deve ser maior que a tara (${tara.toFixed(3)} kg).`,
      }
    }
    itensNormalizados.push({
      tara_id: item.tara_id ? Number(item.tara_id) : null,
      tara_kg: tara,
      peso_bruto_kg: bruto,
      peso_liquido_kg: liquido,
    })
  }

  const novosEans = await tarasQueries.gerarProximosEansInternos(
    itensNormalizados.length,
    caixaOrigem.produto_codigo || ''
  )
  const codigoOperacao = `DSM-${Date.now()}`

  let enderecoFinal = 'DOCA'
  const caixasGeradas = []

  const tx = await db.transaction('write')
  try {
    const { rows: origRows } = await tx.execute({
      sql: `
        SELECT ec.*, pal.endereco_atual AS palete_endereco
        FROM estoque_caixas ec
        LEFT JOIN paletes pal ON ec.palete_id = pal.id
        WHERE ec.id = ?
        LIMIT 1
      `,
      args: [caixaOrigem.id],
    })
    const orig = origRows[0]
    if (!orig) throw new Error('Caixa original não encontrada.')
    if (orig.status !== 'DISPONIVEL') {
      throw new Error(`Caixa original já está com status "${orig.status}".`)
    }

    enderecoFinal = orig.endereco || orig.palete_endereco || 'DOCA'
    const loteFinal = String(orig.lote || (orig.data_producao ? gerarLotePorData(orig.data_producao) : '') || '').trim()
    const dataProdFinal = orig.data_producao || null
    const validadeFinal = orig.validade || null

    // 1. Consumir caixa original
    await tx.execute({
      sql: `UPDATE estoque_caixas SET status = 'CONSUMIDA', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'DISPONIVEL'`,
      args: [orig.id],
    })

    await tx.execute({
      sql: `
        INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora)
        VALUES (?, ?, 'DESMEMBRAMENTO_ORIGEM', ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [
        orig.id,
        orig.ean_caixa,
        `Desmembrada (${codigoOperacao}) em ${itensNormalizados.length} caixas: ${novosEans.join(', ')}`,
        operador_nome || 'Sistema',
      ],
    })

    await tx.execute({
      sql: `
        INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
        VALUES (?, ?, 'DESMEMBRAMENTO', ?, 1, ?, ?, ?, 'DESMEMBRAMENTO')
      `,
      args: [orig.produto_id, enderecoFinal, loteFinal, orig.peso_kg, operador_id || null, operador_nome || 'Sistema'],
    })

    // 2. Inserir cada nova caixa com EAN próprio e vínculo completo de rastreabilidade
    for (let i = 0; i < itensNormalizados.length; i++) {
      const novoEan = novosEans[i]
      const novo = itensNormalizados[i]

      const insCaixa = await tx.execute({
        sql: `
          INSERT INTO estoque_caixas (
            ean_caixa, produto_id, palete_id, palete_origem_id, endereco,
            lote, data_producao, validade, peso_kg, peso_bruto_kg, tara_id, tara_kg,
            origem_tipo, caixa_origem_id, ean_origem, operador_cadastro_nome, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DESMEMBRAMENTO', ?, ?, ?, 'DISPONIVEL')
        `,
        args: [
          novoEan,
          orig.produto_id,
          orig.palete_id || null,
          orig.palete_id || null,
          orig.endereco || enderecoFinal,
          loteFinal,
          dataProdFinal,
          validadeFinal,
          novo.peso_liquido_kg,
          novo.peso_bruto_kg,
          novo.tara_id,
          novo.tara_kg,
          orig.id,
          orig.ean_caixa,
          operador_nome || 'Sistema',
        ],
      })

      const novaCaixaId = Number(insCaixa.lastInsertRowid)

      await tx.execute({
        sql: `
          INSERT INTO desmembramentos_vinculos (
            codigo_operacao, caixa_origem_id, ean_origem, caixa_destino_id, ean_destino,
            produto_id, peso_liquido_kg, peso_bruto_kg, tara_kg, lote, data_producao, validade,
            operador_id, operador_nome
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          codigoOperacao,
          orig.id,
          orig.ean_caixa,
          novaCaixaId,
          novoEan,
          orig.produto_id,
          novo.peso_liquido_kg,
          novo.peso_bruto_kg,
          novo.tara_kg,
          loteFinal,
          dataProdFinal,
          validadeFinal,
          operador_id || null,
          operador_nome || 'Sistema',
        ],
      })

      await tx.execute({
        sql: `
          INSERT INTO caixas_historico (caixa_id, ean_caixa, operacao, detalhes, operador_nome, data_hora)
          VALUES (?, ?, 'DESMEMBRAMENTO_NOVA_CAIXA', ?, ?, CURRENT_TIMESTAMP)
        `,
        args: [
          novaCaixaId,
          novoEan,
          `Gerada de ${orig.ean_caixa} (${codigoOperacao}) • Lote ${loteFinal || '-'} • Bruto ${novo.peso_bruto_kg.toFixed(2)}kg | Tara ${novo.tara_kg.toFixed(3)}kg | Líq ${novo.peso_liquido_kg.toFixed(2)}kg`,
          operador_nome || 'Sistema',
        ],
      })

      await tx.execute({
        sql: `
          INSERT INTO movimentacoes_log (produto_id, endereco_origem, endereco_destino, lote, qtd_caixas, qtd_kg, operador_id, operador_nome, tipo)
          VALUES (?, 'DESMEMBRAMENTO', ?, ?, 1, ?, ?, ?, 'DESMEMBRAMENTO')
        `,
        args: [
          orig.produto_id,
          orig.endereco || enderecoFinal,
          loteFinal,
          novo.peso_liquido_kg,
          operador_id || null,
          operador_nome || 'Sistema',
        ],
      })

      caixasGeradas.push({
        id: novaCaixaId,
        ean_caixa: novoEan,
        ean_origem: orig.ean_caixa,
        produto_id: orig.produto_id,
        produto_codigo: caixaOrigem.produto_codigo || '',
        produto_descricao: caixaOrigem.produto_descricao || '',
        lote: loteFinal,
        data_producao: dataProdFinal,
        validade: validadeFinal,
        peso_bruto_kg: novo.peso_bruto_kg,
        tara_kg: novo.tara_kg,
        peso_liquido_kg: novo.peso_liquido_kg,
        peso_kg: novo.peso_liquido_kg,
        origem_tipo: 'DESMEMBRAMENTO',
      })
    }

    await tx.commit()
  } catch (err) {
    await tx.rollback()
    return { success: false, error: err.message }
  }

  // Recalcular posição agregada do endereço afetado (garante ausência de duplicidade de saldo)
  await recalcularPosicaoEnderecos([enderecoFinal])

  return {
    success: true,
    codigo_operacao: codigoOperacao,
    caixas_geradas: caixasGeradas,
  }
}

export async function listarDesmembramentosRecentes(limite = 30) {
  await assertPermissao(['desmembramento', 'reimpressao', 'rastreabilidade'], { write: false, bloquearCliente: true })
  await ensureRastreabilidadeSchema()
  const { rows } = await db.execute({
    sql: `
      SELECT
        dv.*,
        p.codigo AS produto_codigo,
        p.descricao AS produto_descricao
      FROM desmembramentos_vinculos dv
      JOIN produtos p ON dv.produto_id = p.id
      ORDER BY dv.id DESC
      LIMIT ?
    `,
    args: [Number(limite) || 30],
  })
  return rows
}
