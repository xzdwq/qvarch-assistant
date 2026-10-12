<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatHM } from '@shared/timeline'
import { sameEnd } from '@shared/links'
import { visibleNotes } from '@shared/notes'
import type { Entry, LinkEnd, Note } from '@shared/types'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import Icon from './Icon.vue'
import { placeFloat, useAnchor, type Float } from '../lib/floating'

/**
 * What this block / note is linked with: any other block or note of the day (checkboxes).
 * Nothing is linked by itself — only what is ticked here (or dragged on a timeline).
 * The list fits into the space the host leaves (the island clips).
 */
/** near — a moment: the list starts with what is closest to it (a note links to the blocks around it). labeled — "Связать" even when compact. */
const props = defineProps<{ entries: Entry[]; notes: Note[]; self?: LinkEnd; compact?: boolean; near?: number; labeled?: boolean }>()
const links = defineModel<LinkEnd[]>({ default: () => [] })
/** Opened / closed — a small host (the mini island) can make room for the list. */
const emit = defineEmits<{ open: [on: boolean] }>()

const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const place = ref<{ up: boolean; maxH: number; left: boolean }>({ up: true, maxH: 240, left: false })

type Item = { end: LinkEnd; t: number; text: string; icon: string; color: string }
const noteText = (n: Note) => n.text.trim() || n.transcript?.trim() || (n.audio?.kind === 'call' ? 'Запись звонка' : n.audio ? 'Голосовая заметка' : '')
const items = computed<Item[]>(() => {
  const all: Item[] = [
    ...props.entries.map((e) => ({
      end: { type: 'entry' as const, id: e.id },
      t: e.start,
      text: `${formatHM(e.start)}–${formatHM(e.end)} · ${e.task ? e.task.key + ' ' : ''}${e.label || kindLabel(e.kind)}`,
      icon: entryIcon(e),
      color: kindColor(e.kind),
    })),
    ...visibleNotes(props.notes).map((n) => ({
      end: { type: 'note' as const, id: n.id },
      t: n.at,
      text: `${formatHM(n.at)} · ${noteText(n)}`,
      icon: n.audio ? (n.audio.kind === 'call' ? 'phone' : 'mic') : 'note',
      color: '#fbbf24',
    })),
  ]
  const s = q.value.trim().toLowerCase()
  return all
    .filter((i) => !props.self || !sameEnd(i.end, props.self))
    .filter((i) => !s || i.text.toLowerCase().includes(s))
    .sort((a, b) => (props.near !== undefined ? Math.abs(a.t - props.near) - Math.abs(b.t - props.near) : a.t - b.t))
})
const chosen = (e: LinkEnd) => links.value.some((x) => sameEnd(x, e))
/** Links to things that no longer exist are not counted. */
const count = computed(() => links.value.filter((l) => (l.type === 'entry' ? props.entries : props.notes).some((x) => x.id === l.id)).length)

/** Where the list opens: over everything in the main window, inside the shell in the island. */
const fl = ref<Float>({ teleport: false, up: true, maxH: 240, style: {} })
const dd = ref<HTMLElement>()
function measure(): void {
  const btn = root.value?.getBoundingClientRect()
  if (!btn || !root.value) return
  // opens towards the side with room: from the button's left edge, or from its right edge
  const host = (root.value.closest('.stage > .shell') as HTMLElement | null)?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth }
  const left = host.right - btn.left >= Math.min(380, host.right - host.left - 16)
  // from the button itself: the wrapper may be stretched by its row (the mini island)
  fl.value = placeFloat((root.value.firstElementChild as HTMLElement | null) ?? root.value, 380, left)
  place.value = { up: fl.value.up, maxH: fl.value.maxH, left }
}
useAnchor(open, root, measure)
function onScroll(e: Event): void {
  if (open.value && fl.value.teleport && !dd.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => window.addEventListener('scroll', onScroll, true))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, true))
async function toggle(): Promise<void> {
  open.value = !open.value
  emit('open', open.value)
  if (open.value) {
    q.value = ''
    measure()
    await nextTick()
    search.value?.focus({ preventScroll: true })
  }
}
watch(open, (v) => !v && emit('open', false))
function pick(e: LinkEnd): void {
  links.value = chosen(e) ? links.value.filter((x) => !sameEnd(x, e)) : [...links.value, { type: e.type, id: e.id }]
}
function onDown(e: MouseEvent): void {
  if (open.value && !root.value?.contains(e.target as Node) && !dd.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div ref="root" class="lp" :class="{ compact }">
    <button class="chip" :class="{ on: count }" :title="count ? 'Связано — клик: изменить' : 'Связать с другим событием или заметкой'" @click="toggle">
      <Icon name="link" :size="13" />
      <span v-if="count || !compact || labeled" class="lbl">{{ count ? (labeled ? `Связано · ${count}` : count) : 'Связать' }}</span>
    </button>
    <Teleport to="body" :disabled="!fl.teleport">
    <div v-if="open" ref="dd" class="dd" :class="{ up: place.up, left: place.left }" :style="fl.style">
      <input ref="search" v-model="q" placeholder="Поиск · можно отметить несколько" spellcheck="false" @keydown.esc.stop="open = false" />
      <div class="items" :style="{ maxHeight: `${place.maxH}px` }">
        <button v-for="i in items" :key="`${i.end.type}${i.end.id}`" class="it" :class="{ cur: chosen(i.end) }" @click="pick(i.end)">
          <span class="cb" :class="{ on: chosen(i.end) }"><Icon v-if="chosen(i.end)" name="check" :size="11" :stroke="3" /></span>
          <span class="ic" :style="{ background: i.color }"><Icon :name="i.icon" :size="10" :stroke="2.4" /></span>
          <span class="sum">{{ i.text }}</span>
        </button>
        <p v-if="!items.length" class="empty">За этот день больше нечего связать.</p>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.lp {
  position: relative;
  flex: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 36px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}
.compact .chip {
  padding: 0 10px;
}
.chip:hover {
  border-color: var(--accent);
  color: var(--text);
}
.chip.on {
  border-color: rgba(167, 139, 250, 0.7);
  background: rgba(139, 92, 246, 0.16);
  color: #ddd6fe;
}
.lbl {
  font-weight: 600;
  white-space: nowrap;
}
.dd {
  position: absolute;
  z-index: 60;
  top: calc(100% + 4px);
  right: 0;
  width: 380px;
  max-width: 90vw;
  padding: 6px;
  border-radius: 10px;
  background: #1c2030;
  border: 1px solid var(--border);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.dd.left {
  right: auto;
  left: 0;
}
.dd.up {
  top: auto;
  bottom: calc(100% + 4px);
}
.dd input {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 4px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.items {
  overflow: auto;
}
.it {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.it:hover,
.it.cur {
  background: rgba(139, 92, 246, 0.16);
}
.cb {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
}
.cb.on {
  background: #8b5cf6;
  border-color: #8b5cf6;
}
.ic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: #fff;
}
.sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  margin: 6px 8px;
  color: var(--muted);
  font-size: 12px;
}
</style>
