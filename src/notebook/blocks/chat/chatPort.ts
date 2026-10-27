import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type { ChatFile, ChatMessage, ChatReply, ChatRoom, Outgoing } from '@shared/transport/chat'
import type { ChatPrefs } from '@shared/transport/constants'
import type { NoteLinkRef } from '@shared/notebook/links'

/**
 * What a chat's parts (its messages, what one writes, the files and the voices in it) need of the chats — one
 * contract for every window: the main window holds the chats (the server's and the local ones, the agents, the
 * notebook) and gives them straight (`chatPortLocal`); the island mirrors the room it shows and asks the main window to
 * act (`islandChatPort`). The parts never reach the chats' state themselves.
 */
export interface ChatPort {
  /** This device. */
  readonly me: Readonly<Ref<string>>
  /** Connected to the server. */
  readonly online: Readonly<Ref<boolean>>
  readonly prefs: Readonly<Ref<ChatPrefs>>
  roomOf(id: string): ChatRoom | undefined
  messagesOf(id: string): ChatMessage[]
  /** One's messages on their way. */
  pendingOf(id: string): Outgoing[]
  /** Its oldest message is here. */
  isComplete(id: string): boolean
  /** «Анна печатает…» ('' — nobody). */
  typingIn(id: string): string
  /** One's own agent working in it now (it may be stopped). */
  workingIn(id: string): { name: string } | undefined
  /** Kept on this computer only (no server yet). */
  isHeld(id: string): boolean
  /** Its latest messages fetched (once). */
  show(id: string): Promise<void>
  loadOlder(id: string): Promise<void>
  /** A message typed sent (empty or too long — not: false). */
  send(room: string, text: string, reply?: ChatReply): boolean
  sendFile(room: string, f: File, text: string, reply?: ChatReply): Promise<void>
  sendVoice(room: string, blob: Blob, sec: number, reply: ChatReply | undefined, text: string): Promise<void>
  /** A note / a folder of the notebook sent as one file. */
  sendNotes(room: string, rel: string, withRuns: boolean, text: string): Promise<void>
  retry(o: Outgoing): void
  discard(o: Outgoing): void
  tellTyping(room: string): void
  /** One's reaction put / taken back. */
  react(m: ChatMessage, emoji: string): Promise<void>
  stopAgent(room: string): void
  /** A link of a message followed (a note — opened in the app; anything else — as links open). */
  follow(link: NoteLinkRef): Promise<void>
  /** A received note / folder put into the notebook and opened: what was done, in words. */
  takeNotes(room: string, f: ChatFile): Promise<string>
}

const CHAT_PORT: InjectionKey<ChatPort> = Symbol('chatPort')
/**
 * The window's chats: also outside its root's tree — a note's blocks are apps of their own, mounted by the editor
 * (componentWidget), and see nothing the root provides.
 */
let windowPort: ChatPort | undefined
/** The chats this window's chat parts work with (its root gives them, for the whole window). */
export function provideChatPort(port: ChatPort): void {
  windowPort = port
  provide(CHAT_PORT, port)
}
export function useChatPort(): ChatPort {
  const port = inject(CHAT_PORT, windowPort)
  if (!port) throw new Error('chatPort: the window gives no chats (provideChatPort at its root)')
  return port
}
