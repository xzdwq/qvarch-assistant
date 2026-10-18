<script setup lang="ts">
import Icon from '../Icon.vue'

/** A recording going on, right where it will be in the note: the time, the level, «Остановить». */
const props = defineProps<{ sec: number; level: number; onStop: () => void }>()
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
</script>

<template>
  <div class="rc">
    <span class="dot"></span>
    <b>{{ fmt(props.sec) }}</b>
    <span class="meter"><i :style="{ width: `${Math.round(props.level * 100)}%` }"></i></span>
    <span class="muted">Идёт запись — запись встанет здесь</span>
    <button @mousedown.prevent @click="props.onStop()"><Icon name="stop" :size="11" />Остановить</button>
  </div>
</template>

<style scoped>
.rc {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  padding: 6px 8px 6px 12px;
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  font-size: 12.5px;
  white-space: nowrap;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ef4444;
  animation: blink 1s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
b {
  min-width: 36px;
  color: var(--text-hi);
  font-family: var(--font-data);
}
.meter {
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: var(--panel-3);
  overflow: hidden;
}
.meter i {
  display: block;
  height: 100%;
  background: #ef4444;
  transition: width 0.08s;
}
.muted {
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
}
button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: #ef4444;
  color: #fff;
  font-size: 12px;
}
</style>
