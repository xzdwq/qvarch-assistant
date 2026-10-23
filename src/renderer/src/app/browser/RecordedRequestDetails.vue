<script setup lang="ts">
import { prettyBody } from '@shared/browser/recordingView'
import { useBrowserView } from './browserViewContext'

/** A recorded request opened under its row: its headers and body sent, the answer's headers and body. */
const { focus, focusTab } = useBrowserView().recording
const hms = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
</script>

<template>
  <div v-if="focus" class="rd tw:pt-6 tw:pr-10 tw:pb-10 tw:pl-34 tw:border-b tw:border-b-border tw:bg-panel-2">
    <div class="rdt tw:flex tw:items-center tw:gap-4 tw:mb-6 tw:text-[11.5px]">
      <button class="tw:py-2 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-text-hi" :class="{ on: focusTab === 'req' }" @click="focusTab = 'req'">Запрос</button>
      <button class="tw:py-2 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-text-hi" :class="{ on: focusTab === 'res' }" @click="focusTab = 'res'">Ответ {{ focus.status ?? '' }}</button>
      <span class="grow tw:flex-1"></span>
      <span class="muted tw:text-muted">{{ hms(focus.at) }}<template v-if="focus.ms"> · {{ focus.ms }} мс</template></span>
    </div>
    <template v-if="focusTab === 'req'">
      <div class="kvs tw:flex tw:flex-col tw:gap-1 tw:font-data tw:text-[11px]">
        <div class="tw:grid tw:grid-cols-[minmax(80px,34%)_minmax(0,1fr)] tw:gap-8" v-for="[k, v] in focus.reqHeaders" :key="k"><b class="tw:text-text-2 tw:font-medium tw:overflow-hidden tw:text-ellipsis">{{ k }}</b><span class="tw:wrap-anywhere">{{ v }}</span></div>
      </div>
      <pre v-if="focus.postData" class="body tw:max-h-260 tw:overflow-auto tw:mt-8 tw:mr-0 tw:mb-0 tw:ml-0 tw:p-8 tw:rounded-r2 tw:bg-bg tw:font-data tw:text-[11px] tw:whitespace-pre-wrap tw:break-all">{{ prettyBody(focus.postData) }}</pre>
    </template>
    <template v-else>
      <p v-if="focus.error" class="rerr tw:my-6 tw:mx-10 tw:text-down-fg tw:text-[12px]">{{ focus.error }}</p>
      <div class="kvs tw:flex tw:flex-col tw:gap-1 tw:font-data tw:text-[11px]">
        <div class="tw:grid tw:grid-cols-[minmax(80px,34%)_minmax(0,1fr)] tw:gap-8" v-for="[k, v] in focus.resHeaders ?? []" :key="k"><b class="tw:text-text-2 tw:font-medium tw:overflow-hidden tw:text-ellipsis">{{ k }}</b><span class="tw:wrap-anywhere">{{ v }}</span></div>
      </div>
      <pre v-if="focus.resBody" class="body tw:max-h-260 tw:overflow-auto tw:mt-8 tw:mr-0 tw:mb-0 tw:ml-0 tw:p-8 tw:rounded-r2 tw:bg-bg tw:font-data tw:text-[11px] tw:whitespace-pre-wrap tw:break-all">{{ prettyBody(focus.resBody).slice(0, 20000) }}</pre>
      <p v-else class="muted tw:text-muted">Тело ответа не сохранено (файл, картинка или очень большой ответ)</p>
    </template>
  </div>
</template>
