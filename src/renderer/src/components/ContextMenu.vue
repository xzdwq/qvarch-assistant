<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCloseOnScroll } from '../lib/floating'
import Icon from './Icon.vue'
import type { MenuItem } from './MenuButton.vue'

/**
 * A menu at the point of a right click (over chosen cells, a row…): over everything, inside the window; closed by a
 * click elsewhere, Esc, or anything scrolling (it stood by what has moved).
 */
const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ close: [] }>()
const el = ref<HTMLElement>()
const pos = ref({ left: props.x, top: props.y })
onMounted(async () => {
  await nextTick()
  const w = el.value?.offsetWidth ?? 200
  const h = el.value?.offsetHeight ?? 120
  pos.value = { left: Math.max(4, Math.min(props.x, window.innerWidth - w - 4)), top: Math.max(4, Math.min(props.y, window.innerHeight - h - 4)) }
})
useCloseOnScroll(ref(true), () => emit('close'), '.cx-menu')
const away = (e: PointerEvent) => !el.value?.contains(e.target as Node) && emit('close')
const esc = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
window.addEventListener('pointerdown', away, true)
window.addEventListener('keydown', esc)
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', away, true)
  window.removeEventListener('keydown', esc)
})
function pick(it: MenuItem): void {
  if (it.disabled) return
  emit('close')
  void it.run()
}
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="cx-menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @contextmenu.prevent>
      <button v-for="(it, i) in items" :key="i" :disabled="it.disabled" :title="it.title" @mousedown.prevent @click="pick(it)">
        <Icon v-if="it.icon" :name="it.icon" :size="13" />{{ it.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.cx-menu {
  position: fixed;
  z-index: 5000;
  display: flex;
  min-width: 180px;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.cx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
}
.cx-menu button:hover:not(:disabled) {
  background: var(--hover);
}
.cx-menu button:disabled {
  opacity: 0.45;
}
</style>
