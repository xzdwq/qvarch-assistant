import { attachForAgent } from '@shared/agent/attachLine'
import type { AgentProfileView } from '@shared/agent/profiles'
import type { TurnRequest } from '@shared/agent/turn'
import type { Caller } from '@shared/agent/trigger'
import { durText, parseNoteLink, periodText } from '@shared/noteEvents'
import { linksIn, type LinkKind, type NoteLinkRef } from '@shared/notebook/links'
import { authorName, isChatFile, type ChatAttach, type ChatFile, type ChatMessage, type ChatRoom } from '@shared/transport/chat'
import { voiceTextOf } from './voiceText'
import type { RefCard } from '@shared/transport/refCards'
import { resolveWiki } from '@shared/vault'
import { docPaths } from '@nb/workspace/sharedDocs'
import { docAiFor } from '@nb/workspace/docAiStore'
import { sharedDocOf } from '@shared/transport/space'
import { refCardOf } from '@nb/workspace/sharedRefs'
import { dirOf, docs, files, loadTree, noteName } from './notebook'
import { messagesOf, showRoom } from './chat'
import { eventOf, eventsNow, issueOf } from './noteEvents'
import { useTransport } from './transport'
import { agentIdOfProfile } from './agents'

/**
 * What an agent's turn is told, gathered here (the window has the chat, the notes, the tasks and events): the note the
 * chat is in, each of its links said in a line (and what `link_read` gives of a task or an event), the notes beside it,
 * the discussion with the question.
 */

/** The note a chat lives in: its block's note (open, else found on the disk), a comment's shared note. */
async function noteOfRoom(room: ChatRoom): Promise<string | undefined> {
  if (room.doc) return docPaths.get(room.doc)
  const mark = `room: ${room.id}`
  for (const [p, d] of docs) if (d.loaded && d.text.includes(mark)) return p
  return (await window.qa.vaultNotesWith(mark))[0]
}
async function textOf(path: string): Promise<string> {
  const d = docs.get(path)
  return d?.loaded ? d.text : window.qa.vaultRead(path)
}

type Said = { says: string; full?: string }
const jiraSays = (key: string, card?: RefCard): Said => {
  const i = issueOf(key) ?? (card?.kind === 'jira' ? card.issue : undefined)
  if (!i) return { says: `задача ${key} (нет данных)` }
  const head = `задача «${i.key} ${i.summary}», статус «${i.status}»${i.assignee ? `, исполнитель ${i.assignee}` : ''}`
  return { says: head, full: `${head}\nТип: ${i.type}${i.priority ? `, приоритет ${i.priority}` : ''}${i.due ? `, срок ${i.due}` : ''}\n\n${i.description ?? '(без описания)'}` }
}
const eventSays = (url: string, card?: RefCard): Said => {
  const l = parseNoteLink(url)
  const own = l?.kind === 'event' ? eventOf(l.day, l.id) : undefined
  const e = own ?? (card?.kind === 'event' ? card.event : undefined)
  if (!e) return { says: 'событие (нет данных)' }
  const now = Date.now()
  const head = `событие «${e.label}», ${periodText(e, now)} (${durText(e.end - e.start)})`
  const desc = card?.kind === 'event' && !own ? card.event.description : undefined
  return { says: head, full: `${head}${desc ? `\n\n${desc}` : ''}` }
}
/** Each kind of link — how it is said (the compiler checks none is missing). */
const SAYS: Record<LinkKind, (l: NoteLinkRef, note: string | undefined) => Said> = {
  note: (l) => {
    const path = resolveWiki(l.target, files.value)
    const part = l.kind === 'note' && l.section ? `, раздел «${l.section}»` : ''
    return { says: path ? `заметка «${path}»${part}` : 'заметки нет' }
  },
  file: (l) => ({ says: `файл ${l.target}` }),
  jira: (l, note) => {
    const link = parseNoteLink(l.target)
    return jiraSays(link?.kind === 'jira' ? link.key : l.target, note ? refCardOf(note, l.target) : undefined)
  },
  event: (l, note) => eventSays(l.target, note ? refCardOf(note, l.target) : undefined),
  doc: (l) => {
    const path = docPaths.get(l.target.split('/').pop() ?? '')
    return { says: path ? `общая заметка «${path}»` : 'общая заметка (нет доступа)' }
  },
  web: (l) => ({ says: `внешняя ссылка ${l.target}` }),
}

const FOLDER_MAX = 40
/** The voice messages heard for a turn: the question and this many before it at most. */
const VOICE_HEARD = 6
const isVoice = (a: ChatAttach) => a.kind === 'voice' && isChatFile(a.data)
/** A voice message as the agent reads it: its words (recognized here), or why there are none. */
async function voiceLine(room: string, a: ChatAttach): Promise<string> {
  try {
    const words = await voiceTextOf(room, a.data as ChatFile)
    return words ? `🎤 голосовое (${a.title}), расшифровка: «${words}»` : `🎤 голосовое (${a.title}) — слов не распознано`
  } catch (e) {
    return `🎤 голосовое (${a.title}) — не расшифровано: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function turnRequestFor(o: { turn: string; room: ChatRoom; message: ChatMessage; profile: AgentProfileView; caller: Caller }): Promise<TurnRequest> {
  if (!files.value.length) await loadTree()
  await showRoom(o.room.id).catch(() => undefined)
  const path = await noteOfRoom(o.room)
  const text = path ? await textOf(path).catch(() => undefined) : undefined
  const loaded = messagesOf(o.room.id)
  const list = loaded.some((m) => m.id === o.message.id) ? loaded : [...loaded, o.message]
  const question = list.findIndex((m) => m.id === o.message.id)
  const linked = linksIn(`${text ?? ''}\n${o.message.text}`)
  if (linked.some((l) => l.kind === 'event')) await eventsNow()
  const links = linked.map((l) => ({ raw: l.raw, ...SAYS[l.kind](l, path) }))
  // the document's memory: changed by one's own call, or in a shared note (where anyone's agent works for all)
  const memory = path && text !== undefined ? await docAiFor(path).then((ai) => ai.memory, () => undefined) : undefined
  const folder = path ? files.value.filter((p) => p !== path && dirOf(p) === dirOf(path)).slice(0, FOLDER_MAX).map(noteName) : []
  return {
    turn: o.turn,
    profile: o.profile.id,
    agent: agentIdOfProfile(o.profile),
    agentName: o.room.agents?.find((a) => a.id === agentIdOfProfile(o.profile))?.name ?? o.profile.name,
    caller: o.caller,
    room: o.room.id,
    owner: useTransport().value.name || 'владелец',
    ...(path && text !== undefined ? { doc: { title: noteName(path), path, text }, memory: { ...(memory ? { memory } : {}), writable: o.caller === 'owner' || !!sharedDocOf(text) } } : {}),
    links,
    folder,
    messages: await Promise.all(
      list.map(async (m, i) => {
        // (the voice messages near the question are heard: their words given — the agent reads no sound)
        const attach = m.attach && isVoice(m.attach) && i > question - VOICE_HEARD && i <= question ? await voiceLine(m.room, m.attach) : m.attach && attachForAgent(m.attach)
        return { name: authorName(m), text: m.text, ...(attach ? { attach } : {}) }
      }),
    ),
    question,
  }
}
