/**
 * Emoji to pick in a note: Unicode's list with Russian and English names and tags (emojibase), loaded when
 * first needed; searched by any word of either language; the recently used first.
 */
export interface Emoji {
  u: string
  ru: string
  en: string
  /** Every word to search by (names and tags of both languages), lower case. */
  words: string
  group: number
}
type Raw = { hexcode: string; label: string; unicode: string; group?: number; order?: number; tags?: string[]; skins?: unknown }
let list: Emoji[] | undefined
let loading: Promise<Emoji[]> | undefined
export const EMOJI_GROUPS = ['Смайлики и эмоции', 'Люди', '', 'Животные и природа', 'Еда и напитки', 'Путешествия и места', 'Занятия', 'Предметы', 'Символы', 'Флаги']
export function loadEmoji(): Promise<Emoji[]> {
  if (list) return Promise.resolve(list)
  loading ??= Promise.all([import('emojibase-data/ru/compact.json'), import('emojibase-data/en/compact.json')]).then(([ru, en]) => {
    const enBy = new Map<string, Raw>()
    for (const e of (en as unknown as { default: Raw[] }).default) enBy.set(e.hexcode, e)
    const out: Array<Emoji & { order: number }> = []
    for (const r of (ru as unknown as { default: Raw[] }).default) {
      // the regional letters and skin-tone parts are no emoji of their own
      if (r.group === undefined || r.group === 2) continue
      const e = enBy.get(r.hexcode)
      out.push({ u: r.unicode, ru: r.label, en: e?.label ?? '', words: [r.label, ...(r.tags ?? []), e?.label ?? '', ...(e?.tags ?? [])].join(' ').toLowerCase(), group: r.group, order: r.order ?? 0 })
    }
    out.sort((a, b) => a.order - b.order)
    list = out
    return out
  })
  return loading
}
const RECENT = 'qa.notebook.emoji'
export function recentEmoji(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]).slice(0, 24)
  } catch {
    return []
  }
}
export function useEmoji(u: string): void {
  try {
    localStorage.setItem(RECENT, JSON.stringify([u, ...recentEmoji().filter((x) => x !== u)].slice(0, 24)))
  } catch {
    // fine
  }
}
/** The emoji for a query (every word must be found; a word's start counts more). */
export function searchEmoji(all: Emoji[], q: string, limit = 400): Emoji[] {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!w.length) {
    const rec = recentEmoji()
    const recent = rec.map((u) => all.find((e) => e.u === u)).filter((e): e is Emoji => !!e)
    return [...recent, ...all.filter((e) => !rec.includes(e.u))].slice(0, limit)
  }
  const scored: Array<[number, Emoji]> = []
  for (const e of all) {
    if (!w.every((x) => e.words.includes(x))) continue
    const name = `${e.ru} ${e.en}`.toLowerCase()
    const s = w.reduce((a, x) => a + (name.startsWith(x) ? 3 : new RegExp(`(^|\\s)${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name) ? 2 : e.words.includes(` ${x}`) ? 1 : 0), 0)
    scored.push([s, e])
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1])
}
