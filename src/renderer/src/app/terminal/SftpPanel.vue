<script setup lang="ts">
/**
 * An SSH tab's file explorer beside its terminal (as MobaXterm's): the path in crumbs, the folder's entries; files
 * dropped from Windows' Explorer go up to the server, picked ones come down; a right click — the entry's actions.
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { TermSession } from '@shared/terminal'
import type { RemoteEntry } from '@shared/ssh/remoteFiles'
import { remoteCrumbs } from '@shared/ssh/remotePath'
import { sizeText } from '@shared/ssh/transfers'
import Icon from '../../components/Icon.vue'
import Popover from '../../components/Popover.vue'
import { vFocusSelect as vFocus } from '../../lib/focusSelect'
import { openWhile } from '../../lib/usePopover'
import SftpTransfers from './SftpTransfers.vue'
import { useTermView } from './termViewContext'

const props = defineProps<{ session: TermSession }>()
const files = useTermView().files
const ex = files.explorerOf(props.session)!
onUnmounted(() => files.forget(props.session.id))
// the terminal's folder changed, or a command ended (a prompt): the explorer follows / reads its folder again
watch(
  () => props.session.info.cwd,
  (cwd) => files.followTerminal(ex, cwd),
)
watch(
  () => props.session.busy,
  (busy, was) => was && !busy && files.followTerminal(ex, props.session.info.cwd),
)
/** The terminal tells its folder (the hook took): going together means something. */
const cwdKnown = computed(() => !!props.session.info.cwd)

const crumbs = computed(() => remoteCrumbs(ex.path || '/'))
const when = (ms: number) => (ms ? new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '')
const isDir = (e: RemoteEntry) => e.kind === 'dir' || !!e.toDir

/** Files are dragged over the list from Windows' Explorer. */
const dropping = ref(false)
function onDrop(ev: DragEvent): void {
  dropping.value = false
  files.drop(ex, ev)
}

/** An entry's (or the folder's) menu at the pointer. */
const menu = ref<{ e?: RemoteEntry; at: { x: number; y: number } }>()
const menuOpen = openWhile(menu)
function onMenu(ev: MouseEvent, e?: RemoteEntry): void {
  if (e && !ex.selected.has(e.path)) files.select(ex, e, false)
  menu.value = { e, at: { x: ev.clientX, y: ev.clientY } }
}
/** The menu's items: for the entries picked, or for the folder (no entry under the pointer). */
const MENU: Array<{ label: string; icon: string; entry: boolean; run: (e?: RemoteEntry) => void }> = [
  { label: 'Открыть', icon: 'external', entry: true, run: (e) => e && void files.open(ex, e) },
  { label: 'Скачать в «Загрузки»', icon: 'download', entry: true, run: (e) => void files.download(ex, files.picked(ex, e), false) },
  { label: 'Скачать в…', icon: 'download', entry: true, run: (e) => void files.download(ex, files.picked(ex, e), true) },
  { label: 'Переименовать', icon: 'pencil', entry: true, run: (e) => e && files.startNaming(ex, 'rename', e) },
  { label: 'Копировать путь', icon: 'copy', entry: true, run: (e) => e && void navigator.clipboard.writeText(e.path) },
  { label: 'Удалить', icon: 'trash', entry: true, run: (e) => void files.remove(ex, files.picked(ex, e)) },
  { label: 'Новая папка', icon: 'folderPlus', entry: false, run: () => files.startNaming(ex, 'mkdir') },
  { label: 'Загрузить сюда…', icon: 'upload', entry: false, run: () => void files.pickUpload(ex) },
  { label: 'Копировать путь папки', icon: 'copy', entry: false, run: () => void navigator.clipboard.writeText(ex.path) },
  { label: 'Обновить', icon: 'refresh', entry: false, run: () => void files.refresh(ex) },
]
const menuItems = computed(() => MENU.filter((m) => m.entry === !!menu.value?.e))

/** The list's keys: Enter opens, Backspace goes up, Delete removes, F2 renames, F5 reads again. */
const KEYS: Record<string, () => void> = {
  Enter: () => {
    const [e] = files.picked(ex)
    if (e) void files.open(ex, e)
  },
  Backspace: () => void files.up(ex),
  Delete: () => void files.remove(ex, files.picked(ex)),
  F2: () => {
    const [e] = files.picked(ex)
    if (e) files.startNaming(ex, 'rename', e)
  },
  F5: () => void files.refresh(ex),
}
function onKey(ev: KeyboardEvent): void {
  if (!Object.hasOwn(KEYS, ev.key)) return
  ev.preventDefault()
  KEYS[ev.key]()
}

/** The panel's width dragged by its left edge. */
function dragWidth(e: PointerEvent): void {
  e.preventDefault()
  const x0 = e.clientX
  const w0 = files.width.value
  const move = (ev: PointerEvent) => (files.width.value = Math.min(720, Math.max(240, w0 - (ev.clientX - x0))))
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
  <aside class="tw:relative tw:flex-none tw:flex tw:flex-col tw:min-h-0 tw:ml-8 tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:overflow-hidden" :style="{ width: `${files.width.value}px` }">
    <span class="tw:absolute tw:top-0 tw:-left-1 tw:bottom-0 tw:z-3 tw:w-5 tw:cursor-col-resize tw:hover:bg-accent-line" @pointerdown="dragWidth"></span>
    <!-- the actions over the folder -->
    <div class="tw:flex-none tw:flex tw:items-center tw:gap-2 tw:h-30 tw:px-4 tw:border-b tw:border-b-border">
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Вверх (Backspace)" @click="files.up(ex)"><Icon name="chevronLeft" :size="13" /></button>
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Домой" @click="files.home(ex)"><Icon name="dashboard" :size="13" /></button>
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Обновить (F5)" @click="files.refresh(ex)"><Icon name="refresh" :size="13" /></button>
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Новая папка" @click="files.startNaming(ex, 'mkdir')"><Icon name="folderPlus" :size="13" /></button>
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Загрузить файлы на сервер (или перетащите их сюда)" @click="files.pickUpload(ex)"><Icon name="upload" :size="13" /></button>
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:disabled:opacity-35" title="Скачать выбранное в «Загрузки»" :disabled="!ex.selected.size" @click="files.download(ex, files.picked(ex), false)"><Icon name="download" :size="13" /></button>
      <span class="tw:flex-1"></span>
      <button
        class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:disabled:opacity-35"
        :class="{ on: ex.sync && cwdKnown }"
        :disabled="!cwdKnown"
        :title="cwdKnown ? (ex.sync ? 'Вместе с терминалом: проводник идёт за папкой терминала, папка, открытая здесь, — в терминал (cd). Нажмите — раздельно' : 'Раздельно с терминалом. Нажмите — вместе') : 'Папка терминала неизвестна: оболочка не bash / zsh, или слежение выключено в настройках сессии'"
        @click="files.setSync(ex, !ex.sync)"
      ><Icon name="link" :size="13" /></button>
      <i v-if="ex.loading" class="tw:w-10 tw:h-10 tw:mr-4 tw:border-2 tw:border-accent tw:[&&]:border-r-transparent tw:rounded-[50%] tw:animate-[Shared-spin_0.8s_linear_infinite]"></i>
      <button class="tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Скрыть проводник" @click="files.hidden.value = true"><Icon name="x" :size="12" /></button>
    </div>
    <!-- where it is: the last crumbs kept when the path is long -->
    <div class="tw:flex-none tw:flex tw:items-center tw:justify-end tw:h-26 tw:px-6 tw:overflow-hidden tw:whitespace-nowrap tw:font-data tw:text-[11.5px]" :title="ex.path">
      <template v-for="(c, i) in crumbs" :key="c.path">
        <span v-if="i > 0 && crumbs[i - 1].name !== '/'" class="tw:flex-none tw:text-dim">/</span>
        <button class="tw:flex-none tw:px-3 tw:border-0 tw:rounded-r1 tw:bg-transparent tw:text-text-2 tw:[font:inherit] tw:hover:bg-hover tw:hover:text-accent-fg tw:[&.last]:text-text-hi tw:[&.last]:font-semibold" :class="{ last: i === crumbs.length - 1 }" @click="files.go(ex, c.path)">{{ c.name }}</button>
      </template>
    </div>
    <form v-if="ex.naming" class="tw:flex-none tw:flex tw:items-center tw:gap-6 tw:px-6 tw:pb-6" @submit.prevent="files.finishNaming(ex)">
      <Icon :name="ex.naming.kind === 'mkdir' ? 'folderPlus' : 'pencil'" :size="12" class="tw:flex-none tw:text-muted" />
      <input v-model="ex.naming.value" v-focus class="tw:flex-1 tw:min-w-0 tw:h-24 tw:font-data tw:text-[12px]" spellcheck="false" :placeholder="ex.naming.kind === 'mkdir' ? 'Имя новой папки' : 'Новое имя'" @keydown.esc="ex.naming = undefined" @blur="files.finishNaming(ex)" />
    </form>
    <!-- the folder's entries: files dropped here go up to it -->
    <div
      class="tw:relative tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:outline-none tw:[&.drop]:bg-accent/10 tw:[&.drop]:[outline:2px_dashed_var(--accent)] tw:[&.drop]:-outline-offset-4"
      :class="{ drop: dropping }"
      tabindex="0"
      @keydown="onKey"
      @dragover.prevent="dropping = true"
      @dragleave.self="dropping = false"
      @drop.prevent="onDrop"
      @contextmenu.self.prevent="onMenu($event)"
    >
      <div
        v-for="e in ex.listing?.entries ?? []"
        :key="e.path"
        class="tw:flex tw:items-center tw:gap-6 tw:h-24 tw:px-8 tw:text-[12px] tw:cursor-default tw:select-none tw:hover:not-[&.on]:bg-hover tw:[&.on]:bg-accent/20 tw:[&.on]:text-text-hi"
        :class="{ on: ex.selected.has(e.path) }"
        :title="`${e.name}\n${e.rights} · ${when(e.mtime)}${isDir(e) ? '' : ` · ${sizeText(e.size)}`}`"
        @click="files.select(ex, e, $event.ctrlKey || $event.metaKey)"
        @dblclick="files.open(ex, e)"
        @contextmenu.prevent="onMenu($event, e)"
      >
        <Icon :name="isDir(e) ? 'folder' : 'file'" :size="13" class="tw:flex-none" :class="isDir(e) ? 'tw:text-warn' : 'tw:text-muted'" />
        <span class="tw:flex-1 tw:min-w-0 tw:truncate" :class="{ 'tw:italic': e.kind === 'link' }">{{ e.name }}</span>
        <span v-if="!isDir(e)" class="tw:flex-none tw:text-muted tw:font-data tw:text-[11px]">{{ sizeText(e.size) }}</span>
      </div>
      <p v-if="ex.listing && !ex.listing.entries.length" class="tw:m-10 tw:text-muted tw:text-[11.5px]">Папка пуста — перетащите сюда файлы, чтобы загрузить</p>
      <p v-if="ex.listing?.cut" class="tw:m-10 tw:text-muted tw:text-[11.5px]">Показаны первые {{ ex.listing.entries.length }}, ещё {{ ex.listing.cut }} не показано</p>
    </div>
    <p v-if="ex.error" class="tw:flex-none tw:m-0 tw:py-4 tw:px-8 tw:border-t tw:border-t-border tw:text-down-fg tw:text-[11.5px] tw:wrap-anywhere">{{ ex.error }}</p>
    <SftpTransfers :session-id="ex.sessionId" />

    <Popover v-model:open="menuOpen" :anchor="menu?.at" :width="220" class="tw:fixed tw:z-3000 tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
      <template #default="{ close }">
        <button v-for="m in menuItems" :key="m.label" class="tw:flex tw:items-center tw:gap-8 tw:h-28 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" @click="m.run(menu?.e), close()">
          <Icon :name="m.icon" :size="12" class="tw:text-muted" />{{ m.label }}
        </button>
      </template>
    </Popover>
  </aside>
</template>
