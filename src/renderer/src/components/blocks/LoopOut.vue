<script setup lang="ts">
import { computed, ref } from 'vue'
import { noteRun, pickPass } from '../../lib/runbook'
import { useFold } from '../../lib/foldState'
import { useGrid } from '../../lib/grid'
import { copyMd } from '../../lib/copyMd'
import { accGrid, accText, passTitle, passValue, type LoopBlockKind } from '../../lib/loopView'
import DataGrid from '../DataGrid.vue'
import Icon from '../Icon.vue'
import Markdown from '../Markdown.vue'
import MenuButton from '../MenuButton.vue'
import RunView from './RunView.vue'

/**
 * A block inside a loop, under it: its results over the loop's passes, shown one of three ways (kept in the block's
 * line — `out=`): one pass at a time (the block shows it; ‹ › — another), all together (one table / one text),
 * each apart (a result per pass, one under another). A template — its texts together only (folded or open).
 */
const props = defineProps<{ path: string; loopKey: string; kind: LoopBlockKind; blockKey: string; name?: string; out?: 'acc' | 'each'; onMode: (out: 'acc' | 'each' | undefined) => void }>()
const lr = computed(() => noteRun(props.path).loops[props.loopKey])
const tpl = computed(() => props.kind === 'tpl')
/** How it is shown: a template — together, always. */
const mode = computed(() => (tpl.value ? 'acc' : props.out))
const open = useFold(() => `${props.path}#${props.blockKey}#loop`, true)
const passes = computed(() => lr.value?.passes ?? [])
const cur = computed(() => lr.value?.sel ?? passes.value.length - 1)
const go = (d: number) => pickPass(props.path, props.loopKey, Math.min(passes.value.length - 1, Math.max(0, cur.value + d)))

// ---------- all together ----------
const acc = computed(() => (mode.value === 'acc' && !tpl.value ? accGrid(props.kind, passes.value, props.blockKey, props.name) : undefined))
const grid = useGrid(acc, () => props.name ?? 'Цикл')
const text = computed(() => (tpl.value ? accText(passes.value, props.blockKey, props.name) : ''))
const copied = ref(false)
async function copyText(): Promise<void> {
  await copyMd(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

// ---------- each apart ----------
const PAGE = 30
const limit = ref(PAGE)
const eachList = computed(() => (mode.value === 'each' ? passes.value.slice(0, limit.value) : []))
</script>

<template>
  <div v-if="lr" class="lo">
    <div class="lo-bar">
      <template v-if="tpl">
        <button class="ib" :title="open ? 'Свернуть' : 'Показать'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <b class="tt">Тексты проходов</b>
      </template>
      <Icon v-else name="repeat" :size="12" />
      <span v-if="!tpl" class="seg" title="Как показать результаты проходов цикла">
        <button :class="{ on: !out }" title="По одному проходу: блок показывает выбранный проход (‹ › — другой); «Выполнить» у блока — повторить этот проход" @mousedown.prevent @click="onMode(undefined)">Проход</button>
        <button :class="{ on: out === 'acc' }" :title="kind === 'tpl' ? 'Все тексты одним — подряд, через пустую строку' : 'Все проходы одной таблицей: № прохода, его значения, результат'" @mousedown.prevent @click="onMode('acc')">Вместе</button>
        <button :class="{ on: out === 'each' }" title="Результат каждого прохода отдельно, один под другим" @mousedown.prevent @click="onMode('each')">Каждый</button>
      </span>
      <template v-if="!mode && passes.length">
        <button class="ib" :disabled="cur <= 0" title="Предыдущий проход" @mousedown.prevent @click="go(-1)"><Icon name="chevronLeft" :size="12" /></button>
        <span class="pn" :title="passes[cur] ? passTitle(passes[cur]) : ''">{{ passes[cur] ? passTitle(passes[cur]) : '' }} <span class="muted">из {{ passes.length }}</span></span>
        <button class="ib" :disabled="cur >= passes.length - 1" title="Следующий проход" @mousedown.prevent @click="go(1)"><Icon name="chevronRight" :size="12" /></button>
      </template>
      <span v-else class="muted">{{ tpl ? '·' : 'проходов' }} {{ passes.length }}{{ lr.state === 'run' ? '…' : '' }}</span>
      <span class="grow"></span>
      <template v-if="mode === 'acc'">
        <button v-if="tpl" class="ib" :disabled="!text" :title="copied ? 'Скопировано' : 'Копировать все тексты: с оформлением и как Markdown'" @mousedown.prevent @click="copyText"><Icon :name="copied ? 'check' : 'copy'" :size="13" /></button>
        <template v-else>
          <span v-if="grid.copied.value" class="muted">скопировано</span>
          <span v-else-if="grid.selCount.value > 1" class="muted">выделено {{ grid.selCount.value }}</span>
          <MenuButton icon="download" title="Все проходы: скопировать или сохранить в Excel / CSV" :width="240" :items="grid.exportItems.value" />
        </template>
      </template>
    </div>
    <template v-if="mode === 'acc'">
      <template v-if="tpl"><Markdown v-if="open" class="lo-md" :text="text || '_Текстов пока нет_'" /></template>
      <DataGrid v-else-if="acc && acc.rows.length" :grid="grid" />
      <p v-else class="muted pad">Проходы ничего не дали.</p>
    </template>
    <div v-else-if="mode === 'each'" class="lo-each">
      <div v-for="p in eachList" :key="p.n" class="lo-it" :class="{ bad: p.state === 'error' }">
        <div class="lo-ih">{{ passTitle(p) }}<span v-if="p.state === 'run'" class="muted"> · выполняется…</span></div>
        <RunView :kind="kind" :run="p.runs?.[blockKey] ?? (p.state === 'error' ? { state: 'error', at: p.at, error: p.error } : undefined)" :value="passValue(kind, p, blockKey, name)" />
      </div>
      <button v-if="passes.length > limit" class="more" @mousedown.prevent @click="limit += PAGE">Ещё {{ Math.min(PAGE, passes.length - limit) }} из {{ passes.length - limit }}</button>
    </div>
  </div>
</template>

<style scoped>
.lo {
  margin-top: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  contain: inline-size;
}
.lo-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 6px;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.lo-bar + * {
  border-top: 1px solid var(--border);
}
.seg {
  display: inline-flex;
  flex: none;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  overflow: hidden;
}
.seg button {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.tt {
  color: var(--text-2);
  font-weight: 600;
}
.pn {
  min-width: 0;
  overflow: hidden;
  color: var(--text-2);
  font-family: var(--font-data);
  text-overflow: ellipsis;
}
.muted {
  color: var(--muted);
}
.pad {
  margin: 6px 10px;
}
.grow {
  flex: 1;
}
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.35;
}
.lo-md {
  padding: 6px 12px;
  user-select: text;
}
.lo-each {
  display: flex;
  flex-direction: column;
  max-height: 640px;
  overflow: auto;
}
.lo-it {
  padding: 4px 8px 6px;
  border-left: 3px solid transparent;
}
.lo-it + .lo-it {
  border-top: 1px solid var(--border);
}
.lo-it.bad {
  border-left-color: var(--down);
}
.lo-ih {
  margin-bottom: 3px;
  overflow: hidden;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.more {
  margin: 6px;
  align-self: flex-start;
}
</style>
