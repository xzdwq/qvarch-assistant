import { shallowRef } from 'vue'
import { agentIdOf, type AgentProfile, type AgentProfileView } from '@shared/agent/profiles'
import { agentFixes } from '@shared/agent/roomAgents'
import type { ChatRoom } from '@shared/transport/chat'
import { chatMe, chatOnline, chatRooms, isHeld, setLocalAgents, upsertRoom } from './chat'
import { serverCall } from './transport'

/**
 * This person's AI agents in the window: their profiles (Настройки → ИИ-агенты), and an agent put in a chat / taken
 * out of it, whether others may call agents there.
 */
export const agentProfiles = shallowRef<AgentProfileView[]>([])
let loaded: Promise<void> | undefined
export function loadAgents(force = false): Promise<void> {
  if (!loaded || force) {
    const p = window.qa.agentProfiles().then((l) => void (agentProfiles.value = l))
    // (a failed read is asked again next time)
    p.catch(() => loaded === p && (loaded = undefined))
    loaded = p
  }
  return loaded
}
export async function saveAgent(p: AgentProfile, key?: string): Promise<void> {
  agentProfiles.value = await window.qa.agentSave(p, key)
  // (renamed: its name in the chats follows)
  void tidyAgentsIn(chatRooms.value).catch(() => undefined)
}
/** A profile deleted: its agent taken out of the chats too. */
export async function removeAgent(id: string): Promise<void> {
  agentProfiles.value = await window.qa.agentRemove(id)
  void tidyAgentsIn(chatRooms.value).catch(() => undefined)
}

/** A profile's agent as the chats know it (this device's). */
export const agentIdOfProfile = (p: Pick<AgentProfile, 'id'>): string => agentIdOf(chatMe.value, p.id)
/** The profile of one of this device's agents (another's — none). */
export const profileOfAgentId = (agentId: string): AgentProfileView | undefined => agentProfiles.value.find((p) => agentIdOfProfile(p) === agentId)

/** One's agent put in a chat (a local chat — kept here; the server's — named unique there). */
export async function addAgentToChat(room: string, p: AgentProfileView): Promise<void> {
  const id = agentIdOfProfile(p)
  if (isHeld(room)) return setLocalAgents(room, (list) => [...list.filter((a) => a.id !== id), { id, name: p.name, owner: chatMe.value }])
  const r = await serverCall('chat.addAgent', { room, id, name: p.name })
  upsertRoom(r)
  // (one's agents here are open to the others already: this one too — the chat's setting is one)
  if (r.agents?.some((a) => a.owner === chatMe.value && a.open)) upsertRoom(await serverCall('chat.agentOpen', { room, id, on: true }))
}
export async function removeAgentFromChat(room: string, agentId: string): Promise<void> {
  if (isHeld(room)) return setLocalAgents(room, (list) => list.filter((a) => a.id !== agentId))
  upsertRoom(await serverCall('chat.removeAgent', { room, id: agentId }))
}
/** Renamed in a chat: put in again under the profile's name (a local chat — here; the server's — made unique there). */
async function renameAgentInChat(room: string, id: string, name: string): Promise<void> {
  if (isHeld(room)) return setLocalAgents(room, (list) => list.map((a) => (a.id === id ? { ...a, name } : a)))
  upsertRoom(await serverCall('chat.addAgent', { room, id, name }))
}
/**
 * One's agents in the chats brought in line with the profiles (the profiles read first): a deleted profile's agent
 * taken out, a renamed one's renamed. A failed step (no server now) is tried again the next time the chats change.
 */
let tidying = false
/** Asked again while at it: once more after (with the chats as they are then). */
let again = false
export async function tidyAgentsIn(rooms: readonly ChatRoom[]): Promise<void> {
  if (!chatMe.value) return
  if (tidying) return void (again = true)
  tidying = true
  try {
    await loadAgents()
    for (const r of rooms) {
      if (!r.agents?.length || (!isHeld(r.id) && !chatOnline.value)) continue
      const fix = agentFixes(r.agents, chatMe.value, (id) => profileOfAgentId(id)?.name)
      for (const id of fix.remove) await removeAgentFromChat(r.id, id).catch(() => undefined)
      for (const a of fix.rename) await renameAgentInChat(r.id, a.id, a.name).catch(() => undefined)
    }
  } finally {
    tidying = false
  }
  if (again) {
    again = false
    await tidyAgentsIn(chatRooms.value)
  }
}
/** Whether the room's others may call one's own agents there (each of them; a local chat has no others). */
export async function setMyAgentsOpen(room: ChatRoom, on: boolean): Promise<void> {
  for (const a of (room.agents ?? []).filter((x) => x.owner === chatMe.value)) upsertRoom(await serverCall('chat.agentOpen', { room: room.id, id: a.id, on }))
}
