<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import Popover from '../../components/Popover.vue'
import { openProject, rs, send, showError } from '../../lib/releaseStore'
import { openInCode, repoPath } from './releaseActions'

/** The git bar: the current branch (switches it), the project menu, "open in the editor" and Pull. */
const emit = defineEmits<{ manage: [] }>()

const branchNames = computed(() => {
  const s = new Set(rs.branches.map((b) => b.name))
  for (const n of [rs.current, rs.mainBranch, rs.devBranch]) if (n) s.add(n)
  return [...s].sort()
})
const dirtyMark = computed(() => (rs.dirty.hasUnstaged || rs.dirty.hasStaged ? ` (${rs.dirty.hasUnstaged ? '*' : ''}${rs.dirty.hasStaged ? '+' : ''})` : ''))
function switchBranch(name: string): void {
  showError('')
  send({ command: 'switchBranch', branch: name })
}
function pull(): void {
  showError('')
  rs.busy.pull = true
  send({ command: 'pullCurrentBranch' })
}

// ---------- the projects' menu: over everything (Popover), kept by its button ----------
const projOpen = ref(false)
const projEl = ref<HTMLElement>()
function pickProject(id: string): void {
  projOpen.value = false
  void openProject(id, true)
}
function manage(): void {
  projOpen.value = false
  emit('manage')
}
</script>

<template>
  <div class="card gitbar tw:mb-14 tw:py-12 tw:px-14 tw:rounded-(--rad) tw:border tw:border-border tw:bg-panel tw:flex tw:flex-wrap tw:items-center tw:gap-y-10 tw:gap-x-16">
    <div class="fi tw:flex tw:items-center tw:gap-8">
      <label class="tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap">Текущая ветка</label>
      <select class="tw:h-28 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-(--rad-sm) tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:min-w-200 tw:max-w-320" :value="rs.current" :title="dirtyMark ? '* — изменения без git add; + — застейджено, но не закоммичено' : ''" @change="switchBranch(($event.target as HTMLSelectElement).value)">
        <option class="tw:bg-panel-2" v-for="n in branchNames" :key="n" :value="n">{{ n }}{{ n === rs.current ? dirtyMark : '' }}</option>
      </select>
      <div ref="projEl" class="pop tw:relative">
        <button class="pname tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[13px] tw:font-bold tw:cursor-pointer tw:hover:not-[&.on]:bg-white/6 tw:[&.on]:bg-white/6 tw:hover:enabled:border-border-3" :class="{ on: projOpen }" title="Проект" @click="projOpen = !projOpen">{{ rs.projectName || 'Проект' }}<Icon name="chevronDown" :size="12" /></button>
        <Popover v-model:open="projOpen" :anchor="projEl" :width="340" align-left :chrome="0" class="pd tw:overflow-y-auto tw:p-5 tw:flex tw:flex-col tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)]">
          <button v-for="p in rs.projects" :key="p.id" class="pi tw:flex tw:items-baseline tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:cursor-pointer tw:hover:enabled:bg-accent/16 tw:[&.on]:text-accent-fg tw:disabled:opacity-40 tw:hover:enabled:border-border-3" :class="{ on: p.id === rs.projectId }" @click="pickProject(p.id)">
            <span class="pn tw:flex-none">{{ p.name }}</span><small class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11px]">{{ p.repositoryPath }}</small>
          </button>
          <div class="sep tw:my-4 tw:mx-6 tw:border-t tw:border-t-white/7"></div>
          <button class="pi tw:flex tw:items-baseline tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:cursor-pointer tw:hover:enabled:bg-accent/16 tw:disabled:opacity-40 tw:hover:enabled:border-border-3" @click="manage"><span class="pn tw:flex-none">Проекты…</span></button>
          <button class="pi tw:flex tw:items-baseline tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:cursor-pointer tw:hover:enabled:bg-accent/16 tw:disabled:opacity-40 tw:hover:enabled:border-border-3" :disabled="!rs.projectId" @click="(projOpen = false), openProject(rs.projectId, true, true)"><span class="pn tw:flex-none">Продолжить сохранённую сборку</span></button>
        </Popover>
      </div>
    </div>
    <div class="acts tw:flex tw:items-center tw:gap-6 tw:ml-auto">
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:enabled:bg-white/8 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Открыть в VS Code" :disabled="!repoPath" @click="openInCode(repoPath)"><Icon name="code" :size="14" /></button>
      <button class="b blue tw:inline-flex tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-0 tw:rounded-(--rad-sm) tw:text-on-accent tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-accent tw:hover:enabled:border-border-3" :disabled="rs.busy.pull || !rs.current" title="git pull текущей ветки" @click="pull"><span v-if="rs.busy.pull" class="ld tw:inline-block tw:flex-none tw:w-10 tw:h-10 tw:mr-6 tw:[vertical-align:-1px] tw:rounded-[50%] tw:border-2 tw:border-white/18 tw:[&&]:border-t-current tw:animate-[ReleaseView-qspin_0.8s_linear_infinite]"></span>{{ rs.busy.pull ? 'Pull…' : 'Pull' }}</button>
    </div>
  </div>
</template>
