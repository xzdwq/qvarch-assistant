/** The notebook's queries: a library to take one from (each ```sql db=… block), their titles. */

/** A query of the notebook: where it is (a note in a folder, its line), what it is called, its connection, its text. */
export interface SqlTemplate {
  /** The note (vault-relative, with its folders). */
  path: string
  line: number
  title: string
  /** The block's own name (what it publishes). */
  name?: string
  db: string
  sql: string
}
/** A query's title: its first line when that is a comment («-- Аналоги продукта»). */
export function sqlTitle(body: string): string | undefined {
  const first = body.split('\n').find((l) => l.trim())
  const m = first && /^\s*--\s*(.+?)\s*$/.exec(first)
  return m ? m[1] : undefined
}
/** The query's body with its title set (the first comment line written, replaced or taken away). */
export function withTitle(body: string, title: string): string {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => l.trim())
  const has = at >= 0 && /^\s*--/.test(lines[at])
  const t = title.trim().replace(/\n/g, ' ')
  if (has) t ? (lines[at] = `-- ${t}`) : lines.splice(at, 1)
  else if (t) lines.unshift(`-- ${t}`)
  return lines.join('\n')
}
/** Every ```sql db=… block of a note. */
export function sqlTemplates(path: string, text: string): SqlTemplate[] {
  const out: SqlTemplate[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(`{3,}|~{3,})\s*sql\b(.*)$/i.exec(lines[i])
    if (!m) continue
    const db = /(?:^|\s)db=(\S*)/.exec(m[2])
    let j = i + 1
    while (j < lines.length && !lines[j].startsWith(m[1])) j++
    if (db) {
      const body = lines.slice(i + 1, j).join('\n')
      const name = /(?:^|\s)name=(\S+)/.exec(m[2])?.[1]
      const firstLine = body.split('\n').find((l) => l.trim() && !/^\s*--/.test(l))?.trim() ?? ''
      out.push({ path, line: i + 1, title: sqlTitle(body) ?? name ?? (firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine || 'Запрос'), name, db: db[1], sql: body })
    }
    i = j
  }
  return out
}
