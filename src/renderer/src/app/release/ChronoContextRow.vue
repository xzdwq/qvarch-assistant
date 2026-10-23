<script setup lang="ts">
import { formatDateTime, shortSha } from '@shared/releaseView'
import type { Row } from '../../lib/releaseRail'
import { rs } from '../../lib/releaseStore'
import { openLink } from './releaseActions'

/** A dev commit in the chronology for context: a context commit, a merge marker or the anchor before it all. */
defineProps<{ r: Exclude<Row, { kind: 'item' }> }>()
</script>

<template>
  <div class="trow ctx tw:grid tw:grid-cols-[var(--rail,18px)_152px_minmax(160px,1fr)_144px_124px] tw:items-stretch tw:border-b tw:[border-bottom-style:dashed] tw:border-b-border tw:last:border-b-0 tw:opacity-[0.55] tw:text-[11px] tw:[&&]:max-[860px]:grid-cols-[var(--rail,18px)_120px_minmax(160px,1fr)_120px]">
    <span class="tw:max-[860px]:nth-5:hidden"></span>
    <div class="cell cbr tw:min-w-0 tw:py-3 tw:px-8 tw:flex tw:items-start tw:gap-6 tw:max-[860px]:nth-5:hidden"><span class="lane dev tw:flex-[1_1_auto] tw:min-w-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:text-center tw:wrap-break-word tw:[word-break:break-word] tw:border tw:border-dashed tw:border-border tw:bg-transparent tw:text-text">{{ rs.devBranch }}</span></div>
    <div class="cell ccm tw:min-w-0 tw:py-3 tw:px-8 tw:max-[860px]:nth-5:hidden">
      <div>{{ r.commit.subject }}<span v-if="r.kind === 'anchor'" class="mut tw:text-muted tw:text-[12px]"> — последний коммит {{ rs.devBranch }} перед началом хронологии</span></div>
      <span class="sha tw:font-data tw:text-[11px] tw:opacity-85">{{ shortSha(r.commit.sha) }}</span>
      <div class="links">
        <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="r.commit.taskUrl" @click="openLink(r.commit.taskUrl)">Задача</a>
        <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="r.kind === 'mergeMarker' && r.commit.prUrl" @click="openLink(r.commit.prUrl)">PR #{{ r.commit.prNumber }}</a>
        <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="r.commit.commitUrl" @click="openLink(r.commit.commitUrl)">коммит</a>
      </div>
    </div>
    <div class="cell cdate tw:min-w-0 tw:py-3 tw:px-8 tw:font-data tw:text-[11px] tw:opacity-80 tw:whitespace-nowrap tw:max-[860px]:nth-5:hidden">{{ formatDateTime(r.commit.authorDate) }}</div>
    <div class="cell cauth tw:min-w-0 tw:py-3 tw:px-8 tw:text-[11px] tw:opacity-85 tw:max-[860px]:nth-5:hidden">{{ r.commit.authorName }}</div>
  </div>
</template>
