<script setup lang="ts">
import { watch } from 'vue'
import type { HttpKV } from '@shared/http'
import Icon from './Icon.vue'

/** Rows «key = value» with an on/off box; one empty row is always at the end (typing in it adds a row). */
const props = defineProps<{ rows: HttpKV[]; keyHint?: string; valueHint?: string }>()
// the empty last row
watch(
  () => props.rows.length && props.rows[props.rows.length - 1],
  () => {
    const last = props.rows[props.rows.length - 1]
    if (!last || last.key || last.value) props.rows.push({ on: true, key: '', value: '' })
  },
  { immediate: true, deep: true },
)
function drop(i: number): void {
  props.rows.splice(i, 1)
}
</script>

<template>
  <div class="kv">
    <div v-for="(r, i) in rows" :key="i" class="kr" :class="{ off: !r.on }">
      <input v-model="r.on" type="checkbox" title="Отправлять" :disabled="!r.key && !r.value" />
      <input v-model="r.key" class="k" :placeholder="keyHint ?? 'ключ'" spellcheck="false" />
      <input v-model="r.value" class="v" :placeholder="valueHint ?? 'значение · {{переменная}}'" spellcheck="false" />
      <button v-if="r.key || r.value" class="x" title="Удалить" @click="drop(i)"><Icon name="x" :size="12" /></button>
      <span v-else class="x"></span>
    </div>
  </div>
</template>

<style scoped>
.kv {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  overflow: hidden;
}
.kr {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 2fr) 28px;
  align-items: center;
  border-bottom: 1px solid var(--border);
}
.kr:last-child {
  border-bottom: 0;
}
.kr input[type='checkbox'] {
  justify-self: center;
}
.kr input:not([type='checkbox']) {
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-left: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  font-family: var(--font-data);
  font-size: 12.5px;
}
.kr input:not([type='checkbox']):focus {
  background: var(--field-bg);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.kr.off input:not([type='checkbox']) {
  opacity: 0.45;
}
.x {
  display: inline-flex;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.x:hover {
  color: var(--down-fg);
}
</style>
