<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { VaultNode } from '@shared/vault'
import Icon from './Icon.vue'
import { beside, useFollow } from '../lib/floating'
import { ensureMentions, notesOf, noteTitle, openNote } from '../lib/mentions'

/**
 * The notes an event is mentioned in: a link icon with their count; a click — the list (the note's name, when it
 * was made), a note opened from it. Nothing when no note mentions the event.
 */
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ opened: [] }>()
ensureMentions()
const paths = computed(() => notesOf(props.id))
const open = ref<{ x: number; y: number }>()
/** The chip it opened from: the list stays by it, closes when it is out of sight. */
let anchor: HTMLElement | undefined
const popEl = ref<HTMLElement>()
const at = (r: DOMRect) => beside(r, 300, popEl.value?.offsetHeight ?? 260)
useFollow(
  open,
  () => anchor,
  (r) => open.value && (open.value = at(r)),
  () => (open.value = undefined),
)
const ctimes = shallowRef<Map<string, number>>(new Map())
async function toggle(e: Event): Promise<void> {
  if (open.value) return void (open.value = undefined)
  anchor = e.currentTarget as HTMLElement
  open.value = at(anchor.getBoundingClientRect())
  // when each note was made (the vault's tree)
  const map = new Map<string, number>()
  const walk = (ns: VaultNode[]) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : map.set(n.path, n.ctime)))
  walk(await window.qa.vaultTree())
  ctimes.value = map
}
const when = (p: string) => {
  const t = ctimes.value.get(p)
  return t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}
const away = (e: PointerEvent) => !(e.target as HTMLElement).closest('.nlx-pop, .nlx') && (open.value = undefined)
window.addEventListener('pointerdown', away, true)
onBeforeUnmount(() => window.removeEventListener('pointerdown', away, true))
function go(p: string): void {
  open.value = undefined
  void openNote(p)
  emit('opened')
}
</script>

<template>
  <span v-if="paths.length" class="nlx" role="button" tabindex="0" :class="{ on: !!open }" :title="`Упомянуто в заметках: ${paths.length}`" @click.stop="toggle" @keydown.enter.stop="toggle" @pointerdown.stop @mousedown.stop>
    <Icon name="link" :size="12" /><b>{{ paths.length }}</b>
  </span>
  <Teleport to="body">
    <div v-if="open" ref="popEl" class="nlx-pop" :style="{ left: `${open.x}px`, top: `${open.y}px` }" @pointerdown.stop @click.stop>
      <p class="cap">Упомянуто в заметках</p>
      <button v-for="p in paths" :key="p" @click="go(p)">
        <Icon name="note" :size="13" />
        <span class="t">{{ noteTitle(p) }}<small v-if="p.includes('/')">{{ p.split('/').slice(0, -1).join(' / ') }}</small></span>
        <span class="d">{{ when(p) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.nlx {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--border-2);
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.nlx b {
  font-weight: 600;
}
.nlx:hover,
.nlx.on {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.nlx-pop {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 290px;
  max-height: 320px;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.cap {
  margin: 2px 6px 6px;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.nlx-pop button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}
.nlx-pop button:hover {
  background: var(--hover);
}
.t {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t small {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
}
.d {
  flex: none;
  color: var(--muted);
  font-size: 11.5px;
}
</style>
