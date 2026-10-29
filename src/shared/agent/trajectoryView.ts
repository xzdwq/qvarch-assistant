import type { DocTurn } from './docAi'
import { laneOf, type TrajLane, type TrajStep } from './trajectory'

/**
 * The journal drawn as a trajectory (a harness's view): every turn's steps in order, and a time bar — the turns one
 * after another (each as wide as it was long, a short one still seen), each step a stretch on its lane (context,
 * model, tools). A turn kept before steps were (or past the latest ones that keep them) — drawn from its summary.
 */

/** A turn's rows: its steps; none kept — its question, its tools in a line, how it ended. */
export function turnSteps(t: DocTurn): TrajStep[] {
  if (t.steps?.length) return t.steps
  const tools = Object.entries(t.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([n, k]) => (k > 1 ? `${n} ×${k}` : n))
  return [
    { kind: 'user', at: 0, ms: 0, text: t.question },
    ...(tools.length ? [{ kind: 'tool' as const, at: 0, ms: t.ms, tool: 'инструменты', text: tools.join(', ') }] : []),
    t.outcome === 'ok' ? { kind: 'answer' as const, at: t.ms, ms: 0, text: '(ответ — в чате документа)' } : { kind: 'error' as const, at: t.ms, ms: 0, text: t.error ?? (t.outcome === 'stopped' ? 'Остановлено' : 'Ошибка') },
  ]
}

/** A stretch of the time bar: its lane, where it starts and how wide it is (0…1 of the bar), whose step it is. */
export interface BarPiece {
  lane: TrajLane
  x: number
  w: number
  turn: number
  step: number
}
/** A turn's place on the bar (0…1). */
export interface BarTurn {
  x: number
  w: number
}
/** A turn takes at least this share of the bar (a quick one among long ones still seen). */
const TURN_MIN = 0.04
/** A step at least this share of its turn (an instant one still seen as a mark). */
const STEP_MIN = 0.012

export function timeBar(turns: readonly DocTurn[]): { turns: BarTurn[]; pieces: BarPiece[] } {
  if (!turns.length) return { turns: [], pieces: [] }
  const total = turns.reduce((n, t) => n + Math.max(1, t.ms), 0)
  // each turn's share: as long as it was, a short one widened, then all put back to the whole bar
  const raw = turns.map((t) => Math.max(TURN_MIN, Math.max(1, t.ms) / total))
  const sum = raw.reduce((a, b) => a + b, 0)
  const out: BarTurn[] = []
  let x = 0
  for (const r of raw) {
    out.push({ x, w: r / sum })
    x += r / sum
  }
  const pieces: BarPiece[] = []
  turns.forEach((t, ti) => {
    const span = Math.max(1, t.ms)
    const { x: tx, w: tw } = out[ti]
    turnSteps(t).forEach((s, si) => {
      const start = Math.min(1, Math.max(0, s.at / span))
      const width = Math.max(STEP_MIN, Math.min(1 - start, s.ms / span))
      pieces.push({ lane: laneOf(s.kind), x: tx + start * tw, w: width * tw, turn: ti, step: si })
    })
  })
  return { turns: out, pieces }
}
