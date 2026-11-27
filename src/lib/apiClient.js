/**
 * Cliente HTTP da API Backend central (Fase 0).
 * Sera ativado progressivamente nas queries quando VITE_API_URL estiver configurado.
 */
import { useAppStore } from '../store/appStore'

const RAW_ENV_API = (() => {
  try {
    return (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
  } catch {
    return ''
  }
})()

// Se estiver rodando no servidor local Vite (localhost ou IP de Wi-Fi local ex: 192.168.x.x:5173)
// apontando para localhost:3333, quando aberto pelo celular no Wi-Fi usa o proxy /api do próprio Vite!
const IS_LAN_DEV_PROXY =
  typeof window !== 'undefined' &&
  /^https?:\/\/(localhost|127\.0\.0\.1):3333$/i.test(RAW_ENV_API) &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1'

const API_BASE = IS_LAN_DEV_PROXY ? '' : RAW_ENV_API

export function isApiEnabled() {
  return Boolean(RAW_ENV_API)
}

export function getApiBaseUrl() {
  return API_BASE
}

export function isAmbienteTesteLocal() {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname || ''
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h.includes('-homolog') ||
    h.includes('-teste')
  )
}

export function buildQueryString(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      qs.set(k, String(v))
    }
  }
  const str = qs.toString()
  return str ? `?${str}` : ''
}

export async function apiRequest(path, { method = 'GET', body, tokenOverride, skipAuth = false } = {}) {
  if (!RAW_ENV_API) {
    throw new Error('VITE_API_URL nao configurada para este ambiente.')
  }

  const state = useAppStore.getState()
  const token = skipAuth ? null : tokenOverride || state.jwtToken || state.sessionToken

  const headers = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (!skipAuth && state.filialAtivaId && !path.startsWith('/api/auth/')) {
    headers['x-filial-id'] = state.filialAtivaId
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (!skipAuth && res.status === 401 && state.operador) {
      state.logout()
    }
    const err = new Error(data?.error || `Erro na API (${res.status})`)
    err.status = res.status
    err.code = data?.code
    err.data = data
    throw err
  }
  return data
}
