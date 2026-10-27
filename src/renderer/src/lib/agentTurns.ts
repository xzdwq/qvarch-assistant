import { shallowRef, watch } from 'vue'
import { agentsCalled, chainAfter, type Caller } from '@shared/agent/trigger'
import type { TraceLine } from '@shared/agent/agentLoop'
import type { TurnAnswer } from '@shared/agent/turn'
import { ATTACH_MAX, attachBytes, authorName, CHAT_TEXT_MAX, mentionable, mentionsIn, replyOf, type ChatAttach, type ChatMessage, type ChatRoom } from '@shared/transport/chat'
import { docTurnOf } from '@shared/agent/docAi'
import { addDocTurn } from '@nb/workspace/docAiStore'
import { useTransport } from './transport'
import { agentIdOfProfile, loadAgents, profileOfAgentId, tidyAgentsIn } from './agents'
import { turnRequestFor } from './agentContext'
import { takeTurnWrites } from './agentWrites'
import { parseDocLink, withPlaces, type NoteLinkRef } from '@shared/notebook/links'
import { resolveWiki } from '@shared/vault'
import { docPaths } from '@nb/workspace/sharedDocs'
import { files } from './notebook'
import { chatMe, chatRooms, isHeld, messagesOf, onRoomMessage, postMessage, roomOf, showRoom, tellAgentWorking } from './chat'

/**
 * This person's agents at work in the chats: a message calling one (by its owner, or by anyone where the chat allows)
 * starts its turn — one at a time per agent, the others wait; while it works the room sees «работает…»; its answer
 * (and the steps it took, folded) goes to the chat as the agent's message.
 */
interface Job {
  room: ChatRoom
  message: ChatMessage
  caller: Caller
}
/** The agents' turns going on now: room → the agent and its turn (one may be stopped). */
export const agentWork = shallowRef(new Map<string, { agent: string; name: string; turn: string }>())
const queues = new Map<string, { running: boolean; jobs: Job[] }>()
/** Messages already looked at (a message comes as the answer to a send and as an event). */
const seen = new Set<string>()
const TYPING_EVERY = 2500

function consider(m: ChatMessage): void {
  if (seen.has(m.id)) return
  seen.add(m.id)
  handle(m.room, m.seq)
  const room = roomOf(m.room)
  if (!room) return
  for (const c of agentsCalled(m, room, chatMe.value)) enqueue(c.agent, { room, message: m, caller: c.caller })
}

// ---------- the calls missed while the app was closed or offline ----------
/** Each room's last message the agents looked at (kept over a restart). */
const HANDLED_KEY = 'qa.agents.handled'
const handled: Record<string, number> = readHandled()
/** A call older than this is not answered late (the talk went on without it). */
const LATE_MAX = 24 * 3600_000
function handle(room: string, seq: number): void {
  if ((handled[room] ?? 0) >= seq) return
  handled[room] = seq
  try {
    localStorage.setItem(HANDLED_KEY, JSON.stringify(handled))
  } catch {
    // (kept for this run)
  }
}
function readHandled(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(HANDLED_KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}
/**
 * The rooms with one's agents caught up: calls that came while the app was away — each agent answers once per room,
 * the latest call (with all the talk since in its context). A room met first — from now on only.
 */
async function catchUp(rooms: readonly ChatRoom[]): Promise<void> {
  for (const r of rooms) {
    if (isHeld(r.id) || !myAgentsIn(r).length) continue
    const from = handled[r.id]
    if (from === undefined) handle(r.id, r.lastSeq)
    if (from === undefined || r.lastSeq <= from) continue
    handle(r.id, r.lastSeq)
    await showRoom(r.id).catch(() => undefined)
    const late = new Map<string, Job>()
    for (const m of messagesOf(r.id)) {
      if (m.seq <= from || seen.has(m.id) || Date.now() - m.at > LATE_MAX) continue
      seen.add(m.id)
      for (const c of agentsCalled(m, r, chatMe.value)) late.set(c.agent, { room: r, message: m, caller: c.caller })
    }
    for (const [agent, job] of late) enqueue(agent, job)
  }
}
function enqueue(agent: string, job: Job): void {
  const q = queues.get(agent) ?? { running: false, jobs: [] }
  queues.set(agent, q)
  q.jobs.push(job)
  if (!q.running) void drain(agent, q)
}
async function drain(agent: string, q: { running: boolean; jobs: Job[] }): Promise<void> {
  q.running = true
  try {
    for (let job = q.jobs.shift(); job; job = q.jobs.shift()) await runTurn(agent, job).catch(() => undefined)
  } finally {
    q.running = false
  }
}

async function runTurn(agent: string, job: Job): Promise<void> {
  await loadAgents()
  const profile = profileOfAgentId(agent)
  // (the profile deleted in the settings: the agent stays in chats until taken out, it does not answer)
  if (!profile) return
  const room = roomOf(job.room.id) ?? job.room
  const turn = crypto.randomUUID()
  agentWork.value = new Map(agentWork.value).set(room.id, { agent, name: profile.name, turn })
  const tell = () => tellAgentWorking(room.id, { id: agent, name: profile.name })
  tell()
  const ticker = setInterval(tell, TYPING_EVERY)
  const t0 = Date.now()
  let answer: TurnAnswer
  let docPath: string | undefined
  try {
    const req = await turnRequestFor({ turn, room, message: job.message, profile, caller: job.caller })
    docPath = req.doc?.path
    answer = await window.qa.agentRun(req)
  } catch (e) {
    answer = { text: '', trace: [], error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearInterval(ticker)
    const w = new Map(agentWork.value)
    if (w.get(room.id)?.turn === turn) w.delete(room.id)
    agentWork.value = w
  }
  const wrote = takeTurnWrites(turn)
  const name = nameIn(room.id, agent, profile.name)
  // the turn into its document's journal (what the people see of the AI's work there)
  if (docPath)
    void addDocTurn(
      docPath,
      docTurnOf({ id: turn, at: t0, ms: Date.now() - t0, agent: name, owner: chatMeName(), asker: authorName(job.message), question: job.message.text, trace: answer.trace, wrote: wrote.lines, error: answer.stopped ? undefined : answer.error, stopped: answer.stopped, memory: wrote.memory, touches: answer.touches }),
    ).catch(() => undefined)
  await post({ id: agent, name }, room, job.message, { ...answer, text: withPlaces(answer.text, placesOf(wrote.places)) })
}
/** This person's name (whose agents these are). */
const chatMeName = () => useTransport().value.name || 'владелец'
/** A link of the answer to a note the turn wrote: the place it wrote there. */
const placesOf =
  (wrote: Map<string, string>) =>
  (l: NoteLinkRef): string | undefined => {
    if (!wrote.size) return undefined
    const path = l.kind === 'note' ? resolveWiki(l.target, files.value) : l.kind === 'doc' ? docPaths.get(parseDocLink(l.target)?.doc ?? '') : undefined
    return path ? wrote.get(path) : undefined
  }
/** An agent's name in a room (the server may have made it unique there). */
const nameIn = (room: string, agent: string, fallback: string) => roomOf(room)?.agents?.find((a) => a.id === agent)?.name ?? fallback

/** The answer as the agent's message: its words (an error said plainly), a note under them, its steps folded. */
async function post(agent: { id: string; name: string }, room: ChatRoom, asked: ChatMessage, a: TurnAnswer): Promise<void> {
  const words = a.text.trim() || (a.error ? `Не получилось ответить: ${a.error}` : 'Ответа нет.')
  const note = a.note && a.text.trim() ? `\n\n(${a.note})` : ''
  const text = `${words}${note}`.slice(0, CHAT_TEXT_MAX)
  const now = roomOf(room.id) ?? room
  const mentions = mentionsIn(text, mentionable(now)).filter((id) => id !== agent.id)
  const attach = traceAttach(a.trace)
  // (the message comes back to the listeners: another agent it mentions is called then)
  // (an answer to the message that called it — as people answer in a chat)
  await postMessage(room.id, { text, agent, chain: chainAfter(asked), reply: replyOf(asked), ...(mentions.length ? { mentions } : {}), ...(attach ? { attach } : {}) })
}
/** The steps as an attachment (the last ones dropped to fit). */
function traceAttach(trace: TraceLine[]): ChatAttach | undefined {
  for (let n = trace.length; n > 0; n--) {
    const a: ChatAttach = { kind: 'trace', title: 'Шаги ИИ', data: trace.slice(0, n) }
    if (attachBytes(a) <= ATTACH_MAX) return a
  }
  return undefined
}

/** The agent working in a room stopped (its answer — what it had). */
export function stopAgentIn(room: string): void {
  const w = agentWork.value.get(room)
  if (w) window.qa.agentStop(w.turn)
}
/** Whether one of this device's agents is in a room. */
export const myAgentsIn = (room: ChatRoom) => (room.agents ?? []).filter((a) => a.owner === chatMe.value)
export { agentIdOfProfile }

let started = false
/** The agents listen to the chats (once, in the main window). */
export function startAgents(): void {
  if (started) return
  started = true
  void loadAgents().catch(() => undefined)
  onRoomMessage(consider)
  watch(chatRooms, (rooms) => {
    void catchUp(rooms)
    // (one's agents in line with the profiles: a deleted one's never hangs in a chat; profiles unread — nothing done)
    void tidyAgentsIn(rooms).catch(() => undefined)
  })
}
