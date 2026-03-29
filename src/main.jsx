import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ThemeProvider from './components/ThemeProvider.jsx'
import { registerBackgroundSync } from './backgroundSync.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)

// Register service worker with background sync support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      console.log('Service Worker registered:', registration)

      // Check for Background Sync API support
      if ('sync' in registration) {
        console.log('Background Sync API available')
      }

      // Listen for sync completion messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_COMPLETE') {
          const syncEvent = new CustomEvent('sw-sync-complete', {
            detail: event.data.payload,
          })
          window.dispatchEvent(syncEvent)
        }
      })

      // Register background sync tasks
      await registerBackgroundSync(registration)
    } catch (error) {
      console.warn('Service Worker registration failed:', error)
    }
  })
}
