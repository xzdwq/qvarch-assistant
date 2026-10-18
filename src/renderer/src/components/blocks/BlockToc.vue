<script setup lang="ts">
import Icon from '../Icon.vue'

/** The note's table of contents: its headings, a click goes there (it follows the text by itself). */
defineProps<{ headings: Array<{ level: number; text: string; pos: number }> }>()
const emit = defineEmits<{ go: [pos: number] }>()
</script>

<template>
  <div class="toc">
    <div class="toc-h"><Icon name="list" :size="13" />Оглавление</div>
    <button v-for="(h, i) in headings" :key="i" class="toc-i" :style="{ paddingLeft: `${(h.level - 1) * 16 + 8}px` }" @mousedown.prevent @click="emit('go', h.pos)">{{ h.text }}</button>
    <p v-if="!headings.length" class="toc-e">Заголовков пока нет — начните строку с # , ## или ###</p>
  </div>
</template>

<style scoped>
.toc {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.toc-h {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 12px;
}
.toc-i {
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--accent-fg);
  font-size: 0.92em;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-i:hover {
  background: var(--hover);
  text-decoration: underline;
}
.toc-e {
  margin: 2px 8px;
  color: var(--muted);
  font-size: 12.5px;
}
</style>
