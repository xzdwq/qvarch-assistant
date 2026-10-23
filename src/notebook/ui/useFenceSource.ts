import { computed, ref, watch, type Ref } from 'vue'
import type { BlockInfo } from '@nb/domain/blockInfo'
import { joinFence, splitFence, type FenceParts } from '@nb/domain/fence'

/**
 * A fenced block's text edited by its component: the body in a field, the info line by buttons — written back into
 * the note a moment after typing stops (at once for a button), the note's own changes taken in. The component's
 * text may be ahead of the note's for that moment: `current()` is what it holds now.
 */
export function useFenceSource(props: { src: string; onChange?: (src: string) => void }, delayMs = 300) {
  /** The block's parts as the note holds them. */
  const parts = computed(() => splitFence(props.src))
  const info = computed(() => parts.value.info)
  /** The body being edited. */
  const body: Ref<string> = ref(parts.value.body)
  /** The text last written (or received): the note's changes that are not ours are taken in. */
  let mine = props.src
  watch(
    () => props.src,
    (s) => {
      if (s === mine) return
      mine = s
      body.value = splitFence(s).body
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The block written into the note: in a moment, or at once. */
  function write(nextInfo?: BlockInfo, now = false): void {
    clearTimeout(timer)
    const go = () => {
      const p = splitFence(mine)
      const src = joinFence(p.fence, nextInfo ?? p.info, body.value)
      if (src === mine) return
      mine = src
      props.onChange?.(src)
    }
    if (now) go()
    else timer = setTimeout(go, delayMs)
  }
  watch(body, () => write())
  /** The info line changed (a name, a flag…) and written at once. */
  const patchInfo = (patch: Partial<BlockInfo>) => write({ ...splitFence(mine).info, ...patch }, true)
  /** What is typed written at once (before a run). */
  const flush = () => write(undefined, true)
  /** The block as the component holds it now: its info line and the body being edited. */
  const current = (): FenceParts => ({ ...splitFence(mine), body: body.value })
  return { parts, info, body, write, patchInfo, flush, current }
}
