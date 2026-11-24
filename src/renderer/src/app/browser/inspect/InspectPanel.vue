<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '../../../components/Icon.vue'
import { tabs } from '../../../lib/browser'
import { copiedHere, inspectNotice, inspectViews, loadInspect } from '../../../lib/browserInspect'
import { renderLine } from '@shared/browser/inspect/renderMode'
import { kb } from '@shared/browser/inspect/siteFacts'
import InspectLog from './InspectLog.vue'
import InspectPassport from './InspectPassport.vue'
import InspectSection from './InspectSection.vue'
import PerfMonitor from './PerfMonitor.vue'
import AnimationsSection from './AnimationsSection.vue'
import TimelineSection from './TimelineSection.vue'

/**
 * The inspector of the tab shown: on / off, its notice (a copy done), its parts — each folds: the site's passport,
 * the page's performance, the log of acts. Its actions: the passport made again, the log cleared, the whole report
 * copied (for an AI, for a bug).
 */
const props = defineProps<{ tabId?: string }>()
const view = computed(() => (props.tabId ? inspectViews.value[props.tabId] : undefined))
const tab = computed(() => tabs.value.find((t) => t.id === props.tabId))
const on = computed(() => !!tab.value?.inspect)
/** The frame over the element under the pointer (the browser's settings keep it: on by default). */
const frame = ref(true)
onMounted(async () => (frame.value = (await window.qa.browser('settings')).inspectFrame))
async function toggleFrame(): Promise<void> {
  frame.value = (await window.qa.browser('setSettings', { inspectFrame: !frame.value })).inspectFrame
}
watch(
  () => props.tabId,
  (id) => id && !inspectViews.value[id] && void loadInspect(id),
  { immediate: true },
)
/** The monitor's last reading in a line (its folded head). */
const lastLoad = computed(() => {
  const s = view.value?.monitor.at(-1)
  return s ? `поток ${s.cpu}% · память ${kb(s.heap)} · DOM ${s.nodes}` : ''
})
const toggle = () => props.tabId && window.qa.browser('inspect', props.tabId, !on.value)
const refresh = () => props.tabId && window.qa.browser('inspectPassport', props.tabId)
const clear = () => props.tabId && window.qa.browser('inspectClear', props.tabId)
async function copyReport(): Promise<void> {
  if (!props.tabId) return
  await navigator.clipboard.writeText(await window.qa.browser('inspectReport', props.tabId))
  copiedHere('отчёт инспектора')
}
const BTN = 'tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-h-0 tw:min-w-0">
    <div class="tw:flex tw:items-center tw:gap-4 tw:h-34 tw:px-8 tw:border-b tw:border-b-border tw:min-w-0">
      <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:px-8 tw:border-0 tw:rounded-r2 tw:text-[12px] tw:whitespace-nowrap tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi" :class="{ on }" :disabled="!tabId" :title="on ? 'Выключить инспектор на этой вкладке' : 'Включить: рамка под курсором, журнал действий, разбор сайта'" @click="toggle">
        <i class="tw:w-7 tw:h-7 tw:rounded-[50%] tw:bg-dim tw:[.on_&]:bg-accent"></i>{{ on ? 'Включён' : 'Выключен' }}
      </button>
      <span v-if="inspectNotice" class="tw:min-w-0 tw:truncate tw:text-[11.5px] tw:text-up-fg tw:[&.err]:text-down-fg" :class="{ err: inspectNotice.error }" :title="inspectNotice.text">{{ inspectNotice.text }}</span>
      <span class="tw:flex-1"></span>
      <button :class="[BTN, { on: frame }]" class="tw:[&.on]:bg-accent/18 tw:[&.on]:text-accent-fg" :title="frame ? 'Рамка и карточка элемента под курсором — выключить' : 'Рамка и карточка элемента под курсором — включить'" @click="toggleFrame"><Icon name="pointer" :size="13" /></button>
      <button :class="BTN" :disabled="!on" title="Собрать паспорт сайта заново" @click="refresh"><Icon name="refresh" :size="13" /></button>
      <button :class="BTN" :disabled="!view?.groups.length" title="Очистить журнал" @click="clear"><Icon name="trash" :size="13" /></button>
      <button :class="BTN" :disabled="!view" title="Скопировать отчёт (Markdown — для ИИ или в задачу)" @click="copyReport"><Icon name="copy" :size="13" /></button>
    </div>
    <div v-if="view?.blocked" class="tw:px-10 tw:py-6 tw:text-[12px] tw:text-warn-fg tw:border-b tw:border-b-border">{{ view.blocked }}</div>
    <div v-if="!on && !view?.groups.length" class="tw:flex tw:flex-col tw:gap-8 tw:p-14 tw:text-[12.5px] tw:text-text-2">
      <p class="tw:m-0">Инспектор следит за страницей, пока включён:</p>
      <ul class="tw:m-0 tw:pl-18 tw:flex tw:flex-col tw:gap-4 tw:text-muted">
        <li>рамка вокруг элемента под курсором; правый клик → «Инспектор» — скопировать HTML, CSS или компонент целиком с его JS;</li>
        <li>каждое действие — группа: что нажали, сколько заняло, какие запросы (сумма и по часам), ошибки консоли, занятость потока;</li>
        <li>паспорт сайта: на чём сделан, SSR / SPA / PWA, Web Vitals, проблемы сети, кэша, безопасности и cookie.</li>
      </ul>
      <button class="primary tw:self-start" :disabled="!tabId" @click="toggle">Включить на этой вкладке</button>
    </div>
    <div v-else class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden">
      <InspectSection v-if="view?.passport" id="passport" title="Паспорт сайта" :note="view.passport.pending ? 'собирается…' : view.passport.render ? renderLine(view.passport.render) : ''">
        <InspectPassport :passport="view.passport" />
      </InspectSection>
      <InspectSection v-if="view" id="monitor" title="Производительность" :note="lastLoad">
        <PerfMonitor :samples="view.monitor" :groups="view.groups" />
      </InspectSection>
      <TimelineSection v-if="view" :groups="view.groups" :monitor="view.monitor" :page-url="tab?.url ?? ''" />
      <InspectLog v-if="tabId && view" :tab-id="tabId" :groups="view.groups" />
      <AnimationsSection v-if="tabId && view" :tab-id="tabId" :anims="view.anims" />
    </div>
  </div>
</template>
