<script setup lang="ts">
import { computed, ref } from 'vue'
import { breakdown } from '@shared/breakdown'
import { formatDuration, formatHM } from '@shared/timeline'
import type { DayData, Ms } from '@shared/types'
import { APP_COLORS, kindColor, kindLabel } from '../lib/palette'
import { visibleNotes } from '@shared/notes'
import NoteList from './NoteList.vue'

const props = defineProps<{ data: DayData; start: Ms; end: Ms }>()
/** Quick notes made inside the range. */
const notes = computed(() => visibleNotes(props.data.notes).filter((n) => n.at >= props.start && n.at <= props.end))

const b = computed(() => breakdown(props.data, props.start, props.end))
const total = computed(() => Math.max(1, props.end - props.start))
const allTitles = ref(false)
const titles = computed(() => (allTitles.value ? b.value.titles : b.value.titles.slice(0, 8)))
</script>

<template>
  <div class="bd">
    <div class="head">
      <b>{{ formatHM(start) }}–{{ formatHM(end) }}</b>
      <span class="muted">{{ formatDuration(end - start) }}</span>
    </div>

    <div class="chips">
      <span class="chip-s"><i style="background: #22c55e"></i>QA вкл. {{ formatDuration(b.pcOnMs) }}</span>
      <span class="chip-s"><i style="background: #818cf8"></i>Активно {{ formatDuration(b.activeMs) }}</span>
      <span class="chip-s"><i style="background: #52525b"></i>Простой {{ formatDuration(b.idleMs) }}</span>
      <span v-if="b.callsMs" class="chip-s"><i style="background: #14b8a6"></i>Созвоны {{ formatDuration(b.callsMs) }}</span>
    </div>

    <div v-if="b.apps.length" class="section">
      <div class="sh">Приложения</div>
      <div v-for="a in b.apps.slice(0, 8)" :key="a.app" class="bar-row">
        <span class="name">{{ a.app }}</span>
        <span class="bar"><span :style="{ width: `${(a.ms / total) * 100}%`, background: APP_COLORS[a.kind] }"></span></span>
        <span class="val">{{ formatDuration(a.ms) }}</span>
      </div>
    </div>


    <div v-if="b.titles.length" class="section">
      <div class="sh">Окна</div>
      <div v-for="t in titles" :key="`${t.app}${t.title}`" class="title-row" :title="t.title">
        <i :style="{ background: APP_COLORS[t.kind] }"></i>
        <span class="t">{{ t.title }}</span>
        <span class="val">{{ formatDuration(t.ms) }}</span>
      </div>
      <button v-if="b.titles.length > 8" class="link" @click="allTitles = !allTitles">
        {{ allTitles ? 'Свернуть' : `Ещё ${b.titles.length - 8}` }}
      </button>
    </div>

    <div v-if="b.calls.length" class="section">
      <div class="sh">Созвоны</div>
      <div v-for="(c, i) in b.calls" :key="`c${i}`" class="title-row">
        <i style="background: #14b8a6"></i>
        <span class="t">{{ c.app }} ({{ c.source === 'mic' ? 'микрофон' : 'статус Teams' }})</span>
        <span class="val">{{ formatHM(c.start) }}–{{ formatHM(c.end) }}</span>
      </div>
    </div>

    <div v-if="b.entries.length" class="section">
      <div class="sh">Записи</div>
      <div v-for="e in b.entries" :key="e.id" class="title-row">
        <i :style="{ background: kindColor(e.kind) }"></i>
        <span class="t">{{ kindLabel(e.kind) }} · {{ e.label }}</span>
        <span class="val">{{ formatHM(e.start) }}–{{ formatHM(e.end) }}</span>
      </div>
    </div>

    <div v-if="notes.length" class="section">
      <div class="sh">Заметки</div>
      <NoteList :notes="notes" :entries="data.entries" :day="data.day" />
    </div>

    <p v-if="!b.apps.length && !b.pcOnMs" class="muted">В этот промежуток QA было выключено.</p>
  </div>
</template>

<style scoped>
.bd {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
}
.head {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip-s {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--panel-2);
  font-size: 12px;
}
i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  display: inline-block;
}
.sh {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 6px;
}
.bar-row {
  display: grid;
  grid-template-columns: 120px 1fr 64px;
  align-items: center;
  gap: 8px;
  margin: 3px 0;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  height: 8px;
  border-radius: 4px;
  background: var(--panel-2);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}
.val {
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.key {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  color: #93c5fd;
}
.link {
  background: transparent;
  border: 0;
  padding: 2px 0;
  color: #a5b4fc;
  font-size: 12px;
}
</style>
