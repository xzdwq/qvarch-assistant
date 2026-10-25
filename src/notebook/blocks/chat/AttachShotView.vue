<script setup lang="ts">
/**
 * A block a message carries: a query (its text, its rows as a table), a request's answer, code / a browser test as
 * written (copied as a block — pasted into a note, it runs there) with code's value, a value.
 */
import { computed, ref } from 'vue'
import type { ChatAttach } from '@shared/transport/chat'
import type { CodeShot, HttpShot, SqlShot, ValueShot } from '@nb/engine/chatAttach'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ a: ChatAttach }>()
const ICONS: Record<ChatAttach['kind'], string> = { sql: 'database', http: 'api', code: 'code', value: 'braces', pw: 'globe', image: 'image', file: 'file' }
const sql = computed(() => (props.a.kind === 'sql' ? (props.a.data as SqlShot) : undefined))
const http = computed(() => (props.a.kind === 'http' ? (props.a.data as HttpShot) : undefined))
/** A block as written (code, a browser test): its whole block; code — its value too, when it was run. */
const written = computed(() => (typeof (props.a.data as { source?: unknown } | null)?.source === 'string' ? (props.a.data as Partial<CodeShot> & { source: string }) : undefined))
const body = computed(() => (written.value ? written.value.source.split('\n').slice(1, -1).join('\n') : ''))
// (anything else — as its data is: an older message's shot)
const value = computed(() => (written.value ? written.value.value : props.a.kind === 'value' || props.a.kind === 'code' ? (props.a.data as ValueShot).value : props.a.data))
const hasValue = computed(() => (written.value ? !!written.value.hasValue : true))
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const copied = ref(false)
async function copyBlock(): Promise<void> {
  if (!written.value) return
  await navigator.clipboard.writeText(written.value.source)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-4 tw:min-w-0 tw:max-w-full tw:mt-2 tw:p-6 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg/60">
    <span class="tw:flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[11.5px] tw:font-medium">
      <Icon :name="ICONS[a.kind]" :size="12" /><span class="tw:min-w-0 tw:truncate">{{ a.title }}</span>
      <button v-if="written" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-22 tw:py-0 tw:px-6 tw:ml-auto tw:text-[11px]" title="Скопировать блок целиком — вставьте его в заметку, и его можно запустить" @click="copyBlock"><Icon :name="copied ? 'check' : 'copy'" :size="11" />{{ copied ? 'Скопировано' : 'Копировать блок' }}</button>
    </span>
    <template v-if="sql">
      <pre v-if="sql.sql" class="tw:m-0 tw:max-h-120 tw:overflow-auto tw:text-[11.5px] tw:font-data tw:text-text-2 tw:whitespace-pre-wrap tw:wrap-anywhere">{{ sql.sql }}</pre>
      <div class="tw:max-h-220 tw:overflow-auto">
        <table class="tw:border-collapse tw:text-[11.5px] tw:font-data">
          <thead>
            <tr><th v-for="c in sql.columns" :key="c" class="tw:sticky tw:top-0 tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:bg-panel tw:text-left tw:text-text-2 tw:whitespace-nowrap">{{ c }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in sql.rows" :key="i"><td v-for="(v, k) in r" :key="k" class="tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:whitespace-nowrap tw:max-w-260 tw:truncate">{{ cell(v) }}</td></tr>
          </tbody>
        </table>
      </div>
      <span class="tw:text-muted tw:text-[11px]">Строк: {{ sql.rows.length }}<template v-if="sql.rows.length < sql.total || sql.more"> из {{ sql.total }}{{ sql.more ? '+' : '' }}</template> · {{ Math.round(sql.ms) }} мс</span>
    </template>
    <template v-else-if="http">
      <span class="tw:font-data tw:text-[11.5px] tw:truncate"><b>{{ http.method }}</b> {{ http.url }}</span>
      <span class="tw:text-[11.5px]" :class="http.status < 400 ? 'tw:text-up-fg' : 'tw:text-down-fg'">{{ http.status }} {{ http.statusText }} · {{ Math.round(http.ms) }} мс</span>
      <pre class="tw:m-0 tw:max-h-200 tw:overflow-auto tw:text-[11.5px] tw:whitespace-pre-wrap tw:wrap-anywhere">{{ http.body }}<template v-if="http.cut">…</template></pre>
    </template>
    <template v-else-if="written">
      <pre class="tw:m-0 tw:max-h-260 tw:overflow-auto tw:text-[11.5px] tw:font-data tw:whitespace-pre">{{ body }}</pre>
      <template v-if="hasValue && a.kind === 'code'">
        <span class="tw:text-muted tw:text-[11px]">Результат</span>
        <pre class="tw:m-0 tw:max-h-200 tw:overflow-auto tw:text-[11.5px] tw:font-data tw:whitespace-pre-wrap tw:wrap-anywhere">{{ show(value) }}</pre>
      </template>
    </template>
    <pre v-else class="tw:m-0 tw:max-h-200 tw:overflow-auto tw:text-[11.5px] tw:font-data tw:whitespace-pre-wrap tw:wrap-anywhere">{{ show(value) }}</pre>
  </div>
</template>
