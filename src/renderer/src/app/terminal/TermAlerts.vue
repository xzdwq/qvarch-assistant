<script setup lang="ts">
/** The reactions' notices over the panes (and why the reactions are paused): to the shell, close one or all. */
import Icon from '../../components/Icon.vue'
import { useTermView } from './termViewContext'

const { alerts, watchError, prefs, shells } = useTermView()
const { sideTab } = prefs
const { reveal } = shells
const hms = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dismiss = (id?: string) => void window.qa.termDismiss(id)
</script>

<template>
      <div v-if="alerts.length || watchError" class="alerts tw:flex-none tw:flex tw:flex-col tw:gap-4 tw:max-h-150 tw:overflow-y-auto tw:py-8 tw:px-10 tw:border-b tw:border-b-border tw:bg-panel">
        <div v-if="watchError" class="al werr tw:flex tw:items-center tw:gap-8 tw:h-26 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-0 tw:rounded-r2 tw:text-[12px] tw:whitespace-nowrap tw:[&&]:pl-8 tw:bg-down/12 tw:text-down-fg">
          <Icon name="bug" :size="13" />
          <span class="aline tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:font-data tw:text-[11.5px] tw:text-down-fg tw:whitespace-normal">{{ watchError }}</span>
          <button class="alink tw:flex-none tw:py-1 tw:px-6 tw:border tw:border-border-2 tw:rounded-r1 tw:bg-panel-2 tw:text-text tw:font-data tw:text-[11px] tw:hover:border-accent tw:hover:text-accent-fg tw:hover:enabled:bg-hover" @click="sideTab = 'watch'">Реакции</button>
        </div>
        <div v-for="a in alerts" :key="a.id" class="al tw:flex tw:items-center tw:gap-8 tw:h-26 tw:pt-0 tw:pr-4 tw:pb-0 tw:pl-0 tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c,var(--down))_12%,transparent)] tw:text-[12px] tw:whitespace-nowrap" :style="{ '--c': a.color }" :title="a.line">
          <i class="abar tw:flex-none tw:self-stretch tw:w-4 tw:rounded-[var(--r2)_0_0_var(--r2)] tw:[background:var(--c)] tw:animate-[TerminalView-tv-blink_0.36s_steps(2)_infinite]"></i>
          <span class="atime tw:flex-none tw:text-text-2 tw:font-data tw:tabular-nums">{{ hms(a.at) }}</span>
          <button class="aterm tw:flex-none tw:py-1 tw:px-6 tw:border tw:border-border-2 tw:rounded-r1 tw:bg-panel-2 tw:text-text tw:font-data tw:text-[11px] tw:hover:border-accent tw:hover:text-accent-fg tw:hover:enabled:bg-hover" title="Показать эту оболочку" @click="reveal(a.sid)">{{ a.title }}</button>
          <b class="aname tw:flex-none tw:text-(--c) tw:font-semibold">{{ a.name }}</b>
          <span v-if="a.count > 1" class="acount tw:flex-none tw:text-text-2 tw:font-data" :title="`Совпадений: ${a.count}, последнее в ${hms(a.last)}`">×{{ a.count }}</span>
          <span class="aline tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-2 tw:font-data tw:text-[11.5px]">{{ a.line }}</span>
          <button class="ax tw:flex-none tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Закрыть уведомление" @click="dismiss(a.id)"><Icon name="x" :size="12" /></button>
        </div>
        <button v-if="alerts.length > 1" class="aall tw:self-end tw:py-2 tw:px-8 tw:text-[11.5px]" @click="dismiss()">Закрыть все ({{ alerts.length }})</button>
      </div>
</template>
