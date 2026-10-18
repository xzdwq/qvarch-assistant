<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView, Decoration, keymap, placeholder, WidgetType, type DecorationSet } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { regexCode, runRegex, type RxResult } from '../../lib/regexRun'
import Icon from '../Icon.vue'

/**
 * Регулярные выражения: a pattern tried on a text as you type — the matches lit in the text, each one with its
 * groups (numbered and named), the replacement's result, the pattern as code for JS / Java / Python / C#.
 * The engine is JavaScript's own, run away from the window with a time limit (a runaway pattern is stopped).
 */
const KEY = 'qa.tools.regex'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { src?: string; flags?: string; text?: string; repl?: string; tab?: string }
  } catch {
    return {}
  }
})()
const src = ref(saved.src ?? '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)')
const flags = ref(saved.flags ?? 'gm')
const text = ref(saved.text ?? 'Пишите: ivan.petrov@example.com, support@qvant.ru\nи ещё team-lead@corp.example.org')
const repl = ref(saved.repl ?? '$<user> at $<domain>')
const tab = ref<'matches' | 'replace' | 'code'>((saved.tab as 'matches') ?? 'matches')
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch([src, flags, text, repl, tab], () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      // a huge test text is not kept
      localStorage.setItem(KEY, JSON.stringify({ src: src.value, flags: flags.value, text: text.value.length > 200_000 ? '' : text.value, repl: repl.value, tab: tab.value }))
    } catch {
      // fine
    }
  }, 400)
})
const FLAGS: Array<{ f: string; t: string }> = [
  { f: 'g', t: 'g — все совпадения (иначе только первое)' },
  { f: 'i', t: 'i — без учёта регистра' },
  { f: 'm', t: 'm — ^ и $ на каждой строке' },
  { f: 's', t: 's — точка ловит и перевод строки' },
  { f: 'u', t: 'u — Юникод: \\u{…}, \\p{L} (буквы любых языков)' },
  { f: 'y', t: 'y — «липкий»: только с позиции после прошлого совпадения' },
]
function toggleFlag(f: string): void {
  flags.value = flags.value.includes(f) ? flags.value.replace(f, '') : [...(flags.value + f)].sort((a, b) => 'gimsuy'.indexOf(a) - 'gimsuy'.indexOf(b)).join('')
}
/** Pasted as /pattern/flags — taken apart. */
function onSrcInput(v: string): void {
  const m = /^\/(.+)\/([dgimsuvy]*)$/s.exec(v)
  if (m) {
    src.value = m[1]
    flags.value = [...new Set(m[2].replace(/[dv]/g, ''))].join('')
  } else src.value = v
}

// ---------- the run ----------
const res = shallowRef<RxResult>()
const error = ref('')
const busy = ref(false)
let runTimer: ReturnType<typeof setTimeout> | undefined
watch(
  [src, flags, text, repl, tab],
  () => {
    clearTimeout(runTimer)
    runTimer = setTimeout(run, 120)
  },
  { immediate: true },
)
async function run(): Promise<void> {
  if (!src.value) {
    res.value = undefined
    error.value = ''
    return paint()
  }
  busy.value = true
  try {
    res.value = await runRegex(src.value, flags.value, text.value, { replace: tab.value === 'replace' ? repl.value : undefined })
    error.value = ''
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (m === 'superseded') return
    res.value = undefined
    error.value = m.startsWith('TIMEOUT:')
      ? `Остановлено: дольше ${Number(m.slice(8)) / 1000} с. Скорее всего, «катастрофический перебор» — вложенные повторы вроде (a+)+ или (.*)*. Уточните выражение.`
      : m.replace(/^Invalid regular expression: /, 'Ошибка в выражении: ')
  } finally {
    busy.value = false
    paint()
  }
}

// ---------- the text with the matches lit ----------
const host = ref<HTMLElement>()
let view: EditorView | undefined
const setMarks = StateEffect.define<DecorationSet>()
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (d, tr) => {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value
    return d.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})
const sel = ref(-1)
function paint(): void {
  if (!view) return
  const r = res.value
  const len = view.state.doc.length
  const out = []
  if (r)
    for (const [i, m] of r.matches.entries()) {
      if (m.end > len) break
      if (m.end > m.index) out.push(Decoration.mark({ class: `rx-m ${i % 2 ? 'b' : 'a'}${i === sel.value ? ' cur' : ''}` }).range(m.index, m.end))
      else out.push(Decoration.widget({ widget: new EmptyMark(), side: 1 }).range(m.index))
      for (const g of m.groups) if (g.start !== undefined && g.end !== undefined && g.end > g.start && g.end <= len) out.push(Decoration.mark({ class: `rx-g g${((g.n - 1) % 4) + 1}` }).range(g.start, g.end))
    }
  view.dispatch({ effects: setMarks.of(Decoration.set(out, true)) })
}
/** An empty match (^, \b…): a thin line where it is. */
class EmptyMark extends WidgetType {
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'rx-empty'
    return s
  }
}
onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: text.value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        marks,
        placeholder('Текст для проверки — совпадения подсветятся'),
        EditorView.updateListener.of((u) => u.docChanged && (text.value = u.state.doc.toString())),
        EditorView.theme({
          '&': { height: '100%', color: 'var(--text)', fontSize: '13px' },
          '&.cm-focused': { outline: 'none' },
          '.cm-content': { fontFamily: 'var(--font-data)', caretColor: 'var(--accent-fg)', padding: '10px 0' },
          '.cm-line': { padding: '0 14px' },
          '.cm-scroller': { overflow: 'auto' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(var(--accent-rgb) / 0.3) !important' },
        }),
      ],
    }),
  })
  paint()
})
onBeforeUnmount(() => view?.destroy())
/** A match picked in the list: lit stronger, scrolled to. */
function goMatch(i: number): void {
  sel.value = i
  const m = res.value?.matches[i]
  if (!view || !m) return
  view.dispatch({ effects: EditorView.scrollIntoView(m.index, { y: 'center' }) })
  paint()
}

const code = computed(() => (['js', 'java', 'python', 'csharp'] as const).map((l) => ({ l, title: { js: 'JavaScript', java: 'Java', python: 'Python', csharp: 'C#' }[l], code: regexCode(src.value, flags.value, l) })))
const copied = ref('')
async function copy(t: string, what: string): Promise<void> {
  await navigator.clipboard.writeText(t)
  copied.value = what
  setTimeout(() => copied.value === what && (copied.value = ''), 1200)
}
const show = (s?: string) => (s === undefined ? '—' : s === '' ? '«пусто»' : s.length > 200 ? s.slice(0, 200) + '…' : s)
const CHEAT: Array<[string, string]> = [
  ['.', 'любой символ (кроме перевода строки без s)'],
  ['\\d \\w \\s', 'цифра, буква/цифра/_, пробел'],
  ['\\D \\W \\S', 'всё, кроме них'],
  ['[abc] [^abc]', 'один из / ни один из'],
  ['[а-яё]', 'диапазон (кириллица — с флагом i для заглавных)'],
  ['^ $', 'начало / конец (строки — с флагом m)'],
  ['\\b', 'граница слова (только латиница)'],
  ['* + ?', '0+, 1+, 0 или 1 раз'],
  ['{2,5}', 'от 2 до 5 раз'],
  ['*? +?', 'как можно меньше (ленивый)'],
  ['(…)', 'группа с номером: $1 в замене'],
  ['(?<имя>…)', 'именованная группа: $<имя>'],
  ['(?:…)', 'группа без номера'],
  ['a|b', 'или'],
  ['(?=…) (?!…)', 'дальше идёт / не идёт'],
  ['(?<=…) (?<!…)', 'перед этим было / не было'],
  ['\\p{L}', 'любая буква любого языка (флаг u)'],
]
</script>

<template>
  <div class="rx">
    <div class="top">
      <div class="pat" :class="{ bad: !!error }">
        <span class="sl">/</span>
        <input :value="src" spellcheck="false" placeholder="выражение, например \d{4}-\d{2}-\d{2}" @input="onSrcInput(($event.target as HTMLInputElement).value)" />
        <span class="sl">/{{ flags }}</span>
        <button class="ib" title="Копировать как /…/флаги" :disabled="!src" @click="copy(`/${src}/${flags}`, 'Выражение скопировано')"><Icon name="copy" :size="13" /></button>
      </div>
      <span class="flags">
        <button v-for="x in FLAGS" :key="x.f" :class="{ on: flags.includes(x.f) }" :title="x.t" @click="toggleFlag(x.f)">{{ x.f }}</button>
      </span>
    </div>
    <div class="status">
      <span v-if="error" class="err">{{ error }}</span>
      <template v-else-if="res">
        <b :class="{ none: !res.matches.length }">{{ res.matches.length ? `Совпадений: ${res.matches.length}${res.truncated ? '+' : ''}` : 'Совпадений нет' }}</b>
        <span v-if="res.matches[0]?.groups.length" class="muted">групп: {{ res.matches[0].groups.length }}</span>
        <span class="muted">{{ res.ms < 1 ? '< 1' : Math.round(res.ms) }} мс</span>
      </template>
      <span v-if="busy" class="muted">…</span>
      <span class="grow"></span>
      <span v-if="copied" class="ok">{{ copied }}</span>
    </div>
    <div class="body">
      <div ref="host" class="text"></div>
      <aside class="side">
        <div class="tabs">
          <button :class="{ on: tab === 'matches' }" @click="tab = 'matches'">Совпадения</button>
          <button :class="{ on: tab === 'replace' }" @click="tab = 'replace'">Замена</button>
          <button :class="{ on: tab === 'code' }" @click="tab = 'code'">Код</button>
        </div>
        <div v-if="tab === 'matches'" class="list">
          <div v-for="(m, i) in res?.matches ?? []" :key="i" class="mt" :class="{ cur: sel === i }" @click="goMatch(i)">
            <div class="mh"><span class="no">{{ i + 1 }}</span><code>{{ show(m.text) }}</code><span class="pos">{{ m.index }}–{{ m.end }}</span></div>
            <div v-for="g in m.groups" :key="g.n" class="gr">
              <span class="gn" :class="`g${((g.n - 1) % 4) + 1}`">{{ g.name ? g.name : `$${g.n}` }}</span>
              <code>{{ show(g.value) }}</code>
            </div>
          </div>
          <details class="cheat">
            <summary>Шпаргалка</summary>
            <div v-for="c in CHEAT" :key="c[0]" class="ch"><code>{{ c[0] }}</code><span>{{ c[1] }}</span></div>
          </details>
        </div>
        <div v-else-if="tab === 'replace'" class="list">
          <label class="fld">Заменить на <span class="muted">$1, $&lt;имя&gt;, $&amp; — всё совпадение</span><input v-model="repl" spellcheck="false" /></label>
          <div class="ph"><b>Результат</b><span class="grow"></span><button class="ib" title="Копировать" :disabled="res?.replaced === undefined" @click="copy(res?.replaced ?? '', 'Результат скопирован')"><Icon name="copy" :size="13" /></button></div>
          <pre class="out">{{ res?.replaced ?? '' }}</pre>
        </div>
        <div v-else class="list">
          <div v-for="c in code" :key="c.l" class="code">
            <div class="ph"><b>{{ c.title }}</b><span class="grow"></span><button class="ib" title="Копировать" @click="copy(c.code, `${c.title} скопирован`)"><Icon name="copy" :size="13" /></button></div>
            <pre class="out">{{ c.code }}</pre>
          </div>
          <p class="muted">Проверка идёт движком JavaScript. В Java, Python и C# почти всё так же; отличия — в редких конструкциях (\p{…}, ленивые и притяжательные квантификаторы, lookbehind переменной длины).</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.rx {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 6px;
}
.pat {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 4px 0 12px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  font-family: var(--font-data);
}
.pat:focus-within {
  border-color: var(--accent);
}
.pat.bad {
  border-color: var(--down);
}
.pat input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 15px;
  outline: none;
}
.sl {
  color: var(--muted);
  font-size: 15px;
}
.flags {
  flex: none;
  display: inline-flex;
  gap: 2px;
}
.flags button {
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
}
.flags button.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--accent-fg);
}
.status {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 26px;
  padding: 0 16px 8px;
  font-size: 12.5px;
  border-bottom: 1px solid var(--border);
}
.status b {
  color: var(--up-fg);
}
.status b.none {
  color: var(--muted);
}
.err {
  color: var(--down-fg);
}
.ok {
  color: var(--up-fg);
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.grow {
  flex: 1;
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
}
.text {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.text :deep(.cm-editor) {
  height: 100%;
}
.text :deep(.rx-m.a) {
  background: rgba(56, 189, 248, 0.22);
  border-bottom: 2px solid rgba(56, 189, 248, 0.8);
}
.text :deep(.rx-m.b) {
  background: rgba(250, 204, 21, 0.18);
  border-bottom: 2px solid rgba(250, 204, 21, 0.75);
}
.text :deep(.rx-m.cur) {
  outline: 1px solid var(--accent);
}
.text :deep(.rx-g.g1) {
  color: #86efac;
}
.text :deep(.rx-g.g2) {
  color: #f9a8d4;
}
.text :deep(.rx-g.g3) {
  color: #c4b5fd;
}
.text :deep(.rx-g.g4) {
  color: #fdba74;
}
.text :deep(.rx-empty) {
  display: inline-block;
  width: 2px;
  height: 1.1em;
  margin: 0 -1px;
  vertical-align: text-bottom;
  background: var(--accent);
}
.side {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
}
.tabs {
  flex: none;
  display: flex;
  height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
}
.tabs button.on {
  color: var(--text-hi);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  overflow: auto;
}
.mt {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
  cursor: pointer;
}
.mt.cur {
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.mh {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.no {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
.mh code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pos {
  color: var(--dim);
  font-family: var(--font-data);
  font-size: 11px;
}
.gr {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 8px;
  padding-left: 18px;
  font-size: 12px;
}
.gn {
  overflow: hidden;
  font-family: var(--font-data);
  text-overflow: ellipsis;
}
.gn.g1 {
  color: #86efac;
}
.gn.g2 {
  color: #f9a8d4;
}
.gn.g3 {
  color: #c4b5fd;
}
.gn.g4 {
  color: #fdba74;
}
.gr code {
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-data);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-2);
  font-size: 12.5px;
}
.fld input {
  font-family: var(--font-data);
}
.ph {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.ph b {
  color: var(--text-hi);
}
.out {
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.code {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ib {
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
.ib:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.cheat {
  margin-top: 8px;
  font-size: 12px;
}
.cheat summary {
  color: var(--text-2);
  cursor: pointer;
}
.ch {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 8px;
  padding: 3px 0;
}
.ch code {
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.ch span {
  color: var(--text-2);
}
</style>
