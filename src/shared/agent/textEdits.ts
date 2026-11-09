/**
 * Pinpoint edits of a text as an agent asks them (doc_edit, note_edit): a fragment replaced (found exactly once), a
 * text put after a line, a text appended. Several in one call — applied in order, each to the text the previous one
 * left; one that does not fit — none is applied (the error names it): a batch never half-writes.
 */
export interface TextEdit {
  find?: string
  replace?: string
  after?: string
  text?: string
  append?: string
}

/** At most this many edits in one call. */
export const EDITS_MAX = 50

/** One edit's fields as a tool's JSON Schema takes them. */
export const TEXT_EDIT_PROPS = {
  find: { type: 'string', description: 'Фрагмент, который заменить (ровно одно вхождение)' },
  replace: { type: 'string', description: 'Чем заменить find' },
  after: { type: 'string', description: 'Вставить text после строки, содержащей это' },
  text: { type: 'string' },
  append: { type: 'string', description: 'Дописать в конец' },
} as const
/** The `edits` argument: several edits in one call (one model step instead of many). */
export const TEXT_EDITS_PROP = {
  type: 'array',
  maxItems: EDITS_MAX,
  description: 'Несколько правок за один вызов — по порядку, каждая к тексту после предыдущей; если одна не подошла, не применяется ни одна',
  items: { type: 'object', properties: TEXT_EDIT_PROPS },
} as const

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const EDIT_KEYS = Object.keys(TEXT_EDIT_PROPS) as Array<keyof TextEdit>
const editOf = (o: Record<string, unknown>): TextEdit => Object.fromEntries(EDIT_KEYS.filter((k) => typeof o[k] === 'string').map((k) => [k, o[k] as string]))
/** It asks for something: a fragment to find, a line to put a text after, a text to append. */
const asksSomething = (e: TextEdit) => !!(str(e.find) || (str(e.after) && str(e.text)) || str(e.append))

/** The edits a call asks for: its own fields (when it has them) first, then its `edits` list, in order. */
export function editsOf(a: Record<string, unknown>): TextEdit[] {
  const own = editOf(a)
  const list = a.edits === undefined ? [] : a.edits
  if (!Array.isArray(list)) throw new Error('edits — список правок')
  if (list.length > EDITS_MAX) throw new Error(`Правок больше ${EDITS_MAX} — раздели на несколько вызовов`)
  const rest = list.map((x, i) => {
    if (!isObj(x)) throw new Error(`Правка ${i + 1} — не объект { find, replace } / { after, text } / { append }`)
    return editOf(x)
  })
  return [...(asksSomething(own) ? [own] : []), ...rest]
}

/** One edit applied; `reread` — how the error tells to read the text anew (the tool that reads it). */
export function applyEdit(text: string, e: TextEdit, reread: string): string {
  if (!asksSomething(e)) throw new Error('Нечего менять: укажи find + replace, after + text или append')
  let out = text
  const find = str(e.find)
  if (find) {
    const n = out.split(find).length - 1
    if (n !== 1) throw new Error(n ? `Фрагмент встречается ${n} раз — уточни find` : `Фрагмент find не найден — ${reread}`)
    // (a function: «$&», «$1», «$$» in the new text are kept as written)
    out = out.replace(find, () => str(e.replace))
  }
  const after = str(e.after)
  if (after && str(e.text)) {
    const lines = out.split('\n')
    const at = lines.findIndex((l) => l.includes(after))
    if (at < 0) throw new Error(`Строка after не найдена — ${reread}`)
    lines.splice(at + 1, 0, str(e.text))
    out = lines.join('\n')
  }
  if (str(e.append)) out = `${out.replace(/\n*$/, '')}\n\n${str(e.append)}\n`
  return out
}

/** The edits applied one after another — all, or none (the one that did not fit named by its number). */
export function applyEdits(text: string, edits: readonly TextEdit[], reread: string): string {
  if (!edits.length) throw new Error('Нечего менять: укажи find + replace, after + text, append или edits')
  let out = text
  edits.forEach((e, i) => {
    try {
      out = applyEdit(out, e, reread)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(edits.length > 1 ? `Правка ${i + 1} из ${edits.length}: ${msg}. Ничего не изменено` : msg)
    }
  })
  if (out === text) throw new Error('Правки ничего не меняют (новый текст совпадает со старым)')
  return out
}
