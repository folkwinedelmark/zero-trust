/**
 * ZERO TRUST — Debug / God Mode (temporaneo)
 * ---------------------------------------------------------------------------
 * Per rimuovere in produzione:
 * 1. Elimina la cartella `src/debug/`
 * 2. Togli <DebugProvider> da main.jsx
 * 3. Togli <DebugPanel /> da GameHeader.jsx
 * 4. Togli gli import/uso di useDebug in NodeView / HelpdeskView
 * ---------------------------------------------------------------------------
 */

/** Mostra God Mode solo in `vite` locale. Assente sul build Vercel. */
export const DEBUG_UI_ENABLED = import.meta.env.DEV

export const DEBUG_CREDIT_BOOST = 1000
export const DEBUG_STORAGE_KEY = 'zt-debug-mode'
