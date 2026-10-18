<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AUDIO_EMBED } from '@shared/vault'
import { audioUrl, fixDuration, transcribing } from '../../lib/notebook'
import Icon from '../Icon.vue'
import ThinkingOrb from '../ThinkingOrb.vue'

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
  <div class="au" :class="{ missing }">
    <span class="au-ic"><Icon name="mic" :size="14" /></span>
    <span v-if="missing" class="au-miss">Файл записи не найден</span>
    <audio v-else ref="player" :src="url || undefined" controls preload="metadata"></audio>
    <span v-if="state === 'run'" class="au-orb" title="Расшифровка… (удалите запись — расшифровка остановится)"><ThinkingOrb state="weaving" :size="20" :px="22" tint="var(--accent-fg)" /></span>
    <button v-else-if="!missing" class="au-b" :title="state === 'error' ? 'Расшифровать ещё раз (прошлая попытка не удалась)' : 'Расшифровать (локально) — текст строкой ниже'" @mousedown.prevent @click="onTranscribe?.(rel)"><Icon name="captions" :size="15" /></button>
    <button class="au-b del" title="Удалить запись из заметки и с диска (текст расшифровки останется)" @mousedown.prevent @click="drop"><Icon name="trash" :size="14" /></button>
  </div>
</template>

<style scoped>
.au {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 4px 6px 4px 8px;
  border: 1px solid var(--border-2);
  border-radius: 10px;
  background: var(--panel);
}
.au.missing {
  border-style: dashed;
}
.au-ic {
  display: inline-flex;
  color: var(--accent-fg);
}
.au-miss {
  color: var(--muted);
  font-size: 12.5px;
}
audio {
  height: 32px;
  max-width: 100%;
}
.au-b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
}
.au-b:hover {
  background: var(--hover);
  color: var(--text);
}
.au-b.del:hover {
  color: var(--down-fg);
}
.au-orb {
  display: inline-flex;
}
</style>
