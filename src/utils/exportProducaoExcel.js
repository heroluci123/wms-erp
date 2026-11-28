import ExcelJS from 'exceljs'

function toExcelDateOnly(str) {
  if (!str) return null
  if (str instanceof Date) {
    if (isNaN(str.getTime())) return null
    return new Date(Date.UTC(str.getUTCFullYear(), str.getUTCMonth(), str.getUTCDate()))
  }
  const part = String(str).slice(0, 10)
  const [y, m, d] = part.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}

function toExcelDateOnlyBRT(val) {
  if (!val) return null
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null
    const brt = new Date(val.getTime() - 3 * 3600 * 1000)
    return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()))
  }
  const raw = String(val).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toExcelDateOnly(raw)
  const iso = raw.replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? '' : 'Z')
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return toExcelDateOnly(raw)
  const brt = new Date(dt.getTime() - 3 * 3600 * 1000)
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()))
}

function dateToIsoKey(dt) {
  if (!dt) return ''
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function fmtDateBR(str) {
  if (!str) return '-'
  const p = String(str).slice(0, 10).split('-')
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`
  return str
}

export async function exportProducaoExcel({
  dossies = [],
  dataInicio = '',
  dataFim = '',
  opSelecionadaLabel = '',
}) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'WMSphere ERP — Tricarnes'
  wb.created = new Date()
  wb.calcProperties.fullCalcOnLoad = true

  const COLORS = {
    navyDark: 'FF0F172A',
    slateHeader: 'FF1E293B',
    indigoDark: 'FF1E3A8A',
    amberDark: 'FF92400E',
    emeraldDark: 'FF065F46',
    subHeaderBg: 'FFE2E8F0',
    zebraBg: 'FFF8FAFC',
    totalBg: 'FFDCFCE7',
    totalEntradaBg: 'FFFEF3C7',
    entradaBg: 'FFFFF7ED',
    saidaBg: 'FFF0FDF4',
    borderGray: 'FFCBD5E1',
  }

  const thinBorder = {
    top: { style: 'thin', color: { argb: COLORS.borderGray } },
    left: { style: 'thin', color: { argb: COLORS.borderGray } },
    bottom: { style: 'thin', color: { argb: COLORS.borderGray } },
    right: { style: 'thin', color: { argb: COLORS.borderGray } },
  }

  const totalBorder = {
    top: { style: 'medium', color: { argb: COLORS.navyDark } },
    bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
    left: { style: 'thin', color: { argb: COLORS.borderGray } },
    right: { style: 'thin', color: { argb: COLORS.borderGray } },
  }

  const periodoTxt = opSelecionadaLabel || `${fmtDateBR(dataInicio)} a ${fmtDateBR(dataFim)}`

  // =========================================================================
  // ABA 1: CONSOLIDAÇÃO POR ORDEM DE PRODUÇÃO (OP)
  // =========================================================================
  const wsCons = wb.addWorksheet('Consolidação OPs', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })

  wsCons.mergeCells('A1:N1')
  wsCons.getCell('A1').value = 'TRICARNES ALIMENTOS LTDA. — RELATÓRIO CONSOLIDADO DE ORDENS DE PRODUÇÃO (OP)'
  wsCons.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  wsCons.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } }
  wsCons.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsCons.getRow(1).height = 28

  const totalEntLiq = dossies.reduce((s, d) => s + Number(d.total_entrada_kg || 0), 0)
  const totalSaiBruto = dossies.reduce((s, d) => s + Number(d.total_saida_bruto_kg || 0), 0)
  const totalSaiLiq = dossies.reduce((s, d) => s + Number(d.total_saida_kg || 0), 0)
  const rendGeral = totalEntLiq > 0 ? (totalSaiLiq / totalEntLiq) : 0

  wsCons.mergeCells('A2:N2')
  wsCons.getCell('A2').value = `Filtro: ${periodoTxt}  |  OPs Listadas: ${dossies.length}  |  Entrada Líq.: ${totalEntLiq.toFixed(2).replace('.', ',')} kg  |  Saída Líq.: ${totalSaiLiq.toFixed(2).replace('.', ',')} kg  |  Rendimento Global: ${(rendGeral * 100).toFixed(1)}%`
  wsCons.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } }
  wsCons.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } }
  wsCons.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsCons.getRow(2).height = 20
  wsCons.getRow(3).height = 8

  const headersCons = [
    'OP Código', 'Descrição OP', 'Data Abertura', 'Criador', 'Status OP', 'Cliente',
    'Cx Entrada', 'Entrada Bruto (Kg)', 'Entrada Líq. (Kg)',
    'Cx Saída', 'Saída Bruto (Kg)', 'Tara Saída (Kg)', 'Saída Líq. (Kg)', 'Diferença (Kg) / Rend.'
  ]
  const hRowCons = wsCons.getRow(4)
  headersCons.forEach((h, idx) => {
    const c = hRowCons.getCell(idx + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } }
    c.alignment = { vertical: 'middle', horizontal: idx >= 6 ? 'right' : 'center' }
    c.border = thinBorder
  })
  hRowCons.height = 24

  dossies.forEach((op, idx) => {
    const row = wsCons.getRow(5 + idx)
    const dtOp = toExcelDateOnly(op.data_producao)
    const entCx = Number(op.total_entrada_caixas ?? op.insumos?.length ?? 0)
    const entBruto = Number(op.total_entrada_bruto_kg ?? op.total_entrada_kg ?? 0)
    const entLiq = Number(op.total_entrada_kg ?? 0)
    const saiCx = Number(op.total_saida_caixas ?? op.retornos?.length ?? 0)
    const saiBruto = Number(op.total_saida_bruto_kg ?? op.total_saida_kg ?? 0)
    const saiLiq = Number(op.total_saida_kg ?? 0)
    const taraTot = Number(Math.max(0, saiBruto - saiLiq).toFixed(3))
    const diff = Number(op.diferenca_kg ?? (saiLiq - entLiq))
    const rendPct = Number(op.rendimento_calc ?? (entLiq > 0 ? (saiLiq / entLiq) * 100 : 0))

    row.getCell(1).value = op.codigo || ''
    row.getCell(2).value = op.nome || ''
    row.getCell(3).value = dtOp
    row.getCell(4).value = op.criado_por_nome || op.operador_nome || '-'
    row.getCell(5).value = op.status || '-'
    row.getCell(6).value = op.cliente || 'PAVAN'
    row.getCell(7).value = entCx
    row.getCell(8).value = entBruto
    row.getCell(9).value = entLiq
    row.getCell(10).value = saiCx
    row.getCell(11).value = saiBruto
    row.getCell(12).value = taraTot
    row.getCell(13).value = saiLiq
    row.getCell(14).value = `${diff >= 0 ? '+' : ''}${diff.toFixed(2).replace('.', ',')} kg (${rendPct.toFixed(1)}%)`

    if (dtOp) row.getCell(3).numFmt = 'dd/mm/yyyy'
    row.getCell(7).numFmt = '#,##0'
    row.getCell(8).numFmt = '#,##0.00'
    row.getCell(9).numFmt = '#,##0.00'
    row.getCell(10).numFmt = '#,##0'
    row.getCell(11).numFmt = '#,##0.00'
    row.getCell(12).numFmt = '#,##0.000'
    row.getCell(13).numFmt = '#,##0.00'

    for (let c = 1; c <= 14; c++) {
      const cell = row.getCell(c)
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } }
      cell.border = thinBorder
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } }
      cell.alignment = {
        vertical: 'middle',
        horizontal: c >= 7 ? 'right' : ([1, 3, 5, 6].includes(c) ? 'center' : 'left'),
      }
    }
    row.getCell(1).font = { name: 'Consolas', size: 10, bold: true, color: { argb: COLORS.indigoDark } }
    row.getCell(9).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB45309' } }
    row.getCell(13).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF047857' } }
    row.height = 20
  })

  const consEndRow = 4 + dossies.length
  const totCons = wsCons.getRow(consEndRow + 1)
  totCons.getCell(1).value = 'TOTAIS'
  totCons.getCell(2).value = `${dossies.length} OP(s)`
  totCons.getCell(7).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,G5:G${consEndRow})`, result: dossies.reduce((s, d) => s + Number(d.total_entrada_caixas || d.insumos?.length || 0), 0) } : 0
  totCons.getCell(8).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,H5:H${consEndRow})`, result: dossies.reduce((s, d) => s + Number(d.total_entrada_bruto_kg || d.total_entrada_kg || 0), 0) } : 0
  totCons.getCell(9).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,I5:I${consEndRow})`, result: totalEntLiq } : 0
  totCons.getCell(10).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,J5:J${consEndRow})`, result: dossies.reduce((s, d) => s + Number(d.total_saida_caixas || d.retornos?.length || 0), 0) } : 0
  totCons.getCell(11).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,K5:K${consEndRow})`, result: totalSaiBruto } : 0
  totCons.getCell(12).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,L5:L${consEndRow})`, result: Math.max(0, totalSaiBruto - totalSaiLiq) } : 0
  totCons.getCell(13).value = dossies.length > 0 ? { formula: `SUBTOTAL(109,M5:M${consEndRow})`, result: totalSaiLiq } : 0
  totCons.getCell(14).value = `${(totalSaiLiq - totalEntLiq) >= 0 ? '+' : ''}${(totalSaiLiq - totalEntLiq).toFixed(2).replace('.', ',')} kg (${(rendGeral * 100).toFixed(1)}%)`

  totCons.getCell(7).numFmt = '#,##0'
  totCons.getCell(8).numFmt = '#,##0.00'
  totCons.getCell(9).numFmt = '#,##0.00'
  totCons.getCell(10).numFmt = '#,##0'
  totCons.getCell(11).numFmt = '#,##0.00'
  totCons.getCell(12).numFmt = '#,##0.000'
  totCons.getCell(13).numFmt = '#,##0.00'

  for (let c = 1; c <= 14; c++) {
    const cell = totCons.getCell(c)
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } }
    cell.border = totalBorder
    if (c >= 7) cell.alignment = { vertical: 'middle', horizontal: 'right' }
  }
  totCons.height = 23

  wsCons.autoFilter = `A4:N${Math.max(4, consEndRow)}`
  wsCons.columns = [
    { width: 13 }, { width: 32 }, { width: 14 }, { width: 18 }, { width: 13 }, { width: 16 },
    { width: 12 }, { width: 17 }, { width: 17 }, { width: 11 }, { width: 17 }, { width: 15 },
    { width: 17 }, { width: 22 },
  ]

  // Coletar separadamente Entradas (Insumos) e Saídas (Produção)
  const linhasEnt = []
  const linhasSai = []

  dossies.forEach((op) => {
    ;(op.insumos || []).forEach((ins) => {
      const liq = Number(ins.peso_kg || 0)
      const tara = Number(ins.tara_kg || 0)
      const bruto = ins.peso_bruto_kg != null && Number(ins.peso_bruto_kg) > 0
        ? Number(ins.peso_bruto_kg)
        : Number((liq + tara).toFixed(2))
      const dataEntradaOp = toExcelDateOnlyBRT(ins.data_entrada || ins.created_at || op.data_producao)
      const dataEntradaEst = toExcelDateOnlyBRT(ins.data_entrada_estoque || ins.data_entrada || ins.created_at)
      const dataProd = toExcelDateOnly(ins.data_producao)
      linhasEnt.push({
        dataEntradaOp,
        dataEntradaEst,
        dataProd,
        sortKey: dateToIsoKey(dataEntradaOp || dataProd),
        opCodigo: op.codigo || '',
        opNome: op.nome || '',
        opStatus: op.status || '-',
        codProd: String(ins.produto_codigo || ''),
        descProd: ins.produto_descricao || '',
        ean: String(ins.ean_caixa || ''),
        lote: ins.lote || '-',
        validade: toExcelDateOnly(ins.validade),
        tara,
        bruto,
        liquido: liq,
        situacao: `Consumida ${op.codigo || 'OP'}`,
      })
    })

    ;(op.retornos || []).forEach((ret) => {
      const liq = Number(ret.peso_kg || 0)
      const tara = Number(ret.tara_kg || 0)
      const bruto = ret.peso_bruto_kg != null && Number(ret.peso_bruto_kg) > 0
        ? Number(ret.peso_bruto_kg)
        : Number((liq + tara).toFixed(2))
      const dataProd = toExcelDateOnly(ret.data_producao || op.data_producao)
      const dataEntrada = toExcelDateOnlyBRT(ret.data_entrada || ret.created_at || ret.data_producao || op.data_producao)
      linhasSai.push({
        dataProd,
        dataEntrada,
        sortKey: dateToIsoKey(dataProd || dataEntrada),
        opCodigo: op.codigo || '',
        opNome: op.nome || '',
        opStatus: op.status || '-',
        codProd: String(ret.produto_codigo || ''),
        descProd: ret.produto_descricao || '',
        ean: String(ret.ean_caixa || ''),
        lote: ret.lote || '-',
        validade: toExcelDateOnly(ret.validade),
        tara,
        bruto,
        liquido: liq,
        situacao: ret.caixa_status === 'EXPEDIDA'
          ? `Expedida (${ret.romaneio_codigo || 'Romaneio'})`
          : `Estoque (${ret.caixa_endereco || op.endereco || 'PRODUCAO'})`,
      })
    })
  })

  linhasEnt.sort(
    (a, b) =>
      a.sortKey.localeCompare(b.sortKey) ||
      a.opCodigo.localeCompare(b.opCodigo, undefined, { numeric: true }) ||
      a.descProd.localeCompare(b.descProd, 'pt-BR') ||
      a.ean.localeCompare(b.ean),
  )

  linhasSai.sort(
    (a, b) =>
      a.sortKey.localeCompare(b.sortKey) ||
      a.opCodigo.localeCompare(b.opCodigo, undefined, { numeric: true }) ||
      a.descProd.localeCompare(b.descProd, 'pt-BR') ||
      a.ean.localeCompare(b.ean),
  )

  // =========================================================================
  // ABA 2: ENTRADAS (INSUMOS CONSUMIDOS NAS OPs)
  // =========================================================================
  const wsEnt = wb.addWorksheet('Entradas (Insumos)', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })

  const entSumTara = linhasEnt.reduce((s, r) => s + r.tara, 0)
  const entSumBruto = linhasEnt.reduce((s, r) => s + r.bruto, 0)
  const entSumLiq = linhasEnt.reduce((s, r) => s + r.liquido, 0)

  wsEnt.mergeCells('A1:P1')
  wsEnt.getCell('A1').value = 'TRICARNES — ENTRADAS DE PRODUÇÃO (INSUMOS CONSUMIDOS NAS OPs)'
  wsEnt.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  wsEnt.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberDark } }
  wsEnt.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsEnt.getRow(1).height = 28

  wsEnt.mergeCells('A2:P2')
  wsEnt.getCell('A2').value = `Filtro: ${periodoTxt}  |  Caixas de Entrada: ${linhasEnt.length} cx  |  Peso Bruto: ${entSumBruto.toFixed(2).replace('.', ',')} kg  |  Peso Líquido Total: ${entSumLiq.toFixed(2).replace('.', ',')} kg`
  wsEnt.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } }
  wsEnt.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } }
  wsEnt.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsEnt.getRow(2).height = 20
  wsEnt.getRow(3).height = 8

  const headersEnt = [
    'Data Entrada (OP)', 'Data Entrada (Estoque)', 'Data Produção',
    'OP Código', 'OP Nome', 'Status OP', 'Código Prod.', 'Produto',
    'Código de Barras', 'Lote', 'Validade',
    'Qtd. CX', 'Tara (Kg)', 'Peso Bruto (Kg)', 'Peso Líquido (Kg)', 'Situação / Rastreabilidade'
  ]
  const hRowEnt = wsEnt.getRow(4)
  headersEnt.forEach((h, idx) => {
    const c = hRowEnt.getCell(idx + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } }
    c.alignment = { vertical: 'middle', horizontal: [11, 12, 13, 14].includes(idx) ? 'right' : 'center' }
    c.border = thinBorder
  })
  hRowEnt.height = 24

  linhasEnt.forEach((item, idx) => {
    const row = wsEnt.getRow(5 + idx)
    row.getCell(1).value = item.dataEntradaOp
    row.getCell(2).value = item.dataEntradaEst
    row.getCell(3).value = item.dataProd
    row.getCell(4).value = item.opCodigo
    row.getCell(5).value = item.opNome
    row.getCell(6).value = item.opStatus
    row.getCell(7).value = item.codProd
    row.getCell(8).value = item.descProd
    row.getCell(9).value = item.ean
    row.getCell(10).value = item.lote
    row.getCell(11).value = item.validade
    row.getCell(12).value = 1
    row.getCell(13).value = item.tara
    row.getCell(14).value = item.bruto
    row.getCell(15).value = item.liquido
    row.getCell(16).value = item.situacao

    if (item.dataEntradaOp) row.getCell(1).numFmt = 'dd/mm/yyyy'
    if (item.dataEntradaEst) row.getCell(2).numFmt = 'dd/mm/yyyy'
    if (item.dataProd) row.getCell(3).numFmt = 'dd/mm/yyyy'
    row.getCell(7).numFmt = '@'
    row.getCell(9).numFmt = '@'
    if (item.validade) row.getCell(11).numFmt = 'dd/mm/yyyy'
    row.getCell(12).numFmt = '#,##0'
    row.getCell(13).numFmt = '#,##0.000'
    row.getCell(14).numFmt = '#,##0.00'
    row.getCell(15).numFmt = '#,##0.00'

    for (let c = 1; c <= 16; c++) {
      const cell = row.getCell(c)
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 1 ? COLORS.entradaBg : 'FFFFFFFF' } }
      cell.border = thinBorder
      cell.alignment = {
        vertical: 'middle',
        horizontal: [12, 13, 14, 15].includes(c)
          ? 'right'
          : ([1, 2, 3, 4, 6, 7, 9, 10, 11].includes(c) ? 'center' : 'left'),
      }
    }
    row.getCell(4).font = { name: 'Consolas', size: 10, bold: true, color: { argb: COLORS.indigoDark } }
    row.getCell(9).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } }
    row.getCell(15).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB45309' } }
    row.height = 19
  })

  const entEndRow = 4 + linhasEnt.length
  const totEnt = wsEnt.getRow(entEndRow + 1)
  totEnt.getCell(1).value = 'TOTAIS'
  totEnt.getCell(8).value = `${linhasEnt.length} caixa(s) de entrada`
  totEnt.getCell(12).value = linhasEnt.length > 0 ? { formula: `SUBTOTAL(109,L5:L${entEndRow})`, result: linhasEnt.length } : 0
  totEnt.getCell(13).value = linhasEnt.length > 0 ? { formula: `SUBTOTAL(109,M5:M${entEndRow})`, result: Number(entSumTara.toFixed(3)) } : 0
  totEnt.getCell(14).value = linhasEnt.length > 0 ? { formula: `SUBTOTAL(109,N5:N${entEndRow})`, result: Number(entSumBruto.toFixed(2)) } : 0
  totEnt.getCell(15).value = linhasEnt.length > 0 ? { formula: `SUBTOTAL(109,O5:O${entEndRow})`, result: Number(entSumLiq.toFixed(2)) } : 0
  totEnt.getCell(12).numFmt = '#,##0'
  totEnt.getCell(13).numFmt = '#,##0.000'
  totEnt.getCell(14).numFmt = '#,##0.00'
  totEnt.getCell(15).numFmt = '#,##0.00'

  for (let c = 1; c <= 16; c++) {
    const cell = totEnt.getCell(c)
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalEntradaBg } }
    cell.border = totalBorder
    if ([12, 13, 14, 15].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' }
  }
  totEnt.height = 22

  wsEnt.autoFilter = `A4:P${Math.max(4, entEndRow)}`
  wsEnt.columns = [
    { width: 17 }, { width: 21 }, { width: 15 }, { width: 12 }, { width: 26 }, { width: 12 },
    { width: 12 }, { width: 34 }, { width: 21 }, { width: 13 }, { width: 13 },
    { width: 10 }, { width: 12 }, { width: 16 }, { width: 17 }, { width: 24 },
  ]

  // =========================================================================
  // ABA 3: SAÍDAS (PRODUÇÃO GERADA NAS OPs)
  // =========================================================================
  const wsSai = wb.addWorksheet('Saídas (Produção)', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })

  const saiSumTara = linhasSai.reduce((s, r) => s + r.tara, 0)
  const saiSumBruto = linhasSai.reduce((s, r) => s + r.bruto, 0)
  const saiSumLiq = linhasSai.reduce((s, r) => s + r.liquido, 0)

  wsSai.mergeCells('A1:O1')
  wsSai.getCell('A1').value = 'TRICARNES — SAÍDAS DE PRODUÇÃO (CAIXAS GERADAS NAS OPs)'
  wsSai.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  wsSai.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.emeraldDark } }
  wsSai.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsSai.getRow(1).height = 28

  wsSai.mergeCells('A2:O2')
  wsSai.getCell('A2').value = `Filtro: ${periodoTxt}  |  Caixas Produzidas: ${linhasSai.length} cx  |  Peso Bruto: ${saiSumBruto.toFixed(2).replace('.', ',')} kg  |  Peso Líquido Total: ${saiSumLiq.toFixed(2).replace('.', ',')} kg`
  wsSai.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } }
  wsSai.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } }
  wsSai.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsSai.getRow(2).height = 20
  wsSai.getRow(3).height = 8

  const headersSai = [
    'Data Produção', 'Data Entrada',
    'OP Código', 'OP Nome', 'Status OP', 'Código Prod.', 'Produto',
    'Código de Barras', 'Lote', 'Validade',
    'Qtd. CX', 'Tara (Kg)', 'Peso Bruto (Kg)', 'Peso Líquido (Kg)', 'Situação / Rastreabilidade'
  ]
  const hRowSai = wsSai.getRow(4)
  headersSai.forEach((h, idx) => {
    const c = hRowSai.getCell(idx + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } }
    c.alignment = { vertical: 'middle', horizontal: [10, 11, 12, 13].includes(idx) ? 'right' : 'center' }
    c.border = thinBorder
  })
  hRowSai.height = 24

  linhasSai.forEach((item, idx) => {
    const row = wsSai.getRow(5 + idx)
    row.getCell(1).value = item.dataProd
    row.getCell(2).value = item.dataEntrada
    row.getCell(3).value = item.opCodigo
    row.getCell(4).value = item.opNome
    row.getCell(5).value = item.opStatus
    row.getCell(6).value = item.codProd
    row.getCell(7).value = item.descProd
    row.getCell(8).value = item.ean
    row.getCell(9).value = item.lote
    row.getCell(10).value = item.validade
    row.getCell(11).value = 1
    row.getCell(12).value = item.tara
    row.getCell(13).value = item.bruto
    row.getCell(14).value = item.liquido
    row.getCell(15).value = item.situacao

    if (item.dataProd) row.getCell(1).numFmt = 'dd/mm/yyyy'
    if (item.dataEntrada) row.getCell(2).numFmt = 'dd/mm/yyyy'
    row.getCell(6).numFmt = '@'
    row.getCell(8).numFmt = '@'
    if (item.validade) row.getCell(10).numFmt = 'dd/mm/yyyy'
    row.getCell(11).numFmt = '#,##0'
    row.getCell(12).numFmt = '#,##0.000'
    row.getCell(13).numFmt = '#,##0.00'
    row.getCell(14).numFmt = '#,##0.00'

    for (let c = 1; c <= 15; c++) {
      const cell = row.getCell(c)
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 1 ? COLORS.saidaBg : 'FFFFFFFF' } }
      cell.border = thinBorder
      cell.alignment = {
        vertical: 'middle',
        horizontal: [11, 12, 13, 14].includes(c)
          ? 'right'
          : ([1, 2, 3, 5, 6, 8, 9, 10].includes(c) ? 'center' : 'left'),
      }
    }
    row.getCell(3).font = { name: 'Consolas', size: 10, bold: true, color: { argb: COLORS.indigoDark } }
    row.getCell(8).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } }
    row.getCell(14).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF047857' } }
    row.height = 19
  })

  const saiEndRow = 4 + linhasSai.length
  const totSai = wsSai.getRow(saiEndRow + 1)
  totSai.getCell(1).value = 'TOTAIS'
  totSai.getCell(7).value = `${linhasSai.length} caixa(s) produzida(s)`
  totSai.getCell(11).value = linhasSai.length > 0 ? { formula: `SUBTOTAL(109,K5:K${saiEndRow})`, result: linhasSai.length } : 0
  totSai.getCell(12).value = linhasSai.length > 0 ? { formula: `SUBTOTAL(109,L5:L${saiEndRow})`, result: Number(saiSumTara.toFixed(3)) } : 0
  totSai.getCell(13).value = linhasSai.length > 0 ? { formula: `SUBTOTAL(109,M5:M${saiEndRow})`, result: Number(saiSumBruto.toFixed(2)) } : 0
  totSai.getCell(14).value = linhasSai.length > 0 ? { formula: `SUBTOTAL(109,N5:N${saiEndRow})`, result: Number(saiSumLiq.toFixed(2)) } : 0
  totSai.getCell(11).numFmt = '#,##0'
  totSai.getCell(12).numFmt = '#,##0.000'
  totSai.getCell(13).numFmt = '#,##0.00'
  totSai.getCell(14).numFmt = '#,##0.00'

  for (let c = 1; c <= 15; c++) {
    const cell = totSai.getCell(c)
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } }
    cell.border = totalBorder
    if ([11, 12, 13, 14].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' }
  }
  totSai.height = 22

  wsSai.autoFilter = `A4:O${Math.max(4, saiEndRow)}`
  wsSai.columns = [
    { width: 15 }, { width: 15 }, { width: 12 }, { width: 26 }, { width: 12 },
    { width: 12 }, { width: 34 }, { width: 21 }, { width: 13 }, { width: 13 },
    { width: 10 }, { width: 12 }, { width: 16 }, { width: 17 }, { width: 26 },
  ]

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Relatorio_Producao_OPs_${dataInicio || 'Inicio'}_a_${dataFim || 'Hoje'}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
