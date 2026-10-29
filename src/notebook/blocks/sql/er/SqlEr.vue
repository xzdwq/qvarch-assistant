<script setup lang="ts">
/**
 * The ER diagram of a query block's database, under the block: its bar (what it is built of, how far the neighbours
 * go, the tables picked, read again, copy as Mermaid, over the whole window, close), then where it is — reading the
 * structure / laying it out (with «Остановить»), a big one asked once more, the tables to pick, the error — or the
 * diagram: the tables as cards, a reference from its column to the column it points to, coloured by its column's kind
 * of type. Pointed at — a table (all its references, moving), a column (its own and the columns they join), a line (it,
 * its two columns, «таблица.поле → таблица.поле» by the pointer); clicked (a column, a line) — it stays lit until another
 * click or one on the empty place. A table's head, the right button — take it off, put on a table it is linked to.
 */
import { computed, ref } from 'vue'
import { MarkerType, VueFlow, type Edge, type EdgeMouseEvent } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { erLabel, erLit, erMermaid, hasLines, type ErFocus } from '@shared/sql'
import Icon from '@renderer/components/Icon.vue'
import MenuButton, { type MenuItem } from '@renderer/components/MenuButton.vue'
import Popover from '@renderer/components/Popover.vue'
import { cssColor } from '@renderer/lib/cssColor'
import ErPicker from './ErPicker.vue'
import ErTableNode from './ErTableNode.vue'
import { provideEr } from './erContext'
import type { ErEdgeData } from './erLayout'
import { ER_BIG, ER_DEPTHS, type ErMode, type SqlEr } from './useSqlEr'

/** `height` — the diagram's, px (none — all the room there is: in a tab of its own, `inTab`). */
const props = defineProps<{ er: SqlEr; height?: number; inTab?: boolean }>()
/** Asked to move into a tab of its own. */
const emit = defineEmits<{ tab: [] }>()
const er = props.er
const MODE_WORD: Record<ErMode, string> = { query: 'по таблицам запроса', picked: 'по выбранным таблицам', all: 'вся база' }
const DEPTH_WORD = (d: number) => (d === 0 ? 'без соседей' : `связи · ${d}`)
const depthItems = computed<MenuItem[]>(() =>
  ER_DEPTHS.map((d) => ({ label: `${er.depth.value === d ? '✓ ' : ''}${d === 0 ? 'Только сами таблицы' : `Соседи на ${d} ${d === 1 ? 'связь' : 'связи'}`}`, run: () => ((er.depth.value = d), void er.draw(false)) })),
)
const copied = ref(false)
async function copyMermaid(): Promise<void> {
  if (!er.schema.value) return
  await navigator.clipboard.writeText(`\`\`\`mermaid\n${erMermaid(er.schema.value, er.keys.value)}\n\`\`\``)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// ---------- what is lit: the pick (a click) and what is pointed at ----------
const picked = ref<ErFocus>()
const pointed = ref<ErFocus>()
const lines = computed(() => er.edges.value.map((e) => e.data!))
const lit = computed(() => erLit(lines.value, picked.value, pointed.value))
provideEr({
  lit,
  point: (f) => (pointed.value = f),
  // (a column with no references lights nothing — no pick; the same one again — let go)
  pick: (f) => {
    if (f.kind === 'column' && !hasLines(lines.value, f.table, f.column)) return
    picked.value = JSON.stringify(picked.value) === JSON.stringify(f) ? undefined : f
  },
  menu: (table, e) => ((tip.value = undefined), (menu.value = { table, x: e.clientX, y: e.clientY })),
})
const shown = computed<Edge<ErEdgeData>[]>(() => {
  const l = lit.value
  const any = l.lines.size > 0
  return er.edges.value.map((e) => {
    const on = l.lines.has(e.id)
    const color = on ? cssColor('--accent') : cssColor(`--er-type-${e.data!.kind}`)
    return {
      ...e,
      animated: on && l.moving,
      class: `${e.class ?? ''}${on ? ' er-lit' : any ? ' er-dim' : ''}`,
      style: { stroke: color },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
      zIndex: on ? 10 : 0,
    }
  })
})

// ---------- a line: its words by the pointer; clicked — picked ----------
const tip = ref<{ x: number; y: number; text: string }>()
const lineWords = (d: ErEdgeData) => {
  const name = (k: string) => {
    const t = er.schema.value?.tables.find((x) => `${x.schema ?? ''}.${x.name}` === k)
    return t ? erLabel(t, er.schema.value?.defaultSchema) : k.replace(/^\./, '')
  }
  return `${name(d.fromTable)}.${d.fromColumn} → ${name(d.toTable)}.${d.toColumn}${d.optional ? ' (может быть пустым)' : ''}`
}
function onLine(e: EdgeMouseEvent): void {
  const d = e.edge.data as ErEdgeData
  pointed.value = { kind: 'line', id: d.id }
  const m = e.event as MouseEvent
  tip.value = { x: m.clientX, y: m.clientY, text: lineWords(d) }
}
function offLine(): void {
  pointed.value = undefined
  tip.value = undefined
}
const pickLine = (e: EdgeMouseEvent) => (picked.value = { kind: 'line', id: (e.edge.data as ErEdgeData).id })

// ---------- a table's menu (the right button on its head) ----------
const menu = ref<{ table: string; x: number; y: number }>()
const menuOpen = computed({ get: () => !!menu.value, set: (v) => !v && (menu.value = undefined) })
const linked = computed(() => (menu.value ? er.linkedOff(menu.value.table) : []))
const tableWord = (k: string) => {
  const t = er.schema.value?.tables.find((x) => `${x.schema ?? ''}.${x.name}` === k)
  return t ? erLabel(t, er.schema.value?.defaultSchema) : k
}
function takeOff(): void {
  if (!menu.value) return
  // (what was picked may have been on it — let go)
  picked.value = undefined
  er.remove(menu.value.table)
  menu.value = undefined
}
function putOn(k: string): void {
  if (menu.value) er.add(k, menu.value.table)
  menu.value = undefined
}

const nodeTypes = { table: ErTableNode } as never
const count = computed(() => ({ tables: er.nodes.value.length, links: er.edges.value.length }))
/** The buttons' look (their words in the middle). */
const BTN = 'tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:gap-4 tw:h-26 tw:px-12 tw:rounded-[13px] tw:text-[12px] tw:leading-none'
</script>

<template>
  <div class="er tw:flex tw:flex-col tw:min-w-0 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg tw:overflow-hidden tw:[&.er-in-tab]:flex-1 tw:[&.er-in-tab]:min-h-0 tw:[&.er-in-tab]:rounded-none tw:[&.er-in-tab]:border-0" :class="{ 'er-in-tab': inTab }">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:min-w-0 tw:py-4 tw:px-8 tw:border-b tw:border-border tw:text-[12.5px] tw:whitespace-nowrap">
      <Icon name="branch" :size="13" class="tw:flex-none tw:text-accent-fg" />
      <b class="tw:flex-none">ER</b>
      <span class="tw:min-w-0 tw:truncate tw:text-muted">{{ MODE_WORD[er.mode.value] }}<template v-if="er.phase.value === 'ready'"> · таблиц {{ count.tables }} · связей {{ count.links }}</template></span>
      <span v-if="er.schema.value?.truncated" class="tw:flex-none tw:text-warn-fg tw:text-[11.5px]" title="Каталог базы больше, чем читается за раз — часть таблиц может не попасть">не вся структура</span>
      <span class="tw:flex-1"></span>
      <MenuButton v-if="er.mode.value !== 'all'" :label="DEPTH_WORD(er.depth.value)" :disabled="er.busy.value || !er.schema.value" title="Соседние таблицы: связанные внешними ключами в любую сторону" :width="220" :items="depthItems" />
      <button class="pill" :class="BTN" :disabled="er.busy.value" title="Выбрать таблицы самому" @click="er.build('picked')"><Icon name="list" :size="12" />Таблицы…</button>
      <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:disabled:opacity-40" :disabled="er.busy.value" title="Прочитать структуру базы заново" @click="er.build(er.mode.value, true)"><Icon name="refresh" :size="13" /></button>
      <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:disabled:opacity-40" :disabled="er.phase.value !== 'ready'" :title="copied ? 'Скопировано' : 'Скопировать как Mermaid — вставить схему в заметку'" @click="copyMermaid"><Icon :name="copied ? 'check' : 'copy'" :size="13" /></button>
      <button v-if="!inTab" class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:hover:enabled:bg-hover tw:disabled:opacity-40" :disabled="er.busy.value" title="Открыть в отдельной вкладке блокнота (здесь — закроется)" @click="emit('tab')"><Icon name="external" :size="13" /></button>
      <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:hover:bg-hover" title="Закрыть ER (идущее чтение останавливается)" @click="er.close()"><Icon name="x" :size="13" /></button>
    </div>

    <div class="tw:relative tw:min-h-0 tw:in-[.er-in-tab]:flex-1" :style="height ? { height: `${height}px` } : undefined">
      <!-- reading / laying out: a loader, and a way to stop it -->
      <div v-if="er.busy.value" class="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:text-muted tw:text-[12.5px]">
        <Icon name="refresh" :size="20" class="tw:animate-spin tw:text-accent-fg" />
        <span>{{ er.phase.value === 'read' ? 'Читаю структуру базы — только чтение, отдельное соединение…' : `Раскладываю схему: таблиц ${er.keys.value.length}…` }}</span>
        <button class="pill" :class="BTN" :title="er.phase.value === 'read' ? 'Запрос к каталогу снимается на сервере, соединение закрывается' : 'Раскладка прерывается'" @click="er.stop()"><Icon name="stop" :size="11" />Остановить</button>
      </div>
      <div v-else-if="er.phase.value === 'confirm'" class="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:p-20 tw:text-center tw:text-[12.5px]">
        <span>Таблиц в схеме: <b>{{ er.keys.value.length }}</b> (больше {{ ER_BIG }}) — схема будет крупной, раскладка займёт время.</span>
        <span class="tw:flex tw:gap-8">
          <button class="primary" :class="BTN" @click="er.draw(true)">Построить все</button>
          <button class="pill" :class="BTN" @click="er.build('picked')">Выбрать таблицы</button>
        </span>
      </div>
      <div v-else-if="er.phase.value === 'pick' && er.schema.value" class="tw:absolute tw:inset-0 tw:p-10">
        <ErPicker v-model="er.picked.value" :schema="er.schema.value" @build="er.draw(false)" />
      </div>
      <div v-else-if="er.phase.value === 'error'" class="tw:absolute tw:inset-0 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-10 tw:p-20 tw:text-center tw:text-[12.5px]">
        <span :class="er.error.value === 'Остановлено' ? 'tw:text-muted' : 'tw:text-down-fg'">{{ er.error.value }}</span>
        <button class="pill" :class="BTN" @click="er.build(er.mode.value)">Ещё раз</button>
      </div>
      <VueFlow
        v-else-if="er.phase.value === 'ready'"
        v-model:nodes="er.nodes.value"
        class="er-flow"
        :edges="shown"
        :node-types="nodeTypes"
        :nodes-connectable="false"
        :edges-updatable="false"
        :min-zoom="0.05"
        :max-zoom="2"
        fit-view-on-init
        @edge-mouse-enter="onLine"
        @edge-mouse-move="onLine"
        @edge-mouse-leave="offLine"
        @edge-click="pickLine"
        @pane-click="picked = undefined"
      >
        <MiniMap pannable zoomable :node-color="() => cssColor('--panel-3')" :mask-color="cssColor('--er-map-mask')" />
        <Controls :show-interactive="false" />
      </VueFlow>
    </div>
    <!-- a line's words by the pointer -->
    <Teleport to="body">
      <div v-if="tip" class="tw:fixed tw:z-6000 tw:pointer-events-none tw:py-3 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-pop tw:shadow-pop tw:font-data tw:text-[11.5px] tw:text-text tw:whitespace-nowrap" :style="{ left: `${tip.x + 14}px`, top: `${tip.y + 14}px` }">{{ tip.text }}</div>
    </Teleport>
    <!-- a table's menu -->
    <Popover v-model:open="menuOpen" :anchor="menu ? { x: menu.x, y: menu.y } : undefined" :width="260" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-1 tw:max-h-[min(420px,70vh)] tw:p-4 tw:overflow-y-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
      <span v-if="menu" class="tw:px-8 tw:py-3 tw:text-muted tw:text-[11.5px] tw:truncate">{{ tableWord(menu.table) }}</span>
      <button class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text tw:hover:bg-hover" @click="takeOff"><Icon name="eyeOff" :size="13" />Убрать таблицу</button>
      <span class="tw:h-1 tw:my-3 tw:bg-border"></span>
      <span class="tw:px-8 tw:py-2 tw:text-muted tw:text-[11.5px]">{{ linked.length ? 'Добавить связанную' : 'Все связанные уже на схеме' }}</span>
      <button v-for="k in linked" :key="k" class="tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:h-28 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text tw:whitespace-nowrap tw:hover:bg-hover" @click="putOn(k)"><Icon name="plus" :size="13" /><span class="tw:min-w-0 tw:truncate tw:font-data">{{ tableWord(k) }}</span></button>
    </Popover>
  </div>
</template>

<style scoped src="./SqlEr.css"></style>
