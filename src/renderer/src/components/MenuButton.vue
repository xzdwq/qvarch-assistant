<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * One button for a few variants of one action (export: Excel / CSV / copy; a plan: estimated / measured) — the room
 * of one button; its menu over everything (teleported), kept by the button, closed when the button is out of sight.
 */
export interface MenuItem {
  label: string
  icon?: string
  title?: string
  disabled?: boolean
  run: () => unknown
}
const props = withDefaults(defineProps<{ label?: string; icon?: string; title?: string; items: MenuItem[]; disabled?: boolean; width?: number }>(), { width: 220 })
const open = ref(false)
const btn = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
useAnchor(open, btn, () => {
  if (!btn.value) return
  const f = placeFloat(btn.value, props.width, false, 0)
  style.value = { ...f.style, maxHeight: `${f.maxH}px` }
})
function pick(it: MenuItem): void {
  if (it.disabled) return
  open.value = false
  void it.run()
}
const away = (e: PointerEvent) => open.value && !btn.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.mb-pop') && (open.value = false)
const esc = (e: KeyboardEvent) => e.key === 'Escape' && (open.value = false)
window.addEventListener('pointerdown', away, true)
window.addEventListener('keydown', esc)
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', away, true)
  window.removeEventListener('keydown', esc)
})
</script>

<template>
  <button ref="btn" class="mb" :class="{ on: open, solo: !label }" :disabled="disabled" :title="title" @mousedown.prevent @click="open = !open">
    <Icon v-if="icon" :name="icon" :size="label ? 12 : 14" /><template v-if="label">{{ label }}<Icon name="chevronDown" :size="10" /></template>
  </button>
  <Teleport to="body">
    <div v-if="open" class="mb-pop" :style="style">
      <button v-for="(it, i) in items" :key="i" :disabled="it.disabled" :title="it.title" @mousedown.prevent @click="pick(it)">
        <Icon v-if="it.icon" :name="it.icon" :size="13" />{{ it.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.mb {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
}
/* only its icon (what it does — on hover): the room of an icon */
.mb.solo {
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border-color: transparent;
  border-radius: 6px;
}
.mb.on,
.mb:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text);
}
.mb:disabled {
  opacity: 0.5;
}
.mb-pop {
  display: flex;
  flex-direction: column;
  padding: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.mb-pop button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mb-pop button:hover:not(:disabled) {
  background: var(--hover);
}
.mb-pop button:disabled {
  opacity: 0.45;
}
</style>
