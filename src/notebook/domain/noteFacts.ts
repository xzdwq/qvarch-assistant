/** What the notes screen says about a note or the vault, in words (pure: dates, counts, whether a note runs). */

/** "15 окт 2026, 21:12" — under a file's name in the tree ('' — no date). */
export function shortDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).replace(' г.', '')}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}
/** "15 октября 2026 г., 21:12" — the note's creation under its title ('' — no date). */
export function longDate(ms: number | undefined): string {
  return ms ? new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}
/** "Слов: 12 · Символов: 80" — the note's status line. */
export function textStats(text: string): string {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  return `Слов: ${words} · Символов: ${text.length}`
}
/** "1 заметка", "3 заметки", "11 заметок". */
export function notesCount(n: number): string {
  const word = n % 10 === 1 && n % 100 !== 11 ? 'заметка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'заметки' : 'заметок'
  return `${n} ${word}`
}
/** A note with blocks «Выполнить всё» runs: HTTP, runnable code, Playwright, named data, a query with its base. */
const RUNNABLE = /^(`{3,}|~{3,})\s*(http|rest)\b|^(`{3,}|~{3,})\s*(js|ts|javascript|typescript)\b[^\n]*\b(run|lib|playwright|pw)\b|^(`{3,}|~{3,})\s*(json|yaml|browser)\b[^\n]*\bname=|^(`{3,}|~{3,})\s*sql\b[^\n]*\bdb=/m
export const isRunnableText = (text: string) => RUNNABLE.test(text)
/** Where a note's published value came from, as the variables panel names it. */
export const VALUE_FROM: Record<string, string> = { http: 'HTTP', code: 'код', data: 'данные', set: 'set()', ref: '', pw: 'Playwright', browser: 'браузер', table: 'таблица' }
/** The emoji offered right in the tree's menu; «…» opens the whole list. */
export const QUICK_EMOJI = ['⭐', '🔥', '✅', '❗', '📌', '💡', '🚀', '🐞', '📊', '🎯']
