<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { exprToGen, genLabel, genToExpr, GEN_KINDS, sampleOf, unquote } from '@shared/gen'
import { readMatrix, writeMatrix, type MxField } from '@shared/qaChecks'
import { casesFor, FIELD_KINDS, kindOf, type FieldKind } from '@shared/qaMatrix'
import Icon from '@renderer/components/Icon.vue'

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
  return [guess, ...FIELD_KINDS.filter((k) => k !== guess)]
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
  <div class="mx tw:flex tw:basis-full tw:box-border tw:min-w-0 tw:max-w-full tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-[12.5px]">
    <div class="mx-head tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <b>Значения матрицы</b>
      <span class="muted tw:text-muted">полей {{ fields.length }} · своих значений {{ totalOwn }}</span>
      <span class="grow tw:flex-1"></span>
      <button class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Сделать новые примеры значений" @click="tick++"><Icon name="refresh" :size="12" />примеры</button>
    </div>
    <p v-if="!fields.length" class="muted tw:text-muted">В сценарии нет матрицы — выберите «Проверить ▾ → Матрица значений полей».</p>
    <div v-for="x in fields" :key="x.f.id" class="mx-f tw:border-t tw:border-t-border" :class="{ open: open === x.f.id }">
      <div class="mx-fh tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:h-30 tw:cursor-pointer" @click="open = open === x.f.id ? undefined : x.f.id">
        <Icon :name="open === x.f.id ? 'chevronDown' : 'chevronRight'" :size="12" />
        <b>{{ x.f.name }}</b>
        <span class="muted rec tw:text-muted tw:overflow-hidden tw:text-ellipsis">записано «{{ recorded(x.f) }}»</span>
        <span class="grow tw:flex-1"></span>
        <span class="cnt tw:flex-none tw:text-text-2 tw:text-[11.5px]">{{ x.rows.length ? `значений ${x.rows.length}` : 'не проверяется' }}</span>
      </div>
      <div v-if="open === x.f.id" class="mx-body tw:flex tw:flex-col tw:gap-6 tw:pt-0 tw:pr-0 tw:pb-10 tw:pl-20">
        <p v-if="!x.rows.length" class="mx-note muted tw:text-muted tw:mt-0 tw:mr-0 tw:mb-2 tw:ml-0 tw:text-[11.5px]">Значений нет — поле не перебирается. Добавьте свои или типовой набор ниже.</p>

        <div v-for="(r, i) in x.rows" :key="i" class="mx-row tw:flex tw:flex-wrap tw:items-center tw:gap-6">
          <input v-model="r.label" class="lbl tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-170" placeholder="Подпись" spellcheck="false" @change="save" />
          <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" :value="r.gid" title="Чем сделать значение" @change="setGen(r, ($event.target as HTMLSelectElement).value)">
            <option v-for="g in GEN_KINDS" :key="g.id" :value="g.id">{{ g.title }}</option>
          </select>
          <template v-for="(p, j) in kindOfGen(r.gid).params" :key="j">
            <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-if="p.kind === 'choice'" :value="r.args[j]" :title="p.name" @change="setArg(r, j, ($event.target as HTMLSelectElement).value)">
              <option v-for="c in p.choices" :key="c[0]" :value="c[0]">{{ c[1] }}</option>
            </select>
            <input v-else-if="p.kind === 'num'" class="num tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:w-72" type="number" :value="r.args[j]" :title="p.name" :placeholder="p.name" @change="setArg(r, j, ($event.target as HTMLInputElement).value)" />
            <textarea v-else-if="p.kind === 'json'" class="json tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:h-auto tw:min-h-26 tw:py-3 tw:px-6 tw:[&&]:font-data tw:[&&]:text-[12px] tw:resize-y tw:flex-[1_1_260px]" :value="r.args[j]" :title="p.name" spellcheck="false" rows="2" @change="setArg(r, j, ($event.target as HTMLTextAreaElement).value)"></textarea>
            <input v-else class="txt tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:w-150 tw:[&.code]:flex-[1_1_260px] tw:[&.code]:font-data tw:[&.code]:text-[12px]" :class="{ code: r.gid === 'code' }" :value="r.args[j]" :title="p.name" :placeholder="p.name" spellcheck="false" @change="setArg(r, j, ($event.target as HTMLInputElement).value)" />
          </template>
          <select class="exp tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit] tw:[&.bad]:text-warn-fg" :class="{ bad: r.bad }" :value="r.bad ? 'bad' : 'ok'" title="Что должно быть: форма примет значение или откажет. Принятое «должно отклоняться» отмечается в результате" @change="((r.bad = ($event.target as HTMLSelectElement).value === 'bad'), save())">
            <option value="ok">принять</option>
            <option value="bad">отклонить</option>
          </select>
          <button class="ib tw:inline-grid tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Убрать" @click="(x.rows.splice(i, 1), save())"><Icon name="x" :size="12" /></button>
          <span class="smp tw:flex-[1_1_100%] tw:-mt-2 tw:mr-0 tw:mb-2 tw:ml-0 tw:pl-2 tw:text-muted tw:font-data tw:text-[11.5px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :title="'Пример значения (каждый прогон — новое)'">{{ sample(r) }}</span>
        </div>

        <div class="mx-add tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:flex-wrap tw:whitespace-normal">
          <span class="muted tw:text-muted">Добавить:</span>
          <button class="tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-dashed tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:whitespace-nowrap tw:hover:border-accent tw:hover:text-text" v-for="g in QUICK" :key="g" @click="add(x, g)">{{ GEN_KINDS.find((k) => k.id === g)!.title }}</button>
          <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" title="Другое" value="" @change="(add(x, ($event.target as HTMLSelectElement).value), (($event.target as HTMLSelectElement).value = ''))">
            <option value="" disabled>ещё…</option>
            <option v-for="g in GEN_KINDS.filter((k) => !QUICK.includes(k.id))" :key="g.id" :value="g.id">{{ g.title }}</option>
          </select>
          <select class="tw:h-26 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" title="Типовой набор значений — добавится строками, их можно править и убирать" value="" @change="(addSet(x, ($event.target as HTMLSelectElement).value as FieldKind), (($event.target as HTMLSelectElement).value = ''))">
            <option value="" disabled>типовой набор…</option>
            <option v-for="k in setsFor(x.f)" :key="k" :value="k" :title="setTitle(x.f, k)">{{ KIND_RU[k] }} ({{ casesFor(k, {}, recorded(x.f)).length }})</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>
