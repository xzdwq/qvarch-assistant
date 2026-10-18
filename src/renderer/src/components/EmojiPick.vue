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
  <div class="ep">
    <input ref="input" v-model="q" spellcheck="false" placeholder="Поиск: сердце, star, огонь…" @keydown="onKey" />
    <div class="ep-grid">
      <button v-for="e in list" :key="e.u" :title="`${e.ru} · ${e.en}`" @mouseenter="hover = e" @click="emit('pick', e.u)">{{ e.u }}</button>
      <p v-if="!list.length" class="ep-e">{{ all.length ? 'Не нашлось' : 'Загружаю…' }}</p>
    </div>
    <div class="ep-f">{{ hover ? `${hover.u}  ${hover.ru}` : 'Enter — первый найденный' }}</div>
  </div>
</template>

<style scoped>
.ep {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 340px;
  padding: 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.ep input {
  height: 30px;
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 2px;
  max-height: 250px;
  overflow-y: auto;
}
.ep-grid button {
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 20px;
}
.ep-grid button:hover {
  background: rgb(var(--accent-rgb) / 0.2);
}
.ep-e {
  grid-column: 1 / -1;
  margin: 8px;
  color: var(--muted);
  font-size: 12.5px;
}
.ep-f {
  overflow: hidden;
  color: var(--muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
