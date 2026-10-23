import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { QaApi } from '../../shared/api'
import { QA_ROUTES, type EventArgs, type EventMethod, type InvokeMethod, type SendMethod } from '../../shared/ipc/routes'

/**
 * The main process's side of the IPC contract: handlers registered by a QaApi method's name (their arguments and
 * answers typed by QaApi — a mismatch is a compile error), events sent to a window by name.
 */

/** A window's question (invoke) answered: `fn` gets the method's arguments, returns its answer (or a promise of it). */
export function handle<K extends InvokeMethod>(name: K, fn: (e: IpcMainInvokeEvent, ...args: Parameters<QaApi[K]>) => Awaited<ReturnType<QaApi[K]>> | ReturnType<QaApi[K]>): void {
  ipcMain.handle(QA_ROUTES[name].channel, fn as (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
}
/** A window's message (send, no answer) listened to. */
export function listen<K extends SendMethod>(name: K, fn: (e: IpcMainEvent, ...args: Parameters<QaApi[K]>) => void): void {
  ipcMain.on(QA_ROUTES[name].channel, fn as (e: IpcMainEvent, ...args: unknown[]) => void)
}
/** An event sent to a window (a closed / missing one — nothing is sent). */
export function emit<K extends EventMethod>(to: WebContents | undefined | null, name: K, ...args: EventArgs<K>): void {
  if (to && !to.isDestroyed()) to.send(QA_ROUTES[name].channel, ...args)
}
/**
 * A service whose methods the window calls by name through one method (`browser('open', url)`): only the listed
 * methods, on the service as it is when called (made on first use).
 */
export function handleDispatch<K extends InvokeMethod>(name: K, methods: readonly string[], service: () => object): void {
  ipcMain.handle(QA_ROUTES[name].channel, (_e, m: string, ...a: unknown[]) => {
    if (!methods.includes(m)) throw new Error(`${name}: нет метода ${m}`)
    const target = service() as Record<string, (...x: unknown[]) => unknown>
    return target[m].apply(target, a)
  })
}
