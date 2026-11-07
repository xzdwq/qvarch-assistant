<script setup lang="ts">
/** The transfers of a session: each one's progress and speed, cancel; the ended ones cleared. */
import { computed } from 'vue'
import { sizeText, transferEnded, transferSpeed, type Transfer } from '@shared/ssh/transfers'
import Icon from '../../components/Icon.vue'
import { useSshTransfers } from '../../lib/ssh'

const props = defineProps<{ sessionId: string }>()
const all = useSshTransfers()
/** This session's, the going and waiting ones first, the newest ended after them. */
const list = computed(() => {
  const mine = all.value.filter((t) => t.sessionId === props.sessionId)
  return [...mine.filter((t) => !transferEnded(t)), ...mine.filter(transferEnded).reverse()]
})
const going = computed(() => list.value.filter((t) => !transferEnded(t)).length)
const cancel = (id?: string) => void window.qa.ssh('cancel', id)
const clearEnded = () => void window.qa.ssh('clearEnded')
const pct = (t: Transfer) => (t.size ? Math.min(100, Math.round((t.done / t.size) * 100)) : t.state === 'done' ? 100 : 0)
/** How each state is shown: its words and colour. */
const STATE: Record<Transfer['state'], { label: string; cls: string }> = {
  queued: { label: 'ждёт', cls: 'tw:text-muted' },
  running: { label: '', cls: 'tw:text-accent-fg' },
  done: { label: 'готово', cls: 'tw:text-up-fg' },
  failed: { label: 'ошибка', cls: 'tw:text-down-fg' },
  cancelled: { label: 'отменено', cls: 'tw:text-muted' },
}
</script>

<template>
  <div v-if="list.length" class="tw:flex-none tw:flex tw:flex-col tw:max-h-[40%] tw:border-t tw:border-t-border">
    <div class="tw:flex tw:items-center tw:gap-6 tw:h-26 tw:px-8 tw:text-text-2 tw:text-[11.5px]">
      <span class="tw:flex-1 tw:truncate">Передачи{{ going ? ` · идёт ${going}` : '' }}</span>
      <button v-if="going" class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg" title="Отменить все" @click="cancel()"><Icon name="stop" :size="11" /></button>
      <button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi" title="Убрать завершённые" @click="clearEnded"><Icon name="trash" :size="11" /></button>
    </div>
    <div class="tw:min-h-0 tw:overflow-y-auto">
      <div v-for="t in list" :key="t.id" class="tw:group/tr tw:flex tw:flex-col tw:gap-2 tw:py-3 tw:px-8 tw:text-[11.5px]" :title="t.error ?? `${t.from} → ${t.to}`">
        <div class="tw:flex tw:items-center tw:gap-6 tw:min-w-0">
          <Icon :name="t.dir === 'up' ? 'upload' : 'download'" :size="11" class="tw:flex-none tw:text-muted" />
          <span class="tw:flex-1 tw:min-w-0 tw:truncate tw:text-text">{{ t.name }}</span>
          <span class="tw:flex-none tw:font-data" :class="STATE[t.state].cls">
            {{ t.state === 'running' ? `${pct(t)}% · ${sizeText(transferSpeed(t))}/с` : STATE[t.state].label }}
          </span>
          <button v-if="!transferEnded(t)" class="tw:flex-none tw:hidden tw:group-hover/tr:inline-flex tw:p-2 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg" title="Отменить" @click="cancel(t.id)"><Icon name="x" :size="10" /></button>
        </div>
        <div v-if="t.state === 'running'" class="tw:h-3 tw:rounded-full tw:bg-border tw:overflow-hidden"><div class="tw:h-full tw:bg-accent" :style="{ width: `${pct(t)}%` }"></div></div>
        <div v-if="t.error" class="tw:truncate tw:text-down-fg">{{ t.error }}</div>
      </div>
    </div>
  </div>
</template>
