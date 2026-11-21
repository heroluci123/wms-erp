import React, { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  Edit2,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Layers,
  Lock,
  Plus,
  Power,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { operadoresQueries } from '../queries/operadores'
import { cadastrosQueries } from '../queries/cadastros'
import { useAppStore } from '../store/appStore'
import { gerarSenhaInicial } from '../utils/authCrypto'
import {
  CHAVES_PROIBIDAS_CLIENTE,
  PERFIS_SISTEMA_BASE,
  SETORES_EMPRESA,
  SETORES_PERMISSOES,
  aplicarSetorPermissoes,
  isCliente,
  isMaster,
  sanitizarPermissoes,
  temPermissao,
} from '../utils/permissoes'
import { ModalDialog } from '../components/shared/ModalDialog'

const fmtDateTime = (str) => {
  if (!str) return '-'
  const clean = String(str).trim().replace(' ', 'T')
  const dt = new Date(/[Zz]$/.test(clean) ? clean : clean + 'Z')
  if (Number.isNaN(dt.getTime())) return str
  return dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function CustomCheckbox({ checked, disabled = false, onChange }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: 5,
        border: checked ? '1.5px solid #3b82f6' : '1.5px solid #3b4f73',
        background: checked ? '#2563eb' : '#0b1220',
        boxShadow: checked ? '0 0 0 2px rgba(59, 130, 246, 0.22)' : 'none',
        flexShrink: 0,
        transition: 'all 0.15s ease',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={onChange}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          margin: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
      {checked && <Check size={12} strokeWidth={3} color="#ffffff" />}
    </span>
  )
}

function AccordionMatrizPermissoes({
  permissoes,
  onChange,
  nivel,
  readOnly = false,
}) {
  const [setoresAbertos, setSetoresAbertos] = useState(() => {
    const init = {}
    SETORES_PERMISSOES.forEach((s, i) => {
      init[s.id] = i < 2
    })
    return init
  })

  const ehMaster = String(nivel || '').toUpperCase() === 'MASTER'
  const ehCliente = String(nivel || '').toUpperCase() === 'CLIENTE'

  const toggleSetor = (id) => {
    setSetoresAbertos((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const expandirTodos = (abrir) => {
    const next = {}
    SETORES_PERMISSOES.forEach((s) => {
      next[s.id] = abrir
    })
    setSetoresAbertos(next)
  }

  const handleTogglePermissao = (key) => {
    if (readOnly || ehMaster) return
    if (ehCliente && CHAVES_PROIBIDAS_CLIENTE.has(key)) return
    onChange({ ...permissoes, [key]: !permissoes?.[key] })
  }

  const handleSelecionarSetor = (e, setorId, marcar) => {
    e.stopPropagation()
    if (readOnly || ehMaster) return
    onChange(aplicarSetorPermissoes(permissoes, setorId, marcar, nivel))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {ehMaster
            ? 'Nível MASTER possui acesso irrestrito automático a todos os setores.'
            : ehCliente
              ? 'Nível CLIENTE permite apenas permissões de consulta e relatórios (operações bloqueadas).'
              : 'Expanda os setores abaixo para personalizar permissões ou selecionar todo o setor de uma vez.'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ padding: '5px 12px', fontSize: 12, background: '#131d32' }}
            onClick={() => expandirTodos(true)}
          >
            Expandir Todos
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ padding: '5px 12px', fontSize: 12, background: '#131d32' }}
            onClick={() => expandirTodos(false)}
          >
            Recolher Todos
          </button>
        </div>
      </div>

      {SETORES_PERMISSOES.map((setor) => {
        const aberto = !!setoresAbertos[setor.id]
        const total = setor.permissoes.length
        const liberadas = setor.permissoes.filter((p) => {
          if (ehMaster) return true
          if (ehCliente && CHAVES_PROIBIDAS_CLIENTE.has(p.key)) return false
          return !!permissoes?.[p.key]
        }).length
        const permitidasNoNivel = setor.permissoes.filter(
          (p) => !(ehCliente && CHAVES_PROIBIDAS_CLIENTE.has(p.key))
        ).length

        return (
          <div
            key={setor.id}
            style={{
              border: '1px solid #263654',
              borderRadius: 12,
              overflow: 'hidden',
              background: '#111a2e',
            }}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggleSetor(setor.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleSetor(setor.id)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 16px',
                cursor: 'pointer',
                background: aberto ? '#17243d' : '#131d32',
                borderBottom: aberto ? '1px solid #263654' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {aberto ? <ChevronDown size={17} color="#60a5fa" /> : <ChevronRight size={17} color="#8fa4cc" />}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>{setor.nome}</span>
                    <span
                      className={`badge ${liberadas > 0 ? 'badge--success' : 'badge--neutral'}`}
                      style={{ fontSize: 11 }}
                    >
                      {liberadas} / {total} liberadas
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {setor.descricao}
                  </div>
                </div>
              </div>

              {!readOnly && !ehMaster && permitidasNoNivel > 0 && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: '5px 10px', fontSize: 11, color: '#38bdf8', background: '#0e1729', borderColor: '#294066' }}
                    onClick={(e) => handleSelecionarSetor(e, setor.id, true)}
                  >
                    <CheckSquare size={13} />
                    Selecionar Tudo
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ padding: '5px 10px', fontSize: 11, color: '#94a3b8', background: '#0e1729', borderColor: '#263654' }}
                    onClick={(e) => handleSelecionarSetor(e, setor.id, false)}
                  >
                    <Square size={13} />
                    Limpar Setor
                  </button>
                </div>
              )}
            </div>

            {aberto && (
              <div
                style={{
                  padding: 14,
                  background: '#0d1526',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))',
                  gap: 10,
                }}
              >
                {setor.permissoes.map((perm) => {
                  const bloqueadaCliente = ehCliente && CHAVES_PROIBIDAS_CLIENTE.has(perm.key)
                  const checked = ehMaster
                    ? true
                    : bloqueadaCliente
                      ? false
                      : !!permissoes?.[perm.key]
                  const disabled = readOnly || ehMaster || bloqueadaCliente

                  return (
                    <label
                      key={perm.key}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '11px 12px',
                        borderRadius: 10,
                        border: checked
                          ? '1.5px solid #3b82f6'
                          : '1px solid #24334d',
                        background: checked ? '#162547' : '#111a2e',
                        opacity: bloqueadaCliente ? 0.52 : 1,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      <div style={{ paddingTop: 1 }}>
                        <CustomCheckbox
                          checked={checked}
                          disabled={disabled}
                          onChange={() => handleTogglePermissao(perm.key)}
                        />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{perm.label}</span>
                          {bloqueadaCliente && (
                            <span className="badge badge--danger" style={{ fontSize: 10 }}>
                              Bloqueado p/ Cliente
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
                          {perm.desc}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Operadores() {
  const { operador: usuarioAtual, toastSuccess, toastError } = useAppStore()
  const podeGerenciarUsuarios = temPermissao(usuarioAtual, 'operadores')
  const podeRedefinirSenhas =
    isMaster(usuarioAtual) ||
    temPermissao(usuarioAtual, 'redefinir_senhas') ||
    temPermissao(usuarioAtual, 'operadores')
  const podeGerenciarPerfis =
    isMaster(usuarioAtual) || temPermissao(usuarioAtual, 'perfis_gerenciar')
  const podeAcessarModulo = podeGerenciarUsuarios || podeGerenciarPerfis
  const souMaster = isMaster(usuarioAtual)

  const [abaAtiva, setAbaAtiva] = useState(() => (podeGerenciarUsuarios ? 'usuarios' : 'perfis'))
  const [loading, setLoading] = useState(false)
  const [usuarios, setUsuarios] = useState([])
  const [perfis, setPerfis] = useState(PERFIS_SISTEMA_BASE)
  const [auditoria, setAuditoria] = useState([])
  const [filiaisSistema, setFiliaisSistema] = useState([])

  // Filtros Usuários
  const [buscaUsuario, setBuscaUsuario] = useState('')
  const [filtroSetor, setFiltroSetor] = useState('TODOS')
  const [filtroStatus, setFiltroStatus] = useState('TODOS')

  // Filtros Auditoria
  const [buscaAuditoria, setBuscaAuditoria] = useState('')

  // Modal Criar/Editar Usuário
  const [modalUsuarioAberto, setModalUsuarioAberto] = useState(false)
  const [editandoUsuario, setEditandoUsuario] = useState(null)
  const [salvandoUsuario, setSalvandoUsuario] = useState(false)
  const [mostrarSenhaModal, setMostrarSenhaModal] = useState(true)
  const [formUsuario, setFormUsuario] = useState({
    nome: '',
    login: '',
    senha: '',
    setor: 'Produção',
    perfil: 'OPERADOR',
    nivel: 'OPERACIONAL',
    deve_trocar_senha: true,
    ativo: 1,
    filiais_permitidas: [],
    filial_padrao_id: '',
    permissoes: sanitizarPermissoes({}, 'OPERACIONAL', 'OPERADOR'),
  })

  // Modal Redefinir Senha
  const [modalSenhaAberto, setModalSenhaAberto] = useState(false)
  const [usuarioSenhaAlvo, setUsuarioSenhaAlvo] = useState(null)
  const [novaSenhaReset, setNovaSenhaReset] = useState('')
  const [mostrarSenhaReset, setMostrarSenhaReset] = useState(true)
  const [exigirTrocaReset, setExigirTrocaReset] = useState(true)
  const [salvandoReset, setSalvandoReset] = useState(false)

  // Modal Criar/Editar Perfil
  const [modalPerfilAberto, setModalPerfilAberto] = useState(false)
  const [editandoPerfil, setEditandoPerfil] = useState(null)
  const [salvandoPerfil, setSalvandoPerfil] = useState(false)
  const [formPerfil, setFormPerfil] = useState({
    codigo: '',
    nome: '',
    nivel: 'OPERACIONAL',
    setor_padrao: 'Produção',
    descricao: '',
    permissoes: sanitizarPermissoes({}, 'OPERACIONAL', 'OPERADOR'),
  })

  // Diálogo de confirmação
  const [dialog, setDialog] = useState({
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    onConfirm: null,
  })

  const carregarTudo = async () => {
    if (!podeAcessarModulo) return
    setLoading(true)
    try {
      const [listaUsers, listaPerfis, listaAud, listaFils] = await Promise.all([
        podeGerenciarUsuarios ? operadoresQueries.listar() : Promise.resolve([]),
        operadoresQueries.listarPerfis().catch(() => PERFIS_SISTEMA_BASE),
        podeGerenciarUsuarios ? operadoresQueries.listarAuditoria(150).catch(() => []) : Promise.resolve([]),
        cadastrosQueries.listarContextoFiliais().then((r) => r?.data || []).catch(() => []),
      ])
      setUsuarios(listaUsers || [])
      setPerfis(listaPerfis?.length ? listaPerfis : PERFIS_SISTEMA_BASE)
      setAuditoria(listaAud || [])
      setFiliaisSistema(listaFils || [])
    } catch (err) {
      toastError(err?.message || 'Erro ao carregar dados de usuários.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!podeGerenciarUsuarios && podeGerenciarPerfis && abaAtiva !== 'perfis') {
      setAbaAtiva('perfis')
    }
    carregarTudo()
  }, [podeGerenciarUsuarios, podeGerenciarPerfis])

  const setoresPresentes = useMemo(() => {
    const s = new Set(SETORES_EMPRESA)
    usuarios.forEach((u) => {
      if (u.setor) s.add(u.setor)
    })
    return ['TODOS', ...Array.from(s)]
  }, [usuarios])

  const usuariosFiltrados = useMemo(() => {
    const termo = buscaUsuario.trim().toLowerCase()
    return usuarios.filter((u) => {
      if (filtroSetor !== 'TODOS' && (u.setor || '') !== filtroSetor) return false
      if (filtroStatus === 'ATIVOS' && Number(u.ativo) !== 1) return false
      if (filtroStatus === 'INATIVOS' && Number(u.ativo) === 1) return false
      if (!termo) return true
      return (
        String(u.nome || '').toLowerCase().includes(termo) ||
        String(u.login || '').toLowerCase().includes(termo) ||
        String(u.setor || '').toLowerCase().includes(termo) ||
        String(u.perfil || '').toLowerCase().includes(termo) ||
        String(u.nivel || '').toLowerCase().includes(termo)
      )
    })
  }, [usuarios, buscaUsuario, filtroSetor, filtroStatus])

  const auditoriaFiltrada = useMemo(() => {
    const termo = buscaAuditoria.trim().toLowerCase()
    if (!termo) return auditoria
    return auditoria.filter((a) =>
      [a.acao, a.executor_nome, a.target_user_nome, a.detalhes_antes, a.detalhes_depois]
        .some((v) => String(v || '').toLowerCase().includes(termo))
    )
  }, [auditoria, buscaAuditoria])

  const copiarTexto = async (txt) => {
    try {
      await navigator.clipboard.writeText(txt)
      toastSuccess('Senha copiada para a área de transferência!')
    } catch {
      toastError('Não foi possível copiar automaticamente.')
    }
  }

  const abrirModalNovoUsuario = () => {
    const perfilOp = perfis.find((p) => p.codigo === 'OPERADOR') || PERFIS_SISTEMA_BASE[0]
    const senhaAuto = gerarSenhaInicial(8)
    setEditandoUsuario(null)
    setMostrarSenhaModal(true)
    setFormUsuario({
      nome: '',
      login: '',
      senha: senhaAuto,
      setor: perfilOp.setor_padrao || 'Produção',
      perfil: perfilOp.codigo,
      nivel: perfilOp.nivel || 'OPERACIONAL',
      deve_trocar_senha: true,
      ativo: 1,
      filiais_permitidas: filiaisSistema.map((f) => f.id),
      filial_padrao_id: filiaisSistema[0]?.id || '',
      permissoes: sanitizarPermissoes(perfilOp.permissoes, perfilOp.nivel, perfilOp.codigo),
    })
    setModalUsuarioAberto(true)
  }

  const abrirModalEditarUsuario = (user) => {
    if (isMaster(user) && !souMaster) {
      toastError('Apenas o usuário MASTER pode editar a conta MASTER.')
      return
    }
    const nivel = user.nivel || (isMaster(user) ? 'MASTER' : isCliente(user) ? 'CLIENTE' : 'OPERACIONAL')
    const perfil = user.perfil || (nivel === 'MASTER' ? 'MASTER' : nivel === 'CLIENTE' ? 'CLIENTE' : 'OPERADOR')
    setEditandoUsuario(user)
    setFormUsuario({
      nome: user.nome || '',
      login: user.login || '',
      senha: '',
      setor: user.setor || 'Produção',
      perfil,
      nivel,
      deve_trocar_senha: Number(user.deve_trocar_senha) === 1,
      ativo: Number(user.ativo ?? 1),
      filiais_permitidas: Array.isArray(user.filiais_permitidas) ? user.filiais_permitidas : [],
      filial_padrao_id: user.filial_padrao_id || '',
      permissoes: sanitizarPermissoes(user.permissoes, nivel, perfil),
    })
    setModalUsuarioAberto(true)
  }

  const handleSelecionarPerfilNoUsuario = (codigoPerfil) => {
    const encontrado = perfis.find((p) => p.codigo === codigoPerfil)
    if (!encontrado) {
      setFormUsuario((prev) => ({ ...prev, perfil: codigoPerfil }))
      return
    }
    const novoNivel =
      encontrado.nivel === 'MASTER' && !souMaster
        ? 'ADMINISTRADOR'
        : encontrado.nivel || 'OPERACIONAL'
    setFormUsuario((prev) => ({
      ...prev,
      perfil: encontrado.codigo,
      nivel: novoNivel,
      setor: encontrado.setor_padrao || prev.setor,
      permissoes: sanitizarPermissoes(encontrado.permissoes, novoNivel, encontrado.codigo),
    }))
  }

  const handleMudarNivelUsuario = (novoNivel) => {
    setFormUsuario((prev) => ({
      ...prev,
      nivel: novoNivel,
      setor: novoNivel === 'CLIENTE' ? 'CLIENTE' : prev.setor,
      permissoes: sanitizarPermissoes(prev.permissoes, novoNivel, prev.perfil),
    }))
  }

  const handleSalvarUsuario = async (e) => {
    e.preventDefault()
    if (!formUsuario.nome.trim()) {
      toastError('Informe o nome completo do usuário.')
      return
    }
    if (!formUsuario.login.trim()) {
      toastError('Informe o nome de usuário (login).')
      return
    }
    if (!editandoUsuario && (!formUsuario.senha || formUsuario.senha.length < 4)) {
      toastError('A senha inicial deve ter pelo menos 4 caracteres.')
      return
    }

    setSalvandoUsuario(true)
    try {
      const permissoesFinais = sanitizarPermissoes(
        formUsuario.permissoes,
        formUsuario.nivel,
        formUsuario.perfil
      )
      if (editandoUsuario) {
        const resUpd = await operadoresQueries.atualizar({
          id: editandoUsuario.id,
          nome: formUsuario.nome.trim(),
          login: formUsuario.login.trim(),
          setor: formUsuario.setor,
          perfil: formUsuario.perfil,
          nivel: formUsuario.nivel,
          ativo: formUsuario.ativo,
          filiais_permitidas: formUsuario.filiais_permitidas,
          filial_padrao_id: formUsuario.filial_padrao_id || null,
          permissoes: permissoesFinais,
        })
        if (resUpd?.success === false) {
          throw new Error(resUpd.error || 'Erro ao atualizar usuário.')
        }
        toastSuccess(`Usuário "${formUsuario.nome.trim()}" atualizado com sucesso!`)
      } else {
        const resCri = await operadoresQueries.criar({
          nome: formUsuario.nome.trim(),
          login: formUsuario.login.trim(),
          senha: formUsuario.senha,
          setor: formUsuario.setor,
          perfil: formUsuario.perfil,
          nivel: formUsuario.nivel,
          deve_trocar_senha: formUsuario.deve_trocar_senha ? 1 : 0,
          filiais_permitidas: formUsuario.filiais_permitidas,
          filial_padrao_id: formUsuario.filial_padrao_id || null,
          permissoes: permissoesFinais,
        })
        if (resCri?.success === false) {
          throw new Error(resCri.error || 'Erro ao criar usuário.')
        }
        toastSuccess(`Usuário "${formUsuario.login.trim()}" criado com sucesso!`)
      }

      setModalUsuarioAberto(false)
      await carregarTudo()
    } catch (err) {
      toastError(err?.message || 'Erro ao salvar usuário.')
    } finally {
      setSalvandoUsuario(false)
    }
  }

  const abrirModalRedefinirSenha = (user) => {
    if (isMaster(user) && !souMaster) {
      toastError('Apenas o usuário MASTER pode redefinir a senha MASTER.')
      return
    }
    setUsuarioSenhaAlvo(user)
    setNovaSenhaReset(gerarSenhaInicial(8))
    setMostrarSenhaReset(true)
    setExigirTrocaReset(true)
    setModalSenhaAberto(true)
  }

  const handleConfirmarRedefinirSenha = async (e) => {
    e.preventDefault()
    if (!novaSenhaReset || novaSenhaReset.length < 4) {
      toastError('A nova senha deve ter pelo menos 4 caracteres.')
      return
    }
    setSalvandoReset(true)
    try {
      await operadoresQueries.redefinirSenha({
        id: usuarioSenhaAlvo.id,
        novaSenha: novaSenhaReset,
        exigirTroca: exigirTrocaReset,
      })
      toastSuccess(`Senha de ${usuarioSenhaAlvo.nome} redefinida com sucesso!`)
      setModalSenhaAberto(false)
      await carregarTudo()
    } catch (err) {
      toastError(err?.message || 'Erro ao redefinir senha.')
    } finally {
      setSalvandoReset(false)
    }
  }

  const handleAlternarStatus = (user) => {
    const proximoStatus = Number(user.ativo) === 1 ? 0 : 1
    const verbo = proximoStatus === 0 ? 'desativar' : 'ativar'
    setDialog({
      isOpen: true,
      type: 'confirm',
      title: `${proximoStatus === 0 ? 'Desativar' : 'Ativar'} Usuário`,
      message:
        proximoStatus === 0
          ? `Deseja desativar "${user.nome}" (${user.login})? Qualquer sessão ativa será encerrada imediatamente.`
          : `Deseja reativar a conta de "${user.nome}" (${user.login})?`,
      onConfirm: async () => {
        try {
          await operadoresQueries.alternarStatus(user.id, proximoStatus)
          toastSuccess(`Conta ${verbo === 'desativar' ? 'desativada' : 'ativada'} com sucesso!`)
          await carregarTudo()
        } catch (err) {
          toastError(err?.message || `Erro ao ${verbo} conta.`)
        }
      },
    })
  }

  const handleExcluirUsuario = (user) => {
    setDialog({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Usuário Permanentemente',
      message: `Tem certeza que deseja excluir o usuário "${user.nome}" (${user.login})? Esta ação removerá sessões vinculadas e ficará registrada na auditoria.`,
      onConfirm: async () => {
        try {
          await operadoresQueries.excluirUsuario(user.id)
          toastSuccess(`Usuário "${user.login}" excluído com sucesso!`)
          await carregarTudo()
        } catch (err) {
          toastError(err?.message || 'Erro ao excluir usuário.')
        }
      },
    })
  }

  const abrirModalPerfil = (perfil = null, duplicar = false) => {
    if (perfil && !duplicar) {
      setEditandoPerfil(perfil)
      setFormPerfil({
        codigo: perfil.codigo,
        nome: perfil.nome,
        nivel: perfil.nivel || 'OPERACIONAL',
        setor_padrao: perfil.setor_padrao || 'Produção',
        descricao: perfil.descricao || '',
        permissoes: sanitizarPermissoes(perfil.permissoes, perfil.nivel, perfil.codigo),
      })
    } else {
      const base = perfil || PERFIS_SISTEMA_BASE[0]
      setEditandoPerfil(null)
      setFormPerfil({
        codigo: '',
        nome: duplicar && perfil ? `${perfil.nome} (Personalizado)` : '',
        nivel: base.nivel === 'MASTER' ? 'ADMINISTRADOR' : base.nivel || 'OPERACIONAL',
        setor_padrao: base.setor_padrao || 'Produção',
        descricao: base.descricao || '',
        permissoes: sanitizarPermissoes(
          base.permissoes,
          base.nivel === 'MASTER' ? 'ADMINISTRADOR' : base.nivel,
          base.codigo
        ),
      })
    }
    setModalPerfilAberto(true)
  }

  const handleSalvarPerfil = async (e) => {
    e.preventDefault()
    const nomeLimpo = formPerfil.nome.trim()
    if (!nomeLimpo) {
      toastError('Informe o nome do perfil.')
      return
    }
    const codigoFinal = (
      formPerfil.codigo.trim() ||
      nomeLimpo
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    )

    setSalvandoPerfil(true)
    try {
      await operadoresQueries.salvarPerfil({
        codigo: codigoFinal,
        nome: nomeLimpo,
        nivel: formPerfil.nivel,
        setor_padrao: formPerfil.setor_padrao,
        descricao: formPerfil.descricao.trim(),
        permissoes: sanitizarPermissoes(formPerfil.permissoes, formPerfil.nivel, codigoFinal),
      })
      toastSuccess(`Perfil "${nomeLimpo}" salvo com sucesso!`)
      setModalPerfilAberto(false)
      await carregarTudo()
    } catch (err) {
      toastError(err?.message || 'Erro ao salvar perfil.')
    } finally {
      setSalvandoPerfil(false)
    }
  }

  const handleExcluirPerfil = (perfil) => {
    setDialog({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Perfil',
      message: `Deseja excluir o perfil personalizado "${perfil.nome}"?`,
      onConfirm: async () => {
        try {
          await operadoresQueries.excluirPerfil(perfil.codigo)
          toastSuccess('Perfil removido com sucesso!')
          await carregarTudo()
        } catch (err) {
          toastError(err?.message || 'Erro ao excluir perfil.')
        }
      },
    })
  }

  if (!podeAcessarModulo) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 48 }}>
        <ShieldAlert size={40} color="#ef4444" style={{ marginBottom: 12 }} />
        <h2 style={{ margin: '0 0 8px' }}>Acesso Negado</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          Seu usuário não possui permissão para gerenciar contas, perfis ou permissões.
        </p>
      </div>
    )
  }

  const renderBadgeNivel = (u) => {
    if (isMaster(u)) {
      return (
        <span
          className="badge"
          style={{
            background: 'rgba(234, 179, 8, 0.16)',
            color: '#facc15',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Crown size={12} /> MASTER
        </span>
      )
    }
    if (isCliente(u)) {
      return (
        <span
          className="badge"
          style={{
            background: 'rgba(14, 165, 233, 0.16)',
            color: '#38bdf8',
            border: '1px solid rgba(14, 165, 233, 0.4)',
          }}
        >
          CLIENTE • {u.perfil || 'CLIENTE'}
        </span>
      )
    }
    if (String(u.nivel || '').toUpperCase() === 'ADMINISTRADOR' || Number(u.is_adm) === 1) {
      return <span className="badge badge--warning">{u.perfil || 'ADMINISTRADOR'}</span>
    }
    return <span className="badge badge--info">{u.perfil || 'OPERADOR'}</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Cabeçalho */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={24} color="#3b82f6" />
            Usuários, Perfis & Permissões
          </h1>
          <p className="page-subtitle">
            Controle de contas individuais, perfis por setor, permissões granulares e auditoria de segurança.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={carregarTudo}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
          {podeGerenciarUsuarios && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={abrirModalNovoUsuario}
            >
              <UserPlus size={16} />
              Novo Usuário
            </button>
          )}
        </div>
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {podeGerenciarUsuarios && (
          <button
            type="button"
            className={`btn ${abaAtiva === 'usuarios' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setAbaAtiva('usuarios')}
          >
            <Users size={16} />
            Usuários ({usuarios.length})
          </button>
        )}
        <button
          type="button"
          className={`btn ${abaAtiva === 'perfis' ? 'btn--primary' : 'btn--ghost'}`}
          onClick={() => setAbaAtiva('perfis')}
        >
          <Layers size={16} />
          Perfis Predefinidos ({perfis.length})
        </button>
        {podeGerenciarUsuarios && (
          <button
            type="button"
            className={`btn ${abaAtiva === 'auditoria' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setAbaAtiva('auditoria')}
          >
            <History size={16} />
            Auditoria de Acessos
          </button>
        )}
      </div>

      {/* ABA 1: USUÁRIOS */}
      {abaAtiva === 'usuarios' && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 16,
              alignItems: 'center',
            }}
          >
            <div style={{ position: 'relative', flex: 1, minWidth: 230 }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                className="form-input"
                value={buscaUsuario}
                onChange={(e) => setBuscaUsuario(e.target.value)}
                placeholder="Buscar por nome, login, setor ou perfil..."
                style={{ width: '100%', padding: '10px 14px 10px 36px' }}
              />
            </div>

            <select
              className="form-input"
              value={filtroSetor}
              onChange={(e) => setFiltroSetor(e.target.value)}
              style={{ minWidth: 190, width: 'auto', padding: '10px 12px' }}
            >
              {setoresPresentes.map((s) => (
                <option key={s} value={s}>
                  {s === 'TODOS' ? 'Todos os Setores' : s}
                </option>
              ))}
            </select>

            <select
              className="form-input"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              style={{ minWidth: 165, width: 'auto', padding: '10px 12px' }}
            >
              <option value="TODOS">Todos os Status</option>
              <option value="ATIVOS">Apenas Ativos</option>
              <option value="INATIVOS">Desativados</option>
            </select>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Login</th>
                  <th>Setor</th>
                  <th>Perfil / Nível</th>
                  <th>Status</th>
                  <th>Último Acesso</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuariosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : (
                  usuariosFiltrados.map((u) => {
                    const alvoMaster = isMaster(u)
                    const podeEditarAlvo = !alvoMaster || souMaster
                    const mesmoUsuario = String(u.id) === String(usuarioAtual?.id)

                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>{u.nome}</span>
                            {mesmoUsuario && (
                              <span className="badge badge--info" style={{ fontSize: 10 }}>
                                Você
                              </span>
                            )}
                            {Number(u.deve_trocar_senha) === 1 && (
                              <span className="badge badge--warning" style={{ fontSize: 10 }}>
                                Senha Inicial
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="font-mono">{u.login || '-'}</td>
                        <td>{u.setor || '-'}</td>
                        <td>{renderBadgeNivel(u)}</td>
                        <td>
                          {Number(u.ativo) === 1 ? (
                            <span className="badge badge--success">Ativo</span>
                          ) : (
                            <span className="badge badge--danger">Desativado</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {u.ultimo_acesso ? fmtDateTime(u.ultimo_acesso) : 'Nunca acessou'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ padding: '6px 9px' }}
                              title="Editar usuário e permissões"
                              disabled={!podeEditarAlvo}
                              onClick={() => abrirModalEditarUsuario(u)}
                            >
                              <Edit2 size={15} />
                            </button>

                            {podeRedefinirSenhas && (
                              <button
                                type="button"
                                className="btn btn--ghost"
                                style={{ padding: '6px 9px', color: '#f59e0b' }}
                                title="Redefinir senha"
                                disabled={!podeEditarAlvo}
                                onClick={() => abrirModalRedefinirSenha(u)}
                              >
                                <KeyRound size={15} />
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{
                                padding: '6px 9px',
                                color: Number(u.ativo) === 1 ? '#ef4444' : '#22c55e',
                              }}
                              title={Number(u.ativo) === 1 ? 'Desativar usuário' : 'Ativar usuário'}
                              disabled={alvoMaster || mesmoUsuario}
                              onClick={() => handleAlternarStatus(u)}
                            >
                              <Power size={15} />
                            </button>

                            {souMaster && !alvoMaster && !mesmoUsuario && (
                              <button
                                type="button"
                                className="btn btn--ghost"
                                style={{ padding: '6px 9px', color: '#f87171' }}
                                title="Excluir usuário"
                                onClick={() => handleExcluirUsuario(u)}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 2: PERFIS PREDEFINIDOS POR SETOR */}
      {abaAtiva === 'perfis' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            className="card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Modelos de Perfis por Setor</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Aplique perfis prontos ao criar usuários ou crie novos modelos personalizados para setores específicos.
              </p>
            </div>
            {podeGerenciarPerfis && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => abrirModalPerfil(null, false)}
              >
                <Plus size={16} />
                Novo Perfil
              </button>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 14,
            }}
          >
            {perfis.map((p) => {
              const pObj = p.permissoes || {}
              const qtd = Object.values(pObj).filter(Boolean).length
              const fixo = Number(p.sistema_fixo) === 1

              return (
                <div
                  key={p.codigo}
                  className="card"
                  style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Shield size={16} color={p.nivel === 'MASTER' ? '#facc15' : '#38bdf8'} />
                          {p.nome}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          Setor padrão: <strong>{p.setor_padrao || '-'}</strong> • Nível:{' '}
                          <strong>{p.nivel}</strong>
                        </div>
                      </div>
                      <span className={`badge ${fixo ? 'badge--neutral' : 'badge--info'}`}>
                        {fixo ? 'Padrão Sistema' : 'Personalizado'}
                      </span>
                    </div>

                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
                      {p.descricao || 'Perfil configurável por setor.'}
                    </p>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: 12,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <span className="badge badge--success">{qtd} permissões ativas</span>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {podeGerenciarPerfis && p.nivel !== 'MASTER' && (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          style={{ padding: '6px 10px', fontSize: 12 }}
                          onClick={() => abrirModalPerfil(p, fixo)}
                        >
                          <Edit2 size={14} />
                          {fixo ? 'Duplicar' : 'Editar'}
                        </button>
                      )}
                      {podeGerenciarPerfis && !fixo && (
                        <button
                          type="button"
                          className="btn btn--ghost"
                          style={{ padding: '6px 10px', fontSize: 12, color: '#ef4444' }}
                          onClick={() => handleExcluirPerfil(p)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ABA 3: AUDITORIA */}
      {abaAtiva === 'auditoria' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                className="form-input"
                value={buscaAuditoria}
                onChange={(e) => setBuscaAuditoria(e.target.value)}
                placeholder="Filtrar auditoria por usuário, ação ou detalhes..."
                style={{ width: '100%', padding: '10px 14px 10px 36px' }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Data / Hora</th>
                  <th>Evento</th>
                  <th>Executado Por</th>
                  <th>Alvo</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {auditoriaFiltrada.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      Nenhum registro de auditoria encontrado.
                    </td>
                  </tr>
                ) : (
                  auditoriaFiltrada.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td>
                      <td>
                        <span
                          className={`badge ${
                            String(a.acao).includes('FALHA') || String(a.acao).includes('NEGADO') || String(a.acao).includes('EXCLUSAO')
                              ? 'badge--danger'
                              : String(a.acao).includes('SENHA') || String(a.acao).includes('STATUS')
                                ? 'badge--warning'
                                : 'badge--info'
                          }`}
                        >
                          {a.acao}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.executor_nome || '-'}</div>
                      </td>
                      <td>
                        <div>{a.target_user_nome || '-'}</div>
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 420, wordBreak: 'break-word' }}>
                        {a.detalhes_depois || a.detalhes_antes || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL CRIAR / EDITAR USUÁRIO */}
      {modalUsuarioAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 9, 18, 0.86)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 9990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 980,
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: 0,
              background: '#0d1424',
              border: '1px solid #33486e',
              borderRadius: 16,
              boxShadow: '0 28px 72px rgba(0, 0, 0, 0.88)',
              color: 'var(--text-primary)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '18px 24px',
                borderBottom: '1px solid #253654',
                position: 'sticky',
                top: 0,
                background: '#131d32',
                zIndex: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: 'rgba(59, 130, 246, 0.16)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShieldCheck size={20} color="#60a5fa" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
                    {editandoUsuario ? `Editar Usuário — ${editandoUsuario.nome}` : 'Novo Usuário'}
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    Configure login, setor de atuação, perfil e permissões granulares.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setModalUsuarioAberto(false)}
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvarUsuario} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div
                style={{
                  padding: 18,
                  borderRadius: 12,
                  background: '#131d32',
                  border: '1px solid #253654',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: '0.02em' }}>
                  1. Dados de Identificação & Acesso
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Nome Completo *</label>
                    <input
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      required
                      value={formUsuario.nome}
                      onChange={(e) => setFormUsuario({ ...formUsuario, nome: e.target.value })}
                      placeholder="Ex: Maria Oliveira"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Nome de Usuário (Login) *</label>
                    <input
                      className="form-input font-mono"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      required
                      value={formUsuario.login}
                      onChange={(e) => setFormUsuario({ ...formUsuario, login: e.target.value })}
                      placeholder="Ex: maria.oliveira"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Setor de Atuação</label>
                    <select
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      value={formUsuario.setor}
                      disabled={formUsuario.nivel === 'CLIENTE'}
                      onChange={(e) => setFormUsuario({ ...formUsuario, setor: e.target.value })}
                    >
                      {SETORES_EMPRESA.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Perfil Predefinido</label>
                    <select
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      value={formUsuario.perfil}
                      disabled={isMaster(editandoUsuario)}
                      onChange={(e) => handleSelecionarPerfilNoUsuario(e.target.value)}
                    >
                      {perfis
                        .filter((p) => souMaster || p.nivel !== 'MASTER')
                        .map((p) => (
                          <option key={p.codigo} value={p.codigo}>
                            {p.nome} ({p.nivel})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Nível de Acesso</label>
                    <select
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      value={formUsuario.nivel}
                      disabled={isMaster(editandoUsuario)}
                      onChange={(e) => handleMudarNivelUsuario(e.target.value)}
                    >
                      <option value="OPERACIONAL">OPERACIONAL</option>
                      <option value="CLIENTE">CLIENTE (Somente Consulta Isolada)</option>
                      <option value="ADMINISTRADOR">ADMINISTRADOR</option>
                      {souMaster && <option value="MASTER">MASTER (Acesso Irrestrito)</option>}
                    </select>
                  </div>
                </div>

                {/* Filiais Liberadas para o Usuário */}
                {filiaisSistema.length > 0 && (
                  <div
                    style={{
                      marginTop: 4,
                      padding: 12,
                      borderRadius: 10,
                      background: '#0b1220',
                      border: '1px solid #253654',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>
                          Filiais Liberadas para este Usuário
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          {formUsuario.nivel === 'MASTER'
                            ? 'MASTER possui acesso irrestrito a todas as filiais automaticamente.'
                            : 'Se apenas 1 filial for liberada, o usuário entra direto nela sem seletor no topo.'}
                        </div>
                      </div>
                      {formUsuario.nivel !== 'MASTER' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() =>
                              setFormUsuario((prev) => ({
                                ...prev,
                                filiais_permitidas: filiaisSistema.map((f) => f.id),
                              }))
                            }
                          >
                            Liberar Todas
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            style={{ padding: '4px 10px', fontSize: 11 }}
                            onClick={() =>
                              setFormUsuario((prev) => ({
                                ...prev,
                                filiais_permitidas: [],
                              }))
                            }
                          >
                            Limpar
                          </button>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {filiaisSistema.map((f) => {
                        const ehMasterForm = formUsuario.nivel === 'MASTER'
                        const lista = Array.isArray(formUsuario.filiais_permitidas) ? formUsuario.filiais_permitidas : []
                        const marcado = ehMasterForm || lista.includes(f.id)
                        return (
                          <label
                            key={f.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '7px 11px',
                              borderRadius: 8,
                              background: marcado ? 'rgba(37, 99, 235, 0.16)' : '#131d32',
                              border: `1px solid ${marcado ? '#3b82f6' : '#263654'}`,
                              cursor: ehMasterForm ? 'not-allowed' : 'pointer',
                              fontSize: 12,
                              color: marcado ? '#f8fafc' : '#94a3b8',
                            }}
                          >
                            <CustomCheckbox
                              checked={marcado}
                              disabled={ehMasterForm}
                              onChange={() => {
                                if (ehMasterForm) return
                                setFormUsuario((prev) => {
                                  const atual = Array.isArray(prev.filiais_permitidas) ? prev.filiais_permitidas : []
                                  const next = atual.includes(f.id)
                                    ? atual.filter((x) => x !== f.id)
                                    : [...atual, f.id]
                                  return {
                                    ...prev,
                                    filiais_permitidas: next,
                                    filial_padrao_id:
                                      next.length > 0 && !next.includes(prev.filial_padrao_id)
                                        ? next[0]
                                        : prev.filial_padrao_id,
                                  }
                                })
                              }}
                            />
                            <span className="font-mono font-bold">{f.codigo}</span>
                            <span>{f.nome}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Senha Automática na Criação */}
              {!editandoUsuario && (
                <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: '#111d38',
                    border: '1px solid rgba(59, 130, 246, 0.38)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <label className="form-label" style={{ margin: 0, color: '#93c5fd' }}>
                      2. Senha Inicial (gerada automaticamente — editável antes de salvar)
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ padding: '5px 11px', fontSize: 12, background: '#0b1220', borderColor: '#2d4368' }}
                        onClick={() =>
                          setFormUsuario({ ...formUsuario, senha: gerarSenhaInicial(8) })
                        }
                      >
                        <RefreshCw size={13} />
                        Gerar Nova
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ padding: '5px 11px', fontSize: 12, background: '#0b1220', borderColor: '#2d4368' }}
                        onClick={() => copiarTexto(formUsuario.senha)}
                      >
                        <Copy size={13} />
                        Copiar
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
                      <input
                        className="form-input font-mono"
                        type={mostrarSenhaModal ? 'text' : 'password'}
                        required
                        value={formUsuario.senha}
                        onChange={(e) => setFormUsuario({ ...formUsuario, senha: e.target.value })}
                        style={{ width: '100%', padding: '10px 42px 10px 13px', background: '#0b1220' }}
                      />
                      <button
                        type="button"
                        onClick={() => setMostrarSenhaModal((v) => !v)}
                        title={mostrarSenhaModal ? 'Ocultar senha' : 'Visualizar senha'}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: 4,
                        }}
                      >
                        {mostrarSenhaModal ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13,
                        color: '#e2e8f0',
                        cursor: 'pointer',
                        padding: '9px 12px',
                        borderRadius: 10,
                        background: '#0b1220',
                        border: '1px solid #263858',
                      }}
                    >
                      <CustomCheckbox
                        checked={!!formUsuario.deve_trocar_senha}
                        onChange={(e) =>
                          setFormUsuario({ ...formUsuario, deve_trocar_senha: e.target.checked })
                        }
                      />
                      <span>Exigir troca da senha no 1º acesso</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Matriz de Permissões por Setor (Accordions) */}
              <div>
                <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
                  {editandoUsuario ? '2. Permissões Individuais por Setor' : '3. Permissões Individuais por Setor'}
                </h3>
                <AccordionMatrizPermissoes
                  permissoes={formUsuario.permissoes}
                  nivel={formUsuario.nivel}
                  onChange={(nextPerms) =>
                    setFormUsuario((prev) => ({ ...prev, permissoes: nextPerms }))
                  }
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  padding: '16px 24px',
                  margin: '4px -24px -24px',
                  background: '#131d32',
                  borderTop: '1px solid #253654',
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 4,
                }}
              >
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setModalUsuarioAberto(false)}
                  disabled={salvandoUsuario}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={salvandoUsuario}
                >
                  <UserCheck size={16} />
                  {salvandoUsuario ? 'Salvando...' : editandoUsuario ? 'Salvar Alterações' : 'Cadastrar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL REDEFINIR SENHA */}
      {modalSenhaAberto && usuarioSenhaAlvo && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 9, 18, 0.86)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 9995,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              padding: 0,
              background: '#0d1424',
              border: '1px solid #33486e',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.88)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                background: '#131d32',
                borderBottom: '1px solid #253654',
              }}
            >
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc' }}>
                <KeyRound size={18} color="#f59e0b" />
                Redefinir Senha
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalSenhaAberto(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmarRedefinirSenha} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Usuário: <strong style={{ color: '#f8fafc' }}>{usuarioSenhaAlvo.nome}</strong> (<code>{usuarioSenhaAlvo.login}</code>)
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ margin: 0 }}>Nova Senha</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '4px 10px', fontSize: 11, background: '#131d32' }}
                      onClick={() => setNovaSenhaReset(gerarSenhaInicial(8))}
                    >
                      <RefreshCw size={12} /> Gerar
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '4px 10px', fontSize: 11, background: '#131d32' }}
                      onClick={() => copiarTexto(novaSenhaReset)}
                    >
                      <Copy size={12} /> Copiar
                    </button>
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-input font-mono"
                    type={mostrarSenhaReset ? 'text' : 'password'}
                    value={novaSenhaReset}
                    onChange={(e) => setNovaSenhaReset(e.target.value)}
                    style={{ width: '100%', padding: '10px 42px 10px 13px', background: '#131d32' }}
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarSenhaReset((v) => !v)}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: 4,
                    }}
                  >
                    {mostrarSenhaReset ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: '#131d32',
                  border: '1px solid #253654',
                }}
              >
                <CustomCheckbox
                  checked={exigirTrocaReset}
                  onChange={(e) => setExigirTrocaReset(e.target.checked)}
                />
                <span>Exigir troca da senha no próximo login</span>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setModalSenhaAberto(false)}
                  disabled={salvandoReset}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={salvandoReset}
                >
                  {salvandoReset ? 'Salvando...' : 'Confirmar Nova Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CRIAR / EDITAR PERFIL */}
      {modalPerfilAberto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 9, 18, 0.86)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 9992,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 920,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 0,
              background: '#0d1424',
              border: '1px solid #33486e',
              borderRadius: 16,
              boxShadow: '0 28px 72px rgba(0, 0, 0, 0.88)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '18px 24px',
                borderBottom: '1px solid #253654',
                background: '#131d32',
                position: 'sticky',
                top: 0,
                zIndex: 5,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
                {editandoPerfil ? `Editar Perfil — ${editandoPerfil.nome}` : 'Novo Perfil por Setor'}
              </h3>
              <button type="button" className="btn-icon" onClick={() => setModalPerfilAberto(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSalvarPerfil} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: '#131d32',
                  border: '1px solid #253654',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Nome do Perfil *</label>
                    <input
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      required
                      value={formPerfil.nome}
                      onChange={(e) => setFormPerfil({ ...formPerfil, nome: e.target.value })}
                      placeholder="Ex: Conferente Expedição"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Setor Padrão</label>
                    <select
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      value={formPerfil.setor_padrao}
                      onChange={(e) => setFormPerfil({ ...formPerfil, setor_padrao: e.target.value })}
                    >
                      {SETORES_EMPRESA.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nível Base</label>
                    <select
                      className="form-input"
                      style={{ padding: '10px 13px', background: '#0b1220' }}
                      value={formPerfil.nivel}
                      onChange={(e) => {
                        const nv = e.target.value
                        setFormPerfil((prev) => ({
                          ...prev,
                          nivel: nv,
                          permissoes: sanitizarPermissoes(prev.permissoes, nv, prev.codigo),
                        }))
                      }}
                    >
                      <option value="OPERACIONAL">OPERACIONAL</option>
                      <option value="CLIENTE">CLIENTE</option>
                      <option value="ADMINISTRADOR">ADMINISTRADOR</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Descrição</label>
                  <input
                    className="form-input"
                    style={{ padding: '10px 13px', background: '#0b1220' }}
                    value={formPerfil.descricao}
                    onChange={(e) => setFormPerfil({ ...formPerfil, descricao: e.target.value })}
                    placeholder="Descreva a finalidade deste perfil..."
                  />
                </div>
              </div>

              <AccordionMatrizPermissoes
                permissoes={formPerfil.permissoes}
                nivel={formPerfil.nivel}
                onChange={(nextPerms) => setFormPerfil((prev) => ({ ...prev, permissoes: nextPerms }))}
              />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  borderTop: '1px solid #253654',
                  padding: '16px 24px',
                  margin: '4px -24px -24px',
                  background: '#131d32',
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 4,
                }}
              >
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setModalPerfilAberto(false)}
                  disabled={salvandoPerfil}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary" disabled={salvandoPerfil}>
                  {salvandoPerfil ? 'Salvando...' : 'Salvar Perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalDialog
        isOpen={dialog.isOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        onClose={() => setDialog((d) => ({ ...d, isOpen: false }))}
      />
    </div>
  )
}
export default Operadores
