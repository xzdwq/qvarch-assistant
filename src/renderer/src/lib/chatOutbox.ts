import type { Outgoing } from '@shared/transport/chat'

/** Where the messages on their way are kept over a restart (this profile's window). */
const OUTBOX_KEY = 'qa.chat.outbox'

/** The messages on their way as kept (none, or not readable — none). */
export function readOutbox(): Outgoing[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((o): o is Outgoing => !!o && typeof o.room === 'string' && typeof o.clientId === 'string' && typeof o.text === 'string') : []
  } catch {
    return []
  }
}
export function keepOutbox(list: Outgoing[]): void {
  try {
    if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list))
    else localStorage.removeItem(OUTBOX_KEY)
  } catch {
    // (kept for this run only)
  }
}
