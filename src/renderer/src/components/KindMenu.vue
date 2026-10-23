<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { kinds } from '../lib/palette'
import { useCloseOnScroll } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * Right-click menu "what kind of activity is this?". Fixed-positioned and clamped into `bounds`
 * (the island passes its panel rect — anything outside it would be click-through). Over everything (teleported);
 * closed by a click elsewhere, Esc, or anything scrolling (it stood by what has moved).
 */
const props = defineProps<{
  x: number
  y: number
  title?: string
  current?: string
  /** No kinds to pick (an Outlook meeting) — only what the slot has. */
  noKinds?: boolean
  bounds?: { left: number; top: number; right: number; bottom: number }
}>()
const emit = defineEmits<{ pick: [kind: string]; close: [] }>()

const el = ref<HTMLElement>()
const size = ref({ w: 200, h: 240 })

const style = computed(() => {
  const b = props.bounds ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const left = Math.max(b.left + 4, Math.min(props.x, b.right - size.value.w - 4))
  const top = Math.max(b.top + 4, Math.min(props.y, b.bottom - size.value.h - 4))
  return { left: `${left}px`, top: `${top}px` }
})

useCloseOnScroll(ref(true), () => emit('close'), '.kmenu')
function onDown(e: PointerEvent): void {
  if (!el.value?.contains(e.target as Node)) emit('close')
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  if (el.value) size.value = { w: el.value.offsetWidth, h: el.value.offsetHeight }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDown, true)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
  <div ref="el" class="kmenu" :style="style" @contextmenu.prevent>
    <div v-if="title" class="ttl">{{ title }}</div>
    <button v-for="k in noKinds ? [] : kinds.filter((x) => !x.hidden || x.id === current)" :key="k.id" :class="{ cur: k.id === current }" @click="emit('pick', k.id)">
      <span class="ic" :style="{ background: k.color }"><Icon :name="k.icon" :size="12" :stroke="2.2" /></span>
      {{ k.label }}
    </button>
    <slot />
  </div>
  </Teleport>
</template>

<style scoped>
.kmenu {
  position: fixed;
  z-index: 5000;
  min-width: 190px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  animation: pop 0.12s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
.ttl {
  padding: 4px 8px 6px;
  font-size: 11px;
  color: var(--muted);
}
button {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 5px 8px;
  border-radius: var(--r2);
  font-size: 13px;
}
button:hover {
  background: var(--hover);
}
button.cur {
  background: rgb(var(--accent-rgb) / 0.18);
}
.ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--r2);
  color: var(--text-hi);
}
</style>
