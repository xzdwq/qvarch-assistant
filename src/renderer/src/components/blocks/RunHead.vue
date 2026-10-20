<script setup lang="ts">
import { ref, watch } from 'vue'
import { isName } from '@shared/runbook'
import type { BlockRun } from '../../lib/runbook'
import Icon from '../Icon.vue'

/**
 * The head of a runnable block: what it is, its name (what it publishes into the note's context — {{name}}),
 * ▶ / ■, and how its last run went.
 */
const props = withDefaults(defineProps<{ icon: string; kind: string; name?: string; run?: BlockRun; canRun?: boolean; namePlaceholder?: string; report?: () => string }>(), { canRun: true })
const emit = defineEmits<{ rename: [name: string | undefined]; run: []; stop: [] }>()
const draft = ref(props.name ?? '')
watch(
  () => props.name,
  (n) => (draft.value = n ?? ''),
)
const bad = ref(false)
function commit(): void {
  const v = draft.value.trim()
  if (v && !isName(v)) {
    bad.value = true
    return
  }
  bad.value = false
  if ((v || undefined) !== props.name) emit('rename', v || undefined)
}
const copied = ref(false)
async function copyReport(): Promise<void> {
  if (!props.report) return
  await navigator.clipboard.writeText(props.report())
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? 'только что' : s < 3600 ? `${Math.round(s / 60)} мин назад` : new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const msText = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)
</script>

<template>
  <div class="rh">
    <span class="rk"><Icon :name="icon" :size="13" />{{ kind }}</span>
    <label class="rn" :class="{ bad }" :title="bad ? 'Имя — латиница, цифры, _ ; не с цифры' : 'Имя: под ним результат доступен другим блокам и тексту — {{ имя }}'">
      <span>{{ '{' }}{{ '{' }}</span><input v-model="draft" spellcheck="false" :placeholder="namePlaceholder ?? 'имя'" @blur="commit" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" /><span>{{ '}' }}{{ '}' }}</span>
    </label>
    <slot />
    <span class="grow"></span>
    <span v-if="run?.state === 'run'" class="rs run"><i></i>выполняется…</span>
    <span v-else-if="run?.state === 'ok'" class="rs ok" :title="new Date(run.at).toLocaleString('ru-RU')"><Icon name="check" :size="12" />{{ msText(run.ms) }} · {{ ago(run.at) }}</span>
    <span v-else-if="run?.state === 'error'" class="rs err" :title="run.error">ошибка · {{ ago(run.at) }}</span>
    <button v-if="report && run && run.state !== 'run'" class="rc" :class="{ ok: copied }" title="Скопировать отчёт: что проверено, шаги, результат, ошибка — готовым текстом (в чат, Jira, письмо)" @mousedown.prevent @click="copyReport"><Icon :name="copied ? 'check' : 'clipboard'" :size="12" /></button>
    <button v-if="run?.state === 'run'" class="rb stop" title="Остановить" @mousedown.prevent @click="emit('stop')"><Icon name="stop" :size="11" />Стоп</button>
    <button v-else-if="canRun !== false" class="rb" title="Выполнить (Ctrl+Enter)" @mousedown.prevent @click="emit('run')"><Icon name="play" :size="11" />Выполнить</button>
  </div>
</template>

<style scoped>
.rh {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
}
.rk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.rn {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--dim);
  font-family: var(--font-data);
}
.rn.bad {
  border-color: var(--down);
}
.rn input {
  width: 110px;
  height: 22px;
  padding: 0 3px;
  border: 0;
  background: transparent;
  color: var(--accent-fg);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.grow {
  flex: 1;
}
.rs {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rs.ok {
  color: var(--up-fg);
}
.rs.err {
  color: var(--down-fg);
}
.rs.run {
  color: var(--accent-fg);
}
.rs.run i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 0.9s infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
.rb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent, #fff);
  font-size: 12px;
}
.rb.stop {
  background: #ef4444;
  color: #fff;
}
.rc {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}
.rc:hover {
  color: var(--text);
}
.rc.ok {
  border-color: #4ade80;
  color: #4ade80;
}
</style>
