<script setup lang="ts">
import { computed } from 'vue'
import type { BranchRef, MainStatus } from '@shared/release'
import { compactCount, formatDateTime, shortSha } from '@shared/releaseView'
import { rs } from '../../lib/releaseStore'
import { loadBranchCommits, openLink, setSelected } from './releaseActions'

/** One branch of the list: its box, name and badges, last commit, links, its own commits when expanded, its diff. */
const props = defineProps<{ b: BranchRef }>()

const status = computed<MainStatus>(() => rs.statusOverride.get(props.b.ref) ?? props.b.mainStatus)
const expanded = computed(() => rs.expanded.has(props.b.ref))
const commits = computed(() => {
  const v = rs.commits.get(props.b.ref)
  return v && v !== 'loading' ? v : undefined
})
const diff = computed(() => rs.diffStats.get(props.b.ref))
function toggleExpand(): void {
  const ref = props.b.ref
  const s = new Set(rs.expanded)
  if (s.has(ref)) s.delete(ref)
  else {
    s.add(ref)
    loadBranchCommits(ref)
  }
  rs.expanded = s
}
</script>

<template>
  <div class="bgrid brow tw:group/bgrid tw:grid tw:grid-cols-[22px_minmax(160px,1fr)_96px] tw:items-stretch tw:py-5 tw:px-0 tw:border-b tw:[border-bottom-style:dashed] tw:border-b-border tw:last-of-type:border-b-0" :class="{ remote: b.isRemote }">
    <span></span>
    <div class="binfo tw:flex tw:items-start tw:gap-8 tw:min-w-0 tw:py-0 tw:px-8">
      <input class="tw:m-0 tw:[accent-color:var(--accent)] tw:[&&]:mt-3" type="checkbox" :checked="rs.selected.has(b.ref)" @change="setSelected(b.ref, ($event.target as HTMLInputElement).checked)" />
      <div class="bmain tw:flex-1 tw:min-w-0">
        <div>
          <span class="bname tw:font-data tw:text-[11.5px] tw:font-medium tw:break-all tw:group-[.remote]/bgrid:after:content-['_(remote)'] tw:group-[.remote]/bgrid:after:opacity-50 tw:group-[.remote]/bgrid:after:text-[10px]">{{ b.name }}</span>
          <span v-if="status === 'full'" class="badge inmain tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-purple)] tw:text-black">уже в {{ rs.mainBranch }}</span>
          <span v-else-if="status === 'partial'" class="badge partial tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-yellow)] tw:text-black">частично в {{ rs.mainBranch }}</span>
        </div>
        <div class="sha mut tw:font-data tw:text-[11px] tw:opacity-85 tw:text-muted tw:[word-break:break-word]">{{ b.lastCommitSha ? shortSha(b.lastCommitSha) : '' }} · {{ formatDateTime(b.lastCommitDate) }} · {{ b.lastCommitAuthor }} · {{ b.lastCommitSubject }}</div>
        <div class="links">
          <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="b.taskUrl" @click="openLink(b.taskUrl)">Задача</a>
          <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="b.prUrl" @click="openLink(b.prUrl)">PR #{{ b.prNumber }}</a>
          <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="b.commitUrl" @click="openLink(b.commitUrl)">коммит</a>
        </div>
        <button class="lnk tw:p-0 tw:border-0 tw:[background:none] tw:text-(--link) tw:text-[11px] tw:underline tw:cursor-pointer tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="toggleExpand">{{ expanded ? '▾ скрыть коммиты' : `▸ показать коммиты (относительно ${rs.devBranch}-ветки)` }}</button>
        <template v-if="expanded">
          <div v-if="rs.commits.get(b.ref) === 'loading'" class="bcs mut tw:text-muted tw:text-[12px] tw:my-4 tw:mx-0 tw:pl-8 tw:border-l-2 tw:border-l-border"><span class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>Загрузка коммитов…</div>
          <template v-else-if="commits">
            <div v-if="commits.forkedFrom" class="bcs mut tw:text-muted tw:text-[12px] tw:my-4 tw:mx-0 tw:pl-8 tw:border-l-2 tw:border-l-border">Ветка заведена не от {{ rs.devBranch }}, а от <b>{{ commits.forkedFrom }}</b> — коммиты показаны относительно неё</div>
            <div v-if="!commits.commits.length" class="bcs mut tw:text-muted tw:text-[12px] tw:my-4 tw:mx-0 tw:pl-8 tw:border-l-2 tw:border-l-border">Нет коммитов, отсутствующих в {{ rs.devBranch }}-ветке</div>
            <div v-else class="bcs tw:my-4 tw:mx-0 tw:pl-8 tw:border-l-2 tw:border-l-border">
              <div v-for="c in commits.commits" :key="c.sha" class="bc tw:py-2 tw:px-0 tw:text-[11px]">
                <span class="sha tw:font-data tw:text-[11px] tw:opacity-85">{{ shortSha(c.sha) }}</span> · {{ formatDateTime(c.authorDate) }} · {{ c.authorName }} · {{ c.subject }}
                <span v-if="c.alreadyInMain" class="badge inmain tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-purple)] tw:text-black">уже в {{ rs.mainBranch }}</span>
                <span class="links inl tw:ml-4">
                  <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="c.taskUrl" @click="openLink(c.taskUrl)">Задача</a>
                  <a class="tw:text-(--link) tw:cursor-pointer tw:mr-8 tw:text-[11px] tw:no-underline tw:hover:underline" v-if="c.commitUrl" @click="openLink(c.commitUrl)">коммит</a>
                  <span v-if="c.insertions || c.deletions" class="ds tw:inline-flex tw:gap-4 tw:font-data tw:text-[11px]"><i class="tw:not-italic tw:text-(--c-green)">+{{ compactCount(c.insertions) }}</i><u class="tw:no-underline tw:text-(--c-red)">-{{ compactCount(c.deletions) }}</u></span>
                </span>
              </div>
            </div>
            <div v-if="commits.truncated" class="bcs mut tw:text-muted tw:text-[12px] tw:my-4 tw:mx-0 tw:pl-8 tw:border-l-2 tw:border-l-border">Показаны не все коммиты — возможно, {{ rs.devBranch }}-ветка сильно отстала</div>
          </template>
        </template>
      </div>
    </div>
    <div class="bdiff tw:flex tw:flex-col tw:items-end tw:gap-1 tw:py-3 tw:px-8 tw:font-data tw:text-[11px]">
      <template v-if="diff">
        <span v-if="diff.insertions" class="add tw:text-(--c-green)">+{{ compactCount(diff.insertions) }}</span>
        <span v-if="diff.deletions" class="del tw:text-(--c-red)">-{{ compactCount(diff.deletions) }}</span>
        <span v-if="diff.filesChanged" class="mut fc tw:text-muted tw:font-[inherit] tw:text-[10px]">({{ diff.filesChanged }} файл(ов))</span>
      </template>
      <span v-else class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>
    </div>
  </div>
</template>
