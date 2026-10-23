<script setup lang="ts">
import { bLayout } from '../lib/browser'
import BookmarkBar from './browser/BookmarkBar.vue'
import BookmarkEditDialog from './browser/BookmarkEditDialog.vue'
import BookmarkFolderPopover from './browser/BookmarkFolderPopover.vue'
import { provideBrowserView } from './browser/browserViewContext'
import BrowserPane from './browser/BrowserPane.vue'
import BrowserSidePanel from './browser/BrowserSidePanel.vue'
import CertPopover from './browser/CertPopover.vue'
import HistoryDialog from './browser/HistoryDialog.vue'
import LoginDialog from './browser/LoginDialog.vue'
import PasswordsDialog from './browser/PasswordsDialog.vue'
import PwRecBar from './browser/PwRecBar.vue'
import SwaggerToHttpDialog from './browser/SwaggerToHttpDialog.vue'
import TransferDialog from './browser/TransferDialog.vue'

/**
 * Браузер: tabs in one or two panes (each pane its own tabs, like the terminal), the address line with
 * suggestions, bookmarks, a start page; the recording of the requests the pages send (XHR / fetch) — picked ones
 * go to the HTTP section as a ready chain. The pages themselves are native views the main process puts where
 * this section reports. Its parts are in ./browser/ and share the section's state (browserViewContext).
 */
const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ openHttp: [requestId: string] }>()
const view = provideBrowserView(
  () => props.active,
  (id) => emit('openHttp', id),
)
const { byId } = view.tabs
const { panesEl, tabDrag, onSplitResize } = view.paneDrag
const { recOpen, recW } = view.side
const { onDragOver, onDrop } = view.site
const { bmGhost } = view.bookmarkDrag
</script>

<template>
  <div class="bv tw:grid tw:h-full tw:min-h-0" :style="{ gridTemplateColumns: recOpen ? `minmax(0, 1fr) ${recW}px` : 'minmax(0, 1fr)' }" @dragover="onDragOver" @drop="onDrop">
    <section class="bmain tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">
      <!-- a Playwright scenario being recorded (inside the one root: the app positions and hides it) -->
      <PwRecBar />
      <!-- bookmarks, the recording -->
      <BookmarkBar />

      <div :ref="(el) => (panesEl = el as HTMLElement)" class="npanes tw:relative tw:flex-1 tw:min-w-0 tw:min-h-0 tw:flex">
        <template v-for="(p, pi) in bLayout.panes" :key="p.id">
          <div v-if="pi" class="psplit tw:flex-none tw:w-5 tw:my-0 tw:-mx-2 tw:py-0 tw:px-2 tw:bg-border tw:[&&]:bg-clip-content tw:cursor-col-resize tw:z-2 tw:hover:bg-accent/85" title="Потяните — ширина" @pointerdown.prevent="onSplitResize"></div>
          <BrowserPane :p="p" :pi="pi" />
        </template>
      </div>
    </section>

    <!-- the side panel: «Проверка», the recorded requests, «Карта API», the hooks -->
    <BrowserSidePanel />

    <Teleport to="body">
      <!-- a bookmark folder's contents -->
      <BookmarkFolderPopover />
      <div v-if="bmGhost" class="bghost bv-ignore tw:fixed tw:z-3000 tw:py-4 tw:px-10 tw:border tw:border-accent tw:rounded-r2 tw:bg-panel tw:shadow-pop tw:text-text-hi tw:text-[12px] tw:pointer-events-none" :style="{ left: bmGhost.x + 12 + 'px', top: bmGhost.y + 10 + 'px' }">{{ bmGhost.title }}</div>
      <!-- the site's connection -->
      <CertPopover />
      <!-- the dragged tab follows the pointer -->
      <div v-if="tabDrag" class="bghost bv-ignore tw:fixed tw:z-3000 tw:py-4 tw:px-10 tw:border tw:border-accent tw:rounded-r2 tw:bg-panel tw:shadow-pop tw:text-text-hi tw:text-[12px] tw:pointer-events-none" :style="{ left: tabDrag.x + 12 + 'px', top: tabDrag.y + 10 + 'px' }">{{ byId(tabDrag.id)?.title }}</div>
      <!-- the chain into the HTTP section -->
      <TransferDialog />
      <HistoryDialog />
      <PasswordsDialog />
      <!-- Swagger → HTTP: what to fill in -->
      <SwaggerToHttpDialog />
      <!-- a site asks to sign in -->
      <LoginDialog />
      <!-- a bookmark / a folder -->
      <BookmarkEditDialog />
    </Teleport>
  </div>
</template>

<style src="./BrowserView.global.css"></style>
