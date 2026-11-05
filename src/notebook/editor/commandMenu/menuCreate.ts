import { chatTitleOf } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import { serializeBoard } from '@shared/whiteboard'
import { serverCall } from '@renderer/lib/transport'
import { newChat } from '@renderer/lib/chatActions'
import { freshBoard } from '@renderer/lib/boardPrefs'
import { boardMd } from '@nb/blocks/board/model'
import { chatMd } from '@nb/blocks/chat/model'
import { noteName } from '@nb/domain/notePaths'
import { spaceOfPath } from '@nb/workspace/sharedDocs'
import { loadTree } from '@nb/workspace/vaultTreeStore'

/** What the «@» menu makes before it puts it in: a new board, a new chat. `insert` puts a component's Markdown in. */

/** A new board next to the note (named as typed after «@доска»), put in to be drawn on right there. */
export async function createBoard(name: string, notePath: string, insert: (md: string) => void): Promise<void> {
  const dir = notePath.split('/').slice(0, -1).join('/')
  const path = await window.qa.vaultCreate(dir, 'board', name || undefined, serializeBoard(freshBoard()))
  await loadTree()
  insert(boardMd(path, 'edit'))
}

/**
 * A new chat put in: a shared note's — of its space (its members); a plain note's — one's own alone (people added
 * later), with no server too (its block keeps its title until the server makes it). What went wrong — to `warn`.
 */
export async function createChat(title: string, notePath: string, insert: (md: string) => void, warn: (msg: string) => void): Promise<void> {
  const space = spaceOfPath(notePath)
  const name = title || chatTitleOf(noteName(notePath), new Date())
  try {
    if (space) insert(chatMd((await serverCall('space.chat', { space: space.id, title: name })).id))
    else {
      const made = await newChat(name)
      insert(chatMd(made.id, made.held ? name : undefined))
    }
  } catch (e) {
    warn(remoteError(e))
  }
}
