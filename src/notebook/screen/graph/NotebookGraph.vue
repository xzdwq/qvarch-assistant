<script setup lang="ts">
/**
 * «Граф блокнота» — a tab of its own (kept, moved, closed as a note's): the notes, the ones only linked to, folders,
 * and what they share, as Obsidian's graph. Filters on its bar: a search, the whole notebook or around the note last
 * open, the kinds (the legend), the notes linked to nothing. Read again a moment after the notes change (the nodes
 * keep their places). A note clicked — opened (Ctrl — in the other pane); a tag — the tree by it; a folder — shown in
 * the tree; a table, a request… — searched for.
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { VIEW_NODE_KINDS, type NotebookGraph, type ViewNode, type ViewNodeKind } from '@shared/notebook/graph'
import type { VaultNode } from '@shared/vault'
import { around, visibleGraph } from '@nb/domain/graph/notebookGraph'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { noteName } from '@nb/domain/notePaths'
import { docs } from '@nb/workspace/noteDocs'
import { curPane, layout, openFile } from '@nb/workspace/paneLayout'
import { filterByTag } from '@nb/workspace/tagFilter'
import { isViewTab } from '@nb/workspace/viewTabs'
import { tree } from '@nb/workspace/vaultTreeStore'
import { useNotebookScreen } from '../notebookScreen'
import { NODE_LOOK } from './graphLook'
import { useForceGraph, type GNode } from './useForceGraph'

/** (a view tab's pane and path — every view gets them) */
defineProps<{ pi: number; path?: string }>()
const { search } = useNotebookScreen()

// ---------- the graph, read again a moment after the notes change ----------
const graph = shallowRef<NotebookGraph>()
const loading = ref(false)
async function load(): Promise<void> {
  loading.value = true
  graph.value = await window.qa.vaultGraph().catch(() => graph.value ?? { nodes: [], links: [] })
  loading.value = false
}
void load()
let timer: ReturnType<typeof setTimeout> | undefined
const later = () => (clearTimeout(timer), (timer = setTimeout(() => void load(), 2000)))
watch(tree, later)
watch(() => [...docs.values()].map((d) => d.saved), later)

// ---------- what is shown ----------
/** Each kind shown or not: folders — not at first (each would draw its notes into a star). */
const kinds = reactive(Object.fromEntries(VIEW_NODE_KINDS.map((k) => [k, k !== 'folder'])) as Record<ViewNodeKind, boolean>)
/** The notes linked to nothing — shown (as in Obsidian). */
const lonely = ref(true)
/** The whole notebook (0), or around the note last open (1, 2 links). */
const depth = ref(0)
const DEPTHS = [
  { v: 0, title: 'Весь блокнот' },
  { v: 1, title: 'Вокруг заметки · 1' },
  { v: 2, title: 'Вокруг заметки · 2' },
] as const
/**
 * The note the graph is about: the one last made active while the graph is open; before that — the note active in
 * some pane, else any note open in a tab (the graph restored after a restart, opened before any note — still has one).
 */
const picked = ref<string>()
watch(
  () => curPane()?.active,
  (p) => p && !isViewTab(p) && (picked.value = p),
  { immediate: true },
)
const openNotes = computed(() => layout.panes.flatMap((p) => [p.active, ...p.tabs.map((t) => t.path)]).filter((p): p is string => !!p && !isViewTab(p)))
const lastNote = computed(() => (picked.value && openNotes.value.includes(picked.value) ? picked.value : openNotes.value[0]))
const depthBtn = ref<HTMLElement>()
const depthOpen = ref(false)
const pickDepth = (v: number) => ((depth.value = v), (depthOpen.value = false))
const shown = computed<NotebookGraph | undefined>(() => {
  if (!graph.value) return undefined
  let g = visibleGraph(graph.value, (k) => kinds[k])
  if (depth.value && lastNote.value) g = around(g, `n:${lastNote.value}`, depth.value)
  if (!lonely.value) g = { ...g, nodes: g.nodes.filter((n) => n.degree > 0 || n.path === lastNote.value) }
  return g
})
const q = ref('')
const found = computed<ReadonlySet<string> | undefined>(() => {
  const w = q.value.trim().toLowerCase()
  return w && shown.value ? new Set(shown.value.nodes.filter((n) => n.label.toLowerCase().includes(w) || (n.path ?? '').toLowerCase().includes(w)).map((n) => n.id)) : undefined
})

/** A note's / a folder's marks, as the tree has them. */
const marks = computed(() => {
  const m = new Map<string, VaultNode>()
  const walk = (ns: readonly VaultNode[]) => ns.forEach((n) => (m.set(n.path, n), n.dir && walk(n.children ?? [])))
  walk(tree.value)
  return m
})
const markOf = (n: ViewNode) => {
  const t = n.path ? marks.value.get(n.path) : undefined
  return { color: t?.color, emoji: t?.emoji }
}

// ---------- a node clicked ----------
/** Each kind clicked: what happens. */
const CLICK: Record<ViewNodeKind, (n: GNode, e: MouseEvent) => void> = {
  note: (n, e) => openFile(n.path!, { newPane: e.ctrlKey || e.metaKey }),
  ghost: () => undefined,
  folder: (n) => {
    const parts = n.path!.split('/')
    for (let k = 1; k <= parts.length; k++) if (!layout.open.includes(parts.slice(0, k).join('/'))) layout.open.push(parts.slice(0, k).join('/'))
    layout.sideTab = 'files'
    layout.sideHidden = false
  },
  tag: (n) => filterByTag(n.id.slice('tag:'.length)),
  table: (n) => void find(n.label),
  endpoint: (n) => void find(n.id.slice('endpoint:'.length)),
  host: (n) => void find(n.label),
  jira: (n) => void find(n.label),
  event: (n) => void find(n.label),
}
async function find(text: string): Promise<void> {
  search.q.value = text
  layout.sideHidden = false
  await search.toggleSearch(true)
}

const canvas = ref<HTMLElement>()
const g = useForceGraph(canvas, { data: shown, markOf, found, current: lastNote, click: (n, e) => CLICK[n.kind](n, e) })
const colorVar = (k: ViewNodeKind) => `var(${NODE_LOOK[k].color})`
</script>

<template>
  <div class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:bg-bg">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-6 tw:min-w-0 tw:py-5 tw:px-10 tw:border-b tw:border-b-border tw:text-[12px] tw:whitespace-nowrap">
      <label class="tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:h-24 tw:px-6 tw:border tw:border-border tw:rounded-r2 tw:bg-field tw:text-muted tw:focus-within:border-accent"><Icon name="search" :size="12" /><input v-model="q" class="tw:w-130 tw:min-w-0 tw:border-0 tw:bg-transparent tw:text-text tw:outline-none" placeholder="Найти на графе" spellcheck="false" @keydown.esc="q = ''" /></label>
      <span ref="depthBtn" class="tw:inline-flex tw:flex-none">
        <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-24 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:bg-field tw:text-text tw:hover:border-border-3 tw:[&.on]:border-accent" :class="{ on: depthOpen }" :title="lastNote ? `Весь блокнот или вокруг «${noteName(lastNote)}»` : 'Весь блокнот (для «вокруг заметки» откройте заметку)'" @click="depthOpen = !depthOpen">
          {{ DEPTHS.find((d) => d.v === depth)?.title }}<Icon name="chevronDown" :size="12" class="tw:text-muted" />
        </button>
      </span>
      <Popover v-model:open="depthOpen" :anchor="depthBtn" :width="240" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-1 tw:p-5 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
        <button v-for="d in DEPTHS" :key="d.v" class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-40" :disabled="d.v > 0 && !lastNote" @click="pickDepth(d.v)">
          <Icon v-if="depth === d.v" name="check" :size="12" /><span v-else class="tw:inline-block tw:w-12"></span>
          <span>{{ d.title }}</span><span class="tw:flex-1"></span>
          <span v-if="d.v > 0" class="tw:min-w-0 tw:max-w-110 tw:truncate tw:text-muted tw:text-[11px]">{{ lastNote ? noteName(lastNote) : 'нет заметки' }}</span>
        </button>
      </Popover>
      <!-- the legend: each kind switched on / off -->
      <span class="tw:flex tw:flex-1 tw:items-center tw:gap-2 tw:min-w-0 tw:overflow-hidden">
        <button v-for="k in VIEW_NODE_KINDS" :key="k" class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-22 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:hover:bg-hover tw:[&:not(.on)]:opacity-30" :class="{ on: kinds[k] }" :style="{ color: colorVar(k) }" :title="`${NODE_LOOK[k].title} — ${kinds[k] ? 'скрыть' : 'показать'}`" @click="kinds[k] = !kinds[k]"><Icon :name="NODE_LOOK[k].icon" :size="13" /></button>
        <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-22 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:[&:not(.on)]:opacity-30" :class="{ on: lonely }" :title="lonely ? 'Заметки без связей — скрыть' : 'Заметки без связей — показать'" @click="lonely = !lonely"><i class="tw:w-9 tw:h-9 tw:rounded-full tw:border-[1.5px] tw:border-current"></i></button>
      </span>
      <span class="tw:flex-none tw:text-muted" :title="'Узлов · связей'">{{ shown?.nodes.length ?? 0 }} · {{ shown?.links.length ?? 0 }}</span>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Вписать весь граф" @click="g.fit()"><Icon name="expand" :size="13" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Разложить заново" @click="g.shake()"><Icon name="rotate" :size="13" /></button>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" :class="{ 'tw:animate-spin': loading }" title="Обновить" @click="load()"><Icon name="refresh" :size="13" /></button>
    </div>
    <div class="tw:relative tw:flex-1 tw:min-h-0">
      <div ref="canvas" class="tw:absolute tw:inset-0 tw:overflow-hidden"></div>
      <p v-if="shown && !shown.nodes.length" class="tw:absolute tw:inset-0 tw:grid tw:place-items-center tw:m-0 tw:text-muted tw:pointer-events-none">Нечего показать — включите виды узлов в легенде</p>
    </div>
  </div>
</template>
