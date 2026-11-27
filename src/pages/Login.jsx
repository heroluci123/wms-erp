import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  User,
} from 'lucide-react'
import { operadoresQueries } from '../queries/operadores'
import { useAppStore } from '../store/appStore'
import { isCliente } from '../utils/permissoes'

export function Login() {
  const navigate = useNavigate()
  const { operador, sessionToken, setSessao, setFiliaisDisponiveis, setFilialAtiva, logout, toastSuccess, toastError } = useAppStore()

  const [loginInput, setLoginInput] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  // Estado para troca obrigatória de senha no primeiro acesso
  const [trocaObrigatoria, setTrocaObrigatoria] = useState(false)
  const [senhaAtualTroca, setSenhaAtualTroca] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false)
  const [salvandoSenha, setSalvandoSenha] = useState(false)
  const [erroTroca, setErroTroca] = useState('')

  useEffect(() => {
    if (operador && operador.deve_trocar_senha === 1) {
      setTrocaObrigatoria(true)
      return
    }
    if (operador && !trocaObrigatoria) {
      navigate(isCliente(operador) ? '/portal-cliente' : '/', { replace: true })
    }
  }, [operador, trocaObrigatoria, navigate])

  const handleLogin = async (e) => {
    e.preventDefault()
    setErro('')

    const loginLimpo = loginInput.trim()
    if (!loginLimpo) {
      setErro('Informe o usuário (login).')
      return
    }
    if (!senha) {
      setErro('Informe sua senha.')
      return
    }

    setLoading(true)
    try {
      const res = await operadoresQueries.autenticarComSenha(loginLimpo, senha)
      if (!res?.success) {
        throw new Error(res?.error || 'Usuário ou senha inválidos.')
      }
      const op = res?.operador
      const token = res?.token || res?.sessionToken
      if (!op || !token) {
        throw new Error('Falha ao iniciar sessão do usuário.')
      }

      setSessao(op, token)
      if (Array.isArray(res?.contexto?.filiais) && res.contexto.filiais.length > 0) {
        setFiliaisDisponiveis(res.contexto.filiais)
        setFilialAtiva(res.contexto.filial_id || res.contexto.filiais[0].id)
      }

      if (Number(op.deve_trocar_senha) === 1) {
        setSenhaAtualTroca(senha)
        setTrocaObrigatoria(true)
        setErroTroca('')
        toastSuccess(`Bem-vindo, ${op.nome}! Defina uma nova senha pessoal para continuar.`)
        return
      }

      toastSuccess(`Bem-vindo, ${op.nome}!`)
      navigate(isCliente(op) ? '/portal-cliente' : '/', { replace: true })
    } catch (err) {
      const msg = err?.message || 'Usuário ou senha inválidos.'
      setErro(msg)
      toastError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleTrocarSenhaObrigatoria = async (e) => {
    e.preventDefault()
    setErroTroca('')

    if (!senhaAtualTroca) {
      setErroTroca('Informe sua senha inicial/atual.')
      return
    }
    if (!novaSenha || novaSenha.length < 4) {
      setErroTroca('A nova senha deve ter pelo menos 4 caracteres.')
      return
    }
    if (novaSenha === senhaAtualTroca) {
      setErroTroca('A nova senha deve ser diferente da senha inicial.')
      return
    }
    if (novaSenha !== confirmarSenha) {
      setErroTroca('A confirmação da nova senha não confere.')
      return
    }

    setSalvandoSenha(true)
    try {
      const resTroca = await operadoresQueries.trocarPropriaSenha({
        senhaAtual: senhaAtualTroca,
        novaSenha,
      })
      const atualizado = resTroca?.operador || (resTroca?.id ? resTroca : { ...operador, deve_trocar_senha: 0 })
      setSessao({ ...atualizado, deve_trocar_senha: 0 }, resTroca?.sessionToken || sessionToken)
      toastSuccess('Senha alterada com sucesso! Acesso liberado.')
      setTrocaObrigatoria(false)
      navigate(isCliente(atualizado) ? '/portal-cliente' : '/', { replace: true })
    } catch (err) {
      const msg = err?.message || 'Não foi possível atualizar a senha.'
      setErroTroca(msg)
      toastError(msg)
    } finally {
      setSalvandoSenha(false)
    }
  }

  const handleCancelarTroca = async () => {
    try {
      if (sessionToken) {
        await operadoresQueries.encerrarSessao(sessionToken)
      }
    } catch {
      // ignora erro no cancelamento
    }
    logout()
    setTrocaObrigatoria(false)
    setSenhaAtualTroca('')
    setNovaSenha('')
    setConfirmarSenha('')
    setSenha('')
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at top, #10203a 0%, #09101d 55%, #060b14 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'rgba(15, 23, 42, 0.92)',
          border: '1px solid rgba(59, 130, 246, 0.22)',
          borderRadius: 18,
          padding: '28px 22px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Cabeçalho / Marca */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
              boxShadow: '0 8px 24px rgba(37, 99, 235, 0.35)',
            }}
          >
            {trocaObrigatoria ? (
              <KeyRound size={28} color="#fff" />
            ) : (
              <ShieldCheck size={28} color="#fff" />
            )}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: '#f8fafc',
              letterSpacing: '-0.02em',
            }}
          >
            WMSphere ERP
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8' }}>
            {trocaObrigatoria
              ? 'Primeiro Acesso — Defina sua nova senha pessoal'
              : 'Tricarnes Alimentos • Autenticação Individual de Acesso'}
          </p>
        </div>

        {!trocaObrigatoria ? (
          <form onSubmit={handleLogin} noValidate>
            {erro && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#fecaca',
                  fontSize: 13,
                  marginBottom: 18,
                  lineHeight: 1.4,
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1, color: '#f87171' }} />
                <span>{erro}</span>
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label
                htmlFor="login-usuario"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 7,
                }}
              >
                Usuário (Login)
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={17}
                  style={{
                    position: 'absolute',
                    left: 13,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#64748b',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="login-usuario"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  placeholder="Digite seu usuário..."
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 40px',
                    borderRadius: 10,
                    background: '#0b1220',
                    border: '1px solid #26354f',
                    color: '#f8fafc',
                    fontSize: 15,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 22 }}>
              <label
                htmlFor="login-senha"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 7,
                }}
              >
                Senha
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={17}
                  style={{
                    position: 'absolute',
                    left: 13,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#64748b',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="login-senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Digite sua senha..."
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 40px',
                    borderRadius: 10,
                    background: '#0b1220',
                    border: '1px solid #26354f',
                    color: '#f8fafc',
                    fontSize: 15,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  title={mostrarSenha ? 'Ocultar senha' : 'Visualizar senha'}
                  aria-label={mostrarSenha ? 'Ocultar senha' : 'Visualizar senha'}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn--primary"
              style={{
                width: '100%',
                padding: '13px 18px',
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <LogIn size={18} />
              {loading ? 'Validando credenciais...' : 'Entrar no Sistema'}
            </button>

            <div
              style={{
                marginTop: 18,
                paddingTop: 14,
                borderTop: '1px solid rgba(148, 163, 184, 0.14)',
                fontSize: 12,
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              Acesso protegido por usuário, senha criptografada e controle de sessão.
            </div>
          </form>
        ) : (
          <form onSubmit={handleTrocarSenhaObrigatoria} noValidate>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#fde68a',
                fontSize: 13,
                lineHeight: 1.45,
                marginBottom: 18,
              }}
            >
              Olá, <strong>{operador?.nome}</strong>! Por segurança, a senha inicial precisa ser alterada antes de acessar o sistema.
            </div>

            {erroTroca && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '11px 13px',
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  color: '#fecaca',
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1, color: '#f87171' }} />
                <span>{erroTroca}</span>
              </div>
            )}

            {!senha && (
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#cbd5e1',
                    marginBottom: 6,
                  }}
                >
                  Senha Inicial / Atual
                </label>
                <input
                  type={mostrarNovaSenha ? 'text' : 'password'}
                  value={senhaAtualTroca}
                  onChange={(e) => setSenhaAtualTroca(e.target.value)}
                  placeholder="Digite a senha inicial"
                  disabled={salvandoSenha}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: 10,
                    background: '#0b1220',
                    border: '1px solid #26354f',
                    color: '#f8fafc',
                    fontSize: 14,
                  }}
                />
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label
                htmlFor="nova-senha"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#cbd5e1',
                  marginBottom: 6,
                }}
              >
                Nova Senha (mín. 4 caracteres)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="nova-senha"
                  type={mostrarNovaSenha ? 'text' : 'password'}
                  autoFocus
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Crie uma nova senha..."
                  disabled={salvandoSenha}
                  style={{
                    width: '100%',
                    padding: '11px 42px 11px 14px',
                    borderRadius: 10,
                    background: '#0b1220',
                    border: '1px solid #26354f',
                    color: '#f8fafc',
                    fontSize: 14,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setMostrarNovaSenha((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  {mostrarNovaSenha ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label
                htmlFor="confirmar-nova-senha"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#cbd5e1',
                  marginBottom: 6,
                }}
              >
                Confirmar Nova Senha
              </label>
              <input
                id="confirmar-nova-senha"
                type={mostrarNovaSenha ? 'text' : 'password'}
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha..."
                disabled={salvandoSenha}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: 10,
                  background: '#0b1220',
                  border: '1px solid #26354f',
                  color: '#f8fafc',
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleCancelarTroca}
                disabled={salvandoSenha}
                style={{ flex: 1 }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={salvandoSenha}
                style={{
                  flex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontWeight: 700,
                }}
              >
                <CheckCircle2 size={17} />
                {salvandoSenha ? 'Salvando...' : 'Confirmar Nova Senha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default Login
