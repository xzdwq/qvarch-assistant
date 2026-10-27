import { ref } from 'vue'
import { REACTIONS } from '@shared/transport/chat'

/**
 * The reactions offered first: the ones this person puts most, kept on this computer (main process) — the same in
 * every window (the island's chat too).
 */
export const quickReactions = ref<string[]>([...REACTIONS])
let asked = false
export function loadQuickReactions(): void {
  if (asked) return
  asked = true
  void window.qa.chatQuickReactions().then((q) => (quickReactions.value = q), () => (asked = false))
}
/** A reaction put: counted (it may move up). */
export function countReaction(emoji: string): void {
  void window.qa.chatReactionPut(emoji).then((q) => (quickReactions.value = q), () => undefined)
}
