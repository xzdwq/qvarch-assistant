<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import { compactCount, planMatchesSelection } from '@shared/releaseView'
import { rs, send, showError } from '../../lib/releaseStore'
import ChronoContextRow from './ChronoContextRow.vue'
import ChronoItemRow from './ChronoItemRow.vue'
import ReleaseCardHead from './ReleaseCardHead.vue'
import StaleBranches from './StaleBranches.vue'
import { chronologySummary as summary, plan, planItems as items } from './planView'
import { buildPlan } from './releaseActions'
import { useChronologyRail } from './useChronologyRail'

/** 2. The chronology: the picked branches' commits by date on the branch rail, with dev's context, forgotten branches, totals. */
const collapsed = ref(false)
/** null — no plan; otherwise whether it was built from the current selection. */
const inSync = computed(() => {
  if (!plan.value) return null
  return planMatchesSelection(
    items.value.map((i) => i.branch),
    [...rs.selected].map((r) => rs.nameByRef.get(r) ?? r),
  )
})
const contextCount = computed(() => plan.value?.contextCommits?.length ?? 0)
function clearPlan(): void {
  showError('')
  send({ command: 'clearPlan' })
}
const rowsEl = ref<HTMLElement>()
const { rows, railW, railSvg, railH, onRailOver } = useChronologyRail(rowsEl, () => collapsed.value)
</script>

<template>
  <section class="card tw:mb-14 tw:py-12 tw:px-14 tw:rounded-(--rad) tw:border tw:border-border tw:bg-panel">
    <ReleaseCardHead :num="2" title="Хронология коммитов" desc="Проверьте порядок коммитов перед сборкой релиза." :collapsed="collapsed" @toggle="collapsed = !collapsed">
      <button v-if="inSync !== null || rs.busy.plan" class="ib sync tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:enabled:bg-white/8 tw:hover:enabled:not-[&.ok]:not-[&.bad]:text-text tw:disabled:opacity-40 tw:[&.ok]:not-[&.bad]:text-(--c-green) tw:[&.bad]:text-(--c-red) tw:hover:enabled:border-border-3" :class="inSync ? 'ok' : 'bad'" :title="inSync ? 'Хронология соответствует текущему выбору веток' : 'Выбор веток изменился — нажмите, чтобы перестроить'" @click.stop="buildPlan">
        <span v-if="rs.busy.plan" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite] tw:m-0"></span><Icon v-else name="refresh" :size="15" />
      </button>
      <template v-if="items.length">
        <span v-if="!summary.conflicts && !summary.conditional" class="cst ok tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:rounded-[4px] tw:text-[11px] tw:whitespace-nowrap tw:bg-[color-mix(in_srgb,var(--c-green)_20%,transparent)] tw:text-(--c-green)">Конфликты: 0 ✓</span>
        <template v-else>
          <span v-if="summary.conflicts" class="cst bad tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:rounded-[4px] tw:text-[11px] tw:whitespace-nowrap tw:[background:var(--c-red)] tw:text-text-hi">Конфликты: {{ summary.conflicts }} ⚠</span>
          <span v-if="summary.conditional" class="cst cond tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:rounded-[4px] tw:text-[11px] tw:whitespace-nowrap tw:[background:var(--c-yellow)] tw:text-black">? {{ summary.conditional }} возможных</span>
        </template>
      </template>
      <button v-if="plan" class="b sec sm tw:inline-flex tw:items-center tw:border-0 tw:rounded-(--rad-sm) tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:h-22 tw:py-0 tw:px-8 tw:text-[11px] tw:hover:enabled:border-border-3" @click.stop="clearPlan">Очистить</button>
    </ReleaseCardHead>
    <div v-show="!collapsed">
      <button v-if="items.length && (contextCount || plan?.anchorCommit)" class="b sec sm ctxb tw:inline-flex tw:items-center tw:border-0 tw:rounded-(--rad-sm) tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:h-22 tw:py-0 tw:px-8 tw:text-[11px] tw:mb-6 tw:hover:enabled:border-border-3" @click="rs.contextCollapsed = !rs.contextCollapsed">
        {{ rs.contextCollapsed ? `▸ показать контекстные коммиты ${rs.devBranch} (${contextCount}${plan?.contextCommitsTruncated ? '+' : ''})` : `▾ скрыть контекстные коммиты ${rs.devBranch}` }}
      </button>

      <StaleBranches v-if="plan && items.length && (rs.staleLoading || rs.staleHints)" />

      <div v-if="!items.length" class="mut empty tw:text-muted tw:text-[12px] tw:flex tw:items-center tw:p-8">
        <template v-if="rs.busy.plan"><span class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>Строим хронологию…</template>
        <template v-else>Постройте хронологию, чтобы увидеть коммиты</template>
      </div>
      <div v-else class="cscroll tw:mt-4 tw:overflow-x-auto tw:overflow-y-hidden">
        <div class="cinner" :style="{ '--rail': `${railW}px`, minWidth: `${railW + 420 + 160}px` }">
          <div class="trow thead tw:grid tw:grid-cols-[var(--rail,18px)_152px_minmax(160px,1fr)_144px_124px] tw:items-stretch tw:pb-4 tw:mb-2 tw:border-b tw:border-b-border tw:[&&]:max-[860px]:grid-cols-[var(--rail,18px)_120px_minmax(160px,1fr)_120px]">
            <span class="tw:py-3 tw:px-8 tw:text-muted tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.02em] tw:max-[860px]:nth-5:hidden"></span><span class="tw:py-3 tw:px-8 tw:text-muted tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.02em] tw:max-[860px]:nth-5:hidden">Ветка</span><span class="tw:py-3 tw:px-8 tw:text-muted tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.02em] tw:max-[860px]:nth-5:hidden">Коммит</span><span class="tw:py-3 tw:px-8 tw:text-muted tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.02em] tw:max-[860px]:nth-5:hidden">Дата</span><span class="tw:py-3 tw:px-8 tw:text-muted tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.02em] tw:max-[860px]:nth-5:hidden">Автор</span>
          </div>
          <div ref="rowsEl" class="rows tw:relative">
            <div class="railo tw:absolute tw:top-0 tw:left-0 tw:z-1 tw:pointer-events-none" :style="{ width: `${railW}px`, height: `${railH}px` }" @mouseover="onRailOver" @mouseleave="onRailOver">
              <svg :width="railW" :height="railH" style="overflow: visible" v-html="railSvg"></svg>
            </div>
            <template v-for="(r, ri) in rows" :key="ri">
              <div v-if="r.kind === 'mergeMarker' && rs.contextCollapsed" class="trow folded tw:grid tw:grid-cols-[var(--rail,18px)_152px_minmax(160px,1fr)_144px_124px] tw:items-stretch tw:min-h-0 tw:border-b-0 tw:last:border-b-0 tw:[&&]:max-[860px]:grid-cols-[var(--rail,18px)_120px_minmax(160px,1fr)_120px]"></div>
              <ChronoItemRow v-else-if="r.kind === 'item'" :item="r.item" />
              <ChronoContextRow v-else :r="r" />
            </template>
          </div>
          <div v-if="summary.commits" class="csum tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-14 tw:mt-6 tw:py-6 tw:px-8 tw:border-t tw:border-t-border tw:text-[11px] tw:opacity-85">
            <span>{{ summary.commits }} коммит(ов)</span><i class="tw:my-0 tw:-mx-8 tw:not-italic tw:opacity-50">·</i><span>{{ summary.branches }} веток</span><i class="tw:my-0 tw:-mx-8 tw:not-italic tw:opacity-50">·</i><span>{{ summary.authors }} авторов</span><i class="tw:my-0 tw:-mx-8 tw:not-italic tw:opacity-50">·</i>
            <span class="ds tw:inline-flex tw:gap-4 tw:font-data tw:text-[11px]"><i class="tw:not-italic tw:text-(--c-green)">+{{ compactCount(summary.ins) }}</i><u class="tw:no-underline tw:text-(--c-red)">-{{ compactCount(summary.del) }}</u></span><i class="tw:my-0 tw:-mx-8 tw:not-italic tw:opacity-50">·</i><span>{{ summary.files }} файлов</span>
            <template v-if="summary.conflicts"><i class="tw:my-0 tw:-mx-8 tw:not-italic tw:opacity-50">·</i><span class="badge conflict tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-red)] tw:text-text-hi">⚠ {{ summary.conflicts }} конфликт(ов)</span></template>
            <template v-if="summary.conditional"><i class="tw:my-0 tw:-mx-8 tw:not-italic tw:opacity-50">·</i><span class="badge cond tw:inline-block tw:mt-2 tw:mr-4 tw:mb-0 tw:ml-0 tw:py-1 tw:px-6 tw:rounded-r2 tw:text-[11px] tw:[background:var(--c-yellow)] tw:text-black">? {{ summary.conditional }} возможных</span></template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./ChronologyCard.css"></style>
