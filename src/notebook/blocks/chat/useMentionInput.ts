import { computed, ref, type Ref } from 'vue'

/** One who may be mentioned: a person, an agent. */
type DeviceInfo = { id: string; name: string }

/** «@» and the start of a name right before the cursor (a word's start). */
const AT = /(?:^|[\s(«"'])@([^\s@]{0,30})$/

/**
 * «@» in a message's input: the room's members whose name starts as typed (not oneself); ↑ ↓ pick, Enter / Tab put
 * `@Имя ` in, Esc closes. The list is drawn by the input's owner (above the input).
 */
export function useMentionInput(text: Ref<string>, input: Ref<HTMLTextAreaElement | undefined>, members: () => DeviceInfo[], me: () => string) {
  const caret = ref(0)
  const pick = ref(0)
  const closedAt = ref(-1)
  const query = computed(() => {
    const m = AT.exec(text.value.slice(0, caret.value))
    return m && caret.value - m[1].length - 1 !== closedAt.value ? m[1] : undefined
  })
  const options = computed(() => {
    const q = query.value
    if (q === undefined) return []
    return members()
      .filter((d) => d.id !== me() && d.name.toLowerCase().startsWith(q.toLowerCase()))
      .slice(0, 6)
  })
  /** The cursor's place followed (typing, clicks, arrows). */
  function track(): void {
    caret.value = input.value?.selectionStart ?? text.value.length
    if (pick.value >= options.value.length) pick.value = 0
  }
  /** A member's name put in place of «@…». */
  function choose(d: DeviceInfo): void {
    const at = caret.value
    const start = at - (query.value?.length ?? 0) - 1
    text.value = `${text.value.slice(0, start)}@${d.name} ${text.value.slice(at)}`
    const to = start + d.name.length + 2
    requestAnimationFrame(() => {
      input.value?.setSelectionRange(to, to)
      input.value?.focus()
      track()
    })
  }
  /** The list's keys (true — the key was the list's). */
  function onKey(e: KeyboardEvent): boolean {
    const n = options.value.length
    if (!n) return false
    const KEYS: Record<string, () => void> = {
      ArrowDown: () => (pick.value = (pick.value + 1) % n),
      ArrowUp: () => (pick.value = (pick.value - 1 + n) % n),
      Enter: () => choose(options.value[pick.value]),
      Tab: () => choose(options.value[pick.value]),
      Escape: () => (closedAt.value = caret.value - (query.value?.length ?? 0) - 1),
    }
    const fn = KEYS[e.key]
    if (!fn) return false
    e.preventDefault()
    fn()
    return true
  }
  return { options, pick, track, choose, onKey }
}
