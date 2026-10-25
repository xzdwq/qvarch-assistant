import type { ChatAgent } from '../transport/chat'
import { AGENT_NAME_MAX } from './profiles'

/**
 * One's agents in a chat brought in line with one's profiles: an agent whose profile is gone — taken out (it would
 * hang there, called by no one, answering nobody); one whose profile was renamed — named anew. The server may have
 * made a name unique («Имя 2») — that one is in line.
 */
export interface AgentFixes {
  remove: string[]
  rename: Array<{ id: string; name: string }>
}
export function agentFixes(agents: readonly ChatAgent[], me: string, profileName: (agentId: string) => string | undefined): AgentFixes {
  const out: AgentFixes = { remove: [], rename: [] }
  for (const a of agents) {
    if (a.owner !== me) continue
    const name = profileName(a.id)
    if (name === undefined) out.remove.push(a.id)
    else if (!sameName(a.name, name)) out.rename.push({ id: a.id, name })
  }
  return out
}
/** A chat's name of an agent is its profile's (or that made unique by the server: «Имя 2»). */
function sameName(inChat: string, profile: string): boolean {
  if (inChat === profile) return true
  const m = /^(.*) \d+$/.exec(inChat)
  return !!m && m[1] === profile.slice(0, AGENT_NAME_MAX - 4)
}
