<script setup lang="ts">
/**
 * The AI's turns in a document, the latest first: when, which agent (whose), who asked and what, the tools it used,
 * the lines it wrote, whether it changed the memory, how long, how it ended — and a summary over them.
 */
import { computed } from 'vue'
import type { DocTurn, TurnOutcome } from '@shared/agent/docAi'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ turns: readonly DocTurn[] }>()
const latest = computed(() => [...props.turns].reverse())
const sum = computed(() => {
  const t = props.turns
  return {
    n: t.length,
    failed: t.filter((x) => x.outcome === 'error').length,
    lines: t.reduce((n, x) => n + x.wrote, 0),
    avg: t.length ? Math.round(t.reduce((n, x) => n + x.ms, 0) / t.length) : 0,
  }
})
/** Each outcome: its icon and colour. */
const OUTCOME: Record<TurnOutcome, { icon: string; cls: string; title: string }> = {
  ok: { icon: 'check', cls: 'tw:text-up-fg', title: 'Ответил' },
  error: { icon: 'x', cls: 'tw:text-down-fg', title: 'Ошибка' },
  stopped: { icon: 'stop', cls: 'tw:text-warn-fg', title: 'Остановлен' },
}
const secs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} с` : `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`)
function when(at: number): string {
  const d = new Date(at)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${hm}`
}
const toolsOf = (t: DocTurn) =>
  Object.entries(t.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:min-h-0">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-12 tw:text-[11.5px] tw:text-muted tw:whitespace-nowrap tw:overflow-hidden">
      <span>ходов <b class="tw:text-text">{{ sum.n }}</b></span>
      <span v-if="sum.failed">с ошибкой <b class="tw:text-down-fg">{{ sum.failed }}</b></span>
      <span>строк записано <b class="tw:text-text">{{ sum.lines }}</b></span>
      <span v-if="sum.n">в среднем <b class="tw:text-text">{{ secs(sum.avg) }}</b></span>
    </div>
    <p v-if="!turns.length" class="tw:m-0 tw:py-10 tw:text-muted tw:text-[12px]">ИИ ещё не работал в этом документе. Позовите его в чате документа: <code>@ИИ · Имя</code>.</p>
    <div v-else class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-2">
      <div v-for="t in latest" :key="t.id" class="tw:flex tw:flex-col tw:gap-2 tw:py-5 tw:px-8 tw:rounded-[8px] tw:hover:bg-white/4">
        <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[12px] tw:whitespace-nowrap">
          <Icon :name="OUTCOME[t.outcome].icon" :size="12" class="tw:flex-none" :class="OUTCOME[t.outcome].cls" :title="OUTCOME[t.outcome].title" />
          <span class="tw:flex-none tw:font-data tw:text-muted tw:text-[11px]">{{ when(t.at) }}</span>
          <b class="tw:flex-none tw:inline-flex tw:items-center tw:gap-3 tw:text-accent-fg" :title="`ИИ участника ${t.owner}`"><Icon name="sparkles" :size="11" />{{ t.agent }}</b>
          <span class="tw:min-w-0 tw:truncate tw:text-text-2" :title="t.question">{{ t.asker }}: {{ t.question || '…' }}</span>
          <span class="tw:flex-1"></span>
          <span v-if="t.memory" class="tw:flex-none tw:px-5 tw:rounded-full tw:bg-accent/15 tw:text-accent-fg tw:text-[10.5px]" title="Обновил память документа">память</span>
          <span v-if="t.wrote" class="tw:flex-none tw:font-data tw:text-[11px] tw:text-text-2" title="Строк записано в заметки">+{{ t.wrote }}</span>
          <span class="tw:flex-none tw:font-data tw:text-[11px] tw:text-muted">{{ secs(t.ms) }}</span>
        </div>
        <div v-if="toolsOf(t).length || t.error" class="tw:flex tw:items-center tw:gap-4 tw:min-w-0 tw:pl-18 tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis tw:text-[10.5px]">
          <span v-if="t.error" class="tw:min-w-0 tw:truncate tw:text-down-fg" :title="t.error">{{ t.error }}</span>
          <template v-else>
            <span v-for="x in toolsOf(t)" :key="x" class="tw:flex-none tw:px-5 tw:rounded-r1 tw:bg-white/6 tw:font-data tw:text-text-2">{{ x }}</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
