<script setup lang="ts">
import { computed, ref } from 'vue'
import { REQ_CAT_WORDS, REQ_WORDS, reqCat } from '@shared/browser/inspect/constants'
import { ms } from '@shared/browser/inspect/inspectReport'
import { clockText } from '@shared/browser/inspect/perfMonitor'
import { kb } from '@shared/browser/inspect/siteFacts'
import type { InspectReq } from '@shared/browser/inspect/types'

/**
 * A request in a group's waterfall: its source (a badge in its colour, its short name on it), method, address,
 * status, time and its bar from the act in the source's colour (a failed one — red); open — when it went, its headers
 * as sent and answered (asked from main then: the log carries none).
 */
const props = defineProps<{ tabId: string; req: InspectReq; from: number; span: number }>()
const open = ref(false)
const full = ref<InspectReq>()
const cat = computed(() => reqCat(props.req.type))
const color = computed(() => `var(--req-${cat.value})`)
const path = computed(() => {
  try {
    const u = new URL(props.req.url)
    return `${u.pathname}${u.search}` || props.req.url
  } catch {
    return props.req.url
  }
})
const bad = computed(() => !!props.req.failed || (props.req.status ?? 0) >= 400)
const bar = computed(() => {
  const left = Math.max(0, (props.req.start - props.from) / props.span)
  const width = Math.max(0.006, ((props.req.end ?? props.req.start + props.span * 0.02) - props.req.start) / props.span)
  return { left: `${Math.min(99, left * 100)}%`, width: `${Math.min(100 - left * 100, width * 100)}%`, background: bad.value ? 'var(--down)' : color.value }
})
async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value && !full.value) full.value = await window.qa.browser('inspectRequest', props.tabId, props.req.id)
}
const headers = (h?: Record<string, string>) => Object.entries(h ?? {}).sort(([a], [b]) => a.localeCompare(b))
</script>

<template>
  <div class="tw:flex tw:flex-col tw:min-w-0">
    <button class="tw:grid tw:grid-cols-[40px_34px_minmax(0,1fr)_34px_60px] tw:items-center tw:gap-6 tw:w-full tw:h-20 tw:px-2 tw:border-0 tw:bg-transparent tw:text-left tw:text-[11.5px] tw:font-data tw:hover:bg-hover" :title="`${req.method} ${req.url}\n${REQ_CAT_WORDS[cat].name} (${REQ_WORDS[req.type] ?? req.type})${req.size ? ' · ' + kb(req.size) : ''}${req.cached ? ' · из кэша' : ''}${req.failed ? '\n' + req.failed : ''}`" @click="toggle">
      <span class="tw:h-15 tw:rounded-[3px] tw:text-center tw:text-[9.5px] tw:leading-[15px] tw:font-bold tw:text-white tw:truncate" :style="{ background: color }">{{ REQ_CAT_WORDS[cat].short }}</span>
      <span class="tw:text-muted tw:truncate">{{ req.method }}</span>
      <span class="tw:relative tw:min-w-0 tw:h-full tw:flex tw:items-center">
        <i class="tw:absolute tw:top-3 tw:bottom-3 tw:rounded-[2px] tw:opacity-40" :style="bar"></i>
        <span class="tw:relative tw:min-w-0 tw:truncate tw:text-text-2 tw:[&.bad]:text-down-fg" :class="{ bad }">{{ path }}</span>
      </span>
      <span class="tw:text-right tw:text-muted tw:[&.bad]:text-down-fg" :class="{ bad }">{{ req.failed ? '✕' : (req.status ?? '…') }}</span>
      <span class="tw:text-right tw:text-text-2">{{ req.end ? ms(req.end - req.start) : 'идёт' }}</span>
    </button>
    <div v-if="open" class="tw:flex tw:flex-col tw:gap-4 tw:my-4 tw:ml-8 tw:p-6 tw:rounded-r2 tw:bg-panel-2 tw:text-[11px] tw:font-data tw:min-w-0">
      <span class="tw:break-all tw:text-text">{{ req.method }} {{ req.url }}</span>
      <span class="tw:text-muted">{{ clockText(req.start) }} · {{ REQ_CAT_WORDS[cat].name }} · {{ req.proto ?? '' }} · {{ req.mime ?? '' }}{{ req.size ? ' · ' + kb(req.size) : '' }}{{ req.cached ? ' · из кэша' : '' }}{{ req.failed ? ' · ' + req.failed : '' }}</span>
      <template v-for="[title, h] in [['Запрос', full?.reqHeaders], ['Ответ', full?.resHeaders]] as const" :key="title">
        <b v-if="headers(h).length" class="tw:mt-4 tw:text-text-2 tw:font-normal">{{ title }}</b>
        <div v-for="[k, v] in headers(h)" :key="title + k" class="tw:flex tw:gap-6 tw:min-w-0">
          <span class="tw:flex-none tw:w-140 tw:truncate tw:text-muted" :title="k">{{ k }}</span>
          <span class="tw:min-w-0 tw:break-all tw:text-text-2">{{ v }}</span>
        </div>
      </template>
    </div>
  </div>
</template>
