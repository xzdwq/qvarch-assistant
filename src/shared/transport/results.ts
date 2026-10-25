/**
 * The run results of a shared note, by key: `<kind>:<name>` — a block's last run, a loop's, a value the note
 * published. The app reads and writes them by kind; the server keeps any key of these kinds.
 */
export const RESULT_KINDS = ['run', 'loop', 'ctx'] as const
export type ResultKind = (typeof RESULT_KINDS)[number]
/** The kind of a result's key (none — not a result's key). */
export function resultKindOf(key: string): ResultKind | undefined {
  const k = key.slice(0, key.indexOf(':'))
  return (RESULT_KINDS as readonly string[]).includes(k) ? (k as ResultKind) : undefined
}
const NAME = /^[^\u0000-\u001f]{1,300}$/
/** A key as the server keeps it: of a kind, its name of 1–300 printable signs. */
export const isResultKey = (key: string): boolean => !!resultKindOf(key) && NAME.test(key.slice(key.indexOf(':') + 1))
