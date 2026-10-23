<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ImportedBook, ImportedSheet } from '@shared/tableData'
import { coveredBy, mergeAt, type TableModel } from '../model'
import { tableShape } from '../modelImport'

/**
 * Importing into a table: the sheet (a file of several), «Первая строка — заголовки», a look at the table it makes
 * (its first rows, merged cells as they will be), then «Заменить таблицу». Esc — cancelled.
 */
const props = defineProps<{ book: Extract<ImportedBook, { ok: true }>; sheet: ImportedSheet | undefined; sheetIndex: number }>()
const headRow = defineModel<boolean>('headRow', { required: true })
const emit = defineEmits<{ pick: [index: number]; apply: []; cancel: [] }>()

/** Rows of the look (the table may be thousands). */
const PREVIEW_ROWS = 12
/** The table the sheet makes, its first rows (merges cut at the look's edge). */
const preview = computed<TableModel | undefined>(() => {
  if (!props.sheet) return undefined
  const s = tableShape(props.sheet.grid, headRow.value)
  const rows = s.rows.slice(0, PREVIEW_ROWS)
  const merges = s.merges?.filter((m) => m.r < rows.length).map((m) => ({ ...m, rs: Math.min(m.rs, rows.length - m.r) }))
  return { head: s.head, rows, merges, align: [] }
})
const size = computed(() => {
  const g = props.sheet?.grid
  return g ? `${Math.max(0, g.rows.length - (headRow.value ? 1 : 0))} строк × ${g.rows[0]?.length ?? 0} столбцов` : ''
})
const span = (r: number, c: number) => {
  const m = preview.value && mergeAt(preview.value, r, c)
  return m ? { rowspan: m.rs, colspan: m.cs } : {}
}
const shown = (r: number, c: number) => !!preview.value && !coveredBy(preview.value, r, c)
/** The dialog takes the keyboard (Esc closes it). */
const panel = ref<HTMLElement>()
onMounted(() => panel.value?.focus())
</script>

<template>
  <Teleport to="body">
    <div class="ti-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[8vh] tw:bg-black/55" @keydown.esc="emit('cancel')">
      <div class="ti tw:flex tw:flex-col tw:gap-10 tw:w-[min(760px,calc(100vw-32px))] tw:max-h-[80vh] tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:outline-none" :ref="(el) => (panel = (el as HTMLElement) ?? undefined)" tabindex="-1">
        <div class="cap tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase tw:whitespace-nowrap">
          <span class="tw:overflow-hidden tw:text-ellipsis">Импорт: {{ book.name }}</span>
          <span class="tw:flex-1"></span>
          <span class="tw:normal-case tw:tracking-normal tw:text-[11.5px]">{{ size }}</span>
        </div>
        <div v-if="book.sheets.length > 1" class="sheets tw:flex tw:flex-wrap tw:gap-4" title="Лист книги">
          <button v-for="(s, i) in book.sheets" :key="i" class="tw:h-24 tw:py-0 tw:px-8 tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg tw:[&.on]:border-accent/60" :class="{ on: i === sheetIndex }" @click="emit('pick', i)">{{ s.name }}</button>
        </div>
        <label class="check tw:flex tw:items-center tw:gap-8 tw:text-text tw:text-[12.5px]"><input v-model="headRow" type="checkbox" /> Первая строка — заголовки столбцов</label>
        <p v-if="sheet?.truncated" class="warn tw:m-0 tw:text-warn-fg tw:text-[11.5px]">Лист большой — взяты первые 5000 строк и 200 столбцов.</p>
        <div class="ti-look tw:min-h-0 tw:overflow-auto tw:border tw:border-border tw:rounded-r2">
          <table v-if="preview" class="tw:border-separate tw:[border-spacing:0] tw:text-[12px]">
            <thead>
              <tr>
                <template v-for="(h, c) in preview.head" :key="c">
                  <th v-if="shown(-1, c)" v-bind="span(-1, c)" class="tw:py-5 tw:px-8 tw:text-left tw:font-semibold tw:text-text-hi tw:bg-panel-2 tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:whitespace-nowrap tw:max-w-220 tw:overflow-hidden tw:text-ellipsis">{{ h || ' ' }}</th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, r) in preview.rows" :key="r">
                <template v-for="(cell, c) in row" :key="c">
                  <td v-if="shown(r, c)" v-bind="span(r, c)" class="tw:py-4 tw:px-8 tw:text-text tw:border-r tw:border-r-border tw:border-b tw:border-b-border tw:whitespace-pre tw:max-w-220 tw:overflow-hidden tw:text-ellipsis tw:align-top" :class="{ 'tw:text-center tw:align-middle': !!mergeAt(preview, r, c) }">{{ cell || ' ' }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tqb tw:flex tw:items-center tw:gap-8">
          <button class="primary" :disabled="!preview" @click="emit('apply')">Заменить таблицу</button>
          <button @click="emit('cancel')">Отмена</button>
          <span class="hint tw:text-muted tw:text-[11.5px]">Таблица заменится целиком; объединённые ячейки сохранятся</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
