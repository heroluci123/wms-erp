/**
 * Cliente HTTP da API Backend central (Fase 0).
 * Sera ativado progressivamente nas queries quando VITE_API_URL estiver configurado.
 */
import { useAppStore } from '../store/appStore'

const API_BASE = (() => {
  try {
    return (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
  } catch {
    return ''
  }
})()

export function isApiEnabled() {
  return Boolean(API_BASE)
}

export function getApiBaseUrl() {
  return API_BASE
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
  if (!API_BASE) {
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
    throw new Error(data?.error || `Erro na API (${res.status})`)
  }
  return data
}
