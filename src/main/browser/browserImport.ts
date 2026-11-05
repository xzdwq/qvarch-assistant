import { dialog, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromiumBookmarks, countLinks, IMPORT_BROWSERS, passwordsCsv, type ImportedLogin, type ImportSource } from '../../shared/browser/browserImport'
import type { Bookmark } from '../../shared/browser'

const local = () => process.env.LOCALAPPDATA ?? ''
/** A profile's folder (Default, «Profile 1»…) and the name its browser shows for it. */
function profilesOf(root: string): Array<{ dir: string; name: string }> {
  let names: Record<string, { name?: string }> = {}
  try {
    names = (JSON.parse(readFileSync(join(root, 'Local State'), 'utf8')) as { profile?: { info_cache?: typeof names } }).profile?.info_cache ?? {}
  } catch {
    // no names: the folders' own
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name)) && existsSync(join(root, d.name, 'Bookmarks')))
    .map((d) => ({ dir: d.name, name: names[d.name]?.name || d.name }))
}
const bookmarksFile = (browser: string, profile: string): string | undefined => {
  const b = IMPORT_BROWSERS.find((x) => x.id === browser)
  return b && /^(Default|Profile \d+)$/.test(profile) ? join(local(), b.dir, profile, 'Bookmarks') : undefined
}

/** The browsers' profiles on this computer whose bookmarks can be taken (how many links each has). */
export function importSources(): ImportSource[] {
  const out: ImportSource[] = []
  for (const b of IMPORT_BROWSERS) {
    const root = join(local(), b.dir)
    if (!existsSync(root)) continue
    for (const p of profilesOf(root)) {
      try {
        const f = chromiumBookmarks(readFileSync(join(root, p.dir, 'Bookmarks'), 'utf8'), b.name)
        const n = f ? countLinks([f]) : 0
        if (n) out.push({ id: `${b.id}|${p.dir}`, label: `${b.name} · ${p.name}`, bookmarks: n })
      } catch {
        // a file being written, or not one: not offered
      }
    }
  }
  return out
}
/** A profile's bookmarks as one folder named after it (none — nothing there). */
export function readImportBookmarks(sourceId: string): Bookmark | undefined {
  const [browser, profile] = sourceId.split('|')
  const file = bookmarksFile(browser, profile ?? '')
  const b = IMPORT_BROWSERS.find((x) => x.id === browser)
  if (!file || !b || !existsSync(file)) throw new Error('Профиль браузера не найден')
  return chromiumBookmarks(readFileSync(file, 'utf8'), `${b.name} — импорт`)
}
/** The passwords file the person picks (a browser's export to CSV): its logins (none picked — undefined). */
export async function pickPasswordsCsv(win: BrowserWindow | undefined): Promise<{ logins: ImportedLogin[]; skipped: number } | undefined> {
  const o = { title: 'Файл паролей (CSV, экспорт из браузера)', filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile' as const] }
  const r = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o)
  const path = r.filePaths[0]
  if (r.canceled || !path) return undefined
  return passwordsCsv(readFileSync(path, 'utf8'))
}
