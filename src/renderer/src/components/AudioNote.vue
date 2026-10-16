<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Note, VoiceState } from '@shared/types'
import { fixDuration, transcribeNote } from '../lib/recorder'
import Icon from './Icon.vue'
import ThinkingOrb from './ThinkingOrb.vue'

/** The audio of a note: a player, the transcript (local whisper) and a "Расшифровать" button. */
const props = defineProps<{ day: string; note: Note; compact?: boolean }>()

const url = ref<string>()
const voice = shallowRef<VoiceState>({ modelReady: false, model: 'small', models: [], busy: [] })
void window.qa.voiceState().then((s) => (voice.value = s))
const off = window.qa.onVoice((s) => (voice.value = s))
const error = ref('')
const busy = computed(() => voice.value.busy.includes(props.note.id))

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
    error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  }
}
</script>

<template>
  <div v-if="note.audio" class="an" :class="{ compact }">
    <div class="arow">
      <Icon :name="note.audio.kind === 'call' ? 'phone' : 'mic'" :size="13" class="ai" :title="note.audio.kind === 'call' ? 'Запись звонка' : 'Голосовая заметка'" />
      <audio v-if="url" :ref="player" :src="url" controls preload="metadata"></audio>
      <!-- not transcribed yet: the button sits by the player; while it runs — the orb -->
      <span v-if="busy && !note.transcript" class="orb" title="Расшифровка…"><ThinkingOrb state="weaving" :size="20" :px="22" tint="#ffa25c" /></span>
      <button v-else-if="enabled && voice.modelReady && !note.transcript" class="ib" title="Расшифровать (локально)" @click="transcribe"><Icon name="captions" :size="15" /></button>
    </div>
    <div v-if="note.transcript" class="trline">
      <div class="tr">{{ note.transcript }}</div>
      <span v-if="busy" class="orb" title="Расшифровка…"><ThinkingOrb state="weaving" :size="20" :px="22" tint="#ffa25c" /></span>
      <button v-else-if="enabled && voice.modelReady" class="ib" title="Расшифровать заново" @click="transcribe"><Icon name="refresh" :size="13" /></button>
    </div>
    <span v-if="enabled && !voice.modelReady && !note.transcript" class="muted small">Для расшифровки скачайте модель: Настройки → «Распознавание речи»</span>
    <span v-if="error" class="err">{{ error }}</span>
  </div>
</template>

<style scoped>
.an {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.trline {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.trline .tr {
  flex: 1;
  min-width: 0;
}
.ib {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--accent-fg);
  cursor: pointer;
}
.ib:hover {
  background: rgb(var(--accent-rgb) / 0.18);
}
.orb {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}
.arow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ai {
  color: var(--warn);
}
audio {
  height: 30px;
  flex: 1;
  min-width: 200px;
}
.compact audio {
  min-width: 160px;
}
.tr {
  padding: 6px 8px;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}
.small {
  font-size: 11px;
}
.lb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  font-size: 11px;
  cursor: pointer;
}
.err {
  color: var(--down-fg);
  font-size: 11px;
}
.spin {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 5px;
  border: 2px solid rgb(var(--accent-rgb) / 0.3);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: sp 0.8s linear infinite;
}
@keyframes sp {
  to {
    transform: rotate(360deg);
  }
}
</style>
