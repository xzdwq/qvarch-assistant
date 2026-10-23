<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { exprToGen, genLabel, genToExpr, GEN_KINDS, sampleOf, unquote } from '@shared/gen'
import { readMatrix, writeMatrix, type MxField } from '@shared/qaChecks'
import { casesFor, kindOf, type FieldKind } from '@shared/qaMatrix'
import Icon from '../Icon.vue'

/**
 * «Значения матрицы»: each field of the matrix with the values it is tried with — one's own only (a field with none
 * is not tried): a typical set added as rows to edit (text, number, date…), or a generator picked (a string of a length, a uuid, an e-mail, a number, a date, a JSON object…) with
 * its parameters, or a value / an expression; each one meant to be taken or refused. Written into the scenario's code.
 */
const props = defineProps<{ code: string }>()
const emit = defineEmits<{ update: [code: string] }>()

interface Row {
  label: string
  gid: string
  args: string[]
  bad: boolean
}
interface F {
  f: MxField
  rows: Row[]
}
const toRows = (f: MxField): Row[] => f.cases.map((c) => ({ label: c.label, ...(({ id, args }) => ({ gid: id, args }))(exprToGen(c.expr)), bad: c.bad }))
const fields = ref<F[]>([])
let mine = ''
watch(
  () => props.code,
  (c) => {
    // (our own write coming back — the rows as they are, the cursor stays)
    if (c === mine) return
    fields.value = (readMatrix(c)?.fields ?? []).map((f) => ({ f, rows: toRows(f) }))
  },
  { immediate: true },
)
function save(): void {
  const list: MxField[] = fields.value.map(({ f, rows }) => ({ ...f, cases: rows.map((r) => ({ label: r.label.trim() || genLabel(r.gid, r.args), expr: genToExpr(r.gid, r.args), bad: r.bad })) }))
  mine = writeMatrix(props.code, list)
  emit('update', mine)
}

const open = ref<string>()
watch(
  () => fields.value.length,
  () => (open.value ??= fields.value[0]?.f.id),
  { immediate: true },
)
const recorded = (f: MxField) => unquote(f.value) ?? f.value
const KIND_RU: Record<FieldKind, string> = { text: 'текст', number: 'число', date: 'дата', email: 'e-mail', phone: 'телефон' }
/** The typical sets, the field's likely kind first (by its name and the value recorded). */
const setsFor = (f: MxField) => {
  const guess = kindOf({}, recorded(f), f.name)
  return [guess, ...(Object.keys(KIND_RU) as FieldKind[]).filter((k) => k !== guess)]
}
const setTitle = (f: MxField, k: FieldKind) =>
  casesFor(k, {}, recorded(f))
    .map((c) => `${c.label}${c.bad ? ' — отклонить' : ''}`)
    .join('\n')
/** A typical set's values added as rows of one's own (those already there — not twice). */
function addSet(x: F, kind: FieldKind): void {
  const have = new Set(x.rows.map((r) => genToExpr(r.gid, r.args)))
  for (const c of casesFor(kind, {}, recorded(x.f))) {
    const expr = c.expr ?? (c.value === '' ? "''" : genToExpr('value', [c.value]))
    if (have.has(expr)) continue
    const g = exprToGen(expr)
    x.rows.push({ label: c.label, gid: g.id, args: g.args, bad: c.bad })
  }
  save()
}

const argsDef = (gid: string) => GEN_KINDS.find((g) => g.id === gid)!.params.map((p) => p.def)
function add(x: F, gid: string): void {
  const args = argsDef(gid)
  x.rows.push({ label: genLabel(gid, args), gid, args, bad: false })
  save()
}
function setGen(r: Row, gid: string): void {
  const auto = !r.label.trim() || r.label === genLabel(r.gid, r.args)
  // a value written by hand goes on as an expression (and back)
  const args = gid === 'code' ? [genToExpr(r.gid, r.args)] : r.gid === 'code' ? argsDef(gid) : gid === r.gid ? r.args : argsDef(gid)
  r.gid = gid
  r.args = args
  if (auto) r.label = genLabel(gid, args)
  save()
}
function setArg(r: Row, i: number, v: string): void {
  const auto = !r.label.trim() || r.label === genLabel(r.gid, r.args)
  r.args = r.args.map((a, j) => (j === i ? v : a))
  if (auto) r.label = genLabel(r.gid, r.args)
  save()
}
const kindOfGen = (gid: string) => GEN_KINDS.find((g) => g.id === gid)!
// the example of each row (made again on a click)
const tick = ref(0)
const sample = (r: Row) => {
  void tick.value
  const s = sampleOf(genToExpr(r.gid, r.args))
  if (s === undefined) return 'вычисляется при запуске'
  if (s === '') return '(пусто)'
  return s.length > 48 ? `${s.slice(0, 40)}… (${s.length} симв.)` : `${s}${s.trim() !== s || s.length > 12 ? ` (${s.length} симв.)` : ''}`
}
const QUICK = ['empty', 'text', 'uuid', 'email', 'int', 'date', 'json', 'value']
const totalOwn = computed(() => fields.value.reduce((n, x) => n + x.rows.length, 0))
</script>

<template>
  <div class="mx">
    <div class="mx-head">
      <b>Значения матрицы</b>
      <span class="muted">полей {{ fields.length }} · своих значений {{ totalOwn }}</span>
      <span class="grow"></span>
      <button class="lnk" title="Сделать новые примеры значений" @click="tick++"><Icon name="refresh" :size="12" />примеры</button>
    </div>
    <p v-if="!fields.length" class="muted">В сценарии нет матрицы — выберите «Проверить ▾ → Матрица значений полей».</p>
    <div v-for="x in fields" :key="x.f.id" class="mx-f" :class="{ open: open === x.f.id }">
      <div class="mx-fh" @click="open = open === x.f.id ? undefined : x.f.id">
        <Icon :name="open === x.f.id ? 'chevronDown' : 'chevronRight'" :size="12" />
        <b>{{ x.f.name }}</b>
        <span class="muted rec">записано «{{ recorded(x.f) }}»</span>
        <span class="grow"></span>
        <span class="cnt">{{ x.rows.length ? `значений ${x.rows.length}` : 'не проверяется' }}</span>
      </div>
      <div v-if="open === x.f.id" class="mx-body">
        <p v-if="!x.rows.length" class="mx-note muted">Значений нет — поле не перебирается. Добавьте свои или типовой набор ниже.</p>

        <div v-for="(r, i) in x.rows" :key="i" class="mx-row">
          <input v-model="r.label" class="lbl" placeholder="Подпись" spellcheck="false" @change="save" />
          <select :value="r.gid" title="Чем сделать значение" @change="setGen(r, ($event.target as HTMLSelectElement).value)">
            <option v-for="g in GEN_KINDS" :key="g.id" :value="g.id">{{ g.title }}</option>
          </select>
          <template v-for="(p, j) in kindOfGen(r.gid).params" :key="j">
            <select v-if="p.kind === 'choice'" :value="r.args[j]" :title="p.name" @change="setArg(r, j, ($event.target as HTMLSelectElement).value)">
              <option v-for="c in p.choices" :key="c[0]" :value="c[0]">{{ c[1] }}</option>
            </select>
            <input v-else-if="p.kind === 'num'" class="num" type="number" :value="r.args[j]" :title="p.name" :placeholder="p.name" @change="setArg(r, j, ($event.target as HTMLInputElement).value)" />
            <textarea v-else-if="p.kind === 'json'" class="json" :value="r.args[j]" :title="p.name" spellcheck="false" rows="2" @change="setArg(r, j, ($event.target as HTMLTextAreaElement).value)"></textarea>
            <input v-else class="txt" :class="{ code: r.gid === 'code' }" :value="r.args[j]" :title="p.name" :placeholder="p.name" spellcheck="false" @change="setArg(r, j, ($event.target as HTMLInputElement).value)" />
          </template>
          <select class="exp" :class="{ bad: r.bad }" :value="r.bad ? 'bad' : 'ok'" title="Что должно быть: форма примет значение или откажет. Принятое «должно отклоняться» отмечается в результате" @change="((r.bad = ($event.target as HTMLSelectElement).value === 'bad'), save())">
            <option value="ok">принять</option>
            <option value="bad">отклонить</option>
          </select>
          <button class="ib" title="Убрать" @click="(x.rows.splice(i, 1), save())"><Icon name="x" :size="12" /></button>
          <span class="smp" :title="'Пример значения (каждый прогон — новое)'">{{ sample(r) }}</span>
        </div>

        <div class="mx-add">
          <span class="muted">Добавить:</span>
          <button v-for="g in QUICK" :key="g" @click="add(x, g)">{{ GEN_KINDS.find((k) => k.id === g)!.title }}</button>
          <select title="Другое" value="" @change="(add(x, ($event.target as HTMLSelectElement).value), (($event.target as HTMLSelectElement).value = ''))">
            <option value="" disabled>ещё…</option>
            <option v-for="g in GEN_KINDS.filter((k) => !QUICK.includes(k.id))" :key="g.id" :value="g.id">{{ g.title }}</option>
          </select>
          <select title="Типовой набор значений — добавится строками, их можно править и убирать" value="" @change="(addSet(x, ($event.target as HTMLSelectElement).value as FieldKind), (($event.target as HTMLSelectElement).value = ''))">
            <option value="" disabled>типовой набор…</option>
            <option v-for="k in setsFor(x.f)" :key="k" :value="k" :title="setTitle(x.f, k)">{{ KIND_RU[k] }} ({{ casesFor(k, {}, recorded(x.f)).length }})</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mx {
  display: flex;
  flex-basis: 100%;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  font-size: 12.5px;
}
.mx-head,
.mx-fh,
.mx-add {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.grow {
  flex: 1;
}
.muted {
  color: var(--muted);
}
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
}
.mx-f {
  border-top: 1px solid var(--border);
}
.mx-fh {
  height: 30px;
  cursor: pointer;
}
.mx-fh .rec {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cnt {
  flex: none;
  color: var(--text-2);
  font-size: 11.5px;
}
.mx-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 0 10px 20px;
}
.mx-note {
  margin: 0 0 2px;
  font-size: 11.5px;
}
.mx-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.mx-row input,
.mx-row select,
.mx-row textarea,
.mx-add select {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
}
.mx-row textarea {
  height: auto;
  min-height: 26px;
  padding: 3px 6px;
  font-family: var(--font-data);
  font-size: 12px;
  resize: vertical;
}
.lbl {
  width: 170px;
}
.num {
  width: 72px;
}
.txt {
  width: 150px;
}
.txt.code,
.json {
  flex: 1 1 260px;
  font-family: var(--font-data);
  font-size: 12px;
}
.exp.bad {
  color: var(--warn-fg);
}
.ib {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
.smp {
  flex: 1 1 100%;
  margin: -2px 0 2px;
  padding-left: 2px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-add {
  flex-wrap: wrap;
  white-space: normal;
}
.mx-add button {
  height: 24px;
  padding: 0 8px;
  border: 1px dashed var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  white-space: nowrap;
}
.mx-add button:hover {
  border-color: var(--accent);
  color: var(--text);
}
</style>
