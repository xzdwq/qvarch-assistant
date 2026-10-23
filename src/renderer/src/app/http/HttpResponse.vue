<script setup lang="ts">
/** The answer: status, time and size; the script's result, the body, the headers, the log (chain steps, qa.log). */
import { computed } from 'vue'
import type { HttpRequest } from '@shared/http'
import { methodColor as mColor, methodShort as short, prettyJson, sizeLabel as size, statusClass as statusCls } from '@shared/httpCollection'
import CodeArea from '../../components/CodeArea.vue'
import { useHttpView } from './httpViewContext'

defineProps<{ req: HttpRequest }>()
const { result, rtab, running } = useHttpView().runner
/** The body pretty-printed when it is JSON. */
const prettyBody = computed(() => prettyJson(result.value?.response?.body ?? ''))
const prettyResult = computed(() => {
  const r = result.value?.result
  return typeof r === 'string' ? r : JSON.stringify(r, null, 2)
})
</script>

<template>
      <div class="resp tw:flex-[1_1_55%] tw:min-h-160 tw:flex tw:flex-col tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:overflow-hidden">
        <div class="rbar tw:flex tw:items-center tw:gap-10 tw:h-34 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-12 tw:border-b tw:border-b-border tw:whitespace-nowrap">
          <span class="cap">Ответ</span>
          <template v-if="result?.response">
            <b class="st tw:[&.none]:m-12 tw:[&.none]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-muted tw:[&.url]:flex-1 tw:[&.url]:min-w-0 tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.post]:not-[&.log]:flex tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.post]:not-[&.log]:flex-col tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.post]:not-[&.log]:gap-8 tw:py-1 tw:px-7 tw:rounded-r2 tw:font-data tw:text-[11.5px] tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:bg-up/15 tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-up-fg tw:[&.s3]:not-[&.e4]:not-[&.e5]:bg-info/15 tw:[&.s3]:not-[&.e4]:not-[&.e5]:text-info-fg tw:[&.e4]:not-[&.e5]:bg-warn/16 tw:[&.e4]:not-[&.e5]:text-warn-fg tw:[&.e5]:bg-down/16 tw:[&.e5]:text-down-fg tw:[&.log]:flex tw:[&.log]:flex-col tw:[&.log]:gap-2 tw:[&.log]:font-data tw:[&.log]:text-[12px]" :class="statusCls(result.response.status)">{{ result.response.status }} {{ result.response.statusText }}</b>
            <span class="meta tw:text-muted tw:font-data tw:text-[11.5px]">{{ result.response.time }} мс · {{ size(result.response.size) }}</span>
          </template>
          <span v-if="result?.error" class="rerr tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-down-fg tw:text-[12px]" :title="result.error">{{ result.error }}</span>
          <span class="grow tw:flex-1"></span>
          <span v-if="result" class="rtabs tw:flex tw:gap-0 tw:border-0">
            <button class="tw:relative tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:[&.on]:text-accent-fg tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-8 tw:[&.on]:after:right-8 tw:[&.on]:after:-bottom-1 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" v-if="result.hasResult" :class="{ on: rtab === 'result' }" @click="rtab = 'result'">Результат</button>
            <button class="tw:relative tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:[&.on]:text-accent-fg tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.body]:flex-col tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-8 tw:[&.on]:after:right-8 tw:[&.on]:after:-bottom-1 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" v-if="result.response" :class="{ on: rtab === 'body' }" @click="rtab = 'body'">Тело</button>
            <button class="tw:relative tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:[&.on]:text-accent-fg tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-8 tw:[&.on]:after:right-8 tw:[&.on]:after:-bottom-1 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" v-if="result.response" :class="{ on: rtab === 'headers' }" @click="rtab = 'headers'">Заголовки<i class="tw:py-0 tw:px-5 tw:rounded-r1 tw:bg-panel-3 tw:text-text-2 tw:not-italic tw:font-data tw:text-[10px]">{{ result.response.headers.length }}</i></button>
            <button class="tw:relative tw:inline-flex tw:items-center tw:gap-5 tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:[&.on]:text-accent-fg tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.log]:flex-col tw:[&.log]:font-data tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-8 tw:[&.on]:after:right-8 tw:[&.on]:after:-bottom-1 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" :class="{ on: rtab === 'log' }" @click="rtab = 'log'">Журнал<i class="tw:py-0 tw:px-5 tw:rounded-r1 tw:bg-panel-3 tw:text-text-2 tw:not-italic tw:font-data tw:text-[10px]" v-if="result.logs.length + result.chain.length">{{ result.logs.length + result.chain.length }}</i></button>
          </span>
        </div>
        <div class="rbody tw:flex-1 tw:min-h-0 tw:overflow-auto tw:p-8">
          <p v-if="!result" class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">{{ running ? 'Отправляю…' : 'Нажмите «Отправить» или Ctrl+Enter' }}</p>
          <CodeArea v-else-if="rtab === 'result' && result.hasResult" :key="`r${req.id}`" :model-value="prettyResult" lang="json" readonly :min-height="80" />
          <CodeArea v-else-if="rtab === 'body' && result.response" :key="`b${req.id}`" :model-value="prettyBody.text" :lang="prettyBody.json ? 'json' : 'text'" readonly :min-height="80" />
          <div v-else-if="rtab === 'headers' && result.response" class="hdrs">
            <div v-for="[k, v] in result.response.headers" :key="k" class="hr tw:grid tw:grid-cols-[220px_minmax(0,1fr)] tw:gap-10 tw:py-3 tw:px-4 tw:border-b tw:border-b-border tw:font-data tw:text-[12px]"><b class="tw:text-info-fg tw:font-medium">{{ k }}</b><span class="tw:wrap-anywhere">{{ v }}</span></div>
          </div>
          <div v-else class="log tw:flex tw:flex-col tw:gap-2 tw:font-data tw:text-[12px]">
            <div v-for="(c, i) in result.chain" :key="`c${i}`" class="lc tw:flex tw:items-center tw:gap-8 tw:py-4 tw:px-6 tw:border-l-2 tw:border-l-info tw:bg-panel-2 tw:[&.bad]:border-l-down" :class="{ bad: c.error }">
              <b class="mt tw:flex-none tw:w-34 tw:font-data tw:text-[9.5px] tw:font-bold" :style="{ color: mColor(c.method) }">{{ short(c.method) }}</b><span>{{ c.name }}</span><span class="muted tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ c.url }}</span>
              <b v-if="c.status" class="st tw:[&.none]:m-12 tw:[&.none]:not-[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-muted tw:[&.url]:flex-1 tw:[&.url]:min-w-0 tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.pre]:not-[&.post]:not-[&.log]:flex tw:[&.post]:not-[&.log]:flex tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.pre]:not-[&.post]:not-[&.log]:flex-col tw:[&.post]:not-[&.log]:flex-col tw:[&.auth]:not-[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.body]:not-[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.pre]:not-[&.post]:not-[&.log]:gap-8 tw:[&.post]:not-[&.log]:gap-8 tw:py-1 tw:px-7 tw:rounded-r2 tw:font-data tw:text-[11.5px] tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:bg-up/15 tw:[&.s2]:not-[&.s3]:not-[&.e4]:not-[&.e5]:text-up-fg tw:[&.s3]:not-[&.e4]:not-[&.e5]:bg-info/15 tw:[&.s3]:not-[&.e4]:not-[&.e5]:text-info-fg tw:[&.e4]:not-[&.e5]:bg-warn/16 tw:[&.e4]:not-[&.e5]:text-warn-fg tw:[&.e5]:bg-down/16 tw:[&.e5]:text-down-fg tw:[&.log]:flex tw:[&.log]:flex-col tw:[&.log]:gap-2 tw:[&.log]:font-data tw:[&.log]:text-[12px]" :class="statusCls(c.status)">{{ c.status }}</b><span v-if="c.time" class="muted tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ c.time }} мс</span><span v-if="c.error" class="rerr tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-down-fg tw:text-[12px]">{{ c.error }}</span>
            </div>
            <div v-for="(l, i) in result.logs" :key="`l${i}`" class="ll tw:py-2 tw:px-6 tw:whitespace-pre-wrap tw:text-text-2">{{ l }}</div>
            <p v-if="result.error" class="rerr tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-down-fg tw:text-[12px]">{{ result.error }}</p>
            <p v-if="!result.chain.length && !result.logs.length && !result.error" class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">Пусто — qa.log(…) в скриптах пишет сюда</p>
          </div>
        </div>
      </div>
</template>
