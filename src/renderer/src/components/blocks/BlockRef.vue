<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolvePath, summary } from '@shared/runbook'
import { envAt, fenceParts, fenceSrc, noteRun, pretty } from '../../lib/runbook'
import { doc } from '../../lib/notebook'
import CodeArea from '../CodeArea.vue'
import Icon from '../Icon.vue'

/**
 * A value of the note's context shown live (```json ref=login.body): it changes when its block runs again. In a loop —
 * the pass shown. (As a table — the notebook's table «Из переменной».)
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parts = computed(() => fenceParts(props.src))
const draft = ref(parts.value.info.ref ?? '')
watch(
  () => parts.value.info.ref,
  (r) => (draft.value = r ?? ''),
)
function commit(): void {
  const p = fenceParts(props.src)
  const ref = draft.value.trim() || undefined
  if (ref !== p.info.ref) props.onChange?.(fenceSrc(p.fence, { ...p.info, ref }, p.body))
}
const res = computed(() => {
  // (follows every value of the context: a block run again changes its time)
  const n = noteRun(props.path)
  for (const k in n.ctx) void n.ctx[k].at
  const lr = n.loops
  for (const k in lr) void lr[k].sel
  return parts.value.info.ref ? resolvePath(envAt(props.path, props.line, doc(props.path).text).values(), parts.value.info.ref) : { ok: false }
})
const from = computed(() => {
  const root = /^[A-Za-z_$][\w$]*/.exec(parts.value.info.ref ?? '')?.[0]
  const it = root ? noteRun(props.path).ctx[root] : undefined
  return it ? `${new Date(it.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''
})
</script>

<template>
  <div class="br">
    <div class="br-h">
      <span class="rk"><Icon name="eye" :size="13" />Значение</span>
      <label class="rn"><span>{{ '{' }}{{ '{' }}</span><input v-model="draft" spellcheck="false" placeholder="login.body" @blur="commit" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" /><span>{{ '}' }}{{ '}' }}</span></label>
      <span class="muted">{{ res.ok ? summary(res.value) : '' }}</span>
      <span class="grow"></span>
      <span v-if="from" class="muted">обновлено {{ from }}</span>
    </div>
    <div v-if="res.ok" class="br-v"><CodeArea :model-value="pretty(res.value)" :lang="typeof res.value === 'object' ? 'json' : 'text'" readonly :min-height="24" /></div>
    <p v-else class="muted none">Нет значения — выполните блок, который его публикует.</p>
  </div>
</template>

<style scoped>
.br {
  /* as wide as the note — long rows inside cut, never widen it */
  contain: inline-size;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #fbbf24;
  border-radius: 8px;
  background: var(--panel);
}
.br-h {
  display: flex;
  align-items: center;
  gap: 10px;
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
.rn input {
  width: 180px;
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
.muted {
  color: var(--muted);
  font-size: 11.5px;
}
.none {
  margin: 0;
}
.br-v :deep(.cm-editor) {
  max-height: 420px;
}
</style>
