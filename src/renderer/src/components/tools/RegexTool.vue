<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorView, Decoration, keymap, placeholder, WidgetType, type DecorationSet } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { REGEX_LANG_INFO, REGEX_LANGS, REGEX_SUPERSEDED, regexCode, runRegex, type RxResult } from '../../lib/regexRun'
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
const src = ref(saved.src ?? '')
const flags = ref(saved.flags ?? 'gm')
const text = ref(saved.text ?? '')
const repl = ref(saved.repl ?? '')
/** The side panel's tabs, in order. */
const TABS = [
  { id: 'matches', label: 'Совпадения' },
  { id: 'replace', label: 'Замена' },
  { id: 'code', label: 'Код' },
] as const
type Tab = (typeof TABS)[number]['id']
const tab = ref<Tab>(TABS.find((t) => t.id === saved.tab)?.id ?? 'matches')
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
    if (m === REGEX_SUPERSEDED) return
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

const code = computed(() => REGEX_LANGS.map((l) => ({ l, title: REGEX_LANG_INFO[l].title, code: regexCode(src.value, flags.value, l) })))
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
  <div class="rx tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="top tw:flex-none tw:flex tw:items-center tw:gap-10 tw:pt-12 tw:pr-14 tw:pb-6 tw:pl-14">
      <div class="pat tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:h-40 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-12 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:font-data tw:focus-within:not-[&.bad]:border-accent tw:[&.bad]:border-down" :class="{ bad: !!error }">
        <span class="sl tw:text-muted tw:text-[15px]">/</span>
        <input class="tw:flex-1 tw:min-w-0 tw:h-38 tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:text-text-hi tw:font-data tw:text-[15px] tw:outline-none" :value="src" spellcheck="false" placeholder="выражение, например \d{4}-\d{2}-\d{2}" @input="onSrcInput(($event.target as HTMLInputElement).value)" />
        <span class="sl tw:text-muted tw:text-[15px]">/{{ flags }}</span>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:border-border-3" title="Копировать как /…/флаги" :disabled="!src" @click="copy(`/${src}/${flags}`, 'Выражение скопировано')"><Icon name="copy" :size="13" /></button>
      </div>
      <span class="flags tw:flex-none tw:inline-flex tw:gap-2">
        <button class="tw:w-30 tw:h-30 tw:p-0 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:font-data tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" v-for="x in FLAGS" :key="x.f" :class="{ on: flags.includes(x.f) }" :title="x.t" @click="toggleFlag(x.f)">{{ x.f }}</button>
      </span>
    </div>
    <div class="status tw:flex-none tw:flex tw:items-center tw:gap-12 tw:min-h-26 tw:pt-0 tw:pr-16 tw:pb-8 tw:pl-16 tw:text-[12.5px] tw:border-b tw:border-b-border">
      <span v-if="error" class="err tw:text-down-fg">{{ error }}</span>
      <template v-else-if="res">
        <b class="tw:text-up-fg tw:[&.none]:text-muted" :class="{ none: !res.matches.length }">{{ res.matches.length ? `Совпадений: ${res.matches.length}${res.truncated ? '+' : ''}` : 'Совпадений нет' }}</b>
        <span v-if="res.matches[0]?.groups.length" class="muted tw:text-muted tw:text-[12px]">групп: {{ res.matches[0].groups.length }}</span>
        <span class="muted tw:text-muted tw:text-[12px]">{{ res.ms < 1 ? '< 1' : Math.round(res.ms) }} мс</span>
      </template>
      <span v-if="busy" class="muted tw:text-muted tw:text-[12px]">…</span>
      <span class="grow tw:flex-1"></span>
      <span v-if="copied" class="ok tw:text-up-fg">{{ copied }}</span>
    </div>
    <div class="body tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      <div ref="host" class="text tw:min-w-0 tw:min-h-0 tw:overflow-hidden"></div>
      <aside class="side tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:border-l tw:border-l-border">
        <div class="tabs tw:flex-none tw:flex tw:h-36 tw:py-0 tw:px-8 tw:border-b tw:border-b-border">
          <button v-for="t in TABS" :key="t.id" class="tw:h-36 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:[&.on]:text-text-hi tw:[&.on]:[box-shadow:var(--shadow-underline)]" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
        </div>
        <div v-if="tab === 'matches'" class="list tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:gap-6 tw:py-10 tw:px-12 tw:overflow-auto">
          <div v-for="(m, i) in res?.matches ?? []" :key="i" class="mt tw:flex-none tw:flex tw:flex-col tw:gap-3 tw:py-6 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:cursor-pointer tw:[&.cur]:border-accent/60" :class="{ cur: sel === i }" @click="goMatch(i)">
            <div class="mh tw:flex tw:items-baseline tw:gap-8 tw:min-w-0"><span class="no tw:text-muted tw:font-data tw:text-[11px]">{{ i + 1 }}</span><code class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-text-hi tw:font-data tw:text-[12.5px] tw:text-ellipsis tw:whitespace-nowrap">{{ show(m.text) }}</code><span class="pos tw:text-dim tw:font-data tw:text-[11px]">{{ m.index }}–{{ m.end }}</span></div>
            <div v-for="g in m.groups" :key="g.n" class="gr tw:grid tw:grid-cols-[80px_minmax(0,1fr)] tw:gap-8 tw:pl-18 tw:text-[12px]">
              <span class="gn tw:[&.grow]:flex-1 tw:[&.gr]:grid tw:[&.gr]:grid-cols-[80px_minmax(0,1fr)] tw:[&.gr]:gap-8 tw:[&.gr]:pl-18 tw:[&.gr]:text-[12px] tw:overflow-hidden tw:font-data tw:text-ellipsis" :style="{ color: `var(--regex-group-${((g.n - 1) % 4) + 1})` }">{{ g.name ? g.name : `$${g.n}` }}</span>
              <code class="tw:overflow-hidden tw:text-text tw:font-data tw:text-ellipsis tw:whitespace-nowrap">{{ show(g.value) }}</code>
            </div>
          </div>
          <details class="cheat tw:mt-8 tw:text-[12px]">
            <summary class="tw:text-text-2 tw:cursor-pointer">Шпаргалка</summary>
            <div v-for="c in CHEAT" :key="c[0]" class="ch tw:grid tw:grid-cols-[110px_minmax(0,1fr)] tw:gap-8 tw:py-3 tw:px-0"><code class="tw:text-accent-fg tw:font-data">{{ c[0] }}</code><span class="tw:text-text-2">{{ c[1] }}</span></div>
          </details>
        </div>
        <div v-else-if="tab === 'replace'" class="list tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:gap-6 tw:py-10 tw:px-12 tw:overflow-auto">
          <label class="fld tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12.5px]">Заменить на <span class="muted tw:text-muted tw:text-[12px]">$1, $&lt;имя&gt;, $&amp; — всё совпадение</span><input class="tw:font-data" v-model="repl" spellcheck="false" /></label>
          <div class="ph tw:flex tw:items-center tw:gap-8 tw:text-[12.5px]"><b class="tw:text-text-hi">Результат</b><span class="grow tw:flex-1"></span><button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:border-border-3" title="Копировать" :disabled="res?.replaced === undefined" @click="copy(res?.replaced ?? '', 'Результат скопирован')"><Icon name="copy" :size="13" /></button></div>
          <pre class="out tw:m-0 tw:py-8 tw:px-10 tw:overflow-auto tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:text-text tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word]">{{ res?.replaced ?? '' }}</pre>
        </div>
        <div v-else class="list tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:gap-6 tw:py-10 tw:px-12 tw:overflow-auto">
          <div v-for="c in code" :key="c.l" class="code tw:flex tw:flex-col tw:gap-4">
            <div class="ph tw:flex tw:items-center tw:gap-8 tw:text-[12.5px]"><b class="tw:text-text-hi">{{ c.title }}</b><span class="grow tw:flex-1"></span><button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:hover:enabled:border-border-3" title="Копировать" @click="copy(c.code, `${c.title} скопирован`)"><Icon name="copy" :size="13" /></button></div>
            <pre class="out tw:m-0 tw:py-8 tw:px-10 tw:overflow-auto tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:text-text tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word]">{{ c.code }}</pre>
          </div>
          <p class="muted tw:text-muted tw:text-[12px]">Проверка идёт движком JavaScript. В Java, Python и C# почти всё так же; отличия — в редких конструкциях (\p{…}, ленивые и притяжательные квантификаторы, lookbehind переменной длины).</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped src="./RegexTool.css"></style>
