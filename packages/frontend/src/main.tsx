import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { rememberedNetwork } from './network'

// On a bare root visit, return the user to their last-used network (default
// mainnet). Shared deep links keep their own network and are never redirected.
if (window.location.pathname === '/' && rememberedNetwork() === 'testnet') {
  window.location.replace('/testnet')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
