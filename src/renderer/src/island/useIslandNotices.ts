import { onBeforeUnmount, ref } from 'vue'
import { withNotice, type IslandNotice } from '@shared/islandNotice'

/** A reminder shown by itself stays this long (the island busy with something else — only its count grows). */
const SHOWN_MS = 12_000

/**
 * The reminders in the island: one fired opens its area a few seconds (nothing else open there); they wait, counted,
 * until seen — the area closed by hand forgets them, one opened in the app is gone too.
 */
export function useIslandNotices(hooks: { busy: () => boolean; closeOthers: () => void }) {
  const list = ref<IslandNotice[]>([])
  const open = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  onBeforeUnmount(
    window.qa.onIslandNotice((n) => {
      list.value = withNotice(list.value, n)
      if (open.value || hooks.busy()) return
      open.value = true
      clearTimeout(timer)
      timer = setTimeout(() => (open.value = false), SHOWN_MS)
    }),
  )
  /** Shown by hand (stays until closed). */
  function show(): void {
    hooks.closeOthers()
    clearTimeout(timer)
    open.value = true
  }
  /** Closed by hand: the ones shown are seen. */
  function close(): void {
    clearTimeout(timer)
    open.value = false
    list.value = []
  }
  /** Seen while it is open (the pointer over it): it stays. */
  const hold = () => clearTimeout(timer)
  function openInApp(n: IslandNotice): void {
    window.qa.openMain(n.day, n.entryId)
    list.value = list.value.filter((x) => x.id !== n.id)
    if (!list.value.length) close()
  }
  return { list, open, show, close, hold, openInApp }
}
export type IslandNotices = ReturnType<typeof useIslandNotices>
