<script setup lang="ts">
import { computed, ref } from 'vue'
import { ms } from '@shared/browser/inspect/inspectReport'
import { kb } from '@shared/browser/inspect/siteFacts'
import { rangeBusy, rangeHosts } from '@shared/browser/inspect/timeline'
import type { ActionGroup, MonitorSample } from '@shared/browser/inspect/types'
import InspectSection from './InspectSection.vue'
import TimelineView from './TimelineView.vue'

/**
 * The timeline of the page over a span: the last seconds, all of it, or one act (picked on its track); under it what
 * the span went on (scripts, rendering, the rest, idle) and the domains — their scripts' time on the main thread and
 * their bytes (the site's own marked), as DevTools' summary of a recording.
 */
const props = defineProps<{ groups: ActionGroup[]; monitor: MonitorSample[]; pageUrl: string }>()
const SPANS = [
  { id: '10', label: '10 с', ms: 10_000 },
  { id: '30', label: '30 с', ms: 30_000 },
  { id: '120', label: '2 мин', ms: 120_000 },
  { id: 'all', label: 'всё', ms: 0 },
] as const
const spanId = ref<string>('30')
const zoom = ref<ActionGroup>()
/** The newest moment the data knows (the span ends there — still while nothing happens). */
const latest = computed(() => Math.max(0, ...props.groups.map((g) => g.end), ...props.monitor.map((s) => s.at)))
const earliest = computed(() => Math.min(...props.groups.map((g) => g.at), ...props.monitor.map((s) => s.at - 1000), latest.value))
const range = computed(() => {
  const z = zoom.value
  if (z) {
    const end = Math.max(z.end, ...z.reqs.map((r) => r.end ?? z.end), ...z.anims.map((a) => a.end ?? z.end))
    const pad = Math.max(30, (end - z.at) * 0.05)
    return { from: z.at - pad, to: end + pad }
  }
  const s = SPANS.find((x) => x.id === spanId.value)!
  return { from: s.ms ? latest.value - s.ms : earliest.value, to: latest.value }
})
const busy = computed(() => rangeBusy(props.monitor, range.value.from, range.value.to))
const hosts = computed(() => rangeHosts(props.groups, range.value.from, range.value.to, props.pageUrl).slice(0, 8))
const BUSY = computed(() => [
  { name: 'Скрипты', v: busy.value.script, color: 'var(--viz-1)' },
  { name: 'Отрисовка (раскладка, стили)', v: busy.value.render, color: 'var(--viz-2)' },
  { name: 'Прочее (система, сборка мусора)', v: busy.value.other, color: 'var(--viz-rest)' },
  { name: 'Простой', v: busy.value.idle, color: 'var(--panel-3)' },
])
const CHIP = 'tw:h-22 tw:px-8 tw:border-0 tw:rounded-r2 tw:text-[11px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:[&.on]:bg-accent/18 tw:[&.on]:text-text-hi'
</script>

<template>
  <InspectSection id="timeline" title="Хронология" :note="zoom ? zoom.label : `${ms(range.to - range.from)}`">
    <template #tools>
      <button v-if="zoom" :class="CHIP" title="Вернуться к периоду" @click="zoom = undefined">← назад</button>
      <template v-else>
        <button v-for="s in SPANS" :key="s.id" :class="[CHIP, { on: spanId === s.id }]" @click="spanId = s.id">{{ s.label }}</button>
      </template>
    </template>
    <div class="tw:flex tw:flex-col tw:gap-10 tw:px-10 tw:py-8 tw:min-w-0">
      <p v-if="!groups.length && monitor.length < 2" class="tw:m-0 tw:text-[12px] tw:text-muted">Пока пусто — действуйте на странице.</p>
      <TimelineView v-else :groups="groups" :monitor="monitor" :from="range.from" :to="range.to" @zoom="(g) => (zoom = g)" />
      <!-- what the span went on -->
      <div v-if="busy.total" class="tw:flex tw:flex-col tw:gap-4">
        <span class="tw:text-[11.5px] tw:text-text-2">Главный поток за {{ ms(busy.total) }}</span>
        <div class="tw:flex tw:gap-2 tw:h-8">
          <i v-for="b in BUSY.filter((x) => x.v > 0)" :key="b.name" class="tw:h-full tw:first:rounded-l-[3px] tw:last:rounded-r-[3px]" :style="{ flex: b.v, background: b.color }" :title="`${b.name}: ${ms(b.v)}`"></i>
        </div>
        <div class="tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-10 tw:gap-y-1 tw:text-[11.5px]">
          <template v-for="b in BUSY" :key="b.name">
            <span class="tw:text-muted tw:whitespace-nowrap"><i class="tw:inline-block tw:w-8 tw:h-8 tw:mr-4 tw:rounded-[2px]" :style="{ background: b.color }"></i>{{ b.name }}</span>
            <span class="tw:font-data tw:text-text-2">{{ ms(b.v) }}</span>
          </template>
        </div>
      </div>
      <!-- the domains -->
      <div v-if="hosts.length" class="tw:flex tw:flex-col tw:gap-2 tw:text-[11.5px] tw:min-w-0">
        <div class="tw:grid tw:grid-cols-[minmax(0,1fr)_70px_70px] tw:gap-6 tw:text-muted tw:border-b tw:border-b-border tw:pb-2">
          <span>Домен</span><span class="tw:text-right" title="Время главного потока в скриптах этого домена">Поток</span><span class="tw:text-right">Передано</span>
        </div>
        <div v-for="h in hosts" :key="h.host" class="tw:grid tw:grid-cols-[minmax(0,1fr)_70px_70px] tw:gap-6 tw:font-data">
          <span class="tw:min-w-0 tw:truncate tw:text-text-2" :title="h.host">{{ h.host }}<b v-if="h.first" class="tw:ml-6 tw:px-4 tw:rounded-[3px] tw:bg-accent/20 tw:font-normal tw:text-[10px] tw:text-accent-fg">свой</b></span>
          <span class="tw:text-right tw:text-text">{{ h.ms ? ms(h.ms) : '—' }}</span>
          <span class="tw:text-right tw:text-muted">{{ h.bytes ? kb(h.bytes) : '—' }}</span>
        </div>
      </div>
    </div>
  </InspectSection>
</template>
