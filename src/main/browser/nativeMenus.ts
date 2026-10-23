import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { Bookmark } from '../../shared/browser'

/** Native menus of the section — they open over the pages (the app's own menus would hide under them). */

/** A bookmark folder's contents as a native menu; a pick → `open` (Ctrl — in a new tab). */
export function folderMenu(bookmarks: Bookmark[], id: string, x: number, y: number, win: BrowserWindow | undefined, open: (url: string | undefined, newTab: boolean) => void): void {
  const find = (list: Bookmark[]): Bookmark | undefined => {
    for (const b of list) {
      if (b.id === id) return b
      const f = b.children && find(b.children)
      if (f) return f
    }
    return undefined
  }
  const folder = find(bookmarks)
  if (!folder?.children) return
  const toItems = (list: Bookmark[]): MenuItemConstructorOptions[] =>
    list.length
      ? list.map((b) => (b.children ? { label: b.title, submenu: toItems(b.children) } : { label: b.title || b.url!, click: (_m, _w, ev) => open(b.url, !!(ev.ctrlKey || ev.metaKey)) }))
      : [{ label: '(пусто)', enabled: false }]
  Menu.buildFromTemplate(toItems(folder.children)).popup({ window: win, x: Math.round(x), y: Math.round(y) })
}

/** A native menu of choices: '-' — a line, '#…' — a heading, `checked` — the current one. The picked id, or nothing. */
export function chooseMenu(items: Array<{ id: string; label: string; checked?: boolean }>, x: number, y: number, win: BrowserWindow | undefined): Promise<string | undefined> {
  return new Promise((res) => {
    let picked: string | undefined
    Menu.buildFromTemplate(
      items.map((i): MenuItemConstructorOptions =>
        i.id === '-' ? { type: 'separator' } : i.id.startsWith('#') ? { label: i.label, enabled: false } : { label: i.label, type: i.checked === undefined ? 'normal' : 'checkbox', checked: !!i.checked, click: () => (picked = i.id) },
      ),
    ).popup({
      window: win,
      x: Math.round(x),
      y: Math.round(y),
      // the click comes before the close
      callback: () => setTimeout(() => res(picked), 0),
    })
  })
}
