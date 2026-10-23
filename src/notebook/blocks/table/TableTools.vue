<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { summary } from '@nb/domain/values'
import MenuButton, { type MenuItem } from '@renderer/components/MenuButton.vue'
import type { TableFileFormat } from '@shared/tableData'
import { IMPORT_SOURCE_DEFS, IMPORT_SOURCES, type ImportSourceId } from './import/importSources'
import SuggestInput from '@renderer/components/SuggestInput.vue'
import Icon from '@renderer/components/Icon.vue'
import { rowsExportItems } from '@renderer/lib/grid'
import { tableText, type TableModel } from './model'
import VarNameField from '@nb/ui/VarNameField.vue'
import { useTableSource } from './useTableSource'
import type { useTableVar } from './useTableVar'

type TableVarState = ReturnType<typeof useTableVar>

/**
 * The line over a note's table: its variable in the note (its name, renamed here), its type (its own data, or «Из
 * переменной» — the value's path, its state, «Отделить»), how it is shown (a table or JSON), the text wrapped or cut,
 * copied / saved as Excel or CSV.
 */
const props = defineProps<{ table: TableModel; path?: string; line?: number; tableVar: TableVarState }>()
const emit = defineEmits<{ commit: []; import: [source: ImportSourceId] }>()
const asJson = defineModel<boolean>('asJson', { required: true })
const t = toRef(props, 'table')
const commit = () => emit('commit')
const tv = props.tableVar
const { source, edited, stale, fill, asking, fromDraft, setFrom, detach, varNames } = useTableSource(t, commit, () => ({ path: props.path, line: props.line }), () => tv.name.value)
const nameTitle = computed(() =>
  tv.clash.value
    ? `Имя ${tv.name.value} занято ${tv.clash.value === 'block' ? 'другим блоком' : 'таблицей выше'} — таблица не видна в заметке как переменная; переименуйте`
    : `Переменная таблицы: строки как объекты по заголовку. В коде — ${tv.name.value}, в шаблонах — {{${tv.name.value}}}. Нажмите, чтобы переименовать`,
)

function setWrap(on: boolean): void {
  t.value.wrap = on || undefined
  commit()
}
const exported = ref('')
async function exportAs(format: TableFileFormat): Promise<void> {
  exported.value = ''
  const file = await window.qa.tableFile('exportRows', { format, name: t.value.from ?? 'Таблица', columns: t.value.head.map((name) => ({ name })), rows: t.value.rows.map((r) => [...r]) })
  if (file) exported.value = `Сохранено: ${file}`
}
/** The table's file menu: copied / saved as Excel or CSV — and filled from a file or the clipboard. */
const fileItems = computed<MenuItem[]>(() => [
  ...rowsExportItems(() => navigator.clipboard.writeText(tableText(t.value)), exportAs),
  ...IMPORT_SOURCES.map((id) => ({ ...IMPORT_SOURCE_DEFS[id], run: () => emit('import', id) })),
])
</script>

<template>
  <div class="bt-tools tw:relative tw:z-4 tw:flex tw:flex-wrap tw:items-center tw:gap-6 tw:min-w-0 tw:text-muted tw:text-[12px] tw:whitespace-nowrap" @mousedown.prevent>
    <VarNameField v-model="tv.draft.value" :bad="!!(tv.clash.value || tv.error.value)" :title="tv.error.value || nameTitle" @commit="tv.rename(commit)" @cancel="tv.revert" @mousedown.stop />
    <span class="seg tw:inline-flex tw:flex-none tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden" title="Тип таблицы">
      <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !table.from && !asking }" title="Обычная таблица: данные — свои" @click="detach">Обычная</button>
      <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !!table.from || asking }" title="Заполняется из переменной заметки (строки запроса, список из ответа, результат кода); правьте как обычную, «Отделить» — оставить данные себе" @click="((asking = true), (fromDraft = table.from ?? varNames[0] ?? ''))">Из переменной</button>
    </span>
    <label v-if="asking || table.from" class="bt-var tw:inline-flex tw:items-center tw:h-24 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-dim tw:font-data" :title="source?.ok ? summary(source.value) : ''" @mousedown.stop>
      <span>{{ '{' }}{{ '{' }}</span><SuggestInput v-model="fromDraft" :options="varNames" placeholder="rows или resp.body.data" @commit="setFrom" @cancel="((asking = false), (fromDraft = table.from ?? ''))" /><span>{{ '}' }}{{ '}' }}</span>
    </label>
    <template v-if="table.from">
      <span v-if="!source?.ok" class="warn tw:text-warn-fg">нет значения — выполните блок, который его даёт</span>
      <button v-else-if="stale" class="pill warn tw:text-warn-fg tw:inline-flex tw:items-center tw:gap-4 tw:h-22 tw:py-0 tw:px-8 tw:border tw:border-current tw:rounded-[11px] tw:bg-transparent tw:text-[11.5px]" title="Значение переменной изменилось, а таблицу правили — заполнить заново (правки пропадут)" @click="fill"><Icon name="refresh" :size="12" />Обновить</button>
      <span v-else-if="edited" class="muted tw:text-muted" title="Таблицу правили: при изменении переменной спрошу, обновлять ли">изменена</span>
      <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Отделить от переменной: таблица остаётся со своими данными" @click="detach"><Icon name="scissors" :size="13" /></button>
    </template>
    <span class="seg tw:inline-flex tw:flex-none tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden" title="Как показать">
      <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !asJson }" @click="asJson = false">Таблица</button>
      <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: asJson }" title="Строки как JSON: заголовки — ключи" @click="asJson = true">JSON</button>
    </span>
    <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:[&.on]:not-hover:bg-accent/20 tw:[&.on]:not-hover:text-accent-fg tw:hover:bg-hover tw:hover:text-text" :class="{ on: table.wrap }" :title="table.wrap ? 'Текст в ячейках переносится — нажмите: в одну строку с «…»' : 'Текст в ячейках в одну строку, длинный — с «…» (копируется целиком). Нажмите — переносить'" @click="setWrap(!table.wrap)"><Icon name="rows" :size="13" /></button>
    <MenuButton icon="download" title="Скопировать, сохранить в Excel / CSV или заполнить из файла / буфера" :width="250" :items="fileItems" />
    <span v-if="exported" class="muted ex tw:text-muted tw:min-w-0 tw:overflow-hidden tw:text-ellipsis" :title="exported">{{ exported }}</span>
  </div>
</template>

<style scoped src="./TableTools.css"></style>
