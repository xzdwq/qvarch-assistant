<script setup lang="ts">
/**
 * The journal as a trajectory (as a harness draws a session): over it — the turns' totals and a search; then a time
 * bar — the turns one after another, each step a stretch on its lane (context, model, tools); then every step in order,
 * a turn's head before its steps (when, which agent, who asked, how it ended, how long): its kind as a badge, its text
 * in a line (a tool's — its arguments → what came back). A step clicked — shown whole; pointed at — its stretch lit (and
 * a stretch pointed at — its step). The latest at the bottom, scrolled to.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { DocTurn, TurnOutcome } from '@shared/agent/docAi'
import { TRAJ_LANES, type TrajKind, type TrajLane, type TrajStep } from '@shared/agent/trajectory'
import { timeBar, turnSteps } from '@shared/agent/trajectoryView'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{ turns: readonly DocTurn[] }>()

/** Each kind: its badge's word and colour. */
const KIND: Record<TrajKind, { word: string; color: string }> = {
  system: { word: 'СИСТЕМА', color: 'var(--traj-system)' },
  context: { word: 'КОНТЕКСТ', color: 'var(--traj-context)' },
  user: { word: 'ВОПРОС', color: 'var(--traj-user)' },
  model: { word: 'ИИ', color: 'var(--traj-model)' },
  tool: { word: 'ИНСТРУМЕНТ', color: 'var(--traj-tool)' },
  answer: { word: 'ОТВЕТ', color: 'var(--traj-answer)' },
  error: { word: 'ОШИБКА', color: 'var(--traj-error)' },
}
/** Each lane of the bar: its word and colour. */
const LANE: Record<TrajLane, { word: string; color: string }> = {
  context: { word: 'Контекст', color: 'var(--traj-context)' },
  model: { word: 'Модель', color: 'var(--traj-model)' },
  tools: { word: 'Инструм.', color: 'var(--traj-tool)' },
}
const LANES = Object.keys(TRAJ_LANES) as TrajLane[]
const OUTCOME: Record<TurnOutcome, { icon: string; cls: string; title: string }> = {
  ok: { icon: 'check', cls: 'tw:text-up-fg', title: 'Ответил' },
  error: { icon: 'x', cls: 'tw:text-down-fg', title: 'Ошибка' },
  stopped: { icon: 'stop', cls: 'tw:text-warn-fg', title: 'Остановлен' },
}

const rows = computed(() => props.turns.map((t) => ({ turn: t, steps: turnSteps(t) })))
const bar = computed(() => timeBar(props.turns))
const sum = computed(() => {
  const t = props.turns
  const steps = rows.value.reduce((n, r) => n + r.steps.length, 0)
  const calls = t.reduce((n, x) => n + Object.values(x.tools).reduce((a, b) => a + b, 0), 0)
  return { n: t.length, steps, calls, failed: t.filter((x) => x.outcome === 'error').length, avg: t.length ? Math.round(t.reduce((n, x) => n + x.ms, 0) / t.length) : 0 }
})

// ---------- a search over the steps ----------
const q = ref('')
const hit = (s: TrajStep) => {
  const w = q.value.trim().toLowerCase()
  return !w || `${s.tool ?? ''} ${s.text} ${s.result ?? ''}`.toLowerCase().includes(w)
}

// ---------- pointed at, opened ----------
const lit = ref<string>()
const opened = ref(new Set<string>())
const idOf = (ti: number, si: number) => `${ti}:${si}`
function toggle(id: string): void {
  const n = new Set(opened.value)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  opened.value = n
}
const list = ref<HTMLElement>()
/** A stretch clicked: its step shown and opened. */
function reveal(id: string): void {
  if (!opened.value.has(id)) toggle(id)
  void nextTick(() => list.value?.querySelector(`[data-step="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
}
const toEnd = () => void nextTick(() => list.value && (list.value.scrollTop = list.value.scrollHeight))
onMounted(toEnd)
watch(() => props.turns.length, toEnd)

const secs = (ms: number) => (ms < 1000 ? `${ms} мс` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} с` : `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`)
function when(at: number): string {
  const d = new Date(at)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${hm}`
}
const pct = (v: number) => `${(v * 100).toFixed(3)}%`
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:min-h-0">
    <div class="tw:flex tw:flex-none tw:items-center tw:gap-12 tw:text-[11.5px] tw:text-muted tw:whitespace-nowrap tw:overflow-hidden">
      <span>ходов <b class="tw:text-text">{{ sum.n }}</b></span>
      <span>шагов <b class="tw:text-text">{{ sum.steps }}</b></span>
      <span>вызовов <b class="tw:text-text">{{ sum.calls }}</b></span>
      <span v-if="sum.failed">с ошибкой <b class="tw:text-down-fg">{{ sum.failed }}</b></span>
      <span v-if="sum.n">в среднем <b class="tw:text-text">{{ secs(sum.avg) }}</b></span>
      <span class="tw:flex-1"></span>
      <label class="tw:inline-flex tw:flex-none tw:items-center tw:gap-5 tw:h-22 tw:px-6 tw:border tw:border-border tw:rounded-r2 tw:bg-field tw:focus-within:border-accent"><Icon name="search" :size="11" /><input v-model="q" class="tw:w-120 tw:min-w-0 tw:border-0 tw:bg-transparent tw:text-text tw:text-[11.5px] tw:outline-none" placeholder="Поиск по шагам" spellcheck="false" @keydown.esc="q = ''" /></label>
    </div>
    <p v-if="!turns.length" class="tw:m-0 tw:py-10 tw:text-muted tw:text-[12px]">ИИ ещё не работал в этом документе. Позовите его в чате документа: <code>@ИИ · Имя</code>.</p>
    <template v-else>
      <!-- the time bar: the turns one after another, each step on its lane -->
      <div class="tw:flex-none tw:grid tw:grid-cols-[58px_minmax(0,1fr)] tw:gap-x-6 tw:gap-y-3 tw:py-4 tw:border-y tw:border-border tw:text-[10px] tw:text-muted">
        <template v-for="lane in LANES" :key="lane">
          <span class="tw:text-right tw:leading-8 tw:whitespace-nowrap">{{ LANE[lane].word }}</span>
          <div class="tw:relative tw:h-8">
            <i v-for="t in bar.turns.slice(1)" :key="`b${t.x}`" class="tw:absolute tw:top-0 tw:bottom-0 tw:w-1 tw:bg-border" :style="{ left: pct(t.x) }"></i>
            <i
              v-for="p in bar.pieces.filter((x) => x.lane === lane)"
              :key="`${p.turn}:${p.step}`"
              class="tw:absolute tw:top-0 tw:bottom-0 tw:rounded-[2px] tw:cursor-pointer tw:[&.dim]:opacity-25 tw:[&.on]:[box-shadow:0_0_0_1.5px_var(--text-hi)]"
              :class="{ on: lit === idOf(p.turn, p.step), dim: !hit(rows[p.turn].steps[p.step]) }"
              :style="{ left: pct(p.x), width: pct(p.w), background: KIND[rows[p.turn].steps[p.step].kind].color }"
              :title="`${KIND[rows[p.turn].steps[p.step].kind].word} · ${secs(rows[p.turn].steps[p.step].ms)}`"
              @pointerenter="lit = idOf(p.turn, p.step)"
              @pointerleave="lit = undefined"
              @click="reveal(idOf(p.turn, p.step))"
            ></i>
          </div>
        </template>
      </div>
      <!-- every step in order, a turn's head before its steps -->
      <div ref="list" class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col">
        <template v-for="(r, ti) in rows" :key="r.turn.id">
          <div class="tw:sticky tw:top-0 tw:z-1 tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:mt-4 tw:py-3 tw:px-6 tw:bg-pop tw:border-b tw:border-border tw:text-[11px] tw:whitespace-nowrap">
            <span class="tw:flex-none tw:px-5 tw:rounded-r1 tw:bg-white/8 tw:font-data tw:text-muted">Ход {{ ti + 1 }}</span>
            <Icon :name="OUTCOME[r.turn.outcome].icon" :size="11" class="tw:flex-none" :class="OUTCOME[r.turn.outcome].cls" :title="OUTCOME[r.turn.outcome].title" />
            <span class="tw:flex-none tw:font-data tw:text-muted">{{ when(r.turn.at) }}</span>
            <b class="tw:flex-none tw:inline-flex tw:items-center tw:gap-3 tw:text-accent-fg" :title="`ИИ участника ${r.turn.owner}`"><Icon name="sparkles" :size="10" />{{ r.turn.agent }}</b>
            <span class="tw:min-w-0 tw:truncate tw:text-muted">спросил {{ r.turn.asker }}</span>
            <span class="tw:flex-1"></span>
            <span v-if="r.turn.memory" class="tw:flex-none tw:px-5 tw:rounded-full tw:bg-accent/15 tw:text-accent-fg tw:text-[10px]" title="Обновил память документа">память</span>
            <span v-if="r.turn.wrote" class="tw:flex-none tw:font-data tw:text-text-2" title="Строк записано в заметки">+{{ r.turn.wrote }}</span>
            <span class="tw:flex-none tw:font-data tw:text-muted">{{ secs(r.turn.ms) }}</span>
          </div>
          <template v-for="(s, si) in r.steps" :key="si">
            <div
              v-if="hit(s)"
              :data-step="idOf(ti, si)"
              class="tw:grid tw:grid-cols-[84px_minmax(0,1fr)_auto] tw:items-start tw:gap-8 tw:py-3 tw:px-6 tw:border-b tw:border-white/4 tw:cursor-pointer tw:hover:bg-white/4 tw:[&.on]:bg-white/6"
              :class="{ on: lit === idOf(ti, si) }"
              @pointerenter="lit = idOf(ti, si)"
              @pointerleave="lit = undefined"
              @click="toggle(idOf(ti, si))"
            >
              <span class="tw:justify-self-end tw:mt-1 tw:px-5 tw:rounded-r1 tw:font-data tw:text-[9.5px] tw:font-semibold tw:tracking-[0.04em]" :style="{ color: KIND[s.kind].color, background: `color-mix(in srgb, ${KIND[s.kind].color} 14%, transparent)` }">{{ KIND[s.kind].word }}</span>
              <span class="tw:min-w-0 tw:text-[12px] tw:text-text-2 tw:[&.full]:whitespace-pre-wrap tw:[&.full]:break-words tw:[&:not(.full)]:truncate" :class="{ full: opened.has(idOf(ti, si)), 'tw:font-data': s.kind === 'tool' }">
                <template v-if="s.kind === 'tool'"><b class="tw:text-text" :class="{ 'tw:text-down-fg': s.failed }">{{ s.tool }}</b> {{ s.text }}<template v-if="s.result !== undefined"> <span class="tw:text-muted">→</span> <span :class="s.failed ? 'tw:text-down-fg' : 'tw:text-muted'">{{ s.result }}</span></template></template>
                <template v-else>{{ s.text }}</template>
              </span>
              <span class="tw:font-data tw:text-[10.5px] tw:text-muted tw:whitespace-nowrap">{{ s.ms ? secs(s.ms) : '' }}</span>
            </div>
          </template>
        </template>
      </div>
    </template>
  </div>
</template>
