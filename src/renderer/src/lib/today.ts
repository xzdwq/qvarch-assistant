import { ref, watch } from 'vue'
import { dayKey } from '@shared/timeline'

/**
 * Today's date for the whole window — it follows the clock: checked every 20 s and at once when the window
 * comes back (the laptop woke up, the window was shown), so a page opened yesterday turns to today by itself.
 */
export const todayKey = ref(dayKey(Date.now()))
function check(): void {
  const d = dayKey(Date.now())
  if (d !== todayKey.value) todayKey.value = d
}
setInterval(check, 20_000)
window.addEventListener('focus', check)
document.addEventListener('visibilitychange', check)

/** Called when the date changes (prev → next): a page that was showing "today" moves on with it. */
export function onNewDay(cb: (prev: string, next: string) => void): () => void {
  return watch(todayKey, (next, prev) => cb(prev, next))
}
