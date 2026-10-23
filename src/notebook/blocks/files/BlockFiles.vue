<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import { RECORDED_SET, type TestFile, type TestFileSet } from '@shared/testFiles'
import { DEFECTS, emptySpec, guessColumn, isExpectation, type CellType, type XSpec } from '@shared/excelGen'
import Icon from '@renderer/components/Icon.vue'
import GenPicker from './GenPicker.vue'

/**
 * «Тестовые файлы»: a set of files a scenario uploads (kept with the notebook) — added from the disk or dropped
 * here, recorded ones in «Записанные»; each marked with what it should lead to (taken / refused) and a note.
 * A scenario with an upload runs over a set by «Проверить ▾ → Прогнать с разными файлами».
 */
const props = defineProps<{ src: string; onChange?: (src: string) => void }>()
/** The block's own: its set, the generator's spec and faults picked (kept — the files can be made again). */
interface Cfg {
  set: string
  gen?: XSpec
  defects?: string[]
}
const cfg = computed<Cfg>(() => {
  try {
    const j = JSON.parse(props.src.split('\n').slice(1, -1).join('\n') || '{}') as Partial<Cfg>
    return { set: String(j.set ?? ''), ...(j.gen ? { gen: j.gen } : {}), ...(Array.isArray(j.defects) ? { defects: j.defects.map(String) } : {}) }
  } catch {
    return { set: '' }
  }
})
const save = (p: Partial<Cfg>) => props.onChange?.(`\`\`\`files\n${JSON.stringify({ ...cfg.value, ...p }, null, 2)}\n\`\`\``)
const write = (set: string) => save({ set })

const sets = shallowRef<TestFileSet[]>([])
const files = shallowRef<TestFile[]>([])
const err = ref('')
const set = computed(() => cfg.value.set || RECORDED_SET)
async function load(): Promise<void> {
  try {
    sets.value = await window.qa.files('sets')
    files.value = await window.qa.files('list', set.value)
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  }
}
onMounted(load)
watch(set, load)
// the window back — the files may have been changed outside (a recording, the folder)
onMounted(() => window.addEventListener('focus', load))

async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
  err.value = ''
  try {
    const r = await fn()
    await load()
    return r
  } catch (e) {
    err.value = remoteError(e)
    return undefined
  }
}
const pick = () => act(() => window.qa.files('pick', set.value))
const remove = (f: TestFile) => act(() => window.qa.files('remove', set.value, f.name))
const setExpect = (f: TestFile, v: string) => act(async () => window.qa.files('meta', set.value, f.name, { expect: isExpectation(v) ? v : null }))
const setNote = (f: TestFile, v: string) => act(async () => window.qa.files('meta', set.value, f.name, { note: v }))
const open = (f: TestFile) => act(() => window.qa.files('open', set.value, f.name))
const reveal = (f: TestFile) => act(async () => window.qa.files('reveal', set.value, f.name))
const renaming = ref<string>()
async function rename(f: TestFile, to: string): Promise<void> {
  renaming.value = undefined
  if (to.trim() && to.trim() !== f.name) await act(() => window.qa.files('rename', set.value, f.name, to.trim()))
}

// ---------- the set ----------
const newSet = ref<string>()
async function createSet(): Promise<void> {
  const n = (newSet.value ?? '').trim()
  newSet.value = undefined
  if (!n) return
  const made = await act(() => window.qa.files('createSet', n))
  if (made) write(made)
}
const sure = ref(false)
async function removeSet(): Promise<void> {
  if (!sure.value) return void ((sure.value = true), setTimeout(() => (sure.value = false), 3000))
  sure.value = false
  await act(async () => window.qa.files('removeSet', set.value))
  write(RECORDED_SET)
}

// ---------- dropped here ----------
const over = ref(false)
async function onDrop(e: DragEvent): Promise<void> {
  over.value = false
  const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.qa.pathForFile(f)).filter(Boolean)
  if (paths.length) await act(() => window.qa.files('add', set.value, paths))
}
// ---------- the Excel / CSV generator ----------
/** A copy free of Vue's proxies (structuredClone cannot copy them; IPC wants plain data). */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const genOpen = ref(false)
const spec = ref<XSpec>(plain(cfg.value.gen ?? emptySpec()))
const defects = ref<string[]>(cfg.value.defects ?? ['empty', 'type', 'nocol', 'header'])
watch(
  () => cfg.value.gen,
  (g) => g && JSON.stringify(g) !== JSON.stringify(spec.value) && (spec.value = plain(g)),
)
let saveTimer: ReturnType<typeof setTimeout> | undefined
// the spec kept with the block (a moment after the last change)
watch(
  [spec, defects],
  () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => save({ gen: plain(spec.value), defects: [...defects.value] }), 500)
  },
  { deep: true },
)
const addCol = () => spec.value.columns.push({ title: `Колонка ${spec.value.columns.length + 1}`, expr: 'gen.words(2)', type: 'auto', required: false, unique: false })
const fromTemplate = () =>
  act(async () => {
    const t = await window.qa.files('template')
    if (!t) return
    spec.value = { ...spec.value, name: t.name, sheet: t.sheet, columns: t.headers.map((h, i) => guessColumn(h, t.samples.map((r) => r[i] ?? ''))) }
  })
const made = ref('')
const generating = ref(false)
async function generate(): Promise<void> {
  made.value = ''
  generating.value = true
  const names = await act(() => window.qa.files('generate', set.value, plain(spec.value), [...defects.value]))
  generating.value = false
  if (names) made.value = `Создано файлов: ${names.length} — в наборе «${set.value}», с ожиданиями и заметками`
}
const TYPES: Array<[CellType, string]> = [
  ['auto', 'авто'],
  ['text', 'текст'],
  ['number', 'число'],
  ['date', 'дата'],
]
const size = (n: number) => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)
const counts = computed(() => ({ ok: files.value.filter((f) => f.expect === 'ok').length, bad: files.value.filter((f) => f.expect === 'bad').length }))
</script>

<template>
  <div class="tf tw:flex tw:flex-col tw:gap-8 tw:py-10 tw:px-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:text-[12.5px] tw:[&.over]:border-accent tw:[&.over]:bg-accent/8" :class="{ over }" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
    <div class="tf-head tw:flex tw:flex-wrap tw:items-center tw:gap-8">
      <Icon name="folder" :size="14" /><b>Тестовые файлы</b>
      <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" :value="set" title="Набор файлов" @change="write(($event.target as HTMLSelectElement).value)">
        <option v-if="!sets.some((s) => s.name === set)" :value="set">{{ set }} · 0</option>
        <option v-for="s in sets" :key="s.name" :value="s.name">{{ s.name }} · {{ s.count }}</option>
      </select>
      <template v-if="newSet !== undefined">
        <input v-model="newSet" class="nm tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-200" placeholder="Название набора" spellcheck="false" @keydown.enter.prevent="createSet" @keydown.esc.prevent="newSet = undefined" />
        <button class="primary sm tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:whitespace-nowrap" @click="createSet">Создать</button>
      </template>
      <button v-else class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Новый набор файлов (например, «Импорт: ошибки»)" @click="newSet = ''"><Icon name="folderPlus" :size="12" />новый набор</button>
      <span class="grow tw:flex-1"></span>
      <span class="muted cnt tw:text-muted tw:whitespace-nowrap">{{ files.length }} {{ files.length === 1 ? 'файл' : 'файлов' }}<template v-if="counts.ok || counts.bad"> · принять {{ counts.ok }} · отклонить {{ counts.bad }}</template></span>
      <button class="sm tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:whitespace-nowrap tw:[&.on]:border-accent" :class="{ on: genOpen }" title="Сделать Excel / CSV: корректный файл и файлы с типовыми ошибками" @click="genOpen = !genOpen"><Icon name="table" :size="12" />Сгенерировать</button>
      <button class="primary sm tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:whitespace-nowrap" title="Выбрать файлы на диске — они скопируются в набор" @click="pick"><Icon name="plus" :size="12" />Добавить файлы</button>
      <button v-if="set !== RECORDED_SET" class="ib tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:not-[&.warn]:bg-hover tw:hover:not-[&.warn]:text-text tw:[&.warn]:bg-stop/18 tw:[&.warn]:text-down-fg tw:hover:enabled:border-border-3" :class="{ warn: sure }" :title="sure ? 'Нажмите ещё раз — набор и его файлы будут удалены' : 'Удалить набор'" @click="removeSet"><Icon name="trash" :size="13" /></button>
    </div>
    <p v-if="err" class="er tw:m-0 tw:text-down-fg">{{ err }}</p>

    <!-- the generator: columns, rows, faults → files into this set -->
    <div v-if="genOpen" class="gen tw:flex tw:flex-col tw:gap-8 tw:p-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg">
      <div class="gen-row tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-12">
        <label class="tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:whitespace-nowrap">Имя файлов <input v-model="spec.name" class="nm tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-200" spellcheck="false" /></label>
        <label class="tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:whitespace-nowrap">Строк <input v-model.number="spec.rows" class="n tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-76" type="number" min="1" max="100000" /></label>
        <label class="tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:whitespace-nowrap">Формат
          <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="spec.format"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (;)</option></select>
        </label>
        <label class="tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:whitespace-nowrap" v-if="spec.format === 'xlsx'">Лист <input v-model="spec.sheet" class="sh tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-110" spellcheck="false" /></label>
        <span class="grow tw:flex-1"></span>
        <button class="sm tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:whitespace-nowrap" title="Взять колонки из своего файла (шаблона импорта): заголовки и значения первых строк — по ним подберутся генераторы" @click="fromTemplate"><Icon name="upload" :size="12" />Из шаблона…</button>
      </div>
      <table class="gen-t tw:w-full tw:border-collapse">
        <thead>
          <tr>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap">Колонка</th>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap">Значения</th>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap" title="Тип ячейки Excel: авто — по генератору">Тип</th>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap" title="Обязательная: для неё будет файл с пустой ячейкой">Обяз.</th>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap" title="Уникальная: значения не повторяются, будет файл с повтором">Уник.</th>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap" title="Максимум символов: будет файл со значением на 1 длиннее">Макс.</th>
            <th class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in spec.columns" :key="i">
            <td class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle"><input v-model="c.title" class="ct tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-150" spellcheck="false" /></td>
            <td class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle"><GenPicker :expr="c.expr" compact @update="(e) => (c.expr = e)" /></td>
            <td class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle">
              <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="c.type"><option v-for="t in TYPES" :key="t[0]" :value="t[0]">{{ t[1] }}</option></select>
            </td>
            <td class="ck tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:align-middle tw:text-center"><input class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="c.required" type="checkbox" /></td>
            <td class="ck tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:align-middle tw:text-center"><input class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="c.unique" type="checkbox" /></td>
            <td class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle"><input :value="c.maxLen ?? ''" class="n tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-76" type="number" min="1" placeholder="—" @change="c.maxLen = Number(($event.target as HTMLInputElement).value) || undefined" /></td>
            <td class="tw:py-3 tw:px-5 tw:border-b tw:border-b-border tw:text-left tw:align-middle"><button class="ib tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Убрать колонку" @click="spec.columns.splice(i, 1)"><Icon name="x" :size="12" /></button></td>
          </tr>
        </tbody>
      </table>
      <button class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="addCol"><Icon name="plus" :size="12" />колонка</button>
      <div class="gen-def tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-12">
        <span class="muted tw:text-muted">Файлы с ошибками:</span>
        <label class="tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:whitespace-nowrap" v-for="d in DEFECTS.filter((x) => !x.xlsxOnly || spec.format === 'xlsx')" :key="d.id" :title="`${d.hint}${d.expect ? ` — ожидание: ${d.expect === 'ok' ? 'принять' : 'отклонить'}` : ' — ожидание не задано: зависит от системы'}`">
          <input class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="defects" type="checkbox" :value="d.id" />{{ d.label }}
        </label>
      </div>
      <div class="gen-row tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-12">
        <button class="primary sm tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:whitespace-nowrap" :disabled="generating || !spec.columns.length" @click="generate"><Icon name="play" :size="11" />{{ generating ? 'Создаю…' : 'Создать файлы' }}</button>
        <span class="muted tw:text-muted">корректный + по файлу на каждую ошибку (и на каждую колонку, где ошибка про колонку); файлы с тем же именем пересоздаются</span>
      </div>
      <p v-if="made" class="ok-msg tw:flex tw:items-center tw:gap-6 tw:m-0 tw:text-up-fg"><Icon name="check" :size="12" />{{ made }}</p>
    </div>

    <div v-if="!files.length" class="tf-empty tw:flex tw:flex-col tw:items-center tw:gap-4 tw:p-16 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[6px] tw:text-text-2 tw:text-center">
      <Icon name="upload" :size="22" />
      <p class="tw:m-0">Перетащите файлы сюда или «Добавить файлы». Файлы, выбранные во время записи сценария, попадают в набор «{{ RECORDED_SET }}».</p>
      <p class="muted tw:text-muted tw:m-0">Сценарий с загрузкой файла прогоняется по всему набору: «Проверить ▾ → Прогнать с разными файлами».</p>
    </div>
    <table v-else class="tf-t tw:w-full tw:border-collapse">
      <thead><tr><th class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap">Файл</th><th class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap">Размер</th><th class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap" title="Что должно случиться с файлом: страница примет его или откажет (с сообщением)">Ожидание</th><th class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap">Заметка</th><th class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:text-text-2 tw:font-semibold tw:text-[11.5px] tw:whitespace-nowrap"></th></tr></thead>
      <tbody>
        <tr v-for="f in files" :key="f.name">
          <td class="nmc tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left">
            <input v-if="renaming === f.name" class="nm tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-200" :value="f.name" spellcheck="false" @keydown.enter.prevent="rename(f, ($event.target as HTMLInputElement).value)" @keydown.esc.prevent="renaming = undefined" @blur="rename(f, ($event.target as HTMLInputElement).value)" />
            <a class="tw:text-text tw:wrap-anywhere" v-else href="#" title="Открыть (двойной клик — переименовать)" @click.prevent="open(f)" @dblclick.prevent="renaming = f.name">{{ f.name }}</a>
          </td>
          <td class="sz tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:text-muted tw:font-data tw:text-[11.5px] tw:whitespace-nowrap">{{ size(f.size) }}</td>
          <td class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left">
            <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:[&.ok]:not-[&.bad]:text-up-fg tw:[&.bad]:text-warn-fg" :value="f.expect ?? ''" :class="f.expect" @change="setExpect(f, ($event.target as HTMLSelectElement).value)">
              <option value="">—</option>
              <option value="ok">принять</option>
              <option value="bad">отклонить</option>
            </select>
          </td>
          <td class="tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left"><input class="note tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-full tw:min-w-140" :value="f.note ?? ''" placeholder="что в файле, чего ждём" spellcheck="false" @change="setNote(f, ($event.target as HTMLInputElement).value)" /></td>
          <td class="acts tw:py-3 tw:px-6 tw:border-b tw:border-b-border tw:text-left tw:w-60 tw:whitespace-nowrap">
            <button class="ib tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Показать в папке" @click="reveal(f)"><Icon name="folderOpen" :size="13" /></button>
            <button class="ib tw:inline-grid tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Удалить из набора" @click="remove(f)"><Icon name="trash" :size="13" /></button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
