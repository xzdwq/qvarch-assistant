<script setup lang="ts">
import { computed, ref } from 'vue'
import { REQ_CAT_WORDS, REQ_CATS, reqCat, type ReqCat } from '@shared/browser/inspect/constants'
import type { ActionGroup } from '@shared/browser/inspect/types'
import InspectGroup from './InspectGroup.vue'
import InspectSection from './InspectSection.vue'

/**
 * The log of acts, the newest on top, folding as a whole: each act a group (folded — its time and numbers; open — its
 * requests coloured by source, errors, busy time). The sources' legend filters the requests shown; the page's own
 * groups (polling, timers) hidden unless asked; a filter by words (a label, an address, an error).
 */
const props = defineProps<{ tabId: string; groups: ActionGroup[] }>()
const showOwn = ref(false)
const q = ref('')
/** The sources shown (none picked — all). */
const only = ref(new Set<ReqCat>())
const own = computed(() => props.groups.filter((g) => g.kind === 'background').length)
const acts = computed(() => props.groups.length - own.value)
/** How many requests of each source the log has (the legend's numbers). */
const counts = computed(() => {
  const c = Object.fromEntries(REQ_CATS.map((k) => [k, 0])) as Record<ReqCat, number>
  for (const g of props.groups) for (const r of g.reqs) c[reqCat(r.type)]++
  return c
})
const pick = (k: ReqCat) => {
  const s = new Set(only.value)
  if (s.has(k)) s.delete(k)
  else s.add(k)
  only.value = s
}
const shown = computed(() => {
  const words = q.value.trim().toLowerCase()
  const hit = (g: ActionGroup) => !words || `${g.label} ${g.target ?? ''} ${g.reqs.map((r) => r.url).join(' ')} ${g.notes.map((n) => n.text).join(' ')}`.toLowerCase().includes(words)
  const bySource = (g: ActionGroup) => !only.value.size || g.reqs.some((r) => only.value.has(reqCat(r.type)))
  return [...props.groups].reverse().filter((g) => (showOwn.value || g.kind !== 'background') && hit(g) && bySource(g))
})
</script>

<template>
  <InspectSection id="log" title="Журнал" :note="`действий ${acts}${own ? ` · фон ${own}` : ''}`">
    <template #tools>
      <button class="tw:flex-none tw:inline-flex tw:items-center tw:h-22 tw:px-6 tw:border-0 tw:rounded-r2 tw:text-[11px] tw:whitespace-nowrap tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi" :class="{ on: showOwn }" title="Группы без действия пользователя: опрос сервера, таймеры, фоновые запросы" @click="showOwn = !showOwn">фон</button>
    </template>
    <div class="tw:flex tw:flex-col tw:gap-6 tw:px-10 tw:py-6 tw:border-b tw:border-b-border">
      <input v-model="q" class="tw:w-full tw:h-24 tw:text-[12px]" placeholder="Фильтр: кнопка, адрес, ошибка" spellcheck="false" />
      <div class="tw:flex tw:flex-wrap tw:gap-4">
        <button v-for="k in REQ_CATS.filter((c) => counts[c])" :key="k" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:px-6 tw:border tw:border-border tw:rounded-r2 tw:bg-transparent tw:text-[11px] tw:font-data tw:text-text-2 tw:hover:bg-hover tw:[&.on]:border-accent tw:[&.on]:text-text-hi tw:[&.off]:opacity-45" :class="{ on: only.has(k), off: only.size && !only.has(k) }" :title="`${REQ_CAT_WORDS[k].name} — показать только группы с ними`" @click="pick(k)">
          <i class="tw:w-8 tw:h-8 tw:rounded-[2px]" :style="{ background: `var(--req-${k})` }"></i>{{ REQ_CAT_WORDS[k].short }} {{ counts[k] }}
        </button>
      </div>
    </div>
    <p v-if="!shown.length" class="tw:m-0 tw:p-14 tw:text-[12px] tw:text-muted">Действий пока нет — кликните на странице, введите текст, перейдите по ссылке.</p>
    <InspectGroup v-for="g in shown" :key="g.id" :tab-id="tabId" :group="g" :only="only" />
  </InspectSection>
</template>
