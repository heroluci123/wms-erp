import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Se o usuário estiver com aba aberta quando um novo deploy substituir chunks no Vercel,
// recarrega automaticamente uma única vez para buscar os hashes atualizados.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    const key = 'wms_preload_reload'
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      window.location.reload()
    }
  })

  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              reg.update().catch(() => {})
            }
          })
        })
        .catch(() => {})
    })
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
