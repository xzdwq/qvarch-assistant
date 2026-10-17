<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { shiftDay } from '@shared/timeline'
import type { AppCommand } from '@shared/api'
import type { PublicSettings } from '@shared/types'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import { setKinds } from '../lib/palette'
import DayView from './DayView.vue'
import SettingsView from './SettingsView.vue'
import TaskCalendar from '../components/TaskCalendar.vue'
import WorkView from './WorkView.vue'
import NotebookView from './NotebookView.vue'
import DashboardView from './DashboardView.vue'
import ReportsView from './ReportsView.vue'
import ReleaseView from './ReleaseView.vue'
import PdfSignView from './PdfSignView.vue'
import HttpView from './HttpView.vue'
import TerminalView from './TerminalView.vue'
import BrowserView from './BrowserView.vue'
import SeriesAsk from '../components/SeriesAsk.vue'
import DatePick from '../components/DatePick.vue'
import StatusBar from '../components/StatusBar.vue'
import { titleActions } from '../lib/titlebar'
import { onNewDay, todayKey } from '../lib/today'

import { orderedViews, VIEWS, type View } from '../lib/views'
const view = ref<View>('day')
const day = ref(todayKey.value)
onNewDay((prev, next) => {
  if (day.value === prev) day.value = next
})
const focusEntry = ref<string>()
const settings = ref<PublicSettings>()
const menuOpen = ref(false)

/** Opened from somewhere (a reminder, the island) — that section, not the menu's first one. */
let navigated = false
void window.qa.getSettings().then((s) => {
  settings.value = s
  setKinds(s.kinds)
  // the window opens on the first section of the user's menu
  if (!navigated) view.value = orderedViews(s.ui.menu).find((v) => !s.ui.menu.hidden.includes(v.id))?.id ?? 'day'
})

function onSettings(s: PublicSettings): void {
  settings.value = s
  setKinds(s.kinds)
}

const offSettings = window.qa.onSettings(onSettings)
onBeforeUnmount(offSettings)
const off = window.qa.onNavigate((nav) => {
  navigated = true
  view.value = (nav.view as View | undefined) ?? 'day'
  if (nav.day) day.value = nav.day
  focusEntry.value = nav.entryId
})
onBeforeUnmount(off)

/** From the dashboard: open a section (a day / a block on it). */
function go(v: View, d?: string, entryId?: string): void {
  if (d) day.value = d
  focusEntry.value = entryId
  view.value = v
}
function closeMenu(): void {
  menuOpen.value = false
  actMenu.value = ''
}
const actMenu = ref('')
onMounted(() => window.addEventListener('click', closeMenu))
onBeforeUnmount(() => window.removeEventListener('click', closeMenu))

function run(cmd: AppCommand): void {
  menuOpen.value = false
  window.qa.command(cmd)
}

/** Sections in the user's order (hidden ones are left out — the open one always shows). */
/** Once opened, the terminal stays mounted (hidden in other sections). */
const termOpened = ref(false)
watch(view, (v) => v === 'terminal' && (termOpened.value = true), { immediate: true })
/** The browser too: once opened it stays (its pages live in the main process; hidden in other sections). */
const brOpened = ref(false)
watch(view, (v) => v === 'browser' && (brOpened.value = true), { immediate: true })
/** A chain recorded in the browser went to HTTP: open it there, its first request picked. */
function openHttp(id: string): void {
  try {
    localStorage.setItem('qa.http.sel', id)
  } catch {
    // fine
  }
  view.value = 'http'
}
const menu = computed(() => orderedViews(settings.value?.ui.menu).filter((v) => v.id === view.value || !settings.value?.ui.menu.hidden.includes(v.id)))

const sectionName = computed(() => (view.value === 'settings' ? 'Настройки' : (VIEWS.find((v) => v.id === view.value)?.label ?? '')))
// an emptied date — back to today
watch(day, (v) => {
  if (!v) day.value = todayKey.value
})

// ---------- the whole window's scale (remembered) ----------
// CSS zoom of the content only — Chromium's page zoom would be shared with the island (the same file:// origin), and a
// zoomed title bar gets its drag areas computed wrong (the buttons at its right stop taking clicks)
const ZOOM_KEY = 'qa.zoom'
const appZoom = ref(readZoom())
function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY))
    return v >= 50 && v <= 200 ? v : 100
  } catch {
    return 100
  }
}
function setAppZoom(z: number): void {
  appZoom.value = Math.min(200, Math.max(50, Math.round(z / 5) * 5))
  try {
    localStorage.setItem(ZOOM_KEY, String(appZoom.value))
  } catch {
    // not remembered — fine
  }
}
</script>

<template>
  <div class="shell">
    <header class="titlebar">
      <div class="tside">
      <div class="brand">
        <Icon name="qlogo" :size="17" :stroke="3.8" />
        <b>QVARCH</b>
      </div>

      <nav class="seg nodrag" aria-label="Разделы">
        <button v-for="v in menu" :key="v.id" :class="{ on: view === v.id }" :title="v.label" :aria-label="v.label" @click="view = v.id">
          <Icon :name="v.icon" :size="15" /><span v-if="view === v.id" class="vl">{{ v.label }}</span>
        </button>
      </nav>

      <div v-if="view === 'day'" class="daynav nodrag">
        <button class="ico" title="Предыдущий день" @click="day = shiftDay(day, -1)"><Icon name="chevronLeft" :size="15" /></button>
        <DatePick v-model="day" class="tdate" />
        <button class="ico" title="Следующий день" @click="day = shiftDay(day, 1)"><Icon name="chevronRight" :size="15" /></button>
      </div>
      <span class="dragfill"></span>
      </div>

      <!-- the open section's own actions (icons only) -->
      <div v-if="titleActions.length" class="tacts nodrag" @click.stop>
        <span v-for="a in titleActions" :key="a.id" class="tact">
          <button class="ico" :class="{ on: a.on || actMenu === a.id }" :title="a.title" @click="a.menu ? (actMenu = actMenu === a.id ? '' : a.id) : ((actMenu = ''), a.click?.())"><Icon :name="a.icon" :size="15" /></button>
          <div v-if="a.menu && actMenu === a.id" class="dropdown amenu">
            <button v-for="m in a.menu" :key="m.label" @click="(m.click(), (actMenu = ''))"><Icon :name="m.icon" :size="14" />{{ m.label }}</button>
            <p v-if="!a.menu.length" class="muted small">Всё уже добавлено</p>
          </div>
        </span>
      </div>

      <div class="tside r">
      <span class="dragfill"></span>
      <ZoomChip class="azoom" :model-value="appZoom" :min="50" :max="200" title="Масштаб окна · колесо — изменить, клик — 100%" @update:model-value="setAppZoom" />
      <button class="ico nodrag" :class="{ on: view === 'settings' }" title="Настройки" aria-label="Настройки" @click="view = 'settings'">
        <Icon name="settings" :size="16" />
      </button>
      <div class="menu nodrag" @click.stop>
        <button class="ico" :class="{ on: menuOpen }" title="Ещё" aria-label="Ещё" @click="menuOpen = !menuOpen"><Icon name="more" :size="16" /></button>
        <Transition name="pop">
          <div v-if="menuOpen" class="dropdown">
            <button @click="run('island-toggle')"><Icon name="layers" :size="14" />Показать / скрыть island</button>
            <button @click="run('island-reset')"><Icon name="move" :size="14" />Вернуть island наверх по центру</button>
            <div class="sep"></div>
            <button @click="run('open-data-folder')"><Icon name="external" :size="14" />Открыть папку с данными</button>
            <button @click="run('devtools')"><Icon name="code" :size="14" />Инструменты разработчика</button>
            <div class="sep"></div>
            <button @click="run('quit')"><Icon name="x" :size="14" />Выход <span class="muted">(трекинг остановится)</span></button>
          </div>
        </Transition>
      </div>
      </div>
    </header>

    <SeriesAsk />
    <main v-if="settings" :style="{ zoom: appZoom / 100 }">
      <Transition name="fade" mode="out-in">
        <DashboardView v-if="view === 'dashboard'" :settings="settings" @go="go" />
        <DayView v-else-if="view === 'day'" :day="day" :settings="settings" :focus-entry="focusEntry" @open-day="(d, id) => ((day = d), (focusEntry = id))" />
        <TaskCalendar v-else-if="view === 'calendar'" fill :work-days="settings.schedule.workDays" @open-day="(d) => ((day = d), (view = 'day'))" />
        <NotebookView v-else-if="view === 'notebook'" />
        <ReportsView v-else-if="view === 'reports'" @go="go" />
        <WorkView v-else-if="view === 'work'" :settings="settings" @go="go" @settings="view = 'settings'" @open-day="(d) => ((day = d), (view = 'day'))" />
        <ReleaseView v-else-if="view === 'release'" />
        <HttpView v-else-if="view === 'http'" />
        <div v-else-if="view === 'terminal'" class="termslot"></div>
        <div v-else-if="view === 'browser'" class="termslot"></div>
        <PdfSignView v-else-if="view === 'pdf'" />
        <SettingsView v-else :settings="settings" @changed="onSettings" />
      </Transition>
      <TerminalView v-if="termOpened" v-show="view === 'terminal'" class="termkeep" />
      <BrowserView v-if="brOpened" v-show="view === 'browser'" class="termkeep" :active="view === 'browser'" @open-http="openHttp" />
    </main>
    <StatusBar :section="sectionName" @terminal="view = 'terminal'" @browser="view = 'browser'" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.titlebar {
  position: relative;
  z-index: 50;
  flex: none;
  height: 38px;
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 0 140px 0 0; /* room for the native window controls */
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  user-select: none;
  container-type: inline-size;
}
/* the window moves by the logo and the empty stretches only — buttons never sit inside a drag area
   (Electron cuts holes for them, and on Windows some of those holes go missing: clicks were lost) */
.brand,
.dragfill {
  -webkit-app-region: drag;
}
.dragfill {
  flex: 1;
  align-self: stretch;
  min-width: 12px;
}
.nodrag,
.titlebar button,
.titlebar input {
  -webkit-app-region: no-drag;
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px 0 12px;
  border-right: 1px solid var(--border);
  color: var(--accent);
}
.brand b {
  font-family: var(--font-data);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-hi);
}
.titlebar button {
  cursor: default;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r2);
  padding: 3px 9px;
  font-size: 12.5px;
  color: var(--muted);
}
.titlebar button:hover:not(:disabled) {
  background: var(--hover);
  border-color: transparent;
  color: var(--text);
}
.titlebar button.ico {
  padding: 0;
  width: 28px;
  height: 28px;
  justify-content: center;
}
.titlebar button.on {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.menu {
  position: relative;
}
/* the section's actions: in the middle of the bar */
.tside {
  /* never narrower than its content: an overflowing left side slid under the right one, whose empty drag
     stretch then took the clicks of the date's buttons */
  flex: 1 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tside.r {
  justify-content: flex-end;
}
.tacts {
  flex: none;
  align-self: center;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--panel);
}
.tact {
  position: relative;
}
.dropdown.amenu {
  left: 50%;
  right: auto;
  margin-left: -110px;
  min-width: 220px;
}
.dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
  min-width: 280px;
  padding: 4px;
  background: var(--pop);
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
}
.dropdown button {
  text-align: left;
  color: var(--text-2);
  padding: 6px 10px;
  border-radius: var(--r2);
}
.dropdown .sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
/* the sections: terminal tabs — the open one is lit and named */
.seg {
  display: flex;
  align-items: stretch;
  gap: 0;
}
.seg button {
  position: relative;
  height: 100%;
  min-width: 38px;
  padding: 0 11px;
  justify-content: center;
  border: 0;
  border-radius: 0;
  border-right: 1px solid var(--border);
}
.titlebar .seg button.on {
  background: var(--panel);
  color: var(--accent-fg);
}
.titlebar .seg button.on::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--accent);
}
.vl {
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
@container (max-width: 980px) {
  .vl,
  .brand b {
    display: none;
  }
}
.daynav {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 10px;
}
.date {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--r2);
  font-size: 12.5px;
  cursor: pointer;
  text-transform: capitalize;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.titlebar .date {
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
}
/* the native date picker opens under the date button */
.picker {
  width: 0;
  height: 0;
  padding: 0;
  margin: 0 0 0 -2px;
  border: 0;
  opacity: 0;
  pointer-events: none;
  align-self: flex-end;
}
.titlebar .today {
  color: var(--accent-fg);
  border-color: var(--accent-line);
  height: 24px;
  font-size: 12px;
}
.grow {
  flex: 1;
}
main {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
main:has(> .tcal.fill),
main:has(> .nb),
main:has(> .rep),
main:has(> .sh),
main:has(> .rel),
main:has(> .ps),
main:has(> .tv),
main:has(> .hv),
main:has(> .termslot) {
  overflow: hidden;
}
.termslot {
  display: none;
}
.termkeep {
  height: 100%;
}
.azoom {
  display: inline-flex;
  align-items: center;
  margin-right: 6px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  overflow: hidden;
}
.azoom button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  min-width: 20px;
  padding: 0 4px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: default;
}
.azoom button:hover {
  background: var(--hover);
  color: var(--text);
}
.titlebar .azoom .zv {
  min-width: 42px;
  padding: 0 4px;
  font-family: var(--font-data);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
</style>
