<script setup lang="ts">
import { METHOD_COLOR } from '@shared/http'
import { requestPath, statusClass } from '@shared/browser/recordingView'
import Icon from '../../components/Icon.vue'
import { hostOf, recItems, recState } from '../../lib/browser'
import { useBrowserView } from './browserViewContext'
import RecordedRequestDetails from './RecordedRequestDetails.vue'

/**
 * The side panel's recording (its parts side by side in the panel — no box of its own): on / off, the documents too,
 * the list filtered and picked, a request's details under it, the picked ones → HTTP.
 */
const { recError, toggleRec, setDocs, recQ, picked, shownItems, togglePick, allPicked, pickAll, clearRec, focus, openItem, startTransfer } = useBrowserView().recording
const mColor = (m: string) => METHOD_COLOR[m as keyof typeof METHOD_COLOR] ?? 'var(--muted)'
</script>

<template>
  <div class="rh tw:flex tw:items-center tw:gap-8 tw:h-40 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-10 tw:border-b tw:border-b-border">
    <button class="recb tw:group/recb tw:[.pill_&]:rounded-none tw:flex-none tw:inline-flex tw:items-center tw:gap-6 tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.on]:border-down tw:[&.on]:bg-down/14 tw:[&.on]:text-down-fg tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: recState.on }" @click="toggleRec"><i class="tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-down tw:group-[.on]/recb:animate-[BrowserView-bv-blink_1s_steps(2)_infinite] tw:[.hsw_input:checked+&]:bg-accent tw:[.hsw_input:checked+&]:after:[transform:translateX(12px)] tw:[.hsw_input:checked+&]:after:bg-white"></i>{{ recState.on ? 'Остановить' : 'Начать запись' }}</button>
    <label class="rdocs tw:inline-flex tw:items-center tw:gap-5 tw:text-text-2 tw:text-[12px]" title="Записывать и сами страницы (документы), не только XHR / fetch"><input type="checkbox" :checked="recState.documents" @change="setDocs(($event.target as HTMLInputElement).checked)" />+ страницы</label>
    <span class="grow tw:flex-1"></span>
    <button class="ib tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:hover:enabled:border-border-3" title="Очистить" :disabled="!recItems.length" @click="clearRec"><Icon name="trash" :size="13" /></button>
  </div>
  <p v-if="recError" class="rerr tw:my-6 tw:mx-10 tw:text-down-fg tw:text-[12px]">{{ recError }}</p>
  <div class="rf tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-10">
    <input type="checkbox" :checked="allPicked" title="Выбрать все показанные" @change="pickAll(($event.target as HTMLInputElement).checked)" />
    <input v-model="recQ" class="rq tw:flex-1 tw:h-28 tw:text-[12px]" placeholder="Фильтр: метод, адрес, статус" spellcheck="false" />
  </div>
  <div class="rlist tw:flex-1 tw:min-h-0 tw:overflow-x-hidden tw:overflow-y-auto">
    <template v-for="x in shownItems" :key="x.id">
      <div class="ri tw:group/ri tw:min-w-0 tw:max-w-full tw:grid tw:grid-cols-[18px_30px_52px_minmax(0,1fr)_34px_34px] tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:text-[12px] tw:cursor-default tw:hover:not-[&.picked]:not-[&.open]:bg-hover tw:[&.picked]:not-[&.open]:bg-accent/10 tw:[&.open]:bg-panel-2" :class="{ picked: picked.has(x.id), open: focus?.id === x.id, failed: !!x.error }" @click="openItem(x)">
        <input type="checkbox" :checked="picked.has(x.id)" @click.stop="togglePick(x.id)" />
        <span class="rn tw:text-muted tw:font-data tw:text-[11px] tw:text-right">{{ x.seq }}</span>
        <b class="rm tw:font-data tw:text-[11px]" :style="{ color: mColor(x.method) }">{{ x.method }}</b>
        <span class="rp tw:[.ri.dep_&]:line-through tw:[.ri.dep_&]:opacity-60 tw:group-[.failed]/ri:text-down-fg tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-data tw:text-[11.5px]" :title="x.url"><span class="rhost tw:mr-2 tw:text-muted">{{ hostOf(x.url) }}</span>{{ requestPath(x.url) }}</span>
        <b class="rs tw:[&.nav]:not-[&.bmrow]:flex-none tw:[&.nav]:not-[&.key]:not-[&.rec]:not-[&.bmrow]:flex tw:[&.nav]:not-[&.bmrow]:items-center tw:[&.nav]:not-[&.bmrow]:gap-2 tw:[&.nav]:h-38 tw:[&.nav]:not-[&.key]:not-[&.body]:not-[&.bmrow]:py-0 tw:[&.nav]:not-[&.key]:not-[&.body]:not-[&.bmrow]:px-6 tw:[&.nav]:not-[&.key]:not-[&.bmrow]:border-b tw:[&.nav]:not-[&.key]:not-[&.bmrow]:border-b-border tw:[&.nav]:not-[&.key]:not-[&.rec]:not-[&.body]:not-[&.bmrow]:bg-panel tw:[&.u-scheme]:not-[&.u-host]:not-[&.u-path]:not-[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-muted tw:[&.u-host]:not-[&.u-path]:not-[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-text-hi tw:[&.u-path]:not-[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-text-2 tw:[&.u-sep]:not-[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-muted tw:[&.u-key]:not-[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-accent-fg tw:[&.u-val]:not-[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-accent tw:[&.u-hash]:not-[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-info-fg tw:[&.key]:not-[&.rec]:absolute tw:[&.key]:right-52 tw:[&.key]:not-[&.rec]:not-[&.bmrow]:inline-flex tw:[&.key]:not-[&.body]:not-[&.bmrow]:p-5 tw:[&.key]:not-[&.rec]:not-[&.bmrow]:border-0 tw:[&.key]:not-[&.rec]:not-[&.body]:not-[&.bmrow]:bg-transparent tw:[&.key]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:not-[&.bmrow]:text-warn tw:[&.rec]:relative tw:[&.rec]:not-[&.bmrow]:flex tw:[&.rec]:flex-col tw:[&.rec]:min-w-0 tw:[&.rec]:min-h-0 tw:[&.rec]:not-[&.bmrow]:border-l tw:[&.rec]:not-[&.bmrow]:border-l-border tw:[&.rec]:not-[&.body]:not-[&.bmrow]:bg-panel tw:font-data tw:text-[11.5px] tw:text-right tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-up-fg tw:[&.s3]:not-[&.e4]:not-[&.e5]:text-info-fg tw:[&.e4]:not-[&.e5]:text-warn-fg tw:[&.e5]:text-down-fg tw:[&.body]:max-h-260 tw:[&.body]:overflow-auto tw:[&.body]:mt-8 tw:[&.body]:mr-0 tw:[&.body]:mb-0 tw:[&.body]:ml-0 tw:[&.body]:not-[&.bmrow]:p-8 tw:[&.body]:not-[&.bmrow]:rounded-r2 tw:[&.body]:not-[&.bmrow]:bg-bg tw:[&.body]:font-data tw:[&.body]:not-[&.bmrow]:text-[11px] tw:[&.body]:whitespace-pre-wrap tw:[&.body]:break-all tw:[&.bmrow]:flex-none tw:[&.bmrow]:flex tw:[&.bmrow]:items-center tw:[&.bmrow]:gap-8 tw:[&.bmrow]:py-6 tw:[&.bmrow]:px-8 tw:[&.bmrow]:border-0 tw:[&.bmrow]:rounded-r2 tw:[&.bmrow]:bg-transparent tw:[&.bmrow]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-text tw:[&.bmrow]:text-[12.5px] tw:[&.bmrow]:text-left tw:[&.bmrow]:touch-none tw:[&.bmrow]:hover:not-[&.dropin]:bg-hover tw:[&.bmrow]:[&.dropin]:bg-accent/18" :class="statusClass(x.status)">{{ x.error ? '✕' : (x.status ?? '…') }}</b>
        <span class="rt tw:text-muted tw:text-[10.5px]">{{ x.type === 'Document' ? 'стр.' : x.type === 'Fetch' ? 'fetch' : 'xhr' }}</span>
      </div>
      <RecordedRequestDetails v-if="focus?.id === x.id" />
    </template>
    <p v-if="!recItems.length" class="none tw:m-14 tw:text-muted tw:text-[12.5px] tw:leading-[1.5]">{{ recState.on ? 'Пишу… Делайте на странице то, что нужно: загрузите данные, создайте запись — запросы появятся здесь.' : 'Нажмите «Начать запись», сделайте на странице нужные действия и остановите запись.' }}</p>
  </div>
  <div class="rfoot tw:flex tw:items-center tw:gap-8 tw:py-8 tw:px-10 tw:border-t tw:border-t-border tw:text-[12px]">
    <span class="muted tw:text-muted">Выбрано: {{ picked.size }}</span>
    <span class="grow tw:flex-1"></span>
    <button class="primary" :disabled="!picked.size" @click="startTransfer">В HTTP →</button>
  </div>
</template>
