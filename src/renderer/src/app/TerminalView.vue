<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BUILTIN_VARS, compileWatch, presetAsks, presetId, VAR_NAME, WATCH_COLORS, type TermConfig, type TermPreset, type TermVar, type TermWatch } from '@shared/terminal'
import Icon from '../components/Icon.vue'
import TermPane from '../components/TermPane.vue'
import ZoomChip from '../components/ZoomChip.vue'
import Markdown from '../components/Markdown.vue'
import { addTab, moveTermTab, splitTermWith, syncLayout, termLayout, termsLoaded, useTermAlerts, useTermSessions } from '../lib/terminal'
import { startListDrag } from '../lib/listDrag'
import { TERM_HELP } from '../lib/termHelp'

/**
 * Терминал: shells in tabs (they keep running while other sections are open), one or two panes side by side —
 * each with its own tabs, like the notebook. On the left: presets (commands with `{{ js }}` inserts), one's own
 * variables for them, and the reactions (a word in the output → a notice, the status bar blinks).
 */
const sessions = useTermSessions()
const { alerts, watchError } = useTermAlerts()
const cfg = ref<TermConfig>({ presets: [], vars: [], watches: [], profile: true })
void window.qa.termConfig().then((c) => (cfg.value = c))

// ---------- the view's own settings ----------
type SideTab = 'presets' | 'vars' | 'watch'
const LS = 'qa.term'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}') as { zoom?: number; side?: number; tab?: SideTab; hidden?: boolean }
  } catch {
    return {}
  }
})()
const zoom = ref(saved.zoom ?? 100)
const sideW = ref(saved.side ?? 260)
const sideTab = ref<SideTab>(saved.tab ?? 'presets')
/** The left panel hidden (like the notebook's): the terminals take the width. */
const sideHidden = ref(!!saved.hidden)
watch([zoom, sideW, sideTab, sideHidden], () => {
  try {
    localStorage.setItem(LS, JSON.stringify({ zoom: zoom.value, side: sideW.value, tab: sideTab.value, hidden: sideHidden.value }))
  } catch {
    // fine
  }
})
const fontSize = computed(() => Math.round(13 * (zoom.value / 100) * 2) / 2)

// ---------- panes and tabs ----------
const byId = (id?: string) => sessions.value.find((s) => s.id === id)
/** A shell being made: its tab is placed by hand (the list's update must not adopt it elsewhere). */
let making = 0
watch([sessions, termsLoaded], ([list, ok]) => ok && !making && syncLayout(list), { immediate: true })
const paneRefs = new Map<string, InstanceType<typeof TermPane>>()
const curId = computed(() => termLayout.panes[termLayout.cur]?.active)

async function newShell(pi = termLayout.cur): Promise<string | undefined> {
  const cwd = byId(curId.value)?.info.cwd
  making++
  try {
    const s = await window.qa.termCreate(cwd)
    // the list may have come first: the tab goes only here
    for (const p of termLayout.panes) p.tabs = p.tabs.filter((t) => t !== s.id)
    addTab(Math.min(pi, termLayout.panes.length - 1), s.id)
    return s.id
  } finally {
    making--
  }
}
onMounted(async () => {
  // the first visit: a shell to start with
  const list = await window.qa.termList()
  if (!list.length) await newShell(0)
})
/** Two panes: a new shell on the right; one: the right pane's tabs join the left. */
async function toggleSplit(): Promise<void> {
  if (termLayout.panes.length > 1) {
    const [a, b] = termLayout.panes
    for (const t of b.tabs) if (!a.tabs.includes(t)) a.tabs.push(t)
    termLayout.panes.splice(1, 1)
    termLayout.cur = 0
    return
  }
  termLayout.panes.push({ id: `p${Date.now()}`, tabs: [] })
  making++
  try {
    await newShell(1)
  } finally {
    making--
  }
  if (!termLayout.panes[1]?.tabs.length) termLayout.panes.splice(1, 1)
}
function show(pi: number, id: string): void {
  termLayout.panes[pi].active = id
  termLayout.cur = pi
}
/** To a shell's tab wherever it is (a notice clicked). */
function reveal(sid: string): void {
  const pi = termLayout.panes.findIndex((p) => p.tabs.includes(sid))
  if (pi >= 0) show(pi, sid)
}
async function closeShell(id: string): Promise<void> {
  const s = byId(id)
  if (s?.busy && !confirm(`В «${s.title}» ещё идёт команда. Закрыть оболочку?`)) return
  await window.qa.termKill(id)
}
const renaming = ref<string>()
function rename(id: string, title: string): void {
  renaming.value = undefined
  void window.qa.termRename(id, title)
}
const vFocus = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) }
function ledOf(id: string): { cls: string; style?: Record<string, string> } {
  const a = alerts.value.find((x) => x.sid === id)
  if (a) return { cls: 'alert', style: { background: a.color, boxShadow: `0 0 6px ${a.color}` } }
  const s = byId(id)
  if (!s) return { cls: '' }
  if (s.busy) return { cls: 'run' }
  if (s.failed !== undefined) return { cls: 'err' }
  return { cls: '' }
}

// the split's width
const panesEl = ref<HTMLElement>()
function onSplitResize(e: PointerEvent): void {
  const x0 = e.clientX
  const s0 = termLayout.split
  const w = panesEl.value?.clientWidth ?? 1000
  const move = (ev: PointerEvent) => (termLayout.split = Math.min(0.8, Math.max(0.2, s0 + (ev.clientX - x0) / w)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/**
 * Tabs are dragged with the pointer (not the browser's drag and drop): over a tab row — the tab takes its place
 * there at once (the others make room), in this pane or the other one; over a pane's body — the edge zones split
 * the window (one pane), the other pane takes it (two). A small label follows the pointer.
 */
const tabDrag = ref<{ pane: number; id: string; x: number; y: number }>()
const zone = ref<{ pane: number; side: 'left' | 'right' | 'here' }>()
/** A drag just ended — the click that follows it does not count. */
let dragged = false
function onTabDown(e: PointerEvent, pi: number, id: string): void {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return
  const x0 = e.clientX
  const y0 = e.clientY
  let from = pi
  const move = (ev: PointerEvent) => {
    if (!tabDrag.value) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      tabDrag.value = { pane: from, id, x: ev.clientX, y: ev.clientY }
      document.body.style.cursor = 'grabbing'
    }
    tabDrag.value.x = ev.clientX
    tabDrag.value.y = ev.clientY
    from = dragOver(from, id, ev.clientX, ev.clientY)
    tabDrag.value.pane = from
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    document.body.style.cursor = ''
    if (!tabDrag.value) return
    dragged = true
    setTimeout(() => (dragged = false))
    const z = zone.value
    tabDrag.value = undefined
    zone.value = undefined
    if (!z) return
    if (z.side === 'here') moveTermTab(from, id, z.pane, termLayout.panes[z.pane].tabs.length)
    else splitTermWith(from, id, z.side)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
/** Where the dragged tab is over: moves it in a tab row, or picks a drop zone. Returns its pane now. */
function dragOver(from: number, id: string, x: number, y: number): number {
  zone.value = undefined
  const panes = [...(panesEl.value?.querySelectorAll<HTMLElement>(':scope > .pane') ?? [])]
  const pi = panes.findIndex((el) => {
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  })
  if (pi < 0) return from
  const el = panes[pi]
  const bar = el.querySelector<HTMLElement>('.tbar')!.getBoundingClientRect()
  if (y <= bar.bottom) {
    // the tab row: its place among the other tabs, by their middles
    const list = el.querySelector<HTMLElement>('.tlist')
    if (!list) return from
    const box = list.getBoundingClientRect()
    // layout px per screen px (the section's CSS zoom); offsetLeft is free of the move animation
    const k = list.offsetWidth ? box.width / list.offsetWidth : 1
    const lx = (x - box.left) / k
    const others = termLayout.panes[pi].tabs.filter((t) => t !== id)
    const at = [...list.querySelectorAll<HTMLElement>('.tab')].filter((t) => t.dataset.id !== id && others.includes(t.dataset.id!)).filter((t) => t.offsetLeft + t.offsetWidth / 2 < lx).length
    if (pi === from) {
      const cur = termLayout.panes[pi].tabs
      if (cur.indexOf(id) === at) return from
      termLayout.panes[pi].tabs = [...others.slice(0, at), id, ...others.slice(at)]
      return from
    }
    const before = termLayout.panes.length
    moveTermTab(from, id, pi, at)
    // the pane it left may have closed (its only tab came here): the panes shift
    return termLayout.panes.length < before && from < pi ? pi - 1 : pi
  }
  // the body: the edges split (one pane, at least two tabs); the other pane takes it
  if (termLayout.panes.length === 1) {
    if (termLayout.panes[0].tabs.length < 2) return from
    const r = el.getBoundingClientRect()
    if (x < r.left + r.width * 0.3) zone.value = { pane: pi, side: 'left' }
    else if (x > r.right - r.width * 0.3) zone.value = { pane: pi, side: 'right' }
  } else if (pi !== from) zone.value = { pane: pi, side: 'here' }
  return from
}
const dragTitle = computed(() => byId(tabDrag.value?.id)?.title ?? '')
function onTabClick(pi: number, id: string): void {
  if (!dragged) show(pi, id)
}

// ---------- notices ----------
const hms = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dismiss = (id?: string) => void window.qa.termDismiss(id)

// ---------- presets ----------
const editing = ref<TermPreset>()
const isNew = ref(false)
function saveCfg(part: Partial<TermConfig>): void {
  void window.qa.termSetConfig(JSON.parse(JSON.stringify(part)) as Partial<TermConfig>)
}
const savePresets = () => saveCfg({ presets: cfg.value.presets })
function addPreset(): void {
  editing.value = { id: presetId(), name: '', cmd: '', run: true }
  isNew.value = true
}
function edit(p: TermPreset): void {
  editing.value = { ...p }
  isNew.value = false
}
function saveEdit(): void {
  const e = editing.value
  if (!e || !e.cmd.trim()) return
  if (!e.name.trim()) e.name = e.cmd.slice(0, 40)
  const i = cfg.value.presets.findIndex((p) => p.id === e.id)
  if (i >= 0) cfg.value.presets[i] = { ...e }
  else cfg.value.presets.push({ ...e })
  editing.value = undefined
  savePresets()
}
function removePreset(p: TermPreset): void {
  if (!confirm(`Удалить пресет «${p.name}»?`)) return
  cfg.value.presets = cfg.value.presets.filter((x) => x.id !== p.id)
  savePresets()
}
/** Reordering a list (presets / variables / reactions) by the handle. */
const listEl = ref<HTMLElement>()
const dragId = ref<string>()
function startDrag<T extends { id: string }>(e: PointerEvent, id: string, key: 'presets' | 'vars' | 'watches'): void {
  if (!listEl.value) return
  dragId.value = id
  const arr = () => cfg.value[key] as unknown as T[]
  startListDrag(e, {
    list: listEl.value,
    index: arr().findIndex((p) => p.id === id),
    move: (from, to) => {
      const l = [...arr()]
      const [x] = l.splice(from, 1)
      l.splice(to, 0, x)
      ;(cfg.value as unknown as Record<string, T[]>)[key] = l
    },
    done: () => {
      dragId.value = undefined
      saveCfg({ [key]: cfg.value[key] })
      if (key === 'vars') void loadValues()
    },
  })
}

// running one: ask(…) first, then the command worked out and typed into the active shell
const asking = ref<{ preset: TermPreset; fields: Array<{ label: string; value: string }> }>()
const runError = ref('')
async function runPreset(p: TermPreset): Promise<void> {
  runError.value = ''
  const asks = presetAsks(p.cmd)
  if (asks.length) {
    asking.value = { preset: p, fields: asks.map((a) => ({ label: a.label, value: a.def })) }
    return
  }
  await typePreset(p, {})
}
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
async function typePreset(p: TermPreset, answers: Record<string, string>): Promise<void> {
  const id = curId.value ?? (await newShell())
  if (!id) return
  try {
    const { text, empty } = await window.qa.termRender(id, p.cmd, answers)
    // an insert came out empty (no git branch here…) — ask first, the command would be cut
    if (empty.length) {
      emptyAsk.value = { preset: p, id, text, empty }
      return
    }
    await nextTick()
    paneRefs.get(id)?.type(text, p.run)
  } catch (e) {
    runError.value = errText(e)
  }
}
const emptyAsk = ref<{ preset: TermPreset; id: string; text: string; empty: string[] }>()
function emptyGo(run: boolean): void {
  const a = emptyAsk.value
  emptyAsk.value = undefined
  if (a) paneRefs.get(a.id)?.type(a.text, run)
}
async function submitAsk(): Promise<void> {
  const a = asking.value
  if (!a) return
  asking.value = undefined
  await typePreset(a.preset, Object.fromEntries(a.fields.map((f) => [f.label, f.value])))
}
const helpOpen = ref(false)
/** «{{ … }}» as text (a mustache inside a mustache would close it). */
const INS = '{{ … }}'
const VAR_EX = '{{ shortBranch }}'
const VAR_DATE = '{{ date }}'
const insOf = (name: string) => '{{ ' + name + ' }}'
const copied = ref('')
function copyVar(name: string): void {
  void navigator.clipboard.writeText(insOf(name))
  copied.value = name
  setTimeout(() => copied.value === name && (copied.value = ''), 1200)
}
async function setProfile(on: boolean): Promise<void> {
  cfg.value = await window.qa.termSetConfig({ profile: on })
}

// ---------- variables ----------
const values = ref<Record<string, { value?: string; error?: string }>>({})
async function loadValues(): Promise<void> {
  try {
    values.value = await window.qa.termValues(curId.value)
  } catch (e) {
    values.value = {}
    runError.value = errText(e)
  }
}
// their values for the shell in front (its folder, its branch)
watch(
  () => [sideTab.value, curId.value, byId(curId.value)?.info.cwd, byId(curId.value)?.info.branch],
  () => sideTab.value === 'vars' && void loadValues(),
  { immediate: true },
)
const vEdit = ref<TermVar>()
const vNew = ref(false)
const BUILTIN = [...BUILTIN_VARS.map((b) => b.name), 'ask', 'sh']
const vErr = computed(() => {
  const v = vEdit.value
  if (!v) return ''
  if (!VAR_NAME.test(v.name)) return 'Имя — латинские буквы, цифры, _ и $, не с цифры'
  if (cfg.value.vars.some((x) => x.name === v.name && x.id !== v.id)) return 'Такая переменная уже есть'
  return ''
})
function addVar(): void {
  vEdit.value = { id: presetId(), name: '', value: '', js: false }
  vNew.value = true
}
function saveVar(): void {
  const v = vEdit.value
  if (!v || vErr.value) return
  const i = cfg.value.vars.findIndex((x) => x.id === v.id)
  if (i >= 0) cfg.value.vars[i] = { ...v }
  else cfg.value.vars.push({ ...v })
  vEdit.value = undefined
  saveCfg({ vars: cfg.value.vars })
  void loadValues()
}
function removeVar(v: TermVar): void {
  if (!confirm(`Удалить переменную «${v.name}»?`)) return
  cfg.value.vars = cfg.value.vars.filter((x) => x.id !== v.id)
  saveCfg({ vars: cfg.value.vars })
  void loadValues()
}

// ---------- reactions ----------
const wEdit = ref<TermWatch>()
const wNew = ref(false)
const wTest = ref('')
const wErr = computed(() => {
  const w = wEdit.value
  if (!w) return ''
  try {
    return compileWatch(w) ? '' : 'Нужно хотя бы одно слово или регулярка'
  } catch (e) {
    return errText(e)
  }
})
/** The test line against the reaction being edited: what it would catch. */
const wTestHit = computed(() => {
  const w = wEdit.value
  if (!w || !wTest.value || wErr.value) return undefined
  const r = compileWatch(w)!
  const m = new RegExp(r.source, r.flags.replace('g', '')).exec(wTest.value)
  return m ? m[0] || '(пустое совпадение)' : null
})
function addWatch(): void {
  wEdit.value = { id: presetId(), name: '', patterns: '', ignoreCase: true, word: false, color: WATCH_COLORS[cfg.value.watches.length % WATCH_COLORS.length], on: true }
  wNew.value = true
  wTest.value = ''
}
function editWatch(w: TermWatch): void {
  wEdit.value = { ...w }
  wNew.value = false
  wTest.value = ''
}
function saveWatch(): void {
  const w = wEdit.value
  if (!w || wErr.value) return
  if (!w.name.trim()) w.name = w.patterns.split('\n')[0].trim().slice(0, 30)
  const i = cfg.value.watches.findIndex((x) => x.id === w.id)
  if (i >= 0) cfg.value.watches[i] = { ...w }
  else cfg.value.watches.push({ ...w })
  wEdit.value = undefined
  saveCfg({ watches: cfg.value.watches })
}
function toggleWatch(w: TermWatch, on: boolean): void {
  w.on = on
  saveCfg({ watches: cfg.value.watches })
}
function removeWatch(w: TermWatch): void {
  if (!confirm(`Удалить реакцию «${w.name}»?`)) return
  cfg.value.watches = cfg.value.watches.filter((x) => x.id !== w.id)
  saveCfg({ watches: cfg.value.watches })
}
const patternsShort = (w: TermWatch) => w.patterns.split('\n').map((s) => s.trim()).filter(Boolean).join(' · ')

// the side's width
function dragSide(e: PointerEvent): void {
  e.preventDefault()
  const x0 = e.clientX
  const w0 = sideW.value
  const move = (ev: PointerEvent) => (sideW.value = Math.min(480, Math.max(200, w0 + ev.clientX - x0)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="tv2" :style="{ gridTemplateColumns: sideHidden ? 'minmax(0, 1fr)' : `${sideW}px minmax(0, 1fr)` }">
    <!-- presets / variables / reactions -->
    <aside v-if="!sideHidden" class="ps">
      <div class="stabs">
        <button :class="{ on: sideTab === 'presets' }" @click="sideTab = 'presets'">Пресеты</button>
        <button :class="{ on: sideTab === 'vars' }" @click="sideTab = 'vars'">Переменные</button>
        <button :class="{ on: sideTab === 'watch' }" @click="sideTab = 'watch'">Реакции<i v-if="alerts.length" class="sdot" :style="{ background: alerts[0].color }"></i></button>
        <button class="shide" title="Скрыть панель" @click="sideHidden = true"><Icon name="sidebar" :size="14" /></button>
      </div>

      <template v-if="sideTab === 'presets'">
        <div class="psh">
          <span class="cap">Команды</span>
          <span class="grow"></span>
          <button title="Новый пресет" @click="addPreset"><Icon name="plus" :size="14" /></button>
        </div>
        <div ref="listEl" class="plist">
          <div v-for="p in cfg.presets" :key="p.id" class="pr" :class="{ drag: dragId === p.id }">
            <span class="grip" title="Перетащить" @pointerdown="startDrag($event, p.id, 'presets')"><Icon name="grip" :size="12" /></span>
            <button class="prun" :title="p.cmd" @click="runPreset(p)">
              <Icon :name="p.run ? 'play' : 'pencil'" :size="11" class="pi" :class="{ type: !p.run }" />
              <span class="pn">{{ p.name }}</span>
            </button>
            <span class="pacts">
              <button title="Изменить" @click="edit(p)"><Icon name="pencil" :size="11" /></button>
              <button title="Удалить" @click="removePreset(p)"><Icon name="trash" :size="11" /></button>
            </span>
          </div>
          <p v-if="!cfg.presets.length" class="none">Пресетов нет — «+» сверху</p>
        </div>
      </template>

      <template v-else-if="sideTab === 'vars'">
        <div class="psh">
          <span class="cap">Переменные</span>
          <span class="grow"></span>
          <button title="Обновить значения" @click="loadValues"><Icon name="refresh" :size="13" /></button>
          <button title="Новая переменная" @click="addVar"><Icon name="plus" :size="14" /></button>
        </div>
        <div class="vscroll">
          <p class="note top">Значения — для активной оболочки (её папки и ветки). В пресете переменная пишется в двойных фигурных скобках: <code>{{ VAR_EX }}</code>. Клик по строке — скопировать так.</p>
          <div class="vh">Свои</div>
          <div ref="listEl">
            <div v-for="v in cfg.vars" :key="v.id" class="pr var" :class="{ drag: dragId === v.id }">
              <span class="grip" title="Перетащить (порядок важен: переменная видит те, что выше)" @pointerdown="startDrag($event, v.id, 'vars')"><Icon name="grip" :size="12" /></span>
              <button class="prun col" :title="`${v.value}\nКлик — скопировать ${insOf(v.name)}`" @click="copyVar(v.name)">
                <span class="vn"><b>{{ v.name }}</b><em>{{ v.js ? 'формула' : 'текст' }}</em><em v-if="copied === v.name" class="ok">скопировано</em></span>
                <span v-if="values[v.name]?.error" class="vv bad">{{ values[v.name].error }}</span>
                <span v-else class="vv" :class="{ empty: values[v.name]?.value === '' }">{{ values[v.name]?.value === '' ? 'пусто здесь' : (values[v.name]?.value ?? '…') }}</span>
              </button>
              <span class="pacts">
                <button title="Изменить" @click="vEdit = { ...v }; vNew = false"><Icon name="pencil" :size="11" /></button>
                <button title="Удалить" @click="removeVar(v)"><Icon name="trash" :size="11" /></button>
              </span>
            </div>
          </div>
          <p v-if="!cfg.vars.length" class="none">Своих переменных нет — «+» сверху.</p>
          <div class="vh">Встроенные <span>(считаются сами)</span></div>
          <div v-for="b in BUILTIN_VARS" :key="b.name" class="pr var">
            <button class="prun col bi" :title="`${b.desc}\nКлик — скопировать ${insOf(b.name)}`" @click="copyVar(b.name)">
              <span class="vn"><b>{{ b.name }}</b><em v-if="copied === b.name" class="ok">скопировано</em><em v-if="cfg.vars.some((v) => v.name === b.name)" class="warn">заменена своей</em></span>
              <span class="vd">{{ b.desc }}</span>
              <span class="vv" :class="{ empty: values[b.name]?.value === '' }">{{ values[b.name]?.value === '' ? 'пусто здесь' : (values[b.name]?.value ?? '…') }}</span>
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="psh">
          <span class="cap">Реакции на вывод</span>
          <span class="grow"></span>
          <button title="Новая реакция" @click="addWatch"><Icon name="plus" :size="14" /></button>
        </div>
        <div ref="listEl" class="plist">
          <div v-for="w in cfg.watches" :key="w.id" class="pr var" :class="{ drag: dragId === w.id, off: !w.on }">
            <span class="grip" title="Перетащить" @pointerdown="startDrag($event, w.id, 'watches')"><Icon name="grip" :size="12" /></span>
            <i class="wdot" :style="{ background: w.color }"></i>
            <button class="prun col" @click="editWatch(w)">
              <span class="vn"><b>{{ w.name }}</b><em v-if="w.ignoreCase">aA</em><em v-if="w.word">слово</em></span>
              <span class="vv">{{ patternsShort(w) }}</span>
            </button>
            <input type="checkbox" class="won" :checked="w.on" :title="w.on ? 'Включена' : 'Выключена'" @change="toggleWatch(w, ($event.target as HTMLInputElement).checked)" />
            <span class="pacts">
              <button title="Удалить" @click="removeWatch(w)"><Icon name="trash" :size="11" /></button>
            </span>
          </div>
          <p v-if="!cfg.watches.length" class="none">Реакций нет — «+» сверху</p>
        </div>
        <p class="note">Совпадение в выводе любой оболочки — уведомление справа и мигание TERMINAL внизу, пока уведомление не закрыто.</p>
      </template>

      <p v-if="runError" class="perr">{{ runError }}</p>
      <label class="prof" title="Профиль PowerShell (для новых оболочек)"><input type="checkbox" :checked="cfg.profile" @change="setProfile(($event.target as HTMLInputElement).checked)" />Загружать профиль PowerShell</label>
      <button class="howto" @click="helpOpen = true"><Icon name="book" :size="14" />Инструкция</button>
      <span class="sgrip" @pointerdown="dragSide"></span>
    </aside>

    <section class="tm">
      <!-- the reactions' notices -->
      <div v-if="alerts.length || watchError" class="alerts">
        <div v-if="watchError" class="al werr">
          <Icon name="bug" :size="13" />
          <span class="aline">{{ watchError }}</span>
          <button class="alink" @click="sideTab = 'watch'">Реакции</button>
        </div>
        <div v-for="a in alerts" :key="a.id" class="al" :style="{ '--c': a.color }" :title="a.line">
          <i class="abar"></i>
          <span class="atime">{{ hms(a.at) }}</span>
          <button class="aterm" title="Показать эту оболочку" @click="reveal(a.sid)">{{ a.title }}</button>
          <b class="aname">{{ a.name }}</b>
          <span v-if="a.count > 1" class="acount" :title="`Совпадений: ${a.count}, последнее в ${hms(a.last)}`">×{{ a.count }}</span>
          <span class="aline">{{ a.line }}</span>
          <button class="ax" title="Закрыть уведомление" @click="dismiss(a.id)"><Icon name="x" :size="12" /></button>
        </div>
        <button v-if="alerts.length > 1" class="aall" @click="dismiss()">Закрыть все ({{ alerts.length }})</button>
      </div>

      <!-- one or two panes, each with its tabs -->
      <div ref="panesEl" class="npanes">
        <template v-for="(p, pi) in termLayout.panes" :key="p.id">
          <div v-if="pi" class="psplit" title="Потяните — ширина" @pointerdown.prevent="onSplitResize"></div>
          <section
            class="pane"
            :class="{ cur: termLayout.cur === pi && termLayout.panes.length > 1 }"
            :style="{ flex: termLayout.panes.length > 1 ? `${pi ? 1 - termLayout.split : termLayout.split} 1 0` : '1 1 0' }"
            @pointerdown.capture="termLayout.cur = pi"
          >
            <div class="tbar">
              <button v-if="sideHidden && pi === 0" class="tb" title="Показать панель" @click="sideHidden = false"><Icon name="sidebar" :size="14" /></button>
              <div class="tscroll">
                <TransitionGroup tag="div" name="tabmv" class="tlist">
                  <div
                    v-for="id in p.tabs"
                    :key="id"
                    class="tab"
                    :class="{ on: p.active === id, dragging: tabDrag?.id === id, dead: byId(id)?.exited !== undefined }"
                    :data-id="id"
                    @pointerdown="onTabDown($event, pi, id)"
                    @click="onTabClick(pi, id)"
                    @dblclick="renaming = id"
                    @mousedown.middle.prevent="closeShell(id)"
                  >
                    <i class="led" :class="ledOf(id).cls" :style="ledOf(id).style"></i>
                    <input v-if="renaming === id" v-focus class="ren" :value="byId(id)?.title" @click.stop @keydown.enter="($event.target as HTMLInputElement).blur()" @blur="rename(id, ($event.target as HTMLInputElement).value)" />
                    <span v-else class="tname">{{ byId(id)?.title }}</span>
                    <button class="tx" title="Закрыть оболочку (средняя кнопка мыши)" @click.stop="closeShell(id)"><Icon name="x" :size="11" /></button>
                  </div>
                </TransitionGroup>
                <button class="tnew" title="Новая оболочка" @click="newShell(pi)"><Icon name="plus" :size="13" /></button>
              </div>
              <button class="tb" :class="{ on: termLayout.panes.length > 1 }" :title="termLayout.panes.length > 1 ? 'Одна колонка (вкладки соберутся слева)' : 'Разделить: вторая колонка со своими вкладками'" @click="toggleSplit">
                <Icon name="columns" :size="14" />
              </button>
              <ZoomChip v-if="pi === termLayout.panes.length - 1" v-model="zoom" :min="60" :max="220" title="Масштаб терминала · колесо, Ctrl+колесо над терминалом · клик — 100%" />
            </div>
            <div class="pbody">
              <template v-for="id in p.tabs" :key="id">
                <TermPane
                  v-if="byId(id)"
                  v-show="p.active === id"
                  :ref="(el) => (el ? paneRefs.set(id, el as InstanceType<typeof TermPane>) : paneRefs.delete(id))"
                  :session="byId(id)!"
                  :font-size="fontSize"
                  :active="p.active === id && termLayout.cur === pi"
                  @focus="termLayout.cur = pi"
                  @zoom="(d) => (zoom = Math.min(220, Math.max(60, zoom + d * 10)))"
                />
              </template>
              <div v-if="!p.tabs.length" class="nopane" @click="newShell(pi)"><Icon name="plus" :size="16" />Новая оболочка</div>
            </div>
            <template v-if="tabDrag">
              <template v-if="termLayout.panes.length === 1">
                <template v-if="p.tabs.length > 1">
                  <div class="dz l" :class="{ hot: zone?.side === 'left' }"><span>Разделить влево</span></div>
                  <div class="dz r" :class="{ hot: zone?.side === 'right' }"><span>Разделить вправо</span></div>
                </template>
              </template>
              <div v-else-if="tabDrag.pane !== pi" class="dz all" :class="{ hot: zone?.pane === pi }"><span>Перенести сюда</span></div>
            </template>
          </section>
        </template>
      </div>
    </section>

    <Teleport to="body">
      <!-- the dragged tab follows the pointer -->
      <div v-if="tabDrag" class="tghost" :style="{ left: tabDrag.x + 12 + 'px', top: tabDrag.y + 10 + 'px' }">{{ dragTitle }}</div>
      <!-- an insert came out empty -->
      <div v-if="emptyAsk" class="tq-back" @mousedown.self="emptyAsk = undefined">
        <div class="tq wide" tabindex="-1" @keydown.esc="emptyAsk = undefined">
          <div class="cap">{{ emptyAsk.preset.name }} — пустая подстановка</div>
          <p class="etext">
            Здесь пусто: <template v-for="(x, i) in emptyAsk.empty" :key="i"><code>{{ insOf(x) }}</code>{{ i < emptyAsk.empty.length - 1 ? ', ' : '' }}</template>.
            Например, в этой папке нет ветки git или в названии ветки нет ключа задачи.
          </p>
          <div class="tqf">Команда получится такой<pre class="epre">{{ emptyAsk.text || '(пустая строка)' }}</pre></div>
          <div class="tqb">
            <button class="primary" @click="emptyGo(false)">Вписать — допишу сам</button>
            <button @click="emptyGo(true)">Выполнить как есть</button>
            <button @click="emptyAsk = undefined">Отмена</button>
          </div>
        </div>
      </div>
      <!-- a preset's questions -->
      <div v-if="asking" class="tq-back" @mousedown.self="asking = undefined">
        <form class="tq" @submit.prevent="submitAsk" @keydown.esc="asking = undefined">
          <div class="cap">{{ asking.preset.name }}</div>
          <label v-for="(f, i) in asking.fields" :key="f.label" class="tqf">{{ f.label }}<input v-model="f.value" :autofocus="i === 0" spellcheck="false" /></label>
          <div class="tqb"><button type="submit" class="primary">{{ asking.preset.run ? 'Выполнить' : 'Вставить' }}</button><button type="button" @click="asking = undefined">Отмена</button></div>
        </form>
      </div>
      <!-- a preset -->
      <div v-if="editing" class="tq-back" @mousedown.self="editing = undefined">
        <form class="tq wide" @submit.prevent="saveEdit" @keydown.esc="editing = undefined">
          <div class="cap">{{ isNew ? 'Новый пресет' : 'Пресет' }}</div>
          <label class="tqf">Название<input v-model="editing.name" spellcheck="false" placeholder="Коммит с задачей" /></label>
          <label class="tqf">Команда<textarea v-model="editing.cmd" rows="4" spellcheck="false" placeholder="git commit -m &quot;[{{ task }}] &quot;"></textarea></label>
          <label class="tqc"><input v-model="editing.run" type="checkbox" />Сразу выполнить (иначе — только вписать, чтобы дописать руками)</label>
          <p class="hint">{{ INS }} — JavaScript: currentBranch, task, cwd, dir, date, свои переменные, ask('Вопрос'), sh('команда')… — подробно в «Инструкции».</p>
          <div class="tqb"><button type="submit" class="primary" :disabled="!editing.cmd.trim()">Сохранить</button><button type="button" @click="editing = undefined">Отмена</button></div>
        </form>
      </div>
      <!-- a variable -->
      <div v-if="vEdit" class="tq-back" @mousedown.self="vEdit = undefined">
        <form class="tq wide" @submit.prevent="saveVar" @keydown.esc="vEdit = undefined">
          <div class="cap">{{ vNew ? 'Новая переменная' : 'Переменная' }}</div>
          <label class="tqf">Имя (в пресетах — {{ INS }} с ним)<input v-model.trim="vEdit.name" v-focus spellcheck="false" placeholder="mainBranch" /></label>
          <div class="seg2">
            <button type="button" :class="{ on: !vEdit.js }" @click="vEdit.js = false">Текст</button>
            <button type="button" :class="{ on: vEdit.js }" @click="vEdit.js = true">Формула (JavaScript)</button>
          </div>
          <label class="tqf">
            Значение
            <textarea v-model="vEdit.value" rows="3" spellcheck="false" :placeholder="vEdit.js ? 'currentBranch.split(\'/\').pop()' : 'main'"></textarea>
          </label>
          <p class="hint">
            <template v-if="vEdit.js">Формула считается заново при каждом нажатии пресета. В ней можно брать встроенные переменные и свои, что выше в списке. Пример: <code>currentBranch.split('/').pop()</code> — из ветки feature/ABC-123 даст ABC-123.</template>
            <template v-else>Значение подставится как есть. Пример: <code>main</code>. Внутри можно и подстановки: <code>release/{{ VAR_DATE }}</code>.</template>
            <template v-if="BUILTIN.includes(vEdit.name)"> Внимание: имя совпадает со встроенной переменной — своя её заменит.</template>
          </p>
          <p v-if="vErr && vEdit.name" class="perr in">{{ vErr }}</p>
          <div class="tqb"><button type="submit" class="primary" :disabled="!!vErr">Сохранить</button><button type="button" @click="vEdit = undefined">Отмена</button></div>
        </form>
      </div>
      <!-- a reaction -->
      <div v-if="wEdit" class="tq-back" @mousedown.self="wEdit = undefined">
        <form class="tq wide" @submit.prevent="saveWatch" @keydown.esc="wEdit = undefined">
          <div class="cap">{{ wNew ? 'Новая реакция' : 'Реакция' }}</div>
          <label class="tqf">Название<input v-model="wEdit.name" spellcheck="false" placeholder="Ошибки" /></label>
          <label class="tqf">
            Слова — по одному в строке; регулярка — /…/
            <textarea v-model="wEdit.patterns" rows="4" spellcheck="false" placeholder="error&#10;failed&#10;/\bE\d{3,}\b/"></textarea>
          </label>
          <div class="wopts">
            <label class="tqc"><input v-model="wEdit.ignoreCase" type="checkbox" />Без учёта регистра</label>
            <label class="tqc"><input v-model="wEdit.word" type="checkbox" />Только слово целиком</label>
          </div>
          <div class="tqf">
            Цвет (им мигает TERMINAL внизу)
            <div class="sw">
              <button v-for="c in WATCH_COLORS" :key="c" type="button" :class="{ on: wEdit.color === c }" :style="{ background: c }" :title="c" @click="wEdit.color = c"></button>
              <input v-model="wEdit.color" type="color" title="Свой цвет" />
            </div>
          </div>
          <label class="tqf">
            Проверить на строке
            <input v-model="wTest" spellcheck="false" placeholder="npm ERR! code ELIFECYCLE" />
          </label>
          <p v-if="wErr" class="perr in">{{ wErr }}</p>
          <p v-else-if="wTestHit !== undefined" class="hint" :class="wTestHit ? 'ok' : ''">{{ wTestHit ? `Сработает: «${wTestHit}»` : 'Не сработает' }}</p>
          <div class="tqb"><button type="submit" class="primary" :disabled="!!wErr">Сохранить</button><button type="button" @click="wEdit = undefined">Отмена</button></div>
        </form>
      </div>
      <div v-if="helpOpen" class="tq-back" @mousedown.self="helpOpen = false">
        <div class="tq help" tabindex="-1" @keydown.esc="helpOpen = false">
          <div class="hh"><span class="cap">Инструкция · Терминал</span><button class="ib" @click="helpOpen = false"><Icon name="x" :size="14" /></button></div>
          <div class="hb"><Markdown :text="TERM_HELP" /></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tv2 {
  display: grid;
  height: 100%;
  min-height: 0;
}
.grow {
  flex: 1;
}
/* ---------- the side ---------- */
.ps {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
}
.stabs {
  display: flex;
  flex: none;
  height: 38px;
  border-bottom: 1px solid var(--border);
}
.stabs .shide {
  flex: none;
  width: 34px;
}
.stabs button {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 0 4px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stabs button:hover {
  color: var(--text);
}
.stabs button.on {
  color: var(--text-hi);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.sdot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  vertical-align: middle;
  animation: tv-blink 0.36s steps(2) infinite;
}
.psh {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 6px 0 12px;
}
.psh button {
  display: inline-flex;
  padding: 5px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.psh button:hover {
  color: var(--accent-fg);
}
.plist {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0 4px;
}
.pr {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 0 4px 0 2px;
}
.pr.var {
  min-height: 42px;
}
.pr:hover {
  background: var(--hover);
}
.pr.drag {
  background: var(--accent-soft);
  outline: 1px solid var(--accent);
}
.pr.off {
  opacity: 0.5;
}
.grip {
  display: inline-flex;
  padding: 4px 3px;
  color: var(--dim);
  cursor: grab;
  touch-action: none;
}
.prun {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  align-self: stretch;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.prun.col {
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 2px;
}
.prun:hover .pn,
.prun:hover .vn b {
  color: var(--accent-fg);
}
.pi {
  flex: none;
  color: var(--up-fg);
}
.pi.type {
  color: var(--warn-fg);
}
.pn,
.vv {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vn {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.vn b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-data);
  font-weight: 600;
  font-size: 12px;
}
.vn em {
  flex: none;
  padding: 0 4px;
  border-radius: var(--r1);
  background: var(--panel-3);
  color: var(--muted);
  font-size: 10px;
  font-style: normal;
}
.vv {
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11px;
}
.vv.bad {
  color: var(--down-fg);
}
.vscroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}
.vh {
  padding: 10px 12px 4px;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.vh span {
  text-transform: none;
  letter-spacing: 0;
}
.prun.bi {
  padding: 6px 4px 6px 22px;
}
.vd {
  color: var(--muted);
  font-size: 11px;
  white-space: normal;
}
.vv.empty {
  color: var(--warn-fg);
  font-style: italic;
}
.vn em.ok {
  background: rgba(0, 230, 118, 0.14);
  color: var(--up-fg);
}
.vn em.warn {
  background: rgba(255, 183, 77, 0.14);
  color: var(--warn-fg);
}
.note.top {
  margin: 0 12px 4px;
}
.ps code,
.tq code {
  padding: 0 4px;
  border-radius: var(--r1);
  background: var(--panel-3);
  font-family: var(--font-data);
  font-size: 11px;
}
.etext {
  margin: 0;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.5;
}
.epre {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--bg);
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 12.5px;
  white-space: pre-wrap;
}
.wdot {
  flex: none;
  width: 8px;
  height: 8px;
  margin: 0 2px 0 3px;
  border-radius: 2px;
}
.won {
  flex: none;
  margin: 0 4px;
}
.pacts {
  display: none;
}
.pr:hover .pacts {
  display: inline-flex;
}
.pacts button {
  display: inline-flex;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.pacts button:hover {
  color: var(--text-hi);
}
.none,
.note {
  margin: 10px 12px;
  color: var(--muted);
  font-size: 11.5px;
}
.note {
  flex: none;
  margin-top: 4px;
}
.perr {
  margin: 6px 10px;
  color: var(--down-fg);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.perr.in {
  margin: 0;
}
.prof {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 6px 10px 0;
  color: var(--text-2);
  font-size: 12px;
}
.howto {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px;
  padding: 8px 10px;
  border: 1px dashed var(--border-3);
  border-radius: var(--r3);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 12px;
  text-align: left;
}
.howto:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.sgrip {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  z-index: 3;
  width: 6px;
  cursor: col-resize;
}
.sgrip:hover {
  background: var(--accent-line);
}
/* ---------- the shells ---------- */
.tm {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.alerts {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.al {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 4px 0 0;
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--c, var(--down)) 12%, transparent);
  font-size: 12px;
  white-space: nowrap;
}
.abar {
  flex: none;
  align-self: stretch;
  width: 4px;
  border-radius: var(--r2) 0 0 var(--r2);
  background: var(--c);
  animation: tv-blink 0.36s steps(2) infinite;
}
.atime {
  flex: none;
  color: var(--text-2);
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
.aterm,
.alink {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--border-2);
  border-radius: var(--r1);
  background: var(--panel-2);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 11px;
}
.aterm:hover,
.alink:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.aname {
  flex: none;
  color: var(--c);
  font-weight: 600;
}
.acount {
  flex: none;
  color: var(--text-2);
  font-family: var(--font-data);
}
.aline {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.ax {
  flex: none;
  display: inline-flex;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.ax:hover {
  color: var(--text-hi);
}
.al.werr {
  padding-left: 8px;
  background: rgba(255, 61, 61, 0.12);
  color: var(--down-fg);
}
.al.werr .aline {
  color: var(--down-fg);
  white-space: normal;
}
.aall {
  align-self: flex-end;
  padding: 2px 8px;
  font-size: 11.5px;
}
.npanes {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}
.pane {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pane.cur::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: rgb(var(--accent-rgb) / 0.8);
  pointer-events: none;
}
.psplit {
  flex: none;
  width: 5px;
  margin: 0 -2px;
  padding: 0 2px;
  background: var(--border);
  background-clip: content-box;
  cursor: col-resize;
  z-index: 2;
  transition: background-color 0.12s;
}
.psplit:hover {
  background-color: rgb(var(--accent-rgb) / 0.85);
}
.tbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 38px;
  padding: 0 8px 0 4px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.tscroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  align-self: stretch;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tlist {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}
.tabmv-move {
  transition: transform 0.16s ease;
}
.tab {
  flex: 0 1 170px;
  min-width: 90px;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 31px;
  padding: 0 6px 0 10px;
  border-radius: 4px 4px 0 0;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
  cursor: pointer;
  user-select: none;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}
.tab.on {
  background: var(--panel);
  color: var(--text-hi);
  box-shadow: inset 0 2px 0 var(--accent);
}
.tab.dragging {
  opacity: 0.45;
}
.tab.dead {
  opacity: 0.55;
}
.tname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx {
  flex: none;
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: var(--r2);
  background: none;
  color: var(--muted);
  opacity: 0;
}
.tab:hover .tx,
.tab.on .tx {
  opacity: 1;
}
.tx:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--down-fg);
}
.tnew {
  flex: none;
  align-self: flex-end;
  margin-bottom: 4px;
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: var(--r2);
  background: none;
  color: var(--muted);
}
.tnew:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.tb {
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
.tb:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.tb.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--accent-fg);
}
.tb:disabled {
  opacity: 0.35;
}
.led {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dim);
}
.led.run {
  background: var(--up);
  animation: tv-blink 1s steps(2) infinite;
}
.led.err {
  background: var(--down);
}
.led.alert {
  animation: tv-blink 0.36s steps(2) infinite;
}
@keyframes tv-blink {
  50% {
    opacity: 0.25;
  }
}
.ren {
  width: 100px;
  height: 20px;
  padding: 0 4px;
  font-size: 11.5px;
}
.pbody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px;
}
.pbody > .tp {
  flex: 1;
}
.nopane {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--border-2);
  border-radius: var(--r3);
  color: var(--muted);
  font-size: 12.5px;
  cursor: default;
}
.nopane:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.dz {
  position: absolute;
  top: 38px;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed transparent;
  border-radius: 4px;
  color: transparent;
  font-size: 13px;
  transition: background 0.12s, border-color 0.12s;
}
.dz.l {
  left: 0;
  width: 30%;
}
.dz.r {
  right: 0;
  width: 30%;
}
.dz.all {
  left: 0;
  right: 0;
}
.dz {
  pointer-events: none;
}
.tlist {
  position: relative;
}
.tab.dragging {
  background: rgb(var(--accent-rgb) / 0.16);
  opacity: 1;
}
.tghost {
  position: fixed;
  z-index: 3000;
  padding: 4px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--r2);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 11.5px;
  pointer-events: none;
}
.dz.hot {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--accent-fg);
}
/* ---------- the dialogs ---------- */
.tq-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.55);
}
.tq {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(440px, calc(100vw - 32px));
  padding: 14px 16px 16px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: var(--shadow), inset 0 2px 0 var(--accent);
}
.tq.wide {
  width: min(620px, calc(100vw - 32px));
}
.tq.help {
  width: min(820px, calc(100vw - 32px));
  max-height: 84vh;
  padding: 0;
  gap: 0;
}
.hh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.hb {
  overflow: auto;
  padding: 6px 20px 20px;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-2);
}
.tqf {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-2);
  font-size: 12px;
}
.tqf input,
.tqf textarea {
  font-family: var(--font-data);
  font-size: 12.5px;
}
.tqf textarea {
  resize: vertical;
}
.tqc {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 12.5px;
}
.tqb {
  display: flex;
  gap: 8px;
}
.hint {
  margin: 0;
  color: var(--muted);
  font-size: 11.5px;
}
.hint.ok {
  color: var(--up-fg);
}
.seg2 {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg2 button {
  padding: 4px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.seg2 button.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--accent-fg);
}
.wopts {
  display: flex;
  gap: 18px;
}
.sw {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sw button {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 3px;
}
.sw button.on {
  box-shadow: 0 0 0 2px var(--panel), 0 0 0 3.5px var(--text-hi);
}
.sw input[type='color'] {
  width: 28px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
}
</style>
