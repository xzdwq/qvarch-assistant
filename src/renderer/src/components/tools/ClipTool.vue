<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { ClipItem, ClipState } from '@shared/clip'
import Icon from '../Icon.vue'

/**
 * The clipboard's history: what was copied (anywhere), by day, newest first; a click puts it back on the
 * clipboard. Kept encrypted on this computer, the last 1000; password managers' copies are not kept.
 */
const state = shallowRef<ClipState>({ on: true, items: [] })
void window.qa.clipGet().then((s) => (state.value = s))
const off = window.qa.onClip((s) => (state.value = s))
onBeforeUnmount(off)
const q = ref('')
const shown = computed(() => {
  const w = q.value.trim().toLowerCase()
  return w ? state.value.items.filter((x) => x.text.toLowerCase().includes(w)) : state.value.items
})
const dayKey = (t: number) => new Date(t).toLocaleDateString('sv-SE')
const dayName = (k: string) => {
  const today = new Date().toLocaleDateString('sv-SE')
  const y = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE')
  return k === today ? 'Сегодня' : k === y ? 'Вчера' : new Date(`${k}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}
const groups = computed(() => {
  const m = new Map<string, ClipItem[]>()
  for (const x of shown.value) m.set(dayKey(x.at), [...(m.get(dayKey(x.at)) ?? []), x])
  return [...m].map(([k, items]) => ({ k, name: dayName(k), items }))
})
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const open = ref(new Set<string>())
const long = (t: string) => t.length > 280 || t.split('\n').length > 4
function toggle(id: string): void {
  const s = new Set(open.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  open.value = s
}
const copied = ref('')
async function copy(x: ClipItem): Promise<void> {
  await window.qa.clipCopy(x.id)
  copied.value = x.id
  setTimeout(() => copied.value === x.id && (copied.value = ''), 1200)
}
async function setOn(on: boolean): Promise<void> {
  state.value = await window.qa.clipSet(on)
}
function clearAll(): void {
  if (confirm(`Удалить всю историю буфера обмена (${state.value.items.length})?`)) void window.qa.clipClear()
}
</script>

<template>
  <div class="cl">
    <div class="bar">
      <label class="sw" :title="state.on ? 'История ведётся' : 'История не ведётся'"><input type="checkbox" :checked="state.on" @change="setOn(($event.target as HTMLInputElement).checked)" /><i></i>Сохранять историю</label>
      <label class="search"><Icon name="search" :size="13" /><input v-model="q" spellcheck="false" placeholder="Поиск по скопированному" /></label>
      <span class="grow"></span>
      <span class="muted">{{ q ? `${shown.length} из ${state.items.length}` : `${state.items.length} из 1000` }}</span>
      <button class="ib" title="Очистить историю" :disabled="!state.items.length" @click="clearAll"><Icon name="trash" :size="14" /></button>
    </div>
    <div class="list">
      <template v-for="g in groups" :key="g.k">
        <div class="day">{{ g.name }}</div>
        <div v-for="x in g.items" :key="x.id" class="it" :class="{ done: copied === x.id }" title="Клик — скопировать снова" @click="copy(x)">
          <span class="tm">{{ hm(x.at) }}</span>
          <pre class="tx" :class="{ clip: long(x.text) && !open.has(x.id) }">{{ x.text }}</pre>
          <span class="acts" @click.stop>
            <b v-if="x.count > 1" class="cnt" :title="`Копировали ${x.count} раз`">×{{ x.count }}</b>
            <button v-if="long(x.text)" class="ib sm" :title="open.has(x.id) ? 'Свернуть' : 'Показать целиком'" @click="toggle(x.id)"><Icon name="chevronDown" :size="12" :style="open.has(x.id) ? 'transform: rotate(180deg)' : ''" /></button>
            <button class="ib sm" title="Удалить" @click="window_remove(x.id)"><Icon name="x" :size="12" /></button>
          </span>
          <span v-if="copied === x.id" class="ok">Скопировано</span>
        </div>
      </template>
      <p v-if="!state.items.length" class="empty">
        {{ state.on ? 'Пока пусто. Всё, что вы скопируете (Ctrl+C) в любой программе, появится здесь.' : 'История выключена — включите «Сохранять историю».' }}
      </p>
      <p v-else-if="!shown.length" class="empty">Ничего не нашлось</p>
      <p class="foot">Только текст. Хранятся последние 1000 записей, зашифрованно, только на этом компьютере. То, что менеджеры паролей помечают как «не сохранять в истории», не сохраняется.</p>
    </div>
  </div>
</template>

<script lang="ts">
const window_remove = (id: string) => void window.qa.clipRemove(id)
</script>

<style scoped>
.cl {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 38px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.sw {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}
.sw input {
  display: none;
}
.sw i {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--panel-3);
  transition: background 0.15s;
}
.sw i::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-2);
  transition: transform 0.15s;
}
.sw input:checked + i {
  background: var(--accent);
}
.sw input:checked + i::after {
  transform: translateX(12px);
  background: #fff;
}
.search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: min(320px, 40%);
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  color: var(--muted);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib.sm {
  width: 22px;
  height: 22px;
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.35;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 14px;
}
.day {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 12px 0 6px;
  background: var(--bg);
  color: var(--text-hi);
  font-size: 12.5px;
  font-weight: 600;
}
.day::first-letter {
  text-transform: uppercase;
}
.it {
  position: relative;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 7px 8px;
  border-radius: var(--r2);
  cursor: pointer;
}
.it:hover {
  background: var(--hover);
}
.it.done {
  background: rgba(0, 230, 118, 0.08);
}
.tm {
  padding-top: 1px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.tx {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.tx.clip {
  max-height: 6em;
  -webkit-mask-image: linear-gradient(#000 60%, transparent);
  mask-image: linear-gradient(#000 60%, transparent);
}
.acts {
  display: flex;
  align-items: center;
  gap: 2px;
}
.cnt {
  padding: 0 6px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 500;
}
.it .ib.sm {
  opacity: 0;
}
.it:hover .ib.sm {
  opacity: 1;
}
.ok {
  position: absolute;
  right: 70px;
  top: 7px;
  color: var(--up-fg);
  font-size: 11.5px;
}
.empty {
  margin: 20px 0;
  color: var(--muted);
  font-size: 13px;
}
.foot {
  margin: 16px 0 0;
  color: var(--dim);
  font-size: 11.5px;
}
</style>
