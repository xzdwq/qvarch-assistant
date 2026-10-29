import { AGENT_PROVIDERS, isAgentProvider, type AgentProviderId } from './providers'

/**
 * An agent of this person: its name in the chats, the model it runs on, what it knows (folders of the notebook, a
 * project's folder) and how it works. Its key is kept apart (encrypted in main), never in the profile.
 */
export interface AgentProfile {
  id: string
  name: string
  provider: AgentProviderId
  /** The model (empty — the provider's default). */
  model: string
  /** The address when not the provider's own (a custom server, Ollama elsewhere). */
  baseUrl?: string
  /** What it is told before every turn (its role, its manner). */
  instructions: string
  /** The notebook's folders it searches (none — the whole notebook). */
  folders: string[]
  /** A project's folder it may read (Claude Code only — its own tools). */
  project?: string
  /** Where it makes the folders of its work ('' — the notebook's root). */
  workRoot: string
  /** A harness: the header its conversation is kept by (none — the provider's; '-' — none at all). */
  sessionHeader?: string
  /** A harness: headers of its own, a line each («Имя: значение»). */
  headers?: string
}
/** A profile as main gives it to the window: whether a key is kept for it. */
export type AgentProfileView = AgentProfile & { hasKey: boolean }

export const AGENT_NAME_MAX = 60
export const INSTRUCTIONS_MAX = 8000
/** An agent's name when none is typed: «ИИ · <its owner>». */
export const defaultAgentName = (owner: string): string => `ИИ · ${owner.trim() || 'я'}`.slice(0, AGENT_NAME_MAX)
/** An agent as a chat knows it: its owner's device and its profile (one id everywhere). */
export const agentIdOf = (device: string, profile: string): string => `${device}:${profile}`
/** The owner's device of an agent's id. */
export const ownerOfAgent = (agentId: string): string => agentId.slice(0, agentId.lastIndexOf(':'))
/** The profile's id of an agent's id. */
export const profileOfAgent = (agentId: string): string => agentId.slice(agentId.lastIndexOf(':') + 1)

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const cleanPath = (v: unknown): string => str(v, 500).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

/** A profile as kept: every field checked (an unknown provider — Claude Code; no name — the default one). */
export function cleanProfile(x: unknown, owner: string): AgentProfile {
  const p = (x ?? {}) as Partial<AgentProfile>
  const provider = isAgentProvider(p.provider) ? p.provider : 'claude-code'
  const baseUrl = str(p.baseUrl, 500)
  const project = str(p.project, 1000)
  const sessionHeader = str(p.sessionHeader, 100)
  const headers = str(p.headers, 2000)
  return {
    id: typeof p.id === 'string' && /^[\w-]{1,64}$/.test(p.id) ? p.id : crypto.randomUUID(),
    name: str(p.name, AGENT_NAME_MAX) || defaultAgentName(owner),
    provider,
    model: str(p.model, 200),
    ...(baseUrl ? { baseUrl } : {}),
    instructions: str(p.instructions, INSTRUCTIONS_MAX),
    folders: Array.isArray(p.folders) ? p.folders.map(cleanPath).filter(Boolean).slice(0, 50) : [],
    ...(project ? { project } : {}),
    workRoot: cleanPath(p.workRoot),
    ...(sessionHeader && (sessionHeader === '-' || HEADER_NAME.test(sessionHeader)) ? { sessionHeader } : {}),
    ...(headers ? { headers } : {}),
  }
}
/** A header's name as HTTP allows it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** The headers a profile adds, of its lines «Имя: значение» (a line not one — left out; no key's place: Authorization). */
export function headersOf(p: Pick<AgentProfile, 'headers'>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (p.headers ?? '').split(/\r?\n/)) {
    const m = /^\s*([^:\s]+)\s*:\s*(.*?)\s*$/.exec(line)
    if (m && HEADER_NAME.test(m[1]) && m[1].toLowerCase() !== 'authorization') out[m[1]] = m[2]
  }
  return out
}
/** The header a harness's conversation is kept by: the profile's, else the provider's ('-' — none). */
export const sessionHeaderOf = (p: Pick<AgentProfile, 'sessionHeader' | 'provider'>): string | undefined => {
  const h = p.sessionHeader || AGENT_PROVIDERS[p.provider].sessionHeader
  return h && h !== '-' ? h : undefined
}
/** The address a profile is spoken to at (its own, else the provider's; none — not over HTTP). */
export const baseUrlOf = (p: AgentProfile): string | undefined => (p.baseUrl || AGENT_PROVIDERS[p.provider].baseUrl)?.replace(/\/+$/, '')
/** The model a profile runs (its own, else the provider's first offer; '' — the provider decides). */
export const modelOf = (p: AgentProfile): string => p.model || AGENT_PROVIDERS[p.provider].model || ''
/** Whether a note's path is within the folders a profile searches (none given — every note). */
export const inFolders = (p: Pick<AgentProfile, 'folders'>, path: string): boolean => !p.folders.length || p.folders.some((f) => path === f || path.startsWith(`${f}/`))
