<script setup lang="ts">
import McpSettings from '../components/McpSettings.vue'
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import type { KindDef, PublicSettings, SettingsPatch, UiPrefs, VoiceState } from '@shared/types'
import { DEFAULT_UI } from '@shared/ui'
import { isProductive } from '@shared/kinds'
import Icon, { KIND_ICONS } from '../components/Icon.vue'
import { projectKeys } from '@shared/jira'
import { WHISPER_MODELS } from '@shared/voice'
import { useJira } from '../lib/jira'
import { useOutlook } from '../lib/outlook'
import TabletView from './TabletView.vue'
import { ACCENTS, DEFAULT_THEME } from '@shared/theme'
import { orderedViews, VIEWS } from '../lib/views'
import { startListDrag } from '../lib/listDrag'
import { onBrowserEvent } from '../lib/browser'
import { DEFAULT_BROWSER_SETTINGS, UA_PRESETS, type BrowserSettings } from '@shared/browser'

const props = defineProps<{ settings: PublicSettings }>()
const emit = defineEmits<{ changed: [s: PublicSettings] }>()

const DAYS = [
  { id: 1, label: 'Пн' },
  { id: 2, label: 'Вт' },
  { id: 3, label: 'Ср' },
  { id: 4, label: 'Чт' },
  { id: 5, label: 'Пт' },
  { id: 6, label: 'Сб' },
  { id: 0, label: 'Вс' },
]

const f = reactive({
  schedule: { ...props.settings.schedule },
  // every kind gets an explicit productive flag in the form (break/lunch default to false)
  kinds: props.settings.kinds.map((k) => ({ ...k, productive: isProductive(props.settings.kinds, k.id) })) as KindDef[],
  captureTitles: props.settings.captureTitles,
  countKeys: props.settings.countKeys,
  pillOpacity: Math.round((props.settings.island.opacity ?? 1) * 100),
  jiraClientId: props.settings.jira.clientId ?? '',
  jiraProjects: props.settings.jira.projects.join(', '),
  jiraSecret: '',
  voiceEnabled: props.settings.voice.enabled,
  autoTranscribe: props.settings.voice.autoTranscribe,
  voiceModel: props.settings.voice.model,
  micId: props.settings.voice.micId ?? '',
  jiraSyncMin: props.settings.jira.syncMin ?? 10,
  idleMin: Math.round(props.settings.idleThresholdSec / 60),
  sampleSec: props.settings.sampleIntervalMs / 1000,
  autoStart: props.settings.autoStart,
})

/** Settings are split into sections (like System Settings): a sidebar, or tabs on top in a narrow window. */
type Cat = 'general' | 'kinds' | 'look' | 'ui' | 'voice' | 'tablet' | 'outlook' | 'jira' | 'browser' | 'ai'
const CATS: Array<{ id: Cat; icon: string; label: string }> = [
  { id: 'general', icon: 'clock', label: 'Основное' },
  { id: 'kinds', icon: 'tag', label: 'Виды занятости' },
  { id: 'look', icon: 'palette', label: 'Оформление' },
  { id: 'ui', icon: 'layers', label: 'Интерфейс' },
  { id: 'voice', icon: 'mic', label: 'Голос' },
  { id: 'tablet', icon: 'penTool', label: 'Планшет' },
  { id: 'outlook', icon: 'calendar', label: 'Outlook и Teams' },
  { id: 'jira', icon: 'jira', label: 'Jira' },
  { id: 'browser', icon: 'browser', label: 'Браузер' },
  { id: 'ai', icon: 'sparkles', label: 'AI-ассистенты' },
]
const cat = ref<Cat>(readCat())
// ---------- the browser ----------
const brSet = ref<BrowserSettings>({ ...DEFAULT_BROWSER_SETTINGS })
const uaDefault = ref('')
/** The User-Agent being typed (one's own). */
const uaOwn = ref<string>()
void window.qa.browser('settings').then((v) => (brSet.value = v))
void window.qa.browser('defaultUa').then((v) => (uaDefault.value = v))
onBrowserEvent((type, p) => type === 'settings' && (brSet.value = p as BrowserSettings))
async function brPatch(patch: Partial<BrowserSettings>): Promise<void> {
  brSet.value = await window.qa.browser('setSettings', patch)
}
const uaPick = computed(() => {
  if (uaOwn.value !== undefined) return 'own'
  const i = UA_PRESETS.findIndex((p) => p.ua === brSet.value.ua)
  return i < 0 ? 'own' : String(i)
})
const uaShown = computed(() => uaOwn.value ?? (brSet.value.ua || uaDefault.value))
function onUaPick(v: string): void {
  if (v === 'own') {
    uaOwn.value = brSet.value.ua || uaDefault.value
    return
  }
  uaOwn.value = undefined
  void brPatch({ ua: UA_PRESETS[Number(v)]?.ua ?? '' })
}
function applyUa(): void {
  const v = (uaOwn.value ?? '').replace(/\s+/g, ' ').trim()
  // the built-in one typed back — it is the built-in one
  void brPatch({ ua: v === uaDefault.value ? '' : v })
  if (!v) uaOwn.value = undefined
}
function readCat(): Cat {
  try {
    const v = localStorage.getItem('qa.settingsCat')
    return CATS.some((c) => c.id === v) ? (v as Cat) : 'general'
  } catch {
    return 'general'
  }
}
watch(cat, (v) => {
  try {
    localStorage.setItem('qa.settingsCat', v)
  } catch {
    // not remembered — fine
  }
})

/** What the interface shows — applied at once, every window follows. */
const ui = reactive<UiPrefs>(JSON.parse(JSON.stringify(props.settings.ui)) as UiPrefs)
const UI_PILL: Array<{ k: keyof UiPrefs['pill']; label: string; hint?: string }> = [
  { k: 'app', label: 'Приложение / созвон', hint: 'Имя активного приложения или созвона рядом со статусом' },
  { k: 'date', label: 'Дата' },
  { k: 'combo', label: 'Комбо клавиш' },
  { k: 'wave', label: 'Волна активности' },
  { k: 'chips', label: 'Плашки блоков и заметок', hint: 'Вторая строка' },
  { k: 'stats', label: 'Итоги по видам и задачам', hint: 'Третья строка' },
  { k: 'plan', label: 'Плашки из плана дня', hint: 'Запланированные блоки' },
]
const UI_DOCK: Array<{ k: keyof UiPrefs['dock']; label: string }> = [
  { k: 'orb', label: 'Шар (быстрая заметка)' },
  { k: 'time', label: 'Время за день' },
  { k: 'next', label: 'До встречи Outlook' },
  { k: 'wave', label: 'Волна активности' },
]
const UI_ISLAND: Array<{ k: keyof UiPrefs['island']; label: string }> = [
  { k: 'date', label: 'Дата' },
  { k: 'wave', label: 'Волна активности' },
  { k: 'totals', label: 'Итоги под шкалой' },
  { k: 'plan', label: 'Плашки из плана дня' },
]
const UI_MAIN: Array<{ k: keyof UiPrefs['main']; label: string; hint?: string }> = [
  { k: 'allStats', label: 'Все показатели дня сразу', hint: 'Иначе — основные' },
  { k: 'plan', label: 'Кнопка «План дня»' },
]
async function applyUi(): Promise<void> {
  const s = await window.qa.updateSettings({ ui: JSON.parse(JSON.stringify(ui)) as UiPrefs })
  emit('changed', s)
}
/** Presets: everything, or only what is needed day to day. */
async function uiPreset(p: 'full' | 'minimal'): Promise<void> {
  const next: UiPrefs =
    p === 'full'
      ? { ...DEFAULT_UI, main: { ...DEFAULT_UI.main, allStats: true }, timeline: { ...ui.timeline }, theme: ui.theme, menu: ui.menu }
      : {
          pill: { app: true, date: false, combo: false, wave: false, chips: true, stats: false, dayBar: true, plan: false },
          dock: { orb: true, time: true, next: true, wave: false },
          island: { date: false, wave: false, totals: true, plan: false },
          main: { allStats: false, plan: true },
          timeline: { ...ui.timeline },
          theme: ui.theme,
          menu: ui.menu,
        }
  Object.assign(ui.pill, next.pill)
  if (next.dock) Object.assign(ui.dock, next.dock)
  Object.assign(ui.island, next.island)
  Object.assign(ui.main, next.main)
  await applyUi()
}

// ---------- the look ----------
const CONTRASTS: Array<{ id: UiPrefs['theme']['contrast']; label: string }> = [
  { id: 'soft', label: 'Мягкий' },
  { id: 'normal', label: 'Обычный' },
  { id: 'high', label: 'Высокий' },
]
function setTheme(p: Partial<UiPrefs['theme']>): void {
  Object.assign(ui.theme, p)
  void applyUi()
}

// ---------- the menu: order by dragging, hide with the eye ----------
const menuViews = computed(() => orderedViews(ui.menu))
const isHidden = (id: string) => ui.menu.hidden.includes(id)
function toggleHidden(id: string): void {
  const h = new Set(ui.menu.hidden)
  if (h.has(id)) h.delete(id)
  else if (VIEWS.length - h.size > 1) h.add(id) // at least one section stays
  ui.menu.hidden = [...h]
  void applyUi()
}
const mlist = ref<HTMLElement>()
const dragId = ref<string>()
function startDrag(e: PointerEvent, id: string): void {
  const list = mlist.value?.firstElementChild as HTMLElement | null
  if (!list) return
  dragId.value = id
  startListDrag(e, {
    list,
    index: menuViews.value.findIndex((v) => v.id === id),
    move: (from, to) => {
      const ids = menuViews.value.map((v) => v.id as string)
      const [x] = ids.splice(from, 1)
      ids.splice(to, 0, x)
      ui.menu.order = ids
    },
    done: () => {
      dragId.value = undefined
      void applyUi()
    },
  })
}

// ---------- kinds: the same dragging ----------
const klist = ref<HTMLElement>()
const kDrag = ref<string>()
function startKindDrag(e: PointerEvent, id: string): void {
  if (!klist.value) return
  kDrag.value = id
  startListDrag(e, {
    list: klist.value,
    index: f.kinds.findIndex((k) => k.id === id),
    move: (from, to) => {
      const list = [...f.kinds]
      const [x] = list.splice(from, 1)
      list.splice(to, 0, x)
      f.kinds = list
    },
    // the new order is kept at once (like the menu)
    done: () => {
      kDrag.value = undefined
      void save()
    },
  })
}
function resetMenu(): void {
  ui.menu.order = []
  ui.menu.hidden = []
  void applyUi()
}

const saved = ref(false)
const jira = useJira()
const voice = shallowRef<VoiceState>({ modelReady: false, model: 'small', models: [], busy: [] })
void window.qa.voiceState().then((s) => (voice.value = s))
const offVoice = window.qa.onVoice((s) => (voice.value = s))
onBeforeUnmount(offVoice)
const voiceErr = ref('')
/** Speech settings apply at once (no "Сохранить" needed). */
async function applyVoice(): Promise<void> {
  const s = await window.qa.updateSettings({ voice: { enabled: f.voiceEnabled, autoTranscribe: f.autoTranscribe, model: f.voiceModel, micId: f.micId } })
  emit('changed', s)
}
/** The microphones (their names show once access to the mic was given — asked here once). */
const mics = ref<Array<{ id: string; label: string }>>([])
async function loadMics(ask = false): Promise<void> {
  try {
    let list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    if (ask && list.length && list.every((d) => !d.label)) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    }
    mics.value = list
      .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Микрофон ${i + 1}` }))
  } catch {
    mics.value = []
  }
}
watch(cat, (c) => c === 'voice' && void loadMics(true), { immediate: true })
const onDevices = () => void loadMics()
navigator.mediaDevices?.addEventListener('devicechange', onDevices)
onBeforeUnmount(() => navigator.mediaDevices?.removeEventListener('devicechange', onDevices))
/** The picked one is not connected now (recording falls back to the default). */
const micMissing = computed(() => !!f.micId && mics.value.length > 0 && !mics.value.some((m) => m.id === f.micId))
async function applyJiraEvery(): Promise<void> {
  const s = await window.qa.updateSettings({ jira: { syncMin: f.jiraSyncMin } })
  emit('changed', s)
}
async function downloadModel(id: string): Promise<void> {
  voiceErr.value = ''
  try {
    await window.qa.voiceDownloadModel(id)
  } catch (e) {
    voiceErr.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  }
}
async function deleteModel(id: string, label: string): Promise<void> {
  if (confirm(`Удалить модель ${label}? Её можно будет скачать снова.`)) await window.qa.voiceDeleteModel(id)
}
const isReady = (id: string) => voice.value.models.find((m) => m.id === id)?.ready ?? false
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} ГБ` : `${Math.round(b / 1e6)} МБ`)
// ---------- Outlook / Teams ----------
const ol = useOutlook()
const olForm = reactive({ ...props.settings.outlook })
const olBusy = ref(false)
const olError = ref('')
/** Outlook settings apply at once (no "Сохранить" needed). */
async function applyOutlook(): Promise<void> {
  const s = await window.qa.updateSettings({ outlook: JSON.parse(JSON.stringify({ ...olForm, clientId: olForm.clientId?.trim() || undefined, tenantId: olForm.tenantId?.trim() || undefined })) })
  emit('changed', s)
}
async function outlookLogin(): Promise<void> {
  olError.value = ''
  olBusy.value = true
  try {
    await applyOutlook()
    await window.qa.outlookLogin()
  } catch (e) {
    olError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  } finally {
    olBusy.value = false
  }
}
const PRESENCE: Record<string, string> = {
  Available: 'В сети',
  Busy: 'Занят',
  DoNotDisturb: 'Не беспокоить',
  BeRightBack: 'Скоро вернусь',
  Away: 'Нет на месте',
  Offline: 'Не в сети',
  InACall: 'В звонке',
  InAConferenceCall: 'В конференции',
  InAMeeting: 'На собрании (по календарю)',
  Presenting: 'Демонстрирует экран',
}
const olSync = () => void window.qa.outlookSync()
const olLogout = () => void window.qa.outlookLogout()
const olSynced = computed(() => (ol.value.syncedAt ? new Date(ol.value.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'))

const jiraBusy = ref(false)
const jiraError = ref('')
const jiraSync = () => void window.qa.jiraSync()
const jiraLogout = () => void window.qa.jiraLogout()
/** Save the form (client id / secret / projects), then sign in in the browser. */
async function jiraLogin(): Promise<void> {
  jiraError.value = ''
  jiraBusy.value = true
  try {
    await save()
    await window.qa.jiraLogin()
  } catch (e) {
    jiraError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  } finally {
    jiraBusy.value = false
  }
}
const saveError = ref('')



/** The pill's opacity is applied as soon as the slider is released — to see it right away. */
async function applyOpacity(): Promise<void> {
  const s = await window.qa.updateSettings({ island: { opacity: f.pillOpacity / 100 } })
  emit('changed', s)
}

async function save(): Promise<void> {
  const patch: SettingsPatch = {
    schedule: { ...f.schedule },
    kinds: f.kinds.filter((k) => k.label.trim()).map((k) => ({ ...k, label: k.label.trim() })),
    idleThresholdSec: Math.max(1, f.idleMin) * 60,
    sampleIntervalMs: Math.max(1, f.sampleSec) * 1000,
    autoStart: f.autoStart,
    captureTitles: f.captureTitles,
    countKeys: f.countKeys,
    island: { opacity: f.pillOpacity / 100 },
    jira: { clientId: f.jiraClientId.trim() || undefined, projects: projectKeys(f.jiraProjects), syncMin: f.jiraSyncMin },
    voice: { enabled: f.voiceEnabled, autoTranscribe: f.autoTranscribe, model: f.voiceModel, micId: f.micId },
  }
  try {
    // the form is reactive: nested arrays (work days) are proxies, which IPC cannot clone — send plain data
    const s = await window.qa.updateSettings(JSON.parse(JSON.stringify(patch)) as SettingsPatch)
    // the secret goes to the encrypted store, never into settings.json
    if (f.jiraSecret.trim()) {
      await window.qa.jiraSetSecret(f.jiraSecret)
      f.jiraSecret = ''
    }
    emit('changed', s)
    saveError.value = ''
    saved.value = true
    setTimeout(() => (saved.value = false), 2000)
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}


const PALETTE = ['#6366f1', '#14b8a6', '#0ea5e9', '#f59e0b', '#f97316', '#ec4899', '#22c55e', '#a855f7', '#ef4444', '#94a3b8']
const iconPicker = ref<string>()

function addKind(): void {
  const id = `k${Date.now().toString(36)}`
  f.kinds.push({ id, label: '', color: PALETTE[f.kinds.length % PALETTE.length], icon: 'tag', productive: true })
}

function removeKind(id: string): void {
  if (f.kinds.length <= 1) return
  f.kinds = f.kinds.filter((k) => k.id !== id)
}

function toggleDay(id: number): void {
  const set = new Set(f.schedule.workDays)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  f.schedule.workDays = [...set]
}
</script>

<template>
  <div class="settings" @keydown.ctrl.s.prevent="save">
    <nav class="side" aria-label="Разделы настроек">
      <button v-for="c in CATS" :key="c.id" :class="{ on: cat === c.id }" @click="cat = c.id"><Icon :name="c.icon" :size="15" /><span>{{ c.label }}</span></button>
    </nav>

    <div class="content">
    <section v-show="cat === 'general'">
      <h3>Рабочий график</h3>
      <p class="muted">Официальное время — только ориентир для таймлайна. Трекинг идёт всегда, когда QA включено.</p>
      <div class="grid">
        <label>Начало <input v-model="f.schedule.start" type="time" /></label>
        <label>Конец <input v-model="f.schedule.end" type="time" /></label>
        <label>Обед с <input v-model="f.schedule.lunchStart" type="time" /></label>
        <label>Обед до <input v-model="f.schedule.lunchEnd" type="time" /></label>
      </div>
      <div class="days">
        <button v-for="d in DAYS" :key="d.id" class="chip" :class="{ on: f.schedule.workDays.includes(d.id) }" :style="f.schedule.workDays.includes(d.id) ? { background: 'var(--accent)' } : {}" @click="toggleDay(d.id)">
          {{ d.label }}
        </button>
      </div>
    </section>

    <section v-show="cat === 'kinds'">
      <h3>Виды занятости</h3>
      <p class="muted small">Показываются кнопками в island и в меню по правому клику на шкале. Пустая подпись при нарезке заменяется названием вида.</p>
      <div ref="klist" class="kinds">
        <div v-for="k in f.kinds" :key="k.id" class="krow" :class="{ drag: kDrag === k.id }">
          <span class="mgrip" title="Перетащить" @pointerdown="startKindDrag($event, k.id)"><Icon name="grip" :size="14" /></span>
          <span class="kpreview" :style="{ background: k.color }"><Icon :name="k.icon" :size="14" :stroke="2.2" /></span>
          <input v-model="k.label" class="klabel" placeholder="Название, например «Ревью кода»" />
          <input v-model="k.color" type="color" class="kcolor" title="Цвет" />
          <div class="iconpick">
            <button class="mini" title="Иконка" @click="iconPicker = iconPicker === k.id ? undefined : k.id"><Icon :name="k.icon" :size="14" /></button>
            <div v-if="iconPicker === k.id" class="icongrid">
              <button v-for="ic in KIND_ICONS" :key="ic" class="mini" :class="{ on: ic === k.icon }" @click="(k.icon = ic), (iconPicker = undefined)">
                <Icon :name="ic" :size="15" />
              </button>
            </div>
          </div>
          <label class="check small-check" title="Учитывается как рабочее время"><input v-model="k.productive" type="checkbox" /> продуктивное</label>
          <label class="check small-check" title="Не показывать в кнопках и меню"><input v-model="k.hidden" type="checkbox" /> скрыт</label>
          <button class="mini danger" title="Удалить вид" :disabled="f.kinds.length <= 1" @click="removeKind(k.id)"><Icon name="trash" :size="13" /></button>
        </div>
      </div>
      <button class="add" @click="addKind"><Icon name="plus" :size="14" />Добавить вид</button>
    </section>

    <section v-show="cat === 'look'">
      <h3>Оформление</h3>
      <p class="muted small">Применяется сразу во всех окнах.</p>
      <div class="look">
        <div class="lrow">
          <span class="ll">Контраст</span>
          <span class="seg3"><button v-for="c in CONTRASTS" :key="c.id" :class="{ on: ui.theme.contrast === c.id }" @click="setTheme({ contrast: c.id })">{{ c.label }}</button></span>
        </div>
        <div class="lrow">
          <span class="ll">Акцент</span>
          <span class="sws">
            <button v-for="a in ACCENTS" :key="a.id" class="sw" :class="{ on: ui.theme.accent === a.id }" :style="{ background: a.id }" :title="a.label" @click="setTheme({ accent: a.id })"></button>
            <label class="sw own" :class="{ on: !ACCENTS.some((a) => a.id === ui.theme.accent) }" title="Свой цвет" :style="{ background: ui.theme.accent }"><input type="color" :value="ui.theme.accent" @change="setTheme({ accent: ($event.target as HTMLInputElement).value })" /><Icon name="pencil" :size="11" /></label>
          </span>
        </div>
        <div class="lrow">
          <span class="ll">Скругление панелей</span>
          <span class="orow"><input v-model.number="ui.theme.radius" type="range" min="0" max="14" step="1" @change="applyUi" /><b>{{ ui.theme.radius }} px</b></span>
        </div>
        <div class="lrow">
          <span class="ll">Цифры и время</span>
          <label class="switch"><input v-model="ui.theme.mono" type="checkbox" @change="applyUi" /><span>Моноширинным шрифтом</span></label>
        </div>
        <div class="tprev">
          <div class="tp-head"><span>ПРИМЕР ПАНЕЛИ</span><i class="tp-led"></i></div>
          <div class="tp-body">
            <span class="tp-num">7ч 42м</span>
            <span class="tp-up">+12%</span>
            <span class="tp-chip">DOS-2984</span>
            <button class="primary">Действие</button>
          </div>
        </div>
        <div><button @click="setTheme({ ...DEFAULT_THEME })">Сбросить оформление</button></div>
      </div>

      <h3 class="mt">Меню</h3>
      <p class="muted small">Перетащите раздел за ручку, чтобы поменять порядок. Глаз — показать или скрыть.</p>
      <div ref="mlist">
        <TransitionGroup tag="div" class="mlist" name="mrow">
          <div v-for="v in menuViews" :key="v.id" class="mrow" :data-mid="v.id" :class="{ drag: dragId === v.id, off: isHidden(v.id) }">
            <span class="mgrip" title="Перетащить" @pointerdown="startDrag($event, v.id)"><Icon name="grip" :size="14" /></span>
            <Icon :name="v.icon" :size="15" />
            <span class="mlabel">{{ v.label }}</span>
            <button class="mini" :title="isHidden(v.id) ? 'Показать в меню' : 'Скрыть из меню'" @click="toggleHidden(v.id)"><Icon :name="isHidden(v.id) ? 'eyeOff' : 'eye'" :size="14" /></button>
          </div>
        </TransitionGroup>
      </div>
      <div><button @click="resetMenu">Порядок по умолчанию</button></div>
    </section>

    <section v-show="cat === 'ui'">
      <h3>Интерфейс</h3>
      <p class="muted small">Скрытое не теряется — только не показывается. Применяется сразу во всех окнах.</p>
      <div class="presets">
        <button @click="uiPreset('minimal')">Минимальный</button>
        <button @click="uiPreset('full')">Всё показывать</button>
      </div>
      <div class="uigroups">
        <div class="uigroup">
          <h4>Мини-остров</h4>
          <label v-for="o in UI_PILL" :key="o.k" class="switch" :title="o.hint"><input v-model="ui.pill[o.k]" type="checkbox" @change="applyUi" /><span>{{ o.label }}</span></label>
          <label class="opacity" title="Только фон свёрнутого мини-острова">
            Непрозрачность фона
            <span class="orow">
              <input v-model.number="f.pillOpacity" type="range" min="20" max="100" step="5" @change="applyOpacity" />
              <b>{{ f.pillOpacity }}%</b>
            </span>
          </label>
        </div>
        <div class="uigroup">
          <h4>У края экрана</h4>
          <label v-for="o in UI_DOCK" :key="o.k" class="switch"><input v-model="ui.dock[o.k]" type="checkbox" @change="applyUi" /><span>{{ o.label }}</span></label>
        </div>
        <div class="uigroup">
          <h4>Остров</h4>
          <label v-for="o in UI_ISLAND" :key="o.k" class="switch"><input v-model="ui.island[o.k]" type="checkbox" @change="applyUi" /><span>{{ o.label }}</span></label>
        </div>
        <div class="uigroup">
          <h4>Основное окно</h4>
          <label v-for="o in UI_MAIN" :key="o.k" class="switch" :title="o.hint"><input v-model="ui.main[o.k]" type="checkbox" @change="applyUi" /><span>{{ o.label }}</span></label>
        </div>
        <div class="uigroup">
          <h4>Таймлайн</h4>
          <div class="tlgrid">
            <label>Сдвигать каждые
              <select v-model.number="ui.timeline.stepSec" @change="applyUi">
                <option v-for="s in [15, 30, 60, 120, 300]" :key="s" :value="s">{{ s < 60 ? `${s} сек` : `${s / 60} мин` }}</option>
              </select>
            </label>
            <label>«Сейчас» от левого края, px
              <input v-model.number="ui.timeline.leftPx" type="number" min="0" max="2000" step="10" @change="applyUi" />
            </label>
            <label>Вернуться после ручного сдвига, сек
              <input v-model.number="ui.timeline.idleSec" type="number" min="1" max="600" @change="applyUi" />
            </label>
            <label>Масштаб
              <select v-model="ui.timeline.zoom" @change="applyUi">
                <option value="keep">Как сейчас (мой)</option>
                <option value="fixed">Заданный</option>
              </select>
            </label>
            <label>Отсчёт «через …» на дашборде
              <select v-model="ui.timeline.countdown" @change="applyUi">
                <option value="any">До любого события</option>
                <option value="outlook">Только до встреч Outlook</option>
              </select>
            </label>
            <label v-if="ui.timeline.zoom === 'fixed'">Показывать
              <select v-model.number="ui.timeline.spanMin" @change="applyUi">
                <option v-for="m in [30, 60, 120, 240, 480, 720]" :key="m" :value="m">{{ m < 60 ? `${m} мин` : `${m / 60} ч` }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>
      <p class="muted small hint">Остров: Ctrl+Alt+Space — вызвать с клавиатуры; перемещается за иконку слева, позиция запоминается; булавка — не сворачивать; клик по шапке — сбросить выделение. Вернуть на место — меню «Ещё» или трей.</p>
    </section>

    <TabletView v-if="cat === 'tablet'" embedded />
    <section v-show="cat === 'outlook'">
      <h3>Outlook и Teams</h3>
      <p class="muted small">
        Встречи из календаря Outlook становятся блоками «Встреча» (только чтение). Созвон остаётся отдельным блоком и связывается со встречей,
        если был во время неё — даже если начался раньше, позже или затянулся. Изменённый вами блок встречи синхронизация не трогает, удалённый — не возвращает.
      </p>
      <div class="srcseg">
        <button :class="{ on: olForm.source === 'local' }" @click="(olForm.source = 'local'), applyOutlook()">Outlook на этом компьютере</button>
        <button :class="{ on: olForm.source === 'graph' }" @click="(olForm.source = 'graph'), applyOutlook()">Microsoft Graph</button>
      </div>
      <p class="muted small">
        <template v-if="olForm.source === 'local'">Встречи берутся из запущенного классического Outlook — без Azure и согласий. Статус Teams так недоступен: созвон определяется по микрофону.</template>
        <template v-else>Нужна регистрация приложения в Azure и согласие (в вашей организации — администратора). Даёт ещё и статус Teams.</template>
      </p>
      <div class="grid">
        <template v-if="olForm.source === 'graph'">
          <label>Client ID (приложение) <input v-model="olForm.clientId" spellcheck="false" @change="applyOutlook" /></label>
          <label>Tenant ID (каталог) <input v-model="olForm.tenantId" spellcheck="false" @change="applyOutlook" /></label>
        </template>
        <label>
          Синхронизация каждые
          <select v-model.number="olForm.syncMin" @change="applyOutlook">
            <option v-for="m in [5, 10, 15, 30, 60]" :key="m" :value="m">{{ m }} мин</option>
          </select>
        </label>
      </div>
      <div class="olopts">
        <label class="switch"><input v-model="olForm.meetings" type="checkbox" @change="applyOutlook" /><span>Встречи из календаря на таймлайн</span></label>
        <label v-if="olForm.source === 'graph'" class="switch" title="Статус «В звонке» в Teams"><input v-model="olForm.presence" type="checkbox" @change="applyOutlook" /><span>Статус Teams как признак созвона</span></label>
      </div>
      <div class="jrow">
        <template v-if="ol.connected">
          <span class="ok">{{ ol.source === 'local' ? 'Источник' : 'Подключено' }}: {{ ol.account?.name }}<template v-if="ol.account?.email"> · {{ ol.account.email }}</template></span>
          <span class="muted small">{{ ol.syncing ? 'синхронизация…' : `синхр. ${olSynced} · каждые ${olForm.syncMin} мин` }}</span>
          <span v-if="ol.presence" class="muted small">Teams: {{ PRESENCE[ol.presence.activity] ?? PRESENCE[ol.presence.availability] ?? ol.presence.activity }}</span>
          <button :disabled="ol.syncing" @click="olSync">Синхронизировать</button>
          <button v-if="ol.source === 'graph'" @click="olLogout">Выйти</button>
        </template>
        <button v-else class="primary" :disabled="olBusy || !olForm.clientId || !olForm.tenantId" @click="outlookLogin">{{ olBusy ? 'Ждём вход в браузере…' : 'Войти через Microsoft' }}</button>
        <span v-if="olError || ol.error" class="err">{{ olError || ol.error }}</span>
      </div>
    </section>

    <section v-show="cat === 'browser'">
      <h3>Браузер</h3>
      <div class="olopts">
        <label class="switch"><input type="checkbox" :checked="brSet.history" @change="brPatch({ history: ($event.target as HTMLInputElement).checked })" /><span>Сохранять историю посещений</span></label>
      </div>
      <p class="muted small">Открытые страницы запоминаются по дням, со временем открытия: 90 дней, только на этом компьютере. По ним же — подсказки в строке адреса. Сама история — в разделе «Браузер»: кнопка с часами или Ctrl+H. Выключение не удаляет уже сохранённое.</p>
      <div class="olopts">
        <label class="switch"><input type="checkbox" :checked="brSet.acceptBadCerts" @change="brPatch({ acceptBadCerts: ($event.target as HTMLInputElement).checked })" /><span>Открывать сайты с недоверенным сертификатом</span></label>
      </div>
      <p class="muted small">Свой (самоподписанный), просроченный или выданный на другое имя — как у внутренних сайтов. Такой сайт открывается сразу, замок перед адресом становится красным: защищённость соединения тогда не гарантируется. Выключено — Qvarch спросит; а не загрузившаяся часть страницы (счётчик, реклама) больше не заменяет страницу ошибкой.</p>
      <div class="grid">
        <label>
          Неактивная вкладка засыпает через
          <select :value="brSet.sleepMin" @change="brPatch({ sleepMin: Number(($event.target as HTMLSelectElement).value) })">
            <option :value="0">никогда</option>
            <option v-for="m in [5, 15, 30, 60]" :key="m" :value="m">{{ m }} мин</option>
          </select>
        </label>
      </div>
      <p class="muted small">Каждая вкладка браузера — отдельный процесс (сотни МБ памяти). Уснувшая вкладка остаётся в списке и загружается заново, когда вы её открываете. Не засыпают: показанные, с открытыми инструментами разработчика, в режиме устройства, со звуком и во время записи запросов.</p>
      <h3 class="mt">User-Agent</h3>
      <p class="muted small">Как браузер представляется сайтам. Действует сразу на все вкладки; уже открытые страницы увидят его после обновления (F5). У вкладки в режиме устройства — User-Agent этого устройства.</p>
      <div class="grid">
        <label class="span2">
          Вариант
          <select :value="uaPick" @change="onUaPick(($event.target as HTMLSelectElement).value)">
            <option v-for="(p, i) in UA_PRESETS" :key="i" :value="String(i)">{{ p.label }}</option>
            <option value="own">Свой…</option>
          </select>
        </label>
        <label class="span2">
          Строка User-Agent
          <textarea
            class="uabox"
            :value="uaShown"
            rows="3"
            spellcheck="false"
            :readonly="uaPick !== 'own'"
            placeholder="Mozilla/5.0 …"
            @input="uaOwn = ($event.target as HTMLTextAreaElement).value"
            @change="applyUa"
            @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()"
          ></textarea>
        </label>
      </div>
      <p v-if="uaPick === 'own'" class="muted small">Впишите строку и нажмите Enter (или щёлкните мимо). Пустая строка — встроенный User-Agent.</p>
    </section>

    <section v-show="cat === 'ai'">
      <h3>AI-ассистенты (MCP)</h3>
      <McpSettings class="mcpw" />
    </section>

    <section v-show="cat === 'jira'">
      <h3>Jira</h3>
      <p class="muted small">Своё приложение Atlassian (OAuth 2.0): developer.atlassian.com → ваше приложение → Settings. Callback: <code>http://localhost:47321/callback</code>. Секрет хранится зашифрованным на этом компьютере.</p>
      <div class="grid">
        <label>Client ID <input v-model="f.jiraClientId" spellcheck="false" placeholder="из Settings приложения" /></label>
        <label>Secret <input v-model="f.jiraSecret" type="password" spellcheck="false" :placeholder="jira.hasSecret ? 'сохранён — введите, чтобы заменить' : 'Client secret'" /></label>
        <label class="span2">Проекты (ключи или ссылки на доски) <input v-model="f.jiraProjects" spellcheck="false" placeholder="DOS, RND, AI" /></label>
        <label>
          Синхронизация каждые
          <select v-model.number="f.jiraSyncMin" @change="applyJiraEvery">
            <option v-for="m in [5, 10, 15, 30, 60]" :key="m" :value="m">{{ m }} мин</option>
          </select>
        </label>
      </div>
      <div class="jrow">
        <template v-if="jira.connected">
          <span class="ok">Подключено: {{ jira.account?.name }} · {{ jira.siteUrl }}</span>
          <span class="muted small">{{ jira.issues.length }} задач · синхр. каждые {{ f.jiraSyncMin }} мин</span>
          <button :disabled="jira.syncing" @click="jiraSync">{{ jira.syncing ? 'Синхронизация…' : 'Синхронизировать' }}</button>
          <button @click="jiraLogout">Выйти</button>
        </template>
        <button v-else class="primary" :disabled="jiraBusy" @click="jiraLogin">{{ jiraBusy ? 'Ждём вход в браузере…' : 'Войти через Atlassian' }}</button>
        <span v-if="jiraError || jira.error" class="err">{{ jiraError || jira.error }}</span>
      </div>
    </section>

    <section v-show="cat === 'voice'">
      <h3>Распознавание речи (локально)</h3>
      <p class="muted small">Голосовые заметки и записи звонков расшифровываются на этом компьютере (whisper.cpp), без интернета и облаков. Модели скачиваются по желанию и проверяются по контрольной сумме; ненужную можно удалить. Записи сохраняются в любом случае.</p>
      <div class="jrow">
        <label class="check"><input v-model="f.voiceEnabled" type="checkbox" @change="applyVoice" /> Расшифровка включена</label>
        <label class="check" :class="{ off: !f.voiceEnabled }"><input v-model="f.autoTranscribe" type="checkbox" :disabled="!f.voiceEnabled" @change="applyVoice" /> Сразу после записи</label>
        <span v-if="voiceErr || voice.error" class="err">{{ voiceErr || voice.error }}</span>
      </div>
      <div class="grid">
        <label class="span2">
          Микрофон
          <select v-model="f.micId" @change="applyVoice">
            <option value="">По умолчанию в системе</option>
            <option v-for="m in mics" :key="m.id" :value="m.id">{{ m.label }}</option>
            <option v-if="micMissing" :value="f.micId">Выбранный (сейчас не подключён)</option>
          </select>
        </label>
      </div>
      <p v-if="micMissing" class="muted small">Выбранный микрофон не подключён — пока его нет, запись идёт с микрофона по умолчанию.</p>
      <div class="models" :class="{ off: !f.voiceEnabled }">
        <div v-for="m in WHISPER_MODELS" :key="m.id" class="model" :class="{ cur: f.voiceModel === m.id }">
          <label class="pick" :title="isReady(m.id) ? 'Использовать эту модель' : 'Сначала скачайте модель'">
            <input v-model="f.voiceModel" type="radio" :value="m.id" :disabled="!f.voiceEnabled" @change="applyVoice" />
            <b>{{ m.label }}</b>
          </label>
          <span class="muted small">{{ mb(m.bytes) }} · {{ m.note }}</span>
          <span class="spacer"></span>
          <template v-if="voice.downloading?.id === m.id">
            <span class="prog"><span :style="{ width: `${Math.round(voice.downloading.progress * 100)}%` }"></span></span>
            <span class="muted small">{{ Math.round(voice.downloading.progress * 100) }}%</span>
          </template>
          <template v-else-if="isReady(m.id)">
            <span class="ok small">скачана</span>
            <button class="linkbtn danger" @click="deleteModel(m.id, m.label)">удалить</button>
          </template>
          <button v-else class="linkbtn" :disabled="!!voice.downloading" @click="downloadModel(m.id)">скачать</button>
        </div>
        <p v-if="f.voiceEnabled && !isReady(f.voiceModel)" class="err small">Выбранная модель не скачана — расшифровка не сработает, пока её не скачать.</p>
      </div>
    </section>

    <section v-show="cat === 'general'">
      <h3>Общее</h3>
      <div class="grid">
        <label title="Обед ставится сам, если в обеденное время нет ввода столько минут">Обед после простоя, мин <input v-model.number="f.idleMin" type="number" min="1" max="60" /></label>
        <label title="Как часто проверяется, идёт ли созвон">Опрос созвонов, сек <input v-model.number="f.sampleSec" type="number" min="1" max="30" /></label>
        <label class="check"><input v-model="f.autoStart" type="checkbox" /> Запускать вместе с Windows</label>
        <label class="check" title="Берётся только заголовок окна программы созвона (Teams, Zoom…)">
          <input v-model="f.captureTitles" type="checkbox" /> Подписывать созвоны заголовком окна (с кем)
        </label>
        <label class="check" title="Для счётчика комбо в мини-острове учитывается только сам факт нажатия">
          <input v-model="f.countKeys" type="checkbox" /> Считать комбо нажатий клавиш
        </label>
      </div>
    </section>

    <!-- interface and voice apply at once; the rest needs "Сохранить" -->
    <div v-if="cat !== 'ui' && cat !== 'voice' && cat !== 'outlook'" class="footer">
      <button class="primary" @click="save">Сохранить</button>
      <span class="muted small">Ctrl+S</span>
      <span v-if="saveError" class="err">Не сохранилось: {{ saveError }}</span>
      <span v-if="saved" class="ok">Сохранено</span>
    </div>
    </div>
  </div>
</template>

<style scoped>
.models {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.models.off,
.check.off {
  opacity: 0.5;
}
.model {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 5px 10px;
  border-radius: 4px;
  border: 1px solid transparent;
}
.model.cur {
  border-color: rgb(var(--accent-rgb) / 0.5);
  background: rgb(var(--accent-rgb) / 0.08);
}
.model .pick {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-width: 160px;
  color: var(--text);
  font-size: 13px;
}
.model .spacer {
  flex: 1;
}
.linkbtn.danger {
  color: var(--down-fg);
}
.ok.small {
  color: var(--up-fg);
}
.prog {
  width: 160px;
  max-width: 100%;
  height: 6px;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.prog span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
.prompt {
  margin-top: 12px;
}
.prompt textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
}
.phead {
  display: flex;
  align-items: center;
  gap: 10px;
}
.linkbtn {
  border: 0;
  padding: 2px 0;
  background: transparent;
  color: var(--accent-fg);
  font-size: 12px;
  cursor: pointer;
}
.linkbtn:hover {
  text-decoration: underline;
}
.preview {
  max-height: 320px;
  overflow: auto;
  padding: 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  font-size: 11px;
  white-space: pre-wrap;
}
.jrow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.jrow .ok {
  color: var(--up-fg);
  font-size: 13px;
}
.span2 {
  grid-column: 1 / -1;
}
.uabox {
  width: 100%;
  min-height: 64px;
  resize: vertical;
  font-family: var(--font-data);
  font-size: 12px;
  line-height: 1.5;
}
.uabox[readonly] {
  color: var(--text-2);
}
.small {
  font-size: 12px;
}
code {
  font-size: 12px;
  color: var(--accent-fg);
}
.opacity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.orow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.orow input {
  flex: 1;
  accent-color: var(--accent);
}
.orow b {
  min-width: 40px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.err {
  color: var(--down-fg);
  font-size: 12px;
}
.settings {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 20px;
  padding: 16px 16px 0;
  min-height: 100%;
  box-sizing: border-box;
  align-items: start;
}
.side {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.side button {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
}
.side button:hover {
  background: var(--hover);
  color: var(--text);
}
.side button.on {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--text);
}
.content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
/* narrow window: the sections become a scrollable row of tabs on top */
@media (max-width: 760px) {
  .settings {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .side {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .side button {
    flex: none;
  }
}
@media (max-width: 520px) {
  .side button span {
    display: none;
  }
}
.srcseg {
  display: inline-flex;
  padding: 2px;
  margin-bottom: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.srcseg button {
  padding: 4px 12px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.srcseg button.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--text);
}
.olopts {
  display: flex;
  flex-direction: column;
  max-width: 420px;
  margin-top: 10px;
}
.presets {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.presets button {
  padding: 4px 12px;
  font-size: 12px;
}
.uigroups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.uigroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 4px;
  background: var(--panel-2);
}
h4 {
  margin: 0 0 6px;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
/* iOS-like switch on top of a checkbox */
label.switch {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}
label.switch span {
  order: -1;
}
.switch input {
  appearance: none;
  flex: none;
  position: relative;
  width: 32px;
  height: 18px;
  margin: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  cursor: pointer;
  transition: background 0.2s;
}
.switch input::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-hi);
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
.switch input:checked {
  background: var(--accent);
}
.switch input:checked::after {
  transform: translateX(14px);
}
.lstyles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.lstyles button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.lstyles button.on {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--text);
}
.uigroup .opacity {
  margin-top: 8px;
}
.hint {
  margin: 14px 0 0;
}
section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 14px 18px;
}
h3 {
  margin: 0 0 8px;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
p {
  margin: 0 0 12px;
}
.small {
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}
.grid.wide {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
label.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
}
.secret {
  display: flex;
  gap: 6px;
}
.secret input {
  flex: 1;
}
.days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.ok {
  color: var(--up-fg);
  font-size: 13px;
}
.err {
  color: var(--down-fg);
  font-size: 13px;
}
.kinds {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.krow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 4px 0;
}
.order {
  display: inline-flex;
  flex-direction: column;
}
.order .mini {
  padding: 0 4px;
  line-height: 1;
}
.kpreview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: var(--text-hi);
  flex: none;
}
.klabel {
  flex: 1 1 180px;
  min-width: 0;
}
.kcolor {
  width: 36px;
  height: 30px;
  padding: 2px;
}
.iconpick {
  position: relative;
}
.icongrid {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(6, 32px);
  gap: 4px;
  padding: 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
}
.mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 7px;
}
.mini.on {
  background: var(--accent);
}
.small-check {
  font-size: 12px !important;
}
.add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
code {
  background: var(--panel-2);
  padding: 1px 5px;
  border-radius: var(--r2);
}
.footer {
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  bottom: 0;
  padding: 12px 0;
  background: var(--bg);
}
.tlgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px 14px;
}
.tlgrid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

/* ---------- the look ---------- */
.look {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 640px;
}
.lrow {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 30px;
}
.ll {
  flex: none;
  width: 170px;
  color: var(--text-2);
}
.seg3 {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg3 button {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  padding: 5px 14px;
}
.seg3 button + button {
  border-left: 1px solid var(--border-2);
}
.seg3 button.on {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.sws {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.sw {
  position: relative;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--r2);
  outline: 1px solid var(--border-2);
  cursor: pointer;
}
.sw.on {
  border-color: var(--bg);
  outline: 2px solid var(--text-hi);
}
.sw.own {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent);
}
.sw.own input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.tprev {
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  overflow: hidden;
}
.tp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  box-shadow: inset 0 2px 0 var(--accent);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--text-2);
}
.tp-led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--up);
}
.tp-body {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
}
.tp-num {
  font-family: var(--font-data);
  font-size: 22px;
  font-weight: 600;
  color: var(--text-hi);
}
.tp-up {
  font-family: var(--font-data);
  color: var(--up-fg);
}
.tp-chip {
  padding: 2px 8px;
  border-radius: var(--r2);
  background: var(--accent-soft);
  color: var(--accent-fg);
  font-family: var(--font-data);
  font-size: 12px;
}
.tp-body .primary {
  margin-left: auto;
}
h3.mt {
  margin-top: 26px;
}
/* ---------- the menu ---------- */
.mlist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 420px;
  margin-bottom: 10px;
}
.mrow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 6px 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
  user-select: none;
}
.mrow.drag {
  border-color: var(--accent);
  background: var(--panel-2);
}
.mrow.off .mlabel,
.mrow.off > svg {
  opacity: 0.4;
}
.mgrip {
  display: inline-flex;
  padding: 6px 4px;
  color: var(--dim);
  cursor: grab;
  touch-action: none;
}
.mrow.drag .mgrip {
  cursor: grabbing;
  color: var(--accent-fg);
}
.mlabel {
  flex: 1;
}
.krow.drag {
  outline: 1px solid var(--accent);
  border-radius: var(--r2);
  background: var(--panel-2);
}
.mrow-move {
  transition: transform 0.15s ease;
}
/* the AI assistants' section (a component of its own) looks as the others */
.mcpw :deep(label) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.mcpw :deep(.span2) {
  grid-column: 1 / -1;
}
.mcpw :deep(.small) {
  font-size: 12px;
}
.mcpw :deep(.olopts) {
  display: flex;
  flex-direction: column;
  max-width: 420px;
  margin-top: 10px;
}
.mcpw :deep(label.switch span) {
  order: -1;
}
.mcpw :deep(.switch input) {
  appearance: none;
  flex: none;
  position: relative;
  width: 32px;
  height: 18px;
  margin: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  cursor: pointer;
  transition: background 0.2s;
}
.mcpw :deep(.switch input)::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-hi);
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
.mcpw :deep(.switch input:checked) {
  background: var(--accent);
}
.mcpw :deep(.switch input:checked)::after {
  transform: translateX(14px);
}
.mcpw :deep(h3) {
  margin: 0 0 8px;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
.mcpw :deep(.small) {
  font-size: 12px;
}
.mcpw :deep(.grid) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}
.mcpw :deep(h3.mt) {
  margin-top: 26px;
}
</style>
