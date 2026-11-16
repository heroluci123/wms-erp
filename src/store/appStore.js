import { create } from 'zustand'

const STORAGE_KEY = 'wmsphere_auth_session_v2'
const FILIAL_KEY = 'wmsphere_filial_ativa_v1'

function lerFilialSalva() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return ''
    return window.sessionStorage.getItem(FILIAL_KEY) || ''
  } catch {
    return ''
  }
}

function salvarFilialStorage(filialId) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return
    if (filialId) window.sessionStorage.setItem(FILIAL_KEY, String(filialId))
    else window.sessionStorage.removeItem(FILIAL_KEY)
  } catch { /* ignore */ }
}

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
  filialAtivaId: lerFilialSalva() || inicial.operador?.filialId || '',
  filiaisDisponiveis: [],

  setSessao: (operador, sessionToken) => {
    salvarSessaoStorage(operador, sessionToken)
    const nextFilial = get().filialAtivaId || operador?.filialId || ''
    salvarFilialStorage(nextFilial)
    set({ operador, sessionToken, filialAtivaId: nextFilial })
  },

  setOperador: (operador) => {
    const tokenAtual = get().sessionToken
    salvarSessaoStorage(operador, tokenAtual)
    const nextFilial = get().filialAtivaId || operador?.filialId || ''
    set({ operador, filialAtivaId: nextFilial })
  },

  setFilialAtiva: (filialId) => {
    const val = String(filialId || '')
    salvarFilialStorage(val)
    set({ filialAtivaId: val })
  },

  setFiliaisDisponiveis: (filiais) => {
    const lista = Array.isArray(filiais) ? filiais : []
    const atual = get().filialAtivaId
    const aindaExiste = lista.some((f) => String(f.id) === String(atual))
    if (!aindaExiste && lista.length > 0) {
      const padrao = lista.find((f) => Number(f.is_padrao) === 1) || lista[0]
      salvarFilialStorage(padrao.id)
      set({ filiaisDisponiveis: lista, filialAtivaId: padrao.id })
    } else {
      set({ filiaisDisponiveis: lista })
    }
  },

  logout: () => {
    salvarSessaoStorage(null, null)
    salvarFilialStorage('')
    set({ operador: null, sessionToken: null, filialAtivaId: '', filiaisDisponiveis: [] })
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

  // ─── Diálogo Global de Confirmação (substitui window.confirm nativo) ──────
  confirmState: null,
  confirmar: ({
    title = 'Confirmação',
    message = '',
    type = 'confirm',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
  }) =>
    new Promise((resolve) => {
      const prev = get().confirmState
      if (prev?.resolve) prev.resolve(false)
      set({
        confirmState: { title, message, type, confirmLabel, cancelLabel, resolve },
      })
    }),
  responderConfirmacao: (aceito) => {
    const atual = get().confirmState
    set({ confirmState: null })
    if (atual?.resolve) atual.resolve(Boolean(aceito))
  },
}))
