import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI)
    navigator.serviceWorker
      .register(swUrl, {
        scope: new URL('./', document.baseURI).pathname,
        updateViaCache: 'none',
      })
      .catch((error) => {
        console.warn('[wufeng] Service worker registration failed:', error)
      })
  })
}
