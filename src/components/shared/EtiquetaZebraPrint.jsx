import React, { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import { Printer, Download, X, Tag, CheckCircle2 } from 'lucide-react'
import { fmtDataBR, fmtKg2, fmtKg3, gerarLotePorData } from '../../utils/rastreabilidade'
import { lerConfigEstacao } from '../../utils/estacaoConfig'
import { useAppStore } from '../../store/appStore'

function gerarQrSvgHtml(texto, sizePx = 56) {
  if (!texto) return ''
  try {
    const qr = QRCode.create(String(texto), { errorCorrectionLevel: 'M' })
    const modCount = qr.modules.size
    const data = qr.modules.data
    const quiet = 1
    const total = modCount + quiet * 2
    let rects = ''
    for (let r = 0; r < modCount; r++) {
      for (let c = 0; c < modCount; c++) {
        if (data[r * modCount + c]) {
          rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1" fill="#000"/>`
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/>${rects}</svg>`
  } catch {
    return ''
  }
}

function obterFilialAtivaStore() {
  try {
    const st = useAppStore.getState?.()
    if (!st) return null
    const lista = Array.isArray(st.filiaisDisponiveis) ? st.filiaisDisponiveis : []
    return (
      lista.find((f) => String(f.id) === String(st.filialAtivaId)) ||
      lista.find((f) => Number(f.is_padrao) === 1) ||
      lista[0] ||
      null
    )
  } catch {
    return null
  }
}

export function montarSeloSanitarioEtiqueta({ registroDipoa = '', registroTipo = '', registroNum = '' } = {}) {
  const dipoa = String(registroDipoa || '').trim().toUpperCase()
  const tipo = String(registroTipo || '').trim().toUpperCase()
  const num = String(registroNum || '').trim().toUpperCase()

  if (tipo && tipo !== 'NENHUM' && num) {
    if (dipoa) {
      return tipo === 'DIPOA' ? `REG. DIPOA ${dipoa}/${num}` : `REG. DIPOA/${tipo} ${dipoa}/${num}`
    }
    return `REG. ${tipo} Nº ${num}`
  }
  if (dipoa) {
    return `REG. DIPOA Nº ${dipoa}`
  }
  return ''
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizarEtiqueta(raw) {
  const ean = String(raw?.ean_caixa || raw?.ean || '').trim()
  const lote = String(raw?.lote || (raw?.data_producao ? gerarLotePorData(raw.data_producao) : '') || '-').trim()
  const liquido = Number(raw?.peso_liquido_kg ?? raw?.peso_kg ?? 0)
  const tara = Number(raw?.tara_kg ?? 0)
  const bruto = raw?.peso_bruto_kg !== null && raw?.peso_bruto_kg !== undefined
    ? Number(raw.peso_bruto_kg)
    : (Number.isFinite(liquido) && Number.isFinite(tara) ? Number((liquido + tara).toFixed(3)) : liquido)

  const badgeOrigem = raw?.op_codigo
    ? `${raw?.origem_tipo || 'PRODUCAO'} • ${raw.op_codigo}`
    : (raw?.origem_tipo || 'TRICARNES WMS')

  const pecasRaw = Number(raw?.qtd_pecas ?? raw?.pecas ?? 0)
  const qtdPecas = Number.isFinite(pecasRaw) && pecasRaw > 0 ? Math.trunc(pecasRaw) : null

  const filialAtiva = obterFilialAtivaStore()
  const empresaNome = String(
    raw?.empresa_nome ||
      filialAtiva?.empresa_nome_fantasia ||
      filialAtiva?.empresa_razao_social ||
      filialAtiva?.nome ||
      'TRICARNES ALIMENTOS',
  )
    .trim()
    .toUpperCase()
  const registroDipoa = String(raw?.registro_dipoa ?? raw?.produto_registro_dipoa ?? '').trim()
  const seloSanitario = montarSeloSanitarioEtiqueta({
    registroDipoa,
    registroTipo: raw?.registro_sanitario_tipo || filialAtiva?.registro_sanitario_tipo || '',
    registroNum: raw?.registro_sanitario_num || filialAtiva?.registro_sanitario_num || '',
  })
  const especificacao = String(
    raw?.produto_especificacao || raw?.especificacao_nome || raw?.especificacao || '',
  )
    .trim()
    .toUpperCase()
  const temperaturaRotulo = String(
    raw?.temperatura_rotulo || raw?.especificacao_temperatura || '',
  )
    .trim()
    .toUpperCase()
  const opCodigo = String(raw?.op_codigo || '').trim().toUpperCase()
  const loteOp = opCodigo ? `${lote} / ${opCodigo}` : lote
  const qrPayload = `WMS|${ean}|${String(raw?.produto_codigo || raw?.codigo || '').trim()}|${lote}|${Number(liquido || 0).toFixed(3)}|${raw?.validade || ''}`

  return {
    ean,
    codigo: String(raw?.produto_codigo || raw?.codigo || '-').trim(),
    descricao: String(raw?.produto_descricao || raw?.descricao || 'PRODUTO SEM DESCRIÇÃO').trim().toUpperCase(),
    especificacao,
    temperatura_rotulo: temperaturaRotulo,
    lote,
    op_codigo: opCodigo,
    lote_op: loteOp,
    qr_payload: qrPayload,
    data_producao: raw?.data_producao || null,
    validade: raw?.validade || null,
    peso_bruto_kg: bruto,
    tara_kg: tara,
    peso_liquido_kg: liquido,
    qtd_pecas: qtdPecas,
    origem_tipo: badgeOrigem,
    ean_origem: raw?.ean_origem || '',
    empresa_nome: empresaNome,
    registro_dipoa: registroDipoa,
    selo_sanitario: seloSanitario,
  }
}

/**
 * Gera código ZPL II nativo para impressoras Zebra (203 DPI — 100mm x 70mm = 800 x 560 dots).
 * Identidade visual original WMSphere com Especificação de Rótulo, Selo Sanitário, Pesos, Code128 e QR.
 */
export function gerarZplEtiqueta100x70(raw) {
  const e = normalizarEtiqueta(raw)
  const especTxt = e.especificacao.slice(0, 48)
  const desc1 = e.descricao.slice(0, 34)
  const desc2 = e.descricao.slice(34, 68)
  const prodData = fmtDataBR(e.data_producao)
  const valData = fmtDataBR(e.validade)
  const brutoTxt = `${Number(e.peso_bruto_kg || 0).toFixed(3).replace('.', ',')} kg`
  const taraTxt = `${Number(e.tara_kg || 0).toFixed(3).replace('.', ',')} kg`
  const liqTxt = `${Number(e.peso_liquido_kg || 0).toFixed(3).replace('.', ',')} kg`
  const pecasTxt = e.qtd_pecas != null ? `${e.qtd_pecas} PC` : '-'

  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL560',
    '^LH0,0',
    // Moldura externa WMSphere
    '^FO18,14^GB764,532,3^FS',
    // Barra superior escura (identidade WMSphere + empresa)
    '^FO18,14^GB764,46,46^FS',
    `^FO32,24^A0N,24,24^FR^FD${e.empresa_nome.slice(0, 28)}^FS`,
    `^FO445,26^A0N,20,20^FB322,1,0,R^FR^FD${(e.selo_sanitario || e.origem_tipo).slice(0, 32)}^FS`,
    // Especificação do produto (faixa de destaque acima do corte)
    especTxt ? `^FO32,68^A0N,22,22^FB736,1,0,C^FD${especTxt}^FS` : '',
    especTxt ? '^FO28,94^GB744,2,2^FS' : '',
    // Nome do corte em destaque
    `^FO32,${especTxt ? 102 : 72}^A0N,32,32^FD${desc1}^FS`,
    desc2 ? `^FO32,${especTxt ? 136 : 108}^A0N,24,24^FD${desc2}^FS` : '',
    // Grade de rastreabilidade (Prod / Val / Cod / Peças / Lote-OP)
    '^FO18,168^GB764,2,2^FS',
    `^FO32,178^A0N,22,22^FDCOD: ${e.codigo}   PECAS: ${pecasTxt}   LOTE/OP: ${e.lote_op.slice(0, 20)}^FS`,
    `^FO32,208^A0N,24,24^FDPROD: ${prodData}     VAL: ${valData}^FS`,
    e.temperatura_rotulo ? `^FO32,238^A0N,18,18^FD${e.temperatura_rotulo.slice(0, 56)}^FS` : '',
    // Faixa de pesos
    '^FO18,264^GB764,2,2^FS',
    `^FO32,276^A0N,22,22^FDBRUTO: ${brutoTxt}   TARA: ${taraTxt}^FS`,
    `^FO32,306^A0N,34,34^FDPESO LIQUIDO: ${liqTxt}^FS`,
    '^FO18,348^GB764,2,2^FS',
    // Código de barras à esquerda + QR de rastreabilidade à direita
    `^FO36,368^BY2,3,108^BCN,108,Y,N,N^FD${e.ean}^FS`,
    `^FO632,360^BQN,2,4^FDQA,${e.qr_payload}^FS`,
    // Rodapé rastreável WMSphere
    `^FO32,518^A0N,16,16^FDWMSphere${e.ean_origem ? ` • ORIGEM: ${e.ean_origem}` : ''} • ${e.origem_tipo.slice(0, 26)}^FS`,
    '^XZ',
  ].filter(Boolean).join('\n')
}

export function baixarZplEtiquetas(etiquetas, nomeArquivo = 'etiquetas_zebra_100x70.zpl') {
  const lista = Array.isArray(etiquetas) ? etiquetas : [etiquetas]
  const conteudo = lista.map(gerarZplEtiqueta100x70).join('\n\n')
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Renderiza etiqueta térmica exata de 100mm x 70mm em iframe isolado e dispara impressão automática.
 */
function gerarBarcodeSvgHtml(ean) {
  if (!ean || typeof document === 'undefined') return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, String(ean), {
      format: 'CODE128',
      width: 2.1,
      height: 36,
      displayValue: true,
      fontSize: 12,
      fontOptions: 'bold',
      textMargin: 1,
      margin: 2,
      background: '#ffffff',
      lineColor: '#000000',
    })
    return svg.outerHTML
  } catch (err) {
    console.warn('JsBarcode svg error:', err)
    return `<div style="font-family:monospace;font-weight:bold;">${escHtml(ean)}</div>`
  }
}

export function montarHtmlEtiqueta100x70(etiquetas) {
  const lista = (Array.isArray(etiquetas) ? etiquetas : [etiquetas])
    .filter(Boolean)
    .map(normalizarEtiqueta)
  if (lista.length === 0) return ''

  const cardsHtml = lista.map((e) => `
    <div class="zlabel">
      <div class="ztop">
        <div class="ztop-left">
          <div class="zbrand">${escHtml(e.empresa_nome)}</div>
          <div class="zsub">WMSphere Rastreabilidade • ${escHtml(e.origem_tipo)}</div>
        </div>
        ${e.selo_sanitario ? `<div class="zselo-pill">${escHtml(e.selo_sanitario)}</div>` : `<div class="zselo-pill">COD. ${escHtml(e.codigo)}</div>`}
      </div>

      ${e.especificacao ? `<div class="zespec">${escHtml(e.especificacao)}</div>` : ''}

      <div class="zprod-row">
        <div class="zprod">${escHtml(e.descricao)}</div>
        <div class="zcod-box">
          <span>CÓD</span>
          <strong>${escHtml(e.codigo)}</strong>
        </div>
      </div>

      <div class="zmeta-grid">
        <div class="zcell">
          <span class="zlbl">DATA PRODUÇÃO</span>
          <strong class="zval">${escHtml(fmtDataBR(e.data_producao))}</strong>
        </div>
        <div class="zcell">
          <span class="zlbl">VALIDADE</span>
          <strong class="zval">${escHtml(fmtDataBR(e.validade))}</strong>
        </div>
        <div class="zcell">
          <span class="zlbl">LOTE / OP</span>
          <strong class="zval zval-mono">${escHtml(e.lote_op)}</strong>
        </div>
        <div class="zcell" style="text-align:right">
          <span class="zlbl">PEÇAS</span>
          <strong class="zval zval-mono">${escHtml(e.qtd_pecas != null ? `${e.qtd_pecas} pç` : '-')}</strong>
        </div>
      </div>

      ${e.temperatura_rotulo ? `<div class="ztemp">${escHtml(e.temperatura_rotulo)}</div>` : ''}

      <div class="zpeso-strip">
        <div class="zpeso-item">
          <span>PESO BRUTO</span>
          <strong>${escHtml(fmtKg3(e.peso_bruto_kg))}</strong>
        </div>
        <div class="zpeso-item">
          <span>TARA</span>
          <strong>${escHtml(fmtKg3(e.tara_kg))}</strong>
        </div>
        <div class="zpeso-item zpeso-liq">
          <span>PESO LÍQUIDO</span>
          <strong>${escHtml(fmtKg3(e.peso_liquido_kg))}</strong>
        </div>
      </div>

      <div class="zbottom">
        <div class="zbarcode-col">
          ${gerarBarcodeSvgHtml(e.ean)}
          ${e.ean_origem ? `<div class="zorig">Origem: ${escHtml(e.ean_origem)}</div>` : ''}
        </div>
        <div class="zqr-col">
          ${gerarQrSvgHtml(e.qr_payload, 52)}
        </div>
      </div>
    </div>
  `).join('')

  return `<!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Etiqueta WMSphere 100x70mm</title>
    <style>
      @page { size: 100mm 70mm; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { width: 100mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
      .zlabel { width: 100mm; height: 70mm; padding: 2mm 2.8mm 1.8mm 2.8mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; break-after: page; overflow: hidden; background: #fff; border: 0.6pt solid #000; }
      .zlabel:last-child { page-break-after: auto; break-after: auto; }
      .ztop { background: #000; color: #fff; padding: 1.2mm 2mm; border-radius: 0.8mm; display: flex; justify-content: space-between; align-items: center; gap: 2mm; }
      .zbrand { font-size: 8.5pt; font-weight: 900; letter-spacing: 0.3px; line-height: 1.05; }
      .zsub { font-size: 5.5pt; font-weight: 700; opacity: 0.9; margin-top: 0.3mm; }
      .zselo-pill { background: #fff; color: #000; font-size: 6pt; font-weight: 900; padding: 0.7mm 1.6mm; border-radius: 0.6mm; white-space: nowrap; }
      .zespec { text-align: center; font-size: 7.4pt; font-weight: 900; letter-spacing: 0.3px; border-bottom: 1pt solid #000; padding: 0.7mm 0; margin-top: 0.6mm; text-transform: uppercase; }
      .zprod-row { display: flex; align-items: center; justify-content: space-between; gap: 2mm; margin: 0.8mm 0; }
      .zprod { font-size: 10.5pt; font-weight: 900; line-height: 1.1; text-transform: uppercase; max-height: 8mm; overflow: hidden; flex: 1; }
      .zcod-box { background: #000; color: #fff; padding: 0.6mm 1.8mm; border-radius: 0.6mm; text-align: center; flex-shrink: 0; }
      .zcod-box span { display: block; font-size: 4.8pt; font-weight: 700; opacity: 0.85; }
      .zcod-box strong { display: block; font-size: 8.8pt; font-weight: 900; font-family: 'Courier New', monospace; }
      .zmeta-grid { display: grid; grid-template-columns: 0.95fr 0.95fr 1.2fr 0.58fr; gap: 1mm; border-top: 0.8pt solid #000; border-bottom: 0.8pt solid #000; padding: 0.8mm 0; }
      .zcell { display: flex; flex-direction: column; }
      .zlbl { font-size: 5.3pt; font-weight: 700; color: #222; }
      .zval { font-size: 8pt; font-weight: 800; }
      .zval-mono { font-family: 'Courier New', monospace; font-size: 8.2pt; font-weight: 900; }
      .ztemp { font-size: 5.5pt; font-weight: 800; text-align: center; padding-top: 0.4mm; letter-spacing: 0.2px; }
      .zpeso-strip { display: grid; grid-template-columns: 1fr 0.85fr 1.25fr; gap: 1.2mm; background: #f3f4f6; border: 1pt solid #000; padding: 0.8mm 1.4mm; margin-top: 0.6mm; }
      .zpeso-item { display: flex; flex-direction: column; }
      .zpeso-item span { font-size: 5.2pt; font-weight: 700; }
      .zpeso-item strong { font-size: 8.4pt; font-weight: 800; font-family: 'Courier New', monospace; }
      .zpeso-liq strong { font-size: 10.5pt; font-weight: 900; }
      .zbottom { display: flex; align-items: center; justify-content: space-between; gap: 1.5mm; margin-top: 0.6mm; }
      .zbarcode-col { flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 0; }
      .zbarcode-col svg { max-width: 75mm; height: 13mm; }
      .zorig { font-size: 5.2pt; font-family: 'Courier New', monospace; font-weight: 700; margin-top: 0.2mm; }
      .zqr-col { flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: 0.6pt solid #000; padding: 0.5mm; border-radius: 0.5mm; }
      .zqr-col svg { width: 13mm; height: 13mm; display: block; }
    </style>
  </head>
  <body>${cardsHtml}</body>
  </html>`
}

export async function imprimirZebraUsbZpl(etiquetas, { solicitarSeNaoPareada = true } = {}) {
  if (typeof navigator === 'undefined' || !navigator.usb) {
    throw new Error('Navegador não suporta WebUSB para envio direto à Zebra USB. Use Chrome/Edge ou App Desktop.')
  }
  const lista = (Array.isArray(etiquetas) ? etiquetas : [etiquetas]).filter(Boolean)
  if (lista.length === 0) return

  let devices = await navigator.usb.getDevices()
  let zebra = devices.find((d) => d.vendorId === 0x0a5f)
  if (!zebra && solicitarSeNaoPareada) {
    zebra = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0a5f }] })
  }
  if (!zebra) {
    throw new Error('Nenhuma impressora Zebra USB pareada neste navegador.')
  }

  const zpl = lista.map(gerarZplEtiqueta100x70).join('\n')
  const bytes = new TextEncoder().encode(zpl)

  await zebra.open()
  try {
    if (zebra.configuration === null) {
      await zebra.selectConfiguration(1)
    }
    const iface =
      zebra.configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 7)) ||
      zebra.configuration.interfaces[0]
    if (!iface) throw new Error('Interface USB de impressão não localizada na Zebra.')

    await zebra.claimInterface(iface.interfaceNumber)
    const outEp = iface.alternate.endpoints.find((ep) => ep.direction === 'out')
    if (!outEp) throw new Error('Endpoint de saída (OUT) não encontrado na impressora Zebra.')
    await zebra.transferOut(outEp.endpointNumber, bytes)
  } finally {
    try {
      await zebra.close()
    } catch {
      /* ignore */
    }
  }
}

export async function despacharImpressaoEtiqueta(etiquetas, { onAbrirModal } = {}) {
  const lista = (Array.isArray(etiquetas) ? etiquetas : [etiquetas]).filter(Boolean)
  if (lista.length === 0) return { modo: 'NENHUM' }
  const cfg = lerConfigEstacao()

  if (cfg.modoImpressao === 'ZEBRA_USB_ZPL') {
    try {
      await imprimirZebraUsbZpl(lista, { solicitarSeNaoPareada: false })
      return { modo: 'ZEBRA_USB_ZPL', ok: true }
    } catch (err) {
      if (window?.wmsAPI?.printer?.printHtmlSilent) {
        const html = montarHtmlEtiqueta100x70(lista)
        await window.wmsAPI.printer.printHtmlSilent({ html, deviceName: cfg.impressoraNome || '' })
        return { modo: 'SILENCIOSA_APP', ok: true }
      }
      imprimirEtiquetasZebraAuto(lista)
      return { modo: 'FALLBACK_JANELA', erroUsb: err.message }
    }
  }

  if (cfg.modoImpressao === 'SILENCIOSA') {
    if (window?.wmsAPI?.printer?.printHtmlSilent) {
      const html = montarHtmlEtiqueta100x70(lista)
      await window.wmsAPI.printer.printHtmlSilent({ html, deviceName: cfg.impressoraNome || '' })
      return { modo: 'SILENCIOSA_APP', ok: true }
    }
    imprimirEtiquetasZebraAuto(lista)
    return { modo: 'SILENCIOSA_NAVEGADOR', ok: true }
  }

  if (onAbrirModal) {
    onAbrirModal(lista)
    return { modo: 'JANELA', ok: true }
  }
  imprimirEtiquetasZebraAuto(lista)
  return { modo: 'JANELA', ok: true }
}

export function imprimirEtiquetasZebraAuto(etiquetas) {
  const html = montarHtmlEtiqueta100x70(etiquetas)
  if (!html) return

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 500)
  }

  setTimeout(() => {
    try {
      iframe.contentWindow.onafterprint = cleanup
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      setTimeout(cleanup, 15000)
    } catch (err) {
      console.error('Erro ao disparar impressão Zebra:', err)
      cleanup()
    }
  }, 150)
}

function BarcodeSvg({ value }) {
  const svgRef = useRef(null)
  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, String(value), {
        format: 'CODE128',
        width: 1.9,
        height: 44,
        displayValue: true,
        fontSize: 12,
        fontOptions: 'bold',
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch (_) {}
  }, [value])

  return <svg ref={svgRef} style={{ maxWidth: '100%', height: 'auto' }} />
}

export function EtiquetaZebraCard({ etiqueta }) {
  const e = normalizarEtiqueta(etiqueta)
  const qrHtml = gerarQrSvgHtml(e.qr_payload, 56)
  return (
    <div style={{
      background: '#ffffff',
      color: '#090d16',
      border: '2px solid #090d16',
      borderRadius: 8,
      padding: '10px 12px',
      width: '100%',
      maxWidth: 400,
      fontFamily: 'Arial, Helvetica, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#090d16', color: '#ffffff', borderRadius: 5, padding: '6px 9px', marginBottom: 6, gap: 8 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '0.4px' }}>{e.empresa_nome}</div>
          <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.85 }}>WMSphere • {e.origem_tipo}</div>
        </div>
        <span style={{
          background: '#ffffff', color: '#090d16', fontSize: 9, fontWeight: 900,
          padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
        }}>
          {e.selo_sanitario || `CÓD. ${e.codigo}`}
        </span>
      </div>

      {e.especificacao && (
        <div style={{
          textAlign: 'center', fontSize: 10.5, fontWeight: 900, letterSpacing: '0.35px',
          borderBottom: '1.5px solid #090d16', paddingBottom: 4, marginBottom: 6, color: '#0f172a',
        }}>
          {e.especificacao}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.15, textTransform: 'uppercase', flex: 1 }}>
          {e.descricao}
        </div>
        <div style={{ background: '#090d16', color: '#fff', borderRadius: 4, padding: '3px 7px', textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 7.5, fontWeight: 700, opacity: 0.8 }}>CÓD</div>
          <div style={{ fontSize: 12, fontWeight: 900, fontFamily: 'monospace' }}>{e.codigo}</div>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '0.95fr 0.95fr 1.25fr 0.6fr', gap: 6,
        borderTop: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1',
        padding: '5px 0', marginBottom: 6,
      }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>DATA PROD.</div>
          <div style={{ fontSize: 11.5, fontWeight: 800 }}>{fmtDataBR(e.data_producao)}</div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>VALIDADE</div>
          <div style={{ fontSize: 11.5, fontWeight: 800 }}>{fmtDataBR(e.validade)}</div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>LOTE / OP</div>
          <div style={{ fontSize: 11.5, fontWeight: 900, fontFamily: 'monospace' }}>{e.lote_op}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>PEÇAS</div>
          <div style={{ fontSize: 12, fontWeight: 900, fontFamily: 'monospace' }}>
            {e.qtd_pecas != null ? `${e.qtd_pecas} pç` : '-'}
          </div>
        </div>
      </div>

      {e.temperatura_rotulo && (
        <div style={{ textAlign: 'center', fontSize: 8.5, fontWeight: 800, color: '#334155', marginBottom: 5 }}>
          {e.temperatura_rotulo}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 0.85fr 1.25fr', gap: 6,
        background: '#f1f5f9', border: '1px solid #090d16', borderRadius: 4, padding: '5px 8px',
        marginBottom: 6,
      }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>PESO BRUTO</div>
          <div style={{ fontSize: 11.5, fontWeight: 800, fontFamily: 'monospace' }}>{fmtKg3(e.peso_bruto_kg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>TARA</div>
          <div style={{ fontSize: 11.5, fontWeight: 800, fontFamily: 'monospace' }}>{fmtKg3(e.tara_kg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>PESO LÍQUIDO</div>
          <div style={{ fontSize: 14, fontWeight: 900, fontFamily: 'monospace' }}>{fmtKg3(e.peso_liquido_kg)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
          <BarcodeSvg value={e.ean} />
          {e.ean_origem && (
            <div style={{ fontSize: 8.5, fontFamily: 'monospace', color: '#334155', marginTop: 2 }}>
              Origem: {e.ean_origem}
            </div>
          )}
        </div>
        {qrHtml && (
          <div
            style={{ border: '1px solid #090d16', borderRadius: 4, padding: 3, flexShrink: 0, background: '#fff' }}
            dangerouslySetInnerHTML={{ __html: qrHtml }}
          />
        )}
      </div>
    </div>
  )
}

export function EtiquetaZebraModal({
  isOpen,
  etiquetas = [],
  autoPrint = false,
  onClose,
  titulo = 'Etiquetas Térmicas Zebra (100 × 70 mm)',
  subtitulo = 'Confira os dados abaixo. A janela de impressão é configurada em 100mm × 70mm.',
}) {
  const autoPrintedKeyRef = useRef('')

  useEffect(() => {
    if (!isOpen || !autoPrint || !etiquetas?.length) return
    const key = etiquetas.map(x => `${x.ean_caixa || x.ean}-${x.peso_liquido_kg || x.peso_kg}`).join('|')
    if (autoPrintedKeyRef.current !== key) {
      autoPrintedKeyRef.current = key
      imprimirEtiquetasZebraAuto(etiquetas)
    }
  }, [isOpen, autoPrint, etiquetas])

  if (!isOpen || !etiquetas?.length) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: 'rgba(4, 8, 18, 0.85)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--border-light)',
        borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag size={20} color="#38bdf8" />
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                {titulo} ({etiquetas.length})
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                {subtitulo}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => baixarZplEtiquetas(etiquetas)}
              style={{
                background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border-light)',
                padding: '8px 13px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Download size={15} /> Baixar ZPL
            </button>
            <button
              type="button"
              onClick={() => imprimirEtiquetasZebraAuto(etiquetas)}
              style={{
                background: '#16a34a', color: '#fff', border: 'none',
                padding: '8px 15px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Printer size={15} /> Imprimir Zebra (100×70mm)
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent', color: 'var(--text-secondary)', border: 'none',
                padding: 6, cursor: 'pointer', borderRadius: 6,
              }}
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div style={{
          padding: 20, overflowY: 'auto', display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 18, justifyItems: 'center', background: 'var(--bg-1)',
        }}>
          {etiquetas.map((et, idx) => (
            <div key={et.ean_caixa || et.ean || idx} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> Etiqueta #{idx + 1} • EAN {et.ean_caixa || et.ean}
              </div>
              <EtiquetaZebraCard etiqueta={et} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function normalizarEtiquetaReserva(raw) {
  const ean = String(raw?.ean_caixa || raw?.ean || '').trim()
  const cliente = String(
    raw?.cliente_nome || raw?.cliente_reservado_nome || raw?.pedido_cliente || raw?.cliente || 'CLIENTE NÃO INFORMADO'
  ).trim().toUpperCase()
  const pedido = String(raw?.pedido_codigo || raw?.pedido_reservado_codigo || 'AVULSO').trim().toUpperCase()
  const romaneio = String(raw?.romaneio_codigo || raw?.romaneio_reservado_codigo || '-').trim().toUpperCase()
  const codigo = String(raw?.produto_codigo || raw?.codigo || '-').trim()
  const descricao = String(raw?.produto_descricao || raw?.descricao || 'PRODUTO').trim().toUpperCase()
  const pecasRaw = Number(raw?.qtd_pecas ?? raw?.pecas ?? 0)
  const qtd_pecas = Number.isFinite(pecasRaw) && pecasRaw > 0 ? Math.trunc(pecasRaw) : null
  const peso_kg = Number(raw?.peso_kg ?? raw?.peso_liquido_kg ?? 0)
  const lote = String(raw?.lote || '-').trim()
  const validade = raw?.validade || null

  return {
    ean,
    cliente,
    pedido,
    romaneio,
    codigo,
    descricao,
    qtd_pecas,
    peso_kg,
    lote,
    validade,
  }
}

export function gerarZplEtiquetaReserva100x70(raw) {
  const e = normalizarEtiquetaReserva(raw)
  const cli1 = e.cliente.slice(0, 28)
  const prod1 = `${e.codigo} - ${e.descricao}`.slice(0, 42)
  const liqTxt = `${Number(e.peso_kg || 0).toFixed(2).replace('.', ',')} kg`
  const pecasTxt = e.qtd_pecas != null ? `${e.qtd_pecas} PC` : '-'

  return [
    '^XA',
    '^CI28',
    '^PW800',
    '^LL560',
    '^LH0,0',
    '^FO24,18^GB752,524,3^FS',
    '^FO24,18^GB752,54,54^FS',
    '^FO38,30^A0N,30,30^FR^FDRESERVADO^FS',
    `^FO330,32^A0N,22,22^FR^FDPED: ${e.pedido}  ROM: ${e.romaneio}^FS`,
    `^FO38,92^A0N,42,42^FD${cli1}^FS`,
    '^FO24,152^GB752,2,2^FS',
    `^FO38,168^A0N,26,26^FD${prod1}^FS`,
    `^FO38,208^A0N,26,26^FDPECAS: ${pecasTxt}   PESO LIQ: ${liqTxt}   LOTE: ${e.lote}^FS`,
    `^FO38,244^A0N,22,22^FDVAL: ${fmtDataBR(e.validade)}   TRICARNES WMS^FS`,
    '^FO24,284^GB752,2,2^FS',
    `^FO90,308^BY2,3,115^BCN,115,Y,N,N^FD${e.ean}^FS`,
    '^XZ',
  ].join('\n')
}

export function baixarZplEtiquetasReserva(etiquetas, nomeArquivo = 'etiquetas_reserva_100x70.zpl') {
  const lista = Array.isArray(etiquetas) ? etiquetas : [etiquetas]
  const conteudo = lista.map(gerarZplEtiquetaReserva100x70).join('\n\n')
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Impressão em lote 100×70mm de Etiquetas de Identificação de Caixas Reservadas para Pedido/Cliente.
 */
export function imprimirEtiquetasReservaAuto(etiquetas) {
  const lista = (Array.isArray(etiquetas) ? etiquetas : [etiquetas])
    .filter(Boolean)
    .map(normalizarEtiquetaReserva)
  if (lista.length === 0) return

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow.document
  const cardsHtml = lista.map((e, idx) => `
    <div class="rlabel">
      <div class="rtop">
        <div class="rstatus">RESERVADO</div>
        <div class="rdocs">
          <span>PED: <strong>${escHtml(e.pedido)}</strong></span>
          <span>•</span>
          <span>ROM: <strong>${escHtml(e.romaneio)}</strong></span>
        </div>
      </div>

      <div class="rclient-box">
        <div class="rclient-lbl">CLIENTE DESTINATÁRIO</div>
        <div class="rclient-name ${e.cliente.length > 26 ? 'rclient-name--sm' : ''}">${escHtml(e.cliente)}</div>
      </div>

      <div class="rprod">
        <span class="rcod">COD. ${escHtml(e.codigo)}</span> — ${escHtml(e.descricao)}
      </div>

      <div class="rmeta">
        <div>
          <span>PEÇAS</span>
          <strong>${escHtml(e.qtd_pecas != null ? `${e.qtd_pecas} pç` : '-')}</strong>
        </div>
        <div>
          <span>PESO LÍQUIDO</span>
          <strong>${escHtml(fmtKg2(e.peso_kg))}</strong>
        </div>
        <div>
          <span>LOTE</span>
          <strong>${escHtml(e.lote)}</strong>
        </div>
        <div>
          <span>VALIDADE</span>
          <strong>${escHtml(fmtDataBR(e.validade))}</strong>
        </div>
      </div>

      <div class="rbarcode-wrap">
        <svg id="rbarcode-${idx}"></svg>
      </div>
    </div>
  `).join('')

  doc.open()
  doc.write(`<!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Etiquetas Reservado 100x70mm</title>
    <style>
      @page { size: 100mm 70mm; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { width: 100mm; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
      .rlabel {
        width: 100mm; height: 70mm; padding: 2.5mm 3mm 2mm 3mm;
        display: flex; flex-direction: column; justify-content: space-between;
        page-break-after: always; break-after: page; overflow: hidden; background: #fff;
      }
      .rlabel:last-child { page-break-after: auto; break-after: auto; }
      .rtop {
        background: #000; color: #fff; padding: 1.5mm 2.5mm; border-radius: 1mm;
        display: flex; justify-content: space-between; align-items: center;
      }
      .rstatus { font-size: 11.5pt; font-weight: 900; letter-spacing: 1px; }
      .rdocs { font-size: 7.8pt; display: flex; gap: 1.5mm; align-items: center; }
      .rclient-box {
        border: 1.5pt solid #000; border-radius: 1.2mm; padding: 1.4mm 2.2mm;
        background: #f3f4f6; margin-top: 1.2mm;
      }
      .rclient-lbl { font-size: 5.8pt; font-weight: 800; letter-spacing: 0.6px; color: #222; }
      .rclient-name {
        font-size: 16pt; font-weight: 900; line-height: 1.08;
        text-transform: uppercase; max-height: 11.5mm; overflow: hidden;
      }
      .rclient-name--sm { font-size: 12.5pt; }
      .rprod {
        font-size: 9pt; font-weight: 800; line-height: 1.15; margin-top: 1mm;
        max-height: 7.2mm; overflow: hidden; text-transform: uppercase;
      }
      .rcod { font-family: 'Courier New', monospace; }
      .rmeta {
        display: grid; grid-template-columns: 0.85fr 1fr 0.9fr 0.9fr; gap: 1.2mm;
        border-top: 0.8pt solid #000; border-bottom: 0.8pt solid #000; padding: 1mm 0; margin-top: 1mm;
      }
      .rmeta span { display: block; font-size: 5.5pt; font-weight: 700; color: #333; }
      .rmeta strong { display: block; font-size: 9pt; font-weight: 900; font-family: 'Courier New', monospace; }
      .rbarcode-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; margin-top: 0.5mm; }
      .rbarcode-wrap svg { max-width: 92mm; height: 15.5mm; }
    </style>
  </head>
  <body>${cardsHtml}</body>
  </html>`)
  doc.close()

  lista.forEach((e, idx) => {
    const svg = doc.getElementById(`rbarcode-${idx}`)
    if (svg && e.ean) {
      try {
        JsBarcode(svg, e.ean, {
          format: 'CODE128',
          width: 2.1,
          height: 36,
          displayValue: true,
          fontSize: 12,
          fontOptions: 'bold',
          textMargin: 1,
          margin: 2,
          background: '#ffffff',
          lineColor: '#000000',
        })
      } catch (err) {
        console.warn('JsBarcode print error:', err)
      }
    }
  })

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 500)
  }

  setTimeout(() => {
    try {
      iframe.contentWindow.onafterprint = cleanup
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
      setTimeout(cleanup, 15000)
    } catch (err) {
      console.error('Erro ao disparar impressão Reserva Zebra:', err)
      cleanup()
    }
  }, 150)
}

export function EtiquetaReservaCard({ etiqueta }) {
  const e = normalizarEtiquetaReserva(etiqueta)
  return (
    <div style={{
      background: '#ffffff',
      color: '#090d16',
      border: '2px solid #090d16',
      borderRadius: 8,
      padding: '10px 12px',
      width: '100%',
      maxWidth: 380,
      fontFamily: 'Arial, Helvetica, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    }}>
      <div style={{
        background: '#090d16', color: '#ffffff', borderRadius: 4,
        padding: '5px 9px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '1px' }}>RESERVADO</span>
        <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>
          PED: {e.pedido} • ROM: {e.romaneio}
        </span>
      </div>

      <div style={{
        border: '2px solid #090d16', borderRadius: 6, background: '#f1f5f9',
        padding: '6px 9px', marginBottom: 8,
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#334155', letterSpacing: '0.5px' }}>CLIENTE DESTINATÁRIO</div>
        <div style={{
          fontSize: e.cliente.length > 26 ? 16 : 20, fontWeight: 900, lineHeight: 1.12,
          textTransform: 'uppercase', color: '#090d16', wordBreak: 'break-word',
        }}>
          {e.cliente}
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
        <span style={{ fontFamily: 'monospace', color: '#334155' }}>COD. {e.codigo}</span> — {e.descricao}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '0.85fr 1fr 0.9fr 0.9fr', gap: 6,
        borderTop: '1px solid #94a3b8', borderBottom: '1px solid #94a3b8',
        padding: '6px 0', marginBottom: 8,
      }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>PEÇAS</div>
          <div style={{ fontSize: 13, fontWeight: 900, fontFamily: 'monospace' }}>
            {e.qtd_pecas != null ? `${e.qtd_pecas} pç` : '-'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>PESO LÍQ.</div>
          <div style={{ fontSize: 13, fontWeight: 900 }}>{fmtKg2(e.peso_kg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>LOTE</div>
          <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>{e.lote}</div>
        </div>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#475569' }}>VALIDADE</div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtDataBR(e.validade)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <BarcodeSvg value={e.ean} />
      </div>
    </div>
  )
}

export function EtiquetaReservaZebraModal({
  isOpen,
  etiquetas = [],
  autoPrint = false,
  onClose,
  titulo = 'Etiquetas de Identificação — Caixas Reservadas (100 × 70 mm)',
  subtitulo = 'Impressão em lote preservando o EAN original das caixas separadas.',
}) {
  const autoPrintedKeyRef = useRef('')

  useEffect(() => {
    if (!isOpen || !autoPrint || !etiquetas?.length) return
    const key = etiquetas.map(x => `${x.romaneio_codigo || ''}-${x.ean_caixa || x.ean}`).join('|')
    if (autoPrintedKeyRef.current !== key) {
      autoPrintedKeyRef.current = key
      imprimirEtiquetasReservaAuto(etiquetas)
    }
  }, [isOpen, autoPrint, etiquetas])

  if (!isOpen || !etiquetas?.length) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1250,
      background: 'rgba(4, 8, 18, 0.85)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--border-light)',
        borderRadius: 14, width: '100%', maxWidth: 960, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag size={20} color="#fbbf24" />
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                {titulo} ({etiquetas.length} caixas)
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                {subtitulo}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => baixarZplEtiquetasReserva(etiquetas)}
              style={{
                background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border-light)',
                padding: '8px 13px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Download size={15} /> Baixar ZPL Lote
            </button>
            <button
              type="button"
              onClick={() => imprimirEtiquetasReservaAuto(etiquetas)}
              style={{
                background: '#16a34a', color: '#fff', border: 'none',
                padding: '8px 15px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Printer size={15} /> Imprimir Todas ({etiquetas.length}) — Zebra 100×70mm
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent', color: 'var(--text-secondary)', border: 'none',
                padding: 6, cursor: 'pointer', borderRadius: 6,
              }}
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div style={{
          padding: 20, overflowY: 'auto', display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 18, justifyItems: 'center', background: 'var(--bg-1)',
        }}>
          {etiquetas.map((et, idx) => (
            <div key={`${et.ean_caixa || et.ean}-${idx}`} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> Caixa #{idx + 1} • EAN {et.ean_caixa || et.ean}
              </div>
              <EtiquetaReservaCard etiqueta={et} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default EtiquetaZebraModal
