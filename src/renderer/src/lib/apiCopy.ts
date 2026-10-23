import { httpBlocks, namesIn, type HttpExample } from '@shared/httpBlock'

/**
 * Requests (the API map's, a Swagger's) into the notebook: the site's login for them (its token headers — the
 * latest its pages sent, kept in memory; the browser's cookies for each address), as ready ```http blocks — to the
 * clipboard, at the end of a note there is, or a new note.
 */
export async function authFor(urls: string[]): Promise<(url: string) => Array<[string, string]>> {
  const keyOf = (u: string) => {
    try {
      const x = new URL(u.replace(/\{\{[^{}]+\}\}/g, 'x'))
      return `${x.origin}${x.pathname}`
    } catch {
      return u
    }
  }
  const by = new Map<string, Array<[string, string]>>()
  for (const u of urls) {
    const k = keyOf(u)
    if (!by.has(k)) by.set(k, await window.qa.browser('apiMapAuth', u.replace(/\{\{[^{}]+\}\}/g, 'x')))
  }
  return (u) => by.get(keyOf(u)) ?? []
}
/** The requests as blocks (names free among `taken`), with the site's login. */
export async function blocksOf(xs: HttpExample[], taken?: Set<string>): Promise<string> {
  return httpBlocks(xs, await authFor(xs.map((x) => x.url)), taken)
}
/** The requests at the end of a note there is — only the requests (the note's text untouched). */
export async function appendToNote(path: string, xs: HttpExample[]): Promise<void> {
  const text = await window.qa.vaultRead(path)
  const blocks = await blocksOf(xs, namesIn(text))
  await window.qa.vaultWrite(path, `${text.replace(/\s+$/, '')}${text.trim() ? '\n\n' : ''}${blocks}\n`)
}
/** A new note (its folder made when there is none); its path. */
export async function newNote(dir: string, name: string, text: string): Promise<string> {
  const tree = await window.qa.vaultTree()
  if (!tree.some((n) => n.dir && n.path === dir)) await window.qa.vaultCreate('', 'folder', dir)
  return window.qa.vaultCreate(dir, 'note', name.replace(/[:/\\?*"<>|]/g, '_'), text)
}
