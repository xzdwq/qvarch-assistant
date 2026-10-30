<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isName } from '@nb/domain/blockInfo'
import type { BlockRun } from '@nb/engine'
import { sendsUnrun, type ShotKind } from '@nb/engine/chatAttach'
import Icon from '@renderer/components/Icon.vue'
import SendToChat from './SendToChat.vue'
import VarNameField from './VarNameField.vue'

/**
 * The head of a runnable block: what it is, its name (what it publishes into the note's context — {{name}}),
 * ▶ / ■, and how its last run went.
 */
/** `send` — the kind it goes into a chat as («В чат»; none — not sent); `src` — the block's text (a kind sent as written). */
/** `named` — the block publishes its result under a name (one that publishes nothing — no name field). */
const props = withDefaults(defineProps<{ icon: string; kind: string; name?: string; run?: BlockRun; canRun?: boolean; namePlaceholder?: string; report?: () => string; send?: ShotKind; src?: string; named?: boolean }>(), { canRun: true, src: '', named: true })
/** «В чат» shown: a result to send (a run done), or a kind that goes as written. */
const sendable = computed(() => !!props.send && (sendsUnrun(props.send) || (!!props.run && props.run.state !== 'run')))
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
  <div class="rh tw:flex tw:items-center tw:gap-10 tw:min-w-0 tw:text-[12px] tw:whitespace-nowrap">
    <span class="rk tw:inline-flex tw:items-center tw:gap-6 tw:text-muted"><Icon :name="icon" :size="13" />{{ kind }}</span>
    <VarNameField v-if="named" v-model="draft" :bad="bad" :placeholder="namePlaceholder" :title="bad ? 'Имя — латиница, цифры, _ ; не с цифры' : 'Имя: под ним результат доступен другим блокам и тексту — {{ имя }}'" @commit="commit" @cancel="((draft = name ?? ''), (bad = false))" />
    <slot />
    <span class="grow tw:flex-1"></span>
    <span v-if="run?.state === 'run'" class="rs run tw:inline-flex tw:items-center tw:gap-5 tw:overflow-hidden tw:text-ellipsis tw:text-accent-fg"><i class="tw:w-8 tw:h-8 tw:rounded-[50%] tw:bg-accent tw:animate-[RunHead-pulse_0.9s_infinite]"></i>выполняется…</span>
    <span v-else-if="run?.state === 'ok'" class="rs ok tw:inline-flex tw:items-center tw:gap-5 tw:overflow-hidden tw:text-ellipsis tw:text-up-fg" :title="new Date(run.at).toLocaleString('ru-RU')"><Icon name="check" :size="12" />{{ msText(run.ms) }} · {{ ago(run.at) }}<template v-if="run.by"> · {{ run.by }}</template></span>
    <span v-else-if="run?.state === 'error'" class="rs err tw:inline-flex tw:items-center tw:gap-5 tw:overflow-hidden tw:text-ellipsis tw:text-down-fg" :title="run.error">ошибка · {{ ago(run.at) }}<template v-if="run.by"> · {{ run.by }}</template></span>
    <button v-if="report && run && run.state !== 'run'" class="rc tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:hover:not-[&.ok]:text-text tw:[&.ok]:border-(--run-copied) tw:[&.ok]:text-(--run-copied) tw:hover:enabled:bg-hover tw:hover:enabled:not-[&.ok]:border-border-3" :class="{ ok: copied }" title="Скопировать отчёт: что проверено, шаги, результат, ошибка — готовым текстом (в чат, Jira, письмо)" @mousedown.prevent @click="copyReport"><Icon :name="copied ? 'check' : 'clipboard'" :size="12" /></button>
    <SendToChat v-if="send && sendable" :kind="send" :run="run" :src="src" :title="name ? `${kind} · ${name}` : kind" />
    <button v-if="run?.state === 'run'" class="rb stop tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-[6px] tw:text-[12px] tw:bg-stop tw:text-white tw:hover:enabled:border-border-3" title="Остановить" @mousedown.prevent @click="emit('stop')"><Icon name="stop" :size="11" />Стоп</button>
    <button v-else-if="canRun !== false" class="rb tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-[6px] tw:bg-accent tw:text-on-accent tw:text-[12px] tw:hover:enabled:bg-accent-hi" title="Выполнить (Ctrl+Enter)" @mousedown.prevent @click="emit('run')"><Icon name="play" :size="11" />Выполнить</button>
  </div>
</template>
