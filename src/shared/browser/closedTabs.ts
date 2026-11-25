import type { Visit } from './tabs'

/** How many closed tabs are kept (Ctrl+Shift+T, «Недавно закрытые» in the history). */
export const CLOSED_KEEP = 20

/** Where a tab stood when it was closed: its pane and its place there (it opens again there when it can). */
export interface ClosedPlace {
  pane: number
  index: number
}
/** A tab the person closed: its page (as a history row — id, address, title, when) and where it stood. */
export interface ClosedTab extends Visit, Partial<ClosedPlace> {
  favicon?: string
}

/** The list with a tab closed now: newest first, the oldest beyond the limit dropped. */
export function withClosed(list: readonly ClosedTab[], tab: ClosedTab): ClosedTab[] {
  return [tab, ...list].slice(0, CLOSED_KEEP)
}

/** One taken to open again: that one (none named — the last closed) and the list without it. */
export function takeClosed(list: readonly ClosedTab[], id?: string): { tab?: ClosedTab; rest: ClosedTab[] } {
  const i = id === undefined ? 0 : list.findIndex((c) => c.id === id)
  if (i < 0 || i >= list.length) return { rest: [...list] }
  return { tab: list[i], rest: list.filter((_, k) => k !== i) }
}

const isPlace = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0
/** The list as written (anything broken dropped, the limit kept). */
export function cleanClosed(raw: unknown): ClosedTab[] {
  if (!Array.isArray(raw)) return []
  const out: ClosedTab[] = []
  for (const c of raw as Array<Partial<ClosedTab> | null>) {
    if (!c || typeof c.id !== 'string' || typeof c.url !== 'string' || typeof c.at !== 'number') continue
    out.push({
      id: c.id,
      url: c.url,
      title: typeof c.title === 'string' ? c.title : '',
      at: c.at,
      ...(isPlace(c.pane) && isPlace(c.index) ? { pane: c.pane, index: c.index } : {}),
      ...(typeof c.favicon === 'string' && c.favicon.startsWith('data:image/') ? { favicon: c.favicon } : {}),
    })
  }
  return out.slice(0, CLOSED_KEEP)
}
