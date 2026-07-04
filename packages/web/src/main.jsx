import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { isStandalone } from './api/client.js'

// Self-hosted fonts — no Google Fonts CDN, so the standalone build makes no
// third-party request and works fully offline. Variable families cover the
// Latin + Thai UI (weight ranges). The two Japanese families are only used by
// the 和 theme for a handful of decorative glyphs, so they are hand-subset to
// those glyphs (see src/fonts/japanese.css) rather than shipping full CJK.
import '@fontsource-variable/fraunces/standard.css'
import '@fontsource-variable/fraunces/standard-italic.css'
import '@fontsource-variable/schibsted-grotesk/index.css'
import '@fontsource-variable/noto-sans-thai/index.css'
import './fonts/japanese.css'

import './index.css'

// In standalone mode the user's data lives in browser storage — ask the
// browser to never evict it (Safari can otherwise clear storage for sites
// not visited in a while). Best-effort: a no-op where unsupported.
if (isStandalone && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {})
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)

// No service worker inside the native app: Capacitor serves assets from the
// app bundle (custom scheme), so there is nothing to cache and SW registration
// can fail on capacitor://.
if (
  'serviceWorker' in navigator &&
  import.meta.env.PROD &&
  !window.Capacitor?.isNativePlatform?.()
) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  )
}
