import type { Input, WebContents } from 'electron'

/** A key pressed in a page, as the rules read it. */
export interface PageKey {
  /** The key as Chromium names it (F5, ArrowLeft…). */
  key: string
  /** Lower-cased. */
  k: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** The key's place, whatever the layout (Backquote — ` / Ё). */
  code?: string
}
/** What a page's key may do: the tab's navigation and zoom, its tools, and the section's own keys (sent to the window). */
export interface PageKeyActions {
  nav(action: 'back' | 'fwd' | 'reload' | 'hard' | 'devtools'): void
  zoomBy(step: number): void
  zoomReset(): void
  /** A key the window handles (a new tab, the address line…). */
  send(key: 'newTab' | 'reopenTab' | 'closeTab' | 'focusUrl' | 'bookmark' | 'device' | 'history' | 'terminal'): void
  save(): void
  viewSource(): void
  print(): void
}
/** The keys of a page that are the browser's, not the page's: the first rule that matches takes the key. */
const PAGE_KEYS: Array<{ when: (i: PageKey) => boolean; run: (a: PageKeyActions, i: PageKey) => void }> = [
  // F5 / Ctrl+R — reload; Ctrl+F5 / Ctrl+Shift+R — without the cache
  { when: (i) => i.key === 'F5' || (i.ctrl && i.k === 'r'), run: (a, i) => a.nav((i.key === 'F5' && i.ctrl) || (i.k === 'r' && i.shift) ? 'hard' : 'reload') },
  { when: (i) => i.key === 'F12', run: (a) => a.nav('devtools') },
  { when: (i) => i.alt && i.key === 'ArrowLeft', run: (a) => a.nav('back') },
  { when: (i) => i.alt && i.key === 'ArrowRight', run: (a) => a.nav('fwd') },
  { when: (i) => i.ctrl && (i.k === '=' || i.k === '+'), run: (a) => a.zoomBy(10) },
  { when: (i) => i.ctrl && i.k === '-', run: (a) => a.zoomBy(-10) },
  { when: (i) => i.ctrl && i.k === '0', run: (a) => a.zoomReset() },
  // Ctrl+` — the terminal's panel (the app's key, from a page too)
  { when: (i) => i.ctrl && !i.alt && i.code === 'Backquote', run: (a) => a.send('terminal') },
  { when: (i) => i.ctrl && i.shift && i.k === 't', run: (a) => a.send('reopenTab') },
  { when: (i) => i.ctrl && i.k === 't', run: (a) => a.send('newTab') },
  { when: (i) => i.ctrl && i.k === 'w', run: (a) => a.send('closeTab') },
  { when: (i) => i.ctrl && i.k === 'l', run: (a) => a.send('focusUrl') },
  { when: (i) => i.ctrl && i.k === 'd', run: (a) => a.send('bookmark') },
  { when: (i) => i.ctrl && i.k === 's', run: (a) => a.save() },
  { when: (i) => i.ctrl && i.k === 'u', run: (a) => a.viewSource() },
  { when: (i) => i.ctrl && i.k === 'p', run: (a) => a.print() },
  { when: (i) => i.ctrl && i.shift && i.k === 'i', run: (a) => a.nav('devtools') },
  { when: (i) => i.ctrl && i.shift && i.k === 'm', run: (a) => a.send('device') },
  { when: (i) => i.ctrl && i.k === 'h', run: (a) => a.send('history') },
]

/** What a key does in a page — none: the key is the page's own. */
export function pageKeyAction(i: PageKey): ((a: PageKeyActions) => void) | undefined {
  const rule = PAGE_KEYS.find((r) => r.when(i))
  return rule && ((a) => rule.run(a, i))
}
/** A page's keys that are the browser's: taken from the page (it never sees them) and done. */
export function handlePageKeys(wc: WebContents, actions: PageKeyActions): void {
  wc.on('before-input-event', (e, input: Input) => {
    if (input.type !== 'keyDown') return
    const run = pageKeyAction({ key: input.key, k: input.key.toLowerCase(), ctrl: input.control || input.meta, shift: input.shift, alt: input.alt, code: input.code })
    if (!run) return
    e.preventDefault()
    // (a key held: done once — a held Ctrl+W must not close tab after tab)
    if (!input.isAutoRepeat) run(actions)
  })
}
