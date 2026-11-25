<script setup lang="ts">
/**
 * A journal step opened: each of its parts whole, marked which way it went — into the AI (what the model was given:
 * the instructions, the context, the question, what each tool gave back) or out of it (its words, a tool's
 * arguments). The whole texts come from the turn's own record on the computer that ran it; elsewhere — the
 * journal's cut texts, said so.
 */
import { computed, ref } from 'vue'
import type { TrajFlow, TrajStep } from '@shared/agent/trajectory'
import { stepParts, type TurnLog } from '@shared/agent/turnLog'
import Icon from '@renderer/components/Icon.vue'

const props = defineProps<{
  step: TrajStep
  /** The same step from the record (none — not on this computer). */
  full?: TrajStep
  /** The turn's record: undefined — loading, null — not on this computer. */
  log: TurnLog | null | undefined
  /** Whose AI ran the turn. */
  owner: string
}>()

const FLOW: Record<TrajFlow, { word: string; icon: string; cls: string; title: string }> = {
  toAi: { word: 'Ушло в ИИ', icon: 'send', cls: 'tw:text-warn-fg tw:border-warn/45', title: 'Этот текст был отправлен модели' },
  fromAi: { word: 'От ИИ', icon: 'sparkles', cls: 'tw:text-accent-fg tw:border-accent/45', title: 'Это написала модель' },
  app: { word: 'Приложение', icon: 'info', cls: 'tw:text-muted tw:border-border', title: 'Сообщение приложения' },
}

const view = computed(() => stepParts(props.step, props.full, props.log ?? undefined))
const copied = ref(-1)
async function copy(i: number, text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  copied.value = i
  setTimeout(() => copied.value === i && (copied.value = -1), 1200)
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6 tw:py-6 tw:pl-98 tw:pr-6 tw:border-b tw:border-white/4 tw:bg-white/3 tw:cursor-auto">
    <div v-for="(p, i) in view.parts" :key="i" class="tw:flex tw:flex-col tw:min-w-0 tw:border-l-2 tw:pl-8" :class="FLOW[p.flow].cls">
      <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:text-[11px] tw:whitespace-nowrap">
        <Icon :name="FLOW[p.flow].icon" :size="11" />
        <b :title="FLOW[p.flow].title">{{ FLOW[p.flow].word }}</b>
        <span class="tw:min-w-0 tw:truncate tw:text-muted">· {{ p.what }} · {{ p.text.length }} симв.</span>
        <span class="tw:flex-1"></span>
        <button type="button" class="tw:inline-flex tw:items-center tw:h-18 tw:px-4 tw:rounded-r1 tw:text-muted tw:hover:text-text tw:hover:bg-white/6" :title="copied === i ? 'Скопировано' : 'Копировать'" @click="copy(i, p.text)">
          <Icon :name="copied === i ? 'check' : 'copy'" :size="11" />
        </button>
      </div>
      <pre class="tw:m-0 tw:mt-3 tw:max-h-[420px] tw:overflow-auto tw:whitespace-pre-wrap tw:break-words tw:font-data tw:text-[11.5px] tw:leading-[1.45] tw:text-text-2 tw:select-text">{{ p.text }}</pre>
    </div>
    <p v-if="log === undefined" class="tw:m-0 tw:text-[11px] tw:text-muted">Загрузка полного текста…</p>
    <p v-else-if="!view.whole" class="tw:m-0 tw:text-[11px] tw:text-muted">
      Показано начало: полный текст хода хранится только на компьютере владельца ИИ ({{ owner }}) — и только для ходов, сделанных в этой версии приложения и позже.
    </p>
  </div>
</template>
