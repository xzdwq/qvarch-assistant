<script setup lang="ts">
import ImageMenu from '../components/ImageMenu.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppCommand } from '@shared/api'
import type { PublicSettings } from '@shared/types'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import { setKinds } from '../lib/palette'
import { setAttrDefs } from '../lib/attributes'
import SettingsView from './SettingsView.vue'
import WorkView from './WorkView.vue'
import NotebookView from './NotebookView.vue'
import ReleaseView from './ReleaseView.vue'
import ToolsView from './ToolsView.vue'
import HttpView from './HttpView.vue'
import TerminalView from './TerminalView.vue'
import TermDock from './terminal/TermDock.vue'
import TermSlot from './terminal/TermSlot.vue'
import { listenTermKey, termEver, termTarget } from '../lib/termDock'
import BrowserView from './BrowserView.vue'
import SeriesAsk from '../components/SeriesAsk.vue'
import StatusBar from '../components/StatusBar.vue'
import { todayKey } from '../lib/today'
import { setupLinks } from '../lib/links'
import { startBrowser } from '../lib/browser'
import { watchPwRec } from '../lib/pwrec'
import { startMcpBridge } from '../lib/mcpBridge'
import { startShellApprovals } from '../lib/shellApprovals'
import ShellApprovalDialog from '../components/ShellApprovalDialog.vue'
import { startChat } from '../lib/chat'
import { startAgents } from '../lib/agentTurns'
import { startHarnessDriver } from '../lib/harness/harnessDriver'
import { startIslandChat } from '../lib/islandChat'
import { chatPortLocal } from '../lib/chatPortLocal'
import { provideChatPort } from '@nb/blocks/chat/chatPort'
import { setChatSend } from '@nb/engine'
import { startAppLinks } from '../lib/appLinks'
import { startSharedFolders } from '@nb/workspace/sharedFolders'
import { startSharedRunResults } from '@nb/workspace/sharedRunResults'
import { startSharedAttachments } from '@nb/workspace/sharedAttachments'
import Popover from '../components/Popover.vue'
setupLinks()
// the browser's news from the start (a tab the app opens is placed even before the section is first shown)
startBrowser()
watchPwRec()
startMcpBridge()
// the notebook's shell scripts: asked about here whatever section is open (a schedule, the AI may run them)
startShellApprovals()
// the chats: their news from the start (a notification may open a chat's document any time)
startChat()
// this person's AI agents answer in the chats when called
startAgents()
startHarnessDriver()
startIslandChat()
// the chats every chat block, the feed and the comments of this window work with; a run's text sent into one too
provideChatPort(chatPortLocal)
setChatSend(chatPortLocal.send)
// the app's own links (a shared note — joined by its code when not here yet, a task, an event) open wherever clicked
startAppLinks()
// the shared folders kept in step from the start (not only once the notebook is opened)
startSharedFolders()
startSharedRunResults()
startSharedAttachments()

import { dayFocus, openDay, openHttp, openPlace, orderedViews, setMenu, showForRun, view, VIEWS } from '../lib/views'
import { placeOf } from '@shared/places'
const settings = ref<PublicSettings>()
const menuOpen = ref(false)

/** Opened from somewhere (a reminder, the island) — that section, not the menu's first one. */
let navigated = false
function onSettings(s: PublicSettings): void {
  settings.value = s
  setMenu(s.ui.menu)
  setKinds(s.kinds)
  setAttrDefs(s.attributes)
}
void window.qa.getSettings().then((s) => {
  onSettings(s)
  // the window opens on the first section of the user's menu
  if (!navigated) view.value = orderedViews(s.ui.menu).find((v) => !s.ui.menu.hidden.includes(v.id))?.id ?? 'work'
})

const offSettings = window.qa.onSettings(onSettings)
onBeforeUnmount(offSettings)
const off = window.qa.onNavigate((nav) => {
  navigated = true
  if (nav.run) return showForRun(nav.run)
  // no section or «day»: a day / a block is shown in Моя работа
  if (!nav.view || nav.view === 'day') {
    if (nav.day || nav.entryId) openDay(nav.day ?? todayKey.value, nav.entryId)
    else view.value = 'work'
  } else openPlace(nav.view)
})
onBeforeUnmount(off)

/** The «Ещё» menu's button (the menu — a popover by it). */
const menuBtn = ref<HTMLElement>()

function run(cmd: AppCommand): void {
  menuOpen.value = false
  window.qa.command(cmd)
}

/** The browser too: once opened it stays (its pages live in the main process; hidden in other sections). */
const brOpened = ref(false)
watch(view, (v) => v === 'browser' && (brOpened.value = true), { immediate: true })
/** The notes too: once opened they stay — a note shown again is as it was left (its scroll, its blocks' pages). */
const nbOpened = ref(false)
watch(view, (v) => v === 'notebook' && (nbOpened.value = true), { immediate: true })
/** «Инструменты» too: the browser moved there lives in it. */
const toolsOpened = ref(false)
watch(view, (v) => v === 'tools' && (toolsOpened.value = true), { immediate: true })
// a section moved into «Инструменты» lives there now (never twice)
watch(
  () => settings.value?.ui.menu,
  (m) => {
    if (!m) return
    if (placeOf(m, 'browser') === 'tools') brOpened.value = false
    if (placeOf(m, 'notebook') === 'tools') nbOpened.value = false
  },
)
// Ctrl+` — the terminal's panel, from any section
let stopTermKey: (() => void) | undefined
onMounted(() => (stopTermKey = listenTermKey()))
onBeforeUnmount(() => stopTermKey?.())
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
    <ShellApprovalDialog />
    <main class="tw:flex-1 tw:overflow-auto tw:min-h-0 tw:[&:has(>_.tools)]:not-[&:has(>_.nb)]:not-[&:has(>_.rep)]:not-[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.nb)]:not-[&:has(>_.rep)]:not-[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.rep)]:not-[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.sh)]:not-[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.rel)]:not-[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.ps)]:not-[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.tv)]:not-[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.hv)]:not-[&:has(>_.termslot)]:overflow-hidden tw:[&:has(>_.termslot)]:overflow-hidden" v-if="settings" :style="{ zoom: appZoom / 100 }">
      <Transition name="fade" mode="out-in">
        <div v-if="view === 'notebook'" class="termslot tw:hidden"></div>
        <WorkView v-else-if="view === 'work'" :settings="settings" :focus="dayFocus" @settings="view = 'settings'" />
        <ReleaseView v-else-if="view === 'release'" />
        <HttpView v-else-if="view === 'http'" />
        <div v-else-if="view === 'terminal'" class="termslot tw:hidden"></div>
        <div v-else-if="view === 'browser'" class="termslot tw:hidden"></div>
        <div v-else-if="view === 'tools'" class="termslot tw:hidden"></div>
        <SettingsView v-else :settings="settings" @changed="onSettings" />
      </Transition>
      <!-- the terminal's section: the one terminal is moved in while shown here (else it is in the bottom panel) -->
      <TermSlot v-show="view === 'terminal'" :active="view === 'terminal'" class="termkeep tw:[&&]:h-full" />
      <div v-if="nbOpened" v-show="view === 'notebook'" class="nbkeep tw:h-full"><NotebookView :active="view === 'notebook'" /></div>
      <BrowserView v-if="brOpened" v-show="view === 'browser'" class="termkeep tw:[&&]:h-full" :active="view === 'browser'" @open-http="openHttp" />
      <div v-if="toolsOpened" v-show="view === 'tools'" class="toolskeep tw:h-full"><ToolsView :menu="settings.ui.menu" /></div>
    </main>
    <TermDock :zoom="appZoom" />
    <StatusBar :section="sectionName" @browser="openPlace('browser')" />
    <!-- the one terminal: in the bottom panel or in its section, wherever it is shown -->
    <Teleport v-if="termEver && termTarget" :to="termTarget"><TerminalView class="tw:[&&]:h-full" /></Teleport>
      <ImageMenu />
  </div>
</template>

<style scoped src="./App.css"></style>
