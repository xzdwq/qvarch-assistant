<script setup lang="ts">
import { computed } from 'vue'
import { formatDuration } from '@shared/timeline'
import { workDay } from '@shared/work'
import { useDay } from '../lib/useDay'
import { todayKey } from '../lib/today'
import { useJira } from '../lib/jira'
import { useOutlook } from '../lib/outlook'
import { termLight, useTermSessions } from '../lib/terminal'

/** The window's bottom line (a terminal's status bar): the call, the connections, today's time, the clock. */
defineProps<{ section: string }>()
const emit = defineEmits<{ terminal: [] }>()
const terms = useTermSessions()
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
  <footer class="sb">
    <span class="it" :class="live.inCall ? 'call' : 'live'" :title="live.inCall ? 'Идёт созвон — он попадёт в день сам' : 'Qvarch работает'">
      <i class="led"></i>{{ live.inCall ? `CALL${live.callApp ? ` · ${live.callApp}` : ''}` : 'LIVE' }}
    </span>
    <span class="sep"></span>
    <span class="it" :title="`Jira: ${TIP[jl]}${jira.error ? ` — ${jira.error}` : ''}`"><i class="led" :class="jl"></i>JIRA</span>
    <span class="it" :title="`Outlook: ${TIP[ol]}${outlook.error ? ` — ${outlook.error}` : ''}`"><i class="led" :class="ol"></i>OUTLOOK</span>
    <button v-if="terms.length" class="it term" :class="termLight.kind" :title="termLight.title" @click="emit('terminal')">
      <i class="led" :class="termLight.kind" :style="termLight.color ? { background: termLight.color, boxShadow: `0 0 8px ${termLight.color}` } : undefined"></i>TERMINAL<template v-if="termLight.label"> · {{ termLight.label }}</template>
    </button>
    <span class="sep"></span>
    <span class="it n">СЕГОДНЯ <b>{{ formatDuration(today.all) }}</b></span>
    <span class="it n opt">ЗАДАЧИ <b>{{ formatDuration(today.tasks) }}</b></span>
    <span class="it n opt">ВСТРЕЧИ <b>{{ formatDuration(today.meetings) }}</b></span>
    <span class="grow"></span>
    <span class="it sec">{{ section }}</span>
    <span class="sep"></span>
    <span class="it n opt">{{ date }}</span>
    <span class="it n clk">{{ clock }}</span>
  </footer>
</template>

<style scoped>
.sb {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 24px;
  padding: 0 10px;
  border-top: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  user-select: none;
  container-type: inline-size;
}
.it {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.n {
  font-variant-numeric: tabular-nums;
}
.it b {
  color: var(--text);
  font-weight: 600;
}
.term {
  height: 18px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  cursor: default;
}
.term:hover {
  color: var(--text);
}
.term.alert {
  color: var(--text-hi);
}
.term.err {
  color: var(--down-fg);
}
.led.run {
  background: var(--up);
  box-shadow: 0 0 6px rgba(0, 230, 118, 0.6);
}
.led.alert {
  animation: blink-fast 0.36s steps(2) infinite;
}
.sep {
  flex: none;
  width: 1px;
  height: 12px;
  background: var(--border-2);
}
.grow {
  flex: 1;
}
.led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dim);
}
.led.on,
.live .led {
  background: var(--up);
  box-shadow: 0 0 6px rgba(0, 230, 118, 0.6);
}
.led.busy {
  background: var(--warn);
  animation: blink 1s steps(2) infinite;
}
.led.err {
  background: var(--down);
}
.live {
  color: var(--up-fg);
}
.call {
  color: var(--down-fg);
}
.call .led {
  background: var(--down);
  box-shadow: 0 0 6px rgba(255, 61, 61, 0.7);
  animation: blink 1s steps(2) infinite;
}
.sec {
  color: var(--accent-fg);
  text-transform: uppercase;
}
.clk {
  color: var(--text);
}
@keyframes blink-fast {
  50% {
    opacity: 0.15;
  }
}
@keyframes blink {
  50% {
    opacity: 0.35;
  }
}
@container (max-width: 760px) {
  .opt {
    display: none;
  }
}
</style>
