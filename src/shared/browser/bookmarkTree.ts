import type { Bookmark, BrowserTab } from './tabs'

/** The bookmarks' tree: found, taken out, put in, its folders — each change a new tree (the old one untouched). */

/** The first bookmark (or folder) the test holds for, anywhere in the tree. */
export function findBookmark(list: Bookmark[], pred: (b: Bookmark) => boolean): Bookmark | undefined {
  for (const b of list) {
    if (pred(b)) return b
    const f = b.children && findBookmark(b.children, pred)
    if (f) return f
  }
  return undefined
}
/** The folder holding a bookmark (none — it is on the bar, or not there). */
export function parentOfBookmark(list: Bookmark[], id: string, parent?: Bookmark): Bookmark | undefined {
  for (const b of list) {
    if (b.id === id) return parent
    const f = b.children && parentOfBookmark(b.children, id, b)
    if (f) return f
  }
  return undefined
}
/** The tree without the bookmarks the test holds for (at any depth). */
export function withoutBookmarks(list: Bookmark[], pred: (b: Bookmark) => boolean): Bookmark[] {
  return list.filter((b) => !pred(b)).map((b) => (b.children ? { ...b, children: withoutBookmarks(b.children, pred) } : b))
}
/** A tree with `item` put into a folder (none — the bar) at a place (none — the end). */
export function insertBookmark(list: Bookmark[], folder: string | undefined, item: Bookmark, at?: number): Bookmark[] {
  const put = (l: Bookmark[]) => {
    const c = [...l]
    c.splice(at === undefined ? c.length : Math.min(at, c.length), 0, item)
    return c
  }
  if (!folder) return put(list)
  return list.map((b) => (b.id === folder ? { ...b, children: put(b.children ?? []) } : b.children ? { ...b, children: insertBookmark(b.children, folder, item, at) } : b))
}
/** Every folder, in the tree's order, its title indented by its depth (for a «where» list). */
export function bookmarkFolders(list: Bookmark[]): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = []
  const walk = (l: Bookmark[], depth: number) => {
    for (const b of l)
      if (b.children) {
        out.push({ id: b.id, title: `${'  '.repeat(depth)}${b.title}` })
        walk(b.children, depth + 1)
      }
  }
  walk(list, 0)
  return out
}
/** The bookmarks with an address, folders opened (at most `max`). */
export function flatBookmarks(list: Bookmark[], max: number): Bookmark[] {
  const out: Bookmark[] = []
  const walk = (l: Bookmark[]) => l.forEach((b) => (b.url ? out.push(b) : b.children && walk(b.children)))
  walk(list)
  return out.slice(0, max)
}
/** A bookmark without its icon gets it from a tab showing its page: the new tree, or none when nothing changed. */
export function withTabIcons(list: Bookmark[], tabs: BrowserTab[]): Bookmark[] | undefined {
  let changed = false
  const fill = (l: Bookmark[]): Bookmark[] =>
    l.map((b) => {
      if (b.children) return { ...b, children: fill(b.children) }
      const t = !b.icon && b.url ? tabs.find((x) => x.url === b.url && x.favicon) : undefined
      if (!t) return b
      changed = true
      return { ...b, icon: t.favicon }
    })
  const next = fill(list)
  return changed ? next : undefined
}
