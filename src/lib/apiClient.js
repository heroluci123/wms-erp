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

export async function apiRequest(path, { method = 'GET', body, tokenOverride } = {}) {
  if (!API_BASE) {
    throw new Error('VITE_API_URL nao configurada para este ambiente.')
  }

  const state = useAppStore.getState()
  const token = tokenOverride || state.jwtToken || state.sessionToken

  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && state.operador) {
      state.logout()
    }
    throw new Error(data?.error || `Erro na API (${res.status})`)
  }
  return data
}
