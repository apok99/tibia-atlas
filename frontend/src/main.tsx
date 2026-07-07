import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './i18n'
import './index.css'
import App from './App.tsx'
import { PlayerProvider } from './context/PlayerContext'
import { installImageFallback } from './lib/imageFallback'

installImageFallback()

// After a deploy the hashed chunk files change; a client holding the previous
// index.html gets a 404 when it lazily imports a route. Vite surfaces that as
// `vite:preloadError` — reload once to pick up the fresh index.html. The
// sessionStorage guard stops a reload loop if the server itself is broken.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'chunk-reload:' + window.location.pathname
  if (sessionStorage.getItem(key)) return // already retried; let the error surface
  sessionStorage.setItem(key, '1')
  event.preventDefault()
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </QueryClientProvider>
  </StrictMode>,
)
