/**
 * The browsers of the notes on the screen, by note and name: the page each shows now (its webContents) — where a
 * Playwright block of the note runs (browser=qvarch in=…) or records. A note open twice (two panes) has its
 * browser twice: the one shown last answers.
 */
const shown = new Map<string, Array<() => number | undefined>>()
const keyOf = (note: string, name: string) => `${note}\n${name}`

/** A browser block on the screen: its page told on asking; given up by what this returns. */
export function holdNoteBrowser(note: string, name: string, page: () => number | undefined): () => void {
  const k = keyOf(note, name)
  shown.set(k, [...(shown.get(k) ?? []), page])
  return () => {
    const left = (shown.get(k) ?? []).filter((x) => x !== page)
    if (left.length) shown.set(k, left)
    else shown.delete(k)
  }
}
/** The page a note's browser shows now (none — not on the screen, or nothing loaded in it yet). */
export function noteBrowserPage(note: string, name: string): number | undefined {
  const list = shown.get(keyOf(note, name))
  for (let i = (list?.length ?? 0) - 1; i >= 0; i--) {
    const wc = list![i]()
    if (wc !== undefined) return wc
  }
  return undefined
}
