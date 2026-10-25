import { computed, ref, watch } from 'vue'
import { mediaWaitText, type MediaWait } from '@shared/transport/space'
import { followAudio, followImage, type MediaWatch } from '@nb/workspace/mediaFollow'

/** How each kind of media file is followed. */
const FOLLOW: Record<'image' | 'audio', (rel: string, w: MediaWatch) => () => void> = { image: followImage, audio: followAudio }

/**
 * A note's picture / recording for a component: its address once it is here; while not — where it stands (a shared
 * note's: on its way, waiting…; none known — simply not found). Followed until it comes (mediaFollow) — the one way
 * a component shows a media file.
 */
export function useMediaFile(rel: () => string, kind: keyof typeof FOLLOW) {
  const url = ref('')
  const missing = ref(false)
  const wait = ref<MediaWait>()
  watch(
    rel,
    (r, _was, onCleanup) => {
      url.value = ''
      missing.value = false
      wait.value = undefined
      if (!r) return
      const stop = FOLLOW[kind](r, {
        shown: (u) => {
          url.value = u
          missing.value = false
        },
        missing: (w) => {
          missing.value = true
          wait.value = w
        },
      })
      onCleanup(stop)
    },
    { immediate: true },
  )
  /** Where it stands in words ('' — none known: not found). */
  const waitText = computed(() => (wait.value ? mediaWaitText(wait.value) : ''))
  /** On its way now (its line breathes). */
  const coming = computed(() => wait.value?.state === 'loading')
  return { url, missing, wait, waitText, coming }
}
