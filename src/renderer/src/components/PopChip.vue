<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { placeFloat, useAnchor, type Float } from '../lib/floating'

/**
 * A compact chip of a toolbar (the same height as the task / link chips) that opens a small list over
 * everything — choices never push the card's layout around.
 */
const props = defineProps<{ icon: string; label?: string; title: string; active?: boolean; width?: number }>()
const open = defineModel<boolean>('open', { default: false })

const root = ref<HTMLElement>()
const dd = ref<HTMLElement>()
const fl = ref<Float>({ teleport: true, up: false, maxH: 300, style: {} })
function measure(): void {
  const btn = root.value?.firstElementChild as HTMLElement | null
  if (btn) fl.value = placeFloat(btn, props.width ?? 220, true, 8)
}
useAnchor(open, root, measure)
function toggle(): void {
  open.value = !open.value
  if (open.value) measure()
}
function onDown(e: MouseEvent): void {
  if (open.value && !root.value?.contains(e.target as Node) && !dd.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div ref="root" class="pc">
    <button class="pchip" :class="{ on: active, open }" :title="title" @click="toggle">
      <Icon :name="icon" :size="14" />
      <span v-if="label" class="pl">{{ label }}</span>
    </button>
    <Teleport to="body">
      <div v-if="open" ref="dd" class="pcdd" :style="{ ...fl.style, maxHeight: `${fl.maxH}px` }" @keydown.esc.stop="open = false">
        <slot :close="() => (open = false)" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pc {
  position: relative;
  flex: none;
  display: inline-flex;
}
.pchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  min-width: 32px;
  box-sizing: border-box;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--muted);
  font-size: 12.5px;
  white-space: nowrap;
  cursor: pointer;
}
.pchip:hover,
.pchip.open {
  border-color: var(--accent);
  color: var(--text);
}
.pchip.on {
  border-color: rgb(var(--accent-rgb) / 0.7);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--accent-fg);
}
.pl {
  font-weight: 600;
}
</style>

<style>
/* the list of a toolbar chip — teleported to <body> */
.pcdd {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px;
  overflow-y: auto;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  font-size: 12.5px;
  color: var(--text);
}
.pcdd .pci {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pcdd .pci:hover {
  background: rgb(var(--accent-rgb) / 0.16);
}
.pcdd .pci.cur {
  background: rgb(var(--accent-rgb) / 0.24);
  color: var(--text-hi);
}
.pcdd .pcsep {
  height: 1px;
  margin: 4px 6px;
  background: rgba(255, 255, 255, 0.08);
}
.pcdd .pcrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 9px 6px;
  color: var(--muted);
}
.pcdd .pcrow input {
  width: 64px;
  padding: 4px 6px;
  border-radius: var(--r2);
  font-size: 12.5px;
}
</style>
