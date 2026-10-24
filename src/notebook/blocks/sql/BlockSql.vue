<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Extension } from '@codemirror/state'
import { formatCode } from '@shared/codeformat'
import { sqlTitle, withTitle, type DbSchema, type SqlTemplate } from '@shared/sql'
import type { PlanNode } from '@shared/sqlPlan'
import { useFold } from '@renderer/lib/foldState'
import { connWhere, dbConns, kindTitle, loadConns } from '@renderer/lib/sqlDb'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import RunHead from '../../ui/RunHead.vue'
import { useBlockRun } from '../../ui/useBlockRun'
import { useFenceSource } from '../../ui/useFenceSource'
import DbConnections from './DbConnections.vue'
import SqlLibrary from './SqlLibrary.vue'
import MenuButton, { type MenuItem } from '@renderer/components/MenuButton.vue'
import DataGrid from '@renderer/components/DataGrid.vue'
import { useGrid } from '@renderer/lib/grid'

/**
 * «@бд»: a query to a database (```sql db=<connection> name=<rows>): run read-only, one connection for it alone; its
 * rows shown and published under its name ({{rows[0].id}} in the next blocks); its plan — without running it, or run
 * and measured — as a tree with what is slow in it said. A title of its own (its first comment line) — what the
 * notebook's library shows.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { parts, body } = fence
const { key, run, start, stop, report } = useBlockRun(props, 'sql', fence)
const rename = (name: string | undefined) => fence.patchInfo({ name })
const setDb = (db: string) => fence.patchInfo({ db })
void loadConns()
const conn = computed(() => dbConns.value.find((c) => c.name === parts.value.info.db))
const title = computed(() => sqlTitle(body.value) ?? '')
function setTitle(t: string): void {
  body.value = withTitle(body.value, t)
  fence.flush()
}
/** A query of the library: its text and connection taken (this block's name kept). */
function take(t: SqlTemplate): void {
  body.value = t.sql
  fence.patchInfo({ db: t.db })
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
/** The formatter's dialect of each database kind. */
const SQL_DIALECT = { pg: 'postgresql', mysql: 'mysql', sqlite: 'sqlite' } as const
const fmtErr = ref('')
async function format(): Promise<void> {
  fmtErr.value = ''
  try {
    const kind = conn.value?.kind ?? 'pg'
    body.value = await formatCode('sql', body.value, { sqlDialect: SQL_DIALECT[kind] })
    fence.flush()
  } catch (e) {
    fmtErr.value = `Не отформатировать: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`
  }
}

/** Runs the query as typed (written into the note first) — or shows its plan. */
async function go(sqlMode: 'run' | 'plan' | 'analyze' = 'run'): Promise<void> {
  fence.flush()
  await start({ sqlMode })
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
  <div class="bs tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-sql) tw:rounded-[8px] tw:bg-panel" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="report" send="sql" icon="database" kind="SQL" :name="parts.info.name" :run="run" name-placeholder="строки" @rename="rename" @run="go()" @stop="stop" />
    <div class="bs-bar tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:flex-wrap">
      <select class="db tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:max-w-360" :value="parts.info.db ?? ''" :title="conn ? `${kindTitle(conn.kind)} · ${connWhere(conn)}` : 'Через какое подключение'" @change="setDb(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>подключение…</option>
        <option v-if="parts.info.db && !conn" :value="parts.info.db">{{ parts.info.db }} — нет такого</option>
        <option v-for="c in dbConns" :key="c.id" :value="c.name">{{ c.name }} · {{ kindTitle(c.kind) }} · {{ connWhere(c) }}{{ c.prod ? ' · прод' : '' }}</option>
      </select>
      <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-26 tw:h-26 tw:p-0 tw:border tw:border-transparent tw:rounded-[6px] tw:bg-transparent tw:text-text-2 tw:hover:not-[&.on]:border-border-2 tw:[&.on]:border-border-2 tw:hover:not-[&.on]:bg-hover tw:[&.on]:bg-hover tw:hover:not-[&.on]:text-text tw:[&.on]:text-text tw:[&.on]:overflow-hidden tw:[&.on]:text-ellipsis" :class="{ on: conns }" title="Подключения: добавить, изменить, проверить" @mousedown.prevent @click="conns = !conns"><Icon name="settings" :size="14" /></button>
      <SqlLibrary :self="{ path, line }" @pick="take" />
      <input class="title tw:h-26 tw:min-w-0 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:flex-[1_1_200px]" :value="title" placeholder="Название запроса (для библиотеки)" spellcheck="false" title="Первая строка-комментарий запроса: так он называется в библиотеке" @change="setTitle(($event.target as HTMLInputElement).value)" />
    </div>
    <DbConnections v-if="conns" :current="parts.info.db" @pick="(n) => (setDb(n), (conns = false))" />
    <div class="bs-ed"><CodeArea v-model="body" lang="sql" :lang-ext="langExt" :run="() => go()" :min-height="60" placeholder="select … from … where id = {{ значение.из.заметки }}" /></div>
    <div class="bs-acts tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
      <MenuButton label="План" icon="list" :disabled="run?.state === 'run'" title="План запроса: что делает сервер и где узкие места" :width="300" :items="planItems" />
      <button class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:border-accent tw:hover:enabled:text-text tw:disabled:opacity-50 tw:hover:enabled:bg-hover" title="Отформатировать запрос (ключевые слова, отступы) — по правилам СУБД подключения" @click="format"><Icon name="code" :size="12" />Форматировать</button>
      <button v-if="conn" class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:border-accent tw:hover:enabled:text-text tw:disabled:opacity-50 tw:hover:enabled:bg-hover" :disabled="schemaBusy" :title="schemaErr ? `Схема не прочитана: ${schemaErr}` : 'Подсказки при наборе: схемы, таблицы, колонки (с типами). Прочитать схему заново'" @click="loadSchema(true)"><Icon name="refresh" :size="12" />{{ schemaBusy ? 'схема…' : schemaErr ? 'схема: ошибка' : `схема · ${tableCount}` }}</button>
      <span class="muted hint tw:text-muted tw:overflow-hidden tw:text-[11.5px] tw:text-ellipsis" :title="pub ? `Строки результата — в переменной {{${pub}}}: {{${pub}[0].поле}}` : ''">Ctrl+Enter — выполнить</span>
    </div>
    <p v-if="fmtErr" class="bs-miss tw:m-0 tw:text-down-fg tw:text-[12.5px] tw:whitespace-pre-wrap">{{ fmtErr }}</p>
    <p v-if="run?.sql?.missing.length" class="bs-miss tw:m-0 tw:text-down-fg tw:text-[12.5px] tw:whitespace-pre-wrap">Нет значения: <code v-for="m in run.sql.missing" :key="m">{{ '{' }}{{ '{' }}{{ m }}{{ '}' }}{{ '}' }}</code> — выполните блок, который его даёт</p>

    <div v-if="run && run.state !== 'run' && (table || plan || run.error)" class="bs-res tw:border tw:border-border-2 tw:rounded-[8px] tw:overflow-hidden tw:bg-bg tw:min-w-0 tw:max-w-full tw:contain-[inline-size]">
      <div class="bs-rh tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:py-4 tw:px-8 tw:border-b tw:border-b-border tw:[background:var(--bg-2,transparent)] tw:text-[12.5px]">
        <button class="fold tw:inline-grid tw:place-items-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:[background:none] tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="open ? 'Свернуть' : 'Показать'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <template v-if="table">
          <b>строк {{ table.rows.length }}{{ table.more ? '+' : '' }}</b>
          <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ dur(table.ms) }} · {{ run.server }}</span>
          <span v-if="table.more" class="warn tw:text-warn-fg tw:text-[12px]">прочитано не больше {{ table.rows.length }} — остальные не забирались</span>
          <span class="grow tw:flex-1"></span>
          <span v-if="copied" class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">скопировано</span>
          <span v-else-if="selCount > 1" class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis" title="Ctrl+C — копировать (в Excel — по столбцам)">выделено {{ selCount }}</span>
          <MenuButton icon="download" title="Строки результата: скопировать или сохранить в Excel / CSV" :width="240" :items="exportItems" />
        </template>
        <template v-else-if="plan">
          <b>{{ plan.analyzed ? 'План с выполнением' : 'План (без выполнения)' }}</b>
          <span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">{{ plan.executionMs !== undefined ? `выполнение ${dur(plan.executionMs)}` : '' }}{{ plan.planningMs !== undefined ? ` · планирование ${dur(plan.planningMs)}` : '' }} · {{ run.server }}</span>
          <span class="grow tw:flex-1"></span>
          <button class="pill tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-accent tw:hover:enabled:border-accent tw:[&.on]:text-text tw:hover:enabled:text-text tw:disabled:opacity-50 tw:[&.on]:overflow-hidden tw:[&.on]:text-ellipsis tw:hover:enabled:bg-hover" :class="{ on: rawOpen }" title="План так, как его отдал сервер" @click="rawOpen = !rawOpen">как есть</button>
        </template>
        <b v-else class="err tw:text-down-fg">Ошибка</b>
      </div>
      <template v-if="open">
        <p v-if="run.error" class="bs-err tw:m-0 tw:text-down-fg tw:text-[12.5px] tw:whitespace-pre-wrap tw:py-6 tw:px-10">{{ run.error }}</p>
        <DataGrid v-if="table" :grid="grid" />
        <div v-if="plan" class="bs-plan tw:pt-6 tw:pr-8 tw:pb-8 tw:pl-8">
          <ul v-if="plan.findings.length" class="finds tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:p-0 tw:[list-style:none]">
            <li class="tw:flex tw:items-baseline tw:gap-6 tw:py-2 tw:px-0 tw:text-[12.5px]" v-for="(f, i) in plan.findings" :key="i" :class="f.level"><Icon :name="f.level === 'warn' ? 'zap' : 'list'" :size="12" />{{ f.text }}</li>
          </ul>
          <p v-else class="muted tw:text-muted">Явных узких мест не видно.</p>
          <div class="tree tw:font-data tw:text-[12px]">
            <div v-for="(x, i) in flat" :key="i" class="pn tw:py-3 tw:px-4 tw:border-t tw:border-t-border" :style="{ paddingLeft: `${x.depth * 16 + 4}px` }">
              <div class="pn-h tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap">
                <span class="op tw:font-semibold">{{ x.n.op }}</span>
                <span v-if="x.n.on" class="on tw:overflow-hidden tw:text-accent tw:text-ellipsis">{{ x.n.on }}</span>
                <span v-for="f in x.n.flags" :key="f" class="flag tw:flex-none tw:py-0 tw:px-6 tw:rounded-[8px] tw:bg-[color-mix(in_srgb,var(--warn-fg)_16%,transparent)] tw:text-warn-fg tw:font-[inherit] tw:text-[11px]">{{ f }}</span>
                <span class="grow tw:flex-1"></span>
                <span class="nums tw:text-text-2 tw:[&.off]:text-warn-fg" :class="{ off: off(x.n) }" :title="off(x.n) ? 'Оценка строк сильно расходится с реальностью' : ''">
                  <template v-if="x.n.act">строк {{ num(x.n.act.rows) }}<template v-if="x.n.est?.rows !== undefined"> (ожид. {{ num((x.n.est.rows ?? 0) * (x.n.act.loops ?? 1)) }})</template><template v-if="(x.n.act.loops ?? 1) > 1"> · ×{{ num(x.n.act.loops) }}</template></template>
                  <template v-else-if="x.n.est?.rows !== undefined">ожид. строк {{ num(x.n.est.rows) }}</template>
                </span>
                <span v-if="x.n.selfMs !== undefined" class="ms tw:flex-none tw:min-w-56 tw:text-text tw:text-right">{{ dur(x.n.selfMs) }}</span>
              </div>
              <div v-if="x.n.selfMs !== undefined && totalMs" class="bar tw:h-3 tw:my-2 tw:mx-0 tw:bg-border"><i class="tw:block tw:h-full tw:bg-accent" :style="{ width: `${Math.min(100, (x.n.selfMs / totalMs) * 100)}%` }"></i></div>
              <div v-for="(d, j) in x.n.detail" :key="j" class="pn-d tw:pl-12 tw:overflow-hidden tw:text-muted tw:text-ellipsis tw:whitespace-nowrap">{{ d }}</div>
            </div>
          </div>
          <pre v-if="rawOpen" class="raw tw:max-h-300 tw:mt-8 tw:mr-0 tw:mb-0 tw:ml-0 tw:p-6 tw:overflow-auto tw:border tw:border-border tw:rounded-[4px] tw:text-[11.5px]">{{ run.planRaw }}</pre>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped src="./BlockSql.css"></style>
