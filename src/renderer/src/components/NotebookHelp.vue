<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { HELP } from '../lib/helpContent'
import Icon from './Icon.vue'

/** «Инструкция»: the notebook's and the testing tools' help — sections on the left, the section on the right, a search. */
const emit = defineEmits<{ close: [] }>()
const q = ref('')
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').toLowerCase()
const shown = computed(() => {
  const w = q.value.trim().toLowerCase()
  return w ? HELP.filter((s) => `${s.title} ${textOf(s.html)}`.toLowerCase().includes(w)) : HELP
})
const cur = ref(HELP[0].id)
const sec = computed(() => shown.value.find((s) => s.id === cur.value) ?? shown.value[0])
const body = ref<HTMLElement>()
function pick(id: string): void {
  cur.value = id
  void nextTick(() => body.value?.scrollTo({ top: 0 }))
}
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="hl-back" @mousedown.self="emit('close')">
      <div class="hl" role="dialog" aria-label="Инструкция">
        <nav>
          <label class="hl-q"><Icon name="search" :size="12" /><input v-model="q" placeholder="Поиск по инструкции" spellcheck="false" /></label>
          <template v-for="g in ['Блокнот', 'Тестирование']" :key="g">
            <p v-if="shown.some((s) => s.group === g)" class="hl-g">{{ g }}</p>
            <button v-for="s in shown.filter((x) => x.group === g)" :key="s.id" :class="{ on: sec?.id === s.id }" @click="pick(s.id)"><Icon :name="s.icon" :size="13" /><span>{{ s.title }}</span></button>
          </template>
          <p v-if="!shown.length" class="hl-none">Ничего не найдено</p>
        </nav>
        <section ref="body">
          <header>
            <h2 v-if="sec">{{ sec.title }}</h2>
            <span class="grow"></span>
            <button class="hl-x" title="Закрыть (Esc)" @click="emit('close')"><Icon name="x" :size="14" /></button>
          </header>
          <!-- (the help's own static text — no one else's) -->
          <div v-if="sec" class="hl-body" v-html="sec.html"></div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.hl-back {
  position: fixed;
  inset: 0;
  z-index: 1800;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.45);
}
.hl {
  display: flex;
  width: min(980px, calc(100vw - 32px));
  height: min(720px, calc(100vh - 48px));
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: var(--shadow);
  overflow: hidden;
}
nav {
  display: flex;
  flex: 0 0 230px;
  flex-direction: column;
  gap: 1px;
  padding: 10px 8px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.hl-q {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--field-bg);
  color: var(--muted);
}
.hl-q input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.hl-g {
  margin: 10px 8px 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
nav button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  white-space: nowrap;
}
nav button span {
  overflow: hidden;
  text-overflow: ellipsis;
}
nav button:hover {
  background: var(--hover);
  color: var(--text);
}
nav button.on {
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text);
}
.hl-none {
  margin: 8px;
  color: var(--muted);
}
section {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  padding: 14px 20px 8px;
  background: var(--panel);
}
h2 {
  margin: 0;
  font-size: 18px;
}
.grow {
  flex: 1;
}
.hl-x {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-2);
}
.hl-x:hover {
  background: var(--hover);
}
.hl-body {
  padding: 0 20px 24px;
  color: var(--text);
  font-size: 13.5px;
  line-height: 1.55;
}
.hl-body :deep(p) {
  margin: 8px 0;
}
.hl-body :deep(ul) {
  margin: 6px 0;
  padding-left: 20px;
}
.hl-body :deep(li) {
  margin: 4px 0;
}
.hl-body :deep(dl) {
  display: grid;
  grid-template-columns: minmax(150px, 34%) 1fr;
  gap: 6px 14px;
  margin: 10px 0;
}
.hl-body :deep(dt) {
  font-weight: 600;
}
.hl-body :deep(dd) {
  margin: 0;
  color: var(--text-2);
}
.hl-body :deep(code),
.hl-body :deep(kbd) {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--panel-3);
  font-family: var(--font-data);
  font-size: 12px;
}
.hl-body :deep(kbd) {
  border: 1px solid var(--border-2);
}
</style>
