import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download, Printer, QrCode, X } from 'lucide-react'
import { lerConfigEstacao } from '../../utils/estacaoConfig'
import { useAppStore } from '../../store/appStore'

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function limparZpl(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\^~]/g, ' ')
    .trim()
}

function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDataBR(d) {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-')
    return `${day}/${m}/${y}`
  }
  return s
}

/**
 * Monta o payload compacto do QR Code personalizado para o PDV Frente de Caixa.
 * Ex: TRIC|ID=ETQ00001|COD=3244|KG=1.250|VL=74.88|LT=L2111
 */
export function montarPayloadQrPdv({ codigoEtiqueta = '', codigo, pesoKg, valorTotal, lote = '', validade = '' }) {
  const cod = String(codigo || '').trim()
  const kg = Number(pesoKg || 0)
  const vl = Number(valorTotal || 0)
  const parts = ['TRIC']
  if (codigoEtiqueta) parts.push(`ID=${String(codigoEtiqueta).trim().toUpperCase()}`)
  if (cod) parts.push(`COD=${cod}`)
  if (kg > 0) parts.push(`KG=${kg.toFixed(3)}`)
  if (vl > 0) parts.push(`VL=${vl.toFixed(2)}`)
  if (lote) parts.push(`LT=${String(lote).trim().slice(0, 16)}`)
  if (validade) parts.push(`VAL=${String(validade).slice(0, 10)}`)
  return parts.join('|')
}

export function montarPayloadQrInsumo(enderecoCodigo) {
  return `INS|END=${String(enderecoCodigo || '').trim().toUpperCase()}`
}

/**
 * Gera código ZPL II nativo para impressora Zebra 203 DPI — Etiqueta 80mm x 45mm (640 x 360 dots).
 * - Modo 'PDV': Item, Peso, Preço/kg, Valor Total em destaque, Conservação e QR Code único p/ PDV!
 * - Modo 'INSUMO': Endereço em destaque, Produto, Unidade e QR Code para bipar na Coleta de Insumos!
 */
export function gerarZplEtiqueta80x45(dados, modo = 'PDV') {
  const st = useAppStore.getState?.()
  const fil = (st?.filiaisDisponiveis || []).find((f) => String(f.id) === String(st?.filialAtivaId))
  const empresa = limparZpl(dados?.empresa_nome || fil?.nome || 'VAREJO & ACOUGUE').toUpperCase().slice(0, 28)

  if (modo === 'INSUMO') {
    const end = limparZpl(dados?.endereco_codigo || 'ALM-01').toUpperCase()
    const desc = limparZpl(dados?.produto_descricao || 'INSUMO').toUpperCase()
    const desc1 = desc.slice(0, 26)
    const desc2 = desc.slice(26, 52)
    const un = limparZpl(dados?.unidade || 'UN').toUpperCase()
    const payload = montarPayloadQrInsumo(end)

    return [
      '^XA',
      '^CI28',
      '^PW640',
      '^LL360',
      '^LH0,0',
      '^FO12,10^GB616,340,3^FS',
      '^FO12,10^GB616,42,42,B^FS',
      `^FO24,20^FR^A0N,24,24^FDALMOXARIFADO INSUMOS - ${empresa.slice(0, 22)}^FS`,
      `^FO24,66^A0N,46,44^FD${end}^FS`,
      `^FO24,126^A0N,24,24^FD${desc1}^FS`,
      desc2 ? `^FO24,156^A0N,22,22^FD${desc2}^FS` : '',
      `^FO24,202^A0N,22,22^FDUNIDADE: ${un}^FS`,
      `^FO24,236^A0N,20,20^FDCOD: ${limparZpl(dados?.produto_codigo || '-')}^FS`,
      '^FO24,296^A0N,18,18^FDBIPE O QR NA COLETA DE INSUMOS^FS',
      `^FO430,80^BQN,2,6^FDQA,${payload}^FS`,
      '^XZ',
    ]
      .filter(Boolean)
      .join('\n')
  }

  // Modo PDV / Açougue / Empório com QR Code mostrando Item, Peso, Valor e Serial Único
  const desc = limparZpl(dados?.descricao || 'PRODUTO').toUpperCase()
  const desc1 = desc.slice(0, 26)
  const desc2 = desc.slice(26, 52)
  const cod = limparZpl(dados?.codigo || '-')
  const serial = limparZpl(dados?.codigo_etiqueta || '')
  const conserv = limparZpl(dados?.conservacao || '').toUpperCase()
  const un = limparZpl(dados?.unidade || 'KG').toUpperCase()
  const peso = Number(dados?.peso_kg ?? dados?.qtd ?? 0)
  const precoKg = Number(dados?.preco_unitario ?? 0)
  const total = Number(dados?.valor_total ?? Number((peso * precoKg).toFixed(2)))
  const valStr = fmtDataBR(dados?.validade)
  const payload =
    dados?.payload_qr ||
    montarPayloadQrPdv({
      codigoEtiqueta: serial,
      codigo: cod,
      pesoKg: peso,
      valorTotal: total,
      lote: dados?.lote || '',
      validade: dados?.validade || '',
    })

  const pesoTxt = un === 'KG' ? `${peso.toFixed(3).replace('.', ',')} kg` : `${peso} ${un}`
  const unitTxt = `R$ ${precoKg.toFixed(2).replace('.', ',')}/${un}`
  const totalTxt = `R$ ${total.toFixed(2).replace('.', ',')}`

  return [
    '^XA',
    '^CI28',
    '^PW640',
    '^LL360',
    '^LH0,0',
    '^FO10,10^GB620,340,3^FS',
    '^FO10,10^GB620,38,38,B^FS',
    `^FO22,18^FR^A0N,22,22^FD${empresa}   ${serial || `COD:${cod}`}^FS`,
    `^FO22,58^A0N,26,24^FD${desc1}^FS`,
    desc2 ? `^FO22,88^A0N,24,22^FD${desc2}^FS` : '',
    `^FO22,126^A0N,22,22^FDPESO/QTD: ${pesoTxt}^FS`,
    `^FO22,158^A0N,20,20^FDPRECO: ${unitTxt}${conserv ? ` • ${conserv}` : ''}^FS`,
    '^FO20,192^GB390,94,3^FS',
    '^FO32,202^A0N,18,18^FDVALOR A PAGAR^FS',
    `^FO32,226^A0N,50,46^FD${totalTxt}^FS`,
    `^FO22,300^A0N,18,18^FDVAL: ${valStr}  ${dados?.lote ? `LT: ${limparZpl(dados.lote)}` : ''}^FS`,
    `^FO22,324^A0N,16,16^FD${serial ? `${serial} • ` : ''}BIPE O QR NO CAIXA PDV^FS`,
    `^FO430,74^BQN,2,5^FDQA,${payload}^FS`,
    '^XZ',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function imprimirEtiqueta80x45Html(dados, modo = 'PDV', copias = 1) {
  const st = useAppStore.getState?.()
  const fil = (st?.filiaisDisponiveis || []).find((f) => String(f.id) === String(st?.filialAtivaId))
  const empresa = String(dados?.empresa_nome || fil?.nome || 'VAREJO & AÇOUGUE').toUpperCase()
  const payload =
    modo === 'INSUMO'
      ? montarPayloadQrInsumo(dados?.endereco_codigo)
      : dados?.payload_qr ||
        montarPayloadQrPdv({
          codigoEtiqueta: dados?.codigo_etiqueta || '',
          codigo: dados?.codigo,
          pesoKg: dados?.peso_kg ?? dados?.qtd,
          valorTotal: dados?.valor_total,
          lote: dados?.lote,
          validade: dados?.validade,
        })

  const qrDataUrl = await QRCode.toDataURL(payload, {
    width: 240,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  })

  const un = String(dados?.unidade || 'KG').toUpperCase()
  const peso = Number(dados?.peso_kg ?? dados?.qtd ?? 0)
  const preco = Number(dados?.preco_unitario ?? 0)
  const total = Number(dados?.valor_total ?? Number((peso * preco).toFixed(2)))
  const serial = String(dados?.codigo_etiqueta || '').trim()
  const conserv = String(dados?.conservacao || '').trim().toUpperCase()

  const etiquetaBody =
    modo === 'INSUMO'
      ? `
        <div class="label">
          <div class="hdr">ALMOXARIFADO INSUMOS • ${escHtml(empresa.slice(0, 24))}</div>
          <div class="grid">
            <div class="left">
              <div class="end-big">${escHtml(String(dados?.endereco_codigo || '').toUpperCase())}</div>
              <div class="desc">${escHtml(String(dados?.produto_descricao || '').toUpperCase())}</div>
              <div class="meta">CÓD: <strong>${escHtml(dados?.produto_codigo || '-')}</strong> • UN: <strong>${escHtml(un)}</strong></div>
              <div class="foot">BIPE ESTE QR CODE NA COLETA DE INSUMOS</div>
            </div>
            <div class="right">
              <img src="${qrDataUrl}" class="qr" alt="QR" />
            </div>
          </div>
        </div>`
      : `
        <div class="label">
          <div class="hdr"><span>${escHtml(empresa.slice(0, 24))}</span><span>${escHtml(serial || `CÓD ${dados?.codigo || '-'}`)}</span></div>
          <div class="grid">
            <div class="left">
              <div class="desc">${escHtml(String(dados?.descricao || '').toUpperCase())}</div>
              <div class="meta-row">
                <div><span class="lbl">PESO / QTD</span><div class="val">${un === 'KG' ? `${peso.toFixed(3).replace('.', ',')} kg` : `${peso} ${escHtml(un)}`}</div></div>
                <div><span class="lbl">PREÇO/${escHtml(un)}</span><div class="val">${escHtml(fmtMoeda(preco))}</div></div>
              </div>
              <div class="price-box">
                <div class="price-lbl">VALOR TOTAL</div>
                <div class="price-val">${escHtml(fmtMoeda(total))}</div>
              </div>
              <div class="foot">VAL: ${escHtml(fmtDataBR(dados?.validade))}${conserv ? ` • ${escHtml(conserv)}` : ''}${dados?.lote ? ` • LT: ${escHtml(dados.lote)}` : ''}</div>
            </div>
            <div class="right">
              <img src="${qrDataUrl}" class="qr" alt="QR PDV" />
              <div class="qr-cap">${serial ? escHtml(serial) : 'BIPE NO CAIXA'}</div>
            </div>
          </div>
        </div>`

  const copiesHtml = Array.from({ length: Math.max(1, Math.min(50, Number(copias || 1))) })
    .map(() => etiquetaBody)
    .join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Etiqueta Zebra 80x45mm</title>
<style>
  @page { size: 80mm 45mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .label {
    width: 80mm; height: 45mm; border: 1.5px solid #000; padding: 1.5mm;
    display: flex; flex-direction: column; page-break-after: always; overflow: hidden;
  }
  .label:last-child { page-break-after: auto; }
  .hdr {
    background: #000; color: #fff; font-size: 7.5pt; font-weight: 800;
    padding: 1mm 1.8mm; display: flex; justify-content: space-between; align-items: center;
  }
  .grid { display: flex; flex: 1; gap: 1.5mm; padding-top: 1.2mm; align-items: stretch; }
  .left { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
  .right { width: 25mm; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .qr { width: 24mm; height: 24mm; image-rendering: pixelated; }
  .qr-cap { font-size: 6pt; font-weight: 800; margin-top: 0.6mm; letter-spacing: 0.3px; }
  .desc { font-size: 8.5pt; font-weight: 900; line-height: 1.15; max-height: 8.5mm; overflow: hidden; }
  .end-big { font-size: 14pt; font-weight: 900; font-family: monospace; letter-spacing: 0.5px; }
  .meta-row { display: flex; gap: 3mm; margin-top: 0.5mm; }
  .lbl { font-size: 5.8pt; font-weight: 700; display: block; }
  .val { font-size: 8.5pt; font-weight: 800; font-family: monospace; }
  .meta { font-size: 7.5pt; margin-top: 1mm; }
  .price-box { border: 1.5px solid #000; padding: 0.8mm 1.5mm; margin-top: 0.8mm; }
  .price-lbl { font-size: 5.5pt; font-weight: 800; }
  .price-val { font-size: 14pt; font-weight: 900; font-family: monospace; line-height: 1.05; }
  .foot { font-size: 6pt; font-weight: 700; margin-top: 0.6mm; }
</style>
</head>
<body>${copiesHtml}</body>
</html>`

  const win = window.open('', '_blank', 'width=420,height=320')
  if (!win) return
  win.document.write(html)
  win.document.close()
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch {
      /* ignore */
    }
  }, 250)
}

export async function imprimirOuBaixarZpl80x45(dados, modo = 'PDV', copias = 1) {
  const zpl = Array.from({ length: Math.max(1, Number(copias || 1)) })
    .map(() => gerarZplEtiqueta80x45(dados, modo))
    .join('\n')
  const cfg = lerConfigEstacao()
  if (window?.electronAPI?.imprimirZpl && cfg?.zebraPrinterName) {
    await window.electronAPI.imprimirZpl({ printerName: cfg.zebraPrinterName, zpl })
    return { enviadoZebra: true, zpl }
  }
  const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `etiqueta_80x45_${modo.toLowerCase()}.zpl`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { enviadoZebra: false, zpl }
}

/**
 * Modal de Pré-visualização e Impressão da Etiqueta Zebra 80x45mm com QR Code (PDV ou Insumo).
 */
export function ModalEtiquetaZebra80x45({ aberto, onClose, dados, modo = 'PDV', toastSuccess }) {
  const [qrUrl, setQrUrl] = useState('')
  const [copias, setCopias] = useState(1)

  const payload =
    modo === 'INSUMO'
      ? montarPayloadQrInsumo(dados?.endereco_codigo)
      : dados?.payload_qr ||
        montarPayloadQrPdv({
          codigoEtiqueta: dados?.codigo_etiqueta || '',
          codigo: dados?.codigo,
          pesoKg: dados?.peso_kg ?? dados?.qtd,
          valorTotal: dados?.valor_total,
          lote: dados?.lote,
          validade: dados?.validade,
        })

  useEffect(() => {
    if (!aberto || !dados) return
    QRCode.toDataURL(payload, { width: 220, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQrUrl)
      .catch(() => setQrUrl(''))
  }, [aberto, dados, payload])

  if (!aberto || !dados) return null

  const un = String(dados.unidade || 'KG').toUpperCase()
  const peso = Number(dados.peso_kg ?? dados.qtd ?? 0)
  const preco = Number(dados.preco_unitario ?? 0)
  const total = Number(dados.valor_total ?? Number((peso * preco).toFixed(2)))

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1100 }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="card" style={{ width: '95%', maxWidth: 520, padding: 0, overflow: 'hidden', background: 'var(--bg-1)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 18px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h3 className="text-sm font-bold m-0 flex items-center gap-8">
            <QrCode size={17} className="text-primary" /> Etiqueta Zebra 80×45mm — {modo === 'INSUMO' ? 'Endereço de Insumo' : 'QR Code p/ Caixa (PDV)'}
          </h3>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* PREVIEW VISUAL EXATO 80x45mm */}
          <div
            style={{
              background: '#ffffff',
              color: '#000000',
              border: '2px solid #000000',
              borderRadius: 6,
              padding: 10,
              maxWidth: 420,
              width: '100%',
              margin: '0 auto',
            }}
          >
            <div
              style={{
                background: '#000000',
                color: '#ffffff',
                fontSize: 11,
                fontWeight: 800,
                padding: '4px 8px',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{modo === 'INSUMO' ? 'ALMOXARIFADO INSUMOS' : 'VAREJO & AÇOUGUE'}</span>
              <span>{modo === 'INSUMO' ? `UN: ${un}` : dados.codigo_etiqueta || `CÓD ${dados.codigo || '-'}`}</span>
            </div>

            <div style={{ display: 'flex', gap: 10, paddingTop: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {modo === 'INSUMO' ? (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'monospace' }}>
                      {String(dados.endereco_codigo || '').toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>
                      {String(dados.produto_descricao || '').toUpperCase()}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, marginTop: 8 }}>
                      BIPE O QR NA COLETA DE INSUMOS
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 900, lineHeight: 1.2 }}>
                      {String(dados.descricao || '').toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700 }}>PESO / QTD</div>
                        <div style={{ fontWeight: 800, fontFamily: 'monospace' }}>
                          {un === 'KG' ? `${peso.toFixed(3).replace('.', ',')} kg` : `${peso} ${un}`}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, fontWeight: 700 }}>PREÇO/{un}</div>
                        <div style={{ fontWeight: 800, fontFamily: 'monospace' }}>{fmtMoeda(preco)}</div>
                      </div>
                    </div>
                    <div style={{ border: '2px solid #000', padding: '4px 8px', marginTop: 6 }}>
                      <div style={{ fontSize: 9, fontWeight: 800 }}>VALOR TOTAL</div>
                      <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'monospace' }}>{fmtMoeda(total)}</div>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, marginTop: 4 }}>
                      VAL: {fmtDataBR(dados.validade)} {dados.lote ? `• LOTE: ${dados.lote}` : ''}
                    </div>
                  </>
                )}
              </div>
              <div style={{ textAlign: 'center', width: 112 }}>
                {qrUrl && <img src={qrUrl} alt="QR Code" style={{ width: 108, height: 108, display: 'block', margin: '0 auto' }} />}
                <div style={{ fontSize: 9, fontWeight: 800, marginTop: 2 }}>
                  {modo === 'INSUMO' ? 'QR ENDEREÇO' : 'BIPE NO CAIXA'}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 11,
            }}
          >
            <div className="text-muted">Código embutido no QR (pode testar colando no campo do PDV):</div>
            <div className="font-mono font-bold" style={{ marginTop: 2, wordBreak: 'break-all', color: '#60a5fa' }}>
              {payload}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="text-xs text-muted">Cópias:</label>
              <input
                type="number"
                min={1}
                max={50}
                className="form-input font-mono"
                style={{ width: 68, height: 34 }}
                value={copias}
                onChange={(e) => setCopias(Math.max(1, Number(e.target.value || 1)))}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={async () => {
                  const res = await imprimirOuBaixarZpl80x45(dados, modo, copias)
                  toastSuccess?.(
                    res.enviadoZebra ? 'Enviado para Zebra 80×45!' : 'Arquivo .ZPL baixado',
                    res.enviadoZebra ? 'Etiqueta ZPL enviada diretamente para a impressora.' : 'ZPL 80×45mm (203 dpi) pronto para a impressora Zebra.',
                  )
                }}
              >
                <Download size={14} /> Zebra ZPL (80×45)
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => imprimirEtiqueta80x45Html(dados, modo, copias)}
              >
                <Printer size={14} /> Imprimir Térmica (80×45)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
