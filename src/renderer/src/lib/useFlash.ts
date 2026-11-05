import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

/**
 * A mark shown for a moment ("Скопировано ✓", the row just touched), then cleared by itself. A new mark replaces
 * the shown one and gets the whole time again. `T` — what is marked (`true` for a plain "done"); `ms` — how long, unless
 * a mark asks for its own.
 */
export function useFlash<T = true>(ms: number): { shown: Ref<T | undefined>; flash: (v: T, forMs?: number) => void } {
  const shown = ref<T>() as Ref<T | undefined>
  let timer: ReturnType<typeof setTimeout> | undefined
  function flash(v: T, forMs = ms): void {
    shown.value = v
    clearTimeout(timer)
    timer = setTimeout(() => (shown.value = undefined), forMs)
  }
  if (getCurrentScope()) onScopeDispose(() => clearTimeout(timer))
  return { shown, flash }
}
