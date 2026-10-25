import { firstWrittenLine } from '@shared/notebook/agentLines'
import { markAgentWrite } from '@nb/workspace/noteAuthors'

/**
 * What an agent's turn wrote: its lines marked as its (noteAuthors), and the place of its first change in each note —
 * the answer's links to these notes point there.
 */
export interface AgentBy {
  turn: string
  /** The agent's name as the chat shows it. */
  name: string
}
const writes = new Map<string, Map<string, string>>()

/** A note written by an agent's turn (its text before and after). */
export async function agentWrote(by: AgentBy, path: string, before: string, after: string): Promise<void> {
  const place = firstWrittenLine(before, after)
  const notes = writes.get(by.turn) ?? new Map<string, string>()
  writes.set(by.turn, notes)
  if (place && !notes.has(path)) notes.set(path, place)
  await markAgentWrite(path, before, after, by.name)
}
/** The notes a turn wrote and where (taken: the turn is over). */
export function takeTurnWrites(turn: string): Map<string, string> {
  const w = writes.get(turn) ?? new Map<string, string>()
  writes.delete(turn)
  return w
}
/** An agent's call of the window, read: who writes (none — not an agent's). */
export function agentByOf(a: Record<string, unknown>): AgentBy | undefined {
  const by = a.by as Partial<AgentBy> | undefined
  return by && typeof by.turn === 'string' && typeof by.name === 'string' && by.name ? { turn: by.turn, name: by.name.slice(0, 80) } : undefined
}
