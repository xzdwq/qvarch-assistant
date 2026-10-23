<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ProjectProfile } from '@shared/release'
import { ipcErrorText } from '@shared/releaseView'
import Icon from '../../components/Icon.vue'
import { loadProjects, openProject, rs } from '../../lib/releaseStore'

/** The projects window (teleported): the saved projects — open, edit, delete — and the project form. */
const open = defineModel<boolean>('open', { required: true })

type ProjectForm = Partial<ProjectProfile> & { prefixes: string }
const EMPTY: ProjectForm = { name: '', repositoryPath: '', mainBranch: 'main', devBranch: 'dev', remoteName: 'origin', releaseBranchPattern: 'release/release-{date}', branchListLimit: 100, staleBranchesLookbackReleases: 4, hideDuplicateRemoteBranches: true, taskTrackerBaseUrl: '', bitbucketWorkspace: '', bitbucketRepoSlug: '', prefixes: 'qa, revert-pr-, chore/' }
const form = ref<ProjectForm | null>(null)
const formError = ref('')
const delAsk = ref('')
function editProject(p?: ProjectProfile): void {
  formError.value = ''
  form.value = p ? { ...p, prefixes: p.nonTaskBranchPrefixes.join(', ') } : { ...EMPTY }
}
async function saveForm(): Promise<void> {
  if (!form.value) return
  const { prefixes, ...rest } = form.value
  try {
    const saved = await window.qa.releaseSaveProject(JSON.parse(JSON.stringify({ ...rest, nonTaskBranchPrefixes: prefixes.split(',').map((x) => x.trim()).filter(Boolean) })) as Partial<ProjectProfile>)
    form.value = null
    await loadProjects()
    if (!rs.opened || saved.id === rs.opened) void openProject(saved.id, true)
  } catch (e) {
    formError.value = ipcErrorText(e)
  }
}
async function pickFolder(): Promise<void> {
  const p = await window.qa.releasePickFolder()
  if (p && form.value) {
    form.value.repositoryPath = p
    if (!form.value.name) form.value.name = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
  }
}
async function removeProject(id: string): Promise<void> {
  await window.qa.releaseDeleteProject(id)
  delAsk.value = ''
  await loadProjects()
}
/** Escape closes the form first, then the window. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (form.value) form.value = null
  else open.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="rm-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:items-start tw:justify-center tw:pt-60 tw:bg-bg/50" @pointerdown.self="open = false">
      <div class="rm">
        <div class="rmh tw:flex tw:items-center tw:gap-4 tw:mb-6">
          <b>Проекты</b>
          <span class="sp tw:flex-1"></span>
          <button class="rib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Новый" @click="editProject()"><Icon name="plus" :size="14" /></button>
          <button class="rib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Закрыть" @click="open = false"><Icon name="x" :size="14" /></button>
        </div>
        <div v-for="p in rs.projects" :key="p.id" class="prow" :class="{ on: p.id === rs.projectId }">
          <div class="pinfo" @click="(open = false), openProject(p.id, true)">
            <b>{{ p.name }}</b><small>{{ p.repositoryPath }}</small>
          </div>
          <template v-if="delAsk === p.id">
            <button class="rbtn red tw:inline-flex tw:items-center tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-r2 tw:text-[12px] tw:cursor-pointer tw:[&&]:border-transparent tw:bg-down tw:text-text-hi" @click="removeProject(p.id)">Удалить</button>
            <button class="rbtn tw:inline-flex tw:items-center tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:cursor-pointer tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="delAsk = ''">Нет</button>
          </template>
          <template v-else>
            <button class="rib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Изменить" @click="editProject(p)"><Icon name="pencil" :size="13" /></button>
            <button class="rib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Удалить" @click="delAsk = p.id"><Icon name="trash" :size="13" /></button>
          </template>
        </div>
        <p v-if="!rs.projects.length && !form" class="rmut tw:my-10 tw:mx-4 tw:text-muted tw:text-[12.5px]">Добавьте проект — git-репозиторий, из веток которого собирается релиз</p>
        <form v-if="form" class="pform tw:grid tw:grid-cols-[1fr_1fr] tw:gap-y-8 tw:gap-x-12 tw:mt-8 tw:pt-10 tw:border-t tw:border-t-white/7" @submit.prevent="saveForm">
          <label class="w2 tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px] tw:col-span-full">Имя <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.name" placeholder="my-project" /></label>
          <label class="w2 tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px] tw:col-span-full">Репозиторий
            <span class="row tw:flex tw:gap-4"><input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px] tw:flex-1" v-model="form.repositoryPath" placeholder="C:\path\to\repo" /><button type="button" class="rib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:bg-white/7 tw:hover:text-text tw:hover:enabled:border-border-3" title="Выбрать папку" @click="pickFolder"><Icon name="folderOpen" :size="14" /></button></span>
          </label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Основная ветка <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.mainBranch" placeholder="main" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Dev-ветка <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.devBranch" placeholder="dev" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Remote <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.remoteName" placeholder="origin" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Релизная ветка <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.releaseBranchPattern" placeholder="release/release-{date}" /></label>
          <label class="w2 tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px] tw:col-span-full">Служебные префиксы <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.prefixes" placeholder="qa, revert-pr-, chore/" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Веток в списке <input class="tw:h-28 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-(--rad-sm) tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&&]:[&:not([type='checkbox'])]:text-[12.5px]" v-model.number="form.branchListLimit" type="number" min="1" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Окно забытых (релизов) <input class="tw:h-28 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-(--rad-sm) tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&&]:[&:not([type='checkbox'])]:text-[12.5px]" v-model.number="form.staleBranchesLookbackReleases" type="number" min="1" /></label>
          <label class="w2 ckl tw:flex tw:text-muted tw:text-[11.5px] tw:col-span-full tw:flex-row tw:items-center tw:gap-7"><input class="tw:m-0 tw:[accent-color:var(--accent)] tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.hideDuplicateRemoteBranches" type="checkbox" />Скрывать remote-ветку, если есть локальная</label>
          <label class="w2 tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px] tw:col-span-full">Ссылка на задачу <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.taskTrackerBaseUrl" placeholder="https://company.atlassian.net/browse" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Bitbucket workspace <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.bitbucketWorkspace" /></label>
          <label class="tw:flex tw:flex-col tw:gap-3 tw:text-muted tw:text-[11.5px]">Bitbucket repo <input class="tw:[&:not([type='checkbox'])]:h-30 tw:[&:not([type='checkbox'])]:py-0 tw:[&:not([type='checkbox'])]:px-8 tw:[&:not([type='checkbox'])]:border tw:[&:not([type='checkbox'])]:border-border tw:[&:not([type='checkbox'])]:rounded-[4px] tw:[&:not([type='checkbox'])]:bg-bg tw:[&:not([type='checkbox'])]:text-text tw:[&:not([type='checkbox'])]:text-[12.5px]" v-model="form.bitbucketRepoSlug" placeholder="по имени папки" /></label>
          <p v-if="formError" class="ferr w2 tw:col-span-full tw:my-4 tw:mx-0 tw:text-down-fg tw:text-[12px]">{{ formError }}</p>
          <div class="w2 fact tw:col-span-full">
            <button type="button" class="rbtn tw:inline-flex tw:items-center tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:cursor-pointer tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="form = null">Отмена</button>
            <button type="submit" class="rbtn pri tw:inline-flex tw:items-center tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-r2 tw:text-[12px] tw:cursor-pointer tw:[&&]:border-transparent tw:bg-accent tw:text-on-accent">Сохранить проект</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
