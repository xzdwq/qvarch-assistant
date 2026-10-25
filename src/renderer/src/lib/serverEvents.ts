import type { TransportEvent } from '@shared/transport/protocol'

/** An event's name and its payload by name. */
export type ServerEventName = TransportEvent['e']
export type ServerEventOf<K extends ServerEventName> = Extract<TransportEvent, { e: K }>['p']
/** What a context does with the events it cares about (the others are not its business). */
export type ServerEventHandlers = { [K in ServerEventName]?: (p: ServerEventOf<K>) => void }

/**
 * The transport server's events in this window: one subscription, each context registering only its own handlers
 * (the chat — its messages, the shared documents — their updates…). A handler's error stays its own.
 */
const handlers = new Map<ServerEventName, Set<(p: unknown) => void>>()
let subscribed = false

function dispatch(ev: TransportEvent): void {
  for (const fn of handlers.get(ev.e) ?? []) {
    try {
      fn(ev.p)
    } catch (e) {
      console.error(`${ev.e}:`, e)
    }
  }
}

/** A context's handlers registered (the unsubscribe returned). */
export function onServerEvents(table: ServerEventHandlers): () => void {
  if (!subscribed) {
    subscribed = true
    window.qa.onServer(dispatch)
  }
  const added = Object.entries(table) as Array<[ServerEventName, (p: unknown) => void]>
  for (const [e, fn] of added) (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(fn)
  return () => added.forEach(([e, fn]) => handlers.get(e)?.delete(fn))
}
