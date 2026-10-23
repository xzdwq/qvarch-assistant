<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import type { Note, VoiceState } from '@shared/types'
import { AUDIO_NOTE_LOOK } from '@shared/tracker/constants'
import { fixDuration, transcribeNote } from '../lib/recorder'
import Icon from './Icon.vue'
import ThinkingOrb from './ThinkingOrb.vue'
import { cssHex } from '../lib/cssColor'

/** The audio of a note: a player, the transcript (local whisper) and a "Расшифровать" button. */
const props = defineProps<{ day: string; note: Note; compact?: boolean }>()

const url = ref<string>()
const voice = shallowRef<VoiceState>({ modelReady: false, model: 'small', models: [], busy: [] })
void window.qa.voiceState().then((s) => (voice.value = s))
const off = window.qa.onVoice((s) => (voice.value = s))
const error = ref('')
const busy = computed(() => voice.value.busy.includes(props.note.id))
/** The orb's tint while transcribing (a canvas: the colour as hex). */
const orbTint = cssHex('--audio-transcribing')

async function load(): Promise<void> {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = undefined
  if (!props.note.audio) return
  const bytes = await window.qa.readAudio(props.note.audio.file)
  url.value = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/webm' }))
}
watch(() => props.note.audio?.file, () => void load(), { immediate: true })
onBeforeUnmount(() => {
  off()
  if (url.value) URL.revokeObjectURL(url.value)
})

/** The player knows its length at once (see fixDuration). */
const player = (el: unknown) => {
  if (el instanceof HTMLAudioElement && !el.dataset.fixed) {
    el.dataset.fixed = '1'
    fixDuration(el)
  }
}
const enabled = ref(true)
void window.qa.getSettings().then((s) => (enabled.value = s.voice.enabled))

async function transcribe(): Promise<void> {
  if (!props.note.audio) return
  error.value = ''
  try {
    await transcribeNote(props.day, props.note.id, props.note.audio.file)
  } catch (e) {
    error.value = remoteError(e)
  }
}
</script>

<template>
  <div v-if="note.audio" class="an tw:group/an tw:flex tw:flex-col tw:gap-6 tw:mt-4" :class="{ compact }">
    <div class="arow tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
      <Icon :name="AUDIO_NOTE_LOOK[note.audio.kind].icon" :size="13" class="ai tw:text-warn" :title="AUDIO_NOTE_LOOK[note.audio.kind].label" />
      <audio class="tw:h-30 tw:flex-1 tw:min-w-200 tw:group-[.compact]/an:min-w-160" v-if="url" :ref="player" :src="url" controls preload="metadata"></audio>
      <!-- not transcribed yet: the button sits by the player; while it runs — the orb -->
      <span v-if="busy && !note.transcript" class="orb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28" title="Расшифровка…"><ThinkingOrb class="tw:flex-none tw:[&&]:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28" state="weaving" :size="20" :px="22" :tint="orbTint" /></span>
      <button v-else-if="enabled && voice.modelReady && !note.transcript" class="ib tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-accent-fg tw:cursor-pointer tw:hover:bg-accent/18 tw:hover:enabled:border-border-3" title="Расшифровать (локально)" @click="transcribe"><Icon name="captions" :size="15" /></button>
    </div>
    <div v-if="note.transcript" class="trline tw:flex tw:items-start tw:gap-6">
      <div class="tr tw:flex-1 tw:min-w-0 tw:py-6 tw:px-8 tw:rounded-r2 tw:bg-white/4 tw:text-[12px] tw:leading-[1.45] tw:whitespace-pre-wrap tw:max-h-160 tw:overflow-auto">{{ note.transcript }}</div>
      <span v-if="busy" class="orb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28" title="Расшифровка…"><ThinkingOrb class="tw:flex-none tw:[&&]:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28" state="weaving" :size="20" :px="22" :tint="orbTint" /></span>
      <button v-else-if="enabled && voice.modelReady" class="ib tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-accent-fg tw:cursor-pointer tw:hover:bg-accent/18 tw:hover:enabled:border-border-3" title="Расшифровать заново" @click="transcribe"><Icon name="refresh" :size="13" /></button>
    </div>
    <span v-if="enabled && !voice.modelReady && !note.transcript" class="muted small tw:text-[11px]">Для расшифровки скачайте модель: Настройки → «Распознавание речи»</span>
    <span v-if="error" class="err tw:text-down-fg tw:text-[11px]">{{ error }}</span>
  </div>
</template>

<style scoped src="./AudioNote.css"></style>
