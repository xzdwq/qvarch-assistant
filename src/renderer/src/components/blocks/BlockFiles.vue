<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { RECORDED_SET, type TestFile, type TestFileSet } from '@shared/testFiles'
import { DEFECTS, emptySpec, guessColumn, type CellType, type XSpec } from '@shared/excelGen'
import Icon from '../Icon.vue'
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
    err.value = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    return undefined
  }
}
const pick = () => act(() => window.qa.files('pick', set.value))
const remove = (f: TestFile) => act(() => window.qa.files('remove', set.value, f.name))
const setExpect = (f: TestFile, v: string) => act(async () => window.qa.files('meta', set.value, f.name, { expect: v === 'ok' || v === 'bad' ? v : null }))
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
  <div class="tf" :class="{ over }" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
    <div class="tf-head">
      <Icon name="folder" :size="14" /><b>Тестовые файлы</b>
      <select :value="set" title="Набор файлов" @change="write(($event.target as HTMLSelectElement).value)">
        <option v-if="!sets.some((s) => s.name === set)" :value="set">{{ set }} · 0</option>
        <option v-for="s in sets" :key="s.name" :value="s.name">{{ s.name }} · {{ s.count }}</option>
      </select>
      <template v-if="newSet !== undefined">
        <input v-model="newSet" class="nm" placeholder="Название набора" spellcheck="false" @keydown.enter.prevent="createSet" @keydown.esc.prevent="newSet = undefined" />
        <button class="primary sm" @click="createSet">Создать</button>
      </template>
      <button v-else class="lnk" title="Новый набор файлов (например, «Импорт: ошибки»)" @click="newSet = ''"><Icon name="folderPlus" :size="12" />новый набор</button>
      <span class="grow"></span>
      <span class="muted cnt">{{ files.length }} {{ files.length === 1 ? 'файл' : 'файлов' }}<template v-if="counts.ok || counts.bad"> · принять {{ counts.ok }} · отклонить {{ counts.bad }}</template></span>
      <button class="sm" :class="{ on: genOpen }" title="Сделать Excel / CSV: корректный файл и файлы с типовыми ошибками" @click="genOpen = !genOpen"><Icon name="table" :size="12" />Сгенерировать</button>
      <button class="primary sm" title="Выбрать файлы на диске — они скопируются в набор" @click="pick"><Icon name="plus" :size="12" />Добавить файлы</button>
      <button v-if="set !== RECORDED_SET" class="ib" :class="{ warn: sure }" :title="sure ? 'Нажмите ещё раз — набор и его файлы будут удалены' : 'Удалить набор'" @click="removeSet"><Icon name="trash" :size="13" /></button>
    </div>
    <p v-if="err" class="er">{{ err }}</p>

    <!-- the generator: columns, rows, faults → files into this set -->
    <div v-if="genOpen" class="gen">
      <div class="gen-row">
        <label>Имя файлов <input v-model="spec.name" class="nm" spellcheck="false" /></label>
        <label>Строк <input v-model.number="spec.rows" class="n" type="number" min="1" max="100000" /></label>
        <label>Формат
          <select v-model="spec.format"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (;)</option></select>
        </label>
        <label v-if="spec.format === 'xlsx'">Лист <input v-model="spec.sheet" class="sh" spellcheck="false" /></label>
        <span class="grow"></span>
        <button class="sm" title="Взять колонки из своего файла (шаблона импорта): заголовки и значения первых строк — по ним подберутся генераторы" @click="fromTemplate"><Icon name="upload" :size="12" />Из шаблона…</button>
      </div>
      <table class="gen-t">
        <thead>
          <tr>
            <th>Колонка</th>
            <th>Значения</th>
            <th title="Тип ячейки Excel: авто — по генератору">Тип</th>
            <th title="Обязательная: для неё будет файл с пустой ячейкой">Обяз.</th>
            <th title="Уникальная: значения не повторяются, будет файл с повтором">Уник.</th>
            <th title="Максимум символов: будет файл со значением на 1 длиннее">Макс.</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in spec.columns" :key="i">
            <td><input v-model="c.title" class="ct" spellcheck="false" /></td>
            <td><GenPicker :expr="c.expr" compact @update="(e) => (c.expr = e)" /></td>
            <td>
              <select v-model="c.type"><option v-for="t in TYPES" :key="t[0]" :value="t[0]">{{ t[1] }}</option></select>
            </td>
            <td class="ck"><input v-model="c.required" type="checkbox" /></td>
            <td class="ck"><input v-model="c.unique" type="checkbox" /></td>
            <td><input :value="c.maxLen ?? ''" class="n" type="number" min="1" placeholder="—" @change="c.maxLen = Number(($event.target as HTMLInputElement).value) || undefined" /></td>
            <td><button class="ib" title="Убрать колонку" @click="spec.columns.splice(i, 1)"><Icon name="x" :size="12" /></button></td>
          </tr>
        </tbody>
      </table>
      <button class="lnk" @click="addCol"><Icon name="plus" :size="12" />колонка</button>
      <div class="gen-def">
        <span class="muted">Файлы с ошибками:</span>
        <label v-for="d in DEFECTS.filter((x) => !x.xlsxOnly || spec.format === 'xlsx')" :key="d.id" :title="`${d.hint}${d.expect ? ` — ожидание: ${d.expect === 'ok' ? 'принять' : 'отклонить'}` : ' — ожидание не задано: зависит от системы'}`">
          <input v-model="defects" type="checkbox" :value="d.id" />{{ d.label }}
        </label>
      </div>
      <div class="gen-row">
        <button class="primary sm" :disabled="generating || !spec.columns.length" @click="generate"><Icon name="play" :size="11" />{{ generating ? 'Создаю…' : 'Создать файлы' }}</button>
        <span class="muted">корректный + по файлу на каждую ошибку (и на каждую колонку, где ошибка про колонку); файлы с тем же именем пересоздаются</span>
      </div>
      <p v-if="made" class="ok-msg"><Icon name="check" :size="12" />{{ made }}</p>
    </div>

    <div v-if="!files.length" class="tf-empty">
      <Icon name="upload" :size="22" />
      <p>Перетащите файлы сюда или «Добавить файлы». Файлы, выбранные во время записи сценария, попадают в набор «{{ RECORDED_SET }}».</p>
      <p class="muted">Сценарий с загрузкой файла прогоняется по всему набору: «Проверить ▾ → Прогнать с разными файлами».</p>
    </div>
    <table v-else class="tf-t">
      <thead><tr><th>Файл</th><th>Размер</th><th title="Что должно случиться с файлом: страница примет его или откажет (с сообщением)">Ожидание</th><th>Заметка</th><th></th></tr></thead>
      <tbody>
        <tr v-for="f in files" :key="f.name">
          <td class="nmc">
            <input v-if="renaming === f.name" class="nm" :value="f.name" spellcheck="false" @keydown.enter.prevent="rename(f, ($event.target as HTMLInputElement).value)" @keydown.esc.prevent="renaming = undefined" @blur="rename(f, ($event.target as HTMLInputElement).value)" />
            <a v-else href="#" title="Открыть (двойной клик — переименовать)" @click.prevent="open(f)" @dblclick.prevent="renaming = f.name">{{ f.name }}</a>
          </td>
          <td class="sz">{{ size(f.size) }}</td>
          <td>
            <select :value="f.expect ?? ''" :class="f.expect" @change="setExpect(f, ($event.target as HTMLSelectElement).value)">
              <option value="">—</option>
              <option value="ok">принять</option>
              <option value="bad">отклонить</option>
            </select>
          </td>
          <td><input class="note" :value="f.note ?? ''" placeholder="что в файле, чего ждём" spellcheck="false" @change="setNote(f, ($event.target as HTMLInputElement).value)" /></td>
          <td class="acts">
            <button class="ib" title="Показать в папке" @click="reveal(f)"><Icon name="folderOpen" :size="13" /></button>
            <button class="ib" title="Удалить из набора" @click="remove(f)"><Icon name="trash" :size="13" /></button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tf {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  font-size: 12.5px;
}
.tf.over {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.08);
}
.tf-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.cnt {
  white-space: nowrap;
}
select,
input {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.nm {
  width: 200px;
}
.primary.sm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
}
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  white-space: nowrap;
}
.ib {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-2);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
.ib.warn {
  background: rgb(239 68 68 / 0.18);
  color: var(--down-fg);
}
.er {
  margin: 0;
  color: var(--down-fg);
}
button.sm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  white-space: nowrap;
}
button.sm.on {
  border-color: var(--accent);
}
.gen {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
}
.gen-row,
.gen-def {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
}
.gen-row label,
.gen-def label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-2);
  white-space: nowrap;
}
.gen .n {
  width: 76px;
}
.gen .sh {
  width: 110px;
}
.gen-t {
  width: 100%;
  border-collapse: collapse;
}
.gen-t th,
.gen-t td {
  padding: 3px 5px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}
.gen-t th {
  color: var(--text-2);
  font-weight: 600;
  font-size: 11.5px;
  white-space: nowrap;
}
.gen-t .ct {
  width: 150px;
}
.gen-t .ck {
  text-align: center;
}
.ok-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--up-fg);
}
.tf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px;
  border: 1px dashed var(--border-2);
  border-radius: 6px;
  color: var(--text-2);
  text-align: center;
}
.tf-empty p {
  margin: 0;
}
.tf-t {
  width: 100%;
  border-collapse: collapse;
}
.tf-t th,
.tf-t td {
  padding: 3px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.tf-t th {
  color: var(--text-2);
  font-weight: 600;
  font-size: 11.5px;
  white-space: nowrap;
}
.nmc a {
  color: var(--text);
  overflow-wrap: anywhere;
}
.sz {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
  white-space: nowrap;
}
select.ok {
  color: var(--up-fg);
}
select.bad {
  color: var(--warn-fg);
}
.note {
  width: 100%;
  min-width: 140px;
}
.acts {
  width: 60px;
  white-space: nowrap;
}
</style>
