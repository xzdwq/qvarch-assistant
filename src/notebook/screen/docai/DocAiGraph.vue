<script setup lang="ts">
/**
 * The AI's work in a document as a graph (as agentplay draws a session): the document in the middle, the groups of
 * what its turns touched around it, each thing touched at the ends — coloured by what was done to it (read, written,
 * run, searched), a failed one ringed. All the turns or one (the list over it); a thing pointed at — its path lit and
 * its details beside (which turns, what was done); a click — it opens (a note at its part, a task, a link). The wheel
 * zooms, a drag moves it.
 */
import { computed, reactive, ref, watch } from 'vue'
import type { DocTurn } from '@shared/agent/docAi'
import { leafGone, leafTarget, mainOp, radialLayout, turnGraph, type GraphLeaf } from '@shared/agent/turnGraph'
import { resolveWiki } from '@shared/vault'
import { docs } from '@nb/workspace/noteDocs'
import { files } from '@nb/workspace/vaultTreeStore'
import type { TouchOp } from '@shared/agent/touches'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ turns: readonly DocTurn[]; title: string }>()
const emit = defineEmits<{ open: [target: NonNullable<ReturnType<typeof leafTarget>>] }>()

/** The turn shown alone ('' — all of them). */
const only = ref('')
const shown = computed(() => (only.value ? props.turns.filter((t) => t.id === only.value) : props.turns))
const layout = computed(() => radialLayout(turnGraph(shown.value)))
const byId = computed(() => new Map(props.turns.map((t) => [t.id, t])))

/** Each op: its colour and words. */
const OPS: Record<TouchOp, { color: string; word: string }> = {
  read: { color: 'var(--ai-op-read)', word: 'читал' },
  write: { color: 'var(--ai-op-write)', word: 'писал' },
  run: { color: 'var(--ai-op-run)', word: 'запускал' },
  search: { color: 'var(--ai-op-search)', word: 'искал' },
}
const colorOf = (l: GraphLeaf) => (l.kind === 'error' ? 'var(--down)' : OPS[mainOp(l) ?? 'read'].color)
const opsText = (l: GraphLeaf) =>
  (Object.entries(l.ops) as Array<[TouchOp, number]>)
    .map(([op, n]) => `${OPS[op].word}${n > 1 ? ` ×${n}` : ''}`)
    .join(' · ')

// ---------- what is pointed at / picked ----------
const hover = ref<string>()
const picked = ref<string>()
const focusId = computed(() => hover.value ?? picked.value)
const focusLeaf = computed(() => layout.value.leaves.find((x) => x.id === focusId.value)?.leaf)
/** The path to what is pointed at is lit (a group — all of its). */
const lit = (leafId: string, from: string) => focusId.value === leafId || focusId.value === from
/** A thing clicked: opened (a note found wherever it is now — a link names it by its name alone). */
function click(l: GraphLeaf): void {
  picked.value = l.id
  const t = leafTarget(l)
  if (!t) return
  if ('url' in t) return emit('open', t)
  const path = findNote(t.note)
  if (path) emit('open', { ...t, note: path })
}

// ---------- what is no longer there (the journal is history: the document has changed since) ----------
/** A note's path now by a ref's note (a path, or a name a link gave). */
const findNote = (note: string): string | undefined => (files.value.includes(note) ? note : resolveWiki(note.replace(/\.(md|qboard)$/i, ''), files.value))
/** The texts of the notes the graph names that are not open — read once (an open one's — as typed). */
const read = reactive(new Map<string, string>())
watch(
  () => layout.value.leaves.map((x) => leafTarget(x.leaf)),
  (targets) => {
    for (const t of targets) {
      const path = t && 'note' in t ? findNote(t.note) : undefined
      if (path && !docs.get(path)?.loaded && !read.has(path)) void window.qa.vaultRead(path).then((s) => read.set(path, s), () => undefined)
    }
  },
  { immediate: true },
)
const textOf = (path: string) => (docs.get(path)?.loaded ? docs.get(path)!.text : read.get(path))
const gone = computed(() => new Set(layout.value.leaves.filter((x) => leafGone(x.leaf, findNote, textOf)).map((x) => x.id)))
/** There is somewhere to go: a link, or a note still there (its part gone — the note itself). */
function canOpen(l: GraphLeaf): boolean {
  const t = leafTarget(l)
  return !!t && ('url' in t || !!findNote(t.note))
}

// ---------- the view: the wheel zooms, a drag moves ----------
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const view = computed(() => {
  const r = layout.value.radius / zoom.value
  return `${-r - pan.value.x} ${-r - pan.value.y} ${r * 2} ${r * 2}`
})
const onWheel = (e: WheelEvent) => (zoom.value = Math.min(4, Math.max(0.5, zoom.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12))))
let drag: { x: number; y: number; px: number; py: number; scale: number } | undefined
function down(e: PointerEvent): void {
  if ((e.target as Element).closest('[data-node]')) return
  const svg = e.currentTarget as SVGSVGElement
  drag = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y, scale: (layout.value.radius * 2) / zoom.value / Math.max(1, svg.clientHeight) }
  svg.setPointerCapture(e.pointerId)
}
const move = (e: PointerEvent) => drag && (pan.value = { x: drag.px + (e.clientX - drag.x) * drag.scale, y: drag.py + (e.clientY - drag.y) * drag.scale })
const up = () => (drag = undefined)
const reset = () => ((zoom.value = 1), (pan.value = { x: 0, y: 0 }))

/** A curve from a group to its leaf (bent towards the middle of the two rings). */
const curve = (gx: number, gy: number, lx: number, ly: number, a: number) => `M ${gx} ${gy} Q ${Math.cos(a) * 190} ${Math.sin(a) * 190} ${lx} ${ly}`
/** A label along its direction, never upside down (the left half — turned round, its end at the node). */
const labelOf = (x: number, y: number, a: number) => {
  const left = Math.cos(a) < 0
  const deg = (a * 180) / Math.PI + (left ? 180 : 0)
  return { transform: `translate(${x} ${y}) rotate(${deg})`, anchor: left ? 'end' : 'start', dx: left ? -8 : 8 }
}
const cut = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n)}…` : s)
const when = (at: number) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:min-h-0">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:min-w-0 tw:text-[11.5px] tw:whitespace-nowrap">
      <select v-model="only" class="tw:min-w-0 tw:max-w-320 tw:h-24 tw:py-0 tw:px-6 tw:text-[11.5px]" title="Все ходы или один">
        <option value="">Все ходы · {{ turns.length }}</option>
        <option v-for="t in [...turns].reverse()" :key="t.id" :value="t.id">{{ when(t.at) }} · {{ t.agent }} · {{ cut(t.question, 40) }}</option>
      </select>
      <span class="tw:flex-1"></span>
      <span v-for="(o, op) in OPS" :key="op" class="tw:inline-flex tw:items-center tw:gap-3 tw:text-muted"><i class="tw:w-8 tw:h-8 tw:rounded-full" :style="{ background: o.color }"></i>{{ o.word }}</span>
      <span class="tw:inline-flex tw:items-center tw:gap-3 tw:text-muted"><i class="tw:w-8 tw:h-8 tw:rounded-full tw:border-2 tw:border-down"></i>ошибка</span>
      <span class="tw:inline-flex tw:items-center tw:gap-3 tw:text-muted" title="Удалено из документа после того хода: след истории"><i class="tw:w-8 tw:h-8 tw:rounded-full tw:border-2 tw:border-muted tw:opacity-50"></i><s>уже нет</s></span>
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Вернуть вид (масштаб и положение)" @click="reset"><Icon name="refresh" :size="11" /></button>
    </div>
    <p v-if="!layout.leaves.length" class="tw:m-0 tw:py-10 tw:text-muted tw:text-[12px]">Пока нечего показать: граф строится из того, что ИИ трогал в своих ходах (читал, писал, запускал). Он появится после первого хода ИИ с инструментами.</p>
    <div v-else class="tw:flex tw:flex-1 tw:gap-10 tw:min-h-0">
      <svg class="tw:flex-1 tw:min-w-0 tw:h-full tw:rounded-[10px] tw:bg-bg/40 tw:cursor-grab tw:select-none" :viewBox="view" preserveAspectRatio="xMidYMid meet" @wheel.prevent="onWheel" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
        <!-- the lines: the middle to the groups, the groups to their things -->
        <line v-for="g in layout.groups" :key="`e${g.id}`" x1="0" y1="0" :x2="g.x" :y2="g.y" :style="{ stroke: focusId === g.id ? 'var(--ai-graph-edge-lit)' : 'var(--ai-graph-edge)' }" stroke-width="1.4" />
        <path v-for="l in layout.leaves" :key="`e${l.id}`" :d="curve(layout.groups.find((g) => g.id === l.from)!.x, layout.groups.find((g) => g.id === l.from)!.y, l.x, l.y, l.angle)" fill="none" :style="{ stroke: lit(l.id, l.from) ? 'var(--ai-graph-edge-lit)' : 'var(--ai-graph-edge)' }" :stroke-width="lit(l.id, l.from) ? 1.8 : 1" />
        <!-- the document -->
        <circle r="7" :style="{ fill: 'var(--accent)' }" />
        <text y="22" text-anchor="middle" font-size="12" font-weight="600" :style="{ fill: 'var(--text-hi)' }">{{ cut(title, 30) }}</text>
        <!-- the groups -->
        <g v-for="g in layout.groups" :key="g.id" data-node class="tw:cursor-default" @pointerenter="hover = g.id" @pointerleave="hover = undefined">
          <circle :cx="g.x" :cy="g.y" r="5" :style="{ fill: 'var(--muted)' }" />
          <text :x="g.x" :y="g.y - 9" text-anchor="middle" font-size="12" font-weight="600" :style="{ fill: 'var(--text)' }">{{ g.group.label }}</text>
        </g>
        <!-- the things touched -->
        <g v-for="l in layout.leaves" :key="l.id" data-node :class="canOpen(l.leaf) ? 'tw:cursor-pointer' : 'tw:cursor-default'" :opacity="gone.has(l.id) ? 0.4 : 1" @pointerenter="hover = l.id" @pointerleave="hover = undefined" @click="click(l.leaf)">
          <circle :cx="l.x" :cy="l.y" :r="focusId === l.id ? 6 : 4.5" :style="{ fill: gone.has(l.id) ? 'none' : colorOf(l.leaf), stroke: l.leaf.failed ? 'var(--down)' : gone.has(l.id) ? colorOf(l.leaf) : 'none' }" stroke-width="2" />
          <text v-bind="{ transform: labelOf(l.x, l.y, l.angle).transform }" :dx="labelOf(l.x, l.y, l.angle).dx" dy="4" :text-anchor="labelOf(l.x, l.y, l.angle).anchor" font-size="11" :text-decoration="gone.has(l.id) ? 'line-through' : undefined" :style="{ fill: focusId === l.id ? 'var(--text-hi)' : 'var(--text-2)', fontFamily: 'var(--font-data)' }">
            {{ cut(l.leaf.label) }}<tspan v-if="l.leaf.turns.length > 1" :style="{ fill: 'var(--ai-graph-edge-lit)' }"> ×{{ l.leaf.turns.length }}</tspan>
          </text>
        </g>
      </svg>
      <!-- what is pointed at -->
      <div class="tw:flex tw:flex-none tw:flex-col tw:gap-6 tw:w-240 tw:min-h-0 tw:overflow-y-auto tw:text-[11.5px]">
        <template v-if="focusLeaf">
          <b class="tw:text-text-hi tw:text-[12.5px] tw:wrap-anywhere">{{ focusLeaf.label }}</b>
          <span v-if="focusLeaf.ref" class="tw:text-muted tw:font-data tw:wrap-anywhere">{{ focusLeaf.ref }}</span>
          <span class="tw:text-text-2">{{ opsText(focusLeaf) || 'ошибка хода' }}<template v-if="focusLeaf.failed"> · <span class="tw:text-down-fg">не удалось ×{{ focusLeaf.failed }}</span></template></span>
          <span v-if="gone.has(focusLeaf.id)" class="tw:text-warn-fg">Этого уже нет в документе — здесь след прошлого хода (журнал — история, а не текущее состояние)</span>
          <button v-if="canOpen(focusLeaf)" class="tw:self-start tw:inline-flex tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:rounded-full tw:text-[11.5px]" @click="click(focusLeaf)"><Icon name="external" :size="11" />Открыть</button>
          <span class="tw:mt-4 tw:text-muted">Ходы ({{ focusLeaf.turns.length }}) — клик: показать только его</span>
          <button v-for="id in [...focusLeaf.turns].reverse()" :key="id" class="tw:flex tw:flex-col tw:items-start tw:gap-1 tw:w-full tw:h-auto tw:py-4 tw:px-6 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-left tw:hover:bg-white/6 tw:[&.on]:bg-accent/15" :class="{ on: only === id }" @click="only = only === id ? '' : id">
            <span class="tw:text-muted tw:font-data tw:text-[10.5px]">{{ byId.get(id) ? when(byId.get(id)!.at) : '' }} · {{ byId.get(id)?.agent }}</span>
            <span class="tw:max-w-full tw:truncate tw:text-text-2">{{ byId.get(id)?.asker }}: {{ byId.get(id)?.question }}</span>
          </button>
        </template>
        <p v-else class="tw:m-0 tw:text-muted">Наведите на узел — что ИИ с ним делал и в каких ходах; клик — открыть. Колесо — масштаб, перетаскивание — сдвиг.</p>
      </div>
    </div>
  </div>
</template>
