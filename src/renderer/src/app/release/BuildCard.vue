<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import { formatDateTime, shortSha } from '@shared/releaseView'
import { requestDateCheck, rs, send, showError, today } from '../../lib/releaseStore'
import ReleaseCardHead from './ReleaseCardHead.vue'
import { appliedCount, hasItems, hasPendingBuild, hasRelease, includedItems as included, pendingItems, plan, planItems as items } from './planView'
import { openLink } from './releaseActions'

/** 4. The build: the release date (the branch name), create the release branch, build / abort, publish. */
const collapsed = ref(false)
/** Its number: 3 when the cherry-pick card is not shown. */
const cardNo = computed(() => (pendingItems.value.length ? 4 : 3))
const createDisabled = computed(() => rs.busy.create || rs.dateCheck.exists || (!!rs.dateCheck.branchName && rs.current === rs.dateCheck.branchName))
let dateTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => rs.releaseDate,
  () => {
    clearTimeout(dateTimer)
    dateTimer = setTimeout(requestDateCheck, 200)
  },
)
function createBranch(): void {
  showError('')
  rs.busy.create = true
  send({ command: 'startBuilding', releaseDate: rs.releaseDate.trim() })
}
function startAuto(): void {
  rs.busy.start = true
  showError('')
  send({ command: 'startAuto' })
}
function publish(): void {
  rs.busy.publish = true
  send({ command: 'publishRelease' })
}
</script>

<template>
  <section class="card tw:mb-14 tw:py-12 tw:px-14 tw:rounded-(--rad) tw:border tw:border-border tw:bg-panel">
    <ReleaseCardHead :num="cardNo" title="Сборка релизной ветки" :collapsed="collapsed" @toggle="collapsed = !collapsed" />
    <div v-show="!collapsed">
      <div class="frow2 tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:mb-8">
        <label>Дата релиза (для имени релизной ветки):</label>
        <input v-model="rs.releaseDate" class="din tw:h-28 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-(--rad-sm) tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:w-160" type="text" />
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:enabled:bg-white/8 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Сбросить на сегодняшнюю дату" @click="rs.releaseDate = today()"><Icon name="refresh" :size="14" /></button>
      </div>
      <div class="brow-btns tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:mt-8">
        <button class="b blue tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:text-on-accent tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-accent tw:hover:enabled:border-border-3" :disabled="createDisabled" @click="createBranch"><span v-if="rs.busy.create" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>{{ rs.busy.create ? 'Создаём…' : 'Создать релизную ветку' }}</button>
        <span class="mut tw:text-muted tw:text-[12px]">
          <template v-if="hasRelease">Релизная ветка: {{ plan!.releaseBranch }}</template>
          <template v-else-if="rs.dateCheck.exists">Ветка "{{ rs.dateCheck.branchName }}" уже существует — используйте «Начать сборку»</template>
          <template v-else>Релизная ветка ещё не создана</template>
        </span>
      </div>
      <div v-if="rs.releaseInfo && !items.length" class="rinfo mut tw:text-muted tw:text-[12px] tw:mt-6">
        <div v-if="!rs.releaseInfo.commits.length">{{ rs.releaseInfo.note }}</div>
        <template v-else>
          <div>Уже в ветке {{ rs.releaseInfo.releaseBranch }} (плана нет — выберите те же ветки и постройте хронологию, чтобы увидеть полную картину):</div>
          <div v-for="c in rs.releaseInfo.commits" :key="c.sha">→ «{{ c.subject }}», <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(c.commitUrl)">{{ shortSha(c.sha) }}</a> · {{ c.authorName }} · {{ formatDateTime(c.authorDate) }}<template v-if="c.taskUrl"> · <a class="tw:text-(--link) tw:cursor-pointer tw:underline" @click="openLink(c.taskUrl)">задача</a></template></div>
        </template>
      </div>
      <div class="brow-btns gap tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:mt-12">
        <button class="b green tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:text-on-accent tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-up tw:hover:enabled:border-border-3" :disabled="!hasPendingBuild || rs.busy.start" @click="startAuto"><span v-if="rs.busy.start" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>{{ rs.busy.start ? 'Собираем…' : appliedCount ? 'Продолжить сборку' : 'Начать сборку' }}</button>
        <button class="b red tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:text-on-accent tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-down tw:hover:enabled:border-border-3" @click="send({ command: 'abortBuild' })">Отменить сборку</button>
      </div>
      <div class="mut bst tw:text-muted tw:text-[12px] tw:mt-4">
        <template v-if="rs.published"><span class="okc tw:text-(--c-green)">✓ Релизная ветка опубликована (запушена в remote).</span></template>
        <template v-else-if="hasRelease && !hasItems">В хронологии нет коммитов.</template>
        <template v-else-if="hasItems && !included.length">В хронологии нет отмеченных коммитов.</template>
        <template v-else-if="hasItems && appliedCount === included.length"><span class="okc tw:text-(--c-green)">✓ Релиз собран — применено {{ included.length }} из {{ included.length }} коммитов.</span></template>
        <template v-else-if="hasItems">Применено {{ appliedCount }} из {{ included.length }} коммитов.</template>
      </div>
      <div v-if="hasItems && included.length && appliedCount === included.length && !rs.published" class="brow-btns tw:flex tw:flex-wrap tw:items-center tw:gap-8 tw:mt-8">
        <button class="b pri tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:bg-accent tw:text-on-accent tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default" :disabled="rs.busy.publish" @click="publish"><span v-if="rs.busy.publish" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>{{ rs.busy.publish ? 'Публикуем…' : 'Опубликовать релизную ветку' }}</button>
      </div>
    </div>
  </section>
</template>
