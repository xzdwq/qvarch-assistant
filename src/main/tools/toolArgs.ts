/** A tool's arguments read: a required text, an optional one, a note's path. */
export const str = (v: unknown, name: string, max = 500_000) => {
  if (typeof v !== 'string' || !v.length) throw new Error(`Нужен параметр ${name}`)
  return v.slice(0, max)
}
export const opt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
export const notePath = (p: string) => (p.toLowerCase().endsWith('.md') ? p : `${p}.md`).replace(/^\/+/, '')
