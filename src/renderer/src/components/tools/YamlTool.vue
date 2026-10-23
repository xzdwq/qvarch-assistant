<script setup lang="ts">
import { reactive, ref, watch, type Ref } from 'vue'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { sortDeep } from '../../lib/codeLang'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'

/**
 * JSON ↔ YAML: both sides editable — what is typed on one side is written on the other at once (while it
 * parses; a broken side says where and leaves the other one as it was). The indent and the key order apply
 * to both; «Форматировать» lays both out again.
 */
const KEY = 'qa.tools.yaml'
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { indent?: number; sort?: boolean; json?: string; split?: number }
  } catch {
    return {}
  }
})()
const opt = reactive({ indent: saved.indent ?? 2, sort: saved.sort ?? false })
const json = ref(saved.json ?? '')
const yaml = ref('')
const jsonErr = ref('')
const yamlErr = ref('')
type Side = 'json' | 'yaml'
/** The side the user wrote last (an option change re-lays the other one from it). */
let source: Side = 'json'
let mute = false
const write = (r: typeof json, v: string) => {
  mute = true
  r.value = v
  mute = false
}
const toJson = (v: unknown) => (opt.indent === 0 ? JSON.stringify(opt.sort ? sortDeep(v) : v) : JSON.stringify(opt.sort ? sortDeep(v) : v, null, opt.indent === -1 ? '\t' : opt.indent))
const toYaml = (v: unknown) => yamlDump(v, { indent: Math.max(2, opt.indent === -1 || opt.indent === 0 ? 2 : opt.indent), lineWidth: -1, noRefs: true, sortKeys: opt.sort }).replace(/\n$/, '')
const where = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].replace(/^Unexpected token/, 'Лишний символ').slice(0, 200)
function fromJson(): void {
  if (!json.value.trim()) {
    jsonErr.value = ''
    return write(yaml, '')
  }
  try {
    const v = JSON.parse(json.value) as unknown
    jsonErr.value = ''
    write(yaml, toYaml(v))
    yamlErr.value = ''
  } catch (e) {
    jsonErr.value = where(e)
  }
}
function fromYaml(): void {
  if (!yaml.value.trim()) {
    yamlErr.value = ''
    return write(json, '')
  }
  try {
    const v = yamlLoad(yaml.value)
    yamlErr.value = ''
    write(json, toJson(v))
    jsonErr.value = ''
  } catch (e) {
    yamlErr.value = where(e)
  }
}

/** Each side (left to right): its title and editor, its text and error, how it is read, how the other side is written from it. */
interface SideSpec {
  label: string
  placeholder: string
  text: Ref<string>
  err: Ref<string>
  parse: (s: string) => unknown
  relay: () => void
}
const SIDES: Record<Side, SideSpec> = {
  json: { label: 'JSON', placeholder: 'JSON — YAML справа появится сам', text: json, err: jsonErr, parse: (s) => JSON.parse(s) as unknown, relay: fromJson },
  yaml: { label: 'YAML', placeholder: 'YAML — JSON слева появится сам', text: yaml, err: yamlErr, parse: (s) => yamlLoad(s), relay: fromYaml },
}
const SIDE_ORDER = Object.keys(SIDES) as Side[]

watch(json, () => {
  if (mute) return
  source = 'json'
  fromJson()
}, { flush: 'sync' })
watch(yaml, () => {
  if (mute) return
  source = 'yaml'
  fromYaml()
}, { flush: 'sync' })
fromJson()
watch(opt, () => {
  SIDES[source].relay()
  persist()
})
watch(json, () => persist())
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...opt, json: json.value.length > 100_000 ? '' : json.value }))
  } catch {
    // fine
  }
}
/** Both sides laid out again from the side last written. */
function formatBoth(): void {
  const from = SIDES[source]
  try {
    const v = from.parse(from.text.value)
    write(json, toJson(v))
    write(yaml, toYaml(v))
    jsonErr.value = yamlErr.value = ''
  } catch (e) {
    from.err.value = where(e)
  }
}
const copiedSide = ref('')
async function copy(side: Side): Promise<void> {
  await navigator.clipboard.writeText(SIDES[side].text.value)
  copiedSide.value = side
  setTimeout(() => copiedSide.value === side && (copiedSide.value = ''), 1200)
}
async function paste(side: Side): Promise<void> {
  SIDES[side].text.value = await navigator.clipboard.readText()
}
</script>

<template>
  <div class="yt tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-12 tw:h-44 tw:py-0 tw:px-14 tw:border-b tw:border-b-border tw:whitespace-nowrap">
      <span class="lbl tw:text-text-2 tw:text-[12.5px]">Отступ</span>
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
        <button class="tw:h-28 tw:py-0 tw:px-11 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="i in [2, 4]" :key="i" :class="{ on: opt.indent === i }" @click="opt.indent = i">{{ i }}</button>
        <button class="tw:h-28 tw:py-0 tw:px-11 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: opt.indent === -1 }" title="Табуляция (в JSON; YAML табы не допускает — там 2)" @click="opt.indent = -1">Tab</button>
        <button class="tw:h-28 tw:py-0 tw:px-11 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:text-[12px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: opt.indent === 0 }" title="JSON в одну строку (YAML — с отступом 2)" @click="opt.indent = 0">Сжать</button>
      </span>
      <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]"><input v-model="opt.sort" type="checkbox" />Ключи по алфавиту</label>
      <span class="grow tw:flex-1"></span>
      <button class="fmt tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Разложить обе стороны заново" @click="formatBoth"><Icon name="code" :size="13" />Форматировать</button>
    </div>
    <div class="cols tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-1 tw:bg-border">
      <div v-for="side in SIDE_ORDER" :key="side" class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg">
        <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap">
          <b class="tw:text-text-hi">{{ SIDES[side].label }}</b>
          <span v-if="SIDES[side].err.value" class="err tw:overflow-hidden tw:text-down-fg tw:text-ellipsis" :title="SIDES[side].err.value">{{ SIDES[side].err.value }}</span>
          <span class="grow tw:flex-1"></span>
          <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Вставить из буфера" @click="paste(side)"><Icon name="clipboard" :size="13" /></button>
          <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" :title="copiedSide === side ? 'Скопировано' : 'Копировать'" @click="copy(side)"><Icon :name="copiedSide === side ? 'check' : 'copy'" :size="13" /></button>
        </div>
        <div class="ed tw:flex-1 tw:min-h-0">
          <CodeArea v-model="SIDES[side].text.value" :lang="side" fill :min-height="0" :placeholder="SIDES[side].placeholder" />
        </div>
      </div>
    </div>
  </div>
</template>
