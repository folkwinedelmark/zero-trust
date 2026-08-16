import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { DebugProvider } from './debug/DebugContext.jsx'
import { NightTruceProvider } from './context/NightTruceContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <DebugProvider>
        <NightTruceProvider>
          <App />
        </NightTruceProvider>
      </DebugProvider>
    </AuthProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignora se il browser rifiuta il service worker */
    })
  })
}
