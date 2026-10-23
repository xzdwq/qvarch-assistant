<script setup lang="ts">
import ImageMenu from '../components/ImageMenu.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppCommand } from '@shared/api'
import type { PublicSettings } from '@shared/types'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import { setKinds } from '../lib/palette'
import SettingsView from './SettingsView.vue'
import WorkView from './WorkView.vue'
import NotebookView from './NotebookView.vue'
import ReleaseView from './ReleaseView.vue'
import ToolsView from './ToolsView.vue'
import HttpView from './HttpView.vue'
import TerminalView from './TerminalView.vue'
import BrowserView from './BrowserView.vue'
import SeriesAsk from '../components/SeriesAsk.vue'
import StatusBar from '../components/StatusBar.vue'
import { todayKey } from '../lib/today'
import { setupLinks } from '../lib/links'
import { startBrowser } from '../lib/browser'
import { watchPwRec } from '../lib/pwrec'
import { startMcpBridge } from '../lib/mcpBridge'
import { placeFloat, useAnchor } from '../lib/floating'
setupLinks()
// the browser's news from the start (a tab the app opens is placed even before the section is first shown)
startBrowser()
watchPwRec()
startMcpBridge()

import { orderedViews, VIEWS, type View } from '../lib/views'
const view = ref<View>('work')
/** A day (and a block on it) to show — Моя работа opens it. */
const focus = ref<{ day: string; entryId?: string; n: number }>()
let focusN = 0
const openDay = (day: string, entryId?: string) => {
  focus.value = { day: day || todayKey.value, entryId, n: ++focusN }
  view.value = 'work'
}
const settings = ref<PublicSettings>()
const menuOpen = ref(false)

/** Opened from somewhere (a reminder, the island) — that section, not the menu's first one. */
let navigated = false
void window.qa.getSettings().then((s) => {
  settings.value = s
  setKinds(s.kinds)
  // the window opens on the first section of the user's menu
  if (!navigated) view.value = orderedViews(s.ui.menu).find((v) => !s.ui.menu.hidden.includes(v.id))?.id ?? 'work'
})

function onSettings(s: PublicSettings): void {
  settings.value = s
  setKinds(s.kinds)
}

const offSettings = window.qa.onSettings(onSettings)
onBeforeUnmount(offSettings)
const off = window.qa.onNavigate((nav) => {
  navigated = true
  // (the old Таймлайн section: a day / a block is shown in Моя работа)
  const v = nav.view as string | undefined
  if (!v || v === 'day' || v === 'log') {
    if (nav.day || nav.entryId) openDay(nav.day ?? todayKey.value, nav.entryId)
    else view.value = 'work'
  } else view.value = v as View
})
onBeforeUnmount(off)

/** The «Ещё» menu: over everything (teleported), kept by its button. */
const menuBtn = ref<HTMLElement>()
const menuStyle = ref<Record<string, string>>({ position: 'fixed', left: '-10000px', top: '0px' })
useAnchor(menuOpen, menuBtn, () => {
  if (!menuBtn.value) return
  const f = placeFloat(menuBtn.value, 280, false, 0)
  menuStyle.value = { ...f.style, maxHeight: `${f.maxH}px` }
})
const away = (e: PointerEvent) => menuOpen.value && !menuBtn.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.tb-menu') && (menuOpen.value = false)
onMounted(() => window.addEventListener('pointerdown', away, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', away, true))

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
// a section asked for from inside one (the scenario recording: to the Браузер and back to the note)
const onView = (e: Event) => {
  const v = (e as CustomEvent<string>).detail
  if (v === 'notebook' || v === 'browser' || v === 'work') view.value = v as View
}
onMounted(() => window.addEventListener('qa:view', onView))
onBeforeUnmount(() => window.removeEventListener('qa:view', onView))
// an event opened in Моя работа (from a note's event card)
const onOpenDay = (e: Event) => {
  const d = (e as CustomEvent<{ day: string; id?: string }>).detail
  if (d?.day) openDay(d.day, d.id)
}
onMounted(() => window.addEventListener('qa:open-day', onOpenDay))
onBeforeUnmount(() => window.removeEventListener('qa:open-day', onOpenDay))
const menu = computed(() => orderedViews(settings.value?.ui.menu).filter((v) => v.id === view.value || !settings.value?.ui.menu.hidden.includes(v.id)))

const sectionName = computed(() => (view.value === 'settings' ? 'Настройки' : (VIEWS.find((v) => v.id === view.value)?.label ?? '')))

/** The window reloaded (as F5 in a browser): the notes' typing is saved first. */
const reloading = ref(false)
async function reloadApp(): Promise<void> {
  if (reloading.value) return
  // a turn of the icon: something is happening
  reloading.value = true
  try {
    const { saveAll } = await import('../lib/notebook')
    await Promise.race([saveAll(), new Promise((r) => setTimeout(r, 1500))])
  } catch {
    // reload anyway
  }
  await new Promise((r) => setTimeout(r, 450))
  // by the main process: the window itself never navigates (a guard against files dropped on it)
  window.qa.command('reload')
}

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

      <span class="dragfill"></span>
      </div>

      <div class="tside r">
      <span class="dragfill"></span>
      <button class="ico nodrag" :class="{ spin: reloading }" title="Обновить приложение (как обновление страницы) — несохранённое сохраняется" aria-label="Обновить приложение" @click="reloadApp"><Icon name="refresh" :size="15" /></button>
      <ZoomChip class="azoom" :model-value="appZoom" :min="50" :max="200" title="Масштаб окна · колесо — изменить, клик — 100%" @update:model-value="setAppZoom" />
      <button class="ico nodrag" :class="{ on: view === 'settings' }" title="Настройки" aria-label="Настройки" @click="view = 'settings'">
        <Icon name="settings" :size="16" />
      </button>
      <div class="menu nodrag">
        <button ref="menuBtn" class="ico" :class="{ on: menuOpen }" title="Ещё" aria-label="Ещё" @click="menuOpen = !menuOpen"><Icon name="more" :size="16" /></button>
        <Teleport to="body">
        <Transition name="pop">
          <div v-if="menuOpen" class="dropdown tb-menu" :style="menuStyle">
            <button @click="run('island-toggle')"><Icon name="layers" :size="14" />Показать / скрыть island</button>
            <button @click="run('island-reset')"><Icon name="move" :size="14" />Вернуть island наверх по центру</button>
            <div class="sep"></div>
            <button @click="run('open-data-folder')"><Icon name="external" :size="14" />Открыть папку с данными</button>
            <button @click="run('devtools')"><Icon name="code" :size="14" />Инструменты разработчика</button>
            <div class="sep"></div>
            <button @click="run('quit')"><Icon name="x" :size="14" />Выход <span class="muted">(трекинг остановится)</span></button>
          </div>
        </Transition>
        </Teleport>
      </div>
      </div>
    </header>

    <SeriesAsk />
    <main v-if="settings" :style="{ zoom: appZoom / 100 }">
      <Transition name="fade" mode="out-in">
        <NotebookView v-if="view === 'notebook'" />
        <WorkView v-else-if="view === 'work'" :settings="settings" :focus="focus" @settings="view = 'settings'" />
        <ReleaseView v-else-if="view === 'release'" />
        <HttpView v-else-if="view === 'http'" />
        <div v-else-if="view === 'terminal'" class="termslot"></div>
        <div v-else-if="view === 'browser'" class="termslot"></div>
        <ToolsView v-else-if="view === 'tools'" />
        <SettingsView v-else :settings="settings" @changed="onSettings" />
      </Transition>
      <TerminalView v-if="termOpened" v-show="view === 'terminal'" class="termkeep" />
      <BrowserView v-if="brOpened" v-show="view === 'browser'" class="termkeep" :active="view === 'browser'" @open-http="openHttp" />
    </main>
    <StatusBar :section="sectionName" @terminal="view = 'terminal'" @browser="view = 'browser'" />
      <ImageMenu />
  </div>
</template>

<style scoped>
.ico.spin :deep(svg) {
  animation: qa-spin 0.6s linear infinite;
}
@keyframes qa-spin {
  to {
    transform: rotate(360deg);
  }
}
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
/* the «Ещё» menu — teleported to <body> (placed by placeFloat) */
.dropdown {
  padding: 4px;
  overflow-y: auto;
  background: var(--pop);
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
}
/* (out of the title bar: its button look is given here) */
.dropdown button {
  cursor: default;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  font-size: 12.5px;
  text-align: left;
  color: var(--text-2);
  padding: 6px 10px;
  border-radius: var(--r2);
}
.dropdown button:hover:not(:disabled) {
  background: var(--hover);
  border-color: transparent;
  color: var(--text);
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
main:has(> .tools),
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
