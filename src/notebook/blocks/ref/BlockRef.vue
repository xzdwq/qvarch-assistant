<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { prettyValue, resolvePath, summary } from '@nb/domain/values'
import { joinFence, splitFence } from '@nb/domain/fence'
import { envAtLine, noteRun } from '@nb/engine'
import { doc } from '@renderer/lib/notebook'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'

/**
 * A value of the note's context shown live (```json ref=login.body): it changes when its block runs again. In a loop —
 * the pass shown. (As a table — the notebook's table «Из переменной».)
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parts = computed(() => splitFence(props.src))
const draft = ref(parts.value.info.ref ?? '')
watch(
  () => parts.value.info.ref,
  (r) => (draft.value = r ?? ''),
)
/** The path typed written into the block's info line (ref=…). */
function commit(): void {
  const p = splitFence(props.src)
  const ref = draft.value.trim() || undefined
  if (ref !== p.info.ref) props.onChange?.(joinFence(p.fence, { ...p.info, ref }, p.body))
}
/** The value now (the env's values are read through Vue: it follows them and the pass picked). */
const res = computed(() => (parts.value.info.ref ? resolvePath(envAtLine(props.path, props.line, doc(props.path).text).values(), parts.value.info.ref) : { ok: false }))
const from = computed(() => {
  const root = /^[A-Za-z_$][\w$]*/.exec(parts.value.info.ref ?? '')?.[0]
  const it = root ? noteRun(props.path).ctx[root] : undefined
  return it ? `${new Date(it.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''
})
</script>

<template>
  <div class="br tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-ref) tw:rounded-[8px] tw:bg-panel">
    <div class="br-h tw:flex tw:items-center tw:gap-10 tw:text-[12px] tw:whitespace-nowrap">
      <span class="rk tw:inline-flex tw:items-center tw:gap-6 tw:text-muted"><Icon name="eye" :size="13" />Значение</span>
      <label class="rn tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-dim tw:font-data"><span>{{ '{' }}{{ '{' }}</span><input class="tw:w-180 tw:h-22 tw:py-0 tw:px-3 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:outline-none" v-model="draft" spellcheck="false" placeholder="login.body" @blur="commit" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" /><span>{{ '}' }}{{ '}' }}</span></label>
      <span class="muted tw:text-muted tw:text-[11.5px]">{{ res.ok ? summary(res.value) : '' }}</span>
      <span class="grow tw:flex-1"></span>
      <span v-if="from" class="muted tw:text-muted tw:text-[11.5px]">обновлено {{ from }}</span>
    </div>
    <div v-if="res.ok" class="br-v"><CodeArea :model-value="prettyValue(res.value)" :lang="typeof res.value === 'object' ? 'json' : 'text'" readonly :min-height="24" /></div>
    <p v-else class="muted none tw:text-muted tw:text-[11.5px] tw:m-0">Нет значения — выполните блок, который его публикует.</p>
  </div>
</template>

<style scoped src="./BlockRef.css"></style>
