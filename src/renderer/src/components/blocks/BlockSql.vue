<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Extension } from '@codemirror/state'
import { formatCode } from '@shared/codeformat'
import { sqlTitle, withTitle, type DbSchema, type SqlTemplate } from '@shared/sql'
import type { PlanNode } from '@shared/sqlPlan'
import { blockReport, envAt, fenceParts, fenceSrc, noteRun, runKey, runSql, stopBlock } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import { useFold } from '../../lib/foldState'
import { connWhere, dbConns, kindTitle, loadConns } from '../../lib/sqlDb'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'
import RunHead from './RunHead.vue'
import DbConnections from './DbConnections.vue'
import SqlLibrary from './SqlLibrary.vue'
import MenuButton, { type MenuItem } from '../MenuButton.vue'
import DataGrid from '../DataGrid.vue'
import { useGrid } from '../../lib/grid'

/**
 * «@бд»: a query to a database (```sql db=<connection> name=<rows>): run read-only, one connection for it alone; its
 * rows shown and published under its name ({{rows[0].id}} in the next blocks); its plan — without running it, or run
 * and measured — as a tree with what is slow in it said. A title of its own (its first comment line) — what the
 * notebook's library shows.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parts = computed(() => fenceParts(props.src))
const body = ref(parts.value.body)
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    body.value = fenceParts(s).body
  },
)
let timer: ReturnType<typeof setTimeout> | undefined
function write(info = fenceParts(mine).info, now = false): void {
  clearTimeout(timer)
  const go = () => {
    const p = fenceParts(mine)
    const src = fenceSrc(p.fence, info, body.value)
    if (src === mine) return
    mine = src
    props.onChange?.(src)
  }
  if (now) go()
  else timer = setTimeout(go, 300)
}
watch(body, () => write())
function rename(name: string | undefined): void {
  write({ ...fenceParts(mine).info, name }, true)
}
function setDb(db: string): void {
  write({ ...fenceParts(mine).info, db }, true)
}
void loadConns()
const conn = computed(() => dbConns.value.find((c) => c.name === parts.value.info.db))
const title = computed(() => sqlTitle(body.value) ?? '')
function setTitle(t: string): void {
  body.value = withTitle(body.value, t)
  write(undefined, true)
}
/** A query of the library: its text and connection taken (this block's name kept). */
function take(t: SqlTemplate): void {
  body.value = t.sql
  write({ ...fenceParts(mine).info, db: t.db }, true)
}

// ---------- completion: the connection's schemas, tables, columns (their types beside) ----------
const schema = shallowRef<DbSchema>()
const schemaErr = ref('')
const schemaBusy = ref(false)
async function loadSchema(fresh = false): Promise<void> {
  const db = parts.value.info.db
  schemaErr.value = ''
  if (!db || !conn.value) return void (schema.value = undefined)
  schemaBusy.value = true
  const r = await window.qa.sql('schema', db, fresh)
  schemaBusy.value = false
  if (db !== parts.value.info.db) return
  if ('error' in r) {
    schema.value = undefined
    schemaErr.value = r.error
  } else schema.value = r
}
watch(() => [parts.value.info.db, conn.value?.id] as const, () => void loadSchema(), { immediate: true })
const DIALECT = { pg: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' } as const
const langExt = shallowRef<Extension>()
watch(
  [schema, () => conn.value?.kind],
  async ([sc, kind]) => {
    const m = await import('@codemirror/lang-sql')
    const col = (c: { name: string; type?: string }) => ({ label: c.name, type: 'property', detail: c.type })
    const tbl = (t: DbSchema['tables'][number]) => ({ self: { label: t.name, type: 'type', detail: `таблица · ${t.columns.length}` }, children: t.columns.map(col) })
    // { schema: { table: columns } } — the default schema's tables offered without it too
    const ns: Record<string, unknown> = {}
    for (const t of sc?.tables ?? []) {
      if (t.schema) ((ns[t.schema] ??= {}) as Record<string, unknown>)[t.name] = tbl(t)
      else ns[t.name] = tbl(t)
    }
    langExt.value = m.sql({ dialect: m[DIALECT[kind ?? 'pg']], upperCaseKeywords: true, schema: ns as never, ...(sc?.defaultSchema && sc.tables.some((t) => t.schema) ? { defaultSchema: sc.defaultSchema } : {}) })
  },
  { immediate: true },
)
const tableCount = computed(() => schema.value?.tables.length ?? 0)

// ---------- formatting ----------
const fmtErr = ref('')
async function format(): Promise<void> {
  fmtErr.value = ''
  try {
    const kind = conn.value?.kind ?? 'pg'
    body.value = await formatCode('sql', body.value, { sqlDialect: kind === 'pg' ? 'postgresql' : kind === 'mysql' ? 'mysql' : 'sqlite' })
    write(undefined, true)
  } catch (e) {
    fmtErr.value = `Не отформатировать: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`
  }
}

const key = computed(() => runKey(parts.value.info.name, 'sql', props.line))
const run = computed(() => noteRun(props.path).runs[key.value])
async function go(mode: 'run' | 'plan' | 'analyze' = 'run'): Promise<void> {
  write(undefined, true)
  await runSql(props.path, key.value, parts.value.info.name, parts.value.info.db ?? '', body.value, mode, envAt(props.path, props.line, doc(props.path).text))
}
const conns = ref(false)
watch(
  () => [dbConns.value.length, parts.value.info.db] as const,
  ([n, db]) => {
    // nothing to go by yet: the connections at hand
    if (n === 0 || (db && !conn.value)) conns.value = true
  },
)

// ---------- the rows ----------
// (folded or open — as it was left, back from another tab too)
const open = useFold(() => `${props.path}#${key.value}#result`, true)
const table = computed(() => run.value?.table)
const grid = useGrid(table, () => title.value || parts.value.info.name || 'Результат')
const { selCount, copied, exportItems } = grid
const dur = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)

// ---------- the plan ----------
const plan = computed(() => run.value?.plan)
const rawOpen = ref(false)
/** The tree flat, each step with its depth (shown as an indented list; a step's bar — its own share of the time). */
const flat = computed(() => {
  const out: Array<{ n: PlanNode; depth: number }> = []
  const walk = (n: PlanNode, depth: number) => {
    out.push({ n, depth })
    n.children.forEach((c) => walk(c, depth + 1))
  }
  if (plan.value) walk(plan.value.root, 0)
  return out
})
const totalMs = computed(() => plan.value?.executionMs ?? plan.value?.root.act?.ms ?? 0)
const num = (n?: number) => (n === undefined ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} млн` : n >= 1e4 ? `${Math.round(n / 1000)} тыс.` : String(Math.round(n)))
const off = (n: PlanNode) => {
  if (!n.act?.loops || n.est?.rows === undefined || n.act.rows === undefined) return false
  const real = n.act.rows / n.act.loops
  const r = Math.max(real, 1) / Math.max(n.est.rows, 1)
  return (r >= 10 || r <= 0.1) && Math.max(real, n.est.rows) >= 1000
}
const pub = computed(() => parts.value.info.name)
const planItems = computed<MenuItem[]>(() => [
  { label: 'План без выполнения', icon: 'list', title: 'Что собирается делать сервер — мгновенно, запрос не выполняется', run: () => go('plan') },
  { label: 'План с выполнением', icon: 'zap', title: 'Запрос выполняется (только чтение, с откатом) и замеряется: время и строки каждого шага', run: () => go('analyze') },
])
</script>

<template>
  <div class="bs" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="() => blockReport(path, key, 'sql', parts.info, parts.body)" icon="database" kind="SQL" :name="parts.info.name" :run="run" name-placeholder="строки" @rename="rename" @run="go()" @stop="stopBlock(path, key, envAt(path, line, doc(path).text).id)" />
    <div class="bs-bar">
      <select class="db" :value="parts.info.db ?? ''" :title="conn ? `${kindTitle(conn.kind)} · ${connWhere(conn)}` : 'Через какое подключение'" @change="setDb(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>подключение…</option>
        <option v-if="parts.info.db && !conn" :value="parts.info.db">{{ parts.info.db }} — нет такого</option>
        <option v-for="c in dbConns" :key="c.id" :value="c.name">{{ c.name }} · {{ kindTitle(c.kind) }} · {{ connWhere(c) }}{{ c.prod ? ' · прод' : '' }}</option>
      </select>
      <button class="ib" :class="{ on: conns }" title="Подключения: добавить, изменить, проверить" @mousedown.prevent @click="conns = !conns"><Icon name="settings" :size="14" /></button>
      <SqlLibrary :self="{ path, line }" @pick="take" />
      <input class="title" :value="title" placeholder="Название запроса (для библиотеки)" spellcheck="false" title="Первая строка-комментарий запроса: так он называется в библиотеке" @change="setTitle(($event.target as HTMLInputElement).value)" />
    </div>
    <DbConnections v-if="conns" :current="parts.info.db" @pick="(n) => (setDb(n), (conns = false))" />
    <div class="bs-ed"><CodeArea v-model="body" lang="sql" :lang-ext="langExt" :run="() => go()" :min-height="60" placeholder="select … from … where id = {{ значение.из.заметки }}" /></div>
    <div class="bs-acts">
      <MenuButton label="План" icon="list" :disabled="run?.state === 'run'" title="План запроса: что делает сервер и где узкие места" :width="300" :items="planItems" />
      <button class="pill" title="Отформатировать запрос (ключевые слова, отступы) — по правилам СУБД подключения" @click="format"><Icon name="code" :size="12" />Форматировать</button>
      <button v-if="conn" class="pill" :disabled="schemaBusy" :title="schemaErr ? `Схема не прочитана: ${schemaErr}` : 'Подсказки при наборе: схемы, таблицы, колонки (с типами). Прочитать схему заново'" @click="loadSchema(true)"><Icon name="refresh" :size="12" />{{ schemaBusy ? 'схема…' : schemaErr ? 'схема: ошибка' : `схема · ${tableCount}` }}</button>
      <span class="muted hint" :title="pub ? `Строки результата — в переменной {{${pub}}}: {{${pub}[0].поле}}` : ''">Ctrl+Enter — выполнить</span>
    </div>
    <p v-if="fmtErr" class="bs-miss">{{ fmtErr }}</p>
    <p v-if="run?.sql?.missing.length" class="bs-miss">Нет значения: <code v-for="m in run.sql.missing" :key="m">{{ '{' }}{{ '{' }}{{ m }}{{ '}' }}{{ '}' }}</code> — выполните блок, который его даёт</p>

    <div v-if="run && run.state !== 'run' && (table || plan || run.error)" class="bs-res">
      <div class="bs-rh">
        <button class="fold" :title="open ? 'Свернуть' : 'Показать'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <template v-if="table">
          <b>строк {{ table.rows.length }}{{ table.more ? '+' : '' }}</b>
          <span class="muted">{{ dur(table.ms) }} · {{ run.server }}</span>
          <span v-if="table.more" class="warn">прочитано не больше {{ table.rows.length }} — остальные не забирались</span>
          <span class="grow"></span>
          <span v-if="copied" class="muted">скопировано</span>
          <span v-else-if="selCount > 1" class="muted" title="Ctrl+C — копировать (в Excel — по столбцам)">выделено {{ selCount }}</span>
          <MenuButton icon="download" title="Строки результата: скопировать или сохранить в Excel / CSV" :width="240" :items="exportItems" />
        </template>
        <template v-else-if="plan">
          <b>{{ plan.analyzed ? 'План с выполнением' : 'План (без выполнения)' }}</b>
          <span class="muted">{{ plan.executionMs !== undefined ? `выполнение ${dur(plan.executionMs)}` : '' }}{{ plan.planningMs !== undefined ? ` · планирование ${dur(plan.planningMs)}` : '' }} · {{ run.server }}</span>
          <span class="grow"></span>
          <button class="pill" :class="{ on: rawOpen }" title="План так, как его отдал сервер" @click="rawOpen = !rawOpen">как есть</button>
        </template>
        <b v-else class="err">Ошибка</b>
      </div>
      <template v-if="open">
        <p v-if="run.error" class="bs-err">{{ run.error }}</p>
        <DataGrid v-if="table" :grid="grid" />
        <div v-if="plan" class="bs-plan">
          <ul v-if="plan.findings.length" class="finds">
            <li v-for="(f, i) in plan.findings" :key="i" :class="f.level"><Icon :name="f.level === 'warn' ? 'zap' : 'list'" :size="12" />{{ f.text }}</li>
          </ul>
          <p v-else class="muted">Явных узких мест не видно.</p>
          <div class="tree">
            <div v-for="(x, i) in flat" :key="i" class="pn" :style="{ paddingLeft: `${x.depth * 16 + 4}px` }">
              <div class="pn-h">
                <span class="op">{{ x.n.op }}</span>
                <span v-if="x.n.on" class="on">{{ x.n.on }}</span>
                <span v-for="f in x.n.flags" :key="f" class="flag">{{ f }}</span>
                <span class="grow"></span>
                <span class="nums" :class="{ off: off(x.n) }" :title="off(x.n) ? 'Оценка строк сильно расходится с реальностью' : ''">
                  <template v-if="x.n.act">строк {{ num(x.n.act.rows) }}<template v-if="x.n.est?.rows !== undefined"> (ожид. {{ num((x.n.est.rows ?? 0) * (x.n.act.loops ?? 1)) }})</template><template v-if="(x.n.act.loops ?? 1) > 1"> · ×{{ num(x.n.act.loops) }}</template></template>
                  <template v-else-if="x.n.est?.rows !== undefined">ожид. строк {{ num(x.n.est.rows) }}</template>
                </span>
                <span v-if="x.n.selfMs !== undefined" class="ms">{{ dur(x.n.selfMs) }}</span>
              </div>
              <div v-if="x.n.selfMs !== undefined && totalMs" class="bar"><i :style="{ width: `${Math.min(100, (x.n.selfMs / totalMs) * 100)}%` }"></i></div>
              <div v-for="(d, j) in x.n.detail" :key="j" class="pn-d">{{ d }}</div>
            </div>
          </div>
          <pre v-if="rawOpen" class="raw">{{ run.planRaw }}</pre>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* a component's card, as the other runnable blocks' (its colour — its own) */
.bs {
  /* as wide as the note — a wide result scrolls inside, never widens it */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #f59e0b;
  border-radius: 8px;
  background: var(--panel);
}
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
}
.ib:hover,
.ib.on {
  border-color: var(--border-2);
  background: var(--hover);
  color: var(--text);
}
.bs-bar,
.bs-acts,
.bs-rh,
.pn-h {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.bs-bar {
  flex-wrap: wrap;
}
.db,
.title {
  height: 26px;
  min-width: 0;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
}
.db {
  max-width: 360px;
}
.title {
  flex: 1 1 200px;
}
.pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.pill.on,
.pill:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text);
}
.pill:disabled {
  opacity: 0.5;
}
.muted {
  color: var(--muted);
}
.grow {
  flex: 1;
}
.hint {
  overflow: hidden;
  font-size: 11.5px;
  text-overflow: ellipsis;
}
.bs-miss,
.bs-err {
  margin: 0;
  color: var(--down-fg);
  font-size: 12.5px;
  white-space: pre-wrap;
}
.bs-res {
  border: 1px solid var(--border-2);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}
.bs-rh {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2, transparent);
  font-size: 12.5px;
}
.bs-rh .muted {
  overflow: hidden;
  text-overflow: ellipsis;
}
.warn {
  color: var(--warn-fg);
  font-size: 12px;
}
.err {
  color: var(--down-fg);
}
.fold {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
}
.bs-err {
  padding: 6px 10px;
}
/* the rows scroll inside (both ways): a wide result never widens the note — the box's width is its parent's */
.bs-res {
  min-width: 0;
  max-width: 100%;
  contain: inline-size;
}
.bs-plan {
  padding: 6px 8px 8px;
}
.finds {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}
.finds li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  font-size: 12.5px;
}
.finds li.warn {
  color: var(--warn-fg);
}
.tree {
  font-family: var(--font-data);
  font-size: 12px;
}
.pn {
  padding: 3px 4px;
  border-top: 1px solid var(--border);
}
.op {
  font-weight: 600;
}
.on {
  overflow: hidden;
  color: var(--accent);
  text-overflow: ellipsis;
}
.flag {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warn-fg) 16%, transparent);
  color: var(--warn-fg);
  font-family: inherit;
  font-size: 11px;
}
.nums {
  color: var(--text-2);
}
.nums.off {
  color: var(--warn-fg);
}
.ms {
  flex: none;
  min-width: 56px;
  color: var(--text);
  text-align: right;
}
.bar {
  height: 3px;
  margin: 2px 0;
  background: var(--border);
}
.bar i {
  display: block;
  height: 100%;
  background: var(--accent);
}
.pn-d {
  padding-left: 12px;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.raw {
  max-height: 300px;
  margin: 8px 0 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11.5px;
}
</style>
