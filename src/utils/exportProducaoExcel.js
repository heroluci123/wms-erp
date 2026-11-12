import ExcelJS from 'exceljs'

function toExcelDateOnly(str) {
  if (!str) return null
  const part = String(str).slice(0, 10)
  const [y, m, d] = part.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
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
    subHeaderBg: 'FFE2E8F0',
    zebraBg: 'FFF8FAFC',
    totalBg: 'FFDCFCE7',
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

  const consEndRow = Math.max(5, 4 + dossies.length)
  const totCons = wsCons.getRow(consEndRow + 1)
  totCons.getCell(1).value = 'TOTAIS'
  totCons.getCell(2).value = `${dossies.length} OP(s)`
  totCons.getCell(7).value = dossies.length > 0 ? { formula: `SUM(G5:G${consEndRow})`, result: dossies.reduce((s, d) => s + Number(d.total_entrada_caixas || d.insumos?.length || 0), 0) } : 0
  totCons.getCell(8).value = dossies.length > 0 ? { formula: `SUM(H5:H${consEndRow})`, result: dossies.reduce((s, d) => s + Number(d.total_entrada_bruto_kg || d.total_entrada_kg || 0), 0) } : 0
  totCons.getCell(9).value = dossies.length > 0 ? { formula: `SUM(I5:I${consEndRow})`, result: totalEntLiq } : 0
  totCons.getCell(10).value = dossies.length > 0 ? { formula: `SUM(J5:J${consEndRow})`, result: dossies.reduce((s, d) => s + Number(d.total_saida_caixas || d.retornos?.length || 0), 0) } : 0
  totCons.getCell(11).value = dossies.length > 0 ? { formula: `SUM(K5:K${consEndRow})`, result: totalSaiBruto } : 0
  totCons.getCell(12).value = dossies.length > 0 ? { formula: `SUM(L5:L${consEndRow})`, result: Math.max(0, totalSaiBruto - totalSaiLiq) } : 0
  totCons.getCell(13).value = dossies.length > 0 ? { formula: `SUM(M5:M${consEndRow})`, result: totalSaiLiq } : 0
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
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } },
    }
    if (c >= 7) cell.alignment = { vertical: 'middle', horizontal: 'right' }
  }
  totCons.height = 23

  wsCons.autoFilter = `A4:N${consEndRow}`
  wsCons.columns = [
    { width: 13 }, { width: 32 }, { width: 14 }, { width: 18 }, { width: 13 }, { width: 16 },
    { width: 12 }, { width: 17 }, { width: 17 }, { width: 11 }, { width: 17 }, { width: 15 },
    { width: 17 }, { width: 22 },
  ]

  // =========================================================================
  // ABA 2: ANALÍTICO CAIXA A CAIXA (ENTRADAS E SAÍDAS)
  // =========================================================================
  const wsDet = wb.addWorksheet('Analítico Entradas e Saídas', {
    views: [{ state: 'frozen', ySplit: 4 }],
  })

  wsDet.mergeCells('A1:N1')
  wsDet.getCell('A1').value = 'TRICARNES — RASTREABILIDADE ANALÍTICA DE PRODUÇÃO (ENTRADAS VS SAÍDAS GERADAS)'
  wsDet.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  wsDet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.indigoDark } }
  wsDet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsDet.getRow(1).height = 28

  wsDet.mergeCells('A2:N2')
  wsDet.getCell('A2').value = `Filtro: ${periodoTxt}  |  Todas as caixas bipadas na Entrada (Insumos) e geradas na Saída (Etiquetas Próprias)`
  wsDet.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } }
  wsDet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } }
  wsDet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsDet.getRow(2).height = 20
  wsDet.getRow(3).height = 8

  const headersDet = [
    'OP Código', 'OP Nome', 'Status OP', 'Tipo Movimento', 'Código Prod.', 'Produto',
    'EAN da Caixa', 'Lote (DDMMYY)', 'Data Produção', 'Validade',
    'Tara (Kg)', 'Peso Bruto (Kg)', 'Peso Líquido (Kg)', 'Situação / Rastreabilidade'
  ]
  const hRowDet = wsDet.getRow(4)
  headersDet.forEach((h, idx) => {
    const c = hRowDet.getCell(idx + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } }
    c.alignment = { vertical: 'middle', horizontal: idx >= 10 && idx <= 12 ? 'right' : 'center' }
    c.border = thinBorder
  })
  hRowDet.height = 24

  const linhasDet = []
  dossies.forEach((op) => {
    ;(op.insumos || []).forEach((ins) => {
      const liq = Number(ins.peso_kg || 0)
      const tara = Number(ins.tara_kg || 0)
      const bruto = ins.peso_bruto_kg != null ? Number(ins.peso_bruto_kg) : Number((liq + tara).toFixed(2))
      linhasDet.push({
        isSaida: false,
        opCodigo: op.codigo,
        opNome: op.nome,
        opStatus: op.status,
        tipo: 'ENTRADA (INSUMO)',
        codProd: ins.produto_codigo || '',
        descProd: ins.produto_descricao || '',
        ean: ins.ean_caixa || '',
        lote: ins.lote || '-',
        dataProd: toExcelDateOnly(ins.data_producao),
        validade: toExcelDateOnly(ins.validade),
        tara,
        bruto,
        liquido: liq,
        situacao: `Consumida OP ${op.codigo}`,
      })
    })
    ;(op.retornos || []).forEach((ret) => {
      const liq = Number(ret.peso_kg || 0)
      const tara = Number(ret.tara_kg || 0)
      const bruto = ret.peso_bruto_kg != null ? Number(ret.peso_bruto_kg) : Number((liq + tara).toFixed(2))
      linhasDet.push({
        isSaida: true,
        opCodigo: op.codigo,
        opNome: op.nome,
        opStatus: op.status,
        tipo: 'SAÍDA (PRODUÇÃO)',
        codProd: ret.produto_codigo || '',
        descProd: ret.produto_descricao || '',
        ean: ret.ean_caixa || '',
        lote: ret.lote || '-',
        dataProd: toExcelDateOnly(ret.data_producao || op.data_producao),
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

  linhasDet.forEach((item, idx) => {
    const row = wsDet.getRow(5 + idx)
    row.getCell(1).value = item.opCodigo
    row.getCell(2).value = item.opNome
    row.getCell(3).value = item.opStatus
    row.getCell(4).value = item.tipo
    row.getCell(5).value = String(item.codProd)
    row.getCell(6).value = item.descProd
    row.getCell(7).value = String(item.ean)
    row.getCell(8).value = item.lote
    row.getCell(9).value = item.dataProd
    row.getCell(10).value = item.validade
    row.getCell(11).value = item.tara
    row.getCell(12).value = item.bruto
    row.getCell(13).value = item.liquido
    row.getCell(14).value = item.situacao

    row.getCell(5).numFmt = '@'
    row.getCell(7).numFmt = '@'
    if (item.dataProd) row.getCell(9).numFmt = 'dd/mm/yyyy'
    if (item.validade) row.getCell(10).numFmt = 'dd/mm/yyyy'
    row.getCell(11).numFmt = '#,##0.000'
    row.getCell(12).numFmt = '#,##0.00'
    row.getCell(13).numFmt = '#,##0.00'

    const bg = item.isSaida ? COLORS.saidaBg : COLORS.entradaBg
    for (let c = 1; c <= 14; c++) {
      const cell = row.getCell(c)
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.border = thinBorder
      cell.alignment = {
        vertical: 'middle',
        horizontal: [11, 12, 13].includes(c) ? 'right' : ([1, 3, 4, 5, 8, 9, 10].includes(c) ? 'center' : 'left'),
      }
    }
    row.getCell(7).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } }
    row.getCell(13).font = { name: 'Calibri', size: 10, bold: true, color: { argb: item.isSaida ? 'FF047857' : 'FFB45309' } }
    row.height = 19
  })

  const detEndRow = Math.max(5, 4 + linhasDet.length)
  wsDet.autoFilter = `A4:N${detEndRow}`
  wsDet.columns = [
    { width: 12 }, { width: 26 }, { width: 12 }, { width: 20 }, { width: 12 }, { width: 34 },
    { width: 20 }, { width: 14 }, { width: 14 }, { width: 13 }, { width: 12 }, { width: 16 },
    { width: 16 }, { width: 24 },
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
