import type { DocAi } from './docAi'

/**
 * A search through a document's metadata (its AI memory and the AI's turns: the questions, the steps — the model's
 * words, the tools' arguments and results —, the answers, the errors): where the words were found, each with a bit
 * of text around them. The notes' search shows these under a note.
 */
export const META_PLACES = ['memory', 'question', 'step', 'answer', 'error'] as const
export type MetaPlace = (typeof META_PLACES)[number]
export const META_PLACE: Record<MetaPlace, string> = { memory: 'память', question: 'вопрос ИИ', step: 'шаг ИИ', answer: 'ответ ИИ', error: 'ошибка ИИ' }

export interface MetaHit {
  where: MetaPlace
  /** The text around the match; the match at `at`, `len` long. */
  text: string
  at: number
  len: number
  /** The turn's time (none — the memory). */
  when?: number
}

/** A bit of text around a match (a line's window, «…» where it is cut). */
function around(text: string, i: number, len: number): Pick<MetaHit, 'text' | 'at' | 'len'> {
  const flat = text.replace(/\s+/g, ' ')
  const from = Math.max(0, i - 40)
  const cut = flat.slice(from, i + len + 80)
  return { text: (from ? '…' : '') + cut, at: i - from + (from ? 1 : 0), len }
}

/** The places of the metadata that have the words (any case), `max` at most — the memory first, then the latest turns. */
export function metaHits(ai: DocAi, query: string, max = 3): MetaHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const out: MetaHit[] = []
  const look = (where: MetaPlace, text: string | undefined, when?: number) => {
    if (!text || out.length >= max) return
    const flat = text.replace(/\s+/g, ' ')
    const i = flat.toLowerCase().indexOf(needle)
    if (i >= 0) out.push({ where, ...around(flat, i, needle.length), ...(when ? { when } : {}) })
  }
  look('memory', ai.memory?.text)
  for (const t of [...ai.turns].reverse()) {
    look('question', t.question, t.at)
    look('error', t.error, t.at)
    for (const s of t.steps ?? []) look(s.kind === 'answer' ? 'answer' : 'step', [s.tool, s.text, s.result].filter(Boolean).join(' '), t.at)
    if (out.length >= max) break
  }
  return out
}
