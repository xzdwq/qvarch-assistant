<script setup lang="ts">
/**
 * A table of the ER diagram: its name (its schema when not the default; a view marked; its comment in the hint), then
 * its columns — the name, the type (coloured by its kind), the marks (PK, FK, UQ, NN), the hint: its comment, its
 * default, where it points. Its head pointed at — all its references lit, moving; a column with references pointed at —
 * its own lit, and the columns at their other ends; clicked — so it stays. The head's right button — its menu. A
 * column's ends: on the left — where references come in, on the right — where its own go out. A neighbour (drawn for
 * its references, not asked for) — dimmer.
 */
import { Handle, Position } from '@vue-flow/core'
import { colId, erTypeKind, type ErColumn } from '@shared/sql'
import type { ErNodeData } from './erLayout'
import { useEr } from './erContext'

const props = defineProps<{ id: string; data: ErNodeData }>()
const er = useEr()
/** Each mark a column may have: when, its word, its hint. */
const MARKS: Array<{ on: (c: ErColumn) => boolean; word: string; hint: string; cls: string }> = [
  { on: (c) => c.pk, word: 'PK', hint: 'первичный ключ', cls: 'tw:bg-warn/20 tw:text-warn-fg' },
  { on: (c) => !!c.fk?.length, word: 'FK', hint: 'внешний ключ', cls: 'tw:bg-accent/20 tw:text-accent-fg' },
  { on: (c) => c.unique && !c.pk, word: 'UQ', hint: 'уникальное', cls: 'tw:bg-info/18 tw:text-info-fg' },
  { on: (c) => !c.nullable && !c.pk, word: 'NN', hint: 'NOT NULL', cls: 'tw:bg-white/8 tw:text-text-2' },
]
function hintOf(c: ErColumn): string {
  return [
    `${c.name}${c.type ? ` · ${c.type}` : ''}`,
    ...MARKS.filter((m) => m.on(c)).map((m) => m.hint),
    c.default !== undefined ? `по умолчанию: ${c.default}` : '',
    ...(c.fk ?? []).map((r) => `→ ${r.schema ? `${r.schema}.` : ''}${r.table}${r.column ? `.${r.column}` : ''}`),
    c.comment ? `\n${c.comment}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
const lit = (c: ErColumn) => er.lit.value.columns.has(colId(props.id, c.name))
</script>

<template>
  <div class="er-table tw:h-full tw:flex tw:flex-col tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-panel tw:overflow-hidden tw:text-[12px] tw:[&.near]:opacity-70" :class="{ near: !data.picked }">
    <div
      class="tw:flex tw:flex-none tw:items-center tw:gap-6 tw:h-32 tw:px-10 tw:border-b tw:border-border-2 tw:bg-panel-2 tw:font-semibold tw:text-text-hi tw:whitespace-nowrap tw:cursor-grab"
      :title="data.table.comment ?? data.label"
      @pointerenter="er.point({ kind: 'table', table: id })"
      @pointerleave="er.point(undefined)"
      @contextmenu.prevent.stop="er.menu(id, $event)"
    >
      <span class="tw:min-w-0 tw:truncate">{{ data.label }}</span>
      <span v-if="data.table.view" class="tw:flex-none tw:px-5 tw:rounded-r1 tw:bg-white/8 tw:text-muted tw:text-[10px] tw:font-normal">view</span>
      <span class="tw:flex-1"></span>
      <span v-if="data.table.comment" class="tw:min-w-0 tw:max-w-140 tw:truncate tw:text-muted tw:text-[11px] tw:font-normal">{{ data.table.comment }}</span>
    </div>
    <div
      v-for="c in data.table.columns"
      :key="c.name"
      class="tw:relative tw:flex tw:flex-none tw:items-center tw:gap-6 tw:h-22 tw:px-10 tw:whitespace-nowrap tw:cursor-pointer tw:hover:bg-white/5 tw:[&.lit]:bg-accent/20 tw:[&.lit]:[box-shadow:inset_2px_0_0_var(--accent)]"
      :class="{ lit: lit(c) }"
      :title="hintOf(c)"
      @pointerenter="er.point({ kind: 'column', table: id, column: c.name })"
      @pointerleave="er.point(undefined)"
      @click.stop="er.pick({ kind: 'column', table: id, column: c.name })"
    >
      <Handle :id="`${c.name}-t`" type="target" :position="Position.Left" :connectable="false" class="er-handle" />
      <span class="tw:min-w-0 tw:truncate tw:font-data" :class="c.pk ? 'tw:text-text-hi tw:font-semibold' : 'tw:text-text'">{{ c.name }}</span>
      <span class="tw:flex tw:flex-none tw:gap-2">
        <span v-for="m in MARKS.filter((x) => x.on(c))" :key="m.word" class="tw:px-3 tw:rounded-r1 tw:font-data tw:text-[9.5px] tw:font-semibold" :class="m.cls">{{ m.word }}</span>
      </span>
      <span class="tw:flex-1"></span>
      <span class="tw:min-w-0 tw:truncate tw:font-data tw:text-[11px]" :style="{ color: `var(--er-type-${erTypeKind(c.type)})` }">{{ c.type ?? '' }}</span>
      <Handle :id="`${c.name}-s`" type="source" :position="Position.Right" :connectable="false" class="er-handle" />
    </div>
  </div>
</template>
