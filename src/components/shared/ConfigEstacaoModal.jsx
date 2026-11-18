import React, { useEffect, useState } from 'react'
import { Printer, Scale, Usb, CheckCircle2, X, Info } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { lerConfigEstacao, salvarConfigEstacao } from '../../utils/estacaoConfig'
import { imprimirZebraUsbZpl } from './EtiquetaZebraPrint'
import { isWebSerialSupported } from '../../utils/balancaSerial'

export function ConfigEstacaoModal({ isOpen, onClose, onSaved }) {
  const { toastSuccess, toastError, toastWarning } = useAppStore()
  const [cfg, setCfg] = useState(lerConfigEstacao)
  const [printers, setPrinters] = useState([])
  const [hasElectronPrinter, setHasElectronPrinter] = useState(false)
  const [testandoUsb, setTestandoUsb] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setCfg(lerConfigEstacao())
    if (window?.wmsAPI?.printer?.list) {
      setHasElectronPrinter(true)
      window.wmsAPI.printer
        .list()
        .then((lista) => setPrinters(lista || []))
        .catch(() => setPrinters([]))
    } else {
      setHasElectronPrinter(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSalvar = (e) => {
    e.preventDefault()
    const salvo = salvarConfigEstacao(cfg)
    toastSuccess('Estação Configurada ✅', 'Preferências salvas para este computador.')
    onSaved?.(salvo)
    onClose?.()
  }

  const handleParearZebraUsb = async () => {
    setTestandoUsb(true)
    try {
      await imprimirZebraUsbZpl(
        [
          {
            ean_caixa: '0025999999000001',
            produto_codigo: 'TESTE',
            produto_descricao: 'TESTE ZEBRA USB 100X70MM',
            lote: 'TESTE',
            peso_bruto_kg: 1.0,
            tara_kg: 0,
            peso_kg: 1.0,
            qtd_pecas: 1,
          },
        ],
        { solicitarSeNaoPareada: true },
      )
      toastSuccess('Zebra USB Conectada ✅', 'Etiqueta de teste enviada diretamente via ZPL WebUSB!')
    } catch (err) {
      toastWarning(
        'WebUSB bloqueado pelo driver Windows?',
        `${err.message}. Dica: caso o Windows já use o driver ZDesigner, use "Impressão Silenciosa" no App Desktop (.exe) ou Chrome com --kiosk-printing!`,
      )
    } finally {
      setTestandoUsb(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: 660, width: '96%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex justify-between items-center pb-12 mb-16 border-b border-border">
          <h2 className="text-lg font-bold flex items-center gap-8">
            <Printer size={18} className="text-primary" /> Configuração Desta Estação (Impressora Zebra & Balança)
          </h2>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSalvar} className="flex flex-col gap-16">
          <div className="p-12 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-bold uppercase text-primary mb-10 flex items-center gap-6">
              <Printer size={14} /> Impressão de Etiquetas Térmicas (Zebra 100×70mm)
            </div>

            <div className="form-group mb-10">
              <label className="form-label">Modo de Impressão neste Computador</label>
              <select
                className="form-input"
                value={cfg.modoImpressao}
                onChange={(e) => setCfg((p) => ({ ...p, modoImpressao: e.target.value }))}
              >
                <option value="JANELA">Janela Padrão do Navegador (Mostra prévia)</option>
                <option value="SILENCIOSA">
                  Impressão Silenciosa Direta ({hasElectronPrinter ? 'App Desktop .exe (Zero Popup)' : 'Direto / Chrome --kiosk-printing'})
                </option>
                <option value="ZEBRA_USB_ZPL">Zebra USB Direta via ZPL (WebUSB no Chrome/Edge)</option>
              </select>
            </div>

            {hasElectronPrinter && cfg.modoImpressao === 'SILENCIOSA' && (
              <div className="form-group mb-10">
                <label className="form-label">Impressora Térmica Instalada no Windows</label>
                <select
                  className="form-input"
                  value={cfg.impressoraNome}
                  onChange={(e) => setCfg((p) => ({ ...p, impressoraNome: e.target.value }))}
                >
                  <option value="">Impressora Padrão do Windows</option>
                  {printers.map((pr) => (
                    <option key={pr.name} value={pr.name}>
                      {pr.displayName || pr.name} {pr.isDefault ? '(Padrão)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {cfg.modoImpressao === 'ZEBRA_USB_ZPL' && (
              <div className="flex items-center justify-between flex-wrap gap-8 p-10 rounded mb-10" style={{ background: 'var(--bg-2)', border: '1px dashed var(--info)' }}>
                <div className="text-xs text-muted">
                  Envio direto em código <strong>ZPL II</strong> pela USB sem abrir janelas.
                </div>
                <button
                  type="button"
                  className="btn btn--info btn--sm"
                  disabled={testandoUsb}
                  onClick={handleParearZebraUsb}
                >
                  <Usb size={14} /> {testandoUsb ? 'Enviando Teste...' : 'Parear / Testar Zebra USB'}
                </button>
              </div>
            )}

            {!hasElectronPrinter && cfg.modoImpressao === 'SILENCIOSA' && (
              <div className="p-10 rounded mb-10 text-xs flex gap-8 items-start" style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)' }}>
                <Info size={16} className="text-cyan shrink-0 mt-2" />
                <div>
                  No site pelo Chrome/Edge sem popup, ative o atalho do Chrome no computador da balança com a flag{' '}
                  <code>--kiosk-printing</code> apontando para a Zebra como impressora padrão do Windows — ou use o{' '}
                  <strong>App Desktop (.exe)</strong>, que imprime silencioso nativamente sem janela.
                </div>
              </div>
            )}

            <label className="flex items-center gap-8 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(cfg.imprimirAutoAoSalvar)}
                onChange={(e) => setCfg((p) => ({ ...p, imprimirAutoAoSalvar: e.target.checked }))}
              />
              Imprimir etiqueta automaticamente assim que salvar uma caixa pesada
            </label>
          </div>

          <div className="p-12 rounded" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-bold uppercase text-cyan mb-10 flex items-center gap-6">
              <Scale size={14} /> Balança Serial / USB-Serial (Pesagem Automática)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Velocidade (Baud Rate)</label>
                <select
                  className="form-input"
                  value={cfg.balancaBaudRate}
                  onChange={(e) => setCfg((p) => ({ ...p, balancaBaudRate: Number(e.target.value) }))}
                >
                  <option value={9600}>9600 bps (Padrão Toledo / Filizola)</option>
                  <option value={4800}>4800 bps</option>
                  <option value={2400}>2400 bps</option>
                  <option value={115200}>115200 bps</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Estabilidade (leituras iguais)</label>
                <input
                  type="number"
                  min={2}
                  max={8}
                  className="form-input"
                  value={cfg.balancaLeiturasEstaveis}
                  onChange={(e) => setCfg((p) => ({ ...p, balancaLeiturasEstaveis: Number(e.target.value || 3) }))}
                />
              </div>
            </div>
            <div className="text-xs text-muted mt-8">
              Suporte Web Serial neste navegador:{' '}
              {isWebSerialSupported() ? (
                <strong className="text-success">Ativo (Chrome/Edge pronto para conectar balança!)</strong>
              ) : (
                <strong className="text-warning">Indisponível neste navegador (use Chrome, Edge ou App Desktop)</strong>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-8">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary">
              <CheckCircle2 size={16} /> Salvar Configuração da Estação
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
