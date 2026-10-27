import { resolveWiki } from '@shared/vault'
import type { ChatPort } from '@nb/blocks/chat/chatPort'
import { openNoteAt } from '@nb/workspace/noteGoto'
import { files, loadTree } from '@nb/workspace/vaultTreeStore'
import { agentWork, stopAgentIn } from './agentTurns'
import { chatMe, chatOnline, chatPrefs, discardMessage, isComplete, isHeld, loadOlder, messagesOf, pendingOf, retryMessage, roomOf, sendMessage, showRoom, tellTyping, toggleReaction, typingIn } from './chat'
import { notesToNotebook, sendFile, sendNotes, sendVoice } from './chatFiles'
import { openUrl } from './links'
import { openNote } from './mentions'

/** The main window's chats as its chat parts see them: the chats themselves (lib/chat), the agents, the notebook. */
export const chatPortLocal: ChatPort = {
  me: chatMe,
  online: chatOnline,
  prefs: chatPrefs,
  roomOf,
  messagesOf,
  pendingOf,
  isComplete,
  typingIn,
  workingIn: (id) => agentWork.value.get(id),
  isHeld,
  show: showRoom,
  loadOlder,
  send: sendMessage,
  sendFile,
  sendVoice,
  sendNotes,
  retry: retryMessage,
  discard: discardMessage,
  tellTyping,
  react: toggleReaction,
  stopAgent: stopAgentIn,
  async follow(l) {
    if (l.kind !== 'note') return openUrl(l.target)
    if (!files.value.length) await loadTree()
    const path = resolveWiki(l.target, files.value)
    if (path) await openNoteAt(path, l.section)
  },
  async takeNotes(room, f) {
    const r = await notesToNotebook(room, f)
    await loadTree()
    await openNote(r.main)
    return r.folder ? `Добавлено в Блокнот: папка «${r.folder}»` : 'Добавлено в Блокнот'
  },
}
