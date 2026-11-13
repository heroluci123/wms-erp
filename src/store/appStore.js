import { create } from 'zustand'

const STORAGE_KEY = 'wmsphere_auth_session_v2'

function lerSessaoSalva() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return { operador: null, sessionToken: null }
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { operador: null, sessionToken: null }
    const parsed = JSON.parse(raw)
    if (!parsed?.operador || !parsed?.sessionToken) return { operador: null, sessionToken: null }
    return { operador: parsed.operador, sessionToken: parsed.sessionToken }
  } catch {
    return { operador: null, sessionToken: null }
  }
}

function salvarSessaoStorage(operador, sessionToken) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return
    if (operador && sessionToken) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ operador, sessionToken }))
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch { /* ignore storage errors */ }
}

const inicial = lerSessaoSalva()

/**
 * Store global da aplicação (Zustand)
 * Mantém: operador logado, sessionToken verificável no servidor, toast notifications
 */
export const useAppStore = create((set, get) => ({
  // ─── Operador / Sessão ──────────────────────────────────────────────────────
  operador: inicial.operador,
  sessionToken: inicial.sessionToken,

  setSessao: (operador, sessionToken) => {
    salvarSessaoStorage(operador, sessionToken)
    set({ operador, sessionToken })
  },

  setOperador: (operador) => {
    const tokenAtual = get().sessionToken
    salvarSessaoStorage(operador, tokenAtual)
    set({ operador })
  },

  logout: () => {
    salvarSessaoStorage(null, null)
    set({ operador: null, sessionToken: null })
  },

  // ─── Toasts ─────────────────────────────────────────────────────────────────
  toasts: [],
  addToast: ({ type = 'info', title, message, duration = 4000 }) => {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts, { id, type, title, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // ─── Helpers de Toast ───────────────────────────────────────────────────────
  toastSuccess: (title, message) => get().addToast({ type: 'success', title, message }),
  toastError:   (title, message) => get().addToast({ type: 'error',   title, message, duration: 6000 }),
  toastWarning: (title, message) => get().addToast({ type: 'warning', title, message, duration: 5000 }),
}))
