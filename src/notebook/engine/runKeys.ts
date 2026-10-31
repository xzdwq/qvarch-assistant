/**
 * A block's results moved to a key of its own while its run went on (it got its id meanwhile — an agent wrote the
 * block, the editor gave it one): the run started under the old key goes on writing where its results are now, and
 * is stopped from there — its process goes by the key it started with. Kept while the run goes on (this window only).
 */
const moved = new Map<string, { to: Map<string, string>; from: Map<string, string> }>()
const of = (path: string) => {
  let m = moved.get(path)
  if (!m) moved.set(path, (m = { to: new Map(), from: new Map() }))
  return m
}

/** A run going on moved from one key to another (the note's own runs). */
export function runMoved(path: string, from: string, to: string): void {
  const m = of(path)
  // (moved twice: from the key it started with)
  const start = m.from.get(from) ?? from
  m.to.set(start, to)
  m.from.set(to, start)
}
/** Where a run started under `key` keeps its results now. */
export const keyNow = (path: string, key: string): string => moved.get(path)?.to.get(key) ?? key
/** The key a run kept under `key` started with (its process goes by it). */
export const keyStarted = (path: string, key: string): string => moved.get(path)?.from.get(key) ?? key
/** The run started under `key` is over: where it went is its key from now on. */
export function runSettled(path: string, key: string): void {
  const m = moved.get(path)
  const to = m?.to.get(key)
  if (!m || to === undefined) return
  m.to.delete(key)
  m.from.delete(to)
}
