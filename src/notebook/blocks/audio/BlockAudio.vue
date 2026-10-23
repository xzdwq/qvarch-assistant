<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AUDIO_EMBED } from '@shared/vault'
import { audioUrl, fixDuration, transcribing } from '@renderer/lib/notebook'
import Icon from '@renderer/components/Icon.vue'
import ThinkingOrb from '@renderer/components/ThinkingOrb.vue'

/** A voice recording of the note: its player, «Расшифровать» (the text goes under it), delete. */
const props = defineProps<{ src: string; onTranscribe?: (rel: string) => void; onDropAudio?: (rel: string) => void }>()
const rel = computed(() => AUDIO_EMBED.exec(props.src.trim())?.[1] ?? '')
const url = ref('')
const missing = ref(false)
const player = ref<HTMLAudioElement>()
watch(
  rel,
  (r) => {
    missing.value = false
    if (r)
      void audioUrl(r)
        .then((u) => (url.value = u))
        .catch(() => (missing.value = true))
  },
  { immediate: true },
)
watch(player, (a) => a && fixDuration(a))
const state = computed(() => transcribing.get(rel.value) ?? '')
function drop(): void {
  if (confirm('Удалить аудиозапись из заметки и с диска? Текст расшифровки останется.')) props.onDropAudio?.(rel.value)
}
</script>

<template>
  <div class="au tw:inline-flex tw:items-center tw:gap-8 tw:max-w-full tw:pt-4 tw:pr-6 tw:pb-4 tw:pl-8 tw:border tw:border-border-2 tw:rounded-[10px] tw:bg-panel tw:[&.missing]:border-dashed" :class="{ missing }">
    <span class="au-ic tw:inline-flex tw:text-accent-fg"><Icon name="mic" :size="14" /></span>
    <span v-if="missing" class="au-miss tw:text-muted tw:text-[12.5px]">Файл записи не найден</span>
    <audio class="tw:h-32 tw:max-w-full" v-else ref="player" :src="url || undefined" controls preload="metadata"></audio>
    <span v-if="state === 'run'" class="au-orb tw:inline-flex" title="Расшифровка… (удалите запись — расшифровка остановится)"><ThinkingOrb state="weaving" :size="20" :px="22" tint="var(--accent-fg)" /></span>
    <button v-else-if="!missing" class="au-b tw:inline-flex tw:items-center tw:justify-center tw:w-30 tw:h-30 tw:p-0 tw:border-0 tw:rounded-[7px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" :title="state === 'error' ? 'Расшифровать ещё раз (прошлая попытка не удалась)' : 'Расшифровать (локально) — текст строкой ниже'" @mousedown.prevent @click="onTranscribe?.(rel)"><Icon name="captions" :size="15" /></button>
    <button class="au-b del tw:inline-flex tw:items-center tw:justify-center tw:w-30 tw:h-30 tw:p-0 tw:border-0 tw:rounded-[7px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-down-fg tw:hover:enabled:border-border-3" title="Удалить запись из заметки и с диска (текст расшифровки останется)" @mousedown.prevent @click="drop"><Icon name="trash" :size="14" /></button>
  </div>
</template>
