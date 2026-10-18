<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { compareTexts, foldRows, type DiffOptions, type View } from '@shared/textDiff'
import { canFormat, detectKind, formatKind, kindTitle, type CodeKind } from '../../lib/codeLang'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'

/**
 * Two texts side by side and what differs: lines put in / taken out / changed (only them — git's way of
 * comparing), the changed words inside a line lit, long equal stretches folded. JSON is formatted (keys sorted)
 * before it is compared.
 */
const KEY = 'qa.tools.diff'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DiffOptions> & { split?: number }
  } catch {
    return {}
  }
})()
const opt = reactive<DiffOptions>({ mode: saved.mode ?? 'auto', ignoreSpace: !!saved.ignoreSpace, ignoreCase: !!saved.ignoreCase, sortKeys: saved.sortKeys ?? true })
const split = ref(Math.min(0.7, Math.max(0.15, saved.split ?? 0.38)))
watch([opt, split], () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...opt, split: split.value }))
  } catch {
    // fine
  }
})
const left = ref('')
const right = ref('')
// compared a moment after typing stops (big texts stay smooth)
const a = ref('')
const b = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch([left, right], () => {
  clearTimeout(timer)
  timer = setTimeout(() => ((a.value = left.value), (b.value = right.value)), 250)
})
const result = computed(() => compareTexts(a.value, b.value, opt))
const looksJson = computed(() => result.value.json)
/** What the texts are (Авто: guessed from them — JSON, SQL, XML, HTML, YAML…; one side is enough). */
const kind = computed<CodeKind | undefined>(() => {
  if (opt.mode === 'text') return undefined
  if (opt.mode === 'json' || looksJson.value) return 'json'
  const l = detectKind(a.value)
  const r = detectKind(b.value)
  return l && r && l !== r ? undefined : (l ?? r)
})
const lang = computed(() => kind.value ?? 'text')
const opened = ref(new Set<number>())
watch(result, () => (opened.value = new Set()))
const view = computed<View[]>(() => foldRows(result.value.rows, 3, opened.value))
function unfold(from: number, to: number): void {
  const s = new Set(opened.value)
  for (let i = from; i < to; i++) s.add(i)
  opened.value = s
}
const empty = computed(() => !a.value.trim() && !b.value.trim())

// ---------- going from change to change ----------
/** The first row of each change (a run of changed rows is one change). */
const changes = computed(() => result.value.rows.flatMap((r, i, all) => (r.kind !== 'same' && (i === 0 || all[i - 1].kind === 'same') ? [i] : [])))
const at = ref(-1)
watch(changes, () => (at.value = -1))
const out = ref<HTMLElement>()
async function goChange(dir: 1 | -1): Promise<void> {
  const n = changes.value.length
  if (!n) return
  at.value = at.value < 0 ? (dir > 0 ? 0 : n - 1) : (at.value + dir + n) % n
  const row = changes.value[at.value]
  // a change folded away — opened first
  if (!view.value.some((v) => 'row' in v && v.i === row)) unfold(row, row + 1)
  await nextTick()
  out.value?.querySelector(`[data-i="${row}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
const current = computed(() => (at.value >= 0 ? changes.value[at.value] : -1))

// ---------- the inputs ----------
const fmtErr = ref<{ l?: string; r?: string }>({})
watch([left, right], () => (fmtErr.value = {}))
/** Both sides formatted as their kind (a side that does not parse stays and says why). */
async function formatBoth(): Promise<void> {
  const k = kind.value
  if (!canFormat(k)) return
  const one = async (t: string) => {
    if (!t.trim()) return { t }
    try {
      return { t: await formatKind(k, t, { sortKeys: opt.sortKeys }) }
    } catch (e) {
      return { t, err: (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 160) }
    }
  }
  const [l, r] = await Promise.all([one(left.value), one(right.value)])
  left.value = l.t
  right.value = r.t
  fmtErr.value = { l: l.err, r: r.err }
}
function swap(): void {
  ;[left.value, right.value] = [right.value, left.value]
}
function clearAll(): void {
  left.value = ''
  right.value = ''
}
async function paste(side: 'l' | 'r'): Promise<void> {
  const t = await navigator.clipboard.readText()
  if (side === 'l') left.value = t
  else right.value = t
}
const lines = (s: string) => (s ? s.split('\n').length : 0)
const area = ref<HTMLElement>()
function dragSplit(e: PointerEvent): void {
  e.preventDefault()
  const box = area.value?.getBoundingClientRect()
  if (!box) return
  const move = (ev: PointerEvent) => (split.value = Math.min(0.7, Math.max(0.15, (ev.clientY - box.top) / box.height)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'row-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="dt">
    <div class="bar">
      <span class="seg">
        <button v-for="m in [{ id: 'auto', l: 'Авто' }, { id: 'json', l: 'JSON' }, { id: 'text', l: 'Текст' }] as const" :key="m.id" :class="{ on: opt.mode === m.id }" :title="m.id === 'auto' ? 'Формат определяется по тексту: JSON (сравнение по структуре), SQL, XML, HTML, YAML, JS… или просто текст' : ''" @click="opt.mode = m.id">{{ m.l }}</button>
      </span>
      <span v-if="opt.mode === 'auto'" class="kind" :class="{ none: !kind }" :title="kind ? 'Формат определён по тексту' : 'Формат не определён — сравнение как текст'">{{ kind ? kindTitle(kind) : 'текст' }}</span>
      <label v-if="kind === 'json' || kind === 'yaml'" class="chk" title="Порядок ключей в объектах не считается изменением"><input v-model="opt.sortKeys" type="checkbox" />Сортировать ключи</label>
      <label class="chk" title="Пробелы в начале / конце строк и их количество не считаются"><input v-model="opt.ignoreSpace" type="checkbox" />Без пробелов</label>
      <label class="chk"><input v-model="opt.ignoreCase" type="checkbox" />Без регистра</label>
      <span class="grow"></span>
      <button class="fmt" :disabled="!canFormat(kind)" :title="canFormat(kind) ? `Отформатировать ${kindTitle(kind)} в обоих полях` : 'Формат не определён — форматировать нечего'" @click="formatBoth"><Icon name="code" :size="13" />Форматировать</button>
      <button class="ib" title="Поменять местами" @click="swap"><Icon name="repeat" :size="14" /></button>
      <button class="ib" title="Очистить оба поля" :disabled="!left && !right" @click="clearAll"><Icon name="trash" :size="14" /></button>
    </div>

    <div ref="area" class="area" :style="{ gridTemplateRows: `${split * 100}% 6px minmax(0, 1fr)` }">
      <div class="ins">
        <div v-for="side in ['l', 'r'] as const" :key="side" class="in">
          <div class="ih">
            <b>{{ side === 'l' ? 'Было' : 'Стало' }}</b>
            <span class="muted">{{ lines(side === 'l' ? left : right) }} стр.</span>
            <span v-if="side === 'l' ? fmtErr.l : fmtErr.r" class="err" :title="side === 'l' ? fmtErr.l : fmtErr.r">не форматируется: {{ side === 'l' ? fmtErr.l : fmtErr.r }}</span>
            <span v-else-if="side === 'l' ? result.error?.left : result.error?.right" class="err" :title="side === 'l' ? result.error?.left : result.error?.right">не JSON: {{ side === 'l' ? result.error?.left : result.error?.right }}</span>
            <span class="grow"></span>
            <button class="ib sm" title="Вставить из буфера" @click="paste(side)"><Icon name="clipboard" :size="12" /></button>
          </div>
          <div class="ed">
            <CodeArea v-if="side === 'l'" v-model="left" :lang="lang" fill :min-height="0" placeholder="Вставьте первый текст: JSON, SQL, XML, YAML…" />
            <CodeArea v-else v-model="right" :lang="lang" fill :min-height="0" placeholder="Вставьте второй текст" />
          </div>
        </div>
      </div>
      <div class="hsplit" title="Потяните — высота полей" @pointerdown="dragSplit"></div>

      <div class="res">
        <div class="rh">
          <b>Различия</b>
          <template v-if="!empty">
            <span v-if="result.json" class="tag">JSON</span>
            <span v-if="result.stats.same" class="ok">Тексты одинаковые</span>
            <template v-else>
              <span class="st add" title="Добавлено строк">+{{ result.stats.added }}</span>
              <span class="st del" title="Удалено строк">−{{ result.stats.removed }}</span>
              <span class="st mod" title="Изменено строк">~{{ result.stats.changed }}</span>
            </template>
          </template>
          <span class="grow"></span>
          <template v-if="changes.length">
            <span class="muted">{{ at < 0 ? changes.length : `${at + 1} / ${changes.length}` }} изм.</span>
            <button class="ib sm" title="Предыдущее изменение" @click="goChange(-1)"><Icon name="chevronLeft" :size="13" style="transform: rotate(90deg)" /></button>
            <button class="ib sm" title="Следующее изменение" @click="goChange(1)"><Icon name="chevronRight" :size="13" style="transform: rotate(90deg)" /></button>
          </template>
        </div>
        <div ref="out" class="dv">
          <p v-if="empty" class="hint">Вставьте два текста сверху — различия появятся здесь. JSON сравнивается по смыслу: форматирование и порядок ключей не считаются изменениями.</p>
          <template v-else>
            <template v-for="(v, k) in view" :key="k">
              <button v-if="'fold' in v" class="fold" @click="unfold(v.from, v.to)">⋯ {{ v.fold }} одинаковых строк — показать</button>
              <div v-else class="row" :class="[v.row.kind, { cur: v.i === current }]" :data-i="v.i">
                <span class="n">{{ v.row.l?.n ?? '' }}</span>
                <span class="t l" :class="{ none: !v.row.l }"><template v-for="(s, j) in v.row.l?.segs ?? []" :key="j"><mark v-if="s.hl && v.row.kind === 'mod'">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template></span>
                <span class="n">{{ v.row.r?.n ?? '' }}</span>
                <span class="t r" :class="{ none: !v.row.r }"><template v-for="(s, j) in v.row.r?.segs ?? []" :key="j"><mark v-if="s.hl && v.row.kind === 'mod'">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template></span>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kind {
  flex: none;
  padding: 2px 8px;
  border: 1px solid rgb(var(--accent-rgb) / 0.45);
  border-radius: var(--r2);
  color: var(--accent-fg);
  font-family: var(--font-data);
  font-size: 11px;
}
.kind.none {
  border-color: var(--border-2);
  color: var(--muted);
}
.fmt {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.fmt:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.fmt:disabled {
  opacity: 0.4;
}
.dt {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 12.5px;
}
.grow {
  flex: 1;
}
.ib {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib.sm {
  width: 24px;
  height: 24px;
}
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.35;
}
.area {
  flex: 1;
  min-height: 0;
  display: grid;
}
.ins {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1px;
  min-height: 0;
  background: var(--border);
}
.in {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}
.ih {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 6px 0 12px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.ih b {
  color: var(--text-hi);
}
.err {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--down-fg);
}
.ed {
  flex: 1;
  min-height: 0;
  padding: 0 6px 6px;
}
.ed :deep(.cm-editor) {
  font-size: 12.5px;
}
.hsplit {
  background: var(--border);
  cursor: row-resize;
}
.hsplit:hover {
  background: rgb(var(--accent-rgb) / 0.85);
}
.res {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rh {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
  white-space: nowrap;
}
.rh b {
  color: var(--text-hi);
}
.tag {
  padding: 1px 6px;
  border-radius: var(--r1);
  background: var(--panel-3);
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 10.5px;
}
.ok {
  color: var(--up-fg);
}
.st {
  font-family: var(--font-data);
  font-weight: 600;
}
.st.add {
  color: var(--up-fg);
}
.st.del {
  color: var(--down-fg);
}
.st.mod {
  color: var(--warn-fg);
}
.muted {
  color: var(--muted);
}
.dv {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-family: var(--font-data);
  font-size: 12.5px;
  line-height: 1.55;
}
.hint {
  margin: 16px;
  color: var(--muted);
  font-family: var(--font-ui);
}
.row {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) 46px minmax(0, 1fr);
}
.row.cur {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.n {
  padding: 0 8px;
  color: var(--dim);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--border);
}
.t {
  padding: 0 10px;
  white-space: pre-wrap;
  word-break: break-all;
  min-height: 1.55em;
}
.t.r {
  border-left: 1px solid var(--border);
}
.t.none {
  background: repeating-linear-gradient(-45deg, transparent 0 5px, rgba(255, 255, 255, 0.025) 5px 10px);
}
.row.del .t.l,
.row.del .n:first-child {
  background: rgba(255, 61, 61, 0.13);
}
.row.add .t.r,
.row.add .n:nth-child(3) {
  background: rgba(0, 230, 118, 0.11);
}
.row.mod .t.l {
  background: rgba(255, 61, 61, 0.07);
}
.row.mod .t.r {
  background: rgba(0, 230, 118, 0.06);
}
.row.mod .t.l mark {
  background: rgba(255, 61, 61, 0.35);
  color: var(--text-hi);
  border-radius: 2px;
}
.row.mod .t.r mark {
  background: rgba(0, 230, 118, 0.3);
  color: var(--text-hi);
  border-radius: 2px;
}
.fold {
  display: block;
  width: 100%;
  height: 26px;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  border-top: 1px dashed var(--border-2);
  border-bottom: 1px dashed var(--border-2);
  background: var(--panel);
  color: var(--muted);
  font-family: var(--font-ui);
  font-size: 12px;
  text-align: left;
}
.fold:hover {
  color: var(--accent-fg);
}
</style>
