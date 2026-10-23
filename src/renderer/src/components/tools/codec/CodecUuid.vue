<script setup lang="ts">
import { computed, ref } from 'vue'
import { uuid, uuidInfo } from '@shared/codec'
import Icon from '../../Icon.vue'
import { fmtTime } from '@shared/codecText'
import type { CopyNote } from './useCopyNote'

/** UUID: made (v4 / v7 / v1, upper case, without dashes), any one read (valid, version, variant, its time). */
const props = defineProps<{ clip: CopyNote }>()
const VER_KEY = 'qa.tools.uuidv'
const savedVer = Number(localStorage.getItem(VER_KEY))
const ver = ref<1 | 4 | 7>(savedVer === 7 ? 7 : savedVer === 1 ? 1 : 4)
const count = ref(5)
const upper = ref(false)
const noDash = ref(false)
const made = ref<string[]>([])
/** A UUID as asked: without dashes, upper case. */
const style = (u: string) => {
  const s = noDash.value ? u.replace(/-/g, '') : u
  return upper.value ? s.toUpperCase() : s
}
/** A new batch (1…500) of the chosen version (the version remembered). */
function generate(): void {
  try {
    localStorage.setItem(VER_KEY, String(ver.value))
  } catch {
    // fine
  }
  made.value = Array.from({ length: Math.min(500, Math.max(1, count.value || 1)) }, () => uuid(ver.value))
}
generate()
const check = ref('')
const info = computed(() => (check.value.trim() ? uuidInfo(check.value) : undefined))
const VERSIONS: Record<number, string> = { 1: 'время + узел', 3: 'MD5 от имени', 4: 'случайный', 5: 'SHA-1 от имени', 6: 'время (упорядоченный v1)', 7: 'время Unix + случайный', 8: 'свой формат' }
const VER_TITLES: Record<1 | 4 | 7, string> = { 4: 'Случайный', 7: 'По времени, сортируется (для БД)', 1: 'Время + узел (устаревший)' }
const copy = props.clip.copy
</script>

<template>
  <div class="uuid tw:relative tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-1 tw:bg-border">
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap"><b class="tw:text-text-hi">Создать</b></div>
      <div class="row tw:flex-none tw:flex tw:items-center tw:gap-12 tw:flex-wrap">
        <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
          <button class="tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-12 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text-2 tw:font-data tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" v-for="v in [4, 7, 1] as const" :key="v" :class="{ on: ver === v }" :title="VER_TITLES[v]" @click="(ver = v), generate()">v{{ v }}</button>
        </span>
        <label class="num tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]">Сколько <input class="tw:w-64" v-model.number="count" type="number" min="1" max="500" @change="generate" /></label>
        <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]"><input v-model="upper" type="checkbox" />ПРОПИСНЫЕ</label>
        <label class="chk tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:text-[12.5px]"><input v-model="noDash" type="checkbox" />Без дефисов</label>
        <span class="grow tw:flex-1"></span>
        <button class="primary tw:inline-flex tw:items-center tw:gap-6" @click="generate"><Icon name="refresh" :size="13" />Ещё</button>
        <button class="tw:inline-flex tw:items-center tw:gap-6" @click="copy(made.map(style).join('\n'), 'Все UUID скопированы')"><Icon name="copy" :size="13" />Все</button>
      </div>
      <div class="list tw:flex tw:flex-col tw:gap-2">
        <button v-for="(u, i) in made" :key="i" class="uu tw:flex tw:items-center tw:justify-between tw:h-30 tw:py-0 tw:px-10 tw:border tw:border-border tw:rounded-r2 tw:bg-panel tw:text-text tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Скопировать" @click="copy(style(u), 'UUID скопирован')"><code class="tw:font-data tw:text-[13px]">{{ style(u) }}</code><Icon name="copy" :size="12" /></button>
      </div>
    </div>
    <div class="col tw:flex tw:flex-col tw:gap-6 tw:min-w-0 tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-14 tw:pl-14 tw:bg-bg tw:overflow-auto">
      <div class="ph tw:flex-none tw:flex tw:items-center tw:gap-10 tw:min-h-26 tw:text-[12.5px] tw:whitespace-nowrap"><b class="tw:text-text-hi">Проверить</b><span class="muted tw:text-muted tw:overflow-hidden tw:text-ellipsis">вставьте UUID — версия, вариант, время</span></div>
      <input v-model="check" class="chkin tw:flex-none tw:font-data" spellcheck="false" placeholder="550e8400-e29b-41d4-a716-446655440000" />
      <div v-if="info" class="info tw:flex tw:flex-col tw:gap-8 tw:mt-6 tw:text-[13px]">
        <div class="verdict tw:[&.err]:overflow-hidden tw:[&.err]:text-ellipsis tw:flex tw:items-center tw:gap-8 tw:font-semibold tw:[&.ok]:not-[&.err]:text-up-fg tw:[&.err]:text-down-fg" :class="info.valid ? 'ok' : 'err'"><Icon :name="info.valid ? 'check' : 'x'" :size="14" />{{ info.valid ? 'Корректный UUID' : 'Не корректный UUID' }}</div>
        <template v-if="info.canonical">
          <div class="kv tw:grid tw:grid-cols-[90px_minmax(0,1fr)] tw:gap-10"><span class="tw:text-text-2">Вид</span><code class="tw:font-data">{{ info.canonical }}</code></div>
          <div class="kv tw:grid tw:grid-cols-[90px_minmax(0,1fr)] tw:gap-10"><span class="tw:text-text-2">Версия</span><b class="tw:font-medium">v{{ info.version }}<template v-if="VERSIONS[info.version!]"> · {{ VERSIONS[info.version!] }}</template></b></div>
          <div class="kv tw:grid tw:grid-cols-[90px_minmax(0,1fr)] tw:gap-10"><span class="tw:text-text-2">Вариант</span><b class="tw:font-medium">{{ info.variant }}</b></div>
          <div v-if="info.time !== undefined" class="kv tw:grid tw:grid-cols-[90px_minmax(0,1fr)] tw:gap-10"><span class="tw:text-text-2">Создан</span><b class="tw:font-medium">{{ fmtTime(info.time) }}</b></div>
        </template>
        <p v-if="info.note" class="note tw:m-0 tw:text-muted">{{ info.note }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped src="./CodecUuid.css"></style>
