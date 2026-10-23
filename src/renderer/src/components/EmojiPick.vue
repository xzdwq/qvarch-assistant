<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { loadEmoji, searchEmoji, type Emoji } from '../lib/emoji'

/** Emoji to pick: searched by a Russian or an English word, the recently used first. */
const emit = defineEmits<{ pick: [u: string] }>()
const all = shallowRef<Emoji[]>([])
void loadEmoji().then((l) => (all.value = l))
const q = ref('')
const list = computed(() => searchEmoji(all.value, q.value, 320))
const hover = ref<Emoji>()
const input = ref<HTMLInputElement>()
onMounted(() => input.value?.focus())
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && list.value[0]) {
    e.preventDefault()
    emit('pick', list.value[0].u)
  }
}
</script>

<template>
  <div class="ep tw:flex tw:flex-col tw:gap-6 tw:w-340 tw:p-8 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
    <input class="tw:h-30" ref="input" v-model="q" spellcheck="false" placeholder="Поиск: сердце, star, огонь…" @keydown="onKey" />
    <div class="ep-grid tw:grid tw:grid-cols-[repeat(9,1fr)] tw:gap-2 tw:max-h-250 tw:overflow-y-auto">
      <button class="tw:h-34 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:font-['Segoe_UI_Emoji','Apple_Color_Emoji','Noto_Color_Emoji',sans-serif] tw:text-[20px] tw:hover:bg-accent/20" v-for="e in list" :key="e.u" :title="`${e.ru} · ${e.en}`" @mouseenter="hover = e" @click="emit('pick', e.u)">{{ e.u }}</button>
      <p v-if="!list.length" class="ep-e tw:col-span-full tw:m-8 tw:text-muted tw:text-[12.5px]">{{ all.length ? 'Не нашлось' : 'Загружаю…' }}</p>
    </div>
    <div class="ep-f tw:overflow-hidden tw:text-muted tw:text-[11.5px] tw:text-ellipsis tw:whitespace-nowrap">{{ hover ? `${hover.u}  ${hover.ru}` : 'Enter — первый найденный' }}</div>
  </div>
</template>
