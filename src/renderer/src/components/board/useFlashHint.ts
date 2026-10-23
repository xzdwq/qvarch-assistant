import { ref } from 'vue'

/** A hint shown over the sheet for a moment (the size the wheel just set, the shape a stroke became). */
export function useFlashHint() {
  const text = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Shown now, gone after `ms`. */
  function flash(t: string, ms: number): void {
    text.value = t
    clearTimeout(timer)
    timer = setTimeout(() => (text.value = ''), ms)
  }
  /** Gone now. */
  const hide = () => void (text.value = '')
  return { text, flash, hide }
}
export type FlashHint = ReturnType<typeof useFlashHint>
