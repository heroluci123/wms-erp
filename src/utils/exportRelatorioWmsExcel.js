import ExcelJS from 'exceljs';

function toExcelDateOnly(str) {
  if (!str) return null;
  const part = String(str).slice(0, 10);
  const [y, m, d] = part.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toExcelDateTimeBRT(str) {
  if (!str) return null;
  if (str instanceof Date) {
    if (isNaN(str.getTime())) return null;
    return new Date(str.getTime() - 3 * 3600 * 1000);
  }
  const raw = String(str).trim();
  const s = raw.replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? '' : 'Z');
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getTime() - 3 * 3600 * 1000);
}

function toExcelDateOnlyBRT(str) {
  if (!str) return null;
  const raw = typeof str === 'string' ? str.trim() : '';
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return toExcelDateOnly(raw);
  const brt = toExcelDateTimeBRT(str);
  if (!brt) return toExcelDateOnly(raw);
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()));
}

function dateToIsoKey(dt) {
  if (!dt) return '';
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function fmtDateTimeBRT(str) {
  const dt = toExcelDateTimeBRT(str);
  if (!dt) return '-';
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const min = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function fmtDateBR(str) {
  if (!str) return '-';
  const p = String(str).slice(0, 10).split('-');
  if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
  return str;
}

function daysBetweenDateOnly(dateStr) {
  if (!dateStr) return null;
  const d1 = toExcelDateOnly(dateStr);
  const todayStr = new Date().toISOString().slice(0, 10);
  const d2 = toExcelDateOnly(todayStr);
  if (!d1 || !d2) return null;
  return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
}

export async function exportRelatorioWmsExcel({
  estoqueAtual = [],
  romaneios = [],
  saidasItens = [],
  entradasCaixas = [],
  dataInicio = '',
  dataFim = ''
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WMSphere ERP';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const COLORS = {
    navyDark: 'FF0F172A',
    slateHeader: 'FF1E293B',
    emeraldDark: 'FF065F46',
    indigoDark: 'FF1E3A8A',
    subHeaderBg: 'FFE2E8F0',
    zebraBg: 'FFF8FAFC',
    totalBg: 'FFE2E8F0',
    romTotalBg: 'FFDCFCE7',
    borderGray: 'FFCBD5E1',
    redText: 'FFB91C1C',
    redBg: 'FFFEE2E2',
    amberText: 'FFB45309',
    amberBg: 'FFFEF3C7',
    greenText: 'FF047857',
    blueText: 'FF1D4ED8'
  };

  const thinBorder = {
    top: { style: 'thin', color: { argb: COLORS.borderGray } },
    left: { style: 'thin', color: { argb: COLORS.borderGray } },
    bottom: { style: 'thin', color: { argb: COLORS.borderGray } },
    right: { style: 'thin', color: { argb: COLORS.borderGray } }
  };

  const saidasEfetivas = saidasItens.length > 0
    ? saidasItens
    : romaneios.flatMap((rom) =>
        (rom.itens || []).map((it) => ({
          ...it,
          romaneio_id: it.romaneio_id ?? rom.id,
          romaneio_codigo: it.romaneio_codigo ?? rom.codigo,
          romaneio_cliente: it.romaneio_cliente ?? rom.cliente,
          romaneio_status: it.romaneio_status ?? rom.status,
          romaneio_criado_em: it.romaneio_criado_em ?? rom.created_at,
          romaneio_expedido_em: it.romaneio_expedido_em ?? rom.expedido_at,
          pedido_codigo: it.pedido_codigo ?? rom.pedido_codigo,
          numero_nf: it.numero_nf ?? rom.numero_nf,
        }))
      );

  const totalEstoqueKg = estoqueAtual.reduce((s, r) => s + Number(r.peso_kg || 0), 0);
  const totalSaidaKg = saidasEfetivas.reduce((s, r) => s + Number(r.peso_kg || 0), 0);
  const totalEntradaKg = entradasCaixas.reduce((s, r) => s + Number(r.peso_kg || 0), 0);
  const totalEntradaBrutoKg = entradasCaixas.reduce((s, r) => {
    const liq = Number(r.peso_kg || 0);
    const tara = Number(r.tara_kg || 0);
    return s + (r.peso_bruto_kg != null && Number(r.peso_bruto_kg) > 0 ? Number(r.peso_bruto_kg) : Number((liq + tara).toFixed(2)));
  }, 0);
  const totalEstoquePecas = estoqueAtual.reduce((s, r) => s + Number(r.qtd_pecas || 0), 0);
  const totalSaidaPecas = saidasEfetivas.reduce((s, r) => s + Number(r.qtd_pecas || 0), 0);
  const totalEntradaPecas = entradasCaixas.reduce((s, r) => s + Number(r.qtd_pecas || 0), 0);
  const periodoLabel = `${fmtDateBR(dataInicio)} a ${fmtDateBR(dataFim)}`;

  const planilhaBorder = {
    top: { style: 'thin', color: { argb: 'FF475569' } },
    left: { style: 'thin', color: { argb: 'FF475569' } },
    bottom: { style: 'thin', color: { argb: 'FF475569' } },
    right: { style: 'thin', color: { argb: 'FF475569' } }
  };

  // =========================================================================
  // ABA 1: SAÍDAS (PLANILHA LIMPA — 6 COLUNAS PADRÃO OPERACIONAL)
  // =========================================================================
  const wsSaiPlan = wb.addWorksheet('Saídas (Planilha)', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  const saidasPlanilha = saidasEfetivas
    .map((item) => {
      const dtSaida = toExcelDateOnlyBRT(item.romaneio_expedido_em || item.romaneio_criado_em);
      return {
        dtSaida,
        dtIso: dateToIsoKey(dtSaida),
        romaneio: String(item.romaneio_codigo || ''),
        item: String(item.produto_descricao || ''),
        ean: String(item.ean_caixa || ''),
        qtdCx: 1,
        pesoKg: Number(item.peso_kg || 0),
      };
    })
    .sort(
      (a, b) =>
        a.dtIso.localeCompare(b.dtIso) ||
        a.romaneio.localeCompare(b.romaneio, undefined, { numeric: true }) ||
        a.item.localeCompare(b.item, 'pt-BR') ||
        a.ean.localeCompare(b.ean)
    );

  const hSaiPlan = [
    'Data Saída',
    'Romaneio',
    'Item',
    'Código de Barras',
    'Quantidade CX',
    'Quantidade KG',
  ];
  const rHSaiPlan = wsSaiPlan.getRow(1);
  hSaiPlan.forEach((h, i) => {
    const cell = rHSaiPlan.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = planilhaBorder;
  });
  rHSaiPlan.height = 22;

  saidasPlanilha.forEach((ln, idx) => {
    const row = wsSaiPlan.getRow(2 + idx);
    row.getCell(1).value = ln.dtSaida;
    row.getCell(2).value = ln.romaneio;
    row.getCell(3).value = ln.item;
    row.getCell(4).value = ln.ean;
    row.getCell(5).value = ln.qtdCx;
    row.getCell(6).value = Number(ln.pesoKg.toFixed(2));

    if (ln.dtSaida) row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.getCell(4).numFmt = '@';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '#,##0.00';

    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10.5, color: { argb: COLORS.navyDark } };
      cell.border = planilhaBorder;
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 3 ? 'left' : (c === 6 ? 'right' : 'center'),
      };
    }
    row.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.blueText } };
    row.getCell(6).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    row.height = 19;
  });

  const saiPlanEndRow = 1 + saidasPlanilha.length;
  const saiPlanTotRow = wsSaiPlan.getRow(saiPlanEndRow + 1);
  saiPlanTotRow.getCell(1).value = 'TOTAL';
  saiPlanTotRow.getCell(3).value = `${saidasPlanilha.length} caixa(s) expedida(s)`;
  saiPlanTotRow.getCell(5).value = saidasPlanilha.length > 0
    ? { formula: `SUBTOTAL(109,E2:E${saiPlanEndRow})`, result: saidasPlanilha.length }
    : 0;
  saiPlanTotRow.getCell(6).value = saidasPlanilha.length > 0
    ? { formula: `SUBTOTAL(109,F2:F${saiPlanEndRow})`, result: Number(totalSaidaKg.toFixed(2)) }
    : 0;
  saiPlanTotRow.getCell(5).numFmt = '#,##0';
  saiPlanTotRow.getCell(6).numFmt = '#,##0.00';
  for (let c = 1; c <= 6; c++) {
    const cell = saiPlanTotRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      right: { style: 'thin', color: { argb: 'FF475569' } },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: c === 3 ? 'left' : (c === 6 ? 'right' : 'center'),
    };
  }
  saiPlanTotRow.height = 22;

  wsSaiPlan.autoFilter = `A1:F${Math.max(1, saiPlanEndRow)}`;
  wsSaiPlan.columns = [
    { width: 15 }, { width: 16 }, { width: 42 }, { width: 22 }, { width: 16 }, { width: 17 }
  ];

  // =========================================================================
  // ABA 2: ENTRADAS (PLANILHA LIMPA — 6 COLUNAS PADRÃO OPERACIONAL)
  // =========================================================================
  const wsEntPlan = wb.addWorksheet('Entradas (Planilha)', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  const entradasPlanilha = entradasCaixas
    .map((item) => {
      const dtEntrada = toExcelDateOnlyBRT(item.created_at);
      const origemRaw = String(item.origem_tipo || '').toUpperCase();
      let origemDoc = '';
      if (item.recebimento_nf) {
        origemDoc = `NF ${item.recebimento_nf}`;
      } else if (item.recebimento_codigo) {
        origemDoc = String(item.recebimento_codigo);
      } else if (item.op_codigo) {
        origemDoc = String(item.op_codigo);
      } else if (
        origemRaw === 'PRODUCAO' ||
        item.origem_operacao === 'PRODUCAO' ||
        item.endereco === 'PRODUÇÃO PAVAN' ||
        item.endereco === 'PRODUCAO'
      ) {
        origemDoc = 'PRODUÇÃO';
      } else {
        origemDoc = origemRaw || String(item.origem_operacao || 'RECEBIMENTO');
      }
      return {
        dtEntrada,
        dtIso: dateToIsoKey(dtEntrada),
        origemDoc,
        item: String(item.produto_descricao || ''),
        ean: String(item.ean_caixa || ''),
        qtdCx: 1,
        pesoKg: Number(item.peso_kg || 0),
      };
    })
    .sort(
      (a, b) =>
        a.dtIso.localeCompare(b.dtIso) ||
        a.origemDoc.localeCompare(b.origemDoc, undefined, { numeric: true }) ||
        a.item.localeCompare(b.item, 'pt-BR') ||
        a.ean.localeCompare(b.ean)
    );

  const hEntPlan = [
    'Data Entrada',
    'Origem / Doc.',
    'Item',
    'Código de Barras',
    'Quantidade CX',
    'Quantidade KG',
  ];
  const rHEntPlan = wsEntPlan.getRow(1);
  hEntPlan.forEach((h, i) => {
    const cell = rHEntPlan.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = planilhaBorder;
  });
  rHEntPlan.height = 22;

  entradasPlanilha.forEach((ln, idx) => {
    const row = wsEntPlan.getRow(2 + idx);
    row.getCell(1).value = ln.dtEntrada;
    row.getCell(2).value = ln.origemDoc;
    row.getCell(3).value = ln.item;
    row.getCell(4).value = ln.ean;
    row.getCell(5).value = ln.qtdCx;
    row.getCell(6).value = Number(ln.pesoKg.toFixed(2));

    if (ln.dtEntrada) row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.getCell(4).numFmt = '@';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '#,##0.00';

    for (let c = 1; c <= 6; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10.5, color: { argb: COLORS.navyDark } };
      cell.border = planilhaBorder;
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 3 ? 'left' : (c === 6 ? 'right' : 'center'),
      };
    }
    row.getCell(2).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.blueText } };
    row.getCell(6).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    row.height = 19;
  });

  const entPlanEndRow = 1 + entradasPlanilha.length;
  const entPlanTotRow = wsEntPlan.getRow(entPlanEndRow + 1);
  entPlanTotRow.getCell(1).value = 'TOTAL';
  entPlanTotRow.getCell(3).value = `${entradasPlanilha.length} caixa(s) entrada(s)`;
  entPlanTotRow.getCell(5).value = entradasPlanilha.length > 0
    ? { formula: `SUBTOTAL(109,E2:E${entPlanEndRow})`, result: entradasPlanilha.length }
    : 0;
  entPlanTotRow.getCell(6).value = entradasPlanilha.length > 0
    ? { formula: `SUBTOTAL(109,F2:F${entPlanEndRow})`, result: Number(totalEntradaKg.toFixed(2)) }
    : 0;
  entPlanTotRow.getCell(5).numFmt = '#,##0';
  entPlanTotRow.getCell(6).numFmt = '#,##0.00';
  for (let c = 1; c <= 6; c++) {
    const cell = entPlanTotRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      right: { style: 'thin', color: { argb: 'FF475569' } },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: c === 3 ? 'left' : (c === 6 ? 'right' : 'center'),
    };
  }
  entPlanTotRow.height = 22;

  wsEntPlan.autoFilter = `A1:F${Math.max(1, entPlanEndRow)}`;
  wsEntPlan.columns = [
    { width: 15 }, { width: 18 }, { width: 42 }, { width: 22 }, { width: 16 }, { width: 17 }
  ];

  // =========================================================================
  // ABA 3: ROMANEIOS DE SAÍDA CONSOLIDADO (LINHA A LINHA CONTÍNUO: DATA + ROMANEIO + PRODUTO + KG + CX)
  // =========================================================================
  const wsRomLinha = wb.addWorksheet('Romaneios Consolidado', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  const romProdLinhaMap = new Map();
  for (const item of saidasEfetivas) {
    const romKey = String(item.romaneio_codigo || item.romaneio_id || '');
    const cod = String(item.produto_codigo || '');
    const desc = String(item.produto_descricao || '');
    const key = `${romKey}__${cod}__${desc}`;
    const rawTs = item.romaneio_expedido_em || item.romaneio_criado_em || '';
    const brt = toExcelDateTimeBRT(rawTs);
    const dtSaidaDateOnly = brt
      ? new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()))
      : null;
    const dtSaidaIso = brt
      ? `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`
      : '';

    if (!romProdLinhaMap.has(key)) {
      romProdLinhaMap.set(key, {
        data_saida_dt: dtSaidaDateOnly,
        data_saida_iso: dtSaidaIso,
        romaneio_codigo: String(item.romaneio_codigo || ''),
        numero_nf: item.numero_nf ? String(item.numero_nf) : '',
        pedido_codigo: item.pedido_codigo ? String(item.pedido_codigo) : '',
        cliente: String(item.romaneio_cliente || '').trim(),
        codigo: cod,
        descricao: desc,
        peso_kg: 0,
        qtd_caixas: 0,
        qtd_pecas: 0,
        status: String(item.romaneio_status || 'EXPEDIDO'),
      });
    }
    const rowAgg = romProdLinhaMap.get(key);
    rowAgg.peso_kg += Number(item.peso_kg || 0);
    rowAgg.qtd_caixas += 1;
    rowAgg.qtd_pecas += Number(item.qtd_pecas || 0);
  }

  const romProdLinhas = Array.from(romProdLinhaMap.values()).sort(
    (a, b) =>
      a.data_saida_iso.localeCompare(b.data_saida_iso) ||
      a.romaneio_codigo.localeCompare(b.romaneio_codigo, undefined, { numeric: true }) ||
      a.descricao.localeCompare(b.descricao, 'pt-BR')
  );

  wsRomLinha.mergeCells('A1:J1');
  wsRomLinha.getCell('A1').value = 'WMSphere • TRICARNES — CONSOLIDADO CONTÍNUO DE ROMANEIOS DE SAÍDA (UM EMBAIXO DO OUTRO)';
  wsRomLinha.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsRomLinha.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.emeraldDark } };
  wsRomLinha.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsRomLinha.getRow(1).height = 28;

  wsRomLinha.mergeCells('A2:J2');
  wsRomLinha.getCell('A2').value = `Período Filtrado: ${periodoLabel}  |  Linhas Consolidadas: ${romProdLinhas.length}  |  Romaneios: ${romaneios.length}  |  Total Caixas: ${saidasEfetivas.length} cx  |  Total Peso Saída: ${totalSaidaKg.toFixed(2).replace('.', ',')} kg`;
  wsRomLinha.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsRomLinha.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsRomLinha.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsRomLinha.getRow(2).height = 20;
  wsRomLinha.getRow(3).height = 8;

  const hRomLinha = [
    'Data de Saída',
    'Romaneio',
    'NF / Pedido',
    'Código',
    'Produto',
    'Quantidade Saldo (Kg)',
    'Quantidade (Cx)',
    'Total Peças',
    'Cliente / Destino',
    'Status'
  ];
  const rHRomLinha = wsRomLinha.getRow(4);
  hRomLinha.forEach((h, i) => {
    const cell = rHRomLinha.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: [5, 6, 7].includes(i) ? 'right' : ([0, 1, 2, 3, 9].includes(i) ? 'center' : 'left')
    };
    cell.border = thinBorder;
  });
  rHRomLinha.height = 24;

  romProdLinhas.forEach((ln, idx) => {
    const rIdx = 5 + idx;
    const row = wsRomLinha.getRow(rIdx);
    const nfOuPed = ln.numero_nf ? `NF ${ln.numero_nf}` : (ln.pedido_codigo || '');

    row.getCell(1).value = ln.data_saida_dt;
    row.getCell(2).value = ln.romaneio_codigo;
    row.getCell(3).value = nfOuPed;
    row.getCell(4).value = String(ln.codigo || '');
    row.getCell(5).value = ln.descricao;
    row.getCell(6).value = Number(ln.peso_kg.toFixed(2));
    row.getCell(7).value = ln.qtd_caixas;
    row.getCell(8).value = ln.qtd_pecas > 0 ? ln.qtd_pecas : null;
    row.getCell(9).value = ln.cliente;
    row.getCell(10).value = ln.status;

    if (ln.data_saida_dt) row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.getCell(4).numFmt = '@';
    row.getCell(6).numFmt = '#,##0.00';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';

    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if ([1, 2, 3, 4, 10].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if ([6, 7, 8].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(2).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.blueText } };
    row.getCell(6).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.greenText } };
    row.getCell(7).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
    row.height = 19;
  });

  const romLinhaEndRow = Math.max(5, 4 + romProdLinhas.length);
  const romLinhaTotRow = wsRomLinha.getRow(romLinhaEndRow + 1);
  romLinhaTotRow.getCell(1).value = 'TOTAL GERAL';
  romLinhaTotRow.getCell(5).value = `${romProdLinhas.length} linha(s) consolidada(s) em ${romaneios.length} romaneio(s)`;
  romLinhaTotRow.getCell(6).value = romProdLinhas.length > 0 ? { formula: `SUBTOTAL(109,F5:F${romLinhaEndRow})`, result: totalSaidaKg } : 0;
  romLinhaTotRow.getCell(7).value = romProdLinhas.length > 0 ? { formula: `SUBTOTAL(109,G5:G${romLinhaEndRow})`, result: saidasEfetivas.length } : 0;
  romLinhaTotRow.getCell(8).value = romProdLinhas.length > 0 ? { formula: `SUBTOTAL(109,H5:H${romLinhaEndRow})`, result: totalSaidaPecas } : 0;
  romLinhaTotRow.getCell(6).numFmt = '#,##0.00';
  romLinhaTotRow.getCell(7).numFmt = '#,##0';
  romLinhaTotRow.getCell(8).numFmt = '#,##0';

  for (let c = 1; c <= 10; c++) {
    const cell = romLinhaTotRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if ([6, 7, 8].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  romLinhaTotRow.height = 22;

  wsRomLinha.autoFilter = `A4:J${romLinhaEndRow}`;
  wsRomLinha.columns = [
    { width: 15 }, { width: 14 }, { width: 14 }, { width: 11 }, { width: 40 },
    { width: 21 }, { width: 16 }, { width: 13 }, { width: 26 }, { width: 13 }
  ];

  // =========================================================================
  // ABA 2: SAÍDA CONSOLIDADA POR PRODUTO (NO PERÍODO FILTRADO)
  // =========================================================================
  const wsSaiProd = wb.addWorksheet('Saída Consolidada Produto', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  const saidaProdMap = new Map();
  for (const item of saidasEfetivas) {
    const cod = String(item.produto_codigo || '');
    const desc = String(item.produto_descricao || '');
    const key = `${cod}__${desc}`;
    if (!saidaProdMap.has(key)) {
      saidaProdMap.set(key, {
        codigo: cod,
        descricao: desc,
        grupo: item.grupo || '',
        tipo_produto: item.tipo_produto || '',
        romaneiosSet: new Set(),
        qtd_caixas: 0,
        qtd_pecas: 0,
        peso_kg: 0
      });
    }
    const p = saidaProdMap.get(key);
    if (item.romaneio_codigo || item.romaneio_id) {
      p.romaneiosSet.add(String(item.romaneio_codigo || item.romaneio_id));
    }
    p.qtd_caixas += 1;
    p.qtd_pecas += Number(item.qtd_pecas || 0);
    p.peso_kg += Number(item.peso_kg || 0);
  }
  const saidaProdList = Array.from(saidaProdMap.values()).sort(
    (a, b) => b.peso_kg - a.peso_kg || a.descricao.localeCompare(b.descricao)
  );

  wsSaiProd.mergeCells('A1:J1');
  wsSaiProd.getCell('A1').value = 'WMSphere • TRICARNES — SAÍDA CONSOLIDADA POR PRODUTO NO PERÍODO';
  wsSaiProd.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsSaiProd.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.emeraldDark } };
  wsSaiProd.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsSaiProd.getRow(1).height = 28;

  wsSaiProd.mergeCells('A2:J2');
  wsSaiProd.getCell('A2').value = `Período Filtrado: ${periodoLabel}  |  Produtos Distintos: ${saidaProdList.length}  |  Romaneios: ${romaneios.length}  |  Caixas Expedidas: ${saidasEfetivas.length} cx  |  Peso Total Saída: ${totalSaidaKg.toFixed(2).replace('.', ',')} kg`;
  wsSaiProd.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsSaiProd.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsSaiProd.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsSaiProd.getRow(2).height = 20;
  wsSaiProd.getRow(3).height = 8;

  const hSaiProd = [
    'Código', 'Produto', 'Grupo', 'Tipo', 'Qtd. Romaneios',
    'Qtd. Caixas Saída', 'Total Peças', 'Peso Médio / Cx (Kg)', 'Peso Total Saída (Kg)', '% das Saídas'
  ];
  const rHSaiProd = wsSaiProd.getRow(4);
  hSaiProd.forEach((h, i) => {
    const cell = rHSaiProd.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: i >= 4 ? 'right' : (i === 0 ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  rHSaiProd.height = 24;

  const saiProdEndRow = Math.max(5, 4 + saidaProdList.length);
  const saiProdTotRowNum = saiProdEndRow + 1;

  saidaProdList.forEach((p, idx) => {
    const rIdx = 5 + idx;
    const row = wsSaiProd.getRow(rIdx);
    const pesoArred = Number(p.peso_kg.toFixed(2));
    const mediaCx = p.qtd_caixas > 0 ? Number((p.peso_kg / p.qtd_caixas).toFixed(2)) : 0;

    row.getCell(1).value = String(p.codigo || '');
    row.getCell(2).value = p.descricao;
    row.getCell(3).value = p.grupo || '';
    row.getCell(4).value = p.tipo_produto || '';
    row.getCell(5).value = p.romaneiosSet.size;
    row.getCell(6).value = p.qtd_caixas;
    row.getCell(7).value = p.qtd_pecas;
    row.getCell(8).value = { formula: `IF(F${rIdx}>0,I${rIdx}/F${rIdx},0)`, result: mediaCx };
    row.getCell(9).value = pesoArred;
    row.getCell(10).value = {
      formula: `IF($I$${saiProdTotRowNum}>0,I${rIdx}/$I$${saiProdTotRowNum},0)`,
      result: totalSaidaKg > 0 ? p.peso_kg / totalSaidaKg : 0
    };

    row.getCell(1).numFmt = '@';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0.00';
    row.getCell(9).numFmt = '#,##0.00';
    row.getCell(10).numFmt = '0.0%';

    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if (c === 1) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if (c >= 5) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(9).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.greenText } };
    row.height = 19;
  });

  const totSaiProdRow = wsSaiProd.getRow(saiProdTotRowNum);
  totSaiProdRow.getCell(1).value = 'TOTAL GERAL';
  totSaiProdRow.getCell(2).value = `${saidaProdList.length} produto(s) expedido(s) no período`;
  totSaiProdRow.getCell(5).value = romaneios.length;
  totSaiProdRow.getCell(6).value = saidaProdList.length > 0 ? { formula: `SUBTOTAL(109,F5:F${saiProdEndRow})`, result: saidasEfetivas.length } : 0;
  totSaiProdRow.getCell(7).value = saidaProdList.length > 0 ? { formula: `SUBTOTAL(109,G5:G${saiProdEndRow})`, result: totalSaidaPecas } : 0;
  totSaiProdRow.getCell(8).value = saidaProdList.length > 0
    ? { formula: `IF(F${saiProdTotRowNum}>0,I${saiProdTotRowNum}/F${saiProdTotRowNum},0)`, result: saidasEfetivas.length > 0 ? Number((totalSaidaKg / saidasEfetivas.length).toFixed(2)) : 0 }
    : 0;
  totSaiProdRow.getCell(9).value = saidaProdList.length > 0 ? { formula: `SUBTOTAL(109,I5:I${saiProdEndRow})`, result: totalSaidaKg } : 0;
  totSaiProdRow.getCell(10).value = saidaProdList.length > 0 ? { formula: `SUBTOTAL(109,J5:J${saiProdEndRow})`, result: totalSaidaKg > 0 ? 1 : 0 } : 0;
  totSaiProdRow.getCell(5).numFmt = '#,##0';
  totSaiProdRow.getCell(6).numFmt = '#,##0';
  totSaiProdRow.getCell(7).numFmt = '#,##0';
  totSaiProdRow.getCell(8).numFmt = '#,##0.00';
  totSaiProdRow.getCell(9).numFmt = '#,##0.00';
  totSaiProdRow.getCell(10).numFmt = '0.0%';

  for (let c = 1; c <= 10; c++) {
    const cell = totSaiProdRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if (c >= 5) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  totSaiProdRow.height = 22;

  wsSaiProd.autoFilter = `A4:J${saiProdEndRow}`;
  wsSaiProd.columns = [
    { width: 12 }, { width: 40 }, { width: 18 }, { width: 16 }, { width: 15 },
    { width: 17 }, { width: 13 }, { width: 19 }, { width: 20 }, { width: 13 }
  ];

  // =========================================================================
  // ABA 2: ENTRADA CONSOLIDADA POR PRODUTO (NO PERÍODO FILTRADO)
  // =========================================================================
  const wsEntProd = wb.addWorksheet('Entrada Consolidada Produto', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  const entradaProdMap = new Map();
  for (const item of entradasCaixas) {
    const cod = String(item.produto_codigo || '');
    const desc = String(item.produto_descricao || '');
    const key = `${cod}__${desc}`;
    const origemRaw = String(item.origem_tipo || '').toUpperCase();
    const origLabel = origemRaw === 'PRODUCAO' || item.origem_operacao === 'PRODUCAO' || item.endereco === 'PRODUÇÃO PAVAN' || item.endereco === 'PRODUCAO'
      ? 'Retorno de Produção'
      : 'Recebimento / Carga';
    const liq = Number(item.peso_kg || 0);
    const tara = Number(item.tara_kg || 0);
    const bruto = item.peso_bruto_kg != null && Number(item.peso_bruto_kg) > 0 ? Number(item.peso_bruto_kg) : Number((liq + tara).toFixed(2));

    if (!entradaProdMap.has(key)) {
      entradaProdMap.set(key, {
        codigo: cod,
        descricao: desc,
        grupo: item.grupo || '',
        tipo_produto: item.tipo_produto || '',
        origensSet: new Set(),
        qtd_caixas: 0,
        qtd_pecas: 0,
        peso_bruto_kg: 0,
        peso_kg: 0
      });
    }
    const p = entradaProdMap.get(key);
    p.origensSet.add(origLabel);
    p.qtd_caixas += 1;
    p.qtd_pecas += Number(item.qtd_pecas || 0);
    p.peso_bruto_kg += bruto;
    p.peso_kg += liq;
  }
  const entradaProdList = Array.from(entradaProdMap.values()).sort(
    (a, b) => b.peso_kg - a.peso_kg || a.descricao.localeCompare(b.descricao)
  );

  wsEntProd.mergeCells('A1:K1');
  wsEntProd.getCell('A1').value = 'WMSphere • TRICARNES — ENTRADA CONSOLIDADA POR PRODUTO NO PERÍODO';
  wsEntProd.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsEntProd.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.indigoDark } };
  wsEntProd.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsEntProd.getRow(1).height = 28;

  wsEntProd.mergeCells('A2:K2');
  wsEntProd.getCell('A2').value = `Período Filtrado: ${periodoLabel}  |  Produtos Distintos: ${entradaProdList.length}  |  Caixas de Entrada: ${entradasCaixas.length} cx  |  Peças: ${totalEntradaPecas} pç  |  Peso Líquido Entrada: ${totalEntradaKg.toFixed(2).replace('.', ',')} kg`;
  wsEntProd.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsEntProd.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsEntProd.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsEntProd.getRow(2).height = 20;
  wsEntProd.getRow(3).height = 8;

  const hEntProd = [
    'Código', 'Produto', 'Grupo', 'Tipo', 'Origem da Entrada',
    'Qtd. Caixas Entrada', 'Total Peças', 'Peso Bruto Total (Kg)', 'Peso Médio / Cx (Kg)', 'Peso Líquido Entrada (Kg)', '% das Entradas'
  ];
  const rHEntProd = wsEntProd.getRow(4);
  hEntProd.forEach((h, i) => {
    const cell = rHEntProd.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: i >= 5 ? 'right' : (i === 0 ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  rHEntProd.height = 24;

  const entProdEndRow = Math.max(5, 4 + entradaProdList.length);
  const entProdTotRowNum = entProdEndRow + 1;

  entradaProdList.forEach((p, idx) => {
    const rIdx = 5 + idx;
    const row = wsEntProd.getRow(rIdx);
    const liqArred = Number(p.peso_kg.toFixed(2));
    const brutoArred = Number(p.peso_bruto_kg.toFixed(2));
    const mediaCx = p.qtd_caixas > 0 ? Number((p.peso_kg / p.qtd_caixas).toFixed(2)) : 0;

    row.getCell(1).value = String(p.codigo || '');
    row.getCell(2).value = p.descricao;
    row.getCell(3).value = p.grupo || '';
    row.getCell(4).value = p.tipo_produto || '';
    row.getCell(5).value = Array.from(p.origensSet).join(' + ');
    row.getCell(6).value = p.qtd_caixas;
    row.getCell(7).value = p.qtd_pecas;
    row.getCell(8).value = brutoArred;
    row.getCell(9).value = { formula: `IF(F${rIdx}>0,J${rIdx}/F${rIdx},0)`, result: mediaCx };
    row.getCell(10).value = liqArred;
    row.getCell(11).value = {
      formula: `IF($J$${entProdTotRowNum}>0,J${rIdx}/$J$${entProdTotRowNum},0)`,
      result: totalEntradaKg > 0 ? p.peso_kg / totalEntradaKg : 0
    };

    row.getCell(1).numFmt = '@';
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0.00';
    row.getCell(9).numFmt = '#,##0.00';
    row.getCell(10).numFmt = '#,##0.00';
    row.getCell(11).numFmt = '0.0%';

    for (let c = 1; c <= 11; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if (c === 1) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if (c >= 6) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(10).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.blueText } };
    row.height = 19;
  });

  const totEntProdRow = wsEntProd.getRow(entProdTotRowNum);
  totEntProdRow.getCell(1).value = 'TOTAL GERAL';
  totEntProdRow.getCell(2).value = `${entradaProdList.length} produto(s) com entrada no período`;
  totEntProdRow.getCell(6).value = entradaProdList.length > 0 ? { formula: `SUBTOTAL(109,F5:F${entProdEndRow})`, result: entradasCaixas.length } : 0;
  totEntProdRow.getCell(7).value = entradaProdList.length > 0 ? { formula: `SUBTOTAL(109,G5:G${entProdEndRow})`, result: totalEntradaPecas } : 0;
  totEntProdRow.getCell(8).value = entradaProdList.length > 0 ? { formula: `SUBTOTAL(109,H5:H${entProdEndRow})`, result: totalEntradaBrutoKg } : 0;
  totEntProdRow.getCell(9).value = entradaProdList.length > 0
    ? { formula: `IF(F${entProdTotRowNum}>0,J${entProdTotRowNum}/F${entProdTotRowNum},0)`, result: entradasCaixas.length > 0 ? Number((totalEntradaKg / entradasCaixas.length).toFixed(2)) : 0 }
    : 0;
  totEntProdRow.getCell(10).value = entradaProdList.length > 0 ? { formula: `SUBTOTAL(109,J5:J${entProdEndRow})`, result: totalEntradaKg } : 0;
  totEntProdRow.getCell(11).value = entradaProdList.length > 0 ? { formula: `SUBTOTAL(109,K5:K${entProdEndRow})`, result: totalEntradaKg > 0 ? 1 : 0 } : 0;
  totEntProdRow.getCell(6).numFmt = '#,##0';
  totEntProdRow.getCell(7).numFmt = '#,##0';
  totEntProdRow.getCell(8).numFmt = '#,##0.00';
  totEntProdRow.getCell(9).numFmt = '#,##0.00';
  totEntProdRow.getCell(10).numFmt = '#,##0.00';
  totEntProdRow.getCell(11).numFmt = '0.0%';

  for (let c = 1; c <= 11; c++) {
    const cell = totEntProdRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if (c >= 6) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  totEntProdRow.height = 22;

  wsEntProd.autoFilter = `A4:K${entProdEndRow}`;
  wsEntProd.columns = [
    { width: 12 }, { width: 40 }, { width: 18 }, { width: 16 }, { width: 26 },
    { width: 18 }, { width: 13 }, { width: 19 }, { width: 19 }, { width: 22 }, { width: 14 }
  ];

  // =========================================================================
  // ABA 3: SAÍDAS POR ROMANEIO (SEPARADAS POR ROMANEIO COM SUBTOTAIS)
  // =========================================================================
  const wsRom = wb.addWorksheet('Saídas por Romaneio', {
    views: [{ state: 'frozen', ySplit: 3 }]
  });

  wsRom.mergeCells('A1:J1');
  wsRom.getCell('A1').value = 'WMSphere • TRICARNES — RELATÓRIO DE SAÍDAS ORGANIZADO POR ROMANEIO';
  wsRom.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsRom.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.emeraldDark } };
  wsRom.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsRom.getRow(1).height = 28;

  wsRom.mergeCells('A2:J2');
  wsRom.getCell('A2').value = `Período: ${periodoLabel}  |  Romaneios: ${romaneios.length}  |  Caixas: ${saidasEfetivas.length} cx  |  Peças: ${totalSaidaPecas} pç  |  Peso Total Geral: ${totalSaidaKg.toFixed(2).replace('.', ',')} kg`;
  wsRom.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsRom.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsRom.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsRom.getRow(2).height = 20;
  wsRom.getRow(3).height = 8;

  wsRom.mergeCells('A4:J4');
  wsRom.getCell('A4').value = '1. QUADRO RESUMO DE ROMANEIOS (PESO CONSOLIDADO POR ROMANEIO)';
  wsRom.getCell('A4').font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
  wsRom.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsRom.getRow(4).height = 22;

  const hResumoRom = ['Nº Romaneio', 'Cliente / Destino', 'Data/Hora Montagem', 'Data/Hora Expedição', 'Status', 'Operador', 'Qtd. Produtos', 'Qtd. Caixas', 'Total Peças', 'Peso Total (Kg)'];
  const rHResumoRom = wsRom.getRow(5);
  hResumoRom.forEach((h, i) => {
    const cell = rHResumoRom.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: i >= 6 ? 'right' : ([0, 2, 3, 4].includes(i) ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  rHResumoRom.height = 22;

  romaneios.forEach((rom, idx) => {
    const rIdx = 6 + idx;
    const row = wsRom.getRow(rIdx);
    const itensDoRom = rom.itens || saidasEfetivas.filter(it => String(it.romaneio_id) === String(rom.id));
    const prodsDistintos = new Set(itensDoRom.map(it => it.produto_codigo)).size;
    const pecasRom = itensDoRom.reduce((s, it) => s + Number(it.qtd_pecas || 0), 0);
    const dtMont = toExcelDateTimeBRT(rom.created_at);
    const dtExp = toExcelDateTimeBRT(rom.expedido_at);

    row.getCell(1).value = rom.codigo;
    row.getCell(2).value = (rom.cliente || '').trim();
    row.getCell(3).value = dtMont;
    row.getCell(4).value = dtExp;
    row.getCell(5).value = rom.status;
    row.getCell(6).value = rom.operador_expedicao_nome || rom.operador_nome || 'Administrador';
    row.getCell(7).value = prodsDistintos;
    row.getCell(8).value = Number(rom.qtd_caixas || itensDoRom.length);
    row.getCell(9).value = pecasRom;
    row.getCell(10).value = Number(Number(rom.peso_total || 0).toFixed(2));

    if (dtMont) row.getCell(3).numFmt = 'dd/mm/yyyy hh:mm';
    if (dtExp) row.getCell(4).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = '#,##0.00';

    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if ([1, 3, 4, 5].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if (c >= 7) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.blueText } };
    row.getCell(10).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.greenText } };
    row.height = 19;
  });

  const romSumEnd = Math.max(6, 5 + romaneios.length);
  const romSumTotRow = wsRom.getRow(romSumEnd + 1);
  romSumTotRow.getCell(1).value = 'TOTAL GERAL';
  romSumTotRow.getCell(2).value = `${romaneios.length} romaneios no período`;
  romSumTotRow.getCell(8).value = romaneios.length > 0 ? { formula: `SUM(H6:H${romSumEnd})`, result: saidasEfetivas.length } : 0;
  romSumTotRow.getCell(9).value = romaneios.length > 0 ? { formula: `SUM(I6:I${romSumEnd})`, result: totalSaidaPecas } : 0;
  romSumTotRow.getCell(10).value = romaneios.length > 0 ? { formula: `SUM(J6:J${romSumEnd})`, result: totalSaidaKg } : 0;
  romSumTotRow.getCell(8).numFmt = '#,##0';
  romSumTotRow.getCell(9).numFmt = '#,##0';
  romSumTotRow.getCell(10).numFmt = '#,##0.00';
  for (let c = 1; c <= 10; c++) {
    const cell = romSumTotRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if (c >= 8) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  romSumTotRow.height = 22;

  let currRow = romSumEnd + 3;
  wsRom.mergeCells(`A${currRow}:J${currRow}`);
  wsRom.getCell(`A${currRow}`).value = '2. DETALHAMENTO INDIVIDUAL POR ROMANEIO (SEÇÕES SEPARADAS COM SUBTOTAL POR ROMANEIO)';
  wsRom.getCell(`A${currRow}`).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  wsRom.getCell(`A${currRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
  wsRom.getCell(`A${currRow}`).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsRom.getRow(currRow).height = 24;
  currRow += 2;

  romaneios.forEach((rom) => {
    const itensDoRom = rom.itens || saidasEfetivas.filter(it => String(it.romaneio_id) === String(rom.id));
    const pesoRom = itensDoRom.reduce((s, i) => s + Number(i.peso_kg || 0), 0);
    const pecasDoRom = itensDoRom.reduce((s, i) => s + Number(i.qtd_pecas || 0), 0);

    wsRom.mergeCells(`A${currRow}:J${currRow}`);
    const bannerCell = wsRom.getCell(`A${currRow}`);
    bannerCell.value = `ROMANEIO ${rom.codigo}  —  CLIENTE: ${(rom.cliente || '').trim().toUpperCase()}  |  EXPEDIÇÃO: ${fmtDateTimeBRT(rom.expedido_at || rom.created_at)}  |  CAIXAS: ${itensDoRom.length} cx  |  PEÇAS: ${pecasDoRom} pç  |  PESO TOTAL: ${pesoRom.toFixed(2).replace('.', ',')} kg`;
    bannerCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.indigoDark } };
    bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsRom.getRow(currRow).height = 22;
    currRow++;

    const colsRomItem = ['#', 'Código', 'Descrição do Produto', 'Grupo', 'EAN da Caixa Física', 'Endereço Origem', 'Lote', 'Validade', 'Peças', 'Peso (Kg)'];
    const rHdr = wsRom.getRow(currRow);
    colsRomItem.forEach((h, i) => {
      const c = rHdr.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: COLORS.navyDark } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
      c.alignment = { vertical: 'middle', horizontal: [8, 9].includes(i) ? 'right' : ([0, 1, 5, 6, 7].includes(i) ? 'center' : 'left') };
      c.border = thinBorder;
    });
    rHdr.height = 20;
    currRow++;

    const startItemRow = currRow;
    itensDoRom.forEach((it, idx) => {
      const r = wsRom.getRow(currRow);
      const valDt = toExcelDateOnly(it.validade);
      r.getCell(1).value = idx + 1;
      r.getCell(2).value = String(it.produto_codigo || '');
      r.getCell(3).value = it.produto_descricao || '';
      r.getCell(4).value = it.grupo || '';
      r.getCell(5).value = String(it.ean_caixa || '');
      r.getCell(6).value = it.endereco_atual_ou_origem || '';
      r.getCell(7).value = it.lote || '-';
      r.getCell(8).value = valDt;
      r.getCell(9).value = Number(it.qtd_pecas) > 0 ? Number(it.qtd_pecas) : null;
      r.getCell(10).value = Number(it.peso_kg || 0);

      r.getCell(1).numFmt = '#,##0';
      r.getCell(2).numFmt = '@';
      r.getCell(5).numFmt = '@';
      if (valDt) r.getCell(8).numFmt = 'dd/mm/yyyy';
      r.getCell(9).numFmt = '#,##0';
      r.getCell(10).numFmt = '#,##0.00';

      for (let c = 1; c <= 10; c++) {
        const cell = r.getCell(c);
        cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
        cell.border = thinBorder;
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
        if ([1, 2, 6, 7, 8].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        else if ([9, 10].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
        else cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
      r.getCell(5).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } };
      r.getCell(10).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
      r.height = 18.5;
      currRow++;
    });
    const endItemRow = Math.max(startItemRow, currRow - 1);

    const subRow = wsRom.getRow(currRow);
    wsRom.mergeCells(`A${currRow}:G${currRow}`);
    subRow.getCell(1).value = `PESO TOTAL CONSOLIDADO DO ROMANEIO ${rom.codigo} (${(rom.cliente || '').trim()}):`;
    subRow.getCell(8).value = `${itensDoRom.length} cx`;
    subRow.getCell(9).value = itensDoRom.length > 0 ? { formula: `SUM(I${startItemRow}:I${endItemRow})`, result: pecasDoRom } : 0;
    subRow.getCell(10).value = itensDoRom.length > 0 ? { formula: `SUM(J${startItemRow}:J${endItemRow})`, result: pesoRom } : 0;
    subRow.getCell(9).numFmt = '#,##0';
    subRow.getCell(10).numFmt = '#,##0.00';

    for (let c = 1; c <= 10; c++) {
      const cell = subRow.getCell(c);
      cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.emeraldDark } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.romTotalBg } };
      cell.border = {
        top: { style: 'thin', color: { argb: COLORS.emeraldDark } },
        bottom: { style: 'medium', color: { argb: COLORS.emeraldDark } },
        left: { style: 'thin', color: { argb: COLORS.borderGray } },
        right: { style: 'thin', color: { argb: COLORS.borderGray } }
      };
    }
    subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'right' };
    subRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' };
    subRow.getCell(9).alignment = { vertical: 'middle', horizontal: 'right' };
    subRow.getCell(10).alignment = { vertical: 'middle', horizontal: 'right' };
    subRow.height = 21;
    currRow += 2;
  });

  wsRom.columns = [
    { width: 14 }, { width: 22 }, { width: 38 }, { width: 20 }, { width: 22 },
    { width: 18 }, { width: 14 }, { width: 14 }, { width: 11 }, { width: 16 }
  ];

  // =========================================================================
  // ABA 2: SAÍDAS (LISTA COMPACTA COM FILTRO)
  // =========================================================================
  const wsSaida = wb.addWorksheet('Saídas (Lista c- Filtro)', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  wsSaida.mergeCells('A1:O1');
  wsSaida.getCell('A1').value = 'WMSphere • TRICARNES — RELAÇÃO GERAL DE SAÍDAS COM FILTROS';
  wsSaida.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsSaida.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.emeraldDark } };
  wsSaida.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsSaida.getRow(1).height = 28;

  wsSaida.mergeCells('A2:O2');
  wsSaida.getCell('A2').value = `Período: ${periodoLabel}  |  Romaneios: ${romaneios.length}  |  Caixas: ${saidasEfetivas.length} cx  |  Peças: ${totalSaidaPecas} pç  |  Peso Total Expedido: ${totalSaidaKg.toFixed(2).replace('.', ',')} kg`;
  wsSaida.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsSaida.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsSaida.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsSaida.getRow(2).height = 20;
  wsSaida.getRow(3).height = 8;

  const headersSaida = [
    'Romaneio', 'Data/Hora Expedição', 'Cliente / Destino', 'Status Rom.',
    'Código', 'Produto', 'Grupo', 'EAN da Caixa', 'End. Origem',
    'Lote', 'Validade', 'Qtd. Cx', 'Peças', 'Peso (Kg)', 'Operador Exped.'
  ];
  const headerRowSaida = wsSaida.getRow(4);
  headersSaida.forEach((h, i) => {
    const cell = headerRowSaida.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: [11, 12, 13].includes(i) ? 'right' : ([0, 1, 3, 4, 8, 9, 10].includes(i) ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  headerRowSaida.height = 24;

  saidasEfetivas.forEach((item, idx) => {
    const rIdx = 5 + idx;
    const row = wsSaida.getRow(rIdx);
    const dtExp = toExcelDateTimeBRT(item.romaneio_expedido_em || item.romaneio_criado_em);
    const valDate = toExcelDateOnly(item.validade);
    const peso = Number(item.peso_kg || 0);

    row.getCell(1).value = item.romaneio_codigo || '';
    row.getCell(2).value = dtExp;
    row.getCell(3).value = (item.romaneio_cliente || '').trim();
    row.getCell(4).value = item.romaneio_status || 'EXPEDIDO';
    row.getCell(5).value = String(item.produto_codigo || '');
    row.getCell(6).value = item.produto_descricao || '';
    row.getCell(7).value = item.grupo || '';
    row.getCell(8).value = String(item.ean_caixa || '');
    row.getCell(9).value = item.endereco_atual_ou_origem || '';
    row.getCell(10).value = item.lote || '-';
    row.getCell(11).value = valDate;
    row.getCell(12).value = 1;
    row.getCell(13).value = Number(item.qtd_pecas) > 0 ? Number(item.qtd_pecas) : null;
    row.getCell(14).value = peso;
    row.getCell(15).value = item.operador_expedicao || item.operador_montagem || 'Administrador';

    if (dtExp) row.getCell(2).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(5).numFmt = '@';
    row.getCell(8).numFmt = '@';
    if (valDate) row.getCell(11).numFmt = 'dd/mm/yyyy';
    row.getCell(12).numFmt = '#,##0';
    row.getCell(13).numFmt = '#,##0';
    row.getCell(14).numFmt = '#,##0.00';

    for (let c = 1; c <= 15; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if ([1, 2, 4, 5, 9, 10, 11].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if ([12, 13, 14].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.blueText } };
    row.getCell(8).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } };
    row.getCell(14).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
    row.height = 19;
  });

  const saiEndRow = Math.max(5, 4 + saidasEfetivas.length);
  const saiTotalRow = wsSaida.getRow(saiEndRow + 1);
  saiTotalRow.getCell(1).value = 'TOTAIS';
  saiTotalRow.getCell(6).value = `${romaneios.length} romaneios expedidos no período`;
  saiTotalRow.getCell(12).value = saidasEfetivas.length > 0 ? { formula: `SUBTOTAL(109,L5:L${saiEndRow})`, result: saidasEfetivas.length } : 0;
  saiTotalRow.getCell(13).value = saidasEfetivas.length > 0 ? { formula: `SUBTOTAL(109,M5:M${saiEndRow})`, result: totalSaidaPecas } : 0;
  saiTotalRow.getCell(14).value = saidasEfetivas.length > 0 ? { formula: `SUBTOTAL(109,N5:N${saiEndRow})`, result: totalSaidaKg } : 0;
  saiTotalRow.getCell(12).numFmt = '#,##0';
  saiTotalRow.getCell(13).numFmt = '#,##0';
  saiTotalRow.getCell(14).numFmt = '#,##0.00';
  for (let c = 1; c <= 15; c++) {
    const cell = saiTotalRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if ([12, 13, 14].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  saiTotalRow.height = 22;

  wsSaida.autoFilter = `A4:O${saiEndRow}`;
  wsSaida.columns = [
    { width: 13 }, { width: 19 }, { width: 19 }, { width: 13 },
    { width: 10 }, { width: 38 }, { width: 16 }, { width: 20 }, { width: 17 },
    { width: 11 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }
  ];

  // =========================================================================
  // ABA 3: ENTRADAS DO PERÍODO
  // =========================================================================
  const wsEnt = wb.addWorksheet('Entradas', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  wsEnt.mergeCells('A1:O1');
  wsEnt.getCell('A1').value = 'WMSphere • TRICARNES — RELATÓRIO DE ENTRADAS (RECEBIMENTO / PRODUÇÃO / INVENTÁRIO / DESMEMBRAMENTO)';
  wsEnt.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsEnt.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.indigoDark } };
  wsEnt.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsEnt.getRow(1).height = 28;

  wsEnt.mergeCells('A2:O2');
  wsEnt.getCell('A2').value = `Período: ${periodoLabel}  |  Caixas Registradas: ${entradasCaixas.length} cx  |  Peças: ${totalEntradaPecas} pç  |  Peso Líquido Total: ${totalEntradaKg.toFixed(2).replace('.', ',')} kg`;
  wsEnt.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsEnt.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsEnt.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsEnt.getRow(2).height = 20;
  wsEnt.getRow(3).height = 8;

  const headersEnt = [
    'Data/Hora Entrada', 'Origem / Tipo Entrada', 'Código', 'Descrição do Produto',
    'Grupo', 'EAN da Caixa', 'Endereço', 'Lote', 'Data Prod.', 'Validade',
    'Situação Atual', 'Peças', 'Peso Bruto (Kg)', 'Tara (Kg)', 'Peso Líquido (Kg)'
  ];
  const rHEnt = wsEnt.getRow(4);
  headersEnt.forEach((h, i) => {
    const cell = rHEnt.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: [11, 12, 13, 14].includes(i) ? 'right' : ([0, 2, 6, 7, 8, 9, 10].includes(i) ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  rHEnt.height = 24;

  entradasCaixas.forEach((item, idx) => {
    const rIdx = 5 + idx;
    const row = wsEnt.getRow(rIdx);
    const dtEnt = toExcelDateTimeBRT(item.created_at);
    const prodDate = toExcelDateOnly(item.data_producao);
    const valDate = toExcelDateOnly(item.validade);
    const liq = Number(item.peso_kg || 0);
    const tara = Number(item.tara_kg || 0);
    const bruto = item.peso_bruto_kg != null ? Number(item.peso_bruto_kg) : Number((liq + tara).toFixed(2));
    const origemRaw = String(item.origem_tipo || '').toUpperCase();
    const origem = origemRaw === 'PRODUCAO' || item.origem_operacao === 'PRODUCAO' || item.endereco === 'PRODUÇÃO PAVAN' || item.endereco === 'PRODUCAO'
      ? 'RETORNO DE PRODUÇÃO'
      : (origemRaw || item.origem_operacao || 'CARGA / RECEBIMENTO');

    row.getCell(1).value = dtEnt;
    row.getCell(2).value = origem;
    row.getCell(3).value = String(item.produto_codigo || '');
    row.getCell(4).value = item.produto_descricao || '';
    row.getCell(5).value = item.grupo || '';
    row.getCell(6).value = String(item.ean_caixa || '');
    row.getCell(7).value = item.endereco || '-';
    row.getCell(8).value = item.lote || '-';
    row.getCell(9).value = prodDate;
    row.getCell(10).value = valDate;
    row.getCell(11).value = item.status_caixa || 'DISPONIVEL';
    row.getCell(12).value = Number(item.qtd_pecas) > 0 ? Number(item.qtd_pecas) : null;
    row.getCell(13).value = bruto;
    row.getCell(14).value = tara;
    row.getCell(15).value = liq;

    if (dtEnt) row.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(3).numFmt = '@';
    row.getCell(6).numFmt = '@';
    if (prodDate) row.getCell(9).numFmt = 'dd/mm/yyyy';
    if (valDate) row.getCell(10).numFmt = 'dd/mm/yyyy';
    row.getCell(12).numFmt = '#,##0';
    row.getCell(13).numFmt = '#,##0.00';
    row.getCell(14).numFmt = '#,##0.000';
    row.getCell(15).numFmt = '#,##0.00';

    for (let c = 1; c <= 15; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if ([1, 3, 7, 8, 9, 10, 11].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if ([12, 13, 14, 15].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(6).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } };
    row.getCell(15).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
    row.height = 19;
  });

  const entEndRow = Math.max(5, 4 + entradasCaixas.length);
  const entTotRow = wsEnt.getRow(entEndRow + 1);
  entTotRow.getCell(1).value = 'TOTAIS';
  entTotRow.getCell(4).value = `${entradasCaixas.length} caixas registradas`;
  entTotRow.getCell(12).value = entradasCaixas.length > 0 ? { formula: `SUBTOTAL(109,L5:L${entEndRow})`, result: totalEntradaPecas } : 0;
  entTotRow.getCell(13).value = entradasCaixas.length > 0 ? { formula: `SUBTOTAL(109,M5:M${entEndRow})`, result: entradasCaixas.reduce((s, x) => s + Number(x.peso_bruto_kg ?? x.peso_kg ?? 0), 0) } : 0;
  entTotRow.getCell(14).value = entradasCaixas.length > 0 ? { formula: `SUBTOTAL(109,N5:N${entEndRow})`, result: entradasCaixas.reduce((s, x) => s + Number(x.tara_kg || 0), 0) } : 0;
  entTotRow.getCell(15).value = entradasCaixas.length > 0 ? { formula: `SUBTOTAL(109,O5:O${entEndRow})`, result: totalEntradaKg } : 0;
  entTotRow.getCell(12).numFmt = '#,##0';
  entTotRow.getCell(13).numFmt = '#,##0.00';
  entTotRow.getCell(14).numFmt = '#,##0.000';
  entTotRow.getCell(15).numFmt = '#,##0.00';
  for (let c = 1; c <= 15; c++) {
    const cell = entTotRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if ([12, 13, 14, 15].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  entTotRow.height = 22;

  wsEnt.autoFilter = `A4:O${entEndRow}`;
  wsEnt.columns = [
    { width: 19 }, { width: 23 }, { width: 10 }, { width: 38 },
    { width: 16 }, { width: 20 }, { width: 17 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 15 },
    { width: 10 }, { width: 15 }, { width: 12 }, { width: 16 }
  ];

  // =========================================================================
  // ABA 4: ESTOQUE TOTAL POR PRODUTO (CONSOLIDADO)
  // =========================================================================
  const wsResEst = wb.addWorksheet('Estoque por Produto', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  const estSorted = [...estoqueAtual].sort((a, b) =>
    (a.endereco || '').localeCompare(b.endereco || '') ||
    (a.descricao || '').localeCompare(b.descricao || '') ||
    (a.validade || '').localeCompare(b.validade || '')
  );

  const prodMap = new Map();
  for (const item of estSorted) {
    const key = `${item.codigo}__${item.descricao}`;
    if (!prodMap.has(key)) {
      prodMap.set(key, {
        codigo: item.codigo,
        descricao: item.descricao,
        grupo: item.grupo,
        tipo_produto: item.tipo_produto,
        enderecos: new Set(),
        qtd_caixas: 0,
        qtd_pecas: 0,
        peso_kg: 0,
        menor_validade: item.validade || null
      });
    }
    const p = prodMap.get(key);
    if (item.endereco) p.enderecos.add(item.endereco);
    p.qtd_caixas += 1;
    p.qtd_pecas += Number(item.qtd_pecas || 0);
    p.peso_kg += Number(item.peso_kg || 0);
    if (item.validade && (!p.menor_validade || item.validade < p.menor_validade)) {
      p.menor_validade = item.validade;
    }
  }
  const prodList = Array.from(prodMap.values()).sort((a, b) => a.descricao.localeCompare(b.descricao));

  wsResEst.mergeCells('A1:J1');
  wsResEst.getCell('A1').value = 'WMSphere • TRICARNES — ESTOQUE ATUAL CONSOLIDADO POR PRODUTO';
  wsResEst.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsResEst.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
  wsResEst.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsResEst.getRow(1).height = 28;

  wsResEst.mergeCells('A2:J2');
  wsResEst.getCell('A2').value = `Posição Atual  |  Produtos Distintos: ${prodList.length}  |  Caixas: ${estoqueAtual.length} cx  |  Peças: ${totalEstoquePecas} pç  |  Peso Total: ${totalEstoqueKg.toFixed(2).replace('.', ',')} kg`;
  wsResEst.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsResEst.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsResEst.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsResEst.getRow(2).height = 20;
  wsResEst.getRow(3).height = 8;

  const hResEst = [
    'Código', 'Produto', 'Grupo', 'Tipo', 'Endereços', 'Qtd. Caixas',
    'Total Peças', 'Peso Total (Kg)', '% Estoque', 'Menor Validade (FEFO)'
  ];
  const rHResEst = wsResEst.getRow(4);
  hResEst.forEach((h, i) => {
    const cell = rHResEst.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: [5, 6, 7, 8].includes(i) ? 'right' : ([0, 9].includes(i) ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  rHResEst.height = 24;

  const resEstEndRow = Math.max(5, 4 + prodList.length);
  const resEstTotRowNum = resEstEndRow + 1;

  prodList.forEach((p, idx) => {
    const rIdx = 5 + idx;
    const row = wsResEst.getRow(rIdx);
    const valDate = toExcelDateOnly(p.menor_validade);

    row.getCell(1).value = String(p.codigo || '');
    row.getCell(2).value = p.descricao;
    row.getCell(3).value = p.grupo || '';
    row.getCell(4).value = p.tipo_produto || '';
    row.getCell(5).value = Array.from(p.enderecos).sort().join(', ');
    row.getCell(6).value = p.qtd_caixas;
    row.getCell(7).value = p.qtd_pecas;
    row.getCell(8).value = Number(p.peso_kg.toFixed(2));
    row.getCell(9).value = { formula: `H${rIdx}/$H$${resEstTotRowNum}`, result: totalEstoqueKg > 0 ? p.peso_kg / totalEstoqueKg : 0 };
    row.getCell(10).value = valDate;

    row.getCell(1).numFmt = '@';
    row.getCell(6).numFmt = '#,##0';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0.00';
    row.getCell(9).numFmt = '0.0%';
    if (valDate) row.getCell(10).numFmt = 'dd/mm/yyyy';

    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if ([1, 10].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if ([6, 7, 8, 9].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(8).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
    row.height = 19;
  });

  const totResEstRow = wsResEst.getRow(resEstTotRowNum);
  totResEstRow.getCell(1).value = 'TOTAL';
  totResEstRow.getCell(2).value = `${prodList.length} produtos distintos`;
  totResEstRow.getCell(6).value = prodList.length > 0 ? { formula: `SUM(F5:F${resEstEndRow})`, result: estoqueAtual.length } : 0;
  totResEstRow.getCell(7).value = prodList.length > 0 ? { formula: `SUM(G5:G${resEstEndRow})`, result: totalEstoquePecas } : 0;
  totResEstRow.getCell(8).value = prodList.length > 0 ? { formula: `SUM(H5:H${resEstEndRow})`, result: totalEstoqueKg } : 0;
  totResEstRow.getCell(9).value = prodList.length > 0 ? { formula: `SUM(I5:I${resEstEndRow})`, result: 1 } : 0;
  totResEstRow.getCell(6).numFmt = '#,##0';
  totResEstRow.getCell(7).numFmt = '#,##0';
  totResEstRow.getCell(8).numFmt = '#,##0.00';
  totResEstRow.getCell(9).numFmt = '0.0%';

  for (let c = 1; c <= 10; c++) {
    const cell = totResEstRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if ([6, 7, 8, 9].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  totResEstRow.height = 22;

  wsResEst.autoFilter = `A4:J${resEstEndRow}`;
  wsResEst.columns = [
    { width: 10 }, { width: 38 }, { width: 16 }, { width: 15 }, { width: 26 },
    { width: 13 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 20 }
  ];

  // =========================================================================
  // ABA 5: ESTOQUE DETALHADO POR CAIXA
  // =========================================================================
  const wsEst = wb.addWorksheet('Estoque por Caixa', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  wsEst.mergeCells('A1:R1');
  wsEst.getCell('A1').value = 'WMSphere • TRICARNES — ESTOQUE ATUAL DETALHADO POR CAIXA FÍSICA';
  wsEst.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  wsEst.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
  wsEst.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsEst.getRow(1).height = 28;

  wsEst.mergeCells('A2:R2');
  wsEst.getCell('A2').value = `Posição Atual  |  Caixas: ${estoqueAtual.length} cx  |  Peças: ${totalEstoquePecas} pç  |  Peso Líquido Total: ${totalEstoqueKg.toFixed(2).replace('.', ',')} kg`;
  wsEst.getCell('A2').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
  wsEst.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  wsEst.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsEst.getRow(2).height = 20;
  wsEst.getRow(3).height = 8;

  const headersEst = [
    'Endereço', 'Código', 'Descrição do Produto', 'Grupo', 'Tipo', 'Curva',
    'Armazen.', 'EAN da Caixa', 'Lote', 'Data Prod.', 'Validade', 'Dias p/ Vencer',
    'Status', 'Reserva (Pedido / Cliente)', 'Peças', 'Peso Bruto (Kg)', 'Tara (Kg)', 'Peso Líquido (Kg)'
  ];
  const headerRowEst = wsEst.getRow(4);
  headersEst.forEach((h, i) => {
    const cell = headerRowEst.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateHeader } };
    cell.alignment = { vertical: 'middle', horizontal: [11, 14, 15, 16, 17].includes(i) ? 'right' : ([0, 1, 5, 6, 8, 9, 10, 12].includes(i) ? 'center' : 'left') };
    cell.border = thinBorder;
  });
  headerRowEst.height = 24;

  estSorted.forEach((item, idx) => {
    const rIdx = 5 + idx;
    const row = wsEst.getRow(rIdx);
    const prodDate = toExcelDateOnly(item.data_producao);
    const valDate = toExcelDateOnly(item.validade);
    const dias = daysBetweenDateOnly(item.validade);
    const peso = Number(item.peso_kg || 0);
    const tara = Number(item.tara_kg || 0);
    const bruto = item.peso_bruto_kg != null ? Number(item.peso_bruto_kg) : Number((peso + tara).toFixed(2));
    const statusRaw = String(item.status_caixa || item.status || 'DISPONIVEL').toUpperCase();
    const isReservada = statusRaw === 'RESERVADA';
    const reservaInfo = (isReservada || item.pedido_reservado_codigo || item.cliente_reservado_nome)
      ? [item.pedido_reservado_codigo, item.romaneio_reservado_codigo, item.cliente_reservado_nome].filter(Boolean).join(' • ') || 'RESERVADO'
      : '-';

    row.getCell(1).value = item.endereco || '-';
    row.getCell(2).value = String(item.codigo || '');
    row.getCell(3).value = item.descricao || '';
    row.getCell(4).value = item.grupo || '';
    row.getCell(5).value = item.tipo_produto || '';
    row.getCell(6).value = item.status_curva || '';
    row.getCell(7).value = item.tipo_armazenamento || 'FRIO';
    row.getCell(8).value = String(item.ean_caixa || '');
    row.getCell(9).value = item.lote || '-';
    row.getCell(10).value = prodDate;
    row.getCell(11).value = valDate;
    row.getCell(12).value = dias !== null ? dias : '-';
    row.getCell(13).value = isReservada ? 'RESERVADO' : statusRaw;
    row.getCell(14).value = reservaInfo;
    row.getCell(15).value = Number(item.qtd_pecas) > 0 ? Number(item.qtd_pecas) : null;
    row.getCell(16).value = bruto;
    row.getCell(17).value = tara;
    row.getCell(18).value = peso;

    row.getCell(2).numFmt = '@';
    row.getCell(8).numFmt = '@';
    if (prodDate) row.getCell(10).numFmt = 'dd/mm/yyyy';
    if (valDate) row.getCell(11).numFmt = 'dd/mm/yyyy';
    if (dias !== null) row.getCell(12).numFmt = '#,##0';
    row.getCell(15).numFmt = '#,##0';
    row.getCell(16).numFmt = '#,##0.00';
    row.getCell(17).numFmt = '#,##0.000';
    row.getCell(18).numFmt = '#,##0.00';

    for (let c = 1; c <= 18; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.navyDark } };
      cell.border = thinBorder;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
      if ([1, 2, 6, 7, 9, 10, 11, 13].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'center' };
      else if ([12, 15, 16, 17, 18].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
      else cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
    row.getCell(8).font = { name: 'Consolas', size: 9.5, color: { argb: COLORS.navyDark } };
    row.getCell(18).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };

    if (isReservada) {
      row.getCell(13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberBg } };
      row.getCell(13).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberText } };
      row.getCell(14).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberText } };
    }

    if (dias !== null) {
      if (dias < 0) {
        row.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.redBg } };
        row.getCell(12).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.redText } };
      } else if (dias <= 30) {
        row.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberBg } };
        row.getCell(12).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberText } };
      }
    }
    row.height = 19;
  });

  const estEndRow = Math.max(5, 4 + estSorted.length);
  const estTotalRow = wsEst.getRow(estEndRow + 1);
  estTotalRow.getCell(1).value = 'TOTAIS';
  estTotalRow.getCell(3).value = estSorted.length > 0 ? { formula: `COUNTA(H5:H${estEndRow}) & " caixas"`, result: `${estSorted.length} caixas` } : '0 caixas';
  estTotalRow.getCell(15).value = estSorted.length > 0 ? { formula: `SUBTOTAL(109,O5:O${estEndRow})`, result: totalEstoquePecas } : 0;
  estTotalRow.getCell(16).value = estSorted.length > 0 ? { formula: `SUBTOTAL(109,P5:P${estEndRow})`, result: estSorted.reduce((s, x) => s + Number(x.peso_bruto_kg ?? x.peso_kg ?? 0), 0) } : 0;
  estTotalRow.getCell(17).value = estSorted.length > 0 ? { formula: `SUBTOTAL(109,Q5:Q${estEndRow})`, result: estSorted.reduce((s, x) => s + Number(x.tara_kg || 0), 0) } : 0;
  estTotalRow.getCell(18).value = estSorted.length > 0 ? { formula: `SUBTOTAL(109,R5:R${estEndRow})`, result: totalEstoqueKg } : 0;
  estTotalRow.getCell(15).numFmt = '#,##0';
  estTotalRow.getCell(16).numFmt = '#,##0.00';
  estTotalRow.getCell(17).numFmt = '#,##0.000';
  estTotalRow.getCell(18).numFmt = '#,##0.00';

  for (let c = 1; c <= 18; c++) {
    const cell = estTotalRow.getCell(c);
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: COLORS.navyDark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navyDark } },
      bottom: { style: 'medium', color: { argb: COLORS.navyDark } },
      left: { style: 'thin', color: { argb: COLORS.borderGray } },
      right: { style: 'thin', color: { argb: COLORS.borderGray } }
    };
    if ([15, 16, 17, 18].includes(c)) cell.alignment = { vertical: 'middle', horizontal: 'right' };
  }
  estTotalRow.height = 22;

  wsEst.autoFilter = `A4:R${estEndRow}`;
  wsEst.columns = [
    { width: 17 }, { width: 10 }, { width: 38 }, { width: 16 }, { width: 15 }, { width: 8 },
    { width: 13 }, { width: 20 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 14 },
    { width: 14 }, { width: 32 }, { width: 10 }, { width: 15 }, { width: 12 }, { width: 16 }
  ];

  // Download no navegador
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Relatorio_WMS_Estoque_Entradas_Saidas_${dataInicio || 'Geral'}_a_${dataFim || 'Hoje'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
