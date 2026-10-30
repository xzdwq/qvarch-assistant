/** A vault path's parts: the note's shown name (no extension), its folder. */
export const noteName = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|qboard)$/i, '')
export const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')
/** A file's extension, as it is kept (.md, .qboard). */
export const extOf = (path: string) => /\.[^./]+$/.exec(path)?.[0] ?? ''

/**
 * A copy's path beside its document: «Копия - X»; that one taken — «Копия Копия - X», and so on (`taken` — the
 * vault's paths; the case does not count, as on Windows).
 */
export function copyPath(path: string, taken: readonly string[]): string {
  const dir = dirOf(path)
  const name = noteName(path).replace(/^(Копия )+- /, '')
  const ext = extOf(path)
  const busy = new Set(taken.map((p) => p.toLowerCase()))
  for (let n = 1; ; n++) {
    const p = `${dir ? `${dir}/` : ''}${'Копия '.repeat(n)}- ${name}${ext}`
    if (!busy.has(p.toLowerCase())) return p
  }
}
