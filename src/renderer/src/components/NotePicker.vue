<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { VaultNode } from '@shared/vault'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * «В блокнот ▾»: where something goes — a new note, or any note there is (the recent first; a search over names and
 * folders; ↑ ↓ Enter). Over everything, kept by its button.
 */
const props = withDefaults(defineProps<{ label?: string; title?: string; newLabel?: string; disabled?: boolean }>(), { label: 'В блокнот', newLabel: 'Новая заметка' })
const emit = defineEmits<{ pick: [path: string | null] }>()
const open = ref(false)
const btn = ref<HTMLElement>()
const style = ref<Record<string, string>>({})
const q = ref('')
const input = ref<HTMLInputElement>()
const notes = shallowRef<Array<{ path: string; name: string; dir: string; mtime: number }>>([])
const idx = ref(0)
useAnchor(open, btn, () => {
  if (!btn.value) return
  const f = placeFloat(btn.value, 340, false, 0)
  style.value = { ...f.style, maxHeight: `${Math.max(220, f.maxH)}px` }
})
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  q.value = ''
  idx.value = 0
  const out: typeof notes.value = []
  const walk = (ns: VaultNode[]) => {
    for (const n of ns) {
      if (n.dir) {
        if (!n.name.startsWith('.')) walk(n.children ?? [])
      } else if (/\.md$/i.test(n.path)) out.push({ path: n.path, name: n.name.replace(/\.md$/i, ''), dir: n.path.split('/').slice(0, -1).join(' / '), mtime: n.mtime })
    }
  }
  walk(await window.qa.vaultTree())
  notes.value = out.sort((a, b) => b.mtime - a.mtime)
  await nextTick()
  input.value?.focus()
}
const shown = computed(() => {
  const w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return notes.value.filter((n) => w.every((x) => `${n.name} ${n.dir}`.toLowerCase().includes(x))).slice(0, 80)
})
/** The rows: «new» first, then the notes found. */
const total = computed(() => shown.value.length + 1)
function choose(i: number): void {
  open.value = false
  emit('pick', i === 0 ? null : shown.value[i - 1].path)
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') ((idx.value = (idx.value + 1) % total.value), e.preventDefault())
  else if (e.key === 'ArrowUp') ((idx.value = (idx.value - 1 + total.value) % total.value), e.preventDefault())
  else if (e.key === 'Enter') (choose(idx.value), e.preventDefault())
  else if (e.key === 'Escape') open.value = false
}
const away = (e: PointerEvent) => open.value && !btn.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.np-pop') && (open.value = false)
window.addEventListener('pointerdown', away, true)
onBeforeUnmount(() => window.removeEventListener('pointerdown', away, true))
</script>

<template>
  <button ref="btn" class="np" :class="{ on: open }" :disabled="disabled" :title="title" @mousedown.prevent @click="toggle"><Icon name="note" :size="12" />{{ props.label }}<Icon name="chevronDown" :size="10" /></button>
  <Teleport to="body">
    <div v-if="open" class="np-pop" :style="style" @keydown="onKey">
      <input ref="input" v-model="q" placeholder="Найти заметку…" spellcheck="false" @input="idx = 0" />
      <div class="np-list">
        <button class="new" :class="{ cur: idx === 0 }" @mousemove="idx = 0" @click="choose(0)"><Icon name="plus" :size="13" />{{ props.newLabel }}</button>
        <button v-for="(n, i) in shown" :key="n.path" :class="{ cur: idx === i + 1 }" :title="n.path" @mousemove="idx = i + 1" @click="choose(i + 1)">
          <Icon name="note" :size="12" /><span class="nm">{{ n.name }}</span><span v-if="n.dir" class="dir">{{ n.dir }}</span>
        </button>
        <p v-if="!shown.length && q" class="muted">Не найдено</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.np {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px 0 10px;
  white-space: nowrap;
}
.np-pop {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  font-size: 12.5px;
}
.np-pop input {
  height: 28px;
  margin: 6px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.np-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 0 4px 4px;
  overflow-y: auto;
}
.np-list button {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  text-align: left;
  white-space: nowrap;
}
.np-list button.cur {
  background: var(--hover);
}
.np-list button.new {
  color: var(--accent-fg);
}
.nm {
  flex: none;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dir {
  overflow: hidden;
  color: var(--muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
}
.muted {
  margin: 6px 8px;
  color: var(--muted);
}
</style>
