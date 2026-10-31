/**
 * What a Playwright run leaves on a page of the app's own browser, and how it is taken back. The page's DevTools
 * protocol is shared (the requests' list, the device mode, the page told it is Chrome) and outlives the run: each
 * setting the run made is undone when it ends — else the tab would stay emulated, its file picker intercepted, its
 * new iframes paused for a debugger that is gone.
 */

/** A protocol command (to the page's own session). */
export interface CdpCommand {
  method: string
  params?: Record<string, unknown>
}
type Params = Record<string, any>

/** Each setting's undo: the command that takes it back (none — the command left nothing to undo). */
const UNDO: Record<string, (params: Params, result: Params) => CdpCommand | undefined> = {
  'Emulation.setDeviceMetricsOverride': () => ({ method: 'Emulation.clearDeviceMetricsOverride' }),
  'Emulation.setFocusEmulationEnabled': (p) => (p.enabled ? { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: false } } : undefined),
  'Emulation.setTouchEmulationEnabled': (p) => (p.enabled ? { method: 'Emulation.setTouchEmulationEnabled', params: { enabled: false } } : undefined),
  'Emulation.setEmitTouchEventsForMouse': (p) => (p.enabled ? { method: 'Emulation.setEmitTouchEventsForMouse', params: { enabled: false } } : undefined),
  'Emulation.setEmulatedMedia': () => ({ method: 'Emulation.setEmulatedMedia', params: { media: '', features: [] } }),
  'Emulation.setGeolocationOverride': () => ({ method: 'Emulation.clearGeolocationOverride' }),
  'Emulation.setScriptExecutionDisabled': (p) => (p.value ? { method: 'Emulation.setScriptExecutionDisabled', params: { value: false } } : undefined),
  'Emulation.setCPUThrottlingRate': () => ({ method: 'Emulation.setCPUThrottlingRate', params: { rate: 1 } }),
  'Emulation.setTimezoneOverride': () => ({ method: 'Emulation.setTimezoneOverride', params: { timezoneId: '' } }),
  'Emulation.setLocaleOverride': () => ({ method: 'Emulation.setLocaleOverride', params: {} }),
  'Emulation.setDefaultBackgroundColorOverride': () => ({ method: 'Emulation.setDefaultBackgroundColorOverride', params: {} }),
  'Page.addScriptToEvaluateOnNewDocument': (_p, r) => (r?.identifier ? { method: 'Page.removeScriptToEvaluateOnNewDocument', params: { identifier: r.identifier } } : undefined),
  'Page.setInterceptFileChooserDialog': (p) => (p.enabled ? { method: 'Page.setInterceptFileChooserDialog', params: { enabled: false } } : undefined),
  'Page.setBypassCSP': (p) => (p.enabled ? { method: 'Page.setBypassCSP', params: { enabled: false } } : undefined),
  'Page.startScreencast': () => ({ method: 'Page.stopScreencast' }),
  'Runtime.addBinding': (p) => (p.name ? { method: 'Runtime.removeBinding', params: { name: p.name } } : undefined),
  'Network.setExtraHTTPHeaders': () => ({ method: 'Network.setExtraHTTPHeaders', params: { headers: {} } }),
  'Network.setCacheDisabled': (p) => (p.cacheDisabled ? { method: 'Network.setCacheDisabled', params: { cacheDisabled: false } } : undefined),
  'Network.setBypassServiceWorker': (p) => (p.bypass ? { method: 'Network.setBypassServiceWorker', params: { bypass: false } } : undefined),
  'Network.emulateNetworkConditions': () => ({ method: 'Network.emulateNetworkConditions', params: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 } }),
  'Network.setBlockedURLs': () => ({ method: 'Network.setBlockedURLs', params: { urls: [] } }),
  'Fetch.enable': () => ({ method: 'Fetch.disable' }),
  'Security.setIgnoreCertificateErrors': (p) => (p.ignore ? { method: 'Security.setIgnoreCertificateErrors', params: { ignore: false } } : undefined),
  // the page's iframes and workers attached (and paused at their start) for the run — no more
  'Target.setAutoAttach': (p) => (p.autoAttach ? { method: 'Target.setAutoAttach', params: { autoAttach: false, waitForDebuggerOnStart: false, flatten: true } } : undefined),
}

/**
 * The undos of the settings a run made, as it made them: taken back in the reverse order, each one once (a setting
 * made ten times is undone once).
 */
export class CdpUndoLog {
  private list: CdpCommand[] = []

  /** A command the page took: its undo noted (if it leaves anything). */
  note(method: string, params: Params | undefined, result: Params | undefined): void {
    const undo = Object.hasOwn(UNDO, method) ? UNDO[method](params ?? {}, result ?? {}) : undefined
    if (undo) this.list.push(undo)
  }
  /** The undos to send, last made first, without repeats. */
  drain(): CdpCommand[] {
    const seen = new Set<string>()
    const out: CdpCommand[] = []
    for (const c of this.list.reverse()) {
      const key = `${c.method} ${JSON.stringify(c.params ?? {})}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
    }
    this.list = []
    return out
  }
}
