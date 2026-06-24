import { create } from 'zustand'

/**
 * Store global da aplicação (Zustand)
 * Mantém: operador logado, toast notifications, estado do app
 */
export const useAppStore = create((set, get) => ({
  // ─── Operador / Sessão ──────────────────────────────────────────────────────
  operador: null,
  setOperador: (operador) => set({ operador }),
  logout: () => set({ operador: null }),

  // ─── Toasts ─────────────────────────────────────────────────────────────────
  toasts: [],
  addToast: ({ type = 'info', title, message, duration = 4000 }) => {
    const id = Date.now()
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
