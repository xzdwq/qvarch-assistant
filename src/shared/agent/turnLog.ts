import { TRAJ_KINDS, TRAJ_STEPS_MAX, TRAJ_TAIL_KEPT, TRAJ_TEXT_FLOW, type TrajFlow, type TrajKind, type TrajStep } from './trajectory'

/**
 * A turn's full record, kept only on the computer of the AI's owner (never in the document's journal, which goes to
 * everyone of a shared note): exactly what went to the model — its instructions, the document and discussion as
 * given, each tool's arguments and everything the tool gave back — and what the model said. The journal shows a step
 * whole from here; the journal's own steps are cut.
 */
export interface TurnLog {
  /** The turn's id (the journal's turn of the same id). */
  id: string
  at: number
  /** The system instructions as given. */
  system: string
  /** The document, links and discussion as given. */
  prompt: string
  /** Every step, its texts whole (each cut only at TURN_LOG_TEXT_MAX). */
  steps: TrajStep[]
}

/** A text of a record kept at most, characters (a huge tool answer still bounded). */
export const TURN_LOG_TEXT_MAX = 200_000
/** This many latest records are kept (the oldest go). */
export const TURN_LOGS_MAX = 300

/** A turn id that may name a file (a uuid and the like). */
export const isTurnLogId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)

const capped = (s: string) => (s.length > TURN_LOG_TEXT_MAX ? `${s.slice(0, TURN_LOG_TEXT_MAX)}\n… (обрезано: всего ${s.length} симв.)` : s)

/** A record as kept: its texts bounded, the steps' shape checked. */
export function turnLogOf(x: unknown): TurnLog | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Record<string, unknown>
  if (!isTurnLogId(o.id) || typeof o.at !== 'number') return undefined
  const steps = (Array.isArray(o.steps) ? o.steps : []).flatMap((s): TrajStep[] => {
    if (!s || typeof s !== 'object') return []
    const t = s as Record<string, unknown>
    if (!(TRAJ_KINDS as readonly unknown[]).includes(t.kind) || typeof t.at !== 'number' || typeof t.ms !== 'number' || typeof t.text !== 'string') return []
    return [
      {
        kind: t.kind as TrajStep['kind'],
        at: t.at,
        ms: t.ms,
        text: capped(t.text),
        ...(typeof t.tool === 'string' ? { tool: t.tool } : {}),
        ...(typeof t.result === 'string' ? { result: capped(t.result) } : {}),
        ...(t.failed ? { failed: true } : {}),
      },
    ]
  })
  return { id: o.id, at: o.at, system: capped(typeof o.system === 'string' ? o.system : ''), prompt: capped(typeof o.prompt === 'string' ? o.prompt : ''), steps }
}

/** A part of a step shown whole: which way it went, what it is, its text. */
export interface StepPart {
  flow: TrajFlow
  what: string
  text: string
}
/** What each kind's own text is (a tool's — its arguments). */
const TEXT_WHAT: Record<TrajKind, string> = {
  system: 'системная инструкция',
  context: 'документ, ссылки и обсуждение',
  user: 'вопрос',
  model: 'слова модели',
  tool: 'аргументы вызова',
  answer: 'ответ',
  error: 'ошибка',
}
/**
 * A step's parts, whole where the record has them (`whole` — false: the journal's cut texts only): the instructions
 * and the context — the record's own texts; a tool — its arguments (from the model) and what it gave back (into it).
 */
export function stepParts(step: TrajStep, full: TrajStep | undefined, log: TurnLog | undefined): { parts: StepPart[]; whole: boolean } {
  const s = full ?? step
  const own = step.kind === 'system' ? log?.system : step.kind === 'context' ? log?.prompt : undefined
  const text = own || s.text
  const parts: StepPart[] = [{ flow: TRAJ_TEXT_FLOW[step.kind], what: TEXT_WHAT[step.kind], text }]
  if (step.kind === 'tool' && s.result !== undefined) parts.push({ flow: 'toAi', what: s.failed ? 'ошибка инструмента' : 'ответ инструмента', text: s.result })
  return { parts, whole: !!full || !!own }
}

/**
 * A journal step's whole texts from the record: the journal keeps a long turn's beginning and end (keptSteps), so
 * its i-th of `kept` steps is the record's same one from the start or from the end; a different kind — none.
 */
export function fullStepOf(log: TurnLog, i: number, kept: readonly TrajStep[]): TrajStep | undefined {
  const n = log.steps.length
  const at = n <= TRAJ_STEPS_MAX || i < TRAJ_STEPS_MAX - TRAJ_TAIL_KEPT ? i : n - (kept.length - i)
  const s = log.steps[at]
  return s && s.kind === kept[i]?.kind && (s.tool ?? '') === (kept[i].tool ?? '') ? s : undefined
}
