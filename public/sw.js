const CACHE_NAME = 'wmsphere-pwa-v4'
const STATIC_ASSETS = ['/', '/manifest.json', '/icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Network-first para páginas/chunks JS (sempre pega deploy novo), com fallback de cache se offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && (req.destination === 'image' || req.destination === 'style' || req.destination === 'script' || req.destination === 'document')) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/'))),
  )
})
