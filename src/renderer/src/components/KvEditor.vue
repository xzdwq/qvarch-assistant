<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { HttpKV } from '@shared/http'
import Icon from './Icon.vue'

/**
 * Rows «key = value» with an on/off box; one empty row is always at the end (typing in it adds a row).
 * `secrets` — the variables' editor: a lock per row makes the value a secret (hidden, kept encrypted).
 */
const props = defineProps<{ rows: HttpKV[]; keyHint?: string; valueHint?: string; secrets?: boolean }>()
/** Secret values shown for a moment (the eye). */
const shown = reactive(new Set<number>())
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
  <div class="kv" :class="{ sec: secrets }">
    <div v-for="(r, i) in rows" :key="i" class="kr" :class="{ off: !r.on }">
      <input v-model="r.on" type="checkbox" title="Отправлять" :disabled="!r.key && !r.value" />
      <input v-model="r.key" class="k" :placeholder="keyHint ?? 'ключ'" spellcheck="false" />
      <span v-if="secrets" class="vw">
        <input v-model="r.value" class="v" :type="r.secret && !shown.has(i) ? 'password' : 'text'" :placeholder="valueHint ?? 'значение · {{переменная}}'" spellcheck="false" autocomplete="off" />
        <button v-if="r.secret && r.value" class="eye" :title="shown.has(i) ? 'Скрыть' : 'Показать'" @click="shown.has(i) ? shown.delete(i) : shown.add(i)"><Icon :name="shown.has(i) ? 'eyeOff' : 'eye'" :size="12" /></button>
      </span>
      <input v-else v-model="r.value" class="v" :placeholder="valueHint ?? 'значение · {{переменная}}'" spellcheck="false" />
      <button v-if="secrets" class="lock" :class="{ on: r.secret }" :title="r.secret ? 'Секрет: скрыт и хранится зашифрованным. Клик — сделать обычной' : 'Сделать секретом (скрыть, хранить зашифрованным)'" :disabled="!r.key" @click="r.secret = !r.secret || undefined"><Icon name="lock" :size="12" /></button>
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
.kv.sec .kr {
  grid-template-columns: 28px minmax(0, 1fr) minmax(0, 2fr) 28px 28px;
}
.vw {
  position: relative;
  display: flex;
  min-width: 0;
}
.vw input {
  flex: 1;
  min-width: 0;
}
.eye {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.lock {
  display: inline-flex;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dim);
}
.lock.on {
  color: var(--warn);
}
.lock:disabled {
  opacity: 0.3;
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
