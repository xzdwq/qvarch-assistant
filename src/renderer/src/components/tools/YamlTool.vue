<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
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
const json = ref(saved.json ?? '{\n  "service": "orders",\n  "replicas": 3,\n  "env": { "LOG_LEVEL": "info", "DB_URL": "postgres://db:5432/orders" },\n  "ports": [8080, 9090]\n}')
const yaml = ref('')
const jsonErr = ref('')
const yamlErr = ref('')
/** The side the user wrote last (an option change re-lays the other one from it). */
let source: 'json' | 'yaml' = 'json'
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
  if (source === 'json') fromJson()
  else fromYaml()
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
  try {
    const v = source === 'json' ? (JSON.parse(json.value) as unknown) : yamlLoad(yaml.value)
    write(json, toJson(v))
    write(yaml, toYaml(v))
    jsonErr.value = yamlErr.value = ''
  } catch (e) {
    if (source === 'json') jsonErr.value = where(e)
    else yamlErr.value = where(e)
  }
}
const copiedSide = ref('')
async function copy(side: 'json' | 'yaml'): Promise<void> {
  await navigator.clipboard.writeText(side === 'json' ? json.value : yaml.value)
  copiedSide.value = side
  setTimeout(() => copiedSide.value === side && (copiedSide.value = ''), 1200)
}
async function paste(side: 'json' | 'yaml'): Promise<void> {
  const t = await navigator.clipboard.readText()
  if (side === 'json') json.value = t
  else yaml.value = t
}
</script>

<template>
  <div class="yt">
    <div class="bar">
      <span class="lbl">Отступ</span>
      <span class="seg">
        <button v-for="i in [2, 4]" :key="i" :class="{ on: opt.indent === i }" @click="opt.indent = i">{{ i }}</button>
        <button :class="{ on: opt.indent === -1 }" title="Табуляция (в JSON; YAML табы не допускает — там 2)" @click="opt.indent = -1">Tab</button>
        <button :class="{ on: opt.indent === 0 }" title="JSON в одну строку (YAML — с отступом 2)" @click="opt.indent = 0">Сжать</button>
      </span>
      <label class="chk"><input v-model="opt.sort" type="checkbox" />Ключи по алфавиту</label>
      <span class="grow"></span>
      <button class="fmt" title="Разложить обе стороны заново" @click="formatBoth"><Icon name="code" :size="13" />Форматировать</button>
    </div>
    <div class="cols">
      <div v-for="side in ['json', 'yaml'] as const" :key="side" class="col">
        <div class="ph">
          <b>{{ side === 'json' ? 'JSON' : 'YAML' }}</b>
          <span v-if="side === 'json' ? jsonErr : yamlErr" class="err" :title="side === 'json' ? jsonErr : yamlErr">{{ side === 'json' ? jsonErr : yamlErr }}</span>
          <span class="grow"></span>
          <button class="ib" title="Вставить из буфера" @click="paste(side)"><Icon name="clipboard" :size="13" /></button>
          <button class="ib" :title="copiedSide === side ? 'Скопировано' : 'Копировать'" @click="copy(side)"><Icon :name="copiedSide === side ? 'check' : 'copy'" :size="13" /></button>
        </div>
        <div class="ed">
          <CodeArea v-if="side === 'json'" v-model="json" lang="json" fill :min-height="0" placeholder="JSON — YAML справа появится сам" />
          <CodeArea v-else v-model="yaml" lang="yaml" fill :min-height="0" placeholder="YAML — JSON слева появится сам" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.yt {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.lbl {
  color: var(--text-2);
  font-size: 12.5px;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 12px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 12.5px;
}
.grow {
  flex: 1;
}
.fmt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.fmt:hover {
  background: var(--hover);
  color: var(--text);
}
.cols {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1px;
  background: var(--border);
}
.col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 10px 14px 14px;
  background: var(--bg);
}
.ph {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 26px;
  font-size: 12.5px;
  white-space: nowrap;
}
.ph b {
  color: var(--text-hi);
}
.err {
  overflow: hidden;
  color: var(--down-fg);
  text-overflow: ellipsis;
}
.ed {
  flex: 1;
  min-height: 0;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
