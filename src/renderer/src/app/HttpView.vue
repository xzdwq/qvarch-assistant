<script setup lang="ts">
import Icon from '../components/Icon.vue'
import Markdown from '../components/Markdown.vue'
import { HTTP_HELP } from '../lib/httpHelp'
import HttpTree from './http/HttpTree.vue'
import HttpRequestPane from './http/HttpRequestPane.vue'
import HttpFolderPane from './http/HttpFolderPane.vue'
import { provideHttpView } from './http/httpViewContext'

/**
 * HTTP — a small Postman: requests in folders on the left; the open request — method, address, params, headers,
 * auth, the body (JSON / text / form), what runs before it (other requests + a script — e.g. a token into
 * {{token}}) and a script over the answer; the answer below. Everything is kept by itself.
 */
const { collection, side, helpOpen } = provideHttpView()
const { req, folder } = collection
const { sideW, sideHidden } = side
</script>

<template>
  <div class="hv tw:grid tw:grid-cols-[280px_minmax(0,1fr)] tw:h-full tw:min-h-0" :style="{ gridTemplateColumns: sideHidden ? 'minmax(0, 1fr)' : `${sideW}px minmax(0, 1fr)` }">
    <!-- the collection -->
    <HttpTree v-if="!sideHidden" />

    <!-- the request -->
    <HttpRequestPane v-if="req" :req="req" />
    <HttpFolderPane v-else-if="folder" :folder="folder" />
    <section v-else class="main empty tw:flex tw:flex-col tw:min-h-0 tw:min-w-0 tw:pt-10 tw:pr-14 tw:pb-12 tw:pl-14 tw:gap-8 tw:items-center tw:justify-center">
      <button v-if="sideHidden" class="sshow tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Показать панель запросов" @click="sideHidden = false"><Icon name="sidebar" :size="14" /></button>
      <p class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">Выберите запрос слева или создайте новый</p>
    </section>

    <Teleport to="body">
      <div v-if="helpOpen" class="hc-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[6vh] tw:bg-black/55" @mousedown.self="helpOpen = false">
        <div class="hc-help tw:flex tw:flex-col tw:w-[min(820px,calc(100vw-32px))] tw:max-h-[86vh] tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]">
          <div class="hc-hh tw:flex tw:items-center tw:justify-between tw:py-10 tw:px-14 tw:border-b tw:border-b-border"><span class="cap">Инструкция · HTTP</span><button class="ib tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Закрыть (Esc)" @click="helpOpen = false"><Icon name="x" :size="14" /></button></div>
          <div class="hc-hb tw:overflow-auto tw:pt-6 tw:pr-20 tw:pb-20 tw:pl-20" tabindex="-1" @keydown.esc="helpOpen = false"><Markdown :text="HTTP_HELP" /></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
