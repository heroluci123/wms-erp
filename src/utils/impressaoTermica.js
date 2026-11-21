import { lerConfigEstacao } from './estacaoConfig'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtData(d) {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split('-')
    return `${day}/${m}/${y}`
  }
  const dt = new Date(d)
  if (!Number.isNaN(dt.getTime())) return dt.toLocaleString('pt-BR')
  return s
}

function abrirJanelaImpressao(html, largura = 420, altura = 640) {
  const win = window.open('', '_blank', `width=${largura},height=${altura}`)
  if (!win) return false
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
  return true
}

/**
 * Imprime Comprovante de Crediário em Bobina Térmica (80mm ou 58mm) com linha de assinatura do cliente!
 */
export function imprimirReciboCrediarioTermico(recibo) {
  if (!recibo) return false
  const cfg = lerConfigEstacao()
  const larguraMm = Number(cfg?.bobinaLarguraMm || 80) === 58 ? 58 : 80
  const itens = Array.isArray(recibo.itens) ? recibo.itens : []

  const linhasItens = itens
    .map(
      (it) => `
      <tr>
        <td colspan="3" class="item-desc">${esc(it.descricao)}</td>
      </tr>
      <tr class="item-nums">
        <td>${Number(it.qtd || 0).toFixed(it.unidade === 'KG' ? 3 : 0)} ${esc(it.unidade || 'UN')}</td>
        <td class="r">${esc(fmtMoeda(it.preco_unitario))}</td>
        <td class="r b">${esc(fmtMoeda(it.valor_total))}</td>
      </tr>`,
    )
    .join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Comprovante Crediário ${esc(recibo.venda_codigo || '')}</title>
<style>
  @page { size: ${larguraMm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body {
    width: ${larguraMm - 4}mm;
    margin: 0 auto;
    padding: 2mm 1mm;
    font-family: 'Courier New', Courier, monospace;
    font-size: ${larguraMm === 58 ? '9pt' : '10pt'};
    color: #000;
    background: #fff;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 800; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .hr-solid { border-top: 1.5px solid #000; margin: 6px 0; }
  .title { font-size: ${larguraMm === 58 ? '11pt' : '12pt'}; font-weight: 900; letter-spacing: 0.4px; }
  .box { border: 1.5px solid #000; padding: 5px; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  .item-desc { font-weight: 700; padding-top: 3px; font-size: ${larguraMm === 58 ? '8.5pt' : '9.5pt'}; }
  .item-nums td { padding-bottom: 3px; font-size: ${larguraMm === 58 ? '8pt' : '9pt'}; border-bottom: 1px dotted #aaa; }
  .kv { display: flex; justify-content: space-between; margin: 2px 0; }
  .big-val { font-size: ${larguraMm === 58 ? '12pt' : '14pt'}; font-weight: 900; }
  .sig-box { margin-top: 26px; text-align: center; }
  .sig-line { border-top: 1px solid #000; margin: 0 4px 4px; }
  .small { font-size: ${larguraMm === 58 ? '7.5pt' : '8.5pt'}; line-height: 1.25; }
</style>
</head>
<body>
  <div class="c">
    <div class="title">${esc(recibo.empresa_nome || 'VAREJO & AÇOUGUE')}</div>
    ${recibo.empresa_cnpj ? `<div class="small">CNPJ: ${esc(recibo.empresa_cnpj)}</div>` : ''}
    ${recibo.empresa_cidade ? `<div class="small">${esc(recibo.empresa_cidade)}</div>` : ''}
  </div>
  <div class="hr-solid"></div>
  <div class="c b">COMPROVANTE DE CREDIÁRIO</div>
  <div class="c small">DOCUMENTO NÃO FISCAL — ASSINATURA OBRIGATÓRIA</div>
  <div class="hr"></div>

  <div class="small">
    <div class="kv"><span>VENDA:</span><span class="b">${esc(recibo.venda_codigo || '-')}</span></div>
    ${recibo.titulo_codigo ? `<div class="kv"><span>TÍTULO:</span><span class="b">${esc(recibo.titulo_codigo)}</span></div>` : ''}
    <div class="kv"><span>DATA/HORA:</span><span>${esc(new Date(recibo.data_emissao || Date.now()).toLocaleString('pt-BR'))}</span></div>
    <div class="kv"><span>OPERADOR:</span><span>${esc(recibo.operador_nome || '-')}</span></div>
  </div>

  <div class="hr"></div>
  <div class="small">
    <div class="b">DADOS DO CLIENTE</div>
    <div>NOME: <span class="b">${esc(recibo.cliente_nome || '-')}</span></div>
    <div>CPF/CNPJ: <span class="b">${esc(recibo.cliente_cpf_cnpj || '-')}</span>${recibo.cliente_rg ? ` • RG: ${esc(recibo.cliente_rg)}` : ''}</div>
    ${recibo.cliente_endereco ? `<div>END: ${esc(recibo.cliente_endereco)}</div>` : ''}
    ${recibo.cliente_telefone ? `<div>TEL: ${esc(recibo.cliente_telefone)}</div>` : ''}
  </div>

  <div class="hr"></div>
  <table>
    <thead>
      <tr class="small">
        <th align="left">QTD</th>
        <th align="right">UNIT</th>
        <th align="right">TOTAL</th>
      </tr>
    </thead>
    <tbody>${linhasItens}</tbody>
  </table>

  <div class="hr"></div>
  <div class="small">
    <div class="kv"><span>SUBTOTAL:</span><span>${esc(fmtMoeda(recibo.subtotal))}</span></div>
    ${Number(recibo.desconto_valor || 0) > 0 ? `<div class="kv"><span>DESCONTO:</span><span>- ${esc(fmtMoeda(recibo.desconto_valor))}</span></div>` : ''}
    <div class="kv b"><span>TOTAL DA COMPRA:</span><span>${esc(fmtMoeda(recibo.valor_total_venda))}</span></div>
  </div>

  <div class="box">
    <div class="kv">
      <span class="b">VALOR NO CREDIÁRIO:</span>
      <span class="big-val">${esc(fmtMoeda(recibo.valor_crediario))}</span>
    </div>
    <div class="kv small">
      <span>VENCIMENTO:</span>
      <span class="b">${esc(fmtData(recibo.vencimento))}</span>
    </div>
  </div>

  <div class="small">
    <div class="kv"><span>LIMITE TOTAL:</span><span>${esc(fmtMoeda(recibo.limite_credito))}</span></div>
    <div class="kv"><span>LIMITE UTILIZADO:</span><span class="b">${esc(fmtMoeda(recibo.credito_utilizado_pos))}</span></div>
    <div class="kv"><span>LIMITE DISPONÍVEL:</span><span class="b">${esc(fmtMoeda(recibo.credito_disponivel_pos))}</span></div>
  </div>

  <div class="hr"></div>
  <div class="small" style="text-align: justify;">
    Reconheço e confesso a dívida no valor acima discriminado referente às mercadorias retiradas nesta data, comprometendo-me a liquidá-la até o vencimento informado.
  </div>

  <div class="sig-box">
    <div class="sig-line"></div>
    <div class="b small">${esc(recibo.cliente_nome || 'ASSINATURA DO CLIENTE')}</div>
    <div class="small">CPF/CNPJ: ${esc(recibo.cliente_cpf_cnpj || '___________________________')}</div>
  </div>

  <div class="hr" style="margin-top: 14px;"></div>
  <div class="c small">VIA DO ESTABELECIMENTO • ARQUIVAR ASSINADA</div>
</body>
</html>`

  return abrirJanelaImpressao(html, 420, 700)
}

/**
 * Imprime Cupom Térmico de Venda PDV / NFC-e (80mm ou 58mm).
 */
export function imprimirCupomVendaTermico(venda, empresaNome = 'VAREJO & AÇOUGUE') {
  if (!venda) return false
  const cfg = lerConfigEstacao()
  const larguraMm = Number(cfg?.bobinaLarguraMm || 80) === 58 ? 58 : 80
  const itens = Array.isArray(venda.itens || venda.itens_json) ? venda.itens || venda.itens_json : []
  const pags = Array.isArray(venda.pagamentos || venda.pagamentos_json)
    ? venda.pagamentos || venda.pagamentos_json
    : []

  const linhasItens = itens
    .map(
      (it) => `
      <tr>
        <td colspan="3" class="item-desc">${esc(it.descricao)}</td>
      </tr>
      <tr class="item-nums">
        <td>${Number(it.qtd || 0).toFixed(it.unidade === 'KG' ? 3 : 0)} ${esc(it.unidade || 'UN')}</td>
        <td class="r">${esc(fmtMoeda(it.preco_unitario))}</td>
        <td class="r b">${esc(fmtMoeda(it.valor_total))}</td>
      </tr>`,
    )
    .join('')

  const linhasPags = pags
    .map((p) => `<div class="kv"><span>${esc(p.forma)}</span><span class="b">${esc(fmtMoeda(p.valor))}</span></div>`)
    .join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cupom ${esc(venda.codigo || '')}</title>
<style>
  @page { size: ${larguraMm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body {
    width: ${larguraMm - 4}mm;
    margin: 0 auto;
    padding: 2mm 1mm;
    font-family: 'Courier New', Courier, monospace;
    font-size: ${larguraMm === 58 ? '9pt' : '10pt'};
    color: #000;
    background: #fff;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 800; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  .small { font-size: ${larguraMm === 58 ? '7.5pt' : '8.5pt'}; line-height: 1.25; }
  table { width: 100%; border-collapse: collapse; }
  .item-desc { font-weight: 700; padding-top: 3px; }
  .item-nums td { padding-bottom: 3px; border-bottom: 1px dotted #aaa; }
  .kv { display: flex; justify-content: space-between; margin: 2px 0; }
</style>
</head>
<body>
  <div class="c b" style="font-size: 12pt;">${esc(empresaNome)}</div>
  <div class="c small">${venda.numero_nfce ? `DANFE NFC-e Nº ${esc(venda.numero_nfce)}` : 'COMPROVANTE DE VENDA PDV'}</div>
  <div class="hr"></div>
  <div class="small">
    <div class="kv"><span>VENDA:</span><span class="b">${esc(venda.codigo)}</span></div>
    <div class="kv"><span>DATA:</span><span>${esc(new Date(venda.created_at || Date.now()).toLocaleString('pt-BR'))}</span></div>
    <div class="kv"><span>CLIENTE:</span><span>${esc(venda.cliente_nome || 'CONSUMIDOR FINAL')}</span></div>
    ${venda.cliente_doc ? `<div class="kv"><span>CPF/CNPJ:</span><span>${esc(venda.cliente_doc)}</span></div>` : ''}
  </div>
  <div class="hr"></div>
  <table>
    <thead>
      <tr class="small"><th align="left">QTD</th><th align="right">UNIT</th><th align="right">TOTAL</th></tr>
    </thead>
    <tbody>${linhasItens}</tbody>
  </table>
  <div class="hr"></div>
  <div class="small">
    <div class="kv"><span>SUBTOTAL</span><span>${esc(fmtMoeda(venda.subtotal))}</span></div>
    ${Number(venda.desconto_valor || 0) > 0 ? `<div class="kv"><span>DESCONTO${Number(venda.desconto_pct || 0) > 0 ? ` (${Number(venda.desconto_pct).toFixed(1)}%)` : ''}</span><span>- ${esc(fmtMoeda(venda.desconto_valor))}</span></div>` : ''}
    <div class="kv b" style="font-size: 12pt; margin-top: 4px;"><span>TOTAL A PAGAR</span><span>${esc(fmtMoeda(venda.valor_total))}</span></div>
  </div>
  <div class="hr"></div>
  <div class="small">
    <div class="b" style="margin-bottom: 3px;">FORMAS DE PAGAMENTO</div>
    ${linhasPags}
    ${Number(venda.troco_valor || 0) > 0 ? `<div class="kv b"><span>TROCO</span><span>${esc(fmtMoeda(venda.troco_valor))}</span></div>` : ''}
  </div>
  ${venda.chave_nfce ? `<div class="hr"></div><div class="c small">CHAVE DE ACESSO NFC-e:<br/><span class="b" style="word-break:break-all;">${esc(venda.chave_nfce)}</span></div>` : ''}
  <div class="hr"></div>
  <div class="c small">OBRIGADO PELA PREFERÊNCIA!</div>
</body>
</html>`

  return abrirJanelaImpressao(html, 420, 640)
}

/**
 * Imprime Relação de Itens Ativos ou Ficha de Contagem às Cegas (A4) para o Inventário do Empório!
 */
export function imprimirFichaInventarioEmporio(inventario, { modoCego = true } = {}) {
  if (!inventario) return false
  const itens = Array.isArray(inventario.itens_json) ? inventario.itens_json : []
  const linhas = itens
    .map(
      (it, idx) => `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="mono">${esc(it.produto_codigo || '-')}</td>
        <td class="mono">${esc(it.produto_ean || it.codigo_balanca || '-')}</td>
        <td class="b">${esc(it.produto_descricao)}</td>
        <td class="c">${esc(it.unidade_venda || 'UN')}</td>
        ${modoCego ? '' : `<td class="r mono">${Number(it.saldo_sistema || 0).toFixed(it.unidade_venda === 'KG' ? 3 : 0)}</td>`}
        <td class="blank-cell"></td>
        <td class="blank-cell"></td>
      </tr>`,
    )
    .join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${modoCego ? 'Ficha Contagem às Cegas' : 'Relação de Itens Ativos'} — ${esc(inventario.codigo)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; }
  h1 { font-size: 14pt; margin: 0 0 4px; }
  .meta { font-size: 9pt; color: #333; margin-bottom: 12px; display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 5px 6px; }
  th { background: #eee; font-size: 8.5pt; text-transform: uppercase; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .mono { font-family: 'Courier New', monospace; }
  .blank-cell { min-width: 72px; }
  .footer { margin-top: 28px; display: flex; justify-content: space-between; gap: 24px; }
  .sig { flex: 1; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 8.5pt; }
</style>
</head>
<body>
  <h1>${modoCego ? 'FICHA DE CONTAGEM ÀS CEGAS — EMPÓRIO' : 'RELAÇÃO DE ITENS ATIVOS — EMPÓRIO'}</h1>
  <div class="meta">
    <div><strong>Inventário:</strong> ${esc(inventario.codigo)} — ${esc(inventario.titulo || '')}</div>
    <div><strong>Itens:</strong> ${itens.length} • <strong>Emissão:</strong> ${esc(new Date().toLocaleString('pt-BR'))}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width: 30px;">#</th>
        <th style="width: 75px;">Código</th>
        <th style="width: 115px;">EAN / Balança</th>
        <th>Descrição do Produto</th>
        <th style="width: 42px;">Un</th>
        ${modoCego ? '' : '<th style="width: 76px;">Saldo Sist.</th>'}
        <th style="width: 90px;">1ª Contagem</th>
        <th style="width: 90px;">Conferência</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="footer">
    <div class="sig">Responsável pela Contagem (Nome / Assinatura)</div>
    <div class="sig">Analista / Conferente (Nome / Assinatura)</div>
  </div>
</body>
</html>`

  return abrirJanelaImpressao(html, 900, 740)
}
