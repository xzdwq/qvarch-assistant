import type { ChatRoom } from '@shared/transport/chat'
import { ROLE_RIGHTS } from '@shared/transport/space'
import { spaces } from '@nb/workspace/sharedDocs'

/**
 * May this device write in a room: a shared note's chat or comment — by its role in the note (as the server checks
 * it; the role not known yet — yes: the server refuses if not); any other chat — its members.
 */
export function mayWriteIn(r: ChatRoom): boolean {
  if (!r.space) return true
  const role = spaces.get(r.space)?.role
  return !role || ROLE_RIGHTS[role].chat
}
