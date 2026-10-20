/// <reference types="vite/client" />
import type { QaApi } from '../shared/api'

declare global {
  /** The app's version (from package.json, at build time). */
  const __APP_VERSION__: string
  interface Window {
    qa: QaApi
  }
}

