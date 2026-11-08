<script setup lang="ts">
/**
 * The journal of runs: who ran which block of the note — the person by hand, an AI agent (its name), a harness check,
 * a schedule — when, how long, how it ended, whether it waited for a person's input. The latest on top; a block's
 * name clicked — the note shown at it.
 */
import { computed } from 'vue'
import type { DocRun, RunWhoKind } from '@shared/agent/docRuns'
import Icon from '@renderer/components/Icon.vue'
import { openNoteAt } from '@nb/workspace/noteGoto'

const props = defineProps<{ runs: readonly DocRun[]; path: string }>()

/** Each kind of who: its icon and colour, what it means in full. */
const WHO: Record<RunWhoKind, { icon: string; color: string; hint: string }> = {
  person: { icon: 'users', color: 'var(--text-2)', hint: 'Запущено человеком вручную' },
  ai: { icon: 'sparkles', color: 'var(--ai-line)', hint: 'Запустил ИИ (инструмент note_run)' },
  harness: { icon: 'checkSquare', color: 'var(--accent-fg)', hint: 'Проверка критерия harness — блок запустило приложение' },
  cron: { icon: 'clock', color: 'var(--warn-fg)', hint: 'Запуск по расписанию' },
}
const latestFirst = computed(() => [...props.runs].reverse())
const when = (at: number) => new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const took = (ms: number) => (ms < 1000 ? `${ms} мс` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`)
const show = (r: DocRun) => void openNoteAt(props.path, { line: r.line - 1, col: 0, len: 0 })
</script>

<template>
  <div class="tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-2">
    <p v-if="!runs.length" class="tw:m-0 tw:text-muted tw:text-[12px]">Запусков пока нет. Здесь появится, кто и какой блок запускал: вы, ИИ, проверки harness, расписание.</p>
    <div v-for="r in latestFirst" :key="r.id" class="tw:flex tw:flex-col tw:gap-2 tw:py-5 tw:px-8 tw:rounded-[8px] tw:hover:bg-white/4">
      <div class="tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:whitespace-nowrap tw:text-[12px]">
        <Icon :name="r.outcome === 'ok' ? 'check' : 'x'" :size="12" class="tw:flex-none" :class="r.outcome === 'ok' ? 'tw:text-up-fg' : 'tw:text-down-fg'" />
        <span class="tw:flex-none tw:font-data tw:text-muted tw:text-[11.5px]">{{ when(r.at) }}</span>
        <button class="tw:min-w-0 tw:truncate tw:p-0 tw:border-0 tw:bg-transparent tw:text-text tw:font-semibold tw:hover:text-accent-fg tw:hover:underline" :title="`${r.block} — строка ${r.line}: показать в заметке`" @click="show(r)">{{ r.block }}</button>
        <span class="tw:flex-none tw:text-muted tw:text-[11px]">стр. {{ r.line }}</span>
        <span class="tw:flex-1"></span>
        <span v-if="r.waited" class="tw:flex-none tw:text-accent-fg tw:text-[11px]" title="По ходу выполнения блок ждал ввода человека (например, пароль sudo)">ждал ввода</span>
        <span v-if="r.all" class="tw:flex-none tw:text-muted tw:text-[11px]" title="В составе «Выполнить всё»">в «Выполнить всё»</span>
        <span class="tw:flex-none tw:inline-flex tw:items-center tw:gap-4 tw:max-w-[40%] tw:text-[11.5px]" :style="{ color: WHO[r.who.kind].color }" :title="WHO[r.who.kind].hint"><Icon :name="WHO[r.who.kind].icon" :size="12" class="tw:flex-none" /><span class="tw:truncate">{{ r.who.name }}</span></span>
        <span class="tw:flex-none tw:font-data tw:text-muted tw:text-[11px]">{{ took(r.ms) }}</span>
      </div>
      <span v-if="r.error" class="tw:pl-20 tw:text-down-fg tw:text-[11.5px] tw:wrap-anywhere tw:line-clamp-2" :title="r.error">{{ r.error }}</span>
    </div>
  </div>
</template>
