import { relinked } from '@shared/notebook/links'
import { resolveWiki } from '@shared/vault'
import { docs, setText } from './noteDocs'
import { files } from './vaultTreeStore'

/**
 * A note (or a folder of notes) renamed or moved: the `[[links]]` to it in every note follow — an open note gets the
 * new text as an edit (saved as usual, a shared one sent), a closed one is written.
 * `before` — the notes before the move; `from` / `to` — the moved path.
 */
export async function relinkAfterMove(from: string, to: string, before: string[]): Promise<number> {
  const moved = new Map<string, string>()
  for (const p of before) {
    if (p === from) moved.set(p, to)
    else if (p.startsWith(`${from}/`)) moved.set(p, `${to}${p.slice(from.length)}`)
  }
  if (!moved.size) return 0
  let n = 0
  for (const path of files.value.filter((p) => p.toLowerCase().endsWith('.md'))) {
    const d = docs.get(path)
    const text = d?.loaded ? d.text : await window.qa.vaultRead(path).catch(() => undefined)
    if (text === undefined || !text.includes('[[')) continue
    const next = relinked(text, moved, before, resolveWiki)
    if (next === undefined) continue
    n++
    if (d?.loaded) setText(path, next)
    else await window.qa.vaultWrite(path, next)
  }
  return n
}
