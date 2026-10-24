<script setup lang="ts">
import { computed } from 'vue'
import { useFold } from '@renderer/lib/foldState'
import { isTsLang } from '@nb/domain/blockInfo'
import { prettyValue, summary } from '@nb/domain/values'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import RunHead from '../../ui/RunHead.vue'
import { useBlockRun } from '../../ui/useBlockRun'
import { useFenceSource } from '../../ui/useFenceSource'

/**
 * Code in a note (JS, or TS — the types are cut away): run apart from the app (stopped at once, its memory
 * capped). The note's context values are its variables; what it returns is published under its name.
 * «Общие функции» (lib): not run alone — put before every code block of the note.
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { info, body: code } = fence
const { key, run, start, stop, report, values } = useBlockRun(props, 'code', fence)
const ts = computed(() => isTsLang(info.value.lang))
const setLang = (lang: 'js' | 'ts') => fence.patchInfo({ lang })
const setLib = (lib: boolean) => fence.patchInfo({ lib, run: !lib })
const rename = (name: string | undefined) => fence.patchInfo({ name })
/** Runs the code as typed (written into the note first); shared functions (lib) never run alone. */
async function go(): Promise<void> {
  fence.flush()
  if (info.value.lib) return
  await start()
}
/** The names the code may use (the values where it stands). */
const vars = computed(() => Object.keys(values()))
// (folded or open — as it was left, back from another tab too)
const showValue = useFold(() => `${props.path}#${key.value}#result`, true)
</script>

<template>
  <div class="bc tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-code) tw:rounded-[8px] tw:bg-panel tw:[&&]:[&.lib]:border-l-border-3" :class="{ lib: info.lib }" @keydown.ctrl.enter="(e: KeyboardEvent) => !(e.target as Element).closest('.cm-editor') && (e.preventDefault(), go())">
    <RunHead :report="report" :send="info.lib ? undefined : 'code'" :icon="info.lib ? 'book' : 'code'" :kind="info.lib ? 'Общие функции' : 'Код'" :name="info.name" :run="info.lib ? undefined : run" :can-run="!info.lib" name-placeholder="результат" @rename="rename" @run="go" @stop="stop">
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: !ts }" @mousedown.prevent @click="setLang('js')">JS</button>
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: ts }" title="TypeScript: типы просто убираются перед выполнением" @mousedown.prevent @click="setLang('ts')">TS</button>
      </span>
      <label class="chk tw:inline-flex tw:items-center tw:gap-4 tw:text-muted tw:font-data tw:text-[11px]" title="Общие функции: не выполняются сами, подставляются перед каждым блоком кода заметки"><input type="checkbox" :checked="info.lib" @change="setLib(($event.target as HTMLInputElement).checked)" />lib</label>
    </RunHead>
    <div class="bc-ed"><CodeArea v-model="code" :lang="ts ? 'typescript' : 'js'" :run="go" :min-height="40" placeholder="return items.filter((x) => x.price > 100)" /></div>
    <p v-if="!info.lib && vars.length" class="bc-vars tw:m-0 tw:text-muted tw:text-[11.5px]">Доступно: <code class="tw:my-0 tw:mx-3 tw:text-accent-fg tw:font-data" v-for="v in vars" :key="v">{{ v }}</code><span class="muted tw:ml-6 tw:text-muted tw:text-[11.5px]">· set('имя', значение) — опубликовать ещё</span></p>
    <div v-if="run && !info.lib && run.state !== 'run'" class="bc-out tw:flex tw:flex-col tw:gap-2">
      <div v-for="(l, i) in run.logs ?? []" :key="i" class="lg tw:py-1 tw:px-8 tw:border-l-2 tw:border-l-border-2 tw:text-text-2 tw:font-data tw:text-[12px] tw:whitespace-pre-wrap tw:[word-break:break-word]" :class="l.level">{{ l.text }}</div>
      <p v-if="run.error" class="er tw:mt-4 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-down-fg tw:font-data tw:text-[12px] tw:whitespace-pre-wrap">{{ run.error }}</p>
      <template v-else-if="run.hasValue">
        <div class="vh tw:flex tw:items-center tw:gap-4 tw:mt-4 tw:text-[12px]">
          <button class="fold tw:inline-flex tw:w-22 tw:h-22 tw:items-center tw:justify-center tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @mousedown.prevent @click="showValue = !showValue"><Icon name="chevronRight" :size="12" :style="showValue ? 'transform: rotate(90deg)' : ''" /></button>
          <b>Результат</b><span class="muted tw:ml-6 tw:text-muted tw:text-[11.5px]">{{ summary(run.value) }}</span>
          <span v-if="info.name" class="muted tw:ml-6 tw:text-muted tw:text-[11.5px]">→ {{ '{' }}{{ '{' }}{{ info.name }}{{ '}' }}{{ '}' }}</span>
        </div>
        <div v-if="showValue" class="bc-val"><CodeArea :model-value="prettyValue(run.value)" :lang="typeof run.value === 'object' ? 'json' : 'text'" readonly :min-height="24" /></div>
      </template>
      <p v-else-if="!run.logs?.length" class="muted tw:ml-6 tw:text-muted tw:text-[11.5px]">Выполнено. Ничего не вернул — добавьте return, чтобы опубликовать результат.</p>
    </div>
  </div>
</template>

<style scoped src="./BlockCode.css"></style>
