<script setup lang="ts">
import ApiMapPanel from '../../components/ApiMapPanel.vue'
import CheckPanel from '../../components/CheckPanel.vue'
import HooksPanel from '../../components/HooksPanel.vue'
import Icon from '../../components/Icon.vue'
import { checkState, recItems, recState } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'
import RecordingPanel from './RecordingPanel.vue'

/** The side panel at the right (its width dragged): «Проверка», the recording of requests, «Карта API», the hooks. */
const view = useBrowserView()
const { byId, curId, pageShown } = view.tabs
const { recOpen, dragRec, panelMode, checkNew } = view.side
const { api, apiBusy, apiError, apiTried, mapSpec, findSwagger, clearApi, askToHttp } = view.swagger
</script>

<template>
  <aside v-if="recOpen" class="rec tw:relative tw:flex tw:flex-col tw:min-w-0 tw:min-h-0 tw:border-l tw:border-l-border tw:bg-panel">
    <span class="rgrip tw:absolute tw:top-0 tw:bottom-0 tw:-left-3 tw:z-3 tw:w-6 tw:cursor-col-resize tw:hover:bg-accent-line" @pointerdown="dragRec"></span>
    <div class="pmode tw:flex tw:items-center tw:gap-2 tw:h-36 tw:min-w-0 tw:py-0 tw:px-6 tw:border-b tw:border-b-border tw:overflow-hidden tw:@container">
      <button class="tw:group/g19 tw:[&:not(.ib)]:inline-flex tw:[&:not(.ib)]:flex-none tw:[&:not(.ib)]:items-center tw:[&:not(.ib)]:gap-6 tw:[&:not(.ib)]:h-28 tw:[&:not(.ib)]:py-0 tw:[&:not(.ib)]:px-10 tw:[&:not(.ib)]:whitespace-nowrap tw:[&:not(.ib)]:border-0 tw:[&:not(.ib)]:rounded-r2 tw:[&:not(.ib)]:not-[&.on]:bg-transparent tw:[&:not(.ib)]:not-[&.on]:text-muted tw:[&:not(.ib)]:text-[12.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi" :class="{ on: panelMode === 'check' }" title="Проверка: ошибки сети, страницы и консоли, журнал" @click="panelMode = 'check'"><Icon class="tw:[&.live]:text-accent-fg" name="bug" :size="13" :class="{ live: checkState.settings.on }" /><span class="pl tw:@max-[600px]:group-[:not(.on)]/g19:hidden">Проверка</span><b class="tw:py-0 tw:px-5 tw:rounded-[8px] tw:bg-panel-3 tw:text-[10.5px]" v-if="checkNew">{{ checkNew }}</b></button>
      <button class="tw:group/g20 tw:[&:not(.ib)]:inline-flex tw:[&:not(.ib)]:flex-none tw:[&:not(.ib)]:items-center tw:[&:not(.ib)]:gap-6 tw:[&:not(.ib)]:h-28 tw:[&:not(.ib)]:py-0 tw:[&:not(.ib)]:px-10 tw:[&:not(.ib)]:whitespace-nowrap tw:[&:not(.ib)]:border-0 tw:[&:not(.ib)]:rounded-r2 tw:[&:not(.ib)]:not-[&.on]:bg-transparent tw:[&:not(.ib)]:not-[&.on]:text-muted tw:[&:not(.ib)]:text-[12.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi tw:[&.rec]:relative tw:[&.rec]:not-[&:not(.ib)]:flex tw:[&.rec]:flex-col tw:[&.rec]:min-w-0 tw:[&.rec]:min-h-0 tw:[&.rec]:not-[&:not(.ib)]:border-l tw:[&.rec]:not-[&:not(.ib)]:border-l-border tw:[&.rec]:not-[&:not(.ib)]:not-[&.on]:bg-panel tw:hover:enabled:not-[&:not(.ib)]:not-[&.on]:bg-hover tw:hover:enabled:not-[&:not(.ib)]:border-border-3" :class="{ on: panelMode === 'rec' }" title="Запись запросов страниц (XHR / fetch)" @click="panelMode = 'rec'"><i class="rdot tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-dim tw:[&.on]:not-[.hsw_input:checked+&]:bg-down tw:[&.on]:animate-[BrowserView-bv-blink_1s_steps(2)_infinite] tw:[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white" :class="{ on: recState.on }"></i><span class="pl tw:@max-[600px]:group-[:not(.on)]/g20:hidden">Запись</span><b class="tw:py-0 tw:px-5 tw:rounded-[8px] tw:bg-panel-3 tw:text-[10.5px]" v-if="recItems.length">{{ recItems.length }}</b></button>
      <button class="tw:group/g21 tw:[&:not(.ib)]:inline-flex tw:[&:not(.ib)]:flex-none tw:[&:not(.ib)]:items-center tw:[&:not(.ib)]:gap-6 tw:[&:not(.ib)]:h-28 tw:[&:not(.ib)]:py-0 tw:[&:not(.ib)]:px-10 tw:[&:not(.ib)]:whitespace-nowrap tw:[&:not(.ib)]:border-0 tw:[&:not(.ib)]:rounded-r2 tw:[&:not(.ib)]:not-[&.on]:bg-transparent tw:[&:not(.ib)]:not-[&.on]:text-muted tw:[&:not(.ib)]:text-[12.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi" :class="{ on: panelMode === 'map' }" title="Карта API: какие запросы делают страницы сайта — по трафику, со Swagger, если он есть" @click="panelMode = 'map'"><Icon name="map" :size="12" /><span class="pl tw:@max-[600px]:group-[:not(.on)]/g21:hidden">Карта API</span></button>
      <button class="tw:group/g22 tw:[&:not(.ib)]:inline-flex tw:[&:not(.ib)]:flex-none tw:[&:not(.ib)]:items-center tw:[&:not(.ib)]:gap-6 tw:[&:not(.ib)]:h-28 tw:[&:not(.ib)]:py-0 tw:[&:not(.ib)]:px-10 tw:[&:not(.ib)]:whitespace-nowrap tw:[&:not(.ib)]:border-0 tw:[&:not(.ib)]:rounded-r2 tw:[&:not(.ib)]:not-[&.on]:bg-transparent tw:[&:not(.ib)]:not-[&.on]:text-muted tw:[&:not(.ib)]:text-[12.5px] tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi" :class="{ on: panelMode === 'hooks' }" title="Хуки сайта: свой CSS / JS, поиск в ответах" @click="panelMode = 'hooks'"><Icon name="zap" :size="12" /><span class="pl tw:@max-[600px]:group-[:not(.on)]/g22:hidden">Хуки</span></button>
      <span class="grow tw:flex-1"></span>
      <button class="ib tw:[&:not(.ib)]:inline-flex tw:[&:not(.ib)]:flex-none tw:[&:not(.ib)]:items-center tw:[&:not(.ib)]:gap-6 tw:[&:not(.ib)]:h-28 tw:[&:not(.ib)]:py-0 tw:[&:not(.ib)]:px-10 tw:[&:not(.ib)]:whitespace-nowrap tw:[&:not(.ib)]:border-0 tw:[&:not(.ib)]:rounded-r2 tw:[&:not(.ib)]:bg-transparent tw:[&:not(.ib)]:text-muted tw:[&:not(.ib)]:text-[12.5px] tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:not-[&:not(.ib)]:border-border-3" title="Скрыть" @click="recOpen = false"><Icon name="x" :size="13" /></button>
    </div>
    <HooksPanel v-if="panelMode === 'hooks'" class="hpanel tw:flex-1 tw:[&&]:min-h-0" :url="byId(curId)?.url" :tab-id="curId" />
    <CheckPanel v-else-if="panelMode === 'check'" class="hpanel tw:flex-1 tw:[&&]:min-h-0" :tab-id="curId" />
    <ApiMapPanel v-else-if="panelMode === 'map'" class="hpanel tw:flex-1 tw:[&&]:min-h-0" :url="byId(curId)?.url" :swagger="mapSpec" :api="api" :api-busy="apiBusy" :api-error="apiError" :api-tried="apiTried" :can-find="pageShown(curId)" @find-swagger="findSwagger" @clear-swagger="clearApi" @swagger-to-http="askToHttp" />
    <RecordingPanel v-else />
  </aside>
</template>
