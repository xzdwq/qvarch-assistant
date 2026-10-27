<script setup lang="ts">
const version = __APP_VERSION__
import { computed } from 'vue'
import { formatDuration } from '@shared/timeline'
import { workDay } from '@shared/work'
import { useDay } from '../lib/useDay'
import { todayKey } from '../lib/today'
import { useJira } from '../lib/jira'
import { useOutlook } from '../lib/outlook'
import { termLight, useTermSessions } from '../lib/terminal'
import { recItems, recState, startBrowser } from '../lib/browser'
import { useTransport } from '../lib/transport'

/** The window's bottom line (a terminal's status bar): the call, the connections, today's time, the clock. */
defineProps<{ section: string }>()
const emit = defineEmits<{ terminal: []; browser: [] }>()
startBrowser()
const terms = useTermSessions()
/** The server's version, by the app's (the last known; none — never connected). */
const transport = useTransport()
const { data, live, now } = useDay(todayKey)
const jira = useJira()
const outlook = useOutlook()
const today = computed(() => workDay(data.value).totals)
type Light = 'on' | 'off' | 'busy' | 'err'
const light = (s: { configured: boolean; connected: boolean; syncing: boolean; error?: string }): Light =>
  !s.configured ? 'off' : s.syncing ? 'busy' : s.error ? 'err' : s.connected ? 'on' : 'err'
const jl = computed(() => light(jira.value))
const ol = computed(() => light(outlook.value))
const TIP: Record<Light, string> = { on: 'подключено', off: 'не настроено', busy: 'синхронизация…', err: 'нет связи' }
const clock = computed(() => new Date(now.value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const date = computed(() => new Date(now.value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }))
</script>

<template>
  <footer class="sb tw:flex-none tw:flex tw:items-center tw:gap-12 tw:h-24 tw:py-0 tw:px-10 tw:border-t tw:border-t-border tw:bg-panel tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.05em] tw:whitespace-nowrap tw:overflow-hidden tw:select-none tw:@container">
    <span class="it tw:group/it tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:[&.live]:not-[&.call]:text-up-fg tw:[&.call]:text-down-fg" :class="live.inCall ? 'call' : 'live'" :title="live.inCall ? 'Идёт созвон — он попадёт в день сам' : 'Qvarch работает'">
      <i class="led tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-dim tw:group-[.live]/it:not-group-[.call]/it:bg-up tw:group-[.live]/it:not-group-[.call]/it:[box-shadow:0_0_6px_color-mix(in_srgb,var(--up)_60%,transparent)] tw:group-[.call]/it:bg-down tw:group-[.call]/it:[box-shadow:0_0_6px_color-mix(in_srgb,var(--down)_70%,transparent)] tw:group-[.call]/it:animate-[StatusBar-blink_1s_steps(2)_infinite]"></i>{{ live.inCall ? `CALL${live.callApp ? ` · ${live.callApp}` : ''}` : 'LIVE' }}
    </span>
    <span class="sep tw:flex-none tw:w-1 tw:h-12 tw:bg-border-2"></span>
    <span class="it tw:inline-flex tw:items-center tw:gap-6 tw:flex-none" :title="`Jira: ${TIP[jl]}${jira.error ? ` — ${jira.error}` : ''}`"><i class="led tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-dim tw:[&.on]:not-[&.busy]:not-[&.err]:bg-up tw:[&.on]:[box-shadow:0_0_6px_color-mix(in_srgb,var(--up)_60%,transparent)] tw:[&.busy]:not-[&.err]:bg-warn tw:[&.busy]:animate-[StatusBar-blink_1s_steps(2)_infinite] tw:[&.err]:bg-down" :class="jl"></i>JIRA</span>
    <span class="it tw:inline-flex tw:items-center tw:gap-6 tw:flex-none" :title="`Outlook: ${TIP[ol]}${outlook.error ? ` — ${outlook.error}` : ''}`"><i class="led tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-dim tw:[&.on]:not-[&.busy]:not-[&.err]:bg-up tw:[&.on]:[box-shadow:0_0_6px_color-mix(in_srgb,var(--up)_60%,transparent)] tw:[&.busy]:not-[&.err]:bg-warn tw:[&.busy]:animate-[StatusBar-blink_1s_steps(2)_infinite] tw:[&.err]:bg-down" :class="ol"></i>OUTLOOK</span>
    <button v-if="terms.length" class="it term tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:h-18 tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:text-inherit tw:[font:inherit] tw:tracking-[inherit] tw:cursor-default tw:hover:not-[&.err]:text-text tw:[&.err]:text-down-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :class="termLight.kind" :title="termLight.title" @click="emit('terminal')">
      <i class="led tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-dim tw:[&.on]:not-[&.busy]:not-[&.err]:bg-up tw:[&.on]:[box-shadow:0_0_6px_color-mix(in_srgb,var(--up)_60%,transparent)] tw:[&.busy]:not-[&.err]:bg-warn tw:[&.busy]:animate-[StatusBar-blink_1s_steps(2)_infinite] tw:[&.err]:bg-down" :class="termLight.kind" :style="termLight.color ? { background: termLight.color, boxShadow: `0 0 8px ${termLight.color}` } : undefined"></i>TERMINAL<template v-if="termLight.label"> · {{ termLight.label }}</template>
    </button>
    <button v-if="recState.on" class="it term rec tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:h-18 tw:py-0 tw:px-4 tw:border-0 tw:bg-transparent tw:[font:inherit] tw:tracking-[inherit] tw:cursor-default tw:text-down-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Браузер записывает запросы — открыть" @click="emit('browser')"><i class="led err blinkrec tw:animate-[StatusBar-blink_1s_steps(2)_infinite] tw:w-6 tw:h-6 tw:rounded-[50%] tw:bg-down"></i>REC · {{ recItems.length }}</button>
    <span class="sep tw:flex-none tw:w-1 tw:h-12 tw:bg-border-2"></span>
    <span class="it n tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums">СЕГОДНЯ <b class="tw:text-text tw:font-semibold">{{ formatDuration(today.all) }}</b></span>
    <span class="it n opt tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums tw:[&&]:@max-[760px]:hidden">ЗАДАЧИ <b class="tw:text-text tw:font-semibold">{{ formatDuration(today.tasks) }}</b></span>
    <span class="it n opt tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums tw:[&&]:@max-[760px]:hidden">ВСТРЕЧИ <b class="tw:text-text tw:font-semibold">{{ formatDuration(today.meetings) }}</b></span>
    <span class="grow tw:flex-1"></span>
    <span class="it sec tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:text-accent-fg tw:uppercase">{{ section }}</span>
    <span class="sep tw:flex-none tw:w-1 tw:h-12 tw:bg-border-2"></span>
    <span class="it n opt tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums tw:[&&]:@max-[760px]:hidden">{{ date }}</span>
    <span class="it n clk tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums tw:text-text">{{ clock }}</span>
    <span class="sep tw:flex-none tw:w-1 tw:h-12 tw:bg-border-2"></span>
    <span v-if="transport.server" class="it n opt tw:text-muted tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums tw:[&&]:@max-[760px]:hidden" :title="`Сервер ${transport.server}${transport.status === 'online' ? '' : ' (последняя известная версия — сейчас не подключено)'}`">SRV v{{ transport.server }}</span>
    <span class="it n ver tw:text-muted tw:inline-flex tw:items-center tw:gap-6 tw:flex-none tw:tabular-nums" :title="`Qvarch Assistant ${version}`">v{{ version }}</span>
  </footer>
</template>

<style scoped src="./StatusBar.css"></style>
