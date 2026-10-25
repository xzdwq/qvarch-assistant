import type { ChatMessage, ChatRoom } from '../transport/chat'

/**
 * Which of this person's agents a message calls: the ones it mentions — by their owner always; by anyone else only
 * when its owner lets the room's others call it (`open`). An agent answering may call another agent; such a chain goes
 * this deep at most (no two agents calling each other forever). Never itself.
 */
export const CHAIN_MAX = 3

/** Who called an agent: its owner himself (all its tools) or anyone else (another person, an agent — fewer tools). */
export type Caller = 'owner' | 'other'

export interface Call {
  agent: string
  caller: Caller
}

export function agentsCalled(m: ChatMessage, room: Pick<ChatRoom, 'agents'>, me: string): Call[] {
  if (m.agent && (m.chain ?? 0) >= CHAIN_MAX) return []
  // (a person's own message: the device is theirs and no agent wrote it)
  const caller: Caller = m.author.id === me && !m.agent ? 'owner' : 'other'
  const byMe = m.author.id === me
  return (room.agents ?? [])
    .filter((a) => a.owner === me && m.mentions?.includes(a.id) && a.id !== m.agent?.id)
    .filter((a) => byMe || !!a.open)
    .map((a) => ({ agent: a.id, caller }))
}
/** The chain step of an agent's answer to a message. */
export const chainAfter = (m: ChatMessage): number => (m.chain ?? 0) + 1
