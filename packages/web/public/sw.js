// Network-first for everything except /api (never cached).
// Falls back to cache when offline, and to index.html for navigations.
// Bump this version on a release to evict the previous cache (the activate
// handler deletes every cache whose name isn't CACHE) so stale hashed chunks
// from earlier builds don't accumulate.
const CACHE = 'todoo-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        return res
      })
      .catch(async () => {
        const cached = await caches.match(event.request)
        if (cached) return cached
        // './' resolves against the SW's own URL, so this works at any base path
        if (event.request.mode === 'navigate') return caches.match(new URL('./index.html', self.location).href)
        return Response.error()
      })
  )
})
