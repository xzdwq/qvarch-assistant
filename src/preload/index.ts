import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { QaApi } from '../shared/api'
import { QA_ROUTES, type Route } from '../shared/ipc/routes'

/**
 * The window's bridge to the main process: `window.qa` built from the IPC contract (shared/ipc/routes) — a method
 * per route, crossing as the route says; the few local methods added by hand.
 */
function bridge(route: Route): (...args: unknown[]) => unknown {
  switch (route.kind) {
    case 'invoke':
      return (...args) => ipcRenderer.invoke(route.channel, ...args)
    case 'send':
      return (...args) => ipcRenderer.send(route.channel, ...args)
    case 'event':
      return (cb) => {
        const listener = (_e: unknown, ...args: unknown[]) => (cb as (...a: unknown[]) => void)(...args)
        ipcRenderer.on(route.channel, listener)
        return () => void ipcRenderer.off(route.channel, listener)
      }
  }
}

const routed = Object.fromEntries(Object.entries(QA_ROUTES).map(([name, route]) => [name, bridge(route)]))
const api = {
  ...routed,
  /** A dropped file's path on disk (the preload's own Electron API). */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
} as unknown as QaApi

contextBridge.exposeInMainWorld('qa', api)
