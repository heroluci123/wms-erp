import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { Delete } from 'lucide-react'
import * as operadoresQueries from '../queries/operadores.js';

export function Login() {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const { setOperador, toastError } = useAppStore()
  const navigate = useNavigate()

  const handleKeyPress = (num) => {
    if (pin.length < 4) setPin(p => p + num)
  }

  const handleDelete = () => {
    setPin(p => p.slice(0, -1))
  }

  const handleLogin = async () => {
    if (pin.length !== 4) return
    setLoading(true)
    try {
      const res = await operadoresQueries.autenticar(pin)
      if (res.success) {
        setOperador(res.operador)
        navigate('/')
      } else {
        toastError('Acesso Negado', res.error)
        setPin('')
      }
    } catch (err) {
      toastError('Erro', 'Falha ao conectar com banco de dados')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  // Auto-login when 4 digits reached
  React.useEffect(() => {
    if (pin.length === 4) {
      handleLogin()
    }
  }, [pin])

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login__title">WMSphere - Tricarnes</h1>
        <p className="login-subtitle">Digite seu PIN de Operador</p>

        <div className="pin-display">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''}`} />
          ))}
        </div>

        <div className="pin-keyboard">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button key={num} className="pin-key" onClick={() => handleKeyPress(num.toString())}>
              {num}
            </button>
          ))}
          <button className="pin-key pin-key--delete" onClick={handleDelete}>
            <Delete size={20} />
          </button>
          <button className="pin-key" onClick={() => handleKeyPress('0')}>0</button>
          <button className="pin-key pin-key--enter" onClick={handleLogin} disabled={loading || pin.length < 4}>
            OK
          </button>
        </div>
      </div>
      
      {/* Botão escondido para criar gestor via API se precisar debug */}
      <div style={{ position: 'absolute', bottom: 10, opacity: 0.1, fontSize: 10 }}>
        PIN padrão de gestor: 0000
      </div>
    </div>
  )
}
