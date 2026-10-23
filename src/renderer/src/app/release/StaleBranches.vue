<script setup lang="ts">
import { formatDateTime, shortSha } from '@shared/releaseView'
import { colors, rs, send } from '../../lib/releaseStore'
import { openLink, setSelected } from './releaseActions'

/** Forgotten branches: the search window (in releases) and the branches found, each can be added to the release. */
const colorFor = colors.colorFor
function setLookback(v: string): void {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n) || n < 1) return
  rs.lookback = n
  send({ command: 'setStaleBranchesLookback', value: n })
}
</script>

<template>
  <div class="stale tw:mt-8 tw:text-[11.5px]">
    <div class="mut stc tw:text-muted tw:text-[12px] tw:mb-4">
      Окно поиска — последние <input class="tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-(--rad-sm) tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:w-[3.4em] tw:h-22" type="number" min="1" :value="rs.lookback" @change="setLookback(($event.target as HTMLInputElement).value)" /> релиз(ов)<template v-if="rs.patternCount !== null"> из {{ rs.patternCount }}</template>. Изменение применится при следующем построении хронологии.
    </div>
    <div v-if="rs.staleLoading" class="mut tw:text-muted tw:text-[12px]"><span class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>Проверяем, нет ли забытых или не выбранных в релиз веток…</div>
    <div v-else-if="!rs.staleHints?.length" class="mut tw:text-muted tw:text-[12px]">Забытых или давно не выбранных в релиз веток не нашлось.</div>
    <template v-else>
      <div class="mut sti tw:text-muted tw:text-[12px] tw:my-4 tw:mx-0">Отсоединились раньше самого свежего коммита среди уже выбранных веток в этой хронологии, либо не выбраны в релиз в пределах окна последних релизов, и ещё не выпущены — возможно, забыли:</div>
      <div v-for="h in rs.staleHints" :key="h.ref" class="str tw:py-3 tw:px-0 tw:border-b tw:[border-bottom-style:dashed] tw:border-b-border">
        → <span class="chip tw:inline-flex tw:items-center tw:mt-2 tw:mr-4 tw:mb-2 tw:ml-0 tw:py-2 tw:px-8 tw:rounded-(--rad-sm) tw:text-black tw:text-[11px]" :style="{ background: colorFor(h.branch) }">{{ h.branch }}</span>
        <button class="add tw:inline-flex tw:items-center tw:justify-center tw:w-16 tw:h-16 tw:my-0 tw:mx-2 tw:p-0 tw:border-0 tw:rounded-[50%] tw:[background:var(--c-green)] tw:text-black tw:text-[12px] tw:font-bold tw:leading-[16px] tw:cursor-pointer tw:hover:filter-[brightness(1.15)] tw:[&.added]:not-disabled:bg-transparent tw:disabled:bg-transparent tw:[&.added]:not-disabled:text-(--c-green) tw:disabled:text-(--c-green) tw:[&.added]:not-disabled:cursor-default tw:disabled:cursor-default tw:[&.added]:not-disabled:opacity-80 tw:disabled:opacity-80" :class="{ added: rs.selected.has(h.ref) }" :disabled="rs.selected.has(h.ref)" title="Добавить в релиз" @click="setSelected(h.ref, true)">{{ rs.selected.has(h.ref) ? '✓' : '+' }}</button>
        — «{{ h.subject }}», <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(h.commitUrl)">{{ shortSha(h.sha) }}</a> · {{ h.authorName }} · {{ formatDateTime(h.authorDate) }}<template v-if="h.taskUrl"> · <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(h.taskUrl)">задача</a></template>
      </div>
    </template>
  </div>
</template>
