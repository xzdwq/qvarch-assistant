<script setup lang="ts">
import { computed, ref } from 'vue'
import { prettyValue } from '@nb/domain/values'
import { useFold } from '@renderer/lib/foldState'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import RunHead from '../../ui/RunHead.vue'
import { useBlockRun } from '../../ui/useBlockRun'
import { useFenceSource } from '../../ui/useFenceSource'

/**
 * A request in a note (the .http format): run here, its answer shown under it and published into the note's
 * context under its name — {{login.body.token}} in the next block, in the text.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { parts, body } = fence
const { key, run, start, stop, report } = useBlockRun(props, 'http', fence)
const rename = (name: string | undefined) => fence.patchInfo({ name })
/** Runs the request as typed (written into the note first). */
async function go(): Promise<void> {
  fence.flush()
  await start()
}
const tab = ref<'body' | 'headers' | 'sent'>('body')
/** The answer's body shown: JSON pretty-printed, anything else as it came. */
const shownBody = computed(() => {
  const b = run.value?.response?.body ?? ''
  try {
    return /^\s*[[{]/.test(b) ? prettyValue(JSON.parse(b)) : prettyValue(b)
  } catch {
    return prettyValue(b)
  }
})
const isJson = computed(() => /^\s*[[{]/.test(run.value?.response?.body ?? ''))
const statusCls = computed(() => {
  const s = run.value?.response?.status ?? 0
  return s >= 200 && s < 300 ? 'ok' : s >= 400 ? 'err' : 'warn'
})
const size = (n?: number) => (n === undefined ? '' : n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(2)} МБ`)
// (folded or open — as it was left, back from another tab too)
const open = useFold(() => `${props.path}#${key.value}#result`, true)
</script>

<template>
  <div class="bh tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-http) tw:rounded-[8px] tw:bg-panel" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="report" icon="api" kind="HTTP" :name="parts.info.name" :run="run" name-placeholder="ответ" @rename="rename" @run="go" @stop="stop" />
    <div class="bh-ed"><CodeArea v-model="body" lang="http" :run="go" :min-height="40" placeholder="GET https://…   (заголовки строками, пустая строка, тело)" /></div>
    <p v-if="run?.request?.missing.length" class="bh-miss tw:m-0 tw:text-warn-fg tw:text-[12px]">Нет значения: <code class="tw:my-0 tw:mx-3 tw:font-data" v-for="m in run.request.missing" :key="m">{{ '{' }}{{ '{' }}{{ m }}{{ '}' }}{{ '}' }}</code> — выполните блок, который его даёт (или задайте переменную в разделе HTTP)</p>
    <div v-if="run && run.state !== 'run' && (run.response || run.error)" class="bh-res tw:flex tw:flex-col tw:gap-6">
      <div class="bh-rh tw:flex tw:items-center tw:gap-10 tw:text-[12px] tw:whitespace-nowrap">
        <button class="fold tw:inline-flex tw:w-22 tw:h-22 tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="open ? 'Свернуть ответ' : 'Показать ответ'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <template v-if="run.response">
          <b class="st tw:font-data tw:[&.ok]:not-[&.warn]:not-[&.err]:text-up-fg tw:[&.warn]:not-[&.err]:text-warn-fg tw:[&.err]:text-down-fg tw:[&.sent]:max-h-260 tw:[&.sent]:m-0 tw:[&.sent]:py-8 tw:[&.sent]:px-10 tw:[&.sent]:overflow-auto tw:[&.sent]:rounded-[6px] tw:[&.sent]:bg-bg tw:[&.sent]:not-[&.ok]:not-[&.warn]:not-[&.err]:text-text-2 tw:[&.sent]:font-data tw:[&.sent]:text-[12px] tw:[&.sent]:whitespace-pre-wrap tw:[&.sent]:break-all" :class="statusCls">{{ run.response.status }} {{ run.response.statusText }}</b>
          <span class="mt tw:text-muted tw:font-data">{{ run.response.time }} мс · {{ size(run.response.size) }}</span>
          <span class="tabs tw:inline-flex tw:gap-2 tw:ml-auto">
            <button class="tw:h-22 tw:py-0 tw:px-8 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-panel-3 tw:[&.on]:text-text" :class="{ on: tab === 'body' }" @mousedown.prevent @click="tab = 'body'">Тело</button>
            <button class="tw:h-22 tw:py-0 tw:px-8 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-panel-3 tw:[&.on]:text-text" :class="{ on: tab === 'headers' }" @mousedown.prevent @click="tab = 'headers'">Заголовки · {{ run.response.headers.length }}</button>
            <button class="tw:h-22 tw:py-0 tw:px-8 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-panel-3 tw:[&.on]:text-text tw:[&.sent]:max-h-260 tw:[&.sent]:m-0 tw:[&.sent]:overflow-auto tw:[&.sent]:font-data tw:[&.sent]:whitespace-pre-wrap tw:[&.sent]:break-all" :class="{ on: tab === 'sent' }" @mousedown.prevent @click="tab = 'sent'">Отправлено</button>
          </span>
        </template>
        <span v-if="run.error" class="er tw:text-down-fg tw:overflow-hidden tw:text-ellipsis" :title="run.error">{{ run.error }}</span>
      </div>
      <template v-if="open && run.response">
        <div v-if="tab === 'body'" class="bh-out"><CodeArea :model-value="shownBody" :lang="isJson ? 'json' : 'text'" readonly :min-height="30" /></div>
        <table v-else-if="tab === 'headers'" class="hdrs tw:border-collapse tw:font-data tw:text-[12px]">
          <tr v-for="([k, v], i) in run.response.headers" :key="i"><td class="tw:pt-2 tw:pr-10 tw:pb-2 tw:pl-0 tw:align-top tw:break-all tw:first:text-accent-fg tw:first:whitespace-nowrap">{{ k }}</td><td class="tw:pt-2 tw:pr-10 tw:pb-2 tw:pl-0 tw:align-top tw:break-all tw:first:text-accent-fg tw:first:whitespace-nowrap">{{ v }}</td></tr>
        </table>
        <pre v-else class="sent tw:max-h-260 tw:m-0 tw:py-8 tw:px-10 tw:overflow-auto tw:rounded-[6px] tw:bg-bg tw:text-text-2 tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:break-all">{{ run.request?.method }} {{ run.request?.url }}
{{ run.request?.headers.map(([k, v]) => `${k}: ${v}`).join('\n') }}{{ run.request?.body ? `\n\n${run.request.body}` : '' }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped src="./BlockHttp.css"></style>
