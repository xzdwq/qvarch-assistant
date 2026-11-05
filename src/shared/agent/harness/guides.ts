/**
 * Harness instructions for a kind of task (testing, automation, data, a document…): the person's to edit, add and
 * turn off — the harness's own way of working (its protocol) is not among them. The agent sees their catalog (a
 * title and a few words each), reads the ones the task needs, plans by some and checks by others.
 */
export interface HarnessGuide {
  /** Its id (latin, as the agent names it in the plan). */
  id: string
  title: string
  /** A few words: what kind of task it is for (the catalog shows only this). */
  summary: string
  /** The instruction itself (Markdown). */
  body: string
  enabled: boolean
  /** Built in (comes with the app; updated with it until the person edits it) or the person's own. */
  origin: 'builtin' | 'user'
  edited: boolean
}
/** The instructions a plan follows: in the work and in the final check. */
export interface PlanGuides {
  work: string[]
  check: string[]
}

export const GUIDE_TITLE_MAX = 80
export const GUIDE_SUMMARY_MAX = 160
export const GUIDE_BODY_MAX = 20_000
/** The instructions' text a turn is given at most (all chosen together). */
export const GUIDES_TEXT_MAX = 40_000
const ID = /^[a-z][a-z0-9-]{1,40}$/

export const isGuideId = (s: unknown): s is string => typeof s === 'string' && ID.test(s)
/** An id made of a title (latin letters kept; else a short random one). */
export function guideIdOf(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'guide'
  let id = /^[a-z]/.test(base) && base.length > 1 ? base : `guide-${base}`.slice(0, 30)
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  return id
}

/** A guide as kept (or why not, in words). */
export function cleanGuide(x: unknown): HarnessGuide | string {
  const g = (x ?? {}) as Partial<Record<keyof HarnessGuide, unknown>>
  if (!isGuideId(g.id)) return 'id — латиница, цифры и дефис (2–41 знак)'
  const title = typeof g.title === 'string' ? g.title.trim().slice(0, GUIDE_TITLE_MAX) : ''
  if (!title) return 'Нужно название'
  const summary = typeof g.summary === 'string' ? g.summary.trim().slice(0, GUIDE_SUMMARY_MAX) : ''
  if (!summary) return 'Нужно краткое описание — по нему ИИ выбирает инструкцию'
  const body = typeof g.body === 'string' ? g.body.trim() : ''
  if (!body) return 'Нужен текст инструкции'
  if (body.length > GUIDE_BODY_MAX) return `Текст длиннее ${GUIDE_BODY_MAX} знаков — разделите на несколько инструкций`
  return { id: g.id, title, summary, body, enabled: g.enabled !== false, origin: g.origin === 'builtin' ? 'builtin' : 'user', edited: g.edited === true }
}

/** The catalog the agent chooses from: a line each (the enabled ones). */
export const guideCatalog = (guides: readonly HarnessGuide[]): string =>
  guides
    .filter((g) => g.enabled)
    .map((g) => `- ${g.id} — ${g.title}: ${g.summary}`)
    .join('\n')

/** The chosen instructions' texts for a turn (within the size; the ones gone or off — named apart). */
export function guidesText(ids: readonly string[], guides: readonly HarnessGuide[]): { text: string; missing: string[] } {
  const parts: string[] = []
  const missing: string[] = []
  let size = 0
  for (const id of ids) {
    const g = guides.find((x) => x.id === id && x.enabled)
    if (!g) {
      missing.push(id)
      continue
    }
    const part = `### ${g.title} (${g.id})\n${g.body}`
    if (size + part.length > GUIDES_TEXT_MAX) {
      parts.push(`### ${g.title} (${g.id})\n[не поместилась — прочитай её: harness_guides_read]`)
      continue
    }
    size += part.length
    parts.push(part)
  }
  return { text: parts.join('\n\n'), missing }
}

/** The ids of a plan's instructions as given (the known ones; unknown — said). */
export function planGuidesOf(v: unknown, known: ReadonlySet<string>): string[] | string {
  if (v === undefined) return []
  if (!Array.isArray(v)) return 'список id инструкций'
  const ids = [...new Set(v.map(String))]
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length) return `нет таких инструкций: ${unknown.join(', ')} — есть: ${[...known].join(', ') || 'никаких'}`
  return ids
}
