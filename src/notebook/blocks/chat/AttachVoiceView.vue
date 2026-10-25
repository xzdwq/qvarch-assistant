<script setup lang="ts">
/**
 * A voice message: a round play button, its progress (a click — to that moment), its length; «Аа» — its words (the
 * recognizer here, when its model is downloaded), shown under it. The sound is fetched on the first play; one voice
 * plays at a time (another started — this one pauses).
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { clockSec, type ChatFile } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import { chatFileUrl } from '@renderer/lib/chatFiles'
import { canTranscribe } from '@renderer/lib/voiceReady'
import { voiceTextOf } from '@renderer/lib/voiceText'

const props = defineProps<{ file: ChatFile; room: string }>()
const audio = ref<HTMLAudioElement>()
const playing = ref(false)
const at = ref(0)
const length = ref(props.file.sec ?? 0)
const loading = ref(false)
const said = ref('')
const part = computed(() => (length.value ? Math.min(1, at.value / length.value) : 0))

/** The one playing now (any chat). */
let current: HTMLAudioElement | undefined
async function toggle(): Promise<void> {
  const a = audio.value
  if (!a) return
  if (playing.value) return a.pause()
  if (!a.src) {
    loading.value = true
    said.value = ''
    try {
      a.src = await chatFileUrl(props.room, props.file)
    } catch (e) {
      said.value = remoteError(e)
      return
    } finally {
      loading.value = false
    }
  }
  if (current && current !== a) current.pause()
  current = a
  await a.play().catch((e: Error) => (said.value = e.message))
}
function seek(e: MouseEvent): void {
  const a = audio.value
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (!a || !length.value || !a.src) return
  a.currentTime = ((e.clientX - box.left) / box.width) * length.value
}
/** (a recording's header may lack its length: the one the message carries stays then) */
function onMeta(): void {
  const d = audio.value?.duration ?? NaN
  if (Number.isFinite(d) && d > 0) length.value = d
}
onBeforeUnmount(() => audio.value?.pause())

// ---------- its words (as messengers do: a button, the text under it; recognized here, once per run) ----------
const words = ref<string>()
const hearing = ref(false)
const shownWords = ref(false)
async function toWords(): Promise<void> {
  if (words.value !== undefined) return void (shownWords.value = !shownWords.value)
  hearing.value = true
  said.value = ''
  try {
    words.value = (await voiceTextOf(props.room, props.file)) || 'Слов не распознано'
    shownWords.value = true
  } catch (e) {
    said.value = remoteError(e)
  } finally {
    hearing.value = false
  }
}
const time = computed(() => said.value || (loading.value ? 'Загружается…' : playing.value || at.value ? `${clockSec(at.value)} / ${clockSec(length.value)}` : clockSec(length.value)))
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-4 tw:min-w-200 tw:mt-2 tw:py-2">
    <div class="tw:flex tw:items-center tw:gap-8">
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-full tw:bg-accent tw:text-white tw:hover:brightness-110" :title="playing ? 'Пауза' : 'Слушать'" :disabled="loading" @click="toggle">
        <Icon :name="playing ? 'pause' : 'play'" :size="15" />
      </button>
      <span class="tw:flex tw:flex-col tw:flex-1 tw:gap-4 tw:min-w-0">
        <span class="tw:relative tw:h-4 tw:rounded-full tw:bg-text/15 tw:cursor-pointer" @click="seek">
          <span class="tw:absolute tw:inset-y-0 tw:left-0 tw:rounded-full tw:bg-accent" :style="{ width: `${part * 100}%` }"></span>
        </span>
        <span class="tw:text-muted tw:text-[11px] tw:font-data">{{ time }}</span>
      </span>
      <button
        v-if="canTranscribe || words !== undefined"
        class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-full tw:bg-text/10 tw:text-muted tw:hover:enabled:bg-text/18 tw:hover:enabled:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-accent-fg"
        :class="{ on: shownWords }"
        :title="hearing ? 'Расшифровывается…' : shownWords ? 'Скрыть текст' : 'Расшифровать в текст (локально)'"
        :disabled="hearing"
        @click="toWords"
      >
        <Icon :name="hearing ? 'clock' : 'captions'" :size="14" />
      </button>
      <audio ref="audio" preload="none" class="tw:hidden" @play="playing = true" @pause="playing = false" @ended="(playing = false), (at = 0)" @timeupdate="at = audio!.currentTime" @loadedmetadata="onMeta"></audio>
    </div>
    <p v-if="shownWords && words" class="tw:m-0 tw:py-4 tw:px-8 tw:rounded-[10px] tw:bg-bg/30 tw:text-text tw:text-[12.5px] tw:leading-[1.45] tw:whitespace-pre-wrap tw:wrap-anywhere">{{ words }}</p>
  </div>
</template>
