<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listen, loadProjects, openProject, rs, showError } from '../lib/releaseStore'
import BranchesCard from './release/BranchesCard.vue'
import BuildCard from './release/BuildCard.vue'
import CherryPickCard from './release/CherryPickCard.vue'
import ChronologyCard from './release/ChronologyCard.vue'
import ProjectsManager from './release/ProjectsManager.vue'
import ReleaseGitBar from './release/ReleaseGitBar.vue'
import { pendingItems } from './release/planView'
import { openInCode, repoPath } from './release/releaseActions'

/**
 * Релиз — the release branch builder (formerly the "Qvarh Release" VS Code extension), laid out as its
 * panel was: the git bar, then 1 branches · 2 chronology · 3 cherry-pick by hand · 4 the build.
 */
listen()

/** No projects yet: imports them once, else opens the projects window; otherwise opens the last project. */
const managerOpen = ref(false)
onMounted(async () => {
  await loadProjects()
  if (!rs.projects.length) {
    if (await window.qa.releaseImport()) await loadProjects()
  }
  if (!rs.projects.length) {
    managerOpen.value = true
    return
  }
  const id = rs.projects.some((p) => p.id === rs.projectId) ? rs.projectId : rs.projects[0].id
  void openProject(id)
})
</script>

<template>
  <div class="rel tw:[--c-green:var(--up)] tw:[--c-red:var(--down)] tw:[--c-yellow:var(--warn-fg)] tw:[--c-orange:var(--release-caution)] tw:[--c-blue:var(--info)] tw:[--c-purple:var(--accent)] tw:[--link:var(--info-fg)] tw:[--rad:8px] tw:[--rad-sm:5px] tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="body tw:flex-1 tw:min-h-0 tw:overflow-auto tw:p-14 tw:text-[13px]">
      <div v-if="rs.error" class="err tw:sticky tw:-top-14 tw:z-6 tw:flex tw:items-start tw:gap-8 tw:mb-14 tw:py-8 tw:px-10 tw:rounded-(--rad-sm) tw:border tw:border-down/55 tw:bg-panel tw:text-down-fg">
        <span class="et tw:flex-1 tw:whitespace-pre-wrap">{{ rs.error }}</span>
        <button v-if="rs.conflict && repoPath" class="b sec sm tw:inline-flex tw:items-center tw:border-0 tw:rounded-(--rad-sm) tw:whitespace-nowrap tw:cursor-pointer tw:hover:enabled:filter-[brightness(1.12)] tw:disabled:opacity-50 tw:disabled:cursor-default tw:bg-white/8 tw:text-text tw:h-22 tw:py-0 tw:px-8 tw:text-[11px] tw:hover:enabled:border-border-3" @click="openInCode(repoPath)">Открыть в VS Code</button>
        <button class="ex tw:p-0 tw:border-0 tw:[background:none] tw:text-inherit tw:text-[15px] tw:leading-none tw:opacity-70 tw:cursor-pointer tw:hover:opacity-100 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Закрыть" @click="showError('')">×</button>
      </div>
      <ReleaseGitBar @manage="managerOpen = true" />
      <BranchesCard />
      <ChronologyCard />
      <CherryPickCard v-if="pendingItems.length" />
      <BuildCard />
    </div>
    <ProjectsManager v-model:open="managerOpen" />
  </div>
</template>
