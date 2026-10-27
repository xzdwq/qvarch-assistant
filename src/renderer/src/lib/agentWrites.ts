import { linesChanged } from '@shared/agent/docAi'
import { firstWrittenLine } from '@shared/notebook/agentLines'
import { markAgentWrite } from '@nb/workspace/noteAuthors'

/**
 * What an agent's turn wrote: its lines marked as its (noteAuthors), the place of its first change in each note — the
 * answer's links to these notes point there — and, for its journal, how many lines and whether it changed the memory.
 */
export interface AgentBy {
  turn: string
  /** The agent's name as the chat shows it. */
  name: string
}
interface TurnWrites {
  /** Each note written → the place of its first change. */
  places: Map<string, string>
  lines: number
  memory: boolean
}
const writes = new Map<string, TurnWrites>()
const of = (turn: string): TurnWrites => writes.get(turn) ?? writes.set(turn, { places: new Map(), lines: 0, memory: false }).get(turn)!

/** A note written by an agent's turn (its text before and after). */
export async function agentWrote(by: AgentBy, path: string, before: string, after: string): Promise<void> {
  const place = firstWrittenLine(before, after)
  const w = of(by.turn)
  if (place && !w.places.has(path)) w.places.set(path, place)
  w.lines += linesChanged(before, after)
  await markAgentWrite(path, before, after, by.name)
}
/** A document's memory changed by an agent's turn. */
export const agentWroteMemory = (by: AgentBy) => void (of(by.turn).memory = true)
/** What a turn wrote (taken: the turn is over). */
export function takeTurnWrites(turn: string): TurnWrites {
  const w = writes.get(turn) ?? { places: new Map(), lines: 0, memory: false }
  writes.delete(turn)
  return w
}
/** An agent's call of the window, read: who writes (none — not an agent's). */
export function agentByOf(a: Record<string, unknown>): AgentBy | undefined {
  const by = a.by as Partial<AgentBy> | undefined
  return by && typeof by.turn === 'string' && typeof by.name === 'string' && by.name ? { turn: by.turn, name: by.name.slice(0, 80) } : undefined
}
