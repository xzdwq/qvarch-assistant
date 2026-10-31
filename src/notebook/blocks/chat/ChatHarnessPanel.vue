<script setup lang="ts">
/**
 * A chat's harness run, over what one writes: its head in one line (the phase, the steps done, the iteration, the
 * buttons: «Начать» the plan, stop, go on, take it off), unfolded — the goal, the steps, the criteria with their
 * checks' results, the agent's question, the latest of its journal.
 */
import { computed, ref, watch } from 'vue'
import { HARNESS_ENDED, HARNESS_PHASE_TEXT, REVIEWER_OFF } from '@shared/agent/harness/constants'
import type { HarnessCriterion } from '@shared/agent/harness/model'
import { checkMet } from '@shared/agent/harness/failures'
import Icon from '@renderer/components/Icon.vue'
import { useChatPort } from './chatPort'
import HarnessPlanEditor from './HarnessPlanEditor.vue'
import HarnessRoomSettings from './HarnessRoomSettings.vue'
import type { PlanEdits } from '@shared/agent/harness/planDraft'

const props = defineProps<{ room: string }>()
const port = useChatPort().harness!
const run = computed(() => port.runOf(props.room))
const open = ref(true)
/** The plan's window's corrections «Начать» goes with. */
const edits = ref<PlanEdits>({ agent: false, remarks: '' })
/**
 * «Начать»: the plan edited only — taken as edited, to work; something for the agent to take in (other instructions,
 * remarks) — it takes them in (keeps or mends its plan, the edits kept), then to work at once.
 */
function begin(): void {
  const e = edits.value
  if (e.agent) port.replan(props.room, { ...(e.guides ? { guides: e.guides } : {}), ...(e.draft ? { draft: e.draft } : {}), remarks: e.remarks, go: true })
  else port.confirm(props.room, e.draft)
}
// (a plan waiting for «Начать» is shown: its button is in it)
watch(
  () => run.value?.phase,
  (p) => {
    if (p === 'confirm') open.value = true
    // (a plan made anew, or the run gone on: no corrections pending)
    edits.value = { agent: false, remarks: '' }
  },
)
const ended = computed(() => !!run.value && HARNESS_ENDED.includes(run.value.phase))
const doneSteps = computed(() => run.value?.steps.filter((s) => s.state === 'done').length ?? 0)
const STEP_MARK = { todo: '○', doing: '◐', done: '✓', failed: '✗' } as const
const STEP_TONE = { todo: 'tw:text-muted', doing: 'tw:text-accent-fg', done: 'tw:text-up-fg', failed: 'tw:text-down-fg' } as const
// (a check whose block is not written yet — not a failure: it waits)
// (a test that was to run through and found defects of the thing tested: met — what it found is its result)
const markOf = (c: HarnessCriterion) => (!c.check ? '•' : !c.result || c.result.missing ? '○' : checkMet(c) ? '✓' : '✗')
const toneOf = (c: HarnessCriterion) => (!c.check || !c.result || c.result.missing ? 'tw:text-muted' : checkMet(c) ? 'tw:text-up-fg' : 'tw:text-down-fg')
const LOG_TONE = { info: 'tw:text-muted', ok: 'tw:text-up-fg', fail: 'tw:text-down-fg' } as const
const log = computed(() => (run.value?.log ?? []).slice(-6).reverse())
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const btn = 'tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-22 tw:py-0 tw:px-8 tw:rounded-full tw:text-[11.5px]'
/** The instructions the run follows, by title (work · check). */
const guideTitles = computed(() => {
  const g = run.value?.guides
  if (!g || (!g.work.length && !g.check.length)) return ''
  const title = (id: string) => port.guides().find((x) => x.id === id)?.title ?? id
  return [g.work.length ? `работа — ${g.work.map(title).join(', ')}` : '', g.check.length ? `проверка — ${g.check.map(title).join(', ')}` : ''].filter(Boolean).join(' · ')
})
</script>

<template>
  <div v-if="run" class="tw:flex tw:flex-col tw:min-w-0 tw:mb-6 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-bg/40">
    <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:h-30 tw:px-8 tw:whitespace-nowrap">
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:text-text" :title="open ? 'Свернуть' : 'Развернуть'" @click="open = !open">
        <Icon :name="open ? 'chevronDown' : 'chevronRight'" :size="12" />
      </button>
      <Icon name="repeat" :size="13" class="tw:flex-none" :class="port.busy(room) ? 'tw:text-accent-fg tw:animate-pulse' : 'tw:text-muted'" />
      <b class="tw:flex-none tw:text-[12px]">Harness</b>
      <span class="tw:flex-none tw:text-[11.5px]" :class="run.phase === 'done' ? 'tw:text-up-fg' : run.phase === 'help' || run.phase === 'stopped' ? 'tw:text-down-fg' : 'tw:text-accent-fg'">{{ HARNESS_PHASE_TEXT[run.phase] }}</span>
      <span v-if="run.steps.length" class="tw:flex-none tw:text-muted tw:text-[11.5px] tw:font-data" title="Шагов сделано">{{ doneSteps }}/{{ run.steps.length }}</span>
      <span v-if="run.iteration" class="tw:min-w-0 tw:truncate tw:text-dim tw:text-[11px] tw:font-data" title="Итерация из лимита">итер. {{ run.iteration - run.iterBase }}/{{ run.limits.iterations }}</span>
      <span class="tw:flex-1"></span>
      <HarnessRoomSettings :room="room" />
      <button v-if="run.phase === 'confirm'" :class="btn" class="tw:bg-accent tw:text-white tw:hover:brightness-110" :title="edits.agent ? 'ИИ учтёт выбранные инструкции и замечания (ваши правки сохранятся), потом сразу работа' : 'Принять план (с вашими правками) и начать работу'" @click="begin"><Icon name="play" :size="9" />Начать</button>
      <button v-if="ended && run.phase !== 'done'" :class="btn" title="Продолжить с того же места (лимиты — заново)" @click="port.resume(room)"><Icon name="play" :size="9" />Продолжить</button>
      <button v-if="!ended" :class="btn" title="Остановить harness" @click="port.stop(room)"><Icon name="stop" :size="9" />Стоп</button>
      <button v-if="ended" class="tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:text-text" title="Убрать панель" @click="port.close(room)"><Icon name="x" :size="11" /></button>
    </div>
    <div v-if="open" class="tw:flex tw:flex-col tw:gap-6 tw:max-h-320 tw:overflow-y-auto tw:px-12 tw:pb-8 tw:text-[12px] tw:leading-[1.45]">
      <div class="tw:text-text-2 tw:wrap-anywhere">{{ run.goal }}</div>
      <div v-if="run.question" class="tw:py-4 tw:px-8 tw:rounded-[8px] tw:bg-accent/12 tw:wrap-anywhere">❓ {{ run.question }} <span class="tw:text-muted">— ответьте в чате</span></div>
      <!-- the plan waiting for «Начать»: corrected here (instructions, steps, criteria, remarks) -->
      <HarnessPlanEditor v-if="run.phase === 'confirm'" v-model:edits="edits" :room="room" :run="run" />
      <div v-if="run.phase !== 'confirm' && guideTitles" class="tw:text-muted tw:text-[11.5px] tw:wrap-anywhere">Инструкции: {{ guideTitles }}</div>
      <div v-if="run.phase !== 'confirm' && run.steps.length" class="tw:flex tw:flex-col tw:gap-1">
        <div v-for="(s, i) in run.steps" :key="i" class="tw:flex tw:gap-6 tw:min-w-0" :title="s.note">
          <span class="tw:flex-none tw:w-12 tw:text-center" :class="STEP_TONE[s.state]">{{ STEP_MARK[s.state] }}</span>
          <span class="tw:min-w-0 tw:wrap-anywhere">{{ i + 1 }}. {{ s.title }}</span>
        </div>
      </div>
      <div v-if="run.phase !== 'confirm' && run.criteria.length" class="tw:flex tw:flex-col tw:gap-1">
        <span class="tw:text-muted tw:text-[11px]">Критерии</span>
        <div v-for="c in run.criteria" :key="c.id" class="tw:flex tw:gap-6 tw:min-w-0" :title="c.result?.error ?? (c.check ? `Проверка «${c.check.block}» в ${c.check.path}` : run.reviewer === REVIEWER_OFF ? 'Без блока проверки — ИИ подтверждает данными в отчёте' : 'Проверит финальная проверка')">
          <span class="tw:flex-none tw:w-12 tw:text-center" :class="toneOf(c)">{{ markOf(c) }}</span>
          <span class="tw:flex-1 tw:min-w-0 tw:wrap-anywhere">{{ c.text }}<span v-if="c.result?.missing" class="tw:block tw:text-muted tw:text-[11px]">блок «{{ c.check?.block }}» ещё не создан</span><span v-else-if="c.result && !c.result.ok && c.result.error" class="tw:block tw:text-[11px] tw:line-clamp-3" :class="checkMet(c) ? 'tw:text-muted' : 'tw:text-down-fg'">{{ checkMet(c) ? 'найдены дефекты: ' : '' }}{{ c.result.error }}</span></span>
          <span v-if="c.check" class="tw:flex-none tw:text-dim tw:text-[11px] tw:font-data">{{ c.check.block }}</span>
        </div>
      </div>
      <div class="tw:flex tw:flex-col tw:gap-1 tw:pt-4 tw:border-t tw:border-border">
        <div v-for="(l, i) in log" :key="i" class="tw:flex tw:gap-6 tw:min-w-0 tw:text-[11.5px]">
          <span class="tw:flex-none tw:text-dim tw:font-data">{{ hm(l.at) }}</span>
          <span class="tw:min-w-0 tw:wrap-anywhere tw:whitespace-pre-wrap" :class="LOG_TONE[l.tone]">{{ l.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
