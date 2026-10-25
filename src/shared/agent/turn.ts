import type { TraceLine } from './agentLoop'
import type { PackLink, PackMessage } from './contextPack'
import type { Caller } from './trigger'

/**
 * An agent's turn as the window asks main for it (the window knows the chat and the note) and as main answers it
 * (the agent runs there: the model, the tools).
 */
export interface TurnRequest {
  /** The turn's own id (to stop it). */
  turn: string
  profile: string
  /** The agent as the chat knows it (it writes there by this id). */
  agent: string
  /** Its name in the chat (its lines in the notes are marked with it). */
  agentName: string
  caller: Caller
  room: string
  /** Whose agent it is, by name. */
  owner: string
  /** The note the chat is in (none — a chat of its own). */
  doc?: { title: string; path: string; text: string }
  /** The note's links, each said in a line; `full` — what `link_read` gives (a task's description…). */
  links: Array<PackLink & { full?: string }>
  folder: string[]
  /** The discussion as loaded (the question among them). */
  messages: PackMessage[]
  question: number
}
export interface TurnAnswer {
  text: string
  trace: TraceLine[]
  /** Said along with the answer (stopped, cut short). */
  note?: string
  /** The turn failed (no answer). */
  error?: string
}

/**
 * What a tool may do, as a caller other than the agent's owner is allowed: read (the owner's notes too), change the
 * note the chat is in (a shared one), change other notes, run (tests, the browser).
 */
export const TOOL_ACCESS = ['read', 'doc', 'write', 'run'] as const
export type ToolAccess = (typeof TOOL_ACCESS)[number]
/** Whether a caller may use a tool of this access (the owner — any; anyone else — reading and the shared note). */
export const mayUse = (caller: Caller, access: ToolAccess): boolean => caller === 'owner' || access === 'read' || access === 'doc'
