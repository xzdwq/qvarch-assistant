import { ref, watch, type Ref } from 'vue'

/**
 * A block's part folded or open (a result, an answer) — kept per note and block: back from another tab, after a
 * restart, it is as it was left. Only what differs from the block's default is written (a small map in the
 * window's storage).
 */
const KEY = 'qa.folds'
const MAX = 3000
let folds: Record<string, boolean> = {}
try {
  folds = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
} catch {
  folds = {}
}
let timer: ReturnType<typeof setTimeout> | undefined
function persist(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    const keys = Object.keys(folds)
    // (the oldest go past the limit)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete folds[k]
    try {
      localStorage.setItem(KEY, JSON.stringify(folds))
    } catch {
      // (no room — kept for this session)
    }
  }, 300)
}
/** The open / folded state of a block's part (`id` — note, block and part), `def` — as a new block shows it. */
export function useFold(id: () => string, def: boolean): Ref<boolean> {
  const r = ref(folds[id()] ?? def)
  watch(id, (k) => (r.value = folds[k] ?? def))
  watch(r, (v) => {
    const k = id()
    if (v === def) delete folds[k]
    else {
      // (re-set — moves it to the newest)
      delete folds[k]
      folds[k] = v
    }
    persist()
  })
  return r
}
