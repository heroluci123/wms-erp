const STORAGE_KEY = 'wmssphere_estacao_cfg_v1'

export const ESTACAO_CFG_PADRAO = {
  modoImpressao: 'JANELA', // 'JANELA' | 'SILENCIOSA' | 'ZEBRA_USB_ZPL'
  impressoraNome: '',
  zebraTamanhoPadrao: '80x45', // '80x45' | '100x70'
  imprimirAutoAoSalvar: true,
  bobinaLarguraMm: 80, // 80 | 58 (Cupom NFC-e, Recibo Crediário p/ Assinatura, Pedidos)
  bobinaImpressoraNome: '',
  imprimirCupomAuto: false,
  imprimirCrediarioAuto: true,
  a4ImpressoraNome: '',
  balancaBaudRate: 9600,
  balancaDataBits: 8,
  balancaLeiturasEstaveis: 3,
}

export function lerConfigEstacao() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...ESTACAO_CFG_PADRAO }
    const parsed = JSON.parse(raw)
    return { ...ESTACAO_CFG_PADRAO, ...(parsed || {}) }
  } catch {
    return { ...ESTACAO_CFG_PADRAO }
  }
}

export function salvarConfigEstacao(patch) {
  const atual = lerConfigEstacao()
  const proximo = { ...atual, ...(patch || {}) }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(proximo))
  } catch {
    /* ignore */
  }
  return proximo
}
