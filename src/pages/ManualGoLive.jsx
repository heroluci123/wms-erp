import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Cloud,
  Smartphone,
  Printer,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Database,
  PlayCircle,
  Wrench,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react'
import { apiRequest, getApiBaseUrl, isApiEnabled } from '../lib/apiClient'
import { getLegacyTursoCredentials } from '../lib/db'
import { useAppStore } from '../store/appStore'
import { isMaster } from '../utils/permissoes'
import { PrintDocumentModal } from '../components/shared/PrintDocumentModal'

const STORAGE_KEY_ROTEIROS = 'wmsphere_golive_checklist_v1'

const ROTEIROS_OPERACIONAIS = [
  {
    id: 'dia0',
    titulo: '0. Implantação Inicial (Ordem Exata dos Cadastros — Dia 0)',
    badge: 'Setup Obrigatório',
    cor: '#a78bfa',
    resumo: 'Execute nesta ordem na primeira vez que subir o banco de produção.',
    passos: [
      { texto: 'Trocar a senha padrão do usuário MASTER inicial e cadastrar os usuários reais com perfis separados (expedição, produção, faturamento, PDV, motorista).', rota: '/operadores' },
      { texto: 'Conferir Empresas & Filiais (CNPJ, Inscrição Estadual, registro SIF/DIPOA, tipo Indústria/CD ou Loja/Varejo).', rota: '/filiais' },
      { texto: 'Configurar Parâmetros Comerciais & Fiscais: formas de pagamento, contas bancárias, centros de custo, naturezas/CFOP e trava de margem mínima.', rota: '/parametros-comerciais' },
      { texto: 'Cadastrar Taras padrão de caixas/bandejas e Locais/Câmaras Frias (REC, CAM-01, EXPEDICAO, ACOUGUE, EMPORIO).', rota: '/locais' },
      { texto: 'Cadastrar Especificações de Rótulo Industrial (100×70mm) e Catálogo de Produtos (Carnes/MP/Subproduto + BOM, Empório com fardo→UN e Insumos). A Curva ABC é 100% automática — não precisa preencher.', rota: '/produtos' },
      { texto: 'Criar Tabelas de Preço (Atacado / Varejo), cadastrar Fornecedores (com SIF), Clientes, Vendedores, Veículos e Rotas.', rota: '/tabelas-preco' },
      { texto: 'Executar a Carga Inicial de Estoque (Inventário tipo CargaInicial ou Recebimento de Saldo) para iniciar com acuracidade 100%.', rota: '/inventario' },
    ],
  },
  {
    id: 'compras',
    titulo: '1. Fluxo Compras → Cotação (RFQ) → Recebimento XML/Doca → Câmara Fria',
    badge: 'Entrada & Custo',
    cor: '#38bdf8',
    resumo: 'Controla o custo real de entrada, temperatura da carga e ranking SIF dos fornecedores.',
    passos: [
      { texto: 'Em Governança & Perdas → Cotações (RFQ), abra uma cotação de compra, registre propostas dos fornecedores e aprove o vencedor para gerar o Pedido de Compra automaticamente.', rota: '/governanca-perdas' },
      { texto: 'Em Compras / Pedidos de Compra, acompanhe os pedidos abertos ou importe o XML da NF-e de entrada.', rota: '/compras' },
      { texto: 'Em Recebimento, selecione o pedido/NF, informe a temperatura de recebimento (°C), bipe/pese as caixas (tara automática) e gere etiquetas 100×70 quando necessário.', rota: '/recebimento' },
      { texto: 'Em Movimentação / Armazenagem, transfira os paletes/caixas da doca REC para o endereço definitivo na câmara fria.', rota: '/movimentacao' },
      { texto: 'Confira em Consulta de Estoque e Score SIF de Fornecedores o saldo valorizado e o histórico de custo.', rota: '/consulta-estoque' },
    ],
  },
  {
    id: 'producao',
    titulo: '2. Fluxo Indústria: Mapa de Produção → OP de Desossa → Retorno & Etiquetas',
    badge: 'Indústria / BOM',
    cor: '#f59e0b',
    resumo: 'Controla rendimento real, quebra de desossa, rateio de custo nos cortes e validade DIPOA.',
    passos: [
      { texto: 'Em Mapa de Produção, planeje o dia a partir dos pedidos ou programação semanal e libere a Ordem de Produção (OP).', rota: '/mapa-producao' },
      { texto: 'Em Produção (OPs), bipe as caixas de Matéria-Prima enviadas para a sala de desossa (essas saídas alimentam automaticamente a Curva ABC da MP).', rota: '/producao' },
      { texto: 'No Retorno de Produção, pese os subprodutos/cortes produzidos, aplique a tara e imprima a etiqueta industrial 100×70mm com lote, SIF e validade.', rota: '/producao' },
      { texto: 'Finalize a OP para o sistema calcular automaticamente o Rendimento %, Quebra % e o Custo Alocado por kg de cada corte (com Alarme de Furo de Rendimento em Governança).', rota: '/governanca-perdas' },
    ],
  },
  {
    id: 'atacado_logistica',
    titulo: '3. Fluxo Comercial & Logística: Pedido → Faturamento → Separação FEFO → Romaneio → Entrega',
    badge: 'Teste Ponta a Ponta',
    cor: '#22c55e',
    resumo: 'Passo a passo completo desde o pedido comercial até a assinatura do cliente no App do Motorista.',
    passos: [
      { texto: 'Crie um Pedido em Pedidos Atacado (ou pelo PWA Força de Vendas no celular), escolhendo cliente, tabela de preço, forma de pagamento e itens. Se a margem ficar abaixo da alçada, aprove na Central de Pendências.', rota: '/pedidos' },
      { texto: 'Libere o pedido para Separação e gere o Faturamento / Nota Fiscal e títulos no Financeiro (Contas a Receber).', rota: '/fiscal' },
      { texto: 'Em Saída / Separação, abra o pedido e bipe as caixas na câmara fria. A Trava Hard-Stop FEFO bloqueia caixas vencidas e registra alerta se houver furo de fila FEFO (exigindo PIN gerencial).', rota: '/saida' },
      { texto: 'Conclua a Conferência de Expedição do romaneio (dupla checagem de peso e caixas).', rota: '/saida' },
      { texto: 'Em Roteirização & Embarques, monte a carga vinculando veículo, motorista e pedidos/romaneios, registre temperatura do baú e conclua o Carregamento.', rota: '/roteirizacao' },
      { texto: 'Imprima o Pedido ou Romaneio em A4 paisagem (página única) e gere o QR Code / acesso do motorista.', rota: '/roteirizacao' },
      { texto: 'No celular (App Motorista em /#/motorista), o motorista inicia a rota, registra chegada, foto do canhoto, assinatura digital, temperatura de entrega e pagamento na entrega.', rota: '/motorista' },
      { texto: 'Compartilhe o Link de Rastreio Público com o cliente e acompanhe o recebimento no Financeiro e o indicador OTIF na Central BI.', rota: '/financeiro' },
    ],
  },
  {
    id: 'varejo_pdv',
    titulo: '4. Fluxo Loja / Varejo: Transferência CD → Açougue/Balança QR → Empório → PDV',
    badge: 'Varejo & Loja',
    cor: '#fb923c',
    resumo: 'Operação completa de balcão de carnes, empório/bebidas e frente de caixa integrada ao financeiro.',
    passos: [
      { texto: 'Em Transferência Interunidades, envie caixas de carne ou fardos de empório do CD para a Filial Loja.', rota: '/interunidades' },
      { texto: 'Na Filial Loja, em Operação do Açougue, receba e abra a MP no balcão, pese os cortes e emita etiquetas QR de venda com validade e tara travadas.', rota: '/acougue' },
      { texto: 'Em Estoque Empório, dê entrada em bebidas/mercearia (com conversão automática de fardo → unidade) e confira o preço de venda.', rota: '/emporio' },
      { texto: 'Em PDV Frente de Caixa, abra o turno de caixa, bipe etiquetas QR do açougue ou EAN-13 do empório, finalize a venda (PIX, Dinheiro, Débito, Crédito ou Crediário) e feche o turno conferindo quebra de caixa.', rota: '/pdv' },
    ],
  },
  {
    id: 'governanca_bi',
    titulo: '5. Rotina Gerencial: Governança, Prevenção de Perdas, Inventário ABC & Central BI',
    badge: 'Auditoria & Lucro',
    cor: '#f43f5e',
    resumo: 'Blindagem diária contra desvios, vencimentos e margem corroída.',
    passos: [
      { texto: 'Diariamente (2× a 3×/dia): registrar Ronda de Temperatura das Câmaras e Balcões (SIF) em Governança & Perdas.', rota: '/governanca-perdas' },
      { texto: 'Diariamente: verificar Monitor FEFO & Promoção (itens vencendo em 3–7 dias) e Radar Antifraude (etiquetas fantasma, subfaturamento, furos FEFO e furos de rendimento).', rota: '/governanca-perdas' },
      { texto: 'Semanalmente: abrir Inventário Cíclico por Curva A (classificada automaticamente pelo sistema conforme saídas p/ produção e vendas) e conciliar divergências.', rota: '/inventario' },
      { texto: 'Semanalmente/Mensalmente: analisar DRE Gerencial e os 19 relatórios da Central de Relatórios & BI (Curva ABC Automática, Valuation, Kardex, Dead Stock, Margem, Inflação de Compras, OTIF).', rota: '/relatorios' },
    ],
  },
]

const CHECKLIST_HARDWARE = [
  {
    item: 'Etiquetas de Caixa / Açougue (100×70mm)',
    config: 'Impressora térmica Zebra / Elgin / Argox / Bematech • Papel 100×70mm • Margens: Nenhuma (0mm) • Escala: 100% • Cabeçalhos/rodapés do navegador desmarcados.',
  },
  {
    item: 'Cupom Não Fiscal PDV (80mm)',
    config: 'Impressora térmica 80mm (Epson TM-T20X / Elgin i8 / Bematech MP-4200) • Papel 80mm contínuo • Margens: Nenhuma.',
  },
  {
    item: 'Pedidos, Romaneios & Relatórios BI (A4)',
    config: 'Qualquer impressora laser/jato A4 ou "Salvar como PDF" • Orientação Paisagem (automática via CSS @page) • Gráficos de fundo ativados para destacar cores.',
  },
  {
    item: 'Leitor de Código de Barras / QR Code',
    config: 'Leitor 2D USB ou Bluetooth em modo Teclado (HID) com sufixo Enter (CR) ativado — funciona direto nos campos de bipagem do Recebimento, Separação, Inventário e PDV.',
  },
  {
    item: 'Celular iPhone (iOS) — App Motorista & Força de Vendas',
    config: 'Abrir a URL de produção no Safari (não Chrome) → botão Compartilhar (↑) → "Adicionar à Tela de Início". Abre em tela cheia como aplicativo nativo sem precisar da App Store.',
  },
  {
    item: 'Celular Android — PWA Instalável',
    config: 'Abrir no Chrome → menu (⋮) → "Instalar aplicativo" / "Adicionar à tela inicial". Suporta atalhos diretos para Motorista, Força de Vendas e PDV.',
  },
]

const TROUBLESHOOTING = [
  {
    problema: 'Site na Vercel abre, mas ao fazer login dá erro "VITE_API_URL não configurada" ou erro de rede',
    solucao: 'Acesse Vercel → Projeto → Settings → Environment Variables → crie VITE_API_URL apontando para a URL da sua API (ex.: https://wms-erp-api.onrender.com, sem barra no final) e clique em Redeploy.',
  },
  {
    problema: 'Erro de CORS no navegador ao conectar da Vercel na API',
    solucao: 'No painel do servidor da API (Render/Railway), ajuste a variável CORS_ORIGIN incluindo exatamente o domínio da Vercel (ex.: https://wms-erp-cow3.vercel.app,https://*.vercel.app) e reinicie o serviço.',
  },
  {
    problema: 'Primeira requisição no plano gratuito do Render demora ~30s',
    solucao: 'O plano Free do Render hiberna após 15 min sem uso. Para produção diária da empresa, use o plano Starter (~US$ 7/mês) ou Railway/VPS para resposta instantânea 24/7.',
  },
  {
    problema: 'PWA no iPhone não atualizou após um novo deploy',
    solucao: 'Feche o app completamente na barra de apps recentes e abra novamente (o Service Worker usa estratégia network-first e headers no-cache em vercel.json).',
  },
  {
    problema: 'Trava FEFO bloqueou a expedição de uma caixa',
    solucao: 'Comportamento intencional de prevenção de perdas! Caixas vencidas têm bloqueio rígido. Para furo de fila (caixa válida porém mais nova que outra disponível), um supervisor precisa autorizar com PIN gerencial (fica gravado no Radar Antifraude).',
  },
]

export function ManualGoLive() {
  const navigate = useNavigate()
  const { operador, toastSuccess, toastError } = useAppStore()
  const [aba, setAba] = useState('DIAGNOSTICO')
  const [statusData, setStatusData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [migrandoTurso, setMigrandoTurso] = useState(false)
  const [imprimindoManual, setImprimindoManual] = useState(false)
  const [copiadoKey, setCopiadoKey] = useState('')
  const [abertos, setAbertos] = useState({ dia0: true, atacado_logistica: true })
  const [concluidos, setConcluidos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_ROTEIROS) || '{}')
    } catch {
      return {}
    }
  })

  const carregarDiagnostico = useCallback(async () => {
    if (!isApiEnabled()) return
    setLoading(true)
    try {
      const res = await apiRequest('/api/system/golive-status')
      setStatusData(res)
    } catch (err) {
      toastError('Falha ao consultar diagnóstico', err.message)
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => {
    carregarDiagnostico()
  }, [carregarDiagnostico])

  const handleRestaurarTurso = async () => {
    if (!isApiEnabled()) return
    setMigrandoTurso(true)
    try {
      const creds = getLegacyTursoCredentials()
      const res = await apiRequest('/api/system/migrar-turso', {
        method: 'POST',
        body: creds,
      })
      const disp = res?.report?.estoqueDisponivel
      toastSuccess(
        'Dados do Beef Container sincronizados!',
        `${res?.report?.counts?.produtos?.target ?? 0} produtos e ${disp?.targetCount ?? 0} caixas disponíveis (${disp?.targetKg ?? '0'} kg) validados.`,
      )
      await carregarDiagnostico()
    } catch (err) {
      toastError('Falha ao importar nuvem antiga', err.message)
    } finally {
      setMigrandoTurso(false)
    }
  }

  const copiarTexto = async (key, texto) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiadoKey(key)
      toastSuccess('Copiado!', 'Conteúdo copiado para a área de transferência.')
      setTimeout(() => setCopiadoKey(''), 1800)
    } catch {
      toastError('Erro ao copiar', 'Copie manualmente o texto exibido.')
    }
  }

  const togglePasso = (roteiroId, idx) => {
    const k = `${roteiroId}:${idx}`
    setConcluidos((prev) => {
      const next = { ...prev, [k]: !prev[k] }
      try {
        localStorage.setItem(STORAGE_KEY_ROTEIROS, JSON.stringify(next))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  const limparChecklist = () => {
    setConcluidos({})
    try {
      localStorage.removeItem(STORAGE_KEY_ROTEIROS)
    } catch {
      // ignore
    }
    toastSuccess('Checklist reiniciado', 'Todos os passos dos roteiros foram desmarcados.')
  }

  const totalPassos = ROTEIROS_OPERACIONAIS.reduce((s, r) => s + r.passos.length, 0)
  const totalMarcados = ROTEIROS_OPERACIONAIS.reduce(
    (s, r) => s + r.passos.filter((_, idx) => Boolean(concluidos[`${r.id}:${idx}`])).length,
    0,
  )

  const apiUrlAtual = getApiBaseUrl() || '(não configurada — modo local)'

  const envBackendExemplo = [
    'NODE_ENV=production',
    'PG_DRIVER=pg',
    'DATABASE_URL=postgresql://USUARIO:SENHA@HOST.neon.tech/neondb?sslmode=require',
    'JWT_SECRET=troque-por-uma-chave-aleatoria-com-mais-de-40-caracteres-seguros',
    'CORS_ORIGIN=https://wms-erp-cow3.vercel.app,https://*.vercel.app',
  ].join('\n')

  const envFrontendExemplo = 'VITE_API_URL=https://wms-erp-api.onrender.com'

  const renderBadgeStatus = (st) => {
    if (st === 'OK') {
      return (
        <span className="badge badge--success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <CheckCircle2 size={12} /> Pronto
        </span>
      )
    }
    if (st === 'ALERTA') {
      return (
        <span className="badge badge--warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={12} /> Atenção
        </span>
      )
    }
    return (
      <span className="badge badge--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <XCircle size={12} /> Pendente
      </span>
    )
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1360, margin: '0 auto', paddingBottom: 32 }}>
      {/* HEADER */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-header__title flex items-center gap-10">
            <BookOpen className="text-primary" size={24} /> Manual de Implantação, Operação &amp; Go-Live
          </h1>
          <p className="page-header__subtitle">
            Diagnóstico ao vivo de prontidão para produção, guia de deploy (PostgreSQL + API + Vercel + iPhone PWA) e roteiros completos por setor
          </p>
        </div>

        <div className="flex gap-8 flex-wrap no-print">
          {isApiEnabled() && isMaster(operador) && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={handleRestaurarTurso}
              disabled={migrandoTurso}
              style={{ borderColor: 'rgba(34,197,94,0.45)', color: '#4ade80' }}
            >
              <Database size={15} className={migrandoTurso ? 'spin' : ''} />
              {migrandoTurso ? 'Restaurando Nuvem...' : 'Restaurar Banco Nuvem (Beef Container)'}
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={carregarDiagnostico} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Atualizar Diagnóstico
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setImprimindoManual(true)}>
            <Printer size={15} /> Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      {/* ABAS */}
      <div
        className="card no-print"
        style={{
          padding: 8,
          marginBottom: 16,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          background: 'var(--bg-2)',
        }}
      >
        {[
          { id: 'DIAGNOSTICO', label: '1. Diagnóstico Go-Live (Ao Vivo)', icon: ShieldCheck },
          { id: 'DEPLOY', label: '2. Deploy em Produção & iPhone PWA', icon: Cloud },
          { id: 'ROTEIROS', label: `3. Roteiros Passo a Passo (${totalMarcados}/${totalPassos})`, icon: PlayCircle },
          { id: 'HARDWARE', label: '4. Impressoras, Equipamentos & Suporte', icon: Wrench },
        ].map((t) => {
          const Icon = t.icon
          const ativo = aba === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setAba(t.id)}
              className={`btn btn--sm ${ativo ? 'btn--primary' : 'btn--ghost'}`}
              style={{ flex: '1 1 200px', justifyContent: 'center' }}
            >
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 1: DIAGNÓSTICO GO-LIVE AO VIVO                                      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'DIAGNOSTICO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 16, borderLeft: '4px solid #22c55e' }}>
              <div className="text-xs text-muted uppercase">Score de Prontidão Go-Live</div>
              <div className="font-mono font-bold" style={{ fontSize: 28, color: '#4ade80', marginTop: 4 }}>
                {statusData ? `${statusData.score_prontidao_pct}%` : '—'}
              </div>
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                {statusData
                  ? `${statusData.resumo_checks.ok} prontos • ${statusData.resumo_checks.alertas} alertas • ${statusData.resumo_checks.pendentes} pendentes`
                  : 'Verificando ambiente...'}
              </div>
            </div>

            <div className="card" style={{ padding: 16, borderLeft: '4px solid #38bdf8' }}>
              <div className="text-xs text-muted uppercase">API &amp; Banco de Dados</div>
              <div className="font-mono font-bold text-sm" style={{ marginTop: 6, color: '#38bdf8' }}>
                {statusData?.ambiente?.driver === 'pg' ? 'PostgreSQL Real (Produção)' : 'PGlite Local (Desenvolvimento)'}
              </div>
              <div className="text-xs text-muted truncate" style={{ marginTop: 4 }} title={apiUrlAtual}>
                Endpoint: {apiUrlAtual}
              </div>
            </div>

            <div className="card" style={{ padding: 16, borderLeft: '4px solid #f59e0b' }}>
              <div className="text-xs text-muted uppercase">Pulso Operacional</div>
              <div className="font-mono font-bold text-sm" style={{ marginTop: 6 }}>
                {statusData?.pulso_operacional?.caixas_em_estoque ?? 0} caixas ativas
              </div>
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                {statusData?.pulso_operacional?.ops_abertas ?? 0} OP(s) abertas • {statusData?.pulso_operacional?.pedidos_abertos ?? 0} pedido(s) em curso
              </div>
            </div>

            <div className="card" style={{ padding: 16, borderLeft: '4px solid #a78bfa' }}>
              <div className="text-xs text-muted uppercase">Controle Térmico SIF (24h)</div>
              <div className="font-mono font-bold text-sm" style={{ marginTop: 6 }}>
                {statusData?.pulso_operacional?.rondas_temperatura_24h ?? 0} leitura(s)
              </div>
              <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                Ambiente: {statusData?.ambiente?.node_env || 'development'}
              </div>
            </div>
          </div>

          {/* CHECKLIST DINÂMICO */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-16 border-b border-border flex items-center justify-between flex-wrap gap-8" style={{ background: 'var(--bg-2)' }}>
              <div>
                <div className="font-bold text-sm flex items-center gap-8">
                  <Database size={16} className="text-primary" /> Checklist Automático de Prontidão para Produção
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  Verificação em tempo real da infraestrutura, segurança e cadastros mestres do seu ambiente atual.
                </div>
              </div>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAba('DEPLOY')}>
                <Cloud size={14} /> Ver Passo a Passo de Deploy
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(statusData?.checks || []).map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: '13px 18px',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 360px' }}>
                    <div className="flex items-center gap-8 flex-wrap">
                      {renderBadgeStatus(c.status)}
                      <span className="badge badge--neutral" style={{ fontSize: 10 }}>{c.categoria}</span>
                      <span className="font-bold text-sm">{c.titulo}</span>
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                      {c.detalhe}
                    </div>
                  </div>
                  {c.rota && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm no-print"
                      onClick={() => navigate(c.rota)}
                    >
                      Abrir tela <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!loading && (!statusData || (statusData.checks || []).length === 0) && (
                <div className="p-24 text-center text-muted text-sm">
                  {isApiEnabled()
                    ? 'Clique em "Atualizar Diagnóstico" para consultar a API.'
                    : 'Configure VITE_API_URL apontando para o servidor backend para ativar o diagnóstico ao vivo.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 2: DEPLOY EM PRODUÇÃO (POSTGRESQL + API + VERCEL + IPHONE PWA)      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'DEPLOY' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <h3 className="font-bold text-base flex items-center gap-8" style={{ marginTop: 0, marginBottom: 10 }}>
              <Cloud size={18} className="text-primary" /> Arquitetura Recomendada de Produção (Zero Dor de Cabeça)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="badge badge--info" style={{ marginBottom: 6 }}>Passo 1 • Banco de Dados</div>
                <div className="font-bold text-sm">PostgreSQL na Nuvem (Neon ou Supabase)</div>
                <p className="text-xs text-muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
                  Crie um projeto gratuito em <strong>neon.tech</strong> ou <strong>supabase.com</strong>, copie a <code>DATABASE_URL</code> (string <code>postgresql://...</code>). As tabelas e índices são criados automaticamente na primeira subida da API!
                </p>
              </div>
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="badge badge--warning" style={{ marginBottom: 6 }}>Passo 2 • Servidor da API</div>
                <div className="font-bold text-sm">Render.com (Blueprint 1-Clique) ou Railway</div>
                <p className="text-xs text-muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
                  No <strong>render.com</strong>: <em>New → Blueprint</em> → conecte <code>heroluci123/wms-erp</code> (ele lê automaticamente o arquivo <code>render.yaml</code> da raiz). Preencha <code>DATABASE_URL</code> e <code>CORS_ORIGIN</code>.
                </p>
              </div>
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                <div className="badge badge--success" style={{ marginBottom: 6 }}>Passo 3 • Frontend Vercel</div>
                <div className="font-bold text-sm">Apontar VITE_API_URL &amp; Redeploy</div>
                <p className="text-xs text-muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
                  No painel da <strong>Vercel</strong> → <em>Settings → Environment Variables</em> → adicione <code>VITE_API_URL</code> com a URL HTTPS da API publicada (sem barra no final) e clique em <strong>Redeploy</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* VARIÁVEIS COPIÁVEIS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
                <div className="font-bold text-sm">Variáveis de Ambiente — API Backend (Render / Railway / Docker)</div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm no-print"
                  onClick={() => copiarTexto('env-back', envBackendExemplo)}
                >
                  {copiadoKey === 'env-back' ? <Check size={14} className="text-success" /> : <Copy size={14} />} Copiar
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: '#0b1120',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  overflowX: 'auto',
                  color: '#93c5fd',
                  lineHeight: 1.6,
                }}
              >
                {envBackendExemplo}
              </pre>
              <div className="text-xs text-muted" style={{ marginTop: 8 }}>
                Health Check automático: <code>GET /api/health</code> → deve responder <code>{`{"ok":true,"driver":"pg",...}`}</code>.
              </div>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
                <div className="font-bold text-sm">Variável de Ambiente — Frontend (Vercel)</div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm no-print"
                  onClick={() => copiarTexto('env-front', envFrontendExemplo)}
                >
                  {copiadoKey === 'env-front' ? <Check size={14} className="text-success" /> : <Copy size={14} />} Copiar
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: '#0b1120',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  overflowX: 'auto',
                  color: '#4ade80',
                  lineHeight: 1.6,
                }}
              >
                {envFrontendExemplo}
              </pre>
              <div className="text-xs text-muted" style={{ marginTop: 10, lineHeight: 1.55 }}>
                <strong>Teste de Fumaça pós-deploy (3 min):</strong>
                <br />1. Abra <code>https://sua-api.../api/health</code> e confirme <code>"ok": true</code> e <code>"driver": "pg"</code>.
                <br />2. Abra a Vercel, faça login inicial (<code>Luciano</code> / <code>7410</code>) e <strong>troque imediatamente a senha</strong> pelo ícone de chave no topo!
                <br />3. Abra esta tela (<em>Manual &amp; Go-Live → Diagnóstico</em>) e confirme os 3 checks de infraestrutura verdes.
              </div>
            </div>
          </div>

          {/* INSTALAÇÃO PWA NO IPHONE & ANDROID */}
          <div className="card" style={{ padding: 18 }}>
            <h3 className="font-bold text-base flex items-center gap-8" style={{ marginTop: 0, marginBottom: 10 }}>
              <Smartphone size={18} className="text-success" /> Como Instalar no iPhone (iOS) e Android — App Motorista &amp; Força de Vendas
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
                <div className="font-bold text-sm" style={{ color: '#4ade80' }}>iPhone / iPad (iOS — sem precisar de App Store)</div>
                <ol className="text-xs" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                  <li>Abra o endereço da Vercel no <strong>Safari</strong> (importante: no iOS precisa ser pelo Safari).</li>
                  <li>Para instalar direto no App Motorista, abra <code>/#/motorista</code> (ou <code>/#/forca-vendas</code> para vendedores).</li>
                  <li>Toque no botão <strong>Compartilhar</strong> (quadrado com seta para cima na barra inferior).</li>
                  <li>Role e toque em <strong>&quot;Adicionar à Tela de Início&quot;</strong> → <strong>Adicionar</strong>.</li>
                  <li>Pronto! O ícone do WMSphere aparece na tela do iPhone e abre em tela cheia como app nativo, com câmera para foto de canhoto, assinatura na tela e GPS!</li>
                </ol>
              </div>
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)' }}>
                <div className="font-bold text-sm" style={{ color: '#38bdf8' }}>Android (Chrome)</div>
                <ol className="text-xs" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                  <li>Abra o endereço de produção no <strong>Google Chrome</strong>.</li>
                  <li>Toque no banner <strong>&quot;Instalar aplicativo&quot;</strong> (ou no menu <strong>⋮</strong> → <em>Adicionar à tela inicial</em>).</li>
                  <li>Pressionando o ícone do app instalado, o Android exibe atalhos diretos para <strong>App Motorista</strong>, <strong>Força de Vendas</strong> e <strong>PDV</strong>.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 3: ROTEIROS OPERACIONAIS PASSO A PASSO                              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'ROTEIROS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card p-14 flex items-center justify-between flex-wrap gap-10" style={{ background: 'var(--bg-2)' }}>
            <div>
              <div className="font-bold text-sm">
                Progresso dos Roteiros de Teste &amp; Treinamento: {totalMarcados} de {totalPassos} passos concluídos
              </div>
              <div className="text-xs text-muted">
                Marque os itens conforme você testa ou treina sua equipe. O progresso fica salvo automaticamente neste navegador.
              </div>
            </div>
            <div className="flex gap-8 no-print">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  const todos = {}
                  ROTEIROS_OPERACIONAIS.forEach((r) => { todos[r.id] = true })
                  setAbertos(todos)
                }}
              >
                Expandir Todos
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={limparChecklist}>
                <RotateCcw size={13} /> Zerar Marcações
              </button>
            </div>
          </div>

          {ROTEIROS_OPERACIONAIS.map((rot) => {
            const aberto = Boolean(abertos[rot.id])
            const feitosRot = rot.passos.filter((_, i) => Boolean(concluidos[`${rot.id}:${i}`])).length
            return (
              <div key={rot.id} className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `4px solid ${rot.cor}` }}>
                <div
                  onClick={() => setAbertos((prev) => ({ ...prev, [rot.id]: !prev[rot.id] }))}
                  style={{
                    padding: '14px 18px',
                    cursor: 'pointer',
                    background: 'var(--bg-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="flex items-center gap-10">
                    {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div>
                      <div className="font-bold text-sm">{rot.titulo}</div>
                      <div className="text-xs text-muted" style={{ marginTop: 2 }}>{rot.resumo}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <span className="badge badge--neutral">{rot.badge}</span>
                    <span className={`badge ${feitosRot === rot.passos.length ? 'badge--success' : 'badge--info'}`}>
                      {feitosRot}/{rot.passos.length}
                    </span>
                  </div>
                </div>

                {aberto && (
                  <div style={{ padding: '10px 18px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rot.passos.map((p, idx) => {
                      const marcado = Boolean(concluidos[`${rot.id}:${idx}`])
                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '9px 12px',
                            borderRadius: 8,
                            background: marcado ? 'rgba(34,197,94,0.08)' : 'var(--bg-1)',
                            border: `1px solid ${marcado ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', flex: 1 }}>
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={() => togglePasso(rot.id, idx)}
                              style={{ marginTop: 3 }}
                            />
                            <span
                              className="text-sm"
                              style={{
                                lineHeight: 1.5,
                                textDecoration: marcado ? 'line-through' : 'none',
                                color: marcado ? 'var(--text-muted)' : 'var(--text-primary)',
                              }}
                            >
                              <strong className="font-mono" style={{ marginRight: 6 }}>{idx + 1}.</strong>
                              {p.texto}
                            </span>
                          </label>
                          {p.rota && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm no-print"
                              style={{ flexShrink: 0 }}
                              onClick={() => navigate(p.rota)}
                            >
                              Ir <ExternalLink size={12} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ABA 4: IMPRESSORAS, EQUIPAMENTOS & TROUBLESHOOTING                      */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {aba === 'HARDWARE' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <div className="font-bold text-sm flex items-center gap-8">
                <Printer size={16} className="text-primary" /> Padrão de Impressoras, Coletores &amp; Dispositivos Móveis
              </div>
            </div>
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Equipamento / Dispositivo</th>
                    <th>Configuração Recomendada em Produção</th>
                  </tr>
                </thead>
                <tbody>
                  {CHECKLIST_HARDWARE.map((h, i) => (
                    <tr key={i}>
                      <td className="font-bold text-sm">{h.item}</td>
                      <td className="text-sm text-secondary" style={{ lineHeight: 1.55 }}>{h.config}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="p-16 border-b border-border" style={{ background: 'var(--bg-2)' }}>
              <div className="font-bold text-sm flex items-center gap-8">
                <Wrench size={16} className="text-warning" /> Solução Rápida de Problemas (Troubleshooting)
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {TROUBLESHOOTING.map((t, idx) => (
                <div key={idx} style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div className="font-bold text-sm" style={{ color: '#fbbf24' }}>
                    {t.problema}
                  </div>
                  <div className="text-sm text-secondary" style={{ marginTop: 4, lineHeight: 1.55 }}>
                    {t.solucao}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {imprimindoManual && (
        <PrintDocumentModal
          title="Playbook de Implantação, Operação & Go-Live — WMSphere ERP"
          orientation="landscape"
          onClose={() => setImprimindoManual(false)}
        >
          <div className="wms-print-header">
            <div>
              <div className="wms-print-brand">WMSphere ERP — Playbook Oficial de Implantação &amp; Operação</div>
              <div className="wms-print-brand-sub">Diagnóstico Go-Live, Roteiros Operacionais por Setor e Padrão de Equipamentos</div>
            </div>
            <div className="wms-print-doc-title">
              PRONTIDÃO: {statusData ? `${statusData.score_prontidao_pct}%` : '—'}
            </div>
          </div>

          {statusData?.checks?.length > 0 && (
            <>
              <div className="wms-print-section-title">1. Diagnóstico de Prontidão do Ambiente</div>
              <table className="wms-print-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Categoria</th>
                    <th>Item Verificado</th>
                    <th>Detalhe Atual</th>
                  </tr>
                </thead>
                <tbody>
                  {statusData.checks.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 800 }}>{c.status}</td>
                      <td>{c.categoria}</td>
                      <td style={{ fontWeight: 700 }}>{c.titulo}</td>
                      <td>{c.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="wms-print-section-title">2. Roteiros Operacionais Ponta a Ponta</div>
          {ROTEIROS_OPERACIONAIS.map((rot) => (
            <div key={rot.id} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 11, marginBottom: 4 }}>{rot.titulo}</div>
              <table className="wms-print-table">
                <tbody>
                  {rot.passos.map((p, idx) => (
                    <tr key={idx}>
                      <td className="wms-print-mono" style={{ width: 34, textAlign: 'center' }}>
                        {concluidos[`${rot.id}:${idx}`] ? '[X]' : '[ ]'}
                      </td>
                      <td>
                        <strong>{idx + 1}.</strong> {p.texto}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="wms-print-section-title">3. Padrão de Impressoras &amp; Dispositivos</div>
          <table className="wms-print-table">
            <thead>
              <tr>
                <th>Equipamento</th>
                <th>Configuração Recomendada</th>
              </tr>
            </thead>
            <tbody>
              {CHECKLIST_HARDWARE.map((h, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{h.item}</td>
                  <td>{h.config}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="wms-print-footer">
            <span>WMSphere ERP — Playbook Oficial Go-Live</span>
            <span>Emitido em {new Date().toLocaleString('pt-BR')}</span>
          </div>
        </PrintDocumentModal>
      )}
    </div>
  )
}
