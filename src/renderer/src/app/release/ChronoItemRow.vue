<script setup lang="ts">
import type { PlanItem } from '@shared/release'
import { compactCount, conflictAnalysisPending, conflictBlockers, formatDateTime, overlapBranchNames, shortSha, uniqueConflictCauses } from '@shared/releaseView'
import { colors, rs } from '../../lib/releaseStore'
import ConflictFileBlock from './ConflictFileBlock.vue'
import { planItems, shaToBranch } from './planView'
import { openLink, setSelected, toggleItem } from './releaseActions'

/** A plan item of the chronology: its box and lane, the commit with its badges, a conflict's explanation and hints, date, author. */
defineProps<{ item: PlanItem }>()
const colorFor = colors.colorFor
</script>

<template>
  <div class="trow tw:grid tw:grid-cols-[var(--rail,18px)_152px_minmax(160px,1fr)_144px_124px] tw:items-stretch tw:border-b tw:[border-bottom-style:dashed] tw:border-b-border tw:last:border-b-0 tw:[&&]:max-[860px]:grid-cols-[var(--rail,18px)_120px_minmax(160px,1fr)_120px]">
    <span class="tw:max-[860px]:nth-5:hidden"></span>
    <div class="cell cbr tw:min-w-0 tw:py-3 tw:px-8 tw:flex tw:items-start tw:gap-6 tw:max-[860px]:nth-5:hidden">
      <input class="tw:m-0 tw:[accent-color:var(--accent)] tw:[&&]:mt-3" type="checkbox" :checked="item.included" :disabled="item.applied" @change="toggleItem(item, ($event.target as HTMLInputElement).checked)" />
      <span class="lane tw:flex-[1_1_auto] tw:min-w-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-black tw:text-[11px] tw:text-center tw:wrap-break-word tw:[word-break:break-word]" :style="{ background: colorFor(item.branch) }">{{ item.branch }}</span>
    </div>
    <div class="cell ccm tw:min-w-0 tw:py-3 tw:px-8 tw:max-[860px]:nth-5:hidden">
      <div>{{ item.subject }}</div>
      <span class="sha tw:font-data tw:text-[11px] tw:opacity-85">{{ shortSha(item.sha) }}</span>
      <div class="links">
        <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="item.taskUrl" @click="openLink(item.taskUrl)">Задача</a>
        <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="item.prUrl" @click="openLink(item.prUrl)">PR #{{ item.prNumber }}</a>
        <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="item.commitUrl" @click="openLink(item.commitUrl)">коммит</a>
      </div>
      <div>
        <span v-if="item.applied" class="badge applied tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-blue)] tw:text-text-hi">применён</span>
        <span v-if="item.dryRunStatus === 'ok'" class="badge ok tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-green)] tw:text-black">конфликтов нет</span>
        <span v-else-if="item.dryRunStatus === 'empty'" class="badge inmain tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-purple)] tw:text-black">уже применено (пустой cherry-pick)</span>
        <span v-else-if="item.dryRunStatus === 'conflict'" class="badge conflict tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-red)] tw:text-text-hi">⚠ конфликт ({{ item.dryRunConflictFiles.length }} файл(ов))</span>
        <span v-else-if="item.dryRunStatus === 'conditional'" class="badge cond tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-yellow)] tw:text-black">? возможен конфликт ({{ item.dryRunConflictFiles.length }} файл(ов))</span>
        <span v-if="item.overlapsWith?.length" class="badge overlap tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-orange)] tw:text-black">пересекается с: {{ overlapBranchNames(item, shaToBranch) }}</span>
        <span v-if="item.alreadyInMain" class="badge inmain tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-purple)] tw:text-black">уже в {{ rs.mainBranch }}</span>
      </div>
      <!-- a real conflict -->
      <template v-if="item.dryRunStatus === 'conflict'">
        <div v-if="!item.dryRunConflictSources?.length" class="cdet mut tw:text-muted tw:text-[12px] tw:mt-4 tw:pl-8 tw:border-l-2 tw:border-l-(--c-red)">Файлы: {{ item.dryRunConflictFiles.join(', ') }}</div>
        <div v-else class="cdet tw:mt-4 tw:pl-8 tw:border-l-2 tw:border-l-(--c-red)">
          <ConflictFileBlock v-for="s in item.dryRunConflictSources" :key="s.file" :item="item" :s="s" />
        </div>
        <template v-if="!conflictAnalysisPending(item)">
          <div v-if="item.alreadyInMain" class="hint tw:py-3 tw:px-0 tw:text-[11px]">Похоже, эта задача уже выпущена в {{ rs.mainBranch }} — возможно, проще исключить её из релиза, а не разрешать конфликт.</div>
          <template v-else-if="uniqueConflictCauses(item).length">
            <div class="hint tw:py-3 tw:px-0 tw:text-[11px]">Возможно, дело не в противоречащих правках, а в забытой задаче — эти ветки тоже меняют конфликтующий файл и ещё не выпущены:</div>
            <div v-for="c in uniqueConflictCauses(item)" :key="c.branch" class="cause tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-8 tw:text-[11px]">
              → <b>{{ c.branch }}</b>
              <button class="add tw:inline-flex tw:items-center tw:justify-center tw:w-16 tw:h-16 tw:my-0 tw:mx-2 tw:p-0 tw:border-0 tw:rounded-[50%] tw:[background:var(--c-green)] tw:text-black tw:text-[12px] tw:font-bold tw:leading-[16px] tw:cursor-pointer tw:hover:filter-[brightness(1.15)] tw:[&.added]:not-disabled:bg-transparent tw:disabled:bg-transparent tw:[&.added]:not-disabled:text-(--c-green) tw:disabled:text-(--c-green) tw:[&.added]:not-disabled:cursor-default tw:disabled:cursor-default tw:[&.added]:not-disabled:opacity-80 tw:disabled:opacity-80" :class="{ added: rs.selected.has(c.ref) }" :disabled="rs.selected.has(c.ref)" title="Добавить в релиз" @click="setSelected(c.ref, true)">{{ rs.selected.has(c.ref) ? '✓' : '+' }}</button>
              — «{{ c.subject }}», <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(c.commitUrl)">{{ shortSha(c.sha) }}</a> · {{ c.authorName }} · {{ formatDateTime(c.authorDate) }}<template v-if="c.taskUrl"> · <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(c.taskUrl)">задача</a></template>
            </div>
          </template>
          <div v-else class="hint mut tw:text-muted tw:py-3 tw:px-0 tw:text-[11px]">Других веток, трогающих этот файл и ещё не выпущенных, не нашлось — похоже, конфликт придётся разрешить вручную.</div>
        </template>
      </template>
      <div v-else-if="item.dryRunStatus === 'conditional'" class="cond-det tw:mt-4 tw:pl-8 tw:border-l-2 tw:border-l-(--c-yellow) tw:text-[11px]">
        Не проверено — зависит от конфликта
        <a class="tw:text-(--link) tw:cursor-pointer tw:underline" v-for="bl in conflictBlockers(item, planItems)" :key="bl.sha" @click="openLink(bl.commitUrl)">{{ shortSha(bl.sha) }} </a>
        по {{ item.dryRunConflictFiles.join(', ') }}.
      </div>
    </div>
    <div class="cell cdate tw:min-w-0 tw:py-3 tw:px-8 tw:font-data tw:text-[11px] tw:opacity-80 tw:whitespace-nowrap tw:max-[860px]:nth-5:hidden">{{ formatDateTime(item.authorDate) }}</div>
    <div class="cell cauth tw:min-w-0 tw:py-3 tw:px-8 tw:text-[11px] tw:opacity-85 tw:max-[860px]:nth-5:hidden" :title="item.authorName">
      <div class="tw:first:overflow-hidden tw:first:text-ellipsis tw:first:whitespace-nowrap">{{ item.authorName }}</div>
      <span v-if="item.insertions || item.deletions" class="ds tw:gap-4 tw:font-data tw:text-[11px] tw:flex tw:mt-2"><i class="tw:not-italic tw:text-(--c-green)" v-if="item.insertions">+{{ compactCount(item.insertions) }}</i><u class="tw:no-underline tw:text-(--c-red)" v-if="item.deletions">-{{ compactCount(item.deletions) }}</u></span>
    </div>
  </div>
</template>
