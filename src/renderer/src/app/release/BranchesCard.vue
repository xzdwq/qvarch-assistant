<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import JiraReleasePicker from '../../components/JiraReleasePicker.vue'
import { colors, rs, send, showError } from '../../lib/releaseStore'
import BranchRow from './BranchRow.vue'
import ReleaseCardHead from './ReleaseCardHead.vue'
import { buildPlan, loadBranchCommits, setSelected } from './releaseActions'
import { useBranchListRail } from './useBranchListRail'
import { useJiraReleaseTicking } from './useJiraReleaseTicking'

/** 1. Branches: filter and switches, the list with its rail, the selection and "build the chronology". */
const LIMITS = [25, 50, 100, 200, 500, 1000000]
const collapsed = ref(false)
const colorFor = colors.colorFor

// ---------- the filter: the list is filtered by the session ----------
let filterTimer: ReturnType<typeof setTimeout> | undefined
const searching = ref(false)
function onFilter(v: string): void {
  rs.filter = v
  clearTimeout(filterTimer)
  searching.value = true
  filterTimer = setTimeout(() => send({ command: 'filterBranches', query: v }), 150)
}
watch(
  () => rs.branches,
  () => (searching.value = false),
)
function applyFilters(): void {
  showError('')
  searching.value = true
  send({ command: 'setBranchListLimit', limit: rs.limit, hideAlreadyInMain: rs.hideInMain })
}
function setService(show: boolean): void {
  rs.showService = show
  searching.value = true
  send({ command: 'setHideServiceBranches', hide: !show })
}
function refresh(): void {
  rs.busy.refresh = true
  searching.value = true
  send({ command: 'refreshBranches' })
}
const { relBusy, onRelease } = useJiraReleaseTicking(LIMITS[LIMITS.length - 1], applyFilters)

// ---------- selection and expansion of the shown branches ----------
const allSelected = computed(() => rs.branches.length > 0 && rs.branches.every((b) => rs.selected.has(b.ref)))
function selectAll(on: boolean): void {
  const s = new Set(rs.selected)
  for (const b of rs.branches) on ? s.add(b.ref) : s.delete(b.ref)
  rs.selected = s
}
const allExpanded = computed(() => rs.branches.length > 0 && rs.branches.every((b) => rs.expanded.has(b.ref)))
function expandAll(): void {
  const on = !allExpanded.value
  const s = new Set(rs.expanded)
  for (const b of rs.branches) {
    if (on) {
      s.add(b.ref)
      loadBranchCommits(b.ref)
    } else s.delete(b.ref)
  }
  rs.expanded = s
}
const selectedList = computed(() => [...rs.selected].map((ref) => ({ ref, name: rs.nameByRef.get(ref) ?? ref })))

const listEl = ref<HTMLElement>()
const listRail = useBranchListRail(listEl, () => collapsed.value)
</script>

<template>
  <section class="card tw:mb-14 tw:py-12 tw:px-14 tw:rounded-(--rad) tw:border tw:border-border tw:bg-panel">
    <ReleaseCardHead :num="1" title="Выберите ветки для релиза" desc="Отметьте ветки, которые хотите включить в релиз." :collapsed="collapsed" @toggle="collapsed = !collapsed">
      <button class="b sec sm tw:inline-flex tw:items-center tw:border-0 tw:rounded-(--rad-sm) tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:h-22 tw:py-0 tw:px-8 tw:text-[11px] tw:hover:enabled:border-border-3" :disabled="rs.busy.refresh" @click.stop="refresh"><span v-if="rs.busy.refresh" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>{{ rs.busy.refresh ? 'Обновляем…' : 'Обновить список веток' }}</button>
    </ReleaseCardHead>
    <div v-show="!collapsed">
      <div class="frow tw:flex tw:flex-wrap tw:items-center tw:gap-14 tw:mt-8 tw:text-[12px]">
        <label class="sf tw:relative tw:flex tw:items-center tw:flex-[0_1_260px] tw:text-muted">
          <Icon name="search" :size="13" />
          <input class="tw:w-full tw:pl-28" :value="rs.filter" placeholder="фильтр по названию" @input="onFilter(($event.target as HTMLInputElement).value)" />
        </label>
        <label class="sw tw:inline-flex tw:items-center tw:gap-8 tw:whitespace-nowrap tw:cursor-pointer tw:select-none" title="Скрывает ветки, уже полностью выпущенные — проверка идёт git-запросом">
          <input class="tw:absolute tw:w-1 tw:h-1 tw:opacity-0 tw:m-0 tw:[accent-color:var(--accent)]" :checked="rs.hideInMain" type="checkbox" @change="(rs.hideInMain = ($event.target as HTMLInputElement).checked), applyFilters()" /><span class="tr tw:relative tw:flex-none tw:w-30 tw:h-16 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:[transition:background-color_0.15s_ease,border-color_0.15s_ease] tw:[.sw_input:checked+&]:border-accent tw:[.sw_input:checked+&]:bg-accent tw:[.sw_input:focus-visible+&]:[outline:1px_solid_var(--accent)] tw:[.sw_input:focus-visible+&]:outline-offset-1 tw:after:content-[''] tw:after:absolute tw:after:top-1 tw:after:left-1 tw:after:w-12 tw:after:h-12 tw:after:rounded-[50%] tw:after:bg-muted tw:after:[transition:transform_0.15s_ease,background-color_0.15s_ease] tw:[.sw_input:checked+&]:after:[transform:translateX(14px)] tw:[.sw_input:checked+&]:after:bg-text-hi"></span>Скрыть уже в {{ rs.mainBranch }}
        </label>
        <label class="sw tw:inline-flex tw:items-center tw:gap-8 tw:whitespace-nowrap tw:cursor-pointer tw:select-none" title="qa, revert-pr-, chore/ и т.п.">
          <input class="tw:absolute tw:w-1 tw:h-1 tw:opacity-0 tw:m-0 tw:[accent-color:var(--accent)]" :checked="rs.showService" type="checkbox" @change="setService(($event.target as HTMLInputElement).checked)" /><span class="tr tw:relative tw:flex-none tw:w-30 tw:h-16 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:[transition:background-color_0.15s_ease,border-color_0.15s_ease] tw:[.sw_input:checked+&]:border-accent tw:[.sw_input:checked+&]:bg-accent tw:[.sw_input:focus-visible+&]:[outline:1px_solid_var(--accent)] tw:[.sw_input:focus-visible+&]:outline-offset-1 tw:after:content-[''] tw:after:absolute tw:after:top-1 tw:after:left-1 tw:after:w-12 tw:after:h-12 tw:after:rounded-[50%] tw:after:bg-muted tw:after:[transition:transform_0.15s_ease,background-color_0.15s_ease] tw:[.sw_input:checked+&]:after:[transform:translateX(14px)] tw:[.sw_input:checked+&]:after:bg-text-hi"></span>Показать служебные
        </label>
        <label class="lim tw:flex tw:items-center tw:gap-6 tw:ml-auto tw:whitespace-nowrap tw:[&&]:max-[860px]:ml-0">Показывать
          <select class="tw:h-28 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-(--rad-sm) tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px]" v-model.number="rs.limit" @change="applyFilters">
            <option class="tw:bg-panel-2" v-for="l in LIMITS" :key="l" :value="l">{{ l >= 1000000 ? 'Все' : l }}</option>
            <option class="tw:bg-panel-2" v-if="!LIMITS.includes(rs.limit)" :value="rs.limit">{{ rs.limit }}</option>
          </select>
        </label>
      </div>
      <div class="arow tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:my-6 tw:mx-0">
        <label class="ck tw:inline-flex tw:items-center tw:gap-6 tw:cursor-pointer"><input class="tw:m-0 tw:[accent-color:var(--accent)]" type="checkbox" :checked="allSelected" @change="selectAll(($event.target as HTMLInputElement).checked)" />Выбрать все</label>
        <button class="b sec sm tw:inline-flex tw:items-center tw:border-0 tw:rounded-(--rad-sm) tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:h-22 tw:py-0 tw:px-8 tw:text-[11px] tw:hover:enabled:border-border-3" @click="expandAll">{{ allExpanded ? `▾ Скрыть коммиты в ${rs.devBranch} (для всех)` : `▸ Показать коммиты в ${rs.devBranch} (для всех)` }}</button>
        <JiraReleasePicker :model-value="rs.jiraRelease" :busy="relBusy" :info="rs.jiraReleaseInfo" @update:model-value="onRelease" />
      </div>
      <div v-if="rs.branches.length" class="bgrid bhead tw:grid tw:grid-cols-[22px_minmax(160px,1fr)_96px] tw:items-stretch tw:pb-4 tw:mt-4 tw:border-b tw:border-b-border tw:text-muted tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.02em]">
        <span class="tw:nth-2:py-0 tw:nth-2:px-8"></span><span class="tw:nth-2:py-0 tw:nth-2:px-8">Ветка и последний коммит</span><span class="r tw:nth-2:py-0 tw:nth-2:px-8 tw:py-0 tw:px-8 tw:text-right">Изменения</span>
      </div>
      <div ref="listEl" class="blist tw:relative tw:h-280 tw:min-h-120 tw:mt-6 tw:overflow-x-hidden tw:overflow-y-auto tw:resize-y tw:border tw:border-border tw:rounded-(--rad-sm)">
        <div class="lrail tw:absolute tw:top-0 tw:left-0 tw:w-22 tw:pointer-events-none" :style="{ height: `${listRail.h}px` }"><svg width="22" :height="listRail.h" style="overflow: visible" v-html="listRail.svg"></svg></div>
        <BranchRow v-for="b in rs.branches" :key="b.ref" :b="b" />
        <div v-if="!rs.branches.length" class="empty mut tw:text-muted tw:text-[12px] tw:flex tw:items-center tw:p-8">
          <template v-if="rs.listInfo === null"><span class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>Загрузка веток…</template>
          <template v-else>Ничего не найдено (проверьте фильтр или переключатели выше)</template>
        </div>
      </div>
      <div class="info mut tw:text-muted tw:text-[12px] tw:mt-6">
        <template v-if="searching"><span class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>Обновление списка веток…</template>
        <template v-else>{{ rs.listInfo ?? 'Загрузка веток…' }}</template>
      </div>
      <div class="selsum tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:mt-6">
        <template v-if="selectedList.length">
          <button class="clr tw:inline-flex tw:items-center tw:justify-center tw:w-16 tw:h-16 tw:mr-6 tw:p-0 tw:border-0 tw:rounded-[50%] tw:[background:var(--c-red)] tw:text-text-hi tw:text-[12px] tw:font-bold tw:cursor-pointer tw:hover:filter-[brightness(1.15)] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Очистить выбранное" @click="rs.selected = new Set()">×</button>
          <span class="mut tw:text-muted tw:text-[12px]">Выбрано ({{ selectedList.length }}):</span>
          <span v-for="s in selectedList" :key="s.ref" class="chip tw:inline-flex tw:items-center tw:mt-2 tw:mr-4 tw:mb-2 tw:ml-0 tw:py-2 tw:px-8 tw:rounded-(--rad-sm) tw:text-black tw:text-[11px]" :style="{ background: colorFor(s.name) }">{{ s.name }}<button class="cx tw:inline-flex tw:items-center tw:justify-center tw:w-14 tw:h-14 tw:ml-4 tw:p-0 tw:border-0 tw:rounded-[50%] tw:[background:none] tw:text-inherit tw:text-[12px] tw:cursor-pointer tw:hover:bg-black/15 tw:hover:enabled:border-border-3" title="Убрать из выбора" @click="setSelected(s.ref, false)">×</button></span>
        </template>
        <span v-else class="mut tw:text-muted tw:text-[12px]">Ветки не выбраны</span>
      </div>
      <div class="brow-btns tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:mt-8">
        <button class="b pri tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:bg-accent tw:text-on-accent tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default" :disabled="rs.busy.plan" @click="buildPlan"><span v-if="rs.busy.plan" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>{{ rs.busy.plan ? 'Строим хронологию и проверяем конфликты…' : 'Построить хронологию выбранных веток' }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped src="./BranchesCard.css"></style>
