<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dayKey, shiftDay } from '@shared/timeline'
import type { AppCommand } from '@shared/api'
import type { PublicSettings } from '@shared/types'
import Icon from '../components/Icon.vue'
import { setKinds } from '../lib/palette'
import CalendarView from './CalendarView.vue'
import DayView from './DayView.vue'
import LogView from './LogView.vue'
import SettingsView from './SettingsView.vue'
import TasksView from './TasksView.vue'
import NotebookView from './NotebookView.vue'
import DashboardView from './DashboardView.vue'
import ReportsView from './ReportsView.vue'
import SheetView from './SheetView.vue'
import ReleaseView from './ReleaseView.vue'
import SeriesAsk from '../components/SeriesAsk.vue'
import { titleActions } from '../lib/titlebar'

type View = 'dashboard' | 'day' | 'calendar' | 'sheet' | 'reports' | 'log' | 'tasks' | 'notebook' | 'release' | 'settings'
const view = ref<View>('day')
const day = ref(dayKey(Date.now()))
const focusEntry = ref<string>()
const settings = ref<PublicSettings>()
const menuOpen = ref(false)

void window.qa.getSettings().then((s) => {
  settings.value = s
  setKinds(s.kinds)
})

function onSettings(s: PublicSettings): void {
  settings.value = s
  setKinds(s.kinds)
}

const offSettings = window.qa.onSettings(onSettings)
onBeforeUnmount(offSettings)
const off = window.qa.onNavigate((nav) => {
  view.value = nav.view ?? 'day'
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

/** Sections: icon-only in the title bar, the name is in the tooltip (and read by screen readers). */
const VIEWS: Array<{ id: View; icon: string; label: string }> = [
  { id: 'dashboard', icon: 'dashboard', label: 'Дашборд' },
  { id: 'day', icon: 'timeline', label: 'Таймлайн' },
  { id: 'calendar', icon: 'calendar', label: 'Календарь' },
  { id: 'sheet', icon: 'table', label: 'Заполнение' },
  { id: 'reports', icon: 'chart', label: 'Отчёты' },
  { id: 'log', icon: 'list', label: 'Журнал' },
  { id: 'tasks', icon: 'checkSquare', label: 'Задачи' },
  { id: 'notebook', icon: 'notebook', label: 'Блокнот' },
  { id: 'release', icon: 'branch', label: 'Релиз' },
]

const title = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
const today = () => dayKey(Date.now())
// "Удалить" in the date picker empties the value — back to today then
watch(day, (v) => {
  if (!v) day.value = today()
})
/** The date in the title bar opens the browser's calendar — any day, past or future (meetings, planning). */
const picker = ref<HTMLInputElement>()
/**
 * The picker is open from showPicker() until a date is picked, Esc, or the next press anywhere (the browser
 * closes it on that press). A press on the date button while it was open just closes it.
 */
let pickerOpen = false
let pressClosedPicker = false
function onAnyDown(): void {
  pressClosedPicker = pickerOpen
  pickerOpen = false
}
function onAnyKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') pickerOpen = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onAnyDown, true)
  document.addEventListener('keydown', onAnyKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onAnyDown, true)
  document.removeEventListener('keydown', onAnyKey, true)
})
function openPicker(): void {
  if (pressClosedPicker) {
    pressClosedPicker = false
    return
  }
  try {
    picker.value?.showPicker()
    pickerOpen = true
  } catch {
    picker.value?.focus()
  }
}

// ---------- the whole window's scale (remembered) ----------
// CSS zoom of this page — Chromium's page zoom would be shared with the island (the same file:// origin)
const applyZoom = (z: number) => (document.documentElement.style.zoom = String(z / 100))
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
  appZoom.value = Math.min(200, Math.max(50, Math.round(z / 10) * 10))
  applyZoom(appZoom.value)
  try {
    localStorage.setItem(ZOOM_KEY, String(appZoom.value))
  } catch {
    // not remembered — fine
  }
}
applyZoom(appZoom.value)
</script>

<template>
  <div class="shell">
    <header class="titlebar" :style="{ zoom: 100 / appZoom }">
      <div class="tside">
      <div class="brand">
        <Icon name="qlogo" :size="19" :stroke="3.6" style="color: #7c6cf6" />
      </div>

      <nav class="seg nodrag" aria-label="Разделы">
        <button v-for="v in VIEWS" :key="v.id" :class="{ on: view === v.id }" :title="v.label" :aria-label="v.label" @click="view = v.id">
          <Icon :name="v.icon" :size="16" />
        </button>
      </nav>

      <div v-if="view === 'day' || view === 'log'" class="daynav nodrag">
        <button class="ico" title="Предыдущий день" @click="day = shiftDay(day, -1)"><Icon name="chevronLeft" :size="15" /></button>
        <button class="date" title="Выбрать день" @click="openPicker">
          <Icon name="calendar" :size="14" /><span>{{ title(day) }}</span>
        </button>
        <input ref="picker" v-model="day" class="picker" type="date" tabindex="-1" aria-hidden="true" @change="pickerOpen = false" />
        <button class="ico" title="Следующий день" @click="day = shiftDay(day, 1)"><Icon name="chevronRight" :size="15" /></button>
        <button v-if="day !== today()" class="today" @click="day = today()">Сегодня</button>
      </div>
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
      <span class="azoom nodrag" title="Масштаб">
        <button title="Мельче" @click="setAppZoom(appZoom - 10)"><Icon name="chevronLeft" :size="12" /></button>
        <button class="zv" title="Сбросить" @click="setAppZoom(100)">{{ appZoom }}%</button>
        <button title="Крупнее" @click="setAppZoom(appZoom + 10)"><Icon name="chevronRight" :size="12" /></button>
      </span>
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
    <main v-if="settings">
      <Transition name="fade" mode="out-in">
        <DashboardView v-if="view === 'dashboard'" :settings="settings" @go="go" />
        <DayView v-else-if="view === 'day'" :day="day" :settings="settings" :focus-entry="focusEntry" @open-day="(d, id) => ((day = d), (focusEntry = id))" />
        <CalendarView v-else-if="view === 'calendar'" :day="day" :work-days="settings.schedule.workDays" @open="(d) => ((day = d), (view = 'day'))" />
        <LogView v-else-if="view === 'log'" :day="day" @show="view = 'day'" />
        <TasksView v-else-if="view === 'tasks'" :link-style="settings.ui.links.style" :work-days="settings.schedule.workDays" @settings="view = 'settings'" @open-day="(d) => ((day = d), (view = 'day'))" />
        <NotebookView v-else-if="view === 'notebook'" />
        <ReportsView v-else-if="view === 'reports'" @go="go" />
        <SheetView v-else-if="view === 'sheet'" :settings="settings" @go="go" />
        <ReleaseView v-else-if="view === 'release'" />
        <SettingsView v-else :settings="settings" @changed="onSettings" />
      </Transition>
    </main>
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
  align-items: center;
  gap: 4px;
  padding: 0 140px 0 10px; /* room for the native window controls */
  background: #12151d;
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
}
.nodrag,
.titlebar button,
.titlebar input {
  -webkit-app-region: no-drag;
}
.brand {
  display: flex;
  align-items: center;
  padding-right: 4px;
}
.titlebar button {
  cursor: default;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  padding: 3px 9px;
  font-size: 13px;
  color: #94a3b8;
}
.titlebar button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
}
.titlebar button.ico {
  padding: 0;
  width: 28px;
  height: 28px;
  justify-content: center;
}
.titlebar button.on {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
}
.menu {
  position: relative;
}
/* the section's actions: in the middle of the bar */
.tside {
  flex: 1 1 0;
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
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
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
  padding: 6px;
  background: #1a1e2a;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}
.dropdown button {
  text-align: left;
  color: #cbd5e1;
  padding: 6px 10px;
  border-radius: 6px;
}
.dropdown .sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
/* a compact segmented control: icons only */
.seg {
  display: flex;
  gap: 1px;
  padding: 2px;
  margin-left: 6px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
}
.seg button {
  width: 34px;
  height: 26px;
  padding: 0;
  justify-content: center;
  border-radius: 7px;
}
.titlebar .seg button.on {
  background: rgba(124, 108, 246, 0.22);
  color: #c7c2ff;
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
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  text-transform: capitalize;
  -webkit-app-region: no-drag;
}
.date:hover {
  background: rgba(255, 255, 255, 0.07);
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
.today {
  color: #a5b4fc !important;
}
.grow {
  flex: 1;
}
main {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
main:has(> .nb),
main:has(> .rep),
main:has(> .sh),
main:has(> .rel) {
  overflow: hidden;
}
.azoom {
  display: inline-flex;
  align-items: center;
  margin-right: 6px;
  border-radius: 7px;
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
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
.azoom .zv {
  min-width: 40px;
  font-variant-numeric: tabular-nums;
  color: #c7d2fe;
}
</style>
