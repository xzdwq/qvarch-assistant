<script setup lang="ts">
import { computed, ref } from 'vue'
import { groupSummary } from '@shared/browser/inspect/actionLog'
import { REQ_CAT_WORDS, REQ_CATS, reqCat, type ActionKind, type ReqCat } from '@shared/browser/inspect/constants'
import { ms } from '@shared/browser/inspect/inspectReport'
import { clockText } from '@shared/browser/inspect/perfMonitor'
import { kb } from '@shared/browser/inspect/siteFacts'
import type { ActionGroup } from '@shared/browser/inspect/types'
import Icon from '../../../components/Icon.vue'
import InspectReqRow from './InspectReqRow.vue'
import TimelineView from './TimelineView.vue'

/**
 * One act of the log. Folded: when it was (to the millisecond), what was done, how long, its requests by source (a
 * bar of their share, each source named), all their times added up (Σ) and as the clock saw them, its errors.
 * The pointer over it — its element framed on the page («показать» — scrolled to). Open: the requests as a waterfall
 * from the act, coloured by source; the console's errors; the main thread's busy time; the response's parts.
 */
const props = defineProps<{ tabId: string; group: ActionGroup; only: Set<ReqCat> }>()
const open = ref(false)
const s = computed(() => groupSummary(props.group))
/** Each act's icon. */
const ICON: Record<ActionKind, string> = { click: 'pointer', input: 'keyboard', submit: 'send', key: 'keyboard', scroll: 'rows', nav: 'globe', route: 'link', background: 'repeat' }
/** What the scrolled content did meanwhile: elements swapped — a virtual list; only added — loaded as it goes. */
const scrollKind = computed(() => {
  const s = props.group.scroll
  if (!s) return ''
  if (s.added > 5 && s.removed > 5) return `виртуальный список: элементы заменяются (+${s.added} / −${s.removed})`
  if (s.added > 5) return `подгрузка при прокрутке: +${s.added} элементов`
  return ''
})
/** The group's own span for its timeline: from the act to the last thing it caused. */
const until = computed(() => Math.max(props.group.end, ...props.group.reqs.map((r) => r.end ?? props.group.end), ...props.group.anims.map((a) => a.end ?? props.group.end)))
/** The requests by source, in the sources' order (the bar and its words). */
const bySource = computed(() => {
  const n = new Map<ReqCat, number>()
  for (const r of props.group.reqs) n.set(reqCat(r.type), (n.get(reqCat(r.type)) ?? 0) + 1)
  return REQ_CATS.filter((k) => n.get(k)).map((k) => ({ k, n: n.get(k)! }))
})
/** The waterfall's span: from the act to its last request's end (at least a moment). */
const span = computed(() => Math.max(50, ...props.group.reqs.map((r) => (r.end ?? props.group.end) - props.group.at), props.group.end - props.group.at))
const reqs = computed(() => [...props.group.reqs].filter((r) => !props.only.size || props.only.has(reqCat(r.type))).sort((a, b) => a.start - b.start))
const mark = (scroll: boolean) => props.group.target && void window.qa.browser('inspectShow', props.tabId, props.group.target, scroll)
const unmark = () => props.group.target && void window.qa.browser('inspectShow', props.tabId)
</script>

<template>
  <div class="tw:flex tw:flex-col tw:border-b tw:border-b-border tw:min-w-0" @mouseenter="mark(false)" @mouseleave="unmark">
    <button class="tw:flex tw:flex-col tw:gap-3 tw:w-full tw:px-10 tw:py-5 tw:border-0 tw:bg-transparent tw:text-left tw:hover:bg-hover tw:min-w-0" @click="open = !open">
      <span class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:w-full">
        <Icon :name="open ? 'chevronDown' : 'chevronRight'" :size="11" class="tw:flex-none tw:text-muted" />
        <Icon :name="ICON[group.kind]" :size="12" class="tw:flex-none tw:text-muted" />
        <span class="tw:flex-none tw:font-data tw:text-[11px] tw:text-muted" :title="new Date(group.at).toLocaleString()">{{ clockText(group.at) }}</span>
        <span class="tw:min-w-0 tw:truncate tw:text-[12.5px] tw:text-text" :title="group.label">{{ group.label }}</span>
        <span class="tw:flex-1"></span>
        <span v-if="!group.closed" class="tw:flex-none tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-accent tw:animate-pulse" title="Ещё собирается"></span>
        <b class="tw:flex-none tw:font-data tw:font-normal tw:text-[12px] tw:text-text-2 tw:[&.slow]:text-warn-fg tw:[&.very]:text-down-fg" :class="{ slow: s.duration > 1000, very: s.duration > 3000 }">{{ ms(s.duration) }}</b>
      </span>
      <span class="tw:flex tw:items-center tw:gap-8 tw:pl-30 tw:min-w-0 tw:text-[11.5px] tw:text-muted tw:font-data tw:whitespace-nowrap tw:overflow-hidden">
        <span v-if="s.count" :title="`Запросов: ${s.count}. Σ — их время, сложенное; ⏱ — сколько времени шёл хоть один`">{{ s.count }} запр. · Σ {{ ms(s.sum) }} · ⏱ {{ ms(s.wall) }}</span>
        <span v-if="s.bytes">{{ kb(s.bytes) }}</span>
        <span v-if="s.failed" class="tw:text-down-fg">✕ {{ s.failed }}</span>
        <span v-if="s.errors" class="tw:text-down-fg" title="Ошибок в консоли">● {{ s.errors }}</span>
        <span v-if="s.warnings" class="tw:text-warn-fg" title="Предупреждений в консоли">● {{ s.warnings }}</span>
        <span v-if="group.busy.total" :class="{ 'tw:text-warn-fg': group.busy.max > 200 }" title="Главный поток занят (длинные кадры)">⚙ {{ ms(group.busy.total) }}</span>
        <span v-if="group.response" :class="{ 'tw:text-warn-fg': group.response.total > 200 }" title="Отклик на действие (INP): ожидание + обработка + отрисовка">↯ {{ ms(group.response.total) }}</span>
        <span v-if="group.anims.length" :class="{ 'tw:text-warn-fg': group.anims.some((a) => a.cost === 'layout') }" title="Анимаций и переходов">◐ {{ group.anims.length }}</span>
        <span v-if="group.scroll" :class="{ 'tw:text-warn-fg': group.scroll.fps < 50 || group.scroll.slow > 2 }" title="Прокрутка: расстояние, кадров в секунду">{{ group.scroll.dir === 'up' ? '↑' : group.scroll.dir === 'side' ? '↔' : '↓' }} {{ group.scroll.distance }} px · {{ group.scroll.fps }} fps</span>
      </span>
      <!-- the requests by source: a bar of their shares (2px gaps), each source named after it -->
      <span v-if="bySource.length" class="tw:flex tw:items-center tw:gap-8 tw:pl-30 tw:min-w-0 tw:w-full">
        <span class="tw:flex tw:gap-2 tw:w-90 tw:flex-none tw:h-6">
          <i v-for="b in bySource" :key="b.k" class="tw:h-full tw:first:rounded-l-[3px] tw:last:rounded-r-[3px]" :style="{ flex: b.n, background: `var(--req-${b.k})` }"></i>
        </span>
        <span class="tw:flex tw:gap-8 tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-[11px] tw:font-data tw:text-text-2">
          <span v-for="b in bySource" :key="b.k" :title="REQ_CAT_WORDS[b.k].name">{{ REQ_CAT_WORDS[b.k].short }} {{ b.n }}</span>
        </span>
      </span>
    </button>
    <div v-if="open" class="tw:flex tw:flex-col tw:gap-6 tw:px-10 tw:pb-8 tw:pl-28 tw:min-w-0">
      <div v-if="group.target || group.url" class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[11.5px] tw:text-muted">
        <span class="tw:min-w-0 tw:truncate tw:font-data" :title="group.target ?? group.url">{{ group.target ?? group.url }}</span>
        <button v-if="group.target" class="tw:flex-none tw:h-20 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-panel-3 tw:text-text-2 tw:text-[11px] tw:hover:text-text" title="Прокрутить страницу к элементу и показать его" @click.stop="mark(true)">показать</button>
      </div>
      <TimelineView :groups="[group]" :monitor="[]" :from="group.at - 20" :to="until + 40" compact />
      <div v-if="group.scroll" class="tw:flex tw:flex-col tw:gap-1 tw:text-[11.5px] tw:text-text-2 tw:font-data">
        <span>прокрутка {{ group.scroll.distance }} px за {{ ms(group.scroll.ms) }} · {{ group.scroll.fps }} кадров/с · рывков (кадр > 50 мс) {{ group.scroll.slow }} · самый долгий кадр {{ ms(group.scroll.maxFrame) }}</span>
        <span v-if="scrollKind" class="tw:text-accent-fg">{{ scrollKind }}</span>
      </div>
      <div v-if="group.response" class="tw:text-[11.5px] tw:text-text-2 tw:font-data">отклик {{ ms(group.response.total) }}: ожидание {{ ms(group.response.delay) }} · обработка {{ ms(group.response.processing) }} · отрисовка {{ ms(group.response.presentation) }}</div>
      <div v-if="group.busy.count" class="tw:flex tw:flex-col tw:gap-2 tw:text-[11.5px]">
        <span class="tw:text-text-2">Поток занят {{ ms(group.busy.total) }} ({{ group.busy.count }} длинн. кадров, самый долгий {{ ms(group.busy.max) }})</span>
        <span v-for="b in group.busy.scripts" :key="b.src" class="tw:min-w-0 tw:truncate tw:font-data tw:text-muted" :title="b.src">{{ ms(b.ms) }} — {{ b.src }}</span>
      </div>
      <div v-if="group.shift" class="tw:text-[11.5px] tw:text-warn-fg">Сдвиг вёрстки: {{ group.shift.toFixed(3) }}</div>
      <div v-for="(n, i) in group.notes" :key="i" class="tw:flex tw:flex-col tw:gap-1 tw:px-6 tw:py-3 tw:rounded-r2 tw:bg-down/10 tw:[&.warning]:bg-warn/10 tw:text-[11.5px]" :class="n.level">
        <span class="tw:flex tw:gap-6 tw:min-w-0"><span class="tw:flex-none tw:font-data tw:text-muted">{{ clockText(n.at) }}</span><span class="tw:whitespace-pre-wrap tw:break-all tw:text-text tw:max-h-120 tw:overflow-auto">{{ n.text }}</span></span>
        <span v-if="n.where" class="tw:font-data tw:text-muted tw:truncate" :title="n.where">{{ n.where }}</span>
      </div>
      <div v-if="reqs.length" class="tw:flex tw:flex-col tw:min-w-0">
        <InspectReqRow v-for="r in reqs" :key="r.id" :tab-id="tabId" :req="r" :from="group.at" :span="span" />
        <span v-if="group.moreReqs" class="tw:text-[11px] tw:text-muted">и ещё {{ group.moreReqs }} запросов</span>
      </div>
    </div>
  </div>
</template>
