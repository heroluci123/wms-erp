import React, { useEffect, useRef, useState } from 'react'
import { CheckCircle2, KeyRound, Lock, Save, ShieldCheck, Upload } from 'lucide-react'
import { fiscalQueries } from '../../queries/fiscal'

export function AbaConfigCertificado({ config, onAtualizar, toastSuccess, toastError }) {
  const [form, setForm] = useState({
    ambiente: 'HOMOLOGACAO',
    provedor: 'SIMULACAO_LOCAL',
    serie_nfe: 1,
    proximo_numero_nfe: 1,
    serie_nfce: 1,
    proximo_numero_nfce: 1,
    csc_id: '',
    csc_token: '',
    gateway_api_token: '',
    inf_complementar_padrao: '',
  })
  const [salvandoCfg, setSalvandoCfg] = useState(false)

  const [certForm, setCertForm] = useState({
    arquivo_nome: '',
    pfx_base64: '',
    senha: '',
    titular: '',
    cnpj: '',
    validade: '',
  })
  const [enviandoCert, setEnviandoCert] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!config) return
    setForm({
      ambiente: config.ambiente || 'HOMOLOGACAO',
      provedor: config.provedor || 'SIMULACAO_LOCAL',
      serie_nfe: config.serie_nfe || 1,
      proximo_numero_nfe: config.proximo_numero_nfe || 1,
      serie_nfce: config.serie_nfce || 1,
      proximo_numero_nfce: config.proximo_numero_nfce || 1,
      csc_id: config.csc_id || '',
      csc_token: config.csc_token || '',
      gateway_api_token: '',
      inf_complementar_padrao: config.inf_complementar_padrao || '',
    })
  }, [config])

  const handleSalvarConfig = async (e) => {
    e.preventDefault()
    setSalvandoCfg(true)
    try {
      await fiscalQueries.salvarConfig(form)
      toastSuccess('Configuração Fiscal salva ✅', 'Parâmetros de NF-e 55 e NFC-e 65 atualizados para esta filial.')
      await onAtualizar?.()
    } catch (err) {
      toastError('Erro ao salvar configuração', err.message)
    } finally {
      setSalvandoCfg(false)
    }
  }

  const handleEscolherPfx = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCertForm((prev) => ({
        ...prev,
        arquivo_nome: file.name,
        pfx_base64: String(reader.result || ''),
      }))
    }
    reader.readAsDataURL(file)
  }

  const handleEnviarCert = async (e) => {
    e.preventDefault()
    if (!certForm.pfx_base64) {
      toastError('Arquivo .PFX obrigatório', 'Selecione o arquivo do Certificado Digital A1 (.pfx ou .p12).')
      return
    }
    setEnviandoCert(true)
    try {
      await fiscalQueries.enviarCertificadoA1(certForm)
      toastSuccess('Certificado Digital A1 instalado ✅', 'Arquivo e senha armazenados com criptografia AES-256-GCM.')
      setCertForm({ arquivo_nome: '', pfx_base64: '', senha: '', titular: '', cnpj: '', validade: '' })
      if (fileRef.current) fileRef.current.value = ''
      await onAtualizar?.()
    } catch (err) {
      toastError('Erro ao instalar Certificado A1', err.message)
    } finally {
      setEnviandoCert(false)
    }
  }

  return (
    <div className="grid gap-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
      {/* CONFIGURAÇÃO DE SÉRIES, AMBIENTE & GATEWAY */}
      <form className="card p-20 flex flex-col gap-14" onSubmit={handleSalvarConfig}>
        <div className="flex items-center justify-between border-b border-border pb-10">
          <h3 className="text-sm font-bold m-0 flex items-center gap-8">
            <ShieldCheck size={16} className="text-primary" /> Parâmetros Fiscais da Filial (NF-e 55 &amp; NFC-e 65)
          </h3>
          {config?.emitente && (
            <span className="badge badge--info text-xs">
              {config.emitente.regime} • UF {config.emitente.uf}
            </span>
          )}
        </div>

        <div className="form-grid form-grid--2">
          <div>
            <label className="form-label">Ambiente SEFAZ *</label>
            <select
              className="form-input"
              value={form.ambiente}
              onChange={(e) => setForm({ ...form, ambiente: e.target.value })}
            >
              <option value="HOMOLOGACAO">Homologação (Testes sem valor fiscal)</option>
              <option value="PRODUCAO">Produção (Validade fiscal real)</option>
            </select>
          </div>
          <div>
            <label className="form-label">Motor / Provedor de Transmissão *</label>
            <select
              className="form-input"
              value={form.provedor}
              onChange={(e) => setForm({ ...form, provedor: e.target.value })}
            >
              <option value="SIMULACAO_LOCAL">Simulação Local (Testar fluxo + XML 4.00 + DANFE)</option>
              <option value="SEFAZ_DIRETO_A1">SEFAZ Direto via Certificado A1 (.pfx)</option>
              <option value="FOCUS_NFE">Gateway Focus NFe</option>
              <option value="NUVEM_FISCAL">Gateway Nuvem Fiscal</option>
              <option value="TECNOSPEED">Gateway TecnoSpeed</option>
            </select>
          </div>
        </div>

        <div className="form-grid form-grid--2">
          <div>
            <label className="form-label">Série NF-e (Modelo 55)</label>
            <input
              type="number"
              min="1"
              className="form-input font-mono"
              value={form.serie_nfe}
              onChange={(e) => setForm({ ...form, serie_nfe: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="form-label">Próximo Número NF-e (55)</label>
            <input
              type="number"
              min="1"
              className="form-input font-mono"
              value={form.proximo_numero_nfe}
              onChange={(e) => setForm({ ...form, proximo_numero_nfe: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="form-grid form-grid--2">
          <div>
            <label className="form-label">Série NFC-e (Cupom PDV Modelo 65)</label>
            <input
              type="number"
              min="1"
              className="form-input font-mono"
              value={form.serie_nfce}
              onChange={(e) => setForm({ ...form, serie_nfce: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="form-label">Próximo Número NFC-e (65)</label>
            <input
              type="number"
              min="1"
              className="form-input font-mono"
              value={form.proximo_numero_nfce}
              onChange={(e) => setForm({ ...form, proximo_numero_nfce: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="form-grid form-grid--2">
          <div>
            <label className="form-label">CSC ID (Token NFC-e SEFAZ)</label>
            <input
              type="text"
              className="form-input font-mono"
              placeholder="Ex: 000001"
              value={form.csc_id}
              onChange={(e) => setForm({ ...form, csc_id: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Código CSC (Token NFC-e)</label>
            <input
              type="text"
              className="form-input font-mono"
              placeholder="Código alfanumérico da SEFAZ"
              value={form.csc_token}
              onChange={(e) => setForm({ ...form, csc_token: e.target.value })}
            />
          </div>
        </div>

        {['FOCUS_NFE', 'NUVEM_FISCAL', 'TECNOSPEED'].includes(form.provedor) && (
          <div>
            <label className="form-label">
              Token da API do Gateway ({form.provedor}){' '}
              {config?.gateway_token_configurado && (
                <span className="badge badge--success ml-6">Já configurado</span>
              )}
            </label>
            <input
              type="password"
              className="form-input font-mono"
              placeholder="Cole o token de produção/homologação (deixe vazio para manter o atual)"
              value={form.gateway_api_token}
              onChange={(e) => setForm({ ...form, gateway_api_token: e.target.value })}
            />
          </div>
        )}

        <div>
          <label className="form-label">Informações Complementares Padrão (Rodapé da NF-e)</label>
          <textarea
            className="form-input"
            rows={3}
            value={form.inf_complementar_padrao}
            onChange={(e) => setForm({ ...form, inf_complementar_padrao: e.target.value })}
            placeholder="Ex: ICMS redução base de cálculo cesta básica carnes..."
          />
        </div>

        <div className="flex justify-end pt-8 border-t border-border">
          <button type="submit" className="btn btn--primary" disabled={salvandoCfg}>
            <Save size={15} /> {salvandoCfg ? 'Salvando...' : 'Salvar Configuração Fiscal'}
          </button>
        </div>
      </form>

      {/* COFRE DO CERTIFICADO DIGITAL A1 (.PFX) */}
      <form className="card p-20 flex flex-col gap-14" onSubmit={handleEnviarCert}>
        <div className="flex items-center justify-between border-b border-border pb-10">
          <h3 className="text-sm font-bold m-0 flex items-center gap-8">
            <KeyRound size={16} className="text-warning" /> Certificado Digital A1 (`.pfx` / `.p12`)
          </h3>
          {config?.certificado_configurado ? (
            <span className="badge badge--success">
              <CheckCircle2 size={12} /> Instalado
            </span>
          ) : (
            <span className="badge badge--warning">Não instalado</span>
          )}
        </div>

        {config?.certificado_configurado && (
          <div className="p-12 rounded text-xs" style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.3)' }}>
            <div className="font-bold text-success mb-4">Certificado A1 Ativo no Cofre Criptografado</div>
            <div>Arquivo: <strong className="font-mono">{config.certificado_nome}</strong></div>
            {config.certificado_titular && <div>Titular: <strong>{config.certificado_titular}</strong></div>}
            {config.certificado_cnpj && <div>CNPJ: <strong className="font-mono">{config.certificado_cnpj}</strong></div>}
            {config.certificado_validade && <div>Validade: <strong className="font-mono">{config.certificado_validade}</strong></div>}
          </div>
        )}

        <div>
          <label className="form-label">Arquivo do Certificado A1 (.pfx ou .p12) *</label>
          <input ref={fileRef} type="file" accept=".pfx,.p12" style={{ display: 'none' }} onChange={handleEscolherPfx} />
          <div className="flex items-center gap-10">
            <button type="button" className="btn btn--secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Selecionar .PFX
            </button>
            <span className="text-xs font-mono text-muted">
              {certForm.arquivo_nome || 'Nenhum arquivo selecionado'}
            </span>
          </div>
        </div>

        <div className="form-grid form-grid--2">
          <div>
            <label className="form-label">Senha do Certificado A1 *</label>
            <input
              type="password"
              required
              className="form-input"
              placeholder="Digite a senha do .pfx"
              value={certForm.senha}
              onChange={(e) => setCertForm({ ...certForm, senha: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Data de Validade (Opcional)</label>
            <input
              type="date"
              className="form-input"
              value={certForm.validade}
              onChange={(e) => setCertForm({ ...certForm, validade: e.target.value })}
            />
          </div>
        </div>

        <div className="form-grid form-grid--2">
          <div>
            <label className="form-label">Razão Social / Titular (Opcional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="Ex: TRICARNES ALIMENTOS LTDA"
              value={certForm.titular}
              onChange={(e) => setCertForm({ ...certForm, titular: e.target.value.toUpperCase() })}
            />
          </div>
          <div>
            <label className="form-label">CNPJ do Certificado (Opcional)</label>
            <input
              type="text"
              className="form-input font-mono"
              placeholder="00.000.000/0001-00"
              value={certForm.cnpj}
              onChange={(e) => setCertForm({ ...certForm, cnpj: e.target.value })}
            />
          </div>
        </div>

        <div className="text-xs text-muted flex items-center gap-6">
          <Lock size={13} className="text-cyan" />
          <span>A senha do certificado é criptografada com AES-256-GCM no servidor e nunca retorna ao navegador.</span>
        </div>

        <div className="flex justify-end pt-8 border-t border-border mt-auto">
          <button type="submit" className="btn btn--success" disabled={enviandoCert || !certForm.pfx_base64}>
            <KeyRound size={15} /> {enviandoCert ? 'Instalando...' : 'Instalar Certificado A1'}
          </button>
        </div>
      </form>
    </div>
  )
}
