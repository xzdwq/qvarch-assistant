/**
 * An entry's rights and owner changed from «Свойства»: what is asked (a field left out — kept), checked before it goes
 * to the server; the rights as a grid (owner / group / others × read / write / run) and back to octal.
 */
export interface AccessChange {
  /** Octal, 3 or 4 digits (`0644`, `4755`). */
  mode?: string
  owner?: string
  group?: string
  /** A folder: everything inside too (`-R`). */
  recursive?: boolean
}

/** Who the rights are for, as the grid's rows; their bits' shift in the mode. */
export const ACCESS_WHO = [
  { key: 'owner', label: 'Владелец', shift: 6 },
  { key: 'group', label: 'Группа', shift: 3 },
  { key: 'others', label: 'Остальные', shift: 0 },
] as const
/** What is allowed, as the grid's columns; their bit. */
export const ACCESS_WHAT = [
  { key: 'r', label: 'Чтение', bit: 4 },
  { key: 'w', label: 'Запись', bit: 2 },
  { key: 'x', label: 'Выполнение', bit: 1 },
] as const

const MODE = /^[0-7]{3,4}$/
/**
 * A user or group: a name (domain ones too — `user@domain`, `DOMAIN\user`, `domain users@domain` with a space) or a
 * number; never an option or `:`, no space at its ends.
 */
const NAME = /^[A-Za-z0-9_.](?:[A-Za-z0-9_.@\\$ -]{0,126}[A-Za-z0-9_.@\\$-])?$/

/** The mode's octal text → its bits (undefined — not octal). */
export function modeOf(text: string): number | undefined {
  const t = text.trim()
  return MODE.test(t) ? parseInt(t, 8) : undefined
}
/** Bits → 4-digit octal. */
export const octalText = (mode: number) => (mode & 0o7777).toString(8).padStart(4, '0')
/** One grid cell flipped. */
export const flipBit = (mode: number, shift: number, bit: number) => mode ^ (bit << shift)
export const hasBit = (mode: number, shift: number, bit: number) => (mode & (bit << shift)) !== 0

/** A change as sent (anything) → a valid one with only the fields to change, or the reason it is not. */
export function cleanAccessChange(v: unknown): { ok: true; change: AccessChange } | { ok: false; error: string } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const text = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
  const change: AccessChange = {}
  const mode = text('mode')
  if (mode) {
    if (!MODE.test(mode)) return { ok: false, error: `Права «${mode}» — нужны 3–4 восьмеричные цифры, например 0644` }
    change.mode = mode
  }
  for (const k of ['owner', 'group'] as const) {
    const name = text(k)
    if (!name) continue
    if (!NAME.test(name)) return { ok: false, error: `${k === 'owner' ? 'Владелец' : 'Группа'} «${name}» — недопустимое имя` }
    change[k] = name
  }
  if (!change.mode && !change.owner && !change.group) return { ok: false, error: 'Нечего менять' }
  if (o.recursive === true) change.recursive = true
  return { ok: true, change }
}

/** The access script's arguments for a path: path, mode, owner, group, recursive. */
export const accessArgs = (path: string, c: AccessChange) => [path, c.mode ?? '', c.owner ?? '', c.group ?? '', c.recursive ? '1' : '0']

/**
 * What the dialog sends: fields that differ from what the entry has now; with «everything inside» the owner and
 * group always go (the usual fix — files inside that got another owner), the mode only when changed.
 */
export function accessDiff(now: { octal: string; owner: string; group: string }, want: { octal: string; owner: string; group: string }, recursive: boolean): AccessChange {
  const c: AccessChange = {}
  if (modeOf(want.octal) !== modeOf(now.octal)) c.mode = want.octal.trim()
  if (recursive || want.owner.trim() !== now.owner) c.owner = want.owner.trim() || undefined
  if (recursive || want.group.trim() !== now.group) c.group = want.group.trim() || undefined
  if (recursive) c.recursive = true
  for (const k of ['mode', 'owner', 'group'] as const) if (!c[k]) delete c[k]
  return c
}
