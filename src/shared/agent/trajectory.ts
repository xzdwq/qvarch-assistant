/**
 * An agent's turn step by step (as a harness's trajectory): the instructions and the context it was given, the
 * question, each step of the model (its words) and each tool it called (what with, what came back), the answer —
 * each with when it began and how long it took (from the turn's start). Kept in the document's journal: short —
 * the turn's steps at most, each text cut; the latest turns only keep theirs (the journal of a shared note goes to
 * everyone of it).
 */
export const TRAJ_KINDS = ['system', 'context', 'user', 'model', 'tool', 'answer', 'error'] as const
export type TrajKind = (typeof TRAJ_KINDS)[number]

export interface TrajStep {
  kind: TrajKind
  /** When it began, ms from the turn's start. */
  at: number
  /** How long it took, ms. */
  ms: number
  /** Its words: the model's, the question, the answer; a tool's arguments. */
  text: string
  /** A tool's name. */
  tool?: string
  /** What the tool gave back. */
  result?: string
  /** A tool failed. */
  failed?: boolean
}

/** A turn keeps this many steps (a long one — its first ones and its end). */
export const TRAJ_STEPS_MAX = 40
/** A step's text kept, characters. */
export const TRAJ_TEXT_MAX = 240
/** This many latest turns keep their steps (older ones — their summary only). */
export const TRAJ_TURNS_KEPT = 12

const cut = (s: string, n = TRAJ_TEXT_MAX) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
/** A step as kept: its texts cut, its times whole numbers. */
export const trajStep = (s: TrajStep): TrajStep => ({
  kind: s.kind,
  at: Math.max(0, Math.round(s.at)),
  ms: Math.max(0, Math.round(s.ms)),
  text: cut(s.text),
  ...(s.tool ? { tool: s.tool } : {}),
  ...(s.result !== undefined ? { result: cut(s.result) } : {}),
  ...(s.failed ? { failed: true } : {}),
})
/** A turn's steps as kept: at most TRAJ_STEPS_MAX — its beginning and its last ones (where it ended). */
export function keptSteps(steps: readonly TrajStep[]): TrajStep[] {
  const all = steps.map(trajStep)
  if (all.length <= TRAJ_STEPS_MAX) return all
  const tail = 6
  return [...all.slice(0, TRAJ_STEPS_MAX - tail), ...all.slice(-tail)]
}

/** The lanes of the time bar: which kinds go to which. */
export const TRAJ_LANES = { context: ['system', 'context', 'user'], model: ['model', 'answer', 'error'], tools: ['tool'] } as const satisfies Record<string, readonly TrajKind[]>
export type TrajLane = keyof typeof TRAJ_LANES
export const laneOf = (k: TrajKind): TrajLane => (Object.keys(TRAJ_LANES) as TrajLane[]).find((l) => (TRAJ_LANES[l] as readonly TrajKind[]).includes(k))!
