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
import Popover from '../components/Popover.vue'
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
/** The old Таймлайн section's names: a day / a block asked for there is shown in Моя работа. */
const DAY_VIEW_ALIASES: ReadonlySet<string> = new Set(['day', 'log'])
const off = window.qa.onNavigate((nav) => {
  navigated = true
  const v = nav.view as string | undefined
  if (!v || DAY_VIEW_ALIASES.has(v)) {
    if (nav.day || nav.entryId) openDay(nav.day ?? todayKey.value, nav.entryId)
    else view.value = 'work'
  } else view.value = v as View
})
onBeforeUnmount(off)

/** The «Ещё» menu's button (the menu — a popover by it). */
const menuBtn = ref<HTMLElement>()

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
/** The sections one may ask for from inside another (the scenario recording: to the Браузер and back to the note). */
const VIEWS_ASKED_FROM_INSIDE: ReadonlySet<string> = new Set<View>(['notebook', 'browser', 'work'])
const onView = (e: Event) => {
  const v = (e as CustomEvent<string>).detail
  if (VIEWS_ASKED_FROM_INSIDE.has(v)) view.value = v as View
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
  <div class="shell tw:flex tw:flex-col tw:h-screen">
    <header class="titlebar tw:relative tw:z-50 tw:flex-none tw:h-38 tw:flex tw:items-stretch tw:gap-4 tw:pt-0 tw:pr-140 tw:pb-0 tw:pl-0 tw:bg-bg tw:select-none tw:@container">
      <div class="tside tw:flex-[1_0_auto] tw:min-w-0 tw:flex tw:items-center tw:gap-4">
      <div class="brand tw:[-webkit-app-region:drag] tw:flex tw:items-center tw:gap-7 tw:pt-0 tw:pr-14 tw:pb-0 tw:pl-12 tw:border-r tw:border-r-border tw:text-accent">
        <Icon name="qlogo" :size="17" :stroke="3.8" />
        <b class="tw:font-data tw:text-[11.5px] tw:font-bold tw:tracking-[0.14em] tw:text-text-hi tw:@max-[980px]:hidden">QVARCH</b>
      </div>

      <nav class="seg nodrag tw:flex tw:items-stretch tw:gap-0" aria-label="Разделы">
        <button class="tw:cursor-default tw:inline-flex tw:items-center tw:gap-6 tw:bg-transparent tw:text-[12.5px] tw:text-muted tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:not-[&.on]:text-text tw:relative tw:h-full tw:min-w-38 tw:py-0 tw:px-11 tw:justify-center tw:border-0 tw:rounded-none tw:[&&]:border-r tw:[&&]:border-r-border tw:[&.on]:bg-panel tw:[&.on]:text-accent-fg tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-0 tw:[&.on]:after:right-0 tw:[&.on]:after:top-0 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" v-for="v in menu" :key="v.id" :class="{ on: view === v.id }" :title="v.label" :aria-label="v.label" @click="view = v.id">
          <Icon :name="v.icon" :size="15" /><span v-if="view === v.id" class="vl tw:font-data tw:text-[11px] tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:@max-[980px]:hidden">{{ v.label }}</span>
        </button>
      </nav>

      <span class="dragfill tw:[-webkit-app-region:drag] tw:flex-1 tw:self-stretch tw:min-w-12"></span>
      </div>

      <div class="tside r tw:flex-[1_0_auto] tw:min-w-0 tw:flex tw:items-center tw:gap-4 tw:justify-end">
      <span class="dragfill tw:[-webkit-app-region:drag] tw:flex-1 tw:self-stretch tw:min-w-12"></span>
      <button class="ico nodrag tw:cursor-default tw:inline-flex tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:rounded-r2 tw:text-[12.5px] tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text tw:p-0 tw:w-28 tw:h-28 tw:justify-center" :class="{ spin: reloading }" title="Обновить приложение (как обновление страницы) — несохранённое сохраняется" aria-label="Обновить приложение" @click="reloadApp"><Icon name="refresh" :size="15" /></button>
      <ZoomChip class="azoom tw:[&&]:cursor-default tw:[&&]:inline-flex tw:[&&]:items-center tw:[&&]:gap-6 tw:[&&]:bg-transparent tw:[&&]:not-hover:border tw:[&&]:not-hover:border-transparent tw:[&&]:rounded-r2 tw:[&&]:py-3 tw:[&&]:px-9 tw:[&&]:text-[12.5px] tw:[&&]:not-hover:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text tw:mr-6 tw:overflow-hidden" :model-value="appZoom" :min="50" :max="200" title="Масштаб окна · колесо — изменить, клик — 100%" @update:model-value="setAppZoom" />
      <button class="ico nodrag tw:cursor-default tw:inline-flex tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:rounded-r2 tw:text-[12.5px] tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text tw:p-0 tw:w-28 tw:h-28 tw:justify-center tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" :class="{ on: view === 'settings' }" title="Настройки" aria-label="Настройки" @click="view = 'settings'">
        <Icon name="settings" :size="16" />
      </button>
      <div class="menu nodrag tw:relative">
        <button ref="menuBtn" class="ico tw:cursor-default tw:inline-flex tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:rounded-r2 tw:text-[12.5px] tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text tw:p-0 tw:w-28 tw:h-28 tw:justify-center tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" :class="{ on: menuOpen }" title="Ещё" aria-label="Ещё" @click="menuOpen = !menuOpen"><Icon name="more" :size="16" /></button>
        <Popover v-model:open="menuOpen" :anchor="menuBtn" :width="280" :chrome="0" transition="pop" class="dropdown tb-menu tw:p-4 tw:overflow-y-auto tw:bg-pop tw:border tw:border-border-2 tw:rounded-r3 tw:shadow-pop tw:flex tw:flex-col">
            <button class="tw:cursor-default tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:text-[12.5px] tw:text-left tw:text-text-2 tw:py-6 tw:px-10 tw:rounded-r2 tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text" @click="run('island-toggle')"><Icon name="layers" :size="14" />Показать / скрыть island</button>
            <button class="tw:cursor-default tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:text-[12.5px] tw:text-left tw:text-text-2 tw:py-6 tw:px-10 tw:rounded-r2 tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text" @click="run('island-reset')"><Icon name="move" :size="14" />Вернуть island наверх по центру</button>
            <div class="sep tw:h-1 tw:my-4 tw:mx-6 tw:bg-border"></div>
            <button class="tw:cursor-default tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:text-[12.5px] tw:text-left tw:text-text-2 tw:py-6 tw:px-10 tw:rounded-r2 tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text" @click="run('open-data-folder')"><Icon name="external" :size="14" />Открыть папку с данными</button>
            <button class="tw:cursor-default tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:text-[12.5px] tw:text-left tw:text-text-2 tw:py-6 tw:px-10 tw:rounded-r2 tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text" @click="run('devtools')"><Icon name="code" :size="14" />Инструменты разработчика</button>
            <div class="sep tw:h-1 tw:my-4 tw:mx-6 tw:bg-border"></div>
            <button class="tw:cursor-default tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:bg-transparent tw:border tw:border-transparent tw:text-[12.5px] tw:text-left tw:text-text-2 tw:py-6 tw:px-10 tw:rounded-r2 tw:hover:enabled:bg-hover tw:hover:enabled:border-transparent tw:hover:enabled:text-text" @click="run('quit')"><Icon name="x" :size="14" />Выход <span class="muted">(трекинг остановится)</span></button>
        </Popover>
      </div>
      </div>
    </header>

    <SeriesAsk />
    <main class="tw:flex-1 tw:overflow-auto tw:min-h-0 tw:[&:has(>_.tools)]:not-[&:has(>_.nb)]:not-[&:has(>_.rep)]:not-[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.nb)]:not-[&:has(>_.rep)]:not-[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.rep)]:not-[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.termslot)]:overflow-hidden" v-if="settings" :style="{ zoom: appZoom / 100 }">
      <Transition name="fade" mode="out-in">
        <NotebookView v-if="view === 'notebook'" />
        <WorkView v-else-if="view === 'work'" :settings="settings" :focus="focus" @settings="view = 'settings'" />
        <ReleaseView v-else-if="view === 'release'" />
        <HttpView v-else-if="view === 'http'" />
        <div v-else-if="view === 'terminal'" class="termslot tw:hidden"></div>
        <div v-else-if="view === 'browser'" class="termslot tw:hidden"></div>
        <ToolsView v-else-if="view === 'tools'" />
        <SettingsView v-else :settings="settings" @changed="onSettings" />
      </Transition>
      <TerminalView v-if="termOpened" v-show="view === 'terminal'" class="termkeep tw:[&&]:h-full" />
      <BrowserView v-if="brOpened" v-show="view === 'browser'" class="termkeep tw:[&&]:h-full" :active="view === 'browser'" @open-http="openHttp" />
    </main>
    <StatusBar :section="sectionName" @terminal="view = 'terminal'" @browser="view = 'browser'" />
      <ImageMenu />
  </div>
</template>

<style scoped src="./App.css"></style>
