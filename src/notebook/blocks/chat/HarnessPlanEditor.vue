<script setup lang="ts">
/**
 * A harness plan waiting for «Начать» (the panel's head), to correct: the instructions it works and checks by (picked
 * from the catalog), its steps and criteria as text, the person's remarks. What «Начать» does is found out here: the
 * steps and criteria edited only — the plan taken as edited; other instructions or remarks — the agent takes them in
 * first (keeps its plan or mends it), then the work.
 */
import { computed, reactive, watch } from 'vue'
import type { HarnessRun } from '@shared/agent/harness/model'
import type { PlanDraft, PlanEdits } from '@shared/agent/harness/planDraft'
import Icon from '@renderer/components/Icon.vue'
import { useChatPort } from './chatPort'
import HarnessGuidePicker from './HarnessGuidePicker.vue'

const props = defineProps<{ room: string; run: HarnessRun }>()
const port = useChatPort().harness!
const d = reactive({ work: [] as string[], check: [] as string[], steps: [] as string[], criteria: [] as string[], remarks: '' })
/** The plan as the agent gave it (each new plan — the draft anew). */
const fromRun = () => ({ work: [...(props.run.guides?.work ?? [])], check: [...(props.run.guides?.check ?? [])], steps: props.run.steps.map((s) => s.title), criteria: props.run.criteria.map((c) => c.text), remarks: '' })
watch(
  () => props.run.steps,
  () => Object.assign(d, fromRun()),
  { immediate: true },
)
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const guidesChanged = computed(() => !same([...d.work].sort(), [...(props.run.guides?.work ?? [])].sort()) || !same([...d.check].sort(), [...(props.run.guides?.check ?? [])].sort()))
const planChanged = computed(() => !same(d.steps, props.run.steps.map((s) => s.title)) || !same(d.criteria, props.run.criteria.map((c) => c.text)))
const dirty = computed(() => guidesChanged.value || planChanged.value || !!d.remarks.trim())
/** The agent is to take something in (other instructions, remarks) before the work. */
const forAgent = computed(() => guidesChanged.value || !!d.remarks.trim())
const draftOf = (): PlanDraft => ({ steps: d.steps.map((s) => s.trim()).filter(Boolean), criteria: d.criteria.map((c) => c.trim()).filter(Boolean) })
/** The corrections «Начать» goes with (the panel's head). */
const edits = defineModel<PlanEdits>('edits', { default: () => ({ agent: false, remarks: '' }) })
watch(
  [forAgent, planChanged, guidesChanged, () => [...d.steps], () => [...d.criteria], () => [...d.work], () => [...d.check], () => d.remarks],
  () =>
    (edits.value = {
      agent: forAgent.value,
      remarks: d.remarks,
      ...(planChanged.value ? { draft: draftOf() } : {}),
      ...(guidesChanged.value ? { guides: { work: [...d.work], check: [...d.check] } } : {}),
    }),
  { immediate: true },
)
const field = 'tw:flex-1 tw:min-w-0 tw:h-24 tw:px-6 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:text-[12px]'
const icon = 'tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:text-text'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6">
    <HarnessGuidePicker v-model="d.work" label="Инструкции работы" :guides="port.guides()" />
    <HarnessGuidePicker v-model="d.check" label="Инструкции проверки" :guides="port.guides()" />
    <span class="tw:text-muted tw:text-[11px]">Шаги</span>
    <div v-for="(_, i) in d.steps" :key="`s${i}`" class="tw:flex tw:items-center tw:gap-6">
      <span class="tw:flex-none tw:w-16 tw:text-dim tw:text-[11px] tw:font-data">{{ i + 1 }}.</span>
      <input v-model="d.steps[i]" :class="field" />
      <button :class="icon" title="Убрать шаг" @click="d.steps.splice(i, 1)"><Icon name="x" :size="10" /></button>
    </div>
    <button class="tw:self-start tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:px-6 tw:text-[11.5px]" @click="d.steps.push('')"><Icon name="plus" :size="10" />шаг</button>
    <span class="tw:text-muted tw:text-[11px]">Критерии приёмки</span>
    <div v-for="(_, i) in d.criteria" :key="`c${i}`" class="tw:flex tw:items-center tw:gap-6">
      <span class="tw:flex-none tw:w-16 tw:text-dim tw:text-[11px]">•</span>
      <input v-model="d.criteria[i]" :class="field" />
      <button :class="icon" title="Убрать критерий" @click="d.criteria.splice(i, 1)"><Icon name="x" :size="10" /></button>
    </div>
    <button class="tw:self-start tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:px-6 tw:text-[11.5px]" @click="d.criteria.push('')"><Icon name="plus" :size="10" />критерий</button>
    <textarea v-model="d.remarks" rows="2" class="tw:min-h-44 tw:py-4 tw:px-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:text-[12px] tw:resize-y" placeholder="Замечания к плану (что учесть, что не делать)"></textarea>
    <div class="tw:flex tw:items-center tw:gap-6">
      <span v-if="dirty" class="tw:text-muted tw:text-[11.5px]">{{ forAgent ? '«Начать»: ИИ учтёт инструкции и замечания, ваши правки сохранятся — и сразу в работу' : '«Начать» примет план с вашими правками' }}</span>
      <button v-if="dirty" class="tw:h-24 tw:px-8 tw:text-[12px]" title="Отменить правки" @click="Object.assign(d, fromRun())">Отменить правки</button>
    </div>
  </div>
</template>
