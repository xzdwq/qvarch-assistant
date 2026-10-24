<script setup lang="ts">
/**
 * What a message carries: a query's rows (a table), a request's answer, a value, a browser test as written (copied
 * as a block — pasted into a note, it runs there), a picture shown right here (a click — full size), a file to save.
 */
import { computed, ref, watch } from 'vue'
import { isChatFile, type ChatAttach, type ChatFile } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import type { HttpShot, PwShot, SqlShot, ValueShot } from '@nb/engine/chatAttach'
import Icon from '@renderer/components/Icon.vue'
import { chatFileUrl, saveChatFile, sizeText } from '@renderer/lib/chatFiles'
import { useEscLayer } from '@renderer/lib/usePopover'

const props = defineProps<{ a: ChatAttach; room: string }>()
const ICONS: Record<ChatAttach['kind'], string> = { sql: 'database', http: 'api', code: 'code', value: 'braces', pw: 'globe', image: 'image', file: 'file' }
const sql = computed(() => (props.a.kind === 'sql' ? (props.a.data as SqlShot) : undefined))
const http = computed(() => (props.a.kind === 'http' ? (props.a.data as HttpShot) : undefined))
const pw = computed(() => (props.a.kind === 'pw' && typeof (props.a.data as PwShot)?.source === 'string' ? (props.a.data as PwShot) : undefined))
// (anything else — as its data is: an older message's shot)
const value = computed(() => (props.a.kind === 'code' || props.a.kind === 'value' ? (props.a.data as ValueShot).value : props.a.data))
const file = computed<ChatFile | undefined>(() => ((props.a.kind === 'image' || props.a.kind === 'file') && isChatFile(props.a.data) ? props.a.data : undefined))
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
/** A browser test's code (its block without the fence lines). */
const pwCode = computed(() => (pw.value ? pw.value.source.split('\n').slice(1, -1).join('\n') : ''))

// ---------- a picture: fetched once, shown; a click — full size over everything (Esc / a click closes) ----------
const url = ref('')
const said = ref('')
watch(
  () => (props.a.kind === 'image' ? file.value?.id : undefined),
  () => {
    url.value = ''
    if (props.a.kind === 'image' && file.value) void chatFileUrl(props.room, file.value).then((u) => (url.value = u), (e) => (said.value = remoteError(e)))
  },
  { immediate: true },
)
const full = ref(false)
useEscLayer(full, () => (full.value = false))
async function save(): Promise<void> {
  said.value = ''
  if (file.value) await saveChatFile(props.room, file.value).catch((e) => (said.value = remoteError(e)))
}
const copied = ref(false)
async function copyBlock(): Promise<void> {
  if (!pw.value) return
  await navigator.clipboard.writeText(pw.value.source)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <!-- a picture: the picture itself -->
  <div v-if="a.kind === 'image' && file" class="tw:group/img tw:relative tw:mt-2 tw:max-w-full">
    <img v-if="url" :src="url" alt="" class="tw:block tw:max-w-full tw:max-h-280 tw:rounded-[8px] tw:cursor-zoom-in" :title="file.name" @click="full = true" />
    <span v-else class="tw:inline-flex tw:items-center tw:gap-6 tw:h-40 tw:px-10 tw:text-muted tw:text-[12px]"><Icon name="image" :size="14" />{{ said || 'Загружается…' }}</span>
    <button v-if="url" class="tw:absolute tw:top-6 tw:right-6 tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-(--image-tool-bg) tw:text-(--image-tool-fg) tw:opacity-0 tw:group-hover/img:opacity-100" title="Сохранить" @click="save"><Icon name="download" :size="13" /></button>
    <Teleport to="body">
      <div v-if="full" class="qa-lightbox" @click="full = false"><img :src="url" alt="" /></div>
    </Teleport>
  </div>
  <!-- a file: its name, size, «save» -->
  <div v-else-if="a.kind === 'file' && file" class="tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:mt-2 tw:py-6 tw:px-8 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg/60">
    <Icon name="file" :size="18" class="tw:flex-none tw:text-muted" />
    <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1">
      <span class="tw:truncate tw:text-[12.5px] tw:text-text" :title="file.name">{{ file.name }}</span>
      <span class="tw:text-muted tw:text-[11px]">{{ said || sizeText(file.size) }}</span>
    </span>
    <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0" title="Сохранить" @click="save"><Icon name="download" :size="13" /></button>
  </div>
  <div v-else class="tw:flex tw:flex-col tw:gap-4 tw:min-w-0 tw:max-w-full tw:mt-2 tw:p-6 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg/60">
    <span class="tw:flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[11.5px] tw:font-medium">
      <Icon :name="ICONS[a.kind]" :size="12" /><span class="tw:min-w-0 tw:truncate">{{ a.title }}</span>
      <button v-if="pw" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-22 tw:px-6 tw:ml-auto tw:text-[11px]" title="Скопировать блок целиком — вставьте его в заметку, и тест можно запустить" @click="copyBlock"><Icon :name="copied ? 'check' : 'copy'" :size="11" />{{ copied ? 'Скопировано' : 'Копировать блок' }}</button>
    </span>
    <template v-if="sql">
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
    <pre v-else-if="pw" class="tw:m-0 tw:max-h-260 tw:overflow-auto tw:text-[11.5px] tw:font-data tw:whitespace-pre">{{ pwCode }}</pre>
    <pre v-else class="tw:m-0 tw:max-h-200 tw:overflow-auto tw:text-[11.5px] tw:font-data tw:whitespace-pre-wrap tw:wrap-anywhere">{{ show(value) }}</pre>
  </div>
</template>
