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

// Focus an open tab when a due-date reminder is tapped, or open one if the app
// isn't running. Reminders are scheduled in the page (see ReminderScheduler);
// this only handles the click, so there is still no push server involved.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const home = new URL('./', self.location).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow ? self.clients.openWindow(home) : undefined
    })
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
