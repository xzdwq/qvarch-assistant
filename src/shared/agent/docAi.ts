import type { TraceLine } from './agentLoop'
import { isTouch, TOUCHES_MAX, type Touch } from './touches'
import { keptSteps, TRAJ_KINDS, TRAJ_TURNS_KEPT, type TrajStep } from './trajectory'

/**
 * The AI's own part of a document: its memory — a short text of what matters about the document (its aim, what was
 * agreed and decided, who does what, how to work in it), kept by the agents and by the people who may edit the note;
 * and its journal — the agents' turns in it (who asked, what was asked, the tools, what was written, how long, how it
 * ended). The memory goes into every turn's prompt — so it is kept short; the journal is for the people (and, later,
 * for a harness that drives the agents through the document).
 */

/** The views of the AI's work in the panel: the journal of turns, the graph of what they touched. */
export const DOC_AI_VIEWS = ['journal', 'graph'] as const
export type DocAiView = (typeof DOC_AI_VIEWS)[number]

/** The memory's size at most, characters (it goes into every turn). */
export const DOC_MEMORY_MAX = 1500
/** The journal keeps this many turns (the oldest go). */
export const DOC_TURNS_MAX = 40
/** A question kept in the journal, characters. */
const QUESTION_MAX = 160
const ERROR_MAX = 300

export interface DocMemory {
  text: string
  /** Who changed it last: a person's name, or an agent's. */
  by: string
  at: number
  /** An agent changed it last. */
  agent?: boolean
}
export const TURN_OUTCOMES = ['ok', 'error', 'stopped'] as const
export type TurnOutcome = (typeof TURN_OUTCOMES)[number]
export interface DocTurn {
  id: string
  at: number
  ms: number
  /** The agent's name (as the chat shows it) and its owner. */
  agent: string
  owner: string
  /** Who called it. */
  asker: string
  question: string
  /** Each tool used — how many times. */
  tools: Record<string, number>
  /** Lines it wrote into notes. */
  wrote: number
  outcome: TurnOutcome
  error?: string
  /** It changed the memory. */
  memory?: boolean
  /** What its calls touched (the graph is drawn from them). */
  touches?: Touch[]
  /** The turn step by step (the trajectory); the latest turns only. */
  steps?: TrajStep[]
}
export interface DocAi {
  memory?: DocMemory
  turns: DocTurn[]
}
export const NO_DOC_AI: DocAi = { turns: [] }

/** A memory as kept: blank lines squeezed, within the size. */
export const cleanMemory = (text: string): string =>
  text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, DOC_MEMORY_MAX)

/**
 * The memory rewritten over the version the writer saw (`base` — its `at`, 0 — none yet): that version still there —
 * the new one (a newer version, whatever the clock); changed meanwhile (another person's AI, someone in the panel) —
 * none: refused, never written over blindly.
 */
export function memoryRewrite(now: DocMemory | undefined, base: number, text: string, by: string, agent: boolean, clock: number): DocMemory | undefined {
  if ((now?.at ?? 0) !== base) return undefined
  return { text: cleanMemory(text), by, at: Math.max(clock, base + 1), ...(agent ? { agent: true } : {}) }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
export const isDocMemory = (x: unknown): x is DocMemory => isObj(x) && typeof x.text === 'string' && typeof x.by === 'string' && typeof x.at === 'number'
export const isDocTurn = (x: unknown): x is DocTurn =>
  isObj(x) && typeof x.id === 'string' && typeof x.at === 'number' && typeof x.agent === 'string' && (TURN_OUTCOMES as readonly unknown[]).includes(x.outcome) && isObj(x.tools)
const isTrajStep = (x: unknown): x is TrajStep => isObj(x) && (TRAJ_KINDS as readonly unknown[]).includes(x.kind) && typeof x.at === 'number' && typeof x.ms === 'number' && typeof x.text === 'string'
/** What another app (or an older one) wrote, read safely: the malformed parts left out. */
export function docAiOf(x: unknown): DocAi {
  if (!isObj(x)) return NO_DOC_AI
  const turns = (Array.isArray(x.turns) ? x.turns.filter(isDocTurn).slice(-DOC_TURNS_MAX) : []).map((t) => {
    const { touches, steps, ...rest } = t
    const ok = Array.isArray(touches) ? touches.filter(isTouch).slice(0, TOUCHES_MAX) : []
    const okSteps = Array.isArray(steps) ? keptSteps(steps.filter(isTrajStep)) : []
    return { ...rest, ...(ok.length ? { touches: ok } : {}), ...(okSteps.length ? { steps: okSteps } : {}) }
  })
  return { ...(isDocMemory(x.memory) ? { memory: x.memory } : {}), turns }
}

/** The tools a turn used, counted by name. */
export function toolsOf(trace: readonly TraceLine[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of trace) out[t.tool] = (out[t.tool] ?? 0) + 1
  return out
}
/** The lines a write changed: the new text's lines not in the old one (each counted as often as it is new). */
export function linesChanged(before: string, after: string): number {
  const had = new Map<string, number>()
  for (const l of before.split('\n')) had.set(l, (had.get(l) ?? 0) + 1)
  let n = 0
  for (const l of after.split('\n')) {
    const k = had.get(l) ?? 0
    if (k > 0) had.set(l, k - 1)
    else if (l.trim()) n++
  }
  return n
}
/** A turn as the journal keeps it. */
export function docTurnOf(o: {
  id: string
  at: number
  ms: number
  agent: string
  owner: string
  asker: string
  question: string
  trace: readonly TraceLine[]
  wrote: number
  error?: string
  stopped?: boolean
  memory?: boolean
  touches?: readonly Touch[]
  steps?: readonly TrajStep[]
}): DocTurn {
  const outcome: TurnOutcome = o.error ? 'error' : o.stopped ? 'stopped' : 'ok'
  return {
    id: o.id,
    at: o.at,
    ms: Math.max(0, Math.round(o.ms)),
    agent: o.agent,
    owner: o.owner,
    asker: o.asker,
    question: o.question.replace(/\s+/g, ' ').trim().slice(0, QUESTION_MAX),
    tools: toolsOf(o.trace),
    wrote: o.wrote,
    outcome,
    ...(o.error ? { error: o.error.slice(0, ERROR_MAX) } : {}),
    ...(o.memory ? { memory: true } : {}),
    ...(o.touches?.length ? { touches: o.touches.slice(0, TOUCHES_MAX) } : {}),
    ...(o.steps?.length ? { steps: keptSteps(o.steps) } : {}),
  }
}
/** The journal with a turn put in (once): the latest DOC_TURNS_MAX turns; only the latest TRAJ_TURNS_KEPT keep their steps. */
export const withTurn = (turns: readonly DocTurn[], t: DocTurn): DocTurn[] => {
  const all = [...turns.filter((x) => x.id !== t.id), t].slice(-DOC_TURNS_MAX)
  return all.map((x, i) => (i < all.length - TRAJ_TURNS_KEPT && x.steps ? (({ steps: _s, ...rest }) => rest)(x) : x))
}

/** The memory as an agent reads it (in the system part of every turn), with how to keep it. */
export function memoryForAgent(m: DocMemory | undefined, mayWrite: boolean): string {
  const how = mayWrite
    ? `Память документа — её видят все участники и ИИ, она входит в каждый твой ход. Обновляй её инструментом doc_memory, когда узнал важное надолго (цель, договорённости, решения, кто что делает, как работать в документе), а не пересказ обсуждения. Пиши очень кратко, пунктами, до ${DOC_MEMORY_MAX} знаков, переписывая целиком и сохраняя то, что дописали люди.`
    : 'Память документа — её ведут владелец документа и его ИИ.'
  // (the document is what is true now: the memory and earlier answers may be behind it — people edit it)
  const truth = mayWrite
    ? 'Главное — текущий текст документа: люди его правят. Если память или прежние сообщения обсуждения ему противоречат (данные удалили, заменили), верь документу и поправь память через doc_memory, убрав устаревшее.'
    : 'Главное — текущий текст документа: если память или прежние сообщения ему противоречат, верь документу.'
  return `${how}\n${truth}\nПамять документа${m?.text ? ` (обновил ${m.by}):\n${m.text}` : ': пока пусто.'}`
}
