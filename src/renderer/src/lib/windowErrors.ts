import type { App } from 'vue'
import { remoteError } from '@shared/remoteError'

/**
 * A window's errors nobody caught (a call to the main process not awaited, a component's handler): logged with
 * where they came from, never lost without a trace.
 */
export function catchWindowErrors(app: App, name: string): void {
  app.config.errorHandler = (e, _vm, info) => console.error(`[${name}] ${info}:`, remoteError(e), e)
  window.addEventListener('unhandledrejection', (ev) => console.error(`[${name}] unhandled:`, remoteError(ev.reason), ev.reason))
}
