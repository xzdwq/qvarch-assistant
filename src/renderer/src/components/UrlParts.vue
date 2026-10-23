<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { buildUrl, parseUrl, type UrlParam, type UrlParts } from '@shared/urlParts'
import { usePopover } from '../lib/usePopover'
import Icon from './Icon.vue'

/**
 * The address in parts (the arrow beside the address line): the whole address as text, and its scheme, host, path,
 * query parameters (on / off, key, value — readable), the part after # with a router's parameters; opened here or
 * in a new tab. Text and parts follow each other.
 */
const props = defineProps<{ url: string; anchor: HTMLElement | undefined }>()
const emit = defineEmits<{ open: [url: string, newTab: boolean]; close: [] }>()

const parts = ref<UrlParts>(parseUrl(props.url))
const text = ref(props.url)
// the parts edited → the text built; the text edited → the parts read (the one typed into is not rewritten)
let fromText = false
watch(
  parts,
  (p) => {
    if (fromText) return
    text.value = buildUrl(p)
  },
  { deep: true },
)
function onText(v: string): void {
  text.value = v
  fromText = true
  parts.value = parseUrl(v)
  void nextTick(() => (fromText = false))
}
const changed = computed(() => text.value.trim() !== props.url)
const reset = () => onText(props.url)
const add = (list: UrlParam[]) => list.push({ key: '', value: '', on: true })
const open = (newTab = false) => text.value.trim() && emit('open', text.value.trim(), newTab)
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(text.value.trim())
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

// ---------- placed under the address line (a popover of the window — over the page) ----------
const shown = computed({ get: () => true, set: (on) => void (on || emit('close')) })
const { panelRef, style } = usePopover(() => props.anchor, { width: (el) => Math.max(560, Math.min(860, el.getBoundingClientRect().width)), alignLeft: true, chrome: 0, maxHeight: (room) => Math.max(room, 320) }, shown)
const rows = (v: string) => Math.min(6, Math.max(1, Math.ceil(v.length / 60), v.split('\n').length))
</script>

<template>
  <Teleport to="body">
    <div :ref="panelRef" class="uptw:flex tw:flex-col tw:gap-8 tw:p-12 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:overflow-y-auto tw:text-[12.5px]" :style="style" @keydown.enter.exact.prevent="open()" @keydown.ctrl.enter.prevent="open(true)">
      <label class="up-all tw:flex tw:flex-col tw:gap-3 tw:min-w-0">
        <span class="tw:text-muted tw:text-[11.5px]">Адрес</span>
        <textarea class="tw:min-w-0 tw:py-4 tw:px-7 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:[&&]:font-data tw:[&&]:text-[12px] tw:resize-y tw:break-all" :value="text" :rows="rows(text)" spellcheck="false" @input="onText(($event.target as HTMLTextAreaElement).value)" @keydown.enter.exact.prevent.stop="open()"></textarea>
      </label>
      <div class="up-grid tw:grid tw:grid-cols-[90px_1fr] tw:gap-y-6 tw:gap-x-8">
        <label class="tw:flex tw:flex-col tw:gap-3 tw:min-w-0">
          <span class="tw:text-muted tw:text-[11.5px]">Протокол</span>
          <select class="tw:min-w-0 tw:py-4 tw:px-7 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" v-model="parts.scheme"><option value="https">https</option><option value="http">http</option><option v-if="!['http', 'https'].includes(parts.scheme)" :value="parts.scheme">{{ parts.scheme }}</option></select>
        </label>
        <label class="grow tw:flex tw:flex-col tw:gap-3 tw:min-w-0 tw:flex-1"><span class="tw:text-muted tw:text-[11.5px]">Хост (и порт)</span><input class="tw:[&:not([type='checkbox'])]:min-w-0 tw:[&:not([type='checkbox'])]:py-4 tw:[&:not([type='checkbox'])]:px-7 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit] tw:[&&&]:font-data tw:[&&&]:text-[12px]" v-model="parts.host" spellcheck="false" /></label>
        <label class="wide tw:flex tw:flex-col tw:gap-3 tw:min-w-0 tw:col-span-full"><span class="tw:text-muted tw:text-[11.5px]">Путь</span><input class="tw:[&:not([type='checkbox'])]:min-w-0 tw:[&:not([type='checkbox'])]:py-4 tw:[&:not([type='checkbox'])]:px-7 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit] tw:[&&&]:font-data tw:[&&&]:text-[12px]" v-model="parts.path" spellcheck="false" /></label>
      </div>

      <template v-for="sec in [{ title: 'Параметры запроса (после ?)', list: parts.params }, ...(parts.hash || parts.hashParams.length ? [{ title: 'Параметры после #', list: parts.hashParams }] : [])]" :key="sec.title">
        <div class="up-h tw:flex tw:items-center tw:gap-8 tw:mt-4 tw:whitespace-nowrap">
          <b>{{ sec.title }}</b>
          <span class="muted tw:text-muted">{{ sec.list.filter((x) => x.on).length }} из {{ sec.list.length }}</span>
          <span class="grow tw:flex-1"></span>
          <button class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="add(sec.list)"><Icon name="plus" :size="12" />параметр</button>
        </div>
        <p v-if="!sec.list.length" class="muted none tw:text-muted tw:m-0">Нет параметров</p>
        <div v-for="(p, i) in sec.list" :key="i" class="up-p tw:group/up-p tw:grid tw:grid-cols-[auto_minmax(90px,30%)_auto_1fr_auto] tw:items-start tw:gap-6" :class="{ off: !p.on }">
          <input class="tw:[&:not([type='checkbox'])]:min-w-0 tw:[&:not([type='checkbox'])]:py-4 tw:[&:not([type='checkbox'])]:px-7 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit] tw:mt-6" v-model="p.on" type="checkbox" :title="p.on ? 'Выключить (не уйдёт в адрес)' : 'Включить'" />
          <input v-model="p.key" class="k tw:[&:not([type='checkbox'])]:min-w-0 tw:[&:not([type='checkbox'])]:py-4 tw:[&:not([type='checkbox'])]:px-7 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit] tw:[&&&]:font-data tw:[&&&]:text-[12px] tw:group-[.off]/up-p:opacity-50 tw:group-[.off]/up-p:line-through" placeholder="ключ" spellcheck="false" />
          <span class="eq tw:mt-4 tw:text-muted">=</span>
          <textarea v-model="p.value" class="v tw:min-w-0 tw:py-4 tw:px-7 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:[&&]:font-data tw:[&&]:text-[12px] tw:resize-y tw:break-all tw:group-[.off]/up-p:opacity-50 tw:group-[.off]/up-p:line-through" :rows="rows(p.value)" placeholder="значение" spellcheck="false" @keydown.enter.exact.prevent.stop="open()"></textarea>
          <button class="ib tw:inline-grid tw:place-items-center tw:w-24 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Удалить параметр" @click="sec.list.splice(i, 1)"><Icon name="x" :size="12" /></button>
        </div>
      </template>
      <label v-if="parts.hash || parts.hashParams.length" class="up-hash tw:flex tw:flex-col tw:gap-3 tw:min-w-0 tw:mt-2"><span class="tw:text-muted tw:text-[11.5px]">После #</span><input class="tw:[&:not([type='checkbox'])]:min-w-0 tw:[&:not([type='checkbox'])]:py-4 tw:[&:not([type='checkbox'])]:px-7 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-field tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:[font:inherit]" v-model="parts.hash" spellcheck="false" placeholder="#/маршрут" /></label>
      <button v-else class="lnk add-hash tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:self-start tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="parts.hash = '#'"><Icon name="plus" :size="12" />часть после #</button>

      <div class="up-acts tw:flex tw:items-center tw:gap-6 tw:pt-4 tw:border-t tw:border-t-border">
        <button class="primary tw:[&:not(.lnk)]:inline-flex tw:[&:not(.lnk)]:items-center tw:[&:not(.lnk)]:gap-6 tw:[&:not(.lnk)]:h-28 tw:[&:not(.lnk)]:py-0 tw:[&:not(.lnk)]:px-12 tw:[&:not(.lnk)]:whitespace-nowrap" :disabled="!text.trim()" title="Открыть в этой вкладке (Enter)" @click="open()"><Icon name="play" :size="11" />Открыть</button>
        <button class="tw:[&:not(.lnk)]:inline-flex tw:[&:not(.lnk)]:items-center tw:[&:not(.lnk)]:gap-6 tw:[&:not(.lnk)]:h-28 tw:[&:not(.lnk)]:py-0 tw:[&:not(.lnk)]:px-12 tw:[&:not(.lnk)]:whitespace-nowrap" :disabled="!text.trim()" title="Открыть в новой вкладке (Ctrl+Enter)" @click="open(true)"><Icon name="plus" :size="12" />В новой вкладке</button>
        <button class="tw:[&:not(.lnk)]:inline-flex tw:[&:not(.lnk)]:items-center tw:[&:not(.lnk)]:gap-6 tw:[&:not(.lnk)]:h-28 tw:[&:not(.lnk)]:py-0 tw:[&:not(.lnk)]:px-12 tw:[&:not(.lnk)]:whitespace-nowrap" title="Скопировать адрес" @click="copy"><Icon name="copy" :size="12" />{{ copied ? 'Скопировано' : 'Копировать' }}</button>
        <span class="grow tw:flex-1"></span>
        <button v-if="changed" class="lnk tw:inline-flex tw:items-center tw:gap-4 tw:p-0 tw:border-0 tw:[background:none] tw:text-accent tw:whitespace-nowrap tw:[&:not(.lnk)]:inline-flex tw:[&:not(.lnk)]:items-center tw:[&:not(.lnk)]:gap-6 tw:[&:not(.lnk)]:h-28 tw:[&:not(.lnk)]:py-0 tw:[&:not(.lnk)]:px-12 tw:[&:not(.lnk)]:whitespace-nowrap tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Вернуть адрес страницы" @click="reset">сбросить</button>
      </div>
    </div>
  </Teleport>
</template>
